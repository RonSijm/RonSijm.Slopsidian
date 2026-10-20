import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { createRequire, Module } from "node:module";
import { join } from "node:path";
import { root } from "./host.mjs";

const require = createRequire(import.meta.url);
const endpoint = "http://127.0.0.1:5123", id = "11111111-2222-3333-4444-555555555555";
const windows = [];
let windowSerial = 0;

function fakeContents() {
  const contents = new EventEmitter();
  Object.assign(contents, {
    id: ++windowSerial, destroyed: false, isDestroyed() { return this.destroyed; }, loadURL: () => Promise.resolve(), getURL: () => "https://example.com/", getTitle: () => "Example",
    isLoading: () => false, isLoadingMainFrame: () => false, navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    setZoomFactor() {}, setWindowOpenHandler() {}, getZoomFactor() { return 1; }, close() { this.destroyed = true; }, focus() { this.focused = (this.focused ?? 0) + 1; }, send() {},
    session: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, webRequest: { onBeforeRequest() {} }, clearStorageData: async () => {}, clearCache: async () => {}, closeAllConnections: async () => {} }),
  });
  return contents;
}

function fakeWindow(url = endpoint + "/", zoom = 1, size = [800, 600]) {
  const win = new EventEmitter(), children = new Set();
  win.webContents = fakeContents(); win.webContents.mainFrame = { url }; win.webContents.getZoomFactor = () => zoom; win.webContents.getURL = () => url;
  win.children = children; win.destroyed = false; win.failAdd = false; win.id = ++windowSerial; win.title = "window-" + win.id; win.getTitle = () => win.title;
  win.isDestroyed = () => win.destroyed; win.getContentSize = () => size;
  win.contentView = { get children() { return [...children]; }, addChildView: view => { if (win.failAdd) { throw new Error("native add failed"); } children.add(view); }, removeChildView: view => children.delete(view) };
  windows.push(win);
  return win;
}

function load(t) {
  const handlers = new Map(), views = [];
  class FakeView { constructor() { this.webContents = fakeContents(); this.bounds = null; this.visible = null; views.push(this); } setBounds(bounds) { this.bounds = bounds; } setVisible(value) { this.visible = value; } setBackgroundColor() {} }
  const electron = { WebContentsView: FakeView, BrowserWindow: { getAllWindows: () => windows }, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler() {}, on() {} }, shell: {}, nativeImage: {}, app: { getPath: () => "." }, net: {}, session: {} };
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === "electron" ? electron : original.call(this, request, ...rest); };
  const path = join(root, "desktop", "web-viewer.cjs");
  delete require.cache[require.resolve(path)];
  let installWebViewer;
  try { ({ installWebViewer } = require(path)); } finally { Module._load = original; }
  t.after(() => { delete require.cache[require.resolve(path)]; });
  return { installWebViewer, handlers, views };
}

async function fixture(t, inspect = false) {
  windows.length = 0;
  const { installWebViewer, handlers, views } = load(t);
  const main = fakeWindow(), pop = fakeWindow(endpoint + "/popout", 1.5, [400, 300]), pops = new Map([["slopsidian-popout-a", pop]]);
  installWebViewer(main, endpoint, { popouts: { get: name => pops.get(name) }, ...(inspect ? { inspect: true } : {}) });
  const handler = handlers.get("webviewer:request"), event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  const request = (action, values = {}) => handler(event, { id, action, ...values });
  await request("create", { url: "https://example.com/", enableAdblocking: false });
  const view = views[0], bounds = { visible: true, active: true, x: 10, y: 20, width: 200, height: 100 };
  return { main, pop, pops, request, view, bounds };
}

test("the smoke-only inspect action reports the actual BrowserWindow contentView that holds the guest and is refused outside smoke", async t => {
  const { main, pop, request, view, bounds } = await fixture(t, true);
  const home = await request("inspect");
  assert.deepEqual(home.owners.map(owner => [owner.id, owner.main]), [[main.id, true]]);
  assert.equal(home.guestWebContentsId, view.webContents.id); assert.equal(home.mainWindowId, main.id);
  await request("bounds", { bounds, host: "slopsidian-popout-a" });
  pop.title = "unique-title";
  const moved = await request("inspect");
  assert.deepEqual(moved.owners, [{ id: pop.id, main: false, title: "unique-title" }]);
  assert.equal(moved.guestWebContentsId, home.guestWebContentsId);
  pop.destroyed = true;
  assert.deepEqual((await request("inspect")).owners, [], "a destroyed window is not reported as an owner");
});

