import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Node, type YAMLMap } from "yaml";
import type { App } from "./app";
import { supportedBaseGroupOrderValues } from "./bases-group-order-values";
import { BaseDocument, baseProperty, supportedBaseView } from "./bases-model";
import { baseTableRowHeights, supportedBaseTableColumnSizes } from "./bases-table";
import { builtinSummaryNames, summaryFormula, summaryName } from "./bases-summaries";
import type { BaseViewManagementAuthority, BaseViewPlan } from "./bases-view-management";
import type { TFile } from "./vault";

export const baseSummaryAuthoringLimits = Object.freeze({ definitions: 128, assignments: 128, name: 128, expression: 4096, referenceWork: 25000, references: 128 });
export type BaseSummaryChange = { kind: "add"; name: string; expression: string } | { kind: "edit"; name: string; expression: string }
  | { kind: "duplicate"; name: string; destination: string } | { kind: "rename"; name: string; destination: string }
  | { kind: "remove"; name: string }
  | { kind: "assign"; property: string; name: string | null };
export interface BaseSummaryUse { readonly location: string; readonly detail: string; readonly view: string | null; readonly property: string | null; readonly uncertain: boolean }
export interface BaseSummaryDefinition { readonly name: string; readonly expression: string; readonly definitionSource: string; readonly definitionKind: string; readonly issue: string; readonly editable: boolean; readonly uses: readonly BaseSummaryUse[] }
export interface BaseSummaryAssignment { readonly property: string; readonly label: string; readonly name: string | null; readonly displayed: boolean; readonly issue: string }
export interface BaseSummaryAuthoringState { readonly definitions: readonly BaseSummaryDefinition[]; readonly assignments: readonly BaseSummaryAssignment[]; readonly definitionsIssue: string; readonly assignmentsIssue: string }
export interface BaseSummaryAuthoringPlan extends BaseViewPlan { readonly edits: readonly Readonly<{ from: number; to: number; insert: string }>[]; readonly changes: readonly string[]; readonly warnings: readonly string[] }
type MapNode = YAMLMap<unknown, unknown>;
type Edit = { from: number; to: number; insert: string };
type Data = Record<string, unknown> & { summaries?: Record<string, unknown> | null; views?: Record<string, unknown>[] };
const q = (value: unknown): string => JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const identity = (value: string): string => value.normalize("NFKC").toLowerCase();
const canonical = (key: string): string => { const p = baseProperty(key); return p.kind + "." + p.name; };
const unicode = (value: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
const refuse = (): Error => new Error("This summary setting has ambiguous comments, aliases, anchors, tags or source layout. Keep it and edit this setting in Edit base source.");
function equal(a: unknown, b: unknown): boolean {
  const pending: [unknown, unknown][] = [[a, b]], seen = new WeakMap<object, WeakSet<object>>(); let work = 0;
  while (pending.length) {
    if (++work > 250000) { return false; } const [left, right] = pending.pop()!;
    if (Object.is(left, right)) { continue; }
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) { return false; }
    const prior = seen.get(left); if (prior?.has(right)) { continue; } if (prior) { prior.add(right); } else { seen.set(left, new WeakSet([right])); }
    const keys = Object.keys(left); if (keys.length !== Object.keys(right).length || keys.length + pending.length + work > 250000) { return false; }
    for (const key of keys) { if (!Object.hasOwn(right, key)) { return false; } pending.push([Reflect.get(left, key), Reflect.get(right, key)]); }
  }
  return true;
}
function safeNode(node: Node, comments = false): void {
  let invalid = false;
  visit(node, { Node(_key, item) { if (isAlias(item) || item.tag || "anchor" in item && item.anchor) { invalid = true; } } });
  const walk = (token: unknown): void => { if (!token || typeof token !== "object") { return; } const item = token as Record<string, unknown>; if (comments && item.type === "comment" && typeof item.offset === "number" && node.range && item.offset >= node.range[0] && item.offset < node.range[1]) { invalid = true; } for (const value of Object.values(item)) { if (Array.isArray(value)) { value.forEach(walk); } else if (value && typeof value === "object") { walk(value); } } };
  walk(node.srcToken); if (invalid) { throw refuse(); }
}
function map(node: unknown): MapNode {
  if (!isMap(node) || node.anchor || node.tag || !node.range || !node.srcToken || !["block-map", "flow-collection"].includes(node.srcToken.type)) { throw refuse(); }
  return node;
}
function pair(owner: MapNode, key: string) { return owner.items.find(item => isScalar(item.key) && item.key.value === key); }
function state(source: string, selected: string) {
  const model = new BaseDocument(source), bom = source.startsWith("\ufeff") ? 1 : 0, body = source.slice(bom), document = parseDocument(body, { uniqueKeys: true, keepSourceTokens: true, intAsBigInt: true });
  const root = map(document.contents); if (root.srcToken?.type !== "block-map") { throw refuse(); }
  const seen = new Set<string>(); for (const view of model.views) { const id = identity(view.name); if (seen.has(id)) { throw new Error("Saved view names are ambiguous after Unicode normalization or letter case. Give them distinct names in source first."); } seen.add(id); }
  const index = model.views.findIndex(view => view.name === selected);
  if (index < 0 || !supportedBaseView(model.views[index].type)) { throw new Error("Summary authoring supports the current saved Table, List or Cards view. Keep other renderers and edit their source explicitly."); }
  const data = document.toJS({ maxAliasCount: 32 }) as Data;
  return { model, bom, body, document, root, data, index, selected, eol: body.includes("\r\n") ? "\r\n" : "\n" };
}
function definitions(s: ReturnType<typeof state>): MapNode | null { const node = s.root.get("summaries", true); return node === undefined || isScalar(node) && node.value === null ? null : map(node); }
function viewNode(s: ReturnType<typeof state>, index: number): MapNode {
  const sequence = s.root.get("views", true); if (!isSeq(sequence) || sequence.anchor || sequence.tag || sequence.items.length !== s.model.views.length) { throw refuse(); }
  return map(sequence.items[index]);
}
function assignmentNode(s: ReturnType<typeof state>, index: number): MapNode | null { const node = viewNode(s, index).get("summaries", true); return node === undefined || isScalar(node) && node.value === null ? null : map(node); }
function valueEdit(body: string, node: unknown, literal: string): Edit {
  if (!isNode(node) || isAlias(node) || !isScalar(node) || !node.range || node.range[0] === node.range[1]) { throw refuse(); }
  safeNode(node, true); const [from, to] = node.range, ending = body.slice(from, to).match(/\r?\n$/)?.[0] ?? "";
  return { from, to, insert: literal + ending };
}
function entries(owner: MapNode) {
  return owner.items.map(item => { if (!isScalar(item.key) || !item.key.range || !isNode(item.value) || !item.value.range) { throw refuse(); } return { item, from: item.key.range[0], to: item.value.range[1], end: item.value.range[2] }; });
}
function appendField(body: string, owner: MapNode, key: string, literal: string, eol: string): Edit {
  if (owner.has(key)) { throw new Error("This setting already exists. Choose its existing entry."); }
  const token = owner.srcToken;
  if (token?.type === "flow-collection") {
    const items = entries(owner), closing = token.end.find(item => item.type === "flow-map-end"); if (!closing || closing.offset !== owner.range![1] - 1) { throw refuse(); }
    let previous = token.offset + 1; items.forEach((item, at) => { if (!(at ? /^[ \t\r\n]*,[ \t\r\n]*$/ : /^[ \t\r\n]*$/).test(body.slice(previous, item.from))) { throw refuse(); } previous = item.to; });
    if (!/^[ \t\r\n]*,?[ \t\r\n]*$/.test(body.slice(previous, closing.offset))) { throw refuse(); }
    const at = items.at(-1)?.to ?? closing.offset; return { from: at, to: at, insert: (items.length ? ", " : "") + q(key) + ": " + literal };
  }
  if (token?.type !== "block-map" || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 64) { throw refuse(); }
  const at = owner.range![2]; if (at < body.length && body[at - 1] !== "\n") { throw refuse(); }
  return { from: at, to: at, insert: (body[at - 1] === "\n" ? "" : eol) + " ".repeat(token.indent) + q(key) + ": " + literal + eol };
}
function removeField(body: string, owner: MapNode, key: string): Edit {
  const items = entries(owner), at = items.findIndex(item => isScalar(item.item.key) && item.item.key.value === key), entry = items[at], token = owner.srcToken; if (!entry || !token) { throw refuse(); }
  safeNode(entry.item.key as Node); safeNode(entry.item.value as Node);
  if (token.type === "flow-collection") {
    const closing = token.end.find(item => item.type === "flow-map-end"); if (!closing) { throw refuse(); }
    let previous = token.offset + 1; items.forEach((item, index) => { if (!(index ? /^[ \t\r\n]*,[ \t\r\n]*$/ : /^[ \t\r\n]*$/).test(body.slice(previous, item.from))) { throw refuse(); } previous = item.to; });
    if (!/^[ \t\r\n]*,?[ \t\r\n]*$/.test(body.slice(previous, closing.offset))) { throw refuse(); }
    if (items.length === 1) { return { from: owner.range![0], to: owner.range![1], insert: "{}" }; }
    return at < items.length - 1 ? { from: entry.from, to: items[at + 1].from, insert: "" } : { from: items[at - 1].to, to: entry.to, insert: "" };
  }
  if (token.type !== "block-map") { throw refuse(); }
  const start = body.lastIndexOf("\n", entry.from - 1) + 1, item = token.items[at];
  if (!item || item.start.some(part => part.type === "comment" && part.offset < entry.from) || at === 0 && owner.commentBefore || body.slice(start, entry.from) !== " ".repeat(token.indent)) { throw refuse(); }
  if (items.length === 1) { safeNode(owner, true); const ending = body.slice(owner.range![0], owner.range![1]).match(/\r?\n$/)?.[0] ?? ""; return { from: owner.range![0], to: owner.range![1], insert: "{}" + ending }; }
  if (entry.end < body.length && body[entry.end - 1] !== "\n") { throw refuse(); }
  return { from: start, to: entry.end, insert: "" };
}

