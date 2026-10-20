import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, code, ReadingView, MarkdownPreviewRenderer;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "code-highlighting-"));
  const outfile = join(directory, "client.mjs");
  await build({ entryPoints: [join(root, "client/code-highlighting.ts")], outfile, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "silent" });
  code = await import(pathToFileURL(outfile).href);
  const readingOutput = join(directory, "reading.mjs");
  await build({
    stdin: { contents: 'export {ReadingView} from "./client/reading";export {MarkdownPreviewRenderer} from "./client/markdown-postprocessors";', resolveDir: root }, outfile: readingOutput, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "silent",
    plugins: [{ name: "reading-lifecycle-dom", setup(build) {
      build.onResolve({ filter: /^(?:dompurify|\.\/(?:dom|icons|callout-styles|mermaid-renderer|note-embed|plugin))$/ }, args => ({ path: args.path, namespace: "reading-lifecycle" }));
      build.onLoad({ filter: /.*/, namespace: "reading-lifecycle" }, args => ({ contents: {
        dompurify: "export default {sanitize:html=>globalThis.codeHighlightingLifecycleSanitize(html)};",
        "./dom": "export const reportError=error=>{throw error};export const element=()=>{throw new Error('Unexpected workspace UI in isolated Reading fixture')};",
        "./icons": "export const icon=()=>null;export const iconButton=()=>{throw new Error('Unexpected workspace toolbar in isolated Reading fixture')};",
        "./callout-styles": "export const observeCalloutStyles=()=>()=>{};",
        "./mermaid-renderer": "export const mountMermaid=()=>()=>{};",
        "./note-embed": "export class NoteEmbed{};export const newEmbedScope=()=>({depth:0,chain:[],budget:{used:0}});",
        "./plugin": "export class Component{};export class MarkdownRenderChild extends Component{};",
      }[args.path] }));
    } }],
  });
  ({ ReadingView, MarkdownPreviewRenderer } = await import(pathToFileURL(readingOutput).href));
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

function styled(info, source) {
  const plan = code.planCodeHighlighting(info, source);
  assert.equal(plan.status, "highlighted");
  return { ...plan, tokens: plan.spans.map(span => ({ text: source.slice(span.from, span.to), classes: span.classes })) };
}
const token = (plan, text, kind) => plan.tokens.some(span => span.text === text && span.classes.split(" ").includes(kind));

test("JavaScript aliases and info strings use real parser tokens without guessing plain languages", () => {
  const source = 'const answer = "safe"; // comment\n';
  for (const alias of ["js", "JAVASCRIPT", " mjs title=example", "cjs"]) {
    const plan = styled(alias, source);
    assert.equal(plan.language, "javascript");
    assert.ok(token(plan, "const", "keyword"));
    assert.ok(token(plan, '"safe"', "string"));
    assert.ok(token(plan, "// comment", "comment"));
  }
  for (const info of ["", "text", "unknown", "mermaid", "javascript:evil", "<script>"]) {
    assert.deepEqual(code.planCodeHighlighting(info, source), { status: "plain", reason: "unsupported" });
  }
});

test("TypeScript, JSX and TSX choose their respective grammars", () => {
  const ts = styled("TS", "interface Note { title: string }\nconst note: Note = { title: 'value' };\n");
  assert.equal(ts.language, "typescript");
  assert.ok(token(ts, "interface", "keyword"));
  assert.ok(token(ts, "Note", "class-name"));
  for (const language of ["jsx", "tsx"]) {
    const plan = styled(language, "const view = <p title=\"text\">Hello</p>;\n");
    assert.equal(plan.language, language);
    assert.ok(token(plan, "const", "keyword"));
    assert.ok(plan.tokens.some(span => span.text === "p" && /tag|class-name/.test(span.classes)));
  }
});

test("HTML, CSS, Markdown and JSON use installed local grammars", () => {
  const html = styled("htm", '<p title="safe">text &amp; other</p>\n');
  assert.equal(html.language, "html");
  assert.ok(token(html, "p", "tag"));
  assert.ok(token(html, "title", "attr-name"));
  const css = styled("css", "p { color: red; width: 10px; }\n");
  assert.ok(token(css, "color", "property"));
  const markdown = styled("md", "# Heading\n\n**strong** and *emphasis*\n");
  assert.ok(markdown.tokens.some(span => span.classes.includes("heading")));
  assert.ok(markdown.tokens.some(span => span.text === "strong" && span.classes.includes("bold")));
  const json = styled("json", '{"enabled": true, "count": 4, "empty": null}\n');
  assert.ok(token(json, "true", "boolean"));
  assert.ok(token(json, "4", "number"));
  assert.ok(token(json, "null", "constant"));
});

test("ranges preserve exact UTF-16, CRLF, tabs, hostile-looking text and final newlines", () => {
  const source = '\tconst emoji = "😀 <img src=x onerror=alert(1)> & \\\"quoted\\\"";\r\n// λ\r\n\r\n';
  const plan = styled("js", source);
  let offset = 0, reconstructed = "";
  for (const span of plan.spans) {
    assert.ok(span.from >= offset && span.to <= source.length && span.from < span.to);
    reconstructed += source.slice(offset, span.from) + source.slice(span.from, span.to); offset = span.to;
    assert.match(span.classes, /^token [a-z-]+(?: token [a-z-]+)*$/);
  }
  reconstructed += source.slice(offset);
  assert.equal(reconstructed, source);
  assert.ok(plan.tokens.some(span => span.text.includes("😀") && span.classes.includes("string")));
});

