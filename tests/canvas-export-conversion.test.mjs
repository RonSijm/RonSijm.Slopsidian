import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pure production model/controller tests. No native process, browser or API is started.
const stubs = new Map([["./reading", "export class ReadingView {}"], ["./views", "export class TextFileView {}"], ["./menu", "export class Menu {}"], ["./view-panel", "export class ResponsiveViewPanel {}"], ["./icons", "export function iconButton() {}"], ["./dom", "export function reportError() {}"], ["./vault", "export class TFile {}"], ["./ui", "export class Modal {} export class Notice {}"]]);
const bundle = await build({ stdin: { contents: 'export * from "./client/canvas-export"; export * from "./client/canvas-convert"; export {CanvasConvertModal} from "./client/canvas-convert-modal"; export {CanvasBoard} from "./client/canvas"; export {CanvasDocument} from "./client/canvas-model";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" }, bundle: true, platform: "node", format: "esm", packages: "external", write: false, logLevel: "silent", plugins: [{ name: "canvas-export-pure", setup(builder) { builder.onResolve({ filter: /^\.\/(reading|views|menu|view-panel|icons|dom|vault|ui)$/ }, args => ({ path: args.path, namespace: "canvas-export-stub" })); builder.onLoad({ filter: /.*/, namespace: "canvas-export-stub" }, args => ({ contents: stubs.get(args.path), loader: "js" })); } }] });
const output = fileURLToPath(new URL("../.runtime/canvas-export-conversion-test.mjs", import.meta.url)); await mkdir(fileURLToPath(new URL("../.runtime/", import.meta.url)), { recursive: true }); await writeFile(output, bundle.outputFiles[0].text);
const { captureCanvasExport, serializeCanvasExport, readCanvasExportSettings, canvasExportFilename, rasterizeCanvasExport, CanvasConversionReview, canvasConversionOutcome, convertedCanvasTextCard, CanvasDocument, CanvasBoard, CanvasConvertModal } = await import(pathToFileURL(output).href);
const card = (id, extra = {}) => ({ id, type: "text", text: "Literal **Markdown** & Ω 😀.\r\nNext line.", x: 0, y: 0, width: 280, height: 180, ...extra });
const boardData = () => ({ future: { retain: [false, null, "opaque"] }, nodes: [card("a", { color: "6", future: { exact: true } }), card("b", { x: 420, y: 20, type: "file", file: "Notes/Target & Ω.md", subpath: "#Heading" }), card("web", { type: "link", x: 420, y: 260, url: "https://example.invalid/<script>bad</script>" })], edges: [{ id: "edge", fromNode: "a", toNode: "b", label: 'A & <B> "C"', future: { keep: true } }] });
const settings = { scope: "whole", background: "white", width: 1000, height: 700 };

test("Canvas export captures immutable committed model fields, preserving the original source and selection", () => {
  const data = boardData(), before = JSON.stringify(data), selection = new Set(["a"]), frame = captureCanvasExport(data, "Board & Ω", selection);
  assert.equal(JSON.stringify(data), before); assert.deepEqual([...selection], ["a"]); data.nodes[0].text = "Later"; selection.clear();
  assert.match(frame.nodes[0].content, /Literal/); assert.deepEqual(frame.selection, ["a"]); assert.throws(() => { frame.nodes[0].content = "forged"; }, TypeError);
  assert.throws(() => serializeCanvasExport({ ...frame }, settings), /Capture/); assert.throws(() => captureCanvasExport(boardData(), "Board", new Set(["missing"])), /selected.*changed/);
});
test("Whole and selected-card export retain only corresponding connections without changing geometry or data", () => {
  const frame = captureCanvasExport(boardData(), "Board", new Set(["a", "b"])), whole = serializeCanvasExport(frame, settings), selection = serializeCanvasExport(frame, { ...settings, scope: "selection" });
  assert.equal(whole.cards, 3); assert.equal(selection.cards, 2); assert.equal(selection.edges, 1); assert.equal(whole.edges, 1); assert.doesNotMatch(selection.text, /example.invalid/);
  assert.equal(serializeCanvasExport(captureCanvasExport(boardData(), "B", new Set(["a"])), { ...settings, scope: "selection" }).edges, 0);
  assert.throws(() => serializeCanvasExport(captureCanvasExport(boardData(), "B", new Set()), { ...settings, scope: "selection" }), /Select at least/);
  assert.throws(() => captureCanvasExport({ nodes: [], edges: [] }, "B", new Set()), /Add a card/);
});
test("Export uses XML-escaped literal text and path/URL placeholders, with no external resources or executable HTML", () => {
  const svg = serializeCanvasExport(captureCanvasExport(boardData(), "<Board & Ω>", new Set()), settings);
  assert.match(svg.text, /&lt;Board &amp; Ω&gt;/); assert.match(svg.text, /Literal \*\*Markdown\*\* &amp; Ω 😀/); assert.match(svg.text, /Notes\/Target &amp; Ω.md#Heading/);
  assert.match(svg.text, /&lt;script&gt;/); assert.doesNotMatch(svg.text, /<(?:script|foreignObject|image)\b|(?:href|src)=/i);
  assert.equal(Buffer.byteLength(svg.text, "utf8"), svg.bytes); assert.match(svg.text, /stroke="#a78bfa"/); assert.match(svg.text, /M280,90 L420,110/); assert.match(svg.text, /L-10,-5 L-10,5/);
});
test("Explicit white, dark and transparent backgrounds keep bounded clipped text and recognizable outlines", () => {
  const data = { nodes: [card("small", { text: "Line\n".repeat(100), height: 90 })], edges: [] }, frame = captureCanvasExport(data, "B", new Set());
  const transparent = serializeCanvasExport(frame, { ...settings, background: "transparent" }); assert.equal(transparent.clippedCards, 1); assert.match(transparent.text, /…/); assert.doesNotMatch(transparent.text, /width="100%"/); assert.match(transparent.text, /fill="#24242a"/);
  assert.match(serializeCanvasExport(frame, { ...settings, background: "dark" }).text, /fill="#17171c"/); assert.match(serializeCanvasExport(frame, settings).text, /fill="#ffffff"/);
});
test("Canvas image settings enforce dimensions, total pixels, allowed scopes/backgrounds and safe filenames", () => {
  for (const invalid of [{ width: 63 }, { height: 4097 }, { width: 1.5 }, { width: NaN }, { width: 4096, height: 4096 }, { scope: "camera" }, { background: "url(bad)" }]) { assert.throws(() => readCanvasExportSettings({ ...settings, ...invalid })); }
  assert.deepEqual(readCanvasExportSettings(settings), settings); assert.equal(canvasExportFilename('CON', "png"), "Canvas CON.png"); assert.equal(canvasExportFilename('A/B:😀. ', "svg"), "A_B_😀.svg"); assert.throws(() => canvasExportFilename("B", "jpg"));
});
test("Maximum-card SVG serialization refuses its actual byte budget instead of yielding a partial file", () => {
  const data = { nodes: Array.from({ length: 5000 }, (_, i) => card("n" + i, { x: i, height: 2000, text: "x".repeat(16000) })), edges: [] };
  assert.throws(() => serializeCanvasExport(captureCanvasExport(data, "Large", new Set()), settings), /exceeds 8 MiB/);
});

function pngFixture(mode = "success") {
  const state = { removed: 0, draws: 0, canvas: null, image: null, callback: null };
  const image = { onload: null, onerror: null, removeAttribute() { state.removed++; }, set src(_value) { if (mode !== "held") queueMicrotask(() => mode === "decode-error" ? this.onerror?.() : this.onload?.()); } };
  const canvas = { width: 0, height: 0, getContext: () => mode === "no-context" ? null : { drawImage() { state.draws++; } }, toBlob(callback) { if (mode === "blob-held") state.callback = callback; else callback(mode === "empty" ? null : new Blob(["PNG"], { type: "image/png" })); } };
  state.image = image; state.canvas = canvas; return { state, document: { createElement: name => name === "img" ? image : canvas } };
}
test("Local PNG preparation uses only the validated SVG and releases image/canvas resources after success", async () => {
  const svg = serializeCanvasExport(captureCanvasExport(boardData(), "B", new Set()), settings), f = pngFixture(), controller = new AbortController();
  const blob = await rasterizeCanvasExport(svg, { document: f.document, current: () => true, signal: controller.signal }); assert.equal(blob.type, "image/png"); assert.equal(f.state.draws, 1); assert.equal(f.state.removed, 1); assert.equal(f.state.canvas.width, 0); assert.equal(f.state.canvas.height, 0); assert.equal(f.state.image.onload, null);
  await assert.rejects(rasterizeCanvasExport({ ...svg }, { document: f.document, current: () => true, signal: controller.signal }), /validated/);
});
test("PNG decode/context/blob failures release the owned resources and do not prepare a download", async () => {
  const svg = serializeCanvasExport(captureCanvasExport(boardData(), "B", new Set()), settings);
  for (const mode of ["decode-error", "no-context", "empty"]) { const f = pngFixture(mode); await assert.rejects(rasterizeCanvasExport(svg, { document: f.document, current: () => true, signal: new AbortController().signal })); assert.equal(f.state.removed, 1); assert.equal(f.state.canvas.width, 0); }
});
test("A changed PNG review aborts held decoding or rejects a late toBlob result, releasing resources", async () => {
  const svg = serializeCanvasExport(captureCanvasExport(boardData(), "B", new Set()), settings);
  for (const mode of ["held", "blob-held"]) { const f = pngFixture(mode), abort = new AbortController(), work = rasterizeCanvasExport(svg, { document: f.document, current: () => true, signal: abort.signal }); await Promise.resolve(); abort.abort(); await assert.rejects(work, /changed/); f.state.callback?.(new Blob(["late"], { type: "image/png" })); assert.equal(f.state.removed, 1); assert.equal(f.state.canvas.height, 0); }
});
test("PNG preparation rejects a stale owner before allocating image resources", async () => {
  const svg = serializeCanvasExport(captureCanvasExport(boardData(), "B", new Set()), settings), f = pngFixture(); await assert.rejects(rasterizeCanvasExport(svg, { document: f.document, current: () => false, signal: new AbortController().signal }), /stale/); assert.equal(f.state.removed, 0); assert.equal(f.state.draws, 0);
});

function conversionFixture(options = {}) {
  const source = { path: "Boards/Board.canvas", extension: "canvas" }, files = new Map([[source.path, source]]), text = options.text ?? "# Exact λ\r\nBody 😀.\r\n";
  const data = boardData(); data.nodes[0].text = text; const original = JSON.stringify(data, null, 2).replaceAll("\n", "\r\n") + "\r\n", model = new CanvasDocument(original);
  const sourceSaved = { file: { path: source.path }, content: original, version: "source-v1", hasBom: true };
  const state = { owner: true, writes: 0, probes: 0, reads: 0, sourceReads: 0, applies: 0, placementReads: 0, location: "current", root: "A", readOnly: false, doc: null, sourceSaved, sourcePhysical: structuredClone(sourceSaved), exists: null, afterAck: null, beforeAck: null, read: null, sourceRead: null, lateApplyError: false };
  const app = { changingVault: false, vault: { get rootPath() { return state.root; }, get readOnly() { return state.readOnly; }, getFileByPath: path => files.get(path), getAbstractFileByPath: path => files.get(path), getFolderByPath: path => path === "Boards" ? { path } : null, getConfig: key => key === "newFileLocation" ? state.location : "Boards", assertWritable() { if (state.readOnly) throw Error("readonly"); }, adapter: { async exists(path) { state.probes++; return state.exists ? state.exists(path) : files.has(path); } }, async create(path, content, ack) { state.writes++; const file = { path, extension: "md" }; files.set(path, file); const hasBom = content.startsWith("\ufeff"); state.doc = { file: { path }, content: hasBom ? content.slice(1) : content, version: "v1", hasBom }; if (state.beforeAck) await state.beforeAck(); ack(structuredClone(state.doc)); if (state.afterAck) await state.afterAck(); return file; }, async readDocument(path) { if (path === source.path) { state.sourceReads++; return state.sourceRead ? state.sourceRead() : structuredClone(state.sourcePhysical); } state.reads++; return state.read ? state.read() : structuredClone(state.doc); } }, fileManager: { getNewNotePath(name) { state.placementReads++; if (!name.trim()) throw Error("name"); return "Boards/" + name.replace(/\.md$/i, "") + ".md"; } }, workspace: { isChangingFiles: false, sessions: new Map(), async withFileMutation(action) { if (this.isChangingFiles) throw Error("busy"); this.isChangingFiles = true; try { return await action(); } finally { this.isChangingFiles = false; } } } };
  const authority = { current: owned => state.owner && (owned || !app.workspace.isChangingFiles), savedSource: () => state.sourceSaved, apply(file, committed) { state.applies++; model.edit(data => { data.nodes[0] = convertedCanvasTextCard(data.nodes[0], file.path); }); committed(); if (state.lateApplyError) throw Error("late UI failure"); } };
  const prepare = () => new CanvasConversionReview(app, source, "Converted λ", model.data.nodes[0], authority);
  return { app, state, files, model, original, source, prepare, authority, text };
}
test("Conversion creates exact text once then replaces only the reviewed node, preserving metadata, edges and one-step Undo", async () => {
  const f = conversionFixture(); f.model.edit(data => { data.nodes[0].x += 10; }); const before = structuredClone(f.model.data), review = f.prepare();
  await review.createAndConvert(); assert.equal(f.state.writes, 1); assert.equal(f.state.applies, 1); assert.equal(review.receipt.converted, true); assert.equal(f.state.doc.content, f.text);
  const expected = { ...before.nodes[0], type: "file", file: review.path }; delete expected.text;
  assert.deepEqual(f.model.data.future, before.future); assert.deepEqual(f.model.data.edges, before.edges); assert.deepEqual(f.model.data.nodes[0], expected);
});
test("Conversion Undo restores exact prior CRLF source/history and retains the acknowledged destination file", async () => {
  const f = conversionFixture(); f.model.edit(data => { data.nodes[0].x += 10; }); const earlier = f.model.text, review = f.prepare(); await review.createAndConvert();
  assert.equal(f.model.undo(), true); assert.equal(f.model.text, earlier); assert.equal(f.files.has(review.path), true); assert.equal(f.model.undo(), true); assert.equal(f.model.text, f.original); assert.equal(f.model.redo(), true); assert.equal(f.model.text, earlier); assert.match(canvasConversionOutcome(review.receipt), /Undo restores.*keeps/);
});
test("UTF-8 BOM and empty card text keep their exact acknowledged file bytes", async () => {
  for (const text of ["", "\ufeff# BOM\r\nλ\r\n"]) { const f = conversionFixture({ text }), review = f.prepare(); await review.createAndConvert(); assert.equal((f.state.doc.hasBom ? "\ufeff" : "") + f.state.doc.content, text); assert.equal(review.receipt.converted, true); }
});
test("Cancel, read-only, stale source, changed placement and present target refuse before creation", async () => {
  const readonly = conversionFixture(); readonly.state.readOnly = true; assert.throws(() => readonly.prepare(), /not available/); assert.equal(readonly.state.placementReads, 0); assert.equal(readonly.state.probes, 0);
  for (const change of [f => { f.review.close(); }, f => { f.state.owner = false; }, f => { f.state.location = "root"; }, f => { f.state.root = "B"; }, f => { f.files.set(f.review.path, { path: f.review.path, extension: "md" }); }]) { const f = conversionFixture(); f.review = f.prepare(); change(f); await assert.rejects(f.review.createAndConvert()); assert.equal(f.state.writes, 0); assert.equal(f.state.applies, 0); assert.equal(f.model.text, f.original); }
});
test("A held existence probe rechecks source/root ownership before attempting the create", async () => {
  const f = conversionFixture(), review = f.prepare(); let release; f.state.exists = () => new Promise(resolve => { release = resolve; }); const work = review.createAndConvert(); for (let spin = 0; spin < 10 && !release; spin++) await Promise.resolve(); assert.equal(typeof release, "function"); f.state.owner = false; release(false); await assert.rejects(work, /changed/); assert.equal(f.state.writes, 0); assert.equal(review.receipt.attempted, false); assert.equal(f.model.text, f.original);
});
test("Confirmed creation survives downstream inventory failure without a card replacement or automatic retry", async () => {
  const f = conversionFixture(), review = f.prepare(); f.state.afterAck = () => { throw Error("inventory failed"); }; await assert.rejects(review.createAndConvert(), /inventory/); assert.equal(f.files.has(review.path), true); assert.ok(review.receipt.document); assert.equal(review.receipt.converted, false); assert.equal(f.model.text, f.original); await assert.rejects(review.createAndConvert(), /already attempted/); assert.equal(f.state.writes, 1); assert.match(canvasConversionOutcome(review.receipt), /confirmed.*kept/);
});
test("An unconfirmed creation outcome remains explicit and never applies, retries or deletes the possible file", async () => {
  const f = conversionFixture(), review = f.prepare(); f.state.beforeAck = () => { throw Error("response lost"); }; await assert.rejects(review.createAndConvert()); assert.equal(review.receipt.attempted, true); assert.equal(review.receipt.document, null); assert.equal(review.receipt.converted, false); assert.equal(f.files.has(review.path), true); assert.equal(f.state.applies, 0); assert.match(canvasConversionOutcome(review.receipt), /may exist/);
});
test("Closing during a create retains the host receipt and file while refusing the stale Canvas replacement", async () => {
  const f = conversionFixture(), review = f.prepare(); f.state.afterAck = () => { review.close(); }; await assert.rejects(review.createAndConvert(), /changed/); assert.ok(review.receipt.document); assert.equal(f.state.applies, 0); assert.equal(f.files.has(review.path), true); assert.equal(f.model.text, f.original);
});
test("A physically changed new target or a dirty target session prevents replacing the card", async () => {
  for (const mode of ["version", "content", "dirty"]) { const f = conversionFixture(), review = f.prepare(); f.state.read = () => { const doc = structuredClone(f.state.doc); if (mode === "version") doc.version = "v2"; if (mode === "content") doc.content = "External"; if (mode === "dirty") f.app.workspace.sessions.set(review.path, { originRoot: "A", isReloading: false, dirty: true, text: doc.content }); return doc; }; await assert.rejects(review.createAndConvert(), /changed/); assert.equal(f.state.applies, 0); assert.ok(review.receipt.document); assert.equal(f.files.has(review.path), true); }
});
test("A late UI error after the actual one-step replacement reports the committed card truthfully", async () => {
  const f = conversionFixture(), review = f.prepare(); f.state.lateApplyError = true; await assert.rejects(review.createAndConvert(), /late UI/); assert.equal(review.receipt.converted, true); assert.equal(f.model.data.nodes[0].type, "file"); assert.match(canvasConversionOutcome(review.receipt), /replaced the text card/); assert.doesNotMatch(canvasConversionOutcome(review.receipt), /did not replace/); assert.equal(f.model.undo(), true); assert.equal(f.model.text, f.original);
});
test("Mutation cleanup cannot carry a stale target version, content or session into the final Canvas replacement", async () => {
  for (const mode of ["version", "content", "session"]) {
    const f = conversionFixture(), review = f.prepare(), originalMutation = f.app.workspace.withFileMutation;
    f.app.workspace.withFileMutation = async function (action) {
      const file = await originalMutation.call(this, action);
      // Models the real withFileMutation layout-save cleanup after it unlocks.
      if (mode === "version") f.state.doc.version = "changed-during-cleanup";
      if (mode === "content") f.state.doc.content = "An edit during cleanup";
      if (mode === "session") this.sessions.set(review.path, { originRoot: "A", isReloading: false, dirty: true, text: "A new unsaved target draft" });
      return file;
    };
    await assert.rejects(review.createAndConvert(), /created Markdown file changed/);
    assert.equal(f.state.reads, 2); assert.equal(f.state.writes, 1); assert.equal(f.state.applies, 0); assert.equal(review.receipt.converted, false); assert.ok(review.receipt.document); assert.equal(f.files.has(review.path), true); assert.equal(f.model.text, f.original);
    await assert.rejects(review.createAndConvert(), /already attempted/); assert.equal(f.state.writes, 1);
  }
});
test("The actual saved Canvas physical version, content and BOM must match its current owned saved tuple before creation", async () => {
  for (const key of ["version", "content", "hasBom"]) {
    const f = conversionFixture(), review = f.prepare(); f.state.sourcePhysical[key] = key === "hasBom" ? false : "Externally changed";
    await assert.rejects(review.createAndConvert(), /saved Canvas changed/); assert.equal(f.state.sourceReads, 1); assert.equal(f.state.probes, 0); assert.equal(f.state.writes, 0); assert.equal(f.state.applies, 0); assert.equal(review.receipt.attempted, false); assert.equal(f.model.text, f.original);
  }
});
test("A completed normal Canvas autosave is accepted when its owned saved tuple and physical bytes agree", async () => {
  const f = conversionFixture(); f.model.edit(data => { data.nodes[0].x++; }); const prior = f.model.text, review = f.prepare();
  f.state.sourceSaved = { ...f.state.sourceSaved, content: prior, version: "source-normal-save" }; f.state.sourcePhysical = structuredClone(f.state.sourceSaved);
  await review.createAndConvert(); assert.equal(f.state.sourceReads, 2); assert.equal(f.state.reads, 2); assert.equal(review.receipt.converted, true); assert.equal(f.model.undo(), true); assert.equal(f.model.text, prior);
});
test("A Canvas saved tuple that changes during physical proof refuses without creating or retrying a file", async () => {
  const f = conversionFixture(), review = f.prepare(); f.state.sourceRead = () => { f.state.sourceSaved = { ...f.state.sourceSaved, version: "new-owned-save" }; return structuredClone(f.state.sourcePhysical); };
  await assert.rejects(review.createAndConvert(), /saved Canvas changed/); assert.equal(f.state.writes, 0); assert.equal(f.state.applies, 0); assert.equal(review.receipt.attempted, false);
});
test("A physical Canvas change during mutation cleanup keeps the confirmed note and refuses before the final target read", async () => {
  const f = conversionFixture(), review = f.prepare(), mutation = f.app.workspace.withFileMutation;
  f.app.workspace.withFileMutation = async function (action) { const file = await mutation.call(this, action); f.state.sourcePhysical.hasBom = false; return file; };
  await assert.rejects(review.createAndConvert(), /saved Canvas changed/); assert.equal(f.state.sourceReads, 2); assert.equal(f.state.reads, 1); assert.ok(review.receipt.document); assert.equal(f.state.writes, 1); assert.equal(f.state.applies, 0); assert.equal(f.model.text, f.original); assert.equal(f.files.has(review.path), true);
});
test("Conversion rejects non-text, oversized and malformed destination choices without altering the original node", () => {
  const original = card("x", { future: { exact: true }, subpath: "#Old irrelevant field" }), before = structuredClone(original), next = convertedCanvasTextCard(original, "Result.md"); assert.deepEqual(original, before); assert.equal(next.type, "file"); assert.equal(next.text, undefined); assert.equal(next.subpath, undefined); assert.deepEqual(next.future, original.future);
  assert.throws(() => convertedCanvasTextCard(card("x", { type: "file", file: "X.md" }), "X.md"), /text card/); assert.throws(() => convertedCanvasTextCard(card("x", { text: "x".repeat(262145) }), "X.md"), /262,144/); assert.throws(() => convertedCanvasTextCard(card("x"), "X.canvas"), /Markdown/);
});
test("The actual Board review lease refuses stale revisions, roots, selections, generations and disposed owners", () => {
  const file = { path: "Board.canvas", basename: "Board" }, model = new CanvasDocument(JSON.stringify(boardData())), leaf = { id: "board" }, app = { changingVault: false, vault: { rootPath: "A", getFileByPath: path => path === file.path ? file : null }, workspace: { isChangingFiles: false, getLeafById: id => id === leaf.id ? leaf : null }, core: { busy: false, isEnabled: () => true } };
  const board = Object.assign(Object.create(CanvasBoard.prototype), { document: model, loadedPath: file.path, loadedRoot: "A", view: { app, file, leaf, isLoaded: true, contentEl: { isConnected: true }, captureDraft() { return { provider: "core:canvas", state: this.draftState ?? "clean", path: file.path, root: app.vault.rootPath }; } }, selection: new Set(["a"]), revision: 0, generation: 0, disposed: false, drag: null }); leaf.view = board.view;
  for (const change of [() => { board.revision++; }, () => { board.generation++; }, () => { app.vault.rootPath = "B"; }, () => { board.selection.add("b"); }, () => { board.disposed = true; }]) { board.revision = board.generation = 0; app.vault.rootPath = "A"; board.selection = new Set(["a"]); board.disposed = false; const lease = board.reviewAuthority(); assert.equal(lease(), true); change(); assert.equal(lease(), false); }
  board.disposed = false; const lease = board.reviewAuthority(); app.workspace.isChangingFiles = true; assert.equal(lease(), false); assert.equal(lease(true), true); app.workspace.isChangingFiles = false; board.view.draftState = "busy"; assert.equal(lease(), false); board.view.draftState = "error"; assert.equal(lease(), false); board.view.draftState = "clean"; board.loadedPath = "Old.canvas"; assert.equal(lease(), false);
});
test("Actual conversion modal replaces its pre-creation instruction for confirmed, uncertain, refused and committed outcomes", async () => {
  for (const mode of ["confirmed", "uncertain", "refused", "converted", "late-committed-error"]) {
    const f = conversionFixture(), review = f.prepare();
    if (mode === "confirmed") f.state.afterAck = () => { throw Error("inventory failed"); };
    if (mode === "uncertain") f.state.beforeAck = () => { throw Error("response lost"); };
    if (mode === "refused") f.state.owner = false;
    if (mode === "late-committed-error") f.state.lateApplyError = true;
    const modal = Object.assign(Object.create(CanvasConvertModal.prototype), { review, busy: false, terminal: false, isOpen: true, action: { textContent: "Create note and replace card" }, stageIntro: { textContent: "The next action creates a note. Cancel writes nothing." }, status: { textContent: "" }, current: () => true, lock() {} });
    await modal.run(); assert.equal(modal.terminal, true); assert.doesNotMatch(modal.stageIntro.textContent, /next action|Cancel writes nothing/);
    if (mode === "confirmed") { assert.match(modal.stageIntro.textContent, /confirmed.*kept/); assert.equal(modal.action.textContent, "Note created"); }
    if (mode === "uncertain") { assert.match(modal.stageIntro.textContent, /may exist/); assert.equal(modal.action.textContent, "Creation unconfirmed"); }
    if (mode === "refused") { assert.match(modal.stageIntro.textContent, /not attempted/); assert.equal(modal.action.textContent, "Conversion refused"); }
    if (mode === "converted" || mode === "late-committed-error") { assert.match(modal.stageIntro.textContent, /replaced the text card.*Undo restores/); assert.equal(modal.action.textContent, "Card converted"); }
  }
});
