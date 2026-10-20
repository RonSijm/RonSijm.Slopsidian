import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdditionalPluginWorkflowTools } from "./additional-plugin-workflows.mjs";

export async function checkFurtherPluginWorkflows(tools, fixtures, workflow) {
  const { directory, evaluate, command, click, press, wait, capture, report, restart, openSettings } = tools;
  const { physical, open, run, completed, editorEquals, saved, closeModal } = createAdditionalPluginWorkflowTools(tools);
  const pathFor = path => join(directory, ...path.split("/"));

  await workflow("Omnisearch real indexing, filtered search, result opening and refresh", async () => {
    const target = await physical(fixtures.omniTarget), other = await physical(fixtures.omniOther);
    await wait(`(async()=>globalThis.omnisearch&&
      (await omnisearch.search("CopperOrchardBeacon")).some(result=>result.path===${JSON.stringify(fixtures.omniTarget)}))()`, "the original Omnisearch index must contain the physical fixture");
    const unfiltered = await evaluate('(async()=> (await omnisearch.search("CopperOrchardBeacon")).map(result=>result.path).sort())()');
    assert.deepEqual(unfiltered, [fixtures.omniTarget, fixtures.omniOther].sort());
    await open(fixtures.macro);
    const before = await evaluate("app.workspace.getActiveFile().path");
    try {
      await run("omnisearch:show-modal");
      const input = ".omnisearch-modal input.prompt-input";
      await wait(`Boolean(document.querySelector(${JSON.stringify(input)}))`, "the original Svelte search input");
      await click(input);
      await press("a", "KeyA", 65, 2);
      await command("Input.insertText", { text: "CopperOrchardBeacon path:Search" });
      await wait('document.querySelectorAll(".omnisearch-modal .omnisearch-result").length===1&&document.querySelector(".omnisearch-result__title")?.textContent.includes("Index target")', "the real query must filter to the target folder");
      if (capture) { await capture("omnisearch"); }
      await press("Enter", "Enter", 13);
      await wait(`!document.querySelector(".omnisearch-modal")&&app.workspace.getActiveFile()?.path===${JSON.stringify(fixtures.omniTarget)}`, "the actual selected result must open");
      await wait('app.workspace.activeEditor?.editor.getSelection()==="CopperOrchardBeacon"', "the actual result must select its matching text");
      assert.equal(await physical(fixtures.omniTarget), target);
      await run("omnisearch:show-modal");
      await wait(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
      await click(input);
      await press("a", "KeyA", 65, 2);
      await command("Input.insertText", { text: "NoSuchQuasar826" });
      await wait('document.querySelector(".omnisearch-modal input").value==="NoSuchQuasar826"&&document.querySelectorAll(".omnisearch-modal .omnisearch-result").length===0', "the original no-results query");
      await closeModal();
      assert.equal(await evaluate("app.workspace.getActiveFile().path"), fixtures.omniTarget);
      const updated = target.replace("CopperOrchardBeacon", "SilverOrchardBeacon");
      await writeFile(pathFor(fixtures.omniTarget), updated);
      await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
      await run("omnisearch:show-modal");
      await wait(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
      await click(input);
      await press("a", "KeyA", 65, 2);
      await command("Input.insertText", { text: "SilverOrchardBeacon" });
      await wait('document.querySelectorAll(".omnisearch-modal .omnisearch-result").length===1&&document.querySelector(".omnisearch-result__title")?.textContent.includes("Index target")', "the original modal must refresh the index after a genuine external file change");
      await wait(`(async()=> (await omnisearch.search("SilverOrchardBeacon")).some(result=>result.path===${JSON.stringify(fixtures.omniTarget)}))()`, "public search must observe the original modal's refreshed index");
      await closeModal();
      assert.deepEqual(await evaluate('(async()=> (await omnisearch.search("CopperOrchardBeacon")).map(result=>result.path))()'), [fixtures.omniOther]);
      assert.equal(await physical(fixtures.omniTarget), updated);
      assert.equal(await physical(fixtures.omniOther), other);
      return { from: before, opened: fixtures.omniTarget, actualSvelteKeyboardQuery: true, folderFilter: true, selectedMatch: true, noResultsCancelled: true, externalWriteAndOriginalModalRefresh: true, publicRefreshBoundary: "The supplied public refreshIndex export is unbound and failed in the retained first attempt; the unchanged original modal calls its real indexer with the correct receiver.", originalCompanionPreserved: true, optionalHttpService: restart ? "disabled-by-real-settings" : "unavailable-not-simulated" };
    } finally { await closeModal(); }
  });

  await workflow("Linter real diff preview cancellation and application", async () => {
    const original = await physical(fixtures.lintPreview);
    await open(fixtures.lintPreview);
    const text = await evaluate("app.workspace.activeEditor.editor.getValue()");
    const formatted = text.replace(/ +(?=\r?\n)/g, "");
    const source = `app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===${JSON.stringify(fixtures.lintPreview)}).view`;
    const preview = ".linter-diff-preview-view";
    await run("obsidian-linter:preview-lint-file");
    await wait(`Boolean(document.querySelector(${JSON.stringify(preview + " .linter-diff-removed")}))`, "the original registered preview view must render a diff");
    assert.equal(await evaluate(`${source}.editor.getValue()`), text);
    assert.equal(await physical(fixtures.lintPreview), original, "Previewing must not edit or save the note.");
    await click(preview + " .linter-diff-preview-actions button:not(.mod-cta)");
    await wait(`!document.querySelector(${JSON.stringify(preview + " .mod-cta")})`, "the actual preview Close control");
    assert.equal(await physical(fixtures.lintPreview), original);
    await evaluate(`(()=>{const leaf=app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===${JSON.stringify(fixtures.lintPreview)});app.workspace.setActiveLeaf(leaf,{focus:true});leaf.view.editor.focus()})()`);
    await run("obsidian-linter:preview-lint-file");
    await wait(`Boolean(document.querySelector(${JSON.stringify(preview + " .mod-cta")}))`);
    if (capture) { await capture("linter-preview"); }
    await click(preview + " .mod-cta");
    await wait(`${source}.editor.getValue()===${JSON.stringify(formatted)}`, "the original Apply action must change its captured editor");
    assert.equal(await physical(fixtures.lintPreview), original, "Applying the preview must retain explicit save ownership.");
    await evaluate(`(()=>{const leaf=app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===${JSON.stringify(fixtures.lintPreview)});app.workspace.setActiveLeaf(leaf,{focus:true});leaf.view.editor.focus()})()`);
    await press("s", "KeyS", 83, 2);
    await saved();
    assert.equal(await physical(fixtures.lintPreview), "\ufeff" + formatted);
    await evaluate('app.workspace.detachLeavesOfType("linter-diff-preview")');
    return { path: fixtures.lintPreview, actualRegisteredView: true, closeWithoutMutation: true, actualApplyChangesCapturedEditor: true, explicitPhysicalSave: true, bomAndCrlfPreserved: true };
  });

  await workflow("Linter real confirmed folder batch and cancellation", async () => {
    const first = await physical(fixtures.lintBatch), nested = await physical(fixtures.lintBatchNested), outside = await physical(fixtures.lintOutside);
    const binary = await readFile(pathFor(fixtures.lintBatchBinary));
    await open(fixtures.lintBatch);
    try {
      await run("obsidian-linter:lint-all-files-in-folder");
      await wait('Boolean(document.querySelector(".confirm-modal .mod-cta"))', "the original folder warning");
      await closeModal();
      assert.equal(await physical(fixtures.lintBatch), first);
      assert.equal(await physical(fixtures.lintBatchNested), nested);
      await run("obsidian-linter:lint-all-files-in-folder");
      await wait('Boolean(document.querySelector(".confirm-modal .mod-cta"))');
      if (capture) { await capture("linter-bulk"); }
      await click(".confirm-modal .mod-cta");
      const firstExpected = first.replace(/\r\n/g, "\n").replace(/ +(?=\n)/g, ""), nestedExpected = nested.replace(/ +(?=\n)/g, "");
      await wait(`(async()=> (await app.vault.adapter.read(${JSON.stringify(fixtures.lintBatch)})).replace(/^\\uFEFF/,"")===${JSON.stringify(firstExpected.replace(/^\ufeff/, ""))}&&
        await app.vault.adapter.read(${JSON.stringify(fixtures.lintBatchNested)})===${JSON.stringify(nestedExpected)})()`, "both direct and nested notes must be physically linted");
      assert.equal(await physical(fixtures.lintBatch), firstExpected);
      assert.equal(await physical(fixtures.lintBatchNested), nestedExpected);
      assert.equal(await physical(fixtures.lintOutside), outside);
      assert.deepEqual(await readFile(pathFor(fixtures.lintBatchBinary)), binary, "A Markdown folder batch must not rewrite binary siblings.");
      return { paths: [fixtures.lintBatch, fixtures.lintBatchNested], realConfirmationAndCancellation: true, recursivePhysicalResults: true, outsideNoteAndBinaryPreserved: true, bomPreserved: true, vendorBatchNormalizesLineEndingsToLf: true };
    } finally { await closeModal(); }
  });

  await workflow("Note Refactor real heading batches and accepted custom naming", async () => {
    const original = await physical(fixtures.headings);
    await open(fixtures.headings);
    await run("note-refactor-obsidian:app:split-note-by-heading-h2");
    const alpha = "## Batch alpha\nAlpha body.", beta = "## Batch beta\nBeta body.";
    const expected = original.replace(alpha, "[[Batch alpha]]").replace(beta, "[[Batch beta]]");
    await wait(editorEquals(expected), "both asynchronous heading replacements must finish");
    await evaluate("app.saveAll()");
    assert.equal(await physical(fixtures.headingAlpha), alpha);
    assert.equal(await physical(fixtures.headingBeta), beta);
    assert.equal(await physical(fixtures.headings), expected);
    if (capture) { await capture("refactor-headings"); }
    await open(fixtures.namedSource);
    const namedOriginal = await physical(fixtures.namedSource), selected = "Name this selection.\nPreserve its body.";
    await evaluate("app.workspace.activeEditor.editor.setSelection({line:2,ch:0},{line:3,ch:18})");
    assert.equal(await evaluate("app.workspace.activeEditor.editor.getSelection()"), selected);
    try {
      await run("note-refactor-obsidian:app:extract-selection-content-only");
      const input = ".modal-container input.prompt-input";
      await wait(`Boolean(document.querySelector(${JSON.stringify(input)}))`, "the original naming suggestions");
      await click(input);
      await command("Input.insertText", { text: "Named extraction" });
      await wait('[...document.querySelectorAll(".suggestion-item")].some(item=>item.textContent.includes("Enter to create new file"))', "the plugin's actual new-name candidate");
      await press("Enter", "Enter", 13);
      const replaced = namedOriginal.replace(selected, "[[Named extraction]]");
      await wait(editorEquals(replaced), "accepted custom naming must replace the actual selection");
      await evaluate("app.saveAll()");
      assert.equal(await physical(fixtures.namedResult), selected);
      assert.equal(await physical(fixtures.namedSource), replaced);
      return { headingPaths: [fixtures.headingAlpha, fixtures.headingBeta], originalIntroductionPreserved: true, physicalHeadingLinks: true, actualAcceptedNamingModal: true, namedResult: fixtures.namedResult, surroundingTextPreserved: true };
    } finally { await closeModal(); }
  });

  await workflow("QuickAdd real offline command macro and ordered physical save", async () => {
    await open(fixtures.macro);
    const original = await physical(fixtures.macro), expected = original.replace(/ +(?=\r?\n)/g, "");
    await run("quickadd:choice:workflow-macro");
    await completed();
    await wait(editorEquals(expected.replace(/^\ufeff/, "")), "the macro's actual Linter command");
    await saved();
    assert.equal(await physical(fixtures.macro), expected);
    const settings = JSON.parse(await readFile(join(directory, ".obsidian", "plugins", "quickadd", "data.json"), "utf8"));
    const macro = settings.choices.find(choice => choice.id === "workflow-macro");
    assert.deepEqual(macro.macro.commands.map(step => step.type), ["Obsidian", "Wait", "Obsidian"]);
    assert.equal(macro.runOnStartup, false);
    assert.equal(settings.disableOnlineFeatures, true);
    if (capture) { await capture("quickadd-macro"); }
    return { path: fixtures.macro, command: "quickadd:choice:workflow-macro", actualPluginCommandWaitSaveChain: true, bomAndCrlfPreserved: true, originalSettingsRetained: true, automaticAndOnlineFeaturesDisabled: true };
  });

  const templaterName = "Templater 2.26 real replace, template creation and rename";
  if (!restart) {
    report.additionalPlugins.workflows[templaterName] = { status: "not-run-requires-desktop-node", reason: "Exact 2.26.0 cannot load its util/child_process modules in this standalone browser; no alternative release or fake Node service is substituted." };
  } else {
    await workflow(templaterName, async () => {
      await open(fixtures.templaterSource);
      const expected = "\ufeff# Pinned Templater 2.26\r\n\r\nTitle: Templater 226 replace\r\nValue: Safe execution\r\n";
      const template = await physical(fixtures.templaterTemplate);
      await run("templater-obsidian:replace-in-file-templater");
      await completed();
      assert.equal(await physical(fixtures.templaterSource), expected, "The exact release must execute real expressions and JavaScript while preserving BOM/CRLF.");
      await wait(editorEquals(expected.replace(/^\ufeff/, "")), "the real replaced buffer must follow the guarded physical write");
      try {
        await run("templater-obsidian:create-new-note-from-template");
        await wait('Boolean(document.querySelector(".modal-container input.prompt-input"))', "the exact release's original template picker");
        await wait('[...document.querySelectorAll(".suggestion-item")].some(item=>item.textContent.includes("Workflow 226"))');
        await press("Enter", "Enter", 13);
        await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(fixtures.templaterCreated)}`, "actual template creation and tp.file.rename");
        assert.equal(await physical(fixtures.templaterCreated), "# Created by pinned 2.26\n\nCreated safely.\n");
        assert.equal(await physical(fixtures.templaterTemplate), template);
        await wait('app.plugins.getPlugin("templater-obsidian").templater.files_with_pending_templates.size===0', "the original create operation must finish its post-open cursor/rename work");
        await wait('Boolean(document.querySelector(\'.modal[data-file-dialog="rename"]\'))', "the exact release's default post-creation filename prompt");
        await closeModal();
        assert.equal(await physical(fixtures.templaterCreated), "# Created by pinned 2.26\n\nCreated safely.\n", "Cancelling the post-creation filename prompt must retain the created note.");
        assert.equal(await evaluate('Boolean(app.loadLocalStorage("templater-local-settings")?.enable_system_commands)'), false);
        if (capture) { await capture("templater-226"); }
        return { version: "2.26.0", replaced: fixtures.templaterSource, created: fixtures.templaterCreated, actualExpressionsAndJavaScript: true, actualPicker: true, actualRename: true, postCreationFilenamePromptCancelledWithoutMutation: true, templatePreserved: true, pendingTemplateSetDrained: true, systemCommandsExecuted: false };
      } finally { await closeModal(); }
    });
  }

  await workflow("Iconize real picker, tab icons, persistence, rename and removal", async () => {
    const id = "obsidian-icon-folder", settingsPath = join(directory, ".obsidian", "plugins", id, "data.json");
    const original = await physical(fixtures.iconFile);
    await open(fixtures.iconFile);
    assert.equal(await evaluate("app.workspace.activeEditor.editor.editorComponent===app.workspace.activeLeaf.view"), true);
    const explorerLeaves = await evaluate('app.workspace.getLeavesOfType("file-explorer").length');
    const picker = ".modal-container:has(.iconize-modal)", input = picker + " input.prompt-input";
    const choose = async prefix => {
      await run(id + ":iconize:set-icon-for-file");
      await wait(`Boolean(document.querySelector(${JSON.stringify(input)}))`, "the original Iconize fuzzy picker");
      await click(input);
      await command("Input.insertText", { text: "rocket" });
      await wait(`[...document.querySelectorAll(${JSON.stringify(picker + " .suggestion-item")})].some(row=>row.textContent.includes(${JSON.stringify("(" + prefix + ")")})&&/rocket/i.test(row.textContent))`, "the real loaded icon catalog must supply the requested item");
      await evaluate(`(()=>{
        const row=[...document.querySelectorAll(${JSON.stringify(picker + " .suggestion-item")})].find(row=>row.textContent.includes(${JSON.stringify("(" + prefix + ")")})&&/rocket/i.test(row.textContent));
        if(!row)throw new Error("Missing original icon suggestion.");row.setAttribute("data-next-icon-choice","true");
      })()`);
      await click('[data-next-icon-choice="true"]');
      await wait(`!document.querySelector(${JSON.stringify(picker)})`, "accepting the original icon suggestion");
    };
    const stored = (path, icon) => `(async()=> (await app.plugins.getPlugin(${JSON.stringify(id)}).loadData())[${JSON.stringify(path)}]===${JSON.stringify(icon)})()`;
    const tab = path => `app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===${JSON.stringify(path)}).tabHeaderInnerIconEl`;
    try {
      await click("#open-settings");
      await click("#community-plugins-tab");
      await openSettings(id);
      const toggle = '#plugin-settings-host [role="switch"][aria-label="Toggle icon in tabs"]';
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-checked")`), "false", "The original tab-icon setting must initially be disabled.");
      await click(toggle);
      await wait(`(async()=> (await app.plugins.getPlugin(${JSON.stringify(id)}).loadData()).settings.iconInTabsEnabled===true)()`, "the original setting must persist physically");
      await evaluate('document.querySelector("#settings-dialog").close()');
      await choose("Li");
      await wait(stored(fixtures.iconFile, "LiRocket"), "the actual Lucide choice must reach the physical plugin data");
      await wait(`${tab(fixtures.iconFile)}.getAttribute("title")==="LiRocket"&&Boolean(${tab(fixtures.iconFile)}.querySelector("svg"))`, "the original plugin must render its loaded Lucide SVG in the real tab");
      const lucidePaint = await evaluate(`(() => {
        const svg=${tab(fixtures.iconFile)}.querySelector("svg"), rect=svg.getBoundingClientRect(), geometry=svg.getBBox(), style=getComputedStyle(svg);
        return { visible:svg.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
          width:rect.width,height:rect.height,geometryWidth:geometry.width,geometryHeight:geometry.height,fill:style.fill,stroke:style.stroke,strokeWidth:parseFloat(style.strokeWidth) };
      })()`);
      assert.ok(lucidePaint.visible && lucidePaint.width >= 12 && lucidePaint.height >= 12 && lucidePaint.geometryWidth > 0 && lucidePaint.geometryHeight > 0 &&
        lucidePaint.fill === "none" && !["none", "rgba(0, 0, 0, 0)"].includes(lucidePaint.stroke) && lucidePaint.strokeWidth > 0,
      `The original Iconize removes svg-icon; its standalone Lucide SVG must still be visibly sized and stroked: ${JSON.stringify(lucidePaint)}`);
      if (capture) { await capture("iconize"); }
      const beforeCancel = await readFile(settingsPath, "utf8");
      await run(id + ":iconize:set-icon-for-file");
      await wait(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
      await click(input);
      await command("Input.insertText", { text: "NoSuchIconGalaxy826" });
      await wait(`document.querySelector(${JSON.stringify(input)})?.value==="NoSuchIconGalaxy826"&&document.querySelectorAll(${JSON.stringify(picker + " .suggestion-item")}).length===0`);
      await closeModal();
      assert.equal(await readFile(settingsPath, "utf8"), beforeCancel, "Cancelling the original picker must not overwrite the previous icon or settings.");

      await choose("Emoji");
      const rocket = "\ud83d\ude80";
      await wait(stored(fixtures.iconFile, rocket), "the genuine native-emoji choice must persist");
      await wait(`${tab(fixtures.iconFile)}.textContent===${JSON.stringify(rocket)}&&!${tab(fixtures.iconFile)}.querySelector("img")`, "native emoji rendering must not require Twemoji downloads");
      if (capture) { await capture("iconize-emoji"); }
      await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(fixtures.iconFile)}),${JSON.stringify(fixtures.iconRenamed)})`);
      await wait(stored(fixtures.iconRenamed, rocket), "the original rename subscriber must move its physical icon assignment");
      let data = JSON.parse(await readFile(settingsPath, "utf8"));
      assert.equal(Object.hasOwn(data, fixtures.iconFile), false);
      assert.equal(data.settings.emojiStyle, "native");
      assert.equal(await physical(fixtures.iconRenamed), original);
      assert.equal(await evaluate(`${tab(fixtures.iconRenamed)}.textContent`), rocket);

      await click("#open-settings");
      await click("#community-plugins-tab");
      await click(`[data-toggle-plugin="${id}"]`);
      await wait("!app.plugins.isManaging");
      assert.equal(await evaluate(`app.plugins.getPlugin(${JSON.stringify(id)})===null`), true);
      await click(`[data-toggle-plugin="${id}"]`);
      await wait("!app.plugins.isManaging");
      assert.equal(await evaluate(`app.plugins.getPlugin(${JSON.stringify(id)}).getIconNameFromPath(${JSON.stringify(fixtures.iconRenamed)})`), rocket, "A new genuine plugin instance must read the persisted renamed assignment.");
      await evaluate('document.querySelector("#settings-dialog").close()');
      await evaluate(`app.fileManager.openContextMenu(${JSON.stringify(fixtures.iconRenamed)},new MouseEvent("contextmenu",{clientX:240,clientY:180}))`);
      const remove = '.menu button[data-menu-title="Remove icon"]';
      await wait(`Boolean(document.querySelector(${JSON.stringify(remove)}))`, "the original file-menu removal action");
      await click(remove);
      await wait(`(async()=> !Object.hasOwn(await app.plugins.getPlugin(${JSON.stringify(id)}).loadData(),${JSON.stringify(fixtures.iconRenamed)}))()`, "the original removal handler must delete the physical assignment");
      await wait(`Boolean(${tab(fixtures.iconRenamed)}.querySelector("svg"))&&${tab(fixtures.iconRenamed)}.textContent!==${JSON.stringify(rocket)}`, "the original handler must restore a genuine default file icon");
      data = JSON.parse(await readFile(settingsPath, "utf8"));
      assert.equal(data.settings.iconInTabsEnabled, true);
      assert.equal(data.settings.emojiStyle, "native");
      assert.equal(await physical(fixtures.iconRenamed), original);
      return { path: fixtures.iconRenamed, actualSettingAndFuzzyPicker: true, genuineLucideSvgAndNativeEmoji: true, lucidePaint, pickerCancellationWithoutMutation: true, physicalSettingsAndRename: true, newPluginInstanceReloadedAssignment: true, actualFileManagerMenuRemoval: true, noteBytesPreserved: true, fileExplorerLeaves: explorerLeaves, explorerAndTitleRendering: "not-claimed; genuine native-style file-explorer and inline-title contracts remain separate dependencies", freshTabRestoration: "not-claimed; the supplied plugin wires its layout reapplication through file-explorer leaves" };
    } catch (error) {
      try {
        tools.report.additionalPlugins.iconizeFailureContext = await evaluate(`({
          settingsOpen:document.querySelector("#settings-dialog")?.open,
          visiblePluginPage:document.querySelector("#plugin-settings-host")?.checkVisibility(),
          activeNavigation:document.querySelector("#settings-dialog .settings-navigation .is-active")?.outerHTML,
          panels:[...document.querySelectorAll("#settings-dialog section")].map(node=>({hidden:node.hidden,title:node.querySelector("h2")?.textContent})),
          controls:[...document.querySelectorAll('#plugin-settings-host [role="switch"]')].map(node=>({name:node.getAttribute("aria-label"),visible:node.checkVisibility(),disabled:node.disabled,box:node.getBoundingClientRect().toJSON()}))
        })`);
      } catch (diagnosticError) {
        tools.report.additionalPlugins.iconizeFailureContextError = String(diagnosticError.stack ?? diagnosticError);
      }
      throw error;
    } finally {
      await closeModal();
      await evaluate('document.querySelector("#settings-dialog").close()');
    }
  });
}

export async function checkFurtherKanbanWorkflows(tools, fixtures, workflow) {
  const { evaluate, command, click, press, wait, capture } = tools;
  const { physical } = createAdditionalPluginWorkflowTools(tools);
  await workflow("Kanban real card addition, inline editing, cancellation and deletion", async () => {
    await wait(`app.metadataCache.getCache(${JSON.stringify(fixtures.kanbanEditing)})?.frontmatter?.["kanban-plugin"]==="board"`);
    await evaluate(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(${JSON.stringify(fixtures.kanbanEditing)}))`);
    await wait('app.workspace.activeLeaf.view.getViewType()==="kanban"&&Boolean(document.querySelector(".kanban-plugin__new-item-button"))');
    const ownership = await evaluate('(()=>{const view=app.workspace.activeLeaf.view;return [...app.plugins.getPlugin("obsidian-kanban").stateManagers.values()].filter(manager=>manager.viewSet.has(view)).map(manager=>manager.file.path)})()');
    assert.deepEqual(ownership, [fixtures.kanbanEditing], "The reused real view must belong only to its current board's original state manager.");
    const board = `[data-leaf-id=${JSON.stringify(await evaluate("app.workspace.activeLeaf.id"))}]`;
    const input = board + " .kanban-plugin__item-input .cm-content";
    const contents = board + " .kanban-plugin__item-content-wrapper";
    const focusEditor = async expected => {
      await wait(`document.querySelectorAll(${JSON.stringify(input)}).length===1${expected ? `&&document.querySelector(${JSON.stringify(input)}).textContent===${JSON.stringify(expected)}` : ""}`, "the original inline editor must contain the selected card");
      await evaluate(`(async()=>{document.querySelector(${JSON.stringify(input)}).scrollIntoView({block:"center",inline:"center"});await new Promise(requestAnimationFrame)})()`);
      const focused = `(()=>{const cm=app.workspace.activeEditor?.editor.cm;return cm?.hasFocus&&cm.contentDOM===document.querySelector(${JSON.stringify(input)})&&cm.state.doc.toString()===${JSON.stringify(expected)}})()`;
      if (!await evaluate(focused)) { await click(input); }
      await wait(focused, "the genuine embedded card editor must own keyboard focus");
    };
    const submit = async () => {
      const modifiers = await evaluate('app.plugins.getPlugin("obsidian-kanban").getStateManager(app.workspace.getActiveFile()).getSetting("new-line-trigger")==="enter"?2:0');
      await press("Enter", "Enter", 13, modifiers);
    };
    await wait(`(()=>{const view=app.workspace.activeLeaf.view;return [...document.querySelectorAll(${JSON.stringify(board + " .kanban-plugin__lane-wrapper")})].some(node=>node.dataset.hitboxid===view.leaf.id+":::"+${JSON.stringify(fixtures.kanbanEditing)}+"-"+view.getBoard().children[0].id)&&[...document.querySelectorAll(${JSON.stringify(contents)})].some(node=>node.checkVisibility()&&node.textContent.includes("Existing compatibility card"))})()`, "the current board's own lane and card must be committed before trusted input");
    await evaluate(`(async()=>{document.querySelector(${JSON.stringify(board + " .kanban-plugin__new-item-button")}).scrollIntoView({block:"center",inline:"center"});await new Promise(requestAnimationFrame)})()`);
    await click(board + " .kanban-plugin__new-item-button");
    await focusEditor("");
    assert.equal(await evaluate("(()=>{const cm=app.workspace.activeEditor.editor.cm;return cm.state.field(app.plugins.modules.obsidian.editorEditorField)===cm})()"), true);
    await command("Input.insertText", { text: "Added compatibility card" });
    await submit();
    await wait(`(async()=> (await app.vault.adapter.read(${JSON.stringify(fixtures.kanbanEditing)})).includes("- [ ] Added compatibility card"))()`, "the actual Add card handler must persist its editor content");
    await press("Escape", "Escape", 27);
    await wait(`!document.querySelector(${JSON.stringify(input)})`, "the add-card editor must unmount");
    const openCardMenu = async title => {
      await wait(`[...document.querySelectorAll(${JSON.stringify(contents)})].some(node=>node.checkVisibility()&&node.textContent.includes(${JSON.stringify(title)}))&&!document.querySelector(${JSON.stringify(input)})`, "the actual committed card must finish rendering before its next interaction");
      const point = await evaluate(`(async()=>{
        const content=[...document.querySelectorAll(${JSON.stringify(contents)})].find(node=>node.checkVisibility()&&node.textContent.includes(${JSON.stringify(title)}));if(!content)throw new Error("Missing original card content.");
        content.scrollIntoView({block:"center",inline:"center"});await new Promise(requestAnimationFrame);
        const box=content.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2,hit=document.elementFromPoint(x,y);
        if(!content.contains(hit))throw new Error("The real card context target is obscured by "+hit?.outerHTML.slice(0,300));
        return {x,y};
      })()`);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", clickCount: 1, ...point });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", clickCount: 1, ...point });
      await wait('Boolean(document.querySelector(".plugin-menu,.menu"))', "the original card context menu");
    };
    const choose = async text => {
      await evaluate(`(()=>{const button=[...document.querySelectorAll(".plugin-menu button,.menu button")].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error("Missing real card menu action: "+${JSON.stringify(text)});button.setAttribute("data-next-card-action","true")})()`);
      await click('[data-next-card-action="true"]');
    };
    await openCardMenu("Existing compatibility card");
    await choose("Edit card");
    await focusEditor("Existing compatibility card");
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: "Edited compatibility card" });
    await submit();
    await wait(`!document.querySelector(${JSON.stringify(input)})`, "submitting the inline edit must unmount its editor");
    await wait(`(async()=> (await app.vault.adapter.read(${JSON.stringify(fixtures.kanbanEditing)})).includes("- [ ] Edited compatibility card"))()`, "the actual inline editor update must reach its model and disk");
    const edited = await physical(fixtures.kanbanEditing);
    assert.ok(!edited.includes("Existing compatibility card"));
    await openCardMenu("Edited compatibility card");
    await choose("Edit card");
    await focusEditor("Edited compatibility card");
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: "Cancelled card draft" });
    await wait('app.workspace.activeEditor?.editor.cm.state.doc.toString()==="Cancelled card draft"&&app.workspace.activeEditor.editor.cm.hasFocus', "the cancellable draft must be in the actual focused card editor");
    await wait('app.plugins.modules["@codemirror/autocomplete"].completionStatus(app.workspace.activeEditor.editor.cm.state)===null', "the real completion query must settle before Escape targets card cancellation");
    await press("Escape", "Escape", 27);
    await wait(`!document.querySelector(${JSON.stringify(input)})`, "Escape must unmount the actual card editor");
    assert.equal(await physical(fixtures.kanbanEditing), edited, "Cancelling inline editing must not persist the draft.");
    await openCardMenu("Added compatibility card");
    await choose("Delete card");
    await wait(`(async()=> !(await app.vault.adapter.read(${JSON.stringify(fixtures.kanbanEditing)})).includes("Added compatibility card"))()`, "the actual Delete card action must persist");
    assert.ok((await physical(fixtures.kanbanEditing)).includes("- [ ] Edited compatibility card"));
    if (capture) { await capture("kanban-editing"); }
    return { path: fixtures.kanbanEditing, fileSwitchOwnership: ownership, actualCodeMirrorInput: true, originalAddEditCancelDeleteHandlers: true, exactPhysicalEffects: true, cancelledDraftNotSaved: true, unrelatedCardPreserved: true };
  });
}