test("broken syntax remains displayable instead of treating highlighting as validation", () => {
  const source = "const value = { broken: [\n";
  const plan = styled("javascript", source);
  assert.ok(token(plan, "const", "keyword"));
});

const streamCases = [
  { name: "c", aliases: ["c", "h"], source: 'int main(void) { char* name = "λ"; return 42; } // kept', keyword: "return", type: "int" },
  { name: "cpp", aliases: ["cpp", "c++", "cc", "cxx", "hpp", "hxx"], source: 'class Note { public: int count = 42; char* name = "λ"; }; // kept', keyword: "class", type: "int" },
  { name: "csharp", aliases: ["csharp", "cs", "c#"], source: 'public class Note { int count = 42; string name = "λ"; } // kept', keyword: "public", type: "string" },
  { name: "java", aliases: ["java"], source: 'public class Note { int count = 42; String name = "λ"; } // kept', keyword: "class", type: "String" },
  { name: "python", aliases: ["python", "py", "python3"], source: 'def note():\n    return "λ", 42 # kept\n', keyword: "def" },
  { name: "rust", aliases: ["rust", "rs"], source: 'fn note() -> u32 { let value = 42; println!("λ"); value } // kept', keyword: "fn" },
  { name: "shell", aliases: ["shell", "sh", "bash"], source: 'if true; then echo "λ"; fi # kept', keyword: "if", noNumber: true },
  { name: "powershell", aliases: ["powershell", "pwsh", "ps1"], source: 'if ($true) { Write-Output "λ"; 42 } # kept', keyword: "if" },
  { name: "yaml", aliases: ["yaml", "yml"], source: 'name: "λ"\ncount: 42\nenabled: true # kept\n', key: "name" },
  { name: "sql", aliases: ["sql"], source: "SELECT name, 42 FROM notes WHERE name = 'λ'; -- kept", keyword: "SELECT", quote: "'λ'" },
];

for (const sample of streamCases) test(`${sample.name} aliases use the local stream grammar for distinct source tokens`, () => {
  for (const alias of sample.aliases) {
    const plan = styled(" " + alias.toUpperCase() + " title=local", sample.source);
    assert.equal(plan.language, sample.name);
    if (sample.keyword) { assert.ok(token(plan, sample.keyword, "keyword")); }
    if (sample.type) { assert.ok(token(plan, sample.type, "class-name")); }
    if (sample.key) { assert.ok(token(plan, sample.key, "constant")); }
    assert.ok(token(plan, sample.quote ?? '"λ"', "string"));
    assert.ok(plan.tokens.some(span => span.text.endsWith("kept") && span.classes.includes("comment")));
    if (!sample.noNumber) { assert.ok(token(plan, "42", "number")); }
    let previous = 0, reconstructed = "";
    for (const span of plan.spans) {
      assert.ok(span.from >= previous && span.to <= sample.source.length && span.from < span.to);
      reconstructed += sample.source.slice(previous, span.to); previous = span.to;
    }
    assert.equal(reconstructed + sample.source.slice(previous), sample.source);
  }
});

test("stream grammar state crosses CRLF lines without treating comments or multiline strings as executable keywords", () => {
  const comment = '/* public "fake" 42\r\nstill λ 😀 */\r\nint value = 9;\r\n';
  for (const language of ["c", "cpp", "csharp", "java"]) {
    const plan = styled(language, comment);
    assert.ok(plan.tokens.some(span => span.text.includes("public") && span.classes.includes("comment")));
    assert.ok(plan.tokens.some(span => span.text.includes("still λ 😀") && span.classes.includes("comment")));
    assert.equal(plan.tokens.some(span => span.text === "public" && span.classes.includes("keyword")), false);
    assert.ok(token(plan, "int", "class-name")); assert.ok(token(plan, "9", "number"));
  }
  const source = 'text = """def fake():\r\n    return 42 λ\r\n"""\r\ndef actual():\r\n    return 9\r\n';
  const python = styled("py", source);
  assert.ok(python.tokens.some(span => span.text.includes("return 42 λ") && span.classes.includes("string")));
  assert.equal(python.tokens.filter(span => span.text === "def" && span.classes.includes("keyword")).length, 1);
  assert.equal(python.tokens.filter(span => span.text === "return" && span.classes.includes("keyword")).length, 1);
  assert.ok(token(python, "9", "number"));
});

test("stream grammar blocks share the existing per-block, per-renderer and span-safe fallback policy", () => {
  for (const language of streamCases.map(sample => sample.name)) {
    const budget = { characters: 2, blocks: 1 };
    assert.deepEqual(code.planCodeHighlighting(language, "123", budget), { status: "plain", reason: "limit" });
    assert.deepEqual(budget, { characters: 2, blocks: 1 });
    assert.deepEqual(code.planCodeHighlighting(language, "x".repeat(code.MAX_CODE_HIGHLIGHT_CHARACTERS + 1)), { status: "plain", reason: "limit" });
    assert.deepEqual(code.planCodeHighlighting(language, "x", { characters: 10, blocks: 0 }), { status: "plain", reason: "limit" });
  }
  const budget = { characters: 10, blocks: 1 };
  assert.equal(code.planCodeHighlighting("py", "return 42", budget).status, "highlighted");
  assert.deepEqual(budget, { characters: 1, blocks: 0 });
  assert.deepEqual(code.planCodeHighlighting("cs", "x", budget), { status: "plain", reason: "limit" });
  assert.deepEqual(code.planCodeHighlighting("uninstalled-language", "return 42"), { status: "plain", reason: "unsupported" });
});

