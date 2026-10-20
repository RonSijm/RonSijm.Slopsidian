import { isMap, isNode, isScalar, isSeq, type Node, type YAMLMap, type YAMLSeq } from "yaml";
import { sameValue } from "./markdown";
import { MAX_STRUCTURED_PROPERTY_DEPTH, multilineText } from "./multiline-properties";
import { checkedStructuredPropertySnapshot, createStructuredScalarEditor, reviewedStructuredPropertySource, type StructuredPropertyPath, type StructuredScalar, type StructuredScalarEditor } from "./structured-properties";

/** Independent extension: the pinned original does not establish nested add/remove UI. */
export const MAX_STRUCTURED_OPERATION_REVIEW = 8192;
export type StructuredPropertyAddition = StructuredScalar | Record<string, never> | readonly [];
export type StructuredPropertyMove = "move-up" | "move-down" | "move-to";
export type StructuredPropertyOperation = { kind: "add"; path: StructuredPropertyPath; key: string | number; value: StructuredPropertyAddition }
  | { kind: "remove"; path: StructuredPropertyPath }
  | { kind: "move-up"; path: StructuredPropertyPath }
  | { kind: "move-down"; path: StructuredPropertyPath }
  | { kind: "move-to"; path: StructuredPropertyPath; position: number }
  | { kind: "rename"; path: StructuredPropertyPath; key: string };
export type StructuredPropertyCollection = YAMLMap<unknown, unknown> | YAMLSeq<unknown>;
type Collection = StructuredPropertyCollection;
type Span = { from: number; to: number };
type Layout = { array: boolean; keys: (string | number)[]; add(index: number, literal: string): Span & { replacement: string }; remove(index: number): Span & { replacement: string }; move(index: number, destination: number): Span & { replacement: string } };
export interface StructuredPropertyOperationPlan { readonly source: string; readonly next: unknown; readonly review: string; readonly operation: StructuredPropertyOperation }
export interface StructuredPropertyOperationTargets { readonly add: ReadonlySet<string>; readonly remove: ReadonlySet<string>; readonly rename: ReadonlySet<string>; readonly "move-up": ReadonlySet<string>; readonly "move-down": ReadonlySet<string>; readonly "move-to": ReadonlySet<string>; readonly moves: ReadonlyMap<string, { up: boolean; down: boolean }>; readonly positions: ReadonlyMap<string, { position: number; length: number }>; readonly containers: ReadonlyMap<string, { array: boolean; length: number }>; readonly limits: ReadonlyMap<string, string> }
const unsafe = new Set(["__proto__", "prototype", "constructor", "<<"]);
const refuse = (): Error => new Error("This collection layout or operation cannot be changed safely here. Review it in Source.");
const literal = (value: StructuredPropertyAddition): string => (Object.is(value, -0) ? "-0" : JSON.stringify(value)).replace(/[\u0085\u2028\u2029]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
const pathKey = (path: StructuredPropertyPath): string => JSON.stringify(path);

function checkedOperation(input: StructuredPropertyOperation): StructuredPropertyOperation {
  // This proof runs before reading a caller's operation, path or scalar getters.
  const { operation } = checkedStructuredPropertySnapshot({ operation: input }) as { operation: StructuredPropertyOperation };
  if (!operation || typeof operation !== "object" || !["add", "remove", "rename", "move-up", "move-down", "move-to"].includes(operation.kind) || !Array.isArray(operation.path)
    || operation.path.length > MAX_STRUCTURED_PROPERTY_DEPTH || operation.path.some(key => typeof key === "string" ? unsafe.has(key) : !Number.isSafeInteger(key) || key < 0)) { throw refuse(); }
  const keys = Object.keys(operation).sort().join(",");
  if (operation.kind === "remove" || operation.kind === "move-up" || operation.kind === "move-down") { if (!operation.path.length || keys !== "kind,path") { throw refuse(); } }
  else if (operation.kind === "move-to") {
    if (!operation.path.length || keys !== "kind,path,position" || !Number.isSafeInteger(operation.position) || operation.position < 1) { throw new Error("Choose a whole final position within this collection, starting at 1."); }
  }
  else if (operation.kind === "rename") {
    if (!operation.path.length || keys !== "key,kind,path" || typeof operation.key !== "string" || !operation.key.trim()
      || operation.key.length > 256 || /[\r\n]/.test(operation.key) || unsafe.has(operation.key)) { throw refuse(); }
  }
  else {
    if (keys !== "key,kind,path,value" || typeof operation.key !== "string" && typeof operation.key !== "number"
      || typeof operation.key === "string" && (!operation.key.trim() || operation.key.length > 256 || unsafe.has(operation.key))
      || typeof operation.key === "number" && (!Number.isSafeInteger(operation.key) || operation.key < 0)
      || operation.value !== null && !["string", "number", "boolean"].includes(typeof operation.value)
        && (typeof operation.value !== "object" || Object.keys(operation.value).length !== 0)) { throw refuse(); }
  }
  return operation;
}

function ownerAt(value: unknown, path: StructuredPropertyPath): Record<string, unknown> | unknown[] {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || (Array.isArray(current) ? typeof key !== "number" : typeof key !== "string" || unsafe.has(key))) { throw refuse(); }
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor || !("value" in descriptor)) { throw refuse(); } current = descriptor.value;
  }
  if (!current || typeof current !== "object") { throw refuse(); }
  return current as Record<string, unknown> | unknown[];
}

