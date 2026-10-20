import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit } from "yaml";
import { jsonNumberIdentity } from "./contracts";
import { sameValue } from "./markdown";
import { MAX_STRUCTURED_PROPERTY_CHARACTERS, MAX_STRUCTURED_PROPERTY_DEPTH, MAX_STRUCTURED_PROPERTY_NODES, multilineText } from "./multiline-properties";

export const MAX_STRUCTURED_SCALAR_TEXT = 4096;
export type StructuredScalar = string | number | boolean | null;
export type StructuredScalarType = "string" | "number" | "boolean" | "null";
export type StructuredPropertyPath = readonly (string | number)[];
export interface StructuredPropertyReviewTarget { readonly kind: "edit" | "add" | "remove" | "rename" | "move-up" | "move-down" | "move-to" | "duplicate" | "copy-to" | "move-into" | "copy-to-property" | "move-to-property" | "wrap-map" | "wrap-list" | "unwrap-value" | "promote-entries"; readonly path: StructuredPropertyPath }
type StructuredPropertyOperationKind = Exclude<StructuredPropertyReviewTarget["kind"], "edit">;
export interface StructuredScalarLeaf { readonly path: StructuredPropertyPath; readonly value: StructuredScalar; readonly from: number; readonly to: number; readonly implicit?: true }
export interface StructuredEditorEntry { label: string; text: string; children?: StructuredEditorEntry[]; leaf?: StructuredScalarLeaf; path?: StructuredPropertyPath; array?: boolean }
const unsafeKeys = new Set(["__proto__", "prototype", "constructor", "<<"]);
const refusal = (): Error => new Error("This nested YAML value cannot be edited safely here. Review its source.");
const scalarText = (value: StructuredScalar): string => Object.is(value, -0) ? "-0" : JSON.stringify(value);
export const structuredScalarType = (value: StructuredScalar): StructuredScalarType => value === null ? "null" : typeof value as Exclude<StructuredScalarType, "null">;

function checkedScalar(value: unknown): asserts value is StructuredScalar {
  if (value === null || typeof value === "boolean") { return; }
  if (typeof value === "string") { checkedText(value); return; }
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) { return; }
  throw refusal();
}

function checkedText(value: string): string {
  if (value.length > MAX_STRUCTURED_SCALAR_TEXT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) { throw refusal(); }
  return value;
}

/** Validate descriptors before reading data or cloning; shared owners are refused. */
export function checkedStructuredPropertySnapshot(value: unknown): unknown {
  const seen = new WeakSet<object>(); let nodes = 0, characters = 0;
  const text = (value: string): void => { checkedText(value); characters += value.length; if (characters > MAX_STRUCTURED_PROPERTY_CHARACTERS) { throw refusal(); } };
  const inspect = (value: unknown, depth: number): void => {
    if (++nodes > MAX_STRUCTURED_PROPERTY_NODES || depth > MAX_STRUCTURED_PROPERTY_DEPTH) { throw refusal(); }
    if (typeof value === "string") { text(value); return; }
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) { return; }
    if (!value || typeof value !== "object" || seen.has(value) || Object.getOwnPropertySymbols(value).length) { throw refusal(); }
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) { throw refusal(); }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.getOwnPropertyNames(value);
    if (keys.length > MAX_STRUCTURED_PROPERTY_NODES + 1 || array && (keys.length !== value.length + 1 || !descriptors.length || descriptors.length.value !== value.length)) { throw refusal(); }
    let index = 0;
    for (const key of keys) {
      if (array && key === "length") { continue; }
      const descriptor = descriptors[key];
      if (unsafeKeys.has(key) || !descriptor.enumerable || !("value" in descriptor) || array && key !== String(index++)) { throw refusal(); }
      text(key); inspect(descriptor.value, depth + 1);
    }
  };
  if (!value || typeof value !== "object") { throw refusal(); }
  inspect(value, 0); return structuredClone(value);
}

/** Decimal identity checks reject rounded digits, overflow, underflow and unsafe integers. */
export function structuredPropertyNumber(text: string): number {
  const literal = text.trim();
  if (!literal || literal.length > 128) { throw new Error("Enter a finite number with at most 128 characters, without losing precision."); }
  let value: number;
  if (/^0(?:x[0-9a-f]+|o[0-7]+)$/i.test(literal)) {
    const integer = BigInt(literal);
    if (integer > BigInt(Number.MAX_SAFE_INTEGER)) { throw new Error("Enter a safely representable number."); }
    value = Number(integer);
  } else {
    value = Number(literal);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(literal) || !Number.isFinite(value)
      || Math.abs(value) > Number.MAX_SAFE_INTEGER || jsonNumberIdentity(literal) !== jsonNumberIdentity(String(value))) {
      throw new Error("Enter a finite number without losing precision.");
    }
  }
  return value;
}

