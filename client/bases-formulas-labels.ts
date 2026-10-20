import { isAlias, isMap, isNode, isScalar, parseDocument, visit, type Node, type YAMLMap } from "yaml";
import type { App } from "./app";
import { supportedBaseGroupOrderValues } from "./bases-group-order-values";
import { parseBaseExpression } from "./bases-expression";
import { BaseDocument, baseProperty, supportedBaseView } from "./bases-model";
import type { BaseViewManagementAuthority, BaseViewPlan } from "./bases-view-management";
import type { TFile } from "./vault";

export const baseFormulaAuthoringLimits = Object.freeze({ formulas: 128, name: 256, expression: 4096, label: 256, referenceWork: 25000, references: 128 });
export type BaseFormulaLabelChange = { kind: "add"; name: string; expression: string }
  | { kind: "edit"; name: string; expression: string }
  | { kind: "duplicate" | "rename"; name: string; destination: string }
  | { kind: "remove"; name: string }
  | { kind: "label"; property: string; label: string | null };
export interface BaseFormulaReference { readonly location: string; readonly detail: string }
export interface BaseFormulaEntry { readonly name: string; readonly expression: string; readonly definitionSource: string; readonly definitionKind: string; readonly issue: string; readonly editable: boolean; readonly references: readonly BaseFormulaReference[] }
export interface BaseLabelEntry { readonly property: string; readonly label: string | null; readonly issue: string }
export interface BaseFormulaLabelState { readonly formulas: readonly BaseFormulaEntry[]; readonly labels: readonly BaseLabelEntry[]; readonly formulasIssue: string; readonly labelsIssue: string }
export interface BaseFormulaLabelPlan extends BaseViewPlan { readonly edits: readonly Readonly<{ from: number; to: number; insert: string }>[]; readonly changes: readonly string[]; readonly warnings: readonly string[] }
type MapNode = YAMLMap<unknown, unknown>;
type Edit = { from: number; to: number; insert: string };
const q = (value: unknown): string => JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const unsafeNames = new Set(["__proto__", "constructor", "prototype", "<<"]);
const unicode = (text: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(text);
const canonical = (key: string): string => { const p = baseProperty(key); return p.kind + "." + p.name; };
const refuse = (): Error => new Error("This mapping or value has ambiguous comments, aliases, anchors, tags or source layout. Keep it and edit this setting in Edit base source.");
function equal(a: unknown, b: unknown): boolean {
  const seen = new WeakMap<object, WeakSet<object>>(), pending: [unknown, unknown][] = [[a, b]]; let work = 0;
  while (pending.length) {
    if (++work > 250000) { return false; } const [left, right] = pending.pop()!;
    if (Object.is(left, right)) { continue; }
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) { return false; }
    const previous = seen.get(left); if (previous?.has(right)) { continue; } if (previous) { previous.add(right); } else { seen.set(left, new WeakSet([right])); }
    const keys = Object.keys(left); if (keys.length !== Object.keys(right).length || keys.length + pending.length + work > 250000) { return false; }
    for (const key of keys) { if (!Object.hasOwn(right, key)) { return false; } pending.push([Reflect.get(left, key), Reflect.get(right, key)]); }
  }
  return true;
}
function name(value: string): void {
  if (typeof value !== "string" || value.trim() !== value || !value || !unicode(value) || unsafeNames.has(value)) { throw new Error("Choose a nonempty formula name without surrounding whitespace or unsafe names."); }
  baseProperty("formula." + value);
}
function expression(value: string): void { if (typeof value !== "string" || !unicode(value)) { throw new Error("Enter a valid Unicode formula expression."); } parseBaseExpression(value); }
function safeNode(node: Node, comments = false): void {
  let invalid = false;
  visit(node, { Node(_key, item) { if (isAlias(item) || item.tag || "anchor" in item && item.anchor) { invalid = true; } } });
  const walk = (token: unknown): void => { if (!token || typeof token !== "object") { return; } const t = token as Record<string, unknown>; if (comments && t.type === "comment" && typeof t.offset === "number" && node.range && t.offset >= node.range[0] && t.offset < node.range[1]) { invalid = true; } for (const child of Object.values(t)) { if (Array.isArray(child)) { child.forEach(walk); } else if (child && typeof child === "object") { walk(child); } } };
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
  const names = new Set<string>(); for (const view of model.views) { const id = view.name.normalize("NFKC").toLowerCase(); if (names.has(id)) { throw new Error("Saved view names are ambiguous after Unicode normalization or letter case. Choose distinct names in source first."); } names.add(id); }
  const view = model.views.find(view => view.name === selected); if (!view || !supportedBaseView(view.type)) { throw new Error("Formula and label authoring supports the current saved Table, List or Cards view. Keep other view types and edit their source explicitly."); }
  const data = document.toJS({ maxAliasCount: 32 }) as Record<string, unknown> & { formulas?: Record<string, unknown> | null; properties?: Record<string, Record<string, unknown>> | null; views?: Record<string, unknown>[] };
  return { model, bom, body, document, root, data, eol: body.includes("\r\n") ? "\r\n" : "\n" };
}

