import { isMap, isScalar, isSeq } from "yaml";
import { sameValue } from "./markdown";
import { MAX_STRUCTURED_PROPERTY_DEPTH, multilineText } from "./multiline-properties";
import { checkedStructuredPropertySnapshot, reviewedStructuredPropertySource, type StructuredPropertyPath, type StructuredScalarEditor } from "./structured-properties";
import { MAX_STRUCTURED_OPERATION_REVIEW, structuredPropertyCollectionEntries } from "./structured-property-operations";
import { structuredPropertyTransferContainerAt as containerAt, structuredPropertyTransferEntryAt as entryAt,
  structuredPropertyTransferOwnerAt as ownerAt, structuredPropertyTransferProofFor as proofFor } from "./structured-property-transfers";

export type StructuredPropertyRestructureKind = "wrap-map" | "wrap-list" | "unwrap-value" | "promote-entries";
export type StructuredPropertyRestructureOperation = { readonly kind: "wrap-map"; readonly path: StructuredPropertyPath; readonly key: string }
  | { readonly kind: Exclude<StructuredPropertyRestructureKind, "wrap-map">; readonly path: StructuredPropertyPath };
export interface StructuredPropertyRestructurePlan {
  readonly source: string; readonly next: unknown; readonly review: string; readonly operation: StructuredPropertyRestructureOperation;
}
export interface StructuredPropertyRestructureTargets {
  readonly "wrap-map": ReadonlySet<string>; readonly "wrap-list": ReadonlySet<string>;
  readonly "unwrap-value": ReadonlySet<string>; readonly "promote-entries": ReadonlySet<string>;
}
type Proof = ReturnType<typeof reviewedStructuredPropertySource>;
type Entry = ReturnType<typeof entryAt>;
type Span = { from: number; to: number; replacement: string };
const unsafe = new Set(["__proto__", "prototype", "constructor", "<<"]);
const identity = (path: StructuredPropertyPath): string => JSON.stringify(path);
const literal = (key: string): string => JSON.stringify(key).replace(/[\u0085\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const refusal = (): Error => new Error("This value has no lossless wrap, unwrap or promotion proof. Review it in Source.");
export const isStructuredPropertyRestructureKind = (kind: string): kind is StructuredPropertyRestructureKind => ["wrap-map", "wrap-list", "unwrap-value", "promote-entries"].includes(kind);

function checkedOperation(input: StructuredPropertyRestructureOperation): StructuredPropertyRestructureOperation {
  const { operation } = checkedStructuredPropertySnapshot({ operation: input }) as { operation: StructuredPropertyRestructureOperation };
  if (!operation || !isStructuredPropertyRestructureKind(operation.kind) || Object.keys(operation).sort().join(",") !== (operation.kind === "wrap-map" ? "key,kind,path" : "kind,path")
    || !Array.isArray(operation.path) || !operation.path.length || operation.path.length > MAX_STRUCTURED_PROPERTY_DEPTH
    || operation.path.some(key => typeof key === "string" ? unsafe.has(key) : !Number.isSafeInteger(key) || key < 0)) { throw refusal(); }
  if (operation.kind === "wrap-map" && (typeof operation.key !== "string" || !operation.key.trim() || operation.key.length > 256 || /[\r\n]/.test(operation.key) || unsafe.has(operation.key))) {
    throw new Error("Choose a nonempty new child map key of at most 256 characters, without unsafe names or line breaks.");
  }
  return operation;
}

function shifted(text: string, from: number, to: number, first = false): string {
  const line = (value: string): string => {
    if (!value.trim()) { return value; }
    if (!value.startsWith(" ".repeat(from))) { throw refusal(); }
    return " ".repeat(to) + value.slice(from);
  };
  if (to < 0 || to > 64) { throw refusal(); }
  const result = text.replace(/(\r?\n)([^\r\n]*)/g, (_match, newline: string, value: string) => newline + line(value));
  if (!first) { return result; }
  const newline = result.search(/[\r\n]/), head = newline < 0 ? result : result.slice(0, newline);
  return line(head) + (newline < 0 ? "" : result.slice(newline));
}
const head = (proof: Proof, entry: Entry): string => proof.body.slice(entry.span.from, entry.span.to - entry.suffix.length);
const newlineFor = (proof: Proof, entry: Entry): string => proof.body.slice(entry.span.to - 2, entry.span.to) === "\r\n" ? "\r\n" : "\n";
function discardedHeader(proof: Proof, entry: Entry): void {
  const start = entry.span.to - entry.suffix.length, range = entry.node.range!;
  if (!/^[ \t\r\n]*$/.test(proof.body.slice(start, range[0])) || !/^[ \t\r\n]*$/.test(proof.body.slice(range[1], entry.span.to))) {
    throw new Error("The wrapper has a comment or unowned text that cannot be discarded. Restructure it in Source.");
  }
}

/** Derive one exact span using the existing collection/comment ownership proof. */
function spanFor(proof: Proof, operation: StructuredPropertyRestructureOperation, entry: Entry): Span {
  const range = entry.node.range!;
  if (operation.kind === "wrap-map" || operation.kind === "wrap-list") {
    if (range[0] === range[1]) { throw new Error("An implicit empty value needs an explicit scalar before wrapping. Review it in Source."); }
    if (isMap(entry.node) || isSeq(entry.node)) { containerAt(proof, operation.path); }
    const marker = operation.kind === "wrap-map" ? literal(operation.key) + ":" : "-", token = entry.node.srcToken;
    if (token?.type === "block-map" || token?.type === "block-seq") {
      if (!entry.block || token.indent > 62) { throw refusal(); }
      // Retain the outer key/header and move only the exact block value under
      // the new child. Every continuation line keeps its existing spelling.
      return { from: range[0], to: range[1], replacement: marker + newlineFor(proof, entry) + " ".repeat(token.indent + 2) + shifted(entry.valueText, token.indent, token.indent + 2) };
    }
    if (token?.type === "block-scalar" || entry.block && isScalar(entry.node) && token?.type === "scalar" && /[,\[\]{}]/.test(entry.valueText)) {
      if (!entry.block || entry.owner.indent > 60) { throw refusal(); }
      return { ...entry.span, replacement: head(proof, entry) + newlineFor(proof, entry) + " ".repeat(entry.owner.indent + 2) + marker + shifted(entry.suffix, entry.owner.indent, entry.owner.indent + 2) };
    }
    if (isScalar(entry.node) && /[\r\n]/.test(entry.valueText)) { throw new Error("This multiline scalar needs Source for wrap authoring."); }
    return { from: range[0], to: range[1], replacement: operation.kind === "wrap-map" ? "{ " + literal(operation.key) + ": " + entry.valueText + " }" : "[" + entry.valueText + "]" };
  }
  const container = containerAt(proof, operation.path), children = structuredPropertyCollectionEntries(container.node);
  if (operation.kind === "unwrap-value") {
    if (children.length !== 1) { throw new Error("Unwrap single value requires exactly one Map or List child. Use Promote entries for a compatible nonempty collection."); }
    const child = entryAt(proof, [...operation.path, children[0].key]);
    if (!container.block) { return { from: range[0], to: range[1], replacement: child.valueText }; }
    if (!entry.block) { throw refusal(); }
    discardedHeader(proof, entry);
    return { ...entry.span, replacement: head(proof, entry) + shifted(child.suffix, child.owner.indent, entry.owner.indent) };
  }
  if (!children.length || container.array !== entry.owner.array) { throw new Error("Promote entries requires a nonempty Map in a Map or a nonempty List in a List."); }
  if (!container.array) {
    const keys = new Set(entry.owner.keys.filter(key => key !== entry.key).map(key => String(key).toLowerCase()));
    for (const child of children) {
      const key = String(child.key).toLowerCase();
      if (keys.has(key)) { throw new Error("A promoted map key collides with an existing or another promoted key, including its letter case. Rename it before promoting; no entry is overwritten."); }
      keys.add(key);
    }
  }
  if (container.block) {
    if (!entry.block) { throw refusal(); }
    discardedHeader(proof, entry);
    return { ...entry.span, replacement: children.map(child => shifted(entryAt(proof, [...operation.path, child.key]).raw, container.indent, entry.owner.indent, true)).join("") };
  }
  if (entry.block) {
    discardedHeader(proof, entry);
    return { ...entry.span, replacement: children.map(child => {
      const payload = entryAt(proof, [...operation.path, child.key]);
      if (/[\r\n]/.test(payload.valueText)) { throw new Error("A multiline flow child needs a flow parent for promotion. Review this collection in Source."); }
      return " ".repeat(entry.owner.indent) + (container.array ? "-" : payload.keyText + ":") + " " + payload.valueText + newlineFor(proof, entry);
    }).join("") };
  }
  const parentEntry = structuredPropertyCollectionEntries(entry.owner.node)[entry.index];
  return { from: parentEntry.from, to: parentEntry.to, replacement: children.map((child, index) => (index ? proof.body.slice(children[index - 1].to, child.from) : "") + proof.body.slice(child.from, child.to)).join("") };
}

function nextValue(snapshot: Record<string, unknown> | unknown[], operation: StructuredPropertyRestructureOperation): unknown {
  const owner = ownerAt(snapshot, operation.path.slice(0, -1)), key = operation.path.at(-1)!, descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor)) { throw refusal(); }
  const selected = descriptor.value;
  if (operation.kind === "promote-entries") {
    if (Array.isArray(owner)) {
      if (!Array.isArray(selected) || !selected.length) { throw refusal(); }
      owner.splice(key as number, 1, ...selected);
    } else {
      if (!selected || typeof selected !== "object" || Array.isArray(selected) || !Object.keys(selected).length) { throw refusal(); }
      const ordered: Record<string, unknown> = {};
      for (const name of Object.keys(owner)) {
        if (name === key) { for (const child of Object.keys(selected)) { Object.defineProperty(ordered, child, { value: selected[child], enumerable: true, configurable: true, writable: true }); } }
        else { Object.defineProperty(ordered, name, { value: owner[name], enumerable: true, configurable: true, writable: true }); }
      }
      for (const name of Object.keys(owner)) { delete owner[name]; }
      Object.defineProperties(owner, Object.getOwnPropertyDescriptors(ordered));
    }
  } else {
    const next = operation.kind === "wrap-map" ? { [operation.key]: selected } : operation.kind === "wrap-list" ? [selected]
      : Array.isArray(selected) ? selected[0] : Object.values(selected)[0];
    Object.defineProperty(owner, key, { value: next, enumerable: true, configurable: true, writable: true });
  }
  return checkedStructuredPropertySnapshot(snapshot);
}

