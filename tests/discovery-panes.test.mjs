import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseMarkdown } from "../client/markdown.ts";
import { root } from "./host.mjs";

let directory, tagsPaneState, tagNodes, footnotesPaneState, footnoteEntries, planFootnoteEdit, FootnotesPaneView, mergeSearchQuery;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "discovery-panes-tests-"));
  const outfile = join(directory, "models.cjs");
  await build({ stdin: { contents: 'export { tagsPaneState, tagNodes } from "./client/tags-pane-model"; export { footnotesPaneState, footnoteEntries } from "./client/footnotes-pane-model"; export { planFootnoteEdit } from "./client/footnote-edit"; export { mergeSearchQuery } from "./client/search-pane-model";', resolveDir: root }, outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ tagsPaneState, tagNodes, footnotesPaneState, footnoteEntries, planFootnoteEdit, mergeSearchQuery } = createRequire(import.meta.url)(outfile));
  const view = join(directory, "footnotes.cjs");
  await build({ entryPoints: [join(root, "client/footnotes-pane-view.ts")], outfile: view, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ FootnotesPaneView } = createRequire(import.meta.url)(view));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/discovery-panes-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const tags = (counts, state = {}) => tagNodes(counts, tagsPaneState(state));
const footnotes = text => footnoteEntries(parseMarkdown(text), text);

