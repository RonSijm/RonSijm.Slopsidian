import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const sha = value => createHash("sha256").update(value).digest("hex");
const slotOf = (root, path) => sha(JSON.stringify([root, path])).slice(0, 40);

// Real-host recovery of durable Markdown drafts. `kind` is "desktop" (profile SQLite, forced process kill, new loopback port)
// or "browser" (IndexedDB, real folder handle, page leave and reconnect). Disposable vaults and profiles only.
export async function checkPersistentDrafts({ kind, directory, evaluate, command, click, press, wait, report, lose, reconnect, origin, capture }) {
  assert.ok(kind === "desktop" || kind === "browser");
  const checks = report.persistentDrafts = { kind, checks: [] };
  const pass = message => { checks.checks.push(message); report.checks?.push(message); };
  const file = path => join(directory, ...path.split("/"));
  const root = await evaluate("app.vault.rootPath");
  const originals = new Map([
    ["Draft BOM CRLF.md", Buffer.concat([BOM, Buffer.from("# BOM CRLF\r\n\r\nOriginal line.\r\n")])],
    ["Draft LF Unicode.md", Buffer.from("# LF note\n\nOriginal λ.\n")],
    ["Draft Changed Externally.md", Buffer.from("# Changed\n\nBase.\n")],
    ["Draft Replace Me.md", Buffer.concat([BOM, Buffer.from("# Replace\n\nBase text.\n")])],
    ["Draft Saved Later.md", Buffer.from("# Saved\n\nBase.\n")],
  ]);
  for (const [path, bytes] of originals) { await writeFile(file(path), bytes); }
  await evaluate("app.vault.refresh()");
  const unchanged = async names => { for (const name of names) { assert.deepEqual(await readFile(file(name)), originals.get(name), name + " source bytes changed"); } };
  const suffixes = new Map([
    ["Draft BOM CRLF.md", "Unsaved CRLF draft 😀.\n"], ["Draft LF Unicode.md", "Unsaved LF draft 中文.\n"], ["Draft Changed Externally.md", "Unsaved text that must not overwrite.\n"],
    ["Draft Replace Me.md", "Unsaved replacement text.\n"], ["Draft Saved Later.md", "Saved before the loss.\n"],
  ]);
  const expectedText = (name, eol) => originals.get(name).subarray(originals.get(name)[0] === 0xef ? 3 : 0).toString("utf8") + suffixes.get(name).replaceAll("\n", eol);
  const expected = new Map([...suffixes.keys()].map(name => [name, Buffer.from((originals.get(name)[0] === 0xef ? "\ufeff" : "") + expectedText(name, name.includes("CRLF") ? "\r\n" : "\n"))]));
  expected.set("Draft Replace Me.md", Buffer.from("\ufeff" + expectedText("Draft Replace Me.md", "\n")));

  await evaluate("app.markdownAutosave?.setEnabled?.(false)");
  for (const [index, [name, suffix]] of [...suffixes].entries()) {
    await evaluate(`(async()=>{await app.openFile(${JSON.stringify(name)},"tab");app.workspace.activeLeaf.view.setEditingMode(${JSON.stringify(index % 2 ? "live-preview" : "source")})})()`);
    await evaluate('document.querySelectorAll("[data-persistent-draft-editor]").forEach(el=>el.removeAttribute("data-persistent-draft-editor"));app.editor.cm.contentDOM.dataset.persistentDraftEditor="active"');
    await click('[data-persistent-draft-editor="active"]');
    await press("End", "End", 35, 2);
    await command("Input.insertText", { text: suffix });
    await wait(`app.workspace.sessions.get(${JSON.stringify(name)})?.dirty`, "typed unsaved " + name);
  }
  // Saved before the loss: the capture must retire its record once the identical text is on disk.
  await evaluate('app.workspace.sessions.get("Draft Saved Later.md").save()');
  assert.deepEqual(await readFile(file("Draft Saved Later.md")), expected.get("Draft Saved Later.md"));
  const drained = await evaluate("slopsidianDraftCapture.flush().then(status=>({protecting:status.protecting,failures:status.failures,storageError:status.storageError}))");
  assert.equal(drained.storageError, null);
  assert.deepEqual(drained.failures, []);
  assert.ok(drained.protecting >= 4, "Started capture must have drained every dirty note before the loss: " + JSON.stringify(drained));
  await unchanged([...originals.keys()].filter(name => name !== "Draft Saved Later.md"));
  const before = { origin: origin ? origin() : await evaluate("location.origin"), href: await evaluate("location.href") };
  await capture?.("dirty");
  pass(kind + ": typing BOM/CRLF/LF/Unicode edits in the real editor drained into durable storage without touching any source note.");

  const lost = await lose();
  await unchanged([...originals.keys()].filter(name => name !== "Draft Saved Later.md"));
  await reconnect();
  const after = { origin: origin ? origin() : await evaluate("location.origin"), href: await evaluate("location.href") };
  if (kind === "desktop") {
    assert.notEqual(after.origin, before.origin, "The restarted desktop host must serve from a different loopback port/origin.");
    assert.ok(lost.forcedTermination, "Desktop loss must be a forced process-tree kill, not a graceful close.");
  }
  checks.hosts = { before, after, lost };
  pass(kind + ": the host was lost and reopened (" + before.origin + " -> " + after.origin + ") and the drafts were found from stable storage.");

  await wait('Boolean(document.querySelector("[data-draft-startup-review]"))', "startup notice for recovered drafts");
  const noticeText = await evaluate('document.querySelector("[data-draft-startup-review]").parentElement.textContent');
  assert.match(noticeText, /unsaved Markdown draft\(s\) were recovered/);
  await capture?.("startup-notice");
  pass(kind + ": the real startup notice offered Review for orphaned drafts.");

  // A real external edit between capture and recovery.
  const external = Buffer.from("# Changed\n\nExternal edit made while the app was closed.\n");
  await writeFile(file("Draft Changed Externally.md"), external);
  await evaluate("app.vault.refresh()");
  await click("[data-draft-startup-review]");
  await wait('document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]").length>=4&&!document.querySelector("[data-persistent-draft-review] [data-draft-refresh]")?.disabled', "review listing");
  const find = (name, status) => evaluate(`(()=>{const s=[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].find(x=>x.querySelector("h3").textContent===${JSON.stringify(name)}&&(${JSON.stringify(status ?? null)}===null||x.querySelector("[data-draft-source]")?.dataset.draftSource===${JSON.stringify(status ?? null)}));if(!s)return null;s.setAttribute("data-draft-under-test","");return{id:s.dataset.draftId,status:s.querySelector("[data-draft-source]")?.dataset.draftSource,replace:Boolean(s.querySelector("[data-draft-replace]"))}})()`);
  const mark = async (name, status) => { await evaluate('document.querySelectorAll("[data-draft-under-test]").forEach(x=>x.removeAttribute("data-draft-under-test"))'); const info = await find(name, status); assert.ok(info, "No draft listed for " + name); return info; };
  let info = await mark("Draft BOM CRLF.md");
  assert.equal(info.status, "unchanged");
  assert.equal(info.replace, true);
  info = await mark("Draft Changed Externally.md");
  assert.equal(info.status, "changed");
  assert.equal(info.replace, false, "Replace must not be offered for an externally changed note");
  assert.equal((await mark("Draft Saved Later.md").catch(() => null)), null, "A note saved before the loss must not leave a stale draft") ;
  pass(kind + ": Review lists exact owners/status: unchanged, externally changed (no Replace offered); the already-saved note left no stale record.");

  // Cancel preserves everything.
  await press("Escape", "Escape", 27);
  await wait('!document.querySelector("[data-persistent-draft-review]")', "Review closed");
  await evaluate('app.commands.executeCommandById("app:review-persistent-drafts")');
  await wait('document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]").length>=4&&!document.querySelector("[data-persistent-draft-review] [data-draft-refresh]")?.disabled', "review reopened after cancel");
  await unchanged([...originals.keys()].filter(name => !["Draft Saved Later.md", "Draft Changed Externally.md"].includes(name)));
  assert.deepEqual(await readFile(file("Draft Changed Externally.md")), external);
  pass(kind + ": closing Review (Cancel) kept every record and every source byte.");

  const openText = async (name, status) => {
    await wait(`(()=>{const s=[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].find(x=>x.querySelector("h3").textContent===${JSON.stringify(name)}&&x.querySelector("details")&&(${JSON.stringify(status ?? null)}===null||x.querySelector("[data-draft-source]")?.dataset.draftSource===${JSON.stringify(status ?? null)}));return Boolean(s)})()`, "review row rendered for " + name);
    await mark(name, status);
    await evaluate('document.querySelector("[data-draft-under-test] details").open=true');
    await wait('!document.querySelector("[data-draft-under-test] button").disabled||[...document.querySelectorAll("[data-draft-under-test] button")].some(b=>!b.disabled)', "actions enabled after review");
  };
  const result = () => evaluate('document.querySelector("[data-draft-under-test] [data-draft-result]")?.textContent??""');
  const present = name => evaluate(`[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent===${JSON.stringify(name)})`);

  // Version-guarded Replace conflict: the note changes after the review rendered.
  await openText("Draft Replace Me.md");
  const raced = Buffer.concat([BOM, Buffer.from("# Replace\n\nExternal race.\n")]);
  await writeFile(file("Draft Replace Me.md"), raced);
  await click('[data-draft-under-test] [data-draft-replace]');
  await wait('(document.querySelector("[data-draft-under-test] [data-draft-result]")?.textContent??"").length>0&&![...document.querySelectorAll("[data-draft-under-test] button")].some(b=>b.disabled&&b.dataset.draftReplace!==undefined)', "replace conflict outcome");
  assert.deepEqual(await readFile(file("Draft Replace Me.md")), raced, "A conflicting Replace must not overwrite the external edit");
  const conflictResult = await result();
  assert.ok(conflictResult.length > 0);
  assert.equal(await present("Draft Replace Me.md"), true, "The draft record must survive a refused Replace");
  pass(kind + ": Replace with a stale base version was refused (" + conflictResult.slice(0, 120) + "); external bytes and the draft record were preserved.");

  // Create-only restore with exact bytes, including a preserved BOM and CRLF.
  const restore = async (name, destination) => {
    await openText(name);
    if (destination) { await evaluate(`(()=>{const input=document.querySelector("[data-draft-under-test] [data-draft-destination]");input.value=${JSON.stringify(destination)}})()`); }
    const target = destination ?? await evaluate('document.querySelector("[data-draft-under-test] [data-draft-destination]").value');
    await click('[data-draft-under-test] [data-draft-save-new]');
    await wait(`!document.querySelector("[data-draft-under-test]")||(document.querySelector("[data-draft-under-test] [data-draft-result]")?.textContent??"").length>0`, "save as new outcome");
    return target;
  };
  const existing = await restore("Draft BOM CRLF.md", "Draft LF Unicode.md");
  assert.equal(existing, "Draft LF Unicode.md");
  assert.deepEqual(await readFile(file("Draft LF Unicode.md")), originals.get("Draft LF Unicode.md"), "Create-only restore must never overwrite an existing note");
  assert.equal(await present("Draft BOM CRLF.md"), true);
  const crlfTarget = await restore("Draft BOM CRLF.md", "Recovered/BOM CRLF.md");
  await wait('![...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent==="Draft BOM CRLF.md")', "BOM draft retired after restore");
  const restoredBom = await readFile(file(crlfTarget));
  assert.deepEqual(restoredBom, expected.get("Draft BOM CRLF.md"), "Save as new must reproduce the exact BOM + CRLF bytes");
  assert.deepEqual(restoredBom.subarray(0, 3), BOM, "The UTF-8 BOM must be retained");
  assert.deepEqual(await readFile(file("Draft BOM CRLF.md")), originals.get("Draft BOM CRLF.md"), "The source note must stay untouched");
  const lfTarget = await restore("Draft LF Unicode.md", "Recovered/LF Unicode.md");
  await wait('![...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent==="Draft LF Unicode.md")', "LF draft retired after restore");
  assert.deepEqual(await readFile(file(lfTarget)), expected.get("Draft LF Unicode.md"));
  const changedTarget = await restore("Draft Changed Externally.md", "Recovered/Changed draft.md");
  await wait('![...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent==="Draft Changed Externally.md")', "changed draft retired after restore");
  assert.deepEqual(await readFile(file(changedTarget)), expected.get("Draft Changed Externally.md"));
  assert.deepEqual(await readFile(file("Draft Changed Externally.md")), external, "The externally edited source must remain untouched");
  await capture?.("recovered");
  pass(kind + ": create-only Save as new refused an existing path and restored exact bytes (BOM+CRLF, LF+Unicode, externally-changed note) while source notes stayed unchanged.");

  // Fresh unchanged draft: reviewed Replace succeeds and keeps the BOM.
  await writeFile(file("Draft Replace Me.md"), originals.get("Draft Replace Me.md"));
  await evaluate("app.vault.refresh()");
  await press("Escape", "Escape", 27);
  await evaluate('(async()=>{await app.openFile("Draft Replace Me.md","tab");})()');
  // Re-type so the record's base version matches the restored original.
  await evaluate('app.editor.cm.contentDOM.dataset.persistentDraftEditor="again"');
  await click('[data-persistent-draft-editor="again"]');
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: suffixes.get("Draft Replace Me.md") });
  await wait('app.workspace.sessions.get("Draft Replace Me.md")?.dirty', "re-typed replace note");
  await evaluate("slopsidianDraftCapture.flush()");
  await lose().then(reconnect);
  await wait('Boolean(document.querySelector("[data-draft-startup-review]"))', "second startup notice");
  await click("[data-draft-startup-review]");
  await wait('document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]").length>=1&&!document.querySelector("[data-persistent-draft-review] [data-draft-refresh]")?.disabled', "second review listing");
  await wait('(()=>{const s=[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].find(x=>x.querySelector("h3").textContent==="Draft Replace Me.md"&&x.querySelector("[data-draft-source]")?.dataset.draftSource==="unchanged");if(s)return true;document.querySelector("[data-persistent-draft-review] [data-draft-refresh]")?.click();return false})()', "replace note recoverable after the previous owner's lease lapsed", 40000);
  info = await mark("Draft Replace Me.md", "unchanged");
  await openText("Draft Replace Me.md", "unchanged");
  await click('[data-draft-under-test] [data-draft-replace]');
  await wait('![...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent==="Draft Replace Me.md"&&x.querySelector("[data-draft-source]")?.dataset.draftSource==="unchanged")', "replace completed and draft retired");
  assert.deepEqual(await readFile(file("Draft Replace Me.md")), expected.get("Draft Replace Me.md"), "Reviewed Replace must write exact text and keep the BOM");
  pass(kind + ": a reviewed, version-guarded Replace on an unchanged note wrote the exact text, kept the BOM and retired the draft.");

  // Controls: corrupt, foreign-root and explicit capture failure.
  const putRaw = (key, value) => kind === "desktop"
    ? evaluate(`require("electron").ipcRenderer.invoke("vault:persistent-drafts","cas",${JSON.stringify(key)},null,${JSON.stringify(value)})`)
    : evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open("slopsidian-persistent-drafts",1);open.onsuccess=()=>{const tx=open.result.transaction("records","readwrite");tx.objectStore("records").put(${JSON.stringify(value)},${JSON.stringify(key)});tx.oncomplete=()=>resolve({applied:true});tx.onerror=()=>reject(tx.error)}; open.onerror=()=>reject(open.error)})`);
  const prefix = "slopsidian:persistent-draft:v1:";
  const corruptKey = prefix + "control-corrupt", corruptRaw = '{"schema":1,"truncated":';
  await putRaw(corruptKey, corruptRaw);
  const foreignRoot = kind === "desktop" ? "Z:\\Foreign root\\Vault" : "browser-vault:foreign-root-control";
  const foreignContent = "# Foreign\n\nBelongs to another vault.\n", owner = "control-owner", slot = slotOf(foreignRoot, "Foreign.md");
  const foreignId = slot + "." + sha(owner).slice(0, 12), foreignBytes = Buffer.from(foreignContent);
  await putRaw(prefix + foreignId, JSON.stringify({ schema: 1, id: foreignId, vaultRoot: foreignRoot, path: "Foreign.md", baseVersion: "0".repeat(64), hasBom: false, content: foreignContent, eol: "lf", bytes: foreignBytes.length, sha256: sha(foreignBytes), createdAt: 1, updatedAt: 1, ownerId: owner, revision: 1 }));
  await evaluate("document.querySelector('[data-persistent-draft-review]') ? 0 : app.commands.executeCommandById('app:review-persistent-drafts')");
  await evaluate("document.querySelector('[data-persistent-draft-review] [data-draft-refresh]')?.click()");
  await wait('document.querySelector("[data-persistent-draft-review] [data-draft-corrupt]")&&!document.querySelector("[data-persistent-draft-review] [data-draft-refresh]")?.disabled', "corrupt record listed");
  const corruptOutcome = await evaluate('(()=>{const s=document.querySelector("[data-persistent-draft-review] [data-draft-corrupt]");return{key:s.dataset.draftCorrupt,text:s.textContent}})()');
  assert.equal(corruptOutcome.key, corruptKey);
  const foreign = await mark("Foreign.md");
  assert.equal(foreign.status, "other-vault");
  assert.equal(foreign.replace, false, "A foreign-root draft must never be replaceable");
  const raw = await putRaw(corruptKey, "overwrite-attempt-should-fail").catch(error => ({ error: String(error) }));
  assert.ok(raw && typeof raw === "object");
  await capture?.("controls");
  pass(kind + ": a corrupt raw record was reported without modification and a foreign-root draft was listed as another vault with no Replace action.");

  // A genuinely over-limit buffer is reported by the capture instead of being silently dropped.
  const huge = "x".repeat(8 * 1024 * 1024 + 1024);
  await press("Escape", "Escape", 27);
  await evaluate('(async()=>{await app.openFile("Draft Saved Later.md","tab")})()');
  const saved = await readFile(file("Draft Saved Later.md"));
  await evaluate(`app.editor.setValue(${JSON.stringify(huge)})`);
  await wait('app.workspace.sessions.get("Draft Saved Later.md")?.dirty', "over-limit buffer is dirty");
  const failing = await evaluate("slopsidianDraftCapture.flush().then(status=>status.failures)");
  assert.ok(failing.some(item => item.path === "Draft Saved Later.md" && item.kind === "too-large"), "An over-limit draft must be an explicit failure: " + JSON.stringify(failing));
  assert.deepEqual(await readFile(file("Draft Saved Later.md")), saved, "Failing capture must not touch the source note");
  await evaluate(`app.editor.setValue(${JSON.stringify(saved.subarray(saved[0] === 0xef ? 3 : 0).toString("utf8"))})`);
  await evaluate("slopsidianDraftCapture.flush()");
  pass(kind + ": an over-limit buffer produced an explicit too-large capture failure without touching its note.");
  report.persistentDraftsGuarantees = "Best-effort browser/desktop profile storage; OS or power-loss durability, storage eviction/clearing, plugin-only, Canvas and Bases drafts are not claimed.";
  await delay(0);
}
