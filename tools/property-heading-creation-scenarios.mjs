import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

export const PROPERTY_HEADING_READONLY_REQUIREMENTS = Object.freeze({ source: "Read only.md", target: "Known target.md", textProperty: "related", listProperty: "links", missingHeading: "Property cached missing λ" });
const q = JSON.stringify, host = '[data-property-heading-root="true"]', bytes = text => Buffer.from("\ufeff" + text);
const field = property => host + ' [data-property-key=' + q(property) + '] [data-metadata-input]';
const item = (target, subpath) => host + ' [data-property-create-heading=' + q(target) + '][data-property-heading-subpath=' + q(subpath) + ']';
const error = property => host + ' [data-property-key=' + q(property) + '] .metadata-property-error';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function key(tools, value, code, number, modifiers = 0) { for (const type of ["rawKeyDown", "keyUp"]) await tools.command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode: number, modifiers }); }
async function fill(tools, selector, value) { await tools.click(selector); await key(tools, "a", "KeyA", 65, 2); if (value) await tools.command("Input.insertText", { text: value }); else await key(tools, "Backspace", "Backspace", 8); }
async function mark(tools) { await tools.evaluate('(()=>{document.querySelectorAll("[data-property-heading-root]").forEach(element=>delete element.dataset.propertyHeadingRoot);app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertyHeadingRoot="true";return true})()'); }
async function cancel(tools, property = "status") { await tools.click(field(property)); await key(tools, "Escape", "Escape", 27); await key(tools, "Escape", "Escape", 27); }
async function offer(tools, property, target, subpath) {
  await cancel(tools, property); await fill(tools, field(property), "[[" + target.slice(0, -3) + "#" + subpath);
  await tools.wait('Boolean(document.querySelector(' + q(item(target, subpath)) + ')?.checkVisibility())', "the explicit Properties Create heading action is visible");
  assert.equal(await tools.evaluate('document.querySelector(' + q(error(property)) + ').textContent'), "");
}
const sourceText = '---\r\n# Preserve exact property comment λ\r\nstatus: Open # keep scalar comment\r\nlabels: [ kept ]\r\naliases: [ Existing alias ]\r\ntags: [ shared ]\r\ncount: 1.50\r\nopaque: { keep: exact }\r\n---\r\n# Property heading source λ\r\n\r\nUntouched 😀 body.\r\n';
const targetText = '---\r\nopaque: { target: "λ 😀" }\r\n---\r\n# Parent\r\n\r\nExisting parent body Ω.\r\n\r\n# Sibling\r\n\r\nUntouched final body.\r\n';
const childTarget = lines => targetText.replace("# Sibling\r\n", lines.join("\r\n\r\n") + "\r\n\r\n# Sibling\r\n");

