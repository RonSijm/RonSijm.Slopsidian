import { isMap, isScalar, isSeq, type Node } from "yaml";
import { sameValue } from "./markdown";
import { MAX_STRUCTURED_PROPERTY_DEPTH, multilineText } from "./multiline-properties";
import { checkedStructuredPropertySnapshot, reviewedStructuredPropertySource, type StructuredPropertyPath, type StructuredScalarEditor } from "./structured-properties";
import { MAX_STRUCTURED_OPERATION_REVIEW, structuredPropertyCollectionEntries, structuredPropertyCollectionLayout, type StructuredPropertyCollection } from "./structured-property-operations";

/** Independent, bounded authoring extension, using ordinary YAML containers. */
export type StructuredPropertyTransferKind = "duplicate" | "copy-to" | "move-into";
export interface StructuredPropertyTransferOperation {
  readonly kind: StructuredPropertyTransferKind; readonly path: StructuredPropertyPath;
  readonly destination: StructuredPropertyPath; readonly key: string | number;
}
export interface StructuredPropertyTransferPlan {
  readonly source: string; readonly next: unknown; readonly review: string; readonly operation: StructuredPropertyTransferOperation;
}
export interface StructuredPropertyTransferContainer {
  readonly path: StructuredPropertyPath; readonly array: boolean; readonly length: number; readonly keys: readonly (string | number)[];
}
export interface StructuredPropertyTransferTargets {
  readonly duplicate: ReadonlySet<string>; readonly "copy-to": ReadonlySet<string>; readonly "move-into": ReadonlySet<string>;
  readonly transferDestinations: ReadonlyMap<string, readonly StructuredPropertyTransferContainer[]>;
}
type Span = { from: number; to: number; replacement: string };
type Proof = ReturnType<typeof reviewedStructuredPropertySource>;
type Container = StructuredPropertyTransferContainer & { node: StructuredPropertyCollection; layout: ReturnType<typeof structuredPropertyCollectionLayout>; block: boolean; indent: number };
type Entry = { owner: Container; node: Node; index: number; key: string | number; span: Span; raw: string; suffix: string; keyText?: string; valueText: string; block: boolean };
const unsafe = new Set(["__proto__", "prototype", "constructor", "<<"]);
const identity = (path: StructuredPropertyPath): string => JSON.stringify(path);
const prefix = (parent: StructuredPropertyPath, child: StructuredPropertyPath): boolean => parent.length <= child.length && parent.every((key, at) => key === child[at]);
const refusal = (): Error => new Error("This entry or destination has no lossless transfer proof. Review it in Source.");
const keyLiteral = (key: string): string => JSON.stringify(key).replace(/[\u0085\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
export const isStructuredPropertyTransferKind = (kind: string): kind is StructuredPropertyTransferKind => ["duplicate", "copy-to", "move-into"].includes(kind);

function checkedOperation(input: StructuredPropertyTransferOperation): StructuredPropertyTransferOperation {
  // Prove descriptors before reading operation, path, destination or key getters.
  const { operation } = checkedStructuredPropertySnapshot({ operation: input }) as { operation: StructuredPropertyTransferOperation };
  const path = (value: StructuredPropertyPath): boolean => Array.isArray(value) && value.length <= MAX_STRUCTURED_PROPERTY_DEPTH
    && value.every(key => typeof key === "string" ? !unsafe.has(key) : Number.isSafeInteger(key) && key >= 0);
  if (!operation || !isStructuredPropertyTransferKind(operation.kind) || Object.keys(operation).sort().join(",") !== "destination,key,kind,path"
    || !path(operation.path) || !operation.path.length || !path(operation.destination)
    || (typeof operation.key === "string" ? !operation.key.trim() || operation.key.length > 256 || /[\r\n]/.test(operation.key) || unsafe.has(operation.key)
      : !Number.isSafeInteger(operation.key) || operation.key < 0)) { throw refusal(); }
  if (prefix(operation.path, operation.destination)) { throw new Error("Choose a destination outside the selected entry and its descendants."); }
  const same = identity(operation.path.slice(0, -1)) === identity(operation.destination);
  if (operation.kind === "duplicate" && !same) { throw new Error("Duplicate entry keeps the copy in its current container. Choose Copy to for another container."); }
  if (operation.kind === "move-into" && same) { throw new Error("Choose another container. Use Move to a final position to reorder this container."); }
  return operation;
}

function ownerAt(value: unknown, path: StructuredPropertyPath): Record<string, unknown> | unknown[] {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || (Array.isArray(current) ? typeof key !== "number" : typeof key !== "string" || unsafe.has(key))) { throw refusal(); }
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor || !("value" in descriptor)) { throw refusal(); } current = descriptor.value;
  }
  if (!current || typeof current !== "object") { throw refusal(); }
  return current as Record<string, unknown> | unknown[];
}

