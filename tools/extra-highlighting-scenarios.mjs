import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const preview = "app.workspace.activeLeaf.view.previewEl";
const samples = [
  { language: "dart", source: 'class Note { String text = "λ 😀 <img src=https://extra-highlight-no-fetch.invalid/x onerror=alert(1)>"; int count = 42; } // kept', tokens: [["class", "keyword"], ["Note", "class-name"], ["42", "number"], ['"λ 😀 <img src=https://extra-highlight-no-fetch.invalid/x onerror=alert(1)>"', "string"], ["// kept", "comment"]] },
  { language: "clojure", source: '(defn note [] (if true "λ 😀" 42)) ; kept', tokens: [["defn", "keyword"], ["if", "keyword"], ["true", "constant"], ['"λ 😀"', "string"], ["42", "number"], ["; kept", "comment"]] },
  { language: "haskell", source: 'module Note where\nnote = if True then "λ 😀" else "kept"\ncount = 42 -- kept', tokens: [["module", "keyword"], ["Note", "class-name"], ["where", "keyword"], ['"λ 😀"', "string"], ["42", "number"], ["-- kept", "comment"]] },
  { language: "r", source: 'note <- function() { value <- 42; "λ 😀" } # kept', tokens: [["<-", "operator"], ["function", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { language: "perl", source: 'sub note { my $value = 42; return "λ 😀"; } # kept', tokens: [["sub", "keyword"], ["$value", "variable"], ["42", "number"], ["return", "keyword"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { language: "erlang", source: '-module(note).\nnote() -> case true of true -> {42, "λ 😀"} end. % kept', tokens: [["-module", "attr-name"], ["case", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["end", "keyword"], ["% kept", "comment"]] },
  { language: "scala", source: 'object Note { val count: Int = 42; val text = "λ 😀" } // kept', tokens: [["object", "keyword"], ["Int", "class-name"], ["42", "number"], ['"λ 😀"', "string"], ["// kept", "comment"]] },
  { language: "cmake", source: 'set(NAME "λ 😀")\nif(DEFINED NAME)\n  message(STATUS "${NAME}")\nendif()\n# kept', tokens: [["set", "variable"], ['"λ 😀"', "string"], ["${NAME}", "variable"], ["# kept", "comment"]] },
  { language: "nginx", source: 'server {\n  listen 8080;\n  server_name "λ.example";\n  return 200 "λ 😀"; # kept\n}', tokens: [["server", "keyword"], ["server_name", "keyword"], ['"λ.example"', "string"], ["return", "keyword"], ["200 ", "number"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { language: "objectivec", source: '@interface Note : NSObject\n@end\nint main(void) { NSString *name = @"λ 😀"; return 42; } // kept', tokens: [["@interface", "keyword"], ["@end", "keyword"], ["void", "class-name"], ['"λ 😀"', "string"], ["return", "keyword"], ["42", "number"], ["// kept", "comment"]] },
  { language: "julia", alias: "JL", source: 'function note()\n return "λ 😀", 42 # kept\nend', tokens: [["function", "keyword"], ["return", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["# kept", "comment"]] },
  { language: "groovy", alias: "GVY", source: 'class Note { def text = "λ 😀"; return 42 } // kept', tokens: [["class", "keyword"], ["return", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["// kept", "comment"]] },
  { language: "pascal", alias: "PAS", source: "begin\n value := 42; text := 'λ 😀'; { kept }\nend", tokens: [["begin", "keyword"], ["42", "number"], ["'λ 😀'", "string"], ["{ kept }", "comment"]] },
  { language: "vb", alias: "VBNET", source: 'Dim text As String = "λ 😀"\nReturn 42 \' kept', tokens: [["Dim", "keyword"], ["Return", "keyword"], ["42", "number"], ['"λ 😀"', "string"], ["' kept", "comment"]] },
];
const followupSamples = samples.filter(sample => sample.alias);
const readonlySamples = [
  { language: "dart", source: 'class Note { String text = "readonly λ 😀"; int count = 42; } // kept', tokens: [["class", "keyword"], ['"readonly λ 😀"', "string"], ["42", "number"]] },
  { language: "clojure", source: '(defn note [] (if true "readonly λ 😀" 42)) ; kept', tokens: [["defn", "keyword"], ["true", "constant"], ['"readonly λ 😀"', "string"], ["42", "number"]] },
  { language: "cmake", source: 'set(NAME "readonly λ 😀")\nif(DEFINED NAME)\n  message(STATUS "${NAME}")\nendif()\n# kept', tokens: [["set", "variable"], ['"readonly λ 😀"', "string"], ["${NAME}", "variable"], ["# kept", "comment"]] },
  { language: "objectivec", source: '@interface Note : NSObject\n@end\nint note(void) { NSString *text = @"readonly λ 😀"; return 42; } // kept', tokens: [["@interface", "keyword"], ["@end", "keyword"], ['"readonly λ 😀"', "string"], ["return", "keyword"], ["42", "number"]] },
  ...followupSamples.map(sample => ({ ...sample, source: sample.source.replace("λ 😀", "readonly λ 😀"), tokens: sample.tokens.map(([text, kind]) => [text.replace("λ 😀", "readonly λ 😀"), kind]) })),
];

/** Shared cached fixture bytes; callers must install this through the real cache. */
export function readOnlyExtraHighlightingMarkdown() {
  return ["# Extra read-only code languages", "", ...readonlySamples.flatMap(sample => ["```" + sample.language, sample.source, "```", ""])].join("\n");
}

/** Real DOM inspection, also exercised against semantic fixtures before host runs. */
export function inspectExtraHighlighting(root) {
  return `(()=>{const root=${root};return {blocks:[...root.querySelectorAll("pre>code[data-code-highlighted]")].map(code=>({language:code.dataset.codeHighlighted,text:code.textContent,glyphs:code.innerText,line:Number(code.parentElement.dataset.sourceLine),tokens:[...code.querySelectorAll(".token")].map(node=>({text:node.textContent,classes:node.className})),colored:[...code.querySelectorAll(".token")].some(node=>getComputedStyle(node).color!==getComputedStyle(code).color),color:getComputedStyle(code.querySelector(".token.keyword,.token.string,.token.comment")??code).color})),unknown:{text:root.querySelector("code.language-php")?.textContent,highlighted:root.querySelector("code.language-php")?.hasAttribute("data-code-highlighted")},plain:{text:root.querySelector("code.language-text")?.textContent,highlighted:root.querySelector("code.language-text")?.hasAttribute("data-code-highlighted")},limit:{text:[...root.querySelectorAll("code.language-dart")].find(code=>code.textContent.length>65536)?.textContent,highlighted:[...root.querySelectorAll("code.language-dart")].find(code=>code.textContent.length>65536)?.hasAttribute("data-code-highlighted")},injected:root.querySelector("pre img,pre iframe,pre script,pre svg")!==null}})()`;
}
const inspect = inspectExtraHighlighting;

export function assertExtraHighlightingBlocks(actual, { expected = samples, sourceLines, colored = false } = {}) {
  assert.equal(actual.blocks.length, expected.length);
  for (const [index, sample] of expected.entries()) {
    const block = actual.blocks[index];
    assert.equal(block.language, sample.language); assert.equal(block.text, sample.source + "\n");
    assert.equal(block.glyphs, sample.source + "\n", sample.language + " preserves actual rendered glyph text");
    if (sourceLines) { assert.equal(block.line, sourceLines[index]); }
    for (const [text, kind] of sample.tokens) {
      assert.ok(block.tokens.some(token => token.text === text && token.classes.split(" ").includes(kind)), `${sample.language}: actual ${kind} token ${text}`);
    }
    if (colored) { assert.equal(block.colored, true, sample.language + " has a contrasting theme color"); }
  }
  assert.equal(actual.injected, false);
}
const assertBlocks = assertExtraHighlightingBlocks;

async function assertSource({ evaluate, wait }, text, fixtureSamples, sourceLines) {
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getEditingMode()"), "source");
  assert.equal(await evaluate("app.editor.getValue()"), text);
  assert.equal(await evaluate('app.editor.cm.contentDOM.querySelector("[data-code-highlighted],.token")===null'), true);
  for (const [index, sample] of fixtureSamples.entries()) {
    if (!sample.alias) { continue; }
    const offset = sample.source.split("\n").findIndex(line => line.includes("λ 😀"));
    const line = sourceLines[index] + 1 + offset, glyphs = sample.source.split("\n")[offset];
    await evaluate(`app.editor.scrollIntoView({from:{line:${line},ch:0},to:{line:${line},ch:${glyphs.length}}},true)`);
    await wait(`[...app.editor.cm.contentDOM.querySelectorAll(".cm-line")].some(line=>line.textContent===${q(glyphs)}&&line.getBoundingClientRect().height>0)`, sample.language + " Source shows exact Unicode glyphs");
  }
  assert.equal(await evaluate("app.editor.getValue()"), text);
}

async function revealFollowup({ evaluate, wait }, mode = "preview", fixtureSamples = samples, sourceLines) {
  if (mode === "source") {
    const index = fixtureSamples.findIndex(sample => sample.language === "julia"), line = sourceLines[index];
    await evaluate(`app.editor.scrollIntoView({from:{line:${line},ch:0},to:{line:${line + 15},ch:0}})`);
    await wait('[...app.editor.cm.contentDOM.querySelectorAll(".cm-line")].some(line=>line.textContent==="```julia")', "Source includes the four follow-up grammars");
  } else {
    await evaluate(`${preview}.querySelector("code.language-julia").parentElement.scrollIntoView({block:"start"})`);
  }
}

// A faulty component teardown must fail this scenario within a bounded time.
const unloadOwner = `async owner=>{let timer;try{await Promise.race([owner.unloadAndWait(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error("Extra highlighting owner teardown timed out")),5000))])}finally{clearTimeout(timer)}}`;

async function selectTheme({ evaluate, click, press, wait }, value) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
  await click("#appearance-tab");
  const selector = "[data-appearance-settings] [data-setting-key=theme] select";
  await wait(`document.querySelector(${q(selector)})`, "actual Appearance theme dropdown");
  const index = await evaluate(`Array.from(document.querySelector(${q(selector)}).options).findIndex(option=>option.value===${q(value)})`);
  assert.ok(index >= 0, "Actual Appearance theme option " + value);
  const focused = `document.activeElement===document.querySelector(${q(selector)})`;
  for (let attempt = 0; attempt < 64 && !await evaluate(focused); attempt++) { await press("Tab", "Tab", 9); }
  assert.equal(await evaluate(focused), true, "Tab reaches the actual closed Appearance select");
  await press("Home", "Home", 36);
  for (let step = 0; step < index; step++) { await press("ArrowDown", "ArrowDown", 40); }
  await wait(`document.querySelector(${q(selector)}).value===${q(value)}`, "actual theme select change");
  await evaluate("app.appearance.whenIdle()");
  await wait(`app.appearance.getControlValue("theme")===${q(value)}`, "persisted theme change");
  await click(".settings-close");
  if (value !== "system") { await wait(`document.body.classList.contains(${q(value === "obsidian" ? "theme-dark" : "theme-light")})`, "applied theme class"); }
}

/** Isolated physical source, public rendering, plugin ownership and actual theme controls. */
export async function checkExtraHighlighting(tools) {
  const { directory, evaluate, command, wait, report, capture, restart, afterReload } = tools;
  const folder = "Reading extra languages", path = folder + "/Extra code languages.md";
  const lines = ["# Extra local code languages", ""], sourceLines = [];
  for (const sample of samples) {
    sourceLines.push(lines.join("\n").split("\n").length);
    lines.push("```" + sample.language, sample.source, "```", "");
  }
  const limit = "x".repeat(65_537), literal = '<img src=https://extra-highlight-no-fetch.invalid/plain onerror=alert(1)> λ 😀';
  lines.push("```php", literal, "```", "", "```text", literal, "```", "", "```dart", limit, "```", "");
  const text = lines.join("\n").replaceAll("\n", "\r\n"), original = Buffer.from("\ufeff" + text);
  const dart = `${preview}.querySelector('pre>code.language-dart')`;
  const highlighted = `${preview}.querySelectorAll('pre>code[data-code-highlighted]').length===${samples.length}`;
  const preferencesPath = join(directory, ".obsidian", "appearance.json");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout();await app.appearance.whenIdle()})()");
  const preferences = await readFile(preferencesPath).catch(error => { if (error.code === "ENOENT") { return null; } throw error; });
  const layout = await evaluate("app.workspace.getLayout()"), originalTheme = await evaluate('app.appearance.getControlValue("theme")');
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, path), original, { flag: "wx" });
  let failure, stage = "open", themeTouched = false;
  const assertFallbacks = output => {
    for (const key of ["unknown", "plain"]) { assert.equal(output[key].text, literal + "\n"); assert.equal(output[key].highlighted, false); }
    assert.equal(output.limit.text, limit + "\n"); assert.equal(output.limit.highlighted, false);
  };
  try {
    stage = "Source";
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source",false)})()`);
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="source"`, "unchanged physical Source fixture");
    await assertSource(tools, text, samples, sourceLines);
    await revealFollowup(tools, "source", samples, sourceLines);
    assert.deepEqual(await readFile(join(directory, path)), original);
    await capture?.("extra-highlighting-source");
    pass(report, "Source retains the complete BOM/CRLF fixture and exact Julia/Groovy/Pascal/Visual Basic Unicode glyphs without Reading token spans or source edits.");

    stage = "Reading";
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("preview",false)');
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${highlighted}`, `${samples.length} extra local Reading grammars`);
    const rendered = await evaluate(inspect(preview));
    assertBlocks(rendered, { sourceLines, colored: true }); assertFallbacks(rendered);
    assert.deepEqual(await readFile(join(directory, path)), original);
    await capture?.("extra-highlighting");
    await revealFollowup(tools);
    await capture?.("extra-highlighting-followup");
    pass(report, `Reading highlights all ${samples.length} extra grammars including Julia, Groovy, Pascal and Visual Basic with exact Unicode source/glyphs, semantic tokens, source lines and theme colors; PHP/plain/oversized fences remain inert and BOM/CRLF bytes stay exact.`);

    stage = "public renderer";
    const staticMarkdown = aliases => samples.map(sample => "```" + (aliases && sample.alias ? sample.alias + " title=runtime" : sample.language) + "\n" + sample.source + "\n```\n").join("\n");
    const staticText = staticMarkdown(true);
    await evaluate(`(async()=>{const api=app.plugins.modules.obsidian,owner=new api.Component(),host=document.createElement("div");host.dataset.extraHighlightStatic="";document.body.append(host);globalThis.__extraHighlightProbe={api,owner,host};await owner.load();await api.MarkdownRenderer.render(app,${q(staticText)},host,${q(path)},owner)})()`);
    assertBlocks(await evaluate(inspect("__extraHighlightProbe.host")));
    await evaluate(`(async()=>{await (${unloadOwner})(__extraHighlightProbe.owner);__extraHighlightProbe.host.remove()})()`);
    pass(report, `The public component-owned MarkdownRenderer waits for all ${samples.length} extra grammars, accepts uppercase JL/GVY/PAS/VBNET info-string aliases, emits distinct inert tokens and drains its component without altering note source.`);

    stage = "fenced processor";
    const processorSamples = [samples[0], ...followupSamples], processorLanguages = processorSamples.map(sample => sample.language);
    await evaluate(`(()=>{const state=__extraHighlightProbe;state.processors=${q(processorLanguages)}.map(language=>{const processor=state.api.MarkdownPreviewRenderer.createCodeBlockPostProcessor(language,(source,element,context)=>{(state.received??=[]).push({language,source,section:context.getSectionInfo(element)});const output=document.createElement("output");output.dataset.extraHighlightPlugin=language;output.textContent=source;element.append(output)});state.api.MarkdownPreviewRenderer.registerPostProcessor(processor,10);return processor})})()`);
    await wait(processorLanguages.map(language => `${preview}.querySelector('[data-extra-highlight-plugin="${language}"]')!==null`).join("&&") + `&&${preview}.querySelector('pre>code.language-clojure')?.dataset.codeHighlighted==="clojure"`, "real Dart and follow-up fenced processors own their output");
    for (const sample of processorSamples) {
      assert.equal(await evaluate(`__extraHighlightProbe.received.find(item=>item.language===${q(sample.language)}).source`), sample.source);
      assert.equal(await evaluate(`__extraHighlightProbe.received.find(item=>item.language===${q(sample.language)}).section.lineStart`), sourceLines[samples.indexOf(sample)]);
      assert.equal(await evaluate(`${preview}.querySelector('[data-extra-highlight-plugin="${sample.language}"]').textContent`), sample.source);
      assert.equal(await evaluate(`${preview}.querySelector('pre>code.language-${sample.language}[data-code-highlighted]')===null`), true);
    }
    assert.equal(await evaluate(`${dart}?.textContent.length<65536`), false);
    await evaluate(`(async()=>{const state=__extraHighlightProbe;state.precedenceOwner=new state.api.Component();state.precedenceHost=document.createElement("div");document.body.append(state.precedenceHost);await state.precedenceOwner.load();await state.api.MarkdownRenderer.render(app,${q(staticMarkdown(false))},state.precedenceHost,${q(path)},state.precedenceOwner)})()`);
    assertBlocks(await evaluate(inspect("__extraHighlightProbe.precedenceHost")), { expected: samples.filter(sample => !processorLanguages.includes(sample.language)) });
    assert.equal(await evaluate('__extraHighlightProbe.precedenceHost.querySelectorAll("[data-extra-highlight-plugin]").length'), processorSamples.length);
    for (const sample of processorSamples) {
      assert.equal(await evaluate(`__extraHighlightProbe.precedenceHost.querySelector('[data-extra-highlight-plugin="${sample.language}"]').textContent`), sample.source);
    }
    await evaluate(`(async()=>{const state=__extraHighlightProbe;await (${unloadOwner})(state.precedenceOwner);state.precedenceHost.remove();for(const processor of state.processors)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(processor);delete state.processors})()`);
    await wait(`${highlighted}&&!${preview}.querySelector("[data-extra-highlight-plugin]")`, "unregistering restores Dart highlighting");
    assertBlocks(await evaluate(inspect(preview)), { sourceLines, colored: true });
    pass(report, "Real registered Dart/Julia/Groovy/Pascal/Visual Basic processors receive exact source and Reading section context and own their Reading and public static output while Clojure stays highlighted; unregistering restores every built-in grammar.");

    stage = "pending physical refresh";
    const pendingSelector = followupSamples.map(sample => "code.language-" + sample.language).join(",");
    await evaluate(`(()=>{const state=__extraHighlightProbe;state.blocking=(root,context)=>{const code=root.querySelector("code.language-dart");if(context.sourcePath!==${q(path)}||state.held||!code?.textContent.includes("count = 42;"))return;state.held={code,root,followup:[...root.querySelectorAll(${q(pendingSelector)})]};return new Promise(resolve=>state.resume=resolve).then(()=>{state.resumed=true})};state.api.MarkdownPreviewRenderer.registerPostProcessor(state.blocking,0)})()`);
    await wait('Boolean(globalThis.__extraHighlightProbe?.resume)', "a real pending postprocessor holds the first Dart render");
    assert.equal(await evaluate("__extraHighlightProbe.held.code.hasAttribute('data-code-highlighted')"), false);
    assert.equal(await evaluate("__extraHighlightProbe.held.followup.length"), followupSamples.length);
    assert.equal(await evaluate('__extraHighlightProbe.held.followup.every(code=>!code.hasAttribute("data-code-highlighted"))'), true);
    let changed = text.replace("count = 42;", "count = 43;");
    for (const sample of followupSamples) { changed = changed.replace(sample.source.replaceAll("\n", "\r\n"), sample.source.replaceAll("\n", "\r\n").replace("42", "43")); }
    await writeFile(join(directory, path), Buffer.from("\ufeff" + changed));
    await wait(`${dart}?.textContent.includes("count = 43;")&&${dart}?.dataset.codeHighlighted==="dart"&&${highlighted}`, "physical edits supersede the pending Dart generation");
    assert.equal(await evaluate("__extraHighlightProbe.held.code.isConnected"), false);
    assert.equal(await evaluate('__extraHighlightProbe.held.followup.every(code=>!code.isConnected)'), true);
    assert.equal(await evaluate(`[...${dart}.querySelectorAll('.token.number')].some(node=>node.textContent==="43")`), true);
    for (const sample of followupSamples) {
      assert.equal(await evaluate(`[...${preview}.querySelector('code.language-${sample.language}').querySelectorAll('.token.number')].some(node=>node.textContent==="43")`), true);
    }
    await evaluate('__extraHighlightProbe.resume();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.equal(await evaluate("__extraHighlightProbe.resumed"), true);
    assert.equal(await evaluate("__extraHighlightProbe.held.code.hasAttribute('data-code-highlighted')"), false);
    assert.equal(await evaluate('__extraHighlightProbe.held.followup.every(code=>!code.hasAttribute("data-code-highlighted"))'), true);
    assert.equal(await evaluate(`${dart}.textContent.includes("count = 43;")`), true);
    await evaluate('__extraHighlightProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__extraHighlightProbe.blocking);delete __extraHighlightProbe.blocking');
    await writeFile(join(directory, path), original);
    await wait(`${dart}?.textContent.includes("count = 42;")&&${highlighted}`, "original BOM/CRLF restoration highlights fresh code");
    assertBlocks(await evaluate(inspect(preview)), { sourceLines, colored: true });
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass(report, "An independent physical edit replaces genuinely pending Dart/Julia/Groovy/Pascal/Visual Basic code with new number tokens; resuming the detached job never decorates old code or replaces current output, and original BOM/CRLF bytes restore exactly.");

    stage = "pending owner retirement";
    await evaluate(`(()=>{const state=__extraHighlightProbe;state.retiring=(root,context)=>{if(context.sourcePath!==${q(path)}||state.retired)return;state.retired={codes:[...root.querySelectorAll(${q(pendingSelector)})]};return new Promise(resolve=>state.releaseRetired=resolve).then(()=>{state.retired.finished=true})};state.api.MarkdownPreviewRenderer.registerPostProcessor(state.retiring,0)})()`);
    await wait('Boolean(globalThis.__extraHighlightProbe?.releaseRetired)', "a real pending owner contains all four follow-up grammars");
    assert.equal(await evaluate('__extraHighlightProbe.retired.codes.length'), followupSamples.length);
    assert.equal(await evaluate('__extraHighlightProbe.retired.codes.every(code=>!code.hasAttribute("data-code-highlighted"))'), true);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)');
    await wait('__extraHighlightProbe.retired.codes.every(code=>!code.isConnected)', "Source retires the pending Reading owner");
    await assertSource(tools, text, samples, sourceLines);
    await evaluate('__extraHighlightProbe.releaseRetired();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.equal(await evaluate('__extraHighlightProbe.retired.finished===true&&__extraHighlightProbe.retired.codes.every(code=>!code.isConnected&&!code.hasAttribute("data-code-highlighted"))'), true);
    await revealFollowup(tools, "source", samples, sourceLines);
    await capture?.("extra-highlighting-owner-retired");
    await evaluate('__extraHighlightProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__extraHighlightProbe.retiring);delete __extraHighlightProbe.retiring;app.workspace.activeLeaf.view.setEditingMode("preview",false)');
    await wait(highlighted, "a fresh Reading owner highlights all four retired grammar targets");
    assertBlocks(await evaluate(inspect(preview)), { sourceLines, colored: true });
    assert.deepEqual(await readFile(join(directory, path)), original);
    await revealFollowup(tools);
    pass(report, "Switching to Source retires a genuinely pending Reading owner for Julia/Groovy/Pascal/Visual Basic; releasing its late processor decorates no detached target, Source stays exact, and a fresh Reading owner restores all grammars.");

    stage = "actual theme controls";
    await evaluate(`(()=>{const state=__extraHighlightProbe;state.retained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection,codes:[...${preview}.querySelectorAll('pre>code[data-code-highlighted]')]};return true})()`);
    themeTouched = true;
    await selectTheme(tools, "obsidian");
    const dark = await evaluate(inspect(preview)); assertBlocks(dark, { sourceLines, colored: true });
    await capture?.("extra-highlighting-dark");
    await selectTheme(tools, "moonstone");
    const light = await evaluate(inspect(preview)); assertBlocks(light, { sourceLines, colored: true });
    for (let index = 0; index < samples.length; index++) { assert.notEqual(dark.blocks[index].color, light.blocks[index].color, samples[index].language + " changes its actual token color"); }
    assert.equal(await evaluate(`(()=>{const state=__extraHighlightProbe.retained,current=[...${preview}.querySelectorAll('pre>code[data-code-highlighted]')];return app.editor===state.editor&&app.editor.cm===state.cm&&app.editor.cm.state.doc===state.doc&&app.editor.cm.state.selection.eq(state.selection)&&current.length===state.codes.length&&current.every((code,index)=>code===state.codes[index])})()`), true);
    assert.deepEqual(await readFile(join(directory, path)), original);
    await capture?.("extra-highlighting-light");
    await selectTheme(tools, originalTheme);
    pass(report, "Actual Appearance dropdown controls switch every extra grammar between distinct dark/light token colors while preserving code nodes, editor/document/selection and physical source; the original mode is restored.");

    stage = "full restart";
    await evaluate('(async()=>{delete globalThis.__extraHighlightProbe;await app.workspace.flushLayout()})()');
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${highlighted}`, `fresh host restores all ${samples.length} extra Reading grammars`);
    const restored = await evaluate(inspect(preview));
    assertBlocks(restored, { sourceLines, colored: true }); assertFallbacks(restored);
    assert.deepEqual(await readFile(join(directory, path)), original);
    assert.equal(await evaluate("app.editor.getValue()"), text);
    await revealFollowup(tools);
    await capture?.("extra-highlighting-restored");
    report.extraHighlighting = { languages: samples.map(sample => sample.language), followupLanguages: followupSamples.map(sample => sample.language), sourceModeExact: true, sourceGlyphs: true, readingGlyphs: true, exactSourceAndTokens: true, sourceLines: true, inertMarkup: true, plainFallbacks: true, publicStaticRenderer: true, publicStaticAliases: true, pluginPrecedence: true, staticPluginPrecedence: true, externalRefresh: true, staleJobs: true, pendingOwnerRetirement: true, themeControls: true, themeColorsChanged: true, editorAndCodeOwnersRetained: true, restart: true };
    pass(report, `A full native restart or fresh-document WASM reconnection restores Reading and all ${samples.length} extra grammars with exact physical/editor source, semantic tokens, glyphs, colors and inert unsupported/plain/oversized fallbacks.`);
  } catch (error) {
    failure = error;
    try { report.extraHighlightingFailure = { stage, ...await evaluate(`({path:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode?.(),state:${inspect(preview)}})`) }; } catch (diagnostic) { report.extraHighlightingFailure = { stage, diagnostic: String(diagnostic) }; }
    try { await capture?.("extra-highlighting-failure"); } catch { /* Preserve the actual assertion failure. */ }
    throw error;
  } finally {
    const cleanup = [];
    try { await evaluate(`(async()=>{const state=globalThis.__extraHighlightProbe;state?.resume?.();state?.releaseRetired?.();for(const processor of state?.processors??[])state.api.MarkdownPreviewRenderer.unregisterPostProcessor(processor);if(state?.blocking)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.blocking);if(state?.retiring)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.retiring);if(state?.owner)await (${unloadOwner})(state.owner);if(state?.precedenceOwner)await (${unloadOwner})(state.precedenceOwner);state?.host?.remove();state?.precedenceHost?.remove();delete globalThis.__extraHighlightProbe;if(document.querySelector("#settings-dialog").open)document.querySelector(".settings-close").click();await app.appearance.whenIdle()})()`); } catch (error) { cleanup.push(error); }
    try { await writeFile(join(directory, path), original); } catch (error) { cleanup.push(error); }
    if (themeTouched) {
      try {
        if (preferences === null) { await unlink(preferencesPath).catch(error => { if (error.code !== "ENOENT") { throw error; } }); }
        else { await writeFile(preferencesPath, preferences); }
        await evaluate("app.appearance.restore()");
        assert.equal(await evaluate('app.appearance.getControlValue("theme")'), originalTheme);
      } catch (error) { cleanup.push(error); }
    }
    try { await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) { throw new AggregateError(cleanup, "Could not restore the extra highlighting fixture."); }
    if (failure && cleanup.length) { report.extraHighlightingCleanupErrors = cleanup.map(String); }
  }
}

/** The aggregate audits actual cached bytes again after returning to the local vault. */
export async function checkExtraHighlightingReadOnly(tools) {
  const { evaluate, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const priorPath = await evaluate("app.workspace.getActiveFile()?.path"), priorMode = await evaluate("app.workspace.activeLeaf.view.getEditingMode()");
  const counters = "(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()";
  assert.deepEqual(await evaluate(counters), { api: 0, raw: 0 });
  await evaluate('app.openFile("Extra code languages.md")');
  const original = await evaluate("app.editor.getValue()");
  try {
    assert.equal(original, readOnlyExtraHighlightingMarkdown());
    const sourceLines = original.split("\n").flatMap((line, index) => /^```\w/.test(line) ? [index] : []);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)');
    await assertSource(tools, original, readonlySamples, sourceLines);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("preview",false)');
    await wait(readonlySamples.map(sample => `${preview}.querySelector("code.language-${sample.language}")?.dataset.codeHighlighted===${q(sample.language)}`).join("&&"), "cached read-only extra language tokens");
    assertBlocks(await evaluate(inspect(preview)), { expected: readonlySamples, colored: true });
    assert.equal(await evaluate("app.editor.getValue()"), original);
    assert.deepEqual(await evaluate(counters), { api: 0, raw: 0 });
    await revealFollowup(tools);
    await capture?.("extra-highlighting-readonly");
    report.extraHighlighting = { ...(report.extraHighlighting ?? {}), readOnly: true, readOnlyLanguages: readonlySamples.map(sample => sample.language), readOnlySourceGlyphs: true, readOnlyReadingGlyphs: true, readOnlyExactSource: true, readOnlyZeroNetwork: true };
    pass(report, `A genuine cache-only read-only note highlights ${readonlySamples.length} Dart/Clojure/CMake/Objective-C/Julia/Groovy/Pascal/Visual Basic fences with exact Source and Reading glyphs, semantic tokens and theme colors, leaves source unchanged and performs zero API/raw requests; the aggregate audits cached bytes through local-vault return.`);
  } finally {
    await evaluate(`(async()=>{${priorPath ? `await app.openFile(${q(priorPath)});` : ""}app.workspace.activeLeaf.view.setEditingMode(${q(priorMode)},false)})()`);
  }
}
