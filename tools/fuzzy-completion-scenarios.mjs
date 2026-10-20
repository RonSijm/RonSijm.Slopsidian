import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const q = JSON.stringify, popup = '[data-builtin-suggest="source"]:popover-open';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const bytes = text => Buffer.from("\ufeff" + text);
let modelPromise;
// A read-only eligibility proof uses the actual local model without weakening a
// host guard, loading the reference application or writing a generated module.
async function localModel() {
  modelPromise ??= build({ stdin: { contents: 'export * from "./client/builtin-suggestion-model"; export { parseMarkdown } from "./client/markdown";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false, logLevel: "silent" }).then(result => {
    const module = { exports: {} };
    // Compile only our esbuild output; queries and cached note text stay data.
    new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    return module.exports;
  });
  return modelPromise;
}

/** Existing destinations only; root owns the frozen build and real host runs. */
export async function checkFuzzyCompletion(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const folder = "Fuzzy completion", path = folder + "/Links.md", target = folder + "/Targets/Project Notes.md", literal = folder + "/PrjNt literal.md";
  const original = '---\r\nstatus: Open # keep comment\r\n---\r\n# Fuzzy source Ω\r\n\r\nUntouched 😀 surrounding text.\r\n\r\nLinks: \r\n';
  const known = '---\r\naliases: [Planning journal]\r\nstatus: Project Notes\r\n---\r\n# Design overview\r\n\r\nRelease paragraph **kept**. ^release-id\r\n\r\n# Parent Alpha\r\n## Child Design\r\n## **Child Design**\r\n# Parent Beta\r\n## Child Design\r\n';
  const literalText = "# Literal priority\r\n\r\nThis existing note must outrank a fuzzy note.\r\n", line = original.split("\r\n").indexOf("Links: ");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const configPath = join(directory, ".obsidian", "app.json"), configBytes = await readFile(configPath), options = JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, ""));
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
  await mkdir(join(directory, folder, "Targets"), { recursive: true });
  await writeFile(join(directory, path), bytes(original), { flag: "wx" }); await writeFile(join(directory, target), bytes(known), { flag: "wx" }); await writeFile(join(directory, literal), bytes(literalText), { flag: "wx" });
  const preferences = async format => {
    await writeFile(configPath, JSON.stringify({ ...options, markdownAutosave: false, newLinkFormat: format, useMarkdownLinks: true }, null, 2));
    await evaluate('app.configuration.read("app")');
    assert.equal(await evaluate('app.vault.getConfig("newLinkFormat")'), format);
  };
  const open = async (mode = "source", text = original) => {
    await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});const editor=app.editor;editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(text)},"input.fuzzy-fixture");editor.setCursor(${line},editor.getLine(${line}).length);editor.focus()})()`);
    await command("Page.bringToFront");
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "fuzzy completion editing mode");
  };
  const row = (part = "") => `${popup} [data-builtin-link=${q(target)}]${part}`;
  const note = row(":not([data-builtin-alias]):not([data-builtin-heading]):not([data-builtin-block])"), alias = row('[data-builtin-alias="Planning journal"]');
  const heading = row('[data-builtin-heading="Design overview"]'), hierarchy = row('[data-builtin-heading-path="Parent Beta#Child Design"]'), block = row('[data-builtin-block="release-id"]');
  const global = row('[data-builtin-global-heading="true"][data-builtin-heading="Design overview"]');
  const visible = selector => `(()=>{const row=document.querySelector(${q(selector)});return !!row&&row.checkVisibility()})()`;
  const exact = async text => { assert.equal(await evaluate("app.editor.getValue()"), text); await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(text)); };
  const targetsExact = async () => { assert.deepEqual(await readFile(join(directory, target)), bytes(known)); assert.deepEqual(await readFile(join(directory, literal)), bytes(literalText)); };
  const hold = async (input, selector, mode = "source") => {
    await open(mode); await command("Input.insertText", { text: input }); await wait(visible(selector), "real held fuzzy popup row");
    await evaluate(`(()=>{const provider=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source"),element=document.querySelector(${q(selector)});if(!provider||!element)throw Error("Missing held fuzzy provider");globalThis.fuzzyHeld={provider,element,choice:provider.getSuggestions(provider.context).find(value=>value.path===${q(target)}&&value.kind===${q(selector === alias ? "link" : selector === block ? "block" : selector === global ? "global-heading" : "heading")}${selector === alias ? '&&value.alias==="Planning journal"' : ""})}})()`);
    return original.replace(/\r\n$/, input + "\r\n");
  };
  const heldClick = () => evaluate("(()=>{const held=globalThis.fuzzyHeld;if(!held?.choice)throw Error('Missing held fuzzy choice');held.element.click();held.provider.selectSuggestion(held.choice);delete globalThis.fuzzyHeld})()");
  const narrowGeometry = `(()=>{const cm=app.editor?.cm;if(!cm)return{visible:false,missingEditor:true};const rect=element=>{const r=element.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},editor=rect(cm.dom),scroll=rect(cm.scrollDOM),caret=cm.coordsAtPos(cm.state.selection.main.head);let left=Math.max(0,editor.left,scroll.left),right=Math.min(innerWidth,editor.right,scroll.right),top=Math.max(0,editor.top,scroll.top),bottom=Math.min(innerHeight,editor.bottom,scroll.bottom);for(let node=cm.dom.parentElement;node;node=node.parentElement){const style=getComputedStyle(node),box=node.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right)}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom)}}return{visible:cm.hasFocus&&editor.width>0&&editor.height>0&&right>left&&bottom>top&&!!caret&&caret.bottom>caret.top&&caret.left>=left-1&&caret.right<=right+1&&caret.top>=top-1&&caret.bottom<=bottom+1,viewport:{width:innerWidth,height:innerHeight},editor,scroll,clip:{left,right,top,bottom},caret,sidebars:{leftCollapsed:app.workspace.leftSplit.collapsed,rightCollapsed:app.workspace.rightSplit.collapsed}}})()`;
  let metrics = false, narrowSidebars = null;
  const restoreSidebars = async () => {
    if (!narrowSidebars) return;
    for (const side of ["left", "right"]) {
      if (await evaluate(`app.workspace.${side}Split.collapsed`) !== narrowSidebars[side]) await click(`button[aria-label="Toggle ${side} sidebar"]`);
      await wait(`app.workspace.${side}Split.collapsed===${narrowSidebars[side]}`, "original " + side + " sidebar restored after narrow fuzzy check");
    }
    narrowSidebars = null;
  };
  try {
    await preferences("shortest"); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Design overview")`, "existing fuzzy target metadata");
    const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`);
    assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${q(linktext)},${q(path)})===app.vault.getFileByPath(${q(target)})`), true);
    for (const mode of ["source", "live-preview"]) {
      for (const [input, selector, token] of [
        ["[[PrjNt", note, "[[" + linktext + "]]"],
        ["[[PlnJrn", alias, "[[" + linktext + "|Planning journal]]"],
        ["[[" + linktext + "#DsgOvr", heading, "[[" + linktext + "#Design overview]]"],
        ["[[" + linktext + "#Parent Beta#ChldDsg", hierarchy, "[[" + linktext + "#Parent Beta#Child Design]]"],
        ["[[" + linktext + "#^rlsid", block, "[[" + linktext + "#^release-id]]"],
        ["[[##DsgOvr", global, "[[" + linktext + "#Design overview]]"],
      ]) {
        await open(mode); await command("Input.insertText", { text: input }); await wait(visible(selector), "actual abbreviated known-destination popup");
        const typed = original.replace(/\r\n$/, input + "\r\n"), completed = original.replace(/\r\n$/, token + "\r\n");
        assert.equal(await evaluate("app.editor.getValue()"), typed);
        if (selector === note) {
          const order = await evaluate(`Array.from(document.querySelectorAll(${q(popup + " .suggestion-item")})).map(value=>({path:value.dataset.builtinLink,alias:value.dataset.builtinAlias??null}))`);
          assert.ok(order.findIndex(value => value.path === literal) < order.findIndex(value => value.path === target && value.alias === null), "literal prefix universally outranks fuzzy note");
          if (mode === "source") await capture?.("fuzzy-known-note-popup");
        }
        assert.ok(await evaluate(`document.querySelectorAll(${q(popup + " .suggestion-item")}).length<=40`));
        if (selector === hierarchy) assert.equal(await evaluate(`document.querySelectorAll(${q(selector)}).length`), 1, "only the first addressable child in the exact parent subtree");
        await click(selector); await wait(`app.editor.getValue()===${q(completed)}`, "abbreviation inserts the exact existing canonical destination");
        await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
        await evaluate("app.editor.redo()"); await exact(completed); await targetsExact();
      }
      pass(report, `${mode}: real abbreviated note, alias, heading, exact-parent hierarchy, existing block and global-heading popups retain literal priority, canonical target identity and isolated Undo/Redo with exact BOM/CRLF and unchanged target bytes.`);
    }

    let typed = await hold("[[PlnJrn", alias); await command("Input.insertText", { text: "x" });
    const newer = original.replace(/\r\n$/, "[[PlnJrnx\r\n"); await heldClick(); assert.equal(await evaluate("app.editor.getValue()"), newer);
    typed = await hold("[[PlnJrn", alias);
    await writeFile(join(directory, target), bytes(known.replace("Planning journal", "Removed alias"))); await evaluate("app.metadataCache.refresh()");
    await wait(`!app.metadataCache.getCache(${q(target)})?.frontmatter?.aliases?.includes("Planning journal")`, "actual fuzzy alias contributor change observed");
    await heldClick(); assert.equal(await evaluate("app.editor.getValue()"), typed);
    await writeFile(join(directory, target), bytes(known)); await evaluate("app.metadataCache.refresh()");
    await wait(`app.metadataCache.getCache(${q(target)})?.frontmatter?.aliases?.includes("Planning journal")`, "fuzzy alias restored");
    typed = await hold("[[" + linktext + "#DsgOvr", heading);
    await writeFile(join(directory, target), bytes(known.replace("Design overview", "Removed heading"))); await evaluate("app.metadataCache.refresh()");
    await wait(`!app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Design overview")`, "actual fuzzy target heading removal observed");
    await heldClick(); assert.equal(await evaluate("app.editor.getValue()"), typed);
    await writeFile(join(directory, target), bytes(known)); await evaluate("app.metadataCache.refresh()");
    await wait(`app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Design overview")`, "fuzzy heading restored");
    typed = await hold("[[" + linktext + "#^rlsid", block);
    await evaluate("(()=>{const root=app.vault.rootPath;try{app.vault.rootPath=root+'-stale-fuzzy-root';fuzzyHeld.element.click();fuzzyHeld.provider.selectSuggestion(fuzzyHeld.choice)}finally{app.vault.rootPath=root;delete globalThis.fuzzyHeld}})()");
    assert.equal(await evaluate("app.editor.getValue()"), typed);
    typed = await hold("[[" + linktext + "#DsgOvr", heading);
    await evaluate(`(()=>{globalThis.fuzzyOldTarget=app.vault.getFileByPath(${q(target)})})()`);
    await unlink(join(directory, target)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); await wait(`!app.vault.getFileByPath(${q(target)})`, "fuzzy target physically removed");
    await writeFile(join(directory, target), bytes(known)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`!!app.vault.getFileByPath(${q(target)})&&app.vault.getFileByPath(${q(target)})!==fuzzyOldTarget`, "fuzzy target recreated with a different identity");
    await heldClick(); assert.equal(await evaluate("app.editor.getValue()"), typed); await evaluate("delete globalThis.fuzzyOldTarget"); await targetsExact();
    pass(report, "Held fuzzy DOM rows and direct held provider values refuse newer source, observed alias-contributor/heading changes, a changed root and physical target deletion/recreation before changing any source byte.");

    // The Properties surface shares the model but retains its own preference and
    // destination snapshot proofs; ordinary same-key values are still literal.
    const properties = '[data-fuzzy-properties="true"]', field = properties + ' [data-property-key="status"] [data-metadata-input]';
    const propertyRow = value => properties + ` [data-property-key="status"] [data-property-value-choice=${q(value)}]`;
    const fill = async value => { await click(field); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: value }); };
    const cancel = async () => { await click(field); await press("Escape", "Escape", 27); await press("Escape", "Escape", 27); };
    await open("live-preview"); await evaluate('(()=>{app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.fuzzyProperties="true"})()');
    await fill("PrjNt"); await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    assert.equal(await evaluate(`document.querySelectorAll(${q(properties + ' [data-property-value-choice]')}).length`), 0); assert.equal(await evaluate("app.editor.getValue()"), original); await cancel();
    const propertyToken = "[[" + linktext + "]]";
    await fill("[[PrjNt"); await wait(visible(propertyRow(propertyToken)), "Properties shares the known-note fuzzy choice");
    await evaluate(`(()=>{globalThis.fuzzyPropertyHeld=document.querySelector(${q(propertyRow(propertyToken))})})()`);
    await preferences("absolute"); await evaluate("(()=>{fuzzyPropertyHeld.click();delete globalThis.fuzzyPropertyHeld})()");
    await wait(`document.querySelector(${q(properties + ' [data-property-key="status"] .metadata-property-error')})?.textContent.includes("suggestion changed")`, "held Properties fuzzy choice refuses changed destination preference");
    assert.equal(await evaluate("app.editor.getValue()"), original); await cancel(); await preferences("shortest");
    await fill("[[" + linktext + "#DsgOvr"); const propertyHeading = "[[" + linktext + "#Design overview]]";
    await wait(visible(propertyRow(propertyHeading)), "Properties shares fuzzy terminal heading ranking"); await click(propertyRow(propertyHeading));
    const propertyCompleted = original.replace("status: Open #", "status: " + q(propertyHeading) + " #");
    await wait(`app.editor.getValue()===${q(propertyCompleted)}`, "Properties fuzzy heading retains exact YAML bytes");
    await exact(propertyCompleted); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), propertyCompleted); await open("source"); await exact(original); await targetsExact();
    pass(report, "Real Properties known-note and terminal-heading queries share fuzzy ranking; ordinary same-key values remain literal and a held fuzzy Properties choice refuses changed destination preferences with exact YAML bytes and isolated Undo/Redo.");

    narrowSidebars = await evaluate("({left:app.workspace.leftSplit.collapsed,right:app.workspace.rightSplit.collapsed})");
    for (const side of ["left", "right"]) {
      if (!narrowSidebars[side]) await click(`button[aria-label="Toggle ${side} sidebar"]`);
      await wait(`app.workspace.${side}Split.collapsed===true`, "actual " + side + " sidebar collapsed before320px fuzzy check");
    }
    await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: false }); metrics = true;
    await open("source");
    await evaluate("(()=>{const editor=app.editor,cursor=editor.getCursor();editor.scrollIntoView({from:cursor,to:cursor},true);editor.cm.requestMeasure();editor.focus()})()");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    await wait(`(${narrowGeometry}).visible===true`, "Source editor and actual caret visible inside the320px viewport before fuzzy typing");
    report.fuzzyCompletionNarrow = await evaluate(narrowGeometry); assert.equal(report.fuzzyCompletionNarrow.visible, true, JSON.stringify(report.fuzzyCompletionNarrow));
    await command("Input.insertText", { text: "[[PlnJrn" }); await wait(visible(alias), "fuzzy popup at a real 320px viewport");
    const geometry = await evaluate(`(()=>{const panel=document.querySelector(${q(popup)}),r=panel.getBoundingClientRect();return{viewport:innerWidth,left:r.left,right:r.right,width:r.width,rows:[...panel.querySelectorAll(".suggestion-item")].map(item=>{const box=item.getBoundingClientRect();return box.width>0&&box.height>0&&box.left>=r.left&&box.right<=r.right})}})()`);
    assert.equal(geometry.viewport, 320); assert.ok(geometry.width > 0 && geometry.left >= 0 && geometry.right <= 320 && geometry.rows.length && geometry.rows.every(Boolean), JSON.stringify(geometry));
    await capture?.("fuzzy-popup-narrow-320"); await press("Enter", "Enter", 13);
    await wait(`app.editor.getValue()===${q(original.replace(/\r\n$/, "[[" + linktext + "|Planning journal]]\r\n"))}`, "narrow fuzzy popup accepts real Enter");
    await command("Emulation.clearDeviceMetricsOverride"); metrics = false; await restoreSidebars();
    for (const input of ["[[ZzzzzzUncreated", "[[" + linktext + "#ZzzzzzUncreated", "[[" + linktext + "#^zzzzzz-uncreated"]) {
      await open("source"); await command("Input.insertText", { text: input }); await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
      if (input === "[[ZzzzzzUncreated") {
        await wait(`Boolean(document.querySelector(${q(popup + " [data-builtin-create-note]")}))`, "unknown note offers a separate explicit Create note action");
        assert.equal(await evaluate(`document.querySelector(${q(popup + " [data-builtin-create-note]")}).dataset.builtinCreateNote.endsWith("ZzzzzzUncreated.md")`), true);
        await press("Escape", "Escape", 27);
        await wait(`!document.querySelector(${q(popup)})`, "cancelling explicit note creation changes no files");
      } else if (input === "[[" + linktext + "#ZzzzzzUncreated") {
        await wait(`Boolean(document.querySelector(${q(popup + " [data-builtin-unresolved-heading]")}))`, "a missing heading offers an explicit source-only link");
        assert.equal(await evaluate(`document.querySelectorAll(${q(popup + " [data-builtin-create-note], " + popup + " [data-builtin-create-block]")}).length`), 0);
        await press("Escape", "Escape", 27);
        await wait(`!document.querySelector(${q(popup)})`, "cancelling the missing-heading link changes no target");
      } else {
        await wait(`!document.querySelector(${q(popup)})`, "an unmatched block query offers no paragraph or ID to create");
      }
      assert.equal(await evaluate("app.editor.getValue()"), original.replace(/\r\n$/, input + "\r\n"));
    }
    assert.equal(await evaluate(`app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(${q(folder + "/")})).length`), 3);
    pass(report, "At a real320px viewport fuzzy rows remain contained and Enter inserts the known alias; missing notes and headings offer distinct explicit actions whose cancellation changes no file, while an unmatched block query creates no ID.");

    if (afterReload) {
      await open("source"); await command("Input.insertText", { text: "[[##DsgOvr" }); await wait(visible(global), "fuzzy global choice before restart"); await click(global);
      const saved = original.replace(/\r\n$/, "[[" + linktext + "#Design overview]]\r\n"); await exact(saved); await evaluate("app.workspace.flushLayout()");
      if (restart) await restart(); else await command("Page.reload"); await afterReload();
      await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.changingVault`, "saved fuzzy destination after actual restart/reconnection");
      assert.equal(await evaluate("app.editor.getValue()"), saved); assert.deepEqual(await readFile(join(directory, path)), bytes(saved));
      await evaluate(`(()=>{app.editor.setCursor(${line},app.editor.getLine(${line}).length);app.editor.focus()})()`); await command("Input.insertText", { text: " [[PlnJrn" }); await wait(visible(alias), "fresh fuzzy provider after restart/reconnection");
      const typedAfter = await evaluate("app.editor.getValue()"); await click(alias);
      await wait(`app.editor.getValue()===${q(saved.replace(/\r\n$/, " [[" + linktext + "|Planning journal]]\r\n"))}`, "fresh post-restart alias choice uses exact existing target");
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typedAfter); await targetsExact();
      pass(report, "Full native restart/browser reconnection retains the exact saved fuzzy destination and registers a fresh real alias popup whose isolated Undo preserves the typed prefix and every target byte.");
    }
    await open("source"); await exact(original); await targetsExact();
    report.fuzzyCompletion = { sourceAndLivePreview: true, notesAndAliases: true, headingsAndExactAncestors: true, existingBlocksAndGlobalHeadings: true, literalPriority: true, fortyResultLimit: true, canonicalDestinationAndFirstDuplicate: true, isolatedUndoExactBomCrLf: true, observedSourceContributorRootIdentityRefusal: true, directHeldChoiceRefusal: true, propertiesShareRanking: true, propertiesHeldPreferenceRefusal: true, ordinaryYamlValuesStayLiteral: true, narrow320AndRealEnter: true, noNewTargetsOrIds: true, ...(afterReload ? { restart: true } : {}) };
  } catch (error) {
    try { report.fuzzyCompletionFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf?.view?.getEditingMode?.(),source:app.editor?.getValue?.().slice(0,700),rows:[...document.querySelectorAll(${q(popup + ' .suggestion-item')})].map(item=>({text:item.textContent,path:item.dataset.builtinLink,heading:item.dataset.builtinHeading,alias:item.dataset.builtinAlias})),focus:document.activeElement?.outerHTML.slice(0,300),narrow:${narrowGeometry}}))()`); await capture?.("fuzzy-completion-precleanup-failure"); } catch (diagnostic) { report.fuzzyCompletionFailure = { diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    if (metrics) await command("Emulation.clearDeviceMetricsOverride"); await restoreSidebars();
    await evaluate("(()=>{for(const key of ['fuzzyHeld','fuzzyOldTarget','fuzzyPropertyHeld'])delete globalThis[key];document.activeElement?.blur?.()})()");
    await writeFile(join(directory, target), bytes(known));
    await open("source"); await exact(original);
    await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();if(app.core.isEnabled("properties")!==${enabled})await app.core.setEnabled("properties",${enabled});if(app.markdownAutosave.enabled!==${autosave})await app.markdownAutosave.setEnabled(${autosave})})()`);
    await writeFile(configPath, configBytes); await evaluate('app.configuration.read("app")');
    assert.deepEqual(await readFile(configPath), configBytes);
  }
}

/** Root provides real cached notes and audits all original blob/network bytes. */
export async function checkFuzzyCompletionReadOnly({ evaluate, wait, report }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const model = await localModel();
  const cached = await evaluate('(async()=>{const document=await app.vault.readDocument("Project Notes.md");if(typeof document.content!=="string")throw Error("Cached fuzzy target content is missing");await app.metadataCache.refresh();return{path:document.file.path,text:document.content,aliases:app.metadataCache.getCache("Project Notes.md")?.frontmatter?.aliases??[]}})()');
  assert.equal(cached.path, "Project Notes.md"); assert.ok(cached.text.includes("# Design overview"));
  assert.ok(model.linkCompletions("PrjNt", [cached]).some(value => value.path === cached.path), "actual cached inventory has an eligible fuzzy note before host guard refusal");
  assert.ok(model.linkCompletions("PlnJrn", [cached]).some(value => value.path === cached.path && value.alias === "Planning journal"));
  const layout = await evaluate("app.workspace.getLayout()"), before = await evaluate("app.editor.getValue()");
  try {
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")');
    const location = await evaluate(String.raw`(()=>{const lines=app.editor.getValue().split(/\r?\n/),line=lines.findIndex(value=>value==="[[PrjNt");if(line<0)throw Error("Missing cached fuzzy prefix");return{line,ch:lines[line].length}})()`);
    let offset = 0; for (let index = 0; index < location.line; index++) offset = before.indexOf("\n", offset) + 1; offset += location.ch;
    assert.equal(model.builtinCompletionTrigger(before, offset)?.query, "PrjNt", "the actual cached source has a valid fuzzy trigger independently of writability");
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.setCursor(${location.line},${location.ch});app.editor.focus()})()`);
      const refused = await evaluate(`(()=>{const provider=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source"),editor=app.editor,file=app.workspace.getActiveFile(),cursor=editor.getCursor();if(!provider)throw Error("Missing read-only fuzzy provider");return{trigger:provider.onTrigger(cursor,editor,file),choices:provider.getSuggestions({editor,file,start:cursor,end:cursor,query:"PrjNt"}).length}})()`);
      assert.deepEqual(refused, { trigger: null, choices: 0 }); await wait(`!document.querySelector(${q(popup)})`, "genuine cached read-only fuzzy popup stays closed");
      assert.equal(await evaluate("app.editor.getValue()"), before);
    }
    report.fuzzyCompletion = { ...(report.fuzzyCompletion ?? {}), readOnlyEligibleCachedTarget: true, readOnlySourceAndLivePreviewRefusal: true, readOnlyDirectEnumerationRefusal: true, readOnlyExactSource: true };
    pass(report, "Genuine cache-only Source and Live Preview refuse fuzzy triggering and direct enumeration for an actual valid prefix and independently proven eligible cached note/alias, preserving every source byte without relaxing a write guard.");
  } finally {
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)})})()`);
  }
}
