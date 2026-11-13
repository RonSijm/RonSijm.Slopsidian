import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { parseDocument } from "yaml";
import { MutationLock } from "../client/editor-barrier.ts";
import { errorLogStub } from "./error-log-stub.mjs";
import { checkHeadingChainsReadOnly, headingChainsReadOnlyFixture } from "../tools/heading-chain-scenarios.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, model, BuiltinEditorSuggestions, EditorSuggestions, EditorSuggest, Editor;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "builtin-suggestions-tests-"));
  const output = join(directory, "completion.mjs");
  await build({ stdin: { contents: 'export * from "./client/builtin-suggestion-model"; export { propertyValueChoices, assertPropertyValueChoice } from "./client/property-value-suggestions"; export { BuiltinEditorSuggestions } from "./client/builtin-suggestions"; export { EditorSuggestions, EditorSuggest } from "./client/suggestions"; export { Editor } from "./client/editor"; export { FileManager } from "./client/file-manager"; export { TFile, TFolder } from "./client/vault"; export { parseMarkdown } from "./client/markdown"; export { fileLinktext, resolveLink, resolveSubpath } from "./client/links";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  model = await import(pathToFileURL(output).href);
  ({ BuiltinEditorSuggestions, EditorSuggestions, EditorSuggest, Editor } = model);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/builtin-suggestions-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
function atMarker(value) { const cursor = value.indexOf("¦"); return { text: value.replace("¦", ""), cursor }; }
function trigger(value) { const { text, cursor } = atMarker(value); return model.builtinCompletionTrigger(text, cursor); }

test("bounded subsequences rank below every literal tier and reward word/path boundaries and compact runs", () => {
  const rank = model.createCompletionRanker("prnt");
  const values = ["Project Notes", "xx prnt", "prnt suffix", "prnt"].map(value => rank.score(value));
  assert.ok(values.every(value => value >= 0));
  assert.ok(values.every((value, index) => !index || value > values[index - 1]), "exact > prefix > substring > fuzzy");
  assert.ok(rank.score("Project Notes") > rank.score("pqrnqt"), "word boundaries beat scattered interior matches");
  assert.ok(rank.score("Prxnt") > rank.score("Prxnxt"), "contiguous runs beat additional interior gaps with the same boundaries");
  assert.ok(model.createCompletionRanker("pn").score("Archive/Project Notes") >= 0);
  assert.ok(model.createCompletionRanker("pn").score("projectNotes") >= 0, "camel-case boundaries participate without changing identity");
  assert.equal(model.createCompletionRanker("pn").score("x" + "p" + "x".repeat(70) + "n"), -1);
  assert.equal(model.createCompletionRanker("pn").score("alphabetan"), -1, "an interior scattered subsequence has no boundary proof");
  assert.equal(model.createCompletionRanker("p").score("beta"), -1, "single-character fuzzy noise is not offered");
  assert.ok(model.createCompletionRanker(".*[p]").score("literal .*[p] text") >= 0, "queries remain literal strings, never regexes");
});

test("ranking handles Unicode codepoints and expanding lowercase without admitting broken surrogates or oversized raw strings", () => {
  assert.ok(model.createCompletionRanker("😀dn").score("😀 Design notes") >= 0);
  assert.equal(model.createCompletionRanker("İd").score("İstanbul design"), model.createCompletionRanker("i\u0307d").score("İstanbul design"));
  assert.ok(model.createCompletionRanker("οςd").score("ΟΣ design") >= 0, "whole-string lowercase contextual sigma retains codepoint owners");
  for (const query of ["\ud83d", "\ude00", "a".repeat(model.MAX_COMPLETION_RANK_QUERY + 1)]) {
    const rank = model.createCompletionRanker(query); assert.equal(rank.score("Valid candidate"), -1); assert.equal(rank.fuzzyCharacters, 0);
  }
  const rank = model.createCompletionRanker("pn");
  for (const value of ["\ud83d Notes", "Project \ude00", " ".repeat(model.MAX_COMPLETION_RANK_VALUE) + "Project Notes"]) assert.equal(rank.score(value), -1);
  assert.equal(rank.fuzzyCharacters, 0, "rejected raw strings never spend preprocessing work");
  assert.deepEqual(model.linkCompletions("pn", [{ path: " ".repeat(model.MAX_COMPLETION_RANK_VALUE) + "Project Notes.md" }]), []);
});

test("aggregate fuzzy work exhaustion still permits late exact, prefix and substring winners", () => {
  const rank = model.createCompletionRanker("zz"), noise = "x".repeat(model.MAX_COMPLETION_RANK_VALUE);
  for (let index = 0; index <= model.MAX_COMPLETION_FUZZY_CHARACTERS / noise.length; index++) assert.equal(rank.score(noise), -1);
  assert.equal(rank.fuzzyExhausted, true); assert.ok(rank.fuzzyCharacters <= model.MAX_COMPLETION_FUZZY_CHARACTERS);
  const spent = rank.fuzzyCharacters;
  assert.equal(rank.score("Zany Zebra"), -1);
  assert.ok(rank.score("zz") > rank.score("zz prefix")); assert.ok(rank.score("zz prefix") > rank.score("later zz"));
  assert.equal(rank.fuzzyCharacters, spent, "literal matching continues without more fuzzy preprocessing");
  const files = [{ path: "Zany Zebra.md" }, ...Array.from({ length: 1_200 }, (_, index) => ({ path: `Noise/${"x".repeat(990)}${index}.md` })), { path: "zz.md" }, { path: "zz prefix.md" }, { path: "later zz.md" }];
  assert.deepEqual(model.linkCompletions("zz", files).slice(0, 4).map(value => value.path), ["zz.md", "zz prefix.md", "later zz.md", "Zany Zebra.md"]);
});

test("fuzzy ranking finds later boundary windows and overlapping starts after an ineligible early subsequence", () => {
  for (const query of ["pn", "pnt", "prjnt"]) {
    for (const value of ["Project Notes", "Appendix Project Notes", "Archive Appendix Project Notes"]) {
      assert.ok(model.createCompletionRanker(query).score(value) >= 0, query + " / " + value);
    }
  }
  assert.deepEqual(model.linkCompletions("pn", [{ path: "Elsewhere.md", aliases: ["Archive Appendix Project Notes"] }]), [{ kind: "link", path: "Elsewhere.md", alias: "Archive Appendix Project Notes" }]);
  const text = "# Archive Appendix Project Notes\n";
  assert.equal(model.subpathCompletions(trigger("[[#pnt¦"), "Elsewhere.md", text)[0].heading, "Archive Appendix Project Notes");
  const query = "p" + "x".repeat(30) + "n", rank = model.createCompletionRanker(query);
  assert.ok(rank.score("P" + "x".repeat(30) + "😀".repeat(32) + "N") >= 0, "the fixed window counts original codepoints rather than UTF-16 halves");
  assert.equal(rank.score("P" + "x".repeat(30) + "😀".repeat(33) + "N"), -1, "a65-codepoint span exceeds the absolute64-codepoint window");
});

test("an ineligible interior ending permits a later boundary ending of the same greedy prefix within all work caps", () => {
  assert.ok(model.createCompletionRanker("pn").score("Appendix Notes") >= 0, "interior p/n does not hide the later boundary N for the same p");
  assert.deepEqual(model.linkCompletions("pn", [{ path: "Elsewhere.md", aliases: ["Appendix Notes"] }]), [{ kind: "link", path: "Elsewhere.md", alias: "Appendix Notes" }]);
  const query = "a".repeat(31) + "z", rank = model.createCompletionRanker(query), noise = ("x" + "a".repeat(31) + "x" + "z".repeat(30)).repeat(16);
  let inspected = 0;
  while (!rank.fuzzyExhausted && inspected++ < 256) assert.equal(rank.score(noise), -1, "many rejected endings stay ineligible");
  assert.equal(rank.fuzzyExhausted, true); assert.ok(rank.fuzzySteps <= model.MAX_COMPLETION_FUZZY_STEPS); assert.ok(rank.fuzzyCharacters <= model.MAX_COMPLETION_FUZZY_CHARACTERS);
  const spent = rank.fuzzySteps;
  assert.ok(rank.score(query) > rank.score(query + " suffix")); assert.ok(rank.score("later " + query) >= 0);
  assert.equal(rank.fuzzySteps, spent, "literal winners remain available after rejected-ending work exhausts the cap");
});

test("repeated-character lookahead has an independent aggregate step cap and never hides later literals", () => {
  const query = "a".repeat(31) + "z", rank = model.createCompletionRanker(query), noise = "a".repeat(1_024);
  let inspected = 0;
  while (!rank.fuzzyExhausted && inspected++ < 256) assert.equal(rank.score(noise), -1);
  assert.equal(rank.fuzzyExhausted, true); assert.ok(rank.fuzzySteps <= model.MAX_COMPLETION_FUZZY_STEPS);
  assert.ok(rank.fuzzyCharacters < model.MAX_COMPLETION_FUZZY_CHARACTERS, "the actual-step limit can stop repeated starts before the preprocessing character limit");
  const spent = rank.fuzzySteps; assert.ok(rank.score(query) > rank.score(query + " prefix")); assert.ok(rank.score("later " + query) >= 0); assert.equal(rank.fuzzySteps, spent);
  const fuzzy = "a".repeat(31) + " Z.md", exact = query + ".md", prefix = query + " prefix.md";
  const files = [{ path: fuzzy }, ...Array.from({ length: 200 }, (_, index) => ({ path: `Noise/${"a".repeat(990)}${index}.md` })), { path: exact }, { path: prefix }];
  assert.deepEqual(model.linkCompletions(query, files).slice(0, 3).map(value => value.path), [exact, prefix, fuzzy]);
});

test("bounded resolver identity proof retains unsafe-first duplicate shadows without ranking oversized headings", () => {
  const text = "# Child Design\n## Child Design\n", cache = model.parseMarkdown(text);
  cache.headings[0].heading = " ".repeat(1_025) + "Child Design";
  assert.deepEqual(model.subpathCompletions(trigger("[[#ChldDsg¦"), "Project Notes.md", text, cache), [], "normalizing an unsafe first heading must still hide a later duplicate that resolves elsewhere");
  const hierarchyText = "# Parent Alpha\n## Child Design\n", oversizedCache = model.parseMarkdown(hierarchyText);
  oversizedCache.headings.push(...Array.from({ length: 257 }, () => ({ ...oversizedCache.headings[1], heading: "x".repeat(1_024) })));
  assert.deepEqual(model.subpathCompletions(trigger("[[#Parent Alpha#ChldDsg¦"), "Project Notes.md", hierarchyText, oversizedCache), [], "the complete raw heading inventory is bounded before resolver identity preprocessing");
});

test("existing notes and aliases accept abbreviations with deterministic ties and no typo or new-note guesses", () => {
  const files = [{ path: "B/Project Notes.md", aliases: ["Planning journal"] }, { path: "A/Project Notes.md", aliases: ["Planning journal"] }];
  assert.deepEqual(model.linkCompletions("PrjNt", files).map(value => value.path), ["A/Project Notes.md", "B/Project Notes.md"]);
  assert.deepEqual(model.linkCompletions("PlnJrn", files), model.linkCompletions("PlnJrn", files.toReversed()));
  assert.deepEqual(model.linkCompletions("PlnJrn", files).map(value => [value.path, value.alias]), files.toReversed().map(value => [value.path, "Planning journal"]));
  assert.deepEqual(model.linkCompletions("Projecz", files), [], "substitutions and transpositions are not edit-distance matches");
  assert.deepEqual(model.linkCompletions("Uncreated destination", files), []);
  assert.equal(model.linkCompletions("PrjNt", Array.from({ length: 100 }, (_, index) => ({ path: `Folder/${index}/Project Notes.md` }))).length, 40);
});

test("fuzzy headings retain exact ancestors, first normalized duplicates and literal-hash shadows", () => {
  const text = "# Parent Alpha\r\n## Child Design\r\n## **Child Design**\r\n# Parent Beta\r\n## Child Design\r\n", cache = model.parseMarkdown(text);
  const flat = model.subpathCompletions(trigger("[[#ChldDsg¦"), "Project Notes.md", text, cache);
  assert.equal(flat.length, 1); assert.equal(flat[0].from, text.indexOf("## Child Design"));
  const nested = model.subpathCompletions(trigger("[[#Parent Beta#ChldDsg¦"), "Project Notes.md", text, cache);
  assert.equal(nested.length, 1); assert.deepEqual(nested[0].parents, ["Parent Beta"]);
  assert.equal(nested[0].from, text.lastIndexOf("## Child Design"));
  assert.equal(model.resolveSubpath(cache, "#" + model.headingCompletionSubpath(nested[0])).start.offset, nested[0].from);
  assert.deepEqual(model.subpathCompletions(trigger("[[#PrntBt#ChldDsg¦"), "Project Notes.md", text, cache), [], "only the terminal query is fuzzy; completed ancestors retain exact normalized resolution");
  const shadow = text + "# Parent Beta#Child Design\r\n";
  assert.deepEqual(model.subpathCompletions(trigger("[[#Parent Beta#ChldDsg¦"), "Project Notes.md", shadow), [], "a legacy literal-hash destination still prevents a different hierarchy result");
  assert.deepEqual(model.subpathCompletions(trigger("[[#Missing destination¦"), "Project Notes.md", text, cache), []);
});

test("fuzzy blocks rank existing IDs and previews without overriding a literal preview or creating an ID", () => {
  const text = "Release paragraph. ^release-id\r\n\r\nrlsid literal preview. ^unrelated-id\r\n\r\nUnidentified paragraph.\r\n", cache = model.parseMarkdown(text);
  const choices = model.subpathCompletions(trigger("[[#^rlsid¦"), "Project Notes.md", text, cache);
  assert.deepEqual(choices.map(value => value.id), ["unrelated-id", "release-id"], "a literal preview outranks a fuzzy ID even with the ID bonus");
  for (const value of choices) assert.equal(model.resolveSubpath(cache, "#^" + value.id).start.offset, value.from);
  assert.deepEqual(model.subpathCompletions(trigger("[[#^Rlsprgrph¦"), "Project Notes.md", text, cache).map(value => value.id), ["release-id"]);
  assert.deepEqual(model.subpathCompletions(trigger("[[#^uncreated-id¦"), "Project Notes.md", text, cache), []);
  assert.equal(Object.keys(cache.blocks).length, 2);
});

test("global fuzzy headings retain literal priority, source path ties and raw metadata budgets", () => {
  const sources = ["B.md", "A.md"].map(path => ({ path, text: "# Design overview\n## **Design overview**\n", cache: model.parseMarkdown("# Design overview\n## **Design overview**\n") }));
  sources.push({ path: "Literal.md", text: "# DsgOvr literal\n", cache: model.parseMarkdown("# DsgOvr literal\n") });
  const expected = trigger("[[##DsgOvr¦"), values = model.globalHeadingCompletions(expected, sources);
  assert.deepEqual(values.map(value => value.path), ["Literal.md", "A.md", "B.md"]);
  assert.deepEqual(values, model.globalHeadingCompletions(expected, sources.toReversed()));
  const oversized = { ...sources[0], cache: { ...sources[0].cache, headings: [{ ...sources[0].cache.headings[0], heading: " ".repeat(model.MAX_COMPLETION_GLOBAL_CHARACTERS + 1) + "Design overview" }] } };
  assert.deepEqual(model.globalHeadingCompletions(expected, [oversized, ...sources]), [], "aggregate raw metadata is checked before normalization, including rejected names");
});

test("ordinary YAML key and same-key scalar matching stays literal when note and subpath matching is fuzzy", () => {
  assert.deepEqual(model.propertyCompletions("prjnt", ["Project Notes"], []), []);
  assert.deepEqual(model.propertyValueCompletions({ kind: "property-value", query: "prjnt", property: "status" }, ["Project Notes"]), []);
  assert.deepEqual(model.propertyCompletions("Notes", ["Project Notes", "Notes suffix", "Notes"], []).map(value => value.name), ["Notes", "Notes suffix", "Project Notes"]);
  assert.deepEqual(model.propertyValueCompletions({ kind: "property-value", query: "Notes", property: "status" }, ["Project Notes", "Notes suffix", "Notes"]).map(value => value.value), ["Notes", "Notes suffix", "Project Notes"]);
});

function fuzzyPropertyFixture() {
  const files = new Map(), documents = new Map(), config = new Map(), sessions = new Map();
  const app = { vault: { rootPath: "fuzzy-properties", readOnly: false, getFileByPath: path => files.get(path) ?? null, getFiles: () => [...files.values()], getConfig: key => config.get(key) }, workspace: { sessions, isChangingFiles: false }, core: { isEnabled: () => true }, metadataCache: { getDocument: path => documents.get(path), getDocuments: () => [...documents.values()], fileToLinktext: (target, source, omit) => model.fileLinktext([...files.values()], target.path, source, omit, config.get("newLinkFormat")), resolveReference: (link, source) => model.resolveLink([...files.values()], link.link, source) } };
  const add = (path, text) => { const file = { path, extension: "md", vault: app.vault }; files.set(path, file); documents.set(path, { document: { file: { path } }, text, cache: model.parseMarkdown(text), missing: false }); return file; };
  const file = add("Source.md", "\ufeff---\r\nstatus: Open\r\n---\r\nSource.\r\n");
  const target = add("Project Notes.md", "---\naliases: [Planning journal]\nstatus: Project Notes\n---\n# Design overview\n\nRelease paragraph ^release-id\n");
  const choices = query => model.propertyValueChoices(app, file, "status", "text", [], query);
  return { app, file, target, files, documents, config, sessions, choices };
}

test("Properties note/subpath choosers share fuzzy ranking while retaining literal values and all choice proofs", () => {
  const f = fuzzyPropertyFixture();
  assert.deepEqual(f.choices("PrjNt"), [], "ordinary same-key values keep literal matching");
  for (const [query, kind, value] of [["[[PrjNt", "link", "[[Project Notes]]"], ["[[PlnJrn", "link", "[[Project Notes|Planning journal]]"], ["[[Project Notes#DsgOvr", "subpath", "[[Project Notes#Design overview]]"], ["[[Project Notes#^rlsid", "subpath", "[[Project Notes#^release-id]]"]]) {
    const choice = f.choices(query)[0]; assert.equal(choice?.kind, kind); assert.equal(choice.value, value); assert.equal(choice.target, f.target);
    model.assertPropertyValueChoice(f.app, choice, "text", [], query);
  }
  for (const change of [
    x => { x.app.vault.readOnly = true; }, x => { x.app.vault.rootPath = "changed"; }, x => { x.app.changingVault = true; },
    x => { x.app.workspace.isChangingFiles = true; }, x => { x.app.workspace.isChangingLayout = true; }, x => { x.app.core.isEnabled = () => false; },
    x => { x.files.set(x.target.path, { ...x.target }); }, x => { x.documents.get(x.target.path).text += "Changed contributor body\n"; },
    x => { x.config.set("newLinkFormat", "absolute"); }, x => { x.sessions.set(x.file.path, { originRoot: "fuzzy-properties", text: "Changed source" }); },
  ]) {
    const x = fuzzyPropertyFixture(), choice = x.choices("[[PrjNt")[0]; assert.ok(choice); change(x);
    assert.throws(() => model.assertPropertyValueChoice(x.app, choice, "text", [], "[[PrjNt"), /changed|available|disabled|read.only/i);
  }
  const choice = f.choices("[[Project Notes#DsgOvr")[0];
  f.documents.get(f.target.path).text = f.documents.get(f.target.path).text.replace("Design overview", "Other heading");
  assert.throws(() => model.assertPropertyValueChoice(f.app, choice, "text", [], "[[Project Notes#DsgOvr"), /changed/);
  const absent = fuzzyPropertyFixture(); assert.deepEqual(absent.choices("[[Uncreated note"), []); assert.deepEqual(absent.choices("[[Project Notes#^uncreated-id"), []);
  absent.app.vault.readOnly = true; assert.deepEqual(absent.choices("[[PrjNt"), []);
});

test("wiki trigger and edit preserve exact Unicode/CRLF bytes and replace an existing closing pair once", () => {
  const { text, cursor } = atMarker("😀 Before\r\nText ![[Al¦pha]] tail\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  assert.equal(expected.kind, "link"); assert.equal(expected.query, "Al");
  assert.equal(text.slice(expected.from, expected.to), "[[Alpha]]");
  const plan = model.planBuiltinCompletion(text, cursor, expected, { kind: "link", path: "Folder/Alpine.md" }, "Folder/Alpine");
  assert.equal(plan.text, "😀 Before\r\nText ![[Folder/Alpine]] tail\r\n");
  assert.equal(plan.text.slice(plan.cursor), " tail\r\n");
});

test("new wiki links and metadata aliases retain known targets without label guessing", () => {
  const { text, cursor } = atMarker("Before [[Wor¦ after"), expected = model.builtinCompletionTrigger(text, cursor);
  const values = model.linkCompletions("wor", [{ path: "Notes/Target.md", aliases: ["Work item", "Work item", "bad|alias"] }, { path: "World.md" }, { path: "file.png" }]);
  assert.deepEqual(values, [{ kind: "link", path: "World.md" }, { kind: "link", path: "Notes/Target.md", alias: "Work item" }]);
  const plan = model.planBuiltinCompletion(text, cursor, expected, values[1], "Notes/Target");
  assert.equal(plan.text, "Before [[Notes/Target|Work item]] after");
  for (const source of ["[[Target|la¦]]", "[[A]¦]", "[[[Al¦", "\\[[Al¦", "[[Al¦pha"]) { assert.equal(trigger(source), null, source); }
});

test("wiki suggestions reject code, HTML/percent comments, metadata, math and ordinary link contexts", () => {
  for (const source of [
    "```md\n[[Al¦\n```", "~~~\r\n[[Al¦", "    [[Al¦", "`[[Al¦]]`", "<!-- [[Al¦ -->", "<!--\n[[Al¦", "%% [[Al¦ %%", "%%\n[[Al¦", "---\ntitle: [[Al¦\n---", "---\n[[Al¦", "$x [[Al¦]] z$", "[caption [[Al¦]]](Other.md)", "<span title='[[Al¦'>",
  ]) { assert.equal(trigger(source), null, source); }
  assert.equal(trigger("\\\\[[Al¦").kind, "link", "even escape parity is literal backslash followed by a link");
});

test("percent delimiters in code, math and HTML comments do not disable later prose completion", () => {
  for (const source of ["`%%` [[Al¦", "```\n%%\n```\n[[Al¦", "$x%%z$ [[Al¦", "Text <!-- %% --> [[Al¦", "\\%% [[Al¦", "%% hidden %% [[Al¦", "`[` [[Al¦", "Text $[x$ [[Al¦", "Text <!-- [ --> [[Al¦", "%% [ %% [[Al¦"]) {
    assert.equal(trigger(source)?.kind, "link", source);
  }
  assert.equal(trigger("\\%% one %%\n[[Al¦"), null, "an escaped marker cannot consume the next actual comment opener");
});

test("wiki choices retain full file identities, exclude unsupported delimiters and have stable bounded results", () => {
  const files = Array.from({ length: 100 }, (_, index) => ({ path: `Folder/Alpha-${String(index).padStart(3, "0")}.md` }));
  files.push({ path: "Folder/A#bad.md" }, { path: "Folder/A]bad.md" }, { path: "Folder/A|bad.md" });
  const choices = model.linkCompletions("alpha", files);
  assert.equal(choices.length, model.MAX_COMPLETION_RESULTS); assert.equal(new Set(choices.map(value => value.path)).size, choices.length);
  let scanned = 0;
  const source = { *[Symbol.iterator]() { while (true) { scanned++; yield { path: "Absent.md" }; } } };
  assert.deepEqual(model.linkCompletions("no match", source), []); assert.ok(scanned <= model.MAX_COMPLETION_CANDIDATES + 1);
});

test("property completion only targets a new top-level key in valid closed frontmatter", () => {
  const { text, cursor } = atMarker("\ufeff---\r\ntitle: Untouched\r\nsta¦\r\n---\r\nBody\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  assert.equal(expected.kind, "property"); assert.deepEqual(expected.existingKeys, ["title"]);
  const choices = model.propertyCompletions(expected.query, ["status", "Status", "title", "state"], expected.existingKeys);
  assert.deepEqual(choices, [{ kind: "property", name: "state" }, { kind: "property", name: "status" }]);
  const plan = model.planBuiltinCompletion(text, cursor, expected, choices[1]);
  assert.equal(plan.text, "\ufeff---\r\ntitle: Untouched\r\nstatus: \r\n---\r\nBody\r\n");
  assert.equal(plan.text.slice(plan.cursor), "\r\n---\r\nBody\r\n");
});

test("property candidates never add case-duplicate existing keys and quote YAML-sensitive names exactly", () => {
  assert.deepEqual(model.propertyCompletions("sta", ["status", "STATE", "state"], ["Status"]), [{ kind: "property", name: "STATE" }]);
  for (const name of ["null", "true", "2026", "a: key", "a # key", "quoted \"key\"", "λ property", "__proto__"]) {
    const source = model.propertyKeySource(name) + ": null", parsed = parseDocument(source);
    assert.equal(parsed.errors.length, 0); assert.equal(parsed.contents.items[0].key.value, name, source);
  }
  const { text, cursor } = atMarker("---\nnull¦\n---"), expected = model.builtinCompletionTrigger(text, cursor);
  assert.equal(model.planBuiltinCompletion(text, cursor, expected, { kind: "property", name: "null" }).text, '---\n"null": \n---');
});

test("property triggers refuse nested/comment/root-sequence/multiline YAML, duplicates and malformed documents", () => {
  for (const source of [
    "sta¦", "---\nsta¦", "---\n  sta¦\n---", "---\n# sta¦\n---", "---\n- sta¦\n---", "---\nname: 1\nname: 2\nsta¦\n---", "---\nname: [\nsta¦\n---", '---\nname: "hello\nsta¦\nend"\n---', "---\nname: |\n  sta¦\n---", "---\n{ status: done }\nsta¦\n---",
  ]) { assert.equal(trigger(source), null, source); }
});

test("a new property after a block scalar does not extend or rewrite that scalar", () => {
  for (const indicator of ["|", ">", "|-", ">+"]) {
    const { text, cursor } = atMarker(`---\r\ntitle: ${indicator}\r\n  exact text\r\nsta¦\r\n---`), expected = model.builtinCompletionTrigger(text, cursor);
    assert.equal(expected?.kind, "property", indicator);
    const plan = model.planBuiltinCompletion(text, cursor, expected, { kind: "property", name: "status" });
    assert.equal(plan.text, text.replace("\r\nsta\r\n", "\r\nstatus: \r\n"));
  }
});

test("model refuses stale offsets, invalid values and oversized source/query without normalization", () => {
  const { text, cursor } = atMarker("[[Al¦"), expected = model.builtinCompletionTrigger(text, cursor);
  assert.throws(() => model.planBuiltinCompletion("X" + text, cursor + 1, expected, { kind: "link", path: "Alpha.md" }, "Alpha"), /changed/);
  assert.throws(() => model.planBuiltinCompletion(text, cursor, expected, { kind: "link", path: "Alpha.md" }, "A|bad"), /safely/);
  assert.equal(model.builtinCompletionTrigger("x".repeat(model.MAX_COMPLETION_SOURCE) + "[[Al", model.MAX_COMPLETION_SOURCE + 4), null);
  assert.equal(trigger("[[" + "a".repeat(257) + "¦"), null);
  assert.equal(model.builtinCompletionTrigger(text, -1), null);
});

function fixture(text = "[[Al", options = {}) {
  const lock = new MutationLock(), state = EditorState.create({ doc: text, selection: { anchor: text.replaceAll("\r\n", "\n").length }, extensions: [history(), lock.extension(), EditorState.lineSeparator.of(options.separator ?? "\n"), EditorView.editable.of(options.editable ?? true)] });
  const editor = Object.create(Editor.prototype), cm = { state, hasFocus: true, dispatch(spec) { this.state = this.state.update(spec).state; } };
  cm.dispatch = function(spec) { const transaction = spec.startState ? spec : this.state.update(spec); this.state = transaction.state; }.bind(cm);
  Object.assign(editor, { cm });
  const vault = { rootPath: "test-vault", readOnly: false, getFileByPath(path) { return files.find(file => file.path === path) ?? null; }, getMarkdownFiles() { return files; } };
  const source = { path: "Source.md", vault }, target = { path: "Folder/Alpha.md", vault }, files = [source, target];
  const view = { editor, file: source };
  const documents = new Map();
  const setTarget = value => documents.set(target.path, { text: value, cache: model.parseMarkdown(value), missing: false });
  setTarget("---\naliases: [Alpine]\n---\n# Heading λ\n\nTarget paragraph ^known-id\n");
  documents.set(source.path, { text, cache: model.parseMarkdown(text), missing: false });
  const app = { changingVault: false, vault, workspace: { isChangingFiles: false, activeEditor: view, sessions: new Map() }, metadataCache: { getFileCache(file) { return documents.get(file.path)?.cache ?? null; }, getDocument(path) { return documents.get(path) ?? null; }, resolveReference(reference, path) { return model.resolveLink(files, reference.link, path); }, getDocuments() { return [{ cache: { frontmatter: { status: "open", title: "Fixture" } } }]; }, fileToLinktext() { return "Folder/Alpha"; } } };
  const suggest = Object.create(BuiltinEditorSuggestions.prototype);
  Object.assign(suggest, { app, context: { editor, file: source, query: "Al", start: { line: 0, ch: 0 }, end: { line: 0, ch: 4 } }, origin: view, root: vault.rootPath, path: source.path, document: state.doc, cursor: state.selection.main.head });
  suggest.close = () => { suggest.context = null; };
  return { suggest, app, source, target, files, editor, cm, lock, documents, setTarget };
}

test("real CodeMirror completion is one undo step, retains CRLF and positions the cursor after the closing token", () => {
  const { suggest, editor, target } = fixture("😀\r\n[[Al", { separator: "\r\n" });
  suggest.selectSuggestion({ kind: "link", path: target.path, target });
  assert.equal(editor.getValue(), "😀\r\n[[Folder/Alpha]]"); assert.deepEqual(editor.getCursor(), { line: 1, ch: 16 });
  editor.undo(); assert.equal(editor.getValue(), "😀\r\n[[Al");
  editor.redo(); assert.equal(editor.getValue(), "😀\r\n[[Folder/Alpha]]");
});

test("completion refuses read-only, mutation-locked, detached/replaced/renamed source and stale target identities", () => {
  for (const change of [
    x => { x.app.vault.readOnly = true; }, x => { x.cm.dispatch({ effects: x.lock.set(true) }); }, x => { x.app.changingVault = true; },
    x => { x.app.workspace.isChangingFiles = true; }, x => { x.app.vault.rootPath = "other"; }, x => { x.app.workspace.activeEditor = null; },
    x => { x.cm.composing = true; },
    x => { x.files[0] = { ...x.source }; }, x => { x.source.path = "Renamed.md"; }, x => { x.files[1] = { ...x.target }; },
    x => { x.target.path = "Renamed target.md"; }, x => { x.editor.setCursor(0); },
  ]) {
    const x = fixture(), before = x.editor.getValue(), originalPath = x.target.path; change(x);
    x.suggest.selectSuggestion({ kind: "link", path: originalPath, target: x.target });
    assert.equal(x.editor.getValue(), before);
  }
});

test("read-only/noneditable trigger stays closed; valid known property completion preserves the other YAML bytes", () => {
  const x = fixture("---\r\ntitle: Fixture\r\nsta\r\n---", { separator: "\r\n" });
  x.editor.setCursor(2, 3); x.suggest.document = x.cm.state.doc; x.suggest.cursor = x.cm.state.selection.main.head;
  const values = x.suggest.getSuggestions(x.suggest.context); assert.deepEqual(values, [{ kind: "property", name: "status" }]);
  x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "---\r\ntitle: Fixture\r\nstatus: \r\n---");
  x.editor.undo(); assert.equal(x.editor.getValue(), "---\r\ntitle: Fixture\r\nsta\r\n---");
  const other = fixture("[[Al", { editable: false });
  assert.equal(other.suggest.onTrigger({ line: 0, ch: 4 }, other.editor, other.source), null);
});

test("plugins registered after built-ins still trigger first and fallback registration disposes without disturbing plugins", async () => {
  const app = { workspace: { activeEditor: {}, on() {}, addEditorExtension() {}, removeEditorExtensions() {} } }, calls = [];
  const manager = new EditorSuggestions(app);
  function suggestion(name, result) { const suggest = Object.create(EditorSuggest.prototype); Object.assign(suggest, { app, containerEl: { dataset: {} }, trigger() { calls.push(name); return result; }, close() { calls.push("close:" + name); } }); return suggest; }
  const fallback = suggestion("builtin", true), plugin = suggestion("plugin", true), second = suggestion("second", true);
  const remove = manager.register("builtin", fallback, { fallback: true }); manager.register("plugin", plugin); manager.register("second", second);
  assert.deepEqual(manager.suggests, [plugin, second, fallback]);
  manager.schedule(); await Promise.resolve(); assert.deepEqual(calls, ["plugin", "close:second", "close:builtin"]);
  remove(); assert.deepEqual(manager.suggests, [plugin, second]);
});

test("Properties-owned Live Preview declines raw YAML completion; Source and Properties-disabled raw Live Preview permit it", () => {
  const text = "---\r\ntitle: Fixture\r\nsta\r\n---", x = fixture(text, { separator: "\r\n" });
  x.editor.setCursor(2, 3); x.suggest.document = x.cm.state.doc; x.suggest.cursor = x.cm.state.selection.main.head;
  let mode = "live-preview", properties = true;
  x.app.core = { isEnabled(id) { return id === "properties" && properties; } };
  x.editor.owner = { app: x.app, getEditingMode() { return mode; } };
  assert.equal(x.suggest.onTrigger({ line: 2, ch: 3 }, x.editor, x.source), null);
  assert.deepEqual(x.suggest.getSuggestions(x.suggest.context), []);
  x.suggest.selectSuggestion({ kind: "property", name: "status" }); assert.equal(x.editor.getValue(), text);
  mode = "source";
  assert.equal(x.suggest.onTrigger({ line: 2, ch: 3 }, x.editor, x.source).query, "sta");
  mode = "live-preview"; properties = false;
  assert.deepEqual(x.suggest.getSuggestions(x.suggest.context), [{ kind: "property", name: "status" }]);
});

test("heading/block triggers retain whole-token CRLF ranges and distinguish current-note and explicit targets", () => {
  for (const [source, kind, linkpath, query] of [
    ["😀\r\nBefore [[Alpha#He¦ading λ]] tail", "heading", "Alpha", "He"],
    ["[[#¦", "heading", "", ""], ["[[#^cur¦rent-id]]", "block", "", "cur"],
    ["[[Folder/Alpha#^¦", "block", "Folder/Alpha", ""],
  ]) {
    const value = trigger(source);
    assert.equal(value?.kind, kind); assert.equal(value.linkpath, linkpath); assert.equal(value.query, query);
    assert.equal(atMarker(source).text.slice(value.from, value.from + 2), "[[");
  }
  for (const source of ["[[Alpha#One##Tw¦", "[[Al¦pha#Heading]]", "[[Alpha#Head|la¦]]", "[[#He¦ading", "`[[#He¦]]`", "<!-- [[#^id¦ -->", "---\nkey: [[#He¦\n---", "%% [[#^id¦ %%", "$[[#He¦]]$", "[caption [[#He¦]]](Other.md)"]) {
    assert.equal(trigger(source), null, source);
  }
});

test("subpath choices contain only addressable first headings and existing block IDs with inert bounded previews", () => {
  const text = "# Heading λ\r\n\r\nA target paragraph. ^known-id\r\n\r\n## **Heading λ**\r\n# Other\r\n# unsafe|heading\r\n# ^looks-like-block\r\n\r\n<span onclick=evil()>Literal markup</span> ^second-id\r\n";
  const cache = model.parseMarkdown(text), headings = model.subpathCompletions(trigger("[[Alpha#¦"), "Alpha.md", text, cache);
  assert.deepEqual(headings.map(value => value.heading), ["Other", "Heading λ"]);
  for (const choice of headings) {
    assert.equal(model.resolveSubpath(cache, "#" + choice.heading).start.offset, choice.from);
  }
  const blocks = model.subpathCompletions(trigger("[[Alpha#^para¦"), "Alpha.md", text, cache);
  assert.deepEqual(blocks.map(value => value.id), ["known-id"]); assert.match(blocks[0].preview, /target paragraph/);
  const byId = model.subpathCompletions(trigger("[[#^second¦"), "Alpha.md", text, cache);
  assert.deepEqual(byId.map(value => value.id), ["second-id"]); assert.match(byId[0].preview, /onclick=evil/);
  assert.equal(model.subpathCompletions(trigger("[[#^missing¦"), "Alpha.md", text, cache).length, 0);
});

test("hierarchical heading triggers retain complete ancestry and whole-token Unicode/CRLF ranges", () => {
  for (const [source, path, parents, query] of [
    ["😀\r\nBefore [[Alpha#One#Tw¦o]] tail", "Alpha", ["One"], "Tw"],
    ["[[#One#Two#¦", "", ["One", "Two"], ""],
    ["[[Folder/Alpha#Ω parent#Child#De¦ep]]", "Folder/Alpha", ["Ω parent", "Child"], "De"],
  ]) {
    const value = trigger(source);
    assert.equal(value.kind, "heading"); assert.equal(value.linkpath, path);
    assert.deepEqual(value.headingParents, parents); assert.equal(value.query, query);
    const text = atMarker(source).text; assert.equal(text.slice(value.from, value.from + 2), "[[");
    if (source.includes("]]")) assert.equal(text.slice(value.to - 2, value.to), "]]");
  }
  assert.equal(trigger("[[#A#B#C#D#E#F¦").headingParents.length, 5);
  for (const source of ["[[#A#B#C#D#E#F#G¦", "[[Alpha#One##Tw¦", "[[#One# #Tw¦", "[[#^id#He¦", "[[Alpha#^id#He¦", "[[##query#Child¦", "[[#One#He¦ad#Child]]", "`[[#One#Ch¦]]`", "<!-- [[#One#Ch¦ -->", "---\nkey: [[#One#Ch¦\n---"]) {
    assert.equal(trigger(source), null, source);
  }
});

test("hierarchical choices stay in the first normalized ancestor subtree and expose exact canonical ancestry", () => {
  const text = "# Opening\r\n## **Branch α**\r\n### Leaf λ\r\n### **Leaf λ**\r\n#### Deep destination\r\n## Wrong branch\r\n### Leaf λ\r\n### Outside child\r\n# Branch α\r\n## Only later ancestor\r\n";
  const cache = model.parseMarkdown(text), expected = trigger("[[Alpha#branch α#Le¦");
  const choices = model.subpathCompletions(expected, "Alpha.md", text, cache);
  assert.equal(choices.length, 1); assert.equal(choices[0].heading, "Leaf λ");
  assert.deepEqual(choices[0].parents, ["**Branch α**"]);
  assert.equal(choices[0].from, text.indexOf("### Leaf λ"));
  const nested = model.subpathCompletions(trigger("[[#Opening#branch α#De¦"), "Alpha.md", text, cache);
  assert.deepEqual(nested.map(value => value.heading), ["Deep destination"]);
  assert.deepEqual(nested[0].parents, ["Opening", "**Branch α**"]);
  for (const choice of [...choices, ...nested]) {
    const resolved = model.resolveSubpath(cache, "#" + model.headingCompletionSubpath(choice));
    assert.equal(resolved.start.offset, choice.from); assert.equal(resolved.end.offset, choice.to);
  }
  assert.deepEqual(model.subpathCompletions(trigger("[[#Branch α#Only¦"), "Alpha.md", text, cache), [], "later duplicate ancestor cannot supply an absent first-subtree descendant");
  assert.deepEqual(model.subpathCompletions(trigger("[[#Opening#Branch α#Outside¦"), "Alpha.md", text, cache), []);
  assert.deepEqual(model.subpathCompletions(trigger("[[#Missing#Le¦"), "Alpha.md", text, cache), []);
});

test("hierarchical chains disambiguate repeated child names without changing ordinary flat first-heading selection", () => {
  const text = "# One\n## Shared heading\n# Two\n## Shared heading\n## Shared heading\n";
  const cache = model.parseMarkdown(text), flat = model.subpathCompletions(trigger("[[#Shared¦"), "Alpha.md", text, cache);
  assert.equal(flat.length, 1); assert.equal(flat[0].from, text.indexOf("## Shared")); assert.equal(flat[0].parents, undefined);
  const nested = model.subpathCompletions(trigger("[[#Two#Shared¦"), "Alpha.md", text, cache);
  assert.equal(nested.length, 1); assert.equal(nested[0].from, text.indexOf("## Shared", text.indexOf("# Two")));
  assert.deepEqual(nested[0].parents, ["Two"]);
});

test("hierarchical choices omit unsafe or legacy literal-hash shadows rather than inserting a different destination", () => {
  const text = "# Parent#Leaf\n# Parent\n## Leaf\n## Safe leaf\n## Unsafe|leaf\n## ^looks-like-block\n# unsafe|parent\n## Child\n";
  const cache = model.parseMarkdown(text), choices = model.subpathCompletions(trigger("[[#Parent#¦"), "Alpha.md", text, cache);
  assert.deepEqual(choices.map(value => value.heading), ["Safe leaf"]);
  assert.equal(model.resolveSubpath(cache, "#Parent#Leaf").start.offset, 0, "legacy whole-name matching retains precedence");
  assert.deepEqual(model.subpathCompletions({ ...trigger("[[#Parent#Ch¦"), headingParents: ["unsafe|parent"] }, "Alpha.md", text, cache), []);
  for (const parents of [["Other#parent"], ["^block"], [""], Array(6).fill("Parent")]) {
    assert.throws(() => model.headingCompletionSubpath({ kind: "heading", heading: "Leaf", parents }), /safely/);
  }
});

test("hierarchical completion bounds the complete heading inventory, chain length and displayed results", () => {
  const text = "# Parent\n" + Array.from({ length: 60 }, (_, index) => "## Child " + index).join("\n");
  const choices = model.subpathCompletions(trigger("[[#Parent#Child¦"), "Alpha.md", text);
  assert.equal(choices.length, model.MAX_COMPLETION_RESULTS);
  const excessive = "# Parent\n" + "## Child\n".repeat(model.MAX_COMPLETION_SUBPATHS);
  assert.deepEqual(model.subpathCompletions(trigger("[[#Parent#Child¦"), "Alpha.md", excessive), []);
  let scanned = 0;
  const heads = { *[Symbol.iterator]() { while (true) { scanned++; yield { heading: "Parent", level: 1, position: { start: { offset: 0 }, end: { offset: 1 } } }; } } };
  assert.deepEqual(model.subpathCompletions(trigger("[[#Parent#Child¦"), "Alpha.md", "# Parent", { headings: heads, blocks: {} }), []);
  assert.equal(scanned, model.MAX_COMPLETION_SUBPATHS + 1);
  assert.throws(() => model.headingCompletionSubpath({ kind: "heading", heading: "x".repeat(600), parents: ["y".repeat(600)] }), /safely/);
  assert.deepEqual(model.subpathCompletions(trigger("[[#Parent#Child¦"), "Unsafe#Path.md", text), []);
});

test("hierarchical plans preserve exact source while rejecting changed or forged ancestry", () => {
  const { text, cursor } = atMarker("😀\r\nBefore [[Alpha#parent#Ch¦ild]] tail\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  const choice = { kind: "heading", path: "Alpha.md", heading: "Child λ", parents: ["**Parent**"], from: 20, to: 30 };
  const plan = model.planBuiltinCompletion(text, cursor, expected, choice, "Folder/Alpha");
  assert.equal(plan.text, "😀\r\nBefore [[Folder/Alpha#**Parent**#Child λ]] tail\r\n");
  assert.equal(plan.text.slice(plan.cursor), " tail\r\n");
  assert.throws(() => model.planBuiltinCompletion(text.replace("parent", "others"), cursor, expected, choice, "Alpha"), /changed/);
  for (const parents of [undefined, ["Other"], ["Parent", "Other"], ["Parent#Other"]]) {
    assert.throws(() => model.planBuiltinCompletion(text, cursor, expected, { ...choice, parents }, "Alpha"), /safely/);
  }
  const current = atMarker("# Parent\r\n## Child λ\r\n\r\n[[#Parent#Ch¦"), currentTrigger = model.builtinCompletionTrigger(current.text, current.cursor);
  assert.match(model.planBuiltinCompletion(current.text, current.cursor, currentTrigger, { ...choice, parents: ["Parent"] }, "").text, /\[\[#Parent#Child λ\]\]$/);
});

test("real hierarchical cross-note and current-note choices retain isolated Undo/Redo and safe link preferences", () => {
  const target = "# First\r\n## Shared heading\r\n# Parent λ\r\n## Child Ω\r\n### Deep 😀\r\n";
  for (const [prefix, parents, heading] of [["[[Alpha#Parent λ#Ch", ["Parent λ"], "Child Ω"], ["[[Alpha#Parent λ#Child Ω#De", ["Parent λ", "Child Ω"], "Deep 😀"]]) {
    const x = fixture("😀\r\n" + prefix, { separator: "\r\n" }); x.setTarget(target);
    const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); assert.deepEqual(values[0].parents, parents);
    x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "😀\r\n[[Folder/Alpha#" + [...parents, heading].join("#") + "]]");
    x.editor.undo(); assert.equal(x.editor.getValue(), "😀\r\n" + prefix); x.editor.redo(); assert.match(x.editor.getValue(), /\]\]$/);
  }
  const text = target + "\r\n[[#Parent λ#Ch", x = fixture(text, { separator: "\r\n" });
  x.app.metadataCache.fileToLinktext = () => { throw Error("Current-note ancestry retains the empty target"); };
  const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); x.suggest.selectSuggestion(values[0]);
  assert.equal(x.editor.getValue(), target + "\r\n[[#Parent λ#Child Ω]]"); x.editor.undo(); assert.equal(x.editor.getValue(), text);
});

test("hierarchical held choices reject changed ancestry, target replacement, forged paths and every source guard", () => {
  const original = "# Parent\n## Child\n# Other\n## Child\n";
  for (const change of [
    x => x.setTarget(original.replace("# Parent", "# Changed")),
    x => x.setTarget(original.replace("## Child", "# Child")),
    x => { x.documents.get(x.target.path).cache.headings[0].heading = "Other"; },
    x => { x.files[1] = { ...x.target }; },
    x => { x.app.vault.readOnly = true; },
    x => { x.cm.dispatch({ effects: x.lock.set(true) }); },
    x => { x.app.changingVault = true; },
    x => { x.app.workspace.isChangingFiles = true; },
  ]) {
    const x = fixture("[[Alpha#Parent#Ch"); x.setTarget(original);
    const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); change(x);
    x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "[[Alpha#Parent#Ch");
  }
  const forged = fixture("[[Alpha#Parent#Ch"); forged.setTarget(original);
  const value = forged.suggest.getSuggestions(forged.suggest.context)[0];
  forged.suggest.selectSuggestion({ ...value, parents: ["Other"] }); assert.equal(forged.editor.getValue(), "[[Alpha#Parent#Ch");
});

test("hierarchical choices use dirty target text before delayed metadata and refuse later dirty replacements", () => {
  const x = fixture("[[Alpha#Fresh parent#Fr");
  const session = { originRoot: x.app.vault.rootPath, text: "# Fresh parent\n## Fresh child\n" }; x.app.workspace.sessions.set(x.target.path, session);
  const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); assert.deepEqual(values[0].parents, ["Fresh parent"]);
  session.text = "# Changed parent\n## Fresh child\n";
  x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "[[Alpha#Fresh parent#Fr");
});