function collectionEntries(node: Collection): { key: string | number; node: Node; from: number; to: number }[] {
  if (isMap(node)) {
    return node.items.map(pair => {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !pair.key.range || !isNode(pair.value) || !pair.value.range) { throw refuse(); }
      return { key: pair.key.value, node: pair.value, from: pair.key.range[0], to: pair.value.range[1] };
    });
  }
  return node.items.map((item, index) => { if (!isNode(item) || !item.range) { throw refuse(); } return { key: index, node: item, from: item.range[0], to: item.range[1] }; });
}

/** Entries travel unchanged; each original separator stays in its source slot. */
function movedEntrySpan(entries: readonly Span[], body: string, index: number, destination: number): Span & { replacement: string } {
  if (!entries[index] || !entries[destination]) { throw new Error("Choose a final position within this collection."); }
  if (index === destination) { throw new Error("Choose a different final position; this entry is already there."); }
  const low = Math.min(index, destination), high = Math.max(index, destination), order = Array.from({ length: high - low + 1 }, (_, offset) => low + offset);
  const [moved] = order.splice(index - low, 1); order.splice(destination - low, 0, moved);
  return { from: entries[low].from, to: entries[high].to, replacement: order.map((original, slot) => body.slice(entries[original].from, entries[original].to)
    + (slot < order.length - 1 ? body.slice(entries[low + slot].to, entries[low + slot + 1].from) : "")).join("") };
}

/** One entry per line, with punctuation/whitespace as the only separators.
 * Comments between entries cannot be assigned to an owner from resolved YAML. */
function multilineFlowLayout(node: Collection, body: string, closing: number): Layout {
  const token = node.srcToken, entries = collectionEntries(node), array = isSeq(node), keys = entries.map(entry => entry.key);
  if (!token || token.type !== "flow-collection" || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 62) { throw refuse(); }
  const closingIndent = " ".repeat(token.indent), first = entries[0];
  const opening = body.slice(token.offset + 1, first?.from ?? closing), match = /^[ \t]*(\r?\n)( *)$/.exec(opening);
  if (!match || match[2].length > 64 || (first ? match[2].length <= token.indent : match[2] !== closingIndent)) { throw refuse(); }
  const newline = match[1], indent = first ? match[2] : closingIndent + "  ", lineStarts: number[] = [];
  const closeStart = closing - closingIndent.length;
  let previous = token.offset + 1;
  entries.forEach((entry, index) => {
    const separator = body.slice(previous, entry.from), expected = index ? "," : "";
    if (!new RegExp("^" + expected + "[ \\t]*" + (newline === "\r\n" ? "\\r\\n" : "\\n") + indent + "$").test(separator)
      || entry.to <= entry.from || body.slice(entry.from - indent.length, entry.from) !== indent) { throw refuse(); }
    if (isMap(node)) {
      const pair = node.items[index];
      if (!isScalar(pair.key) || !pair.key.range || !entry.node.range || !/^:[ \t]*$/.test(body.slice(pair.key.range[1], entry.node.range[0]))) { throw refuse(); }
    }
    lineStarts.push(entry.from - indent.length); previous = entry.to;
  });
  const tail = body.slice(previous, closing), tailMatch = /^(,?)[ \t]*(\r?\n)( *)$/.exec(tail);
  if (entries.length && (!tailMatch || tailMatch[2] !== newline || tailMatch[3] !== closingIndent)) { throw refuse(); }
  const trailing = Boolean(entries.length && tailMatch?.[1]);
  if (token.items.length !== entries.length) {
    const extra = token.items.at(-1);
    if (token.items.length !== entries.length + 1 || !extra || extra.key || extra.value || extra.sep?.length
      || extra.start.some(part => !["comma", "space", "newline"].includes(part.type))) { throw refuse(); }
  } else if (trailing) { throw refuse(); }
  return { array, keys,
    add(index, text) {
      if (!entries.length) { return { from: closeStart, to: closeStart, replacement: indent + text + newline }; }
      if (index < entries.length) { return { from: entries[index].from, to: entries[index].from, replacement: text + "," + newline + indent }; }
      const end = entries.at(-1)!.to + (trailing ? 1 : 0);
      return { from: end, to: end, replacement: (trailing ? "" : ",") + newline + indent + text + (trailing ? "," : "") };
    },
    remove(index) {
      const entry = entries[index]; if (!entry) { throw refuse(); }
      if (entries.length === 1) { return { from: lineStarts[0], to: closeStart, replacement: "" }; }
      if (index < entries.length - 1) { return { from: lineStarts[index], to: lineStarts[index + 1], replacement: "" }; }
      return trailing ? { from: lineStarts[index], to: closeStart, replacement: "" }
        : { from: entries[index - 1].to, to: entry.to, replacement: "" };
    },
    move(index, destination) { return movedEntrySpan(entries, body, index, destination); }
  };
}

/** General flow punctuation proof. Only unowned whitespace may separate entries.
 * Existing entry lexemes, prefix/tail whitespace and separator slots stay raw;
 * comments inside a nested value travel with that value, never a separator. */
