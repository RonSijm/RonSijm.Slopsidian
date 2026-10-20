import { isAlias, isMap, isSeq, parseDocument, visit, type Node, type YAMLMap } from "yaml";
import type { App } from "./app";
import { parseBaseExpression } from "./bases-expression";
import { BaseDocument, baseProperty, supportedBaseView } from "./bases-model";
import type { BaseViewManagementAuthority, BaseViewPlan } from "./bases-view-management";
import type { TFile } from "./vault";

export const baseFilterLimits = Object.freeze({ nodes: 64, depth: 8, expression: 4096 });
export type BaseFilterDraft = { kind: "expression"; expression: string } | { kind: "group"; operator: "and" | "or" | "not"; children: BaseFilterDraft[] };
export type BaseFilterValue = string | { and: BaseFilterValue[] } | { or: BaseFilterValue[] } | { not: BaseFilterValue[] };
export type BaseFilterScope = "global" | "view";
export interface BaseFilterScopeState { readonly draft: BaseFilterDraft | null; readonly editable: boolean; readonly source: string; readonly issue: string }
export interface BaseFilterState { readonly global: BaseFilterScopeState; readonly view: BaseFilterScopeState }
export interface BaseFilterChanges { global?: BaseFilterDraft | null; view?: BaseFilterDraft | null }
export interface BaseFilterPlan extends BaseViewPlan {
  readonly edits: readonly Readonly<{ from: number; to: number; insert: string }>[];
  readonly changes: readonly Readonly<{ scope: BaseFilterScope; before: string; after: string }>[];
}
export type BaseFilterPredicateOperator = "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "startsWith" | "endsWith" | "empty" | "not-empty";
export interface BaseFilterPredicate { property: string; operator: BaseFilterPredicateOperator; type: "text" | "number" | "boolean" | "null"; value: string }
/** Structural UI limits are independent of expression validity, so removal and fixes remain possible. */
export function baseFilterStructure(draft: BaseFilterDraft | null): { nodes: number; depth: number } {
  let nodes = 0, depth = 0; const seen = new WeakSet<object>();
  const visit = (node: BaseFilterDraft, level: number): void => {
    if (!node || typeof node !== "object" || seen.has(node) || ++nodes > baseFilterLimits.nodes || level > baseFilterLimits.depth) { throw new Error("Visual filters support at most 64 entries and eight nested group levels. Remove a condition or use Edit base source."); }
    seen.add(node); depth = Math.max(depth, level);
    if (node.kind === "group") { if (!Array.isArray(node.children)) { throw new Error("A filter group needs conditions."); } node.children.forEach(child => visit(child, level + 1)); }
  };
  if (draft !== null) { visit(draft, 0); } return { nodes, depth };
}
const q = (value: unknown): string => JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
const refuse = (): Error => new Error("This filter has comments, aliases, anchors, tags or an ambiguous layout. Keep it here and edit that filter explicitly in Edit base source.");
const unicode = (value: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
function equal(a: unknown, b: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(a, b)) { return true; }
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) { return false; }
  const prior = seen.get(a); if (prior?.has(b)) { return true; } if (prior) { prior.add(b); } else { seen.set(a, new WeakSet([b])); }
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(Reflect.get(a, key), Reflect.get(b, key), seen));
}
export function baseFilterDraftValue(draft: BaseFilterDraft | null): BaseFilterValue | null {
  let count = 0; const seen = new WeakSet<object>();
  const next = (node: BaseFilterDraft, depth: number): BaseFilterValue => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > baseFilterLimits.depth || ++count > baseFilterLimits.nodes) { throw new Error("Visual filters support at most 64 entries and eight nested group levels. Use Edit base source for larger filters."); }
    seen.add(node);
    if (node.kind === "expression") {
      if (Object.keys(node).sort().join(",") !== "expression,kind" || typeof node.expression !== "string" || !node.expression.trim() || !unicode(node.expression)) { throw new Error("Enter a nonempty filter expression with valid Unicode."); }
      parseBaseExpression(node.expression); return node.expression;
    }
    if (node.kind !== "group" || Object.keys(node).sort().join(",") !== "children,kind,operator" || !["and", "or", "not"].includes(node.operator) || !Array.isArray(node.children)) { throw new Error("Choose All, Any or None for each filter group."); }
    return { [node.operator]: node.children.map(child => next(child, depth + 1)) } as BaseFilterValue;
  };
  return draft === null ? null : next(draft, 0);
}
function draftFromValue(value: unknown, depth = 0, count = { value: 0 }): BaseFilterDraft | null {
  if (value == null && depth === 0) { return null; }
  if (depth > baseFilterLimits.depth || ++count.value > baseFilterLimits.nodes) { throw new Error("This saved filter is larger than the visual editor's 64 entries or eight nested group levels. Keep it and use Edit base source."); }
  if (typeof value === "string") { parseBaseExpression(value); return { kind: "expression", expression: value }; }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) { throw refuse(); }
  const operator = Object.keys(value)[0]; if (!["and", "or", "not"].includes(operator) || !Array.isArray(Reflect.get(value, operator))) { throw refuse(); }
  return { kind: "group", operator: operator as "and" | "or" | "not", children: (Reflect.get(value, operator) as unknown[]).map(child => { const result = draftFromValue(child, depth + 1, count); if (!result) { throw refuse(); } return result; }) };
}
function checkNode(node: Node): void {
  let invalid = false;
  visit(node, { Node(_key, item) { if (isAlias(item) || item.tag || "anchor" in item && item.anchor) { invalid = true; } } });
  const walk = (token: unknown): void => {
    if (!token || typeof token !== "object") { return; }
    const item = token as Record<string, unknown>;
    if (item.type === "comment" && typeof item.offset === "number" && node.range && item.offset >= node.range[0] && item.offset < node.range[1]) { invalid = true; }
    for (const child of Object.values(item)) { if (Array.isArray(child)) { child.forEach(walk); } else if (child && typeof child === "object") { walk(child); } }
  };
  walk(node.srcToken); if (invalid) { throw refuse(); }
}
function owners(source: string, selected: string) {
  const model = new BaseDocument(source), bom = source.startsWith("\ufeff") ? 1 : 0, body = source.slice(bom), document = parseDocument(body, { uniqueKeys: true, keepSourceTokens: true, intAsBigInt: true });
  const root = document.contents, sequence = document.get("views", true), names = new Set<string>();
  if (!isMap(root) || root.anchor || root.tag || root.srcToken?.type !== "block-map" || !root.range || !isSeq(sequence) || sequence.anchor || sequence.tag || sequence.srcToken?.type !== "block-seq") { throw refuse(); }
  for (const view of model.views) { const name = view.name.normalize("NFKC").toLowerCase(); if (names.has(name)) { throw new Error("These saved view names are ambiguous after Unicode normalization or letter case. Give them distinct names in Edit base source first."); } names.add(name); }
  const index = model.views.findIndex(view => view.name === selected), current = model.views[index], node = sequence.items[index];
  if (!current || !supportedBaseView(current.type)) { throw new Error("Visual filters support the selected saved Table, List or Cards view. Keep unsupported views and edit their source explicitly."); }
  if (!isMap(node) || node.anchor || node.tag || !node.range || node.srcToken?.type !== "block-map" || node.srcToken.indent > 64 || isAlias(node.get("name", true))) { throw refuse(); }
  return { model, bom, body, document, root, node, index };
}
export function readBaseFilterState(source: string, selected: string): BaseFilterState {
  const state = owners(source, selected), data = state.document.toJS({ maxAliasCount: 32 }) as { views: Record<string, unknown>[] } & Record<string, unknown>;
  const read = (owner: YAMLMap<unknown, unknown>, semantic: unknown): BaseFilterScopeState => {
    const node = owner.get("filters", true), text = node?.range ? state.body.slice(node.range[0], node.range[1]) : "No filter";
    try { if (node) { checkNode(node); } const draft = draftFromValue(semantic === undefined ? null : semantic); baseFilterDraftValue(draft); return Object.freeze({ draft, editable: true, source: text, issue: "" }); }
    catch (error) { return Object.freeze({ draft: null, editable: false, source: text, issue: error instanceof Error ? error.message : String(error) }); }
  };
  return Object.freeze({ global: read(state.root, data.filters), view: read(state.node, data.views[state.index].filters) });
}

