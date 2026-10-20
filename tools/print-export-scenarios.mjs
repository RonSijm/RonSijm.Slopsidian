import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dialog = '[data-print-export-dialog="true"]';
const documentSelector = '[data-print-export-document="true"]';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const q = JSON.stringify;

async function capturePrintFailure({ evaluate, report, capture, directory }, error, path) {
  const diagnostic = report.printExportFailure = { error: String(error?.stack ?? error), capturedAt: new Date().toISOString() };
  try {
    diagnostic.state = await evaluate(`(()=>{const leaf=app.workspace.activeLeaf,view=leaf?.view,editor=view?.editor,root=document.querySelector(${q(documentSelector)}),modal=document.querySelector(${q(dialog)});return {vaultRoot:app.vault.rootPath,readOnly:app.vault.readOnly,changingVault:app.changingVault,changingFiles:app.workspace.isChangingFiles,activeLeaf:leaf?.id,viewType:view?.getViewType?.(),file:view?.file?.path,mode:view?.getMode?.(),editingMode:view?.getEditingMode?.(),sessionRoot:view?.session?.originRoot,sessionFile:view?.session?.document?.file?.path,sessionVersion:view?.session?.document?.version,sessionText:view?.session?.text,editorText:editor?.getValue?.(),selection:editor?{from:editor.getCursor("from"),to:editor.getCursor("to"),head:editor.getCursor()}:null,activeEditorFile:app.workspace.activeEditor?.file?.path,focusedTag:document.activeElement?.tagName,printActive:document.body.dataset.printExportActive,preview:root?{job:root.dataset.printExportJob,state:root.dataset.printExportState,text:root.textContent,parent:root.parentElement?.className}:null,modal:modal?{busy:modal.getAttribute("aria-busy"),status:modal.querySelector('[data-print-export-status]')?.textContent,buttons:[...modal.querySelectorAll('[data-print-export-action]')].map(button=>({action:button.dataset.printExportAction,disabled:button.disabled,hidden:button.hidden}))}:null}})()`);
    if (path && directory) { const bytes = await readFile(join(directory, path)); diagnostic.disk = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), tail: bytes.subarray(-256).toString("utf8") }; }
  } catch (failure) { diagnostic.captureError = String(failure?.stack ?? failure); }
  try { await capture?.("print-export-failure-before-cleanup"); } catch (failure) { diagnostic.screenshotError = String(failure?.stack ?? failure); }
}

async function openPreview({ evaluate, wait }) {
  assert.equal(await evaluate('app.commands.isRunnable("workspace:export-pdf")'), true);
  await evaluate('app.commands.execute("workspace:export-pdf")');
  await wait(`document.querySelector(${q(documentSelector)})?.dataset.printExportState==="ready"&&!document.querySelector(${q(dialog + ' [data-print-export-action="print"]')})?.disabled`, "complete owned print preview");
}
async function closePreview({ click, wait, evaluate }) {
  await click(dialog + ' [data-print-export-action="close"]');
  await wait(`!document.querySelector(${q(dialog)})&&!document.querySelector(${q(documentSelector)})&&!document.body.hasAttribute("data-print-export-active")`, "print preview cleanup");
  await evaluate("app.prepareLeave()");
}
async function configurePreview({ click, evaluate }) {
  await evaluate(`(()=>{const root=document.querySelector(${q(dialog)});for(const [name,value]of [["pageSize","Letter"],["orientation","landscape"],["margin","minimal"]]){const field=root.querySelector('[data-print-export-option="'+name+'"]');field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}))}})()`);
  await click(dialog + ' [data-print-export-option="includeName"]');
  assert.equal(await evaluate(`document.querySelector(${q(documentSelector + " .print-export-title")}).hidden`), true);
  assert.equal(await evaluate('[...document.head.querySelectorAll("style")].some(style=>style.textContent.includes("size: Letter landscape; margin: 6.35mm"))'), true);
}

