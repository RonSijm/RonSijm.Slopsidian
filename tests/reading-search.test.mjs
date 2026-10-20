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
  directory = await mkdtemp(join(root, ".runtime", "reading-search-tests-"));
  const output = join(directory, "reading-search.mjs");
  await build({ stdin: { contents: 'export * from "./client/reading-search"; export { registerEditorSearchCommands } from "./client/editor-search-commands";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [{ name: "command-view-token", setup(build) {
    build.onResolve({ filter: /^\.\/workspace$/ }, args => args.importer.endsWith("editor-search-commands.ts") ? { path: "view-token", namespace: "command-view" } : null);
    build.onLoad({ filter: /.*/, namespace: "command-view" }, () => ({ contents: "export class MarkdownView {}", loader: "js" }));
  } }] });
  feature = await import(pathToFileURL(output).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/reading-search-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

const options = { caseSensitive: false, wholeWord: false };
function matches(text, query, overrides = {}) { return feature.planReadingSearch(Array.isArray(text) ? text : [text], query, { ...options, ...overrides }); }

test("Reading literal matching retains original UTF-16 offsets and never interprets query syntax", () => {
  const text = "😀 Alpha [a.*] αλφα\r\n[a.*]";
  assert.deepEqual(matches(text, "[a.*]"), { message: null, matches: [{ section: 0, from: 9, to: 14 }, { section: 0, from: 21, to: 26 }] });
  assert.deepEqual(matches(text, "missing").matches, []);
  assert.equal(text, "😀 Alpha [a.*] αλφα\r\n[a.*]");
});

test("Unicode case matching preserves source offsets when lowercase conversion would change length", () => {
  const text = "İx Kelvin KELVIN 😀 Ωω";
  const result = matches(text, "kelvin");
  assert.deepEqual(result.matches.map(match => text.slice(match.from, match.to)), ["Kelvin", "KELVIN"]);
  assert.deepEqual(result.matches.map(match => match.from), [3, 10]);
  assert.equal(matches(text, "kelvin", { caseSensitive: true }).matches.length, 0);
  assert.deepEqual(matches(text, "ω").matches.map(match => text.slice(match.from, match.to)), ["Ω", "ω"]);
});

test("Reading whole words use Unicode letters, marks, numbers and underscores at both boundaries", () => {
  const text = "alpha alphabet αalpha alphaβ _alpha alpha_ 2alpha alpha2 alpha\u0301 (alpha)";
  assert.deepEqual(matches(text, "alpha", { wholeWord: true }).matches.map(match => text.slice(match.from, match.to)), ["alpha", "alpha"]);
  assert.equal(matches("λ λx xλ (λ)", "λ", { wholeWord: true }).matches.length, 2);
  assert.equal(matches("x[a]y [a]", "[a]", { wholeWord: true }).matches.length, 2, "punctuation edges do not invent word boundaries");
});

test("Reading matching never crosses an independently rendered block boundary", () => {
  assert.deepEqual(matches(["alpha", "beta"], "alphabeta").matches, []);
  assert.deepEqual(matches(["alpha beta", "alpha"], "alpha").matches, [{ section: 0, from: 0, to: 5 }, { section: 1, from: 0, to: 5 }]);
  assert.equal(matches(["alpha beta"], "alpha beta").matches.length, 1, "one block can contain multiple original inline nodes");
});

test("collapsed prose whitespace finds soft breaks/spaces with exact raw ranges while preformatted text remains literal", () => {
  const text = "α😀 alpha\r\n \t beta tail";
  const result = matches(text, "alpha beta");
  assert.equal(result.matches.length, 1);
  assert.equal(text.slice(result.matches[0].from, result.matches[0].to), "alpha\r\n \t beta");
  assert.equal(matches(text, "alpha   beta").matches.length, 1);
  assert.equal(matches([{ text, collapseWhitespace: false }], "alpha beta").matches.length, 0);
  assert.equal(matches([{ text, collapseWhitespace: false }], "alpha\r\n \t beta").matches.length, 1);
  assert.deepEqual(matches(" ".repeat(200_000), " X").matches, [], "whitespace-only text does not create a generated repeating regex");
});

test("Reading source, node, query and match limits refuse partial counts or ranges", () => {
  assert.match(matches("x".repeat(feature.MAX_READING_SEARCH_CHARACTERS + 1), "x").message, /exceeds/);
  assert.match(matches(Array(feature.MAX_READING_SEARCH_NODES + 1).fill("x"), "x").message, /exceeds/);
  assert.match(matches("x", "x".repeat(feature.MAX_READING_SEARCH_QUERY + 1)).message, /256/);
  const crowded = matches("x ".repeat(feature.MAX_READING_SEARCH_MATCHES + 1), "x");
  assert.match(crowded.message, /10,000/); assert.deepEqual(crowded.matches, []);
  assert.deepEqual(matches("x", ""), { matches: [], message: null });
});

test("bounded Reading regex is opt-in and supports classes, captures, dots and section-local multiline anchors", () => {
  const text = "alpha ALPHA a[l]pha";
  assert.equal(matches(text, "[a]lpha").matches.length, 0);
  assert.deepEqual(matches(text, "([a]lph.)", { regexp: true }).matches.map(match => text.slice(match.from, match.to)), ["alpha", "ALPHA"]);
  assert.equal(matches(text, "([a]lph.)", { regexp: true, caseSensitive: true }).matches.length, 1);
  assert.deepEqual(matches(["alpha", "beta"], "^alphabeta$", { regexp: true }).matches, []);
  assert.deepEqual(matches([{ text: "alpha\nbeta\nalpha", collapseWhitespace: false }], "^(alpha)$", { regexp: true }).matches, [
    { section: 0, from: 0, to: 5 }, { section: 0, from: 11, to: 16 }
  ]);
});

test("regex preserves Unicode/case/word boundaries and maps collapsed prose back to raw UTF-16 ranges", () => {
  const text = "😀 Kelvin KELVIN Ωω αalpha alphaβ alpha\u0301 (alpha)";
  assert.deepEqual(matches(text, "[k]elvin", { regexp: true }).matches.map(match => text.slice(match.from, match.to)), ["Kelvin", "KELVIN"]);
  assert.deepEqual(matches(text, "[a]lpha", { regexp: true, wholeWord: true }).matches.map(match => text.slice(match.from, match.to)), ["alpha"]);
  assert.deepEqual(matches("😀😀x", ".", { regexp: true }).matches, [{ section: 0, from: 0, to: 2 }, { section: 0, from: 2, to: 4 }, { section: 0, from: 4, to: 5 }]);
  const prose = "😀 alpha\r\n \t beta";
  const found = matches(prose, "(alpha)\\s(beta)", { regexp: true });
  assert.deepEqual(found.matches, [{ section: 0, from: 3, to: prose.length }]);
  assert.equal(prose.slice(found.matches[0].from, found.matches[0].to), "alpha\r\n \t beta");
  assert.equal(matches(prose, "alpha  beta", { regexp: true }).matches.length, 0, "pattern syntax itself is never whitespace-collapsed");
  assert.equal(matches([{ text: "alpha\n\tbeta", collapseWhitespace: false }], "alpha\\s\\sbeta", { regexp: true }).matches.length, 1);
  assert.equal(matches("alpha\n\tbeta", "alpha\\s\\sbeta", { regexp: true }).matches.length, 0);
  assert.equal(matches("alpha\nbeta", "^beta$", { regexp: true }).matches.length, 0, "soft prose breaks are normalized before multiline anchors run");
});

test("unsafe or unsupported Reading regex is rejected before regex construction or execution", () => {
  const Original = globalThis.RegExp; let constructed = 0;
  globalThis.RegExp = class extends Original { constructor(...args) { constructed++; super(...args); } };
  try {
    for (const query of ["(a+)+$", "a*", "a?", "a{2}", "a|b", "(?=a)", "(?<=a)", "(a)\\1", "\\p{L}", "\\u{1F600}", "x".repeat(257)]) {
      const result = matches("a".repeat(200_000), query, { regexp: true });
      assert.ok(result.message, query); assert.deepEqual(result.matches, []);
    }
    assert.equal(constructed, 0, "lexical validation refuses all branching/repetition before constructing a user pattern");
  } finally { globalThis.RegExp = Original; }
  for (const query of ["[", "(", "\\"]) assert.match(matches("alpha", query, { regexp: true }).message, /Invalid regular expression/);
});

test("empty regex matches terminate by Unicode point and are never counted or painted", () => {
  for (const query of ["^", "$", "\\b", "\\B", "()", "(())"]) {
    assert.deepEqual(matches("😀😀x alpha", query, { regexp: true }), { matches: [], message: null }, query);
  }
  const Original = globalThis.RegExp, positions = [];
  globalThis.RegExp = class extends Original {
    exec(text) { const result = super.exec(text); if (this.source === "()" && result) positions.push(result.index); return result; }
  };
  try { assert.deepEqual(matches("😀😀x", "()", { regexp: true }), { matches: [], message: null }); }
  finally { globalThis.RegExp = Original; }
  assert.deepEqual(positions, [0, 2, 4, 5], "empty global exec never retries or enters a surrogate pair");
  assert.deepEqual(matches("alpha", "()alpha()", { regexp: true }).matches, [{ section: 0, from: 0, to: 5 }]);
});

test("Reading regex caps refuse partial results and captured union gaps cannot become matching text", () => {
  const crowded = matches("x".repeat(feature.MAX_READING_SEARCH_MATCHES + 1), ".", { regexp: true });
  assert.match(crowded.message, /10,000/); assert.deepEqual(crowded.matches, []);
  assert.match(matches("x".repeat(feature.MAX_READING_SEARCH_CHARACTERS + 1), ".", { regexp: true }).message, /exceeds/);
  assert.match(matches(Array(feature.MAX_READING_SEARCH_NODES + 1).fill("x"), ".", { regexp: true }).message, /exceeds/);
  const scope = [{ from: 0, to: 11 }, { from: 22, to: 33 }], sections = ["alpha alpha", "alpha alpha", "alpha alpha"];
  const selected = feature.planReadingSearch(sections, "[a]lpha", { ...options, regexp: true }, scope);
  assert.deepEqual(selected.matches.map(match => match.section), [0, 0, 2, 2]);
  assert.equal(feature.planReadingSearch(["alpha MIDDLE beta"], "alphabeta", { ...options, regexp: true }, [{ from: 0, to: 5 }, { from: 13, to: 17 }]).matches.length, 0);
  assert.equal(feature.planReadingSearch(["x".repeat(10_001)], ".", { ...options, regexp: true }, [{ from: 0, to: 1 }]).matches.length, 1, "only matches wholly inside the union contribute to exhaustion");
});

test("snapshot guards reject changed, detached and disconnected DOM endpoints without altering them", () => {
  const first = { data: "α" }, second = { data: " beta" }, retained = new Set([first, second]);
  const root = { isConnected: true, contains(node) { return retained.has(node); } };
  const snapshot = { message: null, sections: [{ element: {}, text: "α beta", parts: [{ node: first, text: "α", from: 0, to: 1 }, { node: second, text: " beta", from: 1, to: 6 }] }] };
  assert.equal(feature.readingSnapshotCurrent(root, snapshot), true);
  second.data = " newer"; assert.equal(feature.readingSnapshotCurrent(root, snapshot), false);
  second.data = " beta"; retained.delete(first); assert.equal(feature.readingSnapshotCurrent(root, snapshot), false);
  retained.add(first); root.isConnected = false; assert.equal(feature.readingSnapshotCurrent(root, snapshot), false);
  assert.equal(second.data, " beta"); assert.equal(snapshot.sections[0].text, "α beta");
});

// Minimal DOM traversal fixture exercises the same SHOW_ELEMENT/SHOW_TEXT and
// subtree-pruning contract as browser TreeWalker; host tests use the real DOM.
function domFixture(children) {
  const text = value => ({ nodeType: 3, nodeValue: value, data: value, childNodes: [] });
  function element(tag, children = [], attributes = {}) {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), attributes, childNodes: children.map(child => typeof child === "string" ? text(child) : child),
      hasAttribute(key) { return Object.hasOwn(attributes, key); }, isSameNode(other) { return this === other; },
      get firstElementChild() { return this.childNodes.find(child => child.nodeType === 1) ?? null; },
      contains(node) { return this === node || this.childNodes.some(child => child.nodeType === 1 && child.contains(node) || child === node); },
      matches(selector) { return selector.split(",").some(choice => {
        if (choice.startsWith(".")) return (attributes.class ?? "").split(" ").includes(choice.slice(1));
        if (choice === "[hidden]") return this.hasAttribute("hidden");
        if (choice === "[aria-hidden=true]") return attributes["aria-hidden"] === "true";
        if (choice === "details:not([open])") return this.tagName === "DETAILS" && !this.hasAttribute("open");
        return this.tagName === choice.toUpperCase();
      }); }, closest(selector) { for (let value = this; value; value = value.parentElement) if (value.matches(selector)) return value; return null; } };
    for (const child of node.childNodes) child.parentElement = node;
    return node;
  }
  const root = element("div", children(element), { class: "markdown-preview-view" });
  let visited = 0;
  root.ownerDocument = { defaultView: { getComputedStyle(node) { return node.attributes.style ?? {}; } }, createTreeWalker(root, mask, filter) {
    assert.equal(mask, 5);
    const stack = [...root.childNodes].reverse();
    return { nextNode() { while (stack.length) { const node = stack.pop(); visited++; const accepted = filter.acceptNode(node); if (accepted !== 2) stack.push(...node.childNodes.slice().reverse()); if (accepted === 1) return node; } return null; } };
  } };
  return { root, element, text, visited: () => visited };
}

