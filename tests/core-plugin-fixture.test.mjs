import assert from "node:assert/strict";
import test from "node:test";
import { enableCorePlugin, readGuestHost, readerCurrentDocumentReady, readerProbeExpression, readerFailureSnapshot, editorHistoryExpression, checkReaderCreatedInPopout } from "../tools/workspace-popout-scenarios.mjs";
import vm from "node:vm";

test("the fresh-popout Reader scenario uses real pointer calls and proves a different controller with an authenticated live channel", async () => {
  const run = async wrongOwner => {
    const listeners = new Set(), source = {}, owner = { location: { origin: "null" }, addEventListener: (_name, listener) => listeners.add(listener), removeEventListener: (_name, listener) => listeners.delete(listener) };
    const doc = { defaultView: owner }, previous = { disposed: false }, window = { __webReader: previous }, view = { reader: previous, surface: { ownerDocument: doc }, contentEl: { dataset: { webviewerReaderMode: "reader" } } };
    const frame = { ownerDocument: doc, contentWindow: source, isConnected: true, checkVisibility: () => true, getAttribute: () => "allow-scripts", srcdoc: "doc" };
    const clicks = [];
    const popup = { click: async selector => {
      clicks.push(selector);
      if (clicks.length === 1) { previous.disposed = true; view.reader = null; view.contentEl.dataset.webviewerReaderMode = "page"; }
      else {
        view.reader = { frame, port: { postMessage() {} }, token: "token", documentRevision: 1, progressReady: true, disposed: false, ownerWindow: wrongOwner ? window : owner,
          post: message => { for (const listener of listeners) listener({ source, origin: "null", data: { channel: "slopsidian-reader", token: "token", kind: "progress", requestId: message.requestId } }); } };
        view.contentEl.dataset.webviewerReaderMode = "reader";
      }
    } };
    source.parent = owner;
    const context = vm.createContext({ view, window, setTimeout, clearTimeout });
    const evaluate = expression => vm.runInContext(expression, context);
    const wait = async (expression, label) => { assert.equal(await evaluate(expression), true, label); };
    const result = await checkReaderCreatedInPopout({ evaluate, wait, popup, view: "view" });
    return { result, clicks, previous, view, window };
  };
  const good = await run(false);
  assert.deepEqual(good.clicks, ['[data-webviewer-action="reader"]', '[data-webviewer-action="reader"]']);
  assert.equal(good.previous.disposed, true);
  assert.notEqual(good.view.reader, good.previous);
  assert.equal(good.window.__webReader, good.view.reader);
  assert.deepEqual(good.result, { ownerIsMain: false, ownerMatchesDocument: true, ownerOrigin: "null", revision: 1, progressReady: true, hasPort: true });
  await assert.rejects(run(true), /newly constructed popout Reader/);
});

test("the forced-close history diagnostic compiles and records actual text, depths, readonly, focus and captured-history identity", () => {
  const history = {}, field = {}, cm = {
    state: { doc: { toString: () => "actual text" }, readOnly: false, field: key => { assert.equal(key, field); return history; } },
    dom: { ownerDocument: { hasFocus: () => false, activeElement: { className: "cm-content" } } },
    contentDOM: { isContentEditable: true }, hasFocus: false,
  };
  const leaf = { id: "pop-b", view: { editor: { cm }, getMode: () => "source" } };
  const window = {}, app = { workspace: { activeLeaf: leaf }, plugins: { modules: { "@codemirror/commands": { undoDepth: () => 2, redoDepth: () => 1, historyField: field } } } };
  const context = vm.createContext({ leaf, app, window });
  const expression = editorHistoryExpression("leaf");
  assert.doesNotThrow(() => new vm.Script(expression));
  const read = () => JSON.parse(vm.runInContext(expression, context));
  assert.deepEqual(read(), { text: "actual text", undoDepth: 2, redoDepth: 1, readOnly: false, editable: true, cmFocused: false, ownerFocused: false, activeLeaf: "pop-b", activeElement: "cm-content", mode: "source", sameHistory: null, composing: null, lastKeyCode: null, keys: [], listenerCounts: null });
  window.__forcedClose = { history };
  window.__forcedKeys = [{ key: "z", ctrl: true, prevented: true }];
  assert.equal(read().sameHistory, true);
  assert.deepEqual(read().keys, window.__forcedKeys);
  window.__forcedClose.history = {};
  cm.state.readOnly = true;
  assert.equal(read().sameHistory, false);
  assert.equal(read().readOnly, true);
  cm.inputState = { composing: -1, lastKeyCode: 89 };
  window.__forcedListenerCounts = { connected: 1, detached: 2, adopted: 2, main: 2 };
  assert.equal(read().composing, -1);
  assert.equal(read().lastKeyCode, 89);
  assert.deepEqual(read().listenerCounts, window.__forcedListenerCounts);
});

