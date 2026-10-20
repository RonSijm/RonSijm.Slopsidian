import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "reading-folding-tests-"));
  const outfile = join(directory, "folding.mjs");
  await build({ entryPoints: [join(root, "client/reading-folding.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/reading-folding-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

// Small identity-preserving DOM fixture; acceptance helpers use actual buttons,
// DOM Selection, rendered plugins and host lifecycle in both browser engines.
function fixture() {
  const observers = [], document = { defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; (this.observations ??= []).push({ target, options }); }
    disconnect() { this.disconnected = true; }
  } } };
  function element(tag, text = "", line) {
    const node = { tagName: tag.toUpperCase(), ownerDocument: document, parentElement: null, children: [], dataset: line === undefined ? {} : { sourceLine: String(line) }, attributes: {}, listeners: new Map(), textContent: text,
      get childElementCount() { return this.children.length; }, get isConnected() { return this === root || Boolean(this.parentElement?.isConnected); },
      getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }, hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
      setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); },
      click() { for (const callback of this.listeners.get("click") ?? []) callback({ preventDefault() {}, stopPropagation() {} }); },
      append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } },
      prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); },
      remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } },
    };
    return node;
  }
  document.createElement = tag => element(tag);
  const root = element("div"), section = element("div"); root.append(section);
  const top = element("h1", "Root λ", 0), a = element("h2", "Parent A", 2), proseA = element("p", "alpha alpha", 4), child = element("h3", "Child A", 6), proseChild = element("p", "alpha alpha", 8),
    b = element("h2", "Parent B", 10), proseB = element("p", "alpha alpha", 12), list = element("ul", "retained list", 14), code = element("pre", "retained code", 18), empty = element("h2", "Empty", 23), last = element("h2", "Last", 25);
  const plugin = element("span", "plugin owned"), math = element("span", "formula"), embed = element("div", "embed");
  proseChild.append(plugin, math, embed);
  section.append(top, a, proseA, child, proseChild, b, proseB, list, code, empty, last);
  const metadata = [top, a, child, b, empty, last].map(element => ({ heading: element.textContent, level: Number(element.tagName[1]), position: { start: { line: Number(element.dataset.sourceLine) } } }));
  const inventory = () => feature.captureReadingFolds(section, 500, metadata);
  let current = true, changes = 0;
  const mount = (data = inventory(), options = {}) => new feature.ReadingFolding(root, section, data, () => current, () => changes++, options);
  const control = heading => heading.children.find(node => node.dataset.readingFoldToggle !== undefined);
  return { root, section, top, a, proseA, child, proseChild, b, proseB, list, code, empty, last, plugin, math, embed, metadata, document, observers, element, inventory, mount, control,
    invalidate() { current = false; }, changes: () => changes, hidden: () => section.children.filter(node => node.hasAttribute("hidden")).map(node => node.dataset.sourceLine) };
}

test("the bounded inventory maps top-level ATX/setext source headings and leaves empty headings without controls", () => {
  const f = fixture(), inventory = f.inventory();
  assert.equal(inventory.message, null);
  assert.deepEqual(inventory.headings.map(({ line, level, end }) => [line, level, end]), [[0, 1, Infinity], [2, 2, 10], [6, 3, 10], [10, 2, 23]]);
  assert.deepEqual(inventory.blocks.map(block => block.element), f.section.children);
  const folding = f.mount(inventory);
  assert.equal(f.control(f.empty), undefined); assert.equal(f.control(f.last), undefined);
  assert.equal(f.control(f.a).tagName, "BUTTON"); assert.equal(f.control(f.a).type, "button");
  assert.equal(f.control(f.a).getAttribute("aria-expanded"), "true"); assert.match(f.control(f.a).getAttribute("aria-label"), /Collapse heading Parent A/);
  assert.equal(f.control(f.a).textContent, "▾"); folding.dispose();
});

test("exact-source-approved heading starts restore on original nodes without writing; explicit choices survive temporary reveals", () => {
  const f = fixture(), writes = [], original = [...f.section.children], folding = f.mount(f.inventory(), {
    initialCollapsed: [10, 2, 6, 999], onUserChange: lines => writes.push([...lines]),
  });
  assert.deepEqual(folding.snapshot(), [2, 6, 10]); assert.deepEqual(writes, []);
  assert.deepEqual(f.hidden(), ["4", "6", "8", "12", "14", "18"]); assert.deepEqual(f.section.children, original);
  folding.reveal(f.plugin); assert.deepEqual(f.hidden(), ["12", "14", "18"]);
  assert.deepEqual(folding.snapshot(), [2, 6, 10]); assert.deepEqual(writes, []);
  // A revealed owner is visually expanded. Its next activation explicitly
  // collapses it again; the following activation explicitly removes its intent.
  f.control(f.a).click(); assert.deepEqual(writes, [[2, 6, 10]]);
  f.control(f.a).click(); assert.deepEqual(writes, [[2, 6, 10], [6, 10]]);
  folding.dispose(); assert.equal(writes.length, 2); assert.deepEqual(f.hidden(), []);
});

