import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, StateField } from "@codemirror/state";
import { foldedRanges, foldEffect, foldService, language, StreamLanguage, unfoldAll } from "@codemirror/language";
import { history, redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "editor-folding-tests-"));
  const outfile = join(directory, "folding.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-folding"; export { markdownSupport } from "./client/editor-language"; export { Editor } from "./client/editor";', resolveDir: root, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/editor-folding-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

const source = '---\r\nopaque: [ kept ]\r\n---\r\n# Heading λ\r\nBody 😀.\r\n## Child\r\nChild body.\r\n\r\n- Parent\r\n  - Child item\r\n    - Grandchild\r\n\r\n```md\r\n# Not a heading\r\n- Not a list\r\nkept\r\n```\r\n\r\nLast heading\r\n============\r\nLast body.\r\n';
function fixture(preferences = {}, text = source, extra = []) {
  const compartment = new Compartment(), plugin = StateField.define({ create: () => ({ retained: true }), update: value => value });
  const view = { state: EditorState.create({ doc: text, selection: EditorSelection.single(0), extensions: [EditorState.lineSeparator.of("\r\n"), feature.markdownSupport, feature.editorFolding, feature.markdownStreamFolding, plugin, compartment.of(feature.editorFoldingPreferences.of({ foldHeading: true, foldIndent: true, ...preferences })), ...extra] }),
    dispatch(spec) { this.lastTransaction = this.state.update(spec); this.state = this.lastTransaction.state; }, lineBlockAt(offset) { return this.state.doc.lineAt(offset); } };
  view.dispatch = view.dispatch.bind(view);
  const line = prefix => { for (let index = 1; index <= view.state.doc.lines; index++) { const current = view.state.doc.line(index); if (current.text === prefix) { return current; } } throw Error("Missing fixture line " + prefix); };
  const range = prefix => { const current = line(prefix); return feature.availableEditorFold(view.state, current.from, current.to); };
  const folds = () => { const result = []; foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => result.push({ from, to, kind: feature.editorFoldKind(view.state, from) })); return result; };
  const configure = values => view.dispatch({ effects: compartment.reconfigure(feature.editorFoldingPreferences.of({ foldHeading: true, foldIndent: true, ...values })) });
  return { view, compartment, plugin, line, range, folds, configure };
}

test("Markdown classification separates ATX/setext headings, nested list items, code text and opaque frontmatter", () => {
  const f = fixture();
  for (const value of ["# Heading λ", "## Child", "Last heading"]) assert.equal(feature.editorFoldKind(f.view.state, f.line(value).to), "heading");
  for (const value of ["- Parent", "  - Child item"]) assert.equal(feature.editorFoldKind(f.view.state, f.line(value).to), "list");
  for (const value of ["opaque: [ kept ]", "```md", "# Not a heading", "- Not a list"]) assert.equal(feature.editorFoldKind(f.view.state, f.line(value).to), "other");
  assert.equal(feature.editorFoldKind(f.view.state, -1), "unknown");
});

test("default heading/list/code ranges remain available and independent", () => {
  const f = fixture();
  for (const value of ["# Heading λ", "- Parent", "```md"]) { const range = f.range(value); assert.ok(range && range.to > range.from); }
  assert.equal(f.range("# Not a heading"), null);
  assert.equal(f.range("- Not a list"), null);
});

test("disabling headings expands only heading folds and hides their available ranges", () => {
  const f = fixture(), ranges = [f.range("# Heading λ"), f.range("- Parent"), f.range("```md")];
  f.view.dispatch({ effects: ranges.map(range => foldEffect.of(range)) }); assert.equal(f.folds().length, 3);
  f.configure({ foldHeading: false });
  assert.deepEqual(f.folds().map(value => value.kind), ["list", "other"]);
  assert.equal(f.range("# Heading λ"), null); assert.ok(f.range("- Parent")); assert.ok(f.range("```md"));
  assert.equal(f.view.state.sliceDoc(), source);
});