test("native Tags controls retain independent state with effective nested defaults and detached case-folded keys", () => {
  const input = { sortOrder: "alphabeticalReverse", useHierarchy: false, showSearch: true, searchQuery: "Work", foldedTags: ["#Work", "#work"], opaque: { keep: [1] } }, original = structuredClone(input), state = tagsPaneState(input);
  assert.deepEqual(input, original); assert.equal(state.sortOrder, "alphabeticalReverse"); assert.equal(state.useHierarchy, false); assert.deepEqual(state.foldedTags, ["#work"]); state.foldedTags.push("#other"); assert.deepEqual(input, original);
  assert.deepEqual(tagsPaneState({}), { sortOrder: "frequency", useHierarchy: true, showSearch: false, searchQuery: "", foldedTags: [] });
});
test("malformed tag controls, filters and fold limits reject before state can be applied", () => {
  for (const state of [{ sortOrder: "__proto__" }, { sortOrder: null }, { useHierarchy: 1 }, { showSearch: "true" }, { searchQuery: null }, { searchQuery: "x".repeat(1025) }, { foldedTags: null }, { foldedTags: ["work"] }, { foldedTags: ["#bad space"] }, { foldedTags: Array(4097).fill("#a") }, { foldedTags: ["#" + "x".repeat(8192)] }]) { assert.throws(() => tagsPaneState(state)); }
  assert.equal(tagsPaneState({ searchQuery: "<img src=x>" }).searchQuery, "<img src=x>");
});
test("tag hierarchy consumes indexed counts once, constructs missing ancestors and merges only case-equivalent identities", () => {
  const counts = { "#Work": 5, "#Work/Alpha": 2, "#work/alpha": 1, "#Work/Beta": 1, "#Separate/Child": 4 }, before = structuredClone(counts), result = tags(counts, { sortOrder: "alphabetical" });
  assert.deepEqual(counts, before); assert.deepEqual(result.map(node => [node.key, node.count, node.parent?.key ?? null, node.depth]), [
    ["#separate", 0, null, 1], ["#separate/child", 4, "#separate", 2], ["#work", 5, null, 1], ["#work/alpha", 3, "#work", 2], ["#work/beta", 1, "#work", 2],
  ]);
});
test("four tag sorts apply to every sibling level with stable alphabetical frequency ties", () => {
  const counts = { "#c": 2, "#a": 5, "#b": 2, "#a/second": 1, "#a/first": 3 }, names = sortOrder => tags(counts, { sortOrder, useHierarchy: false }).map(node => node.key);
  assert.deepEqual(names("frequency"), ["#a", "#a/first", "#b", "#c", "#a/second"]);
  assert.deepEqual(names("frequencyReverse"), ["#a/second", "#b", "#c", "#a/first", "#a"]);
  assert.deepEqual(names("alphabetical"), ["#a", "#a/first", "#a/second", "#b", "#c"]);
  assert.deepEqual(names("alphabeticalReverse"), ["#c", "#b", "#a/second", "#a/first", "#a"]);
  assert.deepEqual(tags(counts, { sortOrder: "frequency" }).map(node => node.key), ["#a", "#a/first", "#a/second", "#b", "#c"]);
});
test("literal tag filtering preserves matching ancestors without displaying unrelated descendants", () => {
  const counts = { "#Parent": 4, "#Parent/Child": 2, "#Parent/Other": 2, "#Separate": 1 };
  assert.deepEqual(tags(counts, { searchQuery: " CHILD " }).filter(node => node.visible).map(node => node.key), ["#parent", "#parent/child"]);
  assert.deepEqual(tags(counts, { useHierarchy: false, searchQuery: "CHILD" }).filter(node => node.visible).map(node => node.key), ["#parent/child"]);
  assert.deepEqual(tags(counts, { searchQuery: "missing" }).filter(node => node.visible), []);
});
test("invalid metadata names, counts and case-merge overflow do not produce navigable tag rows", () => {
  for (const counts of [{ bad: 1 }, { "#bad space": 1 }, { "#a": -1 }, { "#a": NaN }, { "#a": 1.5 }, { "#a": Number.MAX_SAFE_INTEGER, "#A": 1 }]) { assert.throws(() => tags(counts)); }
});
test("large tag inventories filter iteratively with distinct parent/child identities", () => {
  const counts = Object.fromEntries(Array.from({ length: 20000 }, (_, index) => ["#Root/Tag" + index, 1])), result = tags(counts, { searchQuery: "Tag19999" });
  assert.equal(result.length, 20001); assert.equal(new Set(result.map(node => node.key)).size, result.length); assert.deepEqual(result.filter(node => node.visible).map(node => node.key), ["#root", "#root/tag19999"]);
});
test("native modified Search fragments append or remove the first literal match without token rewriting", () => {
  assert.equal(mergeSearchQuery("  path:Work  ", "tag:#todo", true), "path:Work tag:#todo");
  assert.equal(mergeSearchQuery("tag:#todo tag:#todo", "tag:#todo", true), "tag:#todo");
  assert.equal(mergeSearchQuery("tag:#workbench", "tag:#work", true), "bench");
  assert.equal(mergeSearchQuery("old", "new", false), "new"); assert.equal(mergeSearchQuery("", "tag:#todo", true), "tag:#todo");
});
test("Footnotes targets retain native file state with an explicit independent follow option", () => {
  const input = { file: "Notes/\u03bb.md", followActiveFile: false, opaque: { keep: [true] } }, before = structuredClone(input);
  assert.deepEqual(footnotesPaneState(input), { file: "Notes/\u03bb.md", followActiveFile: false }); assert.deepEqual(input, before);
  assert.deepEqual(footnotesPaneState({}), { file: "", followActiveFile: true });
  for (const state of [{ file: null }, { followActiveFile: 0 }, ...["/a", "a//b", "../a", ".obsidian/workspace.json", "a\\b", "a\u0000b"].map(file => ({ file }))]) { assert.throws(() => footnotesPaneState(state)); }
});
test("defined footnotes order by first reference, with unreferenced definitions after used notes", () => {
  const text = "[^unused]: Unused first definition.\n\nSecond [^b], first [^a], repeat [^b].\n\n[^a]: A.\n[^b]: B.\n", cache = parseMarkdown(text), before = structuredClone(cache), result = footnoteEntries(cache, text);
  assert.deepEqual(result.map(item => [item.id, item.number, item.references.length]), [["b", 1, 2], ["a", 2, 1], ["unused", 3, 0]]);
  assert.deepEqual(structuredClone(cache), before); result[0].references[0].position.start.line = 999; assert.deepEqual(structuredClone(cache), before);
});
test("missing and duplicate footnotes remain explicit, individually positioned and outside valid-note numbering", () => {
  const text = "Missing [^gone], valid [^twice].\n\n[^twice]: First.\n[^twice]: Second.\n", result = footnotes(text);
  assert.deepEqual(result.map(item => [item.id, item.number, item.definitions.length]), [["twice", 1, 2], ["gone", null, 0]]);
  assert.deepEqual(result[0].definitions.map(definition => definition.labelPosition.start.line), [2, 3]);
  assert.equal(text.slice(result[1].references[0].position.start.offset, result[1].references[0].position.end.offset), "[^gone]");
});
test("multiline CRLF/Unicode footnotes preserve exact source targets while code and metadata stay excluded", () => {
  const text = "---\r\ntitle: '[^hidden]'\r\n---\r\nText \u03bb [^note]. `[^code]`\r\n\r\n[^note]: **Bold** first.\r\n    Continued \u4e2d\u6587.\r\n\r\n```\r\n[^literal]: Not a definition.\r\n```\r\n", result = footnotes(text);
  assert.equal(result.length, 1); assert.equal(result[0].id, "note"); assert.equal(result[0].definitions[0].content, "**Bold** first.\nContinued \u4e2d\u6587."); assert.equal(result[0].references.length, 1);
  for (const position of [result[0].definitions[0].labelPosition, result[0].references[0].position]) { assert.equal(text.slice(position.start.offset, position.end.offset), "[^note]"); }
});
test("invalid, stale and mismatched footnote positions refuse before navigation targets exist", () => {
  const text = "Text [^a].\n\n[^a]: Body.\n", original = parseMarkdown(text);
  for (const change of [
    cache => { cache.footnoteRefs[0].position.start.offset = -1; },
    cache => { cache.footnoteRefs[0].position.start.line = 10; },
    cache => { cache.footnotes[0].labelPosition.end.offset = text.length + 1; },
    cache => { cache.footnoteRefs[0].id = "other"; },
    cache => { cache.footnotes[0].id = "other"; },
  ]) { const cache = structuredClone(original); change(cache); assert.throws(() => footnoteEntries(cache, text)); }
  assert.throws(() => footnoteEntries(original, "Inserted\n" + text));
});
test("large repeated-reference inventories keep exact detached positions without recursive traversal", () => {
  const text = Array(10000).fill("[^many]").join(" ") + "\n\n[^many]: One note.\n", result = footnotes(text);
  assert.equal(result.length, 1); assert.equal(result[0].references.length, 10000);
  const last = result[0].references.at(-1).position; assert.equal(text.slice(last.start.offset, last.end.offset), "[^many]");
});

