import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathExists, readRecycleInfo, shellRestore } from "./system-trash-restore.mjs";

const q = JSON.stringify, id = "rich-bulk-trash-files", modal = "[data-explorer-trash]";
const pane = `[data-file-explorer=${q(id)}]`, action = name => `${pane} [data-explorer-action=${q(name)}]`;
const control = name => `${modal} [data-explorer-trash-${name}]`;
const digest = value => createHash("sha256").update(value).digest("hex");
const pass = (tools, message) => { tools.report.checks.push(message); console.log("PASS " + message); };

async function key(tools, name, code, number) {
  for (const type of [name === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) {
    await tools.command("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: number,
      ...(name === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  }
}
async function chooseMode(tools, mode) {
  const index = await tools.evaluate(`Array.from(document.querySelector(${q(control("mode"))}).options).findIndex(option=>option.value===${q(mode)})`);
  assert.ok(index >= 0, "The real host advertises " + mode);
  await tools.click(control("mode")); await key(tools, "Home", "Home", 36);
  for (let count = 0; count < index; count++) await key(tools, "ArrowDown", "ArrowDown", 40);
  await key(tools, "Enter", "Enter", 13);
  await tools.wait(`document.querySelector(${q(control("mode"))})?.value===${q(mode)}`, "trusted native removal-method selection");
}
async function selectAndOpen(tools, paths) {
  if (await tools.evaluate(`document.querySelector(${q(action("select-notes"))}).getAttribute("aria-pressed")!=="true"`)) await tools.click(action("select-notes"));
  if (await tools.evaluate(`!document.querySelector(${q(action("clear-selection"))}).disabled`)) await tools.click(action("clear-selection"));
  for (const [index, path] of paths.entries()) await tools.click(`${pane} [data-explorer-path=${q(path)}]`, index ? 2 : 0);
  assert.deepEqual(await tools.evaluate(`Array.from(document.querySelectorAll(${q(pane+' [data-explorer-selected="true"]')}),row=>row.dataset.explorerPath)`), paths);
  await tools.click(action("trash-selected")); await tools.wait(`Boolean(document.querySelector(${q(modal)}))`, "actual selected-note removal dialog");
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("mode"))}).value`), "vault");
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
}
async function review(tools, paths) {
  await chooseMode(tools, "system"); await tools.click(control("review"));
  await tools.wait(`document.querySelector(${q(control("status"))})?.textContent.includes(${q(paths.length+" saved notes reviewed")})&&!document.querySelector(${q(control("review"))}).disabled`, "saved versions reviewed for the real Recycle Bin");
  assert.deepEqual(await tools.evaluate(`Array.from(document.querySelectorAll(${q(control("preview")+" li")}),row=>row.textContent)`), paths.map(path => path + " → system trash"));
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("acknowledge"))}).parentElement.hidden`), true);
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), false);
}
async function confirmRemoval(tools) {
  await tools.evaluate(`(()=>{const t=richBulkTrashTrace;t.modal=app.workspace.getLeafById(${q(id)})?.view.selectionModal;if(!t.modal?.isOpen)throw new Error("The owned bulk removal dialog closed before confirmation");return true})()`);
  await tools.click(control("confirm"));
}
async function close(tools) {
  await tools.click(control("cancel")); await tools.wait(`!document.querySelector(${q(modal)})`, "owned bulk removal dialog closes");
}
async function trashBytes(directory) {
  const entries = [];
  async function visit(path, prefix) {
    for (const item of await readdir(path, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
      const name = prefix + item.name, child = join(path, item.name);
      if (item.isDirectory()) await visit(child, name + "/");
      else if (item.isFile()) entries.push([name, digest(await readFile(child))]);
    }
  }
  await visit(join(directory, ".trash"), ""); return entries.sort(([a], [b]) => a.localeCompare(b));
}

async function drainBulkSystemTrashMutation(tools) {
  await tools.evaluate("(async()=>{const t=globalThis.richBulkTrashTrace;t?.release?.();if(t?.info)app.vault.getFileInfo=t.info;const pending=app.fileManager.batch;if(pending)await Promise.allSettled([pending])})()");
  // FileManager.batch/withFileMutation covers one note. The modal's busy flag
  // covers the entire awaited trashSelectedNotes loop, including gaps between
  // its per-note operations and the result/acknowledgement callback.
  await tools.wait(`!app.fileManager.batch&&!app.workspace.isChangingFiles&&!globalThis.richBulkTrashTrace?.modal?.busy`, "the complete captured bulk-removal promise and its final callback settle");
  await tools.evaluate("app.workspace.whenIdle()");
}

/** Uses only the exact Recycle Bin paths acknowledged for this scenario's disposable files. */
export async function checkBulkSystemTrash(tools) {
  const { directory, evaluate, wait, click, command, capture, report, restart, afterReload } = tools;
  const folder = "Bulk Recycle validation", path = name => folder + "/" + name;
  const names = { a: path("A λ.md"), b: path("B 😀.md"), c: path("C partial.md"), d: path("D remaining.md"), stale: path("A stale version.md"), context: path("Links.md"), asset: path("kept.bin") };
  const bytes = new Map([
    [names.a, Buffer.from("\ufeff# Bulk A λ\r\n\r\nExact first 😀.\r\n")],
    [names.b, Buffer.from("# Bulk B Ω\n\nExact second.\n")],
    [names.c, Buffer.from("\ufeff# First partial\r\n")], [names.d, Buffer.from("# Second partial\n")],
    [names.stale, Buffer.from("\ufeff# Reviewed stale\r\n")],
    [names.context, Buffer.from("\ufeff# Links\r\n\r\n[[A λ]] [[B 😀]] ![[kept.bin]]\r\n")],
    [names.asset, Buffer.from([0, 255, 13, 10, 128, 1])],
  ]);
  const present = new Map(bytes), recycled = new Map(), restored = new Set();
  const ownedVersions = new Map([names.a, names.b, names.c, names.d, names.stale].map(path => [path, new Map([[digest(bytes.get(path)), bytes.get(path)]])]));
  const absolute = path => resolve(directory, ...path.split("/"));
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const previous = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("file-explorer")');
  const configurationPath = join(directory, ".obsidian/app.json"), configuration = await readFile(configurationPath);
  const preference = await evaluate('app.vault.getConfig("trashOption")??null'), originalTrash = await trashBytes(directory);
  const native = await evaluate("app.vault.supportsSystemTrash");
  if (native) assert.equal(process.platform, "win32", "The actual bulk Recycle Bin proof is Windows only");
  const layout = { version: 1, main: { id: "rich-bulk-main", type: "split", direction: "vertical", children: [
    { id: "rich-bulk-files-tabs", type: "tabs", dimension: 45, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true, searchQuery: folder } } }] },
    { id: "rich-bulk-note-tabs", type: "tabs", dimension: 55, currentTab: 0, children: [
      { id: "rich-bulk-note", type: "leaf", state: { type: "markdown", state: { file: names.a, mode: "source", source: true } } },
      { id: "rich-bulk-context", type: "leaf", state: { type: "markdown", pinned: true, state: { file: names.context, mode: "source", source: true } } },
    ] },
  ] }, active: id };
  const exact = async () => {
    for (const [path, expected] of present) assert.deepEqual(await readFile(absolute(path)), expected, path);
    for (const path of bytes.keys()) if (!present.has(path)) assert.equal(await pathExists(absolute(path)), false, path + " absent");
    assert.deepEqual(await readFile(configurationPath), configuration, "global file preferences are unchanged");
    assert.deepEqual(await trashBytes(directory), originalTrash, "no vault-local trash copy is created");
  };
  const collect = async () => {
    const responses = await evaluate("globalThis.richBulkTrashTrace?.responses??[]");
    for (const response of responses) {
      if (response.status !== 200 || !response.body?.recycledPath) continue;
      const entry = response.body;
      assert.ok(ownedVersions.has(entry.path), "Only this scenario's disposable notes enter its cleanup ledger");
      if (restored.has(entry.recycledPath)) continue;
      if (recycled.has(entry.recycledPath)) { assert.equal(recycled.get(entry.recycledPath).path, entry.path); continue; }
      // Failure cleanup also owns D/stale if an unexpected late acknowledgement
      // arrives. Authenticate its exact sidecar and initial/explicitly newer
      // fixture bytes before admitting the receipt; success expectations below
      // still require only A, B and C to have been recycled.
      const info = await readRecycleInfo(entry.recycledPath);
      assert.equal(info.originalPath.toLowerCase(), absolute(entry.path).toLowerCase());
      const content = await readFile(entry.recycledPath), expected = ownedVersions.get(entry.path).get(digest(content));
      assert.ok(expected, "The captured item must match an exact owned fixture version");
      assert.equal(info.size, expected.length); assert.deepEqual(content, expected);
      recycled.set(entry.recycledPath, { path: entry.path, bytes: expected });
    }
    return responses;
  };
  const checkRecycled = async (recycledPath, item) => {
    const info = await readRecycleInfo(recycledPath);
    assert.equal(info.originalPath.toLowerCase(), absolute(item.path).toLowerCase());
    assert.equal(info.size, item.bytes.length); assert.deepEqual(await readFile(recycledPath), item.bytes);
  };
  const restoreCaptured = async () => {
    await collect();
    const errors = [];
    for (const [recycledPath, item] of [...recycled]) {
      try {
        await checkRecycled(recycledPath, item);
        const result = await shellRestore(recycledPath, absolute(item.path));
        assert.equal(result.method, "shell-undelete"); assert.deepEqual(await readFile(absolute(item.path)), item.bytes);
        present.set(item.path, item.bytes); restored.add(recycledPath); recycled.delete(recycledPath);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Some exact owned Recycle Bin receipts could not be restored");
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.whenIdle()})()");
  };
  let stage = "fixture", failure;
  try {
    if (!enabled) await evaluate('app.core.setEnabled("file-explorer",true)');
    await mkdir(join(directory, folder));
    for (const [path, content] of bytes) await writeFile(absolute(path), content, { flag: "wx" });
    await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    await wait(`document.querySelector(${q(action("select-notes"))})&&!document.querySelector(${q(pane+" select")}).disabled`, "the actual selected-note Files owner is interactive");
    await evaluate(`(()=>{const t=globalThis.richBulkTrashTrace={events:[],responses:[],fetch:window.fetch,info:null,abort:new AbortController()};window.fetch=async function(...args){const response=await t.fetch.apply(this,args);const url=String(args[0]?.url??args[0]);if(url.includes("/api/files/system-trash")){const body=await response.clone().json();t.responses.push({url,status:response.status,body});}return response;};for(const type of["pointerdown","click","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.(${q(pane+","+modal)}))t.events.push({type,key:event.key??null,trusted:event.isTrusted});},{capture:true,signal:t.abort.signal});return true})()`);

    stage = "review and cancellation"; await selectAndOpen(tools, [names.a, names.b]);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(control("mode")+' option[value="system"]')}))`), native);
    if (!native) {
      await exact(); await capture?.("bulk-system-trash-browser-unavailable"); await close(tools);
      const refused = await evaluate(`(async()=>{try{await app.vault.trash(app.vault.getFileByPath(${q(names.a)}),true);return "accepted";}catch(error){return String(error.message??error)}})()`);
      assert.match(refused, /system trash|Recycle|not supported|native/i); await exact();
      assert.deepEqual(await collect(), []);
      pass(tools, "Browser selected-note removal offers no system-trash method; its typed system-trash refusal preserves exact notes, attachments, preferences and every vault-trash entry.");
      await selectAndOpen(tools, [names.a, names.b]); assert.equal(await evaluate(`document.querySelector(${q(control("mode"))}).value`), "vault"); await close(tools);
      report.bulkSystemTrashInputs = await evaluate("richBulkTrashTrace.events");
      assert.ok(report.bulkSystemTrashInputs.length > 10 && report.bulkSystemTrashInputs.every(event => event.trusted));
      report.bulkSystemTrashFacts = { canSystemTrash: false, actualRecycles: 0, shellRestores: 0 };
      report.bulkSystemTrash = { browserRefusal: true, noSystemOption: true, exactBytes: true, originalTrash: true, preferencesUnchanged: true, freshVaultDefault: true, zeroSystemHttpRequests: true, trustedInputs: true };
      pass(tools, "A fresh browser bulk removal still defaults to recoverable vault trash after a refused system-trash call, with no retained destructive method or review.");
      return;
    }
    await review(tools, [names.a, names.b]); await exact(); assert.deepEqual(await collect(), []);
    await capture?.("bulk-system-trash-review"); await chooseMode(tools, "vault");
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    assert.equal(await evaluate(`document.querySelectorAll(${q(control("preview")+" li")}).length`), 0);
    await close(tools); await exact();
    pass(tools, "Real Windows bulk system-trash review lists both exact paths and saved versions; cancellation and method changes perform no removal and invalidate the old confirmation without changing global preferences.");

    stage = "two actual acknowledgements"; await selectAndOpen(tools, [names.a, names.b]); await review(tools, [names.a, names.b]);
    await confirmRemoval(tools);
    await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&!app.vault.getFileByPath(${q(names.a)})&&!app.vault.getFileByPath(${q(names.b)})`, "two real native system-trash acknowledgements finish");
    present.delete(names.a); present.delete(names.b);
    const first = await collect(); assert.equal(first.length, 2); assert.ok(first.every(response => response.status === 200));
    assert.deepEqual(first.map(response => response.body.path), [names.a, names.b]);
    for (const [recycledPath, item] of recycled) await checkRecycled(recycledPath, item);
    assert.equal(await evaluate(`app.workspace.leaves().some(leaf=>[${q(names.a)},${q(names.b)}].includes(leaf.view.file?.path))`), false);
    await exact(); await capture?.("bulk-system-trash-complete");
    pass(tools, "Two selected Markdown notes are actually recycled by Windows through the real reviewed Files controls. Exact host-captured Recycle Bin paths, original-path sidecars and BOM/CRLF/Unicode bytes match; acknowledgements close removed views and create no .trash copies.");

    stage = "exact owned Shell restoration"; await restoreCaptured(); await exact();
    assert.equal(recycled.size, 0); assert.equal(restored.size, 2);
    await wait(`[${q(names.a)},${q(names.b)}].every(path=>Boolean(app.vault.getFileByPath(path))&&Boolean(app.metadataCache.getDocument(path)))`, "the ordinary vault observes the exact Shell-restored notes");
    await capture?.("bulk-system-trash-shell-restored");
    pass(tools, "The Shell undelete verb restores only the two exact captured disposable entries, with identical bytes and normal vault/metadata observation. No Recycle Bin enumeration, foreign entry or global undo is used.");

    stage = "stale physical version"; await selectAndOpen(tools, [names.stale, names.d]); await review(tools, [names.stale, names.d]);
    const newer = Buffer.from("\ufeff# Newer physical saved note Ω\r\n"); await writeFile(absolute(names.stale), newer); present.set(names.stale, newer); ownedVersions.get(names.stale).set(digest(newer), newer);
    await confirmRemoval(tools);
    await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("Confirmed 0 of 2")&&!app.workspace.isChangingFiles`, "the real changed physical version refuses before system trash");
    assert.equal((await collect()).length, 2); await exact(); await capture?.("bulk-system-trash-stale"); await close(tools);
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    pass(tools, "A physical source replacement after Windows bulk review refuses with zero acknowledgements and no additional system-trash request. The newer note and every unrelated source, link, attachment, preference and .trash byte remain exact.");

    stage = "real partial source conflict"; await selectAndOpen(tools, [names.c, names.d]); await review(tools, [names.c, names.d]);
    await evaluate(`(()=>{const t=richBulkTrashTrace;t.info=app.vault.getFileInfo;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.getFileInfo=async function(...args){if(args[0].path===${q(names.d)}){t.waiting=true;await t.gate;}return t.info.apply(this,args);};return true})()`);
    await confirmRemoval(tools); await wait("richBulkTrashTrace.waiting", "the second real version read waits after the first acknowledged recycle");
    present.delete(names.c); await collect(); assert.equal(recycled.size, 1);
    for (const name of ["mode", "acknowledge", "review", "confirm", "cancel"]) assert.equal(await evaluate(`document.querySelector(${q(control(name))}).disabled`), true);
    await click(modal + " .modal-close-button"); await key(tools, "Escape", "Escape", 27);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), true);
    const changed = Buffer.from("# Newer second partial source λ\r\n"); await writeFile(absolute(names.d), changed); present.set(names.d, changed); ownedVersions.get(names.d).set(digest(changed), changed);
    await capture?.("bulk-system-trash-busy"); await exact();
    await evaluate("richBulkTrashTrace.release()");
    await wait(`!app.workspace.isChangingFiles&&!document.querySelector(${q(control("cancel"))}).disabled&&document.querySelector(${q(control("status"))})?.textContent.includes("Confirmed 1 of 2")`, "real later version change preserves the acknowledged partial result");
    const partial = await collect(); assert.equal(partial.length, 3); assert.equal(partial[2].status, 200); assert.equal(partial[2].body.path, names.c);
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    await exact(); await capture?.("bulk-system-trash-partial"); await close(tools);
    await evaluate("app.vault.getFileInfo=richBulkTrashTrace.info;richBulkTrashTrace.info=null");
    pass(tools, "A real second-source conflict after the first Windows recycle retains the confirmed first result and the newer second note. Busy controls, header Close and Escape refuse dismissal; the partial dialog disables replay and reports only one of two acknowledgements.");

    stage = "partial Shell restoration"; await restoreCaptured(); await exact(); assert.equal(restored.size, 3);
    await selectAndOpen(tools, [names.c, names.d]); assert.equal(await evaluate(`document.querySelector(${q(control("mode"))}).value`), "vault"); await close(tools);
    pass(tools, "The exact captured partial Recycle Bin entry restores through Shell undelete, while the unrecycled newer second source stays intact. Fresh removal starts in vault-trash mode and retains no old system-trash review or global preference change.");

    stage = "restart"; report.bulkSystemTrashInputs = await evaluate("richBulkTrashTrace.events");
    assert.ok(report.bulkSystemTrashInputs.length > 25 && report.bulkSystemTrashInputs.every(event => event.trusted));
    report.bulkSystemTrashResponses = await collect();
    report.bulkSystemTrashRestored = [...restored];
    await drainBulkSystemTrashMutation(tools);
    await evaluate("(()=>{const t=richBulkTrashTrace;window.fetch=t.fetch;t.abort.abort();return true})()");
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&!app.workspace.isChangingLayout`, "the real Files pane returns after restart");
    await exact(); assert.equal(await evaluate(`document.querySelector(${q(action("select-notes"))}).getAttribute("aria-pressed")`), "false");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false); await capture?.("bulk-system-trash-restored");
    report.bulkSystemTrashFacts = { canSystemTrash: true, actualRecycles: 3, shellRestores: restored.size };
    report.bulkSystemTrash = { actualTwoNoteRecycle: true, exactCapturedBinPaths: true, exactSidecarOriginals: true, exactBytes: true,
      shellRestoredAllThree: true, noForeignBinAccess: true, noGlobalUndo: true, noMutationBeforeConfirm: true, changedMethodInvalidates: true,
      stalePhysicalVersionRefused: true, actualPartialAcknowledgement: true, newerSecondSourceRetained: true, busyCloseEscapeRefused: true,
      noReviewReplay: true, originalTrash: true, linksAndAttachmentsExact: true, preferencesUnchanged: true, freshVaultDefault: true,
      restartSelectionReset: true, trustedInputs: true };
    pass(tools, "Full native restart retains every exact restored/newer source and unchanged attachment/link/preference/trash byte. Selection, dialogs and destructive review state are transient, and every recorded input is trusted.");
  } catch (error) {
    failure = error; report.bulkSystemTrashFailure = { stage, error: String(error.stack ?? error) };
    try { await capture?.("bulk-system-trash-precleanup-failure"); } catch { /* Retain the first error. */ }
    throw error;
  } finally {
    const errors = []; let drained = false;
    try {
      await drainBulkSystemTrashMutation(tools); drained = true;
      if (native) await restoreCaptured();
    } catch (error) { errors.push(error); report.bulkSystemTrashCleanup = { drained, captureRetained: !drained, remaining: [...recycled].map(([path, item]) => ({ recycledPath: path, originalPath: absolute(item.path), sha256: digest(item.bytes) })), error: String(error.stack ?? error) }; }
    try { if (drained) {
      await evaluate("(()=>{const t=globalThis.richBulkTrashTrace;if(!t)return;window.fetch=t.fetch;t.abort.abort()})()");
      if (await evaluate(`Boolean(document.querySelector(${q(modal)}))`)) await close(tools);
      await evaluate(`(async()=>{await app.workspace.changeLayout(${q(previous)});await app.workspace.flushLayout();delete globalThis.richBulkTrashTrace})()`);
      if (!enabled) await evaluate('app.core.setEnabled("file-explorer",false)');
    } } catch (error) { errors.push(error); }
    if (!failure && errors.length) throw new AggregateError(errors, "Owned bulk Recycle Bin validation cleanup did not finish.");
  }
}

