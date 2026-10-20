import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

const q = JSON.stringify;
const popup = '[data-builtin-suggest="source"]:popover-open';
const row = path => popup + ` [data-builtin-create-note=${q(path)}]`;
const builtin = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const bytes = text => Buffer.from("\ufeff" + text);
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
const history = 'JSON.stringify({index:app.workspace.activeLeaf.historyIndex,entries:app.workspace.activeLeaf.history.map(entry=>({type:entry.type,file:entry.state?.file}))})';
function creationInventory() {
  return app.vault.getMarkdownFiles().map(file => {
    const cached = app.metadataCache.getFileCache(file), indexed = app.metadataCache.getDocument(file.path), session = app.workspace.sessions.get(file.path);
    return { path: file.path, cached: Boolean(cached), indexed: Boolean(indexed), missing: indexed?.missing ?? null, session: Boolean(session),
      sessionRootCurrent: session ? session.originRoot === app.vault.rootPath : null, sessionReloading: session?.isReloading ?? null,
      sessionTextLength: session?.text.length ?? null, sessionMatchesIndex: session ? session.text === indexed?.text : null };
  });
}
const inventory = `(${creationInventory.toString()})()`;

/** Root owns binding, launches, cache-only mount, build provenance and teardown. */
export async function checkNoteCreationSuggestions(tools) {
  const { directory, evaluate, command, click, wait, report, capture } = tools;
  const folder = "Create note completions", inbox = folder + "/Inbox", known = folder + "/Wave12 existing note.md";
  const original = "# Create note λ\r\n\r\nKeep 😀 prose and original CRLF.\r\n\r\nLinks: \r\n";
  const knownText = "---\r\naliases: [Wave12 exact alias]\r\n---\r\nExisting target remains exact.\r\n";
  const configPath = join(directory, ".obsidian", "app.json");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  const savedConfig = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const imported = savedConfig ? JSON.parse(savedConfig.toString("utf8").replace(/^\ufeff/, "")) : {};
  const collisionMessage = await evaluate('document.body.classList.contains("is-browser")') ? "Host 409: A file already exists at that path." : 'Host 409: {"error":"A file already exists at that path."}';
  const configure = async preferences => {
    await writeFile(configPath, bytes(JSON.stringify({ ...imported, newFileLocation: "root", newFileFolderPath: "/", newLinkFormat: "shortest", useMarkdownLinks: false, ...preferences }, null, 2).replaceAll("\n", "\r\n") + "\r\n"));
    await evaluate('app.configuration.read("app")');
  };
  const expectedCreates = [];
  let stage = "fixture indexing", current = { mode: null, path: null, query: null, destination: null };
  try {
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, inbox), { recursive: true });
    await writeFile(join(directory, known), bytes(knownText), { flag: "wx" });
    for (const mode of ["source", "live-preview"]) await writeFile(join(directory, folder, mode + ".md"), bytes(original), { flag: "wx" });
    // A single trusted input can arrive before the scheduled metadata pass. A
    // missing alias proof correctly omits Create, and cache completion alone
    // does not edit the cursor/document to retrigger that completed query.
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`(()=>{const files=${inventory};return ${q([known, folder + "/source.md", folder + "/live-preview.md"])}.every(path=>files.some(file=>file.path===path))&&files.every(file=>file.cached&&file.indexed&&!file.missing&&(!file.session||file.sessionRootCurrent&&!file.sessionReloading))})()`, "complete Markdown alias inventory indexed before typing a create-note query");
    report.noteCreationReadiness = await evaluate(inventory);
    // Register window capture before opening any test popup: its own window
    // capture handler consumes Enter and closes rows before document capture.
    await evaluate(`(()=>{const trace=globalThis.noteCreationTrace={trusted:[],creates:[],abort:new AbortController()};trace.createRef=app.vault.on("create",file=>trace.creates.push(file.path));document.addEventListener("click",event=>{const target=event.target.closest?.("[data-builtin-create-note]");if(target)trace.trusted.push({type:"pointer",trusted:event.isTrusted,path:target.dataset.builtinCreateNote,file:app.workspace.getActiveFile()?.path??null})},{capture:true,signal:trace.abort.signal});window.addEventListener("keydown",event=>{const selected=document.querySelector(${q(popup + " [data-builtin-create-note][aria-selected=true]")}),editor=app.workspace.activeEditor?.editor;if(["Enter","Tab"].includes(event.key)&&selected&&event.target instanceof Node&&editor?.cm.dom.contains(event.target))trace.trusted.push({type:event.key,trusted:event.isTrusted,path:selected.dataset.builtinCreateNote,file:app.workspace.getActiveFile()?.path??null})},{capture:true,signal:trace.abort.signal})})()`);
    for (const mode of ["source", "live-preview"]) {
      const path = folder + "/" + mode + ".md";
      stage = "open source"; current = { mode, path, query: null, destination: null };
      await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()})()`);
      await command("Page.bringToFront");
      let completed = original;
      const focus = async () => evaluate("app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()");
      const reset = async () => {
        await evaluate(`(()=>{const editor=app.editor;editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(completed)},"input.creation-fixture");editor.setCursor(4,editor.getLine(4).length);editor.focus()})()`);
        await evaluate("app.saveAll()");
      };
      const type = async query => {
        current.query = query;
        await focus(); await command("Input.insertText", { text: " [[" + query });
        return completed.replace(/\r\n$/, " [[" + query + "\r\n");
      };
      const navigation = await evaluate(history);
      for (const [location, markdown, format] of [["root", false, "shortest"], ["current", false, "absolute"], ["folder", true, "relative"], ["explicit", false, "relative"]]) {
        stage = "configure " + location + " destination";
        await configure({ newFileLocation: location === "explicit" ? "folder" : location, newFileFolderPath: inbox, useMarkdownLinks: markdown, newLinkFormat: format });
        const name = `Wave12 ${mode} ${location} 深い`, query = location === "explicit" ? folder + "/Explicit/" + name + ".md" : name;
        const destination = await evaluate(`app.fileManager.getNewNotePath(${q(query)},${q(path)},true)`);
        current.destination = destination;
        const expected = location === "current" ? folder + "/" + name + ".md" : location === "folder" ? inbox + "/" + name + ".md" : location === "explicit" ? query : name + ".md";
        assert.equal(destination, expected);
        stage = "await explicit create-note row";
        const typed = await type(query), selector = row(destination);
        await wait(`Boolean(document.querySelector(${q(selector)}))`, "explicit create-note action with reviewed destination");
        assert.deepEqual(await evaluate(`(()=>{const row=document.querySelector(${q(selector)});return{title:row.querySelector(".suggestion-title").textContent,path:row.querySelector(".suggestion-note").textContent,known:row.dataset.builtinLink??null}})()`), { title: "Create note: " + query, path: destination, known: null });
        assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${q(destination)}))`), false, "typing and rendering only review a new note");
        if (mode === "source" && location === "root") await capture?.("create-note-popup");
        stage = "accept explicit create-note row";
        if (location === "root") await key(command, "Enter", "Enter", 13); else await click(selector);
        await wait(`!app.workspace.isChangingFiles&&Boolean(app.vault.getFileByPath(${q(destination)}))&&app.editor.getValue()!==${q(typed)}`, "create-only acknowledgement followed by source link insertion");
        const token = await evaluate(`app.fileManager.generateMarkdownLink(app.vault.getFileByPath(${q(destination)}),${q(path)})`);
        completed = completed.replace(/\r\n$/, " " + token + "\r\n");
        assert.equal(await evaluate("app.editor.getValue()"), completed); assert.equal(await evaluate("app.workspace.getActiveFile().path"), path);
        assert.equal(await evaluate(`noteCreationTrace.trusted.some(event=>event.type===${q(location === "root" ? "Enter" : "pointer")}&&event.trusted&&event.path===${q(destination)}&&event.file===${q(path)})`), true, "the accepted completion has an actual trusted input scoped to its exact source and destination");
        assert.equal(await evaluate(history), navigation, "creating a completion does not silently navigate or add history");
        expectedCreates.push(destination); assert.deepEqual(await readFile(join(directory, destination)), Buffer.alloc(0));
        stage = "trusted completion Undo/Redo";
        await focus(); await key(command, "z", "KeyZ", 90, 2);
        await wait(`app.editor.getValue()===${q(typed)}`, "trusted Undo restores exactly the typed query");
        assert.deepEqual(await readFile(join(directory, destination)), Buffer.alloc(0), "Undo retains the acknowledged new note");
        // The installed CodeMirror Windows history keymap binds Redo to Mod-y.
        await key(command, "y", "KeyY", 89, 2); await wait(`app.editor.getValue()===${q(completed)}`, "trusted Redo restores only the source link");
        await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      }
      pass(report, `${mode}: actual Enter and pointer Create note actions honor root/current/configured-folder/explicit safe destinations and wiki/Markdown link preferences, keep the source/history, create exact empty notes once, and retain BOM/CRLF/Unicode through isolated trusted Undo/Redo.`);

      await configure({});
      stage = "cancel explicit creation"; current.destination = null;
      const cancelled = `Wave12 ${mode} cancelled`, cancelledPath = cancelled + ".md", cancelledText = await type(cancelled);
      await wait(`Boolean(document.querySelector(${q(row(cancelledPath))}))`, "cancelable explicit creation action");
      await key(command, "Escape", "Escape", 27); assert.equal(await evaluate("app.editor.getValue()"), cancelledText);
      assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${q(cancelledPath)}))`), false); await reset();
      for (const query of ["Wave12 existing note", "Wave12 exact alias", "../../Outside wave12", "Missing image.png", "Folder/", "#Missing heading", "#^missing-block"]) {
        stage = "refuse unsupported or existing query"; current.destination = null;
        const typed = await type(query);
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate(`Boolean(document.querySelector(${q(popup + " [data-builtin-create-note]")}))`), false, query);
        assert.equal(await evaluate("app.editor.getValue()"), typed); await key(command, "Escape", "Escape", 27); await reset();
      }
      pass(report, `${mode}: Escape creates nothing; exact existing notes/aliases, escaping paths, unsupported attachments, incomplete folder paths and heading/block prefixes expose no Create note action.`);

      // Hold real saveAll, then change only the source selection before the
      // guarded FileManager write. The user acceptance still uses real input.
      stage = "refuse stale source selection"; current.destination = null;
      const stale = `Wave12 ${mode} stale selection`, stalePath = stale + ".md", staleText = await type(stale);
      await wait(`Boolean(document.querySelector(${q(row(stalePath))}))`, "held source selection creation action");
      await evaluate('(()=>{const t=noteCreationTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){await t.saveAll.apply(this,args);t.waiting=true;await t.gate}})()');
      await expectErrors(tools, [{ source: "notification", message: "The note or its destination changed before creation. No note was created." }], async () => {
        await click(row(stalePath)); await wait("noteCreationTrace.waiting", "real source save held before creation");
        await evaluate("app.editor.setCursor(0,0);app.saveAll=noteCreationTrace.saveAll;delete noteCreationTrace.saveAll;noteCreationTrace.release()");
        await wait('!app.workspace.isChangingFiles&&!(' + builtin + ').pendingCreate&&document.querySelector("#client-errors").textContent.includes("changed before creation")', "stale source selection refused before create-only write");
      }, mode + ": intentionally invalidate the captured source selection while real saveAll is held; the guarded create must refuse before writing");
      assert.equal(await evaluate("app.editor.getValue()"), staleText); assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${q(stalePath)}))`), false);
      await click("[data-dismiss-error]"); await reset();

      // A physical create-only collision happens after the preview and guard,
      // before the real host write; no stub replaces the actual write operation.
      stage = "refuse physical create-only collision"; current.destination = null;
      const collision = `Wave12 ${mode} collision`, collisionPath = collision + ".md", collisionText = await type(collision), collisionBytes = bytes("External existing 深い\r\n");
      await wait(`Boolean(document.querySelector(${q(row(collisionPath))}))`, "create-only collision preview");
      await evaluate(`(()=>{const t=noteCreationTrace;t.vaultCreate=app.vault.create;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.create=async function(path,...args){if(path===${q(collisionPath)}){t.waiting=true;await t.gate}return t.vaultCreate.call(this,path,...args)}})()`);
      await expectErrors(tools, [{ source: "notification", message: collisionMessage }], async () => {
        await click(row(collisionPath)); await wait("noteCreationTrace.waiting", "real Vault.create held before host collision check");
        await writeFile(join(directory, collisionPath), collisionBytes, { flag: "wx" });
        await evaluate("app.vault.create=noteCreationTrace.vaultCreate;noteCreationTrace.release()");
        await wait('!app.workspace.isChangingFiles&&!(' + builtin + ').pendingCreate&&document.querySelector("#client-errors").textContent.length>0', "create-only collision visibly refused");
      }, mode + ": intentionally create a physical BOM/CRLF collision after review; the actual browser/native create-only backend must refuse its one write");
      await evaluate("delete noteCreationTrace.vaultCreate");
      assert.equal(await evaluate("app.editor.getValue()"), collisionText); assert.deepEqual(await readFile(join(directory, collisionPath)), collisionBytes);
      await click("[data-dismiss-error]"); await reset();

      // Let the real create finish, hold its acknowledgement, and invalidate the
      // source cursor. Keeping that completed write is deliberate, observable.
      stage = "retain creation after stale acknowledgement"; current.destination = null;
      const retained = `Wave12 ${mode} retained after stale acknowledgement`, retainedPath = retained + ".md", retainedText = await type(retained);
      await wait(`Boolean(document.querySelector(${q(row(retainedPath))}))`, "retained-note acknowledgement preview");
      await evaluate(`(()=>{const t=noteCreationTrace;t.vaultCreate=app.vault.create;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.create=async function(path,...args){const file=await t.vaultCreate.call(this,path,...args);if(path===${q(retainedPath)}){t.waiting=true;await t.gate}return file}})()`);
      await click(row(retainedPath)); await wait("noteCreationTrace.waiting", "real empty note created before held acknowledgement");
      await evaluate("app.editor.setCursor(0,0);app.vault.create=noteCreationTrace.vaultCreate;noteCreationTrace.release()");
      await wait('!app.workspace.isChangingFiles&&!(' + builtin + ').pendingCreate&&[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(' + q(retainedPath) + ')&&note.textContent.includes("new note was kept"))', "completed create retained with an explicit no-link notice");
      await evaluate("delete noteCreationTrace.vaultCreate");
      assert.equal(await evaluate("app.editor.getValue()"), retainedText); assert.deepEqual(await readFile(join(directory, retainedPath)), Buffer.alloc(0));
      expectedCreates.push(retainedPath); await reset();

      stage = "retain acknowledged creation after refresh failure"; current.destination = null;
      const cleanup = `Wave12 ${mode} retained after cleanup failure`, cleanupPath = cleanup + ".md", cleanupText = await type(cleanup);
      await wait(`Boolean(document.querySelector(${q(row(cleanupPath))}))`, "post-write cleanup failure preview");
      await evaluate(`(()=>{const t=noteCreationTrace;t.vaultCreate=app.vault.create;t.refresh=app.metadataCache.refresh;t.failRefresh=false;app.vault.create=async function(path,...args){const file=await t.vaultCreate.call(this,path,...args);if(path===${q(cleanupPath)})t.failRefresh=true;return file};app.metadataCache.refresh=async function(...args){if(t.failRefresh){t.failRefresh=false;throw new Error("Wave12 post-write refresh failure")}return t.refresh.apply(this,args)}})()`);
      await expectErrors(tools, [{ source: "notification", message: "Wave12 post-write refresh failure" }], async () => {
        await click(row(cleanupPath));
        await wait('!app.workspace.isChangingFiles&&!(' + builtin + ').pendingCreate&&document.querySelector("#client-errors").textContent.includes("Wave12 post-write refresh failure")&&[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(' + q(cleanupPath) + ')&&note.textContent.includes("new note was kept"))', "acknowledged create retained despite reported post-write refresh failure");
      }, mode + ": inject exactly one metadata refresh failure after a real create acknowledgement; retain its exact receipt, kept note and original error without inserting a success link");
      await evaluate("app.vault.create=noteCreationTrace.vaultCreate;app.metadataCache.refresh=noteCreationTrace.refresh;delete noteCreationTrace.vaultCreate;delete noteCreationTrace.refresh");
      assert.equal(await evaluate("app.editor.getValue()"), cleanupText); assert.deepEqual(await readFile(join(directory, cleanupPath)), Buffer.alloc(0));
      expectedCreates.push(cleanupPath); await click("[data-dismiss-error]"); await reset();
      assert.equal(await evaluate(history), navigation); assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      assert.deepEqual(await readFile(join(directory, known)), bytes(knownText));
      pass(report, `${mode}: accepted stale selections and real physical create-only collisions preserve exact source/existing-note bytes and history; genuinely created notes with stale acknowledgement or a later refresh failure are retained with visible notices, reported errors where applicable, and no inserted links.`);
    }
    const trusted = await evaluate("noteCreationTrace.trusted"), creates = await evaluate("noteCreationTrace.creates");
    assert.ok(trusted.some(event => event.type === "Enter")); assert.ok(trusted.some(event => event.type === "pointer"));
    assert.ok(trusted.every(event => event.trusted), "normal feature acceptance uses browser-trusted input");
    for (const path of expectedCreates) assert.equal(creates.filter(value => value === path).length, 1, "exactly one normal create event: " + path);
    report.noteCreation = { ...(report.noteCreation ?? {}), modes: ["source", "live-preview"], trusted, created: expectedCreates, originalBytesRetained: true, createOnlyCollision: true, staleCreatedNoteRetained: true, acknowledgedCleanupFailureRetained: true };
  } catch (error) {
    report.noteCreationFailure = { stage, ...current, error: String(error?.stack ?? error) };
    try {
      report.noteCreationFailure.state = await evaluate(`(()=>{const file=app.workspace.getActiveFile(),editor=app.workspace.activeEditor?.editor??app.editor,suggest=${builtin};let trigger=null,choices=[],providerError=null;try{if(editor&&file&&suggest){const cursor=editor.getCursor();trigger=suggest.onTrigger(cursor,editor,file);if(trigger)choices=suggest.getSuggestions({...trigger,editor,file}).map(value=>({kind:value.kind,path:value.path??null,name:value.name??null,alias:value.alias??null,targetPath:value.target?.path??null}))}}catch(error){providerError=String(error?.stack??error)}return{root:app.vault.rootPath,file:file?.path??null,mode:app.workspace.activeLeaf.view.getMode?.()??null,editingMode:app.workspace.activeLeaf.view.getEditingMode?.()??null,source:editor?.getValue()??null,cursor:editor?.getCursor()??null,focused:editor?.cm.hasFocus??false,connected:editor?.cm.dom.isConnected??false,readOnly:editor?.cm.state.readOnly??null,editable:editor?.cm.contentDOM.isContentEditable??null,composing:editor?.cm.composing??false,selectionCount:editor?.cm.state.selection.ranges.length??null,selectionEmpty:editor?.cm.state.selection.main.empty??null,activeTag:document.activeElement?.tagName??null,changingVault:app.changingVault,changingFiles:app.workspace.isChangingFiles,provider:{open:suggest?.isOpen??false,pending:Boolean(suggest?.pendingCreate),contextFile:suggest?.context?.file.path??null,contextQuery:suggest?.context?.query??null,trigger,choices,error:providerError},rows:[...document.querySelectorAll('[data-builtin-suggest="source"] .suggestion-item')].map(row=>({text:row.textContent,create:row.dataset.builtinCreateNote??null,link:row.dataset.builtinLink??null,selected:row.getAttribute("aria-selected"),visible:row.checkVisibility()})),preferences:Object.fromEntries(["newFileLocation","newFileFolderPath","newLinkFormat","useMarkdownLinks"].map(key=>[key,app.vault.getConfig(key)])),inventory:${inventory},metadataIssues:app.metadataCache.getIssues().map(issue=>({path:issue.path,message:issue.message})),created:globalThis.noteCreationTrace?.creates??[],trusted:globalThis.noteCreationTrace?.trusted??[]}})()`);
    } catch (diagnosticError) { report.noteCreationFailure.diagnosticError = String(diagnosticError?.stack ?? diagnosticError); }
    try { await capture?.("create-note-precleanup-failure"); }
    catch (captureError) { report.noteCreationFailure.captureError = String(captureError?.stack ?? captureError); }
    throw error;
  } finally {
    await evaluate("(()=>{const t=globalThis.noteCreationTrace;if(t){if(t.saveAll)app.saveAll=t.saveAll;if(t.vaultCreate)app.vault.create=t.vaultCreate;if(t.refresh)app.metadataCache.refresh=t.refresh;t.release?.();t.abort.abort();app.vault.offref(t.createRef)}return true})()");
    await wait('!app.workspace.isChangingFiles&&!(' + builtin + ').pendingCreate', "all owned creation callbacks settled before cleanup");
    await evaluate("app.saveAll()");
    if (savedConfig) await writeFile(configPath, savedConfig); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await evaluate('app.configuration.read("app")');
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate("app.workspace.flushLayout()");
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)");
    await evaluate("delete globalThis.noteCreationTrace");
  }
}