const additionalCases = [
  { name: "go", aliases: ["go", "golang"], source: 'package main\nfunc note() string { count := 42; return "λ" } // kept', tokens: [["package", "keyword"], ["func", "keyword"], ["42", "number"], ['"λ"', "string"], ["// kept", "comment"]] },
  { name: "kotlin", aliases: ["kotlin", "kt", "kts"], source: 'fun note(): String { val count = 42; return "λ" } // kept', tokens: [["fun", "keyword"], ["String", "class-name"], ["val", "keyword"], ["42", "number"], ['"λ"', "string"], ["// kept", "comment"]] },
  { name: "swift", aliases: ["swift"], source: 'func note() -> String { let count = 42; return "λ" } // kept', tokens: [["func", "keyword"], ["String", "class-name"], ["let", "keyword"], ["42", "number"], ['"λ"', "string"], ["// kept", "comment"]] },
  { name: "ruby", aliases: ["ruby", "rb"], source: 'def note\n  count = 42\n  return "λ" # kept\nend', tokens: [["def", "keyword"], ["42", "number"], ["return", "keyword"], ['"λ"', "string"], ["# kept", "comment"], ["end", "keyword"]] },
  { name: "lua", aliases: ["lua"], source: 'local function note()\n  return "λ", 42 -- kept\nend', tokens: [["local", "keyword"], ["function", "keyword"], ["return", "keyword"], ['"λ"', "string"], ["42", "number"], ["-- kept", "comment"]] },
  { name: "dockerfile", aliases: ["dockerfile", "docker"], source: 'FROM alpine:3\nRUN ["echo", "λ"]\nEXPOSE 42\n# kept', tokens: [["FROM", "keyword"], ["RUN", "keyword"], ['"λ"', "string"], ["EXPOSE", "keyword"], ["42", "number"], ["# kept", "comment"]] },
  { name: "ini", aliases: ["ini", "properties"], source: '[owner]\nname = "λ"\ncount = 42\n; kept', tokens: [["[owner]", "heading"], ["name ", "variable"], [' "λ"', "string"], [" 42", "string"], ["; kept", "comment"]] },
  { name: "toml", aliases: ["toml"], source: '[owner]\nname = "λ"\ncount = 42\nactive = true # kept', tokens: [["[owner]", "constant"], ["name", "property"], ['"λ"', "string"], ["42", "number"], ["true", "constant"], ["# kept", "comment"]] },
  { name: "diff", aliases: ["diff", "patch"], source: '--- a/note\n+++ b/note\n@@ -1 +1 @@\n-old λ\n+new 😀\n kept', tokens: [["@@ -1 +1 @@", "meta"], ["-old λ", "deleted"], ["+new 😀", "inserted"]] },
  { name: "xml", aliases: ["xml", "rss", "atom"], source: '<?xml version="1.0"?>\n<note count="42">λ &amp; 😀</note><!-- kept -->', tokens: [["<?xml", "meta"], ["note", "tag"], ["count", "attr-name"], ['"42"', "string"], ["&amp;", "constant"], ["<!-- kept -->", "comment"]] },
];

function assertExactRanges(source, plan) {
  let previous = 0;
  const chunks = [];
  for (const span of plan.spans) {
    assert.ok(Number.isInteger(span.from) && Number.isInteger(span.to));
    assert.ok(previous <= span.from && span.from < span.to && span.to <= source.length);
    chunks.push(source.slice(previous, span.from), source.slice(span.from, span.to));
    previous = span.to;
  }
  chunks.push(source.slice(previous));
  assert.equal(chunks.join(""), source, "Every original UTF-16 code unit survives the ranges.");
}

for (const sample of additionalCases) test(`${sample.name} independently classifies real source tokens with unambiguous aliases`, () => {
  for (const alias of sample.aliases) {
    // Ranges must refer to original CRLF source, never a normalized parser copy.
    const source = sample.source.replaceAll("\n", "\r\n");
    const plan = styled("  " + alias.toUpperCase() + " title=fixture", source);
    assert.equal(plan.language, sample.name);
    for (const [text, kind] of sample.tokens) {
      const from = source.indexOf(text);
      assert.ok(from >= 0);
      const to = from + text.length;
      // Stream grammars can consume the original CR as part of a line token.
      const ends = source[to] === "\r" ? [to, to + 1] : [to];
      assert.ok(plan.spans.some(span => span.from === from && ends.includes(span.to) && span.classes.split(" ").includes(kind)), `${sample.name}: exact ${kind} range for ${text}`);
    }
    assertExactRanges(source, plan);
  }
});

test("INI values, TOML typed values, XML and HTML use separate grammar registrations", () => {
  const source = '[owner]\ncount = 42\nactive = true\n';
  const ini = styled("properties", source), toml = styled("toml", source);
  assert.equal(ini.language, "ini"); assert.equal(toml.language, "toml");
  assert.ok(token(ini, " 42", "string")); assert.ok(token(toml, "42", "number"));
  assert.ok(token(ini, " true", "string")); assert.ok(token(toml, "true", "constant"));
  assert.equal(styled("XML", '<note id="λ"/>').language, "xml");
  assert.equal(styled("HTML", '<p id="λ">value</p>').language, "html");
  for (const info of ["text", "plain", "php", "go:evil", "kotlin-js", "xml<script>", "unknown"]) {
    const budget = code.codeHighlightBudget();
    assert.deepEqual(code.planCodeHighlighting(info, source, budget), { status: "plain", reason: "unsupported" });
    assert.deepEqual(budget, code.codeHighlightBudget());
  }
});

