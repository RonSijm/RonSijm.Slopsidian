import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const entry = "[data-spelling-management-entry]";
const manage = "[data-spelling-management-open]";
const dialog = "[data-spelling-management-dialog]";
const languageFilter = dialog + " [data-spelling-language-filter]";
const applyLanguages = dialog + " [data-spelling-languages-apply]";
const wordFilter = dialog + " [data-spelling-word-filter]";
const wordInput = dialog + " [data-spelling-word-input]";
const addWord = dialog + " [data-spelling-word-add]";
const nativeHost = 'typeof require==="function"&&Boolean(require("electron").ipcRenderer)';
const state = 'require("electron").ipcRenderer.invoke("slopsidian:spellcheck","state",{})';
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };

async function fill({ click, press, command }, selector, value) {
  await click(selector); await press("a", "KeyA", 65, 2);
  if (value) await command("Input.insertText", { text: value }); else await press("Backspace", "Backspace", 8);
}
async function openSettings({ evaluate, click, wait }) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) await click("#open-settings");
  await click("#editor-settings-tab");
  await wait(`(()=>{const button=document.querySelector(${q(manage)});return Boolean(button?.isConnected&&button.checkVisibility()&&button.closest("#editor-settings-host")&&button.closest(${q(entry)}))})()`, "visible owned spelling management entry");
}
async function closeManager({ evaluate, click, wait }) {
  if (await evaluate(`Boolean(document.querySelector(${q(dialog)}))`)) await click(dialog + " .modal-close-button");
  await wait(`!document.querySelector(${q(dialog)})`, "spelling manager closed");
}
async function closeSettings(tools) {
  await closeManager(tools);
  if (await tools.evaluate('document.querySelector("#settings-dialog").open')) await tools.click(".settings-close");
  await tools.wait('!document.querySelector("#settings-dialog").open', "Editor settings closed after native controls drain");
}
async function openManager(tools, reentrant = false) {
  await openSettings(tools);
  if (reentrant) await tools.evaluate(`(()=>{const button=document.querySelector(${q(manage)});button.click();button.click()})()`);
  else await tools.click(manage);
  await tools.wait(`document.querySelector(${q(dialog)})?.dataset.spellingCanSetLanguages==="true"&&!document.querySelector(${q(dialog + " [data-spelling-management-reload]")})?.disabled`, "current native language and dictionary controls loaded");
  assert.equal(await tools.evaluate(`document.querySelectorAll(${q(dialog)}).length`), 1, "reentrant Manage actions own one modal");
}