/** Root supplies an actual cache-only read-only source note and audits zero traffic/blob identity. */
export async function checkNoteCreationSuggestionsReadOnly({ evaluate, command, wait, report }) {
  const original = await evaluate("app.editor.getValue()"), paths = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const proof = await evaluate(`(()=>{const editor=app.editor,file=app.workspace.getActiveFile(),lines=editor.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value.includes("[[Cached missing creation"));if(line<0)throw new Error("Missing genuine cached creation prefix");editor.setCursor(line,lines[line].length);editor.focus();const suggest=${builtin},cursor=editor.getCursor(),context={editor,file,start:cursor,end:cursor,query:"Cached missing creation"};return{trigger:suggest.onTrigger(cursor,editor,file),choices:suggest.getSuggestions(context).length}})()`);
  assert.deepEqual(proof, { trigger: null, choices: 0 });
  await command("Page.bringToFront"); await command("Input.insertText", { text: "[[Cache-only creation attempt" }); await key(command, "Enter", "Enter", 13);
  await wait(`!document.querySelector(${q(popup)})`, "cached read-only create action remains closed");
  assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), paths);
  report.noteCreation = { ...(report.noteCreation ?? {}), readOnly: { genuineCacheOnly: true, triggerDeclined: true, directEnumerationDeclined: true, trustedTypingDeclined: true, sourceAndInventoryUnchanged: true } };
  pass(report, "A genuine cache-only read-only source prefix refuses Create note triggering, direct enumeration and trusted insertion/Enter without changing source or the vault inventory; the parent audits network counters and exact cached blobs.");
}
