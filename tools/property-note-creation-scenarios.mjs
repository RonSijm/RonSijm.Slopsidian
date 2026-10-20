import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

const q = JSON.stringify, host = '[data-property-creation-root="true"]';
const field = key => host + ' [data-property-key=' + q(key) + '] [data-metadata-input]';
const item = path => host + ' [data-property-create-note=' + q(path) + ']';
const error = key => host + ' [data-property-key=' + q(key) + '] .metadata-property-error';
const bytes = value => Buffer.from("\ufeff" + value);
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
async function key(tools, value, code, number, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await tools.command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode: number, modifiers });
}
async function fill(tools, selector, value) {
  await tools.click(selector); await key(tools, "a", "KeyA", 65, 2);
  if (value) await tools.command("Input.insertText", { text: value }); else await key(tools, "Backspace", "Backspace", 8);
}
async function cancel(tools, property) { await tools.click(field(property)); await key(tools, "Escape", "Escape", 27); await key(tools, "Escape", "Escape", 27); }
async function mark(tools) { await tools.evaluate('(()=>{document.querySelectorAll("[data-property-creation-root]").forEach(element=>delete element.dataset.propertyCreationRoot);app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertyCreationRoot="true";return true})()'); }
async function offer(tools, property, query, path) {
  await fill(tools, field(property), "[[" + query);
  await tools.wait('(()=>{const element=document.querySelector(' + q(item(path)) + ');return Boolean(element&&element.checkVisibility())})()', "explicit Properties Create note action");
}
const sourceText = '---\r\n# Keep exact property comment\r\nstatus: Open # keep scalar comment\r\nlabels: [ kept ]\r\naliases: [ Existing alias ]\r\ntags: [ shared ]\r\ncount: 1.50\r\nopaque: { keep: exact }\r\n---\r\n# Property creation λ\r\n\r\nUntouched 😀 body.\r\n';

