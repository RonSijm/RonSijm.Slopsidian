import { printHotkey, type HotkeyManager } from "./hotkeys";

export type PickerKind = "commands" | "files" | "pane";
export type PickerMatchRange = readonly [from: number, to: number];

/** Display ranges follow the existing picker matcher; they never influence its score. */
export function pickerMatchRanges(text: string, query: string): PickerMatchRange[] {
  const value = text.toLocaleLowerCase();
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matched: PickerMatchRange[] = [];
  for (const word of words) {
    const contiguous = value.indexOf(word);
    if (contiguous >= 0) { matched.push([contiguous, contiguous + word.length]); continue; }
    let position = 0;
    for (const character of word) {
      const next = value.indexOf(character, position);
      if (next < 0) { return []; }
      matched.push([next, next + character.length]);
      position = next + 1;
    }
  }
  if (!matched.length) { return []; }

  // Lowercasing can expand a character (for example İ). Keep ranges on the
  // original complete code points, rather than slicing a folded string into UI.
  const source: PickerMatchRange[] = [];
  let offset = 0;
  for (const character of text) {
    const range = [offset, offset + character.length] as const;
    for (let at = 0; at < character.toLocaleLowerCase().length; at++) { source.push(range); }
    offset += character.length;
  }
  if (source.length !== value.length) { return []; }
  const ranges = matched.map(([from, to]) => [source[from][0], source[to - 1][1]] as [number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [];
  for (const [from, to] of ranges) {
    const previous = merged.at(-1);
    if (previous && from <= previous[1]) { previous[1] = Math.max(previous[1], to); }
    else { merged.push([from, to]); }
  }
  return merged;
}

/** All names, paths and matches remain literal text, including HTML-like names. */
export function appendPickerText(container: HTMLElement, text: string, ranges: readonly PickerMatchRange[], sourceOffset = 0): void {
  const doc = container.ownerDocument;
  let offset = 0;
  for (const [start, end] of ranges) {
    const from = Math.max(0, start - sourceOffset), to = Math.min(text.length, end - sourceOffset);
    if (to <= from || from < offset) { continue; }
    container.appendChild(doc.createTextNode(text.slice(offset, from)));
    const highlight = doc.createElement("span");
    highlight.className = "suggestion-highlight";
    highlight.textContent = text.slice(from, to);
    container.appendChild(highlight);
    offset = to;
  }
  container.appendChild(doc.createTextNode(text.slice(offset)));
}

export function pickerShortcutLabels(manager: Pick<HotkeyManager, "getActiveHotkeys">, id: string): string[] {
  return [...new Set(manager.getActiveHotkeys(id).map(printHotkey))];
}

export function renderPickerInstructions(container: HTMLElement, kind: PickerKind): void {
  const instructions = [
    ["↑ ↓", "to navigate"],
    ["Enter", kind === "commands" ? "to run command" : kind === "pane" ? "to run action" : "to open"],
    ...(kind === "files" ? [["Ctrl+Enter", "to open in a new tab"], ["Shift+Enter", "to create a note"]] : []),
    ["Esc", "to close"],
  ];
  const doc = container.ownerDocument;
  container.replaceChildren();
  for (const [command, purpose] of instructions) {
    const instruction = doc.createElement("span"), key = doc.createElement("span");
    instruction.className = "prompt-instruction";
    key.className = "prompt-instruction-command";
    key.textContent = command;
    instruction.append(key, doc.createTextNode(" " + purpose));
    container.appendChild(instruction);
  }
}
