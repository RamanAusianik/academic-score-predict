import { Difficulty, PerfRow } from './types';

/** Minimal RFC-4180-ish CSV parser (handles quotes, commas and CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  // strip a leading BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore; handled by the following \n
    } else {
      field += c;
    }
  }
  // flush trailing field/row (file may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toNumber(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDifficulty(value: string | undefined): Difficulty {
  const v = (value || '').trim().toLowerCase();
  if (v === 'easy' || v === 'hard') return v;
  return 'normal';
}

/**
 * Parse a performance CSV into typed rows.
 * Expects the columns produced by data/generate-data.js (header is matched by name).
 */
export function parsePerfCsv(text: string): PerfRow[] {
  const table = parseCsv(text).filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  if (table.length < 2) return [];

  const header = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const cId = idx('student_id');
  const cGroup = idx('group');
  const cCohort = idx('cohort_entry_year');
  const cSubject = idx('subject');
  const cDiff = idx('difficulty');
  const cReq = idx('requires_attendance');
  const cTotal = idx('subject_total_semesters');
  const cSem = idx('semester');
  const cAttn = idx('attendance_pct');
  const cExam = idx('exam');
  const workCols = ['work1', 'work2', 'work3', 'work4', 'work5'].map(idx);

  const out: PerfRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cols = table[r];
    if (cId < 0 || cols[cId] === undefined || cols[cId].trim() === '') continue;

    const examRaw = cExam >= 0 ? (cols[cExam] ?? '').trim() : '';
    const exam = examRaw === '' ? null : toNumber(examRaw);

    out.push({
      studentId: cols[cId].trim(),
      group: cGroup >= 0 ? (cols[cGroup] ?? '').trim() : '',
      cohortEntryYear: cCohort >= 0 ? toNumber(cols[cCohort]) : 0,
      subject: cSubject >= 0 ? (cols[cSubject] ?? '').trim() : '',
      difficulty: parseDifficulty(cols[cDiff]),
      requiresAttendance: cReq >= 0 ? toNumber(cols[cReq]) === 1 : false,
      subjectTotalSemesters: cTotal >= 0 ? toNumber(cols[cTotal]) : 1,
      semester: cSem >= 0 ? toNumber(cols[cSem]) : 1,
      attendance: cAttn >= 0 ? toNumber(cols[cAttn]) : 0,
      work: workCols.map((c) => (c >= 0 ? toNumber(cols[c]) : 0)),
      exam,
    });
  }
  return out;
}