function sourceDocument(source: string) {
  if (source.length > 1_048_576) { throw refusal(); }
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(source), closing = /^---[ \t]*(?:\r?\n|$)/gm;
  if (!opening) { throw refusal(); }
  closing.lastIndex = opening[0].length; const end = closing.exec(source);
  if (!end || end.index - opening[0].length > 65_536) { throw refusal(); }
  const body = source.slice(opening[0].length, end.index), doc = parseDocument(body, { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length || doc.warnings.length || !isMap(doc.contents) || doc.contents.items.length > 256) { throw refusal(); }
  let nodes = 0;
  visit(doc, (_key, _node, path) => { if (++nodes > 8192 || path.length > 64) { throw refusal(); } });
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || unsafeKeys.has(pair.key.value) || pair.key.tag || pair.key.anchor) { throw refusal(); }
  }
  return { body, doc, offset: opening[0].length };
}

/** Empty scalar ranges need a proven punctuation boundary, never a guessed span. */
function implicitScalarInsertion(parsed: ReturnType<typeof sourceDocument>, target: unknown, path: StructuredPropertyPath): { from: number; prefix: string; suffix: string } {
  if (!path.length || !isMap(target) && !isSeq(target)) { throw refusal(); }
  const node = target.getIn([...path], true), owner = path.length === 1 ? target : target.getIn(path.slice(0, -1), true), key = path.at(-1)!;
  if (!isScalar(node) || node.value !== null || node.source !== "" || !node.range || node.range[0] !== node.range[1] || node.tag || node.anchor
    || node.srcToken && (node.srcToken.type !== "scalar" || node.srcToken.source !== "" || node.srcToken.offset !== node.range[0])
    || !isMap(owner) && !isSeq(owner) || !owner.srcToken || !("items" in owner.srcToken)) { throw refusal(); }
  const at = node.range[0], token = owner.srcToken; let start: number, flow = false;
  if (isMap(owner)) {
    const index = owner.items.findIndex(pair => isScalar(pair.key) && pair.key.value === key && pair.value === node), item = token.items[index];
    const pair = owner.items[index];
    if (typeof key !== "string" || index < 0 || !item || !isScalar(pair.key) || !pair.key.range || !item.key
      || item.key.offset !== pair.key.range[0] || !["block-map", "flow-collection"].includes(token.type)
      || item.start.some(part => !["space", "newline", "comment", "comma"].includes(part.type))) { throw refusal(); }
    const colon = item.sep?.find(part => part.type === "map-value-ind");
    if (!colon || colon.source !== ":" || !/^[ \t]*$/.test(parsed.body.slice(pair.key.range[1], colon.offset))) { throw refusal(); }
    start = colon.offset + 1; flow = token.type === "flow-collection";
    if (flow && (!owner.range || /[\r\n]/.test(parsed.body.slice(owner.range[0], owner.range[1])))) { throw refusal(); }
  } else {
    if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0 || owner.items[key] !== node || token.type !== "block-seq") { throw refusal(); }
    const item = token.items[key], indicator = item?.start.find(part => part.type === "seq-item-ind");
    if (!indicator || indicator.source !== "-" || item.start.some(part => !["space", "newline", "comment", "seq-item-ind"].includes(part.type))) { throw refusal(); }
    start = indicator.offset + 1;
  }
  if (start > at || !/^[ \t]*$/.test(parsed.body.slice(start, at)) || !(flow ? /[,}]/ : /[\r\n#]/).test(parsed.body[at] ?? "")) { throw refusal(); }
  return { from: parsed.offset + at, prefix: at === start ? " " : "", suffix: parsed.body[at] === "#" ? " " : "" };
}

export const structuredScalarLeafEditable = (leaf: StructuredScalarLeaf): boolean => leaf.from < leaf.to || leaf.implicit === true;

function reviewedSource(source: string, name: string) {
  const parsed = sourceDocument(source), root = parsed.doc.contents;
  if (!isMap(root)) { throw refusal(); }
  const target = root.items.find(pair => isScalar(pair.key) && pair.key.value === name)?.value;
  if (!isMap(target) && !isSeq(target)) { throw refusal(); }
  const leaves: StructuredScalarLeaf[] = [];
  let nodes = 0, characters = 0;
  const text = (value: string): string => { checkedText(value); characters += value.length; if (characters > MAX_STRUCTURED_PROPERTY_CHARACTERS) { throw refusal(); } return value; };
  const inspect = (node: unknown, label: string, path: StructuredPropertyPath, depth: number): StructuredEditorEntry => {
    if (++nodes > MAX_STRUCTURED_PROPERTY_NODES || depth > MAX_STRUCTURED_PROPERTY_DEPTH || !isNode(node) || isAlias(node)
      || node.tag || "anchor" in node && node.anchor) { throw refusal(); }
    text(label);
    if (isScalar(node)) {
      const value = node.value;
      if (value !== null && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") { throw refusal(); }
      if (typeof value === "string") { text(value); }
      if (typeof value === "number" && (!node.source || !Object.is(structuredPropertyNumber(node.source), value))) { throw refusal(); }
      const range = node.range;
      if (!range || range.some(position => !Number.isSafeInteger(position)) || range[0] < 0 || range[0] > range[1] || range[1] > range[2] || range[2] > parsed.body.length) { throw refusal(); }
      const leaf: StructuredScalarLeaf = { path, value, from: parsed.offset + range[0], to: parsed.offset + range[1] };
      if (value === null && range[0] === range[1]) { try { implicitScalarInsertion(parsed, target, path); Object.assign(leaf, { implicit: true }); } catch { /* The null remains inspectable and Source-only. */ } }
      leaves.push(leaf); return { label, text: scalarText(value), leaf };
    }
    const children: StructuredEditorEntry[] = [];
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string" || unsafeKeys.has(pair.key.value) || pair.key.tag || pair.key.anchor) { throw refusal(); }
        children.push(inspect(pair.value, pair.key.value, [...path, pair.key.value], depth + 1));
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => children.push(inspect(item, `[${index}]`, [...path, index], depth + 1)));
    } else { throw refusal(); }
    return { label, text: `${isSeq(node) ? "List" : "Map"} (${children.length})`, children, path, array: isSeq(node) };
  };
  const entry = inspect(target, "", [], 0), value = target.toJS(parsed.doc, { maxAliasCount: 0 });
  checkedStructuredPropertySnapshot(value);
  return { ...parsed, target, entries: entry.children!, leaves, value };
}

