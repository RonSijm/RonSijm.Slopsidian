import { isMap, isScalar, isSeq } from "yaml";
import { sameValue } from "./markdown";
import { MAX_STRUCTURED_PROPERTY_DEPTH, multilineText } from "./multiline-properties";
import { checkedStructuredPropertySnapshot, reviewedStructuredPropertySource, type StructuredPropertyPath, type StructuredScalarEditor } from "./structured-properties";
import { MAX_STRUCTURED_OPERATION_REVIEW, structuredPropertyCollectionEntries } from "./structured-property-operations";
import { structuredPropertyTransferContainerAt as containerAt, structuredPropertyTransferEntryAt as entryAt,
  structuredPropertyTransferInsertion as insertion, structuredPropertyTransferOwnerAt as ownerAt,
  structuredPropertyTransferProofFor as proofFor, spliceStructuredPropertyTransfers as spliced,
  suggestedStructuredPropertyTransferKey as suggestedKey, type StructuredPropertyTransferContainer } from "./structured-property-transfers";

export type StructuredPropertyCrossTransferKind = "copy-to-property" | "move-to-property";
export interface StructuredPropertyCrossTransferOperation {
  readonly kind: StructuredPropertyCrossTransferKind; readonly path: StructuredPropertyPath;
  readonly property: string; readonly destination: StructuredPropertyPath; readonly key: string | number;
}
export interface StructuredPropertyCrossTransferPlan {
  readonly source: string; readonly sourceNext: unknown; readonly destinationPrior: unknown; readonly destinationNext: unknown;
  readonly review: string; readonly operation: StructuredPropertyCrossTransferOperation;
}
export interface StructuredPropertyCrossTransferContainer extends StructuredPropertyTransferContainer { readonly property: string }
export interface StructuredPropertyCrossTransferTargets {
  readonly "copy-to-property": ReadonlySet<string>; readonly "move-to-property": ReadonlySet<string>;
  readonly crossTransferDestinations: ReadonlyMap<string, readonly StructuredPropertyCrossTransferContainer[]>;
}
const unsafe = new Set(["__proto__", "prototype", "constructor", "<<"]), builtins = new Set(["tags", "aliases", "cssclasses"]);
const identity = (path: StructuredPropertyPath): string => JSON.stringify(path);
const refusal = (): Error => new Error("This entry or other property has no lossless transfer proof. Review it in Source.");
export const isStructuredPropertyCrossTransferKind = (kind: string): kind is StructuredPropertyCrossTransferKind => kind === "copy-to-property" || kind === "move-to-property";
const ordinaryName = (name: string): boolean => Boolean(name.trim()) && name.length <= 256 && !/[\x00-\x1f\x7f]/.test(name) && !unsafe.has(name) && !builtins.has(name.toLowerCase());

function checkedOperation(name: string, input: StructuredPropertyCrossTransferOperation): StructuredPropertyCrossTransferOperation {
  // Read no caller getters before the bounded descriptor proof.
  const { operation } = checkedStructuredPropertySnapshot({ operation: input }) as { operation: StructuredPropertyCrossTransferOperation };
  const path = (value: StructuredPropertyPath): boolean => Array.isArray(value) && value.length <= MAX_STRUCTURED_PROPERTY_DEPTH
    && value.every(key => typeof key === "string" ? !unsafe.has(key) : Number.isSafeInteger(key) && key >= 0);
  if (!operation || Object.keys(operation).sort().join(",") !== "destination,key,kind,path,property" || !isStructuredPropertyCrossTransferKind(operation.kind)
    || typeof name !== "string" || !ordinaryName(name) || typeof operation.property !== "string" || !ordinaryName(operation.property)
    || name.toLowerCase() === operation.property.toLowerCase() || !path(operation.path) || !operation.path.length || !path(operation.destination)
    || (typeof operation.key === "string" ? !operation.key.trim() || operation.key.length > 256 || /[\r\n]/.test(operation.key) || unsafe.has(operation.key)
      : !Number.isSafeInteger(operation.key) || operation.key < 0)) { throw refusal(); }
  return operation;
}

function uniqueNames(proof: ReturnType<typeof reviewedStructuredPropertySource>, source: string, destination?: string): void {
  if (!isMap(proof.doc.contents)) { throw refusal(); }
  for (const name of [source, ...destination === undefined ? [] : [destination]]) {
    if (!ordinaryName(name) || proof.doc.contents.items.filter(pair => isScalar(pair.key) && typeof pair.key.value === "string" && pair.key.value.toLowerCase() === name.toLowerCase()).length !== 1) { throw refusal(); }
  }
}