test("selection normalization orders disjoint passages, merges overlaps and never includes their gap", () => {
  const raw = [{ from: 20, to: 30 }, { from: 1, to: 8 }, { from: 4, to: 10 }, { from: 10, to: 12 }, { from: 15, to: 15 }];
  assert.deepEqual(feature.normalizeReadingSelection(raw, 40), { ranges: [{ from: 1, to: 12 }, { from: 20, to: 30 }], message: null });
  assert.deepEqual(raw[1], { from: 1, to: 8 }, "normalization does not mutate a retained candidate");
  for (const ranges of [[{ from: -1, to: 2 }], [{ from: 3, to: 2 }], [{ from: 0, to: 201 }], [{ from: .5, to: 2 }], Array.from({ length: 65 }, (_, i) => ({ from: i * 2, to: i * 2 + 1 }))]) {
    assert.ok(feature.normalizeReadingSelection(ranges, 200).message); assert.deepEqual(feature.normalizeReadingSelection(ranges, 200).ranges, []);
  }
  assert.match(feature.normalizeReadingSelection([{ from: 0, to: 262145 }], 262145).message, /262,144/);
  assert.equal(feature.normalizeReadingSelection([...Array.from({ length: 64 }, (_, i) => ({ from: i * 2, to: i * 2 + 1 })), { from: 0, to: 1 }], 200).ranges.length, 64, "adding an overlap at the union limit does not invent another passage");
});

