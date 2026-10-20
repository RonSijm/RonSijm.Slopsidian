import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";
import { marked } from "marked";

let directory, parseMarkdown, sourcePositions, scanInlineFootnotes, MAX_INLINE_FOOTNOTE_SOURCE, footnoteEntries, planFootnoteRendering, planFootnoteEdit, FootnotesPaneView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "multiline-inline-footnotes-tests-"));
  const models = join(directory, "models.cjs"), view = join(directory, "view.cjs"), require = createRequire(import.meta.url);
  await build({ stdin: { contents: 'export { parseMarkdown, sourcePositions } from "./client/markdown"; export { scanInlineFootnotes, MAX_INLINE_FOOTNOTE_SOURCE } from "./client/inline-footnotes"; export { footnoteEntries } from "./client/footnotes-pane-model"; export { planFootnoteRendering } from "./client/footnote-render-model"; export { planFootnoteEdit } from "./client/footnote-edit";', resolveDir: root }, outfile: models, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ parseMarkdown, sourcePositions, scanInlineFootnotes, MAX_INLINE_FOOTNOTE_SOURCE, footnoteEntries, planFootnoteRendering, planFootnoteEdit } = require(models));
  await build({ entryPoints: [join(root, "client/footnotes-pane-view.ts")], outfile: view, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ FootnotesPaneView } = require(view));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/multiline-inline-footnotes-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const inline = text => parseMarkdown(text).footnotes.filter(note => note.inline);
const endings = text => text.match(/\r\n|\n|\r/g) ?? [];
const normalized = text => text.replace(/\r\n?|\n/g, "\n");

for (const [name, first, second] of [["LF", "\n", "\n"], ["CRLF", "\r\n", "\r\n"], ["mixed", "\r\n", "\n"]]) {
  test(name + " multiline tokens retain raw UTF-16 offsets, BOM, Unicode and every source coordinate", () => {
    const body = "First λ" + first + "Second [中文 [nested]]" + second + "Third 😀", token = "^[" + body + "]";
    const prefix = "\ufeff😀 Before ", text = prefix + token + " tail." + first + first + "# After\n", notes = inline(text);
    assert.equal(notes.length, 1); const note = notes[0];
    assert.equal(note.content, body); assert.equal(note.id, "inline:" + prefix.length);
    assert.deepEqual(note.position, { start: { line: 0, ch: prefix.length, offset: prefix.length }, end: { line: 2, ch: "Third 😀]".length, offset: prefix.length + token.length } });
    assert.deepEqual(note.labelPosition, note.position); assert.equal(text.slice(note.position.start.offset, note.position.end.offset), token);
    assert.deepEqual(sourcePositions(text)(prefix.length, prefix.length + token.length), note.position);
    assert.deepEqual(footnoteEntries(parseMarkdown(text), text)[0].definitions[0], note);
  });
}

test("the exported scanner uses the production Markdown block boundaries without normalizing its input", () => {
  const text = "Before ^[one\r\ntwo [balanced]] after\n\n^[unfinished\n\nelsewhere] ^[last]";
  assert.deepEqual(scanInlineFootnotes(text, []), inline(text).map(note => ({ from: note.position.start.offset, to: note.position.end.offset, content: note.content })));
  assert.deepEqual(inline(text).map(note => note.content), ["one\r\ntwo [balanced]", "last"]);
});

test("nested ordinary brackets and escaped brackets span soft lines while nested inline notes remain literal", () => {
  const text = "^[a [outer\n[inner] escaped\\] ] z] ^[bad\n^[nested]] ^[after]";
  assert.deepEqual(inline(text).map(note => note.content), ["a [outer\n[inner] escaped\\] ] z", "after"]);
});

test("backslash parity remains exact at multiline openers and closers", () => {
  const text = "\\^[escaped\ntext] \\\\^[real\n\\] stays] ^[even \\\\]\n^[next]";
  assert.deepEqual(inline(text).map(note => note.content), ["real\n\\] stays", "even " + "\\".repeat(2), "next"]);
});

