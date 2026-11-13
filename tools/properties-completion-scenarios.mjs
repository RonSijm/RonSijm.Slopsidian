import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const inline = '[data-properties-completion-root="inline"]';
const pane = '[data-properties-completion-root="pane"]';
const input = (root, key) => root + ` [data-property-key=${q(key)}] [data-metadata-input]`;
const choice = (root, key, value) => root + ` [data-property-key=${q(key)}] [data-property-value-choice=${q(value)}]`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
async function fill(tools, selector, value) {
  await tools.click(selector); await tools.press("a", "KeyA", 65, 2);
  if (value) await tools.command("Input.insertText", { text: value }); else await tools.press("Backspace", "Backspace", 8);
}
async function expectChoice(tools, root, key, query, value) {
  await fill(tools, input(root, key), query);
  await tools.wait(`(()=>{const row=document.querySelector(${q(choice(root, key, value))});return !!row&&!row.closest("[hidden]")&&row.checkVisibility()})()`, "visible same-key Properties value choice");
}
async function saved(tools, path, expected) {
  await tools.wait(`app.workspace.sessions.get(${q(path)})?.text===${q(expected)}&&!app.workspace.sessions.get(${q(path)})?.dirty`, "guarded Properties choice saved the expected exact text");
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + expected));
}
async function refreshFields(tools) {
  // A focused Properties draft intentionally keeps its original comparison value
  // across source Undo. Leave that draft before asking for another edit.
  await tools.evaluate('(()=>{document.activeElement?.blur?.();app.workspace.activeLeaf.view.metadataEditor?.render(true)})()');
  await tools.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
}
async function fieldReady(tools, root, key) {
  await tools.wait(`(()=>{const field=document.querySelector(${q(input(root, key))});return !!field&&!field.readOnly&&!field.closest("[aria-busy=true]")})()`, "Properties field finished its accepted UI commit");
}
async function closeDraft(tools, root, key) {
  // First Escape closes a suggestion list, the second restores the original
  // field draft. A real blur must not save the typed test prefix afterward.
  await tools.click(input(root, key)); await tools.press("Escape", "Escape", 27); await tools.press("Escape", "Escape", 27);
}

