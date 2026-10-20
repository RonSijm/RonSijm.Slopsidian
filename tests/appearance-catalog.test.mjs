import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let directory, catalog;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "appearance-catalog-tests-"));
  const outfile = join(directory, "catalog.mjs");
  await build({ entryPoints: [join(root, "client", "appearance-catalog.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  catalog = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/appearance-catalog-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

const encode = text => new TextEncoder().encode(text);
const response = (body, init = {}) => {
  const value = new Response(body, init);
  return value;
};

test("catalog parsing keeps only safe, unique, bounded entries and builds raw.githubusercontent.com URLs from validated repositories", () => {
  const parsed = catalog.parseThemeCatalog("\ufeff" + JSON.stringify([
    { name: "Zed", author: "A\nB", repo: "owner/zed", modes: ["dark", "x", "light"], screenshot: "z.png" },
    { name: "Alpha", author: "C", repo: "owner/alpha.theme", modes: ["dark"] },
    { name: "alpha", author: "dup", repo: "owner/dup" },
    { name: "../Escape", repo: "owner/escape" },
    { name: "Bad repo", repo: "owner/../x" },
    { name: "Evil", repo: "https://evil.example/x" },
    { name: "NoRepo" }, null, 7, [],
  ]));
  assert.deepEqual(parsed.entries.map(entry => entry.name), ["Alpha", "Zed"]);
  assert.equal(parsed.skipped, 8);
  assert.equal(parsed.entries[1].author, "A B");
  assert.deepEqual(parsed.entries[1].modes, ["dark", "light"]);
  assert.equal(catalog.themeFileUrl(parsed.entries[0], "theme.css"), "https://raw.githubusercontent.com/owner/alpha.theme/HEAD/theme.css");
  assert.throws(() => catalog.themeFileUrl({ repo: "a/b/../c" }, "theme.css"));
  assert.deepEqual(catalog.searchThemeCatalog(parsed, "zed").map(entry => entry.name), ["Zed"]);
  for (const bad of ["{}", "not json", JSON.stringify(Array(5001).fill({ name: "x", repo: "a/b" }))]) { assert.throws(() => catalog.parseThemeCatalog(bad), /theme catalog/); }
});

test("theme files are verified without rewriting bytes and classify self-contained, resource and unsafe CSS", async () => {
  const manifest = encode('{"name":"Fixture","version":"2.0.0"}');
  const review = await catalog.reviewThemeFiles(encode("body{color:red}"), manifest);
  assert.equal(review.selfContained, true); assert.equal(review.themeVersion, "2.0.0"); assert.equal(review.manifestName, "Fixture");
  assert.match(review.cssVersion, /^[0-9a-f]{64}$/);
  const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0]);
  const withFont = await catalog.reviewThemeFiles(encode("@font-face{src:url(fonts/a.woff2)}"), manifest, new Map([["fonts/a.woff2", font]]));
  assert.equal(withFont.needsLocalResources, true);
  assert.deepEqual(withFont.resources.map(resource => [resource.path, resource.version.length]), [["fonts/a.woff2", 64]]);
  const bad = [
    ["@import url(https://evil.example/a.css);", new Map()], ["a{background:url(https://evil.example/a.png)}", new Map()],
    ["@import 'x.css';", new Map()], ["a{background:image-set(url(a.png) 1x)}", new Map()],
    ["a{background:url(../x.png)}", new Map([["../x.png", font]])], ["a{background:url(data:image/png;base64,AAAA)}", new Map()],
    ["a{background:url(x.svg)}", new Map([["x.svg", font]])],
    ["a{background:url(x.png)}", new Map()],
    ["a{background:url(x.png)}", new Map([["x.png", font]])],
    ["a{background:url(x.png)}", new Map([["x.png", font], ["extra.png", font]])],
    ["a{background:url(x.png)}a{background:url(X.png)}", new Map([["x.png", font], ["X.png", font]])],
  ];
  for (const [css, files] of bad) { await assert.rejects(catalog.reviewThemeFiles(encode(css), manifest, files), undefined, css); }
  assert.deepEqual(catalog.themeResourceReferences("a{background:url(\"img/a.png\")}b{background:url(img/a.png)}"), ["img/a.png"]);
  assert.equal(catalog.themeFileUrl({ repo: "o/r" }, "fonts/a.woff2"), "https://raw.githubusercontent.com/o/r/HEAD/fonts/a.woff2");
  assert.throws(() => catalog.themeFileUrl({ repo: "o/r" }, "../a.png"));
  await assert.rejects(catalog.reviewThemeFiles(new Uint8Array([0xff, 0xfe]), manifest), /UTF-8/);
  await assert.rejects(catalog.reviewThemeFiles(encode("a{}"), encode("[]")), /JSON object/);
  await assert.rejects(catalog.reviewThemeFiles(new Uint8Array(0), manifest), /non-empty/);
  assert.equal(catalog.themeInstallState({ cssVersion: "a" }, null), "new");
  assert.equal(catalog.themeInstallState({ cssVersion: "a" }, "b"), "update");
  assert.equal(catalog.themeInstallState({ cssVersion: "a" }, "a"), "unchanged");
  const resourceful = { cssVersion: "a", resources: [{ path: "f.woff2", version: "r" }] };
  assert.equal(catalog.themeInstallState(resourceful, "a", new Map([["f.woff2", "r"]])), "unchanged");
  assert.equal(catalog.themeInstallState(resourceful, "a", new Map([["f.woff2", "other"]])), "update");
  assert.equal(catalog.themeInstallState(resourceful, "a", new Map([["f.woff2", null]])), "update");
  assert.equal(catalog.base64Bytes(new Uint8Array([0xef, 0xbb, 0xbf, 13, 10])), Buffer.from([0xef, 0xbb, 0xbf, 13, 10]).toString("base64"));
});

test("downloads are explicit CORS-only bounded requests that refuse foreign origins, opaque/redirected responses and oversize bodies", async () => {
  const calls = [];
  const good = async (url, init) => { calls.push([url, init]); return response("hello", { status: 200 }); };
  const bytes = await catalog.fetchBounded(good, "https://raw.githubusercontent.com/o/r/HEAD/theme.css", 100);
  assert.equal(new TextDecoder().decode(bytes), "hello");
  assert.deepEqual([calls[0][1].mode, calls[0][1].credentials, calls[0][1].redirect, calls[0][1].referrerPolicy, calls[0][1].cache], ["cors", "omit", "error", "no-referrer", "no-store"]);
  await assert.rejects(catalog.fetchBounded(good, "https://evil.example/theme.css", 100), /raw\.githubusercontent\.com/);
  assert.equal(calls.length, 1);
  await assert.rejects(catalog.fetchBounded(async () => response("x".repeat(101)), "https://raw.githubusercontent.com/o/r/HEAD/a", 100), /larger/);
  await assert.rejects(catalog.fetchBounded(async () => response("x", { headers: { "content-length": "5000" } }), "https://raw.githubusercontent.com/o/r/HEAD/a", 100), /larger/);
  await assert.rejects(catalog.fetchBounded(async () => response("no", { status: 404 }), "https://raw.githubusercontent.com/o/r/HEAD/a", 100), /does not exist/);
  await assert.rejects(catalog.fetchBounded(async () => response("no", { status: 500 }), "https://raw.githubusercontent.com/o/r/HEAD/a", 100), /HTTP 500/);
  await assert.rejects(catalog.fetchBounded(async () => { throw new TypeError("blocked by CORS"); }, "https://raw.githubusercontent.com/o/r/HEAD/a", 100), /could not be reached/);
  const opaque = { type: "opaque", ok: false, status: 0, headers: new Headers(), body: null };
  await assert.rejects(catalog.fetchBounded(async () => opaque, "https://raw.githubusercontent.com/o/r/HEAD/a", 100), /opaque/);
});