test("multiline code spans, link destinations and inline math are opaque to closing and nested-open brackets", () => {
  const body = "Code ``literal ]\n` ^[literal] `` and [caption](Other.md)\nmath $x]$ and [[Target]]";
  assert.deepEqual(inline("Before ^[" + body + "] after").map(note => note.content), [body]);
  const cache = parseMarkdown("Before ^[" + body + "] after");
  assert.deepEqual(cache.links.map(link => link.link).sort(), ["Other.md", "Target"]);
});

test("multiline link and image labels, URLs, autolinks and HTML attributes cannot open notes", () => {
  const text = '[caption ^[one\ntwo]](Target.md) ![image ^[three\nfour]](asset.png) [link](https://invalid.test/^[url]) <https://invalid.test/^[auto]> <span title="^[attribute]">text</span> ^[real\nbody]';
  assert.deepEqual(inline(text).map(note => note.content), ["real\nbody"]);
});

for (const gap of ["\n\n", "\r\n\r\n", "\r\n \t\n"]) {
  test("paragraph termination " + JSON.stringify(gap) + " cannot capture a later closing bracket", () => {
    const text = "Before ^[unfinished" + gap + "Unrelated text] and ^[valid\nbody].";
    assert.deepEqual(inline(text).map(note => note.content), ["valid\nbody"]);
  });
}

test("headings, lists, blockquotes, rules, fences and definitions terminate an unfinished candidate", () => {
  for (const next of ["# Heading", "- List", "> Quote", "---", "```md\ncode\n```", "[^named]: Named"]) {
    const text = "Before ^[unfinished\n" + next + "\nUnrelated]\n\n^[later\nbody]";
    assert.deepEqual(inline(text).map(note => note.content), ["later\nbody"], next);
  }
});

test("metadata, fenced and indented code, raw HTML, comments and named definitions exclude multiline lookalikes", () => {
  const text = ["---", "description: |", "  ^[metadata", "  body]", "---", "", "```md", "^[fenced", "body]", "```", "", "    ^[indented", "    body]", "", "<div>", "^[html", "body]", "</div>", "", "<!-- ^[comment", "body] -->", "", "%% ^[percent", "body] %%", "", "[^named]: ^[definition", "    body]", "", "Outside ^[real", "body]"].join("\r\n");
  assert.deepEqual(inline(text).map(note => note.content), ["real\r\nbody"]);
});

test("literal ranges crossing a paragraph boundary cannot carry a candidate across that boundary", () => {
  const text = "^[before `code\n\n]` after] ^[later]";
  assert.deepEqual(inline(text).map(note => note.content), ["later"]);
  assert.deepEqual(scanInlineFootnotes(text, [{ from: 9, to: 19 }]).map(note => note.content), ["later"]);
});

test("generated IDs reserve missing named references and multiline/named entries share source order numbering", () => {
  const text = "A ^[one\ntwo [^named]] [^inline:2] ^[last\nline].\n\n[^named]: Named\n", cache = parseMarkdown(text);
  assert.equal(cache.footnotes.find(note => note.inline).id, "inline:2:1");
  assert.deepEqual(footnoteEntries(cache, text).map(entry => [entry.number, entry.definitions[0]?.content]), [[1, "one\ntwo [^named]"], [2, "Named"], [3, "last\nline"], [null, undefined]]);
});

test("the raw source budget admits the exact limit and refuses longer bodies without adopting nested notes", { timeout: 5000 }, () => {
  const accepted = "^[" + "x".repeat(MAX_INLINE_FOOTNOTE_SOURCE - 3) + "]";
  assert.equal(scanInlineFootnotes(accepted, [])[0]?.to, MAX_INLINE_FOOTNOTE_SOURCE);
  const rejected = "^[" + "x".repeat(MAX_INLINE_FOOTNOTE_SOURCE) + " ^[nested]]\n\n^[later\nbody]";
  assert.deepEqual(scanInlineFootnotes(rejected, []).map(note => note.content), ["later\nbody"]);
  assert.deepEqual(inline(rejected).map(note => note.content), ["later\nbody"]);
});

