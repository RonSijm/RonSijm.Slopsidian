import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorSelection, EditorState, Prec, StateField } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { errorLogStub } from "./error-log-stub.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "markdown-pairing-tests-"));
  const outfile = join(directory, "pairing.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-markdown-pairing"; export * from "./client/editor-preferences"; export { markdownSupport } from "./client/editor-language";', resolveDir: root, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] }); feature = await import(pathToFileURL(outfile).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/markdown-pairing-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
function fixture(text = "", overrides = {}, extra = []) {
  const preferences = new Compartment(), plugin = StateField.define({ create: () => ({ keep: true }), update: value => value });
  const view = { composing: false, compositionStarted: false,
    state: EditorState.create({ doc: text, selection: EditorSelection.single(text.replaceAll("\r\n", "\n").length), extensions: [feature.editorBaseSetup, feature.markdownSupport, EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), plugin, preferences.of(feature.editorPreferences({ ...feature.EDITOR_PREFERENCE_DEFAULTS, ...overrides })), ...extra] }),
    dispatch(spec) { this.last = spec?.startState ? spec : this.state.update(spec); this.state = this.last.state; } };
  view.dispatch = view.dispatch.bind(view);
  return { view, plugin, text: () => view.state.sliceDoc(), cursor: offset => view.dispatch({ selection: EditorSelection.single(offset) }),
    configure: values => view.dispatch({ effects: preferences.reconfigure(feature.editorPreferences({ ...feature.EDITOR_PREFERENCE_DEFAULTS, ...values })) }),
    select: (...ranges) => view.dispatch({ selection: EditorSelection.create(ranges) }),
    type(text) { const state = view.state, range = state.selection.main, insert = () => state.update(state.replaceSelection(text), { userEvent: "input.type" });
      if (state.readOnly || !state.facet(EditorView.editable)) return false;
      for (const handler of state.facet(EditorView.inputHandler)) if (handler(view, range.from, range.to, text, insert)) return true;
      view.dispatch(insert()); return false;
    },
    press(key) { return runScopeHandlers(view, { key, keyCode: key === "Backspace" ? 8 : 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }, "editor"); },
  };
}

test("asterisk and underscore input creates owned pairs and overtypes only their generated closers", () => {
  for (const marker of ["*", "_"]) {
    const f = fixture(); assert.equal(f.type(marker), true); assert.equal(f.text(), marker.repeat(2)); assert.equal(f.view.state.selection.main.head, 1);
    f.type("λ 😀"); assert.equal(f.type(marker), true); assert.equal(f.text(), marker + "λ 😀" + marker); assert.equal(f.view.state.selection.main.head, 6);
  }
  const literal = fixture("*word*"); literal.cursor(5); assert.equal(literal.type("*"), false); assert.equal(literal.text(), "*word**");
});

test("repeated fresh opening markers grow strong and triple emphasis without consuming a closer", () => {
  for (const marker of ["*", "_"]) for (const width of [2, 3]) {
    const f = fixture(); for (let count = 0; count < width; count++) assert.equal(f.type(marker), true);
    assert.equal(f.text(), marker.repeat(width * 2)); assert.equal(f.view.state.selection.main.head, width);
    f.type("bold λ"); for (let count = 0; count < width; count++) assert.equal(f.type(marker), true);
    assert.equal(f.text(), marker.repeat(width) + "bold λ" + marker.repeat(width)); assert.equal(f.view.state.selection.main.head, 6 + width * 2);
  }
});

test("empty generated pairs delete one marker on both sides, reducing strong emphasis before removing it", () => {
  for (const marker of ["*", "_"]) {
    const f = fixture(); f.type(marker); f.type(marker); assert.equal(f.press("Backspace"), true); assert.equal(f.text(), marker.repeat(2)); assert.equal(f.view.state.selection.main.head, 1);
    assert.equal(f.press("Backspace"), true); assert.equal(f.text(), "");
  }
  const f = fixture("**"); f.cursor(1); assert.equal(feature.deleteMarkdownPair(f.view), false); f.press("Backspace"); assert.equal(f.text(), "*");
});

