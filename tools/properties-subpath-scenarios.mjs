import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkPropertiesLinks, checkPropertiesLinksReadOnly } from "./properties-link-scenarios.mjs";

const q = JSON.stringify, inline = '[data-properties-subpath-root="inline"]', pane = '[data-properties-subpath-root="pane"]';
const input = (root, key) => root + ` [data-property-key=${q(key)}] [data-metadata-input]`;
const row = (root, key, value) => root + ` [data-property-key=${q(key)}] [data-property-value-choice=${q(value)}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function fill(tools, root, key, text) {
  await tools.click(input(root, key)); await tools.press("a", "KeyA", 65, 2); await tools.command("Input.insertText", { text });
}
async function offer(tools, root, key, query, value) {
  await fill(tools, root, key, query);
  await tools.wait(`(()=>{const item=document.querySelector(${q(row(root, key, value))});return !!item&&item.checkVisibility()&&!item.closest("[hidden]")})()`, "existing Properties heading/block choice");
}
async function cancel(tools, root = inline, key = "status") {
  await tools.click(input(root, key)); await tools.press("Escape", "Escape", 27); await tools.press("Escape", "Escape", 27);
}
async function ready(tools, root, key, value) {
  await tools.wait(`(()=>{const field=document.querySelector(${q(input(root, key))});return !!field&&!field.readOnly&&!field.closest("[aria-busy=true]")&&field.value===${q(value)}})()`, "Properties subpath accepted draft consumed");
}
async function saved(tools, path, text) {
  await tools.wait(`app.workspace.sessions.get(${q(path)})?.text===${q(text)}&&!app.workspace.sessions.get(${q(path)})?.dirty`, "exact Properties subpath source saved");
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}
async function refresh(tools) {
  await tools.evaluate('(()=>{document.activeElement?.blur?.();app.workspace.activeLeaf.view.metadataEditor?.render(true)})()');
  await tools.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
}
async function stale(tools) {
  await tools.wait(`document.querySelector(${q(inline + ' [data-property-key="status"] .metadata-property-error')})?.textContent.includes("suggestion changed")`, "retained Properties subpath refuses changed destination");
}

/** Actual Properties section choices, renewing all wave7 link/renderer-race coverage first. */
export async function checkPropertiesSubpaths(tools) {
  await checkPropertiesLinks(tools);
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const folder = "Properties subpaths", path = folder + "/Notes/Source.md", target = folder + "/Targets/Subpath target.md";
  const original = '---\r\n# Keep source comment\r\nstatus: Open # keep status comment\r\nlabels: [ kept ]\r\ntags: [ shared ]\r\naliases: [ Existing ]\r\ncount: 1.50\r\nnested: { retain: opaque }\r\n---\r\n# Local heading Ω\r\n\r\nUntouched 😀 local paragraph. ^local-block\r\n';
  const known = '---\r\naliases: ["Subpath alias"]\r\n---\r\n# Parent λ\r\n\r\n## Child Ω\r\n\r\nKnown paragraph **kept**. ^known-block\r\n\r\n# Sibling\r\n\r\n## Child Ω\r\n\r\nOther paragraph. ^other-block\r\n';
  const heading = "[[Subpath target#Parent λ]]", block = "[[Subpath target#^known-block]]", otherBlock = "[[Subpath target#^other-block]]", hierarchy = "[[Subpath target#Parent λ#Child Ω]]";
  const scalar = value => original.replace("status: Open #", "status: " + JSON.stringify(value) + " #");
  const list = values => original.replace("labels: [ kept ]", "labels: [ kept, " + values.map(value => JSON.stringify(value)).join(", ") + " ]");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const appPath = join(directory, ".obsidian", "app.json"), appBytes = await readFile(appPath), appOptions = JSON.parse(appBytes.toString("utf8").replace(/^\ufeff/, ""));
  if (!enabled) await evaluate('app.core.setEnabled("properties",true)'); if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  for (const child of ["Notes", "Targets"]) await mkdir(join(directory, folder, child), { recursive: true });
  await writeFile(join(directory, path), Buffer.from("\ufeff" + original), { flag: "wx" }); await writeFile(join(directory, target), Buffer.from("\ufeff" + known), { flag: "wx" });
  const preferences = async format => { await writeFile(appPath, JSON.stringify({ ...appOptions, newLinkFormat: format, useMarkdownLinks: true }, null, 2)); await evaluate('app.configuration.read("app")'); };
  const open = mode => evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${q(path)});const view=app.workspace.activeLeaf.view;view.setEditingMode("live-preview");if(${q(mode)}==="preview")view.setMode("preview");view.metadataEditor.contentEl.dataset.propertiesSubpathRoot="inline"})()`);
  const undo = async expected => { await evaluate("app.editor.undo();app.saveAll()"); await saved(tools, path, expected); await refresh(tools); };
  try {
    await preferences("shortest");
    for (const mode of ["preview", "live-preview"]) {
      await open(mode); await offer(tools, inline, "status", "[[Subpath target#Pa", heading);
      assert.equal(await evaluate("app.editor.getValue()"), original);
      const context = await evaluate(`(()=>{const item=document.querySelector(${q(row(inline, "status", heading))});return{kind:item.dataset.propertySubpathKind,subpath:item.dataset.propertySubpath,path:item.dataset.propertyLinkTarget,text:item.textContent,title:item.title}})()`);
      assert.equal(context.kind, "heading"); assert.equal(context.subpath, "#Parent λ"); assert.equal(context.path, target); assert.ok(context.text.includes(target + "#Parent λ") && context.title.includes(target));
      await capture?.("properties-subpaths-" + mode); await click(row(inline, "status", heading)); await saved(tools, path, scalar(heading)); await ready(tools, inline, "status", heading);
      await offer(tools, inline, "status", "[[Subpath target#Pa", heading); await click(row(inline, "status", heading)); await ready(tools, inline, "status", heading);
      await evaluate(`document.querySelector(${q(input(inline, "status"))}).blur()`); await evaluate("app.core.whenIdle()"); await saved(tools, path, scalar(heading));
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original); await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), scalar(heading)); await undo(original);
      await offer(tools, inline, "labels", "[[Subpath target#^known", block); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13); await saved(tools, path, list([block])); await ready(tools, inline, "labels", "");
      await fill(tools, inline, "labels", "[[Subpath target#^known"); assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ' [data-property-key="labels"] [data-property-subpath]')}).length`), 0); await cancel(tools, inline, "labels");
      await offer(tools, inline, "labels", "[[Subpath target#^other", otherBlock); await press("ArrowDown", "ArrowDown", 40); await press("Tab", "Tab", 9); await saved(tools, path, list([block, otherBlock])); await ready(tools, inline, "labels", "");
      await undo(list([block])); await undo(original);
      await offer(tools, inline, "status", "[[#Local", "[[#Local heading Ω]]"); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13); await saved(tools, path, scalar("[[#Local heading Ω]]")); await ready(tools, inline, "status", "[[#Local heading Ω]]"); await undo(original);
      await offer(tools, inline, "labels", "[[#^local", "[[#^local-block]]"); await press("ArrowDown", "ArrowDown", 40); await press("Tab", "Tab", 9); await saved(tools, path, list(["[[#^local-block]]"])); await ready(tools, inline, "labels", ""); await undo(original);
      assert.deepEqual(await readFile(join(directory, target)), Buffer.from("\ufeff" + known));
      pass(report, `${mode}: actual Properties pointer and Arrow/Enter/Tab choices insert existing heading/block and explicit current-note whole values; same-value re-selection consumes its prefix without an extra Undo, distinct list sections remain addable while duplicates refuse, and comments/1.50/opaque YAML/BOM/CRLF/body/target bytes stay exact.`);
    }

    await fill(tools, inline, "status", "[[Subpath target#Child"); assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ' [data-property-key="status"] [data-property-subpath="#Child Ω"]')}).length`), 1); await cancel(tools);
    await offer(tools, inline, "status", "[[Subpath target#Parent λ#Ch", hierarchy); await click(row(inline, "status", hierarchy)); await saved(tools, path, scalar(hierarchy)); await ready(tools, inline, "status", hierarchy);
    const reference = await evaluate(`app.metadataCache.getFileCache(app.vault.getFileByPath(${q(path)})).frontmatterLinks.find(link=>link.propertyPath?.[0]==="status")?.link`);
    assert.equal(reference, "Subpath target#Parent λ#Child Ω"); await undo(original);
    await evaluate(`app.workspace.openLinkText(${q(reference)},${q(path)})`); await wait(`app.workspace.getActiveFile()?.path===${q(target)}&&app.editor.getCursor().line===5`, "actual hierarchical link resolver reaches the first Parent/Child heading source line"); await open("live-preview");
    const alias = "[[Subpath target#Parent λ#Child Ω|Subpath alias]]";
    await offer(tools, inline, "status", "[[Subpath alias#Parent λ#Ch", alias); await press("ArrowDown", "ArrowDown", 40); await press("Tab", "Tab", 9); await saved(tools, path, scalar(alias)); await ready(tools, inline, "status", alias); await undo(original);
    for (const [format, spelling] of [["relative", "../Targets/Subpath target"], ["absolute", folder + "/Targets/Subpath target"]]) {
      await preferences(format); const value = "[[" + spelling + "#^known-block]]"; await offer(tools, inline, "status", "[[Subpath target#^known", value); await click(row(inline, "status", value)); await saved(tools, path, scalar(value)); await ready(tools, inline, "status", value); await undo(original);
    }
    await preferences("shortest");
    pass(report, "Existing hierarchical headings roundtrip through actual cached frontmatter references and workspace navigation to their exact Source line, first normalized duplicates stay canonical, exact known aliases retain target proof, and shortest/relative/absolute preferences apply to existing block links with explicit wiki intent.");

    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate(`(async()=>{const source=app.workspace.activeLeaf,leaf=app.workspace.getLeaf("split");await leaf.setViewState({type:"file-properties",state:{file:${q(path)},followActiveFile:false},active:true});globalThis.propertiesSubpathSourceLeaf=source.id;globalThis.propertiesSubpathPaneLeaf=leaf.id;leaf.view.metadataEditor.contentEl.dataset.propertiesSubpathRoot="pane"})()`);
    await offer(tools, pane, "status", "[[Subpath target#^known", block); await capture?.("properties-subpaths-source-pane"); await press("ArrowDown", "ArrowDown", 40); await press("Tab", "Tab", 9); await saved(tools, path, scalar(block)); await ready(tools, pane, "status", block);
    await evaluate("(()=>{const source=app.workspace.getLeafById(propertiesSubpathSourceLeaf);source.view.editor.undo();app.workspace.setActiveLeaf(source,{focus:true});return app.saveAll()})()"); await saved(tools, path, original);
    await evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(propertiesSubpathPaneLeaf));delete globalThis.propertiesSubpathPaneLeaf;delete globalThis.propertiesSubpathSourceLeaf"); await open("live-preview");
    for (const [key, query] of [["status", "[[Subpath target#Missing heading"], ["status", "[[Subpath target#^new-id"], ["status", "[[Missing note#Pa"], ["tags", "[[Subpath target#Pa"], ["aliases", "[[Subpath target#Pa"], ["count", "[[Subpath target#Pa"]]) {
      await fill(tools, inline, key, query); assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ` [data-property-key=${q(key)}] [data-property-subpath]`)}).length`), 0); await cancel(tools, inline, key);
    }
    await saved(tools, path, original); assert.equal(await evaluate(`app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(${q(folder + "/")})).length`), 2);
    pass(report, "An actual fixed file-properties pane accepts an existing block while the real adjacent note remains in Source mode, preserving isolated Source Undo. Unknown headings, IDs, notes and unsupported tag/alias/numeric widgets expose no section action and create no target text or file.");

    await evaluate(`(async()=>{const source=app.workspace.activeLeaf,peer=app.workspace.createLeafBySplit(source);await peer.openFile(app.vault.getFileByPath(${q(target)}));peer.view.setEditingMode("source");const e=peer.view.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(known.replace("Parent λ", "Dirty parent"))},"input.properties-subpath-dirty");globalThis.propertiesSubpathPeer=peer.id;app.workspace.setActiveLeaf(source,{focus:true})})()`);
    const dirty = "[[Subpath target#Dirty parent]]"; await offer(tools, inline, "status", "[[Subpath target#Dirty", dirty);
    await evaluate(`(()=>{globalThis.propertiesSubpathHeld=document.querySelector(${q(row(inline, "status", dirty))});const e=app.workspace.getLeafById(propertiesSubpathPeer).view.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,e.getValue()+"Changed dirty body\\r\\n","input.properties-subpath-body");propertiesSubpathHeld.click()})()`);
    await stale(tools); await saved(tools, path, original); await cancel(tools);
    await evaluate("(async()=>{const peer=app.workspace.getLeafById(propertiesSubpathPeer);peer.view.editor.undo();peer.view.editor.undo();await peer.view.save();app.workspace.closeLeaf(peer);delete globalThis.propertiesSubpathPeer})()");
    for (const [query, token, changed] of [["[[Subpath target#^known", block, known.replace(" ^known-block", "")], ["[[Subpath target#Parent λ#Ch", hierarchy, known.replace("Parent λ", "Changed parent")]]) {
      await offer(tools, inline, "status", query, token); await evaluate(`(()=>{globalThis.propertiesSubpathHeld=document.querySelector(${q(row(inline, "status", token))})})()`);
      await writeFile(join(directory, target), Buffer.from("\ufeff" + changed)); await evaluate("(async()=>{await app.metadataCache.refresh();propertiesSubpathHeld.click()})()"); await stale(tools); await saved(tools, path, original); await cancel(tools);
      await writeFile(join(directory, target), Buffer.from("\ufeff" + known)); await evaluate("app.metadataCache.refresh()");
    }
    await offer(tools, inline, "status", "[[Subpath target#Pa", heading); await evaluate(`(()=>{globalThis.propertiesSubpathHeld=document.querySelector(${q(row(inline, "status", heading))});globalThis.propertiesSubpathOldTarget=app.vault.getFileByPath(${q(target)})})()`);
    await unlink(join(directory, target)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); await writeFile(join(directory, target), Buffer.from("\ufeff" + known), { flag: "wx" }); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    assert.equal(await evaluate(`propertiesSubpathOldTarget===app.vault.getFileByPath(${q(target)})`), false); await evaluate("propertiesSubpathHeld.click()"); await stale(tools); await saved(tools, path, original); await cancel(tools);
    pass(report, "Current dirty headings supersede metadata, and held choices refuse later dirty body edits, physically removed block IDs, changed hierarchy ancestors and delete/recreate at identical bytes with a new target identity before changing the source or saving the prefix.");

    await offer(tools, inline, "status", "[[Subpath target#Pa", heading);
    await evaluate(`(()=>{const session=app.workspace.sessions.get(${q(path)}),hold={session,previous:session.reload,held:false};session.reload=async function(...args){await hold.previous.apply(this,args);if(!hold.held){hold.held=true;await new Promise(resolve=>{hold.release=resolve})}};globalThis.propertiesSubpathReadHold=hold})()`);
    await click(row(inline, "status", heading)); await wait("propertiesSubpathReadHold.held===true", "real Properties section write paused after source reload");
    await writeFile(join(directory, target), Buffer.from("\ufeff" + known + "Changed after first guard\r\n")); await evaluate("(async()=>{await app.metadataCache.refresh();propertiesSubpathReadHold.release()})()"); await stale(tools);
    await evaluate("propertiesSubpathReadHold.session.reload=propertiesSubpathReadHold.previous;delete globalThis.propertiesSubpathReadHold"); await saved(tools, path, original); await cancel(tools); await writeFile(join(directory, target), Buffer.from("\ufeff" + known)); await evaluate("app.metadataCache.refresh()");
    await offer(tools, inline, "status", "[[Subpath target#^known", block);
    await evaluate(`(()=>{const key=app.vault.rootPath+"\\0"+${q(path)},operations=app.fileManager.operations;if(operations.has(key))throw Error("Properties queue is not idle");const hold={release:null};operations.set(key,new Promise(resolve=>{hold.release=resolve}));globalThis.propertiesSubpathQueueHold=hold})()`);
    await click(row(inline, "status", block)); await wait(`document.querySelector(${q(inline + ' [data-property-key="status"]')})?.getAttribute("aria-busy")==="true"`, "accepted section waits in the actual per-note mutation queue");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");propertiesSubpathQueueHold.release()'); await evaluate("app.core.whenIdle()"); await saved(tools, path, original); await evaluate("delete globalThis.propertiesSubpathQueueHold");
    pass(report, "A real asynchronous frontmatter reload rechecks the full destination before applying a section. A separate accepted block waits in the real file-manager queue, loses its Properties owner, then refuses when the queue drains without changing source bytes.");

    await open("live-preview"); await cancel(tools); await offer(tools, inline, "status", "[[Subpath target#Parent λ#Ch", hierarchy);
    const width = await evaluate(`(()=>{const owner=document.querySelector(${q(inline)}),prior=owner.style.getPropertyValue("max-width");owner.style.setProperty("max-width","320px");return prior})()`);
    try {
      const geometry = await evaluate(`(()=>{const owner=document.querySelector(${q(inline)}),list=owner.querySelector("[data-property-value-suggestions]:not([hidden])"),bounds=list.getBoundingClientRect();return{width:owner.getBoundingClientRect().width,list:bounds.width,rows:[...list.children].map(item=>{const r=item.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1&&r.height>0&&item.title.includes(item.dataset.propertyLinkTarget+item.dataset.propertySubpath)})}})()`);
      assert.ok(geometry.width <= 321 && geometry.list > 0 && geometry.rows.length && geometry.rows.every(Boolean)); await capture?.("properties-subpaths-narrow");
    } finally { await evaluate(`(()=>{const owner=document.querySelector(${q(inline)});if(${q(width)})owner.style.setProperty("max-width",${q(width)});else owner.style.removeProperty("max-width")})()`); }
    await evaluate(`(()=>{globalThis.propertiesSubpathHeld=document.querySelector(${q(row(inline, "status", hierarchy))})})()`); await cancel(tools); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");propertiesSubpathHeld.click()'); await saved(tools, path, original);
    await open("live-preview"); await evaluate("app.workspace.flushLayout()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"&&!app.changingVault`, "existing-section Properties note restored after native restart or actual-folder reload");
    await evaluate('app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertiesSubpathRoot="inline"'); await offer(tools, inline, "status", "[[Subpath target#^known", block); await cancel(tools); await saved(tools, path, original); assert.deepEqual(await readFile(join(directory, target)), Buffer.from("\ufeff" + known));
    report.propertiesSubpaths = { inlineReadingAndLivePreview: true, sourceWithRealPropertiesPane: true, pointerEnterTab: true, headingsAndExistingBlocks: true, explicitCurrentNote: true, hierarchicalPositionRoundtrip: true, firstNormalizedDuplicate: true, uniqueKnownAlias: true, destinationPreferences: true, distinctSubpathsAndDuplicateExclusion: true, unknownUnsupportedNoCreate: true, staleDirtyExternalHierarchyRefusal: true, recreatedIdentityRefusal: true, afterAsyncReadRefusal: true, queuedOwnerRefusal: true, sameValueConsumesPrefix: true, exactBomCrLfYamlAndIsolatedUndo: true, narrowPlainContextAndDetachedRows: true, priorLinkAndRendererRaces: report.propertiesLinks?.sameValueChoiceConsumesPrefix === true && report.propertiesLinks?.priorAcceptedRowAndAdjacentFocusRaces === true, restart: true };
    pass(report, "Heading ancestry and block context wrap inside a 320px Properties surface with plaintext tooltips, detached options remain inert, and full native restart/actual-folder browser reconnection restores fresh existing-section choices with exact source and unchanged target bytes.");
  } catch (error) {
    try { report.propertiesSubpathsFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf?.view?.getEditingMode?.(),source:app.workspace.sessions.get(${q(path)})?.text,rows:[...document.querySelectorAll("[data-property-key]")].slice(0,16).map(item=>({key:item.dataset.propertyKey,draft:item.querySelector("input")?.value,error:item.querySelector(".metadata-property-error")?.textContent,choices:[...item.querySelectorAll("[data-property-value-choice]")].map(row=>({value:row.dataset.propertyValueChoice,subpath:row.dataset.propertySubpath}))}))}))()`); await capture?.("properties-subpaths-precleanup-failure"); } catch (diagnostic) { report.propertiesSubpathsFailure = { diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    await evaluate('(async()=>{const hold=globalThis.propertiesSubpathReadHold;if(hold){hold.release?.();hold.session.reload=hold.previous;delete globalThis.propertiesSubpathReadHold}globalThis.propertiesSubpathQueueHold?.release?.();await app.core.whenIdle();for(const key of["propertiesSubpathHeld","propertiesSubpathOldTarget","propertiesSubpathQueueHold"])delete globalThis[key]})()');
    await writeFile(appPath, appBytes); await evaluate('app.configuration.read("app")');
    await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();if(app.core.isEnabled("properties")!==${enabled})await app.core.setEnabled("properties",${enabled});await app.markdownAutosave.setEnabled(${autosave})})()`);
  }
}

