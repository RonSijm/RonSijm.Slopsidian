import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expectErrors } from "./error-log-audit.mjs";
import { createResizeObserverDiagnostic } from "./resize-observer-diagnostic.mjs";
import { join } from "node:path";

/** Enable a core plugin through the real `app.core.setEnabled` path, await its registration, and return an undo that restores only a state this call changed. */
export async function enableCorePlugin({ evaluate, wait }, id) {
  const quoted = JSON.stringify(id);
  const prior = await evaluate(`app.core.isEnabled(${quoted})`);
  if (!prior) {
    await evaluate(`(async()=>{await app.core.setEnabled(${quoted},true);return true})()`);
    await wait(`!app.core.busy&&app.core.isEnabled(${quoted})&&Boolean(app.core.getEnabledPluginById(${quoted}))`, `${id} core plugin ready`);
  }
  return async () => {
    if (prior) { return; }
    await evaluate(`(async()=>{await app.core.setEnabled(${quoted},false);return true})()`);
    await wait(`!app.core.busy&&app.core.isEnabled(${quoted})===false`, `${id} core plugin restored to disabled`);
  };
}

/** Reads the native owner of a Web viewer guest through the smoke-only guarded "inspect" action; exactly one BrowserWindow must hold it. */
// A retained document keeps its revision and a reloaded one bumps it; either is ready once the same Reader, hosted in the view's document, answers a real capture-progress request (matching token, frame source and request id) on its owner window.
// The probe posts through the Reader's own production channel (r.post), so a hidden or disposed Reader (which flushProgress skips) and a timer-only fallback cannot pass.
// Every attempt returns a structured snapshot (each predicate, ownership, revision and the observed message envelopes) and keeps the last one in window.__readerProbeLast.
export function readerProbeExpression(view) {
  return `(async()=>{const r=${view}.reader,s={at:Date.now(),hasReader:!!r,messages:[]};try{if(!r){s.ok=false;return JSON.stringify(s)}
const f=r.frame,doc=f.ownerDocument,win=doc.defaultView;
Object.assign(s,{sameReader:r===window.__webReader,connected:f.isConnected,inViewDocument:doc===${view}.surface.ownerDocument,ownerWindowIsFrameWindow:r.ownerWindow===win,ownerIsMain:r.ownerWindow===window,progressReady:r.progressReady,disposed:r.disposed,visible:f.checkVisibility(),revision:r.documentRevision,ownerOrigin:win.location.origin,frameSandbox:f.getAttribute("sandbox"),hasSrcdoc:!!f.srcdoc,hasContentWindow:!!f.contentWindow});
const source=f.contentWindow;s.parentIsOwner=source?source.parent===r.ownerWindow:null;
s.preconditions=s.sameReader&&s.connected&&s.inViewDocument&&s.ownerWindowIsFrameWindow&&s.progressReady&&!s.disposed&&s.visible&&!!source;
if(!s.preconditions){s.ok=false;return JSON.stringify(s)}
const owner=r.ownerWindow,id=2000000000+(window.__readerProbe=(window.__readerProbe||0)+1);s.request={kind:"capture-progress",requestId:id};let listener,timer;
try{s.acked=await new Promise(resolve=>{listener=event=>{const d=event.data;if(!d||d.channel!=="slopsidian-reader")return;const m={kind:d.kind,requestId:d.requestId,tokenMatch:d.token===r.token,sourceMatch:event.source===source,origin:event.origin};if(s.messages.length<10)s.messages.push(m);if(m.sourceMatch&&m.tokenMatch&&d.kind==="progress"&&d.requestId===id)resolve(true)};owner.addEventListener("message",listener);timer=setTimeout(()=>resolve(false),450);r.post({channel:"slopsidian-reader",token:r.token,kind:"capture-progress",requestId:id})})}
finally{clearTimeout(timer);if(listener)owner.removeEventListener("message",listener)}
s.after={sameReader:r===window.__webReader,connected:f.isConnected,inViewDocument:f.ownerDocument===${view}.surface.ownerDocument,sameWindow:f.contentWindow===source,revisionUnchanged:r.documentRevision===s.revision,disposed:r.disposed};
s.ok=s.acked===true&&s.after.sameReader&&s.after.connected&&s.after.inViewDocument&&s.after.sameWindow&&s.after.revisionUnchanged&&!s.after.disposed;return JSON.stringify(s)}catch(e){s.ok=false;s.error=String(e&&e.message||e);return JSON.stringify(s)}finally{window.__readerProbeLast=JSON.stringify(s)}})()`;
}
export function readerCurrentDocumentReady(view) {
  return `(async()=>JSON.parse(await ${readerProbeExpression(view)}).ok===true)()`;
}export async function readerFailureSnapshot({ evaluate, webPopup, targets, webView }) {
  const settle = async (label, work) => { try { return await work(); } catch (error) { return { unavailable: label, message: String(error?.message ?? error) }; } };
  return {
    lastProbe: await settle("lastProbe", async () => JSON.parse(await evaluate("window.__readerProbeLast||null"))),
    liveProbe: await settle("liveProbe", async () => JSON.parse(await evaluate(readerProbeExpression(webView)))),
    popupFrameTree: await settle("frameTree", async () => (await webPopup.command("Page.getFrameTree")).frameTree),
    popupIframe: await settle("iframe", async () => JSON.parse(await webPopup.evaluate(`JSON.stringify([...document.querySelectorAll("iframe")].map(f=>({sandbox:f.getAttribute("sandbox"),src:f.getAttribute("src"),srcdocLength:f.srcdoc.length,w:f.clientWidth,h:f.clientHeight,connected:f.isConnected,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content??null})))`))),
    // Control: the same request posted from the popout realm (the iframe's actual parent) shows whether the embedded document only accepts its own parent as source.
    popupRealmControl: await settle("popupRealmControl", async () => { const token = await evaluate(`${webView}.reader.token`); return JSON.parse(await webPopup.evaluate(`(async()=>{const f=document.querySelector("iframe"),seen=[];const l=e=>{const d=e.data;if(d&&d.channel==="slopsidian-reader")seen.push({kind:d.kind,requestId:d.requestId,sourceIsFrame:e.source===f.contentWindow})};addEventListener("message",l);f.contentWindow.postMessage({channel:"slopsidian-reader",token:${JSON.stringify(token)},kind:"capture-progress",requestId:2100000001},"*");await new Promise(r=>setTimeout(r,450));removeEventListener("message",l);return JSON.stringify(seen.slice(0,10))})()`)); }),
    targets: await settle("targets", async () => (await targets()).map(item => ({ id: item.id, type: item.type, url: String(item.url).slice(0, 120), title: item.title }))),
  };
}export async function readGuestHost({ evaluate }, view) {
  const raw = await evaluate(`(async()=>JSON.stringify(await ${view}.ipc.invoke("webviewer:request",{id:${view}.id,action:"inspect"})))()`);
  const result = JSON.parse(raw);
  assert.ok(Array.isArray(result.owners) && result.owners.length === 1, "the guest is a child of exactly one BrowserWindow: " + raw);
  return { guestWebContentsId: result.guestWebContentsId, guestUrl: result.guestUrl, mainWindowId: result.mainWindowId, owner: result.owners[0] };
}

