import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { MutationLock } from "../client/editor-barrier.ts";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, model;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "unresolved-heading-tests-"));
  const output = join(directory, "heading.mjs");
  await build({ stdin: { contents: 'export * from "./client/unresolved-heading-completion";export * from "./client/builtin-suggestion-model";export {parseMarkdown} from "./client/markdown";export {Editor} from "./client/editor";export {BuiltinEditorSuggestions} from "./client/builtin-suggestions";export {resolveLink} from "./client/links";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  model = await import(pathToFileURL(output).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/unresolved-heading-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
function marked(value) { const cursor = value.indexOf("¦"); assert.ok(cursor >= 0); const content = value.replace("¦", ""); return { content, cursor, trigger: model.builtinCompletionTrigger(content, cursor) }; }
function choice(value, target = "# Existing\r\n\r\nOriginal target λ 😀.\r\n", path = "Folder/Alpha.md", cache) { const x = marked(value); return x.trigger ? model.unresolvedHeadingCompletion(x.content, x.cursor, x.trigger, path, target, cache) : null; }
function plan(value, linktext = "Folder/Alpha", target) { const x = marked(value), item = choice(value, target); assert.ok(item); return { ...x, item, result: model.planUnresolvedHeadingCompletion(x.content, x.cursor, x.trigger, item, linktext) }; }

test("missing heading links retain their explicit known-target identity and typed Unicode chain", () => {
  const target = "# Existing\r\nOriginal target 😀.\r\n", cache = model.parseMarkdown(target), snapshot = JSON.stringify(cache);
  assert.deepEqual(choice("Before [[Alpha#Future section λ¦]] after", target, "Folder/Alpha.md", cache), { kind: "unresolved-heading", path: "Folder/Alpha.md", subpath: "Future section λ", heading: "Future section λ" });
  assert.equal(target, "# Existing\r\nOriginal target 😀.\r\n"); assert.equal(JSON.stringify(cache), snapshot);
});
test("addressable exact and normalized existing headings never become missing-heading choices", () => {
  for (const text of ["# Future section λ\n", "## **Future section λ**\n", "# Future section λ\n# Future section λ\n"]) assert.equal(choice("[[Alpha#Future section λ¦", text), null);
});
test("a currently offered fuzzy or literal existing heading has priority over unresolved text", () => {
  assert.equal(choice("[[Alpha#DsgOvr¦", "# Design overview\n"), null);
  assert.equal(choice("[[Alpha#overview¦", "# Design overview\n"), null);
});
test("unresolved hierarchical addresses preserve raw parent spelling without authoring any heading", () => {
  assert.deepEqual(choice("[[Alpha#**Parent λ**#Future section 😀¦", "# Parent λ\n## Existing child\n"), { kind: "unresolved-heading", path: "Folder/Alpha.md", subpath: "**Parent λ**#Future section 😀", heading: "Future section 😀", parents: ["**Parent λ**"] });
  assert.equal(choice("[[Alpha#Unknown parent#Future section¦", "# Existing\n").subpath, "Unknown parent#Future section");
});
test("hierarchical real destinations and literal-hash flat shadows decline the unresolved row", () => {
  assert.equal(choice("[[Alpha#Parent#Future section¦", "# Parent\n## Future section\n"), null);
  assert.equal(choice("[[Alpha#Parent#Future section¦", "# Parent#Future section\n# Parent\n## Other\n"), null);
  assert.equal(choice("[[Alpha#Parent#FtrSct¦", "# Parent\n## Future section\n"), null);
});
test("a child in an unrelated subtree does not pretend to resolve a missing hierarchical address", () => {
  assert.ok(choice("[[Alpha#Parent B#Future section¦", "# Parent A\n## Future section\n# Parent B\n## Other\n"));
});
test("empty, unsafe, block and global queries never offer unresolved heading links", () => {
  for (const input of ["[[Alpha#¦", "[[Alpha#   ¦", "[[Alpha#^future¦", "[[##Future section¦", "[[Alpha#Future|alias¦", "[[Alpha#Future\\x¦", "[[Alpha#Parent##Future¦", "[[Alpha#**¦"]) assert.equal(choice(input), null, input);
});
test("source comments, code, raw YAML and escaped wiki syntax stay outside the action", () => {
  for (const input of ["`[[Alpha#Future section¦`", "%% [[Alpha#Future section¦ %%", "\\[[Alpha#Future section¦", "```md\n[[Alpha#Future section¦\n```", "---\nvalue: [[Alpha#Future section¦\n---"]) assert.equal(choice(input), null, input);
});
test("only a complete typed prefix with no unreviewed heading tail can be accepted", () => {
  assert.equal(choice("[[Alpha#Future¦ remaining]]"), null);
  assert.equal(choice("[[Alpha#Future¦remaining]]"), null);
  assert.ok(choice("[[Alpha#Future section¦]]")); assert.ok(choice("[[Alpha#Future section¦\r\nOther"));
});
test("invalid paths and lone surrogates are refused while valid Unicode remains literal", () => {
  for (const path of ["", "Alpha.pdf", "/Alpha.md", "../Alpha.md", "A//Alpha.md", "A#B.md", "A|B.md", "A\uD800.md"]) assert.equal(choice("[[Alpha#Future section¦", undefined, path), null, path);
  assert.equal(choice("[[Alpha#Future\uD800¦"), null); assert.ok(choice("[[Alpha#Future 😀¦", undefined, "Folder/😀.md"));
});
test("complete source and heading inventory budgets refuse rather than authorize truncated absence", () => {
  assert.equal(choice("[[Alpha#Future section¦", "x".repeat(model.MAX_COMPLETION_SOURCE + 1)), null);
  assert.equal(choice("[[Alpha#Future section¦", Array.from({ length: model.MAX_COMPLETION_SUBPATHS + 1 }, (_, index) => "# Number " + index + "\n").join("")), null);
  assert.equal(choice("x".repeat(model.MAX_COMPLETION_SOURCE) + "[[Alpha#Future section¦"), null);
});
test("an incomplete or stale supplied cache cannot invent negative heading proof", () => {
  const empty = model.parseMarkdown(""), existing = model.parseMarkdown("# Future section\n");
  assert.equal(choice("[[Alpha#Future section¦", "# Future section\n", "Alpha.md", empty), null);
  assert.ok(choice("[[Alpha#Future section¦", "# Existing\n", "Alpha.md", existing));
});
test("a forged source-trigger snapshot is refused before constructing a choice", () => {
  const x = marked("[[Alpha#Parent#Future section¦");
  for (const mutation of [{ from: x.trigger.from + 1 }, { to: x.trigger.to + 1 }, { query: "Other" }, { linkpath: "Other" }, { headingParents: ["Other"] }, { kind: "block" }]) assert.equal(model.unresolvedHeadingCompletion(x.content, x.cursor, { ...x.trigger, ...mutation }, "Alpha.md", "# Existing\n"), null);
});
test("the planner preserves complete BOM/CRLF/Unicode surroundings and replaces an existing close token once", () => {
  const x = plan("\ufeff# Source Ω\r\n\r\nBefore [[Alias#Future section λ¦]] after 😀.\r\n", "../Folder/Alpha");
  assert.equal(x.result.text, "\ufeff# Source Ω\r\n\r\nBefore [[../Folder/Alpha#Future section λ]] after 😀.\r\n");
  assert.equal(x.result.cursor, x.result.from + x.result.insert.length); assert.equal(x.result.to, x.cursor + 2);
});
test("current-note links keep their empty path and explicit note/alias links need canonical nonempty text", () => {
  assert.equal(plan("[[#Future section¦", "").result.insert, "[[#Future section]]");
  assert.equal(plan("[[Alias#Parent#Future section¦", "Folder/Alpha").result.insert, "[[Folder/Alpha#Parent#Future section]]");
  const self = plan("[[#Future section¦", ""), named = plan("[[Alpha#Future section¦");
  assert.throws(() => model.planUnresolvedHeadingCompletion(self.content, self.cursor, self.trigger, self.item, "Alpha"), /safely/);
  assert.throws(() => model.planUnresolvedHeadingCompletion(named.content, named.cursor, named.trigger, named.item, ""), /safely/);
});
test("held plans refuse edited queries, cursors, whole-token bounds and hierarchical ownership", () => {
  const x = plan("Prefix [[Alpha#Parent#Future section¦]] suffix");
  for (const expected of [{ ...x.trigger, query: "Other" }, { ...x.trigger, from: x.trigger.from + 1 }, { ...x.trigger, to: x.trigger.to - 2 }, { ...x.trigger, headingParents: ["Other"] }]) assert.throws(() => model.planUnresolvedHeadingCompletion(x.content, x.cursor, expected, x.item, "Alpha"), /changed/);
  assert.throws(() => model.planUnresolvedHeadingCompletion(x.content.replace("Future section", "New section"), x.cursor - 3, x.trigger, x.item, "Alpha"), /changed/);
  assert.throws(() => model.planUnresolvedHeadingCompletion(x.content, x.cursor - 1, x.trigger, x.item, "Alpha"), /changed/);
});
test("held plans reject altered payloads and unsafe generated link spelling", () => {
  const x = plan("[[Alpha#Parent#Future section¦");
  for (const value of [{ ...x.item, kind: "heading" }, { ...x.item, subpath: "Other" }, { ...x.item, heading: "Other" }, { ...x.item, parents: ["Other"] }, { ...x.item, path: "A#B.md" }]) assert.throws(() => model.planUnresolvedHeadingCompletion(x.content, x.cursor, x.trigger, value, "Alpha"));
  for (const linktext of ["Alpha#Elsewhere", "Alpha|alias", "A\\B", "A\nB", "\uD800"]) assert.throws(() => model.planUnresolvedHeadingCompletion(x.content, x.cursor, x.trigger, x.item, linktext), /safely/);
});
test("actual Editor replacement has isolated exact Undo/Redo without any target mutation", () => {
  const source = "# Source Ω\r\n\r\nLinks: [[Alpha#Future section λ", x = plan(source + "¦"), target = "# Existing\r\n\r\nKept target 😀.\r\n";
  const editor = Object.create(model.Editor.prototype), cm = { state: EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of("\r\n"), history()] }), dispatch: spec => { cm.state = cm.state.update(spec).state; } }; editor.cm = cm;
  editor.replaceExpected(x.content, x.result.from, x.result.to, x.result.insert, "input.complete"); assert.equal(editor.getValue(), x.result.text);
  assert.equal(undo(cm), true); assert.equal(editor.getValue(), source); assert.equal(redo(cm), true); assert.equal(editor.getValue(), x.result.text); assert.equal(target, "# Existing\r\n\r\nKept target 😀.\r\n");
});

