import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Actual Reading/static renderer workflow, shared by native and real-folder WASM. */
export async function checkCodeHighlighting(tools) {
  const { directory, evaluate, wait, report, command, restart, afterReload, capture } = tools;
  const path = "Editor improvements/Code highlighting.md";
  const javascript = 'const answer = 42;\nconst literal = \'<img src="https://highlight-no-fetch.invalid/x" onerror="globalThis.codeHighlightExecuted=true">\';\n// λ 😀\n';
  const limit = "x".repeat(65_537);
  const text = [
    "# Reading code highlighting", "", "```js example=local", javascript, "```", "",
    "```typescript", "interface Note { title: string }", "const note: Note = { title: 'kept' };", "```", "",
    "```html", '<p title="kept">inert &amp; local</p>', "```", "",
    "```css", "p { color: red; width: 10px; }", "```", "",
    "```json", '{"enabled": true, "count": 4}', "```", "",
    "````markdown", "# Literal heading", "**strong** and *emphasis*", "````", "",
    "```unsupported-language", "const unsupported = 1;", "```", "",
    "```", "const unlabelled = 2;", "```", "",
    "```js", limit, "```", "",
    "```mermaid", "flowchart LR", "  A[Original] --> B[Renderer]", "```", "",
  ].join("\n").replaceAll("\n", "\r\n");
  const original = Buffer.from("\ufeff" + text), layout = await evaluate("app.workspace.getLayout()");
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const preview = "app.workspace.activeLeaf.view.previewEl";
  const js = `${preview}.querySelector('pre > code.language-js')`;
  const restartState = async () => evaluate(`(()=>{
    const leaf=app.workspace.activeLeaf,view=leaf?.view;
    return {ready:app.workspace.layoutReady,changingVault:app.changingVault,leaf:leaf?.id,
      file:app.workspace.getActiveFile()?.path??null,ownerFile:view?.file?.path??null,
      mode:typeof view?.getMode==='function'?view.getMode():null,
      editingMode:typeof view?.getEditingMode==='function'?view.getEditingMode():null,
      sourceLength:typeof view?.editor?.getValue==='function'?view.editor.getValue().length:null,
      code:[...(view?.previewEl?.querySelectorAll('pre>code')??[])].map(node=>({
        language:node.className,highlighted:node.dataset.codeHighlighted??null,
        length:node.textContent.length,beginning:node.textContent.slice(0,80),
        tokens:node.querySelectorAll('.token').length,sourceLine:node.parentElement?.dataset.sourceLine??null}))};
  })()`);
  const savedRestartState = async () => {
    const saved = JSON.parse((await readFile(join(directory, ".obsidian", "vault-dotnet-workspace.json"), "utf8")).replace(/^\ufeff/, ""));
    const leaves = [];
    const visit = node => { if (node?.type === "leaf") { leaves.push(node); } for (const child of node?.children ?? []) { visit(child); } };
    visit(saved.main);
    const active = leaves.find(node => node.id === saved.active);
    return { active: saved.active, leaf: active ?? null, leaves: leaves.map(node => ({ id: node.id, state: node.state })) };
  };
  const open = async () => {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false)})()`);
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${js}?.dataset.codeHighlighted==="javascript"`, "actual Reading highlights source-bound code");
  };
  await evaluate("app.saveAll()");
  await mkdir(join(directory, "Editor improvements"), { recursive: true });
  await writeFile(join(directory, path), original);
  try {
    await open();
    const visible = await evaluate(`(()=>{
      const root=${preview},code=root.querySelector('pre > code.language-js'),keyword=code.querySelector('.token.keyword');
      return {text:code.textContent,sourceLine:Number(code.parentElement.dataset.sourceLine),keyword:keyword?.textContent,
        visibleColor:keyword&&getComputedStyle(keyword).color!==getComputedStyle(code).color,
        highlighted:[...root.querySelectorAll('pre > code[data-code-highlighted]')].map(node=>node.dataset.codeHighlighted),
        unknown:root.querySelector('code.language-unsupported-language')?.textContent,
        unknownSpans:root.querySelector('code.language-unsupported-language .token')!==null,
        unlabelled:[...root.querySelectorAll('pre > code')].find(node=>!node.className)?.textContent,
        limit:root.querySelectorAll('code.language-js')[1]?.textContent,
        limitHighlighted:root.querySelectorAll('code.language-js')[1]?.hasAttribute('data-code-highlighted'),
        injected:root.querySelector('pre img,pre script,pre iframe')!==null,executed:globalThis.codeHighlightExecuted===true};
    })()`);
    assert.equal(visible.text, javascript + "\n");
    assert.equal(visible.sourceLine, 2);
    assert.equal(visible.keyword, "const");
    assert.equal(visible.visibleColor, true, "A real computed token color must differ from plain code.");
    assert.deepEqual(visible.highlighted, ["javascript", "typescript", "html", "css", "json", "markdown"]);
    assert.equal(visible.unknown, "const unsupported = 1;\n");
    assert.equal(visible.unknownSpans, false);
    assert.equal(visible.unlabelled, "const unlabelled = 2;\n");
    assert.equal(visible.limit, limit + "\n");
    assert.equal(visible.limitHighlighted, false);
    assert.equal(visible.injected, false); assert.equal(visible.executed, false);
    await wait(`${preview}.querySelector('[data-mermaid-status="ready"] img.mermaid-image')?.naturalWidth>0`, "Mermaid retains its separate renderer");
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass("Reading visibly highlights local JavaScript/TypeScript/HTML/CSS/JSON/Markdown while retaining exact code text, source lines, unknown/unlabelled/oversized fallbacks, inert HTML-looking code and the separate Mermaid renderer.");

    await evaluate(`(async()=>{
      const api=app.plugins.modules.obsidian,owner=new api.Component(),host=document.createElement('div');
      host.dataset.codeHighlightStatic='';document.body.append(host);await owner.load();
      globalThis.__codeHighlightProbe={api,owner,host};
      await api.MarkdownRenderer.render(app,${JSON.stringify("```js\n" + javascript + "\n```\n")},host,${JSON.stringify(path)},owner);
      return true;
    })()`);
    assert.deepEqual(await evaluate(`(()=>{const code=__codeHighlightProbe.host.querySelector('pre>code');return {text:code.textContent,language:code.dataset.codeHighlighted,keyword:code.querySelector('.token.keyword')?.textContent}})()`),
      { text: javascript + "\n", language: "javascript", keyword: "const" });
    await evaluate('(async()=>{await __codeHighlightProbe.owner.unloadAndWait();__codeHighlightProbe.host.remove()})()');
    pass("The public component-owned static MarkdownRenderer waits for built-in highlighting and retains exact fenced source without introducing executable markup or abandoned owners.");

    await evaluate(`(()=>{
      const state=__codeHighlightProbe,api=state.api;
      state.processor=api.MarkdownPreviewRenderer.createCodeBlockPostProcessor('js',(source,element,context)=>{
        (state.pluginSources??=[]).push({source,section:context.getSectionInfo(element)});
        const output=document.createElement('output');output.dataset.codeHighlightPlugin='';output.textContent=source;element.append(output);
      });
      api.MarkdownPreviewRenderer.registerPostProcessor(state.processor,10);
    })()`);
    await wait(`${preview}.querySelector('[data-code-highlight-plugin]')!==null`, "registered code processor replaces supported built-in language");
    assert.equal(await evaluate('__codeHighlightProbe.pluginSources[0].source'), javascript);
    assert.equal(await evaluate('__codeHighlightProbe.pluginSources[0].section.lineStart'), 2);
    assert.equal(await evaluate(`${preview}.querySelector('pre>code.language-js')!==null`), false);
    await evaluate('__codeHighlightProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__codeHighlightProbe.processor);delete __codeHighlightProbe.processor');
    await wait(`${js}?.dataset.codeHighlighted==="javascript"&&!${preview}.querySelector('[data-code-highlight-plugin]')`, "unregistering the plugin restores built-in highlighting");
    pass("A real registered fenced-code processor takes precedence for a supported language, receives exact source/section context, and unregistering it refreshes back to the built-in highlighter.");

    await evaluate(`globalThis.__codeHighlightProbe.previousCode=${js}`);
    await writeFile(join(directory, path), Buffer.from("\ufeff" + text.replace("const answer = 42;", "const answer = 43;")));
    await wait(`${js}?.textContent.includes('const answer = 43;')&&${js}?.dataset.codeHighlighted==="javascript"`, "external source replacement refreshes real highlighted code");
    assert.equal(await evaluate('__codeHighlightProbe.previousCode.isConnected'), false);
    await writeFile(join(directory, path), original);
    await wait(`${js}?.textContent.includes('const answer = 42;')&&${js}?.dataset.codeHighlighted==="javascript"`, "restored external bytes refresh the replacement renderer");
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass("External code changes replace the owned highlighted DOM and restore cleanly while physical BOM/CRLF note bytes remain exact.");

    if (capture) { await capture("code-highlighting"); }
    await evaluate('(async()=>{delete globalThis.__codeHighlightProbe;await app.workspace.flushLayout()})()');
    const restartDiagnostics = report.codeHighlightingRestart = { before: await restartState(), savedBefore: await savedRestartState() };
    assert.equal(restartDiagnostics.before.file, path); assert.equal(restartDiagnostics.before.mode, "preview");
    assert.equal(restartDiagnostics.savedBefore.leaf?.state?.state?.file, path);
    assert.equal(restartDiagnostics.savedBefore.leaf?.state?.state?.mode, "preview");
    if (restart) {
      await restart(async () => {
        restartDiagnostics.savedAfterStop = await savedRestartState();
        assert.equal(restartDiagnostics.savedAfterStop.leaf?.state?.state?.file, path);
        assert.equal(restartDiagnostics.savedAfterStop.leaf?.state?.state?.mode, "preview");
      });
    } else { await command("Page.reload"); }
    if (afterReload) { await afterReload(); }
    restartDiagnostics.after = await restartState();
    restartDiagnostics.savedAfter = await savedRestartState();
    try {
      await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${js}?.dataset.codeHighlighted==="javascript"`, "fresh host restores Reading code highlighting");
    } catch (error) {
      restartDiagnostics.failed = await restartState();
      restartDiagnostics.savedOnFailure = await savedRestartState();
      throw error;
    }
    assert.equal(await evaluate(`${js}.textContent`), javascript + "\n");
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass("Full native restart or fresh-document actual-folder WASM reconnection restores Reading mode and fresh code highlighting without changing source bytes.");
  } finally {
    await evaluate(`(async()=>{const state=globalThis.__codeHighlightProbe;if(state?.processor)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.processor);if(state?.owner)await state.owner.unloadAndWait();state?.host?.remove();delete globalThis.__codeHighlightProbe;delete globalThis.codeHighlightExecuted})()`);
    await evaluate(`app.workspace.changeLayout(${JSON.stringify(layout)})`);
    await evaluate("app.workspace.flushLayout()");
  }
}
