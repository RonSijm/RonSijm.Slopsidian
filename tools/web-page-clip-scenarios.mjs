import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { parseDocument } from "yaml";
import { createPageClipPages } from "./web-page-clip-fixtures.mjs";

export async function checkPageClip({ host, restart, until, directory, pass, capture, targets, connect }) {
  const active = "app.workspace.activeLeaf.view", provider = 'app.core.getEnabledPluginById("webviewer")';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const sites = await createPageClipPages(), source = sites.origin + "/story?full-page=source", savedPath = "Page snapshots/Reviewed 中文.md";
  const keepPath = join(directory, "Full-page keep.md"), keep = Buffer.from("\ufeff# Keep\r\nFull-page fixture 中文 😀.\r\n");
  await writeFile(keepPath, keep, { flag: "wx" });
  let pane, sourceId, remote;
  const selector = child => pane + " " + child, button = action => host.click(selector('[data-webviewer-action="' + action + '"]'));
  const idle = () => host.evaluate(provider + ".history.whenIdle()");
  const loaded = async url => {
    await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".url===" + JSON.stringify(url) + "&&!" + active + ".loading&&!" + active + ".message.textContent&&!" + active + ".readerBusy", "full-page source ready " + url);
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
    let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "full-page native source"); remote = await connect(target);
    await remote.wait('document.readyState==="complete"', "full-page native document complete");
    await host.wait("!" + active + ".loading&&!" + active + ".readerBusy", "full-page native/Reader activity settled");
  };
  async function toggle(enabled) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    if (await host.evaluate('app.core.isEnabled("webviewer")') !== enabled) { await host.click('[data-core-toggle="webviewer"]'); }
    await host.wait('!app.core.busy&&app.core.isEnabled("webviewer")===' + enabled, "full-page provider toggle"); await host.click(".settings-close");
  }
  async function open(url) { await host.evaluate(provider + ".openUrl(" + JSON.stringify(url) + ",true)"); await loaded(url); }
  async function reveal(url = source) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(sourceId) + "))"); await loaded(url); }
  async function navigate(url) { await host.fill(selector("[data-webviewer-address]"), url); await button("go"); await loaded(url); }
  const previewText = () => host.evaluate('document.querySelector("[data-web-clip-preview]").value');
  async function ready() { await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "full-page preview ready"); }
  async function preview(command = false, properties = false) {
    if (command) { await host.evaluate('app.commands.execute("webviewer:save-page-to-vault")'); } else { await button("clip-page"); }
    await ready(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip]").dataset.webClipKind'), "page");
    if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked') !== properties) { await host.click("[data-web-clip-properties]"); await ready(); }
    return previewText();
  }
  async function close() { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "full-page preview closed"); }
  async function save(path) {
    await host.fill("[data-web-clip-path]", path); await host.click('[data-web-clip-action="save"]');
    await host.wait('!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===' + JSON.stringify(path), "full-page note saved");
  }
  function unpack(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(match);
    const document = parseDocument(match[1]); assert.deepEqual(document.errors, []); return { values: document.toJSON(), body: markdown.slice(match[0].length) };
  }
  function checkBody(markdown) {
    for (const word of ["Page navigation", "Sidebar note", "Footer note", "Page tail", "Page details", "**bold**", "*emphasis*", "7. Seventh item", "8. Eighth item", "Shared heading", "Left cell", "Right cell", "Page caption", "中文", "😀"]) { assert.ok(markdown.includes(word), "Full-page content includes " + word); }
    assert.ok(markdown.includes("](<" + sites.origin + "/assets/next?q=one#part>)"), "Actual base-resolved link retained");
    for (const secret of ["hidden-secret", "css-secret", "visibility-secret", "opacity-secret", "content-secret", "aria-secret", "form-secret", "input-secret", "textarea-secret", "select-secret", "editing-secret", "canvas-secret", "dialog-secret", "embedded-secret", "typed-private-secret"]) { assert.ok(!markdown.includes(secret), "Excluded " + secret); }
    const html = marked.parse(markdown);
    assert.ok(html.includes("[Image: A quiet riverside]"), "Image descriptions remain literal rendered text");
    assert.doesNotMatch(html, /<script|<iframe|<img|language-mermaid|javascript:/i);
    const code = marked.lexer(markdown).filter(token => token.type === "code");
    assert.ok(code.some(token => token.text.includes("graph TD") && !token.lang), "Page fences remain inert code");
  }
  async function reading(path, expected, text = "Footer note") {
    await host.evaluate(active + '.setMode("preview")');
    await host.wait("app.metadataCache.getFileCache(app.vault.getFileByPath(" + JSON.stringify(path) + "))?.frontmatter?.title===" + JSON.stringify(expected.title), "full-page note metadata ready");
    const actual = await host.evaluate("app.metadataCache.getFileCache(app.vault.getFileByPath(" + JSON.stringify(path) + ")).frontmatter");
    for (const [key, value] of Object.entries(expected)) { assert.deepEqual(actual[key], value); }
    await host.wait(active + ".previewEl.textContent.includes(" + JSON.stringify(text) + ")", "full-page Reading text ready");
    assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("script,iframe,img").length'), 0);
  }
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "full-page vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "full-page vault selected");
  }
  try {
    if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await toggle(true); }
    if (!await host.evaluate('app.core.isEnabled("properties")')) { await host.evaluate('app.core.setEnabled("properties",true)'); }
    await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
    const history = Buffer.from('\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":["中文",true]}}\r\n'); await writeFile(historyPath, history);
    await open(source); sourceId = await host.evaluate("app.workspace.activeLeaf.id");
    await remote.fill("#original-input", "typed-private-secret"); await remote.evaluate("scrollTo(0,160)");
    await remote.wait("scrollY>0", "source page scrolled before full capture");
    const state = await remote.evaluate("({html:document.documentElement.outerHTML,input:document.querySelector('#original-input').value,cookie:document.cookie,scroll:scrollY,runs:window.originalRuns,node:typeof require,opener:window.opener===null})");
    const count = sites.requests.length, fullPage = await preview(); checkBody(fullPage);
    assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").readOnly'), true);
    assert.equal(await host.evaluate(active + ".clip.preview.querySelectorAll('*').length"), 0);
    assert.ok((await host.evaluate('document.querySelector("[data-web-clip-path]").value')).endsWith("A full-page story page.md"));
    await capture("preview"); await close();
    assert.deepEqual(await remote.evaluate("({html:document.documentElement.outerHTML,input:document.querySelector('#original-input').value,cookie:document.cookie,scroll:scrollY,runs:window.originalRuns,node:typeof require,opener:window.opener===null})"), state);
    assert.equal(sites.requests.length, count); assert.equal(state.node, "undefined"); assert.equal(state.opener, true);
    await preview(true); await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-clip]")', "Escape full-page preview");
    await button("clip"); await ready(); if (await host.evaluate('document.querySelector("[data-web-clip-properties]").checked')) { await host.click("[data-web-clip-properties]"); }
    const article = await previewText(); assert.ok(article.includes("Page details")); assert.ok(!article.includes("Page navigation") && !article.includes("Footer note") && !article.includes("Sidebar note")); await close();
    await idle(); assert.deepEqual(await readFile(historyPath), history);
    pass("Actual Save page toolbar/owned command previews loaded main-document navigation/sidebar/article/footer text independently of article detection, preserves base-resolved links/decimal lists/expanded tables/image descriptions/inert code, excludes hidden/control/frame/media content and cancels without requests, scrolling, DOM/input/cookie/history changes or privilege leakage");

    await preview(false, true);
    const title = 'Full page: "reviewed" 中文 😀', tags = "#page, project/nested, 中文, page";
    await host.fill("[data-web-clip-property-title]", title); await host.fill("[data-web-clip-property-tags]", tags); await ready();
    const reviewed = await previewText(), values = unpack(reviewed).values; checkBody(unpack(reviewed).body);
    assert.equal(values.title, title); assert.equal(values.source, source); assert.deepEqual(values.tags, ["page", "project/nested", "中文"]); assert.equal(new Date(values.clipped).toISOString(), values.clipped);
    await remote.evaluate('document.querySelector("#snapshot-text").textContent="Updated live page after preview."');
    const collision = "Page snapshots/Existing.md", external = Buffer.from("\ufeffDo not replace\r\n中文 😀.\r\n");
    await mkdir(join(directory, "Page snapshots"), { recursive: true }); await writeFile(join(directory, collision), external, { flag: "wx" });
    await host.fill("[data-web-clip-path]", collision); await host.click('[data-web-clip-action="save"]');
    await host.wait('!document.querySelector("[data-web-clip-error]").hidden&&!document.querySelector("[data-web-clip-action=save]").disabled', "full-page collision retained");
    assert.deepEqual(await readFile(join(directory, collision)), external); assert.equal(await previewText(), reviewed);
    await host.evaluate('globalThis.pageClipCreates=[];globalThis.pageClipCreateRef=app.vault.on("create",file=>pageClipCreates.push(file.path));undefined');
    await save(savedPath); assert.deepEqual(await readFile(join(directory, savedPath)), Buffer.from(reviewed));
    assert.equal(await host.evaluate("pageClipCreates.filter(path=>path===" + JSON.stringify(savedPath) + ").length"), 1);
    await host.evaluate("app.vault.offref(pageClipCreateRef);delete globalThis.pageClipCreateRef");
    await reading(savedPath, values); await capture("saved"); await reveal();
    assert.equal(await remote.evaluate('document.querySelector("#snapshot-text").textContent'), "Updated live page after preview.");
    assert.equal(await remote.evaluate('document.querySelector("#original-input").value'), "typed-private-secret");
    await idle(); assert.deepEqual(await readFile(historyPath), history);
    pass("Full-page previews share actual optional title/source/time/tags and path controls; an external BOM/CRLF collision refuses without overwrite, correction creates exactly the reviewed UTF-8 snapshot once and real metadata/Reading remains inert, while a bounded later live-DOM update is retained in the source without changing the reviewed saved note");

    await button("reader"); await host.wait(active + '.contentEl.dataset.webviewerReaderMode==="reader"', "Reader ready for full-page distinction");
    const readerName = await host.evaluate(active + ".reader.frame.name"), beforeReaderRequests = sites.requests.length;
    const fromReader = await preview(true); checkBody(fromReader); assert.ok(marked.parse(fromReader).includes("Updated live page after preview."));
    assert.equal(await host.evaluate('document.querySelector("[data-web-clip]").dataset.webClipSource'), "page"); await close();
    assert.equal(await host.evaluate(active + ".reader.frame.name"), readerName); assert.equal(sites.requests.length, beforeReaderRequests);
    await navigate(sites.origin + "/short"); const short = await preview(); assert.ok(short.includes("# Short page") && short.endsWith("X\n")); await close();
    if (await host.evaluate(active + ".readerWanted")) { await button("reader"); await host.wait("!" + active + ".readerWanted", "short-page Reader intent cleared"); }
    await host.evaluate("app.vault.refresh()");
    const existingFiles = await host.evaluate("app.vault.getFiles().map(file=>file.path).sort()");
    for (const [path, error] of [["empty", "No supported visible"], ["large", "too large"], ["elements", "too large"], ["numbering", "numbering"], ["hidden-table", "hidden rows"], ["wide-table", "too large"]]) {
      await navigate(sites.origin + "/" + path); await button("clip-page");
      await host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="unavailable"', "refused full-page " + path);
      assert.ok((await host.evaluate('document.querySelector("[data-web-clip-error]").textContent')).includes(error)); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); await close();
    }
    assert.deepEqual(await host.evaluate("app.vault.getFiles().map(file=>file.path).sort()"), existingFiles);
    await navigate(source); await preview(); const navigation = await host.evaluate(active + ".navigationId");
    await host.evaluate("globalThis.expiredPageClip=" + active + ".clip;undefined"); await remote.command("Page.reload");
    await host.wait(active + ".navigationId>" + navigation + "&&!" + active + ".loading", "real same-URL page reload");
    await host.wait('document.querySelector("[data-web-clip-action=save]").disabled', "full-page obsolete preview disabled");
    assert.equal(await host.evaluate('(()=>{try{expiredPageClip.actions.guard();return false}catch{return true}})()'), true);
    await capture("expired"); await close(); assert.deepEqual(await readFile(join(directory, savedPath)), Buffer.from(reviewed));
    await idle(); assert.deepEqual(await readFile(historyPath), history);
    pass("Save page from Reader still captures the original main document without replacing the Reader frame or fetching resources; short non-articles are accepted, empty/oversized/over-element/unsupported-list/hidden-table/wide-table pages refuse visibly without notes, and real same-URL reload expires an old preview before saving");

    await loaded(source); const stateNavigation = await host.evaluate(active + ".navigationId");
    await host.evaluate('app.workspace.activeLeaf.setViewState({type:"webviewer",state:{...app.workspace.activeLeaf.view.getState(),future:{keep:["page",true]}},active:true})');
    await host.wait(active + ".navigationId>" + stateNavigation + "&&!" + active + ".loading", "full-page imported state committed"); await loaded(source);
    await preview(false, true); await host.fill("[data-web-clip-property-title]", "Unsaved page draft");
    const leafState = await host.evaluate(active + ".getState()"); assert.equal(Object.hasOwn(leafState, "fullPage"), false); assert.equal(Object.hasOwn(leafState, "markdown"), false);
    await host.evaluate("app.workspace.flushLayout()"); await restart(); await reveal();
    assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-clip]"))'), false); assert.deepEqual(await host.evaluate(active + ".getState().future"), { keep: ["page", true] });
    await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-title]").value'), "A full-page story"); await close();
    await toggle(false); await host.evaluate("app.workspace.flushLayout()"); await restart();
    assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id==="webviewer:save-page-to-vault")'), false);
    assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-action=clip-page]"))'), false); await toggle(true); await reveal();
    await preview(); await host.evaluate("globalThis.foreignPageClip=" + active + ".clip;undefined"); await close();
    const target = join(directory, ".full-page-other-vault"), targetConfig = join(target, ".obsidian");
    const targetSettings = Buffer.from('\ufeff{"enableAdblocking":false,"markdownPath":"Target pages","clipIncludeProperties":false,"clipDefaultTags":"","future":{"keep":"target"}}\r\n'), targetNote = Buffer.from("\ufeff# Keep\r\nTarget page 中文 😀.\r\n");
    await mkdir(targetConfig, { recursive: true }); await writeFile(join(targetConfig, "webviewer.json"), targetSettings); await writeFile(join(target, "Keep.md"), targetNote);
    await writeFile(join(targetConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
    await writeFile(join(targetConfig, "vault-dotnet-web-history.json"), history);
    await switchVault(target); await open(source); const targetId = await host.evaluate("app.workspace.activeLeaf.id"), targetClip = await preview();
    assert.equal(await host.evaluate('(()=>{try{foreignPageClip.actions.guard();return false}catch{return true}})()'), true);
    assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-tags]").value'), "");
    await save("Target pages/Own.md"); assert.deepEqual(await readFile(join(target, "Target pages/Own.md")), Buffer.from(targetClip));
    await switchVault(directory); await reveal(); assert.deepEqual(await host.evaluate(active + ".getState().future"), { keep: ["page", true] });
    await switchVault(target); await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(targetId) + "))"); await loaded(source);
    await switchVault(directory); await reveal();
    await host.evaluate("app.openFile(" + JSON.stringify(savedPath) + ',"tab")'); await reading(savedPath, values); await capture("restored");
    assert.deepEqual(await readFile(join(directory, savedPath)), Buffer.from(reviewed)); assert.deepEqual(await readFile(join(directory, collision)), external);
    assert.deepEqual(await readFile(keepPath), keep); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
    assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(historyPath), history);
    assert.deepEqual(await readFile(join(targetConfig, "webviewer.json")), targetSettings); assert.deepEqual(await readFile(join(target, "Keep.md")), targetNote);
    assert.deepEqual(await readFile(join(targetConfig, "vault-dotnet-web-history.json")), history); assert.deepEqual(await readFile(join(target, "Target pages/Own.md")), Buffer.from(targetClip));
    assert.ok(sites.requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
    pass("Full enabled/disabled restarts discard page previews/drafts and clean up the owned command/controls while retaining saved notes and opaque leaf state; repeated actual same-URL vault switches isolate defaults and note creation, obsolete source callbacks refuse, and exact source/target notes/settings/history/original-workspace/BOM/CRLF/Unicode bytes survive");
  } finally { await sites.close(); }
}
