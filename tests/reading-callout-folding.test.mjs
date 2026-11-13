import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
let directory, model;
before(async () => {
  await mkdir(join(repo, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(repo, ".runtime", "callout-folding-tests-"));
  const outfile = join(directory, "folding.mjs");
  await build({ entryPoints: [join(repo, "client/reading-callout-folding.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  model = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(repo, directory).replaceAll("\\", "/"), /^\.runtime\/callout-folding-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

function fixture() {
  const observers = [];
  const document = { defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  } } };
  let root;
  function element(tag, classes = "", line) {
    const names = new Set(classes.split(" ").filter(Boolean));
    return { tagName: tag.toUpperCase(), ownerDocument: document, children: [], parentElement: null, open: false,
      dataset: line === undefined ? {} : { sourceLine: String(line) }, listeners: new Map(),
      classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) },
      get childElementCount() { return this.children.length; },
      get isConnected() { return this === root || Boolean(this.parentElement?.isConnected); },
      contains(node) { return this === node || this.children.some(child => child.contains(node)); },
      closest(selector) { for (let node = this; node; node = node.parentElement) if (selector.split(",").some(part => part[0] === "." ? node.classList.contains(part.slice(1)) : node.tagName === part.toUpperCase())) return node; return null; },
      append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } },
      remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } },
      addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); },
      removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(value => value !== callback)); },
      emit(name, fields = {}) { const event = { target: this, button: 0, isTrusted: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields }; for (const callback of [...this.listeners.get(name) ?? []]) callback(event); return event; },
    };
  }
  document.createTreeWalker = section => {
    let cursor = 0; const nodes = [];
    const visit = node => { for (const child of node.children) { nodes.push(child); visit(child); } }; visit(section);
    return { nextNode: () => nodes[cursor++] ?? null };
  };
  root = element("div"); const section = element("div"); root.append(section);
  const source = ["# Callouts", "", "> [!note]+ Outer λ", "> Outside child", ">", "> > [!tip]- Nested", "> > nested target 😀", "", "> [!warning]- Separate", "> Independent"].join("\r\n");
  const make = (type, line, open) => {
    const node = element("details", "callout is-collapsible", line), summary = element("summary", "callout-title"), body = element("div", "callout-content");
    node.dataset.callout = type; node.open = open; node.append(summary, body); return { node, summary, body };
  };
  const a = make("note", 2, true), nested = make("tip", 5, false), b = make("warning", 8, false), target = element("p", "", 6), external = element("p", "", 10);
  nested.body.append(target); a.body.append(nested.node); section.append(a.node, b.node, external);
  let current = true, changes = 0;
  const inventory = () => model.captureReadingCallouts(section, source);
  const mount = (options = {}, value = inventory()) => new model.ReadingCalloutFolding(root, section, value, () => current, () => changes++, options);
  return { root, section, source, a, nested, b, target, external, element, document, inventory, mount, observers, invalidate: () => { current = false; }, changes: () => changes };
}

test("original mapped nested callouts retain +/- defaults and only summaries acquire view controls", () => {
  const f = fixture(), inventory = f.inventory(); assert.equal(inventory.message, null); assert.deepEqual(inventory.entries.map(entry => entry.line), [2, 5, 8]);
  const controller = f.mount(); assert.equal(controller.isDisposed, false); assert.deepEqual(controller.snapshot(), [5, 8]);
  assert.equal(f.a.node.open, true); assert.equal(f.nested.node.open, false); assert.equal(f.b.node.open, false);
  assert.equal(f.a.summary.dataset.readingCalloutToggle, "2"); assert.equal(f.target.dataset.readingCalloutToggle, undefined);
});

test("a full closed-line snapshot restores explicit expansion of Markdown-minus defaults", () => {
  const f = fixture(), writes = [], controller = f.mount({ initialCollapsed: [], onUserChange: value => writes.push(value) });
  assert.equal(f.b.node.open, true); assert.equal(f.nested.node.open, true); assert.deepEqual(controller.snapshot(), []); assert.deepEqual(writes, []);
  f.b.summary.emit("click"); assert.deepEqual(writes, [[8]]); assert.equal(f.b.node.open, false);
});

