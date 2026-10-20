import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkOrganization({ directory, evaluate, command, click, press, wait, afterReload, restart, report }) {
  const path = "Organization/Source.md";
  const text = [
    "# Organization", "", "## Destination", "",
    ...Array.from({ length: 55 }, (_, index) => [`Padding paragraph ${index}.`, ""]).flat(),
    "A specific distant paragraph. ^organization-block", "", "organization needle", "",
  ].join("\r\n");
  const blockLine = text.split(/\r\n/).findIndex(line => line.includes("^organization-block"));
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  const configurationPath = join(directory, ".obsidian", "bookmarks.json");
  const original = {
    items: [
      { type: "group", title: "Reference group", ctime: 10, futureGroup: { keep: true }, items: [
        { type: "file", path, subpath: "#Destination", ctime: 11, futureItem: ["retained"] },
        { type: "file", path, subpath: "#^organization-block", ctime: 12 },
        { type: "folder", path: "Organization/Empty", ctime: 13 },
        { type: "search", query: 'path:Organization "organization needle"', ctime: 14 },
      ] },
      { type: "future-bookmark-kind", ctime: 15, payload: { retained: true } },
    ],
    futureConfiguration: { retained: [null, "value", 42] },
  };
  const stored = async () => JSON.parse((await readFile(configurationPath, "utf8")).replace(/^\uFEFF/, ""));
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate organization observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  async function fill(selector, value) {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: value });
  }
  async function settings() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await wait('document.querySelector("#settings-dialog").open', "organization settings");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function closeSettings() {
    await click(".settings-close");
    await wait('!document.querySelector("#settings-dialog").open', "organization settings closed");
  }
  async function toggle(id, enabled) {
    await settings();
    if (await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`) !== enabled) { await click(`[data-core-toggle="${id}"]`); }
    await wait(`!app.core.busy&&app.core.isEnabled(${JSON.stringify(id)})===${enabled}`, id + " toggled");
    await closeSettings();
  }
  const row = address => `[data-bookmark-address="${address}"]`;
  const action = (address, name) => `${row(address)} [data-bookmark-action="${name}"]`;
  const field = name => `[data-core-dialog="bookmarks"] [data-bookmark-field="${name}"]`;
  async function showBookmarks() {
    await evaluate('app.commands.execute("bookmarks:open")');
    await wait('Boolean(document.querySelector(".bookmarks-pane [data-bookmark-filter]"))', "real Bookmarks view");
  }
  async function saveDialog() {
    await click('[data-core-dialog="bookmarks"] [data-bookmark-action="save"]');
    await wait('!document.querySelector(\'[data-core-dialog="bookmarks"]\')&&!app.core.getEnabledPluginById("bookmarks").busy', "bookmark committed");
  }
  await toggle("bookmarks", false);
  await mkdir(join(directory, "Organization", "Empty"), { recursive: true });
  await writeFile(join(directory, path), bytes);
  await writeFile(configurationPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(original, null, 2))]));
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await toggle("bookmarks", true);
  await showBookmarks();
  assert.equal(await evaluate('app.workspace.getLeavesOfType("bookmarks").every(leaf=>leaf.session===null&&!leaf.containerEl.querySelector(".cm-editor"))'), true);
  await settings();
  assert.equal(await evaluate('app.core.state("bookmarks").settingsSupport'), "none");
  assert.equal(await evaluate('Boolean(document.querySelector(\'[data-core-settings="bookmarks"]\'))'), false);
  await closeSettings();
  accept("bookmarks:settings");

  await click(action("0.0", "open"));
  await wait(`app.current?.file.path===${JSON.stringify(path)}&&app.editor.getCursor().line===2`, "bookmark reveals the actual heading");
  await evaluate('app.markdownView.setMode("preview")');
  await click(action("0.1", "open"));
  await wait(`app.markdownView.getMode()==="preview"&&app.markdownView.editor.getCursor().line===${blockLine}`, "bookmark retains Reading mode and reveals the actual block");
  assert.equal(await evaluate(`(()=>{const view=app.markdownView.previewEl;const block=view.querySelector('[data-source-line="${blockLine}"]');if(!block)return false;const outer=view.getBoundingClientRect(),inner=block.getBoundingClientRect();return block.textContent.includes("specific distant paragraph")&&inner.top>=outer.top-2&&inner.top<outer.bottom})()`), true);
  await click(action("0.2", "open"));
  await wait('document.activeElement===document.querySelector(\'[data-folder-path="Organization/Empty"] summary\')', "bookmark opens a genuinely empty folder");
  await showBookmarks();
  await click(action("0.3", "open"));
  await wait('document.querySelector("[data-search-status]")?.dataset.searchComplete==="true"&&document.querySelector("[data-search-file]")?.dataset.searchFile==="Organization/Source.md"', "saved bookmark executes the actual Search");
  await showBookmarks();
  assert.match(await evaluate('app.core.getEnabledPluginById("bookmarks").openBookmark({type:"file",path:"Organization/Missing.md"}).then(()=>"unexpected success",error=>error.message)'), /missing/);
  assert.match(await evaluate('app.core.getEnabledPluginById("bookmarks").openBookmark({type:"future-bookmark-kind"}).then(()=>"unexpected success",error=>error.message)'), /not implemented/);
  pass("Bookmarks opens actual heading/block, empty-folder and saved-search targets; distant Reading blocks scroll precisely and missing/unsupported targets reject without discarding data.");

  await click('[data-type="bookmarks"] [aria-label="Add bookmark group"]');
  await fill(field("title"), "New group");
  await saveDialog();
  await click('[data-type="bookmarks"] [aria-label="Add bookmark"]');
  await fill(field("target"), path);
  await fill(field("title"), "Display title");
  await saveDialog();
  assert.equal((await stored()).items[3].title, "Display title");
  await click(action("3", "up"));
  await wait('document.querySelector(\'[data-bookmark-address="2"] .bookmark-target\')?.textContent==="Display title"', "reordered actual bookmarks");
  await click(action("2", "edit"));
  await fill(field("title"), "Renamed title");
  await saveDialog();
  const oldVersion = await evaluate('app.core.getEnabledPluginById("bookmarks").version');
  await click(action("2", "down"));
  await wait('document.querySelector(\'[data-bookmark-address="3"] .bookmark-target\')?.textContent==="Renamed title"', "moved bookmark down");
  assert.match(await evaluate(`app.core.getEnabledPluginById("bookmarks").move([3],[], -1,${JSON.stringify(oldVersion)}).then(()=>"unexpected success",error=>error.message)`), /changed while this control was open/);
  await click(action("3", "move"));
  await press("Home", "Home", 36);
  await press("ArrowDown", "ArrowDown", 40);
  await press("Enter", "Enter", 13);
  await wait('document.querySelector(\'[data-bookmark-address="0.4"] .bookmark-target\')?.textContent==="Renamed title"', "moved bookmark into real nested group");
  await click(action("0.4", "remove"));
  await click('[data-bookmark-action="confirm-remove"]');
  await wait('!document.querySelector(\'[data-core-dialog="bookmarks"]\')&&!document.querySelector(\'[data-bookmark-address="0.4"]\')', "removed bookmark without deleting the note");
  await fill("[data-bookmark-filter]", "Source");
  assert.equal(await evaluate('Boolean(document.querySelector(\'[data-bookmark-type="future-bookmark-kind"]\'))'), false);
  const data = await stored();
  assert.deepEqual(data.futureConfiguration, original.futureConfiguration);
  assert.deepEqual(data.items[0], original.items[0]);
  assert.deepEqual(data.items[1], original.items[1]);
  assert.equal(data.items[2].title, "New group");
  assert.deepEqual(data.items[2].items, []);
  assert.deepEqual((await readFile(configurationPath)).subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  accept("bookmarks:organize");
  pass("Actual Bookmarks controls add groups/files, rename, reorder, move into groups, remove and filter; BOM, unknown data and note bytes survive, and obsolete controls cannot mutate newer data.");

  assert.match(await evaluate('(async()=>{const bookmarks=app.core.getEnabledPluginById("bookmarks");const first=bookmarks.reload();try{return await bookmarks.reload().then(()=>"unexpected success",error=>error.message)}finally{await first}})()'), /current bookmark change/);
  await evaluate('globalThis.organizationView=app.workspace.getLeavesOfType("bookmarks")[0].view;globalThis.organizationClose=organizationView.onBeforeClose;organizationView.onBeforeClose=()=>{throw new Error("Expected core bookmark close veto")};true');
  try {
    assert.match(await evaluate('app.core.setEnabled("bookmarks",false).then(()=>"unexpected success",error=>error.message)'), /Expected core bookmark close veto/);
    assert.equal(await evaluate('app.core.isEnabled("bookmarks")&&app.workspace.getLeavesOfType("bookmarks")[0].view===organizationView&&organizationView.isLoaded&&organizationView.containerEl.isConnected'), true);
  } finally {
    await evaluate('organizationView.onBeforeClose=organizationClose;delete globalThis.organizationClose;delete globalThis.organizationView');
  }
  await toggle("bookmarks", false);
  assert.equal(await evaluate('app.commands.status().some(command=>command.id.startsWith("bookmarks:"))'), false);
  assert.equal(await evaluate('app.workspace.getLeavesOfType("bookmarks").every(leaf=>leaf.isDeferred&&leaf.view.getViewType()==="unavailable"&&!leaf.containerEl.querySelector(".cm-editor"))'), true);
  await toggle("bookmarks", true);
  await showBookmarks();
  assert.equal(await evaluate('document.querySelector("[data-bookmark-filter]").value'), "Source");
  assert.deepEqual(await stored(), data);
  pass("The async core lifecycle honors an actual Bookmarks preflight veto without unloading its original view, removes owned controls/providers on disable, restores unavailable panes with their filters, and rejects concurrent reloads.");

  await evaluate("app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  await showBookmarks();
  assert.equal(await evaluate('document.querySelector("[data-bookmark-filter]").value'), "Source");
  assert.deepEqual(await stored(), data);
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  await fill("[data-bookmark-filter]", "");
  pass("Organized Bookmarks data and actual per-pane filter state survive a fresh runtime without modifying original note bytes.");
}

export async function checkNamedWorkspaces({ directory, evaluate, command, click, press, wait, afterReload, restart, report }) {
  const configuration = join(directory, ".obsidian", "vault-dotnet-workspaces.json");
  const originalPath = join(directory, ".obsidian", "workspaces.json");
  const original = '{"workspaces":{"Original":{"privateLayout":"retain"}},"active":"Original","future":{"preserved":true}}\n';
  const notePath = join(directory, "Organization", "Source.md");
  const originalNote = await readFile(notePath);
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate named-workspace observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  const stored = async () => JSON.parse((await readFile(configuration, "utf8")).replace(/^\uFEFF/, ""));
  const named = 'app.core.getEnabledPluginById("workspaces")';
  const dialog = '[data-core-dialog="workspaces"]';
  const row = name => `[data-named-workspace="${name}"]`;
  async function fill(selector, value) {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: value });
  }
  async function toggle(enabled) {
    await click("#open-settings");
    await wait('document.querySelector("#settings-dialog").open', "workspace module settings");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
    if (await evaluate('app.core.isEnabled("workspaces")') !== enabled) { await click('[data-core-toggle="workspaces"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("workspaces")===${enabled}`, "workspace module toggled");
    await click(".settings-close");
    await wait('!document.querySelector("#settings-dialog").open', "workspace module settings closed");
  }
  async function open() {
    await evaluate('app.commands.execute("workspaces:open-modal")');
    await wait(`Boolean(document.querySelector('${dialog} [data-workspace-name]'))`, "real named workspace manager");
  }
  async function settled(condition) {
    await wait(`!${named}.busy&&!document.querySelector('${dialog} .modal-content').inert&&(${condition})`, "named workspace operation completed");
  }
  const normalized = layout => {
    const value = structuredClone(layout);
    delete value.mtime;
    if (value.views) { delete value.views["named-workspaces"]; }
    return value;
  };
  await toggle(false);
  await writeFile(originalPath, original);
  await writeFile(configuration, "\ufeff" + JSON.stringify({ workspaces: {}, futureConfiguration: { keep: [true, 42] } }));
  await toggle(true);
  assert.equal(await evaluate('app.core.state("workspaces").settingsSupport'), "none");
  accept("workspaces:settings");
  await evaluate('(async()=>{await app.openFile("Organization/Source.md");app.markdownView.setMode("preview");app.workspace.activeLeaf.pinned=true;const duplicate=await app.workspace.duplicateLeaf(app.workspace.activeLeaf,"split","horizontal");duplicate.view.setMode("source");app.workspace.rightSplit.setWidth(333);app.workspace.rightSplit.expand()})()');
  await open();
  await fill("[data-workspace-name]", "Review");
  await click('[data-named-workspace-action="save"]');
  await settled(`Boolean(document.querySelector('${row("Review")}'))`);
  const expected = await evaluate("app.workspace.getLayout()");
  assert.deepEqual(normalized((await stored()).workspaces.Review), normalized(expected));
  assert.match(await evaluate(`${named}.save("Review").then(()=>"unexpected success",error=>error.message)`), /already exists/);
  await click(`${dialog} .modal-close-button`);

  await evaluate('app.workspace.getLeftLeaf(true).setViewState({type:"empty",active:true})');
  await evaluate("app.workspace.rightSplit.setWidth(190);app.workspace.rightSplit.collapse()");
  await open();
  await click(`${row("Review")} [data-named-workspace-action="load"]`);
  await settled(`${named}.active==="Review"`);
  assert.deepEqual(normalized(await evaluate("app.workspace.getLayout()")), normalized(expected));
  assert.equal(await evaluate('app.workspace.getLeavesOfType("bookmarks").every(leaf=>leaf.session===null&&!leaf.containerEl.querySelector(".cm-editor"))'), true);
  await click(`${dialog} .modal-close-button`);
  pass("The actual Workspaces manager saves and loads real split/tab/pin/Reading/sidebar and core-view state, without hidden editors or rewriting original Obsidian profiles.");

  await evaluate('(async()=>{await app.openFile("Organization/Source.md");app.markdownView.setMode("source");globalThis.namedOriginalLeaf=app.workspace.activeLeaf;globalThis.namedOriginalRoot=app.workspace.rootSplit;true})()');
  const currentText = await evaluate("app.editor.getValue()");
  await evaluate(`app.editor.setValue(${JSON.stringify(currentText + "\r\nKeep this unsaved edit.\r\n")})`);
  const beforeConflict = await evaluate("app.workspace.getLayout()");
  await writeFile(notePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("External conflict must survive.\r\n")]));
  assert.match(await evaluate(`${named}.load("Review").then(()=>"unexpected success",error=>error.message)`), /changed on disk/);
  assert.equal(await evaluate("app.workspace.rootSplit===namedOriginalRoot&&app.workspace.activeLeaf===namedOriginalLeaf&&app.dirty"), true);
  assert.equal(await evaluate("app.editor.getValue()"), currentText + "\r\nKeep this unsaved edit.\r\n");
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), beforeConflict);
  assert.equal((await readFile(notePath, "utf8")).replace(/^\uFEFF/, ""), "External conflict must survive.\r\n");
  await writeFile(notePath, originalNote);
  await evaluate("app.workspace.reloadCurrent(true)");
  await evaluate('globalThis.namedUnregister=app.workspace.registerView("organization-probe","organization-failing-view",()=>{throw new Error("Expected candidate layout factory failure")});true');
  try {
    assert.match(await evaluate('(async()=>{const value=app.workspace.getLayout();value.main.children.push({id:"organization-probe-tabs",type:"tabs",currentTab:0,children:[{id:"organization-probe-leaf",type:"leaf",state:{type:"organization-failing-view",pinned:false,state:{retain:true}}}]});return app.workspace.changeLayout(value).then(()=>"unexpected success",error=>error.message)})()'), /Expected candidate layout factory failure/);
    assert.equal(await evaluate("app.workspace.rootSplit===namedOriginalRoot&&app.workspace.activeLeaf===namedOriginalLeaf&&namedOriginalLeaf.view.isLoaded"), true);
  } finally {
    await evaluate("namedUnregister();delete globalThis.namedUnregister");
  }
  await evaluate('globalThis.namedOriginalView=namedOriginalLeaf.view;globalThis.namedOriginalClose=namedOriginalView.onBeforeClose;namedOriginalView.onBeforeClose=()=>{throw new Error("Expected named layout close veto")};true');
  try {
    assert.match(await evaluate(`${named}.load("Review").then(()=>"unexpected success",error=>error.message)`), /Expected named layout close veto/);
    assert.equal(await evaluate("app.workspace.rootSplit===namedOriginalRoot&&app.workspace.activeLeaf===namedOriginalLeaf&&namedOriginalLeaf.view===namedOriginalView&&namedOriginalView.isLoaded&&namedOriginalView.containerEl.isConnected"), true);
  } finally {
    await evaluate("namedOriginalView.onBeforeClose=namedOriginalClose;delete globalThis.namedOriginalClose;delete globalThis.namedOriginalView;delete globalThis.namedOriginalRoot;delete globalThis.namedOriginalLeaf");
  }
  assert.equal(await evaluate('document.querySelector("#desktop-shell").inert'), false);
  assert.deepEqual(await readFile(notePath), originalNote);
  pass("Saved-layout preflight and staged view loading retain the actual previous editor/DOM on factory failures, explicit preflight vetoes and dirty-save conflicts; external note bytes are not overwritten.");

  await open();
  await fill("[data-workspace-name]", "Renamed review");
  await click(`${row("Review")} [data-named-workspace-action="rename"]`);
  await settled(`Boolean(document.querySelector('${row("Renamed review")}'))`);
  assert.deepEqual(normalized((await stored()).workspaces["Renamed review"]), normalized(expected));
  await fill("[data-workspace-name]", "Disposable layout");
  await click('[data-named-workspace-action="save"]');
  await settled(`Boolean(document.querySelector('${row("Disposable layout")}'))`);
  await click(`${row("Disposable layout")} [data-named-workspace-action="remove"]`);
  await settled(`!document.querySelector('${row("Disposable layout")}')`);
  await click(`${row("Renamed review")} [data-named-workspace-action="load"]`);
  await settled(`${named}.active==="Renamed review"`);
  await click(`${dialog} .modal-close-button`);
  assert.deepEqual((await stored()).futureConfiguration, { keep: [true, 42] });
  assert.deepEqual((await readFile(configuration)).subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
  assert.equal(await readFile(originalPath, "utf8"), original);
  accept("workspaces:named-workspaces");
  await evaluate("app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.equal(await evaluate(`${named}.active`), "Renamed review");
  assert.deepEqual(await evaluate(`${named}.names`), ["Renamed review"]);
  assert.deepEqual(normalized(await evaluate("app.workspace.getLayout()")), normalized(expected));
  assert.equal(await readFile(originalPath, "utf8"), original);
  assert.deepEqual(await readFile(notePath), originalNote);
  pass("Named layouts can be renamed and deleted without deleting notes; guarded profiles, unknown configuration, UTF-8 BOM and the active layout survive a fresh runtime.");
}

export async function checkProperties({ directory, evaluate, command, click, press, wait, afterReload, restart, report }) {
  const path = "Properties/Source.md";
  const other = "Properties/Other.md";
  const configuration = join(directory, ".obsidian", "types.json");
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = "\r\n# Property body\r\n\r\nSelection remains here.\r\n\r\n[[Welcome]]\r\n";
  const text = [
    "---", "# Retained properties", "title: Old title", "project: Alpha", "amount: 9007199254740993 # exact integer",
    "fraction: 0.1234567890123456789", "complete: false", "date: 2026-10-21", "created: 2026-10-21T08:30:00Z",
    "aliases: [First]", 'custom: "[[Welcome]]"', "unknown: {nested: [one, two], precise: 9007199254740995}",
    "shared: &original {keep: true}", "copy: *original", "---", "",
  ].join("\r\n") + body;
  const second = "---\nproject: Beta\ncollision: Retain this value\namount: 9007199254740997\n---\n\n# Second body\n";
  const originalTypes = { types: { title: "text", project: "text", date: "date", created: "datetime", custom: "file" }, futureConfiguration: { keep: [true, 42] } };
  const local = '[data-type="file-properties"]';
  const global = '[data-type="all-properties"]';
  const dialog = '[data-core-dialog="properties"]';
  const field = name => `${dialog} [data-property-field="${name}"]`;
  const row = (pane, name) => `${pane} [data-property-name="${name}"]`;
  const stored = async () => JSON.parse((await readFile(configuration, "utf8")).replace(/^\uFEFF/, ""));
  const note = async () => (await readFile(join(directory, path), "utf8")).replace(/^\uFEFF/, "");
  const bodyOf = content => {
    const delimiter = content.indexOf("\r\n---\r\n");
    assert.ok(delimiter >= 0, "The original CRLF frontmatter delimiter is retained");
    return content.slice(delimiter + 7);
  };
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate properties observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  async function fill(selector, value) {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: value });
  }
  async function choose(selector, value) {
    const index = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option=>option.value===${JSON.stringify(value)})`);
    assert.ok(index >= 0, "The requested property choice exists: " + value);
    await click(selector);
    await press("Home", "Home", 36);
    for (let current = 0; current < index; current++) { await press("ArrowDown", "ArrowDown", 40); }
    await press("Enter", "Enter", 13);
    await wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`, "property choice selected");
  }
  async function toggle(enabled) {
    await click("#open-settings");
    await wait('document.querySelector("#settings-dialog").open', "properties settings");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
    if (await evaluate('app.core.isEnabled("properties")') !== enabled) { await click('[data-core-toggle="properties"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("properties")===${enabled}`, "properties module toggled");
    assert.equal(await evaluate('app.core.state("properties").settingsSupport'), "none");
    assert.equal(await evaluate('Boolean(document.querySelector(\'[data-core-settings="properties"]\'))'), false);
    await click(".settings-close");
    await wait('!document.querySelector("#settings-dialog").open', "properties settings closed");
  }
  async function open(localView) {
    await evaluate(`app.commands.execute(${JSON.stringify(localView ? "properties:open-local" : "properties:open")})`);
    await wait(`Boolean(document.querySelector('${localView ? local : global} [data-properties-filter]'))`, "actual properties pane");
  }
  async function save() {
    await click(`${dialog} [data-property-action="save"]`);
    await wait(`!document.querySelector('${dialog}')`, "property committed");
    await evaluate("app.core.whenIdle()");
  }
  async function add(name, type, value) {
    await click(`${local} [aria-label="Add property"]`);
    await fill(field("name"), name);
    await choose(field("type"), type);
    if (type === "checkbox") { if (value) { await click(field("checked")); } }
    else { await fill(field("value"), value); }
    await save();
  }

  await toggle(false);
  await mkdir(join(directory, "Properties"), { recursive: true });
  await writeFile(join(directory, path), Buffer.concat([bom, Buffer.from(text)]));
  await writeFile(join(directory, other), second);
  await writeFile(configuration, Buffer.concat([bom, Buffer.from(JSON.stringify(originalTypes, null, 2))]));
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await toggle(true);
  await evaluate(`app.openFile(${JSON.stringify(path)})`);
  await open(false);
  await click(`${global} [aria-label="Reload property types and notes"]`);
  await wait('app.metadataTypeManager.getAssignedWidget("custom")==="file"', "original property types loaded");
  await open(true);
  assert.equal(await evaluate('["file-properties","all-properties"].flatMap(type=>app.workspace.getLeavesOfType(type)).every(leaf=>leaf.session===null&&!leaf.containerEl.querySelector(".cm-editor"))'), true);
  assert.equal(await evaluate(`document.querySelector('${row(local, "unknown")} [data-property-action="edit"]').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('${row(local, "custom")} [data-property-action="edit"]').disabled`), true);
  accept("properties:settings");

  await evaluate('(async()=>{await app.openFile("Properties/Source.md");app.markdownView.setMode("source");const editor=app.editor;editor.setCursor({line:editor.getValue().split("\\r\\n").findIndex(line=>line.startsWith("Selection remains")),ch:23});editor.focus()})()');
  await command("Input.insertText", { text: " Edited body." });
  await wait("app.dirty", "dirty body before property edit");
  const bodyBefore = bodyOf(await evaluate("app.editor.getValue()"));
  await evaluate('(()=>{const editor=app.editor;const line=editor.getValue().split("\\r\\n").findIndex(line=>line.startsWith("Selection remains"));editor.setSelection({line,ch:0},{line,ch:9})})()');
  await click(`${row(local, "title")} [data-property-action="edit"]`);
  await fill(field("value"), "New title");
  await save();
  assert.equal(await evaluate("app.workspace.getMostRecentLeaf().view.editor.getSelection()"), "Selection");
  assert.equal(bodyOf(await note()), bodyBefore);
  await evaluate("app.workspace.setActiveLeaf(app.workspace.getMostRecentLeaf());app.editor.focus()");
  await press("z", "KeyZ", 90, 2);
  await wait('app.editor.getValue().includes("title: Old title")', "property undo");
  assert.equal(bodyOf(await evaluate("app.editor.getValue()")), bodyBefore);
  await press("z", "KeyZ", 90, 2);
  await wait('!app.editor.getValue().includes("Edited body.")', "original body edit remains undoable");
  await press("y", "KeyY", 89, 2);
  await wait('app.editor.getValue().includes("Edited body.")', "body edit redo");
  await press("y", "KeyY", 89, 2);
  await wait('app.editor.getValue().includes("title: New title")', "property redo");
  await evaluate("app.saveAll()");
  assert.equal(bodyOf(await note()), bodyBefore);

  await open(true);
  await add("budget", "number", "42.5");
  await click(`${row(local, "complete")} [data-property-action="edit"]`);
  await click(field("checked"));
  await save();
  await click(`${row(local, "aliases")} [data-property-action="edit"]`);
  await fill(field("value"), "First\nSecond");
  await save();
  await evaluate('app.workspace.getMostRecentLeaf().view.setMode("preview")');
  await add("deadline", "date", "2028-02-29");
  assert.equal(await evaluate('app.workspace.getMostRecentLeaf().view.getMode()'), "preview");
  assert.equal(await evaluate('app.workspace.getMostRecentLeaf().view.previewEl.textContent.includes("Edited body.")'), true);
  await click(`${row(local, "deadline")} [data-property-action="remove"]`);
  await click(`${dialog} [data-property-action="confirm-remove"]`);
  await wait(`!document.querySelector('${dialog}')`, "property removed");
  const metadata = await evaluate('app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("Properties/Source.md")).frontmatter');
  assert.equal(metadata.budget, 42.5);
  assert.equal(metadata.complete, true);
  assert.deepEqual(metadata.aliases, ["First", "Second"]);
  assert.ok(!Object.hasOwn(metadata, "deadline"));
  assert.deepEqual(metadata.unknown.nested, ["one", "two"]);
  assert.deepEqual(metadata.shared, metadata.copy);
  assert.match(await note(), /amount: 9007199254740993 # exact integer/);
  assert.match(await note(), /fraction: 0\.1234567890123456789/);
  assert.match(await note(), /precise: 9007199254740995/);
  assert.equal(bodyOf(await note()), bodyBefore);
  assert.deepEqual((await readFile(join(directory, path))).subarray(0, 3), bom);
  pass("Actual local Properties controls edit source/Reading notes, typed numbers, checkboxes and lists; body selections and existing undo/redo survive while exact numeric literals, comments, anchors, unknown structured/type data and BOM/CRLF are retained.");

  const beforeInvalid = await readFile(join(directory, path));
  await click(`${local} [aria-label="Add property"]`);
  await fill(field("name"), "precision");
  await choose(field("type"), "number");
  await fill(field("value"), "9007199254740993");
  await click(`${dialog} [data-property-action="save"]`);
  await wait(`document.querySelector('${dialog} [role="alert"]').textContent.includes("represent safely")`, "lossy number explicitly rejected");
  assert.deepEqual(await readFile(join(directory, path)), beforeInvalid);
  await click(`${dialog} .modal-close-button`);
  await click(`${row(local, "title")} [data-property-action="edit"]`);
  const external = (await note()).replace("title: New title", "title: External title");
  await writeFile(join(directory, path), Buffer.concat([bom, Buffer.from(external)]));
  await fill(field("value"), "Must not replace external property");
  await click(`${dialog} [data-property-action="save"]`);
  await wait(`document.querySelector('${dialog} [role="alert"]').textContent.includes("property changed")`, "stale property dialog rejected");
  assert.equal(await note(), external);
  await click(`${dialog} .modal-close-button`);
  await evaluate('(async()=>{await app.openFile("Properties/Source.md");app.markdownView.setMode("source");app.editor.setCursor({line:app.editor.lastLine(),ch:0});app.editor.focus()})()');
  await command("Input.insertText", { text: "Retained unsaved property conflict." });
  await wait("app.dirty", "unsaved note before external property conflict");
  const newer = external.replace("title: External title", "title: Newer external title");
  await writeFile(join(directory, path), Buffer.concat([bom, Buffer.from(newer)]));
  await open(true);
  await click(`${row(local, "title")} [data-property-action="edit"]`);
  await fill(field("value"), "Must not discard dirty buffer");
  await click(`${dialog} [data-property-action="save"]`);
  await wait(`document.querySelector('${dialog} [role="alert"]').textContent.includes("changed on disk")`, "dirty property save conflict rejected");
  assert.equal(await evaluate('app.workspace.sessions.get("Properties/Source.md").dirty'), true);
  assert.equal(await evaluate('app.workspace.sessions.get("Properties/Source.md").text.includes("Retained unsaved property conflict.")'), true);
  assert.equal(await note(), newer);
  await click(`${dialog} .modal-close-button`);
  await evaluate('(async()=>{app.workspace.setActiveLeaf(app.workspace.getMostRecentLeaf());await app.workspace.reloadCurrent(true)})()');
  accept("properties:typed-edit");
  pass("Properties rejects unsafe numeric input, obsolete dialogs and dirty external-save conflicts without overwriting newer file bytes or discarding the original unsaved buffer.");

  await open(false);
  await fill(`${global} [data-properties-filter]`, "proj");
  assert.equal(await evaluate(`document.querySelectorAll('${global} [data-property-name]').length`), 1);
  assert.equal(await evaluate(`document.querySelector('${row(global, "project")} [data-property-value]').textContent`), "2 notes");
  await choose(`${global} [data-properties-sort]`, "frequency");
  await choose(`${global} [data-property-type="project"]`, "multitext");
  await wait('app.metadataTypeManager.getAssignedWidget("PROJECT")==="multitext"', "global assigned type changed");
  assert.equal((await stored()).types.project, "multitext");
  const beforeRename = [await readFile(join(directory, path)), await readFile(join(directory, other)), await readFile(configuration)];
  await click(`${row(global, "project")} [data-property-action="rename"]`);
  await fill(field("rename"), "collision");
  await click(`${dialog} [data-property-action="rename"]`);
  await wait('!app.core.getEnabledPluginById("properties").busy&&document.querySelector("#client-errors").textContent.includes("destination property already exists")', "vault-wide collision preflight rejected");
  assert.deepEqual([await readFile(join(directory, path)), await readFile(join(directory, other)), await readFile(configuration)], beforeRename);
  await click(`${dialog} .modal-close-button`);
  await click(`${row(global, "project")} [data-property-action="rename"]`);
  await fill(field("rename"), "label");
  await click(`${dialog} [data-property-action="rename"]`);
  await wait(`!document.querySelector('${dialog}')&&!app.core.getEnabledPluginById("properties").busy`, "vault-wide property rename committed");
  await fill(`${global} [data-properties-filter]`, "label");
  assert.equal(await evaluate(`document.querySelector('${row(global, "label")} [data-property-value]').textContent`), "2 notes");
  const renamedTypes = await stored();
  assert.equal(renamedTypes.types.label, "multitext");
  assert.ok(!Object.hasOwn(renamedTypes.types, "project"));
  assert.equal(renamedTypes.types.custom, "file");
  assert.deepEqual(renamedTypes.futureConfiguration, originalTypes.futureConfiguration);
  assert.match(await note(), /label: Alpha/);
  assert.match(await note(), /amount: 9007199254740993 # exact integer/);
  assert.match(await note(), /fraction: 0\.1234567890123456789/);
  assert.equal(bodyOf(await note()), bodyBefore);
  assert.equal(await readFile(join(directory, other), "utf8"), second.replace("project: Beta", "label: Beta"));
  assert.deepEqual((await readFile(configuration)).subarray(0, 3), bom);
  accept("properties:catalog");
  pass("The real vault property catalog filters/sorts/counts, assigns case-insensitive types and renames a property in both notes and types.json; all-note collision preflight, unknown types/configuration and precise YAML/body bytes are preserved.");

  await open(true);
  await click(`${local} [aria-label="Pin or follow file properties"]`);
  await fill(`${local} [data-properties-filter]`, "title");
  await evaluate(`app.openFile(${JSON.stringify(other)})`);
  assert.equal(await evaluate(`document.querySelector('${local} [data-properties-file]').dataset.propertiesFile`), path);
  await open(false);
  const expected = await evaluate('["file-properties","all-properties"].map(type=>app.workspace.getLeavesOfType(type)[0].getViewState())');
  const expectedNotes = [await readFile(join(directory, path)), await readFile(join(directory, other))];
  await toggle(false);
  assert.equal(await evaluate('document.querySelector("[data-core-status=properties]")===null&&!app.commands.status().some(command=>command.id.startsWith("properties:"))'), true);
  assert.equal(await evaluate('app.workspace.leaves().filter(leaf=>["file-properties","all-properties"].includes(leaf.getViewState().type)).every(leaf=>leaf.view.getViewType()==="unavailable"&&leaf.isDeferred&&!leaf.containerEl.querySelector(".cm-editor"))'), true);
  await toggle(true);
  assert.deepEqual(await evaluate('["file-properties","all-properties"].map(type=>app.workspace.getLeavesOfType(type)[0].getViewState())'), expected);
  await evaluate("app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.deepEqual(await evaluate('["file-properties","all-properties"].map(type=>app.workspace.getLeavesOfType(type)[0].getViewState())'), expected);
  await open(true);
  assert.equal(await evaluate(`document.querySelector('${local} [data-properties-filter]').value`), "title");
  assert.equal(await evaluate(`document.querySelector('${local} [data-properties-file]').dataset.propertiesFile`), path);
  assert.equal(await evaluate('app.metadataTypeManager.getAssignedWidget("label")'), "multitext");
  assert.deepEqual(await stored(), renamedTypes);
  assert.deepEqual([await readFile(join(directory, path)), await readFile(join(directory, other))], expectedNotes);
  pass("Actual Properties owned views, filters, sort, pinned file and assigned types survive disable/re-enable and a fresh runtime; unsupported providers retain their saved states without hidden editors or note rewrites.");
}