test("moved Reader readiness needs a real matching capture-progress acknowledgement from the current frame", async () => {
  // reply(request, ctx) models the iframe; it may post a message event to the owner window.
  const run = async ({ reply, hidden = false, disposed = false, progressReady = true, otherDoc = false, mutateAfter }) => {
    const doc = {}, listeners = new Set(), requests = [];
    const source = { postMessage(message) { requests.push(message); reply?.(message, { emit, source, reader }); } };
    const emit = (data, from = source) => { for (const listener of [...listeners]) listener({ source: from, data }); };
    const owner = { location: { origin: "http://x" }, addEventListener: (_n, l) => listeners.add(l), removeEventListener: (_n, l) => listeners.delete(l) }; source.parent = owner;
    const frame = { getAttribute: () => "allow-scripts", srcdoc: "doc", isConnected: true, ownerDocument: { defaultView: owner }, checkVisibility: () => !hidden, contentWindow: source };
    const reader = { frame, token: "tok", disposed, progressReady, documentRevision: 1, ownerWindow: owner, post: m => source.postMessage(m) };
    const view = { reader, surface: { ownerDocument: otherDoc ? doc : frame.ownerDocument } };
    const window = { __webReader: reader };
    const ctx = vm.createContext({ view, window, setTimeout, clearTimeout, requestAnimationFrame: undefined });
    const result = await vm.runInContext(readerCurrentDocumentReady("view"), ctx);
    const snapshot = JSON.parse(vm.runInContext("window.__readerProbeLast", ctx));
    return { result, snapshot, requests, listeners: listeners.size, reader };
  };
  const ack = (message, { emit }) => emit({ channel: "slopsidian-reader", token: "tok", kind: "progress", requestId: message.requestId, progress: 0.5 });
  const retained = await run({ reply: ack });
  assert.equal(retained.result, true, "retained document acknowledges");
  assert.equal(retained.requests.length, 1);
  assert.equal(retained.requests[0].kind, "capture-progress");
  assert.equal(retained.requests[0].token, "tok");
  assert.equal(retained.listeners, 0, "the test listener is removed");
  assert.equal((await run({ reply: (m, c) => { c.reader.documentRevision = 2; ack(m, c); } })).result, false, "a reload racing the probe is retried");
  const reloaded = await run({ reply: ack, progressReady: true });
  assert.equal(reloaded.result, true, "a reloaded document that acknowledges is ready");
  for (const [name, options] of [
    ["hidden", { reply: ack, hidden: true }], ["disposed", { reply: ack, disposed: true }], ["not restored", { reply: ack, progressReady: false }], ["other document", { reply: ack, otherDoc: true }],
    ["no reply", {}],
    ["wrong id", { reply: (m, c) => c.emit({ channel: "slopsidian-reader", token: "tok", kind: "progress", requestId: m.requestId + 1, progress: 0 }) }],
    ["wrong token", { reply: (m, c) => c.emit({ channel: "slopsidian-reader", token: "other", kind: "progress", requestId: m.requestId, progress: 0 }) }],
    ["wrong frame", { reply: (m, c) => c.emit({ channel: "slopsidian-reader", token: "tok", kind: "progress", requestId: m.requestId, progress: 0 }, {}) }],
    ["wrong kind", { reply: (m, c) => c.emit({ channel: "slopsidian-reader", token: "tok", kind: "ready", requestId: m.requestId }) }],
  ]) {
    const outcome = await run(options);
    assert.equal(outcome.result, false, name);
    assert.equal(outcome.listeners, 0, name + " leaves no listener");
    if (["hidden", "disposed", "not restored", "other document"].includes(name)) { assert.equal(outcome.requests.length, 0, name + " posts nothing"); }
  }
});

function harness(initial) {
  const state = { enabled: initial, calls: [], waits: [] };
  return {
    state,
    evaluate: async expression => {
      state.calls.push(expression);
      if (expression.startsWith("app.core.isEnabled(")) { return state.enabled; }
      const match = expression.match(/^\(async\(\)=>\{await app\.core\.setEnabled\("webviewer",(true|false)\);return true\}\)\(\)$/);
      assert.ok(match, "only real core enable/disable calls are used: " + expression);
      state.enabled = match[1] === "true";
    },
    wait: async (expression, label) => { state.waits.push(label); },
  };
}

test("enableCorePlugin enables a disabled core plugin through setEnabled, awaits readiness and restores it", async () => {
  const h = harness(false);
  const restore = await enableCorePlugin(h, "webviewer");
  assert.equal(h.state.enabled, true);
  assert.deepEqual(h.state.waits, ["webviewer core plugin ready"]);
  await restore();
  assert.equal(h.state.enabled, false);
  assert.deepEqual(h.state.waits.at(-1), "webviewer core plugin restored to disabled");
});

test("enableCorePlugin leaves an already-enabled core plugin untouched and does not disable it afterwards", async () => {
  const h = harness(true);
  const restore = await enableCorePlugin(h, "webviewer");
  await restore();
  assert.equal(h.state.enabled, true);
  assert.equal(h.state.calls.some(call => call.includes("setEnabled")), false);
  assert.deepEqual(h.state.waits, []);
});