function containerAt(proof: Proof, path: StructuredPropertyPath): Container {
  const node = path.length ? proof.target.getIn([...path], true) : proof.target;
  if (!isMap(node) && !isSeq(node)) { throw refusal(); }
  const layout = structuredPropertyCollectionLayout(node, proof.body), token = node.srcToken;
  if (!token || !("items" in token)) { throw refusal(); }
  const block = token.type !== "flow-collection", entries = structuredPropertyCollectionEntries(node);
  if (block) {
    // A destination must have no unowned inter-entry comments or blank lines.
    // Inline comments and comments inside a selected subtree still travel raw.
    for (let index = 0; index < entries.length; index++) {
      const item = token.items[index], indicator = isSeq(node) ? item.start.find(part => part.type === "seq-item-ind") : item.key;
      if (!indicator || item.start.some(part => part.type === "comment" && part.offset < indicator.offset)
        || index === 0 && Boolean(node.commentBefore) || index && layout.remove(index - 1).to !== layout.remove(index).from) {
        throw new Error("Comments or blank lines in this container have ambiguous ownership. Transfer entries in Source.");
      }
    }
  }
  return { path: [...path], array: isSeq(node), length: entries.length, keys: layout.keys, node, layout, block, indent: token.indent };
}

function entryAt(proof: Proof, path: StructuredPropertyPath): Entry {
  const owner = containerAt(proof, path.slice(0, -1)), key = path.at(-1)!, entries = structuredPropertyCollectionEntries(owner.node), index = entries.findIndex(entry => entry.key === key), entry = entries[index];
  if (!entry || !entry.node.range) { throw refusal(); }
  const span = owner.layout.remove(index), token = owner.node.srcToken!;
  if (!("items" in token)) { throw refusal(); }
  const item = token.items[index], marker = owner.array ? item.start.find(part => part.type === "seq-item-ind") : item.key;
  let end: number, keyText: string | undefined;
  if (owner.array) { if (!marker || !("source" in marker) || marker.source !== "-") { if (owner.block) { throw refusal(); } } end = marker ? marker.offset + 1 : entry.from; }
  else {
    const pair = isMap(owner.node) ? owner.node.items[index] : null;
    if (!pair || !isScalar(pair.key) || !pair.key.range) { throw refusal(); }
    keyText = proof.body.slice(pair.key.range[0], pair.key.range[1]);
    const colon = item.sep?.find(part => part.type === "map-value-ind");
    if (!colon || colon.source !== ":") { throw refusal(); } end = colon.offset + 1;
  }
  if (owner.block && (entry.node.srcToken?.type === "block-map" || entry.node.srcToken?.type === "block-seq")
    && !/[\r\n]/.test(proof.body.slice(end, entry.node.range[0]))) { throw new Error("Compact block entries need Source for transfer authoring."); }
  return { owner, node: entry.node, index, key, span, raw: owner.block ? proof.body.slice(span.from, span.to) : proof.body.slice(entry.from, entry.to),
    suffix: proof.body.slice(end, span.to), keyText, valueText: proof.body.slice(entry.node.range[0], entry.node.range[1]), block: owner.block };
}

function shiftedContinuation(text: string, from: number, to: number): string {
  return text.replace(/(\r?\n)([^\r\n]*)/g, (_match, newline: string, line: string) => {
    if (!line.trim()) { return newline + line; }
    if (!line.startsWith(" ".repeat(from))) { throw refusal(); }
    return newline + " ".repeat(to) + line.slice(from);
  });
}

