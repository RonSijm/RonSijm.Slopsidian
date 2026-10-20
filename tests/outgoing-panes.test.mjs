import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "../client/markdown.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, outgoingPaneState, outgoingLinkAction, outgoingLinks, resolveLink;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "outgoing-panes-tests-"));
  const outfile = join(directory, "outgoing.mjs");
  await build({ stdin: { contents: 'export * from "./client/outgoing-pane-model"; export { outgoingLinks, resolveLink } from "./client/links";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  ({ outgoingPaneState, outgoingLinkAction, outgoingLinks, resolveLink } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/outgoing-panes-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const source = "Notes/Source.md", files = [{ path: "Notes/Target.md", extension: "md" }, { path: "Image.png", extension: "png" }, { path: "Board.canvas", extension: "canvas" }, { path: "Unsupported.bin", extension: "bin" }];
const viewType = extension => ({ md: "markdown", png: "image", canvas: "canvas" })[extension] ?? null;
const link = text => outgoingLinks(parseMarkdown(text), (reference, path) => resolveLink(files, reference.link, path, reference.kind === "markdown"), source)[0];
const action = (text, readOnly = false, provider = viewType) => outgoingLinkAction(link(text), source, provider, readOnly);

test("imported Outgoing panes keep their own target, follow and section folds without changing input", () => {
  const input = { file: "Notes/\u03bb.md", followActiveFile: false, linksCollapsed: true, unlinkedCollapsed: false, opaque: { keep: true } }, before = structuredClone(input);
  assert.deepEqual(outgoingPaneState(input), { file: input.file, followActiveFile: false, linksCollapsed: true, unlinkedCollapsed: false }); assert.deepEqual(input, before);
  const first = outgoingPaneState(input), second = outgoingPaneState(input); first.file = "Other.md"; first.linksCollapsed = false;
  assert.equal(second.file, input.file); assert.equal(second.linksCollapsed, true);
});
test("unsafe or malformed imported state refuses before replacing pane options", () => {
  for (const value of [
    { file: null }, { followActiveFile: "false" }, { linksCollapsed: 0 }, { unlinkedCollapsed: null },
    ...["/a", "a//b", "../a", ".obsidian/workspace.json", "a\\b", "a\u0000b", "x".repeat(4097)].map(file => ({ file })),
  ]) { assert.throws(() => outgoingPaneState(value)); }
});
test("missing-note actions reuse guarded relative creation and reject traversal, attachments and invalid encoding", () => {
  assert.deepEqual(action("[[./New note]]"), { reason: null, createPath: "Notes/New note.md" });
  assert.deepEqual(action("[[New folder/Note.md]]"), { reason: null, createPath: "New folder/Note.md" });
  for (const text of ["[[../../Outside]]", "[[Missing.png]]", "[[.obsidian/hidden]]", "[[CON]]"]) { assert.ok(action(text).reason); assert.equal(action(text).createPath, null); }
  for (const text of ["[[Missing#Heading]]", "[[Missing#^block]]"]) { assert.match(action(text).reason, /heading or block/); assert.equal(action(text).createPath, null); }
  assert.match(action("[broken](Target%ZZ.md)").reason, /Invalid URL encoding/);
});
test("read-only panes navigate real targets but never offer missing-note creation", () => {
  assert.deepEqual(action("[[Target#Heading]]", true), { reason: null, createPath: null });
  assert.deepEqual(action("[[Image.png]]", true), { reason: null, createPath: null });
  assert.match(action("[[Missing]]", true).reason, /read-only/); assert.equal(action("[[Missing]]", true).createPath, null);
});
test("registered providers govern attachment actions and non-Markdown subpaths remain explicit refusals", () => {
  assert.deepEqual(action("[[Board.canvas]]"), { reason: null, createPath: null });
  assert.match(action("[[Board.canvas]]", false, extension => extension === "canvas" ? null : viewType(extension)).reason, /No view is registered/);
  assert.match(action("[[Unsupported.bin]]").reason, /No view is registered/);
  assert.match(action("[[Image.png#Heading]]").reason, /Subpaths are not supported/);
  assert.deepEqual(action("[[Target#^block]]"), { reason: null, createPath: null });
});