test("subpath scanning and displayed candidates are bounded without creating IDs or scanning oversized target text", () => {
  let inspected = 0;
  const headings = { *[Symbol.iterator]() { while (true) { const heading = "Heading " + inspected++; yield { heading, level: 1, position: { start: { offset: 0 }, end: { offset: 1 } } }; } } };
  const values = model.subpathCompletions(trigger("[[#¦"), "Alpha.md", "# A", { headings, blocks: {} });
  assert.equal(values.length, model.MAX_COMPLETION_RESULTS); assert.ok(inspected <= model.MAX_COMPLETION_SUBPATHS + 1);
  assert.deepEqual(model.subpathCompletions(trigger("[[#¦"), "Alpha.md", "x".repeat(model.MAX_COMPLETION_SOURCE + 1)), []);
  assert.deepEqual(model.subpathCompletions(trigger("[[#^¦"), "Alpha.md", "An unlabelled paragraph.\n"), []);
});

test("subpath plans preserve surrounding Unicode/CRLF and allow empty current-note paths only for current-note triggers", () => {
  const { text, cursor } = atMarker("# Heading λ\r\n\r\n😀 [[#He¦ading λ]] tail\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  const value = model.subpathCompletions(expected, "Source.md", text)[0];
  const plan = model.planBuiltinCompletion(text, cursor, expected, value, "");
  assert.equal(plan.text, text); assert.equal(plan.text.slice(plan.cursor), " tail\r\n");
  assert.throws(() => model.planBuiltinCompletion(text, cursor, expected, { ...value, heading: "Unsafe|heading" }, ""), /safely/);
  const explicit = atMarker("[[Alpha#He¦"), explicitTrigger = model.builtinCompletionTrigger(explicit.text, explicit.cursor);
  assert.throws(() => model.planBuiltinCompletion(explicit.text, explicit.cursor, explicitTrigger, value, ""), /safely/);
  assert.throws(() => model.planBuiltinCompletion(explicit.text.replace("Alpha", "Other"), explicit.cursor, explicitTrigger, value, "Other"), /changed/);
});

test("real cross-note heading/block insertions retain isolated Undo/Redo and destination-safe link preferences", () => {
  for (const [prefix, expected] of [["[[Alpha#He", "[[Folder/Alpha#Heading λ]]"], ["[[Alpha#^known", "[[Folder/Alpha#^known-id]]"]]) {
    const x = fixture("😀\r\n" + prefix, { separator: "\r\n" }), values = x.suggest.getSuggestions(x.suggest.context);
    assert.equal(values.length, 1); assert.equal(values[0].target, x.target);
    x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "😀\r\n" + expected);
    x.editor.undo(); assert.equal(x.editor.getValue(), "😀\r\n" + prefix);
    x.editor.redo(); assert.equal(x.editor.getValue(), "😀\r\n" + expected);
  }
});

