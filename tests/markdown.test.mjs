import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { errorLogStub } from "./error-log-stub.mjs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState, Prec } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { markdown as markdownEditor, markdownLanguage } from "@codemirror/lang-markdown";
import { allTags, composerFragment, composerHeading, composerTemplate, convertMarkdownFormats, countWords, getFrontMatterInfo, insertMarkdown, markdownSlides, outgoingMentions, parseFrontMatterAliases, parseFrontMatterEntry, parseFrontMatterStringArray, parseFrontMatterTags, parseMarkdown, renameFrontmatterProperty, sourcePositions, updateFrontmatter } from "../client/markdown.ts";
import { browserPromiseTimers, debounce } from "../client/timers.ts";
import { markdownSupport, tokenClassNodeProp } from "../client/editor-language.ts";

const linksRuntime = fileURLToPath(new URL("../.runtime/", import.meta.url));
await mkdir(linksRuntime, { recursive: true });
const linksDirectory = await mkdtemp(join(linksRuntime, "link-tests-"));
let links, livePreviewDecorations, markdownTagDecorations, prepareFuzzySearch, Cli, ValueComponent, HotkeyManager, Keymap, Scope, Component, Plugin, ItemView, FileView, TFile, Vault, MetadataCache, FileManager, DesktopUI, Bookmarks, ownedDebounce, configureBrowserHost, callableConstructor;
try {
  const outfile = join(linksDirectory, "links.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../client/links.ts", import.meta.url)), fileURLToPath(new URL("../client/live-preview.ts", import.meta.url)), fileURLToPath(new URL("../client/suggestions.ts", import.meta.url)), fileURLToPath(new URL("../client/cli.ts", import.meta.url)), fileURLToPath(new URL("../client/ui.ts", import.meta.url)), fileURLToPath(new URL("../client/legacy-constructors.ts", import.meta.url))],
    stdin: { contents: 'export { Component, Plugin } from "./client/plugin"; export { ItemView, FileView } from "./client/views"; export { TFile, Vault } from "./client/vault"; export { MetadataCache } from "./client/metadata"; export { FileManager } from "./client/file-manager"; export { DesktopUI } from "./client/desktop-ui"; export { Bookmarks } from "./client/bookmarks"; export { debounce } from "./client/timers"; export { configureBrowserHost } from "./client/contracts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
    outdir: linksDirectory, outExtension: { ".js": ".mjs" },
    bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub],
  });
  links = await import(pathToFileURL(outfile).href);
  ({ livePreviewDecorations, markdownTagDecorations } = await import(pathToFileURL(join(linksDirectory, "live-preview.mjs")).href));
  ({ prepareFuzzySearch } = await import(pathToFileURL(join(linksDirectory, "suggestions.mjs")).href));
  ({ Cli } = await import(pathToFileURL(join(linksDirectory, "cli.mjs")).href));
  ({ ValueComponent, HotkeyManager, Keymap, Scope } = await import(pathToFileURL(join(linksDirectory, "ui.mjs")).href));
  ({ Component, Plugin, ItemView, FileView, TFile, Vault, MetadataCache, FileManager, DesktopUI, Bookmarks, debounce: ownedDebounce, configureBrowserHost } = await import(pathToFileURL(join(linksDirectory, "stdin.mjs")).href));
  ({ callableConstructor } = await import(pathToFileURL(join(linksDirectory, "legacy-constructors.mjs")).href));
} finally {
  await rm(linksDirectory, { recursive: true });
}
const { createLinkResolver, fileLinktext, linkDestination, newLinkedNotePath, outgoingLinks, parseLinktext, relativeVaultPath, relocateMarkdownLinks, resolveSubpath, rewriteFileLinks, rewriteSectionLinks } = links;
let pluginDataRequest;
configureBrowserHost({ request: (...args) => pluginDataRequest(...args) });

test("plugin-private body fields cannot redirect ItemView content and retain obsolete preview actions", () => {
  const previous = globalThis.document;
  let focused;
  const node = () => ({
    children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    focus() { focused = this; },
  });
  globalThis.document = { createElement: node };
  try {
    class Preview extends ItemView {
      getViewType() { return "preview"; }
      getDisplayText() { return "Preview"; }
      render() {
        this.contentEl.replaceChildren();
        const actions = node(), body = node();
        this.contentEl.append(actions, body);
        this.bodyEl = body;
        return { actions, body };
      }
    }
    const preview = new Preview({ workspace: { app: {} } }), content = preview.contentEl;
    preview.render();
    const latest = preview.render();
    assert.equal(preview.contentEl, content);
    assert.equal(preview.containerEl.children[1], content);
    assert.deepEqual(content.children, [latest.actions, latest.body], "A second render must remove the original action controls, not nest inside the previous diff body.");
    preview.focus();
    assert.equal(focused, content, "The default focus target must remain the real owned content, not a plugin's private body field.");
  } finally {
    if (previous === undefined) { delete globalThis.document; } else { globalThis.document = previous; }
  }
});

test("file switches and close dispatch the plugin loadFile override before its per-file hooks", async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ append() {}, replaceChildren() {}, remove() {} }) };
  try {
    const files = new Map(), owners = new Map(), events = [];
    const vault = { getAbstractFileByPath: path => files.get(path) };
    for (const path of ["First.md", "Second.md"]) {
      files.set(path, new TFile(vault, { path, basename: path.slice(0, -3), extension: "md", stat: {} }));
    }
    class Board extends FileView {
      getViewType() { return "board"; }
      async loadFile(file) {
        events.push(["switch", this.file?.path ?? null, file?.path ?? null]);
        if (this.file) { owners.delete(this.file); }
        return super.loadFile(file);
      }
      async onLoadFile(file) { events.push(["load", file.path]); owners.set(file, this); }
      async onUnloadFile(file) { events.push(["unload", file.path]); }
    }
    const view = new Board({ workspace: { app: { vault } } });
    await view.openView();
    const result = {};
    await view.setState({ file: "First.md" }, result);
    await view.setState({ file: "Second.md" }, result);
    await view.setState({ file: "Second.md" }, {});
    assert.deepEqual([...owners.keys()].map(file => file.path), ["Second.md"], "The reused view must not remain registered against its previous file.");
    assert.equal(result.history, true);
    await view.closeView();
    assert.equal(owners.size, 0);
    assert.equal(view.file, null);
    assert.deepEqual(events, [
      ["switch", null, "First.md"], ["load", "First.md"],
      ["switch", "First.md", "Second.md"], ["unload", "First.md"], ["load", "Second.md"],
      ["switch", "Second.md", null], ["unload", "Second.md"],
    ]);
  } finally {
    if (previous === undefined) { delete globalThis.document; } else { globalThis.document = previous; }
  }
});

test("direct file loading rejects foreign files and restores the previous file while surfacing a failed transition", async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ append() {}, replaceChildren() {} }) };
  try {
    const files = new Map(), events = [];
    const vault = { getAbstractFileByPath: path => files.get(path) };
    for (const path of ["First.md", "Broken.md"]) {
      files.set(path, new TFile(vault, { path, basename: path.slice(0, -3), extension: "md", stat: {} }));
    }
    class Board extends FileView {
      getViewType() { return "board"; }
      async onLoadFile(file) {
        events.push(["load", file.path]);
        if (file.path === "Broken.md") { throw new Error("Board parsing failed."); }
      }
      async onUnloadFile(file) { events.push(["unload", file.path]); }
    }
    const view = new Board({ workspace: { app: { vault } } }), first = files.get("First.md");
    assert.equal(await view.loadFile(first), true);
    assert.equal(await view.loadFile(first), false);
    const foreign = new TFile({}, { path: "Foreign.md", basename: "Foreign", extension: "md", stat: {} });
    await assert.rejects(view.loadFile(foreign), /own vault/);
    await assert.rejects(view.setState({ file: "Broken.md" }, {}), /Board parsing failed/);
    assert.equal(view.file, first);
    assert.deepEqual(events, [
      ["load", "First.md"], ["unload", "First.md"], ["load", "Broken.md"],
      ["unload", "Broken.md"], ["load", "First.md"],
    ]);
    assert.equal(await view.loadFile(null), true);
    assert.equal(await view.loadFile(null), false);
  } finally {
    if (previous === undefined) { delete globalThis.document; } else { globalThis.document = previous; }
  }
});

test("owned lifecycle awaits asynchronous child cleanup even when native-style unload overrides discard the superclass promise", async () => {
  const phases = [];
  let release;
  class NativeUnload extends Component {
    unload() { super.unload(); }
  }
  class Child extends NativeUnload {
    async onunload() {
      phases.push("child start");
      await new Promise(resolve => { release = resolve; });
      phases.push("child finished");
    }
  }
  class Parent extends NativeUnload {
    onunload() { phases.push("parent finished"); }
  }
  const parent = new Parent(), child = parent.addChild(new Child());
  parent.register(() => phases.push("parent registered cleanup"));
  await parent.load();
  const closing = parent.unloadAndWait();
  let settled = false;
  closing.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(phases, ["child start"]);
  assert.equal(settled, false);
  release();
  await closing;
  assert.deepEqual(phases, ["child start", "child finished", "parent registered cleanup", "parent finished"]);
  assert.equal(parent._loaded, false);
  assert.equal(child._loaded, false);
  await parent.unloadAndWait();
  assert.equal(phases.length, 4);
});

test("owned lifecycle rejects an unload override that leaves its shared component loaded", async () => {
  class BrokenUnload extends Component {
    unload() {}
  }
  const component = new BrokenUnload();
  await component.load();
  await assert.rejects(component.unloadAndWait(), /must call its shared superclass/);
  await Component.prototype.unload.call(component);
});

test("removing a child detaches it once and parent teardown still drains its in-flight unload", async () => {
  const phases = [];
  let release;
  class Child extends Component {
    async onunload() {
      phases.push("child started");
      await new Promise(resolve => { release = resolve; });
      phases.push("child finished");
    }
  }
  const parent = new Component(), child = parent.addChild(new Child()), foreign = new Child();
  await parent.load();
  await foreign.load();
  assert.equal(parent.removeChild(foreign), foreign);
  assert.equal(foreign.isLoaded, true, "Removing a non-child must not unload someone else's component.");
  assert.equal(parent.removeChild(child), child);
  assert.equal(parent.removeChild(child), child);
  const closing = parent.unloadAndWait();
  let settled = false;
  closing.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(phases, ["child started"]);
  assert.equal(settled, false);
  release();
  await closing;
  assert.deepEqual(phases, ["child started", "child finished"]);
  assert.equal(child.isLoaded, false);
  foreign.onunload = () => {};
  await foreign.unloadAndWait();
});

test("native writable _loaded state cannot skip owned initialization or shared teardown", async () => {
  const phases = [];
  class NativeFlags extends Component {
    onload() { phases.push("load"); this._loaded = false; }
    onunload() { phases.push("unload"); }
  }
  const component = new NativeFlags();
  component._loaded = true;
  component.register(() => phases.push("cleanup"));
  await component.load();
  assert.equal(component.isLoaded, true);
  assert.equal(component._loaded, false);
  await component.unloadAndWait();
  assert.deepEqual(phases, ["load", "cleanup", "unload"]);
  class BrokenFlags extends Component {
    unload() { this._loaded = false; }
  }
  const broken = new BrokenFlags();
  await broken.load();
  await assert.rejects(broken.unloadAndWait(), /must call its shared superclass/);
  await Component.prototype.unload.call(broken);
});

