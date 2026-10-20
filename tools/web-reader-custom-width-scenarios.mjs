import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkReaderCustomWidth({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/reader-story?custom-width=first", secondUrl = origin + "/reader-story?custom-width=second";
  const config = join(directory, ".obsidian"), settingsPath = join(config, "webviewer.json"), originalSettingsBytes = await readFile(settingsPath), originalSettings = JSON.parse(originalSettingsBytes);
  const originalNote = await readFile(join(directory, "Welcome.md")), originalWorkspace = await readFile(join(config, "workspace.json"));
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "custom-width source loaded " + url);
  const button = async action => host.click(`[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-action=${JSON.stringify(action)}]`);
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); }
  async function reveal(id, url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`); await loaded(url); }
  async function nativePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native custom-width source"); return connect(target); }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "custom-width Reader ready");
    const name = await host.evaluate(`${view}.reader.frame.name`), find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-custom-width-acceptance", grantUniveralAccess: false });
        const candidate = async expression => { const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value; };
        if (await candidate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = candidate; }
      } catch { /* Workspace DOM moves can replace the iframe context. */ }
      if (!evaluate) { for (const target of (await targets()).filter(item => item.type === "iframe")) { const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = expression => candidate.evaluate(expression); break; } } }
      return Boolean(evaluate);
    }, "ready custom-width article context");
    await host.wait(`${view}.reader.progressReady===true`, "custom-width progress ready"); return { name, evaluate };
  }

  const styles = frame => frame.evaluate('(()=>{const css=getComputedStyle(document.documentElement),main=document.querySelector("main"),scroll=document.scrollingElement;return{font:css.getPropertyValue("--reader-font").trim(),width:css.getPropertyValue("--reader-width").trim(),size:css.getPropertyValue("--reader-font-size").trim(),line:css.getPropertyValue("--reader-line-height").trim(),paragraph:css.getPropertyValue("--reader-paragraph-spacing").trim(),letter:css.getPropertyValue("--reader-letter-spacing").trim(),fontSize:parseFloat(css.fontSize),zoom:Number(css.zoom),maxWidth:parseFloat(getComputedStyle(main).maxWidth),mainWidth:main.getBoundingClientRect().width,viewport:document.documentElement.clientWidth,distance:scroll.scrollHeight-scroll.clientHeight}})()');
  const styled = (frame, width) => until(async () => (await styles(frame)).width === width + "ch", "actual Reader width " + width);
  const position = frame => frame.evaluate('(()=>{const root=document.scrollingElement,distance=root.scrollHeight-root.clientHeight;return{top:root.scrollTop,distance,progress:distance>0?root.scrollTop/distance:0}})()');
  const restored = (frame, expected) => until(async () => Math.abs((await position(frame)).progress - expected) < .006, "custom width retained progress " + expected);
  async function scrollTo(frame, fraction) {
    const current = await position(frame); assert.ok(current.distance > 100);
    const point = await host.evaluate(`(()=>{const rect=${view}.reader.frame.getBoundingClientRect();return{x:rect.x+rect.width*.55,y:rect.y+rect.height*.65}})()`);
    await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await host.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: (current.distance * fraction - current.top) * (await styles(frame)).zoom });
    await restored(frame, fraction); await until(async () => Math.abs((await host.evaluate(`${view}.getState().readerScroll?.progress`)) - (await position(frame)).progress) < .006, "wheel custom width progress reaches owner"); return (await position(frame)).progress;
  }
  async function settings() { await host.click("#open-settings"); await host.click("#core-plugins-tab"); if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); } await host.click('[data-core-settings="webviewer"]'); }
  async function chooseWidth(mode) {
    const index = ["narrow", "standard", "wide", "custom"].indexOf(mode); assert.ok(index >= 0);
    await host.click("[data-core-field=readerWidth]"); await host.press("Home", "Home", 36);
    for (let i = 0; i < index; i++) { await host.press("ArrowDown", "ArrowDown", 40); }
    await host.press("Enter", "Enter", 13);
    await host.wait('document.querySelector("[data-core-field=readerWidth]").value===' + JSON.stringify(mode), "real width choice " + mode);
  }
  async function saveWidth(mode, width, screenshot = false) {
    await host.click('[data-core-save="webviewer"]');
    await host.wait('!app.core.busy&&app.core.state("webviewer").settings.readerWidth===' + JSON.stringify(mode) + '&&app.core.state("webviewer").settings.readerCustomWidth===' + width, "custom width saved");
    if (screenshot) { await host.evaluate('document.querySelector("[data-core-field=readerCustomWidth]").scrollIntoView({block:"center"})'); await capture("settings"); }
    await host.click(".settings-close");
  }
  async function setWidth(width, screenshot = false) { await settings(); await chooseWidth("custom"); await host.fill("[data-core-field=readerCustomWidth]", String(width)); await saveWidth("custom", width, screenshot); }
  async function clipBody(selection = false, command = false) {
    if (command) { await host.evaluate('app.commands.execute("webviewer:save-selection-to-vault")'); } else { await button(selection ? "clip-selection" : "clip"); }
    await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "custom width clip preview ready");
    if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
    const markdown = await host.evaluate('document.querySelector("[data-web-clip-preview]").value'); await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "custom width clip cancelled"); return markdown;
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await open(source);
  const firstId = await host.evaluate("app.workspace.activeLeaf.id"), remote = await nativePage(source), initialFiles = await files();
  await remote.fill("#original-input", "Keep custom width source 中文 😀"); await remote.evaluate('scrollTo(0,120);document.cookie="widthTransient=keep;path=/"');
  const snapshot = () => remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,scrollY,loads:sessionStorage.readerLoads})');
  const originalPage = await snapshot(); await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath = join(config, "vault-dotnet-web-history.json"), history = await readFile(historyPath), requestCount = requests.length;
  await button("reader"); let first = await reader(); const initialMode = await host.evaluate('app.core.state("webviewer").settings.readerWidth');
  await styled(first, {narrow:56,standard:72,wide:96}[initialMode]); assert.deepEqual(await readFile(settingsPath), originalSettingsBytes);
  const article = await first.evaluate('document.querySelector("article").innerHTML'), firstName = first.name, initialClip = await clipBody(), initialStyle = await styles(first);
  await settings(); assert.deepEqual(await host.evaluate('(()=>{const field=document.querySelector("[data-core-field=readerCustomWidth]");return{hidden:field.closest("label").hidden,disabled:field.disabled,type:field.type,min:field.min,max:field.max,step:field.step,value:field.value}})()'), { hidden:true, disabled:true, type:"number", min:"40", max:"120", step:"1", value:"72" });
  await chooseWidth("custom"); assert.equal(await host.evaluate('document.querySelector("[data-core-field=readerCustomWidth]").checkVisibility()&&!document.querySelector("[data-core-field=readerCustomWidth]").disabled'), true);
  const beforeInvalid = await readFile(settingsPath);
  for (const [value, validity] of [["121", "rangeOverflow"], ["39", "rangeUnderflow"], ["80.5", "stepMismatch"], ["", "valueMissing"]]) {
    await host.fill("[data-core-field=readerCustomWidth]", value); await host.click('[data-core-save="webviewer"]');
    assert.equal(await host.evaluate('document.querySelector("[data-core-field=readerCustomWidth]").validity.' + validity), true); assert.deepEqual(await readFile(settingsPath), beforeInvalid);
  }
  await chooseWidth("wide"); assert.equal(await host.evaluate('document.querySelector("[data-core-field=readerCustomWidth]").disabled&&document.querySelector("[data-core-field=readerCustomWidth]").closest("label").hidden'), true);
  await saveWidth("wide", 72); await styled(first, 96);
  await setWidth(40); await styled(first, 40); const narrow = await styles(first); await capture("narrow");
  const progressValue = await scrollTo(first, .47); await setWidth(120, true); await styled(first, 120); await restored(first, progressValue); const wide = await styles(first);
  assert.ok(wide.mainWidth > narrow.mainWidth + 50); assert.ok(wide.maxWidth > narrow.maxWidth * 2.9); assert.ok(wide.distance < narrow.distance); assert.ok(wide.mainWidth <= wide.viewport);
  for (const key of ["font", "size", "line", "paragraph", "letter", "fontSize", "zoom"]) { assert.equal(wide[key], initialStyle[key]); }
  assert.equal(await first.evaluate("window.name"), firstName); assert.equal(await first.evaluate('document.querySelector("article").innerHTML'), article); assert.deepEqual(await snapshot(), originalPage); assert.equal(requests.length, requestCount); await capture("wide");
  pass("Actual Custom width Settings reveal a 40–120 ch whole-number control, retain presets/defaults, reject invalid/empty values without writes and allow returning from an invalid custom draft to a preset; measured article width changes in place with independent wheel progress and unchanged source/typography/zoom");

  await open(secondUrl); const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate('( ()=>{const owner=app.workspace.activeLeaf.view,request=owner.request.bind(owner);owner.request=async(action,values)=>{const result=await request(action,values);if(action==="reader"){globalThis.customWidthExtractionHeld=true;await new Promise(resolve=>globalThis.releaseCustomWidthExtraction=resolve);owner.request=request}return result}})()');
  await button("reader"); await host.wait("globalThis.customWidthExtractionHeld===true", "real custom-width extraction held before presentation"); await setWidth(64); await host.evaluate("releaseCustomWidthExtraction()"); let second = await reader(); await styled(second, 64); const secondName = second.name, secondProgress = await scrollTo(second, .22);
  await reveal(firstId, source); first = await reader(); await styled(first, 64); await restored(first, progressValue); assert.equal(first.name, firstName);
  await setWidth(100); await styled(first, 100); await reveal(secondId, secondUrl); second = await reader(); await styled(second, 100); await restored(second, secondProgress); assert.equal(second.name, secondName);
  await reveal(firstId, source); first = await reader(); await restored(first, progressValue); const unchanged = await styles(first), afterSecondRequests = requests.length;
  await host.evaluate('( ()=>{const frame=app.workspace.activeLeaf.view.reader,options=app.core.state("webviewer").settings,base={channel:"slopsidian-reader",kind:"appearance",token:frame.token,readerCustomFont:app.core.state("webviewer").settings.readerCustomFont,readerFont:"serif",readerWidth:"custom",readerCustomWidth:120,readerFontSize:options.readerFontSize,readerLineHeight:options.readerLineHeight,readerParagraphSpacing:options.readerParagraphSpacing,readerLetterSpacing:options.readerLetterSpacing};for(const data of [{...base,token:"wrong"},...[undefined,null,"80",NaN,Infinity,39,121,80.5].map(readerCustomWidth=>({...base,readerCustomWidth})),{...base,readerWidth:"constructor"},{...base,readerLetterSpacing:.005}])frame.frame.contentWindow.postMessage(data,"*")})()');
  await first.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); assert.deepEqual(await styles(first), unchanged); await restored(first, progressValue);
  assert.deepEqual(await first.evaluate('(()=>{let parentBlocked=false;try{void parent.app}catch{parentBlocked=true}return{require:typeof require,process:typeof process,parentBlocked}})()'), {require:"undefined",process:"undefined",parentBlocked:true});
  assert.equal(await host.evaluate('app.workspace.activeLeaf.view.reader.frame.contentDocument'), null); assert.equal(requests.length, afterSecondRequests);
  pass("Custom width reaches visible/hidden Readers and a held native extraction uses the latest preference; panes retain separate progress and frame identity, incomplete/malformed/wrong-session seven-value messages apply no partial styles, and opaque-frame/Node/editor isolation remains intact");

  const shellFont = await host.evaluate('getComputedStyle(document.querySelector("#desktop-shell")).fontSize');
  await button("find"); await host.fill('[data-webviewer=' + JSON.stringify(firstId) + '] [data-webviewer-find]', "readneedle"); await host.wait('app.workspace.activeLeaf.view.contentEl.querySelector("[data-webviewer-matches]").textContent==="1 of 2"', "custom-width Find selection");
  const selected = await clipBody(true); assert.ok(selected.endsWith("Readneedle\n")); await setWidth(81); await styled(first, 81); assert.equal(await clipBody(true, true), selected);
  await button("find-close"); const findProgress = (await position(first)).progress;
  for (const [mode, width] of [["narrow",56],["standard",72],["wide",96],["custom",81]]) { await settings(); await chooseWidth(mode); await saveWidth(mode, 81); await styled(first, width); await restored(first, findProgress); }
  await button("zoom-in"); await until(async () => (await styles(first)).zoom === 1.1, "custom-width independent zoom"); await styled(first, 81); await restored(first, findProgress);
  assert.equal(await host.evaluate('getComputedStyle(document.querySelector("#desktop-shell")).fontSize'), shellFont); await button("zoom-reset"); await until(async () => (await styles(first)).zoom === 1, "custom-width zoom reset");
  const beforeToggle = (await position(first)).progress; await button("reader"); await host.wait('app.workspace.activeLeaf.view.contentEl.dataset.webviewerReaderMode==="page"', "custom-width Original page"); assert.deepEqual(await snapshot(), originalPage);
  await button("reader"); first = await reader(); await styled(first, 81); await restored(first, beforeToggle); assert.equal(await clipBody(), initialClip);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history); assert.equal(requests.length, afterSecondRequests); assert.deepEqual(await files(), initialFiles); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote);
  const savedSettings = await readFile(settingsPath), saved = JSON.parse(savedSettings); for (const [key, value] of Object.entries(originalSettings)) { if (!["readerWidth", "readerCustomWidth"].includes(key)) { assert.deepEqual(saved[key], value); } }
  pass("Custom width and all three presets coexist with actual Find, toolbar/command Reader selection and independent zoom; the saved custom value survives preset round trips, literal article/selection Markdown stays exact and Original page/Reader retains progress, source state and unrelated vault bytes");

  const finalProgress = (await position(first)).progress;
  await host.evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),readerWidth:"narrow",readerCustomWidth:119,futureCustomWidth:{keep:[false,"中文"]}},active:true});await app.workspace.flushLayout()})()');
  await restart(); await loaded(source); first = await reader(); await styled(first, 81); await restored(first, finalProgress); assert.equal(await host.evaluate('app.workspace.activeLeaf.view.getState().readerCustomWidth'), 119); assert.deepEqual(await host.evaluate('app.workspace.activeLeaf.view.getState().futureCustomWidth'), {keep:[false,"中文"]});
  await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false); await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "custom-width native resources released"); await host.evaluate('app.workspace.flushLayout()'); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); first = await reader(); await styled(first, 81); await restored(first, finalProgress); await host.evaluate('globalThis.oldCustomWidthFrame=app.workspace.activeLeaf.view.reader;undefined');
  const other = join(directory, ".custom-width-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther width vault 中文 😀.\r\n"); await mkdir(join(other, ".obsidian"), {recursive:true}); await writeFile(join(other, "Keep.md"), otherNote);
  const otherSettings = Buffer.from('\ufeff{"readerFont":"serif","readerWidth":"custom","readerCustomWidth":43,"readerFontSize":16,"readerLineHeight":1.3,"readerParagraphSpacing":1.4,"readerLetterSpacing":0.02,"enableAdblocking":false,"future":{"keep":"other width"}}\r\n'); await writeFile(join(other, ".obsidian", "webviewer.json"), otherSettings);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))'))); const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) { await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "custom-width vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault"); await host.wait('app.vault.rootPath===' + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "custom-width vault switch"); }
  await switchVault(other); await open(source); await button("reader"); const otherReader = await reader(); await styled(otherReader, 43); const otherBefore = await styles(otherReader); await restored(otherReader, 0);
  await host.evaluate('oldCustomWidthFrame.setAppearance({readerFont:"monospace",readerWidth:"custom",readerCustomWidth:120,readerFontSize:32,readerLineHeight:2.4,readerParagraphSpacing:3,readerLetterSpacing:.2});oldCustomWidthFrame.flushProgress()'); assert.equal(await host.evaluate("oldCustomWidthFrame.disposed"), true); assert.deepEqual(await styles(otherReader), otherBefore);
  assert.deepEqual(await readFile(join(other, ".obsidian", "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); first = await reader(); await styled(first, 81); await restored(first, finalProgress); await capture("restored");
  assert.deepEqual(await readFile(settingsPath), savedSettings); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace); await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await files(), initialFiles); assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  pass("Full enabled/disabled restarts and actual same-URL vault switches restore each vault's custom width and independent progress; opaque leaf values and disposed frames cannot override another vault, while exact notes/settings/history/original-workspace/BOM/CRLF/Unicode bytes survive");
}
