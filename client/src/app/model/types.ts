export type Difficulty = 'easy' | 'normal' | 'hard';

/** One parsed row of a performance CSV (a student / subject / semester record). */
export interface PerfRow {
  studentId: string;
  group: string;
  cohortEntryYear: number;
  subject: string;
  difficulty: Difficulty;
  requiresAttendance: boolean;
  subjectTotalSemesters: number;
  semester: number;
  attendance: number;
  /** the five in-semester work grades (0 = not submitted) */
  work: number[];
  /** exam grade, or null when the column is blank (a value we must predict) */
  exam: number | null;
}

/** Aggregated stats about a single subject, learned from the training set. */
export interface SubjectStat {
  subject: string;
  difficulty: Difficulty;
  requiresAttendance: boolean;
  avgAttendance: number;
  avgExam: number;
  avgWork: number;
  passRate: number;
  records: number;
}

/** A discovered correlation between two subjects' exam grades. */
export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
  commonStudents: number;
}

/** All the descriptive trends surfaced while training. */
export interface Trends {
  attendanceBySemester: { semester: number; avgAttendance: number; records: number }[];
  passRateBySemester: { semester: number; passRate: number }[];
  subjectStats: SubjectStat[];
  highAttendanceSubjects: SubjectStat[];
  examGradeHistogram: { grade: number; count: number }[];
  topCorrelations: CorrelationPair[];
  correlationMatrix: { subjects: string[]; matrix: number[][] };
}

/** The serialisable trained model. */
export interface TrainedModel {
  version: number;
  trainedAt: string;
  featureNames: string[];
  /** per-feature standardisation */
  means: number[];
  stds: number[];
  /** regression weights, last entry is the bias term */
  weights: number[];
  globalExamMean: number;
  globalAttendanceMean: number;
  globalWorkMean: number;
  subjects: Record<string, { avgExam: number; avgAttendance: number; avgWork: number; difficulty: Difficulty }>;
  passThreshold: number;
  metrics: {
    trainRows: number;
    students: number;
    mae: number;
    rmse: number;
    examAccuracy: number;
  };
  trends: Trends;
}

export type RiskLevel = 'high' | 'medium' | 'low';

/** A single predicted (student, subject) outcome for the upcoming session. */
export interface SubjectPrediction {
  subject: string;
  semester: number;
  predictedExam: number;
  predictedPass: boolean;
  risk: RiskLevel;
}

/** Per-student roll-up of predictions, used to flag at-risk students. */
export interface StudentPrediction {
  studentId: string;
  group: string;
  risk: RiskLevel;
  predictedFailCount: number;
  avgPredictedExam: number;
  minPredictedExam: number;
  avgHistoricalAttendance: number;
  avgHistoricalExam: number;
  subjects: SubjectPrediction[];
}

export interface PredictionSummary {
  totalStudents: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  predictedFailSubjects: number;
  students: StudentPrediction[];
}
