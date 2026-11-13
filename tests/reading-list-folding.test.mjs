import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, model;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "reading-list-folding-tests-"));
  const outfile = join(directory, "lists.mjs");
  await build({ stdin: { contents: 'export * from "./client/reading-list-folding";export {parseMarkdown} from "./client/markdown";', resolveDir: root, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  model = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/reading-list-folding-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

function fixture(ordered = false) {
  const observers = [], document = { defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; this.observations = []; observers.push(this); }
    observe(target, options) { this.observations.push({ target, options }); }
    disconnect() { this.disconnected = true; }
  } } };
  function element(tag, text = "", line) {
    return { tagName: tag.toUpperCase(), ownerDocument: document, parentElement: null, children: [], dataset: line === undefined ? {} : { sourceLine: String(line) }, attributes: {}, listeners: new Map(), textContent: text,
      get childElementCount() { return this.children.length; }, get isConnected() { return this === root || Boolean(this.parentElement?.isConnected); },
      getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }, hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
      setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); },
      click() { for (const callback of this.listeners.get("click") ?? []) callback({ preventDefault() {}, stopPropagation() {} }); },
      contains(target) { return this === target || this.children.some(child => child.contains(target)); },
      append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } },
      prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); },
      remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } },
    };
  }
  document.createElement = tag => element(tag);
  const root = element("div"), section = element("div"), title = element("h1", "Lists", 0); root.append(section);
  const source = ["# Lists", "- [ ] Parent A", "  - Child A", "    - alpha grand ^deep", "  - alpha sibling", "- Parent B", "  - alpha independent", "", "Outside alpha.", ""].join("\r\n");
  const text = ordered ? source.replace(/(^|\r\n)( *)-/g, (_match, newline, indent) => newline + " ".repeat(indent.length / 2 * 3) + "1.") : source;
  const tag = ordered ? "ol" : "ul", list = element(tag, "", 1), a = element("li", "Parent A", 1), b = element("li", "Parent B", 5), task = element("input"), p = element("p", "Parent A", 1),
    bodyA = element(tag, "", 2), child = element("li", "Child A", 2), sibling = element("li", "alpha sibling", 4), bodyChild = element(tag, "", 3), grand = element("li", "alpha grand ^deep", 3),
    bodyB = element(tag, "", 6), independent = element("li", "alpha independent", 6), outside = element("p", "Outside alpha.", 8), plugin = element("span", "plugin child"), math = element("span", "formula");
  task.type = "checkbox"; task.disabled = true; task.checked = false;
  p.append(task); a.append(p, bodyA); bodyA.append(child, sibling); child.append(bodyChild); bodyChild.append(grand); grand.append(plugin, math);
  b.append(bodyB); bodyB.append(independent); list.append(a, b); section.append(title, list, outside);
  const metadata = model.parseMarkdown(text).listItems;
  let current = true, changed = 0;
  const inventory = () => model.captureReadingListFolds(section, text, metadata);
  const mount = (data = inventory(), options = {}) => new model.ReadingListFolding(root, section, data, () => current, () => changed++, options);
  const control = li => li.children.find(child => child.dataset.readingListFoldToggle !== undefined);
  const hidden = () => [bodyA, bodyChild, bodyB].filter(node => node.hasAttribute("hidden")).map(node => Number(node.dataset.sourceLine));
  return { root, section, title, list, a, b, task, p, bodyA, child, sibling, bodyChild, grand, bodyB, independent, outside, plugin, math, text, metadata, inventory, mount, control, hidden, observers, element, document,
    invalidate() { current = false; }, changes: () => changed };
}

test("original nested bullet and ordered lists acquire accessible item controls; leaves and continuation text do not", () => {
  for (const ordered of [false, true]) {
    const f = fixture(ordered), data = f.inventory(); assert.equal(data.message, null); assert.equal(data.items.length, 6); assert.equal(data.lists.length, 4);
    const controller = f.mount(data); assert.equal(controller.isDisposed, false);
    assert.equal(f.control(f.a).tagName, "BUTTON"); assert.equal(f.control(f.a).type, "button"); assert.equal(f.control(f.a).getAttribute("aria-expanded"), "true");
    assert.equal(f.control(f.a).getAttribute("aria-label"), "Collapse list item Parent A"); assert.equal(f.control(f.a).dataset.readingListFoldToggle, "1");
    assert.equal(f.control(f.grand), undefined); assert.equal(f.control(f.sibling), undefined); assert.equal(f.control(f.independent), undefined);
    assert.equal(f.p.hasAttribute("hidden"), false); controller.dispose();
  }
});

