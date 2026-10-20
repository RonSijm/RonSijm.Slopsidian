import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, model;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "reading-fold-state-tests-"));
  const outfile = join(directory, "state.mjs");
  await build({ entryPoints: [join(root, "client/reading-fold-state.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  model = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/reading-fold-state-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

test("only current owned foldable starts restore, sorted without mutating profile or inventory inputs", () => {
  const payload = Object.freeze([12, 2, 0, 9]), inventory = Object.freeze([2, 12, 20]);
  assert.deepEqual(model.readingFoldState(payload, inventory), [2, 12]); assert.deepEqual(payload, [12, 2, 0, 9]); assert.deepEqual(inventory, [2, 12, 20]);
  assert.deepEqual(model.readingFoldState([0, model.MAX_READING_FOLD_STATE_LINE], [0, model.MAX_READING_FOLD_STATE_LINE]), [0, model.MAX_READING_FOLD_STATE_LINE]);
});

test("corrupt, ambiguous, unsafe and noninteger payloads refuse as a whole", () => {
  for (const value of [null, undefined, false, "[2]", {}, { length: 1, 0: 2 }, [2, 2], [2, "3"], [2, null], [2, -1], [2, .5], [2, NaN], [2, Infinity], [2, Number.MAX_SAFE_INTEGER], [2, model.MAX_READING_FOLD_STATE_LINE + 1]]) {
    assert.deepEqual(model.readingFoldState(value, [2, 3]), [], String(value));
  }
});

test("payload and inventory budgets refuse before enumeration and accept their exact bounded limit", () => {
  const oversized = new Array(model.MAX_READING_FOLD_STATE_LINES + 1); oversized[Symbol.iterator] = () => { throw Error("must not enumerate payload"); };
  assert.deepEqual(model.readingFoldState(oversized, [1]), []);
  const inventory = new Array(model.MAX_READING_FOLD_STATE_LINES + 1); inventory[Symbol.iterator] = () => { throw Error("must not enumerate inventory"); };
  assert.deepEqual(model.readingFoldState([1], inventory), []);
  const boundary = Array.from({ length: model.MAX_READING_FOLD_STATE_LINES }, (_, i) => i); assert.deepEqual(model.readingFoldState(boundary, boundary), boundary);
});

test("a restored result is detached from profile state and later inventories cannot acquire removed owners", () => {
  const payload = [1, 2, 5], restored = model.readingFoldState(payload, [1, 5]); restored.push(9);
  assert.deepEqual(payload, [1, 2, 5]); assert.deepEqual(model.readingFoldState(payload, [2]), [2]); assert.deepEqual(model.readingFoldState(payload, []), []);
});