test("current-note headings/blocks use live source and keep their empty target path", () => {
  for (const [query, expected] of [["#He", "#Heading λ"], ["#^current", "#^current-id"]]) {
    const text = "# Heading λ\r\n\r\nCurrent paragraph. ^current-id\r\n\r\n[[" + query;
    const x = fixture(text, { separator: "\r\n" });
    x.app.metadataCache.fileToLinktext = () => { throw new Error("Current-note links should retain their empty prefix"); };
    const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); assert.equal(values[0].target, x.source);
    x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), text.slice(0, text.lastIndexOf("[[")) + "[[" + expected + "]]");
    x.editor.undo(); assert.equal(x.editor.getValue(), text);
  }
});

test("subpath providers refuse missing/ambiguous targets and target metadata or source changes behind held rows", () => {
  for (const change of [
    x => x.setTarget("# Replacement heading\n"),
    x => { x.documents.get(x.target.path).cache.headings = []; },
    x => { x.documents.get(x.target.path).missing = true; },
    x => { x.files[1] = { ...x.target }; },
    x => { x.target.path = "Moved.md"; },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: x.app.vault.rootPath, text: "# Edited before indexing\n" }); },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: x.app.vault.rootPath, text: x.documents.get(x.target.path).text, isReloading: true }); },
    x => { x.app.vault.readOnly = true; }, x => { x.cm.dispatch({ effects: x.lock.set(true) }); },
  ]) {
    const x = fixture("[[Alpha#He"), values = x.suggest.getSuggestions(x.suggest.context), before = x.editor.getValue();
    assert.equal(values.length, 1); change(x); x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), before);
  }
  const missing = fixture("[[Missing#He"); assert.deepEqual(missing.suggest.getSuggestions(missing.suggest.context), []);
  const ambiguous = fixture("[[Alpha#He"); ambiguous.files.push({ path: "Other/Alpha.md", vault: ambiguous.app.vault });
  assert.deepEqual(ambiguous.suggest.getSuggestions(ambiguous.suggest.context), []);
  const block = fixture("[[Alpha#^known"), choice = block.suggest.getSuggestions(block.suggest.context)[0];
  delete block.documents.get(block.target.path).cache.blocks["known-id"];
  block.suggest.selectSuggestion(choice); assert.equal(block.editor.getValue(), "[[Alpha#^known");
});

