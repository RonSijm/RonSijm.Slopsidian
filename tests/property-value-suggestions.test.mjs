import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature, MetadataEditor, inlinePropertyRow;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "property-value-suggestions-tests-"));
  const outfile = join(directory, "suggestions.mjs");
  await build({ stdin: { contents: 'export * from "./client/property-value-suggestions"; export { parseMarkdown, updateFrontmatter } from "./client/markdown"; export { fileLinktext, resolveLink, resolveSubpath } from "./client/links";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  feature = await import(pathToFileURL(outfile).href);
  const source = await readFile(join(root, "client/properties.ts"), "utf8"), from = source.indexOf("export class MetadataEditor {"), to = source.indexOf("\nexport class Properties extends Events", from);
  assert.ok(from >= 0 && to > from);
  const metadataOutfile = join(directory, "metadata-editor.mjs");
  await build({ stdin: { contents: 'import {sameValue} from "./client/markdown"; import {propertyTextControl as textControl} from "./client/multiline-properties"; const inferPropertyType=()=>"text", reportError=error=>{throw error}, icon=()=>document.createElement("svg"), inlinePropertyRow=(...args)=>globalThis.propertiesCompletionRowFactory(...args);\n' + source.slice(from, to), resolveDir: root, loader: "ts" }, outfile: metadataOutfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  ({ MetadataEditor } = await import(pathToFileURL(metadataOutfile).href));
  const rowOutfile = join(directory, "property-row.mjs"), rowFrom = source.indexOf("function editable("), rowTo = source.indexOf("export class MetadataEditor {");
  assert.ok(rowFrom >= 0 && rowTo > rowFrom);
  await build({ stdin: { contents: 'import {sameValue,validTag} from "./client/markdown"; import {checkedMultilineText,createMultilinePropertyEditor,createStructuredPropertyInspector,hasMultilineText,multilineListSupported,preserveMultilinePropertySource,propertyTextControl as textControl,replaceMultilinePropertyValue,structuredPropertySourceSupported} from "./client/multiline-properties"; import {inferPropertyType,parsePropertyValue,propertyTypes} from "./client/property-types"; import {composingKey,numberText} from "./client/properties-lexemes"; import {MAX_COMPLETION_RESULTS} from "./client/builtin-suggestion-model"; import {PropertyValueSuggestions,propertyValueChoices,assertPropertyValueChoice,propertyNoteCreationChoice,createPropertyNote,propertyHeadingCreationChoice,createPropertyHeading,propertyWikiValue,replacePropertyListValue} from "./client/property-value-suggestions"; const icon=()=>document.createElement("svg"),reportError=error=>{throw error},openTagSearch=()=>{};\n' + source.slice(rowFrom, rowTo) + '\nexport {inlinePropertyRow};', resolveDir: root, loader: "ts" }, outfile: rowOutfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  ({ inlinePropertyRow } = await import(pathToFileURL(rowOutfile).href));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/property-value-suggestions-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

function fixture(source = '---\nstatus: Open\ntags: [shared]\nlabels: [kept]\n---\nBody.\n', sourcePath = "Source.md") {
  const documents = new Map(), files = new Map(), sessions = new Map(), config = new Map();
  const app = { vault: { rootPath: "fixture", readOnly: false, getFileByPath: path => files.get(path) ?? null, getFiles: () => [...files.values()], getConfig: name => config.get(name) }, workspace: { sessions, isChangingFiles: false }, metadataCache: { getDocument: path => documents.get(path), getDocuments: () => [...documents.values()], fileToLinktext: (target, source, omit) => feature.fileLinktext([...files.values()], target.path, source, omit, config.get("newLinkFormat")), resolveReference: (link, source) => feature.resolveLink([...files.values()], link.link, source) }, core: { isEnabled: () => true }, changingVault: false };
  const add = (path, text) => { const file = { path, extension: "md", vault: app.vault }; files.set(path, file); documents.set(path, { document: { file: { path } }, text, cache: feature.parseMarkdown(text), missing: false }); return file; };
  const file = add(sourcePath, source);
  const choices = (query = "", key = "status", widget = "text", existing = []) => feature.propertyValueChoices(app, file, key, widget, existing, query);
  return { app, documents, files, sessions, config, file, add, choices };
}

test("Properties suggestions retain only same-exact-key strings from other known notes", () => {
  const f = fixture(); f.add("Other.md", '---\nstatus: [Completed, "Open again", 9, true, {a: b}]\nStatus: Wrong case\n---\n'); f.add("Second.md", '---\nstatus: Completed\n---\n');
  assert.deepEqual(f.choices().map(value => value.value), ["Completed", "Open again"]);
  assert.deepEqual(f.choices("case").map(value => value.value), []);
  assert.deepEqual(f.choices("", "status", "number"), []);
  assert.deepEqual(f.choices("x".repeat(257)), []);
  assert.equal(f.choices()[0].contributor.path, "Other.md");
});

test("literal queries and value labels preserve punctuation and Unicode without coercion", () => {
  const f = fixture(); f.add("Other.md", '---\nstatus: ["a.*[b] λ", "<img src=x>", "false", 1, false, null]\n---\n');
  assert.deepEqual(f.choices(".*[b]").map(value => value.value), ["a.*[b] λ"]);
  assert.deepEqual(f.choices("<img").map(value => value.value), ["<img src=x>"]);
  assert.deepEqual(f.choices("false").map(value => value.value), ["false"]);
});

test("list and tag choices omit exact existing entries and normalize only tag prefixes", () => {
  const f = fixture(); f.add("Other.md", '---\ntags: ["#shared", "#project", "bad tag", "123", "nested/tag"]\nlabels: [kept, Candidate, " spaced "]\n---\n');
  assert.deepEqual(f.choices("", "tags", "tags", ["shared"]).map(value => value.value), ["project", "nested/tag"]);
  assert.deepEqual(f.choices("#pro", "tags", "tags", ["#shared"]).map(value => value.value), ["project"]);
  assert.deepEqual(f.choices("", "labels", "multitext", ["kept"]).map(value => value.value), [" spaced ", "Candidate"]);
});

test("live dirty contributor text supersedes stale metadata while wrong-root and reloading sessions decline", () => {
  const f = fixture(), contributor = f.add("Other.md", '---\nstatus: Old\n---\n');
  f.sessions.set(contributor.path, { originRoot: "fixture", text: '---\nstatus: Dirty\n---\n', isReloading: false });
  assert.deepEqual(f.choices().map(value => value.value), ["Dirty"]);
  f.sessions.get(contributor.path).isReloading = true; assert.deepEqual(f.choices(), []);
  f.sessions.get(contributor.path).isReloading = false; f.sessions.get(contributor.path).originRoot = "other"; assert.deepEqual(f.choices(), []);
});

test("choice guards refuse changed contributor/source/root and recreated file identities", () => {
  const f = fixture(), contributor = f.add("Other.md", '---\nstatus: Completed\n---\n'), choice = f.choices("Com")[0];
  const current = () => feature.assertPropertyValueChoice(f.app, choice, "text", [], "Com"); current();
  assert.throws(() => feature.assertPropertyValueChoice(f.app, choice, "text", [], "Changed"), /changed/);
  f.sessions.set(contributor.path, { originRoot: "fixture", text: '---\nstatus: Completed\n---\nNew body\n' }); assert.throws(current, /changed/); f.sessions.clear();
  f.files.set(contributor.path, { ...contributor }); assert.throws(current, /changed/); f.files.set(contributor.path, contributor);
  f.sessions.set(f.file.path, { originRoot: "fixture", text: f.documents.get(f.file.path).text + "new source" }); assert.throws(current, /changed/); f.sessions.clear();
  assert.throws(() => feature.assertPropertyValueChoice(f.app, choice, "text", [], "Com", "different read after queue"), /changed/);
  f.app.vault.rootPath = "elsewhere"; assert.throws(current, /changed/);
});

test("read-only, disabled core, missing inventory and invalid YAML cannot populate choices", () => {
  const f = fixture(), contributor = f.add("Other.md", '---\nstatus: Completed\n---\n');
  f.app.vault.readOnly = true; assert.deepEqual(f.choices(), []); f.app.vault.readOnly = false;
  f.app.core.isEnabled = () => false; assert.deepEqual(f.choices(), []); f.app.core.isEnabled = () => true;
  f.documents.get(contributor.path).missing = true; assert.deepEqual(f.choices(), []); f.documents.get(contributor.path).missing = false;
  f.documents.get(contributor.path).cache = feature.parseMarkdown('---\nstatus: [unclosed\n---\n'); assert.deepEqual(f.choices(), []);
});

test("document, dirty-parse, value count/length and result limits bound enumeration", () => {
  const f = fixture();
  for (let index = 0; index < 2_000; index++) f.add(`Empty${index}.md`, "No frontmatter");
  f.add("TooLate.md", '---\nstatus: Not enumerated\n---\n'); assert.deepEqual(f.choices(), []);
  const g = fixture(); g.add("Many.md", '---\nstatus: [' + Array.from({ length: 2_100 }, (_, i) => '"v' + String(i).padStart(4, "0") + '"').join(", ") + ']\n---\n');
  assert.equal(g.choices().length, 40); assert.deepEqual(g.choices("v2099"), []);
  const h = fixture(); h.add("Long.md", '---\nstatus: ["' + "x".repeat(1_025) + '", short]\n---\n'); assert.deepEqual(h.choices().map(v => v.value), ["short"]);
  const i = fixture(), one = i.add("One.md", "cached"), two = i.add("Two.md", "cached");
  const long = '---\nstatus: First\n---\n' + "a".repeat(150_000); i.sessions.set(one.path, { originRoot: "fixture", text: long }); i.sessions.set(two.path, { originRoot: "fixture", text: long.replace("First", "Second") });
  assert.deepEqual(i.choices().map(v => v.value), ["First"]);
});

test("collection budgets reject huge cached strings before normalization and count invalid items", () => {
  const f = fixture(), source = f.add("Cached.md", "Already indexed source");
  const entry = f.documents.get(source.path);
  entry.cache = { errors: [], frontmatter: { tags: [" ".repeat(262_144) + "project", "project"] } };
  assert.deepEqual(f.choices("pro", "tags", "tags").map(value => value.value), ["project"], "an oversized value cannot be trimmed into an accepted tag");
  entry.cache.frontmatter.tags = [...Array(2_048).fill("x".repeat(1_025)), "project"];
  assert.deepEqual(f.choices("pro", "tags", "tags"), [], "invalid oversized strings still consume the inspected-item budget");
  entry.cache.frontmatter.tags = [...Array(64).fill("#" + "a".repeat(1_023)), "project"];
  assert.deepEqual(f.choices("pro", "tags", "tags"), [], "raw candidate characters are bounded before repeated normalization/Map work");
  entry.cache.frontmatter.tags = [...Array(63).fill("#" + "a".repeat(1_023)), "project"];
  assert.deepEqual(f.choices("pro", "tags", "tags").map(value => value.value), ["project"], "a later small candidate remains deterministic inside the aggregate budget");
});

test("explicit [[ chooses known note targets and aliases while ordinary same-key values remain literal", () => {
  const f = fixture(), target = f.add("Archive/Known target.md", '---\nAliases: [" Useful alias ", "<img src=x>", "bad|alias"]\nstatus: Completed\n---\n# Existing heading\n');
  const direct = f.choices("[[Known");
  assert.equal(direct.length, 1); assert.equal(direct[0].kind, "link"); assert.equal(direct[0].target, target); assert.equal(direct[0].value, "[[Known target]]");
  assert.equal(direct[0].targetText, f.documents.get(target.path).text);
  const alias = f.choices("[[Useful")[0]; assert.equal(alias.alias, "Useful alias"); assert.equal(alias.value, "[[Known target|Useful alias]]");
  assert.equal(f.choices("[[<img")[0].alias, "<img src=x>"); assert.deepEqual(f.choices("[[bad"), []);
  assert.equal(f.choices("Com")[0].kind, "value"); assert.equal(f.choices("Com")[0].contributor, target); assert.equal(f.choices("Com")[0].value, "Completed");
});

test("link choices decline unknown/new-note, mixed prose, subpaths and unsupported widgets", () => {
  const f = fixture(); f.add("Known target.md", "Known note\n");
  assert.deepEqual(f.choices("[[Does not exist"), []);
  for (const query of ["[[Known#Heading", "[[Known^block", "[[Known]", "[[Known\\path", "[[Known\n", "prefix [[Known"]) assert.deepEqual(f.choices(query), [], query);
  for (const widget of ["tags", "aliases", "number", "date", "datetime", "checkbox", "unknown"]) assert.deepEqual(f.choices("[[Known", "status", widget), [], widget);
  assert.equal(f.choices("[[Known target]]")[0].value, "[[Known target]]");
  f.app.vault.readOnly = true; assert.deepEqual(f.choices("[[Known"), []); f.app.vault.readOnly = false;
  f.app.workspace.isChangingLayout = true; assert.deepEqual(f.choices("[[Known"), []);
});

test("destination spelling honors shortest/relative/absolute and refuses an ambiguous roundtrip", () => {
  const f = fixture(undefined, "Notes/Source.md"), target = f.add("Archive/Known target.md", "Target\n");
  for (const [format, linktext] of [["shortest", "Known target"], ["relative", "../Archive/Known target"], ["absolute", "Archive/Known target"]]) {
    f.config.set("newLinkFormat", format); f.config.set("useMarkdownLinks", true);
    const value = f.choices("[[Known")[0]; assert.equal(value.linktext, linktext); assert.equal(value.value, "[[" + linktext + "]]");
    assert.equal(feature.resolveLink([...f.files.values()], value.linktext, f.file.path).file, target);
  }
  f.config.set("newLinkFormat", "unsupported"); assert.deepEqual(f.choices("[[Known"), []); f.config.delete("newLinkFormat");
  f.config.set("useMarkdownLinks", "invalid"); assert.deepEqual(f.choices("[[Known"), []); f.config.delete("useMarkdownLinks");
  const getConfig = f.app.vault.getConfig; f.app.vault.getConfig = () => { throw Error("Configuration unavailable"); }; assert.deepEqual(f.choices("[[Known"), []); f.app.vault.getConfig = getConfig;
  f.add("Other/Known target.md", "Another note\n");
  assert.deepEqual(f.choices("[[Known").map(value => value.value), ["[[Archive/Known target]]", "[[Other/Known target]]"]);
  f.add("archive/known target.md", "Case collision\n");
  assert.equal(f.choices("[[Known").some(value => value.target === target), false);
  f.app.metadataCache.resolveReference = () => ({ file: target, ambiguous: true }); assert.deepEqual(f.choices("[[Known"), []);
});

test("multitext avoids an existing target even under another supported wiki spelling or alias", () => {
  const f = fixture(); f.add("Folder/Known target.md", '---\naliases: [Friendly]\n---\n');
  assert.equal(f.choices("[[Friendly", "labels", "multitext", ["kept"])[0].value, "[[Known target|Friendly]]");
  for (const existing of ["[[Known target]]", "[[Folder/Known target|Previous alias]]"]) assert.deepEqual(f.choices("[[Friendly", "labels", "multitext", [existing]), []);
  assert.deepEqual(f.choices("[[Friendly", "labels", "multitext", ["x".repeat(1_025)]), []);
});

test("link guards bind destination preference, source, target identity and full dirty/external target text", () => {
  const f = fixture(), target = f.add("Folder/Known target.md", '---\naliases: [Cached alias]\n---\nBody.\n');
  const choice = f.choices("[[Cached")[0], check = () => feature.assertPropertyValueChoice(f.app, choice, "text", [], "[[Cached"); check();
  f.sessions.set(target.path, { originRoot: "fixture", text: f.documents.get(target.path).text.replace("Cached alias", "Dirty alias") });
  assert.deepEqual(f.choices("[[Cached"), []); const dirty = f.choices("[[Dirty")[0]; assert.equal(dirty.alias, "Dirty alias"); assert.throws(check, /changed/);
  feature.assertPropertyValueChoice(f.app, dirty, "text", [], "[[Dirty");
  f.sessions.get(target.path).text += "New body\n"; assert.throws(() => feature.assertPropertyValueChoice(f.app, dirty, "text", [], "[[Dirty"), /changed/);
  f.sessions.clear();
  const entry = f.documents.get(target.path); entry.text += "Observed external body\n"; assert.throws(check, /changed/); entry.text = choice.targetText;
  f.files.delete(target.path); assert.throws(check, /changed/); f.files.set(target.path, { ...target }); assert.throws(check, /changed/); f.files.set(target.path, target);
  entry.missing = true; assert.throws(check, /changed/); entry.missing = false;
  f.config.set("newLinkFormat", "absolute"); assert.throws(check, /changed/); f.config.delete("newLinkFormat");
  f.sessions.set(f.file.path, { originRoot: "fixture", text: choice.sourceText + "New source\n" }); assert.throws(check, /changed/); f.sessions.clear();
  assert.throws(() => feature.assertPropertyValueChoice(f.app, choice, "text", [], "[[Cached", choice.sourceText + "fresh read"), /changed/);
  check();
});

test("known-note enumeration bounds documents, full inventory, aliases and work before normalization", () => {
  const f = fixture(); for (let index = 0; index < 2_000; index++) f.add(`Note${index}.md`, "note"); f.add("Late known.md", "note"); assert.deepEqual(f.choices("[[Late known"), []);
  f.app.vault.getFiles = () => Array(10_001).fill(f.file); assert.deepEqual(f.choices("[[Source"), []);
  f.app.vault.getFiles = () => Array.from({ length: 300 }, (_, index) => ({ path: String(index) + "x".repeat(1_000) }));
  let resolverCalls = 0;
  f.app.metadataCache.fileToLinktext = f.app.metadataCache.resolveReference = () => { resolverCalls++; throw Error("Overflow must be rejected before resolver/Map work"); };
  assert.deepEqual(f.choices("[[Source"), [], "all inventory paths share a raw 256K budget before shared resolver normalization");
  assert.equal(resolverCalls, 0);
  const g = fixture(), target = g.add("Target.md", "cached"), entry = g.documents.get(target.path);
  entry.cache = { errors: [], frontmatter: { aliases: [" ".repeat(262_144) + "Needle", "Needle"] } };
  assert.equal(g.choices("[[Needle")[0].alias, "Needle", "huge cached strings cannot be trimmed into accepted aliases");
  entry.cache.frontmatter.aliases = [...Array(32).fill("invalid|alias"), "Needle"]; assert.deepEqual(g.choices("[[Needle"), [], "only 32 raw aliases per note are inspected");
  const h = fixture(); for (let index = 0; index < 64; index++) { const file = h.add(`Note${index}.md`, "cached"); h.documents.get(file.path).cache = { errors: [], frontmatter: { aliases: Array(32).fill("x".repeat(1_025)) } }; }
  h.add("Late.md", '---\naliases: [Needle]\n---\n'); assert.deepEqual(h.choices("[[Needle"), [], "invalid oversized aliases still consume the global raw-alias budget");
  const i = fixture(); for (let index = 0; index < 2; index++) { const file = i.add(`Long${index}.md`, "cached"); i.documents.get(file.path).cache = { errors: [], frontmatter: { aliases: Array(32).fill("a".repeat(1_024)) } }; }
  i.add("Later.md", '---\naliases: [Needle]\n---\n'); assert.deepEqual(i.choices("[[Needle"), [], "raw aliases and paths share a 64K preprocessing budget");
  const j = fixture(); for (let index = 0; index < 60; index++) j.add(`Known${index}.md`, "note"); assert.equal(j.choices("[[Known").length, 40);
});

test("known-note values use the existing safe YAML serializer while retaining exact surrounding source", () => {
  const original = '\ufeff---\r\n# Keep comment\r\nstatus: Open # keep inline\r\nlabels: [ kept ]\r\ncount: 1.50\r\nnested: { retain: opaque }\r\n---\r\nBody 😀 λ.\r\n';
  const f = fixture(original); f.add("Known target.md", '---\naliases: [Friendly]\n---\n');
  const value = f.choices("[[Friendly")[0].value;
  const scalar = feature.updateFrontmatter(original, values => { values.status = value; });
  assert.equal(scalar, original.replace("status: Open #", 'status: "[[Known target|Friendly]]" #'));
  const list = feature.updateFrontmatter(original, values => { values.labels.push(value); });
  assert.equal(list, original.replace("labels: [ kept ]", 'labels: [ kept, "[[Known target|Friendly]]" ]'));
  assert.equal(feature.parseMarkdown(scalar).frontmatter.status, value); assert.equal(feature.parseMarkdown(list).frontmatter.labels[1], value);
});

const subpathTarget = '---\r\naliases: ["Friendly destination"]\r\n---\r\n# Parent λ\r\n\r\n## Child Ω\r\n\r\nFirst addressable paragraph. ^known-block\r\n\r\n# Sibling\r\n\r\n## Child Ω\r\n\r\nOther addressable paragraph. ^other-block\r\n';

test("Properties offers existing heading, block and explicit current-note subpaths as whole wiki values", () => {
  const f = fixture('---\nstatus: Open\n---\n# Local Ω\n\nLocal paragraph. ^local-block\n'), target = f.add("Folder/Known target.md", subpathTarget);
  for (const [query, expected, kind] of [["[[Known target#Pa", "[[Known target#Parent λ]]", "heading"], ["[[Known target#^known", "[[Known target#^known-block]]", "block"], ["[[#Loc", "[[#Local Ω]]", "heading"], ["[[#^local", "[[#^local-block]]", "block"]]) {
    const selected = f.choices(query)[0]; assert.equal(selected.kind, "subpath"); assert.equal(selected.subpathKind, kind); assert.equal(selected.value, expected);
    const cache = feature.parseMarkdown(selected.targetText), resolved = feature.resolveSubpath(cache, selected.subpath);
    assert.equal(resolved.type, kind); assert.equal(resolved.start.offset, selected.from); assert.equal(resolved.end.offset, selected.to);
    assert.equal(selected.target, query.startsWith("[[#") ? f.file : target); feature.assertPropertyValueChoice(f.app, selected, "text", [], query);
  }
  assert.equal(f.choices("[[Known target#Parent λ]]")[0].value, "[[Known target#Parent λ]]");
  assert.deepEqual(f.choices("[[Known target#Not created"), []); assert.deepEqual(f.choices("[[Known target#^new-id"), []);
  for (const widget of ["tags", "aliases", "date", "number", "unknown"]) assert.deepEqual(f.choices("[[Known target#Pa", "status", widget), []);
});

test("hierarchical heading paths prove canonical ancestry and first normalized duplicates", () => {
  const f = fixture(), target = f.add("Known target.md", subpathTarget);
  const direct = f.choices("[[Known target#Child"); assert.equal(direct.length, 1); assert.equal(direct[0].from, subpathTarget.indexOf("## Child Ω"));
  const nested = f.choices("[[Known target#Parent λ#Ch"); assert.equal(nested.length, 1); assert.equal(nested[0].value, "[[Known target#Parent λ#Child Ω]]"); assert.equal(nested[0].from, direct[0].from);
  const sibling = f.choices("[[Known target#Sibling#Ch")[0]; assert.equal(sibling.value, "[[Known target#Sibling#Child Ω]]"); assert.ok(sibling.from > direct[0].from);
  assert.deepEqual(f.choices("[[Known target#Missing#Ch"), []);
  const text = subpathTarget + "\r\n# Parent λ#Child Ω\r\n"; f.documents.set(target.path, { ...f.documents.get(target.path), text, cache: feature.parseMarkdown(text) });
  assert.deepEqual(f.choices("[[Known target#Parent λ#Ch"), [], "a literal whole heading shadowing the chain is never reinterpreted as another position");
});

test("subpaths preserve destination preferences, unique alias proof and ambiguity refusal", () => {
  const f = fixture(undefined, "Notes/Source.md"), target = f.add("Folder/Known target.md", subpathTarget);
  for (const [format, path] of [["shortest", "Known target"], ["relative", "../Folder/Known target"], ["absolute", "Folder/Known target"]]) {
    f.config.set("newLinkFormat", format); f.config.set("useMarkdownLinks", true);
    const selected = f.choices("[[Known target#^known")[0]; assert.equal(selected.value, "[[" + path + "#^known-block]]"); assert.equal(feature.resolveLink([...f.files.values()], path, f.file.path).file, target);
    const alias = f.choices("[[Friendly destination#Pa")[0]; assert.equal(alias.value, "[[" + path + "#Parent λ|Friendly destination]]"); assert.equal(alias.alias, "Friendly destination");
  }
  f.add("Other/Alias twin.md", '---\naliases: ["Friendly destination"]\n---\n# Parent λ\n'); assert.deepEqual(f.choices("[[Friendly destination#Pa"), [], "an exact alias shared by notes is ambiguous");
  f.add("Other/Known target.md", subpathTarget); assert.deepEqual(f.choices("[[Known target#Pa"), [], "ambiguous basename target is not guessed");
  assert.equal(f.choices("[[Folder/Known target#Pa")[0].target, target);
});

test("exact subpath aliases refuse duplicate candidates hidden beyond the complete document budget", () => {
  const f = fixture(); f.add("Early.md", '---\naliases: ["Same alias"]\n---\n# Parent\n');
  for (let index = 0; index < 1_998; index++) f.add(`Empty${index}.md`, "Cached body\n");
  f.add("Late.md", '---\naliases: ["Same alias"]\n---\n# Parent\n');
  let spellingCalls = 0, resolutionCalls = 0; const spell = f.app.metadataCache.fileToLinktext, resolve = f.app.metadataCache.resolveReference; f.app.metadataCache.fileToLinktext = (...args) => { spellingCalls++; return spell(...args); }; f.app.metadataCache.resolveReference = (...args) => { resolutionCalls++; return resolve(...args); };
  assert.deepEqual(f.choices("[[Same alias#Pa"), []); assert.equal(spellingCalls, 0, "an incomplete alias scan cannot enter final spelling/position proofs"); assert.equal(resolutionCalls, 1, "only the initial direct-path lookup runs before the failed complete alias proof");
  assert.equal(f.choices("[[Early#Pa")[0].value, "[[Early#Parent]]", "known explicit paths remain usable outside alias enumeration");
  assert.equal(f.choices("[[Same alias").filter(choice => choice.alias === "Same alias").length, 1, "ordinary ranked note/alias mode keeps its partial collector contract");
});

test("exact alias proofs refuse per-note/global alias truncation and preprocessing overflow", () => {
  for (const mode of ["per-note", "global", "characters", "length", "keys"]) {
    const f = fixture(); f.add("Early.md", '---\naliases: ["Same alias"]\n---\n# Parent\n');
    if (mode === "per-note") { const file = f.add("Late.md", "Cached body\n"); f.documents.get(file.path).cache.frontmatter = { aliases: [...Array(32).fill("other"), "Same alias"] }; }
    if (mode === "global") { for (let index = 0; index < 64; index++) { const file = f.add(`Other${index}.md`, "Cached body\n"); f.documents.get(file.path).cache.frontmatter = { aliases: Array(32).fill("other") }; } f.add("Late.md", '---\naliases: ["Same alias"]\n---\n# Parent\n'); }
    if (mode === "characters") { for (let index = 0; index < 2; index++) { const file = f.add(`Other${index}.md`, "Cached body\n"); f.documents.get(file.path).cache.frontmatter = { aliases: Array(32).fill("x".repeat(1_024)) }; } f.add("Late.md", '---\naliases: ["Same alias"]\n---\n# Parent\n'); }
    if (mode === "length") { const file = f.add("Unknown.md", "Cached body\n"); f.documents.get(file.path).cache.frontmatter = { aliases: [" ".repeat(1_025) + "Same alias"] }; }
    if (mode === "keys") { const file = f.add("Late.md", "Cached body\n"); f.documents.get(file.path).cache.frontmatter = { ...Object.fromEntries(Array.from({ length: 2_048 }, (_, i) => ["key" + i, "value"])), aliases: ["Same alias"] }; }
    let spellings = 0, resolutions = 0; const resolve = f.app.metadataCache.resolveReference; f.app.metadataCache.resolveReference = (...args) => { resolutions++; return resolve(...args); }; f.app.metadataCache.fileToLinktext = () => { spellings++; throw Error("Incomplete alias proofs cannot spell a candidate"); };
    assert.deepEqual(f.choices("[[Same alias#Pa"), [], mode); assert.equal(spellings, 0, mode); assert.equal(resolutions, 1, mode + " never resolves after the incomplete proof");
  }
});

test("exact alias proof declines unknown/current or unparsed dirty note snapshots without hiding a duplicate", () => {
  for (const mode of ["missing-entry", "reloading", "wrong-root", "oversized", "dirty-budget"]) {
    const f = fixture(); f.add("Early.md", '---\naliases: ["Same alias"]\n---\n# Parent\n');
    const unknown = f.add("Unknown.md", "Cached body\n");
    if (mode === "missing-entry") f.documents.delete(unknown.path);
    if (mode === "reloading") f.sessions.set(unknown.path, { originRoot: "fixture", isReloading: true, text: "Cached body\n" });
    if (mode === "wrong-root") f.sessions.set(unknown.path, { originRoot: "elsewhere", text: "Cached body\n" });
    if (mode === "oversized") f.sessions.set(unknown.path, { originRoot: "fixture", text: "x".repeat(262_145) });
    if (mode === "dirty-budget") { f.sessions.set(unknown.path, { originRoot: "fixture", text: "Body\n" + "x".repeat(150_000) }); const late = f.add("Late.md", "Cached body\n"); f.sessions.set(late.path, { originRoot: "fixture", text: '---\naliases: ["Same alias"]\n---\n# Parent\n' + "x".repeat(150_000) }); }
    let spellingCalls = 0; f.app.metadataCache.fileToLinktext = () => { spellingCalls++; throw Error("An unknown alias inventory cannot enter spelling proof"); };
    assert.deepEqual(f.choices("[[Same alias#Pa"), [], mode); assert.equal(spellingCalls, 0, mode);
  }
});

test("subpath list duplicates exclude the resolved section while retaining different sections and whole-note links", () => {
  const f = fixture(); f.add("Folder/Known target.md", subpathTarget);
  const choices = existing => f.choices("[[Known target#Pa", "labels", "multitext", existing);
  assert.equal(choices(["[[Known target]]"]).length, 1); assert.equal(choices(["[[Known target#Sibling]]"]).length, 1);
  assert.deepEqual(choices(["[[Folder/Known target#parent λ|old display]]"]), []);
  assert.equal(f.choices("[[Known target#^known", "labels", "multitext", ["[[Known target#Parent λ]]"]).length, 1);
  assert.deepEqual(f.choices("[[Known target#^known", "labels", "multitext", ["[[Folder/Known target#^known-block]]"]), []);
});

test("subpath guards refuse dirty/external removal, target recreation, source/prefs and changed positions", () => {
  const f = fixture(), target = f.add("Folder/Known target.md", subpathTarget), selected = f.choices("[[Known target#Pa")[0];
  const check = () => feature.assertPropertyValueChoice(f.app, selected, "text", [], "[[Known target#Pa"); check();
  f.sessions.set(target.path, { originRoot: "fixture", text: subpathTarget.replace("# Parent λ", "# Dirty parent") }); assert.ok(f.choices("[[Known target#Pa").every(choice => choice.subpath !== "#Parent λ")); assert.equal(f.choices("[[Known target#Dirty")[0].subpath, "#Dirty parent"); assert.throws(check, /changed/);
  f.sessions.get(target.path).isReloading = true; assert.deepEqual(f.choices("[[Known target#Dirty"), []); f.sessions.clear();
  const entry = f.documents.get(target.path); entry.text = "New body\r\n" + subpathTarget; entry.cache = feature.parseMarkdown(entry.text); assert.throws(check, /changed/); entry.text = subpathTarget; entry.cache = feature.parseMarkdown(subpathTarget);
  f.files.delete(target.path); assert.throws(check, /changed/); f.files.set(target.path, { ...target }); assert.throws(check, /changed/); f.files.set(target.path, target);
  f.config.set("newLinkFormat", "absolute"); assert.throws(check, /changed/); f.config.delete("newLinkFormat");
  f.sessions.set(f.file.path, { originRoot: "fixture", text: selected.sourceText + "Source edit" }); assert.throws(check, /changed/); f.sessions.clear();
  assert.throws(() => feature.assertPropertyValueChoice(f.app, { ...selected, from: selected.from + 1 }, "text", [], "[[Known target#Pa"), /changed/);
  const alias = f.choices("[[Friendly destination#Pa")[0]; f.sessions.set(target.path, { originRoot: "fixture", text: subpathTarget.replace("Friendly destination", "Other alias") }); assert.throws(() => feature.assertPropertyValueChoice(f.app, alias, "text", [], "[[Friendly destination#Pa"), /changed/);
});

test("immutable source and target path snapshots revoke section choices even when moved identities/text survive", () => {
  for (const kind of ["source", "target"]) {
    const f = fixture(), target = f.add("Folder/Known target.md", subpathTarget), choice = f.choices("[[Known target#Pa")[0];
    const moved = kind === "source" ? f.file : target, prior = moved.path, next = "Moved/" + prior;
    f.files.delete(prior); f.files.set(next, moved); const entry = f.documents.get(prior); f.documents.delete(prior); f.documents.set(next, { ...entry, document: { file: { path: next } } }); moved.path = next;
    assert.equal(choice.target, target, "the same mutable TFile identity survived the move");
    assert.throws(() => feature.assertPropertyValueChoice(f.app, choice, "text", [], "[[Known target#Pa"), /changed/);
  }
});

test("subpath preprocessing refuses complete cached inventories before unbounded name normalization", () => {
  const f = fixture(), target = f.add("Known target.md", subpathTarget), entry = f.documents.get(target.path), original = entry.cache;
  for (const cache of [
    { ...original, headings: Array(2_049).fill(original.headings[0]) },
    { ...original, headings: [{ ...original.headings[0], heading: "x".repeat(262_144) }] },
    { ...original, headings: Array.from({ length: 65 }, () => ({ ...original.headings[0], heading: "x".repeat(1_024) })) },
    { ...original, blocks: { ["x".repeat(1_025)]: original.blocks["known-block"] } }
  ]) { entry.cache = cache; assert.deepEqual(f.choices("[[Known target#"), []); }
  entry.cache = original; f.app.vault.getFiles = () => Array.from({ length: 300 }, (_, i) => ({ path: i + "x".repeat(1_000) }));
  let reads = 0; f.app.metadataCache.resolveReference = () => { reads++; throw Error("Should not resolve overflow"); }; assert.deepEqual(f.choices("[[Known target#Pa"), []); assert.equal(reads, 0);
  const g = fixture(); g.add("Known target.md", "# Parent\n" + "x".repeat(262_144)); assert.deepEqual(g.choices("[[Known target#Pa"), []);
  assert.deepEqual(g.choices("[[Known target#" + "x".repeat(257)), []);
});

test("aggregate semantic subpath proofs stop before repeated complete-cache normalization exceeds budget", () => {
  const f = fixture(), target = f.add("Known target.md", "# Needle\n"), entry = f.documents.get(target.path), first = entry.cache.headings[0];
  let proofCalls = 0;
  const headings = [first, ...Array.from({ length: 63 }, () => ({ ...first, heading: "x".repeat(1_024) }))];
  entry.cache.headings = new Proxy(headings, { get(array, key) { if (key === "find") return function(...args) { proofCalls++; return Array.prototype.find.apply(array, args); }; return Reflect.get(array, key); } });
  const existing = Array.from({ length: 5 }, (_, i) => `[[Known target#Needle|alias ${i}]]`);
  assert.deepEqual(f.choices("[[Known target#Need", "labels", "multitext", existing), []);
  assert.equal(proofCalls, 4, "a fifth 64K complete-cache proof is refused before entering the resolver");
});

test("subpath values retain safe YAML/comments/BOM/CRLF and distinct plain UI destination context", () => {
  const original = '\ufeff---\r\nstatus: Open # retain\r\nlabels: [ kept ]\r\ncount: 1.50\r\nnested: { opaque: retained }\r\n---\r\nBody 😀.\r\n';
  const f = fixture(original), target = f.add("Known target.md", subpathTarget), selected = f.choices("[[Known target#Parent λ#Ch")[0];
  const changed = feature.updateFrontmatter(original, values => { values.status = selected.value; }); assert.equal(changed, original.replace("status: Open #", 'status: "[[Known target#Parent λ#Child Ω]]" #'));
  const ui = uiFixture({ choices: () => [selected] }); ui.input.value = selected.query; ui.input.fire("input"); const row = ui.list.children[0];
  assert.equal(row.dataset.propertySubpath, "#Parent λ#Child Ω"); assert.equal(row.dataset.propertySubpathKind, "heading"); assert.equal(row.dataset.propertyLinkTarget, target.path); assert.equal(row.children[0].textContent, "Known target.md#Parent λ#Child Ω"); assert.ok(row.title.includes(selected.value));
  ui.controller.dispose();
});

function fakeDom() {
  const document = { defaultView: { AbortController }, activeElement: null, createElement: tag => new Element(tag) };
  class Element {
    constructor(tag = "div") { this.tagName = tag; this.ownerDocument = document; this.children = []; this.children.item = index => this.children[index] ?? null; this.parentElement = null; this.dataset = {}; this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.value = ""; this.disabled = false; this.readOnly = false; this.hidden = false; this.connected = false; this.classList = { toggle() {} }; }
    get isConnected() { return this.connected || Boolean(this.parentElement?.isConnected); }
    contains(element) { for (let node = element; node; node = node.parentElement) if (node === this) return true; return false; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    insertBefore(child, present) { if (child.isConnected && child.contains(document.activeElement)) { document.activeElement = null; document.focusedNodeMoves = (document.focusedNodeMoves ?? 0) + 1; } child.remove(); const index = this.children.indexOf(present); child.parentElement = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    remove() { if (this.parentElement) { const index = this.parentElement.children.indexOf(this); if (index >= 0) this.parentElement.children.splice(index, 1); } this.parentElement = null; }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children.splice(0); this.append(...children); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector === "[data-property-key]" && "propertyKey" in node.dataset) return node; return null; }
    querySelector(selector) { const direct = selector.startsWith(":scope > "); if (direct) selector = selector.slice(9); const match = node => selector.startsWith(".") ? node.className === selector.slice(1) : selector.startsWith("input") ? node.tagName === "input" && (!selector.includes("aria-label") || node.getAttribute("aria-label") === /^input\[aria-label="(.*)"\]$/.exec(selector)?.[1]) : selector === "[data-metadata-input]" && "metadataInput" in node.dataset; for (const child of this.children) { if (match(child)) return child; if (!direct) { const nested = child.querySelector(selector); if (nested) return nested; } } return null; }
    querySelectorAll(selector) { const found = []; const visit = node => { for (const child of node.children) { if (selector.split(",").includes(child.tagName)) found.push(child); visit(child); } }; visit(this); return found; }
    addEventListener(type, listener, options = {}) { const list = this.listeners.get(type) ?? []; const record = { listener, options }; list.push(record); this.listeners.set(type, list); options.signal?.addEventListener("abort", () => { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== record)); }); }
    fire(type, patch = {}) { const event = { target: this, defaultPrevented: false, immediate: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.immediate = true; }, ...patch }; for (const { listener } of [...this.listeners.get(type) ?? []].sort((a, b) => Number(Boolean(b.options.capture)) - Number(Boolean(a.options.capture)))) { listener(event); if (event.immediate) break; } return event; }
    focus() { document.activeElement = this; this.fire("focus"); }
    scrollIntoView() {}
  }
  const input = new Element("input"), container = new Element(); container.connected = true; container.append(input);
  return { input, container, document };
}

test("the actual MetadataEditor consumes an accepted draft after Undo overtakes asynchronous completion", async () => {
  const f = fakeDom(), globals = Object.fromEntries(["document", "HTMLInputElement", "CSS", "propertiesCompletionRowFactory"].map(key => [key, globalThis[key]]));
  globalThis.document = f.document; globalThis.HTMLInputElement = f.input.constructor; globalThis.CSS = { escape: value => value };
  const values = { status: "Open" }, file = { path: "Source.md" }, changes = [];
  const properties = { app: { vault: { readOnly: false, getFileByPath: () => file }, core: { isEnabled: () => true, busy: false }, metadataTypeManager: { getAssignedWidget: () => "text" } }, busy: false, values: () => values, numerics: () => new Map() };
  const makeRow = (owner, target, key, value) => {
    const containerEl = f.document.createElement("div"), valueEl = f.document.createElement("div"), input = f.document.createElement("input");
    containerEl.dataset.propertyKey = key; containerEl.dataset.readOnly = "false"; valueEl.dataset.propertyType = "text"; input.dataset.metadataInput = ""; input.setAttribute("aria-label", "Property status"); input.value = value; valueEl.append(input); containerEl.append(valueEl);
    input.addEventListener("blur", () => { if (input.value !== value && containerEl.isConnected) changes.push(input.value); });
    return { entry: { key, value }, containerEl, valueEl };
  };
  globalThis.propertiesCompletionRowFactory = makeRow;
  try {
    const editor = Object.assign(Object.create(MetadataEditor.prototype), { properties, getFile: () => file, options: {}, contentEl: f.container, rendered: [], addPropertyButtonEl: f.document.createElement("button"), file, values: { ...values } });
    const old = makeRow(properties, file, "status", "Open"); editor.rendered.push(old); f.container.replaceChildren(old.containerEl); f.container.children.item = index => f.container.children[index] ?? null;
    const field = old.valueEl.querySelector("input"); field.value = "Com"; field.focus();
    let finish; const pending = new Promise(resolve => { finish = resolve; }).then(() => editor.render(true, "status"));
    values.status = "Completed λ"; editor.render(); values.status = "Open"; editor.render();
    assert.equal(editor.rendered[0], old, "an unconsumed focused draft remains independent while Source changes");
    finish(); await pending;
    const fresh = editor.rendered[0].valueEl.querySelector("input");
    assert.notEqual(editor.rendered[0], old, "accepted completion must consume the row even after Undo restored its original value");
    assert.equal(fresh.value, "Open"); assert.equal(field.isConnected, false);
    fresh.fire("blur"); field.fire("blur"); assert.deepEqual(changes, [], "a later real blur cannot write the already-consumed suggestion prefix");
  } finally { for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test("the actual MetadataEditor replaces an earlier row without moving or blurring a later focused draft", () => {
  const f = fakeDom(), globals = Object.fromEntries(["document", "HTMLInputElement", "CSS", "propertiesCompletionRowFactory"].map(key => [key, globalThis[key]]));
  globalThis.document = f.document; globalThis.HTMLInputElement = f.input.constructor; globalThis.CSS = { escape: value => value };
  const file = { path: "Source.md" }, values = { tags: "shared", aliases: "Existing" };
  const properties = { app: { vault: { readOnly: false, getFileByPath: () => file }, core: { isEnabled: () => true, busy: false }, metadataTypeManager: { getAssignedWidget: () => "text" } }, busy: false, values: () => values, numerics: () => new Map() };
  const makeRow = (owner, target, key, value) => {
    const containerEl = f.document.createElement("div"), valueEl = f.document.createElement("div"), input = f.document.createElement("input");
    containerEl.dataset.propertyKey = key; containerEl.dataset.readOnly = "false"; valueEl.dataset.propertyType = "text"; input.dataset.metadataInput = ""; input.setAttribute("aria-label", "Property " + key); input.value = value; valueEl.append(input); containerEl.append(valueEl);
    return { entry: { key, value }, containerEl, valueEl };
  };
  globalThis.propertiesCompletionRowFactory = makeRow;
  try {
    const editor = Object.assign(Object.create(MetadataEditor.prototype), { properties, getFile: () => file, options: {}, contentEl: f.container, rendered: [], addPropertyButtonEl: f.document.createElement("button"), file, values: null });
    f.container.replaceChildren(); editor.render();
    const oldTags = editor.rendered[0], aliases = editor.rendered[1], field = aliases.valueEl.querySelector("input"); field.value = "Useful"; field.focus();
    values.tags = "shared, project"; editor.render(true, "tags");
    assert.notEqual(editor.rendered[0], oldTags); assert.equal(oldTags.containerEl.isConnected, false);
    assert.equal(editor.rendered[1], aliases); assert.equal(field.value, "Useful");
    assert.equal(f.document.focusedNodeMoves ?? 0, 0, "refreshing tags must not unnecessarily move the unchanged focused aliases row");
    assert.equal(f.document.activeElement, field, "a valid adjacent queued choice keeps the same focused input and ownership generation");
  } finally { for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
function uiFixture(overrides = {}) {
  const dom = fakeDom(), calls = [], errors = [], value = { value: "Completed" }; let current = true;
  const options = { ...dom, current: () => current, choices: query => query === "none" ? [] : [value], accept: async (choice, query, guard) => { calls.push({ choice, query, guard }); return true; }, error: message => errors.push(message), ...overrides };
  const controller = new feature.PropertyValueSuggestions(options), list = dom.container.children[1];
  return { ...dom, controller, list, calls, errors, value, current: on => { current = on; } };
}

test("the actual Properties row consumes a same-value link choice before a later blur", async () => {
  const source = '---\nstatus: "[[Known target]]" # retain\n---\nBody\n', model = fixture(source); model.add("Known target.md", "Target\n");
  const f = fakeDom(), globals = Object.fromEntries(["document", "HTMLInputElement"].map(key => [key, globalThis[key]]));
  globalThis.document = f.document; globalThis.HTMLInputElement = f.input.constructor;
  model.app.metadataTypeManager = { getAssignedWidget: () => "text" }; model.app.core.run = action => Promise.resolve().then(action);
  let row, refreshed = 0; const writes = [];
  const properties = { app: model.app, changeValue: async (_file, _key, prior, next, _widget, guard) => { writes.push({ prior, next }); guard(source); assert.equal(next, prior); } };
  const render = () => {
    row?.cleanup?.(); row?.containerEl.remove();
    row = inlinePropertyRow(properties, model.file, "status", "[[Known target]]", () => { refreshed++; render(); }, () => true); f.container.append(row.containerEl);
  };
  try {
    f.container.replaceChildren(); render();
    const field = row.valueEl.querySelector("input"); field.value = "[[Known"; field.fire("input"); field.fire("keydown", { key: "ArrowDown" }); field.fire("keydown", { key: "Enter" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshed, 1, "an unchanged suggestion still completes its guarded row lifecycle"); assert.deepEqual(writes, [{ prior: "[[Known target]]", next: "[[Known target]]" }]);
    const fresh = row.valueEl.querySelector("input"); assert.notEqual(fresh, field); assert.equal(fresh.value, "[[Known target]]"); assert.equal(field.isConnected, false);
    field.fire("blur"); fresh.fire("blur"); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes.length, 1, "neither consumed old query nor fresh full value saves a second literal prefix");
  } finally { row?.cleanup?.(); for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test("known-note rows expose plain target/alias context and retain keyboard/pointer owner guards", async () => {
  const model = fixture(), target = model.add("Folder/Known target.md", '---\naliases: ["<img src=x>"]\n---\n'), link = model.choices("[[<img")[0];
  const f = uiFixture({ choices: () => [link] }); f.input.value = "[[<img"; f.input.fire("input");
  const row = f.list.children[0]; assert.equal(row.dataset.propertyValueChoice, "[[Known target|<img src=x>]]"); assert.equal(row.dataset.propertyLinkTarget, target.path); assert.equal(row.dataset.propertyLinkAlias, "<img src=x>");
  assert.equal(row.textContent, link.value); assert.equal(row.children[0].textContent, "Alias <img src=x> → Folder/Known target.md"); assert.equal(row.title, "Alias <img src=x> → Folder/Known target.md\n[[Known target|<img src=x>]]");
  assert.equal(row.children.some(child => child.tagName === "img"), false);
  f.input.fire("keydown", { key: "ArrowDown" }); f.input.fire("keydown", { key: "Tab" }); await Promise.resolve(); assert.equal(f.calls[0].choice, link);
  row.fire("click"); assert.equal(f.calls.length, 1);
});

test("a selected link revalidates its owner and full target after a queued asynchronous boundary", async () => {
  for (const revoke of [f => f.current(false), f => { f.input.value = "[[changed"; }, (_f, model, target) => { model.sessions.set(target.path, { originRoot: "fixture", text: model.documents.get(target.path).text + "Changed body\n" }); }]) {
    const model = fixture(), target = model.add("Known target.md", "Target\n"), link = model.choices("[[Known")[0];
    let release, applied = false; const queued = new Promise(resolve => { release = resolve; });
    const f = uiFixture({ choices: () => [link], accept: async (choice, query, current) => { assert.equal(current(), true); feature.assertPropertyValueChoice(model.app, choice, "text", [], query); await queued; if (!current()) throw Error("Owner changed"); feature.assertPropertyValueChoice(model.app, choice, "text", [], query); applied = true; return true; } });
    f.input.value = "[[Known"; f.input.fire("input"); f.list.children[0].fire("click"); revoke(f, model, target); release();
    await Promise.resolve(); await Promise.resolve(); assert.equal(applied, false); assert.equal(f.errors.length, 1);
  }
});

test("keyboard navigation owns Enter before the ordinary property's literal-save listener", async () => {
  const f = uiFixture(); let ordinarySaves = 0;
  f.input.addEventListener("keydown", event => { if (event.key === "Enter") ordinarySaves++; });
  f.input.value = "Com"; f.input.fire("input"); assert.equal(f.controller.isOpen, true);
  assert.equal(f.input.fire("keydown", { key: "ArrowDown" }).defaultPrevented, true);
  assert.equal(f.input.fire("keydown", { key: "Enter" }).defaultPrevented, true); await Promise.resolve();
  assert.equal(ordinarySaves, 0); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].query, "Com"); assert.equal(f.controller.isOpen, false);
});

test("pointer acceptance suppresses prefix blur commits and a retained detached row cannot select twice", async () => {
  let resolve, accepted;
  const f = uiFixture({ accept: (choice, query, guard) => { accepted = guard; return new Promise(done => { resolve = done; }); } });
  f.input.value = "Com"; f.input.fire("input"); const row = f.list.children[0];
  assert.equal(row.fire("pointerdown").defaultPrevented, true); assert.equal(row.fire("mousedown").defaultPrevented, true);
  row.fire("click"); assert.equal(f.controller.suppressBlurCommit, true); assert.equal(accepted(), true);
  f.input.readOnly = true; assert.equal(accepted(), true, "own pending write may temporarily lock its input");
  row.fire("click"); f.input.fire("blur"); assert.equal(accepted(), false, "closing the surface revokes a queued candidate");
  resolve(true); await Promise.resolve(); await Promise.resolve(); assert.equal(f.controller.suppressBlurCommit, false);
});

test("changed query, detached container and obsolete lists revoke captured pointer choices", async () => {
  for (const change of [f => { f.input.value = "new query"; }, f => f.current(false), f => { f.container.connected = false; }, f => { f.input.ownerDocument = {}; }, f => f.controller.dispose()]) {
    const f = uiFixture(); f.input.value = "Com"; f.input.fire("input"); const old = f.list.children[0]; change(f); old.fire("click"); await Promise.resolve(); assert.equal(f.calls.length, 0);
  }
  const f = uiFixture(); f.input.value = "Com"; f.input.fire("input"); const old = f.list.children[0]; f.input.value = "other"; f.input.fire("input"); old.fire("click"); assert.equal(f.calls.length, 0);
});

test("independently removed or reparented options and lists cannot dispatch pointer or keyboard acceptance", async () => {
  for (const detach of [f => f.list.children[0].remove(), f => f.list.remove(), f => { const sibling = f.document.createElement("div"); sibling.connected = true; f.list.remove(); sibling.append(f.list); }]) {
    const f = uiFixture(); f.input.value = "Com"; f.input.fire("input"); const held = f.list.children[0];
    f.input.fire("keydown", { key: "ArrowDown" }); detach(f); held.fire("click");
    f.input.fire("keydown", { key: "Enter" }); f.input.fire("keydown", { key: "Tab" }); await Promise.resolve();
    assert.equal(f.calls.length, 0);
  }
});

test("composition keys, empty selection, Escape and disabled/read-only fields never select implicitly", async () => {
  const f = uiFixture(); f.input.value = "Com"; f.input.fire("input"); f.input.fire("keydown", { key: "Enter" }); assert.equal(f.calls.length, 0);
  f.input.fire("keydown", { key: "ArrowDown", isComposing: true }); f.input.fire("keydown", { key: "Tab" }); assert.equal(f.calls.length, 0);
  f.input.fire("compositionstart"); assert.equal(f.controller.isOpen, false); f.input.fire("compositionend"); assert.equal(f.controller.isOpen, false);
  f.input.fire("input"); assert.equal(f.input.fire("keydown", { key: "Escape" }).defaultPrevented, true); assert.equal(f.controller.isOpen, false);
  f.input.disabled = true; f.input.fire("input"); assert.equal(f.controller.isOpen, false); f.input.disabled = false; f.input.readOnly = true; f.input.fire("input"); assert.equal(f.controller.isOpen, false);
  await Promise.resolve(); assert.equal(f.calls.length, 0);
});

test("dispose aborts input subscriptions and rejected choices report errors without reviving the list", async () => {
  const f = uiFixture({ accept: async () => { throw new Error("Stale contributor"); } }); f.input.value = "Com"; f.input.fire("input"); f.list.children[0].fire("click"); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.errors, ["Stale contributor"]); assert.equal(f.controller.isOpen, false);
  f.controller.dispose(); f.input.fire("input"); assert.equal(f.controller.isOpen, false); assert.equal(f.container.children.length, 1);
});
