import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "../client/markdown.ts";

const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
await mkdir(runtime, { recursive: true });
const directory = await mkdtemp(join(runtime, "graph-tests-"));
let engine;
try {
  const outfile = join(directory, "graph.mjs");
  await build({ entryPoints: [fileURLToPath(new URL("../client/graph-model.ts", import.meta.url))], outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  engine = await import(pathToFileURL(outfile).href);
} finally { await rm(directory, { recursive: true }); }
const { buildGraph, readGraphOptions } = engine;
const documents = [
  { path: "Graph/Alpha.md", text: "---\nrelated: '[[Beta#Heading]]'\ntags: [work/nested]\n---\n[[Beta|Repeated]] [[Missing#Block]] ![[Image.png]]\n`[[Hidden]]` \\#escaped\n" },
  { path: "Graph/Beta.md", text: "[Gamma](./Gamma.md) [[Alpha]] #work\n" },
  { path: "Graph/Gamma.md", text: "[[Beta]]\n" },
  { path: "Graph/Orphan.md", text: "# Alone\n[[Orphan]]\n" },
].map(document => ({ ...document, cache: parseMarkdown(document.text) }));
const files = [...documents.map(document => ({ path: document.path, extension: "md" })), { path: "Graph/Image.png", extension: "png" }];
const paths = graph => graph.nodes.map(node => node.path).sort();

test("global graphs resolve real links/properties, combine repeated edges and include missing/orphan nodes without indexing code", () => {
  const graph = buildGraph(files, documents, {});
  assert.deepEqual(paths(graph), ["Graph/Alpha.md", "Graph/Beta.md", "Graph/Gamma.md", "Graph/Orphan.md", "Missing.md"]);
  assert.equal(graph.edges.find(edge => edge.source === "file:Graph/Alpha.md" && edge.target === "file:Graph/Beta.md").weight, 2);
  assert.ok(!graph.edges.some(edge => edge.source === edge.target));
  assert.deepEqual(paths(buildGraph(files, documents, { hideUnresolved: true, showOrphans: false })), ["Graph/Alpha.md", "Graph/Beta.md", "Graph/Gamma.md"]);
  const extended = buildGraph(files, documents, { showTags: true, showAttachments: true });
  assert.ok(paths(extended).includes("Graph/Image.png"));
  assert.ok(paths(extended).includes("#work/nested"));
  assert.ok(!paths(extended).some(path => path.includes("escaped") || path.includes("Hidden")));
});

test("local graphs apply directed depth and neighbor-edge controls while retaining their center through filters", () => {
  const depthOne = buildGraph(files, documents, {}, "Graph/Alpha.md");
  assert.deepEqual(paths(depthOne), ["Graph/Alpha.md", "Graph/Beta.md", "Missing.md"]);
  assert.deepEqual(paths(buildGraph(files, documents, { localJumps: 2 }, "Graph/Alpha.md")), ["Graph/Alpha.md", "Graph/Beta.md", "Graph/Gamma.md", "Missing.md"]);
  assert.deepEqual(paths(buildGraph(files, documents, { localBacklinks: true, localForelinks: false }, "Graph/Alpha.md")), ["Graph/Alpha.md", "Graph/Beta.md"]);
  const connected = documents.map(document => {
    const text = document.text + (document.path === "Graph/Alpha.md" ? "[[Gamma]]\n" : "");
    return { ...document, text, cache: parseMarkdown(text) };
  });
  const withoutNeighbors = buildGraph(files, connected, { hideUnresolved: true }, "Graph/Beta.md");
  const withNeighbors = buildGraph(files, connected, { hideUnresolved: true, localInterlinks: true }, "Graph/Beta.md");
  assert.ok(withNeighbors.edges.length > withoutNeighbors.edges.length);
  assert.deepEqual(paths(buildGraph(files, documents, { search: "file:Gamma" }, "Graph/Alpha.md")), ["Graph/Alpha.md"]);
  assert.deepEqual(buildGraph(files, documents, {}, null).nodes, []);
});

test("graph search and ordered color groups use actual query semantics and retain unknown configuration", () => {
  const options = readGraphOptions({
    search: "path:Graph -file:Orphan", showAttachments: true, future: { keep: true },
    colorGroups: [
      { query: "file:Alpha", color: { rgb: 0xff0000, a: 0.5, future: "color" }, future: "group" },
      { query: "path:Graph", color: { rgb: 0x00ff00, a: 1 } },
    ],
  });
  const graph = buildGraph(files, documents, options);
  assert.ok(!paths(graph).includes("Graph/Orphan.md"));
  assert.equal(graph.nodes.find(node => node.path === "Graph/Alpha.md").color, "rgba(255,0,0,0.5)");
  assert.equal(graph.nodes.find(node => node.path === "Graph/Image.png").color, "rgba(0,255,0,1)");
  assert.deepEqual(options.future, { keep: true });
  assert.equal(options.colorGroups[0].future, "group");
  assert.equal(options.colorGroups[0].color.future, "color");
  assert.throws(() => buildGraph(files, documents, { search: "[broken" }), /Unclosed/);
  assert.throws(() => readGraphOptions({ localJumps: 1.5 }), /integer/);
  assert.throws(() => readGraphOptions({ colorGroups: [{ query: "all", color: { rgb: -1 } }] }), /rgb/);
  for (const key of ["search", "showOrphans", "localJumps", "colorGroups"]) {
    assert.throws(() => readGraphOptions({ [key]: null }), /Graph|graph/);
  }
  assert.throws(() => readGraphOptions(null), /Graph options/);
  assert.throws(() => readGraphOptions({ colorGroups: [null] }), /color group/);
  assert.throws(() => readGraphOptions({ colorGroups: [{ query: "", color: null }] }), /group colors/);
  const deep = Array.from({ length: 40 }).reduce(value => ({ child: value }), { keep: "deep unknown field" });
  assert.deepEqual(readGraphOptions({ colorGroups: [{ query: "", color: { rgb: 10, future: deep }, future: deep }] }).colorGroups[0].future, deep);
});