test("disabling lists retains heading and code folds; restoring the setting does not silently recollapse", () => {
  const f = fixture();
  f.view.dispatch({ effects: ["# Heading λ", "- Parent", "```md"].map(value => foldEffect.of(f.range(value))) });
  f.configure({ foldIndent: false }); assert.deepEqual(f.folds().map(value => value.kind), ["heading", "other"]); assert.equal(f.range("- Parent"), null);
  f.configure({}); assert.deepEqual(f.folds().map(value => value.kind), ["heading", "other"]); assert.ok(f.range("- Parent"));
});

test("foldAll and direct fold effects refuse disabled kinds while code folding still works", () => {
  const f = fixture({ foldHeading: false, foldIndent: false });
  feature.foldAllEditor(f.view); assert.ok(f.folds().length >= 1); assert.ok(f.folds().every(value => value.kind === "other"));
  const heading = f.line("# Heading λ"), list = f.line("- Parent");
  f.view.dispatch({ effects: [foldEffect.of({ from: heading.to, to: list.from - 1 }), foldEffect.of({ from: list.to, to: f.line("    - Grandchild").to })] });
  assert.ok(f.folds().length >= 1); assert.ok(f.folds().every(value => value.kind === "other"));
  unfoldAll(f.view); assert.deepEqual(f.folds(), []); assert.equal(f.view.state.sliceDoc(), source);
});

test("filtered fold effects retain arbitrary plugin annotations, selection and document changes", () => {
  const marker = Annotation.define(), retained = { owner: "plugin" }, f = fixture({ foldHeading: false });
  const heading = f.line("# Heading λ"), beforePlugin = f.view.state.field(f.plugin);
  const transaction = f.view.state.update({ changes: { from: f.view.state.doc.length, insert: "tail" }, selection: EditorSelection.single(0), effects: foldEffect.of({ from: heading.to, to: f.line("Body 😀.").to }), annotations: marker.of(retained), scrollIntoView: true });
  assert.equal(transaction.annotation(marker), retained); assert.equal(transaction.scrollIntoView, true); assert.equal(transaction.newSelection.main.head, 0);
  f.view.state = transaction.state; assert.equal(f.view.state.field(f.plugin), beforePlugin); assert.equal(f.view.state.sliceDoc(), source + "tail"); assert.deepEqual(f.folds(), []);
});

test("actual Editor snapshot restore obeys current settings without source or history changes", () => {
  const f = fixture(), api = Object.create(feature.Editor.prototype); Object.assign(api, { cm: f.view });
  f.view.dispatch({ effects: ["# Heading λ", "- Parent", "```md"].map(value => foldEffect.of(f.range(value))) });
  const snapshot = api.getFoldInfo(); assert.equal(snapshot.folds.length, 3);
  f.configure({ foldHeading: false, foldIndent: false }); api.applyFoldInfo(snapshot);
  assert.deepEqual(f.folds().map(value => value.kind), ["other"]); assert.equal(f.view.state.sliceDoc(), source);
  api.applyFoldInfo(null); assert.deepEqual(f.folds(), []);
  assert.throws(() => api.applyFoldInfo({ lines: 2, folds: [{ from: -1, to: 1 }] }), /valid line ranges/);
});

test("a stream-language plugin retains Markdown fold classification and preference guards", () => {
  const stream = StreamLanguage.define({ token(stream) { stream.skipToEnd(); return "comment"; } });
  const f = fixture({ foldHeading: false }, source, [Prec.highest(stream)]);
  assert.equal(f.view.state.facet(language), stream);
  assert.equal(f.range("# Heading λ"), null); assert.ok(f.range("- Parent")); assert.ok(f.range("```md"));
  f.configure({ foldHeading: false, foldIndent: false }); feature.foldAllEditor(f.view); assert.ok(f.folds().length >= 1); assert.ok(f.folds().every(value => value.kind === "other"));
});

