import assert from "node:assert/strict";
import { test } from "node:test";
import { fitPaneDimensions, paneDimensions, paneResizeBounds, resizedPaneDimensions } from "../client/workspace-pane-size.ts";

test("old equal splits, complete dimensions and partially specified original dimensions normalize predictably", () => {
  assert.deepEqual(paneDimensions([]), []);
  assert.deepEqual(paneDimensions([{}, {}, {}, {}]), [25, 25, 25, 25]);
  assert.deepEqual(paneDimensions([{ dimension: 62.5 }, {}]), [62.5, 37.5]);
  assert.deepEqual(paneDimensions([{ dimension: 30 }, { dimension: 20 }, {}]), [30, 20, 50]);
  assert.deepEqual(paneDimensions([{ dimension: 75 }]), [100]);
  assert.deepEqual(paneDimensions([{ dimension: 100 }, {}]), [50, 50]);
});

test("resizing an adjacent pair preserves all other panes and the pair's combined share", () => {
  const original = [20, 30, 40, 10], resized = resizedPaneDimensions(original, 1, .6);
  assert.deepEqual(resized, [20, 42, 28, 10]); assert.deepEqual(original, [20, 30, 40, 10]);
  assert.equal(resized.reduce((sum, value) => sum + value), 100);
});

test("invalid pane dimensions and invalid pair requests are refused before returning changed weights", () => {
  for (const dimension of [0, -1, 101, NaN, Infinity, "50", null]) { assert.throws(() => paneDimensions([{ dimension }]), /Pane dimensions/); }
  for (const fraction of [0, 1, -1, NaN, Infinity]) { assert.throws(() => resizedPaneDimensions([50, 50], 0, fraction)); }
  for (const index of [-1, .5, 1, NaN]) { assert.throws(() => resizedPaneDimensions([50, 50], index, .5)); }
});

test("recursive minimum bounds protect larger nested groups without forcing overflow on tiny viewports", () => {
  assert.deepEqual(paneResizeBounds(1000, 240, 120), { min: .24, max: .88 });
  const small = paneResizeBounds(180, 240, 120);
  assert.equal(small.min, 2 / 3); assert.ok(Math.abs(small.max - 2 / 3) < 1e-12);
  const tiny = paneResizeBounds(.25, 120, 80);
  assert.ok(tiny.min > 0 && tiny.max < 1); assert.ok(Math.abs(tiny.min - tiny.max) < 1e-12);
});

test("nonfinite, zero and negative viewport measurements cannot produce NaN resize styles", () => {
  for (const pixels of [0, -1, NaN, Infinity]) { assert.throws(() => paneResizeBounds(pixels, 120, 80)); }
  assert.throws(() => paneResizeBounds(100, 0, 80)); assert.throws(() => paneResizeBounds(100, 120, -1));
});

test("fitting preserves unconstrained preferences and reallocates space from large panes to undersized peers", () => {
  const weights = [20, 30, 50];
  assert.deepEqual(fitPaneDimensions(weights, 1000, [120, 120, 120]), weights);
  assert.deepEqual(fitPaneDimensions([5, 5, 10, 80], 800, [120, 120, 120, 120]), [15, 15, 15, 55]);
  assert.deepEqual(fitPaneDimensions([5, 45, 50], 1000, [150, 100, 500]), [15, 35, 50]);
  const roundedMinimum = [68, 11.9999, 20.0001];
  assert.deepEqual(fitPaneDimensions(roundedMinimum, 1000, [120, 120, 120]), roundedMinimum);
  assert.deepEqual(weights, [20, 30, 50]);
});

test("insufficient viewport space scales recursive minimums without changing the stored preferences", () => {
  const weights = [40, 40, 20], minimums = [120, 245, 120], fitted = fitPaneDimensions(weights, 200, minimums);
  fitted.forEach((value, index) => assert.ok(Math.abs(value / fitted[0] - minimums[index] / minimums[0]) < 1e-12));
  assert.ok(Math.abs(fitted.reduce((sum, value) => sum + value) - 100) < 1e-12);
  assert.deepEqual(weights, [40, 40, 20]);
});

test("invalid fitting inputs cannot generate invalid flex weights", () => {
  for (const args of [[[], 500, []], [[50, 50], 0, [120, 120]], [[50, 50], 500, [120]], [[50, NaN], 500, [120, 120]], [[50, 50], 500, [0, 120]]]) {
    assert.throws(() => fitPaneDimensions(...args));
  }
});