/** Static references are read from the actual expression AST, including bracket spelling. */
export function baseFormulaExpressionReferences(value: string): { names: string[]; dynamic: boolean } {
  const found = new Set<string>(); let dynamic = false;
  const walk = (item: unknown, parent?: Record<string, unknown>): void => {
    if (!item || typeof item !== "object") { return; } const n = item as Record<string, unknown>;
    if (n.type === "name" && n.name === "formula") {
      const key = parent?.key as Record<string, unknown> | undefined;
      if (parent?.type === "member" && parent.object === n && key?.type === "literal" && typeof key.value === "string") { found.add(key.value); }
      else { dynamic = true; }
    }
    for (const [key, child] of Object.entries(n)) { if (key === "value" || key === "name" || key === "op" || key === "type") { continue; } if (Array.isArray(child)) { child.forEach(item => walk(item, n)); } else if (child && typeof child === "object") { walk(child, n); } }
  };
  walk(parseBaseExpression(value)); return { names: [...found], dynamic };
}
function expressionEntries(data: ReturnType<typeof state>["data"]): { entries: { location: string; value: string; formula?: string }[]; incomplete: boolean } {
  const result: { location: string; value: string; formula?: string }[] = [];
  for (const [key, value] of Object.entries(data.formulas ?? {})) { if (typeof value === "string") { result.push({ location: "Formula “" + key + "”", value, formula: key }); } }
  for (const [key, value] of Object.entries((data.summaries ?? {}) as Record<string, unknown>)) { if (typeof value === "string") { result.push({ location: "Custom summary “" + key + "”", value }); } }
  const examined = new WeakSet<object>(); let work = 0, incomplete = false;
  const filters = (value: unknown, location: string, depth = 0): void => {
    if (++work > baseFormulaAuthoringLimits.referenceWork || depth > 64) { incomplete = true; return; }
    if (typeof value === "string") { result.push({ location, value }); }
    else if (value && typeof value === "object") {
      if (examined.has(value)) { return; } examined.add(value);
      for (const [key, children] of Object.entries(value)) { if (incomplete) { break; } if (Array.isArray(children)) { for (let index = 0; index < children.length && !incomplete; index++) { filters(children[index], location + " / " + key + " " + (index + 1), depth + 1); } } }
    }
  };
  filters(data.filters, "Global filter"); (data.views ?? []).forEach((view, index) => filters(view.filters, "View “" + String(view.name ?? index + 1) + "” filter"));
  return { entries: result, incomplete };
}
export function baseFormulaReferences(source: string, selected: string, target: string): BaseFormulaReference[] {
  name(target); return referencesFor(state(source, selected), target);
}
function referencesFor(s: ReturnType<typeof state>, target: string): BaseFormulaReference[] {
  const found: BaseFormulaReference[] = [];
  let truncated = false;
  const add = (reference: BaseFormulaReference): void => {
    if (found.some(item => item.location === reference.location && item.detail === reference.detail)) { return; }
    if (found.length >= baseFormulaAuthoringLimits.references - 1) { truncated = true; return; }
    found.push({ location: reference.location.slice(0, 512), detail: reference.detail.length > 4096 ? reference.detail.slice(0, 4096) + "… (review the complete setting in Source)" : reference.detail });
  };
  const expressions = expressionEntries(s.data);
  if (expressions.incomplete) { add({ location: "Reference review limit", detail: "This source exceeds the bounded filter reference traversal. Further formula dependencies cannot be proved; edit destructive name changes explicitly in Source." }); }
  for (const entry of expressions.entries) {
    try { const refs = baseFormulaExpressionReferences(entry.value); if (refs.names.includes(target)) { add({ location: entry.location, detail: entry.value }); } else if (refs.dynamic) { add({ location: entry.location, detail: "Dynamic formula access cannot prove which name it uses: " + entry.value }); } }
    catch { add({ location: entry.location, detail: "This expression cannot be parsed to prove its formula dependencies. Repair it in source or Edit formula first." }); }
  }
  const key = "formula." + target;
  let work = 0, incomplete = false;
  const take = (): boolean => { if (++work <= baseFormulaAuthoringLimits.referenceWork) { return true; } incomplete = true; return false; };
  type PropertyContext = "base" | "views" | "view" | "opaque";
  const scanned = new WeakMap<object, Set<PropertyContext>>();
  const scan = (value: unknown, location: string, depth = 0, context: PropertyContext = "opaque"): void => {
    if (!take()) { return; } if (depth > 64) { incomplete = true; return; }
    if (typeof value === "string") { if (value === key) { add({ location, detail: "Contains the property identifier “" + key + "”. This setting is retained and cannot be rewritten automatically." }); } return; }
    if (!value || typeof value !== "object") { return; }
    const prior = scanned.get(value); if (prior?.has(context)) { return; } if (prior) { prior.add(context); } else { scanned.set(value, new Set([context])); }
    if (Array.isArray(value)) { for (let index = 0; index < value.length && !incomplete; index++) { scan(value[index], location + " / " + (index + 1), depth + 1, context === "views" ? "view" : "opaque"); } return; }
    for (const [name, item] of Object.entries(value)) {
      if (incomplete) { break; }
      if (context === "view" && name === "groupOrder" && supportedBaseGroupOrderValues(item)) { continue; }
      if (name === key) { add({ location: location + " / " + name, detail: "Configures “" + key + "”." }); }
      scan(item, location + " / " + name, depth + 1, context === "base" && name === "views" ? "views" : "opaque");
    }
  };
  scan(s.data, "Base", 0, "base");
  for (const view of s.model.views) { if (!supportedBaseView(view.type)) { add({ location: "View “" + view.name + "”", detail: "This unsupported view may declare formula references that cannot be proved here." }); } }
  // Unknown settings are kept. An expression-like namespace mention in one is
  // conservatively a blocker, rather than silently assuming it is inert data.
  type OpaqueContext = "base" | "views" | "view" | "definitions" | "expression" | "filter" | "opaque";
  // A string is known because of its schema occurrence, never because another
  // occurrence happens to have equal text. Aliases may share objects between a
  // known container and an opaque setting, so visit each object once per context.
  const examined = new WeakMap<object, Set<OpaqueContext>>();
  const unrelatedIdentifier = (value: string): boolean => {
    if (!value.startsWith("formula.")) { return false; }
    try { const references = baseFormulaExpressionReferences(value); return !references.dynamic && references.names.length === 1 && references.names[0] !== target && value === "formula." + references.names[0]; } catch { return false; }
  };
  const opaque = (value: unknown, location: string, context: OpaqueContext, depth = 0): void => {
    if (!take()) { return; } if (depth > 64) { incomplete = true; return; }
    if (context === "expression" || context === "filter") { return; }
    if (typeof value === "string") {
      if (/\bformula\b/u.test(value) && value !== key && !unrelatedIdentifier(value)) { add({ location, detail: "An unknown setting mentions formula access; edit references explicitly in source: " + value }); }
    } else if (value && typeof value === "object") {
      const previous = examined.get(value); if (previous?.has(context)) { return; } if (previous) { previous.add(context); } else { examined.set(value, new Set([context])); }
      for (const [field, item] of Object.entries(value)) {
        if (incomplete) { break; }
        if (context === "view" && field === "groupOrder" && supportedBaseGroupOrderValues(item)) { continue; }
        const child: OpaqueContext = context === "base" && (field === "formulas" || field === "summaries") ? "definitions"
          : context === "base" && field === "filters" || context === "view" && field === "filters" ? "filter"
          : context === "base" && field === "views" ? "views"
          : context === "views" ? "view"
          : context === "definitions" && typeof item === "string" ? "expression" : "opaque";
        opaque(item, location + " / " + field, child, depth + 1);
      }
    }
  };
  opaque(s.data, "Base", "base");
  if (incomplete || truncated) { found.push({ location: "Reference review limit", detail: incomplete ? "This source exceeds the bounded reference traversal. Absence of further formula uses cannot be proved; edit destructive name changes explicitly in Source." : "More references exist than can be listed here. Edit all affected settings explicitly in Source before changing this name." }); }
  return found;
}
function validateChangedFormula(data: ReturnType<typeof state>["data"], changed: string): string[] {
  const definitions = data.formulas ?? {}, graph = new Map<string, string[]>(), dynamic: string[] = [];
  for (const [key, value] of Object.entries(definitions)) { if (typeof value !== "string") { continue; } try { const refs = baseFormulaExpressionReferences(value); graph.set(key, refs.names); if (refs.dynamic) { dynamic.push(key); } } catch { /* Unchanged invalid definitions remain repairable separately. */ } }
  const visiting = new Set<string>(), visited = new Set<string>(), warnings: string[] = [];
  const visit = (key: string): void => {
    if (visiting.has(key)) { throw new Error("The changed formula would contain a dependency cycle involving “" + key + "”. Keep it in source or remove that dependency."); }
    if (visited.has(key)) { return; } visiting.add(key);
    if (!graph.has(key)) { throw new Error("The changed formula depends on missing or invalid formula “" + key + "”. Add or repair that formula first."); }
    if (dynamic.includes(key)) { warnings.push("Formula “" + key + "” uses dynamic formula access. Its runtime dependencies and cycles cannot be proved here; row evaluation may report an error."); }
    for (const next of graph.get(key)!) { if (!Object.hasOwn(definitions, next)) { throw new Error("The changed formula depends on missing formula “" + next + "”. Add it first."); } visit(next); }
    visiting.delete(key); visited.add(key);
  };
  visit(changed); return warnings;
}
function valueEdit(body: string, node: unknown, replacement: string): Edit {
  if (!node || typeof node !== "object" || isAlias(node) || !("range" in node) || !Array.isArray(node.range)) { throw refuse(); }
  const n = node as Node; safeNode(n, true); if (!n.range || !isScalar(n)) { throw refuse(); }
  const [from, to] = n.range, ending = body.slice(from, to).match(/\r?\n$/)?.[0] ?? "";
  if (from === to) { throw new Error("This implicit empty value needs source editing before formula or label authoring."); }
  return { from, to, insert: replacement + ending };
}
function mapEntries(owner: MapNode) {
  return owner.items.map(item => {
    if (!isScalar(item.key) || !item.key.range || !isNode(item.value) || !item.value.range) { throw refuse(); }
    return { item, from: item.key.range[0], to: item.value.range[1], end: item.value.range[2] };
  });
}
function appendField(body: string, owner: MapNode, key: string, literal: string, eol: string): Edit {
  if (owner.has(key)) { throw new Error("That setting already exists. Choose its existing entry."); }
  const token = owner.srcToken;
  if (token?.type === "flow-collection") {
    const entries = mapEntries(owner), closing = token.end.find(item => item.type === "flow-map-end"); if (!closing || closing.offset !== owner.range![1] - 1) { throw refuse(); }
    let prior = token.offset + 1; entries.forEach((entry, at) => { if (!(at ? /^[ \t\r\n]*,[ \t\r\n]*$/ : /^[ \t\r\n]*$/).test(body.slice(prior, entry.from))) { throw refuse(); } prior = entry.to; });
    if (!/^[ \t\r\n]*,?[ \t\r\n]*$/.test(body.slice(prior, closing.offset))) { throw refuse(); }
    const at = entries.at(-1)?.to ?? closing.offset; return { from: at, to: at, insert: (entries.length ? ", " : "") + q(key) + ": " + literal };
  }
  if (token?.type !== "block-map" || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 64) { throw refuse(); }
  const at = owner.range![2]; if (at < body.length && body[at - 1] !== "\n") { throw refuse(); }
  return { from: at, to: at, insert: (body[at - 1] === "\n" ? "" : eol) + " ".repeat(token.indent) + q(key) + ": " + literal + eol };
}
function removeField(body: string, owner: MapNode, key: string): Edit {
  const entries = mapEntries(owner), at = entries.findIndex(entry => isScalar(entry.item.key) && entry.item.key.value === key), entry = entries[at], token = owner.srcToken; if (!entry || !token) { throw refuse(); }
  safeNode(entry.item.key as Node); safeNode(entry.item.value as Node);
  if (token.type === "flow-collection") {
    const closing = token.end.find(item => item.type === "flow-map-end"); if (!closing) { throw refuse(); }
    let previous = token.offset + 1; entries.forEach((item, index) => { if (!(index ? /^[ \t\r\n]*,[ \t\r\n]*$/ : /^[ \t\r\n]*$/).test(body.slice(previous, item.from))) { throw refuse(); } previous = item.to; });
    if (!/^[ \t\r\n]*,?[ \t\r\n]*$/.test(body.slice(previous, closing.offset))) { throw refuse(); }
    if (entries.length === 1) { return { from: owner.range![0], to: owner.range![1], insert: "{}" }; }
    return at < entries.length - 1 ? { from: entry.from, to: entries[at + 1].from, insert: "" } : { from: entries[at - 1].to, to: entry.to, insert: "" };
  }
  if (token.type !== "block-map") { throw refuse(); }
  const item = token.items[at], keyNode = entry.item.key as Node, start = body.lastIndexOf("\n", entry.from - 1) + 1;
  if (!item || !keyNode.range || item.start.some(t => t.type === "comment" && t.offset < entry.from) || at === 0 && owner.commentBefore || body.slice(start, entry.from) !== " ".repeat(token.indent)) { throw refuse(); }
  if (entries.length === 1) {
    safeNode(owner, true); const ending = body.slice(owner.range![0], owner.range![1]).match(/\r?\n$/)?.[0] ?? ""; return { from: owner.range![0], to: owner.range![1], insert: "{}" + ending };
  }
  if (entry.end < body.length && body[entry.end - 1] !== "\n") { throw refuse(); }
  return { from: start, to: entry.end, insert: "" };
}
function mappingField(s: ReturnType<typeof state>, key: "formulas" | "properties"): MapNode | null { const node = s.root.get(key, true); if (node === undefined || isScalar(node) && node.value === null) { return null; } return map(node); }
export function readBaseFormulaLabelState(source: string, selected: string): BaseFormulaLabelState {
  const s = state(source, selected), formulas: BaseFormulaEntry[] = [], labels: BaseLabelEntry[] = []; let formulasIssue = "", labelsIssue = "";
  try { const owner = mappingField(s, "formulas"); for (const [key, value] of Object.entries(s.data.formulas ?? {})) {
    let issue = s.model.formulaErrors.get(key) ?? "", editable = true; try { if (!owner) { throw refuse(); } valueEdit(s.body, pair(owner, key)?.value, q("true")); } catch (error) { editable = false; issue += (issue ? " " : "") + (error instanceof Error ? error.message : String(error)); }
    const original = owner ? pair(owner, key)?.value : null, range = isNode(original) ? original.range : null;
    formulas.push({ name: key, expression: typeof value === "string" ? value : "", definitionSource: range ? s.body.slice(range[0], range[1]) : "Source layout unavailable here", definitionKind: value === null ? "null" : Array.isArray(value) ? "list" : typeof value, issue, editable, references: referencesFor(s, key) });
  } } catch (error) { formulasIssue = error instanceof Error ? error.message : String(error); }
  try { mappingField(s, "properties"); const keys = Object.keys(s.data.properties ?? {}), counts = new Map<string, number>(); for (const key of keys) { const id = canonical(key); counts.set(id, (counts.get(id) ?? 0) + 1); } for (const key of keys.slice(0, 256)) { const duplicate = counts.get(canonical(key))! > 1, label = typeof s.data.properties![key].displayName === "string" ? s.data.properties![key].displayName as string : null; labels.push({ property: key, label, issue: duplicate ? "This property repeats its canonical note/file/formula spelling. Choose the intended configuration in source first." : label !== null && (label.length > baseFormulaAuthoringLimits.label || /[\x00-\x1f\x7f]/.test(label) || !unicode(label)) ? "This imported label is multiline, oversized or contains unsupported characters. It is kept until you explicitly type a complete replacement or remove it; the original decoded text is shown here." : "" }); } if (keys.length > 256) { labelsIssue = "The visual catalog shows the first 256 property settings. Enter an explicit property identifier to edit another label, or use Source."; } } catch (error) { labelsIssue = error instanceof Error ? error.message : String(error); }
  return Object.freeze({ formulas: Object.freeze(formulas), labels: Object.freeze(labels), formulasIssue, labelsIssue });
}

