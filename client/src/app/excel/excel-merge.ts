import ExcelJS from 'exceljs';

/** Salad green header fill from data/1.xlsx and data/2.xlsx (fgColor rgb FF92D050). */
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF92D050' },
};

/** Turquoise separator line between merged file sections. */
const TURQUOISE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF00B0B0' },
};

/** Header block spans rows 1–3 in the source templates (merged title/sub-header area). */
const HEADER_BLOCK_ROWS = 3;

/** Column B (0-based index 1) holds section / grand total labels in the templates. */
const LABEL_COL_INDEX = 1;

type RowKind = 'data' | 'separator-turquoise' | 'separator-green';

interface StyledCell {
  value: ExcelJS.CellValue;
  style?: Partial<ExcelJS.Style>;
}

export interface StyledRow {
  cells: StyledCell[];
  height?: number;
  kind?: RowKind;
}

interface ParsedSheet {
  rows: StyledRow[];
  merges: string[];
}

interface MergeResult {
  rows: StyledRow[];
  merges: string[];
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

function extractStyle(cell: ExcelJS.Cell): Partial<ExcelJS.Style> | undefined {
  const style: Partial<ExcelJS.Style> = {};
  if (cell.fill) style.fill = JSON.parse(JSON.stringify(cell.fill));
  if (cell.font) style.font = JSON.parse(JSON.stringify(cell.font));
  if (cell.border) style.border = JSON.parse(JSON.stringify(cell.border));
  if (cell.alignment) style.alignment = JSON.parse(JSON.stringify(cell.alignment));
  if (cell.numFmt) style.numFmt = cell.numFmt;
  return Object.keys(style).length ? style : undefined;
}

function applyStyle(cell: ExcelJS.Cell, style?: Partial<ExcelJS.Style>): void {
  if (!style) return;
  if (style.font) cell.font = style.font;
  if (style.border) cell.border = style.border;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.numFmt) cell.numFmt = style.numFmt;
  if (style.fill) cell.fill = style.fill;
}

function applyHeaderStyle(cell: ExcelJS.Cell, style?: Partial<ExcelJS.Style>): void {
  if (style?.font) cell.font = style.font;
  if (style?.border) cell.border = style.border;
  if (style?.alignment) cell.alignment = style.alignment;
  if (style?.numFmt) cell.numFmt = style.numFmt;
  cell.fill = HEADER_FILL;
}

function applyTurquoiseStyle(cell: ExcelJS.Cell): void {
  cell.fill = TURQUOISE_FILL;
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

/** Locate the «Всего» / «Итого» column from the header block. */
function findTotalColumnIndex(headerBlock: StyledRow[]): number {
  for (const row of headerBlock) {
    for (let c = 0; c < row.cells.length; c++) {
      const text = cellText(row.cells[c].value).toLowerCase();
      if (text === 'всего' || text === 'итого') return c;
    }
  }
  return headerBlock[0]?.cells.length ? headerBlock[0].cells.length - 1 : 0;
}

function isSectionTotalRow(row: StyledRow): boolean {
  return cellText(row.cells[LABEL_COL_INDEX]?.value ?? '')
    .toLowerCase()
    .includes('итого');
}

function createEmptyFilledRow(colCount: number, kind: RowKind): StyledRow {
  return {
    kind,
    cells: Array.from({ length: colCount }, () => ({ value: '' })),
  };
}

function createGrandTotalRow(colCount: number, columnSums: number[], hasNumeric: boolean[]): StyledRow {
  const cells: StyledCell[] = Array.from({ length: colCount }, () => ({ value: '' }));
  cells[LABEL_COL_INDEX] = { value: 'ИТОГО' };
  for (let c = 0; c < colCount; c++) {
    if (c === LABEL_COL_INDEX) continue;
    if (hasNumeric[c]) cells[c] = { value: columnSums[c] };
  }
  return { kind: 'separator-green', cells };
}

/** Find the last «Итого» row in a file; it must contain a number in the total column. */
function findSectionTotalRow(
  rows: StyledRow[],
  totalCol: number,
  fileLabel: string
): StyledRow {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!isSectionTotalRow(rows[i])) continue;
    const n = numericValue(rows[i].cells[totalCol]?.value ?? null);
    if (n !== null) return rows[i];
  }
  throw new Error(`${fileLabel}: не найдена строка «Итого» с числовым значением в колонке «Всего».`);
}

