import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { link, mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { readAttachmentFolder } = createRequire(import.meta.url)("../desktop/attachment-source.cjs");
const fixture = async body => {
  const base = await mkdtemp(join(tmpdir(), "slopsidian-folder-"));
  try { await body(base); } finally { await rm(base, { recursive: true, force: true }); }
};

test("A regular folder is read completely with hierarchy, exact bytes and its own root name", () => fixture(async base => {
  const root = join(base, "Chosen"), bytes = Buffer.from([0, 255, 13, 10]);
  await mkdir(join(root, "a", "b"), { recursive: true }); await writeFile(join(root, "Top.bin"), bytes); await writeFile(join(root, "a", "b", "Deep.txt"), "deep");
  const result = await readAttachmentFolder(root, [join(root, "Top.bin"), join(root, "a", "b", "Deep.txt")]);
  assert.equal(result.root, "Chosen"); assert.deepEqual(result.files.map(file => file.name), ["Chosen/Top.bin", "Chosen/a/b/Deep.txt"]);
  assert.deepEqual(Buffer.from(result.files[0].bytes), bytes);
}));

test("A junction or symlink inside the selected folder is refused before any bytes are returned", () => fixture(async base => {
  const root = join(base, "Chosen"), outside = join(base, "Outside");
  await mkdir(root); await mkdir(outside); await writeFile(join(outside, "Sentinel.bin"), "SECRET"); await writeFile(join(root, "Real.txt"), "ok");
  await symlink(outside, join(root, "Link"), "junction");
  await assert.rejects(readAttachmentFolder(root), /link, junction or reparse/);
}));

test("A file symlink is refused when the platform allows creating one", () => fixture(async base => {
  const root = join(base, "Chosen"); await mkdir(root); await writeFile(join(base, "Outside.bin"), "SECRET");
  try { await symlink(join(base, "Outside.bin"), join(root, "Linked.bin"), "file"); } catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { return; } throw error; }
  await assert.rejects(readAttachmentFolder(root), /link, junction or reparse/);
}));

test("A junction in a parent component of the selected root is refused", () => fixture(async base => {
  const real = join(base, "Real"), alias = join(base, "Alias");
  await mkdir(join(real, "Chosen"), { recursive: true }); await writeFile(join(real, "Chosen", "Sentinel.bin"), "SECRET");
  await symlink(real, alias, "junction");
  await assert.rejects(readAttachmentFolder(join(alias, "Chosen")), /passes through a link/);
}));

test("A file swapped for a link after the walk is refused without reading the outside bytes", () => fixture(async base => {
  const root = join(base, "Chosen"), outsideFile = join(base, "Outside.bin"), sentinel = Buffer.from("SECRET-SENTINEL");
  await mkdir(root); await writeFile(join(root, "Real.bin"), Buffer.from("SECRET-SENTINEL".replace(/./g, "x"))); await writeFile(outsideFile, sentinel);
  let outcome;
  try {
    outcome = await readAttachmentFolder(root, [], { beforeRead: async full => {
      await unlink(full);
      try { await symlink(outsideFile, full, "file"); } catch (error) { if (!["EPERM", "EACCES"].includes(error.code)) { throw error; } await link(outsideFile, full); }
    } });
  } catch (error) { outcome = error; }
  assert.ok(outcome instanceof Error, "swap must be refused");
  assert.match(outcome.message, /changed before|replaced before/);
  assert.ok(!JSON.stringify(outcome.message).includes("SECRET"));
}));

test("A selected root that is itself a link is refused", () => fixture(async base => {
  const outside = join(base, "Outside"), link = join(base, "RootLink"); await mkdir(outside); await writeFile(join(outside, "Sentinel.bin"), "SECRET");
  await symlink(outside, link, "junction");
  await assert.rejects(readAttachmentFolder(link), /link or not a directory/);
}));

test("Claimed selections outside the root or missing from the native listing are refused as unselected", () => fixture(async base => {
  const root = join(base, "Chosen"); await mkdir(root); await writeFile(join(root, "In.txt"), "in"); await writeFile(join(base, "Out.txt"), "out");
  await assert.rejects(readAttachmentFolder(root, [join(base, "Out.txt")]), /beneath the selected folder/);
  await assert.rejects(readAttachmentFolder(root, [join(root, "Missing.txt")]), /beneath the selected folder/);
  await assert.rejects(readAttachmentFolder(root, ["relative.txt"]), /beneath the selected folder/);
  await assert.rejects(readAttachmentFolder("relative"), /absolute/);
}));

test("Count, size, depth and empty-tree limits refuse the whole folder", () => fixture(async base => {
  const many = join(base, "Many"); await mkdir(many); for (let i = 0; i < 21; i++) { await writeFile(join(many, i + ".txt"), ""); }
  await assert.rejects(readAttachmentFolder(many), /1 and 20/);
  const big = join(base, "Big"); await mkdir(big); await writeFile(join(big, "Big.bin"), Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(readAttachmentFolder(big), /16 MiB/);
  const total = join(base, "Total"); await mkdir(total); for (const name of ["a", "b", "c"]) { await writeFile(join(total, name), Buffer.alloc(11 * 1024 * 1024)); }
  await assert.rejects(readAttachmentFolder(total), /32 MiB/);
  const deep = join(base, "Deep", ...Array(13).fill("d")); await mkdir(deep, { recursive: true }); await writeFile(join(deep, "f.txt"), "x");
  await assert.rejects(readAttachmentFolder(join(base, "Deep")), /nested/);
  const empty = join(base, "Empty"); await mkdir(join(empty, "sub"), { recursive: true });
  await assert.rejects(readAttachmentFolder(empty), /no files/);
}));