test("inspect reports the physical contentView, not the requested host, when a native add failed", async t => {
  const { main, pop, request, bounds } = await fixture(t, true);
  pop.failAdd = true;
  await assert.rejects(request("bounds", { bounds, host: "slopsidian-popout-a" }), /native add failed/);
  assert.deepEqual((await request("inspect")).owners.map(owner => owner.id), [main.id]);
});

test("inspect is unavailable unless the desktop smoke harness enabled it", async t => {
  const { request } = await fixture(t);
  await assert.rejects(request("inspect"), /only available to the desktop smoke harness/);
});

test("a guest follows its popout: owner, bounds and zoom come from the hosting BrowserWindow and it returns to main without a host", async t => {
  const { main, pop, request, view, bounds } = await fixture(t);
  assert.ok(main.children.has(view));
  await request("bounds", { bounds, host: "slopsidian-popout-a" });
  assert.ok(pop.children.has(view) && !main.children.has(view));
  assert.equal(view.visible, true); assert.ok(view.bounds.width > 0);
  await request("bounds", { bounds });
  assert.ok(main.children.has(view) && !pop.children.has(view));
});

test("a missing, destroyed, malformed or foreign popout host is refused and leaves the guest where it was", async t => {
  const { main, pop, pops, request, view, bounds } = await fixture(t);
  for (const host of ["slopsidian-popout-missing", "other", 5, "slopsidian-popout-a/../x"]) {
    await assert.rejects(request("bounds", { bounds, host }), /popout window.*not open|not open/);
    assert.ok(main.children.has(view) && !pop.children.has(view));
  }
  pop.destroyed = true;
  await assert.rejects(request("bounds", { bounds, host: "slopsidian-popout-a" }), /not open/);
  assert.ok(main.children.has(view));
  pops.clear();
});

test("a native add failure restores the guest to its previous window and surfaces the error", async t => {
  const { main, pop, request, view, bounds } = await fixture(t);
  pop.failAdd = true;
  await assert.rejects(request("bounds", { bounds, host: "slopsidian-popout-a" }), /native add failed/);
  assert.ok(main.children.has(view) && !pop.children.has(view));
  pop.failAdd = false;
  await request("bounds", { bounds, host: "slopsidian-popout-a" });
  assert.ok(pop.children.has(view));
});

test("an approved popout close hands hosted guests back to main hidden; a vetoed close keeps them", async t => {
  const { main, pop, request, view, bounds } = await fixture(t);
  await request("bounds", { bounds, host: "slopsidian-popout-a" });
  pop.emit("close", { defaultPrevented: true });
  assert.ok(pop.children.has(view), "a vetoed close does not move the guest");
  pop.emit("close", { defaultPrevented: false });
  assert.ok(main.children.has(view) && !pop.children.has(view)); assert.equal(view.visible, false);
});

test("popout input listeners are attached once per hosting window and destroying a hosted guest removes it from that window", async t => {
  const { pop, request, view, bounds } = await fixture(t);
  await request("bounds", { bounds, host: "slopsidian-popout-a" });
  await request("bounds", { bounds: { ...bounds, x: 11 }, host: "slopsidian-popout-a" });
  assert.equal(pop.webContents.listenerCount("before-input-event"), 1);
  assert.equal(pop.listenerCount("close"), 1);
  await request("destroy");
  assert.ok(!pop.children.has(view));
});

test("invalid bounds are refused before the guest changes host or visibility", async t => {
  const { main, pop, request, view, bounds } = await fixture(t);
  await request("bounds", { bounds });
  const visible = view.visible;
  for (const invalid of [{ ...bounds, width: -1 }, { ...bounds, x: "10" }, { visible: "yes" }, null]) {
    await assert.rejects(request("bounds", { bounds: invalid, host: "slopsidian-popout-a" }));
    assert.ok(main.children.has(view) && !pop.children.has(view)); assert.equal(view.visible, visible);
  }
});

test("a popout whose guest cannot return to main vetoes the native close, keeps the guest and surfaces the failure to the owner", async t => {
  const { main, pop, request, view, bounds } = await fixture(t);
  await request("bounds", { bounds, host: "slopsidian-popout-a" });
  const sent = []; main.webContents.send = (channel, payload) => sent.push([channel, payload]);
  main.failAdd = true;
  let prevented = false;
  pop.emit("close", { defaultPrevented: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.ok(pop.children.has(view) && !main.children.has(view));
  assert.ok(sent.some(([channel, payload]) => channel === "webviewer:event" && /kept open/.test(payload?.state?.error ?? "")), "the owner sees the failure");
  main.failAdd = false; prevented = false;
  pop.emit("close", { defaultPrevented: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.ok(main.children.has(view));
});