import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkPropertiesCompletion, checkPropertiesCompletionReadOnly } from "./properties-completion-scenarios.mjs";

const q = JSON.stringify;
const inline = '[data-properties-link-root="inline"]', pane = '[data-properties-link-root="pane"]';
const input = (root, key) => root + ` [data-property-key=${q(key)}] [data-metadata-input]`;
const choice = (root, key, value) => root + ` [data-property-key=${q(key)}] [data-property-value-choice=${q(value)}]`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function fill(tools, selector, value) {
  await tools.click(selector); await tools.press("a", "KeyA", 65, 2);
  if (value) await tools.command("Input.insertText", { text: value }); else await tools.press("Backspace", "Backspace", 8);
}
async function offer(tools, root, key, query, value) {
  await fill(tools, input(root, key), query);
  await tools.wait(`(()=>{const row=document.querySelector(${q(choice(root, key, value))});return !!row&&!row.closest("[hidden]")&&row.checkVisibility()})()`, "visible known-note Properties link choice");
}
async function cancel(tools, root = inline, key = "status") {
  await tools.click(input(root, key)); await tools.press("Escape", "Escape", 27); await tools.press("Escape", "Escape", 27);
}
async function saved(tools, path, expected) {
  await tools.wait(`app.workspace.sessions.get(${q(path)})?.text===${q(expected)}&&!app.workspace.sessions.get(${q(path)})?.dirty`, "exact guarded Properties link text saved");
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + expected));
}
async function ready(tools, root, key, expected) {
  await tools.wait(`(()=>{const field=document.querySelector(${q(input(root, key))}),expected=${q(expected ?? null)};return !!field&&!field.readOnly&&!field.closest("[aria-busy=true]")&&(expected===null||field.value===expected)})()`, "accepted Properties link field lifecycle finished");
}
async function refresh(tools) {
  await tools.evaluate('(()=>{document.activeElement?.blur?.();app.workspace.activeLeaf.view.metadataEditor?.render(true)})()');
  await tools.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
}
async function stale(tools, root = inline, key = "status") {
  await tools.wait(`document.querySelector(${q(root + ` [data-property-key=${q(key)}] .metadata-property-error`)})?.textContent.includes("suggestion changed")`, "held Properties link refused changed target before mutation");
}