test("Reading selected passages filter counts before match limits and never bridge a gap or block", () => {
  const sections = ["alpha alpha", "alpha alpha", "alpha alpha"], scope = [{ from: 0, to: 11 }, { from: 22, to: 33 }];
  const result = feature.planReadingSearch(sections, "alpha", options, scope);
  assert.deepEqual(result.matches, [{ section: 0, from: 0, to: 5 }, { section: 0, from: 6, to: 11 }, { section: 2, from: 0, to: 5 }, { section: 2, from: 6, to: 11 }]);
  assert.deepEqual(feature.planReadingSearch(["alpha beta"], "alpha beta", options, [{ from: 0, to: 5 }, { from: 6, to: 10 }]).matches, []);
  assert.deepEqual(feature.planReadingSearch(["alpha", "beta"], "alphabeta", options, [{ from: 0, to: 9 }]).matches, []);
  assert.deepEqual(feature.planReadingSearch(sections, "alpha", options, []).matches, []);
  const many = "x ".repeat(10001); assert.equal(feature.planReadingSearch([many], "x", options, [{ from: 0, to: 1 }]).matches.length, 1, "outside matches cannot exhaust the scoped result budget");
});

test("selected passages retain raw whitespace/Unicode offsets and whole-word context outside the capture", () => {
  const text = "😀 alpha\r\n \t beta alphaβ (alpha)", start = text.indexOf("alpha"), end = text.indexOf(" alphaβ");
  const result = feature.planReadingSearch([text], "alpha beta", options, [{ from: start, to: end }]);
  assert.equal(result.matches.length, 1); assert.equal(text.slice(result.matches[0].from, result.matches[0].to), "alpha\r\n \t beta");
  assert.equal(feature.planReadingSearch([text], "alpha beta", options, [{ from: start, to: end - 1 }]).matches.length, 0);
  assert.equal(feature.planReadingSearch(["alphaβ"], "alpha", { ...options, wholeWord: true }, [{ from: 0, to: 5 }]).matches.length, 0);
  assert.equal(feature.planReadingSearch(["Ω ω"], "ω", options, [{ from: 0, to: 1 }]).matches[0].to, 1);
});