export async function checkReaderCreatedInPopout({ evaluate, wait, popup, view }) {
  const selector = '[data-webviewer-action="reader"]';
  await popup.click(selector);
  await wait(`${view}.reader===null&&${view}.contentEl.dataset.webviewerReaderMode==="page"`, "the moved Reader closed in the popout");
  assert.equal(await evaluate("window.__webReader.disposed"), true, "the previous Reader really disposed");
  await popup.click(selector);
  await wait(`${view}.reader!==null&&${view}.reader!==window.__webReader&&${view}.reader.progressReady`, "a new Reader was constructed in the popout");
  await evaluate(`(()=>{window.__webReader=${view}.reader;return true})()`);
  await wait(readerCurrentDocumentReady(view), "the newly constructed popout Reader answered through its production channel");
  const result = JSON.parse(await evaluate(`JSON.stringify((()=>{const r=${view}.reader;return{ownerIsMain:r.ownerWindow===window,ownerMatchesDocument:r.ownerWindow===${view}.surface.ownerDocument.defaultView,ownerOrigin:r.ownerWindow.location.origin,revision:r.documentRevision,progressReady:r.progressReady,hasPort:!!r.port&&typeof r.port.postMessage==="function"}})())`));
  assert.equal(result.ownerIsMain, false);
  assert.equal(result.ownerMatchesDocument, true);
  assert.equal(result.hasPort, true);
  return result;
}

export function editorHistoryExpression(leaf) {
  return `JSON.stringify((()=>{const l=${leaf},c=l.view.editor.cm,m=app.plugins.modules["@codemirror/commands"],s=window.__forcedClose,d=c.dom.ownerDocument;return{text:c.state.doc.toString(),undoDepth:m.undoDepth(c.state),redoDepth:m.redoDepth(c.state),readOnly:c.state.readOnly,editable:c.contentDOM.isContentEditable,cmFocused:c.hasFocus,ownerFocused:d.hasFocus(),activeLeaf:app.workspace.activeLeaf.id,activeElement:d.activeElement?.className??null,mode:l.view.getMode(),sameHistory:s?c.state.field(m.historyField)===s.history:null,composing:c.inputState?.composing??null,lastKeyCode:c.inputState?.lastKeyCode??null,keys:window.__forcedKeys??[],listenerCounts:window.__forcedListenerCounts??null}})())`;
}

