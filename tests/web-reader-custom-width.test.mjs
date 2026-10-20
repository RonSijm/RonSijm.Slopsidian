import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

let temporary, readerAppearance, readerDocument;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-custom-width-tests-"));
  const entry = join(temporary, "custom-width.mjs");
  await build({ stdin: { contents: 'export {readerAppearance} from "./client/web-reader-appearance";export {readerDocument} from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerAppearance, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const article = { url: "https://example.com/story", title: "Custom width 中文", byline: "Author", content: "<p>First paragraph 中文 😀.</p><p>Second paragraph.</p>", textLength: 500, lang: "en", dir: "ltr" };
const invalid = [null, true, false, "80", [], {}, NaN, Infinity, -Infinity, 0, 39, 121, 80.5, "80ch; color:red", "</style><script>bad()</script>"];

test("Reader custom width retains Standard and 72 ch defaults without mutation, accepts every whole width from 40 to 120 and refuses coercion/CSS even for an inactive custom preference", () => {
  const input = { future: { keep: [false, "中文"] } }, original = structuredClone(input), value = readerAppearance(input);
  assert.equal(value.readerWidth, "standard"); assert.equal(value.readerCustomWidth, 72); assert.deepEqual(input, original);
  for (let readerCustomWidth = 40; readerCustomWidth <= 120; readerCustomWidth++) { assert.equal(readerAppearance({ readerWidth: "custom", readerCustomWidth }).readerCustomWidth, readerCustomWidth); }
  for (const readerCustomWidth of invalid) { for (const readerWidth of ["standard", "custom"]) { assert.throws(() => readerAppearance({ readerWidth, readerCustomWidth }), /Reader custom width/i); } }
});

test("Reader documents resolve custom ch widths while preserving all three preset widths, other typography, article HTML, zoom and the offline CSP", () => {
  for (const [readerWidth, readerCustomWidth, width] of [["narrow", 120, "56ch"], ["standard", 40, "72ch"], ["wide", 81, "96ch"], ["custom", 40, "40ch"], ["custom", 81, "81ch"], ["custom", 120, "120ch"]]) {
    const html = readerDocument(article, "a".repeat(36), "https://editor.example", false, 1.5, readerAppearance({ readerFont: "monospace", readerWidth, readerCustomWidth, readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1.8, readerLetterSpacing: .07 }));
    assert.ok(html.includes("--reader-width:" + width + ";")); assert.ok(html.includes("main{max-width:var(--reader-width);margin:auto;overflow-wrap:anywhere}"));
    assert.ok(html.includes(":root{zoom:1.5;--reader-font:Consolas,monospace;")); assert.ok(html.includes("--reader-font-size:26px;--reader-line-height:2.1;--reader-paragraph-spacing:1.8em;--reader-letter-spacing:0.07em;"));
    assert.ok(html.includes("<article>" + article.content + "</article>")); assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("img-src 'none'")); assert.doesNotMatch(html, /@font-face|@import|url\(/i);
  }
  for (const readerCustomWidth of invalid) { assert.throws(() => readerDocument(article, "a".repeat(36), "https://editor.example", false, 1, { readerWidth: "custom", readerCustomWidth }), /Reader custom width/i); }
});

test("The real Reader bootstrap authenticates complete eight-value appearance updates, applies custom width atomically and restores progress through width and preset changes", () => {
  const token = "a".repeat(36), origin = "https://editor.example", events = new Map(), messages = [], frames = new Map(), styles = new Map(); let serial = 0;
  const viewport = { clientHeight: 200, scrollHeight: 1200, scrollTop: 0, style: { getPropertyValue: key => styles.get(key) ?? "", setProperty: (key, value) => styles.set(key, value) } };
  const parent = { postMessage: data => messages.push(data) }, code = readerDocument(article, token, origin, false).match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document: { addEventListener() {}, querySelector: () => ({ checkVisibility: () => true }), scrollingElement: viewport, documentElement: viewport }, ResizeObserver: class { observe() {} }, addEventListener: (key, callback) => events.set(key, callback), requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; }, cancelAnimationFrame: id => frames.delete(id) });
  const send = (data, extra = {}) => events.get("message")({ source: parent, origin, data: { channel: "slopsidian-reader", token, ...data }, ...extra });
  const render = () => { for (let step = 0; step < 2; step++) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) { callback(); } } };
  send({ kind: "restore-progress", progress: .6 }); render();
  const valid = { kind: "appearance", readerFont: "sans-serif", readerWidth: "custom", readerCustomWidth: 81, readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1.8, readerLetterSpacing: .07, readerCustomFont: "Georgia" };
  for (const [data, extra] of [[valid, { source: {} }], [valid, { origin: "https://other.example" }], [{ ...valid, token: "wrong" }, {}], ...[undefined, ...invalid].map(readerCustomWidth => [{ ...valid, readerCustomWidth }, {}]), [{ ...valid, readerWidth: "constructor" }, {}], [{ ...valid, readerLetterSpacing: .005 }, {}]]) { send(data, extra); assert.equal(styles.size, 0); }
  send(valid); assert.deepEqual([...styles], [["--reader-font", "system-ui,sans-serif"], ["--reader-width", "81ch"], ["--reader-font-size", "26px"], ["--reader-line-height", "2.1"], ["--reader-paragraph-spacing", "1.8em"], ["--reader-letter-spacing", "0.07em"]]);
  viewport.scrollHeight = 2200; render(); assert.equal(viewport.scrollTop, 1200); assert.equal(messages.at(-1).progress, .6);
  const before = [...styles]; send({ ...valid, readerFont: "serif", readerCustomWidth: 80.5 }); assert.deepEqual([...styles], before);
  send({ ...valid, readerWidth: "wide", readerCustomWidth: 40 }); viewport.scrollHeight = 1200; render(); assert.equal(viewport.scrollTop, 600); assert.equal(styles.get("--reader-width"), "96ch");
  send({ ...valid, readerWidth: "wide", readerCustomWidth: 120 }); assert.equal(frames.size, 0, "Inactive custom edits must not reflow the preset"); assert.equal(styles.get("--reader-width"), "96ch");
  send({ ...valid, readerCustomWidth: 120 }); render(); assert.equal(styles.get("--reader-width"), "120ch"); assert.equal(viewport.scrollTop, 600);
});