/** Named summaries are referenced by native view assignment values, never by expression text. */
function usesFor(s: ReturnType<typeof state>, target: string): BaseSummaryUse[] {
  const found: BaseSummaryUse[] = []; let work = 0, incomplete = false;
  const add = (location: string, detail: string, view: string | null = null, property: string | null = null, uncertain = true): void => {
    if (found.some(item => item.location === location && item.detail === detail)) { return; }
    if (found.length >= baseSummaryAuthoringLimits.references - 1) { incomplete = true; return; }
    found.push(Object.freeze({ location: location.slice(0, 512), detail: detail.slice(0, 4096), view, property, uncertain }));
  };
  for (const view of s.model.views) {
    for (const [property, name] of view.summaries) { if (name === target) { add("View “" + view.name + "”", "Summary for “" + property + "”" + (view.order.some(key => canonical(key) === property) ? "." : " (currently hidden property)."), view.name, property, false); } }
    if (!supportedBaseView(view.type)) { add("View “" + view.name + "”", "This unsupported renderer may use summary names in settings that cannot be proved here."); }
  }
  type Context = "base" | "views" | "view" | "sorts" | "sort" | "properties" | "property" | "definitions" | "opaque";
  const visited = new WeakMap<object, Set<Context>>(), scalarSettings = new Set(["type", "name", "limit", "markers", "indentProperties", "separator", "cardSize", "image", "imageFit", "imageAspectRatio"]);
  const knownWidths = new WeakSet<object>(), knownHeights = new WeakSet<object>();
  for (const view of s.model.views) {
    const value = s.data.views?.[view.index]; if (view.type !== "table" || !value) { continue; }
    try {
      const node = viewNode(s, view.index), sizes = node.get("columnSize", true), height = node.get("rowHeight", true);
      if (isMap(sizes) && supportedBaseTableColumnSizes(value.columnSize)) { safeNode(sizes); knownWidths.add(value); }
      if (isScalar(height) && typeof height.value === "string" && Object.hasOwn(baseTableRowHeights, height.value)) { safeNode(height); knownHeights.add(value); }
    } catch { /* Ambiguous or aliased presentation remains an opaque reference candidate. */ }
  }
  const scan = (value: unknown, location: string, context: Context, depth = 0): void => {
    if (++work > baseSummaryAuthoringLimits.referenceWork || depth > 64) { incomplete = true; return; }
    if (typeof value === "string") { if (context === "opaque" && value.includes(target)) { add(location, "An unknown setting mentions this summary name. Edit that reference explicitly in Source: " + value); } return; }
    if (!value || typeof value !== "object") { return; }
    const previous = visited.get(value); if (previous?.has(context)) { return; } if (previous) { previous.add(context); } else { visited.set(value, new Set([context])); }
    for (const [key, child] of Object.entries(value)) {
      if (work > baseSummaryAuthoringLimits.referenceWork) { break; }
      if (context === "base" && key === "filters" || context === "view" && ["filters", "order", "summaries"].includes(key)
        || context === "view" && key === "groupOrder" && supportedBaseGroupOrderValues(child)
        || context === "view" && key === "columnSize" && knownWidths.has(value)
        || context === "view" && key === "rowHeight" && knownHeights.has(value)
        || context === "view" && scalarSettings.has(key) && (!child || typeof child !== "object")
        || context === "sort" && ["property", "direction"].includes(key)
        || context === "property" && key === "displayName"
        || context === "definitions" && (!child || typeof child !== "object")) { continue; }
      if (context === "opaque" && key.includes(target)) { add(location + " / " + key, "An unknown setting key mentions this summary name. Edit it explicitly in Source."); }
      const next: Context = context === "base" && key === "views" ? "views" : context === "base" && ["summaries", "formulas"].includes(key) ? "definitions"
        : context === "base" && key === "properties" ? "properties" : context === "views" ? "view"
        : context === "view" && key === "sort" ? "sorts" : context === "view" && key === "groupBy" ? "sort"
        : context === "sorts" ? "sort" : context === "properties" ? "property" : "opaque";
      scan(child, location + " / " + key, next, depth + 1);
    }
  };
  scan(s.data, "Base", "base");
  if (incomplete) { found.push(Object.freeze({ location: "Reference review limit", detail: "The bounded reference review could not prove all uses absent. Edit this name explicitly in Source.", view: null, property: null, uncertain: true })); }
  return found;
}
export function baseSummaryUses(source: string, selected: string, target: string): readonly BaseSummaryUse[] { summaryName(target); return Object.freeze(usesFor(state(source, selected), target)); }
export function readBaseSummaryAuthoringState(source: string, selected: string): BaseSummaryAuthoringState {
  const s = state(source, selected), catalog: BaseSummaryDefinition[] = [], assignments: BaseSummaryAssignment[] = []; let definitionsIssue = "", assignmentsIssue = "";
  let owner: MapNode | null = null;
  try { owner = definitions(s); } catch (error) { definitionsIssue = error instanceof Error ? error.message : String(error); }
  for (const [name, value] of Object.entries(s.data.summaries ?? {})) {
    let issue = s.model.summaryErrors.get(name) ?? "", editable = true;
    try { if (!owner) { throw refuse(); } valueEdit(s.body, pair(owner, name)?.value, q("values.length")); } catch (error) { editable = false; issue += (issue ? " " : "") + (error instanceof Error ? error.message : String(error)); }
    if (builtinSummaryNames.has(name)) { issue += (issue ? " " : "") + "This imported custom definition overrides a built-in name; its current meaning is retained."; }
    const node = owner ? pair(owner, name)?.value : null, range = isNode(node) ? node.range : null;
    catalog.push(Object.freeze({ name, expression: typeof value === "string" ? value : "", definitionSource: range ? s.body.slice(range[0], range[1]) : "Source layout unavailable here", definitionKind: value === null ? "null" : Array.isArray(value) ? "list" : typeof value, issue, editable, uses: Object.freeze(usesFor(s, name)) }));
  }
  try { assignmentNode(s, s.index); } catch (error) { assignmentsIssue = error instanceof Error ? error.message : String(error); }
  const view = s.model.views[s.index], keys = [...view.order, ...[...view.summaries.keys()].filter(key => !view.order.some(property => canonical(property) === key))];
  for (const property of keys) { const name = view.summaries.get(canonical(property)) ?? null; assignments.push(Object.freeze({ property, label: s.model.label(property), name, displayed: view.order.some(key => canonical(key) === canonical(property)), issue: name && !builtinSummaryNames.has(name) && !s.model.summaryFormulas.has(name) && !s.model.summaryErrors.has(name) ? "This assignment names an unknown summary. Its original value is retained until explicitly replaced or removed." : "" })); }
  return Object.freeze({ definitions: Object.freeze(catalog), assignments: Object.freeze(assignments), definitionsIssue, assignmentsIssue });
}
function freshName(value: string, existing: Record<string, unknown>, except?: string): void {
  summaryName(value); if (value.trim() !== value || !unicode(value) || /[\x7f-\x9f\u2028\u2029]/u.test(value) || value === "<<") { throw new Error("Choose a summary name without surrounding whitespace, line breaks, control characters or unsafe names."); }
  if ([...builtinSummaryNames].some(name => identity(name) === identity(value)) || Object.keys(existing).some(name => name !== except && identity(name) === identity(value))) { throw new Error("Choose a distinct custom summary name, including built-ins, letter case and Unicode-normalized spelling."); }
}
function expression(value: string): void { if (typeof value !== "string" || !unicode(value)) { throw new Error("Enter a valid Unicode summary expression."); } summaryFormula(value); }