test("render projection preserves the exact mixed line-ending sequence and later heading/source mappings", () => {
  const text = "\ufeff# Before\r\n\r\nA ^[one [^named]\r\ntwo\nthree] tail [^named].\r\n\r\n# After\n\n[^named]: Named\r\n    Continued\n", cache = parseMarkdown(text);
  const rendered = planFootnoteRendering(text, cache, "multiline");
  assert.deepEqual(endings(rendered.source), endings(text));
  assert.equal(parseMarkdown(rendered.source).headings.find(heading => heading.heading === "After").position.start.line, cache.headings.find(heading => heading.heading === "After").position.start.line);
  assert.deepEqual(rendered.notes.map(note => [note.number, note.definition.content]), [[1, "one [^named]\r\ntwo\nthree"], [2, "Named\nContinued"]]);
  assert.deepEqual(rendered.references.map(reference => reference.number), [1, 2, 2]);
  assert.equal(new Set(rendered.references.map(reference => reference.token)).size, 3);
  assert.equal(rendered.notes[0].source.includes("[^named]"), false);
  assert.deepEqual(endings(rendered.notes[0].source), ["\r\n", "\n"]);
});

test("multiline render markers preserve surrounding prose paragraphs and never turn the suffix into code", () => {
  for (const [first, second] of [["\n", "\n"], ["\r\n", "\r\n"], ["\r\n", "\n"]]) {
    for (const padding of [" ", "     "]) {
      const text = "Before ^[one" + first + "two" + second + "three" + first + "four]" + padding + "tail." + first + first + "# After" + first;
      const cache = parseMarkdown(text), plan = planFootnoteRendering(text, cache, "paragraph");
      assert.equal(cache.footnotes.filter(note => note.inline).length, 1);
      assert.deepEqual(marked.lexer(plan.source).filter(token => token.type !== "space").map(token => token.type), ["paragraph", "heading"]);
      const html = marked.parse(plan.source);
      assert.equal((html.match(/<p>/g) ?? []).length, 1, "the token's hidden softlines must not create extra paragraphs");
      assert.equal(html.includes("<pre>"), false, "the suffix retains its original inline context");
      assert.match(html, /<p>Before [\s\S]*<\/span> +tail\.<\/p>/);
      assert.deepEqual(endings(plan.source), endings(text));
      assert.equal(parseMarkdown(plan.source).headings.find(item => item.heading === "After").position.start.line,
        cache.headings.find(item => item.heading === "After").position.start.line);
    }
  }
});

test("multiline editing preserves wrappers, existing mixed endings, surrounding bytes and later note content", () => {
  const text = "\ufeff😀 Before ^[one\r\ntwo\nthree] tail ^[Later\r\nbody] [^named].\r\n\r\n[^named]: Named\n", original = inline(text), definition = original[0];
  const edit = planFootnoteEdit(text, definition, "**Longer λ**\nTwo [brackets]\nThree\nFour", "\r\n");
  assert.equal(edit.insert, "^[**Longer λ**\r\nTwo [brackets]\nThree\r\nFour]");
  assert.equal(edit.text, text.replace("^[one\r\ntwo\nthree]", edit.insert));
  assert.deepEqual(inline(edit.text).map(note => normalized(note.content)), ["**Longer λ**\nTwo [brackets]\nThree\nFour", "Later\nbody"]);
  assert.notEqual(inline(edit.text)[1].id, original[1].id);
  assert.equal(parseMarkdown(edit.text).footnotes.find(note => !note.inline).id, "named");
  const shrink = planFootnoteEdit(edit.text, inline(edit.text)[0], "One line", "\r\n");
  assert.equal(shrink.text, text.replace("^[one\r\ntwo\nthree]", "^[One line]"));
});

