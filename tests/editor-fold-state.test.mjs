import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorSelection, EditorState, Prec, StateField, Transaction } from "@codemirror/state";
import { foldEffect, foldService, forceParsing, StreamLanguage, syntaxTree, unfoldEffect } from "@codemirror/language";
import { history, redo, undo } from "@codemirror/commands";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "editor-fold-state-tests-"));
  const outfile = join(directory, "fold-state.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-fold-state"; export * from "./client/editor-folding"; export { markdownSupport } from "./client/editor-language";', resolveDir: root, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/editor-fold-state-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

const source = '---\r\nopaque: [ kept ]\r\n---\r\n# Root λ\r\nProse 😀.\r\n\r\n## Child\r\nChild body.\r\n\r\n- Parent\r\n  - Child item\r\n    - Grandchild\r\n\r\n```js\r\nfunction keep() {\r\n  return "λ 😀";\r\n}\r\n```\r\n\r\n## Last\r\nLast body.\r\n';
function fixture(text = source, preferences = {}, extra = []) {
  const compartment = new Compartment(), plugin = StateField.define({ create: () => ({ retained: true }), update: value => value });
  let controller;
  const updates = [], view = { state: EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of("\r\n"), EditorState.allowMultipleSelections.of(true), feature.markdownSupport,
    feature.editorFolding, feature.markdownStreamFolding, history(), plugin, compartment.of(feature.editorFoldingPreferences.of({ foldHeading: true, foldIndent: true, ...preferences })), ...extra] }),
    dispatch(spec) {
      const startState = this.state, transaction = spec.state ? spec : this.state.update(spec);
      this.state = transaction.state;
      const update = { startState, state: this.state, transactions: [transaction], docChanged: transaction.docChanged };
      updates.push(update); controller?.update(update);
    } };
  view.dispatch = view.dispatch.bind(view);
  const line = value => { for (let i = 1; i <= view.state.doc.lines; i++) { const line = view.state.doc.line(i); if (line.text === value) return line; } throw Error("Missing " + value); };
  const range = value => { const found = line(value); return feature.availableEditorFold(view.state, found.from, found.to); };
  const folds = () => feature.captureEditorFoldState(view.state);
  const fold = value => view.dispatch({ effects: foldEffect.of(range(value)) });
  const configure = values => view.dispatch({ effects: compartment.reconfigure(feature.editorFoldingPreferences.of({ foldHeading: true, foldIndent: true, ...values })) });
  return { view, updates, plugin, line, range, folds, fold, configure, connect(port, current = () => true) { controller = new feature.EditorFoldState(view, port, current); return controller; } };
}
function memoryPort() {
  const values = new Map(), loads = [], writes = [];
  return { values, loads, writes, load(path, text) { loads.push({ path, text }); return values.get(JSON.stringify([path, text])) ?? null; },
    save(path, text, value) { const detached = structuredClone(value); writes.push({ path, text, value: detached }); values.set(JSON.stringify([path, text]), detached); return true; } };
}
const selected = ["## Child", "- Parent", "```js"];

test("exact offset snapshots preserve nested Markdown/list/code folds without line stretching", () => {
  const original = fixture(); for (const value of selected) original.fold(value);
  const saved = original.folds(), restored = fixture();
  assert.equal(saved.length, 3); assert.equal(feature.restoreEditorFoldState(restored.view, saved), true);
  assert.deepEqual(restored.folds(), saved); assert.equal(restored.view.state.sliceDoc(), source);
  const changedEnd = saved.map((range, index) => index ? range : { ...range, to: range.to + 1 });
  const safe = fixture(); feature.restoreEditorFoldState(safe.view, changedEnd);
  assert.deepEqual(safe.folds(), saved.slice(1), "a forged end cannot extend the parser's current fold");
});