/** Parent's cached fixture includes Read only.md and known Existing heading/cached-block target. */
export async function checkPropertiesSubpathsReadOnly(tools) {
  await checkPropertiesLinksReadOnly(tools);
  const { evaluate, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("live-preview");app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertiesSubpathRoot="inline"})()');
  await wait(`Boolean(document.querySelector(${q(input(inline, "status"))}))`, "cached read-only Properties section fields");
  const before = await evaluate("app.editor.getValue()");
  for (const [key, query] of [["status", "[[Known target#Existing"], ["labels", "[[Known target#^cached"], ["tags", "[[#Read only"]]) {
    assert.equal(await evaluate(`document.querySelector(${q(input(inline, key))}).disabled`), true);
    await evaluate(`(()=>{const field=document.querySelector(${q(input(inline, key))});field.value=${q(query)};field.dispatchEvent(new Event("input",{bubbles:true}));for(const key of["ArrowDown","Enter","Tab"])field.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true}))})()`);
  }
  assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ' [data-property-subpath]')}).length`), 0); assert.equal(await evaluate("app.editor.getValue()"), before); await capture?.("properties-subpaths-readonly");
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.equal(await evaluate("app.editor.getValue()"), before);
  report.propertiesSubpaths = { ...(report.propertiesSubpaths ?? {}), genuineCachedReadOnlyDisabled: true, readOnlyNoSectionChoicesOrMutation: true };
  pass(report, "The genuine cached read-only note keeps text/list/tag Properties disabled; forced known-target heading/block and current-note queries cannot expose section choices or change source while the parent audits exact blobs and zero API/raw requests.");
}
