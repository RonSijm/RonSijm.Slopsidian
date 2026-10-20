import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkClipLists({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-list-numbering", note = "Web clips/List numbering.md";
  const config = join(directory, ".obsidian"), settings = await readFile(join(config, "webviewer.json")), originalWorkspace = await readFile(join(config, "workspace.json")), originalNote = await readFile(join(directory, "Welcome.md"));
  const historyPath = join(config, "vault-dotnet-web-history.json"), idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "numbered-list source loaded " + url);
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "numbered-list clip preview ready");
  const preview = async () => { await host.click('[data-webviewer-action="clip"]'); await ready(); return host.evaluate('document.querySelector("[data-web-clip-preview]").value'); };
  const close = async () => { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "numbered-list clip closed"); };
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); }
  async function reader() {
    await host.click('[data-webviewer-action="reader"]');
    await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"&&${view}.reader.progressReady`, "numbered-list Reader ready");
    const name = await host.evaluate('document.querySelector("[data-webviewer-reader]").name');
    const find = node => node.frame.name === name ? node.frame : node.childFrames?.map(find).find(Boolean);
    let evaluate;
    await until(async () => {
      try {
        const frame = find((await host.command("Page.getFrameTree")).frameTree); assert.ok(frame);
        const { executionContextId } = await host.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "clip-list-acceptance", grantUniveralAccess: false });
        const candidate = async expression => {
          const result = await host.command("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) { throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); } return result.result.value;
        };
        if (await candidate('Boolean(document.querySelector("main article ol"))')) { evaluate = candidate; }
      } catch { /* The Reader may be an out-of-process iframe. */ }
      if (!evaluate) {
        for (const target of (await targets()).filter(item => item.type === "iframe")) {
          const candidate = await connect(target); if (await candidate.evaluate(`window.name===${JSON.stringify(name)}`)) { evaluate = expression => candidate.evaluate(expression); break; }
        }
      }
      return Boolean(evaluate);
    }, "numbered-list opaque Reader execution context");
    return { evaluate };
  }
  async function original() { await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "numbered-list original page restored"); }
  const expected = [7, 21, 12, 0, 15, 1, 999_999_999];
  async function reading() {
    await host.evaluate(`${view}.setMode("preview")`);
    await host.wait(`${view}.previewEl.querySelectorAll("ol").length===7`, "saved numbered-list Reading render ready");
    assert.deepEqual(await host.evaluate(`[...${view}.previewEl.querySelectorAll("ol")].map(list=>list.start)`), expected);
    assert.equal(await host.evaluate(`[...${view}.previewEl.querySelectorAll("ol")].every(list=>list.children.length===2)`), true);
  }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await idle();
  const history = await readFile(historyPath), initialFiles = await files();
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(origin + "/one")},true)`); await loaded(origin + "/one");
  await navigate(source);
  const sourceId = await host.evaluate("app.workspace.activeLeaf.id");
  const reveal = async url => { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(sourceId)}))`); await loaded(url); };
  let target; await until(async () => { target = (await targets()).find(item => item.url === source); return target; }, "numbered-list native source target");
  const remote = await connect(target); await remote.fill("#list-original", "Keep original 中文 😀");
  const originalState = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#list-original").value,cookie:document.cookie,scroll:scrollY})');
  const markdown = await preview();
  assert.ok(markdown.includes("7. List seven"), "native clip preview retains ordered start seven");
  for (const text of ["21. Nested twenty\\-one", "22. Nested twenty\\-two", "8. List eight", "12) Separate twelve", "0. Zero step", "15) Override fifteen", "999999999) Boundary first"]) { assert.ok(markdown.includes(text), text + " retained in preview"); }
  const lists = [], visit = tokens => { for (const token of tokens) { if (token.type === "list") { if (token.ordered) { lists.push(token.start); } for (const item of token.items) { visit(item.tokens); } } else if (token.tokens) { visit(token.tokens); } } };
  visit(marked.lexer(markdown)); assert.deepEqual(lists, expected);
  assert.doesNotMatch(markdown, /<ol|<li|onmouseover|window\.badList/); await capture("preview"); await close();
  const frame = await reader();
  assert.deepEqual(await frame.evaluate('[...document.querySelectorAll("article ol")].map(list=>list.start)'), [7, 21, 12, 0, 3, 1, 999_999_999]);
  assert.equal(await frame.evaluate(`document.querySelectorAll('article li[value="15"]').length`), 1);
  assert.equal(await frame.evaluate('document.querySelectorAll("article p[start],article p[reversed],article p[value],[onmouseover]").length'), 0);
  assert.equal(await frame.evaluate('typeof require'), "undefined"); await frame.evaluate('document.querySelector("article ol").scrollIntoView({block:"start"})'); await capture("reader");
  assert.equal(await preview(), markdown); await close(); await original();
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#list-original").value,cookie:document.cookie,scroll:scrollY})'), originalState);
  await idle(); assert.deepEqual(await readFile(historyPath), history); assert.deepEqual(await files(), initialFiles);
  pass("Actual isolated extraction/Reader and text previews preserve decimal starts, nested and adjacent lists, zero, first-item overrides and nine-digit boundaries without raw HTML, page-world spoofing, misplaced numbering attributes, source changes or history writes");

  await preview(); await host.fill("[data-web-clip-path]", note);
  await host.evaluate('globalThis.listCreateEvents=[];globalThis.listCreateRef=app.vault.on("create",file=>listCreateEvents.push(file.path));undefined');
  await host.click('[data-web-clip-action="save"]'); await host.wait(`!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "numbered-list note saved and opened");
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown));
  assert.equal(await host.evaluate(`listCreateEvents.filter(path=>path===${JSON.stringify(note)}).length`), 1); await host.evaluate('app.vault.offref(listCreateRef);delete globalThis.listCreateRef');
  await reading(); await host.evaluate(`${view}.previewEl.querySelector("ol").scrollIntoView({block:"start"})`); await capture("saved");
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote);
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  pass("Saving creates the exact reviewed Markdown once and opens a real Reading view with all seven original list starts and nesting intact; existing note/settings/original-workspace bytes remain unchanged");

  await reveal(source);
  for (const kind of ["reversed", "negative", "reset", "oversized"]) {
    await navigate(origin + "/clip-list-" + kind); await host.click('[data-webviewer-action="clip"]');
    await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="unavailable"&&document.querySelector("[data-web-clip-error]").textContent.includes("numbering")&&document.querySelector("[data-web-clip-action=save]").disabled', "unrepresentable numbering refused " + kind);
    if (kind === "reversed") { await capture("unsupported"); }
    await close();
    if (kind === "reversed") { const reversed = await reader(); assert.equal(await reversed.evaluate('document.querySelector("article ol").reversed'), true); assert.equal(await reversed.evaluate('document.querySelector("article ol").start'), 3); await original(); }
  }
  assert.deepEqual(await files(), [...initialFiles, note].sort()); await idle(); assert.deepEqual(await readFile(historyPath), history);
  await navigate(source); assert.equal(await preview(), markdown); await close();
  pass("Reversed, negative, oversized and discontinuous numbering fail visibly with Save disabled instead of producing a renumbered note; original browsing and Reader remain available, no files/history change, and a supported retry succeeds");

  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview");await app.workspace.flushLayout()})()`); await restart();
  await host.wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "numbered-list note restored after full restart"); await reading();
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown));
  await reveal(source); assert.equal(await preview(), markdown); await close();
  await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source);
  assert.equal(await preview(), markdown);
  await host.evaluate(`${view}.clip.path.value="Web clips/Stale list.md";globalThis.oldListClip=${view}.clip;undefined`);
  await close();
  const other = join(directory, ".clip-lists-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther list vault 中文 😀.\r\n");
  await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n';
  await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "numbered-list vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "numbered-list vault switch " + path);
  }
  await switchVault(other); await host.evaluate("oldListClip.saveNote()"); assert.deepEqual(await files(), ["Keep.md"]);
  assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); assert.equal(await preview(), markdown); await close();
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(markdown)); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await capture("restored");
  pass("Full enabled/disabled restarts and actual vault switches retain the saved numbered note and exact settings/history/BOM/CRLF/Unicode bytes; previews are transient, obsolete saves cannot cross vaults, and fresh clipping recovers without token exposure or stale workspace writes");
}
