import assert from "node:assert/strict";
import test from "node:test";
import { composerFragment, composerHeading, markdownSlides, parseMarkdown } from "../client/markdown.ts";

const lines = [
  "---", 'opaque: "Preserve λ 😀"', 'related: "[[Front target#Known|Front label]]"', "---", "# Before HTML", "Before body.", "",
  '<details><summary>Raw details</summary><p>[[Hidden HTML]] #hidden ^hidden</p></details>', "",
  "# After HTML λ 😀", "", "Visible [[Target#Part|Label Ω]] and [caption](Other%20note.md#Heading) #outside ^after-html", "",
  "- [ ] Parent task", "  - Child [[Nested note]] ^nested-child", "", "> [!note]+ Callout", "> Body [[Callout note]]", "",
  "```md", "# Hidden fence", "[[Hidden code]] #code ^code", "```", "", "## After fence", "",
  "| First | Second |", "| --- | --- |  ", "| λ | 😀 |", "", "^table-after-html", "",
  "Text [ref][destination] and footnote [^note] with $[[not a link]]$ and inline ^[Inline Ω].", "", "[destination]: <Reference%20target.md#Part>", "",
  "[^note]: Footnote λ [[Footnote target]]", "    continued 😀.", "", "# End", "End body.", "",
];
const source = (eol = "\r\n") => lines.join(eol);
const location = (text, offset) => ({ offset, line: text.slice(0, offset).split("\n").length - 1, ch: offset - text.lastIndexOf("\n", offset - 1) - 1 });
function assertPositions(text, value) {
  if (!value || typeof value !== "object") return;
  if (value.start && value.end && Number.isSafeInteger(value.start.offset)) {
    assert.deepEqual(value.start, location(text, value.start.offset)); assert.deepEqual(value.end, location(text, value.end.offset));
    assert.ok(value.start.offset >= 0 && value.end.offset >= value.start.offset && value.end.offset <= text.length);
  }
  for (const item of Object.values(value)) if (item && typeof item === "object") {
    if (Array.isArray(item)) for (const entry of item) assertPositions(text, entry); else assertPositions(text, item);
  }
}
function semantic(cache) {
  return {
    headings: cache.headings.map(item => [item.heading, item.level, item.position.start.line]),
    links: cache.links.map(item => [item.kind, item.link, item.displayText, item.position.start.line]),
    embeds: cache.embeds.map(item => [item.kind, item.link, item.position.start.line]),
    tags: cache.tags.map(item => [item.tag, item.position.start.line]),
    blocks: Object.entries(cache.blocks).map(([id, item]) => [id, item.position.start.line, item.idPosition.start.line]),
    sections: cache.sections.map(item => [item.type, item.position.start.line]),
    listItems: cache.listItems.map(item => [item.position.start.line, item.task]),
    footnotes: cache.footnotes.map(item => [item.inline ? "inline" : item.id, item.content, item.position.start.line, item.inline ?? false]),
    footnoteRefs: cache.footnoteRefs.map(item => [item.id, item.position.start.line]),
  };
}

test("the original failed CRLF HTML fixture exposes every rendered heading without moving its original offsets", () => {
  const text = ["---", 'opaque: "Bulk intent λ"', "---", "[[Bulk#Child heading|Reveal child heading]] [[Bulk#^list-deep|Reveal list block]] [[Bulk#^callout-target|Reveal callout block]]", "", "# Bulk root λ", "Root body.", "", "## Child heading", "Child body.", "",
    "- [ ] Parent list", "  - Child list", "    - Deep list target 😀 ^list-deep", "  - Sibling list", "- Other list", "  - Last child", "",
    "> [!note]+ Bulk outer", "> calloutbulkneedle outer.", ">", "> > [!tip]- Bulk nested", "> > calloutbulkneedle nested 😀 ^callout-target", "", "> [!warning]- Bulk separate", "> calloutbulkneedle separate.", "",
    '<details><summary>Raw details</summary><p>calloutbulkneedle raw-hidden.</p></details>', "", "![[Embedded]]", "", "```js", "const retained = 42;", "```", "", "# End", ""].join("\r\n");
  const cache = parseMarkdown(text);
  assert.deepEqual(cache.headings.map(item => [item.heading, item.position.start.line]), [["Bulk root λ", 5], ["Child heading", 8], ["End", 35]]);
  assert.equal(cache.headings.at(-1).position.start.offset, text.indexOf("# End"));
  assert.ok(cache.embeds.some(item => item.link === "Embedded"));
  assert.ok(cache.sections.some(item => item.type === "code" && text.slice(item.position.start.offset, item.position.end.offset).includes("const retained = 42")));
  assertPositions(text, cache);
});

