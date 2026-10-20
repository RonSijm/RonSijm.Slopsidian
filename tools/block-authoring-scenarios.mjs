import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors, saveConflictMessage } from "./error-log-audit.mjs";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const popup = '[data-builtin-suggest="source"]:popover-open';
const provider = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const row = (path, from) => `${popup} [data-builtin-create-block=${q(path)}][data-builtin-block-start=${q(String(from))}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const before = "Before paragraph λ 😀 stays addressable.";
const after = "After paragraph Ω stays addressable.";
const sourceText = ['---', 'status: Preserve block source', '---', '# Block source λ', '', before, '', 'Reference: ', '', after, ''].join("\r\n");
const targetBody = "Target paragraph λ 😀 stays addressable.";
const targetText = ['---', 'opaque: "Preserve target BOM and CRLF"', '---', '# Target', '', targetBody, '', 'Other target prose remains exact.', ''].join("\r\n");
const targetBodyLine = targetText.split("\r\n").indexOf(targetBody);
const queryLine = sourceText.split("\r\n").indexOf("Reference: ");
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function settled(tools) { await tools.wait('!app.workspace.isChangingFiles&&!(' + provider + ').pendingCreate', "the real block authoring operation settled"); }
async function escape(tools) { await key(tools.command, "Escape", "Escape", 27); await tools.wait(`!document.querySelector(${q(popup)})`, "the block popup was dismissed"); }
function marker(text, body) {
  const offset = text.indexOf(body); assert.ok(offset >= 0);
  const found = /^ \^([a-z0-9]{6})(?=\r?\n|$)/.exec(text.slice(offset + body.length));
  assert.ok(found, "exactly one six-character marker follows the actual paragraph"); return found[1];
}

function readOnlyBlockProof() {
  const editor = app.editor, file = app.workspace.getActiveFile(), lines = editor.getValue().split(/\r?\n/);
  const line = lines.findIndex(value => value.includes("[[Known target#^Cached paragraph"));
  if (line < 0) throw Error("Missing genuine cached block authoring prefix");
  const target = app.metadataCache.getDocument("Known target.md"), body = "Cached paragraph λ 😀.";
  const section = target?.cache.sections.find(value => value.type === "paragraph"
    && target.text.slice(value.position.start.offset, value.position.end.offset).trim() === body);
  if (!target || target.missing || !section) throw Error("Missing actual eligible cached paragraph target");
  const from = section.position.start.offset, to = section.position.end.offset;
  if (target.cache.ignored.some(range => range.from < to && range.to > from)
    || target.cache.sections.some(value => ["blockquote", "bulletlist", "orderedlist"].includes(value.type)
      && value.position.start.offset <= from && value.position.end.offset >= to)
    || Object.values(target.cache.blocks).some(value => value.position.start.offset < to && value.position.end.offset > from)) {
    throw Error("Cached paragraph belongs to an unsupported block or already has an ID");
  }
  editor.setCursor(line, lines[line].length); editor.focus();
  const suggest = app.editorSuggestions.suggests.find(value => value.containerEl.dataset.builtinSuggest === "source"), cursor = editor.getCursor();
  return { targetEligible: true, trigger: suggest.onTrigger(cursor, editor, file), choices: suggest.getSuggestions({ editor, file, start: cursor, end: cursor, query: "Known target#^Cached paragraph" }).length };
}

/** Shared real-control acceptance. Root owns builds, host launch, cache fixture and final audits. */
export async function checkBlockAuthoring(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Block authoring", source = mode => folder + "/" + mode + ".md", target = mode => folder + "/Target " + mode + ".md";
  const kinds = folder + "/Kinds.md", kindBody = "Plain candidate paragraph stays exact.";
  const kindsText = ['# Unsupported kinds', '', '- Unsupported list prose', '', '> Unsupported quote prose', '', '```md', 'Unsupported code prose', '```', '', 'Unsupported math $x^2$ prose', '', 'Already labelled prose ^known1', '', kindBody, ''].join("\r\n");
  const edgeNames = ["Guard", "Collision", "Retained source", "Changed target", "Cleanup"], edge = name => folder + "/" + name + ".md";
  const configPath = join(directory, ".obsidian", "app.json"), config = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const options = config ? JSON.parse(config.toString("utf8").replace(/^\ufeff/, "")) : {};
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), foldProfile = await evaluate('app.loadLocalStorage("fold-state-v1")');
  const expected = new Map(), ids = [], modes = ["source", "live-preview"];
  let stage = "fixture", current = {};
  const configure = async format => {
    await writeFile(configPath, bytes(JSON.stringify({ ...options, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: false }, null, 2).replaceAll("\n", "\r\n") + "\r\n"));
    await evaluate('app.configuration.read("app");app.markdownAutosave.configure()');
  };
  const open = async (mode, text = sourceText) => {
    await evaluate(`(async()=>{await app.openFile(${q(source(mode))});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});const editor=app.editor;editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(text)},"input.block-fixture");editor.setCursor(${queryLine},editor.getLine(${queryLine}).length);editor.focus()})()`);
    await command("Page.bringToFront");
    await wait(`app.workspace.getActiveFile()?.path===${q(source(mode))}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}&&app.editor.cm.hasFocus`, "the real block source editor is focused");
  };
  const type = async (mode, prefix, text = sourceText) => {
    await open(mode, text); await command("Input.insertText", { text: prefix });
    const typed = text.replace("Reference: \r\n", "Reference: " + prefix + "\r\n");
    assert.equal(await evaluate("app.editor.getValue()"), typed); return typed;
  };
  const select = async (path, from, method) => {
    const selector = row(path, from); await wait(`Boolean(document.querySelector(${q(selector)}))`, "actual unlabelled paragraph authoring row");
    if (method === "pointer") await click(selector);
    else {
      for (let index = 0; index < 40; index++) {
        if (await evaluate(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`)) break;
        await key(command, "ArrowDown", "ArrowDown", 40);
      }
      await wait(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`, "the real new block row is selected before trusted Enter");
      await key(command, "Enter", "Enter", 13);
    }
    await settled(tools);
  };
  const exact = async (path, text) => { assert.deepEqual(await readFile(join(directory, path)), bytes(text)); };
  const reset = async () => { await escape(tools); await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText); };
  const restoredMethods = '(function(){const t=globalThis.blockAuthoringTrace;if(!t)return;if(t.saveAll)app.saveAll=t.saveAll;if(t.assign)app.fileManager.assignBlockId=t.assign;if(t.write)app.vault.writeDocument=t.write;if(t.refresh)app.metadataCache.refresh=t.refresh;t.release?.();delete t.saveAll;delete t.assign;delete t.write;delete t.refresh})()';
  try {
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, folder), { recursive: true });
    for (const mode of modes) { await writeFile(join(directory, source(mode)), bytes(sourceText), { flag: "wx" }); await writeFile(join(directory, target(mode)), bytes(targetText), { flag: "wx" }); expected.set(source(mode), sourceText); expected.set(target(mode), targetText); }
    await writeFile(join(directory, kinds), bytes(kindsText), { flag: "wx" }); expected.set(kinds, kindsText);
    for (const name of edgeNames) { await writeFile(join(directory, edge(name)), bytes(targetText), { flag: "wx" }); expected.set(edge(name), targetText); }
    await configure("shortest"); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`${q([...expected.keys()])}.every(path=>app.metadataCache.getDocument(path)?.text===${q(targetText)}||app.metadataCache.getDocument(path)?.text===${q(sourceText)}||app.metadataCache.getDocument(path)?.text===${q(kindsText)})`, "all actual block fixture files are indexed before input");
    // Window capture precedes the popup's own Enter handler; event records are
    // scoped to the selected path/offset and real current source file.
    await evaluate(`(()=>{const t=globalThis.blockAuthoringTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const r=event.target.closest?.("[data-builtin-create-block]");if(r)t.trusted.push({type:"pointer",trusted:event.isTrusted,phase:t.phase??"normal",path:r.dataset.builtinCreateBlock,from:Number(r.dataset.builtinBlockStart),file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal});window.addEventListener("keydown",event=>{const r=document.querySelector(${q(popup + " [data-builtin-create-block][aria-selected=true]")}),editor=app.workspace.activeEditor?.editor;if(event.key==="Enter"&&r&&event.target instanceof Node&&editor?.cm.dom.contains(event.target))t.trusted.push({type:"Enter",trusted:event.isTrusted,phase:t.phase??"normal",path:r.dataset.builtinCreateBlock,from:Number(r.dataset.builtinBlockStart),file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal})})()`);

    for (const mode of modes) {
      await configure(mode === "source" ? "shortest" : "absolute");
      for (const [body, method] of [[before, "Enter"], [after, "pointer"]]) {
        stage = "same-note atomic completion"; current = { mode, path: source(mode), body };
        const prefix = "[[#^" + body.split(" λ")[0].split(" Ω")[0], typed = await type(mode, prefix), from = typed.indexOf(body);
        await evaluate("(()=>{const t=blockAuthoringTrace;t.sourceEditor=app.editor;t.sourceCm=app.editor.cm;t.sourceLeaf=app.workspace.activeLeaf;return true})()");
        await select(source(mode), from, method);
        const actual = await evaluate("app.editor.getValue()"), id = marker(actual, body);
        const completed = typed.replace(body, body + " ^" + id).replace(prefix, "[[#^" + id + "]]");
        assert.equal(actual, completed); assert.equal(await evaluate("app.editor===blockAuthoringTrace.sourceEditor&&app.editor.cm===blockAuthoringTrace.sourceCm&&app.workspace.activeLeaf===blockAuthoringTrace.sourceLeaf"), true);
        assert.equal(await evaluate(`blockAuthoringTrace.trusted.some(event=>event.type===${q(method)}&&event.trusted&&event.path===${q(source(mode))}&&event.from===${from}&&event.file===${q(source(mode))}&&event.mode===${q(mode)})`), true);
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed, "one trusted Undo removes both same-note edits");
        await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed);
        await evaluate("app.saveAll()"); await exact(source(mode), completed); ids.push({ mode, sameNote: true, id, path: source(mode) });
        if (body === before) {
          // Already-labelled paragraphs remain existing-ID choices and never
          // receive a second ID through the authoring action.
          await command("Input.insertText", { text: " [[#^" + id });
          await wait(`Boolean(document.querySelector(${q(popup + ` [data-builtin-block=${q(id)}]`)}))`, "freshly assigned ID is an ordinary existing block choice");
          assert.equal(await evaluate(`Boolean(document.querySelector(${q(row(source(mode), completed.indexOf(before)))}))`), false);
          await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), completed);
        }
        await capture?.("block-authoring-same-note-" + mode);
      }
      pass(report, `${mode}: actual Enter and pointer authoring choices attach a six-character ID to a genuine same-note paragraph before or after the query and insert its exact wiki link in one isolated Undo/Redo step. Freshly labelled prose becomes an existing-ID choice; BOM/CRLF/Unicode, editor identity and unrelated text remain intact.`);

      stage = "cross-note clean shared target"; current = { mode, path: source(mode), target: target(mode) };
      await open(mode);
      await evaluate(`(async()=>{const t=blockAuthoringTrace;t.sourceLeaf=app.workspace.activeLeaf;const peer=app.workspace.getLeaf("split");await peer.openFile(app.vault.getFileByPath(${q(target(mode))}));peer.view.setEditingMode("source");app.workspace.setActiveLeaf(peer,{focus:true});t.peer=peer;t.peerEditor=peer.view.editor;t.peerCm=t.peerEditor.cm;t.peerEditor.setCursor(${targetBodyLine},0);t.peerEditor.focus()})()`);
      await command("Input.insertText", { text: "History " }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), targetText);
      await evaluate("(()=>{app.workspace.setActiveLeaf(blockAuthoringTrace.sourceLeaf,{focus:true});app.editor.setCursor(" + queryLine + ",app.editor.getLine(" + queryLine + ").length);app.editor.focus();return true})()");
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target(mode))}),${q(source(mode))})`), prefix = "[[" + linktext + "#^Target paragraph";
      await command("Input.insertText", { text: prefix });
      const typed = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n"); assert.equal(await evaluate("app.editor.getValue()"), typed);
      await select(target(mode), targetText.indexOf(targetBody), mode === "source" ? "pointer" : "Enter");
      assert.equal(await evaluate(`blockAuthoringTrace.trusted.some(event=>event.type===${q(mode === "source" ? "pointer" : "Enter")}&&event.trusted&&event.phase==="normal"&&event.path===${q(target(mode))}&&event.from===${targetText.indexOf(targetBody)}&&event.file===${q(source(mode))}&&event.mode===${q(mode)})`), true);
      const written = (await readFile(join(directory, target(mode)))).toString("utf8").replace(/^\ufeff/, ""), id = marker(written, targetBody), marked = targetText.replace(targetBody, targetBody + " ^" + id);
      assert.equal(written, marked); const completed = typed.replace(prefix, "[[" + linktext + "#^" + id + "]]");
      assert.equal(await evaluate("app.editor.getValue()"), completed); assert.equal(await evaluate("app.workspace.activeLeaf===blockAuthoringTrace.sourceLeaf&&blockAuthoringTrace.peer.view.editor===blockAuthoringTrace.peerEditor&&blockAuthoringTrace.peer.view.editor.cm===blockAuthoringTrace.peerCm&&blockAuthoringTrace.peer.view.editor.getValue()"), marked);
      await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed); await exact(target(mode), marked);
      await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed);
      await capture?.("block-authoring-cross-note-" + mode);
      await evaluate("(()=>{app.workspace.setActiveLeaf(blockAuthoringTrace.peer,{focus:true});app.editor.focus();return true})()");
      await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), marked.replace(targetBody, "History " + targetBody), "external marker insertion preserves the clean peer's earlier redo");
      await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), marked);
      await evaluate("(()=>{app.workspace.setActiveLeaf(blockAuthoringTrace.sourceLeaf,{focus:true});app.editor.focus();return true})()"); await evaluate("app.workspace.closeLeaf(blockAuthoringTrace.peer)"); await evaluate("delete blockAuthoringTrace.peer");
      expected.set(source(mode), completed); expected.set(target(mode), marked); ids.push({ mode, sameNote: false, id, path: target(mode) });
      pass(report, `${mode}: a real optimistic target write precedes source-link insertion and updates an already-open clean target without replacing its editor or earlier Undo/Redo. Source Undo removes only the inserted link and keeps the other note's acknowledged ID; normal saving preserves exact BOM/CRLF/Unicode target and source bytes.`);
    }

    stage = "unsupported and held target choices";
    for (const query of ["Unsupported math"]) {
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(kinds)}),${q(source("source"))})`), prefix = "[[" + linktext + "#^" + query;
      const typed = await type("source", prefix);
      assert.equal(await evaluate(`(()=>{const s=${provider},e=app.editor,f=app.workspace.getActiveFile(),t=s.onTrigger(e.getCursor(),e,f);return Boolean(t)&&s.getSuggestions({...t,editor:e,file:f}).every(value=>value.kind!=="create-block")})()`), true);
      await escape(tools); assert.equal(await evaluate("app.editor.getValue()"), typed); await exact(kinds, kindsText);
    }
    const kindLink = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(kinds)}),${q(source("source"))})`), heldTyped = await type("source", "[[" + kindLink + "#^Plain candidate");
    await wait(`Boolean(document.querySelector(${q(row(kinds, kindsText.indexOf(kindBody)))}))`, "actual new block row before target replacement");
    await evaluate(`(()=>{const t=blockAuthoringTrace,s=${provider};t.held={element:document.querySelector(${q(row(kinds, kindsText.indexOf(kindBody)))}),provider:s,value:s.getSuggestions(s.context).find(value=>value.kind==="create-block"&&value.path===${q(kinds)})};return true})()`);
    const changedKinds = kindsText.replace(kindBody, "Other candidate paragraph stays exact."); await writeFile(join(directory, kinds), bytes(changedKinds)); await evaluate("app.metadataCache.refresh()");
    await wait(`app.metadataCache.getDocument(${q(kinds)})?.text===${q(changedKinds)}`, "held target body replacement is actually indexed");
    await evaluate("(async()=>{const t=blockAuthoringTrace,h=t.held;t.phase=\"retained-target\";try{h.element.click();await h.provider.selectSuggestion(h.value)}finally{delete t.held;delete t.phase}})()");
    assert.equal(await evaluate("app.editor.getValue()"), heldTyped); await exact(kinds, changedKinds);
    await writeFile(join(directory, kinds), bytes(kindsText)); await evaluate("app.metadataCache.refresh()"); await reset();
    pass(report, "Math exposes no authoring action. An actual held paragraph row and direct retained provider value refuse an observed changed target body, preserving the newer target and source without a speculative marker or link.");

    const edgeQuery = async name => {
      const path = edge(name), linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(source("source"))})`), prefix = "[[" + linktext + "#^Target paragraph";
      current = { mode: "source", path: source("source"), target: path, edge: name };
      const typed = await type("source", prefix); await wait(`Boolean(document.querySelector(${q(row(path, targetText.indexOf(targetBody)))}))`, "guarded real target authoring row"); return { path, typed, selector: row(path, targetText.indexOf(targetBody)) };
    };
    stage = "source changes during real preflight";
    const guard = await edgeQuery("Guard"), refusal = "The source or target note changed. No target edit was added.";
    await evaluate('(()=>{const t=blockAuthoringTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)}})()');
    await expectErrors(tools, [{ source: "notification", message: refusal }], async () => {
      await click(guard.selector); await wait("blockAuthoringTrace.waiting", "actual saveAll is held inside block authoring preflight");
      await evaluate("app.editor.setCursor(0,0);app.saveAll=blockAuthoringTrace.saveAll;blockAuthoringTrace.release()");
      await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(refusal)})`, "the stale source was visibly refused");
    }, "invalidate the actual source cursor while the real FileManager save preflight is held; no target marker may be written");
    await evaluate(restoredMethods); assert.equal(await evaluate("app.editor.getValue()"), guard.typed); await exact(guard.path, targetText); await click("[data-dismiss-error]"); await reset();

    stage = "physical target write conflict";
    const conflict = await edgeQuery("Collision"), conflictMessage = await saveConflictMessage(tools), external = targetText.replace(targetBody, "External target prose λ 😀 must survive.");
    await evaluate(`(()=>{const t=blockAuthoringTrace;t.write=app.vault.writeDocument;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.writeDocument=async function(path,...args){if(path===${q(conflict.path)}){t.waiting=true;await t.gate}return t.write.call(this,path,...args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: conflictMessage }], async () => {
      await click(conflict.selector); await wait("blockAuthoringTrace.waiting", "actual optimistic write held after its reviewed read/version");
      await writeFile(join(directory, conflict.path), bytes(external)); await evaluate("app.vault.writeDocument=blockAuthoringTrace.write;blockAuthoringTrace.release()"); await settled(tools);
      await wait(`document.querySelector("#client-errors").textContent.includes(${q(conflictMessage)})`, "the actual host version conflict is visible");
    }, "physically replace the target between its real reviewed read and optimistic host write; preserve external bytes and decline source insertion");
    await evaluate(restoredMethods); assert.equal(await evaluate("app.editor.getValue()"), conflict.typed); await exact(conflict.path, external); expected.set(conflict.path, external); await click("[data-dismiss-error]"); await reset();
    pass(report, "Real FileManager preflight refuses a changed source cursor before adding an ID. A physical target replacement after the reviewed version read makes the actual optimistic write fail without overwriting external BOM/CRLF bytes or inserting a source link; all original guards and error reporting stay active.");

    const holdAssignment = async () => evaluate('(()=>{const t=blockAuthoringTrace;t.assign=app.fileManager.assignBlockId;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.fileManager.assignBlockId=async function(...args){const written=await t.assign.apply(this,args);t.waiting=true;await t.gate;return written}})()');
    stage = "acknowledged marker with stale source";
    const retained = await edgeQuery("Retained source"); await holdAssignment(); await click(retained.selector); await wait("blockAuthoringTrace.waiting", "real target write and FileManager cleanup completed before holding returned acknowledgement");
    const retainedText = (await readFile(join(directory, retained.path))).toString("utf8").replace(/^\ufeff/, ""); marker(retainedText, targetBody);
    await evaluate("app.editor.setCursor(0,0);app.fileManager.assignBlockId=blockAuthoringTrace.assign;blockAuthoringTrace.release()"); await settled(tools);
    await wait(`[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(retained.path)})&&note.textContent.includes("block ID was written")&&note.textContent.includes("no source link"))`, "acknowledged marker retained with no-link notice");
    assert.equal(await evaluate("app.editor.getValue()"), retained.typed); await exact(retained.path, retainedText); expected.set(retained.path, retainedText); await evaluate(restoredMethods); await reset();

    stage = "observed target replacement after acknowledgement";
    const staleTarget = await edgeQuery("Changed target"); await holdAssignment(); await click(staleTarget.selector); await wait("blockAuthoringTrace.waiting", "genuine target marker was written before independent target replacement");
    const obsolete = (await readFile(join(directory, staleTarget.path))).toString("utf8").replace(/^\ufeff/, ""); marker(obsolete, targetBody);
    const replacement = targetText.replace(targetBody, "Observed newer target λ 😀 has no old marker."); await writeFile(join(directory, staleTarget.path), bytes(replacement)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`app.metadataCache.getDocument(${q(staleTarget.path)})?.text===${q(replacement)}`, "actual current target metadata observes the post-ack replacement");
    await evaluate("app.fileManager.assignBlockId=blockAuthoringTrace.assign;blockAuthoringTrace.release()"); await settled(tools);
    assert.equal(await evaluate("app.editor.getValue()"), staleTarget.typed, "no source link to the removed acknowledged block is inserted"); await exact(staleTarget.path, replacement); expected.set(staleTarget.path, replacement); await evaluate(restoredMethods); await reset();

    stage = "post-acknowledgement metadata cleanup failure";
    const cleanup = await edgeQuery("Cleanup"), cleanupFailure = "Wave13 block post-write refresh failure";
    await evaluate(`(()=>{const t=blockAuthoringTrace;t.write=app.vault.writeDocument;t.refresh=app.metadataCache.refresh;t.failRefresh=false;app.vault.writeDocument=async function(path,...args){const written=await t.write.call(this,path,...args);if(path===${q(cleanup.path)})t.failRefresh=true;return written};app.metadataCache.refresh=async function(...args){if(t.failRefresh){t.failRefresh=false;throw Error(${q(cleanupFailure)})}return t.refresh.apply(this,args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: cleanupFailure }], async () => {
      await click(cleanup.selector); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(cleanupFailure)})&&[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(cleanup.path)})&&note.textContent.includes("block ID was written")&&note.textContent.includes("no source link"))`, "post-ack cleanup failure retains the target ID and original error");
    }, "inject exactly one metadata refresh error after genuine Vault.writeDocument return, keep its acknowledged marker and report the cleanup failure without a source link");
    const cleanupText = (await readFile(join(directory, cleanup.path))).toString("utf8").replace(/^\ufeff/, ""); marker(cleanupText, targetBody);
    assert.equal(await evaluate("app.editor.getValue()"), cleanup.typed); expected.set(cleanup.path, cleanupText); await evaluate(restoredMethods); await click("[data-dismiss-error]"); await reset();
    pass(report, "Acknowledged cross-note IDs survive a later stale source or FileManager cleanup failure with a no-link Notice; the original cleanup error remains reported. A separately observed post-ack target replacement refuses the obsolete block link and preserves newer external bytes without an unsafe rollback. Earlier internal transport failures remain outside this acknowledgement proof.");

    const recorded = await evaluate("blockAuthoringTrace.trusted"), trusted = recorded.filter(event => event.phase === "normal"); assert.ok(trusted.length >= 6); assert.ok(trusted.every(event => event.trusted)); assert.ok(trusted.some(event => event.type === "Enter")); assert.ok(trusted.some(event => event.type === "pointer"));
    report.blockAuthoringRetainedInputs = recorded.filter(event => event.phase === "retained-target");
    report.blockAuthoringInputs = trusted; report.blockAuthoringIds = ids;
    await evaluate("blockAuthoringTrace.abort.abort()");
    stage = "restart exact saved authoring";
    await evaluate(`(async()=>{await app.openFile(${q(source("live-preview"))});app.workspace.activeLeaf.view.setEditingMode("live-preview");await app.saveAll();await app.workspace.flushLayout()})()`);
    for (const [path, text] of expected) await exact(path, text);
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(source("live-preview"))}&&app.editor.getValue()===${q(expected.get(source("live-preview")))}`, "saved block source and Live Preview restore after owned restart");
    for (const [path, text] of expected) await exact(path, text);
    const id = ids.find(value => !value.sameNote && value.mode === "live-preview").id;
    await evaluate(`(()=>{const e=app.editor;const line=${queryLine};e.setCursor(line,e.getLine(line).length);e.focus();return true})()`);
    const prefix = " [[" + await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target("live-preview"))}),${q(source("live-preview"))})`) + "#^" + id;
    await command("Input.insertText", { text: prefix }); await wait(`Boolean(document.querySelector(${q(popup + ` [data-builtin-block=${q(id)}]`)}))`, "a fresh restarted existing-ID provider can address the acknowledged target");
    await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), expected.get(source("live-preview")));
    await capture?.("block-authoring-restored");
    report.blockAuthoring = { sameNoteBeforeAndAfter: true, combinedIsolatedUndoRedo: true, realEnterAndPointer: true, existingIdsNotRelabelled: true, conservativeParagraphKinds: true, exactBomCrlfUnicode: true, sameEditorIdentity: true, crossNoteGuardedWrite: true, cleanPeerHistoryMapped: true, sourceUndoKeepsOtherMarker: true, staleHeldTargetRefused: true, staleSourcePreflight: true, actualPhysicalConflict: true, acknowledgedSourceStale: true, observedPostAckTargetStale: true, acknowledgedCleanupFailure: true, noUnsafeRollback: true, restart: true, freshExistingIdProvider: true };
    pass(report, "Full native restart or actual-folder browser reconnection retains every exact saved authoring fixture, restores Live Preview, and installs a fresh provider that offers the acknowledged existing block ID. Escape and actual Undo preserve source while original BOM/CRLF/Unicode target/configuration ownership remains intact.");
  } catch (error) {
    report.blockAuthoringFailure = { stage, ...current, error: String(error?.stack ?? error) };
    try { report.blockAuthoringFailure.state = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode?.(),source:app.editor.getValue(),cursor:app.editor.getCursor(),changingFiles:app.workspace.isChangingFiles,pending:Boolean((${provider}).pendingCreate),rows:[...document.querySelectorAll(${q(popup + " .suggestion-item")})].map(row=>({text:row.textContent,path:row.dataset.builtinCreateBlock,from:row.dataset.builtinBlockStart,selected:row.getAttribute("aria-selected")})),trusted:globalThis.blockAuthoringTrace?.trusted??[]}))()`); } catch { /* Retain the first failure. */ }
    try { await capture?.("block-authoring-precleanup-failure"); } catch { /* Retain the first failure. */ }
    throw error;
  } finally {
    await evaluate(restoredMethods); await settled(tools); await evaluate("globalThis.blockAuthoringTrace?.abort?.abort()");
    await evaluate("app.saveAll()");
    if (config) await writeFile(configPath, config); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await evaluate('app.configuration.read("app");app.markdownAutosave.configure()');
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate("app.workspace.flushLayout()");
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)");
    await evaluate(`app.saveLocalStorage("fold-state-v1",${q(foldProfile)});delete globalThis.blockAuthoringTrace`);
  }
}

/** Root mounts actual cache-only data and verifies zero traffic plus original blobs after return. */
export async function checkBlockAuthoringReadOnly({ evaluate, command, wait, report, capture }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), paths = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const proof = await evaluate(`(${readOnlyBlockProof.toString()})()`);
  assert.deepEqual(proof, { targetEligible: true, trigger: null, choices: 0 });
  await command("Page.bringToFront"); await command("Input.insertText", { text: "[[Known target#^Cached paragraph" }); await key(command, "Enter", "Enter", 13);
  await wait(`!document.querySelector(${q(popup)})`, "genuine cached read-only block authoring stays closed");
  assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), paths);
  report.blockAuthoringReadOnly = { genuineCacheOnly: true, eligibleActualParagraph: true, triggerDeclined: true, directEnumerationDeclined: true, trustedInputRefused: true, sourceAndInventoryExact: true };
  await capture?.("block-authoring-readonly");
  pass(report, "A genuine cached read-only source prefix targeting an actual eligible unlabelled paragraph refuses block authoring triggers, direct candidates and trusted typing/Enter. Its source and inventory remain exact while the parent audits unchanged cached blobs and zero API/raw traffic.");
}
