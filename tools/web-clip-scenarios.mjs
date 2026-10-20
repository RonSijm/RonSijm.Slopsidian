import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";

export async function checkWebClip({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", source = origin + "/clip-story";
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), originalSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  const workspacePath = join(directory, ".obsidian", "workspace.json"), originalWorkspace = await readFile(workspacePath);
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await host.click("#open-settings"); await host.click("#core-plugins-tab"); await host.click('[data-core-settings="webviewer"]');
  await host.fill('[data-core-field="markdownPath"]', "Web clips"); await host.click('[data-core-save="webviewer"]');
  await host.wait('!app.core.busy&&app.core.state("webviewer").settings.markdownPath==="Web clips"', "clipping folder configured"); await host.click(".settings-close");
  const settings = await readFile(settingsPath);
  assert.deepEqual(JSON.parse(settings), { ...originalSettings, markdownPath: "Web clips" });
  const files = async (folder = directory) => (await readdir(folder, { withFileTypes: true })).filter(entry => !entry.name.startsWith(".")).flatMap(entry => entry.isDirectory() ? [] : entry.name);
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "clip source loaded " + url);
  async function navigate(url) { await host.fill("[data-webviewer-address]", url); await host.click('[data-webviewer-action="go"]'); await loaded(url); }
  const ready = () => host.wait('document.querySelector("[data-web-clip]")?.dataset.webClip==="preview"&&!document.querySelector("[data-web-clip-action=save]").disabled', "article Markdown preview ready");
  async function preview(command = false) {
    if (command) { await host.evaluate('app.commands.execute("webviewer:save-to-vault")'); }
    else { await host.click('[data-webviewer-action="clip"]'); }
    await ready();
  }
  const close = async () => { await host.click('[data-web-clip-action="cancel"]'); await host.wait('!document.querySelector("[data-web-clip]")', "clip dialog closed"); };
  async function remotePage() {
    let target; await until(async () => { target = (await targets()).find(item => item.url === source); return target; }, "native clipping source"); return connect(target);
  }
  async function revealSource() {
    await host.evaluate('(async()=>{const leaf=app.workspace.getLeavesOfType("webviewer")[0];await app.workspace.revealLeaf(leaf)})()');
    await loaded(source);
  }
  await host.click('[data-core-ribbon="webviewer"]'); await loaded(origin + "/one"); await navigate(source);
  let remote = await remotePage(); await remote.fill("#clip-original", "Retain source input");
  const sourceState = await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#clip-original").value,cookie:document.cookie})');
  const imageRequests = requests.filter(request => request.url === "/reader-image").length, initialFiles = await files();
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()');
  const historyPath = join(directory, ".obsidian", "vault-dotnet-web-history.json"), beforeHistory = await readFile(historyPath);
  await preview();
  const markdown = await host.evaluate('document.querySelector("[data-web-clip-preview]").value');
  assert.ok(markdown.startsWith("# A clipping story\n\nSource: "));
  for (const text of [source, "Author: Clip Fixture Author", "中文 and 😀", "## Remember this heading", "**bold**", "*emphasis*", "``inline`code``", "- First item", "Nested item", "1. First ordered", "> A thoughtful quotation", "````\n```mermaid", "\n\nlast line", "| Season | Light |", "| Autumn | Soft |", "](<" + origin + "/reader-next?q=one%20two#part>)", "A calm riverside", "A caption stays readable", "\\!\\[\\[Secret\\]\\]", "&lt;img"]) { assert.ok(markdown.includes(text), text + " missing in clip"); }
  assert.equal((markdown.match(/^# A clipping story$/gm) ?? []).length, 1);
  for (const text of ["javascript:", "private form text", "Do not clip this", "<img", "data-reader-url"]) { assert.ok(!markdown.includes(text), text + " must not become active/imported HTML"); }
  assert.ok(markdown.includes("<script>doNotRun()</script>"), "literal code is preserved inside its longer fence");
  const rendered = marked.parse(markdown);
  assert.ok(!/<(?:script|img|iframe|form)\b/i.test(rendered), "clipped Markdown generates no active page HTML");
  assert.ok(rendered.includes("&lt;script&gt;doNotRun()&lt;/script&gt;"), "the script sample renders as inert code");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-path]").value'), "Web clips/A clipping story.md");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").readOnly'), true);
  assert.equal(await host.evaluate(`${view}.clip.preview.querySelectorAll("*").length`), 0);
  assert.equal(await host.evaluate(`JSON.parse(${view}.lastBounds).visible`), false);
  await capture("preview"); await close();
  await preview(); await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-clip]")', "Escape cancels clipping");
  assert.deepEqual(await files(), initialFiles);
  await assert.rejects(readFile(join(directory, "Web clips", "A clipping story.md")), { code: "ENOENT" });
  assert.deepEqual(await remote.evaluate('({html:document.documentElement.outerHTML,input:document.querySelector("#clip-original").value,cookie:document.cookie})'), sourceState);
  await host.evaluate('app.core.getEnabledPluginById("webviewer").history.whenIdle()'); assert.deepEqual(await readFile(historyPath), beforeHistory);
  assert.equal(requests.filter(request => request.url === "/reader-image").length, imageRequests);
  assert.ok(requests.every(request => request.token === null));
  pass("Clipping previews the isolated loaded article as literal Markdown with headings/lists/quotes/code/tables/links/Unicode/source metadata; Cancel writes nothing and retains original DOM/input/cookies/history without refetching images or sending vault tokens");

  await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="reader"`, "reader ready for clipping");
  await preview(true);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").value'), markdown);
  await host.fill("[data-web-clip-path]", "Web clips/Nested/中文 saved.md");
  await host.evaluate('globalThis.clipCreateEvents=[];globalThis.clipEventRef=app.vault.on("create",file=>clipCreateEvents.push(file.path));undefined');
  await host.click('[data-web-clip-action="save"]');
  await host.wait('!document.querySelector("[data-web-clip]")&&app.workspace.getActiveFile()?.path==="Web clips/Nested/中文 saved.md"', "clipped note opened");
  assert.deepEqual(await readFile(join(directory, "Web clips", "Nested", "中文 saved.md")), Buffer.from(markdown));
  assert.equal(await host.evaluate('clipCreateEvents.filter(path=>path==="Web clips/Nested/中文 saved.md").length'), 1);
  assert.equal(await host.evaluate('app.workspace.activeLeaf.view.editor.getValue()'), markdown);
  await host.evaluate('app.vault.offref(clipEventRef);delete globalThis.clipEventRef');
  await capture("saved");
  pass("The save-to-vault command works from Reader, honors an edited nested Unicode path, creates the exact reviewed UTF-8 Markdown, emits one vault create event and opens the saved note");

  await revealSource(); await preview();
  await host.fill("[data-web-clip-path]", "Web clips/External.md");
  const external = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("External exact bytes\r\n😀\r\n")]);
  await writeFile(join(directory, "Web clips", "External.md"), external, { flag: "wx" });
  await host.click('[data-web-clip-action="save"]');
  await host.wait('document.querySelector("[data-web-clip-error]").textContent.includes("already exists")&&!document.querySelector("[data-web-clip-action=save]").disabled', "external create collision refused");
  assert.deepEqual(await readFile(join(directory, "Web clips", "External.md")), external);
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").value'), markdown);
  await mkdir(join(directory, "Web clips", "Folder.md")); await host.fill("[data-web-clip-path]", "Web clips/Folder.md");
  await host.click('[data-web-clip-action="save"]'); await host.wait('document.querySelector("[data-web-clip-error]").textContent.includes("already exists")', "folder collision refused");
  for (const path of ["../Escape.md", ".obsidian/Clip.md", "Web clips/CON.md", "Wrong.txt"]) {
    await host.fill("[data-web-clip-path]", path); await host.click('[data-web-clip-action="save"]');
    await host.wait('!document.querySelector("[data-web-clip-error]").hidden&&!document.querySelector("[data-web-clip-action=save]").disabled', "invalid clip path refused");
  }
  await host.fill("[data-web-clip-path]", "Web clips/A clipping story.md"); await host.click('[data-web-clip-action="save"]');
  await host.wait('app.workspace.getActiveFile()?.path==="Web clips/A clipping story.md"&&!document.querySelector("[data-web-clip]")', "same preview saved to an unused path after collision");
  assert.deepEqual(await readFile(join(directory, "Web clips", "A clipping story.md")), Buffer.from(markdown));
  await revealSource(); await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-path]").value'), "Web clips/A clipping story 2.md"); await close();
  pass("External BOM/CRLF file and folder collisions never overwrite; invalid/traversal/configuration/reserved paths fail with the preview retained, a corrected destination succeeds and new suggestions avoid existing paths");

  await preview(); await host.fill("[data-web-clip-path]", "Web clips/Stale.md");
  remote = await remotePage(); await remote.evaluate("location.reload()");
  await host.wait('document.querySelector("[data-web-clip-error]").textContent.includes("source page changed")&&document.querySelector("[data-web-clip-action=save]").disabled', "same-URL reload invalidates reviewed article");
  assert.equal(await host.evaluate('document.querySelector("[data-web-clip-preview]").value'), markdown); await close(); await loaded(source);
  await assert.rejects(readFile(join(directory, "Web clips", "Stale.md")), { code: "ENOENT" });
  await preview(); await host.fill("[data-web-clip-path]", "Web clips/Other-vault.md");
  await host.evaluate(`globalThis.oldClipPreview=${view}.clip;app.prepareLeave()`); await host.wait('!document.querySelector("[data-web-clip]")', "vault leave discards transient clip preview");
  const otherVault = join(directory, ".clip-other-vault"); await mkdir(join(otherVault, ".obsidian"), { recursive: true });
  await writeFile(join(otherVault, "Keep.md"), "# Other vault\nKeep exactly.\n");
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,false]))')));
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "clip vault switch " + path);
  }
  await switchVault(otherVault); await host.evaluate("oldClipPreview.saveNote()");
  assert.deepEqual(await files(otherVault), ["Keep.md"]); assert.equal(await readFile(join(otherVault, "Keep.md"), "utf8"), "# Other vault\nKeep exactly.\n");
  await assert.rejects(readFile(join(directory, "Web clips", "Other-vault.md")), { code: "ENOENT" });
  await switchVault(directory); await revealSource(); await host.evaluate("delete globalThis.oldClipPreview");
  pass("Same-URL navigation invalidates the reviewed clip and disables Save; actual vault switches discard the preview and a retained obsolete dialog cannot create a note in either vault");

  // Return to the normal page so every failed extraction demonstrates restored
  // native browsing independently of a previously rendered Reader frame.
  await host.click('[data-webviewer-action="reader"]'); await host.wait(`${view}.contentEl.dataset.webviewerReaderMode==="page"`, "original page before extraction failures");
  for (const [path, message] of [["/reader-empty", "No readable article"], ["/reader-large", "too large"], ["/clip-wide", "table is too large"]]) {
    await navigate(origin + path); await host.click('[data-webviewer-action="clip"]');
    await host.wait(`document.querySelector("[data-web-clip]")?.dataset.webClip==="unavailable"&&document.querySelector("[data-web-clip-error]").textContent.includes(${JSON.stringify(message)})`, "bounded clipping fallback " + path);
    assert.equal(await host.evaluate('document.querySelector("[data-web-clip-action=save]").disabled'), true);
    assert.equal(await host.evaluate('document.querySelector("[data-web-clip-error]").textContent.includes("webviewer:request")'), false);
    await close(); await host.wait(`JSON.parse(${view}.lastBounds).visible===true`, "original native page restored after clip failure");
  }
  await navigate(origin + "/reader-strict"); await preview(); await close();
  pass("Short/non-article, oversized source and excessive table pages explain failure with Save disabled and browsing restored; strict website CSP still permits isolated clipping");

  await navigate(source); await preview(); await host.evaluate("app.workspace.flushLayout()"); await restart(); await loaded(source);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-clip]"))'), false);
  await preview(); assert.equal(await host.evaluate('document.querySelector("[data-web-clip-path]").value'), "Web clips/A clipping story 2.md");
  await host.evaluate('app.core.setEnabled("webviewer",false)');
  await host.wait('!app.core.busy&&!document.querySelector("[data-web-clip]")', "disabling viewer removes clip dialog");
  assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id==="webviewer:save-to-vault")'), false);
  await until(async () => !(await targets()).some(target => target.url.startsWith(origin)), "clip native contents released on disable");
  await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await loaded(source); await preview(true); await close();
  assert.deepEqual(await readFile(join(directory, "Web clips", "Nested", "中文 saved.md")), Buffer.from(markdown));
  assert.deepEqual(await readFile(join(directory, "Web clips", "External.md")), external);
  assert.deepEqual(await readFile(settingsPath), settings); assert.deepEqual(await readFile(workspacePath), originalWorkspace);
  pass("Previews are transient across full process restarts; disable/disabled restart/re-enable cleans up dialogs, commands and native contents while retaining saved notes, external bytes, clipping settings and original workspace data");
}
