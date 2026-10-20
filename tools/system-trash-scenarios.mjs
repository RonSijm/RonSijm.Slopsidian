import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists, readRecycleInfo, removeOwnedItem, shellRestore } from "./system-trash-restore.mjs";

// Connected-app proof for Windows system trash. The desktop scenario drives the real settings page, Files context menu,
// confirmation dialogs and command palette against a disposable vault, captures the host's exact RecycledPath for every
// item it moves, proves exact bytes there, restores only those exact items through the Shell "undelete" verb and removes
// only its own leftovers. It never enumerates, empties or restores any other Recycle Bin entry and never uses a global undo.
// The standalone scenario proves the explicit refusal with nothing deleted.

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const exists = pathExists;

async function tree(directory, relative = "") {
  const out = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const child = relative ? relative + "/" + entry.name : entry.name;
    if (entry.isDirectory()) { out.push(child + "/", ...await tree(directory, child)); } else { out.push(child + ":" + sha(await readFile(join(directory, child)))); }
  }
  return out.sort();
}

export async function checkSystemTrash({ directory, evaluate, command, click, press, wait, report, restart, capture }) {
  assert.equal(process.platform, "win32", "System trash proof runs only on the Windows desktop host");
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const recycledItems = [];
  const noteBytes = Buffer.from("\ufeff# Note\r\n\r\nSystem trash body\r\n"), menuBytes = Buffer.from([0, 255, 1, 254, 0, 13, 10, 0x1a, 0xc3, 0x28]);
  const aBytes = Buffer.from("# A\r\n"), bBytes = Buffer.from([9, 0, 255, 128]), cmdBytes = Buffer.from("# Cmd local\n"), keepBytes = Buffer.from("Keep\r\n");
  const abs = path => join(directory, ...path.split("/"));
  const note = "Bin/Note.md", menuFile = "Bin/Menu.bin", dir = "Bin/Dir", aPath = dir + "/a.md", deepPath = dir + "/deep/b.bin", cmdFile = "Bin/Cmd.md";
  const originalPath = join(directory, ".obsidian/workspace.json"), savedPath = join(directory, ".obsidian/vault-dotnet-workspace.json");
  const pane = '[data-file-explorer="st-explorer"]';
  const row = path => `${pane} [data-explorer-path=${JSON.stringify(path)}]`;
  const settle = () => wait("!app.workspace.isChangingFiles&&!app.changingVault", "file operation settles");

  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  for (const folder of ["Bin/Dir/deep"]) { await mkdir(abs(folder), { recursive: true }); }
  for (const [path, bytes] of [[note, noteBytes], [menuFile, menuBytes], [aPath, aBytes], [deepPath, bBytes], [cmdFile, cmdBytes], ["Keep.md", keepBytes]]) { await writeFile(abs(path), bytes); }
  const futureApp = JSON.parse((await readFile(join(directory, ".obsidian/app.json"), "utf8").catch(() => "{}")).replace(/^\ufeff/, "") || "{}");
  await writeFile(join(directory, ".obsidian/app.json"), JSON.stringify({ ...futureApp, trashOption: "local", futureSystemTrashFixture: { keep: [true, "中文"] } }));
  const layout = { main: { id: "st-main", type: "split", direction: "vertical", children: [
    { id: "st-explorer-tabs", type: "tabs", dimension: 40, children: [{ id: "st-explorer", type: "leaf", pinned: true, state: { type: "file-explorer", state: { sortOrder: "alphabetical" } } }] },
    { id: "st-note-tabs", type: "tabs", dimension: 60, children: [{ id: "st-note", type: "leaf", state: { type: "markdown", state: { file: note, mode: "source", source: true } } }] },
  ] }, active: "st-note", left: { id: "st-left", type: "split", direction: "horizontal", width: 260, collapsed: true, children: [] }, right: { id: "st-right", type: "split", direction: "horizontal", width: 240, collapsed: true, children: [] } };
  const boot = async () => {
    await restart(async () => { await writeFile(originalPath, JSON.stringify(layout, null, 2)); await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } }); });
    await wait('app.workspace.getLeafById("st-explorer")?.view.getViewType()==="file-explorer"&&app.workspace.getLeafById("st-note")?.view.editor&&!app.core.busy&&!app.workspace.isChangingFiles', "Files pane and open note");
  };
  const hook = () => evaluate(`(()=>{if(globalThis.systemTrashHooked)return true;globalThis.systemTrashHooked=true;globalThis.systemTrashResponses=[];const original=window.fetch.bind(window);
    window.fetch=async(...args)=>{const response=await original(...args);const url=String(args[0]?.url??args[0]);if(url.includes("system-trash")){response.clone().json().then(body=>systemTrashResponses.push({url,status:response.status,body})).catch(()=>{})}return response};return true})()`);
  const captured = async count => { await wait(`systemTrashResponses.length>=${count}`, "host system-trash response captured"); return (await evaluate("systemTrashResponses"))[count - 1]; };
  const openAction = async (path, action) => {
    await evaluate(`document.querySelector(${JSON.stringify(row(path))}).focus()`); await press("F10", "F10", 121, 8);
    await wait(`Boolean(document.querySelector('[data-file-menu=actions] [data-file-action=${action}]'))`, action + " menu item for " + path);
    await click(`[data-file-menu=actions] [data-file-action=${action}]`); await wait(`Boolean(document.querySelector('[data-file-dialog=${action}]'))`, action + " dialog");
  };
  const submit = action => click(`[data-file-dialog=${action}] button[type=submit]`);
  const restore = async (recycledPath, path) => {
    const info = await readRecycleInfo(recycledPath);
    assert.equal(info.originalPath.toLowerCase(), abs(path).replace(/\//g, "\\").toLowerCase());
    const result = await shellRestore(recycledPath, abs(path));
    recycledItems.splice(recycledItems.indexOf(recycledPath), 1); report.systemTrash.restores.push({ path, method: result.method });
  };
  const openSettings = async () => { await click("#open-settings"); await click("#files-links-tab"); await wait('document.querySelector("[data-file-settings] [data-setting-key=trashOption] select")', "Deleted files setting"); };
  const chooseTrash = async value => {
    await openSettings();
    await evaluate(`(()=>{const select=document.querySelector("[data-file-settings] [data-setting-key=trashOption] select");select.value=${JSON.stringify(value)};select.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
    await wait(`app.vault.getConfig("trashOption")===${JSON.stringify(value)}`, "trashOption " + value);
    await click(".settings-close"); await wait('!document.querySelector("#settings-dialog").open', "settings closed");
  };
  report.systemTrash = { recycledPaths: [], restores: [], boundaries: [] };

  try {
    await boot(); await hook();
    assert.equal(await evaluate("app.vault.supportsSystemTrash"), true, "the writable native host supports system trash");
    pass("A disposable writable vault opens a real Files pane beside the Source note under test with system trash supported by the native host.");

    await openSettings();
    assert.deepEqual(await evaluate('Array.from(document.querySelector("[data-file-settings] [data-setting-key=trashOption] select").options,o=>o.value)'), ["local", "system"]);
    await click(".settings-close");
    await chooseTrash("system");
    const settings = JSON.parse((await readFile(join(directory, ".obsidian/app.json"), "utf8")).replace(/^\ufeff/, ""));
    assert.equal(settings.trashOption, "system"); assert.deepEqual(settings.futureSystemTrashFixture, { keep: [true, "中文"] });
    pass("The real Files and links page persists Deleted files = system while retaining unrelated app.json keys.");

    // Dirty note through the command palette (current-file command honors the setting).
    await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("st-note"));app.workspace.activeLeaf.view.focus()');
    await command("Input.insertText", { text: "Dirty " });
    assert.ok((await evaluate('app.workspace.getLeafById("st-note").view.editor.getValue()')).includes("Dirty "));
    await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open', "command palette");
    await command("Input.insertText", { text: "Move current file to trash" }); await click('[data-command-id="file-explorer:trash-file"]');
    await wait('Boolean(document.querySelector("[data-file-dialog=system-trash]"))', "command opens the system-trash dialog");
    assert.match(await evaluate('document.querySelector("[data-file-dialog=system-trash]").textContent'), /Windows Recycle Bin/);
    await submit("system-trash");
    const first = await captured(1); assert.equal(first.status, 200, JSON.stringify(first));
    recycledItems.push(first.body.recycledPath); report.systemTrash.recycledPaths.push(first.body.recycledPath);
    await wait(`!app.vault.getFileByPath(${JSON.stringify(note)})`, "note removed from the vault"); await settle();
    assert.equal(await exists(abs(note)), false); assert.equal(await exists(abs(".trash")), false, "no vault .trash is created");
    const recycledNote = await readFile(first.body.recycledPath, "utf8");
    assert.ok(recycledNote.startsWith("\ufeff") && recycledNote.includes("Dirty ") && recycledNote.includes("# Note\r\n\r\n") && recycledNote.endsWith("System trash body\r\n"), "the dirty edit was saved before recycling with BOM/CRLF intact: " + JSON.stringify(recycledNote));
    assert.equal(await evaluate('app.workspace.getLeavesOfType("markdown").every(leaf=>leaf.view.file?.path!==' + JSON.stringify(note) + ')'), true);
    assert.equal(await evaluate("document.querySelector('#client-errors').textContent"), "");
    await capture("note-recycled");
    pass("The command palette Move current file to trash with the system setting saves the dirty open note, shows the Recycle Bin dialog, recycles exactly those bytes at the captured RecycledPath, closes the view and creates no vault .trash.");

    // Foreign retention: a foreign file at the original path blocks the owned restore and is retained.
    const foreign = Buffer.from("Foreign replacement must stay.\r\n");
    await writeFile(abs(note), foreign);
    await assert.rejects(shellRestore(first.body.recycledPath, abs(note)), /occupied/);
    assert.deepEqual(await readFile(abs(note)), foreign); assert.deepEqual(await readFile(first.body.recycledPath, "utf8").then(Buffer.from), Buffer.from(recycledNote));
    await unlink(abs(note));
    await restore(first.body.recycledPath, note);
    assert.equal(await readFile(abs(note), "utf8"), recycledNote);
    await wait(`Boolean(app.vault.getFileByPath(${JSON.stringify(note)}))`, "restored note observed by the vault");
    pass("A foreign file created at the original path is retained and blocks restore; after removing it only the exact captured item is restored through the Shell with identical bytes and the vault observes it.");

    // Files menu binary item.
    await openAction(menuFile, "system-trash"); await submit("system-trash");
    const second = await captured(2); assert.equal(second.status, 200, JSON.stringify(second));
    recycledItems.push(second.body.recycledPath); report.systemTrash.recycledPaths.push(second.body.recycledPath);
    await wait(`!app.vault.getFileByPath(${JSON.stringify(menuFile)})`, "binary removed"); await settle();
    assert.deepEqual(await readFile(second.body.recycledPath), menuBytes); assert.equal(await exists(abs(".trash")), false);
    assert.deepEqual(await readFile(abs("Keep.md")), keepBytes);
    await restore(second.body.recycledPath, menuFile); assert.deepEqual(await readFile(abs(menuFile)), menuBytes);
    pass("The Files context menu Move to system trash recycles opaque binary bytes exactly, leaves neighbours untouched and restores through the Shell.");

    // Folder with an external change observed before confirmation.
    await evaluate('globalThis.folderEvents=[];app.vault.on("modify",file=>globalThis.folderEvents.push(file.path));true');
    await openAction(dir, "system-trash");
    const changed = Buffer.from("# A changed outside\r\n"); await writeFile(abs(aPath), changed);
    await wait(`globalThis.folderEvents.includes(${JSON.stringify(aPath)})`, "external folder change observed");
    const before = await tree(abs(dir));
    await submit("system-trash");
    const third = await captured(3); assert.equal(third.status, 200, JSON.stringify(third));
    recycledItems.push(third.body.recycledPath); report.systemTrash.recycledPaths.push(third.body.recycledPath);
    await wait(`!app.vault.getFolderByPath(${JSON.stringify(dir)})`, "folder removed"); await settle();
    assert.equal(await exists(abs(dir)), false); assert.equal(await exists(abs(".trash")), false);
    assert.deepEqual(await tree(third.body.recycledPath), before, "the recycled folder holds every descendant byte");
    assert.equal(await evaluate("document.querySelector('#client-errors').textContent"), "");
    await capture("folder-recycled");
    await restore(third.body.recycledPath, dir);
    assert.deepEqual(await tree(abs(dir)), before);
    pass("The Files context menu Move folder to system trash recycles the whole folder with every descendant byte (including the externally changed file), no vault .trash, then the exact captured folder item restores with an identical tree.");

    // Restart persistence.
    await evaluate("app.workspace.flushLayout()"); await restart();
    await wait('app.workspace.getLeafById("st-explorer")?.view.getViewType()==="file-explorer"&&!app.core.busy', "restored Files pane");
    assert.equal(await evaluate(`[${JSON.stringify(note)},${JSON.stringify(menuFile)},${JSON.stringify(aPath)}].every(path=>Boolean(app.vault.getFileByPath(path)))`), true);
    pass("After a full restart the restored note, binary and folder tree are present in the vault.");

    // Local option still uses the vault .trash.
    await hook(); await chooseTrash("local");
    await evaluate(`app.workspace.getLeaf().openFile(app.vault.getFileByPath(${JSON.stringify(cmdFile)}))`);
    await wait(`app.workspace.activeLeaf?.view?.file?.path===${JSON.stringify(cmdFile)}`, "command target open");
    await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open', "command palette");
    await command("Input.insertText", { text: "Move current file to trash" }); await click('[data-command-id="file-explorer:trash-file"]');
    await wait('Boolean(document.querySelector("[data-file-dialog=trash]"))', "vault-trash dialog"); await submit("trash");
    await wait(`!app.vault.getFileByPath(${JSON.stringify(cmdFile)})`, "file moved locally"); await settle();
    assert.deepEqual(await readFile(abs(".trash/Cmd.md")), cmdBytes);
    assert.equal(await evaluate("(globalThis.systemTrashResponses??[]).length"), 0, "local trash sends no system-trash request");
    pass("With Deleted files = local the same command still moves the file into the vault .trash and makes no Recycle Bin request.");
    report.systemTrash.boundaries.push("Dirty-view closing refusal and lost-acknowledgement outcomes are proven by the client/native tests, not by this GUI run.");
    report.systemTrash.boundaries.push("Restore uses the Shell 'undelete' verb on the exact captured item (Shell.Application namespace); the Explorer window itself is not driven or enumerated.");
  } finally {
    for (const path of [...recycledItems]) { await removeOwnedItem(path).catch(() => {}); }
  }
}

export async function checkSystemTrashRefusal({ directory, evaluate, wait, report, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const path = "Refusal/Keep.md", bytes = "Standalone refusal keeps this.\r\n";
  await evaluate(`(async()=>{await app.vault.createFolder("Refusal").catch(()=>{});await app.vault.create(${JSON.stringify(path)},${JSON.stringify(bytes)});return true})()`);
  await wait(`Boolean(app.vault.getFileByPath(${JSON.stringify(path)}))`, "refusal fixture");
  assert.equal(await evaluate("app.vault.supportsSystemTrash"), false);
  const message = await evaluate(`(async()=>{try{await app.vault.trash(app.vault.getFileByPath(${JSON.stringify(path)}),true);return "accepted"}catch(error){return String(error.message??error)}})()`);
  assert.match(message, /system trash|Recycle|not supported|native/i, message);
  const folderMessage = await evaluate(`(async()=>{try{await app.vault.trash(app.vault.getFolderByPath("Refusal"),true);return "accepted"}catch(error){return String(error.message??error)}})()`);
  assert.match(folderMessage, /system trash|Recycle|not supported|native/i, folderMessage);
  assert.equal(await evaluate(`app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))`), bytes);
  assert.equal(await evaluate("document.querySelector('#client-errors').textContent"), "");
  await capture("refusal");
  pass("A standalone browser/WASM vault reports system trash unsupported for files and folders and deletes nothing: the note keeps its exact bytes.");
  void directory;
}