/** Read native words only in the owned renderer; return counts/types/digests, never contents. */
async function nativeSummary({ evaluate }) {
  return evaluate(`(async()=>{const ipc=require("electron").ipcRenderer;try{const data=await ipc.invoke("slopsidian:spellcheck","management/read",{});return{languages:data.languages,supported:data.supported,count:data.words.length,allWordsAreStrings:data.words.every(word=>typeof word==="string"),dictionarySha256:require("node:crypto").createHash("sha256").update(JSON.stringify(data.words)).digest("hex"),canSetLanguages:data.canSetLanguages,canManageWords:data.canManageWords,osSharedDictionary:data.osSharedDictionary}}finally{await ipc.invoke("slopsidian:spellcheck","management/release",{})}})()`);
}
async function chooseLanguages(tools, languages) {
  await fill(tools, languageFilter, "");
  const controls = await tools.evaluate(`Array.from(document.querySelectorAll(${q(dialog + " [data-spelling-language]")})).map(control=>({code:control.dataset.spellingLanguage,checked:control.checked}))`);
  // Rebuild the draft in its original priority order, which may differ from the
  // alphabetic display order of supported-language checkboxes.
  for (const control of controls.filter(control => control.checked)) await tools.click(dialog + ` [data-spelling-language=${q(control.code)}]`);
  for (const code of languages) await tools.click(dialog + ` [data-spelling-language=${q(code)}]`);
  if (!await tools.evaluate(`document.querySelector(${q(applyLanguages)}).disabled`)) await tools.click(applyLanguages);
  await tools.wait(`(async()=>JSON.stringify((await ${state}).languages)===${q(JSON.stringify(languages))}&&!document.querySelector(${q(dialog + " [data-spelling-management-reload]")})?.disabled)()`, "explicit native language choice accepted");
}
async function reviewWithoutWordWrites(tools, phase) {
  // Electron mirrors word additions/removals into the Windows shared dictionary.
  // Native acceptance deliberately never invokes those mutations, even in a smoke profile.
  const marker = "slopsidianownedreview" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  await fill(tools, wordFilter, marker);
  assert.equal(await tools.evaluate(`document.querySelector(${q(dialog)})?.dataset.spellingCanManageWords`), "true");
  assert.equal(await tools.evaluate(`document.querySelector(${q(dialog + " [data-spelling-word-list]")}).querySelectorAll("button").length`), 0, "unique fixture filter reveals no unrelated custom words");
  assert.equal(await tools.evaluate(`document.querySelector(${q(dialog + " [data-spelling-word-list]")}).textContent.includes("No matching custom words")`), true);
  assert.equal(await tools.evaluate(`document.querySelector(${q(dialog + " [data-spelling-os-boundary]")}).textContent.includes("operating system dictionary")`), true);
  await fill(tools, wordInput, "invalid word");
  assert.equal(await tools.evaluate(`document.querySelector(${q(addWord)}).disabled`), true, "invalid new words cannot dispatch a native write");
  await tools.capture?.(phase);
}
async function checkClosedHeldRead(tools) {
  await closeManager(tools);
  await tools.evaluate(`(()=>{const ipc=require("electron").ipcRenderer;globalThis.spellingManagementInvokeBefore=ipc.invoke;globalThis.spellingManagementReadHeld=false;ipc.invoke=async function(channel,operation,...args){const result=await spellingManagementInvokeBefore.call(this,channel,operation,...args);if(channel==="slopsidian:spellcheck"&&operation==="management/read"&&!spellingManagementReadHeld){spellingManagementReadHeld=true;await new Promise(resolve=>{globalThis.releaseSpellingManagementRead=resolve})}return result}})()`);
  try {
    await tools.click(manage); await tools.wait("globalThis.spellingManagementReadHeld===true", "real native dictionary review reply held after host completion");
    await tools.evaluate(`globalThis.spellingManagementClosedModal=document.querySelector(${q(dialog)});true`);
    await closeManager(tools);
    await tools.evaluate("(async()=>{releaseSpellingManagementRead();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))})()");
    assert.equal(await tools.evaluate("!spellingManagementClosedModal.isConnected&&spellingManagementClosedModal.dataset.spellingManagedWords===undefined"), true, "a closed manager never adopts a held native read or revives its controls");
  } finally {
    await tools.evaluate('(()=>{globalThis.releaseSpellingManagementRead?.();require("electron").ipcRenderer.invoke=spellingManagementInvokeBefore;delete globalThis.spellingManagementInvokeBefore;delete globalThis.spellingManagementReadHeld;delete globalThis.releaseSpellingManagementRead;delete globalThis.spellingManagementClosedModal})()');
  }
}
async function browserBoundary(tools, phase) {
  await openSettings(tools);
  await tools.wait(`(()=>{const row=document.querySelector(${q(entry)}),description=row?.querySelector(".setting-item-description");return Boolean(row?.checkVisibility()&&description?.textContent.includes("managed by your browser"))})()`, "visible browser-managed spelling guidance");
  assert.equal(await tools.evaluate(`document.querySelector(${q(manage)}).disabled`), true);
  assert.equal(await tools.evaluate(`document.querySelector(${q(entry)}).textContent.includes("managed by your browser")`), true);
  assert.equal(await tools.evaluate(`Boolean(document.querySelector(${q(dialog)}))`), false);
  await tools.capture?.(phase); await closeSettings(tools);
}

