import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { serveReaderFixture } from "./web-reader-fixtures.mjs";
import { serveClipFixture } from "./web-clip-fixtures.mjs";
import { serveAdblockFixture } from "./web-adblock-fixtures.mjs";

export async function createWebViewerPages(vaultOrigin) {
  const requests = [];
  const pages = createServer((request, response) => {
    requests.push({ url: request.url, token: request.headers["x-vault-token"] ?? null, destination: request.headers["sec-fetch-dest"] ?? null });
    if (serveReaderFixture(request, response, vaultOrigin)) { return; }
    if (serveClipFixture(request, response)) { return; }
    if (serveAdblockFixture(request, response, vaultOrigin)) { return; }
    if (request.url === "/redirect-vault") { response.writeHead(302, { Location: vaultOrigin() + "/api/vault" }); response.end(); return; }
    if (request.url === "/redirect-history") { response.writeHead(302, { Location: "/two?redirect" }); response.end(); return; }
    if (request.url === "/failure-history") { response.writeHead(500, { "Content-Type": "text/html" }); response.end("<title>Failed fixture</title>Failed page"); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const second = request.url?.startsWith("/two");
    response.end(`<!doctype html><html><head><title>Viewer fixture ${second ? "Two" : "One"}</title></head><body style="font:20px sans-serif;padding:30px"><h1>Viewer fixture ${second ? "Two" : "One"}</h1><p>Findneedle is here. Findneedle is repeated.</p><a id="next" href="/two">Go to page two</a><p><a id="hash" href="#anchor">Same-page heading</a></p><p><a id="popup" href="/two?popup" target="_blank">Open another target</a></p><p><a id="unsafe" href="file:///C:/vault/secret.md">Blocked local file</a></p><input id="page-input" aria-label="Page input"><div id="reload-count"></div><script>sessionStorage.reloads=String(Number(sessionStorage.reloads||0)+1);document.querySelector('#reload-count').textContent=sessionStorage.reloads;</script></body></html>`);
  });
  await new Promise((resolve, reject) => { pages.once("error", reject); pages.listen(0, "127.0.0.1", resolve); });
  const address = pages.address();
  assert.ok(address && typeof address !== "string");
  return { origin: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((resolve, reject) => pages.close(error => error ? reject(error) : resolve())) };
}

export async function connectWebViewerTarget(target, until) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  let serial = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) { return; }
    const item = pending.get(message.id);
    if (item) {
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) { item.reject(new Error(JSON.stringify(message.error))); }
      else { item.resolve(message.result); }
    }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timed out: " + method)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); }
    return result.result.value;
  };
  const wait = (expression, label = expression) => until(() => evaluate(`Boolean(${expression})`), label);
  const press = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    await command("Page.bringToFront");
    await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode, modifiers });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
  };
  const click = async selector => {
    await wait(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()&&!document.querySelector(${JSON.stringify(selector)}).disabled`, selector);
    const point = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:"nearest"});const b=element.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    await command("Page.bringToFront");
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const fill = async (selector, value) => {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: value });
  };
  return { socket, command, evaluate, wait, press, click, fill };
}

/** Force a real same-URL status update at the Go-focus boundary. */
export async function checkWebAddressDraft(host, url) {
  await host.fill("[data-webviewer-address]", url);
  await host.evaluate(`(()=>{const view=app.workspace.activeLeaf.view;
    view.contentEl.querySelector('[data-webviewer-action="go"]').addEventListener("focus",()=>{
      view.ipc.emit("webviewer:event",{}, {id:view.id,state:{url:view.url,title:view.title,loading:view.loading,
        navigationId:view.navigationId,canGoBack:!view.back.disabled,canGoForward:!view.forward.disabled,error:view.message.textContent,
        zoomFactor:view.zoomFactor,zoomRevision:view.zoomRevision,adBlocking:{enabled:view.adBlockingWanted===true,
          status:view.adBlockingStatus.dataset.webviewerAdblocking,blockedRequests:Number(view.adBlockingStatus.dataset.blockedRequests),revision:view.adBlockingRevision}}});
    },{once:true});
  })()`);
  await host.click('[data-webviewer-action="go"]');
  assert.equal(await host.evaluate('app.workspace.activeLeaf.view.address.value'), url, "Same-URL native status updates must not replace a typed address before Go submits");
}

export async function checkWebViewer(tools) {
  const { host, origin, targets, connect, restart, until, requests, directory, originalWorkspace, capture, pass,
    note = "Welcome.md", runCase = async (_id, action) => action() } = tools;
  const view = 'app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getViewType()==="webviewer")?.view';
  const originalSettings = JSON.parse(await readFile(join(directory, ".obsidian", "webviewer.json"), "utf8"));
  async function toggle(enabled) {
    await host.click("#open-settings");
    await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    if (await host.evaluate('app.core.isEnabled("webviewer")') !== enabled) {
      await host.click('[data-core-toggle="webviewer"]');
    }
    await host.wait(`!app.core.busy&&app.core.isEnabled("webviewer")===${enabled}`, "Web viewer toggled");
    await host.click(".settings-close");
  }
  async function loaded(url) {
    await host.wait(`${view}?.getState().url===${JSON.stringify(url)}&&document.querySelector(".webviewer")?.dataset.webviewerLoading==="false"&&!document.querySelector("[data-webviewer-error]").textContent`, "page loaded: " + url);
  }
  async function navigate(url) {
    await host.fill("[data-webviewer-address]", url);
    await host.click('[data-webviewer-action="go"]');
    await loaded(url);
  }
  async function remotePage() {
    let target;
    await until(async () => { target = (await targets()).find(item => item.url.startsWith(origin)); return target; }, "isolated browser page");
    return connect(target);
  }
  let remote;
  await runCase("webviewer:settings", async () => {
    assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id==="webviewer:open")'), false);
    await toggle(true);
    await host.click("#open-settings");
    await host.click("#core-plugins-tab");
    await host.click('[data-core-settings="webviewer"]');
    await host.fill('[data-core-field="homepage"]', origin + "/one");
    await host.fill('[data-core-field="searchEngine"]', "custom");
    await host.fill('[data-core-field="customSearchEngine"]', origin + "/one?q=%s");
    await host.click('[data-core-save="webviewer"]');
    await host.wait('!app.core.busy&&app.core.state("webviewer").settings.homepage===' + JSON.stringify(origin + "/one"));
    const stored = JSON.parse(await readFile(join(directory, ".obsidian", "webviewer.json"), "utf8"));
    assert.equal(stored.homepage, origin + "/one");
    assert.equal(stored.searchEngine, "custom");
    assert.equal(stored.customSearchEngine, origin + "/one?q=%s");
    for (const [key, value] of Object.entries(originalSettings)) {
      if (!["homepage", "searchEngine", "customSearchEngine"].includes(key)) { assert.deepEqual(stored[key], value); }
    }
    await host.click(".settings-close");
    await host.click('[data-core-ribbon="webviewer"]');
    await loaded(origin + "/one");
    remote = await remotePage();
    assert.deepEqual(await remote.evaluate('({require:typeof require,process:typeof process,opener:window.opener})'), { require: "undefined", process: "undefined", opener: null });
    assert.equal(await remote.evaluate('document.querySelector("h1").textContent'), "Viewer fixture One");
    const size = await remote.evaluate('({width:innerWidth,height:innerHeight})');
    assert.ok(size.width > 100 && size.height > 100, "Native page occupies the real pane");
    pass("Real desktop pane, persisted homepage/search settings and a sandboxed remote page without Node or an opener");
  });

  await runCase("webviewer:browse", async () => {
    const firstLeaf = await host.evaluate(`${view}.leaf.id`);
    await remote.evaluate('document.cookie="isolated=first;path=/"');
    await host.click(`[data-tab-path="${note}"]`);
    await host.wait(`app.workspace.activeLeaf.view.file?.path===${JSON.stringify(note)}`, "fixture note is active");
    await host.wait(`JSON.parse(app.workspace.getLeafById(${JSON.stringify(firstLeaf)}).view.lastBounds).visible===false`, "inactive browser surface is hidden");
    const notePane = `.workspace-leaf[data-leaf-id=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}]`;
    assert.equal(await host.evaluate("app.workspace.activeLeaf.view.getMode()"), "source");
    await host.click(`${notePane} [data-workspace-action="toggle-reading-view"]`);
    await host.wait('app.workspace.activeLeaf.view.getMode()==="preview"', "fixture note is in Reading view");
    await host.click(`${notePane} a[href="${origin}/one"]`);
    await host.wait('app.workspace.activeLeaf.view.getViewType()==="webviewer"', "Reading link opens the actual provider");
    assert.equal((await targets()).filter(target => target.url.startsWith(origin)).length, 2);
    await host.evaluate(`app.workspace.closeLeaf(app.workspace.getLeafById(${JSON.stringify(firstLeaf)}))`);
    await loaded(origin + "/one");
    remote = await remotePage();
    assert.equal(await remote.evaluate("document.cookie"), "", "Browser panes use separate ephemeral sessions");
    pass("Switching tabs hides the native surface; Reading links open Web viewer and separate panes do not share website cookies");

    await remote.click("#next"); await loaded(origin + "/two");
    assert.equal(await remote.evaluate('document.querySelector("h1").textContent'), "Viewer fixture Two");
    await host.click('[data-webviewer-action="back"]'); await loaded(origin + "/one");
    await host.click('[data-webviewer-action="forward"]'); await loaded(origin + "/two");
    const count = await remote.evaluate('Number(sessionStorage.reloads)');
    await host.click('[data-webviewer-action="reload"]');
    await remote.wait(`Number(sessionStorage.reloads)>${count}`); await loaded(origin + "/two");
    await remote.click("#page-input");
    await remote.wait('document.hasFocus()&&document.activeElement.id==="page-input"', "native page receives keyboard focus");
    await host.click("[data-webviewer-address]");
    await host.press("f", "KeyF", 70, 2);
    await host.wait('document.querySelector(".webviewer-find").checkVisibility()', "Ctrl+F in browser controls opens page find");
    await host.fill("[data-webviewer-find]", "Findneedle");
    await host.wait('document.querySelector("[data-webviewer-matches]").textContent.endsWith("of 2")', "native find count");
    await host.click('[data-webviewer-action="find-next"]');
    await host.click('[data-webviewer-action="find-previous"]');
    await host.click('[data-webviewer-action="find-close"]');
    pass("Pointer navigation, native back/forward and reload, Ctrl+F and actual find-in-page matches");

    await remote.click("#popup"); await loaded(origin + "/two?popup");
    assert.equal((await targets()).filter(target => target.url.startsWith(origin)).length, 1);
    await remote.click("#unsafe");
    assert.equal(await remote.evaluate("location.href"), origin + "/two?popup", "Chromium refuses remote-page file links");
    await host.fill("[data-webviewer-address]", "file:///C:/vault/secret.md");
    await host.click('[data-webviewer-action="go"]');
    await host.wait('document.querySelector("[data-webviewer-error]").textContent.includes("only opens")', "unsupported address rejected visibly");
    await navigate(origin + "/one");
    const localEndpoint = await host.evaluate("location.origin");
    await assert.rejects(() => host.evaluate(`${view}.leaf.setViewState({type:"webviewer",state:{url:${JSON.stringify(localEndpoint + "/api/vault")}}})`), /cannot access the local application/);
    await remote.evaluate(`location.href=${JSON.stringify(origin + "/redirect-vault")}`);
    await host.wait('document.querySelector("[data-webviewer-error]").textContent.length>0', "redirect to the vault service blocked visibly");
    await navigate(origin + "/one");
    assert.ok(requests.every(request => request.token === null), "No remote request gets a vault token");
    pass("New-window links stay contained; file links, vault-service navigation and redirects are blocked; no vault token reaches pages");

    await host.fill("[data-webviewer-address]", "two & words");
    await host.click('[data-webviewer-action="go"]');
    const savedUrl = origin + "/one?q=two%20%26%20words";
    await loaded(savedUrl);
    await host.evaluate(`(async()=>{const leaf=${view}.leaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),future:{keep:[1,true]}}});await app.workspace.flushLayout()})()`);
    await restart(); await loaded(savedUrl);
    assert.deepEqual(await host.evaluate(`${view}.getState().future`), { keep: [1, true] });
    assert.equal(await host.evaluate('app.core.state("webviewer").settings.homepage'), origin + "/one");
    assert.equal(await host.evaluate('app.core.state("webviewer").settings.customSearchEngine'), origin + "/one?q=%s");
    remote = await remotePage();
    await remote.wait('document.title==="Viewer fixture One"');
    await capture(remote);
    await host.click("#open-settings");
    await host.wait(`JSON.parse(${view}.lastBounds).visible===false`, "native surface hides under the settings modal");
    await host.click("#core-plugins-tab");
    await host.click(".settings-close");
    await host.wait(`JSON.parse(${view}.lastBounds).visible===true`, "native surface returns after the modal closes");
    pass("Configured search safely encodes input; a full Electron/.NET restart restores URL, title, settings and unknown nested leaf state");

    await toggle(false);
    await until(async () => !(await targets()).some(target => target.url.startsWith(origin)), "all native browser contents destroyed on disable");
    assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id.startsWith("webviewer:"))'), false);
    assert.equal(await host.evaluate('Boolean(document.querySelector("[data-core-ribbon=webviewer]"))'), false);
    assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer")[0].view.getViewType()'), "unavailable");
    await host.evaluate("app.workspace.flushLayout()");
    await restart();
    assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
    await toggle(true); await loaded(savedUrl);
    await host.evaluate(`(async()=>{await app.workspace.closeLeaf(${view}.leaf);await app.workspace.flushLayout()})()`);
    await until(async () => !(await targets()).some(target => target.url.startsWith(origin)), "closed browser pane releases native contents");
    assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace);
    const settings = JSON.parse(await readFile(join(directory, ".obsidian", "webviewer.json"), "utf8"));
    for (const [key, value] of Object.entries(originalSettings)) {
      if (!["homepage", "searchEngine", "customSearchEngine"].includes(key)) { assert.deepEqual(settings[key], value); }
    }
    pass("Disable/enable and disabled process restart preserve unavailable leaf state, remove owned commands/ribbon and release browser contents; original workspace/settings data survive");
  });
}