function boundedSpan(proof: Proof, operation: StructuredPropertyRestructureOperation, entry: Entry): Span {
  const span = spanFor(proof, operation, entry);
  if (span.to - span.from + span.replacement.length > MAX_STRUCTURED_OPERATION_REVIEW) { throw new Error("This restructure exceeds the complete source review limit. Review it in Source."); }
  return span;
}

/** One splice, one ordinary property edit, and complete frontmatter equality. */
export function planStructuredPropertyRestructure(source: string, name: string, value: unknown, input: StructuredPropertyRestructureOperation): StructuredPropertyRestructurePlan {
  const operation = checkedOperation(input), { proof, snapshot } = proofFor(source, name, value), entry = entryAt(proof, operation.path), span = boundedSpan(proof, operation, entry);
  const next = nextValue(snapshot, operation), from = proof.offset + span.from, to = proof.offset + span.to, result = source.slice(0, from) + span.replacement + source.slice(to);
  const final = reviewedStructuredPropertySource(result, name), complete = proof.doc.toJS({ maxAliasCount: 50 });
  Object.defineProperty(complete, name, { value: next, enumerable: true, configurable: true, writable: true });
  if (!sameValue(next, final.value) || !sameValue(complete, final.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  const action = operation.kind === "wrap-map" ? "Wrap value in Map" : operation.kind === "wrap-list" ? "Wrap value in List" : operation.kind === "unwrap-value" ? "Unwrap single value" : "Promote entries";
  const meaning = operation.kind === "wrap-map" ? `New child map key: ${JSON.stringify(operation.key)}. The outer key/index stays in place.`
    : operation.kind === "wrap-list" ? "The outer key/index stays in place. Its value becomes the only item at list index 0."
      : operation.kind === "unwrap-value" ? `The outer key/index stays in place. Discard the sole inner ${isMap(entry.node) ? "map key " + JSON.stringify(structuredPropertyCollectionEntries(entry.node)[0].key) : "list index 0"} and keep its exact value.`
        : "Discard the selected wrapper key/index. Its children replace it at this position in the compatible parent. No existing entry is overwritten.";
  const review = `${action} ${identity([name, ...operation.path])}\n${meaning}\nExact source removed:\n${proof.body.slice(span.from, span.to)}\nExact source replacement:\n${span.replacement}\nOnly this reviewed source span changes. Value spelling and owned child comments remain exact apart from required block indentation. One Undo restores the previous source.`;
  return { source: result, next, review, operation };
}

export function preserveStructuredPropertyRestructureSource(updated: string, original: string, name: string, operation: StructuredPropertyRestructureOperation): string {
  const proof = reviewedStructuredPropertySource(original, name), plan = planStructuredPropertyRestructure(original, name, proof.value, operation), candidate = reviewedStructuredPropertySource(updated, name), final = reviewedStructuredPropertySource(plan.source, name);
  if (!sameValue(candidate.value, plan.next) || !sameValue(candidate.doc.toJS({ maxAliasCount: 50 }), final.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  return plan.source;
}

/** Bounded discovery shares one parsed proof. No candidate reparses the note. */
export function structuredPropertyRestructureTargets(source: string, name: string, value: unknown): StructuredPropertyRestructureTargets {
  const result = { "wrap-map": new Set<string>(), "wrap-list": new Set<string>(), "unwrap-value": new Set<string>(), "promote-entries": new Set<string>() };
  try {
    const { proof, snapshot } = proofFor(source, name, value);
    const inspect = (node: unknown, path: StructuredPropertyPath): void => {
      if (!isMap(node) && !isSeq(node)) { return; }
      for (const child of structuredPropertyCollectionEntries(node)) {
        const selected = [...path, child.key];
        try {
          const entry = entryAt(proof, selected);
          for (const kind of ["wrap-map", "wrap-list", "unwrap-value", "promote-entries"] as const) {
            const operation: StructuredPropertyRestructureOperation = kind === "wrap-map" ? { kind, path: selected, key: "value" } : { kind, path: selected };
            try { boundedSpan(proof, operation, entry); nextValue(structuredClone(snapshot), operation); result[kind].add(identity(selected)); }
            catch { /* Incompatible, ambiguous or over-budget choices stay in Source. */ }
          }
        } catch { /* The parent/entry must have the same exact ownership proof. */ }
        inspect(child.node, selected);
      }
    };
    inspect(proof.target, []);
  } catch { /* No parsed source or descriptor authority means no authoring controls. */ }
  return result;
}

export function createStructuredPropertyRestructureEditor(document: Document, options: {
  kind: StructuredPropertyRestructureKind; path: StructuredPropertyPath; label: string; current: () => boolean;
  plan: (operation: StructuredPropertyRestructureOperation) => StructuredPropertyRestructurePlan;
  apply: (plan: StructuredPropertyRestructurePlan) => Promise<boolean>; error: (message: string) => void; closed: () => void;
}): StructuredScalarEditor {
  const element = document.createElement("div"), keyLabel = document.createElement("label"), key = document.createElement("input"), review = document.createElement("textarea"), actions = document.createElement("div"), apply = document.createElement("button"), cancel = document.createElement("button"), help = document.createElement("p");
  element.className = "metadata-structured-editor metadata-structured-operation-editor"; element.dataset.propertyStructuredOperation = options.kind;
  key.type = "text"; key.maxLength = 256; key.className = "metadata-input"; key.dataset.propertyStructuredRestructureKey = ""; key.dataset.metadataInput = ""; key.setAttribute("aria-label", "New child map key for " + options.label); keyLabel.textContent = "New child map key "; keyLabel.append(key);
  review.readOnly = true; review.rows = 10; review.className = "metadata-input metadata-structured-removal-review"; review.dataset.propertyStructuredRestructureReview = ""; review.setAttribute("aria-label", "Review restructure for " + options.label);
  apply.type = cancel.type = "button"; apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = ""; apply.textContent = options.kind === "wrap-map" || options.kind === "wrap-list" ? "Apply wrap" : options.kind === "unwrap-value" ? "Apply unwrap" : "Apply promotion"; cancel.textContent = "Cancel";
  actions.className = "metadata-structured-actions"; actions.append(apply, cancel); help.className = "metadata-multiline-help";
  help.textContent = "Review the complete exact source replacement before Apply. Unwrap keeps one child value and discards its inner key/index. Promote entries removes a compatible wrapper without overwriting another entry. Ctrl/⌘+Enter applies; Escape cancels.";
  if (options.kind === "wrap-map") { element.append(keyLabel); } element.append(review, actions, help);
  let closed = false, busy = false, composing = false, reviewed: StructuredPropertyRestructurePlan | null = null;
  const plan = (): StructuredPropertyRestructurePlan => options.plan(options.kind === "wrap-map" ? { kind: options.kind, path: options.path, key: key.value } : { kind: options.kind, path: options.path });
  const preview = (): void => { if (closed || busy) { return; } try { const candidate = plan(); review.value = candidate.review; reviewed = candidate; apply.disabled = composing; } catch (issue) { reviewed = null; review.value = issue instanceof Error ? issue.message : String(issue); apply.disabled = true; } };
  const owns = (): boolean => !closed && review.isConnected && element.contains(review) && (options.kind !== "wrap-map" || key.isConnected && element.contains(key));
  const close = (): void => { if (closed) { return; } closed = true; reviewed = null; element.remove(); options.closed(); };
  const save = async (): Promise<void> => {
    if (closed || busy || composing) { return; }
    if (!owns() || !options.current() || !(element.checkVisibility?.() ?? true)) { options.error("The note or nested property owner changed. Cancel this restructure and review the current source."); return; }
    try {
      const candidate = plan();
      // A DOM textarea normalizes CRLF. Compare raw plans separately so even
      // a normalization-only source change cannot inherit prior approval.
      if (!reviewed || JSON.stringify(reviewed.operation) !== JSON.stringify(candidate.operation) || reviewed.source !== candidate.source || reviewed.review !== candidate.review || review.value !== multilineText(candidate.review)) {
        preview(); throw new Error("The restructure choice or source changed. Review the current exact text before applying it.");
      }
      busy = true; for (const control of [key, apply, cancel]) { control.disabled = true; }
      if (await options.apply(candidate)) { if (closed) { options.closed(); } else { close(); } }
    } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
    finally { busy = false; key.disabled = cancel.disabled = false; preview(); }
  };
  key.addEventListener("compositionstart", () => { if (owns() && !busy) { composing = true; apply.disabled = true; } });
  key.addEventListener("compositionend", () => { if (owns() && !busy) { composing = false; preview(); } });
  for (const event of ["input", "change"]) { key.addEventListener(event, () => { if (owns() && !busy && !composing) { preview(); } }); }
  for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
  apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
  element.addEventListener("keydown", event => { if (closed || busy || composing || event.isComposing || event.keyCode === 229 || ["Process", "Unidentified"].includes(event.key)) { return; } if (event.key === "Escape") { event.preventDefault(); options.error(""); close(); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
  preview(); return { element, input: options.kind === "wrap-map" ? key : review, get active() { return !closed; }, refreshReview: preview, dispose() { closed = true; reviewed = null; element.remove(); } };
}
