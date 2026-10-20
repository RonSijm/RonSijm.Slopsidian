import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, startHost } from "./host.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(root, ".runtime", "core-version-"));
  await mkdir(join(directory, ".obsidian"));
  let host = await startHost(directory);
  t.after(async () => { await host.stop(); await rm(directory, { recursive: true }); });
  const state = async id => (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === id);
  const put = (id, values, version) => host.request(`/api/core/${id}/settings`, "PUT", version === undefined ? { root: directory, values } : { root: directory, values, version });
  return { directory, state, put, restart: async () => { await host.stop(); host = await startHost(directory); } };
}

test("core settings writes require the last-read version, refuse stale or wrong versions and never write unconditionally", async t => {
  const app = await fixture(t), file = join(app.directory, ".obsidian", "templates.json");
  const absent = await app.state("templates");
  assert.equal(absent.settingsVersion, null);
  assert.equal((await app.put("templates", { folder: "One" }, "deadbeef")).status, 409, "a version for an absent file is stale");
  await assert.rejects(readFile(file));
  assert.equal((await app.put("templates", { folder: "One" }, null)).status, 200);
  const first = (await app.state("templates")).settingsVersion;
  assert.match(first, /^[0-9a-f]{64}$/);
  const bytes = await readFile(file);
  assert.equal((await app.put("templates", { folder: "Two" })).status, 428, "an omitted version is refused for an existing file");
  assert.equal((await app.put("templates", { folder: "Two" }, null)).status, 428, "null means absent, not unconditional");
  assert.equal((await app.put("templates", { folder: "Two" }, "0".repeat(64))).status, 409);
  assert.deepEqual(await readFile(file), bytes);
  assert.equal((await app.put("templates", { folder: "Two" }, first)).status, 200);
  const second = (await app.state("templates")).settingsVersion;
  assert.notEqual(second, first);
  assert.equal((await app.put("templates", { folder: "Three" }, first)).status, 409, "the old version is stale after the accepted write");
  assert.equal((await app.state("templates")).settings.folder, "Two");
});

test("an external edit changes the settings version, is detected as a conflict, and unknown data plus BOM survive the next versioned write", async t => {
  const app = await fixture(t), file = join(app.directory, ".obsidian", "templates.json");
  await writeFile(file, "\ufeff" + JSON.stringify({ folder: "Original", future: { keep: [1, 2] } }));
  const loaded = (await app.state("templates")).settingsVersion;
  await writeFile(file, "\ufeff" + JSON.stringify({ folder: "External", future: { keep: [1, 2] }, other: true }));
  const external = await app.state("templates");
  assert.notEqual(external.settingsVersion, loaded);
  assert.equal(external.settings.folder, "External");
  assert.equal((await app.put("templates", { folder: "Mine" }, loaded)).status, 409, "a draft from the old baseline is refused, never rebased");
  assert.equal((await app.put("templates", { folder: "Mine" }, external.settingsVersion)).status, 200);
  const raw = await readFile(file);
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const saved = JSON.parse(raw.subarray(3).toString("utf8"));
  assert.deepEqual(saved, { folder: "Mine", future: { keep: [1, 2] }, other: true });
  await app.restart();
  assert.equal((await app.state("templates")).settings.folder, "Mine");
});

test("invalid values and corrupt or folder-shaped settings fail explicitly without changing disk", async t => {
  const app = await fixture(t), file = join(app.directory, ".obsidian", "templates.json");
  await writeFile(file, JSON.stringify({ folder: "A" }));
  const version = (await app.state("templates")).settingsVersion, before = await readFile(file);
  assert.equal((await app.put("templates", { folder: 5 }, version)).status, 400);
  assert.equal((await app.put("templates", { unknownKey: true }, version)).status, 400);
  assert.deepEqual(await readFile(file), before);
  await writeFile(file, "[1]");
  assert.equal((await app.put("templates", { folder: "B" }, version)).status, 422);
  assert.equal((await readFile(file, "utf8")), "[1]");
});

// Holds a delete-denying handle (FileShare.Read) and, like an external writer, overwrites the file through it mid-backoff.
async function holdAndRewrite(path, rewrite) {
  const script = `$f=[IO.File]::Open('${path.replaceAll("'", "''")}','Open','ReadWrite','Read');[Console]::Out.WriteLine('held');Start-Sleep -Milliseconds 300;$b=[byte[]](${[...rewrite].join(",")});$f.SetLength(0);$f.Write($b,0,$b.Length);$f.Flush();Start-Sleep -Milliseconds 600;$f.Dispose()`;
  const child = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); child.once("exit", reject); });
  const done = new Promise(resolve => child.once("exit", resolve));
  return { done, stop: async () => { child.kill(); await done; } };
}