/** Root supplies frozen builds, actual input, restart/reconnect and final error audits. */
export async function checkPropertyNoteCreation(tools) {
  const { directory, evaluate, wait, click, command, capture, report, restart, afterReload } = tools;
  const folder = "Property creation", path = folder + "/Source folder/Source.md", known = folder + "/Known.md";
  const knownText = '---\r\naliases: [ "Known property alias λ" ]\r\n---\r\n# Existing target\r\n';
  const configPath = join(directory, ".obsidian/app.json"), config = await readFile(configPath), options = JSON.parse(config.toString("utf8").replace(/^\ufeff/, ""));
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")'), autosave = await evaluate("app.markdownAutosave.enabled");
  if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
  for (const part of ["Source folder", "Inbox", "Explicit"]) await mkdir(join(directory, folder, part), { recursive: true });
  await writeFile(join(directory, path), bytes(sourceText), { flag: "wx" }); await writeFile(join(directory, known), bytes(knownText), { flag: "wx" });
  const source = 'app.workspace.sessions.get(' + q(path) + ').text';
  const indexed = () => wait('app.vault.getMarkdownFiles().every(file=>{const entry=app.metadataCache.getDocument(file.path),session=app.workspace.sessions.get(file.path);return Boolean(entry&&!entry.missing&&(session||app.metadataCache.getFileCache(file)))})', "complete indexed inventory before Properties absence proof");
  const settled = async () => {
    await evaluate("(async()=>{await app.workspace.whenIdle();await app.core.whenIdle();await app.metadataCache.refresh()})()");
    await indexed();
  };
  const update = async (location = "root", format = "shortest") => {
    await writeFile(configPath, JSON.stringify({ ...options, markdownAutosave: false, newFileLocation: location, newFileFolderPath: folder + "/Inbox", newLinkFormat: format, useMarkdownLinks: true }, null, 2));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');
    await indexed();
  };
  const open = async mode => {
    await evaluate('(async()=>{await app.openFile(' + q(path) + ');const view=app.workspace.activeLeaf.view;view.setEditingMode("live-preview");if(' + q(mode) + '==="preview")view.setMode("preview")})()');
    await mark(tools); await wait('Boolean(document.querySelector(' + q(field("status")) + '))', "visible original Properties field");
  };
  const exact = async expected => {
    await wait(source + "===" + q(expected) + '&&!app.workspace.sessions.get(' + q(path) + ').dirty&&!app.workspace.sessions.get(' + q(path) + ').isSaving', "exact Properties source saved");
    assert.deepEqual(await readFile(join(directory, path)), bytes(expected));
  };
  const returnOriginal = async () => {
    await evaluate('(async()=>{const view=app.workspace.activeLeaf.view;view.setEditingMode("source",false);view.editor.undo();await app.saveAll()})()'); await exact(sourceText);
  };
  const expectedFor = (property, value) => property === "labels" ? sourceText.replace("labels: [ kept ]", "labels: [ kept, " + JSON.stringify(value) + " ]") : sourceText.replace("status: Open #", "status: " + JSON.stringify(value) + " #");
  const created = []; let stage = "prepare", successfulTrace = [], primaryFailure = null;
  try {
    await update(); await open("preview");
    await evaluate('(()=>{const trace=globalThis.propertyCreationTrace={abort:new AbortController(),trusted:[],created:[]};trace.createRef=app.vault.on("create",file=>trace.created.push(file.path));for(const type of["pointerdown","keydown"])document.addEventListener(type,event=>{const button=type==="pointerdown"?event.target.closest?.("[data-property-create-note]"):event.target.closest?.("[data-metadata-input]")?.parentElement.querySelector("[data-property-create-note][aria-selected=true]");if(button&&(type==="pointerdown"||event.key==="Enter"||event.key==="Tab"))trace.trusted.push({type:type==="pointerdown"?"pointer":event.key,path:button.dataset.propertyCreateNote,source:app.workspace.getActiveFile()?.path,property:button.closest("[data-property-key]")?.dataset.propertyKey,trusted:event.isTrusted})},{capture:true,signal:trace.abort.signal});return true})()');
    stage = "actual pointer and keyboard creation";
    const cases = [
      ["preview", "root", "shortest", "status", "Wave13 property Reading λ", "Wave13 property Reading λ.md", "pointer"],
      ["live-preview", "current", "relative", "status", "Wave13 property LP λ", folder + "/Source folder/Wave13 property LP λ.md", "Enter"],
      ["preview", "folder", "absolute", "labels", "Configured property λ", folder + "/Inbox/Configured property λ.md", "Enter"],
      ["live-preview", "current", "shortest", "labels", folder + "/Explicit/Property λ", folder + "/Explicit/Property λ.md", "Tab"],
    ];
    for (const [mode, location, format, property, query, destination, action] of cases) {
      await update(location, format); await open(mode); await offer(tools, property, query, destination);
      assert.equal(await evaluate(source), sourceText); await assert.rejects(readFile(join(directory, destination)), { code: "ENOENT" });
      const appearance = await evaluate('(()=>{const row=document.querySelector(' + q(item(destination)) + ');return{title:row.title,text:row.textContent,plain:!row.querySelector("img,script"),target:row.hasAttribute("data-property-link-target")}})()');
      assert.ok(appearance.text.includes("Create note: " + query)); assert.ok(appearance.title.includes(destination)); assert.equal(appearance.plain, true); assert.equal(appearance.target, false);
      if (mode === "preview" && property === "status") await capture?.("property-create-reading");
      if (mode === "live-preview" && property === "status") await capture?.("property-create-live-preview");
      if (action === "pointer") await click(item(destination));
      else { await key(tools, "ArrowDown", "ArrowDown", 40); await key(tools, action, action, action === "Tab" ? 9 : 13); }
      await wait('!app.workspace.isChangingFiles&&Boolean(app.vault.getFileByPath(' + q(destination) + '))', "acknowledged empty note exists and mutation lock released");
      const token = await evaluate('"[["+app.metadataCache.fileToLinktext(app.vault.getFileByPath(' + q(destination) + '),' + q(path) + ',true)+"]]"');
      await exact(expectedFor(property, token)); assert.deepEqual(await readFile(join(directory, destination)), Buffer.alloc(0)); created.push(destination);
      assert.equal(await evaluate("app.workspace.getActiveFile().path"), path); assert.equal(await evaluate("app.workspace.activeLeaf.view.getMode()"), mode === "preview" ? "preview" : "source");
      assert.ok((await evaluate("propertyCreationTrace.trusted")).some(event => event.path === destination && event.source === path && event.property === property && event.type === action && event.trusted));
      await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.focus()');
      await key(tools, "z", "KeyZ", 90, 2); assert.equal(await evaluate(source), sourceText); assert.ok(await evaluate('Boolean(app.vault.getFileByPath(' + q(destination) + '))'));
      await key(tools, "y", "KeyY", 89, 2); assert.equal(await evaluate(source), expectedFor(property, token)); await evaluate("app.saveAll()"); await exact(expectedFor(property, token)); await returnOriginal();
    }
    await update(); await open("preview");
    await evaluate('(async()=>{const leaf=app.workspace.getLeaf("split");await leaf.setViewState({type:"file-properties",state:{file:' + q(path) + ',followActiveFile:false},active:true});globalThis.propertyCreationTrace.pane=leaf.id})()'); await mark(tools);
    const paneName = "Wave13 fixed property pane λ", panePath = paneName + ".md"; await offer(tools, "status", paneName, panePath); await capture?.("property-create-pane");
    await key(tools, "ArrowDown", "ArrowDown", 40); await key(tools, "Enter", "Enter", 13); await exact(expectedFor("status", "[[" + paneName + "]]")); created.push(panePath);
    await evaluate('(async()=>{const pane=app.workspace.getLeafById(propertyCreationTrace.pane),leaf=app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===' + q(path) + ');await app.workspace.closeLeaf(pane);app.workspace.setActiveLeaf(leaf,{focus:true})})()'); await returnOriginal();
    pass(report, "Real Reading, Live Preview and fixed Properties-pane Create note actions use trusted pointer/Arrow+Enter/Tab, honor root/current/configured/explicit placement and wiki spelling despite Markdown preference, create one exact empty note, preserve BOM/CRLF/Unicode/comments/opaque YAML and isolate Source Undo/Redo without navigation or deleting the created note.");

    stage = "explicit cancellation and unsupported controls"; await update(); await open("preview");
    const before = await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()");
    await offer(tools, "status", "Wave13 cancelled property λ", "Wave13 cancelled property λ.md"); await cancel(tools, "status");
    for (const [property, query] of [["status", "[[Known"], ["status", "[[Known property alias λ"], ["status", "[[No heading#Heading"], ["status", "[[No block#^new"], ["status", "[[../../../Escape"], ["status", "[[image.png"], ["tags", "[[New tag note"], ["aliases", "[[New alias note"], ["count", "[[New number note"]]) {
      await fill(tools, field(property), query); assert.equal(await evaluate('document.querySelectorAll(' + q(host + ' [data-property-create-note]') + ').length'), 0); await cancel(tools, property);
    }
    await exact(sourceText); assert.deepEqual(await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()"), before);
    pass(report, "Typing and Escape never create a file; existing notes/aliases, incomplete/escaping or attachment queries, headings/block IDs and tag/alias/number widgets expose no Create note action and leave exact source and inventory intact.");

    stage = "stale preflight, physical collision and acknowledged cleanup"; await open("preview");
    const staleName = "Wave13 stale property before create", stalePath = staleName + ".md"; await offer(tools, "status", staleName, stalePath);
    await evaluate('(()=>{const t=propertyCreationTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)};return true})()');
    await click(item(stalePath)); await wait("propertyCreationTrace.waiting", "actual create preflight held after selection");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);propertyCreationTrace.release()');
    // The file lock drops before its layout save and the chooser's catch/finally finish.
    // Its current refusal receipt proves the accepted draft has settled before the next case types.
    await wait('!app.workspace.isChangingFiles&&document.querySelector(' + q(error("status")) + ')?.textContent===' + q("The note or its destination changed before creation. No note was created."), "current stale preflight refusal settled");
    await evaluate("app.saveAll=propertyCreationTrace.saveAll;delete propertyCreationTrace.saveAll"); await settled(); await exact(sourceText); await assert.rejects(readFile(join(directory, stalePath)), { code: "ENOENT" });
    await open("preview");
    const collisionName = "Wave13 property physical collision", collisionPath = collisionName + ".md", collisionBytes = bytes("External collision λ\r\n"); await offer(tools, "status", collisionName, collisionPath); await exact(sourceText);
    await evaluate('(()=>{const t=propertyCreationTrace;t.create=app.vault.create;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.create=async function(path,...args){if(path===' + q(collisionPath) + '){t.waiting=true;await t.gate}return t.create.call(this,path,...args)};return true})()');
    await click(item(collisionPath)); await wait("propertyCreationTrace.waiting", "actual Vault.create held before create-only collision");
    await writeFile(join(directory, collisionPath), collisionBytes, { flag: "wx" }); await evaluate("propertyCreationTrace.release()");
    await wait('!app.workspace.isChangingFiles&&/Host 409:|already exists|EEXIST/i.test(document.querySelector(' + q(error("status")) + ')?.textContent??"")', "current physical collision refused in the original property field");
    await evaluate("app.vault.create=propertyCreationTrace.create;delete propertyCreationTrace.create"); await settled(); await exact(sourceText); assert.deepEqual(await readFile(join(directory, collisionPath)), collisionBytes); await cancel(tools, "status");
    const cleanupName = "Wave13 property retained after cleanup", cleanupPath = cleanupName + ".md"; await offer(tools, "status", cleanupName, cleanupPath);
    await evaluate('(()=>{const t=propertyCreationTrace;t.create=app.vault.create;t.refresh=app.metadataCache.refresh;t.fail=false;app.vault.create=async function(...args){const file=await t.create.apply(this,args);if(file.path===' + q(cleanupPath) + ')t.fail=true;return file};app.metadataCache.refresh=async function(...args){if(t.fail){t.fail=false;throw new Error("Wave13 property post-create refresh failure")}return t.refresh.apply(this,args)};return true})()');
    await expectErrors(tools, [{ source: "notification", message: "Wave13 property post-create refresh failure" }], async () => {
      await click(item(cleanupPath)); await wait('!app.workspace.isChangingFiles&&document.querySelector("#client-errors").textContent.includes("Wave13 property post-create refresh failure")&&[...document.querySelectorAll(".notice")].some(element=>element.textContent.includes(' + q(cleanupPath) + ')&&element.textContent.includes("new note was kept"))', "acknowledged note retained with original cleanup error");
    }, "one injected metadata failure after a real acknowledged Properties create; retain file and report original error");
    await evaluate("app.vault.create=propertyCreationTrace.create;app.metadataCache.refresh=propertyCreationTrace.refresh;delete propertyCreationTrace.create;delete propertyCreationTrace.refresh");
    await exact(sourceText); assert.deepEqual(await readFile(join(directory, cleanupPath)), Buffer.alloc(0)); created.push(cleanupPath); await click("[data-dismiss-error]"); await cancel(tools, "status");
    // The intentional cleanup failure skipped indexing its acknowledged file.
    // Recover the complete absence proof before dispatching the next query.
    await evaluate("app.metadataCache.refresh()"); await indexed();
    const partialName = "Wave13 property partial source save", partialPath = partialName + ".md", partialText = expectedFor("status", "[[" + partialName + "]]");
    await offer(tools, "status", partialName, partialPath);
    await evaluate('(()=>{const t=propertyCreationTrace;t.session=app.workspace.sessions.get(' + q(path) + ');t.save=t.session.save;t.waiting=false;t.failed=false;t.gate=new Promise(resolve=>t.release=resolve);t.session.save=async function(...args){if(!t.failed&&this.text===' + q(partialText) + '){t.waiting=true;await t.gate;t.failed=true;throw new Error("Wave13 property source save failed after editor change")}return t.save.apply(this,args)};return true})()');
    await expectErrors(tools, [], async () => {
      await click(item(partialPath)); await wait('propertyCreationTrace.waiting&&!app.workspace.isChangingFiles&&app.workspace.sessions.get(' + q(path) + ').dirty&&' + source + '===' + q(partialText), "actual property editor edit waits at its real source-save boundary");
      assert.deepEqual(await readFile(join(directory, path)), bytes(sourceText)); assert.deepEqual(await readFile(join(directory, partialPath)), Buffer.alloc(0));
      await evaluate("propertyCreationTrace.release()");
      await wait('[...document.querySelectorAll(".notice")].some(element=>element.textContent.includes(' + q(partialPath) + ')&&element.textContent.includes("review the property and any unsaved changes"))', "partial source-save failure accurately requests property review");
      await evaluate("propertyCreationTrace.session.save=propertyCreationTrace.save;delete propertyCreationTrace.save;delete propertyCreationTrace.session");
      assert.equal(await evaluate('document.querySelector(' + q(error("status")) + ')?.textContent'), "Wave13 property source save failed after editor change");
      assert.equal(await evaluate(source), partialText); assert.equal(await evaluate('app.workspace.sessions.get(' + q(path) + ').dirty'), true);
      assert.deepEqual(await readFile(join(directory, path)), bytes(sourceText)); assert.deepEqual(await readFile(join(directory, partialPath)), Buffer.alloc(0));
      assert.equal(await evaluate('[...document.querySelectorAll(".notice")].filter(element=>element.textContent.includes(' + q(partialPath) + ')).some(element=>element.textContent.includes("no property link was inserted"))'), false);
    }, "one post-editor property source-save failure is handled by its exact visible row error and review Notice, with zero new global diagnostics");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.focus()'); await key(tools, "z", "KeyZ", 90, 2);
    await wait(source + "===" + q(sourceText), "trusted Source Undo removes the one partial property edit");
    // Blurring the failed scalar can start its normal queue/save before Undo.
    // Save must await that write and its correction before checking disk bytes.
    await evaluate("(async()=>{await app.core.whenIdle();await app.saveAll();await app.workspace.whenIdle()})()");
    await exact(sourceText); assert.deepEqual(await readFile(join(directory, partialPath)), Buffer.alloc(0)); created.push(partialPath);
    pass(report, "Real preflight mode changes and physical create-only collisions refuse without a property edit or overwritten bytes. Acknowledged notes survive early cleanup failure with the original reported error. A later source-save failure retains its actual dirty property link, original physical source and empty created note, with exact row error and accurate review Notice; trusted Source Undo removes only that property edit and keeps the note.");

    stage = "queued owner refusal and restart"; await open("preview");
    await evaluate("(async()=>{await app.core.whenIdle();await app.saveAll();await app.workspace.whenIdle();await app.metadataCache.refresh()})()"); await indexed(); await exact(sourceText);
    const queuedName = "Wave13 queued property owner", queuedPath = queuedName + ".md"; await offer(tools, "status", queuedName, queuedPath);
    await evaluate('(()=>{const t=propertyCreationTrace;t.session=app.workspace.sessions.get(' + q(path) + ');t.reload=t.session.reload;t.waiting=false;t.reloadContexts=[];t.gate=new Promise(resolve=>t.release=resolve);t.session.reload=async function(...args){const target=Boolean(app.vault.getFileByPath(' + q(queuedPath) + ')),changingFiles=app.workspace.isChangingFiles,busy=document.querySelector(' + q(host + ' [data-property-key="status"]') + ')?.getAttribute("aria-busy")==="true",intercepted=target&&!changingFiles&&busy&&this===t.session;if(t.reloadContexts.length<16)t.reloadContexts.push({target,changingFiles,busy,intercepted});if(intercepted){t.waiting=true;await t.gate}return t.reload.apply(this,args)};return true})()');
    await click(item(queuedPath)); await wait('propertyCreationTrace.waiting&&!app.workspace.isChangingFiles&&Boolean(app.vault.getFileByPath(' + q(queuedPath) + '))&&document.querySelector(' + q(host + ' [data-property-key="status"]') + ')?.getAttribute("aria-busy")==="true"', "created note waits at the real property queue source-reload boundary after lock release");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);propertyCreationTrace.release()');
    await wait('Boolean(document.querySelector(' + q(error("status")) + ')?.textContent)&&!app.workspace.isChangingFiles', "queued property refuses the changed source mode");
    await evaluate("propertyCreationTrace.session.reload=propertyCreationTrace.reload;delete propertyCreationTrace.reload;delete propertyCreationTrace.session");
    await exact(sourceText); assert.deepEqual(await readFile(join(directory, queuedPath)), Buffer.alloc(0)); created.push(queuedPath);
    await open("preview"); await cancel(tools, "status");
    const restartName = "Wave13 persisted property creation", restartPath = restartName + ".md"; await offer(tools, "status", restartName, restartPath); await click(item(restartPath)); await exact(expectedFor("status", "[[" + restartName + "]]")); created.push(restartPath);
    const trace = await evaluate("({trusted:propertyCreationTrace.trusted,created:propertyCreationTrace.created})"); successfulTrace = trace.trusted;
    assert.ok(successfulTrace.some(event => event.type === "pointer")); assert.ok(successfulTrace.some(event => event.type === "Enter")); assert.ok(successfulTrace.every(event => event.trusted));
    for (const destination of created) assert.equal(trace.created.filter(path => path === destination).length, 1, "exactly one acknowledged create event " + destination);
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait('app.workspace.getActiveFile()?.path===' + q(path) + '&&!app.changingVault', "original property source restored after full restart/reconnect"); await mark(tools);
    await exact(expectedFor("status", "[[" + restartName + "]]")); await offer(tools, "status", "Wave13 fresh property after restart", "Wave13 fresh property after restart.md"); await capture?.("property-create-restored"); await cancel(tools, "status");
    assert.deepEqual(await readFile(join(directory, restartPath)), Buffer.alloc(0)); assert.deepEqual(await readFile(join(directory, known)), bytes(knownText));
    report.propertyNoteCreation = { actualPointerAndKeyboard: true, readingAndLivePreview: true, fixedPropertiesPane: true, rootCurrentConfiguredAndExplicitPaths: true,
      explicitWikiPreference: true, emptyCreateExactlyOnce: true, exactSourceBytes: true, commentsOpaqueAndNumericSpelling: true, isolatedUndoRedo: true, undoKeepsCreatedFile: true,
      cancellationAndUnsupportedDecline: true, realPreflightModeGuard: true, physicalCreateOnlyCollision: true, acknowledgedCleanupReceipt: true, partialPropertySaveRetained: true, realQueuedOwnerGuard: true, restartAndFreshControls: true };
    report.propertyNoteCreationTrace = { trusted: successfulTrace, created };
    pass(report, "A real held frontmatter queue runs only after file creation releases its mutation lock and rejects an owner/mode change without inserting a link or removing the created note. Full native restart/browser reconnection restores exact saved YAML and empty target bytes, with immediately usable fresh creation controls.");
  } catch (issue) {
    primaryFailure = issue;
    report.propertyNoteCreationFailure = { stage, error: String(issue?.stack ?? issue) };
    try { report.propertyNoteCreationFailure.state = await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode?.(),editing:app.workspace.activeLeaf.view.getEditingMode?.(),source:app.workspace.sessions.get(' + q(path) + ')?.text,session:(()=>{const session=app.workspace.sessions.get(' + q(path) + ');return session?{dirty:session.dirty,isSaving:session.isSaving,isReloading:session.isReloading}:null})(),changingFiles:app.workspace.isChangingFiles,fields:[...document.querySelectorAll("[data-property-key] [data-metadata-input]")].map(input=>({key:input.closest("[data-property-key]").dataset.propertyKey,value:input.value,disabled:input.disabled,readOnly:input.readOnly,visible:input.checkVisibility()})),rows:[...document.querySelectorAll("[data-property-create-note]")].map(row=>({path:row.dataset.propertyCreateNote,text:row.textContent,selected:row.getAttribute("aria-selected"),visible:row.checkVisibility()})),errors:[...document.querySelectorAll(".metadata-property-error")].filter(element=>element.textContent).map(element=>({key:element.closest("[data-property-key]")?.dataset.propertyKey,text:element.textContent,visible:element.checkVisibility()})),notices:[...document.querySelectorAll(".notice")].map(element=>element.textContent),inventory:app.vault.getMarkdownFiles().map(file=>{const entry=app.metadataCache.getDocument(file.path),session=app.workspace.sessions.get(file.path);return{path:file.path,indexed:Boolean(entry),cached:Boolean(app.metadataCache.getFileCache(file)),missing:entry?.missing??null,session:Boolean(session),sessionCurrent:session?session.originRoot===app.vault.rootPath&&!session.isReloading:null}}),trace:globalThis.propertyCreationTrace?{trusted:propertyCreationTrace.trusted,created:propertyCreationTrace.created,waiting:propertyCreationTrace.waiting,reloadContexts:propertyCreationTrace.reloadContexts??null}:null}))()'); await capture?.("property-create-precleanup-failure"); } catch { /* Keep the original failure. */ }
    throw issue;
  } finally {
    try {
    await evaluate('(()=>{const t=globalThis.propertyCreationTrace;if(t){if(t.saveAll)app.saveAll=t.saveAll;if(t.create)app.vault.create=t.create;if(t.refresh)app.metadataCache.refresh=t.refresh;if(t.session&&t.reload)t.session.reload=t.reload;if(t.session&&t.save)t.session.save=t.save;t.release?.();t.abort.abort();app.vault.offref(t.createRef)}return true})()');
    await wait("!app.workspace.isChangingFiles", "owned property creation lock settled before cleanup"); await evaluate("app.saveAll()");
    await writeFile(join(directory, path), bytes(sourceText)); await writeFile(configPath, config);
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();const source=app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===' + q(path) + ');if(source){app.workspace.setActiveLeaf(source,{focus:true});await app.reloadFromDisk()}await app.workspace.changeLayout(' + q(layout) + ');await app.workspace.flushLayout();delete globalThis.propertyCreationTrace})()');
    if (!enabled) await evaluate('app.core.setEnabled("properties",false)'); if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)");
    } catch (cleanupIssue) {
      if (!primaryFailure) { throw cleanupIssue; }
      report.propertyNoteCreationFailure.cleanupError = String(cleanupIssue?.stack ?? cleanupIssue);
    }
  }
}

