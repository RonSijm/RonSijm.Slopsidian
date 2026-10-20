import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { root } from "./host.mjs";

let temporary, readerDocument, WebReaderFrame, WebViewerView, selectionMarkdown;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-selection-tests-"));
  const entry = join(temporary, "selection.mjs");
  await build({ stdin: { contents: 'export {readerDocument,WebReaderFrame} from "./client/web-reader-frame";export {WebViewerView} from "./client/web-viewer";export {selectionMarkdown} from "./client/web-clip-markdown";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", external: ["electron"], logLevel: "silent" });
  ({ readerDocument, WebReaderFrame, WebViewerView, selectionMarkdown } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const article = { url: "https://example.com/story?q=one#part", title: "Reader title 中文 😀", byline: "Author", content: "<p>Reader words.</p>", textLength: 500, lang: "en", dir: "ltr" };

function bootstrap() {
  const token = "a".repeat(36), origin = "https://editor.example", messages = [], events = new Map(); let text = "Picked 中文 😀\n\nLiteral **text** ![[Secret]]", reads = 0;
  const owner = { nodeType: 1, getRootNode: () => document, closest: () => null }, range = { startContainer: owner, endContainer: owner };
  const selection = { rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => { reads++; return text; } };
  const document = { addEventListener() {}, documentElement: { clientHeight: 100 }, activeElement: { closest: () => null }, querySelector: () => ({ contains: node => node === owner }) }, parent = { postMessage: data => messages.push(data) };
  const html = readerDocument(article, token, origin, false), code = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document, ResizeObserver: class { observe() {} }, getSelection: () => selection, addEventListener: (key, callback) => events.set(key, callback) });
  const send = (data = {}, extra = {}) => events.get("message")({ source: parent, origin, data: { channel: "slopsidian-reader", token, kind: "capture-selection", requestId: 1, ...data }, ...extra });
  return { messages, send, selection, range, document, setText: value => { text = value; }, reads: () => reads };
}

test("The actual Reader bootstrap reads one bounded selection snapshot without mutating its DOM/range and returns only literal text with the owned request ID", () => {
  const f = bootstrap(); f.send(); const result = f.messages.at(-1);
  assert.equal(result.kind, "selection-result"); assert.equal(result.requestId, 1); assert.equal(result.text, "Picked 中文 😀\n\nLiteral **text** ![[Secret]]"); assert.equal(f.reads(), 1);
  assert.equal(result.url, undefined); assert.equal(result.title, undefined); assert.equal(f.selection.rangeCount, 1); assert.equal(f.selection.isCollapsed, false);
  assert.ok(selectionMarkdown(article.title, article.url, result.text).includes("\\*\\*text\\*\\*"));
});

test("Reader selection capture authenticates parent source/origin/session and strictly positive safe request IDs before reading any selection", () => {
  const f = bootstrap(), count = f.messages.length;
  for (const [data, extra] of [[{}, { source: {} }], [{}, { origin: "https://other.example" }], [{ token: "wrong" }, {}], ...[0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1].map(requestId => [{ requestId }, {}])]) { f.send(data, extra); }
  assert.equal(f.messages.length, count); assert.equal(f.reads(), 0); f.send({ requestId: 7 }); assert.equal(f.messages.at(-1).requestId, 7);
});

test("Empty, collapsed, multiple, foreign-root/control and oversized Reader selections fail with bounded explanations while a one-character selection succeeds", () => {
  for (const arrange of [f => { f.selection.isCollapsed = true; }, f => { f.selection.rangeCount = 0; }, f => { f.selection.rangeCount = 2; }, f => { f.range.startContainer = { nodeType: 1, getRootNode: () => ({}), closest: () => null }; }, f => { f.range.endContainer = { nodeType: 1, getRootNode: () => f.document, closest: () => null }; }, f => { f.document.activeElement.closest = () => ({}); }, f => f.setText(" \n\t "), f => f.setText("x".repeat(200_001)), f => f.setText("bad\0text")]) {
    const f = bootstrap(); arrange(f); f.send(); const result = f.messages.at(-1); assert.equal(result.kind, "selection-result"); assert.equal(result.text, undefined); assert.match(result.error, /select|selection/i); assert.ok(result.error.length <= 500);
  }
  const f = bootstrap(); f.setText("字"); f.send(); assert.equal(f.messages.at(-1).text, "字"); f.setText("x".repeat(200_000)); f.send({ requestId: 2 }); assert.equal(f.messages.at(-1).text.length, 200_000);
});

function frameFixture(t) {
  const previous = Object.fromEntries(["document", "window", "location"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const sourceArticle = structuredClone(article), sent = []; let receive, visible = true;
  const contentWindow = { postMessage: data => sent.push(data) }, element = { dataset: {}, setAttribute() {}, checkVisibility: () => visible, contentWindow, remove() {} };
  Object.assign(globalThis, { document: { createElement: () => element, body: { classList: { contains: () => false } } }, window: { addEventListener: (_key, callback) => { receive = callback; }, removeEventListener() {} }, location: { origin: "https://editor.example" } });
  const frame = new WebReaderFrame(sourceArticle, { navigate() {}, shortcut() {}, find() {} }); frame.ready.catch(() => {});
  const send = (data, extra = {}) => receive({ source: contentWindow, origin: "null", data: { channel: "slopsidian-reader", token: frame.token, ...data }, ...extra }); send({ kind: "ready" });
  t.after(() => { frame.dispose(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) { Object.defineProperty(globalThis, key, descriptor); } else { delete globalThis[key]; } } });
  return { frame, sent, send, sourceArticle, hide: () => { visible = false; }, show: () => { visible = true; } };
}

test("Frame selection replies require the exact opaque window/token/origin/request and cannot replace the captured article's title/source", async t => {
  const f = frameFixture(t); const pending = f.frame.captureSelection(), request = f.sent.at(-1); assert.equal(request.kind, "capture-selection");
  const valid = { kind: "selection-result", requestId: request.requestId, text: "Selected words", url: "https://attacker.example", title: "Wrong title" };
  for (const [data, extra] of [[valid, { source: {} }], [valid, { origin: "https://other.example" }], [{ ...valid, token: "wrong" }, {}], [{ ...valid, requestId: request.requestId + 1 }, {}], [{ ...valid, requestId: "1" }, {}]]) { f.send(data, extra); assert.equal(f.frame.selections.size, 1); }
  f.sourceArticle.title = "Changed after construction"; f.sourceArticle.url = "https://other.example"; f.send(valid);
  assert.deepEqual(await pending, { url: article.url, title: article.title, text: "Selected words" }); assert.equal(f.frame.selections.size, 0);
});

test("Malformed or explicit-error frame replies clear their pending request without accepting partial/oversized data, and a corrected capture can retry", async t => {
  const f = frameFixture(t);
  for (const data of [{ text: "" }, { text: " \n " }, { text: "bad\0text" }, { text: 1 }, { text: "x".repeat(200_001) }, { text: "Words", error: "Ambiguous" }, { error: "Select text in Reader." }]) {
    const pending = f.frame.captureSelection(), request = f.sent.at(-1), rejected = assert.rejects(pending, /select|selection/i); f.send({ kind: "selection-result", requestId: request.requestId, ...data }); await rejected; assert.equal(f.frame.selections.size, 0);
  }
  const pending = f.frame.captureSelection(), request = f.sent.at(-1); f.send({ kind: "selection-result", requestId: request.requestId, text: "字" }); assert.equal((await pending).text, "字");
});

test("Selection requests are bounded, reject duplicate/hidden/disposed captures, and cancel on a fresh frame document or disposal without late-response revival", async t => {
  const f = frameFixture(t); f.hide(); await assert.rejects(f.frame.captureSelection(), /visible|unavailable/i); f.show();
  const pending = f.frame.captureSelection(), request = f.sent.at(-1), changed = assert.rejects(pending, /changed|Reader/i);
  await assert.rejects(f.frame.captureSelection(), /running|selection/i); const revision = f.frame.documentRevision; f.send({ kind: "ready" }); await changed; assert.ok(f.frame.documentRevision > revision); assert.equal(f.frame.selections.size, 0);
  f.send({ kind: "selection-result", requestId: request.requestId, text: "Late old words" }); assert.equal(f.frame.selections.size, 0);
  const timedOut = f.frame.captureSelection(); await assert.rejects(timedOut, /timed out|unavailable/i); assert.equal(f.frame.selections.size, 0);
  const disposed = f.frame.captureSelection(), cancelled = assert.rejects(disposed, /closed|Reader/i); f.frame.dispose(); await cancelled; assert.equal(f.frame.selections.size, 0); await assert.rejects(f.frame.captureSelection(), /closed|unavailable/i);
});

test("Save selection availability permits only a loaded original page or ready owned Reader and refuses pending/disabled/foreign lifecycle states", () => {
  const view = Object.create(WebViewerView.prototype); Object.assign(view, { created: true, disposed: false, app: { changingVault: false, core: { isEnabled: () => true } }, provider: { id: "webviewer" }, loading: false, readerWanted: false, readerBusy: false, reader: null, url: article.url, message: { textContent: "" } });
  assert.equal(view.canSaveSelection(), true); view.readerWanted = true; assert.equal(view.canSaveSelection(), false); view.reader = {}; assert.equal(view.canSaveSelection(), true);
  view.readerBusy = true; assert.equal(view.canSaveSelection(), false); view.readerBusy = false; view.disposed = true; assert.equal(view.canSaveSelection(), false); view.disposed = false; view.app.changingVault = true; assert.equal(view.canSaveSelection(), false);
  view.app.changingVault = false; view.app.core.isEnabled = () => false; assert.equal(view.canSaveSelection(), false);
});
