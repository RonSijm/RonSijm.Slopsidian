import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors, saveConflictMessage } from "./error-log-audit.mjs";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const popup = '[data-builtin-suggest="source"]:popover-open';
const provider = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const row = (path, subpath) => `${popup} [data-builtin-create-heading=${q(path)}][data-builtin-heading-subpath=${q(subpath)}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const root = "Parent λ", branch = "Existing branch 😀", mixed = "Mixed branch Ω", child = "New Setext child Ω";
const suffix = ["New ancestor λ", "New leaf 😀"], crossSubpath = [root, branch, ...suffix].join("#");
const sourceText = ['---', 'status: Retain Setext source', '---', '', root, '========', '', branch, '  --------', '', 'Retain source λ 😀.', '', '### ' + mixed, '', 'Mixed original body Ω.', '', '  Other λ', ' ========', '', 'Reference: ', '', 'Unrelated source Ω remains exact.', ''].join("\r\n");
const targetText = ['---', 'opaque: "Keep Setext target exact"', '---', '', '# ' + root, '', branch, '  --------', '', 'Retain target λ 😀.', '', '  Sibling Ω', '   --------', '', 'Sibling target Ω remains exact.', '', 'Outside λ', '========', '', 'Outside target remains exact.', ''].join("\r\n");
const queryLine = sourceText.split("\r\n").indexOf("Reference: "), targetBodyLine = targetText.split("\r\n").indexOf("Retain target λ 😀.");
const atx = (parts, level) => parts.map((part, index) => "#".repeat(level + index) + " " + part);
const add = (text, before, parts, level) => text.replace(before, atx(parts, level).join("\r\n\r\n") + "\r\n\r\n" + before);

/** Append both source lines and this separate target section to the parent's genuine cache-only fixture. */
export const setextAuthoringReadOnlyFixture = {
  sourcePrefixes: [
    "[[Known target#Cached Setext root λ#Missing cached child Ω",
    "[[Known target#Cached Setext root λ#Cached Setext branch 😀#Cached ATX branch Ω#Missing cached ancestor λ#Missing cached leaf 😀",
  ],
  targetAddition: "\r\nCached Setext root λ\r\n ========\r\n\r\nCached Setext branch 😀\r\n  --------\r\n\r\n### Cached ATX branch Ω\r\n\r\nRetain cached Setext body λ 😀.\r\n",
};
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function escape(tools) { await key(tools.command, "Escape", "Escape", 27); await tools.wait(`!document.querySelector(${q(popup)})`, "the Setext authoring popup closes"); }
async function settled(tools) { await tools.wait(`!app.workspace.isChangingFiles&&!(${provider}).pendingCreate`, "the genuine Setext target assignment settles"); }

/** Real provider/Editor/FileManager acceptance; the parent owns builds, host lifecycle and diagnostic audits. */
export async function checkSetextAuthoring(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Setext authoring", source = mode => folder + "/" + mode + ".md", target = mode => folder + "/Target " + mode + ".md", edge = name => folder + "/" + name + ".md";
  const edgeTexts = new Map(["Guard", "Conflict", "Retained", "Replaced", "Cleanup", "Changed parent", "Ambiguous", "Shadow", "Unclosed"].map(name => [edge(name),
    name === "Ambiguous" ? root + "\r\n========\r\n\r\n# " + root + "\r\n" : name === "Shadow" ? targetText + "\r\n" + [root, branch, suffix[0]].join("#") + "\r\n========\r\n" : name === "Unclosed" ? targetText.slice(0,targetText.indexOf("  Sibling Ω")) + "```md\r\nUnfinished Setext owner" : targetText]));
  const configPath = join(directory, ".obsidian", "app.json"), config = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const options = config ? JSON.parse(config.toString("utf8").replace(/^\ufeff/, "")) : {};
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), folds = await evaluate('app.loadLocalStorage("fold-state-v1")');
  const expected = new Map(); let stage = "fixture", current = {}, failure;
  const exact = async (path, text) => assert.deepEqual(await readFile(join(directory, path)), bytes(text));
  const configure = async format => {
    await writeFile(configPath, bytes(JSON.stringify({ ...options, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: false }, null, 2).replaceAll("\n", "\r\n") + "\r\n"));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()');
  };
  const open = async mode => {
    await escape(tools);
    await evaluate(`(async()=>{await app.openFile(${q(source(mode))});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});const e=app.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(sourceText)},"input.setext-fixture");e.setCursor(${queryLine},e.getLine(${queryLine}).length);e.focus()})()`);
    await command("Page.bringToFront");
    await evaluate('(async()=>{const e=app.editor,c=e.getCursor();e.focus();e.scrollIntoView({from:c,to:c},true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()');
    await wait(`app.workspace.getActiveFile()?.path===${q(source(mode))}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}&&app.editor.cm.hasFocus`, "the actual Setext source owner and caret are visibly measured before input");
  };
  const type = async (mode, prefix) => { await open(mode); await command("Input.insertText", { text: prefix }); const text = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n"); assert.equal(await evaluate("app.editor.getValue()"), text); return text; };
  const measure = async selector => {
    await command("Page.bringToFront");
    await evaluate('(async()=>{const e=app.editor,c=e.getCursor();e.focus();e.scrollIntoView({from:c,to:c},true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()');
    await wait(`app.editor.cm.hasFocus&&(${provider}).isCurrent()&&(${provider}).context?.editor===app.editor&&Boolean(document.querySelector(${q(selector)}))`, "the measured visible source retains its actual Setext popup owner");
  };
  const select = async (path, subpath, parts, level, method) => {
    const selector = row(path, subpath); await measure(selector);
    const preview = atx(parts, level).join("\n\n");
    assert.deepEqual(await evaluate(`(()=>{const r=document.querySelector(${q(selector)});return{level:r.dataset.builtinHeadingLevel,title:r.querySelector(".suggestion-title").textContent,path:r.querySelector(".suggestion-note").textContent,preview:r.querySelector("[data-builtin-heading-preview]")?.textContent??null}})()`),
      { level: String(level + parts.length - 1), title: parts.length > 1 ? "Create heading chain: " + parts.join(" → ") : "Create heading: " + parts[0], path: path + "#" + subpath + (parts.length > 1 ? "" : " · " + preview), preview: parts.length > 1 ? preview : null });
    await capture?.("setext-preview-" + path.split("/").at(-1).replace(/\.md$/, "").replaceAll(" ", "-") + "-" + level);
    if (method === "pointer") await click(selector);
    else {
      await measure(selector); const cursor = await evaluate("app.editor.getCursor()");
      // A stationary pointer may have selected Create during layout. Use real
      // keyboard input to select the ordinary row first, then navigate once.
      if (await evaluate(`document.querySelector(${q(selector)}).getAttribute("aria-selected")==="true"`)) await key(command, "ArrowUp", "ArrowUp", 38);
      assert.equal(await evaluate(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")`), "false");
      await key(command, "ArrowDown", "ArrowDown", 40);
      assert.equal(await evaluate(`document.querySelector(${q(selector)})?.getAttribute("aria-selected")`), "true");
      assert.equal(await evaluate(`(${provider}).isCurrent()&&app.editor.cm.hasFocus`), true); assert.deepEqual(await evaluate("app.editor.getCursor()"), cursor);
      await key(command, "Enter", "Enter", 13);
    }
    await settled(tools);
  };
  const reset = async () => { await open("source"); await evaluate("app.saveAll()"); expected.set(source("source"), sourceText); };
  const restore = '(function(){const t=globalThis.setextAuthoringTrace;if(!t)return;if(t.saveAll)app.saveAll=t.saveAll;if(t.assign)app.fileManager.assignMarkdownSubpath=t.assign;if(t.write)app.vault.writeDocument=t.write;if(t.refresh)app.metadataCache.refresh=t.refresh;t.release?.();delete t.saveAll;delete t.assign;delete t.write;delete t.refresh})()';
  try {
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, folder), { recursive: true });
    for (const mode of ["source", "live-preview"]) { await writeFile(join(directory, source(mode)), bytes(sourceText), { flag: "wx" }); await writeFile(join(directory, target(mode)), bytes(targetText), { flag: "wx" }); expected.set(source(mode), sourceText); expected.set(target(mode), targetText); }
    for (const [path, text] of edgeTexts) { await writeFile(join(directory, path), bytes(text), { flag: "wx" }); expected.set(path, text); }
    await configure("shortest"); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`${q([...expected.entries()])}.every(([path,text])=>app.metadataCache.getDocument(path)?.text===text)`, "every physical Setext fixture is indexed before trusted input");
    await evaluate(`(()=>{const t=globalThis.setextAuthoringTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const r=event.target.closest?.("[data-builtin-create-heading]");if(r)t.trusted.push({trusted:event.isTrusted,type:"pointer",path:r.dataset.builtinCreateHeading,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal});window.addEventListener("keydown",event=>{const r=document.querySelector(${q(popup + ' [data-builtin-create-heading][aria-selected=true]')});if(event.key==="Enter"&&r&&app.editor.cm.dom.contains(event.target))t.trusted.push({trusted:event.isTrusted,type:"Enter",path:r.dataset.builtinCreateHeading,mode:app.workspace.activeLeaf.view.getEditingMode()})},{capture:true,signal:t.abort.signal})})()`);
    for (const mode of ["source", "live-preview"]) {
      await configure(mode === "source" ? "shortest" : "relative");
      for (const [subpath, parts, level, method] of [[root + "#" + child, [child], 2, "Enter"], [[root, branch, mixed, ...suffix].join("#"), suffix, 4, "pointer"]]) {
        stage = "same-note Setext ancestor"; current = { mode, subpath };
        const prefix = "[[#" + subpath, typed = await type(mode, prefix);
        await evaluate("(()=>{setextAuthoringTrace.editor=app.editor;setextAuthoringTrace.cm=app.editor.cm;setextAuthoringTrace.leaf=app.workspace.activeLeaf;return true})()");
        await select(source(mode), subpath, parts, level, method);
        const completed = add(typed.replace(prefix, prefix + "]]"), "  Other λ\r\n ========", parts, level);
        assert.equal(await evaluate("app.editor.getValue()"), completed); assert.equal(await evaluate("app.editor===setextAuthoringTrace.editor&&app.editor.cm===setextAuthoringTrace.cm&&app.workspace.activeLeaf===setextAuthoringTrace.leaf"), true);
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed);
        await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed); expected.set(source(mode), completed);
      }
      pass(report, `${mode}: trusted ArrowDown/Enter creates an ATX H2 beneath a Setext H1; trusted pointer creates H4/H5 beneath the longest mixed Setext H1/H2 and ATX H3 prefix. Preview, source link and all descendant headings are exact; one isolated Undo/Redo retains the original titles, underlines, indented sibling and editor identity.`);
      stage = "cross-note mixed Setext prefix and clean peer history"; current = { mode, path: target(mode) }; await open(mode);
      await evaluate(`(async()=>{const t=setextAuthoringTrace;t.sourceLeaf=app.workspace.activeLeaf;t.peer=app.workspace.getLeaf("split");await t.peer.openFile(app.vault.getFileByPath(${q(target(mode))}));t.peer.view.setEditingMode("source");app.workspace.setActiveLeaf(t.peer,{focus:true});t.peerEditor=app.editor;t.peerCm=app.editor.cm;app.editor.setCursor(${targetBodyLine},0);app.editor.focus()})()`);
      await command("Input.insertText", { text: "History " }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), targetText);
      await evaluate(`app.workspace.setActiveLeaf(setextAuthoringTrace.sourceLeaf,{focus:true});app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus()`);
      await command("Page.bringToFront"); await evaluate('(async()=>{const e=app.editor,c=e.getCursor();e.focus();e.scrollIntoView({from:c,to:c},true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()');
      await wait(`app.workspace.activeLeaf===setextAuthoringTrace.sourceLeaf&&app.editor.cm.hasFocus`, "the split source caret is visibly measured before its cross-note query");
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target(mode))}),${q(source(mode))})`), prefix = "[[" + linktext + "#" + crossSubpath;
      await command("Input.insertText", { text: prefix }); const typed = sourceText.replace("Reference: \r\n", "Reference: " + prefix + "\r\n"); assert.equal(await evaluate("app.editor.getValue()"), typed);
      await select(target(mode), crossSubpath, suffix, 3, mode === "source" ? "pointer" : "Enter");
      const written = add(targetText, "  Sibling Ω\r\n   --------", suffix, 3), completed = typed.replace(prefix, prefix + "]]");
      await exact(target(mode), written); assert.equal(await evaluate("app.editor.getValue()"), completed); assert.equal(await evaluate("setextAuthoringTrace.peer.view.editor===setextAuthoringTrace.peerEditor&&setextAuthoringTrace.peer.view.editor.cm===setextAuthoringTrace.peerCm&&setextAuthoringTrace.peer.view.editor.getValue()"), written);
      await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), typed); await exact(target(mode), written);
      await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), completed); await evaluate("app.saveAll()"); await exact(source(mode), completed);
      await evaluate("app.workspace.setActiveLeaf(setextAuthoringTrace.peer,{focus:true});app.editor.focus()"); await key(command, "y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), written.replace("Retain target", "History Retain target"));
      await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), written);
      await evaluate("app.workspace.setActiveLeaf(setextAuthoringTrace.sourceLeaf,{focus:true});app.editor.focus()"); await evaluate("app.workspace.closeLeaf(setextAuthoringTrace.peer)"); await evaluate("delete setextAuthoringTrace.peer");
      expected.set(source(mode), completed); expected.set(target(mode), written); await capture?.("setext-cross-" + mode);
      pass(report, `${mode}: the real optimistic target assignment creates H3/H4 under an ATX H1/Setext H2 prefix before an indented Setext H2 sibling. The clean peer keeps its editor and earlier Redo, source Undo retains both acknowledged target headings, and every BOM/CRLF/Unicode byte remains exact.`);
    }

    stage = "source-only fallback and unsupported target proofs";
    const ordinaryPrefix = "[[Guard#" + crossSubpath, ordinary = await type("source", ordinaryPrefix), ordinaryLink = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(edge("Guard"))}),${q(source("source"))})`);
    await wait(`Boolean(document.querySelector(${q(row(edge("Guard"), crossSubpath))}))`, "both ordinary missing-heading and explicit Setext actions are offered");
    const ordinarySelector = popup + ' [data-builtin-unresolved-heading=' + q(edge("Guard")) + ']'; await measure(ordinarySelector);
    if (!await evaluate(`document.querySelector(${q(ordinarySelector)}).getAttribute("aria-selected")==="true"`)) await key(command, "ArrowUp", "ArrowUp", 38);
    assert.equal(await evaluate(`document.querySelector(${q(ordinarySelector)}).getAttribute("aria-selected")`), "true"); await key(command, "Enter", "Enter", 13);
    assert.equal(await evaluate("app.editor.getValue()"), ordinary.replace(ordinaryPrefix, "[[" + ordinaryLink + "#" + crossSubpath + "]]")); await exact(edge("Guard"), targetText);
    for (const [name, subpath] of [["Ambiguous", crossSubpath], ["Shadow", crossSubpath], ["Unclosed", crossSubpath], ["Guard", [root, branch, "Three", "Four", "Five", "Six", "Seven"].join("#")], ["Guard", root + "#**Unsafe**#Leaf"]]) {
      await type("source", "[[" + name + "#" + subpath); assert.equal(await evaluate(`Boolean(document.querySelector(${q(popup + ' [data-builtin-create-heading]')}))`), false); await exact(edge(name), edgeTexts.get(edge(name)));
    }
    await reset();
    const edgeQuery = async name => { const path = edge(name), spelling = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(source("source"))})`), typed = await type("source", "[[" + spelling + "#" + crossSubpath), selector = row(path, crossSubpath); await measure(selector); current = { path }; return { path, typed, selector }; };
    stage = "retained row with independently changed Setext depth";
    const changed = await edgeQuery("Changed parent"), changedText = targetText.replace(branch + "\r\n  --------", branch + "\r\n  ========");
    await writeFile(join(directory, changed.path), bytes(changedText)); await evaluate("app.metadataCache.refresh()"); await wait(`app.metadataCache.getDocument(${q(changed.path)})?.text===${q(changedText)}`, "the changed Setext depth is actually indexed before stale selection");
    await click(changed.selector); await settled(tools); assert.equal(await evaluate("app.editor.getValue()"), changed.typed); await exact(changed.path, changedText); expected.set(changed.path, changedText); await reset();
    pass(report, "Ordinary missing-heading Enter remains source-only. Mixed-syntax duplicates, whole-title shadows, unsafe titles, unfinished syntax and H6 overflow expose no Create action. A retained actual row refuses an independently changed Setext underline/depth without rewriting the source or newer target.");

    stage = "source preflight guard before Setext descendant assignment";
    const guard = await edgeQuery("Guard"), refusal = "The source or target note changed. No target edit was added.";
    await evaluate('(()=>{const t=setextAuthoringTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)}})()');
    await expectErrors(tools, [{ source: "notification", message: refusal }], async () => { await click(guard.selector); await wait("setextAuthoringTrace.waiting", "the actual Setext assignment preflight is held"); await evaluate("app.editor.setCursor(0,0);app.saveAll=setextAuthoringTrace.saveAll;setextAuthoringTrace.release()"); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(refusal)})`, "changed source owner refuses every target heading"); }, "change the real source cursor during FileManager preflight; no Setext descendant or source link is written");
    await evaluate(restore); assert.equal(await evaluate("app.editor.getValue()"), guard.typed); await exact(guard.path, targetText); await click("[data-dismiss-error]"); await reset();

    stage = "physical optimistic conflict";
    const conflict = await edgeQuery("Conflict"), conflictMessage = await saveConflictMessage(tools), external = targetText.replace("Retain target", "Independent newer target");
    await evaluate(`(()=>{const t=setextAuthoringTrace;t.write=app.vault.writeDocument;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.writeDocument=async function(path,...args){if(path===${q(conflict.path)}){t.waiting=true;await t.gate}return t.write.call(this,path,...args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: conflictMessage }], async () => { await click(conflict.selector); await wait("setextAuthoringTrace.waiting", "the real versioned Setext descendant write is held"); await writeFile(join(directory, conflict.path), bytes(external)); await evaluate("app.vault.writeDocument=setextAuthoringTrace.write;setextAuthoringTrace.release()"); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(conflictMessage)})`, "the backend rejects the independently changed physical version"); }, "physically replace the reviewed Setext target before the actual optimistic write; keep the newer target and source query intact");
    await evaluate(restore); assert.equal(await evaluate("app.editor.getValue()"), conflict.typed); await exact(conflict.path, external); expected.set(conflict.path, external); await click("[data-dismiss-error]"); await reset();

    const hold = () => evaluate('(()=>{const t=setextAuthoringTrace;t.assign=app.fileManager.assignMarkdownSubpath;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.fileManager.assignMarkdownSubpath=async function(...args){const written=await t.assign.apply(this,args);t.waiting=true;await t.gate;return written}})()');
    const written = add(targetText, "  Sibling Ω\r\n   --------", suffix, 3);
    stage = "acknowledged target with stale source";
    const retained = await edgeQuery("Retained"); await hold(); await click(retained.selector); await wait("setextAuthoringTrace.waiting", "the real target assignment acknowledges both Setext descendants"); await exact(retained.path, written);
    await evaluate("app.editor.setCursor(0,0);app.fileManager.assignMarkdownSubpath=setextAuthoringTrace.assign;setextAuthoringTrace.release()"); await settled(tools);
    await wait(`[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(retained.path)})&&note.textContent.includes("2 headings were written")&&note.textContent.includes("no source link"))`, "the acknowledged Setext descendants remain with a counted no-link notice");
    assert.equal(await evaluate("app.editor.getValue()"), retained.typed); await exact(retained.path, written); expected.set(retained.path, written); await evaluate(restore); await reset();
    stage = "observed newer target after acknowledgement";
    const replaced = await edgeQuery("Replaced"); await hold(); await click(replaced.selector); await wait("setextAuthoringTrace.waiting", "the acknowledged descendants precede an independent Setext replacement"); await exact(replaced.path, written);
    const replacement = targetText.replace(branch + "\r\n  --------", branch + "\r\n  ========"); await writeFile(join(directory, replaced.path), bytes(replacement)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); await wait(`app.metadataCache.getDocument(${q(replaced.path)})?.text===${q(replacement)}`, "the newer Setext parent and missing descendants are actually observed");
    await evaluate("app.fileManager.assignMarkdownSubpath=setextAuthoringTrace.assign;setextAuthoringTrace.release()"); await settled(tools); assert.equal(await evaluate("app.editor.getValue()"), replaced.typed); await exact(replaced.path, replacement); expected.set(replaced.path, replacement); await evaluate(restore); await reset();
    stage = "acknowledged target and cleanup failure";
    const cleanup = await edgeQuery("Cleanup"), cleanupError = "Setext descendant post-write refresh fixture failure";
    await evaluate(`(()=>{const t=setextAuthoringTrace;t.write=app.vault.writeDocument;t.refresh=app.metadataCache.refresh;t.fail=false;app.vault.writeDocument=async function(path,...args){const result=await t.write.call(this,path,...args);if(path===${q(cleanup.path)})t.fail=true;return result};app.metadataCache.refresh=async function(...args){if(t.fail){t.fail=false;throw Error(${q(cleanupError)})}return t.refresh.apply(this,args)}})()`);
    await expectErrors(tools, [{ source: "notification", message: cleanupError }], async () => { await click(cleanup.selector); await settled(tools); await wait(`document.querySelector("#client-errors").textContent.includes(${q(cleanupError)})&&[...document.querySelectorAll(".notice")].some(note=>note.textContent.includes(${q(cleanup.path)})&&note.textContent.includes("2 headings were written"))`, "the acknowledged descendants and original cleanup error are both reported"); }, "fail one metadata refresh after a genuine target write acknowledgement; retain both Setext descendants without inserting a source link");
    assert.equal(await evaluate("app.editor.getValue()"), cleanup.typed); await exact(cleanup.path, written); expected.set(cleanup.path, written); await evaluate(restore); await click("[data-dismiss-error]"); await reset();
    pass(report, "Real source preflight and physical optimistic conflicts preserve the source and target. After acknowledgement, a stale source or cleanup failure retains every new heading with the original diagnostic; an observed newer Setext parent remains exact and prevents obsolete source insertion without rollback.");

    stage = "restart and fresh existing Setext descendants";
    const inputs = await evaluate("setextAuthoringTrace.trusted"); assert.ok(inputs.length >= 6 && inputs.every(value => value.trusted));
    for (const mode of ["source", "live-preview"]) for (const method of ["Enter", "pointer"]) assert.ok(inputs.some(value => value.mode === mode && value.type === method)); report.setextAuthoringInputs = inputs;
    await evaluate("setextAuthoringTrace.abort.abort()"); await evaluate(`(async()=>{await app.openFile(${q(source("live-preview"))});app.workspace.activeLeaf.view.setEditingMode("live-preview");await app.saveAll();await app.workspace.flushLayout()})()`);
    for (const [path, text] of expected) await exact(path, text);
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await wait(`app.workspace.getActiveFile()?.path===${q(source("live-preview"))}&&app.editor.getValue()===${q(expected.get(source("live-preview")))}`, "saved Setext source and Live Preview restore after restart or reconnection");
    for (const [path, text] of expected) await exact(path, text);
    await evaluate(`app.editor.setCursor(${queryLine},app.editor.getLine(${queryLine}).length);app.editor.focus()`);
    const restartPrefix = " [[" + await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target("live-preview"))}),${q(source("live-preview"))})`) + "#" + crossSubpath;
    await command("Input.insertText", { text: restartPrefix }); const existingSelector = popup + ' [data-builtin-heading=' + q(suffix.at(-1)) + ']'; await measure(existingSelector);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(row(target("live-preview"), crossSubpath))}))`), false); await escape(tools); await key(command, "z", "KeyZ", 90, 2); assert.equal(await evaluate("app.editor.getValue()"), expected.get(source("live-preview"))); await capture?.("setext-restored");
    report.setextAuthoring = { realInputBothModes: true, measuredCurrentOwnerAndTrustedArrow: true, setextH1AndH2: true, longestMixedPrefix: true, atxOnlyNewOutput: true, originalTitleUnderlineAndSiblingIndentPreserved: true, sameNoteOneUndoRedo: true, cleanPeerHistory: true, sourceUndoKeepsTarget: true, ordinaryLinkSourceOnly: true, staleSetextDepthRefused: true, duplicateShadowUnsafeUnclosedAndH6Refused: true, actualSourcePreflight: true, physicalVersionConflict: true, acknowledgedStaleSource: true, observedNewerTarget: true, acknowledgedCleanupFailure: true, exactBomCrlfUnicode: true, restartAndFreshExistingChoices: true };
    pass(report, "Full native restart or real-folder browser reconnection retains every exact Setext fixture and installs a fresh provider that offers the acknowledged descendants as existing hierarchy choices. Original Setext titles/underlines and indented siblings remain byte-for-byte intact.");
  } catch (error) {
    failure = error; report.setextAuthoringFailure = { stage, ...current, error: String(error?.stack ?? error) };
    try { report.setextAuthoringFailure.state = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode?.(),source:app.editor.getValue(),cursor:app.editor.getCursor(),focus:app.editor.cm.hasFocus,current:(${provider}).isCurrent(),changingFiles:app.workspace.isChangingFiles,pending:Boolean((${provider}).pendingCreate),rows:[...document.querySelectorAll(${q(popup + ' .suggestion-item')})].map(r=>({text:r.textContent,path:r.dataset.builtinCreateHeading,selected:r.getAttribute("aria-selected")})),inputs:globalThis.setextAuthoringTrace?.trusted??[]}))()`); await capture?.("setext-precleanup-failure"); } catch { /* Keep the original failure. */ } throw error;
  } finally {
    const cleanup = [];
    try { await evaluate(restore); await settled(tools); await evaluate("globalThis.setextAuthoringTrace?.abort?.abort();app.saveAll()"); } catch (error) { cleanup.push(error); }
    try { if (config) await writeFile(configPath, config); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; }); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()'); await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate("app.workspace.flushLayout()"); if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)"); await evaluate(`app.saveLocalStorage("fold-state-v1",${q(folds)});delete globalThis.setextAuthoringTrace`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) throw new AggregateError(cleanup, "Could not restore the Setext authoring runtime fixture.");
  }
}

/** Parent mounts the exported additions and audits original cached blobs and zero API/raw traffic. */
export async function checkSetextAuthoringReadOnly(tools) {
  const { evaluate, command, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), paths = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  assert.equal(await evaluate(`(()=>{const d=app.metadataCache.getDocument("Known target.md");return Boolean(d&&!d.missing&&d.text.includes(${q(setextAuthoringReadOnlyFixture.targetAddition)})&&d.cache.headings.some(h=>h.heading==="Cached Setext root λ"&&h.level===1)&&d.cache.headings.some(h=>h.heading==="Cached Setext branch 😀"&&h.level===2))})()`), true);
  for (const prefix of setextAuthoringReadOnlyFixture.sourcePrefixes) {
    const location = await evaluate(`(()=>{const lines=app.editor.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value===${q(prefix)});if(line<0)throw Error("Missing actual cache-only Setext query");return{line,ch:lines[line].length}})()`);
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.setCursor(${location.line},${location.ch});app.editor.focus()`);
      assert.deepEqual(await evaluate(`(()=>{const p=${provider},e=app.editor,f=app.workspace.getActiveFile(),c=e.getCursor();return{trigger:p.onTrigger(c,e,f),choices:p.getSuggestions({editor:e,file:f,start:c,end:c,query:${q(prefix.slice(2))}}).length}})()`), { trigger: null, choices: 0 });
      await command("Page.bringToFront"); await command("Input.insertText", { text: "x" }); await key(command, "Enter", "Enter", 13); await wait(`!document.querySelector(${q(popup)})`, "cache-only Setext authoring stays closed after trusted input");
      assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), paths);
    }
  }
  await capture?.("setext-readonly"); report.setextAuthoringReadOnly = { genuineCacheOnly: true, actualSetextH1H2AndMixedPrefix: true, sourceAndLivePreview: true, triggerAndDirectChoicesRefused: true, trustedInputRefused: true, exactSourceAndInventory: true };
  pass(report, "A genuinely cached read-only target contains indexed Setext H1/H2 and ATX H3 ancestors. Its actual cached source queries refuse triggering, direct choices and trusted input in Source/Live Preview while source/inventory and parent-audited cached blobs/traffic remain exact.");
}