/** Sum each numeric column across per-file «Итого» rows (same rule as the grand total). */
function sumColumnsFromSectionRows(
  sectionRows: StyledRow[],
  colCount: number
): { sums: number[]; hasNumeric: boolean[] } {
  const sums = new Array<number>(colCount).fill(0);
  const hasNumeric = new Array<boolean>(colCount).fill(false);

  for (const row of sectionRows) {
    for (let c = 0; c < colCount; c++) {
      const n = numericValue(row.cells[c]?.value ?? null);
      if (n === null) continue;
      sums[c] += n;
      hasNumeric[c] = true;
    }
  }

  return { sums, hasNumeric };
}

function rowsEqual(a: StyledRow, b: StyledRow): boolean {
  const len = Math.max(a.cells.length, b.cells.length);
  for (let i = 0; i < len; i++) {
    if (cellText(a.cells[i]?.value ?? '') !== cellText(b.cells[i]?.value ?? '')) return false;
  }
  return true;
}

function colLettersToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numberToColLetters(n: number): string {
  let s = '';
  let value = n;
  while (value > 0) {
    const rem = (value - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    value = Math.floor((value - 1) / 26);
  }
  return s;
}

function parseCellRef(ref: string): { col: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim());
  if (!match) throw new Error(`Некорректная ссылка на ячейку: ${ref}`);
  return { col: colLettersToNumber(match[1]), row: Number(match[2]) };
}

function parseMergeRange(ref: string): { top: number; left: number; bottom: number; right: number } {
  const parts = ref.split(':');
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1] ?? parts[0]);
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.col, end.col),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.col, end.col),
  };
}

function mergeRef(top: number, left: number, bottom: number, right: number): string {
  const a = `${numberToColLetters(left)}${top}`;
  const b = `${numberToColLetters(right)}${bottom}`;
  return top === bottom && left === right ? a : `${a}:${b}`;
}

function offsetMerge(ref: string, rowOffset: number): string {
  const { top, left, bottom, right } = parseMergeRange(ref);
  return mergeRef(top + rowOffset, left, bottom + rowOffset, right);
}

function mergeWithinHeaderBlock(ref: string): boolean {
  const { bottom } = parseMergeRange(ref);
  return bottom <= HEADER_BLOCK_ROWS;
}

async function readStyledSheet(data: ArrayBuffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { rows: [], merges: [] };

  let maxCol = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
  });
  if (maxCol === 0) return { rows: [], merges: [] };

  const rows: StyledRow[] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells: StyledCell[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      cells.push({
        value: cell.value ?? '',
        style: extractStyle(cell),
      });
    }
    rows.push({ cells, height: row.height, kind: 'data' });
  }

  const merges = [...(worksheet.model.merges ?? [])];
  return { rows, merges };
}

/**
 * Merge sheets with a shared header block (rows 1–3):
 * header once from the first file + content rows from file 1, then file 2, …
 * Files 2+ drop their duplicate header block entirely.
 */
