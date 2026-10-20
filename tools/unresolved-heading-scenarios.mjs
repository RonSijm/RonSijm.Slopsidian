import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, popup = '[data-builtin-suggest="source"]:popover-open', attribute = "data-builtin-unresolved-heading";
const provider = 'app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source")';
const row = path => popup + ` [${attribute}=${q(path)}]`;
const bytes = text => Buffer.from("\ufeff" + text);
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) { for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers }); }
const navigation = 'JSON.stringify({index:app.workspace.activeLeaf.historyIndex,entries:app.workspace.activeLeaf.history.map(entry=>({type:entry.type,file:entry.state?.file}))})';

/** Actual Source/Live Preview action; the parent owns host launch, build identity and final error/shutdown audit. */
export async function checkUnresolvedHeadingCompletion(tools) {
  const { directory, evaluate, wait, command, click, capture, afterReload, restart, report } = tools;
  const folder = "Unresolved heading links", target = folder + "/Targets/Existing.md", alias = "Wave13 heading alias", other = folder + "/Other.md";
  const lookup = target.slice(0, -3);
  const original = "# Source authoring Ω\r\n\r\nRetain 😀 surrounding prose.\r\n\r\nLinks: \r\n";
  const targetText = "---\r\naliases: [Wave13 heading alias]\r\n---\r\n# Existing heading\r\n\r\nKept target bytes λ 😀.\r\n\r\n# Parent λ\r\n## Actual child\r\n";
  const otherText = "# Other\r\n\r\nThis note is never edited.\r\n", configPath = join(directory, ".obsidian", "app.json");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), configBytes = await readFile(configPath), imported = JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, ""));
  const paths = [target, other, folder + "/source.md", folder + "/live-preview.md"];
  let stage = "fixture setup", mode = null;
  await mkdir(join(directory, folder, "Targets"), { recursive: true });
  await writeFile(join(directory, target), bytes(targetText), { flag: "wx" }); await writeFile(join(directory, other), bytes(otherText), { flag: "wx" });
  for (const path of paths.slice(2)) await writeFile(join(directory, path), bytes(original), { flag: "wx" });
  const refresh = () => evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  const exactTargets = async () => { assert.deepEqual(await readFile(join(directory, target)), bytes(targetText)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText)); };
  const escape = async () => { await key(command, "Escape", "Escape", 27); await wait(`!document.querySelector(${q(popup)})`, "dismissed completion action"); };
  const configure = async format => { await writeFile(configPath, bytes(JSON.stringify({ ...imported, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: true }, null, 2).replaceAll("\n", "\r\n") + "\r\n")); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()'); assert.equal(await evaluate('app.vault.getConfig("newLinkFormat")'), format); assert.equal(await evaluate('app.vault.getConfig("useMarkdownLinks")'), true); };
  const open = async path => { await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.focus()})()`); await command("Page.bringToFront"); };
  const reset = async () => { await escape(); await evaluate(`(()=>{app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(original)},"input.unresolved-heading-fixture");app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()})()`); await evaluate("app.saveAll()"); };
  const type = async (input, targetPath) => { await reset(); await command("Input.insertText", { text: input }); if (input.endsWith("]]")) { await key(command, "ArrowLeft", "ArrowLeft", 37); await key(command, "ArrowLeft", "ArrowLeft", 37); } await wait(`Boolean(document.querySelector(${q(row(targetPath))})?.checkVisibility())`, "explicit known-file missing-heading link choice"); return original.replace(/\r\n$/, input + "\r\n"); };
  const hold = async input => {
    const text = await type(input, target);
    await evaluate(`(()=>{const p=${provider},element=document.querySelector(${q(row(target))}),choice=p.getSuggestions(p.context).find(value=>value.kind==="unresolved-heading"&&value.path===${q(target)});if(!choice||!element)throw Error("Missing held unresolved heading choice");globalThis.unresolvedHeadingHeld={provider:p,element,choice};return true})()`);
    return text;
  };
  const held = () => evaluate("(async()=>{const held=globalThis.unresolvedHeadingHeld;if(!held?.choice)throw Error('Missing held heading choice');await held.provider.selectSuggestion(held.choice);held.element.click();delete globalThis.unresolvedHeadingHeld})()");
  try {
    await configure("shortest"); await refresh(); await wait(`app.metadataCache.getCache(${q(target)})?.frontmatter?.aliases?.includes(${q(alias)})`, "known heading target and alias indexed");
    const inventory = await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()");
    await evaluate(`(()=>{const trace=globalThis.unresolvedHeadingTrace={events:[],abort:new AbortController()};const record=(type,event,element)=>{if(element)trace.events.push({type,trusted:event.isTrusted,path:element.getAttribute(${q(attribute)}),title:element.querySelector(".suggestion-title")?.textContent??"",file:app.workspace.getActiveFile()?.path??null})};document.addEventListener("click",event=>record("pointer",event,event.target.closest?.(${q("[" + attribute + "]")})),{capture:true,signal:trace.abort.signal});window.addEventListener("keydown",event=>{const editor=app.workspace.activeEditor?.editor;if(event.key==="Enter"&&event.target instanceof Node&&editor?.cm.dom.contains(event.target))record("Enter",event,document.querySelector(${q(popup + " [" + attribute + "][aria-selected=true]")}))},{capture:true,signal:trace.abort.signal});return true})()`);
    let finalPath, finalText;
    for (mode of ["source", "live-preview"]) {
      const path = folder + "/" + mode + ".md"; stage = mode + " trusted acceptance"; await open(path);
      for (const [name, input, subpath, current, format, gesture] of [
        ["known file", "[[" + lookup + "#Future section λ", "Future section λ", false, "shortest", "Enter"],
        ["hierarchy", "[[" + target.slice(0, -3) + "#Parent λ#Future nested 😀]]", "Parent λ#Future nested 😀", false, "relative", "pointer"],
        ["current note", "[[#Unwritten current destination λ", "Unwritten current destination λ", true, "absolute", "Enter"],
      ]) {
        await configure(format); const targetPath = current ? path : target, typed = await type(input, targetPath), history = await evaluate(navigation);
        assert.deepEqual(await evaluate(`(()=>{const element=document.querySelector(${q(row(targetPath))});return{title:element.querySelector(".suggestion-title")?.textContent,path:element.getAttribute(${q(attribute)}),create:element.hasAttribute("data-builtin-create-note")}})()`), { title: "Link to missing heading: " + subpath, path: targetPath, create: false });
        const linktext = current ? "" : await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`), token = "[[" + linktext + "#" + subpath + "]]", completed = original.replace(/\r\n$/, token + "\r\n");
        if (name === "known file") await capture?.(mode === "source" ? "unresolved-heading-popup" : "unresolved-heading-live-preview");
        if (gesture === "Enter") await key(command, "Enter", "Enter", 13); else await click(row(targetPath));
        await wait(`app.editor.getValue()===${q(completed)}`, "missing-heading action inserts only the reviewed source link");
        assert.equal(await evaluate(`unresolvedHeadingTrace.events.some(event=>event.trusted&&event.type===${q(gesture)}&&event.path===${q(targetPath)}&&event.file===${q(path)}&&event.title===${q("Link to missing heading: " + subpath)})`), true);
        assert.equal(await evaluate(navigation), history); assert.equal(await evaluate("app.workspace.getActiveFile().path"), path); await exactTargets();
        await evaluate("app.editor.focus()"); await key(command, "z", "KeyZ", 90, 2); await wait(`app.editor.getValue()===${q(typed)}`, "trusted Undo retains the original query and every target byte"); await exactTargets();
        await key(command, "y", "KeyY", 89, 2); await wait(`app.editor.getValue()===${q(completed)}`, "trusted Redo restores only source insertion");
        await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(completed)); assert.deepEqual(await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()"), inventory);
        finalPath = path; finalText = completed;
      }
      pass(report, `${mode}: real Enter and pointer missing-heading link choices use an existing known-file/current-note/hierarchical target, canonical fresh path preferences and isolated trusted Undo/Redo; target bytes, source BOM/CRLF/Unicode, navigation and inventory remain exact without creating headings or notes.`);

      stage = mode + " current source and target refusal";
      let typed = await hold("[[" + lookup + "#Future stale section λ"); await command("Input.insertText", { text: "x" }); const newer = typed.replace("Future stale section λ", "Future stale section λx");
      await held(); assert.equal(await evaluate("app.editor.getValue()"), newer); await exactTargets();
      typed = await hold("[[" + lookup + "#Future stale section λ");
      const changed = targetText.replace("Kept target bytes", "New target bytes"); await writeFile(join(directory, target), bytes(changed)); await refresh(); await wait(`app.metadataCache.getDocument(${q(target)})?.text===${q(changed)}`, "a body-only target edit is actually indexed");
      await held(); assert.equal(await evaluate("app.editor.getValue()"), typed); assert.deepEqual(await readFile(join(directory, target)), bytes(changed)); await writeFile(join(directory, target), bytes(targetText)); await refresh();
      typed = await hold("[[" + lookup + "#Future stale section λ");
      const appeared = targetText + "\r\n# Future stale section λ\r\n"; await writeFile(join(directory, target), bytes(appeared)); await refresh();
      await wait(`app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Future stale section λ")`, "the formerly absent heading actually appears");
      await held(); assert.equal(await evaluate("app.editor.getValue()"), typed); assert.deepEqual(await readFile(join(directory, target)), bytes(appeared)); await writeFile(join(directory, target), bytes(targetText)); await refresh();
      typed = await hold("[[" + lookup + "#Future stale section λ"); await unlink(join(directory, target)); await refresh(); await wait(`!app.vault.getFileByPath(${q(target)})`, "target deletion observed before same-byte recreation");
      await writeFile(join(directory, target), bytes(targetText), { flag: "wx" }); await refresh(); await wait(`Boolean(app.vault.getFileByPath(${q(target)}))&&app.metadataCache.getCache(${q(target)})?.frontmatter?.aliases?.includes(${q(alias)})`, "same-byte target is indexed with fresh file identity");
      assert.equal(await evaluate(`app.vault.getFileByPath(${q(target)})!==unresolvedHeadingHeld.choice.target`), true); await held(); assert.equal(await evaluate("app.editor.getValue()"), typed); await exactTargets();
      await reset(); await command("Input.insertText", { text: "[[" + lookup + "#Existing heading" }); await wait(`Boolean(document.querySelector(${q(popup + ' [data-builtin-heading="Existing heading"]')}))`, "a known heading still has its original existing-target choice"); assert.equal(await evaluate(`Boolean(document.querySelector(${q(popup + " [" + attribute + "]")}))`), false);
      for (const input of ["[[" + lookup + "#^not-an-id", "[[##No global heading", "[[" + lookup + "#Future|alias", "[[" + lookup + "#", "[[Missing target#Future section λ"]) { await reset(); await command("Input.insertText", { text: input }); assert.equal(await evaluate(`Boolean(document.querySelector(${q(popup + " [" + attribute + "]")}))`), false, input); }
      assert.deepEqual(await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()"), inventory); await exactTargets();
      pass(report, `${mode}: held missing-heading choices refuse newer source, body-only target edits, a newly appeared heading and same-byte delete/recreate. Existing headings retain priority; unsafe, empty, block/global and missing-note prefixes expose no missing-heading action and create no files.`);
      await reset(); await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(finalText)},"input.unresolved-heading-fixture")`); await evaluate("app.saveAll()");
    }
    report.unresolvedHeadingTrusted = await evaluate("globalThis.unresolvedHeadingTrace.events");
    stage = "full restart"; await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(finalPath)}&&app.editor.getValue()===${q(finalText)}`, "missing-heading link survives full restart/reconnection"); await exactTargets();
    assert.deepEqual(await readFile(join(directory, finalPath)), bytes(finalText)); await capture?.("unresolved-heading-restored");
    await reset(); await command("Input.insertText", { text: "[[" + lookup + "#Fresh restart destination λ" }); await wait(`Boolean(document.querySelector(${q(row(target))})?.checkVisibility())`, "fresh missing-heading action works after restart"); await escape();
    report.unresolvedHeadings = { sourceAndLivePreview: true, existingTargetOnly: true, explicitMissingLabel: true, knownHeadingPriority: true, hierarchicalMissingLinks: true, currentNoteLinks: true, knownFileCanonicalPaths: true, freshLinkPreferences: true, trustedPointerAndEnter: true, isolatedUndoRedo: true, exactSourceBytes: true, noNavigation: true, noTargetWritesOrCreates: true, staleSourceRefusal: true, staleTargetTextRefusal: true, appearedHeadingRefusal: true, deleteRecreateRefusal: true, unsafeRefusal: true, restart: true };
    pass(report, "Full native restart/browser reconnection retains exact saved missing-heading links without materializing target headings; original target/other-note bytes stay intact and a fresh popup remains usable afterward.");
  } catch (error) {
    try { report.unresolvedHeadingFailure = { stage, mode, ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,source:app.editor?.getValue(),mode:app.workspace.activeLeaf.view.getEditingMode?.(),cursor:app.editor?.getCursor(),trigger:(${provider}).onTrigger(app.editor.getCursor(),app.editor,app.workspace.getActiveFile()),target:{path:${q(target)},exists:!!app.vault.getFileByPath(${q(target)}),indexedText:app.metadataCache.getDocument(${q(target)})?.text??null,headings:(app.metadataCache.getCache(${q(target)})?.headings??[]).map(value=>({heading:value.heading,level:value.level,from:value.position.start.offset,to:value.position.end.offset}))},choices:[...document.querySelectorAll(${q(popup + " .suggestion-item")})].map(element=>({text:element.textContent,path:element.getAttribute(${q(attribute)})}))}))()`) }; await capture?.("unresolved-heading-precleanup-failure"); } catch { /* Keep the original failure. */ }
    throw error;
  } finally {
    await evaluate("(()=>{globalThis.unresolvedHeadingTrace?.abort.abort();delete globalThis.unresolvedHeadingTrace;delete globalThis.unresolvedHeadingHeld})()");
    await escape(); await writeFile(join(directory, target), bytes(targetText));
    for (const path of paths.slice(2)) await evaluate(`(async()=>{await app.openFile(${q(path)});app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(original)},"input.unresolved-heading-cleanup");await app.saveAll()})()`);
    await writeFile(configPath, configBytes); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`); assert.deepEqual(await readFile(configPath), configBytes);
  }
}

