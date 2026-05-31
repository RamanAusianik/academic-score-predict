/*
 * Synthetic academic-performance data generator.
 *
 * Produces fictitious-but-realistic data for a technical university so that the
 * Angular client can train a grade-prediction model on it.
 *
 * Outputs (written next to this script, into ./data):
 *   - subjects.json              metadata about the 30 disciplines
 *   - training_data.csv          4 full graduating cohorts (the model trains on this)
 *   - current_students.csv       students midway through semester 5 (exam grade blank -> to predict)
 *   - current_students_answer_key.csv   the real semester-5 exam grades (for checking predictions)
 *   - students_meta.csv          per-student hidden labels (excellent / poor) -- NOT used by the model
 *
 * Everything is seeded, so re-running produces identical files.
 *
 * Run with:  node data/generate-data.js
 */

const fs = require('fs');
const path = require('path');

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const SEED = 20250530;
const SEMESTERS_PER_DEGREE = 8; // 4 years
const GROUPS_PER_COHORT = 50;
const MIN_GROUP_SIZE = 15; // 20 +/- 5
const MAX_GROUP_SIZE = 25;
const GRADUATION_YEARS = [2022, 2023, 2024, 2025]; // last cohort graduates in 2025

// How fast attendance erodes, on average, per additional semester (percentage points).
const ATTENDANCE_SEMESTER_DECAY = 3.2;

// Fraction of students that get the hidden "excellent" / "poor" labels.
const EXCELLENT_SHARE = 0.08;
const POOR_SHARE = 0.13;

const PASS_EXAM_THRESHOLD = 4; // exam < 4 (out of 10) counts as a fail

const OUT_DIR = __dirname;

// --------------------------------------------------------------------------
// Seeded RNG (mulberry32) + helpers
// --------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);

function rand() {
  return rng();
}

