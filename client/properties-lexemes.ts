import { isMap, isScalar, parseDocument } from "yaml";
import { getFrontMatterInfo } from "./markdown";

export function numericLexemes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const info = getFrontMatterInfo(body);
  if (!info.exists) { return result; }
  const doc = parseDocument(info.frontmatter, { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) { return result; }
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && typeof pair.key.value === "string" && isScalar(pair.value) && typeof pair.value.value === "number" && pair.value.source !== undefined) {
      result.set(pair.key.value, pair.value.source);
    }
  }
  return result;
}

export function numberText(value: number, source: string | undefined): string {
  if (source === undefined) { return String(value); }
  const literal = source.trim();
  const parsed = parseDocument(literal);
  const node = parsed.contents;
  return !parsed.errors.length && isScalar(node) && typeof node.value === "number" && Object.is(node.value, value) ? literal : String(value);
}

export function composingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