/** Preserve the row before any finally block closes settings or changes layout. */
async function preserveFailure(tools, phase, error) {
  let ui;
  try {
    ui = await tools.evaluate(`(()=>{const row=document.querySelector(${q(entry)}),button=document.querySelector(${q(manage)});return{settingsOpen:Boolean(document.querySelector("#settings-dialog")?.open),entryCount:document.querySelectorAll(${q(entry)}).length,entryText:row?.textContent??null,descriptionText:row?.querySelector(".setting-item-description")?.textContent??null,entryVisible:row?.checkVisibility()??false,buttonDisabled:button?.disabled??null,buttonVisible:button?.checkVisibility()??false,nativeManagerOpen:Boolean(document.querySelector(${q(dialog)}))}})()`);
  } catch (failure) { ui = { unavailable: String(failure) }; }
  const diagnostic = { phase, reason: error instanceof Error ? error.message : String(error), ui };
  tools.report.spellingManagementFailure = diagnostic; console.error("SPELLING_MANAGEMENT_FAILURE " + JSON.stringify(diagnostic));
  if (tools.evidenceDirectory) {
    try { await mkdir(tools.evidenceDirectory, { recursive: true }); await writeFile(join(tools.evidenceDirectory, "editor-workflows-spelling-management-" + phase + "-failure.json"), JSON.stringify(diagnostic, null, 2) + "\n"); }
    catch (failure) { diagnostic.artifactError = String(failure); }
  }
  try { await tools.capture?.("spelling-management-" + phase + "-failure"); } catch (failure) { diagnostic.captureError = String(failure); }
}

