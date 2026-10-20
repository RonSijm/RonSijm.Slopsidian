import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: 'export * from "./client/math-syntax"; export * from "./client/note-embed-section"; export { parseMarkdown } from "./client/markdown";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", packages: "external", outfile: "x.mjs",
});
await mkdir(fileURLToPath(new URL("../.runtime/", import.meta.url)), { recursive: true });
const file = fileURLToPath(new URL("../.runtime/math-embed-test.mjs", import.meta.url));
await writeFile(file, result.outputFiles[0].text);
const { matchBlockMath, matchInlineMath, scanMath, embeddedMarkdown, cycleMessage, MAX_EMBED_DEPTH, MAX_EMBEDS_PER_VIEW, parseMarkdown } = await import(pathToFileURL(file).href);

test("inline math follows the dollar-sign rules", () => {
  assert.deepEqual(matchInlineMath("$x^2$ tail"), { raw: "$x^2$", tex: "x^2", display: false, block: false });
  assert.equal(matchInlineMath("$ x$"), null, "opening dollar before whitespace");
  assert.equal(matchInlineMath("$x $"), null, "closing dollar after whitespace");
  assert.equal(matchInlineMath("$5 and $6"), null, "currency is not math");
  assert.equal(matchInlineMath("$a$5"), null, "closing dollar before a digit");
  assert.equal(matchInlineMath("$a\nb$"), null, "inline math is single-line");
  assert.equal(matchInlineMath("$a\\$b$")?.tex, "a\\$b", "escaped dollar stays inside");
  assert.deepEqual(matchInlineMath("$$x+y$$ z"), { raw: "$$x+y$$", tex: "x+y", display: true, block: false });
  assert.equal(matchInlineMath("$$ $$"), null);
  assert.equal(matchInlineMath("$6 stay, plus `$"), null, "a code span delimiter cannot close math");
});

test("block math spans lines but never blank lines", () => {
  const match = matchBlockMath("$$\n\\int_0^1 x\\,dx\n$$\nafter");
  assert.equal(match.tex, "\\int_0^1 x\\,dx");
  assert.equal(match.raw, "$$\n\\int_0^1 x\\,dx\n$$");
  assert.equal(matchBlockMath("$$\na\n\nb\n$$"), null);
  assert.equal(matchBlockMath("$$x$$ trailing"), null, "text after the closing delimiter is inline display math");
  assert.equal(matchBlockMath("    $$x$$"), null, "indented code is not math");
  assert.equal(matchBlockMath("$$x$$   ")?.tex, "x");
});

test("scanMath skips code, escapes and excluded ranges and reports exact offsets", () => {
  const text = "Price \\$5 and $a+b$ then `$no$`\n\n$$\nE=mc^2\n$$\n\nSee $$x$$ here";
  const code = text.indexOf("`$no$`");
  const spans = scanMath(text, [{ from: code, to: code + 6 }]);
  assert.deepEqual(spans.map(span => [span.tex, span.block, span.display]), [["a+b", false, false], ["E=mc^2", true, true], ["x", false, true]]);
  for (const span of spans) { assert.equal(text.slice(span.from, span.to), span.raw); }
  assert.equal(scanMath("$$\nunclosed").length, 0);
  assert.equal(scanMath("a $ b $ c").length, 0);
});

test("embedded notes slice headings and blocks without altering bytes", () => {
  const note = "---\ntitle: T\n---\n# Top\nintro\n\n## Part A\nalpha\n\n### Deep\ndeep text\n\n## Part B\nbeta ^beta-block\n\nlast line ^last\n";
  assert.equal(embeddedMarkdown(note, ""), note);
  assert.equal(embeddedMarkdown(note, "#Part A"), "## Part A\nalpha\n\n### Deep\ndeep text\n\n");
  assert.equal(embeddedMarkdown(note, "#Deep"), "### Deep\ndeep text\n\n");
  assert.equal(embeddedMarkdown(note, "#Part B").startsWith("## Part B\nbeta ^beta-block"), true);
  assert.equal(embeddedMarkdown(note, "#^beta-block"), "beta");
  assert.equal(embeddedMarkdown(note, "#^last"), "last line");
  assert.equal(embeddedMarkdown(note.replaceAll("\n", "\r\n"), "#^beta-block"), "beta");
  assert.throws(() => embeddedMarkdown(note, "#Missing"), /does not exist/);
  assert.throws(() => embeddedMarkdown(note, "#^missing"), /does not exist/);
});

