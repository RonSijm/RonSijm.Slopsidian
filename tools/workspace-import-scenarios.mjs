import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWorkspaceImport({ directory, evaluate, command, click, press, wait, afterReload, restart, report, capture }) {
  const note = "Workspace import/Unicode λ.md", notePath = join(directory, note);
  const noteText = "# Unicode λ\r\n\r\nKeep the exact original note bytes.\r\n", bytes = Buffer.from("\ufeff" + noteText);
  const originalPath = join(directory, ".obsidian", "workspaces.json"), localPath = join(directory, ".obsidian", "vault-dotnet-workspaces.json");
  const automaticPath = join(directory, ".obsidian", "workspace.json");
  const automatic = await readFile(automaticPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const profile = {
    main: { id: "import-main", type: "split", direction: "vertical", futureSplit: ["preserved"], children: [
      { id: "import-tabs", type: "tabs", dimension: 65, stacked: true, children: [
        { id: "import-source", type: "leaf", pinned: true, group: "original-linked-panes", state: { type: "markdown", icon: "custom-icon", title: "Source λ", state: { file: note, mode: "source", source: false, futureMarkdown: { keep: [1, null] } } } },
        { id: "import-future", type: "leaf", futureLeaf: { keep: true }, state: { type: "future-import-view", state: { opaque: { plugin: "not installed", preserve: [1, "λ"] } } } },
      ] },
      { id: "import-split", type: "split", direction: "horizontal", children: [
        { id: "import-reading-tabs", type: "tabs", children: [{ id: "import-reading", type: "leaf", state: { type: "markdown", state: { file: note, mode: "preview", futureReading: true } } }] },
      ] },
    ] },
    left: { id: "import-left", type: "split", direction: "horizontal", width: 280, children: [] },
    right: { id: "import-right", type: "split", direction: "horizontal", width: 315, collapsed: true, children: [
      { id: "import-side-tabs", type: "tabs", children: [{ id: "import-side", type: "leaf", state: { type: "future-import-sidebar", state: { untouched: "sidebar data" } } }] },
    ] },
    active: "import-source", mtime: "2026-10-21T12:00:00+02:00", floating: { windows: [{ preserve: "entire floating layout" }] },
    "left-ribbon": { hiddenItems: { "future-core": true } }, futureProfile: { preserved: [42, null, "λ"] },
  };
  const original = { workspaces: { Imported: profile, "  Padded λ  ": profile, Broken: { main: "unsupported old layout" }, Other: { keep: "this unrelated original profile" } }, active: "Other", futureConfiguration: { preserved: [1, "λ"] } };
  let originalBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2) + "\r\n");
  const named = 'app.core.getEnabledPluginById("workspaces")', manager = '[data-core-dialog="workspaces"]';
  const importing = '[data-core-dialog="workspace-import"]', exporting = '[data-core-dialog="workspace-export"]';
  const local = async () => JSON.parse((await readFile(localPath, "utf8")).replace(/^\uFEFF/, ""));
  const stored = async () => JSON.parse((await readFile(originalPath, "utf8")).replace(/^\uFEFF/, ""));
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  async function fill(selector, text) { await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text }); }
  async function open() { await evaluate('app.commands.execute("workspaces:open-modal")'); await wait(`Boolean(document.querySelector('${manager} [data-workspace-name]'))`, "workspace manager"); }
  async function chooseSource(name) {
    const index = await evaluate(`Array.from(document.querySelector('${importing} select').options).findIndex(option=>option.value===${JSON.stringify(name)})`);
    assert.ok(index >= 0);
    await click(importing + " select"); await press("Home", "Home", 36);
    for (let i = 0; i < index; i++) { await press("ArrowDown", "ArrowDown", 40); }
    await press("Enter", "Enter", 13);
    await wait(`document.querySelector('${importing} select').value===${JSON.stringify(name)}`, "original workspace selected");
  }
  async function settled() { await wait(`!${named}.busy&&Boolean(document.querySelector('${manager}'))&&!document.querySelector('${manager} .modal-content').inert`, "workspace transfer settled"); }
  async function importReview() { await open(); await click('[data-named-workspace-action="import"]'); await wait(`Boolean(document.querySelector('${importing}'))&&!${named}.busy`, "original profile review"); }
  async function exportReview() { await open(); await click('[data-named-workspace="Imported"] [data-named-workspace-action="export"]'); await wait(`Boolean(document.querySelector('${exporting}'))&&!${named}.busy`, "saved layout export review"); }
  async function back(selector) { await click(selector + " [data-workspace-transfer-back]"); await wait(`Boolean(document.querySelector('${manager}'))`, "back to workspaces"); }
  async function close() { await click(manager + " .modal-close-button"); }
  async function refresh() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function noOriginalChanges() { assert.deepEqual(await readFile(originalPath), originalBytes); }
  async function automaticUnchanged() { assert.deepEqual(await readFile(automaticPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; }), automatic); }
  await mkdir(join(directory, "Workspace import"), { recursive: true }); await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(notePath, bytes); await writeFile(originalPath, originalBytes); await refresh();
  if (!await evaluate('app.core.isEnabled("workspaces")')) { await evaluate('app.core.setEnabled("workspaces",true)'); }
  await evaluate(`app.openFile(${JSON.stringify(note)})`); await evaluate('app.markdownView.setMode("source")');
  const beforeLayout = await evaluate("app.workspace.getLayout()");
  await importReview(); await chooseSource("Broken");
  assert.equal(await evaluate(`document.querySelector('${importing} [data-workspace-transfer-apply]').disabled`), true);
  await chooseSource("Imported");
  const text = await evaluate(`document.querySelector('${importing} [data-workspace-transfer-preview]').textContent`);
  assert.match(text, /4 panes/); assert.doesNotMatch(text, /Live Preview opens in Source/); assert.match(text, /Floating windows/); assert.match(text, /Stacked tabs/);
  await capture?.(); await back(importing); await close();
  assert.match(await evaluate(`${named}.importOriginal("Imported","Imported").then(()=>"unexpected success",error=>error.message)`), /fresh workspace/);
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), beforeLayout); await noOriginalChanges();
  await importReview(); await chooseSource("Imported"); await click(importing + " [data-workspace-transfer-apply]"); await settled();
  assert.deepEqual((await local()).workspaces.Imported.obsidianImport.layout, profile);
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), beforeLayout, "importing a saved profile never changes active panes");
  await close(); await noOriginalChanges(); await automaticUnchanged(); assert.deepEqual(await readFile(notePath), bytes);
  await importReview(); await chooseSource("  Padded λ  "); await fill(importing + " [data-workspace-target]", "__proto__");
  await click(importing + " [data-workspace-transfer-apply]"); await settled(); await close();
  assert.equal(Object.hasOwn((await local()).workspaces, "__proto__"), true);
  assert.equal((await local()).workspaces.__proto__.obsidianImport.name, "  Padded λ  ");
  await noOriginalChanges();
  pass("Actual import controls preview compatible panes and unsupported preferences, refuse malformed layouts, cancel safely, and copy the exact original profile without changing active panes, original profiles, automatic layout or BOM/CRLF notes.");

  await importReview(); await chooseSource("Imported");
  assert.match(await evaluate(`${named}.importOriginal("Imported","Imported").then(()=>"unexpected success",error=>error.message)`), /already exists/);
  const beforeConflictLocal = await readFile(localPath);
  await writeFile(originalPath, Buffer.from("\ufeff" + JSON.stringify({ ...original, concurrent: "external writer" })));
  assert.match(await evaluate(`${named}.importOriginal("Imported","Different name").then(()=>"unexpected success",error=>error.message)`), /changed on disk/);
  assert.deepEqual(await readFile(localPath), beforeConflictLocal);
  await writeFile(originalPath, originalBytes); await back(importing); await close();
  await importReview(); await chooseSource("Imported"); await click(importing + " [data-workspace-transfer-overwrite]");
  await click(importing + " [data-workspace-transfer-apply]"); await settled(); await close();
  assert.deepEqual((await local()).workspaces.Imported.obsidianImport.layout, profile); await noOriginalChanges();
  await open(); await click('[data-named-workspace="Imported"] [data-named-workspace-action="load"]'); await settled(); await close();
  assert.equal(await evaluate('app.workspace.activeLeaf.id'), "import-source");
  assert.equal(await evaluate('app.workspace.getLeafById("import-source").pinned'), true);
  assert.equal(await evaluate('app.workspace.getLeafById("import-source").view.getMode()'), "source");
  assert.equal(await evaluate('app.workspace.getLeafById("import-source").view.getEditingMode()'), "live-preview");
  assert.equal(await evaluate('app.workspace.getLeafById("import-reading").view.getMode()'), "preview");
  assert.equal(await evaluate('app.workspace.getLeafById("import-future").isDeferred&&app.workspace.getLeafById("import-side").isDeferred'), true);
  assert.deepEqual(await evaluate('app.workspace.getLeafById("import-future").getViewState().state'), profile.main.children[0].children[1].state.state);
  assert.equal(await evaluate('app.workspace.leftSplit.width===280&&app.workspace.rightSplit.width===315&&app.workspace.rightSplit.collapsed'), true);
  await evaluate('window.importPreviousLeaf=app.workspace.activeLeaf;window.importPreviousRoot=app.workspace.rootSplit;app.editor.setValue(app.editor.getValue()+"Unsaved draft\\r\\n");true');
  await writeFile(notePath, Buffer.from("\ufeff# External writer\r\n"));
  assert.match(await evaluate(`${named}.load("Imported").then(()=>"unexpected success",error=>error.message)`), /changed on disk/);
  assert.equal(await evaluate('app.workspace.activeLeaf===importPreviousLeaf&&app.workspace.rootSplit===importPreviousRoot&&app.dirty&&app.editor.getValue().includes("Unsaved draft")'), true);
  assert.equal(await readFile(notePath, "utf8"), "\ufeff# External writer\r\n");
  await writeFile(notePath, bytes); await evaluate('app.workspace.reloadCurrent(true)'); await noOriginalChanges();
  pass("Imported layouts open real Source/Reading split panes with pins and sidebar state; unknown main/sidebar views retain opaque data. Name collisions, stale source reviews and dirty-save conflicts preserve the previous layout and external bytes.");

  await evaluate('app.workspace.getLeafById("import-source").view.setMode("preview");app.workspace.getLeafById("import-source").pinned=false;app.workspace.rightSplit.setWidth(350);app.workspace.rightSplit.expand()');
  await open(); await fill("[data-workspace-name]", "Imported"); await click("[data-workspace-overwrite]"); await click('[data-named-workspace-action="save"]');
  await wait(`!${named}.busy&&!document.querySelector('${manager} .modal-content').inert`, "saved modified imported layout"); await close();
  await exportReview(); await fill(exporting + " [data-workspace-target]", "Round-trip λ"); await click(exporting + " [data-workspace-transfer-apply]"); await settled(); await close();
  let output = await stored(), exported = output.workspaces["Round-trip λ"];
  assert.deepEqual(output.futureConfiguration, original.futureConfiguration); assert.equal(output.active, "Other");
  for (const name of Object.keys(original.workspaces)) { assert.deepEqual(output.workspaces[name], original.workspaces[name]); }
  assert.equal(exported.main.children[0].children[0].state.state.mode, "preview"); assert.equal(exported.main.children[0].children[0].pinned, false);
  assert.equal(exported.right.width, 350); assert.equal(exported.right.collapsed, false);
  assert.deepEqual(exported.futureProfile, profile.futureProfile); assert.deepEqual(exported.floating, profile.floating); assert.deepEqual(exported["left-ribbon"], profile["left-ribbon"]);
  assert.equal(exported.main.children[0].dimension, 65); assert.equal(exported.main.children[0].stacked, true); assert.equal(exported.main.children[0].children[0].state.state.source, false);
  assert.deepEqual(exported.main.children[0].children[1], profile.main.children[0].children[1]);
  assert.deepEqual((await readFile(originalPath)).subarray(0, 3), Buffer.from([239, 187, 191])); originalBytes = await readFile(originalPath);
  await exportReview();
  assert.match(await evaluate(`${named}.exportOriginal("Imported").then(()=>"unexpected success",error=>error.message)`), /already exists/);
  const localBytes = await readFile(localPath);
  await writeFile(localPath, JSON.stringify({ ...await local(), externallyChanged: true }));
  assert.match(await evaluate(`${named}.exportOriginal("Stale local").then(()=>"unexpected success",error=>error.message)`), /Saved workspaces changed/);
  await noOriginalChanges(); await writeFile(localPath, localBytes); await back(exporting); await close();
  await exportReview();
  output = await stored(); await writeFile(originalPath, Buffer.from("\ufeff" + JSON.stringify({ ...output, concurrent: "external export writer" })));
  const concurrentBytes = await readFile(originalPath);
  assert.match(await evaluate(`${named}.exportOriginal("Imported",true).then(()=>"unexpected success",error=>error.message)`), /changed on disk/);
  assert.deepEqual(await readFile(originalPath), concurrentBytes); await back(exporting); await close();
  await writeFile(originalPath, originalBytes);
  await exportReview(); await click(exporting + " [data-workspace-transfer-overwrite]"); await click(exporting + " [data-workspace-transfer-apply]"); await settled(); await close();
  output = await stored(); assert.equal(output.workspaces.Imported.main.children[0].children[0].state.state.mode, "preview");
  assert.equal(output.workspaces.Imported.right.width, 350); assert.deepEqual(output.workspaces.Imported.futureProfile, profile.futureProfile);
  assert.deepEqual(output.workspaces.Other, original.workspaces.Other); assert.deepEqual(output.workspaces.Broken, original.workspaces.Broken); assert.equal(output.active, "Other");
  originalBytes = await readFile(originalPath); await automaticUnchanged(); assert.deepEqual(await readFile(notePath), bytes);
  pass("Actual export controls write original-shaped named profiles and explicitly replace an existing name, while preserving BOM, unknown fields, other profiles, active selection, ribbon/floating/stacked/group data. Concurrent source or destination changes reject without overwriting either file.");

  await importReview(); await chooseSource("Imported"); await back(importing); await close();
  await evaluate('app.core.setEnabled("workspaces",false)');
  assert.equal(await evaluate('app.commands.status().some(command=>command.id.startsWith("workspaces:"))||Boolean(document.querySelector(\'[data-core-ribbon="workspaces"]\'))'), false);
  assert.match(await evaluate('app.core.getPluginById("workspaces").instance.importOriginal("Imported","Disabled").then(()=>"unexpected success",error=>error.message)'), /current workspace operation|Enable Workspaces/);
  await evaluate('app.core.setEnabled("workspaces",true)'); await noOriginalChanges();
  await evaluate("app.workspace.flushLayout()"); if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload();
  assert.equal(await evaluate(`${named}.active`), "Imported"); assert.ok((await evaluate(`${named}.names`)).includes("Imported"));
  assert.equal(await evaluate('app.workspace.getLeafById("import-source").view.getMode()==="preview"&&!app.workspace.getLeafById("import-source").pinned&&app.workspace.getLeafById("import-future").isDeferred'), true);
  assert.equal(await evaluate('app.workspace.rightSplit.width'), 350);
  assert.deepEqual((await local()).workspaces.Imported.obsidianImport.layout, profile);
  await importReview(); await chooseSource("Imported"); assert.equal(await evaluate(`document.querySelector('${importing} [data-workspace-transfer-apply]').disabled`), false);
  await back(importing); await close(); await noOriginalChanges(); await automaticUnchanged(); assert.deepEqual(await readFile(notePath), bytes);
  pass("Disable/re-enable removes owned controls and rejects retained actions; imported provenance, active Source/Reading layout, unavailable views and exported original profiles survive a full desktop restart or permissioned browser reconnect.");
}
