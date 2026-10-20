import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { root, startHost } from "./host.mjs";
import { parseRecycleInfo, readRecycleInfo, pathExists, removeOwnedItem, shellRestore } from "../tools/system-trash-restore.mjs";

const windows = process.platform === "win32";
const version = bytes => createHash("sha256").update(bytes).digest("hex");
const diskPath = (app, path) => join(app.directory, ...path.split("/"));

async function fixture(t, environment = {}) {
  await mkdir(join(root, ".runtime"), { recursive: true });
  const directory = await mkdtemp(join(root, ".runtime", "system-trash-"));
  await mkdir(join(directory, ".obsidian"));
  const host = await startHost(directory, environment);
  const recycled = [];
  t.after(async () => {
    await host.stop();
    // Only remove the disposable items this test created in the Recycle Bin.
    for (const path of recycled) {
      await rm(path, { force: true, recursive: true });
      await rm(join(dirname(path), "$I" + basename(path).slice(2)), { force: true });
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, recycled, request: (...args) => host.request(...args) };
}

async function put(app, path, content) {
  const destination = diskPath(app, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function info(app, path) {
  const response = await app.request("/api/files/info?" + new URLSearchParams({ root: app.directory, path }));
  assert.equal(response.status, 200);
  return response.json();
}

test("system trash moves exactly the versioned file into the real Recycle Bin and retains neighbours", { skip: !windows }, async t => {
  const app = await fixture(t);
  const bytes = Buffer.from([0, 255, 254, 128, 13, 10, 65]);
  const keep = Buffer.from("Keep me.\r\n");
  await put(app, "Folder/Binary.bin", bytes);
  await put(app, "Keep.md", keep);
  const before = await info(app, "Folder/Binary.bin");
  const response = await app.request("/api/files/system-trash", "POST", { root: app.directory, path: "Folder/Binary.bin", version: before.version });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.path, "Folder/Binary.bin");
  assert.equal(body.snapshot.files.some(file => file.path === "Folder/Binary.bin"), false);
  assert.ok(body.snapshot.folders.includes("Folder"));
  await assert.rejects(stat(diskPath(app, "Folder/Binary.bin")), { code: "ENOENT" });
  await assert.rejects(stat(diskPath(app, ".trash")), { code: "ENOENT" });
  assert.deepEqual(await readFile(diskPath(app, "Keep.md")), keep);
  assert.ok(body.recycledPath, "The shell must report the Recycle Bin item");
  app.recycled.push(body.recycledPath);
  assert.match(body.recycledPath, /\$Recycle\.Bin/i);
  assert.deepEqual(await readFile(body.recycledPath), bytes, "The Recycle Bin item must preserve exact bytes");
  assert.equal((await app.request("/api/files/system-trash", "POST", { root: app.directory, path: "Folder/Binary.bin", version: before.version })).status, 404);
});

test("system trash refuses stale, missing-version, in-use, folder, escaping and linked paths without moving anything", { skip: !windows }, async t => {
  const app = await fixture(t);
  await put(app, "Keep.md", "Original\r\n");
  await mkdir(diskPath(app, "Dir"));
  const before = await info(app, "Keep.md");
  const body = { root: app.directory, path: "Keep.md", version: before.version };
  assert.equal((await app.request("/api/files/system-trash", "POST", { ...body, version: null })).status, 428);
  assert.equal((await app.request("/api/files/system-trash", "POST", { ...body, root: join(app.directory, "other") })).status, 409);
  assert.equal((await app.request("/api/files/system-trash", "POST", { ...body, path: "Dir", version: "x" })).status, 400);
  for (const path of ["../Escape.md", "C:\\Escape.md", ".obsidian/workspace.json", ".trash/Keep.md", "CON.md"]) {
    assert.equal((await app.request("/api/files/system-trash", "POST", { ...body, path })).status, 400, path);
  }
  await put(app, "Keep.md", "Newer external bytes\r\n");
  assert.equal((await app.request("/api/files/system-trash", "POST", body)).status, 409);
  assert.equal(await readFile(diskPath(app, "Keep.md"), "utf8"), "Newer external bytes\r\n");

  const current = await info(app, "Keep.md");
  const writable = await open(diskPath(app, "Keep.md"), "r+");
  try {
    assert.equal((await app.request("/api/files/system-trash", "POST", { ...body, version: current.version })).status, 409);
    assert.equal(await readFile(diskPath(app, "Keep.md"), "utf8"), "Newer external bytes\r\n");
  } finally {
    await writable.close();
  }

  const outside = diskPath(app, ".junction-target");
  await mkdir(outside);
  await writeFile(join(outside, "Keep.md"), "Junction target must survive.\r\n");
  const linked = diskPath(app, "Linked");
  await symlink(outside, linked, "junction");
  try {
    assert.equal((await app.request("/api/files/system-trash", "POST", { ...body, path: "Linked/Keep.md", version: version(Buffer.from("Junction target must survive.\r\n")) })).status, 400);
  } finally {
    await rm(linked);
  }
  assert.equal(await readFile(join(outside, "Keep.md"), "utf8"), "Junction target must survive.\r\n");
  assert.equal(await readFile(diskPath(app, "Keep.md"), "utf8"), "Newer external bytes\r\n");
});

async function waitFor(path) {
  for (let attempt = 0; attempt < 400; attempt++) {
    try { await stat(path); return; } catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  throw new Error("Timed out waiting for " + path);
}

async function raced(t, name, replace) {
  const hold = join(root, ".runtime", "hold-" + process.pid + "-" + name);
  await rm(hold + ".ready", { force: true });
  await rm(hold + ".go", { force: true });
  const app = await fixture(t, { SLOPSIDIAN_TEST_SYSTEM_TRASH_HOLD: hold });
  t.after(() => Promise.all([rm(hold + ".ready", { force: true }), rm(hold + ".go", { force: true })]));
  return { app, hold, release: async () => { await waitFor(hold + ".ready"); await replace(); await writeFile(hold + ".go", "go"); } };
}

test("system trash refuses a file replaced after the version check without moving the foreign bytes", { skip: !windows }, async t => {
  const original = Buffer.from("Checked original\r\n");
  const foreign = Buffer.from("Foreign replacement that must stay\r\n");
  let app;
  const race = await raced(t, "file", async () => {
    await rename(diskPath(app, "Keep.md"), diskPath(app, "Moved-away.md"));
    await put(app, "Keep.md", foreign);
  });
  app = race.app;
  await put(app, "Keep.md", original);
  const before = await info(app, "Keep.md");
  const pending = app.request("/api/files/system-trash", "POST", { root: app.directory, path: "Keep.md", version: before.version });
  await race.release();
  const response = await pending;
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.match(JSON.stringify(body), /no longer the checked file|replaced/i);
  assert.deepEqual(await readFile(diskPath(app, "Keep.md")), foreign, "The foreign file must not be recycled");
  assert.deepEqual(await readFile(diskPath(app, "Moved-away.md")), original);
});

test("system trash moves a whole verified folder as one Recycle Bin item and refuses stale, extra, hidden and root requests", { skip: !windows }, async t => {
  const app = await fixture(t);
  const one = Buffer.from([1, 2, 3, 0, 255]);
  await put(app, "Project/One.bin", one);
  await put(app, "Project/Sub/Two.md", "Two\r\n");
  await mkdir(diskPath(app, "Project/Empty"));
  await put(app, "Keep.md", "Keep\r\n");
  const manifest = async () => [{ path: "Project/One.bin", version: (await info(app, "Project/One.bin")).version }, { path: "Project/Sub/Two.md", version: (await info(app, "Project/Sub/Two.md")).version }];
  const request = async (changes = {}) => app.request("/api/files/folders/system-trash", "POST", { root: app.directory, path: "Project", manifest: await manifest(), ...changes });
  assert.equal((await request({ manifest: null })).status, 428);
  assert.equal((await request({ path: "" })).status, 403);
  assert.equal((await request({ path: "Keep.md" })).status, 400);
  assert.equal((await request({ manifest: [{ path: "Project/One.bin", version: "stale" }, { path: "Project/Sub/Two.md", version: "stale" }] })).status, 409);
  await put(app, "Project/Extra.md", "Added after manifest\r\n");
  assert.equal((await app.request("/api/files/folders/system-trash", "POST", { root: app.directory, path: "Project", manifest: (await manifest()) })).status, 409);
  await rm(diskPath(app, "Project/Extra.md"));
  await put(app, "Project/.hidden", "x");
  assert.equal((await request()).status, 409);
  await rm(diskPath(app, "Project/.hidden"));
  for (const path of ["Project/One.bin", "Project/Sub/Two.md", "Keep.md"]) { await stat(diskPath(app, path)); }

  const response = await request();
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.files, ["Project/One.bin", "Project/Sub/Two.md"]);
  assert.equal(body.snapshot.files.some(file => file.path.startsWith("Project/")), false);
  assert.equal(body.snapshot.folders.some(folder => folder === "Project" || folder.startsWith("Project/")), false);
  await assert.rejects(stat(diskPath(app, "Project")), { code: "ENOENT" });
  await assert.rejects(stat(diskPath(app, ".trash")), { code: "ENOENT" });
  assert.match(body.recycledPath, /\$Recycle\.Bin/i);
  app.recycled.push(body.recycledPath);
  assert.deepEqual(await readFile(join(body.recycledPath, "One.bin")), one);
  assert.equal(await readFile(join(body.recycledPath, "Sub", "Two.md"), "utf8"), "Two\r\n");
  assert.equal(await readFile(diskPath(app, "Keep.md"), "utf8"), "Keep\r\n");
});

test("system trash refuses a folder replaced or extended after verification without recycling the foreign contents", { skip: !windows }, async t => {
  const foreign = Buffer.from("Foreign folder contents\r\n");
  let app;
  const race = await raced(t, "folder", async () => {
    await rename(diskPath(app, "Project"), diskPath(app, "Moved-away"));
    await put(app, "Project/One.md", foreign);
  });
  app = race.app;
  await put(app, "Project/One.md", "Checked\r\n");
  const manifest = [{ path: "Project/One.md", version: (await info(app, "Project/One.md")).version }];
  const pending = app.request("/api/files/folders/system-trash", "POST", { root: app.directory, path: "Project", manifest });
  await race.release();
  const response = await pending;
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.deepEqual(await readFile(diskPath(app, "Project/One.md")), foreign);
  assert.equal(await readFile(diskPath(app, "Moved-away/One.md"), "utf8"), "Checked\r\n");
});

test("recycle metadata parser reads version 1 and 2 sidecars and refuses non-bin paths", () => {
  const original = "C:\\Vault\\Note λ.md", text = Buffer.from(original + "\0", "utf16le");
  const v2 = Buffer.alloc(28 + text.length); v2.writeBigInt64LE(2n, 0); v2.writeBigInt64LE(42n, 8); v2.writeInt32LE(original.length + 1, 24); text.copy(v2, 28);
  assert.deepEqual(parseRecycleInfo(v2), { version: 2, size: 42, originalPath: original });
  const v1 = Buffer.alloc(24 + 520); v1.writeBigInt64LE(1n, 0); v1.writeBigInt64LE(7n, 8); text.copy(v1, 24);
  assert.deepEqual(parseRecycleInfo(v1), { version: 1, size: 7, originalPath: original });
  assert.throws(() => parseRecycleInfo(Buffer.alloc(40)), /Unsupported/);
  return assert.rejects(readRecycleInfo("C:\\Vault\\$Rabc.md"), /Not an exact Recycle Bin item/);
});

test("the exact captured Recycle Bin item restores through the Shell with identical bytes and refuses an occupied destination", { skip: !windows }, async t => {
  const app = await fixture(t);
  const bytes = Buffer.from([0xef, 0xbb, 0xbf, 13, 10, 0, 255, 65]);
  await put(app, "Owned/Restore.bin", bytes);
  const response = await app.request("/api/files/system-trash", "POST", { root: app.directory, path: "Owned/Restore.bin", version: (await info(app, "Owned/Restore.bin")).version });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  app.recycled.push(body.recycledPath);
  const original = diskPath(app, "Owned/Restore.bin");
  assert.equal((await readRecycleInfo(body.recycledPath)).originalPath.toLowerCase(), original.toLowerCase());
  await put(app, "Owned/Restore.bin", "Foreign\r\n");
  await assert.rejects(shellRestore(body.recycledPath, original), /occupied/);
  assert.equal(await readFile(original, "utf8"), "Foreign\r\n");
  assert.deepEqual(await readFile(body.recycledPath), bytes);
  await rm(original);
  assert.equal((await shellRestore(body.recycledPath, original)).method, "shell-undelete");
  assert.deepEqual(await readFile(original), bytes);
  await assert.rejects(stat(body.recycledPath), { code: "ENOENT" });
});

test("restore helper refuses lookalike, traversal and relative item paths before touching anything", async () => {
  const sid = "S-1-5-21-1-2-3-1001";
  for (const path of ["C:\\Temp\\$Recycle.Bin\\x\\$Rabc.md", "C:\\$Recycle.Bin\\" + sid + "\\..\\$Rabc.md", "C:\\$Recycle.Bin\\" + sid + "\\$Rabc.md\\", "C:\\$Recycle.Bin\\$Rabc.md", "C:\\$Recycle.Bin\\" + sid + "\\sub\\$Rabc.md", "C:\\$Recycle.Bin\\" + sid + "\\Rabc.md", "$Recycle.Bin\\" + sid + "\\$Rabc.md", "\\\\server\\share\\$Recycle.Bin\\" + sid + "\\$Rabc.md", "C:\\$Recycle.Bin\\" + sid + "\\$R"]) {
    await assert.rejects(removeOwnedItem(path), /Not an exact Recycle Bin item path/, path);
    await assert.rejects(readRecycleInfo(path), /Not an exact Recycle Bin item path/, path);
  }
});

test("recycle metadata parser rejects truncated, negative, oversized, unterminated and relative fields", () => {
  const make = (version, units, text, size = 5n) => { const body = Buffer.from(text, "utf16le"), b = Buffer.alloc(version === 2 ? 28 + Math.max(units, 0) * 2 : 24 + 520); b.writeBigInt64LE(BigInt(version), 0); b.writeBigInt64LE(size, 8); if (version === 2) { b.writeInt32LE(units, 24); body.copy(b, 28, 0, Math.max(units, 0) * 2); } else { body.copy(b, 24); } return b; };
  const good = "C:\\V\\a.md\0";
  assert.equal(parseRecycleInfo(make(2, good.length, good)).originalPath, "C:\\V\\a.md");
  assert.throws(() => parseRecycleInfo(Buffer.alloc(10)), /truncated/);
  assert.throws(() => parseRecycleInfo(make(2, -5, good)), /invalid path length/);
  assert.throws(() => parseRecycleInfo(make(2, 0, "")), /invalid path length/);
  assert.throws(() => parseRecycleInfo(make(2, good.length, good).subarray(0, 30)), /invalid path length/);
  assert.throws(() => parseRecycleInfo(Buffer.concat([make(2, good.length, good), Buffer.alloc(2)])), /invalid path length/);
  assert.throws(() => parseRecycleInfo(make(2, good.length, good, -1n)), /invalid size/);
  assert.throws(() => parseRecycleInfo(make(2, 9, "C:\\V\\a.md")), /NUL-terminated/);
  assert.throws(() => parseRecycleInfo(make(2, 12, "C:\\V\0a.md\0\0")), /single NUL-terminated/);
  assert.throws(() => parseRecycleInfo(make(2, 8, "rel\\a.md\0".slice(0, 8))), /NUL-terminated|absolute/);
  assert.throws(() => parseRecycleInfo(make(2, 7, "a\\b.md\0")), /absolute/);
  assert.throws(() => parseRecycleInfo(make(1, 0, good).subarray(0, 100)), /invalid length/);
});

test("restore helper treats only ENOENT as absent and surfaces other stat errors", async () => {
  assert.equal(await pathExists(join(root, ".runtime", "definitely-absent-" + process.pid)), false);
  assert.equal(await pathExists(root), true);
  await assert.rejects(pathExists(join(root, "bad\0name")), error => error.code !== "ENOENT");
});

test("an unreadable post-move identity is reported as an unconfirmed 409 naming the bin item, never as success", { skip: !windows }, async t => {
  const app = await fixture(t, { SLOPSIDIAN_TEST_SYSTEM_TRASH_HIDE_IDENTITY: "1" });
  const bytes = Buffer.from([1, 0, 255, 13, 10]);
  await put(app, "Unc/File.bin", bytes);
  await put(app, "Dir/One.md", "One\r\n");
  const response = await app.request("/api/files/system-trash", "POST", { root: app.directory, path: "Unc/File.bin", version: (await info(app, "Unc/File.bin")).version });
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  const named = /'([^']*\$R[^']*)'/.exec(JSON.stringify(body).replace(/\\\\/g, "\\"));
  assert.ok(named, "the message names the recycled item: " + JSON.stringify(body));
  app.recycled.push(named[1]);
  assert.match(JSON.stringify(body), /unconfirmed/i);
  assert.deepEqual(await readFile(named[1]), bytes);
  await assert.rejects(stat(diskPath(app, "Unc/File.bin")), { code: "ENOENT" });
  const folder = await app.request("/api/files/folders/system-trash", "POST", { root: app.directory, path: "Dir", manifest: [{ path: "Dir/One.md", version: (await info(app, "Dir/One.md")).version }] });
  const folderBody = await folder.json();
  assert.equal(folder.status, 409, JSON.stringify(folderBody));
  const folderNamed = /'([^']*\$R[^']*)'/.exec(JSON.stringify(folderBody).replace(/\\\\/g, "\\"));
  assert.ok(folderNamed); app.recycled.push(folderNamed[1]);
  assert.equal(await readFile(join(folderNamed[1], "One.md"), "utf8"), "One\r\n");
});