/** Splice only proved spans, then verify every resolved field against the intended change. */
export function planBaseSummaryChange(source: string, selected: string, change: BaseSummaryChange): BaseSummaryAuthoringPlan {
  const s = state(source, selected), expected = structuredClone(s.data), edits: Edit[] = [], changes: string[] = [], warnings: string[] = [];
  if (!change || typeof change !== "object" || !["add", "edit", "duplicate", "rename", "remove", "assign"].includes(change.kind)) { throw new Error("Choose a custom summary or current-view assignment action."); }
  const shape = Object.keys(change).sort().join(",");
  if (shape !== (change.kind === "assign" ? "kind,name,property" : change.kind === "add" || change.kind === "edit" ? "expression,kind,name" : change.kind === "duplicate" || change.kind === "rename" ? "destination,kind,name" : "kind,name")) { throw new Error("This summary action has unsupported fields."); }
  const setAssignment = (index: number, property: string, name: string | null): void => {
    const view = s.data.views?.[index]; if (!view) { throw refuse(); }
    const current = (view.summaries ?? {}) as Record<string, string>, aliases = Object.keys(current).filter(key => canonical(key) === canonical(property));
    if (aliases.length > 1) { throw new Error("This view repeats a canonical summary property. Choose its intended spelling in Source first."); }
    const key = aliases[0] ?? property, owner = assignmentNode(s, index), node = viewNode(s, index);
    const next = { ...((expected.views![index].summaries ?? {}) as Record<string, string>) }; if (name === null) { delete next[key]; } else { next[key] = name; }
    expected.views = expected.views!.map((item, at) => at === index ? { ...item, summaries: next } : item);
    if (owner) { edits.push(name === null ? removeField(s.body, owner, key) : aliases.length ? valueEdit(s.body, pair(owner, key)?.value, q(name)) : appendField(s.body, owner, key, q(name), s.eol)); }
    else { if (name === null) { throw new Error("This property has no summary to remove."); } const old = node.get("summaries", true); edits.push(old === undefined ? appendField(s.body, node, "summaries", q(next), s.eol) : valueEdit(s.body, old, q(next))); }
  };
  if (change.kind === "assign") {
    if (typeof change.property !== "string" || !unicode(change.property)) { throw new Error("Choose a supported property identifier."); }
    const key = canonical(change.property), view = s.model.views[s.index], entry = view.summaries.get(key), displayed = view.order.some(property => canonical(property) === key);
    if (!displayed && !view.summaries.has(key)) { throw new Error("Choose a displayed property or an existing hidden assignment."); }
    if (change.name !== null) { summaryName(change.name); if (!builtinSummaryNames.has(change.name) && !Object.hasOwn(s.data.summaries ?? {}, change.name)) { throw new Error("Choose an existing built-in or custom summary. Unknown imported assignments can be removed or replaced explicitly."); } }
    if ((entry ?? null) === change.name) { throw new Error("Change this property's summary assignment before reviewing."); }
    if (!view.summaries.has(key) && view.summaries.size >= baseSummaryAuthoringLimits.assignments) { throw new Error("Keep at most 128 summary assignments in a view."); }
    setAssignment(s.index, change.property, change.name);
    changes.push("View “" + selected + "”, property “" + key + "”: " + (entry ? q(entry) : "None") + " → " + (change.name === null ? "None" : q(change.name)) + ". Other views and shared definitions are kept.");
    if (!displayed) { warnings.push("This property is currently hidden; its summary appears when the property is displayed again."); }
    if (change.name && s.model.summaryErrors.has(change.name)) { warnings.push("This imported custom definition has an expression error; the assignment remains explicit and will show a summary error until repaired."); }
    if (change.name) { warnings.push("Summary compatibility depends on the matching values. Mixed types or cell errors can produce a visible summary error; no note properties are changed."); }
  } else {
    summaryName(change.name); const owner = definitions(s), current = s.data.summaries ?? {}, found = Object.hasOwn(current, change.name), value = current[change.name];
    if (change.kind !== "add" && !found) { throw new Error("The selected custom summary no longer exists. Choose its current name."); }
    expected.summaries = { ...current };
    if (change.kind === "add" || change.kind === "duplicate") {
      const destination = change.kind === "add" ? change.name : change.destination, expr = change.kind === "add" ? change.expression : value;
      freshName(destination, current); if (Object.keys(current).length >= baseSummaryAuthoringLimits.definitions) { throw new Error("Keep at most 128 custom summary definitions in this base."); }
      if (typeof expr !== "string") { throw new Error("Repair this invalid summary definition before duplicating it."); } expression(expr); expected.summaries[destination] = expr;
      if (owner) { edits.push(appendField(s.body, owner, destination, q(expr), s.eol)); } else { const old = s.root.get("summaries", true); edits.push(old === undefined ? appendField(s.body, s.root, "summaries", q({ [destination]: expr }), s.eol) : valueEdit(s.body, old, q({ [destination]: expr }))); }
      changes.push((change.kind === "duplicate" ? "Duplicate “" + change.name + "” as “" : "Add custom summary “") + destination + "”: " + q(expr) + ". The shared definition is available to every view; assignments are kept.");
    } else if (change.kind === "edit") {
      expression(change.expression); if (value === change.expression) { throw new Error("Change this summary expression before reviewing."); } if (!owner) { throw refuse(); }
      expected.summaries[change.name] = change.expression; edits.push(valueEdit(s.body, pair(owner, change.name)?.value, q(change.expression)));
      const originalNode = pair(owner, change.name)?.value, originalRange = isNode(originalNode) ? originalNode.range : null;
      const original = typeof value === "string" ? q(value) : "invalid " + (value === null ? "null" : typeof value) + " definition with exact YAML: " + (originalRange ? s.body.slice(originalRange[0], originalRange[1]) : "unavailable");
      changes.push("Edit shared summary “" + change.name + "”: " + original + " → " + q(change.expression) + ". Every assignment using this name reads the new expression.");
      for (const use of usesFor(s, change.name)) { changes.push(use.location + ": " + use.detail); }
    } else {
      if (!owner) { throw refuse(); } const uses = usesFor(s, change.name), uncertain = uses.filter(use => use.uncertain);
      if (uncertain.length || change.kind === "remove" && uses.length) { throw new Error("Keep summary “" + change.name + "” until these references are edited explicitly:\n" + (uncertain.length ? uncertain : uses).slice(0, 32).map(use => use.location + ": " + use.detail).join("\n")); }
      if (change.kind === "rename") {
        freshName(change.destination, current, change.name); if (change.destination === change.name) { throw new Error("Choose a different summary name before reviewing."); }
        const target = pair(owner, change.name), key = target?.key; if (!isScalar(key) || !key.range || /[\r\n]/.test(s.body.slice(key.range[0], key.range[1])) || !isNode(target?.value)) { throw refuse(); } safeNode(key); safeNode(target.value);
        delete expected.summaries[change.name]; expected.summaries[change.destination] = value; edits.push({ from: key.range[0], to: key.range[1], insert: q(change.destination) });
        changes.push("Rename shared summary “" + change.name + "” to “" + change.destination + "”. Keep its exact definition and atomically update " + uses.length + " proved native view assignment(s).");
        for (const use of uses) { const index = s.model.views.findIndex(view => view.name === use.view); setAssignment(index, use.property!, change.destination); changes.push(use.location + ": “" + use.property + "” → " + q(change.destination) + "."); }
      } else { delete expected.summaries[change.name]; edits.push(removeField(s.body, owner, change.name)); changes.push("Remove unassigned custom summary “" + change.name + "”. Other definitions and every view assignment are kept."); }
    }
    warnings.push("Custom expressions run over values in the existing bounded summary interpreter. Syntax validation does not guarantee a compatible scalar result for every column or group.");
  }
  let body = s.body, end = body.length; for (const edit of [...edits].sort((a, b) => b.from - a.from)) { if (edit.from < 0 || edit.to < edit.from || edit.to > end) { throw refuse(); } body = body.slice(0, edit.from) + edit.insert + body.slice(edit.to); end = edit.from; }
  const output = source.slice(0, s.bom) + body, actualDocument = parseDocument(body, { uniqueKeys: true, intAsBigInt: true }), actual = actualDocument.toJS({ maxAliasCount: 32 });
  if (actualDocument.errors.length || actualDocument.warnings.length || !equal(expected, actual)) { throw new Error("This edit would alter unrelated YAML or alias ownership. Keep the source and edit this setting explicitly."); } new BaseDocument(output);
  const exact = edits.map(edit => Object.freeze({ ...edit, from: edit.from + s.bom, to: edit.to + s.bom })).sort((a, b) => a.from - b.from), first = exact[0].from, last = Math.max(...exact.map(edit => edit.to));
  return Object.freeze({ source: output, selected, names: Object.freeze(s.model.views.map(view => view.name)), description: "Review the selected Bases summary change and its complete exact YAML. Shared definitions affect all views and embeds; assignments affect only the listed view properties. Note files are kept.", changes: Object.freeze(changes), warnings: Object.freeze(warnings), edits: Object.freeze(exact), edit: Object.freeze({ from: first, to: last, insert: output.slice(first, output.length - (source.length - last)) }) });
}

export class BaseSummaryAuthoringReview {
  readonly plan: BaseSummaryAuthoringPlan;
  private readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, change: BaseSummaryChange, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path); this.path = file.path; this.root = app.vault.rootPath ?? ""; const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload this base before managing summaries. Unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) }; this.guard(); this.plan = planBaseSummaryChange(source, selected, change);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path); const saved = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles || this.file.path !== this.path || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current() || !saved || saved.file.path !== this.path || saved.version !== this.baseline.version || saved.content !== this.baseline.content || Boolean(saved.hasBom) !== this.baseline.hasBom) { throw new Error("The base, saved source or summary owner changed. Cancel and review the current summary again."); }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This summary review was already applied or attempted. Start a fresh review."); } this.started = true; this.guard(); this.applying = true;
    try { const actual = await this.app.vault.readDocument(this.path); this.guard(); if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) { throw new Error("The saved base changed on disk. No summary edit was applied. Reload it and review again."); } this.attempted = true; await this.authority.save(this.plan); this.completed = true; } finally { this.applying = false; }
  }
}
