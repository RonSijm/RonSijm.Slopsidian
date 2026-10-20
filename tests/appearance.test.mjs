import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let directory, appearanceOptions, appearanceCssPath, appearanceFontList, appearanceFontCss, validateAppearanceCss;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "appearance-tests-"));
  const outfile = join(directory, "appearance.mjs");
  await build({ entryPoints: [join(root, "client", "appearance-model.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ appearanceOptions, appearanceCssPath, appearanceFontList, appearanceFontCss, validateAppearanceCss } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/appearance-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

test("appearance reads native-shaped modes and literal installed names without mutating unknown preferences", () => {
  const data = { theme: "system", cssTheme: "Theme café", enabledCssSnippets: ["One", "Two", "One"], future: { keep: true } };
  const original = structuredClone(data);
  assert.deepEqual(appearanceOptions(data), { theme: "system", cssTheme: "Theme café", enabledCssSnippets: ["One", "Two"], interfaceFontFamily: "", textFontFamily: "", monospaceFontFamily: "", baseFontSize: 16, allowLocalResources: false });
  assert.deepEqual(data, original);
  assert.deepEqual(appearanceOptions({}), { theme: "obsidian", cssTheme: "", enabledCssSnippets: [], interfaceFontFamily: "", textFontFamily: "", monospaceFontFamily: "", baseFontSize: 16, allowLocalResources: false });
  for (const invalid of [
    { theme: null }, { theme: "dark" }, { cssTheme: null }, { cssTheme: "../foreign" },
    { enabledCssSnippets: null }, { enabledCssSnippets: ["Valid", "CON"] },
    { enabledCssSnippets: ["Valid", ".hidden"] }, { enabledCssSnippets: Array(129).fill("Repeated") },
  ]) { const before = structuredClone(invalid); assert.throws(() => appearanceOptions(invalid)); assert.deepEqual(invalid, before); }
});

test("appearance imports local font lists and text size without mutating saved strings or unrelated values", () => {
  const data = { theme: "moonstone", interfaceFontFamily: "  Arial , Segoe UI  ", textFontFamily: "Georgia, Cafe\u0301, \u{10400} Font", monospaceFontFamily: "Courier New, monospace", baseFontSize: 24, future: { keep: [false] } };
  const before = structuredClone(data), options = appearanceOptions(data);
  assert.equal(options.interfaceFontFamily, "Arial, Segoe UI");
  assert.equal(options.textFontFamily, "Georgia, Cafe\u0301, \u{10400} Font");
  assert.equal(options.monospaceFontFamily, "Courier New, monospace");
  assert.equal(options.baseFontSize, 24);
  assert.deepEqual(data, before);
  assert.equal(appearanceFontList("  "), "");
  assert.equal(appearanceFontList(Array(8).fill("Family").join(",")), Array(8).fill("Family").join(", "));
});

test("appearance fonts quote literal local names, retain generic fallbacks and refuse resources, CSS syntax and malformed lists", () => {
  assert.equal(appearanceFontCss("  Times New Roman, O'Brien, Cafe\u0301, SANS-SERIF "), '"Times New Roman","O\'Brien","Cafe\u0301",sans-serif');
  assert.equal(appearanceFontCss(""), "");
  for (const value of [
    null, true, 42, [], {}, ",", "Arial,", ",Arial", "Arial,,Georgia", Array(9).fill("Arial").join(","),
    "A".repeat(101), "Arial\n", "Arial\t", "Arial\0", "Arial\u2028", "Arial\ufeff", "\ud800",
    '"Arial"', "Arial\\", "123", "url(https://font.invalid/file)", "Arial; color:red", "</style><script>bad()</script>",
  ]) {
    assert.throws(() => appearanceFontList(value));
    for (const key of ["interfaceFontFamily", "textFontFamily", "monospaceFontFamily"]) {
      const data = { [key]: value, future: true }, before = structuredClone(data);
      assert.throws(() => appearanceOptions(data));
      assert.deepEqual(data, before);
    }
  }
});

test("appearance refuses invalid imported text sizes even when custom fonts and styles are disabled", () => {
  for (const baseFontSize of [null, false, "20", NaN, Infinity, 11, 33, 16.5]) {
    assert.throws(() => appearanceOptions({ baseFontSize }), /12 to 32 whole pixels/);
  }
  for (const baseFontSize of [12, 32]) { assert.equal(appearanceOptions({ baseFontSize }).baseFontSize, baseFontSize); }
});

test("appearance paths allow only real top-level snippets and installed theme CSS with safe literal names", () => {
  for (const path of [".obsidian/themes/Theme café/theme.css", ".obsidian/snippets/Notes layout.css", ".obsidian/snippets/Upper.CSS"]) {
    assert.equal(appearanceCssPath(path), path);
  }
  for (const path of [
    "Notes.css", ".obsidian/app.json", ".obsidian/plugins/demo/styles.css",
    ".obsidian/snippets/nested/Hidden.css", ".obsidian/themes/../theme.css",
    ".obsidian/themes/.hidden/theme.css", ".obsidian/snippets/CON.css",
    ".obsidian/snippets/Trailing .css", ".obsidian/snippets/a\\b.css", ".OBSIDIAN/snippets/Foreign.css",
  ]) { assert.throws(() => appearanceCssPath(path), path); }
});

test("self-contained CSS permits literal content/comments but refuses escaped imports and resource-loading functions", () => {
  assert.doesNotThrow(() => validateAppearanceCss('\ufeff/* @import url("never fetched") */\r\nbody { --text-normal: #252525; } .note::after { content: "url(only literal text)"; }\r\n'));
  for (const css of [
    '@import "remote.css";', '@\\69mport "remote.css";', '@\\000069 mport url("remote.css");',
    'body { background: URL("https://example.invalid/"); }',
    'body { background: u\\72l("https://example.invalid/"); }',
    'body { background: image-set("https://example.invalid/image" 1x); }',
    'body { background: -webkit-image-set("https://example.invalid/image" 1x); }',
    'body { background: image("https://example.invalid/image"); }',
    '@font-face { src: src("https://example.invalid/font"); }',
    'body { background: url("data:image/png;base64,AAAA"); }',
  ]) { assert.throws(() => validateAppearanceCss(css), /self-contained/, css); }
});

test("invalid and oversized CSS refuses before insertion, including byte-sized Unicode and incomplete lexical input", () => {
  for (const css of ['body { content: "unterminated; }', 'body { content: "bad\n; background:url(https://example.invalid/); } "', "/* no end", "body { color: \\",
    "body { color: u\\\nrl(https://example.invalid/); }",
    "body { color: \0; }", "/*" + "é".repeat(524288) + "*/"]) {
    assert.throws(() => validateAppearanceCss(css));
  }
  assert.doesNotThrow(() => validateAppearanceCss('body { --label: "escaped \\" quote"; color: red; }'));
  assert.doesNotThrow(() => validateAppearanceCss('body { --label: "escaped\\\r\n continuation"; color: red; }'));
});

test("trusted local resources inline only checked relative fonts/images and refuse remote, escaping, unsafe and mismatched resources", async () => {
  const outfile = join(directory, "assets.mjs");
  await build({ entryPoints: [join(root, "client", "appearance-assets.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { inlineAppearanceResources, resolveAppearanceResource, appearanceAssetPath, newAppearanceAssetBudget, APPEARANCE_OUTPUT_CHARS } = await import(pathToFileURL(outfile).href);
  const woff2 = Buffer.from("wOF2\0\0\0\0"), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const files = { ".obsidian/themes/T/fonts/a.woff2": [woff2, "font/woff2"], ".obsidian/themes/T/img/b.png": [png, "image/png"], ".obsidian/snippets/s.png": [png, "image/png"], ".obsidian/themes/T/bad.png": [woff2, "image/png"] };
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  const reads = [];
  const read = async path => { reads.push(path); const [bytes, contentType] = files[path] ?? assert.fail("unexpected read " + path); return { root: "r", path, contentType, base64: bytes.toString("base64"), version: sha256(bytes), size: bytes.length }; };
  const css = '@font-face{font-family:X;src:url("./fonts/a.woff2")}a{background:URL( img/b.png )}b{content:"url(x)"}/* url(http://x) */';
  const out = await inlineAppearanceResources(css, ".obsidian/themes/T/theme.css", read, newAppearanceAssetBudget());
  assert.match(out, /src:url\("data:font\/woff2;base64,d09GMgAAAAA="\)/);
  assert.match(out, /background:url\("data:image\/png;base64,/);
  assert.ok(out.includes('content:"url(x)"') && out.includes("/* url(http://x) */"));
  assert.deepEqual(reads, [".obsidian/themes/T/fonts/a.woff2", ".obsidian/themes/T/img/b.png"]);
  assert.equal(await inlineAppearanceResources("a{background:url(s.png)}", ".obsidian/snippets/s.css", read, newAppearanceAssetBudget()).then(text => text.includes("data:image/png")), true);
  const refuse = async (text, path = ".obsidian/themes/T/theme.css") => { const before = reads.length; await assert.rejects(inlineAppearanceResources(text, path, read, newAppearanceAssetBudget())); assert.equal(reads.length, before + (text.includes("bad.png") ? 1 : 0)); };
  for (const text of [
    "a{background:url(https://x/a.png)}", "a{background:url(//x/a.png)}", "a{background:url(/a.png)}", "a{background:url(data:image/png;base64,AA)}",
    "a{background:url(../a.png)}", "a{background:url(img/../../a.png)}", "a{background:url(a\\2e png)}", "a{background:url(%2e%2e/a.png)}", "a{background:url(img\\b.png)}",
    "a{background:url(i.svg)}", "a{background:url(.hidden/a.png)}", "a{background:url(a.png?x)}", "a{background:url(a.png#x)}", "a{background:url(a b.png)}",
    "@import 'x.css';", "a{background:image-set(url(a.png) 1x)}", "a{background:src(\"a.png\")}", "a{background:url(bad.png)}", "a{background:url(img/b.png",
  ]) { await refuse(text); }
  assert.throws(() => resolveAppearanceResource(".obsidian/snippets/s.css", "../themes/T/a.png"));
  assert.equal(resolveAppearanceResource(".obsidian/themes/T/theme.css", "a/b.woff2"), ".obsidian/themes/T/a/b.woff2");
  for (const path of [".obsidian/themes/T/theme.css", ".obsidian/plugins/x/a.png", ".obsidian/themes/T/a.svg", ".obsidian/themes/T", "a/b.png"]) { assert.throws(() => appearanceAssetPath(path)); }
  await assert.rejects(inlineAppearanceResources("a{background:url(img/b.png)}", ".obsidian/themes/T/theme.css", async path => ({ ...(await read(path)), size: 3 }), newAppearanceAssetBudget()));
  await assert.rejects(inlineAppearanceResources("a{background:url(img/b.png)}", ".obsidian/themes/T/theme.css", read, { ...newAppearanceAssetBudget(), bytes: 16 * 1024 * 1024 }));
  assert.throws(() => validateAppearanceCss("a{background:url(a.png)}"), /Enable trusted local resources/);
  // Repeated references, multiple styles and a changed same-path asset are measured by the produced shape, not unique file count.
  const big = Buffer.concat([woff2, Buffer.alloc(5 * 1024 * 1024)]);
  const bigRead = async path => { reads.push(path); return { root: "r", path, contentType: "font/woff2", base64: big.toString("base64"), version: sha256(big), size: big.length }; };
  const repeated = "a{src:url(a.woff2)}".repeat(50);
  const shared = newAppearanceAssetBudget(), before = reads.length;
  await assert.rejects(inlineAppearanceResources(repeated, ".obsidian/themes/T/theme.css", bigRead, shared), /expand to more than 24 MiB/);
  assert.equal(reads.length, before + 1);
  assert.ok(shared.output <= APPEARANCE_OUTPUT_CHARS);
  const oneUse = newAppearanceAssetBudget(), single = await inlineAppearanceResources("a{src:url(a.woff2)}", ".obsidian/themes/T/theme.css", bigRead, oneUse);
  assert.equal(oneUse.output, single.length);
  assert.equal(oneUse.assets.size, 1);
  assert.equal(oneUse.bytes, big.length);
  // A later style reuses the prepared asset: no re-read, no double counting, and a changed file on disk cannot make the set inconsistent.
  const changed = Buffer.concat([woff2, Buffer.alloc(7 * 1024 * 1024)]);
  const changedRead = async path => { reads.push(path); return { root: "r", path, contentType: "font/woff2", base64: changed.toString("base64"), version: sha256(changed), size: changed.length }; };
  const reuse = reads.length;
  const second = await inlineAppearanceResources("b{src:url(a.woff2)}", ".obsidian/snippets/x.css".replace("snippets/x.css", "themes/T/theme.css"), changedRead, oneUse);
  assert.equal(reads.length, reuse);
  assert.equal(oneUse.bytes, big.length);
  assert.equal(second.length, single.length);
  // Metadata and hashes are validated before adoption.
  for (const mutate of [payload => ({ ...payload, version: "0".repeat(64) }), payload => ({ ...payload, version: "v" }), payload => ({ ...payload, version: "git:" + "0".repeat(40) }), payload => ({ ...payload, contentType: undefined })]) {
    await assert.rejects(inlineAppearanceResources("a{background:url(img/b.png)}", ".obsidian/themes/T/theme.css", async path => mutate(await read(path)), newAppearanceAssetBudget()));
  }
  const gitSha = bytes => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
  await inlineAppearanceResources("a{background:url(img/b.png)}", ".obsidian/themes/T/theme.css", async path => ({ ...(await read(path)), version: "git:" + gitSha(png) }), newAppearanceAssetBudget());
});
