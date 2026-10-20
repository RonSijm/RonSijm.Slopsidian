import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { getSearchQuery, openSearchPanel, searchKeymap, SearchQuery, setSearchQuery } from "@codemirror/search";
import { MutationLock } from "../client/editor-barrier.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, search;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "editor-search-tests-"));
  const output = join(directory, "search.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-search"; export { HotkeyManager } from "./client/hotkeys"; export { BUILTIN_HOTKEYS } from "./client/builtin-hotkeys";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  search = await import(pathToFileURL(output).href);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/editor-search-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

function fixture(text, { separator = "\n", editable = true, managed = false } = {}) {
  const events = [], lock = new MutationLock(), editableCompartment = new Compartment();
  const view = {
    state: EditorState.create({ doc: text, extensions: [EditorState.allowMultipleSelections.of(true), EditorState.lineSeparator.of(separator), history(), lock.extension(), editableCompartment.of(EditorView.editable.of(editable)), search.editorSearch(undefined, { managed }), keymap.of(searchKeymap)] }),
    dom: { querySelector() { return null; } },
    root: { activeElement: null },
    plugin() { return null; },
    dispatch(spec) { const transaction = spec.startState ? spec : this.state.update(spec); this.state = transaction.state; events.push(transaction); },
  };
  view.dispatch = view.dispatch.bind(view);
  return {
    view, events, lock,
    query(config) { view.dispatch({ effects: setSearchQuery.of(new SearchQuery(config)) }); },
    text() { return view.state.sliceDoc(); },
    select(from, to = from) { view.dispatch({ selection: EditorSelection.single(from, to) }); },
    selectMany(ranges, main = 0) { view.dispatch({ selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to ?? from)), main) }); },
    editable(value) { view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(value)) }); },
  };
}

test("find next/previous wrap with Unicode selections and case/whole-word query options", () => {
  const f = fixture("😀 Alpha alphabet ALPHA\nalpha");
  f.query({ search: "alpha", wholeWord: true });
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.sliceDoc(f.view.state.selection.main.from, f.view.state.selection.main.to), "Alpha");
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, 18);
  assert.equal(search.findPrevious(f.view), true); assert.equal(f.view.state.selection.main.from, 3);
  assert.equal(search.findPrevious(f.view), true); assert.equal(f.view.state.selection.main.from, 24);
  f.query({ search: "alpha", caseSensitive: true, wholeWord: true });
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, 24);
  assert.equal(f.text(), "😀 Alpha alphabet ALPHA\nalpha");
});

test("replace next first selects a match and then replaces only the selected match", () => {
  const f = fixture("start one and one"); f.query({ search: "one", replace: "longer" });
  assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), "start one and one"); assert.equal(f.view.state.selection.main.from, 6);
  assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), "start longer and one");
  assert.equal(f.view.state.sliceDoc(f.view.state.selection.main.from, f.view.state.selection.main.to), "one");
  assert.equal(undo(f.view), true); assert.equal(f.text(), "start one and one");
  assert.equal(redo(f.view), true); assert.equal(f.text(), "start longer and one");
});

test("replace all uses actual regex capture/dollar semantics and destination CRLF for inserted newlines", () => {
  const f = fixture("😀 item=12\r\nitem=34\r\n", { separator: "\r\n" });
  f.query({ search: "item=(\\d\\d)", regexp: true, replace: "$1 $$ $&\\nnext" });
  assert.equal(search.replaceEditorMatch(f.view, true), true);
  assert.equal(f.text(), "😀 12 $ item=12\r\nnext\r\n34 $ item=34\r\nnext\r\n");
  assert.equal(f.view.state.doc.lines, 5);
  assert.equal(f.events.filter(event => event.docChanged).length, 1);
  assert.equal(f.events.at(-1).annotation(Transaction.userEvent), "input.replace.all");
  assert.equal(undo(f.view), true); assert.equal(f.text(), "😀 item=12\r\nitem=34\r\n");
  assert.equal(redo(f.view), true); assert.equal(f.view.state.doc.lines, 5);
});

test("replace next remaps its next selection after normalizing mixed replacement line separators", () => {
  const f = fixture("word word", { separator: "\n" }); f.query({ search: "word", replace: "one\\r\\ntwo" }); f.select(0, 4);
  assert.equal(search.replaceEditorMatch(f.view), true);
  assert.equal(f.text(), "one\ntwo word");
  assert.equal(f.view.state.sliceDoc(f.view.state.selection.main.from, f.view.state.selection.main.to), "word");
  assert.equal(f.view.state.selection.main.from, 8);
});

