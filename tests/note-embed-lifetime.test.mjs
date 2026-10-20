import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

// NoteEmbed is bundled with a minimal Component so its lifetime logic runs without a browser.
const stubComponent = {
  name: "stub-component",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/plugin$/ }, () => ({ path: "plugin-stub", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export class Component { load() {} unload() {} registerEvent() {} }", loader: "js",
    }));
  },
};
const result = await build({
  stdin: { contents: 'export { NoteEmbed, newEmbedScope } from "./client/note-embed";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", packages: "external", outfile: "x.mjs", plugins: [stubComponent],
});
await mkdir(fileURLToPath(new URL("../.runtime/", import.meta.url)), { recursive: true });
const file = fileURLToPath(new URL("../.runtime/note-embed-lifetime-test.mjs", import.meta.url));
await writeFile(file, result.outputFiles[0].text);
const { NoteEmbed, newEmbedScope } = await import(pathToFileURL(file).href);

class FakeElement {
  constructor() { this.dataset = {}; this.attributes = {}; this.children = []; this.classes = new Set(); this.text = ""; this.className = ""; this.ownerDocument = { createElement: () => new FakeElement() }; }
  get classList() { return { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) }; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  set href(value) { this.attributes.href = value; }
  get href() { return this.attributes.href; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  replaceChildren(...nodes) { this.children = nodes; }
}

function setup(initialText, { rootPath = "/vault" } = {}) {
  const handlers = new Map();
  const state = { text: initialText };
  const target = { path: "Target.md", basename: "Target", extension: "md" };
  const app = {
    changingVault: false,
    vault: { rootPath, on: (name, handler) => { handlers.set(name, handler); return {}; }, cachedRead: async () => state.text },
    metadataCache: { on: (name, handler) => { handlers.set("cache:" + name, handler); return {}; }, updateOpenDocuments() {}, getDocument: () => null },
    workspace: { on: () => ({}) },
  };
  return { app, handlers, state, target };
}

const tick = async (count = 6) => { for (let index = 0; index < count; index++) { await new Promise(resolve => setImmediate(resolve)); } };

function embed(context, { linktext = "Target#H", uri = false, scope = newEmbedScope(), childFactory } = {}) {
  const host = new FakeElement();
  const renders = [];
  const view = childFactory?.(renders) ?? { render: (content, path) => renders.push([content, path]), clear: async () => {}, whenReady: async () => {} };
  const instance = new NoteEmbed({ app: context.app, host, file: context.target, linktext, uri, scope, createView: () => view, relink() {} });
  return { instance, host, renders, scope };
}

test("budget slots are released exactly once and only when acquired", async () => {
  const context = setup("# H\nbody\n");
  const scope = newEmbedScope();
  const first = embed(context, { scope });
  const second = embed(context, { scope });
  assert.equal(scope.budget.used, 2);
  await first.instance.dispose(); await first.instance.dispose();
  assert.equal(scope.budget.used, 1, "dispose releases one slot even when called twice");
  const cyclic = embed(context, { scope: { ...scope, chain: ["Target.md"] } });
  assert.equal(cyclic.host.dataset.slopsidianEmbedState, "error");
  await cyclic.instance.dispose();
  assert.equal(scope.budget.used, 1, "a refused embed never acquired a slot");
  await second.instance.dispose();
  assert.equal(scope.budget.used, 0);
  const full = { ...newEmbedScope(), budget: { used: 64 } };
  const refused = embed(context, { scope: full });
  await refused.instance.dispose();
  assert.equal(full.budget.used, 64, "over-budget embed leaves the shared budget untouched");
});

test("a replaced child (Host -> A -> B) frees its slot so refreshes never hit the limit", async () => {
  const context = setup("# H\nbody\n");
  const scope = { ...newEmbedScope(), budget: { used: 62 } };
  const a = embed(context, { scope });
  assert.equal(scope.budget.used, 63);
  for (let round = 0; round < 5; round++) {
    const b = embed(context, { scope });
    assert.equal(b.host.dataset.slopsidianEmbedState === "error", false, "round " + round);
    await b.instance.dispose();
  }
  assert.equal(scope.budget.used, 63);
  await a.instance.dispose();
  assert.equal(scope.budget.used, 62);
});

test("an obsolete failed refresh cannot overwrite a newer successful render after delayed cleanup", async () => {
  const context = setup("# Other\nnothing\n");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const { instance, host, renders } = embed(context, {
    childFactory: renders => ({ render: (content, path) => renders.push([content, path]), clear: () => (++calls === 1 ? gate : Promise.resolve()), whenReady: async () => {} }),
  });
  await tick();
  assert.equal(calls, 1, "the missing heading started a delayed cleanup");
  context.state.text = "# H\nrestored body\n";
  context.handlers.get("cache:changed")(context.target);
  await tick();
  assert.equal(renders.length, 1);
  assert.match(renders[0][0], /restored body/);
  assert.equal(host.dataset.slopsidianEmbedState, "ready");
  release();
  await tick();
  assert.equal(host.dataset.slopsidianEmbedState, "ready", "the old failure did not replace the restored render");
  assert.equal(host.classList.contains("is-error"), false);
  await instance.dispose();
});

test("an obsolete cleanup after disposal does not touch the host", async () => {
  const context = setup("# Other\n");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { instance, host } = embed(context, { childFactory: () => ({ render() {}, clear: () => gate, whenReady: async () => {} }) });
  await tick();
  const disposing = instance.dispose();
  release();
  await disposing; await tick();
  assert.equal(host.dataset.slopsidianEmbedState, undefined, "a disposed embed never shows a late error");
});

test("URI embeds keep the encoded href and decode only the subpath once", () => {
  const context = setup("# B.md\nbody\n");
  const { host } = embed(context, { linktext: "A%23B.md#Heading%20One", uri: true });
  const open = host.children[1];
  assert.equal(open.getAttribute("href"), "A%23B.md#Heading%20One");
  assert.equal(open.dataset.slopsidianLink, undefined, "URI links follow through the href attribute, not the wiki path");
  assert.equal(host.children[0].textContent, "Target > Heading One");
  const wiki = embed(context, { linktext: "A#B", uri: false });
  assert.equal(wiki.host.children[1].dataset.slopsidianLink, "A#B");
});
