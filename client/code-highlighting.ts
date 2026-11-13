import type { Parser } from "@lezer/common";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { c, cpp, csharp, dart, java, kotlin, objectiveC, scala } from "@codemirror/legacy-modes/mode/clike";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { go } from "@codemirror/legacy-modes/mode/go";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { python } from "@codemirror/legacy-modes/mode/python";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";

export const MAX_CODE_HIGHLIGHT_CHARACTERS = 65_536;
export const MAX_CODE_HIGHLIGHT_VIEW_CHARACTERS = 262_144;
export const MAX_CODE_HIGHLIGHT_BLOCKS = 64;
export const MAX_CODE_HIGHLIGHT_SPANS = 16_384;
const MAX_PARSE_STEPS = 4_096;
const PARSE_TIME_MS = 30;

interface CodeLanguage { name: string; parser: Parser }
const languages = new Map<string, CodeLanguage>();
function register(name: string, parser: Parser, aliases: readonly string[]): void {
  for (const alias of [name, ...aliases]) { languages.set(alias, { name, parser }); }
}
register("javascript", javascriptLanguage.parser, ["js", "mjs", "cjs"]);
register("typescript", typescriptLanguage.parser, ["ts", "mts", "cts"]);
register("jsx", jsxLanguage.parser, []);
register("tsx", tsxLanguage.parser, []);
// Highlighting is not JSON validation. The expression grammar preserves strings,
// numbers, booleans and punctuation without interpreting or executing any input.
register("json", javascriptLanguage.parser.configure({ top: "SingleExpression" }), ["jsonc"]);
register("html", htmlLanguage.parser, ["htm"]);
register("css", cssLanguage.parser, []);
register("markdown", markdownLanguage.parser, ["md"]);
// Stream grammars share the same bounded, inert source-range pipeline as LR
// grammars. They only classify tokens; no source is evaluated or fetched.
register("c", StreamLanguage.define(c).parser, ["h"]);
register("cpp", StreamLanguage.define(cpp).parser, ["c++", "cc", "cxx", "hpp", "hxx"]);
register("csharp", StreamLanguage.define(csharp).parser, ["cs", "c#"]);
register("java", StreamLanguage.define(java).parser, []);
register("python", StreamLanguage.define(python).parser, ["py", "python3"]);
register("rust", StreamLanguage.define(rust).parser, ["rs"]);
register("shell", StreamLanguage.define(shell).parser, ["sh", "bash"]);
register("powershell", StreamLanguage.define(powerShell).parser, ["ps1", "pwsh"]);
register("yaml", StreamLanguage.define(yaml).parser, ["yml"]);
register("sql", StreamLanguage.define(standardSQL).parser, []);
register("go", StreamLanguage.define(go).parser, ["golang"]);
register("kotlin", StreamLanguage.define(kotlin).parser, ["kt", "kts"]);
register("swift", StreamLanguage.define(swift).parser, []);
register("ruby", StreamLanguage.define(ruby).parser, ["rb"]);
register("lua", StreamLanguage.define(lua).parser, []);
register("dockerfile", StreamLanguage.define(dockerFile).parser, ["docker"]);
// The installed properties grammar recognizes INI sections and key/value lines.
// Its legacy "quote" token denotes a value, including unquoted INI values.
register("ini", StreamLanguage.define({ ...properties, tokenTable: { quote: tags.string } }).parser, ["properties"]);
register("toml", StreamLanguage.define(toml).parser, []);
register("diff", StreamLanguage.define(diff).parser, ["patch"]);
register("xml", StreamLanguage.define(xml).parser, ["rss", "atom"]);
register("dart", StreamLanguage.define(dart).parser, []);
register("clojure", StreamLanguage.define(clojure).parser, ["clj", "cljs", "cljc", "edn"]);
register("haskell", StreamLanguage.define(haskell).parser, ["hs"]);
register("r", StreamLanguage.define(r).parser, ["rscript"]);
register("perl", StreamLanguage.define(perl).parser, ["pl", "pm"]);
register("erlang", StreamLanguage.define(erlang).parser, ["erl"]);
register("scala", StreamLanguage.define(scala).parser, []);
register("cmake", StreamLanguage.define(cmake).parser, []);
register("nginx", StreamLanguage.define(nginx).parser, []);
// Do not claim ambiguous .m/.mm files or Objective-C++ through this grammar.
register("objectivec", StreamLanguage.define(objectiveC).parser, ["objective-c", "objc"]);

register("julia", StreamLanguage.define(julia).parser, ["jl"]);
register("groovy", StreamLanguage.define(groovy).parser, ["gvy"]);
register("pascal", StreamLanguage.define(pascal).parser, ["pas"]);
register("vb", StreamLanguage.define(vb).parser, ["vbnet","visualbasic"]);

