import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, root = "app.workspace.activeLeaf.view.previewEl", marker = '[data-reading-callouts-probe="current"]', key = "fold-state-v1";
const panel = '[data-reading-search="true"]', query = panel + ' [data-reading-search-query]';
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
function state() {
  const root = app.workspace.activeLeaf.view.previewEl, own = element => element.closest(".markdown-preview-view") === root;
  return { callouts: [...root.querySelectorAll('summary[data-reading-callout-toggle]')].filter(own).map(summary => ({ line: Number(summary.dataset.readingCalloutToggle), open: summary.parentElement.open, visible: summary.checkVisibility() })),
    embeddedControls: root.querySelectorAll('.markdown-embed [data-reading-callout-toggle]').length,
    rawDetailsOpen: [...root.querySelectorAll('details:not(.callout)')].filter(own).map(details => details.open) };
}
function remembered(path) { return (app.loadLocalStorage("fold-state-v1")?.records ?? []).find(record => record.channel === "reading-callouts" && record.path === path) ?? null; }
const selector = line => marker + ` [data-reading-callout-toggle=${q(String(line))}]`;
async function installed(tools, path) {
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${root}.querySelector('[data-reading-callout-toggle]')`, "current original Reading callout controls");
  await tools.evaluate(`(()=>{for(const old of document.querySelectorAll('[data-reading-callouts-probe]'))delete old.dataset.readingCalloutsProbe;${root}.dataset.readingCalloutsProbe="current"})()`);
}
async function reading(tools, path) {
  await tools.evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
  await installed(tools, path);
}
async function isOpen(tools, line, value) { assert.equal(await tools.evaluate(`document.querySelector(${q(selector(line))})?.parentElement.open`), value); }
async function pointer(tools, line) {
  await tools.evaluate(`document.querySelector(${q(selector(line))}).scrollIntoView({block:"center"})`); await tools.click(selector(line));
}
async function keyboard(tools, line, space = false) {
  const before = await tools.evaluate(`(()=>{const summary=document.querySelector(${q(selector(line))});summary.scrollIntoView({block:"center"});summary.focus({preventScroll:true});return {focused:document.activeElement===summary,open:summary.parentElement.open}})()`);
  assert.equal(before.focused, true); await tools.command("Page.bringToFront");
  const event = { key: space ? " " : "Enter", code: space ? "Space" : "Enter", windowsVirtualKeyCode: space ? 32 : 13, nativeVirtualKeyCode: space ? 32 : 13, modifiers: 0 }, text = space ? " " : "\r";
  await tools.command("Input.dispatchKeyEvent", { type: "keyDown", ...event, text, unmodifiedText: text }); await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  await tools.wait(`document.querySelector(${q(selector(line))})?.parentElement.open===${!before.open}`, "trusted " + (space ? "Space" : "Enter") + " toggles the native summary");
}
async function assertRemembered(tools, path, lines) {
  const record = await tools.evaluate(invoke(remembered, path)); assert.ok(record && /^[a-f0-9]{64}$/.test(record.source)); assert.deepEqual(record.value, lines); return record;
}
async function closeFind(tools) { if (await tools.evaluate(`Boolean(document.querySelector(${q(panel)}))`)) await tools.click(panel + ' button[name="close"]'); }
async function find(tools, text) {
  assert.equal(await tools.evaluate('app.commands.executeCommandById("editor:open-search")'), true);
  await tools.click(query);
  await tools.command("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await tools.command("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await tools.command("Input.insertText", { text });
  await tools.wait(`document.querySelector(${q(panel)})?.dataset.readingSearchCount!=="0"`, "Reading Find indexes captured callouts");
}

/** Real original-main callout summaries retain exact-source local preferences. */
export async function checkReadingCallouts(tools) {
  const { directory, evaluate, command, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading callout workflows", path = folder + "/Callouts.md", other = folder + "/Other.md", embedded = folder + "/Embedded.md";
  const text = ["---", 'opaque: "Callout local intent λ"', "---", "# Callout workflows", "", "[[Callouts#Nested heading|Reveal heading]]", "[[Callouts#^callout-deep|Reveal nested block]]", "",
    "> [!note]+ Outer λ", "> Opening body.", ">", "> > [!tip]- Nested tip", "> > calloutneedle nested target 😀 ^callout-deep", ">", "> ### Nested heading", ">", "> calloutneedle outer body.", "",
    "> [!warning]- Separate warning", "> calloutneedle independent.", "", "> [!quote] Ordinary untoggled", "> calloutneedle plain.", "",
    "<details><summary>Raw details</summary><p>calloutneedle raw-hidden</p></details>", "", "![[Embedded]]", "", "outside calloutneedle.", ""].join("\r\n");
  const lines = text.split("\r\n"), a = lines.indexOf("> [!note]+ Outer λ"), nested = lines.indexOf("> > [!tip]- Nested tip"), b = lines.indexOf("> [!warning]- Separate warning");
  const bytes = Buffer.from("\ufeff" + text), otherBytes = Buffer.from("\ufeff# Other callout workflow\r\n"), embedBytes = Buffer.from("\ufeff> [!tip]- Embedded default\r\n> calloutneedle embedded.\r\n");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), localRoot = await evaluate("app.vault.rootPath"), originalProfile = await evaluate(`app.loadLocalStorage(${q(key)})`);
  const configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath), config = { ...JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, "")), markdownAutosave: false };
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" }); await writeFile(join(directory, other), otherBytes, { flag: "wx" }); await writeFile(join(directory, embedded), embedBytes, { flag: "wx" });
  let stage = "trusted native summary activation";
  try {
    await writeFile(configPath, encode(config));
    await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "Callout history Ω" }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await reading(tools, path); await wait(`${root}.querySelector('.markdown-embed-content.markdown-preview-view details.callout')`, "embedded callout has independent original rendering");
    const initial = await evaluate(invoke(state)); assert.equal(initial.callouts.length, 3); assert.equal(initial.embeddedControls, 0); assert.deepEqual(initial.rawDetailsOpen, [false]);
    await isOpen(tools, a, true); await isOpen(tools, nested, false); await isOpen(tools, b, false);
    await evaluate(`(()=>{const r=${root},p=globalThis.__readingCalloutProbe={events:[]};p.retained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection,section:r.firstElementChild,nodes:[...r.querySelectorAll('details.callout,summary.callout-title,.callout-content')],embed:r.querySelector('.markdown-embed-content')};p.event=e=>{if(e.target.closest('[data-reading-callout-toggle]'))p.events.push({trusted:e.isTrusted,detail:e.detail})};r.addEventListener('click',p.event,true)})()`);
    await pointer(tools, nested); await keyboard(tools, b, true); await keyboard(tools, nested); await pointer(tools, a);
    const intended = await assertRemembered(tools, path, [a, nested]);
    await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, true);
    report.readingCalloutEvents = await evaluate("__readingCalloutProbe.events"); assert.equal(report.readingCalloutEvents.length, 4); assert.ok(report.readingCalloutEvents.every(event => event.trusted));
    assert.equal(await evaluate(`(()=>{const r=${root},s=__readingCalloutProbe.retained;return app.editor===s.editor&&app.editor.cm===s.cm&&app.editor.cm.state.doc===s.doc&&app.editor.cm.state.selection.eq(s.selection)&&r.firstElementChild===s.section&&s.nodes.every(node=>r.contains(node))&&r.querySelector('.markdown-embed-content')===s.embed})()`), true);
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(configPath), encode(config)); await capture?.("reading-callouts-explicit-intent");
    pass(report, "Trusted pointer, Enter and Space native summaries persist complete explicit callout intent, including opening a Markdown-minus default. Original rendered/embedded nodes, hidden Source document/selection/history and exact BOM/CRLF/Unicode note/configuration bytes remain intact.");

    stage = "reread and temporary navigation reveal";
    await evaluate(`app.openFile(${q(other)})`);
    await reading(tools, path); await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, true); assert.deepEqual(await evaluate(invoke(remembered, path)), intended);
    await tools.click(marker + ' a[data-slopsidian-link="Callouts#Nested heading"]');
    await wait(`!app.workspace.isChangingFiles&&app.editor.getCursor().line===${lines.indexOf("> ### Nested heading")}&&${root}.querySelector('[data-source-line="${lines.indexOf("> ### Nested heading")}"]')?.checkVisibility()`, "callout heading navigation reaches its exact caret and visible owner");
    await installed(tools, path); await isOpen(tools, a, true); await isOpen(tools, nested, false);
    assert.deepEqual(await evaluate(invoke(remembered, path)), intended);
    await tools.click(marker + ' a[data-slopsidian-link="Callouts#^callout-deep"]');
    const blockLine = await evaluate(`app.metadataCache.getDocument(${q(path)}).cache.blocks["callout-deep"].position.start.line`);
    assert.equal(blockLine, nested, "the nested paragraph owner begins at its callout directive");
    await wait(`!app.workspace.isChangingFiles&&app.editor.getCursor().line===${blockLine}&&${root}.querySelector('[data-reading-callout-toggle="${nested}"]')?.parentElement.open&&${root}.querySelector('[data-source-line="${blockLine}"]')?.checkVisibility()`, "nested callout block navigation reaches its exact metadata caret and visible owner");
    await installed(tools, path); await isOpen(tools, a, true); await isOpen(tools, nested, true);
    assert.deepEqual(await evaluate(invoke(remembered, path)), intended);
    await pointer(tools, b); const closed = await assertRemembered(tools, path, [a, nested, b]);
    await evaluate(`app.openFile(${q(other)})`); await reading(tools, path);
    await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, false);
    pass(report, "Rereading restores explicit open and closed defaults. Actual heading and nested block links temporarily reveal only owning callout bodies, and a later explicit sibling choice retains the original collapsed intent of those temporarily opened ancestors.");

    stage = "Find indexes closed captured bodies without changing intent";
    await find(tools, "calloutneedle");
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchCount`), "5");
    await isOpen(tools, a, true); await isOpen(tools, nested, true); await isOpen(tools, b, false);
    await tools.click(panel + ' button[name="next"]'); await tools.click(panel + ' button[name="next"]');
    await wait(`document.querySelector(${q(panel)}).dataset.readingSearchActive==="3"`, "Find stays on the third result after asynchronous details toggle events");
    await isOpen(tools, b, true); assert.deepEqual(await evaluate(invoke(remembered, path)), closed);
    assert.deepEqual((await evaluate(invoke(state))).rawDetailsOpen, [false]); await capture?.("reading-callouts-find-reveal"); await closeFind(tools);
    pass(report, "Reading Find includes closed captured callout bodies and reveals nested ancestors/independent owners when their actual result is selected. Asynchronous details toggles do not reset navigation. Ordinary closed HTML details and embedded note text remain excluded, and local fold intent is unchanged.");

    stage = "source identity and programmatic refusal";
    await evaluate(`(()=>{const summary=document.querySelector(${q(selector(a))});summary.parentElement.open=false;summary.parentElement.open=true;summary.click()})()`);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); assert.deepEqual(await evaluate(invoke(remembered, path)), closed);
    await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "Unsaved source identity λ" });
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("preview",false)'); await installed(tools, path);
    await isOpen(tools, a, true); await isOpen(tools, nested, false); await isOpen(tools, b, false); assert.deepEqual(await evaluate(invoke(remembered, path)), closed);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.undo();app.workspace.activeLeaf.view.setEditingMode("preview",false)'); await installed(tools, path);
    await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, false);
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(directory, path)), bytes);
    const changed = text.replace("Outer λ", "Other λ"); assert.equal(changed.length, text.length);
    await writeFile(join(directory, path), Buffer.from("\ufeff" + changed)); await evaluate("app.vault.refresh()"); await wait(`app.editor.getValue()===${q(changed)}`, "physical same-length source change reaches the shared session"); await installed(tools, path);
    await isOpen(tools, a, true); await isOpen(tools, nested, false); await isOpen(tools, b, false); assert.deepEqual(await evaluate(invoke(remembered, path)), closed);
    await writeFile(join(directory, path), bytes); await evaluate("app.vault.refresh()"); await wait(`app.editor.getValue()===${q(text)}`, "exact source identity restored"); await installed(tools, path); await isOpen(tools, a, false);
    pass(report, "Programmatic open/toggle events and .click() cannot persist intent. Unsaved editor changes and physical same-length source replacements refuse prior preferences; Undo or exact-source restoration restores them without saving drafts or rewriting disk bytes.");

    stage = "corrupt or denied profile";
    const fullProfile = await evaluate(`app.loadLocalStorage(${q(key)})`);
    await evaluate(`app.saveLocalStorage(${q(key)},{version:1,records:[{...${q(closed)},value:[${a},${a}]}]})`);
    await evaluate(`(async()=>{await app.openFile(${q(other)});await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false)})()`); await installed(tools, path);
    await isOpen(tools, a, true); await isOpen(tools, nested, false); await isOpen(tools, b, false);
    await evaluate(`app.saveLocalStorage(${q(key)},${q(fullProfile)})`); await evaluate(`(async()=>{await app.openFile(${q(other)});await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false)})()`); await installed(tools, path);
    await evaluate(`(()=>{globalThis.__readingCalloutSave=app.saveLocalStorage;app.saveLocalStorage=function(name,value){if(name===${q(key)})throw Error("Expected denied callout fold profile");return __readingCalloutSave.call(this,name,value)}})()`);
    try { await pointer(tools, a); await isOpen(tools, a, true); assert.deepEqual(await evaluate(invoke(remembered, path)), closed); }
    finally { await evaluate("app.saveLocalStorage=__readingCalloutSave;delete globalThis.__readingCalloutSave"); }
    await evaluate(`(async()=>{await app.openFile(${q(other)});await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false)})()`); await installed(tools, path); await isOpen(tools, a, false);
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, embedded)), embedBytes); assert.deepEqual(await readFile(configPath), encode(config));
    pass(report, "Malformed profile snapshots fall back to the original Markdown +/- defaults. A denied profile write leaves actual callout folding usable and retains prior saved intent, source, configuration and embedded note bytes.");

    stage = "fresh document restoration";
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await installed(tools, path);
    await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, false); assert.deepEqual(await evaluate(invoke(remembered, path)), closed);
    await keyboard(tools, a); await keyboard(tools, a); await isOpen(tools, a, false); await capture?.("reading-callouts-restored");
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, other)), otherBytes); assert.deepEqual(await readFile(configPath), encode(config));
    report.readingCallouts = { trustedPointerEnterSpace: true, minusExpansionPersisted: true, originalDomAndSourceHistory: true, exactBomCrLfBytes: true, nestedAndIndependentOwners: true, reread: true, temporaryHeadingAndBlockReveal: true, intentSurvivesLaterSiblingAction: true, findClosedCallouts: true, stableAsyncToggleNavigation: true, rawDetailsAndEmbedsExcluded: true, programmaticRefusal: true, dirtyAndPhysicalSourceIdentity: true, corruptProfileFallback: true, deniedStorageStillFolds: true, freshDocumentRestore: true, profileOnly: true };
    pass(report, "A full native restart or fresh browser document/reconnection restores nested callout intent with immediately usable native summary keys. Exact source/configuration bytes survive; all preferences stay in the local profile.");
  } catch (error) {
    try { report.readingCalloutsFailure = { stage, ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),source:app.editor.getValue(),folds:${invoke(state)},profile:${invoke(remembered, path)}}))()`) }; await capture?.("reading-callouts-precleanup-failure"); } catch { report.readingCalloutsFailure ??= { stage }; }
    throw error;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === localRoot) {
      await closeFind(tools); await evaluate("(()=>{if(globalThis.__readingCalloutSave){app.saveLocalStorage=__readingCalloutSave;delete globalThis.__readingCalloutSave}const p=globalThis.__readingCalloutProbe;if(p)for(const r of document.querySelectorAll('[data-reading-callouts-probe]'))r.removeEventListener('click',p.event,true);delete globalThis.__readingCalloutProbe;for(const r of document.querySelectorAll('[data-reading-callouts-probe]'))delete r.dataset.readingCalloutsProbe})()");
      await writeFile(join(directory, path), bytes); await writeFile(configPath, originalConfig);
      await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();app.saveLocalStorage(${q(key)},${q(originalProfile)})})()`);
    }
  }
}

