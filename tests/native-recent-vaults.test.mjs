import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createProfileStorage } = require("../desktop/local-storage.cjs");
const { createNativeRecentVaults, handleNativeRecentRequest, identityOf, KEY } = require("../desktop/native-recent-vaults.cjs");

async function fixture(body) {
  const base = await mkdtemp(join(tmpdir(), "slopsidian-recents-"));
  const databases = [];
  const open = () => { const store = createProfileStorage(join(base, "profile.sqlite")); databases.push(store); return store; };
  try { await body(base, open); } finally { for (const store of databases) { try { store.close(); } catch { /* closed by the test */ } } await rm(base, { recursive: true, force: true }); }
}
const vault = async (base, name) => { const directory = join(base, name); await mkdir(join(directory, ".obsidian"), { recursive: true }); return directory; };

test("confirmed opens are ordered most-recent-first and reopening moves a vault to the front", () => fixture(async (base, open) => {
  const [a, b, c] = [await vault(base, "A"), await vault(base, "B"), await vault(base, "C")];
  const recents = createNativeRecentVaults(open(), () => 1000);
  for (const directory of [a, b, c, a]) { recents.remember(directory); }
  assert.deepEqual(recents.list().map(entry => entry.name), ["A", "C", "B"]);
}));

test("Windows path spellings of one vault collapse to a single latest-spelled entry", { skip: process.platform !== "win32" }, () => fixture(async (base, open) => {
  const directory = await vault(base, "Notes");
  const recents = createNativeRecentVaults(open());
  recents.remember(directory.toUpperCase());
  recents.remember(directory + "\\");
  recents.remember(join(directory, "..", "Notes"));
  assert.equal(recents.list().length, 1);
}));

test("history survives closing and reopening the profile database and has no arbitrary cap", () => fixture(async (base, open) => {
  const first = open(), directories = [];
  const recents = createNativeRecentVaults(first);
  for (let index = 0; index < 60; index++) { const directory = await vault(base, "Vault" + index); directories.push(directory); recents.remember(directory); }
  first.close();
  const restarted = createNativeRecentVaults(open());
  assert.deepEqual(restarted.list().map(entry => entry.path), directories.toReversed());
}));

test("unavailable, relative, file and malformed requests are refused without changing history or creating folders", () => fixture(async (base, open) => {
  const store = open(), recents = createNativeRecentVaults(store);
  const good = await vault(base, "Good");
  recents.remember(good);
  const before = store.getItem(KEY);
  const missing = join(base, "Missing");
  const file = join(base, "note.md");
  await writeFile(file, "x");
  for (const bad of [missing, file, "relative", "", undefined, 7]) { assert.throws(() => recents.remember(bad)); }
  assert.equal(store.getItem(KEY), before);
  await assert.rejects(readFile(join(missing, "x")), { code: "ENOENT" });
  assert.throws(() => handleNativeRecentRequest(recents, "delete", good), /Unknown native recent/);
  assert.throws(() => handleNativeRecentRequest(recents, "list", good), /Unknown native recent/);
}));

test("a listed vault that later disappears stays listed and remembering it fails explicitly", () => fixture(async (base, open) => {
  const store = open(), recents = createNativeRecentVaults(store);
  const gone = await vault(base, "Gone");
  recents.remember(gone);
  await rm(gone, { recursive: true });
  assert.deepEqual(recents.list().map(entry => entry.path), [gone]);
  assert.throws(() => recents.remember(gone), /existing vault directory/);
  assert.equal(recents.list().length, 1);
}));

test("a large uncapped stored inventory is handled without argument-limit failures", () => fixture(async (base, open) => {
  const store = open(), directory = await vault(base, "Newest");
  const vaults = Array.from({ length: 150000 }, (_, index) => ({ path: join(base, "absent", "v" + index), openedAt: index }));
  store.setItem(KEY, JSON.stringify({ version: 1, vaults }));
  const recents = createNativeRecentVaults(store, () => 5);
  recents.remember(directory);
  const list = recents.list();
  assert.equal(list.length, 150001);
  assert.equal(list[0].path, directory);
}));

test("only ENOENT/ENOTDIR fall back to lexical identity; other filesystem errors surface", () => {
  const fail = code => () => { throw Object.assign(new Error(code), { code }); };
  const target = join(tmpdir(), "slopsidian-identity");
  assert.equal(typeof identityOf(target, fail("ENOENT")), "string");
  assert.equal(typeof identityOf(target, fail("ENOTDIR")), "string");
  for (const code of ["EACCES", "EPERM", "EIO", "ELOOP"]) { assert.throws(() => identityOf(target, fail(code)), { code }); }
});

test("the client confirmation fence refuses stale, root-switched and empty selections", async () => {
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: [new URL("../client/native-recents.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], bundle: true, write: false, format: "esm", platform: "node" });
  const { confirmedNativeRoot } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
  assert.equal(confirmedNativeRoot("D:\\A", "D:\\A"), "D:\\A");
  assert.throws(() => confirmedNativeRoot("D:\\B", "D:\\A"), /changed before/);
  assert.throws(() => confirmedNativeRoot(null, "D:\\A"), /changed before/);
  assert.throws(() => confirmedNativeRoot("D:\\A", ""), /confirmed vault path/);
});

test("the chooser shows native recents only in the native branch and the bridge refuses browser hosts", async () => {
  const razor = await readFile(new URL("../src/RonSijm.Slopsidian/Components/Pages/Home.razor", import.meta.url), "utf8");
  const browserBranch = razor.indexOf('id="browser-open-vault"'), nativeBranch = razor.indexOf('id="native-recent-vaults"');
  assert.ok(browserBranch > 0 && nativeBranch > browserBranch, "native recents must follow the browser branch");
  assert.ok(razor.indexOf("else", browserBranch) < nativeBranch && !razor.slice(browserBranch, nativeBranch).includes("</dialog>"));
  const host = await readFile(new URL("../client/editor-host.ts", import.meta.url), "utf8");
  assert.match(host, /if \(getBrowserHost\(\) \|\| typeof require !== "function"\)\s*{\s*throw new Error\("Native recent vaults require the Electron desktop host\."\)/);
});

test("damaged profile data is reported and left unchanged, and remembering never writes into the vault", () => fixture(async (base, open) => {
  const store = open(), recents = createNativeRecentVaults(store);
  const directory = await vault(base, "Vault");
  const note = join(directory, "Note.md"), config = join(directory, ".obsidian", "app.json");
  await writeFile(note, "\uFEFFa\r\nb"); await writeFile(config, "{\"a\":1}");
  store.setItem(KEY, "{not json");
  assert.throws(() => recents.list(), /not valid JSON/);
  assert.throws(() => recents.remember(directory), /not valid JSON/);
  assert.equal(store.getItem(KEY), "{not json");
  store.setItem(KEY, JSON.stringify({ version: 1, vaults: [] }));
  recents.remember(directory);
  assert.deepEqual(await readFile(note), Buffer.from("\uFEFFa\r\nb"));
  assert.equal(await readFile(config, "utf8"), "{\"a\":1}");
}));
