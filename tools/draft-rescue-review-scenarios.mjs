import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
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

export async function seedDraftRescueReview(profile, sourceRoot) {
  const base = join(profile, "draft-rescue"), sourcePath = "Draft <img src=x onerror=globalThis.rescueReviewInjected=1>.md";
  const draft = (path = "CRLF note.md", root = sourceRoot) => ({ sourceRoot: root, sourcePath: path, sourceVersion: "earlier-session-version", hasBom: true, content: "# Rescued only\r\nThis must never replace the saved note. 中文 λ 😀\r\n" });
  const complete = await writeDraftRescue(profile, { schemaVersion: 1, capturedAt: "2026-10-25T11:00:00.000Z", drafts: [draft(), draft(sourcePath)] });
  const partial = await writeDraftRescue(profile, { schemaVersion: 1, capturedAt: "2026-10-25T12:00:00.000Z", drafts: [draft("Missing.md", "D:\\Earlier unavailable vault")] }, {
    ...fs, async open(path, ...args) { if (path.endsWith(".md")) { throw new Error("Fixture interrupted copy"); } return fs.open(path, ...args); },
  });
  assert.equal(complete.complete, true); assert.equal(partial.complete, false);
  const unreadable = "rescue-20261024100000-broken";
  await fs.mkdir(join(base, unreadable)); await fs.writeFile(join(base, unreadable, "manifest.json"), "{incomplete manifest");
  const outside = join(profile, "linked-copy-must-not-be-read"); await fs.mkdir(outside);
  await fs.writeFile(join(outside, "Keep.bin"), Buffer.from([255, 0, 128]));
  const linked = "rescue-20261025130000-linked"; await fs.symlink(outside, join(base, linked), "junction");
  await fs.mkdir(join(base, "unrelated-keep")); await fs.writeFile(join(base, "unrelated-keep", "Keep.txt"), "Keep unrelated data.\n");
  return { profile, base, sourcePath, completeId: complete.directory.split(/[\\/]/).at(-1), partialId: partial.directory.split(/[\\/]/).at(-1), unreadable, linked, before: await fingerprint(base) };
}