test("additional languages keep shared view, block and source-size limits before parsing", () => {
  for (const sample of additionalCases) {
    const oversized = sample.source + "😀".repeat(32_769);
    const budget = code.codeHighlightBudget();
    assert.deepEqual(code.planCodeHighlighting(sample.name, oversized, budget), { status: "plain", reason: "limit" });
    assert.deepEqual(budget, code.codeHighlightBudget());
    assert.deepEqual(code.planCodeHighlighting(sample.name, sample.source, { characters: sample.source.length - 1, blocks: 1 }), { status: "plain", reason: "limit" });
    assert.deepEqual(code.planCodeHighlighting(sample.name, sample.source, { characters: sample.source.length, blocks: 0 }), { status: "plain", reason: "limit" });
    const shared = { characters: sample.source.length + 1, blocks: 1 };
    assert.equal(code.planCodeHighlighting(sample.name, sample.source, shared).status, "highlighted");
    assert.deepEqual(shared, { characters: 1, blocks: 0 });
    assert.deepEqual(code.planCodeHighlighting("js", "1", shared), { status: "plain", reason: "limit" });
  }
});

test("new multiline grammars preserve raw strings, TOML values and XML CDATA across CRLF boundaries", () => {
  const cases = [
    { language: "go", source: 'package main\r\nvar text = `func fake() { return 42 }\r\nstill λ 😀`\r\nfunc actual() { return }', inner: "func fake", kind: "string", keyword: "func" },
    { language: "kotlin", source: 'val text = """fun fake() { return 42 }\r\nstill λ 😀"""\r\nfun actual() { return }', inner: "fun fake", kind: "string", keyword: "fun" },
    { language: "lua", source: 'local text = [=[function fake() return 42\r\nstill λ 😀]=]\r\nlocal function actual() return 9 end', inner: "function fake", kind: "string", keyword: "function" },
    { language: "toml", source: 'name = """first\r\n[owner] # not a comment λ 😀\r\nlast"""\r\ncount = 9', inner: "[owner] # not a comment", kind: "string" },
    { language: "xml", source: '<root><![CDATA[<fake attr="42">\r\nλ 😀]]><actual count="9"/></root>', inner: '<fake attr="42">', kind: "constant" },
  ];
  for (const sample of cases) {
    const plan = styled(sample.language, sample.source);
    assertExactRanges(sample.source, plan);
    assert.ok(plan.tokens.some(span => span.text.includes(sample.inner) && span.classes.split(" ").includes(sample.kind)));
    assert.ok(plan.tokens.some(span => span.text.includes("λ 😀") && span.classes.split(" ").includes(sample.kind)));
    if (sample.keyword) { assert.equal(plan.tokens.filter(span => span.text === sample.keyword && span.classes.includes("keyword")).length, 1); }
    if (sample.language === "toml") {
      assert.equal(plan.tokens.some(span => span.classes.includes("comment")), false);
      assert.ok(token(plan, "9", "number"));
    }
    if (sample.language === "xml") {
      assert.equal(plan.tokens.some(span => span.text === "fake" && span.classes.includes("tag")), false);
      assert.ok(token(plan, "actual", "tag"));
    }
  }
});