function selectionFixture() {
  const f = domFixture(e => [e("p", ["alpha ", e("strong", ["alpha"])]), e("p", ["alpha alpha"]), e("p", ["alpha alpha"])]), textNodes = [];
  const collect = node => { if (node.nodeType === 3) textNodes.push(node); else for (const child of node.childNodes) collect(child); }; collect(f.root);
  const contains = node => { for (let value = node; value; value = value.parentElement) if (value === f.root) return true; return false; };
  f.root.isConnected = true; f.root.contains = contains;
  const range = (start, from, end = start, to = start.data.length) => ({ startContainer: start, startOffset: from, endContainer: end, endOffset: to, collapsed: start === end && from === to,
    intersectsNode(node) { return textNodes.indexOf(node) >= textNodes.indexOf(start) && textNodes.indexOf(node) <= textNodes.indexOf(end); } });
  const select = (...ranges) => ({ rangeCount: ranges.length, getRangeAt(index) { return ranges[index]; } });
  return { ...f, textNodes, range, select, snapshot: feature.readingTextSnapshot(f.root) };
}

test("native selection capture maps inline text and disjoint visible ranges without changing DOM or source", () => {
  const f = selectionFixture(), [a, b, , d] = f.textNodes;
  assert.deepEqual(feature.captureReadingSelection(f.root, f.snapshot, f.select(f.range(a, 2, b, 5), f.range(d, 0))), { message: null, ranges: [{ from: 2, to: 11 }, { from: 22, to: 33 }] });
  assert.equal(a.data, "alpha "); assert.equal(b.data, "alpha");
  assert.deepEqual(feature.captureReadingSelection(f.root, f.snapshot, f.select(f.range(a, 2, a, 2))).ranges, []);
  assert.deepEqual(feature.captureReadingSelection(f.root, f.snapshot, null).ranges, []);
});

test("selection capture refuses foreign endpoints, stale snapshots and oversized native selection sets", () => {
  const f = selectionFixture(), a = f.textNodes[0], foreign = { data: "foreign" };
  assert.deepEqual(feature.captureReadingSelection(f.root, f.snapshot, f.select(f.range(a, 0, foreign, 3))).ranges, []);
  assert.match(feature.captureReadingSelection(f.root, f.snapshot, f.select(...Array(65).fill(f.range(a, 0)))).message, /64/);
  a.data = "changed"; assert.match(feature.captureReadingSelection(f.root, f.snapshot, f.select(f.range(a, 0))).message, /changed/);
  assert.deepEqual(f.snapshot.sections.map(section => section.text), ["alpha alpha", "alpha alpha", "alpha alpha"]);
});