test("literal replacements preserve backslashes while escaped queries support multiline matching", () => {
  const f = fixture("first\r\nsecond\r\nkeep", { separator: "\r\n" });
  f.query({ search: "first\\nsecond", replace: "C:\\notes\\file", literal: false });
  assert.equal(search.replaceEditorMatch(f.view, true), true);
  // The documented escape grammar treats \n as a newline; literal mode keeps paths literal.
  assert.equal(f.text(), "C:\r\notes\\file\r\nkeep");
  const literal = fixture("target"); literal.query({ search: "target", replace: "C:\\notes\\file", literal: true });
  assert.equal(search.replaceEditorMatch(literal.view, true), true); assert.equal(literal.text(), "C:\\notes\\file");
});

test("replacement batches stay isolated from prior and subsequent typing history", () => {
  const f = fixture("one one");
  f.view.dispatch({ changes: { from: 0, insert: "typed " }, userEvent: "input.type" });
  f.query({ search: "one", replace: "two" }); search.replaceEditorMatch(f.view, true);
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "!" }, userEvent: "input.type" });
  assert.equal(undo(f.view), true); assert.equal(f.text(), "typed two two");
  assert.equal(undo(f.view), true); assert.equal(f.text(), "typed one one");
  assert.equal(undo(f.view), true); assert.equal(f.text(), "one one");
});

test("read-only, inactive policy and mutation locks refuse replacement without destroying query/history", () => {
  const f = fixture("one one"); f.query({ search: "one", replace: "two" });
  assert.equal(search.replaceEditorMatch(f.view, true, () => false), false);
  f.editable(false); assert.equal(search.replaceEditorMatch(f.view, true), false);
  f.editable(true); f.view.dispatch({ effects: f.lock.set(true) });
  assert.equal(search.replaceEditorMatch(f.view, true), false); assert.equal(f.text(), "one one");
  assert.equal(search.findNext(f.view), true); assert.equal(getSearchQuery(f.view.state).search, "one");
  f.view.dispatch({ effects: f.lock.set(false) });
  assert.equal(search.replaceEditorMatch(f.view, true), true); assert.equal(f.text(), "two two");
  assert.equal(undo(f.view), true); assert.equal(f.text(), "one one");
});

test("invalid/empty expressions and excessive replace-all batches leave source and history unchanged", () => {
  const f = fixture("keep"); f.query({ search: "[", regexp: true, replace: "bad" });
  assert.equal(search.replaceEditorMatch(f.view, true), false);
  f.query({ search: "", replace: "bad" }); assert.equal(search.replaceEditorMatch(f.view), false); assert.equal(f.text(), "keep");
  const many = fixture("x".repeat(search.MAX_REPLACE_MATCHES + 1)); many.query({ search: "x", replace: "y" });
  assert.equal(search.replaceEditorMatch(many.view, true), false); assert.equal(many.events.filter(event => event.docChanged).length, 0);
});

test("CodeMirror's imprecise normalization matches cannot destructively replace part of a character", () => {
  const f = fixture("é e"); f.query({ search: "e", replace: "x" });
  assert.equal(search.replaceEditorMatch(f.view, true), true); assert.equal(f.text(), "é x");
});

function matches(f) {
  const cursor = getSearchQuery(f.view.state).getCursor(f.view.state), found = [];
  for (let result = cursor.next(); !result.done; result = cursor.next()) { found.push({ from: result.value.from, to: result.value.to }); }
  return found;
}

test("one reversed source selection bounds native matches and wrapped next/previous independently of navigation selections", () => {
  const source = "outside alpha\nalpha middle alpha\noutside alpha", f = fixture(source);
  const from = source.indexOf("alpha middle"), to = from + "alpha middle alpha".length;
  f.select(to, from); assert.equal(search.captureSearchSelection(f.view), true);
  f.query({ search: "alpha" });
  assert.deepEqual(matches(f), [{ from, to: from + 5 }, { from: to - 5, to }]);
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, from);
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, to - 5);
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, from);
  assert.equal(search.findPrevious(f.view), true); assert.equal(f.view.state.selection.main.from, to - 5);
  assert.deepEqual(search.searchSelectionScope(f.view.state), { from, to, enabled: true, stale: false });
  f.select(0, 7); assert.equal(matches(f).length, 2, "a new editor selection does not silently recapture the search range");
  assert.equal(search.setSearchSelectionEnabled(f.view, false), true); assert.equal(matches(f).length, 4);
  assert.equal(search.setSearchSelectionEnabled(f.view, true), true); assert.equal(matches(f).length, 2);
});

