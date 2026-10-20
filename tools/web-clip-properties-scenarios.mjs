import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkClipProperties({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-story", note = "Web clips/Article properties.md", selectedNote = "Web clips/Selection properties.md";
  const config = join(directory, ".obsidian"), settings = await readFile(join(config, "webviewer.json")), originalWorkspace = await readFile(join(config, "workspace.json")), originalNote = await readFile(join(directory, "Welcome.md"));
  const historyPath = join(config, "vault-dotnet-web-history.json"), idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "properties source loaded " + url);
  const close = async () => { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "properties preview closed"); };
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "properties clip ready");
  const previewText = () => host.evaluate('document.querySelector("[data-web-clip-preview]").value');
  const controlsVisible = async () => assert.equal(await host.evaluate('(()=>{const modal=document.querySelector(".web-clip-modal").getBoundingClientRect();return[...document.querySelectorAll("[data-web-clip-action]")].every(button=>{const rect=button.getBoundingClientRect();return rect.top>=modal.top&&rect.bottom<=modal.bottom&&rect.top>=0&&rect.bottom<=innerHeight})})()'), true, "Save and Cancel remain visible without scrolling the properties form");
  async function preview(selection = false) { await host.click(selection ? '[data-webviewer-action="clip-selection"]' : '[data-webviewer-action="clip"]'); await ready(); return previewText(); }
  let remote;
  async function connectSource(url = source) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native properties source"); remote = await connect(target); }
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); await connectSource(url); }
  function unpack(markdown) { const match = markdown.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(match); const document = parseDocument(match[1]); assert.deepEqual(document.errors, []); return { values: document.toJSON(), body: markdown.slice(match[0].length) }; }
  const title = 'Reviewed: "title" & 中文 😀', tags = "#research, project/nested, 中文, research";
  async function decorate(propertyTitle = title, propertyTags = tags) {
    await host.click("[data-web-clip-properties]"); await host.fill("[data-web-clip-property-title]", propertyTitle); await host.fill("[data-web-clip-property-tags]", propertyTags); await ready(); return previewText();
  }
  async function reading(path, expected, bodyText) {
    await host.evaluate(`${view}.setMode("preview")`);
    await host.wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter?.title===${JSON.stringify(expected.title)}`, "saved clipping metadata ready");
    const metadata = await host.evaluate(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)})).frontmatter`);
    for (const [name, value] of Object.entries(expected)) { assert.deepEqual(metadata[name], value); }
    await host.wait(`${view}.previewEl.textContent.includes(${JSON.stringify(bodyText)})`, "saved properties Reading ready");
    await host.wait(`${view}.metadataEditor.contentEl.querySelectorAll("[data-property-key]").length===4&&!${view}.metadataEditor.contentEl.hidden`, "actual four-row note Properties ready");
    assert.equal(await host.evaluate(`${view}.metadataEditor.contentEl.querySelector('[data-property-key="title"] .metadata-property-value').textContent`), expected.title);
    assert.equal(await host.evaluate(`${view}.previewEl.querySelectorAll("script,iframe,img").length`), 0);
  }
  async function save(path) {
    await host.fill("[data-web-clip-path]", path); await host.click('[data-web-clip-action="save"]');
    await host.wait(`!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "properties note saved " + path);
  }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  if (!await host.evaluate('app.core.isEnabled("properties")')) { await host.evaluate('app.core.setEnabled("properties",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await idle();
  const history = await readFile(historyPath), initialFiles = await files();
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(origin + "/one")},true)`); await loaded(origin + "/one"); await navigate(source);
  const sourceId = await host.evaluate("app.workspace.activeLeaf.id"), reveal = async url => { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(sourceId)}))`); await loaded(url); await connectSource(url); };
  await remote.fill("#clip-original", "Keep properties source 中文 😀");
  const sourceState = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#clip-original").value,cookie:document.cookie,scroll:scrollY})'), requestCount = requests.length;
  const base = await preview();
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-clip-properties]"))'), true, "Clipping preview provides optional note properties");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), false); assert.ok(!base.startsWith("---"));
  const articleMarkdown = await decorate(), article = unpack(articleMarkdown);
  assert.equal(article.body, base); assert.equal(article.values.title, title); assert.equal(article.values.source, source); assert.deepEqual(article.values.tags, ["research", "project/nested", "中文"]);
  assert.equal(new Date(article.values.clipped).toISOString(), article.values.clipped); assert.ok(Math.abs(Date.now() - Date.parse(article.values.clipped)) < 60_000);
  await host.fill("[data-web-clip-property-title]", title + " edited"); assert.equal(unpack(await previewText()).values.clipped, article.values.clipped);
  await host.click("[data-web-clip-properties]"); assert.equal(await previewText(), base); await host.click("[data-web-clip-properties]"); await host.fill("[data-web-clip-property-title]", title); assert.equal(await previewText(), articleMarkdown);
  assert.doesNotMatch(await host.evaluate(`JSON.stringify(${view}.getState())`), /Reviewed:|project\/nested/);
  await controlsVisible(); await capture("preview"); await close();
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#clip-original").value,cookie:document.cookie,scroll:scrollY})'), sourceState); assert.equal(requests.length, requestCount);
  await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), false); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-title]").value'), "A clipping story");
  await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-clip]")', "Escape drops optional properties");
  assert.deepEqual(await files(), initialFiles); await idle(); assert.deepEqual(await readFile(historyPath), history);
  pass("Opt-in clipping properties preview safely quoted title/source/time/tags, normalized nested Unicode tags and an unchanged article body; toggling is reversible, time is stable, Cancel/Escape reset drafts, and source DOM/input/cookies/scroll/history/files stay unchanged");

  await preview(); const savedArticle = await decorate(), savedMetadata = unpack(savedArticle).values;
  await host.evaluate('globalThis.propertyCreates=[];globalThis.propertyCreateRef=app.vault.on("create",file=>propertyCreates.push(file.path));undefined'); await save(note);
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(savedArticle)); assert.equal(await host.evaluate(`propertyCreates.filter(path=>path===${JSON.stringify(note)}).length`), 1);
  await reading(note, savedMetadata, "Remember this heading"); await capture("saved");
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  pass("One normal Vault.create writes the exact reviewed article/frontmatter bytes and opens real Properties/Reading with four typed metadata values; existing notes/settings/original-workspace bytes remain intact");

  await reveal(source); await navigate(origin + "/clip-selection");
  await remote.evaluate('(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector("#selection-multi"));const selection=fixtureSelection();selection.removeAllRanges();selection.addRange(range)})()');
  const selectedBase = await preview(true); const selectedMarkdown = await decorate("true", "selection, project/nested"), selected = unpack(selectedMarkdown);
  assert.equal(selected.body, selectedBase); assert.equal(selected.values.title, "true");
  await host.fill("[data-web-clip-property-tags]", "invalid tag");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); assert.equal(await previewText(), "");
  assert.match(await host.evaluate('document.querySelector("[data-web-clip-error]").textContent'), /tag/i); await controlsVisible(); await capture("invalid");
  await host.click("[data-web-clip-properties]"); assert.equal(await previewText(), selectedBase); await ready(); await host.click("[data-web-clip-properties]"); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true);
  await host.fill("[data-web-clip-property-tags]", "selection, project/nested"); await ready(); assert.equal(await previewText(), selectedMarkdown);
  const collision = "Web clips/External properties.md", collisionBytes = Buffer.from("\ufeff---\r\nkeep: true\r\n---\r\nKeep external 中文 😀.\r\n"); await writeFile(join(directory, collision), collisionBytes);
  await host.fill("[data-web-clip-path]", collision); await host.click('[data-web-clip-action="save"]'); await host.wait('!document.querySelector("[data-web-clip-error]").hidden&&!document.querySelector("[data-web-clip-action=save]").disabled', "properties collision can be corrected");
  assert.deepEqual(await readFile(join(directory, collision)), collisionBytes); assert.equal(await previewText(), selectedMarkdown); await save(selectedNote);
  assert.deepEqual(await readFile(join(directory, selectedNote)), Buffer.from(selectedMarkdown)); assert.equal(await host.evaluate(`propertyCreates.filter(path=>path===${JSON.stringify(selectedNote)}).length`), 1);
  await reading(selectedNote, selected.values, "First selected paragraph bold words.");
  await host.evaluate('app.vault.offref(propertyCreateRef);delete globalThis.propertyCreateRef'); await reveal(origin + "/clip-selection");
  await remote.evaluate('(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector("#selection-short"));const selection=fixtureSelection();selection.removeAllRanges();selection.addRange(range)})()'); await preview(true); await decorate("Stale", "selection");
  await host.evaluate(`${view}.action("reload")`); await loaded(origin + "/clip-selection");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").disabled'), true); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-title]").disabled'), true); await close();
  await idle(); assert.deepEqual(await readFile(historyPath), history);
  pass("Selected-text clips share reviewed properties without changing literal body/type semantics; invalid tags disable Save and clear stale previews, correction/opt-out recover, external BOM/CRLF collisions preserve both drafts and original bytes, and reload disables every stale property control");

  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview");await app.workspace.flushLayout()})()`); await restart();
  await host.wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "properties note restores after restart"); await reading(note, savedMetadata, "Remember this heading");
  await reveal(origin + "/clip-selection"); await navigate(source); await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), false); await close();
  await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); await connectSource(); await preview(); await decorate("Foreign draft", "foreign");
  await host.evaluate(`${view}.clip.path.value="Web clips/Stale properties.md";globalThis.oldPropertiesClip=${view}.clip;undefined`); await close();
  const other = join(directory, ".clip-properties-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther properties vault 中文 😀.\r\n"); await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) { await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "properties vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault"); await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "properties vault switch " + path); }
  await switchVault(other); await host.evaluate("oldPropertiesClip.saveNote()"); assert.deepEqual(await files(), ["Keep.md"]); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), false); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-tags]").value'), ""); await close();
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(savedArticle)); assert.deepEqual(await readFile(join(directory, selectedNote)), Buffer.from(selectedMarkdown)); assert.deepEqual(await readFile(join(directory, collision)), collisionBytes);
  await idle(); assert.deepEqual(await readFile(historyPath), history); assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await host.evaluate(`(async()=>{await app.openFile(${JSON.stringify(note)},"tab");app.workspace.activeLeaf.view.setMode("preview")})()`); await reading(note, savedMetadata, "Remember this heading"); await capture("restored");
  pass("Enabled/disabled full restarts and real vault switches retain saved frontmatter and actual metadata/Reading while optional drafts/defaults never restore or leak; obsolete saves refuse foreign vaults and exact note/config/history/original-workspace/Unicode bytes survive");
}