test("CRLF HTML termination preserves LF-equivalent headings, lists, links, blocks, math and footnotes", () => {
  const text = source(), cache = parseMarkdown(text), lf = parseMarkdown(source("\n"));
  assert.deepEqual(semantic(cache), semantic(lf));
  assert.deepEqual(cache.headings.map(item => item.heading), ["Before HTML", "After HTML λ 😀", "After fence", "End"]);
  assert.deepEqual(cache.tags.map(item => item.tag), ["#outside"]);
  assert.equal(cache.links.some(item => /Hidden|not a link/.test(item.link)), false);
  assert.equal(cache.blocks.hidden, undefined); assert.equal(cache.blocks.code, undefined);
  assertPositions(text, cache);
});

test("all syntax positions remain original UTF-16 offsets after CRLF HTML and Unicode", () => {
  const text = source(), cache = parseMarkdown(text);
  const heading = cache.headings.find(item => item.heading === "After HTML λ 😀");
  assert.deepEqual(heading.position.start, { line: 9, ch: 0, offset: text.indexOf("# After HTML λ 😀") });
  const wiki = cache.links.find(item => item.kind === "wiki" && item.link === "Target#Part");
  assert.equal(text.slice(wiki.position.start.offset, wiki.position.end.offset), "[[Target#Part|Label Ω]]");
  assert.equal(text.slice(wiki.targetPosition.start.offset, wiki.targetPosition.end.offset), "Target#Part");
  const markdown = cache.links.find(item => item.kind === "markdown");
  assert.equal(text.slice(markdown.targetPosition.start.offset, markdown.targetPosition.end.offset), "Other%20note.md#Heading");
  assert.equal(text.slice(cache.blocks["after-html"].idPosition.start.offset, cache.blocks["after-html"].idPosition.end.offset), "^after-html");
  assertPositions(text, cache);
});

test("literal and math ranges after HTML still slice the exact original source and do not cover later headings", () => {
  const text = source(), cache = parseMarkdown(text), expression = "$[[not a link]]$", from = text.indexOf(expression);
  assert.deepEqual(cache.math, [{ from, to: from + expression.length }]);
  for (const range of [...cache.literal, ...cache.ignored, ...cache.math]) assert.ok(range.from >= 0 && range.to >= range.from && range.to <= text.length);
  const html = cache.literal.find(range => text.slice(range.from, range.to).startsWith("<details>"));
  assert.equal(text.slice(html.from, html.to).replace(/\r$/, ""), lines[7]);
  const heading = text.indexOf("# After HTML λ 😀");
  assert.equal(cache.ignored.some(range => range.from <= heading && range.to > heading), false);
  assert.equal(text.slice(cache.math[0].from, cache.math[0].to), expression);
});

test("mixed LF and CRLF logical blank lines retain semantic and coordinate parity", () => {
  const text = lines.map((line, index) => line + (index === lines.length - 1 ? "" : index % 3 === 0 ? "\n" : "\r\n")).join("");
  assert.deepEqual(semantic(parseMarkdown(text)), semantic(parseMarkdown(source("\n"))));
  assertPositions(text, parseMarkdown(text));
});

test("BOM and frontmatter source positions retain every original code unit", () => {
  const text = "\ufeff" + source(), cache = parseMarkdown(text);
  assert.equal(cache.frontmatter.opaque, "Preserve λ 😀");
  assert.equal(cache.frontmatterPosition.start.offset, 0);
  assert.equal(cache.headings[0].position.start.offset, text.indexOf("# Before HTML"));
  assert.equal(cache.frontmatterLinks[0].original, "[[Front target#Known|Front label]]");
  assert.equal(text.slice(cache.frontmatterLinks[0].position.start.offset, cache.frontmatterLinks[0].position.end.offset), cache.frontmatterLinks[0].original);
  assertPositions(text, cache);
});

for (const [name, html] of [
  ["one-line details", '<details><summary>Raw</summary><p>[[Hidden]]</p></details>'],
  ["multiline div", '<div>\r\n# Hidden heading\r\n[[Hidden]]\r\n</div>'],
  ["multiline comment", '<!--\r\n# Hidden heading\r\n[[Hidden]]\r\n-->'],
  ["script block", '<script>\r\n\r\n# Hidden heading\r\n[[Hidden]]\r\n</script>'],
  ["pre block", '<pre>\r\n\r\n# Hidden heading\r\n[[Hidden]]\r\n</pre>'],
]) test(`${name} ends at its supported boundary and following Markdown is indexed`, () => {
  const text = "# Before\r\nBefore.\r\n\r\n" + html + "\r\n\r\n# Following\r\nFollowing [[Visible]] ^following\r\n";
  const cache = parseMarkdown(text);
  assert.deepEqual(cache.headings.map(item => item.heading), ["Before", "Following"]);
  assert.deepEqual(cache.links.map(item => item.link), ["Visible"]);
  assert.equal(cache.blocks.following.idPosition.start.offset, text.indexOf("^following")); assertPositions(text, cache);
});

