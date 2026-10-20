import { canvasTableExportLimits, readCanvasPipeTable, type CanvasPipeTable } from "./canvas-export-tables";

/** A deliberately small, inert Markdown-to-SVG text layout. No DOM or resource readers. */
export const canvasMarkdownExportLimits = Object.freeze({ cards: 64, characters: 16_384, totalCharacters: 524_288, sourceLines: 512, pieces: 1024, totalPieces: 8192, depth: 8, visibleLines: 128 });
export interface CanvasMarkdownRun { readonly text: string; readonly bold?: boolean; readonly italic?: boolean; readonly code?: boolean; readonly strike?: boolean }
export interface CanvasMarkdownLine { readonly runs: readonly CanvasMarkdownRun[]; readonly size: number; readonly y: number; readonly indent: number; readonly quote: boolean; readonly code: boolean }
export interface CanvasMarkdownTableCell { readonly lines: readonly (readonly CanvasMarkdownRun[])[]; readonly align: "left" | "center" | "right" }
export interface CanvasMarkdownTableRow { readonly y: number; readonly height: number; readonly cells: readonly CanvasMarkdownTableCell[]; readonly header: boolean }
export interface CanvasMarkdownTable { readonly width: number; readonly columnWidth: number; readonly rows: readonly CanvasMarkdownTableRow[] }
export interface CanvasMarkdownLayout { readonly lines: readonly CanvasMarkdownLine[]; readonly warnings: readonly string[]; readonly clipped: boolean; readonly pieces: number; readonly characters: number; readonly tables?: readonly CanvasMarkdownTable[] }
type Style = Omit<CanvasMarkdownRun, "text">;
const xml = (value: string): string => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);

function clean(source: string, warnings: Set<string>): string {
  if (source.length > canvasMarkdownExportLimits.characters) { warnings.add("Only the first 16,384 source characters are formatted."); }
  return Array.from(source.slice(0, canvasMarkdownExportLimits.characters)).map(character => {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufffe\uffff]/.test(character)) { warnings.add("Control, bidirectional-formatting and malformed Unicode characters are shown as �."); return "�"; }
    return character;
  }).join("").replace(/\r\n?|\u0085|\u2028|\u2029/g, "\n");
}

