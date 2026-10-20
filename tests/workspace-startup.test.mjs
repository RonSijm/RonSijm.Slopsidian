import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { root, startHost } from "./host.mjs";

let directory, startupWorkspace, prepareOriginalWorkspace;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime/workspace-startup-tests-"));
  const output = join(directory, "startup.mjs");
  await build({ entryPoints: [join(root, "client/workspace-startup.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ startupWorkspace, prepareOriginalWorkspace } = await import(pathToFileURL(output).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/workspace-startup-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const original = () => ({ main: { id: "main", type: "split", direction: "vertical", children: [
  { id: "tabs", type: "tabs", dimension: 65, children: [{ id: "note", type: "leaf", pinned: true, state: { type: "markdown", state: { file: "Unicode λ.md", mode: "source", source: false, future: { kept: true } } } }] },
  { id: "other", type: "tabs", dimension: 35, children: [{ id: "plugin", type: "leaf", state: { type: "future-plugin", state: { opaque: [1, "kept"] } } }] },
] }, active: "note", left: { id: "left", type: "split", direction: "horizontal", width: 300, children: [] }, future: { untouched: true } });
function io(overrides = {}) {
  return { saved: async () => null, original: async () => ({ root: "vault-A", id: "workspace", version: "source-version", data: original() }), validate: async (_root, layout) => layout, ...overrides };
}

test("a saved independent workspace wins without reading or validating the original", async () => {
  const layout = { version: 1, opaque: true };
  const result = await startupWorkspace("vault-A", io({ saved: async () => layout, original() { throw Error("Original must not be read"); }, validate() { throw Error("Saved layout already validated by its host"); } }));
  assert.equal(result.layout, layout); assert.equal(result.source, "local");
});
test("unreadable independent layouts propagate their recovery error instead of importing over them", async () => {
  const failure = new Error("Saved workspace is corrupt"); let reads = 0;
  await assert.rejects(startupWorkspace("vault-A", io({ saved: async () => { throw failure; }, original: async () => { reads++; } })), error => error === failure);
  assert.equal(reads, 0);
});
test("a valid original empty leaf remains a restored workspace with its active identifier", async () => {
  const data = { main: { id: "preserved-main", type: "split", direction: "vertical", children: [{ id: "preserved-tabs", type: "tabs", children: [{ id: "preserved-leaf", type: "leaf", state: { type: "empty", state: {} } }] }] }, active: "preserved-leaf", unknown: "keep" };
  const result = await startupWorkspace("vault-A", io({ original: async () => ({ root: "vault-A", id: "workspace", version: "x", data }) }));
  assert.equal(result.source, "obsidian"); assert.equal(result.layout.active, "preserved-leaf"); assert.equal(result.error, undefined);
});
test("an absent original retains the normal empty-workspace fallback", async () => {
  const result = await startupWorkspace("vault-A", io({ original: async () => ({ root: "vault-A", id: "workspace", version: null, data: {} }), validate() { throw Error("No layout to validate"); } }));
  assert.deepEqual(result, { source: "empty", layout: null, warnings: [] });
});
test("first-open conversion validates pins, proportions, modes and unavailable state without mutating original data", async () => {
  const data = original(), before = structuredClone(data); let validated = 0;
  const result = await startupWorkspace("vault-A", io({ original: async () => ({ root: "vault-A", id: "workspace", version: "source-version", data }), validate: async (root, layout) => { assert.equal(root, "vault-A"); validated++; return layout; } }));
  assert.equal(result.source, "obsidian"); assert.equal(validated, 1);
  assert.equal(result.layout.main.children[0].children[0].state.pinned, true);
  assert.equal(result.layout.main.children[0].children[0].state.state.source, false);
  assert.deepEqual(result.layout.main.children.map(child => child.dimension), [65, 35]);
  assert.deepEqual(result.layout.main.children[1].children[0].state.state, { opaque: [1, "kept"] });
  assert.equal(result.layout.views["workspace-startup"].version, "source-version"); assert.deepEqual(data, before);
});
test("original recent-file history seeds only the independent startup snapshot and retains all original bytes and fields", async () => {
  const data = { ...original(), lastOpenFiles: ["Recent.md", "Work/Other.md", "image.png"] }, before = structuredClone(data);
  const result = await startupWorkspace("vault-A", io({ original: async () => ({ root: "vault-A", id: "workspace", version: "source-version", data }) }));
  assert.equal(result.source, "obsidian");
  assert.deepEqual(result.layout.views["workspace-recent-files"].paths, data.lastOpenFiles);
  result.layout.views["workspace-recent-files"].paths.push("Independent.md");
  assert.deepEqual(data, before);
  const invalid = await startupWorkspace("vault-A", io({ original: async () => ({ root: "vault-A", id: "workspace", version: "x", data: { ...data, lastOpenFiles: ["../Other.md"] } }) }));
  assert.equal(invalid.layout, null);
  assert.match(invalid.error.cause.message, /vault-relative/);
  assert.deepEqual(data, before);
});
test("malformed, unsafe and wrong-root originals expose a causal diagnostic and fall back without installing a partial layout", async () => {
  for (const document of [{ root: "vault-A", id: "workspace", version: "x", data: {} }, { root: "other", id: "workspace", version: "x", data: original() }, { root: "vault-A", id: "other", version: "x", data: original() }]) {
    const result = await startupWorkspace("vault-A", io({ original: async () => document }));
    assert.equal(result.layout, null); assert.equal(result.source, "empty"); assert.ok(result.error.cause instanceof Error); assert.match(result.error.message, /bytes were retained/);
  }
  assert.throws(() => prepareOriginalWorkspace("vault-A", { root: "other", id: "workspace", version: null, data: {} }), /different vault/);
});
test("original read and host-validation failures keep the same recoverable fallback", async () => {
  for (const overrides of [{ original: async () => { throw Error("Permission revoked"); } }, { validate: async () => { throw Error("Unsupported layout"); } }]) {
    const result = await startupWorkspace("vault-A", io(overrides)); assert.equal(result.layout, null); assert.ok(result.error.cause); assert.equal(result.source, "empty");
  }
});
test("the native original-workspace endpoint is root-guarded, BOM-aware and read-only, including invalid sources", async t => {
  const vault = await mkdtemp(join(directory, "vault-")); await mkdir(join(vault, ".obsidian"));
  const path = join(vault, ".obsidian/workspace.json"), bytes = Buffer.from("\ufeff" + JSON.stringify(original()).replaceAll("\n", "\r\n"));
  const host = await startHost(vault); t.after(() => host.stop());
  const url = "/api/workspace/original?root=" + encodeURIComponent(vault);
  assert.equal((await (await host.request(url)).json()).version, null);
  await writeFile(path, bytes); const response = await host.request(url); assert.equal(response.status, 200);
  const document = await response.json(); assert.deepEqual(document.data, original()); assert.equal(document.version, createHash("sha256").update(bytes).digest("hex"));
  assert.equal((await host.request("/api/workspace/original?root=other")).status, 409);
  assert.equal((await host.request(url, "PUT", document)).status, 405);
  assert.equal((await host.request("/api/configuration/workspace", "PUT", { root: vault, version: document.version, data: {} })).status, 404);
  assert.deepEqual(await readFile(path), bytes);
  await writeFile(path, "{"); assert.equal((await host.request(url)).status, 422); assert.equal(await readFile(path, "utf8"), "{");
  await writeFile(path, " ".repeat(1024 * 1024 + 1)); assert.equal((await host.request(url)).status, 413);
});
