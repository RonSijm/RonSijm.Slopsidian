import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Node } from "yaml";
import type { App } from "./app";
import { BaseDocument } from "./bases-model";
import { baseTablePropertyIdentity, baseTableRowHeights, MIN_BASE_TABLE_COLUMN_WIDTH, MAX_BASE_TABLE_COLUMN_WIDTH, type BaseTableRowHeight } from "./bases-table";
import type { BaseViewManagementAuthority, BaseViewPlan } from "./bases-view-management";
import type { TFile } from "./vault";

export interface BaseTablePresentationDraft { rowHeight: string; widths: { property: string; width: string }[] }
export interface BaseTablePresentationState { rowHeight: BaseTableRowHeight; widths: { property: string; label: string; width: string }[]; hiddenWidths: number; issue: string | null }
export interface BaseTablePresentationPlan extends BaseViewPlan { readonly changes: readonly string[]; readonly warnings: readonly string[]; readonly edits: readonly Readonly<{ from: number; to: number; insert: string }>[] }
type Edit = { from: number; to: number; insert: string };
const q = JSON.stringify;
function refuse(): Error { return new Error("This Table presentation needs Source editing. Keep explicit named view mappings and unambiguous, unanchored rowHeight and columnSize fields; the existing source is retained."); }
function equal(a: unknown, b: unknown, visited = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(a, b)) { return true; } if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) { return false; }
  const prior = visited.get(a); if (prior?.has(b)) { return true; } if (prior) { prior.add(b); } else { visited.set(a, new WeakSet([b])); }
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], visited));
}
function safe(node: unknown): void {
  if (node == null) { return; } if (!isNode(node)) { throw refuse(); } let invalid = false;
  visit(node, { Node(_key, value) { if (isAlias(value) || value.tag || "anchor" in value && value.anchor) { invalid = true; } } });
  if (invalid) { throw refuse(); }
}
function structure(source: string, selected: string) {
  const model = new BaseDocument(source), bom = source.startsWith("\ufeff") ? 1 : 0, body = source.slice(bom), doc = parseDocument(body, { keepSourceTokens: true, uniqueKeys: true, intAsBigInt: true }), root = doc.contents, views = doc.get("views", true);
  if (!isMap(root) || root.anchor || root.tag || !isSeq(views) || views.anchor || views.tag || views.srcToken?.type !== "block-seq") { throw refuse(); }
  const names = new Set<string>(); for (const view of model.views) { const normalized = view.name.normalize("NFKC").toLowerCase(); if (names.has(normalized)) { throw refuse(); } names.add(normalized); }
  const index = model.views.findIndex(view => view.name === selected), view = model.views[index], node = views.items[index];
  if (!view || view.type !== "table" || !view.table) { throw new Error("Choose the current saved Table view to change its presentation."); }
  if (!isMap(node) || node.anchor || node.tag || node.srcToken?.type !== "block-map" || !node.range || node.srcToken.indent > 64 || isAlias(node.get("name", true))) { throw refuse(); }
  if (view.table.issue) { throw new Error(view.table.issue); }
  for (const field of ["rowHeight", "columnSize"]) {
    const key = node.items.find(pair => isScalar(pair.key) && pair.key.value === field)?.key, value = node.get(field, true);
    if (key && !isScalar(key) || node.has(field) && (!value || isScalar(value) && (!value.range || value.range[0] === value.range[1]))) { throw refuse(); }
    safe(key); safe(value);
  }
  const data = doc.toJS({ maxAliasCount: 32 }) as Record<string, unknown> & { views: Record<string, unknown>[] };
  return { model, bom, body, doc, node, index, view, data };
}
export function readBaseTablePresentationState(source: string, selected: string): BaseTablePresentationState {
  const model = new BaseDocument(source), view = model.views.find(view => view.name === selected);
  if (!view?.table) { throw new Error("Choose a Table view to change its presentation."); }
  let issue = view.table.issue; if (!issue) { try { structure(source, selected); } catch (error) { issue = error instanceof Error ? error.message : String(error); } }
  const shown = new Set(view.order.map(baseTablePropertyIdentity));
  return { rowHeight: view.table.rowHeight, widths: view.order.map(property => ({ property, label: model.label(property), width: view.table!.columnSize[baseTablePropertyIdentity(property)] ? String(view.table!.columnSize[baseTablePropertyIdentity(property)]) : "" })), hiddenWidths: Object.keys(view.table.columnSize).filter(key => !shown.has(key)).length, issue };
}
export function validateBaseTablePresentationDraft(draft: BaseTablePresentationDraft, properties: readonly string[]): { rowHeight: BaseTableRowHeight; widths: number[] } {
  if (!draft || typeof draft.rowHeight !== "string" || !Object.hasOwn(baseTableRowHeights, draft.rowHeight)) { throw new Error("Choose short, medium, tall or extra tall rows."); }
  if (!Array.isArray(draft.widths) || draft.widths.length !== properties.length || properties.length > 64) { throw new Error("Review every current displayed property's width without changing its identity or order."); }
  const widths = draft.widths.map((entry, index) => {
    if (!entry || entry.property !== properties[index] || typeof entry.width !== "string") { throw new Error("The displayed property order changed. Reopen Table presentation."); }
    if (entry.width === "") { return 0; }
    if (!/^(?:\d{1,4})(?:\.\d{1,17})?$/.test(entry.width)) { throw new Error("Leave widths blank for automatic sizing, or enter 40–2,000 px with up to seventeen decimal places."); }
    const value = Number(entry.width); if (!Number.isFinite(value) || value < MIN_BASE_TABLE_COLUMN_WIDTH || value > MAX_BASE_TABLE_COLUMN_WIDTH) { throw new Error("Column widths must be from 40 to 2,000 px. Leave a width blank for automatic sizing."); } return value;
  });
  return { rowHeight: draft.rowHeight as BaseTableRowHeight, widths };
}
/** Replace only changed scalar tokens and append proved fields; hidden width tokens stay exact. */
export function planBaseTablePresentation(source: string, selected: string, draft: BaseTablePresentationDraft): BaseTablePresentationPlan {
  const s = structure(source, selected), next = validateBaseTablePresentationDraft(draft, s.view.order), edits: Edit[] = [], changes: string[] = [], original = s.data.views[s.index], expectedView = { ...original };
  const eolAt = (at: number): string => { const line = s.body.indexOf("\n", at); return line >= 0 ? s.body[line - 1] === "\r" ? "\r\n" : "\n" : s.body.includes("\r\n") ? "\r\n" : "\n"; };
  type MapAddition = { owner: object; indent: number; order: number; items: string[] };
  const additions = new Map<number, MapAddition[]>(); let additionOrder = 0;
  const itemsAt = (at: number, owner: object, indent: number): string[] => {
    const groups = additions.get(at) ?? []; let group = groups.find(group => group.owner === owner);
    if (!group) { group = { owner, indent, order: additionOrder++, items: [] }; groups.push(group); additions.set(at, groups); }
    return group.items;
  };
  const append = (node: typeof s.node, key: string, text: string): void => {
    if (!node.range || !node.srcToken) { throw refuse(); }
    if (node.srcToken.type === "block-map") {
      const at = node.range[2]; if (at < s.body.length && s.body[at - 1] !== "\n") { throw refuse(); }
      const items = itemsAt(at, node, node.srcToken.indent); items.push(" ".repeat(node.srcToken.indent) + q(key) + ": " + text + eolAt(at));
    } else if (node.srcToken.type === "flow-collection") {
      const at = node.srcToken.end.find(token => token.type === "flow-map-end")?.offset; if (at === undefined) { throw refuse(); }
      const last = s.body.slice(node.range[0] + 1, at).trimEnd(), items = itemsAt(at, node, node.srcToken.indent);
      items.push((items.length || last && !last.endsWith(",") ? ", " : last ? " " : "") + q(key) + ": " + text);
    } else { throw refuse(); }
  };
  const replace = (node: Node | null | undefined, text: string): void => { if (!isScalar(node) || !node.range || node.range[0] === node.range[1]) { throw refuse(); } edits.push({ from: node.range[0], to: node.range[1], insert: text }); };
  if (s.view.table!.rowHeight !== next.rowHeight) {
    const prior = s.node.get("rowHeight", true); if (prior === undefined && !s.node.has("rowHeight")) { append(s.node, "rowHeight", q(next.rowHeight)); } else { replace(prior, q(next.rowHeight)); }
    expectedView.rowHeight = next.rowHeight; changes.push("Row height: " + baseTableRowHeights[s.view.table!.rowHeight] + " px → " + baseTableRowHeights[next.rowHeight] + " px.");
  }
  const priorSizes = original.columnSize == null ? {} : original.columnSize as Record<string, unknown>, expectedSizes = { ...priorSizes }, sizes = s.node.get("columnSize", true);
  let sizesChanged = false;
  for (const [index, property] of s.view.order.entries()) {
    const id = baseTablePropertyIdentity(property), before = s.view.table!.columnSize[id] ?? 0, after = next.widths[index]; if (before === after) { continue; }
    const key = Object.keys(priorSizes).find(key => baseTablePropertyIdentity(key) === id) ?? property;
    if (isMap(sizes)) {
      const value = sizes.get(key, true); if (value === undefined && !sizes.has(key)) { append(sizes, key, String(after)); } else { replace(value, String(after)); }
    }
    expectedSizes[key] = Number.isInteger(after) ? BigInt(after) : after; sizesChanged = true;
    changes.push(s.model.label(property) + " (" + property + "): " + (before ? before + " px" : "automatic") + " → " + (after ? after + " px" : "automatic") + ".");
  }
  if (sizesChanged) {
    expectedView.columnSize = expectedSizes;
    if (!isMap(sizes)) {
      const literal = "{" + Object.entries(expectedSizes).map(([key, value]) => q(key) + ": " + String(value)).join(", ") + "}";
      if (sizes === undefined && !s.node.has("columnSize")) { append(s.node, "columnSize", literal); } else { replace(sizes, literal); }
    }
  }
  if (!changes.length) { throw new Error("Change a row height or displayed column width before reviewing."); }
  for (const [at, groups] of additions) {
    // A terminal child map and its view can share this source boundary. Finish
    // the deeper map before appending view fields, retaining each map's order.
    const items = [...groups].sort((a, b) => b.indent - a.indent || a.order - b.order).flatMap(group => group.items);
    const closingMap = s.body[at] === "}", text = (closingMap || s.body[at - 1] === "\n" ? "" : eolAt(at)) + items.join(""); edits.push({ from: at, to: at, insert: text });
  }
  edits.sort((a, b) => a.from - b.from || a.to - b.to); let outputBody = s.body, end = s.body.length;
  for (const edit of [...edits].reverse()) { if (edit.from < 0 || edit.to < edit.from || edit.to > end) { throw refuse(); } outputBody = outputBody.slice(0, edit.from) + edit.insert + outputBody.slice(edit.to); end = edit.from; }
  const output = source.slice(0, s.bom) + outputBody, result = parseDocument(outputBody, { uniqueKeys: true, intAsBigInt: true });
  const expected = { ...s.data, views: s.data.views.map((view, index) => index === s.index ? expectedView : view) };
  if (result.errors.length || result.warnings.length || !equal(expected, result.toJS({ maxAliasCount: 32 }))) { throw new Error("This presentation edit would change other YAML or alias ownership. Keep the source and edit it explicitly."); }
  const rendered = new BaseDocument(output).view(selected).table!; if (rendered.issue || rendered.rowHeight !== next.rowHeight || s.view.order.some((key, index) => (rendered.columnSize[baseTablePropertyIdentity(key)] ?? 0) !== next.widths[index])) { throw refuse(); }
  const exact = edits.map(edit => Object.freeze({ from: edit.from + s.bom, to: edit.to + s.bom, insert: edit.insert })), first = exact[0].from, last = Math.max(...exact.map(edit => edit.to));
  return Object.freeze({ source: output, selected, names: Object.freeze(s.model.views.map(view => view.name)), description: "Change Table row heights and displayed column widths only in “" + selected + "”. Hidden stored widths, query settings, other views and note files are kept.", changes: Object.freeze(changes), warnings: Object.freeze(["Blank widths use automatic sizing. When any displayed width is explicit, other automatic columns use 180 px and the table scrolls horizontally. Full values remain available in scrollable cells; headers and summary/group rows keep their own height."]), edits: Object.freeze(exact), edit: Object.freeze({ from: first, to: last, insert: output.slice(first, output.length - (source.length - last)) }) });
}

export class BaseTablePresentationReview {
  readonly plan: BaseTablePresentationPlan;
  private readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, draft: BaseTablePresentationDraft, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path); this.path = file.path; this.root = app.vault.rootPath ?? ""; const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload this base before changing Table presentation. Unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) }; this.guard(); this.plan = planBaseTablePresentation(source, selected, draft);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path); const saved = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles || this.file.path !== this.path || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current() || !saved || saved.file.path !== this.path || saved.version !== this.baseline.version || saved.content !== this.baseline.content || Boolean(saved.hasBom) !== this.baseline.hasBom) { throw new Error("The base, saved source or presentation owner changed. Cancel and review the current Table again."); }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This Table presentation review was already applied or attempted. Start a fresh review."); } this.started = true; this.guard(); this.applying = true;
    try { const actual = await this.app.vault.readDocument(this.path); this.guard(); if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) { throw new Error("The saved base changed on disk. No Table presentation edit was applied. Reload it and review again."); } this.attempted = true; await this.authority.save(this.plan); this.completed = true; } finally { this.applying = false; }
  }
}
