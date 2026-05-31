import ExcelJS from 'exceljs';

/** Salad green header fill from data/1.xlsx and data/2.xlsx (fgColor rgb FF92D050). */
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF92D050' },
};

/** Header block spans rows 1–3 in the source templates (merged title/sub-header area). */
const HEADER_BLOCK_ROWS = 3;

interface StyledCell {
  value: ExcelJS.CellValue;
  style?: Partial<ExcelJS.Style>;
}

export interface StyledRow {
  cells: StyledCell[];
  height?: number;
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
    rows.push({ cells, height: row.height });
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

  const addMerge = (ref: string) => {
    if (seenMerges.has(ref)) return;
    seenMerges.add(ref);
    mergedMerges.push(ref);
  };

  for (let fileIdx = 0; fileIdx < sheets.length; fileIdx++) {
    const sheet = sheets[fileIdx];
    if (sheet.rows.length === 0) continue;

    if (fileIdx > 0 && sheet.rows.length <= HEADER_BLOCK_ROWS) {
      throw new Error(`Файл №${fileIdx + 1} содержит только заголовок, данных для объединения нет.`);
    }

    const fileHeaderBlock = sheet.rows.slice(0, HEADER_BLOCK_ROWS);
    if (!headerBlock) {
      headerBlock = fileHeaderBlock;
    } else {
      for (let h = 0; h < HEADER_BLOCK_ROWS; h++) {
        if (!rowsEqual(headerBlock[h], fileHeaderBlock[h])) {
          throw new Error(
            `Заголовок в файле №${fileIdx + 1} не совпадает с первым файлом. Объединение возможно только при одинаковых заголовках.`
          );
        }
      }
    }

    const outputStartRow = mergedRows.length + 1;

    if (fileIdx === 0) {
      mergedRows.push(...sheet.rows);
      for (const ref of sheet.merges) addMerge(ref);
      continue;
    }

    // Subsequent files: skip the duplicate header block (rows 1–3), append content only.
    mergedRows.push(...sheet.rows.slice(HEADER_BLOCK_ROWS));

    // First content row in source is HEADER_BLOCK_ROWS + 1 (Excel row 4).
    const rowOffset = outputStartRow - (HEADER_BLOCK_ROWS + 1);
    for (const ref of sheet.merges) {
      if (mergeWithinHeaderBlock(ref)) continue;
      addMerge(offsetMerge(ref, rowOffset));
    }
  }

  if (mergedRows.length === 0) {
    throw new Error('Выбранные файлы не содержат данных.');
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
      if (rowIndex < HEADER_BLOCK_ROWS) {
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
