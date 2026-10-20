import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const samples = [
  { language: "csharp", source: 'public class Note { public int Count = 42; string Name = "λ <img src=https://highlight-no-fetch.invalid/x onerror=alert(1)>"; } // kept', token: "public", kind: "keyword" },
  { language: "c", source: 'int main(void) { char* name = "λ"; return 42; } // kept', token: "return", kind: "keyword" },
  { language: "cpp", source: 'class Note { public: int count = 42; char* name = "λ"; }; // kept', token: "class", kind: "keyword" },
  { language: "java", source: 'public class Note { int count = 42; String name = "λ"; } // kept', token: "class", kind: "keyword" },
  { language: "python", source: 'def note():\n    return "λ", 42 # kept', token: "def", kind: "keyword" },
  { language: "rust", source: 'fn note() -> u32 { let value = 42; println!("λ"); value } // kept', token: "fn", kind: "keyword" },
  { language: "shell", source: 'if true; then echo "λ"; fi # kept', token: "if", kind: "keyword" },
  { language: "powershell", source: 'if ($true) { Write-Output "λ"; 42 } # kept', token: "if", kind: "keyword" },
  { language: "yaml", source: 'name: "λ"\ncount: 42\nenabled: true # kept', token: "name", kind: "constant" },
  { language: "sql", source: "SELECT name, 42 FROM notes WHERE name = 'λ'; -- kept", token: "SELECT", kind: "keyword" },
];

