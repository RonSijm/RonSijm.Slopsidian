import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { marked } from "marked";
import { parseDocument } from "yaml";
import { root } from "./host.mjs";

const { readWebArticle } = createRequire(import.meta.url)("../desktop/web-reader.cjs");
let temporary, clipPath, clipName, webClip, markdownText, markdownCode, markdownUrl, orderedListMarkers, expandClipTable, selectionMarkdown, withClipProperties;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-clip-tests-"));
  const entry = join(temporary, "clip.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-clip-policy"; export * from "./client/web-clip-markdown";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ clipPath, clipName, webClip, markdownText, markdownCode, markdownUrl, orderedListMarkers, expandClipTable, selectionMarkdown, withClipProperties } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });
const source = "https://example.com/story", endpoint = "http://127.0.0.1:59001";
const payload = (extra = {}) => ({ url: source, title: "A story", markdown: "# A story\n\nAn article.\n", navigationId: 1, ...extra });
const clipOptions = (extra = {}) => ({ title: "A reviewed title", tags: "research, project/nested", clippedAt: "2026-10-23T14:00:00.000Z", ...extra });
function properties(markdown) {
  const header = markdown.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(header);
  const document = parseDocument(header[1]); assert.deepEqual(document.errors, []);
  return { values: document.toJSON(), body: markdown.slice(header[0].length) };
}

test("reviewed clipping properties add typed title/source/time/tags and preserve the entire original Markdown body", () => {
  const clip = payload({ markdown: "# Body\r\n\r\nLiteral 中文 😀 **text**.\r\n" }), original = structuredClone(clip);
  const result = properties(withClipProperties(clip, clipOptions()));
  assert.deepEqual(result.values, { title: "A reviewed title", source, clipped: "2026-10-23T14:00:00.000Z", tags: ["research", "project/nested"] });
  assert.equal(result.body, clip.markdown); assert.deepEqual(clip, original);
});

test("clipping property titles quote YAML syntax, newlines and nonprinting Unicode without injecting fields, aliases or documents", () => {
  const title = '"\\\n---\n&ref *ref !!str [bad]: value\u0085\u2028\u2029\u0001';
  const result = properties(withClipProperties(payload(), clipOptions({ title, tags: "" })));
  assert.equal(result.values.title, title); assert.deepEqual(Object.keys(result.values), ["title", "source", "clipped", "tags"]);
  assert.deepEqual(result.values.tags, []); assert.equal(result.body, payload().markdown);
});

test("clipping tags trim optional hashes, retain Unicode/nested spelling and deduplicate while keeping user order", () => {
  const result = properties(withClipProperties(payload(), clipOptions({ tags: " #research, project/nested, 中文, research, Project, , " })));
  assert.deepEqual(result.values.tags, ["research", "project/nested", "中文", "Project"]);
});

test("invalid clipping tags and tag limits refuse the whole properties preview without truncating or silently dropping names", () => {
  for (const tags of ["two words", "123", "a//b", "/root", "tail/", "name: value", "a,#", "a".repeat(101), Array.from({ length: 51 }, (_, index) => "tag" + index).join(","), "a".repeat(2049)]) {
    assert.throws(() => withClipProperties(payload(), clipOptions({ tags })), /tag/i);
  }
  assert.equal(properties(withClipProperties(payload(), clipOptions({ tags: "a".repeat(100) }))).values.tags[0].length, 100);
});

test("clipping time is one canonical UTC snapshot and property titles remain bounded text", () => {
  for (const clippedAt of ["", "tomorrow", "2026-02-30T14:00:00.000Z", "2026-10-23", "2026-10-23T14:00:00+00:00"]) {
    assert.throws(() => withClipProperties(payload(), clipOptions({ clippedAt })), /time/i);
  }
  for (const title of ["x".repeat(1025), "bad\0title", null]) { assert.throws(() => withClipProperties(payload(), clipOptions({ title })), /title/i); }
  const clip = payload(), options = clipOptions(); assert.equal(withClipProperties(clip, options), withClipProperties(clip, options));
  assert.equal(properties(withClipProperties(clip, clipOptions({ title: "" }))).values.title, "");
});

