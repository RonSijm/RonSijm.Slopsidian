import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "../client/markdown.ts";

const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
await mkdir(runtime, { recursive: true });
const directory = await mkdtemp(join(runtime, "search-tests-"));
let engine;
try {
  const outfile = join(directory, "search.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../client/search.ts", import.meta.url))], outfile,
    bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
  });
  engine = await import(pathToFileURL(outfile).href);
} finally {
  await rm(directory, { recursive: true });
}
const { searchDocuments, SearchQueryError } = engine;
const docs = [
  { path: "Projects/Alpha.md", text: "---\nstatus: active\nrating: 5\ncompleted: false\ntags: [work/nested]\nrelated: '[[Beta]]'\n---\nAlpha red apple.\nA second RED apple.\n" },
  { path: "Projects/Beta.md", text: "---\nstatus: paused\nrating: 2\ncompleted: true\ntags: [work]\n---\nBeta green apple.\n" },
  { path: "Archive/Gamma.md", text: "Gamma red orange. #food/fruit\n`#hidden`\n\\#escaped\n" },
].map(doc => ({ ...doc, cache: parseMarkdown(doc.text) }));
const paths = query => searchDocuments(docs, query).map(result => result.path);

test("search composes implicit AND, explicit Boolean operators, negation and parentheses", () => {
  assert.deepEqual(paths("red apple"), ["Projects/Alpha.md"]);
  assert.deepEqual(paths('(red OR green) AND apple -orange'), ["Projects/Alpha.md", "Projects/Beta.md"]);
  assert.deepEqual(paths('NOT apple'), ["Archive/Gamma.md"]);
  assert.deepEqual(paths('"green apple" OR orange'), ["Archive/Gamma.md", "Projects/Beta.md"]);
  assert.deepEqual(paths(""), []);
});

test("search matches regex, case options, quoted paths and exact source contexts", () => {
  assert.deepEqual(paths("path:Projects /(?:red|green) apple/i"), ["Projects/Alpha.md", "Projects/Beta.md"]);
  assert.deepEqual(paths('file:"Alpha.md" /red\\s+apple/'), ["Projects/Alpha.md"]);
  const result = searchDocuments(docs, '"RED apple"', { matchCase: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].matches.length, 1);
  const range = result[0].matches[0];
  assert.equal(docs[0].text.slice(range.from, range.to), "RED apple");
  assert.equal(searchDocuments(docs, "/red apple/", { matchCase: true })[0].matches.length, 1);
});

test("tag operators include frontmatter and nested descendants but exclude code and escaped tags", () => {
  assert.deepEqual(paths("tag:#work"), ["Projects/Alpha.md", "Projects/Beta.md"]);
  assert.deepEqual(paths("tag:work/nested"), ["Projects/Alpha.md"]);
  assert.deepEqual(paths("tag:food"), ["Archive/Gamma.md"]);
  assert.deepEqual(paths("tag:hidden OR tag:escaped"), []);
});

test("property operators support typed values, existence, nested values and numeric comparisons", () => {
  assert.deepEqual(paths("[status: active]"), ["Projects/Alpha.md"]);
  assert.deepEqual(paths("[status] -[completed: true]"), ["Projects/Alpha.md"]);
  assert.deepEqual(paths("[rating: >=4]"), ["Projects/Alpha.md"]);
  assert.deepEqual(paths("[rating: <3]"), ["Projects/Beta.md"]);
  assert.deepEqual(paths('[related: "[[Beta]]"]'), ["Projects/Alpha.md"]);
  assert.deepEqual(paths("[absent]"), []);
});

test("invalid syntax, unsupported operators and invalid regex flags fail explicitly", () => {
  for (const query of ['"unclosed', "/unterminated", "/[broken/", "/foo/ii", "/foo/q", "alpha OR", "()", "(alpha", "alpha)", "[status: active", "unknown:value", "path:"]) {
    assert.throws(() => paths(query), SearchQueryError, query);
  }
});
