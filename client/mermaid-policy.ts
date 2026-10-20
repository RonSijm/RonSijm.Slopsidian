import { parseDocument } from "yaml";

export const MAX_MERMAID_CHARS = 32_768;
export const MAX_MERMAID_BLOCKS = 32;
export const MAX_MERMAID_SVG_CHARS = 4 * 1024 * 1024;
export interface MermaidOptions {
  theme?: "default" | "dark" | "neutral" | "forest" | "base";
  look?: "classic" | "handDrawn" | "neo";
  layout?: "dagre" | "elk";
}
export interface MermaidDefinition { text: string; title?: string; options: MermaidOptions }

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error(`${label} must be an object.`); }
  return value as Record<string, unknown>;
}
function yaml(source: string): unknown {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) { throw new Error("Invalid Mermaid configuration: " + doc.errors[0].message); }
  return doc.toJS({ maxAliasCount: 10 });
}
function options(value: unknown): MermaidOptions {
  const data = object(value, "Mermaid configuration"), result: MermaidOptions = {};
  const allowed = { theme: ["default", "dark", "neutral", "forest", "base"], look: ["classic", "handDrawn", "neo"], layout: ["dagre", "elk"] };
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(allowed, key)) { throw new Error(`Mermaid option '${key}' is not supported. Use theme, look or layout; custom scripts, HTML and renderer settings are disabled.`); }
    if (typeof value !== "string" || !allowed[key as keyof typeof allowed].includes(value)) { throw new Error(`Invalid Mermaid ${key} option.`); }
    Object.assign(result, { [key]: value });
  }
  return result;
}

/** Extracts only supported display options; raw configuration never reaches Mermaid. */
export function prepareMermaid(source: string): MermaidDefinition {
  if (typeof source !== "string" || !source.trim()) { throw new Error("The Mermaid block is empty."); }
  if (source.length > MAX_MERMAID_CHARS) { throw new Error("Mermaid diagrams are limited to 32,768 characters per block."); }
  if (source.includes("\0")) { throw new Error("A Mermaid block cannot contain null characters."); }
  let text = source.replace(/^\ufeff/, "").replace(/\r\n|\r/g, "\n"), title: string | undefined;
  let config: MermaidOptions = {};
  if (/^\s*---[ \t]*\n/.test(text)) {
    const opening = /^\s*---[ \t]*\n/.exec(text)!;
    const closing = /^---[ \t]*(?:\n|$)/gm; closing.lastIndex = opening[0].length;
    const end = closing.exec(text);
    if (!end) { throw new Error("Mermaid frontmatter has no closing --- delimiter."); }
    const data = object(yaml(text.slice(opening[0].length, end.index)), "Mermaid frontmatter");
    for (const key of Object.keys(data)) { if (!["title", "config"].includes(key)) { throw new Error(`Mermaid frontmatter field '${key}' is not supported.`); } }
    if (data.title !== undefined) {
      if (typeof data.title !== "string" || data.title.length > 300) { throw new Error("Mermaid title must be text up to 300 characters."); }
      title = data.title;
    }
    if (data.config !== undefined) { config = options(data.config); }
    text = text.slice(end.index + end[0].length);
  }
  let directives = 0;
  text = text.replace(/%%\s*\{([\s\S]*?)\}\s*%%/g, (_match, body: string) => {
    if (++directives > 4) { throw new Error("Use at most four Mermaid initialization directives."); }
    const directive = object(yaml("{" + body + "}"), "Mermaid directive");
    const keys = Object.keys(directive);
    if (keys.length !== 1 || !["init", "initialize"].includes(keys[0])) { throw new Error("Only Mermaid init/initialize display directives are supported."); }
    config = { ...config, ...options(directive[keys[0]]) };
    return "";
  });
  if (/%%\s*\{/.test(text)) { throw new Error("The Mermaid initialization directive is not closed."); }
  if (!text.trim()) { throw new Error("The Mermaid block has no diagram definition."); }
  return { text, title, options: config };
}