test("an external edit after the version check but during the replacement backoff is refused with 409 and survives with unknown keys and BOM", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t), file = join(app.directory, ".obsidian", "templates.json");
  await writeFile(file, "\ufeff" + JSON.stringify({ folder: "Original", future: { keep: 1 } }));
  const version = (await app.state("templates")).settingsVersion;
  const external = Buffer.from("\ufeff" + JSON.stringify({ folder: "External", future: { keep: 1 }, added: [2] }));
  const lock = await holdAndRewrite(file, external);
  try {
    const response = await app.put("templates", { folder: "Mine" }, version);
    assert.equal(response.status, 409, await response.clone().text());
    await lock.done;
    assert.deepEqual(await readFile(file), external, "the newer bytes, unknown keys and BOM are intact");
    assert.deepEqual((await readdir(join(app.directory, ".obsidian"))).filter(name => name.endsWith(".tmp")), []);
  } finally { await lock.stop(); }
  const fresh = await app.state("templates");
  assert.notEqual(fresh.settingsVersion, version);
  assert.equal((await app.put("templates", { folder: "Mine" }, fresh.settingsVersion)).status, 200);
  assert.deepEqual(JSON.parse((await readFile(file)).subarray(3).toString("utf8")), { folder: "Mine", future: { keep: 1 }, added: [2] });
});

test("a lock that never clears is an unknown I/O failure (not a 409 conflict) and keeps the original bytes", { skip: process.platform !== "win32" }, async t => {
  const app = await fixture(t), file = join(app.directory, ".obsidian", "templates.json");
  await writeFile(file, JSON.stringify({ folder: "Original" }));
  const version = (await app.state("templates")).settingsVersion, before = await readFile(file);
  const script = `$f=[IO.File]::Open('${file.replaceAll("'", "''")}','Open','Read','Read');[Console]::Out.WriteLine('held');Start-Sleep -Seconds 20`;
  const child = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); child.once("exit", reject); });
  try {
    const response = await app.put("templates", { folder: "Mine" }, version);
    assert.equal(response.status, 500, await response.clone().text());
    assert.doesNotMatch(await response.text(), /retained/);
    assert.deepEqual(await readFile(file), before);
    assert.deepEqual((await readdir(join(app.directory, ".obsidian"))).filter(name => name.endsWith(".tmp")), []);
  } finally { child.kill(); }
});

test("an absent baseline is create-only: a file that appears during the write is never overwritten, and an omitted version means absent only for absent files", async t => {
  const app = await fixture(t), directory = join(app.directory, ".obsidian"), file = join(directory, "templates.json");
  const external = Buffer.from('{"folder":"External","future":true}');
  let refused = 0;
  for (let trial = 0; trial < 40; trial++) {
    await rm(file, { force: true });
    let finished = false, wrote = false;
    const watcher = (async () => {
      while (!finished && !wrote) {
        if ((await readdir(directory)).some(name => name.endsWith(".tmp"))) { await writeFile(file, external, { flag: "wx" }).then(() => { wrote = true; }, () => {}); }
        await new Promise(resolve => setImmediate(resolve));
      }
    })();
    const response = await app.put("templates", { folder: "Mine" }, null);
    finished = true; await watcher;
    const bytes = await readFile(file);
    if (wrote) {
      assert.equal(response.status, 409, await response.clone().text());
      assert.deepEqual(bytes, external, "the externally created file is never overwritten");
      refused++;
    } else {
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(bytes.toString("utf8")).folder, "Mine");
    }
    assert.deepEqual((await readdir(directory)).filter(name => name.endsWith(".tmp")), []);
  }
  assert.ok(refused > 0, "the temp-file barrier forced at least one external creation during the write");

  await rm(file, { force: true });
  assert.equal((await app.put("templates", { folder: "Created" })).status, 200, "an omitted version creates only while the file is absent");
  const created = await readFile(file);
  assert.equal((await app.put("templates", { folder: "Again" })).status, 428, "once the file exists an omitted version is refused");
  assert.equal((await app.put("templates", { folder: "Again" }, null)).status, 428, "an explicit absent baseline is refused too");
  assert.deepEqual(await readFile(file), created);
});
