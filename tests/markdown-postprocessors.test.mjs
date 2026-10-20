import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build } from "esbuild";

let processRenderedMarkdown, MarkdownPreviewRenderer;
const errors = [];
globalThis.markdownChildErrors = errors;
before(async () => {
  const result = await build({
    entryPoints: ["client/markdown-postprocessors.ts"], bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "error-sink", setup(build) {
      build.onResolve({ filter: /^\.\/dom$/ }, () => ({ path: "errors", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const reportError = error => globalThis.markdownChildErrors.push(error);" }));
    } }],
  });
  ({ processRenderedMarkdown, MarkdownPreviewRenderer } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")));
});

// Only DOM ownership is modelled here. Real MutationObserver delivery and the
// unchanged Admonition package are exercised by the desktop/WASM scenarios.
class Element {
  constructor(document, connected = false) { this.ownerDocument = document; this.connected = connected; this.children = []; this.parent = null; }
  get isConnected() { return this.parent?.isConnected ?? this.connected; }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  append(child) { child.remove(); this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.connected = false; }
}
globalThis.HTMLElement = Element;
class Observer {
  static all = new Set();
  constructor(callback) { this.callback = callback; }
  observe() { Observer.all.add(this); }
  disconnect() { Observer.all.delete(this); }
  static flush() { for (const observer of [...Observer.all]) observer.callback(); }
}
globalThis.MutationObserver = Observer;
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function child(element, methods = {}) {
  return Object.assign({ containerEl: element, loads: 0, unloads: 0, load() { this.loads++; }, unload() { this.unloads++; } }, methods);
}
function fixture(t, processor, current = () => true, retainDetachedRoot = false) {
  const document = {}, root = new Element(document, true);
  const scoped = (element, context) => { if (element === root) return processor(element, context); };
  MarkdownPreviewRenderer.registerPostProcessor(scoped);
  const render = processRenderedMarkdown(root, "Owned.md", "", { sections: [] }, current, true, retainDetachedRoot);
  t.after(async () => { MarkdownPreviewRenderer.unregisterPostProcessor(scoped); await render.dispose(); });
  return { document, root, render };
}

test("A child can own the render root; removal unloads it exactly once", async t => {
  let counter;
  const { root, render } = fixture(t, (element, context) => context.addChild(counter = child(element)));
  await render.ready;
  assert.equal(counter.loads, 1);
  root.remove(); Observer.flush();
  await render.dispose(); Observer.flush();
  assert.equal(counter.unloads, 1);
});

test("A component-owned cached root retains its children through detachment but still releases removed descendants and explicit disposal", async t => {
  let rootChild, nestedChild;
  const { root, render, document } = fixture(t, (element, context) => {
    const nested = new Element(element.ownerDocument); element.append(nested);
    context.addChild(rootChild = child(element));
    context.addChild(nestedChild = child(nested));
  }, () => true, true);
  await render.ready;
  root.remove(); Observer.flush(); await turn();
  assert.deepEqual([rootChild.unloads, nestedChild.unloads], [0, 0], "Detaching an owned cache must not unload its still-owned contents.");
  nestedChild.containerEl.remove(); Observer.flush(); await turn();
  assert.deepEqual([rootChild.unloads, nestedChild.unloads], [0, 1], "Removing an individual descendant must still release that child.");
  new Element(document, true).append(root); Observer.flush();
  await render.dispose();
  assert.deepEqual([rootChild.loads, rootChild.unloads, nestedChild.unloads], [1, 1, 1]);
});

test("Detached title and wrapper children survive asynchronous construction and are adopted together", async t => {
  const gate = deferred(), started = deferred(); let title, wrapper, titleChild, bodyChild;
  const { render } = fixture(t, async (element, context) => {
    wrapper = new Element(element.ownerDocument); title = new Element(element.ownerDocument); wrapper.append(title);
    context.addChild(titleChild = child(title)); context.addChild(bodyChild = child(wrapper));
    started.resolve(); await gate.promise;
    element.append(wrapper);
  });
  await started.promise; Observer.flush(); await turn();
  assert.deepEqual([titleChild.loads, bodyChild.loads, titleChild.unloads, bodyChild.unloads], [1, 1, 0, 0]);
  gate.resolve(); await render.ready;
  title.remove(); Observer.flush(); await turn();
  assert.deepEqual([titleChild.unloads, bodyChild.unloads], [1, 0]);
  wrapper.remove(); Observer.flush(); await render.dispose();
  assert.equal(bodyChild.unloads, 1);
});

for (const fail of [false, true]) test(`Never inserted children are unloaded when a processor ${fail ? "fails" : "finishes"}`, async t => {
  let counter;
  const { render } = fixture(t, (element, context) => {
    context.addChild(counter = child(new Element(element.ownerDocument)));
    if (fail) throw new Error("processor failed");
  });
  if (fail) await assert.rejects(render.ready, /processor failed/); else await render.ready;
  assert.equal(counter.loads, 1); assert.equal(counter.unloads, 1);
  assert.equal(Observer.all.size, 0);
});

test("Connected foreign nodes, foreign documents, malformed and multiply owned children are rejected", async t => {
  let shared, context;
  const first = fixture(t, (element, ctx) => {
    context = ctx;
    assert.throws(() => ctx.addChild(child(new Element(element.ownerDocument, true))), /available element/);
    assert.throws(() => ctx.addChild(child(new Element({}))), /available element/);
    assert.throws(() => ctx.addChild({ containerEl: element }), /component lifecycle/);
    ctx.addChild(shared = child(element));
    assert.throws(() => ctx.addChild(shared), /distinct component/);
  });
  await first.render.ready;
  const second = fixture(t, (_element, ctx) => assert.throws(() => ctx.addChild(shared), /distinct component/));
  await second.render.ready;
  await first.render.dispose();
  assert.throws(() => context.addChild(child(first.root)), /no longer active/);
});

test("Disposal joins an observer-started async unload, including native-style unload overrides", async t => {
  const gate = deferred(); let counter, unloading = false, sharedUnload;
  const { root, render } = fixture(t, (element, context) => {
    const button = new Element(element.ownerDocument); element.append(button);
    context.addChild(counter = child(button, {
      unload() { this.unloads++; sharedUnload = gate.promise; },
      async unloadAndWait() { this.unload(); unloading = true; await sharedUnload; },
    }));
  });
  await render.ready; counter.containerEl.remove(); Observer.flush(); await turn();
  assert.equal(unloading, true);
  let done = false; const disposing = render.dispose().then(() => { done = true; });
  assert.equal(render.dispose(), render.dispose());
  await turn(); assert.equal(done, false);
  root.remove(); Observer.flush(); gate.resolve(); await disposing;
  assert.equal(counter.unloads, 1);
});

test("An asynchronous load completing after removal is unloaded before disposal completes", async t => {
  const gate = deferred(), started = deferred(); let counter;
  const { render } = fixture(t, (element, context) => {
    const button = new Element(element.ownerDocument); element.append(button);
    context.addChild(counter = child(button, { async load() { this.loads++; started.resolve(); await gate.promise; } }));
  });
  await started.promise; counter.containerEl.remove(); Observer.flush();
  let done = false; const disposing = render.dispose().then(() => { done = true; });
  await turn(); assert.equal(counter.unloads, 0); assert.equal(done, false);
  gate.resolve(); await Promise.all([disposing, render.ready]);
  assert.equal(counter.unloads, 1);
});

test("Superseded construction releases its pending children and rejects late registrations", async t => {
  let current = true, counter, context; const started = deferred(), gate = deferred();
  const { render } = fixture(t, async (element, ctx) => {
    context = ctx; ctx.addChild(counter = child(new Element(element.ownerDocument)));
    started.resolve(); await gate.promise;
    assert.throws(() => ctx.addChild(child(element)), /no longer active/);
  }, () => current);
  await started.promise; current = false; Observer.flush(); await turn();
  assert.equal(counter.unloads, 1);
  gate.resolve(); await render.ready;
  assert.equal(context.getSectionInfo({}), null);
});

test("Late same-turn adoption is allowed, while abandoned late registrations are collected", async t => {
  let context;
  const { root, document, render } = fixture(t, (_element, ctx) => { context = ctx; });
  await render.ready;
  const adopted = child(new Element(document)), abandoned = child(new Element(document));
  context.addChild(adopted); root.append(adopted.containerEl); context.addChild(abandoned);
  await turn();
  assert.equal(adopted.unloads, 0); assert.equal(abandoned.unloads, 1);
  await render.dispose(); assert.equal(adopted.unloads, 1);
});

test("A rejected load is reported and its never inserted child still unloads", async t => {
  const expected = new Error("load failed"); let counter;
  const { render } = fixture(t, (element, context) => context.addChild(counter = child(new Element(element.ownerDocument), { load() { throw expected; } })));
  await assert.rejects(render.ready, /load failed/);
  assert.equal(counter.unloads, 1); assert.ok(errors.includes(expected));
});
