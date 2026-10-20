import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root } from "./host.mjs";

let temporary, WebReaderFrame, WebViewerView, readerDocument;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-popout-tests-"));
  const entry = join(temporary, "reader.mjs");
  await build({ stdin: { contents: 'export {WebReaderFrame, readerDocument} from "./client/web-reader-frame";export {WebViewerView} from "./client/web-viewer";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", external: ["electron"], logLevel: "silent" });
  ({ WebReaderFrame, WebViewerView, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });

const article = { url: "https://example.com/story", title: "Story", byline: "", content: "<p>Words.</p>", textLength: 500, lang: "en", dir: "ltr" };

function fakeWindow(name, light = false) {
  const handlers = new Set(), sent = [], contentWindow = { sent, postMessage: data => sent.push(data) };
  const element = { dataset: {}, setAttribute() {}, checkVisibility: () => true, contentWindow, remove() {} };
  const win = {
    name, handlers, sent, contentWindow, element, created: 0,
    addEventListener: (key, callback) => { assert.equal(key, "message"); handlers.add(callback); },
    removeEventListener: (key, callback) => { assert.equal(key, "message"); handlers.delete(callback); },
    location: { origin: "https://editor.example" },
    document: { createElement: () => { win.created++; return element; }, body: { classList: { contains: () => light } } },
  };
  return win;
}

function fixture(t, owner, callbacks = {}) {
  const main = fakeWindow("main"), previous = Object.fromEntries(["document", "window", "location"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: main, document: main.document, location: main.location });
  const events = { navigate: [], progress: [], changed: 0 };
  const frame = new WebReaderFrame(article, { navigate: (url, tab) => events.navigate.push([url, tab]), shortcut() {}, find() {}, progress: value => events.progress.push(value), documentChanged: () => { events.changed++; }, ...callbacks }, 1, undefined, 0.25, owner);
  frame.ready.catch(() => {});
  t.after(() => { frame.dispose(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) { Object.defineProperty(globalThis, key, descriptor); } else { delete globalThis[key]; } } });
  return { frame, main, events };
}

const message = (frame, win, data) => [...win.handlers].forEach(handler => handler({ source: frame.frame.contentWindow, origin: "null", ...(data.kind === "ready" ? { ports: [{ postMessage() {}, close() {} }] } : {}), data: { channel: "slopsidian-reader", token: frame.token, ...data } }));

test("A Reader registers on its owner window, not the global main window, and cleans that listener up", t => {
  const pop = fakeWindow("popout", true), { frame, main } = fixture(t, pop);
  assert.equal(pop.created, 1); assert.equal(main.handlers.size, 0); assert.equal(pop.handlers.size, 1); assert.equal(frame.ownerWindow, pop);
  assert.equal(frame.light, true);
  frame.dispose(); assert.equal(pop.handlers.size, 0);
});

test("Rebinding moves the receive handler between windows and keeps token, progress and pending requests", async t => {
  const pop = fakeWindow("popout"), { frame, main, events } = fixture(t, undefined);
  const token = frame.token;
  assert.equal(main.handlers.size, 1);
  message(frame, main, { kind: "ready" });
  const capture = frame.flushProgress();
  assert.equal(frame.captures.size, 1);
  frame.rebind(pop);
  assert.equal(main.handlers.size, 0); assert.equal(pop.handlers.size, 1); assert.equal(frame.token, token);
  assert.equal(frame.captures.size, 1, "a rebind alone never drops pending captures");
  message(frame, main, { kind: "progress", progress: 0.9 }); assert.deepEqual(events.progress, [], "the old window no longer delivers");
  message(frame, pop, { kind: "progress", progress: 0.5, requestId: [...frame.captures.keys()][0] });
  assert.deepEqual(events.progress, [0.5]); await capture; assert.equal(frame.captures.size, 0);
  frame.rebind(pop); assert.equal(pop.handlers.size, 1, "rebinding to the same window is idempotent");
  frame.rebind(main); assert.equal(main.handlers.size, 1); assert.equal(pop.handlers.size, 0);
});

test("Only an actual document change invalidates pending Reader selections; a moved iframe re-announces and restores progress", async t => {
  const pop = fakeWindow("popout"), { frame, events } = fixture(t, undefined);
  message(frame, frame.ownerWindow, { kind: "ready" }); assert.equal(events.changed, 0);
  const selection = frame.captureSelection(); selection.catch(() => {});
  frame.rebind(pop); assert.equal(frame.selections.size, 1);
  pop.sent.length = 0;
  const port = { sent: [], postMessage: data => port.sent.push(data), close() {} };
  [...pop.handlers].forEach(handler => handler({ source: frame.frame.contentWindow, origin: "null", ports: [port], data: { channel: "slopsidian-reader", token: frame.token, kind: "ready" } }));
  assert.equal(events.changed, 1); assert.equal(frame.selections.size, 0);
  await assert.rejects(selection, /document changed/);
  const kinds = port.sent.map(entry => entry.kind);
  assert.ok(kinds.includes("restore-progress") && kinds.includes("zoom") && kinds.includes("theme"), kinds.join());
});

test("A disposed Reader cannot be rebound and leaves no listener on either window", t => {
  const pop = fakeWindow("popout"), { frame, main } = fixture(t, undefined);
  frame.dispose(); frame.rebind(pop);
  assert.equal(main.handlers.size, 0); assert.equal(pop.handlers.size, 0);
});

test("Foreign messages with a wrong source or token are ignored on the rebound window", t => {
  const pop = fakeWindow("popout"), { frame, events } = fixture(t, undefined);
  frame.rebind(pop);
  for (const handler of pop.handlers) {
    handler({ source: {}, origin: "null", data: { channel: "slopsidian-reader", token: frame.token, kind: "navigate", url: "https://example.com/next" } });
    handler({ source: frame.frame.contentWindow, origin: "null", data: { channel: "slopsidian-reader", token: "other", kind: "navigate", url: "https://example.com/next" } });
  }
  assert.deepEqual(events.navigate, []);
  message(frame, pop, { kind: "navigate", url: "https://example.com/next" }); assert.equal(events.navigate.length, 1);
});

function viewFixture(t, { host = null, fail = false, hold = false } = {}) {
  const held = [];
  const queue = [], calls = [], restored = [], previous = Object.fromEntries(["requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const observers = [];
  Object.assign(globalThis, {
    requestAnimationFrame: callback => queue.push(callback), cancelAnimationFrame: () => {},
    MutationObserver: class { constructor() { this.observed = []; this.live = true; observers.push(this); } observe(node) { this.observed.push(node); } disconnect() { this.live = false; } },
  });
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) { Object.defineProperty(globalThis, key, descriptor); } else { delete globalThis[key]; } } });
  const docFor = name => { const listeners = []; return { name, body: { classList: { contains: () => false } }, querySelector: () => null, listeners, addEventListener: (type, fn) => listeners.push(["add", type, fn]), removeEventListener: (type, fn) => listeners.push(["remove", type, fn]), defaultView: { name } }; };
  const mainDoc = docFor("main"), popDoc = docFor("pop");
  const surface = { ownerDocument: mainDoc, checkVisibility: () => true, getBoundingClientRect: () => ({ x: 1, y: 2, width: 30, height: 40 }) };
  const view = Object.create(WebViewerView.prototype), leaf = {};
  const state = { host };
  Object.assign(view, {
    created: true, disposed: false, frame: null, boundsIntent: 0, lastBounds: "stale", surface, leaf, id: "view-id", reader: null, pendingReader: null, clip: null,
    message: { textContent: "", hidden: true }, app: { changingVault: false, workspace: { activeLeaf: leaf, popoutNameFor: doc => doc === popDoc ? state.host : null, restoreLeafToMain: target => { restored.push(target); surface.ownerDocument = mainDoc; view.onWindowMoved(mainDoc); return true; } } },
    ipc: { invoke: (_channel, payload) => { calls.push(payload); if (hold) { return new Promise((resolve, reject) => held.push({ payload, resolve, reject })); } return fail ? Promise.reject(new Error("native refused")) : Promise.resolve(); } },
  });
  leaf.view = view;
  const run = async () => { while (queue.length) { queue.shift()(); await Promise.resolve(); await Promise.resolve(); } };
  const rebinds = [], reader = { rebind: win => rebinds.push(["reader", win.name]) }, pending = { rebind: win => rebinds.push(["pending", win.name]) };
  return { held, view, mainDoc, popDoc, surface, calls, restored, observers, run, rebinds, reader, pending, state };
}