/** Parent verifies cache blobs and zero API/raw counters through local return. */
export async function checkPropertyNoteCreationReadOnly(tools) {
  const { evaluate, wait, command, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  await evaluate('app.workspace.activeLeaf.view.setMode("preview")'); await mark(tools);
  try {
    for (const property of ["related", "links"]) {
      await wait('Boolean(document.querySelector(' + q(field(property)) + '))', "genuine cached read-only Properties input");
      assert.equal(await evaluate('document.querySelector(' + q(field(property)) + ').disabled'), true);
      const point = await evaluate('(()=>{const input=document.querySelector(' + q(field(property)) + ');input.scrollIntoView({block:"center",inline:"nearest"});const rect=input.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;return{value:input.value,disabled:input.disabled,visible:input.checkVisibility(),width:rect.width,height:rect.height,x,y,hit:document.elementFromPoint(x,y)===input}})()');
      assert.equal(point.disabled, true); assert.equal(point.visible, true); assert.ok(point.width > 0 && point.height > 0 && Number.isFinite(point.x) && Number.isFinite(point.y)); assert.equal(point.hit, true, "disabled Properties input must own its visible pointer hit");
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
      await command("Input.insertText", { text: "[[Cached property note" }); await key(tools, "Enter", "Enter", 13);
      assert.equal(await evaluate('document.querySelector(' + q(field(property)) + ').value'), point.value);
      assert.equal(await evaluate("app.editor.getValue()"), text);
      const previous = await evaluate('(()=>{const input=document.querySelector(' + q(field(property)) + '),previous=input.value;input.disabled=false;input.value="[[Cached property note";input.dispatchEvent(new InputEvent("input",{bubbles:true}));return previous})()');
      assert.equal(await evaluate('document.querySelectorAll(' + q(host + ' [data-property-create-note]') + ').length'), 0);
      await evaluate('(()=>{const input=document.querySelector(' + q(field(property)) + ');input.value=' + q(previous) + ';input.disabled=true;input.blur();return true})()');
    }
    await capture?.("property-create-readonly"); assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
    report.propertyNoteCreation = { ...(report.propertyNoteCreation ?? {}), genuineReadOnlyFields: true, trustedReadOnlyTypingDeclined: true, forcedReadOnlyEnumerationDeclined: true, cachedSourceAndInventoryExact: true };
    pass(report, "A genuine cache-only read-only vault keeps text/list Properties inputs disabled. Actual typing/Enter and forced eligible [[ input expose no Create note action or write; original source and inventory remain exact while the parent audits all cached blobs and zero API/raw requests.");
  } finally { await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",true)'); }
}