function mixedFlowLayout(node: Collection, body: string): Layout {
  const token = node.srcToken, entries = collectionEntries(node), array = isSeq(node), keys = entries.map(entry => entry.key);
  if (!token || token.type !== "flow-collection" || !node.range || token.offset !== node.range[0]
    || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 64) { throw refuse(); }
  const close = token.end.find(part => part.type === (array ? "flow-seq-end" : "flow-map-end")), open = token.offset;
  if (!close || close.offset !== node.range[1] - 1 || body[open] !== (array ? "[" : "{") || body[close.offset] !== (array ? "]" : "}")) { throw refuse(); }
  const whitespace = /^[ \t\r\n]*$/, separator = /^[ \t\r\n]*,[ \t\r\n]*$/, separators: string[] = [];
  let previous = open + 1;
  entries.forEach((entry, index) => {
    const gap = body.slice(previous, entry.from), item = token.items[index];
    if (!(index ? separator : whitespace).test(gap) || entry.to <= entry.from || entry.to > close.offset || !item
      || item.start.some(part => !["comma", "space", "newline"].includes(part.type))) { throw refuse(); }
    if (index) { separators.push(gap); }
    if (isMap(node)) {
      const pair = node.items[index];
      if (!isScalar(pair.key) || !pair.key.range || !entry.node.range || item.key?.offset !== pair.key.range[0]
        || !/^[ \t\r\n]*:[ \t\r\n]*$/.test(body.slice(pair.key.range[1], entry.node.range[0]))) { throw refuse(); }
    } else if (item.key || item.sep?.length || item.value?.offset !== entry.node.range?.[0]) { throw refuse(); }
    previous = entry.to;
  });
  const tail = body.slice(previous, close.offset);
  if (!(entries.length ? /^[ \t\r\n]*,?[ \t\r\n]*$/ : whitespace).test(tail)) { throw refuse(); }
  const commaAt = tail.indexOf(","), trailing = commaAt >= 0;
  const extra = token.items[entries.length];
  if (token.items.length !== entries.length) {
    if (token.items.length !== entries.length + 1 || !extra || extra.key || extra.value || extra.sep?.length
      || extra.start.some(part => !["comma", "space", "newline"].includes(part.type))) { throw refuse(); }
  } else if (trailing) { throw refuse(); }
  // Reuse one already-proved comma/whitespace gap for the new entry. Existing
  // gaps are never normalized, including mixed LF/CRLF and tabs in flow space.
  const insertionGap = (index: number): string => separators[Math.min(Math.max(0, index - 1), separators.length - 1)]
    ?? (trailing ? tail : ", ");
  return { array, keys,
    add(index, text) {
      if (!entries.length) {
        const line = body.lastIndexOf("\n", close.offset - 1) + 1, indent = body.slice(line, close.offset);
        if (line > open && /^ *$/.test(indent)) {
          const newline = body[line - 2] === "\r" ? "\r\n" : "\n";
          return { from: line, to: line, replacement: " ".repeat(token.indent + 2) + text + newline };
        }
        return { from: close.offset, to: close.offset, replacement: text };
      }
      if (index < entries.length) { return { from: entries[index].from, to: entries[index].from, replacement: text + insertionGap(index) }; }
      const end = entries.at(-1)!.to; return { from: end, to: end, replacement: insertionGap(entries.length) + text };
    },
    remove(index) {
      const entry = entries[index]; if (!entry) { throw refuse(); }
      if (entries.length === 1) {
        return trailing ? { from: entry.from, to: entry.to + commaAt + 1, replacement: tail.slice(0, commaAt) }
          : { from: entry.from, to: entry.to, replacement: "" };
      }
      return index < entries.length - 1 ? { from: entry.from, to: entries[index + 1].from, replacement: "" }
        : { from: entries[index - 1].to, to: entry.to, replacement: "" };
    },
    move(index, destination) { return movedEntrySpan(entries, body, index, destination); }
  };
}