test("passive restoration retains document, all selections, plugin state and prior Undo/Redo", () => {
  const f = fixture(); f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "typed" }, selection: EditorSelection.single(0) });
  const before = f.view.state, saved = selected.map(value => f.range(value));
  assert.equal(feature.restoreEditorFoldState(f.view, saved), true);
  assert.equal(f.view.state.doc, before.doc); assert.equal(f.view.state.selection, before.selection); assert.equal(f.view.state.field(f.plugin), before.field(f.plugin));
  assert.equal(f.updates.at(-1).transactions[0].annotation(Transaction.addToHistory), false);
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), source);
  assert.equal(redo(f.view), true); assert.equal(f.view.state.sliceDoc(), source + "typed");
});

test("one bounded parser pass restores folds beyond a fresh editor's initial viewport", () => {
  const text = '# Intro\r\n\r\n' + 'Bounded paragraph λ.\r\n\r\n'.repeat(500) + '## Far heading\r\nFar body.\r\n\r\n- Far parent\r\n  - Far child\r\n\r\n```js\r\nconst far = true;\r\n```\r\n\r\n## Final\r\nLast.\r\n';
  const f = fixture(text); assert.equal(forceParsing(f.view, f.view.state.doc.length, 100), true);
  for (const value of ["## Far heading", "- Far parent", "```js"]) f.fold(value);
  const fresh = fixture(text), document = fresh.view.state.doc, plugin = fresh.view.state.field(fresh.plugin);
  assert.ok(syntaxTree(fresh.view.state).length < document.length, "the fresh syntax tree is initially incomplete");
  assert.equal(feature.restoreEditorFoldState(fresh.view, f.folds()), true); assert.deepEqual(fresh.folds(), f.folds());
  assert.equal(fresh.view.state.doc, document); assert.equal(fresh.view.state.field(fresh.plugin), plugin); assert.equal(fresh.view.state.sliceDoc(), text);
});

test("every selected range remains visible, including secondary carets and spanning selections", () => {
  const f = fixture(), ranges = selected.map(value => f.range(value));
  f.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(f.line("Child body.").from), EditorSelection.range(f.line("  - Child item").from, f.line("    - Grandchild").to)], 1) });
  const selection = f.view.state.selection;
  assert.equal(feature.restoreEditorFoldState(f.view, ranges), true);
  assert.deepEqual(f.folds(), [ranges[2]]); assert.equal(f.view.state.selection, selection);
  const boundary = fixture(); boundary.view.dispatch({ selection: EditorSelection.cursor(boundary.range("## Child").from) });
  assert.equal(feature.restoreEditorFoldState(boundary.view, [boundary.range("## Child")]), true, "a visible opening-line boundary is allowed");
});

test("current heading/list preferences filter restoration while fenced code stays independent", () => {
  const original = fixture(); for (const value of selected) original.fold(value);
  const f = fixture(source, { foldHeading: false, foldIndent: false });
  feature.restoreEditorFoldState(f.view, original.folds()); assert.deepEqual(f.folds(), [f.range("```js")]);
  f.configure({}); assert.deepEqual(f.folds(), [f.range("```js")], "reenabling a preference does not restore folds again");
});

test("a retained stream-language plugin still validates persisted Markdown folds and preference guards", () => {
  const stream = StreamLanguage.define({ token(stream) { stream.skipToEnd(); return "comment"; } });
  const f = fixture(source, {}, [Prec.highest(stream)]), saved = selected.map(value => f.range(value));
  const g = fixture(source, { foldHeading: false }, [Prec.highest(stream)]);
  feature.restoreEditorFoldState(g.view, saved); assert.deepEqual(g.folds(), saved.slice(1));
  assert.equal(g.view.state.sliceDoc(), source);
});

test("ordinary plugin folds restore only while the same current fold service supplies exact bounds", () => {
  const service = foldService.of((state, start, end) => state.doc.lineAt(start).text === "Prose 😀." ? { from: end, to: end + 1 } : null);
  const f = fixture(source, { foldHeading: false, foldIndent: false }, [service]); f.fold("Prose 😀.");
  const g = fixture(source, {}, [service]); assert.equal(feature.restoreEditorFoldState(g.view, f.folds()), true);
  const absent = fixture(); assert.equal(feature.restoreEditorFoldState(absent.view, f.folds()), false); assert.deepEqual(absent.folds(), []);
});

