import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root } from "./host.mjs";

const require = createRequire(import.meta.url);
const { webZoomFactor, nextWebZoom, webZoomShortcut } = require("../shared/web-zoom.cjs");
const { setWebZoom, requestWebZoom } = require("../desktop/web-zoom.cjs");
let temporary, readerDocument;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-zoom-tests-"));
  const entry = join(temporary, "reader.mjs");
  await build({ stdin: { contents: 'export { readerDocument } from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

test("zoom accepts only finite numeric factors between 50% and 300% without coercing persisted data or IPC", () => {
  for (const value of [0.5, 0.75, 1, 1.25, 2, 3]) { assert.equal(webZoomFactor(value), value); }
  for (const value of [undefined, null, "1.5", true, {}, [], NaN, Infinity, -Infinity, 0, 0.49, 3.01]) { assert.throws(() => webZoomFactor(value)); }
});
test("repeated ten-percent steps stay bounded without floating point overshoot and reset restores 100%", () => {
  let factor = 1;
  for (let index = 0; index < 20; index++) { factor = nextWebZoom(factor, "in"); }
  assert.equal(factor, 3); assert.equal(nextWebZoom(factor, "in"), 3);
  for (let index = 0; index < 25; index++) { factor = nextWebZoom(factor, "out"); }
  assert.equal(factor, 0.5); assert.equal(nextWebZoom(factor, "out"), 0.5);
  assert.equal(nextWebZoom(1.25, "in"), 1.35); assert.equal(nextWebZoom(1.25, "out"), 1.15);
  for (const factor of [0.5, 1.25, 3]) { assert.equal(nextWebZoom(factor, "reset"), 1); }
  for (const action of [undefined, "set", "IN", 1, null]) { assert.throws(() => nextWebZoom(1, action)); }
});
test("zoom key matching handles plus/equal/minus/reset without claiming unrelated keys", () => {
  assert.equal(webZoomShortcut("+"), "in"); assert.equal(webZoomShortcut("="), "in");
  assert.equal(webZoomShortcut("-"), "out"); assert.equal(webZoomShortcut("0"), "reset");
  for (const key of ["f", "1", "_", "Enter", ""]) { assert.equal(webZoomShortcut(key), null); }
});
function nativeFixture() {
  const calls = []; let destroyed = false, failure = null;
  const viewer = { zoomFactor: 1, zoomRevision: 0, view: { webContents: {
    isDestroyed: () => destroyed,
    setZoomFactor(value) { if (failure) { throw failure; } calls.push(value); },
  } } };
  return { viewer, calls, close: () => { destroyed = true; }, fail: () => { failure = new Error("Native zoom failed"); } };
}
test("native zoom validates before touching contents and never acknowledges a failed or closed surface", () => {
  for (const invalid of [0.4, 3.1, "1.5", null, NaN]) {
    const f = nativeFixture(); assert.throws(() => setWebZoom(f.viewer, invalid)); assert.deepEqual(f.calls, []);
    assert.equal(f.viewer.zoomFactor, 1); assert.equal(f.viewer.zoomRevision, 0);
  }
  for (const change of [f => f.close(), f => f.fail()]) {
    const f = nativeFixture(); change(f); assert.throws(() => setWebZoom(f.viewer, 1.5));
    assert.equal(f.viewer.zoomFactor, 1); assert.equal(f.viewer.zoomRevision, 0);
  }
});
test("native request sequencing resolves rapid changes from the latest factor and keeps same-factor navigation reapplication stable", () => {
  const f = nativeFixture();
  assert.deepEqual(requestWebZoom(f.viewer, { change: "in" }), { zoomFactor: 1.1, zoomRevision: 1 });
  assert.deepEqual(requestWebZoom(f.viewer, { change: "in" }), { zoomFactor: 1.2, zoomRevision: 2 });
  assert.deepEqual(setWebZoom(f.viewer, 1.2), { zoomFactor: 1.2, zoomRevision: 2 });
  assert.deepEqual(requestWebZoom(f.viewer, { factor: 1.25 }), { zoomFactor: 1.25, zoomRevision: 3 });
  assert.deepEqual(requestWebZoom(f.viewer, { change: "reset" }), { zoomFactor: 1, zoomRevision: 4 });
  assert.deepEqual(f.calls, [1.1, 1.2, 1.2, 1.25, 1]);
  for (const value of [null, {}, { factor: 1, change: "in" }, { change: "unavailable" }, { factor: undefined }]) { assert.throws(() => requestWebZoom(f.viewer, value)); }
  assert.equal(f.viewer.zoomFactor, 1); assert.equal(f.viewer.zoomRevision, 4);
});
test("Reader accepts only bounded initial zoom, escapes metadata and retains opaque-frame script/network restrictions", () => {
  const article = { url: "https://example.com/story", title: '<script>unsafe()</script>', byline: "Author", content: "<p>Article</p>", textLength: 500, lang: "en", dir: "ltr" };
  const token = "a".repeat(36);
  const html = readerDocument(article, token, "http://127.0.0.1:59001", false, 1.5);
  assert.ok(html.includes(":root{zoom:1.5;")); assert.ok(html.includes("&lt;script&gt;unsafe()&lt;/script&gt;"));
  for (const policy of ["default-src 'none'", "img-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"]) { assert.ok(html.includes(policy)); }
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  for (const value of [null, "1.5", 0, 0.49, 3.01, NaN]) { assert.throws(() => readerDocument(article, token, "http://127.0.0.1:59001", false, value)); }
});