/** Genuine cached fixture has an eligible source line and a known target; parent audits every cache blob and zero network. */
export async function checkUnresolvedHeadingCompletionReadOnly({ evaluate, wait, command, capture, report }) {
  assert.equal(await evaluate("app.vault.readOnly"), true); const before = await evaluate("app.editor.getValue()"), inventory = await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()");
  const location = await evaluate(`(()=>{const lines=app.editor.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value==="[[Known target#Future cached heading");if(line<0)throw Error("Missing eligible cached heading prefix");return{line,ch:lines[line].length}})()`);
  const targetProof = await evaluate('(()=>{const file=app.vault.getFileByPath("Known target.md"),indexed=app.metadataCache.getDocument("Known target.md"),headings=app.metadataCache.getCache("Known target.md")?.headings;return{known:Boolean(file&&indexed&&!indexed.missing&&typeof indexed.text==="string"),missing:Array.isArray(headings)&&!headings.some(value=>value.heading==="Future cached heading")}})()');
  assert.deepEqual(targetProof, { known: true, missing: true });
  for (const mode of ["source", "live-preview"]) {
    await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.setCursor(${location.line},${location.ch});app.editor.focus()})()`);
    const proof = await evaluate(`(()=>{const p=${provider},editor=app.editor,file=app.workspace.getActiveFile(),cursor=editor.getCursor();return{trigger:p.onTrigger(cursor,editor,file),choices:p.getSuggestions({editor,file,start:cursor,end:cursor,query:"Future cached heading"}).length,target:!!app.vault.getFileByPath("Known target.md")}})()`);
    assert.deepEqual(proof, { trigger: null, choices: 0, target: true }); await command("Input.insertText", { text: "x" }); await key(command, "Enter", "Enter", 13);
    await wait(`!document.querySelector(${q(popup)})`, "readonly missing-heading completion remains closed"); assert.equal(await evaluate("app.editor.getValue()"), before); assert.deepEqual(await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()"), inventory);
  }
  await capture?.("unresolved-heading-readonly"); report.unresolvedHeadings = { ...(report.unresolvedHeadings ?? {}), readOnlyEligibleTarget: true, readOnlySourceAndLivePreview: true, readOnlyDirectEnumeration: true, readOnlyTrustedInputRefusal: true, readOnlyExactSourceAndInventory: true };
  pass(report, "A genuine cache-only read-only vault has a real known target and eligible missing-heading prefix, but Source/Live Preview triggering, direct enumeration and actual typing/Enter refuse every source or inventory change while the parent audits exact cached bytes and zero API/raw requests.");
}