test("scoped Replace all retains both outside matches and BOM/CRLF while its bounds and isolated history follow normalized replacements", () => {
  const source = "\ufeffalpha\r\n😀 alpha alpha\r\nalpha\r\n", f = fixture(source, { separator: "\r\n" });
  const normalized = f.view.state.doc.toString(), from = normalized.indexOf("😀"), to = normalized.indexOf("\nalpha", from);
  f.select(from, to); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "beta\\r\\nline" });
  const oldScope = search.searchSelectionScope(f.view.state);
  assert.equal(search.replaceEditorMatch(f.view, true), true);
  assert.equal(f.text(), "\ufeffalpha\r\n😀 beta\r\nline beta\r\nline\r\nalpha\r\n");
  const replacedScope = search.searchSelectionScope(f.view.state);
  assert.equal(replacedScope.from, from); assert.equal(replacedScope.to - from, "😀 beta\nline beta\nline".length); assert.equal(replacedScope.stale, false);
  assert.equal(f.events.filter(event => event.docChanged).length, 1);
  assert.equal(undo(f.view), true); assert.equal(f.text(), source); assert.deepEqual(search.searchSelectionScope(f.view.state), oldScope);
  assert.equal(redo(f.view), true); assert.deepEqual(search.searchSelectionScope(f.view.state), replacedScope);
  f.query({ search: "alpha", replace: "outside must remain" }); assert.equal(search.replaceEditorMatch(f.view, true), false);
});

test("scoped Replace next selects an in-range match before editing and never replaces a selected outside match", () => {
  const source = "alpha\nalpha alpha\nalpha", f = fixture(source);
  f.select(6, 17); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "longer" });
  f.select(0, 5);
  assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), source); assert.equal(f.view.state.selection.main.from, 6);
  assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), "alpha\nlonger alpha\nalpha");
  assert.deepEqual(search.searchSelectionScope(f.view.state), { from: 6, to: 18, enabled: true, stale: false });
  assert.equal(f.view.state.selection.main.from, 13);
  assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), "alpha\nlonger longer\nalpha");
  assert.equal(f.text().startsWith("alpha\n") && f.text().endsWith("\nalpha"), true);
});

test("matches crossing either selected boundary are excluded and regex anchors retain their actual document meaning", () => {
  const f = fixture("alpha alpha alpha\nalpha");
  f.select(2, 14); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "x" });
  assert.deepEqual(matches(f), [{ from: 6, to: 11 }]);
  f.query({ search: "^alpha", regexp: true, replace: "x" }); assert.deepEqual(matches(f), []);
  f.query({ search: "alpha$", regexp: true, replace: "x" }); assert.deepEqual(matches(f), []);
  f.query({ search: "alpha", replace: "x" }); search.replaceEditorMatch(f.view, true);
  assert.equal(f.text(), "alpha x alpha\nalpha");
});

test("outside edits map the source scope while an intersecting source edit invalidates it and Undo restores its exact earlier identity", () => {
  const f = fixture("before\nalpha alpha\nafter");
  f.select(7, 18); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "x" });
  f.view.dispatch({ changes: { from: 0, insert: "prefix " }, userEvent: "input.type" });
  assert.deepEqual(search.searchSelectionScope(f.view.state), { from: 14, to: 25, enabled: true, stale: false });
  assert.equal(matches(f).length, 2);
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: " suffix" }, userEvent: "input.type" });
  const beforeEdit = f.text(), previousScope = search.searchSelectionScope(f.view.state);
  f.view.dispatch({ changes: { from: 16, insert: "edited" }, userEvent: "input.type", annotations: isolateHistory.of("full") });
  assert.equal(search.searchSelectionScope(f.view.state).stale, true);
  assert.equal(getSearchQuery(f.view.state).valid, false); assert.match(getSearchQuery(f.view.state).validationMessage, /selected source changed/);
  const changed = f.text(); assert.equal(matches(f).length, 0);
  assert.equal(search.replaceEditorMatch(f.view, true), false); assert.equal(f.text(), changed);
  assert.equal(undo(f.view), true); assert.equal(f.text(), beforeEdit); assert.deepEqual(search.searchSelectionScope(f.view.state), previousScope);
  assert.equal(matches(f).length, 2);
  assert.equal(redo(f.view), true); assert.equal(search.searchSelectionScope(f.view.state).stale, true);
  assert.equal(search.setSearchSelectionEnabled(f.view, true), false);
  assert.equal(search.setSearchSelectionEnabled(f.view, false), true); assert.equal(getSearchQuery(f.view.state).valid, true);
});

