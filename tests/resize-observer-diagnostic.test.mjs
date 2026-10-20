import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createResizeObserverDiagnostic, resizeObserverHookSource } from "../tools/resize-observer-diagnostic.mjs";

function realm(href) {
  const listeners = [], calls = [];
  class Real { constructor(callback) { this.callback = callback; } observe(node) { calls.push(["observe", node.tagName]); return "observed"; } }
  const window = { ResizeObserver: Real, location: { href }, addEventListener: (type, fn) => listeners.push([type, fn]) };
  const context = vm.createContext({ window, location: window.location, document: { id: "doc" }, Error, JSON, String, Boolean, Date });
  const session = {
    commands: [],
    command: async (method, params) => { session.commands.push([method, params]); },
    evaluate: async expression => vm.runInContext(expression, context),
  };
  return { window, listeners, calls, session, context };
}

test("the hook is installed per realm, reinstalled on a new document, retained, and a missing hook fails loudly", async () => {
  const diag = createResizeObserverDiagnostic();
  const main = realm("http://main/"), popout = realm("about:blank");
  await diag.install("main", main.session);
  await diag.install("popout", popout.session);
  assert.equal(main.session.commands[0][0], "Page.addScriptToEvaluateOnNewDocument");
  assert.equal(main.session.commands[0][1].source, resizeObserverHookSource);
  assert.equal(popout.session.commands[0][0], "Page.addScriptToEvaluateOnNewDocument");

  const seen = [], doc = { id: "doc", defaultView: main.window };
  const scroller = { tagName: "DIV", className: "cm-scroller", ownerDocument: doc, isConnected: true };
  main.window.app = { workspace: { iterateAllLeaves: visit => visit({ id: "pop-b", view: { getViewType: () => "markdown", editor: { cm: { scrollDOM: scroller } } } }) } };
  const observer = new main.window.ResizeObserver(function (entries, o) { seen.push([this === observer, entries, o]); return "result"; });
  assert.equal(observer.observe(scroller), "observed", "observe keeps its return value");
  assert.equal(main.window.__roDiag.observers.length, 1);
  assert.equal(main.window.__roDiag.observers[0].targets[0].tag, "DIV");
  assert.deepEqual(JSON.parse(JSON.stringify(main.window.__roDiag.observers[0].targets[0].owner)), { leaf: "pop-b", view: "markdown", cm: true });
  assert.ok(observer instanceof main.context.window.ResizeObserver);

  const entry = { target: scroller, contentRect: { width: 640, height: 480 }, borderBoxSize: [{ inlineSize: 650, blockSize: 490 }] };
  assert.equal(observer.callback([entry], observer), "result", "the wrapped callback returns the original result");
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], true, "callback this is the observer");
  assert.equal(seen[0][1][0], entry, "callback receives the original entries");
  assert.equal(seen[0][2], observer);
  const delivery = main.window.__roDiag.deliveries[0];
  assert.equal(delivery.width, 640);
  assert.equal(delivery.borderBlock, 490);
  assert.equal(delivery.owner.leaf, "pop-b");

  scroller.isConnected = false;
  doc.defaultView = { closed: true, location: { href: "about:blank" } };
  main.window.__roDiag.refresh();
  assert.deepEqual(JSON.parse(JSON.stringify(main.window.__roDiag.live.map(t => [t.window, t.windowClosed, t.connected]))), [["about:blank", true, false]], "current ownership is recorded, not only observe time");
  await diag.assertAll();
  await diag.retain("main");
  await diag.retain("popout");
  assert.equal(diag.snapshots.length, 2);
  assert.equal(diag.snapshots[0].data.observers.length, 1);

  delete main.window.__roDiag;
  await assert.rejects(diag.assertAll(), /hook is missing in main/, "a lost hook cannot silently produce a null diagnostic");
  await assert.rejects(diag.retain("main"), /hook is missing in main/);
  await vm.runInContext(resizeObserverHookSource, main.context);
  await diag.assertOne("main");
  assert.equal(diag.snapshots[0].data.observers.length, 1, "earlier snapshots survive a realm reset");
  diag.release("popout");
  delete popout.window.__roDiag;
  await diag.assertAll();
});