export const readingCalloutReadOnlyFixture = { sourceAddition: ["", "# Cached callout controls", "", "> [!note]+ Cached outer λ", "> cachedcalloutneedle outer body.", ">", "> > [!tip]- Cached nested", "> > cachedcalloutneedle inner body 😀", "", "> [!warning]- Cached separate", "> cachedcalloutneedle separate body.", ""].join("\r\n") };

/** Parent audits genuine cached blobs and zero API/raw calls through local return. */
export async function checkReadingCalloutsReadOnly(tools) {
  const { evaluate, wait, command, afterReload, report, capture } = tools, path = "Read only.md";
  assert.equal(await evaluate("app.vault.readOnly"), true); await reading(tools, path);
  const cachedRoot = await evaluate("app.vault.rootPath"), [repository, ref, folder] = JSON.parse(decodeURIComponent(cachedRoot.slice("github-vault:".length)));
  const text = await evaluate("app.editor.getValue()"), beforeProfile = await evaluate(`app.loadLocalStorage(${q(key)})`), beforeConfig = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  const lines = text.split(/\r\n|\n|\r/), a = lines.indexOf("> [!note]+ Cached outer λ"), nested = lines.indexOf("> > [!tip]- Cached nested"), b = lines.indexOf("> [!warning]- Cached separate");
  assert.ok(a >= 0 && nested > a && b > nested);
  try {
    await pointer(tools, nested); await keyboard(tools, b, true); await keyboard(tools, nested); await pointer(tools, a);
    const intended = await assertRemembered(tools, path, [a, nested]); await isOpen(tools, b, true);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.workspace.activeLeaf.view.setEditingMode("preview",false)'); await installed(tools, path);
    await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, true);
    await find(tools, "cachedcalloutneedle"); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchCount`), "3");
    await isOpen(tools, a, true); assert.deepEqual(await evaluate(invoke(remembered, path)), intended); await closeFind(tools);
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeConfig);
    assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
    pass(report, "A genuine cache-only read-only vault permits trusted callout keys/pointers and exact-source local preferences. Rereading restores them and Find temporarily reveals captured bodies without changing cached text/configuration or making GitHub API/raw calls.");
    await evaluate("app.workspace.flushLayout()"); await command("Page.reload"); await afterReload({ cachedRoot });
    await evaluate(`app.githubVaults.open(${q({ url: repository, ref, folder, cached: true })})`); await wait(`app.vault.rootPath===${q(cachedRoot)}&&!app.changingVault`, "fresh document reopens the same actual cached vault"); await reading(tools, path);
    await isOpen(tools, a, false); await isOpen(tools, nested, false); await isOpen(tools, b, true); assert.deepEqual(await evaluate(invoke(remembered, path)), intended);
    await keyboard(tools, a); await keyboard(tools, a); await capture?.("reading-callouts-readonly");
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeConfig);
    report.readingCalloutsReadOnly = { genuineCacheOnly: true, trustedPointerAndKeys: true, exactSourceProfileOnly: true, temporaryFindReveal: true, rereadAndFreshDocumentRestore: true, sourceAndConfigExact: true };
    pass(report, "A fresh document restores the same cached callout choices with usable summary controls; the parent retains exact cached blobs and zero API/raw counters through returning to the local vault.");
  } catch (error) {
    try { report.readingCalloutsReadOnlyFailure = { ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,readOnly:app.vault.readOnly,folds:${invoke(state)},profile:${invoke(remembered, path)}}))()`) }; await capture?.("reading-callouts-readonly-precleanup-failure"); } catch { /* Preserve first failure. */ }
    throw error;
  } finally {
    await closeFind(tools); await evaluate(`app.saveLocalStorage(${q(key)},${q(beforeProfile)});app.workspace.activeLeaf.view.setEditingMode("source",false)`);
    assert.equal(await evaluate("app.editor.getValue()"), text);
  }
}
