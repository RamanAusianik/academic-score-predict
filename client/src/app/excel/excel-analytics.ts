import ExcelJS from 'exceljs';

const HEADER_BLOCK_ROWS = 3;
const SUBJECT_COL = 1;
const GROUP_COL = 2;
export interface DebtBarItem {
  label: string;
  value: number;
}

export interface ExcelDebtStats {
  byGroup: DebtBarItem[];
  bySubject: DebtBarItem[];
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('text' in value && value.text !== undefined) return String(value.text).trim();
    if (value instanceof Date) return value.toISOString();
  }
  return String(value).trim();
}

function numericValue(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isSectionTotalRow(cells: ExcelJS.CellValue[]): boolean {
  return cellText(cells[SUBJECT_COL]).toLowerCase().includes('итого');
}

function findTotalColumnIndex(headerRows: ExcelJS.CellValue[][]): number {
  for (const row of headerRows) {
    for (let c = 0; c < row.length; c++) {
      const text = cellText(row[c]).toLowerCase();
      if (text === 'всего' || text === 'итого') return c;
    }
  }
  return headerRows[0]?.length ? headerRows[0].length - 1 : 0;
}

function isGroupNumber(text: string): boolean {
  return /^\d+$/.test(text.replace(/\s/g, ''));
}

function debtFromRow(cells: ExcelJS.CellValue[], totalCol: number): number {
  const total = numericValue(cells[totalCol] ?? null);
  if (total !== null) return total;

  let sum = 0;
  for (let c = 3; c < totalCol; c++) {
    const n = numericValue(cells[c] ?? null);
    if (n !== null) sum += n;
  }
  return sum;
}

function sortedEntries(map: Map<string, number>): DebtBarItem[] {
  return [...map.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .map(([label, value]) => ({ label, value }));
}

async function readSheetRows(data: ArrayBuffer): Promise<ExcelJS.CellValue[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let maxCol = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
  });
  if (maxCol === 0) return [];

  const rows: ExcelJS.CellValue[][] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells: ExcelJS.CellValue[] = [];
    for (let c = 1; c <= maxCol; c++) {
      cells.push(row.getCell(c).value ?? '');
    }
    rows.push(cells);
  }
  return rows;
}

/** Aggregate debts by group and subject across selected .xlsx files. */
export async function analyzeDebtsFromFiles(buffers: ArrayBuffer[]): Promise<ExcelDebtStats> {
  const byGroup = new Map<string, number>();
  const bySubject = new Map<string, number>();

  for (const buffer of buffers) {
    const rows = await readSheetRows(buffer);
    if (rows.length <= HEADER_BLOCK_ROWS) continue;

    const header = rows.slice(0, HEADER_BLOCK_ROWS);
    const totalCol = findTotalColumnIndex(header);

    for (const cells of rows.slice(HEADER_BLOCK_ROWS)) {
      if (isSectionTotalRow(cells)) continue;

      const group = cellText(cells[GROUP_COL] ?? '');
      const subject = cellText(cells[SUBJECT_COL] ?? '');
      if (!isGroupNumber(group) || !subject) continue;

      const debt = debtFromRow(cells, totalCol);
      if (debt <= 0) continue;

      byGroup.set(group, (byGroup.get(group) ?? 0) + debt);
      bySubject.set(subject, (bySubject.get(subject) ?? 0) + debt);
    }
  }

  return {
    byGroup: sortedEntries(byGroup),
    bySubject: sortedEntries(bySubject),
  };
}
