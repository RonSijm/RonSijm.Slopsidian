import type { BaseResult } from "./bases-model";

export const BASE_EXPORT_MAX_ROWS = 2000;
export const BASE_EXPORT_MAX_CELLS = 100000;
export const BASE_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
export interface BaseExportTable { readonly headers: readonly string[]; readonly rows: readonly (readonly { readonly text: string; readonly number: boolean }[])[]; readonly matched: number; readonly warnings: readonly string[] }
export interface BaseExportText { readonly text: string; readonly bytes: number; readonly protectedCells: number; readonly format: "csv" | "tsv" }
const overflow = (): Error => new Error("Export supports at most 2,000 rows, 100,000 cells and 2 MiB of UTF-8 output. Narrow the view or its limit; no partial file was produced.");
function checkedText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 65536 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) { throw new Error("An export cell is outside the supported text subset."); }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) { throw new Error("An export cell contains an incomplete Unicode character."); } }
    else if (code >= 0xdc00 && code <= 0xdfff) { throw new Error("An export cell contains an incomplete Unicode character."); }
  }
}

/** Copy an explicitly complete query; a page or query error can never become an export. */
export function baseExportTable(result: BaseResult): BaseExportTable {
  if (result.exported !== true || result.rows.length !== result.total || result.errors.length || !Number.isSafeInteger(result.total) || result.total < 0) { throw new Error("A complete, error-free current query is required for export. Refresh or fix the view first."); }
  if (result.total > BASE_EXPORT_MAX_ROWS || (result.total + 1) * result.columns.length > BASE_EXPORT_MAX_CELLS) { throw overflow(); }
  const headers = result.columns.map(column => { checkedText(column.label); return column.label; });
  const rows = result.rows.map(row => {
    if (row.cells.length !== headers.length) { throw new Error("The export query has inconsistent columns."); }
    return Object.freeze(row.cells.map(cell => {
      checkedText(cell.text); if (cell.error) { throw new Error("Query errors cannot be exported as successful values."); }
      // Link controls show their path when their display label is empty.
      const text = cell.text || cell.link || ""; checkedText(text);
      return Object.freeze({ text, number: cell.exportNumber === true && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)) });
    }));
  });
  return Object.freeze({ headers: Object.freeze(headers), rows: Object.freeze(rows), matched: result.matched, warnings: Object.freeze([...result.warnings]) });
}

/** Display text, LF records, delimiter-aware quoting. This is not a typed import format. */
export function serializeBaseExport(table: BaseExportTable, format: "csv" | "tsv", protect = true): BaseExportText {
  if (format !== "csv" && format !== "tsv" || typeof protect !== "boolean") { throw new Error("Choose CSV or TSV export."); }
  const delimiter = format === "csv" ? "," : "\t", lines: string[] = [], encoder = new TextEncoder(); let bytes = 0, protectedCells = 0;
  if (table.rows.length > BASE_EXPORT_MAX_ROWS || (table.rows.length + 1) * table.headers.length > BASE_EXPORT_MAX_CELLS) { throw overflow(); }
  const line = (values: readonly { text: string; number: boolean }[]): void => {
    if (values.length !== table.headers.length) { throw new Error("The export query has inconsistent columns."); }
    const encoded = values.map(value => {
      checkedText(value.text); let text = value.text;
      // Genuine numeric query values stay numeric. Text/link/list/header markers are explicit.
      if (protect && !value.number && (/^[\t\r\n]/.test(text) || /^[\x00-\x20\ufeff]*[=+\-@]/.test(text))) { text = "'" + text; protectedCells++; }
      return text.includes(delimiter) || /["\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
    }).join(delimiter);
    bytes += encoder.encode(encoded).byteLength + (lines.length ? 1 : 0); if (bytes > BASE_EXPORT_MAX_BYTES) { throw overflow(); } lines.push(encoded);
  };
  line(table.headers.map(text => ({ text, number: false }))); for (const row of table.rows) { line(row); }
  return Object.freeze({ text: lines.join("\n"), bytes, protectedCells, format });
}

export function baseExportFilename(name: string): string { return "base-" + name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").slice(0, 120) + ".csv"; }

