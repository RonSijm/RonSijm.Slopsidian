import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { assertExtraHighlightingBlocks, inspectExtraHighlighting, readOnlyExtraHighlightingMarkdown } from "../tools/extra-highlighting-scenarios.mjs";

const tokenCases = {
  dart: [["class", "keyword"], ['"readonly λ 😀"', "string"], ["42", "number"]],
  clojure: [["defn", "keyword"], ["true", "constant"], ['"readonly λ 😀"', "string"], ["42", "number"]],
  cmake: [["set", "variable"], ['"readonly λ 😀"', "string"], ["${NAME}", "variable"], ["# kept", "comment"]],
  objectivec: [["@interface", "keyword"], ["@end", "keyword"], ['"readonly λ 😀"', "string"], ["return", "keyword"], ["42", "number"]],
  julia: [["function", "keyword"], ["return", "keyword"], ["42", "number"], ['"readonly λ 😀"', "string"], ["# kept", "comment"]],
  groovy: [["class", "keyword"], ["return", "keyword"], ["42", "number"], ['"readonly λ 😀"', "string"], ["// kept", "comment"]],
  pascal: [["begin", "keyword"], ["42", "number"], ["'readonly λ 😀'", "string"], ["{ kept }", "comment"]],
  vb: [["Dim", "keyword"], ["Return", "keyword"], ["42", "number"], ['"readonly λ 😀"', "string"], ["' kept", "comment"]],
};
const markdown = readOnlyExtraHighlightingMarkdown();
const samples = [...markdown.matchAll(/^```(\w+)\n([\s\S]*?)\n```$/gm)].map(match => ({ language: match[1], source: match[2], tokens: tokenCases[match[1]] }));
const sourceLines = markdown.split("\n").flatMap((line, index) => /^```\w/.test(line) ? [index] : []);

function inspectFixture({ injection = false, contrast = true } = {}) {
  const codes = samples.map((sample, index) => {
    const tokens = sample.tokens.map(([textContent, kind]) => ({ textContent, className: "token " + kind, color: contrast ? "rgb(180, 100, 40)" : "rgb(200, 200, 200)" }));
    return { dataset: { codeHighlighted: sample.language }, textContent: sample.source + "\n", innerText: sample.source + "\n", parentElement: { dataset: { sourceLine: String(sourceLines[index]) } }, color: "rgb(200, 200, 200)",
      hasAttribute: name => name === "data-code-highlighted", querySelectorAll: selector => selector === ".token" ? tokens : [],
      querySelector: selector => selector === ".token.keyword,.token.string,.token.comment" ? tokens.find(token => /\b(keyword|string|comment)\b/.test(token.className)) ?? null : null };
  });
  const root = { querySelectorAll: selector => selector === "pre>code[data-code-highlighted]" ? codes : selector === "code.language-dart" ? codes.filter(code => code.dataset.codeHighlighted === "dart") : [],
    querySelector: selector => injection && selector === "pre img,pre iframe,pre script,pre svg" ? {} : null };
  return vm.runInNewContext(inspectExtraHighlighting("fixture"), { fixture: root, getComputedStyle: node => ({ color: node.color }) });
}

test("shared cache-only Markdown preserves prior four fixtures and installs all four follow-up grammars", () => {
  assert.deepEqual(samples.map(sample => sample.language), ["dart", "clojure", "cmake", "objectivec", "julia", "groovy", "pascal", "vb"]);
  assert.equal(markdown.startsWith("# Extra read-only code languages\n\n"), true);
  assert.equal(markdown.endsWith("\n```\n"), true);
  assert.equal(markdown.includes("\r"), false);
  assert.equal(markdown.includes('message(STATUS "${NAME}")'), true, "The cached fixture keeps its literal CMake interpolation.");
  for (const sample of samples) {
    assert.equal(sample.source.includes("readonly λ 😀"), true, sample.language);
    for (const [text] of sample.tokens) { assert.equal(sample.source.includes(text), true, sample.language + ": " + text); }
  }
});

test("generated inspector compiles for Reading and each public renderer host", () => {
  for (const root of ["app.workspace.activeLeaf.view.previewEl", "__extraHighlightProbe.host", "__extraHighlightProbe.precedenceHost"]) {
    assert.doesNotThrow(() => new vm.Script(inspectExtraHighlighting(root)), root);
  }
});

test("inspector reads actual glyph text, semantic classes, source mapping and computed theme contrast", () => {
  const actual = inspectFixture();
  assertExtraHighlightingBlocks(actual, { expected: samples, sourceLines, colored: true });
  for (const block of actual.blocks.slice(-4)) {
    assert.equal(block.glyphs, block.text);
    assert.equal(block.tokens.some(token => token.classes === "token keyword"), true, block.language);
    assert.equal(block.tokens.some(token => token.classes === "token number" && token.text === "42"), true, block.language);
  }
  const plain = inspectFixture({ contrast: false });
  assert.equal(plain.blocks.every(block => block.colored === false), true);
  assert.throws(() => assertExtraHighlightingBlocks(plain, { expected: samples, colored: true }));
});

test("acceptance rejects unchanged source with wrong glyphs, missing classes, wrong owners or absent color", () => {
  for (const [caseName, mutate] of [
    ["wrong glyphs", block => { block.glyphs = block.glyphs.replace("λ 😀", "😀 λ"); }],
    ["missing keyword class", block => { block.tokens = block.tokens.filter(token => !token.classes.includes("keyword")); }],
    ["wrong grammar", block => { block.language = "dart"; }],
    ["wrong section", block => { block.line++; }],
    ["plain color", block => { block.colored = false; }],
  ]) {
    for (const index of [4, 5, 6, 7]) {
      const actual = inspectFixture(); mutate(actual.blocks[index]);
      assert.throws(() => assertExtraHighlightingBlocks(actual, { expected: samples, sourceLines, colored: true }), undefined, samples[index].language + ": " + caseName);
    }
  }
});

test("acceptance rejects injected elements, missing fences and mutated literal Unicode source", () => {
  assert.throws(() => assertExtraHighlightingBlocks(inspectFixture({ injection: true }), { expected: samples }));
  const missing = inspectFixture(); missing.blocks.pop();
  assert.throws(() => assertExtraHighlightingBlocks(missing, { expected: samples }));
  const changed = inspectFixture(); changed.blocks[4].text = changed.blocks[4].text.replace("42", "43");
  assert.throws(() => assertExtraHighlightingBlocks(changed, { expected: samples }));
});