/** Actual MetadataEditor fields in Reading, Live Preview and a file-properties workspace pane. */
export async function checkPropertiesCompletion(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const folder = "Properties completion", path = folder + "/Source.md", contributor = folder + "/Known values.md";
  const original = '---\r\n# Keep source comment\r\nstatus: Open # keep status comment\r\nlabels: [ kept ]\r\ntags: [ shared ]\r\naliases: [ Existing ]\r\ncount: 1.50\r\nnested: { retain: opaque }\r\n---\r\n# Properties completion λ\r\n\r\nUntouched 😀 body.\r\n';
  const known = '---\r\nstatus: "Completed λ"\r\nlabels: [Candidate, kept]\r\ntags: [shared, project]\r\naliases: ["Useful alias"]\r\n---\r\n# Known values\r\n';
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")'), autosave = await evaluate("app.markdownAutosave.enabled");
  if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, path), Buffer.from("\ufeff" + original), { flag: "wx" }); await writeFile(join(directory, contributor), Buffer.from("\ufeff" + known), { flag: "wx" });
  await evaluate(`(()=>{const trace={events:[],wrapped:[],change:app.properties.changeValue,abort:new AbortController()};const snapshot=()=>{const view=app.workspace.activeLeaf?.view,field=document.activeElement;return{source:app.workspace.sessions.get(${q(path)})?.text.match(/^status:.*$/m)?.[0],activeId:field?.getAttribute?.("aria-controls"),activeValue:field?.value,comparison:view?.metadataEditor?.rendered.find(row=>row.entry.key==="status")?.entry.value,mode:view?.getEditingMode?.()}};trace.record=(type,data={})=>{trace.events.push({at:performance.now(),type,...data,...snapshot()});if(trace.events.length>256)trace.events.shift()};trace.wrap=editor=>{if(trace.wrapped.some(item=>item.editor===editor))return;const render=editor.render;editor.render=function(...args){trace.record("render-before",{force:args[0],committed:args[1]});const result=render.apply(this,args);trace.record("render-after",{force:args[0],committed:args[1]});return result};trace.wrapped.push({editor,render})};app.properties.changeValue=function(...args){trace.record("changeValue",{key:args[1],prior:args[2],next:args[3],guard:typeof args[5]==="function",stack:new Error().stack?.slice(0,2000)});return trace.change.apply(this,args)};for(const type of["focus","blur","focusin","focusout","input","keydown"]){document.addEventListener(type,event=>{const field=event.target;if(field instanceof HTMLInputElement&&field.closest(${q(inline + ' [data-property-key="status"]')}))trace.record(type,{id:field.getAttribute("aria-controls"),value:field.value,key:event.key,trusted:event.isTrusted,related:event.relatedTarget?.outerHTML?.slice(0,200)})},{capture:true,signal:trace.abort.signal})}globalThis.propertiesCompletionTrace=trace})()`);
  const open = mode => evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${q(path)});const view=app.workspace.activeLeaf.view;view.setEditingMode("live-preview");${mode === "preview" ? 'view.setMode("preview");' : ""}view.metadataEditor.contentEl.dataset.propertiesCompletionRoot="inline"})()`);
  try {
    for (const mode of ["preview", "live-preview"]) {
      await open(mode); await wait(`Boolean(document.querySelector(${q(input(inline, "status"))}))`, "inline Properties field visible");
      await evaluate(`propertiesCompletionTrace.wrap(app.workspace.activeLeaf.view.metadataEditor);propertiesCompletionTrace.record("before-prefix",{testMode:${q(mode)}})`);
      await expectChoice(tools, inline, "status", "Com", "Completed λ");
      await evaluate(`propertiesCompletionTrace.record("after-prefix",{testMode:${q(mode)}})`);
      assert.equal(await evaluate(`app.editor.getValue()===${q(original)}`), true, "typing a Properties prefix is not a note mutation");
      const geometry = await evaluate(`(()=>{const control=document.querySelector(${q(input(inline, "status"))}),row=document.querySelector(${q(choice(inline, "status", "Completed λ"))}),box=row.closest("[data-property-value-suggestions]");return{value:row.textContent,connected:row.isConnected,within:row.getBoundingClientRect().left>=box.getBoundingClientRect().left-1&&row.getBoundingClientRect().right<=box.getBoundingClientRect().right+1,inputType:control.type}})()`);
      assert.deepEqual(geometry, { value: "Completed λ", connected: true, within: true, inputType: "text" });
      await capture?.("properties-completion-" + mode);
      if (mode === "preview") {
        // Hold only the real changeValue completion after its note write/index
        // have finished. This deterministically exercises Undo overtaking the
        // final MetadataEditor committed-row refresh, without mocking a write.
        await evaluate('(()=>{const hold={previous:app.properties.changeValue,held:false,release:null};app.properties.changeValue=async function(...args){const result=await hold.previous.apply(this,args);if(args[1]==="status"&&args[3]==="Completed λ"&&!hold.held){hold.held=true;await new Promise(resolve=>{hold.release=resolve})}return result};globalThis.propertiesCompletionCommitHold=hold})()');
      }
      await click(choice(inline, "status", "Completed λ"));
      const completed = original.replace("status: Open #", "status: Completed λ #"); await saved(tools, path, completed);
      if (mode === "preview") await wait("globalThis.propertiesCompletionCommitHold?.held===true", "real saved/indexed Properties choice waits before its UI completion");
      else await wait(`(()=>{const field=document.querySelector(${q(input(inline, "status"))});return field?.value==="Completed λ"&&!field.readOnly&&!field.closest("[aria-busy=true]")})()`, "ordinary Properties choice fully drains its field lifecycle before history checks");
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original); await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), completed);
      await evaluate("app.editor.undo();app.saveAll()"); await saved(tools, path, original);
      if (mode === "preview") {
        await evaluate('propertiesCompletionTrace.record("release-real-completion-after-rapid-undo");propertiesCompletionCommitHold.release()');
        await wait(`(()=>{const field=document.querySelector(${q(input(inline, "status"))});return field?.value==="Open"&&!field.readOnly&&!field.closest("[aria-busy=true]")})()`, "accepted query is consumed even when Undo restores the original value before UI completion");
        await evaluate('app.properties.changeValue=propertiesCompletionCommitHold.previous;delete globalThis.propertiesCompletionCommitHold');
      }
      await refreshFields(tools); await saved(tools, path, original); await evaluate(`propertiesCompletionTrace.record("after-history-refresh",{testMode:${q(mode)}})`);
      pass(report, `${mode}: actual inline Properties pointer choices use same-key strings, preserve comments/numeric/structured values and exact BOM/CRLF bytes, and isolated Undo/Redo never saves the typed prefix; Reading also holds the real completed write while rapid Undo overtakes its UI refresh, then verifies the consumed draft stays Open after blur.`);
    }
    report.propertiesCompletionTrace = await evaluate("propertiesCompletionTrace.events");

    await expectChoice(tools, inline, "labels", "Cand", "Candidate");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(choice(inline, "labels", "kept"))}))`), false);
    await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
    const withList = original.replace("labels: [ kept ]", "labels: [ kept, Candidate ]"); await saved(tools, path, withList);
    await fieldReady(tools, inline, "labels");
    await evaluate('(()=>{const boundary={previous:app.properties.changeValue,tagsHeld:false,aliasWaiting:false};app.properties.changeValue=async function(...args){if(args[1]==="aliases"&&!boundary.aliasWaiting){boundary.aliasWaiting=true;propertiesCompletionTrace.record("aliases-accepted-before-actual-guard");await new Promise(resolve=>{boundary.releaseAlias=resolve})}const result=await boundary.previous.apply(this,args);if(args[1]==="tags"&&!boundary.tagsHeld){boundary.tagsHeld=true;await new Promise(resolve=>{boundary.releaseTags=resolve})}return result};globalThis.propertiesCompletionAdjacent=boundary})()');
    await expectChoice(tools, inline, "tags", "pro", "project"); await click(choice(inline, "tags", "project"));
    const withTags = withList.replace("tags: [ shared ]", "tags: [ shared, project ]"); await saved(tools, path, withTags);
    await wait("propertiesCompletionAdjacent.tagsHeld===true", "real tag write/index finished while its final row refresh waits");
    await expectChoice(tools, inline, "aliases", "Useful", "Useful alias"); await press("ArrowDown", "ArrowDown", 40); await press("Tab", "Tab", 9);
    await wait("propertiesCompletionAdjacent.aliasWaiting===true", "valid alias selection is queued before its real write guard");
    await evaluate(`(()=>{const boundary=propertiesCompletionAdjacent;boundary.aliasField=document.querySelector(${q(input(inline, "aliases"))});boundary.tagBefore=document.querySelector(${q(input(inline, "tags"))}).closest("[data-property-key]");propertiesCompletionTrace.record("release-tags-with-alias-selected");boundary.releaseTags()})()`);
    await wait("!propertiesCompletionAdjacent.tagBefore.isConnected", "real tag committed-row refresh replaced its old row");
    const adjacent = await evaluate(`(()=>{const boundary=propertiesCompletionAdjacent;return{sameAliasInput:document.querySelector(${q(input(inline, "aliases"))})===boundary.aliasField,connected:boundary.aliasField.isConnected,focused:document.activeElement===boundary.aliasField,draft:boundary.aliasField.value}})()`);
    assert.deepEqual(adjacent, { sameAliasInput: true, connected: true, focused: true, draft: "Useful" }, "refreshing another row never moves/blurs a valid adjacent queued suggestion");
    report.propertiesCompletionAdjacent = adjacent;
    await evaluate('propertiesCompletionTrace.record("allow-real-alias-guard-after-tags-refresh");propertiesCompletionAdjacent.releaseAlias()');
    const withAlias = withTags.replace("aliases: [ Existing ]", "aliases: [ Existing, Useful alias ]"); await saved(tools, path, withAlias);
    await fieldReady(tools, inline, "aliases");
    await evaluate('app.properties.changeValue=propertiesCompletionAdjacent.previous;delete globalThis.propertiesCompletionAdjacent');
    await evaluate("app.editor.undo();app.editor.undo();app.editor.undo();app.saveAll()"); await saved(tools, path, original); await refreshFields(tools);
    pass(report, "Real Properties list/tag/alias fields omit existing entries, support Arrow/Enter and Arrow/Tab, and keep three independent exact Undo steps. An explicit fixture holds a real completed tag write, queues a valid alias selection, then releases the tag row refresh: the same alias input stays focused and its later real guarded write succeeds.");
    report.propertiesCompletionTrace = await evaluate("propertiesCompletionTrace.events");

    // A real Properties pane uses the same independent MetadataEditor/controller.
    await evaluate(`(async()=>{const source=app.workspace.activeLeaf,leaf=app.workspace.getLeaf("split");await leaf.setViewState({type:"file-properties",state:{file:${q(path)},followActiveFile:false},active:true});globalThis.propertiesCompletionSourceLeaf=source.id;globalThis.propertiesCompletionPaneLeaf=leaf.id;leaf.view.metadataEditor.contentEl.dataset.propertiesCompletionRoot="pane"})()`);
    await wait(`Boolean(document.querySelector(${q(input(pane, "status"))}))`, "real file-properties pane values");
    await expectChoice(tools, pane, "status", "Com", "Completed λ"); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
    const completed = original.replace("status: Open #", "status: Completed λ #"); await saved(tools, path, completed);
    await evaluate("(()=>{const leaf=app.workspace.getLeafById(propertiesCompletionSourceLeaf);leaf.view.editor.undo();app.workspace.setActiveLeaf(leaf,{focus:true});return app.saveAll()})()"); await saved(tools, path, original);
    await evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(propertiesCompletionPaneLeaf));delete globalThis.propertiesCompletionPaneLeaf;delete globalThis.propertiesCompletionSourceLeaf");
    pass(report, "An actual file-properties workspace pane presents the same guarded suggestions and keyboard selection, edits its fixed note independently, and retains the source editor's isolated Undo and exact saved bytes.");

    await open("live-preview");
    // A dirty contributor is read from its actual session, not stale cached YAML.
    await evaluate(`(async()=>{const source=app.workspace.activeLeaf,peer=app.workspace.createLeafBySplit(source);await peer.openFile(app.vault.getFileByPath(${q(contributor)}));peer.view.setEditingMode("source");peer.view.editor.replaceExpected(peer.view.editor.getValue(),0,peer.view.editor.getValue().length,${q(known.replace("Completed λ", "Dirty choice λ"))},"input.properties-contributor");globalThis.propertiesCompletionPeer=peer.id;app.workspace.setActiveLeaf(source,{focus:true})})()`);
    await expectChoice(tools, inline, "status", "Dirty", "Dirty choice λ");
    await evaluate(`globalThis.propertiesCompletionHeld=document.querySelector(${q(choice(inline, "status", "Dirty choice λ"))});(()=>{const e=app.workspace.getLeafById(propertiesCompletionPeer).view.editor;e.replaceExpected(e.getValue(),0,e.getValue().length,${q(known)},"input.properties-contributor-change")})();propertiesCompletionHeld.click()`);
    await wait(`document.querySelector(${q(inline + ' [data-property-key="status"] .metadata-property-error')}).textContent.includes("suggestion changed")`, "retained suggestion refuses changed dirty contributor");
    assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + original));
    await closeDraft(tools, inline, "status");
    await evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(propertiesCompletionPeer));delete globalThis.propertiesCompletionPeer;delete globalThis.propertiesCompletionHeld");
    await expectChoice(tools, inline, "status", "Com", "Completed λ");
    await evaluate(`globalThis.propertiesCompletionHeld=document.querySelector(${q(choice(inline, "status", "Completed λ"))})`);
    const external = known.replace("Completed λ", "External replacement"); await writeFile(join(directory, contributor), Buffer.from("\ufeff" + external));
    await evaluate("app.metadataCache.refresh()"); await evaluate("propertiesCompletionHeld.click()");
    await wait(`document.querySelector(${q(inline + ' [data-property-key="status"] .metadata-property-error')}).textContent.includes("suggestion changed")`, "retained suggestion refuses observed external contributor edits");
    assert.equal(await evaluate("app.editor.getValue()"), original); await closeDraft(tools, inline, "status");
    await writeFile(join(directory, contributor), Buffer.from("\ufeff" + known)); await evaluate("app.metadataCache.refresh()");
    pass(report, "Known Properties values follow real dirty contributors ahead of metadata; held pointer rows refuse changed dirty or independently edited/indexed contributors before any source mutation or prefix save.");

    await expectChoice(tools, inline, "status", "Com", "Completed λ");
    const width = await evaluate(`(()=>{const root=document.querySelector(${q(inline)});const old=root.style.getPropertyValue("max-width");root.style.setProperty("max-width","320px");return old})()`);
    try {
      const geometry = await evaluate(`(()=>{const root=document.querySelector(${q(inline)}),list=root.querySelector("[data-property-value-suggestions]:not([hidden])"),r=list.getBoundingClientRect();return{width:root.getBoundingClientRect().width,listWidth:r.width,items:[...list.children].map(item=>{const x=item.getBoundingClientRect();return x.left>=r.left-1&&x.right<=r.right+1&&x.height>0})}})()`);
      assert.ok(geometry.width <= 321); assert.ok(geometry.listWidth > 0); assert.ok(geometry.items.every(Boolean)); await capture?.("properties-completion-narrow");
    } finally { await evaluate(`(()=>{const root=document.querySelector(${q(inline)});if(${q(width)})root.style.setProperty("max-width",${q(width)});else root.style.removeProperty("max-width")})()`); }
    await evaluate(`globalThis.propertiesCompletionHeld=document.querySelector(${q(choice(inline, "status", "Completed λ"))})`);
    await closeDraft(tools, inline, "status"); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");propertiesCompletionHeld.click();delete globalThis.propertiesCompletionHeld');
    assert.equal(await evaluate("app.editor.getValue()"), original); await saved(tools, path, original);
    await open("live-preview"); await evaluate("app.workspace.flushLayout()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"&&!app.changingVault`, "Properties completion note restored after restart/reconnection");
    await evaluate('app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertiesCompletionRoot="inline"');
    await expectChoice(tools, inline, "status", "Com", "Completed λ"); await closeDraft(tools, inline, "status"); await saved(tools, path, original);
    assert.deepEqual(await readFile(join(directory, contributor)), Buffer.from("\ufeff" + known));
    report.propertiesCompletion = { inlineReadingAndLivePreview: true, workspacePane: true, pointerAndKeyboard: true, scalarListsTagsAliases: true, duplicateExclusion: true, dirtyAndObservedContributorRefusal: true, detachedChoiceRefusal: true, narrowControls: true, isolatedUndoExactBomCrLf: true, acceptedDraftAfterRapidUndo: true, adjacentChoiceKeepsFocus: true, restart: true };
    pass(report, "Properties suggestion controls fit a 320px surface, cancelled/detached choices cannot commit later, and full native restart/browser reconnection restores fresh known-value choices without persisting a popup or changing exact note/contributor bytes.");
  } catch (error) {
    const trace = await evaluate("globalThis.propertiesCompletionTrace?.events??[]").catch(() => []); if (trace.length) report.propertiesCompletionTrace = trace;
    try { report.propertiesCompletionFailure = await evaluate(`(()=>({activeFile:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf?.view?.getEditingMode?.(),source:app.workspace.sessions.get(${q(path)})?.text,rows:[...document.querySelectorAll("[data-property-key]")].slice(0,20).map(row=>({key:row.dataset.propertyKey,input:row.querySelector("input")?.value,error:row.querySelector(".metadata-property-error")?.textContent,choices:[...row.querySelectorAll("[data-property-value-choice]")].map(item=>item.textContent)})),focus:document.activeElement?.outerHTML.slice(0,400)}))()`); await capture?.("properties-completion-precleanup-failure"); } catch (diagnostic) { report.propertiesCompletionFailure = { diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    await evaluate("(async()=>{const adjacent=globalThis.propertiesCompletionAdjacent;if(adjacent){adjacent.releaseTags?.();adjacent.releaseAlias?.();await app.core.whenIdle();app.properties.changeValue=adjacent.previous;delete globalThis.propertiesCompletionAdjacent}const hold=globalThis.propertiesCompletionCommitHold;if(hold){hold.release?.();await app.core.whenIdle();app.properties.changeValue=hold.previous;delete globalThis.propertiesCompletionCommitHold}const trace=globalThis.propertiesCompletionTrace;if(trace){trace.abort.abort();app.properties.changeValue=trace.change;for(const item of trace.wrapped)item.editor.render=item.render;delete globalThis.propertiesCompletionTrace}})()");
    await evaluate("delete globalThis.propertiesCompletionHeld");
    await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();if(app.core.isEnabled("properties")!==${enabled})await app.core.setEnabled("properties",${enabled});await app.markdownAutosave.setEnabled(${autosave})})()`);
  }
}

