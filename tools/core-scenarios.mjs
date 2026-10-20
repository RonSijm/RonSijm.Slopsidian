import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import moment from "moment";
import { checkWebViewer, connectWebViewerTarget, createWebViewerPages } from "./webviewer-scenarios.mjs";

export async function checkCoreModules(ui) {
  const { evaluate, command, click, waitExpression, waitFor, press, runCommand, fillInput, createNote, focusEditor, fileEquals, closeSettings, restartDesktop, report, vault } = ui;
  const reference = JSON.parse(await readFile(new URL("../shared/core-plugins.json", import.meta.url), "utf8"));
  const defaults = new Map(reference.plugins.map(plugin => [plugin.id, Boolean(plugin.defaultOn)]));
  const implemented = await evaluate("app.core.states.filter(state=>state.implemented).map(state=>state.id)");
  const newModules = ["templates", "daily-notes", "zk-prefixer", "random-note", "footnotes"];
  const pass = id => {
    assert.ok(!report.coreChecks.some(test => test.id === id), `Duplicate observation: ${id}`);
    report.coreChecks.push({ id, status: "passed" });
  };
  async function scenario(id, action) {
    report.activeCoreCase = id;
    try {
      await action();
      pass(id);
    } catch (error) {
      report.coreChecks.push({ id, status: "failed", error: error.message });
      throw error;
    } finally {
      delete report.activeCoreCase;
    }
  }
  async function coreSettings() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) {
      await click("#open-settings");
    }
    await waitExpression('document.querySelector("#settings-dialog").open', "core settings dialog");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) {
      await click("#core-settings-back");
    }
  }
  async function toggle(id, enabled) {
    await coreSettings();
    if (await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`) !== enabled) {
      await click(`[data-core-toggle="${id}"]`);
    }
    await waitExpression(`!app.core.busy&&app.core.isEnabled(${JSON.stringify(id)})===${enabled}`, `${id} ${enabled ? "enabled" : "disabled"}`);
    assert.equal(await evaluate(`document.querySelector('[data-core-id="${id}"]').dataset.enabled`), String(enabled));
  }
  async function settings(id, values) {
    await coreSettings();
    await click(`[data-core-settings="${id}"]`);
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "boolean") {
        if (await evaluate(`document.querySelector('[data-core-field="${key}"]').checked`) !== value) {
          await click(`[data-core-field="${key}"]`);
        }
      } else {
        await fillInput(`[data-core-field="${key}"]`, value);
      }
    }
    await click(`[data-core-save="${id}"]`);
    await waitExpression(`!app.core.busy&&Object.entries(${JSON.stringify(values)}).every(([key,value])=>app.core.state(${JSON.stringify(id)}).settings[key]===value)`, `${id} settings saved`);
    const stored = JSON.parse(await readFile(join(vault, ".obsidian", id + ".json"), "utf8"));
    for (const [key, value] of Object.entries(values)) {
      assert.equal(stored[key], value);
    }
    assert.deepEqual(stored.futureSetting, { preserve: id });
    await click("#core-settings-back");
    await click(`[data-core-settings="${id}"]`);
    for (const [key, value] of Object.entries(values)) {
      assert.equal(await evaluate(`document.querySelector('[data-core-field="${key}"]').${typeof value === "boolean" ? "checked" : "value"}`), value);
    }
    await closeSettings();
  }
  async function input(text) {
    await focusEditor();
    await command("Input.insertText", { text });
  }
  function assertTimedText(actual, before, expected) {
    const after = moment();
    for (const time = before.clone().startOf("second"); time.valueOf() <= after.valueOf(); time.add(1, "second")) {
      if (actual === expected(time)) {
        return;
      }
    }
    assert.fail(`Unexpected text between ${before.toISOString()} and ${after.toISOString()}: ${JSON.stringify(actual)}`);
  }
  async function save(path, expected) {
    await click("#save-note");
    await waitFor(() => fileEquals(join(vault, ...path.split("/")), expected), `exact ${path} bytes`);
  }
  async function switchVault(path) {
    await click("#open-vault");
    await waitExpression('document.querySelector("#vault-dialog").open', "vault selector");
    await fillInput("#vault-open-path", path);
    await click("#confirm-open-vault");
    await waitExpression(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "vault switched with fresh core state");
  }
  const belongs = (command, id) => command === id || command.startsWith((id === "outgoing-link" ? "outgoing-links" : id) + ":");
  const expectedFiles = new Map();
  for (const folder of ["Templates", "Journal", "Unique"]) {
    await mkdir(join(vault, folder), { recursive: true });
  }
  const insertion = "# {{title}}\n{{date}} / {{time}} / {{date:YYYY}}\n";
  await writeFile(join(vault, "Templates", "Insert.md"), insertion);
  await writeFile(join(vault, "Templates", "Daily.md"), "# {{title}}\nDay {{date:YYYY-MM-DD}}\n");
  await writeFile(join(vault, "Templates", "Unique.md"), "# {{title}}\nCreated {{date:YYYY-MM-DD}}\n");
  await writeFile(join(vault, "Unique", "Fixed.md"), "Never replace this existing note.\n");
  await writeFile(join(vault, "Attachment.bin"), Buffer.from([0, 255, 17]));
  const today = moment();
  const previous = today.clone().subtract(3, "days");
  const next = today.clone().add(3, "days");
  const dailyPath = date => "Journal/" + date.format("YYYY/MM/DD") + ".md";
  for (const [date, text] of [[previous, "Previous daily note.\n"], [next, "Next daily note.\n"]]) {
    await mkdir(join(vault, "Journal", date.format("YYYY"), date.format("MM")), { recursive: true });
    await writeFile(join(vault, ...dailyPath(date).split("/")), text);
  }
  await runCommand("file-explorer:refresh");
  await coreSettings();
  assert.equal(await evaluate('document.querySelectorAll("[data-core-id]").length'), 31);
  for (const state of await evaluate(`app.core.states.map(state=>({
    id:state.id,implemented:state.implemented,enabled:state.enabled,
    disabled:document.querySelector('[data-core-toggle="'+state.id+'"]').disabled,
    displayed:document.querySelector('[data-core-id="'+state.id+'"]').dataset.enabled
  }))`)) {
    assert.equal(state.disabled, !state.implemented, `${state.id} toggle must match its actual availability`);
    assert.equal(state.displayed, String(state.enabled), `${state.id} must display its actual enabled state`);
    if (!state.implemented) { assert.equal(state.enabled, false, `${state.id} cannot enable an unavailable module`); }
  }
  await closeSettings();
  for (const id of newModules) {
    await toggle(id, true);
    await closeSettings();
  }

  const pinnedCommands = ["workspace:toggle-pin", "workspace:reload-file"];
  await scenario("command-palette:settings", async () => {
    await coreSettings();
    await click('[data-core-settings="command-palette"]');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-core-pinned]"),row=>row.dataset.corePinned)'), ["workspace:save-file"]);
    for (const id of pinnedCommands) {
      await fillInput("[data-core-command-input]", id);
      await click("[data-core-pin-add]");
    }
    await click('[data-core-pinned="workspace:toggle-pin"] [data-core-pin-action=up]');
    await click('[data-core-pinned="workspace:save-file"] [data-core-pin-action=remove]');
    await click('[data-core-save="command-palette"]');
    await waitExpression(`!app.core.busy&&JSON.stringify(app.core.state("command-palette").settings.pinned)===${JSON.stringify(JSON.stringify(pinnedCommands))}`, "pinned commands saved in order");
    const stored = JSON.parse(await readFile(join(vault, ".obsidian", "command-palette.json"), "utf8"));
    assert.deepEqual(stored, { pinned: pinnedCommands, futureSetting: { preserve: "command-palette" } });
    await click("#core-settings-back");
    await click('[data-core-settings="command-palette"]');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-core-pinned]"),row=>row.dataset.corePinned)'), pinnedCommands);
    await closeSettings();
  });
  await scenario("command-palette:availability", async () => {
    const path = await evaluate("app.current.file.path");
    await runCommand("workspace:new-tab");
    await waitExpression("app.current===null", "empty editor context");
    await press("p", "KeyP", 80, 2);
    await waitExpression('document.querySelector("#desktop-picker").open', "palette in empty tab");
    for (const id of ["workspace:reload-file", "templates:insert-template", "daily-notes:goto-prev", "daily-notes:goto-next"]) {
      assert.equal(await evaluate(`document.querySelector('[data-command-id="${id}"]')===null`), true, `${id} must be unavailable in an empty tab`);
    }
    assert.equal(await evaluate('document.querySelector("[data-command-id]").dataset.commandId'), pinnedCommands[0]);
    await press("Escape", "Escape", 27);
    await click(`[data-note-path="${path}"]`);
    await waitExpression(`app.current?.file.path===${JSON.stringify(path)}`, "active editor context restored");
    const wasPinned = await evaluate("app.workspace.activeLeaf.pinned");
    await press("p", "KeyP", 80, 2);
    await waitExpression('document.querySelector("#desktop-picker").open', "palette with a Markdown editor");
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#desktop-picker [data-command-id]")).slice(0,2).map(row=>row.dataset.commandId)'), pinnedCommands);
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#desktop-picker [data-pinned=true]"),row=>row.dataset.commandId)'), pinnedCommands);
    assert.equal(await evaluate('Boolean(document.querySelector(\'[data-command-id="templates:insert-template"]\'))'), true);
    await click('[data-command-id="workspace:toggle-pin"]');
    await waitExpression(`app.workspace.activeLeaf.pinned===${!wasPinned}&&!document.querySelector("#desktop-picker").open`, "pinned command executed");
    await runCommand("workspace:toggle-pin");
    await waitExpression(`app.workspace.activeLeaf.pinned===${wasPinned}`, "original pin state restored");
  });

  await settings("templates", { folder: "Templates", dateFormat: "YYYY.MM.DD", timeFormat: "HH:mm:ss" });
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("templates").options.folder'), "Templates");
  pass("templates:settings");
  await scenario("templates:insert", async () => {
    await createNote("Template target.md");
    await input("Before PLACEHOLDER after");
    await press("Home", "Home", 36);
    for (let index = 0; index < 7; index++) {
      await press("ArrowRight", "ArrowRight", 39);
    }
    for (let index = 0; index < 11; index++) {
      await press("ArrowRight", "ArrowRight", 39, 8);
    }
    assert.equal(await evaluate("app.editor.getSelection()"), "PLACEHOLDER");
    const before = moment();
    await runCommand("templates:insert-template");
    await waitExpression('document.querySelector("#template-picker")?.open', "template picker");
    await fillInput("#template-picker input", "Insert");
    await click('[data-template-path="Templates/Insert.md"]');
    await waitExpression('app.editor.getValue().includes("# Template target")', "template inserted at the selection");
    const actual = await evaluate("app.editor.getValue()");
    const expected = date => `Before # Template target\n${date.format("YYYY.MM.DD")} / ${date.format("HH:mm:ss")} / ${date.format("YYYY")}\n after`;
    assertTimedText(actual, before, expected);
    await save("Template target.md", actual);
    expectedFiles.set("Template target.md", actual);
    assert.equal(await readFile(join(vault, "Templates", "Insert.md"), "utf8"), insertion);
  });
  await scenario("templates:date-time", async () => {
    await createNote("Clock.md");
    await input("Start ");
    const before = moment();
    await runCommand("templates:insert-current-date");
    await waitExpression("app.editor.getValue().length>6", "current date inserted");
    const dated = await evaluate("app.editor.getValue()");
    assertTimedText(dated, before, date => `Start ${date.format("YYYY.MM.DD")}`);
    await input(" / ");
    const beforeTime = moment();
    await runCommand("templates:insert-current-time");
    await waitExpression("app.editor.getValue().includes(':')", "current time inserted");
    const actual = await evaluate("app.editor.getValue()");
    assertTimedText(actual, beforeTime, date => `${dated} / ${date.format("HH:mm:ss")}`);
    await save("Clock.md", actual);
    expectedFiles.set("Clock.md", actual);
  });
  const previousLeaf = await evaluate("app.workspace.activeLeaf.id");
  await press("o", "KeyO", 79, 2);
  await waitExpression('document.querySelector("#desktop-picker").open', "switcher for a new tab");
  await command("Input.insertText", { text: "Template target" });
  await press("Enter", "Enter", 13, 2);
  await waitExpression(`app.current?.file.path==="Template target.md"&&app.workspace.activeLeaf.id!==${JSON.stringify(previousLeaf)}`, "Ctrl+Enter opened a new tab");
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(previousLeaf)})?.view.editor.getValue()`), expectedFiles.get("Clock.md"));
  assert.equal(await evaluate("app.editor.getValue()"), expectedFiles.get("Template target.md"));
  const switcherName = "Folder/Switcher created";
  const beforeCreate = await evaluate("app.vault.getFiles().length");
  await press("o", "KeyO", 79, 2);
  await waitExpression('document.querySelector("#desktop-picker").open', "switcher creation prompt");
  await command("Input.insertText", { text: switcherName });
  await waitExpression('Boolean(document.querySelector("[data-switcher-create]"))', "missing-note creation choice");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate("app.vault.getFiles().length"), beforeCreate, "Cancelling must not create a note");
  await press("o", "KeyO", 79, 2);
  await waitExpression('document.querySelector("#desktop-picker").open', "switcher creation prompt reopened");
  await command("Input.insertText", { text: switcherName });
  await press("Enter", "Enter", 13);
  await waitExpression(`app.current?.file.path===${JSON.stringify(switcherName + ".md")}`, "missing nested note created");
  await input("Created through quick switcher.\n");
  await save(switcherName + ".md", "Created through quick switcher.\n");
  expectedFiles.set(switcherName + ".md", "Created through quick switcher.\n");

  await settings("daily-notes", { format: "YYYY/MM/DD", folder: "Journal", template: "Templates/Daily" });
  pass("daily-notes:settings");
  await scenario("daily-notes:create-today", async () => {
    await click('[data-core-ribbon="daily-notes"]');
    await waitExpression(`app.current?.file.path===${JSON.stringify(dailyPath(today))}`, "today's nested daily note");
    const initial = `# ${today.format("YYYY/MM/DD")}\nDay ${today.format("YYYY-MM-DD")}\n`;
    assert.equal(await evaluate("app.editor.getValue()"), initial);
    await press("End", "End", 35, 2);
    await input("Kept edits.\n");
    const expected = initial + "Kept edits.\n";
    await save(dailyPath(today), expected);
    await click('[data-note-path="Welcome.md"]');
    await waitExpression('app.current?.file.path==="Welcome.md"', "left daily note");
    await runCommand("daily-notes");
    await waitExpression(`app.current?.file.path===${JSON.stringify(dailyPath(today))}`, "existing daily note reopened");
    assert.equal(await evaluate("app.editor.getValue()"), expected);
    expectedFiles.set(dailyPath(today), expected);
  });
  await scenario("daily-notes:navigation", async () => {
    await runCommand("daily-notes:goto-prev");
    await waitExpression(`app.current?.file.path===${JSON.stringify(dailyPath(previous))}`, "previous existing daily note");
    await runCommand("daily-notes:goto-prev");
    await waitExpression('document.querySelector(".notice-container")?.textContent.includes("No previous")', "no previous note notification");
    assert.equal(await evaluate("app.current.file.path"), dailyPath(previous));
    await runCommand("daily-notes:goto-next");
    await waitExpression(`app.current?.file.path===${JSON.stringify(dailyPath(today))}`, "next daily note skipped missing dates");
    await runCommand("daily-notes:goto-next");
    await waitExpression(`app.current?.file.path===${JSON.stringify(dailyPath(next))}`, "next existing future note");
    await runCommand("daily-notes:goto-next");
    await waitExpression('document.querySelector(".notice-container")?.textContent.includes("No next")', "no next note notification");
    assert.equal(await evaluate("app.current.file.path"), dailyPath(next));
  });

  const uniqueSettings = { format: "[Unique-]YYYY-MM-DD", folder: "Unique", template: "Templates/Unique" };
  await settings("zk-prefixer", uniqueSettings);
  pass("zk-prefixer:settings");
  await scenario("zk-prefixer:create-unique", async () => {
    for (const date of [today, today.clone().add(1, "day")]) {
      const title = date.format("[Unique-]YYYY-MM-DD");
      const path = "Unique/" + title + ".md";
      await click('[data-core-ribbon="zk-prefixer"]');
      await waitExpression(`app.current?.file.path===${JSON.stringify(path)}`, "collision-free unique note");
      const expected = `# ${title}\nCreated ${today.format("YYYY-MM-DD")}\n`;
      assert.equal(await readFile(join(vault, ...path.split("/")), "utf8"), expected);
      expectedFiles.set(path, expected);
    }
    await settings("zk-prefixer", { format: "[Fixed]" });
    const before = await evaluate("app.vault.getFiles().length");
    await runCommand("zk-prefixer");
    await waitExpression('document.querySelector("#client-errors").textContent.includes("cannot produce an unused")', "non-unique format error");
    assert.equal(await evaluate("app.vault.getFiles().length"), before);
    assert.equal(await readFile(join(vault, "Unique", "Fixed.md"), "utf8"), "Never replace this existing note.\n");
    await settings("zk-prefixer", uniqueSettings);
    await runCommand("workspace:save-file");
    await createNote("Link target.md");
    await input("Linked title");
    await press("a", "KeyA", 65, 2);
    await runCommand("zk-prefixer:insert-unique-link");
    const expected = `[[${today.format("[Unique-]YYYY-MM-DD")} Linked title]]`;
    await waitExpression(`app.editor.getValue()===${JSON.stringify(expected)}`, "unique wikilink inserted at selection");
    await save("Link target.md", expected);
    expectedFiles.set("Link target.md", expected);
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    await click('[data-core-ribbon="random-note"]');
    await evaluate("app.core.whenIdle()");
    await waitExpression("app.current?.file.extension==='md'", "random Markdown note opened");
    const path = await evaluate("app.current.file.path");
    const source = (await readFile(join(vault, ...path.split("/")), "utf8")).replace(/^\uFEFF/, "");
    assert.equal(await evaluate("app.editor.getValue()"), source);
  }

  await settings("backlink", { backlinkInDocument: false });
  pass("backlink:settings");
  for (const id of ["file-explorer", "outline", "word-count", "random-note", "outgoing-link", "global-search", "tag-pane", "footnotes", "editor-status"]) {
    await coreSettings();
    assert.equal(await evaluate(`document.querySelector('[data-core-id="${id}"] [data-core-settings]')===null`), true, `${id} must not gain an invented settings page`);
    assert.equal(await evaluate(`app.core.state(${JSON.stringify(id)}).settingsSupport`), "none");
    pass(`${id}:settings`);
    await closeSettings();
  }
  for (const id of implemented) {
    if (!await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`)) {
      await toggle(id, true);
      await closeSettings();
    }
  }
  const owned = await evaluate(`Object.fromEntries(${JSON.stringify(implemented)}.map(id=>[id,app.commands.listCommands().map(command=>command.id).filter(command=>command===id||command.startsWith((id==="outgoing-link"?"outgoing-links":id)+":"))]))`);
  const chrome = {
    "file-explorer": "#file-explorer-view",
    "command-palette": '.workspace-ribbon > [aria-label="Command palette"]',
    switcher: '.workspace-ribbon > [aria-label="Quick switcher"]',
    outline: "#outline-view",
    "word-count": "#editor-statistics",
  };
  for (const id of implemented) {
    await toggle(id, false);
    assert.equal(await evaluate(`app.internalPlugins.getPluginById(${JSON.stringify(id)}).enabled`), false);
    assert.equal(await evaluate(`app.internalPlugins.getEnabledPluginById(${JSON.stringify(id)})`), null);
    assert.ok((await evaluate("app.commands.listCommands().map(command=>command.id)")).every(command => !belongs(command, id)));
    assert.equal(await evaluate(`document.querySelector('[data-core-ribbon="${id}"]')===null`), true);
    if (chrome[id]) {
      assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(chrome[id])})).display`), "none", `${id} chrome must disappear`);
    }
    await closeSettings();
    if (id === "command-palette" || id === "switcher") {
      await press(id === "command-palette" ? "p" : "o", id === "command-palette" ? "KeyP" : "KeyO", id === "command-palette" ? 80 : 79, 2);
      assert.equal(await evaluate('document.querySelector("#desktop-picker").open'), false);
    }
    if (id === "word-count") {
      assert.equal(await evaluate('document.querySelector("#editor-statistics").textContent'), "");
    }
    if (id === "outline") {
      assert.equal(await evaluate('document.querySelector("#outline-content").childElementCount'), 0);
    }
    if (id === "editor-status") {
      assert.equal(await evaluate('document.querySelector("[data-editor-status]")'), null);
    }
    if (id === "outgoing-link") {
      assert.equal(await evaluate('document.querySelector(\'[data-sidebar-view="outgoing-link"]\')'), null);
      assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("outgoing-link")'), null);
    }
    const discovery = { "global-search": "search", "tag-pane": "tag", backlink: "backlink", footnotes: "footnotes" }[id];
    if (discovery) {
      assert.equal(await evaluate(`document.querySelector('[data-discovery-view="${discovery}"]')`), null);
    }
    await toggle(id, true);
    assert.equal(await evaluate(`app.internalPlugins.getPluginById(${JSON.stringify(id)}).enabled&&app.internalPlugins.getEnabledPluginById(${JSON.stringify(id)})===app.internalPlugins.getPluginById(${JSON.stringify(id)}).instance`), true);
    const available = await evaluate("app.commands.listCommands().map(command=>command.id)");
    assert.deepEqual(available.filter(command => belongs(command, id)).sort(), owned[id].sort());
    if (chrome[id]) {
      assert.notEqual(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(chrome[id])})).display`), "none", `${id} chrome must return`);
    }
    if (id === "outgoing-link") {
      assert.equal(await evaluate('document.querySelectorAll(\'[data-sidebar-view="outgoing-link"]\').length'), 1);
      assert.equal(await evaluate('app.internalPlugins.getPluginById("outgoing-link").enabled'), true);
    }
    if (id === "editor-status") {
      assert.equal(await evaluate('document.querySelectorAll("[data-editor-status]").length'), 1);
    }
    if (discovery) {
      assert.equal(await evaluate(`document.querySelectorAll('[data-discovery-view="${discovery}"]').length`), 1);
    }
    await closeSettings();
  }

  const emptyVault = join(vault, ".core-isolation");
  await mkdir(emptyVault);
  for (const id of implemented.filter(id => !["zk-prefixer", "random-note"].includes(id))) {
    await toggle(id, false);
    await closeSettings();
  }
  await switchVault(emptyVault);
  for (const id of implemented) {
    assert.equal(await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`), defaults.get(id), `${id} must use the other vault's reference defaults`);
  }
  assert.equal(await evaluate('app.core.state("templates").settings.folder'), "");
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("templates").options.folder'), "");
  assert.equal(await evaluate('app.core.state("daily-notes").settings.folder'), "");
  assert.equal(await evaluate('app.core.state("command-palette").settings.pinned'), null);
  await toggle("random-note", true);
  await closeSettings();
  await click('[data-core-ribbon="random-note"]');
  await waitExpression('document.querySelector(".notice-container")?.textContent.includes("no Markdown notes")', "empty random-note notification");
  assert.equal(await evaluate("app.vault.getFiles().length"), 0);
  assert.equal(await evaluate("app.current"), null);
  pass("random-note:open");
  await press("o", "KeyO", 79, 2);
  await waitExpression('document.querySelector("#desktop-picker").open', "switcher in empty vault");
  assert.equal(await evaluate('document.querySelectorAll("[data-switcher-path], [data-switcher-create]").length'), 0);
  assert.equal(await evaluate('document.querySelector(".suggestion-empty").textContent'), "No results found.");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate("app.vault.getFiles().length"), 0);
  pass("switcher:new-tab");
  await switchVault(vault);
  for (const id of implemented) {
    assert.equal(await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`), ["zk-prefixer", "random-note"].includes(id), `${id} must restore this vault's state`);
    pass(`${id}:lifecycle`);
  }
  for (const id of ["zk-prefixer", "random-note"]) {
    await toggle(id, false);
    await closeSettings();
  }
  await restartDesktop();
  for (const id of implemented) {
    assert.equal(await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`), false, `${id} disabled state after a full process restart`);
  }
  const disabledCommands = await evaluate("app.commands.listCommands().map(command=>command.id)");
  assert.ok(implemented.every(id => !disabledCommands.some(command => belongs(command, id))));
  for (const id of implemented) {
    await toggle(id, true);
    await closeSettings();
  }
  await restartDesktop();
  for (const id of implemented) {
    assert.equal(await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`), true, `${id} enabled state after a second full process restart`);
    const actual = await evaluate("app.commands.listCommands().map(command=>command.id)");
    assert.deepEqual(actual.filter(command => belongs(command, id)).sort(), owned[id].sort());
  }
  for (const [id, values] of Object.entries({ templates: { folder: "Templates", dateFormat: "YYYY.MM.DD", timeFormat: "HH:mm:ss" }, "daily-notes": { format: "YYYY/MM/DD", folder: "Journal", template: "Templates/Daily" }, "zk-prefixer": uniqueSettings, "command-palette": { pinned: pinnedCommands }, backlink: { backlinkInDocument: false } })) {
    for (const [key, value] of Object.entries(values)) {
      assert.deepEqual(await evaluate(`app.core.state(${JSON.stringify(id)}).settings[${JSON.stringify(key)}]`), value);
    }
  }
  for (const [path, text] of expectedFiles) {
    assert.equal(await readFile(join(vault, ...path.split("/")), "utf8"), text);
  }
  for (const id of implemented) {
    pass(`${id}:restart`);
  }
  assert.deepEqual(JSON.parse(await readFile(join(vault, ".obsidian", "core-plugins.json"), "utf8"))["future-core"], { preserve: ["exact"] });
  report.coreProcessRestarts = 2;
  report.coreFeatureFiles = Object.fromEntries(expectedFiles);
  report.finalWorkspaceLayout = await evaluate("app.workspace.getLayout()");
  report.checks.push("Core controls removed/restored actual commands, ribbon/view resources and keyboard access, isolated state between vaults, retained unknown configuration fields, and survived full disabled/enabled desktop process restarts. Templates, dated notes, unique collision handling and random-note empty/attachment cases ran through real UI.");
  report.checks.push("Command palette settings added/reordered/removed real pinned commands and respected editor/conditional availability. Quick switcher opened a result with Ctrl+Enter, cancelled and created a missing nested note, and handled an empty vault without creating a file.");
  await coreSettings();
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(vault, "..", "evidence", "core-plugins.png"), Buffer.from(screenshot.data, "base64"));
  await closeSettings();

  const layoutBeforeViewer = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
  const workspaceBeforeViewer = await readFile(join(vault, ".obsidian", "workspace.json"));
  let vaultOrigin = await evaluate("location.origin");
  const pages = await createWebViewerPages(() => vaultOrigin);
  const viewerConnections = [];
  try {
    await toggle("webviewer", false);
    await closeSettings();
    const note = "Web viewer acceptance.md";
    await createNote(note);
    const content = `# Viewer link\n\n[Open fixture](${pages.origin}/one)\n`;
    await input(content);
    await save(note, content);
    await checkWebViewer({
      host: { evaluate, click, fill: fillInput, wait: waitExpression, press },
      origin: pages.origin, requests: pages.requests, directory: vault, note,
      originalWorkspace: workspaceBeforeViewer,
      targets: ui.desktopTargets,
      connect: async target => {
        const connection = await connectWebViewerTarget(target, waitFor);
        viewerConnections.push(connection);
        return connection;
      },
      restart: async () => {
        await restartDesktop();
        vaultOrigin = await evaluate("location.origin");
      },
      until: waitFor, runCase: scenario,
      pass: text => { report.checks.push(text); console.log("PASS " + text); },
      capture: async remote => {
        const image = await remote.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(vault, "..", "evidence", "core-webviewer-page.png"), Buffer.from(image.data, "base64"));
      },
    });
    await evaluate(`(async()=>{await app.workspace.changeLayout(${JSON.stringify(layoutBeforeViewer)});await app.workspace.flushLayout()})()`);
    assert.deepEqual(await evaluate("app.workspace.getLayout()"), layoutBeforeViewer);
    report.coreProcessRestarts += 2;
  } finally {
    for (const connection of viewerConnections) { connection.socket.close(); }
    await pages.close();
  }
}