test("deleting an entire scoped range prevents a hidden empty scope and one Undo restores the selectable source", () => {
  const f = fixture("keep alpha keep"); f.select(5, 10); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "" });
  assert.equal(search.replaceEditorMatch(f.view, true), true); assert.equal(f.text(), "keep  keep");
  assert.equal(search.searchSelectionScope(f.view.state).stale, true); assert.equal(search.replaceEditorMatch(f.view), false);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "keep alpha keep"); assert.equal(matches(f).length, 1);
});

test("an explicit recapture recovers invalidated search; empty carets refuse and multiple selections form an explicit union", () => {
  const f = fixture("alpha alpha\nalpha");
  assert.equal(search.captureSearchSelection(f.view), false); assert.equal(search.setSearchSelectionEnabled(f.view, true), false);
  f.select(0, 11); search.captureSearchSelection(f.view); f.query({ search: "alpha" });
  f.view.dispatch({ changes: { from: 2, insert: "x" } }); assert.equal(search.searchSelectionScope(f.view.state).stale, true);
  f.select(13, 18); assert.equal(search.captureSearchSelection(f.view), true); assert.equal(matches(f).length, 1);
  const scope = search.searchSelectionScope(f.view.state);
  f.select(0); assert.equal(search.captureSearchSelection(f.view), false); assert.deepEqual(search.searchSelectionScope(f.view.state), scope);
  const multi = EditorState.create({ doc: "alpha alpha", extensions: [EditorState.allowMultipleSelections.of(true), search.editorSearch()], selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(6, 11)]) });
  f.view.state = multi; assert.equal(search.captureSearchSelection(f.view), true);
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 0, to: 5 }, { from: 6, to: 11 }]);
});

test("scoped matching retains custom filters, fixed-width regex refusal and read-only/composition/mutation policies", () => {
  const f = fixture("alpha\nalpha alpha\nalpha"); f.select(6, 17); search.captureSearchSelection(f.view);
  f.query({ search: "alpha", replace: "x", test: (_match, _state, from) => from === 12 });
  assert.deepEqual(matches(f), [{ from: 12, to: 17 }]);
  f.editable(false); assert.equal(search.replaceEditorMatch(f.view, true), false); assert.equal(search.findNext(f.view), true);
  f.editable(true); f.view.composing = true; assert.equal(search.replaceEditorMatch(f.view, true), false);
  f.view.composing = false; f.view.dispatch({ effects: f.lock.set(true) }); assert.equal(search.replaceEditorMatch(f.view, true), false);
  f.view.dispatch({ effects: f.lock.set(false) });
  f.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "a+", regexp: true, replace: "bad" })), filter: false });
  assert.equal(getSearchQuery(f.view.state).valid, false); assert.equal(search.replaceEditorMatch(f.view, true), false);
  f.query({ search: "(a)(lpha)", regexp: true, replace: "$2$1" }); assert.equal(matches(f).length, 2);
  search.replaceEditorMatch(f.view, true); assert.equal(f.text(), "alpha\nlphaa lphaa\nalpha");
});

test("closing Find revokes historical scopes so Undo/Redo cannot silently restore a hidden source restriction", () => {
  const f = fixture("alpha alpha\nalpha"); openSearchPanel(f.view);
  f.select(0, 11); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "x" });
  search.replaceEditorMatch(f.view, true); assert.equal(matches(f).length, 0);
  assert.equal(search.closeSearchPanel(f.view), true); assert.equal(search.searchSelectionScope(f.view.state), null);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "alpha alpha\nalpha");
  assert.equal(search.searchSelectionScope(f.view.state), null); assert.equal(matches(f).length, 3);
  assert.equal(redo(f.view), true); assert.equal(search.searchSelectionScope(f.view.state), null); assert.equal(matches(f).length, 1);
});

