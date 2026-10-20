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
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-letter-spacing-tests-"));
  const entry = join(temporary, "letter-spacing.mjs");
  await build({ stdin: { contents: 'export {readerAppearance} from "./client/web-reader-appearance";export {readerDocument} from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerAppearance, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const article = { url: "https://example.com/story", title: "Letter spacing 中文", byline: "Author", content: "<p>First paragraph 中文 😀.</p><p>Second paragraph.</p>", textLength: 500, lang: "en", dir: "ltr" };
const invalid = [null, true, false, "0.07", [], {}, NaN, Infinity, -Infinity, -.01, .21, .005, .07000000000000002, "0.1em; color:red", "</style><script>bad()</script>"];

test("Reader letter spacing defaults to zero without changing input and accepts every exact hundredth from zero to 0.2 while refusing coercion and CSS", () => {
  const value = { future: { keep: [false, "中文"] } }, original = structuredClone(value);
  assert.equal(readerAppearance(value).readerLetterSpacing, 0); assert.deepEqual(value, original);
  for (let hundredth = 0; hundredth <= 20; hundredth++) { assert.equal(readerAppearance({ readerLetterSpacing: hundredth / 100 }).readerLetterSpacing, hundredth / 100); }
  for (const readerLetterSpacing of invalid) { assert.throws(() => readerAppearance({ readerLetterSpacing }), /Reader letter spacing/i); }
});

test("Reader documents retain normal character spacing at zero and emit bounded em spacing without changing article HTML, other typography, zoom or CSP", () => {
  for (const readerLetterSpacing of [0, .01, .07, .12, .2]) {
    const html = readerDocument(article, "a".repeat(36), "https://editor.example", false, 1.5, readerAppearance({ readerFont: "monospace", readerWidth: "narrow", readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1.8, readerLetterSpacing }));
    assert.ok(html.includes("--reader-letter-spacing:" + (readerLetterSpacing === 0 ? "normal" : readerLetterSpacing + "em") + ";")); assert.ok(html.includes("letter-spacing:var(--reader-letter-spacing)"));
    assert.ok(html.includes("--reader-font-size:26px;--reader-line-height:2.1;--reader-paragraph-spacing:1.8em;")); assert.ok(html.includes(":root{zoom:1.5;--reader-font:Consolas,monospace;--reader-width:56ch;"));
    assert.ok(html.includes("<article>" + article.content + "</article>")); assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("img-src 'none'")); assert.doesNotMatch(html, /@font-face|@import|url\(/i);
  }
  for (const readerLetterSpacing of invalid) { assert.throws(() => readerDocument(article, "a".repeat(36), "https://editor.example", false, 1, { readerLetterSpacing }), /Reader letter spacing/i); }
});

test("The actual Reader bootstrap validates all eight appearance values and authenticates the parent before atomically applying letter spacing with retained progress", () => {
  const token = "a".repeat(36), origin = "https://editor.example", events = new Map(), messages = [], frames = new Map(), styles = new Map(); let serial = 0;
  const viewport = { clientHeight: 200, scrollHeight: 1200, scrollTop: 0, style: { getPropertyValue: key => styles.get(key) ?? "", setProperty: (key, value) => styles.set(key, value) } };
  const parent = { postMessage: data => messages.push(data) }, code = readerDocument(article, token, origin, false).match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document: { addEventListener() {}, querySelector: () => ({ checkVisibility: () => true }), scrollingElement: viewport, documentElement: viewport }, ResizeObserver: class { observe() {} }, addEventListener: (key, callback) => events.set(key, callback), requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; }, cancelAnimationFrame: id => frames.delete(id) });
  const send = (data, extra = {}) => events.get("message")({ source: parent, origin, data: { channel: "slopsidian-reader", token, ...data }, ...extra });
  const render = () => { for (let step = 0; step < 2; step++) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) { callback(); } } };
  send({ kind: "restore-progress", progress: .6 }); render();
  const valid = { kind: "appearance", readerFont: "sans-serif", readerWidth: "wide", readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1.8, readerLetterSpacing: .07, readerCustomWidth: 72, readerCustomFont: "Georgia" };
  for (const [data, extra] of [[valid, { source: {} }], [valid, { origin: "https://other.example" }], [{ ...valid, token: "wrong" }, {}], ...[undefined, ...invalid].map(readerLetterSpacing => [{ ...valid, readerLetterSpacing }, {}]), [{ ...valid, readerParagraphSpacing: .25 }, {}], [{ ...valid, readerFont: "constructor" }, {}]]) { send(data, extra); assert.equal(styles.size, 0); }
  send(valid); assert.deepEqual([...styles], [["--reader-font", "system-ui,sans-serif"], ["--reader-width", "96ch"], ["--reader-font-size", "26px"], ["--reader-line-height", "2.1"], ["--reader-paragraph-spacing", "1.8em"], ["--reader-letter-spacing", "0.07em"]]);
  viewport.scrollHeight = 2200; render(); assert.equal(viewport.scrollTop, 1200); assert.equal(messages.at(-1).progress, .6);
  const before = [...styles]; send({ ...valid, readerFont: "serif", readerLetterSpacing: .005 }); assert.deepEqual([...styles], before);
  send({ ...valid, readerLetterSpacing: 0 }); viewport.scrollHeight = 1200; render(); assert.equal(viewport.scrollTop, 600); assert.equal(styles.get("--reader-letter-spacing"), "normal");
});

