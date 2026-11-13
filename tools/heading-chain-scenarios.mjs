import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors, saveConflictMessage } from "./error-log-audit.mjs";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const popup = '[data-builtin-suggest="source"]:popover-open';
const provider = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const row = (path, subpath) => `${popup} [data-builtin-create-heading=${q(path)}][data-builtin-heading-subpath=${q(subpath)}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const sourceText = ['---', 'status: Retain heading chain source', '---', '# Parent', '', '## Existing branch', '', 'Original nested source λ 😀.', '', '# Other', '', 'Reference: ', '', 'Unrelated source Ω remains exact.', ''].join("\r\n");
const targetText = ['---', 'opaque: "Keep heading chain target exact"', '---', '# Parent', '', '### Existing branch', '', 'Original nested target λ 😀.', '', '## Neighbor', '', 'Sibling target Ω remains exact.', '', '# Outside', '', 'Outside target remains exact.', ''].join("\r\n");
const queryLine = sourceText.split("\r\n").indexOf("Reference: "), targetBodyLine = targetText.split("\r\n").indexOf("Original nested target λ 😀.");
const rootParts = ["New root λ", "New branch 😀", "New leaf Ω"], childParts = ["New ancestor λ", "New leaf 😀"];
const rootSubpath = rootParts.join("#"), childSubpath = ["Parent", "Existing branch", ...childParts].join("#");
const atx = (parts, first) => parts.map((part, index) => "#".repeat(first + index) + " " + part);
const rootAdded = text => text + "\r\n" + atx(rootParts, 1).join("\r\n\r\n") + "\r\n";
const childAdded = (text, level, before) => text.replace(before, atx(childParts, level).join("\r\n\r\n") + "\r\n\r\n" + before);

export const headingChainsReadOnlyFixture = {
  sourcePrefixes: ["[[Known target#Missing cached root#Missing cached branch#Missing cached leaf", "[[Known target#Existing heading#Missing cached branch#Missing cached leaf"],
};
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function escape(tools) { await key(tools.command, "Escape", "Escape", 27); await tools.wait(`!document.querySelector(${q(popup)})`, "the heading-chain popup closes"); }
async function settled(tools) { await tools.wait(`!app.workspace.isChangingFiles&&!(${provider}).pendingCreate`, "the actual heading-chain assignment settles"); }

/** Shared actual-input acceptance; the caller owns host builds, lifecycle and error audits. */
export async function checkHeadingChains(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Heading chains", source = mode => folder + "/" + mode + ".md", target = mode => folder + "/Target " + mode + ".md", edge = name => folder + "/" + name + ".md";
  const edgeNames = ["Held prefix", "Guard", "Conflict", "Retained", "Replaced", "Cleanup", "Ambiguous", "Deepest", "Unclosed"];
  const edgeTexts = new Map(edgeNames.map(name => [edge(name), name === "Ambiguous" ? "# Parent\r\n# Parent\r\n" : name === "Deepest" ? "##### Parent\r\n" : name === "Unclosed" ? "# Parent\r\n\r\n```md\r\nUnclosed owner" : targetText]));
  const configPath = join(directory, ".obsidian", "app.json"), config = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const options = config ? JSON.parse(config.toString("utf8").replace(/^\ufeff/, "")) : {};
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), folds = await evaluate('app.loadLocalStorage("fold-state-v1")');
  const expected = new Map(), modes = ["source", "live-preview"];
  let stage = "fixture", current = {}, failure;
  const exact = async (path, text) => { assert.deepEqual(await readFile(join(directory, path)), bytes(text)); };
  const configure = async format => {
    await writeFile(configPath, bytes(JSON.stringify({ ...options, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: false }, null, 2).replaceAll("\n", "\r\n") + "\r\n"));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()');
  };
  const open = async mode => {
    await escape(tools);
    await evaluate(`(async()=>{await app.openFile(${q(source(mode))});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});const e=app.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(sourceText)},"input.heading-chain-fixture");e.setCursor(${queryLine},e.getLine(${queryLine}).length);e.focus()})()`);
    await command("Page.bringToFront"); await wait(`app.workspace.getActiveFile()?.path===${q(source(mode))}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}&&app.editor.cm.hasFocus`, "the actual heading-chain source is focused");
  };
  const type = async (mode, prefix) => { await open(mode); await command("Input.insertText", { text: prefix }); const text = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n"); assert.equal(await evaluate("app.editor.getValue()"), text); return text; };
  const select = async (path, subpath, parts, first, method) => {
    await command("Page.bringToFront");
    await evaluate('(async()=>{const e=app.editor,c=e.getCursor();e.focus();e.scrollIntoView({from:c,to:c},true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()');
    const selector = row(path, subpath); await wait(`Boolean(document.querySelector(${q(selector)}))`, "the actual explicit missing-ancestor chain action is offered");
    assert.deepEqual(await evaluate(`(()=>{const r=document.querySelector(${q(selector)});return{count:r.dataset.builtinHeadingCount,title:r.querySelector(".suggestion-title")?.textContent,path:r.querySelector(".suggestion-note")?.textContent,preview:r.querySelector("[data-builtin-heading-preview]")?.textContent,style:r.querySelector("[data-builtin-heading-preview]")?.style.whiteSpace}})()`),
      { count: String(parts.length), title: "Create heading chain: " + parts.join(" → "), path: path + "#" + subpath, preview: atx(parts, first).join("\n\n"), style: "pre-line" });
    await capture?.("heading-chain-preview-" + path.split("/").at(-1).replace(/\.md$/, "").replaceAll(" ", "-") + "-" + first);
    if (method === "pointer") await click(selector);
    else {
      const keyboardState = async phase => {
        const state = await evaluate(`(()=>{const p=${provider};return{cursor:app.editor.getCursor(),focus:app.editor.cm.hasFocus,current:p.isCurrent(),active:app.workspace.activeLeaf.id,activeEditor:app.workspace.activeEditor?.file?.path,context:p.context?.file?.path,element:document.activeElement?.outerHTML.slice(0,200),rows:[...document.querySelectorAll(${q(popup + ' .suggestion-item')})].map(r=>({selected:r.getAttribute("aria-selected"),path:r.dataset.builtinCreateHeading})),scroll:app.editor.getScrollInfo()}})()`);
        (report.headingChainsKeyboard ??= []).push({ phase, path, ...state }); return state;
      };
      await wait(`app.editor.cm.hasFocus&&(${provider}).isCurrent()&&Boolean(document.querySelector(${q(selector)}))`, "the measured visible source retains the current chain popup before keyboard input");
      await keyboardState("before");
      for (let index = 0; index < 40; index++) {
        if (await evaluate(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`)) break;
        await key(command, "ArrowDown", "ArrowDown", 40); const state = await keyboardState("after-arrow");
        assert.equal(state.current, true, "trusted navigation must retain its original popup owner and caret");
      }
      await wait(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")==="true"`, "the chain creation action is selected before trusted Enter"); await key(command, "Enter", "Enter", 13);
    }
    await settled(tools);
  };
  const reset = async () => { await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText); };
  const restore = '(function(){const t=globalThis.headingChainsTrace;if(!t)return;if(t.saveAll)app.saveAll=t.saveAll;if(t.assign)app.fileManager.assignMarkdownSubpath=t.assign;if(t.write)app.vault.writeDocument=t.write;if(t.refresh)app.metadataCache.refresh=t.refresh;t.release?.();delete t.saveAll;delete t.assign;delete t.write;delete t.refresh})()';
  try {
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, folder), { recursive: true });
    for (const mode of modes) { await writeFile(join(directory, source(mode)), bytes(sourceText), { flag: "wx" }); await writeFile(join(directory, target(mode)), bytes(targetText), { flag: "wx" }); expected.set(source(mode), sourceText); expected.set(target(mode), targetText); }
    for (const [path, text] of edgeTexts) { await writeFile(join(directory, path), bytes(text), { flag: "wx" }); expected.set(path, text); }
    await configure("shortest"); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`${q([...expected.entries()])}.every(([path,text])=>app.metadataCache.getDocument(path)?.text===text)`, "all physical heading-chain fixtures are indexed before input");
    await evaluate(`(()=>{const t=globalThis.headingChainsTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const r=event.target.closest?.("[data-builtin-heading-count]");if(r)t.trusted.push({trusted:event.isTrusted,type:"pointer",path:r.dataset.builtinCreateHeading,subpath:r.dataset.builtinHeadingSubpath,mode:app.workspace.activeLeaf.view.getEditingMode(),phase:t.phase??"normal"})},{capture:true,signal:t.abort.signal});window.addEventListener("keydown",event=>{const r=document.querySelector(${q(popup + " [data-builtin-heading-count][aria-selected=true]")});if(event.key==="Enter"&&r&&app.editor.cm.dom.contains(event.target))t.trusted.push({trusted:event.isTrusted,type:"Enter",path:r.dataset.builtinCreateHeading,subpath:r.dataset.builtinHeadingSubpath,mode:app.workspace.activeLeaf.view.getEditingMode(),phase:t.phase??"normal"})},{capture:true,signal:t.abort.signal})})()`);
    for (const mode of modes) {
      await configure(mode === "source" ? "shortest" : "relative");
      for (const [subpath, parts, level, method] of [[rootSubpath, rootParts, 1, "Enter"], [childSubpath, childParts, 3, "pointer"]]) {
        stage = "same-note chain"; current = { mode, subpath };
        const prefix = "[[#" + subpath, typed = await type(mode, prefix);
        await evaluate("(()=>{headingChainsTrace.editor=app.editor;headingChainsTrace.cm=app.editor.cm;headingChainsTrace.leaf=app.workspace.activeLeaf;return true})()");
        await select(source(mode), subpath, parts, level, method);
        const linked = typed.replace(prefix, prefix + "]]"), completed = level === 1 ? rootAdded(linked) : childAdded(linked, level, "# Other");
        assert.equal(await evaluate("app.editor.getValue()"), completed); assert.equal(await evaluate("app.editor===headingChainsTrace.editor&&app.editor.cm===headingChainsTrace.cm&&app.workspace.activeLeaf===headingChainsTrace.leaf"), true);
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed);
        await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed); expected.set(source(mode), completed);
        await capture?.("heading-chain-" + mode + (level === 1 ? "-root" : "-prefix"));
      }
      pass(report, `${mode}: real Enter and pointer Create heading chain actions explicitly preview every new ATX heading. An absent root creates H1/H2/H3; a unique existing Parent/Existing branch prefix creates only its missing H3/H4 suffix before its sibling. All ancestors and the source link share one isolated Undo/Redo step with exact BOM/CRLF/Unicode and editor identity retained.`);
      stage = "cross-note chain with clean peer history"; current = { mode, path: target(mode) }; await open(mode);
      await evaluate(`(async()=>{const t=headingChainsTrace;t.sourceLeaf=app.workspace.activeLeaf;t.peer=app.workspace.getLeaf("split");await t.peer.openFile(app.vault.getFileByPath(${q(target(mode))}));t.peer.view.setEditingMode("source");app.workspace.setActiveLeaf(t.peer,{focus:true});t.peerEditor=app.editor;t.peerCm=app.editor.cm;app.editor.setCursor(${targetBodyLine},0);app.editor.focus()})()`);
      await command("Input.insertText", { text: "History " }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), targetText);
      await evaluate(`(()=>{app.workspace.setActiveLeaf(headingChainsTrace.sourceLeaf,{focus:true});app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus();return true})()`);
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target(mode))}),${q(source(mode))})`), prefix = "[[" + linktext + "#" + childSubpath;
      await command("Input.insertText", { text: prefix }); const typed = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n");
      await select(target(mode), childSubpath, childParts, 4, mode === "source" ? "pointer" : "Enter");
      const written = childAdded(targetText, 4, "## Neighbor"), completed = typed.replace(prefix, prefix + "]]");
      await exact(target(mode), written); assert.equal(await evaluate("app.editor.getValue()"), completed);
      assert.equal(await evaluate("headingChainsTrace.peer.view.editor===headingChainsTrace.peerEditor&&headingChainsTrace.peer.view.editor.cm===headingChainsTrace.peerCm&&headingChainsTrace.peer.view.editor.getValue()"), written);
      await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed); await exact(target(mode), written);
      await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed);
      await evaluate("(()=>{app.workspace.setActiveLeaf(headingChainsTrace.peer,{focus:true});app.editor.focus();return true})()"); await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), written.replace("Original nested target", "History Original nested target"));
      await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), written);
      await evaluate("(()=>{app.workspace.setActiveLeaf(headingChainsTrace.sourceLeaf,{focus:true});app.editor.focus();return true})()"); await evaluate("app.workspace.closeLeaf(headingChainsTrace.peer)"); await evaluate("delete headingChainsTrace.peer");
      expected.set(source(mode), completed); expected.set(target(mode), written); await capture?.("heading-chain-cross-" + mode);
      pass(report, `${mode}: one genuine optimistic target write creates the reviewed H4/H5 ancestor suffix under the existing H3 parent before its next sibling. The clean target peer keeps its editor and earlier Redo; source Undo retains every acknowledged target heading and Redo restores only the link. Exact target/source bytes remain intact.`);
    }
    stage = "ordinary source-only and unsupported chain actions";
    const ordinary = await type("source", "[[Guard#" + rootSubpath), linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(edge("Guard"))}),${q(source("source"))})`);
    const ordinarySelector = popup + " [data-builtin-unresolved-heading=" + q(edge("Guard")) + "]";
    await wait(`app.editor.cm.hasFocus&&(${provider}).isCurrent()&&Boolean(document.querySelector(${q(ordinarySelector)}))`, "ordinary source-only missing chain link remains first");
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    // A stationary pointer can hover Create when the new popup is positioned.
    // Select the ordinary action explicitly before testing its source-only Enter.
    if (await evaluate(`document.querySelector(${q(ordinarySelector)}).getAttribute("aria-selected")!=="true"`)) { await key(command, "ArrowUp", "ArrowUp", 38); }
    assert.equal(await evaluate(`document.querySelector(${q(ordinarySelector)})?.getAttribute("aria-selected")`), "true");
    await key(command, "Enter", "Enter", 13); await wait(`app.editor.getValue()===${q(ordinary.replace("[[Guard#" + rootSubpath, "[[" + linktext + "#" + rootSubpath + "]]"))}`, "ordinary Enter completes the missing chain link without target authoring"); await exact(edge("Guard"), targetText);
    for (const [name, subpath] of [["Ambiguous", "Parent#New ancestor#Leaf"], ["Deepest", "Parent#New ancestor#Leaf"], ["Unclosed", "Parent#New ancestor#Leaf"], ["Guard", "Parent#**Unsafe ancestor**#Leaf"], ["Guard", "A#B#C#D#E#F#G"]]) {
      await type("source", "[[" + name + "#" + subpath); assert.equal(await evaluate(`Boolean(document.querySelector(${q(popup + " [data-builtin-heading-count]")}))`), false); await exact(edge(name), edgeTexts.get(edge(name)));
    }
    await reset();
    stage = "held prefix appears before selection";
    const heldPrefix = "[[Held prefix#" + childSubpath, heldTyped = await type("source", heldPrefix), heldSelector = row(edge("Held prefix"), childSubpath);
    await wait(`Boolean(document.querySelector(${q(heldSelector)}))`, "an actual missing-chain row is captured before an ancestor appears");
    await evaluate(`(()=>{const t=headingChainsTrace,s=${provider};t.held={element:document.querySelector(${q(heldSelector)}),provider:s,value:s.getSuggestions(s.context).find(value=>value.kind==="create-heading")};return true})()`);
    const appeared = targetText.replace("## Neighbor", "#### New ancestor λ\r\n\r\n## Neighbor"); await writeFile(join(directory, edge("Held prefix")), bytes(appeared)); await evaluate("app.metadataCache.refresh()"); await wait(`app.metadataCache.getDocument(${q(edge("Held prefix"))})?.text===${q(appeared)}`, "the newly existing ancestor is actually observed");
    await evaluate('(async()=>{const t=headingChainsTrace,h=t.held;t.phase="held-prefix";try{h.element.click();await h.provider.selectSuggestion(h.value)}finally{delete t.held;delete t.phase}})()');
    assert.equal(await evaluate("app.editor.getValue()"), heldTyped); await exact(edge("Held prefix"), appeared); expected.set(edge("Held prefix"), appeared); await reset();
    pass(report, "Ordinary missing-chain Enter stays source-only. Ambiguous duplicate parents, unsafe ancestors, unfinished fenced syntax and chains deeper than H6 expose no chain creation. A retained actual row/direct provider value refuses an independently appeared ancestor and preserves all newer target/source bytes.");
    const edgeQuery = async name => { const path = edge(name), spelling = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(source("source"))})`), typed = await type("source", "[[" + spelling + "#" + childSubpath), selector = row(path, childSubpath); await wait(`Boolean(document.querySelector(${q(selector)}))`, "guarded real chain action is offered"); current = { path }; return { path, typed, selector }; };
    stage = "source guard before any ancestor write";
    const guard = await edgeQuery("Guard"), refusal = "The source or target note changed. No target edit was added.";
    await evaluate('(()=>{const t=headingChainsTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)}})()');
    await expectErrors(tools, [{ source: "notification", message: refusal }], async () => { await click(guard.selector); await wait("headingChainsTrace.waiting", "the actual chain preflight save is held"); await evaluate("app.editor.setCursor(0,0);app.saveAll=headingChainsTrace.saveAll;headingChainsTrace.release()"); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(refusal)})`, "stale source refuses the whole ancestor chain"); }, "invalidate the actual source cursor during real FileManager preflight; no ancestor or terminal target heading is written");
    await evaluate(restore); assert.equal(await evaluate("app.editor.getValue()"), guard.typed); await exact(guard.path, targetText); await click("[data-dismiss-error]"); await reset();
    stage = "physical optimistic conflict writes no partial ancestor chain";
    const conflict = await edgeQuery("Conflict"), conflictMessage = await saveConflictMessage(tools), external = targetText.replace("Original nested target", "External nested target");
    await evaluate(`(()=>{const t=headingChainsTrace;t.write=app.vault.writeDocument;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.writeDocument=async function(path,...args){if(path===${q(conflict.path)}){t.waiting=true;await t.gate}return t.write.call(this,path,...args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: conflictMessage }], async () => { await click(conflict.selector); await wait("headingChainsTrace.waiting", "actual chain write is held after its reviewed version read"); await writeFile(join(directory, conflict.path), bytes(external)); await evaluate("app.vault.writeDocument=headingChainsTrace.write;headingChainsTrace.release()"); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(conflictMessage)})`, "the host rejects the changed physical target version"); }, "physically replace the reviewed target before its real optimistic chain write; preserve external bytes without writing a partial ancestor chain or source link");
    await evaluate(restore); assert.equal(await evaluate("app.editor.getValue()"), conflict.typed); await exact(conflict.path, external); expected.set(conflict.path, external); await click("[data-dismiss-error]"); await reset();
    const hold = () => evaluate('(()=>{const t=headingChainsTrace;t.assign=app.fileManager.assignMarkdownSubpath;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.fileManager.assignMarkdownSubpath=async function(...args){const written=await t.assign.apply(this,args);t.waiting=true;await t.gate;return written}})()');
    stage = "acknowledged chain with changed source";
    const retained = await edgeQuery("Retained"); await hold(); await click(retained.selector); await wait("headingChainsTrace.waiting", "the whole chain is acknowledged before holding source insertion");
    const written = childAdded(targetText, 4, "## Neighbor"); await exact(retained.path, written); await evaluate("app.editor.setCursor(0,0);app.fileManager.assignMarkdownSubpath=headingChainsTrace.assign;headingChainsTrace.release()"); await settled(tools);
    await wait(`[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(retained.path)})&&note.textContent.includes("2 headings were written")&&note.textContent.includes("no source link"))`, "the acknowledged complete chain is retained with a counted no-link notice");
    assert.equal(await evaluate("app.editor.getValue()"), retained.typed); await exact(retained.path, written); expected.set(retained.path, written); await evaluate(restore); await reset();
    stage = "post-ack ancestor-only replacement";
    const replaced = await edgeQuery("Replaced"); await hold(); await click(replaced.selector); await wait("headingChainsTrace.waiting", "the complete acknowledged chain precedes its independent replacement"); await exact(replaced.path, written);
    const replacement = targetText.replace("## Neighbor", "#### New ancestor λ\r\n\r\nExternal ancestor-only body.\r\n\r\n## Neighbor"); await writeFile(join(directory, replaced.path), bytes(replacement)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); await wait(`app.metadataCache.getDocument(${q(replaced.path)})?.text===${q(replacement)}`, "the ancestor-only replacement is actually observed");
    await evaluate("app.fileManager.assignMarkdownSubpath=headingChainsTrace.assign;headingChainsTrace.release()"); await settled(tools); assert.equal(await evaluate("app.editor.getValue()"), replaced.typed); await exact(replaced.path, replacement); expected.set(replaced.path, replacement); await evaluate(restore); await reset();
    stage = "post-ack chain refresh failure";
    const cleanup = await edgeQuery("Cleanup"), cleanupError = "Heading chain post-write refresh fixture failure";
    await evaluate(`(()=>{const t=headingChainsTrace;t.write=app.vault.writeDocument;t.refresh=app.metadataCache.refresh;t.fail=false;app.vault.writeDocument=async function(path,...args){const result=await t.write.call(this,path,...args);if(path===${q(cleanup.path)})t.fail=true;return result};app.metadataCache.refresh=async function(...args){if(t.fail){t.fail=false;throw Error(${q(cleanupError)})}return t.refresh.apply(this,args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: cleanupError }], async () => { await click(cleanup.selector); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(cleanupError)})&&[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(cleanup.path)})&&note.textContent.includes("2 headings were written"))`, "the original cleanup error and retained complete ancestor chain are reported"); }, "fail one real post-ack metadata refresh; retain the complete chain and report its original error without inserting a source link");
    assert.equal(await evaluate("app.editor.getValue()"), cleanup.typed); await exact(cleanup.path, written); expected.set(cleanup.path, written); await evaluate(restore); await click("[data-dismiss-error]"); await reset();
    pass(report, "Real FileManager source preflight and physical optimistic version conflict refuse every ancestor write. After acknowledgement, changed source or cleanup failure keeps the complete two-heading suffix with an accurate counted Notice; an observed ancestor-only external replacement stays exact and prevents the obsolete source link without rollback.");
    stage = "restart and fresh existing hierarchy choices";
    const inputs = await evaluate("headingChainsTrace.trusted"), trusted = inputs.filter(value => value.phase === "normal"); assert.ok(trusted.length >= 6 && trusted.every(value => value.trusted)); assert.ok(trusted.some(value => value.type === "Enter") && trusted.some(value => value.type === "pointer")); report.headingChainsInputs = inputs;
    await evaluate("headingChainsTrace.abort.abort()"); await evaluate(`(async()=>{await app.openFile(${q(source("live-preview"))});app.workspace.activeLeaf.view.setEditingMode("live-preview");await app.saveAll();await app.workspace.flushLayout()})()`);
    for (const [path, text] of expected) await exact(path, text);
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await wait(`app.workspace.getActiveFile()?.path===${q(source("live-preview"))}&&app.editor.getValue()===${q(expected.get(source("live-preview")))}`, "the saved chain source and Live Preview restore after full restart/reconnection");
    for (const [path, text] of expected) await exact(path, text);
    await evaluate(`(()=>{app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus();return true})()`);
    const prefix = " [[" + await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target("live-preview"))}),${q(source("live-preview"))})`) + "#" + childSubpath;
    await command("Input.insertText", { text: prefix }); await wait(`Boolean(document.querySelector(${q(popup + ' [data-builtin-heading="New leaf 😀"]')}))`, "a fresh restarted provider offers the created chain as an ordinary existing hierarchy");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(row(target("live-preview"), childSubpath))}))`), false); await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), expected.get(source("live-preview"))); await capture?.("heading-chains-restored");
    report.headingChains = { realEnterAndPointerBothModes: true, rootH1H2H3: true, longestUniqueAtxPrefix: true, allNewTitlesPreviewed: true, exactSiblingPlacement: true, combinedSameNoteUndoRedo: true, oneOptimisticTargetWrite: true, cleanPeerRedoMapped: true, sourceUndoKeepsAllTargetHeadings: true, sourceOnlyMissingLinkPreserved: true, ambiguousUnsafeUnclosedAndH6Refused: true, retainedAppearedPrefixRefused: true, actualSourcePreflight: true, physicalConflictNoPartialChain: true, acknowledgedStaleSource: true, observedAncestorOnlyReplacement: true, acknowledgedCleanupError: true, countedRetainedNotice: true, exactBomCrlfUnicode: true, restartAndFreshExistingHierarchy: true };
    pass(report, "Full native restart or actual-folder browser reconnection retains every exact saved chain fixture and restores Live Preview. A fresh provider offers the created terminal heading through its existing hierarchy, with no duplicate Create chain row; Escape and trusted Undo preserve all saved source/target bytes.");
  } catch (error) {
    failure = error; report.headingChainsFailure = { stage, ...current, error: String(error?.stack ?? error) };
    try { report.headingChainsFailure.state = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode?.(),source:app.editor.getValue(),cursor:app.editor.getCursor(),changingFiles:app.workspace.isChangingFiles,pending:Boolean((${provider}).pendingCreate),rows:[...document.querySelectorAll(${q(popup + " .suggestion-item")})].map(row=>({text:row.textContent,path:row.dataset.builtinCreateHeading,count:row.dataset.builtinHeadingCount,subpath:row.dataset.builtinHeadingSubpath})),inputs:globalThis.headingChainsTrace?.trusted??[]}))()`); await capture?.("heading-chains-precleanup-failure"); } catch { /* Preserve the original failure. */ } throw error;
  } finally {
    const cleanup = [];
    try { await evaluate(restore); await settled(tools); await evaluate("globalThis.headingChainsTrace?.abort?.abort();app.saveAll()"); } catch (error) { cleanup.push(error); }
    try { if (config) await writeFile(configPath, config); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; }); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()'); await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate("app.workspace.flushLayout()"); if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)"); await evaluate(`app.saveLocalStorage("fold-state-v1",${q(folds)});delete globalThis.headingChainsTrace`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) throw new AggregateError(cleanup, "Could not restore the heading-chain runtime fixture.");
  }
}

/** Parent provides both exported source prefixes, Known target's Existing heading, exact-blob and zero-network audit. */
export async function checkHeadingChainsReadOnly(tools) {
  const { evaluate, command, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), paths = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  assert.equal(await evaluate('Boolean(app.metadataCache.getDocument("Known target.md")&&!app.metadataCache.getDocument("Known target.md").missing&&app.metadataCache.getCache("Known target.md").headings.some(value=>value.heading==="Existing heading"))'), true);
  for (const prefix of headingChainsReadOnlyFixture.sourcePrefixes) {
    const location = await evaluate(`(()=>{const lines=app.editor.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value===${q(prefix)});if(line<0)throw Error("Missing actual cached heading-chain prefix");return{line,ch:lines[line].length}})()`);
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.setCursor(${location.line},${location.ch});app.editor.focus();return true})()`);
      assert.deepEqual(await evaluate(`(()=>{const s=${provider},e=app.editor,f=app.workspace.getActiveFile(),p=e.getCursor();return{trigger:s.onTrigger(p,e,f),choices:s.getSuggestions({editor:e,file:f,start:p,end:p,query:${q(prefix.slice(2))}}).length}})()`), { trigger: null, choices: 0 });
      await command("Page.bringToFront"); await command("Input.insertText", { text: "x" }); await key(command, "Enter", "Enter", 13); await wait(`!document.querySelector(${q(popup)})`, "the actual cache-only chain authoring popup stays closed");
      assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), paths);
    }
  }
  await capture?.("heading-chains-readonly"); report.headingChainsReadOnly = { genuineCacheOnly: true, actualRootAndExistingPrefixQueries: true, bothEditingModes: true, triggerAndDirectEnumerationDeclined: true, trustedInputRefused: true, exactSourceAndInventory: true };
  pass(report, "A genuine cached read-only vault contains real all-new-root and existing-parent missing-chain prefixes. Source/Live Preview triggers, direct enumeration and trusted typing/Enter refuse creation while source/inventory remain exact; the parent audits original cached blobs and zero API/raw traffic.");
}