test("ES5 superclass calls construct branded shared instances through multiple legacy inheritance levels", async () => {
  const Base = callableConstructor(Component), phases = [];
  function LegacyParent() { const self = Base.apply(this, arguments); self.parent = true; return self; }
  Object.setPrototypeOf(LegacyParent, Base);
  LegacyParent.prototype = Object.create(Base.prototype, { constructor: { value: LegacyParent, writable: true } });
  function LegacyLeaf() { const self = LegacyParent.apply(this, arguments); self.leaf = true; return self; }
  Object.setPrototypeOf(LegacyLeaf, LegacyParent);
  LegacyLeaf.prototype = Object.create(LegacyParent.prototype, { constructor: { value: LegacyLeaf, writable: true } });
  const instance = new LegacyLeaf();
  assert.ok(instance instanceof Component && instance instanceof Base && instance instanceof LegacyParent && instance instanceof LegacyLeaf);
  assert.equal(instance.parent && instance.leaf, true);
  instance.register(async () => { await Promise.resolve(); phases.push("cleanup"); });
  await instance.load();
  await instance.unloadAndWait();
  assert.deepEqual(phases, ["cleanup"]);
  class Modern extends Base {}
  const modern = new Modern();
  await modern.load();
  await modern.unloadAndWait();
  assert.throws(() => Base.call({}), /requires an instance/);
});

test("owned lifecycle finishes started cleanup before propagating an unload override's failure", async () => {
  const failure = new Error("Failure after shared teardown started");
  let release, finished = false, settled = false;
  class FailedUnload extends Component {
    unload() { super.unload(); throw failure; }
    async onunload() {
      await new Promise(resolve => { release = resolve; });
      finished = true;
    }
  }
  const component = new FailedUnload();
  await component.load();
  const closing = component.unloadAndWait();
  const rejected = assert.rejects(closing, error => error === failure);
  closing.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(finished, false);
  release();
  await rejected;
  assert.equal(finished, true);
  assert.equal(component._loaded, false);
});

test("owned lifecycle flushes actual SDK-debounced methods before and after unload and awaits their asynchronous work", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const phases = [];
  let before, after;
  class DeferredSettings extends Component {
    save = ownedDebounce(async function (value) {
      phases.push([this === component, value, "started"]);
      await new Promise(resolve => { if (value === "before") { before = resolve; } else { after = resolve; } });
      phases.push([this === component, value, "finished"]);
    }, 5000);
    onunload() { this.save("after"); }
  }
  const component = new DeferredSettings();
  Object.defineProperty(component, "unrelatedGetter", { get() { throw new Error("Teardown must not evaluate arbitrary getters."); } });
  component.unrelated = Object.assign(() => {}, { run() { throw new Error("Teardown must not invoke unbranded lookalikes."); } });
  await component.load();
  component.save("superseded");
  component.save("before");
  const closing = component.unloadAndWait();
  let settled = false;
  closing.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(phases, [[true, "before", "started"]]);
  assert.equal(settled, false);
  before();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(phases, [[true, "before", "started"], [true, "before", "finished"], [true, "after", "started"]]);
  assert.equal(settled, false);
  after();
  await closing;
  context.mock.timers.tick(10000);
  assert.deepEqual(phases, [[true, "before", "started"], [true, "before", "finished"], [true, "after", "started"], [true, "after", "finished"]]);
});

test("plugin data teardown awaits started writes and rejects disposed or stale vault owners before transport", async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  pluginDataRequest = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === "GET") { return { status: 200, value: null }; }
    await gate;
    return { status: 204 };
  };
  const app = { vault: { rootPath: "vault-a" }, plugins: { selectionVersion: 1 }, protocols: { createOwner: () => ({}) } };
  const manifest = { id: "owned-data", name: "Owned data", version: "1.0.0" };
  const plugin = new Plugin(app, manifest);
  await plugin.load();
  assert.equal(await plugin.loadData(), null);
  const saving = plugin.saveData({ value: "persist before exit" });
  const closing = plugin.unloadAndWait();
  let settled = false;
  closing.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await Promise.all([saving, closing]);
  await assert.rejects(plugin.saveData({ value: "too late" }), /finished unloading/);
  await assert.rejects(plugin.loadData(), /finished unloading/);
  const reselected = new Plugin(app, manifest);
  app.plugins.selectionVersion++;
  await assert.rejects(reselected.saveData({ value: "old selection" }), /no longer belongs/);
  await assert.rejects(reselected.loadData(), /no longer belongs/);
  const oldRoot = new Plugin(app, manifest);
  app.vault.rootPath = "vault-b";
  await assert.rejects(oldRoot.saveData({ value: "wrong vault" }), /no longer belongs/);
  await assert.rejects(oldRoot.loadData(), /no longer belongs/);
  assert.deepEqual(calls, [
    { path: "/api/plugins/owned-data/data", method: "GET", body: undefined },
    { path: "/api/plugins/owned-data/data", method: "PUT", body: { value: "persist before exit" } },
  ]);
});

test("failed plugin teardown work is reported while remaining debounced and in-flight writes finish", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const errors = [], writes = [], banner = { textContent: "", append() {} };
  context.mock.method(console, "error", error => errors.push(error));
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: id => id === "client-errors" ? banner : null, createElement: () => ({ addEventListener() {} }) } });
  context.after(() => {
    if (originalDocument) { Object.defineProperty(globalThis, "document", originalDocument); }
    else { delete globalThis.document; }
  });
  const transportFailure = new Error("Expected owned write rejection");
  const deferredFailure = new Error("Expected owned debouncer rejection");
  let rejectWrite, releaseWrite;
  pluginDataRequest = async (_path, _method, body) => {
    writes.push(body.value);
    if (body.value === "failed") { await new Promise((_resolve, reject) => { rejectWrite = reject; }); }
    if (body.value === "pending") { await new Promise(resolve => { releaseWrite = resolve; }); }
    return { status: 204 };
  };
  class DeferredPlugin extends Plugin {
    failed = ownedDebounce(async () => { throw deferredFailure; }, 5000);
    remaining = ownedDebounce(async function () { await this.saveData({ value: "remaining" }); }, 5000);
    onunload() { this.failed(); this.remaining(); }
  }
  const app = { vault: { rootPath: "vault-a" }, plugins: { selectionVersion: 1 }, protocols: { createOwner: () => ({}) } };
  const plugin = new DeferredPlugin(app, { id: "failed-owned-data", name: "Failed owned data", version: "1.0.0" });
  await plugin.load();
  const failed = plugin.saveData({ value: "failed" });
  const rejected = assert.rejects(failed, error => error === transportFailure);
  const saving = plugin.saveData({ value: "pending" });
  const closing = plugin.unloadAndWait();
  let settled = false;
  closing.then(() => { settled = true; }, () => { settled = true; });
  context.after(async () => {
    rejectWrite(transportFailure);
    releaseWrite();
    await Promise.allSettled([failed, saving, closing, rejected]);
  });
  await new Promise(resolve => setImmediate(resolve));
  rejectWrite(transportFailure);
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "One failure must not release teardown while another owned write is pending.");
  releaseWrite();
  await Promise.all([saving, closing]);
  context.mock.timers.tick(10000);
  assert.deepEqual(writes, ["failed", "pending", "remaining"]);
  assert.ok(errors.includes(transportFailure));
  assert.ok(errors.includes(deferredFailure));
  assert.match(banner.textContent, /Expected owned .* rejection/);
  await assert.rejects(plugin.saveData({ value: "disposed" }), /finished unloading/);
});

test("editor Markdown syntax exposes actual link, destination and formatting token classes", () => {
  const text = "[A note](Folder/Note.md) and <https://example.invalid> with `literal [not](a-link)`";
  const parsed = markdownSupport.language.parser.parse(text), tokens = [];
  parsed.iterate({ enter(node) {
    const classes = node.type.prop(tokenClassNodeProp);
    if (classes) { tokens.push([classes, text.slice(node.from, node.to)]); }
  } });
  assert.ok(tokens.some(([classes, value]) => classes === "link" && value === "[A note](Folder/Note.md)"));
  assert.ok(tokens.some(([classes, value]) => classes === "url" && value === "Folder/Note.md"));
  assert.ok(tokens.some(([classes, value]) => classes === "url" && value === "https://example.invalid"));
  assert.ok(tokens.some(([classes, value]) => classes === "formatting-link" && value === "["));
  assert.ok(!tokens.some(([, value]) => value.includes("[not]") || value === "a-link"));
});

test("plugin debounce keeps the first deadline and the latest arguments and receiver", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const delayed = debounce(function (...args) { calls.push([this.id, args]); }, 50);
  const first = { id: "first", delayed }, last = { id: "last", delayed };
  assert.equal(first.delayed("old"), delayed);
  context.mock.timers.tick(30);
  last.delayed("new", 0);
  context.mock.timers.tick(20);
  assert.deepEqual(calls, [["last", ["new", 0]]]);
  context.mock.timers.tick(100);
  assert.equal(calls.length, 1);
  assert.equal(delayed.run(), undefined);
  delayed("cancelled");
  assert.equal(delayed.cancel(), delayed);
  context.mock.timers.tick(100);
  assert.equal(calls.length, 1);
});

test("plugin aliases and string arrays preserve native trimming without splitting values or mutating metadata", () => {
  const entries = [" First ", "", "  ", "Two, together", 42, false];
  const frontmatter = { ALIASES: entries };
  assert.deepEqual(parseFrontMatterStringArray(frontmatter, /^aliases$/i), ["First", "", "", "Two, together"]);
  assert.deepEqual(parseFrontMatterAliases(frontmatter), ["First", "Two, together"]);
  assert.deepEqual(entries, [" First ", "", "  ", "Two, together", 42, false]);
  assert.deepEqual(parseFrontMatterAliases({ aliases: " First, Second " }), ["First, Second"]);
  assert.deepEqual(parseFrontMatterAliases({ aliases: [] }), []);
  assert.deepEqual(parseFrontMatterAliases({ aliases: "  " }), []);
  for (const value of [null, undefined, {}, { alias: "singular" }, { aliases: "" }, { aliases: 42 }, Object.create({ aliases: ["inherited"] })]) {
    assert.equal(parseFrontMatterAliases(value), null);
  }
});

test("plugin frontmatter tags retain the observed case-insensitive, trimmed, nonsplitting SDK contract", () => {
  assert.deepEqual(parseFrontMatterTags({ TAGS: [" foo ", "#bar", "", "two words", 42, "nested/tag"] }), ["#foo", "#bar", "#nested/tag"]);
  assert.deepEqual(parseFrontMatterTags({ tags: "foo,bar" }), ["#foo,bar"]);
  assert.deepEqual(parseFrontMatterTags({ tags: "two words" }), []);
  assert.deepEqual(parseFrontMatterTags({ tags: [] }), []);
  for (const value of [null, undefined, {}, { tags: "" }, { tags: 42 }]) { assert.equal(parseFrontMatterTags(value), null); }
  assert.equal(parseFrontMatterTags(Object.create({ tags: "not-own" })), null);
});

test("plugin frontmatter entry lookup preserves own values, exact string keys and first matching regular-expression keys", () => {
  const frontmatter = Object.assign(Object.create({ title: "inherited" }), { Title: ["original"], TITLE: "later", zero: 0, off: false, empty: "", unset: undefined });
  Object.defineProperty(frontmatter, "hidden", { value: "own non-enumerable" });
  Object.defineProperty(frontmatter, "unrelated", { enumerable: true, get() { throw new Error("Unmatched properties must not be read"); } });
  assert.equal(parseFrontMatterEntry(frontmatter, "Title"), frontmatter.Title);
  assert.equal(parseFrontMatterEntry(frontmatter, /^title$/i), frontmatter.Title);
  assert.equal(parseFrontMatterEntry(frontmatter, "title"), null);
  assert.equal(parseFrontMatterEntry(frontmatter, "hidden"), "own non-enumerable");
  assert.equal(parseFrontMatterEntry(frontmatter, /^hidden$/), null);
  for (const key of ["zero", "off", "empty", "unset"]) { assert.equal(parseFrontMatterEntry(frontmatter, key), frontmatter[key]); }
  for (const value of [null, undefined, {}]) { assert.equal(parseFrontMatterEntry(value, "missing"), null); }
});

