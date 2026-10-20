import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkClipSelection({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-selection", note = "Web clips/Selected words.md", command = "webviewer:save-selection-to-vault";
  const config = join(directory, ".obsidian"), settings = await readFile(join(config, "webviewer.json")), originalWorkspace = await readFile(join(config, "workspace.json")), originalNote = await readFile(join(directory, "Welcome.md"));
  const historyPath = join(config, "vault-dotnet-web-history.json"), idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "selection source loaded " + url);
  const close = async () => { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "selection preview closed"); };
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "selection preview ready");
  let remote;
  async function connectSource(url = source) {
    let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native selection source"); remote = await connect(target);
  }
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); await connectSource(url); }
  async function select(selector) {
    await remote.evaluate(`(()=>{document.activeElement?.blur();const range=document.createRange();range.selectNodeContents(document.querySelector(${JSON.stringify(selector)}));const selection=fixtureSelection();selection.removeAllRanges();selection.addRange(range)})()`);
    return remote.evaluate("fixtureSelection().toString()");
  }
  async function preview(useCommand = false) {
    if (useCommand) { await host.evaluate(`app.commands.execute(${JSON.stringify(command)})`); }
    else { await host.click('[data-webviewer-action="clip-selection"]'); }
    await ready(); return host.evaluate('document.querySelector("[data-web-clip-preview]").value');
  }
  async function unavailable() {
    await host.click('[data-webviewer-action="clip-selection"]');
    await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="unavailable"&&/select/i.test(document.querySelector("[data-web-clip-error]").textContent)&&document.querySelector("[data-web-clip-action=save]").disabled', "unsupported selection refused");
  }
  const state = () => remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#selection-input").value,cookie:document.cookie,scroll:scrollY,selection:fixtureSelection().toString(),anchor:fixtureSelection().anchorOffset,focus:fixtureSelection().focusOffset})');
  async function reading() {
    await host.evaluate(`${view}.setMode("preview")`);
    await host.wait(`${view}.previewEl.textContent.includes("First selected paragraph bold words.")`, "saved selected-text Reading ready");
    assert.equal(await host.evaluate(`${view}.previewEl.querySelectorAll("strong,img,iframe,script,table").length`), 0);
    assert.ok((await host.evaluate(`${view}.previewEl.textContent`)).includes('Literal <img src=x onerror=bad()> ![[Secret]] $math$ %%comment%%.'));
    assert.doesNotMatch(await host.evaluate(`${view}.previewEl.textContent`), /Outside selection|Before selection|After selection|Control value/);
  }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await idle();
  const history = await readFile(historyPath), initialFiles = await files();
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(origin + "/one")},true)`); await loaded(origin + "/one"); await navigate(source);
  const sourceId = await host.evaluate("app.workspace.activeLeaf.id"), reveal = async () => { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(sourceId)}))`); await loaded(source); await connectSource(); };
  await remote.fill("#selection-input", "Keep original 中文 😀");
  const points = await remote.evaluate('(()=>{document.activeElement.blur();const el=document.querySelector("#selection-target");el.scrollIntoView({block:"nearest"});const b=el.getBoundingClientRect();return{start:{x:b.left+1,y:b.top+b.height/2},end:{x:b.right-1,y:b.top+b.height/2}}})()');
  await remote.command("Page.bringToFront"); await remote.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.start });
  await remote.command("Input.dispatchMouseEvent", { type: "mousePressed", ...points.start, button: "left", clickCount: 1 });
  await remote.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.end, button: "left", buttons: 1 });
  await remote.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.end, button: "left", clickCount: 1 });
  await remote.wait('fixtureSelection().toString()==="Picked 中文 😀 | **literal**"', "actual pointer drag selects the intended page words");
  const before = await state(), requestCount = requests.length;
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-action=clip-selection]"))'), true, "Web viewer provides a Save selection action");
  const picked = await preview();
  assert.ok(picked.endsWith("Picked 中文 😀 \\| \\*\\*literal\\*\\*\n")); assert.doesNotMatch(picked, /Before selection|After selection|Outside selection|page-world|Control value/);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip]").dataset.webClipKind'), "selection");
  assert.doesNotMatch(await host.evaluate(`JSON.stringify(${view}.getState())`), /Picked 中文|literal/);
  assert.ok((await host.evaluate('document.querySelector(".web-clip-modal").textContent')).includes("plain text"));
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").readOnly'), true); await capture("preview"); await close();
  assert.deepEqual(await state(), before); assert.equal(requests.length, requestCount);
  assert.equal(await preview(true), picked); await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-clip]")', "Escape cancels selected-text preview");
  assert.deepEqual(await files(), initialFiles); await idle(); assert.deepEqual(await readFile(historyPath), history);
  pass("Real native pointer selection, toolbar and owned command produce an isolated literal-text preview despite page-world getSelection spoofing; Cancel/Escape preserve exact source DOM/input/selection/cookies/scroll, history and files without refetches");

  const selected = await select("#selection-multi"), markdown = await preview(true);
  assert.ok(markdown.includes("First selected paragraph bold words\\.")); assert.ok(markdown.includes("\n\nLiteral &lt;img")); assert.doesNotMatch(markdown, /\*\*bold words|Before selection|Outside selection/);
  assert.doesNotMatch(marked.parse(markdown), /<(?:img|script|iframe|strong|table)\b/); assert.ok(selected.includes("bold words"));
  await select("#selection-short"); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").value'), markdown, "Changing page selection cannot rewrite a reviewed snapshot");
  await host.fill("[data-web-clip-path]", note); await host.evaluate('globalThis.selectionCreates=[];globalThis.selectionCreateRef=app.vault.on("create",file=>selectionCreates.push(file.path));undefined');
  await host.click('[data-web-clip-action="save"]'); await host.wait(`!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "selected-text note saved");
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown)); assert.equal(await host.evaluate(`selectionCreates.filter(path=>path===${JSON.stringify(note)}).length`), 1);
  await host.evaluate('app.vault.offref(selectionCreateRef);delete globalThis.selectionCreateRef'); await reading(); await capture("saved");
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  pass("Multi-paragraph selection saves the exact reviewed Unicode Markdown once and opens actual Reading with literal HTML/wiki/math/comment syntax, plain emphasis and paragraph breaks; later page selection changes cannot alter the reviewed snapshot");

  await reveal(); await remote.evaluate('fixtureSelection().removeAllRanges()'); await unavailable(); await capture("unavailable"); await close();
  await select("#selection-blank"); await unavailable(); await close();
  await remote.fill("#selection-input", "Keep original 中文 😀"); await remote.press("a", "KeyA", 65, 2); await unavailable(); await close();
  await remote.click("iframe"); await remote.evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;const range=doc.createRange();range.selectNodeContents(doc.body);const selection=doc.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range)})()'); await unavailable(); await close();
  await select("#selection-short"); assert.ok((await preview()).endsWith("字\n")); await close();
  await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"`, "Reader available alongside selection clipping");
  assert.equal(await host.evaluate('document.querySelector("[data-webviewer-action=clip-selection]").disabled'), false);
  await unavailable(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip]").dataset.webClipSource'), "reader"); await close();
  await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "original page restores selection action");
  await navigate(origin + "/clip-selection-long"); await select("#selection-long"); await unavailable(); await close();
  await navigate(source); await select("#selection-short"); await preview(); await host.evaluate(`${view}.action("reload")`); await loaded(source);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); await close(); await connectSource(); await select("#selection-multi"); assert.equal(await preview(), markdown);
  const collision = "Web clips/External selection.md", collisionBytes = Buffer.from("\ufeff# External\r\nRetain 中文 😀.\r\n"); await writeFile(join(directory, collision), collisionBytes);
  await host.fill("[data-web-clip-path]", collision); await host.click('[data-web-clip-action="save"]');
  await host.wait('!document.querySelector("[data-web-clip-error]").hidden&&!document.querySelector("[data-web-clip-action=save]").disabled', "external creation collision is retained for correction");
  assert.deepEqual(await readFile(join(directory, collision)), collisionBytes); await close();
  await host.wait(`Boolean(app.vault.getFileByPath(${JSON.stringify(collision)}))`, "external selected-note creation reaches the normal inventory");
  assert.deepEqual(await files(), [...initialFiles, note, collision].sort()); await idle(); assert.deepEqual(await readFile(historyPath), history);
  pass("Empty/whitespace/control/frame/oversized selections fail clearly without partial notes; one-character text works, Reader uses its own empty selection rather than the original page's selection, reload invalidates previews, and external file creation retains exact BOM/CRLF bytes with correction available");

  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview");await app.workspace.flushLayout()})()`); await restart();
  await host.wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "selected-text note restores after restart"); await reading(); await reveal();
  await unavailable(); await close(); await select("#selection-short"); await preview(); await close();
  await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate(`app.commands.listCommands().some(item=>item.id===${JSON.stringify(command)})`), false);
  await host.evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); await connectSource(); await select("#selection-short"); await preview();
  await host.evaluate(`${view}.clip.path.value="Web clips/Stale selection.md";globalThis.oldSelectionClip=${view}.clip;undefined`); await close();
  const other = join(directory, ".clip-selection-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther selection vault 中文 😀.\r\n");
  await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "selection vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "selection vault switch " + path);
  }
  await switchVault(other); await host.evaluate("oldSelectionClip.saveNote()"); assert.deepEqual(await files(), ["Keep.md"]); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); await connectSource(); await select("#selection-multi"); assert.equal(await preview(), markdown); await close();
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown)); assert.deepEqual(await readFile(join(directory, collision)), collisionBytes); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview")})()`); await reading(); await capture("restored");
  pass("Enabled/disabled full restarts and real vault switches retain selected-text notes and original settings/history/workspace/Unicode bytes; selection/previews never restore as saved state, owned commands unload, obsolete saves cannot cross vaults and fresh selection recovers");
}
