import {
  CorrelationPair,
  Difficulty,
  PerfRow,
  PredictionSummary,
  RiskLevel,
  StudentPrediction,
  SubjectPrediction,
  SubjectStat,
  TrainedModel,
  Trends,
} from './types';

const PASS_THRESHOLD = 4;
const MAX_SEMESTER = 8;

export const FEATURE_NAMES = [
  'work_mean',
  'work_min',
  'work_zero_count',
  'attendance',
  'prior_exam_mean',
  'prior_attendance_mean',
  'prior_work_mean',
  'difficulty',
  'subject_exam_mean',
  'subject_attendance_mean',
  'semester',
  'requires_attendance',
];

function difficultyNum(d: Difficulty): number {
  return d === 'easy' ? 1 : d === 'hard' ? 3 : 2;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function submittedWorkMean(work: number[]): number {
  const sub = work.filter((w) => w > 0);
  return sub.length ? mean(sub) : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

interface Prior {
  examMean: number | null;
  attnMean: number | null;
  workMean: number | null;
}

/**
 * For every row, compute the student's aggregates over strictly-earlier semesters.
 * (Used so the model predicts an exam from what is known before it.)
 */
function computePriors(rows: PerfRow[]): Prior[] {
  const priors: Prior[] = new Array(rows.length);
  const byStudent = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const list = byStudent.get(rows[i].studentId);
    if (list) list.push(i);
    else byStudent.set(rows[i].studentId, [i]);
  }

  for (const indices of byStudent.values()) {
    // group this student's rows by semester
    const bySem = new Map<number, number[]>();
    for (const i of indices) {
      const list = bySem.get(rows[i].semester);
      if (list) list.push(i);
      else bySem.set(rows[i].semester, [i]);
    }
    const sems = Array.from(bySem.keys()).sort((a, b) => a - b);

    let examSum = 0;
    let examCnt = 0;
    let attnSum = 0;
    let attnCnt = 0;
    let workSum = 0;
    let workCnt = 0;

    for (const sem of sems) {
      const examMean = examCnt ? examSum / examCnt : null;
      const attnMean = attnCnt ? attnSum / attnCnt : null;
      const workMean = workCnt ? workSum / workCnt : null;
      for (const i of bySem.get(sem)!) {
        priors[i] = { examMean, attnMean, workMean };
      }
      // fold this semester into the running totals (after assigning the prior)
      for (const i of bySem.get(sem)!) {
        const row = rows[i];
        if (row.exam !== null) {
          examSum += row.exam;
          examCnt++;
        }
        attnSum += row.attendance;
        attnCnt++;
        workSum += submittedWorkMean(row.work);
        workCnt++;
      }
    }
  }
  return priors;
}

interface SubjectAgg {
  avgExam: number;
  avgAttendance: number;
  avgWork: number;
  difficulty: Difficulty;
}

function buildFeatureVector(
  row: PerfRow,
  prior: Prior,
  subjectAgg: SubjectAgg | undefined,
  globals: { exam: number; attendance: number; work: number }
): number[] {
  const works = row.work;
  const wMean = submittedWorkMean(works);
  const wMin = Math.min(...works);
  const zeroCount = works.filter((w) => w === 0).length;
  const subjExam = subjectAgg ? subjectAgg.avgExam : globals.exam;
  const subjAttn = subjectAgg ? subjectAgg.avgAttendance : globals.attendance;

  return [
    wMean,
    wMin,
    zeroCount,
    row.attendance,
    prior.examMean ?? globals.exam,
    prior.attnMean ?? globals.attendance,
    prior.workMean ?? globals.work,
    difficultyNum(row.difficulty),
    subjExam,
    subjAttn,
    row.semester,
    row.requiresAttendance ? 1 : 0,
  ];
}

// --------------------------------------------------------------------------
// Linear algebra: ridge regression via the normal equations.
// --------------------------------------------------------------------------

/** Solve A x = b for a square matrix A (Gaussian elimination with partial pivoting). */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) continue;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const pv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

interface Standardizer {
  means: number[];
  stds: number[];
}

function fitStandardizer(X: number[][]): Standardizer {
  const d = X[0].length;
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) means[j] += row[j];
  for (let j = 0; j < d; j++) means[j] /= X.length;
  for (const row of X) for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2;
  for (let j = 0; j < d; j++) {
    stds[j] = Math.sqrt(stds[j] / X.length);
    if (stds[j] < 1e-9) stds[j] = 1;
  }
  return { means, stds };
}

