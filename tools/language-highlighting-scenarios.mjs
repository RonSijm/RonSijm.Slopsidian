import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const preview = "app.workspace.activeLeaf.view.previewEl";
const samples = [
  { language: "go", source: 'package main\nfunc note() string { count := 42; return "λ 😀 <img src=https://highlight-no-fetch.invalid/x onerror=alert(1)>" } // kept', tokens: [["package", "keyword"], ["func", "keyword"], ["42", "number"], ['"λ 😀 <img src=https://highlight-no-fetch.invalid/x onerror=alert(1)>"', "string"], ["// kept", "comment"]] },
  { language: "kotlin", source: 'fun note(): String { val count = 42; return "λ" } // kept', tokens: [["fun", "keyword"], ["String", "class-name"], ["42", "number"], ['"λ"', "string"], ["// kept", "comment"]] },
  { language: "swift", source: 'func note() -> String { let count = 42; return "λ" } // kept', tokens: [["func", "keyword"], ["String", "class-name"], ["42", "number"], ['"λ"', "string"], ["// kept", "comment"]] },
  { language: "ruby", source: 'def note\n  count = 42\n  return "λ" # kept\nend', tokens: [["def", "keyword"], ["42", "number"], ['"λ"', "string"], ["# kept", "comment"]] },
  { language: "lua", source: 'local function note()\n  return "λ", 42 -- kept\nend', tokens: [["function", "keyword"], ["42", "number"], ['"λ"', "string"], ["-- kept", "comment"]] },
  { language: "dockerfile", source: 'FROM alpine:3\nRUN ["echo", "λ"]\nEXPOSE 42\n# kept', tokens: [["FROM", "keyword"], ["RUN", "keyword"], ["42", "number"], ['"λ"', "string"], ["# kept", "comment"]] },
  { language: "ini", source: '[owner]\nname = "λ"\ncount = 42\n; kept', tokens: [["[owner]", "heading"], ["name ", "variable"], [' "λ"', "string"], [" 42", "string"], ["; kept", "comment"]] },
  { language: "toml", source: '[owner]\nname = "λ"\ncount = 42\nactive = true # kept', tokens: [["name", "property"], ["42", "number"], ['"λ"', "string"], ["true", "constant"], ["# kept", "comment"]] },
  { language: "diff", source: '--- a/note\n+++ b/note\n@@ -1 +1 @@\n-old λ\n+new 😀\n kept', tokens: [["@@ -1 +1 @@", "meta"], ["-old λ", "deleted"], ["+new 😀", "inserted"]] },
  { language: "xml", source: '<?xml version="1.0"?>\n<note count="42">λ &amp; 😀</note><!-- kept -->', tokens: [["<?xml", "meta"], ["note", "tag"], ["count", "attr-name"], ['"42"', "string"], ["&amp;", "constant"], ["<!-- kept -->", "comment"]] },
];

function inspect(root) {
  return `(()=>{const root=${root};return {blocks:[...root.querySelectorAll("pre>code[data-code-highlighted]")].map(code=>({language:code.dataset.codeHighlighted,text:code.textContent,line:Number(code.parentElement.dataset.sourceLine),tokens:[...code.querySelectorAll(".token")].map(node=>({text:node.textContent,classes:node.className})),colored:[...code.querySelectorAll(".token")].some(node=>getComputedStyle(node).color!==getComputedStyle(code).color)})),unknown:{text:root.querySelector("code.language-uninstalled-language")?.textContent,highlighted:root.querySelector("code.language-uninstalled-language")?.hasAttribute("data-code-highlighted")},plain:{text:root.querySelector("code.language-text")?.textContent,highlighted:root.querySelector("code.language-text")?.hasAttribute("data-code-highlighted")},limit:{text:[...root.querySelectorAll("code.language-go")].find(code=>code.textContent.length>65536)?.textContent,highlighted:[...root.querySelectorAll("code.language-go")].find(code=>code.textContent.length>65536)?.hasAttribute("data-code-highlighted")},injected:root.querySelector("pre img,pre iframe,pre script,pre svg")!==null}})()`;
}

