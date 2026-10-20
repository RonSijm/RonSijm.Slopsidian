import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { frontmatterPropertyPosition } from "../client/markdown.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, propertiesPaneState, sortedProperties, MetadataTypeManager, numericLexemes, numberText, parsePropertyValue, updateFrontmatter, composingKey;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "properties-pane-tests-"));
  const outfile = join(directory, "properties.mjs");
  await build({ stdin: { contents: 'export * from "./client/properties-pane-model"; export { MetadataTypeManager, parsePropertyValue } from "./client/property-types"; export { updateFrontmatter } from "./client/markdown"; export * from "./client/properties-lexemes";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  ({ propertiesPaneState, sortedProperties, MetadataTypeManager, numericLexemes, numberText, parsePropertyValue, updateFrontmatter, composingKey } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/properties-pane-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

test("Properties imports retain independent filters, targets and catalog folds with legacy file pinning", () => {
  const input = { file: "Notes/Source.md", query: "<literal>", sort: "frequency", expandedProperties: ["Title", "TITLE"], opaque: { keep: true } }, before = structuredClone(input);
  const first = propertiesPaneState(input), second = propertiesPaneState(input);
  assert.equal(first.followActiveFile, false); assert.deepEqual(first.expandedProperties, ["title"]);
  first.file = "Other.md"; first.expandedProperties.push("other");
  assert.deepEqual(second.expandedProperties, ["title"]); assert.equal(second.file, input.file); assert.deepEqual(input, before);
  assert.equal(propertiesPaneState({}).followActiveFile, true);
  assert.equal(propertiesPaneState({ file: input.file, followActiveFile: true }).followActiveFile, true);
});
test("malformed Properties state refuses rather than coercing paths, filters, sorts or folds", () => {
  for (const state of [
    { query: null }, { query: "x".repeat(1025) }, { sort: "__proto__" }, { sort: null }, { followActiveFile: null }, { followActiveFile: 0 },
    { expandedProperties: null }, { expandedProperties: [""] }, { expandedProperties: Array(1025).fill("a") },
    ...["/note.md", "../note.md", ".obsidian/app.json", "a//b.md", "a\\b.md", "a\u0000b.md", ""].map(file => ({ file })),
  ]) { assert.throws(() => propertiesPaneState(state)); }
});
test("Properties filtering and four sorts preserve source entries and deterministic frequency ties", () => {
  const entries = [{ name: "Beta", occurrences: 2 }, { name: "alpha", occurrences: 3 }, { name: "gamma", occurrences: 2 }], before = structuredClone(entries);
  const names = (sort, query = "") => sortedProperties(entries, query, sort).map(entry => entry.name);
  assert.deepEqual(names("name"), ["alpha", "Beta", "gamma"]);
  assert.deepEqual(names("nameReverse"), ["gamma", "Beta", "alpha"]);
  assert.deepEqual(names("frequency"), ["alpha", "Beta", "gamma"]);
  assert.deepEqual(names("frequencyReverse"), ["Beta", "gamma", "alpha"]);
  assert.deepEqual(names("name", "ALP"), ["alpha"]); assert.deepEqual(entries, before);
});
test("property catalog occurrences count notes once even with case-distinct YAML keys", () => {
  const app = { vault: { rootPath: "fixture" }, metadataCache: { on() {}, getDocuments: () => [
    { document: { file: { extension: "md" } }, cache: { frontmatter: { Label: "one", label: "two", title: "First" } } },
    { document: { file: { extension: "md" } }, cache: { frontmatter: { LABEL: 3 } } },
  ] } };
  const manager = new MetadataTypeManager(app);
  manager.accept({ root: "fixture", id: "types", version: null, data: {} });
  assert.deepEqual(manager.getPropertyInfo("label"), { name: "Label", widget: "unknown", occurrences: 2 });
  assert.equal(manager.getPropertyInfo("title").occurrences, 1);
});
test("number controls retain original YAML literals only while they match the current value", () => {
  const text = "\ufeff---\r\nbig: 12345678901234567890\r\nfloat: 1.50\r\nexp: 1E3\r\nhex: 0x1F\r\nname: 7\r\nnested:\r\n  deep: 1.0\r\n---\r\n";
  const lexemes = numericLexemes(text);
  assert.deepEqual([...lexemes], [["big", "12345678901234567890"], ["float", "1.50"], ["exp", "1E3"], ["hex", "0x1F"], ["name", "7"]]);
  assert.equal(numberText(12345678901234567000, lexemes.get("big")), "12345678901234567890");
  assert.equal(numberText(1.5, "1.50"), "1.50"); assert.equal(numberText(1000, "1E3"), "1E3");
  assert.equal(numberText(31, "0x1F"), "0x1F"); assert.equal(numberText(8, "7"), "8"); assert.equal(numberText(3, undefined), "3");
  assert.equal(numberText(32, "0x1F"), "32"); assert.equal(numberText(16, "0o17"), "16"); assert.equal(numberText(15, "0o17"), "0o17");
  assert.equal(numberText(-5, "-5"), "-5"); assert.equal(numberText(5, "-5"), "5"); assert.equal(numberText(7, "+7"), "+7");
  assert.equal(numberText(12345678901234567000, "12345678901234567891"), "12345678901234567891");
  assert.equal(numberText(1, "12345678901234567890"), "1"); assert.equal(numberText(1, "not a number"), "1");
});
test("non-decimal numeric edits preserve unchanged bytes and reject unsafe values", () => {
  assert.equal(parsePropertyValue("number", "0x20"), 32); assert.equal(parsePropertyValue("number", "0o20"), 16);
  for (const bad of ["0x", "0xZZ", "0o8", "-0x1", "0b1", "0X1G", "0x20000000000000", "9007199254740993", "12345678901234567890", "1_000", ".inf", "NaN", "1 2", ""]) {
    assert.throws(() => parsePropertyValue("number", bad), undefined, bad);
  }
  const text = "\ufeff---\r\nh: 0x1F # keep\r\no: 0o17\r\nbig: 12345678901234567890\r\nf: 1.50\r\nafter:\r\n  - a\r\n---\r\nbody\r\n";
  const edit = (key, value) => updateFrontmatter(text, values => { values[key] = parsePropertyValue("number", value); });
  assert.equal(edit("h", "0x1F"), text); assert.equal(edit("h", "31"), text);
  assert.equal(edit("h", "0x20"), text.replace("0x1F #", "0x20 #"));
  assert.equal(edit("o", "0o20"), text.replace("0o17", "0o20"));
  assert.equal(edit("f", "2.5"), text.replace("1.50", "2.50"));
  assert.equal(edit("o", "1.5"), text.replace("0o17", "1.5"));
  assert.equal(edit("big", "12"), text.replace("12345678901234567890", "12"));
  assert.ok(edit("h", "0x20").startsWith("\ufeff---\r\n") && !edit("h", "0x20").replaceAll("\r\n", "").includes("\n"));
});
test("literal-only changes update display text and composition keys stay distinguishable", () => {
  assert.equal(numberText(1.5, "1.50"), "1.50"); assert.equal(numberText(1.5, "1.500"), "1.500");
  assert.notEqual(numberText(1.5, "1.50"), numberText(1.5, "1.500"));
  assert.equal(composingKey({ isComposing: true, keyCode: 13 }), true);
  assert.equal(composingKey({ isComposing: false, keyCode: 229 }), true);
  assert.equal(composingKey({ isComposing: false, keyCode: 13 }), false);
});
test("catalog navigation selects actual top-level YAML key ranges including quoted CRLF keys", () => {
  const text = '\ufeff---\r\n# Keep comment\r\n"project: label": Alpha\r\nnested: {title: keep}\r\n---\r\n# Body\r\n';
  const location = frontmatterPropertyPosition(text, "project: label");
  assert.equal(text.slice(location.start.offset, location.end.offset), '"project: label"');
  assert.equal(location.start.line, 2);
  assert.equal(frontmatterPropertyPosition(text, "title"), null);
  assert.equal(frontmatterPropertyPosition("---\nbroken: [\n---\n", "broken"), null);
});