test("heading restore refuses malformed payloads and storage failure leaves actual controls usable", () => {
  for (const initialCollapsed of [[2, 2], [2, "6"], [2, -1], [2, 1.5], { headings: [2] }]) {
    const f = fixture(), folding = f.mount(f.inventory(), { initialCollapsed });
    assert.deepEqual(folding.snapshot(), []); assert.deepEqual(f.hidden(), []); folding.dispose();
  }
  const f = fixture(), folding = f.mount(f.inventory(), { onUserChange() { throw Error("profile unavailable"); } });
  assert.doesNotThrow(() => f.control(f.a).click()); assert.deepEqual(folding.snapshot(), [2]); assert.deepEqual(f.hidden(), ["4", "6", "8"]);
  assert.doesNotThrow(() => f.control(f.a).click()); assert.deepEqual(f.hidden(), []); folding.dispose();
});

test("duplicate heading panes keep local controls while the last explicit view wins and stale owners never overwrite", () => {
  let saved = [2], writes = 0;
  const a = fixture(), b = fixture(), options = () => ({ initialCollapsed: saved, onUserChange: lines => { saved = [...lines]; writes++; } });
  const first = a.mount(a.inventory(), options()), second = b.mount(b.inventory(), options());
  a.control(a.a).click(); assert.deepEqual(saved, []); assert.equal(b.control(b.a).getAttribute("aria-expanded"), "false");
  b.control(b.b).click(); assert.deepEqual(saved, [2, 10]); assert.equal(a.control(a.b).getAttribute("aria-expanded"), "true");
  const held = a.control(a.child); a.invalidate(); held.click(); assert.equal(first.isDisposed, true); assert.equal(writes, 2);
  second.reveal(b.proseB); second.dispose(); assert.equal(writes, 2); assert.deepEqual(saved, [2, 10]);
});

test("nested and disjoint folds preserve the child state when its parent expands", () => {
  const f = fixture(), folding = f.mount();
  f.control(f.child).click(); assert.deepEqual(f.hidden(), ["8"]);
  f.control(f.a).click(); assert.deepEqual(f.hidden(), ["4", "6", "8"]);
  assert.equal(f.control(f.a).getAttribute("aria-expanded"), "false"); assert.equal(f.control(f.a).textContent, "▸");
  f.control(f.b).click(); assert.deepEqual(f.hidden(), ["4", "6", "8", "12", "14", "18"]);
  f.control(f.a).click(); assert.deepEqual(f.hidden(), ["8", "12", "14", "18"]); assert.equal(f.control(f.child).getAttribute("aria-expanded"), "false");
  f.control(f.child).click(); assert.deepEqual(f.hidden(), ["12", "14", "18"]);
  f.control(f.b).click(); assert.deepEqual(f.hidden(), []); assert.equal(f.changes(), 6); folding.dispose();
});

test("collapsed intervals merge nested state without expanding the next disjoint subtree", () => {
  const headings = [{ line: 0, end: 30 }, { line: 2, end: 10 }, { line: 6, end: 10 }, { line: 10, end: 23 }, { line: 30, end: Infinity }];
  assert.deepEqual(feature.readingFoldIntervals(headings, new Set([2, 6, 10, 30])), [{ from: 2, to: 10 }, { from: 10, to: 23 }, { from: 30, to: Infinity }]);
  assert.deepEqual(feature.readingFoldIntervals(headings, new Set([0, 2, 6, 10])), [{ from: 0, to: 30 }]);
});

test("heading, block and nested footnote-backref targets expand only their collapsed ancestors", () => {
  const f = fixture(), folding = f.mount();
  f.control(f.child).click(); f.control(f.a).click(); f.control(f.b).click();
  folding.reveal(f.child); assert.deepEqual(f.hidden(), ["8", "12", "14", "18"]); assert.equal(f.control(f.child).getAttribute("aria-expanded"), "false");
  f.control(f.a).click(); folding.reveal(f.plugin); assert.deepEqual(f.hidden(), ["12", "14", "18"]);
  assert.equal(f.control(f.a).getAttribute("aria-expanded"), "true"); assert.equal(f.control(f.child).getAttribute("aria-expanded"), "true");
  const note = f.element("section"); f.section.append(note); // unsupported external topology retires this owner
  folding.reveal(note); assert.equal(folding.isDisposed, true); assert.deepEqual(f.hidden(), []);
});