// Shared source proof for the independently supported structural operations.
export { reviewedSource as reviewedStructuredPropertySource };

export function structuredPropertyModel(value: unknown, source: string | undefined, name: string): { entries: StructuredEditorEntry[]; leaves: StructuredScalarLeaf[] } | null {
  try {
    const snapshot = checkedStructuredPropertySnapshot(value);
    if (source === undefined) { return null; }
    const model = reviewedSource(source, name);
    if (!sameValue(snapshot, model.value)) { return null; }
    return { entries: model.entries, leaves: model.leaves };
  } catch { return null; }
}

function leafAt(leaves: readonly StructuredScalarLeaf[], path: StructuredPropertyPath): StructuredScalarLeaf {
  if (!Array.isArray(path) || !path.length || path.length > MAX_STRUCTURED_PROPERTY_DEPTH || path.some(key => typeof key === "string" ? unsafeKeys.has(key) : !Number.isSafeInteger(key) || key < 0)) { throw refusal(); }
  const leaf = leaves.find(leaf => leaf.path.length === path.length && leaf.path.every((key, index) => key === path[index]));
  if (!leaf) { throw refusal(); } return leaf;
}

/** Only existing scalar leaves may change; their explicitly selected type may change too. */
export function replaceStructuredPropertyValue(value: unknown, path: StructuredPropertyPath, prior: StructuredScalar, next: StructuredScalar): unknown {
  checkedScalar(prior); checkedScalar(next);
  const result = checkedStructuredPropertySnapshot(value);
  if (!Array.isArray(path) || !path.length || path.length > MAX_STRUCTURED_PROPERTY_DEPTH) { throw refusal(); }
  let owner = result;
  for (const [index, key] of path.entries()) {
    if (!owner || typeof owner !== "object" || (Array.isArray(owner) ? typeof key !== "number" || !Number.isSafeInteger(key) || key < 0 : typeof key !== "string" || unsafeKeys.has(key))) { throw refusal(); }
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor || !("value" in descriptor)) { throw refusal(); }
    if (index === path.length - 1) {
      if (!Object.is(descriptor.value, prior)) { throw refusal(); }
      if (typeof next === "string") { checkedText(next); }
      if (typeof next === "number" && (!Number.isFinite(next) || Math.abs(next) > Number.MAX_SAFE_INTEGER)) { throw refusal(); }
      Object.defineProperty(owner, key, { ...descriptor, value: next });
    } else { owner = descriptor.value; }
  }
  checkedStructuredPropertySnapshot(result); return result;
}