test("properties retain selection Markdown literally and count the header toward the total clipping limit", () => {
  const text = selectionMarkdown("Page", source, "---\n![[Secret]]\n<script>literal</script>");
  assert.equal(properties(withClipProperties(payload({ markdown: text }), clipOptions())).body, text);
  assert.throws(() => withClipProperties(payload({ markdown: "x".repeat(2_000_000) }), clipOptions()), /too large/i);
  for (const extra of [{ url: "file:///vault" }, { navigationId: -1 }, { markdown: "bad\0text" }]) { assert.throws(() => withClipProperties(payload(extra), clipOptions())); }
});

test("clip destinations accept nested Unicode Markdown notes and reject traversal, configuration, reserved and non-Markdown paths", () => {
  for (const path of ["Story.md", "Web clips/Nested/中文 😀.md", "Story.MD"]) { assert.equal(clipPath(path), path); }
  for (const path of ["", "/root.md", "../escape.md", "Web/../Escape.md", "Web//Story.md", ".obsidian/webviewer.md", "Web/.hidden.md", "D:/Escape.md", "Web\\Story.md", "CON.md", "Web/LPT1.md", "Web/folder./Story.md", " Web/Story.md", "Story.md ", "Story.txt", ".md", "Web/a\0.md", "a".repeat(256) + ".md", "a".repeat(4100)]) {
    assert.throws(() => clipPath(path), undefined, path);
  }
});
test("clip suggestions sanitize page titles, honor the configured folder and avoid case-insensitive file or folder collisions", () => {
  const occupied = new Set(["web clips/a story.md", "web clips/a story 2.md"]);
  assert.equal(clipName("A story", "Web clips", path => occupied.has(path.toLowerCase())), "Web clips/A story 3.md");
  assert.equal(clipName("CON", "", () => false), "Article CON.md");
  assert.equal(clipName(".. <a>: 中文? 😀/ story .", undefined, () => false), "a 中文 😀 story.md");
  assert.equal(clipName("...", "", () => false), "Web article.md");
  assert.ok(clipName("x".repeat(119) + "😀", "", () => false).length <= 124);
  for (const folder of ["../Outside", ".obsidian", "/Root", "Nested\\Folder", true]) { assert.throws(() => clipName("Title", folder, () => false)); }
  assert.throws(() => clipName("Title", "", () => true), /all suggested/);
});
test("clip DTO binds reviewed Markdown to the source URL and navigation and refuses malformed or oversized output", () => {
  const value = payload(); assert.equal(webClip(value, source, 1), value);
  for (const extra of [{ url: source + "?other" }, { navigationId: 2 }, { title: "x".repeat(1025) }, { markdown: " " }, { markdown: "x".repeat(2_000_001) }, { markdown: "bad\0text" }]) {
    assert.throws(() => webClip(payload(extra), source, 1));
  }
  assert.throws(() => webClip(payload(), source, -1));
});
test("page text remains literal Markdown without activating HTML, wiki embeds, headings, math or comments", () => {
  const original = '<img src=x onerror=alert(1)> ![[Secret]] [link](javascript:alert(1)) # heading ==mark== $math$ %%comment%%';
  const escaped = markdownText(original), html = marked.parse(escaped);
  assert.ok(!html.includes("<img")); assert.ok(!html.includes("<a ")); assert.ok(!html.includes("<h1"));
  assert.ok(html.includes("&lt;img")); assert.ok(escaped.includes("\\!\\[\\[Secret\\]\\]")); assert.ok(escaped.includes("\\$math\\$"));
  assert.equal(markdownText("1. text\nnext &copy;"), "1\\. text next &amp;copy;");
});
test("inline and block code choose fences longer than article backticks and never inherit an active language", () => {
  const text = "```mermaid\ngraph TD\n```\n<script>bad()</script>\n\nlast";
  const code = markdownCode(text, true), html = marked.parse(code);
  assert.ok(code.includes("````\n```mermaid")); assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes('class="language-mermaid"'));
  assert.ok(html.includes("\n\nlast")); assert.equal(markdownCode("a`b"), "``a`b``");
  assert.equal(markdownCode("`a`"), "`` `a` ``");
});
test("Markdown links are HTTP(S)-only, canonicalize relative paths and encode delimiters without active schemes or credentials", () => {
  assert.equal(markdownUrl("../next?q=one%20two#part", source), "<https://example.com/next?q=one%20two#part>");
  assert.equal(markdownUrl("https://example.com/a(b)>x", source), "<https://example.com/a(b)%3Ex>");
  for (const url of ["javascript:alert(1)", "file:///secret", "data:text/html,bad", "https://user:pass@example.com", "https://example.com/\nbad"]) { assert.equal(markdownUrl(url, source), null); }
});

