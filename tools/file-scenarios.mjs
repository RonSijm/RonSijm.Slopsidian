import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkFileOperations({ directory, evaluate, command, click, press, wait, afterReload, restart, report }) {
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const dialog = action => action === "actions" ? '[data-file-menu="actions"]' : `[data-file-dialog="${action}"]`;
  const input = '[data-file-field="path"]';
  const source = "File workflows/Source.md";
  const renamed = "File workflows/Archive/Renamed.md";
  const finalPath = "File workflows/Archive/renamed.md";
  const reference = "File workflows/References.md";
  const binary = "File workflows/Asset.bin";
  const movedBinary = "File workflows/Attachments/Asset moved.bin";
  const bytes = content => Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(content)]);
  const sourceText = [
    "---", 'related: "[[Companion#Heading|Companion property]]"', "precise: 9007199254740993 # exact", "---",
    "# Source", "", "A stable paragraph. ^source-id", "",
    '[Companion](./Companion.md#Heading "Preserve title") [[Source#Source|Self caption]] [[Asset.bin|Attachment]]', "",
    "An unmarked paragraph to bookmark.", "",
  ].join("\r\n");
  const referenceText = [
    "---", 'related: "[[Source#^source-id|Property caption]]"', "precise: 0.1234567890123456789 # exact", "---", "",
    '[[Source#Source|Wiki caption]] [Markdown caption](Source.md#Source "Keep title")', "",
    "[One][shared] and [Two][shared].", "", '[shared]: ./Source.md#^source-id "Reference title"', "",
    "`[[Source]]` and plain Source must not change.", "",
  ].join("\r\n");
  const binaryBytes = Buffer.from([239, 187, 191, 0, 255, 128, 13, 10, 1]);
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => {
    if (error.code !== "ENOENT") { throw error; }
    return null;
  });
  async function fill(selector, text) {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text });
  }
  async function submit(action) {
    await click(`${dialog(action)} [data-file-action="${action}"]`);
    await wait(`!app.workspace.isChangingFiles&&(!document.querySelector(${JSON.stringify(dialog(action))})||document.querySelector('${dialog(action)} [role="alert"]')?.textContent)`, action + " completed");
    assert.equal(await evaluate(`document.querySelector('${dialog(action)} [role="alert"]')?.textContent??""`), "", action + " must commit without a visible error");
    await evaluate("app.workspace.whenIdle()");
  }
  async function rightClick(path) {
    await click('[data-sidebar-view="file-explorer"]');
    const selector = `[data-note-path="${path}"]`;
    const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error("File is absent from the actual tree");el.scrollIntoView({block:"center"});const b=el.getBoundingClientRect();if(!b.height||!b.width)throw new Error("File is not visible in the actual tree");return{x:b.left+b.width/2,y:b.top+b.height/2}})()`);
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "right", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "right", clickCount: 1 });
    await wait(`Boolean(document.querySelector('${dialog("actions")}'))`, "actual tree context actions");
  }
  async function renameUsingDialog(path) {
    await press("F2", "F2", 113);
    await wait(`Boolean(document.querySelector('${dialog("rename")}'))`, "F2 rename dialog");
    await fill(input, path);
    await submit("rename");
  }
  await click('[data-sidebar-view="file-explorer"]');
  await click("#new-folder");
  await fill(input, "File workflows/Empty/Nested");
  await submit("folder");
  assert.ok((await readdir(join(directory, "File workflows", "Empty"))).includes("Nested"));
  assert.equal(await evaluate('Boolean(app.vault.getFolderByPath("File workflows/Empty/Nested"))'), true);
  await click("#new-folder");
  await fill(input, "File workflows/Empty/Nested");
  await click(`${dialog("folder")} [data-file-action="folder"]`);
  await wait(`Boolean(document.querySelector('${dialog("folder")} [role="alert"]')?.textContent)&&!app.workspace.isChangingFiles`, "folder collision rejection");
  assert.match(await evaluate(`document.querySelector('${dialog("folder")} [role="alert"]').textContent`), /already exists/);
  await click(`${dialog("folder")} [data-file-action="cancel"]`);
  await evaluate('app.fileManager.openActions("/")');
  await click(`${dialog("actions")} [data-file-action="folder"]`);
  assert.equal(await evaluate(`document.querySelector('${dialog("folder")} ${input}').value`), "", "The native-shaped root must not become an absolute folder prefix");
  await fill(input, "File workflows/Root menu");
  await submit("folder");
  assert.deepEqual(await readdir(join(directory, "File workflows", "Root menu")), []);
  assert.equal(await evaluate('app.vault.getFolderByPath("File workflows").parent===app.vault.getRoot()'), true);
  pass("The actual file explorer and native-shaped root actions create nested empty folders, retain root identity and reject occupied paths without replacing them or prefilling an absolute root.");

  await writeFile(join(directory, source), bytes(sourceText));
  await writeFile(join(directory, reference), bytes(referenceText));
  await writeFile(join(directory, binary), binaryBytes);
  await writeFile(join(directory, "File workflows", "Companion.md"), "# Heading\r\n\r\nKeep the companion note.\r\n");
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(source)});globalThis.fileFlow={file:app.vault.getFileByPath(${JSON.stringify(source)}),sourceLeaf:app.workspace.activeLeaf,events:[],refs:[]};for(const name of ["rename","create","modify","delete"])fileFlow.refs.push(app.vault.on(name,(file,old)=>{if(file.path.startsWith("File workflows/"))fileFlow.events.push({name,path:file.path,old,same:file===fileFlow.file,sessionPath:app.workspace.sessions.get(file.path)?.document.file.path})}));return true})()`);
  await press("F2", "F2", 113);
  await fill(input, renamed);
  await click(`${dialog("rename")} [data-file-action="cancel"]`);
  assert.deepEqual(await readFile(join(directory, source)), bytes(sourceText));
  assert.equal(await evaluate(`app.vault.getFileByPath(${JSON.stringify(source)})===fileFlow.file`), true);
  await press("F2", "F2", 113);
  await fill(input, "File workflows/Companion.md");
  await click(`${dialog("rename")} [data-file-action="rename"]`);
  await wait(`Boolean(document.querySelector('${dialog("rename")} [role="alert"]')?.textContent)&&!app.workspace.isChangingFiles`, "rename collision rejection");
  assert.match(await evaluate(`document.querySelector('${dialog("rename")} [role="alert"]').textContent`), /already exists/);
  await click(`${dialog("rename")} [data-file-action="cancel"]`);
  assert.deepEqual(await readFile(join(directory, source)), bytes(sourceText));
  assert.deepEqual(await readFile(join(directory, reference)), bytes(referenceText));
  assert.deepEqual(await evaluate("fileFlow.events.filter(event=>event.name==='rename')"), []);
  pass("Real rename cancellation and destination collisions retain source/reference bytes, file identity and public event state.");

  await evaluate('fileFlow.originalInfo=app.vault.getFileInfo;app.vault.getFileInfo=()=>new Promise((resolve,reject)=>{fileFlow.rejectInfo=()=>{app.vault.getFileInfo=fileFlow.originalInfo;reject(new Error("Expected pending file operation failure"))}});true');
  await press("F2", "F2", 113);
  await fill(input, renamed);
  await click(`${dialog("rename")} [data-file-action="rename"]`);
  await wait('typeof fileFlow.rejectInfo==="function"&&app.workspace.isChangingFiles', "pending file operation");
  await press("Escape", "Escape", 27);
  await click(`${dialog("rename")} .modal-close-button`);
  assert.equal(await evaluate(`Boolean(document.querySelector('${dialog("rename")}'))`), true, "A pending operation cannot dismiss its error destination");
  await evaluate("fileFlow.rejectInfo();true");
  await wait(`Boolean(document.querySelector('${dialog("rename")} [role="alert"]')?.textContent)&&!app.workspace.isChangingFiles`, "visible pending-operation failure");
  assert.match(await evaluate(`document.querySelector('${dialog("rename")} [role="alert"]').textContent`), /Expected pending file operation failure/);
  await click(`${dialog("rename")} [data-file-action="cancel"]`);
  assert.deepEqual(await readFile(join(directory, source)), bytes(sourceText));
  pass("Pending file mutations cannot be dismissed with Escape or the dialog close button; a later failure stays visible and retains the source bytes.");

  await evaluate(`(async()=>{await app.commands.execute("bookmarks:open");app.core.getEnabledPluginById("bookmarks").editDialog(undefined,{type:"file",path:${JSON.stringify(source)},subpath:"#Source",title:"File rename target"})})()`);
  await click('[data-core-dialog="bookmarks"] [data-bookmark-action="save"]');
  await wait('!document.querySelector(\'[data-core-dialog="bookmarks"]\')&&!app.core.getEnabledPluginById("bookmarks").busy', "file bookmark saved");
  await evaluate('app.workspace.revealLeaf(fileFlow.sourceLeaf)');
  await evaluate('app.editor.setCursor({line:10,ch:5});app.commands.execute("bookmarks:bookmark-current-section")');
  assert.equal(await evaluate('document.querySelector(\'[data-bookmark-field="target"]\').value'), source);
  const generatedSubpath = await evaluate('document.querySelector(\'[data-bookmark-field="subpath"]\').value');
  assert.match(generatedSubpath, /^#\^[a-f0-9]{6}$/);
  await fill('[data-bookmark-field="title"]', "Generated block target");
  await click('[data-core-dialog="bookmarks"] [data-bookmark-action="save"]');
  await wait('!document.querySelector(\'[data-core-dialog="bookmarks"]\')&&!app.core.getEnabledPluginById("bookmarks").busy', "generated block bookmark saved");
  assert.ok((await readFile(join(directory, source), "utf8")).includes("An unmarked paragraph to bookmark. " + generatedSubpath.slice(1)));
  await evaluate(`(async()=>{await app.workspace.revealLeaf(fileFlow.sourceLeaf);await app.openFile(${JSON.stringify(reference)},"tab");fileFlow.referenceLeaf=app.workspace.activeLeaf;await app.workspace.revealLeaf(fileFlow.sourceLeaf);fileFlow.second=await app.workspace.duplicateLeaf(fileFlow.sourceLeaf,"split");await app.commands.execute("properties:open-local")})()`);
  if (await evaluate('Boolean(app.workspace.getLeavesOfType("file-properties")[0].getViewState().state.file)')) {
    await click('[data-type="file-properties"] [aria-label="Pin or follow file properties"]');
  }
  await click('[data-type="file-properties"] [aria-label="Pin or follow file properties"]');
  await evaluate('app.commands.execute("outgoing-links:open-for-current")');
  await evaluate('app.commands.execute("backlink:open-backlinks")');
  await evaluate('app.workspace.revealLeaf(fileFlow.sourceLeaf)');
  await evaluate('app.editor.replaceRange("An unsaved body edit.\\r\\n",{line:app.editor.lastLine(),ch:0});app.editor.setSelection({line:10,ch:3},{line:10,ch:11});fileFlow.second.view.setMode("preview");true');
  await renameUsingDialog(renamed);
  assert.equal(await evaluate(`app.vault.getFileByPath(${JSON.stringify(renamed)})===fileFlow.file&&app.workspace.sessions.get(${JSON.stringify(renamed)})===fileFlow.sourceLeaf.session&&fileFlow.second.view.file===fileFlow.file&&fileFlow.second.view.getMode()==="preview"`), true);
  assert.equal(await evaluate("fileFlow.sourceLeaf.view.editor.getSelection()"), "unmarked", "Reference edits before the cursor must map the selection to the same unchanged body text");
  assert.match(await evaluate("fileFlow.referenceLeaf.session.text"), /\[\[File workflows\/Archive\/Renamed#Source\|Wiki caption\]\]/);
  assert.equal(await evaluate(`app.workspace.getLeavesOfType("file-properties")[0].getViewState().state.file`), renamed);
  for (const id of ["outgoing-link", "backlink"]) {
    assert.equal(await evaluate(`app.workspace.getViewOptions(${JSON.stringify(id)}).file`), renamed);
  }
  const movedText = await readFile(join(directory, renamed), "utf8");
  assert.ok(movedText.startsWith("\ufeff"));
  assert.match(movedText, /precise: 9007199254740993 # exact/);
  assert.match(movedText, /\[Companion\]\(\.\.\/Companion\.md#Heading "Preserve title"\)/);
  assert.match(movedText, /An unsaved body edit\.\r\n/);
  const rewritten = await readFile(join(directory, reference), "utf8");
  assert.match(rewritten, /precise: 0.1234567890123456789 # exact/);
  assert.match(rewritten, /related: "\[\[File workflows\/Archive\/Renamed#\^source-id\|Property caption\]\]"/);
  assert.match(rewritten, /\[Markdown caption\]\(\.\/Archive\/Renamed\.md#Source "Keep title"\)/);
  assert.match(rewritten, /\[shared\]: \.\/Archive\/Renamed\.md#%5Esource-id "Reference title"/);
  assert.ok(rewritten.includes("`[[Source]]` and plain Source must not change."));
  assert.ok(!/(?<!\r)\n/.test(movedText + rewritten));
  const renameEvents = await evaluate("fileFlow.events.filter(event=>event.name==='rename')");
  assert.deepEqual(renameEvents, [{ name: "rename", path: renamed, old: source, same: true, sessionPath: renamed }]);
  assert.equal(await evaluate(`fileFlow.events.some(event=>["create","delete"].includes(event.name))`), false);
  assert.equal(await evaluate(`app.workspace.leaves().some(leaf=>leaf.history.some(state=>state.type==="markdown"&&state.state?.file===${JSON.stringify(source)}))`), false);
  pass("Rename/move preserves the actual TFile, shared sessions, Reading mode, pinned discovery/Properties panes and history while saving dirty text and rewriting real wiki/Markdown/reference/property links without changing exact YAML numbers or CRLF/BOM.");

  await evaluate("app.workspace.revealLeaf(fileFlow.sourceLeaf)");
  await renameUsingDialog(finalPath);
  assert.equal(await evaluate(`app.vault.getFileByPath(${JSON.stringify(finalPath)})===fileFlow.file&&fileFlow.file.name==="renamed.md"`), true);
  assert.ok((await readdir(join(directory, "File workflows", "Archive"))).includes("renamed.md"));
  assert.ok(!(await readdir(join(directory, "File workflows", "Archive"))).includes("Renamed.md"));
  const bookmarks = JSON.parse((await readFile(join(directory, ".obsidian", "bookmarks.json"), "utf8")).replace(/^\uFEFF/, ""));
  const bookmarkAddress = await evaluate(`app.core.getEnabledPluginById("bookmarks").entries().find(entry=>entry.item.title==="File rename target").address.join(".")`);
  const bookmark = await evaluate('app.core.getEnabledPluginById("bookmarks").getBookmarks().find(item=>item.title==="File rename target")');
  assert.equal(bookmark.path, finalPath);
  assert.equal(await evaluate('app.core.getEnabledPluginById("bookmarks").getBookmarks().find(item=>item.title==="Generated block target").subpath'), generatedSubpath);
  assert.ok(JSON.stringify(bookmarks).includes(finalPath));
  await evaluate('app.commands.execute("bookmarks:open")');
  await click(`[data-bookmark-address="${bookmarkAddress}"] [data-bookmark-action="open"]`);
  await wait(`app.current?.file.path===${JSON.stringify(finalPath)}&&app.editor.getCursor().line===4`, "renamed bookmark opens its heading");
  pass("Bookmarking an unmarked paragraph generates and saves a real block ID; a Windows case-only rename updates physical filenames and persists both heading and generated-block targets.");

  await rightClick(binary);
  await click(`${dialog("actions")} [data-file-action="rename"]`);
  await fill(input, movedBinary);
  await submit("rename");
  assert.deepEqual(await readFile(join(directory, movedBinary)), binaryBytes);
  assert.match(await readFile(join(directory, finalPath), "utf8"), /\[\[File workflows\/Attachments\/Asset moved\.bin\|Attachment\]\]/);
  await rightClick(movedBinary);
  await click(`${dialog("actions")} [data-file-action="trash"]`);
  await click(`${dialog("trash")} [data-file-action="cancel"]`);
  assert.deepEqual(await readFile(join(directory, movedBinary)), binaryBytes);
  await mkdir(join(directory, ".trash", "Asset moved.bin"), { recursive: true });
  await rightClick(movedBinary);
  await click(`${dialog("actions")} [data-file-action="trash"]`);
  await submit("trash");
  const trashed = (await readdir(join(directory, ".trash"))).find(name => name !== "Asset moved.bin" && name.startsWith("Asset moved") && name.endsWith(".bin"));
  assert.ok(trashed, "Trash chooses a free filename instead of replacing a preexisting folder");
  assert.deepEqual(await readFile(join(directory, ".trash", trashed)), binaryBytes);
  assert.equal(await evaluate(`app.vault.getFileByPath(${JSON.stringify(movedBinary)})`), null);
  pass("Disabled attachment previews still expose real tree actions: binary move retains every byte and updates references; cancelled trash changes nothing and committed vault trash preserves a colliding folder.");

  const trashNote = "File workflows/Trash me.md";
  await writeFile(join(directory, trashNote), bytes("# Trash candidate\r\n\r\nSaved text.\r\n"));
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(trashNote)},"tab");globalThis.trashFlow={first:app.workspace.activeLeaf,view:app.workspace.activeLeaf.view};trashFlow.second=await app.workspace.duplicateLeaf(trashFlow.first,"split");trashFlow.secondView=trashFlow.second.view;trashFlow.originalClose=trashFlow.secondView.onBeforeClose;trashFlow.secondView.onBeforeClose=()=>{throw new Error("Expected file trash close veto")};await app.workspace.revealLeaf(trashFlow.first);app.editor.replaceRange("User text before trash.\\r\\n",{line:app.editor.lastLine(),ch:0});return true})()`);
  await click("#file-actions");
  await click(`${dialog("actions")} [data-file-action="trash"]`);
  await click(`${dialog("trash")} [data-file-action="trash"]`);
  await wait(`Boolean(document.querySelector('${dialog("trash")} [role="alert"]')?.textContent)&&!app.workspace.isChangingFiles`, "file close veto before trash");
  assert.match(await evaluate(`document.querySelector('${dialog("trash")} [role="alert"]').textContent`), /Expected file trash close veto/);
  assert.equal(await evaluate('trashFlow.first.view===trashFlow.view&&trashFlow.second.view===trashFlow.secondView&&trashFlow.first.session===trashFlow.second.session&&trashFlow.view.isLoaded&&trashFlow.secondView.isLoaded'), true);
  assert.match(await readFile(join(directory, trashNote), "utf8"), /User text before trash\.\r\n/);
  await click(`${dialog("trash")} [data-file-action="cancel"]`);
  await evaluate("app.workspace.revealLeaf(trashFlow.first)");
  await evaluate("trashFlow.first.view.editor.focus()");
  await press("z", "KeyZ", 90, 2);
  await wait('!trashFlow.first.view.editor.getValue().includes("User text before trash.")', "failed trash retains original undo history");
  await press("y", "KeyY", 89, 2);
  await wait('trashFlow.first.view.editor.getValue().includes("User text before trash.")', "failed trash retains redo history");
  await evaluate("trashFlow.secondView.onBeforeClose=trashFlow.originalClose;true");
  await click("#file-actions");
  await click(`${dialog("actions")} [data-file-action="trash"]`);
  await submit("trash");
  assert.equal(await evaluate(`app.workspace.sessions.has(${JSON.stringify(trashNote)})||app.workspace.leaves().some(leaf=>leaf.view.file?.path===${JSON.stringify(trashNote)})`), false);
  assert.match(await readFile(join(directory, ".trash", "Trash me.md"), "utf8"), /User text before trash\.\r\n/);
  pass("Trash saves dirty shared notes, honors a later pane's explicit preflight veto before disposing any editor, preserves undo/redo after rejection, and closes all associated sessions only when the note is actually trashed.");

  await evaluate("fileFlow.refs.forEach(ref=>ref.emitter.offref(ref));app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.equal(await evaluate(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${JSON.stringify(finalPath)}).length`), 2);
  assert.equal(await evaluate(`app.workspace.getLeavesOfType("file-properties")[0].getViewState().state.file`), finalPath);
  await evaluate('app.commands.execute("bookmarks:open")');
  await click(`[data-bookmark-address="${bookmarkAddress}"] [data-bookmark-action="open"]`);
  await wait(`app.current?.file.path===${JSON.stringify(finalPath)}`, "renamed bookmark survives fresh runtime");
  assert.match(await evaluate('app.core.getEnabledPluginById("bookmarks").openBookmark({type:"file",path:"File workflows/Missing.md"}).then(()=>"unexpected success",error=>error.message)'), /missing/);
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  if (report.coreChecks) {
    for (const id of ["file-explorer:file-operations", "bookmarks:resolve"]) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate file workflow observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  }
  pass("Renamed files, split sessions, pinned properties and updated bookmarks reopen after a fresh runtime without changing original workspace.json; missing targets still reject explicitly.");
}
