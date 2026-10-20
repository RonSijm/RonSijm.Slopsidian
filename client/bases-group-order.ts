import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, type Node } from "yaml";
import type { App } from "./app";
import { BaseDocument, queryBase, supportedBaseView, type BaseFile } from "./bases-model";
import { baseGroupOrderIdentity, describeBaseGroupOrderValue, readBaseGroupOrderValues, type BaseGroupOrderValue } from "./bases-group-order-values";
import type { BaseViewManagementAuthority, BaseViewPlan } from "./bases-view-management";
import type { TFile } from "./vault";
export { describeBaseGroupOrderValue, MAX_BASE_GROUP_ORDER } from "./bases-group-order-values";
export type { BaseGroupOrderValue } from "./bases-group-order-values";

export type BaseGroupOrderDraft = { mode: "automatic" } | { mode: "manual"; values: readonly BaseGroupOrderValue[] };
export interface BaseGroupOrderPlan extends BaseViewPlan { readonly changes: readonly string[]; readonly warnings: readonly string[]; readonly edits: readonly Readonly<{ from: number; to: number; insert: string }>[] }
export interface BaseGroupOrderState { property: string; direction: "ASC" | "DESC"; values: BaseGroupOrderValue[] | null; issue: string | null }

export function readBaseGroupOrderState(source: string, selected: string): BaseGroupOrderState {
  const model = new BaseDocument(source), view = model.views.find(view => view.name === selected);
  if (!view || !supportedBaseView(view.type) || !view.groupBy) { throw new Error("Group visibility/order needs a saved Table, List or Cards view with a grouping property. Choose Group by first."); }
  return { property: view.groupBy.property, direction: view.groupBy.direction, values: view.groupOrder === null ? null : [...view.groupOrder], issue: view.groupOrderIssue };
}

/** Read the same filtered view without its manual visibility, search or limit. Never writes this temporary YAML. */
export function baseGroupOrderCandidates(source: string, selected: string, files: BaseFile[], context: BaseFile): BaseGroupOrderValue[] {
  const model = new BaseDocument(source), view = model.views.find(view => view.name === selected);
  if (!view?.groupBy || !supportedBaseView(view.type)) { throw new Error("Choose a supported grouped saved view first."); }
  const document = parseDocument(source.replace(/^\ufeff/, ""), { uniqueKeys: true, intAsBigInt: true });
  document.deleteIn(["views", view.index, "groupOrder"]); document.deleteIn(["views", view.index, "limit"]);
  const result = queryBase({ text: document.toString({ lineWidth: 0 }), files, context, view: selected, search: "", page: 0 });
  if (result.errors.length) { throw new Error("Group discovery has query errors. Review base source before changing visibility: " + result.errors[0]); }
  const values: BaseGroupOrderValue[] = [], seen = new Set<string>();
  for (const group of result.groups) {
    if (!group.identity) { throw new Error("A group value exceeds supported typed editing bounds. Edit groupOrder in base source."); }
    const tuple = JSON.parse(group.identity.slice(3)), value = tuple[0] === "none" ? null : ["string", "number", "boolean"].includes(tuple[0]) ? tuple[1] : undefined;
    if (value === undefined) { throw new Error("Date and link groups need base source review; their native groupOrder encoding is not implemented."); }
    const key = baseGroupOrderIdentity(value)!; if (!seen.has(key)) { seen.add(key); values.push(value); }
  }
  return readBaseGroupOrderValues(values);
}

function refuse(): Error { return new Error("This groupOrder needs Source editing. Visual edits require an explicit unanchored named view and scalar list with unambiguous comments, aliases and tags. Its existing source is kept."); }
function safe(node: Node): void {
  const nodes: Node[] = [node]; let work = 0;
  while (nodes.length) {
    const item = nodes.pop()!; if (++work > 1024 || isAlias(item) || item.tag || "anchor" in item && item.anchor) { throw refuse(); }
    if (isSeq(item)) { for (const child of item.items) { if (!isScalar(child)) { throw refuse(); } nodes.push(child); } }
    const pending: { token: unknown; depth: number }[] = [{ token: item.srcToken, depth: 0 }];
    while (pending.length) {
      const { token, depth } = pending.pop()!; if (++work > 8192 || depth > 64) { throw refuse(); } if (!token || typeof token !== "object") { continue; }
      const object = token as Record<string, unknown>;
      if (object.type === "comment" && typeof object.offset === "number" && node.range && object.offset >= node.range[0] && object.offset < node.range[1]) { throw refuse(); }
      for (const value of Object.values(object)) { if (Array.isArray(value)) { for (const child of value) { pending.push({ token: child, depth: depth + 1 }); } } else if (value && typeof value === "object") { pending.push({ token: value, depth: depth + 1 }); } }
    }
  }
}
function equal(left: unknown, right: unknown): boolean {
  const seen = new WeakMap<object, WeakSet<object>>(), pending: { left: unknown; right: unknown; depth: number }[] = [{ left, right, depth: 0 }]; let work = 0;
  while (pending.length) {
    const { left, right, depth } = pending.pop()!; if (++work > 25000 || depth > 64) { throw new Error("This source exceeds bounded group-order YAML review. Edit this configuration in Source."); }
    if (Object.is(left, right)) { continue; }
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) { return false; }
    const prior = seen.get(left); if (prior?.has(right)) { continue; } if (prior) { prior.add(right); } else { seen.set(left, new WeakSet([right])); }
    const keys = Object.keys(left); if (keys.length !== Object.keys(right).length) { return false; }
    if (work + pending.length + keys.length > 25000) { throw new Error("This source exceeds bounded group-order YAML review. Edit this configuration in Source."); }
    for (const key of keys) { if (!Object.hasOwn(right, key)) { return false; } pending.push({ left: (left as Record<string, unknown>)[key], right: (right as Record<string, unknown>)[key], depth: depth + 1 }); }
  }
  return true;
}

