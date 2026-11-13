import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { MutationLock } from "../client/editor-barrier.ts";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "block-authoring-tests-"));
  const outfile = join(directory, "block-authoring.mjs");
  await build({ stdin: { contents: 'export * from "./client/block-authoring"; export {parseMarkdown} from "./client/markdown"; export {resolveSubpath,resolveLink} from "./client/links"; export {embeddedMarkdown} from "./client/note-embed-section"; export {BuiltinEditorSuggestions} from "./client/builtin-suggestions"; export {Editor} from "./client/editor"; export {FileManager} from "./client/file-manager"; export {TFile} from "./client/vault";', resolveDir: root, loader: "ts" }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/block-authoring-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const path = "Notes/Paragraphs.md";
const choices = (text, query = "", options) => feature.blockAuthoringCompletions(query, path, text, options);

test("new block choices are genuine top-level paragraphs and preserve literal source offsets", () => {
  const text = "\ufeff---\r\nstatus: Keep\r\n---\r\n# Heading\r\n\r\nFirst λ 😀 paragraph.\r\n\r\nSecond **formatted** paragraph.\r\n";
  const result = choices(text);
  assert.deepEqual(result.map(value => value.body), ["First λ 😀 paragraph.", "Second **formatted** paragraph."]);
  assert.deepEqual(result.map(value => value.path), [path, path]);
  for (const value of result) {
    assert.equal(value.kind, "create-block"); assert.equal(text.slice(value.from, value.to), value.body);
    assert.equal(text[value.to], "\r"); assert.equal(value.preview, value.body);
  }
});

test("whole lists, ordinary quotes, callouts and closed code join prose while ignored owners stay excluded", () => {
  const text = ["---", "status: Property prose", "---", "# Heading prose", "", "- List prose", "  - Child prose", "", "> Quoted prose", "", "> [!note] Callout", "> Callout prose", "", "```md", "Code prose", "```", "", "    Indented prose", "", "<!-- Comment prose -->", "", "HTML <span>prose</span>", "", "Math $x^2$ prose", "", "Inline `code` prose", "", "[^note]: Footnote prose", "", "Plain prose λ.", ""].join("\n");
  assert.deepEqual(choices(text).sort((left, right) => left.from - right.from).map(value => value.body), ["- List prose\n  - Child prose", "> Quoted prose", "> [!note] Callout\n> Callout prose", "```md\nCode prose\n```", "Plain prose λ."]);
});

test("inline and separate existing IDs plus attempted malformed marker endings are never relabelled", () => {
  const text = "Inline prose ^inline1\n\nSeparate prose\n\n^known1\n\nAttempted prose ^not_valid\n\nDangling prose ^\n\nFresh prose\n";
  assert.deepEqual(choices(text).map(value => value.body), ["Fresh prose"]);
  assert.deepEqual(Object.keys(feature.parseMarkdown(text).blocks).sort(), ["inline1", "known1"]);
});

test("the source query paragraph is excluded by its actual offsets, not a matching text search", () => {
  const text = "Same prose\n\nLinks: [[#^Same\n\nSame prose\n";
  const start = text.indexOf("[["), end = text.indexOf("\n", start);
  const result = choices(text, "Same", { exclude: { from: start, to: end } });
  assert.equal(result.length, 2); assert.deepEqual(result.map(value => value.from), [0, text.lastIndexOf("Same prose")]);
  for (const exclude of [{ from: -1, to: end }, { from: start, to: text.length + 1 }, { from: end, to: start }, { from: 0.5, to: 1 }]) assert.deepEqual(choices(text, "", { exclude }), []);
});

test("literal tiers outrank fuzzy authoring rows and ties preserve source order", () => {
  const text = "Project Notes\n\nLater prnt words\n\nPrnt prefix\n\nprnt\n\nprnt\n";
  assert.deepEqual(choices(text, "prnt").map(value => value.body), ["prnt", "prnt", "Prnt prefix", "Later prnt words", "Project Notes"]);
  assert.deepEqual(choices(text, ".*["), []);
});

test("paragraph count, source size, query and raw path limits refuse unsafe authoring", () => {
  for (const text of ["x".repeat(feature.MAX_BLOCK_AUTHORING_SOURCE + 1), "Broken \ud800 prose", "Bare\rreturn", Array.from({ length: feature.MAX_BLOCK_AUTHORING_PARAGRAPHS + 1 }, (_, index) => "Paragraph " + index).join("\n\n"), "---\nstatus: [invalid\n---\n\nPlain prose\n"]) assert.deepEqual(choices(text), []);
  for (const badPath of ["", "../A.md", "A/../B.md", "/A.md", "A\\B.md", "A#B.md", "A|B.md", "A[0].md", "Attachment.png", "x".repeat(1_025) + ".md"]) assert.deepEqual(feature.blockAuthoringCompletions("", badPath, "Plain prose"), []);
  assert.deepEqual(choices("Plain prose", "x".repeat(257)), []); assert.deepEqual(choices("Plain prose", "\ud800"), []);
  assert.deepEqual(choices("x".repeat(1_025)), []);
  assert.equal(choices(Array.from({ length: 50 }, (_, index) => "Paragraph " + index).join("\n\n")).length, 40);
});

test("paragraph planner inserts exactly one marker before CRLF and round-trips the actual block", () => {
  for (const ending of ["\n", "\r\n"]) for (const final of ["", ending]) {
    const text = "\ufeff# Keep λ" + ending + ending + "First 😀 paragraph" + ending + "continued **prose**." + final;
    const [choice] = choices(text, "continued"), before = Buffer.from(text), plan = feature.planBlockId(text, choice, "fresh1");
    assert.equal(plan.from, choice.to); assert.equal(plan.to, choice.to); assert.equal(plan.insert, " ^fresh1");
    assert.equal(plan.text, text.slice(0, choice.to) + " ^fresh1" + text.slice(choice.to));
    assert.deepEqual(Buffer.from(plan.text.replace(" ^fresh1", "")), before);
    const cache = feature.parseMarkdown(plan.text), destination = feature.resolveSubpath(cache, "#^fresh1");
    assert.equal(destination.type, "block"); assert.equal(destination.start.offset, choice.from);
    assert.equal(plan.text.slice(cache.blocks.fresh1.idPosition.start.offset, cache.blocks.fresh1.idPosition.end.offset), "^fresh1");
    assert.deepEqual(choices(plan.text, "continued"), [], "the acknowledged paragraph is no longer an authoring row");
  }
});

test("planner retains spaces, tabs, Unicode and every unrelated paragraph byte", () => {
  const text = "First untouched λ 😀.\r\n\r\nTarget prose  \t\r\n\r\nLast untouched.\r\n";
  const [choice] = choices(text, "Target"), plan = feature.planBlockId(text, choice, "new123");
  assert.equal(plan.text, "First untouched λ 😀.\r\n\r\nTarget prose  \t ^new123\r\n\r\nLast untouched.\r\n");
});

test("planner refuses forged offsets, preview, body and changes beyond the truncated display", () => {
  const text = "Prefix " + "x".repeat(180) + " tailA", [choice] = choices(text, "Prefix");
  assert.ok(choice.preview.length < choice.body.length);
  for (const changed of [{ ...choice, from: 1 }, { ...choice, to: choice.to - 1 }, { ...choice, path: "../Other.md" }, { ...choice, preview: "Different" }, { ...choice, body: "Different" }, { ...choice, kind: "block" }]) assert.throws(() => feature.planBlockId(text, changed, "safe12"), /No block ID was added/);
  assert.throws(() => feature.planBlockId(text.replace("tailA", "tailB"), choice, "safe12"), /No block ID was added/);
  assert.throws(() => feature.planBlockId("Shifted\n\n" + text, choice, "safe12"), /No block ID was added/);
});

test("new identifiers avoid case-insensitive lexical collisions across the complete target", () => {
  const text = "Existing prose ^ab12cd\n\n```md\n^EF34GH\n```\n\nPlain prose\n";
  const generated = ["ab12cd", "ef34gh", "safe12"]; let calls = 0;
  assert.equal(feature.newBlockId(text, () => generated[calls++]), "safe12"); assert.equal(calls, 3);
  const [choice] = choices(text, "Plain");
  for (const id of ["ab12cd", "ef34gh", "UPPER1", "short", "too-long", "bad_id", "bad^id"]) assert.throws(() => feature.planBlockId(text, choice, id), /No block ID was added/);
});

test("identifier exhaustion and unavailable randomness refuse without falling back to a duplicate", () => {
  let attempts = 0;
  assert.equal(feature.newBlockId("Existing ^sameid", () => { attempts++; return "sameid"; }), null); assert.equal(attempts, 16);
  attempts = 0; assert.equal(feature.newBlockId("Plain prose", () => { attempts++; return ""; }), null); assert.equal(attempts, 16);
  assert.equal(feature.newBlockId("Plain prose", () => { throw Error("no entropy"); }), null);
  assert.equal(feature.newBlockId("x".repeat(feature.MAX_BLOCK_AUTHORING_SOURCE + 1), () => "safe12"), null);
  assert.match(feature.newBlockId("Plain prose"), /^[a-z0-9]{6}$/);
});

test("top-level list, task list, ordered list and quote rows own their entire compound source", () => {
  const bodies = ["- Bullet λ\n  - Nested 😀\n- Last bullet", "- [ ] Open task\n- [x] Done task", "1. First ordered\n2. Last ordered", "> First quote\n> continued quote\n>\n> Last quoted paragraph"];
  const text = bodies.join("\n\nSibling divider\n\n"), result = choices(text).filter(value => value.blockKind).sort((left, right) => left.from - right.from);
  assert.deepEqual(result.map(value => value.body), bodies);
  assert.deepEqual(result.map(value => value.blockKind), ["bullet-list", "bullet-list", "ordered-list", "quote"]);
  for (const value of result) assert.equal(text.slice(value.from, value.to), value.body);
  assert.equal(choices(text, "Nested").length, 1, "nested prose matches its whole top-level owner only");
  assert.equal(choices(text, "Last quoted paragraph").length, 1);
});

test("compound markers round-trip exact whole blocks at EOF and before following content with LF and CRLF", () => {
  const bodies = ["- [ ] Task λ 😀\n  - Nested child\n- [x] Finished task", "1. First ordered\n2. Last ordered", "> First quote λ 😀\n>\n> Last quoted paragraph"];
  for (const newline of ["\n", "\r\n"]) for (const body of bodies) for (const tail of ["", newline, newline + newline, newline + "# Following heading", newline + newline + "Following prose"]) {
    const actualBody = body.replaceAll("\n", newline), text = "\ufeff---" + newline + "keep: λ 😀" + newline + "---" + newline + newline + actualBody + tail;
    const choice = choices(text).find(value => value.body === actualBody), plan = feature.planBlockId(text, choice, "whole1");
    assert.equal(plan.from, choice.to); assert.equal(plan.to, choice.to);
    const expectedInsert = newline + newline + "^whole1" + (tail.startsWith(newline + newline) ? "" : newline);
    assert.equal(plan.insert, expectedInsert);
    assert.deepEqual(Buffer.from(plan.text.slice(0, plan.from) + plan.text.slice(plan.from + plan.insert.length)), Buffer.from(text));
    const cache = feature.parseMarkdown(plan.text), block = cache.blocks.whole1, resolved = feature.resolveSubpath(cache, "#^whole1");
    assert.equal(resolved.type, "block"); assert.equal(resolved.start.offset, choice.from);
    const end = resolved.end.offset - (plan.text[resolved.end.offset - 1] === "\r" ? 1 : 0);
    assert.equal(end, choice.to); assert.equal(plan.text.slice(resolved.start.offset, end), actualBody);
    assert.equal(plan.text.slice(block.idPosition.start.offset, block.idPosition.end.offset), "^whole1");
    assert.equal(choices(plan.text).some(value => value.from === choice.from), false, "a labelled compound never receives another authoring row");
  }
});

test("standalone metadata IDs attach the nearest preceding top-level container and preserve nested inline ownership", () => {
  for (const body of ["- First item ^child1\n- Last item", "> First quote ^child1\n>\n> Last quote"]) {
    const text = "Preceding paragraph\n\n" + body + "\n\n^whole1\n\nFollowing paragraph\n\n^after1\n", cache = feature.parseMarkdown(text);
    assert.equal(cache.blocks.whole1.position.start.offset, text.indexOf(body));
    assert.equal(cache.blocks.whole1.position.end.offset, text.indexOf(body) + body.length);
    assert.equal(cache.blocks.after1.position.start.offset, text.indexOf("Following paragraph"));
    assert.equal(cache.blocks.after1.position.end.offset, text.indexOf("Following paragraph") + "Following paragraph".length);
    assert.ok(cache.blocks.child1.position.start.offset > cache.blocks.whole1.position.start.offset, "an inline child ID keeps its established nested paragraph owner");
    assert.ok(cache.blocks.child1.position.end.offset < cache.blocks.whole1.position.end.offset);
  }
});

test("an excluded query anywhere inside a list or quote removes the complete compound candidate", () => {
  for (const body of ["- First item\n- Reference [[#^Fresh\n  - Last child", "> First quote\n>\n> Reference [[#^Fresh\n> Last quote"]) {
    const text = body + "\n\nFresh unrelated paragraph", from = text.indexOf("[["), to = from + "[[#^Fresh".length;
    assert.equal(choices(text, "Fresh").length, 2);
    assert.deepEqual(choices(text, "Fresh", { exclude: { from, to } }).map(value => value.body), ["Fresh unrelated paragraph"]);
    for (const at of [0, text.indexOf("Reference"), body.length - 1]) {
      assert.deepEqual(choices(text, "", { exclude: { from: at, to: at + 1 } }).map(value => value.body), ["Fresh unrelated paragraph"]);
    }
  }
});

test("compound blocks containing existing IDs, attempted child markers, nested callouts or ignored syntax stay unlabelled", () => {
  const unsafe = [
    "- First ^known1\n- Last", "- First\n- Last\n\n^known1", "> First ^known1\n> Last", "> First\n> Last\n\n^known1",
    "- First ^bad_id\n- Last", "> First ^\n> Last", "- First\n  > [!note] Callout\n  > Body\n- Last", "> First\n> [!warning] Callout",
    "- First\n  ```md\n  Nested code\n  ```\n- Last", "> First\n> `inline code`\n> Last", "- First <span>HTML</span>\n- Last",
    "> <!-- Comment -->\n> Body", "- First $x^2$\n- Last", "> [^note]: Definition\n> Last", "- First ^[inline footnote]\n- Last", "> First [^reference]\n> Last",
    "| Column | Other |\n| --- | --- |\n| Incomplete row |", "```md\nUnclosed code block", "\ufeff- Ambiguous BOM list\n- Last",
  ];
  for (const text of unsafe) assert.deepEqual(choices(text), [], text);
});

test("compound plans reject stale complete bodies, changed kinds and forged nested choices", () => {
  for (const body of ["- Prefix " + "x".repeat(180) + " tailA\n- Last", "> Prefix " + "x".repeat(180) + " tailA\n> Last"]) {
    const [choice] = choices(body);
    assert.ok(choice.preview.length < choice.body.length);
    assert.throws(() => feature.planBlockId(body.replace("tailA", "tailB"), choice, "safe12"), /No block ID was added/);
    for (const change of [{ ...choice, blockKind: "paragraph" }, { ...choice, preview: "changed" }, { ...choice, from: 2, body: choice.body.slice(2) }, { ...choice, to: choice.to - 1 }, { ...choice, body: choice.body + " forged" }]) {
      assert.throws(() => feature.planBlockId(body, change, "safe12"), /No block ID was added/);
    }
    const { blockKind, ...compatible } = choice;
    assert.equal(feature.planBlockId(body, compatible, "safe12").text, feature.planBlockId(body, choice, "safe12").text, "legacy choice fields still suffice after the real kind is re-derived");
  }
});

test("compound counts, results and collisions use the same bounded authoring budget as prose", () => {
  const many = Array.from({ length: feature.MAX_BLOCK_AUTHORING_BLOCKS + 1 }, (_, index) => "> Quote " + index).join("\n\nDivider\n\n");
  assert.deepEqual(choices(many), []);
  assert.equal(choices(Array.from({ length: 45 }, (_, index) => "> Quote " + index).join("\n\nDivider\n\n"), "Quote").length, feature.MAX_BLOCK_AUTHORING_RESULTS);
  const text = "- Task candidate\n- Last\n\nUnrelated ^TAKEN1", [choice] = choices(text, "Task");
  assert.throws(() => feature.planBlockId(text, choice, "taken1"), /No block ID was added/);
  assert.equal(feature.newBlockId(text, () => "taken1"), null);
});

const codeBody = "```js\nconst sample = \"Literal λ 😀 <tag> $x$ [[Keep]]\";\nconsole.log(sample);\n```";
const tableBody = "| Extended table λ 😀 | Value |\n| :--- | ---: |\n| Row Ω | 42 |\n| Escaped \\| pipe | **Keep** |";
const calloutBody = "> [!tip]+ Extended callout λ 😀\n> Body Ω remains exact\n>\n> - [ ] First task\n>   - Nested child\n> - [x] Last task\n>\n> > Ordinary nested quote\n> > Continued quote";

test("closed top-level fences and rectangular tables expose one complete source choice", () => {
  for (const body of [codeBody, "~~~text\nTilde λ 😀\n~~~~", tableBody, tableBody.replace("| :--- | ---: |", "| :--- | ---: | \t") + " \t", "Column | Value\n--- | ---\nRow Ω | 42", "| Only column |\n| --- |\n| Value |", "```\n```", "  ```js\nconst x = 1;\n  ```"]) {
    const [choice] = choices(body); assert.ok(choice, body);
    assert.equal(choice.blockKind, body.includes("---") ? "table" : "fenced-code");
    assert.equal(choice.body, body.slice(choice.from)); assert.equal(choice.to, body.length);
    assert.equal(choices(body).length, 1);
  }
});

test("code/table IDs at EOF and before following blocks round-trip exact BOM CRLF Unicode source", () => {
  for (const newline of ["\n", "\r\n"]) for (const original of [codeBody, tableBody]) for (const tail of ["", newline, newline + newline, newline + "# Following sibling", newline + newline + "Following sibling."]) {
    const body = original.replaceAll("\n", newline), text = "\ufeff---" + newline + "keep: λ 😀" + newline + "---" + newline + newline + body + tail;
    const choice = choices(text).find(value => value.body === body); assert.ok(choice, text);
    const plan = feature.planBlockId(text, choice, "extend"), cache = feature.parseMarkdown(plan.text), resolved = feature.resolveSubpath(cache, "#^extend"), block = cache.blocks.extend;
    assert.equal(resolved.type, "block"); assert.equal(resolved.start.offset, choice.from);
    const end = resolved.end.offset - (plan.text[resolved.end.offset - 1] === "\r" ? 1 : 0);
    assert.equal(end, choice.to); assert.equal(plan.text.slice(resolved.start.offset, end), body);
    assert.equal(feature.embeddedMarkdown(plan.text, "#^extend", cache).replace(/\r$/, ""), body, "ordinary block embeds receive the complete fence or table, including literal content");
    assert.equal(plan.text.slice(block.idPosition.start.offset, block.idPosition.end.offset), "^extend");
    assert.deepEqual(Buffer.from(plan.text.slice(0, plan.from) + plan.text.slice(plan.from + plan.insert.length)), Buffer.from(text));
    assert.equal(choices(plan.text).some(value => value.from === choice.from), false);
  }
});

test("CRLF table metadata has one canonical whole owner without projecting ordinary paragraphs or nested literals", () => {
  const table = tableBody.replaceAll("\n", "\r\n"), prefix = "Before paragraph\r\n\r\n", after = "\r\n\r\nAfter paragraph\r\n\r\n^after1", text = prefix + table + "\r\n\r\n^table1" + after;
  const cache = feature.parseMarkdown(text), from = prefix.length, to = from + table.length;
  assert.deepEqual(cache.sections.filter(section => section.type === "table").map(section => [section.position.start.offset, section.position.end.offset]), [[from, to + 1]]);
  assert.equal(cache.sections.some(section => section.type === "paragraph" && section.position.start.offset === from), false);
  assert.equal(cache.blocks.table1.position.start.offset, from); assert.equal(cache.blocks.table1.position.end.offset, to + 1);
  assert.equal(cache.blocks.after1.position.start.offset, text.indexOf("After paragraph"));
  for (const literal of ["```md\r\n" + table + "\r\n```", table.split("\r\n").map(line => "> " + line).join("\r\n"), "<div>\r\n" + table + "\r\n</div>", "$$\r\n" + table + "\r\n$$", "[^note]: Footnote\r\n" + table.split("\r\n").map(line => "    " + line).join("\r\n")]) {
    assert.deepEqual(feature.parseMarkdown(literal).sections.filter(section => section.type === "table"), [], literal);
    assert.equal(choices(literal).some(value => value.blockKind === "table"), false);
  }
  const inline = "- First child ^child1\r\n- Last child\r\n\r\n^whole1\r\n\r\n" + table + "\r\n\r\n^table2";
  const ids = feature.parseMarkdown(inline).blocks;
  assert.equal(ids.whole1.position.start.offset, 0); assert.equal(ids.child1.position.start.offset, 2);
  assert.equal(ids.table2.position.start.offset, inline.indexOf(table));
  assert.deepEqual(feature.parseMarkdown("-".repeat(50_000) + "\r\n\r\nOrdinary | prose\r\n").sections.filter(section => section.type === "table"), [], "a long malformed delimiter-like line never becomes a table or exhausts projection work");
});

test("open fences, nested new block kinds, unsafe tables and attempted markers never gain a fresh ID", () => {
  for (const text of [
    "```js\nOpen", "```js\nWrong closer\n~~~", "````js\nToo short\n```", "    Indented code",
    "| A | B |\n| --- | --- |", "| A | B |\n| - | - |\n| C | D |", "| A | B |\n| --- | --- |\n| Missing |", "| A | B |\n| --- | --- |\n| Extra | Cells | Here |",
    "| A | B |\n| --- | --- |\n| `Code` | Text |", "| A | B |\n| --- | --- |\n| <span>HTML</span> | Text |", "| A | B |\n| --- | --- |\n| $x$ | Text |", "| A | B |\n| --- | --- |\n| [^note] | Text |",
    "```text\nLiteral ^attempted\n```", "| A | B |\n| --- | --- |\n| Attempted ^bad_id | Text |", codeBody + "\n\n^known1", tableBody + "\n\n^known1",
    "\ufeff" + codeBody, "\ufeff" + tableBody,
  ]) assert.deepEqual(choices(text), [], text);
  for (const text of ["> ```js\n> Nested code\n> ```", "- First\n\n  ```js\n  Nested code\n  ```", "> | A | B |\n> | --- | --- |\n> | C | D |", "- First\n\n  | A | B |\n  | --- | --- |\n  | C | D |"])
    assert.equal(choices(text).some(value => ["fenced-code", "table"].includes(value.blockKind)), false, text);
});

test("extended plans reject changed complete bodies, kinds and excluded queries anywhere in their owner", () => {
  for (const body of [codeBody, tableBody]) {
    const [choice] = choices(body); assert.ok(choice);
    for (const change of [{ ...choice, blockKind: "paragraph" }, { ...choice, to: choice.to - 1 }, { ...choice, preview: "Different" }, { ...choice, body: choice.body + " Different" }]) assert.throws(() => feature.planBlockId(body, change, "safe12"), /No block ID was added/);
    assert.throws(() => feature.planBlockId(body.replace("λ", "Σ"), choice, "safe12"), /No block ID was added/);
    for (const at of [0, body.indexOf("λ"), body.length - 1]) assert.deepEqual(choices(body, "", { exclude: { from: at, to: at + 1 } }), []);
  }
  for (const long of ["```text\nExtended " + "x".repeat(180) + " tailA\n```", "| Extended | Value |\n| --- | --- |\n| " + "x".repeat(180) + " tailA | Keep |" ]) {
    const [choice] = choices(long); assert.ok(choice.preview.length < choice.body.length); assert.throws(() => feature.planBlockId(long.replace("tailA", "tailB"), choice, "safe12"), /No block ID was added/);
  }
  const many = Array.from({ length: 45 }, (_, index) => "```text\nExtended " + index + "\n```").join("\n\n");
  assert.equal(choices(many).length, 40);
  assert.deepEqual(choices(Array.from({ length: feature.MAX_BLOCK_AUTHORING_BLOCKS + 1 }, () => "```\nx\n```").join("\n\n")), []);
});

function providerFixture(body, options = {}) {
  const newline = "\r\n", targetText = "# Target" + newline + newline + body.replaceAll("\n", newline) + newline;
  const before = options.same ? "\ufeff# Source λ 😀" + newline + newline + body.replaceAll("\n", newline) + newline + newline + "Reference: [[#^Extended" : "\ufeff# Source λ 😀" + newline + newline + "Reference: [[Target#^Extended";
  const lock = new MutationLock(), state = EditorState.create({ doc: before, selection: { anchor: before.replaceAll(newline, "\n").length }, extensions: [history(), lock.extension(), EditorState.lineSeparator.of(newline), EditorView.editable.of(true)] });
  const cm = { state, dom: { isConnected: true }, hasFocus: true, dispatch(spec) { this.state = (spec.startState ? spec : this.state.update(spec)).state; } };
  cm.dispatch = cm.dispatch.bind(cm);
  const editor = Object.assign(Object.create(feature.Editor.prototype), { cm }), files = [], documents = new Map(), writes = [], notices = [];
  const vault = { rootPath: "extended-vault", readOnly: false, getFileByPath: path => files.find(file => file.path === path) ?? null, getMarkdownFiles: () => files,
    getAbstractFileByPath: path => vault.getFileByPath(path), assertWritable() { if (this.readOnly) throw Error("Read-only vault"); }, getConfig: key => key === "newLinkFormat" ? "shortest" : false };
  const file = path => new feature.TFile(vault, { path, name: path.split("/").at(-1), basename: path.split("/").at(-1).slice(0, -3), extension: "md", stat: { ctime: 1, mtime: 1, size: 1 } });
  const source = file("Source.md"), target = file("Target.md"); files.push(source, target);
  documents.set(source.path, { text: before, cache: feature.parseMarkdown(before), missing: false }); documents.set(target.path, { text: targetText, cache: feature.parseMarkdown(targetText), missing: false });
  const view = { editor, file: source }, session = { originRoot: vault.rootPath, text: before, isReloading: false };
  const app = { vault, changingVault: false, core: { isEnabled: () => true }, workspace: { isChangingFiles: false, activeEditor: view, sessions: new Map([[source.path, session]]),
    withFileMutation: async action => { app.workspace.isChangingFiles = true; cm.dispatch({ effects: lock.set(true) }); try { return await action(); } finally { app.workspace.isChangingFiles = false; cm.dispatch({ effects: lock.set(false) }); } },
    acceptExternalDocuments: docs => { app.accepted = docs; } },
    metadataCache: { getDocument: path => documents.get(path), getFileCache: file => documents.get(file.path)?.cache, getDocuments: () => [],
      resolveReference: (reference, path) => feature.resolveLink(files, reference.link, path), fileToLinktext: () => "Target", refresh: async () => {}, pause: async () => {}, resume() {} }, saveAll: async () => {} };
  editor.owner = { app, getMode: () => "source", getEditingMode: () => options.mode ?? "source" };
  let version = "v1";
  vault.readDocument = async path => { await f.beforeRead?.(); return { file: { path }, content: documents.get(path).text, version, hasBom: true }; };
  vault.writeDocument = async (path, content, expected, create) => {
    assert.equal(expected, version); assert.equal(create, false); assert.equal(path, target.path);
    const written = { file: { path }, content, version: "v" + (writes.length + 2), hasBom: true }; version = written.version;
    documents.set(path, { text: content, cache: feature.parseMarkdown(content), missing: false }); writes.push(written); await f.afterWrite?.(); return written;
  };
  app.fileManager = new feature.FileManager(app);
  const suggest = Object.assign(Object.create(feature.BuiltinEditorSuggestions.prototype), { app, origin: view, root: vault.rootPath, path: source.path, document: state.doc, cursor: state.selection.main.head });
  const context = { editor, file: source, query: "Extended", start: { line: 0, ch: 0 }, end: editor.getCursor() };
  suggest.context = context; suggest.close = () => { suggest.context = null; }; suggest.blockWithoutLink = path => notices.push(path);
  const f = { app, vault, source, target, files, documents, writes, notices, editor, cm, lock, session, suggest, before, targetText,
    choice: () => suggest.getSuggestions(context).find(value => value.kind === "create-block"), context };
  return f;
}

test("actual provider and Editor complete whole code/table/callout IDs in one isolated same-note Undo in both modes", async () => {
  for (const mode of ["source", "live-preview"]) for (const body of [codeBody, tableBody, calloutBody]) {
    const f = providerFixture(body.replace("Literal", "Extended literal"), { same: true, mode }), choice = f.choice(); assert.ok(choice);
    await f.suggest.selectSuggestion(choice);
    const completed = f.editor.getValue(), id = /^\^([a-z0-9]{6})$/m.exec(completed.replaceAll("\r", ""))[1];
    assert.equal(completed, f.before.replace(choice.body, choice.body + "\r\n\r\n^" + id).replace("[[#^Extended", "[[#^" + id + "]]"));
    const resolved = feature.resolveSubpath(feature.parseMarkdown(completed), "#^" + id); assert.equal(resolved.start.offset, choice.from);
    assert.equal(completed.slice(resolved.start.offset, resolved.end.offset).replace(/\r$/, ""), choice.body);
    f.editor.undo(); assert.equal(f.editor.getValue(), f.before); f.editor.redo(); assert.equal(f.editor.getValue(), completed); assert.deepEqual(f.writes, []);
  }
});

test("actual provider and FileManager acknowledge complete cross-note code/table/callout writes before source-only Undo", async () => {
  for (const mode of ["source", "live-preview"]) for (const body of [codeBody, tableBody, calloutBody]) {
    const f = providerFixture(body.replace("Literal", "Extended literal"), { mode }), choice = f.choice(); assert.ok(choice);
    await f.suggest.selectSuggestion(choice); assert.equal(f.writes.length, 1); assert.equal(f.app.accepted[0], f.writes[0]);
    const written = f.writes[0].content, id = /^\^([a-z0-9]{6})$/m.exec(written.replaceAll("\r", ""))[1], completed = f.before.replace("[[Target#^Extended", "[[Target#^" + id + "]]");
    assert.equal(f.editor.getValue(), completed); assert.equal(written, f.targetText.replace(choice.body, choice.body + "\r\n\r\n^" + id + "\r\n"));
    const resolved = feature.resolveSubpath(feature.parseMarkdown(written), "#^" + id); assert.equal(written.slice(resolved.start.offset, resolved.end.offset).replace(/\r$/, ""), choice.body);
    f.editor.undo(); assert.equal(f.editor.getValue(), f.before); assert.equal(f.documents.get(f.target.path).text, written); f.editor.redo(); assert.equal(f.editor.getValue(), completed);
  }
});

test("actual extended provider refuses held stale bodies, read-only targets and lost source ownership", async () => {
  for (const body of [codeBody, tableBody, calloutBody]) for (const phase of ["retained", "read-only", "source", "read", "acknowledged"]) {
    const f = providerFixture(body.replace("Literal", "Extended literal")), choice = f.choice(); assert.ok(choice);
    const replace = () => { const text = f.targetText.replace("λ", "Σ"); f.documents.set(f.target.path, { text, cache: feature.parseMarkdown(text), missing: false }); };
    if (phase === "retained") replace();
    if (phase === "read-only") f.vault.readOnly = true;
    if (phase === "source") f.app.saveAll = async () => { f.app.workspace.activeEditor = null; };
    if (phase === "read") f.beforeRead = replace;
    if (phase === "acknowledged") f.afterWrite = async () => { f.app.workspace.activeEditor = null; };
    if (["source", "read"].includes(phase)) await assert.rejects(f.suggest.selectSuggestion(choice), /changed/); else await f.suggest.selectSuggestion(choice);
    assert.equal(f.editor.getValue(), f.before); assert.equal(f.writes.length, phase === "acknowledged" ? 1 : 0);
    if (phase === "acknowledged") { assert.deepEqual(f.notices, [f.target.path]); assert.match(f.documents.get(f.target.path).text, /\^[a-z0-9]{6}/); }
  }
});

test("actual provider rejects code-context triggering and excludes a valid table-cell query's complete owner", () => {
  for (const [body, kind] of [[codeBody, "fenced-code"], [tableBody, "table"]]) {
    const f = providerFixture(body, { same: true }), base = f.before.replace("Reference: [[#^Extended", "Reference: ");
    const insertAt = kind === "fenced-code" ? base.indexOf("\r\n", base.indexOf("console.log(sample);")) : base.indexOf(" |", base.indexOf("| Row Ω |") + "| Row Ω |".length), prefix = " [[#^Extended";
    const text = base.slice(0, insertAt) + prefix + base.slice(insertAt); f.editor.replaceExpected(f.editor.getValue(), 0, f.editor.getValue().length, text, "input.fixture");
    const lines = text.slice(0, insertAt + prefix.length).split("\r\n"); f.editor.setCursor(lines.length - 1, lines.at(-1).length); f.session.text = text;
    const owner = choices(text, "Extended").find(value => value.blockKind === kind); assert.ok(owner, "the complete source owner remains genuinely authorable outside the query guard");
    const trigger = f.suggest.onTrigger(f.editor.getCursor(), f.editor, f.source);
    if (kind === "fenced-code") { assert.equal(trigger, null); }
    else {
      assert.equal(trigger.query, "Extended"); assert.equal(trigger.start.offset, insertAt + 1);
      assert.equal(f.suggest.getSuggestions({ ...trigger, editor: f.editor, file: f.source }).some(value => value.kind === "create-block" && value.from === owner.from), false);
    }
    assert.deepEqual(choices(text, "Extended", { exclude: { from: insertAt + 1, to: insertAt + prefix.length } }), []);
  }
});

test("supported top-level callout types, optional fold flags and rich titles expose only their complete owner", () => {
  for (const header of ["> [!note]", ">[!TIP]+", "> [!warning]- Closed title λ 😀", "> [!custom_type-42] **Rich title**", "> [!note] + Literal title prefix"]) {
    const text = header + "\n> Body\n>\n> - [ ] Task\n>\n> > Nested quote", result = choices(text);
    assert.equal(result.length, 1); assert.equal(result[0].blockKind, "callout"); assert.equal(result[0].body, text);
  }
  const [empty] = choices("> [!note]"); assert.equal(empty.blockKind, "callout"); assert.equal(empty.body, "> [!note]");
  assert.equal(choices(calloutBody, "Nested child")[0].body, calloutBody);
});

test("callout plans round-trip entire LF/CRLF/BOM bodies at EOF and before adjacent siblings", () => {
  for (const newline of ["\n", "\r\n"]) for (const original of [calloutBody, calloutBody.replace("[!tip]+", "[!warning]-"), "> [!note]"]) for (const tail of ["", newline, newline + newline, newline + "# Next heading", newline + newline + "Next paragraph", newline + newline + "> [!note] Next callout\n> Body".replaceAll("\n", newline)]) {
    const body = original.replaceAll("\n", newline), text = "\ufeff---" + newline + "status: Preserve λ 😀" + newline + "---" + newline + newline + body + tail;
    const choice = choices(text).find(value => value.body === body); assert.ok(choice, text);
    const plan = feature.planBlockId(text, choice, "call01"), cache = feature.parseMarkdown(plan.text), resolved = feature.resolveSubpath(cache, "#^call01");
    assert.equal(resolved.type, "block"); assert.equal(resolved.start.offset, choice.from);
    assert.equal(plan.text.slice(resolved.start.offset, resolved.end.offset).replace(/\r$/, ""), body);
    assert.equal(feature.embeddedMarkdown(plan.text, "#^call01", cache).replace(/\r$/, ""), body);
    assert.equal(plan.text.slice(cache.blocks.call01.idPosition.start.offset, cache.blocks.call01.idPosition.end.offset), "^call01");
    assert.deepEqual(Buffer.from(plan.text.slice(0, plan.from) + plan.text.slice(plan.from + plan.insert.length)), Buffer.from(text));
    assert.equal(choices(plan.text).some(value => value.from === choice.from), false);
  }
});

test("nested or malformed callouts, child IDs and ignored callout content refuse authoring", () => {
  for (const text of [
    "> > [!note] Nested\n> > Body", "- > [!note] Nested\n  > Body", "> Ordinary quote\n> [!note] Later marker",
    "> [!note] Outer\n> > [!tip] Nested\n> > Body", "> [!note] Outer\n> - > [!tip] Nested\n>   > Body",
    "> [!note]No separator\n> Body", "> [!note]++ Invalid fold\n> Body", "> [!123] Unsupported\n> Body", "> [!note|metadata] Unsupported\n> Body", "> [!note\n> Body",
    "> [!note] Title\n> Body\nUnquoted lazy continuation", "\ufeff> [!note] Ambiguous BOM\n> Body",
    "> [!note] Title ^child1\n> Body", "> [!note] Title\n> Body ^child1", "> [!note] Title\n>\n> ^child1", calloutBody + "\n\n^known1",
    "> [!note] Title ^bad_id\n> Body", "> [!note] Title\n> Body ^", "> [!note] Title\n> `Inline code`", "> [!note] Title\n> ```js\n> code\n> ```",
    "> [!note] Title\n> <span>HTML</span>", "> [!note] Title\n> <!-- Comment -->", "> [!note] Title\n> $x^2$", "> [!note] Title\n> $$\n> x\n> $$",
    "> [!note] Title\n> [^ref]", "> [!note] Title\n> [^def]: Definition", "> [!note] Title\n> ^[Inline footnote]",
  ]) assert.deepEqual(choices(text), [], text);
});

test("callout full-body stale proof, kind proof, query exclusion and work bounds remain mandatory", () => {
  const long = "> [!note]- Extended long title\n> " + "x".repeat(180) + " tailA\n> Last paragraph", [choice] = choices(long);
  assert.ok(choice.preview.length < choice.body.length); assert.throws(() => feature.planBlockId(long.replace("tailA", "tailB"), choice, "safe12"), /No block ID was added/);
  for (const changed of [{ ...choice, blockKind: "quote" }, { ...choice, preview: "Other" }, { ...choice, body: "Other" }, { ...choice, from: choice.from + 2 }, { ...choice, to: choice.to - 1 }]) assert.throws(() => feature.planBlockId(long, changed, "safe12"), /No block ID was added/);
  for (const at of [0, calloutBody.indexOf("Nested child"), calloutBody.indexOf("Continued quote"), calloutBody.length - 1]) assert.deepEqual(choices(calloutBody, "", { exclude: { from: at, to: at + 1 } }), []);
  const many = Array.from({ length: 45 }, (_, index) => "> [!note] Callout " + index + "\n> Body").join("\n\n"); assert.equal(choices(many).length, 40);
  assert.deepEqual(choices(Array.from({ length: feature.MAX_BLOCK_AUTHORING_BLOCKS + 1 }, () => "> [!note]\n> Body").join("\n\n")), []);
});

test("a genuine source query in a callout descendant excludes its complete owner from the actual provider", () => {
  const f = providerFixture(calloutBody, { same: true }), base = f.before.replace("Reference: [[#^Extended", "Reference: ");
  for (const line of [">   - Nested child", "> > Continued quote"]) {
    const insertAt = base.indexOf("\r\n", base.indexOf(line)), prefix = " [[#^Extended", text = base.slice(0, insertAt) + prefix + base.slice(insertAt);
    f.editor.replaceExpected(f.editor.getValue(), 0, f.editor.getValue().length, text, "input.fixture"); const before = text.slice(0, insertAt + prefix.length).split("\r\n"); f.editor.setCursor(before.length - 1, before.at(-1).length); f.session.text = text;
    const owner = choices(text, "Extended").find(value => value.blockKind === "callout"); assert.ok(owner);
    const trigger = f.suggest.onTrigger(f.editor.getCursor(), f.editor, f.source); assert.equal(trigger.query, "Extended"); assert.equal(trigger.start.offset, insertAt + 1);
    assert.equal(f.suggest.getSuggestions({ ...trigger, editor: f.editor, file: f.source }).some(value => value.kind === "create-block" && value.from === owner.from), false);
  }
});