test("restored nested list choices retain original bodies and temporary navigation never changes persistent intent", () => {
  const f = fixture(), writes = [], children = [...f.a.children], c = f.mount(f.inventory(), {
    initialCollapsed: [5, 2, 1, 3, 999], onUserChange: lines => writes.push([...lines]),
  });
  assert.deepEqual(c.snapshot(), [1, 2, 5]); assert.deepEqual(f.hidden(), [2, 3, 6]); assert.deepEqual(writes, []);
  assert.deepEqual(f.a.children.filter(node => node !== f.control(f.a)), children); assert.equal(f.task.parentElement, f.p);
  c.reveal(f.plugin); assert.deepEqual(f.hidden(), [6]); assert.deepEqual(c.snapshot(), [1, 2, 5]); assert.deepEqual(writes, []);
  f.control(f.a).click(); f.control(f.a).click(); assert.deepEqual(writes, [[1, 2, 5], [2, 5]]);
  c.dispose(); assert.equal(writes.length, 2); assert.deepEqual(f.hidden(), []);
});

test("malformed list preferences and profile write failure leave source/task nodes and controls intact", () => {
  for (const initialCollapsed of [[1, 1], [1, "2"], [1, -1], [1, NaN], { lists: [1] }]) {
    const f = fixture(), c = f.mount(f.inventory(), { initialCollapsed }); assert.deepEqual(c.snapshot(), []); assert.deepEqual(f.hidden(), []); c.dispose();
  }
  const f = fixture(), c = f.mount(f.inventory(), { onUserChange() { throw Error("quota"); } });
  assert.doesNotThrow(() => f.control(f.a).click()); assert.deepEqual(f.hidden(), [2]); assert.deepEqual(c.snapshot(), [1]);
  assert.doesNotThrow(() => f.control(f.a).click()); assert.deepEqual(f.hidden(), []); assert.equal(f.task.checked, false); c.dispose();
});

test("duplicate list panes preserve local choices and only explicit current-owner activation writes", () => {
  let saved = [1], writes = 0;
  const a = fixture(), b = fixture(), options = () => ({ initialCollapsed: saved, onUserChange: lines => { saved = [...lines]; writes++; } });
  const first = a.mount(a.inventory(), options()), second = b.mount(b.inventory(), options());
  a.control(a.a).click(); assert.deepEqual(saved, []); assert.equal(b.control(b.a).getAttribute("aria-expanded"), "false");
  b.control(b.b).click(); assert.deepEqual(saved, [1, 5]); assert.equal(a.control(a.b).getAttribute("aria-expanded"), "true");
  const held = a.control(a.child); a.invalidate(); held.click(); assert.equal(first.isDisposed, true); assert.equal(writes, 2);
  second.reveal(b.independent); second.dispose(); assert.deepEqual(saved, [1, 5]); assert.equal(writes, 2);
});

test("nested and disjoint body folds keep their child choices and only hide original direct list containers", () => {
  const f = fixture(), c = f.mount(); f.control(f.child).click(); assert.deepEqual(f.hidden(), [3]);
  f.control(f.a).click(); assert.deepEqual(f.hidden(), [2, 3]); f.control(f.b).click(); assert.deepEqual(f.hidden(), [2, 3, 6]);
  f.control(f.a).click(); assert.deepEqual(f.hidden(), [3, 6]); assert.equal(f.control(f.child).getAttribute("aria-expanded"), "false");
  assert.equal(f.p.hasAttribute("hidden"), false); assert.equal(f.a.hasAttribute("hidden"), false); assert.equal(f.outside.hasAttribute("hidden"), false);
  f.control(f.child).click(); f.control(f.b).click(); assert.deepEqual(f.hidden(), []); assert.equal(f.changes(), 6); c.dispose();
});

