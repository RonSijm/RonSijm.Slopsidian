import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors, saveConflictMessage } from "./error-log-audit.mjs";

const q = JSON.stringify, newline = "\r\n", bytes = text => Buffer.from("\ufeff" + text);
const popup = '[data-builtin-suggest="source"]:popover-open';
const provider = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const row = (path, from) => `${popup} [data-builtin-create-block=${q(path)}][data-builtin-block-start=${q(String(from))}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const bodies = {
  open: ["> [!tip]+ Callout open λ 😀", "> Body Ω remains exact.", ">", "> - [ ] First task remains exact.", ">   - Nested child remains exact.", "> - [x] Last task remains exact.", ">", "> > Ordinary nested quote.", "> > Final nested quote remains exact."].join(newline),
  closed: ["> [!warning]- Callout closed λ 😀", "> Closed body Ω remains exact.", ">", "> - First list item remains exact.", "> - Last list item remains exact.", ">", "> > Final closed quote remains exact."].join(newline),
};
const queries = { open: "Callout open", closed: "Callout closed" };
const types = { open: "blockquote", closed: "blockquote" };
const sourceText = ["---", "status: Preserve callout authoring", "---", "# Callout source λ", "", bodies.open, "", "Reference: ", "", bodies.closed, "", "Untouched final prose Ω.", ""].join(newline);
const targetText = kind => ["---", 'opaque: "Preserve callout target BOM CRLF λ 😀"', "---", "# Callout target", "", bodies[kind]].join(newline) + (kind === "open" ? newline : "");

/** Append these to the parent's genuinely cached Known target and source. */
export const calloutAuthoringReadOnlyFixture = {
  targetAddition: ["", "> [!note]- Cached callout λ 😀", "> Cached body Ω.", ">", "> - Cached list item.", ">", "> > Cached nested quote.", ""].join(newline),
  sourcePrefixes: ["[[Known target#^Cached callout"],
};

async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function settled({ wait }) { await wait('!app.workspace.isChangingFiles&&!(' + provider + ').pendingCreate', "the real compound block authoring operation settled"); }
async function escape(tools) { await key(tools.command, "Escape", "Escape", 27); await tools.wait(`!document.querySelector(${q(popup)})`, "the compound authoring popup is dismissed"); }
function marked(text, body) {
  const from = text.indexOf(body); assert.ok(from >= 0);
  const found = /^\r\n\r\n\^([a-z0-9]{6})(?=\r\n|$)/.exec(text.slice(from + body.length));
  assert.ok(found, "a standalone six-character marker follows the entire compound block");
  return found[1];
}

/** Parent owns builds, the native/browser host, cache mount, restart and log audit. */
export async function checkCalloutAuthoring(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Callout authoring", source = mode => `${folder}/${mode}.md`, target = (mode, kind) => `${folder}/${kind} ${mode}.md`;
  const edge = name => `${folder}/${name}.md`, configPath = join(directory, ".obsidian", "app.json");
  const config = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const options = config ? JSON.parse(config.toString("utf8").replace(/^\ufeff/, "")) : {};
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), foldProfile = await evaluate('app.loadLocalStorage("fold-state-v1")');
  const expected = new Map(), ids = [], modes = ["source", "live-preview"];
  let stage = "fixture", current = {};
  const restoredMethods = '(()=>{const t=globalThis.calloutAuthoringTrace;if(!t)return;if(t.saveAll)app.saveAll=t.saveAll;if(t.write)app.vault.writeDocument=t.write;if(t.assign)app.fileManager.assignBlockId=t.assign;t.release?.();delete t.saveAll;delete t.write;delete t.assign})()';
  const exact = async (path, text) => assert.deepEqual(await readFile(join(directory, path)), bytes(text));
  const open = async (mode, text = sourceText) => {
    await evaluate(`(async()=>{await app.openFile(${q(source(mode))});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});const e=app.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(text)},"input.callout-authoring-fixture");const lines=e.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value==="Reference: ");e.setCursor(line,e.getLine(line).length);e.focus()})()`);
    await command("Page.bringToFront"); await wait(`app.workspace.getActiveFile()?.path===${q(source(mode))}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}&&app.editor.cm.hasFocus`, "the real compound source editor is focused");
    await evaluate('(async()=>{const e=app.editor,c=e.getCursor();e.scrollIntoView({from:c,to:c},true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()');
  };
  const type = async (mode, prefix, text = sourceText) => {
    await open(mode, text); await command("Input.insertText", { text: prefix });
    const typed = text.replace("Reference: " + newline, "Reference: " + prefix + newline);
    assert.equal(await evaluate("app.editor.getValue()"), typed); return typed;
  };
  const select = async (path, from, method) => {
    await command("Page.bringToFront");
    await evaluate('(async()=>{const e=app.editor,c=e.getCursor();e.focus();e.scrollIntoView({from:c,to:c},true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()');
    const selector = row(path, from); await wait(`app.editor.cm.hasFocus&&(${provider}).isCurrent()&&(${provider}).context?.editor===app.editor&&Boolean(document.querySelector(${q(selector)}))`, "the measured visible source retains its actual whole-callout popup owner");
    if (method === "pointer") await click(selector);
    else {
      const cursor = await evaluate("app.editor.getCursor()"), count = await evaluate(`document.querySelectorAll(${q(popup + ' .suggestion-item')}).length`);
      assert.ok(count > 0 && count <= 40);
      const currentKeyboard = async () => {
        assert.equal(await evaluate(`(${provider}).isCurrent()&&app.editor.cm.hasFocus`), true, "trusted callout navigation retains its source owner");
        assert.deepEqual(await evaluate("app.editor.getCursor()"), cursor, "popup navigation must not move the source caret");
      };
      if (count > 1 && await evaluate(`document.querySelector(${q(selector)}).getAttribute("aria-selected")==="true"`)) { await key(command, "ArrowUp", "ArrowUp", 38); await currentKeyboard(); }
      if (count === 1) { await key(command, "ArrowDown", "ArrowDown", 40); await currentKeyboard(); }
      for (let index = 0; index < count; index++) {
        if (await evaluate(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`)) break;
        await key(command, "ArrowDown", "ArrowDown", 40); await currentKeyboard();
      }
      await wait(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`, "the whole compound row is selected for trusted Enter");
      (report.calloutAuthoringKeyboard ??= []).push({ path, from, cursor, options: count, ownerAndCaretRetained: true });
      await key(command, "Enter", "Enter", 13);
    }
    await settled(tools);
  };
  const metadataProof = async (path, text, body, id, kind) => {
    const from = text.indexOf(body), to = from + body.length;
    await wait(`app.metadataCache.getDocument(${q(path)})?.text===${q(text)}`, "the exact saved compound destination is indexed");
    const proof = await evaluate(`(()=>{const d=app.metadataCache.getDocument(${q(path)}),b=d?.cache.blocks[${q(id)}];return d&&b?{text:d.text,from:b.position.start.offset,to:b.position.end.offset,marker:d.text.slice(b.idPosition.start.offset,b.idPosition.end.offset),whole:d.cache.sections.some(s=>s.type===${q(types[kind])}&&s.position.start.offset===b.position.start.offset&&s.position.end.offset===b.position.end.offset)}:null})()`);
    assert.ok(proof); assert.equal(proof.text, text); assert.equal(proof.from, from);
    assert.equal(proof.to - (text[proof.to - 1] === "\r" ? 1 : 0), to); assert.equal(proof.marker, "^" + id); assert.equal(proof.whole, true);
  };
  try {
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, folder), { recursive: true });
    for (const mode of modes) {
      await writeFile(join(directory, source(mode)), bytes(sourceText), { flag: "wx" }); expected.set(source(mode), sourceText);
      for (const kind of Object.keys(bodies)) { await writeFile(join(directory, target(mode, kind)), bytes(targetText(kind)), { flag: "wx" }); expected.set(target(mode, kind), targetText(kind)); }
    }
    for (const name of ["Held callout", "Conflict callout", "Guard callout", "Retained callout"]) {
      const text = targetText(name === "Held callout" || name === "Retained callout" ? "open" : "closed"); await writeFile(join(directory, edge(name)), bytes(text), { flag: "wx" }); expected.set(edge(name), text);
    }
    await writeFile(configPath, bytes(JSON.stringify({ ...options, markdownAutosave: false, newLinkFormat: "shortest", useMarkdownLinks: false }, null, 2).replaceAll("\n", newline) + newline));
    await evaluate('app.configuration.read("app");app.markdownAutosave.configure()');
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`${q([...expected])}.every(([path,text])=>app.metadataCache.getDocument(path)?.text===text)`, "the genuine whole-block fixtures are indexed before input");
    await evaluate(`(()=>{const t=globalThis.calloutAuthoringTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const r=event.target.closest?.("[data-builtin-create-block]");if(r)t.trusted.push({type:"pointer",trusted:event.isTrusted,phase:t.phase??"normal",path:r.dataset.builtinCreateBlock,from:Number(r.dataset.builtinBlockStart),file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal});window.addEventListener("keydown",event=>{const r=document.querySelector(${q(popup + " [data-builtin-create-block][aria-selected=true]")}),editor=app.workspace.activeEditor?.editor;if(event.key==="Enter"&&r&&event.target instanceof Node&&editor?.cm.dom.contains(event.target))t.trusted.push({type:"Enter",trusted:event.isTrusted,phase:t.phase??"normal",path:r.dataset.builtinCreateBlock,from:Number(r.dataset.builtinBlockStart),file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal})})()`);

    for (const mode of modes) {
      for (const kind of ["open", "closed"]) {
        stage = "same-note whole compound and atomic Undo"; current = { mode, kind, path: source(mode) };
        const body = bodies[kind], prefix = "[[#^" + queries[kind], typed = await type(mode, prefix), from = typed.indexOf(body), method = kind === "open" ? "Enter" : "pointer";
        await evaluate("(()=>{const t=calloutAuthoringTrace;t.editor=app.editor;t.cm=app.editor.cm;t.leaf=app.workspace.activeLeaf;return true})()");
        await select(source(mode), from, method);
        const actual = await evaluate("app.editor.getValue()"), id = marked(actual, body);
        const completed = typed.replace(body, body + newline + newline + "^" + id).replace(prefix, "[[#^" + id + "]]");
        assert.equal(actual, completed); assert.equal(await evaluate("app.editor===calloutAuthoringTrace.editor&&app.editor.cm===calloutAuthoringTrace.cm&&app.workspace.activeLeaf===calloutAuthoringTrace.leaf"), true);
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed, "one isolated Undo removes both ID and link while keeping the typed query");
        await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed);
        await evaluate("app.saveAll()"); await exact(source(mode), completed); await metadataProof(source(mode), completed, body, id, kind);
        expected.set(source(mode), completed); ids.push({ mode, kind, sameNote: true, id, path: source(mode) });
        await command("Input.insertText", { text: " [[#^" + id }); await wait(`Boolean(document.querySelector(${q(popup + ` [data-builtin-block=${q(id)}]`)}))`, "the newly labelled compound becomes an existing-ID choice");
        assert.equal(await evaluate(`Boolean(document.querySelector(${q(row(source(mode), completed.indexOf(body)))}))`), false);
        await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), completed);
      }
      pass(report, `${mode}: trusted Enter and pointer choices for complete open and closed callouts before and after the source query write standalone IDs and links in one isolated Undo/Redo step. Actual metadata resolves the entire body, lists and ordinary nested quotes; fresh existing-ID rows replace authoring rows while BOM/CRLF/Unicode and editor identity survive.`);

      for (const kind of ["open", "closed"]) {
        stage = "cross-note whole compound"; current = { mode, kind, path: source(mode), target: target(mode, kind) };
        const path = target(mode, kind), body = bodies[kind], targetBefore = targetText(kind), linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(source(mode))})`), prefix = "[[" + linktext + "#^" + queries[kind];
        const typed = await type(mode, prefix), method = kind === "closed" ? "Enter" : "pointer";
        await select(path, targetBefore.indexOf(body), method);
        const actualTarget = (await readFile(join(directory, path))).toString("utf8").replace(/^\ufeff/, ""), id = marked(actualTarget, body), targetAfter = targetBefore.replace(body, body + newline + newline + "^" + id + (targetBefore.slice(targetBefore.indexOf(body) + body.length).startsWith(newline + newline) ? "" : newline));
        assert.equal(actualTarget, targetAfter); await metadataProof(path, targetAfter, body, id, kind);
        const completed = typed.replace(prefix, "[[" + linktext + "#^" + id + "]]"); assert.equal(await evaluate("app.editor.getValue()"), completed);
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed); await exact(path, targetAfter);
        await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed);
        expected.set(source(mode), completed); expected.set(path, targetAfter); ids.push({ mode, kind, sameNote: false, id, path });
      }
      await capture?.("callout-authoring-" + mode);
      pass(report, `${mode}: actual cross-note callout choices acknowledge a real guarded target write before inserting the source link. Fold/title syntax and EOF bodies remain exact and completely addressable; source Undo keeps the other note's marker, and normal saves retain all unrelated BOM/CRLF/Unicode bytes.`);
    }

    stage = "query inside callout descendants";
    const excludedQueries = [];
    for (const kind of ["open", "closed"]) {
      current = { mode: "source", kind, path: source("source") }; await open("source");
      const from = sourceText.indexOf(bodies[kind]), child = sourceText.indexOf(kind === "open" ? ">   - Nested child" : "> > Final closed quote", from), insertAt = sourceText.indexOf(newline, child), prefix = " [[#^" + queries[kind]; assert.ok(insertAt > child);
      await evaluate(`(()=>{const e=app.editor,p=${insertAt},lines=e.getValue().slice(0,p).split(/\\r?\\n/);e.setCursor(lines.length-1,lines.at(-1).length);e.focus();return true})()`);
      await command("Input.insertText", { text: prefix });
      const typed = sourceText.slice(0, insertAt) + prefix + sourceText.slice(insertAt); assert.equal(await evaluate("app.editor.getValue()"), typed);
      const proof = await evaluate(`(()=>{const s=${provider},e=app.editor,f=app.workspace.getActiveFile(),t=s.onTrigger(e.getCursor(),e,f);return t?{query:t.query,from:t.start.offset,to:t.end.offset,ownerRows:s.getSuggestions({...t,editor:e,file:f}).filter(value=>value.kind==="create-block"&&value.from===${from}).length}:null})()`);
      assert.deepEqual(proof, { query: queries[kind], from: insertAt + 1, to: insertAt + prefix.length, ownerRows: 0 }, "a valid callout-descendant query excludes the complete owner");
      excludedQueries.push({ kind, ...proof }); await escape(tools);
    }
    report.calloutAuthoringQueryExclusion = excludedQueries;
    await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText);
    pass(report, "A real valid query typed inside a callout list descendant or nested ordinary quote excludes the complete top-level callout owner by exact source offsets.");

    const edgeQuery = async (name, kind) => {
      const path = edge(name), text = targetText(kind), linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(source("source"))})`), prefix = "[[" + linktext + "#^" + queries[kind];
      const typed = await type("source", prefix), selector = row(path, text.indexOf(bodies[kind]));
      await wait(`Boolean(document.querySelector(${q(selector)}))`, "an actual guarded compound authoring row is visible"); return { path, text, typed, selector };
    };
    stage = "retained stale callout choice";
    const stale = await edgeQuery("Held callout", "open");
    await evaluate(`(()=>{const t=calloutAuthoringTrace,s=${provider};t.held={element:document.querySelector(${q(stale.selector)}),provider:s,value:s.getSuggestions(s.context).find(value=>value.kind==="create-block"&&value.path===${q(stale.path)})};return true})()`);
    const replacement = stale.text.replace("Final nested quote remains exact.", "Newer nested quote Ω must survive."); await writeFile(join(directory, stale.path), bytes(replacement)); await evaluate("app.metadataCache.refresh()");
    await wait(`app.metadataCache.getDocument(${q(stale.path)})?.text===${q(replacement)}`, "the actual retained callout body replacement is indexed");
    await evaluate('(async()=>{const t=calloutAuthoringTrace,h=t.held;t.phase="retained";try{h.element.click();await h.provider.selectSuggestion(h.value)}finally{delete t.held;delete t.phase}})()');
    assert.equal(await evaluate("app.editor.getValue()"), stale.typed); await exact(stale.path, replacement); expected.set(stale.path, replacement); await escape(tools);

    stage = "real preflight stale source";
    const guard = await edgeQuery("Guard callout", "closed"), refusal = "The source or target note changed. No target edit was added.";
    await evaluate('(()=>{const t=calloutAuthoringTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)}})()');
    await expectErrors(tools, [{ source: "notification", message: refusal }], async () => {
      await click(guard.selector); await wait("calloutAuthoringTrace.waiting", "the actual compound FileManager preflight is held in saveAll");
      await evaluate("app.editor.setCursor(0,0);app.saveAll=calloutAuthoringTrace.saveAll;calloutAuthoringTrace.release()"); await settled(tools);
      await wait(`document.querySelector("#client-errors").textContent.includes(${q(refusal)})`, "the stale compound source is visibly refused");
    }, "invalidate the actual source cursor during the real compound FileManager preflight before any target marker is written");
    await evaluate(restoredMethods); assert.equal(await evaluate("app.editor.getValue()"), guard.typed); await exact(guard.path, guard.text); await click("[data-dismiss-error]");

    stage = "physical callout write conflict";
    const collision = await edgeQuery("Conflict callout", "closed"), conflict = await saveConflictMessage(tools), external = collision.text.replace("Final closed quote remains exact.", "External closed quote Ω must survive.");
    await evaluate(`(()=>{const t=calloutAuthoringTrace;t.write=app.vault.writeDocument;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.writeDocument=async function(path,...args){if(path===${q(collision.path)}){t.waiting=true;await t.gate}return t.write.call(this,path,...args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: conflict }], async () => {
      await click(collision.selector); await wait("calloutAuthoringTrace.waiting", "the real compound optimistic write is held after its reviewed version read");
      await writeFile(join(directory, collision.path), bytes(external)); await evaluate("app.vault.writeDocument=calloutAuthoringTrace.write;calloutAuthoringTrace.release()"); await settled(tools);
      await wait(`document.querySelector("#client-errors").textContent.includes(${q(conflict)})`, "the actual callout target version conflict is visible");
    }, "physically replace the callout target between its real reviewed read and optimistic host write without bypassing normal conflict checks");
    await evaluate(restoredMethods); assert.equal(await evaluate("app.editor.getValue()"), collision.typed); await exact(collision.path, external); expected.set(collision.path, external); await click("[data-dismiss-error]");
    await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText);
    pass(report, "A retained actual callout row refuses a later nested-quote body replacement. Real FileManager preflight rejects a stale source, and a physical callout replacement after the reviewed version read rejects the actual optimistic write, preserving the newer target and source without speculative IDs or links.");

    stage = "acknowledged callout with stale source";
    const retained = await edgeQuery("Retained callout", "open");
    await evaluate('(()=>{const t=calloutAuthoringTrace;t.assign=app.fileManager.assignBlockId;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.fileManager.assignBlockId=async function(...args){const written=await t.assign.apply(this,args);t.waiting=true;await t.gate;return written}})()');
    await click(retained.selector); await wait("calloutAuthoringTrace.waiting", "the actual callout marker write and cleanup have acknowledged before source invalidation");
    const kept = (await readFile(join(directory, retained.path))).toString("utf8").replace(/^\ufeff/, ""), keptId = marked(kept, bodies.open);
    await evaluate("app.editor.setCursor(0,0);app.fileManager.assignBlockId=calloutAuthoringTrace.assign;calloutAuthoringTrace.release()"); await settled(tools);
    await wait(`[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(retained.path)})&&note.textContent.includes("block ID was written")&&note.textContent.includes("no source link"))`, "the acknowledged callout ID is retained with a no-link notice");
    assert.equal(await evaluate("app.editor.getValue()"), retained.typed); await exact(retained.path, kept); await metadataProof(retained.path, kept, bodies.open, keptId, "open"); expected.set(retained.path, kept); await evaluate(restoredMethods);
    await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText);
    pass(report, "An acknowledged callout target ID survives a later source-cursor invalidation. No source link is inserted, and the normal no-link notice names the retained target without a rollback.");

    for (const [path, text] of expected) await exact(path, text);
    const trusted = await evaluate('calloutAuthoringTrace.trusted.filter(value=>value.phase==="normal")');
    assert.equal(trusted.length, 11); assert.ok(trusted.every(value => value.trusted)); assert.ok(trusted.some(value => value.type === "pointer")); assert.ok(trusted.some(value => value.type === "Enter"));
    report.calloutAuthoringInputs = trusted; report.calloutAuthoringIds = ids;
    report.calloutAuthoring = { sourceAndLivePreview: true, wholeTopLevelCallout: true, optionalFoldAndTitle: true, ordinaryNestedQuoteAndLists: true, exactMetadataRoundtrip: true, isolatedCombinedUndoRedo: true, sourceUndoKeepsCrossMarker: true, freshExistingIdRows: true, descendantQueryExcluded: true, staleHeldBodyRefused: true, staleSourcePreflight: true, physicalTargetConflict: true, acknowledgedMarkerRetained: true, exactBomCrlfUnicode: true, trustedEnterAndPointer: true };
    await evaluate("calloutAuthoringTrace.abort.abort()");
    stage = "restart saved callout authoring";
    await evaluate(`(async()=>{await app.openFile(${q(source("live-preview"))});app.workspace.activeLeaf.view.setEditingMode("live-preview");await app.saveAll();await app.workspace.flushLayout()})()`);
    for (const [path, text] of expected) await exact(path, text);
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(source("live-preview"))}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"&&app.editor.getValue()===${q(expected.get(source("live-preview")))}`, "saved callout source and Live Preview restore after the owned restart");
    for (const [path, text] of expected) await exact(path, text);
    const restored = ids.find(value => !value.sameNote && value.mode === "live-preview" && value.kind === "closed"), line = sourceText.split(newline).indexOf("Reference: ");
    await evaluate(`(()=>{const e=app.editor;e.setCursor(${line},e.getLine(${line}).length);e.focus();return true})()`);
    const restoredLink = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(restored.path)}),${q(source("live-preview"))})`);
    await command("Input.insertText", { text: " [[" + restoredLink + "#^" + restored.id });
    await wait(`Boolean(document.querySelector(${q(popup + ` [data-builtin-block=${q(restored.id)}]`)}))`, "a fresh restarted provider offers the saved whole-callout existing ID");
    await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), expected.get(source("live-preview")));
    await capture?.("callout-authoring-restored"); report.calloutAuthoring.restart = true; report.calloutAuthoring.freshExistingIdAfterRestart = true;
    pass(report, "Owned restart or actual-folder browser reconnection retains every exact saved callout fixture and Live Preview mode. A fresh provider offers the saved existing ID; Escape and trusted Undo preserve its source and acknowledged target bytes.");
  } catch (error) {
    report.calloutAuthoringFailure = { stage, ...current, error: String(error?.stack ?? error) };
    try { report.calloutAuthoringFailure.state = await evaluate(`(()=>({path:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode?.(),text:app.editor.getValue(),cursor:app.editor.getCursor(),changingFiles:app.workspace.isChangingFiles,pending:Boolean((${provider}).pendingCreate),rows:[...document.querySelectorAll(${q(popup + " .suggestion-item")})].map(r=>({text:r.textContent,path:r.dataset.builtinCreateBlock,from:r.dataset.builtinBlockStart})),trusted:globalThis.calloutAuthoringTrace?.trusted??[]}))()`); } catch { /* Keep the first failure. */ }
    try { await capture?.("callout-authoring-precleanup-failure"); } catch { /* Keep the first failure. */ }
    throw error;
  } finally {
    await evaluate(restoredMethods); await settled(tools); await evaluate("globalThis.calloutAuthoringTrace?.abort?.abort()"); await evaluate("app.saveAll()");
    if (config) await writeFile(configPath, config); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await evaluate('app.configuration.read("app");app.markdownAutosave.configure()');
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate("app.workspace.flushLayout()");
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)");
    await evaluate(`app.saveLocalStorage("fold-state-v1",${q(foldProfile)});delete globalThis.calloutAuthoringTrace`);
  }
}

function readOnlyProof() {
  const body = ["> [!note]- Cached callout λ 😀", "> Cached body Ω.", ">", "> - Cached list item.", ">", "> > Cached nested quote."].join("\r\n"), prefix = "[[Known target#^Cached callout";
  const editor = app.editor, file = app.workspace.getActiveFile(), lines = editor.getValue().split(/\r?\n/), line = lines.findIndex(value => value.includes(prefix));
  if (line < 0) throw Error("Missing genuine cached callout source prefix");
  const target = app.metadataCache.getDocument("Known target.md"), section = target?.cache.sections.find(s => s.type === "blockquote" && target.text.slice(s.position.start.offset, s.position.end.offset).replace(/\r$/, "") === body);
  if (!target || target.missing || !section) throw Error("Missing actual eligible cached whole callout");
  const from = section.position.start.offset, to = section.position.end.offset;
  if (target.cache.ignored.some(r => r.from < to && r.to > from) || target.cache.footnotes.some(n => n.position.start.offset < to && n.position.end.offset > from)
    || Object.values(target.cache.blocks).some(b => b.position.start.offset < to && b.position.end.offset > from)) throw Error("Cached callout has an unsafe owner or existing ID");
  editor.setCursor(line, lines[line].length); editor.focus();
  const suggest = app.editorSuggestions.suggests.find(value => value.containerEl.dataset.builtinSuggest === "source"), cursor = editor.getCursor();
  return { targetEligible: true, type: "blockquote", trigger: suggest.onTrigger(cursor, editor, file), choices: suggest.getSuggestions({ editor, file, start: cursor, end: cursor, query: "Known target#^Cached callout" }).length };
}

/** Parent verifies the original mounted blobs and zero API/raw requests after return. */
export async function checkCalloutAuthoringReadOnly({ evaluate, command, wait, report, capture }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), paths = await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), originalMode = await evaluate("app.workspace.activeLeaf.view.getEditingMode()");
  try {
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false)`);
      const proof = await evaluate(`(${readOnlyProof.toString()})()`);
      assert.deepEqual(proof, { targetEligible: true, type: "blockquote", trigger: null, choices: 0 });
      await command("Page.bringToFront"); await command("Input.insertText", { text: " discarded authoring input" }); await key(command, "Enter", "Enter", 13);
      await wait(`!document.querySelector(${q(popup)})`, "genuine cached read-only callout authoring stays closed");
      assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), paths);
    }
    report.calloutAuthoringReadOnly = { genuineCacheOnly: true, sourceAndLivePreview: true, eligibleActualWholeCallout: true, triggersDeclined: true, directEnumerationDeclined: true, trustedInputRefused: true, sourceAndInventoryExact: true };
    await capture?.("callout-authoring-readonly");
    pass(report, "Genuine cache-only callout metadata contains an actual eligible unlabelled whole body. In Source and Live Preview, its real cached source prefix refuses authoring triggers, direct candidates and trusted typing/Enter while source, inventory and parent-audited blobs/traffic remain exact.");
  } finally {
    await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(originalMode)},false)`);
  }
}