test("plugin debounce resets deadlines, flushes results and supports reentrant scheduling", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const delayed = debounce(value => { calls.push(value); if (value === "reenter") { delayed("next"); } return value.length; }, 50, true);
  delayed("old");
  context.mock.timers.tick(30);
  delayed("latest");
  context.mock.timers.tick(49);
  assert.deepEqual(calls, []);
  context.mock.timers.tick(1);
  assert.deepEqual(calls, ["latest"]);
  delayed("reenter");
  assert.equal(delayed.run(), 7);
  context.mock.timers.tick(50);
  assert.deepEqual(calls, ["latest", "reenter", "next"]);
  const failure = new Error("callback failure"), failing = debounce(() => { throw failure; });
  failing();
  assert.throws(() => failing.run(), error => error === failure);
  assert.equal(failing.run(), undefined);
});

test("browser promise timers resolve values and remove listeners on completion and abort", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController(), signal = controller.signal;
  const remove = context.mock.method(signal, "removeEventListener");
  const value = { preserved: true }, completed = browserPromiseTimers.setTimeout(20, value, { signal });
  context.mock.timers.tick(20);
  assert.equal(await completed, value);
  assert.equal(remove.mock.callCount(), 1);
  const cancelled = browserPromiseTimers.setTimeout(50, "not returned", { signal });
  const reason = new Error("cancelled by plugin");
  controller.abort(reason);
  await assert.rejects(cancelled, error => error.name === "AbortError" && error.code === "ABORT_ERR" && error.cause === reason);
  assert.equal(remove.mock.callCount(), 2);
  context.mock.timers.tick(100);
  await assert.rejects(browserPromiseTimers.setTimeout(1, undefined, { signal }), error => error.cause === reason);
  await assert.rejects(browserPromiseTimers.setTimeout(1, undefined, { ref: false }), /process-liveness/);
});

test("custom plugin value controls bind option listeners to the live component and retain falsy values", () => {
  class CustomControl extends ValueComponent {
    value = "initial";
    getValue() { return this.value; }
    setValue(value) { this.value = value; return this; }
  }
  const control = new CustomControl(), listeners = {};
  assert.equal(control.then(component => component.registerOptionListener(listeners, "font")), control);
  const callback = listeners.font;
  assert.equal(callback(), "initial");
  assert.equal(callback(""), "");
  assert.equal(control.getValue(), "");
  assert.equal(callback(false), false);
  control.setValue("external update");
  assert.equal(callback(), "external update");
});

test("plugin hotkeys retain exact modifiers, availability priority and cleanup without consuming unavailable commands", () => {
  const enabled = new Set(), dispatched = [];
  const manager = new HotkeyManager(id => { if (!enabled.has(id)) { return false; } dispatched.push(id); return true; });
  const bindings = [{ modifiers: ["Ctrl"], key: "s" }];
  manager.addDefaultHotkeys("first", bindings);
  manager.addDefaultHotkeys("drawing", bindings);
  bindings[0].key = "x";
  function key(shift = false) {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: "s", code: "KeyS", ctrlKey: true, metaKey: false, altKey: false, shiftKey: shift, isComposing: false });
    return event;
  }
  let event = key();
  assert.equal(manager.handle(event), false);
  assert.equal(event.defaultPrevented, false);
  enabled.add("first");
  assert.equal(manager.handle(key()), true);
  enabled.add("drawing");
  assert.equal(manager.handle(key(true)), false);
  event = key();
  assert.equal(manager.handle(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.throws(() => manager.addDefaultHotkeys("drawing", [{ modifiers: ["Unsupported"], key: "s" }]), /supported modifiers/);
  assert.equal(manager.handle(key()), true, "A rejected replacement must retain the existing binding.");
  manager.removeDefaultHotkeys("drawing");
  assert.equal(manager.handle(key()), true);
  assert.deepEqual(dispatched, ["first", "drawing", "drawing", "first"]);
  manager.removeDefaultHotkeys("first");
  assert.equal(manager.handle(key()), false);
});

test("root-scope overrides retain native ordering, browser default behavior and owned removal", () => {
  const scope = new Scope(), keymap = new Keymap(scope), calls = [];
  scope.register(null, null, () => { calls.push("application"); return false; });
  const override = scope.register(["Ctrl"], "f", () => { calls.push("drawing"); return true; });
  scope.keys.unshift(scope.keys.pop());
  function key() {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: "f", code: "KeyF", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false });
    return event;
  }
  const event = key();
  assert.equal(keymap.handle(event), true);
  assert.equal(event.defaultPrevented, false, "The plugin may deliberately delegate to the native canvas/browser without running application shortcuts.");
  assert.deepEqual(calls, ["drawing"]);
  scope.unregister(override);
  scope.unregister(override);
  const fallback = key();
  assert.equal(keymap.handle(fallback), true);
  assert.equal(fallback.defaultPrevented, true);
  assert.deepEqual(calls, ["drawing", "application"]);
});

test("keymap scopes inherit explicitly and remove inactive scopes without disturbing the active scope", () => {
  const root = new Scope(), keymap = new Keymap(root), calls = [];
  const first = new Scope(root), second = new Scope(root);
  root.register([], "x", () => { calls.push("root"); return false; });
  first.register([], "x", () => { calls.push("first"); return false; });
  second.register([], "y", () => { calls.push("second"); return false; });
  function key(value) {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: value, code: "Key" + value.toUpperCase(), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    return event;
  }
  keymap.pushScope(first);
  keymap.pushScope(first);
  keymap.pushScope(second);
  keymap.popScope(first);
  keymap.popScope(root);
  keymap.handle(key("y"));
  keymap.handle(key("x"));
  keymap.popScope(second);
  keymap.handle(key("x"));
  assert.deepEqual(calls, ["second", "root", "root"]);
  const isolated = new Scope();
  isolated.register([], "x", () => {});
  keymap.pushScope(isolated);
  assert.equal(keymap.handle(key("x")), false);
  assert.deepEqual(calls, ["second", "root", "root"], "A specific undefined-returning handler must not fall through to a parent or application binding.");
});

test("plugin CLI dispatch validates flags, awaits real callbacks and cleans up by callback identity", async () => {
  const app = { changingVault: false }, cli = new Cli(app), received = [];
  const flags = { file: { description: "Output path", value: "<path>", required: true }, open: { description: "Open output" } };
  const handler = async parameters => { await Promise.resolve(); received.push(parameters); return parameters.file; };
  cli.registerHandler("probe:create", "Create a note", flags, handler);
  flags.file.required = false;
  cli.listHandlers()[0].flags.file.required = false;
  await assert.rejects(cli.dispatch("probe:create"), /parameter is required: file/);
  await assert.rejects(cli.dispatch("probe:create", { file: "Note.md", toString: "true" }), /Unknown CLI parameter: toString/);
  await assert.rejects(cli.dispatch("probe:create", { file: "Note.md", open: "invalid" }), /boolean parameter/);
  assert.equal(await cli.dispatch("probe:create", { file: "Note.md", open: "false" }), "Note.md");
  assert.deepEqual(received, [{ file: "Note.md", open: "false" }]);
  assert.throws(() => cli.registerHandler("probe:create", "Duplicate", null, handler), /Duplicate CLI/);
  cli.unregisterHandler("probe:create", () => "");
  assert.equal(await cli.dispatch("probe:create", { file: "Next.md" }), "Next.md");
  app.changingVault = true;
  await assert.rejects(cli.dispatch("probe:create", { file: "No.md" }), /vault change/);
  app.changingVault = false;
  cli.unregisterHandler("probe:create", handler);
  await assert.rejects(cli.dispatch("probe:create", { file: "No.md" }), /unavailable/);
});

test("plugin CLI failures reject instead of becoming success-shaped results", async () => {
  const cli = new Cli({ changingVault: false });
  cli.registerHandler("probe:reject", "Reject", null, async () => { throw new Error("Actual handler rejection"); });
  cli.registerHandler("probe:invalid", "Invalid result", null, () => ({ not: "text" }));
  await assert.rejects(cli.dispatch("probe:reject"), /Actual handler rejection/);
  await assert.rejects(cli.dispatch("probe:invalid"), /did not return text/);
  await assert.rejects(cli.dispatch("probe:reject", { invalid: true }), /record of string values/);
});

test("plugin fuzzy suggestions prefer contiguous matches and retain exact source ranges", () => {
  const search = prepareFuzzySearch("ab");
  assert.deepEqual(search("aab").matches, [[1, 3]]);
  assert.deepEqual(search("a_b").matches, [[0, 1], [2, 3]]);
  assert.ok(search("ab").score > search("a_b").score);
  assert.equal(search("another"), null);
  assert.deepEqual(prepareFuzzySearch("")("any item"), { score: 0, matches: [] });
});

test("plugin fuzzy suggestion ranges remain original UTF-16 offsets after Unicode case folding", () => {
  const text = "\u0130nbox \u{1f680}";
  const result = prepareFuzzySearch("i\u{1f680}")(text);
  assert.deepEqual(result.matches, [[0, 1], [6, 8]]);
  assert.deepEqual(result.matches.map(([from, to]) => text.slice(from, to)), ["\u0130", "\u{1f680}"]);
  assert.deepEqual(prepareFuzzySearch("i\u0307")("\u0130").matches, [[0, 1]]);
});

test("plugin frontmatter boundaries preserve exact CRLF contents and reject missing/unterminated headers", () => {
  const content = "---\r\nname: [invalid YAML\r\n---\r\n\r\nBody\r\n";
  const info = getFrontMatterInfo(content);
  assert.equal(info.exists, true);
  assert.equal(info.frontmatter, "name: [invalid YAML\r\n");
  assert.equal(content.slice(info.from, info.to), info.frontmatter);
  assert.equal(content.slice(info.contentStart), "\r\nBody\r\n");
  for (const absent of ["Body\n---\n", "---\nname: value\n", "\ufeff---\nname: value\n---\n"]) {
    assert.deepEqual(getFrontMatterInfo(absent), { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 });
  }
});

test("Live Preview keeps genuine GFM formatting when a plugin installs another stream language", () => {
  const content = "# Heading\n\n**Visible strong**\n\nEnd";
  const stream = StreamLanguage.define({ token(input) { input.skipToEnd(); return null; } });
  const state = EditorState.create({
    doc: content, selection: { anchor: content.length },
    extensions: [markdownEditor({ base: markdownLanguage }), Prec.high(stream)],
  });
  assert.equal(stream.isActiveAt(state, 0), true);
  const ranges = [];
  livePreviewDecorations(state, { path: "Fixture.md", root: "fixture", leaf: null, isCurrent: () => false }).between(0, state.doc.length, (from, to, decoration) => {
    ranges.push({ text: state.doc.sliceString(from, to), ...decoration.spec });
  });
  assert.ok(ranges.some(range => range.class === "cm-live-strong" && range.text === "Visible strong"));
  assert.ok(ranges.some(range => range.class === "cm-live-heading cm-live-heading-1"));
});

function previewRanges(content, anchor = content.length) {
  const state = EditorState.create({ doc: content, selection: { anchor }, extensions: [markdownEditor({ base: markdownLanguage })] });
  const ranges = [];
  livePreviewDecorations(state, { path: "Fixture.md", root: "fixture", leaf: null, isCurrent: () => false }).between(0, state.doc.length, (from, to, decoration) => {
    ranges.push({ from, to, text: state.doc.sliceString(from, to), ...decoration.spec });
  });
  return ranges;
}

test("editor tags retain the native split hash/name chips without replacing editable source", () => {
  const text = "---\ntags: [property]\n---\n\nPlain #project/nested #under_score #\u65e5\u672c\u8a9e #123abc #trailing/ #double//slash.\n\n\\#escaped `#code` (#bracket) **#bold** [#label](https://example.invalid/#fragment) foo#word #123\n\n```\n#fenced\n```\n";
  const stream = StreamLanguage.define({ token(input) { input.skipToEnd(); return "comment"; } });
  for (const extensions of [[markdownSupport], [markdownSupport, Prec.high(stream)]]) {
    const state = EditorState.create({ doc: text, extensions });
    const names = [], hashes = [];
    markdownTagDecorations(state).between(0, state.doc.length, (from, to, decoration) => {
      assert.equal(decoration.spec.widget, undefined);
      assert.equal(decoration.spec.attributes.spellcheck, "false");
      assert.equal(state.sliceDoc(from, to), decoration.spec.class.includes("cm-hashtag-begin") ? "#" : decoration.spec.attributes["data-markdown-tag"].slice(1));
      (decoration.spec.class.includes("cm-hashtag-begin") ? hashes : names).push(state.sliceDoc(from, to));
    });
    assert.deepEqual(names, ["project/nested", "under_score", "\u65e5\u672c\u8a9e", "123abc", "trailing/", "double//slash"]);
    assert.equal(hashes.length, names.length);
    assert.equal(state.sliceDoc(), text);
  }
});

