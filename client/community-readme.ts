export type ReadmeInline = { text: string; code?: boolean; href?: string };
export type ReadmeBlock =
  | { kind: "heading"; level: number; inline: ReadmeInline[] }
  | { kind: "paragraph" | "quote"; inline: ReadmeInline[] }
  | { kind: "list"; ordered: boolean; items: ReadmeInline[][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

export interface ParsedReadme { blocks: ReadmeBlock[]; truncated: boolean; }

const MAX_BLOCKS = 600, MAX_ITEMS = 200, MAX_CODE = 8000, MAX_INLINE = 4000;

/** Only absolute web links are ever navigable; everything else (including images) is shown as inert text. */
export function safeReadmeHref(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function inline(raw: string, cut: () => void): ReadmeInline[] {
  const whole = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[A-Za-z][^>]*>/g, "");
  if (whole.length > MAX_INLINE) { cut(); }
  const stripped = whole.slice(0, MAX_INLINE);
  const result: ReadmeInline[] = [];
  const pattern = /`([^`]+)`|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let last = 0, match: RegExpExecArray | null;
  const plain = (text: string): void => { const clean = text.replace(/[*_~]{1,3}(?=\S)|(?<=\S)[*_~]{1,3}/g, ""); if (clean) { result.push({ text: clean }); } };
  while ((match = pattern.exec(stripped))) {
    plain(stripped.slice(last, match.index));
    if (match[1] !== undefined) { result.push({ text: match[1], code: true }); }
    else if (match[2] !== undefined) { plain(match[2] ? "[image: " + match[2] + "]" : "[image]"); }
    else {
      const href = safeReadmeHref(match[4]);
      if (href) { result.push({ text: match[3], href }); } else { plain(match[3]); }
    }
    last = pattern.lastIndex;
  }
  plain(stripped.slice(last));
  return result;
}

/** Parses a deliberately small Markdown subset into inert data; HTML is stripped and nothing is fetched or executed. */
export function parseReadme(source: string): ParsedReadme {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReadmeBlock[] = [];
  let truncated = false, paragraph: string[] = [];
  const inlineOf = (raw: string): ReadmeInline[] => inline(raw, () => { truncated = true; });
  const push = (block: ReadmeBlock): void => { if (blocks.length >= MAX_BLOCKS) { truncated = true; } else { blocks.push(block); } };
  const flush = (): void => { if (paragraph.length) { push({ kind: "paragraph", inline: inlineOf(paragraph.join(" ")) }); paragraph = []; } };
  for (let index = 0; index < lines.length && !truncated; index++) {
    const line = lines[index];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (index++; index < lines.length && !lines[index].trimStart().startsWith(fence[1]); index++) { code.push(lines[index]); }
      const text = code.join("\n");
      if (text.length > MAX_CODE) { truncated = true; }
      push({ kind: "code", text: text.slice(0, MAX_CODE) });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); push({ kind: "heading", level: heading[1].length, inline: inlineOf(heading[2]) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); push({ kind: "rule" }); continue; }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flush(); push({ kind: "quote", inline: inlineOf(quote[1]) }); continue; }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined, items: ReadmeInline[][] = [inlineOf(item[3])];
      while (index + 1 < lines.length && items.length < MAX_ITEMS) {
        const next = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[index + 1]);
        if (!next || (next[2] !== undefined) !== ordered) { break; }
        items.push(inlineOf(next[3]));
        index++;
      }
      push({ kind: "list", ordered, items });
      continue;
    }
    if (!line.trim()) { flush(); } else { paragraph.push(line.trim()); }
  }
  flush();
  return { blocks, truncated };
}

function appendInline(parent: HTMLElement, parts: readonly ReadmeInline[]): void {
  for (const part of parts) {
    if (part.href) {
      const link = document.createElement("a");
      link.textContent = part.text;
      link.href = part.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow ugc";
      link.referrerPolicy = "no-referrer";
      parent.appendChild(link);
    } else if (part.code) {
      const code = document.createElement("code");
      code.textContent = part.text;
      parent.appendChild(code);
    } else { parent.append(document.createTextNode(part.text)); }
  }
}

export function renderReadme(parent: HTMLElement, readme: ParsedReadme): void {
  for (const block of readme.blocks) {
    let element: HTMLElement;
    switch (block.kind) {
      case "heading": element = document.createElement("h" + Math.min(6, block.level + 3)); appendInline(element, block.inline); break;
      case "paragraph": element = document.createElement("p"); appendInline(element, block.inline); break;
      case "quote": element = document.createElement("blockquote"); appendInline(element, block.inline); break;
      case "code": { element = document.createElement("pre"); const code = document.createElement("code"); code.textContent = block.text; element.appendChild(code); break; }
      case "rule": element = document.createElement("hr"); break;
      case "list":
        element = document.createElement(block.ordered ? "ol" : "ul");
        for (const parts of block.items) { const item = document.createElement("li"); appendInline(item, parts); element.appendChild(item); }
        break;
    }
    parent.appendChild(element);
  }
  if (readme.truncated) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "The README is long; only its beginning is shown. Use the repository link for the rest.";
    parent.appendChild(note);
  }
}
