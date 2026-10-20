import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./host.mjs";

const directory = join(root, "tests", "fixtures", "viewers");
const read = name => readFile(join(directory, name));

test("viewer proof fixtures match their provenance manifest", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.match(manifest._provenance, /Synthetic/);
  for (const name of ["Split.avif", "Seek.webm"]) {
    const bytes = await read(name);
    assert.equal(bytes.length, manifest[name].bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest[name].sha256);
  }
});

test("the AVIF fixture is a real AV1 still image with a 32x16 spatial extent", async () => {
  const bytes = await read("Split.avif");
  assert.equal(bytes.subarray(4, 12).toString("latin1"), "ftypavif");
  const text = bytes.toString("latin1");
  for (const box of ["meta", "pitm", "iloc", "av01", "av1C", "mdat"]) { assert.ok(text.includes(box), box + " box"); }
  const ispe = text.indexOf("ispe");
  assert.equal(bytes.readUInt32BE(ispe + 8), 32);
  assert.equal(bytes.readUInt32BE(ispe + 12), 16);
});

test("the WebM fixture is VP9 in Matroska with a finite duration and Cues for seeking", async () => {
  const bytes = await read("Seek.webm");
  assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(bytes.includes(Buffer.from("webm", "latin1")));
  assert.ok(bytes.includes(Buffer.from("V_VP9", "latin1")));
  assert.ok(bytes.includes(Buffer.from([0x1c, 0x53, 0xbb, 0x6b])), "Cues element");
  assert.ok(bytes.includes(Buffer.from([0x44, 0x89])), "Segment Info Duration element");
});