test("native parenthesized tag boundaries agree with Reading while external link labels remain indexed", () => {
  const text = "Plain #project (#bracket) ( #spaced) [#label](https://example.invalid) **#bold** #日本語 `#code` \\#escaped";
  assert.deepEqual(parseMarkdown(text).tags.map(entry => entry.tag), ["#project", "#spaced", "#label", "#bold", "#日本語"]);
});

test("Live Preview properties hide valid BOM/CRLF frontmatter without changing bytes or hiding invalid YAML", () => {
  for (const prefix of ["", "\ufeff"]) for (const ending of ["\n", "\r\n"]) {
    const text = prefix + ["---", "tags: [project]", "status: review", "---", "# Body", "", "**visible**"].join(ending);
    const state = EditorState.create({ doc: text, selection: { anchor: text.replace(/\r\n/g, "\n").length }, extensions: [markdownSupport] });
    const context = enabled => ({ path: "Fixture.md", root: "fixture", leaf: { app: { core: { isEnabled: () => enabled } } }, isCurrent: () => true });
    const capture = enabled => { const ranges = []; livePreviewDecorations(state, context(enabled)).between(0, state.doc.length, (from, to, value) => ranges.push({ from, to, ...value.spec })); return ranges; };
    const hidden = capture(true).find(range => range.block && !range.widget);
    assert.equal(hidden.from, 0);
    assert.match(state.doc.sliceString(hidden.from, hidden.to), /status: review\n---$/);
    assert.ok(capture(true).some(range => range.class === "cm-live-strong"));
    assert.equal(capture(false).some(range => range.block && !range.widget), false);
    assert.equal(state.doc.toString(), text.replace(/\r\n/g, "\n"));
  }
  assert.equal(previewRanges("---\ntags: [invalid\n---\nBody").some(range => range.block && !range.widget), false);
});

test("live preview formats mixed inline syntax and wiki aliases, revealing only the selected source markers", () => {
  const text = "# Heading\n\n**Strong** with `code`, *emphasis*, ~~removed~~, ==highlight== and [[Target|Alias]].\n\nEnd";
  const passive = previewRanges(text);
  for (const [className, content] of [["cm-live-strong", "Strong"], ["cm-live-inline-code", "code"], ["cm-live-emphasis", "emphasis"], ["cm-live-strike", "removed"], ["cm-live-highlight", "highlight"]]) {
    assert.ok(passive.some(range => range.class === className && range.text === content), className + " renders its real content");
  }
  assert.ok(passive.some(range => range.attributes?.["data-live-link"] === "Target" && range.text === "Alias"));
  const hiddenStrong = range => !range.class && !range.widget && range.text === "**";
  assert.equal(passive.filter(hiddenStrong).length, 2);
  const active = previewRanges(text, text.indexOf("Strong") + 2);
  assert.equal(active.filter(hiddenStrong).length, 0);
  assert.ok(active.some(range => !range.class && !range.widget && range.text === "[[Target|"));
  assert.ok(active.some(range => range.class === "cm-live-strong" && range.text === "Strong"));
});

test("live preview leaves frontmatter, fenced code, comments and escaped highlights literal while keeping surrounding formatting", () => {
  const text = "---\ntitle: '**YAML**'\n---\n\nReal **bold** beside `**inline literal**`.\n\n```md\n**fenced literal**\n[[Not a link]]\n```\n\n<!-- **comment literal** -->\n\\==escaped== and ==visible==\n\nEnd";
  const ranges = previewRanges(text);
  assert.deepEqual(ranges.filter(range => range.class === "cm-live-strong").map(range => range.text), ["bold"]);
  assert.deepEqual(ranges.filter(range => range.class === "cm-live-highlight").map(range => range.text), ["visible"]);
  assert.equal(ranges.some(range => range.attributes?.["data-live-link"]), false);
  const frontmatterEnd = text.indexOf("---", 4) + 3;
  assert.equal(ranges.some(range => range.from < frontmatterEnd), false);
  const literal = text.indexOf("**fenced literal**");
  assert.equal(ranges.some(range => range.from >= literal && range.to <= literal + 18 && range.to > range.from), false);
});

test("word counts distinguish numeric groups, letter runs and apostrophe/hyphen punctuation", () => {
  assert.equal(countWords("alpha beta.gamma 1,234.5 42abc don't l'esprit rock\u2019n\u2019roll co-op --- '\u2019 \u{1f600}"), 12);
  assert.equal(countWords(" \r\n\t# * _ \u{1f600}"), 0);
});

test("word counts use individual CJK/kana and Tibetan letters, grouped Korean/Tamil and no emoji words", () => {
  assert.equal(countWords("\u4e2d\u6587 \u65e5\u672c\u8a9e \u304b\u306a \u30ab\u30bf\u30ab\u30ca \ud55c\uae00 \u0ba4\u0bae\u0bbf\u0bb4\u0bcd \u0f56\u0f7c\u0f51 \u{1f600}"), 15);
  assert.equal(countWords("\u03bb caf\u00e9 \u{1f680}"), 2);
});

test("composition appends/prepends bodies, merges structured metadata and retains BOM, CRLF and distinct exact numeric tokens", () => {
  const target = "\ufeff---\r\n# Retain this comment\r\ncount: 9007199254740993\r\nlist: [9007199254740992, keep]\r\nobject: { retained: true }\r\nempty: false\r\n---\r\nOriginal\r\n";
  const incoming = "---\r\nlist: [9007199254740993, keep, added]\r\nobject: null\r\nempty: null\r\nnested: { source: true }\r\n---\r\nInserted\r\n";
  const result = insertMarkdown(target, incoming);
  assert.ok(result.startsWith("\ufeff---\r\n"));
  assert.ok(!/(?<!\r)\n/.test(result));
  assert.match(result, /# Retain this comment/);
  assert.match(result, /count: 9007199254740993/);
  assert.match(result, /list: \[ 9007199254740992, keep, 9007199254740993, added \]/);
  assert.deepEqual(parseMarkdown(result).frontmatter.object, { retained: true });
  assert.equal(parseMarkdown(result).frontmatter.empty, null);
  assert.deepEqual(parseMarkdown(result).frontmatter.nested, { source: true });
  assert.ok(result.endsWith("---\r\nOriginal\r\n\r\nInserted\r\n"));
  assert.equal(insertMarkdown("Original\n", "Inserted", "prepend"), "Inserted\n\nOriginal\n");
  assert.equal(insertMarkdown("Original\n\n", "\nInserted"), "Original\n\n\nInserted");
  const fresh = insertMarkdown("", "---\r\ncount: 9007199254740993\r\n---\r\nBody\r\n");
  assert.ok(fresh.startsWith("---\r\n"));
  assert.ok(!/(?<!\r)\n/.test(fresh));
  assert.match(fresh, /count: 9007199254740993/);
});

test("composition headings include their children, exclude frontmatter/code and use raw CRLF selection boundaries", () => {
  const text = "---\r\ntitle: Keep\r\n---\r\n# Before\r\n\r\n## Move\r\nBody Ω\r\n\r\n### Child\r\nNested\r\n\r\n## Stay\r\n```md\r\n# Not a heading\r\n```\r\n";
  const section = composerHeading(text, 5);
  assert.equal(section.heading, "Move");
  assert.equal(section.from, text.indexOf("## Move"));
  assert.equal(text.slice(section.from, section.to), "## Move\r\nBody Ω\r\n\r\n### Child\r\nNested");
  assert.equal(composerHeading(text, 13), null);
  assert.equal(composerHeading(text, 1), null);
  const last = composerHeading(text, 11);
  assert.equal(last.to, text.length);
  assert.equal(composerHeading("Underlined\r\n==========\r\nLast", 0).to, "Underlined\r\n==========\r\nLast".length);
});

test("composer template substitution is literal and one-pass, and a missing content slot is appended", () => {
  assert.equal(composerTemplate("{{newTitle}} $&", "{{newTitle}} / {{fromTitle}}\n{{content}}", "$`source", "$& target"), "$& target / $`source\n{{newTitle}} $&");
  assert.equal(composerTemplate("Text", "# {{newTitle}}", "Source", "Target"), "# Target\n\nText");
  assert.equal(composerTemplate("\ufeffText\r\n", "", "Source", "Target"), "\ufeffText\r\n");
  const properties = composerTemplate("---\r\nprecise: 9007199254740993\r\ntags: [source]\r\n---\r\nBody", "---\ntags: [template]\nfrom: '{{fromTitle}}'\n---\n# {{newTitle}}\n{{content}}", "Source", "Target");
  assert.match(properties, /precise: 9007199254740993/);
  assert.deepEqual(parseMarkdown(properties).frontmatter.tags, ["source", "template"]);
  assert.equal(parseMarkdown(properties).frontmatter.from, "Source");
  assert.ok(properties.endsWith("# Target\r\nBody"));
  assert.equal((properties.match(/^---/gm) ?? []).length, 2);
});

test("selection extraction carries reference/image and transitive footnote definitions without changing surrounding source", () => {
  const text = "Before\r\n[Note][note] ![Image][image] [^first]\r\nAfter\r\n\r\n[note]: Target.md \"Title\"\r\n[image]: Assets/image.png\r\n\r\n[^first]: Footnote [^second] and [Note][note]\r\n[^second]: Nested footnote\r\n";
  const from = text.indexOf("[Note]");
  const to = text.indexOf("\r\nAfter");
  const fragment = composerFragment(text, from, to);
  assert.ok(fragment.startsWith(text.slice(from, to) + "\r\n\r\n"));
  assert.match(fragment, /\[note\]: Target.md "Title"/);
  assert.match(fragment, /\[image\]: Assets\/image.png/);
  assert.match(fragment, /\[\^first\]: Footnote \[\^second\]/);
  assert.match(fragment, /\[\^second\]: Nested footnote/);
  assert.equal((fragment.match(/\[note\]:/g) ?? []).length, 1);
  assert.ok(!fragment.includes("Before") && !fragment.includes("\r\nAfter"));
  assert.ok(!/(?<!\r)\n/.test(fragment));
  assert.throws(() => composerFragment("Text", -1, 2), /nonempty selection/);
  assert.throws(() => composerFragment("Missing [^unknown]", 0, 18), /missing or duplicate footnote/);
});

test("composition refuses invalid YAML, unsafe inserted aliases and conflicting reference/footnote definitions", () => {
  assert.throws(() => insertMarkdown("Original", "---\nx: [bad\n---\nText"), /YAML|flow|expected/i);
  assert.throws(() => insertMarkdown("Original", "---\nx: &value One\ny: *value\n---\nText"), /aliases\/anchors/);
  assert.throws(() => insertMarkdown("[ref]: First.md", "[ref]: Second.md"), /conflicting reference-link/);
  assert.throws(() => insertMarkdown("[^ref]: First", "[^ref]: Second"), /conflicting footnote/);
});

test("composition relocates relative links and preserves original self references when content is copied", () => {
  const files = ["Notes/Source.md", "Notes/Related.md", "Assets/space image.png", "Deep/Folder/Target.md"].map(path => ({ path }));
  const text = "[Related](Related.md) ![Image](../Assets/space%20image.png) [[#Stay]]";
  const moved = relocateMarkdownLinks(text, parseMarkdown(text), files, "Notes/Source.md", "Deep/Folder/Target.md");
  assert.equal(moved, "[Related](../../Notes/Related.md) ![Image](../../Assets/space%20image.png) [[Notes/Source#Stay]]");
  const self = "[[Source#Moved]] [[#Stay]]";
  assert.equal(rewriteFileLinks(self, parseMarkdown(self), files, "Notes/Source.md", "Notes/Source.md", "Deep/Folder/Target.md"), "[[Deep/Folder/Target#Moved]] [[#Stay]]");
  assert.equal(fileLinktext([...files, { path: "Other/Target.md" }], "Deep/Folder/Target.md", "Notes/Source.md"), "Deep/Folder/Target");
});

function linkPreferenceFixture(paths, preferences = {}, readOnly = false) {
  const settings = { newLinkFormat: "shortest", useMarkdownLinks: false, ...preferences }, texts = new Map(), opened = [];
  const vault = new Vault(async () => {}, undefined, key => settings[key]);
  vault.setSnapshot({
    root: "link-preferences-fixture", name: "Link preferences", readOnly,
    files: paths.map(path => {
      const name = path.split("/").at(-1), dot = name.lastIndexOf(".");
      return { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1), stat: { ctime: 1, mtime: 1, size: 0 } };
    }),
  });
  const app = {
    vault, changingVault: false, switcherEnabled: true, bookmarksEnabled: false,
    switcherSettings: { showExistingOnly: true, showAttachments: true, showAllFileTypes: false },
    workspace: { sessions: new Map(), getRecentFiles: () => [], viewTypeForExtension: extension => extension === "png" ? "image" : extension === "canvas" ? "canvas" : null },
    core: {
      state: () => ({ settings: app.switcherSettings }),
      isEnabled: id => id === "bookmarks" ? app.bookmarksEnabled : app.switcherEnabled,
      getEnabledPluginById: id => id === "bookmarks" && app.bookmarksEnabled ? app.bookmarks : null,
      run: async callback => callback(),
    },
    openFile: async (path, newTab) => { opened.push([path, newTab]); },
  };
  app.metadataCache = new MetadataCache(app);
  app.metadataCache.getFileCache = file => texts.has(file.path) ? parseMarkdown(texts.get(file.path)) : null;
  app.fileManager = new FileManager(app);
  app.bookmarks = new Bookmarks(app);
  return { app, settings, texts, opened, items: () => DesktopUI.prototype.switcherItems.call({ app }) };
}

