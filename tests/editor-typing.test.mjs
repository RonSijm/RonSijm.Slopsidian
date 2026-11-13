import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorSelection, EditorState, Prec, StateField } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { indentMore, redo, undo } from "@codemirror/commands";
import { language, StreamLanguage } from "@codemirror/language";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "editor-typing-tests-"));
  const outfile = join(directory, "typing.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-typing"; export * from "./client/editor-preferences"; export { markdownSupport } from "./client/editor-language";', resolveDir: root, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] }); feature = await import(pathToFileURL(outfile).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/editor-typing-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

function fixture(text = "", overrides = {}, extra = []) {
  const preferences = new Compartment(), plugin = StateField.define({ create: () => ({ retained: true }), update: value => value });
  const view = { composing: false, compositionStarted: false,
    state: EditorState.create({ doc: text, selection: EditorSelection.single(text.replaceAll("\r\n", "\n").length), extensions: [feature.editorBaseSetup, feature.markdownSupport, EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), plugin, preferences.of(feature.editorPreferences({ ...feature.EDITOR_PREFERENCE_DEFAULTS, ...overrides })), ...extra] }),
    dispatch(spec) { this.last = spec?.startState ? spec : this.state.update(spec); this.state = this.last.state; } };
  view.dispatch = view.dispatch.bind(view);
  const configure = values => view.dispatch({ effects: preferences.reconfigure(feature.editorPreferences({ ...feature.EDITOR_PREFERENCE_DEFAULTS, ...values })) });
  const type = text => {
    const state = view.state, range = state.selection.main, insert = () => state.update(state.replaceSelection(text), { userEvent: "input.type", scrollIntoView: true });
    if (state.readOnly) return false;
    for (const handler of state.facet(EditorView.inputHandler)) if (handler(view, range.from, range.to, text, insert)) return true;
    view.dispatch(insert()); return true;
  };
  const press = (key, shiftKey = false) => runScopeHandlers(view, { key, keyCode: key === "Enter" ? 13 : key === "Backspace" ? 8 : 0, shiftKey, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }, "editor");
  const cursor = offset => view.dispatch({ selection: EditorSelection.single(offset) });
  return { view, configure, type, press, cursor, plugin, text: () => view.state.sliceDoc() };
}

test("installed input handlers pair brackets/quotes, overtype generated closers and delete empty pairs", () => {
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ['"', '"'], ["'", "'"]]) {
    const f = fixture(); f.type(open); assert.equal(f.text(), open + close); assert.equal(f.view.state.selection.main.head, 1);
    f.type(close); assert.equal(f.text(), open + close); assert.equal(f.view.state.selection.main.head, 2);
    const g = fixture(); g.type(open); assert.equal(g.press("Backspace"), true); assert.equal(g.text(), "");
  }
});

test("disabled pairing uses ordinary insertion, closing and Backspace without touching preexisting pairs", () => {
  const f = fixture("", { autoPairBrackets: false }); f.type("("); assert.equal(f.text(), "("); f.type(")"); assert.equal(f.text(), "()");
  f.cursor(1); f.press("Backspace"); assert.equal(f.text(), ")");
  const g = fixture("()", { autoPairBrackets: false }); g.cursor(1); g.type(")"); assert.equal(g.text(), "())");
});

test("a pairing toggle preserves document/selection/plugin/history while old generated closers stop overtyping", () => {
  const f = fixture("😀 λ\r\n"); f.type("("); const document = f.view.state.doc, selection = f.view.state.selection, plugin = f.view.state.field(f.plugin);
  f.configure({ autoPairBrackets: false }); assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection); assert.equal(f.view.state.field(f.plugin), plugin);
  f.type(")"); assert.equal(f.text(), "😀 λ\r\n())"); assert.equal(undo(f.view), true); assert.equal(f.text(), "😀 λ\r\n"); assert.equal(redo(f.view), true); assert.equal(f.text(), "😀 λ\r\n())");
});

test("changing only smart continuation retains active pair tracking", () => {
  const f = fixture(); f.type("("); f.configure({ smartIndentList: false }); f.type(")"); assert.equal(f.text(), "()"); assert.equal(f.view.state.selection.main.head, 2);
});

test("multiple selections wrap Unicode source in one actual bracket transaction and Undo", () => {
  const f = fixture("λ 😀"); f.view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 4)]) });
  f.type("["); assert.equal(f.text(), "[λ] [😀]"); assert.equal(f.view.state.selection.ranges.length, 2); assert.equal(undo(f.view), true); assert.equal(f.text(), "λ 😀");
});

test("the real Enter keymap continues unordered, ordered, task, nested-list and quote markers", () => {
  for (const [text, expected] of [["- Item", "- Item\n- "], ["1. Item", "1. Item\n2. "], ["- [x] Done", "- [x] Done\n- [ ] "], ["- Parent\n  - Child", "- Parent\n  - Child\n  - "], ["> Quote", "> Quote\n> "]]) {
    const f = fixture(text); assert.equal(f.press("Enter"), true); assert.equal(f.text(), expected);
  }
});