test("an unchanged normalized dialog draft preserves original escaping, whitespace and mixed source spelling", () => {
  const body = "  λ \\] [bracket]  \r\nsecond  \nlast", text = "Before ^[" + body + "] after", definition = inline(text)[0];
  const result = planFootnoteEdit(text, definition, normalized(body), "\r\n");
  assert.equal(result.text, text); assert.equal(result.insert, "^[" + body + "]");
});

test("unsupported multiline replacements refuse without truncating source or changing later definitions", () => {
  const text = "Before ^[Current\nbody] after ^[Later].\n\n[^named]: Named\n", definition = inline(text)[0];
  for (const content of ["", " \n ", "One\n\nTwo", "One\n# Heading", "One\n- List", "One\n```\ncode", "Nested\n^[note]", "Early ]\ntruncated", "[Unbalanced\nbody", "<!--\nunfinished", "x".repeat(MAX_INLINE_FOOTNOTE_SOURCE)]) {
    assert.throws(() => planFootnoteEdit(text, definition, content, "\n"), /parses/, content.slice(0, 40));
    assert.equal(text.slice(definition.position.end.offset), " after ^[Later].\n\n[^named]: Named\n");
  }
});

test("multiline definition edits refuse stale raw content and line/column positions", () => {
  const text = "Before ^[Current\r\nbody] after", definition = inline(text)[0];
  for (const mutate of [note => { note.content = note.content.replace("\r\n", "\n"); }, note => { note.position.end.line--; }, note => { note.position.end.ch++; }, note => { note.id += ":stale"; }]) {
    const stale = structuredClone(definition); mutate(stale);
    assert.throws(() => planFootnoteEdit(text, stale, "New\nbody", "\r\n"), /changed/);
  }
  assert.throws(() => planFootnoteEdit("Prefix\n" + text, definition, "New\nbody", "\r\n"), /changed/);
});

// Exercise the actual pane guards. The UI helper drives real CodeMirror history,
// physical input and disk bytes; these tests isolate every refusal boundary.
function paneFixture() {
  const path = "Multiline.md", file = { path }, text = "Dirty prose λ\r\nBefore ^[First\r\nSecond] after ^[Later].\r\n";
  const definition = inline(text)[0], key = "inline-target", snapshot = { id: 1, path, file, text, targets: new Map([[key, definition.position]]) };
  const state = { text, current: true, live: true, changes: [], reads: 0, refreshed: 0, scheduled: 0, selections: [], modes: [] };
  const session = { originRoot: "fixture", dirty: true, document: { file: { path }, version: "v1" }, isReloading: false };
  const view = { file, session, isLoaded: true, isSaving: false, leaf: { id: "source" }, setMode: mode => state.modes.push(mode), editor: {
    cm: { state: { lineBreak: "\r\n" } }, getValue: () => state.text,
    replaceExpected(expected, from, to, insert, origin) { assert.equal(expected, state.text); state.changes.push({ from, to, insert, origin }); state.text = state.text.slice(0, from) + insert + state.text.slice(to); },
    setSelection: (from, to) => state.selections.push({ from, to }), scrollIntoView() {}, focus() {},
  } };
  const files = new Map([[path, file]]), app = { vault: { rootPath: "fixture", readOnly: false, getFileByPath: value => files.get(value), readDocument: async () => { state.reads++; return { version: "v1" }; } },
    workspace: { sessions: new Map([[path, session]]), setActiveLeaf() {} }, metadataCache: { updateOpenDocuments: () => state.refreshed++ } };
  const owner = { app, sourceRoot: "fixture", snapshot, file, interactive: () => state.live && app.vault.rootPath === "fixture", source: () => view, schedule: () => state.scheduled++, noteView: null };
  return { state, owner, app, files, file, session, view, definition, snapshot,
    apply: (content = "Changed\nNext\nThird") => FootnotesPaneView.prototype.applyDefinition.call(owner, snapshot, definition, content, () => state.current),
    navigate: (generation = 1) => FootnotesPaneView.prototype.navigate.call(owner, key, generation, false) };
}

