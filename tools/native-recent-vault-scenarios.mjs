import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

/**
 * Native recent-vault scenarios for the desktop smoke runner. Wiring (owned by the integrator):
 *   await checkNativeRecentVaults({ directory: vault, workspace, evaluate, click, fillInput, wait, report, restart, afterReload });
 * `workspace` is a disposable empty directory under .runtime; `restart` must fully restart Electron and the .NET host
 * with the SAME smoke profile (not clear it); `afterReload` waits for desktop readiness.
 */
export async function checkNativeRecentVaults({ directory, workspace, evaluate, click, fillInput, wait, report, restart, afterReload }) {
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const bytes = async root => {
    const out = new Map();
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) { const file = join(entry.parentPath, entry.name); out.set(file, createHash("sha256").update(await readFile(file)).digest("hex")); }
    }
    return out;
  };
  const vaults = {};
  for (const name of ["Recent Alpha", "Recent Beta", "Recent Gamma"]) {
    vaults[name] = join(workspace, name);
    await mkdir(join(vaults[name], ".obsidian"), { recursive: true });
    await writeFile(join(vaults[name], "Note.md"), "\uFEFF# " + name + "\r\nexact bytes\r\n");
    await writeFile(join(vaults[name], ".obsidian", "app.json"), "{\"legacyEditor\":false}");
  }
  const before = new Map([...await bytes(vaults["Recent Alpha"]), ...await bytes(vaults["Recent Beta"]), ...await bytes(vaults["Recent Gamma"])]);
  const rootNow = () => evaluate("app.vault.rootPath");
  const openChooser = async () => {
    await click("#open-vault");
    await wait('document.querySelector("#vault-dialog").open&&!document.querySelector("#vault-dialog [disabled][data-native-recent-vault]")', "native vault chooser");
  };
  const recents = () => evaluate('[...document.querySelectorAll("[data-native-recent-vault]")].map(button=>button.dataset.nativeRecentVault)');
  const openByPath = async path => {
    await openChooser();
    await fillInput("#vault-open-path", path);
    await click("#confirm-open-vault");
    await wait(`typeof app.vault.rootPath==="string"&&app.vault.rootPath.toLowerCase()===${JSON.stringify(resolve(path).toLowerCase())}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "vault opened by path");
  };
  const error = () => evaluate('document.querySelector("#vault-dialog-error")?.textContent??null');

  await openByPath(vaults["Recent Alpha"]);
  await openByPath(vaults["Recent Beta"]);
  await openChooser();
  assert.deepEqual(await recents(), [vaults["Recent Beta"], vaults["Recent Alpha"]]);
  pass("Confirmed native opens appear most-recent-first in the Recent vaults list.");

  // A failed open keeps current vault and history.
  const missing = join(workspace, "Missing Vault");
  await fillInput("#vault-open-path", missing);
  await expectErrors({ evaluate, report }, [{ source: "host", message: "The selected folder does not exist." }], async () => {
    await click("#confirm-open-vault");
    await wait('Boolean(document.querySelector("#vault-dialog-error"))', "unavailable directory error");
  }, "The deliberately unavailable recent-vault fixture refuses without creating a directory or changing history");
  assert.match(await error(), /does not exist/);
  assert.equal(await rootNow(), vaults["Recent Beta"]);
  assert.deepEqual(await recents(), [vaults["Recent Beta"], vaults["Recent Alpha"]]);
  await assert.rejects(stat(missing), { code: "ENOENT" });
  pass("An unavailable directory fails through the chooser error, creates nothing, keeps the current vault and does not change history.");

  // Cancelling (Back to vault) keeps history and the vault.
  await click("#cancel-vault-selection");
  await wait('!document.querySelector("#vault-dialog").open', "chooser cancelled");
  await openChooser();
  assert.deepEqual(await recents(), [vaults["Recent Beta"], vaults["Recent Alpha"]]);
  assert.equal(await rootNow(), vaults["Recent Beta"]);
  pass("Cancelling the chooser leaves vault and history unchanged.");

  // Selecting a recent entry reopens it and moves it to the front; spelling variants dedupe.
  await click(`[data-native-recent-vault=${JSON.stringify(vaults["Recent Alpha"])}]`);
  await wait(`app.vault.rootPath===${JSON.stringify(vaults["Recent Alpha"])}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "recent vault selected");
  await openByPath(vaults["Recent Beta"].toUpperCase().replace(/\\$/, "") + "\\");
  await openChooser();
  const afterSpelling = await recents();
  assert.equal(afterSpelling.length, 2, "Upper-case and trailing-separator spellings must not add duplicates.");
  pass("Selecting a recent entry reopens it through the guarded switch, and Windows spelling variants stay one entry.");

  // Create adds the new vault.
  await fillInput("#new-vault-name", "Recent Gamma Created");
  await fillInput("#new-vault-location", workspace);
  await click("#confirm-create-vault");
  const created = join(workspace, "Recent Gamma Created");
  await wait(`app.vault.rootPath===${JSON.stringify(created)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "vault created");
  await openChooser();
  assert.equal((await recents())[0], created);
  pass("A confirmed vault creation is remembered at the front.");
  const expectedOrder = await recents();

  // Full native process restart keeps the profile list; startup remains a chooser and opens nothing by itself.
  await click("#cancel-vault-selection");
  await restart();
  await afterReload();
  await openChooser();
  assert.deepEqual(await recents(), expectedOrder);
  pass("A full Electron and .NET restart keeps the recent vault order from the application profile.");

  const persisted = await evaluate('JSON.stringify(Object.entries(localStorage).filter(([key])=>key.includes("native-recent")))');
  assert.equal(persisted, "[]", "History must live in the desktop profile, not renderer storage.");
  const after = new Map([...await bytes(vaults["Recent Alpha"]), ...await bytes(vaults["Recent Beta"]), ...await bytes(vaults["Recent Gamma"])]);
  for (const [file, hash] of before) { assert.equal(after.get(file), hash, "Recent-vault history must not change original note/config bytes: " + file); }
  // Normal guarded switching may legitimately write its own workspace/prefs; only MRU state is forbidden.
  for (const file of after.keys()) {
    const text = (await readFile(file)).toString("latin1");
    assert.ok(!text.includes("native-recent-vaults") && !text.includes("slopsidian:native-recent"), "No MRU state may be stored in the vault: " + file);
  }
  pass("History is stored in the profile only; original fixture note/config bytes are unchanged and no vault file holds MRU state.");
  void directory;
}

/** WASM/browser hosts must expose browser recents only; call with the web smoke's page helpers. */
export async function checkNoNativeRecentsInBrowser({ evaluate, click, wait, report }) {
  await click("#open-vault");
  await wait('document.querySelector("#vault-dialog").open', "browser vault chooser");
  assert.equal(await evaluate('document.querySelectorAll("[data-native-recent-vault],#native-recent-vaults,#vault-open-path").length'), 0);
  report.checks.push("The WASM chooser has no native recent-vault list or native path form.");
  console.log("PASS The WASM chooser has no native recent-vault list or native path form.");
}