test("configured link formats retain exact targets with extensions and root-shadowing paths", () => {
  const files = ["Target.md", "Notes/Source.md", "Notes/Target.md", "Sub/Target.md", "Notes/Sub/Target.md", "Assets/image.png"].map(path => ({ path }));
  assert.equal(fileLinktext(files, "Notes/Sub/Target.md", "Notes/Source.md", true, "relative"), "./Sub/Target");
  assert.equal(fileLinktext(files, "Target.md", "Notes/Source.md", true, "absolute"), "/Target");
  assert.equal(fileLinktext(files, "Assets/image.png", "Notes/Source.md", true, "relative"), "../Assets/image.png");
  assert.equal(fileLinktext(files, "Assets/image.png", "Notes/Source.md", false, "absolute"), "Assets/image.png");
  for (const format of ["shortest", "relative", "absolute"]) {
    for (const path of files.map(file => file.path)) {
      for (const omit of [true, false]) {
        const text = fileLinktext(files, path, "Notes/Source.md", omit, format);
        assert.equal(createLinkResolver(files)(text, "Notes/Source.md").file.path, path);
      }
    }
  }
  assert.throws(() => fileLinktext(files, "Target.md", "Notes/Source.md", true, "unknown"), /new-link format/);
});

test("generated Markdown and wiki links honor imported formats, real fragments and escaped labels", () => {
  const { app, settings } = linkPreferenceFixture(["Notes/Source.md", "Deep/Target.md", "Other/Target.md", "Assets/space (é)% #.png"]);
  const target = app.vault.getFileByPath("Deep/Target.md"), source = "Notes/Source.md";
  assert.equal(app.fileManager.generateMarkdownLink(target, source), "[[Deep/Target]]");
  settings.newLinkFormat = "relative";
  assert.equal(app.metadataCache.fileToLinktext(target, source), "../Deep/Target");
  assert.equal(app.fileManager.generateMarkdownLink(target, source, "#Heading", "Caption"), "[[../Deep/Target#Heading|Caption]]");
  settings.useMarkdownLinks = true;
  assert.equal(app.fileManager.generateMarkdownLink(target, source, "#Heading", "Caption [kept]"), "[Caption \\[kept\\]](../Deep/Target.md#Heading)");
  settings.newLinkFormat = "absolute";
  assert.equal(app.fileManager.generateMarkdownLink(target, source), "[Target](Deep/Target.md)");
  const image = app.vault.getFileByPath("Assets/space (é)% #.png");
  const link = app.fileManager.generateMarkdownLink(image, source, "#^block", "Image [one]");
  assert.equal(link, "[Image \\[one\\]](Assets/space%20%28%C3%A9%29%25%20%23.png#%5Eblock)");
  const reference = parseMarkdown(link).links[0];
  assert.equal(linkDestination(app.vault.getFiles(), reference, source).file, image);
  assert.equal(parseLinktext(reference.link, true).subpath, "#^block");
  assert.equal(app.fileManager.generateMarkdownLink(app.vault.getFileByPath(source), source, "#Same note"), "[Source](#Same%20note)");
  settings.useMarkdownLinks = false;
  assert.equal(app.fileManager.generateMarkdownLink(app.vault.getFileByPath(source), source, "#Same note"), "[[#Same note]]");
});

test("link generation refuses invalid supported preferences without changing them", () => {
  const { app, settings } = linkPreferenceFixture(["Source.md", "Target.md"]);
  const file = app.vault.getFileByPath("Target.md");
  settings.newLinkFormat = null;
  assert.throws(() => app.metadataCache.fileToLinktext(file, "Source.md"), /new-link format/);
  assert.throws(() => app.fileManager.generateMarkdownLink(file, "Source.md"), /new-link format/);
  assert.equal(settings.newLinkFormat, null);
  delete settings.newLinkFormat;
  settings.useMarkdownLinks = "yes";
  assert.equal(app.metadataCache.fileToLinktext(file, "Source.md"), "Target");
  assert.throws(() => app.fileManager.generateMarkdownLink(file, "Source.md"), /must be a Boolean/);
  assert.equal(settings.useMarkdownLinks, "yes");
  delete settings.useMarkdownLinks;
  assert.equal(app.fileManager.generateMarkdownLink(file, "Source.md"), "[[Target]]");
  assert.throws(() => app.fileManager.generateMarkdownLink(file, "Source.md", {}), /must be text/);
});

test("read-only link APIs remain pure and reject foreign or replaced file identities", () => {
  const { app } = linkPreferenceFixture(["Source.md", "Target.md"], { useMarkdownLinks: true }, true);
  const file = app.vault.getFileByPath("Target.md"), snapshot = () => app.vault.getFiles().map(entry => [entry.path, { ...entry.stat }]), before = snapshot();
  assert.equal(app.metadataCache.fileToLinktext(file, "Source.md", false), "Target.md");
  assert.equal(app.fileManager.generateMarkdownLink(file, "Source.md"), "[Target](Target.md)");
  assert.deepEqual(snapshot(), before);
  const foreign = new TFile({}, { path: file.path, basename: file.basename, extension: file.extension, stat: file.stat });
  assert.throws(() => app.fileManager.generateMarkdownLink(foreign, "Source.md"), /not in the selected vault/);
  app.vault.setSnapshot({ root: "replacement-fixture", name: "Replacement", files: [] });
  assert.throws(() => app.metadataCache.fileToLinktext(file, "Source.md"), /not in the selected vault/);
  assert.throws(() => app.fileManager.generateMarkdownLink(file, "Source.md"), /not in the selected vault/);
});

test("Quick switcher aliases retain distinct file owners and literal names without duplicating one alias", async () => {
  const { app, texts, opened, items } = linkPreferenceFixture(["Notes/First.md", "Other/Second.md", "image.png", "unsupported.xyz"]);
  texts.set("Notes/First.md", '---\naliases: ["Shared alias", "Shared alias", "<b>literal</b>", ""]\n---\nFirst\n');
  texts.set("Other/Second.md", "---\naliases: Shared alias\n---\nSecond\n");
  const results = items(), aliases = results.filter(item => item.alias === "Shared alias");
  assert.deepEqual(aliases.map(item => item.path), ["Notes/First.md", "Other/Second.md"]);
  assert.equal(new Set(aliases.map(item => item.id)).size, 2);
  assert.ok(results.some(item => item.alias === "<b>literal</b>" && item.name === "<b>literal</b>"));
  assert.ok(results.some(item => item.path === "image.png"));
  assert.ok(!results.some(item => item.path === "unsupported.xyz"));
  await aliases[1].action(true);
  assert.deepEqual(opened, [["Other/Second.md", "tab"]]);
  assert.equal(app.vault.getFiles().length, 4);
});

test("obsolete Quick switcher aliases and file owners cannot open changed or disabled vault targets", async () => {
  const { app, texts, opened, items } = linkPreferenceFixture(["First.md"]);
  texts.set("First.md", "---\naliases: Original alias\n---\n");
  const results = items(), alias = results.find(item => item.alias), file = results.find(item => !item.alias);
  texts.set("First.md", "---\naliases: Replacement alias\n---\n");
  await assert.rejects(alias.action(false), /alias changed/);
  app.switcherEnabled = false;
  await assert.rejects(file.action(false), /no longer available/);
  app.switcherEnabled = true;
  app.vault.setSnapshot({ root: "foreign-fixture", name: "Other vault", files: [] });
  await assert.rejects(file.action(false), /no longer available/);
  assert.deepEqual(opened, []);
});

test("Quick switcher keeps recent-file order separate from aliases, unresolved links and bookmark suggestions", () => {
  const { app, texts, items } = linkPreferenceFixture(["First.md", "Last.md", "board.canvas", "image.png"]);
  texts.set("First.md", "---\naliases: Shared alias\n---\n");
  app.workspace.getRecentFiles = () => ["Last.md", "missing.md", "First.md"];
  app.bookmarksEnabled = true;
  app.bookmarks.document = { version: "v1", data: { items: [{ type: "file", path: "First.md", title: "Saved first" }] } };
  const results = items(), recent = results.filter(item => item.recent !== undefined).sort((a, b) => a.recent - b.recent);
  assert.deepEqual(recent.map(item => item.path), ["Last.md", "First.md"]);
  assert.ok(results.some(item => item.alias) && results.some(item => item.bookmark !== undefined));
  assert.ok(results.filter(item => item.alias || item.bookmark !== undefined).every(item => item.recent === undefined));
  app.switcherSettings.showAttachments = false;
  assert.ok(items().some(item => item.path === "board.canvas"), "Registered Canvas documents are not hidden by attachment visibility.");
  assert.ok(!items().some(item => item.path === "image.png"));
});

test("Quick switcher searches nested bookmark titles and dispatches actual bookmarked files with new-tab intent", async () => {
  const { app, items, opened } = linkPreferenceFixture(["First.md", "image.png", "board.canvas"]);
  const data = { future: { retained: true }, items: [{ type: "group", title: "<Work>", items: [
    { type: "file", path: "First.md", title: "Important" },
    { type: "group", title: "Nested", items: [
      { type: "search", query: "tag:#todo", title: "Find work" },
      { type: "graph", title: "Saved graph", options: { search: "path:Work" } },
      { type: "folder", path: "", title: "Vault folder" },
      { type: "url", url: "https://example.invalid/", title: "Site" },
    ] },
    { type: "file", path: "missing.md", title: "Missing file" },
    { type: "file", path: "image.png", title: "Hidden image" },
    { type: "file", path: "missing.md", subpath: "#Point", title: "Missing point" },
  ] }] };
  app.bookmarks.document = { version: "v1", data };
  app.bookmarksEnabled = true;
  app.switcherSettings.showAttachments = false;
  const before = structuredClone(data), results = items().filter(item => item.bookmark !== undefined);
  assert.deepEqual(results.map(item => item.name), ["<Work>/Important", "<Work>/Nested/Find work", "<Work>/Nested/Saved graph", "<Work>/Nested/Vault folder", "<Work>/Nested/Site", "<Work>/Missing point"]);
  assert.equal(results[1].detail, "tag:#todo");
  await results[0].action(true);
  assert.deepEqual(opened, [["First.md", "tab"]]);
  await assert.rejects(results.at(-1).action(false), /bookmarked file is missing/);
  assert.deepEqual(data, before);
});