/** Exact CST field splice. Other YAML, numeric lexemes, BOM and mixed line endings stay byte-for-byte. */
export function planBaseGroupOrder(source: string, selected: string, draft: BaseGroupOrderDraft): BaseGroupOrderPlan {
  const model = new BaseDocument(source), state = readBaseGroupOrderState(source, selected), bom = source.startsWith("\ufeff") ? 1 : 0, body = source.slice(bom);
  if (!draft || typeof draft !== "object" || !["automatic", "manual"].includes(draft.mode) || Object.keys(draft).sort().join() !== (draft.mode === "manual" ? "mode,values" : "mode")) { throw new Error("Choose automatic grouping or an explicit typed manual list."); }
  if (state.issue) { throw new Error(state.issue); }
  const values = draft.mode === "manual" ? readBaseGroupOrderValues(draft.values) : null;
  if (equal(state.values, values)) { throw new Error("Change group visibility or order before reviewing."); }
  const document = parseDocument(body, { keepSourceTokens: true, uniqueKeys: true, intAsBigInt: true }), root = document.contents, sequence = document.get("views", true), index = model.views.findIndex(view => view.name === selected);
  const normalized = model.views.map(view => view.name.normalize("NFKC").toLowerCase());
  if (new Set(normalized).size !== normalized.length) { throw new Error("These saved view names are ambiguous after Unicode normalization or letter case. Rename them in Source first."); }
  if (!isMap(root) || root.anchor || root.tag || !isSeq(sequence) || sequence.anchor || sequence.tag || sequence.srcToken?.type !== "block-seq") { throw refuse(); }
  const node = sequence.items[index];
  if (!isMap(node) || node.anchor || node.tag || !node.range || node.srcToken?.type !== "block-map" || node.srcToken.indent > 64 || !isScalar(node.get("name", true)) || !isScalar(node.get("type", true))) { throw refuse(); }
  safe(node.get("name", true) as Node); safe(node.get("type", true) as Node);
  for (const item of node.items) { if (isScalar(item.key) && ["name", "type", "groupOrder"].includes(String(item.key.value))) { safe(item.key); } }
  const pair = node.items.find(pair => isScalar(pair.key) && pair.key.value === "groupOrder"), old = pair?.value, tokens = new Map<string, string>();
  if (pair) {
    if (!isScalar(pair.key) || !isSeq(old) || !old.range || old.range[0] === old.range[1]) { throw refuse(); }
    safe(pair.key); safe(old);
    for (const [at, value] of old.items.entries()) {
      if (!isScalar(value) || !value.range || value.range[0] === value.range[1]) { throw refuse(); }
      const literal = body.slice(value.range[0], value.range[1]);
      // A scalar moved into a flow sequence must remain a self-contained scalar token.
      tokens.set(baseGroupOrderIdentity(state.values![at])!, /[\r\n]/.test(literal) || ["BLOCK_LITERAL", "BLOCK_FOLDED"].includes(value.type ?? "") ? JSON.stringify(state.values![at]) : literal);
    }
  }
  const data = document.toJS({ maxAliasCount: 32 }) as { views: Record<string, unknown>[] }, expected = { ...data, views: data.views.map((view, at) => at === index ? { ...view } : view) };
  const literal = values === null ? "" : "[" + values.map(value => tokens.get(baseGroupOrderIdentity(value)!) ?? JSON.stringify(value)).join(", ") + "]";
  const eolAt = (at: number): string => { const line = body.indexOf("\n", at); return line >= 0 ? body[line - 1] === "\r" ? "\r\n" : "\n" : body.includes("\r\n") ? "\r\n" : "\n"; };
  let from: number, to: number, insert: string;
  if (values === null) {
    if (!pair || !isScalar(pair.key) || !pair.key.range || !isNode(old) || !old.range || pair.key.commentBefore || old.commentBefore) { throw refuse(); }
    from = body.lastIndexOf("\n", pair.key.range[0] - 1) + 1; to = old.range[2];
    if (!/^ *$/.test(body.slice(from, pair.key.range[0])) || !/[\r\n]$/.test(body.slice(from, to)) && to !== body.length) { throw refuse(); }
    // A standalone comment immediately before this field has uncertain ownership on deletion.
    const previousStart = body.lastIndexOf("\n", Math.max(0, from - 2)) + 1;
    if (/^\s*#/.test(body.slice(previousStart, from)) || pair.key.comment || old.comment) { throw refuse(); }
    insert = ""; delete expected.views[index].groupOrder;
  } else if (isSeq(old) && old.range) {
    from = old.range[0]; to = old.range[1]; insert = literal + (body.slice(from, to).match(/\r?\n$/)?.[0] ?? ""); expected.views[index].groupOrder = values.map(value => typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value);
    // Reuse each imported scalar's semantic value, including integer spelling and negative zero.
    expected.views[index].groupOrder = values.map(value => { const at = state.values!.findIndex(prior => baseGroupOrderIdentity(prior) === baseGroupOrderIdentity(value)); return at >= 0 && Array.isArray(data.views[index].groupOrder) ? (data.views[index].groupOrder as unknown[])[at] : typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value; });
  } else {
    if (pair) { throw refuse(); } from = to = node.range[2]; const eol = eolAt(from);
    if (from < body.length && body[from - 1] !== "\n") { throw refuse(); }
    insert = (body[from - 1] === "\n" ? "" : eol) + " ".repeat(node.srcToken.indent) + "groupOrder: " + literal + eol;
    expected.views[index].groupOrder = values.map(value => typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value);
  }
  const output = source.slice(0, bom) + body.slice(0, from) + insert + body.slice(to), actualDocument = parseDocument(output.slice(bom), { uniqueKeys: true, intAsBigInt: true });
  if (actualDocument.errors.length || actualDocument.warnings.length || !equal(expected, actualDocument.toJS({ maxAliasCount: 32 }))) { throw new Error("This groupOrder edit would change other YAML or alias ownership. Keep the source and edit it explicitly."); }
  const result = new BaseDocument(output).view(selected);
  if (!equal(result.groupOrder, values) || result.groupOrderIssue) { throw refuse(); }
  const edit = Object.freeze({ from: from + bom, to: to + bom, insert }), changes = values === null ? ["Remove groupOrder. Show every matching group in groupBy " + state.direction + " order, including new values."] : ["Only these " + values.length + " typed groups appear, in this order: " + (values.map(describeBaseGroupOrderValue).join(" → ") || "none (hide every group)") + ".", "Groups omitted from this list, including future values, stay hidden. null includes missing/no value; false, 0 and literal strings are distinct. Configured groups without matching rows keep empty headers."];
  return Object.freeze({ source: output, selected, names: Object.freeze(model.views.map(view => view.name)), description: "Change group visibility and ordering only in “" + selected + "”. Table, List, Cards and saved/inline embeds use the same query behavior; note files are kept.", changes: Object.freeze(changes), warnings: Object.freeze(["Group visibility applies before row limits, paging, summaries and exports. Empty headers belong to their limited row offset; trailing empty groups appear on the last page."]), edits: Object.freeze([edit]), edit });
}

export class BaseGroupOrderReview {
  readonly plan: BaseGroupOrderPlan;
  private readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, draft: BaseGroupOrderDraft, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path); this.path = file.path; this.root = app.vault.rootPath ?? ""; const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload this base before changing group visibility/order. Unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) }; this.guard(); this.plan = planBaseGroupOrder(source, selected, draft);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path); const saved = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles || this.file.path !== this.path || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current() || !saved || saved.file.path !== this.path || saved.version !== this.baseline.version || saved.content !== this.baseline.content || Boolean(saved.hasBom) !== this.baseline.hasBom) { throw new Error("The base, saved source or group-order owner changed. Cancel and review the current groups again."); }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This group-order review was already applied or attempted. Start a fresh review."); } this.started = true; this.guard(); this.applying = true;
    try { const actual = await this.app.vault.readDocument(this.path); this.guard(); if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) { throw new Error("The saved base changed on disk. No group-order edit was applied. Reload it and review again."); } this.attempted = true; await this.authority.save(this.plan); this.completed = true; } finally { this.applying = false; }
  }
}
