import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { root, startHost } from "./host.mjs";

let temporary, readerAppearance, readerDocument;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "reader-appearance-tests-"));
  const entry = join(temporary, "appearance.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-reader-appearance"; export { readerDocument } from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerAppearance, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => {
  if (temporary) {
    const path = relative(join(root, ".runtime"), temporary);
    assert.ok(path && !isAbsolute(path) && !path.startsWith(".."));
    await rm(temporary, { recursive: true });
  }
});
const article = { url: "https://example.com/story", title: "Readable story", byline: "Author", content: "<p>Readable text.</p>", textLength: 500, lang: "en", dir: "ltr" };

test("Reader appearance defaults are detached and do not rewrite opaque vault settings", () => {
  const value = { future: { keep: [false, 1] } }, before = structuredClone(value);
  const first = readerAppearance(value);
  assert.deepEqual(first, { readerFont: "serif", readerWidth: "standard", readerFontSize: 19, readerLineHeight: 1.7, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" });
  first.readerFont = "monospace";
  assert.deepEqual(readerAppearance(value), { readerFont: "serif", readerWidth: "standard", readerFontSize: 19, readerLineHeight: 1.7, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" });
  assert.deepEqual(value, before);
});

test("Every supported Reader font and width produces bounded local CSS with the existing CSP and zoom", () => {
  for (const [readerFont, font] of [["serif", "Georgia,serif"], ["sans-serif", "system-ui,sans-serif"], ["monospace", "Consolas,monospace"]]) {
    for (const [readerWidth, width] of [["narrow", "56ch"], ["standard", "72ch"], ["wide", "96ch"]]) {
      const appearance = readerAppearance({ readerFont, readerWidth });
      const html = readerDocument(article, "a".repeat(36), "https://editor.example", false, 1.5, appearance);
      assert.ok(html.includes(":root{zoom:1.5;--reader-font:" + font + ";--reader-width:" + width + ";"));
      assert.ok(html.includes("--reader-font-size:19px;--reader-line-height:1.7;"));
      assert.ok(html.includes("font:var(--reader-font-size)/var(--reader-line-height) var(--reader-font)"));
      assert.ok(html.includes("max-width:var(--reader-width)"));
      assert.ok(html.includes("connect-src 'none'"));
      assert.equal((html.match(/<script\b/g) ?? []).length, 1);
      assert.equal(/@import|@font-face|url\(/i.test(html), false);
    }
  }
});

test("Appearance rejects coercion, inherited map keys and CSS or script payloads before generating a document", () => {
  for (const value of [null, true, 1, [], {}, "", "Serif", "toString", "__proto__", "constructor", 'serif; background:url(https://bad.example)', '</style><script>alert(1)</script>']) {
    for (const key of ["readerFont", "readerWidth"]) {
      assert.throws(() => readerAppearance({ [key]: value }), /supported Reader/);
      assert.throws(() => readerDocument(article, "a".repeat(36), "https://editor.example", true, 1, { readerFont: "serif", readerWidth: "standard", [key]: value }), /supported Reader/);
    }
  }
});

test("The actual Reader bootstrap accepts only owner-origin session messages and applies valid appearance atomically", () => {
  const token = "a".repeat(36), origin = "https://editor.example", applied = [];
  let receive;
  const parent = { postMessage() {} };
  const html = readerDocument(article, token, origin, false);
  const code = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document: { addEventListener() {}, querySelector: () => ({ checkVisibility: () => true }), documentElement: { style: { getPropertyValue: () => "", setProperty: (...args) => applied.push(args) } } }, ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener: (type, callback) => { if (type === "message") { receive = callback; } } });
  const valid = { source: parent, origin, data: { channel: "slopsidian-reader", token, kind: "appearance", readerFont: "sans-serif", readerWidth: "narrow", readerFontSize: 19, readerLineHeight: 1.7, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" } };
  for (const event of [{ ...valid, source: {} }, { ...valid, origin: "https://other.example" }, { ...valid, data: { ...valid.data, token: "wrong" } }, ...["constructor", "url(https://bad.example)", null, 1].map(readerWidth => ({ ...valid, data: { ...valid.data, readerWidth } }))]) {
    receive(event); assert.deepEqual(applied, []);
  }
  receive(valid);
  assert.deepEqual(applied, [["--reader-font", "system-ui,sans-serif"], ["--reader-width", "56ch"], ["--reader-font-size", "19px"], ["--reader-line-height", "1.7"], ["--reader-paragraph-spacing", "1em"], ["--reader-letter-spacing", "normal"]]);
});

test("Native Reader preferences default without creating settings and expose finite select choices", async t => {
  const directory = await mkdtemp(join(temporary, "defaults-"));
  const host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(item => item.id === "webviewer");
  assert.equal(state.settings.readerFont, "serif"); assert.equal(state.settings.readerWidth, "standard");
  assert.deepEqual(state.fields.find(field => field.key === "readerFont").options, ["serif", "sans-serif", "monospace", "custom"]);
  assert.deepEqual(state.fields.find(field => field.key === "readerWidth").options, ["narrow", "standard", "wide", "custom"]);
  assert.equal(state.fields.find(field => field.key === "readerFont").type, "select");
  assert.equal(state.fields.find(field => field.key === "readerWidth").type, "select");
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});

test("Native Reader preference validation is atomic, preserves opaque data and survives a full host restart", async t => {
  const directory = await mkdtemp(join(temporary, "settings-")), path = join(directory, ".obsidian", "webviewer.json");
  await mkdir(join(directory, ".obsidian"));
  const original = { readerFont: "serif", readerWidth: "standard", future: { keep: [false, "中文"] }, enableAdblocking: false };
  await writeFile(path, JSON.stringify(original));
  let host = await startHost(directory); t.after(() => host.stop());
  for (const values of [{ readerFont: "Georgia" }, { readerFont: null }, { readerFont: 1 }, { readerWidth: "72ch" }, { readerWidth: false }, { readerFont: "monospace", readerWidth: "__proto__" }]) {
    assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values })).status, 400);
    assert.equal(await readFile(path, "utf8"), JSON.stringify(original));
  }
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerFont: "sans-serif", readerWidth: "wide" } })).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, readerFont: "sans-serif", readerWidth: "wide" });
  await host.stop(); host = await startHost(directory);
  const state = (await (await host.request("/api/core")).json()).plugins.find(item => item.id === "webviewer");
  assert.equal(state.settings.readerFont, "sans-serif"); assert.equal(state.settings.readerWidth, "wide");
  assert.deepEqual(state.settings.future, original.future);
});
