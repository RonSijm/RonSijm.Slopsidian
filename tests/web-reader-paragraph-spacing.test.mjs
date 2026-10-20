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
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "reader-paragraph-spacing-tests-"));
  const entry = join(temporary, "paragraph-spacing.mjs");
  await build({ stdin: { contents: 'export {readerAppearance} from "./client/web-reader-appearance";export {readerDocument} from "./client/web-reader-frame";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ readerAppearance, readerDocument } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const article = { url: "https://example.com/story", title: "Paragraph spacing 中文", byline: "Author", content: "<p>First paragraph.</p><p>Second paragraph.</p>", textLength: 500, lang: "en", dir: "ltr" };
const invalid = [null, true, false, "1", [], {}, NaN, Infinity, -Infinity, -.1, 3.1, .25, 1.7000000000000002, "1em; color:red", "</style><script>bad()</script>"];

test("Reader paragraph spacing retains the 1em default, accepts every exact tenth from zero to three, and rejects coercion or CSS without changing input", () => {
  const value = { future: { keep: [false, "中文"] } }, original = structuredClone(value);
  assert.equal(readerAppearance(value).readerParagraphSpacing, 1); assert.deepEqual(value, original);
  for (let tenth = 0; tenth <= 30; tenth++) { assert.equal(readerAppearance({ readerParagraphSpacing: tenth / 10 }).readerParagraphSpacing, tenth / 10); }
  for (const readerParagraphSpacing of invalid) { assert.throws(() => readerAppearance({ readerParagraphSpacing }), /Reader paragraph spacing/i); }
});

test("Reader documents use bounded em paragraph margins independently of font size, line height, width and zoom, preserving article HTML and resource policy", () => {
  for (const readerParagraphSpacing of [0, .7, 1, 1.8, 3]) {
    const html = readerDocument(article, "a".repeat(36), "https://editor.example", false, 1.5, readerAppearance({ readerFont: "monospace", readerWidth: "narrow", readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing }));
    assert.ok(html.includes(`--reader-paragraph-spacing:${readerParagraphSpacing}em;`)); assert.ok(html.includes("p{margin:var(--reader-paragraph-spacing) 0}"));
    assert.ok(html.includes("--reader-font-size:26px;--reader-line-height:2.1;")); assert.ok(html.includes(":root{zoom:1.5;--reader-font:Consolas,monospace;--reader-width:56ch;"));
    assert.ok(html.includes("<article>" + article.content + "</article>")); assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("img-src 'none'")); assert.doesNotMatch(html, /@font-face|@import|url\(/i);
  }
  for (const readerParagraphSpacing of invalid) { assert.throws(() => readerDocument(article, "a".repeat(36), "https://editor.example", false, 1, { readerParagraphSpacing }), /Reader paragraph spacing/i); }
});

test("The actual Reader bootstrap authenticates and validates all eight appearance values before applying paragraph spacing, preserves fractional progress and rejects incomplete updates", () => {
  const token = "a".repeat(36), origin = "https://editor.example", events = new Map(), messages = [], frames = new Map(), styles = new Map(); let serial = 0, mainVisible = true;
  const viewport = { clientHeight: 200, scrollHeight: 1200, scrollTop: 0, style: { getPropertyValue: key => styles.get(key) ?? "", setProperty: (key, value) => styles.set(key, value) } };
  const parent = { postMessage: data => messages.push(data) }, code = readerDocument(article, token, origin, false).match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code, { parent, document: { addEventListener() {}, querySelector: () => ({ checkVisibility: () => mainVisible }), scrollingElement: viewport, documentElement: viewport }, ResizeObserver: class { constructor(callback) { events.set("layout", callback); } observe() {} }, addEventListener: (key, callback) => events.set(key, callback), requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; }, cancelAnimationFrame: id => frames.delete(id) });
  const send = (data, extra = {}) => events.get("message")({ source: parent, origin, data: { channel: "slopsidian-reader", token, ...data }, ...extra });
  const render = () => { for (let step = 0; step < 2; step++) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) { callback(); } } };
  send({ kind: "restore-progress", progress: .6 }); render(); assert.equal(viewport.scrollTop, 600);
  const valid = { kind: "appearance", readerFont: "sans-serif", readerWidth: "wide", readerFontSize: 26, readerLineHeight: 2.1, readerParagraphSpacing: 1.8, readerLetterSpacing: 0, readerCustomWidth: 72, readerCustomFont: "Georgia" };
  for (const [data, extra] of [[valid, { source: {} }], [valid, { origin: "https://other.example" }], [{ ...valid, token: "wrong" }, {}], ...[undefined, ...invalid].map(readerParagraphSpacing => [{ ...valid, readerParagraphSpacing }, {}]), [{ ...valid, readerLineHeight: 9 }, {}], [{ ...valid, readerFont: "constructor" }, {}]]) { send(data, extra); assert.equal(styles.size, 0); }
  send(valid); assert.deepEqual([...styles], [["--reader-font", "system-ui,sans-serif"], ["--reader-width", "96ch"], ["--reader-font-size", "26px"], ["--reader-line-height", "2.1"], ["--reader-paragraph-spacing", "1.8em"], ["--reader-letter-spacing", "normal"]]);
  viewport.scrollHeight = 2200; render(); assert.equal(viewport.scrollTop, 1200); assert.equal(messages.at(-1).progress, .6);
  const before = [...styles]; send({ ...valid, readerWidth: "narrow", readerParagraphSpacing: .25 }); assert.deepEqual([...styles], before);
  send({ ...valid, readerParagraphSpacing: 0 }); viewport.scrollHeight = 700; render(); assert.equal(viewport.scrollTop, 300); assert.equal(styles.get("--reader-paragraph-spacing"), "0em");
  send({ ...valid, readerParagraphSpacing: 3 }); viewport.scrollHeight = 3200; render(); assert.equal(viewport.scrollTop, 1800); assert.equal(styles.get("--reader-paragraph-spacing"), "3em");
  viewport.clientHeight = 0; viewport.scrollTop = 0;
  send({ ...valid, readerParagraphSpacing: 2 }); render();
  viewport.clientHeight = 200; viewport.scrollHeight = 4200; events.get("resize")(); render(); assert.equal(viewport.scrollTop, 2400, "An appearance message arriving before the hidden-frame resize must retain its last confirmed progress");
  mainVisible = false; viewport.scrollHeight = viewport.clientHeight; viewport.scrollTop = 0; const count = messages.length;
  send({ ...valid, readerParagraphSpacing: .7 }); render(); assert.equal(messages.length, count, "A hidden article with a positive viewport cannot report its empty scroll range as progress");
  mainVisible = true; viewport.scrollHeight = 2200; events.get("layout")(); render(); assert.equal(viewport.scrollTop, 1200, "Article layout becoming visible restores its last confirmed fraction without a viewport resize");
  viewport.scrollTop = 0; events.get("layout")(); events.get("scroll")();
  assert.equal(messages.at(-1).progress, 0, "A visible article size notification cannot suppress a new user scroll with a stale restoration"); render(); assert.equal(viewport.scrollTop, 0);
});

