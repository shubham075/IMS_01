/**
 * A small, strict CSV reader (RFC 4180 quoting) for shop spreadsheets. Excel in India often saves with a byte-order mark,
 * semicolons, or CRLF; all are handled. Formulas are never evaluated: cells are plain text.
 */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  delimiter: string;
}

export class CsvError extends Error {
  constructor(
    readonly code:
      | "EMPTY"
      | "UNCLOSED_QUOTE"
      | "BINARY"
      | "TOO_MANY_ROWS"
      | "TOO_MANY_COLUMNS"
      | "CELL_TOO_LONG",
    message: string,
  ) {
    super(message);
  }
}

const MAX_COLUMNS = 40;
const MAX_CELL = 500;

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(input: string, maxRows: number): ParsedCsv {
  // NUL and most control characters mean this is not a text file (e.g. an .xlsx renamed to .csv).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting binary content is the point
  if (/[\u0000-\u0008\u000e-\u001f]/.test(input)) {
    throw new CsvError("BINARY", "This does not look like a CSV text file.");
  }
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") throw new CsvError("EMPTY", "The file is empty.");
  const delimiter = detectDelimiter(text.slice(0, text.search(/\r?\n|$/)));

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  const endCell = () => {
    if (cell.length > MAX_CELL) throw new CsvError("CELL_TOO_LONG", "A cell is too long.");
    row.push(wasQuoted ? cell : cell.trim());
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    if (row.length > MAX_COLUMNS) throw new CsvError("TOO_MANY_COLUMNS", "Too many columns.");
    if (!(row.length === 1 && row[0] === "")) rows.push(row); // skip blank lines
    row = [];
    if (rows.length > maxRows + 1) throw new CsvError("TOO_MANY_ROWS", "Too many rows.");
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
      wasQuoted = true;
    } else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw new CsvError("UNCLOSED_QUOTE", "A quoted cell is not closed.");
  if (cell !== "" || row.length > 0) endRow();

  const [header, ...rest] = rows;
  if (!header) throw new CsvError("EMPTY", "The file is empty.");
  return { header: header.map((h) => h.trim()), rows: rest.map((r) => r.map((c) => c.trim())), delimiter };
}