function standardizeRow(x: number[], s: Standardizer): number[] {
  return x.map((v, j) => (v - s.means[j]) / s.stds[j]);
}

/** Ridge regression. Returns weights of length d+1 (last entry = bias). */
function ridgeRegression(Xstd: number[][], y: number[], lambda: number): number[] {
  const n = Xstd.length;
  const d = Xstd[0].length;
  const m = d + 1; // + bias

  // A = augmented design with a bias column of ones
  // Build normal equations (X^T X + lambda I) w = X^T y, no penalty on bias.
  const XtX: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const Xty: number[] = new Array(m).fill(0);

  for (let i = 0; i < n; i++) {
    const row = Xstd[i];
    const yi = y[i];
    for (let a = 0; a < m; a++) {
      const va = a < d ? row[a] : 1;
      Xty[a] += va * yi;
      for (let bcol = a; bcol < m; bcol++) {
        const vb = bcol < d ? row[bcol] : 1;
        XtX[a][bcol] += va * vb;
      }
    }
  }
  // mirror the symmetric matrix + ridge penalty
  for (let a = 0; a < m; a++) {
    for (let bcol = a; bcol < m; bcol++) {
      if (a !== bcol) XtX[bcol][a] = XtX[a][bcol];
    }
    if (a < d) XtX[a][a] += lambda;
  }
  return solveLinearSystem(XtX, Xty);
}

function predictStd(xStd: number[], weights: number[]): number {
  const d = xStd.length;
  let s = weights[d]; // bias
  for (let j = 0; j < d; j++) s += weights[j] * xStd[j];
  return s;
}

// --------------------------------------------------------------------------
// Trends
// --------------------------------------------------------------------------

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx < 1e-9 || dy < 1e-9) return 0;
  return num / Math.sqrt(dx * dy);
}

function computeTrends(rows: PerfRow[], subjectStats: SubjectStat[]): Trends {
  // attendance & pass-rate by semester
  const attnBySem: { sum: number; cnt: number }[] = Array.from({ length: MAX_SEMESTER + 1 }, () => ({ sum: 0, cnt: 0 }));
  const passBySem: { pass: number; cnt: number }[] = Array.from({ length: MAX_SEMESTER + 1 }, () => ({ pass: 0, cnt: 0 }));
  const hist = new Array(11).fill(0);

  for (const row of rows) {
    if (row.semester >= 1 && row.semester <= MAX_SEMESTER) {
      attnBySem[row.semester].sum += row.attendance;
      attnBySem[row.semester].cnt++;
      if (row.exam !== null) {
        passBySem[row.semester].cnt++;
        if (row.exam >= PASS_THRESHOLD) passBySem[row.semester].pass++;
      }
    }
    if (row.exam !== null) {
      const g = clamp(Math.round(row.exam), 0, 10);
      hist[g]++;
    }
  }

  const attendanceBySemester = [];
  const passRateBySemester = [];
  for (let s = 1; s <= MAX_SEMESTER; s++) {
    attendanceBySemester.push({
      semester: s,
      avgAttendance: attnBySem[s].cnt ? attnBySem[s].sum / attnBySem[s].cnt : 0,
      records: attnBySem[s].cnt,
    });
    passRateBySemester.push({
      semester: s,
      passRate: passBySem[s].cnt ? passBySem[s].pass / passBySem[s].cnt : 0,
    });
  }

  const examGradeHistogram = hist.map((count, grade) => ({ grade, count }));

  const highAttendanceSubjects = [...subjectStats]
    .sort((a, b) => b.avgAttendance - a.avgAttendance)
    .slice(0, 6);

  // ---- correlation between subjects' exam grades (per-student average) ----
  // studentId -> subject -> average exam
  const perStudent = new Map<string, Map<string, { sum: number; cnt: number }>>();
  for (const row of rows) {
    if (row.exam === null) continue;
    let m = perStudent.get(row.studentId);
    if (!m) {
      m = new Map();
      perStudent.set(row.studentId, m);
    }
    const e = m.get(row.subject);
    if (e) {
      e.sum += row.exam;
      e.cnt++;
    } else {
      m.set(row.subject, { sum: row.exam, cnt: 1 });
    }
  }

  const subjects = subjectStats.map((s) => s.subject);
  // pre-extract per-student averaged vectors
  const studentAvg: Map<string, Map<string, number>> = new Map();
  for (const [sid, m] of perStudent) {
    const avg = new Map<string, number>();
    for (const [subj, agg] of m) avg.set(subj, agg.sum / agg.cnt);
    studentAvg.set(sid, avg);
  }

  const n = subjects.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const avg of studentAvg.values()) {
        const a = avg.get(subjects[i]);
        const b = avg.get(subjects[j]);
        if (a !== undefined && b !== undefined) {
          xs.push(a);
          ys.push(b);
        }
      }
      const r = xs.length >= 5 ? pearson(xs, ys) : 0;
      matrix[i][j] = r;
      matrix[j][i] = r;
      if (xs.length >= 20) pairs.push({ a: subjects[i], b: subjects[j], r, commonStudents: xs.length });
    }
  }

  const topCorrelations = pairs.sort((p, q) => q.r - p.r).slice(0, 12);

  return {
    attendanceBySemester,
    passRateBySemester,
    subjectStats: [...subjectStats].sort((a, b) => b.avgExam - a.avgExam),
    highAttendanceSubjects,
    examGradeHistogram,
    topCorrelations,
    correlationMatrix: { subjects, matrix },
  };
}