test("ordered clips preserve decimal list starts and an explicit first-item value in rendered Markdown", () => {
  for (const [start, values, expected] of [["7", [null, null], 7], ["3", ["12", null], 12], [null, [null, null], 1]]) {
    const markers = orderedListMarkers(start, false, values);
    const markdown = markers.map((marker, index) => marker + "Item " + index).join("\n");
    const tokens = marked.lexer(markdown);
    assert.equal(tokens[0].type, "list"); assert.equal(tokens[0].ordered, true); assert.equal(tokens[0].start, expected);
    assert.equal(tokens[0].items.length, 2); assert.equal(markers[0], expected + ". ");
  }
});

test("list starts use HTML integer parsing and ignore invalid values without treating exponents or non-ASCII spaces as decimal starts", () => {
  for (const [start, expected] of [[" \t+0007tail", 7], ["1e2", 1], ["invalid", 1], ["", 1], ["\u00a07", 1], [null, 1]]) {
    assert.deepEqual(orderedListMarkers(start, false, [null, "bad", null]), [expected + ". ", (expected + 1) + ". ", (expected + 2) + ". "]);
  }
  assert.deepEqual(orderedListMarkers("7", false, [null, "8tail", "9"]), ["7. ", "8. ", "9. "]);
});

test("zero and nine-digit list starts remain valid ordered Markdown even when later ordinals exceed nine digits", () => {
  for (const start of [0, 999_999_999]) {
    const markers = orderedListMarkers(String(start), false, [null, null]);
    const token = marked.lexer(markers.map(marker => marker + "Item").join("\n"))[0];
    assert.equal(token.type, "list"); assert.equal(token.start, start); assert.equal(token.items.length, 2);
    assert.ok(markers.every(marker => /^\d{1,9}\. $/.test(marker)));
  }
});

test("alternating ordered-list delimiters preserve adjacent independent list starts without adding HTML or separator content", () => {
  const first = orderedListMarkers("7", false, [null, null], "."), second = orderedListMarkers("12", false, [null, null], ")");
  const markdown = first.map(marker => marker + "First").join("\n") + "\n\n" + second.map(marker => marker + "Second").join("\n");
  const lists = marked.lexer(markdown).filter(token => token.type === "list");
  assert.deepEqual(lists.map(list => [list.start, list.items.length]), [[7, 2], [12, 2]]); assert.doesNotMatch(markdown, /[<>]/);
});

test("unrepresentable reversed, negative, oversized or discontinuous list numbering rejects instead of silently renumbering", () => {
  for (const [start, reversed, values] of [["7", true, [null, null]], ["-1", false, [null]], ["1000000000", false, [null]], ["9007199254740993", false, [null]], ["7", false, [null, "20"]], ["7", false, [null, "-8"]]]) {
    const original = structuredClone(values);
    assert.throws(() => orderedListMarkers(start, reversed, values), /numbering.*Markdown/i); assert.deepEqual(values, original);
  }
});
const cell = (markdown, columns = 1, rows = 1) => ({ markdown, columns, rows });

test("merged table clips repeat formatted content in each covered slot without shifting later columns", () => {
  const input = [[[cell("Region", 1, 2), cell("**Forecast**", 2)], [cell("Spring"), cell("Autumn")]], [[cell("North", 1, 2), cell("12"), cell("[Notes](<https://example.com>)")], [cell("`a\\|b`"), cell("Literal \\| text")]]];
  const original = structuredClone(input);
  assert.deepEqual(expandClipTable(input), [["Region", "**Forecast**", "**Forecast**"], ["Region", "Spring", "Autumn"], ["North", "12", "[Notes](<https://example.com>)"], ["North", "`a\\|b`", "Literal \\| text"]]);
  assert.deepEqual(input, original);
});

test("zero row spans stop at their row group and positive spans can create bounded implied rows", () => {
  assert.deepEqual(expandClipTable([[[cell("South", 1, 0), cell("Shared", 2)], [cell("5"), cell("6")]], [[cell("Next"), cell("group")]]]), [["South", "Shared", "Shared"], ["South", "5", "6"], ["Next", "group", ""]]);
  assert.deepEqual(expandClipTable([[[cell("All", 1, 0), cell("Tall", 1, 3)]], [[cell("Footer", 2)]]]), [["All", "Tall"], ["All", "Tall"], ["All", "Tall"], ["Footer", "Footer"]]);
});