test("dirty target sessions override delayed metadata immediately and refuse a later stale heading selection", () => {
  const x = fixture("[[Alpha#Fresh");
  const session = { originRoot: x.app.vault.rootPath, text: "# Fresh heading\n" };
  x.app.workspace.sessions.set(x.target.path, session);
  const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); assert.equal(values[0].heading, "Fresh heading");
  session.text = "# Fresh replacement\n";
  x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "[[Alpha#Fresh");
});

test("property-value scalar slots preserve exact BOM/CRLF, comments and quoted suffixes", () => {
  for (const source of [
    '\ufeff---\r\nstatus: Op¦en # untouched\r\n---\r\n😀 Body\r\n',
    '\ufeff---\r\nstatus: "Op¦en" # untouched\r\n---\r\n😀 Body\r\n',
    "\ufeff---\r\nstatus: 'Op¦en' # untouched\r\n---\r\n😀 Body\r\n",
  ]) {
    const { text, cursor } = atMarker(source), expected = model.builtinCompletionTrigger(text, cursor);
    assert.equal(expected.kind, "property-value"); assert.equal(expected.property, "status"); assert.equal(expected.query, "Op");
    const choice = model.propertyValueCompletions(expected, ["Open λ"])[0];
    const plan = model.planBuiltinCompletion(text, cursor, expected, choice);
    assert.equal(plan.text, '\ufeff---\r\nstatus: "Open λ" # untouched\r\n---\r\n😀 Body\r\n');
    assert.equal(plan.text.slice(plan.cursor), ' # untouched\r\n---\r\n😀 Body\r\n');
  }
  const empty = atMarker('---\nstatus:   ¦\n---'), expected = model.builtinCompletionTrigger(empty.text, empty.cursor);
  assert.equal(expected.query, ""); assert.equal(model.planBuiltinCompletion(empty.text, empty.cursor, expected, { kind: "property-value", property: "status", value: "true" }).text, '---\nstatus:   "true"\n---');
});

test("property-value flat block/flow lists replace one scalar and exclude existing exact duplicates", () => {
  for (const source of ['---\r\ntags:\r\n  - shared\r\n  - pro¦\r\n---', '---\r\ntags: [shared, pro¦] # retained\r\n---']) {
    const { text, cursor } = atMarker(source), expected = model.builtinCompletionTrigger(text, cursor);
    assert.equal(expected.kind, "property-value"); assert.equal(expected.property, "tags"); assert.deepEqual(expected.existingValues, ["shared"]);
    const values = model.propertyValueCompletions(expected, ["project", "project", "shared", "project λ"]);
    assert.deepEqual(values.map(value => value.value), ["project", "project λ"]);
    const plan = model.planBuiltinCompletion(text, cursor, expected, values[0]);
    assert.equal(plan.text, text.slice(0, expected.from) + '"project"' + text.slice(expected.to));
    assert.throws(() => model.planBuiltinCompletion(text, cursor, expected, { kind: "property-value", property: "tags", value: "shared" }), /already present|matches/);
  }
  assert.equal(trigger('---\ntags:\n  - ¦\n---').query, "");
});

test("property-value triggering declines malformed, nested, tagged, numeric, block/multiline and comment slots", () => {
  for (const source of [
    '---\nstatus: Op¦', '---\nstatus: "Op¦\n---', "---\nstatus: 'Op¦\n---",
    '---\nnested:\n  status: Op¦\n---', '---\nstatus: 12¦\n---', '---\nstatus: true¦\n---', '---\nstatus: null¦\n---',
    '---\nstatus: Op # com¦ment\n---', '---\nstatus: |\n  Op¦\n---', '---\nstatus: >\n  Op¦\n---',
    '---\nstatus: "one\n  Op¦"\n---', '---\nstatus: &anchor Op¦\n---', '---\nstatus: !!str Op¦\n---',
    '---\nstatus: old\nstatus: Op¦\n---', '---\ntags: [[Op¦]]\n---', '---\ntags: [12, Op¦]\n---',
    '---\ntags:\n  - nested: Op¦\n---', '---\n{status: Op¦}\n---',
  ]) assert.equal(trigger(source), null, source);
});

test("property-value completion bounds types, values and results without coercing YAML-sensitive strings", () => {
  const expected = trigger('---\nstatus: ¦\n---');
  for (const value of ['true', 'null', '2026-11-14', '12', 'a: key # hash', 'quoted "value" \\', '[[Some note]]', 'λ 😀']) {
    const source = atMarker('---\nstatus: ¦\n---'), plan = model.planBuiltinCompletion(source.text, source.cursor, expected, { kind: "property-value", property: "status", value });
    assert.equal(parseDocument(plan.text.split('---')[1]).get('status'), value);
  }
  assert.deepEqual(model.propertyValueCompletions(expected, [null, true, 12, {}, ["text"], "", "bad\nline", "x".repeat(model.MAX_COMPLETION_VALUE_LENGTH + 1)]), []);
  let scanned = 0; const source = { *[Symbol.iterator]() { while (true) { scanned++; yield 'value-' + scanned; } } };
  assert.equal(model.propertyValueCompletions(expected, source).length, model.MAX_COMPLETION_RESULTS);
  assert.ok(scanned <= model.MAX_COMPLETION_VALUES + 1);
  let charactersScanned = 0;
  const largeValues = { *[Symbol.iterator]() { for(let index=0;index<100;index++){charactersScanned++;yield 'x'.repeat(1020)+String(index).padStart(4,'0');}yield 'late'; } };
  assert.deepEqual(model.propertyValueCompletions({ ...expected, query: 'late' }, largeValues), []);
  assert.ok(charactersScanned <= model.MAX_COMPLETION_VALUE_CHARACTERS / 1024 + 1);
});

function valueFixture(source = '---\r\nstatus: Op¦\r\n---\r\n😀 Body\r\n') {
  const { text, cursor } = atMarker(source), x = fixture(text, { separator: '\r\n' });
  const before = text.slice(0, cursor), line = before.split('\n').length - 1, ch = before.slice(before.lastIndexOf('\n') + 1).length;
  x.editor.setCursor(line, ch); x.suggest.document = x.cm.state.doc; x.suggest.cursor = x.cm.state.selection.main.head;
  for (const [path, entry] of x.documents) entry.document = { file: { path } };
  x.app.metadataCache.getDocuments = () => [...x.documents.values()].filter(entry => !entry.missing);
  x.setValueTarget = (value = 'Open λ') => {
    x.setTarget('---\r\nstatus: ' + JSON.stringify(value) + '\r\ntags: [project, shared]\r\n---\r\nTarget body.\r\n');
    x.documents.get(x.target.path).document = { file: { path: x.target.path } };
  };
  x.setValueTarget();
  return x;
}

test("property-value real CodeMirror insertion has isolated Undo/Redo, exact source and contributor provenance", () => {
  const x = valueFixture(), before = x.editor.getValue(), values = x.suggest.getSuggestions(x.suggest.context);
  const choice = values.find(value => value.value === 'Open λ');
  assert.ok(choice); assert.equal(choice.target, x.target); assert.equal(choice.targetText, x.documents.get(x.target.path).text);
  x.suggest.selectSuggestion(choice); assert.equal(x.editor.getValue(), before.replace('status: Op', 'status: "Open λ"'));
  x.editor.undo(); assert.equal(x.editor.getValue(), before); x.editor.redo(); assert.equal(x.editor.getValue(), before.replace('status: Op', 'status: "Open λ"'));
});