test("Undo keeps an explicit newer capture and checkbox choice instead of restoring a previous search scope", () => {
  const f = fixture("alpha alpha\nalpha"); f.select(0, 11); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "x" });
  search.replaceEditorMatch(f.view, true); assert.equal(f.text(), "x x\nalpha");
  f.select(4, 9); search.captureSearchSelection(f.view); assert.equal(matches(f).length, 1);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "alpha alpha\nalpha");
  assert.deepEqual(search.searchSelectionScope(f.view.state), { from: 12, to: 17, enabled: true, stale: false });
  assert.deepEqual(matches(f), [{ from: 12, to: 17 }]);
  assert.equal(redo(f.view), true); assert.deepEqual(search.searchSelectionScope(f.view.state), { from: 4, to: 9, enabled: true, stale: false });
  search.setSearchSelectionEnabled(f.view, false); assert.equal(undo(f.view), true);
  assert.equal(search.searchSelectionScope(f.view.state).enabled, false); assert.equal(matches(f).length, 3);
});

test("fixed-width regex accepts useful captures/classes/anchors while rejecting every branching/repetition form", () => {
  for (const pattern of ["^(a+)+$", "a*", "a?", "a{2}", "a|b", "(?=a)", "(?!a)", "(?<=a)", "(a)\\1", "(?<word>a)\\k<word>", "\\p{L}"]) {
    assert.match(search.regexSearchValidation(pattern), /Fixed-width/, pattern);
  }
  for (const pattern of ["^item=(\\d\\d)$", "([A-Z])([a-z])", "a.b", "\\bword\\b", "[+*?{}|]", "\\+\\*\\?\\{", "λ\\u0061\\x62"]) {
    assert.equal(search.regexSearchValidation(pattern), null, pattern);
  }
  assert.match(search.regexSearchValidation("["), /Invalid/);
  assert.match(search.regexSearchValidation("a".repeat(search.MAX_REGEX_SOURCE + 1)), /up to/);
});

test("unsafe regex effects never reach native matching, including filter:false updates, without executing the reproduced pattern", () => {
  const f = fixture("a".repeat(40) + "!"), pattern = "^(a+)+$", originalExec = RegExp.prototype.exec;
  let executions = 0;
  RegExp.prototype.exec = function (...args) {
    if (this.source === pattern) { executions++; throw new Error("Unsafe expression reached execution"); }
    return originalExec.apply(this, args);
  };
  try {
    f.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: pattern, regexp: true, replace: "bad" })), filter: false });
    const guarded = getSearchQuery(f.view.state);
    assert.ok(guarded instanceof search.EditorSearchQuery);
    assert.equal(guarded.search, ""); assert.equal(guarded.regexp, false); assert.equal(guarded.valid, false);
    assert.equal(guarded.input.search, pattern); assert.match(guarded.validationMessage, /Fixed-width/);
    assert.equal(search.replaceEditorMatch(f.view, true), false); assert.equal(f.text(), "a".repeat(40) + "!");
    assert.equal(executions, 0);
  } finally { RegExp.prototype.exec = originalExec; }
  f.query({ search: "(a)(a)", regexp: true, replace: "$2$1" });
  assert.equal(getSearchQuery(f.view.state).valid, true, "a later supported query can recover normally");
});

test("managed owner shortcuts honor disable/remap and Graph through HotkeyManager, suppressing lower CodeMirror defaults", () => {
  const f = fixture("alpha alpha", { managed: true }), ran = [];
  const ids = ["editor:open-search", "editor:open-search-replace", "editor:find-next", "editor:find-previous", "graph:open"];
  const manager = new search.HotkeyManager({ dispatch(id) { ran.push(id); return true; }, isApplication: () => true });
  for (const id of ids) { manager.addDefaultHotkeys(id, search.BUILTIN_HOTKEYS[id].hotkeys); }
  function route(key, { ctrl = false, shift = false, alt = false, code = "" } = {}) {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key, code, keyCode: key === "F3" ? 114 : key.toUpperCase().charCodeAt(0), ctrlKey: ctrl, metaKey: false, shiftKey: shift, altKey: alt, isComposing: false, repeat: false });
    if (!manager.handle(event)) { assert.equal(runScopeHandlers(f.view, event, "editor"), true, "managed fallback consumes fixed native bindings without invoking search"); }
    return event;
  }
  manager.disableHotkeys("editor:open-search"); manager.disableHotkeys("editor:open-search-replace"); manager.disableHotkeys("editor:find-next"); manager.disableHotkeys("editor:find-previous");
  route("f", { ctrl: true, code: "KeyF" }); route("h", { ctrl: true, code: "KeyH" }); route("F3"); route("F3", { shift: true });
  assert.deepEqual(ran, []); assert.equal(search.searchPanelOpen(f.view.state), false);
  manager.setHotkeys("editor:open-search", [{ modifiers: ["Ctrl", "Shift"], key: "y" }]);
  manager.setHotkeys("editor:find-next", [{ modifiers: ["Alt"], key: "F3" }]);
  route("f", { ctrl: true }); assert.deepEqual(ran, []);
  route("y", { ctrl: true, shift: true }); route("F3", { alt: true }); route("g", { ctrl: true, code: "KeyG" });
  assert.deepEqual(ran, ["editor:open-search", "editor:find-next", "graph:open"]);
  manager.disableHotkeys("graph:open"); route("g", { ctrl: true }); route("g", { ctrl: true, shift: true });
  assert.equal(search.searchPanelOpen(f.view.state), false, "Mod-G never silently becomes CodeMirror Find when Graph is unavailable/disabled");
});