test("moving a web viewer into a popout rebinds Readers and watchers and sends the hosting popout name with fresh bounds", async t => {
  const f = viewFixture(t, { host: "slopsidian-popout-a" });
  f.view.watch(f.mainDoc); f.view.reader = f.reader; f.view.pendingReader = f.pending;
  f.surface.ownerDocument = f.popDoc; f.view.onWindowMoved(f.popDoc);
  assert.deepEqual(f.rebinds, [["reader", "pop"], ["pending", "pop"]]);
  assert.equal(f.observers[0].live, false); assert.equal(f.observers[1].live, true); assert.equal(f.observers[1].observed[0], f.popDoc.body);
  assert.deepEqual(f.mainDoc.listeners.filter(entry => entry[0] === "remove").map(entry => entry[1]), ["scroll", "toggle"]);
  assert.deepEqual(f.popDoc.listeners.filter(entry => entry[0] === "add").map(entry => entry[1]), ["scroll", "toggle"]);
  await f.run();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, "bounds"); assert.equal(f.calls[0].host, "slopsidian-popout-a");
  assert.deepEqual(f.restored, []);
  f.surface.ownerDocument = f.mainDoc; f.view.onWindowMoved(f.mainDoc); await f.run();
  assert.equal(f.calls.at(-1).host, undefined, "returning to main sends no host");
});

