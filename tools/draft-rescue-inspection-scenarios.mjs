import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { seedDraftRescueReview } from "./draft-rescue-review-scenarios.mjs";
const require = createRequire(import.meta.url);
const { writeDraftRescue } = require("../desktop/draft-rescue.cjs");

async function fingerprint(directory) {
  const files = [];
  async function walk(path) {
    for (const item of await fs.readdir(path, { withFileTypes: true })) {
      const file = join(path, item.name);
      if (item.isSymbolicLink()) { files.push({ path: relative(directory, file), link: await fs.readlink(file) }); }
      else if (item.isDirectory()) { await walk(file); }
      else { files.push({ path: relative(directory, file), sha256: createHash("sha256").update(await fs.readFile(file)).digest("hex") }); }
    }
  }
  await walk(directory); return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function seedDraftRescueInspection(profile, sourceRoot) {
  const seed = await seedDraftRescueReview(profile, sourceRoot);
  const literal = '# Rescued only\r\n\r\n<img src=x onerror=globalThis.rescueInspectionInjected=1>\r\n<script>globalThis.rescueInspectionInjected=2</script>\r\n中文 λ e\u0301 😀\r\n';
  const contents = [literal, "Expected original\n", "Missing original\n", "Partial copy\n", "a".repeat(65535) + "😀中文" + "z".repeat(200), "Valid original\n", "Linked original\n"];
  const names = ["Verified 中文.md", "Changed.md", "Missing.md", "Partial.md", "Long preview.md", "Invalid UTF8.md", "Linked.md"];
  const result = await writeDraftRescue(profile, { schemaVersion: 1, capturedAt: "2026-10-25T14:00:00.000Z", drafts: names.map((sourcePath, index) => ({ sourceRoot, sourcePath, sourceVersion: "inspection-original-version", hasBom: index === 0, content: contents[index] })) }, {
    ...fs, async open(path, ...args) {
      const handle = await fs.open(path, ...args);
      if (!path.endsWith("004-Partial.md")) { return handle; }
      return { async writeFile(bytes) { await handle.writeFile(bytes.subarray(0, 4)); throw new Error("Fixture interrupted file write"); }, sync: () => handle.sync(), close: () => handle.close() };
    },
  });
  const manifestPath = join(result.directory, "manifest.json"), manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const files = manifest.drafts.map(copy => copy.file);
  const checkedPath = file => { const path = join(result.directory, file), child = relative(seed.base, path); assert.ok(child && !child.startsWith("..") && !isAbsolute(child)); return path; };
  await fs.writeFile(checkedPath(files[1]), "Externally changed text λ\n");
  await fs.unlink(checkedPath(files[2]));
  await fs.writeFile(checkedPath(files[5]), Buffer.from([255, 0, 128]));
  await fs.unlink(checkedPath(files[6])); await fs.symlink(join(profile, "linked-copy-must-not-be-read"), checkedPath(files[6]), "junction");
  return { ...seed, inspectionId: result.directory.split(/[\\/]/).at(-1), manifestPath, files, literal, beforeInspection: await fingerprint(seed.base) };
}

export async function checkDraftRescueInspection({ directory, seed, evaluate, command, click, press, wait, report, capture, restart, afterReload }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const parent = '[data-draft-rescue-review]', child = '[data-rescue-inspection]', section = `[data-rescue-folder="${seed.inspectionId}"]`;
  const originals = new Map(await Promise.all(["CRLF note.md", "Welcome.md", ".obsidian/workspace.json", ".obsidian/core-plugins.json", ".obsidian/community-plugins.json"].map(async path => [path, await fs.readFile(join(directory, path))])));
  let expectedFiles = seed.beforeInspection;
  const unchanged = async () => { for (const [path, bytes] of originals) { assert.deepEqual(await fs.readFile(join(directory, path)), bytes, path); } assert.deepEqual(await fingerprint(seed.base), expectedFiles); };
  const openReview = async () => {
    await wait('Boolean(document.querySelector("[data-rescue-startup-review]"))', "retained-copy notice");
    await click("[data-rescue-startup-review]");
    await wait('document.querySelectorAll("[data-rescue-folder]").length===4&&!document.querySelector("[data-rescue-refresh]").disabled', "inspection catalog");
    await click(section + " summary");
    await wait(`document.querySelector(${JSON.stringify(section + ' [data-rescue-inspect]')})!==null`, "copy inspection controls");
  };
  const inspect = async (index, state) => {
    await click(section + ` [data-rescue-inspect="${seed.files[index]}"]`);
    await wait(`document.querySelector(${JSON.stringify(child)})?.dataset.rescueInspection===${JSON.stringify(state)}`, "inspection " + state);
  };
  const closeChild = async () => { await press("Escape", "Escape", 27); await wait(`!document.querySelector(${JSON.stringify(child)})`, "inspection closed"); assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(parent)}))`), true); };
  await openReview(); await inspect(0, "verified");
  assert.equal(await evaluate('document.querySelector(".rescue-copy-preview").textContent'), seed.literal);
  assert.equal(await evaluate('globalThis.rescueInspectionInjected'), undefined);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(child)}).querySelectorAll("img,script,iframe").length`), 0);
  await click(child + " summary");
  assert.ok((await evaluate(`document.querySelector(${JSON.stringify(child)}).textContent`)).includes("UTF-8 BOM expected: present; read: present"));
  await capture("verified"); await closeChild();
  assert.equal(await evaluate('document.activeElement.dataset.rescueInspect'), seed.files[0]); await unchanged();
  pass("A real Inspect copy action verifies the recorded BOM/size/hash, renders exact CRLF/Unicode/HTML-looking text literally, and restores focus to its parent action on Escape without changing files.");
  for (const [index, state, text] of [[1, "changed", "Externally changed text λ\n"], [2, "missing", null], [3, "incomplete", "Part"], [5, "unavailable", null], [6, "unavailable", null]]) {
    await inspect(index, state);
    assert.equal(await evaluate('document.querySelector(".rescue-copy-preview")?.textContent??null'), text);
    await closeChild();
  }
  await unchanged();
  pass("Actual changed, missing, partial, invalid-UTF-8 and linked files show distinct inspection states; unsafe/unreadable copies expose no preview and original notes/copies stay byte-exact.");
  await inspect(4, "verified");
  assert.equal(await evaluate('document.querySelector(".rescue-copy-preview").textContent'), "a".repeat(65535));
  assert.ok((await evaluate(`document.querySelector(${JSON.stringify(child)}).textContent`)).includes("64 KiB limit"));
  const viewport = await evaluate('({width:innerWidth,height:innerHeight})');
  await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: false });
  await click(".rescue-copy-preview");
  assert.equal(await evaluate('document.activeElement.className'), "rescue-copy-preview");
  const geometry = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(child + ' .modal')}).getBoundingClientRect();return{left:r.left,right:r.right,height:r.height,width:innerWidth,viewport:innerHeight}})()`);
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.height <= geometry.viewport, JSON.stringify(geometry));
  await capture("long-narrow");
  await command("Emulation.clearDeviceMetricsOverride"); await wait(`innerWidth===${viewport.width}&&innerHeight===${viewport.height}`, "original inspection viewport");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await closeChild();
  pass("The bounded preview ends before a split Unicode character, labels truncation and remains keyboard reachable inside a 320×568 CSS viewport while full-file verification still succeeds.");
  const originalManifest = await fs.readFile(seed.manifestPath);
  await fs.appendFile(seed.manifestPath, "\n");
  await inspect(0, "error");
  assert.ok((await evaluate(`document.querySelector(${JSON.stringify(child)}).textContent`)).includes("information changed"));
  assert.equal(await evaluate('Boolean(document.querySelector(".rescue-copy-preview"))'), false); await closeChild();
  await click("[data-rescue-refresh]"); await wait('!document.querySelector("[data-rescue-refresh]").disabled', "fresh manifest identity");
  await click(section + " summary"); await inspect(0, "verified"); await closeChild();
  await fs.writeFile(seed.manifestPath, originalManifest); expectedFiles = seed.beforeInspection;
  await click("[data-rescue-refresh]"); await wait('!document.querySelector("[data-rescue-refresh]").disabled', "restored fixture manifest"); await click(section + " summary");
  await unchanged();
  pass("An external manifest revision invalidates an already displayed copy action and exposes no stale text; refreshing recovers through the real UI, with the fixture's original metadata restored afterward.");
  await evaluate(`(()=>{
    const ipc=require("electron").ipcRenderer,original=ipc.invoke;
    const state=globalThis.rescueInspectionDelivery={ready:false};
    state.restore=()=>{ipc.invoke=original};
    ipc.invoke=function(channel,operation,...args){
      const value=original.call(this,channel,operation,...args);
      return channel==="vault:draft-rescue"&&operation==="inspect"?value.then(result=>new Promise(resolve=>{state.ready=true;state.release=()=>resolve(result)})):value;
    };
  })()`);
  await click(section + ` [data-rescue-inspect="${seed.files[0]}"]`);
  await wait('globalThis.rescueInspectionDelivery.ready', "real result held after native inspection");
  await closeChild();
  await evaluate('rescueInspectionDelivery.restore();rescueInspectionDelivery.release();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(child)}))`), false); await unchanged();
  pass("Closing a pending inspection ignores a fixture-held delivery of the real native result; no dialog or preview reappears and the review panel stays usable.");
  await inspect(0, "verified"); await restart(); await afterReload();
  await openReview(); await inspect(0, "verified");
  assert.equal(await evaluate('document.querySelector(".rescue-copy-preview").textContent'), seed.literal); await closeChild(); await unchanged();
  report.draftRescueInspection = { profile: seed.profile, folderId: seed.inspectionId, files: seed.files, literal: seed.literal, retainedFiles: expectedFiles, actualInspectionStates: ["verified", "changed", "missing", "incomplete", "unavailable", "error"], previewBytes: 65536, fullRestart: true,
    scope: "Explicit read-only profile-copy inspection and literal preview. CSS viewport emulation and a fixture-held real native result are bounded checks. No restoration, source-note reads, deletion, acknowledgement, authenticated archive, OS/renderer crash durability or WASM inspection." };
  pass("A full normal desktop restart with both review dialogs open closes transient state, preserves every retained/source/configuration byte and verifies the same copy again after startup discovery.");
}
