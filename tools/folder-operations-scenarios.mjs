import assert from "node:assert/strict";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Drives the real Files explorer context menu and dialogs against a disposable vault. The same scenario runs on
// desktop (native host) and on a writable actual-folder WASM session.
export async function checkFolderOperations({ directory, evaluate, command, click, press, wait, report, restart, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const lib = "Lib", docs = lib + "/Docs", deep = lib + "/Deep", moved = "Archive/Lib2";
  const aPath = docs + "/a.md", bPath = docs + "/b.md", binPath = deep + "/data.bin", emptyPath = lib + "/Empty";
  const aBytes = Buffer.from("\ufeff# A\r\n\r\n[[Outside#Head]] [Up](../../Outside.md) [[b#^blk]]\r\n");
  const bBytes = Buffer.from("# B\n\nTarget paragraph ^blk\n");
  const binBytes = Buffer.from([0, 255, 1, 254, 0, 13, 10, 0x1a, 0xc3, 0x28]);
  const outsideBytes = Buffer.from("# Head\n\n[[Lib/Docs/a]] [[Lib/Docs/b#^blk]] ![[Lib/Deep/data.bin]]\n");
  const sha = bytes => import("node:crypto").then(({ createHash }) => createHash("sha256").update(bytes).digest("hex"));
  const exists = path => stat(join(directory, path)).then(() => true, () => false);
  const originalPath = join(directory, ".obsidian/workspace.json"), savedPath = join(directory, ".obsidian/vault-dotnet-workspace.json");

  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  await mkdir(join(directory, docs), { recursive: true }); await mkdir(join(directory, deep), { recursive: true });
  await mkdir(join(directory, emptyPath), { recursive: true }); await mkdir(join(directory, "Taken"), { recursive: true });
  await writeFile(join(directory, aPath), aBytes); await writeFile(join(directory, bPath), bBytes);
  await writeFile(join(directory, binPath), binBytes); await writeFile(join(directory, "Outside.md"), outsideBytes);
  await writeFile(join(directory, "Taken/keep.md"), "keep\n");

  const explorer = { id: "fo-explorer", type: "leaf", pinned: true, state: { type: "file-explorer", state: { sortOrder: "alphabetical" } } };
  const layout = { main: { id: "fo-main", type: "split", direction: "vertical", children: [
    { id: "fo-explorer-tabs", type: "tabs", dimension: 40, children: [explorer] },
    { id: "fo-note-tabs", type: "tabs", dimension: 60, children: [{ id: "fo-note", type: "leaf", state: { type: "markdown", state: { file: aPath, mode: "source", source: true } } }] },
  ] }, active: "fo-note", left: { id: "fo-left", type: "split", direction: "horizontal", width: 260, collapsed: true, children: [] }, right: { id: "fo-right", type: "split", direction: "horizontal", width: 240, collapsed: true, children: [] } };
  const layoutBytes = Buffer.from(JSON.stringify(layout, null, 2));
  const boot = async () => {
    await restart(async () => { await writeFile(originalPath, layoutBytes); await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } }); });
    await wait('app.workspace.getLeafById("fo-explorer")?.view.getViewType()==="file-explorer"&&app.workspace.getLeafById("fo-note")?.view.editor&&!app.core.busy&&!app.workspace.isChangingFiles', "Files pane and open note");
  };
  const pane = '[data-file-explorer="fo-explorer"]';
  const row = path => `${pane} [data-explorer-path=${JSON.stringify(path)}]`;
  const listen = () => evaluate('globalThis.folderEvents=[];for(const name of ["create","modify","rename","delete"])app.vault.on(name,(file,old)=>globalThis.folderEvents.push([name,file.path,old??null]));true');
  const events = () => evaluate("globalThis.folderEvents");
  const openAction = async (path, action) => {
    await evaluate(`document.querySelector(${JSON.stringify(row(path))}).focus()`); await press("F10", "F10", 121, 8);
    await wait(`Boolean(document.querySelector('[data-file-menu=actions] [data-file-action=${action}]'))`, "file actions menu");
    await click(`[data-file-menu=actions] [data-file-action=${action}]`); await wait(`Boolean(document.querySelector('[data-file-dialog=${action}]'))`, action + " dialog");
  };
  const fill = async text => { await click("[data-file-field=path]"); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text }); };
  const submit = action => click(`[data-file-dialog=${action}] button[type=submit]`);
  const dialogError = () => evaluate('document.querySelector("[data-file-dialog] [role=alert]")?.textContent??""');
  const settle = () => wait("!app.workspace.isChangingFiles&&!app.changingVault", "file operation settles");
  const tree = async path => { const out = []; const walk = async (relative) => { for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) { const child = relative + "/" + entry.name; if (entry.isDirectory()) { out.push(child + "/"); await walk(child); } else { out.push(child); } } }; await walk(path); return out.sort(); };

  await boot(); await listen();
  assert.equal(await evaluate("app.vault.readOnly"), false, "folder operations need a writable vault");
  await wait(`Boolean(document.querySelector(${JSON.stringify(row(lib))}))`, "Lib folder row");
  pass("A disposable writable vault opens a real pinned Files pane beside a Source note inside the folder under test.");

  // Exercise the public plugin method, not just binary bytes carried by a folder move.
  const changedBinary = Buffer.from([255, 0, 254, 1, 128, 13, 10, 0, 42]);
  await evaluate(`app.vault.modifyBinary(app.vault.getFileByPath(${JSON.stringify(binPath)}),Uint8Array.from(${JSON.stringify([...changedBinary])}).buffer)`);
  assert.deepEqual(await readFile(join(directory, binPath)), changedBinary);
  assert.deepEqual(await evaluate(`(async()=>Array.from(new Uint8Array(await app.vault.readBinary(app.vault.getFileByPath(${JSON.stringify(binPath)})))))()`), [...changedBinary]);
  await wait(`globalThis.folderEvents.some(e=>e[0]==="modify"&&e[1]===${JSON.stringify(binPath)})`, "binary modification event");

  // Hold the actual version-read boundary, then replace the real file externally before the guarded PUT.
  await evaluate(`(()=>{
    const trace=globalThis.binaryMutationTrace={held:false,armed:true,path:${JSON.stringify(binPath)}};
    const pause=async()=>{trace.held=true;await new Promise(resolve=>trace.release=resolve)};
    if(document.body.classList.contains("is-browser")){
      const subtle=crypto.subtle,original=subtle.digest;
      subtle.digest=async function(algorithm,data){
        const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
        const result=original.call(this,algorithm,data);
        if(trace.armed&&JSON.stringify(Array.from(bytes))===${JSON.stringify(JSON.stringify([...changedBinary]))}){trace.armed=false;await pause()}
        return result;
      };
      trace.restore=()=>{subtle.digest=original};
    }else{
      const original=window.fetch;
      window.fetch=async function(input,options){const response=await original.call(this,input,options),url=new URL(String(input?.url??input),location.href);
        if(trace.armed&&url.pathname==="/api/binary"&&url.searchParams.get("path")===trace.path&&(!options?.method||options.method==="GET")){trace.armed=false;await pause()}
        return response;
      };
      trace.restore=()=>{window.fetch=original};
    }
    trace.promise=app.vault.modifyBinary(app.vault.getFileByPath(trace.path),Uint8Array.of(9,8,7).buffer).then(()=>({accepted:true}),error=>({accepted:false,message:error.message,status:error.status}));
    return true;
  })()`);
  const externalBinary = Buffer.from([3, 0, 255, 7, 0, 128, 10, 13, 91, 92, 93]);
  let conflict;
  try {
    await wait("globalThis.binaryMutationTrace.held", "real binary version read held");
    await writeFile(join(directory, binPath), externalBinary);
    await evaluate("binaryMutationTrace.release()");
    conflict = await evaluate("binaryMutationTrace.promise");
  } finally { await evaluate("(()=>{const trace=globalThis.binaryMutationTrace;trace.release?.();trace.restore();return true})()"); }
  assert.equal(conflict.accepted, false);
  assert.match(conflict.message, /409|changed|conflict/i);
  assert.deepEqual(await readFile(join(directory, binPath)), externalBinary, "A stale binary write must preserve the external replacement");
  await restart(); await listen();
  assert.deepEqual(await readFile(join(directory, binPath)), externalBinary);
  assert.deepEqual(await evaluate(`(async()=>Array.from(new Uint8Array(await app.vault.readBinary(app.vault.getFileByPath(${JSON.stringify(binPath)})))))()`), [...externalBinary]);
  await evaluate(`app.vault.modifyBinary(app.vault.getFileByPath(${JSON.stringify(binPath)}),Uint8Array.from(${JSON.stringify([...binBytes])}).buffer)`);
  assert.deepEqual(await readFile(join(directory, binPath)), binBytes);
  report.binaryMutation = { publicMethod: true, exactReadWrite: true, modifyEvent: true, staleVersionRefused: true, externalBytesSurviveRestart: true, versionReadHoldFixture: true };
  pass("Public Vault.modifyBinary writes and reads exact bytes with a real modify event; a held version read followed by a real external replacement refuses the stale write, and the external bytes survive full restart/reconnect.");

  // Root and nested/collision refusals through the real dialog.
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("fo-note"));app.workspace.activeLeaf.view.focus()');
  await command("Input.insertText", { text: "Dirty " });
  const dirty = await evaluate('app.workspace.getLeafById("fo-note").view.editor.getValue()');
  assert.ok(dirty.includes("Dirty "));
  await openAction(lib, "rename"); await fill("Taken"); await submit("rename");
  await wait("Boolean(document.querySelector('[data-file-dialog] [role=alert]')?.textContent)", "collision message");
  assert.match(await dialogError(), /exist|already|collision|overwrit/i);
  assert.deepEqual(await readFile(join(directory, bPath)), bBytes); assert.equal(await exists(lib), true);
  await fill(lib + "/Docs/Inside"); await submit("rename");
  await wait("Boolean(document.querySelector('[data-file-dialog] [role=alert]')?.textContent)", "nesting message");
  assert.equal(await exists(lib + "/Docs/Inside"), false);
  assert.equal(await evaluate('app.workspace.getLeafById("fo-note").view.editor.getValue()'), dirty);
  await click("[data-file-dialog] [data-file-action=cancel]"); await wait("!document.querySelector('[data-file-dialog]')", "dialog closed");
  assert.equal(await evaluate("app.vault.getRoot().path"), "/");
  await assert.rejects(evaluate("(async()=>{try{await app.fileManager.deleteFile(app.vault.getRoot());return 'accepted'}catch(error){throw new Error(String(error.message))}})()"), /root|vault/i);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-file-menu=actions] [data-file-action=delete]"))'), false);
  pass("The real dialog refuses collisions and self-nesting with the vault and the dirty open editor unchanged; the vault root cannot be deleted.");

  // Rename and move with a dirty open descendant, exact bytes and link rewriting.
  const before = { b: await sha(bBytes), bin: await sha(binBytes) };
  await openAction(lib, "rename"); await fill(moved); await submit("rename");
  await wait(`app.vault.getFolderByPath(${JSON.stringify(moved)})&&!app.vault.getFolderByPath(${JSON.stringify(lib)})`, "moved folder");
  await settle();
  const movedA = moved + "/Docs/a.md", movedB = moved + "/Docs/b.md", movedBin = moved + "/Deep/data.bin";
  assert.equal(await exists(lib), false);
  assert.deepEqual(await tree(moved), ["Docs/", "Docs/a.md", "Docs/b.md", "Deep/", "Deep/data.bin", "Empty/"].map(entry => moved + "/" + entry).sort());
  assert.equal(await sha(await readFile(join(directory, movedB))), before.b); assert.equal(await sha(await readFile(join(directory, movedBin))), before.bin);
  const movedAText = await readFile(join(directory, movedA), "utf8");
  assert.ok(movedAText.startsWith("\ufeff") && movedAText.includes("# A\r\n\r\n") && !movedAText.replace(/\r\n/g, "").includes("\n"), "BOM and CRLF are preserved in the moved dirty note: " + JSON.stringify(movedAText));
  assert.ok(movedAText.includes("Dirty "), "the dirty edit was saved before the move");
  assert.ok(movedAText.includes("[[Outside#Head]]") && (movedAText.includes("[[b#^blk]]") || movedAText.includes("[[" + moved + "/Docs/b#^blk]]")) && movedAText.includes("[Up](../../../Outside.md)"), "moved note links keep their destinations: " + movedAText);
  const outsideText = await readFile(join(directory, "Outside.md"), "utf8");
  assert.ok(outsideText.includes("[[" + moved + "/Docs/a]]") && outsideText.includes("[[" + moved + "/Docs/b#^blk]]") && outsideText.includes("![[" + moved + "/Deep/data.bin]]"), "outside links point to the moved targets: " + outsideText);
  assert.equal(await evaluate('app.workspace.getLeafById("fo-note").view.file.path'), movedA);
  assert.ok((await evaluate('app.workspace.getLeafById("fo-note").view.editor.getValue()')).includes("Dirty "));
  const moves = (await events()).filter(([name]) => name === "rename");
  for (const [from, to] of [[aPath, movedA], [bPath, movedB], [binPath, movedBin]]) { assert.equal(moves.filter(([, path, old]) => path === to && old === from).length, 1, "one rename event for " + to); }
  assert.equal(await evaluate("document.querySelector('#client-errors').textContent"), "");
  await capture("moved");
  pass("Renaming/moving a folder through the real menu and dialog saves the dirty open descendant first, keeps exact bytes (BOM, CRLF, binary, empty folder), remaps the open editor, rewrites links in moved and outside notes to the same targets and emits one rename event per file.");

  // Restart/reconnect keeps the result.
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  await restart();
  await wait('app.workspace.getLeafById("fo-explorer")?.view.getViewType()==="file-explorer"&&!app.core.busy', "restored Files pane");
  assert.equal(await evaluate('app.workspace.getLeafById("fo-note")?.view.file?.path'), movedA);
  assert.equal(await readFile(join(directory, movedA), "utf8"), movedAText); assert.equal(await readFile(join(directory, "Outside.md"), "utf8"), outsideText);
  assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${JSON.stringify(movedBin)}))&&!app.vault.getFolderByPath(${JSON.stringify(lib)})`), true);
  pass("After a full restart or reconnect the moved folder, remapped open note, rewritten links and byte-exact contents are all restored from the real vault.");

  // An external replacement made while the delete dialog is open is observed by the watcher (modify event), and the
  // deletion then removes exactly the refreshed, hash-verified bytes. Host-level stale refusal is covered by the unit tests.
  await listen();
  await openAction(moved, "delete");
  const external = Buffer.from("# B changed outside\n");
  await writeFile(join(directory, movedB), external);
  await wait(`globalThis.folderEvents.some(e=>e[0]==="modify"&&e[1]===${JSON.stringify(movedB)})`, "external replacement observed");
  await submit("delete");
  await wait(`!app.vault.getFolderByPath(${JSON.stringify(moved)})`, "folder deleted"); await settle();
  assert.equal(await exists(moved), false);
  assert.deepEqual(await readFile(join(directory, "Outside.md")), Buffer.from(outsideText));
  const all = await events(), deletes = all.filter(([name]) => name === "delete").map(([, path]) => path);
  for (const path of [movedA, movedB, movedBin, moved]) { assert.ok(deletes.includes(path), "delete event for " + path); }
  assert.ok(all.findIndex(([name, path]) => name === "modify" && path === movedB) < all.findIndex(([name]) => name === "delete"), "modify precedes the deletes");
  assert.equal(await evaluate('app.workspace.getLeavesOfType("markdown").every(leaf=>!leaf.view.file?.path?.startsWith("Archive"))'), true);
  assert.equal(await evaluate("document.querySelector('#client-errors').textContent"), "");
  assert.equal(await exists("Taken/keep.md"), true);
  await capture("deleted");
  pass("Permanent folder deletion after an external replacement observed by the watcher deletes exactly the refreshed verified descendants, closes the open note, emits modify then delete events and leaves unrelated notes and folders untouched.");

  await evaluate("app.workspace.flushLayout()"); await restart();
  await wait('app.workspace.getLeafById("fo-explorer")?.view.getViewType()==="file-explorer"&&!app.core.busy', "restored after deletion");
  assert.equal(await evaluate(`Boolean(app.vault.getFolderByPath(${JSON.stringify(moved)}))`), false);
  assert.deepEqual(await readFile(join(directory, "Outside.md")), Buffer.from(outsideText));
  pass("A second restart or reconnect confirms the deleted folder stays deleted and unrelated bytes are unchanged.");
}
