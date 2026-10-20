import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkReaderLetterSpacing({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/reader-story?letter=first", secondUrl = origin + "/reader-story?letter=second";
  const config = join(directory, ".obsidian"), settingsPath = join(config, "webviewer.json"), originalSettingsBytes = await readFile(settingsPath), originalSettings = JSON.parse(originalSettingsBytes);
  const originalNote = await readFile(join(directory, "Welcome.md")), originalWorkspace = await readFile(join(config, "workspace.json"));
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "letter source loaded " + url);
  const button = async action => host.click(`[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-action=${JSON.stringify(action)}]`);
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); }
  async function reveal(id, url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`); await loaded(url); }
  async function nativePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native letter source"); return connect(target); }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "letter Reader ready");
    const name = await host.evaluate(`${view}.reader.frame.name`), find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-letter-acceptance", grantUniveralAccess: false });
        const candidate = async expression => { const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value; };
        if (await candidate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = candidate; }
      } catch { /* Workspace DOM moves can replace the iframe context. */ }
      if (!evaluate) { for (const target of (await targets()).filter(item => item.type === "iframe")) { const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = expression => candidate.evaluate(expression); break; } } }
      return Boolean(evaluate);
    }, "ready letter article context");
    await host.wait(`${view}.reader.progressReady===true`, "letter progress ready"); return { name, evaluate };
  }
  const styles = frame => frame.evaluate("(()=>{const css=getComputedStyle(document.documentElement),p=document.querySelector(\"article p\"),range=document.createRange(),node=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode(),scroll=document.scrollingElement;range.setStart(node,0);range.setEnd(node,Math.min(10,node.textContent.length));return{font:css.getPropertyValue(\"--reader-font\").trim(),width:css.getPropertyValue(\"--reader-width\").trim(),size:css.getPropertyValue(\"--reader-font-size\").trim(),line:css.getPropertyValue(\"--reader-line-height\").trim(),paragraph:css.getPropertyValue(\"--reader-paragraph-spacing\").trim(),letter:css.getPropertyValue(\"--reader-letter-spacing\").trim(),computed:css.letterSpacing,fontSize:parseFloat(css.fontSize),wordWidth:range.getBoundingClientRect().width,zoom:Number(css.zoom),distance:scroll.scrollHeight-scroll.clientHeight}})()");
  const styled = (frame, spacing) => until(async () => { const value = await styles(frame); return value.letter === (spacing === 0 ? "normal" : spacing + "em") && (spacing === 0 ? value.computed === "normal" : Math.abs(parseFloat(value.computed) - value.fontSize * spacing) < .03); }, "actual letter spacing " + spacing);
  const position = frame => frame.evaluate('(()=>{const root=document.scrollingElement,distance=root.scrollHeight-root.clientHeight;return{top:root.scrollTop,distance,progress:distance>0?root.scrollTop/distance:0}})()');
  const restored = (frame, expected) => until(async () => Math.abs((await position(frame)).progress - expected) < .006, "letter retained progress " + expected);
  async function scrollTo(frame, fraction) {
    const current = await position(frame); assert.ok(current.distance > 100);
    const point = await host.evaluate(`(()=>{const rect=${view}.reader.frame.getBoundingClientRect();return{x:rect.x+rect.width*.55,y:rect.y+rect.height*.65}})()`);
    await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await host.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: (current.distance * fraction - current.top) * (await styles(frame)).zoom });
    await restored(frame, fraction); await until(async () => Math.abs((await host.evaluate(`${view}.getState().readerScroll?.progress`)) - (await position(frame)).progress) < .006, "wheel letter progress reaches owner"); return (await position(frame)).progress;
  }
  async function settings() { await host.click("#open-settings"); await host.click("#core-plugins-tab"); if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); } await host.click('[data-core-settings="webviewer"]'); }
  async function saveSpacing(spacing, screenshot = false) {
    await host.click('[data-core-save="webviewer"]'); await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.readerLetterSpacing===${spacing}`, "letter setting saved");
    if (screenshot) { await host.evaluate('document.querySelector("[data-core-field=readerLetterSpacing]").scrollIntoView({block:"center"})'); await capture("settings"); }
    await host.click(".settings-close");
  }
  async function setSpacing(spacing, screenshot = false) { await settings(); await host.fill("[data-core-field=readerLetterSpacing]", String(spacing)); await saveSpacing(spacing, screenshot); }
  async function clipBody(selection = false, command = false) {
    if (command) { await host.evaluate('app.commands.execute("webviewer:save-selection-to-vault")'); } else { await button(selection ? "clip-selection" : "clip"); }
    await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "letter clip preview ready");
    if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
    const markdown = await host.evaluate('document.querySelector("[data-web-clip-preview]").value'); await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "letter clip cancelled"); return markdown;
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await open(source);
  const firstId = await host.evaluate("app.workspace.activeLeaf.id"), remote = await nativePage(source), initialFiles = await files();
  await remote.fill("#original-input", "Keep letter source 中文 😀"); await remote.evaluate('scrollTo(0,120);document.cookie="letterTransient=keep;path=/"');
  const snapshot = () => remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,scrollY,loads:sessionStorage.readerLoads})');
  const originalPage = await snapshot(); await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath = join(config, "vault-dotnet-web-history.json"), history = await readFile(historyPath), requestCount = requests.length;
  await button("reader"); let first = await reader(); await styled(first, 0); assert.deepEqual(await readFile(settingsPath), originalSettingsBytes);
  const article = await first.evaluate('document.querySelector("article").innerHTML'), firstName = first.name, initialClip = await clipBody(), initialStyle = await styles(first);
  await settings(); assert.deepEqual(await host.evaluate('(()=>{const field=document.querySelector("[data-core-field=readerLetterSpacing]");return{type:field.type,min:field.min,max:field.max,step:field.step,value:field.value}})()'), { type: "number", min: "0", max: "0.2", step: "0.01", value: "0" });
  const beforeInvalid = await readFile(settingsPath);
  for (const [value, validity] of [["0.21", "rangeOverflow"], ["-0.01", "rangeUnderflow"], ["0.005", "stepMismatch"], ["", "valueMissing"]]) { await host.fill("[data-core-field=readerLetterSpacing]", value); await host.click('[data-core-save="webviewer"]'); assert.equal(await host.evaluate("document.querySelector(\"[data-core-field=readerLetterSpacing]\").validity." + validity), true); assert.deepEqual(await readFile(settingsPath), beforeInvalid); }
  await host.fill("[data-core-field=readerLetterSpacing]", "0"); await saveSpacing(0); await styled(first, 0); const normal = await styles(first); await capture("normal");
  const progress = await scrollTo(first, .47); await setSpacing(.2, true); await styled(first, .2); await restored(first, progress); const spaced = await styles(first);
  assert.ok(spaced.wordWidth > normal.wordWidth); assert.ok(spaced.distance > normal.distance); for (const key of ["font", "width", "size", "line", "paragraph", "fontSize", "zoom"]) { assert.equal(spaced[key], initialStyle[key]); }
  assert.equal(await first.evaluate("window.name"), firstName); assert.equal(await first.evaluate('document.querySelector("article").innerHTML'), article); assert.deepEqual(await snapshot(), originalPage); assert.equal(requests.length, requestCount); await capture("spaced");
  pass("Real letter-spacing Settings control retains normal at zero, rejects invalid bounds/steps/empty input without writes, and applies 0–0.2em character spacing with measured glyph geometry and preserved font/width/size/line/paragraph/zoom, source state and wheel progress without requests");

  await open(secondUrl); const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate(`(()=>{const owner=${view},request=owner.request.bind(owner);owner.request=async(action,values)=>{const result=await request(action,values);if(action==="reader"){globalThis.letterExtractionHeld=true;await new Promise(resolve=>globalThis.releaseLetterExtraction=resolve);owner.request=request}return result}})()`);
  await button("reader"); await host.wait("globalThis.letterExtractionHeld===true", "real letter extraction held before presentation"); await setSpacing(.04); await host.evaluate("releaseLetterExtraction()"); let second = await reader(); await styled(second, .04); const secondName = second.name, secondProgress = await scrollTo(second, .22);
  const progressTrace = [];
  const trace = async label => {
    const owner = await host.evaluate(`(()=>{const reader=app.workspace.getLeafById(${JSON.stringify(secondId)}).view.reader;return{cached:reader.progress,revision:reader.documentRevision,visible:reader.frame.checkVisibility(),scroll:app.workspace.getLeafById(${JSON.stringify(secondId)}).view.getState().readerScroll}})()`);
    let layout; try { layout = await second.evaluate('({mainVisible:document.querySelector("main").checkVisibility(),mainHeight:document.querySelector("main").getBoundingClientRect().height,height:document.documentElement.clientHeight,rootHeight:document.scrollingElement.clientHeight,scrollHeight:document.scrollingElement.scrollHeight,top:document.scrollingElement.scrollTop,letter:getComputedStyle(document.documentElement).getPropertyValue("--reader-letter-spacing")})'); } catch (error) { layout = error.message; }
    progressTrace.push({ label, owner, layout });
  };
  await trace("scrolled");
  await reveal(firstId, source); first = await reader(); await styled(first, .04); await restored(first, progress); assert.equal(first.name, firstName);
  await trace("hidden"); await setSpacing(.12); await styled(first, .12); await trace("hidden after spacing"); await reveal(secondId, secondUrl); second = await reader(); await styled(second, .12); await trace("shown");
  try { await restored(second, secondProgress); } catch (error) { await trace("timed out"); throw new Error(error.message + "\nLetter progress trace: " + JSON.stringify(progressTrace)); } assert.equal(second.name, secondName);
  await reveal(firstId, source); first = await reader(); await restored(first, progress); const unchanged = await styles(first), afterSecondRequests = requests.length;
  await host.evaluate(`(()=>{const frame=${view}.reader,options=app.core.state("webviewer").settings,base={channel:"slopsidian-reader",kind:"appearance",token:frame.token,readerCustomFont:app.core.state("webviewer").settings.readerCustomFont,readerCustomWidth:app.core.state("webviewer").settings.readerCustomWidth,readerFont:"serif",readerWidth:options.readerWidth,readerFontSize:options.readerFontSize,readerLineHeight:options.readerLineHeight,readerParagraphSpacing:options.readerParagraphSpacing,readerLetterSpacing:.2};for(const data of [{...base,token:"wrong"},...[undefined,null,"0.07",NaN,Infinity,-.01,.21,.005,.07000000000000002].map(readerLetterSpacing=>({...base,readerLetterSpacing})),{...base,readerFont:"constructor"},{...base,readerLineHeight:9}])frame.frame.contentWindow.postMessage(data,"*")})()`);
  await first.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); assert.deepEqual(await styles(first), unchanged); await restored(first, progress);
  assert.deepEqual(await first.evaluate('(()=>{let parentBlocked=false;try{void parent.app}catch{parentBlocked=true}return{require:typeof require,process:typeof process,parentBlocked}})()'), { require: "undefined", process: "undefined", parentBlocked: true });
  assert.equal(await host.evaluate(`${view}.reader.frame.contentDocument`), null); assert.equal(requests.length, afterSecondRequests);
  pass("Letter spacing reaches visible/hidden Readers and a held real extraction uses the latest preference; each pane retains its own progress/frame, invalid or incomplete appearance messages apply no partial styles, and opaque-frame/Node/editor isolation remains intact");

  const shellFont = await host.evaluate('getComputedStyle(document.querySelector("#desktop-shell")).fontSize');
  await button("find"); await host.fill(`[data-webviewer=${JSON.stringify(firstId)}] [data-webviewer-find]`, "readneedle"); await host.wait(`${view}.contentEl.querySelector("[data-webviewer-matches]").textContent==="1 of 2"`, "letter Find selection ready");
  const selected = await clipBody(true); assert.ok(selected.endsWith("Readneedle\n")); await setSpacing(.07); await styled(first, .07); assert.equal(await clipBody(true, true), selected);
  await button("find-close"); const findProgress = (await position(first)).progress; await button("zoom-in"); await until(async () => (await styles(first)).zoom === 1.1, "letter independent Reader zoom"); await styled(first, .07); await restored(first, findProgress);
  assert.equal(await host.evaluate('getComputedStyle(document.querySelector("#desktop-shell")).fontSize'), shellFont); await button("zoom-reset"); await until(async () => (await styles(first)).zoom === 1, "letter zoom reset");
  const beforeToggle = (await position(first)).progress; await button("reader"); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "letter original page restored"); assert.deepEqual(await snapshot(), originalPage);
  await button("reader"); first = await reader(); await styled(first, .07); await restored(first, beforeToggle); assert.equal(await clipBody(), initialClip);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history); assert.equal(requests.length, afterSecondRequests); assert.deepEqual(await files(), initialFiles); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote);
  const savedSettings = await readFile(settingsPath), saved = JSON.parse(savedSettings); for (const [key, value] of Object.entries(originalSettings)) { if (key !== "readerLetterSpacing") { assert.deepEqual(saved[key], value); } }
  pass("Letter spacing coexist with actual Find, toolbar/command Reader selection and independent zoom; selection/article Markdown remain exact, Original page/Reader resumes progress, and source DOM/input/cookies/scroll, notes/history and unrelated preferences stay unchanged");

  const finalProgress = (await position(first)).progress;
  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),readerLetterSpacing:.19,futureLetter:{keep:[false,"中文"]}},active:true});await app.workspace.flushLayout()})()`);
  await restart(); await loaded(source); first = await reader(); await styled(first, .07); await restored(first, finalProgress); assert.equal(await host.evaluate(`${view}.getState().readerLetterSpacing`), .19); assert.deepEqual(await host.evaluate(`${view}.getState().futureLetter`), { keep: [false, "中文"] });
  await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false); await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "letter native resources released"); await host.evaluate('app.workspace.flushLayout()'); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); first = await reader(); await styled(first, .07); await restored(first, finalProgress); await host.evaluate(`globalThis.oldLetterFrame=${view}.reader;undefined`);
  const other = join(directory, ".letter-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther letter vault 中文 😀.\r\n"); await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  const otherSettings = Buffer.from('\ufeff{"readerFont":"serif","readerWidth":"narrow","readerFontSize":16,"readerLineHeight":1.3,"readerParagraphSpacing":1.4,"readerLetterSpacing":0.02,"enableAdblocking":false,"future":{"keep":"other letter"}}\r\n'); await writeFile(join(other, ".obsidian", "webviewer.json"), otherSettings);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))'))); const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) { await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "letter vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault"); await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "letter vault switch"); }
  await switchVault(other); await open(source); await button("reader"); const otherReader = await reader(); await styled(otherReader, .02); const otherBefore = await styles(otherReader); await restored(otherReader, 0);
  await host.evaluate('oldLetterFrame.setAppearance({readerFont:"monospace",readerWidth:"wide",readerFontSize:32,readerLineHeight:2.4,readerParagraphSpacing:3,readerLetterSpacing:.2});oldLetterFrame.flushProgress()'); assert.equal(await host.evaluate("oldLetterFrame.disposed"), true); assert.deepEqual(await styles(otherReader), otherBefore);
  assert.deepEqual(await readFile(join(other, ".obsidian", "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); first = await reader(); await styled(first, .07); await restored(first, finalProgress); await capture("restored");
  assert.deepEqual(await readFile(settingsPath), savedSettings); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace); await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await files(), initialFiles); assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  pass("Full enabled/disabled restarts and actual same-URL vault switches restore vault-specific letter spacing and independent progress; opaque leaf fields and disposed frames cannot override another vault, while exact note/settings/history/original-workspace/BOM/CRLF/Unicode bytes survive");
}