test("property-value held rows refuse changed/missing/renamed contributors, dirty sessions and lock/read-only/source changes", () => {
  for (const change of [
    x => x.setValueTarget('Closed'), x => { x.documents.get(x.target.path).missing = true; },
    x => { x.files[1] = { ...x.target }; }, x => { x.target.path = 'Moved.md'; },
    x => { x.documents.get(x.target.path).cache.frontmatter.status = 'Changed cache'; },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: x.app.vault.rootPath, text: '---\nstatus: Closed\n---' }); },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: 'other', text: x.documents.get(x.target.path).text }); },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: x.app.vault.rootPath, text: x.documents.get(x.target.path).text, isReloading: true }); },
    x => { x.app.vault.readOnly = true; }, x => { x.cm.composing = true; }, x => { x.cm.dispatch({ effects: x.lock.set(true) }); },
    x => { x.app.vault.rootPath = 'other'; }, x => { x.editor.setCursor(1, 9); },
  ]) {
    const x = valueFixture(), before = x.editor.getValue(), choice = x.suggest.getSuggestions(x.suggest.context).find(value => value.value === 'Open λ');
    assert.ok(choice); change(x); x.suggest.selectSuggestion(choice); assert.equal(x.editor.getValue(), before);
  }
});

test("property-value dirty open sessions take precedence before metadata timers and stale accept is refused", () => {
  const x = valueFixture('---\r\nstatus: Fre¦\r\n---'), session = { originRoot: x.app.vault.rootPath, text: '---\nstatus: Fresh\n---' };
  x.app.workspace.sessions.set(x.target.path, session);
  const values = x.suggest.getSuggestions(x.suggest.context); assert.ok(values.some(value => value.value === 'Fresh'));
  const choice = values.find(value => value.value === 'Fresh'); session.text = '---\nstatus: Fresh replacement\n---';
  x.suggest.selectSuggestion(choice); assert.equal(x.editor.getValue(), '---\r\nstatus: Fre\r\n---');
});

test("property-value raw YAML respects Properties-owned Live Preview and uses exact case-sensitive property names", () => {
  const x = valueFixture(), cursor = x.editor.getCursor(); let properties = true;
  x.app.core = { isEnabled(id) { return id === 'properties' && properties; } };
  x.editor.owner = { app: x.app, getEditingMode() { return 'live-preview'; } };
  assert.equal(x.suggest.onTrigger(cursor, x.editor, x.source), null); assert.deepEqual(x.suggest.getSuggestions(x.suggest.context), []);
  properties = false; assert.equal(x.suggest.onTrigger(cursor, x.editor, x.source).query, 'Op');
  assert.ok(x.suggest.getSuggestions(x.suggest.context).some(value => value.value === 'Open λ'));
  x.documents.get(x.target.path).cache.frontmatter.Status = x.documents.get(x.target.path).cache.frontmatter.status;
  delete x.documents.get(x.target.path).cache.frontmatter.status;
  assert.ok(!x.suggest.getSuggestions(x.suggest.context).some(value => value.value === 'Open λ'));
});

function globalFixture(text = "[[##He", options = {}) {
  const x = fixture(text, options);
  if (options.sourcePath) {
    const entry = x.documents.get(x.source.path); x.documents.delete(x.source.path);
    x.source.path = options.sourcePath; x.suggest.path = x.source.path; x.documents.set(x.source.path, entry);
  }
  x.app.metadataCache.getDocuments = () => [...x.documents].map(([path, entry]) => ({ ...entry, document: { file: { path } } }));
  x.app.metadataCache.fileToLinktext = (file, source) => model.fileLinktext(x.files, file.path, source, true, options.format ?? "shortest");
  return x;
}

test("global heading trigger recognizes only the leading double hash and preserves the full Unicode/CRLF token", () => {
  const { text, cursor } = atMarker("\ufeff😀\r\nBefore ![[##He¦ading λ]] tail\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  assert.deepEqual(expected, { kind: "global-heading", from: text.indexOf("[["), to: text.indexOf("]]") + 2, query: "He" });
  assert.equal(text.slice(expected.from, expected.to), "[[##Heading λ]]");
  assert.equal(trigger("[[##¦").query, "");
  for (const source of ["[[###He¦", "[[Note##He¦", "[[##Head#Ch¦", "[[##He|la¦]]", "[[##He¦ading", "`[[##He¦]]`", "<!-- [[##He¦ -->", "%% [[##He¦ %%", "$[[##He¦]]$", "---\nkey: [[##He¦\n---", "[caption [[##He¦]]](Other.md)"]) {
    assert.equal(trigger(source), null, source);
  }
});

test("global headings keep only first resolver-addressable names and rank across known Markdown notes", () => {
  const texts = [
    ["Zeta.md", "# Heading λ\r\n## **Heading λ**\r\n# Other Heading\r\n# unsafe|heading\r\n# ^looks-like-block\r\n"],
    ["Alpha.md", "# Heading λ\n# Heading small\n"],
    ["Bad|path.md", "# Heading hidden\n"],
    ["image.png", "# Heading hidden\n"],
  ];
  const sources = texts.map(([path, text]) => ({ path, text, cache: model.parseMarkdown(text) }));
  const values = model.globalHeadingCompletions(trigger("[[##Head¦"), sources);
  assert.deepEqual(values.map(value => [value.path, value.heading]), [["Alpha.md", "Heading λ"], ["Zeta.md", "Heading λ"], ["Alpha.md", "Heading small"], ["Zeta.md", "Other Heading"]]);
  for (const value of values) {
    const source = sources.find(item => item.path === value.path);
    assert.equal(model.resolveSubpath(source.cache, "#" + value.heading).start.offset, value.from);
  }
  const longFirst = "# " + "*".repeat(1_100) + "Heading\n# Heading\n";
  assert.deepEqual(model.globalHeadingCompletions(trigger("[[##Heading¦"), [{ path: "Long.md", text: longFirst, cache: model.parseMarkdown(longFirst) }]), []);
});

test("global heading scans bound document count, heading count, characters and retained results", () => {
  const expected = trigger("[[##¦");
  let documents = 0;
  const sources = { *[Symbol.iterator]() { while (true) { const path = "Note" + documents++ + ".md", text = "# Heading"; yield { path, text, cache: model.parseMarkdown(text) }; } } };
  assert.equal(model.globalHeadingCompletions(expected, sources).length, model.MAX_COMPLETION_RESULTS);
  assert.ok(documents <= model.MAX_COMPLETION_GLOBAL_DOCUMENTS + 1);
  let inspected = 0;
  const headings = { *[Symbol.iterator]() { while (true) { const heading = "Heading " + inspected++; yield { heading, position: { start: { offset: 0 }, end: { offset: 1 } } }; } } };
  assert.equal(model.globalHeadingCompletions(expected, [{ path: "Many.md", text: "# Heading", cache: { headings } }]).length, model.MAX_COMPLETION_RESULTS);
  assert.ok(inspected <= model.MAX_COMPLETION_GLOBAL_HEADINGS + 1);
  let characters = 0;
  const longNames = { *[Symbol.iterator]() { for (let i = 0; i < 300; i++) { characters++; yield { heading: "x".repeat(1_020) + String(i).padStart(4, "0"), position: { start: { offset: 0 }, end: { offset: 1 } } }; } yield { heading: "late", position: { start: { offset: 0 }, end: { offset: 1 } } }; } };
  assert.deepEqual(model.globalHeadingCompletions({ ...expected, query: "late" }, [{ path: "Names.md", text: "# x", cache: { headings: longNames } }]), []);
  assert.ok(characters <= model.MAX_COMPLETION_GLOBAL_CHARACTERS / 1_024 + 1);
  assert.deepEqual(model.globalHeadingCompletions(expected, [{ path: "Large.md", text: "x".repeat(model.MAX_COMPLETION_SOURCE + 1), cache: { headings } }]), []);
});

test("global heading plans preserve source bytes and require one safe resolved target path", () => {
  const { text, cursor } = atMarker("\ufeff😀\r\nBefore [[##He¦ading]] tail\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  const value = { kind: "global-heading", path: "Folder/Alpha.md", heading: "Heading λ", from: 0, to: 11 };
  const plan = model.planBuiltinCompletion(text, cursor, expected, value, "Folder/Alpha");
  assert.equal(plan.text, "\ufeff😀\r\nBefore [[Folder/Alpha#Heading λ]] tail\r\n"); assert.equal(plan.text.slice(plan.cursor), " tail\r\n");
  for (const linktext of [undefined, "", "Bad#path", "Bad|path"]) assert.throws(() => model.planBuiltinCompletion(text, cursor, expected, value, linktext), /safely/);
  assert.throws(() => model.planBuiltinCompletion(text, cursor, expected, { ...value, heading: "bad|name" }, "Alpha"), /safely/);
  assert.throws(() => model.planBuiltinCompletion(text.replace("##He", "##No"), cursor, expected, value, "Alpha"), /changed/);
});

test("global heading popup uses real link preferences with exact CRLF and isolated Undo/Redo", () => {
  for (const [format, destination] of [["shortest", "Alpha"], ["absolute", "Folder/Alpha"], ["relative", "../Folder/Alpha"]]) {
    const source = "😀\r\n[[##He", x = globalFixture(source, { separator: "\r\n", format, sourcePath: "Notes/Source.md" });
    const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 1); assert.equal(values[0].target, x.target);
    x.suggest.selectSuggestion(values[0]); assert.equal(x.editor.getValue(), "😀\r\n[[" + destination + "#Heading λ]]");
    x.editor.undo(); assert.equal(x.editor.getValue(), source); x.editor.redo(); assert.equal(x.editor.getValue(), "😀\r\n[[" + destination + "#Heading λ]]");
  }
});

test("global heading choices revalidate full target identity/text/cache and every source write guard", () => {
  for (const change of [
    x => x.setTarget("# Replacement\n"), x => x.setTarget(x.documents.get(x.target.path).text + "Changed body.\n"),
    x => { x.documents.get(x.target.path).cache.headings = []; }, x => { x.documents.get(x.target.path).missing = true; },
    x => { x.files[1] = { ...x.target }; }, x => { x.target.path = "Moved.md"; },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: "other", text: x.documents.get(x.target.path).text }); },
    x => { x.app.workspace.sessions.set(x.target.path, { originRoot: x.app.vault.rootPath, text: x.documents.get(x.target.path).text, isReloading: true }); },
    x => { x.app.vault.readOnly = true; }, x => { x.cm.composing = true; }, x => { x.cm.dispatch({ effects: x.lock.set(true) }); },
    x => { x.app.vault.rootPath = "other"; }, x => { x.files[0] = { ...x.source }; }, x => { x.editor.setCursor(0); },
    x => { x.app.metadataCache.fileToLinktext = () => "Missing"; },
    x => { x.app.metadataCache.fileToLinktext = () => { throw new Error("No unambiguous link spelling"); }; },
  ]) {
    const x = globalFixture(), before = x.editor.getValue(), choice = x.suggest.getSuggestions(x.suggest.context)[0]; assert.ok(choice);
    change(x); x.suggest.selectSuggestion(choice); assert.equal(x.editor.getValue(), before);
  }
});

test("global heading ambiguity is filtered but duplicate basenames remain usable through safe qualified paths", () => {
  const x = globalFixture(), other = { path: "Other/Alpha.md", vault: x.app.vault };
  x.files.push(other); x.documents.set(other.path, { text: "# Heading λ\n", cache: model.parseMarkdown("# Heading λ\n"), missing: false });
  const values = x.suggest.getSuggestions(x.suggest.context); assert.equal(values.length, 2);
  assert.equal(new Set(values.map(value => value.path)).size, 2);
  x.app.metadataCache.fileToLinktext = () => "Alpha";
  assert.deepEqual(x.suggest.getSuggestions(x.suggest.context), [], "ambiguous preferred links never become global choices");
});

test("global headings use current and dirty editor source before metadata timers and bound dirty parsing in aggregate", () => {
  const local = globalFixture("# Self heading\r\n\r\n[[##Self", { separator: "\r\n" }), self = local.suggest.getSuggestions(local.suggest.context)[0];
  assert.equal(self.target, local.source); local.suggest.selectSuggestion(self); assert.equal(local.editor.getValue(), "# Self heading\r\n\r\n[[Source#Self heading]]");
  const x = globalFixture("[[##Fresh"), session = { originRoot: x.app.vault.rootPath, text: "# Fresh heading\n" };
  x.app.workspace.sessions.set(x.target.path, session);
  const choice = x.suggest.getSuggestions(x.suggest.context)[0]; assert.equal(choice.heading, "Fresh heading"); session.text = "# Fresh replacement\n";
  x.suggest.selectSuggestion(choice); assert.equal(x.editor.getValue(), "[[##Fresh");
  const bounded = globalFixture("[[##Late"), other = { path: "Other.md", vault: bounded.app.vault };
  bounded.files.push(other); bounded.documents.set(other.path, { text: "# Existing\n", cache: model.parseMarkdown("# Existing\n"), missing: false });
  bounded.app.workspace.sessions.set(bounded.target.path, { originRoot: bounded.app.vault.rootPath, text: "# Early heading\n" + "x".repeat(model.MAX_COMPLETION_SOURCE / 2) });
  bounded.app.workspace.sessions.set(other.path, { originRoot: bounded.app.vault.rootPath, text: "# Late heading\n" + "x".repeat(model.MAX_COMPLETION_SOURCE / 2) });
  assert.deepEqual(bounded.suggest.getSuggestions(bounded.suggest.context), []);
  bounded.app.workspace.sessions.delete(bounded.target.path);
  assert.equal(bounded.suggest.getSuggestions(bounded.suggest.context)[0].heading, "Late heading");
});