function computeSubjectStats(rows: PerfRow[]): { stats: SubjectStat[]; map: Map<string, SubjectAgg> } {
  interface Acc {
    diff: Difficulty;
    req: boolean;
    attnSum: number;
    attnCnt: number;
    examSum: number;
    examCnt: number;
    workSum: number;
    workCnt: number;
    pass: number;
  }
  const accs = new Map<string, Acc>();
  for (const row of rows) {
    let a = accs.get(row.subject);
    if (!a) {
      a = {
        diff: row.difficulty,
        req: row.requiresAttendance,
        attnSum: 0,
        attnCnt: 0,
        examSum: 0,
        examCnt: 0,
        workSum: 0,
        workCnt: 0,
        pass: 0,
      };
      accs.set(row.subject, a);
    }
    a.attnSum += row.attendance;
    a.attnCnt++;
    a.workSum += submittedWorkMean(row.work);
    a.workCnt++;
    if (row.exam !== null) {
      a.examSum += row.exam;
      a.examCnt++;
      if (row.exam >= PASS_THRESHOLD) a.pass++;
    }
  }

  const stats: SubjectStat[] = [];
  const map = new Map<string, SubjectAgg>();
  for (const [subject, a] of accs) {
    const avgExam = a.examCnt ? a.examSum / a.examCnt : 0;
    const avgAttendance = a.attnCnt ? a.attnSum / a.attnCnt : 0;
    const avgWork = a.workCnt ? a.workSum / a.workCnt : 0;
    stats.push({
      subject,
      difficulty: a.diff,
      requiresAttendance: a.req,
      avgAttendance,
      avgExam,
      avgWork,
      passRate: a.examCnt ? a.pass / a.examCnt : 0,
      records: a.attnCnt,
    });
    map.set(subject, { avgExam, avgAttendance, avgWork, difficulty: a.diff });
  }
  return { stats, map };
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export function train(rows: PerfRow[]): TrainedModel {
  const labelled = rows.filter((r) => r.exam !== null);
  if (labelled.length < 20) {
    throw new Error('Недостаточно строк с оценкой за экзамен для обучения модели.');
  }

  const { stats: subjectStats, map: subjectMap } = computeSubjectStats(rows);

  const globals = {
    exam: mean(labelled.map((r) => r.exam as number)),
    attendance: mean(rows.map((r) => r.attendance)),
    work: mean(rows.map((r) => submittedWorkMean(r.work))),
  };

  const priors = computePriors(rows);

  // build the training design matrix from labelled rows only
  const X: number[][] = [];
  const y: number[] = [];
  const rowIndexForX: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].exam === null) continue;
    X.push(buildFeatureVector(rows[i], priors[i], subjectMap.get(rows[i].subject), globals));
    y.push(rows[i].exam as number);
    rowIndexForX.push(i);
  }

  const std = fitStandardizer(X);
  const Xstd = X.map((row) => standardizeRow(row, std));
  const weights = ridgeRegression(Xstd, y, 1.0);

  // training metrics
  let absErr = 0;
  let sqErr = 0;
  let correctClass = 0;
  for (let i = 0; i < Xstd.length; i++) {
    const pred = clamp(predictStd(Xstd[i], weights), 0, 10);
    const err = pred - y[i];
    absErr += Math.abs(err);
    sqErr += err * err;
    const predPass = pred >= PASS_THRESHOLD;
    const actualPass = y[i] >= PASS_THRESHOLD;
    if (predPass === actualPass) correctClass++;
  }

  const subjects: TrainedModel['subjects'] = {};
  for (const [subject, agg] of subjectMap) {
    subjects[subject] = {
      avgExam: agg.avgExam,
      avgAttendance: agg.avgAttendance,
      avgWork: agg.avgWork,
      difficulty: agg.difficulty,
    };
  }

  const trends = computeTrends(rows, subjectStats);
  const students = new Set(rows.map((r) => r.studentId)).size;

  return {
    version: 1,
    trainedAt: new Date().toISOString(),
    featureNames: FEATURE_NAMES,
    means: std.means,
    stds: std.stds,
    weights,
    globalExamMean: globals.exam,
    globalAttendanceMean: globals.attendance,
    globalWorkMean: globals.work,
    subjects,
    passThreshold: PASS_THRESHOLD,
    metrics: {
      trainRows: Xstd.length,
      students,
      mae: absErr / Xstd.length,
      rmse: Math.sqrt(sqErr / Xstd.length),
      examAccuracy: correctClass / Xstd.length,
    },
    trends,
  };
}

