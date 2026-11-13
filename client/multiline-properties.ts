import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit } from "yaml";
import { sameValue } from "./markdown";

export const MAX_MULTILINE_PROPERTY_TEXT = 65_536;
export const MAX_MULTILINE_PROPERTY_ITEMS = 256;
export const MAX_MULTILINE_PROPERTY_CHARACTERS = 262_144;
export const MAX_STRUCTURED_PROPERTY_NODES = 256;
export const MAX_STRUCTURED_PROPERTY_DEPTH = 8;
export const MAX_STRUCTURED_PROPERTY_CHARACTERS = 32_768;

export function propertyTextControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element !== null && ["INPUT", "TEXTAREA"].includes(element.tagName.toUpperCase());
}

/** Textareas use LF. An unchanged draft must keep the original YAML string. */
export const multilineText = (value: string): string => value.replace(/\r\n?/g, "\n");
export const hasMultilineText = (value: unknown): value is string => typeof value === "string" && /[\r\n]/.test(value);

export function checkedMultilineText(value: string): string {
  const text = multilineText(value);
  if (text.length > MAX_MULTILINE_PROPERTY_TEXT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new Error("Use at most 65,536 characters without control characters for a multiline property value.");
  }
  return text;
}

export function multilineListSupported(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_MULTILINE_PROPERTY_ITEMS
    && value.every(item => typeof item === "string" && item.length <= MAX_MULTILINE_PROPERTY_TEXT)
    && value.reduce((total, item) => total + item.length, 0) <= MAX_MULTILINE_PROPERTY_CHARACTERS;
}

export function replaceMultilinePropertyValue(values: readonly string[], index: number, value: string): string[] {
  if (!multilineListSupported(values) || !Number.isSafeInteger(index) || index < 0 || index >= values.length) {
    throw new Error("This list is outside the multiline property editing limits.");
  }
  const text = checkedMultilineText(value);
  if (text === multilineText(values[index])) { return [...values]; }
  if (!text.trim() || values.some((item, position) => position !== index && multilineText(item) === text)) {
    throw new Error("Enter a distinct, nonempty value for the current list item.");
  }
  const result = values.map((item, position) => position === index ? text : item);
  if (!multilineListSupported(result)) { throw new Error("This list exceeds the multiline property editing limits."); }
  return result;
}

/** Preserve every untouched YAML lexeme after the ordinary guarded update. */
export function preserveMultilinePropertySource(updated: string, original: string, name: string, index?: number): string {
  const parse = (content: string) => {
    const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content), closing = /^---[ \t]*(?:\r?\n|$)/gm;
    if (!opening) { throw new Error("The multiline property's frontmatter is no longer available."); }
    closing.lastIndex = opening[0].length; const end = closing.exec(content);
    if (!end || end.index - opening[0].length > 262_144) { throw new Error("This frontmatter is outside the multiline property editing limits."); }
    const body = content.slice(opening[0].length, end.index), doc = parseDocument(body, { uniqueKeys: true, keepSourceTokens: true });
    if (doc.errors.length || !isMap(doc.contents)) { throw new Error("Resolve this note's YAML before applying a multiline value."); }
    const pair = doc.contents.items.find(pair => isScalar(pair.key) && pair.key.value === name);
    const value = index === undefined ? pair?.value : isSeq(pair?.value) ? pair.value.items[index] : undefined;
    if (!isScalar(value) || typeof value.value !== "string" || !value.range) { throw new Error("The reviewed multiline scalar or list member changed shape."); }
    return { from: opening[0].length + value.range[0], to: opening[0].length + value.range[2], doc };
  };
  const before = parse(original), after = parse(updated);
  const indentation = (content: string, from: number): number => /^ */.exec(content.slice(content.lastIndexOf("\n", from - 1) + 1, from))![0].length;
  const shift = indentation(original, before.from) - indentation(updated, after.from);
  let replacement = updated.slice(after.from, after.to);
  if (shift) {
    replacement = replacement.replace(/\r?\n( +)(?=\S)/g, (line, spaces: string) => {
      const length = spaces.length + shift;
      if (length < 0) { throw new Error("The multiline value's original indentation cannot be retained safely."); }
      return (line.startsWith("\r") ? "\r\n" : "\n") + " ".repeat(length);
    });
  }
  const result = original.slice(0, before.from) + replacement + original.slice(before.to);
  if (!sameValue(parse(result).doc.toJS({ maxAliasCount: 50 }), after.doc.toJS({ maxAliasCount: 50 }))) {
    throw new Error("This multiline edit cannot preserve the other YAML values. Edit the source to control it explicitly.");
  }
  return result;
}