test("trusted summary activation preserves original DOM/source and persists explicit choices without toggle-event inference", () => {
  const f = fixture(), children = [...f.section.children], nested = [...f.a.body.children], writes = [], c = f.mount({ onUserChange: lines => writes.push([...lines]) });
  f.a.summary.emit("click"); assert.equal(f.a.node.open, false); assert.deepEqual(c.snapshot(), [2, 5, 8]);
  f.a.node.emit("toggle"); f.nested.node.emit("toggle"); assert.equal(writes.length, 1);
  assert.deepEqual(f.section.children, children); assert.deepEqual(f.a.body.children, nested); assert.equal(f.source.includes("nested target 😀\r\n"), true);
});

test("programmatic properties, coalesced toggle events, untrusted clicks and interactive title children never persist", () => {
  const f = fixture(), writes = [], c = f.mount({ onUserChange: lines => writes.push(lines) });
  f.b.node.open = true; f.b.node.emit("toggle"); f.a.summary.emit("click", { isTrusted: false });
  const link = f.element("a"); f.a.summary.append(link); f.a.summary.emit("click", { target: link }); f.a.summary.emit("click", { button: 1 });
  assert.deepEqual(writes, []); assert.deepEqual(c.snapshot(), [5, 8]); assert.equal(f.a.node.open, true);
});

test("temporary navigation reveals nested owners and subsequent writes preserve every unmodified explicit intent", () => {
  const f = fixture(), writes = [], c = f.mount({ initialCollapsed: [2, 5, 8], onUserChange: lines => writes.push([...lines]) });
  c.reveal(f.target); assert.equal(f.a.node.open, true); assert.equal(f.nested.node.open, true); assert.equal(f.b.node.open, false);
  assert.deepEqual(c.snapshot(), [2, 5, 8]); assert.deepEqual(writes, []);
  f.b.summary.emit("click"); assert.deepEqual(writes, [[2, 5]]); // Revealed ancestors stay intended collapsed.
  f.a.summary.emit("click"); f.a.summary.emit("click"); assert.deepEqual(writes.at(-1), [5]);
  c.reveal(f.external); assert.deepEqual(c.snapshot(), [5]); assert.equal(f.b.node.open, true);
});

test("revealing a callout title leaves its own child state while opening enclosing bodies only", () => {
  const f = fixture(), c = f.mount({ initialCollapsed: [2, 5, 8] }); c.reveal(f.nested.summary);
  assert.equal(f.a.node.open, true); assert.equal(f.nested.node.open, false); assert.deepEqual(c.snapshot(), [2, 5, 8]);
});

test("a block destination at a callout container reveals that container and its ancestors without persisting", () => {
  const f = fixture(), writes = [], c = f.mount({ initialCollapsed: [2, 5, 8], onUserChange: lines => writes.push([...lines]) });
  c.reveal(f.nested.node);
  assert.equal(f.a.node.open, true); assert.equal(f.nested.node.open, true); assert.equal(f.b.node.open, false);
  assert.deepEqual(c.snapshot(), [2, 5, 8]); assert.deepEqual(writes, []);
  f.b.summary.emit("click"); assert.deepEqual(writes, [[2, 5]]);
});

test("malformed preferences fall back to Markdown defaults; storage failure leaves folding usable", () => {
  for (const initialCollapsed of [[2, 2], [-1], ["2"], [NaN], {}, Array(513).fill(0)]) {
    const f = fixture(), c = f.mount({ initialCollapsed }); assert.deepEqual(c.snapshot(), [5, 8]); assert.equal(f.a.node.open, true); c.dispose();
  }
  const f = fixture(), c = f.mount({ onUserChange() { throw Error("quota"); } });
  assert.doesNotThrow(() => f.a.summary.emit("click")); assert.equal(f.a.node.open, false); assert.deepEqual(c.snapshot(), [2, 5, 8]);
});