/** Common inline delimiters only. All destinations remain inert labels; no URLs enter SVG. */
function inline(source: string, style: Style, budget: { pieces: number }, depth = 0): CanvasMarkdownRun[] {
  if (depth > canvasMarkdownExportLimits.depth) { throw new Error("Formatted Markdown nesting exceeds eight levels. Use literal export."); }
  const result: CanvasMarkdownRun[] = [];
  const push = (text: string, extra = style): void => {
    if (!text) { return; } const prior = result.at(-1);
    if (prior && Boolean(prior.bold) === Boolean(extra.bold) && Boolean(prior.italic) === Boolean(extra.italic) && Boolean(prior.code) === Boolean(extra.code) && Boolean(prior.strike) === Boolean(extra.strike)) { result[result.length - 1] = { ...prior, text: prior.text + text }; return; }
    if (++budget.pieces > canvasMarkdownExportLimits.pieces) { throw new Error("Formatted Markdown exceeds 1,024 inline pieces per card. Use literal export or a smaller section."); }
    result.push({ text, ...extra });
  };
  for (let index = 0; index < source.length;) {
    const tail = source.slice(index);
    const escape = /^\\([\\`*_[\]{}()#+.!~>|-])/.exec(tail);
    if (escape) { push(escape[1]); index += escape[0].length; continue; }
    const ticks = /^`+/.exec(tail);
    if (ticks) {
      const end = source.indexOf(ticks[0], index + ticks[0].length);
      if (end >= 0 && source[end + ticks[0].length] !== "`") { push(source.slice(index + ticks[0].length, end).replace(/^ (.*) $/, "$1"), { ...style, code: true }); index = end + ticks[0].length; continue; }
    }
    const link = /^\[([^\]\n]{1,512})\]\(([^()\n]{0,2048})\)/.exec(tail);
    if (link) { for (const run of inline(link[1], style, budget, depth + 1)) { push(run.text, run); } index += link[0].length; continue; }
    let handled = false;
    for (const [delimiter, extra] of [["**", { bold: true }], ["__", { bold: true }], ["~~", { strike: true }], ["*", { italic: true }], ["_", { italic: true }]] as const) {
      if (!tail.startsWith(delimiter) || delimiter === "_" && index > 0 && /[\p{L}\p{N}]/u.test(source[index - 1])) { continue; }
      const start = index + delimiter.length, end = source.indexOf(delimiter, start);
      if (end <= start || /\s/.test(source[start]) || /\s/.test(source[end - 1])) { continue; }
      for (const run of inline(source.slice(start, end), { ...style, ...extra }, budget, depth + 1)) { push(run.text, run); }
      index = end + delimiter.length; handled = true; break;
    }
    if (handled) { continue; }
    const point = source.codePointAt(index)!, character = String.fromCodePoint(point); push(character); index += character.length;
  }
  return result;
}

function advance(character: string, size: number, code: boolean): number {
  if (/\p{Mark}/u.test(character)) { return 0; }
  const point = character.codePointAt(0)!;
  if (point >= 0x2e80 || point >= 0x1f000) { return size; }
  return size * (code ? 0.64 : character === " " ? 0.34 : /[ilI.,'`:;!|]/.test(character) ? 0.34 : /[MW@%]/.test(character) ? 0.88 : 0.61);
}

export function layoutCanvasExportMarkdown(source: string, width: number, height: number, sourceWasClipped = false, sourceHadUnicodeReplacements = false): CanvasMarkdownLayout {
  if (typeof source !== "string" || !Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) { throw new Error("Invalid formatted Canvas text geometry."); }
  const warnings = new Set<string>();
  if (sourceWasClipped) { warnings.add("Only the first 16,384 source characters are formatted."); }
  if (sourceHadUnicodeReplacements) { warnings.add("Malformed Unicode in the captured text is shown as �."); }
  const normalized = clean(source, warnings), raw = normalized.split("\n"), lines: CanvasMarkdownLine[] = [], budget = { pieces: 0 };
  if (raw.length > canvasMarkdownExportLimits.sourceLines) { throw new Error("Formatted Markdown exceeds 512 source lines per card. Use literal export or a smaller section."); }
  const tables: CanvasMarkdownTable[] = []; let tableCount = 0, tableLines = 0;
  let y = 0, clipped = sourceWasClipped || source.length > canvasMarkdownExportLimits.characters, fence: { marker: string; length: number } | null = null, literalFence = false;
  const line = (runs: readonly CanvasMarkdownRun[], size: number, indent: number, quote: boolean, code: boolean): void => {
    const available = Math.max(1, width - indent), rowHeight = Math.ceil(size * 1.45); let row: CanvasMarkdownRun[] = [], used = 0;
    const finish = (): void => { y += rowHeight; if (y > height || lines.length + tableLines >= canvasMarkdownExportLimits.visibleLines) { clipped = true; } else { lines.push(Object.freeze({ runs: Object.freeze(row.map(run => Object.freeze(run))), size, y: y - Math.ceil(size * 0.2), indent, quote, code })); } row = []; used = 0; };
    for (const run of runs) {
      for (const character of Array.from(run.text.replaceAll("\t", "    "))) {
        const amount = advance(character, size, code || Boolean(run.code)); if (used && used + amount > available) { finish(); }
        const prior = row.at(-1);
        if (prior && Boolean(prior.bold) === Boolean(run.bold) && Boolean(prior.italic) === Boolean(run.italic) && Boolean(prior.code) === Boolean(run.code) && Boolean(prior.strike) === Boolean(run.strike)) { row[row.length - 1] = { ...prior, text: prior.text + character }; }
        else { row.push({ ...run, text: character }); }
        used += amount;
      }
    }
    finish();
  };
  const table = (input: CanvasPipeTable): void => {
    const columnWidth = width / input.alignments.length, rows: CanvasMarkdownTableRow[] = []; let omitted = false;
    if (input.rows.some(row => row.some(value => value.includes("\t")))) { warnings.add("Tabs are expanded to four spaces."); }
    const ellipsis = (row: CanvasMarkdownRun[]): void => {
      const measure = (): number => row.reduce((sum, run) => sum + Array.from(run.text).reduce((width, character) => width + advance(character, 12, Boolean(run.code)), 0), 0);
      const available = columnWidth - 12 - advance("…", 12, false);
      while (row.length && measure() > available) { const last = row.at(-1)!, characters = Array.from(last.text); characters.pop(); if (characters.length) { row[row.length - 1] = { ...last, text: characters.join("") }; } else { row.pop(); } }
      row.push({ text: "…" });
    };
    const cell = (text: string, header: boolean, align: CanvasMarkdownTableCell["align"]): CanvasMarkdownTableCell => {
      const wrapped: CanvasMarkdownRun[][] = [[]]; let used = 0, cellClipped = false;
      for (const run of inline(text, header ? { bold: true } : {}, budget)) for (const character of Array.from(run.text.replaceAll("\t", "    "))) {
        const amount = advance(character, 12, Boolean(run.code)); if (used && used + amount > columnWidth - 12) { wrapped.push([]); used = 0; }
        if (wrapped.length > canvasTableExportLimits.cellLines) { cellClipped = true; continue; }
        const row = wrapped.at(-1)!, prior = row.at(-1);
        if (prior && Boolean(prior.bold) === Boolean(run.bold) && Boolean(prior.italic) === Boolean(run.italic) && Boolean(prior.code) === Boolean(run.code) && Boolean(prior.strike) === Boolean(run.strike)) { row[row.length - 1] = { ...prior, text: prior.text + character }; }
        else { row.push({ ...run, text: character }); } used += amount;
      }
      if (cellClipped) { wrapped.length = canvasTableExportLimits.cellLines; ellipsis(wrapped.at(-1)!); clipped = true; warnings.add("Table cells are clipped after 16 wrapped lines."); }
      return Object.freeze({ lines: Object.freeze(wrapped.map(row => Object.freeze(row.map(run => Object.freeze(run))))), align });
    };
    for (const [at, values] of input.rows.entries()) {
      const cells = values.map((value, index) => cell(value, at === 0, input.alignments[index])), rowLines = Math.max(...cells.map(item => item.lines.length)), rowHeight = rowLines * 18 + 12, top = y; y += rowHeight;
      if (y > height || lines.length + tableLines + rowLines * cells.length > canvasMarkdownExportLimits.visibleLines) { clipped = omitted = true; continue; }
      tableLines += rowLines * cells.length; rows.push(Object.freeze({ y: top, height: rowHeight, cells: Object.freeze(cells), header: at === 0 }));
    }
    if (omitted) { warnings.add(rows.length ? "Whole table rows that do not fit this card are omitted; the final visible cell shows an ellipsis." : "No whole table row fits this card; this table has no visible cells. Enlarge the card or use literal export."); if (rows.length) { const old = rows.pop()!, cells = [...old.cells], last = cells.pop()!, cellLines = last.lines.map(row => [...row]); ellipsis(cellLines.at(-1)!); cells.push(Object.freeze({ ...last, lines: Object.freeze(cellLines.map(row => Object.freeze(row))) })); rows.push(Object.freeze({ ...old, cells: Object.freeze(cells) })); } }
    if (rows.length) { tables.push(Object.freeze({ width, columnWidth, rows: Object.freeze(rows) })); } y += 7;
    warnings.add(`Formatted pipe table: ${input.rows.length} rows including its header × ${input.alignments.length} columns; equal-width columns, explicit alignment and approximate system-font wrapping.`);
  };
  for (let index = 0; index < raw.length; index++) {
    const text = raw[index];
    if (text.includes("\t")) { warnings.add("Tabs are expanded to four spaces."); }
    if (literalFence) { line([{ text }], 12, 0, false, false); continue; }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) { fence = null; y += 4; continue; }
      line([{ text, code: true }], 11, 8, false, true); continue;
    }
    if (marker && !marker[2].includes(marker[1][0])) {
      const close = raw.slice(index + 1).some(value => { const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(value); return Boolean(match && match[1][0] === marker[1][0] && match[1].length >= marker[1].length); });
      if (close) { fence = { marker: marker[1][0], length: marker[1].length }; warnings.add("Fenced code uses plain monospace without syntax highlighting."); y += 4; continue; }
      warnings.add("Unclosed code fences and their remaining content are retained literally."); literalFence = true; line([{ text }], 12, 0, false, false); continue;
    }
    if (!text.trim()) { y += 7; continue; }
    const candidate = readCanvasPipeTable(raw, index);
    if (candidate) {
      const end = candidate.table?.end ?? candidate.end;
      const fallback = candidate.fallback ?? (++tableCount > canvasTableExportLimits.tables ? "Formatting supports at most eight tables per card. The complete table stays literal." : candidate.table && width < candidate.table.alignments.length * canvasTableExportLimits.minimumColumnWidth ? "This card is too narrow for the table's columns. The complete table stays literal." : "");
      if (fallback) { warnings.add(fallback); for (; index < end; index++) { if (raw[index].includes("\t")) { warnings.add("Tabs are expanded to four spaces."); } line([{ text: raw[index] }], 12, 0, false, false); } index--; }
      else { table(candidate.table!); index = end - 1; } continue;
    }
    const unsupported = /<\/?[A-Za-z!][^>]*>|!\[|\[\[|\]\[|\$\$|\$[^$]+\$|^ {0,3}>\s*\[!|^\s*\|.*\||^\s*:?-{3,}\s*\||^ {4}\S/.test(text);
    if (unsupported) { warnings.add("HTML, images, wiki links/embeds, math, callouts, tables and indented code are retained as literal source lines when encountered."); line([{ text }], 12, 0, false, false); continue; }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/.exec(text), quoted = /^ {0,3}(>{1,3})\s?(.*)$/.exec(text);
    const body = quoted ? quoted[2] : text, list = /^( {0,6})([-+*]|\d{1,9}[.)])\s+(.+)$/.exec(body);
    let content = heading ? heading[2] : list ? (/\d/.test(list[2]) ? list[2] + " " : "• ") + list[3] : body;
    if (list && /^\[[ xX]\]\s/.test(list[3])) { content = (/\d/.test(list[2]) ? list[2] + " " : "") + (/^\[[xX]\]/.test(list[3]) ? "☒ " : "☐ ") + list[3].slice(4); }
    const size = heading ? [22, 19, 17, 15, 14, 13][heading[1].length - 1] : 12, indent = (quoted ? quoted[1].length * 12 : 0) + (list ? list[1].length * 5 + 4 : 0);
    if (heading) { y += 3; } line(inline(content, heading ? { bold: true } : {}, budget), size, indent, Boolean(quoted), false);
  }
  if (clipped) { warnings.add(lines.length || tables.length ? "Formatted text is clipped to this card; the ellipsis marks omitted content." : "Formatted text is clipped to this card; no text fits in its visible area."); if (lines.length && (!tables.length || lines.at(-1)!.y > tables.at(-1)!.rows.at(-1)!.y)) { const last = lines[lines.length - 1]; lines[lines.length - 1] = Object.freeze({ ...last, runs: Object.freeze([...last.runs.slice(0, -1), Object.freeze({ ...(last.runs.at(-1) ?? {}), text: (last.runs.at(-1)?.text ?? "").replace(/.$/u, "") + "…" })]) }); } }
  return Object.freeze({ lines: Object.freeze(lines), warnings: Object.freeze([...warnings]), clipped, pieces: budget.pieces, characters: normalized.length, ...(tables.length ? { tables: Object.freeze(tables) } : {}) });
}

export function serializeCanvasMarkdownLayout(layout: CanvasMarkdownLayout, x: number, y: number, width: number, foreground: string, muted: string, codeFill: string): string {
  const text = layout.lines.map(line => {
    const top = y + line.y - line.size, decorations = (line.code ? `<rect x="${x + line.indent - 3}" y="${top - 2}" width="${Math.max(0, width - line.indent + 3)}" height="${Math.ceil(line.size * 1.45)}" rx="2" fill="${codeFill}"/>` : "") + (line.quote ? `<path d="M${x + 3},${top - 2}v${Math.ceil(line.size * 1.45)}" stroke="${muted}" stroke-width="2"/>` : "");
    return decorations + `<text x="${x + line.indent}" y="${y + line.y}" xml:space="preserve" font-size="${line.size}" fill="${foreground}">` + line.runs.map(run => `<tspan${run.bold ? ' font-weight="700"' : ""}${run.italic ? ' font-style="italic"' : ""}${line.code || run.code ? ' font-family="monospace"' : ""}${run.strike ? ' text-decoration="line-through"' : ""}>${xml(run.text)}</tspan>`).join("") + "</text>";
  }).join("");
  return text + (layout.tables ?? []).map(table => `<g data-canvas-markdown-table="">` + table.rows.map(row => `<g data-canvas-table-row="${row.header ? "header" : "body"}">` + row.cells.map((cell, index) => {
    const left = x + index * table.columnWidth, top = y + row.y, anchor = cell.align === "right" ? "end" : cell.align === "center" ? "middle" : "start", offset = cell.align === "right" ? table.columnWidth - 12 : cell.align === "center" ? (table.columnWidth - 12) / 2 : 0;
    return `<rect x="${left}" y="${top}" width="${table.columnWidth}" height="${row.height}" fill="${row.header ? codeFill : "none"}" stroke="${muted}" stroke-width="1"/><svg x="${left + 6}" y="${top + 6}" width="${Math.max(0, table.columnWidth - 12)}" height="${Math.max(0, row.height - 12)}" overflow="hidden">` + cell.lines.map((runs, line) => `<text x="${offset}" y="${14 + line * 18}" xml:space="preserve" font-size="12" fill="${foreground}" text-anchor="${anchor}">` + runs.map(run => `<tspan${run.bold ? ' font-weight="700"' : ""}${run.italic ? ' font-style="italic"' : ""}${run.code ? ' font-family="monospace"' : ""}${run.strike ? ' text-decoration="line-through"' : ""}>${xml(run.text)}</tspan>`).join("") + "</text>").join("") + "</svg>";
  }).join("") + "</g>").join("") + "</g>").join("");
}
