import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWebReaderAppearance({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/reader-story?appearance-first", secondUrl = origin + "/reader-story?appearance-second";
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), originalSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  const workspacePath = join(directory, ".obsidian", "workspace.json"), originalWorkspace = await readFile(workspacePath);
  const fonts = { serif: "Georgia,serif", "sans-serif": "system-ui,sans-serif", monospace: "Consolas,monospace" };
  const widths = { narrow: "56ch", standard: "72ch", wide: "96ch" };
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "appearance source loaded " + url);
  const button = async action => host.click(`[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-action=${JSON.stringify(action)}]`);
  async function remotePage(url) {
    let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native appearance page " + url);
    return connect(target);
  }
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); return remotePage(url); }
  async function reveal(url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getState().url===${JSON.stringify(url)}))`); await loaded(url); }
  async function settingsList() {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
  }
  async function choose(key, value) {
    const selector = `[data-core-field=${JSON.stringify(key)}]`;
    const values = await host.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options,option=>option.value)`);
    const index = values.indexOf(value); assert.ok(index >= 0, "The real select offers " + value);
    await host.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await host.press("Home", "Home", 36);
    for (let step = 0; step < index; step++) { await host.press("ArrowDown", "ArrowDown", 40); }
    assert.equal(await host.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value);
  }
  async function setting(readerFont, readerWidth, captureSettings = false) {
    await settingsList(); await host.click('[data-core-settings="webviewer"]');
    await choose("readerFont", readerFont); await choose("readerWidth", readerWidth);
    if (captureSettings) { await capture("settings"); }
    await host.click('[data-core-save="webviewer"]');
    await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.readerFont===${JSON.stringify(readerFont)}&&app.core.state("webviewer").settings.readerWidth===${JSON.stringify(readerWidth)}`, "Reader preferences saved");
    await host.click(".settings-close");
  }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "appearance Reader ready");
    const name = await host.evaluate(`${view}.contentEl.querySelector("[data-webviewer-reader]").name`);
    const find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-appearance-acceptance", grantUniveralAccess: false });
        const candidate = async expression => {
          const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); }
          return result.result.value;
        };
        if (await candidate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = candidate; }
      } catch { /* A workspace DOM move can replace an iframe context. */ }
      if (!evaluate) {
        for (const target of (await targets()).filter(item => item.type === "iframe")) {
          const candidate = await connect(target);
          if (await candidate.evaluate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = expression => candidate.evaluate(expression); break; }
        }
      }
      return Boolean(evaluate);
    }, "ready opaque Reader execution context after workspace changes");
    assert.ok(evaluate, "opaque Reader is independently inspectable"); return { name, evaluate };
  }
  const styles = frame => frame.evaluate('(()=>{const style=getComputedStyle(document.documentElement),main=document.querySelector("main");return{font:style.getPropertyValue("--reader-font").trim(),width:style.getPropertyValue("--reader-width").trim(),fontFamily:style.fontFamily,mainWidth:main.getBoundingClientRect().width,limit:getComputedStyle(main).maxWidth,zoom:Number(style.zoom)}})()');
  const appearance = (frame, font, width) => until(async () => { const value = await styles(frame); return value.font === fonts[font] && value.width === widths[width]; }, "actual Reader style " + font + "/" + width);
  const pageSnapshot = remote => remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,loads:sessionStorage.readerLoads,scrollY})');
  const saved = async (font, width) => {
    const value = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(value.readerFont, font); assert.equal(value.readerWidth, width);
    for (const [key, expected] of Object.entries(originalSettings)) { if (!["readerFont", "readerWidth"].includes(key)) { assert.deepEqual(value[key], expected); } }
  };
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(true,()=>true)');
  const beforeSettings = await readFile(settingsPath);
  let remote = await open(source);
  await remote.fill("#original-input", "Keep original input 中文 😀"); await remote.evaluate('scrollTo(0,120);document.cookie="appearanceTransient=keep;path=/"');
  const before = await pageSnapshot(remote);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath = join(directory, ".obsidian", "vault-dotnet-web-history.json"), historyBefore = await readFile(historyPath);
  const requestCount = requests.length;
  await button("reader"); let first = await reader(); await appearance(first, "serif", "standard");
  assert.deepEqual(await readFile(settingsPath), beforeSettings, "opening Reader never materializes defaults");
  const articleHtml = await first.evaluate('document.querySelector("article").innerHTML');
  const standard = await styles(first);
  await setting("serif", "narrow"); await appearance(first, "serif", "narrow");
  assert.ok((await styles(first)).mainWidth < standard.mainWidth, "narrow changes actual article geometry");
  await setting("monospace", "wide"); await appearance(first, "monospace", "wide");
  assert.ok((await styles(first)).fontFamily.toLowerCase().includes("consolas"));
  await setting("sans-serif", "standard", true); await appearance(first, "sans-serif", "standard");
  assert.ok((await styles(first)).fontFamily.includes("system-ui"));
  assert.equal(await first.evaluate("window.name"), first.name);
  assert.equal(await first.evaluate('document.querySelector("article").innerHTML'), articleHtml);
  await saved("sans-serif", "standard");
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  assert.deepEqual(await readFile(historyPath), historyBefore); assert.equal(requests.length, requestCount);
  await button("reader"); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "original page restored");
  assert.deepEqual(await pageSnapshot(remote), before);
  await button("reader"); first = await reader(); await appearance(first, "sans-serif", "standard");
  await capture("article");
  pass("Real keyboard-operated font/width settings change computed fonts and article geometry in place, retain article/frame identity and opaque settings, and preserve source DOM/input/scroll/cookies/history without requests or materializing defaults on open");

  await open(secondUrl);
  // Hold a real native extraction result, rather than substituting article output.
  await host.evaluate(`(()=>{const owner=${view},request=owner.request.bind(owner);owner.request=async(action,values)=>{const result=await request(action,values);if(action==="reader"){globalThis.appearanceExtractionHeld=true;await new Promise(resolve=>globalThis.releaseAppearanceExtraction=resolve);owner.request=request}return result}})()`);
  await button("reader"); await host.wait("globalThis.appearanceExtractionHeld===true", "actual extraction held before presentation");
  await setting("monospace", "narrow");
  await host.evaluate("releaseAppearanceExtraction()"); let second = await reader(); await appearance(second, "monospace", "narrow");
  const firstName = first.name, secondName = second.name;
  await reveal(source); first = await reader(); await appearance(first, "monospace", "narrow"); assert.equal(first.name, firstName);
  await setting("sans-serif", "wide"); await appearance(first, "sans-serif", "wide");
  await reveal(secondUrl); second = await reader(); await appearance(second, "sans-serif", "wide"); assert.equal(second.name, secondName);
  await reveal(source); first = await reader(); await appearance(first, "sans-serif", "wide");
  pass("Saved preferences update hidden and visible Reader frames, and a held real native extraction uses the latest saved preferences when its presentation becomes ready");

  const unchanged = await styles(first);
  await host.evaluate(`(()=>{const frame=${view}.reader;for(const data of [{token:"wrong",readerFont:"serif",readerWidth:"narrow"},{token:frame.token,readerFont:"serif",readerWidth:"constructor"},{token:frame.token,readerFont:"serif;background:url(https://bad.example)",readerWidth:"narrow"}])frame.frame.contentWindow.postMessage({channel:"slopsidian-reader",kind:"appearance",...data},"*")})()`);
  await first.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.deepEqual(await styles(first), unchanged);
  assert.deepEqual(await first.evaluate('(()=>{let parentBlocked=false;try{void parent.app}catch{parentBlocked=true}return{require:typeof require,process:typeof process,parentBlocked}})()'), { require: "undefined", process: "undefined", parentBlocked: true });
  assert.equal(await host.evaluate(`${view}.reader.frame.contentDocument`), null);
  await button("find");
  const findInput = `[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-find]`;
  await host.fill(findInput, "readneedle");
  await host.wait(`${view}.contentEl.querySelector("[data-webviewer-matches]").textContent==="1 of 2"`, "Find works with custom font and width");
  await button("find-close"); await button("zoom-in");
  await until(async () => (await styles(first)).zoom === 1.1, "zoom coexists with appearance");
  await appearance(first, "sans-serif", "wide"); await button("zoom-reset");
  await until(async () => (await styles(first)).zoom === 1, "appearance zoom reset");
  await capture("wide");
  pass("Reader rejects invalid or wrong-session appearance messages, retains opaque-origin/Node/editor isolation, and keeps actual Find and zoom working with custom fonts and widths");

  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),readerFont:"monospace",readerWidth:"narrow",futureAppearance:{keep:[1,true]}},active:true});await app.workspace.flushLayout()})()`);
  first = await reader(); await appearance(first, "sans-serif", "wide");
  const savedBytes = await readFile(settingsPath);
  await restart(); await loaded(source); first = await reader(); await appearance(first, "sans-serif", "wide");
  assert.deepEqual(await host.evaluate(`${view}.getState().futureAppearance`), { keep: [1, true] });
  assert.equal(await host.evaluate(`${view}.getState().readerFont`), "monospace", "opaque leaf fields cannot override vault preferences");
  await reveal(secondUrl); second = await reader(); await appearance(second, "sans-serif", "wide"); await reveal(source);
  await capture("restored"); assert.deepEqual(await readFile(settingsPath), savedBytes);
  pass("A full Electron/.NET restart restores both readers with vault preferences before presentation, retaining opaque leaf fields without letting unrelated leaf values override the saved settings");

  await settingsList(); await host.click('[data-core-toggle="webviewer"]');
  await host.wait('!app.core.busy&&!app.core.isEnabled("webviewer")', "appearance provider disabled"); await host.click(".settings-close");
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false);
  await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "appearance native contents released");
  await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); first = await reader(); await appearance(first, "sans-serif", "wide");
  await host.evaluate('app.workspace.closeLeaf(app.workspace.activeLeaf)'); await reveal(secondUrl); second = await reader(); await appearance(second, "sans-serif", "wide");
  await open(source); await button("reader"); first = await reader(); await appearance(first, "sans-serif", "wide");
  assert.deepEqual(await readFile(settingsPath), savedBytes);
  pass("Disable and disabled-process restart remove all Reader frames/native pages; re-enable, pane close and a new Reader all retain the saved preferences with fresh owned resources");

  const otherVault = join(directory, ".appearance-other-vault"); await mkdir(join(otherVault, ".obsidian"), { recursive: true });
  const otherSettings = '{"readerFont":"serif","readerWidth":"narrow","enableAdblocking":false,"future":{"keep":"other-vault"}}\n';
  const otherNote = Buffer.from("\ufeff# Keep\r\nAppearance isolation 中文 😀.\r\n");
  await writeFile(join(otherVault, "Keep.md"), otherNote); await writeFile(join(otherVault, ".obsidian", "webviewer.json"), otherSettings);
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(item=>[item.id,["webviewer","command-palette","file-explorer"].includes(item.id)]))')));
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "appearance vault dialog open");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "appearance vault switch " + path);
  }
  await switchVault(otherVault); await open(origin + "/reader-story?appearance-other"); await button("reader"); const other = await reader(); await appearance(other, "serif", "narrow");
  await switchVault(directory); await loaded(source); first = await reader(); await appearance(first, "sans-serif", "wide");
  assert.deepEqual(await readFile(settingsPath), savedBytes);
  assert.equal(await readFile(join(otherVault, ".obsidian", "webviewer.json"), "utf8"), otherSettings);
  assert.deepEqual(await readFile(join(otherVault, "Keep.md")), otherNote); assert.deepEqual(await readFile(workspacePath), originalWorkspace);
  assert.ok(requests.every(item => item.token === null)); await host.evaluate("app.workspace.flushLayout()");
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await capture("vault-restored");
  pass("Actual vault switches replace Reader preferences and restore the original readers cleanly, preserving both settings files, BOM/CRLF/Unicode note bytes and original workspace bytes without leaking tokens or stale saves");
}