export async function nativePicker({ getNativePid, report }, { path, cancel = false }, trigger) {
  assert.equal(typeof getNativePid, "function", "Native PDF acceptance requires the current owned Electron PID");
  const pid = getNativePid();
  const base = ["-NoProfile", "-File", fileURLToPath(new URL("./save-test-pdf.ps1", import.meta.url)), "-BrowserProcessId", String(pid)];
  const args = [...base,
    ...(cancel ? ["-Cancel"] : ["-File", path, "-OutputDirectory", dirname(path)])];
  const picker = spawn("pwsh", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; for (const stream of [picker.stdout, picker.stderr]) { stream.on("data", bytes => { output += bytes; }); }
  const done = once(picker, "exit");
  let primaryCode = null;
  try {
    await trigger(); const [code] = await done; primaryCode = code;
    assert.equal(code, 0, "Owned native Save dialog automation: " + output);
  } catch (error) {
    if (picker.exitCode === null) { picker.kill(); await done.catch(() => {}); }
    const failure = report.printPickerFailure = { code: primaryCode ?? picker.exitCode, pid, output, error: String(error?.stack ?? error) };
    const handle = /PDF_SAVE_DIALOG_HANDLE (\d+)/.exec(output)?.[1];
    // A failed filename/action probe can leave the native modal open. Cancel
    // that same owned dialog before the scenario asks app.prepareLeave to drain.
    const cleanupArgs = [...base, "-Cancel", "-FindTimeoutSeconds", "3", "-CloseTimeoutSeconds", "5", ...(handle ? ["-ExpectedWindowHandle", handle] : [])];
    const cleanup = spawn("pwsh", cleanupArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let cleanupOutput = "", timedOut = false;
    for (const stream of [cleanup.stdout, cleanup.stderr]) { stream.on("data", bytes => { cleanupOutput += bytes; }); }
    const cleanupDone = once(cleanup, "exit");
    const timer = setTimeout(() => { timedOut = true; cleanup.kill(); }, 15_000);
    try { const [code] = await cleanupDone; failure.cancellation = { attempted: true, code, timedOut, output: cleanupOutput, expectedWindowHandle: handle ?? null }; }
    catch (cleanupError) { failure.cancellation = { attempted: true, error: String(cleanupError?.stack ?? cleanupError), timedOut, output: cleanupOutput }; }
    finally { clearTimeout(timer); }
    throw error;
  } finally { if (picker.exitCode === null) { picker.kill(); await done.catch(() => {}); } }
}

/** A bounded invocation fixture checks the actual print-media document, not the OS print UI. */
async function browserPrintInvocation(tools) {
  const { evaluate, command, click, wait } = tools;
  await evaluate(`(()=>{globalThis.__printInvocation={original:window.print};window.print=()=>{const root=document.querySelector('body > [data-print-export-document]');__printInvocation.result={owned:Boolean(root),text:root?.textContent,chrome:root?.querySelector('.workspace,.cm-editor,.modal-button-container')!==null,otherBodyHidden:[...document.body.children].filter(el=>el!==root).every(el=>getComputedStyle(el).display==="none"),width:root?.getBoundingClientRect().width,ready:root?.dataset.printExportState};window.dispatchEvent(new Event("beforeprint"));setTimeout(()=>window.dispatchEvent(new Event("afterprint")),0)}})()`);
  try {
    await command("Emulation.setEmulatedMedia", { media: "print" });
    await click(dialog + ' [data-print-export-action="print"]');
    await wait('Boolean(__printInvocation.result)&&!document.body.hasAttribute("data-print-export-active")', "print-media fixture completion and restoration");
    const result = await evaluate("__printInvocation.result");
    assert.equal(result.owned, true); assert.equal(result.chrome, false); assert.equal(result.otherBodyHidden, true); assert.equal(result.ready, "ready"); assert.ok(result.width > 300);
    return result;
  } finally {
    await command("Emulation.setEmulatedMedia", { media: "" });
    await evaluate("window.print=__printInvocation.original;delete globalThis.__printInvocation");
  }
}

async function heldNativeLeave(tools) {
  const { evaluate, click, wait, report } = tools;
  await evaluate(`(()=>{const api=app.plugins.modules.obsidian;globalThis.__printHeld={released:false,entered:false,leaveDone:false,api};__printHeld.processor=(element,context)=>{if(!element.closest('[data-print-export-document]'))return;const marker=document.createElement('span');marker.dataset.printLifecycleChild='true';marker.textContent='Owned print lifecycle child';element.append(marker);const child=new api.MarkdownRenderChild(marker);child.onunload=()=>{__printHeld.released=true};context.addChild(child)};api.MarkdownPreviewRenderer.registerPostProcessor(__printHeld.processor,10)})()`);
  try {
    await openPreview(tools);
    await wait('Boolean(document.querySelector("[data-print-lifecycle-child]"))', "real print render-child ownership");
    await evaluate(`(()=>{const held=__printHeld,ipc=require("electron").ipcRenderer;held.ipc=ipc;held.original=ipc.invoke;ipc.invoke=function(channel,...args){if(channel==="vault:print-export"){held.entered=true;return new Promise(resolve=>{held.resolve=resolve})}return Reflect.apply(held.original,this,[channel,...args])}})()`);
    await click(dialog + ' [data-print-export-action="pdf"]');
    await wait("__printHeld.entered", "held native print invocation");
    await click(dialog + ' [data-print-export-action="close"]');
    await evaluate("__printHeld.leaving=app.prepareLeave().then(()=>{__printHeld.leaveDone=true});true");
    assert.deepEqual(await evaluate("({released:__printHeld.released,done:__printHeld.leaveDone,root:Boolean(document.querySelector('[data-print-export-document]')),bridge:Boolean(globalThis[Symbol.for('slopsidian.print-export')])})"), { released: false, done: false, root: false, bridge: false });
    await evaluate("__printHeld.resolve({canceled:true});true");
    await wait("__printHeld.leaveDone&&__printHeld.released", "leave drains closed native print work and its render child");
    pass(report, "Closing a preview invalidates its native capability immediately; an explicit held-IPC fixture proves prepareLeave drains the outstanding request before releasing the real owned render child, with no late print surface.");
  } finally {
    await evaluate("(async()=>{const held=globalThis.__printHeld;if(!held)return;held.resolve?.({canceled:true});if(held.ipc)held.ipc.invoke=held.original;await held.leaving;held.api.MarkdownPreviewRenderer.unregisterPostProcessor(held.processor);delete globalThis.__printHeld})()");
  }
}

/** Native exports use the actual Save dialog and Electron PDF generator; browser print UI stays browser-owned. */
export async function checkPrintExport(tools) {
  const { directory, evaluate, command, click, wait, report, capture, evidenceDirectory } = tools;
  const path = "Print export/Export note.md", imagePath = "Print export/Print image.jpg";
  const body = ["---", "title: Export metadata stays hidden", "---", "# EXPORT NOTE SENTINEL", "", "**Bold text** and *emphasis* with Unicode λ 漢字 😀.", "", "| Item | Value |", "| --- | --- |", "| Table row | Exact printable cell |", "", "![Local image](Print%20image.jpg)", "", "$x^2 + y^2 = z^2$", "", "```js", "const printable = 42;", "```", "", "```mermaid", "flowchart LR", "  A[Source note] --> B[Printed note]", "```", "", "Inline reference ^[Printable footnote body with **bold** text].", "", "> [!note] Printed callout", "> Local callout content.", "", '<span onclick="globalThis.printExportInjected=true">Sanitized print text</span>', "", ...Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}: retained source, tables and local rendering reach the PDF without editor controls or workspace chrome. This line verifies pagination and readable flowing text.`), ""].join("\r\n");
  const original = Buffer.from("\ufeff" + body), unsaved = body + "Unsaved export only λ.\r\n";
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  const native = await evaluate('typeof require==="function"&&Boolean(require("electron").ipcRenderer)');
  let failed = false;
  await evaluate("app.saveAll()"); if (autosave) { await evaluate("app.markdownAutosave.setEnabled(false)"); }
  await mkdir(join(directory, "Print export"), { recursive: true });
  await writeFile(join(directory, path), original, { flag: "wx" });
  await writeFile(join(directory, imagePath), await readFile(new URL("./fixtures/web-favicon.jpg", import.meta.url)), { flag: "wx" });
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(app.editor.lastLine(),app.editor.getLine(app.editor.lastLine()).length);app.editor.focus()})()`);
    // Chromium inserts a supplied CR literally before its normalized newline.
    // Send LF; the editor's CRLF document separator supplies the physical convention.
    await command("Page.bringToFront"); await command("Input.insertText", { text: "Unsaved export only λ.\n" });
    await wait(`app.editor.getValue()===${q(unsaved)}`, "actual unsaved print source");
    await openPreview(tools);
    const prepared = await evaluate(`(()=>{const root=document.querySelector(${q(documentSelector)});return {text:root.textContent,table:root.querySelector('td')?.textContent,code:root.querySelector('code.language-js')?.textContent,highlight:root.querySelector('code.language-js')?.dataset.codeHighlighted,math:Boolean(root.querySelector('.katex')),footnotes:root.querySelectorAll('.footnotes li').length,image:[...root.querySelectorAll('img')].some(image=>image.naturalWidth>0&&!image.classList.contains('mermaid-image')),diagram:Boolean(root.querySelector('[data-mermaid-status="ready"] img')),unsafe:Boolean(root.querySelector('[onclick],script')),injected:globalThis.printExportInjected===true}})()`);
    assert.ok(prepared.text.includes("Unsaved export only λ.")); assert.ok(prepared.text.includes("漢字 😀")); assert.equal(prepared.table, "Table row"); assert.equal(prepared.code, "const printable = 42;\n"); assert.equal(prepared.highlight, "javascript");
    assert.equal(prepared.math, true); assert.equal(prepared.footnotes, 1); assert.equal(prepared.image, true); assert.equal(prepared.diagram, true); assert.equal(prepared.unsafe, false); assert.equal(prepared.injected, false);
    assert.equal(await evaluate("app.editor.getValue()"), unsaved); assert.deepEqual(await readFile(join(directory, path)), original);
    if (capture) { await capture("print-preview"); }
    pass(report, "Print preview renders current unsaved Unicode/BOM-CRLF source through the owned Markdown renderer, including a decoded local image, table, highlighted code, math, Mermaid, sanitized HTML and footnotes, without saving or changing the note.");
    await closePreview(tools);
    for (const mode of ["live-preview", "preview"]) {
      await evaluate(mode === "preview" ? 'app.workspace.activeLeaf.view.setMode("preview",false)' : 'app.workspace.activeLeaf.view.setEditingMode("live-preview",false)');
      await openPreview(tools); assert.ok(await evaluate(`document.querySelector(${q(documentSelector)}).textContent.includes("Unsaved export only λ.")`)); await closePreview(tools);
    }
    pass(report, "The same snapshot workflow is available from Source, Live Preview and Reading; closing each preview removes owned print nodes and retains mode, text and exact physical note bytes.");

    await openPreview(tools); await configurePreview(tools);
    if (native) {
      await nativePicker(tools, { cancel: true }, () => click(dialog + ' [data-print-export-action="pdf"]'));
      await wait(`document.querySelector(${q(dialog + " [data-print-export-status]")})?.textContent.includes("canceled")&&!document.body.hasAttribute("data-print-export-active")`, "native PDF Save cancellation");
      assert.equal(await evaluate("app.editor.getValue()"), unsaved); assert.deepEqual(await readFile(join(directory, path)), original);
      assert.equal(typeof evidenceDirectory, "string"); await mkdir(evidenceDirectory, { recursive: true });
      const output = join(evidenceDirectory, "note-authoring-export-" + Date.now() + ".pdf");
      await nativePicker(tools, { path: output }, () => click(dialog + ' [data-print-export-action="pdf"]'));
      await wait(`document.querySelector(${q(dialog + " [data-print-export-status]")})?.dataset.printExportSaved===${q(output)}&&!document.body.hasAttribute("data-print-export-active")`, "real native PDF publication");
      const bytes = await readFile(output); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert.ok(bytes.length > 2000);
      (report.printExports ??= []).push({ path: output, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), options: { pageSize: "Letter", landscape: true, margin: "minimal", includeName: false }, sourceIncludesUnsavedText: true });
      pass(report, "The actual owned native Save dialog cancels without writes and then selects a new destination; Electron generates and saves a real PDF with Letter/landscape/minimal-margin options while source bytes remain unchanged.");
    }
    const printed = await browserPrintInvocation(tools);
    assert.ok(printed.text.includes("EXPORT NOTE SENTINEL")); assert.ok(printed.text.includes("Unsaved export only λ."));
    report.printInvocation = { realPrintMedia: true, ownedDocument: true, chromeHidden: true, invocationFixture: true, physicalBrowserPrintDialog: false };
    pass(report, "A bounded window.print invocation fixture exercises the actual print-media document: only the owned note is visible, all workspace/dialog chrome is hidden, selected page options apply and the preview restores afterward. Physical browser/printer dialogs remain browser-owned and unautomated.");
    await closePreview(tools);

    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)'); await openPreview(tools);
    await evaluate(`globalThis.__heldPrintButton=document.querySelector(${q(dialog + ' [data-print-export-action="print"]')});app.editor.replaceExpected(app.editor.getValue(),0,0,"Stale print probe\\r\\n","input.print-fixture")`);
    await wait(`document.querySelector(${q(documentSelector)})?.dataset.printExportState==="stale"`, "source edit invalidates existing print preview");
    const changed = await evaluate("app.editor.getValue()"); await evaluate("__heldPrintButton.click();delete globalThis.__heldPrintButton");
    assert.equal(await evaluate('document.body.hasAttribute("data-print-export-active")'), false); assert.equal(await evaluate("app.editor.getValue()"), changed);
    await closePreview(tools); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), unsaved);
    pass(report, "A changed source invalidates its prepared preview and held Print control; closing and one Undo recover the exact prior unsaved text without native printing or note writes.");
    if (native) { await heldNativeLeave(tools); }
    await evaluate("app.editor.undo()"); await wait(`app.editor.getValue()===${q(body)}`, "print workflows retain the original typing Undo step");
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), unsaved); await evaluate("app.editor.undo()");
    assert.deepEqual(await readFile(join(directory, path)), original);
  } catch (error) {
    failed = true;
    await capturePrintFailure(tools, error, path); throw error;
  } finally {
    try {
      await evaluate(`(async()=>{document.querySelector(${q(dialog + ' [data-print-export-action="close"]')})?.click();await app.prepareLeave();delete globalThis.__heldPrintButton;delete globalThis.printExportInjected;await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
      if (autosave && !await evaluate("app.markdownAutosave.enabled")) { await evaluate("app.markdownAutosave.setEnabled(true)"); }
    } catch (cleanupError) {
      if (!failed) { throw cleanupError; }
      report.printExportFailure.cleanupError = String(cleanupError?.stack ?? cleanupError);
    }
  }
}

/** Root owns the genuine cache-only mount, request counters and blob audit. */
export async function checkPrintExportReadOnly(tools) {
  const { evaluate, report, capture } = tools;
  try {
    assert.equal(await evaluate("app.vault.readOnly"), true);
    const original = await evaluate("app.editor.getValue()");
    await openPreview(tools);
    assert.equal(await evaluate(`document.querySelector(${q(documentSelector)}).textContent.includes("Cached heading")`), true);
    assert.equal(await evaluate(`document.querySelector(${q(dialog + ' [data-print-export-action="print"]')}).disabled`), false);
    if (capture) { await capture("print-readonly-preview"); }
    await closePreview(tools); assert.equal(await evaluate("app.editor.getValue()"), original);
    pass(report, "A genuine cached read-only Markdown note can prepare and cancel a printable preview with enabled export controls, unchanged source and no vault save; the parent audits zero requests and unchanged cached blobs.");
  } catch (error) { await capturePrintFailure(tools, error); throw error; }
}