// This fixture constructs the actual ReadingSearch and its handlers. Native host
// scenarios separately exercise real DOM Range geometry, selection and CSS paint.
function readingSearchFixture({ highlighting = true, hidden = false } = {}) {
  const f = domFixture(e => [e("p", ["alpha ", e("strong", ["alpha"])]), e("p", ["alpha alpha"]), e("p", ["alpha alpha"]), ...(hidden ? [e("span", ["hidden"], { hidden: "" })] : [])]), document = f.root.ownerDocument;
  const listeners = target => {
    target.listeners = new Map(); target.addEventListener = (type, callback) => target.listeners.set(type, [...(target.listeners.get(type) ?? []), callback]);
    target.removeEventListener = (type, callback) => target.listeners.set(type, (target.listeners.get(type) ?? []).filter(value => value !== callback));
    target.emit = (type, fields = {}) => { const event = { type, target, preventDefault() {}, stopPropagation() {}, ...fields }; for (const callback of [...(target.listeners.get(type) ?? [])]) callback(event); };
    return target;
  };
  listeners(document); document.activeElement = null;
  const rect = { top: 0, left: 0, right: 640, bottom: 300, height: 300, width: 640 };
  const decorate = node => {
    node.ownerDocument = document;
    if (node.nodeType === 3) { Object.defineProperty(node, "nodeValue", { get() { return this.data; } }); return node; }
    listeners(node); node.dataset = {}; node.style = {}; node.value = ""; node.checked = false; node.disabled = false;
    node.contains = value => { for (; value; value = value.parentElement) if (value === node) return true; return false; };
    node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
    node.append = (...children) => { for (const child of children) { node.childNodes.push(child); child.parentElement = node; } };
    node.insertBefore = (child, before) => { node.childNodes.splice(node.childNodes.indexOf(before), 0, child); child.parentElement = node; };
    node.remove = () => { const parent = node.parentElement; if (parent) parent.childNodes.splice(parent.childNodes.indexOf(node), 1); node.parentElement = null; node.detached = true; };
    node.focus = () => { document.activeElement = node; }; node.select = () => {}; node.click = () => node.emit("click");
    node.getBoundingClientRect = () => rect; node.clientHeight = 0; node.clientWidth = 0;
    Object.defineProperty(node, "isConnected", { get() { return !node.detached && (node === host || Boolean(node.parentElement?.isConnected)); } });
    for (const child of node.childNodes) decorate(child);
    return node;
  };
  let host; host = decorate(f.element("div")); decorate(f.root); host.append(f.root);
  document.createElement = tag => decorate(f.element(tag)); document.createTextNode = text => decorate(f.text(text));
  const textNodes = () => { const all = []; const visit = node => { if (node.nodeType === 3) all.push(node); else for (const child of node.childNodes) visit(child); }; visit(f.root); return all; };
  class NativeRange {
    startContainer = f.root; endContainer = f.root; startOffset = 0; endOffset = 0;
    get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; }
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
    intersectsNode(node) { const nodes = textNodes(), a = nodes.indexOf(this.startContainer), b = nodes.indexOf(this.endContainer), p = nodes.indexOf(node); return p >= a && p <= b; }
    cloneRange() { return Object.assign(new NativeRange(), this); }
    getClientRects() { return [rect]; } getBoundingClientRect() { return rect; }
    toString() { const nodes = textNodes(), a = nodes.indexOf(this.startContainer), b = nodes.indexOf(this.endContainer); return a < 0 || b < 0 ? "" : nodes.slice(a, b + 1).map((node, i, list) => node.data.slice(i ? 0 : this.startOffset, i === list.length - 1 ? this.endOffset : undefined)).join(""); }
  }
  document.createRange = () => new NativeRange();
  let nativeRanges = [];
  const selection = { get rangeCount() { return nativeRanges.length; }, get anchorNode() { return nativeRanges[0]?.startContainer; }, get focusNode() { return nativeRanges.at(-1)?.endContainer; }, getRangeAt(index) { return nativeRanges[index]; },
    removeAllRanges() { nativeRanges = []; }, addRange(range) { nativeRanges.push(range); }, toString() { return nativeRanges.map(range => range.toString()).join(""); } };
  document.getSelection = () => selection;
  const frames = new Map(), observers = [];
  document.defaultView = { ...document.defaultView, KeyboardEvent: class {}, requestAnimationFrame(callback) { frames.set(frames.size + 1, callback); return frames.size; }, cancelAnimationFrame(id) { frames.delete(id); },
    MutationObserver: class { constructor(callback) { this.callback = callback; this.records = []; this.disconnected = false; observers.push(this); } observe() {} takeRecords() { return this.records.splice(0); } disconnect() { this.disconnected = true; } },
    ...(highlighting ? { CSS: { highlights: new Map() }, Highlight: class extends Array {} } : {}) };
  const select = (first, from, last = first, to = textNodes()[last].data.length) => { const nodes = textNodes(), range = new NativeRange(); range.setStart(nodes[first], from); range.setEnd(nodes[last], to); nativeRanges = [range]; document.emit("selectionchange"); };
  select(0, 0, 1, 5);
  let current = true, closed = 0;
  const search = new feature.ReadingSearch(f.root, host, () => current, () => closed++), query = search.dom.childNodes[0].childNodes[0], options = search.dom.childNodes[1];
  const check = options.childNodes[3].childNodes[0], regexp = options.childNodes[2].childNodes[0], use = search.dom.childNodes[2].childNodes[0], add = search.dom.childNodes[2].childNodes[1];
  return { ...f, document, textNodes, search, query, check, regexp, use, add, observers, frames, select, get closed() { return closed; }, invalidate() { current = false; },
    input(value) { query.value = value; query.emit("input"); }, toggle(checked) { check.checked = checked; check.emit("change"); }, regex(checked) { regexp.checked = checked; regexp.emit("change"); }, count() { return Number(search.dom.dataset.readingSearchCount); }, status() { return options.childNodes[4].textContent; } };
}

test("actual Reading controls capture two passages, retain the query/scope during navigation and close without source changes", () => {
  const f = readingSearchFixture();
  assert.equal(f.query.value, "alpha alpha"); f.search.focus(); f.input("alpha"); f.toggle(true); assert.equal(f.count(), 2);
  f.select(3, 0); f.add.click(); assert.equal(f.count(), 4); assert.match(f.status(), /in selection \(2 ranges\)/);
  const scope = f.search.dom.dataset.readingSearchSelectionRanges; f.search.next(); f.search.previous(); f.input("ALPHA");
  assert.equal(f.count(), 4); assert.equal(f.search.dom.dataset.readingSearchSelectionRanges, scope); assert.match(f.status(), /in selection/);
  assert.deepEqual(f.textNodes().map(node => node.data), ["alpha ", "alpha", "alpha alpha", "alpha alpha"]);
  f.search.close(); f.add.click(); assert.equal(f.closed, 1); assert.equal(f.search.dom.isConnected, false); assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.document.listeners.get("selectionchange").length, 0); assert.equal(f.document.defaultView.CSS.highlights.size, 0);
});

