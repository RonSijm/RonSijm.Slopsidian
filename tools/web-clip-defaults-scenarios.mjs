import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkClipDefaults({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-story", selectionSource = origin + "/clip-selection";
  const config = join(directory, ".obsidian"), settingsPath = join(config, "webviewer.json"), originalSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  const originalNote = await readFile(join(directory, "Welcome.md")), originalWorkspace = await readFile(join(config, "workspace.json"));
  const historyPath = join(config, "vault-dotnet-web-history.json"), articlePath = "Web clips/Default properties.md", selectionPath = "Web clips/Default selection.md";
  const files = () => host.evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  const idle = () => host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "defaults source loaded " + url);
  const defaults = () => host.evaluate('(()=>{const settings=app.core.state("webviewer").settings;return{clipIncludeProperties:settings.clipIncludeProperties,clipDefaultTags:settings.clipDefaultTags}})()');
  const expectedDefaults = { clipIncludeProperties: true, clipDefaultTags: "research,project/nested,中文" };
  const inputTags = "#research, project/nested, 中文, research";
  async function settings() {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    await host.click('[data-core-settings="webviewer"]');
  }
  async function setOptions(enabled, tags) {
    if (await host.evaluate('document.querySelector("[data-core-field=clipIncludeProperties]").checked') !== enabled) { await host.click("[data-core-field=clipIncludeProperties]"); }
    await host.fill("[data-core-field=clipDefaultTags]", tags);
    await host.click('[data-core-save="webviewer"]');
  }
  async function savedOptions(expected) {
    await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.clipIncludeProperties===${expected.clipIncludeProperties}&&app.core.state("webviewer").settings.clipDefaultTags===${JSON.stringify(expected.clipDefaultTags)}`, "default settings saved");
  }
  let remote;
  async function connectSource(url) { let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native defaults source"); remote = await connect(target); }
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); await connectSource(url); }
  const previewText = () => host.evaluate('document.querySelector("[data-web-clip-preview]").value');
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "defaults preview ready");
  async function preview(selection = false) { await host.click(`[data-webviewer-action=${JSON.stringify(selection ? "clip-selection" : "clip")}]`); await ready(); return previewText(); }
  async function close() { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "defaults preview closed"); }
  function unpack(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(match);
    const parsed = parseDocument(match[1]); assert.deepEqual(parsed.errors, []);
    return { values: parsed.toJSON(), body: markdown.slice(match[0].length) };
  }
  async function save(path) {
    await host.fill("[data-web-clip-path]", path); const markdown = await previewText();
    await host.click('[data-web-clip-action="save"]');
    await host.wait(`!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "defaults note saved " + path);
    assert.deepEqual(await readFile(join(directory, path)), Buffer.from(markdown));
    const expected = unpack(markdown).values;
    await host.wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter?.clipped===${JSON.stringify(expected.clipped)}`, "default note metadata ready");
    const metadata = await host.evaluate(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)})).frontmatter`);
    for (const [key, value] of Object.entries(expected)) { assert.deepEqual(metadata[key], value); }
    await host.evaluate(`${view}.setMode("preview")`);
    await host.wait(`${view}.previewEl.querySelector("h1")?.textContent===${JSON.stringify(expected.title)}`, "default note Reading ready");
    return markdown;
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.setRecording(false,()=>true)'); await idle();
  const history = await readFile(historyPath), initialFiles = await files();
  assert.deepEqual(await defaults(), { clipIncludeProperties: false, clipDefaultTags: "" });
  await settings();
  assert.equal(await host.evaluate('document.querySelector("[data-core-field=clipIncludeProperties]").type'), "checkbox");
  const beforeInvalid = await readFile(settingsPath);
  await setOptions(true, "bad tag"); await host.wait('!app.core.busy&&document.querySelector("#core-settings-error")?.textContent.includes("tags")', "invalid default error visible");
  assert.doesNotMatch(await host.evaluate('document.querySelector("#core-settings-error").textContent'), /Host \d+:|remote method/i);
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "", "Correctable settings errors stay in the Settings alert without covering the page toolbar");
  assert.deepEqual(await readFile(settingsPath), beforeInvalid); assert.deepEqual(await defaults(), { clipIncludeProperties: false, clipDefaultTags: "" });
  await setOptions(true, inputTags); await savedOptions(expectedDefaults);
  await host.evaluate('document.querySelector("[data-core-save=webviewer]").scrollIntoView({block:"nearest"})'); await capture("settings"); await host.click(".settings-close");
  const configuredSettings = await readFile(settingsPath), stored = JSON.parse(configuredSettings);
  for (const [key, value] of Object.entries(originalSettings)) { if (!key.startsWith("clip")) { assert.deepEqual(stored[key], value); } }
  assert.deepEqual(await defaults(), expectedDefaults); assert.deepEqual(await files(), initialFiles);
  pass("Actual Web viewer settings expose opt-in property/default-tag preferences; invalid combined updates show a correctable error without partial writes, valid Unicode/nested/deduplicated defaults persist, and unrelated settings/notes are retained");

  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(source)},true)`); await loaded(source); await connectSource(source);
  const sourceId = await host.evaluate("app.workspace.activeLeaf.id");
  async function reveal(url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(sourceId)}))`); await loaded(url); await connectSource(url); }
  await remote.fill("#clip-original", "Keep defaults source 中文 😀");
  const sourceState = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#clip-original").value,cookie:document.cookie,scroll:scrollY})'), requestCount = requests.length;
  const first = await preview(), article = unpack(first);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), true);
  assert.equal(article.values.title, "A clipping story"); assert.deepEqual(article.values.tags, ["research", "project/nested", "中文"]); assert.equal(article.values.source, source);
  assert.ok(Math.abs(Date.now() - Date.parse(article.values.clipped)) < 60_000);
  await capture("preview");
  await host.fill("[data-web-clip-property-title]", "One draft only"); await host.fill("[data-web-clip-property-tags]", "draft/only");
  const draft = await previewText();
  await host.evaluate('app.core.saveSettings("webviewer",{clipIncludeProperties:false,clipDefaultTags:"new/default"})');
  assert.equal(await previewText(), draft, "Settings changes do not replace a reviewed draft");
  await host.click("[data-web-clip-properties]"); assert.equal(await previewText(), article.body);
  await close(); await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), false);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-tags]").value'), "new/default");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-title]").value'), "A clipping story");
  assert.equal(await previewText(), article.body);
  await host.click("[data-web-clip-properties]"); assert.deepEqual(unpack(await previewText()).values.tags, ["new/default"]);
  await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-clip]")', "Escape drops property overrides");
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#clip-original").value,cookie:document.cookie,scroll:scrollY})'), sourceState); assert.equal(requests.length, requestCount);
  assert.deepEqual(await files(), initialFiles); await idle(); assert.deepEqual(await readFile(historyPath), history);
  await settings(); await setOptions(true, inputTags); await savedOptions(expectedDefaults); await host.click(".settings-close");
  assert.deepEqual(await readFile(settingsPath), configuredSettings);
  pass("Article previews initialize from a detached defaults snapshot; edits, opt-out, Cancel/Escape and settings changes preserve the reviewed draft, the next preview gets fresh defaults/title/time, and page state/history/files remain unchanged");

  await preview(); const articleMarkdown = await save(articlePath); await capture("saved");
  await reveal(source); await navigate(selectionSource);
  await remote.evaluate('(()=>{const node=document.querySelector("#selection-short").firstChild,range=document.createRange(),selection=window.fixtureSelection();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range)})()');
  const selectionMarkdown = await preview(true), selected = unpack(selectionMarkdown);
  assert.equal(selected.values.title, "Selection clipping"); assert.equal(selected.values.source, selectionSource); assert.deepEqual(selected.values.tags, ["research", "project/nested", "中文"]);
  assert.ok(selected.body.endsWith("字\n"));
  assert.equal(await save(selectionPath), selectionMarkdown);
  assert.deepEqual(await readFile(settingsPath), configuredSettings); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.deepEqual(await readFile(join(directory, articlePath)), Buffer.from(articleMarkdown));
  assert.doesNotMatch(await host.evaluate('JSON.stringify(app.workspace.getLayout())'), /draft\/only|One draft only|clipDefaultTags|clipped:/);
  pass("Article and selected-text saves use the exact reviewed default frontmatter once, retain fresh capture-specific title/source/UTC time and literal bodies, populate normal metadata/Reading, and do not persist per-clip drafts or change settings/history");

  await host.evaluate('app.workspace.flushLayout()'); await restart();
  assert.deepEqual(await defaults(), expectedDefaults); await reveal(selectionSource); await navigate(source); await preview();
  assert.deepEqual(unpack(await previewText()).values.tags, ["research", "project/nested", "中文"]); await close();
  await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate('app.workspace.flushLayout()'); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); assert.deepEqual(await defaults(), expectedDefaults);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); await preview(); await host.fill("[data-web-clip-property-tags]", "foreign/draft");
  await host.evaluate(`globalThis.oldDefaultsClip=${view}.clip;oldDefaultsClip.path.value="Web clips/Stale defaults.md";undefined`); await close();
  const other = join(directory, ".clip-defaults-other-vault"), otherNote = Buffer.from("\ufeff# Keep\r\nOther defaults vault 中文 😀.\r\n"); await mkdir(join(other, ".obsidian"), { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote);
  await writeFile(join(other, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherSettings = Buffer.from('\ufeff{"clipIncludeProperties":false,"clipDefaultTags":"other/vault","future":{"keep":true}}\r\n'); await writeFile(join(other, ".obsidian", "webviewer.json"), otherSettings);
  const otherHistory = '\ufeff{"version":1,"recording":false,"entries":[],"future":{"keep":true}}\r\n'; await writeFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) { await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "defaults vault dialog open"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault"); await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "defaults vault switch " + path); }
  await switchVault(other); await host.evaluate("oldDefaultsClip.saveNote()"); assert.deepEqual(await files(), ["Keep.md"]);
  assert.deepEqual(await defaults(), { clipIncludeProperties: false, clipDefaultTags: "other/vault" });
  await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(source)},true)`); await loaded(source); await preview();
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-properties]").checked'), false); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-property-tags]").value'), "other/vault");
  await host.click("[data-web-clip-properties]"); assert.deepEqual(unpack(await previewText()).values.tags, ["other/vault"]); await close();
  assert.deepEqual(await readFile(join(other, ".obsidian", "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.equal(await readFile(join(other, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await switchVault(directory); await loaded(source); await preview(); assert.deepEqual(unpack(await previewText()).values.tags, ["research", "project/nested", "中文"]); await capture("restored"); await close();
  assert.deepEqual(await readFile(settingsPath), configuredSettings); assert.deepEqual(await readFile(join(directory, articlePath)), Buffer.from(articleMarkdown)); assert.deepEqual(await readFile(join(directory, selectionPath)), Buffer.from(selectionMarkdown));
  assert.deepEqual(await readFile(join(directory, "Welcome.md")), originalNote); assert.deepEqual(await readFile(join(config, "workspace.json")), originalWorkspace); await idle(); assert.deepEqual(await readFile(historyPath), history);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Enabled/disabled full process restarts and real vault switches restore only each vault's defaults; transient overrides and obsolete saves cannot leak across roots, and exact note/config/history/original-workspace/BOM/CRLF/Unicode bytes survive");
}