/** Actual local language grammars on Reading/static renderers, processor precedence and lifecycle. */
export async function checkExpandedHighlighting(tools) {
  const { directory, evaluate, command, wait, report, capture, restart, afterReload } = tools;
  const path = "Reading discovery/Added languages.md", lines = ["# Additional local code languages", ""], sourceLines = [];
  for (const sample of samples) {
    sourceLines.push(lines.join("\n").split("\n").length);
    lines.push("```" + sample.language, sample.source, "```", "");
  }
  const limit = "x".repeat(65_537);
  lines.push("```uninstalled-language", "Literal unsupported source λ", "```", "", "```python", limit, "```", "");
  const text = lines.join("\n").replaceAll("\n", "\r\n"), original = Buffer.from("\ufeff" + text);
  const preview = "app.workspace.activeLeaf.view.previewEl", csharp = `${preview}.querySelector('pre>code.language-csharp')`;
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  await mkdir(join(directory, "Reading discovery"), { recursive: true });
  await writeFile(join(directory, path), original, { flag: "wx" });
  const highlighted = `${preview}.querySelectorAll('pre>code[data-code-highlighted]').length===${samples.length}`;
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false)})()`);
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${highlighted}`, "all ten additional Reading code grammars");
    const rendered = await evaluate(`(()=>{const root=${preview};return {blocks:[...root.querySelectorAll("pre>code[data-code-highlighted]")].map(code=>({language:code.dataset.codeHighlighted,text:code.textContent,line:Number(code.parentElement.dataset.sourceLine),tokens:[...code.querySelectorAll(".token")].map(node=>({text:node.textContent,classes:node.className})),colored:[...code.querySelectorAll(".token")].some(node=>getComputedStyle(node).color!==getComputedStyle(code).color)})),unknown:root.querySelector("code.language-uninstalled-language")?.textContent,unknownHighlighted:root.querySelector("code.language-uninstalled-language")?.hasAttribute("data-code-highlighted"),limit:root.querySelectorAll("code.language-python")[1]?.textContent,limitHighlighted:root.querySelectorAll("code.language-python")[1]?.hasAttribute("data-code-highlighted"),injected:root.querySelector("pre img,pre iframe,pre script")!==null}})()`);
    assert.equal(rendered.blocks.length, samples.length);
    for (const [index, sample] of samples.entries()) {
      const actual = rendered.blocks[index];
      assert.equal(actual.language, sample.language); assert.equal(actual.text, sample.source + "\n");
      assert.equal(actual.line, sourceLines[index]);
      assert.ok(actual.tokens.some(token => token.text === sample.token && token.classes.split(" ").includes(sample.kind)));
      assert.ok(actual.tokens.some(token => token.classes.includes("string")));
      assert.ok(actual.tokens.some(token => token.classes.includes("comment")));
      assert.equal(actual.colored, true, sample.language + " has an actual contrasting token color");
    }
    assert.equal(rendered.unknown, "Literal unsupported source λ\n"); assert.equal(rendered.unknownHighlighted, false);
    assert.equal(rendered.limit, limit + "\n"); assert.equal(rendered.limitHighlighted, false); assert.equal(rendered.injected, false);
    assert.deepEqual(await readFile(join(directory, path)), original);
    await capture?.("expanded-highlighting");
    pass(report, "Reading visibly highlights C/C++, C#, Java, Python, Rust, shell, PowerShell, YAML and SQL with exact source/token/source-line identities; unsupported/oversized fences stay plain, HTML-looking strings stay inert and physical BOM/CRLF bytes remain exact.");

    const staticText = "```csharp\n" + samples[0].source + "\n```\n\n```python\n" + samples[4].source + "\n```\n";
    await evaluate(`(async()=>{const api=app.plugins.modules.obsidian,owner=new api.Component(),host=document.createElement("div");host.dataset.expandedHighlightStatic="";document.body.append(host);await owner.load();globalThis.__expandedHighlightProbe={api,owner,host};await api.MarkdownRenderer.render(app,${q(staticText)},host,${q(path)},owner)})()`);
    const staticBlocks = await evaluate(`(()=>{const host=__expandedHighlightProbe.host;return {blocks:[...host.querySelectorAll("pre>code")].map(code=>({language:code.dataset.codeHighlighted,text:code.textContent,tokens:code.querySelectorAll(".token").length})),injected:host.querySelector("img,script,iframe")!==null}})()`);
    assert.deepEqual(staticBlocks.blocks.map(block => ({ language: block.language, text: block.text })), [{ language: "csharp", text: samples[0].source + "\n" }, { language: "python", text: samples[4].source + "\n" }]);
    assert.ok(staticBlocks.blocks.every(block => block.tokens > 3)); assert.equal(staticBlocks.injected, false);
    await evaluate('(async()=>{await __expandedHighlightProbe.owner.unloadAndWait();__expandedHighlightProbe.host.remove()})()');
    pass(report, "The public component-owned MarkdownRenderer waits for the additional C#/Python grammars, creates only inert highlighted code and drains its owner without modifying note text.");

    await evaluate(`(()=>{const state=__expandedHighlightProbe;state.processor=state.api.MarkdownPreviewRenderer.createCodeBlockPostProcessor("csharp",(source,element,context)=>{(state.received??=[]).push({source,section:context.getSectionInfo(element)});const output=document.createElement("output");output.dataset.expandedHighlightPlugin="";output.textContent=source;element.append(output)});state.api.MarkdownPreviewRenderer.registerPostProcessor(state.processor,10)})()`);
    await wait(`${preview}.querySelector("[data-expanded-highlight-plugin]")!==null&&${preview}.querySelector('pre>code.language-python')?.dataset.codeHighlighted==="python"`, "plugin keeps added C# language ownership beside other local grammars");
    assert.equal(await evaluate("__expandedHighlightProbe.received[0].source"), samples[0].source);
    assert.equal(await evaluate("__expandedHighlightProbe.received[0].section.lineStart"), sourceLines[0]);
    assert.equal(await evaluate(`Boolean(${csharp})`), false);
    await evaluate('__expandedHighlightProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__expandedHighlightProbe.processor);delete __expandedHighlightProbe.processor');
    await wait(`${highlighted}&&!${preview}.querySelector("[data-expanded-highlight-plugin]")`, "removing the registered processor restores C# highlighting");
    pass(report, "A real registered C# fenced-code processor receives exact source/section context and takes precedence while Python keeps its built-in grammar; unregistering restores the owned C# renderer.");

    await evaluate(`__expandedHighlightProbe.previous=${csharp}`);
    await writeFile(join(directory, path), Buffer.from("\ufeff" + text.replace("Count = 42;", "Count = 43;")));
    await wait(`${csharp}?.textContent.includes("Count = 43;")&&${csharp}?.dataset.codeHighlighted==="csharp"`, "external C# source receives fresh highlighted DOM");
    assert.equal(await evaluate("__expandedHighlightProbe.previous.isConnected"), false);
    await writeFile(join(directory, path), original);
    await wait(`${csharp}?.textContent.includes("Count = 42;")&&${highlighted}`, "exact external bytes restore all added language output");
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass(report, "Independent physical source changes replace the old highlighted C# node, refresh its tokens and restore exact BOM/CRLF source bytes without retaining stale renderer ownership.");

    await evaluate('delete globalThis.__expandedHighlightProbe;app.workspace.flushLayout()');
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${highlighted}`, "fresh host restores all added Reading code grammars");
    assert.equal(await evaluate(`${csharp}.textContent`), samples[0].source + "\n");
    assert.deepEqual(await readFile(join(directory, path)), original);
    report.expandedHighlighting = { languages: samples.map(sample => sample.language), exactSourceAndTokens: true, publicStaticRenderer: true, pluginPrecedence: true, externalRefresh: true, restart: true };
    pass(report, "A full native restart or fresh-document WASM reconnection restores Reading mode and all ten additional local grammars while retaining exact physical source and unsupported/oversized fallbacks.");
  } finally {
    await evaluate('(async()=>{const state=globalThis.__expandedHighlightProbe;if(state?.processor)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.processor);if(state?.owner)await state.owner.unloadAndWait();state?.host?.remove();delete globalThis.__expandedHighlightProbe})()');
    await writeFile(join(directory, path), original);
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent audits genuine cache-only blobs and network counters through local-vault return. */
export async function checkExpandedHighlightingReadOnly({ evaluate, wait, report }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const original = await evaluate("app.editor.getValue()"), mode = await evaluate("app.workspace.activeLeaf.view.getEditingMode()");
  try {
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("preview",false)');
    await wait('app.workspace.activeLeaf.view.previewEl.querySelector("code.language-csharp")?.dataset.codeHighlighted==="csharp"&&app.workspace.activeLeaf.view.previewEl.querySelector("code.language-python")?.dataset.codeHighlighted==="python"', "read-only C#/Python fences receive local highlighting");
    const output = await evaluate('(()=>{const root=app.workspace.activeLeaf.view.previewEl;return {blocks:[...root.querySelectorAll("pre>code[data-code-highlighted]")].map(code=>({language:code.dataset.codeHighlighted,text:code.textContent,tokens:code.querySelectorAll(".token").length})),injected:root.querySelector("pre img,pre iframe,pre script")!==null}})()');
    for (const language of ["csharp", "python"]) {
      const block = output.blocks.find(block => block.language === language);
      assert.ok(block?.text.includes('"readonly λ"')); assert.ok(block.tokens > 2);
    }
    assert.equal(output.injected, false); assert.equal(await evaluate("app.editor.getValue()"), original);
    report.expandedHighlighting = { ...(report.expandedHighlighting ?? {}), readOnly: true };
    pass(report, "A genuine cache-only read-only note highlights local C#/Python fences without injecting executable markup or changing any source text; the parent audits exact cached blobs and zero API/raw traffic.");
  } finally {
    await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false)`);
  }
}