test("unmapped HTML, noncollapsible callouts and footnote-owned details do not acquire persistence", () => {
  const f = fixture(), html = f.element("details", "callout is-collapsible"); f.section.append(html);
  f.b.node.classList.remove("is-collapsible"); const footnotes = f.element("section", "footnotes"); f.section.append(footnotes); footnotes.append(f.nested.node);
  const inventory = f.inventory(); assert.equal(inventory.message, null); assert.deepEqual(inventory.entries.map(entry => entry.line), [2]);
  const c = f.mount({}, inventory); assert.equal(c.includes(html), false); assert.equal(c.includes(f.b.node), false); assert.equal(c.includes(f.nested.node), false);
});

test("ambiguous source owners, unsupported header grammar and changed structural mappings refuse capture", () => {
  for (const mutate of [f => { f.b.node.dataset.sourceLine = "2"; }, f => { f.a.node.dataset.callout = "other"; }, f => { f.a.node.dataset.sourceLine = "-1"; }, f => { f.a.summary.tagName = "DIV"; }, f => f.a.node.append(f.element("div"))]) {
    const f = fixture(); mutate(f); const inventory = f.inventory(); assert.ok(inventory.message); assert.deepEqual(inventory.entries, []); assert.equal(f.mount({}, inventory).isDisposed, true);
  }
});

test("changed view/source/root or replaced/remapped/adopted originals retire held actions before persistence", () => {
  for (const mutate of [f => f.invalidate(), f => { f.a.node.dataset.sourceLine = "3"; }, f => f.nested.node.remove(), f => { f.a.summary.tagName = "DIV"; }, f => { f.root.ownerDocument = {}; }, f => { f.a.body.classList.remove("callout-content"); }]) {
    const f = fixture(), writes = [], c = f.mount({ onUserChange: lines => writes.push(lines) }); mutate(f); f.a.summary.emit("click");
    assert.equal(c.isDisposed, true); assert.deepEqual(writes, []); assert.equal(f.a.summary.dataset.readingCalloutToggle, undefined); assert.equal(f.observers[0].disconnected, true);
  }
});

test("postprocessor replacement cannot acquire the captured owner's search or collapse authority", () => {
  const f = fixture(), inventory = f.inventory(), replacement = f.element("details", "callout is-collapsible", 2);
  f.a.node.remove(); f.section.append(replacement); const c = f.mount({}, inventory); assert.equal(c.isDisposed, true); assert.equal(c.includes(replacement), false);
  assert.equal(replacement.children.length, 0); assert.equal(replacement.open, false);
});

test("cleanup is idempotent, restores Markdown defaults and makes delayed toggle callbacks inert", () => {
  const f = fixture(), writes = [], c = f.mount({ initialCollapsed: [2], onUserChange: lines => writes.push(lines) });
  assert.equal(f.a.node.open, false); assert.equal(f.b.node.open, true); c.dispose(); c.dispose(); f.a.node.emit("toggle"); f.b.summary.emit("click");
  assert.equal(f.a.node.open, true); assert.equal(f.b.node.open, false); assert.equal(f.nested.node.open, false); assert.deepEqual(writes, []);
});

test("source and DOM budgets refuse before unbounded traversal and preference payloads stay detached", () => {
  assert.ok(model.captureReadingCallouts({ get childElementCount() { throw Error("must not inspect DOM"); } }, "x".repeat(model.MAX_READING_CALLOUT_SOURCE + 1)).message);
  assert.ok(model.captureReadingCallouts({ childElementCount: model.MAX_READING_CALLOUT_NODES + 1, get ownerDocument() { throw Error("must not walk"); } }, "").message);
  const raw = [8, 2, 99], result = model.readingCalloutState(raw, [2, 5, 8]); assert.deepEqual(result, [2, 8]); result.push(5); assert.deepEqual(raw, [8, 2, 99]);
});
