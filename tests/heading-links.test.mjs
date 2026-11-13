import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, parseMarkdown, resolveSubpath;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "heading-links-tests-"));
  const outfile = join(directory, "links.mjs");
  await build({ stdin: { contents: 'export { parseMarkdown } from "./client/markdown"; export { resolveSubpath } from "./client/links";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  ({ parseMarkdown, resolveSubpath } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/heading-links-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const line = (text, subpath) => resolveSubpath(parseMarkdown(text), subpath)?.start.line ?? null;

test("hierarchical heading links resolve successive descendants at their exact source positions", () => {
  const text = "# Parent\r\n\r\nPrelude 😀\r\n\r\n### Child\r\n\r\n#### Grandchild λ\r\n\r\n## Other\r\n";
  const cache = parseMarkdown(text), result = resolveSubpath(cache, "#Parent#Child#Grandchild λ");
  assert.deepEqual(result, { type: "heading", start: cache.headings[2].position.start, end: cache.headings[2].position.end });
  assert.equal(text.slice(result.start.offset, result.end.offset), "#### Grandchild λ\r");
  assert.equal(line(text, "Parent#Child"), 4);
  assert.equal(line(text, "#Parent#Grandchild λ"), 6, "a descendant can skip intermediate heading levels/components");
});

test("a hierarchy cannot escape a chosen ancestor or backtrack to a later duplicate", () => {
  const text = "# Parent\n\n## First\n\n# Other\n\n## Child\n\n# Parent\n\n## Child\n";
  assert.equal(line(text, "#Parent#Child"), null);
  assert.equal(line(text, "#Other#Child"), 6);
  assert.equal(line(text, "#Parent#First#Child"), null);
  assert.equal(line("# Parent\n## Child\n## Other\n### Deep\n", "#Parent#Child#Deep"), null);
});

test("whole-heading legacy matches and first normalized duplicates keep precedence", () => {
  const text = "# Parent\n## Child\n\n# Parent#Child\n\n# **Child**\n\n# child\n";
  assert.equal(line(text, "#Parent#Child"), 3, "literal whole heading wins over the newly supported chain");
  assert.equal(line(text, "#child"), 1, "flat links still choose the first normalized match");
  assert.equal(line("# C# API\n", "#C# API"), 0);
});

test("hierarchies share Unicode, formatting, case and whitespace normalization", () => {
  const text = "# **Cafe\u0301**\n\n## `Child`   λ\n\n### Leaf\n";
  assert.equal(line(text, "#CAFÉ#child λ#leaf"), 4);
  assert.equal(line(text, "#  café  # child   λ "), 2);
});

test("malformed and excessive hierarchies refuse while existing block lookup is unchanged", () => {
  const text = "# A\n## B\n### C\n#### D\n##### E\n###### F\n\nBlock text. ^kept\n", cache = parseMarkdown(text);
  assert.equal(line(text, "#A#B#C#D#E#F"), 5);
  for (const path of ["#A##B", "#A#", "##A#B", "#A#^kept", "#A#B#C#D#E#F#G", "#" + "x".repeat(4096) + "#B"]) assert.equal(resolveSubpath(cache, path), null, path.slice(0, 80));
  assert.deepEqual(resolveSubpath(cache, "#^kept"), { type: "block", start: cache.blocks.kept.position.start, end: cache.blocks.kept.position.end });
  assert.equal(resolveSubpath(cache, "#^kept#B"), null);
});