test("scenario evaluates return primitives under returnByValue: live-object returns are wrapped and recorded expressions are serializable", async () => {
  const vm = await import("node:vm");
  const live = { dom: {} }; live.dom.self = live;
  const calls = [];
  const evaluate = async expression => {
    calls.push(expression);
    if (expression.startsWith("app.core.isEnabled(")) { return false; }
    const context = vm.createContext({ app: { core: { setEnabled: async () => live } } });
    return vm.runInContext(expression, context);
  };
  const restore = await enableCorePlugin({ evaluate, wait: async () => {} }, "webviewer");
  await restore();
  for (const expression of calls.filter(call => call.includes("setEnabled"))) {
    const value = await evaluate(expression);
    assert.notEqual(typeof value, "object", "the evaluate result is a primitive: " + expression);
  }
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../tools/workspace-popout-scenarios.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /evaluate\(`window\.__webReader=\$\{webView\}\.reader`\)/);
  assert.match(source, /readerCurrentDocumentReady\(webView\)/, "the moved Reader's current document readiness is awaited before real wheel input");
  assert.doesNotMatch(source, /documentRevision>window\.__webRevision/, "a reload is not mandatory");
});

test("the native guest block never calls an Electron-unsupported Browser-domain CDP method", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../tools/workspace-popout-scenarios.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /command\(\s*["']Browser\./);
});

test("readGuestHost calls the guarded native inspect action through the view's own IPC and requires exactly one owner", async () => {
  const seen = [];
  const reply = value => ({ evaluate: async expression => { seen.push(expression); return JSON.stringify(value); } });
  const owner = { id: 7, main: false, title: "t" };
  const host = await readGuestHost(reply({ guestWebContentsId: 3, guestUrl: "http://x/", mainWindowId: 1, owners: [owner] }), "VIEW");
  assert.deepEqual(host, { guestWebContentsId: 3, guestUrl: "http://x/", mainWindowId: 1, owner });
  assert.match(seen[0], /VIEW\.ipc\.invoke\("webviewer:request",\{id:VIEW\.id,action:"inspect"\}\)/);
  assert.doesNotMatch(seen[0], /getWindowForTarget/);
  for (const owners of [[], [owner, { ...owner, id: 8 }]]) {
    await assert.rejects(readGuestHost(reply({ guestWebContentsId: 3, guestUrl: "", mainWindowId: 1, owners }), "VIEW"), /exactly one BrowserWindow/);
  }
});

test("the readiness probe reports each predicate and the observed message envelopes, and the failure snapshot survives a broken CDP", async () => {
  const mk = (overrides = {}) => {
    const listeners = new Set(), source = {}, owner = { location: { origin: "http://x" }, addEventListener: (_n, l) => listeners.add(l), removeEventListener: (_n, l) => listeners.delete(l) };
    source.parent = owner; source.postMessage = message => { for (const l of listeners) l({ source: overrides.from ?? source, origin: "http://x", data: { channel: "slopsidian-reader", token: "tok", kind: "progress", requestId: message.requestId + (overrides.idShift ?? 0) } }); };
    const doc = { defaultView: owner };
    const reader = { post: m => source.postMessage(m), frame: { getAttribute: () => "allow-scripts", srcdoc: "d", isConnected: true, ownerDocument: doc, checkVisibility: () => true, contentWindow: source }, token: "tok", disposed: false, progressReady: true, documentRevision: 3, ownerWindow: owner };
    const window = { __webReader: reader };
    return vm.createContext({ view: { reader, surface: { ownerDocument: doc } }, window, setTimeout, clearTimeout });
  };
  const good = JSON.parse(await vm.runInContext(readerProbeExpression("view"), mk()));
  assert.equal(good.ok, true);
  assert.deepEqual({ ...good, at: 0, messages: [] }.preconditions, true);
  for (const key of ["sameReader", "connected", "inViewDocument", "ownerWindowIsFrameWindow", "progressReady", "visible", "parentIsOwner", "hasContentWindow"]) { assert.equal(good[key], true, key); }
  assert.equal(good.disposed, false);
  assert.equal(good.revision, 3);
  assert.deepEqual(good.messages.map(m => [m.kind, m.tokenMatch, m.sourceMatch, m.origin]), [["progress", true, true, "http://x"]]);
  const stale = JSON.parse(await vm.runInContext(readerProbeExpression("view"), mk({ from: {}, idShift: 0 })));
  assert.equal(stale.ok, false);
  assert.equal(stale.acked, false);
  assert.equal(stale.messages[0].sourceMatch, false, "the envelope shows the source mismatch instead of an aggregate false");
  const ctx = mk(); await vm.runInContext(readerProbeExpression("view"), ctx);
  const evaluate = async expression => vm.runInContext(expression, ctx);
  const snapshot = await readerFailureSnapshot({ evaluate, webPopup: { command: async () => { throw new Error("cdp down"); }, evaluate: async () => { throw new Error("cdp down"); } }, targets: async () => { throw new Error("no list"); }, webView: "view" });
  assert.equal(snapshot.lastProbe.ok, true);
  assert.equal(snapshot.popupFrameTree.unavailable, "frameTree");
  assert.equal(snapshot.targets.message, "no list");
});