test("folding keeps exact code/math/embed/plugin nodes and listeners with no wrapping or source mutation", () => {
  const f = fixture(), original = [...f.section.children], nested = [...f.proseChild.children], originalText = original.map(node => node.textContent), folding = f.mount();
  let clicks = 0; f.plugin.addEventListener("click", () => clicks++);
  f.control(f.top).click(); f.control(f.top).click(); f.plugin.click();
  assert.deepEqual(f.section.children, original); assert.deepEqual(f.proseChild.children, nested); assert.deepEqual(original.map(node => node.textContent), originalText);
  assert.equal(f.plugin.parentElement, f.proseChild); assert.equal(clicks, 1); assert.equal(f.plugin, nested[0]);
  folding.dispose(); assert.deepEqual(f.section.children, original); assert.deepEqual(f.hidden(), []);
});

test("unmapped injected siblings and pre-existing hidden attributes belong to their original owners", () => {
  const f = fixture(); f.proseA.setAttribute("hidden", "until-found"); f.proseChild.setAttribute("hidden", "");
  const data = f.inventory(), external = f.element("div", "plugin injected root"), nestedHeading = f.element("h2", "Nested plugin heading", 999);
  f.section.append(external); external.append(nestedHeading);
  const folding = f.mount(data); f.control(f.top).click(); assert.equal(external.hasAttribute("hidden"), false); assert.equal(nestedHeading.children.length, 0);
  f.control(f.top).click(); folding.dispose();
  assert.equal(f.proseA.getAttribute("hidden"), "until-found"); assert.equal(f.proseChild.getAttribute("hidden"), ""); assert.equal(external.parentElement, f.section);
});

test("cleanup restores only owned empty hidden attributes and leaves an external replacement value", () => {
  const f = fixture(), folding = f.mount(); f.control(f.a).click();
  f.proseA.setAttribute("hidden", "until-found"); folding.dispose();
  assert.equal(f.proseA.getAttribute("hidden"), "until-found"); assert.equal(f.proseChild.hasAttribute("hidden"), false); assert.equal(f.child.hasAttribute("hidden"), false);
  folding.dispose(); assert.equal(f.changes(), 2); // collapse plus one idempotent cleanup
});