test("actual regex toggle retains selected passages and replaces stale paint after invalid or empty queries", () => {
  const f = readingSearchFixture(), highlights = f.document.defaultView.CSS.highlights;
  assert.equal(f.regexp.checked, false);
  assert.match(f.regexp.parentElement.title, /Fixed-width.*Prose whitespace is collapsed.*Only nonempty matches/);
  f.input("[a]lpha"); assert.equal(f.count(), 0);
  f.regex(true); assert.equal(f.count(), 6); assert.equal(highlights.get("slopsidian-reading-search").length, 6);
  f.toggle(true); f.select(3, 0); f.add.click(); assert.equal(f.count(), 4);
  const scope = f.search.dom.dataset.readingSearchSelectionRanges;
  f.input("(a+)+$"); assert.equal(f.count(), 0); assert.equal(f.query.attributes["aria-invalid"], "true");
  assert.match(f.status(), /Fixed-width regex/); assert.equal(highlights.size, 0); assert.equal(f.search.next(), false);
  assert.equal(f.search.dom.dataset.readingSearchSelectionRanges, scope);
  f.regex(false); assert.equal(f.query.attributes["aria-invalid"], "false"); assert.equal(f.count(), 0);
  f.regex(true); f.input("[a]lpha"); assert.equal(f.count(), 4);
  f.input("()"); assert.equal(f.count(), 0); assert.equal(f.query.attributes["aria-invalid"], "false"); assert.equal(highlights.size, 0);
  f.input("^(alpha) [a]lpha$"); assert.equal(f.count(), 2); assert.match(f.status(), /2 ranges/);
  assert.deepEqual(f.textNodes().map(node => node.data), ["alpha ", "alpha", "alpha alpha", "alpha alpha"]);
  f.search.close(); assert.equal(highlights.size, 0);
});

test("regex navigation honors composing Enter and Escape and held controls cannot revive an obsolete owner", () => {
  const f = readingSearchFixture(); f.input("[a]lpha"); f.regex(true); f.toggle(true); f.select(3, 0); f.add.click();
  const active = f.search.dom.dataset.readingSearchActive;
  f.search.dom.emit("keydown", { key: "Enter", target: f.query, isComposing: true }); assert.equal(f.search.dom.dataset.readingSearchActive, active);
  f.search.dom.emit("keydown", { key: "Enter", target: f.query }); assert.equal(f.search.dom.dataset.readingSearchActive, "2");
  f.search.dom.emit("keydown", { key: "Enter", target: f.query, shiftKey: true }); assert.equal(f.search.dom.dataset.readingSearchActive, active);
  f.search.dom.emit("keydown", { key: "Escape", target: f.query, isComposing: true }); assert.equal(f.closed, 0);
  f.search.dom.emit("keydown", { key: "Escape", target: f.query }); assert.equal(f.closed, 1);
  f.regex(false); f.input("alpha"); assert.equal(f.document.defaultView.CSS.highlights.size, 0); assert.equal(f.closed, 1);
  for (const change of [fixture => fixture.invalidate(), fixture => { fixture.root.ownerDocument = {}; }]) {
    const stale = readingSearchFixture(); stale.regex(true); stale.input("[a]lpha"); assert.equal(stale.count(), 6);
    change(stale); stale.regex(false);
    assert.equal(stale.closed, 1); assert.equal(stale.document.defaultView.CSS.highlights.size, 0); assert.equal(stale.document.listeners.get("selectionchange").length, 0);
  }
  const fresh = readingSearchFixture(); assert.equal(fresh.regexp.checked, false); assert.equal(fresh.check.checked, false); fresh.search.close();
});

test("a changed Reading snapshot invalidates its captured union until explicit recapture or disabling the restriction", () => {
  const f = readingSearchFixture(); f.input("alpha"); f.toggle(true); f.select(3, 0); f.add.click(); assert.equal(f.count(), 4);
  f.textNodes()[0].data = "omega "; assert.equal(f.search.next(), false); assert.equal(f.count(), 0); assert.match(f.status(), /Selected Reading content changed/); assert.equal(f.search.dom.dataset.readingSearchScope, "stale");
  assert.equal(f.use.disabled, true); f.toggle(false); assert.equal(f.count(), 5);
  f.select(3, 0); f.use.click(); assert.equal(f.count(), 2); assert.equal(f.search.dom.dataset.readingSearchSelectionRanges, "1");
  f.search.close();
});

test("fold visibility refreshes regex paint synchronously and invalidates captured passages without scrolling", () => {
  const f = readingSearchFixture(); f.input("[a]lpha"); f.regex(true); assert.equal(f.count(), 6);
  const first = f.root.childNodes[0], second = f.root.childNodes[1];
  let measurements = 0; const originalRect = first.getBoundingClientRect;
  const noReveal = () => { measurements++; throw Error("fold refresh must not reveal a range"); };
  first.getBoundingClientRect = second.getBoundingClientRect = noReveal;
  first.attributes.hidden = ""; f.search.visibilityChanged();
  assert.equal(f.count(), 4); assert.equal(f.document.defaultView.CSS.highlights.get("slopsidian-reading-search").length, 4);
  assert.equal(f.query.value, "[a]lpha"); assert.equal(f.regexp.checked, true); assert.equal(measurements, 0); assert.equal(f.frames.size, 0);
  delete first.attributes.hidden; f.search.visibilityChanged(); assert.equal(f.count(), 6);
  first.getBoundingClientRect = second.getBoundingClientRect = originalRect;
  f.toggle(true); assert.equal(f.count(), 0); assert.match(f.status(), /Select visible text|Selected Reading content changed/);
  f.select(2, 0); f.use.click(); assert.equal(f.count(), 2);
  first.getBoundingClientRect = second.getBoundingClientRect = noReveal;
  second.attributes.hidden = ""; f.search.visibilityChanged(); assert.equal(f.count(), 0); assert.equal(f.search.dom.dataset.readingSearchScope, "stale");
  assert.equal(f.document.defaultView.CSS.highlights.size, 0); assert.equal(f.query.value, "[a]lpha"); assert.equal(f.regexp.checked, true); assert.equal(measurements, 0);
  f.search.close(); f.search.visibilityChanged(); assert.equal(f.closed, 1);
});

