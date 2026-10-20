import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const folder = "Plugin workflow fixtures";
const linterText = "# Linter workflow  \r\n\r\nKeep this text.  \r\n";
const linterFormatted = "# Linter workflow\r\n\r\nKeep this text.\r\n";
const extractedText = "Extracted note\r\nBody to extract.";
const refactorText = `# Refactor source\r\n\r\nBefore.\r\n\r\n${extractedText}\r\n\r\nAfter.\r\n`;
const splitText = "# Split source\n\nKept prefix.\n\nSplit fragment\nMoved body.\n";
const templateText = "# QuickAdd template\n\nCreated by an unchanged Template choice.\n";
const captureText = "# Capture target\n\nKeep this existing entry.\n";
const captureValue = "Accepted compatibility capture";
const pathFor = (directory, path) => join(directory, ...path.split("/"));

export async function prepareAdditionalPluginWorkflows(directory) {
  const fixtures = {
    linter: `${folder}/Linter command.md`,
    lintOnSave: `${folder}/Linter save.md`,
    dirtyLintOnSave: `${folder}/Linter dirty save.md`,
    refactor: `${folder}/Refactor source.md`,
    extracted: `${folder}/Refactored/Extracted note.md`,
    split: `${folder}/Split source.md`,
    splitResult: `${folder}/Refactored/Split fragment.md`,
    template: `${folder}/QuickAdd template.md`,
    created: `${folder}/QuickAdd created.md`,
    capture: `${folder}/Capture target.md`,
    lintPreview: `${folder}/Linter preview.md`,
    lintBatch: `${folder}/Lint batch/First.md`,
    lintBatchNested: `${folder}/Lint batch/Nested/Second.md`,
    lintBatchBinary: `${folder}/Lint batch/Untouched.dat`,
    lintOutside: `${folder}/Outside lint batch.md`,
    headings: `${folder}/Heading source.md`,
    headingAlpha: `${folder}/Refactored/Batch alpha.md`,
    headingBeta: `${folder}/Refactored/Batch beta.md`,
    namedSource: `${folder}/Naming source.md`,
    namedResult: `${folder}/Refactored/Named extraction.md`,
    omniTarget: `${folder}/Search/Index target.md`,
    omniOther: `${folder}/Other/Index companion.md`,
    macro: `${folder}/Macro source.md`,
    templaterSource: `${folder}/Templater 226 replace.md`,
    templaterTemplate: `${folder}/Templates/Workflow 226.md`,
    templaterCreated: "Pinned Templater 226 created.md",
    kanbanEditing: `${folder}/Board editing.md`,
    iconFile: `${folder}/Icon workflow.md`,
    iconRenamed: `${folder}/Icon workflow renamed.md`,
  };
  await mkdir(join(directory, folder), { recursive: true });
  for (const [path, text] of [
    [fixtures.linter, "\ufeff" + linterText],
    [fixtures.lintOnSave, "\ufeff" + linterText],
    [fixtures.dirtyLintOnSave, "\ufeff" + linterText],
    [fixtures.refactor, refactorText],
    [fixtures.split, splitText],
    [fixtures.template, templateText],
    [fixtures.capture, captureText],
    [fixtures.lintPreview, "\ufeff" + linterText],
    [fixtures.lintBatch, "\ufeff# First  \r\n\r\nTrim this batch note.  \r\n"],
    [fixtures.lintBatchNested, "# Second  \n\nTrim this nested note.  \n"],
    [fixtures.lintBatchBinary, new Uint8Array([0, 255, 13, 10, 32, 32, 0])],
    [fixtures.lintOutside, "# Outside  \n\nDo not lint this note.  \n"],
    [fixtures.headings, "# Heading source\n\nKeep the introduction.\n\n## Batch alpha\nAlpha body.\n\n## Batch beta\nBeta body.\n"],
    [fixtures.namedSource, "# Naming source\n\nName this selection.\nPreserve its body.\n\nAfter.\n"],
    [fixtures.omniTarget, "---\naliases: [Orchard alias]\n---\n# Index target\n\nFind the CopperOrchardBeacon in this physical note.\n"],
    [fixtures.omniOther, "# Index companion\n\nAnother CopperOrchardBeacon belongs in a different folder.\n"],
    [fixtures.macro, "\ufeff# Macro workflow  \r\n\r\nKeep this macro text.  \r\n"],
    [fixtures.templaterSource, "\ufeff# Pinned Templater 2.26\r\n\r\nTitle: <% tp.file.title %>\r\nValue: <%* tR += ['Safe', 'execution'].join(' '); %>\r\n"],
    [fixtures.templaterTemplate, "# Created by pinned 2.26\n\n<%* await tp.file.rename('Pinned Templater 226 created'); tR += 'Created safely.'; %>\n"],
    [fixtures.kanbanEditing, "---\nkanban-plugin: board\n---\n\n## Editing lane\n\n- [ ] Existing compatibility card\n"],
    [fixtures.iconFile, "# Icon workflow\n\nPreserve this note while changing its icon.\n"],
  ]) {
    await mkdir(dirname(pathFor(directory, path)), { recursive: true });
    await writeFile(pathFor(directory, path), text, { flag: "wx" });
  }
  const settings = {
    "obsidian-linter": { lintOnSave: false, ruleConfigs: { "trailing-spaces": { enabled: true, twoSpaceLineBreak: false } } },
    "note-refactor-obsidian": { newFileLocation: 2, customFolder: `${folder}/Refactored`, openNewNote: false, normalizeHeaderLevels: false },
    omnisearch: { useCache: false, httpApiEnabled: false, showPreviousQueryResults: false },
    "templater-obsidian": { data_version: 2, templates_folder: `${folder}/Templates`, enabled_templates_hotkeys: [], enable_system_commands: false, trigger_on_file_creation: false, enable_startup_templates: false, startup_templates: [], user_scripts_folder: "" },
    quickadd: {
      disableOnlineFeatures: true,
      version: "2.32.1",
      announceUpdates: "none",
      useSelectionAsCaptureValue: false,
      choices: [
        {
          id: "workflow-template", name: "Workflow template", type: "Template", command: true, onePageInput: false,
          templatePath: fixtures.template, fileNameFormat: { enabled: true, format: "QuickAdd created" },
          folder: { enabled: true, folders: [folder], chooseWhenCreatingNote: false, createInSameFolderAsActiveFile: false, chooseFromSubfolders: false },
          appendLink: false, copyLinkToClipboard: false, openFile: true,
          fileOpening: { location: "tab", direction: "vertical", mode: "source", focus: true },
          fileExistsBehavior: { kind: "prompt" },
        },
        {
          id: "workflow-capture", name: "Workflow capture", type: "Capture", command: true, onePageInput: false,
          captureTo: fixtures.capture, captureToActiveFile: false,
          createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
          format: { enabled: true, format: "- {{VALUE}}\n" },
          insertAfter: { enabled: false, after: "", insertAtEnd: true, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "top" },
          insertBefore: { enabled: false, before: "", createIfNotFound: false, createIfNotFoundLocation: "top" },
          newLineCapture: { enabled: false, direction: "below" },
          prepend: true, task: false, appendLink: false, copyLinkToClipboard: false, openFile: false,
          templater: { afterCapture: "none" },
        },
        {
          id: "workflow-macro", name: "Workflow command macro", type: "Macro", command: true, runOnStartup: false,
          macro: {
            id: "workflow-macro-steps", name: "Workflow command macro",
            commands: [
              { id: "workflow-macro-lint", name: "Linter: Lint the current file", type: "Obsidian", commandId: "obsidian-linter:lint-file" },
              { id: "workflow-macro-wait", name: "Wait", type: "Wait", time: 50 },
              { id: "workflow-macro-save", name: "Save current file", type: "Obsidian", commandId: "editor:save-file" },
            ],
          },
        },
      ],
    },
  };
  for (const [id, data] of Object.entries(settings)) {
    await writeFile(join(directory, ".obsidian", "plugins", id, "data.json"), JSON.stringify(data), { flag: "wx" });
  }
  return fixtures;
}

