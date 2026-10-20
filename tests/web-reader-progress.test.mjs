import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { root } from "./host.mjs";

let temporary, readerProgress, readerScrollState, readerDocument, WebReaderFrame, WebViewerView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-progress-tests-"));
  const entry = join(temporary, "progress.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-reader-progress"; export { readerDocument, WebReaderFrame } from "./client/web-reader-frame"; export { WebViewerView } from "./client/web-viewer";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", external: ["electron"], logLevel: "silent" });
  ({ readerProgress, readerScrollState, readerDocument, WebReaderFrame, WebViewerView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const article = { url: "https://example.com/story?q=one#part", title: "Readable story", byline: "Author", content: "<p>Readable text.</p>", textLength: 500, lang: "en", dir: "ltr" };

test("Reader progress accepts the endpoints and refuses coercion, nonfinite values and out-of-range state", () => {
  for (const value of [0, 0.37, 1]) { assert.equal(readerProgress(value), value); }
  for (const value of [undefined, null, false, "0.5", {}, [], NaN, Infinity, -Infinity, -0.001, 1.001]) { assert.throws(() => readerProgress(value), /number from 0 to 1/); }
});
test("Reader scroll state preserves exact URL and detached opaque fields without accepting unsafe addresses or malformed state", () => {
  const value = { url: article.url, progress: 0.4, future: { keep: [false, "中文"] } };
  const state = readerScrollState(value); assert.deepEqual(state, value); state.future.keep.push(1); assert.equal(value.future.keep.length, 2);
  assert.equal(readerScrollState(undefined), null); assert.equal(readerScrollState(null), null);
  for (const invalid of [[], true, "text", {}, { url: article.url }, { url: article.url, progress: 2 }, ...["javascript:alert(1)", "file:///secret", "https://user:pass@example.com", "https://example.com/\nwrong", "x".repeat(8193)].map(url => ({ url, progress: 0.5 }))]) { assert.throws(() => readerScrollState(invalid)); }
});

function bootstrap() {
  const token = "a".repeat(36), origin = "https://editor.example", events = new Map(), messages = [], frames = new Map(), styles = new Map(); let serial = 0;
  const viewport = { clientHeight: 200, scrollHeight: 1200, scrollTop: 0, style: { zoom: "1", getPropertyValue: key => styles.get(key) ?? "", setProperty: (key, value) => styles.set(key, value) } };
  const parent = { postMessage: message => messages.push(message) };
  const html = readerDocument(article, token, origin, false), code = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document: { addEventListener() {}, querySelector: () => ({ checkVisibility: () => true }), scrollingElement: viewport, documentElement: viewport }, ResizeObserver: class { observe() {} }, requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; }, cancelAnimationFrame: id => frames.delete(id), addEventListener: (type, callback) => events.set(type, callback) });
  const send = (data, extra = {}) => events.get("message")({ source: parent, origin, data: { channel: "slopsidian-reader", token, ...data }, ...extra });
  const render = () => { for (let step = 0; step < 2; step++) { const queued = [...frames.values()]; frames.clear(); for (const frame of queued) { frame(); } } };
  return { viewport, messages, events, styles, send, render, token, origin, parent };
}
test("Actual Reader bootstrap restores after visible layout and measures real scroll progress, including top and bottom", () => {
  const f = bootstrap();
  f.send({ kind: "restore-progress", progress: 0.6 }); f.render(); assert.equal(f.viewport.scrollTop, 600);
  f.viewport.scrollTop = 250; f.events.get("scroll")(); assert.equal(f.messages.at(-1).progress, 0.25);
  f.viewport.scrollTop = -5; f.events.get("scroll")(); assert.equal(f.messages.at(-1).progress, 0);
  f.viewport.scrollTop = 1500; f.events.get("scroll")(); assert.equal(f.messages.at(-1).progress, 1);
});
test("Hidden/provisional layout cannot overwrite restored progress, and resize/font/zoom changes preserve the fraction", () => {
  const f = bootstrap(); f.viewport.clientHeight = 0;
  f.send({ kind: "restore-progress", progress: 0.7 }); f.events.get("scroll")(); f.render();
  assert.equal(f.messages.filter(message => message.kind === "progress").length, 0);
  f.viewport.clientHeight = 200; f.events.get("resize")(); f.render(); assert.equal(f.viewport.scrollTop, 700);
  f.send({ kind: "appearance", readerFont: "monospace", readerWidth: "narrow", readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" }); f.viewport.scrollHeight = 2200; f.render(); assert.equal(f.viewport.scrollTop, 1400);
  f.send({ kind: "zoom", factor: 1.5 }); f.viewport.clientHeight = 400; f.render(); assert.equal(f.viewport.scrollTop, 1260);
});
test("Restore/capture commands require the parent origin, source and token and strict finite progress/request IDs", () => {
  const f = bootstrap();
  for (const extra of [{ source: {} }, { origin: "https://other.example" }, { data: { channel: "slopsidian-reader", token: "wrong", kind: "restore-progress", progress: 1 } }]) { f.send({ kind: "restore-progress", progress: 0.8 }, extra); f.render(); assert.equal(f.viewport.scrollTop, 0); }
  for (const progress of [-1, 2, NaN, Infinity, "0.5", null]) { f.send({ kind: "restore-progress", progress }); f.render(); assert.equal(f.viewport.scrollTop, 0); }
  const initial = f.messages.length;
  for (const requestId of [-1, 0, 0.5, "1", null]) { f.send({ kind: "capture-progress", requestId }); }
  assert.equal(f.messages.length, initial);
  f.send({ kind: "restore-progress", progress: 0.4 }); f.render(); f.send({ kind: "capture-progress", requestId: 7 });
  assert.equal(f.messages.at(-1).requestId, 7); assert.equal(f.messages.at(-1).progress, 0.4);
});

function frameFixture(t, progress = 0.3) {
  const previous = Object.fromEntries(["document", "window", "location"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let receive, visible = true; const sent = [], values = [];
  const contentWindow = { postMessage: message => sent.push(message) };
  const element = { dataset: {}, setAttribute() {}, checkVisibility: () => visible, contentWindow, remove() {} };
  Object.assign(globalThis, { document: { createElement: () => element, body: { classList: { contains: () => false } } }, window: { addEventListener: (_type, callback) => { receive = callback; }, removeEventListener() {} }, location: { origin: "https://editor.example" } });
  const frame = new WebReaderFrame(article, { navigate() {}, shortcut() {}, find() {}, progress: value => values.push(value) }, 1.2, { readerFont: "monospace", readerWidth: "narrow" }, progress);
  frame.ready.catch(() => {});
  t.after(() => { frame.dispose(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) { Object.defineProperty(globalThis, key, descriptor); } else { delete globalThis[key]; } } });
  const send = (data, extra = {}) => receive({ source: contentWindow, data: { channel: "slopsidian-reader", token: frame.token, ...data }, ...extra });
  return { frame, sent, values, send, hide: () => { visible = false; } };
}
test("Actual frame validates incoming progress and replays the latest progress/font/zoom after a new document becomes ready", async t => {
  const f = frameFixture(t); f.send({ kind: "ready" }); await f.frame.ready;
  assert.equal(f.sent.at(-1).progress, 0.3);
  for (const progress of [NaN, Infinity, "0.4", null, -0.1, 1.1]) { f.send({ kind: "progress", progress }); }
  f.send({ kind: "progress", progress: 0.9 }, { source: {} }); f.send({ kind: "progress", progress: 0.9, token: "wrong" }); assert.deepEqual(f.values, []);
  f.send({ kind: "progress", progress: 0.65 }); f.frame.setZoom(1.5); f.frame.setAppearance({ readerFont: "sans-serif", readerWidth: "wide", readerFontSize: 26, readerLineHeight: 2.1 }); f.send({ kind: "ready" });
  assert.equal(f.sent.at(-1).progress, 0.65); assert.equal(f.sent.at(-2).readerWidth, "wide"); assert.equal(f.sent.at(-3).factor, 1.5);
  assert.equal(f.sent.at(-2).readerFontSize, 26); assert.equal(f.sent.at(-2).readerLineHeight, 2.1);
});
test("Frame capture flushes the exact final value; hidden frames and disposal finish without retaining timers or late updates", async t => {
  const f = frameFixture(t); f.send({ kind: "ready" }); await f.frame.ready;
  const pending = f.frame.flushProgress(), request = f.sent.at(-1); assert.equal(request.kind, "capture-progress");
  f.send({ kind: "progress", progress: 0.73, requestId: request.requestId }); await pending; assert.equal(f.values.at(-1), 0.73); assert.equal(f.frame.captures.size, 0);
  const disposed = f.frame.flushProgress(); f.frame.dispose(); await disposed; assert.equal(f.frame.captures.size, 0);
  f.send({ kind: "progress", progress: 1 }); assert.equal(f.values.at(-1), 0.73);
  f.hide(); const count = f.sent.length; await f.frame.flushProgress(); assert.equal(f.sent.length, count);
});
test("An unresponsive frame capture is bounded and keeps the last confirmed progress without fabricating a reset", async t => {
  const f = frameFixture(t); f.send({ kind: "ready" }); await f.frame.ready;
  f.send({ kind: "progress", progress: 0.8 });
  await f.frame.flushProgress(); assert.equal(f.frame.captures.size, 0); assert.equal(f.values.at(-1), 0.8);
  f.hide(); const count = f.sent.length; await f.frame.flushProgress(); assert.equal(f.sent.length, count);
});
test("Reader navigation resets preserve a pending progress save while vault changes and disposal cannot enqueue stale writes", async t => {
  const view = Object.create(WebViewerView.prototype); let writes = 0;
  Object.assign(view, { app: { changingVault: false, workspace: { layoutChanged: () => { writes++; } } }, readerScroll: null, readerScrollHistory: [], progressSave: null, reader: null, pendingReader: null, readerGeneration: 0, readerWarning: {}, findResult: {}, status: {}, loading: false, disposed: false, frame: null });
  view.updateReaderButton = view.scheduleBounds = () => {}; view.request = async () => ({});
  t.after(() => view.cancelProgressSave());
  view.acceptReaderProgress(0.4, article.url); view.resetReader();
  assert.notEqual(view.progressSave, null, "Reload/navigation must not discard a pending durable save.");
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(writes, 1);
  view.app.changingVault = true; view.acceptReaderProgress(0.6, article.url);
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(writes, 1);
  view.app.changingVault = false; view.acceptReaderProgress(0.8, article.url); await view.unloadViewContent(); assert.equal(view.progressSave, null);
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(writes, 1);
});
