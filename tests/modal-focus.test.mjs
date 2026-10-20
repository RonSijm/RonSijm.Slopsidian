import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build } from "esbuild";
let modalTabStops, modalFocusAvailable, cycleModalFocus, focusModalEdge;
before(async () => {
  const result = await build({ entryPoints: ["client/modal-focus.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  ({ modalTabStops, modalFocusAvailable, cycleModalFocus, focusModalEdge } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")));
});
function fixture(values) {
  const document = { activeElement: null }, root = {
    ownerDocument: document, contains: value => value === root || values.includes(value),
    querySelectorAll: () => values, focus() { document.activeElement = root; },
  };
  for (const value of values) {
    Object.assign(value, {
      tagName: value.tagName ?? "BUTTON", tabIndex: value.tabIndex ?? 0, isConnected: value.isConnected ?? true,
      closest: () => value.unavailable ? {} : null, matches: () => Boolean(value.disabled),
      getClientRects: () => value.layout === false ? [] : [{}], checkVisibility: () => value.visible !== false,
      hasAttribute: () => Boolean(value.explicitIndex),
      focus() { if (!value.refuseFocus) { document.activeElement = value; } },
    });
  }
  return { root, document };
}
test("Available modal controls exclude hidden, inert, detached, disabled and non-layout descendants, while retaining readonly fields", () => {
  const values = [{ id: "readonly", tagName: "INPUT", readOnly: true }, { unavailable: true }, { disabled: true }, { layout: false }, { visible: false }, { isConnected: false }, { tabIndex: -1 }];
  const { root } = fixture(values);
  assert.deepEqual(modalTabStops(root), [values[0]]);
  assert.equal(modalFocusAvailable(values.at(-1)), true, "Programmatic negative-index focus is still available.");
});
test("Positive tab indexes precede stable DOM-order zero indexes", () => {
  const values = [{ id: "zero" }, { id: "two", tabIndex: 2 }, { id: "one-a", tabIndex: 1 }, { id: "one-b", tabIndex: 1 }, { id: "last" }];
  const { root } = fixture(values);
  assert.deepEqual(modalTabStops(root).map(value => value.id), ["one-a", "one-b", "two", "zero", "last"]);
  assert.deepEqual(modalTabStops(root, true).map(value => value.id), ["one-a", "one-b", "two", "zero", "last"]);
});
test("Radio stops are grouped by name and form owner, respecting checked choice and traversal direction when unchecked", () => {
  const form = {}, otherForm = {};
  const radio = (name, owner, checked = false) => ({ tagName: "INPUT", type: "radio", name, form: owner, checked });
  const values = [radio("a", form), radio("a", form, true), radio("a", otherForm), radio("a", otherForm), radio("b", form), radio("b", form), radio("", form), radio("", form)];
  const { root } = fixture(values);
  assert.deepEqual(modalTabStops(root), [values[1], values[2], values[4], values[6], values[7]]);
  assert.deepEqual(modalTabStops(root, true), [values[1], values[3], values[5], values[6], values[7]]);
});
test("Editable roots and the first native summary participate without inventing stops for nested editable regions or later summaries", () => {
  const first = { tagName: "SUMMARY" }, later = { tagName: "SUMMARY" };
  const details = { tagName: "DETAILS", querySelector: () => first };
  first.parentElement = later.parentElement = details;
  const values = [first, later, { tabIndex: -1, isContentEditable: true }, { tabIndex: -1, isContentEditable: true, parentElement: { isContentEditable: true } }];
  const { root } = fixture(values);
  assert.deepEqual(modalTabStops(root), [first, values[2]]);
});
test("Both directions traverse the current dialog order, wrap at its edges and recover root or escaped focus", () => {
  const values = [{}, {}, {}], { root, document } = fixture(values);
  document.activeElement = values[1]; assert.equal(cycleModalFocus(root), true); assert.equal(document.activeElement, values[2]);
  assert.equal(cycleModalFocus(root, true), true); assert.equal(document.activeElement, values[1]);
  document.activeElement = values[2]; assert.equal(cycleModalFocus(root), true); assert.equal(document.activeElement, values[0]);
  assert.equal(cycleModalFocus(root, true), true); assert.equal(document.activeElement, values[2]);
  document.activeElement = {}; assert.equal(cycleModalFocus(root), true); assert.equal(document.activeElement, values[0]);
  document.activeElement = root; assert.equal(cycleModalFocus(root, true), true); assert.equal(document.activeElement, values[2]);
});
test("Current availability is recalculated after a control becomes disabled or disappears", () => {
  const values = [{}, {}, {}], { root, document } = fixture(values);
  values[2].disabled = true; document.activeElement = values[1];
  assert.equal(cycleModalFocus(root), true); assert.equal(document.activeElement, values[0]);
  values[0].isConnected = false; focusModalEdge(root); assert.equal(document.activeElement, values[1]);
});
test("An empty dialog and a control that declines focus fall back to the programmatically focusable dialog", () => {
  const empty = fixture([]); assert.equal(cycleModalFocus(empty.root), true); assert.equal(empty.document.activeElement, empty.root);
  const f = fixture([{ refuseFocus: true }]); f.document.activeElement = {};
  focusModalEdge(f.root); assert.equal(f.document.activeElement, f.root);
});