/** The selected setting alone is spliced, then the complete resolved candidate is proved. */
export function planBaseFormulaLabelChange(source: string, selected: string, change: BaseFormulaLabelChange): BaseFormulaLabelPlan {
  const s = state(source, selected), expected = structuredClone(s.data), edits: Edit[] = [], changes: string[] = [], warnings: string[] = [];
  if (!change || typeof change !== "object" || !["add", "edit", "duplicate", "rename", "remove", "label"].includes(change.kind)) { throw new Error("Choose a formula or display-label action."); }
  if (change.kind === "label") {
    if (Object.keys(change).sort().join(",") !== "kind,label,property" || typeof change.property !== "string" || !unicode(change.property)) { throw new Error("Choose a supported property identifier."); }
    const id = canonical(change.property), aliases = Object.keys(s.data.properties ?? {}).filter(key => canonical(key) === id), property = aliases[0] ?? change.property;
    if (aliases.length > 1) { throw new Error("This property repeats its canonical note/file/formula spelling. Choose the intended configuration in source first."); }
    if (change.label !== null && (typeof change.label !== "string" || !change.label.trim() || change.label.length > baseFormulaAuthoringLimits.label || /[\x00-\x1f\x7f]/.test(change.label) || !unicode(change.label))) { throw new Error("Enter a nonempty display label of at most 256 characters without line breaks or control characters, or choose Remove label."); }
    const properties = mappingField(s, "properties"), config = s.data.properties?.[property], old = config?.displayName;
    if (change.label === null && (!config || !Object.hasOwn(config, "displayName")) || change.label !== null && old === change.label) { throw new Error("Change the display label before reviewing."); }
    if (!expected.properties) { expected.properties = {}; }
    if (!config) {
      if (change.label === null) { throw new Error("This property has no label to remove."); }
      expected.properties[property] = { displayName: change.label };
      if (properties) { edits.push(appendField(s.body, properties, property, q({ displayName: change.label }), s.eol)); }
      else { const value = s.root.get("properties", true); edits.push(value === undefined ? appendField(s.body, s.root, "properties", q({ [property]: { displayName: change.label } }), s.eol) : valueEdit(s.body, value, q({ [property]: { displayName: change.label } }))); }
    } else {
      if (!properties) { throw refuse(); } const propertyPair = pair(properties, property), owner = map(propertyPair?.value);
      if (change.label === null) { delete expected.properties[property].displayName; edits.push(removeField(s.body, owner, "displayName")); }
      else { expected.properties[property].displayName = change.label; const display = pair(owner, "displayName"); edits.push(display ? valueEdit(s.body, display.value, q(change.label)) : appendField(s.body, owner, "displayName", q(change.label), s.eol)); }
    }
    changes.push("Global label for “" + id + "”: " + (typeof old === "string" ? q(old) : "default property name") + " → " + (change.label === null ? "default property name" : q(change.label)) + ". All views and embeds using this property read the same label.");
  } else {
    name(change.name); const formulas = mappingField(s, "formulas"), existing = s.data.formulas ?? {}, value = existing[change.name], found = Object.hasOwn(existing, change.name);
    const shape = Object.keys(change).sort().join(","); if (shape !== (change.kind === "add" || change.kind === "edit" ? "expression,kind,name" : change.kind === "duplicate" || change.kind === "rename" ? "destination,kind,name" : "kind,name")) { throw new Error("The formula action has unsupported fields."); }
    if (change.kind !== "add" && !found) { throw new Error("The selected formula is no longer defined. Choose its current name."); }
    if (!expected.formulas) { expected.formulas = {}; }
    if (change.kind === "add" || change.kind === "duplicate") {
      const destination = change.kind === "add" ? change.name : change.destination, expr = change.kind === "add" ? change.expression : value;
      name(destination); if (Object.keys(existing).some(key => key.normalize("NFKC").toLowerCase() === destination.normalize("NFKC").toLowerCase())) { throw new Error("Choose a distinct formula name, including letter case and Unicode-normalized spelling."); }
      if (Object.keys(existing).length >= baseFormulaAuthoringLimits.formulas) { throw new Error("Keep at most 128 formulas in this base."); } if (typeof expr !== "string") { throw new Error("Repair this invalid formula before duplicating it."); } expression(expr);
      expected.formulas[destination] = expr; warnings.push(...validateChangedFormula(expected, destination));
      if (formulas) { edits.push(appendField(s.body, formulas, destination, q(expr), s.eol)); } else { const old = s.root.get("formulas", true); edits.push(old === undefined ? appendField(s.body, s.root, "formulas", q({ [destination]: expr }), s.eol) : valueEdit(s.body, old, q({ [destination]: expr }))); }
      changes.push((change.kind === "duplicate" ? "Duplicate “" + change.name + "” as “" : "Add formula “") + destination + "”: " + q(expr) + ". Choose formula." + destination + " in Configure view to display it; notes are not modified.");
      const dependencies = baseFormulaExpressionReferences(expr).names; changes.push(dependencies.length ? "Static formula dependencies: " + dependencies.map(key => "“" + key + "”").join(", ") + "." : "No static formula dependencies. Note/file values still resolve separately for every row.");
    } else if (change.kind === "edit") {
      expression(change.expression); if (value === change.expression) { throw new Error("Change the formula expression before reviewing."); } if (!formulas) { throw refuse(); }
      expected.formulas[change.name] = change.expression; warnings.push(...validateChangedFormula(expected, change.name)); edits.push(valueEdit(s.body, pair(formulas, change.name)?.value, q(change.expression)));
      const originalNode = pair(formulas, change.name)?.value, originalRange = isNode(originalNode) ? originalNode.range : null, original = typeof value === "string" ? q(value) : "invalid " + (value === null ? "null" : typeof value) + " definition with exact YAML: " + (originalRange ? s.body.slice(originalRange[0], originalRange[1]) : "unavailable");
      changes.push("Edit formula “" + change.name + "”: " + original + " → " + q(change.expression) + ". Every view/filter/formula using this name sees the new expression.");
      const dependencies = baseFormulaExpressionReferences(change.expression).names; changes.push(dependencies.length ? "Static formula dependencies: " + dependencies.map(key => "“" + key + "”").join(", ") + "." : "No static formula dependencies. Note/file values still resolve separately for every row.");
    } else {
      if (!formulas) { throw refuse(); } const references = baseFormulaReferences(source, selected, change.name);
      if (references.length) { throw new Error("Keep formula “" + change.name + "” until its references are edited explicitly:\n" + references.slice(0, 32).map(ref => ref.location + ": " + ref.detail).join("\n") + (references.length > 32 ? "\n… and more references." : "")); }
      if (change.kind === "rename") {
        name(change.destination); if (change.destination === change.name) { throw new Error("Choose a different formula name before reviewing."); } if (Object.keys(existing).some(key => key.normalize("NFKC").toLowerCase() === change.destination.normalize("NFKC").toLowerCase())) { throw new Error("Choose a distinct formula name, including letter case and Unicode-normalized spelling."); }
        const target = pair(formulas, change.name), key = target?.key; if (!isScalar(key) || !key.range || key.anchor || key.tag || /[\r\n]/.test(s.body.slice(key.range[0], key.range[1]))) { throw refuse(); }
        delete expected.formulas[change.name]; expected.formulas[change.destination] = value; edits.push({ from: key.range[0], to: key.range[1], insert: q(change.destination) }); changes.push("Rename unreferenced formula “" + change.name + "” to “" + change.destination + "”. Its exact expression and all unrelated settings remain.");
      } else { delete expected.formulas[change.name]; edits.push(removeField(s.body, formulas, change.name)); changes.push("Remove unreferenced formula “" + change.name + "” and its selected entry source. Other definitions and labels remain."); }
    }
  }
  let body = s.body, end = body.length; for (const edit of [...edits].sort((a, b) => b.from - a.from)) { if (edit.from < 0 || edit.to < edit.from || edit.to > end) { throw refuse(); } body = body.slice(0, edit.from) + edit.insert + body.slice(edit.to); end = edit.from; }
  const output = source.slice(0, s.bom) + body, actualDoc = parseDocument(body, { uniqueKeys: true, intAsBigInt: true }), actual = actualDoc.toJS({ maxAliasCount: 32 });
  if (actualDoc.errors.length || actualDoc.warnings.length || !equal(expected, actual)) { throw new Error("This edit would alter other YAML or alias ownership. Keep the source and edit this setting explicitly."); } new BaseDocument(output);
  const exact = edits.map(edit => Object.freeze({ ...edit, from: edit.from + s.bom, to: edit.to + s.bom })).sort((a, b) => a.from - b.from), first = exact[0].from, last = Math.max(...exact.map(edit => edit.to));
  return Object.freeze({ source: output, selected, names: Object.freeze(s.model.views.map(view => view.name)), description: "Review this global Bases change. Only the selected formula or display label changes; note files and unrelated base settings are kept.", changes: Object.freeze(changes), warnings: Object.freeze(warnings), edits: Object.freeze(exact), edit: Object.freeze({ from: first, to: last, insert: output.slice(first, output.length - (source.length - last)) }) });
}

export class BaseFormulaLabelReview {
  readonly plan: BaseFormulaLabelPlan;
  private readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, change: BaseFormulaLabelChange, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path); this.path = file.path; this.root = app.vault.rootPath ?? ""; const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload the current base before changing formulas or labels. Its unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) }; this.guard(); this.plan = planBaseFormulaLabelChange(source, selected, change);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path); const saved = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles || this.file.path !== this.path || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current() || !saved || saved.file.path !== this.path || saved.version !== this.baseline.version || saved.content !== this.baseline.content || Boolean(saved.hasBom) !== this.baseline.hasBom) { throw new Error("The base, saved source or formula/label owner changed. Cancel and review the current setting again."); }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This formula/label review was already applied or attempted. Start a fresh review."); } this.started = true; this.guard(); this.applying = true;
    try { const actual = await this.app.vault.readDocument(this.path); this.guard(); if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) { throw new Error("The saved base changed on disk. No formula or label edit was applied. Reload it and review again."); } this.attempted = true; await this.authority.save(this.plan); this.completed = true; } finally { this.applying = false; }
  }
}