test("malformed, duplicate, crossing and oversized data cannot alter a live editor", () => {
  const f = fixture(), range = f.range("## Child"), before = f.view.state;
  for (const value of [null, {}, [null], [{ from: -1, to: 3 }], [{ from: 1.5, to: 3 }], [{ from: 3, to: 3 }], [{ from: 3, to: f.view.state.doc.length + 1 }], [range, range], [{ from: 1, to: 10 }, { from: 4, to: 14 }], Array(feature.MAX_EDITOR_SAVED_FOLDS + 1).fill(range)]) {
    assert.equal(feature.restoreEditorFoldState(f.view, value), false); assert.equal(f.view.state, before);
  }
  const large = fixture("x".repeat(feature.MAX_FOLDING_DOCUMENT + 1));
  assert.equal(feature.captureEditorFoldState(large.view.state), null); assert.equal(feature.restoreEditorFoldState(large.view, []), false);
});

test("capture refuses too many live plugin folds and returns detached validated data", () => {
  const f = fixture("x\r\n".repeat(600)), effects = [];
  for (let line = 1; line <= feature.MAX_EDITOR_SAVED_FOLDS + 1; line++) { const from = f.view.state.doc.line(line).from; effects.push(foldEffect.of({ from, to: from + 1 })); }
  f.view.dispatch({ effects }); assert.equal(feature.captureEditorFoldState(f.view.state), null);
  const valid = fixture(); valid.fold("## Child"); const captured = valid.folds(); captured[0].to++;
  assert.notDeepEqual(valid.folds(), captured); assert.equal(valid.view.state.sliceDoc(), source);
});

test("binding restores once without writing, then user expansion persists explicit empty state", () => {
  const port = memoryPort(), original = fixture(); original.fold("## Child"); port.save("Note.md", source, original.folds()); port.writes.length = 0;
  const f = fixture(), controller = f.connect(port);
  assert.equal(controller.bind("Note.md", source), true); assert.equal(port.writes.length, 0); assert.deepEqual(f.folds(), original.folds());
  f.view.dispatch({ selection: EditorSelection.single(0) }); assert.equal(port.writes.length, 0);
  f.view.dispatch({ effects: unfoldEffect.of(f.folds()[0]) }); assert.deepEqual(port.writes.at(-1), { path: "Note.md", text: source, value: [] });
  controller.detach(); assert.equal(port.writes.length, 1);
  const reopened = fixture(); assert.equal(reopened.connect(port).bind("Note.md", source), false); assert.deepEqual(reopened.folds(), []);
});

test("dirty edits update the exact source proof and cannot restore into the unchanged disk text", () => {
  const port = memoryPort(), f = fixture(), controller = f.connect(port); controller.bind("Note.md", source);
  f.view.dispatch({ changes: { from: f.line("Prose 😀.").from, insert: "Dirty " } }); assert.equal(port.writes.length, 0);
  f.fold("## Child"); assert.equal(port.writes.at(-1).text, f.view.state.sliceDoc()); assert.notEqual(port.writes.at(-1).text, source);
  const reopened = fixture(); assert.equal(reopened.connect(port).bind("Note.md", source), false);
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "tail" } }); assert.equal(port.writes.at(-1).text, f.view.state.sliceDoc());
  assert.equal(undo(f.view), true); assert.equal(port.writes.at(-1).text, f.view.state.sliceDoc());
});

test("preference-off expansions persist remaining code and enabling does not recollapse old folds", () => {
  const port = memoryPort(), f = fixture(), controller = f.connect(port); controller.bind("Note.md", source);
  for (const value of selected) f.fold(value); f.configure({ foldHeading: false, foldIndent: false });
  assert.deepEqual(port.writes.at(-1).value, [f.range("```js")]);
  const writes = port.writes.length; f.configure({}); assert.equal(port.writes.length, writes + 1); assert.deepEqual(f.folds(), [f.range("```js")]);
});