test("the actual pane applies a multiline draft as one isolated replacement while retaining preceding dirty prose", async () => {
  const fixture = paneFixture(); await fixture.apply();
  assert.equal(fixture.state.text, fixture.snapshot.text.replace("^[First\r\nSecond]", "^[Changed\r\nNext\r\nThird]"));
  assert.equal(fixture.state.changes.length, 1); assert.equal(fixture.state.changes[0].origin, "input.footnote");
  assert.equal(fixture.state.reads, 1); assert.equal(fixture.state.refreshed, 1); assert.equal(fixture.session.dirty, true);
});

test("the actual pane validates an unchanged multiline draft without a transaction", async () => {
  const fixture = paneFixture(); await fixture.apply("First\nSecond");
  assert.equal(fixture.state.reads, 1); assert.deepEqual(fixture.state.changes, []); assert.equal(fixture.state.text, fixture.snapshot.text);
});

test("read-only, stale, saving, reloading and detached multiline owners refuse before a disk read", async () => {
  for (const mutate of [fixture => { fixture.app.vault.readOnly = true; }, fixture => { fixture.state.current = false; }, fixture => { fixture.owner.snapshot = null; }, fixture => { fixture.files.clear(); }, fixture => { fixture.state.live = false; }, fixture => { fixture.view.isSaving = true; }, fixture => { fixture.session.isReloading = true; }, fixture => { fixture.app.workspace.sessions.clear(); }]) {
    const fixture = paneFixture(); mutate(fixture); await assert.rejects(fixture.apply(), /changed|saving|reloading/);
    assert.equal(fixture.state.reads, 0); assert.deepEqual(fixture.state.changes, []); assert.equal(fixture.state.text, fixture.snapshot.text);
  }
});

test("version changes, read-only changes, cancellation and dirty source edits during the version read refuse a multiline Apply", async () => {
  for (const mutate of [fixture => { fixture.app.vault.readOnly = true; }, fixture => { fixture.state.current = false; }, fixture => { fixture.state.text += "new dirty edit"; }, fixture => { fixture.session.document.version = "external"; }, fixture => { fixture.view.session = { ...fixture.session }; }, fixture => { fixture.session.originRoot = "other"; }]) {
    const fixture = paneFixture(), arrived = Promise.withResolvers(), release = Promise.withResolvers();
    fixture.app.vault.readDocument = async () => { arrived.resolve(); await release.promise; return { version: "v1" }; };
    const applying = fixture.apply(); await arrived.promise; mutate(fixture); release.resolve();
    await assert.rejects(applying, /changed/); assert.deepEqual(fixture.state.changes, []); assert.equal(fixture.state.refreshed, 0);
  }
  const fixture = paneFixture(); fixture.app.vault.readDocument = async () => ({ version: "unobserved-external" });
  await assert.rejects(fixture.apply(), /changed/); assert.deepEqual(fixture.state.changes, []);
});

test("the actual source navigation selects the entire multiline raw range and stale generations cannot move it", async () => {
  const fixture = paneFixture(); fixture.app.vault.readOnly = true; await fixture.navigate();
  assert.deepEqual(fixture.state.selections, [{ from: fixture.definition.position.start, to: fixture.definition.position.end }]);
  assert.deepEqual(fixture.state.modes, ["source"]); assert.equal(fixture.state.reads, 0);
  const stale = paneFixture(); await stale.navigate(0); assert.deepEqual(stale.state.selections, []);
  stale.state.text = "Prefix\r\n" + stale.state.text; await stale.navigate();
  assert.deepEqual(stale.state.selections, []); assert.equal(stale.state.refreshed, 1);
});