test("the acceptance CRLF note preserves loose task spacing, tight siblings and exact Enter Undo/Redo", () => {
  const text = '---\r\nstatus: Open\r\nopaque: "Keep typing λ"\r\n---\r\n# Typing controls\r\n\r\nBody λ 😀.\r\n\r\nPair field: \r\n\r\n- Item λ\r\n\r\n> Quote λ\r\n\r\n1. Ordered\r\n2. Following\r\n\r\n- [x] Task\r\n\r\n- Parent\r\n  - Child\r\n\r\n```md\r\n- literal\r\n```\r\n';
  const normalized = text.replaceAll("\r\n", "\n");
  const cases = [
    ["- Item λ", "- Item λ", "- Item λ\r\n- "],
    ["> Quote λ", "> Quote λ", "> Quote λ\r\n> "],
    ["1. Ordered", "1. Ordered\r\n2. Following", "1. Ordered\r\n2. \r\n3. Following"],
    ["- [x] Task", "- [x] Task", "- [x] Task\r\n\r\n- [ ] "],
    ["  - Child", "  - Child", "  - Child\r\n  - "],
    ["- literal", "- literal", "- literal\r\n"],
  ];
  for (const [line, prior, continued] of cases) {
    const f = fixture(text), expected = text.replace(prior, continued);
    f.cursor(normalized.indexOf(line) + line.length); assert.equal(f.press("Enter"), true); assert.equal(f.text(), expected, line);
    assert.equal(undo(f.view), true); assert.equal(f.text(), text, "Undo retains every CRLF and original task checkbox");
    assert.equal(redo(f.view), true); assert.equal(f.text(), expected, "Redo restores only the installed command's exact continuation");
  }
});

test("smart Enter renumbers existing ordered siblings and exits empty markers through installed Markdown commands", () => {
  const f = fixture("1. One\n2. Two"); f.cursor(6); f.press("Enter"); assert.equal(f.text(), "1. One\n2. \n3. Two");
  const g = fixture("- "); g.press("Enter"); assert.equal(g.text(), "");
});

test("disabling continuation falls through to ordinary newline/indent for lists and quotes", () => {
  for (const [text, expected] of [["- Item", "- Item\n"], ["> Quote", "> Quote\n"], ["  - Item", "  - Item\n  "]]) {
    const f = fixture(text, { smartIndentList: false }); f.press("Enter"); assert.equal(f.text(), expected);
  }
});

test("code fences keep ordinary Enter even when their text resembles a list", () => {
  const text = "```md\r\n- Literal\r\n```", f = fixture(text); f.cursor("```md\n- Literal".length); f.press("Enter"); assert.equal(f.text(), "```md\r\n- Literal\r\n\r\n```");
});

test("multiple Markdown cursors continue independently and retain CRLF plus Undo/Redo", () => {
  const f = fixture("- One\r\n- Two"); f.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(5), EditorSelection.cursor(11)]) });
  f.press("Enter"); assert.equal(f.text(), "- One\r\n- \r\n- Two\r\n- "); assert.equal(undo(f.view), true); assert.equal(f.text(), "- One\r\n- Two"); assert.equal(redo(f.view), true); assert.equal(f.text(), "- One\r\n- \r\n- Two\r\n- ");
});

test("highest-priority plugin Enter and an active stream language retain their existing precedence/fallback", () => {
  const f = fixture("- Item", {}, [Prec.highest(keymap.of([{ key: "Enter", run: view => { view.dispatch(view.state.replaceSelection("plugin")); return true; } }]))]); f.press("Enter"); assert.equal(f.text(), "- Itemplugin");
  const stream = StreamLanguage.define({ token(stream) { stream.skipToEnd(); return "comment"; } }), g = fixture("- Item", {}, [Prec.highest(stream)]);
  assert.equal(g.view.state.facet(language), stream); g.press("Enter"); assert.equal(g.text(), "- Item\n");
});

test("a plugin's high-priority Backspace still runs before the configurable paired-deletion binding", () => {
  let called = 0;
  const f = fixture("()", {}, [Prec.high(keymap.of([{ key: "Backspace", run: view => { called++; view.dispatch(view.state.replaceSelection("plugin")); return true; } }]))]);
  f.cursor(1); f.press("Backspace"); assert.equal(called, 1); assert.equal(f.text(), "(plugin)");
});

test("installed pairing retains a language provider's bracket configuration instead of replacing its tokens", () => {
  const data = EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["<"], before: ">" } }]);
  const f = fixture("", {}, [data]); f.type("<"); assert.equal(f.text(), "<>");
  const g = fixture("", { autoPairBrackets: false }, [data]); g.type("<"); assert.equal(g.text(), "<");
});

test("manual indentation and Markdown Backspace keep their existing behavior when continuation is disabled", () => {
  const f = fixture("word", { smartIndentList: false, useTab: true }); f.cursor(0); indentMore(f.view); assert.equal(f.text(), "\tword");
  const g = fixture("- ", { smartIndentList: false }); g.press("Backspace"); assert.equal(g.text(), "");
});

test("read-only and composing views decline smart Enter, and composing input does not manufacture bracket pairs", () => {
  const f = fixture("- Item", {}, [EditorState.readOnly.of(true)]); assert.equal(feature.smartMarkdownEnter(f.view), false); f.press("Enter"); f.press("Backspace"); assert.equal(f.type("("), false); assert.equal(f.text(), "- Item");
  const g = fixture("- Item"); g.view.composing = true; assert.equal(feature.smartMarkdownEnter(g.view), false); g.view.compositionStarted = true; g.type("("); assert.equal(g.text(), "- Item(");
});
