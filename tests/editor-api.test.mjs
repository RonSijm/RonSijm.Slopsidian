import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState, Transaction } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { codeFolding, foldedRanges } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { MutationLock } from "../client/editor-barrier.ts";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, Editor;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime/editor-api-tests-"));
  const output = join(directory, "editor.mjs");
  await build({ entryPoints: [join(root, "client/editor.ts")], outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  ({ Editor } = await import(pathToFileURL(output).href));
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/editor-api-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

// Exercise the public facade with real CodeMirror documents, changes, folds and
// history. Rendering/focus/physical scrolling still need the actual-host suite.
function editor(text, options = {}) {
  const result = Object.create(Editor.prototype), events = [], lock = new MutationLock();
  let focused = false, measured = 0;
  const view = {
    state: EditorState.create({ doc: text, extensions: [EditorState.allowMultipleSelections.of(true), EditorState.lineSeparator.of(options.separator ?? "\n"), history(), markdown(), codeFolding(), lock.extension()] }),
    scrollDOM: { scrollTop: 12, scrollLeft: 7 },
    contentDOM: { blur() { focused = false; } },
    get hasFocus() { return focused; },
    focus() { focused = true; },
    requestMeasure() { measured++; },
    lineBlockAt(offset) { return this.state.doc.lineAt(offset); },
    dispatch(...specs) { const transaction = specs.length === 1 && specs[0]?.startState ? specs[0] : this.state.update(...specs); this.state = transaction.state; events.push(transaction); },
  };
  view.dispatch = view.dispatch.bind(view);
  Object.assign(result, { cm: view, owner: options.owner });
  return { editor: result, view, events, lock, measurements: () => measured };
}
const pos = (line, ch = 0) => ({ line, ch });

test("setLine and replacement origins retain destination line endings and actual undo/redo", () => {
  const { editor: api, events } = editor("first\r\nsecond\r\n", { separator: "\r\n" });
  api.setLine(1, "changed");
  assert.equal(api.getValue(), "first\r\nchanged\r\n");
  api.setSelection(pos(0), pos(0, 5));
  assert.equal(api.somethingSelected(), true);
  api.replaceSelection("new\nline", "input.public-probe");
  assert.equal(events.at(-1).annotation(Transaction.userEvent), "input.public-probe");
  assert.equal(api.getValue(), "new\r\nline\r\nchanged\r\n");
  assert.equal(api.somethingSelected(), false);
  api.replaceRange("!", pos(2, 7), undefined, "input.public-range");
  assert.equal(events.at(-1).annotation(Transaction.userEvent), "input.public-range");
  const edited = api.getValue();
  api.undo(); assert.notEqual(api.getValue(), edited);
  api.redo(); assert.equal(api.getValue(), edited);
});

test("processLines reads unique ordered lines before writing and groups reversed overlapping selections in one undo", () => {
  const { editor: api, events } = editor("zero\nalpha\n  \nbeta\nlast");
  api.setSelections([{ anchor: pos(3, 3), head: pos(1, 1) }, { anchor: pos(1, 2), head: pos(4) }]);
  const calls = [], before = api.getValue(), notifications = events.filter(tx => tx.docChanged).length;
  api.processLines((line, text) => { calls.push(["read", line, text]); return text.toUpperCase(); }, (line, text, value) => {
    calls.push(["write", line, text]); return { from: pos(line), to: pos(line, text.length), text: value };
  });
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [["read", 1], ["read", 3], ["read", 4], ["write", 1], ["write", 3], ["write", 4]]);
  assert.equal(api.getValue(), "zero\nALPHA\n  \nBETA\nLAST");
  assert.equal(events.filter(tx => tx.docChanged).length, notifications + 1);
  api.undo(); assert.equal(api.getValue(), before);
  api.redo(); assert.equal(api.getValue(), "zero\nALPHA\n  \nBETA\nLAST");
});

test("processLines includes an end-line column-zero caret, supports blank lines and read-null skips", () => {
  const { editor: api } = editor("one\n\nthree\nfour");
  api.setSelection(pos(0, 1), pos(3));
  const lines = [];
  api.processLines((line, text) => line === 2 ? null : text, (line, text, value) => { lines.push([line, text, value]); }, false);
  assert.deepEqual(lines, [[0, "one", "one"], [1, "", ""], [2, "three", null], [3, "four", "four"]]);
  const writes = [];
  api.processLines(line => line === 2 ? null : true, line => { writes.push(line); });
  assert.deepEqual(writes, [0, 3]);
});

test("processLines preserves a lone caret after an inserted prefix and refuses stale or invalid batches", () => {
  const { editor: api } = editor("word\nnext");
  api.processLines(() => true, line => ({ from: pos(line), text: "- " }));
  assert.equal(api.getValue(), "- word\nnext");
  assert.deepEqual(api.getCursor(), pos(0, 2));
  const before = api.getValue();
  assert.throws(() => api.processLines(() => true, () => ({ from: pos(99), text: "bad" })));
  assert.equal(api.getValue(), before);
  assert.throws(() => api.processLines(() => { api.replaceRange("External ", pos(0)); return true; }, () => ({ from: pos(0), text: "stale" })), /note changed/);
  assert.equal(api.getValue(), "External " + before);
});

test("wordAt uses CodeMirror Unicode word boundaries and reversed range scrolling retains both endpoints", () => {
  const { editor: api, events } = editor("λambda\nhello world\n");
  assert.deepEqual(api.wordAt(pos(0, 2)), { from: pos(0), to: pos(0, 6) });
  assert.equal(api.wordAt(pos(2)), null);
  api.scrollIntoView({ from: pos(1, 8), to: pos(0, 1) }, true);
  const target = events.at(-1).effects.at(-1).value;
  assert.equal(target.range.anchor, api.posToOffset(pos(1, 8)));
  assert.equal(target.range.head, 1);
  assert.equal(target.y, "center");
});

test("focus/refresh and scroll helpers use the actual owning note pane and leave omitted axes unchanged", () => {
  const owner = { contentEl: { scrollTop: 40, scrollLeft: 5 } };
  const { editor: api, view, measurements } = editor("text", { owner });
  api.focus(); assert.equal(api.hasFocus(), true);
  api.blur(); assert.equal(api.hasFocus(), false);
  api.refresh(); assert.equal(measurements(), 1);
  api.scrollTo(null, 99); assert.deepEqual(api.getScrollInfo(), { left: 5, top: 99 });
  api.scrollTo(17); assert.deepEqual(api.getScrollInfo(), { left: 17, top: 99 });
  assert.deepEqual(view.scrollDOM, { scrollTop: 12, scrollLeft: 7 });
  const { editor: embedded } = editor("text");
  embedded.scrollTo(3, 4); assert.deepEqual(embedded.getScrollInfo(), { left: 3, top: 4 });
});

test("exec dispatches real document, indentation, line movement and fold commands; unknown commands do not edit", () => {
  const { editor: api, view } = editor("# Title\nbody\n## Child\nchild\n# Last\nend\n");
  api.exec("goEnd"); assert.deepEqual(api.getCursor(), pos(6));
  api.exec("goStart"); assert.deepEqual(api.getCursor(), pos(0));
  api.exec("indentMore"); assert.equal(api.getLine(0), "  # Title");
  api.exec("indentLess"); assert.equal(api.getLine(0), "# Title");
  api.setCursor(1); api.exec("swapLineDown"); assert.equal(api.getLine(2), "body");
  api.exec("swapLineUp"); assert.equal(api.getLine(1), "body");
  api.setCursor(0); api.exec("foldAll"); assert.ok(foldedRanges(view.state).size > 0);
  api.exec("unfoldAll"); assert.equal(foldedRanges(view.state).size, 0);
  api.exec("toggleFold"); assert.equal(foldedRanges(view.state).size, 1);
  api.exec("toggleFold"); assert.equal(foldedRanges(view.state).size, 0);
  const before = api.getValue(); assert.throws(() => api.exec("toString"), /Unknown editor command/); assert.equal(api.getValue(), before);
});

test("public history and editing commands retain held mutation guards and read-only owner history", () => {
  const { editor: api, view, lock } = editor("before");
  api.replaceRange("after ", pos(0));
  const edited = api.getValue(); view.dispatch({ effects: lock.set(true) });
  api.undo(); api.redo(); api.exec("indentMore"); assert.equal(api.getValue(), edited);
  view.dispatch({ effects: lock.set(false) }); api.undo(); assert.equal(api.getValue(), "before");
  api.redo(); assert.equal(api.getValue(), edited);
  api.owner = { app: { vault: { readOnly: true } } };
  api.undo(); assert.equal(api.getValue(), edited);
});
