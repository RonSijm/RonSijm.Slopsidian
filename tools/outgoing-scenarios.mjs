import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pixel } from "./reading-scenarios.mjs";

export async function checkOutgoingLinks({ directory, evaluate, command, click, press, wait, afterReload, report, restart, capture }) {
  const source = "Links source.md";
  const target = "Links/Target note.md";
  let image = "Links/Outgoing image.png";
  const board = "Links/Outgoing board.canvas";
  let imageBytes = pixel(1600, 800);
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const targetText = "---\naliases: [Unlinked alias]\n---\n# Target\n\n## Destination\n\nParagraph ^link-block\n";
  let text = [
    "---", 'related: "[[Links/Target note#Destination]]"', "---",
    "# Outgoing fixture", "",
    "[[Links/Target note#Destination|Alias]]",
    "[Encoded heading](Links/Target%20note.md#Destination)",
    "[[Links/Target note#^link-block]]", "[[Links missing]]",
    "[[../Outside]]", "![[Links attachment.bin]]",
    "[[Links/Outgoing image.png]]", "[Image target](Links/Outgoing%20image.png)",
    "[[Links/Outgoing board.canvas]]",
    "An Unlinked alias is mentioned here.", "`[[Links ignored]]`", "",
  ].join("\n");
  await mkdir(join(directory, "Links"), { recursive: true });
  await writeFile(join(directory, target), targetText);
  await writeFile(join(directory, image), imageBytes);
  const boardBytes = Buffer.from('{"nodes":[],"edges":[],"future":{"keep":[true,42]}}\r\n');
  await writeFile(join(directory, board), boardBytes);
  await writeFile(join(directory, source), text);
  await writeFile(join(directory, "Links attachment.bin"), Buffer.from([0, 255, 129]));
  await evaluate(`(async()=>{await app.saveAll();await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(source)});app.workspace.activeLeaf.view.setMode("source");await app.commands.execute("outgoing-links:open")})()`);
  await wait('document.querySelector(\'[data-sidebar-view="outgoing-link"]\')?.getAttribute("aria-selected")==="true"&&!document.querySelector("#desktop-shell").classList.contains("right-collapsed")', "outgoing links sidebar opened");
  await wait('document.querySelectorAll("[data-outgoing-link]").length===7', "resolved, unresolved, embedded, property and registered attachment targets");
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-outgoing-link]"),row=>[row.dataset.outgoingLink,row.dataset.outgoingDestination])'), [
    ["Links/Target note#Destination", target],
    ["Links/Target note#^link-block", target],
    ["Links missing", ""],
    ["../Outside", ""],
    ["Links attachment.bin", "Links attachment.bin"],
    [image, image],
    [board, board],
  ]);
  assert.equal(await evaluate('document.querySelector(\'[data-outgoing-link="Links/Target note#Destination"] .outgoing-count\').textContent'), "3");
  assert.equal(await evaluate('document.querySelector(\'[data-outgoing-link="../Outside"]\').disabled'), true);
  assert.equal(await evaluate('document.querySelector(\'[data-outgoing-link="Links attachment.bin"]\').disabled'), true);
  assert.match(await evaluate('document.querySelector(\'[data-outgoing-link="Links attachment.bin"]\').title'), /No view is registered/);
  assert.equal(await evaluate('app.internalPlugins.getPluginById("outgoing-link").enabled&&app.internalPlugins.getEnabledPluginById("outgoing-link")===app.internalPlugins.getPluginById("outgoing-link").instance'), true);
  assert.equal(await evaluate('app.internalPlugins.getPluginById("__proto__")'), null);
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("__proto__")'), null);
  for (const id of await evaluate('app.core.states.filter(state=>!state.implemented).map(state=>state.id)')) {
    assert.equal(await evaluate(`app.internalPlugins.getEnabledPluginById(${JSON.stringify(id)})`), null, `Unavailable ${id} must not receive a fake enabled controller`);
  }
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  pass("Outgoing links lists real wiki/Markdown/property links and embeds, deduplicates the same destination/subpath, and explicitly disables unsupported attachment/traversal actions.");

  await click("[data-outgoing-pin]");
  await wait('document.querySelector("[data-outgoing-pin]").getAttribute("aria-pressed")==="true"', "outgoing links pinned to its source");
  await click('[data-outgoing-link="Links/Target note#Destination"]');
  await wait(`app.current?.file.path===${JSON.stringify(target)}&&app.editor.getCursor().line===5`, "outgoing heading navigation");
  assert.equal(await evaluate('document.querySelector("[data-outgoing-source]").dataset.outgoingSource'), source);
  await click('[data-outgoing-link="Links/Target note#^link-block"]');
  await wait(`app.current?.file.path===${JSON.stringify(target)}&&app.editor.getCursor().line===7`, "outgoing block navigation");
  await click('[data-outgoing-link="Links missing"]');
  await wait('app.current?.file.path==="Links missing.md"', "missing outgoing target created and opened");
  assert.equal(await readFile(join(directory, "Links missing.md"), "utf8"), "");
  assert.equal(await readFile(join(directory, target), "utf8"), targetText);
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  pass("Outgoing links navigates to exact heading/block context, creates a missing Markdown target without changing its source, and keeps a pinned sidebar on its note.");

  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(source)});app.workspace.activeLeaf.view.setMode("source");app.editor.focus()})()`);
  await press("End", "End", 35, 2);
  await press("Enter", "Enter", 13);
  await command("Input.insertText", { text: "[[Links live]]" });
  await wait('app.dirty&&document.querySelector(\'[data-outgoing-link="Links live"]\')', "unsaved outgoing link appears");
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  await press("z", "KeyZ", 90, 2);
  await wait('!document.querySelector(\'[data-outgoing-link="Links live"]\')', "undo removes an outgoing link");
  await press("y", "KeyY", 89, 2);
  await wait('document.querySelector(\'[data-outgoing-link="Links live"]\')', "redo restores an outgoing link");
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "edited outgoing source saved");
  text += "\n[[Links live]]";
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  text += "\n[[Links external]]\n";
  await writeFile(join(directory, source), text);
  await wait('document.querySelector(\'[data-outgoing-link="Links external"]\')&&!app.dirty', "external edit updates outgoing links");
  await rename(join(directory, target), join(directory, "Links/Moved target.md"));
  await wait('document.querySelector(\'[data-outgoing-link="Links/Target note#Destination"]\')?.dataset.outgoingDestination===""', "renamed target becomes unresolved without silently rewriting source");
  text = text.replaceAll("Links/Target note", "Links/Moved target").replaceAll("Links/Target%20note", "Links/Moved%20target");
  await writeFile(join(directory, source), text);
  await wait('document.querySelector(\'[data-outgoing-link="Links/Moved target#Destination"]\')?.dataset.outgoingDestination==="Links/Moved target.md"', "updated reference resolves to the renamed target");
  assert.equal(await readFile(join(directory, "Links/Moved target.md"), "utf8"), targetText);
  pass("Dirty-buffer edits, undo/redo, external saves and target renames refresh outgoing resolution without overwriting vault files or secretly rewriting links.");

  await click('[data-outgoing-section="unlinked"] > summary');
  await wait('document.querySelector(\'[data-outgoing-mention="Links/Moved target.md"]\')', "unlinked alias mention appears");
  await click('[data-outgoing-mention="Links/Moved target.md"]');
  await wait('app.editor.getSelection()==="Unlinked alias"', "unlinked mention navigates to exact source text");
  await click('[data-outgoing-section="links"] > summary');
  await wait('!document.querySelector(\'[data-outgoing-section="links"]\').open', "outgoing section collapsed");
  const state = await evaluate('(async()=>{await app.workspace.flushLayout();return app.workspace.getViewOptions("outgoing-link")})()');
  assert.deepEqual(state, { linksCollapsed: true, unlinkedCollapsed: false, pinned: true, file: source });
  await command("Page.reload");
  await afterReload();
  await wait('document.querySelector("[data-outgoing-pin]")&&app.core.isEnabled("outgoing-link")', "outgoing view after actual reload");
  assert.deepEqual(await evaluate('app.workspace.getViewOptions("outgoing-link")'), state);
  assert.equal(await evaluate('document.querySelector(\'[data-outgoing-section="links"]\').open'), false);
  assert.equal(await evaluate('document.querySelector(\'[data-outgoing-section="unlinked"]\').open'), true);
  assert.equal(await evaluate('document.querySelector("[data-outgoing-source]").dataset.outgoingSource'), source);
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  await evaluate('app.openFile("Links missing.md")');
  assert.equal(await evaluate('document.querySelector("[data-outgoing-source]").dataset.outgoingSource'), source);
  await click("[data-outgoing-pin]");
  await wait('document.querySelector("[data-outgoing-source]").dataset.outgoingSource==="Links missing.md"', "unpinned outgoing view follows active file");
  pass("Unlinked aliases navigate to their source; collapse/follow/pin state survives an actual reload and releasing the pin follows the active note.");

  await click("#open-settings");
  await wait('document.querySelector("#settings-dialog").open', "outgoing core settings");
  await click("#core-plugins-tab");
  await click('[data-core-toggle="outgoing-link"]');
  await wait('!app.core.busy&&!app.core.isEnabled("outgoing-link")', "outgoing links disabled");
  assert.equal(await evaluate('document.querySelector("[data-outgoing-source]")'), null);
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("outgoing-link")'), null);
  assert.equal(await evaluate('app.internalPlugins.getPluginById("outgoing-link").enabled'), false);
  assert.equal(await evaluate('app.commands.listCommands().some(command=>command.id.startsWith("outgoing-links:"))'), false);
  await click('[data-core-toggle="outgoing-link"]');
  await wait('!app.core.busy&&app.core.isEnabled("outgoing-link")&&document.querySelector("[data-outgoing-source]")', "outgoing links reenabled");
  assert.equal(await evaluate('document.querySelectorAll(\'[data-sidebar-view="outgoing-link"]\').length'), 1);
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("outgoing-link")!==null'), true);
  await click(".settings-close");
  await wait('!document.querySelector("#settings-dialog").open', "outgoing settings closed");
  pass("Disabling Outgoing links removes its commands, view and enabled-instance lookup; re-enabling creates one fresh view with the persisted state.");
  await evaluate(`app.openFile(${JSON.stringify(source)})`);
  await wait(`document.querySelector("[data-outgoing-source]").dataset.outgoingSource===${JSON.stringify(source)}`, "outgoing view follows the fixture again");
  await click('[data-outgoing-section="links"] > summary');
  await wait('document.querySelector(\'[data-outgoing-section="links"]\').open', "outgoing results visible");
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])";
  const viewer = active + " .image-file-view";
  const canvasWasEnabled = await evaluate('app.core.isEnabled("canvas")');
  async function canvasEnabled(enabled) {
    if (await evaluate('app.core.isEnabled("canvas")') === enabled) { return; }
    await click("#open-settings");
    await wait('document.querySelector("#settings-dialog").open', "attachment provider settings");
    await click("#core-plugins-tab");
    await click('[data-core-toggle="canvas"]');
    await wait(`!app.core.busy&&app.core.isEnabled("canvas")===${enabled}`, "registered Canvas provider changed");
    await click(".settings-close");
    await wait('!document.querySelector("#settings-dialog").open', "provider settings closed");
  }
  async function imageReady(path, width) {
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&document.querySelector('${viewer}')?.dataset.imageStatus==="ready"&&document.querySelector('${viewer} img').naturalWidth===${width}`, "actual decoded image leaf");
  }
  async function openSource(mode = "source") {
    await evaluate(`(async()=>{await app.openFile(${JSON.stringify(source)});app.workspace.activeLeaf.view.setMode(${JSON.stringify(mode)})})()`);
  }
  await canvasEnabled(true);
  await click("[data-outgoing-pin]");
  await wait('document.querySelector("[data-outgoing-pin]").getAttribute("aria-pressed")==="true"', "pin attachment source");
  await evaluate("window.outgoingRevoked=[];window.outgoingRevoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{window.outgoingRevoked.push(url);window.outgoingRevoke(url)}");
  await click(`[data-outgoing-link="${image}"]`);
  await imageReady(image, 1600);
  assert.equal(await evaluate('app.workspace.activeLeaf.view.getViewType()'), "image");
  assert.equal(await evaluate(`Number(document.querySelector('${viewer}').dataset.imageScale)<1`), true, "Fit scales the real pixels to the pane");
  await click(`${viewer} [data-image-action="actual"]`);
  assert.equal(await evaluate(`document.querySelector('${viewer} img').clientWidth`), 1600);
  assert.equal(await evaluate(`document.querySelector('${viewer} .image-stage').scrollWidth>document.querySelector('${viewer} .image-stage').clientWidth`), true);
  await click(`${viewer} [data-image-action="in"]`);
  assert.equal(await evaluate(`document.querySelector('${viewer} img').clientWidth`), 2000);
  assert.equal(await evaluate('app.workspace.activeLeaf.view.getState().imageZoom'), 1.25);
  const originalImageUrl = await evaluate(`document.querySelector('${viewer} img').src`);
  await evaluate(`window.outgoingOldImage=app.workspace.activeLeaf.view;window.outgoingOldFit=document.querySelector('${viewer} [data-image-action="fit"]')`);
  await capture?.();
  const beforeTabs = await evaluate('app.workspace.leaves().length');
  const originalImageLeaf = await evaluate("app.workspace.activeLeaf.id");
  await click(`[data-outgoing-link="${image}"]`, 2);
  await wait(`app.workspace.leaves().length===${beforeTabs + 1}&&app.workspace.activeLeaf.id!==${JSON.stringify(originalImageLeaf)}`, "modified click activates its new image tab");
  await imageReady(image, 1600);
  assert.equal(await evaluate('app.workspace.leaves().length'), beforeTabs + 1, "modified attachment click creates a real tab");
  const imageTab = await evaluate("app.workspace.activeLeaf.id");
  const tabImageUrl = await evaluate(`document.querySelector('${viewer} img').src`);
  await click(`[data-tab-id="${imageTab}"] .workspace-tab-header-inner-close-button`);
  await wait(`!app.workspace.getLeafById(${JSON.stringify(imageTab)})`, "attachment tab closed");
  assert.ok((await evaluate("window.outgoingRevoked")).includes(tabImageUrl));
  await click(`[data-outgoing-link="${board}"]`);
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(board)}&&app.workspace.activeLeaf.view.getViewType()==="canvas"`, "actual Canvas target opened");
  assert.ok((await evaluate("window.outgoingRevoked")).includes(originalImageUrl));
  await evaluate("window.outgoingOldFit.click()");
  assert.equal(await evaluate("window.outgoingOldImage.getState().imageZoom"), 1.25, "unloaded image controls are inert");
  await canvasEnabled(false);
  await wait(`document.querySelector('[data-outgoing-link="${board}"]').disabled`, "provider removal disables only unsupported attachment targets");
  assert.equal(await evaluate(`document.querySelector('[data-outgoing-link="${image}"]').disabled`), false);
  await canvasEnabled(true);
  await wait(`!document.querySelector('[data-outgoing-link="${board}"]').disabled`, "provider registration restores the attachment action");
  assert.deepEqual(await readFile(join(directory, image)), imageBytes);
  assert.deepEqual(await readFile(join(directory, board)), boardBytes);
  await evaluate("URL.revokeObjectURL=window.outgoingRevoke");
  pass("Outgoing opens real decoded raster/Canvas leaves, honors modified-click tabs, follows provider registration/removal and preserves exact attachment bytes; image fit/zoom/scroll work and closed views release URLs and retained controls.");

  await openSource("preview");
  await wait(`Boolean(document.querySelector('${active} .reading-embed-error'))`, "the unsupported embed settles before locating the Reading link");
  const imageLink = active + ' a[data-slopsidian-link="Links/Outgoing image.png"]';
  await evaluate(`window.outgoingReadingClick=false;document.querySelector(${JSON.stringify(imageLink)}).addEventListener("click",event=>{window.outgoingReadingClick=event.isTrusted},{once:true})`);
  await click(imageLink);
  await wait("window.outgoingReadingClick", "actual Reading attachment click delivered");
  await imageReady(image, 1600);
  await click(`${viewer} [data-image-action="actual"]`);
  await click(`${viewer} [data-image-action="in"]`);
  await evaluate('app.workspace.activeLeaf.setViewState({...app.workspace.activeLeaf.getViewState(),state:{...app.workspace.activeLeaf.view.getState(),futureImageState:{keep:[true,42]}}})');
  for (const zoom of [0, 9, null, "wrong"]) {
    assert.match(await evaluate(`(async()=>{try{await app.workspace.activeLeaf.setViewState({type:"image",state:{file:${JSON.stringify(image)},imageZoom:${JSON.stringify(zoom)}}});return "unexpected success"}catch(error){return error.message}})()`), /Image zoom/);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getState().imageZoom'), 1.25);
  }
  let imageUrl = await evaluate(`document.querySelector('${viewer} img').src`);
  imageBytes = pixel(800, 400);
  await writeFile(join(directory, image), imageBytes);
  await evaluate("app.vault.refresh()");
  await imageReady(image, 800);
  assert.notEqual(await evaluate(`document.querySelector('${viewer} img').src`), imageUrl);
  await writeFile(join(directory, image), Buffer.from([0, 255, 17]));
  await evaluate("app.vault.refresh()");
  await wait(`document.querySelector('${viewer}')?.dataset.imageStatus==="error"`, "undecodable image fails visibly without a fake preview");
  assert.match(await evaluate(`document.querySelector('${viewer} [role="status"]').textContent`), /could not decode/);
  assert.deepEqual(await readFile(join(directory, image)), Buffer.from([0, 255, 17]));
  await writeFile(join(directory, image), imageBytes);
  await evaluate("app.vault.refresh()");
  await imageReady(image, 800);
  await evaluate(`app.fileManager.renameFile(app.workspace.getActiveFile(),"Links/Renamed image.png")`);
  image = "Links/Renamed image.png";
  await imageReady(image, 800);
  text = await readFile(join(directory, source), "utf8");
  assert.match(text, /Links\/Renamed image\.png/);
  await wait(`document.querySelector('[data-outgoing-link="${image}"]')?.dataset.outgoingDestination===${JSON.stringify(image)}`, "image rename updates pinned references");
  assert.deepEqual(await readFile(join(directory, image)), imageBytes);
  assert.equal(await evaluate("app.dirty"), false);
  pass("Reading links share registered attachment navigation; live external pixel changes, visible decode errors/recovery and guarded image rename refresh the actual view without writing image bytes or losing opaque state.");

  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  await imageReady(image, 800);
  assert.equal(await evaluate('app.workspace.activeLeaf.view.getState().imageZoom'), 1.25);
  assert.deepEqual(await evaluate('app.workspace.activeLeaf.view.getState().futureImageState'), { keep: [true, 42] });
  assert.equal(await evaluate(`document.querySelector('${viewer} img').clientWidth`), 1000);
  assert.deepEqual(await readFile(join(directory, image)), imageBytes);
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  else { await assert.rejects(readFile(join(directory, ".obsidian", "workspace.json")), { code: "ENOENT" }); }
  await openSource();
  if (!canvasWasEnabled) { await canvasEnabled(false); }
  pass("Actual image leaves, zoom, opaque state and pinned Outgoing restore after full desktop restart/browser reconnect while original workspace absence/bytes, Markdown and exact binary attachments stay preserved.");
  report.coreChecks ??= [];
  assert.equal(report.coreChecks.some(check => check.id === "outgoing-link:targets"), false);
  report.coreChecks.push({ id: "outgoing-link:targets", status: "passed" });
  report.outgoingLinks = {
    implementation: "independent-feature-subset",
    originalModuleLoaded: false,
    attachmentNavigation: "registered file views; bounded built-in raster subset",
    nativeGroupedMainPaneViews: "unavailable",
    automaticReferenceRewriting: "guarded FileManager operations; external OS renames do not rewrite references",
    unlinkedMentionLinking: "unavailable",
    configuredNewNoteLocation: "not-imported; bare missing links create root notes",
  };
}