function createNoteFixture(text = "[[New λ", options = {}) {
  const f = fixture(text, { separator: "\r\n" }), config = new Map(Object.entries({ newFileLocation: "root", newFileFolderPath: "/", newLinkFormat: "shortest", useMarkdownLinks: false, ...options }));
  const { app, editor, cm, files, documents, source } = f;
  documents.delete(source.path); source.path = options.sourcePath ?? "Source folder/Source.md";
  documents.set(source.path, { text, cache: model.parseMarkdown(text), missing: false }); f.suggest.path = source.path;
  const folders = new Map(["/", "Source folder", "Inbox", "Deep", "Deep/Source"].map(path => [path, new model.TFolder(app.vault, path)]));
  const session = { originRoot: app.vault.rootPath, text, isReloading: false }; app.workspace.sessions.set(source.path, session);
  const creates = [], notices = [];
  cm.dom = { isConnected: true };
  app.vault.getConfig = key => config.get(key);
  app.vault.getFiles = () => files;
  app.vault.getRoot = () => folders.get("/");
  app.vault.getFolderByPath = path => folders.get(path || "/") ?? null;
  app.vault.getAbstractFileByPathInsensitive = path => {
    const entries = [...files, ...folders.values()].filter(file => file.path.toLowerCase() === path.toLowerCase());
    if (entries.length > 1) throw Error("Ambiguous path"); return entries[0] ?? null;
  };
  app.vault.assertWritable = () => { if (app.vault.readOnly) throw Error("Read-only vault"); };
  app.vault.create = async path => {
    await f.beforeWrite?.(path);
    if (app.vault.getAbstractFileByPathInsensitive(path)) throw Error("A file already exists at " + path);
    const file = new model.TFile(app.vault, { path, basename: path.split("/").at(-1).slice(0, -3), extension: "md", stat: { ctime: 1, mtime: 1, size: 0 } });
    files.push(file); documents.set(path, { text: "", cache: model.parseMarkdown(""), missing: false }); creates.push(file);
    await f.afterWrite?.(file); return file;
  };
  app.workspace.withFileMutation = async action => {
    app.workspace.isChangingFiles = true; cm.dispatch({ effects: f.lock.set(true) }); cm.hasFocus = false;
    try { return await action(); }
    finally { app.workspace.isChangingFiles = false; cm.dispatch({ effects: f.lock.set(false) }); }
  };
  app.metadataCache.refresh = async () => {};
  app.metadataCache.pause = async () => {};
  app.metadataCache.resume = () => {};
  app.metadataCache.resolveReference = (reference, path) => model.resolveLink(files, reference.link, path, reference.kind === "markdown" || reference.kind === "reference");
  app.saveAll = async () => {};
  app.fileManager = new model.FileManager(app);
  f.suggest.createdWithoutLink = path => notices.push(path);
  const context = f.suggest.context;
  const choices = () => f.suggest.getSuggestions(context), choice = () => choices().find(value => value.kind === "create-note");
  return Object.assign(f, { config, folders, session, creates, notices, context, choices, choice });
}

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("missing-heading provider choices edit only the source and retain isolated CRLF Undo", () => {
  const f = fixture("😀\r\n[[Alpha#Future heading λ", { separator: "\r\n" }), before = f.editor.getValue(), target = f.documents.get(f.target.path).text;
  const value = f.suggest.getSuggestions(f.suggest.context).find(value => value.kind === "unresolved-heading");
  assert.ok(value); f.suggest.selectSuggestion(value);
  assert.equal(f.editor.getValue(), "😀\r\n[[Folder/Alpha#Future heading λ]]"); assert.equal(f.documents.get(f.target.path).text, target);
  f.editor.undo(); assert.equal(f.editor.getValue(), before); f.editor.redo(); assert.equal(f.editor.getValue(), "😀\r\n[[Folder/Alpha#Future heading λ]]");
});

test("held missing-heading choices refuse changed target text and newly appeared headings", () => {
  for (const replacement of ["# Future heading λ\r\n", "# Other\r\nBody changed.\r\n"]) {
    const f = fixture("[[Alpha#Future heading λ"), value = f.suggest.getSuggestions(f.suggest.context).find(value => value.kind === "unresolved-heading");
    assert.ok(value); f.setTarget(replacement); f.suggest.selectSuggestion(value); assert.equal(f.editor.getValue(), "[[Alpha#Future heading λ");
  }
});

test("same-note new block references use one disjoint CRLF transaction and one Undo for marker and link", async () => {
  for (const before of ["# Note\r\n\r\nAlpha paragraph λ 😀.\r\n\r\nLink: [[#^Alpha paragraph", "Link: [[#^Alpha paragraph]]\r\n\r\nAlpha paragraph λ 😀.\r\n"]) {
    const f = fixture(before, { separator: "\r\n" });
    if (before.startsWith("Link:")) { f.editor.setCursor(0, before.indexOf("]]")); f.suggest.document = f.cm.state.doc; f.suggest.cursor = f.cm.state.selection.main.head; }
    const value = f.suggest.getSuggestions(f.suggest.context).find(value => value.kind === "create-block"); assert.ok(value);
    await f.suggest.selectSuggestion(value);
    const completed = f.editor.getValue(), id = completed.match(/\^([a-z0-9]{6})/)[1];
    assert.ok(completed.includes("Alpha paragraph λ 😀. ^" + id)); assert.ok(completed.includes("[[#^" + id + "]]"));
    assert.equal(completed.match(new RegExp(id, "g")).length, 2);
    f.editor.undo(); assert.equal(f.editor.getValue(), before); f.editor.redo(); assert.equal(f.editor.getValue(), completed);
  }
});

test("disjoint source replacement refuses stale/overlapping edits without losing an existing Undo step", () => {
  const f = fixture("Alpha\r\n\r\nBeta", { separator: "\r\n" }), before = f.editor.getValue();
  for (const changes of [[], [{ from: 0, to: 4, insert: "x" }, { from: 3, to: 5, insert: "y" }], [{ from: 0, to: 100, insert: "x" }]]) {
    assert.throws(() => f.editor.replaceExpectedChanges(before, changes, "input.complete")); assert.equal(f.editor.getValue(), before);
  }
  assert.throws(() => f.editor.replaceExpectedChanges("stale", [{ from: 0, to: 0, insert: "x" }], "input.complete"));
  assert.equal(f.editor.getValue(), before);
});

function blockWriteFixture() {
  const f = createNoteFixture("[[Alpha#^Alpha paragraph");
  const old = f.target, target = new model.TFile(f.app.vault, { path: old.path, basename: "Alpha", extension: "md", stat: { ctime: 1, mtime: 1, size: 30 } });
  f.files[f.files.indexOf(old)] = target; f.target = target;
  f.setTarget("# Target\r\n\r\nAlpha paragraph λ 😀.\r\n");
  let version = "v1"; const writes = [];
  f.app.vault.getAbstractFileByPath = path => f.app.vault.getFileByPath(path);
  f.app.vault.readDocument = async () => { await f.beforeRead?.(); return { file: { path: target.path }, content: f.documents.get(target.path).text, version, hasBom: true }; };
  f.app.vault.writeDocument = async (path, content, expected, create) => {
    await f.beforeBlockWrite?.(); assert.equal(path, target.path); assert.equal(expected, version); assert.equal(create, false);
    const document = { file: { path }, content, version: "v" + (writes.length + 2), hasBom: true }; version = document.version;
    f.documents.set(path, { text: content, cache: model.parseMarkdown(content), missing: false }); writes.push(document); await f.afterBlockWrite?.(); return document;
  };
  f.app.workspace.acceptExternalDocuments = documents => { f.accepted = documents; };
  f.suggest.blockWithoutLink = path => f.notices.push(path);
  return Object.assign(f, { writes, block: () => f.choices().find(value => value.kind === "create-block") });
}

test("cross-note block assignment uses guarded optimistic writes; source Undo keeps the acknowledged marker", async () => {
  const f = blockWriteFixture(), before = f.editor.getValue(), choice = f.block(); assert.ok(choice);
  await f.suggest.selectSuggestion(choice);
  assert.equal(f.writes.length, 1); assert.equal(f.accepted.length, 1); const id = f.writes[0].content.match(/\^([a-z0-9]{6})/)[1];
  assert.equal(f.editor.getValue(), "[[Folder/Alpha#^" + id + "]]"); assert.equal(f.writes[0].hasBom, true);
  f.editor.undo(); assert.equal(f.editor.getValue(), before); assert.ok(f.documents.get(f.target.path).text.endsWith(" ^" + id + "\r\n"));
  f.editor.redo(); assert.equal(f.editor.getValue(), "[[Folder/Alpha#^" + id + "]]"); assert.deepEqual(f.notices, []);
});

test("cross-note block assignment refuses stale source after held real save preflight", async () => {
  const f = blockWriteFixture(), held = deferred(), before = f.editor.getValue(); f.app.saveAll = () => held.promise;
  const pending = f.suggest.selectSuggestion(f.block()); f.app.workspace.activeEditor = null; held.resolve();
  await assert.rejects(pending, /changed/); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.writes, []); assert.deepEqual(f.notices, []);
});

test("cross-note block assignment refuses physical target replacements observed after the read boundary", async () => {
  const f = blockWriteFixture(), before = f.editor.getValue(); f.beforeRead = () => f.setTarget("# Replaced\r\n\r\nAlpha paragraph changed.\r\n");
  await assert.rejects(f.suggest.selectSuggestion(f.block()), /changed/); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.writes, []);
});

test("acknowledged block markers survive stale source and cleanup failures without inserting held links", async () => {
  for (const cleanup of [false, true]) {
    const f = blockWriteFixture(), before = f.editor.getValue();
    if (cleanup) { f.app.workspace.acceptExternalDocuments = () => { throw Error("block cleanup failed"); }; }
    else { f.afterBlockWrite = () => { f.app.workspace.activeEditor = null; }; }
    const pending = f.suggest.selectSuggestion(f.block()); if (cleanup) await assert.rejects(pending, /block cleanup failed/); else await pending;
    assert.equal(f.writes.length, 1); assert.match(f.writes[0].content, /\^[a-z0-9]{6}\r\n$/); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.notices, [f.target.path]);
  }
});

test("a target change observed after block write acknowledgement prevents a held source link", async () => {
  const f = blockWriteFixture(), before = f.editor.getValue(); f.afterBlockWrite = () => f.setTarget("# External\r\n\r\nThe identified paragraph was removed.\r\n");
  await f.suggest.selectSuggestion(f.block());
  assert.equal(f.writes.length, 1); assert.equal(f.editor.getValue(), before); assert.equal(f.documents.get(f.target.path).text, "# External\r\n\r\nThe identified paragraph was removed.\r\n");
  assert.deepEqual(f.notices, [f.target.path]);
});

function headingWriteFixture(subpath = "Future heading λ 😀", options = {}) {
  const f = blockWriteFixture(), text = "\ufeff😀 Source\r\n\r\n[[Alpha#" + subpath;
  f.editor.replaceExpected(f.editor.getValue(), 0, f.editor.getValue().length, text, "input.fixture");
  f.editor.setCursor(2, f.editor.getLine(2).length); f.session.text = text;
  f.suggest.document = f.cm.state.doc; f.suggest.cursor = f.cm.state.selection.main.head;
  f.editor.owner = { app: f.app, getMode: () => "source", getEditingMode: () => options.mode ?? "source" };
  f.config.set("newLinkFormat", options.format ?? "shortest");
  f.app.metadataCache.fileToLinktext = (target, source) => model.fileLinktext(f.files, target.path, source, true, f.config.get("newLinkFormat"));
  const targetSession = { originRoot: f.app.vault.rootPath, text: f.documents.get(f.target.path).text, dirty: false, isReloading: false };
  f.app.workspace.sessions.set(f.target.path, targetSession);
  f.app.workspace.acceptExternalDocuments = documents => { f.accepted = documents; targetSession.text = documents[0].content; };
  f.suggest.headingWithoutLink = path => f.notices.push(path);
  return Object.assign(f, { targetSession, heading: () => f.choices().find(value => value.kind === "create-heading") });
}

test("missing-heading link and explicit Create heading are distinct; ordinary acceptance never changes the destination", async () => {
  const f = headingWriteFixture(), values = f.choices(), before = f.documents.get(f.target.path).text;
  assert.deepEqual(values.map(value => value.kind), ["unresolved-heading", "create-heading"]);
  assert.equal(values[1].preview, "# Future heading λ 😀"); assert.equal(values[1].path, f.target.path);
  await f.suggest.selectSuggestion(values[0]);
  assert.equal(f.editor.getValue(), "\ufeff😀 Source\r\n\r\n[[Alpha#Future heading λ 😀]]");
  assert.equal(f.documents.get(f.target.path).text, before); assert.deepEqual(f.writes, []);
});

test("same-note explicit root and hierarchical heading creation uses one isolated source transaction in both editing modes", async () => {
  for (const mode of ["source", "live-preview"]) for (const original of [
    "\ufeff---\r\nstatus: Keep\r\n---\r\n# Existing λ\r\n\r\nLink: [[#Future heading λ 😀",
    "# Parent\r\n\r\n## Branch\r\n\r\nUntouched prose.\r\n\r\n# Other\r\n\r\nLink: [[#Parent#Branch#Future heading λ 😀",
  ]) {
    const f = fixture(original, { separator: "\r\n" });
    f.editor.owner = { app: f.app, getMode: () => "source", getEditingMode: () => mode };
    const value = f.suggest.getSuggestions(f.suggest.context).find(value => value.kind === "create-heading"); assert.ok(value);
    await f.suggest.selectSuggestion(value); const completed = f.editor.getValue();
    assert.ok(completed.includes("[[#" + value.subpath + "]]")); assert.ok(completed.includes(value.preview + "\r\n"));
    const cache = model.parseMarkdown(completed), resolved = model.resolveSubpath(cache, "#" + value.subpath);
    assert.equal(cache.headings.find(heading => heading.position.start.offset === resolved.start.offset).heading, value.heading);
    if (value.parents) assert.ok(completed.indexOf(value.preview) < completed.indexOf("# Other"), "a child stays inside its chosen subtree");
    assert.equal(f.editor.getLine(f.editor.getCursor().line).slice(0, f.editor.getCursor().ch).endsWith("]]"), true);
    f.editor.undo(); assert.equal(f.editor.getValue(), original); f.editor.redo(); assert.equal(f.editor.getValue(), completed);
  }
});

test("cross-note Create heading uses real provider, Editor and FileManager, with clean target sync and source-only Undo", async () => {
  for (const mode of ["source", "live-preview"]) for (const format of ["shortest", "absolute", "relative"]) {
    const f = headingWriteFixture("Target#Child λ 😀", { mode, format });
    const before = f.editor.getValue(), target = f.documents.get(f.target.path).text, choice = f.heading(); assert.ok(choice);
    await f.suggest.selectSuggestion(choice); const written = target + "\r\n## Child λ 😀\r\n";
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].content, written); assert.equal(f.writes[0].hasBom, true);
    assert.equal(f.accepted[0], f.writes[0]); assert.equal(f.targetSession.text, written);
    const linktext = model.fileLinktext(f.files, f.target.path, f.source.path, true, format), completed = before.replace("[[Alpha#Target#Child λ 😀", "[[" + linktext + "#Target#Child λ 😀]]");
    assert.equal(f.editor.getValue(), completed); assert.deepEqual(f.notices, []);
    f.editor.undo(); assert.equal(f.editor.getValue(), before); assert.equal(f.documents.get(f.target.path).text, written);
    f.editor.redo(); assert.equal(f.editor.getValue(), completed); assert.equal(f.writes.length, 1);
  }
});

test("dirty targets, incomplete metadata, unsafe titles, duplicate ancestors and stale source sessions suppress only Create heading", async () => {
  for (const change of [
    f => { f.targetSession.dirty = true; }, f => { f.targetSession.text += " changed"; },
    f => { f.targetSession.originRoot = "foreign"; }, f => { f.targetSession.isReloading = true; },
    f => { f.documents.delete(f.target.path); }, f => { f.session.text += " changed"; },
    f => { f.cm.dom.isConnected = false; }, f => { f.app.vault.readOnly = true; },
  ]) {
    const f = headingWriteFixture(), held = f.heading(), before = f.editor.getValue(); change(f);
    assert.equal(f.heading(), undefined); await f.suggest.selectSuggestion(held);
    assert.equal(f.editor.getValue(), before); assert.deepEqual(f.writes, []);
  }
  for (const title of ["**bold**", "<unsafe>", "under_score"]) assert.equal(headingWriteFixture(title).heading(), undefined);
  const duplicate = headingWriteFixture("Target#New"); duplicate.setTarget("# Target\r\n\r\n# Target\r\n"); duplicate.targetSession.text = duplicate.documents.get(duplicate.target.path).text;
  assert.equal(duplicate.heading(), undefined);
});

