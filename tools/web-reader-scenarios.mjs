import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWebReader({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view";
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), settings = await readFile(settingsPath);
  const workspacePath = join(directory, ".obsidian", "workspace.json"), workspace = await readFile(workspacePath);
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(true,()=>true)');
  const history = async () => JSON.parse((await readFile(join(directory, ".obsidian", "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, ""));
  const idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "reader source loaded " + url);
  async function navigate(url) { await host.fill("[data-webviewer-address]", url); await host.click('[data-webviewer-action="go"]'); await loaded(url); }
  async function remotePage() {
    let target;
    await until(async () => { target = (await targets()).find(item => item.url.startsWith(origin)); return target; }, "reader source native contents");
    return connect(target);
  }
  async function readerContext() {
    const name = await host.evaluate('document.querySelector("[data-webviewer-reader]").name');
    const tree = (await host.command("Page.getFrameTree")).frameTree;
    const find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    const frame = find(tree);
    let evaluate;
    try {
      assert.ok(frame, "reader child frame is in the page tree");
      const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "reader-acceptance", grantUniveralAccess: false });
      evaluate = async expression => {
        const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) { throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); }
        return result.result.value;
      };
      await evaluate("document.title");
    } catch {
      for (const target of (await targets()).filter(target => target.type === "iframe")) {
        const candidate = await connect(target);
        if (await candidate.evaluate("window.name") === name) { evaluate = expression => candidate.evaluate(expression); break; }
      }
    }
    assert.ok(evaluate, "reader frame can be inspected independently through CDP");
    return {
      evaluate,
      click: async selector => {
        const point = await evaluate(`(async()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error("Reader element missing");await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));el.scrollIntoView({block:"center"});const b=el.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);if(hit!==el&&!el.contains(hit))throw new Error("Reader link is not reachable");return{x,y}})()`);
        const offset = await host.evaluate('(()=>{const b=document.querySelector("[data-webviewer-reader]").getBoundingClientRect();return{x:b.x,y:b.y}})()');
        await host.command("Page.bringToFront");
        await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + offset.x, y: point.y + offset.y });
        await host.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x + offset.x, y: point.y + offset.y, button: "left", clickCount: 1 });
        await host.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + offset.x, y: point.y + offset.y, button: "left", clickCount: 1 });
      },
    };
  }
  async function readable() {
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.reader.progressReady&&${view}.contentEl.querySelector("[data-webviewer-reader]")?.checkVisibility()&&JSON.parse(${view}.lastBounds).visible===false`, "isolated reader replaces the native surface with restored progress");
    return readerContext();
  }
  async function toggleOn() { await host.click('[data-webviewer-action="reader"]'); return readable(); }
  async function toggleOff() {
    await host.click('[data-webviewer-action="reader"]');
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"&&!document.querySelector("[data-webviewer-reader]")&&JSON.parse(${view}.lastBounds).visible===true`, "original surface restored without navigation");
  }

  await host.click('[data-core-ribbon="webviewer"]'); await loaded(origin + "/one");
  await navigate(origin + "/reader-story");
  let remote = await remotePage();
  await remote.fill("#original-input", "Retain this form value");
  await remote.evaluate('document.cookie="readerTransient=present;path=/";window.scrollTo(0,420)');
  const before = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,scrollY,cookie:document.cookie,loads:sessionStorage.readerLoads})');
  await idle(); const beforeVisits = (await history()).entries.length;
  const imageRequests = requests.filter(request => request.url === "/reader-image").length;
  let reader = await toggleOn();
  const content = await reader.evaluate('({title:document.querySelector("h1").textContent,text:document.querySelector("article").textContent,headings:document.querySelectorAll("article h2").length,table:document.querySelector("article table")?.textContent,unsafe:document.querySelectorAll("article script,article style,article iframe,article form,article input,article img,article [onclick],article [onerror]").length,links:[...document.querySelectorAll("article a[data-reader-url]")].map(a=>a.dataset.readerUrl)})');
  assert.equal(content.title, "A quiet place to read"); assert.ok(content.text.includes("中文 and 😀"));
  assert.ok(content.text.includes("const answer = 42;")); assert.ok(content.text.includes("A calm riverside"));
  assert.ok(!content.text.includes("Sidebar advertisement")); assert.ok(content.table.includes("Autumn")); assert.equal(content.headings, 1); assert.equal(content.unsafe, 0);
  assert.ok(content.links.includes(origin + "/reader-next")); assert.ok(!content.links.some(url => url.startsWith("javascript:")));
  assert.equal(requests.filter(request => request.url === "/reader-image").length, imageRequests);
  await host.wait('!document.querySelector(".notice")', "earlier history fixture notices expire before the reader screenshot");
  await capture("article");
  await toggleOff();
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#original-input").value,scrollY,cookie:document.cookie,loads:sessionStorage.readerLoads})'), before);
  await idle(); assert.equal((await history()).entries.length, beforeVisits);
  pass("Reader extracts the loaded article in an isolated world, retains Unicode/headings/code/tables/captions, omits navigation/active content and returns to identical source DOM, input, scroll, cookies and history");

  reader = await toggleOn();
  assert.deepEqual(await reader.evaluate('(()=>{let parentBlocked=false;try{void parent.app}catch{parentBlocked=true}return{require:typeof require,process:typeof process,parentBlocked}})()'), { require: "undefined", process: "undefined", parentBlocked: true });
  assert.equal(await host.evaluate('document.querySelector("[data-webviewer-reader]").getAttribute("sandbox")'), "allow-scripts");
  assert.equal(await host.evaluate('document.querySelector("[data-webviewer-reader]").contentDocument'), null);
  await reader.evaluate(`(()=>{const script=document.createElement("script");script.textContent=${JSON.stringify('document.body.dataset.readerInjected="yes"')};document.body.append(script)})()`);
  assert.equal(await reader.evaluate('document.body.dataset.readerInjected??null'), null);
  assert.equal(await remote.evaluate('(()=>{try{document.cloneNode(true);return false}catch(error){return error.message==="page clone override"}})()'), true);
  await reader.click('a[data-reader-url$="/api/vault"]');
  await host.wait('document.querySelector("[data-webviewer-reader-error]").textContent.includes("local application")', "reader links retain the native local-endpoint block");
  assert.equal(await host.evaluate(`${view}.getState().url`), origin + "/reader-story");
  assert.equal(await host.evaluate(`${view}.contentEl.dataset.webviewerReaderMode`), "reader");
  assert.ok(requests.every(request => request.token === null));
  pass("Reader has an opaque sandbox without Node/editor access, enforces its script CSP, ignores page-world prototype spoofing and preserves native URL/token boundaries");

  await host.click('[data-webviewer-action="find"]'); await host.fill("[data-webviewer-find]", "readneedle");
  await host.wait('document.querySelector("[data-webviewer-matches]").textContent==="1 of 2"', "reader literal find count");
  assert.equal((await reader.evaluate("getSelection().toString()")).toLowerCase(), "readneedle");
  await host.click('[data-webviewer-action="find-next"]'); await host.wait('document.querySelector("[data-webviewer-matches]").textContent==="2 of 2"', "reader next match");
  await host.click('[data-webviewer-action="find-previous"]'); await host.wait('document.querySelector("[data-webviewer-matches]").textContent==="1 of 2"', "reader previous match");
  await host.click('[data-webviewer-action="find-close"]');
  await reader.click('a[data-reader-url$="/reader-next"]'); await loaded(origin + "/reader-next"); reader = await readable();
  assert.equal(await reader.evaluate('document.querySelector("h1").textContent'), "Another readable article");
  await host.evaluate('app.commands.execute("webviewer:toggle-reader-mode")');
  await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "reader command returns to original");
  await host.evaluate('app.commands.execute("webviewer:toggle-reader-mode")'); await readable();
  pass("Find searches the displayed reader text with previous/next selection; safe links navigate and re-extract, and the owned reader command toggles the actual view");

  await toggleOff();
  for (const [path, message] of [["/reader-empty", "No readable article"], ["/reader-large", "too large"]]) {
    await navigate(origin + path); await host.click('[data-webviewer-action="reader"]');
    await host.wait(`document.querySelector("[data-webviewer-reader-error]").textContent.includes(${JSON.stringify(message)})&&${view}.contentEl.dataset.webviewerReaderMode==="page"&&JSON.parse(${view}.lastBounds).visible===true`, "reader failure retains the original page");
    assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false);
    assert.equal(await host.evaluate('document.querySelector("[data-webviewer-reader-error]").textContent.includes("webviewer:request")'), false);
  }
  await navigate(origin + "/reader-strict"); reader = await toggleOn();
  assert.equal(await reader.evaluate('document.querySelector("h1").textContent'), "A quiet place to read");
  await toggleOff();
  await host.click('[data-webviewer-action="reader"]'); await host.click('[data-webviewer-action="reader"]');
  await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"&&!document.querySelector("[data-webviewer-reader]")`, "rapid toggle releases reader output");
  pass("Short/non-article and oversized pages fail visibly without losing browsing; strict source CSP is supported and rapid cancellation/return leaves no reader frame");

  await toggleOn();
  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),futureReader:{keep:[1,true]}},active:true})})()`);
  await readable();
  await host.evaluate("app.workspace.flushLayout()"); await restart();
  reader = await readable();
  assert.equal(await host.evaluate(`${view}.getState().readerMode`), true);
  assert.deepEqual(await host.evaluate(`${view}.getState().futureReader`), { keep: [1, true] });
  assert.equal(await reader.evaluate('document.querySelector("h1").textContent'), "A quiet place to read");
  await capture("restored");
  pass("Reader mode and opaque leaf state persist through a full Electron/.NET restart and rebuild from the newly loaded source page");

  for (const enabled of [false, true]) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab"); await host.click('[data-core-toggle="webviewer"]');
    await host.wait(`!app.core.busy&&app.core.isEnabled("webviewer")===${enabled}`, "reader provider toggled"); await host.click(".settings-close");
    if (!enabled) {
      assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id==="webviewer:toggle-reader-mode")'), false);
      assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-reader]"))'), false);
      assert.equal(await host.evaluate(`${view}.getViewType()`), "unavailable");
      await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
    }
  }
  await readable();
  assert.deepEqual(await host.evaluate(`${view}.getState().futureReader`), { keep: [1, true] });
  await host.evaluate("app.workspace.closeLeaf(app.workspace.activeLeaf)");
  await host.wait('!document.querySelector("[data-webviewer-reader]")', "reader frame removed on pane close");
  await until(async () => !(await targets()).some(target => target.url.startsWith(origin)), "reader source contents released");
  assert.deepEqual(await readFile(settingsPath), settings); assert.deepEqual(await readFile(workspacePath), workspace);
  pass("Disable/disabled restart/re-enable retains reader intent, removes owned command/frames, closes native source contents and preserves original settings/workspace bytes");
}