test("fallback native navigation cannot recapture its own selected match as the next user passage", () => {
  const f = readingSearchFixture({ highlighting: false }); f.input("alpha"); f.toggle(true); f.select(3, 0);
  assert.equal(f.search.next(), true); f.document.emit("selectionchange"); f.add.click();
  assert.equal(f.count(), 4, "Add still uses the real prior passage rather than the navigation fallback match"); assert.match(f.status(), /2 ranges/);
  f.search.close();
});

test("a foreign nonempty selection revokes an old capture candidate even while the query retains focus", () => {
  const f = readingSearchFixture(); f.search.focus(); f.input("alpha"); assert.equal(f.use.disabled, false);
  const foreign = f.document.createTextNode("foreign"), range = f.document.createRange(); range.setStart(foreign, 0); range.setEnd(foreign, 4);
  const selection = f.document.getSelection(); selection.removeAllRanges(); selection.addRange(range); f.document.emit("selectionchange");
  assert.equal(f.use.disabled, true); assert.equal(f.add.disabled, true);
  f.select(3, 0); f.use.click(); assert.equal(f.count(), 2); f.search.close();
});

test("selecting excluded Reading content cannot reuse a prior visible passage while the query is focused", () => {
  const f = readingSearchFixture({ hidden: true }); f.search.focus(); f.input("alpha"); assert.equal(f.use.disabled, false);
  f.select(4, 0); assert.equal(f.use.disabled, true); assert.equal(f.add.disabled, true);
  f.select(3, 0); f.use.click(); assert.equal(f.count(), 2); f.search.close();
});

test("held selection controls cannot revive paint or capture after an owner change or document adoption", () => {
  for (const change of [f => f.invalidate(), f => { f.root.ownerDocument = {}; }]) {
    const f = readingSearchFixture(); f.input("alpha"); f.toggle(true); const previous = f.document.defaultView.CSS.highlights.size; assert.ok(previous > 0);
    change(f); f.add.click(); assert.equal(f.closed, 1); assert.equal(f.search.dom.isConnected, false); assert.equal(f.document.defaultView.CSS.highlights.size, 0); assert.equal(f.document.listeners.get("selectionchange").length, 0);
  }
});

test("an adopted renderer cannot queue a foreign-window frame or cancel an unrelated original-window frame", () => {
  const f = readingSearchFixture(); f.input("alpha"); f.toggle(true);
  const unrelated = () => {}; f.frames.set(77, unrelated); const foreignFrames = new Map();
  f.root.ownerDocument = { defaultView: { requestAnimationFrame(callback) { foreignFrames.set(77, callback); return 77; }, cancelAnimationFrame(id) { foreignFrames.delete(id); } } };
  f.observers[0].callback([{ type: "characterData" }]); f.add.click();
  assert.equal(f.closed, 1); assert.equal(f.frames.get(77), unrelated); assert.equal(foreignFrames.size, 0);
  assert.equal(f.document.defaultView.CSS.highlights.size, 0); assert.equal(f.observers[0].disconnected, true);
});

test("actual snapshot planning separates hard breaks and visible omitted widgets but retains normal inline text", () => {
  for (const boundary of [e => e("br"), e => e("img"), e => e("button", ["unsearched"]), e => e("span", ["formula"], { class: "math-inline" }), e => e("svg", ["diagram"])]) {
    const f = domFixture(e => [e("p", ["alpha", boundary(e), "beta"])]), snapshot = feature.readingTextSnapshot(f.root);
    assert.deepEqual(snapshot.sections.map(section => section.text), ["alpha", "beta"]);
    assert.equal(matches(snapshot.sections.map(section => section.text), "alphabeta").matches.length, 0);
  }
  const inline = domFixture(e => [e("p", ["alpha", e("strong", ["beta"]), e("span", ["private"], { hidden: "" }), "gamma"])]);
  assert.deepEqual(feature.readingTextSnapshot(inline.root).sections.map(section => section.text), ["alphabetagamma"]);
  const nested = domFixture(e => [e("p", ["alpha", e("div", ["embedded"], { class: "markdown-preview-view" }), "beta"])]);
  assert.deepEqual(feature.readingTextSnapshot(nested.root).sections.map(section => section.text), ["alpha", "beta"]);
});