function insertion(proof: Proof, entry: Entry, destination: Container, key: string | number): Span {
  const index = destination.array ? key as number : destination.length;
  if (destination.array ? typeof key !== "number" || key > destination.length : typeof key !== "string"
    || destination.keys.some(existing => String(existing).toLowerCase() === key.toLowerCase())) {
    throw new Error("Choose a new map key, including its letter case, or a whole current list insertion index without replacing an entry.");
  }
  const keyText = typeof key === "string" ? key === entry.key && entry.keyText ? entry.keyText : keyLiteral(key) : "";
  if (destination.block && entry.block) {
    const replacement = " ".repeat(destination.indent) + (destination.array ? "-" : keyText + ":")
      + shiftedContinuation(entry.suffix, entry.owner.indent, destination.indent);
    const slot = destination.layout.add(index, "");
    return { from: slot.from, to: slot.to, replacement };
  }
  if (destination.block || entry.block) {
    if (/[\r\n]/.test(entry.valueText) || ["block-map", "block-seq", "block-scalar"].includes(entry.node.srcToken?.type ?? "")) {
      throw new Error("A multiline or block subtree needs a block destination to keep its exact text. Choose another container or use Source.");
    }
    if (entry.block && !/^[ \t\r\n]*$/.test(proof.body.slice(entry.node.range![1], entry.span.to))) {
      throw new Error("This entry has an attached comment that cannot travel into flow punctuation. Choose a block destination or use Source.");
    }
  }
  return destination.layout.add(index, (destination.array ? "" : keyText + ": ") + entry.valueText);
}

function spliced(source: string, edits: readonly Span[], offset: number): string {
  let cursor = 0, result = "";
  for (const edit of [...edits].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const from = offset + edit.from, to = offset + edit.to;
    if (from < cursor || from > to) { throw new Error("The selected entry and destination overlap. Choose another container."); }
    result += source.slice(cursor, from) + edit.replacement; cursor = to;
  }
  return result + source.slice(cursor);
}

function proofFor(source: string, name: string, value: unknown): { proof: Proof; snapshot: Record<string, unknown> | unknown[] } {
  const snapshot = checkedStructuredPropertySnapshot(value) as Record<string, unknown> | unknown[], proof = reviewedStructuredPropertySource(source, name);
  if (!sameValue(snapshot, proof.value)) { throw new Error("The nested YAML source changed. Cancel this transfer and review its current value."); }
  return { proof, snapshot };
}