/** Parent owns the genuine prepared cache, exact blob audit and local-vault return. */
export async function checkBulkSystemTrashReadOnly(tools) {
  const { evaluate, wait, click, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  assert.equal(await evaluate("app.vault.supportsSystemTrash"), false);
  const before = await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), previous = await evaluate("app.workspace.getLayout()");
  const readonlyId = "rich-bulk-readonly", readonlyPane = `[data-file-explorer=${q(readonlyId)}]`;
  const target = readonlyPane + ' [data-explorer-action="trash-selected"]';
  const layout = { version: 1, main: { id: "rich-bulk-readonly-main", type: "split", direction: "vertical", children: [
    { id: "rich-bulk-readonly-tabs", type: "tabs", currentTab: 0, children: [{ id: readonlyId, type: "leaf", state: { type: "file-explorer", state: {} } }] },
  ] }, active: readonlyId };
  try {
    await evaluate(`app.workspace.changeLayout(${q(layout)})`);
    await wait(`document.querySelector(${q(readonlyPane+" select")})?.disabled===false`, "actual cached Files controls are interactive for browsing");
    await click(readonlyPane + ' [data-explorer-action="select-notes"]');
    await click(readonlyPane + ' [data-explorer-path="Read only.md"]');
    assert.equal(await evaluate(`document.querySelector(${q(target)}).disabled`), true);
    const point = await evaluate(`(()=>{const node=document.querySelector(${q(target)});node.scrollIntoView({block:"center"});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node}})()`);
    assert.equal(point.hit, true);
    for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false);
    await evaluate(`document.querySelector(${q(target)}).disabled=false`); await click(target);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false);
    const code = await evaluate('(async()=>{try{await app.vault.trash(app.vault.getFileByPath("Read only.md"),true);return "accepted"}catch(error){return error.code}})()');
    assert.equal(code, "VAULT_READ_ONLY");
    assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), before);
    assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
    await capture?.("bulk-system-trash-readonly");
    report.bulkSystemTrashReadOnly = { genuineCachedReadOnly: true, unavailableSystemCapability: true, disabledBulkRemoval: true, trustedDisabledPointerRefused: true, forcedControlRefused: true, typedRefusalBeforeTransport: true, inventoryExact: true, zeroApiRaw: true };
    pass(tools, "The genuine cached read-only Files selection keeps bulk removal disabled. Trusted pointer and forced control cannot open a review; a typed system-trash call returns VAULT_READ_ONLY without API/raw traffic, preserving inventory and parent-audited cached blobs.");
  } finally {
    await evaluate(`app.workspace.changeLayout(${q(previous)})`);
  }
}