export interface MultilinePropertyEditor {
  readonly element: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  readonly active: boolean;
  dispose(): void;
}

/** Explicit Apply/Cancel; moving focus never commits the textarea. */
export function createMultilinePropertyEditor(document: Document, options: {
  value: string; label: string; current: () => boolean; apply: (value: string) => Promise<boolean>;
  error: (message: string) => void; closed: () => void;
}): MultilinePropertyEditor {
  const element = document.createElement("div"), input = document.createElement("textarea"), actions = document.createElement("div");
  const apply = document.createElement("button"), cancel = document.createElement("button"), help = document.createElement("span");
  element.className = "metadata-multiline-editor"; input.className = "metadata-input metadata-multiline-input";
  input.dataset.metadataInput = ""; input.dataset.propertyMultilineInput = ""; input.setAttribute("aria-label", options.label);
  input.value = multilineText(options.value); input.maxLength = MAX_MULTILINE_PROPERTY_TEXT; input.rows = Math.min(10, Math.max(3, input.value.split("\n").length));
  const initial = input.value;
  apply.type = cancel.type = "button"; apply.textContent = "Apply value"; cancel.textContent = "Cancel";
  apply.dataset.propertyMultilineApply = ""; cancel.dataset.propertyMultilineCancel = "";
  actions.className = "metadata-multiline-actions"; actions.append(apply, cancel);
  help.className = "metadata-multiline-help"; help.textContent = "Enter adds a line. Ctrl/⌘+Enter applies; Escape cancels.";
  element.append(input, actions, help);
  let closed = false, busy = false, composing = false;
  const close = (): void => { if (closed) { return; } closed = true; element.remove(); options.closed(); };
  const save = async (): Promise<void> => {
    if (closed || busy || composing || !options.current()) { return; }
    try {
      const candidate = checkedMultilineText(input.value);
      if (candidate === initial) { close(); return; }
      busy = true; input.readOnly = true; apply.disabled = cancel.disabled = true;
      if (await options.apply(candidate)) { if (closed) { options.closed(); } else { close(); } }
    } catch (error) { options.error(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; input.readOnly = false; apply.disabled = cancel.disabled = false; }
  };
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; });
  input.addEventListener("keydown", event => {
    if (composing || event.isComposing || event.keyCode === 229 || event.key === "Process" || event.key === "Unidentified") { return; }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
    if (event.key === "Escape" && !busy) { event.preventDefault(); options.error(""); close(); }
  });
  for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => { event.preventDefault(); }); }
  apply.addEventListener("click", () => { void save(); });
  cancel.addEventListener("click", () => { if (!busy) { options.error(""); close(); } });
  return { element, input, get active() { return !closed; }, dispose() { closed = true; element.remove(); } };
}

export interface StructuredPropertyEntry { label: string; value: string; children?: StructuredPropertyEntry[] }