/** Generates expressions through the existing parser. Entered values never become JavaScript. */
export function baseFilterPredicateExpression(input: BaseFilterPredicate): string {
  if (!input || typeof input.property !== "string" || !unicode(input.property) || typeof input.value !== "string" || !unicode(input.value) || input.value.length > 2048) { throw new Error("Enter a property and a value of at most 2,048 characters with valid Unicode."); }
  const property = baseProperty(input.property), target = property.kind + "[" + q(property.name) + "]", operator = input.operator;
  if (!["==", "!=", "<", "<=", ">", ">=", "contains", "startsWith", "endsWith", "empty", "not-empty"].includes(operator)) { throw new Error("Choose a supported comparison."); }
  if (operator === "empty" || operator === "not-empty") { return (operator === "not-empty" ? "!" : "") + target + ".isEmpty()"; }
  let value: string;
  switch (input.type) {
    case "text": value = q(input.value); break;
    case "boolean": if (!["true", "false"].includes(input.value)) { throw new Error("Choose true or false for a checkbox value."); } value = input.value; break;
    case "null": value = "null"; break;
    case "number": {
      const number = Number(input.value);
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.value) || !Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number)) { throw new Error("Enter a finite, safely representable number."); }
      value = Object.is(number, -0) ? "-0" : String(number); break;
    }
    default: throw new Error("Choose Text, Number, Checkbox or Null for the comparison value.");
  }
  if (["startsWith", "endsWith"].includes(operator) && input.type !== "text") { throw new Error("Starts with and Ends with require a Text value."); }
  if (["<", "<=", ">", ">="].includes(operator) && !["text", "number"].includes(input.type)) { throw new Error("Ordered comparisons use Text or Number values."); }
  const expression = ["contains", "startsWith", "endsWith"].includes(operator) ? target + "." + operator + "(" + value + ")" : target + " " + operator + " " + value;
  parseBaseExpression(expression); return expression;
}

