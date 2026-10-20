import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, startHost } from "./host.mjs";

let directory, prepareMermaid, MAX_MERMAID_CHARS;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "mermaid-tests-"));
  const output = join(directory, "policy.mjs");
  await build({ entryPoints: [join(root, "client", "mermaid-policy.ts")], outfile: output, bundle: true, platform: "node", format: "esm", external: ["yaml"], logLevel: "silent" });
  ({ prepareMermaid, MAX_MERMAID_CHARS } = await import(pathToFileURL(output).href));
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

test("Mermaid preparation retains diagram syntax, Unicode and literal comments without changing the source string", () => {
  const source = "\ufeffflowchart LR\r\n A[λ 中文 😀] --> B[Done]\r\n %% Normal comment\r\n";
  assert.deepEqual(prepareMermaid(source), { text: source.slice(1).replaceAll("\r\n", "\n"), title: undefined, options: {} });
  assert.equal(source.charCodeAt(0), 0xfeff);
});

test("Mermaid frontmatter and legacy init directives extract only supported theme/look/layout values", () => {
  const source = "---\ntitle: 'A title: λ'\nconfig:\n  theme: forest\n  look: handDrawn\n  layout: elk\n---\n%%{init: {'theme': 'neutral'}}%%\nflowchart LR\n A-->B";
  const result = prepareMermaid(source);
  assert.deepEqual(result.options, { theme: "neutral", look: "handDrawn", layout: "elk" });
  assert.equal(result.title, "A title: λ"); assert.match(result.text, /flowchart LR/);
  assert.ok(!result.text.includes("config:") && !result.text.includes("%%{"));
  assert.equal(prepareMermaid("%%{initialize: {theme: dark}}%%\nsequenceDiagram\n A->>B: Hello").options.theme, "dark");
});

test("Mermaid configuration cannot relax security, inject CSS/HTML/fonts, load plugins or change renderer limits", () => {
  for (const key of ["securityLevel", "startOnLoad", "htmlLabels", "themeCSS", "fontFamily", "maxEdges", "maxTextSize", "dompurifyConfig", "flowchart", "elk", "__proto__", "constructor"]) {
    assert.throws(() => prepareMermaid(`%%{init: {${key}: 'loose'}}%%\nflowchart LR\n A-->B`), /not supported/);
    assert.throws(() => prepareMermaid(`---\nconfig:\n  ${key}: loose\n---\nflowchart LR\n A-->B`), /not supported/);
  }
  for (const value of ["https://example.invalid/plugin.js", "../../file", "<script>unsafe()</script>", 42, null, ["dark"]]) {
    assert.throws(() => prepareMermaid(`---\nconfig: {theme: ${JSON.stringify(value)}}\n---\nflowchart LR\n A-->B`), /Invalid Mermaid theme/);
  }
  assert.equal({}.polluted, undefined);
});

test("Malformed, cyclic, duplicate, empty and oversized Mermaid inputs fail explicitly before rendering", () => {
  for (const source of ["", "  ", "\0flowchart LR", "x".repeat(MAX_MERMAID_CHARS + 1), "---\ntitle: Unclosed", "---\ntitle: First\ntitle: Second\n---\nflowchart LR", "---\nconfig: &cycle {theme: *cycle}\n---\nflowchart LR", "%%{init: {theme: dark}}", "%%{other: {theme: dark}}%%\nflowchart LR", "%%{init: {theme: dark}}%%"]) {
    assert.throws(() => prepareMermaid(source));
  }
  assert.throws(() => prepareMermaid("%%{init: {theme: dark}}%%\n".repeat(5) + "flowchart LR\n A-->B"), /at most four/);
  assert.throws(() => prepareMermaid("---\nconfig: {theme: dark, theme: neutral}\n---\nflowchart LR"), /Invalid Mermaid configuration/);
});

test("The native renderer asset permits only same-origin embedding and carries a stricter sandbox CSP", async () => {
  const host = await startHost(directory);
  try {
    const rootPage = await host.request("/");
    assert.match(rootPage.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(rootPage.headers.get("content-security-policy"), /worker-src 'self' blob:;/);
    const frame = await host.request("/mermaid-frame.html"); assert.equal(frame.status, 200);
    assert.match(frame.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    const html = await frame.text();
    assert.match(html, /connect-src 'none'/); assert.match(html, /script-src 'self'/);
    assert.match(html, /worker-src 'none'/);
    assert.match(html, /js\/mermaid-frame.js/); assert.ok(!/https?:\/\//.test(html));
    assert.equal((await host.request("/js/mermaid-frame.js")).status, 200);
  } finally { await host.stop(); }
});
