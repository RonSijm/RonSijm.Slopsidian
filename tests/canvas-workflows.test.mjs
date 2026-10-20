import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pure production-method tests. No Electron, native host, browser or API is launched.
const stubs = new Map([
  ["./reading", "export class ReadingView {}"], ["./views", "export class TextFileView {}"],
  ["./menu", "export class Menu {}"], ["./view-panel", "export class ResponsiveViewPanel {}"],
  ["./icons", "export function iconButton() {}"], ["./dom", "export function reportError() {}"],
  ["./vault", "export class TFile {}"],
  ["./ui", "export class Modal {} export class Notice {}"],
]);
const bundle = await build({
  stdin: { contents: 'export * from "./client/canvas-interaction-model"; export * from "./client/canvas-preview"; export { CanvasFileChooser } from "./client/canvas-chooser"; export { CanvasBoard } from "./client/canvas"; export { CanvasDocument } from "./client/canvas-model"; export { configureBrowserHost } from "./client/contracts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  bundle: true, platform: "node", format: "esm", packages: "external", write: false, logLevel: "silent", outfile: "x.mjs",
  plugins: [{ name: "pure-canvas-surfaces", setup(builder) {
    builder.onResolve({ filter: /^\.\/(reading|views|menu|view-panel|icons|dom|vault|ui)$/ }, args => ({ path: args.path, namespace: "canvas-stub" }));
    builder.onLoad({ filter: /.*/, namespace: "canvas-stub" }, args => ({ contents: stubs.get(args.path), loader: "js" }));
  } }],
});
const output = fileURLToPath(new URL("../.runtime/canvas-workflows-test.mjs", import.meta.url));
await mkdir(fileURLToPath(new URL("../.runtime/", import.meta.url)), { recursive: true });
await writeFile(output, bundle.outputFiles[0].text);
const { CanvasBoard, CanvasDocument, CanvasPreview, CanvasFileChooser, canvasFileChoices, canvasSubpathChoices, canvasDetailsVisible, canvasConnectionPath, nearestCanvasSide, configureBrowserHost } = await import(pathToFileURL(output).href);

const file = (path, extension = path.split(".").at(-1)) => ({ path, extension });
const card = (id, extra = {}) => ({ id, type: "text", text: "", x: 0, y: 0, width: 200, height: 100, ...extra });

test("Canvas file choices reuse bounded literal/fuzzy ranking, deterministic paths and real kind filters", () => {
  const values = [file("Notes/Project Plan.md"), file("Notes/Progress.md"), file("Art/Photo.png"), file("Boards/Project.canvas"), file("Notes/Plan.pdf")];
  assert.equal(canvasFileChoices(values, "note", "Project Plan").values[0].path, "Notes/Project Plan.md");
  assert.ok(canvasFileChoices(values, "note", "PjPl").values.some(value => value.path === "Notes/Project Plan.md"));
  assert.deepEqual(canvasFileChoices(values, "media", "").values.map(value => value.path).sort(), ["Art/Photo.png", "Notes/Plan.pdf"]);
  assert.equal(canvasFileChoices(values, "all", "missing").total, 0);
  assert.equal(canvasFileChoices(values, "note", "").values.length, 3);
  assert.equal(values[0].path, "Notes/Project Plan.md");
});

test("Canvas picker bounds report the complete match count and never create a destination", () => {
  const values = Array.from({ length: 120 }, (_, index) => file("Notes/Item " + String(index).padStart(3, "0") + ".md"));
  const result = canvasFileChoices(values, "note", "Item");
  assert.equal(result.total, 120); assert.equal(result.values.length, 100);
  assert.throws(() => canvasFileChoices(Array(10_001).fill(values[0]), "note", ""), /10,000/);
  assert.throws(() => canvasFileChoices(values, "note", "x".repeat(257)), /256/);
  assert.equal(canvasFileChoices([file("a".repeat(1025) + ".md")], "note", "").values.length, 0);
});

test("Canvas section choices offer only currently addressable headings and real whole-block IDs", () => {
  const text = "# Parent\r\n\r\n## Child\r\n\r\nSelected **literal** 😀. ^real-id\r\n\r\n## Sibling\r\n\r\nOther.\r\n";
  const choices = canvasSubpathChoices("Notes/Source.md", text);
  assert.ok(choices.some(value => value.subpath === "#Child"));
  assert.ok(choices.some(value => value.subpath === "#^real-id" && value.label.includes("literal")));
  assert.ok(!choices.some(value => value.subpath.includes("invented")));
  assert.deepEqual(canvasSubpathChoices("Image.png", text), []);
  assert.throws(() => canvasSubpathChoices("Notes/Source.md", "x".repeat(262145)), /262,144/);
  assert.equal(canvasSubpathChoices("Notes/Source.md", text, "Sibling").some(value => value.subpath === "#Child"), false);
});

test("Canvas duplicate heading choices retain shared first-address semantics rather than inventing links", () => {
  const choices = canvasSubpathChoices("Source.md", "# Same\nfirst\n# Same\nsecond\n");
  assert.equal(choices.filter(value => value.subpath === "#Same").length, 1);
  assert.ok(!choices.some(value => /Same-2/.test(value.subpath)));
});

class Host {
  constructor() { this.dataset = {}; this.children = []; this.ownerDocument = { createElement: () => new Host() }; }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  get textContent() { return this.text ?? this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.text = value; }
}
function previewFixture(text, subpath = "", options = {}) {
  const target = file("Notes/Target.md"), host = new Host(), state = { text, indexed: true, current: true, cachedReads: 0, renders: [], clears: 0, ready: Promise.resolve() };
  const app = {
    changingVault: false,
    vault: { rootPath: "Vault A", readOnly: false, getFileByPath: path => path === target.path ? target : null, cachedRead: async () => { state.cachedReads++; return state.read ? state.read() : state.text; } },
    metadataCache: { updateOpenDocuments() {}, getDocument: () => state.indexed ? { text: state.text, missing: false } : null },
  };
  Object.assign(app.vault, options);
  const reading = { render: (value, path) => { state.renders.push({ value, path }); }, clear: async () => { state.clears++; host.replaceChildren(); }, whenReady: () => state.ready };
  const preview = new CanvasPreview({ app, file: target, subpath, host, current: () => state.current, createReading: () => reading });
  return { target, host, state, app, preview };
}

test("Canvas heading previews render the exact shared section including nested headings, excluding siblings", async () => {
  const text = "# Top\r\nBefore.\r\n## Chosen\r\nInside 😀.\r\n### Nested\r\nChild.\r\n## Other\r\nExcluded.\r\n";
  const { preview, state, host } = previewFixture(text, "#Chosen");
  await preview.ready;
  assert.deepEqual(state.renders, [{ value: "## Chosen\r\nInside 😀.\r\n### Nested\r\nChild.\r\n", path: "Notes/Target.md" }]);
  assert.equal(host.dataset.canvasPreview, "ready"); assert.equal(state.cachedReads, 0);
  await preview.dispose();
});

test("Canvas block previews preserve literal text and CRLF while excluding the marker and unrelated prose", async () => {
  const { preview, state } = previewFixture("Before.\r\n\r\nLiteral <img src=x> 😀. ^picked\r\n\r\nAfter.\r\n", "#^picked");
  await preview.ready;
  assert.equal(state.renders[0].value, "Literal <img src=x> 😀.");
  await preview.dispose();
});

test("Canvas missing sections show a literal error without rendering the whole note or fetching raw cache content", async () => {
  const { preview, state, host } = previewFixture("# Present\nKeep.\n", "#Absent", { readOnly: true });
  await preview.ready;
  assert.equal(state.renders.length, 0); assert.equal(state.cachedReads, 0);
  assert.equal(host.dataset.canvasPreview, "error"); assert.match(host.textContent, /does not exist: #Absent/);
  await preview.dispose();
});

test("Canvas read-only cached previews use current indexed text, and an uncached note refuses without raw reads", async () => {
  const cached = previewFixture("# Cached\nCurrent.\n", "#Cached", { readOnly: true });
  await cached.preview.ready; assert.equal(cached.state.cachedReads, 0); assert.equal(cached.state.renders.length, 1);
  const missing = previewFixture("private source", "", { readOnly: true }); missing.state.indexed = false;
  await missing.preview.ready; assert.equal(missing.state.cachedReads, 0); assert.equal(missing.state.renders.length, 0); assert.match(missing.host.textContent, /local cache/);
  await cached.preview.dispose(); await missing.preview.dispose();
});

test("Canvas held fallback reads cannot resurrect a retired low-zoom or disposed preview", async () => {
  let release;
  const fixture = previewFixture("held", ""); fixture.state.indexed = false; fixture.state.read = () => new Promise(resolve => { release = resolve; });
  await Promise.resolve(); assert.equal(fixture.state.cachedReads, 1);
  await fixture.preview.dispose(); fixture.state.current = false;
  release("# Stale\nMust not mount.\n"); await fixture.preview.ready;
  assert.equal(fixture.state.renders.length, 0); assert.equal(fixture.state.clears, 1);
});

test("Canvas root, exact file identity and replaced content owner each fence a held preview", async () => {
  for (const retire of [f => { f.app.vault.rootPath = "Vault B"; }, f => { f.app.vault.getFileByPath = () => ({ ...f.target }); }, f => { f.state.current = false; }]) {
    let release; const fixture = previewFixture("held"); fixture.state.indexed = false; fixture.state.read = () => new Promise(resolve => { release = resolve; });
    await Promise.resolve(); retire(fixture); release("obsolete"); await fixture.preview.ready;
    assert.equal(fixture.state.renders.length, 0); await fixture.preview.dispose();
  }
});

test("Canvas a newer preview refresh wins over an older held read, including after render readiness", async () => {
  let release; const fixture = previewFixture("old"); fixture.state.indexed = false; fixture.state.read = () => new Promise(resolve => { release = resolve; });
  await Promise.resolve(); fixture.state.indexed = true; fixture.state.text = "new dirty text 😀";
  await fixture.preview.refresh(); release("old stale text"); await fixture.preview.ready;
  assert.deepEqual(fixture.state.renders.map(value => value.value), ["new dirty text 😀"]);
  assert.equal(fixture.host.dataset.canvasPreview, "ready"); await fixture.preview.dispose();
});

test("Canvas oversized note previews refuse before Markdown rendering", async () => {
  const fixture = previewFixture("x".repeat(262145)); await fixture.preview.ready;
  assert.equal(fixture.state.renders.length, 0); assert.match(fixture.host.textContent, /262,144/); await fixture.preview.dispose();
});

test("Canvas detail threshold preserves exact boundary semantics at both configured ends", () => {
  for (const breakpoint of [-0.7, 0, 2.4]) {
    const threshold = 2 ** (-1.7 - breakpoint);
    assert.equal(canvasDetailsVisible(threshold, breakpoint), false);
    assert.equal(canvasDetailsVisible(threshold + 1e-8, breakpoint), true);
    assert.equal(canvasDetailsVisible(threshold - 1e-8, breakpoint), false);
  }
  assert.equal(canvasDetailsVisible(undefined, 0), true);
});

test("Canvas low-zoom transition retires actual resource owners once and remounts without editing source/history", () => {
  const nodes = [card("text"), card("image", { type: "file", file: "Image.png" }), card("web", { type: "link", url: "https://example.invalid" }), card("group", { type: "group", background: "Image.png" })];
  const bodies = new Map(nodes.map(node => [node.id, { dataset: { canvasContent: "mounted" }, children: ["resource"], style: { removeProperty() {} }, replaceChildren() { this.children = []; } }]));
  const cleared = [], mounted = [];
  const board = Object.assign(Object.create(CanvasBoard.prototype), {
    document: { text: "exact source", data: { nodes, edges: [] } }, camera: { scale: 0.1 }, plugin: { options: { zoomBreakpoint: 0 } },
    views: new Map(nodes.map(node => [node.id, { querySelector: () => bodies.get(node.id) }])),
    readings: new Map(nodes.filter(node => node.id !== "text").map(node => [node.id, { clear: async () => { cleared.push(node.id); } }])),
    filePreviews: new Map([["text", { dispose: async () => { cleared.push("text"); } }]]),
    view: { contentEl: { classList: { toggle() {} } } }, stage: { dataset: {} },
    renderContent(node, body) { mounted.push(node.id); body.dataset.canvasContent = "mounted"; },
  });
  board.updateDetail(); board.updateDetail();
  assert.deepEqual(cleared.sort(), ["group", "image", "text", "web"]); assert.equal(board.readings.size, 0); assert.equal(board.filePreviews.size, 0);
  assert.ok([...bodies.values()].every(body => body.children.length === 0 && body.dataset.canvasContent === "suspended"));
  board.camera.scale = 1; board.updateDetail(); board.updateDetail();
  assert.deepEqual(mounted.sort(), ["group", "image", "text", "web"]); assert.equal(board.document.text, "exact source");
});

test("Canvas connection preview uses exact endpoints and the nearest real target side without mutating data", () => {
  const source = card("source"), target = card("target", { x: 400, y: 200 }); const before = JSON.stringify([source, target]);
  assert.equal(canvasConnectionPath(source, "right", { x: 350, y: 150 }).path, "M200 50 L350 150");
  assert.deepEqual(canvasConnectionPath(source, "bottom", { x: 399, y: 250 }, target), { path: "M100 100 L400 250", toSide: "left" });
  assert.equal(nearestCanvasSide(target, { x: 500, y: 198 }), "top");
  assert.equal(JSON.stringify([source, target]), before);
});

function boardFixture() {
  const source = JSON.stringify({ future: { exact: true }, nodes: [card("text")], edges: [] }, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const model = new CanvasDocument(source), state = { saves: 0, renders: 0 };
  const board = Object.assign(Object.create(CanvasBoard.prototype), { document: model, disposed: false, revision: 0, generation: 0,
    error: { textContent: "" }, inputError: "", saveError: "",
    view: { app: { vault: { readOnly: false }, changingVault: false }, isReadOnlyForMutation: false, requestSave() { state.saves++; } },
    render() { state.renders++; },
  });
  return { board, model, state, source };
}

test("Canvas read-only and file-mutation barriers reject direct edits/additions and preserve both history branches", () => {
  for (const block of [f => { f.board.view.app.vault.readOnly = true; }, f => { f.board.view.isReadOnlyForMutation = true; }, f => { f.board.view.app.changingVault = true; }]) {
    const fixture = boardFixture(); fixture.model.edit(data => { data.nodes[0].text = "Changed"; }); fixture.model.undo(); block(fixture);
    assert.throws(() => fixture.board.edit(data => { data.nodes[0].text = "Forbidden"; }), /read-only|being changed/);
    assert.throws(() => fixture.board.addNode("text"), /read-only|being changed/);
    fixture.board.undo(); fixture.board.redo();
    assert.equal(fixture.model.text, fixture.source); assert.equal(fixture.model.canRedo, true); assert.equal(fixture.model.canUndo, false); assert.equal(fixture.state.saves, 0);
  }
});

test("Canvas legitimate model edits retain unknown data, exact Undo bytes and one revision per change", () => {
  const fixture = boardFixture(); fixture.board.edit(data => { data.nodes[0].text = "Changed 😀"; });
  assert.equal(fixture.board.revision, 1); assert.deepEqual(fixture.model.data.future, { exact: true }); assert.equal(fixture.state.saves, 1);
  fixture.board.undo(); assert.equal(fixture.model.text, fixture.source); assert.equal(fixture.board.revision, 2);
  fixture.board.redo(); assert.equal(fixture.model.data.nodes[0].text, "Changed 😀"); assert.equal(fixture.board.revision, 3);
});

function chooserFixture(subpath = "#Chosen") {
  const target = file("Target.md"), state = { source: "# Chosen\nExact.\n", current: true, applied: [], closed: 0 };
  const chooser = Object.assign(Object.create(CanvasFileChooser.prototype), {
    closed: false, dialog: { isConnected: true, open: true }, target: { file: target, path: target.path, text: state.source },
    files: { value: target.path }, subpaths: { value: subpath }, subpathSearch: { value: "" }, problem: { textContent: "" }, submit: { disabled: false },
    options: { app: { vault: { readOnly: false, getFileByPath: () => target }, workspace: { isChangingFiles: false }, metadataCache: { updateOpenDocuments() {}, getDocument: () => ({ text: state.source, missing: false }) } }, current: () => state.current, apply: value => state.applied.push(value) },
    close() { this.closed = true; state.closed++; },
  });
  return { chooser, target, state };
}

test("Canvas chooser applies only a current reviewed real target and keeps exact subpath text", () => {
  const f = chooserFixture(); f.chooser.accept();
  assert.deepEqual(f.state.applied, [{ file: f.target, subpath: "#Chosen" }]); assert.equal(f.state.closed, 1);
});

test("Canvas chooser fences stale source/history owners, detached controls and readonly/barrier transitions", () => {
  for (const change of [f => { f.state.current = false; }, f => { f.chooser.dialog.isConnected = false; }, f => { f.chooser.closed = true; }, f => { f.chooser.options.app.vault.readOnly = true; }, f => { f.chooser.options.app.workspace.isChangingFiles = true; }]) {
    const f = chooserFixture(); change(f); f.chooser.accept();
    assert.equal(f.state.applied.length, 0); assert.equal(f.state.closed, 0); assert.equal(f.chooser.submit.disabled, true); assert.match(f.chooser.problem.textContent, /no longer current|writable/);
  }
});

test("Canvas chooser refuses renamed/replaced targets and changed heading/body text without writes", () => {
  for (const change of [f => { f.target.path = "Renamed.md"; }, f => { f.chooser.options.app.vault.getFileByPath = () => ({ ...f.target }); }, f => { f.state.source += "A later dirty edit.\n"; }, f => { f.state.source = "# Other\nExact.\n"; }]) {
    const f = chooserFixture(); change(f); f.chooser.accept();
    assert.equal(f.state.applied.length, 0); assert.equal(f.state.closed, 0); assert.equal(f.chooser.submit.disabled, true); assert.match(f.chooser.problem.textContent, /changed/);
  }
});

test("Canvas connection cancellation removes only the transient path and releases capture without edits", () => {
  const calls = [], board = Object.assign(Object.create(CanvasBoard.prototype), {
    drag: { pointer: 7 }, region: { hidden: false }, connectionPreview: { remove() { calls.push("remove"); }, removeAttribute(value) { calls.push(value); } },
    stage: { hasPointerCapture: pointer => pointer === 7, releasePointerCapture: pointer => calls.push(pointer) }, geometry() { calls.push("geometry"); },
  });
  board.cancelDrag(); assert.equal(board.drag, null); assert.equal(board.region.hidden, true); assert.deepEqual(calls, ["remove", "d", 7, "geometry"]);
});

test("Canvas stale pointer owners retire before changing camera, source or connection history", () => {
  const board = Object.assign(Object.create(CanvasBoard.prototype), { drag: { pointer: 2, current: () => false }, cancelDrag() { this.drag = null; this.retired = true; } });
  board.pointerMove({ pointerId: 2 }); assert.equal(board.retired, true);
  board.retired = false; board.drag = { pointer: 3, current: () => false }; board.pointerUp({ pointerId: 3 }); assert.equal(board.retired, true);
});

test("Canvas retained website actions cannot open or allocate an iframe after actual low-zoom retirement, clear or owner replacement", async () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window, created = [], opened = [];
  class Element extends Host {
    constructor(tag) { super(); this.tag = tag; this.isConnected = true; this.listeners = new Map(); this.style = { removeProperty() {} }; this.disabled = false; }
    append(...children) { this.children.push(...children); }
    contains(child) { return this.children.includes(child); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
  }
  globalThis.document = { createElement: tag => { created.push(tag); return new Element(tag); } };
  globalThis.window = { open: (...args) => { opened.push(args); } };
  configureBrowserHost({ request() { throw Error("A pure website test must not make requests"); }, chooseDirectory() {}, getVaultChoices() {} });
  const setup = () => {
    const node = card("web", { type: "link", url: "https://example.invalid/explicit" }), source = file("Board.canvas"), body = new Element("div"), leaf = { id: "canvas-leaf" };
    const app = { changingVault: false, vault: { rootPath: "Root A", getFileByPath: path => path === source.path ? source : null }, workspace: { getLeafById: id => id === leaf.id ? leaf : null } };
    const view = { app, leaf, file: source, isLoaded: true, contentEl: { classList: { toggle() {} } } }; leaf.view = view;
    const board = Object.assign(Object.create(CanvasBoard.prototype), { view, disposed: false, generation: 1, revision: 0, detailsVisible: true, camera: { scale: 1 }, plugin: { options: {} },
      document: { data: { nodes: [node], edges: [] } }, views: new Map([[node.id, { querySelector: () => body }]]), signatures: new Map([[node.id, "signature"]]),
      filePreviews: new Map(), readings: new Map(), stage: { dataset: {} }, selection: new Set(), fields: new Map(), inspector: new Element("form"), cards: new Element("div"), edges: new Element("svg"),
      cancelDrag() {}, closeCreation() {},
    });
    board.renderContent(node, body);
    const load = body.children.find(child => child.dataset.canvasLoadWebsite), open = body.children.find(child => child.dataset.canvasOpenWebsite);
    return { board, body, app, view, source, load, open };
  };
  try {
    const live = setup(); live.load.listeners.get("click")(); live.load.listeners.get("click")(); live.open.listeners.get("click")(); await Promise.resolve();
    assert.equal(created.filter(tag => tag === "iframe").length, 1); assert.equal(opened.length, 1);
    const retirements = [f => { f.board.camera.scale = 0.02; f.board.updateDetail(); }, f => { f.board.clear(); }, f => { f.app.vault.rootPath = "Root B"; }, f => { f.view.file = { ...f.source }; }, f => { f.board.signatures.set("web", "new-url"); }, f => { f.view.isLoaded = false; }, f => { f.board.disposed = true; }];
    for (const retire of retirements) {
      const f = setup(), frames = created.filter(tag => tag === "iframe").length, openings = opened.length; retire(f);
      f.load.listeners.get("click")(); f.open.listeners.get("click")(); await Promise.resolve();
      assert.equal(created.filter(tag => tag === "iframe").length, frames); assert.equal(opened.length, openings);
    }
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});

test("Canvas connection owns Escape from inspector focus and pins its lease after a legitimate blur commit", () => {
  const oldElement = globalThis.Element, oldDocument = globalThis.document;
  class Target {
    constructor(dataset) { this.dataset = dataset; }
    closest(selector) {
      if (selector === "[data-canvas-connect]" && this.dataset.canvasConnect) return this;
      if (selector === "[data-canvas-node]") return this.node ?? this;
      return null;
    }
  }
  globalThis.Element = Target;
  try {
    for (const commitOnBlur of [false, true]) {
      const sourceNode = card("source"), targetNode = card("target", { x: 400 }), model = new CanvasDocument(JSON.stringify({ future: { keep: true }, nodes: [sourceNode, targetNode], edges: [] }));
      const leaf = { id: "canvas-leaf" }, sourceFile = file("Board.canvas"), inspector = { tagName: "TEXTAREA" }, doc = { activeElement: inspector }, state = { focused: 0, saves: 0, captures: new Set() };
      const target = new Target({ canvasNode: "target" }), source = new Target({ canvasNode: "source" }), handle = new Target({ canvasConnect: "top" }); handle.node = source;
      doc.elementFromPoint = () => target; globalThis.document = doc;
      const preview = { attached: false, dataset: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, remove() { this.attached = false; }, classList: { toggle() {} } };
      let blur = commitOnBlur;
      const board = Object.assign(Object.create(CanvasBoard.prototype), {
        document: model, disposed: false, generation: 1, revision: 0, selection: new Set(["source"]), camera: { x: 0, y: 0, scale: 1 }, region: { hidden: true }, connectionPreview: preview,
        fields: new Map(), error: { textContent: "" }, inputError: "", saveError: "", cards: { contains: node => node === target }, edges: { append: node => { node.attached = true; } },
        screenPoint: (x, y) => ({ x, y }), point: (x, y) => ({ x, y }), renderSelection() {}, render() {}, geometry() {},
        view: { leaf, file: sourceFile, isLoaded: true, isReadOnlyForMutation: false, app: { changingVault: false, vault: { rootPath: "Root A", readOnly: false }, workspace: { getLeafById: () => leaf } }, requestSave() { state.saves++; } },
      });
      leaf.view = board.view;
      board.stage = { focus() { state.focused++; doc.activeElement = this; if (blur) { blur = false; board.edit(data => { data.nodes[0].width = 220; }); } }, setPointerCapture: id => state.captures.add(id), hasPointerCapture: id => state.captures.has(id), releasePointerCapture: id => state.captures.delete(id) };
      let prevented = false;
      board.pointerDown({ target: handle, button: 0, pointerId: 8, clientX: 100, clientY: 0, preventDefault() { prevented = true; } });
      assert.equal(doc.activeElement, board.stage); assert.equal(state.focused, 1); assert.equal(prevented, true); assert.equal(board.drag.current(), true);
      assert.equal(board.revision, commitOnBlur ? 1 : 0); assert.equal(model.data.nodes[0].width, commitOnBlur ? 220 : 200);
      const before = { text: model.text, past: [...model.past], future: [...model.future], revision: board.revision, saves: state.saves };
      board.pointerMove({ pointerId: 8, clientX: 450, clientY: 50 });
      assert.equal(preview.attached, true); assert.ok(preview.attributes.d.startsWith("M" + (commitOnBlur ? 110 : 100) + " 0")); assert.equal(board.drag.current(), true);
      board.keydown({ target: doc.activeElement, key: "Escape", preventDefault() {}, stopPropagation() {} });
      assert.equal(board.drag, null); assert.equal(preview.attached, false); assert.equal(state.captures.size, 0); assert.equal(model.data.edges.length, 0);
      assert.deepEqual({ text: model.text, past: model.past, future: model.future, revision: board.revision, saves: state.saves }, before);
    }
  } finally { if (oldElement === undefined) delete globalThis.Element; else globalThis.Element = oldElement; if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});