/** Direct, bounded original-CST splice; complete YAML semantics prove its intent. */
export function replaceStructuredPropertyScalarSource(original: string, name: string, path: StructuredPropertyPath, value: StructuredScalar): string {
  const before = reviewedSource(original, name), old = leafAt(before.leaves, path);
  const expected = replaceStructuredPropertyValue(before.value, path, old.value, value);
  if (Object.is(old.value, value)) { return original; }
  const complete = before.doc.toJS({ maxAliasCount: 50 });
  Object.defineProperty(complete, name, { value: expected, enumerable: true, writable: true, configurable: true });
  const node = before.target.getIn([...path], true);
  if (!isScalar(node)) { throw refusal(); }
  if (old.from === old.to) {
    const insertion = implicitScalarInsertion(before, before.target, path);
    const result = original.slice(0, insertion.from) + insertion.prefix + scalarText(value).replace(/[\u0085\u2028\u2029]/g, value => "\\u" + value.charCodeAt(0).toString(16).padStart(4, "0")) + insertion.suffix + original.slice(insertion.from);
    const final = sourceDocument(result);
    if (!sameValue(final.doc.toJS({ maxAliasCount: 50 }), complete)) { throw refusal(); }
    return result;
  }
  if (!node.srcToken) { throw refusal(); }
  let suffix = "", tokenSource: string;
  if (node.srcToken.type === "block-scalar") {
    const props = node.srcToken.props;
    if (props[0]?.type !== "block-scalar-header") { throw refusal(); }
    const header = props.map(token => { if (!("source" in token)) { throw refusal(); } return token.source; }).join("");
    suffix = header.slice(props[0].source.length);
    if (!/\r?\n$/.test(suffix)) { throw refusal(); }
    tokenSource = header + node.srcToken.source;
  } else if (["scalar", "single-quoted-scalar", "double-quoted-scalar"].includes(node.srcToken.type) && "source" in node.srcToken) {
    tokenSource = node.srcToken.source;
  } else { throw refusal(); }
  if (node.srcToken.offset !== old.from - before.offset || original.slice(old.from, old.to) !== tokenSource) { throw refusal(); }
  const replacement = scalarText(value).replace(/[\u0085\u2028\u2029]/g, value => "\\u" + value.charCodeAt(0).toString(16).padStart(4, "0")) + suffix;
  const result = original.slice(0, old.from) + replacement + original.slice(old.to);
  const final = sourceDocument(result);
  if (!sameValue(final.doc.toJS({ maxAliasCount: 50 }), complete)) { throw refusal(); }
  return result;
}