test("Native custom-width settings expose the Custom choice and bounded whole-character control without creating an absent settings file", async t => {
  const directory = await mkdtemp(join(temporary, "absent-")), host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer"), field = state.fields.find(field => field.key === "readerCustomWidth");
  assert.equal(state.settings.readerWidth, "standard"); assert.equal(state.settings.readerCustomWidth, 72); assert.deepEqual(state.fields.find(field => field.key === "readerWidth").options, ["narrow", "standard", "wide", "custom"]);
  assert.ok(field); assert.equal(field.label, "Reader custom width (ch)"); assert.equal(field.type, "number"); assert.equal(field.minimum, 40); assert.equal(field.maximum, 120); assert.equal(field.step, 1);
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});

test("Native custom widths accept all 81 steps, reject invalid mixed patches atomically, retain opaque preferences and refuse stale roots across a full host restart", async t => {
  const directory = await mkdtemp(join(temporary, "settings-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const original = { readerFont: "serif", readerWidth: "narrow", readerFontSize: 19, readerLineHeight: 1.7, readerParagraphSpacing: 1.8, readerLetterSpacing: .07, future: { keep: [false, "中文"] } }; await writeFile(path, JSON.stringify(original));
  let host = await startHost(directory); t.after(() => host.stop());
  for (const readerCustomWidth of invalid) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerWidth: "custom", readerFont: "monospace", readerCustomWidth } })).status, 400, JSON.stringify(readerCustomWidth)); assert.equal(await readFile(path, "utf8"), JSON.stringify(original)); }
  for (let readerCustomWidth = 40; readerCustomWidth <= 120; readerCustomWidth++) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerCustomWidth } })).status, 200, "Whole width " + readerCustomWidth); }
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerWidth: "custom", readerCustomWidth: 81 } })).status, 200);
  const expected = { ...original, readerWidth: "custom", readerCustomWidth: 81 }; assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: "D:\\stale-custom-width-vault", values: { readerCustomWidth: 40 } })).status, 409); assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  await host.stop(); host = await startHost(directory); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  for (const [key, value] of Object.entries(expected)) { assert.deepEqual(state.settings[key], value); }
});

test("Imported custom widths retain exact BOM/CRLF/Unicode bytes; invalid imported values fail without rewriting and valid inactive custom widths retain their preset", async t => {
  const directory = await mkdtemp(join(temporary, "imported-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const bytes = Buffer.from('\ufeff{\r\n  "readerWidth":"custom","readerCustomWidth":81,"future":{"keep":"中文 😀"}\r\n}\r\n'); await writeFile(path, bytes);
  const host = await startHost(directory); t.after(() => host.stop()); let state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(readerAppearance(state.settings).readerCustomWidth, 81); assert.equal(state.settings.readerWidth, "custom"); assert.deepEqual(await readFile(path), bytes);
  const invalidBytes = Buffer.from('\ufeff{"readerWidth":"custom","readerCustomWidth":80.5,"future":{"keep":"中文 😀"}}\r\n'); await writeFile(path, invalidBytes);
  assert.equal((await host.request("/api/core")).status, 400); assert.deepEqual(await readFile(path), invalidBytes);
  const inactiveBytes = Buffer.from('\ufeff{"readerWidth":"narrow","readerCustomWidth":120,"future":{"keep":"中文 😀"}}\r\n'); await writeFile(path, inactiveBytes);
  state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer"); assert.equal(state.settings.readerWidth, "narrow"); assert.equal(state.settings.readerCustomWidth, 120); assert.deepEqual(await readFile(path), inactiveBytes);
});