/** Real language persistence/review; custom-word mutation lifecycle is session-double unit coverage only. */
export async function checkSpellcheckManagement(tools) {
  const { directory, evaluate, command, wait, report, restart, afterReload, getNativePid } = tools;
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), configPath = join(directory, ".obsidian", "app.json");
  const config = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const path = "Spelling management/Preferences.md", original = "# Spelling preferences λ\r\n\r\nRetain every note byte and the editor history.\r\n", bytes = Buffer.from("\ufeff" + original);
  await mkdir(join(directory, "Spelling management"), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" });
  let originalLanguages = null, before = null;
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(2,0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "History " }); await evaluate("app.editor.undo();app.editor.setSelection({line:2,ch:0},{line:2,ch:6});globalThis.spellingManagementRetained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection};true");
    assert.equal(await evaluate("app.editor.getValue()"), original);
    if (!await evaluate(nativeHost)) {
      await browserBoundary(tools, "spelling-management-browser-boundary");
      assert.equal(await evaluate("app.editor===spellingManagementRetained.editor&&app.editor.cm.state.doc===spellingManagementRetained.doc&&app.editor.cm.state.selection.eq(spellingManagementRetained.selection)"), true);
      report.editorWorkflows = { ...(report.editorWorkflows ?? {}), spellingManagement: { host: "browser", browserDictionaryRetained: true, nativeControlsDisabled: true } };
      pass(report, "Browser Editor settings clearly retain browser-managed spelling languages/custom words and disable native management without changing the retained editor, selection or source.");
    } else {
      assert.equal(typeof restart, "function", "native language persistence requires a full owned Electron restart");
      assert.equal(typeof getNativePid, "function"); const originalPid = getNativePid();
      before = await nativeSummary(tools); originalLanguages = before.languages;
      assert.ok(before.languages.length > 0 && before.languages.length <= 8); assert.equal(before.allWordsAreStrings, true); assert.equal(before.canSetLanguages, true); assert.equal(before.canManageWords, true); assert.equal(before.osSharedDictionary, true);
      const alternate = before.supported.find(code => code === "en-GB" && !before.languages.includes(code)) ?? before.supported.find(code => !before.languages.includes(code)); assert.equal(typeof alternate, "string");
      await openManager(tools, true); await reviewWithoutWordWrites(tools, "spelling-management-filtered");
      await chooseLanguages(tools, [alternate]);
      assert.equal(await evaluate("app.editor===spellingManagementRetained.editor&&app.editor.cm===spellingManagementRetained.cm&&app.editor.cm.state.doc===spellingManagementRetained.doc&&app.editor.cm.state.selection.eq(spellingManagementRetained.selection)"), true);
      await closeManager(tools); await checkClosedHeldRead(tools); await closeSettings(tools);
      await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), original.replace("Retain", "History Retain")); await evaluate("app.editor.undo();app.saveAll()");
      assert.deepEqual(await readFile(join(directory, path)), bytes);
      pass(report, "Native Editor controls filter real supported languages, explicitly apply an app-profile choice and review only a nonexistent fixture word prefix; invalid words stay disabled, simultaneous Manage actions own one dialog, closing discards a held real read, and retained note history/selection/BOM/CRLF survive.");
      await evaluate("app.workspace.flushLayout()"); await restart(); await afterReload();
      assert.notEqual(getNativePid(), originalPid, "language persistence uses a replacement native process");
      await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.changingVault`, "spelling management source restored after full restart");
      assert.deepEqual(await evaluate(`(async()=>(await ${state}).languages)()`), [alternate]);
      await openManager(tools); await reviewWithoutWordWrites(tools, "spelling-management-restarted-filtered"); await chooseLanguages(tools, originalLanguages); await closeSettings(tools);
      const after = await nativeSummary(tools); assert.deepEqual(after.languages, originalLanguages); assert.equal(after.count, before.count); assert.equal(after.dictionarySha256, before.dictionarySha256);
      report.editorWorkflows = { ...(report.editorWorkflows ?? {}), spellingManagement: { host: "electron", nativeLanguageChoiceAndFullRestart: true, originalLanguagesRestored: true, nativeDictionaryReview: true, nativeDictionaryCount: after.count, nativeDictionarySha256: after.dictionarySha256, nativeWordMutationAcceptance: "Not executed: Electron also changes the Windows shared dictionary. Add/remove lifecycle is covered by explicit in-memory session-double unit tests." } };
      pass(report, "A full owned Electron restart restores the explicitly saved language choice; restoring the original languages keeps the real dictionary count/digest and every vault app.json/note byte exact. Native custom-word additions/removals are deliberately not executed; their lifecycle is covered with explicit in-memory session doubles.");
    }
    assert.deepEqual(await readFile(join(directory, path)), bytes);
    const afterConfig = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; }); assert.deepEqual(afterConfig, config);
  } catch (error) {
    await preserveFailure(tools, "writable", error); throw error;
  } finally {
    await closeSettings(tools);
    if (originalLanguages && await evaluate(nativeHost)) {
      const actual = await evaluate(`(async()=>(await ${state}).languages)()`);
      if (JSON.stringify(actual) !== JSON.stringify(originalLanguages)) { await openManager(tools); await chooseLanguages(tools, originalLanguages); await closeSettings(tools); }
    }
    await evaluate(`(async()=>{delete globalThis.spellingManagementRetained;await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** The parent owns the cache-only mount and verifies every cached blob plus zero network calls. */
export async function checkSpellcheckManagementReadOnly(tools) {
  const { evaluate, report } = tools; assert.equal(await evaluate("app.vault.readOnly"), true);
  const original = await evaluate("app.editor.getValue()"), config = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  await evaluate("globalThis.spellingManagementReadOnlyRetained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection};true");
  let before = null;
  try {
    if (!await evaluate(nativeHost)) {
      await browserBoundary(tools, "spelling-management-readonly-browser-boundary");
    } else {
      before = await nativeSummary(tools); await openManager(tools); await reviewWithoutWordWrites(tools, "spelling-management-readonly-filtered");
      const alternate = before.supported.find(code => !before.languages.includes(code)); assert.equal(typeof alternate, "string");
      await chooseLanguages(tools, [alternate]); await chooseLanguages(tools, before.languages); await closeSettings(tools);
      const after = await nativeSummary(tools); assert.deepEqual(after.languages, before.languages); assert.equal(after.count, before.count); assert.equal(after.dictionarySha256, before.dictionarySha256);
    }
    assert.equal(await evaluate("app.editor.getValue()"), original);
    assert.equal(await evaluate("app.editor===spellingManagementReadOnlyRetained.editor&&app.editor.cm===spellingManagementReadOnlyRetained.cm&&app.editor.cm.state.doc===spellingManagementReadOnlyRetained.doc&&app.editor.cm.state.selection.eq(spellingManagementReadOnlyRetained.selection)"), true);
    assert.equal(await evaluate('app.editor.cm.contentDOM.getAttribute("spellcheck")'), "false");
    assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), config);
    pass(report, "A genuine cache-only read-only vault retains the same source/editor/selection and unchanged vault configuration while native profile languages can be applied/restored independently and real dictionary contents remain unchanged; browsers retain their host-managed boundary.");
  } catch (error) {
    await preserveFailure(tools, "readonly", error); throw error;
  } finally {
    await closeSettings(tools);
    if (before) {
      const actual = await evaluate(`(async()=>(await ${state}).languages)()`);
      if (JSON.stringify(actual) !== JSON.stringify(before.languages)) { await openManager(tools); await chooseLanguages(tools, before.languages); await closeSettings(tools); }
    }
    await evaluate("delete globalThis.spellingManagementReadOnlyRetained");
  }
}
