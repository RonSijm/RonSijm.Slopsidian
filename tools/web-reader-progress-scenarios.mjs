import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWebReaderProgress({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/reader-story?progress=first";
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), workspacePath = join(directory, ".obsidian", "workspace.json");
  const originalWorkspace = await readFile(workspacePath);
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "progress source loaded " + url);
  const button = async action => host.click(`[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-action=${JSON.stringify(action)}]`);
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); }
  async function reveal(id) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`); }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "progress Reader ready");
    const name = await host.evaluate(`${view}.reader.frame.name`);
    const find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-progress-acceptance", grantUniveralAccess: false });
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
    }, "ready progress article context");
    await host.wait(`${view}.reader.progressReady===true`, "Reader progress applied after visible layout");
    return { name, evaluate };
  }
  const position = frame => frame.evaluate('(()=>{const root=document.scrollingElement;const distance=root.scrollHeight-root.clientHeight;return{top:root.scrollTop,distance,progress:distance>0?Math.max(0,Math.min(1,root.scrollTop/distance)):0}})()');
  const restored = (frame, expected) => until(async () => Math.abs((await position(frame)).progress - expected) < 0.006, "actual restored Reader progress " + expected);
  async function wheel(frame, deltaY) {
    const point = await host.evaluate(`(()=>{const box=${view}.reader.frame.getBoundingClientRect();return{x:box.x+box.width*.55,y:box.y+box.height*.65}})()`);
    await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await host.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY });
    await frame.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  }
  async function scrollTo(frame, fraction) {
    const before = await position(frame); assert.ok(before.distance > 100, "The actual article has a useful scroll range");
    await wheel(frame, (before.distance * fraction - before.top) * Number(await frame.evaluate('getComputedStyle(document.documentElement).zoom')));
    await restored(frame, fraction);
    await until(async () => {
      const state = await host.evaluate(`${view}.getState().readerScroll`);
      return state?.url === await host.evaluate(`${view}.getState().url`) && Math.abs(state.progress - (await position(frame)).progress) < 0.006;
    }, "real scroll updates URL-bound workspace state");
    return (await position(frame)).progress;
  }
  async function settingsList() {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
  }
  async function appearance(font, width) {
    await settingsList(); await host.click('[data-core-settings="webviewer"]');
    for (const [key, value] of [["readerFont", font], ["readerWidth", width]]) {
      const selector = `[data-core-field=${JSON.stringify(key)}]`;
      const values = await host.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options,option=>option.value)`), index = values.indexOf(value); assert.ok(index >= 0);
      await host.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await host.press("Home", "Home", 36);
      for (let step = 0; step < index; step++) { await host.press("ArrowDown", "ArrowDown", 40); }
      assert.equal(await host.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value);
    }
    await host.click('[data-core-save="webviewer"]'); await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.readerFont===${JSON.stringify(font)}&&app.core.state("webviewer").settings.readerWidth===${JSON.stringify(width)}`, "progress typography saved");
    await host.click(".settings-close");
  }
  async function nativePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native progress source"); return connect(target); }
  const snapshot = remote => remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,scrollY,loads:sessionStorage.readerLoads})');
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(true,()=>true)');
  await open(source); const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  const remote = await nativePage(source); await remote.fill("#original-input", "Original input 中文 😀"); await remote.evaluate('scrollTo(0,120);document.cookie="progressTransient=keep;path=/"');
  const original = await snapshot(remote);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); const historyPath = join(directory, ".obsidian", "vault-dotnet-web-history.json"), history = await readFile(historyPath), requestCount = requests.length;
  await button("reader"); let first = await reader(); const firstProgress = await scrollTo(first, 0.45);
  await button("reader"); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "Reader returns to original");
  assert.deepEqual(await snapshot(remote), original);
  await button("reader"); first = await reader(); await restored(first, firstProgress);
  assert.deepEqual(await snapshot(remote), original); assert.equal(requests.length, requestCount);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history);
  await capture("middle");
  pass("Real wheel scrolling records URL-bound reading progress, Original page/Reader restores the same fraction, and original DOM/input/scroll/cookies/history and request counts stay unchanged");

  await appearance("monospace", "narrow"); await restored(first, firstProgress);
  await button("zoom-in"); await restored(first, firstProgress);
  await host.command("Emulation.setDeviceMetricsOverride", { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false }); await restored(first, firstProgress);
  await host.command("Emulation.clearDeviceMetricsOverride"); await restored(first, firstProgress); await button("zoom-reset"); await restored(first, firstProgress);
  await scrollTo(first, 0); await button("reader"); await button("reader"); first = await reader(); await restored(first, 0);
  await scrollTo(first, 1); await button("reader"); await button("reader"); first = await reader(); await restored(first, 1);
  const retained = await scrollTo(first, 0.35); await capture("narrow");
  pass("Reader progress follows real reflow through saved font/width changes, zoom and viewport resizing; exact top and bottom also survive returning to Reader");

  await open(source); const secondId = await host.evaluate("app.workspace.activeLeaf.id"); await button("reader"); let second = await reader(); await restored(second, 0);
  const secondProgress = await scrollTo(second, 0.72);
  await reveal(firstId); first = await reader(); await restored(first, retained);
  await reveal(secondId); second = await reader(); await restored(second, secondProgress);
  const otherUrl = origin + "/reader-story?progress=other#part";
  await host.evaluate(`app.workspace.activeLeaf.setViewState({type:"webviewer",state:{url:${JSON.stringify(otherUrl)},readerMode:true,readerScroll:{url:${JSON.stringify(source)},progress:0.91}},active:true})`);
  await loaded(otherUrl); second = await reader(); await restored(second, 0);
  const beforeInvalid = await host.evaluate(`${view}.getState()`);
  for (const value of [{ url: otherUrl, progress: -1 }, { url: otherUrl, progress: "0.4" }, { url: "file:///private", progress: 0.4 }]) {
    assert.equal(await host.evaluate(`(async()=>{try{await app.workspace.activeLeaf.setViewState({type:"webviewer",state:{...app.workspace.activeLeaf.view.getState(),readerScroll:${JSON.stringify(value)}},active:true});return false}catch{return true}})()`), true);
    assert.deepEqual(await host.evaluate(`${view}.getState()`), beforeInvalid);
  }
  await host.evaluate(`(()=>{const frame=${view}.reader;frame.frame.contentWindow.postMessage({channel:"slopsidian-reader",token:"wrong",kind:"restore-progress",progress:1},"*");frame.frame.contentWindow.postMessage({channel:"slopsidian-reader",token:frame.token,kind:"restore-progress",progress:2},"*");window.dispatchEvent(new MessageEvent("message",{source:window,data:{channel:"slopsidian-reader",token:frame.token,kind:"progress",progress:1}}))})()`);
  await second.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); await restored(second, 0);
  assert.equal(await host.evaluate(`${view}.reader.frame.contentDocument`), null);
  assert.deepEqual(await second.evaluate('(()=>{let blocked=false;try{void parent.app}catch{blocked=true}return{blocked,require:typeof require,process:typeof process}})()'), { blocked: true, require: "undefined", process: "undefined" });
  pass("Same-URL panes keep independent progress, a different exact URL cannot inherit it, invalid state leaves the live pane intact and forged/invalid messages retain opaque-frame isolation");

  await host.evaluate(`app.workspace.closeLeaf(app.workspace.getLeafById(${JSON.stringify(secondId)}))`); await reveal(firstId); first = await reader(); await restored(first, retained);
  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf,state=leaf.view.getState();await leaf.setViewState({type:"webviewer",state:{...state,readerScroll:{...state.readerScroll,future:{keep:[1,true]}},futureProgress:{keep:"leaf"}},active:true});await app.workspace.flushLayout()})()`);
  first = await reader(); await restored(first, retained); await host.evaluate("app.workspace.flushLayout()");
  const layoutBytes = await readFile(join(directory, ".obsidian", "vault-dotnet-workspace.json"), "utf8"); assert.ok(layoutBytes.includes('"readerScroll"')); assert.ok(layoutBytes.includes('"progress"'));
  await restart(); await loaded(source); first = await reader(); await restored(first, retained);
  assert.deepEqual(await host.evaluate(`${view}.getState().readerScroll.future`), { keep: [1, true] }); assert.deepEqual(await host.evaluate(`${view}.getState().futureProgress`), { keep: "leaf" });
  await capture("restored");
  pass("Actual independent workspace persistence and a full Electron/.NET restart restore scroll after the article is laid out, preserving opaque leaf and reading-progress fields");

  const savedSettings = await readFile(settingsPath);
  await settingsList(); await host.click('[data-core-toggle="webviewer"]'); await host.wait('!app.core.busy&&!app.core.isEnabled("webviewer")', "progress provider disabled"); await host.click(".settings-close");
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false);
  await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "progress native contents released");
  await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); first = await reader(); await restored(first, retained);
  const oldName = first.name;
  await host.evaluate(`(()=>{globalThis.oldProgressWindow=${view}.reader.frame.contentWindow;globalThis.oldProgressToken=${view}.reader.token})()`);
  assert.deepEqual(await readFile(settingsPath), savedSettings);
  pass("Disable and disabled-process restart remove Reader/native resources while retaining progress; re-enable restores the saved reading position without changing vault settings");

  const otherVault = join(directory, ".progress-other-vault"); await mkdir(join(otherVault, ".obsidian"), { recursive: true });
  const otherSettings = '{"readerFont":"serif","readerWidth":"standard","enableAdblocking":false,"future":{"keep":"other-vault"}}\n', otherNote = Buffer.from("\ufeff# Keep\r\nReader progress 中文 😀.\r\n");
  await writeFile(join(otherVault, "Keep.md"), otherNote); await writeFile(join(otherVault, ".obsidian", "webviewer.json"), otherSettings);
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(item=>[item.id,["webviewer","command-palette","file-explorer"].includes(item.id)]))')));
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "progress vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "progress vault switch " + path);
  }
  await switchVault(otherVault); await open(source); await button("reader"); const other = await reader(); await restored(other, 0); const otherProgress = await scrollTo(other, 0.7);
  assert.notEqual(other.name, oldName);
  await host.evaluate('window.dispatchEvent(new MessageEvent("message",{source:oldProgressWindow,data:{channel:"slopsidian-reader",token:oldProgressToken,kind:"progress",progress:1}}))'); await restored(other, otherProgress);
  await switchVault(directory); await loaded(source); first = await reader(); await restored(first, retained);
  await switchVault(otherVault); await loaded(source); const otherRestored = await reader(); await restored(otherRestored, otherProgress);
  await switchVault(directory); await loaded(source); first = await reader(); await restored(first, retained);
  assert.deepEqual(await readFile(settingsPath), savedSettings); assert.equal(await readFile(join(otherVault, ".obsidian", "webviewer.json"), "utf8"), otherSettings);
  assert.deepEqual(await readFile(join(otherVault, "Keep.md")), otherNote); assert.deepEqual(await readFile(workspacePath), originalWorkspace);
  assert.ok(requests.every(item => item.token === null)); await host.evaluate("app.workspace.flushLayout()");
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await capture("vault-restored");
  pass("Real vault changes isolate and restore different progress for the same URL, reject old-frame replies and preserve settings/original-workspace/BOM/CRLF/Unicode bytes without token exposure or obsolete workspace saves");
}
