import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

const { webUrl, viewBounds } = createRequire(import.meta.url)("../desktop/web-viewer-policy.cjs");
const endpoint = "http://127.0.0.1:56789";
let temporary;
let webAddress;
let webViewerIpc;
let WebViewerView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "webviewer-tests-"));
  const entry = join(temporary, "web-address.mjs");
  await build({ stdin: { contents: 'export { webAddress } from "./client/web-address"; export { webViewerIpc } from "./client/webviewer-bridge"; export { WebViewerView } from "./client/web-viewer";', resolveDir: root }, outfile: entry, bundle: true, platform: "browser", external: ["electron"], format: "esm", logLevel: "silent" });
  ({ webAddress, webViewerIpc, WebViewerView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

test("a bundled require shim does not advertise a native Web viewer in an ordinary browser", () => {
  assert.equal(webViewerIpc(), null);
});

test("same-URL native status/title updates retain a blurred address draft while actual URL changes still follow navigation", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), address = { value: "https://example.com/typed" }, document = { activeElement: {} };
  const view = Object.create(WebViewerView.prototype), previous = "https://example.com/old";
  Object.defineProperty(view, "contentEl", { value: { dataset: {} } });
  Object.assign(view, { address, url: previous, title: "Old title", navigationId: 1, message: {}, status: {}, back: {}, forward: {}, reload: {}, external: {},
    app: { workspace: { layoutChanged() {} } }, leaf: { updateHeader() {} } });
  for (const method of ["acceptZoom", "acceptAdBlocking", "updateReaderButton", "maybeReader", "scheduleBounds"]) { view[method] = () => {}; }
  const state = { url: previous, title: "New title", loading: false, navigationId: 1, error: "", canGoBack: true, canGoForward: false };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  try {
    view.update(state); assert.equal(address.value, "https://example.com/typed"); assert.equal(view.title, "New title"); assert.equal(view.back.disabled, false);
    view.update({ ...state, url: "https://example.com/new" }); assert.equal(address.value, "https://example.com/new");
    document.activeElement = address; address.value = "Next user draft";
    view.update({ ...state, url: "https://example.com/redirect" }); assert.equal(address.value, "Next user draft");
  } finally { if (original) { Object.defineProperty(globalThis, "document", original); } else { delete globalThis.document; } }
});

test("web navigation rejects local vault endpoints, credential URLs and privileged schemes", () => {
  assert.equal(webUrl("https://example.com/one#heading", endpoint), "https://example.com/one#heading");
  assert.equal(webUrl("about:blank", endpoint), "about:blank");
  assert.equal(webUrl("http://127.0.0.1:56790/fixture", endpoint), "http://127.0.0.1:56790/fixture");
  for (const url of [endpoint, "http://localhost:56789/api/vault", "http://127.0.0.2:56789", "http://[::1]:56789", "ws://localhost:56789/hub", "file:///C:/vault/secret.md", "javascript:alert(1)", "data:text/html,example", "obsidian://open?vault=x", "https://name:password@example.com", "https://example.com/\nwrong", "about:blank#extra"]) {
    assert.throws(() => webUrl(url, endpoint), undefined, url);
  }
  assert.throws(() => webUrl("about:blank", endpoint, { blank: false }));
  assert.equal(webUrl("wss://example.com/socket", endpoint, { sockets: true }), "wss://example.com/socket");
  assert.equal(webUrl("data:image/png;base64,AAAA", endpoint, { resources: true }), "data:image/png;base64,AAAA");
});

test("native surface bounds clip to the application viewport and reject invalid geometry", () => {
  assert.deepEqual(viewBounds({ visible: true, x: -10, y: 40, width: 1000, height: 900 }, [800, 600]), { x: 0, y: 40, width: 800, height: 560 });
  assert.deepEqual(viewBounds({ visible: true, x: 10, y: 20, width: 100, height: 50 }, [800, 600], 1.5), { x: 15, y: 30, width: 150, height: 75 });
  assert.equal(viewBounds({ visible: false }, [800, 600]), null);
  assert.equal(viewBounds({ visible: true, x: 900, y: 0, width: 100, height: 100 }, [800, 600]), null);
  for (const bounds of [null, {}, { visible: true, x: NaN, y: 0, width: 1, height: 1 }, { visible: true, x: 0, y: 0, width: -1, height: 5 }]) {
    assert.throws(() => viewBounds(bounds, [800, 600]));
  }
});

