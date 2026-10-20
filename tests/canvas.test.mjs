import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
await mkdir(runtime, { recursive: true });
const directory = await mkdtemp(join(runtime, "canvas-tests-"));
let engine;
try {
  const outfile = join(directory, "canvas.mjs");
  await build({ entryPoints: [fileURLToPath(new URL("../client/canvas-model.ts", import.meta.url))], outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  engine = await import(pathToFileURL(outfile).href);
} finally { await rm(directory, { recursive: true }); }
const { CanvasDocument, parseCanvas, rewriteCanvasReferences } = engine;
const data = {
  future: { nested: ["retain", null, 1.25] },
  nodes: [
    { id: "group", type: "group", x: -50, y: -50, width: 700, height: 500, label: "Group", future: true },
    { id: "text", type: "text", x: 0, y: 0, width: 250, height: 200, text: "**Actual Markdown**", color: "6", future: { keep: 42 } },
    { id: "file", type: "file", x: 300, y: 0, width: 250, height: 200, file: "Notes/Source.md", subpath: "#Heading" },
    { id: "web", type: "link", x: 0, y: 250, width: 250, height: 150, url: "https://example.invalid/canvas" },
    { id: "unknown", type: "future-card", x: 300, y: 250, width: 250, height: 150, futurePayload: { keep: true } },
  ],
  edges: [{ id: "edge", fromNode: "text", toNode: "file", fromSide: "right", toSide: "left", label: "Related", future: [1, 2] }],
};

test("Canvas edits preserve all card kinds, unknown data, original unedited bytes and CRLF while supporting undo/redo across saves", () => {
  const source = JSON.stringify(data, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const document = new CanvasDocument(source);
  assert.equal(document.text, source);
  assert.equal(document.edit(() => {}), false);
  assert.equal(document.text, source);
  document.edit(data => { data.nodes[1].text = "Changed"; data.nodes[1].x = 40; data.edges[0].label = "Changed edge"; });
  const changed = parseCanvas(document.text);
  assert.deepEqual(changed.future, data.future);
  assert.deepEqual(changed.nodes[1].future, data.nodes[1].future);
  assert.deepEqual(changed.nodes[4], data.nodes[4]);
  assert.deepEqual(changed.edges[0].future, data.edges[0].future);
  assert.ok(!/(?<!\r)\n/.test(document.text));
  assert.equal(document.undo(), true);
  assert.equal(document.text, source);
  assert.equal(document.redo(), true);
  assert.equal(parseCanvas(document.text).nodes[1].text, "Changed");
});

test("Canvas rejects malformed, ambiguous, duplicate and lossy input without replacing a valid model", () => {
  for (const source of ["null", "[]", '{"nodes":null}', '{"nodes":[],"nodes":[]}', '{"future":9007199254740993}', '{"future":0.1234567890123456789}', '{"future":1e400}']) {
    assert.throws(() => parseCanvas(source), /Canvas|canvas|round-tripped/);
  }
  const document = new CanvasDocument(JSON.stringify(data));
  const original = document.text;
  assert.throws(() => document.edit(data => { data.nodes[1].id = "file"; }), /unique/);
  assert.throws(() => document.edit(data => { data.nodes[1].x = 0.5; }), /integer/);
  assert.throws(() => document.edit(data => { data.nodes.splice(2, 1); }), /absent/);
  assert.equal(document.text, original);
  assert.equal(document.canUndo, false);
  assert.deepEqual(parseCanvas(""), { nodes: [], edges: [] });
});

test("Canvas text edits coalesce per field and new edits after undo discard only the redo branch", () => {
  const document = new CanvasDocument(JSON.stringify(data));
  document.edit(data => { data.nodes[1].text = "First"; }, "text");
  document.edit(data => { data.nodes[1].text = "Second"; }, "text");
  document.undo();
  assert.equal(document.data.nodes[1].text, data.nodes[1].text);
  document.redo();
  document.edit(data => { data.nodes[2].x = 350; });
  document.undo();
  assert.equal(document.data.nodes[2].x, 300);
  document.edit(data => { data.nodes[2].y = 10; });
  assert.equal(document.canRedo, false);
  assert.equal(document.data.nodes[1].text, "Second");
});

test("Canvas reference rewrites update file cards, group backgrounds and real Markdown without touching unrelated values", () => {
  const sourceData = structuredClone(data);
  sourceData.nodes[0].background = "Notes/Source.md";
  sourceData.nodes[1].text = "[[Notes/Source#Heading|Caption]] [Note](../Notes/Source.md) `[[Notes/Source]]`";
  sourceData.nodes[4].file = "Notes/Source.md";
  const source = JSON.stringify(sourceData, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const files = [{ path: "Notes/Source.md" }, { path: "Boards/Board.canvas" }];
  assert.equal(rewriteCanvasReferences(source, files, "Boards/Board.canvas", "Other.md", "Elsewhere.md"), source);
  const changed = rewriteCanvasReferences(source, files, "Boards/Board.canvas", "Notes/Source.md", "Archive/Renamed.md");
  const next = parseCanvas(changed);
  assert.equal(next.nodes[2].file, "Archive/Renamed.md");
  assert.equal(next.nodes[2].subpath, "#Heading");
  assert.equal(next.nodes[0].background, "Archive/Renamed.md");
  assert.equal(next.nodes[1].text, "[[Archive/Renamed#Heading|Caption]] [Note](../Archive/Renamed.md) `[[Notes/Source]]`");
  assert.deepEqual(next.nodes[4], sourceData.nodes[4]);
  assert.deepEqual(next.future, sourceData.future);
  assert.ok(!/(?<!\r)\n/.test(changed));
});

test("Canvas extraction redirects only selected heading/block cards and Markdown references, preserving whole-note cards and unknown data", () => {
  const sourceData = structuredClone(data);
  sourceData.nodes[0].background = "Notes/Source.md";
  sourceData.nodes[1].text = "[[Notes/Source#Heading]] [[Notes/Source#Stay]] [[Notes/Source]]";
  sourceData.nodes.push({ ...sourceData.nodes[2], id: "whole", subpath: "" }, { ...sourceData.nodes[2], id: "stay", subpath: "#Stay" });
  const files = ["Notes/Source.md", "Notes/Target.md", "Boards/Board.canvas"].map(path => ({ path }));
  const source = JSON.stringify(sourceData);
  const changed = parseCanvas(rewriteCanvasReferences(source, files, "Boards/Board.canvas", "Notes/Source.md", "Notes/Target.md", ["#Heading"]));
  assert.equal(changed.nodes[2].file, "Notes/Target.md");
  assert.equal(changed.nodes[2].subpath, "#Heading");
  assert.equal(changed.nodes[5].file, "Notes/Source.md");
  assert.equal(changed.nodes[6].file, "Notes/Source.md");
  assert.equal(changed.nodes[0].background, "Notes/Source.md");
  assert.equal(changed.nodes[1].text, "[[Notes/Target#Heading]] [[Notes/Source#Stay]] [[Notes/Source]]");
  assert.deepEqual(changed.nodes[4], sourceData.nodes[4]);
});
