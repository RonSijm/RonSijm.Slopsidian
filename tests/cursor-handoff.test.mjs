import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { history, isolateHistory, redo, redoSelection, undo, undoSelection } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, Editor, MarkdownView, readingSelectionGuard;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "cursor-handoff-tests-"));
  const output = join(directory, "handoff.mjs");
  await build({ stdin: { contents: 'export { Editor, readingSelectionGuard } from "./client/editor"; export { MarkdownView } from "./client/workspace";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  ({ Editor, MarkdownView, readingSelectionGuard } = await import(pathToFileURL(output).href));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/cursor-handoff-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

function editorFixture(mode = "source") {
  const owner = { mode, getMode() { return this.mode; }, app: { vault: { readOnly: false } } }, api = Object.create(Editor.prototype);
  const nodes = new Set([{}]), selection = { anchorNode: [...nodes][0], focusNode: [...nodes][0], removals: 0,
    removeAllRanges() { this.anchorNode = this.focusNode = null; this.removals++; } };
  let focused = true, blurCount = 0;
  const document = { getSelection() { return selection; } }, contentDOM = { ownerDocument: document, contains(node) { return nodes.has(node); }, blur() { focused = false; blurCount++; } };
  const cm = { state: EditorState.create({ doc: "first λ\r\nsecond 😀\r\nlast\r\n", extensions: [EditorState.lineSeparator.of("\r\n"), history(), readingSelectionGuard(() => owner.getMode() === "preview" && !(api.selectionIntentDepth > 0))] }), contentDOM,
    get hasFocus() { return focused; }, dispatch(spec) { this.state = spec?.startState ? spec.state : this.state.update(spec).state; }, focus() { focused = true; } };
  cm.dispatch = cm.dispatch.bind(cm); Object.assign(api, { cm, owner });
  return { api, cm, owner, selection, nodes, document, blurCount: () => blurCount, setFocus(value) { focused = value; } };
}

test("Reading rejects late browser select transactions but explicit API selection and Source/Live Preview remain available", () => {
  const f = editorFixture(); f.api.setCursor({ line: 1, ch: 2 });
  f.cm.dispatch({ selection: { anchor: f.cm.state.doc.length }, userEvent: "select.pointer" }); assert.equal(f.api.getCursor().line, 3);
  f.owner.mode = "preview"; f.api.setCursor({ line: 1, ch: 2 });
  for (const event of ["select", "select.pointer", "select.keyboard"]) {
    f.cm.dispatch({ selection: { anchor: f.cm.state.doc.length }, userEvent: event }); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 }, event);
  }
  f.cm.dispatch({ selection: { anchor: 1 }, userEvent: "select.search" }); assert.deepEqual(f.api.getCursor(), { line: 0, ch: 1 }, "explicit find navigation remains available");
  f.api.setCursor(2); assert.deepEqual(f.api.getCursor(), { line: 2, ch: 0 });
  f.owner.mode = "source"; f.cm.dispatch({ selection: { anchor: 0 }, userEvent: "select.pointer" }); assert.deepEqual(f.api.getCursor(), { line: 0, ch: 0 });
  f.owner.app.vault.readOnly = true; f.cm.dispatch({ selection: { anchor: 2 }, userEvent: "select.keyboard" }); assert.equal(f.api.getCursor().ch, 2, "read-only Source still permits selection/navigation");
});

test("installed CodeMirror selection Undo/Redo and facade commands preserve deliberate selection intent in Reading", () => {
  const f = editorFixture();
  for (const [anchor, time] of [[2, 1000], [8, 2000], [14, 3000]]) {
    f.cm.dispatch({ selection: { anchor }, userEvent: "select.pointer", annotations: Transaction.time.of(time) });
  }
  f.owner.mode = "preview";
  assert.equal(undoSelection(f.cm), true); assert.equal(f.cm.state.selection.main.head, 8);
  assert.equal(redoSelection(f.cm), true); assert.equal(f.cm.state.selection.main.head, 14);
  f.api.exec("goStart"); assert.equal(f.cm.state.selection.main.head, 0, "facade command builds its own intentional select transaction");
  f.api.transaction({ selection: { from: { line: 1, ch: 2 } } }, "select.pointer");
  assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 }, "an explicitly originated plugin transaction remains intentional");
  f.cm.dispatch({ selection: { anchor: 0 }, userEvent: "select.pointer" }); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 }, "intent scope ends before later native selection callbacks");
  const originalDispatch = f.cm.dispatch; f.cm.dispatch = () => { throw new Error("dispatch failed"); };
  assert.throws(() => f.api.exec("goStart"), /dispatch failed/); f.cm.dispatch = originalDispatch;
  assert.equal(f.api.selectionIntentDepth, 0, "failed commands cannot leave browser selection imports enabled");
  f.cm.dispatch({ selection: { anchor: 0 }, userEvent: "select" }); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 });
});

test("programmatic document updates and existing Undo/Redo history survive the hidden-selection boundary", () => {
  const f = editorFixture(), original = f.api.getValue();
  f.cm.dispatch({ changes: { from: 0, insert: "Edited " }, annotations: isolateHistory.of("full"), userEvent: "input.type" });
  const edited = f.api.getValue(), doc = f.cm.state.doc;
  f.owner.mode = "preview"; f.api.setCursor(1); const expected = f.cm.state.selection;
  f.cm.dispatch({ selection: { anchor: f.cm.state.doc.length }, userEvent: "select" });
  assert.equal(f.cm.state.doc, doc); assert.ok(f.cm.state.selection.eq(expected));
  assert.equal(undo(f.cm), true); assert.equal(f.api.getValue(), original);
  assert.equal(redo(f.cm), true); assert.equal(f.api.getValue(), edited);
  f.cm.dispatch({ changes: { from: 0, insert: "API " }, userEvent: "input.plugin" }); assert.equal(f.api.getValue(), "API " + edited);
});

