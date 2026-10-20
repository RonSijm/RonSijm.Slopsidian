export type BaseTableRowHeight = "" | "medium" | "tall" | "extra";
export interface BaseTableOptions { rowHeight: BaseTableRowHeight; columnSize: Readonly<Record<string, number>>; issue: string | null }
export const MIN_BASE_TABLE_COLUMN_WIDTH = 40;
export const MAX_BASE_TABLE_COLUMN_WIDTH = 2000;
export const MAX_BASE_TABLE_COLUMN_SIZES = 128;
export const baseTableRowHeights = Object.freeze({ "": 30, medium: 60, tall: 120, extra: 240 });

/** Width keys identify properties, including keys that are currently hidden. */
export function baseTablePropertyIdentity(key: string): string {
  if (typeof key !== "string") { throw new Error("A table width needs a property identifier."); }
  const match = /^(file|formula|note)\.(.+)$/.exec(key), kind = match?.[1] ?? "note", name = match?.[2] ?? key;
  if (!name.trim() || name.length > 256 || /[\x00-\x1f\x7f]/.test(name) || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(name) || ["constructor", "__proto__", "prototype"].includes(name)) { throw new Error("Unsupported table width property identifier."); }
  return kind + "." + name;
}
function width(value: unknown): number | null {
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(MAX_BASE_TABLE_COLUMN_WIDTH)) { value = Number(value); }
  return typeof value === "number" && Number.isFinite(value) && (value === 0 || value >= MIN_BASE_TABLE_COLUMN_WIDTH && value <= MAX_BASE_TABLE_COLUMN_WIDTH) ? value : null;
}
export function supportedBaseTableColumnSizes(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > MAX_BASE_TABLE_COLUMN_SIZES) { return false; }
  const seen = new Set<string>();
  try { for (const [key, number] of Object.entries(value)) { const id = baseTablePropertyIdentity(key); if (seen.has(id) || width(number) === null) { return false; } seen.add(id); } } catch { return false; }
  return true;
}
export function readBaseTableOptions(view: Record<string, unknown>, warnings: string[]): BaseTableOptions {
  const issues: string[] = [], sizes: Record<string, number> = Object.create(null), height = view.rowHeight ?? "";
  if (typeof height !== "string" || !Object.hasOwn(baseTableRowHeights, height)) { issues.push("Unsupported Table rowHeight is retained; short rows are used. Choose short, medium, tall or extra in Source."); }
  if (view.columnSize != null) {
    if (!supportedBaseTableColumnSizes(view.columnSize)) { issues.push("Unsupported Table columnSize is retained; automatic widths are used. Widths support distinct property keys and 40–2,000 px, or 0 for automatic, with at most 128 settings. Edit this configuration in Source."); }
    else { for (const [key, value] of Object.entries(view.columnSize)) { sizes[baseTablePropertyIdentity(key)] = width(value)!; } }
  }
  warnings.push(...issues);
  return { rowHeight: typeof height === "string" && Object.hasOwn(baseTableRowHeights, height) ? height as BaseTableRowHeight : "", columnSize: sizes, issue: issues.join(" ") || null };
}

/** Presentation adds no query values or configuration controls to an embed. */
export function styleBaseTable(table: HTMLTableElement, options: BaseTableOptions, keys: readonly string[], openColumn = false): void {
  table.dataset.basesTablePresentation = options.rowHeight || "short";
  table.style.setProperty("--bases-table-data-row-height", baseTableRowHeights[options.rowHeight] + "px");
  const custom = keys.some(key => (options.columnSize[baseTablePropertyIdentity(key)] ?? 0) > 0);
  table.dataset.basesTableSizing = custom ? "fixed" : "automatic";
  if (!custom) { return; }
  const doc = table.ownerDocument ?? document, group = doc.createElement("colgroup"); let total = 0;
  for (const key of keys) {
    const col = doc.createElement("col"), pixels = options.columnSize[baseTablePropertyIdentity(key)] || 180;
    col.dataset.basesTableColumn = key; col.style.width = pixels + "px"; group.append(col); total += pixels;
  }
  if (openColumn) { const col = doc.createElement("col"); col.style.width = "96px"; group.append(col); total += 96; }
  table.style.width = total + "px"; table.append(group);
}
export function baseTableValueContainer(cell: HTMLTableCellElement): HTMLElement {
  const content = (cell.ownerDocument ?? document).createElement("div"); content.className = "bases-table-value"; cell.append(content); return content;
}
