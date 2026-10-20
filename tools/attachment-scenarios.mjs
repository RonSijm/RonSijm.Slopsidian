import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pixel as makePixel } from "./reading-scenarios.mjs";
import { attachmentReadHoldScript } from "./attachment-read-fixture.mjs";

const pixel = makePixel(48, 32);

export async function checkAttachments({ directory, sourceDirectory = directory + "-import-sources", evaluate, command, click, press, wait, report, restart, afterReload, setClipboard, expectReloadBlocked, capture, browser = false }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); }, digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const folder = "Attachment notes", note = folder + "/Main.md", assets = folder + "/Assets", photo = "Photo [one] # 中文.png", importedPhoto = "Photo [one] # 中文 2.png";
  const editor = '.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]';
  const root = await evaluate("app.vault.rootPath");
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  await mkdir(sourceDirectory, { recursive: true }); await mkdir(join(directory, assets), { recursive: true }); await mkdir(join(directory, "Assets"), { recursive: true });
  const originalPhoto = Buffer.from("Existing attachment must remain.\0\xff"), opaque = Buffer.from([0, 255, 128, 13, 10, 99]);
  const sources = new Map([[photo, pixel], ["Opaque.bin", opaque], ["Policy.png", pixel], ["Drop.png", pixel], ["First.bin", opaque], ["Second.bin", Buffer.from([99, 0, 88])], ["Unconfirmed.bin", Buffer.from([44, 55, 66])], ["Stale.bin", Buffer.from([1, 2, 3])]]);
  for (const [name, bytes] of sources) { await writeFile(join(sourceDirectory, name), bytes); }
  await writeFile(join(directory, assets, photo), originalPhoto); await mkdir(join(directory, assets, "Photo [one] # 中文 1.png"));
  await writeFile(join(directory, "Assets", importedPhoto), Buffer.from("Wrong root-relative image must never be loaded."));
  let expected = "# Attachment note\r\n\r\nReplace this\r\n";
  await writeFile(join(directory, note), "\ufeff" + expected);
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  const oldSettings = JSON.parse((await readFile(join(directory, ".obsidian", "app.json"), "utf8").catch(error => { if (error.code !== "ENOENT") { throw error; } return "{}"; })).replace(/^\ufeff/, ""));
  assert.equal(oldSettings.markdownAutosave ?? true, true);
  await writeFile(join(directory, ".obsidian", "app.json"), "\ufeff" + JSON.stringify({ ...oldSettings, attachmentFolderPath: "./Assets", futureAttachmentFixture: { keep: [true, "中文"] } }) + "\r\n");
  await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh()})()');
  await evaluate(`app.openFile(${JSON.stringify(note)},true)`); await evaluate('app.markdownView.setEditingMode("source")');
  await wait('!document.querySelector("#attach-files").disabled', "attachment action available in the Markdown editor");
  await evaluate('app.editor.setSelection({line:2,ch:0},{line:2,ch:12})');
  await evaluate(`(()=>{globalThis.attachmentInputs=[];document.addEventListener("change",event=>{if(event.target.matches?.("[data-attachment-input]"))attachmentInputs.push({trusted:event.isTrusted,names:Array.from(event.target.files).map(file=>file.name)})},true)})()`);
  const choose = async names => {
    await command("Page.setInterceptFileChooserDialog", { enabled: true });
    await click("#attach-files");
    const { root: document } = await command("DOM.getDocument");
    const { nodeId } = await command("DOM.querySelector", { nodeId: document.nodeId, selector: "[data-attachment-input]" }); assert.ok(nodeId);
    await command("DOM.setFileInputFiles", { nodeId, files: names.map(name => join(sourceDirectory, name)) });
  };
  const idle = () => wait('!app.attachments.busy', "attachment import settled");
  const saved = () => wait('!app.workspace.hasUnsavedChanges&&!app.markdownAutosave.saving', "note automatically persisted");
  const exactNote = async (path = note) => { await saved(); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + expected)); };
  const atEnd = async () => { await click(editor); await press("End", "End", 35, 2); };
  const closeReview = async () => { await press("Escape", "Escape", 27); await wait('!document.querySelector("[data-attachment-review]")', "import review closed"); };
  await choose([photo, "Opaque.bin"]); await idle();
  const firstInsert = "![Photo \\[one\\] # 中文 2.png](./Assets/Photo%20%5Bone%5D%20%23%20%E4%B8%AD%E6%96%87%202.png)\r\n[Opaque.bin](./Assets/Opaque.bin)";
  expected = expected.replace("Replace this", firstInsert); await exactNote();
  assert.deepEqual(await readFile(join(directory, assets, importedPhoto)), pixel); assert.deepEqual(await readFile(join(directory, assets, "Opaque.bin")), opaque);
  assert.deepEqual(await readFile(join(directory, assets, photo)), originalPhoto);
  assert.deepEqual(await evaluate('attachmentInputs[0]'), { trusted: true, names: [photo, "Opaque.bin"] });
  pass("The actual Attach files action imports a browser-selected image and opaque binary bytes, chooses a name beyond existing file/folder collisions, replaces the selected text and autosaves exact BOM/CRLF/Unicode Markdown.");

  await press("z", "KeyZ", 90, 2); const beforeUndo = expected; expected = "# Attachment note\r\n\r\nReplace this\r\n"; await exactNote();
  assert.deepEqual(await readFile(join(directory, assets, importedPhoto)), pixel); assert.deepEqual(await readFile(join(directory, assets, "Opaque.bin")), opaque);
  await press("y", "KeyY", 89, 2); expected = beforeUndo; await exactNote();
  await evaluate('(async()=>{globalThis.attachmentFirstPane=app.workspace.activeLeaf;await app.workspace.getLeaf("split").openFile(app.vault.getFileByPath("Attachment notes/Main.md"));app.markdownView.setEditingMode("source")})()');
  await wait('(()=>{const leaves=app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.session?.document.file.path==="Attachment notes/Main.md");return leaves.length===2&&leaves.every(leaf=>leaf.session===app.workspace.activeLeaf.session&&leaf.view.editor.getValue()===app.editor.getValue())})()', "shared attachment document in two panes");
  pass("All inserted links undo and redo as one edit after autosave while imported files stay intact; two actual panes share the same session and text.");

  for (const [policy, path, markdown] of [["", "Policy.png", "![Policy.png](../Policy.png)"], ["Uploads", "Uploads/Policy.png", "![Policy.png](../Uploads/Policy.png)"], ["./", folder + "/Policy.png", "![Policy.png](./Policy.png)"]]) {
    await evaluate(`app.configuration.update("app",data=>{data.attachmentFolderPath=${JSON.stringify(policy)}})`);
    await atEnd(); await choose(["Policy.png"]); await idle(); expected += markdown; await exactNote(); assert.deepEqual(await readFile(join(directory, path)), pixel);
  }
  await evaluate('app.configuration.update("app",data=>{data.attachmentFolderPath="./Assets"})');
  const settingsBytes = await readFile(join(directory, ".obsidian", "app.json")); assert.deepEqual([...settingsBytes.subarray(0, 3)], [239, 187, 191]);
  assert.deepEqual(JSON.parse(settingsBytes.toString("utf8").replace(/^\ufeff/, "")).futureAttachmentFixture, { keep: [true, "中文"] });
  pass("Real imports honor root, configured-folder and note-relative placement, preserving the opaque app configuration and its BOM through explicit preference changes.");

  await evaluate(`(()=>{document.addEventListener("paste",event=>{const file=Array.from(event.clipboardData?.files??[]).find(file=>file.type.startsWith("image/"));if(file){globalThis.attachmentPasteProbe={trusted:event.isTrusted,name:file.name};file.arrayBuffer().then(bytes=>crypto.subtle.digest("SHA-256",bytes)).then(bytes=>attachmentPasteProbe.sha256=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join(""))}},true)})()`);
  await atEnd(); await setClipboard("image", join(sourceDirectory, photo)); await press("v", "KeyV", 86, 2);
  await wait('attachmentPasteProbe?.sha256&&!app.attachments.busy', "real OS image paste imported");
  assert.equal(await evaluate('attachmentPasteProbe.trusted'), true); assert.equal(await evaluate('attachmentPasteProbe.name'), "image.png");
  assert.equal(digest(await readFile(join(directory, assets, "image.png"))), await evaluate('attachmentPasteProbe.sha256'));
  expected += "![image.png](./Assets/image.png)"; await exactNote();
  const filesBeforeText = await evaluate('app.vault.getFiles().length');
  await atEnd(); await setClipboard("text", "Plain clipboard λ\r\nLine two."); await press("v", "KeyV", 86, 2);
  expected += "Plain clipboard λ\r\nLine two."; await exactNote(); assert.equal(await evaluate('app.vault.getFiles().length'), filesBeforeText);
  pass("Actual Ctrl+V imports the OS clipboard's PNG bytes exactly and inserts its embed; ordinary text paste still follows CodeMirror's CRLF behavior and creates no attachment.");

  await evaluate('app.markdownView.setEditingMode("live-preview")'); await click(editor); await press("Home", "Home", 36, 2);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  await evaluate('globalThis.attachmentDropProbe=null;document.addEventListener("drop",event=>{if(event.dataTransfer?.files.length)attachmentDropProbe={trusted:event.isTrusted,count:event.dataTransfer.files.length,position:app.editor.cm.posAtCoords({x:event.clientX,y:event.clientY})}},true)');
  const point = await evaluate('(()=>{const p=app.editor.cm.coordsAtPos(app.editor.cm.state.doc.line(1).to),point={x:p.left-1,y:(p.top+p.bottom)/2};return{...point,position:app.editor.cm.posAtCoords(point)}})()');
  assert.equal(point.position, "# Attachment note".length, "The intended heading-end caret is visible and measured before the drag");
  for (const type of ["dragEnter", "dragOver", "drop"]) { await command("Input.dispatchDragEvent", { type, x: point.x, y: point.y, data: { items: [], files: [join(sourceDirectory, "Drop.png")], dragOperationsMask: 1 } }); }
  await wait('attachmentDropProbe?.count===1&&!app.attachments.busy', "actual dropped File imported");
  assert.equal(await evaluate('attachmentDropProbe.trusted'), true); assert.deepEqual(await readFile(join(directory, assets, "Drop.png")), pixel);
  report.attachmentDropCaret = { intended: point.position, observed: await evaluate('attachmentDropProbe.position') };
  assert.equal(report.attachmentDropCaret.observed, point.position);
  expected = expected.replace("# Attachment note", "# Attachment note![Drop.png](./Assets/Drop.png)"); await exactNote();
  await press("e", "KeyE", 69, 2);
  await wait('(()=>{const images=Array.from(document.querySelectorAll(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .markdown-preview-view img"));return images.length===6&&images.every(image=>image.complete&&image.naturalWidth>0)})()', "all imported images decode in Reading");
  assert.equal(await evaluate('document.querySelector("#attach-files").disabled'), true); await capture("reading");
  const readingUrl = await evaluate('location.href'), beforeReadingDrop = await evaluate('app.vault.getFiles().length');
  const readingPoint = await evaluate('(()=>{const r=document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .markdown-preview-view").getBoundingClientRect();return{x:r.left+100,y:r.top+100}})()');
  for (const type of ["dragEnter", "dragOver", "drop"]) { await command("Input.dispatchDragEvent", { type, ...readingPoint, data: { items: [], files: [join(sourceDirectory, "Drop.png")], dragOperationsMask: 1 } }); }
  await delay(300); assert.equal(await evaluate('location.href'), readingUrl); assert.equal(await evaluate('app.vault.getFiles().length'), beforeReadingDrop);
  assert.equal(await evaluate('app.attachments.busy'), false); assert.equal(await evaluate('app.editor.getValue()'), expected);
  await press("e", "KeyE", 69, 2);
  pass("A trusted file drop in Live Preview imports exact PNG bytes at the drop caret; Reading decodes every imported image despite a conflicting root folder, and a declined Reading drop neither imports nor navigates away from the app.");

  await writeFile(join(sourceDirectory, "Oversized.bin"), Buffer.alloc(16 * 1024 * 1024 + 1)); await atEnd(); const beforeLimit = await evaluate('app.vault.getFiles().length');
  await choose(["Oversized.bin"]); await idle(); await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("16 MiB")', "oversized selection visibly rejected");
  assert.equal(await evaluate('app.vault.getFiles().length'), beforeLimit); await exactNote(); await closeReview();
  await click("[data-attachment-issue]"); await wait('Boolean(document.querySelector("[data-attachment-review]"))', "persistent attachment issue reopens review"); await closeReview();
  pass("An oversized real source file is rejected before creating an attachment or changing the note, with a visible review and persistent issue action.");

  await evaluate(`(()=>{const original=app.vault.createBinary;globalThis.attachmentWriteProbe={calls:[],restore:()=>app.vault.createBinary=original};app.vault.createBinary=async function(...args){attachmentWriteProbe.calls.push(args[0]);if(attachmentWriteProbe.calls.length===2)await new Promise(resolve=>attachmentWriteProbe.release=resolve);return original.apply(this,args)}})()`);
  await atEnd(); await choose(["First.bin", "Second.bin"]); await wait('typeof attachmentWriteProbe.release==="function"', "second import held before its guarded create");
  assert.equal(await evaluate('app.workspace.isChangingFiles'), true);
  const external = Buffer.from([255, 77, 88, 0]); await writeFile(join(directory, assets, "Second.bin"), external);
  await evaluate('attachmentWriteProbe.release()'); await idle();
  await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("1 of 2")', "partial import review");
  assert.deepEqual(await readFile(join(directory, assets, "First.bin")), opaque); assert.deepEqual(await readFile(join(directory, assets, "Second.bin")), external);
  assert.equal(await evaluate('document.querySelector("[data-attachment-links]").value'), "[First.bin](./Assets/First.bin)");
  await exactNote(); await delay(2200); assert.equal(await evaluate('attachmentWriteProbe.calls.length'), 2); await capture("partial");
  await evaluate('attachmentWriteProbe.restore()'); await closeReview();
  pass("A real late destination collision stops a batch without overwriting external bytes: its first confirmed copy remains available, no batch links are inserted, and the review exposes only confirmed links with no automatic retry.");

  await evaluate('(()=>{const original=app.vault.createBinary;app.vault.createBinary=async function(...args){app.vault.createBinary=original;await original.apply(this,args);throw new Error("Expected lost import acknowledgement")}})()');
  await atEnd(); await choose(["Unconfirmed.bin"]); await idle();
  await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("Could not confirm:")', "lost acknowledgement stays explicit");
  assert.deepEqual(await readFile(join(directory, assets, "Unconfirmed.bin")), sources.get("Unconfirmed.bin"));
  assert.equal(await evaluate('document.querySelector("[data-attachment-links]")'), null); await exactNote(); await closeReview();
  pass("A fixture-lost acknowledgement after a real successful write retains the exact file, inserts no unconfirmed link and exposes the uncertain path without retrying or deleting it.");

  async function holdRead() {
    await evaluate(attachmentReadHoldScript({ name: "Stale.bin", size: sources.get("Stale.bin").length }));
    await atEnd(); await choose(["Stale.bin"]); await wait('attachmentReadProbe.held&&app.attachments.busy', "actual source read held before writes");
    assert.deepEqual(await evaluate('attachmentReadProbe.source'), { kind: "file", name: "Stale.bin", size: 3, relativePath: "" });
  }
  await holdRead();
  if (expectReloadBlocked) { assert.equal(await evaluate('app.workspace.hasUnsavedChanges'), false); await expectReloadBlocked(); assert.equal(await evaluate('attachmentReadProbe.held&&app.attachments.busy'), true); }
  assert.match(await evaluate('app.prepareLeave().then(()=>"Unexpected leave",error=>error.message)'), /Wait for the attachment import/);
  await command("Input.insertText", { text: " Retained edit during source read." }); expected += " Retained edit during source read.";
  await evaluate('attachmentReadProbe.release()'); await idle();
  await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("selection or vault changed")', "stale note input refused");
  await assert.rejects(readFile(join(directory, assets, "Stale.bin")), { code: "ENOENT" }); await exactNote(); await closeReview();
  pass("Editing during a fixture-held real source read invalidates the import before any create, retains and autosaves the edit, and an accepted import blocks the registered leave guard until it settles.");

  await holdRead(); const renamed = folder + "/Renamed.md";
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(note)}),${JSON.stringify(renamed)},false)`);
  await evaluate('attachmentReadProbe.release()'); await idle();
  await wait('Boolean(document.querySelector("[data-attachment-review]"))', "renamed origin refused");
  await assert.rejects(readFile(join(directory, assets, "Stale.bin")), { code: "ENOENT" }); await exactNote(renamed); await closeReview();
  assert.equal(await evaluate('app.vault.rootPath'), root); assert.deepEqual(await readFile(join(directory, ".obsidian", "app.json")), settingsBytes);
  pass("A real FileManager rename during source preparation invalidates the old note context, creates no stale attachment and retains the renamed note's exact text and configuration.");

  await folderScenarios();
  if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload();
  await wait(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.session?.document.file.path===${JSON.stringify(renamed)}).length===2`, "both attachment panes restored");
  await evaluate(`app.openFile(${JSON.stringify(renamed)})`); await exactNote(renamed);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-attachment-issue]"))'), false);
  for (const [name, bytes] of sources) { assert.deepEqual(await readFile(join(sourceDirectory, name)), bytes, "Source was not modified: " + name); }
  for (const name of [importedPhoto, "image.png", "Drop.png", "First.bin", "Unconfirmed.bin"]) { assert.ok((await readFile(join(directory, assets, name))).length > 0); }
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  await capture("restored");
  const hashes = {};
  for (const path of [renamed, assets + "/" + importedPhoto, assets + "/Opaque.bin", assets + "/image.png", assets + "/Drop.png", assets + "/First.bin", assets + "/Second.bin", assets + "/Unconfirmed.bin", ".obsidian/app.json"]) { hashes[path] = digest(await readFile(join(directory, path))); }
  report.attachmentImport = { browser, directory, sourceDirectory, hashes, imagePasteHash: hashes[assets + "/image.png"], expectedNote: expected,
    scope: "Actual browser File input, trusted file drop, real OS image/text paste, exact source/attachment/note bytes, collision naming, placement, shared undo/autosave, decoded previews, partial/lost acknowledgement review, stale edit/rename, folder picker/drop with hierarchy/collision/undo/partial/stale-read/junction cases and full restart/reconnect. CDP selects file-input paths and dispatches drop events; OS clipboard is prepared by the fixture host. Source-read/write holds and lost acknowledgement are explicit boundary fixtures. No new viewers, cross-process/crash transactions or complete reference/private drag/clipboard equivalence; desktop reparse/unselected-source refusal is host-enforced, standalone browser enumeration is not provable by the app." };
  pass("A full desktop restart/browser reconnect restores both panes and exact note/attachment/configuration bytes; original source files and workspace data remain unchanged, and transient import issues do not leak into the new session.");

  async function folderScenarios() {
    const encode = part => encodeURIComponent(part).replace(/[!'()*]/g, value => "%" + value.charCodeAt(0).toString(16).toUpperCase());
    const link = (dest, label = dest.split("/").at(-1), image = false) => (image ? "!" : "") + "[" + label.replace(/([\\\[\]])/g, "\\$1") + "](./" + dest.split("/").map(encode).join("/") + ")";
    const text = Buffer.from("\ufeffFolder text λ\r\n中文\r\n");
    const makeTree = async (name, files) => { for (const [relative, bytes] of files) { const path = join(sourceDirectory, name, ...relative.split("/")); await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, bytes); } };
    const tree = [["Top.bin", opaque], ["sub dir/Nested [x] #.png", pixel], ["sub dir/deeper/Text.txt", text]];
    for (const name of ["Folder Pick", "Folder Drop", "Folder Late", "Folder Stale", "Folder Mixed"]) { await makeTree(name, tree); }
    const folderChoose = async name => {
      await command("Page.setInterceptFileChooserDialog", { enabled: true });
      await click("#attach-folder");
      const { root: document } = await command("DOM.getDocument");
      const { nodeId } = await command("DOM.querySelector", { nodeId: document.nodeId, selector: "[data-attachment-folder-input]" }); assert.ok(nodeId);
      await evaluate('(()=>{const input=document.querySelector("[data-attachment-folder-input]");globalThis.folderPickProbe=null;input.addEventListener("change",()=>{globalThis.folderPickProbe={count:input.files.length,relative:Array.from(input.files).slice(0,3).map(file=>file.webkitRelativePath),sizes:Array.from(input.files).slice(0,3).map(file=>file.size)}},{capture:true,once:true})})()');
      await command("DOM.setFileInputFiles", { nodeId, files: [join(sourceDirectory, name)] });
      await wait("globalThis.folderPickProbe!==null", "folder input change observed");
      report.attachmentFolderPick = await evaluate("folderPickProbe");
    };
    const verifyTree = async (dest, name) => { for (const [relative, bytes] of tree) { assert.deepEqual(await readFile(join(directory, assets, dest, ...relative.split("/"))), bytes, name + "/" + relative); } };
    const walk = async path => { const { readdir } = await import("node:fs/promises"); const found = []; for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) { found.push(entry.name); if (entry.isDirectory()) { found.push(...await walk(join(path, entry.name))); } } return found; };
    const dest = (root, relative) => "Assets/" + root + "/" + relative;
    const linksFor = root => tree.map(([relative]) => link(dest(root, relative), relative.split("/").at(-1), /\.png$/.test(relative)));
    const expectLinks = async root => { const value = await evaluate('app.editor.getValue()'); for (const item of linksFor(root)) { assert.ok(value.includes(item), "Missing link " + item); } expected = value; await exactNote(renamed); };
    await evaluate('app.markdownView.setEditingMode("source")');
    await wait('!document.querySelector("#attach-folder").disabled', "folder attachment action available");

    await atEnd(); await folderChoose("Folder Pick"); await idle(); await expectLinks("Folder Pick"); await verifyTree("Folder Pick", "Folder Pick");
    pass("The actual Attach folder action imports a browser-selected folder with its relative hierarchy and exact bytes below one new destination folder and inserts one exact relative link per file.");

    await press("z", "KeyZ", 90, 2); const afterFolder = expected; expected = expected.replace(linksFor("Folder Pick").join("\r\n"), ""); await exactNote(renamed); await verifyTree("Folder Pick", "Folder Pick");
    await press("y", "KeyY", 89, 2); expected = afterFolder; await exactNote(renamed);
    pass("Folder links undo and redo as one shared editor edit while the copied folder files stay intact.");

    await atEnd(); await folderChoose("Folder Pick"); await idle(); await expectLinks("Folder Pick 1"); await verifyTree("Folder Pick 1", "Folder Pick 1");
    await verifyTree("Folder Pick", "Folder Pick");
    pass("Importing the same folder again reserves a new sibling root and never merges into or overwrites the earlier copy.");

    await writeFile(join(directory, assets, "folder drop"), Buffer.from("Occupying file with a case-different name."));
    await evaluate('globalThis.attachmentDropProbe=null;document.addEventListener("drop",event=>{if(event.dataTransfer?.files.length)attachmentDropProbe={trusted:event.isTrusted,count:event.dataTransfer.files.length}},true)');
    const point = await evaluate('(()=>{const p=app.editor.cm.coordsAtPos(app.editor.cm.state.doc.length),point={x:p.left+2,y:(p.top+p.bottom)/2};return point})()');
    for (const type of ["dragEnter", "dragOver", "drop"]) { await command("Input.dispatchDragEvent", { type, x: point.x, y: point.y, data: { items: [], files: [join(sourceDirectory, "Folder Drop")], dragOperationsMask: 1 } }); }
    await wait('attachmentDropProbe!==null&&!app.attachments.busy', "actual dropped folder settled");
    assert.equal(await evaluate('attachmentDropProbe.trusted'), true);
    await expectLinks("Folder Drop 1"); await verifyTree("Folder Drop 1", "Folder Drop");
    assert.deepEqual(await readFile(join(directory, assets, "folder drop")), Buffer.from("Occupying file with a case-different name."));
    pass("A trusted directory drop imports the same hierarchy and bytes, avoiding a case-different occupying file.");

    const beforeMixed = await evaluate('app.vault.getFiles().length');
    for (const type of ["dragEnter", "dragOver", "drop"]) { await command("Input.dispatchDragEvent", { type, x: point.x, y: point.y, data: { items: [], files: [join(sourceDirectory, "Folder Mixed"), join(sourceDirectory, "Drop.png")], dragOperationsMask: 1 } }); }
    await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("one folder at a time")', "mixed folder and file drop refused");
    assert.equal(await evaluate('app.vault.getFiles().length'), beforeMixed); await exactNote(renamed); await closeReview();
    pass("A drop combining a folder with another file is refused before any read or write.");

    await evaluate(`(()=>{const original=app.vault.createBinary;globalThis.attachmentWriteProbe={calls:[],restore:()=>app.vault.createBinary=original};app.vault.createBinary=async function(...args){attachmentWriteProbe.calls.push(args[0]);if(attachmentWriteProbe.calls.length===2)await new Promise(resolve=>attachmentWriteProbe.release=resolve);return original.apply(this,args)}})()`);
    await atEnd(); await folderChoose("Folder Late"); await wait('typeof attachmentWriteProbe.release==="function"', "folder import held before its second create");
    const second = await evaluate('attachmentWriteProbe.calls[1]'), first = await evaluate('attachmentWriteProbe.calls[0]'), foreign = Buffer.from([9, 9, 9, 0]);
    await mkdir(join(directory, second, ".."), { recursive: true }); await writeFile(join(directory, second), foreign);
    await evaluate('attachmentWriteProbe.release()'); await idle();
    await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("1 of 3")', "partial folder import review");
    assert.deepEqual(await readFile(join(directory, second)), foreign); assert.ok((await readFile(join(directory, first))).length >= 0);
    assert.equal(await evaluate('attachmentWriteProbe.calls.length'), 2); assert.equal(await evaluate('document.querySelectorAll("[data-attachment-links]").length'), 1);
    await exactNote(renamed); await evaluate('attachmentWriteProbe.restore()'); await closeReview();
    pass("A real late collision inside a copied folder stops the folder batch without overwriting foreign bytes, leaves confirmed copies reviewable, inserts no links and does not retry or delete.");

    await atEnd();
    await evaluate(attachmentReadHoldScript({ name: "Top.bin", size: opaque.length, relativePath: "Folder Stale/Top.bin", nativeFolder: !browser }));
    await folderChoose("Folder Stale"); await wait('attachmentReadProbe.held&&app.attachments.busy', "folder source read held before writes");
    if (browser) { assert.deepEqual(await evaluate('attachmentReadProbe.source'), { kind: "file", name: "Top.bin", size: opaque.length, relativePath: "Folder Stale/Top.bin" }); }
    else { assert.equal(await evaluate('attachmentReadProbe.source.kind'), "native-folder"); }
    await command("Input.insertText", { text: " Edit during folder read." }); expected += " Edit during folder read.";
    await evaluate('attachmentReadProbe.release()'); await idle();
    await wait('document.querySelector("[data-attachment-review]")?.textContent.includes("selection or vault changed")', "stale folder import refused");
    assert.deepEqual(await walk(join(directory, assets, "Folder Stale")), []); await exactNote(renamed); await closeReview(); await evaluate('attachmentReadProbe.restore()');
    pass("Editing the owning note during a folder source read refuses the whole import before any destination folder or file is created.");

    // Junction boundary: the browser, not this app, enumerates the selected folder and may or may not follow reparse points.
    const outside = sourceDirectory + "-outside", sentinel = Buffer.from("OUTSIDE SENTINEL must never be copied.");
    await mkdir(outside, { recursive: true }); await writeFile(join(outside, "Sentinel.bin"), sentinel);
    await makeTree("Folder Link", [["Real.txt", text]]);
    const { symlink, lstat } = await import("node:fs/promises");
    await symlink(outside, join(sourceDirectory, "Folder Link", "Outside"), "junction");
    assert.ok((await lstat(join(sourceDirectory, "Folder Link", "Outside"))).isSymbolicLink());
    let symlinkMade = false; try { await symlink(join(outside, "Sentinel.bin"), join(sourceDirectory, "Folder Link", "LinkedFile.bin"), "file"); symlinkMade = true; } catch (error) { if (!["EPERM", "EACCES"].includes(error.code)) { throw error; } }
    await atEnd(); await folderChoose("Folder Link"); await idle();
    const copied = await walk(join(directory, assets, "Folder Link")), edge = copied.includes("Sentinel.bin");
    report.attachmentFolderLinks = { junction: true, fileSymlink: symlinkMade, copiedEntries: copied, sentinelCopied: edge,
      review: await evaluate('document.querySelector("[data-attachment-review]")?.textContent ?? ""'), limit: browser ? "Standalone browser: the engine enumerates the selected folder and the page cannot prove or refuse reparse ancestry; this records observed engine behavior only." : "Desktop: the host enumerates and lstat/realpath-checks the selected folder, refusing links, junctions and non-regular entries whole before any bytes are read." };
    assert.equal(edge, false, "A junction in the selected folder exposed bytes from an unselected outside directory: " + JSON.stringify(copied));
    assert.ok(!(await evaluate('app.editor.getValue()')).includes("Sentinel.bin"));
    if (!browser) {
      assert.match(report.attachmentFolderLinks.review, /link, junction or reparse/); assert.deepEqual(copied, []); assert.equal(await evaluate('document.querySelector("[data-attachment-links]")'), null);
    }
    if (await evaluate('Boolean(document.querySelector("[data-attachment-review]"))')) { await closeReview(); }
    if (!edge) { expected = await evaluate('app.editor.getValue()'); await exactNote(renamed); }
    assert.deepEqual(await readFile(join(outside, "Sentinel.bin")), sentinel);
    pass(browser ? "A real Windows junction (and file symlink when permitted) inside a folder selected in the standalone browser does not cause its outside sentinel to be copied; the observed engine behavior is recorded and outside bytes are unchanged." : "A real Windows junction (and file symlink when permitted) inside a selected folder is refused whole by the desktop host before any read or write; the outside sentinel is unchanged and nothing is imported.");
    const { rm } = await import("node:fs/promises"); await rm(join(sourceDirectory, "Folder Link", "Outside"), { force: true }); await rm(outside, { recursive: true, force: true });
    report.attachmentFolder = { hashes: Object.fromEntries(await Promise.all(tree.map(async ([relative]) => [relative, digest(await readFile(join(directory, assets, "Folder Pick", ...relative.split("/"))))]))) };
  }
}