test("ordinary bullet/task/quoted/nested list starters and horizontal rules do not retain generated stray closers", () => {
  for (const prefix of ["", "  ", "> ", ">   "]) {
    const f = fixture(prefix); f.type("*"); assert.equal(f.type(" "), true); f.type("[ ] Task λ"); assert.equal(f.text(), prefix + "* [ ] Task λ");
    assert.equal(undo(f.view), true); assert.equal(f.text(), prefix); assert.equal(redo(f.view), true); assert.equal(f.text(), prefix + "* [ ] Task λ");
  }
  for (let width = 3; width <= 8; width++) { const f = fixture(); for (let count = 0; count < width; count++) f.type("*"); f.type(" "); assert.equal(f.text(), "*".repeat(width) + " "); }
  const inline = fixture("Before "); inline.type("_"); inline.type(" "); assert.equal(inline.text(), "Before _ ");
});

test("single-line Unicode selections wrap in their original direction with an isolated Undo and repeated strong wrapping", () => {
  for (const marker of ["*", "_"]) for (const reversed of [false, true]) {
    const f = fixture("Before λ 😀 after"); const from = 7, to = 11; f.select(EditorSelection.range(reversed ? to : from, reversed ? from : to));
    assert.equal(f.type(marker), true); assert.equal(f.text(), "Before " + marker + "λ 😀" + marker + " after");
    assert.equal(f.view.state.selection.main.anchor, (reversed ? to : from) + 1); assert.equal(f.view.state.selection.main.head, (reversed ? from : to) + 1);
    assert.equal(undo(f.view), true); assert.equal(f.text(), "Before λ 😀 after"); assert.equal(redo(f.view), true); assert.equal(f.text(), "Before " + marker + "λ 😀" + marker + " after");
  }
  const f = fixture("word"); f.select(EditorSelection.range(0, 4)); f.type("*"); f.type("*"); assert.equal(f.text(), "**word**"); assert.equal(undo(f.view), true); assert.equal(f.text(), "*word*");
});

test("multiple selections apply one complete transaction with correct Unicode positions and exact CRLF Undo/Redo", () => {
  const f = fixture("λ 😀\r\n中 文"); f.select(EditorSelection.range(0, 1), EditorSelection.range(5, 6)); assert.equal(f.type("*"), true);
  assert.equal(f.text(), "*λ* 😀\r\n*中* 文"); assert.equal(f.view.state.selection.ranges.length, 2);
  assert.equal(undo(f.view), true); assert.equal(f.text(), "λ 😀\r\n中 文"); assert.equal(redo(f.view), true); assert.equal(f.text(), "*λ* 😀\r\n*中* 文");
});

test("escaped markers and intraword identifiers stay literal, including Unicode word boundaries", () => {
  for (const source of ["identifier", "中文名字", "Cafe\u0301"]) {
    const f = fixture(source); assert.equal(f.type("_"), false); assert.equal(f.text(), source + "_");
  }
  const f = fixture("\\"); assert.equal(f.type("*"), false); assert.equal(f.text(), "\\*");
  const even = fixture("\\\\"); assert.equal(even.type("*"), true); assert.equal(even.text(), "\\\\**");
  const middle = fixture("word"); middle.cursor(2); middle.type("_"); assert.equal(middle.text(), "wo_rd");
});

test("fenced/indented/inline code, YAML, HTML, comments, links and math decline assistance", () => {
  for (const [source, offset] of [
    ["```md\nbody\n```", 10], ["    body", 8], ["`body`", 3], ["---\nkey: value\n---\n", 10], ["\ufeff---\nkey: value\n---\n", 10],
    ["<span>body</span>", 4], ["<!-- comment -->", 7], ["%% comment %%", 7], ["[body](target)", 3], ["[[body]]", 3], ["$x^2$", 3], ["$$\nx^2\n$$", 5],
  ]) {
    const f = fixture(source); f.cursor(offset); assert.equal(f.type("*"), false, source); assert.equal(f.text(), source.slice(0, offset) + "*" + source.slice(offset), source);
  }
  const f = fixture("```md\n_ literal\n```\n\n"); assert.equal(f.type("*"), true); assert.equal(f.text(), "```md\n_ literal\n```\n\n**");
});