export function mergeStyledSheets(sheets: ParsedSheet[]): MergeResult {
  if (sheets.length === 0) {
    throw new Error('Не выбрано ни одного файла.');
  }

  const mergedRows: StyledRow[] = [];
  const mergedMerges: string[] = [];
  const seenMerges = new Set<string>();
  let headerBlock: StyledRow[] | null = null;
  let maxCol = 0;
  let totalCol = 0;
  const fileSectionRows: StyledRow[] = [];

  const addMerge = (ref: string) => {
    if (seenMerges.has(ref)) return;
    seenMerges.add(ref);
    mergedMerges.push(ref);
  };

  for (let fileIdx = 0; fileIdx < sheets.length; fileIdx++) {
    const sheet = sheets[fileIdx];
    if (sheet.rows.length === 0) continue;
    maxCol = Math.max(maxCol, ...sheet.rows.map((r) => r.cells.length));

    if (fileIdx > 0 && sheet.rows.length <= HEADER_BLOCK_ROWS) {
      throw new Error(`Файл №${fileIdx + 1} содержит только заголовок, данных для объединения нет.`);
    }

    const fileHeaderBlock = sheet.rows.slice(0, HEADER_BLOCK_ROWS);
    if (!headerBlock) {
      headerBlock = fileHeaderBlock;
      totalCol = findTotalColumnIndex(headerBlock);
    } else {
      for (let h = 0; h < HEADER_BLOCK_ROWS; h++) {
        if (!rowsEqual(headerBlock[h], fileHeaderBlock[h])) {
          throw new Error(
            `Заголовок в файле №${fileIdx + 1} не совпадает с первым файлом. Объединение возможно только при одинаковых заголовках.`
          );
        }
      }
    }

    const fileContent = fileIdx === 0 ? sheet.rows : sheet.rows.slice(HEADER_BLOCK_ROWS);
    fileSectionRows.push(findSectionTotalRow(fileContent, totalCol, `Файл №${fileIdx + 1}`));

    if (fileIdx > 0) {
      mergedRows.push(createEmptyFilledRow(maxCol, 'separator-turquoise'));
    }

    const outputStartRow = mergedRows.length + 1;

    if (fileIdx === 0) {
      mergedRows.push(...sheet.rows);
      for (const ref of sheet.merges) addMerge(ref);
      continue;
    }

    mergedRows.push(...sheet.rows.slice(HEADER_BLOCK_ROWS));

    const rowOffset = outputStartRow - (HEADER_BLOCK_ROWS + 1);
    for (const ref of sheet.merges) {
      if (mergeWithinHeaderBlock(ref)) continue;
      addMerge(offsetMerge(ref, rowOffset));
    }
  }

  if (mergedRows.length === 0) {
    throw new Error('Выбранные файлы не содержат данных.');
  }

  if (headerBlock) {
    const { sums, hasNumeric } = sumColumnsFromSectionRows(fileSectionRows, maxCol);
    mergedRows.push(createGrandTotalRow(maxCol, sums, hasNumeric));
  }

  return { rows: mergedRows, merges: mergedMerges };
}

async function writeStyledXlsx(rows: StyledRow[], merges: string[], sheetName = 'Sheet1'): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  rows.forEach((row, rowIndex) => {
    const excelRow = worksheet.getRow(rowIndex + 1);
    if (row.height) excelRow.height = row.height;

    row.cells.forEach((styledCell, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = styledCell.value;

      if (row.kind === 'separator-turquoise') {
        applyTurquoiseStyle(cell);
      } else if (row.kind === 'separator-green') {
        applyHeaderStyle(cell, styledCell.style);
      } else if (rowIndex < HEADER_BLOCK_ROWS) {
        applyHeaderStyle(cell, styledCell.style);
      } else {
        applyStyle(cell, styledCell.style);
      }
    });
    excelRow.commit();
  });

  for (const ref of merges) {
    try {
      worksheet.mergeCells(ref);
    } catch {
      // Ignore overlapping / duplicate merge declarations.
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/** Merge several .xlsx buffers into one styled .xlsx buffer. */
export async function mergeXlsxBuffers(buffers: ArrayBuffer[]): Promise<ArrayBuffer> {
  const sheets = await Promise.all(buffers.map(readStyledSheet));
  const { rows, merges } = mergeStyledSheets(sheets);
  return writeStyledXlsx(rows, merges);
}
