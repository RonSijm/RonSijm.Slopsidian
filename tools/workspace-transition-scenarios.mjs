import { expectErrors } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWorkspaceTransition({ directory, targetDirectory, evaluate, command, click, wait, report, selectVault, restart, afterReload, capture, browser = false }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const sourceRoot = await evaluate("app.vault.rootPath"), target = targetDirectory ?? join(directory, "Transition target");
  const layoutPath = path => join(path, ".obsidian", "vault-dotnet-workspace.json");
  const readOptional = async path => { try { return await readFile(path); } catch (error) { if (error.code === "ENOENT") { return null; } throw error; } };
  const original = await readOptional(join(directory, ".obsidian", "workspace.json"));
  const preservedText = Buffer.from("\ufeff# Exact Î»\r\n\r\nRetain original BOM and CRLF.\r\n"), preservedBinary = Buffer.from([255, 0, 128, 9, 17]);
  await writeFile(join(directory, "Transition exact Î».md"), preservedText); await writeFile(join(directory, "Transition keep.bin"), preservedBinary);
  await writeFile(join(directory, "Transition.canvas"), '{"nodes":[],"edges":[],"futureDocument":{"retained":true}}\n');
  await mkdir(join(target, ".obsidian"), { recursive: true });
  await writeFile(join(target, "Other.md"), "# Target vault\nRetain exactly.\n");
  const targetOriginal = Buffer.from("\ufeff" + JSON.stringify({ main: { id: "target-original-main", type: "split", direction: "vertical", children: [{ id: "target-original-tabs", type: "tabs", children: [{ id: "target-original-leaf", type: "leaf", state: { type: "markdown", state: { file: "Other.md", mode: "source", source: true } } }] }] }, active: "target-original-leaf", original: "target workspace", opaque: [true, 42] }) + "\r\n");
  await writeFile(join(target, ".obsidian", "workspace.json"), targetOriginal);
  await writeFile(join(target, ".obsidian", "core-plugins.json"), '{"bookmarks":true,"futureTransition":{"retained":"target"}}\n');
  await evaluate(`(async()=>{
    if(!app.core.isEnabled("bookmarks"))await app.core.setEnabled("bookmarks",true);
    if(!app.core.isEnabled("canvas"))await app.core.setEnabled("canvas",true);
    const leaf=app.workspace.getLeaf("tab");
    await leaf.setViewState({type:"bookmarks",state:{futureTransition:{retained:[true,"bookmarks"]}},pinned:true,active:true});
    globalThis.transitionCoreLeafId=leaf.id;
    const note=await app.vault.create("Transition.md","# Before transition\\n");await app.workspace.getLeaf("tab").openFile(note);
    app.workspace.setViewOptions("transition-fixture",{vault:"source",revision:"queued",opaque:{retained:[true,42]}});
    await app.workspace.flushLayout();
  })()`);
  const sourceCore = await readOptional(join(directory, ".obsidian", "core-plugins.json"));
  const coreLeafId = await evaluate("transitionCoreLeafId");
  let sourceCanvas = await readFile(join(directory, "Transition.canvas"));
  async function installTrace() {
    await evaluate(`(async()=>{
      const data=globalThis.transitionTrace={calls:[],phase:"setup",failCheckpoint:false};
      const workspace=app.workspace,original=workspace.writeCurrentLayout;
      workspace.writeCurrentLayout=function(){
        const call={root:app.vault.rootPath,changing:app.changingVault,phase:data.phase,layout:this.getLayout()};data.calls.push(call);
        if(data.failCheckpoint&&app.changingVault){data.failCheckpoint=false;call.error="Expected transition checkpoint failure";return Promise.reject(new Error(call.error));}
        const pending=original.call(this);pending.then(()=>call.completed=true,error=>call.error=String(error));return pending;
      };
      const api=${browser ? 'await import(new URL("js/browser-host.js",document.baseURI).href)' : "null"};
      data.raw=async(path,method="GET",body)=>{
        if(api)return api.request(path,method,body);
        const response=await fetch(path,{method,headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
        const text=await response.text();return{status:response.status,value:text?JSON.parse(text):undefined};
      };
    })()`);
  }
  const clean = async () => {
    await evaluate("app.workspace.flushLayout()");
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
    assert.equal(await evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  };
  const switched = root => wait(`!app.changingVault&&app.vault.rootPath${root ? "===" + JSON.stringify(root) : "!==" + JSON.stringify(sourceRoot)}&&app.workspace.layoutReady&&!document.querySelector("#vault-dialog").open`, "completed vault transition");
  await installTrace(); await clean();
  const dirtyText = "# Saved by vault transition\n\nUnicode Î» and unsaved text.\n";
  await evaluate(`app.editor.setValue(${JSON.stringify(dirtyText)})`);
  await evaluate(`(()=>{
    transitionTrace.phase="held-source-save";const workspace=app.workspace;
    workspace.layoutWrite=workspace.layoutWrite.then(()=>new Promise(resolve=>transitionTrace.release=resolve));
    transitionTrace.pending=workspace.requestSaveLayout();transitionTrace.pending.catch(()=>{});
  })()`);
  await wait('typeof transitionTrace.release==="function"', "fixture-held layout queue");
  await selectVault(target); await wait("app.changingVault", "vault transition waits for pending layout persistence");
  assert.equal(await evaluate('(async()=> (await transitionTrace.raw("/api/vault")).value.root)()'), sourceRoot, "The backend cannot switch while a layout write is pending.");
  await evaluate('transitionTrace.phase="final-source-checkpoint";app.workspace.setViewOptions("transition-fixture",{vault:"source",revision:"final",opaque:{retained:[true,42]}})');
  const expectedSource = await evaluate("app.workspace.getLayout()");
  const normalizedSource = await evaluate(`transitionTrace.raw("/api/workspace/validate?root="+encodeURIComponent(${JSON.stringify(sourceRoot)}),"POST",app.workspace.getLayout())`);
  assert.equal(normalizedSource.status, 200);
  await evaluate("transitionTrace.release();transitionTrace.pending"); await switched();
  const targetRoot = await evaluate("app.vault.rootPath"); await clean();
  const sourceCalls = await evaluate(`transitionTrace.calls.filter(call=>call.root===${JSON.stringify(sourceRoot)}&&call.changing)`);
  assert.equal(sourceCalls.length, 1, "Only the final checkpoint may write while leaving the source vault.");
  assert.equal(sourceCalls[0].completed, true); assert.deepEqual(sourceCalls[0].layout, expectedSource);
  assert.deepEqual(JSON.parse(await readFile(layoutPath(directory), "utf8")), normalizedSource.value);
  assert.equal(await readFile(join(directory, "Transition.md"), "utf8"), dirtyText);
  pass("A fixture-held real layout queue delays backend selection; its final source snapshot retains live core-view/opaque state and saves dirty note bytes, with no obsolete cleanup write or selected-vault warning.");

  await evaluate('transitionTrace.phase="target-layout";app.workspace.setViewOptions("transition-fixture",{vault:"target",revision:"kept",opaque:{retained:[false,7]}});app.workspace.flushLayout()');
  const targetLayout = await readFile(layoutPath(target));
  const refused = await evaluate(`transitionTrace.raw("/api/workspace?root="+encodeURIComponent(${JSON.stringify(sourceRoot)}),"PUT",app.workspace.getLayout())`);
  assert.equal(refused.status, 409, "The backend root guard must still reject an explicitly stale direct API request.");
  assert.deepEqual(await readFile(layoutPath(target)), targetLayout);
  await evaluate('transitionTrace.phase="return-source"'); await selectVault(directory); await switched(sourceRoot); await clean();
  assert.deepEqual(await evaluate('app.workspace.getViewOptions("transition-fixture")'), expectedSource.views["transition-fixture"]);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(coreLeafId)}).view.getViewType()`), "bookmarks");
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(coreLeafId)}).view.getState().futureTransition`), { retained: [true, "bookmarks"] });
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(coreLeafId)}).pinned`), true);
  assert.deepEqual(await readFile(layoutPath(target)), targetLayout);
  pass("Actual source/target switches restore the original live core view, pin and opaque layout fields; an explicit stale direct API write still receives 409 and cannot change the target layout.");

  await evaluate('transitionTrace.phase="failed-checkpoint";transitionTrace.failCheckpoint=true');
  await expectErrors({ evaluate, report }, [{ source: "host", message: "Expected transition checkpoint failure" }], () => selectVault(target), "Exercise the owned transition-checkpoint rejection before changing the backend vault");
  await wait('!app.changingVault&&document.querySelector("#vault-dialog").open&&document.querySelector(".error-banner")?.textContent.includes("Expected transition checkpoint failure")', "failed checkpoint resumes editing before any backend switch");
  assert.equal(await evaluate("app.vault.rootPath"), sourceRoot);
  assert.equal(await evaluate('(async()=> (await transitionTrace.raw("/api/vault")).value.root)()'), sourceRoot);
  assert.deepEqual(await readFile(layoutPath(target)), targetLayout);
  await click("#cancel-vault-selection");
  await evaluate('app.workspace.revealLeaf(app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path==="Transition.md"))');
  await wait('document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]")', "editor becomes editable after checkpoint failure");
  const recoveredText = dirtyText + "Recovered after the refused transition.\n";
  await evaluate(`app.editor.setValue(${JSON.stringify(recoveredText)});app.saveCurrent()`);
  await evaluate('transitionTrace.phase="recovered-checkpoint";app.workspace.setViewOptions("transition-recovered",{retained:true});app.workspace.flushLayout()');
  assert.equal(await readFile(join(directory, "Transition.md"), "utf8"), recoveredText);
  await selectVault(target); await switched(targetRoot); await clean();
  assert.deepEqual(await evaluate('app.workspace.getViewOptions("transition-fixture")'), { vault: "target", revision: "kept", opaque: { retained: [false, 7] } });
  await selectVault(directory); await switched(sourceRoot); await clean();
  assert.deepEqual(await evaluate('app.workspace.getViewOptions("transition-recovered")'), { retained: true });
  pass("An explicitly injected final-checkpoint failure keeps both hosts on the source vault and restores editability; normal note/layout saving and a real retry recover without disabling future saves or changing target data.");

  assert.deepEqual(await readFile(join(directory, "Transition.canvas")), sourceCanvas);
  const canvas = await evaluate(`(async()=>{
    const leaf=app.workspace.getLeaf("tab");
    await leaf.setViewState({type:"canvas",state:{file:"Transition.canvas",futureCanvasTransition:{retained:true}},pinned:true,active:true});
    const view=leaf.view,data=view.canvas.getData();
    data.nodes.push({id:"transition-text",type:"text",x:0,y:0,width:240,height:120,text:"Retain the live Canvas through native unload."});
    view.canvas.setData(data);globalThis.transitionRetainedCanvas=view;
    return{id:leaf.id,text:view.getViewData(),dirty:view.hasUnsavedChanges};
  })()`);
  assert.equal(canvas.dirty, true);
  const expectedCanvas = JSON.parse(canvas.text);
  assert.equal(expectedCanvas.nodes.find(node => node.id === "transition-text").text, "Retain the live Canvas through native unload.");
  assert.deepEqual(expectedCanvas.futureDocument, { retained: true });
  sourceCanvas = Buffer.from(canvas.text);
  await selectVault(target); await switched(targetRoot); await clean();
  assert.equal(await evaluate("!transitionRetainedCanvas._loaded&&!transitionRetainedCanvas.containerEl.isConnected&&transitionRetainedCanvas.savedDocument===null"), true);
  assert.deepEqual(await readFile(join(directory, "Transition.canvas")), sourceCanvas);
  await selectVault(directory); await switched(sourceRoot); await clean();
  const restoredCanvas = await evaluate(`(()=>{
    const leaf=app.workspace.getLeafById(${JSON.stringify(canvas.id)}),view=leaf.view;
    return{type:view.getViewType(),pinned:leaf.pinned,opaque:view.getState().futureCanvasTransition,text:view.getViewData(),loaded:view._loaded,dirty:view.hasUnsavedChanges};
  })()`);
  assert.deepEqual(restoredCanvas, { type: "canvas", pinned: true, opaque: { retained: true }, text: canvas.text, loaded: true, dirty: false });
  assert.deepEqual(await readFile(join(directory, "Transition.canvas")), sourceCanvas);
  report.workspaceTransitionCanvas = { id: canvas.id, savedDirtyLiveModel: true, unloadedAndDetached: true, noPostUnloadOverwrite: true, restoredModelAndOpaqueState: true };
  pass("An actual dirty Canvas survives source/target/source vault changes: preflight persists its real model before owned unload clears it, no old-root or empty-model write occurs, and a fresh loaded pane restores exact saved data, pin and opaque state.");

  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload(); await clean();
  assert.deepEqual(await evaluate('app.workspace.getViewOptions("transition-fixture")'), expectedSource.views["transition-fixture"]);
  assert.deepEqual(await evaluate('app.workspace.getViewOptions("transition-recovered")'), { retained: true });
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(coreLeafId)}).view.getViewType()`), "bookmarks");
  assert.deepEqual(await readFile(join(directory, "Transition.canvas")), sourceCanvas);
  assert.deepEqual(await readFile(join(directory, "Transition exact Î».md")), preservedText);
  assert.deepEqual(await readFile(join(directory, "Transition keep.bin")), preservedBinary);
  assert.deepEqual(await readOptional(join(directory, ".obsidian", "core-plugins.json")), sourceCore);
  assert.deepEqual(await readOptional(join(directory, ".obsidian", "workspace.json")), original);
  assert.deepEqual(await readFile(join(target, ".obsidian", "workspace.json")), targetOriginal);
  assert.equal(await readFile(join(target, "Other.md"), "utf8"), "# Target vault\nRetain exactly.\n");
  assert.equal(await readFile(join(directory, "Transition.md"), "utf8"), recoveredText);
  await capture?.();
  report.workspaceTransition = { sourceRoot, targetRoot, preservedPendingWrites: true, explicitStaleApiStatus: refused.status, injectedFailure: "Expected transition checkpoint failure", noObsoleteSaveWarning: true, fullRestart: Boolean(restart), realFolderReconnect: browser };
  pass(`Independent source/target layouts, opaque fields, live core views and exact note/Canvas/BOM/CRLF/binary/original settings bytes survive ${restart ? "a full desktop-process restart" : "real-folder browser reload/reconnect"} with clean client and host error banners.`);
}
