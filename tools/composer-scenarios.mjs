import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkMenuApi, rightClickEditorMenu, rightClickFileMenu } from "./menu-scenarios.mjs";

export async function checkNoteComposer({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const id = "note-composer";
  const folder = "Note composition";
  const source = folder + "/Composer source.md";
  const target = folder + "/Composer target.md";
  const incoming = folder + "/Incoming.md";
  const canvas = folder + "/Links.canvas";
  const selectedTarget = folder + "/New/Composer selection.md";
  const existingTarget = folder + "/Composer existing.md";
  const extraSource = folder + "/Second composer source.md";
  const extraTarget = folder + "/New/Composer created merge.md";
  const concurrentSource = folder + "/Concurrent source.md";
  const concurrentTarget = folder + "/Concurrent target.md";
  const template = folder + "/Templates/Compose.md";
  const dialog = `[data-core-dialog="${id}"]`;
  const control = name => `${dialog} [data-composer-${name}]`;
  const action = name => `${dialog} [data-composer-action="${name}"]`;
  const error = control("error");
  const selectionText = "Selected [Note][ref], ![Image][image] and [^detail].";
  const futureLink = "[Future attachment](./Future.png)";
  let sourceText = [
    "---", "# Source properties", "aliases: [Source alias]", "sourcePrecise: 9007199254740993", "list: [source, shared]", "---",
    "# Composer source", "", "Introduction.", futureLink, "", "## Moved heading", selectionText, "",
    "### Child heading", "A paragraph with a block. ^moved-block", "", "[[#Stay heading]]",
    "", "## Stay heading", "Keep source body.", "[[#Moved heading]]", "",
    '[ref]: Sibling.md "Reference title"', "[image]: Assets/image.png", "[^detail]: A preserved footnote.", "",
  ].join("\r\n");
  const targetBytes = Buffer.from("\ufeff---\r\n# Target properties\r\naliases: [Target alias]\r\ntargetPrecise: 9007199254740995\r\nlist: [target, shared]\r\nunknown: { keep: true }\r\n---\r\n# Composer target\r\n\r\nRetained target text.\r\n");
  const existingBytes = Buffer.from("\ufeff---\r\nprecise: 9007199254740997\r\n---\r\n# Existing destination\r\n\r\nRetained destination.\r\n");
  const incomingBytes = Buffer.from("\ufeff" + [
    "---", 'related: "[[Note composition/Composer source#Moved heading]]"', "precise: 9007199254740999", "---",
    "[[Note composition/Composer source]] [[Note composition/Composer source#Moved heading|Caption]]",
    "[[Note composition/Composer source#^moved-block]] [[Note composition/Composer source#Stay heading]]",
    '[Moved](Composer%20source.md#Moved%20heading "Keep title") `[[Note composition/Composer source]]`',
    "[[Note composition/Second composer source]]", "",
  ].join("\r\n"));
  const board = {
    future: { retain: [true, id] },
    nodes: [
      { id: "whole", type: "file", x: 0, y: 0, width: 200, height: 100, file: source },
      { id: "heading", type: "file", x: 250, y: 0, width: 200, height: 100, file: source, subpath: "#Moved heading", future: true },
      { id: "block", type: "file", x: 500, y: 0, width: 200, height: 100, file: source, subpath: "#^moved-block" },
      { id: "stay", type: "file", x: 0, y: 150, width: 200, height: 100, file: source, subpath: "#Stay heading" },
      { id: "text", type: "text", x: 250, y: 150, width: 200, height: 100, text: "[[Note composition/Composer source#Moved heading]] [[Note composition/Composer source]]" },
    ],
    edges: [],
  };
  const boardBytes = Buffer.from(JSON.stringify(board, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const originalSettings = { replacementText: "link", template: "", askBeforeMerging: true, futureSetting: { retain: [id, 19] } };
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const accept = name => {
    if (!report.coreChecks) { return; }
    assert.ok(!report.coreChecks.some(check => check.id === id + ":" + name), "Duplicate composer observation: " + name);
    report.coreChecks.push({ id: id + ":" + name, status: "passed" });
  };
  const bytes = () => Buffer.from("\ufeff" + sourceText);
  async function absent(path) {
    await assert.rejects(access(join(directory, path)), { code: "ENOENT" });
  }
  async function unchanged(entries) {
    for (const [path, original] of entries) { assert.deepEqual(await readFile(join(directory, path)), original, path + " bytes"); }
  }
  async function reload() {
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }
  async function fill(selector, text) {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    if (text) { await command("Input.insertText", { text }); } else { await press("Backspace", "Backspace", 8); }
  }
  async function coreSettings() {
    await click("#open-settings");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function toggle(enabled) {
    await coreSettings();
    if (await evaluate(`app.core.isEnabled("${id}")`) !== enabled) { await click(`[data-core-toggle="${id}"]`); }
    await wait(`!app.core.busy&&app.core.isEnabled("${id}")===${enabled}`, "Note composer enabled state");
    await click(".settings-close");
  }
  async function settings(replacement, templatePath = "", confirm = true) {
    await coreSettings();
    await click(`[data-core-settings="${id}"]`);
    const selector = '[data-core-field="replacementText"]';
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).tagName`), "SELECT");
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await press("Home", "Home", 36);
    for (let index = 0; index < ["link", "embed", "none"].indexOf(replacement); index++) { await press("ArrowDown", "ArrowDown", 40); }
    await press("Tab", "Tab", 9);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), replacement);
    await fill('[data-core-field="template"]', templatePath);
    if (await evaluate('document.querySelector(\'[data-core-field="askBeforeMerging"]\').checked') !== confirm) { await click('[data-core-field="askBeforeMerging"]'); }
    await click(`[data-core-save="${id}"]`);
    await wait(`!app.core.busy&&app.core.state("${id}").settings.replacementText===${JSON.stringify(replacement)}&&app.core.state("${id}").settings.template===${JSON.stringify(templatePath)}&&app.core.state("${id}").settings.askBeforeMerging===${confirm}`, "real Note composer settings saved");
    await click(".settings-close");
  }
  async function select(text) {
    await evaluate(`(()=>{const text=app.editor.getValue();const from=text.indexOf(${JSON.stringify(text)});if(from<0)throw new Error("Missing composer selection");const position=offset=>{const prefix=text.slice(0,offset).split("\\n");return{line:prefix.length-1,ch:prefix.at(-1).replace(/\\r$/,"").length}};app.editor.setSelection(position(from),position(from+${text.length}));return true})()`);
    assert.equal(await evaluate("app.editor.getSelection()"), text);
  }
  async function open(commandId) {
    const name = await evaluate(`app.commands.listCommands().find(command=>command.id===${JSON.stringify(id + ":" + commandId)})?.name`);
    assert.equal(typeof name, "string");
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker")?.open', "Note composer command palette");
    await command("Input.insertText", { text: name });
    await click(`[data-command-id="${id}:${commandId}"]`);
    await wait(`Boolean(document.querySelector(${JSON.stringify(dialog)}))&&!document.querySelector("#desktop-picker").open`, "actual Note composer dialog");
  }
  async function choose(path, create = false) {
    await fill(control("target"), path);
    await press("Tab", "Tab", 9);
    if (await evaluate(`document.querySelector(${JSON.stringify(control("create"))}).checked`) !== create) { await click(control("create")); }
  }
  async function close() {
    await click(action("cancel"));
    await wait(`!document.querySelector(${JSON.stringify(dialog)})`, "Note composer closed");
    await evaluate("app.core.whenIdle()");
  }
  async function apply(confirm = false) {
    if (confirm) { await click(control("confirm")); }
    await click(action("apply"));
    await wait(`!document.querySelector(${JSON.stringify(dialog)})&&!app.workspace.isChangingFiles`, "Note composition committed");
    await evaluate("app.core.whenIdle()");
  }
  async function failure(message) {
    await wait(`document.querySelector(${JSON.stringify(error)})?.textContent.includes(${JSON.stringify(message)})&&!app.workspace.isChangingFiles`, "visible composer rejection: " + message);
  }

  await mkdir(join(directory, folder, "Templates"), { recursive: true });
  await mkdir(join(directory, folder, "Assets"), { recursive: true });
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, source), bytes());
  await writeFile(join(directory, target), targetBytes);
  await writeFile(join(directory, existingTarget), existingBytes);
  await writeFile(join(directory, incoming), incomingBytes);
  await writeFile(join(directory, canvas), boardBytes);
  await writeFile(join(directory, extraSource), "# Fresh merge\r\n\r\nA second source.\r\n");
  await writeFile(join(directory, concurrentSource), "# Concurrent source\r\n\r\nA separate merge.\r\n");
  await writeFile(join(directory, concurrentTarget), "# Concurrent target\r\n\r\nInitial target.\r\n");
  await writeFile(join(directory, folder, "Sibling.md"), "# A source-relative note\r\n");
  await writeFile(join(directory, folder, "Templates", "Neighbor.md"), "# A template-relative note\r\n");
  await writeFile(join(directory, folder, "Assets", "image.png"), Buffer.from([137, 80, 78, 71, 0, 255]));
  const templateBytes = Buffer.from("---\r\ntemplateMarker: kept\r\n---\r\n# {{newTitle}}\r\nFrom {{fromTitle}}\r\n[Template link](Neighbor.md)\r\n\r\n{{content}}");
  await writeFile(join(directory, template), templateBytes);
  await writeFile(join(directory, ".obsidian", id + ".json"), "\ufeff" + JSON.stringify(originalSettings));
  await reload();
  await toggle(true);
  await settings("link", template);
  assert.match(await evaluate(`app.core.saveSettings("${id}",{replacementText:"invalid"}).then(()=>"unexpected success",error=>error.message)`), /Invalid replacementText/);
  await evaluate(`app.openFile(${JSON.stringify(source)},"tab")`);
  assert.equal(await evaluate("app.commands.status().find(command=>command.id==='note-composer:split-file').enabled"), false);
  await evaluate("app.editor.focus()");
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "Previously unsaved source text." });
  await press("Enter", "Enter", 13);
  sourceText += "Previously unsaved source text.\r\n";
  await select(selectionText);
  await rightClickEditorMenu({ evaluate, command, click, wait });
  assert.equal(await evaluate("app.editor.getSelection()"), selectionText);
  await click('.menu [data-menu-title="Extract current selection"]');
  await wait(`Boolean(document.querySelector(${JSON.stringify(dialog)}))`, "selection extraction from the real editor menu");
  await choose(selectedTarget, true);
  await apply();
  const replacement = sourceText.replace(selectionText, "[[Composer selection]]");
  assert.deepEqual(await readFile(join(directory, source)), Buffer.from("\ufeff" + replacement));
  assert.equal(await evaluate("app.current.file.path"), source);
  assert.equal(await evaluate("app.editor.getValue()"), replacement);
  assert.equal(await evaluate("app.dirty"), false);
  const extracted = await readFile(join(directory, selectedTarget), "utf8");
  assert.match(extracted, /templateMarker: kept/);
  assert.ok(extracted.includes("# Composer selection\r\nFrom Composer source"));
  assert.ok(extracted.includes("[Template link](../Templates/Neighbor.md)"));
  assert.ok(extracted.includes(selectionText));
  assert.ok(extracted.includes('[ref]: ../Sibling.md "Reference title"'));
  assert.ok(extracted.includes("[image]: ../Assets/image.png"));
  assert.ok(extracted.includes("[^detail]: A preserved footnote."));
  assert.ok(!/(?<!\r)\n/.test(extracted));
  await unchanged(new Map([[incoming, incomingBytes], [canvas, boardBytes], [template, templateBytes]]));
  await press("z", "KeyZ", 90, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(sourceText)}&&app.dirty`, "source extraction undo remains in real CodeMirror history");
  await press("y", "KeyY", 89, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(replacement)}&&!app.dirty`, "source extraction redo");
  await press("z", "KeyZ", 90, 2);
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty", "restored source saved");
  assert.deepEqual(await readFile(join(directory, source)), bytes());
  pass("Actual selection extraction saves previously dirty text, creates a real nested target, resolves source/template links independently, carries image/reference/footnote definitions, and retains BOM/CRLF plus real source undo/redo.");

  await select(selectionText);
  await open("split-file");
  const cancelledTarget = folder + "/Cancelled.md";
  await choose(cancelledTarget, true);
  await evaluate(`globalThis.closedComposerApply=document.querySelector(${JSON.stringify(action("apply"))});true`);
  await close();
  await evaluate("closedComposerApply.click();delete globalThis.closedComposerApply;true");
  await absent(cancelledTarget);
  await unchanged(new Map([[source, bytes()], [target, targetBytes], [incoming, incomingBytes], [canvas, boardBytes]]));
  await select(futureLink);
  await open("split-file");
  await choose(cancelledTarget.replace("Cancelled.md", "New/Unsafe.md"), true);
  await click(action("apply"));
  await failure("unresolved link");
  await close();
  await absent(folder + "/New/Unsafe.md");
  await unchanged(new Map([[source, bytes()], [target, targetBytes], [incoming, incomingBytes], [canvas, boardBytes]]));
  await select(selectionText);
  await open("split-file");
  await choose(cancelledTarget, true);
  await evaluate(`app.openFile(${JSON.stringify(target)})`);
  await click(action("apply"));
  await failure("source editor changed");
  await absent(cancelledTarget);
  await close();
  await unchanged(new Map([[source, bytes()], [target, targetBytes], [incoming, incomingBytes], [canvas, boardBytes]]));
  await evaluate(`app.openFile(${JSON.stringify(source)})`);
  await select(selectionText);
  await open("split-file");
  await choose(cancelledTarget, true);
  const newerSource = Buffer.concat([bytes(), Buffer.from("Newer external source.\r\n")]);
  await writeFile(join(directory, source), newerSource);
  await evaluate("app.metadataCache.refresh()");
  await click(action("apply"));
  await failure("source note changed");
  await absent(cancelledTarget);
  assert.deepEqual(await readFile(join(directory, source)), newerSource);
  await close();
  await writeFile(join(directory, source), bytes());
  await evaluate("app.metadataCache.refresh()");
  await wait(`app.editor.getValue()===${JSON.stringify(sourceText)}`, "source restored after external conflict");
  await select(selectionText);
  await open("split-file");
  await choose(cancelledTarget, true);
  await evaluate('app.editor.replaceRange("Concurrent local text.",{line:0,ch:0});true');
  await click(action("apply"));
  await failure("source note changed");
  assert.equal(await evaluate("app.dirty"), true);
  assert.match(await evaluate("app.editor.getValue()"), /^Concurrent local text\./);
  await absent(cancelledTarget);
  assert.deepEqual(await readFile(join(directory, source)), bytes());
  await close();
  await evaluate(`app.editor.setValue(${JSON.stringify(sourceText)});true`);
  await settings("link", "Missing composer template");
  await select(selectionText);
  await open("split-file");
  await choose(cancelledTarget, true);
  await click(action("apply"));
  await failure("template is missing or ambiguous");
  await close();
  await absent(cancelledTarget);
  await unchanged(new Map([[source, bytes()], [target, targetBytes], [incoming, incomingBytes], [canvas, boardBytes]]));
  pass("Cancel and retained closed-dialog controls write nothing; retargeted source views, unresolved relative-link transfers, post-open external/local edits and missing templates reject visibly without losing bytes, creating a target or implicitly saving concurrent local text.");

  await settings("embed");
  await writeFile(join(directory, existingTarget), Buffer.concat([existingBytes, Buffer.from("\r\n## Moved heading\r\nConflicting target heading.\r\n")]));
  await evaluate("app.metadataCache.refresh()");
  const heading = "## Moved heading";
  await select(heading);
  await open("extract-heading");
  await choose(existingTarget);
  await click(action("apply"));
  await failure("missing or ambiguous");
  await close();
  await unchanged(new Map([[source, bytes()], [incoming, incomingBytes], [canvas, boardBytes]]));
  await writeFile(join(directory, existingTarget), existingBytes);
  await evaluate("app.metadataCache.refresh()");
  await select(heading);
  await open("extract-heading");
  await choose(existingTarget);
  await press("Enter", "Enter", 13, 8);
  await wait(`!document.querySelector(${JSON.stringify(dialog)})&&!app.workspace.isChangingFiles`, "Shift+Enter prepended the extracted heading");
  await evaluate("app.core.whenIdle()");
  const sectionFrom = sourceText.indexOf(heading);
  const sectionTo = sourceText.indexOf("\r\n\r\n## Stay heading");
  sourceText = (sourceText.slice(0, sectionFrom) + "![[Composer existing]]" + sourceText.slice(sectionTo)).replace("[[#Moved heading]]", "[[Note composition/Composer existing#Moved heading]]");
  assert.deepEqual(await readFile(join(directory, source)), bytes());
  assert.equal(await evaluate("app.current.file.path"), source);
  const headed = await readFile(join(directory, existingTarget), "utf8");
  assert.ok(headed.startsWith("\ufeff---\r\nprecise: 9007199254740997\r\n---\r\n## Moved heading"));
  assert.ok(headed.indexOf("### Child heading") < headed.indexOf("# Existing destination"));
  assert.ok(headed.includes("[[Note composition/Composer source#Stay heading]]"));
  const redirected = await readFile(join(directory, incoming), "utf8");
  assert.ok(redirected.startsWith("\ufeff---\r\n"));
  assert.ok(redirected.includes("[[Note composition/Composer existing#Moved heading|Caption]]"));
  assert.ok(redirected.includes("[[Note composition/Composer existing#^moved-block]]"));
  assert.ok(redirected.includes("[[Note composition/Composer source]]") && redirected.includes("[[Note composition/Composer source#Stay heading]]"));
  assert.ok(redirected.includes('[Moved](./Composer%20existing.md#Moved%20heading "Keep title")'));
  assert.match(redirected, /precise: 9007199254740999/);
  const redirectedBoard = JSON.parse(await readFile(join(directory, canvas), "utf8"));
  assert.equal(redirectedBoard.nodes[0].file, source);
  assert.equal(redirectedBoard.nodes[1].file, existingTarget);
  assert.equal(redirectedBoard.nodes[2].file, existingTarget);
  assert.equal(redirectedBoard.nodes[3].file, source);
  assert.deepEqual(redirectedBoard.future, board.future);
  await settings("none");
  await select("Keep source body.");
  await open("split-file");
  await choose(selectedTarget);
  await apply();
  sourceText = sourceText.replace("Keep source body.", "");
  assert.deepEqual(await readFile(join(directory, source)), bytes());
  assert.ok((await readFile(join(directory, selectedTarget), "utf8")).endsWith("Keep source body."));
  accept("extract");
  pass("Heading extraction includes children and blocks, rejects duplicate target anchors, supports Shift+Enter prepend and embed/none replacements, and selectively repairs real Markdown/properties/Canvas while whole-note and remaining-section links stay on the source.");

  const beforeMerge = new Map();
  for (const path of [source, target, incoming, canvas, selectedTarget, existingTarget]) { beforeMerge.set(path, await readFile(join(directory, path))); }
  await evaluate('globalThis.composerVetoView=app.workspace.activeLeaf.view;globalThis.composerClose=composerVetoView.onBeforeClose;composerVetoView.onBeforeClose=()=>{throw new Error("Expected composer close veto")};true');
  await open("merge-file");
  await choose(target);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(action("apply"))}).disabled`), true);
  await click(control("confirm"));
  await click(action("apply"));
  await failure("Expected composer close veto");
  assert.equal(await evaluate("app.workspace.activeLeaf.view===composerVetoView&&composerVetoView.isLoaded&&composerVetoView.containerEl.isConnected"), true);
  await unchanged(beforeMerge);
  await close();
  await evaluate("composerVetoView.onBeforeClose=composerClose;delete globalThis.composerVetoView;delete globalThis.composerClose;true");
  await open("merge-file");
  await choose(target);
  await evaluate('(()=>{const original=app.vault.trashFile;app.vault.trashFile=async function(...args){try{globalThis.composerCommitReady=true;await new Promise(resolve=>{globalThis.releaseComposerCommit=resolve});return await original.apply(this,args)}finally{app.vault.trashFile=original}};return true})()');
  await click(control("confirm"));
  await click(action("apply"));
  await wait("globalThis.composerCommitReady", "merge paused after planning and actual source-view preflight");
  const newerTarget = Buffer.concat([targetBytes, Buffer.from("Newer external target.\r\n")]);
  await writeFile(join(directory, target), newerTarget);
  await evaluate("releaseComposerCommit();delete globalThis.releaseComposerCommit;delete globalThis.composerCommitReady;true");
  await failure("changed");
  await unchanged(new Map([...beforeMerge].filter(([path]) => path !== target)));
  assert.deepEqual(await readFile(join(directory, target)), newerTarget);
  assert.equal(await evaluate("app.current.file.path"), source);
  assert.equal(await evaluate("app.editor.getValue()"), sourceText);
  await close();
  await writeFile(join(directory, target), targetBytes);
  await evaluate("app.metadataCache.refresh()");
  pass("Merge confirmation is enforced; a real preflight veto and a target changed after planning retain all source/reference files, newer target bytes and restored source panes.");

  await evaluate('globalThis.composerEvents=[];globalThis.composerEventRefs=["create","modify","delete"].map(type=>app.vault.on(type,file=>composerEvents.push({type,path:file.path})));true');
  await open("merge-file");
  await choose(target);
  if (capture) { await capture(); }
  await apply(true);
  await absent(source);
  assert.deepEqual(await readFile(join(directory, ".trash", "Composer source.md")), bytes());
  assert.equal(await evaluate("app.current.file.path"), target);
  const merged = await readFile(join(directory, target), "utf8");
  assert.ok(merged.startsWith("\ufeff---\r\n"));
  assert.match(merged, /sourcePrecise: 9007199254740993/);
  assert.match(merged, /targetPrecise: 9007199254740995/);
  assert.ok(merged.includes("# Composer target") && merged.includes("# Composer source"));
  assert.ok(merged.includes("Previously unsaved source text."));
  assert.ok(!/(?<!\r)\n/.test(merged));
  assert.deepEqual(await evaluate(`app.metadataCache.getDocument(${JSON.stringify(target)}).cache.frontmatter.aliases`), ["Target alias", "Source alias"]);
  assert.deepEqual(await evaluate(`app.metadataCache.getDocument(${JSON.stringify(target)}).cache.frontmatter.list`), ["target", "shared", "source"]);
  assert.deepEqual(await evaluate(`app.metadataCache.getDocument(${JSON.stringify(target)}).cache.frontmatter.unknown`), { keep: true });
  assert.equal(await evaluate(`composerEvents.filter(event=>event.type==="delete"&&event.path===${JSON.stringify(source)}).length`), 1);
  assert.equal(await evaluate(`composerEvents.filter(event=>event.type==="modify"&&event.path===${JSON.stringify(target)}).length`), 1);
  const mergedIncoming = await readFile(join(directory, incoming), "utf8");
  assert.ok(mergedIncoming.includes("[[Note composition/Composer target]]") && mergedIncoming.includes("[[Note composition/Composer target#Stay heading]]"));
  assert.ok(mergedIncoming.includes("[[Note composition/Composer existing#Moved heading|Caption]]"));
  assert.ok(mergedIncoming.includes("`[[Note composition/Composer source]]`"));
  const mergedBoard = JSON.parse(await readFile(join(directory, canvas), "utf8"));
  assert.equal(mergedBoard.nodes[0].file, target);
  assert.equal(mergedBoard.nodes[3].file, target);
  assert.equal(mergedBoard.nodes[1].file, existingTarget);
  await evaluate("composerEventRefs.forEach(reference=>app.vault.offref(reference));delete globalThis.composerEventRefs;delete globalThis.composerEvents;true");
  await settings("link", "", false);
  assert.equal(await evaluate("app.current.file.path"), target);
  await rightClickFileMenu({ evaluate, command, click, wait }, extraSource);
  await click('.menu [data-menu-title="Merge file with..."]');
  await wait(`document.querySelector(${JSON.stringify(dialog)})?.textContent.includes(${JSON.stringify(extraSource)})`, "merge a non-active file from its actual tree menu");
  await choose(extraTarget);
  await press("Enter", "Enter", 13, 2);
  await wait(`!document.querySelector(${JSON.stringify(dialog)})&&!app.workspace.isChangingFiles`, "Ctrl+Enter created a real merge target");
  await evaluate("app.core.whenIdle()");
  await absent(extraSource);
  assert.equal(await evaluate("app.current.file.path"), extraTarget);
  assert.equal(await readFile(join(directory, extraTarget), "utf8"), "# Fresh merge\r\n\r\nA second source.\r\n");
  assert.ok((await readFile(join(directory, incoming), "utf8")).includes("[[Note composition/New/Composer created merge]]"));
  accept("merge");
  pass("Confirmed merge combines precise YAML/body data with guarded source trash and Markdown/Canvas reference repair, opens its real target and emits one owned modification/deletion; a real file-menu action also merges a non-active note and Ctrl+Enter creates its new nested target.");

  await evaluate(`app.openFile(${JSON.stringify(concurrentTarget)},"tab")`);
  await evaluate(`(()=>{
    const view=app.workspace.activeLeaf.view;
    const ref=app.vault.on("modify",file=>{
      if(file.path!==${JSON.stringify(concurrentTarget)})return;
      app.vault.offref(ref);
      view.editor.replaceRange("Unsaved plugin text after composition.\\r\\n",{line:view.editor.lastLine(),ch:0});
    });return true;
  })()`);
  await rightClickFileMenu({ evaluate, command, click, wait }, concurrentSource);
  await click('.menu [data-menu-title="Merge file with..."]');
  await wait(`Boolean(document.querySelector(${JSON.stringify(dialog)}))`, "concurrent-editor merge dialog");
  await choose(concurrentTarget);
  await click(action("apply"));
  await failure("files were composed, but an open editor changed");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(action("apply"))}).disabled`), true, "A committed operation cannot be applied a second time");
  await absent(concurrentSource);
  const committed = await readFile(join(directory, concurrentTarget), "utf8");
  assert.ok(committed.includes("A separate merge.") && !committed.includes("Unsaved plugin text"));
  assert.equal(await evaluate("app.dirty"), true);
  assert.equal(await evaluate("app.editor.getValue()"), committed + "Unsaved plugin text after composition.\r\n");
  await close();
  await evaluate("app.editor.focus()");
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty", "the retained post-commit editor change saves normally");
  assert.equal(await readFile(join(directory, concurrentTarget), "utf8"), committed + "Unsaved plugin text after composition.\r\n");
  await evaluate(`app.openFile(${JSON.stringify(extraTarget)})`);
  pass("A real modify-event subscriber can edit an open target after commit: Note composer reports the committed-but-unsaved state, retains its text, disables repeat application and permits a normal subsequent save.");

  const saved = new Map();
  for (const path of [target, incoming, canvas, selectedTarget, existingTarget, extraTarget, concurrentTarget, template]) { saved.set(path, await readFile(join(directory, path))); }
  await open("merge-file");
  await choose(target);
  await evaluate(`globalThis.closedComposerApply=document.querySelector(${JSON.stringify(action("apply"))});true`);
  await evaluate(`app.core.setEnabled("${id}",false)`);
  assert.equal(await evaluate(`!document.querySelector(${JSON.stringify(dialog)})&&!app.commands.listCommands().some(command=>command.id.startsWith("${id}:"))&&app.core.getEnabledPluginById("${id}")===null`), true);
  await evaluate("closedComposerApply.click();delete globalThis.closedComposerApply;true");
  await unchanged(saved);
  await toggle(true);
  await reload();
  assert.equal(await evaluate(`app.core.isEnabled("${id}")&&app.commands.listCommands().filter(command=>command.id.startsWith("${id}:")).length===3`), true);
  assert.equal(await evaluate("app.current.file.path"), extraTarget);
  assert.equal(await evaluate(`app.internalPlugins.getEnabledPluginById("${id}").options.askBeforeMerging`), false);
  await unchanged(saved);
  const settingsBytes = await readFile(join(directory, ".obsidian", id + ".json"), "utf8");
  assert.ok(settingsBytes.startsWith("\ufeff"));
  const stored = JSON.parse(settingsBytes.replace(/^\ufeff/, ""));
  assert.deepEqual(stored.futureSetting, originalSettings.futureSetting);
  assert.equal(stored.replacementText, "link");
  assert.equal(stored.template, "");
  assert.equal(stored.askBeforeMerging, false);
  accept("settings");
  pass("Real select/template/confirmation settings preserve unknown BOM-prefixed configuration, disable removes owned commands/dialog/listeners, and desktop restart or real-folder browser reconnect restores both composed files and enabled runtime.");
  report.noteComposer = {
    implementation: "independent guarded merge/selection/heading subset", originalModuleLoaded: false,
    sourceDeletion: "vault trash only after a combined guarded commit", targets: "new and existing Markdown",
    references: "Markdown/property/Canvas whole-file merge or fully moved heading/block extraction",
    unsafeDefinitionsAndAnchors: "explicitly refused", originalRuntimeEquivalence: "not established",
  };
  await checkMenuApi({ directory, evaluate, command, click, press, wait, afterReload, restart, report });
}
