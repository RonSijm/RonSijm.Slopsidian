import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWebZoom({ host, origin, alternateOrigin, targets, connect, restart, until, requests, alternateRequests, directory, pass, capture }) {
  const source = origin + "/reader-story", secondUrl = origin + "/reader-story?zoom-second", view = "app.workspace.activeLeaf.view";
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), settings = await readFile(settingsPath);
  const workspacePath = join(directory, ".obsidian", "workspace.json"), workspace = await readFile(workspacePath);
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "zoom source loaded " + url);
  const factor = value => host.wait(`${view}.getState().zoomFactor===${value}&&${view}.contentEl.querySelector("[data-webviewer-zoom]").textContent===${JSON.stringify(Math.round(value * 100) + "%")}`, "zoom factor " + value);
  const shellScale = () => host.evaluate("devicePixelRatio");
  async function navigate(url) { await host.fill("[data-webviewer-address]", url); await host.click('[data-webviewer-action="go"]'); await loaded(url); }
  async function remotePage(url) {
    let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native zoom page " + url); return connect(target);
  }
  const nativeScale = (remote, value, baseline) => until(async () => Math.abs(await remote.evaluate("devicePixelRatio") / baseline - value) < 0.015, "native physical scale " + value);
  async function reveal(url) {
    await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getState().url===${JSON.stringify(url)}))`); await loaded(url);
  }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"`, "reader ready for zoom");
    const name = await host.evaluate('document.querySelector("[data-webviewer-reader]").name');
    const tree = (await host.command("Page.getFrameTree")).frameTree;
    const find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    try {
      const frame = find(tree); assert.ok(frame);
      const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "zoom-acceptance", grantUniveralAccess: false });
      evaluate = async expression => {
        const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); }
        return result.result.value;
      }; await evaluate("document.title");
    } catch {
      for (const target of (await targets()).filter(target => target.type === "iframe")) {
        const candidate = await connect(target); if (await candidate.evaluate("window.name") === name) { evaluate = expression => candidate.evaluate(expression); break; }
      }
    }
    assert.ok(evaluate, "opaque reader can be inspected independently"); return { evaluate };
  }
  const readerScale = (frame, value) => until(async () => Number(await frame.evaluate('getComputedStyle(document.documentElement).zoom')) === value, "reader physical scale " + value);
  await host.click('[data-core-ribbon="webviewer"]'); await loaded(origin + "/one"); await navigate(source);
  let remote = await remotePage(source), baseDpr = await remote.evaluate("devicePixelRatio");
  const mainDpr = await shellScale(), beforeWidth = await remote.evaluate("innerWidth");
  await remote.fill("#original-input", "Retain input through zoom"); await remote.evaluate('document.cookie="zoomTransient=keep;path=/"');
  const before = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,loads:sessionStorage.readerLoads})');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath = join(directory, ".obsidian", "vault-dotnet-web-history.json"), history = await readFile(historyPath);
  for (let index = 0; index < 3; index++) { await host.click('[data-webviewer-action="zoom-in"]'); }
  await factor(1.3); await nativeScale(remote, 1.3, baseDpr);
  assert.ok(await remote.evaluate("innerWidth") < beforeWidth); assert.equal(await shellScale(), mainDpr);
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,loads:sessionStorage.readerLoads})'), before);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), history);
  await capture("native", remote);
  pass("Real toolbar zoom changes the native page's device-pixel ratio and viewport to 130% while preserving source DOM/input/cookies/load count/history and the editor shell scale");

  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(secondUrl)},true)`); await loaded(secondUrl); await factor(1);
  let second = await remotePage(secondUrl); await nativeScale(second, 1, baseDpr);
  await host.evaluate('app.commands.execute("webviewer:zoom-out")'); await factor(0.9);
  await host.evaluate('app.commands.execute("webviewer:zoom-out")'); await factor(0.8); await nativeScale(second, 0.8, baseDpr);
  await nativeScale(remote, 1.3, baseDpr); await reveal(source); await factor(1.3);
  assert.equal(await shellScale(), mainDpr);
  pass("Independent same-origin tabs keep separate native zoom; owned commands change only the active tab, and returning to a tab retains its percentage");

  await navigate(origin + "/two"); await factor(1.3); await nativeScale(remote, 1.3, baseDpr);
  await navigate(alternateOrigin + "/reader-story"); await factor(1.3); await nativeScale(remote, 1.3, baseDpr);
  await host.click('[data-webviewer-action="reload"]'); await loaded(alternateOrigin + "/reader-story"); await nativeScale(remote, 1.3, baseDpr);
  await host.click('[data-webviewer-action="back"]'); await loaded(origin + "/two"); await nativeScale(remote, 1.3, baseDpr);
  await host.click('[data-webviewer-action="forward"]'); await loaded(alternateOrigin + "/reader-story"); await nativeScale(remote, 1.3, baseDpr);
  await navigate(source); await nativeScale(remote, 1.3, baseDpr); await nativeScale(second, 0.8, baseDpr);
  pass("Native zoom reapplies across same-origin and cross-origin navigation, reload, back and forward without changing a second tab's scale");

  await host.click('[data-webviewer-action="reader"]'); let frame = await reader(); await readerScale(frame, 1.3);
  const headingHeight = await frame.evaluate('document.querySelector("h1").getBoundingClientRect().height');
  await host.click('[data-webviewer-action="zoom-in"]'); await factor(1.4); await readerScale(frame, 1.4);
  assert.ok(await frame.evaluate('document.querySelector("h1").getBoundingClientRect().height') > headingHeight);
  await host.click('[data-webviewer-reader]'); await host.press("+", "Equal", 187, 2); await factor(1.5); await readerScale(frame, 1.5);
  await host.press("-", "Minus", 189, 2); await factor(1.4); await readerScale(frame, 1.4);
  assert.equal(await shellScale(), mainDpr);
  // This owner-origin message deliberately has the wrong session token.
  await host.evaluate('document.querySelector("[data-webviewer-reader]").contentWindow.postMessage({channel:"slopsidian-reader",token:"wrong-token",kind:"zoom",factor:3},"*")');
  await frame.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await readerScale(frame, 1.4);
  await host.click('[data-webviewer-action="find"]'); await host.fill("[data-webviewer-find]", "readneedle");
  await host.wait('document.querySelector("[data-webviewer-matches]").textContent==="1 of 2"', "Reader find at custom zoom");
  await host.click('[data-webviewer-action="find-close"]');
  await host.evaluate('Promise.all(Array.from({length:50},()=>app.commands.execute("webviewer:zoom-in")))'); await factor(3); await readerScale(frame, 3);
  assert.equal(await host.evaluate('document.querySelector("[data-webviewer-action=zoom-in]").disabled'), true);
  await host.evaluate('Promise.all(Array.from({length:60},()=>app.commands.execute("webviewer:zoom-out")))'); await factor(0.5); await readerScale(frame, 0.5);
  assert.equal(await host.evaluate('document.querySelector("[data-webviewer-action=zoom-out]").disabled'), true);
  await host.click('[data-webviewer-action="zoom-reset"]'); await factor(1); await readerScale(frame, 1); await nativeScale(remote, 1, baseDpr);
  await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "return to original after zoom");
  await host.fill("[data-webviewer-address]", source); await host.press("=", "Equal", 187, 2); await factor(1.1); await nativeScale(remote, 1.1, baseDpr);
  await host.press("0", "Digit0", 48, 2); await factor(1); await nativeScale(remote, 1, baseDpr);
  await host.click('[data-webviewer-action="reader"]'); frame = await reader();
  await host.evaluate('Promise.all(Array.from({length:5},()=>app.commands.execute("webviewer:zoom-in")))'); await factor(1.5); await readerScale(frame, 1.5); await capture("reader");
  assert.equal(await host.evaluate('document.querySelector("[data-webviewer-reader]").contentDocument'), null);
  pass("Reader zoom changes actual heading geometry, retains opaque-frame/token isolation and Find, handles Reader/toolbar keyboard input once, clamps rapid commands at 50–300% and resets both surfaces without scaling the editor");

  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),futureZoom:{keep:[1,true]}},active:true});await app.workspace.flushLayout()})()`);
  frame = await reader(); await readerScale(frame, 1.5); await restart(); await loaded(source); await factor(1.5); frame = await reader(); await readerScale(frame, 1.5);
  assert.deepEqual(await host.evaluate(`${view}.getState().futureZoom`), { keep: [1, true] });
  remote = await remotePage(source); second = await remotePage(secondUrl); await nativeScale(remote, 1.5, baseDpr); await nativeScale(second, 0.8, baseDpr);
  await capture("restored");
  await host.click("#open-settings"); await host.click("#core-plugins-tab"); await host.click('[data-core-toggle="webviewer"]');
  await host.wait('!app.core.busy&&!app.core.isEnabled("webviewer")', "zoom provider disabled"); await host.click(".settings-close");
  assert.equal(await host.evaluate('app.commands.listCommands().some(command=>/^webviewer:zoom-/.test(command.id))'), false);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-zoom]"))'), false);
  assert.equal(await host.evaluate(`${view}.getState().zoomFactor`), 1.5);
  await until(async () => !(await targets()).some(target => target.url.startsWith(origin) || target.url.startsWith(alternateOrigin)), "zoom native contents released");
  await restart(); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); await factor(1.5); frame = await reader(); await readerScale(frame, 1.5);
  assert.deepEqual(await host.evaluate(`${view}.getState().futureZoom`), { keep: [1, true] });
  second = await remotePage(secondUrl); await nativeScale(second, 0.8, baseDpr);
  pass("Per-tab native/Reader zoom and opaque leaf fields survive full enabled/disabled process restarts; disable removes all three commands/controls and releases native contents before re-enable restores the actual scales");

  const state = await host.evaluate(`${view}.getState()`);
  for (const value of [null, "1.5", 0.4, 3.1]) {
    assert.equal(await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;try{await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),zoomFactor:${JSON.stringify(value)}},active:true});return false}catch{return true}})()`), true);
    assert.deepEqual(await host.evaluate(`${view}.getState()`), state);
  }
  // A real open modal disables native accelerator ownership for the page.
  await host.click('[data-webviewer-action="clip"]'); await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"', "modal over zoomed Reader");
  await host.wait(`JSON.parse(${view}.lastBounds).active===false`, "modal releases page keyboard ownership"); await host.click('[data-web-clip-action="cancel"]');
  const otherVault = join(directory, ".zoom-other-vault"); await mkdir(join(otherVault, ".obsidian"), { recursive: true });
  await writeFile(join(otherVault, "Keep.md"), "# Other vault\nPreserve exactly.\n");
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(item=>[item.id,false]))')));
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "zoom vault switch " + path);
  }
  await switchVault(otherVault); assert.equal(await host.evaluate('app.commands.listCommands().some(command=>/^webviewer:zoom-/.test(command.id))'), false);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-zoom]"))'), false);
  assert.equal(await readFile(join(otherVault, "Keep.md"), "utf8"), "# Other vault\nPreserve exactly.\n");
  await switchVault(directory); await loaded(source); await factor(1.5); frame = await reader(); await readerScale(frame, 1.5);
  assert.deepEqual(await readFile(settingsPath), settings); assert.deepEqual(await readFile(workspacePath), workspace);
  assert.ok([...requests, ...alternateRequests].every(request => request.token === null)); assert.equal(await shellScale(), mainDpr);
  pass("Invalid persisted factors leave the current view untouched, modals release native zoom accelerators, and real vault switches preserve per-tab zoom without leaking commands/state or rewriting original settings/workspace bytes");
}