test("address input expands domains and encoded searches while refusing unsafe schemes", () => {
  assert.equal(webAddress(""), "about:blank");
  assert.equal(webAddress(" example.com/path "), "https://example.com/path");
  assert.equal(webAddress("http://localhost:8000/test"), "http://localhost:8000/test");
  assert.equal(webAddress("notes & more"), "https://duckduckgo.com/?q=notes%20%26%20more");
  assert.equal(webAddress("note taking", { searchEngine: "google" }), "https://www.google.com/search?q=note%20taking");
  assert.equal(webAddress("one & two", { searchEngine: "custom", customSearchEngine: "https://example.com/search?q=%s" }), "https://example.com/search?q=one%20%26%20two");
  for (const value of ["javascript:alert(1)", "file:///C:/private", "data:text/html,example", "https://user:password@example.com"]) { assert.throws(() => webAddress(value)); }
  assert.throws(() => webAddress("query", { searchEngine: "custom", customSearchEngine: "javascript:%s" }));
  assert.throws(() => webAddress("query", { searchEngine: "custom", customSearchEngine: "https://example.com/" }));
});

test("desktop Web viewer settings and enablement preserve unknown data through a host restart", async t => {
  const directory = await mkdtemp(join(temporary, "vault-"));
  await mkdir(join(directory, ".obsidian"));
  const settingsPath = join(directory, ".obsidian", "webviewer.json");
  const existing = { openExternalURLs: false, homepage: "https://example.com", searchEngine: "bing", enableAdblocking: true, future: { retained: [1, true] } };
  await writeFile(settingsPath, JSON.stringify(existing));
  await writeFile(join(directory, ".obsidian", "core-plugins.json"), '{"webviewer":false,"future":{"keep":true}}');
  let host = await startHost(directory);
  t.after(async () => host.stop());
  const state = async () => (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal((await state()).implemented, true);
  assert.equal((await state()).fields.find(field => field.key === "enableAdblocking").type, "checkbox");
  assert.equal((await state()).enabled, false);
  assert.equal((await host.request("/api/core/webviewer", "PUT", { root: directory, enabled: true })).status, 200);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { homepage: "http://localhost:8000/fixture", searchEngine: "custom", customSearchEngine: "https://example.com/?q=%s", markdownPath: "Web clips/Nested" } })).status, 200);
  const saved = await readFile(settingsPath, "utf8");
  assert.deepEqual(JSON.parse(saved), { ...existing, homepage: "http://localhost:8000/fixture", searchEngine: "custom", customSearchEngine: "https://example.com/?q=%s", markdownPath: "Web clips/Nested" });
  for (const values of [{ enableAdblocking: "true" }, { enableAdblocking: null }, { enableAdblocking: 1 }, { openExternalURLs: "true" }, { searchEngine: "unavailable" }, { customSearchEngine: "javascript:%s" }, { customSearchEngine: "https://example.com/no-placeholder" }, { markdownPath: "../Outside" }, { markdownPath: "D:/Outside" }, { markdownPath: ".obsidian" }, { markdownPath: "CON" }]) {
    assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values })).status, 400);
    assert.equal(await readFile(settingsPath, "utf8"), saved);
  }
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { enableAdblocking: false } })).status, 200);
  await host.stop(); host = await startHost(directory);
  assert.equal((await state()).enabled, true);
  assert.equal((await state()).settings.homepage, "http://localhost:8000/fixture");
  assert.equal((await state()).settings.markdownPath, "Web clips/Nested");
  assert.equal((await state()).settings.enableAdblocking, false);
  assert.deepEqual((await state()).settings.future, existing.future);
  assert.deepEqual(JSON.parse(await readFile(join(directory, ".obsidian", "core-plugins.json"), "utf8")), { webviewer: true, future: { keep: true } });
});

test("Web viewer ad blocking defaults on without rewriting absent vault settings", async t => {
  const directory = await mkdtemp(join(temporary, "default-adblock-"));
  await mkdir(join(directory, ".obsidian"));
  const host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(state.settings.enableAdblocking, true);
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});