const extraCases = [
{"name":"julia","aliases":["julia","jl"],"source":"function note()\n return \"λ 😀\", 42 # kept\nend","tokens":[["function","keyword"],["return","keyword"],["42","number"],["\"λ 😀\"","string"],["# kept","comment"]]},
{"name":"groovy","aliases":["groovy","gvy"],"source":"class Note { def text = \"λ 😀\"; return 42 } // kept","tokens":[["class","keyword"],["return","keyword"],["42","number"],["\"λ 😀\"","string"],["// kept","comment"]]},
{"name":"pascal","aliases":["pascal","pas"],"source":"begin\n value := 42; text := 'λ 😀'; { kept }\nend","tokens":[["begin","keyword"],["42","number"],["'λ 😀'","string"],["{ kept }","comment"]]},
{"name":"vb","aliases":["vb","vbnet","visualbasic"],"source":"Dim text As String = \"λ 😀\"\nReturn 42 ' kept","tokens":[["Dim","keyword"],["Return","keyword"],["42","number"],["\"λ 😀\"","string"],["' kept","comment"]]},
  { name: "dart", aliases: ["dart"], source: 'class Note { String text = "λ 😀 <img src=https://extra-highlight-no-fetch.invalid/x onerror=alert(1)>"; int count = 42; } // kept', tokens: [["class", "keyword"], ["Note", "class-name"], ["42", "number"], ['"λ 😀 <img src=https://extra-highlight-no-fetch.invalid/x onerror=alert(1)>"', "string"], ["// kept", "comment"]] },
  { name: "clojure", aliases: ["clojure", "clj", "cljs", "cljc", "edn"], source: '(defn note [] (if true "λ 😀" 42)) ; kept', tokens: [["defn", "keyword"], ["if", "keyword"], ["true", "constant"], ['"λ 😀"', "string"], ["42", "number"], ["; kept", "comment"]] },
  { name: "haskell", aliases: ["haskell", "hs"], source: 'module Note where\nnote = if True then "λ 😀" else "kept"\ncount = 42 -- kept', tokens: [["module", "keyword"], ["Note", "class-name"], ["where", "keyword"], ['"λ 😀"', "string"], ["42", "number"], ["-- kept", "comment"]] },
  { name: "r", aliases: ["r", "rscript"], source: 'note <- function() { value <- 42; "λ 😀" } # kept', tokens: [["<-", "operator"], ["function", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { name: "perl", aliases: ["perl", "pl", "pm"], source: 'sub note { my $value = 42; return "λ 😀"; } # kept', tokens: [["sub", "keyword"], ["$value", "variable"], ["42", "number"], ["return", "keyword"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { name: "erlang", aliases: ["erlang", "erl"], source: '-module(note).\nnote() -> case true of true -> {42, "λ 😀"} end. % kept', tokens: [["-module", "attr-name"], ["case", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["end", "keyword"], ["% kept", "comment"]] },
  { name: "scala", aliases: ["scala"], source: 'object Note { val count: Int = 42; val text = "λ 😀" } // kept', tokens: [["object", "keyword"], ["Int", "class-name"], ["42", "number"], ['"λ 😀"', "string"], ["// kept", "comment"]] },
  { name: "cmake", aliases: ["cmake"], source: 'set(NAME "λ 😀")\nif(DEFINED NAME)\n  message(STATUS "${NAME}")\nendif()\n# kept', tokens: [["set", "variable"], ['"λ 😀"', "string"], ["${NAME}", "variable"], ["# kept", "comment"]] },
  { name: "nginx", aliases: ["nginx"], source: 'server {\n  listen 8080;\n  server_name "λ.example";\n  return 200 "λ 😀"; # kept\n}', tokens: [["server", "keyword"], ["server_name", "keyword"], ['"λ.example"', "string"], ["return", "keyword"], ["200 ", "number"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { name: "objectivec", aliases: ["objectivec", "objective-c", "objc"], source: '@interface Note : NSObject\n@end\nint main(void) { NSString *name = @"λ 😀"; return 42; } // kept', tokens: [["@interface", "keyword"], ["@end", "keyword"], ["void", "class-name"], ['"λ 😀"', "string"], ["return", "keyword"], ["42", "number"], ["// kept", "comment"]] },
];

for (const sample of extraCases) test(`${sample.name} uses an installed grammar with exact Unicode/CRLF ranges and explicit aliases`, () => {
  for (const alias of sample.aliases) {
    const source = sample.source.replaceAll("\n", "\r\n");
    const plan = styled("  " + alias.toUpperCase() + " title=fixture", source);
    assert.equal(plan.language, sample.name);
    assertExactRanges(source, plan);
    for (const [text, kind] of sample.tokens) {
      const from = source.indexOf(text), to = from + text.length;
      assert.ok(from >= 0);
      assert.ok(plan.spans.some(span => span.from === from && (span.to === to || source[to] === "\r" && span.to === to + 1) && span.classes.split(" ").includes(kind)), `${sample.name}: exact ${kind} range for ${text}`);
    }
    for (const span of plan.spans) {
      for (const offset of [span.from, span.to]) {
        assert.equal(offset > 0 && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset] ?? ""), false, "A styled node cannot split a surrogate pair.");
      }
    }
  }
});

test("extra languages retain common source, view and block budgets before their grammar can run", () => {
  for (const sample of extraCases) {
    const budget = code.codeHighlightBudget(), source = sample.source + "😀".repeat(32_769);
    assert.deepEqual(code.planCodeHighlighting(sample.name, source, budget), { status: "plain", reason: "limit" });
    assert.deepEqual(budget, code.codeHighlightBudget());
    assert.deepEqual(code.planCodeHighlighting(sample.name, sample.source, { characters: sample.source.length - 1, blocks: 1 }), { status: "plain", reason: "limit" });
    assert.deepEqual(code.planCodeHighlighting(sample.name, sample.source, { characters: sample.source.length, blocks: 0 }), { status: "plain", reason: "limit" });
  }
  for (const language of ["php", "m", "mm", "conf", "cmake:unsafe", "objc<script>"]) {
    assert.deepEqual(code.planCodeHighlighting(language, "code"), { status: "plain", reason: "unsupported" });
  }
});

test("extra multiline grammars retain comments and quoted state across original CRLF boundaries", () => {
  const cases = [
    { language: "haskell", source: '{- outer if\r\n{- nested then -}\r\nstill λ 😀 -}\r\nactual = if True then 42 else 9', inner: "{- nested then -}", kind: "comment", keyword: "if" },
    { language: "r", source: 'text <- "first λ 😀\r\nfunction notCode"\r\nactual <- function() 42', inner: "function notCode", kind: "string", keyword: "function" },
    { language: "scala", source: 'val text = """first λ 😀\r\nobject notCode"""\r\nobject Actual { val count = 42 }', inner: "object notCode", kind: "string", keyword: "object" },
    { language: "clojure", source: '(def text "first λ 😀\r\n(if false 42)")\r\n(if true 9 8)', inner: "(if false 42)", kind: "string", keyword: "if" },
    { language: "erlang", source: 'note() -> "first λ 😀\r\ncase notCode".\r\nactual() -> case true of true -> 42 end.', inner: "case notCode", kind: "string", keyword: "case" },
  ];
  for (const sample of cases) {
    const plan = styled(sample.language, sample.source);
    assertExactRanges(sample.source, plan);
    assert.ok(plan.tokens.some(span => span.text.includes(sample.inner) && span.classes.split(" ").includes(sample.kind)), sample.language + " keeps multiline token ownership");
    assert.ok(plan.tokens.some(span => span.text.includes("λ 😀") && span.classes.split(" ").includes(sample.kind)));
    assert.equal(plan.tokens.filter(span => span.text === sample.keyword && span.classes.split(" ").includes("keyword")).length, 1, sample.language + " only highlights the actual external keyword");
  }
});

test("oversized blocks and shared view budgets fall back without truncating or spending unrelated capacity", () => {
  const budget = code.codeHighlightBudget();
  assert.deepEqual(code.planCodeHighlighting("js", "x".repeat(code.MAX_CODE_HIGHLIGHT_CHARACTERS + 1), budget), { status: "plain", reason: "limit" });
  assert.deepEqual(budget, code.codeHighlightBudget());
  const small = { characters: 5, blocks: 2 };
  assert.equal(code.planCodeHighlighting("js", "let x", small).status, "highlighted");
  assert.deepEqual(small, { characters: 0, blocks: 1 });
  assert.deepEqual(code.planCodeHighlighting("js", "1", small), { status: "plain", reason: "limit" });
  assert.deepEqual(code.planCodeHighlighting("js", "1", { characters: 10, blocks: 0 }), { status: "plain", reason: "limit" });
  const unknown = { characters: 1, blocks: 1 };
  assert.deepEqual(code.planCodeHighlighting("unknown", "long source", unknown), { status: "plain", reason: "unsupported" });
  assert.deepEqual(unknown, { characters: 1, blocks: 1 });
});

// Minimal DOM writer model: real selection, sanitization, processors and cleanup
// are separately exercised by checkCodeHighlighting in both host runners.
class TextNode {
  nodeType = 3;
  constructor(text) { this.textContent = text; }
}
function elementTreeWalker(root, whatToShow) {
  assert.equal(whatToShow, 1);
  const pending = [...root.childNodes].reverse();
  return { nextNode() {
    while (pending.length) {
      const node = pending.pop();
      if (node.nodeType === 3) continue;
      pending.push(...[...node.childNodes].reverse());
      return node;
    }
    return null;
  } };
}
class Element {
  constructor(document, tag = "SPAN") { this.ownerDocument = document; this.tagName = tag; this.children = []; this.dataset = {}; this.classes = new Set(); }
  get classList() { const classes = this.classes; return { contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)), [Symbol.iterator]: () => classes[Symbol.iterator]() }; }
  set className(value) { this.classes = new Set(value.split(" ")); }
  get className() { return [...this.classes].join(" "); }
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.filter(child => child.nodeType !== 3).length; }
  get firstChild() { return this.children[0] ?? null; }
  set textContent(value) { this.children = [new TextNode(value)]; }
  get textContent() { return this.children.map(child => child.textContent).join(""); }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === "FRAGMENT") { this.append(...node.children); }
      else { this.children.push(node); node.parentElement = this; }
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...nodes); }
  contains(target) { return this === target || this.children.some(child => child === target || child.contains?.(target)); }
  setAttribute() {}
  addEventListener() {}
  querySelectorAll(selector) {
    const result = [], data = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1]?.replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
    const visit = node => {
      for (const child of node.children ?? []) {
        if (selector === "pre[data-source-line] > code" && child.tagName === "CODE" && child.parentElement?.tagName === "PRE" && child.parentElement.dataset.sourceLine !== undefined
          || data && child.dataset?.[data] !== undefined) { result.push(child); }
        visit(child);
      }
    };
    visit(this); return result;
  }
  get outerHTML() {
    const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    return "<" + this.tagName.toLowerCase() + (this.className ? ' class="' + escape(this.className) + '"' : "") + ">"
      + this.children.map(child => child.nodeType === 3 ? escape(child.textContent) : child.outerHTML).join("") + "</" + this.tagName.toLowerCase() + ">";
  }
}
function fixture(source = 'const value = "😀 <img src=x onerror=alert(1)>";\r\n\r\n') {
  const document = { createElement: tag => new Element(document, tag.toUpperCase()), createTextNode: text => new TextNode(text), createDocumentFragment: () => new Element(document, "FRAGMENT") };
  const pre = new Element(document, "PRE"), element = new Element(document, "CODE");
  element.className = "language-js retained"; element.textContent = source; element.parentElement = pre;
  pre.dataset.sourceLine = "17";
  const root = { contains: target => target === pre };
  return { root, target: { pre, code: element, language: "js", source } };
}

test("DOM output only creates inert spans/text and retains exact code/pre identities and source mapping", () => {
  const { root, target } = fixture(), originalCode = target.code, originalPre = target.pre;
  code.highlightCodeTargets(root, [target], () => true);
  assert.equal(target.code, originalCode); assert.equal(target.pre, originalPre);
  assert.equal(target.code.textContent, target.source);
  assert.equal(target.code.className, "language-js retained");
  assert.equal(target.pre.dataset.sourceLine, "17");
  assert.equal(target.code.dataset.codeHighlighted, "javascript");
  assert.ok(target.code.children.some(child => child.tagName === "SPAN" && child.className === "token keyword"));
  assert.ok(target.code.children.every(child => child.nodeType === 3 || child.tagName === "SPAN"));
});

test("added stream-language DOM retains exact inert Unicode/CRLF code and respects custom processor ownership", () => {
  const source = 'public class Note { string value = "😀 <img src=x onerror=alert(1)>"; }\r\n// λ\r\n';
  const { root, target } = fixture(source);
  target.language = "csharp"; target.code.className = "language-csharp retained";
  code.highlightCodeTargets(root, [target], () => true);
  assert.equal(target.code.textContent, source); assert.equal(target.code.dataset.codeHighlighted, "csharp");
  assert.equal(target.pre.dataset.sourceLine, "17");
  assert.ok(target.code.children.every(child => child.nodeType === 3 || child.tagName === "SPAN"));
  assert.equal(target.code.outerHTML.includes("<img"), false);
  const owned = fixture(source); owned.target.language = "csharp"; owned.target.code.className = "language-csharp retained";
  const output = owned.target.code.ownerDocument.createElement("output"); output.textContent = source; owned.target.code.replaceChildren(output);
  code.highlightCodeTargets(owned.root, [owned.target], () => true);
  assert.equal(owned.target.code.children[0], output); assert.equal(owned.target.code.dataset.codeHighlighted, undefined);
});

test("every added language emits only inert source spans and leaves stale or processor-owned code alone", () => {
  for (const sample of additionalCases) {
    const source = sample.source + '\r\n<img src=https://no-fetch.invalid/x onerror=alert(1)> λ 😀\r\n';
    const { root, target } = fixture(source);
    target.language = sample.name; target.code.className = "language-" + sample.name + " retained";
    const originalCode = target.code, originalPre = target.pre;
    code.highlightCodeTargets(root, [target], () => true);
    assert.equal(target.code, originalCode); assert.equal(target.pre, originalPre);
    assert.equal(target.code.textContent, source); assert.equal(target.pre.dataset.sourceLine, "17");
    assert.equal(target.code.dataset.codeHighlighted, sample.name);
    assert.ok(target.code.children.every(child => child.nodeType === 3 || child.tagName === "SPAN"));
    assert.equal(target.code.outerHTML.includes("<img"), false);
    for (const change of ["stale", "processor", "replacement"]) {
      const owned = fixture(source); owned.target.language = sample.name; owned.target.code.className = "language-" + sample.name;
      if (change === "processor") {
        const output = owned.target.code.ownerDocument.createElement("output"); output.textContent = source; owned.target.code.replaceChildren(output);
      }
      if (change === "replacement") { owned.target.code.textContent += "changed externally"; }
      const children = owned.target.code.children, text = owned.target.code.textContent;
      code.highlightCodeTargets(owned.root, [owned.target], () => change !== "stale");
      assert.equal(owned.target.code.children, children); assert.equal(owned.target.code.textContent, text);
      assert.equal(owned.target.code.dataset.codeHighlighted, undefined);
    }
  }
});

test("all additional language DOM writers preserve code ownership and inert Unicode source", () => {
  for (const sample of extraCases) {
    const source = sample.source.replaceAll("\n", "\r\n") + '\r\n<img src=https://extra-no-fetch.invalid/x onerror=alert(1)> λ 😀\r\n';
    const { root, target } = fixture(source);
    target.language = sample.name; target.code.className = "language-" + sample.name + " retained";
    const originalCode = target.code, originalPre = target.pre;
    code.highlightCodeTargets(root, [target], () => true);
    assert.equal(target.code, originalCode); assert.equal(target.pre, originalPre);
    assert.equal(target.code.textContent, source); assert.equal(target.pre.dataset.sourceLine, "17");
    assert.equal(target.code.dataset.codeHighlighted, sample.name);
    assert.ok(target.code.children.every(child => child.nodeType === 3 || child.tagName === "SPAN"));
    assert.equal(target.code.outerHTML.includes("<img"), false);
    for (const change of ["stale", "processor", "replacement"]) {
      const owned = fixture(source); owned.target.language = sample.name; owned.target.code.className = "language-" + sample.name;
      if (change === "processor") {
        const output = owned.target.code.ownerDocument.createElement("output"); output.textContent = source; owned.target.code.replaceChildren(output);
      }
      if (change === "replacement") { owned.root.contains = () => false; }
      const children = owned.target.code.children;
      code.highlightCodeTargets(owned.root, [owned.target], () => change !== "stale");
      assert.equal(owned.target.code.children, children); assert.equal(owned.target.code.dataset.codeHighlighted, undefined);
    }
  }
});

for (const change of ["removed", "reparented", "text", "custom-markup", "language", "stale"]) test(`plugin or owner changes retain their precedence: ${change}`, () => {
  const { root, target } = fixture();
  if (change === "removed") { root.contains = () => false; }
  if (change === "reparented") { target.code.parentElement = {}; }
  if (change === "text") { target.code.textContent += " // plugin change"; }
  if (change === "custom-markup") { const span = target.code.ownerDocument.createElement("span"); span.textContent = target.source; target.code.replaceChildren(span); }
  if (change === "language") { target.code.className = "language-other"; }
  const children = target.code.children, content = target.code.textContent;
  code.highlightCodeTargets(root, [target], () => change !== "stale");
  assert.equal(target.code.children, children, "The highlighter must not replace owned/custom DOM.");
  assert.equal(target.code.textContent, content);
  assert.equal(target.code.dataset.codeHighlighted, undefined);
});

test("Reading startup completion decorates its owned code during vault restoration despite the same-content cache", async () => {
  const previousDocument = globalThis.document;
  const document = { createElement: tag => new Element(document, tag.toUpperCase()), createTextNode: text => new TextNode(text), createDocumentFragment: () => new Element(document, "FRAGMENT"), createTreeWalker: elementTreeWalker };
  const container = document.createElement("div");
  const app = { vault: { rootPath: "fixture-root" }, changingVault: true }; app.workspace = { app };
  const leaf = { id: "restored-leaf", workspace: app.workspace, getViewState() {} };
  globalThis.document = document;
  globalThis.codeHighlightingLifecycleSanitize = html => {
    const match = /<pre data-slopsidian-source="([^"]+)"><code class="language-js">([\s\S]*?)<\/code><\/pre>/.exec(html);
    assert.ok(match, "The real Markdown renderer must bind the fence to its source line.");
    const fragment = document.createDocumentFragment(), pre = document.createElement("pre"), element = document.createElement("code");
    pre.dataset.slopsidianSource = match[1]; element.className = "language-js"; element.textContent = match[2];
    pre.append(element); fragment.append(pre); return fragment;
  };
  try {
    const reading = new ReadingView(leaf, container), markdown = "```js\nconst restored = 42;\n```\n";
    reading.render(markdown, "Restored.md");
    const element = container.querySelectorAll("pre[data-source-line] > code")[0];
    assert.equal(element.dataset.codeHighlighted, undefined, "Late work has not completed synchronously.");
    await reading.whenReady();
    assert.equal(element.dataset.codeHighlighted, "javascript", "Owned passive decoration must finish while the vault is still restoring.");
    assert.equal(element.textContent, "const restored = 42;\n");
    app.changingVault = false;
    reading.render(markdown, "Restored.md");
    assert.equal(container.querySelectorAll("pre[data-source-line] > code")[0], element, "A cached render must retain the already highlighted original code node.");
    assert.equal(element.dataset.codeHighlighted, "javascript");
    await reading.clear();
  } finally {
    if (previousDocument === undefined) { delete globalThis.document; } else { globalThis.document = previousDocument; }
    delete globalThis.codeHighlightingLifecycleSanitize;
  }
});