test("footnote editing preserves literal labels, prefix spacing, BOM, CRLF and every byte outside one definition", () => {
  const text = "\ufeff---\r\nprecise: 9007199254740993 # keep\r\n---\r\nReference [^a λ] and [^other].\r\n\r\n  [^a λ]:\tFirst.\r\n\tContinued 中文.\r\n\r\n[^other]: Unchanged **other**.\r\n";
  const definition = parseMarkdown(text).footnotes[0], before = structuredClone(definition), plan = planFootnoteEdit(text, definition, "**Edited**.\nNext λ.\n\nLast paragraph.", "\r\n");
  assert.equal(plan.text, text.replace("  [^a λ]:\tFirst.\r\n\tContinued 中文.", "  [^a λ]:\t**Edited**.\r\n\tNext λ.\r\n\t\r\n\tLast paragraph."));
  assert.equal(plan.text.slice(0, plan.from), text.slice(0, definition.position.start.offset));
  assert.equal(plan.text.slice(plan.from + plan.insert.length), text.slice(definition.position.end.offset));
  assert.deepEqual(definition, before);
  assert.deepEqual(parseMarkdown(plan.text).footnoteRefs.map(item => item.id), ["a λ", "other"]);
});
test("unchanged footnote drafts preserve mixed whitespace and line endings without a replacement", () => {
  const text = "[^a]:   First\r\n    Second\n\tThird\n", definition = parseMarkdown(text).footnotes[0];
  const plan = planFootnoteEdit(text, definition, "First\r\nSecond\rThird", "\r\n");
  assert.equal(plan.text, text); assert.equal(plan.insert, text.slice(plan.from, plan.to));
});
test("footnote edits can grow and shrink multiline bodies without consuming adjacent definitions or references", () => {
  const text = "Text [^a] [^b].\n\n[^a]: One\n    Two\n\n[^b]: Other\nAfter\n", definition = parseMarkdown(text).footnotes[0];
  for (const content of ["Short", "First\nSecond\n\nThird\n", "", "**Unicode λ 中文**"]) {
    const plan = planFootnoteEdit(text, definition, content, "\n"), cache = parseMarkdown(plan.text);
    assert.equal(cache.footnotes[0].content, content); assert.equal(cache.footnotes[1].content, "Other");
    assert.deepEqual(cache.footnoteRefs.map(item => item.id), ["a", "b"]); assert.ok(plan.text.endsWith("\n\n[^b]: Other\nAfter\n"));
  }
});
test("footnote editing retains existing continuation prefixes for unchanged and modified lines", () => {
  const text = "[^a]: One\n\tTwo\n    Three\n", definition = parseMarkdown(text).footnotes[0];
  assert.equal(planFootnoteEdit(text, definition, "Changed\nTwo\nFourth", "\n").text, "[^a]: Changed\n\tTwo\n    Fourth\n");
});
test("stale footnote content, positions and identities refuse before a replacement plan exists", () => {
  const text = "Reference [^a].\n\n[^a]: Current\n", original = parseMarkdown(text).footnotes[0];
  for (const change of [
    item => { item.id = "other"; }, item => { item.content = "Stale"; }, item => { item.inline = true; },
    item => { item.position.start.offset++; }, item => { item.position.end.line++; }, item => { item.labelPosition.start.ch++; },
  ]) { const definition = structuredClone(original); change(definition); assert.throws(() => planFootnoteEdit(text, definition, "New", "\n"), /changed|duplicate/); }
  assert.throws(() => planFootnoteEdit("Inserted\n" + text, original, "New", "\n"), /changed/);
});
test("duplicate, inline and missing definitions cannot be edited ambiguously", () => {
  const text = "[^a]: First\n[^a]: Second\n", definition = parseMarkdown(text).footnotes[0];
  assert.throws(() => planFootnoteEdit(text, definition, "New", "\n"), /duplicate/);
  assert.throws(() => planFootnoteEdit("No definition", definition, "New", "\n"), /changed/);
});
test("footnote edits refuse syntax that swallows other definitions or cannot round-trip the requested body", () => {
  const text = "[^a]: First\n\n[^b]: Other\n", definition = parseMarkdown(text).footnotes[0];
  for (const content of ["<!--", "  Leading spaces are part of this draft"]) { assert.throws(() => planFootnoteEdit(text, definition, content, "\n"), /parses/); }
  assert.throws(() => planFootnoteEdit(text, definition, "New", "\r"), /line ending/);
  assert.throws(() => planFootnoteEdit(text, definition, null, "\n"), /Markdown text/);
});

