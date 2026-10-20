import { localFontName } from "./font-family";

export const APPEARANCE_CSS_BYTES = 1024 * 1024;
export type AppearanceMode = "obsidian" | "moonstone" | "system";
export interface AppearanceOptions {
  theme: AppearanceMode;
  cssTheme: string;
  enabledCssSnippets: string[];
  interfaceFontFamily: string;
  textFontFamily: string;
  monospaceFontFamily: string;
  baseFontSize: number;
  allowLocalResources: boolean;
}
export class AppearanceError extends Error {}

export function appearanceFontList(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) { throw new AppearanceError("Appearance fonts must be a comma-separated list of at most eight local family names."); }
  if (!value.replace(/ /g, "")) { return ""; }
  const names = value.split(",");
  if (names.length > 8) { throw new AppearanceError("Appearance fonts support at most eight local family names."); }
  try { return names.map(name => localFontName(name, "local Appearance font family")).join(", "); }
  catch (error) { if (error instanceof RangeError) { throw new AppearanceError(error.message); } throw error; }
}

export function appearanceFontCss(value: unknown): string {
  const names = appearanceFontList(value);
  const generic = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"]);
  return names ? names.split(", ").map(name => generic.has(name.toLowerCase()) ? name.toLowerCase() : JSON.stringify(name)).join(",") : "";
}

export function appearanceName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || value.startsWith(".") || /[. ]$|[\\/<>:"|?*\x00-\x1f\x7f]/.test(value) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(value)) {
    throw new AppearanceError("Use a theme or snippet name without hidden, reserved, traversal or invalid path characters.");
  }
  return value;
}

export function appearanceOptions(data: Record<string, unknown>): AppearanceOptions {
  const theme = data.theme === undefined ? "obsidian" : data.theme;
  if (theme !== "obsidian" && theme !== "moonstone" && theme !== "system") { throw new AppearanceError("Choose dark, light or system appearance."); }
  const cssTheme = data.cssTheme === undefined ? "" : data.cssTheme;
  if (typeof cssTheme !== "string") { throw new AppearanceError("The installed theme name must be text."); }
  if (cssTheme !== "") { appearanceName(cssTheme); }
  const snippets = data.enabledCssSnippets === undefined ? [] : data.enabledCssSnippets;
  if (!Array.isArray(snippets) || snippets.length > 128) { throw new AppearanceError("Enabled CSS snippets must be a list of at most 128 names."); }
  const interfaceFontFamily = appearanceFontList(data.interfaceFontFamily === undefined ? "" : data.interfaceFontFamily);
  const textFontFamily = appearanceFontList(data.textFontFamily === undefined ? "" : data.textFontFamily);
  const monospaceFontFamily = appearanceFontList(data.monospaceFontFamily === undefined ? "" : data.monospaceFontFamily);
  const baseFontSize = data.baseFontSize === undefined ? 16 : data.baseFontSize;
  if (typeof baseFontSize !== "number" || !Number.isInteger(baseFontSize) || baseFontSize < 12 || baseFontSize > 32) { throw new AppearanceError("Choose a note text size from 12 to 32 whole pixels."); }
  const allowLocalResources = data.allowLocalResources === undefined ? false : data.allowLocalResources;
  if (typeof allowLocalResources !== "boolean") { throw new AppearanceError("Trusted local resources must be on or off."); }
  return { theme, cssTheme, enabledCssSnippets: [...new Set(snippets.map(appearanceName))], interfaceFontFamily, textFontFamily, monospaceFontFamily, baseFontSize, allowLocalResources };
}

export function appearanceCssPath(value: unknown): string {
  if (typeof value !== "string") { throw new AppearanceError("An installed theme or snippet CSS path is required."); }
  const theme = /^\.obsidian\/themes\/([^/]+)\/theme\.css$/.exec(value);
  const snippet = /^\.obsidian\/snippets\/([^/]+)\.[cC][sS][sS]$/.exec(value);
  if (!theme && !snippet) { throw new AppearanceError("Only installed theme.css and top-level CSS snippet files can be loaded."); }
  appearanceName((theme ?? snippet)![1]);
  return value;
}

/** Installed theme.css or manifest.json (the latter only for reviewed-install version checks). */
export function appearanceThemeFilePath(value: unknown): string {
  const manifest = typeof value === "string" ? /^\.obsidian\/themes\/([^/]+)\/manifest\.json$/.exec(value) : null;
  if (!manifest) { return appearanceCssPath(value); }
  appearanceName(manifest[1]);
  return value as string;
}