async function pendingReadingFixture() {
  const previousDocument = globalThis.document, previousSanitize = globalThis.codeHighlightingLifecycleSanitize;
  const document = { createElement: tag => new Element(document, tag.toUpperCase()), createTextNode: text => new TextNode(text), createDocumentFragment: () => new Element(document, "FRAGMENT"), createTreeWalker: elementTreeWalker };
  document.defaultView = { MutationObserver: class { observe() {} disconnect() {} } };
  const container = document.createElement("div"), app = { vault: { rootPath: "task-focus-root" }, changingVault: false, configuration: { get: () => false } }; app.workspace = { app };
  const leaf = { id: "task-focus-leaf", workspace: app.workspace, getViewState() {} }, markdown = "```js\nconst retained = 42;\n```\n";
  let release, begin, cancelled = 0, refreshed = 0, active = true;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { begin = resolve; });
  const processor = () => { begin(); return gate; };
  globalThis.document = document;
  globalThis.codeHighlightingLifecycleSanitize = html => {
    const match = /<pre data-slopsidian-source="([^"]+)"><code class="language-js">([\s\S]*?)<\/code><\/pre>/.exec(html); assert.ok(match);
    const fragment = document.createDocumentFragment(), pre = document.createElement("pre"), code = document.createElement("code");
    pre.dataset.slopsidianSource = match[1]; code.className = "language-js"; code.textContent = match[2]; pre.append(code); fragment.append(pre); return fragment;
  };
  MarkdownPreviewRenderer.registerPostProcessor(processor);
  const reading = new ReadingView(leaf, container); reading.render(markdown, "Task focus.md");
  // The real renderer/processor/readiness/cache path runs here. This small DOM
  // fixture cannot construct a browser checkbox; only its pending interaction
  // context and focus request are sentinels. Actual checkbox focus is checked
  // by the pointer/Space workflow in both GUI hosts.
  const context = reading.foldingContext = { section: container.children[0], inventory: { headings: [] }, lists: {}, tasks: {}, callouts: { entries: [], message: null },
    calloutState: { load: () => null, save() { throw Error("The code-only focus fixture has no callout preference to save"); } },
    owned: () => active, current: () => active, writable: () => active, document, ready: false, children: null };
  const task = reading.tasks = { isDisposed: false, refresh() { refreshed++; }, dispose() { this.isDisposed = true; } };
  reading.taskFocusCleanup = () => { cancelled++; };
  return { reading, markdown, document, container, context, task, started, release,
    cancelled: () => cancelled, refreshed: () => refreshed, invalidate() { active = false; },
    async cleanup() {
      active = false; release(); await reading.whenReady(); MarkdownPreviewRenderer.unregisterPostProcessor(processor); await reading.clear();
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
      if (previousSanitize === undefined) delete globalThis.codeHighlightingLifecycleSanitize; else globalThis.codeHighlightingLifecycleSanitize = previousSanitize;
    } };
}

