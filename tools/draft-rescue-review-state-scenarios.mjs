import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { writeDraftRescue } = require("../desktop/draft-rescue.cjs");
const { createProfileStorage } = require("../desktop/local-storage.cjs");
const { KEY } = require("../desktop/draft-rescue-review-state.cjs");
const unrelatedKey = "rescue-review-state-unrelated", unrelatedValue = '{"preserve":[false,0,"λ"]}';

async function fingerprint(profile) {
  const result = [];
  for (const folder of await fs.readdir(join(profile, "draft-rescue"))) {
    for (const file of await fs.readdir(join(profile, "draft-rescue", folder))) {
      const path = join(folder, file); result.push({ path, sha256: createHash("sha256").update(await fs.readFile(join(profile, "draft-rescue", path))).digest("hex") });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
async function addCapture(profile, sourceRoot, name, capturedAt) {
  const result = await writeDraftRescue(profile, { schemaVersion: 1, capturedAt, drafts: [{ sourceRoot, sourcePath: name, sourceVersion: "earlier-version", hasBom: true, content: "# Rescue only\r\nKeep the original source note unchanged. 中文 λ 😀\r\n" }] });
  assert.equal(result.complete, true); return { id: result.directory.split(/[\\/]/).at(-1), manifest: join(result.directory, "manifest.json") };
}
export async function seedRescueReviewState(profile, sourceRoot) {
  const first = await addCapture(profile, sourceRoot, "CRLF note.md", "2026-10-25T14:00:00.000Z");
  const second = await addCapture(profile, sourceRoot, "Welcome.md", "2026-10-25T13:00:00.000Z");
  const storage = createProfileStorage(join(profile, "vault-local-storage.sqlite"));
  try { storage.setItem(unrelatedKey, unrelatedValue); assert.equal(storage.getItem(KEY), null); } finally { storage.close(); }
  return { profile, first, second, before: await fingerprint(profile) };
}

export async function checkRescueReviewState({ directory, seed, evaluate, command, click, press, wait, report, capture, restart, afterReload }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const panel = '[data-draft-rescue-review]', rows = '[data-rescue-folder]';
  let count = 2, expectedFiles = seed.before;
  const originals = new Map(await Promise.all(["CRLF note.md", "Welcome.md", ".obsidian/workspace.json", ".obsidian/core-plugins.json", ".obsidian/community-plugins.json"].map(async path => [path, await fs.readFile(join(directory, path))])));
  const ready = () => wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===${count}&&!document.querySelector("[data-rescue-refresh]").disabled`, "current review preference catalog");
  const catalog = () => evaluate('require("electron").ipcRenderer.invoke("vault:draft-rescue","list")');
  const raw = () => evaluate(`require("electron").ipcRenderer.sendSync("vault:local-storage","get",${JSON.stringify(KEY)}).value`);
  const setRaw = value => evaluate(`(()=>{const result=require("electron").ipcRenderer.sendSync("vault:local-storage","set",${JSON.stringify(KEY)},${JSON.stringify(value)});if(!result.ok)throw new Error(result.error)})()`);
  const unchanged = async () => {
    for (const [path, bytes] of originals) { assert.deepEqual(await fs.readFile(join(directory, path)), bytes, path); }
    assert.deepEqual(await fingerprint(seed.profile), expectedFiles);
    assert.equal(await evaluate(`require("electron").ipcRenderer.sendSync("vault:local-storage","get",${JSON.stringify(unrelatedKey)}).value`), unrelatedValue);
  };
  const openNotice = async () => { await wait('Boolean(document.querySelector("[data-rescue-startup-review]"))', "pending capture startup notice"); await click("[data-rescue-startup-review]"); await ready(); };
  const openCommand = async () => {
    await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open', "review command palette");
    await command("Input.insertText", { text: "Review Markdown rescue copies" }); await click('[data-command-id="app:review-markdown-rescue"]'); await ready();
  };
  const toggle = async (id, reviewed) => {
    await click(`[data-rescue-review-state="${id}"]`);
    await wait(`document.querySelector('[data-rescue-review-state="${id}"]')?.textContent===${JSON.stringify(reviewed ? "Remind me again" : "Mark reviewed")}&&!document.querySelector("[data-rescue-refresh]").disabled`, "persisted review status");
  };
  const quiet = async () => {
    const listed = await catalog(); assert.equal(listed.folders.length, count); assert.ok(listed.folders.every(folder => folder.reviewed));
    await evaluate('new Promise(resolve=>setTimeout(resolve,250))'); assert.equal(await evaluate('Boolean(document.querySelector("[data-rescue-startup-review]"))'), false);
  };
  await openNotice(); assert.equal(await raw(), null);
  await toggle(seed.first.id, true);
  assert.equal(await evaluate('document.activeElement.dataset.rescueReviewState'), seed.first.id);
  assert.equal((await catalog()).folders.find(folder => folder.id === seed.first.id).reviewed, true);
  await capture("reviewed"); await unchanged();
  pass("An explicit Mark reviewed action saves only a profile preference, updates its reversible action/focus and keeps every rescue/source/configuration byte plus unrelated profile data intact.");
  const originalSecond = await fs.readFile(seed.second.manifest), before = await raw();
  await fs.appendFile(seed.second.manifest, "\n"); await click(`[data-rescue-review-state="${seed.second.id}"]`);
  await wait('document.querySelector("[data-rescue-status]").textContent.includes("Cannot save")', "stale capture preference refusal"); assert.equal(await raw(), before);
  await fs.writeFile(seed.second.manifest, originalSecond);
  await setRaw("{"); await click("[data-rescue-refresh]"); await ready();
  assert.equal(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(panel + ' [data-rescue-review-state]')})).every(button=>button.disabled)`), true);
  assert.ok((await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent`)).includes("Saved review status could not be read"));
  await click(`[data-rescue-folder="${seed.first.id}"] summary`); await click(`[data-rescue-folder="${seed.first.id}"] [data-rescue-inspect]`);
  await wait('document.querySelector("[data-rescue-inspection]")?.dataset.rescueInspection==="verified"', "inspection remains available despite bad preferences");
  await press("Escape", "Escape", 27); assert.equal(await raw(), "{");
  await setRaw(before); await click("[data-rescue-refresh]"); await ready(); await unchanged();
  pass("Changed capture metadata refuses a stale review action, and invalid saved preferences disable preference changes while keeping catalog/inspection accessible without resetting the original value.");
  await toggle(seed.second.id, true); await restart(); await afterReload(); await quiet();
  await openCommand(); assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`), 2);
  await capture("quiet-review"); await unchanged();
  pass("A full desktop restart suppresses the startup notice only after both exact captures are reviewed; the actual command palette still opens the complete catalog and all copies remain intact.");
  await toggle(seed.first.id, false); await restart(); await afterReload(); await openNotice();
  assert.equal((await catalog()).folders.find(folder => folder.id === seed.first.id).reviewed, false);
  await toggle(seed.first.id, true);
  const originalFirst = await fs.readFile(seed.first.manifest); await fs.appendFile(seed.first.manifest, "\n");
  await restart(); await afterReload(); await openNotice();
  assert.equal((await catalog()).folders.find(folder => folder.id === seed.first.id).reviewed, false);
  await fs.writeFile(seed.first.manifest, originalFirst); await click("[data-rescue-refresh]"); await ready();
  assert.ok((await catalog()).folders.every(folder => folder.reviewed)); await unchanged();
  pass("Remind me again restores a notice after restart; an externally changed manifest independently restores its reminder while leaving other reviewed captures acknowledged.");
  const third = await addCapture(seed.profile, directory, "New capture.md", "2026-10-25T15:00:00.000Z"); count = 3;
  const originalThird = await fs.readFile(third.manifest); await fs.writeFile(third.manifest, "{");
  await restart(); await afterReload(); await openNotice();
  const unreadable = (await catalog()).folders.find(folder => folder.id === third.id); assert.equal(unreadable.reviewed, false); assert.equal(unreadable.readable, false);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-rescue-review-state="${third.id}"]'))`), false);
  await fs.writeFile(third.manifest, originalThird); expectedFiles = await fingerprint(seed.profile); await click("[data-rescue-refresh]"); await ready();
  assert.equal((await catalog()).folders.find(folder => folder.id === third.id).reviewed, false); await unchanged();
  pass("A new unreadable capture remains a startup reminder and cannot be acknowledged prematurely; restoring its readable metadata makes the explicit review action available without changing older review preferences.");
  await evaluate(`(()=>{const ipc=require("electron").ipcRenderer,original=ipc.invoke;const state=globalThis.rescueReviewDelivery={ready:false};state.restore=()=>{ipc.invoke=original};ipc.invoke=function(channel,...args){const value=original.call(this,channel,...args);return channel==="vault:draft-rescue-review-state"?value.then(result=>new Promise(resolve=>{state.ready=true;state.release=()=>resolve(result)})):value}})()`);
  await click(`[data-rescue-review-state="${third.id}"]`); await wait('rescueReviewDelivery.ready', "real native review saved before held renderer delivery");
  await restart(); await afterReload(); await quiet(); await openCommand(); await unchanged();
  const finalState = await raw(); assert.equal(JSON.parse(finalState).folders.length, 3);
  report.rescueReviewState = { profile: seed.profile, key: KEY, expectedState: finalState, retainedFiles: expectedFiles, originalFolders: [seed.first.id, seed.second.id], addedFolder: third.id, unrelatedKey, unrelatedValue, restarts: 5,
    scope: "Explicit manifest-specific preference; no copy/source writes. Stale/corrupt metadata and preferences are external fixtures restored afterward. The final fixture holds delivery after the real native write has completed; accepted native queue draining also has focused coverage. No automatic content watching, restore, deletion, authentication or WASM preference." };
  pass("Closing with a fixture-held delivery of an already saved native review persists through another normal restart; all three reviewed folders stay accessible, the startup stays quiet and every copy/source byte is retained.");
}
