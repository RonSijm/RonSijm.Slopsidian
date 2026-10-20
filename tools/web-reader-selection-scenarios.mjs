import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkReaderSelection({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-selection", note = "Web clips/Reader selected words.md", correctedNote = "Web clips/Reader corrected selection.md", collision = "Web clips/Reader external.md";
  const config = join(directory, ".obsidian"), settings = await readFile(join(config, "webviewer.json")), originalWorkspace = await readFile(join(config, "workspace.json")), originalNote = await readFile(join(directory, "Welcome.md"));
  const historyPath = join(config, "vault-dotnet-web-history.json"), idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "Reader selection source " + url);
  const button = action => host.click(`[data-webviewer-action=${JSON.stringify(action)}]`);
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "selection Reader ready");
    const name = await host.evaluate(`${view}.reader.frame.name`), find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-selection-acceptance", grantUniveralAccess: false });
        const candidate = async expression => { const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value; };
        if (await candidate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = candidate; }
      } catch { /* Workspace moves can replace the iframe context. */ }
      if (!evaluate) { for (const target of (await targets()).filter(item => item.type === "iframe")) { const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = expression => candidate.evaluate(expression); break; } } }
      return Boolean(evaluate);
    }, "ready Reader selection context");
    await host.wait(`${view}.reader.progressReady===true`, "selection progress restored"); return { name, evaluate };
  }
  let frame, remote;
  async function nativePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native source for Reader selection"); return connect(target); }
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); remote = await nativePage(url); frame = await reader(); }
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "Reader selected-text preview ready");
  const text = () => host.evaluate('document.querySelector("[data-web-clip-preview]").value');
  const close = async () => { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "Reader selection preview closed"); };
  async function preview(command = false) { if (command) { await host.evaluate('app.commands.execute("webviewer:save-selection-to-vault")'); } else { await button("clip-selection"); } await ready(); return text(); }
  async function unavailable() { await button("clip-selection"); await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="unavailable"&&/select/i.test(document.querySelector("[data-web-clip-error]").textContent)&&document.querySelector("[data-web-clip-action=save]").disabled', "Reader selection visibly refused"); }
  async function select(kind) {
    return frame.evaluate(`(()=>{const range=document.createRange(),selection=getSelection(),paragraphs=[...document.querySelectorAll("article p")];if(${JSON.stringify(kind)}==="multi"){const first=paragraphs.find(p=>p.textContent.startsWith("First selected paragraph")),last=paragraphs.find(p=>p.textContent.startsWith("Literal <img"));range.setStartBefore(first);range.setEndAfter(last)}else{const node=paragraphs.find(p=>${JSON.stringify(kind)}==="long"?p.textContent.length>200000:p.textContent==="字");range.selectNodeContents(node)}selection.removeAllRanges();selection.addRange(range);return selection.toString()})()`);
  }
  function unpack(markdown) { const match = markdown.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(match); const parsed = parseDocument(match[1]); assert.deepEqual(parsed.errors, []); return { values: parsed.toJSON(), body: markdown.slice(match[0].length) }; }
  const readerState = () => frame.evaluate('({article:document.querySelector("article").innerHTML,text:getSelection().toString(),anchor:getSelection().anchorOffset,focus:getSelection().focusOffset,scroll:document.scrollingElement.scrollTop})');
  async function reading(path, markdown) {
    const values = unpack(markdown).values; await host.wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter?.title===${JSON.stringify(values.title)}`, "Reader selection metadata ready");
    const metadata = await host.evaluate(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)})).frontmatter`); for (const [key, value] of Object.entries(values)) { assert.deepEqual(metadata[key], value); }
    await host.evaluate(`${view}.setMode("preview")`); await host.wait(`${view}.previewEl.textContent.includes("First selected paragraph bold words.")`, "saved Reader selection Reading ready");
    assert.ok((await host.evaluate(`${view}.previewEl.textContent`)).includes('Literal <img src=x onerror=bad()> ![[Secret]] $math$ %%comment%%.'));
    assert.equal(await host.evaluate(`${view}.previewEl.querySelectorAll("strong,img,script,iframe,table").length`), 0);
    await host.wait(`${view}.metadataEditor.contentEl.querySelectorAll("[data-property-key]").length===4`, "Reader selection Properties rows ready");
  }
  async function save(path) { await host.fill("[data-web-clip-path]", path); const markdown = await text(); await host.click('[data-web-clip-action="save"]'); await host.wait(`!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "Reader selected note saved"); assert.deepEqual(await readFile(join(directory, path)), Buffer.from(markdown)); return markdown; }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  if (!await host.evaluate('app.core.isEnabled("properties")')) { await host.evaluate('app.core.setEnabled("properties",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await idle(); const history = await readFile(historyPath), initialFiles = await files();
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(source)},true)`); await loaded(source); remote = await nativePage(source); const sourceId = await host.evaluate("app.workspace.activeLeaf.id");
  const reveal = async () => { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(sourceId)}))`); await loaded(source); remote = await nativePage(source); frame = await reader(); };
  await remote.fill("#selection-input", "Keep Reader selection source 中文 😀"); await remote.evaluate('document.cookie="readerSelection=keep;path=/"');
  const sourceState = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#selection-input").value,cookie:document.cookie,scroll:scrollY,selection:fixtureSelection().toString()})');
  await button("reader"); frame = await reader(); assert.equal(await host.evaluate('document.querySelector("[data-webviewer-action=clip-selection]").disabled'), false, "Save selection is available for a ready Reader");
  await host.evaluate(`globalThis.readerSelectionActions=[];globalThis.readerSelectionRequest=${view}.request.bind(${view});${view}.request=async(action,values)=>{readerSelectionActions.push(action);return readerSelectionRequest(action,values)};undefined`);
  const pickedText = "Picked 中文 😀 | **literal**";
  const points = await frame.evaluate(`(()=>{const walker=document.createTreeWalker(document.querySelector("article"),NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())if(node.textContent.includes(${JSON.stringify(pickedText)}))break;node.parentElement.scrollIntoView({block:"center"});const start=node.textContent.indexOf(${JSON.stringify(pickedText)}),end=start+${pickedText.length},first=document.createRange(),last=document.createRange();first.setStart(node,start);first.setEnd(node,start+1);last.setStart(node,end-1);last.setEnd(node,end);const a=first.getBoundingClientRect(),b=last.getBoundingClientRect();return{start:{x:a.left+.1,y:a.top+a.height/2},end:{x:b.right-.1,y:b.top+b.height/2}}})()`);
  const bounds = await host.evaluate(`${view}.reader.frame.getBoundingClientRect().toJSON()`), start = { x: bounds.x + points.start.x, y: bounds.y + points.start.y }, end = { x: bounds.x + points.end.x, y: bounds.y + points.end.y };
  await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...start }); await host.command("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", clickCount: 1 }); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...end, button: "left", buttons: 1 }); await host.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", clickCount: 1 });
  await until(async () => await frame.evaluate("getSelection().toString()") === pickedText, "real pointer drag selects Reader words"); await frame.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const before = await readerState(), requestCount = requests.length, first = await preview();
  assert.ok(first.endsWith("Picked 中文 😀 \\| \\*\\*literal\\*\\*\n")); assert.doesNotMatch(first, /Before selection|After selection|Outside selection|Control value/);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip]").dataset.webClipSource'), "reader"); assert.ok((await host.evaluate('document.querySelector(".web-clip-modal").textContent')).includes("selected in Reader"));
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").readOnly'), true); await capture("preview"); await close(); assert.deepEqual(await readerState(), before);
  const commandPreview = await preview(true);
  if (first.startsWith("---\n")) {
    const initial = unpack(first), repeated = unpack(commandPreview);
    for (const captured of [initial, repeated]) {
      assert.deepEqual(Object.keys(captured.values).sort(), ["clipped", "source", "tags", "title"]);
      assert.equal(new Date(captured.values.clipped).toISOString(), captured.values.clipped);
    }
    assert.ok(Date.parse(repeated.values.clipped) >= Date.parse(initial.values.clipped));
    assert.deepEqual({ ...repeated.values, clipped: initial.values.clipped }, initial.values);
    assert.equal(repeated.body, initial.body);
  } else { assert.equal(commandPreview, first); }
  await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-clip]")', "Escape discards Reader selection preview");
  assert.equal(await host.evaluate('readerSelectionActions.includes("clip-selection")'), false); assert.equal(await host.evaluate('readerSelectionActions.includes("check-article")'), true);
  await host.evaluate(`${view}.request=readerSelectionRequest;delete globalThis.readerSelectionRequest`);
  assert.deepEqual(await files(), initialFiles); assert.equal(requests.length, requestCount); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#selection-input").value,cookie:document.cookie,scroll:scrollY,selection:fixtureSelection().toString()})'), sourceState);
  pass("Real Reader pointer selection, toolbar and owned command capture only displayed literal words through the authenticated opaque frame, preserve selection/DOM/progress/source state, and Cancel/Escape leave notes/history unchanged without native-page selection, clipboard or refetch");

  await select("multi"); await preview(true);
  if (!await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
  await host.fill("[data-web-clip-property-title]", "Reader: 中文 😀"); await host.fill("[data-web-clip-property-tags]", "reader/clips, research, reader/clips"); await ready();
  const markdown = await text(), metadata = unpack(markdown); assert.equal(metadata.values.source, source); assert.equal(metadata.values.title, "Reader: 中文 😀"); assert.deepEqual(metadata.values.tags, ["reader/clips", "research"]); assert.equal(new Date(metadata.values.clipped).toISOString(), metadata.values.clipped);
  assert.ok(metadata.body.includes("First selected paragraph bold words\\.")); assert.ok(metadata.body.includes("\n\nLiteral &lt;img")); assert.doesNotMatch(metadata.body, /\*\*bold words|Before selection|Outside selection/);
  await select("short"); assert.equal(await text(), markdown); await host.evaluate('globalThis.readerSelectionCreates=[];globalThis.readerSelectionCreateRef=app.vault.on("create",file=>readerSelectionCreates.push(file.path));undefined');
  assert.equal(await save(note), markdown); assert.equal(await host.evaluate(`readerSelectionCreates.filter(path=>path===${JSON.stringify(note)}).length`), 1); await host.evaluate('app.vault.offref(readerSelectionCreateRef);delete globalThis.readerSelectionCreateRef'); await reading(note, markdown); await capture("saved");
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote);
  pass("Multi-paragraph Reader selection saves the exact reviewed Unicode/literal Markdown once with optional title/source/time/tags and normal metadata/Properties/Reading; later selection changes cannot rewrite the snapshot and existing notes/settings retain exact bytes");

  await reveal(); await frame.evaluate("getSelection().removeAllRanges()"); await unavailable(); await capture("unavailable"); await close(); await select("short"); assert.ok((await preview()).endsWith("字\n")); await close();
  await button("find"); await host.fill("[data-webviewer-find]", "bold words"); await host.wait(`${view}.contentEl.querySelector("[data-webviewer-matches]").textContent==="1 of 1"`, "Reader Find selects words"); await button("zoom-in");
  assert.ok((await preview()).endsWith("bold words\n")); await close(); await button("find-close"); await button("zoom-reset");
  await navigate(origin + "/clip-selection-long"); await select("long"); await unavailable(); assert.match(await host.evaluate('document.querySelector("[data-web-clip-error]").textContent'), /too large/i); await close();
  await navigate(source); await select("short"); await preview(); await host.evaluate(`${view}.toggleReader()`); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); await close();
  await button("reader"); frame = await reader(); await select("short");
  await host.evaluate(`(()=>{const reader=${view}.reader,capture=reader.captureSelection.bind(reader);reader.captureSelection=async()=>{const result=await capture();globalThis.readerSelectionHeld=true;await new Promise(resolve=>globalThis.releaseReaderSelection=resolve);reader.captureSelection=capture;return result}})()`);
  await button("clip-selection"); await host.wait("globalThis.readerSelectionHeld===true", "real Reader selection held before preview");
  const revision = await host.evaluate(`${view}.reader.documentRevision`); await host.evaluate(`${view}.reader.frame.srcdoc=${view}.reader.frame.srcdoc`); await host.wait(`${view}.reader.documentRevision>${revision}`, "real Reader document reload observed"); await host.evaluate("releaseReaderSelection()");
  await host.wait('document.querySelector("[data-web-clip]").dataset.webClip==="unavailable"&&document.querySelector("[data-web-clip-action=save]").disabled', "old-document selection cannot revive preview"); await close(); frame = await reader();
  await select("short"); await preview(); await host.evaluate(`${view}.action("reload")`); await loaded(source); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); await close(); frame = await reader();
  await select("multi"); const correctedMarkdown = await preview(); const collisionBytes = Buffer.from("\ufeff# External\r\nReader collision 中文 😀.\r\n"); await writeFile(join(directory, collision), collisionBytes); await host.fill("[data-web-clip-path]", collision); await host.click('[data-web-clip-action="save"]');
  await host.wait('!document.querySelector("[data-web-clip-error]").hidden&&!document.querySelector("[data-web-clip-action=save]").disabled', "Reader selection collision correction available"); assert.deepEqual(await readFile(join(directory, collision)), collisionBytes); assert.equal(await text(), correctedMarkdown); assert.equal(await save(correctedNote), correctedMarkdown);
  await idle(); assert.deepEqual(await readFile(historyPath), history); assert.deepEqual(await files(), [...initialFiles, note, collision, correctedNote].sort());
  pass("Empty/oversized Reader selections refuse Save and short/Find-selected text works with zoom; Reader exit, a held real capture across a fresh iframe document and native reload invalidate stale previews, while external BOM/CRLF collisions retain the snapshot and corrected saving succeeds");

  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview");await app.workspace.flushLayout()})()`); await restart(); await host.wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "Reader selected note restored"); await reading(note, markdown); await reveal(); await select("short"); await preview(); await close();
  await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id==="webviewer:save-selection-to-vault")'), false); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); frame = await reader(); await select("short"); await preview();
  await host.evaluate(`globalThis.oldReaderSelectionClip=${view}.clip;globalThis.oldSelectionFrame=${view}.reader;oldReaderSelectionClip.path.value="Web clips/Stale Reader selection.md";undefined`); await close();
  const other = join(directory, ".reader-selection-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther Reader selection vault 中文 😀.\r\n"); await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  const otherSettings = Buffer.from('\ufeff{"readerFont":"serif","readerWidth":"narrow","readerFontSize":16,"readerLineHeight":1.3,"enableAdblocking":false,"future":{"keep":"reader selection"}}\r\n'); await writeFile(join(other, ".obsidian", "webviewer.json"), otherSettings);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))'))); const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) { await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "Reader selection vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault"); await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "Reader selection vault switch"); }
  await switchVault(other); await host.evaluate("oldReaderSelectionClip.saveNote()"); assert.match(await host.evaluate('oldSelectionFrame.captureSelection().then(()=>"unexpected capture",error=>error.message)'), /closed|unavailable/i); assert.equal(await host.evaluate("oldSelectionFrame.selections.size"), 0); assert.deepEqual(await files(), ["Keep.md"]);
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(source)},true)`); await loaded(source); await button("reader"); frame = await reader(); await select("short"); assert.ok((await preview()).endsWith("字\n")); await close();
  assert.deepEqual(await readFile(join(other, ".obsidian", "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); frame = await reader(); await select("multi"); await preview(); await capture("restored"); await close();
  assert.doesNotMatch(await host.evaluate(`JSON.stringify(${view}.getState())`), /First selected paragraph|bold words|Picked 中文/); assert.equal(await host.evaluate(`${view}.reader.selections.size`), 0);
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown)); assert.deepEqual(await readFile(join(directory, correctedNote)), Buffer.from(correctedMarkdown)); assert.deepEqual(await readFile(join(directory, collision)), collisionBytes); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  pass("Full enabled/disabled restarts restore exact saved Reader selection notes and owned commands, while capture timers/drafts never restore; real same-URL vault switches reject obsolete clips/disposed frames and preserve both vaults' notes/settings/history/original-workspace/BOM/CRLF/Unicode bytes");
}