test("multi-range Find captures a sorted union, ignores empty carets and retains the prior query instead of seeding from its primary range", () => {
  const f = fixture("alpha middle beta"); f.query({ search: "retained", replace: "chosen" });
  f.selectMany([[13, 17], [0, 5], [8, 8]], 0);
  assert.equal(search.showEditorSearch(f.view), true);
  assert.equal(getSearchQuery(f.view.state).input.search, "retained"); assert.equal(getSearchQuery(f.view.state).input.replace, "chosen");
  const scope = search.searchSelectionScope(f.view.state);
  assert.equal(scope.enabled, false); assert.deepEqual(search.selectionSearchRanges(scope), [{ from: 0, to: 5 }, { from: 13, to: 17 }]);
  search.setSearchSelectionEnabled(f.view, true); f.query({ search: "a" });
  assert.deepEqual(matches(f), [{ from: 0, to: 1 }, { from: 4, to: 5 }, { from: 16, to: 17 }]);
  f.select(6, 12); assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), search.selectionSearchRanges(scope), "navigation selections cannot recapture the union");
});

test("disjoint selection navigation wraps in document order independent of the primary range", () => {
  const source = "alpha outside\nalpha alpha\nalpha outside\nalpha alpha", f = fixture(source);
  const first = f.view.state.doc.line(2), last = f.view.state.doc.line(4);
  f.selectMany([[last.from, last.to], [first.from, first.to]], 0); search.captureSearchSelection(f.view); f.query({ search: "alpha" });
  const positions = [first.from, first.from + 6, last.from, last.from + 6];
  assert.deepEqual(matches(f).map(match => match.from), positions);
  for (const from of positions) { assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, from); }
  assert.equal(search.findNext(f.view), true); assert.equal(f.view.state.selection.main.from, positions[0]);
  assert.equal(search.findPrevious(f.view), true); assert.equal(f.view.state.selection.main.from, positions.at(-1));
});

test("selection unions never match across gaps and regex anchors/custom filters keep full-document semantics", () => {
  const f = fixture("alpha gap alpha"); f.selectMany([[0, 5], [10, 15]]); search.captureSearchSelection(f.view);
  f.query({ search: "alpha gap alpha", replace: "unsafe" }); assert.deepEqual(matches(f), []); assert.equal(search.replaceEditorMatch(f.view, true), false);
  f.query({ search: "ha gap al", replace: "unsafe" }); assert.deepEqual(matches(f), []);
  f.query({ search: "^alpha", regexp: true }); assert.deepEqual(matches(f), [{ from: 0, to: 5 }]);
  f.query({ search: "alpha$", regexp: true }); assert.deepEqual(matches(f), [{ from: 10, to: 15 }]);
  f.query({ search: "alpha", test: (_text, _state, from) => from > 0 }); assert.deepEqual(matches(f), [{ from: 10, to: 15 }]);
  f.query({ search: "$", regexp: true }); assert.deepEqual(matches(f), [{ from: 15, to: 15 }]);
  assert.equal(f.text(), "alpha gap alpha");
});

