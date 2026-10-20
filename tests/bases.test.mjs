import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";
import { root } from "./host.mjs";

let temporary;
let BaseDocument, queryBase, BaseEvaluator, parseBaseExpression;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "bases-tests-"));
  const entry = join(temporary, "bases.mjs");
  await build({ stdin: { contents: 'export { BaseDocument, queryBase } from "./client/bases-model"; export { BaseEvaluator, parseBaseExpression } from "./client/bases-expression";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  ({ BaseDocument, queryBase, BaseEvaluator, parseBaseExpression } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

function file(path, properties = {}, extra = {}) {
  const name = path.split("/").at(-1), dot = name.lastIndexOf(".");
  return { path, name, basename: dot < 0 ? name : name.slice(0, dot), extension: dot < 0 ? "" : name.slice(dot + 1), stat: { ctime: Date.parse("2025-01-01T12:00:00Z"), mtime: Date.parse("2025-01-10T12:00:00Z"), size: 123 }, properties, tags: [], links: [], ...extra };
}
function query(text, files, extra = {}) { return queryBase({ text, files, context: file("Catalog.base"), view: "Table", search: "", page: 0, ...extra }); }
const config = (body = "", view = "") => body + '\nviews:\n  - type: table\n    name: Table\n    order: [file.name, note.status, note.price, formula.total]\n' + view;
const evaluate = (source, properties = {}, options = {}) => {
  const current = file("Projects/Note.md", properties, options);
  return new BaseEvaluator(current, file("Projects/Catalog.base"), new Map(), new Map([[current.path, current]]), { remaining: 10000 }, Date.parse("2025-01-11T12:00:00Z")).evaluate(parseBaseExpression(source));
};

test("base YAML preserves original bytes until edited and keeps opaque values, comments, aliases, BOM/CRLF and precise numbers when sorting", () => {
  const source = '\ufeff# Existing base\r\nfuture: &future\r\n  integer: 9007199254740993\r\n  decimal: 0.123456789012345678901\r\ncopy: *future\r\nproperties:\r\n  status:\r\n    displayName: Progress\r\nviews:\r\n  - type: table\r\n    name: Table\r\n    futureView: {keep: true}\r\n    order: [file.name, note.status]\r\n';
  const model = new BaseDocument(source);
  assert.equal(model.source, source);
  assert.equal(model.label("note.status"), "Progress");
  const changed = model.setView("Table", "sort", [{ property: "note.status", direction: "DESC" }]);
  for (const fragment of ["# Existing base", "&future", "*future", "integer: 9007199254740993", "decimal: 0.123456789012345678901"]) { assert.ok(changed.includes(fragment), fragment); }
  assert.equal(parseDocument(changed).getIn(["views", 0, "futureView", "keep"]), true);
  assert.ok(changed.startsWith("\ufeff")); assert.ok(!/(?<!\r)\n/.test(changed));
  const updated = new BaseDocument(changed);
  assert.deepEqual(updated.view("Table").sort, [{ property: "note.status", direction: "DESC" }]);
  const grouped = new BaseDocument(updated.setView("Table", "groupBy", { property: "note.status", direction: "ASC" }));
  assert.deepEqual(grouped.view("Table").groupBy, { property: "note.status", direction: "ASC" });
  assert.equal(new BaseDocument(grouped.setView("Table", "groupBy", null)).view("Table").groupBy, null);
});

test("global and per-view nested and/or/not filters use real file/tag/property metadata and NOR semantics", () => {
  const files = [file("Projects/A.md", { status: "open", price: 5 }, { tags: ["#book/sub"], links: ["Projects/Target.md"] }), file("Projects/B.md", { status: "done", price: 8 }, { tags: ["#book"] }), file("Archive/C.md", { status: "open", price: 9 }, { tags: ["#book"] }), file("Projects/D.md", { status: "open", price: 3 }, { tags: ["#skip"] }), file("Image.png")];
  const source = config('filters:\n  and:\n    - file.ext == "md"\n    - file.hasTag("book")\n    - not:\n        - status == "done"\n        - file.inFolder("Archive")\nformulas:\n  total: price * 2\n', '    filters:\n      or:\n        - price >= 4\n        - file.hasLink("Target")\n');
  const result = query(source, files);
  assert.deepEqual(result.rows.map(row => row.path), ["Projects/A.md"]);
  assert.deepEqual(result.rows[0].cells.map(cell => cell.text), ["A.md", "open", "5", "10"]);
  assert.deepEqual(result.errors, []);
});

test("formulas support arithmetic, lazy conditionals, dependent formulas, quoted property names, lists, strings, links and dates", () => {
  assert.equal(evaluate('if(false, 1 / 0, note["unit-price"] * 2)', { "unit-price": 2.5 }), 5);
  assert.equal(evaluate('if(true, "yes", missing.unsupported())'), "yes");
  assert.equal(evaluate('["one", "two"].contains("two") && title.lower().startsWith("note")', { title: "NOTE title" }), true);
  assert.equal(evaluate('number("2.5").toFixed(2) + " dollars"'), "2.50 dollars");
  assert.equal(evaluate('file.asLink("Open").toString()'), "Open");
  assert.equal(evaluate('this.file.folder'), "Projects");
  assert.equal(evaluate('(date("2025-01-01") + "1M").format("YYYY-MM-DD")'), "2025-02-01");
  assert.equal(evaluate('file.mtime > date("2025-01-09")'), true);
  assert.equal(evaluate('due.format("YYYY-MM-DD")', { due: "2025-03-04" }, { types: { due: "date" } }), "2025-03-04");
  const source = 'formulas:\n  doubled: price * 2\n  formatted: formula.doubled.toFixed(2)\nviews:\n  - type: table\n    name: Table\n    order: [file.name, formula.formatted]\n';
  assert.equal(query(source, [file("A.md", { price: 3 })]).rows[0].cells[1].text, "6.00");
});

test("formula and filter errors are visible, including circular references, unsafe integers, invalid types and unsupported functions", () => {
  const source = config('formulas:\n  total: formula.other\n  other: formula.total\n');
  const cyclic = query(source, [file("A.md", { status: "open", price: 3 })]);
  assert.equal(cyclic.rows[0].cells[3].text, "#ERROR"); assert.match(cyclic.rows[0].cells[3].error, /Circular/);
  assert.ok(query(config('formulas:\n  total: price / 0\n'), [file("A.md", { price: 3 })]).errors.some(error => error.includes("finite")));
  assert.ok(query(config('formulas:\n  total: price * 2\n'), [file("A.md", { price: "three" })]).errors.some(error => error.includes("number")));
  assert.ok(query(config('formulas:\n  total: price\n'), [file("A.md", { price: 9007199254740992 })]).errors.some(error => error.includes("safely")));
  const unsupported = query('filters: file.unimplemented()\nviews:\n  - type: table\n    name: Table\n', [file("A.md")]);
  assert.equal(unsupported.rows.length, 0); assert.match(unsupported.errors[0], /Unsupported/);
  const syntax = query(config('formulas:\n  total: "a => a"\n'), [file("A.md")]);
  assert.equal(syntax.rows[0].cells[3].text, "#ERROR"); assert.ok(syntax.warnings.some(warning => warning.includes("Formula total")));
});

test("table sorting, grouping, limits, display names, search and 100-row pages use evaluated property values", () => {
  const files = Array.from({ length: 130 }, (_, index) => file(`Note ${index}.md`, { status: index % 2 ? "open" : "done", price: index }));
  const source = config('formulas:\n  total: price * 2\nproperties:\n  formula.total:\n    displayName: Amount\n', '    sort:\n      - property: note.price\n        direction: DESC\n    groupBy:\n      property: note.status\n      direction: ASC\n    limit: 120\n');
  const first = query(source, files), second = query(source, files, { page: 1 });
  assert.equal(first.total, 120); assert.equal(first.matched, 130); assert.equal(first.rows.length, 100); assert.equal(second.rows.length, 20);
  assert.equal(first.columns[3].label, "Amount");
  assert.equal(first.rows[0].path, "Note 128.md");
  assert.deepEqual(first.groups.map(({ label, count }) => ({ label, count })), [{ label: "done", count: 65 }, { label: "open", count: 55 }]);
  assert.equal(query(source, files, { search: "Note 129.md" }).rows[0].path, "Note 129.md");
  assert.equal(query(source, files, { page: 999 }).page, 1);
});

test("missing group values stay distinct from a literal No value label and structured grouping fails explicitly", () => {
  const source = 'views:\n  - type: table\n    name: Table\n    order: [file.name, note.status]\n    groupBy:\n      property: note.status\n      direction: ASC\n';
  const result = query(source, [file("A.md", { status: "No value" }), file("B.md")]);
  assert.equal(result.groups.length, 2); assert.notEqual(result.rows[0].groupKey, result.rows[1].groupKey);
  assert.throws(() => query(source, [file("A.md", { status: ["one", "two"] })]), /Grouping structured/);
});

test("invalid documents, duplicate names/keys and unsupported view types never produce replacement source", () => {
  for (const source of ["[array]", "broken: [", "views: []", 'views:\n  - type: table\n    name: A\n  - type: table\n    name: A\n', 'views:\n  - type: table\n    name: A\n    order: [status, note.status]\n', 'filters:\n  unknown: []\nviews:\n  - type: table\n    name: A\n', 'views:\n  - type: table\n    name: A\n    limit: 10001\n', 'views:\n  - type: table\n    name: A\n    name: B\n']) { assert.throws(() => new BaseDocument(source), undefined, source); }
  const source = 'future: {keep: true}\nviews:\n  - type: cards\n    name: Gallery\n';
  const model = new BaseDocument(source); assert.equal(model.source, source); assert.throws(() => query(source, []), /retained but not implemented/);
});

test("the formula parser cannot reach JavaScript constructors, prototypes, assignments, globals or arbitrary functions", () => {
  for (const source of ['[].constructor', 'note["__proto__"]', 'file["constructor"]()', 'x = 2', 'require("node:fs")', 'globalThis.process.exit()', 'new Function("return 1")()', '(() => 1)()', 'file.name.match(/x/)']) { assert.throws(() => evaluate(source), undefined, source); }
  assert.throws(() => evaluate("(".repeat(60) + "1" + ")".repeat(60)), /nesting/);
  assert.throws(() => evaluate("9007199254740993"), /safely/);
  assert.throws(() => evaluate('date("invalid")'), /Invalid date/);
  const input = file("A.md");
  const limited = new BaseEvaluator(input, input, new Map(), new Map(), { remaining: 2 }, 0);
  assert.throws(() => limited.evaluate(parseBaseExpression("1+2+3")), /budget/);
});

function summarized(name, files, options = {}) {
  const source = options.source ?? 'views:\n  - type: table\n    name: Table\n    order: [file.name, note.amount]\n    summaries:\n      note.amount: ' + name + '\n';
  return query(source, files, options.query);
}
const summaryText = (name, files, options) => summarized(name, files, options).summaries[1].text;

test("built-in numeric summaries use the pinned formulas, including population deviation, rounding and the original mean denominator", () => {
  const files = [1, 2, 3, null].map((amount, index) => file(index + ".md", { amount }));
  for (const [name, expected] of Object.entries({ Average: "1.5", Min: "1", Max: "3", Sum: "6", Range: "2", Median: "2", Stddev: "0.82", Empty: "1", Filled: "3", Unique: "4" })) {
    const result = summarized(name, files);
    assert.equal(result.summaries[1].text, expected, name); assert.equal(result.summaries[1].name, name); assert.deepEqual(result.errors, []);
  }
  assert.equal(summaryText("Median", [2, 8, 1, 3].map((amount, index) => file(index + ".md", { amount }))), "2.5");
  assert.equal(summaryText("Sum", [0.125, 1.111].map((amount, index) => file(index + ".md", { amount }))), "1.24");
  assert.equal(summaryText("Stddev", [file("Only.md", { amount: 15 })]), "0");
  assert.equal(summaryText("Sum", [file("A.md", { amount: Number.MAX_SAFE_INTEGER }), file("B.md", { amount: 1 })]), "#ERROR");
});

test("date, checkbox and universal summaries retain null distinctions, empty scalar/list values, link identity and date ranges", () => {
  const dates = [file("A.md", { amount: "2025-03-01" }, { types: { amount: "date" } }), file("B.md", { amount: "2025-03-03" }, { types: { amount: "date" } }), file("C.md")];
  assert.match(summaryText("Earliest", dates), /^2025-03-01/); assert.match(summaryText("Latest", dates), /^2025-03-03/);
  assert.equal(summaryText("Range", dates), String(2 * 86400000));
  const values = [true, false, null, "", [], 0].map((amount, index) => file(index + ".md", { amount }));
  assert.equal(summaryText("Checked", values), "1"); assert.equal(summaryText("Unchecked", values), "1");
  assert.equal(summaryText("Empty", values), "1"); assert.equal(summaryText("Filled", values), "5"); assert.equal(summaryText("Unique", values), "6");
  const links = [file("A.md", { amount: 1 }), file("B.md", { amount: 2 })];
  const source = 'formulas:\n  target: link("Target.md", file.name)\nviews:\n  - type: table\n    name: Table\n    order: [formula.target]\n    summaries: {formula.target: Unique}\n';
  assert.equal(query(source, links).summaries[0].text, "1");
});

test("whole-result and per-group summaries include off-page rows and follow filtering, search, sorting and limits", () => {
  const files = Array.from({ length: 130 }, (_, index) => file("Note " + (index + 1) + ".md", { amount: index + 1, status: index % 2 ? "open" : "done" }));
  const source = 'views:\n  - type: table\n    name: Table\n    order: [file.name, note.amount]\n    groupBy: {property: note.status, direction: ASC}\n    summaries: {amount: Sum}\n';
  const first = query(source, files), second = query(source, files, { page: 1 });
  assert.equal(first.rows.length, 100); assert.equal(second.rows.length, 30);
  assert.equal(first.summaries[1].text, "8515"); assert.equal(second.summaries[1].text, "8515");
  assert.deepEqual(first.groups.map(group => [group.label, group.count, group.summaries?.[1].text]), [["done", 65, "4225"], ["open", 65, "4290"]]);
  assert.equal(second.groups.find(group => group.label === "open").summaries[1].text, "4290", "group spans both pages");
  assert.equal(query(source, files, { search: "Note 130.md" }).summaries[1].text, "130");
  assert.equal(query(source + '    limit: 70\n', files).summaries[1].text, "4255");
  assert.equal(query('filters: status == "open"\n' + source, files).summaries[1].text, "4290");
  const broken = [...files]; broken[129] = file("Note 130.md", { amount: Number.MAX_SAFE_INTEGER + 1, status: "open" });
  const result = query(source, broken); assert.equal(result.rows.some(row => row.path === "Note 130.md"), false);
  assert.equal(result.summaries[1].text, "#ERROR", "an off-page error cannot produce a misleading partial sum");
  assert.match(result.summaries[1].error, /cell errors/); assert.equal(result.groups[0].summaries[1].text, "4225");
});

test("empty results and all-null columns produce zero counts or No value, preserving explicitly selected numeric/date summaries", () => {
  for (const files of [[], [file("A.md"), file("B.md")]]) {
    for (const name of ["Average", "Min", "Max", "Median", "Stddev", "Sum", "Range", "Earliest", "Latest"]) { assert.equal(summaryText(name, files), "No value", name); }
    assert.equal(summaryText("Empty", files), String(files.length)); assert.equal(summaryText("Filled", files), "0");
    assert.equal(summaryText("Unique", files), files.length ? "1" : "0");
    assert.equal(summaryText("Checked", files), "0"); assert.equal(summaryText("Unchecked", files), "0");
  }
  const source = 'views:\n  - type: table\n    name: Table\n    order: [file.name, amount]\n    limit: 0\n    summaries: {amount: Sum}\n';
  assert.equal(query(source, [file("A.md", { amount: 12 })]).summaries[1].text, "No value");
});

test("custom summaries use scoped values/filter/map/reduce, cannot inherit a row's properties and preserve ordinary values properties", () => {
  const source = 'summaries:\n  precise: values.mean().round(3)\n  doubled: values.filter(value.isType("number")).map(value * 2 + index).reduce(acc + value, 0)\n  isolated: if(file == null && note == null && this == null, "isolated", "leaked")\nviews:\n  - type: table\n    name: Table\n    order: [amount, note.done, file.name]\n    summaries: {amount: precise, note.done: doubled, file.name: isolated}\n';
  const result = query(source, [file("A.md", { amount: 1, done: 2 }), file("B.md", { amount: 2, done: 4 }), file("C.md", { amount: 2 })]);
  assert.deepEqual(result.summaries.map(value => value.text), ["1.667", "13", "isolated"]);
  assert.deepEqual(result.errors, []);
  assert.equal(evaluate("values", { values: "a normal note property" }), "a normal note property");
  assert.deepEqual(evaluate('[1,2,3].map(value + index)'), [1, 3, 5]);
  assert.equal(evaluate('[1,2,3].reduce(acc + value, 4)'), 10);
  assert.deepEqual(evaluate('[1,2].map([3,4].map(value + index).join(",") + ":" + value)'), ["3,5:1", "3,5:2"], "nested value/index bindings restore their outer scope");
});

test("summary selection patches only the intended YAML keys and preserves unknown/comments/aliases/exact numeric tokens/BOM/CRLF", () => {
  const source = '\ufeff# Keep summary source\r\nfuture: &future {integer: 9007199254740993, decimal: 0.123456789012345678901}\r\ncopy: *future\r\nsummaries:\r\n  old: values.sum() # Retain custom formula\r\nviews:\r\n  - type: table\r\n    name: Table\r\n    order: [file.name, note.amount]\r\n    futureView: {retain: true}\r\n    summaries: {amount: old, file.name: Filled}\r\n  - type: table\r\n    name: Other\r\n    summaries: {note.amount: old}\r\n';
  let model = new BaseDocument(source); assert.equal(model.source, source);
  const changed = model.setSummary("Table", "note.amount", "Sum");
  for (const fragment of ["# Keep summary source", "&future", "*future", "9007199254740993", "0.123456789012345678901", "# Retain custom formula"]) { assert.ok(changed.includes(fragment), fragment); }
  assert.ok(changed.startsWith("\ufeff")); assert.ok(!/(?<!\r)\n/.test(changed));
  model = new BaseDocument(changed);
  assert.equal(model.summary("Table", "amount"), "Sum"); assert.equal(model.summary("Other", "note.amount"), "old");
  let parsed = parseDocument(changed); assert.equal(parsed.getIn(["views", 0, "futureView", "retain"]), true);
  assert.equal(parsed.getIn(["views", 0, "summaries", "amount"]), undefined, "canonical alias was replaced, not duplicated");
  const custom = model.setSummary("Table", "note.amount", "New total λ", { name: "New total λ", formula: "values.sum() * 2" });
  parsed = parseDocument(custom); assert.equal(parsed.getIn(["summaries", "old"]), "values.sum()"); assert.equal(parsed.getIn(["summaries", "New total λ"]), "values.sum() * 2");
  const removed = new BaseDocument(custom).setSummary("Table", "note.amount", null);
  assert.equal(new BaseDocument(removed).summary("Table", "file.name"), "Filled");
  assert.equal(new BaseDocument(removed).summary("Table", "amount"), null);
  assert.throws(() => model.setSummary("Table", "amount", "old", { name: "old", formula: "2" }), /new custom summary name/);
  assert.throws(() => model.setSummary("Table", "amount", "Sum", { name: "Sum", formula: "2" }), /new custom summary name/);
  assert.throws(() => model.setSummary("Table", "missing", "Sum"), /displayed column/);
});

test("unknown/malformed/unsafe summaries fail explicitly without hiding valid rows or other column summaries", () => {
  const files = [file("A.md", { amount: 2 }), file("B.md", { amount: 4 })];
  for (const formula of ['values.reduce(acc + value, 0) / 0', 'require("node:fs")', 'values.constructor', 'values["__proto__"]', 'globalThis.process.exit()', 'values.map(value = 2)', '[].fetch("https://invalid")', 'values', 'values.map(value)']) {
    const source = 'summaries:\n  Unsafe: ' + JSON.stringify(formula) + '\nviews:\n  - type: table\n    name: Table\n    order: [file.name, note.amount]\n    summaries: {file.name: Filled, note.amount: Unsafe}\n';
    const result = query(source, files);
    assert.equal(result.rows.length, 2); assert.equal(result.summaries[0].text, "2"); assert.equal(result.summaries[1].text, "#ERROR", formula); assert.ok(result.errors.length);
  }
  assert.equal(summaryText("NotDefined", files), "#ERROR");
  assert.match(summarized("Sum", [file("A.md", { amount: "two" })]).summaries[1].error, /incompatible/);
  for (const summaries of ['{amount: Sum, note.amount: Min}', '[Sum]', '{amount: 4}', '{amount: ""}']) {
    assert.throws(() => new BaseDocument('views:\n  - type: table\n    name: Table\n    summaries: ' + summaries + '\n'));
  }
  assert.throws(() => new BaseDocument('summaries: []\n'));
});

test("summary list work stays within query budgets, supports the full 10,000-row result and restores scopes on failure", () => {
  const input = file("A.md", { values: "retained" });
  const evaluator = budget => new BaseEvaluator(input, input, new Map(), new Map(), budget, 0);
  assert.equal(evaluator({ remaining: 100000 }).evaluateSummary(parseBaseExpression("values.sum()"), Array.from({ length: 10000 }, () => 1)), 10000);
  assert.equal(evaluator({ remaining: 100000 }).evaluateSummary(parseBaseExpression("values.unique().length"), Array.from({ length: 10000 }, (_, index) => index)), 10000);
  assert.throws(() => evaluator({ remaining: 100000 }).evaluateSummary(parseBaseExpression("values.length"), Array(10001).fill(1)), /10,000/);
  assert.throws(() => evaluator({ remaining: 100 }).evaluateSummary(parseBaseExpression("values.map(values.map(value + index))"), Array(50).fill(1)), /budget/);
  assert.throws(() => evaluator({ remaining: 100 }).evaluateSummary(parseBaseExpression("values.reduce(value)"), [1]), /argument count/);
  const reuse = evaluator({ remaining: 100000 });
  assert.throws(() => reuse.evaluateSummary(parseBaseExpression("values.map(1 / 0)"), [1]), /finite/);
  assert.equal(reuse.evaluate(parseBaseExpression("values")), "retained");
  assert.throws(() => reuse.evaluate(parseBaseExpression("value.sum()")), /Unsupported method/);
});