/** The root supplies frozen builds, trusted input, restart/reconnection and final error audits. */
export async function checkPropertyHeadingCreation(tools) {
  const { directory, evaluate, wait, click, command, capture, report, restart, afterReload } = tools;
  const folder = "Property heading creation", path = folder + "/Source folder/Source.md", targets = folder + "/Targets/";
  const names = ["Reading", "Live Preview", "List", "List LP", "Pane", "Stale", "Conflict", "Queued", "Cleanup", "Replaced"], expected = new Map(names.map(name => [targets + name + ".md", targetText]));
  const configPath = join(directory, ".obsidian/app.json"), configBytes = await readFile(configPath), config = JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, ""));
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const source = 'app.workspace.sessions.get(' + q(path) + ').text';
  const exactSource = async value => { await wait(source + "===" + q(value) + '&&!app.workspace.sessions.get(' + q(path) + ').dirty&&!app.workspace.sessions.get(' + q(path) + ').isSaving', "exact Properties heading source bytes are saved"); assert.deepEqual(await readFile(join(directory, path)), bytes(value)); };
  const exactTargets = async () => { for (const [target, text] of expected) assert.deepEqual(await readFile(join(directory, target)), bytes(text), "exact target bytes: " + target); };
  const settled = () => evaluate("(async()=>{await app.workspace.whenIdle();await app.core.whenIdle();await app.metadataCache.refresh()})()");
  const update = async format => { await writeFile(configPath, JSON.stringify({ ...config, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: true }, null, 2)); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()'); };
  const open = async mode => { await evaluate('(async()=>{await app.openFile(' + q(path) + ');const view=app.workspace.activeLeaf.view;view.setEditingMode("live-preview");if(' + q(mode) + '==="preview")view.setMode("preview")})()'); await mark(tools); await wait('Boolean(document.querySelector(' + q(field("status")) + ')?.checkVisibility())', "genuine Properties heading source controls"); };
  const expectedSource = (property, value) => property === "labels" ? sourceText.replace("labels: [ kept ]", "labels: [ kept, " + JSON.stringify(value) + " ]") : sourceText.replace("status: Open #", "status: " + JSON.stringify(value) + " #");
  const token = async (target, subpath) => evaluate('"[["+app.metadataCache.fileToLinktext(app.vault.getFileByPath(' + q(target) + '),' + q(path) + ',true)+"#"+' + q(subpath) + '+"]]"');
  const currentNotice = target => '[...document.querySelectorAll(".notice")].some(element=>element.textContent.includes(' + q(target) + ')&&element.textContent.includes("was confirmed")&&element.textContent.includes("review the current target, property"))';
  const restore = '(()=>{const t=globalThis.propertyHeadingTrace;if(!t)return true;if(t.saveAll)app.saveAll=t.saveAll;if(t.read)app.vault.readDocument=t.read;if(t.refresh)app.metadataCache.refresh=t.refresh;if(t.assign)app.fileManager.assignMarkdownSubpath=t.assign;if(t.session&&t.reload)t.session.reload=t.reload;if(t.write)app.vault.writeDocument=t.write;t.release?.();t.abort?.abort();return true})()';
  let failure, stage = "fixture";
  try {
    if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
    await mkdir(join(directory, folder, "Source folder"), { recursive: true }); await mkdir(join(directory, folder, "Targets"), { recursive: true }); await writeFile(join(directory, path), bytes(sourceText), { flag: "wx" });
    for (const target of expected.keys()) await writeFile(join(directory, target), bytes(targetText), { flag: "wx" });
    await update("shortest"); await open("preview");
    const inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
    await evaluate('(()=>{const t=globalThis.propertyHeadingTrace={trusted:[],acks:[],abort:new AbortController()};t.write=app.vault.writeDocument;app.vault.writeDocument=async function(target,...args){const written=await t.write.call(this,target,...args);if(target.startsWith(' + q(targets) + ')){t.acks.push({target,source:' + source + ',content:written.content});if(target===t.cleanupPath)t.failRefresh=true}return written};for(const type of["pointerdown","keydown"])document.addEventListener(type,event=>{const button=type==="pointerdown"?event.target.closest?.("[data-property-create-heading]"):event.target.closest?.("[data-metadata-input]")?.parentElement.querySelector("[data-property-create-heading][aria-selected=true]");if(button&&(type==="pointerdown"||event.key==="Enter"||event.key==="Tab"))t.trusted.push({type:type==="pointerdown"?"pointer":event.key,target:button.dataset.propertyCreateHeading,subpath:button.dataset.propertyHeadingSubpath,property:button.closest("[data-property-key]")?.dataset.propertyKey,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()');

    stage = "Reading Live Preview and fixed Properties target creation";
    const cases = [
      ["preview", "shortest", "status", "Reading", "Parent#Created Reading λ", childTarget(["## Created Reading λ"]), "pointer"],
      ["live-preview", "relative", "status", "Live Preview", "Parent#New LP ancestor λ#Created leaf Ω", childTarget(["## New LP ancestor λ", "### Created leaf Ω"]), "Enter"],
      ["preview", "absolute", "labels", "List", "Missing list parent λ#Created list child Ω", targetText + "\r\n# Missing list parent λ\r\n\r\n## Created list child Ω\r\n", "Enter"],
      ["live-preview", "shortest", "labels", "List LP", "Parent#Created LP list λ", childTarget(["## Created LP list λ"]), "Tab"],
      ["pane", "shortest", "status", "Pane", "Parent#Pane ancestor λ#Pane terminal Ω", childTarget(["## Pane ancestor λ", "### Pane terminal Ω"]), "Enter"]
    ];
    for (const [mode, format, property, name, subpath, targetExpected, input] of cases) {
      const target = targets + name + ".md"; await update(format); await open(mode === "pane" ? "preview" : mode);
      if (mode === "pane") { await evaluate('(async()=>{const leaf=app.workspace.getLeaf("split");await leaf.setViewState({type:"file-properties",state:{file:' + q(path) + ',followActiveFile:false},active:true});propertyHeadingTrace.pane=leaf.id})()'); await mark(tools); }
      await offer(tools, property, target, subpath); await exactSource(sourceText); await exactTargets();
      const appearance = await evaluate('(()=>{const row=document.querySelector(' + q(item(target, subpath)) + ');return{text:row.textContent,title:row.title,plain:!row.querySelector("img,script"),preview:row.querySelector("small").textContent,whiteSpace:row.querySelector("small").style.whiteSpace}})()');
      assert.ok(appearance.text.includes("Create heading")); assert.ok(appearance.title.includes(target + "#" + subpath)); assert.equal(appearance.plain, true); assert.equal(appearance.whiteSpace, "pre-line"); assert.ok(appearance.preview.includes("\n"));
      await capture?.("property-heading-" + mode + "-" + property);
      if (input === "pointer") await click(item(target, subpath)); else { await key(tools, "ArrowDown", "ArrowDown", 40); await key(tools, input, input, input === "Tab" ? 9 : 13); }
      const link = await token(target, subpath), sourceExpected = expectedSource(property, link); await exactSource(sourceExpected); expected.set(target, targetExpected); await exactTargets();
      assert.ok((await evaluate("propertyHeadingTrace.trusted")).some(entry => entry.target === target && entry.subpath === subpath && entry.property === property && entry.type === input && entry.trusted));
      assert.equal(await evaluate('app.workspace.sessions.get(' + q(path) + ').leaves.size>0'), true);
      if (mode === "pane") await evaluate('(async()=>{const pane=app.workspace.getLeafById(propertyHeadingTrace.pane),leaf=app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===' + q(path) + ');await app.workspace.closeLeaf(pane);app.workspace.setActiveLeaf(leaf,{focus:true})})()');
      await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.focus()');
      await key(tools, "z", "KeyZ", 90, 2); assert.equal(await evaluate(source), sourceText); await evaluate("app.saveAll()"); await exactSource(sourceText); await exactTargets();
      await key(tools, "y", "KeyY", 89, 2); assert.equal(await evaluate(source), sourceExpected); await evaluate("app.saveAll()"); await exactSource(sourceExpected);
      await key(tools, "z", "KeyZ", 90, 2); await evaluate("app.saveAll()"); await exactSource(sourceText); await settled();
    }
    assert.ok((await evaluate("propertyHeadingTrace.acks")).every(entry => entry.source === sourceText)); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
    pass(report, "Real Reading, Live Preview and fixed Properties text/list-add controls use trusted pointer/Arrow+Enter/Tab to create reviewed existing-target headings and ancestor chains before YAML insertion. Shortest/relative/absolute wiki spelling works despite Markdown preference; exact BOM/CRLF/Unicode/comments/opaque fields survive, source Undo/Redo is isolated and keeps every acknowledged target heading without creating notes or navigating.");

    stage = "noncreating and unsupported property controls"; await update("shortest"); await open("preview");
    const beforeUnsupported = new Map(expected);
    for (const [property, query] of [["status", "[[" + targets + "Stale#Parent"], ["status", "[[Missing note#Parent#Child"], ["status", "[[" + targets + "Stale#^Missing"], ["tags", "[[" + targets + "Stale#Missing"], ["aliases", "[[" + targets + "Stale#Missing"], ["count", "[[" + targets + "Stale#Missing"]]) {
      await cancel(tools, property); await fill(tools, field(property), query); assert.equal(await evaluate('document.querySelectorAll(' + q(host + " [data-property-create-heading]") + ').length'), 0); await cancel(tools, property);
    }
    await exactSource(sourceText); await exactTargets(); assert.deepEqual(expected, beforeUnsupported);
    pass(report, "Existing known headings keep their noncreating choices. Missing-note, block, tag/alias/number controls expose no heading creation; typing and Escape leave exact source, targets and inventory unchanged. Same-note heading creation is covered by the separate combined Properties workflow collection.");

    stage = "actual stale owner preflight";
    const staleTarget = targets + "Stale.md", staleSubpath = "Parent#Stale owner λ"; await offer(tools, "status", staleTarget, staleSubpath);
    await evaluate('(()=>{const t=propertyHeadingTrace;t.saveAll=app.saveAll;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.saveAll=async function(...args){t.waiting=true;await t.gate;return t.saveAll.apply(this,args)};return true})()');
    await click(item(staleTarget, staleSubpath)); await wait("propertyHeadingTrace.waiting", "the actual target preflight is held in SaveAll");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);propertyHeadingTrace.release()');
    await wait('!app.workspace.isChangingFiles&&document.querySelector(' + q(error("status")) + ')?.textContent.includes("No target edit was added")', "the current stale owner refusal is fully delivered");
    await evaluate("app.saveAll=propertyHeadingTrace.saveAll;delete propertyHeadingTrace.saveAll"); await settled(); await exactSource(sourceText); await exactTargets();

    stage = "real optimistic target version conflict"; await open("preview");
    const conflictTarget = targets + "Conflict.md", conflictSubpath = "Parent#Conflicted child λ", external = targetText + "External newer target Ω\r\n"; await offer(tools, "status", conflictTarget, conflictSubpath);
    await evaluate('(()=>{const t=propertyHeadingTrace;t.read=app.vault.readDocument;t.waiting=false;t.armed=true;t.gate=new Promise(resolve=>t.release=resolve);app.vault.readDocument=async function(path,...args){const document=await t.read.call(this,path,...args);if(t.armed&&path===' + q(conflictTarget) + '){t.armed=false;t.waiting=true;await t.gate}return document};return true})()');
    await click(item(conflictTarget, conflictSubpath)); await wait("propertyHeadingTrace.waiting", "the real target version read is held before its optimistic write");
    await writeFile(join(directory, conflictTarget), bytes(external)); expected.set(conflictTarget, external); await evaluate("propertyHeadingTrace.release()");
    await wait('!app.workspace.isChangingFiles&&/changed|409|version|conflict/i.test(document.querySelector(' + q(error("status")) + ')?.textContent??"")', "the current physical target conflict is refused in its property row");
    await evaluate("app.vault.readDocument=propertyHeadingTrace.read;delete propertyHeadingTrace.read"); await settled(); await exactSource(sourceText); await exactTargets();
    assert.equal(await evaluate("propertyHeadingTrace.acks.some(entry=>entry.target===" + q(conflictTarget) + ")"), false);
    pass(report, "An actual mode/owner change during SaveAll refuses before target mutation. An external physical replacement after the real version read makes the ordinary optimistic write fail, preserving newer BOM/CRLF target bytes and exact source without a speculative heading, property link or inferred acknowledgement.");

    stage = "queued property owner guard after acknowledgement"; await open("preview");
    const queuedTarget = targets + "Queued.md", queuedSubpath = "Parent#Queued child λ", queuedExpected = childTarget(["## Queued child λ"]); await offer(tools, "status", queuedTarget, queuedSubpath);
    await evaluate('(()=>{const t=propertyHeadingTrace;t.session=app.workspace.sessions.get(' + q(path) + ');t.reload=t.session.reload;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);t.session.reload=async function(...args){const row=document.querySelector(' + q(host + ' [data-property-key="status"]') + ');if(!t.waiting&&!app.workspace.isChangingFiles&&row?.getAttribute("aria-busy")==="true"){t.waiting=true;await t.gate}return t.reload.apply(this,args)};return true})()');
    await click(item(queuedTarget, queuedSubpath)); await wait("propertyHeadingTrace.waiting&&!app.workspace.isChangingFiles", "the real YAML queue waits after releasing its target mutation lock");
    expected.set(queuedTarget, queuedExpected); await exactSource(sourceText); await exactTargets();
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);propertyHeadingTrace.release()'); await wait(currentNotice(queuedTarget), "the acknowledged target creation requests current property review after queue refusal");
    await evaluate("propertyHeadingTrace.session.reload=propertyHeadingTrace.reload;delete propertyHeadingTrace.reload;delete propertyHeadingTrace.session"); await settled(); await exactSource(sourceText); await exactTargets();

    stage = "acknowledged cleanup failure"; await open("preview");
    const cleanupTarget = targets + "Cleanup.md", cleanupSubpath = "Parent#Cleanup child λ", cleanupIssue = "Properties heading post-ack metadata cleanup failed"; await offer(tools, "status", cleanupTarget, cleanupSubpath);
    await evaluate('(()=>{const t=propertyHeadingTrace;t.cleanupPath=' + q(cleanupTarget) + ';t.refresh=app.metadataCache.refresh;t.failRefresh=false;app.metadataCache.refresh=async function(...args){if(t.failRefresh){t.failRefresh=false;throw Error(' + q(cleanupIssue) + ')}return t.refresh.apply(this,args)};return true})()');
    await expectErrors(tools, [{ source: "notification", message: cleanupIssue }], async () => { await click(item(cleanupTarget, cleanupSubpath)); await wait('!app.workspace.isChangingFiles&&document.querySelector("#client-errors").textContent.includes(' + q(cleanupIssue) + ')&&' + currentNotice(cleanupTarget), "the actual acknowledged cleanup failure retains its creation receipt and original error"); }, "one real Properties target write acknowledged before a controlled metadata cleanup failure");
    expected.set(cleanupTarget, childTarget(["## Cleanup child λ"])); await evaluate("app.metadataCache.refresh=propertyHeadingTrace.refresh;delete propertyHeadingTrace.refresh;delete propertyHeadingTrace.cleanupPath"); await click("[data-dismiss-error]"); await settled(); await exactSource(sourceText); await exactTargets();

    stage = "observed newer target after acknowledgement"; await open("preview");
    const replacedTarget = targets + "Replaced.md", replacedSubpath = "Parent#Confirmed child λ", replacement = targetText + "Newer external target replaces the confirmed heading Ω\r\n"; await offer(tools, "status", replacedTarget, replacedSubpath);
    await evaluate('(()=>{const t=propertyHeadingTrace;t.assign=app.fileManager.assignMarkdownSubpath;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.fileManager.assignMarkdownSubpath=async function(file,...args){const written=await t.assign.call(this,file,...args);if(file.path===' + q(replacedTarget) + '){t.waiting=true;await t.gate}return written};return true})()');
    await click(item(replacedTarget, replacedSubpath)); await wait("propertyHeadingTrace.waiting&&!app.workspace.isChangingFiles", "the real acknowledged target result waits before source insertion");
    assert.deepEqual(await readFile(join(directory, replacedTarget)), bytes(childTarget(["## Confirmed child λ"])));
    await writeFile(join(directory, replacedTarget), bytes(replacement)); expected.set(replacedTarget, replacement);
    await evaluate('(async()=>{await app.vault.refresh();await app.metadataCache.refresh();propertyHeadingTrace.release()})()'); await wait(currentNotice(replacedTarget), "the newer observed target refuses an obsolete property link with an accurate confirmation Notice");
    await evaluate("app.fileManager.assignMarkdownSubpath=propertyHeadingTrace.assign;delete propertyHeadingTrace.assign"); await settled(); await exactSource(sourceText); await exactTargets();
    const replacementNotice = await evaluate('[...document.querySelectorAll(".notice")].find(element=>element.textContent.includes(' + q(replacedTarget) + '))?.textContent'); assert.doesNotMatch(replacementNotice, /headings were kept|headings remain|headings still exist/); await capture?.("property-heading-retained-review");
    pass(report, "The real source YAML queue starts after target-lock release and refuses a later owner change while keeping acknowledged headings. A post-ack cleanup failure preserves the original reported error. A separately observed newer target replaces confirmed headings without rollback or obsolete YAML insertion; its Notice confirms the earlier receipt and asks for current-target/property review without claiming the headings still exist.");

    const trusted = await evaluate("propertyHeadingTrace.trusted"), acks = await evaluate("propertyHeadingTrace.acks"); assert.ok(trusted.length >= 9 && trusted.every(entry => entry.trusted)); assert.ok(acks.every(entry => entry.source === sourceText)); report.propertyHeadingInputs = trusted; report.propertyHeadingAcknowledgements = acks.map(({ target }) => target);
    await evaluate(restore); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); await exactSource(sourceText); await exactTargets();
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await open("preview"); await settled(); await exactSource(sourceText); await exactTargets();
    assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
    const freshTarget = targets + "Stale.md", freshSubpath = "Parent#Fresh after restart λ"; await offer(tools, "status", freshTarget, freshSubpath); await capture?.("property-heading-restored"); await cancel(tools); await exactSource(sourceText); await exactTargets();
    report.propertyHeadingCreation = { actualReadingLivePreviewAndFixedPane: true, trustedTextAndListAdd: true, targetWriteBeforeYaml: true, explicitHeadingAndAncestorChains: true, shortestRelativeAbsoluteWikiValues: true, exactBomCrlfUnicodeCommentsOpaque: true, sourceUndoKeepsTarget: true, sourceRedoIsolated: true, unchangedInventory: true, staleOwnerPreflight: true, realOptimisticTargetConflict: true, realYamlQueueGuard: true, acknowledgedCleanupOriginalError: true, observedNewerTargetPreserved: true, accurateConfirmedCreationNotice: true, restartExactTargetsAndSource: true, freshControlsAfterRestart: true };
    pass(report, "Full native restart or actual-folder browser reconnection retains exact target/source bytes and unchanged inventory, keeps confirmed target edits after source Undo or later failure, and leaves a fresh explicit Properties heading action usable.");
  } catch (error) {
    failure = error; report.propertyHeadingCreationFailure = { stage, error: String(error?.stack ?? error) };
    try { report.propertyHeadingCreationFailure.state = await evaluate('(()=>({source:' + source + ',changingFiles:app.workspace.isChangingFiles,mode:app.workspace.activeLeaf?.view.getMode?.(),fields:[...document.querySelectorAll(' + q(host + " [data-property-key]") + ')].map(row=>({key:row.dataset.propertyKey,value:row.querySelector("[data-metadata-input]")?.value,error:row.querySelector(".metadata-property-error")?.textContent})),rows:[...document.querySelectorAll(' + q(host + " [data-property-create-heading]") + ')].map(row=>({target:row.dataset.propertyCreateHeading,subpath:row.dataset.propertyHeadingSubpath})),notices:[...document.querySelectorAll(".notice")].map(element=>element.textContent),waiting:globalThis.propertyHeadingTrace?.waiting,acks:globalThis.propertyHeadingTrace?.acks,trusted:globalThis.propertyHeadingTrace?.trusted}))()'); await capture?.("property-heading-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    try {
      await evaluate(restore); await wait("!app.workspace.isChangingFiles", "Properties heading mutation lock settles before fixture cleanup"); await evaluate("app.saveAll()");
      await writeFile(configPath, configBytes);
      await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(' + q(layout) + ');await app.workspace.flushLayout();delete globalThis.propertyHeadingTrace})()');
      if (!enabled) await evaluate('app.core.setEnabled("properties",false)'); if (autosave) await evaluate("app.markdownAutosave.setEnabled(true)");
    } catch (error) { if (!failure) throw error; report.propertyHeadingCreationFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** The caller owns genuine cached source/target blobs and audits exact bytes and zero API/raw traffic. */
export async function checkPropertyHeadingCreationReadOnly(tools) {
  const { evaluate, command, wait, report, capture } = tools, required = PROPERTY_HEADING_READONLY_REQUIREMENTS;
  assert.equal(await evaluate("app.vault.readOnly"), true); const inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const snapshots = () => evaluate('(async()=>{const output=[];for(const path of' + q([required.source, required.target]) + '){const document=await app.vault.readDocument(path);output.push({path,content:document.content,version:document.version,hasBom:document.hasBom})}return output})()');
  const before = await snapshots(); assert.ok(before.every(entry => entry.content.length > 0)); assert.ok(!before[1].content.includes(required.missingHeading));
  await evaluate('app.workspace.activeLeaf.view.setMode("preview")'); await mark(tools);
  try {
    for (const property of [required.textProperty, required.listProperty]) {
      const selector = field(property); await wait('Boolean(document.querySelector(' + q(selector) + ')?.checkVisibility())', "genuine cache-only Properties heading source field"); assert.equal(await evaluate('document.querySelector(' + q(selector) + ').disabled'), true);
      const point = await evaluate('(()=>{const input=document.querySelector(' + q(selector) + ');input.scrollIntoView({block:"center",inline:"nearest"});const r=input.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===input,visible:input.checkVisibility()&&r.width>0&&r.height>0,value:input.value}})()'); assert.ok(point.hit && point.visible);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
      const query = "[[" + required.target.slice(0, -3) + "#" + required.missingHeading;
      await command("Input.insertText", { text: query }); await key(tools, "ArrowDown", "ArrowDown", 40); await key(tools, "Enter", "Enter", 13); assert.equal(await evaluate('document.querySelector(' + q(selector) + ').value'), point.value);
      await evaluate('(()=>{const input=document.querySelector(' + q(selector) + ');input.disabled=false;input.value=' + q(query) + ';input.dispatchEvent(new InputEvent("input",{bubbles:true}));return true})()');
      assert.equal(await evaluate('document.querySelectorAll(' + q(host + " [data-property-create-heading]") + ').length'), 0);
      await evaluate('(()=>{const input=document.querySelector(' + q(selector) + ');input.value=' + q(point.value) + ';input.disabled=true;input.blur();return true})()');
    }
    assert.deepEqual(await snapshots(), before); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory); await capture?.("property-heading-readonly");
    report.propertyHeadingCreationReadOnly = { genuineSourceAndExistingTarget: true, actualDisabledTextAndListFields: true, trustedTypingAndEnterRefused: true, forcedEligibleHeadingQueryDeclined: true, exactSourceTargetVersionsAndInventory: true };
    pass(report, "A genuine cache-only read-only Properties source has actual text/list fields and an existing target with a missing heading. Trusted typing/Arrow+Enter and forced eligible wiki input expose no heading action or target/property write; exact source/target content, versions, BOM flags and inventory remain unchanged for the parent's cached-blob/zero-network audit.");
  } finally { await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",true)'); }
}