test("Native letter-spacing preferences expose bounded numeric controls and do not create absent settings files", async t => {
  const directory = await mkdtemp(join(temporary, "absent-")), host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer"), field = state.fields.find(field => field.key === "readerLetterSpacing");
  assert.equal(state.settings.readerLetterSpacing, 0); assert.ok(field); assert.equal(field.label, "Reader letter spacing (em)"); assert.equal(field.type, "number"); assert.equal(field.minimum, 0); assert.equal(field.maximum, .2); assert.equal(field.step, .01);
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});

test("Native letter-spacing patches accept exact hundredths atomically, preserve opaque fields, refuse stale roots and survive host restart", async t => {
  const directory = await mkdtemp(join(temporary, "settings-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const original = { readerFont: "serif", readerWidth: "narrow", readerFontSize: 19, readerLineHeight: 1.7, readerParagraphSpacing: 1.8, future: { keep: [false, "中文"] } }; await writeFile(path, JSON.stringify(original));
  let host = await startHost(directory); t.after(() => host.stop());
  for (const readerLetterSpacing of invalid) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerFont: "monospace", readerLetterSpacing } })).status, 400, JSON.stringify(readerLetterSpacing)); assert.equal(await readFile(path, "utf8"), JSON.stringify(original)); }
  for (let hundredth = 0; hundredth <= 20; hundredth++) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerLetterSpacing: hundredth / 100 } })).status, 200, "Exact hundredth " + hundredth); }
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerFont: "sans-serif", readerLetterSpacing: .07 } })).status, 200);
  const expected = { ...original, readerFont: "sans-serif", readerLetterSpacing: .07 }; assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: "D:\\stale-letter-vault", values: { readerLetterSpacing: 0 } })).status, 409); assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  await host.stop(); host = await startHost(directory); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  for (const [key, value] of Object.entries(expected)) { assert.deepEqual(state.settings[key], value); }
});

test("Imported letter spacing preserves exact BOM/CRLF/Unicode settings and invalid imported values fail without rewriting their bytes", async t => {
  const directory = await mkdtemp(join(temporary, "imported-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const bytes = Buffer.from('\ufeff{\r\n  "readerLetterSpacing":0.07,"future":{"keep":"中文 😀"}\r\n}\r\n'); await writeFile(path, bytes);
  const host = await startHost(directory); t.after(() => host.stop()); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(readerAppearance(state.settings).readerLetterSpacing, .07); assert.deepEqual(await readFile(path), bytes);
  const invalidBytes = Buffer.from('\ufeff{"readerLetterSpacing":0.005,"future":{"keep":"中文 😀"}}\r\n'); await writeFile(path, invalidBytes);
  assert.equal((await host.request("/api/core")).status, 400); assert.deepEqual(await readFile(path), invalidBytes);
});
