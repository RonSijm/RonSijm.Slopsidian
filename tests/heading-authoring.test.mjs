import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setextAuthoringReadOnlyFixture } from "../tools/setext-authoring-scenarios.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "heading-authoring-tests-"));
  const outfile = join(directory, "heading-authoring.mjs");
  await build({ stdin: { contents: 'export * from "./client/heading-authoring"; export {builtinCompletionTrigger} from "./client/builtin-suggestion-model"; export {parseMarkdown} from "./client/markdown"; export {resolveSubpath} from "./client/links";', resolveDir: root, loader: "ts" }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/heading-authoring-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const path = "Notes/Headings.md";
const choice = (target, subpath = "Future λ 😀", source = "[[Headings#" + subpath, cursor = source.length, targetPath = path) => {
  const trigger = feature.builtinCompletionTrigger(source, cursor);
  return trigger && feature.headingAuthoringCompletion(source, cursor, trigger, targetPath, target);
};

test("explicit root creation appends a genuine H1 and preserves every original BOM/CRLF/Unicode byte", () => {
  for (const ending of ["\n", "\r\n"]) for (const final of ["", ending, ending + ending]) {
    const target = "\ufeff---" + ending + "status: Keep" + ending + "---" + ending + "# Existing" + ending + ending + "Untouched λ 😀." + final;
    const value = choice(target), plan = feature.planHeadingCreation(target, value);
    assert.deepEqual(value, { kind: "create-heading", path, heading: "Future λ 😀", subpath: "Future λ 😀", level: 1, from: target.length, preview: "# Future λ 😀" });
    assert.equal(plan.from, target.length); assert.equal(plan.to, target.length); assert.equal(plan.text, target + plan.insert);
    assert.equal(plan.text.slice(0, target.length), target); assert.ok(plan.insert.endsWith("# Future λ 😀" + ending));
    assert.equal(feature.resolveSubpath(feature.parseMarkdown(plan.text), "#Future λ 😀").start.offset, plan.headingFrom);
  }
});

test("empty and BOM-only source remains intact and creates an addressable heading", () => {
  for (const target of ["", "\ufeff"]) {
    const plan = feature.planHeadingCreation(target, choice(target));
    const prefix = target ? "\n\n" : "";
    assert.equal(plan.text, target + prefix + "# Future λ 😀\n"); assert.equal(plan.headingFrom, target.length + prefix.length);
  }
});

test("unique existing ancestors place a child at the exact subtree end before a sibling", () => {
  const target = "# Parent\r\n\r\nBefore λ.\r\n\r\n### Branch\r\n\r\nInside 😀.\r\n\r\n## Sibling\r\n\r\nUnrelated.\r\n\r\n# Other\r\n";
  const value = choice(target, "Parent#Branch#Future λ 😀"), plan = feature.planHeadingCreation(target, value);
  assert.equal(value.level, 4); assert.deepEqual(value.parents, ["Parent", "Branch"]); assert.equal(value.from, target.indexOf("## Sibling"));
  assert.equal(plan.insert, "#### Future λ 😀\r\n\r\n");
  assert.equal(plan.text, target.replace("## Sibling", "#### Future λ 😀\r\n\r\n## Sibling"));
  const resolved = feature.resolveSubpath(feature.parseMarkdown(plan.text), "#Parent#Branch#Future λ 😀");
  assert.equal(resolved.start.offset, plan.headingFrom); assert.equal(resolved.start.line, 8);
});

test("existing normalized, literal-hash shadows and fuzzy destinations retain ordinary completion instead of creating duplicates", () => {
  for (const target of ["# Future λ 😀\n", "# **FUTURE λ 😀**\n", "# Future λ 😀 later\n", "# Parent#Future λ 😀\n", "# Parent\n## Future λ 😀\n"]) {
    const query = target.includes("Parent") ? "Parent#Future λ 😀" : "Future λ 😀";
    assert.equal(choice(target, query), null, target);
  }
});

test("duplicate, deepest or nested ancestors refuse explicit target authoring", () => {
  for (const [target, query] of [
    ["# Parent\n# Parent\n", "Parent#New"],
    ["# Parent\n## Branch\n## Branch\n", "Parent#Branch#New"], ["###### Parent\n", "Parent#New"],
    ["> # Parent\n", "Parent#New"], ["- Item\n  # Parent\n", "Parent#New"],
    ["# Parent\n## Branch\n# Parent#Branch\n", "Parent#Branch#New"],
  ]) assert.equal(choice(target, query), null, target + query);
});

test("document-level Setext H1 and H2 ancestors create ATX children without changing their original syntax", () => {
  for (const ending of ["\n", "\r\n"]) for (const indent of ["", " ", "  ", "   "]) for (const [marker, level] of [["======", 1], ["------", 2]]) {
    const underline = indent + marker;
    const target = ["\ufeff---", "status: Keep λ 😀", "---", "", "  Parent λ 😀", underline, "", "Keep exact body.", "", "# Other", ""].join(ending);
    const value = choice(target, "parent λ 😀#New leaf Ω"), plan = feature.planHeadingCreation(target, value);
    assert.equal(value.level, level + 1); assert.equal(value.from, target.indexOf("# Other"));
    const insert = "#".repeat(level + 1) + " New leaf Ω" + ending + ending;
    assert.equal(plan.insert, insert); assert.equal(plan.text, target.replace("# Other", insert + "# Other"));
    assert.equal(plan.text.slice(0, value.from), target.slice(0, value.from));
    assert.equal(plan.text.slice(value.from + insert.length), target.slice(value.from));
    assert.equal(plan.text.slice(target.indexOf("  Parent"), target.indexOf("Keep exact body.")), "  Parent λ 😀" + ending + underline + ending + ending);
    assert.equal(feature.resolveSubpath(feature.parseMarkdown(plan.text), "#parent λ 😀#New leaf Ω").start.offset, plan.headingFrom);
  }
});

test("mixed Setext and ATX longest prefixes insert complete missing chains before their exact Setext sibling line", () => {
  for (const ending of ["\n", "\r\n"]) for (const [root, branch, sibling, level] of [
    ["Parent\n======", "### Branch", "  Sibling\n------", 4],
    ["# Parent", "Branch\n------", "  Other\n======", 3],
    ["Parent\n======", "Branch\n------", "  Other\n======", 3],
  ]) {
    const target = ["\ufeff---", "status: Keep", "---", "", root, "", branch, "", "Retain λ 😀.", "", sibling, "", "Sibling body.", ""].join("\n").replaceAll("\n", ending);
    const value = choice(target, "PARENT#branch#New ancestor#New leaf"), plan = feature.planHeadingCreation(target, value);
    const siblingText = sibling.replaceAll("\n", ending), from = target.indexOf(siblingText);
    assert.equal(value.from, from); assert.equal(value.level, level + 1);
    assert.equal(value.preview, "#".repeat(level) + " New ancestor\n\n" + "#".repeat(level + 1) + " New leaf");
    assert.equal(plan.text, target.slice(0, from) + plan.insert + target.slice(from));
    assert.equal(plan.text.slice(from + plan.insert.length, from + plan.insert.length + siblingText.length), siblingText, "the sibling keeps its own indentation and underline");
    const before = feature.parseMarkdown(target), after = feature.parseMarkdown(plan.text);
    for (const old of before.headings) {
      const next = after.headings.find(entry => entry.heading === old.heading && entry.level === old.level);
      assert.equal(next.position.start.offset, old.position.start.offset + (old.position.start.offset >= from ? plan.insert.length : 0));
      const raw = target.slice(old.position.start.offset, old.position.end.offset);
      assert.equal(plan.text.slice(next.position.start.offset, next.position.end.offset), raw);
    }
    for (const created of plan.createdHeadings) assert.equal(feature.resolveSubpath(after, "#" + created.subpath).start.offset, created.from);
  }
});

test("multiline Setext titles reuse their resolver spelling and preserve every physical title line", () => {
  const target = "\ufeffParent first λ\r\nsecond 😀\r\n======\r\n\r\nBody exact.\r\n\r\n# Other\r\n";
  const value = choice(target, "Parent first λ second 😀#New branch#New leaf"), plan = feature.planHeadingCreation(target, value);
  assert.equal(value.preview, "## New branch\n\n### New leaf");
  assert.equal(value.from, target.indexOf("# Other")); assert.equal(plan.text.replace(plan.insert, ""), target);
  assert.equal(feature.resolveSubpath(feature.parseMarkdown(plan.text), "#Parent first λ second 😀#New branch#New leaf").start.offset, plan.headingFrom);
});

test("Setext ancestors retain duplicate, literal shadow, existing, nested, unfinished and H6 refusal proofs", () => {
  for (const [target, query] of [
    ["Parent\n======\n\n# PARENT\n", "Parent#New"],
    ["Parent\n======\n\nBranch\n------\n\n## BRANCH\n", "Parent#Branch#New"],
    ["Parent\n======\n\nParent#New\n------\n", "Parent#New#Leaf"],
    ["Parent\n======\n\n## New leaf\n", "Parent#New leaf"],
    ["> # Parent\n", "Parent#New"],
    ["- Item\n  # Parent\n", "Parent#New"],
    ["Parent\n======\n\n```md\nUnclosed", "Parent#New"],
    ["Parent\n======\n\n<!-- Unclosed", "Parent#New"],
    ["Parent\n------\n", "Parent#Three#Four#Five#Six#Seven"],
    ["Parent\n======\n\n###### Deepest\n", "Parent#Deepest#New"],
  ]) assert.equal(choice(target, query), null, target + query);
  const target = "Parent\n------\n", value = choice(target, "Parent#Three#Four#Five#Six");
  assert.equal(value.level, 6); assert.equal(feature.planHeadingCreation(target, value).createdHeadings.length, 4);
});

test("quoted/list/code Setext-looking text never becomes a reused document-level ancestor", () => {
  for (const target of ["> Parent\n> ======\n", "- Parent\n  ======\n", "    Parent\n    ======\n"]) {
    const value = choice(target, "Parent#New");
    if (value) {
      assert.equal(value.from, target.length);
      assert.deepEqual(value.newHeadings, [{ heading: "Parent", level: 1, subpath: "Parent" }, { heading: "New", level: 2, subpath: "Parent#New" }]);
      assert.equal(feature.planHeadingCreation(target, value).text.slice(0, target.length), target);
    }
  }
});

test("changing the reviewed Setext depth, sibling placement or destination invalidates the retained creation choice", () => {
  const target = "Parent\r\n======\r\n\r\nBody.\r\n\r\nOther\r\n=====\r\n", value = choice(target, "Parent#New branch#New leaf");
  for (const changed of [
    target.replace("======", "------"), target.replace("Other\r\n=====", "## New branch\r\n\r\nOther\r\n====="),
    target.replace("Body.", "Body changed."), target.replace("Parent", "Different"),
    target.replace("Other\r\n=====", "## New branch\r\n\r\n### New leaf\r\n\r\nOther\r\n====="),
  ]) assert.throws(() => feature.planHeadingCreation(changed, value), /No heading was created/);
});

test("the cache-only runtime additions contain real eligible Setext and mixed-prefix creation proofs", () => {
  const target = "# Existing heading\r\n\r\nKeep cached content.\r\n" + setextAuthoringReadOnlyFixture.targetAddition;
  for (const prefix of setextAuthoringReadOnlyFixture.sourcePrefixes) {
    const trigger = feature.builtinCompletionTrigger(prefix, prefix.length), value = feature.headingAuthoringCompletion(prefix, prefix.length, trigger, "Known target.md", target);
    assert.ok(value, "cache-only refusals must exercise an otherwise eligible real destination");
    const plan = feature.planHeadingCreation(target, value);
    assert.equal(plan.createdHeadings[0].level, prefix.includes("Cached ATX branch") ? 4 : 2);
    assert.equal(plan.createdHeadings.length, prefix.includes("Cached ATX branch") ? 2 : 1);
    assert.equal(plan.text.slice(0, target.length), target);
    for (const created of plan.createdHeadings) assert.equal(feature.resolveSubpath(feature.parseMarkdown(plan.text), "#" + created.subpath).start.offset, created.from);
  }
});

test("missing root chains explicitly preview and create every H1 through H6 ancestor without changing existing bytes", () => {
  for (const ending of ["\n", "\r\n"]) for (const count of [2, 3, 6]) {
    const target = "\ufeff---" + ending + "status: Keep" + ending + "---" + ending + "# Untouched" + ending + ending + "Keep λ 😀." + ending;
    const parts = ["New root λ", "New branch 😀", "New depth 3", "New depth 4", "New depth 5", "New leaf"].slice(0, count), value = choice(target, parts.join("#"));
    assert.ok(value); assert.equal(value.level, count); assert.equal(value.from, target.length);
    const lines = parts.map((part, index) => "#".repeat(index + 1) + " " + part);
    assert.equal(value.preview, lines.join("\n\n")); assert.deepEqual(value.newHeadings, parts.map((heading, index) => ({ heading, level: index + 1, subpath: parts.slice(0, index + 1).join("#") })));
    const plan = feature.planHeadingCreation(target, value); assert.equal(plan.text, target + ending + lines.join(ending + ending) + ending);
    assert.equal(plan.text.slice(0, target.length), target); assert.equal(plan.createdHeadings.length, count); assert.equal(plan.headingFrom, plan.createdHeadings.at(-1).from);
    for (const created of plan.createdHeadings) {
      const destination = feature.resolveSubpath(feature.parseMarkdown(plan.text), "#" + created.subpath);
      assert.equal(destination.start.offset, created.from); assert.equal(plan.text.slice(created.from, created.from + created.level + 1 + created.heading.length), "#".repeat(created.level) + " " + created.heading);
    }
  }
});

test("the longest unique existing prefix is reused and its missing suffix remains before the correct sibling", () => {
  const target = "# Parent\r\n\r\nUntouched 😀.\r\n\r\n### Branch\r\n\r\nKeep exact.\r\n\r\n## Sibling\r\n\r\n# Other\r\n## Future branch\r\n### Future leaf\r\n";
  const value = choice(target, "parent#BRANCH#Future branch#Future leaf"), plan = feature.planHeadingCreation(target, value);
  assert.equal(value.from, target.indexOf("## Sibling")); assert.equal(value.level, 5);
  assert.deepEqual(value.newHeadings, [{ heading: "Future branch", level: 4, subpath: "parent#BRANCH#Future branch" }, { heading: "Future leaf", level: 5, subpath: "parent#BRANCH#Future branch#Future leaf" }]);
  assert.equal(plan.text, target.replace("## Sibling", "#### Future branch\r\n\r\n##### Future leaf\r\n\r\n## Sibling"));
  assert.deepEqual(feature.parseMarkdown(plan.text).headings.map(entry => entry.heading), ["Parent", "Branch", "Future branch", "Future leaf", "Sibling", "Other", "Future branch", "Future leaf"]);
  assert.equal(plan.text.replace(plan.insert, ""), target);
});

test("every prospective prefix refuses literal-hash shadows, duplicate existing prefixes and unsafe new ancestor syntax", () => {
  for (const [target, query] of [
    ["# Parent#Missing\n# Parent\n", "Parent#Missing#New"],
    ["# New#Branch\n", "New#Branch#Leaf"],
    ["# New#Branch#Leaf\n", "New#Branch#Leaf#Terminal"],
    ["# Parent\n## Branch\n## BRANCH\n", "Parent#Branch#Missing#Leaf"],
    ["##### Parent\n", "Parent#Missing#Leaf"],
    ["#### Parent\n", "Parent#Missing#Deeper#Leaf"],
    ["# Existing\n", "New#**Unsafe branch**#Leaf"], ["# Existing\n", "New#<unsafe>#Leaf"],
    ["# Existing\n", "New#Branch#Leaf#Four#Five#Six#Seven"],
    ["```md\nUnclosed", "New#Branch#Leaf"], ["<!-- Unclosed", "New#Branch#Leaf"],
    ["---\nstatus: [broken\n---\n", "New#Branch#Leaf"],
  ]) assert.equal(choice(target, query), null, target + query);
});

test("a retained chain plan cannot omit, reorder or forge its ancestor preview and exact offsets", () => {
  const target = "# Parent\n\nBody.\n\n# Other\n", value = choice(target, "Parent#New branch#New leaf"); assert.ok(value);
  for (const forged of [
    { ...value, newHeadings: undefined }, { ...value, newHeadings: [...value.newHeadings].reverse() },
    { ...value, newHeadings: value.newHeadings.map((entry, index) => index ? entry : { ...entry, heading: "Other ancestor" }) },
    { ...value, newHeadings: value.newHeadings.map((entry, index) => index ? entry : { ...entry, level: 4 }) },
    { ...value, preview: "## New branch\n\n### Other leaf" }, { ...value, from: value.from - 1 },
  ]) assert.throws(() => feature.planHeadingCreation(target, forged), /No heading was created/);
  assert.throws(() => feature.planHeadingCreation(target.replace("# Other", "## New branch\n# Other"), value), /No heading was created/);
  assert.throws(() => feature.planHeadingCreation(target.replace("# Parent", "##### Parent"), value), /No heading was created/);
});

test("unsafe raw headings preserve the separate source-only option but expose no target creation", () => {
  for (const title of ["", " ", " New", "New ", "^block", "A|alias", "[link]", "<tag>", "A\\B", "**bold**", "Code`name", "under_score", "x~y", "x=y", "$math$", "Broken\ud800", "a".repeat(257)]) {
    assert.equal(choice("# Existing\n", title), null, title);
  }
  for (const target of ["```md\nUnfinished fence", "<!-- Unfinished comment", "---\nstatus: [broken\n---\n", "Unpaired\rreturn", "Broken \ud800", "x".repeat(262_145)]) assert.equal(choice(target), null);
  for (const targetPath of ["", "../Bad.md", "/Bad.md", "A\\Bad.md", "A#Bad.md", "Bad.png"]) assert.equal(choice("", "New", undefined, undefined, targetPath), null);
});

test("stale triggers, cursor suffixes, forged previews/levels/placements and newly existing titles refuse", () => {
  const target = "# Existing\n", value = choice(target);
  for (const forged of [{ ...value, from: 0 }, { ...value, level: 2 }, { ...value, preview: "## Other" }, { ...value, subpath: "Other" }, { ...value, kind: "heading" }, { ...value, parents: ["Missing"] }]) assert.throws(() => feature.planHeadingCreation(target, forged), /No heading was created/);
  assert.throws(() => feature.planHeadingCreation(target + "# Future λ 😀\n", value), /No heading was created/);
  assert.equal(choice(target, "Future", "[[Headings#Future suffix]]", "[[Headings#Future".length), null);
  const source = "[[Headings#Future", trigger = feature.builtinCompletionTrigger(source, source.length);
  assert.equal(feature.headingAuthoringCompletion(source, source.length, { ...trigger, query: "Other" }, path, target), null);
});

test("metadata and output budgets bound all negative proofs and prospective target edits", () => {
  const target = Array.from({ length: 2_049 }, (_, index) => "# Existing " + index).join("\n");
  assert.equal(choice(target), null);
  const almost = "x".repeat(262_140); assert.equal(choice(almost), null, "creation cannot exceed the source budget");
});
