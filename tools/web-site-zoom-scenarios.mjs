import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkSiteZoom({ host, origin, alternateOrigin, requests, alternateRequests, targets, connect, restart, until, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", provider = 'app.core.getEnabledPluginById("webviewer")', preferences = provider + ".siteZoom";
  const key = "webviewer-site-zoom-v1", config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const source = origin + "/reader-story?site-zoom=first", second = origin + "/reader-story?site-zoom=second", other = alternateOrigin + "/reader-story?site-zoom=other";
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const keep = Buffer.from("\ufeff# Site zoom keep\r\n中文 😀 exact bytes.\r\n");
  await writeFile(join(directory, "Site zoom keep.md"), keep, { flag: "wx" });
  let pane, firstId, secondId, otherId;
  const selector = child => pane + " " + child, button = action => host.click(selector('[data-webviewer-action="' + action + '"]'));
  const profile = () => host.evaluate("app.loadLocalStorage(" + JSON.stringify(key) + ")");
  const requestCount = () => requests.length + alternateRequests.length;
  async function toggle(enabled) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    if (await host.evaluate('app.core.isEnabled("webviewer")') !== enabled) { await host.click('[data-core-toggle="webviewer"]'); }
    await host.wait('!app.core.busy&&app.core.isEnabled("webviewer")===' + enabled, "site zoom provider toggle");
    await host.click(".settings-close");
  }
  async function loaded(url) {
    await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".url===" + JSON.stringify(url) + "&&!" + active + ".loading&&!" + active + ".message.textContent&&!" + active + ".siteZoomButton.disabled", "site zoom page loaded " + url);
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function open(url) { await host.evaluate(provider + ".openUrl(" + JSON.stringify(url) + ",true)"); await loaded(url); }
  async function reveal(id, url) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await loaded(url); }
  const factor = value => host.wait(active + ".zoomFactor===" + value + "&&" + active + '.zoomResetButton.textContent===' + JSON.stringify(Math.round(value * 100) + "%"), "site zoom factor " + value);
  async function setFactor(value) {
    const current = await host.evaluate(active + ".zoomFactor"), steps = Math.round((value - current) * 10);
    for (let index = 0; index < Math.abs(steps); index++) { await button(steps > 0 ? "zoom-in" : "zoom-out"); }
    await factor(value);
  }
  async function menu() { await button("site-zoom"); await host.wait('Boolean(document.querySelector("[data-web-site-zoom-menu]"))', "Site zoom menu open"); }
  async function choose(title, keyboard = false) {
    await menu();
    if (keyboard) { await host.press("Enter", "Enter", 13); }
    else { await host.click("[data-web-site-zoom-menu] [data-menu-title=" + JSON.stringify(title) + "]"); }
    await host.wait('!document.querySelector("[data-web-site-zoom-menu]")', "Site zoom menu closed");
    await host.wait(preferences + ".native().revision===" + preferences + ".generation", "site zoom profile ready");
  }
  async function remember(value, keyboard = false) { await setFactor(value); await choose("Remember " + Math.round(value * 100) + "% for this site", keyboard); await host.wait(preferences + ".get(" + JSON.stringify(await host.evaluate(active + ".url")) + ")===" + value, "site zoom remembered"); }
  async function navigate(url) { await host.fill(selector("[data-webviewer-address]"), url); await button("go"); await loaded(url); }
  async function reload(url) { const before = await host.evaluate(active + ".navigationId"); await button("reload"); await host.wait(active + ".navigationId>" + before + "&&!" + active + ".loading", "site zoom fresh reload"); await loaded(url); }
  async function remotePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native site zoom page"); return connect(target); }
  const nativeScale = (remote, value, baseline) => until(async () => Math.abs(await remote.evaluate("devicePixelRatio") / baseline - value) < .015, "native site zoom pixels " + value);
  async function reader() {
    await host.wait(active + '.contentEl.dataset.webviewerReaderMode==="reader"&&' + active + ".reader.progressReady", "site zoom Reader ready");
    const name = await host.evaluate(active + ".reader.frame.name"), find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "site-zoom-acceptance", grantUniveralAccess: false });
        const candidate = async expression => {
          const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value;
        };
        if (await candidate("window.name===" + JSON.stringify(name) + '&&Boolean(document.querySelector("main article"))')) { evaluate = candidate; }
      } catch { /* A workspace move may replace the iframe's debugging context. */ }
      if (!evaluate) { for (const target of (await targets()).filter(item => item.type === "iframe")) { const candidate = await connect(target); if (await candidate.evaluate("window.name===" + JSON.stringify(name))) { evaluate = expression => candidate.evaluate(expression); break; } } }
      return Boolean(evaluate);
    }, "independent site zoom Reader inspection");
    return { name, evaluate };
  }
  const position = frame => frame.evaluate("(()=>{const root=document.scrollingElement,distance=root.scrollHeight-root.clientHeight;return{top:root.scrollTop,distance,progress:distance>0?root.scrollTop/distance:0}})()");
  const restored = (frame, value) => until(async () => Math.abs((await position(frame)).progress - value) < .008, "site zoom Reader progress " + value);
  async function clipBody() {
    await button("clip"); await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "site zoom literal clip preview");
    if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
    const value = await host.evaluate('document.querySelector("[data-web-clip-preview]").value'); await host.click('[data-web-clip-action="cancel"]');
    await host.wait('!document.querySelector("[data-web-clip]")', "site zoom clip cancelled"); return value;
  }
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "site zoom vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "site zoom vault selected");
  }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await toggle(true); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate(provider + ".history.whenIdle()");
  const history = Buffer.from('\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":["中文",true]}}\r\n');
  await writeFile(historyPath, history);
  assert.equal(await profile(), null);
  await host.evaluate('app.saveLocalStorage("site-zoom-canary-v1",{keep:["中文",true]})');
  await open(source); firstId = await host.evaluate("app.workspace.activeLeaf.id"); await factor(1);
  let firstRemote = await remotePage(source), baseline = await firstRemote.evaluate("devicePixelRatio");
  const shell = await host.evaluate("devicePixelRatio");
  await firstRemote.fill("#original-input", "Keep site zoom input"); await firstRemote.evaluate('document.cookie="siteZoomPrivate=keep;path=/"');
  const original = await firstRemote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,loads:sessionStorage.readerLoads,node:typeof require,opener:window.opener===null})');
  await setFactor(1.3); await nativeScale(firstRemote, 1.3, baseline); await menu(); await capture("menu");
  assert.equal(await host.evaluate('document.querySelector("[data-web-site-zoom-menu] [data-menu-title=\\"Forget zoom for this site\\"]").disabled'), true);
  await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-site-zoom-menu]")', "Escape site zoom menu");
  assert.equal(await host.evaluate("document.activeElement.dataset.webviewerAction"), "site-zoom"); assert.equal(await profile(), null);
  const count = requestCount(); await remember(1.3, true);
  assert.equal(requestCount(), count); assert.deepEqual((await profile()).entries, [{ origin, factor: 1.3 }]);
  assert.deepEqual(await firstRemote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,cookie:document.cookie,loads:sessionStorage.readerLoads,node:typeof require,opener:window.opener===null})'), original);
  assert.equal(await host.evaluate("devicePixelRatio"), shell); assert.equal(original.node, "undefined"); assert.equal(original.opener, true);
  await open(second); secondId = await host.evaluate("app.workspace.activeLeaf.id"); await factor(1.3);
  const secondRemote = await remotePage(second); await nativeScale(secondRemote, 1.3, baseline); await setFactor(.9);
  assert.equal(await host.evaluate(preferences + ".get(" + JSON.stringify(source) + ")"), 1.3);
  assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").view.zoomFactor"), 1.3);
  await reload(second); await factor(1.3); await nativeScale(secondRemote, 1.3, baseline);
  assert.deepEqual(await readFile(historyPath), history);
  pass("Actual Site zoom pointer/keyboard menus show the reviewed origin/current percentage, Escape restores focus without saving, and remembered 130% changes real native pixels without reload/DOM/input/cookie/history/shell changes; new same-origin tabs and reload apply the preset while manual tab changes stay independent until explicitly saved");

  await open(other); otherId = await host.evaluate("app.workspace.activeLeaf.id"); await factor(1); await remember(2);
  const otherRemote = await remotePage(other); await nativeScale(otherRemote, 2, baseline);
  await navigate(source + "&new-path=1"); await factor(1.3);
  await button("back"); await loaded(other); await factor(2); await button("forward"); await loaded(source + "&new-path=1"); await factor(1.3);
  await navigate(alternateOrigin + "/reader-story?unremembered-path"); await factor(2); await navigate(source); await factor(1.3);
  const beforeForget = requestCount(); await choose("Forget zoom for this site", true);
  assert.equal(await host.evaluate(preferences + ".get(" + JSON.stringify(source) + ")"), null); await factor(1.3); assert.equal(requestCount(), beforeForget);
  await open(source + "&fresh-unremembered"); await factor(1);
  await menu(); assert.equal(await host.evaluate('document.querySelector("[data-web-site-zoom-menu] [data-menu-title=\\"Forget zoom for this site\\"]").disabled'), true);
  await host.press("Escape", "Escape", 27);
  await choose("Clear saved site zoom"); assert.equal(await profile(), null); await factor(1);
  await remember(1.3); await reveal(otherId, source); await navigate(other); await remember(2); await nativeScale(otherRemote, 2, baseline);
  await capture("origins"); assert.deepEqual(await readFile(historyPath), history);
  pass("Saved zoom distinguishes exact scheme/host/port origins and applies on actual cross-origin Go/Back/Forward/Reload with shared path/query scope; Forget and Clear retain the current page factor without requests, a fresh unremembered tab defaults to 100%, and new explicit presets restore independently of paused history");

  await reveal(firstId, source); await factor(1.3); await button("reader"); let frame = await reader();
  const markdown = await clipBody(), beforePosition = await position(frame); assert.ok(beforePosition.distance > 100);
  const point = await host.evaluate("(()=>{const r=" + active + ".reader.frame.getBoundingClientRect();return{x:r.x+r.width*.55,y:r.y+r.height*.65}})()");
  await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await host.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: beforePosition.distance * .3 - beforePosition.top });
  await until(async () => { const measured = (await position(frame)).progress; return measured > .05 && measured < .95; }, "real site zoom Reader wheel movement");
  await until(async () => Math.abs((await host.evaluate(active + ".readerScroll?.progress")) - (await position(frame)).progress) < .008, "wheel progress reached site zoom owner");
  let progress = (await position(frame)).progress; const readerName = frame.name;
  await reveal(secondId, second); await remember(1.6);
  await host.wait("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").view.zoomFactor===1.6", "hidden same-origin Reader zoom");
  await reveal(firstId, source); frame = await reader(); assert.equal(frame.name, readerName);
  await until(async () => Number(await frame.evaluate("getComputedStyle(document.documentElement).zoom")) === 1.6, "physical Reader site zoom");
  await restored(frame, progress); assert.equal(await clipBody(), markdown); assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(otherId) + ").view.zoomFactor"), 2);
  const steadyRequests = requestCount(); await button("find"); await host.fill(selector("[data-webviewer-find]"), "Readneedle");
  await host.wait(active + '.findResult.textContent==="1 of 2"', "Find at remembered Reader zoom"); await button("find-close");
  await frame.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  await until(async () => Math.abs((await host.evaluate(active + ".readerScroll?.progress")) - (await position(frame)).progress) < .008, "post-Find progress reaches owner");
  progress = (await position(frame)).progress;
  await host.evaluate("globalThis.obsoleteSiteZoomOwner=" + active + ";globalThis.obsoleteSiteZoomReview=" + active + ".siteZoomReview();undefined");
  await setFactor(1.7);
  const beforeObsolete = await profile();
  assert.equal(await host.evaluate('(()=>{try{obsoleteSiteZoomOwner.saveSiteZoom(obsoleteSiteZoomReview,"remember");return false}catch{return true}})()'), true);
  assert.deepEqual(await profile(), beforeObsolete);
  await host.evaluate("globalThis.obsoleteSiteZoomReview=" + active + ".siteZoomReview();undefined"); await navigate(source + "&different-document");
  assert.equal(await host.evaluate('(()=>{try{obsoleteSiteZoomOwner.saveSiteZoom(obsoleteSiteZoomReview,"remember");return false}catch{return true}})()'), true);
  await factor(1.6); await navigate(source); await factor(1.6); frame = await reader(); await restored(frame, progress);
  const countBeforeMenu = requestCount(); await menu(); await host.press("Escape", "Escape", 27); assert.equal(requestCount(), countBeforeMenu);
  await capture("reader"); assert.ok(requestCount() >= steadyRequests); assert.deepEqual(await readFile(historyPath), history);
  pass("Remembering a new origin factor updates an existing hidden Reader and matching native tabs in place while another origin retains its scale; real wheel progress, frame identity, Find and exact clipping survive, obsolete zoom/navigation reviews refuse before profile writes, and preference menus make no requests or history changes");

  const sourceProfile = await profile(); await host.evaluate("app.workspace.flushLayout()"); await restart();
  firstId = await host.evaluate('app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getState().url===' + JSON.stringify(source) + ").id");
  await reveal(firstId, source); await factor(1.6); frame = await reader(); await restored(frame, progress);
  firstRemote = await remotePage(source); await nativeScale(firstRemote, 1.6, baseline); assert.deepEqual(await profile(), sourceProfile);
  await toggle(false); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); assert.deepEqual(await profile(), sourceProfile);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-action=site-zoom]"))'), false);
  await toggle(true); await reveal(firstId, source); await factor(1.6); frame = await reader(); await restored(frame, progress);
  await host.evaluate("globalThis.foreignSiteZoomOwner=" + active + ";globalThis.foreignSiteZoomReview=" + active + ".siteZoomReview();undefined");
  const target = join(directory, ".site-zoom-other-vault"), targetConfig = join(target, ".obsidian");
  const targetSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"site zoom target"}}\r\n'), targetNote = Buffer.from("\ufeff# Keep\r\nTarget 中文 😀.\r\n");
  await mkdir(targetConfig, { recursive: true }); await writeFile(join(targetConfig, "webviewer.json"), targetSettings); await writeFile(join(target, "Keep.md"), targetNote);
  await writeFile(join(targetConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  await writeFile(join(targetConfig, "vault-dotnet-web-history.json"), history);
  await switchVault(target); assert.equal(await profile(), null); await open(source); await factor(1); await remember(.8);
  const targetProfile = await profile();
  assert.equal(await host.evaluate('(()=>{try{foreignSiteZoomOwner.saveSiteZoom(foreignSiteZoomReview,"clear");return false}catch{return true}})()'), true);
  assert.deepEqual(await profile(), targetProfile); await switchVault(directory); await reveal(firstId, source); await factor(1.6); frame = await reader(); await restored(frame, progress);
  assert.deepEqual(await profile(), sourceProfile); await switchVault(target);
  const targetId = await host.evaluate('app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getState().url===' + JSON.stringify(source) + ").id");
  await reveal(targetId, source); await factor(.8); assert.deepEqual(await profile(), targetProfile);
  await switchVault(directory); await reveal(firstId, source); await factor(1.6); frame = await reader(); await restored(frame, progress);
  await menu(); await capture("restored"); await host.press("Escape", "Escape", 27);
  assert.deepEqual(await profile(), sourceProfile); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(directory, "Site zoom keep.md")), keep); assert.deepEqual(await readFile(join(targetConfig, "webviewer.json")), targetSettings);
  assert.deepEqual(await readFile(join(target, "Keep.md")), targetNote); assert.deepEqual(await readFile(join(targetConfig, "vault-dotnet-web-history.json")), history);
  assert.deepEqual(await host.evaluate('app.loadLocalStorage("site-zoom-canary-v1")'), { keep: ["中文", true] });
  const state = await host.evaluate(active + ".getState()"); assert.equal(Object.hasOwn(state, "siteZoom"), false); assert.equal(Object.hasOwn(state, "entries"), false);
  assert.ok([...requests, ...alternateRequests].every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated actual same-origin vault switches restore independent saved factors and Reader progress; disabled controls disappear, foreign reviewed callbacks refuse, and exact history/notes/settings/original-workspace/profile canaries/BOM/CRLF/Unicode bytes survive without placing the preference map in normal leaf state");
}