function riskFromExam(pred: number, threshold: number): RiskLevel {
  if (pred < threshold) return 'high';
  if (pred < threshold + 1.5) return 'medium';
  return 'low';
}

export function predict(model: TrainedModel, rows: PerfRow[]): PredictionSummary {
  const priors = computePriors(rows);
  const globals = { exam: model.globalExamMean, attendance: model.globalAttendanceMean, work: model.globalWorkMean };
  const std: Standardizer = { means: model.means, stds: model.stds };

  // predict for rows whose exam is blank (the upcoming session). If the CSV has
  // no blanks at all, fall back to predicting the latest semester per student.
  const blankRows = rows.filter((r) => r.exam === null);
  let targetRows = blankRows;
  if (targetRows.length === 0) {
    const latestSem = new Map<string, number>();
    for (const r of rows) latestSem.set(r.studentId, Math.max(latestSem.get(r.studentId) ?? 0, r.semester));
    targetRows = rows.filter((r) => r.semester === latestSem.get(r.studentId));
  }

  const targetSet = new Set(targetRows);
  const byStudent = new Map<string, StudentPrediction>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!targetSet.has(row)) continue;

    const subjAgg = model.subjects[row.subject];
    const x = buildFeatureVector(row, priors[i], subjAgg, globals);
    const pred = clamp(predictStd(standardizeRow(x, std), model.weights), 0, 10);
    const predRound = Math.round(pred * 10) / 10;
    const pass = pred >= model.passThreshold;
    const risk = riskFromExam(pred, model.passThreshold);

    const sp: SubjectPrediction = {
      subject: row.subject,
      semester: row.semester,
      predictedExam: predRound,
      predictedPass: pass,
      risk,
    };

    let student = byStudent.get(row.studentId);
    if (!student) {
      const prior = priors[i];
      student = {
        studentId: row.studentId,
        group: row.group,
        risk: 'low',
        predictedFailCount: 0,
        avgPredictedExam: 0,
        minPredictedExam: 10,
        avgHistoricalAttendance: prior.attnMean ?? row.attendance,
        avgHistoricalExam: prior.examMean ?? model.globalExamMean,
        subjects: [],
      };
      byStudent.set(row.studentId, student);
    }
    student.subjects.push(sp);
  }

  const students: StudentPrediction[] = [];
  let predictedFailSubjects = 0;
  for (const s of byStudent.values()) {
    const preds = s.subjects.map((p) => p.predictedExam);
    s.avgPredictedExam = Math.round(mean(preds) * 10) / 10;
    s.minPredictedExam = Math.round(Math.min(...preds) * 10) / 10;
    s.predictedFailCount = s.subjects.filter((p) => !p.predictedPass).length;
    predictedFailSubjects += s.predictedFailCount;
    s.subjects.sort((a, b) => a.predictedExam - b.predictedExam);
    // overall student risk
    if (s.predictedFailCount >= 2 || s.minPredictedExam < model.passThreshold) s.risk = 'high';
    else if (s.predictedFailCount === 1 || s.minPredictedExam < model.passThreshold + 1.5) s.risk = 'medium';
    else s.risk = 'low';
    students.push(s);
  }

  const order: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };
  students.sort((a, b) => order[a.risk] - order[b.risk] || a.minPredictedExam - b.minPredictedExam);

  return {
    totalStudents: students.length,
    highRisk: students.filter((s) => s.risk === 'high').length,
    mediumRisk: students.filter((s) => s.risk === 'medium').length,
    lowRisk: students.filter((s) => s.risk === 'low').length,
    predictedFailSubjects,
    students,
  };
}