test("unclosed special raw blocks keep later apparent headings, links and IDs excluded", () => {
  for (const opening of ["<script>", "<pre>", "<!--"]) {
    const text = "# Before\r\nBody.\r\n\r\n" + opening + "\r\n\r\n# Still raw\r\n[[Still raw]] #raw ^raw\r\n";
    const cache = parseMarkdown(text);
    assert.deepEqual(cache.headings.map(item => item.heading), ["Before"]); assert.deepEqual(cache.links, []); assert.deepEqual(cache.tags, []); assert.equal(cache.blocks.raw, undefined);
  }
});

test("blank lines containing tabs and spaces terminate ordinary raw HTML without exposing its own contents", () => {
  const text = '<div>[[Hidden]] #hidden</div>\r\n \t\r\n# After\r\nVisible [[Shown]] ^shown\r\n';
  const cache = parseMarkdown(text);
  assert.deepEqual(cache.headings.map(item => item.heading), ["After"]); assert.deepEqual(cache.links.map(item => item.link), ["Shown"]); assert.deepEqual(cache.tags, []);
  assert.equal(cache.blocks.shown.idPosition.start.offset, text.indexOf("^shown")); assertPositions(text, cache);
});

test("nested task parents, whole table ownership and code exclusions remain exact after raw HTML", () => {
  const text = source(), cache = parseMarkdown(text), parent = text.indexOf("- [ ] Parent task"), child = text.indexOf("- Child [[Nested note]]");
  assert.deepEqual(cache.listItems.map(item => [item.position.start.offset, item.parent, item.task]), [[parent, -1, " "], [child, parent, undefined]]);
  const table = cache.sections.find(item => item.type === "table"); assert.equal(table.position.start.offset, text.indexOf("| First | Second |"));
  assert.equal(cache.blocks["table-after-html"].position.start.offset, table.position.start.offset);
  assert.equal(cache.blocks["table-after-html"].position.end.offset, table.position.end.offset);
  assert.ok(cache.ignored.some(range => text.slice(range.from, range.to).startsWith("```md")));
  assertPositions(text, cache);
});

test("reference and footnote positions after HTML point at unchanged original definitions", () => {
  const text = source(), cache = parseMarkdown(text), reference = cache.links.find(item => item.kind === "reference");
  assert.equal(text.slice(reference.targetPosition.start.offset, reference.targetPosition.end.offset), "Reference%20target.md#Part");
  assert.equal(reference.original, "[ref][destination]");
  const definition = cache.footnotes.find(item => item.id === "note" && !item.inline);
  assert.equal(definition.position.start.offset, text.indexOf("[^note]:")); assert.match(definition.content, /continued 😀/);
  assert.equal(cache.footnoteRefs.find(item => item.id === "note").position.start.offset, text.indexOf("[^note] with"));
  assertPositions(text, cache);
});

test("composer extraction retains the original post-HTML heading section and reference definition bytes", () => {
  const text = source(), cache = parseMarkdown(text), heading = composerHeading(text, 9, cache);
  assert.equal(heading.from, text.indexOf("# After HTML λ 😀")); assert.equal(text.slice(heading.from, heading.to).startsWith("# After HTML λ 😀\r\n"), true);
  const from = text.indexOf("Text [ref][destination]"), to = from + "Text [ref][destination]".length;
  const fragment = composerFragment(text, from, to);
  assert.ok(fragment.startsWith("Text [ref][destination]")); assert.ok(fragment.includes("[destination]: <Reference%20target.md#Part>"));
  assert.ok(fragment.includes("\r\n")); assert.equal(text, source());
});

test("Slides recognizes post-HTML separators while keeping raw Windows content and shared definitions", () => {
  const text = '<details><summary>Raw</summary></details>\r\n\r\n# First λ\r\nFirst [[One]].\r\n\r\n---\r\n\r\n# Second 😀\r\nSecond [ref][shared].\r\n\r\n[shared]: Target.md\r\n';
  const slides = markdownSlides(text);
  assert.equal(slides.length, 2); assert.ok(slides[0].includes("# First λ\r\nFirst [[One]].")); assert.ok(slides[1].includes("# Second 😀\r\nSecond [ref][shared]."));
  assert.ok(slides.every(slide => slide.includes("[shared]: Target.md")));
  assert.equal(text.includes("---\r\n"), true);
});

test("LF-only documents keep the existing grammar and no carriage returns are fabricated", () => {
  const text = source("\n"), cache = parseMarkdown(text); assert.equal(text.includes("\r"), false);
  assert.deepEqual(cache.headings.map(item => item.heading), ["Before HTML", "After HTML λ 😀", "After fence", "End"]);
  assertPositions(text, cache);
});