test("retained in-memory state is bound without replacing its folds or loading persistent state", () => {
  const port = memoryPort(), f = fixture(); f.fold("- Parent"); port.save("Note.md", source, [f.range("## Child")]);
  const before = f.view.state, controller = f.connect(port); assert.equal(controller.bind("Note.md", source, false), false);
  assert.equal(port.loads.length, 0); assert.equal(f.view.state, before); assert.deepEqual(f.folds(), [f.range("- Parent")]);
  f.fold("```js"); assert.deepEqual(port.writes.at(-1).value, f.folds());
});

test("two same-file panes keep independent folds and the last user action wins without idle teardown writes", () => {
  const port = memoryPort(), a = fixture(), b = fixture(), ca = a.connect(port), cb = b.connect(port);
  ca.bind("Note.md", source); cb.bind("Note.md", source); a.fold("## Child"); assert.deepEqual(b.folds(), []);
  b.fold("- Parent"); const last = port.writes.at(-1); ca.detach(); cb.detach(); assert.equal(port.writes.at(-1), last);
  const reopened = fixture(); reopened.connect(port).bind("Note.md", source); assert.deepEqual(reopened.folds(), b.folds());
});

test("peer text synchronization refreshes the bound document without capturing an idle pane", () => {
  const port = memoryPort(), f = fixture(), controller = f.connect(port); controller.bind("Note.md", source);
  const original = f.view.state;
  f.view.state = original.update({ changes: { from: original.doc.length, insert: "peer text" } }).state;
  controller.synchronize(f.view.state.sliceDoc()); assert.equal(port.writes.length, 0); assert.equal(port.loads.length, 1);
  f.fold("## Child"); assert.equal(port.writes.at(-1).text, source + "peer text");
  assert.deepEqual(port.writes.at(-1).value, f.folds());
});

test("hidden preference and document updates stay silent and the next visible user fold still persists", () => {
  const port = memoryPort(), f = fixture(); let visible = true;
  const controller = f.connect(port, () => visible); controller.bind("Note.md", source); f.fold("## Child");
  const initial = port.writes.at(-1), reads = port.loads.length;
  visible = false; f.configure({ foldHeading: false }); f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "hidden peer text" } });
  f.view.state = f.view.state.update({ changes: { from: f.view.state.doc.length, insert: " synchronized" } }).state;
  controller.synchronize(f.view.state.sliceDoc()); assert.equal(port.writes.length, 1); assert.equal(port.writes.at(-1), initial); assert.equal(port.loads.length, reads);
  visible = true; f.fold("- Parent"); assert.equal(port.writes.length, 2); assert.deepEqual(port.writes.at(-1).value, [f.range("- Parent")]);
  assert.equal(port.writes.at(-1).text, source + "hidden peer text synchronized");
});

test("wrong text/path, obsolete owners, detached views and replaced documents never write", () => {
  const port = memoryPort(), f = fixture(); let active = "Note.md";
  const controller = f.connect(port, path => path === active);
  assert.equal(controller.bind("Other.md", source), false); assert.equal(controller.bind("Note.md", source.replace("Prose", "Other")), false); assert.equal(port.loads.length, 0);
  controller.bind("Note.md", source); active = "Other.md"; f.fold("## Child"); assert.equal(port.writes.length, 0);
  controller.detach(); active = "Note.md"; f.fold("- Parent"); assert.equal(port.writes.length, 0, "the parent's retired binding cannot resume after a file or root switch");
  controller.bind("Note.md", source, false); f.view.state = EditorState.create({ doc: source, extensions: [feature.markdownSupport, feature.editorFolding] });
  f.fold("## Child"); assert.equal(port.writes.length, 0, "setState requires a fresh owner binding");
});

test("corrupt local values and failing load/save adapters remain nonfatal to editing and history", () => {
  for (const port of [{ load() { throw Error("storage unavailable"); }, save() { throw Error("quota"); } }, { load() { return [{ from: -1, to: 5 }]; }, save() { return false; } }]) {
    const f = fixture(), controller = f.connect(port); assert.doesNotThrow(() => controller.bind("Note.md", source));
    assert.doesNotThrow(() => f.fold("## Child")); f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "typed" } });
    assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), source); assert.equal(redo(f.view), true); assert.equal(f.view.state.sliceDoc(), source + "typed");
  }
});
