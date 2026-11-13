import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let folder, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  folder = await mkdtemp(join(root, ".runtime", "crlf-authoring-tests-"));
  const outfile = join(folder, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/heading-authoring";export * from "./client/block-authoring";export {parseMarkdown} from "./client/markdown";export {resolveSubpath} from "./client/links";export {builtinCompletionTrigger} from "./client/builtin-suggestion-model";', resolveDir: root }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (folder) { assert.match(relative(root, folder).replaceAll("\\", "/"), /^\.runtime\/crlf-authoring-tests-[^/]+$/); await rm(folder, { recursive: true }); }
});
const path = "Notes/HTML.md";
const lines = ["---", "status: Keep", "---", "# Before", "Before body.", "", '<details><summary>Raw HTML</summary><p>Hidden HTML prose ^hidden</p></details>', "", "# After", "After body λ 😀.", "", "- [ ] Parent task", "  - Child λ", "", "> Ordinary quote Ω", "", "```txt", "Code λ 😀", "```", "", "| First | Second |", "| --- | --- |", "| λ | 😀 |", "", "# End", "End body.", ""];
const source = ending => "\ufeff" + lines.join(ending);
const heading = text => {
  const query = "[[HTML#After#Child Ω", trigger = feature.builtinCompletionTrigger(query, query.length);
  return feature.headingAuthoringCompletion(query, query.length, trigger, path, text);
};

test("heading creation after raw HTML uses the same CRLF structure and exact source offsets as metadata", () => {
  for (const ending of ["\n", "\r\n"]) {
    const text = source(ending), choice = heading(text); assert.ok(choice);
    const plan = feature.planHeadingCreation(text, choice), boundary = text.indexOf("# End");
    assert.equal(plan.from, boundary); assert.equal(plan.to, boundary);
    assert.equal(plan.text, text.slice(0, boundary) + plan.insert + text.slice(boundary));
    assert.equal(feature.resolveSubpath(feature.parseMarkdown(plan.text), "#After#Child Ω").start.offset, plan.headingFrom);
    assert.ok(plan.insert.includes("## Child Ω" + ending));
  }
});

test("post-HTML block authors retain all supported complete owner kinds and exclude HTML contents", () => {
  for (const ending of ["\n", "\r\n"]) {
    const text = source(ending), values = feature.blockAuthoringCompletions("", path, text);
    const after = values.filter(value => value.from > text.indexOf("# After"));
    for (const kind of ["paragraph", "bullet-list", "quote", "fenced-code", "table"]) assert.ok(after.some(value => (value.blockKind ?? "paragraph") === kind), kind + ending);
    const htmlFrom = text.indexOf("<details>"), htmlTo = text.indexOf("</details>") + "</details>".length;
    assert.ok(values.every(value => value.to <= htmlFrom || value.from >= htmlTo));
    for (const value of after) assert.equal(text.slice(value.from, value.to), value.body);
  }
});

test("each post-HTML ID plan changes only its intended raw owner and resolves at the original UTF-16 offset", () => {
  const text = source("\r\n");
  const choices = feature.blockAuthoringCompletions("", path, text).filter(value => value.from > text.indexOf("# After"));
  assert.ok(choices.length >= 5);
  for (const choice of choices) {
    const plan = feature.planBlockId(text, choice, "new001");
    assert.equal(plan.text, text.slice(0, plan.from) + plan.insert + text.slice(plan.to));
    assert.equal(plan.from, plan.to); assert.equal(plan.text.slice(0, choice.from), text.slice(0, choice.from));
    const block = feature.resolveSubpath(feature.parseMarkdown(plan.text), "#^new001");
    assert.equal(block.start.offset, choice.from); assert.ok(block.end.offset >= choice.to);
  }
});

test("post-HTML plans retain stale-choice refusal and unsupported nested ownership", () => {
  const text = source("\r\n"), choice = heading(text); assert.ok(choice);
  assert.throws(() => feature.planHeadingCreation(text.replace("# After", "# Changed"), choice));
  const block = feature.blockAuthoringCompletions("After body", path, text)[0]; assert.ok(block);
  assert.throws(() => feature.planBlockId(text.replace("After body λ", "Newer body λ"), block, "new001"));
  const nested = "<details>HTML</details>\r\n\r\n> # Quoted\r\n> Body\r\n";
  const query = "[[HTML#Quoted#Child", trigger = feature.builtinCompletionTrigger(query, query.length);
  assert.equal(feature.headingAuthoringCompletion(query, query.length, trigger, path, nested), null);
});