function cssEscape(text: string, index: number, inString = false): { value: string; next: number } {
  if (/[\n\r\f]/.test(text[index + 1] ?? "")) {
    if (!inString) { throw new AppearanceError("CSS identifiers must not contain escaped newlines."); }
    return { value: "", next: index + (text[index + 1] === "\r" && text[index + 2] === "\n" ? 3 : 2) };
  }
  const hexadecimal = /^[0-9a-f]{1,6}/i.exec(text.slice(index + 1, index + 7));
  if (hexadecimal) {
    const code = Number.parseInt(hexadecimal[0], 16);
    let next = index + 1 + hexadecimal[0].length;
    if (/[\t\n\r\f ]/.test(text[next] ?? "")) { next += text[next] === "\r" && text[next + 1] === "\n" ? 2 : 1; }
    return { value: !code || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff ? "\ufffd" : String.fromCodePoint(code), next };
  }
  if (index + 1 >= text.length) { throw new AppearanceError("The CSS ends with an incomplete escape."); }
  return { value: text[index + 1], next: index + 2 };
}

export interface AppearanceUrl { start: number; end: number; value: string }

// Parses the url( token at the opening parenthesis; escapes, whitespace inside the value and bad-url forms are refused.
function cssUrl(text: string, open: number): { value: string; end: number } {
  let index = open + 1;
  while (/[\t\n\r\f ]/.test(text[index] ?? "")) { index++; }
  let value = "";
  const quote = text[index];
  if (quote === '"' || quote === "'") {
    index++;
    while (index < text.length && text[index] !== quote) {
      if (text[index] === "\\" || /[\n\r\f]/.test(text[index])) { throw new AppearanceError("Appearance resource URLs must not contain escapes or newlines."); }
      value += text[index++];
    }
    if (index === text.length) { throw new AppearanceError("The CSS contains an unterminated resource URL."); }
    index++;
  } else {
    while (index < text.length && text[index] !== ")" && !/[\t\n\r\f ]/.test(text[index])) {
      if (/["'(\\\x00-\x1f\x7f]/.test(text[index])) { throw new AppearanceError("Appearance resource URLs contain an unsafe unquoted character."); }
      value += text[index++];
    }
  }
  while (/[\t\n\r\f ]/.test(text[index] ?? "")) { index++; }
  if (text[index] !== ")") { throw new AppearanceError("The CSS contains a malformed resource URL."); }
  return { value, end: index + 1 };
}

export function validateAppearanceCss(text: string, urls?: AppearanceUrl[]): void {
  if (new TextEncoder().encode(text).length > APPEARANCE_CSS_BYTES) { throw new AppearanceError("Each appearance stylesheet must be at most 1 MiB."); }
  if (text.includes("\0")) { throw new AppearanceError("Appearance CSS must not contain null characters."); }
  const identifier = (character: string): boolean => /[a-z0-9_-]/i.test(character) || character.charCodeAt(0) >= 128;
  for (let index = 0; index < text.length;) {
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) { throw new AppearanceError("The CSS contains an unterminated comment."); }
      index = end + 2;
    } else if (text[index] === '"' || text[index] === "'") {
      const quote = text[index++];
      while (index < text.length && text[index] !== quote) {
        if (/[\n\r\f]/.test(text[index])) { throw new AppearanceError("CSS strings must not contain unescaped newlines."); }
        index = text[index] === "\\" ? cssEscape(text, index, true).next : index + 1;
      }
      if (index === text.length) { throw new AppearanceError("The CSS contains an unterminated string."); }
      index++;
    } else if (text[index] === "@" || text[index] === "\\" || identifier(text[index])) {
      const atRule = text[index] === "@", nameStart = index;
      if (atRule) { index++; }
      let name = "";
      while (index < text.length && (text[index] === "\\" || identifier(text[index]))) {
        if (text[index] === "\\") { const escaped = cssEscape(text, index); name += escaped.value; index = escaped.next; }
        else { name += text[index++]; }
      }
      const normalized = name.toLowerCase();
      if (urls && !atRule && text[index] === "(" && normalized === "url") {
        const token = cssUrl(text, index);
        urls.push({ start: nameStart, end: token.end, value: token.value });
        index = token.end;
        continue;
      }
      if (atRule && normalized === "import" || !atRule && text[index] === "(" && ["url", "image-set", "-webkit-image-set", "image", "src"].includes(normalized)) {
        throw new AppearanceError(urls ? "Imports, image-set(), src() and image() are not supported, even with local resources enabled." : "Only self-contained appearance CSS is supported. Imports and URL/image resources are not loaded. Enable trusted local resources to use theme-relative fonts and images.");
      }
    } else { index++; }
  }
}