const highlighter = tagHighlighter([
  { tag: tags.comment, class: "token comment" },
  { tag: tags.keyword, class: "token keyword" },
  { tag: tags.string, class: "token string" },
  { tag: tags.number, class: "token number" },
  { tag: tags.bool, class: "token boolean" },
  { tag: [tags.null, tags.atom], class: "token constant" },
  { tag: tags.regexp, class: "token regex" },
  { tag: tags.escape, class: "token entity" },
  { tag: tags.typeName, class: "token class-name" },
  { tag: tags.tagName, class: "token tag" },
  { tag: tags.attributeName, class: "token attr-name" },
  { tag: tags.attributeValue, class: "token attr-value" },
  { tag: tags.propertyName, class: "token property" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "token function" },
  { tag: tags.variableName, class: "token variable" },
  { tag: tags.operator, class: "token operator" },
  { tag: tags.punctuation, class: "token punctuation" },
  { tag: tags.meta, class: "token meta" },
  { tag: tags.heading, class: "token heading" },
  { tag: tags.link, class: "token url" },
  { tag: tags.strong, class: "token bold" },
  { tag: tags.emphasis, class: "token italic" },
  { tag: tags.strikethrough, class: "token strikethrough" },
  // Retain diff semantics while using the existing theme's green/red colors.
  { tag: tags.inserted, class: "token inserted string" },
  { tag: tags.deleted, class: "token deleted tag" },
  { tag: tags.invalid, class: "token error" },
]);

export interface CodeHighlightSpan { from: number; to: number; classes: string }
export interface CodeHighlightBudget { characters: number; blocks: number }
export type CodeHighlightPlan =
  | { status: "highlighted"; language: string; spans: CodeHighlightSpan[] }
  | { status: "plain"; reason: "unsupported" | "limit" | "unavailable" };

export function codeHighlightBudget(): CodeHighlightBudget {
  return { characters: MAX_CODE_HIGHLIGHT_VIEW_CHARACTERS, blocks: MAX_CODE_HIGHLIGHT_BLOCKS };
}

/** Pure source ranges: all text, including CRLF and surrogate pairs, stays intact. */
export function planCodeHighlighting(info: string, source: string, budget = codeHighlightBudget()): CodeHighlightPlan {
  const language = languages.get(info.trim().split(/\s+/)[0].toLowerCase());
  if (!language) { return { status: "plain", reason: "unsupported" }; }
  if (source.length > MAX_CODE_HIGHLIGHT_CHARACTERS || budget.characters < source.length || budget.blocks <= 0) {
    return { status: "plain", reason: "limit" };
  }
  budget.characters -= source.length; budget.blocks--;
  const spans: CodeHighlightSpan[] = [];
  const deadline = performance.now() + PARSE_TIME_MS;
  try {
    const parse = language.parser.startParse(source);
    let tree = null, steps = 0;
    while (!tree) {
      if (++steps > MAX_PARSE_STEPS || performance.now() > deadline) { return { status: "plain", reason: "limit" }; }
      tree = parse.advance();
    }
    highlightTree(tree, highlighter, (from, to, classes) => {
      if (spans.length >= MAX_CODE_HIGHLIGHT_SPANS) { throw new RangeError("Too many code highlight spans."); }
      if (from < (spans.at(-1)?.to ?? 0) || to > source.length || from >= to) { throw new RangeError("Invalid code highlight range."); }
      spans.push({ from, to, classes });
    });
    return { status: "highlighted", language: language.name, spans };
  } catch {
    // Unsupported or unusually costly grammar input must not hide the code.
    return { status: "plain", reason: "unavailable" };
  }
}

export interface CodeHighlightTarget { pre: HTMLElement; code: HTMLElement; language: string; source: string }

/** Capture original, source-bound fences before plugins can replace their DOM. */
export function captureCodeHighlightTargets(root: HTMLElement): CodeHighlightTarget[] {
  const targets: CodeHighlightTarget[] = [];
  for (const code of root.querySelectorAll<HTMLElement>("pre[data-source-line] > code")) {
    const pre = code.parentElement;
    const language = [...code.classList].find(name => name.startsWith("language-"))?.slice(9);
    if (pre && language) { targets.push({ pre, code, language, source: code.textContent ?? "" }); }
  }
  return targets;
}

/** Run after plugins: replaced, changed or custom-rendered code belongs to them. */
export function highlightCodeTargets(root: HTMLElement, targets: readonly CodeHighlightTarget[], current: () => boolean): void {
  const budget = codeHighlightBudget();
  for (const { pre, code, language, source } of targets) {
    if (!current()) { return; }
    if (!root.contains(pre) || code.parentElement !== pre || code.textContent !== source || code.childNodes.length !== 1
      || code.firstChild?.nodeType !== 3 || !code.classList.contains("language-" + language)) { continue; }
    const plan = planCodeHighlighting(language, source, budget);
    if (plan.status !== "highlighted" || !plan.spans.length) { continue; }
    const fragment = code.ownerDocument.createDocumentFragment();
    let offset = 0;
    for (const span of plan.spans) {
      if (span.from > offset) { fragment.append(code.ownerDocument.createTextNode(source.slice(offset, span.from))); }
      const token = code.ownerDocument.createElement("span");
      token.className = span.classes; token.textContent = source.slice(span.from, span.to); fragment.append(token);
      offset = span.to;
    }
    if (offset < source.length) { fragment.append(code.ownerDocument.createTextNode(source.slice(offset))); }
    // Keep the original code/pre identities, classes, exact text and source line.
    code.replaceChildren(fragment); code.dataset.codeHighlighted = plan.language;
  }
}