test("multiline/whitespace-edge selections and one unsupported member decline as a whole", () => {
  const f = fixture("one\ntwo"); f.select(EditorSelection.range(0, 7)); assert.equal(f.type("*"), false); assert.equal(f.text(), "*");
  const edge = fixture(" word "); edge.select(EditorSelection.range(0, 6)); assert.equal(edge.type("*"), false); assert.equal(edge.text(), "*");
  const mixed = fixture("word\n\n"); mixed.select(EditorSelection.cursor(4), EditorSelection.cursor(6)); assert.equal(mixed.type("*"), false); assert.equal(mixed.text(), "word*\n\n*");
});

test("disabling Markdown pairs preserves source and makes marker typing and deletion ordinary", () => {
  const f = fixture(); f.type("*"); const doc = f.view.state.doc, selection = f.view.state.selection, plugin = f.view.state.field(f.plugin);
  f.configure({ autoPairMarkdown: false }); assert.equal(f.view.state.doc, doc); assert.equal(f.view.state.selection, selection); assert.equal(f.view.state.field(f.plugin), plugin);
  f.type("*"); assert.equal(f.text(), "***"); f.press("Backspace"); assert.equal(f.text(), "**");
  assert.equal(undo(f.view), true); assert.equal(f.text(), ""); assert.equal(redo(f.view), true); assert.equal(f.text(), "**");
  const g = fixture("", { autoPairMarkdown: false }); assert.equal(g.type("_"), false); assert.equal(g.text(), "_");
});

test("Markdown pairing stays independent of brackets/continuation and unrelated changes retain generated tracking", () => {
  const f = fixture("", { autoPairBrackets: false }); assert.equal(f.type("*"), true); f.type("word"); f.configure({ autoPairBrackets: false, smartIndentList: false }); assert.equal(f.type("*"), true); assert.equal(f.text(), "*word*");
  const g = fixture(); g.type("("); g.configure({ autoPairMarkdown: false }); g.type(")"); assert.equal(g.text(), "()");
  const h = fixture(); h.type("_"); h.type("word"); h.configure({ tabSize: 8, lineWrap: false }); h.type("_"); assert.equal(h.text(), "_word_");
});

test("higher-priority plugin input and Backspace still win", () => {
  let backspace = 0;
  const f = fixture("", {}, [Prec.high(EditorView.inputHandler.of((view, _from, _to, text) => { if (text !== "*") return false; view.dispatch(view.state.update(view.state.replaceSelection("plugin"), { userEvent: "input.type" })); return true; }))]);
  f.type("*"); assert.equal(f.text(), "plugin");
  const g = fixture("", {}, [Prec.high(keymap.of([{ key: "Backspace", run: () => { backspace++; return true; } }]))]); g.type("*"); g.press("Backspace"); assert.equal(g.text(), "**"); assert.equal(backspace, 1);
});

test("read-only/noneditable/composing editors and active non-Markdown languages do not manufacture pairs", () => {
  for (const extra of [[EditorState.readOnly.of(true)], [EditorView.editable.of(false)]]) { const f = fixture("", {}, extra); assert.equal(f.type("*"), false); assert.equal(feature.deleteMarkdownPair(f.view), false); assert.equal(f.text(), ""); }
  const f = fixture(); f.view.composing = true; assert.equal(f.type("*"), false); assert.equal(f.text(), "*");
  const g = fixture(); g.view.compositionStarted = true; assert.equal(g.type("_"), false); assert.equal(g.text(), "_");
  const stream = StreamLanguage.define({ token(stream) { stream.skipToEnd(); return "comment"; } }), h = fixture("", {}, [Prec.highest(stream)]); assert.equal(h.type("*"), false); assert.equal(h.text(), "*");
});