test("obsolete Quick switcher bookmarks reject changed documents, in-place targets, disabled owners and replacement files", async () => {
  const { app, items, opened } = linkPreferenceFixture(["First.md", "Other.md"]);
  const item = { type: "file", path: "First.md", title: "Saved" };
  app.bookmarks.document = { version: "v1", data: { items: [item] } };
  app.bookmarksEnabled = true;
  const result = () => items().find(item => item.bookmark !== undefined);
  let stale = result();
  app.bookmarks.document.version = "v2";
  await assert.rejects(stale.action(false), /bookmark result changed/);
  stale = result(); item.path = "Other.md";
  await assert.rejects(stale.action(false), /bookmark result changed/);
  stale = result(); app.bookmarksEnabled = false;
  await assert.rejects(stale.action(false), /bookmark result changed/);
  app.bookmarksEnabled = true; stale = result(); app.bookmarks.document.data.items = [];
  await assert.rejects(stale.action(false), /bookmark result changed/);
  app.bookmarks.document.data.items = [item]; stale = result();
  app.vault.setSnapshot({ root: "replacement-fixture", name: "Other", files: [] });
  await assert.rejects(stale.action(false), /bookmark result changed/);
  assert.deepEqual(opened, []);
});

test("extraction retargets only moved heading/block links and safely merges references into an already existing destination", () => {
  const files = ["Notes/Source.md", "Deep/Target.md", "Incoming.md"].map(path => ({ path }));
  const text = "---\r\nrelated: \"[[Source#Moved]]\"\r\ncount: 9007199254740993\r\n---\r\n[[Source]] [[Source#Moved|Caption]] [[Source#Stay]] [[Source#^block]] [Heading](Notes/Source.md#Moved)\r\n";
  const updated = rewriteSectionLinks(text, parseMarkdown(text), files, "Incoming.md", "Notes/Source.md", "Deep/Target.md", ["#Moved", "#^block"]);
  assert.equal(parseMarkdown(updated).frontmatter.related, "[[Deep/Target#Moved]]");
  assert.ok(updated.includes("[[Source]] [[Deep/Target#Moved|Caption]] [[Source#Stay]] [[Deep/Target#^block]] [Heading](./Deep/Target.md#Moved)"), updated);
  assert.match(updated, /count: 9007199254740993/);
  assert.ok(!/(?<!\r)\n/.test(updated));
  const fragment = "[[#Moved]] [[#Stay]]";
  assert.equal(rewriteSectionLinks(fragment, parseMarkdown(fragment), files, "Notes/Source.md", "Notes/Source.md", "Deep/Target.md", ["#Moved"], "Deep/Target.md"), "[[#Moved]] [[Notes/Source#Stay]]");
  const merge = "[[Source]] [[Target]]";
  assert.equal(rewriteFileLinks(merge, parseMarkdown(merge), files, "Incoming.md", "Notes/Source.md", "Deep/Target.md"), "[[Deep/Target]] [[Target]]");
});

test("moving content refuses unresolved relative wiki, Markdown, image, reference and property targets instead of changing their future location", () => {
  const files = ["Notes/Source.md", "Deep/Target.md"].map(path => ({ path }));
  for (const text of [
    "[[Missing]]", "[[../Missing#Heading|Keep caption]]", "[Missing](./Missing.md)",
    "![Missing](Assets/Missing.png)", "[Missing][ref]\n\n[ref]: ../Missing.md",
    '---\nrelated: "[[Missing]]"\n---\nBody',
  ]) {
    assert.throws(() => relocateMarkdownLinks(text, parseMarkdown(text), files, "Notes/Source.md", "Deep/Target.md"), /Resolve this unresolved link/);
    assert.throws(() => rewriteFileLinks(text, parseMarkdown(text), files, "Notes/Source.md", "Notes/Source.md", "Deep/Target.md"), /Resolve this unresolved link/);
    assert.equal(relocateMarkdownLinks(text, parseMarkdown(text), files, "Notes/Source.md", "Notes/Other.md"), text);
  }
});

test("moving content preserves explicit missing vault-root targets and external URLs while refusing malformed relative URLs", () => {
  const files = ["Notes/Source.md", "Deep/Target.md"].map(path => ({ path }));
  const text = '[[/Future#Heading|Caption]] ![Future](/Assets/Missing.png) [External](https://example.invalid/bad%XX)\n---\n';
  assert.equal(relocateMarkdownLinks(text, parseMarkdown(text), files, "Notes/Source.md", "Deep/Target.md"), text);
  const invalid = "[Malformed](bad%XX.md)";
  assert.throws(() => relocateMarkdownLinks(invalid, parseMarkdown(invalid), files, "Notes/Source.md", "Deep/Target.md"), /Correct invalid URL encoding/);
  assert.equal(relocateMarkdownLinks(invalid, parseMarkdown(invalid), files, "Notes/Source.md", "Notes/Other.md"), invalid);
});

test("slides split only on top-level Markdown thematic breaks, not frontmatter, Setext headings, nested rules or code", () => {
  const source = "\ufeff---\r\ntitle: Deck\r\n---\r\n# First\r\n\r\nSetext\r\n------\r\n\r\n> Quote\r\n>\r\n> ---\r\n\r\n```md\r\n---\r\n```\r\n\r\n---\r\n\r\n# Second\r\n\r\n***\r\n\r\n# Third\r\n\r\n___\r\n";
  const slides = markdownSlides(source);
  assert.equal(slides.length, 3);
  assert.match(slides[0], /^# First\r\n/);
  assert.match(slides[0], /Setext\r\n------/);
  assert.match(slides[0], /> ---/);
  assert.match(slides[0], /```md\r\n---\r\n```/);
  assert.match(slides[1], /# Second/);
  assert.match(slides[2], /# Third/);
  assert.deepEqual(markdownSlides("---\n---\n\n"), [""]);
  assert.deepEqual(markdownSlides(""), [""]);
});

test("slides retain document-wide link reference definitions in each independently rendered slide", () => {
  const slides = markdownSlides("# First\n\n[Next][note]\n\n---\n\n# Second\n\n[note]: Target.md \"A note\"\n");
  assert.equal(slides.length, 2);
  assert.match(slides[0], /\[Next\]\[note\]/);
  assert.match(slides[0], /\[note\]: Target\.md "A note"/);
  assert.match(slides[1], /# Second/);
});

test("legacy Markdown conversion handles selected Roam and Bear syntax while preserving raw CRLF, Unicode and unrelated text", () => {
  const source = "\ufeff# Heading\r\n#topic #123 #[[Two words]] #日本語 #topic/sub, foo#keep \\#escaped\r\n^^a highlight^^ ::Bear text:: ^^ invalid^^ ::invalid ::\r\n- {{[[TODO]]}} work\r\n- {{[[DONE]]}} done\r\n`^^raw code^^`\r\nUnrelated Ω text.\r\n";
  const result = convertMarkdownFormats(source, ["roam-tags", "roam-highlights", "roam-todos", "bear-highlights"]);
  assert.equal(result.content, "\ufeff# Heading\r\n[[topic]] #123 [[Two words]] [[日本語]] [[topic/sub]], foo#keep \\#escaped\r\n==a highlight== ==Bear text== ^^ invalid^^ ::invalid ::\r\n- [ ] work\r\n- [x] done\r\n`==raw code==`\r\nUnrelated Ω text.\r\n");
  assert.equal(result.replacements, 9);
  assert.deepEqual(convertMarkdownFormats(source, []), { content: source, replacements: 0 });
  assert.equal(convertMarkdownFormats(source, ["roam-todos"]).content, source.replace("{{[[TODO]]}}", "[ ]").replace("{{[[DONE]]}}", "[x]"));
});

test("numeric legacy links use resolved destinations, distinguish link and alias modes and leave unresolved IDs intact", () => {
  const source = "[[20200101]] and [[404]] and [[20200101|Keep caption]].\r\n";
  const resolve = id => id === "20200101" ? { link: "Folder/20200101 Topic", title: "20200101 Topic" } : null;
  assert.equal(convertMarkdownFormats(source, ["zettelkasten-links"], resolve).content, "[[Folder/20200101 Topic]] and [[404]] and [[20200101|Keep caption]].\r\n");
  assert.equal(convertMarkdownFormats(source, ["zettelkasten-aliases"], resolve).content, "[[Folder/20200101 Topic|Topic]] and [[404]] and [[20200101|Keep caption]].\r\n");
  assert.throws(() => convertMarkdownFormats(source, ["zettelkasten-links"], () => { throw new Error("Ambiguous numeric target"); }), /Ambiguous/);
  assert.throws(() => convertMarkdownFormats(source, ["zettelkasten-links"], () => ({ link: "Invalid#filename", title: "Title" })), /safely/);
});

test("legacy frontmatter migration preserves original precision, anchors, comments, BOM and exact Markdown body", () => {
  const body = "# Body\r\n\r\nUnrelated text and ^^untouched^^.\r\n";
  const source = "\ufeff---\r\n# Keep comment\r\nAlias: First name, Second name\r\ntag: one two,three\r\ncssclass: first second\r\nprecise: 9007199254740993\r\nvalue: &keep { child: yes }\r\ncopy: *keep\r\n---\r\n" + body;
  const result = convertMarkdownFormats(source, ["frontmatter"]);
  const properties = parseMarkdown(result.content).frontmatter;
  assert.deepEqual(properties.aliases, ["First name", "Second name"]);
  assert.deepEqual(properties.tags, ["one", "two", "three"]);
  assert.deepEqual(properties.cssclasses, ["first", "second"]);
  assert.equal(properties.Alias, undefined);
  assert.ok(result.content.startsWith("\ufeff---\r\n"));
  assert.ok(result.content.endsWith("---\r\n" + body));
  assert.match(result.content, /# Keep comment\r\n/);
  assert.match(result.content, /precise: 9007199254740993\r\n/);
  assert.match(result.content, /&keep/);
  assert.match(result.content, /\*keep/);
  assert.equal(result.replacements, 6);
  assert.deepEqual(convertMarkdownFormats(result.content, ["frontmatter"]), { content: result.content, replacements: 0 });
  assert.deepEqual(convertMarkdownFormats(body, ["frontmatter"]), { content: body, replacements: 0 });
});

test("legacy migration rejects malformed, case-ambiguous and unsafe aliased properties without returning rewritten data", () => {
  assert.throws(() => convertMarkdownFormats("---\nalias: A\nalias: B\n---\nBody", ["frontmatter"]), /unique/);
  assert.throws(() => convertMarkdownFormats("---\nAliases: A\naliases: B\n---\nBody", ["frontmatter"]), /case-ambiguous/);
  assert.throws(() => convertMarkdownFormats("---\naliases: &value A\ncopy: *value\n---\nBody", ["frontmatter"]), /alias/i);
  assert.throws(() => convertMarkdownFormats("Unchanged", ["unknown"]), /unknown Markdown conversion/);
  const source = "---\nalias: Keep singular\naliases: [Existing]\n---\nBody";
  assert.deepEqual(convertMarkdownFormats(source, ["frontmatter"]), { content: source, replacements: 0 });
});

test("client saves and metadata observations deliver one event without losing no-op writes or external version transitions", async t => {
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  await mkdir(runtime, { recursive: true });
  const directory = await mkdtemp(join(runtime, "event-tests-"));
  let client;
  try {
    const outfile = join(directory, "client.mjs");
    await build({
      stdin: {
        contents: 'export { Vault } from "./client/vault"; export { MetadataCache } from "./client/metadata"; export { configureBrowserHost } from "./client/contracts";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
    });
    client = await import(pathToFileURL(outfile).href);
  } finally {
    await rm(directory, { recursive: true });
  }
  const { Vault, MetadataCache, configureBrowserHost } = client;
  let content = "AAAA";
  let revision = 1;
  let observeBeforeAcknowledgement = false;
  let present = true;
  let attachment = null;
  const file = () => ({ path: "Note.md", name: "Note.md", basename: "Note", extension: "md", stat: { ctime: 1, mtime: 1, size: content.length } });
  const document = () => ({ file: file(), content, version: content });
  const snapshot = () => ({ root: "fixture", name: "Fixture", files: [...(present === true ? [file()] : []), ...(attachment ? [attachment] : [])], plugins: [], folders: present === "folder" ? ["Note.md"] : [] });
  const app = {
    workspace: { sessions: new Map(), acceptExternalDocuments() {} },
    dotNet: { async invokeMethodAsync() {} },
    async notifyEditor() {},
  };
  configureBrowserHost({
    async request(path, method, body) {
      const route = new URL(path, "http://fixture.invalid").pathname;
      let value;
      if (route === "/api/binary" && method === "POST") {
        attachment = { path: body.path, name: "Image.png", basename: "Image", extension: "png", stat: { ctime: 1, mtime: ++revision, size: Buffer.from(body.base64, "base64").length } };
        value = { root: "fixture", file: attachment, version: body.base64 };
        if (observeBeforeAcknowledgement) {
          await app.metadataCache.refresh();
        }
      } else if (route === "/api/file" && method === "PUT") {
        content = body.content;
        revision++;
        value = document();
        if (observeBeforeAcknowledgement) {
          await app.metadataCache.refresh();
        }
      } else if (route === "/api/file") {
        value = document();
      } else if (route === "/api/vault") {
        value = snapshot();
      } else if (route === "/api/metadata/documents") {
        value = { root: "fixture", revision, documents: present === true ? [document()] : [], errors: [] };
      } else if (route === "/api/vault/revision") {
        value = { root: "fixture", revision };
      } else {
        throw new Error("Unexpected fixture request: " + path);
      }
      return { status: 200, value: structuredClone(value) };
    },
  });
  app.vault = new Vault(async () => {});
  app.vault.setSnapshot(snapshot());
  app.metadataCache = new MetadataCache(app);
  t.after(() => app.metadataCache.pause());
  await app.metadataCache.initialize("fixture");
  app.metadataCache.resume();
  const events = [];
  for (const name of ["create", "modify", "delete"]) {
    app.vault.on(name, file => events.push(`${name}:${file.path}`));
  }
  await app.vault.modify(app.vault.getAbstractFileByPath("Note.md"), "BBBB");
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), ["modify:Note.md"], "local write plus index observation must not duplicate the notification");
  observeBeforeAcknowledgement = true;
  await app.vault.modify(app.vault.getAbstractFileByPath("Note.md"), "CCCC");
  assert.deepEqual(events.splice(0), ["modify:Note.md"], "an observation arriving before the write acknowledgement must also count once");
  await app.vault.modify(app.vault.getAbstractFileByPath("Note.md"), "CCCC");
  await app.vault.modify(app.vault.getAbstractFileByPath("Note.md"), "CCCC");
  assert.deepEqual(events.splice(0), ["modify:Note.md", "modify:Note.md"], "successful explicit writes are not suppressed just because content/stat values match");
  for (const value of ["AAAA", "CCCC"]) {
    content = value;
    revision++;
    await app.metadataCache.refresh();
    assert.equal(app.metadataCache.getDocument("Note.md").text, value);
  }
  assert.deepEqual(events.splice(0), ["modify:Note.md", "modify:Note.md"], "A-B-A external changes remain visible even with unchanged size/timestamps");
  present = false;
  await app.metadataCache.refresh();
  present = true;
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), ["delete:Note.md", "create:Note.md"], "recreating a deleted path must not reuse its acknowledgement");
  present = "folder";
  await app.metadataCache.refresh();
  present = true;
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), ["delete:Note.md", "create:Note.md"], "a folder at the old file path must also clear the file's acknowledgement");
  observeBeforeAcknowledgement = false;
  await app.vault.createBinary("Image.png", new Uint8Array([0, 255, 1]).buffer);
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), ["create:Image.png"], "binary creation plus a later index observation counts once");
  attachment.stat = { ...attachment.stat, mtime: ++revision, size: 7 };
  await app.vault.refresh();
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), ["modify:Image.png"], "an inventory refresh must not consume an external attachment modification");
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), [], "unchanged attachments do not emit repeated modifications");
  attachment = null;
  revision++;
  await app.vault.refresh();
  await app.metadataCache.refresh();
  assert.deepEqual(events.splice(0), ["delete:Image.png"], "an inventory refresh must not consume an external attachment deletion");
  observeBeforeAcknowledgement = true;
  await app.vault.createBinary("Image.png", new Uint8Array([1, 255, 0]).buffer);
  await app.metadataCache.refresh();
  assert.deepEqual(events, ["create:Image.png"], "an attachment observed before its binary-write acknowledgement also counts once");
});