/** Other scalar editors continue to reject lossy intermediate serialization. */
export function preserveStructuredPropertySource(updated: string, original: string, name: string, path: StructuredPropertyPath, expectedValue?: StructuredScalar): string {
  const before = reviewedSource(original, name), after = reviewedSource(updated, name);
  const old = leafAt(before.leaves, path), next = leafAt(after.leaves, path);
  if (expectedValue !== undefined && !Object.is(next.value, expectedValue)) { throw refusal(); }
  const expected = replaceStructuredPropertyValue(before.value, path, old.value, next.value);
  if (!sameValue(expected, after.value)) { throw refusal(); }
  const result = replaceStructuredPropertyScalarSource(original, name, path, next.value), final = sourceDocument(result);
  if (!sameValue(final.doc.toJS({ maxAliasCount: 50 }), after.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  return result;
}

export function createStructuredEditorInspector(document: Document, entries: StructuredEditorEntry[], name: string, array: boolean, options: {
  writable: boolean; unavailable?: string; current: () => boolean; edit: (leaf: StructuredScalarLeaf, button: HTMLButtonElement, preview: HTMLElement) => void;
  source?: (target: StructuredPropertyReviewTarget) => void; sourceWritable?: boolean;
  link?: (leaf: StructuredScalarLeaf) => HTMLAnchorElement | null;
  registerReview?: (target: StructuredPropertyReviewTarget, button: HTMLButtonElement, open: () => void) => void;
  operations?: { add: ReadonlySet<string>; remove: ReadonlySet<string>; rename?: ReadonlySet<string>; "move-up"?: ReadonlySet<string>; "move-down"?: ReadonlySet<string>; "move-to"?: ReadonlySet<string>; duplicate?: ReadonlySet<string>; "copy-to"?: ReadonlySet<string>; "move-into"?: ReadonlySet<string>; "copy-to-property"?: ReadonlySet<string>; "move-to-property"?: ReadonlySet<string>; "wrap-map"?: ReadonlySet<string>; "wrap-list"?: ReadonlySet<string>; "unwrap-value"?: ReadonlySet<string>; "promote-entries"?: ReadonlySet<string>; moves?: ReadonlyMap<string, { up: boolean; down: boolean }>; limits: ReadonlyMap<string, string>; open: (kind: StructuredPropertyOperationKind, path: StructuredPropertyPath, button: HTMLButtonElement, preview: HTMLElement) => void };
}): HTMLElement {
  const details = document.createElement("details"), summary = document.createElement("summary"), help = document.createElement("p");
  details.className = "metadata-structured-inspector"; details.dataset.propertyStructured = name;
  summary.textContent = `${array ? "List" : "Map"} (${entries.length}) — inspect`;
  summary.setAttribute("aria-label", `Inspect structured property ${name}`);
  help.textContent = options.writable ? "Choose Text, Number, Boolean or Null, then review and Apply or Cancel. Proven layouts offer Add, Remove, Rename, Duplicate, Copy to and Move into another container, plus Move up/down or to a final position. Wrap a value in Map/List, unwrap one child value, or promote compatible entries without overwriting keys. Ambiguous layouts stay in Source." : options.unavailable ?? "Read-only resolved YAML values. Open this note in a writable editor to change nested values.";
  const sourceButton = (target: StructuredPropertyReviewTarget, available = true): HTMLButtonElement | null => {
    if (!options.source) { return null; }
    const button = document.createElement("button"); button.type = "button"; button.className = "metadata-structured-edit"; button.textContent = "Review in Source";
    button.dataset.propertyStructuredSource = JSON.stringify(target); button.disabled = !options.sourceWritable || !available;
    button.dataset.propertyStructuredSourceAvailable = String(available);
    button.setAttribute("aria-label", `Review ${target.kind} ${name} ${JSON.stringify(target.path)} in Source`);
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => { if (available && options.sourceWritable && options.current()) { options.source!(target); } });
    return button;
  };
  const operationLabels: Record<StructuredPropertyOperationKind, readonly [string, string, string]> = {
    add: ["Add entry", "propertyStructuredAdd", "Add to"], remove: ["Remove entry", "propertyStructuredRemove", "Remove from"], rename: ["Rename key", "propertyStructuredRename", "Rename key in"],
    "move-up": ["Move up", "propertyStructuredMoveUp", "Move up in"], "move-down": ["Move down", "propertyStructuredMoveDown", "Move down in"], "move-to": ["Move to…", "propertyStructuredMoveTo", "Move to final position in"],
    duplicate: ["Duplicate entry", "propertyStructuredDuplicate", "Duplicate entry in"], "copy-to": ["Copy to…", "propertyStructuredCopyTo", "Copy entry from"], "move-into": ["Move into…", "propertyStructuredMoveInto", "Move entry from"],
    "copy-to-property": ["Copy to another property…", "propertyStructuredCopyToProperty", "Copy entry to another property from"], "move-to-property": ["Move to another property…", "propertyStructuredMoveToProperty", "Move entry to another property from"],
    "wrap-map": ["Wrap in Map…", "propertyStructuredWrapMap", "Wrap value in Map in"], "wrap-list": ["Wrap in List", "propertyStructuredWrapList", "Wrap value in List in"],
    "unwrap-value": ["Unwrap single value", "propertyStructuredUnwrapValue", "Unwrap single value in"], "promote-entries": ["Promote entries", "propertyStructuredPromoteEntries", "Promote entries in"]
  };
  const operationButton = (kind: StructuredPropertyOperationKind, path: StructuredPropertyPath, preview: HTMLElement): HTMLElement | null => {
    const identity = JSON.stringify(path), moving = kind === "move-up" || kind === "move-down" || kind === "move-to", available = options.operations?.[kind]?.has(identity) === true;
    if (!available && !(moving && options.operations?.moves?.has(identity))) { return null; }
    const button = document.createElement("button"); button.type = "button"; button.className = "metadata-structured-edit";
    const [text, data, label] = operationLabels[kind]; button.textContent = text; button.disabled = !options.writable || !available;
    button.dataset[data] = identity; button.setAttribute("aria-label", `${label} ${name} ${identity}`);
    if (moving && !available) { button.title = "This entry has no proven destination within the review limit. Reorder it in Source."; }
    button.addEventListener("mousedown", event => event.preventDefault());
    const open = (): void => { if (available && options.writable && options.current()) { options.operations!.open(kind, path, button, preview); } };
    button.addEventListener("click", open); options.registerReview?.({ kind, path }, button, open);
    const source = sourceButton({ kind, path }, available);
    if (source) { const choice = document.createElement("span"); choice.className = "metadata-structured-choice"; choice.append(button, source); return choice; }
    return button;
  };
  const operationLimit = (path: StructuredPropertyPath): HTMLElement | null => {
    const message = options.operations?.limits.get(JSON.stringify(path)); if (!message) { return null; }
    const limit = document.createElement("p"); limit.className = "metadata-multiline-help"; limit.dataset.propertyStructuredOperationLimit = JSON.stringify(path); limit.textContent = message; return limit;
  };
  const render = (entries: StructuredEditorEntry[]): HTMLUListElement => {
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li"), label = document.createElement("span");
      label.className = "metadata-structured-key"; label.textContent = entry.label;
      if (entry.children) {
        const branch = document.createElement("details"), heading = document.createElement("summary");
        heading.append(label, document.createTextNode(": " + entry.text)); branch.append(heading, render(entry.children)); item.append(branch);
        const add = operationButton("add", entry.path!, heading); if (add) { branch.insertBefore(add, branch.lastElementChild); }
        const remove = operationButton("remove", entry.path!, branch); if (remove) { item.append(remove); }
        const rename = operationButton("rename", entry.path!, heading); if (rename) { item.append(rename); }
        for (const kind of ["move-up", "move-down", "move-to", "duplicate", "copy-to", "move-into", "copy-to-property", "move-to-property", "wrap-map", "wrap-list", "unwrap-value", "promote-entries"] as const) { const move = operationButton(kind, entry.path!, heading); if (move) { item.append(move); } }
      } else if (entry.leaf) {
        const preview = document.createElement("span"), value = document.createElement("code");
        value.className = "metadata-structured-leaf"; value.textContent = entry.text; preview.append(label, document.createTextNode(": "), options.link?.(entry.leaf) ?? value); item.append(preview);
        if (structuredScalarLeafEditable(entry.leaf)) {
          const button = document.createElement("button"); button.type = "button"; button.className = "metadata-structured-edit"; button.textContent = "Edit";
          button.dataset.propertyStructuredEdit = JSON.stringify(entry.leaf.path); button.disabled = !options.writable;
          button.setAttribute("aria-label", `Edit ${name} ${JSON.stringify(entry.leaf.path)} (${structuredScalarType(entry.leaf.value)})`);
          button.addEventListener("mousedown", event => event.preventDefault());
          const open = (): void => { if (options.writable && options.current()) { options.edit(entry.leaf!, button, preview); } };
          button.addEventListener("click", open); options.registerReview?.({ kind: "edit", path: entry.leaf.path }, button, open); item.append(button);
          const source = sourceButton({ kind: "edit", path: entry.leaf.path }); if (source) { item.append(source); }
        } else { const limit = document.createElement("span"); limit.className = "metadata-multiline-help"; limit.dataset.propertyStructuredLimit = "implicit-null"; limit.textContent = " Implicit null — edit this empty YAML value in source."; item.append(limit); }
        const remove = operationButton("remove", entry.leaf.path, preview); if (remove) { item.append(remove); }
        const rename = operationButton("rename", entry.leaf.path, preview); if (rename) { item.append(rename); }
        for (const kind of ["move-up", "move-down", "move-to", "duplicate", "copy-to", "move-into", "copy-to-property", "move-to-property", "wrap-map", "wrap-list", "unwrap-value", "promote-entries"] as const) { const move = operationButton(kind, entry.leaf.path, preview); if (move) { item.append(move); } }
      }
      const limit = operationLimit(entry.path ?? entry.leaf!.path); if (limit) { item.append(limit); }
      list.append(item);
    }
    return list;
  };
  details.append(summary, help); const add = operationButton("add", [], help); if (add) { details.append(add); } const limit = operationLimit([]); if (limit) { details.append(limit); } details.append(render(entries)); return details;
}