// Exercise the real pane's Apply method with recording editor/session boundaries; live CodeMirror/history is covered by the UI scenario.
function editFixture() {
  const path = "Note.md", text = "Text [^a].\n\n[^a]: First\n    Second\n", file = { path };
  const state = { text, current: true, live: true, changes: [], reads: 0, refreshed: 0 };
  const definition = parseMarkdown(text).footnotes[0], snapshot = { id: 1, path, file, text };
  const session = { originRoot: "fixture", document: { file: { path }, version: "v1" }, isReloading: false };
  const view = { file, session, isLoaded: true, isSaving: false, editor: {
    cm: { state: { lineBreak: "\n" } }, getValue: () => state.text,
    replaceExpected(expected, from, to, insert, origin) { assert.equal(state.text, expected); state.changes.push({ from, to, insert, origin }); state.text = state.text.slice(0, from) + insert + state.text.slice(to); },
  } };
  const files = new Map([[path, file]]), app = {
    vault: { rootPath: "fixture", readOnly: false, getFileByPath: path => files.get(path), readDocument: async () => { state.reads++; return { version: "v1" }; } },
    workspace: { sessions: new Map([[path, session]]) }, metadataCache: { updateOpenDocuments() { state.refreshed++; } },
  };
  const owner = { app, sourceRoot: "fixture", snapshot, file, interactive: () => state.live && app.vault.rootPath === "fixture", source: () => view, schedule() {}, noteView: null };
  return { state, owner, app, view, session, snapshot, files, file, apply: (content = "Changed\nNext") => FootnotesPaneView.prototype.applyDefinition.call(owner, snapshot, definition, content, () => state.current) };
}
test("Footnotes Apply commits one isolated source-editor replacement after a version read and refreshes metadata", async () => {
  const fixture = editFixture(); await fixture.apply();
  assert.equal(fixture.state.text, "Text [^a].\n\n[^a]: Changed\n    Next\n");
  assert.equal(fixture.state.reads, 1); assert.equal(fixture.state.changes.length, 1); assert.equal(fixture.state.changes[0].origin, "input.footnote");
  assert.equal(fixture.state.refreshed, 1); assert.equal(fixture.owner.noteView, fixture.view);
});
test("unchanged Footnotes Apply validates ownership/version without creating a history transaction", async () => {
  const fixture = editFixture(); await fixture.apply("First\nSecond");
  assert.equal(fixture.state.reads, 1); assert.deepEqual(fixture.state.changes, []); assert.equal(fixture.state.refreshed, 0);
});
test("read-only, closed, replaced and busy Footnotes sources refuse before a version read or editor transaction", async () => {
  for (const mutate of [
    fixture => { fixture.app.vault.readOnly = true; }, fixture => { fixture.state.current = false; },
    fixture => { fixture.state.live = false; }, fixture => { fixture.app.vault.rootPath = "other"; },
    fixture => { fixture.owner.snapshot = null; }, fixture => { fixture.files.set("Note.md", { path: "Note.md" }); },
    fixture => { fixture.view.isLoaded = false; }, fixture => { fixture.app.workspace.sessions.clear(); },
    fixture => { fixture.view.isSaving = true; }, fixture => { fixture.session.isReloading = true; },
  ]) {
    const fixture = editFixture(); mutate(fixture); await assert.rejects(fixture.apply(), /changed|saving|reloading/);
    assert.equal(fixture.state.reads, 0); assert.deepEqual(fixture.state.changes, []);
  }
});
test("cancellation, owner/root/file/session changes, edits and new save/reload operations while reading cannot apply a stale footnote", async () => {
  for (const mutate of [
    fixture => { fixture.state.current = false; }, fixture => { fixture.owner.snapshot = { ...fixture.snapshot, id: 2 }; },
    fixture => { fixture.app.vault.rootPath = "other"; }, fixture => { fixture.files.delete("Note.md"); },
    fixture => { fixture.view.session = { ...fixture.session }; }, fixture => { fixture.session.originRoot = "other"; },
    fixture => { fixture.session.document.version = "newer"; }, fixture => { fixture.state.text += "Other edit"; },
    fixture => { fixture.view.isSaving = true; }, fixture => { fixture.session.isReloading = true; },
  ]) {
    const fixture = editFixture(), arrived = Promise.withResolvers(), release = Promise.withResolvers();
    fixture.app.vault.readDocument = async () => { arrived.resolve(); await release.promise; return { version: "v1" }; };
    const applying = fixture.apply(); await arrived.promise; mutate(fixture); release.resolve();
    await assert.rejects(applying, /changed|saving|reloading/); assert.deepEqual(fixture.state.changes, []); assert.equal(fixture.state.refreshed, 0);
  }
});
test("unobserved disk replacements and editor transaction refusal retain the draft without metadata acknowledgement", async () => {
  const external = editFixture(); external.app.vault.readDocument = async () => ({ version: "external" });
  await assert.rejects(external.apply(), /changed/); assert.deepEqual(external.state.changes, []);
  const blocked = editFixture(); blocked.view.editor.replaceExpected = () => {};
  await assert.rejects(blocked.apply(), /did not accept/); assert.equal(blocked.state.refreshed, 0); assert.equal(blocked.state.text, blocked.snapshot.text);
});