test("metadata retains raw CRLF/UTF-16 positions, heading levels, aliases, embeds and block targets", () => {
  const content = [
    "---",
    "tags: [frontmatter, project/nested]",
    'related: "[[Target|Property alias]]"',
    "---",
    "# First `heading`",
    "",
    "Setext heading",
    "--------------",
    "",
    "Emoji \u{1f680} [[Target#A heading|Alias]] ![[image.png]]",
    "",
    "A paragraph ^block-id",
    "",
  ].join("\r\n");
  const cache = parseMarkdown(content);
  assert.deepEqual(cache.errors, []);
  assert.deepEqual(cache.headings.map(({ heading, level }) => ({ heading, level })), [
    { heading: "First `heading`", level: 1 }, { heading: "Setext heading", level: 2 },
  ]);
  const link = cache.links[0];
  assert.equal(link.link, "Target#A heading");
  assert.equal(link.displayText, "Alias");
  assert.equal(link.position.start.offset, content.indexOf("[[Target#"));
  assert.deepEqual(link.position.start, { line: 9, ch: 9, offset: content.indexOf("[[Target#") });
  assert.equal(content.slice(link.targetPosition.start.offset, link.targetPosition.end.offset), "Target#A heading");
  assert.equal(cache.embeds[0].link, "image.png");
  assert.equal(cache.frontmatterLinks[0].link, "Target");
  assert.deepEqual(cache.frontmatterLinks[0].propertyPath, ["related"]);
  assert.deepEqual(allTags(cache), ["#frontmatter", "#project/nested"]);
  assert.equal(resolveSubpath(cache, "#First heading").start.line, 4);
  assert.equal(resolveSubpath(cache, "#^block-id").start.line, 11);
  assert.equal(resolveSubpath(cache, "#absent"), null);
});

test("metadata excludes code, comments, escaped markup and numeric tags, including false headings", () => {
  const content = [
    "# Real [[Target]]",
    "\\[[Escaped]] \\#escaped #real/nested #123",
    "`[[Inline]] #inline`",
    "```markdown",
    "# False",
    "[[Fenced]] #fenced",
    "[^fake]: Hidden",
    "```",
    "",
    "    [[Indented]] #indented",
    "",
    "<!-- [[Comment]] #comment",
    "# Also not a heading",
    "-->",
    "[Display](Target.md#Section) ![Image](image.png)",
    "[Web](https://example.invalid/) [Email](mailto:test@example.invalid)",
    "",
  ].join("\n");
  const cache = parseMarkdown(content);
  assert.deepEqual(cache.headings.map(entry => entry.heading), ["Real [[Target]]"]);
  assert.deepEqual(cache.links.map(entry => entry.link), ["Target", "Target.md#Section"]);
  assert.deepEqual(cache.embeds.map(entry => entry.link), ["image.png"]);
  assert.deepEqual(allTags(cache), ["#real/nested"]);
  assert.deepEqual(cache.footnotes, []);
});

test("footnote definitions, multiline contents and multiple references have navigable positions", () => {
  const content = "One [^alpha] and two [^alpha].\r\n\r\n[^alpha]: Definition [[Target]]\r\n    continuation #tag\r\n\r\nNext paragraph.";
  const cache = parseMarkdown(content);
  assert.deepEqual(cache.footnoteRefs.map(reference => reference.id), ["alpha", "alpha"]);
  assert.equal(cache.footnotes.length, 1);
  assert.equal(cache.footnotes[0].content, "Definition [[Target]]\ncontinuation #tag");
  assert.equal(cache.footnotes[0].position.start.line, 2);
  assert.equal(cache.footnotes[0].position.end.line, 3);
  assert.equal(cache.links[0].link, "Target");
  assert.deepEqual(allTags(cache), ["#tag"]);
  assert.equal(content.slice(cache.footnoteRefs[1].position.start.offset, cache.footnoteRefs[1].position.end.offset), "[^alpha]");
});

test("Markdown reference links share the actual definition destination range", () => {
  const content = "[One][ref] and [Two][ref].\n\n[ref]: <Folder/Target%20note.md#Heading> \"Title\"\n";
  const cache = parseMarkdown(content);
  assert.equal(cache.links.length, 2);
  assert.deepEqual(cache.links.map(entry => entry.link), ["Folder/Target%20note.md#Heading", "Folder/Target%20note.md#Heading"]);
  assert.deepEqual(cache.links[0].targetPosition, cache.links[1].targetPosition);
  const { start, end } = cache.links[0].targetPosition;
  assert.equal(content.slice(start.offset, end.offset), "Folder/Target%20note.md#Heading");
});

test("YAML edits preserve comments, unknown structured properties, CRLF and the exact Markdown body", () => {
  const body = "\r\n# Body\r\n[[Target]]\r\n";
  const content = "---\r\n# keep me\r\ntitle: Old\r\nunknown: { nested: [one, two] }\r\ntags:\r\n  - project/nested\r\n---\r\n" + body;
  assert.equal(updateFrontmatter(content, () => {}), content);
  const updated = updateFrontmatter(content, properties => { properties.title = "New"; properties.complete = true; });
  assert.ok(updated.includes("# keep me\r\n"));
  assert.ok(!/(?<!\r)\n/.test(updated));
  assert.equal(updated.slice(updated.indexOf("---\r\n", 4) + 5), body);
  const cache = parseMarkdown(updated);
  assert.equal(cache.frontmatter.title, "New");
  assert.equal(cache.frontmatter.complete, true);
  assert.deepEqual(cache.frontmatter.unknown, { nested: ["one", "two"] });
  assert.deepEqual(cache.frontmatter.tags, ["project/nested"]);
  const removed = updateFrontmatter(updated, properties => { delete properties.title; });
  assert.ok(!Object.hasOwn(parseMarkdown(removed).frontmatter, "title"));
  assert.ok(removed.endsWith(body));
});

test("invalid or duplicate YAML is reported and never overwritten by a property edit", () => {
  for (const content of ["---\nkey: [broken\n---\n# Body\n", "---\nkey: one\nkey: two\n---\n# Body\n", "---\nkey: value\n"]) {
    assert.ok(parseMarkdown(content).errors.length > 0);
    assert.throws(() => updateFrontmatter(content, properties => { properties.title = "No write"; }));
  }
  const created = updateFrontmatter("# Body\n", properties => { properties.tags = ["created"]; });
  assert.equal(parseMarkdown(created).frontmatter.tags[0], "created");
  assert.ok(created.endsWith("# Body\n"));
});

test("YAML aliases cannot make link extraction or unchanged property editing recurse forever", () => {
  const content = "---\nrelated: &related\n  note: '[[Target]]'\n  self: *related\ncopy: *related\n---\nBody\n";
  const cache = parseMarkdown(content);
  assert.deepEqual(cache.errors, []);
  assert.equal(cache.frontmatterLinks.length, 1);
  assert.equal(cache.frontmatterLinks[0].link, "Target");
  assert.equal(updateFrontmatter(content, () => {}), content);
  const updated = updateFrontmatter(content, properties => { properties.title = "Safe"; });
  assert.equal(parseMarkdown(updated).frontmatter.title, "Safe");
});