/** Real MetadataEditor link choices; first renew the existing completed-row/adjacent-focus race fixtures. */
export async function checkPropertiesLinks(tools) {
  await checkPropertiesCompletion(tools);
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const folder = "Properties links", path = folder + "/Notes/Source.md", target = folder + "/Targets/Known link λ.md";
  const original = '---\r\n# Keep source comment\r\nstatus: Open # keep status comment\r\nlabels: [ kept ]\r\ntags: [ shared ]\r\naliases: [ Existing ]\r\ncount: 1.50\r\nnested: { retain: opaque }\r\n---\r\n# Properties links λ\r\n\r\nUntouched 😀 body.\r\n';
  const known = '---\r\naliases: ["Friendly link λ"]\r\nstatus: "Completed link"\r\n---\r\n# Existing heading\r\n\r\nKnown body.\r\n';
  const token = "[[Known link λ]]", aliasToken = "[[Known link λ|Friendly link λ]]";
  const scalarText = value => original.replace("status: Open #", "status: " + JSON.stringify(value) + " #");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const appPath = join(directory, ".obsidian", "app.json"), appBytes = await readFile(appPath), appOptions = JSON.parse(appBytes.toString("utf8").replace(/^\ufeff/, ""));
  if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  for (const sub of ["Notes", "Targets", "A", "B"]) await mkdir(join(directory, folder, sub), { recursive: true });
  await writeFile(join(directory, path), Buffer.from("\ufeff" + original), { flag: "wx" });
  await writeFile(join(directory, target), Buffer.from("\ufeff" + known), { flag: "wx" });
  for (const sub of ["A", "B"]) await writeFile(join(directory, folder, sub, "Twin.md"), "# Existing twin\n", { flag: "wx" });
  const preferences = async format => {
    await writeFile(appPath, JSON.stringify({ ...appOptions, newLinkFormat: format, useMarkdownLinks: true }, null, 2));
    await evaluate('app.configuration.read("app")');
    assert.equal(await evaluate('app.vault.getConfig("newLinkFormat")'), format);
  };
  const open = mode => evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${q(path)});const view=app.workspace.activeLeaf.view;view.setEditingMode("live-preview");if(${q(mode)}==="preview")view.setMode("preview");view.metadataEditor.contentEl.dataset.propertiesLinkRoot="inline"})()`);
  const undo = async expected => {
    await evaluate("app.editor.undo();app.saveAll()"); await saved(tools, path, expected); await refresh(tools);
  };
  try {
    await preferences("shortest");
    for (const mode of ["preview", "live-preview"]) {
      await open(mode); await offer(tools, inline, "status", "[[Known link", token);
      assert.equal(await evaluate("app.editor.getValue()"), original, "typing a wiki prefix does not save it");
      const context = await evaluate(`(()=>{const row=document.querySelector(${q(choice(inline, "status", token))});return{path:row.dataset.propertyLinkTarget,title:row.title,text:row.textContent,html:!!row.querySelector("img,script")}})()`);
      assert.equal(context.path, target); assert.ok(context.title.includes(target)); assert.ok(context.text.includes(target)); assert.equal(context.html, false);
      await capture?.("properties-links-" + mode); await click(choice(inline, "status", token)); await saved(tools, path, scalarText(token)); await ready(tools, inline, "status", token);
      // Choosing the same note again is a no-op in YAML/history, but still has
      // to consume the accepted [[ draft before the field next loses focus.
      await offer(tools, inline, "status", "[[Known link", token); await click(choice(inline, "status", token)); await ready(tools, inline, "status", token);
      await evaluate(`document.querySelector(${q(input(inline, "status"))}).blur()`); await evaluate("app.core.whenIdle()"); await saved(tools, path, scalarText(token));
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
      await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), scalarText(token));
      await undo(original); await saved(tools, path, original);
      pass(report, `${mode}: real Properties pointer [[ choices replace the complete scalar, identify their target as plain text, safely quote YAML, retain comments/opaque values/1.50/BOM/CRLF/body, and isolate exact Undo/Redo from the typed prefix.`);
    }

    await offer(tools, inline, "labels", "[[Friendly", aliasToken); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
    const listText = original.replace("labels: [ kept ]", 'labels: [ kept, "[[Known link λ|Friendly link λ]]" ]');
    await saved(tools, path, listText); await ready(tools, inline, "labels", "");
    await fill(tools, input(inline, "labels"), "[[Friendly");
    assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ' [data-property-key="labels"] [data-property-link-target]')}).length`), 0, "existing link target is omitted across alias spellings");
    await cancel(tools, inline, "labels"); await undo(original);
    await offer(tools, inline, "status", "Com", "Completed link");
    assert.equal(await evaluate(`document.querySelector(${q(choice(inline, "status", "Completed link"))}).hasAttribute("data-property-link-target")`), false); await cancel(tools);
    pass(report, "Real multitext Add fields choose known aliases with Arrow/Enter as one quoted list member, omit an already-linked target, and ordinary same-key string suggestions still use their contributor-backed mode.");

    await evaluate(`(async()=>{const source=app.workspace.activeLeaf,leaf=app.workspace.getLeaf("split");await leaf.setViewState({type:"file-properties",state:{file:${q(path)},followActiveFile:false},active:true});globalThis.propertiesLinkSourceLeaf=source.id;globalThis.propertiesLinkPaneLeaf=leaf.id;leaf.view.metadataEditor.contentEl.dataset.propertiesLinkRoot="pane"})()`);
    await offer(tools, pane, "status", "[[Friendly", aliasToken); await press("ArrowDown", "ArrowDown", 40); await press("Tab", "Tab", 9);
    await saved(tools, path, scalarText(aliasToken)); await ready(tools, pane, "status", aliasToken);
    await evaluate("(()=>{const source=app.workspace.getLeafById(propertiesLinkSourceLeaf);source.view.editor.undo();app.workspace.setActiveLeaf(source,{focus:true});return app.saveAll()})()"); await saved(tools, path, original);
    await evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(propertiesLinkPaneLeaf));delete globalThis.propertiesLinkPaneLeaf;delete globalThis.propertiesLinkSourceLeaf"); await refresh(tools);
    pass(report, "A real fixed file-properties workspace pane uses the same contextual alias choices and Arrow/Tab acceptance, with exact source-editor Undo and no prefix commit.");

    for (const [format, spelling] of [["relative", "../Targets/Known link λ"], ["absolute", folder + "/Targets/Known link λ"]]) {
      await preferences(format); const value = "[[" + spelling + "]]";
      await offer(tools, inline, "status", "[[Known link", value); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
      await saved(tools, path, scalarText(value)); await ready(tools, inline, "status", value); await undo(original);
    }
    await preferences("shortest");
    await fill(tools, input(inline, "status"), "[[Twin");
    const twins = await evaluate(`(()=>{const rows=[...document.querySelectorAll(${q(inline + ' [data-property-key="status"] [data-property-link-target]')})];return rows.map(row=>{const value=row.dataset.propertyValueChoice,link=value.slice(2,-2).split("|",1)[0],dest=app.metadataCache.resolveReference({kind:"frontmatter",link},${q(path)}),target=row.dataset.propertyLinkTarget,note=target.slice(0,-3),names=[note,note.split("/").at(-1),row.dataset.propertyLinkAlias??""];return{path:target,value,literal:names.some(name=>name.toLowerCase().includes("twin")),roundtrip:dest?.file.path===target&&!dest?.ambiguous}})})()`);
    const twinPaths = [folder + "/A/Twin.md", folder + "/B/Twin.md"];
    assert.deepEqual(twins.slice(0, 2).map(row => row.path), twinPaths, "both literal duplicate destinations retain the first two ranks");
    for (const targetPath of twinPaths) {
      const matches = twins.filter(row => row.path === targetPath);
      assert.equal(matches.length, 1, "each literal duplicate destination appears exactly once");
      assert.equal(matches[0].value, "[[" + targetPath.slice(0, -3) + "]]", "duplicate basenames retain their exact disambiguating qualified spelling");
    }
    assert.ok(twins.every(row => row.roundtrip), "every literal or fuzzy row safely roundtrips to its displayed target");
    assert.ok(twins.slice(2).every(row => !row.literal), "only lower-ranked fuzzy extras may follow the two literal duplicate destinations"); await cancel(tools);
    pass(report, "Link choices honor relative/absolute/shortest destination spelling despite the Markdown-link preference when [[ was explicitly typed; both literal duplicate basenames retain the first two ranks and exact disambiguating paths, while every literal or fuzzy row safely roundtrips to its intended file.");

    for (const [key, query] of [["status", "[[No such Properties note"], ["status", "[[Known link#New heading"], ["tags", "[[Known link"], ["aliases", "[[Known link"], ["count", "[[Known link"]]) {
      await fill(tools, input(inline, key), query); assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ` [data-property-key=${q(key)}] [data-property-link-target]`)}).length`), 0); await cancel(tools, inline, key);
    }
    await saved(tools, path, original); assert.equal(await evaluate(`!!app.vault.getFileByPath(${q(folder + "/No such Properties note.md")})`), false);
    await offer(tools, inline, "status", "[[Known link", token); await evaluate(`(()=>{globalThis.propertiesLinkHeld=document.querySelector(${q(choice(inline, "status", token))})})()`);
    await preferences("absolute"); await evaluate("propertiesLinkHeld.click()"); await stale(tools); await saved(tools, path, original); await cancel(tools); await preferences("shortest");
    pass(report, "Unknown notes/headings and tag/alias/numeric controls offer no note-link action, and a held choice refuses changed destination preferences without saving its typed prefix or creating a file/heading/ID.");

    await evaluate(`(async()=>{const source=app.workspace.activeLeaf,peer=app.workspace.createLeafBySplit(source);await peer.openFile(app.vault.getFileByPath(${q(target)}));peer.view.setEditingMode("source");const e=peer.view.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(known.replace("Friendly link λ", "Dirty alias λ"))},"input.properties-link-target");globalThis.propertiesLinkPeer=peer.id;app.workspace.setActiveLeaf(source,{focus:true})})()`);
    const dirtyToken = "[[Known link λ|Dirty alias λ]]"; await offer(tools, inline, "status", "[[Dirty alias", dirtyToken);
    await evaluate(`globalThis.propertiesLinkHeld=document.querySelector(${q(choice(inline, "status", dirtyToken))});(()=>{const e=app.workspace.getLeafById(propertiesLinkPeer).view.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,e.getValue()+"New dirty body\\r\\n","input.properties-link-target-body")})();propertiesLinkHeld.click()`);
    await stale(tools); await saved(tools, path, original); await cancel(tools);
    await evaluate("(async()=>{const leaf=app.workspace.getLeafById(propertiesLinkPeer);leaf.view.editor.undo();leaf.view.editor.undo();await leaf.view.save();app.workspace.closeLeaf(leaf);delete globalThis.propertiesLinkPeer})()");
    await offer(tools, inline, "status", "[[Friendly", aliasToken); await evaluate(`(()=>{globalThis.propertiesLinkHeld=document.querySelector(${q(choice(inline, "status", aliasToken))})})()`);
    await writeFile(join(directory, target), Buffer.from("\ufeff" + known + "Observed external body\r\n")); await evaluate("(async()=>{await app.metadataCache.refresh();propertiesLinkHeld.click()})()");
    await stale(tools); await saved(tools, path, original); await cancel(tools); await writeFile(join(directory, target), Buffer.from("\ufeff" + known)); await evaluate("app.metadataCache.refresh()");
    await offer(tools, inline, "status", "[[Friendly", aliasToken); await evaluate(`(()=>{globalThis.propertiesLinkHeld=document.querySelector(${q(choice(inline, "status", aliasToken))});globalThis.propertiesLinkOldTarget=app.vault.getFileByPath(${q(target)})})()`);
    await unlink(join(directory, target)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await writeFile(join(directory, target), Buffer.from("\ufeff" + known), { flag: "wx" }); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    assert.equal(await evaluate(`propertiesLinkOldTarget===app.vault.getFileByPath(${q(target)})`), false); await evaluate("propertiesLinkHeld.click()"); await stale(tools); await saved(tools, path, original); await cancel(tools);
    pass(report, "Actual dirty target aliases supersede cached YAML. Held choices refuse full dirty/observed-external body changes and delete/recreate with identical bytes but a new file identity.");

    await offer(tools, inline, "status", "[[Friendly", aliasToken);
    await evaluate(`(()=>{const session=app.workspace.sessions.get(${q(path)}),hold={session,previous:session.reload,held:false};session.reload=async function(...args){await hold.previous.apply(this,args);if(!hold.held){hold.held=true;await new Promise(resolve=>{hold.release=resolve})}};globalThis.propertiesLinkReadHold=hold})()`);
    await click(choice(inline, "status", aliasToken)); await wait("propertiesLinkReadHold.held===true", "real Properties link edit paused after asynchronous source reload");
    await writeFile(join(directory, target), Buffer.from("\ufeff" + known + "Changed after first guard\r\n")); await evaluate("(async()=>{await app.metadataCache.refresh();propertiesLinkReadHold.release()})()");
    await stale(tools); await evaluate("propertiesLinkReadHold.session.reload=propertiesLinkReadHold.previous;delete globalThis.propertiesLinkReadHold"); await saved(tools, path, original); await cancel(tools);
    await writeFile(join(directory, target), Buffer.from("\ufeff" + known)); await evaluate("app.metadataCache.refresh()");
    await offer(tools, inline, "status", "[[Friendly", aliasToken);
    await evaluate(`(()=>{const key=app.vault.rootPath+"\\0"+${q(path)},operations=app.fileManager.operations;if(operations.has(key))throw Error("Properties queue is not idle");const hold={key,release:null};operations.set(key,new Promise(resolve=>{hold.release=resolve}));globalThis.propertiesLinkQueueHold=hold})()`);
    await click(choice(inline, "status", aliasToken)); await wait(`document.querySelector(${q(inline + ' [data-property-key="status"]')})?.getAttribute("aria-busy")==="true"`, "link selection waits on the real per-note mutation queue");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");propertiesLinkQueueHold.release()'); await evaluate("app.core.whenIdle()"); await saved(tools, path, original); await evaluate("delete globalThis.propertiesLinkQueueHold");
    pass(report, "The real frontmatter path rechecks target text after its asynchronous save/reload boundary. A second fixture queues an accepted link then closes its owner before the real queue drains; neither stale write changes a source byte.");

    await open("live-preview"); await offer(tools, inline, "status", "[[Friendly", aliasToken);
    const width = await evaluate(`(()=>{const root=document.querySelector(${q(inline)}),old=root.style.getPropertyValue("max-width");root.style.setProperty("max-width","320px");return old})()`);
    try {
      const geometry = await evaluate(`(()=>{const root=document.querySelector(${q(inline)}),list=root.querySelector("[data-property-value-suggestions]:not([hidden])"),box=list.getBoundingClientRect();return{width:root.getBoundingClientRect().width,list:box.width,rows:[...list.children].map(row=>{const rect=row.getBoundingClientRect();return rect.left>=box.left-1&&rect.right<=box.right+1&&rect.height>0&&Boolean(row.dataset.propertyLinkTarget ? !row.dataset.propertyCreateNote&&row.title.includes(row.dataset.propertyLinkTarget) : row.dataset.propertyCreateNote&&!row.hasAttribute("data-property-link-target")&&row.title.includes(row.dataset.propertyCreateNote)&&row.textContent.includes("Create note: "))})}})()`);
      assert.ok(geometry.width <= 321 && geometry.list > 0 && geometry.rows.length && geometry.rows.every(Boolean)); await capture?.("properties-links-narrow");
    } finally { await evaluate(`(()=>{const root=document.querySelector(${q(inline)});if(${q(width)})root.style.setProperty("max-width",${q(width)});else root.style.removeProperty("max-width")})()`); }
    await evaluate(`(()=>{globalThis.propertiesLinkHeld=document.querySelector(${q(choice(inline, "status", aliasToken))})})()`); await cancel(tools); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");propertiesLinkHeld.click()'); await saved(tools, path, original);
    await open("live-preview"); await evaluate("app.workspace.flushLayout()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"&&!app.changingVault`, "Properties link note restored after full restart");
    await evaluate('app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertiesLinkRoot="inline"'); await offer(tools, inline, "status", "[[Friendly", aliasToken); await cancel(tools); await saved(tools, path, original);
    assert.deepEqual(await readFile(join(directory, target)), Buffer.from("\ufeff" + known));
    report.propertiesLinks = { inlineReadingAndLivePreview: true, realWorkspacePane: true, pointerEnterTab: true, scalarAndMultitextWholeValue: true, knownNotesAndAliases: true, destinationPreferencesAndRoundtrip: true, duplicateExclusion: true, sameKeyFallback: true, unknownUnsupportedNoCreate: true, staleDirtyExternalRecreatedTargetRefusal: true, afterAsyncReadRefusal: true, queuedOwnerRefusal: true, sameValueChoiceConsumesPrefix: true, isolatedUndoExactBomCrLf: true, plainTargetContextAndNarrow320: true, detachedChoiceRefusal: true, priorAcceptedRowAndAdjacentFocusRaces: report.propertiesCompletion?.acceptedDraftAfterRapidUndo === true && report.propertiesCompletion?.adjacentChoiceKeepsFocus === true, restart: true };
    pass(report, "Properties known-note/alias choices fit a 320px surface with plaintext path context/tooltips; detached rows stay inert and full native restart/browser reconnection restores fresh choices with exact source/target bytes.");
  } catch (error) {
    try { report.propertiesLinksFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf?.view?.getEditingMode?.(),source:app.workspace.sessions.get(${q(path)})?.text,rows:[...document.querySelectorAll("[data-property-key]")].slice(0,16).map(row=>({key:row.dataset.propertyKey,draft:row.querySelector("input")?.value,error:row.querySelector(".metadata-property-error")?.textContent,choices:[...row.querySelectorAll("[data-property-value-choice]")].map(item=>({value:item.dataset.propertyValueChoice,target:item.dataset.propertyLinkTarget}))})),active:document.activeElement?.outerHTML.slice(0,500)}))()`); await capture?.("properties-links-precleanup-failure"); } catch (diagnostic) { report.propertiesLinksFailure = { diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    await evaluate('(async()=>{const read=globalThis.propertiesLinkReadHold;if(read){read.release?.();read.session.reload=read.previous;delete globalThis.propertiesLinkReadHold}globalThis.propertiesLinkQueueHold?.release?.();await app.core.whenIdle();for(const key of["propertiesLinkHeld","propertiesLinkOldTarget","propertiesLinkQueueHold"])delete globalThis[key]})()');
    await writeFile(appPath, appBytes); await evaluate('app.configuration.read("app")');
    await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();if(app.core.isEnabled("properties")!==${enabled})await app.core.setEnabled("properties",${enabled});await app.markdownAutosave.setEnabled(${autosave})})()`);
  }
}