function randn() {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function randInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

// --------------------------------------------------------------------------
// Disciplines (30) for a technical university
// --------------------------------------------------------------------------
// difficulty: easy | normal | hard
// requiresAttendance: a couple of subjects where showing up is mandatory
// duration: number of semesters the subject runs for
// group: correlation group -> subjects in the same group share student aptitude,
//        which produces correlated grades (e.g. all the maths correlate strongly)
// canonicalStart: default semester the subject begins in (groups jitter this a bit)

const SUBJECTS = [
  { name: 'Математический анализ I', difficulty: 'hard', group: 'math', duration: 2, canonicalStart: 1, requiresAttendance: false },
  { name: 'Математический анализ II', difficulty: 'hard', group: 'math', duration: 2, canonicalStart: 3, requiresAttendance: false },
  { name: 'Линейная алгебра и геометрия', difficulty: 'normal', group: 'math', duration: 1, canonicalStart: 1, requiresAttendance: false },
  { name: 'Дискретная математика', difficulty: 'normal', group: 'math', duration: 1, canonicalStart: 2, requiresAttendance: false },
  { name: 'Теория вероятностей и матстатистика', difficulty: 'hard', group: 'math', duration: 1, canonicalStart: 5, requiresAttendance: false },
  { name: 'Дифференциальные уравнения', difficulty: 'hard', group: 'math', duration: 1, canonicalStart: 4, requiresAttendance: false },
  { name: 'Численные методы', difficulty: 'normal', group: 'math', duration: 1, canonicalStart: 5, requiresAttendance: false },

  { name: 'Введение в программирование', difficulty: 'normal', group: 'programming', duration: 1, canonicalStart: 1, requiresAttendance: false },
  { name: 'Объектно-ориентированное программирование', difficulty: 'normal', group: 'programming', duration: 1, canonicalStart: 2, requiresAttendance: false },
  { name: 'Структуры данных и алгоритмы', difficulty: 'hard', group: 'programming', duration: 2, canonicalStart: 3, requiresAttendance: false },
  { name: 'Базы данных', difficulty: 'normal', group: 'programming', duration: 1, canonicalStart: 4, requiresAttendance: false },
  { name: 'Операционные системы', difficulty: 'hard', group: 'programming', duration: 1, canonicalStart: 5, requiresAttendance: false },
  { name: 'Компьютерные сети', difficulty: 'normal', group: 'programming', duration: 1, canonicalStart: 6, requiresAttendance: false },
  { name: 'Веб-разработка', difficulty: 'normal', group: 'programming', duration: 1, canonicalStart: 6, requiresAttendance: false },

  { name: 'Физика I (механика)', difficulty: 'hard', group: 'physics', duration: 2, canonicalStart: 2, requiresAttendance: false },
  { name: 'Физика II (электричество)', difficulty: 'hard', group: 'physics', duration: 2, canonicalStart: 4, requiresAttendance: false },
  { name: 'Электротехника', difficulty: 'normal', group: 'physics', duration: 1, canonicalStart: 4, requiresAttendance: false },

  { name: 'Инженерная графика', difficulty: 'normal', group: 'engineering', duration: 1, canonicalStart: 1, requiresAttendance: false },
  { name: 'Теоретическая механика', difficulty: 'hard', group: 'engineering', duration: 1, canonicalStart: 3, requiresAttendance: false },
  { name: 'Материаловедение', difficulty: 'normal', group: 'engineering', duration: 1, canonicalStart: 3, requiresAttendance: false },
  { name: 'Схемотехника', difficulty: 'hard', group: 'engineering', duration: 1, canonicalStart: 6, requiresAttendance: false },

  { name: 'Философия', difficulty: 'easy', group: 'humanities', duration: 1, canonicalStart: 7, requiresAttendance: true },
  { name: 'История России', difficulty: 'easy', group: 'humanities', duration: 1, canonicalStart: 1, requiresAttendance: true },
  { name: 'Иностранный язык', difficulty: 'normal', group: 'language', duration: 4, canonicalStart: 1, requiresAttendance: true },
  { name: 'Экономика', difficulty: 'easy', group: 'humanities', duration: 1, canonicalStart: 7, requiresAttendance: false },
  { name: 'Правоведение', difficulty: 'easy', group: 'humanities', duration: 1, canonicalStart: 8, requiresAttendance: false },
  { name: 'Социология', difficulty: 'easy', group: 'humanities', duration: 1, canonicalStart: 8, requiresAttendance: false },
  { name: 'Физическая культура', difficulty: 'easy', group: 'sport', duration: 6, canonicalStart: 1, requiresAttendance: true },
  { name: 'Безопасность жизнедеятельности', difficulty: 'normal', group: 'humanities', duration: 1, canonicalStart: 7, requiresAttendance: false },
  { name: 'Менеджмент в IT', difficulty: 'normal', group: 'humanities', duration: 1, canonicalStart: 8, requiresAttendance: false },
];

SUBJECTS.forEach((s, i) => {
  s.id = i + 1;
});

const DIFFICULTY_GRADE_OFFSET = { easy: 1.0, normal: 0.0, hard: -1.2 };
const CORRELATION_GROUPS = Array.from(new Set(SUBJECTS.map((s) => s.group)));

// --------------------------------------------------------------------------
// Curriculum: for each group decide which subject runs in which semesters.
// We start from the canonical schedule and apply a small per-group jitter so
// that groups differ a little, while keeping the per-semester load balanced.
// --------------------------------------------------------------------------

function buildCurriculum() {
  const schedule = {}; // subjectId -> [semester, ...]
  for (const subj of SUBJECTS) {
    const maxStart = SEMESTERS_PER_DEGREE - subj.duration + 1;
    let start = subj.canonicalStart;
    // Multi-semester subjects keep their canonical placement (they anchor the plan);
    // single-semester subjects jitter by up to +/- 1 semester.
    if (subj.duration === 1) {
      start += pick([-1, 0, 0, 1]);
    }
    start = clamp(start, 1, maxStart);
    const sems = [];
    for (let k = 0; k < subj.duration; k++) sems.push(start + k);
    schedule[subj.id] = sems;
  }
  return schedule;
}

// --------------------------------------------------------------------------
// Students
// --------------------------------------------------------------------------

let studentCounter = 0;

function makeStudent(entryYear, groupName) {
  studentCounter += 1;
  const id = `STU${String(studentCounter).padStart(6, '0')}`;

  // hidden label
  const roll = rng();
  let label = 'normal';
  if (roll < EXCELLENT_SHARE) label = 'excellent';
  else if (roll > 1 - POOR_SHARE) label = 'poor';

  // general ability on a roughly [-2, 2] scale
  let ability;
  if (label === 'excellent') ability = clamp(1.6 + randn() * 0.3, 1.0, 2.5);
  else if (label === 'poor') ability = clamp(-1.6 + randn() * 0.35, -2.6, -0.6);
  else ability = clamp(randn() * 0.8, -2.0, 2.0);

  // diligence drives attendance independently of raw ability
  let diligence;
  if (label === 'excellent') diligence = clamp(1.6 + randn() * 0.25, 1.0, 2.5);
  else if (label === 'poor') diligence = clamp(-1.4 + randn() * 0.4, -2.5, -0.4);
  else diligence = clamp(randn() * 0.8, -2.0, 2.0);

  // Per-correlation-group aptitude. A subject's grades are driven by the aptitude
  // of its group, which is shared by every subject in that group -> subjects in the
  // same group (e.g. all the maths) correlate strongly, while the smaller general
  // ability term keeps a weaker correlation across unrelated groups.
  const groupAptitude = {};
  for (const g of CORRELATION_GROUPS) {
    groupAptitude[g] = 0.45 * ability + 0.85 * randn();
  }

  return {
    id,
    entryYear,
    groupName,
    label,
    ability,
    diligence,
    groupAptitude,
    enrolled: true,
    failStreak: 0,
    totalFails: 0,
  };
}

// --------------------------------------------------------------------------
// Grade / attendance generation for one (student, subject, semester)
// --------------------------------------------------------------------------

function generateRecord(student, subj, semester) {
  const aptitude = student.groupAptitude[subj.group];
  const diffOffset = DIFFICULTY_GRADE_OFFSET[subj.difficulty];

  // ----- attendance -----
  let baseAttendance;
  if (student.label === 'excellent') baseAttendance = 96 + randn() * 2.5;
  else if (student.label === 'poor') baseAttendance = 58 + student.diligence * 6 + randn() * 9;
  else baseAttendance = 84 + student.diligence * 7 + randn() * 7;

  // global trend: attendance drops as the semester number grows
  baseAttendance -= ATTENDANCE_SEMESTER_DECAY * (semester - 1);

  // subjects that require attendance are policed harder -> people show up more
  if (subj.requiresAttendance) baseAttendance += 6;

  let attendance = clamp(baseAttendance, 0, 100);
  attendance = round1(attendance);

  // attendance, expressed as a centered factor, feeds into grades
  const attnFactor = (attendance - 75) / 25; // ~[-3 .. +1]

  // ----- target grade level (0..10) -----
  let level = 6.4 + 1.55 * aptitude + diffOffset;

  // attendance matters everywhere, and a lot more for attendance-mandatory subjects
  level += attnFactor * (subj.requiresAttendance ? 1.5 : 0.7);

  if (student.label === 'excellent') level = Math.max(level, 8.6);
  if (student.label === 'poor') level = Math.min(level, 5.2);

  // probability a piece of work is simply not submitted (scored 0)
  let missChance;
  if (student.label === 'excellent') missChance = 0.005;
  else if (student.label === 'poor') missChance = 0.22;
  else missChance = 0.06;
  // missing work becomes more common in later semesters / with low attendance
  missChance += 0.012 * (semester - 1) + clamp((70 - attendance) / 100, 0, 0.3);
  missChance = clamp(missChance, 0, 0.6);

  function gradeFromLevel(extraNoise) {
    if (rng() < missChance) return 0;
    let g = level + randn() * (extraNoise + 0.9);
    g = clamp(g, 1, 10);
    return Math.round(g);
  }

  const work = [];
  for (let i = 0; i < 5; i++) work.push(gradeFromLevel(0.8));

  // exam reflects the work done during the semester plus the underlying level
  const submittedWork = work.filter((w) => w > 0);
  const workAvg = submittedWork.length ? submittedWork.reduce((a, b) => a + b, 0) / submittedWork.length : 0;
  const zeroCount = work.filter((w) => w === 0).length;

  let exam;
  if (rng() < missChance * 0.8 || zeroCount >= 4) {
    exam = 0; // did not show up / not admitted to the exam
  } else {
    let e = 0.55 * workAvg + 0.45 * level + randn() * 0.9 - zeroCount * 0.4;
    if (student.label === 'excellent') e = Math.max(e, 8.5);
    exam = clamp(Math.round(e), 0, 10);
  }

  return {
    attendance,
    work,
    exam,
    failed: exam < PASS_EXAM_THRESHOLD,
  };
}

// --------------------------------------------------------------------------
// Simulate a cohort and emit rows
// --------------------------------------------------------------------------

function csvEscape(value) {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const TRAINING_HEADER = [
  'student_id',
  'group',
  'cohort_entry_year',
  'subject',
  'difficulty',
  'requires_attendance',
  'subject_total_semesters',
  'semester',
  'attendance_pct',
  'work1',
  'work2',
  'work3',
  'work4',
  'work5',
  'exam',
];

function recordRow(student, subj, semester, rec, blankExam) {
  return [
    student.id,
    student.groupName,
    student.entryYear,
    subj.name,
    subj.difficulty,
    subj.requiresAttendance ? 1 : 0,
    subj.duration,
    semester,
    rec.attendance,
    rec.work[0],
    rec.work[1],
    rec.work[2],
    rec.work[3],
    rec.work[4],
    blankExam ? '' : rec.exam,
  ].map(csvEscape).join(',');
}

/**
 * Simulate one cohort.
 * options:
 *   maxSemester      - stop after this semester (for the "current" cohort)
 *   blankExamFrom    - from this semester on, write the exam column blank
 *   answerRows       - if provided, real (blanked) exam grades are pushed here
 *   allowAttrition   - whether weak students can be expelled
 */
function simulateCohort(entryYear, numGroups, options, rowsOut, metaOut) {
  const maxSemester = options.maxSemester || SEMESTERS_PER_DEGREE;
  const blankExamFrom = options.blankExamFrom || Infinity;
  const allowAttrition = options.allowAttrition !== false;

  for (let g = 1; g <= numGroups; g++) {
    const groupName = `${entryYear}-${String(g).padStart(2, '0')}`;
    const curriculum = buildCurriculum();
    const size = randInt(MIN_GROUP_SIZE, MAX_GROUP_SIZE);

    const students = [];
    for (let s = 0; s < size; s++) students.push(makeStudent(entryYear, groupName));

    for (const student of students) {
      metaOut.push([student.id, student.groupName, student.entryYear, student.label].map(csvEscape).join(','));
    }

    for (let sem = 1; sem <= maxSemester; sem++) {
      for (const student of students) {
        if (!student.enrolled) continue;

        let semesterFails = 0;
        for (const subj of SUBJECTS) {
          if (!curriculum[subj.id].includes(sem)) continue;
          const rec = generateRecord(student, subj, sem);
          const blank = sem >= blankExamFrom;
          rowsOut.push(recordRow(student, subj, sem, rec, blank));
          if (blank && options.answerRows) {
            options.answerRows.push(
              [student.id, subj.name, sem, rec.exam, rec.exam < PASS_EXAM_THRESHOLD ? 'fail' : 'pass']
                .map(csvEscape)
                .join(',')
            );
          }
          if (rec.failed) semesterFails += 1;
        }

        // end-of-semester attrition decision (skip the blanked / "current" semester)
        if (allowAttrition && sem < blankExamFrom) {
          if (semesterFails >= 2) student.failStreak += 1;
          else student.failStreak = 0;
          student.totalFails += semesterFails;

          const excellent = student.label === 'excellent';
          if (!excellent && (student.failStreak >= 2 || semesterFails >= 4)) {
            // expelled: no further semesters are generated for this student
            student.enrolled = false;
          }
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
// Build everything
// --------------------------------------------------------------------------

function main() {
  console.log('Generating synthetic academic data...');

  // 1) subjects.json
  const subjectsOut = SUBJECTS.map((s) => ({
    id: s.id,
    name: s.name,
    difficulty: s.difficulty,
    requiresAttendance: s.requiresAttendance,
    durationSemesters: s.duration,
    correlationGroup: s.group,
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'subjects.json'), JSON.stringify(subjectsOut, null, 2), 'utf8');

  // 2) training data: 4 full graduating cohorts
  const trainingRows = [TRAINING_HEADER.join(',')];
  const metaRows = ['student_id,group,cohort_entry_year,hidden_label'];

  for (const gradYear of GRADUATION_YEARS) {
    const entryYear = gradYear - 4;
    simulateCohort(entryYear, GROUPS_PER_COHORT, { allowAttrition: true }, trainingRows, metaRows);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'training_data.csv'), trainingRows.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'students_meta.csv'), metaRows.join('\n') + '\n', 'utf8');

  // 3) current students: entered 2023, have finished 4 semesters and are now
  //    finishing semester 5 (exam grade for semester 5 is left blank to predict).
  const currentRows = [TRAINING_HEADER.join(',')];
  const answerRows = ['student_id,subject,semester,actual_exam,actual_outcome'];
  const currentMeta = ['student_id,group,cohort_entry_year,hidden_label'];
  simulateCohort(
    2023,
    8,
    { maxSemester: 5, blankExamFrom: 5, answerRows, allowAttrition: true },
    currentRows,
    currentMeta
  );
  fs.writeFileSync(path.join(OUT_DIR, 'current_students.csv'), currentRows.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'current_students_answer_key.csv'), answerRows.join('\n') + '\n', 'utf8');

  // stats
  console.log(`  subjects:            ${subjectsOut.length}`);
  console.log(`  training rows:       ${trainingRows.length - 1}`);
  console.log(`  training students:   ${metaRows.length - 1}`);
  console.log(`  current rows:        ${currentRows.length - 1}`);
  console.log(`  prediction targets:  ${answerRows.length - 1}`);
  console.log('Done. Files written to ' + OUT_DIR);
}

main();