test("empty merged cells still reserve their slots and uneven source rows receive explicit empty cells", () => {
  assert.deepEqual(expandClipTable([[[cell("", 1, 2), cell("A"), cell("B")], [cell("C")], [], [cell("End")]]]), [["", "A", "B"], ["", "C", ""], ["", "", ""], ["End", "", ""]]);
  assert.deepEqual(expandClipTable([[], [[]]]), []);
});

test("overlapping article table spans refuse conversion without changing their source", () => {
  const input = [[[cell("A"), cell("B", 1, 2)], [cell("Collision", 2)]]], original = structuredClone(input);
  assert.throws(() => expandClipTable(input), /overlap.*Markdown/i); assert.deepEqual(input, original);
});

test("table limits apply to expanded dimensions, including implied rows and row-span offsets", () => {
  assert.equal(expandClipTable([[[cell("", 100, 1000)]]]).length, 1000);
  for (const input of [[[[cell("Wide", 101)]]], [[[cell("Tall", 1, 1001)]]], [Array.from({ length: 1001 }, () => [cell("A")])], [[[cell("First", 100, 2)], [cell("Offset")]]]]) {
    assert.throws(() => expandClipTable(input), /table.*too large/i);
  }
});

test("repeating merged content cannot amplify a small article beyond the Markdown output bound", () => {
  const input = [[[cell("x".repeat(21_000), 100)]]], original = structuredClone(input);
  assert.throws(() => expandClipTable(input), /table.*too large/i); assert.deepEqual(input, original);
  assert.throws(() => expandClipTable([[[cell("A", 2)]]], 10), /table.*too large/i);
});

test("table expansion accepts only normalized bounded numeric spans", () => {
  for (const input of [cell("Bad", 0), cell("Bad", -1), cell("Bad", 1.5), cell("Bad", NaN), cell("Bad", "2"), cell("Bad", 1, -1), cell("Bad", 1, Infinity), cell("Bad", 1, 65535)]) {
    assert.throws(() => expandClipTable([[[input]]]), /table.*span/i);
  }
});

function nativeFixture() {
  let generation = 1, result = { ...payload(), byline: "Author", content: "<p>Article</p>", textLength: 500, lang: "en", dir: "ltr" }, code;
  const viewer = { navigationId: generation, committed: true, readerPending: false, view: { webContents: {
    getURL: () => source, isDestroyed: () => false, isLoadingMainFrame: () => false,
    async executeJavaScriptInIsolatedWorld(world, entries) { assert.equal(world, 1009); code = entries[0].code; return result; },
  } } };
  return { viewer, options: { format: "markdown", loadScript: async () => "local bundle;" }, code: () => code, output: value => { result = { ...result, ...value }; }, navigate: () => { viewer.navigationId = ++generation; } };
}
test("selected page text stays literal with Unicode and paragraph breaks instead of activating Markdown or page HTML", () => {
  const markdown = selectionMarkdown("Selection title", source, 'First 中文 😀 **literal**\n\n<script>bad()</script> ![[Secret]] [link](javascript:bad)\n| A | B |');
  assert.ok(markdown.startsWith("# Selection title\n\nSource: "));
  assert.ok(markdown.includes("First 中文 😀 \\*\\*literal\\*\\*\n\n&lt;script&gt;"));
  const html = marked.parse(markdown);
  assert.doesNotMatch(html, /<(?:script|img|iframe|table|strong)\b/); assert.ok(html.includes("![[Secret]]"));
  assert.equal((html.match(/<p>/g) ?? []).length, 4); assert.equal((html.match(/<a /g) ?? []).length, 1);
});

test("selected text normalizes CRLF and blank lines, accepts short selections and refuses empty or oversized text", () => {
  assert.ok(selectionMarkdown("Page", source, " One\r\n\r\n Two\rThree ").endsWith("One\n\nTwo\n\nThree\n"));
  assert.ok(selectionMarkdown("Page", source, "字").endsWith("字\n"));
  assert.ok(selectionMarkdown("Page", source, "x".repeat(200_000)).endsWith("x".repeat(200_000) + "\n"));
  for (const text of ["", " \n\t ", "\0\x01", "x".repeat(200_001)]) { assert.throws(() => selectionMarkdown("Page", source, text), /select|selection/i); }
});