/** Two separately proved top-level roots, one exact source transform and Undo. */
export function planStructuredPropertyCrossTransfer(source: string, name: string, value: unknown, input: StructuredPropertyCrossTransferOperation): StructuredPropertyCrossTransferPlan {
  const operation = checkedOperation(name, input), { proof, snapshot: sourceNext } = proofFor(source, name, value);
  uniqueNames(proof, name, operation.property);
  const other = reviewedStructuredPropertySource(source, operation.property), destinationPrior = other.value,
    destinationNext = checkedStructuredPropertySnapshot(destinationPrior), entry = entryAt(proof, operation.path), destination = containerAt(other, operation.destination);
  const add = insertion(other, entry, destination, operation.key), moving = operation.kind === "move-to-property";
  const sourceOwner = ownerAt(sourceNext, operation.path.slice(0, -1)), targetOwner = ownerAt(destinationNext, operation.destination), descriptor = Object.getOwnPropertyDescriptor(sourceOwner, entry.key);
  if (!descriptor || !("value" in descriptor)) { throw refusal(); }
  const payload = structuredClone(descriptor.value);
  if (Array.isArray(targetOwner)) { targetOwner.splice(operation.key as number, 0, payload); }
  else { Object.defineProperty(targetOwner, operation.key, { value: payload, enumerable: true, configurable: true, writable: true }); }
  if (moving) { if (Array.isArray(sourceOwner)) { sourceOwner.splice(entry.key as number, 1); } else { delete sourceOwner[entry.key as string]; } }
  checkedStructuredPropertySnapshot(sourceNext); checkedStructuredPropertySnapshot(destinationNext);
  const result = spliced(source, moving ? [entry.span, add] : [add], proof.offset), final = reviewedStructuredPropertySource(result, name), finalOther = reviewedStructuredPropertySource(result, operation.property), complete = proof.doc.toJS({ maxAliasCount: 50 });
  Object.defineProperty(complete, name, { value: sourceNext, enumerable: true, configurable: true, writable: true });
  Object.defineProperty(complete, operation.property, { value: destinationNext, enumerable: true, configurable: true, writable: true });
  if (!sameValue(sourceNext, final.value) || !sameValue(destinationNext, finalOther.value) || !sameValue(complete, final.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  const before = proof.body.slice(add.from, add.to), removed = moving ? proof.body.slice(entry.span.from, entry.span.to) : "";
  if (entry.raw.length + before.length + add.replacement.length + removed.length + (moving ? entry.span.replacement.length : 0) > MAX_STRUCTURED_OPERATION_REVIEW) {
    throw new Error("This transfer exceeds the complete source review limit. Transfer it in Source.");
  }
  const review = `${moving ? "Move" : "Copy"} ${identity([name, ...operation.path])}\nDestination property: ${JSON.stringify(operation.property)}\nDestination: ${identity([operation.property, ...operation.destination])} (${destination.array ? "List" : "Map"})\n${destination.array ? "Insertion index (starts at 0)" : "New map key"}: ${JSON.stringify(operation.key)}\nExact selected entry:\n${entry.raw}\n${moving ? `Exact source removed:\n${removed}\nSource replacement:\n${entry.span.replacement || "(empty)"}` : "The original entry remains unchanged."}\nExact destination replaced:\n${before || "(empty)"}\nExact destination replacement:\n${add.replacement}\nBoth properties belong to this note. Only the reviewed insertion${moving ? " and removal" : ""} changes. Value spelling and owned comments travel with the entry; block continuation indentation follows its new container. One Apply and one Undo cover both properties.`;
  return { source: result, sourceNext, destinationPrior, destinationNext, review, operation };
}

/** Prove the ordinary queue's complete candidate before restoring exact lexemes. */
export function preserveStructuredPropertyCrossTransferSource(updated: string, original: string, name: string, operation: StructuredPropertyCrossTransferOperation): string {
  const before = reviewedStructuredPropertySource(original, name), plan = planStructuredPropertyCrossTransfer(original, name, before.value, operation), candidate = reviewedStructuredPropertySource(updated, name), other = reviewedStructuredPropertySource(updated, operation.property), final = reviewedStructuredPropertySource(plan.source, name);
  if (!sameValue(candidate.value, plan.sourceNext) || !sameValue(other.value, plan.destinationNext) || !sameValue(candidate.doc.toJS({ maxAliasCount: 50 }), final.doc.toJS({ maxAliasCount: 50 }))) { throw refusal(); }
  return plan.source;
}

/** Cached source only; discovery never reads disk or allocates an editor. */
export function structuredPropertyCrossTransferTargets(source: string, name: string, value: unknown): StructuredPropertyCrossTransferTargets {
  const copy = new Set<string>(), move = new Set<string>(), crossTransferDestinations = new Map<string, readonly StructuredPropertyCrossTransferContainer[]>();
  try {
    const { proof } = proofFor(source, name, value); uniqueNames(proof, name);
    if (!isMap(proof.doc.contents)) { return { "copy-to-property": copy, "move-to-property": move, crossTransferDestinations }; }
    const containers: { proof: ReturnType<typeof reviewedStructuredPropertySource>; container: ReturnType<typeof containerAt>; property: string }[] = [];
    for (const pair of proof.doc.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string" || pair.key.value.toLowerCase() === name.toLowerCase() || !ordinaryName(pair.key.value)) { continue; }
      const property = pair.key.value;
      try {
        uniqueNames(proof, property); const other = reviewedStructuredPropertySource(source, property);
        const inspect = (node: unknown, path: StructuredPropertyPath): void => {
          if (!isMap(node) && !isSeq(node)) { return; }
          try { containers.push({ proof: other, container: containerAt(other, path), property }); } catch { /* Ambiguous destinations remain Source-only. */ }
          for (const entry of structuredPropertyCollectionEntries(node)) { inspect(entry.node, [...path, entry.key]); }
        };
        inspect(other.target, []);
      } catch { /* Unknown aliases, tags, precision or ownership stay untouched. */ }
    }
    const inspect = (node: unknown, path: StructuredPropertyPath): void => {
      if (!isMap(node) && !isSeq(node)) { return; }
      for (const child of structuredPropertyCollectionEntries(node)) {
        const selected = [...path, child.key], destinations: StructuredPropertyCrossTransferContainer[] = [];
        try {
          const entry = entryAt(proof, selected);
          for (const target of containers) {
            try {
              const container = target.container, key = container.array ? container.length : suggestedKey(container, typeof entry.key === "string" ? entry.key : "entry"), add = insertion(target.proof, entry, container, key), before = proof.body.slice(add.from, add.to);
              if (entry.raw.length + before.length + add.replacement.length > MAX_STRUCTURED_OPERATION_REVIEW) { continue; }
              destinations.push({ property: target.property, path: container.path, array: container.array, length: container.length, keys: container.keys }); copy.add(identity(selected));
              if (entry.raw.length + before.length + add.replacement.length + entry.span.to - entry.span.from + entry.span.replacement.length <= MAX_STRUCTURED_OPERATION_REVIEW) { move.add(identity(selected)); }
            } catch { /* Offer only a compatible payload/ordinary destination pair. */ }
          }
          crossTransferDestinations.set(identity(selected), destinations);
        } catch { /* Source ownership must be proved before offering a transfer. */ }
        inspect(child.node, selected);
      }
    };
    inspect(proof.target, []);
  } catch { /* Cached discovery confers no mutation authority. */ }
  return { "copy-to-property": copy, "move-to-property": move, crossTransferDestinations };
}

/** A visible, cancellable destination draft retains its own raw review stamp. */
export function createStructuredPropertyCrossTransferEditor(document: Document, options: {
  kind: StructuredPropertyCrossTransferKind; path: StructuredPropertyPath; label: string; destinations: readonly StructuredPropertyCrossTransferContainer[];
  current: () => boolean; plan: (operation: StructuredPropertyCrossTransferOperation) => StructuredPropertyCrossTransferPlan;
  apply: (plan: StructuredPropertyCrossTransferPlan) => Promise<boolean>; error: (message: string) => void; closed: () => void;
}): StructuredScalarEditor {
  const destinations = options.destinations; if (!destinations.length) { throw refusal(); }
  const element = document.createElement("div"), propertyLabel = document.createElement("label"), property = document.createElement("select"), destinationLabel = document.createElement("label"), destination = document.createElement("select"), keyLabel = document.createElement("label"), key = document.createElement("input"), review = document.createElement("textarea"), actions = document.createElement("div"), apply = document.createElement("button"), cancel = document.createElement("button"), help = document.createElement("p");
  element.className = "metadata-structured-editor metadata-structured-operation-editor"; element.dataset.propertyStructuredOperation = options.kind;
  property.className = destination.className = key.className = "metadata-input"; property.dataset.propertyStructuredCrossProperty = ""; destination.dataset.propertyStructuredCrossDestination = "";
  property.setAttribute("aria-label", "Destination property for " + options.label); destination.setAttribute("aria-label", "Destination container for " + options.label);
  for (const name of new Set(destinations.map(container => container.property))) { const option = document.createElement("option"); option.value = option.textContent = name; property.append(option); }
  property.value = destinations[0].property; propertyLabel.textContent = "Other property in this note "; propertyLabel.append(property); destinationLabel.textContent = "Destination container "; destinationLabel.append(destination);
  key.type = "text"; key.maxLength = 256; key.dataset.propertyStructuredCrossKey = ""; key.dataset.metadataInput = ""; keyLabel.append(key);
  review.readOnly = true; review.rows = 12; review.className = "metadata-input metadata-structured-removal-review"; review.dataset.propertyStructuredCrossReview = ""; review.setAttribute("aria-label", "Review transfer between properties for " + options.label);
  apply.type = cancel.type = "button"; apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = ""; apply.textContent = options.kind === "copy-to-property" ? "Apply copy" : "Apply move"; cancel.textContent = "Cancel";
  actions.className = "metadata-structured-actions"; actions.append(apply, cancel); help.className = "metadata-multiline-help";
  help.textContent = "Choose another existing Map or List in this note, then a compatible container. Enter a new map key or list insertion index starting at 0. Review both exact changes before Apply. One Undo restores both properties. Ctrl/⌘+Enter applies; Escape cancels.";
  element.append(propertyLabel, destinationLabel, keyLabel, review, actions, help);
  let closed = false, busy = false, composing = false, reviewed: StructuredPropertyCrossTransferPlan | null = null;
  const chosen = (): StructuredPropertyCrossTransferContainer => { const container = destinations.find(container => container.property === property.value && identity(container.path) === destination.value); if (!container) { throw refusal(); } return container; };
  const plan = (): StructuredPropertyCrossTransferPlan => { const container = chosen(); if (container.array && !/^(?:0|[1-9]\d*)$/.test(key.value)) { throw new Error("Choose a whole list insertion index starting at 0."); } return options.plan({ kind: options.kind, path: options.path, property: container.property, destination: container.path, key: container.array ? Number(key.value) : key.value }); };
  const preview = (): void => { if (closed || busy) { return; } try { const candidate = plan(); review.value = candidate.review; reviewed = candidate; apply.disabled = composing; } catch (issue) { reviewed = null; review.value = issue instanceof Error ? issue.message : String(issue); apply.disabled = true; } };
  const describe = (): void => { const container = chosen(); keyLabel.textContent = container.array ? `Insert at index (0–${container.length}; ${container.length} appends) ` : "New map key "; keyLabel.append(key); key.setAttribute("aria-label", (container.array ? "Insertion index" : "New map key") + " for " + options.label); key.inputMode = container.array ? "numeric" : "text"; key.value = container.array ? String(container.length) : suggestedKey(container, typeof options.path.at(-1) === "string" ? options.path.at(-1) as string : "entry"); preview(); };
  const populate = (): void => { destination.textContent = ""; for (const container of destinations.filter(container => container.property === property.value)) { const option = document.createElement("option"); option.value = identity(container.path); option.textContent = `${identity(container.path)} — ${container.array ? "List" : "Map"} (${container.length})`; destination.append(option); } const first = destinations.find(container => container.property === property.value); if (!first) { throw refusal(); } destination.value = identity(first.path); describe(); };
  const owns = (): boolean => !closed && [property, destination, key].every(control => control.isConnected && element.contains(control));
  const close = (): void => { if (closed) { return; } closed = true; reviewed = null; element.remove(); options.closed(); };
  const save = async (): Promise<void> => {
    if (closed || busy || composing) { return; }
    if (!owns() || !options.current() || !(element.checkVisibility?.() ?? true)) { options.error("The note or nested property owner changed. Cancel this transfer and review the current source."); return; }
    try {
      const candidate = plan();
      // A textarea normalizes CRLF. Both the original raw stamp and its visible
      // normalized form must still match the exact same source/operation.
      if (!reviewed || JSON.stringify(reviewed.operation) !== JSON.stringify(candidate.operation) || reviewed.source !== candidate.source || reviewed.review !== candidate.review || review.value !== multilineText(candidate.review)) { preview(); throw new Error("The transfer destination or source changed. Review the current exact text before applying it."); }
      busy = true; for (const control of [property, destination, key, apply, cancel]) { control.disabled = true; }
      if (await options.apply(candidate)) { if (closed) { options.closed(); } else { close(); } }
    } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
    finally { busy = false; property.disabled = destination.disabled = key.disabled = cancel.disabled = false; preview(); }
  };
  for (const control of [property, destination, key]) {
    control.addEventListener("compositionstart", () => { if (owns() && !busy) { composing = true; apply.disabled = true; } }); control.addEventListener("compositionend", () => { if (owns() && !busy) { composing = false; preview(); } });
    for (const event of ["input", "change"]) { control.addEventListener(event, () => { if (owns() && !busy && !composing) { if (control === property) { populate(); } else if (control === destination) { describe(); } else { preview(); } } }); }
  }
  for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
  apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
  element.addEventListener("keydown", event => { if (closed || busy || composing || event.isComposing || event.keyCode === 229 || ["Process", "Unidentified"].includes(event.key)) { return; } if (event.key === "Escape") { event.preventDefault(); options.error(""); close(); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
  populate(); return { element, input: key, get active() { return !closed; }, refreshReview: preview, dispose() { closed = true; reviewed = null; element.remove(); } };
}