export interface StructuredScalarEditor { readonly element: HTMLElement; readonly input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; readonly active: boolean; refreshReview(): void; dispose(): void }
export interface StructuredTextEditor {
  readonly element: HTMLElement; readonly input: HTMLTextAreaElement;
  value(): string; update(value: string): void; changed(): void; assert(value: string): void;
  linksAllowed(): boolean;
  lock(locked: boolean): void; dispose(): void;
}
export function createStructuredScalarEditor(document: Document, options: {
  value: StructuredScalar; label: string; current: () => boolean; apply: (value: StructuredScalar) => Promise<boolean>;
  error: (message: string) => void; closed: () => void;
  alwaysApply?: boolean; applyLabel?: string; review?: (value: StructuredScalar) => string;
  textLinks?: (input: HTMLTextAreaElement, update: (value: string) => void) => { element: HTMLElement; dispose(): void };
  textEditor?: (value: string, refresh: () => void) => StructuredTextEditor;
  emptyCollections?: { review: (kind: "map" | "list") => string; apply: (kind: "map" | "list") => Promise<boolean> };
}): StructuredScalarEditor {
  checkedScalar(options.value);
  const element = document.createElement("div"), actions = document.createElement("div"), help = document.createElement("span");
  const typeLabel = document.createElement("label"), type = document.createElement("select"), valueHost = document.createElement("div"), review = document.createElement("p");
  element.className = "metadata-structured-editor"; type.className = "metadata-input metadata-structured-type";
  type.dataset.propertyStructuredType = ""; type.dataset.metadataInput = ""; type.setAttribute("aria-label", "Value type for " + options.label);
  typeLabel.textContent = "Value type "; typeLabel.append(type); valueHost.className = "metadata-structured-value";
  review.className = "metadata-structured-review"; review.dataset.propertyStructuredPreview = ""; review.setAttribute("aria-live", "polite");
  type Kind = StructuredScalarType | "map" | "list";
  const kinds: readonly Kind[] = options.emptyCollections ? ["string", "number", "boolean", "null", "map", "list"] : ["string", "number", "boolean", "null"], labels = { string: "Text", number: "Number", boolean: "Boolean", null: "Null", map: "Empty Map", list: "Empty List" };
  for (const kind of kinds) { const option = document.createElement("option"); option.value = kind; option.textContent = labels[kind]; type.append(option); }
  const initialType = structuredScalarType(options.value), drafts = new Map<Kind, string>([
    ["string", typeof options.value === "string" ? multilineText(options.value) : options.value === null ? "" : scalarText(options.value)],
    ["number", typeof options.value === "number" ? scalarText(options.value) : ""],
    ["boolean", typeof options.value === "boolean" ? String(options.value) : "false"], ["null", "null"], ["map", "{}"], ["list", "[]"]
  ]);
  let kind: Kind = initialType, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const initial = drafts.get(initialType)!;
  const apply = document.createElement("button"), cancel = document.createElement("button");
  apply.type = cancel.type = "button"; apply.textContent = options.applyLabel ?? "Apply value"; cancel.textContent = "Cancel";
  apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = ""; actions.className = "metadata-structured-actions"; actions.append(apply, cancel);
  help.className = "metadata-multiline-help"; help.textContent = "Type and value stay a draft until Apply. Ctrl/⌘+Enter applies; Escape cancels. The property's assigned type is unchanged.";
  element.append(typeLabel, valueHost, review, actions, help);
  let closed = false, busy = false, composing = false, textLinks: { element: HTMLElement; dispose(): void } | null = null, textEditor: StructuredTextEditor | null = null;
  const controls = new WeakSet<HTMLElement>();
  const close = (): void => { if (closed) { return; } closed = true; textLinks?.dispose(); textLinks = null; textEditor?.dispose(); element.remove(); options.closed(); };
  const current = (): boolean => options.current() && [element, typeLabel, type, valueHost, input].every(node => node.checkVisibility?.() ?? true);
  const candidate = (): StructuredScalar => {
    if (type.value !== kind || !kinds.includes(kind)) { throw new Error("Choose a supported scalar value type."); }
    if (kind === "null" || kind === "map" || kind === "list") { return null; }
    if (kind === "string") { return checkedText(textEditor?.value() ?? multilineText(input.value)); }
    if (kind === "number") { return structuredPropertyNumber(input.value); }
    if (input.value === "true") { return true; } if (input.value === "false") { return false; }
    throw new Error("Choose true or false for this boolean value.");
  };
  const preview = (): void => {
    if (textLinks && textEditor) { textLinks.element.hidden = !textEditor.linksAllowed(); }
    try { const next = candidate(); review.textContent = kind === "map" || kind === "list" ? options.emptyCollections!.review(kind) : options.review?.(next) ?? `${labels[initialType]}: ${scalarText(options.value)} → ${labels[kind]}: ${scalarText(next)}`; }
    catch (issue) { review.textContent = issue instanceof Error ? issue.message : String(issue); }
  };
  const save = async (): Promise<void> => {
    if (closed || busy || composing) { return; }
    if (!current()) { options.error("The note or nested property owner changed. Cancel this draft and review the current source."); return; }
    try {
      const next = candidate();
      const collection = kind === "map" || kind === "list" ? kind : null;
      if (!collection && !options.alwaysApply && (kind === initialType && !(kind === "string" && textEditor) && input.value === initial || Object.is(next, options.value))) { close(); return; }
      if (kind === "string") { textEditor?.assert(next as string); }
      busy = true; type.disabled = input.disabled = apply.disabled = cancel.disabled = true;
      textEditor?.lock(true);
      if (await (collection ? options.emptyCollections!.apply(collection) : options.apply(next))) { if (closed) { options.closed(); } else { close(); } }
    } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
    finally { busy = false; type.disabled = input.disabled = apply.disabled = cancel.disabled = false; textEditor?.lock(false); }
  };
  const keys = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (closed || composing || event.isComposing || event.keyCode === 229 || ["Process", "Unidentified"].includes(event.key)) { return; }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
    if (event.key === "Escape" && !busy) { event.preventDefault(); options.error(""); close(); }
  };
  const renderInput = (): void => {
    textLinks?.dispose(); textLinks = null;
    if (kind === "string" && options.textEditor) { textEditor ??= options.textEditor(typeof options.value === "string" ? options.value : drafts.get(kind)!, preview); input = textEditor.input; }
    else { input = document.createElement(kind === "string" ? "textarea" : kind === "boolean" ? "select" : "input"); }
    input.className = "metadata-input metadata-structured-input"; input.dataset.propertyStructuredInput = ""; input.dataset.metadataInput = ""; input.setAttribute("aria-label", options.label);
    if (kind === "boolean") { for (const value of ["true", "false"]) { const option = document.createElement("option"); option.value = option.textContent = value; input.append(option); } }
    else if (kind === "string" && !textEditor) { (input as HTMLTextAreaElement).rows = 3; (input as HTMLTextAreaElement).maxLength = MAX_STRUCTURED_SCALAR_TEXT; }
    else if (kind !== "string") { (input as HTMLInputElement).type = "text"; (input as HTMLInputElement).inputMode = kind === "number" ? "decimal" : "text"; (input as HTMLInputElement).maxLength = 128; (input as HTMLInputElement).readOnly = kind === "null" || kind === "map" || kind === "list"; }
    if (kind !== "string" || !textEditor) { input.value = drafts.get(kind)!; }
    const control = input, ownsInput = (): boolean => !closed && input === control && control.isConnected && valueHost.contains(control);
    if (!controls.has(control)) {
      controls.add(control);
      input.addEventListener("compositionstart", () => { if (ownsInput()) { composing = true; } }); input.addEventListener("compositionend", () => { if (ownsInput()) { composing = false; } }); input.addEventListener("keydown", event => { if (ownsInput()) { keys(event); } });
      input.addEventListener("input", () => { if (ownsInput()) { textEditor?.changed(); preview(); } }); input.addEventListener("change", () => { if (ownsInput()) { textEditor?.changed(); preview(); } });
    }
    valueHost.replaceChildren(kind === "string" && textEditor ? textEditor.element : input); preview();
    if (kind === "string" && options.textLinks) { textLinks = options.textLinks(input as HTMLTextAreaElement, value => { if (ownsInput() && !busy) { if (textEditor) { textEditor.update(value); } else { input.value = value; } preview(); } }); valueHost.append(textLinks.element); preview(); }
  };
  type.value = initialType; type.addEventListener("keydown", keys);
  type.addEventListener("change", () => {
    if (closed || busy || composing) { type.value = kind; return; }
    if (!current()) { type.value = kind; options.error("The note or nested property owner changed. Cancel this draft and review the current source."); return; }
    if (!kinds.includes(type.value as Kind)) { type.value = kind; options.error("Choose a supported value type."); return; }
    if (type.value === kind) { return; }
    drafts.set(kind, input.value); textEditor?.changed(); kind = type.value as Kind; options.error(""); renderInput(); input.focus();
  });
  renderInput();
  for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
  apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
  return { element, get input() { return input; }, get active() { return !closed; }, refreshReview: preview, dispose() { closed = true; textLinks?.dispose(); textLinks = null; textEditor?.dispose(); element.remove(); } };
}