/** Parent supplies cached Read only.md (status/labels/tags) and Known target.md with aliases. */
export async function checkPropertiesLinksReadOnly(tools) {
  await checkPropertiesCompletionReadOnly(tools);
  const { evaluate, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("live-preview");app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertiesLinkRoot="inline"})()');
  await wait(`Boolean(document.querySelector(${q(input(inline, "status"))}))`, "cached read-only Properties text/list fields");
  const before = await evaluate("app.editor.getValue()");
  for (const key of ["status", "labels", "tags"]) {
    assert.equal(await evaluate(`document.querySelector(${q(input(inline, key))}).disabled`), true);
    await evaluate(`(()=>{const field=document.querySelector(${q(input(inline, key))});field.value="[[Cached alias";field.dispatchEvent(new Event("input",{bubbles:true}));for(const key of["ArrowDown","Enter","Tab"])field.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true}))})()`);
  }
  assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ' [data-property-link-target]')}).length`), 0); assert.equal(await evaluate("app.editor.getValue()"), before);
  await capture?.("properties-links-readonly"); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.equal(await evaluate("app.editor.getValue()"), before);
  report.propertiesLinks = { ...(report.propertiesLinks ?? {}), cachedReadOnlyDisabled: true, cachedReadOnlyNoChoicesOrMutation: true };
  pass(report, "A genuine cached read-only vault keeps Properties text/list/tag controls disabled; forced [[ alias input and keyboard attempts expose no link choices or note mutation while the parent audits all cached blobs and zero requests.");
}