test("a refused native relocation surfaces the error and returns the tab to main instead of pretending it moved", async t => {
  const f = viewFixture(t, { host: "slopsidian-popout-a", fail: true });
  f.view.watch(f.mainDoc); f.surface.ownerDocument = f.popDoc; f.view.onWindowMoved(f.popDoc); await f.run();
  assert.equal(f.view.message.textContent, "native refused"); assert.equal(f.restored.length, 1); assert.equal(f.restored[0], f.view.leaf);
  const g = viewFixture(t, { host: null, fail: true });
  g.view.onWindowMoved(g.mainDoc); await g.run();
  assert.deepEqual(g.restored, [], "a failure in main never relocates the tab");
});

test("a web viewer refuses to move while it is closing or saving a clip and the unwatch cleanup is idempotent", t => {
  const f = viewFixture(t);
  assert.equal(f.view.windowMoveRefusal(), null);
  f.view.clip = { busy: true }; assert.match(f.view.windowMoveRefusal(), /finish saving/);
  f.view.clip = null; f.view.disposed = true; assert.match(f.view.windowMoveRefusal(), /closing/);
  f.view.disposed = false; f.view.watch(f.mainDoc); f.view.unwatch(); f.view.unwatch();
  assert.equal(f.mainDoc.listeners.filter(entry => entry[0] === "remove").length, 2);
});
test("a delayed bounds failure for an older popout cannot return or re-message a newer move or a current main tab", async t => {
  const f = viewFixture(t, { host: "slopsidian-popout-a", hold: true }), flush = () => new Promise(resolve => setImmediate(resolve));
  f.view.watch(f.mainDoc); f.surface.ownerDocument = f.popDoc; f.view.onWindowMoved(f.popDoc); await f.run();
  assert.equal(f.held.length, 1);
  const errors = []; const log = console.error; console.error = (...values) => errors.push(values);
  t.after(() => { console.error = log; });
  f.state.host = null; f.surface.ownerDocument = f.mainDoc; f.view.onWindowMoved(f.mainDoc); await f.run();
  assert.equal(f.held.length, 2); f.held[1].resolve();
  f.held[0].reject(new Error("old popout refused")); await flush();
  assert.deepEqual(f.restored, []); assert.equal(f.view.message.textContent, "");
  assert.equal(errors.length, 1, "the stale failure stays diagnosable");
  f.state.host = "slopsidian-popout-b"; f.surface.ownerDocument = f.popDoc; f.view.onWindowMoved(f.popDoc); await f.run();
  f.held[2].reject(new Error("current refused")); await flush();
  assert.equal(f.restored.length, 1); assert.equal(f.view.message.textContent, "current refused");
});