test("same-key Reading refresh preserves a pending focus request until the real deferred processor finishes", async () => {
  const f = await pendingReadingFixture();
  try {
    const originalSection = f.context.section, originalCode = originalSection.querySelectorAll("pre[data-source-line] > code")[0];
    let completed = false; const ready = f.reading.whenReady().then(() => { completed = true; });
    f.reading.render(f.markdown, "Task focus.md"); await f.started; await Promise.resolve();
    assert.equal(f.context.ready, false); assert.equal(completed, false); assert.equal(f.refreshed(), 0);
    assert.equal(f.cancelled(), 0, "A same-owned pending render must keep its deferred task focus request.");
    assert.equal(f.reading.taskFocusCleanup instanceof Function, true); assert.equal(f.container.children[0], originalSection);
    f.release(); await ready;
    assert.equal(f.context.ready, true); assert.ok(f.refreshed() > 0); assert.equal(f.cancelled(), 0);
    assert.equal(originalSection.querySelectorAll("pre[data-source-line] > code")[0], originalCode); assert.equal(originalCode.dataset.codeHighlighted, "javascript");
  } finally { await f.cleanup(); }
});

test("pending Reading focus still retires on owner/document loss, ready topology replacement or explicit mode cleanup", async () => {
  for (const change of ["owner", "document", "topology", "clear"]) {
    const f = await pendingReadingFixture();
    try {
      if (change === "owner") f.invalidate();
      if (change === "document") f.context.document = {};
      if (change === "topology") { f.context.ready = true; f.context.children = []; }
      if (change === "clear") await f.reading.clear(); else f.reading.refreshFolding();
      assert.equal(f.cancelled(), 1, change + " must cancel deferred task focus"); assert.equal(f.reading.taskFocusCleanup, null);
      assert.equal(f.task.isDisposed, true); assert.equal(f.reading.tasks, null);
    } finally { await f.cleanup(); }
  }
});