test("closed captured callouts opt into Find without exposing ordinary details or bypassing any closed outer owner", () => {
  const f = domFixture(e => [e("details", [e("summary", ["Outer title"]), e("div", ["Outer body", e("details", [e("summary", ["Nested title"]), e("p", ["Nested needle"])])])]), e("details", [e("summary", ["Raw title"]), e("p", ["Raw hidden needle"])])]);
  const outer = f.root.childNodes[0], nested = outer.childNodes[1].childNodes[1], raw = f.root.childNodes[1];
  const values = include => feature.readingTextSnapshot(f.root, include).sections.map(section => section.text).join("|");
  assert.equal(values().includes("Outer body"), false); assert.equal(values().includes("Nested title"), false);
  const both = values(element => element === outer || element === nested);
  assert.equal(both.includes("Outer body"), true); assert.equal(both.includes("Nested needle"), true); assert.equal(both.includes("Raw hidden needle"), false);
  assert.equal(values(element => element === nested).includes("Nested needle"), false, "a captured child cannot bypass its uncaptured closed outer details");
  assert.equal(values(element => element === outer).includes("Nested needle"), false, "a captured outer cannot expose a closed uncaptured child");
  assert.equal(outer.hasAttribute("open"), false); assert.equal(nested.hasAttribute("open"), false); assert.equal(raw.hasAttribute("open"), false);
});

test("DOM traversal stops at its budget instead of walking a large rejected remainder", () => {
  const f = domFixture(e => Array(feature.MAX_READING_SEARCH_NODES + 100).fill(null).map(() => e("span", ["x"])));
  const snapshot = feature.readingTextSnapshot(f.root);
  assert.match(snapshot.message, /too many DOM nodes/); assert.deepEqual(snapshot.sections, []);
  assert.ok(f.visited() <= feature.MAX_READING_SEARCH_NODES + 1);
});

function commandsFixture(mode = "source") {
  const calls = [], file = { path: "Note.md" }, commandList = [];
  let availableFile = file;
  const surface = prefix => ({ showSearch(replace = false) { calls.push([prefix, "show", replace]); return true; }, searchIsOpen() { return this.open; }, open: true,
    findNext() { calls.push([prefix, "next"]); }, findPrevious() { calls.push([prefix, "previous"]); }, closeSearch() { calls.push([prefix, "close"]); },
    canReplace() { return this.writable; }, writable: true, replaceNext() { calls.push([prefix, "replace-next"]); }, replaceAll() { calls.push([prefix, "replace-all"]); } });
  const editor = surface("source"), reading = surface("reading");
  const view = { editor, reading, file, mode, isLoaded: true, getMode() { return this.mode; }, get currentMode() { return this.mode === "source" ? editor : reading; } };
  const app = { changingVault: false, workspace: { isChangingFiles: false, getActiveViewOfType() { return view; } }, vault: { getFileByPath() { return availableFile; } },
    commands: { install(list) { commandList.push(...list); return () => commandList.length = 0; } } };
  const dispose = feature.registerEditorSearchCommands(app);
  return { calls, view, app, editor, reading, dispose, replaceIdentity() { availableFile = { path: file.path }; }, command(id) { return commandList.find(command => command.id === "editor:" + id); } };
}

test("Source and Live Preview command routing retains the original editor and guarded replacement behavior", () => {
  const f = commandsFixture();
  for (const id of ["open-search", "open-search-replace", "find-next", "find-previous", "replace-next", "replace-all", "close-search"]) {
    assert.equal(f.command(id).checkCallback(true), true); assert.equal(f.calls.length, 0, "checking is read-only");
  }
  f.command("open-search").checkCallback(false); f.command("open-search-replace").checkCallback(false); f.command("replace-all").checkCallback(false);
  assert.deepEqual(f.calls, [["source", "show", false], ["source", "show", true], ["source", "replace-all"]]);
  f.editor.writable = false; assert.equal(f.command("replace-next").checkCallback(false), false); assert.equal(f.command("open-search-replace").checkCallback(false), false);
  assert.equal(f.command("find-next").checkCallback(false), true);
});

test("Reading commands route Find/navigation/Close to the current renderer and refuse every replacement", () => {
  const f = commandsFixture("preview");
  for (const id of ["open-search", "find-next", "find-previous", "close-search"]) { assert.equal(f.command(id).checkCallback(false), true); }
  assert.deepEqual(f.calls, [["reading", "show", false], ["reading", "next"], ["reading", "previous"], ["reading", "close"]]);
  for (const id of ["open-search-replace", "replace-next", "replace-all"]) { assert.equal(f.command(id).checkCallback(false), false); }
  assert.equal(f.calls.length, 4);
});

test("search commands refuse obsolete file identity and pending root/file transitions", () => {
  for (const mutate of [f => { f.app.changingVault = true; }, f => { f.app.workspace.isChangingFiles = true; }, f => f.replaceIdentity(), f => { f.view.file = null; }]) {
    const f = commandsFixture("preview"); mutate(f);
    for (const id of ["open-search", "find-next", "close-search", "replace-next"]) { assert.equal(f.command(id).checkCallback(false), false); }
    assert.deepEqual(f.calls, []);
  }
});

test("closed source/Reading searches disable Close and replacement actions without affecting Find availability", () => {
  for (const mode of ["source", "preview"]) {
    const f = commandsFixture(mode); f.editor.open = false; f.reading.open = false;
    assert.equal(f.command("close-search").checkCallback(false), false); assert.equal(f.command("replace-all").checkCallback(false), false);
    assert.equal(f.command("open-search").checkCallback(true), true); assert.deepEqual(f.calls, []); f.dispose(); assert.equal(f.command("open-search"), undefined);
  }
});