test("property renaming retains original numeric literals, YAML anchors/comments and exact CRLF body while rejecting collisions", () => {
  const body = "\r\n# Untouched body\r\n\r\n[[Target]] \u03bb\r\n";
  const original = "---\r\n# keep heading\r\namount: 9007199254740993 # keep inline\r\nfraction: 0.1234567890123456789\r\nshared: &original {keep: true}\r\ncopy: *original\r\n---\r\n" + body;
  const updated = renameFrontmatterProperty(original, "AMOUNT", "renamed");
  assert.match(updated, /renamed: 9007199254740993 # keep inline/);
  assert.match(updated, /fraction: 0\.1234567890123456789/);
  assert.match(updated, /shared: &original/);
  assert.match(updated, /copy: \*original/);
  assert.ok(updated.includes("# keep heading\r\n"));
  assert.ok(updated.endsWith(body));
  assert.ok(!/(?<!\r)\n/.test(updated));
  assert.equal(renameFrontmatterProperty(original, "missing", "other"), original);
  assert.throws(() => renameFrontmatterProperty(original, "amount", "fraction"), /already exists/);
  assert.throws(() => renameFrontmatterProperty("---\nstatus: one\nSTATUS: two\n---\nBody\n", "status", "state"), /multiple case variants/);
});

test("editing an anchored scalar cannot silently change a different property", () => {
  const original = "---\nstatus: &status old\nmirror: *status\n---\nBody\n";
  assert.throws(() => updateFrontmatter(original, value => { value.status = "new"; }), /YAML aliases/);
  assert.equal(parseMarkdown(original).frontmatter.mirror, "old");
  assert.throws(() => renameFrontmatterProperty("---\n&name status: old\nmirror: *name\n---\nBody\n", "status", "state"), /YAML aliases/);
});

test("nested edits retain cyclic YAML aliases and exact numeric tokens instead of expanding a rounded copy", () => {
  const original = "---\r\nsettings: &settings\r\n  title: old\r\n  precise: 9007199254740993 # exact\r\n  self: *settings\r\nmirror: *settings\r\n---\r\nExact body\r\n";
  const updated = updateFrontmatter(original, properties => { properties.settings.title = "new"; });
  assert.match(updated, /title: new/);
  assert.match(updated, /precise: 9007199254740993 # exact/);
  assert.match(updated, /self: \*settings/);
  assert.match(updated, /mirror: \*settings/);
  assert.ok(updated.endsWith("---\r\nExact body\r\n"));
  const properties = parseMarkdown(updated).frontmatter;
  assert.equal(properties.settings, properties.mirror);
  assert.equal(properties.settings.self, properties.settings);
});

test("ordinary and nested property edits retain untouched exact numeric tokens, including moved sequence entries", () => {
  const original = "---\r\ntitle: Old\r\namount: 9007199254740993 # integer\r\nunknown:\r\n  fraction: 0.1234567890123456789 # fraction\r\n  enabled: false\r\nsequence: [remove, 9007199254740995, 0.1234567890123456789]\r\nchange: 1.2500\r\n---\r\n\r\n# Exact body\r\n";
  const updated = updateFrontmatter(original, properties => {
    properties.title = "New";
    properties.unknown.enabled = true;
    properties.sequence.shift();
    properties.change = 2.5;
  });
  assert.match(updated, /amount: 9007199254740993 # integer/);
  assert.match(updated, /fraction: 0\.1234567890123456789 # fraction/);
  assert.match(updated, /sequence: \[ 9007199254740995, 0\.1234567890123456789 \]/);
  assert.equal(parseMarkdown(updated).frontmatter.unknown.enabled, true);
  assert.equal(parseMarkdown(updated).frontmatter.change, 2.5);
  assert.ok(updated.endsWith("---\r\n\r\n# Exact body\r\n"));
});

test("link resolution handles relative paths, encoded Markdown links, same-note anchors and ambiguous basenames", () => {
  const files = ["Root.md", "Folder/Source.md", "Folder/Target.md", "Other/Target.md", "Folder/space note.md", "image.png", "One/Duplicate.md", "Two/Duplicate.md"].map(path => ({ path }));
  const resolve = createLinkResolver(files);
  assert.equal(resolve("Target", "Folder/Source.md").file.path, "Folder/Target.md");
  assert.equal(resolve("../Root#Heading", "Folder/Source.md").file.path, "Root.md");
  assert.equal(resolve("#Heading", "Folder/Source.md").file.path, "Folder/Source.md");
  assert.equal(resolve("space%20note.md#Heading", "Folder/Source.md", true).file.path, "Folder/space note.md");
  assert.equal(resolve("/image.png", "Folder/Source.md").file.path, "image.png");
  assert.equal(resolve("Duplicate", "Root.md").ambiguous, true);
  assert.deepEqual(resolve("Duplicate", "Root.md").candidates.map(file => file.path), ["One/Duplicate.md", "Two/Duplicate.md"]);
  assert.equal(resolve("../../outside", "Folder/Source.md"), null);
  assert.equal(resolve("https://example.invalid", "Root.md"), null);
  assert.equal(resolve("Missing", "Root.md"), null);
  assert.throws(() => resolve("bad%XX.md", "Root.md", true), URIError);
  assert.deepEqual(parseLinktext("Target.md#^block", true), { path: "Target.md", subpath: "#^block" });
  assert.equal(relativeVaultPath("Folder/Source.md", "Other/Target.md"), "../Other/Target.md");
  const cache = parseMarkdown("[Target](space%20note.md#Heading)");
  assert.equal(linkDestination(files, cache.links[0], "Folder/Source.md").file.path, "Folder/space note.md");
});

test("file rename reference planning retains captions, headings, blocks, shared definitions, precise YAML and non-link text", () => {
  const files = ["Folder/Source.md", "Folder/Target.md", "Assets/image.png"].map(path => ({ path }));
  const original = [
    "---", 'related: "[[Target#^block|Property caption]]"', "amount: 9007199254740993 # exact", "---", "",
    "[[Target#Section|Wiki caption]] [Markdown caption](Target.md#Section \"Keep title\")",
    "[One][shared] and [Two][shared].", "", '[shared]: Target.md#Section "Reference title"', "",
    "![[Assets/image.png]] [[Missing]] `[[Target]]` Plain Target is unchanged.", "",
  ].join("\r\n");
  const updated = rewriteFileLinks(original, parseMarkdown(original), files, "Folder/Source.md", "Folder/Target.md", "Archive/New.md");
  assert.match(updated, /\[\[Archive\/New#Section\|Wiki caption\]\]/);
  assert.match(updated, /\[Markdown caption\]\(\.\.\/Archive\/New\.md#Section "Keep title"\)/);
  assert.match(updated, /\[shared\]: \.\.\/Archive\/New\.md#Section "Reference title"/);
  assert.equal(parseMarkdown(updated).frontmatter.related, "[[Archive/New#^block|Property caption]]");
  assert.match(updated, /amount: 9007199254740993 # exact/);
  assert.ok(updated.includes("![[Assets/image.png]] [[Missing]] `[[Target]]` Plain Target is unchanged."));
  assert.ok(!/(?<!\r)\n/.test(updated));
});

test("moving a note repairs its relative attachment/note links, keeps same-note anchors and rejects affected ambiguous links", () => {
  const files = ["Folder/Source.md", "Folder/Target.md", "Assets/space image.png"].map(path => ({ path }));
  const original = "[Target](Target.md#Heading) ![Image](../Assets/space%20image.png) [Self](#Heading)\n";
  const updated = rewriteFileLinks(original, parseMarkdown(original), files, "Folder/Source.md", "Folder/Source.md", "Archive/Deep/Moved.md");
  assert.equal(updated, "[Target](../../Folder/Target.md#Heading) ![Image](../../Assets/space%20image.png) [Self](#Heading)\n");
  const ambiguous = ["Source.md", "One/Duplicate.md", "Two/Duplicate.md"].map(path => ({ path }));
  assert.throws(() => rewriteFileLinks("[[Duplicate]]", parseMarkdown("[[Duplicate]]"), ambiguous, "Source.md", "One/Duplicate.md", "Renamed.md"), /ambiguous link/);
});

test("position conversion uses raw UTF-16 offsets without normalizing Windows newlines", () => {
  const content = "A\u{1f680}\r\nSecond\r\nLast";
  const position = sourcePositions(content);
  assert.deepEqual(position(content.indexOf("Second"), content.length), {
    start: { line: 1, ch: 0, offset: 5 }, end: { line: 2, ch: 4, offset: content.length },
  });
});

test("outgoing targets include property links and embeds in source order, deduplicate destinations and retain distinct subpaths", () => {
  const content = [
    "---", 'related: "[[Target#Heading]]"', "---",
    "[[Target#Heading|Alias]] [same](Target.md#Heading) [[Target#^block]]",
    "![[pixel.png]] [[Missing]] [[Missing#Heading]] [broken](bad%XX.md)",
    "[web](https://example.invalid/) `[[Ignored]]`",
  ].join("\n");
  const files = ["Source.md", "Target.md", "pixel.png"].map(path => ({ path }));
  const resolve = createLinkResolver(files);
  const links = outgoingLinks(parseMarkdown(content), (reference, source) => resolve(reference.link, source, reference.kind === "markdown" || reference.kind === "reference"), "Source.md");
  assert.deepEqual(links.map(link => [link.destination?.path ?? null, link.target?.path ?? null, link.target?.subpath ?? null, link.occurrences]), [
    ["Target.md", "Target", "#Heading", 3],
    ["Target.md", "Target", "#^block", 1],
    ["pixel.png", "pixel.png", "", 1],
    [null, "Missing", "", 1],
    [null, "Missing", "#Heading", 1],
    [null, null, null, 1],
  ]);
  assert.match(links.at(-1).error, /Invalid URL encoding/);
  assert.equal(links[0].reference.kind, "frontmatter");
  const mixed = outgoingLinks(parseMarkdown("[[bad%XX.md]] [invalid](bad%XX.md)"), (reference, source) => resolve(reference.link, source, reference.kind === "markdown"), "Source.md");
  assert.equal(mixed.length, 2, "A malformed URI must not disable a separate valid wiki target with the same literal name.");
  assert.equal(mixed[0].error, null);
  assert.match(mixed[1].error, /Invalid URL encoding/);
});

test("unlinked outgoing mentions match note names and aliases without treating code, links, frontmatter or word fragments as mentions", () => {
  const text = [
    "---", "title: Target", "---",
    "Target and Alias. Targeted should not match. \u4e2d\u6587.",
    "[[Target]] [Alias](Target.md) `Target Alias`",
    "```", "Target Alias", "```", "<!-- Target -->", "\\Alias",
  ].join("\n");
  const files = [
    { path: "Source.md", basename: "Source", cache: null },
    { path: "Target.md", basename: "Target", cache: parseMarkdown("---\naliases: [Alias, Target]\n---\n") },
    { path: "Unicode.md", basename: "\u4e2d\u6587", cache: null },
  ];
  const mentions = outgoingMentions(text, parseMarkdown(text), "Source.md", files);
  assert.deepEqual(mentions.map(mention => [mention.path, mention.matches.map(match => text.slice(match.from, match.to))]), [
    ["Target.md", ["Target", "Alias"]], ["Unicode.md", ["\u4e2d\u6587"]],
  ]);
});

test("missing linked-note paths stay inside the vault and cannot overwrite an attachment or create a hidden/reserved file", () => {
  for (const [link, path] of [
    ["New note#Heading", "New note.md"], ["Folder/New.md", "Folder/New.md"],
    ["./New", "Folder/New.md"], ["../New", "New.md"], ["/Root note", "Root note.md"],
    ["space%20note.md", "space note.md"],
  ]) {
    assert.equal(newLinkedNotePath(parseLinktext(link, link.includes("%")), "Folder/Source.md"), path);
  }
  for (const link of ["../../outside", ".obsidian/private", ".hidden", "CON", "Folder/NUL.md", "Bad?.md", "image.png", "#Heading", "https://example.invalid"]) {
    assert.throws(() => newLinkedNotePath(parseLinktext(link), "Folder/Source.md"), /cannot|valid|attachments/i, link);
  }
});