test("raw document, selection and tree inventories decline conservatively before unbounded assistance", () => {
  const large = fixture(" ".repeat(feature.MAX_MARKDOWN_PAIR_DOCUMENT + 1)); assert.equal(large.type("*"), false); assert.equal(large.text().length, feature.MAX_MARKDOWN_PAIR_DOCUMENT + 2);
  const long = fixture(" ".repeat(feature.MAX_MARKDOWN_PAIR_SELECTION + 1)); assert.equal(long.type("*"), false);
  const many = fixture("a\n\n".repeat(feature.MAX_MARKDOWN_PAIR_NODES + 1)); assert.equal(many.type("*"), false);
  const ranges = fixture("\n".repeat(65)); ranges.select(...Array.from({ length: 65 }, (_, index) => EditorSelection.cursor(index))); assert.equal(ranges.type("*"), false); assert.equal(ranges.text().match(/\*/g).length, 65);
});

test("multiple owned cursor pairs grow, overtype and delete together while retaining line endings", () => {
  const f = fixture("\r\n\r\n"); f.select(EditorSelection.cursor(0), EditorSelection.cursor(2));
  assert.equal(f.type("*"), true); assert.equal(f.type("*"), true); assert.equal(f.text(), "****\r\n\r\n****");
  assert.equal(f.press("Backspace"), true); assert.equal(f.text(), "**\r\n\r\n**");
  f.type("word λ"); assert.equal(f.type("*"), true); assert.equal(f.text(), "*word λ*\r\n\r\n*word λ*");
});

test("non-typing document replacement and Undo do not invent ownership of restored literal closers", () => {
  const f = fixture(); f.type("*"); f.type("word");
  f.view.dispatch({ changes: { from: 0, to: f.view.state.doc.length, insert: "*other*" }, userEvent: "set" }); f.cursor(6);
  assert.equal(f.type("*"), false); assert.equal(f.text(), "*other**");
  const g = fixture(); g.type("_"); assert.equal(undo(g.view), true); assert.equal(g.text(), ""); assert.equal(redo(g.view), true); assert.equal(g.text(), "__");
  g.cursor(1); assert.equal(feature.deleteMarkdownPair(g.view), false);
});

test("surrogate-interior positions and malformed Unicode decline assistance without adding a second marker", () => {
  const f = fixture("😀"); f.cursor(1); assert.equal(f.type("*"), false); assert.equal(f.text(), "\ud83d*\ude00");
  const g = fixture("\ud800 "); assert.equal(g.type("*"), false); assert.equal(g.text(), "\ud800 *");
});

test("the full GUI note keeps genuine empty-line task/rule starters and protected context edits exact", () => {
  const text = ['---', 'status: Open', 'opaque: "Keep Markdown pairs λ"', '---', '# Markdown pairs', '', 'Body λ 😀.', '', 'Pair field: ', '', 'Strike field: ', '', 'Highlight field: ', '', 'Selection field: λ 😀 keep.', '', 'Identifier: file_name', '', 'Escape field: \\', '', 'Inline field: `code `', '', '```md', 'Literal field: ', '```', ''].join("\r\n");
  const lines = text.split("\r\n"), offset = (line, ch) => lines.slice(0, line).reduce((total, text) => total + text.length + 1, 0) + ch;
  const blank = lines.indexOf("Body λ 😀.") + 1, f = fixture(text); f.cursor(offset(blank, 0)); f.type("*"); f.type(" "); f.type("[ ] Task λ");
  assert.equal(f.text(), lines.map((line, index) => index === blank ? "* [ ] Task λ" : line).join("\r\n"));
  for (const [lineText, ch, marker] of [["Literal field: ", "Literal field: ".length, "*"], ["Inline field: `code `", "Inline field: `code ".length, "*"], ["Escape field: \\", "Escape field: \\".length, "*"], ["Identifier: file_name", "Identifier: file_name".length, "_"]]) {
    const g = fixture(text), line = lines.indexOf(lineText); g.cursor(offset(line, ch)); assert.equal(g.type(marker), false, lineText);
    const expected = lines.map((value, index) => index === line ? value.slice(0, ch) + marker + value.slice(ch) : value).join("\r\n"); assert.equal(g.text(), expected);
  }
});