test("selection metadata escapes page titles and refuses source URLs that could activate local or privileged content", () => {
  const markdown = selectionMarkdown('<img src=x> ![[Title]]', source, "Selected words");
  assert.doesNotMatch(marked.parse(markdown), /<img\b/); assert.ok(markdown.includes("&lt;img"));
  for (const url of ["javascript:bad", "file:///vault/note.md", "https://user:pass@example.com", "data:text/html,bad"]) { assert.throws(() => selectionMarkdown("Page", url, "Words"), /source URL/i); }
});

test("native selection capture uses the isolated local selection entry point and accepts text shorter than an article", async () => {
  const f = nativeFixture(); f.options.format = "selection"; f.output({ content: undefined, byline: undefined, lang: undefined, dir: undefined, textLength: 1 });
  assert.deepEqual(await readWebArticle(f.viewer, endpoint, () => true, f.options), payload());
  assert.ok(f.code().includes('SlopsidianWebReader.extractWebSelection("https://example.com/story")')); assert.equal(f.viewer.readerPending, false);
});

test("native selected-text payloads validate URL, title, text bounds and Markdown before releasing the extraction guard", async () => {
  for (const extra of [{ url: source + "?other" }, { title: "x".repeat(1025) }, { textLength: 0 }, { textLength: 200_001 }, { textLength: 1.5 }, { markdown: " " }, { markdown: "bad\0text" }, { markdown: "x".repeat(2_000_001) }]) {
    const f = nativeFixture(); f.options.format = "selection"; f.output(extra);
    await assert.rejects(readWebArticle(f.viewer, endpoint, () => true, f.options), /valid.*selection/i); assert.equal(f.viewer.readerPending, false);
  }
});

test("selection extraction rejects same-URL navigation that finishes during its isolated execution", async () => {
  const f = nativeFixture(); f.options.format = "selection";
  f.viewer.view.webContents.executeJavaScriptInIsolatedWorld = async () => { f.navigate(); return { ...payload(), textLength: 10 }; };
  await assert.rejects(readWebArticle(f.viewer, endpoint, () => true, f.options), /page changed/i); assert.equal(f.viewer.readerPending, false);
});

test("selected-text extraction shares the Reader pending guard and recovers after a visible selection failure", async () => {
  const f = nativeFixture(); f.options.format = "selection"; f.viewer.readerPending = true;
  await assert.rejects(readWebArticle(f.viewer, endpoint, () => true, f.options), /still running/i); assert.equal(f.viewer.readerPending, true);
  f.viewer.readerPending = false; f.output({ readerError: "Select text in the original main page." });
  await assert.rejects(readWebArticle(f.viewer, endpoint, () => true, f.options), /Select text/); assert.equal(f.viewer.readerPending, false);
  f.output({ readerError: undefined, textLength: 1 }); await readWebArticle(f.viewer, endpoint, () => true, f.options);
});

test("native clipping uses the isolated local extraction bundle and returns only the bounded Markdown DTO", async () => {
  const f = nativeFixture(); assert.deepEqual(await readWebArticle(f.viewer, endpoint, () => true, f.options), payload());
  assert.ok(f.code().includes('SlopsidianWebReader.extractWebClip("https://example.com/story")'));
  assert.equal(f.viewer.readerPending, false);
});
test("native clipping rejects invalid Markdown and releases its shared extraction guard for the next request", async () => {
  for (const markdown of [undefined, "", " ", "bad\0text", "x".repeat(2_000_001)]) {
    const f = nativeFixture(); f.output({ markdown }); await assert.rejects(readWebArticle(f.viewer, endpoint, () => true, f.options), /article Markdown/);
    assert.equal(f.viewer.readerPending, false); f.output({ markdown: payload().markdown }); await readWebArticle(f.viewer, endpoint, () => true, f.options);
  }
});
test("native clipping discards extraction when navigation changes while the local bundle is being loaded", async () => {
  const f = nativeFixture(); f.options.loadScript = async () => { f.navigate(); return "bundle"; };
  await assert.rejects(readWebArticle(f.viewer, endpoint, () => true, f.options), /page changed/);
  assert.equal(f.code(), undefined); assert.equal(f.viewer.readerPending, false);
});