function assertBlocks(actual, { sourceLines, colored = false } = {}) {
  assert.equal(actual.blocks.length, samples.length);
  for (const [index, sample] of samples.entries()) {
    const block = actual.blocks[index];
    assert.equal(block.language, sample.language); assert.equal(block.text, sample.source + "\n");
    if (sourceLines) { assert.equal(block.line, sourceLines[index]); }
    for (const [text, kind] of sample.tokens) {
      assert.ok(block.tokens.some(token => token.text === text && token.classes.split(" ").includes(kind)), `${sample.language}: actual ${kind} token ${text}`);
    }
    if (colored) { assert.equal(block.colored, true, sample.language + " has a contrasting theme color"); }
  }
  assert.equal(actual.injected, false);
}

/** Actual host rendering: independent physical bytes, public API, processor ownership and stale jobs. */
export async function checkLanguageHighlighting(tools) {
  const { directory, evaluate, command, wait, report, capture, restart, afterReload } = tools;
  const path = "Reading tools/More code languages.md", lines = ["# More local code languages", ""], sourceLines = [];
  for (const sample of samples) {
    sourceLines.push(lines.join("\n").split("\n").length);
    lines.push("```" + sample.language, sample.source, "```", "");
  }
  const limit = "x".repeat(65_537), literal = '<img src=https://highlight-no-fetch.invalid/plain onerror=alert(1)> λ';
  lines.push("```uninstalled-language", literal, "```", "", "```text", literal, "```", "", "```go", limit, "```", "");
  const text = lines.join("\n").replaceAll("\n", "\r\n"), original = Buffer.from("\ufeff" + text);
  const go = `${preview}.querySelector('pre>code.language-go')`;
  const highlighted = `${preview}.querySelectorAll('pre>code[data-code-highlighted]').length===${samples.length}`;
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  await mkdir(join(directory, "Reading tools"), { recursive: true });
  await writeFile(join(directory, path), original, { flag: "wx" });
  let failure;
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false)})()`);
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${highlighted}`, "all ten new local Reading grammars");
    const rendered = await evaluate(inspect(preview));
    assertBlocks(rendered, { sourceLines, colored: true });
    for (const key of ["unknown", "plain"]) { assert.equal(rendered[key].text, literal + "\n"); assert.equal(rendered[key].highlighted, false); }
    assert.equal(rendered.limit.text, limit + "\n"); assert.equal(rendered.limit.highlighted, false);
    assert.deepEqual(await readFile(join(directory, path)), original);
    await capture?.("language-highlighting");
    pass(report, "Reading visibly highlights Go, Kotlin, Swift, Ruby, Lua, Dockerfile, INI, TOML, diff additions/deletions and XML with exact text, semantic tokens and source lines; plain/unsupported/oversized code stays inert and physical BOM/CRLF bytes stay exact.");

    const staticText = samples.map(sample => "```" + sample.language + "\n" + sample.source + "\n```\n").join("\n");
    await evaluate(`(async()=>{const api=app.plugins.modules.obsidian,owner=new api.Component(),host=document.createElement("div");host.dataset.languageHighlightStatic="";document.body.append(host);await owner.load();globalThis.__languageHighlightProbe={api,owner,host};await api.MarkdownRenderer.render(app,${q(staticText)},host,${q(path)},owner)})()`);
    assertBlocks(await evaluate(inspect("__languageHighlightProbe.host")));
    await evaluate('(async()=>{await __languageHighlightProbe.owner.unloadAndWait();__languageHighlightProbe.host.remove()})()');
    pass(report, "The public component-owned MarkdownRenderer waits for all ten additional grammars, emits distinct inert tokens and drains its owner without changing note source.");

    await evaluate(`(()=>{const state=__languageHighlightProbe;state.processor=state.api.MarkdownPreviewRenderer.createCodeBlockPostProcessor("go",(source,element,context)=>{(state.received??=[]).push({source,section:context.getSectionInfo(element)});const output=document.createElement("output");output.dataset.languageHighlightPlugin="";output.textContent=source;element.append(output)});state.api.MarkdownPreviewRenderer.registerPostProcessor(state.processor,10)})()`);
    await wait(`${preview}.querySelector("[data-language-highlight-plugin]")!==null&&${preview}.querySelector('pre>code.language-toml')?.dataset.codeHighlighted==="toml"`, "a registered Go processor retains fenced-code ownership");
    assert.equal(await evaluate("__languageHighlightProbe.received[0].source"), samples[0].source);
    assert.equal(await evaluate("__languageHighlightProbe.received[0].section.lineStart"), sourceLines[0]);
    assert.equal(await evaluate(`${go}?.textContent.length<65536`), false);
    await evaluate('__languageHighlightProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__languageHighlightProbe.processor);delete __languageHighlightProbe.processor');
    await wait(`${highlighted}&&!${preview}.querySelector("[data-language-highlight-plugin]")`, "unregistering restores the Go grammar");
    pass(report, "A real registered Go code processor receives exact source and section context, owns its output while TOML keeps built-in highlighting, and unregisters cleanly back to the Go renderer.");

    // Hold a real postprocessor before decoration. A physical watcher update
    // must replace the view while this original generation is still pending.
    await evaluate(`(()=>{const state=__languageHighlightProbe;state.blocking=(root,context)=>{const code=root.querySelector("code.language-go");if(context.sourcePath!==${q(path)}||state.held||!code?.textContent.includes("count := 42;"))return;state.held={code,root};return new Promise(resolve=>state.resume=resolve).then(()=>{state.resumed=true})};state.api.MarkdownPreviewRenderer.registerPostProcessor(state.blocking,0)})()`);
    await wait('Boolean(globalThis.__languageHighlightProbe?.resume)', "original Go generation waits on a real pending postprocessor");
    assert.equal(await evaluate("__languageHighlightProbe.held.code.hasAttribute('data-code-highlighted')"), false);
    await writeFile(join(directory, path), Buffer.from("\ufeff" + text.replace("count := 42;", "count := 43;")));
    await wait(`${go}?.textContent.includes("count := 43;")&&${go}?.dataset.codeHighlighted==="go"&&${highlighted}`, "independent physical changes supersede the pending code job");
    assert.equal(await evaluate("__languageHighlightProbe.held.code.isConnected"), false);
    assert.equal(await evaluate(`[...${go}.querySelectorAll('.token.number')].some(node=>node.textContent==="43")`), true);
    await evaluate('__languageHighlightProbe.resume();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.equal(await evaluate("__languageHighlightProbe.resumed"), true);
    assert.equal(await evaluate("__languageHighlightProbe.held.code.hasAttribute('data-code-highlighted')"), false);
    assert.equal(await evaluate(`${go}.textContent.includes("count := 43;")`), true);
    await evaluate('__languageHighlightProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__languageHighlightProbe.blocking);delete __languageHighlightProbe.blocking');
    await writeFile(join(directory, path), original);
    await wait(`${go}?.textContent.includes("count := 42;")&&${highlighted}`, "physical BOM/CRLF restoration receives fresh token output");
    assertBlocks(await evaluate(inspect(preview)), { sourceLines, colored: true });
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass(report, "An independent physical edit replaces a genuinely pending code-render generation and highlights the new Go number; resuming the obsolete postprocessor never decorates its detached code or replaces current output, and original BOM/CRLF bytes restore exactly.");

    await evaluate('(async()=>{delete globalThis.__languageHighlightProbe;await app.workspace.flushLayout()})()');
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${highlighted}`, "fresh host restores all ten additional Reading grammars");
    const restored = await evaluate(inspect(preview));
    assertBlocks(restored, { sourceLines, colored: true });
    for (const key of ["unknown", "plain"]) { assert.equal(restored[key].text, literal + "\n"); assert.equal(restored[key].highlighted, false); }
    assert.equal(restored.limit.text, limit + "\n"); assert.equal(restored.limit.highlighted, false);
    assert.deepEqual(await readFile(join(directory, path)), original);
    report.languageHighlighting = { languages: samples.map(sample => sample.language), exactSourceAndTokens: true, sourceLines: true, inertMarkup: true, plainFallbacks: true, publicStaticRenderer: true, pluginPrecedence: true, externalRefresh: true, staleJobs: true, restart: true };
    pass(report, "A full native restart or fresh-document WASM reconnection restores Reading and all ten local grammars, exact physical source, distinct tokens and inert unsupported/plain/oversized fallbacks.");
  } catch (error) {
    failure = error;
    try { report.languageHighlightingFailure = await evaluate(`({path:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode?.(),state:${inspect(preview)}})`); } catch {}
    try { await capture?.("language-highlighting-failure"); } catch {}
    throw error;
  } finally {
    const cleanup = [];
    try { await evaluate('(async()=>{const state=globalThis.__languageHighlightProbe;state?.resume?.();if(state?.processor)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.processor);if(state?.blocking)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.blocking);if(state?.owner)await state.owner.unloadAndWait();state?.host?.remove();delete globalThis.__languageHighlightProbe})()'); } catch (error) { cleanup.push(error); }
    try { await writeFile(join(directory, path), original); } catch (error) { cleanup.push(error); }
    try { await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) { throw new AggregateError(cleanup, "Could not restore the language highlighting fixture."); }
  }
}

/** Parent audits genuine cached blobs and API/raw counters through local-vault return. */
export async function checkLanguageHighlightingReadOnly({ evaluate, wait, report }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('app.openFile("Read only.md")');
  const original = await evaluate("app.editor.getValue()"), mode = await evaluate("app.workspace.activeLeaf.view.getEditingMode()");
  const expected = [
    { language: "go", source: 'package main\nfunc note() string { return "readonly λ" }', tokens: [["func", "keyword"], ['"readonly λ"', "string"]] },
    { language: "toml", source: '[owner]\nname = "readonly λ"\ncount = 42 # kept', tokens: [["name", "property"], ['"readonly λ"', "string"], ["42", "number"]] },
    { language: "xml", source: '<root name="readonly λ"><note>kept</note></root><!-- kept -->', tokens: [["root", "tag"], ["name", "attr-name"], ['"readonly λ"', "string"], ["<!-- kept -->", "comment"]] },
  ];
  try {
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("preview",false)');
    await wait(expected.map(sample => `${preview}.querySelector("code.language-${sample.language}")?.dataset.codeHighlighted===${q(sample.language)}`).join("&&"), "cached read-only Go, TOML and XML fences receive local highlighting");
    const output = await evaluate(inspect(preview));
    for (const sample of expected) {
      const block = output.blocks.find(block => block.language === sample.language);
      assert.equal(block?.text, sample.source + "\n");
      for (const [text, kind] of sample.tokens) { assert.ok(block.tokens.some(token => token.text === text && token.classes.split(" ").includes(kind))); }
      assert.equal(block.colored, true);
    }
    assert.equal(output.injected, false); assert.equal(await evaluate("app.editor.getValue()"), original);
    report.languageHighlighting = { ...(report.languageHighlighting ?? {}), readOnly: true, readOnlyLanguages: expected.map(sample => sample.language) };
    pass(report, "A genuine cache-only read-only note highlights exact Go/TOML/XML source with real keyword/property/tag tokens and theme colors, without source changes or executable markup; the parent audits unchanged cached blobs and zero API/raw traffic.");
  } finally {
    await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false)`);
  }
}