test("single tildes/equals stay literal and a second inline boundary marker creates only an owned double pair", () => {
  for (const marker of ["~", "="]) {
    const f = fixture("Pair field: "); assert.equal(f.type(marker), false); assert.equal(f.text(), "Pair field: " + marker);
    assert.equal(f.type(marker), true); assert.equal(f.text(), "Pair field: " + marker.repeat(4)); assert.equal(f.view.state.selection.main.head, 14);
    f.type("λ 😀"); const paired = "Pair field: " + marker.repeat(2) + "λ 😀" + marker.repeat(2), doc = f.view.state.doc;
    assert.equal(f.type(marker), true); assert.equal(f.view.state.doc, doc); assert.equal(f.type(marker), true); assert.equal(f.view.state.doc, doc); assert.equal(f.text(), paired);
    assert.equal(f.view.state.selection.main.head, paired.length);
    const literal = fixture("Pair field: " + marker.repeat(2) + "word" + marker.repeat(2)); literal.cursor(literal.text().length - 2);
    assert.equal(literal.type(marker), false); assert.equal(literal.text(), "Pair field: " + marker.repeat(2) + "word" + marker.repeat(3));
  }
});

test("empty double pairs backspace symmetrically, abandon closers on spacing and keep third markers literal", () => {
  for (const marker of ["~", "="]) {
    const f = fixture("Text: "); f.type(marker); f.type(marker);
    assert.equal(f.press("Backspace"), true); assert.equal(f.text(), "Text: " + marker.repeat(2));
    assert.equal(f.press("Backspace"), true); assert.equal(f.text(), "Text: ");
    const g = fixture("Text: "); g.type(marker); g.type(marker); assert.equal(g.type(" "), true); assert.equal(g.text(), "Text: " + marker.repeat(2) + " ");
    const h = fixture("Text: "); h.type(marker); h.type(marker); assert.equal(h.type(marker), true); assert.equal(h.text(), "Text: " + marker.repeat(3));
    assert.equal(feature.deleteMarkdownPair(h.view), false); assert.equal(h.type(marker), false); assert.equal(h.text(), "Text: " + marker.repeat(4));
  }
});

test("bare/quoted/list-prefix tilde fences and equals underlines remain literal, including imported markers and setting changes", () => {
  for (const marker of ["~", "="]) for (const prefix of ["", "  ", "> ", "> > ", "- ", "> 1. ", "Heading\n", "- - ", "- > ", "1. - ", "> - > ", "+ * 2) > ", "\t- > ", "- \t>\t1.\t", "1)\t+ \t> "]) {
    const f = fixture(prefix); assert.equal(f.type(marker), false); assert.equal(f.type(marker), false); assert.equal(f.type(marker), false); assert.equal(f.text(), prefix + marker.repeat(3));
    const imported = fixture(prefix + marker); assert.equal(imported.type(marker), false); assert.equal(imported.type(marker), false); assert.equal(imported.text(), prefix + marker.repeat(3));
    const g = fixture(prefix + marker, { autoPairMarkdown: false }); g.configure({ autoPairMarkdown: true });
    assert.equal(g.type(marker), false); assert.equal(g.type(marker), false); assert.equal(g.text(), prefix + marker.repeat(3));
  }
  for (const marker of ["~", "="]) for (const prefix of ["- - Text: ", "- > Text: ", "1. - Text: ", "> - > Text: ", "+ * 2) > Text: "]) {
    const f = fixture(prefix); assert.equal(f.type(marker), false); assert.equal(f.type(marker), true); assert.equal(f.text(), prefix + marker.repeat(4));
    f.type("kept"); assert.equal(f.type(marker), true); assert.equal(f.type(marker), true); assert.equal(f.text(), prefix + marker.repeat(2) + "kept" + marker.repeat(2));
  }
  for (const source of ["a = ", "a ~ ", "a == ", "a ~~ "]) {
    const f = fixture(source); assert.equal(f.type("="), false); assert.equal(f.text(), source + "=");
  }
});