test("oversized Markdown declines classification with disabled preferences instead of misclassifying partial syntax", () => {
  const text = "# Heading\r\n" + "body\r\n".repeat(220_000), f = fixture({ foldHeading: false }, text);
  assert.ok(f.view.state.doc.length > feature.MAX_FOLDING_DOCUMENT);
  assert.equal(feature.editorFoldKind(f.view.state, f.line("# Heading").to), "unknown");
  assert.equal(feature.availableEditorFold(f.view.state, 0, f.line("# Heading").to), null);
  assert.equal(f.view.state.sliceDoc(), text);
});

test("changing fold settings preserves prior dirty CRLF Undo/Redo and retained plugin state", () => {
  const f = fixture({}, source, [history()]), beforePlugin = f.view.state.field(f.plugin);
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "typed" }, userEvent: "input.type" });
  const document = f.view.state.doc, selection = f.view.state.selection;
  f.view.dispatch({ effects: foldEffect.of(f.range("# Heading λ")) });
  f.configure({ foldHeading: false, foldIndent: false });
  assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection); assert.equal(f.view.state.field(f.plugin), beforePlugin);
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), source);
  assert.equal(redo(f.view), true); assert.equal(f.view.state.sliceDoc(), source + "typed");
});

test("a plugin's ordinary prose fold remains available when heading/list controls are disabled", () => {
  const service = foldService.of((state, start, end) => state.doc.lineAt(start).text === "Body 😀." ? { from: end, to: state.doc.lineAt(start).to + 1 } : null);
  const f = fixture({ foldHeading: false, foldIndent: false }, source, [service]), range = f.range("Body 😀.");
  assert.ok(range); f.view.dispatch({ effects: foldEffect.of(range) });
  assert.deepEqual(f.folds().map(value => value.kind), ["other"]); f.configure({ foldHeading: true, foldIndent: false });
  assert.deepEqual(f.folds().map(value => value.kind), ["other"]); assert.equal(f.view.state.sliceDoc(), source);
});

test("the filtered fold-code command preserves CodeMirror's localized public announcement effect", () => {
  const f = fixture({ foldHeading: false }), range = f.range("```md");
  f.view.dispatch({ selection: EditorSelection.single(f.line("```md").from) });
  assert.equal(feature.foldEditorCode(f.view), true);
  const announcements = f.view.lastTransaction.effects.filter(effect => effect.is(EditorView.announce));
  assert.deepEqual(announcements.map(effect => effect.value), [`Folded lines ${f.view.state.doc.lineAt(range.from).number} to ${f.view.state.doc.lineAt(range.to).number}.`]);
  f.view.dispatch({ selection: EditorSelection.single(f.line("# Heading λ").from) });
  assert.equal(feature.foldEditorCode(f.view), false);
});

test("restored secondary selections reveal their folds while preserving independent code, source and Undo", () => {
  const f = fixture({}, source, [history(), EditorState.allowMultipleSelections.of(true)]), api = Object.create(feature.Editor.prototype);
  Object.assign(api, { cm: f.view });
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "typed" } });
  f.view.dispatch({ effects: ["# Heading λ", "- Parent", "```md"].map(value => foldEffect.of(f.range(value))) });
  f.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(f.line("Body 😀.").from), EditorSelection.range(f.line("  - Child item").from, f.line("    - Grandchild").to)], 0) });
  assert.equal(f.folds().length, 3, "CodeMirror automatically reveals only the main selection head");
  const document = f.view.state.doc, selection = f.view.state.selection, plugin = f.view.state.field(f.plugin);
  api.revealFoldedSelections();
  assert.deepEqual(f.folds().map(value => value.kind), ["other"]);
  assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection); assert.equal(f.view.state.field(f.plugin), plugin);
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), source);
  assert.equal(redo(f.view), true); assert.equal(f.view.state.sliceDoc(), source + "typed");
});