export function createAdditionalPluginWorkflowTools(tools) {
  const { directory, evaluate, press, wait } = tools;
  const physical = path => readFile(pathFor(directory, path), "utf8");
  const open = async path => {
    await evaluate(`(async()=>{
      await app.saveAll();
      const leaf=app.workspace.getLeaf(false);
      await leaf.setViewState({type:"markdown",state:{file:${JSON.stringify(path)},mode:"source",source:true},active:true});
      const cm=leaf.view.editor.cm;
      if(cm.state.field(app.plugins.modules.obsidian.editorEditorField)!==cm)throw new Error("The shared editor field must expose this actual CodeMirror view after opening a document.");
      leaf.view.editor.focus();
    })()`);
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&app.workspace.activeEditor?.getMode()==="source"`, "real source editor for " + path);
  };
  const run = async id => {
    await evaluate(`(()=>{
      if(!app.commands.commands[${JSON.stringify(id)}])throw new Error("The unchanged plugin's actual command is not registered.");
      const state=globalThis.additionalPluginWorkflowCommand={id:${JSON.stringify(id)},settled:false,error:null};
      app.commands.execute(state.id).then(()=>{state.settled=true},error=>{state.error=String(error.stack??error);state.settled=true});
    })()`);
  };
  const completed = async () => {
    await wait("globalThis.additionalPluginWorkflowCommand?.settled", "the actual plugin command's returned promise");
    assert.equal(await evaluate("globalThis.additionalPluginWorkflowCommand.error"), null, "The actual command must complete without rejection.");
  };
  const editorEquals = text => `app.workspace.activeEditor?.editor.getValue()===${JSON.stringify(text)}`;
  const saved = () => wait("!app.workspace.activeEditor.isSaving&&!app.workspace.activeEditor.hasUnsavedChanges", "physical editor save completion");
  const closeModal = async () => {
    if (await evaluate('Boolean(document.querySelector(".modal-container"))')) {
      await press("Escape", "Escape", 27);
      await wait('!document.querySelector(".modal-container")', "owned plugin modal cancellation");
    }
  };
  return { physical, open, run, completed, editorEquals, saved, closeModal };
}

export async function checkAdditionalPluginWorkflows(tools, fixtures, workflow) {
  const { directory, evaluate, command, click, press, wait, capture } = tools;
  const { physical, open, run, completed, editorEquals, saved, closeModal } = createAdditionalPluginWorkflowTools(tools);

  await workflow("Linter real formatting, undo and first Ctrl+S persistence", async () => {
    await open(fixtures.linter);
    assert.equal(await evaluate("app.plugins.getPlugin('obsidian-linter').settings.lintOnSave"), true, "The earlier actual settings toggle must be physically restored.");
    assert.equal(await evaluate("app.workspace.activeEditor.editor.getValue()"), linterText);
    await run("obsidian-linter:lint-file");
    await wait(editorEquals(linterFormatted), "the real Linter rule must remove trailing spaces");
    assert.equal(await physical(fixtures.linter), "\ufeff" + linterText, "Explicit lint must edit the buffer, not silently save.");
    await press("z", "KeyZ", 90, 2);
    await wait(editorEquals(linterText), "real CodeMirror undo of the plugin's diff");
    await press("y", "KeyY", 89, 2);
    await wait(editorEquals(linterFormatted), "real CodeMirror redo of the plugin's diff");
    await press("s", "KeyS", 83, 2);
    await saved();
    assert.equal(await physical(fixtures.linter), "\ufeff" + linterFormatted, "Manual save must preserve BOM and CRLF while persisting the plugin edit.");
    await open(fixtures.lintOnSave);
    assert.equal(await physical(fixtures.lintOnSave), "\ufeff" + linterText);
    await press("s", "KeyS", 83, 2);
    await wait(editorEquals(linterFormatted), "first Ctrl+S must run Linter's real save-command wrapper");
    await saved();
    assert.equal(await physical(fixtures.lintOnSave), "\ufeff" + linterFormatted, "One Ctrl+S must physically persist the formatted result without another save or autosave.");
    assert.equal(await evaluate("app.workspace.activeEditor.hasUnsavedChanges"), false);
    await open(fixtures.dirtyLintOnSave);
    const edited = linterText + "Unsaved addition.  \r\n";
    const editedFormatted = linterFormatted + "Unsaved addition.\r\n";
    await evaluate(`app.workspace.activeEditor.editor.setValue(${JSON.stringify(edited)})`);
    assert.equal(await evaluate("app.workspace.activeEditor.hasUnsavedChanges"), true);
    assert.equal(await physical(fixtures.dirtyLintOnSave), "\ufeff" + linterText);
    await press("s", "KeyS", 83, 2);
    await wait(editorEquals(editedFormatted), "Linter must format the actual unsaved buffer");
    await saved();
    assert.equal(await physical(fixtures.dirtyLintOnSave), "\ufeff" + editedFormatted, "The first save must include both the unsaved addition and the synchronous plugin edit.");
    if (capture) { await capture("linter"); }
    return { command: "obsidian-linter:lint-file", rule: "trailing-spaces", actualUndoRedo: true, firstCtrlSFormattedCleanAndDirtyFiles: true, unsavedAdditionPreserved: true, bomAndCrlfPreserved: true, paths: [fixtures.linter, fixtures.lintOnSave, fixtures.dirtyLintOnSave] };
  });

  await workflow("Note Refactor real selection extraction, cursor split and cancellation", async () => {
    await open(fixtures.refactor);
    await evaluate('app.workspace.activeEditor.editor.setSelection({line:4,ch:0},{line:5,ch:16})');
    assert.equal(await evaluate("app.workspace.activeEditor.editor.getSelection()"), extractedText);
    await run("note-refactor-obsidian:app:extract-selection-first-line");
    const refactored = refactorText.replace(extractedText, "[[Extracted note]]");
    await wait(`(async()=>${editorEquals(refactored)}&&await app.vault.adapter.read(${JSON.stringify(fixtures.extracted)})===${JSON.stringify(extractedText)})()`, "the real extraction must finish the new note and original link");
    await evaluate("app.saveAll()");
    assert.equal(await physical(fixtures.extracted), extractedText);
    assert.equal(await physical(fixtures.refactor), refactored, "Extraction must preserve surrounding source text and CRLF.");
    if (capture) { await capture("refactor"); }
    await open(fixtures.split);
    await evaluate("app.workspace.activeEditor.editor.setCursor({line:4,ch:5})");
    await run("note-refactor-obsidian:app:split-note-first-line");
    const splitExpected = "# Split source\n\nKept prefix.\n\n[[Split fragment]]";
    await wait(editorEquals(splitExpected), "the actual split must replace the cursor line through end of note");
    await evaluate("app.saveAll()");
    assert.equal(await physical(fixtures.splitResult), "Split fragment\nMoved body.");
    assert.equal(await physical(fixtures.split), splitExpected);
    const originalPaths = await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()");
    await evaluate("app.workspace.activeEditor.editor.setSelection({line:2,ch:0},{line:2,ch:12})");
    try {
      await run("note-refactor-obsidian:app:extract-selection-content-only");
      await wait('Boolean(document.querySelector(".modal-container input"))', "Note Refactor's real naming modal");
      await closeModal();
      assert.deepEqual(await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()"), originalPaths);
      assert.equal(await evaluate("app.workspace.activeEditor.editor.getValue()"), splitExpected);
      assert.equal(await physical(fixtures.split), splitExpected, "Cancelling extraction must not replace text or create a note.");
    } finally { await closeModal(); }
    return { extraction: fixtures.extracted, split: fixtures.splitResult, sourceSurroundingsAndCrlfPreserved: true, realNamingModalCancelledWithoutChanges: true };
  });

  await workflow("QuickAdd real Template choice creates and opens a physical note", async () => {
    await open(fixtures.template);
    await run("quickadd:choice:workflow-template");
    await wait(`(async()=>app.workspace.getActiveFile()?.path===${JSON.stringify(fixtures.created)}&&await app.vault.adapter.read(${JSON.stringify(fixtures.created)})===${JSON.stringify(templateText)})()`, "QuickAdd's actual Template choice must create and open the note");
    await completed();
    assert.equal(await physical(fixtures.created), templateText);
    assert.equal(await physical(fixtures.template), templateText, "Creating a note must not change its template.");
    assert.equal(await evaluate("app.workspace.activeEditor.editor.getValue()"), templateText);
    if (capture) { await capture("quickadd-template"); }
    return { command: "quickadd:choice:workflow-template", path: fixtures.created, openedInRealEditor: true, exactPhysicalTemplateContent: true, templateUnchanged: true };
  });

  await workflow("QuickAdd real Capture prompt, bottom insertion and cancellation", async () => {
    await open(fixtures.capture);
    const prompt = ".qaInputPrompt input";
    const begin = async () => {
      await run("quickadd:choice:workflow-capture");
      await wait(`Boolean(document.querySelector(${JSON.stringify(prompt)}))`, "QuickAdd's own input prompt");
      await click(prompt);
    };
    try {
      await begin();
      await command("Input.insertText", { text: captureValue });
      if (capture) { await capture("quickadd-capture"); }
      await press("Enter", "Enter", 13);
      await wait('!document.querySelector(".qaInputPrompt")', "accepted QuickAdd prompt close");
      await completed();
      const expected = captureText + "- " + captureValue + "\n";
      await wait(`(async()=>await app.vault.adapter.read(${JSON.stringify(fixtures.capture)})===${JSON.stringify(expected)})()`, "the unchanged Capture engine must persist the actual prompt input");
      assert.equal(await physical(fixtures.capture), expected, "Capture must insert once at the configured bottom, preserving existing contents.");
      await begin();
      await command("Input.insertText", { text: "Cancelled input must never reach the note" });
      await closeModal();
      await completed();
      assert.equal(await physical(fixtures.capture), expected, "Cancelling must not append the draft or repeat the previous capture.");
      assert.equal(await physical(fixtures.template), templateText);
      const settings = JSON.parse(await readFile(join(directory, ".obsidian", "plugins", "quickadd", "data.json"), "utf8"));
      assert.equal(settings.disableOnlineFeatures, true);
      assert.deepEqual(settings.choices.map(choice => choice.id).sort(), ["workflow-capture", "workflow-macro", "workflow-template"], "Real nested settings edits must preserve all actual choices.");
    } finally { await closeModal(); }
    return { command: "quickadd:choice:workflow-capture", path: fixtures.capture, actualPromptKeyboardSubmission: true, configuredBottomInsertion: true, existingContentPreserved: true, cancellationWithoutNoteMutation: true, offlineProtectionRetained: true };
  });
}