/** Snapshot plain resolved data without getters, aliases/shared owners or coercion. */
export function structuredPropertyTree(value: unknown): StructuredPropertyEntry[] | null {
  const seen = new WeakSet<object>(); let nodes = 0, characters = 0;
  const text = (value: string): string => {
    characters += value.length;
    if (value.length > 4096 || characters > MAX_STRUCTURED_PROPERTY_CHARACTERS) { throw new Error("Structured value text limit."); }
    return value;
  };
  const inspect = (value: unknown, label: string, depth: number): StructuredPropertyEntry => {
    if (++nodes > MAX_STRUCTURED_PROPERTY_NODES || depth > MAX_STRUCTURED_PROPERTY_DEPTH) { throw new Error("Structured value nesting limit."); }
    label = text(label);
    if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) {
      return { label, value: text(Object.is(value, -0) ? "-0" : JSON.stringify(value)) };
    }
    if (!value || typeof value !== "object" || seen.has(value) || Object.getOwnPropertySymbols(value).length) { throw new Error("Unsupported structured value."); }
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) { throw new Error("Unsupported structured prototype."); }
    seen.add(value);
    const keys = Object.keys(value);
    if (keys.length > MAX_STRUCTURED_PROPERTY_NODES || array && keys.length !== value.length) { throw new Error("Unsupported structured length."); }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const children = keys.map((key, index) => {
      if (["__proto__", "prototype", "constructor"].includes(key) || array && key !== String(index) || !("value" in descriptors[key])) { throw new Error("Unsupported structured key."); }
      return inspect(descriptors[key].value, array ? `[${index}]` : key, depth + 1);
    });
    return { label, value: `${array ? "List" : "Map"} (${children.length})`, children };
  };
  try {
    const root = inspect(value, "", 0);
    return root.children ?? null;
  } catch { return null; }
}

const sourcePolicies = new Map<string, Map<string, boolean>>();
function structuredSourcePolicy(source: string): Map<string, boolean> {
  const cached = sourcePolicies.get(source); if (cached) { return cached; }
  const result = new Map<string, boolean>();
  try {
    if (source.length > 1_048_576) { return result; }
    const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(source); if (!opening) { return result; }
    const closing = /^---[ \t]*(?:\r?\n|$)/gm; closing.lastIndex = opening[0].length;
    const end = closing.exec(source); if (!end || end.index - opening[0].length > 65_536) { return result; }
    const doc = parseDocument(source.slice(opening[0].length, end.index), { uniqueKeys: true });
    if (doc.errors.length || !isMap(doc.contents) || doc.contents.items.length > 256) { return result; }
    let nodes = 0;
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") { continue; }
      let safe = true;
      visit(pair.value, (_key, node) => {
        if (++nodes > 8192 || isAlias(node) || isNode(node) && (node.tag || "anchor" in node && node.anchor)) { safe = false; return visit.BREAK; }
      });
      if (nodes > 8192) { result.clear(); return result; }
      result.set(pair.key.value, safe);
    }
  } catch { result.clear(); }
  finally {
    if (source.length <= 1_048_576) {
      sourcePolicies.set(source, result);
      while (sourcePolicies.size > 2) { sourcePolicies.delete(sourcePolicies.keys().next().value!); }
    }
  }
  return result;
}

export function structuredPropertySourceSupported(source: string | undefined, name: string): boolean {
  return source !== undefined && structuredSourcePolicy(source).get(name) === true;
}

/** Native details provide keyboard inspection only; no value-edit callbacks exist. */
export function createStructuredPropertyInspector(document: Document, value: unknown, name: string, source: string | undefined): HTMLElement | null {
  if (!structuredPropertySourceSupported(source, name)) { return null; }
  const entries = structuredPropertyTree(value); if (entries === null) { return null; }
  const details = document.createElement("details"), summary = document.createElement("summary"), description = document.createElement("p");
  details.className = "metadata-structured-inspector"; details.dataset.propertyStructured = name;
  summary.textContent = `${Array.isArray(value) ? "List" : "Map"} (${entries.length}) — inspect`;
  summary.setAttribute("aria-label", `Inspect structured property ${name}`);
  description.textContent = "Read-only resolved YAML values. Edit the source for nested changes or exact YAML syntax.";
  const render = (entries: StructuredPropertyEntry[]): HTMLUListElement => {
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li"), label = document.createElement("span");
      label.className = "metadata-structured-key"; label.textContent = entry.label;
      if (entry.children) {
        const branch = document.createElement("details"), heading = document.createElement("summary");
        heading.append(label, document.createTextNode(": " + entry.value)); branch.append(heading, render(entry.children)); item.append(branch);
      } else {
        const leaf = document.createElement("code"); leaf.className = "metadata-structured-leaf"; leaf.textContent = entry.value;
        item.append(label, document.createTextNode(": "), leaf);
      }
      list.append(item);
    }
    return list;
  };
  details.append(summary, description, render(entries)); return details;
}