test("Native paragraph-spacing preferences expose the bounded numeric control and retain absent settings files", async t => {
  const directory = await mkdtemp(join(temporary, "absent-")), host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer"), field = state.fields.find(field => field.key === "readerParagraphSpacing");
  assert.equal(state.settings.readerParagraphSpacing, 1); assert.ok(field); assert.equal(field.label, "Reader paragraph spacing (em)"); assert.equal(field.type, "number"); assert.equal(field.minimum, 0); assert.equal(field.maximum, 3); assert.equal(field.step, .1);
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});

test("Native paragraph-spacing patches validate exact numeric tenths atomically, preserve opaque data, reject stale roots and survive a full host restart", async t => {
  const directory = await mkdtemp(join(temporary, "settings-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const original = { readerFont: "serif", readerWidth: "narrow", readerFontSize: 19, readerLineHeight: 1.7, future: { keep: [false, "中文"] } }; await writeFile(path, JSON.stringify(original));
  let host = await startHost(directory); t.after(() => host.stop());
  for (const readerParagraphSpacing of invalid) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerFont: "monospace", readerParagraphSpacing } })).status, 400, JSON.stringify(readerParagraphSpacing)); assert.equal(await readFile(path, "utf8"), JSON.stringify(original)); }
  for (let tenth = 0; tenth <= 30; tenth++) { assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerParagraphSpacing: tenth / 10 } })).status, 200, "Exact tenth " + tenth); }
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { readerFont: "sans-serif", readerParagraphSpacing: 1.8 } })).status, 200);
  const expected = { ...original, readerFont: "sans-serif", readerParagraphSpacing: 1.8 }; assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: "D:\\stale-paragraph-vault", values: { readerParagraphSpacing: 0 } })).status, 409); assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  await host.stop(); host = await startHost(directory); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  for (const [key, value] of Object.entries(expected)) { assert.deepEqual(state.settings[key], value); }
});

test("Imported paragraph spacing retains exact BOM/CRLF/Unicode settings, while invalid imported values fail without rewriting their bytes", async t => {
  const directory = await mkdtemp(join(temporary, "imported-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const bytes = Buffer.from('\ufeff{\r\n  "readerParagraphSpacing":0.7,"future":{"keep":"中文 😀"}\r\n}\r\n'); await writeFile(path, bytes);
  const host = await startHost(directory); t.after(() => host.stop()); const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(readerAppearance(state.settings).readerParagraphSpacing, .7); assert.deepEqual(await readFile(path), bytes);
  const invalidBytes = Buffer.from('\ufeff{"readerParagraphSpacing":0.25,"future":{"keep":"中文 😀"}}\r\n'); await writeFile(path, invalidBytes);
  assert.equal((await host.request("/api/core")).status, 400); assert.deepEqual(await readFile(path), invalidBytes);
});
