import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import moment from "moment";

export async function checkEditingTools({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Editor tools";
  const path = folder + "/Presentation.md";
  const target = folder + "/Target.md";
  const content = [
    "---", "title: Slide metadata", "---", "# First slide", "",
    "Before  after.", "", "A **real** slide and [reference target][destination].", "",
    "`Code slot: `", "", "```markdown", "---", "Fenced slot: ", "```", "",
    "> Nested rule", ">", "> ---", "",
    "---", "", "# Second slide", "", `![[${folder}/Pixel.png]]`, "",
    "***", "", "# Third slide", "", "Last slide.", "",
    '<script>globalThis.slidesExecuted=true</script>', "",
    "[destination]: ./Target.md", "",
  ].join("\r\n");
  const bytes = Buffer.from("\ufeff" + content);
  const originalSettings = new Map(["slash-command", "slides"].map(id => [id, "\ufeff" + JSON.stringify({ futureSetting: { retain: [id, 17] } })]));
  const selected = '.cm-tooltip-autocomplete [role="option"][aria-selected="true"]';
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate editor-tools observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  async function reload() {
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }
  async function settings() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function toggle(id, enabled) {
    await settings();
    if (await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`) !== enabled) { await click(`[data-core-toggle="${id}"]`); }
    await wait(`!app.core.busy&&app.core.isEnabled(${JSON.stringify(id)})===${enabled}`, id + " enabled state");
    await click(".settings-close");
  }
  async function run(id) {
    const name = await evaluate(`app.commands.listCommands().find(command=>command.id===${JSON.stringify(id)})?.name`);
    assert.equal(typeof name, "string");
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker")?.open', "actual command palette");
    await command("Input.insertText", { text: name });
    await click(`[data-command-id="${id}"]`);
    await wait('!document.querySelector("#desktop-picker").open', "selected actual command");
  }
  async function cursor(text, offset = text.length) {
    await evaluate(`(()=>{const editor=app.editor,cm=editor.cm,at=cm.state.doc.toString().indexOf(${JSON.stringify(text)});if(at<0)throw new Error("Fixture cursor text is missing");editor.setCursor(editor.offsetToPos(at+${offset}));editor.scrollIntoView({from:editor.getCursor(),to:editor.getCursor()},true);editor.focus()})()`);
  }
  async function query(text, label) {
    await command("Input.insertText", { text: "/" + text });
    await wait(`[...document.querySelectorAll('.cm-tooltip-autocomplete [role="option"]')].some(option=>option.textContent.includes(${JSON.stringify(label)}))`, "visible filtered slash command: " + label);
    // CodeMirror ignores selection keys during its initial interaction delay.
    await delay(100);
    const count = await evaluate('document.querySelectorAll(\'.cm-tooltip-autocomplete [role="option"]\').length');
    for (let index = 0; index < count && !await evaluate(`document.querySelector(${JSON.stringify(selected)})?.textContent.includes(${JSON.stringify(label)})`); index++) {
      await press("ArrowDown", "ArrowDown", 40);
    }
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selected)})?.textContent.includes(${JSON.stringify(label)})`), true, "Actual arrow-key navigation selects the intended result");
    await delay(100);
  }
  async function present() {
    await run("slides:start");
    await wait('document.querySelector(".slides-container")?.open&&document.querySelector(".slides-stage").dataset.slideCount==="3"', "actual rendered three-slide presentation");
  }

  await mkdir(join(directory, folder), { recursive: true });
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, path), bytes);
  await writeFile(join(directory, target), "# Linked presentation target\r\n");
  await writeFile(join(directory, folder, "Pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqkAAAAASUVORK5CYII=", "base64"));
  for (const [id, settingsBytes] of originalSettings) { await writeFile(join(directory, ".obsidian", id + ".json"), settingsBytes); }
  await reload();
  for (const id of originalSettings.keys()) {
    await toggle(id, true);
    await settings();
    assert.equal(await evaluate(`document.querySelector('[data-core-id="${id}"] [data-core-settings]')===null`), true);
    assert.equal(await evaluate(`app.core.state(${JSON.stringify(id)}).settingsSupport`), "none");
    await click(".settings-close");
    accept(id + ":settings");
  }
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(path)},"tab");app.workspace.activeLeaf.view.setMode("source")})()`);
  const sourceId = await evaluate("app.workspace.activeLeaf.id");
  const pinned = await evaluate("app.workspace.activeLeaf.pinned");
  await cursor("Before ");
  await query("pin", "Toggle pin on current tab");
  if (capture) { await capture("slash"); }
  await press("Enter", "Enter", 13);
  await wait(`app.workspace.activeLeaf.pinned===${!pinned}&&!document.querySelector(".cm-tooltip-autocomplete")`, "slash command executed and picker closed");
  assert.equal(await evaluate("app.editor.getValue()"), content, "Only the slash and its query are removed");
  await press("z", "KeyZ", 90, 2);
  const withQuery = content.replace("Before  after.", "Before /pin after.");
  await wait(`app.editor.getValue()===${JSON.stringify(withQuery)}`, "undo restores just the slash query");
  await press("y", "KeyY", 89, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(content)}`, "redo leaves surrounding Markdown intact");
  await run("workspace:toggle-pin");
  assert.equal(await evaluate("app.workspace.activeLeaf.pinned"), pinned);
  await cursor("Before ");
  const format = await evaluate('app.core.state("templates").settings.dateFormat');
  const before = moment();
  await query("currentdate", "Insert current date");
  await press("Enter", "Enter", 13);
  await wait('app.editor.getValue().includes("Before ")&&!document.querySelector(".cm-tooltip-autocomplete")', "slash editor callback completed");
  const actual = await evaluate("app.editor.getValue()");
  const expected = [];
  for (let time = before.clone().startOf("second"); time.valueOf() <= Date.now(); time.add(1, "second")) {
    expected.push(content.replace("Before  after.", "Before " + time.format(format) + " after."));
  }
  assert.ok(expected.includes(actual), "The real editor command inserts its configured date at the original slash position");
  await evaluate(`app.editor.setValue(${JSON.stringify(content)});true`);
  await evaluate("app.saveAll()");
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  pass("Real slash typing filters available commands, Enter executes a workspace action or editor callback, and query removal has an isolated undo/redo transaction without damaging surrounding BOM/CRLF Markdown.");

  for (const [text, offset] of [["Code slot: ", "Code slot: ".length], ["Fenced slot: ", "Fenced slot: ".length], ["title: Slide metadata", 7]]) {
    await cursor(text, offset);
    await command("Input.insertText", { text: "/pin" });
    await delay(400);
    assert.equal(await evaluate('Boolean(document.querySelector(".cm-tooltip-autocomplete"))'), false, "Slash commands must not activate in code or frontmatter");
    await evaluate(`app.editor.setValue(${JSON.stringify(content)});true`);
  }
  await cursor("Before ");
  await query("pin", "Toggle pin on current tab");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate("app.editor.getValue()"), withQuery, "Cancelling retains the exact typed query");
  await evaluate(`app.editor.setValue(${JSON.stringify(content)});true`);
  await toggle("slash-command", false);
  assert.equal(await evaluate('app.workspace.editorExtensions.has("core:slash-command")'), false);
  await cursor("Before ");
  await command("Input.insertText", { text: "/pin" });
  await delay(400);
  assert.equal(await evaluate('Boolean(document.querySelector(".cm-tooltip-autocomplete"))'), false);
  await evaluate(`app.editor.setValue(${JSON.stringify(content)});true`);
  await toggle("slash-command", true);
  await cursor("Before ");
  await query("reading", "Toggle reading view");
  await click(selected);
  await wait('app.workspace.activeLeaf.view.getMode()==="preview"&&!document.querySelector(".cm-tooltip-autocomplete")', "real pointer selection changes mode");
  assert.equal(await evaluate("app.editor.getValue()"), content);
  accept("slash-command:picker");
  pass("Code/frontmatter never trigger slash commands; Escape retains the query, disable removes the actual editor extension, and re-enabled pointer selection runs an available command in the original note.");

  await evaluate('app.workspace.activeLeaf.view.setMode("source");app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus();true');
  await command("Input.insertText", { text: "Unsaved presentation content." });
  const unsaved = await evaluate("app.editor.getValue()");
  const count = await evaluate("app.workspace.leaves().length");
  await present();
  assert.equal(await evaluate('document.querySelector(".slides-stage h1").textContent'), "First slide");
  assert.equal(await evaluate('document.querySelector(".slides-stage strong").textContent'), "real");
  assert.equal(await evaluate('document.querySelector(".slides-stage pre code").textContent.includes("---")'), true);
  assert.equal(await evaluate('document.querySelector(".slides-stage").textContent.includes("Slide metadata")'), false);
  await press("ArrowRight", "ArrowRight", 39);
  await wait('document.querySelector(".slides-stage").dataset.slideIndex==="1"&&document.querySelector(".slides-stage img")?.naturalWidth===1', "next slide has an actual local image");
  await press("End", "End", 35);
  await wait('document.querySelector(".slides-stage").dataset.slideIndex==="2"&&document.querySelector(".slides-stage").textContent.includes("Unsaved presentation content.")', "last slide includes the actual dirty buffer");
  assert.equal(await evaluate("globalThis.slidesExecuted===true"), false);
  await click('[data-slide-action="previous"]');
  assert.equal(await evaluate('document.querySelector(".slides-stage").dataset.slideIndex'), "1");
  if (capture) { await capture("slides"); }
  await press("Home", "Home", 36);
  await wait('document.querySelector(".slides-stage").dataset.slideIndex==="0"', "first-slide key navigation");
  await press("Escape", "Escape", 27);
  await wait('!document.querySelector(".slides-container")', "presentation cleaned up");
  assert.equal(await evaluate("app.workspace.activeLeaf.id"), sourceId);
  assert.equal(await evaluate("app.workspace.leaves().length"), count);
  assert.equal(await evaluate("app.editor.getValue()"), unsaved);
  assert.equal(await evaluate("app.dirty"), true);
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  await evaluate(`app.editor.setValue(${JSON.stringify(content)});true`);
  await present();
  await click('.slides-stage a[href="./Target.md"]');
  await wait(`!document.querySelector(".slides-container")&&app.current?.file.path===${JSON.stringify(target)}`, "document-wide reference link opens its real target");
  await click(`[data-tab-id="${sourceId}"]`);
  await wait(`app.current?.file.path===${JSON.stringify(path)}`, "original source tab retained");
  accept("slides:present");
  pass("Slides render real Markdown separators and document-wide references without splitting nested rules or fences; pointer/keyboard navigation displays a vault image and dirty text, links open real notes, and Exit preserves the original editor, leaf count and file bytes.");

  await present();
  await evaluate('app.core.setEnabled("slides",false)');
  await wait('!document.querySelector(".slides-container")&&!app.core.isEnabled("slides")', "module disable owns and closes its live presentation");
  assert.equal(await evaluate('app.commands.listCommands().some(command=>command.id==="slides:start")'), false);
  await toggle("slides", true);
  await reload();
  for (const id of originalSettings.keys()) {
    assert.equal(await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`), true);
    assert.equal(await readFile(join(directory, ".obsidian", id + ".json"), "utf8"), originalSettings.get(id));
  }
  await present();
  await click('[data-slide-action="close"]');
  await wait('!document.querySelector(".slides-container")', "presentation closes after process restart/reconnect");
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  pass("Slides and Slash commands match the absence of general settings pages, remove their live UI/hooks on disable, restore after an actual desktop restart or real-folder reconnect, and leave unknown configuration and original Markdown bytes untouched.");
  report.editingTools = { implementation: "independent shared editor/presentation subset", originalModulesLoaded: false, revealJsRuntime: false, publicEditorSuggestApi: "not implemented", fullMarkdownRendererParity: "not established" };
}