test("held controls after file/root/mode ownership loss retire themselves before touching current content", () => {
  const f = fixture(), folding = f.mount(), held = f.control(f.a); held.click(); assert.equal(f.proseA.hasAttribute("hidden"), true);
  f.invalidate(); held.click(); assert.equal(folding.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(held.parentElement, null);
  const other = f.element("p", "new content", 4); f.section.append(other); held.click(); assert.equal(other.hasAttribute("hidden"), false); assert.equal(f.changes(), 2);
});

test("external replacement, reordering and document adoption make old controls inert", () => {
  for (const mutate of [f => { f.section.children.reverse(); }, f => { f.section.append(f.element("p", "external", 30)); }, f => { f.root.ownerDocument = {}; }, f => { f.a.dataset.sourceLine = "99"; }]) {
    const f = fixture(), folding = f.mount(), held = f.control(f.a); held.click(); mutate(f); held.click();
    assert.equal(folding.isDisposed, true); assert.equal(held.parentElement, null); assert.deepEqual(f.hidden(), []);
  }
  const f = fixture(), folding = f.mount(); f.control(f.a).click(); f.section.children.pop(); f.observers[0].callback();
  assert.equal(folding.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(f.observers[0].disconnected, true);
});

test("a postprocessor that replaces a trusted heading cannot acquire a control on its replacement", () => {
  const f = fixture(), inventory = f.inventory(); f.a.remove();
  const replacement = f.element("h2", "plugin heading", 2); f.section.prepend(replacement);
  const folding = f.mount(inventory); assert.equal(folding.isDisposed, true); assert.equal(replacement.children.length, 0);
  assert.equal(f.section.children.some(node => node.children.some(child => child.dataset.readingFoldToggle !== undefined)), false);
});

test("postprocessor reordering or remapping of original blocks refuses installation before any fold can hide them", () => {
  for (const mutate of [f => f.section.prepend(f.proseA), f => f.section.append(f.proseA), f => { f.proseA.dataset.sourceLine = "8"; }, f => { f.empty.remove(); }]) {
    const f = fixture(), inventory = f.inventory(); mutate(f);
    const original = [...f.section.children], folding = f.mount(inventory);
    assert.equal(folding.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.deepEqual(f.section.children, original);
    assert.equal(f.section.children.some(node => node.children.some(child => child.dataset.readingFoldToggle !== undefined)), false);
    assert.equal(f.plugin.parentElement, f.proseChild);
  }
});

test("a plugin-replaced original code block and injected siblings remain outside the owned block inventory", () => {
  const f = fixture(), inventory = f.inventory(), replacement = f.element("div", "owned code replacement", 18), injected = f.element("p", "injected root sibling");
  f.code.remove(); f.section.append(replacement, injected);
  const original = [...f.section.children], folding = f.mount(inventory);
  assert.equal(folding.isDisposed, false); f.control(f.b).click();
  assert.equal(f.proseB.hasAttribute("hidden"), true); assert.equal(f.list.hasAttribute("hidden"), true);
  assert.equal(replacement.hasAttribute("hidden"), false); assert.equal(injected.hasAttribute("hidden"), false);
  assert.equal(replacement.dataset.sourceLine, "18"); assert.deepEqual(f.section.children, original);
  folding.dispose(); assert.deepEqual(f.hidden(), []);
});

test("removing or moving a collapsed heading's owned button retires the layer and restores its hidden blocks", () => {
  for (const mutate of [(f, button) => button.remove(), (f, button) => f.b.append(button), (f, button) => f.root.append(button)]) {
    const f = fixture(), folding = f.mount(), button = f.control(f.a);
    button.click(); assert.deepEqual(f.hidden(), ["4", "6", "8"]); mutate(f, button);
    const observer = f.observers[0]; assert.ok(observer.observations.some(record => record.target === f.a && record.options.childList));
    observer.callback(); assert.equal(folding.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(button.parentElement, null);
    assert.equal(f.plugin.parentElement, f.proseChild); assert.equal(f.control(f.b), undefined);
    button.click(); assert.deepEqual(f.hidden(), []); assert.equal(f.changes(), 2);
  }
});

test("synchronous action guards reject a missing button or changed original paragraph mapping before observer delivery", () => {
  for (const mutate of [f => f.control(f.a).remove(), f => { f.proseA.dataset.sourceLine = "99"; }]) {
    const f = fixture(), folding = f.mount(), held = f.control(f.b); f.control(f.a).click();
    mutate(f); held.click(); assert.equal(folding.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(held.parentElement, null);
  }
});

test("direct heading plugin changes keep folding available while observation excludes arbitrary nested mutations and own labels", () => {
  const f = fixture(), folding = f.mount(), button = f.control(f.a), plugin = f.element("span", "plugin heading adornment");
  button.click(); f.a.append(plugin); f.observers[0].callback();
  assert.equal(folding.isDisposed, false); assert.deepEqual(f.hidden(), ["4", "6", "8"]); assert.equal(plugin.parentElement, f.a);
  for (const record of f.observers[0].observations) {
    assert.notEqual(record.options.subtree, true);
    if (record.options.attributes) { assert.deepEqual(record.options.attributeFilter, ["data-source-line"]); }
    assert.notEqual(record.target, button); assert.notEqual(record.target, f.plugin);
  }
  button.click(); assert.deepEqual(f.hidden(), []); folding.dispose(); assert.equal(plugin.parentElement, f.a);
});

test("handmade HTML headings, mismatched levels and out-of-order mapped blocks refuse the render", () => {
  for (const mutate of [f => f.section.append(f.element("h2", "raw HTML")), f => { f.a.tagName = "H4"; }, f => { f.proseA.dataset.sourceLine = "1"; }]) {
    const f = fixture(); mutate(f); const inventory = f.inventory(); assert.ok(inventory.message); assert.deepEqual(inventory.headings, []); assert.deepEqual(inventory.blocks, []);
    const folding = f.mount(inventory); assert.equal(f.section.children.some(node => node.children.some(child => child.dataset.readingFoldToggle !== undefined)), false); folding.dispose();
  }
});

test("inventory budgets refuse before enumerating blocks, metadata or oversized heading strings", () => {
  const neverEnumerate = { childElementCount: feature.MAX_READING_FOLD_BLOCKS + 1, get children() { throw Error("must not enumerate"); } };
  assert.match(feature.captureReadingFolds(neverEnumerate, 0, []).message, /limit/);
  assert.match(feature.captureReadingFolds({ get childElementCount() { throw Error("must not inspect DOM"); } }, feature.MAX_READING_FOLD_SOURCE + 1, []).message, /limit/);
  const headings = { length: feature.MAX_READING_FOLD_HEADINGS + 1, [Symbol.iterator]() { throw Error("must not enumerate metadata"); } };
  assert.match(feature.captureReadingFolds({ childElementCount: 0 }, 0, headings).message, /limit/);
  const f = fixture(); f.metadata[0].heading = "x".repeat(1_025); assert.match(f.inventory().message, /heading text/);
  const labels = Array.from({ length: 66 }, (_, line) => ({ heading: "x".repeat(1_000), level: 1, position: { start: { line } } }));
  assert.match(feature.captureReadingFolds({ childElementCount: 0, get children() { throw Error("must not inspect blocks"); } }, 100, labels).message, /heading text/);
});