test("Reading releases only Source-owned native selection and focus without changing document, multi-selection or history", () => {
  const f = editorFixture(); f.api.setSelections([{ anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 4 } }, { anchor: { line: 1, ch: 2 } }], 1, false);
  const doc = f.cm.state.doc, selection = f.cm.state.selection;
  f.api.releaseReadingSelection(); assert.equal(f.selection.removals, 1); assert.equal(f.blurCount(), 1);
  assert.equal(f.cm.state.doc, doc); assert.ok(f.cm.state.selection.eq(selection));
  f.selection.anchorNode = f.selection.focusNode = {}; f.setFocus(false); f.api.releaseReadingSelection();
  assert.equal(f.selection.removals, 1, "an unrelated Reading/control selection is retained"); assert.equal(f.blurCount(), 1);
});

function markdownFixture() {
  const f = editorFixture(), view = Object.create(MarkdownView.prototype), callbacks = new Map(), cancelled = [], listeners = new Map(); let next = 1;
  const window = { requestAnimationFrame(callback) { const id = next++; callbacks.set(id, time => { callbacks.delete(id); callback(time); }); return id; }, cancelAnimationFrame(id) { cancelled.push(id); callbacks.delete(id); } };
  const document = { defaultView: window };
  const contentEl = { ownerDocument: document, scrollTop: 0, addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); } };
  const revealed = [], file = { path: "Note.md" };
  Object.assign(view, { mode: "source", sourceEditing: true, file, app: { vault: { rootPath: "root:one" }, changingVault: false, async pluginsChanged() {} },
    editor: f.api, contentEl, scrollCleanup: null, reading: { render() {}, revealLine(line) { revealed.push(line); contentEl.scrollTop = line * 20; }, focus() {}, closeSearch() {} },
    leaf: { updateHeader() {}, workspace: { layoutChanged() {}, notifyEditor() {} } }, dismissMenus() {} });
  Object.defineProperty(view, "isLoaded", { value: true, writable: true });
  f.owner.getMode = () => view.mode; f.api.setEditable = () => {}; f.api.closeSearch = () => {};
  return { ...f, view, contentEl, callbacks, cancelled, listeners, revealed, window, document };
}

test("actual Markdown mode handoff releases stale native Source ranges and preserves ordinary selection/document", () => {
  const f = markdownFixture(); f.api.setCursor({ line: 1, ch: 2 }); const doc = f.cm.state.doc;
  f.view.setMode("preview"); assert.equal(f.selection.removals, 1); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 });
  f.cm.dispatch({ selection: { anchor: f.cm.state.doc.length }, userEvent: "select" }); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 });
  f.view.setMode("source"); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 2 }); assert.equal(f.cm.state.doc, doc);
});

test("explicit Reading reveal wins over a pending scroll restore and later native selection, including Source handback", () => {
  const f = markdownFixture(); f.view.setMode("preview");
  f.view.restoreScroll(300); const oldFrame = [...f.callbacks.values()][0]; assert.equal(f.contentEl.scrollTop, 300);
  f.view.revealLine(1); assert.deepEqual(f.revealed, [1]); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 0 }); assert.equal(f.contentEl.scrollTop, 20);
  oldFrame(); assert.equal(f.contentEl.scrollTop, 20, "even a retained cancelled callback cannot restore stale scroll");
  f.cm.dispatch({ selection: { anchor: f.cm.state.doc.length }, userEvent: "select.pointer" }); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 0 });
  f.view.setMode("source"); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 0 });
});

test("scroll restore is owned by exact file/root/mode/document and loaded lifetime", () => {
  for (const mutate of [f => { f.view.file = { path: "Note.md" }; }, f => { f.view.app.vault.rootPath = "root:two"; }, f => { f.view.mode = "preview"; }, f => { f.contentEl.ownerDocument = { defaultView: f.window }; }, f => { f.view.isLoaded = false; }]) {
    const f = markdownFixture(); f.view.restoreScroll(300); const callback = [...f.callbacks.values()][0]; mutate(f); f.contentEl.scrollTop = 17; callback();
    assert.equal(f.contentEl.scrollTop, 17); assert.equal(f.callbacks.size, 0); assert.equal(f.listeners.size, 0);
  }
});

test("a superseded scroll callback cannot cancel or mutate the newer restore", () => {
  const f = markdownFixture(); f.view.restoreScroll(300); const old = [...f.callbacks.values()][0];
  f.view.restoreScroll(120); const [newId, newer] = [...f.callbacks.entries()][0];
  f.contentEl.scrollTop = 17; old(); assert.equal(f.contentEl.scrollTop, 17); assert.ok(f.callbacks.has(newId));
  newer(); assert.equal(f.contentEl.scrollTop, 120);
});

test("mode changes and document moves cancel an old restore without resetting Source caret/history", () => {
  const f = markdownFixture(); f.api.setCursor({ line: 1, ch: 3 }); f.view.restoreScroll(300); const old = [...f.callbacks.values()][0];
  f.view.setMode("preview"); f.contentEl.scrollTop = 14; old(); assert.equal(f.contentEl.scrollTop, 14); assert.deepEqual(f.api.getCursor(), { line: 1, ch: 3 });
  f.view.restoreScroll(300); const moved = [...f.callbacks.values()][0]; let adopted;
  f.api.moveToDocument = doc => { adopted = doc; }; const document = {};
  f.view.onWindowMoved(document); f.contentEl.scrollTop = 19; moved(); assert.equal(f.contentEl.scrollTop, 19); assert.equal(adopted, document);
});