export async function checkDraftRescueReview({ directory, seed, evaluate, command, click, press, wait, report, capture, readReveals, restart, afterReload, selectVault }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const panel = '[data-draft-rescue-review]', rows = panel + ' [data-rescue-folder]';
  const original = new Map(await Promise.all(["CRLF note.md", "Welcome.md", ".obsidian/workspace.json", ".obsidian/core-plugins.json", ".obsidian/community-plugins.json"].map(async path => [path, await fs.readFile(join(directory, path))])));
  const unchanged = async () => { for (const [path, bytes] of original) { assert.deepEqual(await fs.readFile(join(directory, path)), bytes, path); } assert.deepEqual(await fingerprint(seed.base), seed.before); };
  const ready = count => wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===${count}&&!document.querySelector("[data-rescue-refresh]").disabled`, "rescue metadata list");
  const close = async () => { await press("Escape", "Escape", 27); await wait(`!document.querySelector(${JSON.stringify(panel)})`, "review panel closed"); };
  const openCommand = async () => {
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker").open', "command palette");
    await command("Input.insertText", { text: "Review Markdown rescue copies" });
    await click('[data-command-id="app:review-markdown-rescue"]');
    await ready(3);
  };
  const moveOwned = async (from, to) => {
    const [source, parent] = await Promise.all([fs.realpath(from), fs.realpath(join(to, ".."))]);
    for (const path of [source, parent, to]) { const child = relative(seed.profile, path); assert.ok(child && !isAbsolute(child) && !child.startsWith("..") || path === seed.profile, "Fixture move must stay inside its owned profile"); }
    await fs.rename(from, to);
  };
  await wait('Boolean(document.querySelector("[data-rescue-startup-review]"))', "previous-session startup notice");
  await click("[data-rescue-startup-review]"); await ready(3);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}+' [role="dialog"]').getAttribute("aria-labelledby")!==null`), true);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(rows)}).length`), 3);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-rescue-folder="${seed.linked}"]'))`), false);
  assert.ok((await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(rows)})).map(el=>el.dataset.rescueFolder)`))[0] === seed.partialId);
  await capture("startup");
  pass("A real startup notice opens the named review panel, newest listed capture first, retaining readable partial and malformed folders while omitting a linked foreign folder.");
  await click(`[data-rescue-folder="${seed.completeId}"] summary`);
  await wait(`document.querySelector('[data-rescue-folder="${seed.completeId}"]').textContent.includes(${JSON.stringify(seed.sourcePath)})`, "literal source metadata");
  assert.equal(await evaluate('globalThis.rescueReviewInjected'), undefined);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).querySelectorAll("img,script,iframe").length`), 0);
  assert.ok((await evaluate(`document.querySelector('[data-rescue-folder="${seed.partialId}"]').textContent`)).includes("0 of 1"));
  await click(`[data-rescue-show="${seed.completeId}"]`);
  await wait('document.querySelector("[data-rescue-status]").textContent.includes("Requested")', "owned reveal request");
  assert.ok(readReveals().includes(join(seed.base, seed.completeId)));
  const invalid = await evaluate('(async()=>{try{await require("electron").ipcRenderer.invoke("vault:draft-rescue","show","../outside");return null}catch(error){return error.message}})()');
  assert.match(invalid, /Choose an existing rescue folder/);
  await unchanged();
  pass("Source paths render as literal text, partial status is labelled as manifest-reported, and Show folder resolves only an existing owned rescue ID; copies, original notes and unrelated configuration stay byte-exact.");
  const moved = join(seed.profile, "temporarily-moved-rescue");
  await moveOwned(join(seed.base, seed.unreadable), moved);
  try {
    await click(`[data-rescue-show="${seed.unreadable}"]`);
    await wait('document.querySelector("[data-rescue-status]").textContent.includes("Cannot show")', "stale folder refusal");
    await click("[data-rescue-refresh]"); await ready(2);
  } finally { await moveOwned(moved, join(seed.base, seed.unreadable)); }
  await click("[data-rescue-refresh]"); await ready(3); await close();
  await openCommand();
  await evaluate('app.commands.execute("app:review-markdown-rescue")');
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(panel)}).length`), 1);
  const originalViewport = await evaluate('({width:innerWidth,height:innerHeight})');
  await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: false });
  const geometry = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(panel)}+' .modal').getBoundingClientRect();return{left:r.left,right:r.right,height:r.height,width:innerWidth,viewport:innerHeight}})()`);
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.height <= geometry.viewport, JSON.stringify(geometry));
  await capture("narrow");
  await click(`[data-rescue-show="${seed.partialId}"]`);
  await wait('document.querySelector("[data-rescue-status]").textContent.includes("Requested")', "narrow viewport folder action");
  await command("Emulation.clearDeviceMetricsOverride");
  await wait(`innerWidth===${originalViewport.width}&&innerHeight===${originalViewport.height}`, "original viewport restored");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await close();
  pass("A folder moved externally refuses reveal without restoring or deleting files; Refresh recovers, the actual command palette reopens one panel, and its controls remain contained at a 320×568 CSS viewport.");
  const other = join(directory, "Review target"); await fs.mkdir(join(other, ".obsidian"), { recursive: true }); await fs.writeFile(join(other, "Other.md"), "# Keep target vault\n");
  await selectVault(other);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(panel)}))`), false);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-rescue-startup-review]"))'), false);
  await openCommand(); await ready(3); await close();
  assert.equal(await fs.readFile(join(other, "Other.md"), "utf8"), "# Keep target vault\n");
  await selectVault(directory); await unchanged();
  pass("A real vault change does not repeat the startup notice within that session and keeps the app-profile catalog available without restoring anything into either vault.");
  await openCommand(); await restart(); await afterReload();
  await wait('Boolean(document.querySelector("[data-rescue-startup-review]"))', "copies remain discoverable after restart");
  await click("[data-rescue-startup-review]"); await ready(3); await close(); await unchanged();
  const archived = join(seed.profile, "externally-retained-rescue-copies");
  await moveOwned(seed.base, archived);
  try {
    await restart(); await afterReload();
    assert.deepEqual(await evaluate('require("electron").ipcRenderer.invoke("vault:draft-rescue","list")'), { folders: [], truncated: false });
    assert.equal(await evaluate('Boolean(document.querySelector("[data-rescue-startup-review]"))'), false);
    await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open', "empty-profile command palette");
    await command("Input.insertText", { text: "Review Markdown rescue copies" }); await click('[data-command-id="app:review-markdown-rescue"]');
    await wait('document.querySelector("[data-rescue-status]").textContent.includes("No Markdown rescue")', "empty catalog message");
    await assert.rejects(fs.access(seed.base), { code: "ENOENT" }); await close();
  } finally { await moveOwned(archived, seed.base); }
  await unchanged();
  pass("Two full desktop restarts retain exact copies and source bytes; retained folders are announced again, while an externally emptied profile stays quiet and its review command reports empty without recreating storage.");
  report.draftRescueReview = { profile: seed.profile, sourcePath: seed.sourcePath, retainedFiles: seed.before, actualCommandPalette: true, restarts: 2,
    scope: "Metadata and owned native reveal routing only; smoke suppresses Explorer. Manifest status is not content verification. External fixture moves are restored, and neither product review nor startup restores, deletes or acknowledges files. No WASM recovery claim." };
}