test("union Replace all preserves gap/outside BOM/CRLF bytes and restores every mapped range through one Undo/Redo", () => {
  const source = "\ufeffalpha outside\r\nalpha gap\r\nalpha 😀 alpha\r\nalpha outside\r\n", f = fixture(source, { separator: "\r\n" });
  const first = f.view.state.doc.line(2), second = f.view.state.doc.line(3);
  f.selectMany([[first.from, first.from + 5], [second.from, second.to]]); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "β\\r\\nline" });
  const oldScope = search.searchSelectionScope(f.view.state);
  assert.equal(search.replaceEditorMatch(f.view, true), true);
  assert.equal(f.text(), "\ufeffalpha outside\r\nβ\r\nline gap\r\nβ\r\nline 😀 β\r\nline\r\nalpha outside\r\n");
  const afterScope = search.searchSelectionScope(f.view.state), ranges = search.selectionSearchRanges(afterScope);
  assert.equal(ranges.length, 2); assert.equal(afterScope.stale, false);
  assert.equal(f.view.state.sliceDoc(ranges[0].from, ranges[0].to), "β\r\nline");
  assert.equal(f.view.state.sliceDoc(ranges[1].from, ranges[1].to), "β\r\nline 😀 β\r\nline");
  assert.equal(f.events.filter(event => event.docChanged).length, 1);
  assert.equal(undo(f.view), true); assert.equal(f.text(), source); assert.deepEqual(search.searchSelectionScope(f.view.state), oldScope);
  assert.equal(redo(f.view), true); assert.deepEqual(search.searchSelectionScope(f.view.state), afterScope);
  f.query({ search: "alpha" }); assert.deepEqual(matches(f), [], "outside alpha matches cannot leak into the union after replacements");
});

test("union Replace next selects then edits only an eligible match while read-only, composition and mutation guards remain authoritative", () => {
  const f = fixture("alpha alpha alpha alpha"); f.selectMany([[0, 5], [18, 23]]); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "longer" });
  f.select(6, 11); assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), "alpha alpha alpha alpha"); assert.equal(f.view.state.selection.main.from, 18);
  f.editable(false); assert.equal(search.replaceEditorMatch(f.view), false); f.editable(true);
  f.view.composing = true; assert.equal(search.replaceEditorMatch(f.view), false); f.view.composing = false;
  f.view.dispatch({ effects: f.lock.set(true) }); assert.equal(search.replaceEditorMatch(f.view), false); f.view.dispatch({ effects: f.lock.set(false) });
  assert.equal(search.replaceEditorMatch(f.view), true); assert.equal(f.text(), "alpha alpha alpha longer");
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 0, to: 5 }, { from: 18, to: 24 }]);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "alpha alpha alpha alpha");
});

test("gap/boundary edits map each union member independently and deleting the gap merges newly touching source regions", () => {
  const f = fixture("alpha middle alpha"); f.selectMany([[0, 5], [13, 18]]); search.captureSearchSelection(f.view); f.query({ search: "alpha" });
  f.view.dispatch({ changes: { from: 8, insert: "X" } });
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 0, to: 5 }, { from: 14, to: 19 }]);
  f.view.dispatch({ changes: { from: 5, insert: "_" } });
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 0, to: 5 }, { from: 15, to: 20 }]);
  assert.equal(search.searchSelectionScope(f.view.state).stale, false); assert.equal(matches(f).length, 2);
  f.view.dispatch({ changes: { from: 5, to: 15 } });
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 0, to: 10 }]);
  assert.equal(search.searchSelectionScope(f.view.state).stale, false); f.query({ search: "alphaalpha" }); assert.deepEqual(matches(f), [{ from: 0, to: 10 }]);
  const touching = fixture("abcdef"); touching.selectMany([[0, 3], [3, 6]]); search.captureSearchSelection(touching.view);
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(touching.view.state)), [{ from: 0, to: 6 }]);
});

test("an edit intersecting any union region invalidates all scoped matching until Undo or explicit recapture", () => {
  const f = fixture("alpha gap alpha"); f.selectMany([[0, 5], [10, 15]]); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "x" });
  const before = search.searchSelectionScope(f.view.state);
  f.view.dispatch({ changes: { from: 12, insert: "z" }, userEvent: "input.type", annotations: isolateHistory.of("full") });
  assert.equal(search.searchSelectionScope(f.view.state).stale, true); assert.deepEqual(matches(f), []); assert.equal(search.replaceEditorMatch(f.view, true), false);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "alpha gap alpha"); assert.deepEqual(search.searchSelectionScope(f.view.state), before); assert.equal(matches(f).length, 2);
  assert.equal(redo(f.view), true); assert.equal(search.searchSelectionScope(f.view.state).stale, true);
  f.selectMany([[0, 5], [10, 16]]); assert.equal(search.captureSearchSelection(f.view), true); assert.equal(search.searchSelectionScope(f.view.state).stale, false);
});

