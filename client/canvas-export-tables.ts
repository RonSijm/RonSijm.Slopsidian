/** Bounded inert pipe-table parsing. Escaped pipes and pipes inside matched code spans are cell text. */
export const canvasTableExportLimits = Object.freeze({ tables: 8, columns: 8, rows: 32, cells: 256, cellCharacters: 1024, cellLines: 16, minimumColumnWidth: 40 });
export interface CanvasPipeTable { readonly rows: readonly (readonly string[])[]; readonly alignments: readonly ("left" | "center" | "right")[]; readonly end: number }
export type CanvasPipeTableResult = { readonly table: CanvasPipeTable; readonly end: number; readonly fallback?: never } | { readonly fallback: string; readonly end: number; readonly table?: never };

export function splitCanvasPipeRow(input: string): { cells: string[]; pipes: number } {
  const text = input.trim(), cells: string[] = []; let cell = "", ticks = 0, pipes = 0;
  for (let at = 0; at < text.length;) {
    if (text[at] === "\\" && at + 1 < text.length) { if (text[at + 1] === "|") { cell += "|"; } else { cell += text.slice(at, at + 2); } at += 2; continue; }
    if (text[at] === "`") {
      let end = at + 1; while (text[end] === "`") { end++; } const count = end - at;
      if (ticks === count) { ticks = 0; } else if (!ticks && text.indexOf("`".repeat(count), end) >= 0) { ticks = count; }
      cell += text.slice(at, end); at = end; continue;
    }
    if (text[at] === "|" && !ticks) { cells.push(cell.trim()); cell = ""; pipes++; } else { cell += text[at]; } at++;
  }
  cells.push(cell.trim());
  if (text.startsWith("|")) { cells.shift(); }
  if (text.endsWith("|") && cells.at(-1) === "" && /(?:^|[^\\])(?:\\\\)*\|$/.test(text)) { cells.pop(); }
  return { cells, pipes };
}

/** Recognition needs a header pipe and a complete delimiter row; malformed candidates remain literal. */
export function readCanvasPipeTable(lines: readonly string[], start: number): CanvasPipeTableResult | null {
  if (start + 1 >= lines.length || /^ {4}|^\t/.test(lines[start])) { return null; }
  const header = splitCanvasPipeRow(lines[start]), delimiter = splitCanvasPipeRow(lines[start + 1]);
  if (!header.pipes || !delimiter.cells.length || !delimiter.cells.every(cell => /^:?-{3,}:?$/.test(cell))) { return null; }
  const rows = [header.cells]; let end = start + 2;
  while (end < lines.length && lines[end].trim() && !/^ {4}|^\t/.test(lines[end])) { const row = splitCanvasPipeRow(lines[end]); if (!row.pipes) { break; } rows.push(row.cells); end++; }
  const fallback = (message: string): CanvasPipeTableResult => ({ end, fallback: message + " The complete table stays literal." });
  if (header.cells.length !== delimiter.cells.length || rows.some(row => row.length !== header.cells.length)) { return fallback("Table rows need the same number of cells as their header."); }
  if (header.cells.length > canvasTableExportLimits.columns || rows.length > canvasTableExportLimits.rows || rows.length * header.cells.length > canvasTableExportLimits.cells) { return fallback("Table formatting supports at most eight columns, 32 rows including the header and 256 cells."); }
  if (rows.some(row => row.some(cell => cell.length > canvasTableExportLimits.cellCharacters))) { return fallback("Table cells support at most 1,024 source characters."); }
  if (rows.some(row => row.some(cell => /<\/?[A-Za-z!][^>]*>|!\[|\[\[|\]\[|\$\$|\$[^$]+\$/.test(cell)))) { return fallback("HTML, media, wiki links, reference links and math are not formatted inside table cells."); }
  return { end, table: Object.freeze({ rows: Object.freeze(rows.map(row => Object.freeze(row))), alignments: Object.freeze(delimiter.cells.map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left")), end }) };
}