test("one-marker selection wrapping preserves both Unicode directions, repeated wrapping doubles, and Undo/Redo isolates each step", () => {
  for (const marker of ["~", "="]) for (const reversed of [false, true]) {
    const f = fixture("λ 😀 keep"), end = "λ 😀".length; f.select(EditorSelection.range(reversed ? end : 0, reversed ? 0 : end));
    assert.equal(f.type(marker), true); assert.equal(f.text(), marker + "λ 😀" + marker + " keep");
    assert.equal(f.type(marker), true); const doubled = marker.repeat(2) + "λ 😀" + marker.repeat(2) + " keep"; assert.equal(f.text(), doubled);
    assert.equal(f.view.state.selection.main.anchor, (reversed ? end : 0) + 2); assert.equal(f.view.state.selection.main.head, (reversed ? 0 : end) + 2);
    assert.equal(undo(f.view), true); assert.equal(f.text(), marker + "λ 😀" + marker + " keep");
    assert.equal(undo(f.view), true); assert.equal(f.text(), "λ 😀 keep"); assert.equal(redo(f.view), true); assert.equal(redo(f.view), true); assert.equal(f.text(), doubled);
    f.cursor(end + 2); assert.equal(feature.deleteMarkdownPair(f.view), false); // Redo restores text, never generated ownership.
    assert.equal(f.type(marker), false); assert.equal(f.text(), marker.repeat(2) + "λ 😀" + marker.repeat(3) + " keep");
  }
});

test("new markers preserve multi-range CRLF edits and refuse mixed unsupported members as a whole", () => {
  for (const marker of ["~", "="]) {
    const f = fixture("A: \r\nB: "); f.select(EditorSelection.cursor(3), EditorSelection.cursor(7));
    assert.equal(f.type(marker), false); assert.equal(f.type(marker), true); assert.equal(f.text(), "A: " + marker.repeat(4) + "\r\nB: " + marker.repeat(4));
    assert.equal(f.press("Backspace"), true); assert.equal(f.press("Backspace"), true); assert.equal(f.text(), "A: \r\nB: ");
    const g = fixture("λ\r\n中"); g.select(EditorSelection.range(0, 1), EditorSelection.range(2, 3)); g.type(marker); g.type(marker);
    assert.equal(g.text(), marker.repeat(2) + "λ" + marker.repeat(2) + "\r\n" + marker.repeat(2) + "中" + marker.repeat(2));
    assert.equal(undo(g.view), true); assert.equal(undo(g.view), true); assert.equal(g.text(), "λ\r\n中");
    const mixed = fixture("A: " + marker + "\n" + marker); mixed.select(EditorSelection.cursor(4), EditorSelection.cursor(6));
    assert.equal(mixed.type(marker), false); assert.equal(mixed.text(), "A: " + marker.repeat(2) + "\n" + marker.repeat(2));
  }
});

test("new markers check first-marker escapes, words and all existing protected source contexts", () => {
  for (const marker of ["~", "="]) {
    for (const source of ["Escaped: \\" + marker, "identifier" + marker, "中文" + marker]) { const f = fixture(source); assert.equal(f.type(marker), false); assert.equal(f.text(), source + marker); }
    const even = fixture("Escaped: \\\\" + marker); assert.equal(even.type(marker), true); assert.equal(even.text(), "Escaped: \\\\" + marker.repeat(4));
    for (const [source, offset] of [["```md\nvalue \n```", 12], ["~~~md\nvalue \n~~~", 12], ["    value ", 10], ["`value `", 7], ["---\nkey: value \n---", 15], ["[value ](target)", 7], ["[[value ]]", 8], ["$value $", 7], ["$$value $$", 8], ["%%value %%", 8], ["<!--value -->", 10]]) {
      const f = fixture(source); f.cursor(offset); assert.equal(f.type(marker), false, source); assert.equal(f.type(marker), false, source); assert.equal(f.text(), source.slice(0, offset) + marker.repeat(2) + source.slice(offset), source);
    }
  }
});