test("folds preserve original list/task/code/math/plugin identities and listeners without wrapping or source edits", () => {
  const f = fixture(), rootChildren = [...f.section.children], aChildren = [...f.a.children], nestedChildren = [...f.grand.children], c = f.mount();
  let clicks = 0; f.plugin.addEventListener("click", () => clicks++); f.control(f.a).click(); f.control(f.a).click(); f.plugin.click();
  assert.equal(clicks, 1); assert.equal(f.task.parentElement, f.p); assert.equal(f.task.disabled, true); assert.equal(f.task.checked, false);
  assert.deepEqual(f.section.children, rootChildren); assert.deepEqual(f.a.children.filter(node => node !== f.control(f.a)), aChildren); assert.deepEqual(f.grand.children, nestedChildren);
  assert.equal(f.text.includes("- [ ] Parent A\r\n"), true); c.dispose(); assert.deepEqual(f.a.children, aChildren); assert.deepEqual(f.hidden(), []);
});

test("navigation expands only owning list bodies and leaves a target item's own collapsed descendants intact", () => {
  const f = fixture(), c = f.mount(); f.control(f.child).click(); f.control(f.a).click(); f.control(f.b).click();
  c.reveal(f.child); assert.deepEqual(f.hidden(), [3, 6]); assert.equal(f.control(f.child).getAttribute("aria-expanded"), "false");
  f.control(f.a).click(); c.reveal(f.plugin); assert.deepEqual(f.hidden(), [6]); assert.equal(f.control(f.a).getAttribute("aria-expanded"), "true");
  c.reveal(f.task); assert.deepEqual(f.hidden(), [6]); c.reveal(f.outside); assert.deepEqual(f.hidden(), [6]); c.dispose();
});

test("pre-existing hidden attributes and independent heading hidden state retain their original ownership", () => {
  const f = fixture(); f.bodyA.setAttribute("hidden", "until-found"); f.bodyChild.setAttribute("hidden", ""); f.list.setAttribute("hidden", "");
  const c = f.mount(); f.control(f.a).click(); f.control(f.child).click(); f.control(f.b).click();
  c.dispose(); assert.equal(f.bodyA.getAttribute("hidden"), "until-found"); assert.equal(f.bodyChild.getAttribute("hidden"), ""); assert.equal(f.bodyB.hasAttribute("hidden"), false); assert.equal(f.list.getAttribute("hidden"), "");
});

test("dispose and Fold lists-off cleanup unhide once, disconnect observers and leave held controls inert", () => {
  const f = fixture(), c = f.mount(), held = f.control(f.a); held.click(); assert.equal(f.changes(), 1); c.dispose(); c.dispose(); held.click();
  assert.deepEqual(f.hidden(), []); assert.equal(f.changes(), 2); assert.equal(f.observers[0].disconnected, true); assert.equal(held.parentElement, null); assert.equal(f.task.parentElement, f.p);
});