/** Prove a narrow CST layout. All offsets here are relative to the YAML body. */
function layoutFor(node: Collection, body: string): Layout {
  const token = node.srcToken, entries = collectionEntries(node), array = isSeq(node), keys = entries.map(entry => entry.key);
  if (!token || !node.range || token.offset !== node.range[0] || !("items" in token)) { throw refuse(); }
  if (token.type === "flow-collection") {
    try {
    const closing = token.end.find(end => end.type === (array ? "flow-seq-end" : "flow-map-end")), open = token.offset;
    if (!closing || closing.offset !== node.range[1] - 1 || body[open] !== (array ? "[" : "{") || body[closing.offset] !== (array ? "]" : "}")) { throw refuse(); }
    if (/[\r\n]/.test(body.slice(open, closing.offset + 1))) { return multilineFlowLayout(node, body, closing.offset); }
    if (token.items.length !== entries.length) { throw refuse(); }
    let previous = open + 1;
    entries.forEach((entry, index) => {
      if (!(index === 0 ? /^[ \t]*$/ : /^[ \t]*,[ \t]*$/).test(body.slice(previous, entry.from)) || entry.to < entry.from) { throw refuse(); }
      if (isMap(node)) {
        const pair = node.items[index];
        if (!isScalar(pair.key) || !pair.key.range || !entry.node.range || !/^:[ \t]*$/.test(body.slice(pair.key.range[1], entry.node.range[0]))) { throw refuse(); }
      }
      previous = entry.to;
    });
    if (!/^[ \t]*$/.test(body.slice(previous, closing.offset))) { throw refuse(); }
    return { array, keys,
      add(index, text) {
        if (!entries.length) { return { from: closing.offset, to: closing.offset, replacement: text }; }
        if (index < entries.length) { return { from: entries[index].from, to: entries[index].from, replacement: text + ", " }; }
        const end = entries.at(-1)!.to; return { from: end, to: end, replacement: ", " + text };
      },
      remove(index) {
        const entry = entries[index]; if (!entry) { throw refuse(); }
        if (entries.length === 1) { return { from: entry.from, to: entry.to, replacement: "" }; }
        return index < entries.length - 1 ? { from: entry.from, to: entries[index + 1].from, replacement: "" }
          : { from: entries[index - 1].to, to: entry.to, replacement: "" };
      },
      move(index, destination) { return movedEntrySpan(entries, body, index, destination); }
    };
    } catch { return mixedFlowLayout(node, body); }
  }
  if (token.type !== (array ? "block-seq" : "block-map") || token.items.length !== entries.length || !entries.length || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 64) { throw refuse(); }
  const indent = " ".repeat(token.indent), spans: Span[] = [];
  entries.forEach((entry, index) => {
    const item = token.items[index];
    const indicator = array ? item.start.find(start => start.type === "seq-item-ind") : item.key;
    if (!indicator || indicator.offset < 0 || array && (!("source" in indicator) || indicator.source !== "-")) { throw refuse(); }
    const from = body.lastIndexOf("\n", indicator.offset - 1) + 1;
    let to = entry.node.range![2];
    if (isScalar(entry.node) && entry.node.value === null && entry.node.range![0] === entry.node.range![1]) {
      // Empty scalars may include the next line's indentation in range[2].
      // Their own punctuation/comment line still has an exact CST boundary.
      const newline = body.indexOf("\n", indicator.offset);
      if (newline < 0 || entry.node.range![0] > newline || !/^(?:#[^\r\n]*)?\r?\n$/.test(body.slice(entry.node.range![0], newline + 1))) { throw refuse(); }
      to = newline + 1;
    }
    if (body.slice(from, indicator.offset) !== indent || from >= to || body[to - 1] !== "\n" || to > body.length
      || index > 0 && spans[index - 1].to > from) { throw refuse(); }
    if (!array && isMap(node)) {
      const key = node.items[index].key;
      if (!isScalar(key) || !key.range || /[\r\n]/.test(body.slice(key.range[0], key.range[1]))) { throw refuse(); }
    }
    spans.push({ from, to });
  });
  const last = spans.at(-1)!, newline = body.slice(last.to - 2, last.to) === "\r\n" ? "\r\n" : "\n";
  return { array, keys,
    add(index, text) { const position = index < spans.length ? spans[index].from : last.to; return { from: position, to: position, replacement: indent + (array ? "- " : "") + text + newline }; },
    remove(index) { if (!spans[index]) { throw refuse(); } return { ...spans[index], replacement: spans.length === 1 ? indent + (array ? "[]" : "{}") + newline : "" }; },
    move(index, destination) {
      const low = Math.min(index, destination), high = Math.max(index, destination);
      if (!spans[index] || !spans[destination]) { throw new Error("Choose a final position within this collection."); }
      // Standalone comments and blank-line ownership cannot be inferred from
      // resolved values. Prove every crossed CST entry, including middle entries.
      const leadingComment = (at: number): boolean => { const item = token.items[at], indicator = array ? item.start.find(part => part.type === "seq-item-ind") : item.key; return !indicator || item.start.some(part => part.type === "comment" && part.offset < indicator.offset); };
      for (let at = low; at <= high; at++) {
        if (leadingComment(at) || at < high && spans[at].to !== spans[at + 1].from || at === 0 && Boolean(node.commentBefore)) { throw new Error("Comments or blank lines between these entries have ambiguous ownership. Reorder them in Source."); }
      }
      return movedEntrySpan(spans, body, index, destination);
    }
  };
}

// Transfer authoring uses the identical collection punctuation and entry-span
// proof. Keeping this authority shared avoids a second, looser YAML grammar.
export { layoutFor as structuredPropertyCollectionLayout, collectionEntries as structuredPropertyCollectionEntries };

/** Renaming replaces exactly one ordinary mapping-key token, not its value. */
function renameSpanFor(node: Collection, key: string | number, body: string): Span {
  if (!isMap(node) || typeof key !== "string" || /[\r\n]/.test(key)) { throw refuse(); }
  const index = node.items.findIndex(pair => isScalar(pair.key) && pair.key.value === key), pair = node.items[index], token = node.srcToken;
  if (index < 0 || !pair || !isScalar(pair.key) || !pair.key.range || !pair.key.srcToken || !token || !("items" in token)
    || !["block-map", "flow-collection"].includes(token.type)) { throw refuse(); }
  const cst = pair.key.srcToken, item = token.items[index], from = pair.key.range[0], to = pair.key.range[1];
  if (!item?.key || item.key.offset !== from || cst.offset !== from || !("source" in cst) || body.slice(from, to) !== cst.source
    || !["scalar", "single-quoted-scalar", "double-quoted-scalar"].includes(cst.type) || from >= to || /[\r\n]/.test(body.slice(from, to))) { throw refuse(); }
  if (token.type === "flow-collection") { layoutFor(node, body); }
  else {
    const colon = item.sep?.find(part => part.type === "map-value-ind"), line = body.lastIndexOf("\n", from - 1) + 1;
    if (!colon || colon.source !== ":" || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 64
      || body.slice(line, from) !== " ".repeat(token.indent) || !/^[ \t]*$/.test(body.slice(to, colon.offset))) { throw refuse(); }
  }
  return { from, to };
}

function proved(source: string, name: string, value: unknown) {
  const snapshot = checkedStructuredPropertySnapshot(value), model = reviewedStructuredPropertySource(source, name);
  if (!sameValue(snapshot, model.value)) { throw new Error("The nested YAML source or path changed. Cancel this draft and review its current value."); }
  return { snapshot, model };
}

function removedReview(value: unknown): string {
  const show = (value: unknown): string => value && typeof value === "object" ? Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
    : "{" + Object.keys(value).map(key => JSON.stringify(key) + ": " + show((value as Record<string, unknown>)[key])).join(", ") + "}" : literal(value as StructuredScalar);
  return show(value);
}

export function structuredPropertyOperationTargets(source: string, name: string, value: unknown): StructuredPropertyOperationTargets {
  const add = new Set<string>(), remove = new Set<string>(), rename = new Set<string>(), up = new Set<string>(), down = new Set<string>(), moveTo = new Set<string>(), moves = new Map<string, { up: boolean; down: boolean }>(), positions = new Map<string, { position: number; length: number }>(), containers = new Map<string, { array: boolean; length: number }>(), limits = new Map<string, string>();
  try {
    const { model } = proved(source, name, value);
    const inspect = (node: unknown, path: StructuredPropertyPath): void => {
      if (!isMap(node) && !isSeq(node)) { return; }
      const entries = collectionEntries(node); containers.set(pathKey(path), { array: isSeq(node), length: entries.length });
      if (isMap(node)) { for (const entry of entries) { try { renameSpanFor(node, entry.key, model.body); rename.add(pathKey([...path, entry.key])); } catch { /* Unproven key layouts remain Source-only. */ } } }
      try {
        const layout = layoutFor(node, model.body); add.add(pathKey(path));
        entries.forEach((entry, index) => {
          const span = layout.remove(index), text = model.body.slice(span.from, span.to), preview = removedReview(entry.node.toJS(model.doc, { maxAliasCount: 0 }));
          if (text.length + preview.length + span.replacement.length <= MAX_STRUCTURED_OPERATION_REVIEW) { remove.add(pathKey([...path, entry.key])); }
          else { limits.set(pathKey([...path, entry.key]), "This entry exceeds the complete removal review limit. Remove it in Source."); }
          const movement = { up: false, down: false }, identity = pathKey([...path, entry.key]);
          positions.set(identity, { position: index + 1, length: entries.length });
          for (const direction of [-1, 1] as const) {
            if (index + direction < 0 || index + direction >= entries.length) { continue; }
            try {
              const candidate = layout.move(index, index + direction);
              if (2 * (candidate.to - candidate.from) <= MAX_STRUCTURED_OPERATION_REVIEW) { (direction === -1 ? up : down).add(identity); movement[direction === -1 ? "up" : "down"] = true; }
              else { limits.set(identity, "The complete adjacent-entry reorder exceeds the review limit. Reorder it in Source."); }
            } catch { limits.set(identity, "Comments or blank lines between these entries have ambiguous ownership. Reorder them in Source."); }
          }
          moves.set(identity, movement);
          // A safely movable non-adjacent entry must also have a proven first
          // adjacent step. Destination proof still runs on the entire final span.
          if (movement.up || movement.down) { moveTo.add(identity); }
        });
      } catch { limits.set(pathKey(path), "This layout has no proven entry spans. Use Source for unproved flow punctuation/layout, ambiguous comments or compact block collections."); }
      entries.forEach(entry => inspect(entry.node, [...path, entry.key]));
    };
    inspect(model.target, []);
  } catch { /* An unproven source has no authoring controls. */ }
  return { add, remove, rename, "move-up": up, "move-down": down, "move-to": moveTo, moves, positions, containers, limits };
}

/** A single exact source splice followed by a complete frontmatter semantic proof. */
export function planStructuredPropertyOperation(source: string, name: string, value: unknown, input: StructuredPropertyOperation): StructuredPropertyOperationPlan {
  const operation = checkedOperation(input), { snapshot, model } = proved(source, name, value);
  const path = operation.kind === "add" ? operation.path : operation.path.slice(0, -1), key = operation.kind === "add" ? operation.key : operation.path.at(-1)!;
  const owner = ownerAt(snapshot, path), node = path.length ? model.target.getIn([...path], true) : model.target;
  if (!isMap(node) && !isSeq(node) || Array.isArray(owner) !== isSeq(node)) { throw refuse(); }
  const layout = operation.kind === "rename" ? null : layoutFor(node, model.body), array = Array.isArray(owner);
  let span: Span & { replacement: string }, removed: unknown;
  if (operation.kind === "add") {
    if (array ? typeof key !== "number" || key > owner.length : typeof key !== "string" || Object.hasOwn(owner, key)) { throw new Error("Choose a new map key or a current list insertion index without replacing an existing entry."); }
    span = layout!.add(array ? key as number : layout!.keys.length, (array ? "" : literal(key as string) + ": ") + literal(operation.value));
    if (array) { owner.splice(key as number, 0, operation.value); }
    else { Object.defineProperty(owner, key, { value: operation.value, enumerable: true, configurable: true, writable: true }); }
  } else if (operation.kind === "rename") {
    if (array || typeof key !== "string" || !Object.hasOwn(owner, key) || operation.key === key
      || Object.keys(owner).some(existing => existing !== key && existing.toLowerCase() === operation.key.toLowerCase())) { throw new Error("Choose a different map key that does not duplicate another key, including its letter case."); }
    span = { ...renameSpanFor(node, key, model.body), replacement: literal(operation.key) };
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
    delete owner[key]; Object.defineProperty(owner, operation.key, descriptor);
  } else if (operation.kind === "move-up" || operation.kind === "move-down" || operation.kind === "move-to") {
    const index = layout!.keys.findIndex(candidate => candidate === key);
    if (index < 0) { throw refuse(); }
    const destination = operation.kind === "move-to" ? operation.position - 1 : index + (operation.kind === "move-up" ? -1 : 1);
    if (operation.kind !== "move-to" && (destination < 0 || destination >= layout!.keys.length)) { throw new Error("This entry is already at the beginning or end of its collection."); }
    span = layout!.move(index, destination);
    if (array) { const [moved] = owner.splice(index, 1); owner.splice(destination, 0, moved); }
  } else {
    const index = layout!.keys.findIndex(candidate => candidate === key), descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (index < 0 || !descriptor || !("value" in descriptor)) { throw refuse(); }
    removed = descriptor.value; span = layout!.remove(index);
    if (array) { owner.splice(key as number, 1); } else { delete owner[key as string]; }
  }
  checkedStructuredPropertySnapshot(snapshot);
  const from = model.offset + span.from, to = model.offset + span.to, selected = source.slice(from, to);
  const result = source.slice(0, from) + span.replacement + source.slice(to), final = reviewedStructuredPropertySource(result, name);
  const complete = model.doc.toJS({ maxAliasCount: 50 });
  Object.defineProperty(complete, name, { value: snapshot, enumerable: true, configurable: true, writable: true });
  if (!sameValue(snapshot, final.value) || !sameValue(complete, final.doc.toJS({ maxAliasCount: 50 }))) { throw refuse(); }
  const moving = operation.kind === "move-up" || operation.kind === "move-down" || operation.kind === "move-to";
  const location = JSON.stringify([name, ...path, key]), preview = operation.kind === "remove" ? removedReview(removed) : operation.kind === "add" ? literal(operation.value) : operation.kind === "rename" ? literal(operation.key) : "";
  if (selected.length + preview.length + span.replacement.length > MAX_STRUCTURED_OPERATION_REVIEW) { throw new Error("This entry or crossed range is too large for a complete source review. Edit it in Source."); }
  const review = moving ? `Move ${location} ${operation.kind === "move-to" ? "to final position " + operation.position + " of " + layout!.keys.length + " (positions start at 1)" : (operation.kind === "move-up" ? "up" : "down") + " by one entry"}\nExact ${operation.kind === "move-to" ? "crossed" : "adjacent"} entries before:\n${selected}\nAfter reordering:\n${span.replacement}\nEntry text, inline comments and descendants travel unchanged. Other source stays unchanged.`
    : operation.kind === "remove" ? `Remove ${location}\nCurrent value: ${preview}\nExact source removed (including its inline comments):\n${selected}\nReplacement:\n${span.replacement || "(empty)"}`
    : operation.kind === "rename" ? `Rename key ${location}\nNew key: ${preview}\nExact key source: ${selected}\nReplacement key: ${span.replacement}\nThe value, descendants, comments and position stay byte-for-byte unchanged.`
      : `Add ${location}\nNew value: ${preview}\nLiteral YAML insertion:\n${span.replacement}`;
  return { source: result, next: snapshot, review, operation };
}

/** Verify the ordinary queue's complete candidate, but keep only the proven splice. */
export function preserveStructuredPropertyOperationSource(updated: string, original: string, name: string, operation: StructuredPropertyOperation): string {
  const before = reviewedStructuredPropertySource(original, name), plan = planStructuredPropertyOperation(original, name, before.value, operation);
  const candidate = reviewedStructuredPropertySource(updated, name), final = reviewedStructuredPropertySource(plan.source, name);
  if (!sameValue(candidate.value, plan.next) || !sameValue(candidate.doc.toJS({ maxAliasCount: 50 }), final.doc.toJS({ maxAliasCount: 50 }))) { throw refuse(); }
  return plan.source;
}

export function createStructuredPropertyOperationEditor(document: Document, options: {
  kind: "add" | "remove" | "rename" | StructuredPropertyMove; path: StructuredPropertyPath; container?: { array: boolean; length: number }; position?: { position: number; length: number }; label: string;
  plan: (operation: StructuredPropertyOperation) => StructuredPropertyOperationPlan; current: () => boolean;
  apply: (plan: StructuredPropertyOperationPlan) => Promise<boolean>; error: (message: string) => void; closed: () => void;
}): StructuredScalarEditor {
  if (options.kind === "add") {
    const element = document.createElement("div"), label = document.createElement("label"), key = document.createElement("input");
    if (!options.container) { throw refuse(); }
    const array = options.container.array; key.type = "text"; key.className = "metadata-input"; key.maxLength = array ? 4 : 256; key.inputMode = array ? "numeric" : "text";
    key.dataset.propertyStructuredPosition = ""; key.dataset.metadataInput = ""; key.setAttribute("aria-label", array ? "Insertion index for " + options.label : "New key for " + options.label);
    key.value = array ? String(options.container.length) : ""; label.textContent = array ? `Insert at index (0–${options.container.length}; ${options.container.length} appends) ` : "New map key "; label.append(key);
    const plan = (value: StructuredPropertyAddition): StructuredPropertyOperationPlan => {
      if (array && !/^(?:0|[1-9]\d*)$/.test(key.value)) { throw new Error("Choose a whole insertion index within the current list."); }
      return options.plan({ kind: "add", path: options.path, key: array ? Number(key.value) : key.value, value });
    };
    let composingKey = false;
    const editor = createStructuredScalarEditor(document, { value: "", label: options.label, current: () => !composingKey && options.current() && key.isConnected && (key.checkVisibility?.() ?? true),
      alwaysApply: true, applyLabel: "Apply addition", review: value => plan(value).review,
      apply: async value => { key.disabled = true; try { return await options.apply(plan(value)); } finally { key.disabled = false; } },
      emptyCollections: { review: kind => plan(kind === "map" ? {} : []).review, apply: async kind => { key.disabled = true; try { return await options.apply(plan(kind === "map" ? {} : [])); } finally { key.disabled = false; } } },
      error: options.error, closed: options.closed });
    element.className = "metadata-structured-operation-editor"; element.dataset.propertyStructuredOperation = "add"; element.append(label, editor.element);
    const owns = (): boolean => editor.active && key.isConnected && element.contains(key);
    key.addEventListener("compositionstart", () => { if (owns()) { composingKey = true; } }); key.addEventListener("compositionend", () => { if (owns()) { composingKey = false; editor.refreshReview(); } });
    key.addEventListener("input", () => { if (owns()) { editor.refreshReview(); } }); key.addEventListener("change", () => { if (owns()) { editor.refreshReview(); } });
    key.addEventListener("keydown", event => { if (owns() && !key.disabled && !composingKey && !event.isComposing && event.keyCode !== 229 && event.key === "Escape") { event.preventDefault(); options.error(""); editor.dispose(); element.remove(); options.closed(); } });
    return { element, input: key, get active() { return editor.active; }, refreshReview: editor.refreshReview, dispose() { editor.dispose(); element.remove(); } };
  }
  if (options.kind === "rename") {
    const element = document.createElement("div"), label = document.createElement("label"), key = document.createElement("input"), review = document.createElement("textarea");
    const apply = document.createElement("button"), cancel = document.createElement("button"), actions = document.createElement("div"), help = document.createElement("p");
    element.className = "metadata-structured-editor metadata-structured-operation-editor"; element.dataset.propertyStructuredOperation = "rename";
    key.type = "text"; key.className = "metadata-input"; key.maxLength = 256; key.value = String(options.path.at(-1)); key.dataset.propertyStructuredRenameInput = ""; key.dataset.metadataInput = "";
    key.setAttribute("aria-label", "New map key for " + options.label); label.textContent = "New map key "; label.append(key);
    review.readOnly = true; review.rows = 6; review.className = "metadata-input metadata-structured-removal-review"; review.dataset.propertyStructuredRenameReview = ""; review.setAttribute("aria-label", "Review key rename for " + options.label);
    apply.type = cancel.type = "button"; apply.textContent = "Apply rename"; cancel.textContent = "Cancel"; apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = "";
    actions.className = "metadata-structured-actions"; actions.append(apply, cancel); help.className = "metadata-multiline-help";
    help.textContent = "The key stays a draft until Apply. The value, comments and position stay unchanged. Ctrl/⌘+Enter applies; Escape cancels. Assigned property types are unchanged.";
    element.append(label, review, actions, help);
    let closed = false, busy = false, composing = false;
    const plan = (): StructuredPropertyOperationPlan => options.plan({ kind: "rename", path: options.path, key: key.value });
    const preview = (): void => { if (closed) { return; } try { review.value = plan().review; } catch (issue) { review.value = issue instanceof Error ? issue.message : String(issue); } };
    const close = (): void => { if (closed) { return; } closed = true; element.remove(); options.closed(); };
    const owns = (): boolean => !closed && key.isConnected && element.contains(key);
    const save = async (): Promise<void> => {
      if (closed || busy || composing) { return; }
      if (!owns() || !options.current() || !(element.checkVisibility?.() ?? true)) { options.error("The note or nested property owner changed. Cancel this rename and review the current source."); return; }
      try {
        const candidate = plan(); busy = true; key.disabled = apply.disabled = cancel.disabled = true;
        if (await options.apply(candidate)) { if (closed) { options.closed(); } else { close(); } }
      } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
      finally { busy = false; key.disabled = apply.disabled = cancel.disabled = false; }
    };
    key.addEventListener("compositionstart", () => { if (owns()) { composing = true; } }); key.addEventListener("compositionend", () => { if (owns()) { composing = false; preview(); } });
    key.addEventListener("input", () => { if (owns() && !busy) { preview(); } }); key.addEventListener("change", () => { if (owns() && !busy) { preview(); } });
    for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
    apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
    element.addEventListener("keydown", event => { if (closed || busy || composing || event.isComposing || event.keyCode === 229 || ["Process", "Unidentified"].includes(event.key)) { return; } if (event.key === "Escape") { event.preventDefault(); options.error(""); close(); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
    preview(); return { element, input: key, get active() { return !closed; }, refreshReview: preview, dispose() { closed = true; element.remove(); } };
  }
  if (options.kind === "move-to") {
    const position = options.position;
    if (!position || !Number.isSafeInteger(position.position) || !Number.isSafeInteger(position.length) || position.position < 1 || position.position > position.length || position.length < 2) { throw refuse(); }
    const element = document.createElement("div"), label = document.createElement("label"), input = document.createElement("input"), review = document.createElement("textarea");
    const apply = document.createElement("button"), cancel = document.createElement("button"), first = document.createElement("button"), last = document.createElement("button"), actions = document.createElement("div"), shortcuts = document.createElement("div"), help = document.createElement("p");
    element.className = "metadata-structured-editor metadata-structured-operation-editor metadata-structured-position-editor"; element.dataset.propertyStructuredOperation = "move-to";
    input.type = "text"; input.inputMode = "numeric"; input.maxLength = String(position.length).length; input.className = "metadata-input"; input.value = String(position.position);
    input.dataset.propertyStructuredMovePosition = ""; input.dataset.metadataInput = ""; input.setAttribute("aria-label", "Final position for " + options.label);
    label.textContent = `Final position (1–${position.length}; currently ${position.position}) `; label.append(input);
    review.readOnly = true; review.rows = 8; review.className = "metadata-input metadata-structured-removal-review"; review.dataset.propertyStructuredReorderReview = ""; review.setAttribute("aria-label", "Review moving " + options.label + " to a final position");
    for (const button of [apply, cancel, first, last]) { button.type = "button"; button.addEventListener("mousedown", event => event.preventDefault()); }
    apply.textContent = "Apply reorder"; cancel.textContent = "Cancel"; first.textContent = "First"; last.textContent = "Last";
    apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = ""; first.dataset.propertyStructuredMoveFirst = ""; last.dataset.propertyStructuredMoveLast = "";
    shortcuts.className = actions.className = "metadata-structured-actions"; shortcuts.append(first, last); actions.append(apply, cancel);
    help.className = "metadata-multiline-help"; help.textContent = "Positions start at 1 and describe the final order. Review every crossed entry before Apply. The selected entry and its descendants keep their exact source; ambiguous comment ownership stays in Source. One Undo restores the previous order. Ctrl/⌘+Enter applies; Escape cancels.";
    element.append(label, shortcuts, review, actions, help);
    let closed = false, busy = false, composing = false, reviewed: StructuredPropertyOperationPlan | null = null;
    const plan = (): StructuredPropertyOperationPlan => {
      if (!/^[1-9]\d*$/.test(input.value)) { throw new Error("Choose a whole final position within this collection, starting at 1."); }
      return options.plan({ kind: "move-to", path: options.path, position: Number(input.value) });
    };
    const preview = (): void => {
      if (closed || busy) { return; }
      try { const candidate = plan(); review.value = candidate.review; reviewed = candidate; apply.disabled = composing; }
      catch (issue) { reviewed = null; review.value = issue instanceof Error ? issue.message : String(issue); apply.disabled = true; }
      first.disabled = position.position === 1; last.disabled = position.position === position.length;
    };
    const owns = (): boolean => !closed && input.isConnected && element.contains(input);
    const close = (): void => { if (closed) { return; } closed = true; reviewed = null; element.remove(); options.closed(); };
    const save = async (): Promise<void> => {
      if (closed || busy || composing) { return; }
      if (!owns() || !options.current() || !(element.checkVisibility?.() ?? true)) { options.error("The note or nested property owner changed. Cancel this reorder and review the current source."); return; }
      try {
        const candidate = plan();
        // HTML textareas expose LF line endings even when assigned exact CRLF
        // source. Keep the raw reviewed plan as the authoring authority; only
        // the visible comparison follows the textarea's normal line endings.
        if (!reviewed || reviewed.operation.kind !== "move-to" || candidate.operation.kind !== "move-to"
          || reviewed.operation.position !== candidate.operation.position || reviewed.source !== candidate.source || reviewed.review !== candidate.review
          || review.value !== multilineText(candidate.review)) { preview(); throw new Error("The final position changed. Review the current before/after source before applying it."); }
        busy = true; for (const control of [input, apply, cancel, first, last]) { control.disabled = true; }
        if (await options.apply(candidate)) { if (closed) { options.closed(); } else { close(); } }
      } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
      finally { busy = false; for (const control of [input, cancel]) { control.disabled = false; } preview(); }
    };
    input.addEventListener("compositionstart", () => { if (owns() && !busy) { composing = true; apply.disabled = true; } });
    input.addEventListener("compositionend", () => { if (owns() && !busy) { composing = false; preview(); } });
    for (const event of ["input", "change"]) { input.addEventListener(event, () => { if (owns() && !busy) { preview(); } }); }
    for (const [button, value] of [[first, 1], [last, position.length]] as const) { button.addEventListener("click", () => { if (owns() && !busy && !composing && options.current()) { input.value = String(value); preview(); input.focus(); } }); }
    apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
    element.addEventListener("keydown", event => { if (closed || busy || composing || event.isComposing || event.keyCode === 229 || ["Process", "Unidentified"].includes(event.key)) { return; } if (event.key === "Escape") { event.preventDefault(); options.error(""); close(); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
    preview(); return { element, input, get active() { return !closed; }, refreshReview: preview, dispose() { closed = true; reviewed = null; element.remove(); } };
  }
  const moving = options.kind === "move-up" || options.kind === "move-down", plan = options.plan({ kind: options.kind, path: options.path }), element = document.createElement("div"), review = document.createElement("textarea"), apply = document.createElement("button"), cancel = document.createElement("button"), actions = document.createElement("div");
  element.className = "metadata-structured-editor"; element.dataset.propertyStructuredOperation = options.kind; review.readOnly = true; review.rows = 8; review.value = plan.review;
  review.className = "metadata-input metadata-structured-removal-review"; review.dataset[moving ? "propertyStructuredReorderReview" : "propertyStructuredRemovalReview"] = ""; review.setAttribute("aria-label", (moving ? "Review reordering of " : "Review removal of ") + options.label);
  apply.type = cancel.type = "button"; apply.textContent = moving ? "Apply reorder" : "Apply removal"; cancel.textContent = "Cancel"; apply.dataset.propertyStructuredApply = ""; cancel.dataset.propertyStructuredCancel = "";
  actions.className = "metadata-structured-actions"; actions.append(apply, cancel); element.append(review, actions);
  let closed = false, busy = false;
  const close = (): void => { if (closed) { return; } closed = true; element.remove(); options.closed(); };
  const save = async (): Promise<void> => {
    if (closed || busy) { return; }
    if (!element.isConnected || !options.current() || !(element.checkVisibility?.() ?? true)) { options.error("The note or nested property owner changed. Cancel this " + (moving ? "reorder" : "removal") + " and review the current source."); return; }
    busy = true; apply.disabled = cancel.disabled = true;
    try { if (await options.apply(plan)) { if (closed) { options.closed(); } else { close(); } } } catch (issue) { options.error(issue instanceof Error ? issue.message : String(issue)); }
    finally { busy = false; apply.disabled = cancel.disabled = false; }
  };
  for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
  apply.addEventListener("click", () => { void save(); }); cancel.addEventListener("click", () => { if (!closed && !busy) { options.error(""); close(); } });
  element.addEventListener("keydown", event => { if (closed || busy || event.isComposing || event.keyCode === 229) { return; } if (event.key === "Escape") { event.preventDefault(); options.error(""); close(); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
  return { element, input: review, get active() { return !closed; }, refreshReview() {}, dispose() { closed = true; element.remove(); } };
}