test("held Create heading values revalidate exact title, path, offset, preview, ancestry and source identities", async () => {
  for (const change of [
    (f, value) => { value.heading = "Other"; }, (f, value) => { value.path = "Other.md"; },
    (f, value) => { value.from = 0; }, (f, value) => { value.preview = "# Other"; }, (f, value) => { value.parents = ["Other"]; },
    f => { f.setTarget(f.documents.get(f.target.path).text + "# Future heading λ 😀\r\n"); },
    f => { f.files[f.files.indexOf(f.target)] = { ...f.target }; }, f => { f.target.path = "Renamed.md"; },
    f => { f.app.workspace.activeEditor = { ...f.app.workspace.activeEditor }; }, f => { f.editor.setCursor(0, 0); },
    f => { f.app.vault.rootPath = "other"; }, f => { f.app.changingVault = true; },
  ]) {
    const f = headingWriteFixture(), held = { ...f.heading() }, before = f.editor.getValue(); change(f, held);
    await f.suggest.selectSuggestion(held); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.writes, []);
  }
});

test("held real FileManager preflight refuses changed source/target/session/preferences without a heading write", async () => {
  for (const change of [
    f => { f.app.workspace.activeEditor = null; }, f => { f.editor.setCursor(0, 0); }, f => { f.cm.dom.isConnected = false; },
    f => { f.cm.composing = true; }, f => { f.config.set("newLinkFormat", "absolute"); }, f => { f.config.set("useMarkdownLinks", true); },
    f => { f.session.isReloading = true; }, f => { f.app.workspace.sessions.set(f.source.path, { ...f.session }); },
    f => { f.app.workspace.sessions.set(f.target.path, { ...f.targetSession }); }, f => { f.targetSession.dirty = true; },
    f => { f.setTarget("# Newer target\r\n"); }, f => { f.app.vault.rootPath = "changed"; },
  ]) {
    const f = headingWriteFixture(), gate = deferred(); f.app.saveAll = () => gate.promise;
    const operation = f.suggest.selectSuggestion(f.heading()); change(f); const before = f.editor.getValue(); gate.resolve();
    await assert.rejects(operation, /changed|loading/); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.writes, []); assert.deepEqual(f.notices, []);
  }
});

test("optimistic heading conflicts preserve the newer target and the unchanged source", async () => {
  const f = headingWriteFixture(), before = f.editor.getValue(), newer = "# Newer external target λ 😀\r\n";
  f.app.vault.writeDocument = async () => { f.setTarget(newer); throw Error("Optimistic version conflict"); };
  await assert.rejects(f.suggest.selectSuggestion(f.heading()), /version conflict/);
  assert.equal(f.editor.getValue(), before); assert.equal(f.documents.get(f.target.path).text, newer); assert.deepEqual(f.notices, []); assert.deepEqual(f.writes, []);
});

test("acknowledged headings survive stale owners, newer target bytes and every cleanup failure without a success link", async () => {
  for (const failure of ["owner", "target", "accept", "refresh", "finalizer"]) {
    const f = headingWriteFixture(), before = f.editor.getValue(), newer = "# Later external target λ 😀\r\n";
    if (failure === "owner") f.afterBlockWrite = () => { f.app.workspace.activeEditor = null; };
    if (failure === "target") f.afterBlockWrite = () => { f.setTarget(newer); };
    if (failure === "accept") f.app.workspace.acceptExternalDocuments = () => { throw Error("Post-write accept failed"); };
    if (failure === "refresh") { let refreshes = 0; f.app.metadataCache.refresh = async () => { if (++refreshes === 2) throw Error("Post-write refresh failed"); }; }
    if (failure === "finalizer") { const mutate = f.app.workspace.withFileMutation; f.app.workspace.withFileMutation = async action => { await mutate(action); throw Error("Post-write finalizer failed"); }; }
    const operation = f.suggest.selectSuggestion(f.heading());
    if (["accept", "refresh", "finalizer"].includes(failure)) await assert.rejects(operation, /Post-write/); else await operation;
    assert.equal(f.writes.length, 1); assert.ok(f.writes[0].content.endsWith("# Future heading λ 😀\r\n"));
    assert.equal(f.editor.getValue(), before); assert.deepEqual(f.notices, [f.target.path]);
    assert.equal(f.documents.get(f.target.path).text, failure === "target" ? newer : f.writes[0].content);
  }
});

test("pending heading creation closes, suppresses double accept and resumes only after its single target write", async () => {
  const f = headingWriteFixture(), gate = deferred(); f.app.saveAll = () => gate.promise;
  const choice = f.heading(), before = f.editor.getValue(), operation = f.suggest.selectSuggestion(choice);
  assert.equal(f.suggest.context, null); assert.equal(f.suggest.selectSuggestion(choice), undefined);
  assert.deepEqual(f.choices(), []); assert.equal(f.suggest.onTrigger(f.editor.getCursor(), f.editor, f.source), null);
  assert.equal(f.editor.getValue(), before); gate.resolve(); await operation;
  assert.equal(f.writes.length, 1); assert.equal(f.editor.getValue(), before + "]]");
});

test("missing ancestor chain choices preserve the ordinary source-only Link action before explicit creation", async () => {
  const f = headingWriteFixture("New parent λ#New branch 😀#New leaf"), values = f.choices(), target = f.documents.get(f.target.path).text;
  assert.deepEqual(values.map(value => value.kind), ["unresolved-heading", "create-heading"]);
  assert.deepEqual(values[1].newHeadings.map(value => [value.heading, value.level]), [["New parent λ", 1], ["New branch 😀", 2], ["New leaf", 3]]);
  await f.suggest.selectSuggestion(values[0]); assert.equal(f.writes.length, 0); assert.equal(f.documents.get(f.target.path).text, target);
  assert.equal(f.editor.getValue(), "\ufeff😀 Source\r\n\r\n[[Alpha#New parent λ#New branch 😀#New leaf]]");
});

test("same-note missing ancestor chains before or after the source link share a single exact Undo in both editing modes", async () => {
  for (const mode of ["source", "live-preview"]) for (const rooted of [false, true]) {
    const subpath = rooted ? "Parent#Branch#New ancestor λ#New leaf 😀" : "New parent λ#New branch#New leaf 😀";
    const original = "\ufeff---\r\nstatus: Keep\r\n---\r\n# Parent\r\n\r\n## Branch\r\n\r\nKeep nested prose.\r\n\r\n# Other\r\n\r\nLink: [[#" + subpath;
    const f = fixture(original, { separator: "\r\n" }); f.editor.owner = { app: f.app, getMode: () => "source", getEditingMode: () => mode };
    const value = f.suggest.getSuggestions(f.suggest.context).find(value => value.kind === "create-heading"); assert.ok(value?.newHeadings);
    await f.suggest.selectSuggestion(value);
    const linked = original + "]]", completed = rooted
      ? linked.replace("# Other", "### New ancestor λ\r\n\r\n#### New leaf 😀\r\n\r\n# Other")
      : linked + "\r\n\r\n# New parent λ\r\n\r\n## New branch\r\n\r\n### New leaf 😀\r\n";
    assert.equal(f.editor.getValue(), completed);
    const cache = model.parseMarkdown(completed);
    for (const created of value.newHeadings) {
      const destination = model.resolveSubpath(cache, "#" + created.subpath);
      assert.equal(cache.headings.find(entry => entry.position.start.offset === destination.start.offset).level, created.level);
    }
    assert.equal(f.editor.getLine(f.editor.getCursor().line).slice(0, f.editor.getCursor().ch).endsWith("]]"), true);
    f.editor.undo(); assert.equal(f.editor.getValue(), original); f.editor.redo(); assert.equal(f.editor.getValue(), completed);
  }
});

test("actual cross-note chain creation reuses the unique prefix, writes once and retains every ancestor through source Undo", async () => {
  for (const mode of ["source", "live-preview"]) for (const format of ["shortest", "relative", "absolute"]) {
    const subpath = "Target#New branch λ#New leaf 😀", f = headingWriteFixture(subpath, { mode, format });
    const target = "# Target\r\n\r\nOriginal body λ 😀.\r\n\r\n# Sibling\r\nUnrelated.\r\n";
    f.setTarget(target); f.targetSession.text = target;
    const value = f.heading(), before = f.editor.getValue(); assert.equal(value.newHeadings.length, 2);
    await f.suggest.selectSuggestion(value);
    const written = target.replace("# Sibling", "## New branch λ\r\n\r\n### New leaf 😀\r\n\r\n# Sibling");
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].content, written); assert.equal(f.accepted[0], f.writes[0]);
    assert.equal(f.targetSession.text, written); assert.equal(f.writes[0].hasBom, true);
    const linktext = model.fileLinktext(f.files, f.target.path, f.source.path, true, format), completed = before.replace("[[Alpha#" + subpath, "[[" + linktext + "#" + subpath + "]]");
    assert.equal(f.editor.getValue(), completed); f.editor.undo(); assert.equal(f.editor.getValue(), before); assert.equal(f.documents.get(f.target.path).text, written);
    f.editor.redo(); assert.equal(f.editor.getValue(), completed); assert.equal(f.writes.length, 1);
  }
});

test("retained chain choices reject omitted/reordered ancestors and newly appeared prefix proofs before writing", async () => {
  for (const change of [
    (f, value) => { value.newHeadings = undefined; }, (f, value) => { value.newHeadings = [...value.newHeadings].reverse(); },
    (f, value) => { value.newHeadings = value.newHeadings.map((entry, index) => index ? entry : { ...entry, level: 5 }); },
    f => { const text = f.documents.get(f.target.path).text + "\r\n## New branch λ\r\n"; f.setTarget(text); f.targetSession.text = text; },
    f => { const text = f.documents.get(f.target.path).text + "\r\n# Target#New branch λ\r\n"; f.setTarget(text); f.targetSession.text = text; },
    f => { f.editor.replaceRange("x", f.editor.getCursor()); f.session.text = f.editor.getValue(); f.suggest.document = f.cm.state.doc; f.suggest.cursor = f.cm.state.selection.main.head; },
  ]) {
    const f = headingWriteFixture("Target#New branch λ#New leaf 😀"), value = { ...f.heading() }; assert.ok(value.newHeadings);
    change(f, value); const before = f.editor.getValue(); await f.suggest.selectSuggestion(value);
    assert.equal(f.editor.getValue(), before); assert.deepEqual(f.writes, []);
  }
});

test("a held real chain preflight rejects a newly appeared ancestor while preserving every external byte", async () => {
  const f = headingWriteFixture("Target#New branch λ#New leaf 😀"), gate = deferred(), before = f.editor.getValue(); f.app.saveAll = () => gate.promise;
  const operation = f.suggest.selectSuggestion(f.heading()), external = "# Target\r\n\r\n## New branch λ\r\n\r\nExternal body 😀.\r\n";
  f.setTarget(external); f.targetSession.text = external; gate.resolve(); await assert.rejects(operation, /changed/);
  assert.deepEqual(f.writes, []); assert.equal(f.editor.getValue(), before); assert.equal(f.documents.get(f.target.path).text, external);
});

test("acknowledged chains retain all ancestors or newer target bytes after stale source/cleanup without a held source link", async () => {
  for (const failure of ["source", "target", "cleanup"]) {
    const f = headingWriteFixture("Target#New branch λ#New leaf 😀"), before = f.editor.getValue();
    const external = "# Target\r\n\r\n## New branch λ\r\n\r\nExternal replacement 😀.\r\n";
    if (failure === "source") f.afterBlockWrite = () => { f.app.workspace.activeEditor = null; };
    if (failure === "target") f.afterBlockWrite = () => { f.setTarget(external); };
    if (failure === "cleanup") f.app.workspace.acceptExternalDocuments = () => { throw Error("Post-chain cleanup failed"); };
    const operation = f.suggest.selectSuggestion(f.heading()); if (failure === "cleanup") await assert.rejects(operation, /Post-chain/); else await operation;
    assert.equal(f.writes.length, 1); assert.ok(f.writes[0].content.endsWith("## New branch λ\r\n\r\n### New leaf 😀\r\n"));
    assert.equal(f.editor.getValue(), before); assert.deepEqual(f.notices, [f.target.path]);
    assert.equal(f.documents.get(f.target.path).text, failure === "target" ? external : f.writes[0].content);
  }
});

test("the read-only chain helper exercises both actual prefixes and modes through the real Editor and provider", async () => {
  const text = "# Read only\r\n\r\n" + headingChainsReadOnlyFixture.sourcePrefixes.join("\r\n\r\n") + "\r\n", f = fixture(text, { separator: "\r\n" });
  f.documents.delete(f.target.path); f.target.path = "Known target.md"; f.setTarget("# Existing heading\r\n\r\nCached target λ 😀.\r\n");
  f.app.vault.readOnly = true; f.app.vault.getFiles = () => f.files; f.app.editor = f.editor; f.cm.focus = () => {};
  f.suggest.containerEl = { dataset: { builtinSuggest: "source" } }; f.app.editorSuggestions = { suggests: [f.suggest] };
  f.app.metadataCache.getCache = path => f.documents.get(path)?.cache; f.app.workspace.getActiveFile = () => f.source;
  let mode = "source"; const modes = [], commands = [];
  f.editor.owner = { getEditingMode: () => mode };
  f.app.workspace.activeLeaf = { view: { setEditingMode: value => { mode = value; modes.push(value); } } };
  const evaluate = expression => new Function("app", "document", "return (" + expression + ")")(f.app, { querySelector: () => null });
  const report = { checks: [] };
  await checkHeadingChainsReadOnly({ evaluate, command: async (method, parameters) => { commands.push({ method, parameters }); }, wait: async expression => assert.equal(Boolean(evaluate(expression)), true), report });
  assert.deepEqual(modes, ["source", "live-preview", "source", "live-preview"]);
  assert.equal(commands.filter(value => value.method === "Input.insertText").length, 4); assert.equal(commands.filter(value => value.parameters?.key === "Enter" && value.parameters.type === "rawKeyDown").length, 4);
  assert.equal(f.editor.getValue(), text); assert.equal(f.documents.get(f.target.path).text, "# Existing heading\r\n\r\nCached target λ 😀.\r\n"); assert.equal(report.headingChainsReadOnly.actualRootAndExistingPrefixQueries, true);
});