test("file/root/mode loss and original tree reordering/mapping/adoption retire held controls before hiding replacement content", () => {
  for (const mutate of [f => f.invalidate(), f => f.list.children.reverse(), f => { f.child.dataset.sourceLine = "4"; }, f => { f.bodyA.tagName = "DIV"; }, f => { f.root.ownerDocument = {}; }, f => f.bodyChild.remove()]) {
    const f = fixture(), c = f.mount(), held = f.control(f.a); held.click(); mutate(f); held.click(); assert.equal(c.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(held.parentElement, null);
  }
});

test("postprocessor removal/reordering of original items, body lists or original header children refuses installation", () => {
  for (const mutate of [f => f.list.prepend(f.b), f => f.bodyA.prepend(f.sibling), f => f.bodyA.remove(), f => f.p.remove(), f => { f.a.dataset.sourceLine = "5"; }]) {
    const f = fixture(), data = f.inventory(); mutate(f); const c = f.mount(data); assert.equal(c.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(f.control(f.a), undefined);
  }
});

test("top-level original list order is proved before installation independently of heading folds", () => {
  for (const afterCapture of [false, true]) {
    const f = fixture(), second = f.element("ul", "", 20), li = f.element("li", "Other", 20), nested = f.element("ul", "", 21), child = f.element("li", "Child", 21);
    nested.append(child); li.append(nested); second.append(li); f.section.append(second);
    const source = f.text + "\n".repeat(11) + "- Other\n  - Child\n", metadata = model.parseMarkdown(source).listItems;
    assert.equal(source.split(/\r?\n/)[20], "- Other");
    if (!afterCapture) f.section.prepend(second);
    const data = model.captureReadingListFolds(f.section, source, metadata);
    if (afterCapture) { assert.equal(data.message, null); f.section.prepend(second); const c = f.mount(data); assert.equal(c.isDisposed, true); }
    else assert.ok(data.message);
    assert.equal(f.control(f.a), undefined); assert.equal(f.control(li), undefined); assert.deepEqual(f.hidden(), []);
  }
  const f = fixture(), data = f.inventory(), injected = f.element("p", "plugin root sibling"); f.section.prepend(injected); const c = f.mount(data);
  assert.equal(c.isDisposed, false); f.control(f.a).click(); assert.equal(injected.hasAttribute("hidden"), false); c.dispose(); assert.equal(injected.parentElement, f.section);
});

test("removed or moved owned controls synchronously and asynchronously retire and restore collapsed bodies", () => {
  for (const mutate of [(f, held) => held.remove(), (f, held) => f.b.append(held)]) {
    const f = fixture(), c = f.mount(), held = f.control(f.a); held.click(); mutate(f, held);
    assert.ok(f.observers[0].observations.some(record => record.target === f.a && record.options.childList));
    f.observers[0].callback(); assert.equal(c.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.equal(held.parentElement, null);
  }
  const f = fixture(), c = f.mount(), held = f.control(f.b); f.control(f.a).click(); f.control(f.a).remove(); held.click(); assert.equal(c.isDisposed, true); assert.deepEqual(f.hidden(), []);
});

test("original task checkbox attributes and legitimate inline plugin adornments do not retire list folds", () => {
  const f = fixture(), c = f.mount(), adornment = f.element("span", "plugin badge"); f.control(f.a).click();
  f.task.disabled = false; f.task.checked = true; f.task.dataset.readingTaskLine = "1"; f.task.setAttribute("aria-label", "Toggle task"); f.a.append(adornment); f.observers[0].callback();
  assert.equal(c.isDisposed, false); assert.deepEqual(f.hidden(), [2]); assert.equal(f.task.parentElement, f.p); assert.equal(adornment.parentElement, f.a);
  for (const record of f.observers[0].observations) { assert.notEqual(record.options.subtree, true); assert.notEqual(record.target, f.task); if (record.options.attributes) assert.deepEqual(record.options.attributeFilter, ["data-source-line"]); }
  f.control(f.a).click(); assert.deepEqual(f.hidden(), []); c.dispose(); assert.equal(adornment.parentElement, f.a);
});

test("unbounded later plugin children retire folds without copying the new tree or deleting plugin nodes", () => {
  const f = fixture(), c = f.mount(); f.control(f.a).click();
  const additions = Array.from({ length: model.MAX_READING_LIST_FOLD_NODES }, () => f.element("span", "plugin decoration")); f.a.append(...additions);
  f.observers[0].callback(); assert.equal(c.isDisposed, true); assert.deepEqual(f.hidden(), []); assert.ok(additions.every(node => node.parentElement === f.a));
});

test("quoted/callout/embedded and unmapped raw lists remain outside the root inventory", () => {
  const f = fixture(), quote = f.element("blockquote"), quoteList = f.element("ul", "", 1), fake = f.element("li", "quoted", 1), raw = f.element("ul");
  quoteList.append(fake); quote.append(quoteList); f.section.append(quote, raw); const data = f.inventory(); assert.equal(data.message, null); assert.equal(data.items.length, 6);
  const c = f.mount(data); assert.equal(f.control(fake), undefined); assert.equal(raw.children.length, 0); f.control(f.a).click(); assert.equal(quote.hasAttribute("hidden"), false); c.dispose();
});

test("unsupported or ambiguous mappings, source parent identities and depth refuse the entire inventory", () => {
  for (const mutate of [f => { f.child.dataset.sourceLine = "4"; }, f => { f.metadata[1].parent = -1; }, f => { f.bodyA.dataset.sourceLine = "1"; }, f => f.list.append(f.element("span", "unsupported"))]) {
    const f = fixture(); mutate(f); const data = f.inventory(); assert.ok(data.message); assert.deepEqual(data.items, []); assert.deepEqual(data.lists, []);
  }
  const f = fixture(); f.metadata.push({ ...f.metadata[0] }); assert.match(f.inventory().message, /ambiguous/);
});

test("source/metadata/line/label/DOM allowances refuse before unsafe copies or enumeration", () => {
  const inaccessible = { get childElementCount() { throw Error("must not inspect DOM"); } };
  assert.match(model.captureReadingListFolds(inaccessible, "x".repeat(model.MAX_READING_LIST_FOLD_SOURCE + 1), []).message, /limits/);
  const metadata = { length: model.MAX_READING_LIST_FOLD_ITEMS + 1, [Symbol.iterator]() { throw Error("must not enumerate metadata"); } };
  assert.match(model.captureReadingListFolds(inaccessible, "", metadata).message, /limits/);
  const nodes = { childElementCount: model.MAX_READING_LIST_FOLD_BLOCKS + 1, get children() { throw Error("must not enumerate DOM"); } };
  assert.match(model.captureReadingListFolds(nodes, "", []).message, /limits/);
  assert.match(model.captureReadingListFolds({ childElementCount: 0 }, "\n".repeat(model.MAX_READING_LIST_FOLD_LINES), []).message, /limits/);
  const long = "- " + "x".repeat(model.MAX_READING_LIST_FOLD_LABEL), item = { position: { start: { line: 0, offset: 0 }, end: { line: 0, offset: long.length } }, parent: -1 };
  assert.match(model.captureReadingListFolds({ childElementCount: 0, get children() { throw Error("must not inspect DOM children"); } }, long, [item]).message, /limits/);
  const labels = Array.from({ length: 66 }, () => "- " + "x".repeat(1_020)), source = labels.join("\n"), offsets = []; let at = 0;
  for (const label of labels) { offsets.push(at); at += label.length + 1; }
  const many = labels.map((label, line) => ({ position: { start: { line, offset: offsets[line] }, end: { line, offset: offsets[line] + label.length } }, parent: -1 }));
  assert.match(model.captureReadingListFolds({ childElementCount: 0, get children() { throw Error("must not inspect DOM after aggregate label limit"); } }, source, many).message, /limits/);
  const f = fixture(); Object.defineProperty(f.a, "childElementCount", { get() { return model.MAX_READING_LIST_FOLD_NODES + 1; } });
  Object.defineProperty(f.a, "children", { get() { throw Error("must not copy too many child elements"); } }); assert.ok(f.inventory().message);
});

test("the exact nested-list depth allowance accepts its boundary and refuses deeper real Markdown before controls exist", () => {
  for (const depth of [model.MAX_READING_LIST_FOLD_DEPTH, model.MAX_READING_LIST_FOLD_DEPTH + 1]) {
    const f = fixture(), source = Array.from({ length: depth }, (_, line) => "  ".repeat(line) + "- Item " + line).join("\n"), metadata = model.parseMarkdown(source).listItems;
    f.section.children.splice(0); const first = f.element("ul", "", 0); f.section.append(first); let list = first;
    for (let line = 0; line < depth; line++) { const li = f.element("li", "Item " + line, line); list.append(li); if (line + 1 < depth) { list = f.element("ul", "", line + 1); li.append(list); } }
    const data = model.captureReadingListFolds(f.section, source, metadata);
    assert.equal(data.message === null, depth === model.MAX_READING_LIST_FOLD_DEPTH);
    if (data.message) { assert.deepEqual(data.items, []); assert.deepEqual(data.lists, []); }
  }
});
