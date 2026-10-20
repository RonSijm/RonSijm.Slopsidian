import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root } from "./host.mjs";

const { readWebArticle } = createRequire(import.meta.url)("../desktop/web-reader.cjs");
let temporary, readerLink, readerArticle, readerDocument;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-reader-tests-"));
  const entry = join(temporary, "reader.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-reader-policy"; export { readerDocument } from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerLink, readerArticle, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });
const source = "https://example.com/story";
const article = (extra = {}) => ({ url: source, title: "A story", byline: "An author", content: "<p>Article text.</p>", textLength: 500, lang: "en", dir: "ltr", ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const options = { loadScript: async () => "var SlopsidianWebReader={};" };
function fixture() {
  const calls = [];
  let current = true, url = source, destroyed = false, loading = false;
  const contents = { getURL: () => url, isDestroyed: () => destroyed, isLoadingMainFrame: () => loading,
    async executeJavaScriptInIsolatedWorld(...args) { calls.push(args); return article(); } };
  const viewer = { view: { webContents: contents }, committed: true, navigationId: 1, readerPending: false };
  return { viewer, contents, calls, current: () => current, close() { current = false; destroyed = true; }, url(value) { url = value; }, loading(value) { loading = value; } };
}
const endpoint = "http://127.0.0.1:54321";

test("reader links resolve relative articles while rejecting credentials, controls and active schemes", () => {
  assert.equal(readerLink("../next?q=one%20two#part", source), "https://example.com/next?q=one%20two#part");
  assert.equal(readerLink("#part", source), source + "#part");
  for (const value of ["javascript:alert(1)", "file:///secret", "data:text/html,unsafe", "https://user:pass@example.com", "https://example.com/\nwrong", "x".repeat(8193)]) { assert.equal(readerLink(value, source), null); }
});

test("reader payload boundaries retain metadata and reject mismatched, oversized or invalid articles", () => {
  const value = article({ title: "中文 😀 <title>", future: [1, true] });
  assert.equal(readerArticle(value, source), value);
  for (const extra of [{ url: source + "/other" }, { title: "x".repeat(1025) }, { content: "x".repeat(1_000_001) }, { textLength: 199 }, { textLength: NaN }, { lang: '"><script>' }, { dir: "wrong" }]) { assert.throws(() => readerArticle(article(extra), source)); }
});

test("reader document escapes metadata and restricts scripts, network, forms and base URLs with a unique nonce", () => {
  const token = "a".repeat(36), html = readerDocument(article({ title: '<img src=x onerror="alert(1)">', byline: '<script>alert(1)</script>' }), token, endpoint, false);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  for (const policy of ["default-src 'none'", "img-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "script-src 'nonce-" + token + "'"]) { assert.ok(html.includes(policy), policy); }
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.throws(() => readerDocument(article(), "bad nonce", endpoint, false));
});

test("native reader executes a local extraction bundle in an isolated website world and binds the result to its navigation", async () => {
  const f = fixture(), result = await readWebArticle(f.viewer, endpoint, f.current, options);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 1009);
  assert.ok(f.calls[0][1][0].code.includes('SlopsidianWebReader.extractReaderArticle("https://example.com/story")'));
  assert.ok(f.calls[0][1][0].code.includes("readerError"));
  assert.equal(result.navigationId, 1); assert.equal(result.url, source); assert.equal(f.viewer.readerPending, false);
});

test("native reader refuses blank/local, failed and loading pages before executing extraction", async () => {
  for (const change of [f => f.url("about:blank"), f => f.url(endpoint + "/api/vault"), f => { f.viewer.committed = false; }, f => f.loading(true)]) {
    const f = fixture(); change(f); await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, options)); assert.equal(f.calls.length, 0);
  }
});

test("reader checks navigation again after loading its extraction script", async () => {
  const f = fixture(), script = deferred();
  const pending = readWebArticle(f.viewer, endpoint, f.current, { loadScript: () => script.promise });
  f.viewer.navigationId++; script.resolve("bundle");
  await assert.rejects(pending, /page changed/); assert.equal(f.calls.length, 0); assert.equal(f.viewer.readerPending, false);
});

test("reader rejects a late extraction after same-URL reload, another URL or closing the pane", async () => {
  for (const change of [f => { f.viewer.navigationId++; }, f => f.url(source + "?new"), f => f.close()]) {
    const f = fixture(), extraction = deferred(); f.contents.executeJavaScriptInIsolatedWorld = () => extraction.promise;
    const pending = readWebArticle(f.viewer, endpoint, f.current, options); await Promise.resolve();
    change(f); extraction.resolve(article()); await assert.rejects(pending, /page changed/); assert.equal(f.viewer.readerPending, false);
  }
});

test("reader prevents overlapping extraction and recovers after a timeout without accepting late output", async () => {
  const f = fixture(), extraction = deferred(); f.contents.executeJavaScriptInIsolatedWorld = () => extraction.promise;
  const pending = readWebArticle(f.viewer, endpoint, f.current, { ...options, timeout: 10 });
  await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, options), /still running/);
  await assert.rejects(pending, /timed out/); assert.equal(f.viewer.readerPending, false);
  extraction.resolve(article());
  f.contents.executeJavaScriptInIsolatedWorld = async () => article();
  assert.equal((await readWebArticle(f.viewer, endpoint, f.current, options)).url, source);
});

test("native reader validates extraction output and releases its pending guard on every failure", async () => {
  for (const value of [null, article({ url: "file:///secret" }), article({ content: "x".repeat(1_000_001) }), article({ byline: {} }), article({ textLength: -1 })]) {
    const f = fixture(); f.contents.executeJavaScriptInIsolatedWorld = async () => value;
    await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, options), /valid readable article/); assert.equal(f.viewer.readerPending, false);
  }
});

test("native reader preserves a bounded explanation returned by an unsuccessful isolated-world extraction", async () => {
  const f = fixture(); f.contents.executeJavaScriptInIsolatedWorld = async () => ({ readerError: "No readable article was found on this page." });
  await assert.rejects(readWebArticle(f.viewer, endpoint, f.current, options), /No readable article/);
  assert.equal(f.viewer.readerPending, false);
});