test("new pair ownership survives unrelated reconfiguration while disabled/read-only/composing/plugin paths remain independent", () => {
  for (const marker of ["~", "="]) {
    const f = fixture("Text: "); f.type(marker); f.type(marker); f.type("word"); const doc = f.view.state.doc;
    f.configure({ autoPairBrackets: false, smartIndentList: false, lineWrap: false }); assert.equal(f.view.state.doc, doc); assert.equal(f.type(marker), true); assert.equal(f.type(marker), true); assert.equal(f.text(), "Text: " + marker.repeat(2) + "word" + marker.repeat(2));
    const g = fixture("Text: "); g.type(marker); g.type(marker); const paired = g.text(); g.configure({ autoPairMarkdown: false }); assert.equal(g.text(), paired); assert.equal(feature.deleteMarkdownPair(g.view), false); assert.equal(g.type(marker), false);
    const disabled = fixture("Text: ", { autoPairMarkdown: false }); assert.equal(disabled.type(marker), false); assert.equal(disabled.type(marker), false); assert.equal(disabled.text(), "Text: " + marker.repeat(2));
    for (const extra of [[EditorState.readOnly.of(true)], [EditorView.editable.of(false)]]) { const h = fixture("Text: " + marker, {}, extra); assert.equal(h.type(marker), false); assert.equal(h.text(), "Text: " + marker); }
    const composing = fixture("Text: " + marker); composing.view.composing = true; assert.equal(composing.type(marker), false); assert.equal(composing.text(), "Text: " + marker.repeat(2));
    const started = fixture("Text: " + marker); started.view.compositionStarted = true; assert.equal(started.type(marker), false); assert.equal(started.text(), "Text: " + marker.repeat(2));
    const plugin = fixture("Text: " + marker, {}, [Prec.high(EditorView.inputHandler.of((view, _from, _to, text) => { if (text !== marker) return false; view.dispatch(view.state.update(view.state.replaceSelection("plugin"), { userEvent: "input.type" })); return true; }))]);
    assert.equal(plugin.type(marker), true); assert.equal(plugin.text(), "Text: " + marker + "plugin");
    let backspaces = 0; const keyPlugin = fixture("Text: ", {}, [Prec.high(keymap.of([{ key: "Backspace", run: () => { backspaces++; return true; } }]))]);
    keyPlugin.type(marker); keyPlugin.type(marker); assert.equal(keyPlugin.press("Backspace"), true); assert.equal(backspaces, 1); assert.equal(keyPlugin.text(), "Text: " + marker.repeat(4));
  }
});

test("new markers preserve conservative document/tree/selection limits and unsupported literal input", () => {
  for (const marker of ["~", "="]) {
    const many = fixture("a\n\n".repeat(feature.MAX_MARKDOWN_PAIR_NODES + 1) + "Text: " + marker); assert.equal(many.type(marker), false);
    const large = fixture(" ".repeat(feature.MAX_MARKDOWN_PAIR_DOCUMENT) + "Text: " + marker); assert.equal(large.type(marker), false);
    const long = fixture("Text: " + " ".repeat(feature.MAX_MARKDOWN_PAIR_SELECTION) + marker); assert.equal(long.type(marker), false);
    const selection = fixture("word\nword"); selection.select(EditorSelection.range(0, 9)); assert.equal(selection.type(marker), false); assert.equal(selection.text(), marker);
    const edge = fixture(" word "); edge.select(EditorSelection.range(0, 6)); assert.equal(edge.type(marker), false); assert.equal(edge.text(), marker);
    const direct = fixture("Text: "); assert.equal(direct.type(marker.repeat(2)), false); assert.equal(direct.text(), "Text: " + marker.repeat(2));
    const broken = fixture("Text: \ud800" + marker); assert.equal(broken.type(marker), false);
    const stream = fixture("Text: " + marker, {}, [Prec.highest(StreamLanguage.define({ token(stream) { stream.skipToEnd(); return "comment"; } }))]); assert.equal(stream.type(marker), false);
    const ranges = fixture("Text: \n".repeat(65)); ranges.select(...Array.from({ length: 65 }, (_, index) => EditorSelection.cursor(index * 7 + 6))); assert.equal(ranges.type(marker), false); assert.equal(ranges.type(marker), false); assert.equal(ranges.text().match(new RegExp(marker, "g")).length, 130);
  }
});
