import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkClipTables({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-table-spans", note = "Web clips/Merged tables.md";
  const config = join(directory, ".obsidian"), settings = await readFile(join(config, "webviewer.json")), originalWorkspace = await readFile(join(config, "workspace.json")), originalNote = await readFile(join(directory, "Welcome.md"));
  const historyPath = join(config, "vault-dotnet-web-history.json"), idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "table source loaded " + url);
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "merged-table clip preview ready");
  const preview = async () => { await host.click('[data-webviewer-action="clip"]'); await ready(); return host.evaluate('document.querySelector("[data-web-clip-preview]").value'); };
  const close = async () => { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "table clip closed"); };
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); }
  async function reader() {
    await host.click('[data-webviewer-action="reader"]');
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.reader.progressReady`, "table Reader ready");
    const name = await host.evaluate('document.querySelector("[data-webviewer-reader]").name');
    const find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "clip-table-acceptance", grantUniveralAccess: false });
        const candidate = async expression => {
          const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) { throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value;
        };
        if (await candidate('Boolean(document.querySelector("main article table"))')) { evaluate = candidate; }
      } catch { /* The Reader may be an out-of-process iframe. */ }
      if (!evaluate) {
        for (const target of (await targets()).filter(item => item.type === "iframe")) {
          const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}`)) { evaluate = expression => candidate.evaluate(expression); break; }
        }
      }
      return Boolean(evaluate);
    }, "opaque table Reader execution context");
    return { evaluate };
  }
  async function original() { await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "table original page restored"); }
  const expected = [
    [["Region", "Forecast", "Forecast"], ["Region", "Spring", "Autumn"], ["North", "12", "Notes"], ["North", "a|b", "Literal | & ![[Secret]]"], ["South", "steady", "steady"], ["South", "5", "6"], ["Total", "30", "30"]],
    [["All", "Tall"], ["All", "Tall"], ["All", "Tall"], ["Footer", "Footer"]],
    [["Default", "Pair", "Pair"], ["One", "Two", "Three"]],
  ];
  async function reading() {
    await host.evaluate(`${view}.setMode("preview")`);
    await host.wait(`${view}.previewEl.querySelectorAll("table").length===3`, "saved merged-table Reading ready");
    assert.deepEqual(await host.evaluate(`[...${view}.previewEl.querySelectorAll("table")].map(table=>[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent)))`), expected);
    assert.equal(await host.evaluate(`${view}.previewEl.querySelector("tbody strong").textContent`), "12");
    assert.equal(await host.evaluate(`${view}.previewEl.querySelector("tbody code").textContent`), "a|b");
    assert.equal(await host.evaluate(`${view}.previewEl.querySelector("tbody em").textContent`), "steady");
    assert.equal(await host.evaluate(`${view}.previewEl.querySelector("tbody a").getAttribute("href")`), origin + "/table-notes?q=one#part");
    assert.equal(await host.evaluate(`${view}.previewEl.querySelectorAll("table table,table script,table img,table iframe").length`), 0);
  }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await idle();
  const history = await readFile(historyPath), initialFiles = await files();
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(origin + "/one")},true)`); await loaded(origin + "/one"); await navigate(source);
  const sourceId = await host.evaluate("app.workspace.activeLeaf.id");
  const reveal = async () => { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(sourceId)}))`); await loaded(source); };
  let target; await until(async () => { target = (await targets()).find(item => item.url === source); return target; }, "native table source target");
  const remote = await connect(target); await remote.fill("#table-original", "Keep original 中文 😀");
  const originalState = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#table-original").value,cookie:document.cookie,scroll:scrollY})');
  const markdown = await preview(), tables = marked.lexer(markdown).filter(token => token.type === "table");
  assert.equal(tables.length, 3);
  assert.deepEqual(tables[0].header.map(cell => cell.text), ["Region", "Forecast", "Forecast"], "native clip preview expands column spans without losing the third column");
  assert.deepEqual(tables[0].rows[0].map(cell => cell.text), ["Region", "Spring", "Autumn"], "native clip preview fills the second header row from its row span");
  assert.ok(markdown.includes("Shipping plan 中文 😀")); assert.ok(markdown.includes("| Total | 30 | 30 |"));
  assert.doesNotMatch(markdown, /<table|<td|<th|rowspan=|colspan=|page-world/); await capture("preview"); await close();
  const frame = await reader();
  assert.equal(await frame.evaluate('document.querySelectorAll("article table").length'), 3);
  assert.equal(await frame.evaluate('document.querySelector("article table thead th").rowSpan'), 2);
  assert.equal(await frame.evaluate('document.querySelector("article table thead th:nth-child(2)").colSpan'), 2);
  assert.equal(await frame.evaluate('document.querySelectorAll("article p[colspan],article p[rowspan]").length'), 0);
  assert.equal(await frame.evaluate('typeof require'), "undefined"); await frame.evaluate('document.querySelector("article table").scrollIntoView({block:"start"})'); await capture("reader");
  assert.equal(await preview(), markdown); await close(); await original();
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#table-original").value,cookie:document.cookie,scroll:scrollY})'), originalState);
  await idle(); assert.deepEqual(await readFile(historyPath), history); assert.deepEqual(await files(), initialFiles);
  pass("Actual isolated clipping expands column/row/zero spans and implied rows within ordered row groups, preserves captions/formatting/literal text, keeps original Reader spans and leaves source inputs/DOM/history/files unchanged");

  await preview(); await host.fill("[data-web-clip-path]", note);
  await host.evaluate('globalThis.tableCreateEvents=[];globalThis.tableCreateRef=app.vault.on("create",file=>tableCreateEvents.push(file.path));undefined');
  await host.click('[data-web-clip-action="save"]'); await host.wait(`!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "merged-table note saved and opened");
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown));
  assert.equal(await host.evaluate(`tableCreateEvents.filter(path=>path===${JSON.stringify(note)}).length`), 1); await host.evaluate('app.vault.offref(tableCreateRef);delete globalThis.tableCreateRef');
  await reading(); await host.evaluate(`${view}.previewEl.querySelector("table").scrollIntoView({block:"start"})`); await capture("saved");
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  pass("One normal Vault.create saves the exact reviewed Markdown; real Reading contains all three expanded grids with original column associations, row order, emphasis/code/absolute links and no active page markup");

  await reveal();
  for (const kind of ["nested", "overlap", "wide", "tall", "amplified"]) {
    await navigate(origin + "/clip-table-" + kind); await host.click('[data-webviewer-action="clip"]');
    await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="unavailable"&&/table/i.test(document.querySelector("[data-web-clip-error]").textContent)&&document.querySelector("[data-web-clip-action=save]").disabled', "unsupported or oversized table refused " + kind);
    if (kind === "overlap") { await capture("unsupported"); }
    await close();
    if (kind === "overlap") { const frame = await reader(); assert.equal(await frame.evaluate('document.querySelector("article td").colSpan'), 2); await original(); }
  }
  assert.deepEqual(await files(), [...initialFiles, note].sort()); await idle(); assert.deepEqual(await readFile(historyPath), history);
  await navigate(source); assert.equal(await preview(), markdown);
  await host.evaluate(`${view}.action("reload")`); await loaded(source);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); await close();
  assert.equal(await preview(), markdown); await close();
  pass("Nested/overlapping tables and expanded width/height/content limits fail visibly with Save disabled; no partial file/history changes occur, Reader remains available, reload invalidates old previews and supported clipping recovers");

  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview");await app.workspace.flushLayout()})()`); await restart();
  await host.wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "merged-table note restored after full restart"); await reading();
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown)); await reveal(); assert.equal(await preview(), markdown); await close();
  await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source);
  assert.equal(await preview(), markdown); await host.evaluate(`${view}.clip.path.value="Web clips/Stale table.md";globalThis.oldTableClip=${view}.clip;undefined`); await close();
  const other = join(directory, ".clip-tables-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther table vault 中文 😀.\r\n");
  await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n';
  await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "table vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "table vault switch " + path);
  }
  await switchVault(other); await host.evaluate("oldTableClip.saveNote()"); assert.deepEqual(await files(), ["Keep.md"]);
  assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); assert.equal(await preview(), markdown); await close();
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown)); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview")})()`); await reading(); await host.evaluate(`${view}.previewEl.querySelector("table").scrollIntoView({block:"start"})`); await capture("restored");
  pass("Enabled/disabled full restarts and real vault switches retain expanded table notes and exact settings/history/original-workspace/BOM/CRLF/Unicode bytes; transient previews never cross vaults and fresh extraction/saved Reading recover without stale workspace writes");
}
