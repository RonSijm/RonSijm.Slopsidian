import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkReaderProgressHistory({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/reader-story?progress-history=first", secondUrl = origin + "/reader-story?progress-history=second";
  const config = join(directory, ".obsidian"), settingsPath = join(config, "webviewer.json"), originalSettingsBytes = await readFile(settingsPath), originalSettings = JSON.parse(originalSettingsBytes);
  const originalNote = await readFile(join(directory, "Welcome.md")), originalWorkspace = await readFile(join(config, "workspace.json"));
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "progress-history source loaded " + url);
  const button = async action => host.click(`[data-webviewer=${JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))}] [data-webviewer-action=${JSON.stringify(action)}]`);
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); }
  async function reveal(id, url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`); await loaded(url); }
  async function nativePage(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native progress-history source"); return connect(target); }
  async function reader() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()`, "progress-history Reader ready");
    const name = await host.evaluate(`${view}.reader.frame.name`), find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      evaluate = undefined;
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-progress-history-acceptance", grantUniveralAccess: false });
        const candidate = async expression => { const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value; };
        if (await candidate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = candidate; }
      } catch { /* Workspace DOM moves can replace the iframe context. */ }
      if (!evaluate) { for (const target of (await targets()).filter(item => item.type === "iframe")) { const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}&&Boolean(document.querySelector("main article"))`)) { evaluate = expression => candidate.evaluate(expression); break; } } }
      return Boolean(evaluate);
    }, "ready progress-history article context");
    await host.wait(`${view}.reader.progressReady===true`, "progress-history progress ready"); return { name, evaluate };
  }



  const styles=frame=>frame.evaluate('({zoom:Number(getComputedStyle(document.documentElement).zoom)})');
  const position = frame => frame.evaluate('(()=>{const root=document.scrollingElement,distance=root.scrollHeight-root.clientHeight;return{top:root.scrollTop,distance,progress:distance>0?root.scrollTop/distance:0}})()');
  const restored = (frame, expected) => until(async () => Math.abs((await position(frame)).progress - expected) < .006, "article history retained progress " + expected);
  async function scrollTo(frame, fraction) {
    const current = await position(frame); assert.ok(current.distance > 100);
    const point = await host.evaluate(`(()=>{const rect=${view}.reader.frame.getBoundingClientRect();return{x:rect.x+rect.width*.55,y:rect.y+rect.height*.65}})()`);
    await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await host.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: (current.distance * fraction - current.top) * (await styles(frame)).zoom });
    await restored(frame, fraction); await until(async () => Math.abs((await host.evaluate(`${view}.getState().readerScroll?.progress`)) - (await position(frame)).progress) < .006, "wheel article history progress reaches owner"); return (await position(frame)).progress;
  }
  async function settings() { await host.click("#open-settings"); await host.click("#core-plugins-tab"); if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); } await host.click('[data-core-settings="webviewer"]'); }
  async function clipBody(selection = false, command = false) {
    if (command) { await host.evaluate('app.commands.execute("webviewer:save-selection-to-vault")'); } else { await button(selection ? "clip-selection" : "clip"); }
    await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "article history clip preview ready");
    if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
    const markdown = await host.evaluate('document.querySelector("[data-web-clip-preview]").value'); await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "article history clip cancelled"); return markdown;
  }
  const history=()=>host.evaluate('app.workspace.activeLeaf.view.getState().readerScrollHistory??[]');
  async function go(url){await host.fill('[data-webviewer='+JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id"))+'] [data-webviewer-address]',url);await button("go");await loaded(url);return reader()}
  async function back(url){await button("back");await loaded(url);return reader()}
  async function forward(url){await button("forward");await loaded(url);return reader()}
  async function expectStored(url,expected){await until(async()=>{const entry=(await history()).find(item=>item.url===url);return entry&&Math.abs(entry.progress-expected)<.006},"stored article position "+url)}
  if(!await host.evaluate('app.core.isEnabled("webviewer")'))await host.evaluate('app.core.setEnabled("webviewer",true)');
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)');await open(source);
  const firstId=await host.evaluate("app.workspace.activeLeaf.id"),initialFiles=await files();await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath=join(config,"vault-dotnet-web-history.json"),originalHistory=await readFile(historyPath);await button("reader");let first=await reader();await restored(first,0);const firstClip=await clipBody();
  const firstProgress=await scrollTo(first,.46);first=await go(secondUrl);await restored(first,0);const secondProgress=await scrollTo(first,.73);
  first=await back(source);await restored(first,firstProgress);await expectStored(secondUrl,secondProgress);await capture("back");
  first=await forward(secondUrl);await restored(first,secondProgress);
  const fragmentUrl=source+"#different";first=await go(fragmentUrl);await restored(first,0);await expectStored(source,firstProgress);await expectStored(secondUrl,secondProgress);await expectStored(fragmentUrl,0);
  first=await back(secondUrl);await restored(first,secondProgress);first=await back(source);await restored(first,firstProgress);const reloadNavigation=await host.evaluate("app.workspace.activeLeaf.view.navigationId");await button("reload");await host.wait("app.workspace.activeLeaf.view.navigationId>"+reloadNavigation+"&&app.workspace.activeLeaf.view.loading===false","fresh reload document");await loaded(source);first=await reader();await restored(first,firstProgress);
  assert.equal(await clipBody(),firstClip);assert.deepEqual(await readFile(settingsPath),originalSettingsBytes);assert.deepEqual(await files(),initialFiles);
  pass("Real Go/Back/Forward/Reload restores distinct exact-URL Reader positions, including query/fragment isolation and top-of-article defaults, while legacy last-position state, article Markdown, settings and existing files remain intact");

  const boundedUrl=index=>origin+"/reader-story?bounded-position="+index;await open(boundedUrl(0));const boundedId=await host.evaluate("app.workspace.activeLeaf.id");await button("reader");let bounded=await reader();
  for(let index=0;index<=20;index++){if(index)bounded=await go(boundedUrl(index));await restored(bounded,0);await scrollTo(bounded,.2+index/100)}
  let entries=await history();assert.equal(entries.length,20);assert.equal(entries[0].url,boundedUrl(1));assert.equal(entries.at(-1).url,boundedUrl(20));assert.equal(entries.some(item=>item.url===boundedUrl(0)),false);
  bounded=await go(boundedUrl(0));await restored(bounded,0);assert.equal((await history()).length,20);bounded=await go(boundedUrl(20));await restored(bounded,.4);
  const before=await host.evaluate('app.workspace.activeLeaf.view.getState()'),name=bounded.name;
  for(const invalid of [[before.readerScrollHistory[0],before.readerScrollHistory[0]],[{url:source,progress:2}],Array.from({length:21},(_,index)=>({url:boundedUrl(index),progress:.5}))]){
    assert.equal(await host.evaluate('(async()=>{try{await app.workspace.activeLeaf.setViewState({type:"webviewer",state:{...app.workspace.activeLeaf.view.getState(),readerScrollHistory:'+JSON.stringify(invalid)+'},active:true});return false}catch{return true}})()'),true);await loaded(boundedUrl(20));bounded=await reader();assert.equal(bounded.name,name);assert.deepEqual(await host.evaluate('app.workspace.activeLeaf.view.getState()'),before);
  }
  await capture("bounded");
  pass("Twenty-one actual articles enforce a per-pane twenty-position limit with oldest-entry eviction and zero for an evicted URL; recent revisits restore, and duplicate/oversized/invalid imported histories refuse atomically without replacing the current Reader or its state");

  await reveal(firstId,source);first=await reader();await restored(first,firstProgress);await open(source);const independentId=await host.evaluate("app.workspace.activeLeaf.id");await button("reader");let independent=await reader();await restored(independent,0);const independentFirst=await scrollTo(independent,.18);independent=await go(secondUrl);await restored(independent,0);const independentSecond=await scrollTo(independent,.29);
  await reveal(firstId,source);first=await reader();await restored(first,firstProgress);await host.evaluate('globalThis.oldArticleWindow=app.workspace.activeLeaf.view.reader.frame.contentWindow;globalThis.oldArticleToken=app.workspace.activeLeaf.view.reader.token;undefined');first=await go(secondUrl);await restored(first,secondProgress);
  const protectedHistory=await history();await host.evaluate('window.dispatchEvent(new MessageEvent("message",{source:oldArticleWindow,data:{channel:"slopsidian-reader",token:oldArticleToken,kind:"progress",progress:1}}))');assert.deepEqual(await history(),protectedHistory);await restored(first,secondProgress);
  first=await go(source);await restored(first,firstProgress);const requestsBefore=requests.length;await button("zoom-in");await restored(first,firstProgress);await button("zoom-reset");await restored(first,firstProgress);await button("reader");await host.wait('app.workspace.activeLeaf.view.contentEl.dataset.webviewerReaderMode==="page"',"history Original page");await button("reader");first=await reader();await restored(first,firstProgress);assert.equal(await clipBody(),firstClip);assert.equal(requests.length,requestsBefore);
  await reveal(independentId,secondUrl);independent=await reader();await restored(independent,independentSecond);independent=await go(source);await restored(independent,independentFirst);await reveal(firstId,source);first=await reader();await restored(first,firstProgress);await capture("independent");
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');assert.deepEqual(await readFile(historyPath),originalHistory);assert.deepEqual(await readFile(settingsPath),originalSettingsBytes);assert.deepEqual(await files(),initialFiles);
  pass("Same-URL panes keep independent article histories across hidden-pane changes and navigation; disposed-frame replies cannot overwrite a newer document, and zoom/Original page/article clipping preserve stored positions and exact Markdown without requests or note/settings/browsing-history changes");

  await host.evaluate('(async()=>{const leaf=app.workspace.activeLeaf,state=leaf.view.getState();await leaf.setViewState({type:"webviewer",state:{...state,readerScroll:{...state.readerScroll,future:{keep:[false,"中文"]}},futureArticleHistory:{keep:true}},active:true});await app.workspace.flushLayout()})()');await loaded(source);first=await reader();await restored(first,firstProgress);
  await restart();await loaded(source);first=await reader();await restored(first,firstProgress);assert.deepEqual(await host.evaluate('app.workspace.activeLeaf.view.getState().readerScroll.future'),{keep:[false,"中文"]});assert.deepEqual(await host.evaluate('app.workspace.activeLeaf.view.getState().futureArticleHistory'),{keep:true});first=await go(secondUrl);await restored(first,secondProgress);first=await go(source);await restored(first,firstProgress);
  await host.evaluate('app.core.setEnabled("webviewer",false)');await until(async()=>!(await targets()).some(item=>item.url.startsWith(origin)),"article history resources released");await host.evaluate('app.workspace.flushLayout()');await restart();assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'),false);await host.evaluate('app.core.setEnabled("webviewer",true)');await loaded(source);first=await reader();await restored(first,firstProgress);first=await go(secondUrl);await restored(first,secondProgress);first=await go(source);await restored(first,firstProgress);await host.evaluate('globalThis.oldArticleFrame=app.workspace.activeLeaf.view.reader;undefined');
  const other=join(directory,".article-history-other-vault"),otherNote=Buffer.from("\ufeff# Keep\r\nOther progress history 中文 😀.\r\n");await mkdir(join(other,".obsidian"),{recursive:true});await writeFile(join(other,"Keep.md"),otherNote);
  const otherSettings=Buffer.from('\ufeff{"enableAdblocking":false,"readerFont":"serif","future":{"keep":"other history"}}\r\n');await writeFile(join(other,".obsidian","webviewer.json"),otherSettings);await writeFile(join(other,".obsidian","core-plugins.json"),JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));const otherHistory='\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n';await writeFile(join(other,".obsidian","vault-dotnet-web-history.json"),otherHistory);
  async function switchVault(path){await host.click("#vault-switcher");await host.wait('document.querySelector("#vault-dialog").open',"article history vault dialog");await host.fill("#vault-open-path",path);await host.click("#confirm-open-vault");await host.wait('app.vault.rootPath==='+JSON.stringify(path)+'&&!app.changingVault&&!document.querySelector("#vault-dialog").open',"article history vault switch")}
  await switchVault(other);await open(source);await button("reader");let otherReader=await reader();await restored(otherReader,0);const otherFirst=await scrollTo(otherReader,.81);otherReader=await go(secondUrl);await restored(otherReader,0);const otherSecond=await scrollTo(otherReader,.11);const otherBefore=await history();await host.evaluate('oldArticleFrame.flushProgress()');assert.equal(await host.evaluate("oldArticleFrame.disposed"),true);assert.deepEqual(await history(),otherBefore);otherReader=await go(source);await restored(otherReader,otherFirst);
  await switchVault(directory);await loaded(source);first=await reader();await restored(first,firstProgress);first=await go(secondUrl);await restored(first,secondProgress);first=await go(source);await restored(first,firstProgress);
  await switchVault(other);await loaded(source);otherReader=await reader();await restored(otherReader,otherFirst);otherReader=await go(secondUrl);await restored(otherReader,otherSecond);otherReader=await go(source);await restored(otherReader,otherFirst);
  await switchVault(directory);await loaded(source);first=await reader();await restored(first,firstProgress);await capture("restored");
  assert.deepEqual(await readFile(settingsPath),originalSettingsBytes);assert.deepEqual(await readFile(join(config,"workspace.json")),originalWorkspace);assert.deepEqual(await readFile(join(directory,"Welcome.md")),originalNote);await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');assert.deepEqual(await readFile(historyPath),originalHistory);assert.deepEqual(await files(),initialFiles);
  assert.deepEqual(await readFile(join(other,".obsidian","webviewer.json")),otherSettings);assert.deepEqual(await readFile(join(other,"Keep.md")),otherNote);assert.equal(await readFile(join(other,".obsidian","vault-dotnet-web-history.json"),"utf8"),otherHistory);assert.ok(requests.every(request=>request.token===null));assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'),"");
  pass("Full enabled/disabled restarts and repeated real same-URL vault switches restore multiple article positions, legacy/opaque state and independent pane histories; obsolete frames cannot alter another vault and exact notes/settings/browsing-history/original-workspace/BOM/CRLF/Unicode bytes survive");
}