test("explicit create choices require a complete supported wikilink path and preserve Unicode/CRLF token boundaries", () => {
  const source = "Deep/Source/Note.md", { text, cursor } = atMarker("\ufeff😀\r\n[[../../New λ¦]] tail\r\n"), expected = model.builtinCompletionTrigger(text, cursor);
  const value = model.createNoteCompletion(text, cursor, expected, "New λ.md", source);
  assert.deepEqual(value, { kind: "create-note", path: "New λ.md", name: "../../New λ" });
  const plan = model.planCreateNoteCompletion(text, cursor, expected, value, "[[../../New λ]]", source);
  assert.equal(plan.text, "\ufeff😀\r\n[[../../New λ]] tail\r\n"); assert.equal(plan.cursor, text.indexOf(" tail"));
  for (const input of ["[[¦", "[[  ¦", "[[New¦ suffix]]", "[[Name/¦", "[[Name/.¦", "[[Name/..¦", "[[Picture.png¦", "[[CON¦", "[[https://example.test¦", "[[../../../Outside¦", "[[\ud800¦", "[[#Heading¦", "[[##Heading¦", "[[#^block¦"]) {
    const inputSource = atMarker(input), trigger = model.builtinCompletionTrigger(inputSource.text, inputSource.cursor);
    assert.equal(trigger && model.createNoteCompletion(inputSource.text, inputSource.cursor, trigger, "Safe.md", source), null, input);
  }
  assert.throws(() => model.planCreateNoteCompletion(text + "changed", cursor + 1, expected, value, "[[New λ]]", source), /changed/);
  for (const insert of ["[[New λ]] text", "[[New λ]][[Other]]", "![[New λ]]", "<a href=x>New</a>"]) assert.throws(() => model.planCreateNoteCompletion(text, cursor, expected, value, insert, source), /supported link/);
});

test("create action remains distinct and follows existing fuzzy rows while exact notes and every exact alias suppress creation", () => {
  const f = createNoteFixture("[[Al"), choices = f.choices();
  assert.deepEqual(choices.filter(value => value.kind !== "create-note").map(value => value.kind), ["link", "link"]);
  assert.equal(choices.at(-1).kind, "create-note"); assert.equal(choices.at(-1).path, "Al.md");
  for (const query of ["Alpha", "alpha.md", "Alpine", "ALPINE.md", "Folder/Alpha"]) assert.equal(createNoteFixture("[[" + query).choice(), undefined, query);
  const ambiguous = createNoteFixture("[[Shared alias");
  for (const target of [ambiguous.source, ambiguous.target]) ambiguous.documents.set(target.path, { text: "---\naliases: [Shared alias]\n---\n", cache: model.parseMarkdown("---\naliases: [Shared alias]\n---\n") });
  assert.equal(ambiguous.choice(), undefined);
  const folderCollision = createNoteFixture(); folderCollision.folders.set("New λ.md", new model.TFolder(folderCollision.app.vault, "New λ.md")); assert.equal(folderCollision.choice(), undefined);
  const bounded = createNoteFixture(); bounded.app.vault.getMarkdownFiles = () => Array.from({ length: model.MAX_COMPLETION_CANDIDATES + 1 }, (_, index) => ({ path: `Other/${index}.md` })); assert.equal(bounded.choice(), undefined, "an incomplete alias inventory cannot prove a missing note");
});

test("new-note placement uses real FileManager root/current/folder/fallback and explicit safe paths", () => {
  for (const [options, query, path] of [
    [{ newFileLocation: "root" }, "New λ", "New λ.md"], [{ newFileLocation: "current" }, "New λ", "Source folder/New λ.md"],
    [{ newFileLocation: "folder", newFileFolderPath: "Inbox" }, "New λ", "Inbox/New λ.md"],
    [{ newFileLocation: "folder", newFileFolderPath: "Missing" }, "New λ", "New λ.md"],
    [{ newFileLocation: "current" }, "Explicit/深い.md", "Explicit/深い.md"],
    [{ sourcePath: "Deep/Source/Source.md" }, "../../Peer", "Peer.md"],
  ]) { const f = createNoteFixture("[[" + query, options); assert.equal(f.choice()?.path, path); assert.equal(f.creates.length, 0, "enumeration only reviews the destination"); }
});

test("create-only success inserts one destination-correct link using real preferences and exact isolated Undo/Redo", async () => {
  for (const options of [
    { newFileLocation: "root", newLinkFormat: "shortest" },
    { newFileLocation: "current", newLinkFormat: "absolute" },
    { newFileLocation: "folder", newFileFolderPath: "Inbox", newLinkFormat: "relative", useMarkdownLinks: true },
  ]) {
    const original = "\ufeff😀 Source\r\n\r\n[[New λ", f = createNoteFixture(original, options), value = f.choice();
    assert.ok(value); await f.suggest.selectSuggestion(value);
    assert.equal(f.creates.length, 1); assert.deepEqual(f.notices, []);
    const created = f.creates[0], link = f.app.fileManager.generateMarkdownLink(created, f.source.path), completed = original.replace("[[New λ", link);
    assert.equal(f.editor.getValue(), completed); assert.equal(f.app.workspace.activeEditor.file, f.source, "creation retains the source owner without navigation");
    assert.equal(f.documents.get(created.path).text, "");
    const reference = model.parseMarkdown(link).links[0]; assert.equal(f.app.metadataCache.resolveReference(reference, f.source.path)?.file, created);
    assert.deepEqual(f.editor.getCursor(), { line: 2, ch: link.length });
    f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.equal(f.creates.length, 1, "Undo only undoes the source link and retains the new note");
    f.editor.redo(); assert.equal(f.editor.getValue(), completed); assert.equal(f.creates.length, 1);
    if (options.useMarkdownLinks) assert.equal(link, "[New λ](../Inbox/New%20%CE%BB.md)");
  }
});

test("a pending creation closes immediately, rejects double acceptance and suppresses retriggering until its single write completes", async () => {
  const f = createNoteFixture(), gate = deferred(); f.app.saveAll = () => gate.promise;
  const value = f.choice(), before = f.editor.getValue(), operation = f.suggest.selectSuggestion(value);
  assert.equal(f.suggest.context, null); assert.equal(f.suggest.selectSuggestion(value), undefined);
  assert.deepEqual(f.suggest.getSuggestions(f.context), []); assert.equal(f.suggest.onTrigger(f.editor.getCursor(), f.editor, f.source), null);
  assert.equal(f.editor.getValue(), before); assert.equal(f.creates.length, 0);
  gate.resolve(); await operation; assert.equal(f.creates.length, 1); assert.equal(f.editor.getValue(), "[[New λ]]");
});

test("held creation refuses changed source/root/session/preferences/selection/identity before its create-only write", async () => {
  for (const change of [
    f => { f.editor.replaceRange(" changed", f.editor.getCursor()); }, f => { f.editor.setCursor(0, 0); },
    f => { f.app.workspace.activeEditor = { ...f.app.workspace.activeEditor }; }, f => { f.files[0] = { ...f.source }; },
    f => { f.source.path = "Renamed.md"; }, f => { f.cm.dom.isConnected = false; }, f => { f.cm.composing = true; },
    f => { f.app.vault.rootPath = "another-vault"; }, f => { f.app.changingVault = true; }, f => { f.app.vault.readOnly = true; },
    f => { f.app.workspace.sessions.set(f.source.path, { ...f.session }); }, f => { f.session.isReloading = true; },
    f => { f.config.set("newFileLocation", "current"); }, f => { f.config.set("newLinkFormat", "absolute"); }, f => { f.config.set("useMarkdownLinks", true); },
  ]) {
    const f = createNoteFixture(), gate = deferred(); f.app.saveAll = () => gate.promise;
    const operation = f.suggest.selectSuggestion(f.choice()); change(f); const before = f.editor.getValue();
    gate.resolve(); await assert.rejects(operation, /changed|loading|read.only/i);
    assert.equal(f.creates.length, 0); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.notices, []);
  }
});

test("failed create and a physical collision race preserve all source and destination data without inserting or navigating", async () => {
  for (const collision of [false, true]) {
    const f = createNoteFixture(), gate = deferred(), started = deferred(), before = f.editor.getValue(), owner = f.app.workspace.activeEditor;
    f.beforeWrite = async () => { started.resolve(); await gate.promise; if (!collision) throw Error("Injected create failure"); };
    const operation = f.suggest.selectSuggestion(f.choice()); await started.promise;
    if (collision) {
      f.files.push({ path: "New λ.md", vault: f.app.vault }); f.documents.set("New λ.md", { text: "\ufeffExisting\r\n深い", cache: model.parseMarkdown("Existing") });
    }
    gate.resolve(); await assert.rejects(operation, /failure|already exists/);
    assert.equal(f.editor.getValue(), before); assert.equal(f.app.workspace.activeEditor, owner); assert.equal(f.creates.length, 0); assert.deepEqual(f.notices, []);
    if (collision) assert.equal(f.documents.get("New λ.md").text, "\ufeffExisting\r\n深い");
  }
});

test("an acknowledged creation retained after a stale owner or unresolvable generated link reports the kept note without editing source", async () => {
  for (const change of [
    f => { f.editor.replaceRange(" later", f.editor.getCursor()); }, f => { f.app.workspace.activeEditor = null; },
    f => { f.app.vault.rootPath = "changed-root"; }, f => { f.app.fileManager.generateMarkdownLink = () => "[[Wrong destination]]"; },
  ]) {
    const f = createNoteFixture(), gate = deferred(), wrote = deferred(); f.afterWrite = async () => { wrote.resolve(); await gate.promise; };
    const operation = f.suggest.selectSuggestion(f.choice()); await wrote.promise; change(f); const before = f.editor.getValue();
    gate.resolve(); await operation;
    assert.equal(f.creates.length, 1); assert.equal(f.files.includes(f.creates[0]), true); assert.equal(f.documents.get("New λ.md").text, "");
    assert.equal(f.editor.getValue(), before); assert.deepEqual(f.notices, ["New λ.md"]);
  }
});

test("read-only/noneditable and stale source sessions never expose or execute a Create note action", async () => {
  for (const change of [
    f => { f.app.vault.readOnly = true; }, f => { f.cm.dispatch({ effects: f.lock.set(true) }); },
    f => { f.app.changingVault = true; }, f => { f.app.workspace.isChangingFiles = true; },
    f => { f.session.isReloading = true; }, f => { f.session.originRoot = "foreign"; }, f => { f.session.text += "changed"; },
  ]) {
    const f = createNoteFixture(), value = f.choice(), before = f.editor.getValue(); change(f);
    assert.equal(f.choice(), undefined); await f.suggest.selectSuggestion(value);
    assert.equal(f.creates.length, 0); assert.equal(f.editor.getValue(), before);
  }
});

test("create-note proof uses dirty alias contributors before metadata timers and refuses incomplete dirty/alias inventories", () => {
  const f = createNoteFixture("[[Unpublished alias"); assert.ok(f.choice());
  f.app.workspace.sessions.set(f.target.path, { originRoot: f.app.vault.rootPath, isReloading: false, text: "---\naliases: [Unpublished alias]\n---\n" });
  assert.equal(f.choice(), undefined, "an unsaved exact alias must not become a second note");
  for (const text of ["x".repeat(model.MAX_COMPLETION_SOURCE + 1), "---\naliases: [" + "x".repeat(model.MAX_COMPLETION_SOURCE) + "]\n---\n"]) {
    const bounded = createNoteFixture(); bounded.app.workspace.sessions.set(bounded.target.path, { originRoot: bounded.app.vault.rootPath, isReloading: false, text });
    assert.equal(bounded.choice(), undefined);
  }
  const oversized = createNoteFixture(); oversized.documents.get(oversized.target.path).cache.frontmatter = { aliases: ["x".repeat(model.MAX_COMPLETION_SOURCE + 1)] }; assert.equal(oversized.choice(), undefined);
});

test("a successful create receipt survives later metadata-refresh or outer-finalizer failure without a source success edit", async () => {
  for (const finish of ["refresh", "outer finalizer"]) {
    const f = createNoteFixture(), before = f.editor.getValue();
    if (finish === "refresh") {
      let refreshes = 0; f.app.metadataCache.refresh = async () => { if (++refreshes === 2) throw Error("Post-write metadata refresh failed"); };
    } else {
      const mutation = f.app.workspace.withFileMutation; f.app.workspace.withFileMutation = async action => { await mutation(action); throw Error("Post-write outer finalizer failed"); };
    }
    await assert.rejects(f.suggest.selectSuggestion(f.choice()), /Post-write/);
    assert.equal(f.creates.length, 1); assert.equal(f.files.includes(f.creates[0]), true); assert.equal(f.documents.get("New λ.md").text, "");
    assert.equal(f.editor.getValue(), before); assert.deepEqual(f.notices, ["New λ.md"]);
  }
});

test("create-note proof refuses unindexed or unreadable alias contributors unless their bounded current session supplies the source", () => {
  for (const remove of [
    f => { f.documents.delete(f.target.path); }, f => { f.documents.get(f.target.path).missing = true; },
    f => { const get = f.app.metadataCache.getFileCache; f.app.metadataCache.getFileCache = file => file === f.target ? null : get(file); },
  ]) {
    const f = createNoteFixture(); remove(f); assert.equal(f.choice(), undefined);
    f.app.workspace.sessions.set(f.target.path, { originRoot: f.app.vault.rootPath, isReloading: false, text: "---\naliases: [New λ]\n---\n" });
    assert.equal(f.choice(), undefined, "known dirty aliases still suppress creation when their old metadata is absent");
    f.app.workspace.sessions.get(f.target.path).text = "---\naliases: [Other alias]\n---\n";
    assert.ok(f.choice(), "a bounded current session can supply the missing alias proof");
  }
});

for (const [prefix, alias] of [["Al", undefined], ["PlnJrn", "Planning journal"]]) {
  test(`held existing ${alias ? "alias" : "note"} choice refuses a newer current query whose only row creates a note`, () => {
    const original = "\ufeff# Retain λ\r\n\r\nLinks: [[" + prefix, f = createNoteFixture(original);
    if (alias) f.setTarget("---\r\naliases: [Planning journal]\r\n---\r\nExisting target 😀\r\n");
    const targetText = f.documents.get(f.target.path).text;
    const held = f.choices().find(value => value.kind === "link" && value.target === f.target && value.alias === alias);
    assert.ok(held, "capture an actual offered existing destination before the query changes");
    f.editor.replaceRange("x", f.editor.getCursor(), undefined, "input.type");
    f.editor.setCursor(f.editor.lastLine(), f.editor.getLine(f.editor.lastLine()).length);
    const newer = original + "x"; f.session.text = newer;
    const trigger = f.suggest.onTrigger(f.editor.getCursor(), f.editor, f.source); assert.ok(trigger);
    // Model the real suggestion manager accepting the newer document/context.
    // The provider is intentionally current, rather than closed or stale.
    f.suggest.context = { ...f.context, ...trigger };
    f.suggest.document = f.cm.state.doc; f.suggest.cursor = f.cm.state.selection.main.head;
    assert.equal(f.suggest.isCurrent(), true);
    const current = f.suggest.getSuggestions(f.suggest.context);
    assert.deepEqual(current.map(value => value.kind), ["create-note"]);
    assert.equal(current[0].name, prefix + "x");
    f.suggest.selectSuggestion(held);
    assert.deepEqual(Buffer.from(f.editor.getValue()), Buffer.from(newer), "a held existing choice cannot replace the newer Create-only query");
    assert.equal(f.creates.length, 0); assert.equal(f.files.length, 2);
    assert.equal(f.documents.get(f.target.path).text, targetText); assert.deepEqual(f.notices, []);
    f.editor.undo(); assert.equal(f.editor.getValue(), original, "refusal adds no source Undo step");
    f.editor.redo(); assert.equal(f.editor.getValue(), newer);
  });
}
