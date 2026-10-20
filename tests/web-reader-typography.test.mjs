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
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-typography-tests-"));
  const entry = join(temporary, "typography.mjs");
  await build({ stdin: { contents: 'export { readerAppearance } from "./client/web-reader-appearance"; export { readerDocument } from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerAppearance, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const article = { url: "https://example.com/story", title: "Readable typography", byline: "Author", content: "<p>Readable text.</p>", textLength: 500, lang: "en", dir: "ltr" };
const invalidSizes = [null, true, false, "19", [], {}, NaN, Infinity, -Infinity, 0, 13, 33, 19.5, "19px; color:red", "</style><script>bad()</script>"];
const invalidHeights = [null, true, false, "1.7", [], {}, NaN, Infinity, 0, 1.1, 2.5, 1.25, 1.7000000000000002, "1.7; color:red"];

test("Reader typography defaults retain existing 19px/1.7 appearance and strictly validate every supported numeric step without mutating settings", () => {
  const value = { future: { keep: [false, "中文"] } }, original = structuredClone(value);
  assert.deepEqual(readerAppearance(value), { readerFont: "serif", readerWidth: "standard", readerFontSize: 19, readerLineHeight: 1.7, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" }); assert.deepEqual(value, original);
  for (let size = 14; size <= 32; size++) { for (let tenth = 12; tenth <= 24; tenth++) { const options = readerAppearance({ readerFontSize: size, readerLineHeight: tenth / 10 }); assert.equal(options.readerFontSize, size); assert.equal(options.readerLineHeight, tenth / 10); } }
  for (const readerFontSize of invalidSizes) { assert.throws(() => readerAppearance({ readerFontSize }), /Reader.*size|Reader.*spacing/i); }
  for (const readerLineHeight of invalidHeights) { assert.throws(() => readerAppearance({ readerLineHeight }), /Reader.*size|Reader.*spacing/i); }
});

test("Initial Reader documents use validated local size/line-spacing CSS while retaining font/width, zoom and the restrictive resource policy", () => {
  for (const readerFontSize of [14, 19, 32]) { for (const readerLineHeight of [1.2, 1.7, 2.4]) {
    const html = readerDocument(article, "a".repeat(36), "https://editor.example", false, 1.5, readerAppearance({ readerFont: "monospace", readerWidth: "narrow", readerFontSize, readerLineHeight }));
    assert.ok(html.includes(`--reader-font-size:${readerFontSize}px;--reader-line-height:${readerLineHeight};`)); assert.ok(html.includes("font:var(--reader-font-size)/var(--reader-line-height) var(--reader-font)"));
    assert.ok(html.includes(":root{zoom:1.5;--reader-font:Consolas,monospace;--reader-width:56ch;")); assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("img-src 'none'")); assert.doesNotMatch(html, /@font-face|@import|url\(/i);
  } }
  for (const readerFontSize of invalidSizes) { assert.throws(() => readerDocument(article, "a".repeat(36), "https://editor.example", false, 1, { readerFontSize })); }
});

test("The actual opaque Reader bootstrap applies all appearance values atomically, preserves progress after reflow and refuses malformed or forged typography messages", () => {
  const token = "a".repeat(36), origin = "https://editor.example", events = new Map(), messages = [], frames = new Map(), styles = new Map(); let serial = 0;
  const viewport = { clientHeight: 200, scrollHeight: 1200, scrollTop: 0, style: { getPropertyValue: key => styles.get(key) ?? "", setProperty: (key, value) => styles.set(key, value) } };
  const parent = { postMessage: data => messages.push(data) }, html = readerDocument(article, token, origin, false), code = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document: { addEventListener() {}, querySelector: () => ({ checkVisibility: () => true }), scrollingElement: viewport, documentElement: viewport }, ResizeObserver: class { observe() {} }, addEventListener: (key, callback) => events.set(key, callback), requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; }, cancelAnimationFrame: id => frames.delete(id) });
  const send = (data, extra = {}) => events.get("message")({ source: parent, origin, data: { channel: "slopsidian-reader", token, ...data }, ...extra });
  const render = () => { for (let step = 0; step < 2; step++) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) { callback(); } } };
  send({ kind: "restore-progress", progress: 0.6 }); render(); assert.equal(viewport.scrollTop, 600);
  const valid = { kind: "appearance", readerFont: "sans-serif", readerWidth: "wide", readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" };
  for (const [data, extra] of [[valid, { source: {} }], [valid, { origin: "https://other.example" }], [{ ...valid, token: "wrong" }, {}], ...invalidSizes.map(readerFontSize => [{ ...valid, readerFontSize }, {}]), ...invalidHeights.map(readerLineHeight => [{ ...valid, readerLineHeight }, {}]), [{ ...valid, readerFont: "constructor" }, {}], [{ ...valid, readerWidth: "url(https://bad.example)" }, {}]]) { send(data, extra); assert.equal(styles.size, 0); }
  send(valid); assert.deepEqual([...styles], [["--reader-font", "system-ui,sans-serif"], ["--reader-width", "96ch"], ["--reader-font-size", "26px"], ["--reader-line-height", "2.1"], ["--reader-paragraph-spacing", "1em"], ["--reader-letter-spacing", "normal"]]);
  viewport.scrollHeight = 2200; render(); assert.equal(viewport.scrollTop, 1200); assert.equal(messages.at(-1).kind, "progress-restored"); assert.equal(messages.at(-1).progress, 0.6);
  const before = [...styles]; send({ ...valid, readerFont: "serif", readerFontSize: 32, readerLineHeight: 9 }); assert.deepEqual([...styles], before);
});

test("Native typography preferences expose bounded numeric controls and do not materialize absent settings", async t => {
  const directory = await mkdtemp(join(temporary, "absent-")), host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(state.settings.readerFontSize, 19); assert.equal(state.settings.readerLineHeight, 1.7);
  for (const [key, minimum, maximum, step] of [["readerFontSize", 14, 32, 1], ["readerLineHeight", 1.2, 2.4, 0.1]]) { const field = state.fields.find(field => field.key === key); assert.equal(field.type, "number"); assert.equal(field.minimum, minimum); assert.equal(field.maximum, maximum); assert.equal(field.step, step); }
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});

test("Native typography updates validate exact numeric bounds/steps atomically, retain opaque keys, reject stale roots and survive full host restart", async t => {
  const directory = await mkdtemp(join(temporary, "settings-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const original = { readerFont: "monospace", readerWidth: "narrow", future: { keep: [false, "中文"] }, readerFontSize: 19, readerLineHeight: 1.7 }; await writeFile(path, JSON.stringify(original));
  let host = await startHost(directory); t.after(() => host.stop());
  for (const values of [...invalidSizes.map(readerFontSize => ({ readerFontSize, readerLineHeight: 2.1 })), ...invalidHeights.map(readerLineHeight => ({ readerFontSize: 26, readerLineHeight }))]) {
    assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values })).status, 400, JSON.stringify(values)); assert.equal(await readFile(path, "utf8"), JSON.stringify(original));
  }
  for (const [readerFontSize, readerLineHeight] of [[14, 1.2], [32, 2.4], [26, 2.1]]) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerFontSize, readerLineHeight } })).status, 200); }
  const expected = { ...original, readerFontSize: 26, readerLineHeight: 2.1 }; assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: "D:\\stale-typography-vault", values: { readerFontSize: 14 } })).status, 409); assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  await host.stop(); host = await startHost(directory); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  for (const [key, value] of Object.entries(expected)) { assert.deepEqual(state.settings[key], value); }
});

test("Imported valid typography is read without rewriting original BOM/CRLF/Unicode settings bytes", async t => {
  const directory = await mkdtemp(join(temporary, "imported-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const bytes = Buffer.from('\ufeff{\r\n  "readerFontSize":32,"readerLineHeight":2.4,"future":{"keep":"中文 😀"}\r\n}\r\n'); await writeFile(path, bytes);
  const host = await startHost(directory); t.after(() => host.stop()); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.deepEqual(readerAppearance(state.settings), { readerFont: "serif", readerWidth: "standard", readerFontSize: 32, readerLineHeight: 2.4, readerParagraphSpacing: 1, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" }); assert.deepEqual(await readFile(path), bytes);
});