test("consumed union members disappear without exposing gaps and full consumption stays invalid until source Undo", () => {
  const f = fixture("alpha GAP beta"); f.selectMany([[0, 5], [10, 14]]); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "" });
  assert.equal(search.replaceEditorMatch(f.view, true), true); assert.equal(f.text(), " GAP beta"); assert.equal(search.searchSelectionScope(f.view.state).stale, false);
  assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 5, to: 9 }]);
  f.query({ search: "GAP" }); assert.deepEqual(matches(f), []); f.query({ search: "beta", replace: "" }); assert.equal(matches(f).length, 1);
  assert.equal(search.replaceEditorMatch(f.view, true), true); assert.equal(f.text(), " GAP "); assert.equal(search.searchSelectionScope(f.view.state).stale, true);
  assert.equal(undo(f.view), true); assert.equal(f.text(), " GAP beta"); assert.equal(matches(f).length, 1);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "alpha GAP beta"); assert.equal(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)).length, 2);
  assert.equal(redo(f.view), true); assert.equal(f.text(), " GAP beta"); assert.equal(redo(f.view), true); assert.equal(search.searchSelectionScope(f.view.state).stale, true);
});

test("multi-range history cannot resurrect closed scopes or override a newer union or unchecked choice", () => {
  const f = fixture("alpha alpha\nalpha alpha\nalpha alpha"); openSearchPanel(f.view);
  f.selectMany([[0, 11], [24, 35]]); search.captureSearchSelection(f.view); f.query({ search: "alpha", replace: "x" });
  search.replaceEditorMatch(f.view, true); assert.equal(f.text(), "x x\nalpha alpha\nx x");
  const middle = f.view.state.doc.line(2); f.selectMany([[middle.from, middle.from + 5], [middle.from + 6, middle.to]]); search.captureSearchSelection(f.view);
  assert.equal(undo(f.view), true); assert.deepEqual(search.selectionSearchRanges(search.searchSelectionScope(f.view.state)), [{ from: 12, to: 17 }, { from: 18, to: 23 }]);
  assert.equal(matches(f).length, 2); search.setSearchSelectionEnabled(f.view, false); assert.equal(redo(f.view), true); assert.equal(search.searchSelectionScope(f.view.state).enabled, false);
  assert.equal(search.closeSearchPanel(f.view), true); assert.equal(undo(f.view), true); assert.equal(search.searchSelectionScope(f.view.state), null); assert.equal(matches(f).length, 6);
});

test("selection scope capture and replacement have bounded range, selected-text and document work without partial mutations", () => {
  const crowded = fixture("a ".repeat(search.MAX_SELECTION_SEARCH_RANGES + 1));
  crowded.selectMany(Array.from({ length: search.MAX_SELECTION_SEARCH_RANGES + 1 }, (_, i) => [i * 2, i * 2 + 1])); assert.equal(search.captureSearchSelection(crowded.view), false);
  const large = fixture("a".repeat(search.MAX_SELECTION_SEARCH_CHARACTERS + 1)); large.select(0, large.view.state.doc.length); assert.equal(search.captureSearchSelection(large.view), false);
  const huge = fixture("x".repeat(search.MAX_SELECTION_SEARCH_SOURCE) + "a"); huge.select(huge.view.state.doc.length - 1, huge.view.state.doc.length); assert.equal(search.captureSearchSelection(huge.view), false);
  const expansion = fixture("a GAP b"); expansion.selectMany([[0, 1], [6, 7]]); search.captureSearchSelection(expansion.view); expansion.query({ search: "a", replace: "x".repeat(search.MAX_SELECTION_SEARCH_CHARACTERS) });
  assert.equal(search.replaceEditorMatch(expansion.view, true), false); assert.equal(expansion.text(), "a GAP b"); assert.equal(expansion.events.some(event => event.docChanged), false);
  const full = fixture("x".repeat(search.MAX_SELECTION_SEARCH_SOURCE - 1) + "a"); full.select(full.view.state.doc.length - 1, full.view.state.doc.length); search.captureSearchSelection(full.view); full.query({ search: "a", replace: "aa" });
  assert.equal(search.replaceEditorMatch(full.view, true), false); assert.equal(full.view.state.doc.length, search.MAX_SELECTION_SEARCH_SOURCE);
  full.view.dispatch({ changes: { from: 0, insert: "z" }, annotations: isolateHistory.of("full") }); assert.equal(search.searchSelectionScope(full.view.state).stale, true);
  assert.equal(undo(full.view), true); assert.equal(search.searchSelectionScope(full.view.state).stale, false);
});