/** Parent mounts Read only.md with status/tags/labels YAML and a cached known-value contributor. */
export async function checkPropertiesCompletionReadOnly(tools) {
  const { evaluate, command, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("live-preview");app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertiesCompletionRoot="inline"})()');
  await wait(`Boolean(document.querySelector(${q(input(inline, "status"))}))`, "cached read-only Properties values");
  const before = await evaluate("app.editor.getValue()");
  for (const key of ["status", "tags", "labels"]) assert.equal(await evaluate(`document.querySelector(${q(input(inline, key))}).disabled`), true);
  await evaluate(`(()=>{const field=document.querySelector(${q(input(inline, "status"))});field.value="Com";field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));field.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))})()`);
  assert.equal(await evaluate(`document.querySelectorAll(${q(inline + ' [data-property-value-choice]')}).length`), 0);
  await command("Input.insertText", { text: "Refused property completion" }); assert.equal(await evaluate("app.editor.getValue()"), before);
  await capture?.("properties-completion-readonly");
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")');
  assert.equal(await evaluate("app.editor.getValue()"), before);
  report.propertiesCompletion = { ...(report.propertiesCompletion ?? {}), cachedReadOnlyDisabled: true, cachedReadOnlyUnchanged: true };
  pass(report, "A genuine cached read-only vault shows disabled Properties string/list controls; synthetic retained input/keyboard attempts expose no choices and cannot change the exact note while the parent audits every cached blob and zero network requests.");
}