/** Two proven, non-overlapping source splices become one ordinary property edit. */
export function planStructuredPropertyTransfer(source: string, name: string, value: unknown, input: StructuredPropertyTransferOperation): StructuredPropertyTransferPlan {
  const operation = checkedOperation(input), { proof, snapshot } = proofFor(source, name, value), entry = entryAt(proof, operation.path), destination = containerAt(proof, operation.destination);
  const add = insertion(proof, entry, destination, operation.key), edits = operation.kind === "move-into" ? [entry.span, add] : [add];
  if (operation.kind === "move-into" && add.from > entry.span.from && add.from < entry.span.to) { throw new Error("The selected entry and destination overlap. Choose another container."); }
  const sourceOwner = ownerAt(snapshot, operation.path.slice(0, -1)), targetOwner = ownerAt(snapshot, operation.destination), descriptor = Object.getOwnPropertyDescriptor(sourceOwner, entry.key);
  if (!descriptor || !("value" in descriptor)) { throw refusal(); }
  // Copying must not create shared JavaScript owners; move removes the original
  // before the final descriptor/tree proof. YAML aliases are never generated.
  const payload = operation.kind === "move-into" ? descriptor.value : structuredClone(descriptor.value);
  if (Array.isArray(targetOwner)) { targetOwner.splice(operation.key as number, 0, payload); }
  else { Object.defineProperty(targetOwner, operation.key, { value: payload, enumerable: true, configurable: true, writable: true }); }
  if (operation.kind === "move-into") { if (Array.isArray(sourceOwner)) { sourceOwner.splice(entry.key as number, 1); } else { delete sourceOwner[entry.key as string]; } }
  checkedStructuredPropertySnapshot(snapshot);
  const result = spliced(source, edits, proof.offset), final = reviewedStructuredPropertySource(result, name), complete = proof.doc.toJS({ maxAliasCount: 50 });
  Object.defineProperty(complete, name, { value: snapshot, enumerable: true, configurable: true, writable: true });
  if (!sameValue(snapshot, final.value) || !sameValue(complete, final.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  const before = proof.body.slice(add.from, add.to), removal = operation.kind === "move-into" ? `\nExact source removed:\n${proof.body.slice(entry.span.from, entry.span.to)}\nSource replacement:\n${entry.span.replacement || "(empty)"}` : "\nThe original entry remains unchanged.";
  if (entry.raw.length + before.length + add.replacement.length + (operation.kind === "move-into" ? entry.span.to - entry.span.from + entry.span.replacement.length : 0) > MAX_STRUCTURED_OPERATION_REVIEW) {
    throw new Error("This transfer exceeds the complete source review limit. Transfer it in Source.");
  }
  const review = `${operation.kind === "duplicate" ? "Duplicate" : operation.kind === "copy-to" ? "Copy" : "Move"} ${identity([name, ...operation.path])}\nDestination: ${identity([name, ...operation.destination])} (${destination.array ? "List" : "Map"})\n${destination.array ? "Insertion index (starts at 0)" : "New map key"}: ${JSON.stringify(operation.key)}\nExact selected entry:\n${entry.raw}${removal}\nExact destination replacement:\n${add.replacement}\nOnly the reviewed insertion${operation.kind === "move-into" ? " and removal" : ""} changes. Value spelling and owned comments travel with the entry; block continuation indentation follows its new container. One Undo restores the previous source.`;
  return { source: result, next: snapshot, review, operation };
}

export function preserveStructuredPropertyTransferSource(updated: string, original: string, name: string, operation: StructuredPropertyTransferOperation): string {
  const proof = reviewedStructuredPropertySource(original, name), plan = planStructuredPropertyTransfer(original, name, proof.value, operation), candidate = reviewedStructuredPropertySource(updated, name), final = reviewedStructuredPropertySource(plan.source, name);
  if (!sameValue(candidate.value, plan.next) || !sameValue(candidate.doc.toJS({ maxAliasCount: 50 }), final.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  return plan.source;
}

export function structuredPropertyTransferTargets(source: string, name: string, value: unknown): StructuredPropertyTransferTargets {
  const duplicate = new Set<string>(), copy = new Set<string>(), move = new Set<string>(), transferDestinations = new Map<string, readonly StructuredPropertyTransferContainer[]>();
  try {
    const { proof } = proofFor(source, name, value), containers: Container[] = [], paths: StructuredPropertyPath[] = [];
    const inspect = (node: unknown, path: StructuredPropertyPath): void => {
      if (!isMap(node) && !isSeq(node)) { return; }
      try { containers.push(containerAt(proof, path)); } catch { /* Unproved containers stay Source-only. */ }
      for (const entry of structuredPropertyCollectionEntries(node)) { const child = [...path, entry.key]; paths.push(child); inspect(entry.node, child); }
    };
    inspect(proof.target, []);
    for (const path of paths) {
      try {
        const entry = entryAt(proof, path), destinations: StructuredPropertyTransferContainer[] = [];
        for (const container of containers) {
          if (prefix(path, container.path)) { continue; }
          const key = container.array ? container.length : suggestedKey(container, typeof entry.key === "string" ? entry.key : "entry");
          try {
            const add = insertion(proof, entry, container, key);
            if (entry.raw.length + add.replacement.length > MAX_STRUCTURED_OPERATION_REVIEW) { continue; }
            destinations.push({ path: container.path, array: container.array, length: container.length, keys: container.keys });
            const own = identity(container.path) === identity(path.slice(0, -1));
            if (own) { duplicate.add(identity(path)); }
            copy.add(identity(path));
            if (!own && entry.raw.length * 2 + entry.span.replacement.length + add.replacement.length <= MAX_STRUCTURED_OPERATION_REVIEW) { move.add(identity(path)); }
          } catch { /* Only a compatible exact payload/destination pair is offered. */ }
        }
        transferDestinations.set(identity(path), destinations);
      } catch { /* Unknown source/comment ownership stays Source-only. */ }
    }
  } catch { /* Read-only target discovery never authorizes an unproved source. */ }
  return { duplicate, "copy-to": copy, "move-into": move, transferDestinations };
}

function suggestedKey(container: StructuredPropertyTransferContainer, original: string): string {
  const taken = (key: string): boolean => container.keys.some(existing => String(existing).toLowerCase() === key.toLowerCase());
  if (!taken(original)) { return original; }
  const base = original.slice(0, 240) + " copy";
  for (let index = 1; index <= 257; index++) { const key = base + (index === 1 ? "" : " " + index); if (!taken(key)) { return key; } }
  throw refusal();
}

export function createStructuredPropertyTransferEditor(document: Document, options: {
  kind: StructuredPropertyTransferKind; path: StructuredPropertyPath; label: string; destinations: readonly StructuredPropertyTransferContainer[];
  current: () => boolean; plan: (operation: StructuredPropertyTransferOperation) => StructuredPropertyTransferPlan;
  apply: (plan: StructuredPropertyTransferPlan) => Promise<boolean>; error: (message: string) => void; closed: () => void;
}): StructuredScalarEditor {
  const parent = identity(options.path.slice(0, -1)), destinations = options.destinations.filter(destination => options.kind === "duplicate" ? identity(destination.path) === parent : options.kind !== "move-into" || identity(destination.path) !== parent);
  if (!destinations.length) { throw refusal(); }
  const element = document.createElement("div"), destinationLabel = document.createElement("label"), destination = document.createElement("select"), keyLabel = document.createElement("label"), key = document.createElement("input"), review = document.createElement("textarea"), actions = document.createElement("div"), apply = document.createElement("button"), cancel = document.createElement("button"), help = document.createElement("p");
  element.className = "metadata-structured-editor metadata-structured-operation-editor"; element.dataset.propertyStructuredOperation = options.kind;
  destination.className = key.className = "metadata-input"; destination.dataset.propertyStructuredTransferDestination = ""; destination.setAttribute("aria-label", "Destination container for " + options.label);
  for (const container of destinations) { const option = document.createElement("option"); option.value = identity(container.path); option.textContent = `${identity(container.path)} — ${container.array ? "List" : "Map"} (${container.length})`; destination.append(option); }
  destination.value = identity((options.kind === "copy-to" ? destinations.find(container => identity(container.path) !== parent) : null)?.path ?? destinations[0].path);
  destination.disabled = options.kind === "duplicate"; destinationLabel.textContent = "Destination container "; destinationLabel.append(destination);
  key.type = "text"; key.maxLength = 256; key.dataset.propertyStructuredTransferKey = ""; key.dataset.metadataInput = "";
  keyLabel.append(key); review.readOnly = true; review.rows = 10; review.className = "metadata-input metadata-structured-removal-review"; review.dataset.propertyStructuredTransferReview = ""; review.setAttribute("aria-label", "Review entry transfer for " + options.label);
  apply.type = cancel.type = "button"; apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = ""; apply.textContent = options.kind === "duplicate" ? "Apply duplicate" : options.kind === "copy-to" ? "Apply copy" : "Apply move"; cancel.textContent = "Cancel";
  actions.className = "metadata-structured-actions"; actions.append(apply, cancel); help.className = "metadata-multiline-help";
  help.textContent = "Choose an existing container in this property, then review the exact entry and destination text. Lists use insertion indexes starting at 0. No existing entry is replaced. The draft changes only after Apply; one Undo restores the source. Ctrl/⌘+Enter applies; Escape cancels.";
  element.append(destinationLabel, keyLabel, review, actions, help);
  let closed = false, busy = false, composing = false, reviewed: StructuredPropertyTransferPlan | null = null;
  const chosen = (): StructuredPropertyTransferContainer => { const container = destinations.find(container => identity(container.path) === destination.value); if (!container) { throw refusal(); } return container; };
  const plan = (): StructuredPropertyTransferPlan => { const container = chosen(); if (container.array && !/^(?:0|[1-9]\d*)$/.test(key.value)) { throw new Error("Choose a whole list insertion index starting at 0."); } return options.plan({ kind: options.kind, path: options.path, destination: container.path, key: container.array ? Number(key.value) : key.value }); };
  const preview = (): void => { if (closed || busy) { return; } try { const candidate = plan(); review.value = candidate.review; reviewed = candidate; apply.disabled = composing; } catch (issue) { reviewed = null; review.value = issue instanceof Error ? issue.message : String(issue); apply.disabled = true; } };
  const describe = (): void => { const container = chosen(); keyLabel.textContent = container.array ? `Insert at index (0–${container.length}; ${container.length} appends) ` : "New map key "; keyLabel.append(key); key.setAttribute("aria-label", (container.array ? "Insertion index" : "New map key") + " for " + options.label); key.inputMode = container.array ? "numeric" : "text";
    key.value = container.array ? String(options.kind === "duplicate" ? Number(options.path.at(-1)) + 1 : container.length) : suggestedKey(container, typeof options.path.at(-1) === "string" ? options.path.at(-1) as string : "entry"); preview(); };
  const owns = (): boolean => !closed && key.isConnected && destination.isConnected && element.contains(key) && element.contains(destination);
  const close = (): void => { if (closed) { return; } closed = true; reviewed = null; element.remove(); options.closed(); };
  const save = async (): Promise<void> => {
    if (closed || busy || composing) { return; }
    if (!owns() || !options.current() || !(element.checkVisibility?.() ?? true)) { options.error("The note or nested property owner changed. Cancel this transfer and review the current source."); return; }
    try {
      const candidate = plan();
      // Textareas normalize CRLF. The raw reviewed plan remains authoritative.
      if (!reviewed || identityOperation(reviewed.operation) !== identityOperation(candidate.operation) || reviewed.source !== candidate.source || reviewed.review !== candidate.review || review.value !== multilineText(candidate.review)) {
        preview(); throw new Error("The transfer destination or source changed. Review the current exact text before applying it.");
      }
      busy = true; for (const control of [destination, key, apply, cancel]) { control.disabled = true; }
      if (await options.apply(candidate)) { if (closed) { options.closed(); } else { close(); } }
    } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
    finally { busy = false; destination.disabled = options.kind === "duplicate"; key.disabled = cancel.disabled = false; preview(); }
  };
  for (const control of [key, destination]) {
    control.addEventListener("compositionstart", () => { if (owns() && !busy) { composing = true; apply.disabled = true; } });
    control.addEventListener("compositionend", () => { if (owns() && !busy) { composing = false; preview(); } });
    for (const event of ["input", "change"]) { control.addEventListener(event, () => { if (owns() && !busy && !composing) { if (control === destination) { describe(); } else { preview(); } } }); }
  }
  for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
  apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
  element.addEventListener("keydown", event => { if (closed || busy || composing || event.isComposing || event.keyCode === 229 || ["Process", "Unidentified"].includes(event.key)) { return; } if (event.key === "Escape") { event.preventDefault(); options.error(""); close(); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
  describe(); return { element, input: key, get active() { return !closed; }, refreshReview: preview, dispose() { closed = true; reviewed = null; element.remove(); } };
}

const identityOperation = (operation: StructuredPropertyTransferOperation): string => JSON.stringify(operation);

// The independent same-note, cross-property extension reuses these exact CST
// ownership/slot proofs. It supplies two separately reviewed ordinary roots;
// neither extension serializes source or runs two property transactions.
export { containerAt as structuredPropertyTransferContainerAt, entryAt as structuredPropertyTransferEntryAt,
  insertion as structuredPropertyTransferInsertion, ownerAt as structuredPropertyTransferOwnerAt,
  spliced as spliceStructuredPropertyTransfers, proofFor as structuredPropertyTransferProofFor,
  suggestedKey as suggestedStructuredPropertyTransferKey };
