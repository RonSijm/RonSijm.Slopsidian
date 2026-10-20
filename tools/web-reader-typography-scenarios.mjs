import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkReaderTypography({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/reader-story?typography=first", secondUrl = origin + "/reader-story?typography=second";
  const config = join(directory, ".obsidian"), settingsPath = join(config, "webviewer.json"), originalSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  const originalNote = await readFile(join(directory, "Welcome.md")), originalWorkspace = await readFile(join(config, "workspace.json"));
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "typography source loaded " + url);
  const button = async action => host.click(`[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-action=${JSON.stringify(action)}]`);
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); }
  async function reveal(id, url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`); await loaded(url); }
  async function nativePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native typography source"); return connect(target); }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "typography Reader ready");
    const name = await host.evaluate(`${view}.reader.frame.name`), find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-typography-acceptance", grantUniveralAccess: false });
        const candidate = async expression => { const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value; };
        if (await candidate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = candidate; }
      } catch { /* A workspace DOM move can replace an iframe context. */ }
      if (!evaluate) { for (const target of (await targets()).filter(item => item.type === "iframe")) { const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = expression => candidate.evaluate(expression); break; } } }
      return Boolean(evaluate);
    }, "ready typography article context");
    await host.wait(`${view}.reader.progressReady===true`, "typography progress ready"); return { name, evaluate };
  }
  const styles = frame => frame.evaluate('(()=>{const root=document.documentElement,css=getComputedStyle(root),scroll=document.scrollingElement;return{fontSize:parseFloat(css.fontSize),lineHeight:parseFloat(css.lineHeight),font:css.getPropertyValue("--reader-font").trim(),width:css.getPropertyValue("--reader-width").trim(),size:css.getPropertyValue("--reader-font-size").trim(),spacing:css.getPropertyValue("--reader-line-height").trim(),zoom:Number(css.zoom),distance:scroll.scrollHeight-scroll.clientHeight}})()');
  const styled = (frame, size, spacing) => until(async () => { const value = await styles(frame); return value.size === size + "px" && value.spacing === String(spacing) && Math.abs(value.fontSize - size) < .01 && Math.abs(value.lineHeight - size * spacing) < .05; }, "actual typography " + size + "/" + spacing);
  const position = frame => frame.evaluate('(()=>{const root=document.scrollingElement,distance=root.scrollHeight-root.clientHeight;return{top:root.scrollTop,distance,progress:distance>0?root.scrollTop/distance:0}})()');
  const restored = (frame, expected) => until(async () => Math.abs((await position(frame)).progress - expected) < .006, "typography retained progress " + expected);
  async function scrollTo(frame, fraction) {
    const current = await position(frame); assert.ok(current.distance > 100);
    const point = await host.evaluate(`(()=>{const rect=${view}.reader.frame.getBoundingClientRect();return{x:rect.x+rect.width*.55,y:rect.y+rect.height*.65}})()`);
    await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await host.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: (current.distance * fraction - current.top) * (await styles(frame)).zoom });
    await restored(frame, fraction); await until(async () => Math.abs((await host.evaluate(`${view}.getState().readerScroll?.progress`)) - (await position(frame)).progress) < .006, "wheel progress reaches owning view");
    return (await position(frame)).progress;
  }
  async function settings() { await host.click("#open-settings"); await host.click("#core-plugins-tab"); if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); } await host.click('[data-core-settings="webviewer"]'); }
  async function values(size, spacing) { await host.fill("[data-core-field=readerFontSize]", String(size)); await host.fill("[data-core-field=readerLineHeight]", String(spacing)); }
  async function saveSettings(size, spacing, screenshot = false) {
    await host.click('[data-core-save="webviewer"]'); await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.readerFontSize===${size}&&app.core.state("webviewer").settings.readerLineHeight===${spacing}`, "typography settings saved");
    if (screenshot) { await host.evaluate('document.querySelector("[data-core-field=readerFontSize]").scrollIntoView({block:"center"})'); await capture("settings"); }
    await host.click(".settings-close");
  }
  async function setTypography(size, spacing, screenshot = false) { await settings(); await values(size, spacing); await saveSettings(size, spacing, screenshot); }
  async function clipBody() {
    await button("clip"); await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "typography clip preview ready");
    if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
    const markdown = await host.evaluate('document.querySelector("[data-web-clip-preview]").value'); await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "typography clip cancelled"); return markdown;
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await open(source);
  const firstId = await host.evaluate("app.workspace.activeLeaf.id"), remote = await nativePage(source), initialFiles = await host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  await remote.fill("#original-input", "Keep typography source 中文 😀"); await remote.evaluate('scrollTo(0,120);document.cookie="typographyTransient=keep;path=/"');
  const snapshot = () => remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,scrollY,loads:sessionStorage.readerLoads})');
  const originalPage = await snapshot(); await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath = join(config, "vault-dotnet-web-history.json"), history = await readFile(historyPath), requestCount = requests.length;
  await button("reader"); let first = await reader(); await styled(first, 19, 1.7);
  const article = await first.evaluate('document.querySelector("article").innerHTML'), firstName = first.name, initialClip = await clipBody();
  await settings();
  assert.deepEqual(await host.evaluate('["readerFontSize","readerLineHeight"].map(key=>{const field=document.querySelector("[data-core-field="+key+"]");return{type:field.type,min:field.min,max:field.max,step:field.step}})'), [{ type: "number", min: "14", max: "32", step: "1" }, { type: "number", min: "1.2", max: "2.4", step: "0.1" }]);
  const beforeInvalid = await readFile(settingsPath);
  await values(33, 2.1); await host.click('[data-core-save="webviewer"]'); assert.equal(await host.evaluate('document.querySelector("[data-core-field=readerFontSize]").validity.rangeOverflow'), true); assert.deepEqual(await readFile(settingsPath), beforeInvalid);
  await values(26, 1.25); await host.click('[data-core-save="webviewer"]'); assert.equal(await host.evaluate('document.querySelector("[data-core-field=readerLineHeight]").validity.stepMismatch'), true); assert.deepEqual(await readFile(settingsPath), beforeInvalid);
  await values(14, 1.2); await saveSettings(14, 1.2); await styled(first, 14, 1.2); const small = await styles(first); await capture("small");
  const progress = await scrollTo(first, .47); await setTypography(32, 2.4, true); await styled(first, 32, 2.4); await restored(first, progress);
  assert.ok((await styles(first)).distance > small.distance); assert.equal(await first.evaluate("window.name"), firstName); assert.equal(await first.evaluate('document.querySelector("article").innerHTML'), article);
  assert.deepEqual(await snapshot(), originalPage); assert.equal(requests.length, requestCount); await capture("large");
  pass("Real numeric Settings controls enforce size/spacing bounds and steps without partial writes; corrected minimum/maximum preferences change computed text and article geometry in place, preserve wheel reading progress/frame/article/source state and issue no new requests");

  await open(secondUrl); const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate(`(()=>{const owner=${view},request=owner.request.bind(owner);owner.request=async(action,values)=>{const result=await request(action,values);if(action==="reader"){globalThis.typographyExtractionHeld=true;await new Promise(resolve=>globalThis.releaseTypographyExtraction=resolve);owner.request=request}return result}})()`);
  await button("reader"); await host.wait("globalThis.typographyExtractionHeld===true", "real typography extraction held before presentation");
  await setTypography(20, 1.5); await host.evaluate("releaseTypographyExtraction()"); let second = await reader(); await styled(second, 20, 1.5); const secondName = second.name;
  await reveal(firstId, source); first = await reader(); await styled(first, 20, 1.5); await restored(first, progress); assert.equal(first.name, firstName);
  await setTypography(26, 2.1); await styled(first, 26, 2.1); await reveal(secondId, secondUrl); second = await reader(); await styled(second, 26, 2.1); assert.equal(second.name, secondName);
  await reveal(firstId, source); first = await reader(); await restored(first, progress); const unchanged = await styles(first), afterSecondRequests = requests.length;
  await host.evaluate(`(()=>{const frame=${view}.reader,base={channel:"slopsidian-reader",kind:"appearance",token:frame.token,readerCustomFont:app.core.state("webviewer").settings.readerCustomFont,readerCustomWidth:app.core.state("webviewer").settings.readerCustomWidth,readerFont:"serif",readerWidth:"wide",readerFontSize:32,readerLineHeight:2.4,readerParagraphSpacing:app.core.state("webviewer").settings.readerParagraphSpacing,readerLetterSpacing:app.core.state("webviewer").settings.readerLetterSpacing};for(const data of [{...base,token:"wrong"},{...base,readerFontSize:33},{...base,readerFontSize:"26"},{...base,readerLineHeight:1.25},{...base,readerLineHeight:1.7000000000000002},{...base,readerLineHeight:NaN},{...base,readerFont:"constructor"}])frame.frame.contentWindow.postMessage(data,"*")})()`);
  await first.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); assert.deepEqual(await styles(first), unchanged); await restored(first, progress);
  assert.deepEqual(await first.evaluate('(()=>{let parentBlocked=false;try{void parent.app}catch{parentBlocked=true}return{require:typeof require,process:typeof process,parentBlocked}})()'), { require: "undefined", process: "undefined", parentBlocked: true });
  assert.equal(await host.evaluate(`${view}.reader.frame.contentDocument`), null); assert.equal(requests.length, afterSecondRequests); await capture("pending");
  pass("Live typography reaches visible/hidden Readers and a held real native extraction adopts the latest saved values; frame/session identity and independent progress survive, malformed/wrong-session messages cannot partially apply and opaque-origin/Node/editor isolation stays intact");

  const shellFont = await host.evaluate('getComputedStyle(document.querySelector("#desktop-shell")).fontSize');
  await button("find"); const findSelector = `[data-webviewer=${JSON.stringify(firstId)}] [data-webviewer-find]`; await host.fill(findSelector, "readneedle");
  await host.wait(`${view}.contentEl.querySelector("[data-webviewer-matches]").textContent==="1 of 2"`, "Find remains usable after typography changes"); await button("find-close");
  const findProgress = (await position(first)).progress; await button("zoom-in"); await until(async () => (await styles(first)).zoom === 1.1, "Reader zoom after typography"); await styled(first, 26, 2.1); await restored(first, findProgress);
  assert.equal(await host.evaluate('getComputedStyle(document.querySelector("#desktop-shell")).fontSize'), shellFont); await button("zoom-reset"); await until(async () => (await styles(first)).zoom === 1, "Reader zoom resets independently");
  const beforeToggle = (await position(first)).progress; await button("reader"); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "typography original page restored"); assert.deepEqual(await snapshot(), originalPage);
  await button("reader"); first = await reader(); await styled(first, 26, 2.1); await restored(first, beforeToggle); assert.equal(await clipBody(), initialClip);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history); assert.equal(requests.length, afterSecondRequests);
  assert.deepEqual(await host.evaluate('app.vault.getFiles().map(file=>file.path).sort()'), initialFiles); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote);
  const savedSettings = await readFile(settingsPath), saved = JSON.parse(savedSettings);
  for (const [key, value] of Object.entries(originalSettings)) { if (!["readerFontSize", "readerLineHeight"].includes(key)) { assert.deepEqual(saved[key], value); } }
  pass("Reader font size/spacing coexist with actual Find and independent zoom, Original page/Reader resumes progress, article clipping remains byte-identical, and source DOM/input/scroll/cookies/history/notes plus unrelated settings are preserved");

  const finalProgress = (await position(first)).progress;
  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),readerFontSize:15,readerLineHeight:1.3,futureTypography:{keep:[false,"中文"]}},active:true});await app.workspace.flushLayout()})()`);
  await restart(); await loaded(source); first = await reader(); await styled(first, 26, 2.1); await restored(first, finalProgress);
  assert.equal(await host.evaluate(`${view}.getState().readerFontSize`), 15); assert.equal(await host.evaluate(`${view}.getState().readerLineHeight`), 1.3); assert.deepEqual(await host.evaluate(`${view}.getState().futureTypography`), { keep: [false, "中文"] });
  await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false);
  await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "typography native resources released"); await host.evaluate('app.workspace.flushLayout()'); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); first = await reader(); await styled(first, 26, 2.1); await restored(first, finalProgress);
  await host.evaluate(`globalThis.oldTypographyFrame=${view}.reader;undefined`);
  const other = join(directory, ".typography-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther typography vault 中文 😀.\r\n"); await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  const otherSettings = Buffer.from('\ufeff{"readerFont":"serif","readerWidth":"narrow","readerFontSize":16,"readerLineHeight":1.3,"enableAdblocking":false,"future":{"keep":"other"}}\r\n'); await writeFile(join(other, ".obsidian", "webviewer.json"), otherSettings);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) { await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "typography vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault"); await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "typography vault switch " + path); }
  await switchVault(other); await open(origin + "/reader-story?typography=other"); await button("reader"); const otherReader = await reader(); await styled(otherReader, 16, 1.3); const otherBefore = await styles(otherReader);
  await host.evaluate('oldTypographyFrame.setAppearance({readerFont:"monospace",readerWidth:"wide",readerFontSize:32,readerLineHeight:2.4});oldTypographyFrame.flushProgress()'); assert.equal(await host.evaluate("oldTypographyFrame.disposed"), true); assert.deepEqual(await styles(otherReader), otherBefore);
  assert.deepEqual(await readFile(join(other, ".obsidian", "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); first = await reader(); await styled(first, 26, 2.1); await restored(first, finalProgress); await capture("restored");
  assert.deepEqual(await readFile(settingsPath), savedSettings); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace); await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await host.evaluate('app.vault.getFiles().map(file=>file.path).sort()'), initialFiles); assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  pass("Full enabled/disabled process restarts and actual vault switches restore each vault's typography/progress; opaque leaf fields cannot override preferences, disposed frames cannot affect another vault, and exact note/settings/history/original-workspace/BOM/CRLF/Unicode bytes survive");
}