function providerFixture(text = "😀\r\n[[Alpha#Future section λ", targetText = "# Existing heading\r\n\r\nOriginal target text.\r\n") {
  const lock = new MutationLock(), state = EditorState.create({ doc: text, selection: { anchor: text.replaceAll("\r\n", "\n").length }, extensions: [history(), lock.extension(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(true)] });
  const cm = { state, hasFocus: true, dispatch: spec => { cm.state = (spec.startState ? spec : cm.state.update(spec)).state; } }, editor = Object.create(model.Editor.prototype); editor.cm = cm;
  const vault = { rootPath: "heading-fixture", readOnly: false, getFileByPath(path) { return files.find(file => file.path === path) ?? null; } }, source = { path: "Source.md", vault }, target = { path: "Folder/Alpha.md", vault }, files = [source, target], view = { editor, file: source };
  const documents = new Map([[source.path, { text, cache: model.parseMarkdown(text), missing: false }], [target.path, { text: targetText, cache: model.parseMarkdown(targetText), missing: false }]]);
  const app = { changingVault: false, vault, workspace: { activeEditor: view, isChangingFiles: false, sessions: new Map() }, metadataCache: { getDocument(path) { return documents.get(path); }, getFileCache(file) { return documents.get(file.path)?.cache; }, resolveReference(reference, path) { return model.resolveLink(files, reference.link, path); }, fileToLinktext(file) { return file.path.slice(0, -3); } } };
  const suggest = Object.create(model.BuiltinEditorSuggestions.prototype);
  const rebind = () => Object.assign(suggest, { app, origin: view, root: vault.rootPath, path: source.path, document: cm.state.doc, cursor: cm.state.selection.main.head, context: { editor, file: source, query: "Future section λ", start: { line: 1, ch: 0 }, end: editor.getCursor() } });
  rebind(); suggest.close = () => { suggest.context = null; };
  const choices = () => suggest.getSuggestions(suggest.context), choice = () => choices().find(value => value.kind === "unresolved-heading");
  return { app, vault, source, target, files, view, editor, cm, lock, documents, suggest, choices, choice, rebind, targetText };
}
test("the real provider inserts named/current-note missing links with isolated source-only Undo", () => {
  for (const source of ["😀\r\n[[Alpha#Future section λ", "# Current\r\n\r\n[[#Future section λ"]) {
    const x = providerFixture(source), beforeTarget = x.documents.get(x.target.path).text, values = x.choices(), item = values[0];
    assert.deepEqual(values.map(value => value.kind), ["unresolved-heading", "create-heading"]);
    assert.equal(item.subpath, "Future section λ"); assert.equal(values[1].subpath, item.subpath); assert.equal(values[1].path, item.path);
    const completed = source.includes("[[Alpha#") ? source.replace("[[Alpha#", "[[Folder/Alpha#") + "]]" : source + "]]";
    x.suggest.selectSuggestion(item); assert.equal(x.editor.getValue(), completed); assert.equal(x.documents.get(x.target.path).text, beforeTarget); assert.equal(x.files.length, 2);
    x.editor.undo(); assert.equal(x.editor.getValue(), source); x.editor.redo(); assert.equal(x.editor.getValue(), completed);
  }
});
test("the real provider refuses read-only triggering and direct missing-heading enumeration", () => {
  const x = providerFixture(); assert.ok(x.choice()); x.vault.readOnly = true;
  assert.equal(x.suggest.onTrigger(x.editor.getCursor(), x.editor, x.source), null); assert.deepEqual(x.choices(), []);
});
test("held real-provider choices preserve source across ownership, editability and target identity changes", () => {
  for (const mutate of [
    x => { x.vault.readOnly = true; }, x => { x.app.changingVault = true; }, x => { x.app.workspace.isChangingFiles = true; },
    x => { x.vault.rootPath = "other"; }, x => { x.app.workspace.activeEditor = null; }, x => { x.cm.hasFocus = false; }, x => { x.cm.composing = true; },
    x => { x.cm.dispatch({ effects: x.lock.set(true) }); }, x => { x.files[0] = { ...x.source }; }, x => { x.source.path = "Moved.md"; },
    x => { x.files[1] = { ...x.target }; }, x => { x.target.path = "Moved target.md"; },
    x => { x.documents.get(x.target.path).text += "New body\r\n"; }, x => { x.documents.get(x.target.path).text += "# Future section λ\r\n"; },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: "other", text: x.targetText, isReloading: false }); },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: x.vault.rootPath, text: x.targetText, isReloading: true }); },
  ]) {
    const x = providerFixture(), item = x.choice(), source = x.editor.getValue(); assert.ok(item); mutate(x); x.suggest.selectSuggestion(item); assert.equal(x.editor.getValue(), source); assert.equal(x.files.length, 2);
  }
});
test("the real provider proves absence against a dirty target session and refuses its later heading", () => {
  const x = providerFixture(), dirty = "# Dirty body\r\n\r\nUnsaved target Ω.\r\n";
  x.app.workspace.sessions.set(x.target.path, { originRoot: x.vault.rootPath, text: dirty, isReloading: false }); const item = x.choice(); assert.ok(item); assert.equal(item.targetText, dirty);
  x.app.workspace.sessions.get(x.target.path).text += "# Future section λ\r\n"; const before = x.editor.getValue(); x.suggest.selectSuggestion(item); assert.equal(x.editor.getValue(), before); assert.equal(x.documents.get(x.target.path).text, x.targetText);
});
test("a held missing-heading value cannot replace a newer query even when the provider has a new valid context", () => {
  const x = providerFixture(), item = x.choice(); assert.ok(item); const cursor = x.editor.getCursor(); x.editor.replaceRange("x", cursor); x.editor.setCursor(cursor.line,cursor.ch+1); x.rebind(); assert.ok(x.choice()); const before = x.editor.getValue();
  x.suggest.selectSuggestion(item); assert.equal(x.editor.getValue(), before); assert.equal(x.documents.get(x.target.path).text, x.targetText); assert.equal(x.files.length, 2);
});
