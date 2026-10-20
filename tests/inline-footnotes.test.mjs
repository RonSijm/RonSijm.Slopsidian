import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let directory, parseMarkdown, composerFragment, insertMarkdown, scanInlineFootnotes, footnoteEntries, planFootnoteRendering, planFootnoteEdit;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "inline-footnotes-tests-"));
  const output = join(directory, "client.mjs");
  await build({ stdin: { contents: 'export { parseMarkdown, composerFragment, insertMarkdown } from "./client/markdown"; export { scanInlineFootnotes } from "./client/inline-footnotes"; export { footnoteEntries } from "./client/footnotes-pane-model"; export { planFootnoteRendering } from "./client/footnote-render-model"; export { planFootnoteEdit } from "./client/footnote-edit";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  ({ parseMarkdown, composerFragment, insertMarkdown, scanInlineFootnotes, footnoteEntries, planFootnoteRendering, planFootnoteEdit } = await import(pathToFileURL(output).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/inline-footnotes-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const inline = text => parseMarkdown(text).footnotes.filter(note => note.inline);
const plan = text => planFootnoteRendering(text, parseMarkdown(text), "fixture");

test("inline footnotes and named references share first-reference numbering with exact Unicode/CRLF ranges", () => {
  const text = "😀 First^[**α**] then [^named] and ^[second].\r\n\r\n[^named]: Named body\r\n", cache = parseMarkdown(text);
  assert.deepEqual(footnoteEntries(cache, text).map(item => [item.number, item.definitions[0]?.content]), [[1, "**α**"], [2, "Named body"], [3, "second"]]);
  assert.deepEqual(cache.footnoteRefs.map(reference => reference.id), ["named"]);
  for (const note of inline(text)) {
    assert.equal(text.slice(note.position.start.offset, note.position.end.offset), "^[" + note.content + "]");
    assert.deepEqual(note.labelPosition, note.position); assert.equal(note.position.start.ch, note.position.start.offset);
  }
});
test("inline detection excludes properties, code, HTML and percent comments, math and escaped carets", () => {
  const text = ["---", "title: '^[properties]'", "---", "`^[code]` \\^[escaped] <!-- ^[html comment] -->", "%% ^[percent] %%", "$^[math]$", "```md", "^[fenced]", "```", "", "    ^[indented]", "", "^[real]", "%%", "^[block comment]", "%%"].join("\n");
  assert.deepEqual(inline(text).map(note => note.content), ["real"]);
});
test("balanced inline bodies retain Markdown links, wiki links, tags, code brackets and escaped brackets", () => {
  const source = "Before ^[Body [caption](./Other.md) [[Target]] #inside and `]` and escaped\\] [ordinary]]. After";
  const cache = parseMarkdown(source), notes = cache.footnotes.filter(note => note.inline);
  assert.equal(notes.length, 1); assert.ok(notes[0].content.includes("[ordinary]"));
  assert.deepEqual(cache.links.map(link => link.link).sort(), ["./Other.md", "Target"].sort());
  assert.deepEqual(cache.tags.map(tag => tag.tag), ["#inside"]);
});
test("inline openers in link/image labels, destinations, HTML attributes and autolinks stay literal", () => {
  const text = '[label ^[label]](Target.md) ![image ^[image]](asset.png) [x](https://example.invalid/^[url]) <span title="^[attribute]">text</span> <https://example.invalid/^[auto]> ^[visible]';
  assert.deepEqual(inline(text).map(note => note.content), ["visible"]);
});
test("escaped carets and closing brackets use backslash parity without truncating Unicode source", () => {
  const text = String.raw`\^[literal] \\^[real \] bracket] ^[λ [中文]]`;
  const notes = inline(text);
  assert.deepEqual(notes.map(note => note.content), [String.raw`real \] bracket`, "λ [中文]"]);
  assert.ok(notes.every(note => text.slice(note.position.start.offset, note.position.end.offset).endsWith("]")));
});
test("empty, unfinished and nested inline forms stay literal while later paragraphs retain valid notes", () => {
  const text = "^[] ^[ ] ^[outer ^[nested]] ^[unfinished\n\n^[valid]\r\n^[first\nsecond]";
  assert.deepEqual(inline(text).map(note => note.content), ["valid", "first\nsecond"]);
});
test("malformed nested opener scanning stays iterative", { timeout: 5000 }, () => {
  assert.deepEqual(scanInlineFootnotes("^[".repeat(100000) + "unfinished", []), []);
});
test("code and math inside a body are opaque to bracket matching", () => {
  const text = "^[Before `]` and $x]$ after]";
  assert.deepEqual(inline(text).map(note => note.content), ["Before `]` and $x]$ after"]);
});
test("generated identities cannot capture explicit named or missing references", () => {
  const text = "Text ^[body] [^inline:5] [^inline:5:1].\n\n[^inline:5]: Named\n", cache = parseMarkdown(text);
  assert.equal(cache.footnotes.find(note => note.inline).id, "inline:5:2");
  const entries = footnoteEntries(cache, text);
  assert.equal(entries.find(entry => entry.id === "inline:5").definitions[0].content, "Named");
  assert.equal(entries.find(entry => entry.id === "inline:5:1").definitions.length, 0);
});
test("inline forms inside named definitions do not create nested global footnotes", () => {
  const text = "[^a]: Body ^[not nested]\n    More ^[also not nested]\n\nOutside ^[real]\n";
  assert.deepEqual(inline(text).map(note => note.content), ["real"]);
});
test("render plans replace only semantic references, mask definitions and preserve source lines", () => {
  const text = "---\r\ntitle: '^[literal]'\r\n---\r\n# Heading\r\nA^[Inline] [^a] again [^a].\r\n\r\n[^a]: Named\r\n    Continued\r\n\r\n# After\n";
  const rendered = plan(text);
  assert.deepEqual(rendered.notes.map(note => [note.number, note.definition.content]), [[1, "Inline"], [2, "Named\nContinued"]]);
  assert.equal(rendered.references.length, 3);
  assert.equal(new Set(rendered.references.map(reference => reference.token)).size, 3);
  assert.deepEqual(rendered.references.map(reference => reference.number), [1, 2, 2]);
  assert.equal(rendered.source.split(/\r\n|\r|\n/).length, text.split(/\r\n|\r|\n/).length);
  assert.ok(rendered.source.startsWith("---\r\ntitle: '^[literal]'\r\n---\r\n# Heading\r\n"));
  assert.ok(rendered.source.endsWith("# After\n")); assert.ok(!rendered.source.includes("[^a]:"));
});
test("rendered note bodies resolve transitive named references once without recursively rendering cycles", () => {
  const text = "One^[Inline [^a]] and [^b].\n\n[^a]: A [^b]\n[^b]: B [^a]\n", rendered = plan(text);
  assert.equal(rendered.notes.length, 3); assert.equal(rendered.references.length, 5);
  assert.deepEqual(rendered.notes.map(note => note.number), [1, 2, 3]);
  assert.ok(rendered.notes.every(note => !note.source.includes("[^")));
});
test("ambiguous or missing named notes never become navigation markers", () => {
  const text = "[^twice] [^missing] ^[unique]\n\n[^twice]: First\n[^twice]: Second\n", rendered = plan(text);
  assert.equal(rendered.notes.length, 1); assert.equal(rendered.references.length, 1);
  assert.ok(rendered.source.includes("[^twice] [^missing]"));
  assert.ok(!rendered.source.includes("First")); assert.ok(!rendered.source.includes("Second"));
});
test("render marker attributes only use validated per-render nonces", () => {
  for (const nonce of ["", 'bad" onclick="x', "x".repeat(129), "../bad"]) { assert.throws(() => planFootnoteRendering("^[Body]", parseMarkdown("^[Body]"), nonce), /nonce/); }
  assert.notEqual(planFootnoteRendering("^[Body]", parseMarkdown("^[Body]"), "first").references[0].token, planFootnoteRendering("^[Body]", parseMarkdown("^[Body]"), "second").references[0].token);
});
test("inline edits preserve wrappers and surrounding CRLF while later generated identities may shift", () => {
  const text = "\ufeffOne ^[First] then [^a] and ^[Second].\r\n\r\n[^a]: Named\r\n", definition = inline(text)[0];
  const edited = planFootnoteEdit(text, definition, "**Longer λ** [link](Other.md)", "\r\n");
  assert.equal(edited.text, text.replace("^[First]", "^[**Longer λ** [link](Other.md)]"));
  assert.deepEqual(inline(edited.text).map(note => note.content), ["**Longer λ** [link](Other.md)", "Second"]);
  assert.notEqual(inline(edited.text)[1].id, inline(text)[1].id);
});
test("named-definition editing retains later inline notes after a source-length change", () => {
  const text = "[^a]: Short\n\nOutside ^[inline].\n", definition = parseMarkdown(text).footnotes[0];
  assert.equal(planFootnoteEdit(text, definition, "A longer named definition", "\n").text, text.replace("Short", "A longer named definition"));
});
test("inline drafts refuse multiple paragraphs, empty, nested, unbalanced and stale replacements", () => {
  const text = "Before ^[Current] after", definition = inline(text)[0];
  for (const content of ["One\n\nTwo", "", " ", "Nested ^[note]", "Stray ] bracket"]) { assert.throws(() => planFootnoteEdit(text, definition, content, "\n"), /parses/); }
  assert.equal(planFootnoteEdit(text, definition, "Current", "\n").text, text);
  assert.throws(() => planFootnoteEdit("Inserted " + text, definition, "New", "\n"), /changed/);
  const cache = parseMarkdown(text); cache.footnotes[0].content = "Tampered";
  assert.throws(() => footnoteEntries(cache, text), /source/);
});
test("selection composition carries named dependencies inside inline notes without exporting generated identities", () => {
  const text = "Before ^[Inline [^a]] after\n\n[^a]: A [^b]\n[^b]: B\n", definition = inline(text)[0];
  const extracted = composerFragment(text, definition.position.start.offset, definition.position.end.offset);
  assert.ok(extracted.startsWith("^[Inline [^a]]")); assert.ok(extracted.includes("[^a]: A [^b]")); assert.ok(extracted.includes("[^b]: B"));
  assert.ok(!extracted.includes("inline:"));
  const combined = insertMarkdown("First ^[one]", "Second ^[two]");
  assert.deepEqual(inline(combined).map(note => note.content), ["one", "two"]);
});