test("a failure from a superseded bounds request in the same window is ignored once a newer request is in flight", async t => {
  const f = viewFixture(t, { host: "slopsidian-popout-a", hold: true }), flush = () => new Promise(resolve => setImmediate(resolve));
  f.view.watch(f.mainDoc); f.surface.ownerDocument = f.popDoc; f.view.onWindowMoved(f.popDoc); await f.run();
  f.surface.getBoundingClientRect = () => ({ x: 5, y: 6, width: 70, height: 80 }); f.view.onResize(); await f.run();
  assert.equal(f.held.length, 2);
  const log = console.error; console.error = () => {}; t.after(() => { console.error = log; });
  f.held[0].reject(new Error("superseded")); await flush();
  assert.deepEqual(f.restored, []); assert.equal(f.view.message.textContent, "");
});
test("After the document hands over its private port, controller messages use it from any realm and fall back to the frame window before that", t => {
  const pop = fakeWindow("popout"), { frame, events } = fixture(t, pop);
  frame.setZoom(1.5);
  assert.equal(pop.contentWindow.sent.at(-1).kind, "zoom", "before the handover the frame window is used");
  const ports = [], closed = [];
  const port = () => { const p = { sent: [], postMessage: data => p.sent.push(data), close: () => closed.push(p) }; ports.push(p); return p; };
  const ready = () => [...pop.handlers].forEach(handler => handler({ source: pop.contentWindow, origin: "null", ports: [port()], data: { channel: "slopsidian-reader", token: frame.token, kind: "ready" } }));
  const before = pop.contentWindow.sent.length;
  ready();
  frame.setZoom(1.25); frame.setTheme(true); frame.restoreProgress(0.5); frame.find("a", true, false, 1);
  const first = ports[0];
  const kinds = first.sent.map(item => item.kind);
  for (const kind of ["zoom", "theme", "appearance", "restore-progress", "find"]) { assert.ok(kinds.includes(kind), kind + " goes over the port"); }
  assert.ok(first.sent.every(item => item.token === frame.token && item.channel === "slopsidian-reader"));
  assert.equal(pop.contentWindow.sent.length, before, "nothing else goes through the frame window");
  ready();
  assert.deepEqual(closed, [first], "a reloaded document replaces and closes the previous port");
  frame.setZoom(1.1);
  assert.equal(ports[1].sent.at(-1).kind, "zoom");
  frame.dispose();
  assert.deepEqual(closed, [first, ports[1]], "disposal closes the live port");
  assert.equal(events.changed, 1);
});

test("The embedded document accepts port messages without a source check but still enforces the token, and window messages keep the parent-source check", async () => {

  const html = readerDocument(article, "11111111-1111-1111-1111-111111111111", "https://editor.example", false);
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /!viaPort\s*&&\s*\(event\.source\s*!==\s*parent\s*\|\|\s*event\.origin\s*!==\s*parentOrigin\)\s*\|\|\s*\(?data\?\.channel\s*!==\s*"slopsidian-reader"\s*\|\|\s*data\.token\s*!==\s*token/);
  assert.match(script, /viaPort/);
  assert.match(script, /new MessageChannel/);
  assert.match(script, /send\("ready",\s*\{\},\s*\[channel\.port2\]\)/);
});
test("A Reader created inside an about:blank popout uses the inherited app origin, not the popup's opaque location origin, and completes the port handover", async () => {
  const pop = fakeWindow("popout"); pop.location.origin = "null";
  const { frame } = fixture({ after() {} }, pop);
  const srcdoc = frame.frame.srcdoc;
  assert.match(srcdoc, /\}\)\("[0-9a-f-]{36}","https:\/\/editor\.example",/, "the bootstrap is bound to the trusted app origin");
  assert.doesNotMatch(srcdoc, /\)\("[0-9a-f-]{36}","null"/);
  const port = { sent: [], postMessage: data => port.sent.push(data), close() {} };
  [...pop.handlers].forEach(handler => handler({ source: pop.contentWindow, origin: "null", ports: [port], data: { channel: "slopsidian-reader", token: frame.token, kind: "ready" } }));
  await frame.ready;
  frame.setZoom(1.3);
  assert.equal(port.sent.at(-1).kind, "zoom");
  frame.dispose();
});

test("A forged ready (wrong source, origin, token, or missing/extra/non-port transfer) never replaces the live port or advances the document revision", () => {
  const pop = fakeWindow("popout"), { frame } = fixture({ after() {} }, pop);
  const closed = [], live = { sent: [], postMessage: data => live.sent.push(data), close: () => closed.push("live") };
  const deliver = extra => [...pop.handlers].forEach(handler => handler({ source: pop.contentWindow, origin: "null", data: { channel: "slopsidian-reader", token: frame.token, kind: "ready" }, ...extra }));
  deliver({ ports: [live] });
  const revision = frame.documentRevision, fake = { postMessage() {}, close: () => closed.push("fake") };
  deliver({ ports: [] }); deliver({ ports: undefined }); deliver({ ports: [fake, fake] }); deliver({ ports: [{}] }); deliver({ origin: "https://editor.example", ports: [fake] });
  deliver({ source: {}, ports: [fake] }); deliver({ data: { channel: "slopsidian-reader", token: "other", kind: "ready" }, ports: [fake] });
  assert.deepEqual(closed, [], "the live port is never closed or replaced");
  assert.equal(frame.documentRevision, revision);
  frame.setZoom(1.7);
  assert.equal(live.sent.at(-1).factor, 1.7);
  frame.dispose();
});