/** Replaces changed, proved filter spans only. Every unrelated token remains untouched. */
export function planBaseFilters(source: string, selected: string, draft: BaseFilterChanges): BaseFilterPlan {
  const state = owners(source, selected), initial = readBaseFilterState(source, selected), data = state.document.toJS({ maxAliasCount: 32 }) as { views: Record<string, unknown>[] } & Record<string, unknown>;
  const expected = structuredClone(data), edits: { from: number; to: number; insert: string }[] = [], changes: { scope: BaseFilterScope; before: string; after: string }[] = [];
  if (!draft || typeof draft !== "object" || Object.keys(draft).some(key => !["global", "view"].includes(key))) { throw new Error("Choose global or current-view filters."); }
  for (const scope of ["global", "view"] as const) {
    if (!Object.hasOwn(draft, scope)) { continue; }
    const next = baseFilterDraftValue(draft[scope]!), owner = scope === "global" ? state.root : state.node, old = scope === "global" ? data.filters : data.views[state.index].filters;
    if (equal(old ?? null, next)) { continue; }
    if (!initial[scope].editable) { throw new Error(initial[scope].issue); }
    const value = owner.get("filters", true), text = next === null ? "null" : q(next), into = scope === "global" ? expected : expected.views[state.index]; into.filters = next;
    const eol = (() => { const at = state.body.indexOf("\n", value?.range?.[0] ?? owner.range![0]); return at >= 0 ? state.body[at - 1] === "\r" ? "\r\n" : "\n" : state.body.includes("\r\n") ? "\r\n" : "\n"; })();
    if (value === undefined && !owner.has("filters")) {
      const at = owner.range![2], indent = owner.srcToken?.type === "block-map" ? owner.srcToken.indent : 0;
      if (at < state.body.length && state.body[at - 1] !== "\n") { throw refuse(); }
      edits.push({ from: at, to: at, insert: (state.body[at - 1] === "\n" ? "" : eol) + " ".repeat(indent) + "filters: " + text + eol });
    } else {
      if (!value || isAlias(value) || !value.range || value.range[1] <= value.range[0]) { throw refuse(); }
      checkNode(value); const ending = state.body.slice(value.range[0], value.range[1]).match(/\r?\n$/)?.[0] ?? "";
      edits.push({ from: value.range[0], to: value.range[1], insert: text + ending });
    }
    changes.push({ scope, before: old == null ? "No filter" : q(old), after: next === null ? "No filter (all rows may pass this scope)" : q(next) });
  }
  if (!changes.length) { throw new Error("Change a global or current-view filter before reviewing."); }
  // A last-view field and a new global field may share one insertion boundary.
  // The nested field must precede the unindented global field in the final text.
  for (let index = edits.length - 1; index > 0; index--) {
    const edit = edits[index], earlier = edits.findIndex((item, at) => at < index && item.from === edit.from && item.to === edit.to && item.from === item.to);
    if (earlier >= 0) { edits[earlier].insert = edit.insert + edits[earlier].insert; edits.splice(index, 1); }
  }
  let body = state.body, end = body.length;
  for (const edit of [...edits].sort((a, b) => b.from - a.from || b.to - a.to)) { if (edit.from < 0 || edit.to > end || edit.to < edit.from) { throw refuse(); } body = body.slice(0, edit.from) + edit.insert + body.slice(edit.to); end = edit.from; }
  const output = source.slice(0, state.bom) + body, actual = parseDocument(body, { uniqueKeys: true, intAsBigInt: true }).toJS({ maxAliasCount: 32 });
  if (!equal(expected, actual)) { throw new Error("This filter edit would change other YAML or alias ownership. Keep it and edit the filter explicitly in source."); }
  new BaseDocument(output);
  const exact = edits.map(edit => Object.freeze({ ...edit, from: edit.from + state.bom, to: edit.to + state.bom })).sort((a, b) => a.from - b.from), first = exact[0].from, last = Math.max(...exact.map(edit => edit.to));
  return Object.freeze({ source: output, selected, names: Object.freeze(state.model.views.map(view => view.name)), description: `Change ${changes.map(change => change.scope === "global" ? "global filters (every view)" : "filters for “" + selected + "”").join(" and ")}. A row must satisfy both global and current-view filters; search and the view limit still apply. Note contents and other base settings are kept.`, changes: Object.freeze(changes.map(change => Object.freeze(change))), edits: Object.freeze(exact), edit: Object.freeze({ from: first, to: last, insert: output.slice(first, output.length - (source.length - last)) }) });
}

export class BaseFilterReview {
  readonly plan: BaseFilterPlan;
  private readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, draft: BaseFilterChanges, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path); this.path = file.path; this.root = app.vault.rootPath ?? "";
    const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload the current base before changing filters. Existing unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) }; this.guard(); this.plan = planBaseFilters(source, selected, draft);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path); const saved = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles || this.file.path !== this.path
      || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current() || !saved || saved.file.path !== this.path
      || saved.version !== this.baseline.version || saved.content !== this.baseline.content || Boolean(saved.hasBom) !== this.baseline.hasBom) {
      throw new Error("The base, saved source or filter owner changed. Cancel and review the current filters again.");
    }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This filter review was already applied or attempted. Start a fresh review of the current base."); }
    this.started = true; this.guard(); this.applying = true;
    try {
      const actual = await this.app.vault.readDocument(this.path); this.guard();
      if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) { throw new Error("The saved base changed on disk. No filter edit was applied. Reload it and start a fresh review."); }
      this.attempted = true; await this.authority.save(this.plan); this.completed = true;
    } finally { this.applying = false; }
  }
}