// Native/WASM scenario for linked workspace groups and real popout windows. It requires the exclusive
// Windows UI lease and paired final builds with captured coreVerificationInputs.
// `targets()` lists the CDP targets (/json/list) and `connect(target)` is connectWebViewerTarget bound to the runner wait helper; both are required
// because typing, undo, save, menu/modal cancellation and close veto use real key input on the popout page target, not dispatched DOM events.
export async function checkWorkspaceGroupsPopouts({ directory, evaluate, command, wait, afterReload, restart, report, targets, connect, until, mode = "desktop", nativeUserClose, popupPolicy = "allowed" }) {
  assert.ok(typeof targets === "function" && typeof connect === "function", "the runner must supply targets()/connect() so real popout CDP input is used");
  const forcedCloseOnly = process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY === "forced-close";
  assert.ok(!forcedCloseOnly || mode === "desktop", "the forced native-close diagnostic requires the desktop host");
  // Barrier-only diagnostic: record every ResizeObserver per realm (main and the real popout target), reinstall on new documents, and fail loudly if a hook is absent.
  const resizeDiagnostic = process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY === "barrier";
  const diag = createResizeObserverDiagnostic();
  const mainSession = { command, evaluate };
  if (resizeDiagnostic) { await diag.install("main", mainSession); }
  const collectResizeDiagnostic = async () => {
    if (!resizeDiagnostic) { return; }
    await diag.retain("main");
    report.resizeObserverDiagnostic = diag.snapshots;
  };  const folder = "Popout nav", names = ["A", "B", "C"];
  const path = name => folder + "/" + name + ".md";
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const settled = async () => { await evaluate("(async()=>{await app.workspace.whenIdle();return true})()"); await wait("!app.workspace.isChangingLayout&&!app.workspace.isChangingFiles", "workspace settled"); };
  const leafExpr = id => `app.workspace.getLeafById(${JSON.stringify(id)})`;
  const file = id => evaluate(`${leafExpr(id)}.getViewState().state.file`);

  await evaluate("(async()=>{await app.markdownAutosave.setEnabled(false);return true})()");
  await mkdir(join(directory, folder), { recursive: true });
  for (const name of names) { await writeFile(join(directory, path(name)), `# ${name}\n\n${name} body λ\n`); }
  if (resizeDiagnostic) { await diag.retain("main"); }
  await command("Page.reload"); await afterReload();
  if (resizeDiagnostic) { await diag.assertOne("main"); }

  const leaf = (id, name, extra = {}) => ({ id, type: "leaf", state: { type: "markdown", state: { file: path(name), mode: "source", source: true }, ...extra } });
  const main = { id: "pop-main", type: "split", direction: "vertical", children: [
    { id: "pop-tabs", type: "tabs", currentTab: 0, children: [leaf("pop-a", "A"), leaf("pop-b", "B"), leaf("pop-pinned", "C", { pinned: true })] },
  ] };
  await evaluate(`(async()=>{const v=app.workspace.getLayout();v.main=${JSON.stringify(main)};v.active="pop-a";await app.workspace.changeLayout(v)})()`);
  await settled();

  // Linked group: a followed leaf navigates, the pinned member keeps its file, and per-leaf history stays independent.
  await evaluate(`(()=>{app.workspace.linkLeaves([${leafExpr("pop-a")},${leafExpr("pop-b")},${leafExpr("pop-pinned")}]);return true})()`);
  await evaluate(`(async()=>{await ${leafExpr("pop-a")}.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("C"))}))})()`);
  await wait(`${leafExpr("pop-b")}.getViewState().state.file===${JSON.stringify(path("C"))}`, "linked follower navigated");
  assert.equal(await file("pop-pinned"), path("C"));
  const result = await evaluate("JSON.stringify(app.workspace.lastLinkedNavigation)");
  assert.deepEqual(JSON.parse(result).skipped.map(entry => entry.reason), ["pinned"]);
  assert.equal(await evaluate(`${leafExpr("pop-b")}.history.length`), 2);
  pass("linked leaves follow navigation, skip pinned members and keep independent history");

  // Real popout through the command: a second native window hosts the same live leaf and view object.
  const before = await evaluate(`(()=>{const l=${leafExpr("pop-b")};window.__popoutView=l.view;return l.view.getViewType()})()`);
  await evaluate("app.workspace.setActiveLeaf(" + leafExpr("pop-b") + ");app.commands.executeCommandById('workspace:popout-tab')");
  if (mode === "browser") {
    // A scripted command carries no user activation, so a real browser may refuse the popup. That refusal must be explicit and lossless.
    let opened = false;
    try { await wait("app.workspace.windows.length===1&&app.workspace.windows[0].surface&&!app.workspace.windows[0].surface.isClosed()", "browser popup opened"); opened = true; } catch { /* refused */ }
    if (!opened) {
      assert.equal(popupPolicy, "blocked", "the host allows the app's same-origin popouts, so a refusal is a failure and the full popup collection did not run");
      report.popupPolicy = "blocked-control";
      assert.equal(await evaluate("app.workspace.windows.length"), 0, "a refused popup creates no window");
      assert.equal(await evaluate(`${leafExpr("pop-b")}.getRoot()===app.workspace.rootSplit`), true, "the tab stays in the main window");
      const issue = JSON.parse(await evaluate("JSON.stringify(app.workspace.lastPopoutIssue??app.workspace.popoutSupport())"));
      assert.ok(issue && (issue.code || issue.ok === false), "the refusal is explicit: " + JSON.stringify(issue));
      pass("blocked-control only (not the full popup collection): the browser refused the popup explicitly and kept the tab in main (no iframe/CSS fallback)");
      return;
    }
  }  report.popupPolicy ??= mode === "browser" ? "same-origin-app-popouts-allowed" : "native";
  await wait("app.workspace.windows.length===1&&app.workspace.windows[0].surface&&!app.workspace.windows[0].surface.isClosed()", "native popout opened");
  assert.equal(await evaluate(`${leafExpr("pop-b")}.view===window.__popoutView`), true, "the same live view object moved");
  assert.equal(await evaluate(`${leafExpr("pop-b")}.view.containerEl.ownerDocument===app.workspace.windows[0].surface.document`), true);
  assert.equal(await evaluate(`${leafExpr("pop-b")}.getRoot()===app.workspace.windows[0]`), true);
  assert.equal(before, "markdown");
  pass("a real popout window hosts the same live leaf, view and owner");

  const existing = new Set((await targets()).map(item => item.id));
  const popTarget = await (async () => { let found; await until(async () => { found = (await targets()).find(item => item.type === "page" && !existing.has(item.id) && !/^http/.test(item.url) || item.type === "page" && item.url === "about:blank"); return found; }, "popout CDP target"); return found; })();
  const popup = await connect(popTarget, until);
  if (resizeDiagnostic) { await diag.install("popout", popup); }
  const key = async (name, code, vk, modifiers = 0) => {
    await popup.command("Page.bringToFront");
    await popup.command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code, windowsVirtualKeyCode: vk, modifiers });
    await popup.command("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const ctrl = (name, code, vk) => key(name, code, vk, 2);
  const typeText = async text => { await popup.command("Page.bringToFront"); await popup.command("Input.insertText", { text }); };
  try {
  // Real editing in the popout's own document: focus, typing, undo, hotkey save.
  const popDoc = "app.workspace.windows[0].surface.document";
  const cm = `${leafExpr("pop-b")}.view.editor.cm`;
  assert.equal(await evaluate(`${cm}.root===${popDoc}`), true, "CodeMirror was re-rooted into the popout document");
  assert.equal(await evaluate(`${popDoc}.head.querySelectorAll("style,link[rel=stylesheet]").length>0||${popDoc}.adoptedStyleSheets.length>0`), true, "the popout received the application's styles");
  if (forcedCloseOnly) {
    report.forcedClose = { targetId: popTarget.id, method: "Page.close", preservesPendingIntent: false, history: [] };
    const historyState = async phase => {
      const state = JSON.parse(await evaluate(editorHistoryExpression(leafExpr("pop-b"))));
      report.forcedClose.history.push({ phase, ...state });
      return state;
    };
    const waitHistory = async (expression, label) => {
      try { await wait(expression, label); }
      catch (error) { await historyState("timeout: " + label); throw error; }
    };
    const original = await evaluate(`${cm}.state.doc.toString()`);
    const diskBefore = await readFile(join(directory, path("C")), "utf8");
    const mainBefore = await readFile(join(directory, path("A")), "utf8");
    await evaluate(`(async()=>{const l=app.workspace.createTab(${leafExpr("pop-a")}.parent,"forced-main-newer");await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("A"))}));l.view.editor.setValue("newer main work");window.__forcedMain=l;app.workspace.setActiveLeaf(${leafExpr("pop-b")},{focus:false});return true})()`);
    await evaluate(`(()=>{${cm}.focus();return true})()`);
    await wait(`${popDoc}.activeElement===${cm}.contentDOM`, "forced-close popup editor focused");
    await ctrl("a", "KeyA", 65); await typeText("unsaved forced-close recovery");
    await wait(`${cm}.state.doc.toString()==="unsaved forced-close recovery"&&${leafExpr("pop-b")}.view.isDirty`, "forced-close unsaved edit typed");
    await historyState("typed before close");
    await ctrl("z", "KeyZ", 90);
    await waitHistory(`${cm}.state.doc.toString()===${JSON.stringify(original)}`, "the popup baseline retained real Undo history before closure");
    await ctrl("y", "KeyY", 89);
    await waitHistory(`${cm}.state.doc.toString()==="unsaved forced-close recovery"`, "the popup baseline retained real Redo history before closure");
    await historyState("round-trip before close");
    await evaluate(`(()=>{const d=${popDoc},counts=window.__forcedListenerCounts={connected:0,detached:0,adopted:0,main:0};const nodes={connected:${cm}.contentDOM,detached:d.createElement("span"),adopted:d.createElement("span"),main:document.createElement("span")};document.createDocumentFragment().append(nodes.adopted);window.__forcedListenerProbes=Object.entries(nodes).map(([name,node])=>{const handler=()=>{counts[name]++};node.addEventListener("slopsidian-lifetime-probe",handler);node.dispatchEvent(new Event("slopsidian-lifetime-probe"));return{node,handler}});return true})()`);
    await historyState("listeners before close");
    await evaluate(`(()=>{const l=${leafExpr("pop-b")},w=app.workspace.windows[0];w.extras={...w.extras,forcedCloseProbe:true};const layout=app.workspace.getLayout();window.__forcedClose={leaf:l,view:l.view,editor:l.view.editor,cm:l.view.editor.cm,session:l.view.session,doc:l.view.editor.cm.state.doc,history:l.view.editor.cm.state.field(app.plugins.modules["@codemirror/commands"].historyField),selection:JSON.stringify(l.view.editor.cm.state.selection.toJSON()),entry:structuredClone(layout.views["workspace-windows"].windows[0]),mainView:window.__forcedMain.view,mainDoc:window.__forcedMain.view.editor.cm.state.doc};return true})()`);
    await evaluate("(async()=>{await app.workspace.requestSaveLayout();return true})()");
    const warning = "A popout window closed without the workspace's approval. Its live tabs returned to main, and its saved arrangement can be retried.";
    // Page.close deliberately bypasses the native user's WM_CLOSE preflight; it is not the close-veto test.
    await expectErrors({ evaluate, report }, [{ source: "notification", message: warning }], async () => {
      try { await popup.command("Page.close"); }
      catch (error) {
        assert.equal(error.message, "CDP timed out: Page.close", "only loss of this destroyed target's command response is permitted");
        report.forcedClose.commandError = error.message;
      }
      await until(async () => !(await targets()).some(target => target.id === popTarget.id), "the exact owned popup target was destroyed");
      await wait(`app.workspace.windows.length===0&&app.workspace.pendingPopoutCount===1&&${leafExpr("pop-b")}.getRoot()===app.workspace.rootSplit`, "the unexpected close returned its live tab and retained saved-window intent");
    }, "Deliberately destroy the owned native popup without approval and require one explicit recovery notification");
    await settled();
    assert.equal(await evaluate(`(()=>{const s=window.__forcedClose,l=${leafExpr("pop-b")};return l===s.leaf&&l.view===s.view&&l.view.editor===s.editor&&l.view.editor.cm===s.cm&&l.view.session===s.session&&s.cm.state.doc===s.doc&&JSON.stringify(s.cm.state.selection.toJSON())===s.selection&&s.cm.root===document&&l.containerEl.isConnected&&l.containerEl.ownerDocument===document&&l.view.isDirty})()`), true, "recovery keeps the live leaf, view, editor, document session, CM document and selection in main");
    assert.equal(await evaluate("window.__forcedMain.view===window.__forcedClose.mainView&&window.__forcedMain.view.editor.cm.state.doc===window.__forcedClose.mainDoc&&window.__forcedMain.view.editor.getValue()==='newer main work'&&window.__forcedMain.view.isDirty"), true, "newer independent main work is not rewound");
    const intent = JSON.parse(await evaluate(`JSON.stringify((()=>{const s=window.__forcedClose,p=app.workspace.pendingWindows[0],v=app.workspace.getLayout();return{saved:s.entry,pending:p.entry,layout:v}})())`));
    assert.deepEqual(intent.pending.root, intent.saved.root, "the original window tree is kept as retry intent");
    assert.deepEqual(intent.pending.bounds, intent.saved.bounds, "last saved real window bounds are kept");
    assert.equal(intent.pending.extras.forcedCloseProbe, true, "unknown window keys survive recovery");
    assert.equal(intent.layout.views["workspace-windows"].windows[0].forcedCloseProbe, true);
    const ids = [], walk = node => { if (node.type === "leaf") { ids.push(node.id); } else { node.children.forEach(walk); } };
    walk(intent.layout.main); intent.layout.views["workspace-windows"].windows.forEach(entry => walk(entry.root));
    assert.equal(new Set(ids).size, ids.length, "recovered live leaves are not saved twice");
    assert.equal(await readFile(join(directory, path("C")), "utf8"), diskBefore, "the unapproved close did not silently save the popup edit");
    assert.equal(await readFile(join(directory, path("A")), "utf8"), mainBefore, "the unapproved close did not save unrelated main edits");
    report.forcedClose.preservesPendingIntent = true;
    await evaluate(`(()=>{for(const {node,handler} of window.__forcedListenerProbes){node.dispatchEvent(new Event("slopsidian-lifetime-probe"));node.removeEventListener("slopsidian-lifetime-probe",handler)}delete window.__forcedListenerProbes;return true})()`);
    const listenerState = await historyState("listeners after recovery");
    assert.deepEqual(listenerState.listenerCounts, { connected: 2, detached: 1, adopted: 2, main: 2 }, "the live editor listeners survive while the unprotected old-document control is actually cleared");
    pass("an unapproved native close recovers the same live dirty editor and keeps original retryable window intent without rewinding main");

    await command("Page.bringToFront");
    await evaluate(`(()=>{app.workspace.setActiveLeaf(${leafExpr("pop-b")},{focus:true});${cm}.focus();return true})()`);
    await wait(`document.activeElement===${cm}.contentDOM`, "the recovered editor focused in main");
    await historyState("focused after recovery");
    const mainCtrl = async (key, code, windowsVirtualKeyCode) => {
      await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode, modifiers: 2 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers: 2 });
    };
    await evaluate(`(()=>{window.__forcedKeys=[];window.__forcedKeyProbe=e=>{const row={key:e.key,code:e.code,keyCode:e.keyCode,ctrl:e.ctrlKey,target:e.target?.className??null};window.__forcedKeys.push(row);queueMicrotask(()=>{row.prevented=e.defaultPrevented})};document.addEventListener("keydown",window.__forcedKeyProbe,true);return true})()`);
    try { await mainCtrl("z", "KeyZ", 90); }
    finally { await evaluate(`(()=>{document.removeEventListener("keydown",window.__forcedKeyProbe,true);delete window.__forcedKeyProbe;return true})()`); }
    await historyState("after main Undo key");
    await waitHistory(`${cm}.state.doc.toString()===${JSON.stringify(original)}`, "the recovered editor retained real Undo history");
    await mainCtrl("y", "KeyY", 89);
    await waitHistory(`${cm}.state.doc.toString()==="unsaved forced-close recovery"`, "the recovered editor retained real Redo history");
    await mainCtrl("s", "KeyS", 83);
    await wait(`${leafExpr("pop-b")}.view.isDirty===false`, "the recovered editor saved through the main hotkey");
    assert.equal(await readFile(join(directory, path("C")), "utf8"), "unsaved forced-close recovery");
    await wait("window.__forcedMain.view.isDirty===false", "the existing Save-all hotkey also persisted the independent main edit");
    assert.equal(await readFile(join(directory, path("A")), "utf8"), "newer main work", "explicit Ctrl+S keeps its existing Save-all behavior");
    assert.equal(await evaluate("window.__forcedMain.view===window.__forcedClose.mainView&&window.__forcedMain.view.editor.cm.state.doc===window.__forcedClose.mainDoc"), true, "explicit Save-all does not replace the independent live main editor/document");
    pass("real Undo, Redo and hotkey Save resume in the recovered main-window editor");

    await evaluate("app.commands.executeCommandById('workspace:retry-popout-windows')");
    await wait("app.workspace.windows.length===1&&app.workspace.pendingPopoutCount===0", "the saved-window retry command opened the genuine native popup");
    assert.equal(await evaluate(`(()=>{const s=window.__forcedClose,l=${leafExpr("pop-b")},w=app.workspace.windows[0];return l===s.leaf&&l.view===s.view&&l.view.editor.cm===s.cm&&l.view.session===s.session&&l.getRoot()===w&&l.view.editor.cm.root===w.surface.document})()`), true, "retry relocates the same recovered objects");
    assert.deepEqual(JSON.parse(await evaluate("JSON.stringify(app.workspace.windows[0].serialize())")), intent.saved.root, "retry restores the original window tree");
    await evaluate("(async()=>{await app.workspace.returnWindowAcknowledged(app.workspace.windows[0]);return true})()");
    await wait(`app.workspace.windows.length===0&&${cm}.root===document&&${leafExpr("pop-b")}.getRoot()===app.workspace.rootSplit`, "the retried native window acknowledged its normal return");
    assert.equal(await evaluate(`${leafExpr("pop-b")}.view===window.__forcedClose.view&&${cm}===window.__forcedClose.cm`), true);
    report.forcedClose.retriedAndReturned = true;
    pass("saved-window retry and acknowledged normal return keep the recovered live editor");
    return;
  }
  const barrierOnly = process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY === "barrier";
  if (!barrierOnly) {
  const original = await evaluate(`${cm}.state.doc.toString()`);
  await evaluate(`(()=>{${cm}.focus();return true})()`);
  await wait(`${popDoc}.activeElement===${cm}.contentDOM`, "popout editor focused");
  await ctrl("a", "KeyA", 65); await typeText("typed in popout λ");
  await wait(`${cm}.state.doc.toString()==="typed in popout λ"`, "typing reached the editor");
  assert.equal(await evaluate("app.workspace.activeLeaf.id"), "pop-b", "the popout editor is the active leaf");
  await ctrl("z", "KeyZ", 90);
  await wait(`${cm}.state.doc.toString()===${JSON.stringify(original)}`, "undo in the popout restored the text");
  await ctrl("a", "KeyA", 65); await typeText("saved from popout");
  await wait(`${cm}.state.doc.toString()==="saved from popout"`, "second edit typed");
  await ctrl("s", "KeyS", 83);
  await wait(`${leafExpr("pop-b")}.view.isDirty===false`, "hotkey save finished");
  assert.equal((await readFile(join(directory, path("C")), "utf8")).includes("saved from popout"), true, "Ctrl+S in the popout wrote the file once");
  pass("typing, undo and hotkey save work in the real popout document");

  // Menu and modal ownership/cancellation in the popout document, cancelled with real Escape key input.
  await evaluate(`(()=>{const {Menu}=app.plugins.modules.obsidian;const w=app.workspace.windows[0].surface.window;window.__popMenu=new Menu();window.__popMenu.addItem(i=>i.setTitle("Popout probe"));window.__popMenu.showAtPosition({x:30,y:30},w.document);return true})()`);
  await wait(`${popDoc}.querySelector(".menu")!==null`, "menu rendered in the popout document");
  assert.equal(await evaluate(`document.querySelector(".menu")===null`), true, "the menu did not appear in the main document");
  await key("Escape", "Escape", 27);
  await wait(`${popDoc}.querySelector(".menu")===null`, "Escape closed the popout menu");
  await evaluate(`(()=>{const {Modal}=app.plugins.modules.obsidian;const m=new Modal(app);m.setTitle("Popout modal");m.onClose=()=>{window.__modalClosed=true};window.__popModal=m;m.open();return true})()`);
  await wait(`document.querySelector(".modal-container")!==null||${popDoc}.querySelector(".modal-container")!==null`, "modal opened");
  const modalOwner = await evaluate(`window.__popModal.containerEl.ownerDocument===${popDoc}`);
  assert.equal(modalOwner, true, "the modal opened in the active (popout) window");
  assert.equal(await evaluate(`document.querySelector(".modal-container")===null`), true, "no duplicate modal in the main document");
  await key("Escape", "Escape", 27);
  await wait("window.__modalClosed===true", "Escape cancelled the popout modal");
  assert.equal(await evaluate(`${popDoc}.querySelector(".modal-container")===null`), true);
  pass("menus and modals open in, and cancel from, the popout document");
  } else {
    // Short held-barrier diagnostic: seed the same popout state with real keys, then run only the barrier section.
    await evaluate(`(()=>{${cm}.focus();return true})()`);
    await wait(`${popDoc}.activeElement===${cm}.contentDOM`, "popout editor focused");
    await ctrl("a", "KeyA", 65); await typeText("saved from popout");
    await wait(`${cm}.state.doc.toString()==="saved from popout"`, "seed typed");
  }
  // File-mutation barrier: while a mutation is held, real popup input must not change the popout editor or undo, and it must recover afterwards.
  await evaluate(`(()=>{window.__release=null;const held=new Promise(r=>{window.__release=r});window.__mutation=app.workspace.withFileMutation(()=>held);return true})()`);
  try {
    await wait(`app.workspace.isChangingFiles&&app.workspace.windows[0].surface.root.inert`, "barrier froze the popout");
    assert.equal(await evaluate(`app.workspace.windows[0].surface.root.inert`), true, "the popout root is inert during the mutation");
    const frozen = await evaluate(`${cm}.state.doc.toString()`);
    await typeText("must not land"); await ctrl("z", "KeyZ", 90);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await evaluate(`${cm}.state.doc.toString()`), frozen, "real popup typing and Undo were refused during the mutation");
  } finally { await evaluate("window.__release&&window.__release()"); }
  await evaluate("(async()=>{await window.__mutation;return true})()");
  await wait("!app.workspace.isChangingFiles", "barrier released");
  assert.equal(await evaluate(`app.workspace.windows[0].surface.root.inert`), false, "prior inert state was restored");
  await evaluate(`(()=>{${cm}.focus();return true})()`);
  await ctrl("a", "KeyA", 65); await typeText("after barrier");
  await wait(`${cm}.state.doc.toString()==="after barrier"`, "the popout editor accepts input again");
  await ctrl("z", "KeyZ", 90);
  await wait(`${cm}.state.doc.toString()!=="after barrier"`, "real Undo resumed after the barrier was released");
  await ctrl("y", "KeyY", 89);
  await wait(`${cm}.state.doc.toString()==="after barrier"`, "real Redo resumed after the barrier was released");
  pass("a held file mutation freezes the popout and real input/undo resume afterwards");
  if (barrierOnly) { await diag.assertAll(); await diag.retain("popout"); await evaluate("app.workspace.returnWindow(app.workspace.windows[0])"); await wait("app.workspace.windows.length===0", "diagnostic window returned"); await new Promise(resolve => setTimeout(resolve, 1500)); await collectResizeDiagnostic(); popup.socket.close(); return; }

  // Dirty close preflight: a failed save refuses closing the whole window and keeps the tab and window.
  await evaluate(`(async()=>{const l=${leafExpr("pop-b")};l.view.editor.setValue("dirty popout edit");await l.view.save?.()})()`);
  await evaluate(`(async()=>{const w=app.workspace.windows[0];const l=${leafExpr("pop-b")};l.view.prepareClose=async()=>{throw new Error("refused")};await app.workspace.closeWindow(w).catch(e=>{window.__closeError=e.message})})()`);
  assert.equal(await evaluate("window.__closeError"), "refused");
  assert.equal(await evaluate("app.workspace.windows.length"), 1);
  assert.equal(await evaluate(`${leafExpr("pop-b")}.view.editor.getValue()`), "dirty popout edit");
  await evaluate(`delete ${leafExpr("pop-b")}.view.prepareClose`);
  pass("a refused dirty close keeps the window, tab and edit");
  // Real window-close request (the user's close button path) hits the same veto and must keep the window and the edit.
  // CDP Page.close destroys the WebContents without the BrowserWindow 'close' event, so it is not the user's close path:
  // the desktop veto uses a real WM_CLOSE posted to the exact popout HWND (identified by a unique native title).
  if (mode === "desktop") {
    assert.equal(typeof nativeUserClose, "function", "the desktop runner must supply the native user-close path");
    await evaluate(`(()=>{const l=${leafExpr("pop-b")};l.view.prepareClose=async()=>{throw new Error("refused")};return true})()`);
    const title = "slopsidian-veto-probe-" + Date.now();
    await popup.evaluate(`document.title=${JSON.stringify(title)}`);
    await expectErrors({ evaluate, report }, [{ source: "notification", message: "refused" }], async () => { report.nativeUserClose = await nativeUserClose(title); await new Promise(resolve => setTimeout(resolve, 1500)); }, "Record the deliberate native close request vetoed by the owned prepareClose fixture");
    assert.equal(await evaluate("app.workspace.windows.length"), 1, "a vetoed native close request keeps the window");
    assert.equal(await evaluate(`${leafExpr("pop-b")}.view.editor.getValue()`), "dirty popout edit");
    await evaluate(`delete ${leafExpr("pop-b")}.view.prepareClose`);
    pass("a real native close request is vetoed while the tab is dirty");
  }

  if (mode === "desktop") {
    // Web viewer in a popout: the native guest, Reader frame and message owner must follow the popout's own BrowserWindow.
    const vaultOrigin = await evaluate("location.origin");
    const { createWebViewerPages } = await import("./webviewer-scenarios.mjs");
    const pages = await createWebViewerPages(() => vaultOrigin);
    const provider = `app.core.getEnabledPluginById("webviewer")`;
    const webLeaf = "app.workspace.getLeafById(window.__webLeaf)", webView = webLeaf + ".view";
    // Electron's CDP has no Browser.getWindowForTarget; the smoke-only native "inspect" action reports the BrowserWindow(s) whose contentView physically holds the guest.
    const hostOfGuest = () => readGuestHost({ evaluate }, webView);
    const guestOnWindow = async (expected, label) => { let seen; await until(async () => { seen = await hostOfGuest(); return expected(seen); }, label); return seen; };
    const guestTarget = async () => { let found; await until(async () => { found = (await targets()).find(item => item.url.startsWith(pages.origin) && item.type === "page"); return found; }, "native guest CDP target"); return found; };
    let failure = null, restoreWebviewer = null;
    try {
      restoreWebviewer = await enableCorePlugin({ evaluate, wait }, "webviewer");
      await evaluate(`(async()=>{await ${provider}.openUrl(${JSON.stringify(pages.origin + "/reader-story")},true);window.__webLeaf=app.workspace.activeLeaf.id})()`);
      await wait(`${webView}.getViewType()==="webviewer"&&${webView}.contentEl.dataset.webviewerLoading==="false"&&${webView}.created`, "web viewer loaded in main");
      const guest = await guestTarget();
      const home = await hostOfGuest();
      assert.equal(home.owner.main, true, "the native guest starts in the main BrowserWindow's contentView");
      assert.ok(home.guestUrl.startsWith(pages.origin) && guest.url.startsWith(pages.origin), "the inspected guest is the fixture page with a CDP target");
      report.guestHostInspection = { guestWebContentsId: home.guestWebContentsId, mainWindowId: home.mainWindowId };
      await evaluate(`${webView}.contentEl.querySelector('[data-webviewer-action="reader"]').click()`);
      await wait(`${webView}.contentEl.dataset.webviewerReaderMode==="reader"&&${webView}.reader.progressReady`, "reader mode in main");
      await evaluate(`(()=>{window.__webReader=${webView}.reader;window.__webRevision=${webView}.reader.documentRevision;return true})()`);
      const known = new Set((await targets()).map(item => item.id));
      await evaluate(`(()=>{app.workspace.setActiveLeaf(${webLeaf},{focus:false});app.commands.executeCommandById('workspace:popout-tab')})()`);
      await wait("app.workspace.windows.length===2", "web viewer popout opened");
      await wait(`app.workspace.popoutNameFor(${webView}.surface.ownerDocument)!==null`, "web viewer surface is hosted by a popout");
      assert.equal(await evaluate(`${webView}.reader===window.__webReader&&${webView}.reader.ownerWindow===${webView}.surface.ownerDocument.defaultView`), true, "the same Reader is rebound to the popout window");
      assert.equal(await evaluate(`${webView}.reader.ownerWindow!==window`), true, "the Reader no longer listens on the main window");
      let target;
      await until(async () => { target = (await targets()).find(item => item.type === "page" && !known.has(item.id) && item.url === "about:blank"); return target; }, "web viewer popout CDP target");
      const webPopup = await connect(target, until);
      try {
        try { await wait(readerCurrentDocumentReady(webView), "the moved Reader's current document answered ready in the popout"); }
        catch (error) { report.readerReadinessFailure = await readerFailureSnapshot({ evaluate, webPopup, targets, webView }); throw error; }
        // The popout's native window is identified by a unique title set on its own CDP target, matched to the BrowserWindow that actually holds the guest.
        const hostTitle = "slopsidian-guest-host-" + Date.now();
        await webPopup.evaluate(`document.title=${JSON.stringify(hostTitle)}`);
        const moved = await guestOnWindow(seen => !seen.owner.main && seen.owner.title === hostTitle, "the native guest is a child of the titled popout BrowserWindow");
        assert.equal(moved.guestWebContentsId, home.guestWebContentsId, "the same guest WebContents moved, it was not recreated");
        assert.notEqual(moved.owner.id, home.mainWindowId, "the popout BrowserWindow is not the main window");
        report.guestHostInspection.popout = { windowId: moved.owner.id, title: hostTitle };
        // Real wheel input on the popout's Reader iframe must reach the owner window's progress handler.
        const box = JSON.parse(await evaluate(`JSON.stringify((()=>{const b=${webView}.contentEl.querySelector("[data-webviewer-reader]").getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})())`));
        const before = await evaluate(`${webView}.reader.progress`);
        await webPopup.command("Page.bringToFront");
        await webPopup.command("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: 600 });
        await wait(`${webView}.reader.progress>${before}`, "Reader progress increased in the popout owner window");
        await wait(`(()=>{const s=${webView}.getState().readerScroll;return s&&s.url===${webView}.getState().url&&s.progress===${webView}.reader.progress})()`, "the stored ReaderScroll for this URL matches the progress");
        pass("a web viewer popout moves the native guest, rebinds the live Reader and delivers its progress");
        try { report.readerCreatedInPopout = await checkReaderCreatedInPopout({ evaluate, wait, popup: webPopup, view: webView }); }
        catch (error) { report.readerCreationFailure = await readerFailureSnapshot({ evaluate, webPopup, targets, webView }); throw error; }
        pass("a new Reader constructed inside the popout authenticates its port and answers the production channel");
      } finally { webPopup.socket.close(); }
      const progress = await evaluate(`${webView}.reader.progress`);
      await evaluate(`(()=>{const w=app.workspace.windows.find(w=>app.workspace.popoutNameFor(${webView}.surface.ownerDocument)===w.surface.name);app.workspace.returnWindow(w)})()`);
      await wait("app.workspace.windows.length===1", "web viewer window returned");
      report.readerReturn = await evaluate(`(()=>{const r=${webView}.reader;return{sameReader:r===window.__webReader,ownerIsMain:r.ownerWindow===window,progress:r.progress,expectedProgress:${progress},progressReady:r.progressReady,revision:r.documentRevision}})()`);
      assert.equal(report.readerReturn.sameReader && report.readerReturn.ownerIsMain && report.readerReturn.progress === progress, true, "the Reader returned to main with its progress: " + JSON.stringify(report.readerReturn));
      await wait(readerCurrentDocumentReady(webView), "the newly constructed Reader answered again after native return to main");
      const returned = await guestOnWindow(seen => seen.owner.main, "the native guest returned to the main BrowserWindow");
      assert.equal(returned.guestWebContentsId, home.guestWebContentsId, "the same guest WebContents returned");
      // A refused native relocation must surface and return the tab instead of pretending it moved.
      await evaluate(`(()=>{const view=${webView},real=view.ipc;view.ipc=Object.create(real,{invoke:{value:(channel,payload)=>payload.action==="bounds"&&payload.host?Promise.reject(new Error("probe refused")):real.invoke(channel,payload)}});window.__restoreIpc=()=>{view.ipc=real};app.workspace.setActiveLeaf(${webLeaf},{focus:false});app.commands.executeCommandById('workspace:popout-tab')})()`);
      await wait(`${webLeaf}.getRoot()===app.workspace.rootSplit&&app.workspace.windows.length===1&&${webView}.message.textContent.includes("probe refused")`, "refused guest relocation returned the tab to main with a visible error");
      const kept = await hostOfGuest();
      assert.ok(kept.owner.main && kept.guestWebContentsId === home.guestWebContentsId, "a refused relocation keeps the native guest in the main BrowserWindow");
      await evaluate("window.__restoreIpc()");
      pass("a refused native guest relocation returns the tab to main, keeps the guest in place and shows the error");
    } catch (error) { failure = { error }; }
    const cleanup = [];
    try { await evaluate(`(async()=>{window.__restoreIpc?.();const l=window.__webLeaf&&app.workspace.getLeafById(window.__webLeaf);if(l)await app.workspace.closeLeaf(l)})()`); } catch (error) { cleanup.push(error); }
    try { await pages.close(); } catch (error) { cleanup.push(error); }
    if (restoreWebviewer) { try { await restoreWebviewer(); } catch (error) { cleanup.push(error); } }
    if (failure || cleanup.length) {
      const errors = [...(failure ? [failure.error] : []), ...cleanup];
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, "web viewer popout scenario and cleanup failed");
    }
  } else {
    report.checks.push("web-viewer popout owner scenario skipped: the Web viewer's native guest is desktop-only");
  }
  } finally { popup.socket.close(); }

  // Restart restores the window (desktop reopens the genuine native window; the browser needs a user gesture, so it folds with a Notice).
  await evaluate("app.workspace.requestSaveLayout()"); await settled();
  await restart(); await afterReload();
  const restored = await evaluate("app.workspace.windows.length");
  const issue = await evaluate("JSON.stringify(app.workspace.lastPopoutIssue)");
  assert.ok(restored === 1 || JSON.parse(issue)?.code, "the window reopened, or the blocked/unsupported reason is explicit");
  if (restored === 1) {
    assert.equal(await evaluate(`${leafExpr("pop-b")}.getRoot()===app.workspace.windows[0]`), true);
    assert.equal(await evaluate("app.workspace.getLayout().views['workspace-groups'].links['pop-b']!==undefined"), true);
  } else {
    assert.equal(await evaluate(`${leafExpr("pop-b")}.getRoot()===app.workspace.rootSplit`), true, "a blocked popout shows its tab in main without losing it");
    // The next automatic save must keep the saved arrangement instead of erasing it.
    await evaluate("app.workspace.requestSaveLayout()"); await settled();
    assert.equal(await evaluate("app.workspace.pendingPopoutCount"), 1);
    const saved = JSON.parse(await evaluate("JSON.stringify(app.workspace.getLayout())"));
    assert.equal(saved.views["workspace-windows"].windows.length, 1, "the unavailable window is still saved");
    const ids = [];
    const walk = node => node.children.forEach(child => child.type === "leaf" ? ids.push(child.id) : walk(child));
    walk(saved.main); saved.views["workspace-windows"].windows.forEach(entry => walk(entry.root));
    assert.equal(new Set(ids).size, ids.length, "no leaf id is saved twice");
    // Retry needs a user gesture in a browser; a refusal is explicit and leaves the saved window pending.
    const retry = await evaluate("(()=>{try{return 'opened:'+app.workspace.retryPendingWindows()}catch(e){return 'refused:'+e.message}})()");
    assert.match(retry, /^(opened:1|refused:.+)$/);
    if (retry.startsWith("refused:")) {
      assert.equal(await evaluate("app.workspace.pendingPopoutCount"), 1);
      await evaluate("app.commands.executeCommandById('workspace:fold-popout-windows')");
      assert.equal(await evaluate("app.workspace.pendingPopoutCount"), 0);
      assert.equal(await evaluate("app.workspace.getLayout().views['workspace-windows']===undefined"), true, "fold is the explicit reset");
    }
  }
  pass("restart reopens the native window, or explicitly folds it with a reason");

  // Return: tabs come back to main with the same live view.
  if (restored === 1) {
    await evaluate("app.workspace.returnWindow(app.workspace.windows[0])");
    await wait("app.workspace.windows.length===0", "window returned");
    assert.equal(await evaluate(`${leafExpr("pop-b")}.getRoot()===app.workspace.rootSplit`), true);
    pass("return moves the live tab back to the main area and closes the window");
  }
}
