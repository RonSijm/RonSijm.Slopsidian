import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors, saveConflictMessage } from "./error-log-audit.mjs";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const popup = '[data-builtin-suggest="source"]:popover-open';
const provider = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const row = (path, subpath) => `${popup} [data-builtin-create-heading=${q(path)}][data-builtin-heading-subpath=${q(subpath)}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const sourceText = ['---', 'status: Preserve heading source', '---', '# Existing parent', '', 'Before λ 😀 remains exact.', '', '## Branch', '', 'Nested prose remains exact.', '', '# Other', '', 'Reference: ', '', 'After Ω remains exact.', ''].join("\r\n");
const targetText = ['---', 'opaque: "Preserve heading target BOM and CRLF"', '---', '# Parent', '', 'Target body λ 😀 remains exact.', '', '## Branch', '', 'Nested target body remains exact.', '', '# Outside', '', 'Outside prose remains exact.', ''].join("\r\n");
const queryLine = sourceText.split("\r\n").indexOf("Reference: ");
const targetBodyLine = targetText.split("\r\n").indexOf("Target body λ 😀 remains exact.");
const appendRoot = (text, title) => text + (text.endsWith("\r\n\r\n") ? "" : text.endsWith("\r\n") ? "\r\n" : "\r\n\r\n") + "# " + title + "\r\n";
const appendChild = (text, title) => text.replace("# Outside", "## " + title + "\r\n\r\n# Outside");
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function settled({ wait }) { await wait('!app.workspace.isChangingFiles&&!(' + provider + ').pendingCreate', "the actual heading authoring operation settled"); }
async function escape(tools) { await key(tools.command, "Escape", "Escape", 27); await tools.wait(`!document.querySelector(${q(popup)})`, "the heading popup closed"); }

/** Real provider/Editor/FileManager acceptance. The caller owns builds and both hosts. */
export async function checkHeadingAuthoring(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Heading authoring", source = mode => folder + "/" + mode + ".md", target = mode => folder + "/Target " + mode + ".md";
  const edge = name => folder + "/" + name + ".md", edgeNames = ["Guard", "Conflict", "Retained source", "Changed target", "Cleanup", "Held target", "Dirty target"];
  const configPath = join(directory, ".obsidian", "app.json"), config = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const options = config ? JSON.parse(config.toString("utf8").replace(/^\ufeff/, "")) : {};
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), folds = await evaluate('app.loadLocalStorage("fold-state-v1")');
  const expected = new Map(), modes = ["source", "live-preview"];
  let stage = "fixture", current = {};
  const exact = async (path, text) => { assert.deepEqual(await readFile(join(directory, path)), bytes(text)); };
  const configure = async format => {
    await writeFile(configPath, bytes(JSON.stringify({ ...options, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: false }, null, 2).replaceAll("\n", "\r\n") + "\r\n"));
    await evaluate('app.configuration.read("app");app.markdownAutosave.configure()');
  };
  const open = async mode => {
    await escape(tools);
    await evaluate(`(async()=>{await app.openFile(${q(source(mode))});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});const e=app.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(sourceText)},"input.heading-fixture");e.setCursor(${queryLine},e.getLine(${queryLine}).length);e.focus()})()`);
    await command("Page.bringToFront");
    await wait(`app.workspace.getActiveFile()?.path===${q(source(mode))}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}&&app.editor.cm.hasFocus`, "the real heading source editor is focused");
  };
  const type = async (mode, prefix) => {
    await open(mode); await command("Input.insertText", { text: prefix });
    const typed = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n");
    assert.equal(await evaluate("app.editor.getValue()"), typed); return typed;
  };
  const select = async (path, subpath, method) => {
    const selector = row(path, subpath); await wait(`Boolean(document.querySelector(${q(selector)}))`, "the actual explicit Create heading row is offered");
    const label = await evaluate(`(()=>{const r=document.querySelector(${q(selector)});return{title:r.querySelector(".suggestion-title")?.textContent,note:r.querySelector(".suggestion-note")?.textContent}})()`);
    assert.equal(label.title, "Create heading: " + subpath.split("#").at(-1)); assert.ok(label.note.includes(path + "#" + subpath)); assert.match(label.note, / · #{1,6} /);
    if (method === "pointer") await click(selector);
    else {
      for (let index = 0; index < 40; index++) {
        if (await evaluate(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`)) break;
        await key(command, "ArrowDown", "ArrowDown", 40);
      }
      await wait(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`, "the explicit heading action is selected before trusted Enter");
      await key(command, "Enter", "Enter", 13);
    }
    await settled(tools);
  };
  const reset = async () => { await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText); };
  const restoredMethods = '(function(){const t=globalThis.headingAuthoringTrace;if(!t)return;if(t.saveAll)app.saveAll=t.saveAll;if(t.assign)app.fileManager.assignMarkdownSubpath=t.assign;if(t.write)app.vault.writeDocument=t.write;if(t.refresh)app.metadataCache.refresh=t.refresh;t.release?.();delete t.saveAll;delete t.assign;delete t.write;delete t.refresh})()';
  try {
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, folder), { recursive: true });
    for (const mode of modes) {
      await writeFile(join(directory, source(mode)), bytes(sourceText), { flag: "wx" }); expected.set(source(mode), sourceText);
      await writeFile(join(directory, target(mode)), bytes(targetText), { flag: "wx" }); expected.set(target(mode), targetText);
    }
    for (const name of edgeNames) { await writeFile(join(directory, edge(name)), bytes(targetText), { flag: "wx" }); expected.set(edge(name), targetText); }
    await configure("shortest"); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`${q([...expected.keys()])}.every(path=>app.metadataCache.getDocument(path)?.text===${q(targetText)}||app.metadataCache.getDocument(path)?.text===${q(sourceText)})`, "all physical heading fixtures are indexed");
    await evaluate(`(()=>{const t=globalThis.headingAuthoringTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const r=event.target.closest?.("[data-builtin-create-heading]");if(r)t.trusted.push({type:"pointer",trusted:event.isTrusted,phase:t.phase??"normal",path:r.dataset.builtinCreateHeading,subpath:r.dataset.builtinHeadingSubpath,file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal});window.addEventListener("keydown",event=>{const r=document.querySelector(${q(popup + " [data-builtin-create-heading][aria-selected=true]")}),e=app.workspace.activeEditor?.editor;if(event.key==="Enter"&&r&&event.target instanceof Node&&e?.cm.dom.contains(event.target))t.trusted.push({type:"Enter",trusted:event.isTrusted,phase:t.phase??"normal",path:r.dataset.builtinCreateHeading,subpath:r.dataset.builtinHeadingSubpath,file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal})})()`);

    for (const mode of modes) {
      await configure(mode === "source" ? "shortest" : "absolute");
      for (const [subpath, method] of [["New root λ 😀", "Enter"], ["Existing parent#Branch#New child λ 😀", "pointer"]]) {
        stage = "same-note isolated creation"; current = { mode, subpath };
        const prefix = "[[#" + subpath, typed = await type(mode, prefix);
        await evaluate("(()=>{const t=headingAuthoringTrace;t.sourceEditor=app.editor;t.sourceCm=app.editor.cm;t.sourceLeaf=app.workspace.activeLeaf;return true})()");
        await select(source(mode), subpath, method);
        const linked = typed.replace(prefix, prefix + "]]"), completed = subpath.includes("#")
          ? linked.replace("# Other", "### New child λ 😀\r\n\r\n# Other") : appendRoot(linked, subpath);
        assert.equal(await evaluate("app.editor.getValue()"), completed);
        assert.equal(await evaluate("app.editor===headingAuthoringTrace.sourceEditor&&app.editor.cm===headingAuthoringTrace.sourceCm&&app.workspace.activeLeaf===headingAuthoringTrace.sourceLeaf"), true);
        assert.equal(await evaluate(`headingAuthoringTrace.trusted.some(event=>event.trusted&&event.type===${q(method)}&&event.path===${q(source(mode))}&&event.subpath===${q(subpath)}&&event.mode===${q(mode)})`), true);
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed);
        await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed);
        await evaluate("app.saveAll()"); await exact(source(mode), completed); expected.set(source(mode), completed);
        await capture?.("heading-authoring-same-note-" + mode + (subpath.includes("#") ? "-child" : "-root"));
      }
      pass(report, `${mode}: trusted Enter and pointer Create heading actions display the reviewed path and ATX preview, append a root H1 or a child under a unique existing ancestor before its sibling, and insert the current-note link in one isolated Undo/Redo step. Editor identity and exact BOM/CRLF/Unicode source remain intact.`);

      stage = "cross-note target and source histories"; current = { mode, target: target(mode) };
      await open(mode);
      await evaluate(`(async()=>{const t=headingAuthoringTrace;t.sourceLeaf=app.workspace.activeLeaf;const p=app.workspace.getLeaf("split");await p.openFile(app.vault.getFileByPath(${q(target(mode))}));p.view.setEditingMode("source");app.workspace.setActiveLeaf(p,{focus:true});t.peer=p;t.peerEditor=p.view.editor;t.peerCm=t.peerEditor.cm;t.peerEditor.setCursor(${targetBodyLine},0);t.peerEditor.focus()})()`);
      await command("Input.insertText", { text: "History " }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), targetText);
      await evaluate(`(()=>{app.workspace.setActiveLeaf(headingAuthoringTrace.sourceLeaf,{focus:true});app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus();return true})()`);
      const title = "New cross child λ 😀", subpath = "Parent#" + title;
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target(mode))}),${q(source(mode))})`), prefix = "[[" + linktext + "#" + subpath;
      await command("Input.insertText", { text: prefix }); const typed = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n");
      await select(target(mode), subpath, mode === "source" ? "pointer" : "Enter");
      const written = appendChild(targetText, title), completed = typed.replace(prefix, prefix + "]]");
      await exact(target(mode), written); assert.equal(await evaluate("app.editor.getValue()"), completed);
      assert.equal(await evaluate("headingAuthoringTrace.peer.view.editor===headingAuthoringTrace.peerEditor&&headingAuthoringTrace.peer.view.editor.cm===headingAuthoringTrace.peerCm&&headingAuthoringTrace.peer.view.editor.getValue()"), written);
      await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed); await exact(target(mode), written);
      await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed);
      await evaluate("(()=>{app.workspace.setActiveLeaf(headingAuthoringTrace.peer,{focus:true});app.editor.focus();return true})()");
      await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), written.replace("Target body", "History Target body"));
      await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), written);
      await evaluate("(()=>{app.workspace.setActiveLeaf(headingAuthoringTrace.sourceLeaf,{focus:true});app.editor.focus();return true})()");
      await evaluate("app.workspace.closeLeaf(headingAuthoringTrace.peer)"); await evaluate("delete headingAuthoringTrace.peer");
      expected.set(source(mode), completed); expected.set(target(mode), written); await capture?.("heading-authoring-cross-note-" + mode);
      pass(report, `${mode}: the genuine optimistic target write precedes the source link, maps an already-open clean target's earlier Redo history without replacing its editor, and preserves the target heading when source Undo removes its link. Ordinary saving retains exact target/source BOM, CRLF and Unicode bytes.`);
    }

    stage = "ordinary missing-heading action remains source-only";
    const missingTitle = "Uncreated ordinary destination λ", ordinaryLinktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(edge("Guard"))}),${q(source("source"))})`);
    const ordinaryPrefix = "[[" + ordinaryLinktext + "#" + missingTitle, ordinaryTyped = await type("source", ordinaryPrefix);
    await wait(`Boolean(document.querySelector(${q(popup + ' [data-builtin-unresolved-heading=' + q(edge("Guard")) + ']')}))`, "the source-only missing-heading action remains offered beside explicit creation");
    await click(popup + ' [data-builtin-unresolved-heading=' + q(edge("Guard")) + ']');
    await wait(`app.editor.getValue()===${q(ordinaryTyped.replace(ordinaryPrefix, ordinaryPrefix + "]]"))}`, "ordinary missing-heading acceptance only completes its source token");
    await exact(edge("Guard"), targetText); await reset();

    stage = "dirty target authoring refusal";
    await open("source");
    await evaluate(`(async()=>{const t=headingAuthoringTrace;t.sourceLeaf=app.workspace.activeLeaf;t.peer=app.workspace.getLeaf("split");await t.peer.openFile(app.vault.getFileByPath(${q(edge("Dirty target"))}));t.peer.view.setEditingMode("source");app.workspace.setActiveLeaf(t.peer,{focus:true});app.editor.setCursor(${targetBodyLine},0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "Dirty " });
    assert.equal(await evaluate(`app.workspace.sessions.get(${q(edge("Dirty target"))}).dirty`), true);
    await evaluate(`(()=>{app.workspace.setActiveLeaf(headingAuthoringTrace.sourceLeaf,{focus:true});app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus();return true})()`);
    await command("Input.insertText", { text: "[[Dirty target#Fresh dirty destination λ" });
    assert.equal(await evaluate(`(()=>{const s=${provider};return s.getSuggestions(s.context??{editor:app.editor,file:app.workspace.getActiveFile()}).some(value=>value.kind==="create-heading")})()`), false);
    await exact(edge("Dirty target"), targetText);
    await escape(tools); await evaluate("(()=>{app.workspace.setActiveLeaf(headingAuthoringTrace.peer,{focus:true});app.editor.undo();app.workspace.setActiveLeaf(headingAuthoringTrace.sourceLeaf,{focus:true});return true})()");
    await evaluate("app.workspace.closeLeaf(headingAuthoringTrace.peer)"); await evaluate("delete headingAuthoringTrace.peer"); await reset();

    stage = "retained actual row and newer target";
    const heldPrefix = "[[Held target#Fresh held destination λ", heldTyped = await type("source", heldPrefix), heldSelector = row(edge("Held target"), "Fresh held destination λ");
    await wait(`Boolean(document.querySelector(${q(heldSelector)}))`, "an actual Create heading row is captured before its target changes");
    await evaluate(`(()=>{const t=headingAuthoringTrace,s=${provider};t.held={element:document.querySelector(${q(heldSelector)}),provider:s,value:s.getSuggestions(s.context).find(value=>value.kind==="create-heading")};return true})()`);
    const changed = targetText.replace("Target body", "Newer target body"); await writeFile(join(directory, edge("Held target")), bytes(changed)); await evaluate("app.metadataCache.refresh()");
    await wait(`app.metadataCache.getDocument(${q(edge("Held target"))})?.text===${q(changed)}`, "the held target's actual current bytes are indexed");
    await evaluate('(async()=>{const t=headingAuthoringTrace,h=t.held;t.phase="held-target";try{h.element.click();await h.provider.selectSuggestion(h.value)}finally{delete t.held;delete t.phase}})()');
    assert.equal(await evaluate("app.editor.getValue()"), heldTyped); await exact(edge("Held target"), changed); expected.set(edge("Held target"), changed); await reset();
    for (const subpath of ["**Unsafe title**", "Parent#**Unsafe parent**#New", "Parent#Branch#"]) {
      await type("source", "[[Guard#" + subpath);
      assert.equal(await evaluate(`Boolean(document.querySelector(${q(popup + " [data-builtin-create-heading]")}))`), false); await exact(edge("Guard"), targetText);
    }
    await reset();
    pass(report, "Ordinary Link to missing heading stays source-only. Actual unsaved target input suppresses Create heading; an actual held row/direct retained provider value refuses newer indexed target bytes. Unsafe title or ancestor syntax and empty ancestry do not create destination headings.");

    const edgeQuery = async name => {
      const path = edge(name), title = "Fresh guarded destination λ", linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(source("source"))})`);
      const typed = await type("source", "[[" + linktext + "#" + title), selector = row(path, title);
      current = { path, title }; await wait(`Boolean(document.querySelector(${q(selector)}))`, "the guarded actual heading creation row is offered"); return { path, title, typed, selector };
    };
    stage = "changed source during actual FileManager preflight";
    const guard = await edgeQuery("Guard"), refusal = "The source or target note changed. No target edit was added.";
    await evaluate('(()=>{const t=headingAuthoringTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)}})()');
    await expectErrors(tools, [{ source: "notification", message: refusal }], async () => {
      await click(guard.selector); await wait("headingAuthoringTrace.waiting", "the real FileManager preflight save is held");
      await evaluate("app.editor.setCursor(0,0);app.saveAll=headingAuthoringTrace.saveAll;headingAuthoringTrace.release()"); await settled(tools);
      await wait(`document.querySelector("#client-errors").textContent.includes(${q(refusal)})`, "the stale source is visibly refused before target writing");
    }, "change the real source cursor while the actual FileManager save preflight is held; no target heading or source link may be written");
    await evaluate(restoredMethods); assert.equal(await evaluate("app.editor.getValue()"), guard.typed); await exact(guard.path, targetText); await click("[data-dismiss-error]"); await reset();

    stage = "physical optimistic conflict";
    const conflict = await edgeQuery("Conflict"), conflictMessage = await saveConflictMessage(tools), external = targetText.replace("Target body", "External target body");
    await evaluate(`(()=>{const t=headingAuthoringTrace;t.write=app.vault.writeDocument;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.writeDocument=async function(path,...args){if(path===${q(conflict.path)}){t.waiting=true;await t.gate}return t.write.call(this,path,...args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: conflictMessage }], async () => {
      await click(conflict.selector); await wait("headingAuthoringTrace.waiting", "the actual optimistic heading write is held after its reviewed version read");
      await writeFile(join(directory, conflict.path), bytes(external)); await evaluate("app.vault.writeDocument=headingAuthoringTrace.write;headingAuthoringTrace.release()"); await settled(tools);
      await wait(`document.querySelector("#client-errors").textContent.includes(${q(conflictMessage)})`, "the host rejects a genuine changed physical target version");
    }, "physically replace the destination between the genuine reviewed read and optimistic host write; retain all external bytes and source text");
    await evaluate(restoredMethods); assert.equal(await evaluate("app.editor.getValue()"), conflict.typed); await exact(conflict.path, external); expected.set(conflict.path, external); await click("[data-dismiss-error]"); await reset();
    pass(report, "The real FileManager refuses a source cursor changed during preflight. A physical destination replacement after the reviewed read causes the host's optimistic version conflict, preserving newer target bytes and the source query without a heading/link write.");

    const holdAssignment = async () => evaluate('(()=>{const t=headingAuthoringTrace;t.assign=app.fileManager.assignMarkdownSubpath;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.fileManager.assignMarkdownSubpath=async function(...args){const written=await t.assign.apply(this,args);t.waiting=true;await t.gate;return written}})()');
    stage = "acknowledged heading and stale source";
    const retained = await edgeQuery("Retained source"); await holdAssignment(); await click(retained.selector); await wait("headingAuthoringTrace.waiting", "the genuine heading write and cleanup finish before holding its returned acknowledgement");
    const retainedText = appendRoot(targetText, retained.title); await exact(retained.path, retainedText);
    await evaluate("app.editor.setCursor(0,0);app.fileManager.assignMarkdownSubpath=headingAuthoringTrace.assign;headingAuthoringTrace.release()"); await settled(tools);
    await wait(`[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(retained.path)})&&note.textContent.includes("heading was written")&&note.textContent.includes("no source link"))`, "the acknowledged heading is retained with a no-link notice");
    assert.equal(await evaluate("app.editor.getValue()"), retained.typed); await exact(retained.path, retainedText); expected.set(retained.path, retainedText); await evaluate(restoredMethods); await reset();

    stage = "newer target observed after acknowledgement";
    const newer = await edgeQuery("Changed target"); await holdAssignment(); await click(newer.selector); await wait("headingAuthoringTrace.waiting", "the acknowledged heading exists before independent replacement");
    await exact(newer.path, appendRoot(targetText, newer.title)); const replacement = targetText.replace("Target body", "Observed newer target body");
    await writeFile(join(directory, newer.path), bytes(replacement)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`app.metadataCache.getDocument(${q(newer.path)})?.text===${q(replacement)}`, "the post-ack replacement is actually observed");
    await evaluate("app.fileManager.assignMarkdownSubpath=headingAuthoringTrace.assign;headingAuthoringTrace.release()"); await settled(tools);
    assert.equal(await evaluate("app.editor.getValue()"), newer.typed); await exact(newer.path, replacement); expected.set(newer.path, replacement); await evaluate(restoredMethods); await reset();

    stage = "acknowledged heading with refresh failure";
    const cleanup = await edgeQuery("Cleanup"), cleanupFailure = "Destination heading post-write refresh failure";
    await evaluate(`(()=>{const t=headingAuthoringTrace;t.write=app.vault.writeDocument;t.refresh=app.metadataCache.refresh;t.failRefresh=false;app.vault.writeDocument=async function(path,...args){const written=await t.write.call(this,path,...args);if(path===${q(cleanup.path)})t.failRefresh=true;return written};app.metadataCache.refresh=async function(...args){if(t.failRefresh){t.failRefresh=false;throw Error(${q(cleanupFailure)})}return t.refresh.apply(this,args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: cleanupFailure }], async () => {
      await click(cleanup.selector); await settled(tools);
      await wait(`document.querySelector("#client-errors").textContent.includes(${q(cleanupFailure)})&&[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(cleanup.path)})&&note.textContent.includes("heading was written")&&note.textContent.includes("no source link"))`, "the acknowledged heading and original cleanup error are both reported");
    }, "inject one metadata refresh failure after actual Vault.writeDocument acknowledgement; keep the target heading and report the error without linking the stale source");
    const cleanupText = appendRoot(targetText, cleanup.title); await exact(cleanup.path, cleanupText); assert.equal(await evaluate("app.editor.getValue()"), cleanup.typed);
    expected.set(cleanup.path, cleanupText); await evaluate(restoredMethods); await click("[data-dismiss-error]"); await reset();
    pass(report, "Acknowledged headings survive a later stale source or cleanup failure with a no-link Notice and the original diagnostic. An observed post-ack target replacement preserves newer bytes and declines the obsolete source link; no rollback overwrites either acknowledged or newer target data.");

    const recorded = await evaluate("headingAuthoringTrace.trusted"), trusted = recorded.filter(event => event.phase === "normal");
    assert.ok(trusted.length >= 6); assert.ok(trusted.every(event => event.trusted)); assert.ok(trusted.some(event => event.type === "Enter")); assert.ok(trusted.some(event => event.type === "pointer"));
    report.headingAuthoringInputs = trusted; report.headingAuthoringRetainedInputs = recorded.filter(event => event.phase === "held-target");
    await evaluate("headingAuthoringTrace.abort.abort()");
    stage = "restart and fresh existing destination provider";
    await evaluate(`(async()=>{await app.openFile(${q(source("live-preview"))});app.workspace.activeLeaf.view.setEditingMode("live-preview");await app.saveAll();await app.workspace.flushLayout()})()`);
    for (const [path, text] of expected) await exact(path, text);
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(source("live-preview"))}&&app.editor.getValue()===${q(expected.get(source("live-preview")))}`, "saved source and Live Preview restore after full restart/reconnection");
    for (const [path, text] of expected) await exact(path, text);
    await evaluate(`(()=>{app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus();return true})()`);
    const prefix = " [[" + await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target("live-preview"))}),${q(source("live-preview"))})`) + "#Parent#New cross child λ 😀";
    await command("Input.insertText", { text: prefix });
    await wait(`Boolean(document.querySelector(${q(popup + ' [data-builtin-heading="New cross child λ 😀"]')}))`, "the fresh restarted provider offers the acknowledged heading as an ordinary existing destination");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(row(target("live-preview"), "Parent#New cross child λ 😀"))}))`), false);
    await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), expected.get(source("live-preview")));
    await capture?.("heading-authoring-restored");
    report.headingAuthoring = { rootAndExistingAncestorChild: true, sourceAndLivePreview: true, explicitPathAndAtxPreview: true, missingLinkStaysSourceOnly: true, actualEnterAndPointer: true, combinedSameNoteUndoRedo: true, sameEditorIdentity: true, optimisticCrossNoteWrite: true, cleanPeerHistoryMapped: true, sourceUndoKeepsOtherHeading: true, exactBomCrlfUnicode: true, dirtyTargetRefused: true, unsafeAndEmptyAncestorsRefused: true, retainedTargetRefused: true, actualPreflightGuard: true, actualPhysicalVersionConflict: true, acknowledgedStaleSource: true, observedPostAckTargetChange: true, acknowledgedCleanupFailure: true, noUnsafeRollback: true, restart: true, freshExistingHeadingProvider: true };
    pass(report, "Full native restart or actual-folder browser reconnection retains every saved heading fixture byte, restores Live Preview and installs a fresh provider that offers created destinations as existing headings. Escape and trusted Undo retain the original saved source and target bytes.");
  } catch (error) {
    report.headingAuthoringFailure = { stage, ...current, error: String(error?.stack ?? error) };
    try { report.headingAuthoringFailure.state = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode?.(),source:app.editor.getValue(),cursor:app.editor.getCursor(),changingFiles:app.workspace.isChangingFiles,pending:Boolean((${provider}).pendingCreate),rows:[...document.querySelectorAll(${q(popup + " .suggestion-item")})].map(r=>({text:r.textContent,path:r.dataset.builtinCreateHeading,subpath:r.dataset.builtinHeadingSubpath,selected:r.getAttribute("aria-selected")})),trusted:globalThis.headingAuthoringTrace?.trusted??[]}))()`); await capture?.("heading-authoring-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    await evaluate(restoredMethods); await settled(tools); await evaluate("globalThis.headingAuthoringTrace?.abort?.abort()");
    await evaluate("app.saveAll()");
    if (config) await writeFile(configPath, config); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await evaluate('app.configuration.read("app");app.markdownAutosave.configure()');
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate("app.workspace.flushLayout()");
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)");
    await evaluate(`app.saveLocalStorage("fold-state-v1",${q(folds)});delete globalThis.headingAuthoringTrace`);
  }
}

/** The caller mounts the genuine cached fixture and audits exact blobs and zero traffic. */
export async function checkHeadingAuthoringReadOnly({ evaluate, command, wait, report, capture }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const target = await evaluate('(()=>{const f=app.vault.getFileByPath("Known target.md"),d=app.metadataCache.getDocument("Known target.md");return{known:Boolean(f&&d&&!d.missing&&typeof d.text==="string"),missing:!d?.cache.headings.some(value=>value.heading==="Future cached heading")}})()');
  assert.deepEqual(target, { known: true, missing: true });
  const location = await evaluate('(()=>{const lines=app.editor.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value==="[[Known target#Future cached heading");if(line<0)throw Error("Missing actual cached heading authoring prefix");return{line,ch:lines[line].length}})()');
  for (const mode of ["source", "live-preview"]) {
    await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.setCursor(${location.line},${location.ch});app.editor.focus();return true})()`);
    const proof = await evaluate(`(()=>{const p=${provider},e=app.editor,f=app.workspace.getActiveFile(),cursor=e.getCursor();return{trigger:p.onTrigger(cursor,e,f),choices:p.getSuggestions({editor:e,file:f,start:cursor,end:cursor,query:"Future cached heading"}).length}})()`);
    assert.deepEqual(proof, { trigger: null, choices: 0 }); await command("Page.bringToFront");
    await command("Input.insertText", { text: "x" }); await key(command, "Enter", "Enter", 13);
    await wait(`!document.querySelector(${q(popup)})`, "genuine cached read-only heading authoring remains closed");
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
  }
  report.headingAuthoringReadOnly = { genuineCacheOnly: true, knownEligibleMissingHeading: true, sourceAndLivePreview: true, triggerAndDirectChoicesDeclined: true, trustedInputRefused: true, sourceAndInventoryExact: true };
  await capture?.("heading-authoring-readonly");
  pass(report, "A genuine cached read-only vault contains the actual known target and eligible missing-heading prefix. Source/Live Preview triggering, direct enumeration and trusted typing/Enter refuse creation while exact source and inventory remain intact; the parent audits cached bytes and zero API/raw traffic.");
}
