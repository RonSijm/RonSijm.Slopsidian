import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
const { readWebArticle } = createRequire(import.meta.url)("../desktop/web-reader.cjs");
const url = "https://example.com/page", endpoint = "http://127.0.0.1:59123";
let temporary, pageStyleHidden, WebViewerView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-page-clip-tests-"));
  const entry = join(temporary, "page.mjs");
  await build({ stdin: { contents: 'export { pageStyleHidden } from "./client/web-page-clip"; export { WebViewerView } from "./client/web-viewer";', resolveDir: root },
    outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "page-clip-modal-fixture", setup(build) {
      build.onResolve({ filter: /^\.\/web-clip-modal$/ }, () => ({ path: "modal", namespace: "fixture" }));
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "ui" ? "export class Notice {} export class Modal {}"
        : "export class WebClipModal { constructor(app,actions){this.actions=actions;this.modalEl={focus(){}}} open(){this.isOpen=true} }" }));
    } }] });
  ({ pageStyleHidden, WebViewerView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function nativeFixture() {
  let output = { url, title: "Short page", textLength: 1, markdown: "# Short page\n\nX\n" }, code = "", dead = false, current = true, loading = false;
  const viewer = { navigationId: 1, committed: true, readerPending: false, view: { webContents: {
    getURL: () => url, isDestroyed: () => dead, isLoadingMainFrame: () => loading,
    async executeJavaScriptInIsolatedWorld(world, scripts) { assert.equal(world, 1009); code = scripts[0].code; return await output; },
  } } };
  return { viewer, options: { format: "page", loadScript: async () => "local extraction bundle;" }, current: () => current,
    output(value) { output = value; }, code: () => code, close() { dead = true; }, replace() { current = false; }, loading() { loading = true; } };
}
test("Main-document visibility skips explicit hidden/collapsed/transparent/content-hidden elements while retaining offscreen auto and display-contents content", () => {
  const visible = { display: "block", visibility: "visible", opacity: "1", contentVisibility: "visible" };
  assert.equal(pageStyleHidden(visible), false);
  for (const value of [{ display: "none" }, { visibility: "hidden" }, { visibility: "collapse" }, { opacity: "0" }, { contentVisibility: "hidden" }]) {
    assert.equal(pageStyleHidden({ ...visible, ...value }), true);
  }
  assert.equal(pageStyleHidden({ ...visible, display: "contents", contentVisibility: "auto" }), false);
});
test("Native page clipping selects the isolated full-page extractor and permits short non-article documents without Reader HTML or byline", async () => {
  const f = nativeFixture(), result = await readWebArticle(f.viewer, endpoint, f.current, f.options);
  assert.deepEqual(result, { url, title: "Short page", markdown: "# Short page\n\nX\n", navigationId: 1 });
  assert.match(f.code(), /SlopsidianWebReader\.extractWebPage\(/); assert.doesNotMatch(f.code(), /\.extractReaderArticle\(/);
  assert.equal(f.viewer.readerPending, false);
});
test("Native full-page DTO validation rejects stale sources, malformed text counts and unsafe/empty/oversized Markdown before it can enter a preview", async () => {
  const valid = { url, title: "Page", textLength: 1, markdown: "# Page\n\nX\n" };
  for (const value of [null, ...[{ url: url + "?other" }, { title: "x".repeat(1025) }, { textLength: 0 }, { textLength: 2_000_001 },
    { textLength: "1" }, { markdown: " " }, { markdown: "bad\0text" }, { markdown: "x".repeat(2_000_001) }].map(extra => ({ ...valid, ...extra }))]) {
    const f = nativeFixture(); f.output(value); await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, f.options), /valid full-page/); assert.equal(f.viewer.readerPending, false);
  }
});
test("Full-page native capture refuses loading/uncommitted/closed/replaced owners and a navigation changed while its bundle is loading", async () => {
  for (const alter of [f => f.close(), f => f.replace(), f => f.loading(), f => { f.viewer.committed = false; }]) {
    const f = nativeFixture(); alter(f); await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, f.options), /changed|loading/); assert.equal(f.code(), "");
  }
  const f = nativeFixture(), script = deferred(); f.options.loadScript = () => script.promise;
  const pending = readWebArticle(f.viewer, endpoint, f.current, f.options); f.viewer.navigationId++; script.resolve("local bundle");
  await assert.rejects(pending, /changed/); assert.equal(f.code(), ""); assert.equal(f.viewer.readerPending, false);
});
test("A late native page result cannot outlive navigation and structured extraction errors preserve the original explanation", async () => {
  const f = nativeFixture(), output = deferred(); f.output(output.promise);
  const pending = readWebArticle(f.viewer, endpoint, f.current, f.options); await Promise.resolve(); await Promise.resolve(); f.viewer.navigationId++;
  output.resolve({ url, title: "Page", textLength: 1, markdown: "X" }); await assert.rejects(pending, /changed/);
  const error = nativeFixture(); error.output({ readerError: "No supported visible page content was found." });
  await assert.rejects(readWebArticle(error.viewer, endpoint, error.current, error.options), /No supported visible page content/);
});
test("Concurrent or timed-out main-document extraction stays bounded and frees the owner for a fresh attempt", async () => {
  const f = nativeFixture(); f.viewer.readerPending = true; await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, f.options), /still running/);
  f.viewer.readerPending = false; f.output(new Promise(() => {}));
  await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, { ...f.options, timeout: 10 }), /timed out/); assert.equal(f.viewer.readerPending, false);
  f.output({ url, title: "Fresh", textLength: 1, markdown: "X" }); assert.equal((await readWebArticle(f.viewer, endpoint, f.current, f.options)).title, "Fresh");
});
function viewFixture() {
  const view = Object.create(WebViewerView.prototype), calls = [], app = { vault: { rootPath: "vault-a" }, changingVault: false, core: { isEnabled: () => true } };
  Object.defineProperty(view, "_loaded", { value: true, configurable: true });
  Object.assign(view, { app, provider: { id: "webviewer", options: { markdownPath: "Clips", clipIncludeProperties: true, clipDefaultTags: "page" } },
    created: true, disposed: false, url, navigationId: 1, loading: false, readerBusy: false, readerWanted: false,
    message: { textContent: "" }, reader: null, scheduleBounds() {}, request: async (action, values) => {
      calls.push({ action, values }); return { url, title: "Page", markdown: "# Page\n\nX\n", navigationId: 1 };
    } });
  view.leaf = { view }; return { view, app, calls };
}
test("Save page uses its own preview kind and original-page native action even when Reader is displayed, with the existing defaults/folder/final-source check", async () => {
  const f = viewFixture(); f.view.reader = { documentRevision: 1, captureSelection() { throw new Error("Reader selection must not be read"); } }; f.view.readerWanted = true;
  f.view.saveAsMarkdown(false, true); const actions = f.view.clip.actions;
  assert.equal(actions.fullPage, true); assert.equal(actions.selection, false); assert.equal(actions.readerSelection, false);
  assert.equal(actions.defaults().clipIncludeProperties, true); assert.equal(actions.folder(), "Clips");
  assert.equal((await actions.extract()).markdown, "# Page\n\nX\n"); assert.equal(f.calls[0].action, "clip-page");
  await actions.verify(); assert.deepEqual(f.calls[1], { action: "check-article", values: { url, navigationId: 1 } });
});
test("Full-page previews reject changed URL/navigation/root/provider/closed/replaced/unloaded owners before native extraction or final writes", async () => {
  for (const alter of [f => { f.view.url += "?other"; }, f => { f.view.navigationId++; }, f => { f.app.vault.rootPath = "vault-b"; },
    f => { f.app.changingVault = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.view.disposed = true; },
    f => { f.view.leaf.view = {}; }, f => { Object.defineProperty(f.view, "_loaded", { value: false }); }]) {
    const f = viewFixture(); f.view.saveAsMarkdown(false, true); const actions = f.view.clip.actions; alter(f);
    assert.throws(actions.guard, /changed/); await assert.rejects(actions.extract(), /changed/); assert.equal(f.calls.length, 0);
  }
  for (const alter of [f => { f.view.loading = true; }, f => { f.view.readerBusy = true; }, f => { f.view.url = "about:blank"; }]) {
    const f = viewFixture(); alter(f); assert.equal(f.view.canSavePage(), false); f.view.saveAsMarkdown(false, true); assert.equal(f.view.clip, undefined);
  }
});