test("cycle messages show the whole ancestry and depth is bounded", () => {
  assert.equal(cycleMessage(["A.md", "B.md", "C.md"], "B.md"), "Embedded note cycle: B.md → C.md → B.md");
  assert.equal(MAX_EMBED_DEPTH, 4);
});

test("math spans are excluded from the metadata index but code and frontmatter take precedence", () => {
  const text = "---\ntitle: $not math$\n---\nText $a #tag-in-math [[Link]] ^id$ and #real [[Outside]]\n\n$$\nx [[Block]] #blocktag\n$$\n\n`$c #code$` and $ok$ #after\n";
  const cache = parseMarkdown(text);
  assert.deepEqual(cache.tags.map(tag => tag.tag), ["#real", "#after"]);
  assert.deepEqual(cache.links.map(link => link.link), ["Outside"]);
  assert.deepEqual(cache.math.map(range => text.slice(range.from, range.to)), ["$a #tag-in-math [[Link]] ^id$", "$$\nx [[Block]] #blocktag\n$$", "$ok$"]);
  assert.equal(cache.frontmatter.title, "$not math$");
  for (const range of cache.math) { assert.ok(cache.ignored.some(ignored => ignored.from <= range.from && ignored.to >= range.to)); }
  assert.ok(!cache.literal.some(range => cache.math.some(math => range.from <= math.from && range.to >= math.to)), "literal ranges exclude math so it can be rendered");
  assert.equal(parseMarkdown("Costs $5 and $6 #money [[Real]]").links.length, 1);
  assert.equal(parseMarkdown("Costs $5 and $6 #money").tags.length, 1);
});

test("embed limits are bounded", () => { assert.equal(MAX_EMBEDS_PER_VIEW, 64); });
test("wiki link and embed aliases keep precedence over math, while links inside formulas are suppressed", () => {
  const link = parseMarkdown("[[Target|$x$]] and [[Other|$y$ z]]");
  assert.deepEqual(link.links.map(entry => entry.link), ["Target", "Other"]);
  assert.deepEqual(link.math, [], "math inside a link alias is part of the link atom");
  const embed = parseMarkdown("![[Target|$x$]]");
  assert.deepEqual(embed.embeds.map(entry => entry.link), ["Target"]);
  const inside = parseMarkdown("$a [[Inside]] b$ then [[Outside]]");
  assert.deepEqual(inside.links.map(entry => entry.link), ["Outside"], "a link genuinely inside a formula is not indexed");
  assert.equal(inside.math.length, 1);
  const straddle = parseMarkdown("$a [[Straddle|b$ c]]");
  assert.deepEqual(straddle.links.map(entry => entry.link), ["Straddle"], "math may not partially overlap a link atom");
  assert.deepEqual(scanMath("[[Target|$x$]]", [], [{ from: 0, to: 14 }]), []);
});

test("CRLF block math suppresses its contents exactly like LF without normalizing offsets", () => {
  const lf = "$$\nx [[Inside]]\n$$\nafter [[Out]]\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  for (const text of [lf, crlf]) {
    const cache = parseMarkdown(text);
    assert.deepEqual(cache.links.map(entry => entry.link), ["Out"]);
    assert.equal(cache.math.length, 1);
    assert.equal(text.slice(cache.math[0].from, cache.math[0].to), text.slice(0, text.indexOf("$$", 2) + 2));
  }
  assert.equal(matchBlockMath("$$\r\nx\r\n$$\r\nafter").raw, "$$\r\nx\r\n$$");
  assert.equal(matchBlockMath("$$\r\na\r\n\r\nb\r\n$$"), null, "a CRLF blank line still ends the paragraph");
  assert.equal(scanMath(crlf)[0].tex, "x [[Inside]]");
});

test("math scanning is linear for unclosed delimiters", () => {
  const measure = lines => {
    const text = "$$x\n".repeat(lines);
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const spans = scanMath(text);
      best = Math.min(best, performance.now() - start);
      assert.equal(spans.length, 0);
    }
    return best;
  };
  measure(1000);
  const small = Math.max(measure(4000), 0.5);
  const large = measure(16000);
  assert.ok(large / small < 9, `4x input must stay near 4x time (got ${(large / small).toFixed(1)}x: ${small.toFixed(1)}ms -> ${large.toFixed(1)}ms)`);
  const metadata = (() => { const text = "$$x\n".repeat(16000); const start = performance.now(); parseMarkdown(text); return performance.now() - start; })();
  assert.ok(metadata < 2000, "full metadata parse of unclosed delimiters stays bounded");
  const dollars = "$a ".repeat(20000);
  const begin = performance.now(); scanMath(dollars); assert.ok(performance.now() - begin < 500, "single long line of openers is linear");
});
