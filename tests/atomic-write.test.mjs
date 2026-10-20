import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { root, startHost } from "./host.mjs";

const version = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  await mkdir(join(root, ".runtime"), { recursive: true });
  const directory = await mkdtemp(join(root, ".runtime", "atomic-"));
  await mkdir(join(directory, ".obsidian"));
  const host = await startHost(directory);
  t.after(async () => { await host.stop(); await rm(directory, { recursive: true, force: true }); });
  return { directory, request: (...args) => host.request(...args) };
}

// Holds an exclusive-delete-denying handle (FileShare.Read) like a scanner or indexer would.
// With `rewrite`, the holder (opened for ReadWrite, sharing Read) overwrites the file 300 ms after signalling, like an external writer.
async function hold(path, milliseconds, rewrite) {
  const write = rewrite ? `Start-Sleep -Milliseconds 300;$b=[byte[]](${[...rewrite].join(",")});$f.SetLength(0);$f.Write($b,0,$b.Length);$f.Flush();` : "";
  const script = `$f=[IO.File]::Open('${path.replaceAll("'", "''")}','Open','${rewrite ? "ReadWrite" : "Read"}','Read');[Console]::Out.WriteLine('held');${write}Start-Sleep -Milliseconds ${milliseconds};$f.Dispose()`;
  const child = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); child.once("exit", reject); });
  const done = new Promise(resolve => child.once("exit", resolve));
  return { done, stop: async () => { child.kill(); await done; } };
}

const original = Buffer.from("\ufeffline1\r\nline2\r\n", "utf8");
const replacement = Buffer.from([0xef, 0xbb, 0xbf, 0x31, 0x0d, 0x0a, 0x00, 0xff]);
const put = (app, bytes, expected, signal) => app.request("/api/binary", "PUT", { root: app.directory, path: "doc.bin", base64: bytes.toString("base64"), version: version(expected) }, signal);
const leftovers = async directory => (await readdir(directory)).filter(name => name.endsWith(".tmp"));

test("a transient sharing lock delays the replace, which then succeeds with exact bytes and no temp file", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t);
  const path = join(app.directory, "doc.bin");
  await writeFile(path, original);
  const lock = await hold(path, 1200);
  const started = Date.now();
  const response = await put(app, replacement, original);
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(Date.now() - started >= 300, "the write waited for the lock");
  await lock.done;
  assert.deepEqual(await readFile(path), replacement);
  assert.deepEqual(await leftovers(app.directory), []);
  await writeFile(path, original);
  assert.deepEqual(await readFile(path), original, "the sharing handle was released");
});

test("a lock that never clears fails explicitly, keeps the original bytes and retains no temp file", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t);
  const path = join(app.directory, "doc.bin");
  await writeFile(path, original);
  const lock = await hold(path, 15000);
  try {
    const response = await put(app, replacement, original);
    assert.equal(response.status, 500);
    assert.deepEqual(await readFile(path), original);
    assert.deepEqual(await leftovers(app.directory), []);
  } finally { await lock.stop(); }
});

test("an external write during the backoff survives even after the lock is released", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t);
  const path = join(app.directory, "doc.bin");
  const external = Buffer.from("changed by another application\r\n");
  await writeFile(path, original);
  const lock = await hold(path, 1000, external);
  try {
    const response = await put(app, replacement, original);
    assert.equal(response.status, 500);
    await lock.done;
    assert.deepEqual(await readFile(path), external);
    assert.deepEqual(await leftovers(app.directory), []);
  } finally { await lock.stop(); }
});

test("rollback keeps a foreign same-bytes file that replaced our created resource while a later replace was retrying", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t);
  const folder = join(app.directory, ".obsidian", "themes", "Own");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), newPng = Buffer.concat([png, Buffer.from([2])]), woff2 = Buffer.from("wOF2-first-font");
  const css = Buffer.from("@font-face{src:url(fonts/a.woff2)}body{background:url(img/b.png)}"), manifest = Buffer.from('{"name":"Own"}');
  await mkdir(join(folder, "img"), { recursive: true });
  await writeFile(join(folder, "img", "b.png"), png);
  const first = join(folder, "fonts", "a.woff2"), second = join(folder, "img", "b.png");
  const lock = await hold(second, 20000);
  try {
    const pending = app.request("/api/appearance/theme", "PUT", {
      root: app.directory, name: "Own", cssBase64: css.toString("base64"), manifestBase64: manifest.toString("base64"), expectedVersion: null, expectedManifestVersion: null,
      resources: [{ path: "fonts/a.woff2", base64: woff2.toString("base64"), expectedVersion: null }, { path: "img/b.png", base64: newPng.toString("base64"), expectedVersion: version(png) }],
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      try { await readFile(first); break; }
      catch (error) {
        if (error.code !== "ENOENT") { throw error; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    assert.deepEqual(await readFile(first), woff2, "our first resource was created");
    const createdId = (await stat(first, { bigint: true })).ino;
    await rename(first, first + ".ours");
    await writeFile(first, woff2);
    const foreignId = (await stat(first, { bigint: true })).ino;
    assert.notEqual(foreignId, createdId, "the same-byte replacement is a different file");
    const response = await pending;
    const text = await response.text();
    assert.equal(response.status, 500, text);
    assert.match(text, /Rollback is incomplete/);
    assert.match(text, /a\.woff2 \(A newer file occupies a path this install created; it was retained\.\)/);
    assert.deepEqual(await readFile(first), woff2, "the foreign file is retained");
    assert.equal((await stat(first, { bigint: true })).ino, foreignId, "the foreign file identity is retained");
    assert.deepEqual(await readFile(second), png, "the locked file is unchanged");
    assert.deepEqual(await leftovers(join(folder, "img")), []);
  } finally { await lock.stop(); }
});

test("cancelling while a lock is held leaves the old bytes and no temp file, and releases the host", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t);
  const path = join(app.directory, "doc.bin");
  await writeFile(path, original);
  const lock = await hold(path, 15000);
  try {
    const controller = new AbortController();
    const pending = put(app, replacement, original, controller.signal);
    setTimeout(() => controller.abort(), 500);
    await assert.rejects(pending, /abort/i);
    for (let attempt = 0; attempt < 40 && (await leftovers(app.directory)).length; attempt++) { await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.deepEqual(await leftovers(app.directory), []);
    assert.deepEqual(await readFile(path), original);
  } finally { await lock.stop(); }
  assert.equal((await put(app, replacement, original)).status, 200);
  assert.deepEqual(await readFile(path), replacement);
});

test("a destination below a junction is refused and the junction target is untouched", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t);
  const outside = await mkdtemp(join(root, ".runtime", "atomic-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "doc.bin"), original);
  await symlink(outside, join(app.directory, "linked"), "junction");
  const response = await app.request("/api/binary", "PUT", { root: app.directory, path: "linked/doc.bin", base64: replacement.toString("base64"), version: version(original) });
  assert.ok(response.status >= 400);
  assert.deepEqual(await readFile(join(outside, "doc.bin")), original);
  assert.deepEqual(await leftovers(outside), []);
});
