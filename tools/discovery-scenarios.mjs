import { expectErrors } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkDiscovery({ directory, evaluate, command, click, press, wait, afterReload, restart, report }) {
  const ids = ["global-search", "tag-pane", "backlink", "footnotes"];
  const types = ["search", "tag", "backlink", "footnotes"];
  const queryInput = "[data-search-query]";
  const status = "[data-search-status]";
  const source = "Discovery/Source.md";
  const target = "Discovery/Target.md";
  let other = "Discovery/Other.md";
  let otherText = "---\nstatus: paused\nrating: 2\n---\n# Other\n\ndiscoveryneedle beta.\n";
  let text = [
    "---", "status: active", "rating: 5", "tags: [discovery/front]", "---",
    "# Source", "", "DiscoveryNeedle alpha.",
    "[[Target#Destination]] [[Target#^target-block]] [[Target]]",
    "An unlinked Target alias appears here.",
    "#discovery/alpha #discovery/child/leaf",
    "\\#discovery/escaped `#discovery/code` <!-- #discovery/comment -->",
    "One [^alpha] and two [^alpha], plus [^missing].", "",
    "[^alpha]: Definition text", "    continued definition", "",
  ].join("\n");
  await mkdir(join(directory, "Discovery"), { recursive: true });
  await writeFile(join(directory, source), text);
  await writeFile(join(directory, target), "---\naliases: [Target alias]\n---\n# Target\n\n## Destination\n\nParagraph ^target-block\n\n#discovery/alpha [[Target]]\n");
  await writeFile(join(directory, other), otherText);
  await writeFile(join(directory, "Discovery", "Slow.md"), "a".repeat(512) + "!\n");
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate discovery observation: " + id);
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
    await wait('document.querySelector("#settings-dialog").open', "discovery settings");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function closeSettings() {
    await click(".settings-close");
    await wait('!document.querySelector("#settings-dialog").open', "discovery settings closed");
  }
  async function toggle(id, enabled) {
    await settings();
    if (await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`) !== enabled) { await click(`[data-core-toggle="${id}"]`); }
    await wait(`!app.core.busy&&app.core.isEnabled(${JSON.stringify(id)})===${enabled}`, id + " toggled");
  }
  async function show(type) {
    if (type !== "search" && await evaluate("app.workspace.rightSplit.collapsed")) {
      await click('[aria-label="Toggle right sidebar"]');
    }
    await click(`[data-sidebar-view="${type}"]`);
    await wait(`document.querySelector('[data-sidebar-view="${type}"]').getAttribute("aria-selected")==="true"`, type + " shown");
  }
  async function open(path) {
    await evaluate(`(async()=>{await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setMode("source")})()`);
    await wait(`app.current?.file.path===${JSON.stringify(path)}`, "opened " + path);
  }
  const paths = () => evaluate('Array.from(document.querySelectorAll("[data-search-file]"),node=>node.dataset.searchFile).sort()');
  async function results(query, expected) {
    await wait(`document.querySelector("${status}").dataset.searchComplete==="true"&&document.querySelector("${status}").dataset.completedQuery===${JSON.stringify(query)}&&!document.querySelector("${status}").classList.contains("is-error")&&JSON.stringify(Array.from(document.querySelectorAll("[data-search-file]"),node=>node.dataset.searchFile).sort())===${JSON.stringify(JSON.stringify([...expected].sort()))}`, "completed query with exact results: " + query);
  }
  async function search(query, expected) {
    await show("search");
    await fill(queryInput, query);
    await press("Enter", "Enter", 13);
    await results(query, expected);
    assert.deepEqual(await paths(), [...expected].sort());
  }
  async function append(value) {
    await evaluate("app.editor.focus()");
    await wait("app.editor.cm.hasFocus", "the actual Source editor owns keyboard focus");
    await press("End", "End", 35, 2);
    await wait('(()=>{const lines=app.editor.getValue().split("\\n"),from=app.editor.getCursor("from"),to=app.editor.getCursor("to");return from.line===lines.length-1&&to.line===from.line&&from.ch===lines.at(-1).length&&to.ch===from.ch})()', "trusted Ctrl+End reaches the end without a retained selection");
    for (const [index, line] of value.split("\n").entries()) {
      if (index) { await press("Enter", "Enter", 13); }
      if (line) { await command("Input.insertText", { text: line }); }
    }
  }
  async function save() {
    await press("s", "KeyS", 83, 2);
    await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "discovery document saved");
  }
  for (const id of ids) { await toggle(id, true); }
  await closeSettings();
  await evaluate("(async()=>{await app.saveAll();await app.vault.refresh();await app.metadataCache.refresh()})()");
  await open(source);
  await press("F", "KeyF", 70, 2 | 8);
  await wait('document.activeElement===document.querySelector("[data-search-query]")', "Ctrl+Shift+F opens real Search");
  await search("path:Discovery DiscoveryNeedle", [source, other]);
  await click("[data-search-match-case]");
  await results("path:Discovery DiscoveryNeedle", [source]);
  await click(`[data-search-file="${source}"] [data-search-match]`);
  await wait('app.editor.getSelection()==="DiscoveryNeedle"', "search context selects exact raw source");
  await click("[data-search-match-case]");
  await search('path:Discovery (DiscoveryNeedle AND alpha) OR (discoveryneedle AND beta)', [source, other]);
  await search("path:Discovery /DiscoveryN(?:eedle)/", [source, other]);
  await search('file:"Other.md" discoveryneedle', [other]);
  await search("tag:#discovery/front", [source]);
  await search("[status: active] [rating: >=4]", [source]);
  accept("global-search:query");
  pass("Search executes real worker-backed Boolean/regex/path/file/tag/property/case queries and selects exact source context.");

  await evaluate(`(()=>{
    globalThis.slopsidianStartupWorker=window.Worker;
    globalThis.slopsidianStartupDelays=0;
    window.Worker=class extends globalThis.slopsidianStartupWorker{
      constructor(url,options){super(url,options);this.delayStartup=new URL(url,document.baseURI).pathname.endsWith("/js/search-worker.js");}
      set onmessage(callback){
        let first=true;
        super.onmessage=!callback||!this.delayStartup?callback:event=>{
          if(first){first=false;globalThis.slopsidianStartupDelays++;setTimeout(()=>callback.call(this,event),2300);}
          else{callback.call(this,event);}
        };
      }
      get onmessage(){return super.onmessage;}
    };
  })()`);
  try {
    await search('path:Discovery "DiscoveryNeedle alpha."', [source]);
    assert.ok(await evaluate("globalThis.slopsidianStartupDelays>0"), "The real search worker has a delayed startup notification.");
  } finally {
    await evaluate("window.Worker=globalThis.slopsidianStartupWorker;delete globalThis.slopsidianStartupWorker;delete globalThis.slopsidianStartupDelays");
  }
  pass("Search waits for actual worker readiness, including a startup longer than two seconds, without charging it against the separate bounded query deadline.");

  await open(source);
  await append("\nLive discovery token");
  await search('"Live discovery token"', [source]);
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  await evaluate("app.editor.focus()");
  await press("z", "KeyZ", 90, 2);
  await results('"Live discovery token"', []);
  await press("y", "KeyY", 89, 2);
  await results('"Live discovery token"', [source]);
  await save();
  text += "\nLive discovery token";
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  await search('"External discovery token"', []);
  otherText += "\nExternal discovery token\n";
  await writeFile(join(directory, other), otherText);
  await results('"External discovery token"', [other]);
  await rename(join(directory, other), join(directory, "Discovery", "Moved.md"));
  other = "Discovery/Moved.md";
  await results('"External discovery token"', [other]);
  await fill(queryInput, "(");
  await press("Enter", "Enter", 13);
  await wait('document.querySelector("[data-search-status]").dataset.completedQuery==="("&&document.querySelector("[data-search-status]").classList.contains("is-error")', "invalid query visibly fails");
  assert.deepEqual(await paths(), []);
  await fill(queryInput, "path:Discovery/Slow /(a+)+$/");
  await press("Enter", "Enter", 13);
  await wait('document.querySelector("[data-search-status]").dataset.searchComplete==="false"', "bounded regex runs in worker");
  const started = Date.now();
  assert.equal(await evaluate("1+1"), 2);
  assert.ok(Date.now() - started < 1500, "A slow regex must not block the renderer");
  await wait('document.querySelector("[data-search-status]").classList.contains("is-error")&&document.querySelector("[data-search-status]").textContent.includes("two-second limit")', "slow worker terminated with visible error");
  await evaluate('window.slopsidianTestWorker=window.Worker;window.Worker=class{constructor(){throw new Error("Expected worker startup denial")}}');
  try {
    await fill(queryInput, "path:Discovery DiscoveryNeedle");
    await press("Enter", "Enter", 13);
    await wait('document.querySelector("[data-search-status]").classList.contains("is-error")&&document.querySelector("[data-search-status]").textContent.includes("could not start")', "worker startup failure is explicit");
    assert.deepEqual(await paths(), []);
  } finally {
    await evaluate('window.Worker=window.slopsidianTestWorker;delete window.slopsidianTestWorker');
  }
  await search("path:Discovery DiscoveryNeedle", [source, other]);
  accept("global-search:updates");
  pass("Search follows dirty edits/undo/redo, real external writes and renames, rejects invalid queries without stale results, and terminates a blocking regex off the UI thread.");

  await show("tag");
  await wait('document.querySelector(\'[data-tag-count="#discovery/alpha"]\')?.textContent==="2"', "nested inline/property tag counts");
  assert.equal(await evaluate('document.querySelector(\'[data-tag="#discovery/escaped"],[data-tag="#discovery/code"],[data-tag="#discovery/comment"]\')'), null);
  assert.equal(await evaluate('Boolean(document.querySelector(\'[data-tag="#discovery/front"]\'))'), true);
  await click('[data-tag-toggle="#discovery"]');
  assert.equal(await evaluate('document.querySelector(\'[data-tag="#discovery/alpha"]\')'), null);
  await fill('[aria-label="Filter tags"]', "alpha");
  assert.equal(await evaluate('Boolean(document.querySelector(\'[data-tag="#discovery/alpha"]\'))'), true);
  await fill('[aria-label="Filter tags"]', "");
  await click('[data-tag-toggle="#discovery"]');
  await click("[data-tags-hierarchy]");
  await click("[data-tags-sort]");
  await press("Home", "Home", 36);
  await press("ArrowDown", "ArrowDown", 40);
  await press("ArrowDown", "ArrowDown", 40);
  await press("Enter", "Enter", 13);
  await wait('document.querySelector("[data-tags-sort]").value==="alphabetical"', "tag sorting changed through keyboard");
  const ordered = await evaluate('Array.from(document.querySelectorAll("[data-tag]"),node=>node.dataset.tag)');
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a.localeCompare(b)));
  await click('[data-tag="#discovery/alpha"]');
  await results("tag:#discovery/alpha", [source, target]);
  const point = await evaluate('(()=>{const node=document.querySelector(\'[data-tag="#discovery/front"]\');node.scrollIntoView({block:"nearest"});const b=node.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()');
  for (const type of ["mousePressed", "mouseReleased"]) {
    await command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1, modifiers: 2 });
  }
  await results("tag:#discovery/alpha tag:#discovery/front", [source]);
  await toggle("global-search", false);
  await closeSettings();
  await show("tag");
  await expectErrors({ evaluate, report }, [{ source: "notification", message: "Enable Search to open tag results." }], async () => { await click('[data-tag="#discovery/front"]');
  await wait('document.querySelector("#client-errors").textContent.includes("Enable Search")', "disabled Search dependency is explicit"); }, "Check the disabled Search dependency");
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("global-search")'), null);
  await toggle("global-search", true);
  await closeSettings();
  await show("tag");
  await click('[data-tag="#discovery/front"]');
  await results("tag:#discovery/front", [source]);
  await open(source);
  await show("tag");
  await append("\n#discovery/live");
  await wait('document.querySelector(\'[data-tag="#discovery/live"]\')', "unsaved tag appears");
  await press("z", "KeyZ", 90, 2);
  await wait('!document.querySelector(\'[data-tag="#discovery/live"]\')', "tag undo refresh");
  await press("y", "KeyY", 89, 2);
  await wait('document.querySelector(\'[data-tag="#discovery/live"]\')', "tag redo refresh");
  await save();
  text += "\n#discovery/live";
  assert.equal(await readFile(join(directory, source), "utf8"), text);
  accept("tag-pane:nested-tags");
  pass("Tags lists nested inline/property tags with counts, excludes escaped/code/comment text, filters/folds/sorts, and uses the actual Search dependency with a visible disabled-dependency error.");

  await open(target);
  await evaluate('app.commands.execute("backlink:open-backlinks")');
  const linked = () => wait(`document.querySelector('[data-discovery-view="backlink"] [data-discovery-source]')?.dataset.discoverySource===${JSON.stringify(target)}&&document.querySelectorAll('[data-discovery-view="backlink"] [data-backlink-source]').length===3`, "three backlinks excluding the target's self-link");
  await linked();
  await click("[data-backlinks-unlinked]");
  await click(`[data-discovery-view="backlink"] [data-backlink-source="${source}"]`);
  await wait(`app.current?.file.path===${JSON.stringify(source)}&&app.editor.getSelection()==="[[Target#Destination]]"`, "backlink exact heading-reference context");
  await click(`[data-backlink-offset="${text.indexOf("[[Target#^target-block]]")}"]`);
  await wait('app.editor.getSelection()==="[[Target#^target-block]]"', "backlink block-reference source context");
  await click(`[data-backlink-unlinked="${source}"]`);
  await wait('app.editor.getSelection()==="Target alias"', "unlinked alias source context");
  await append("\nAdditional [[Target]]");
  await wait('document.querySelectorAll(\'[data-discovery-view="backlink"] [data-backlink-source]\').length===4', "dirty backlinks refresh");
  await press("z", "KeyZ", 90, 2);
  await linked();
  await press("y", "KeyY", 89, 2);
  await wait('document.querySelectorAll(\'[data-discovery-view="backlink"] [data-backlink-source]\').length===4', "redo backlinks refresh");
  await save();
  text += "\nAdditional [[Target]]";
  text += "\nExternal [[Target]]\n";
  await writeFile(join(directory, source), text);
  await wait('document.querySelectorAll(\'[data-discovery-view="backlink"] [data-backlink-source]\').length===5', "external backlinks refresh");
  await open(target);
  await rename(join(directory, source), join(directory, "Discovery", "Moved source.md"));
  const movedSource = "Discovery/Moved source.md";
  await wait(`document.querySelectorAll('[data-discovery-view="backlink"] [data-backlink-source="${movedSource}"]').length===5`, "backlink source rename refresh");
  await settings();
  await click('[data-core-settings="backlink"]');
  if (!await evaluate('document.querySelector("[data-core-field=backlinkInDocument]").checked')) { await click("[data-core-field=backlinkInDocument]"); }
  await click('[data-core-save="backlink"]');
  await wait('!app.core.busy&&app.core.state("backlink").settings.backlinkInDocument===true', "in-document backlinks saved");
  await closeSettings();
  await wait('document.querySelector(".inline-backlinks [data-backlink-source]")', "real backlinks rendered in document");
  await evaluate('app.commands.execute("backlink:toggle-backlinks-in-document")');
  await wait('!app.core.busy&&!document.querySelector(".inline-backlinks")', "inline backlinks toggle removes owned rendering");
  accept("backlink:references");
  pass("Backlinks resolves heading/block references and unlinked aliases, navigates exact source ranges, follows unsaved/undo/external/rename changes, and renders/removes real in-document backlinks.");

  await open(movedSource);
  await show("footnotes");
  await wait('document.querySelectorAll(\'[data-footnote-reference="alpha"]\').length===2', "multiple footnote references");
  assert.equal(await evaluate('document.querySelector(\'[data-footnote-definition="missing"]\').disabled'), true);
  await click('[data-footnote-definition="alpha"]');
  await wait(`app.editor.getSelection()==="[^alpha]"&&app.editor.getCursor("from").line===${text.split("\n").findIndex(line => line.startsWith("[^alpha]:"))}`, "definition label navigation");
  await click('[data-footnote-reference="alpha"]');
  const referencePrefix = text.slice(0, text.indexOf("[^alpha]")).split("\n");
  await wait(`app.editor.getSelection()==="[^alpha]"&&app.editor.getCursor("from").line===${referencePrefix.length - 1}&&app.editor.getCursor("from").ch===${referencePrefix.at(-1).length}`, "exact first footnote reference navigation, not the identical definition label");
  await append("\n[^added]: Live definition");
  await wait('document.querySelector(\'[data-footnote="added"]\')', "dirty footnote definition appears");
  await press("z", "KeyZ", 90, 2);
  await wait('!document.querySelector(\'[data-footnote="added"]\')', "footnote undo updates view");
  await press("y", "KeyY", 89, 2);
  await wait('document.querySelector(\'[data-footnote="added"]\')', "footnote redo updates view");
  await save();
  text += "\n[^added]: Live definition";
  assert.equal(await readFile(join(directory, movedSource), "utf8"), text);
  text += "\n[^missing]: External definition\n";
  await writeFile(join(directory, movedSource), text);
  await wait('!document.querySelector(\'[data-footnote-definition="missing"]\').disabled', "external definition resolves a missing footnote");
  accept("footnotes:references");
  pass("Footnotes shows multiline definitions, repeated references and explicit missing definitions, selects exact source ranges and updates through dirty edits/undo/redo.");

  await click('[data-discovery-pin="footnotes"]');
  await show("tag");
  await click("[data-tags-hierarchy]");
  await click('[data-tag-toggle="#discovery"]');
  const states = await evaluate('(async()=>{await app.saveAll();await app.workspace.flushLayout();return Object.fromEntries(["search","tag","backlink","footnotes"].map(type=>[type,app.workspace.getViewOptions(type)]))})()');
  await command("Page.reload");
  await afterReload();
  await wait('app.core.isEnabled("footnotes")&&document.querySelector("[data-search-query]")', "discovery views after real reload");
  assert.deepEqual(await evaluate('Object.fromEntries(["search","tag","backlink","footnotes"].map(type=>[type,app.workspace.getViewOptions(type)]))'), states);
  assert.equal(await evaluate('document.querySelector(\'[data-discovery-view="backlink"] [data-discovery-source]\').dataset.discoverySource'), target);
  assert.equal(await evaluate('document.querySelector(\'[data-discovery-view="footnotes"] [data-discovery-source]\').dataset.discoverySource'), movedSource);
  assert.equal(await evaluate('document.querySelector(\'[data-tag-toggle="#discovery"]\').getAttribute("aria-expanded")'), "false");
  for (const [index, id] of ids.entries()) {
    await toggle(id, false);
    assert.equal(await evaluate(`document.querySelector('[data-discovery-view="${types[index]}"]')`), null);
    assert.equal(await evaluate(`app.internalPlugins.getEnabledPluginById(${JSON.stringify(id)})`), null);
    assert.equal(await evaluate(`app.commands.listCommands().some(command=>command.id.startsWith(${JSON.stringify(id + ":")}))`), false);
    await toggle(id, true);
    assert.equal(await evaluate(`document.querySelectorAll('[data-discovery-view="${types[index]}"]').length`), 1);
  }
  await closeSettings();
  pass("Search/Tags/Backlinks/Footnotes preserve real query/sort/fold/pin state across reload/reconnect; disabling removes owned views/controllers/commands and re-enabling creates one fresh instance.");

  const switcherPath = join(directory, ".obsidian", "switcher.json");
  const appPath = join(directory, ".obsidian", "app.json");
  const appText = await readFile(appPath, "utf8").catch(error => {
    if (error.code !== "ENOENT") { throw error; }
    return "{}";
  });
  const appOptions = { ...JSON.parse(appText.replace(/^\ufeff/, "")), showUnsupportedFiles: false, futureSwitcherFixture: { keep: [true, 42] } };
  const switcherOptions = { showExistingOnly: false, showAttachments: true, showAllFileTypes: false, futureSwitcherSetting: { keep: [true, 42] } };
  const board = "Discovery/Switcher board.canvas";
  const binary = "Discovery/Switcher arbitrary.bin";
  const pickerSource = "Discovery/Switcher source.md";
  const picker = 'dialog[data-picker="files"][open]';
  const canvasEnabled = await evaluate('app.core.isEnabled("canvas")');
  await evaluate("app.workspace.saveAll()");
  await writeFile(appPath, JSON.stringify(appOptions) + "\r\n");
  await writeFile(switcherPath, "\ufeff" + JSON.stringify(switcherOptions) + "\r\n");
  await writeFile(join(directory, board), '{"nodes":[],"edges":[]}\r\n');
  await writeFile(join(directory, binary), Buffer.from([0, 255, 17]));
  await writeFile(join(directory, pickerSource), "# Switcher source\n\n[[Switcher future]] [relative](./Switcher%20relative.md)\n");
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await toggle("switcher", false);
  await toggle("switcher", true);
  await toggle("canvas", true);
  await closeSettings();

  async function pickerSettings(values, allTypesVisible) {
    await settings();
    await click('[data-core-settings="switcher"]');
    assert.equal(await evaluate('Boolean(document.querySelector(\'[data-core-field="showAllFileTypes"]\'))'), allTypesVisible);
    for (const [key, value] of Object.entries(values)) {
      if (await evaluate(`document.querySelector('[data-core-field="${key}"]').checked`) !== value) {
        await click(`[data-core-field="${key}"]`);
      }
    }
    await click('[data-core-save="switcher"]');
    await wait(`!app.core.busy&&Object.entries(${JSON.stringify(values)}).every(([key,value])=>app.core.state("switcher").settings[key]===value)`, "Quick switcher options saved");
    await closeSettings();
  }
  async function pickerQuery(query) {
    await press("o", "KeyO", 79, 2);
    await wait(`Boolean(document.querySelector('${picker}'))`, "actual Quick switcher");
    await fill(`${picker} input`, query);
  }
  async function dismissPicker() {
    await press("Escape", "Escape", 27);
    await wait(`!document.querySelector('${picker}')`, "Quick switcher cancelled");
  }
  async function includes(selector, expected) {
    assert.equal(await evaluate(`Boolean(document.querySelector('${picker} ${selector}'))`), expected);
  }

  await pickerSettings({}, false);
  await pickerQuery("Switcher board");
  await includes(`[data-switcher-path="${board}"]`, true);
  await press("Enter", "Enter", 13);
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(board)}&&app.workspace.activeLeaf.view.getViewType()==="canvas"`, "registered Canvas attachment opens from Quick switcher");
  await pickerQuery("Switcher arbitrary");
  await includes(`[data-switcher-path="${binary}"]`, false);
  await dismissPicker();
  await pickerSettings({ showAttachments: false }, false);
  await pickerQuery("Switcher board");
  await includes(`[data-switcher-path="${board}"]`, true);
  await dismissPicker();
  await pickerQuery("Switcher future");
  await includes('[data-switcher-unresolved="Switcher future"]', true);
  await dismissPicker();
  await pickerSettings({ showExistingOnly: true }, false);
  await pickerQuery("Switcher future");
  await includes('[data-switcher-unresolved="Switcher future"]', false);
  await includes('[data-switcher-create="Switcher future"]', true);
  await dismissPicker();
  await assert.rejects(readFile(join(directory, "Switcher future.md")), { code: "ENOENT" });
  pass("Quick switcher settings control actual registered attachments and unresolved references: Canvas documents remain visible with attachments hidden, unknown extensions stay out, and existing-only removes unresolved suggestions without implicitly creating a note.");

  appOptions.showUnsupportedFiles = true;
  const expectedAppText = JSON.stringify(appOptions) + "\r\n";
  await writeFile(appPath, expectedAppText);
  await toggle("switcher", false);
  await toggle("switcher", true);
  await closeSettings();
  await pickerSettings({ showAllFileTypes: true }, true);
  await pickerQuery("Switcher arbitrary");
  await includes(`[data-switcher-path="${binary}"]`, true);
  await dismissPicker();
  await pickerQuery("Switcher board");
  await includes(`[data-switcher-path="${board}"]`, true);
  await dismissPicker();
  await pickerSettings({ showAllFileTypes: false, showAttachments: true, showExistingOnly: false }, true);
  await pickerQuery("Switcher relative");
  await includes('[data-switcher-unresolved="./Switcher%20relative.md"]', true);
  await click(`${picker} [data-switcher-unresolved="./Switcher%20relative.md"]`);
  await wait('app.workspace.getActiveFile()?.path==="Discovery/Switcher relative.md"', "actual URI-decoded source-relative unresolved target");
  assert.equal(await readFile(join(directory, "Discovery", "Switcher relative.md"), "utf8"), "");
  await pickerSettings({ showExistingOnly: true }, true);
  await pickerQuery("Switcher explicit");
  await press("Enter", "Enter", 13, 8);
  await wait('app.workspace.getActiveFile()?.path==="Switcher explicit.md"', "existing-only retains explicit Shift+Enter creation");
  assert.equal(await readFile(join(directory, "Switcher explicit.md"), "utf8"), "");
  await assert.rejects(readFile(join(directory, "Switcher future.md")), { code: "ENOENT" });
  const savedSwitcher = await readFile(switcherPath, "utf8");
  assert.ok(savedSwitcher.startsWith("\ufeff"));
  assert.deepEqual(JSON.parse(savedSwitcher.slice(1)), { ...switcherOptions, showExistingOnly: true });
  assert.equal(await readFile(appPath, "utf8"), expectedAppText);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  await command("Page.reload");
  await afterReload();
  await wait('app.core.isEnabled("switcher")&&app.workspace.layoutReady', "persisted switcher after actual reload/reconnect");
  assert.equal(await evaluate('app.internalPlugins.getEnabledPluginById("switcher").options.showExistingOnly'), true);
  assert.deepEqual(await evaluate('app.core.state("switcher").settings'), { ...switcherOptions, showExistingOnly: true });
  await pickerSettings({}, true);
  assert.equal(await readFile(appPath, "utf8"), expectedAppText);
  assert.deepEqual(JSON.parse((await readFile(switcherPath, "utf8")).replace(/^\ufeff/, "")), { ...switcherOptions, showExistingOnly: true });
  if (!canvasEnabled) { await toggle("canvas", false); await closeSettings(); }
  accept("switcher:settings");
  pass("The unsupported-file toggle follows app.json, all-types overrides attachment filtering, URI-relative targets and explicit creation use real controls, and Boolean/opaque settings plus BOM survive reload/reconnect without rewriting app.json.");

  const firstAliasFile = "Discovery/Alias one.md", secondAliasFile = "Discovery/Alias two.md", renamedAliasFile = "Discovery/Alias renamed.md";
  const originalAliasText = '\ufeff---\r\naliases: ["Shared switcher alias", "First switcher alias", "<switcher literal>"]\r\nfutureAliasFixture: kept\r\n---\r\n# Alias one\r\n';
  const secondAliasText = "---\naliases: [Shared switcher alias, Second switcher alias]\n---\n# Alias two\n";
  await writeFile(join(directory, firstAliasFile), originalAliasText);
  await writeFile(join(directory, secondAliasFile), secondAliasText);
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await pickerQuery("Shared switcher alias");
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${picker} [data-switcher-alias="Shared switcher alias"]'),row=>row.dataset.switcherPath).sort()`), [firstAliasFile, secondAliasFile].sort());
  await click(`${picker} [data-switcher-path="${firstAliasFile}"][data-switcher-alias]`);
  await wait(`app.current?.file.path===${JSON.stringify(firstAliasFile)}`, "alias opens its actual owner instead of creating an alias-named file");
  const previousLeaf = await evaluate("app.workspace.activeLeaf.id");
  await pickerQuery("Second switcher alias");
  await press("Enter", "Enter", 13, 2);
  await wait(`app.current?.file.path===${JSON.stringify(secondAliasFile)}&&app.workspace.activeLeaf.id!==${JSON.stringify(previousLeaf)}`, "Ctrl+Enter alias opens a new real tab");
  await pickerQuery("<switcher literal>");
  assert.equal(await evaluate(`document.querySelector('${picker} [data-switcher-alias] .suggestion-title').textContent`), "<switcher literal>");
  assert.equal(await evaluate(`document.querySelector('${picker} [data-switcher-alias] .suggestion-title').childElementCount`), 0);
  const captureRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), ".runtime", "evidence"), host = report.realExternalDirectoryPicker ? "web" : "desktop";
  async function capture(name, prefix = "link-switcher") {
    await mkdir(captureRoot, { recursive: true });
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(captureRoot, `${prefix}-${name}-${host}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await capture("aliases");
  await dismissPicker();
  await assert.rejects(readFile(join(directory, "Shared switcher alias.md")), { code: "ENOENT" });
  assert.equal(await readFile(join(directory, firstAliasFile), "utf8"), originalAliasText);
  pass("Quick switcher lists separate literal alias results with their real file paths, disambiguates shared aliases, opens owners by pointer and Ctrl+Enter, and never creates an alias-named note.");

  const autosaveEnabled = await evaluate("app.markdownAutosave.enabled");
  if (autosaveEnabled) { await evaluate("app.markdownAutosave.setEnabled(false)"); }
  await open(firstAliasFile);
  const dirtyAliasText = originalAliasText.replace("First switcher alias", "Dirty switcher alias");
  await evaluate("app.editor.focus()");
  await press("a", "KeyA", 65, 2);
  await command("Input.insertText", { text: dirtyAliasText.replace(/^\ufeff/, "") });
  await pickerQuery("Dirty switcher alias");
  await includes(`[data-switcher-alias="Dirty switcher alias"]`, true);
  assert.equal(await readFile(join(directory, firstAliasFile), "utf8"), originalAliasText);
  await dismissPicker();
  await evaluate("app.editor.focus()");
  await press("z", "KeyZ", 90, 2);
  await pickerQuery("First switcher alias");
  await includes('[data-switcher-alias="First switcher alias"]', true);
  await dismissPicker();
  await evaluate("app.editor.focus()");
  await press("y", "KeyY", 89, 2);
  await save();
  assert.equal(await readFile(join(directory, firstAliasFile), "utf8"), dirtyAliasText);
  await pickerQuery("Dirty switcher alias");
  await evaluate(`globalThis.staleAliasRow=document.querySelector('${picker} [data-switcher-alias]');true`);
  const externalAliasText = dirtyAliasText.replace("Dirty switcher alias", "External switcher alias");
  await writeFile(join(directory, firstAliasFile), externalAliasText);
  await wait(`!document.querySelector('${picker} [data-switcher-alias="Dirty switcher alias"]')`, "external metadata refresh removes an obsolete alias from the still-open picker");
  await evaluate("staleAliasRow.click();delete globalThis.staleAliasRow;true");
  assert.equal(await evaluate("app.current.file.path"), firstAliasFile);
  assert.equal(await evaluate(`Boolean(document.querySelector('${picker}'))`), true);
  await dismissPicker();
  await assert.rejects(readFile(join(directory, "Dirty switcher alias.md")), { code: "ENOENT" });
  await open(secondAliasFile);
  await evaluate(`(async()=>{for(const leaf of app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${JSON.stringify(firstAliasFile)})){await leaf.detach();}})()`);
  await pickerQuery("External switcher alias");
  await rename(join(directory, firstAliasFile), join(directory, renamedAliasFile));
  await wait(`Boolean(document.querySelector('${picker} [data-switcher-path="${renamedAliasFile}"][data-switcher-alias="External switcher alias"]'))&&!document.querySelector('${picker} [data-switcher-path="${firstAliasFile}"]')`, "external rename updates alias ownership and its visible file path");
  await click(`${picker} [data-switcher-path="${renamedAliasFile}"][data-switcher-alias]`);
  await wait(`app.current?.file.path===${JSON.stringify(renamedAliasFile)}`, "renamed alias target opens");
  await pickerQuery("External switcher alias");
  await evaluate(`globalThis.disabledAliasRow=document.querySelector('${picker} [data-switcher-alias]');globalThis.disabledAliasInput=document.querySelector('${picker} input');true`);
  await evaluate('app.core.setEnabled("switcher",false)');
  await wait(`!document.querySelector('${picker}')&&!app.core.busy`, "disabling Quick switcher closes its actual modal");
  await evaluate('disabledAliasRow.click();disabledAliasInput.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,bubbles:true}));delete globalThis.disabledAliasRow;delete globalThis.disabledAliasInput;true');
  await assert.rejects(readFile(join(directory, "External switcher alias.md")), { code: "ENOENT" });
  await evaluate('app.core.setEnabled("switcher",true)');
  if (autosaveEnabled) { await evaluate("app.markdownAutosave.setEnabled(true)"); }
  assert.equal(await readFile(join(directory, renamedAliasFile), "utf8"), externalAliasText);
  assert.equal(await readFile(join(directory, secondAliasFile), "utf8"), secondAliasText);
  pass("Dirty alias edits and real undo/redo/save update suggestions without implicit writes; external changes and renames refresh the open picker, while detached rows and disabled controls cannot open or create stale targets.");

  const linkSource = "Discovery/Link source.md", linkTarget = "Discovery/Links/Target note.md", rootTarget = "Root preference.md";
  const linkSourceText = "\ufeff# Link preferences\r\n\r\n";
  await mkdir(join(directory, "Discovery", "Links"), { recursive: true });
  await mkdir(join(directory, "Links"), { recursive: true });
  await writeFile(join(directory, linkSource), linkSourceText);
  await writeFile(join(directory, linkTarget), "# Intended target\n\n## Destination\n");
  await writeFile(join(directory, "Links", "Target note.md"), "# Wrong root-shadow target\n");
  await writeFile(join(directory, rootTarget), "# Intended root target\n");
  await writeFile(join(directory, "Discovery", rootTarget), "# Wrong source-shadow target\n");
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  let preferenceText = "";
  const generated = [];
  async function preferences(format, markdown) {
    preferenceText = "\ufeff" + JSON.stringify({ ...appOptions, newLinkFormat: format, useMarkdownLinks: markdown }, null, 2).replaceAll("\n", "\r\n") + "\r\n";
    await writeFile(appPath, preferenceText);
    await evaluate('app.configuration.read("app")');
    assert.equal(await evaluate('app.vault.getConfig("newLinkFormat")'), format);
    assert.equal(await evaluate('app.vault.getConfig("useMarkdownLinks")'), markdown);
  }
  for (const format of ["shortest", "relative", "absolute"]) {
    for (const markdown of [false, true]) {
      await preferences(format, markdown);
      const actual = await evaluate(`(()=>{const file=app.vault.getFileByPath(${JSON.stringify(linkTarget)});return{stem:app.metadataCache.fileToLinktext(file,${JSON.stringify(linkSource)}),path:app.metadataCache.fileToLinktext(file,${JSON.stringify(linkSource)},false),link:app.fileManager.generateMarkdownLink(file,${JSON.stringify(linkSource)},"#Destination","Visit preferences target")}})()`);
      const stem = format === "shortest" ? "Target note" : format === "relative" ? "./Links/Target note" : "Discovery/Links/Target note";
      assert.equal(actual.stem, stem);
      assert.equal(actual.path, stem + ".md");
      assert.equal(actual.link, markdown ? `[Visit preferences target](${stem.replaceAll(" ", "%20")}.md#Destination)` : `[[${stem}#Destination|Visit preferences target]]`);
      assert.equal(await readFile(appPath, "utf8"), preferenceText);
      generated.push({ format, markdown, ...actual });
    }
  }
  await preferences("absolute", true);
  const rootLink = await evaluate(`app.fileManager.generateMarkdownLink(app.vault.getFileByPath(${JSON.stringify(rootTarget)}),${JSON.stringify(linkSource)},"","Visit preferences root")`);
  assert.equal(rootLink, "[Visit preferences root](/Root%20preference.md)");
  await preferences("relative", true);
  const targetLink = generated.find(entry => entry.format === "relative" && entry.markdown).link;
  await open(linkSource);
  await append(targetLink + "\n\n" + rootLink + "\n");
  await save();
  const savedLinks = await readFile(join(directory, linkSource), "utf8");
  assert.ok(savedLinks.startsWith("\ufeff") && !/(?<!\r)\n/.test(savedLinks));
  assert.ok(savedLinks.includes(targetLink) && savedLinks.includes(rootLink));
  await press("e", "KeyE", 69, 2);
  await wait('app.workspace.activeLeaf.view.getMode()==="preview"', "generated preference links render in real Reading");
  async function markLink(label, id) {
    assert.equal(await evaluate(`(()=>{const link=Array.from(app.workspace.activeLeaf.view.containerEl.querySelectorAll("a")).find(link=>link.textContent===${JSON.stringify(label)});if(!link)return false;link.dataset.preferenceNavigation=${JSON.stringify(id)};return true})()`), true);
  }
  await markLink("Visit preferences target", "target");
  await markLink("Visit preferences root", "root");
  await capture("links");
  await click('[data-preference-navigation="target"]');
  await wait(`app.current?.file.path===${JSON.stringify(linkTarget)}`, "generated relative Markdown link navigates to the intended file despite a root shadow");
  await open(linkSource);
  await press("e", "KeyE", 69, 2);
  await wait('app.workspace.activeLeaf.view.getMode()==="preview"', "root preference link in Reading");
  await markLink("Visit preferences root", "root");
  await click('[data-preference-navigation="root"]');
  await wait(`app.current?.file.path===${JSON.stringify(rootTarget)}`, "generated absolute Markdown link avoids the source-folder shadow");
  assert.equal(await readFile(appPath, "utf8"), preferenceText);
  pass("Imported shortest/relative/absolute and Markdown/wiki preferences drive real MetadataCache/FileManager results without rewriting app.json; saved BOM/CRLF links render and navigate to exact files despite root/source-folder shadows.");

  await toggle("note-composer", false);
  await closeSettings();
  const composerOptions = "\ufeff" + JSON.stringify({ replacementText: "link", template: "", askBeforeMerging: false, futureLinkPreference: { keep: true } }) + "\r\n";
  await writeFile(join(directory, ".obsidian", "note-composer.json"), composerOptions);
  await toggle("note-composer", true);
  await closeSettings();
  const composerSource = "Discovery/Composer preference.md", composerTarget = "Discovery/Links/Composed note.md";
  const composerText = "\ufeff# Composer preference\r\n\r\nExtract this text.\r\n\r\nKeep after.\r\n";
  await writeFile(join(directory, composerSource), composerText);
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await open(composerSource);
  await evaluate('app.editor.setSelection({line:2,ch:0},{line:2,ch:18})');
  assert.equal(await evaluate("app.editor.getSelection()"), "Extract this text.");
  const extractName = await evaluate('app.commands.listCommands().find(command=>command.id==="note-composer:split-file").name');
  await press("p", "KeyP", 80, 2);
  await wait('document.querySelector("#desktop-picker").open', "real extraction command palette");
  await command("Input.insertText", { text: extractName });
  await click('[data-command-id="note-composer:split-file"]');
  const composerDialog = '[data-core-dialog="note-composer"]';
  await wait(`Boolean(document.querySelector('${composerDialog}'))`, "actual extraction dialog");
  await fill(`${composerDialog} [data-composer-target]`, composerTarget);
  await press("Tab", "Tab", 9);
  if (!await evaluate(`document.querySelector('${composerDialog} [data-composer-create]').checked`)) { await click(`${composerDialog} [data-composer-create]`); }
  await click(`${composerDialog} [data-composer-action="apply"]`);
  await wait(`!document.querySelector('${composerDialog}')&&!app.workspace.isChangingFiles`, "preference-aware selection extraction commits");
  const composerReplacement = "[Composed note](Links/Composed%20note.md)";
  assert.equal(await readFile(join(directory, composerSource), "utf8"), composerText.replace("Extract this text.", composerReplacement));
  assert.equal((await readFile(join(directory, composerTarget), "utf8")).trim(), "Extract this text.");
  assert.equal(await readFile(join(directory, ".obsidian", "note-composer.json"), "utf8"), composerOptions);
  assert.equal(await readFile(appPath, "utf8"), preferenceText);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  await command("Page.reload");
  await afterReload();
  await wait('app.workspace.layoutReady&&app.core.isEnabled("switcher")', "preferences and aliases after real reload/reconnect");
  assert.equal(await evaluate('app.vault.getConfig("newLinkFormat")'), "relative");
  assert.equal(await evaluate('app.vault.getConfig("useMarkdownLinks")'), true);
  await pickerQuery("External switcher alias");
  await includes(`[data-switcher-path="${renamedAliasFile}"][data-switcher-alias]`, true);
  await dismissPicker();
  assert.equal(await readFile(appPath, "utf8"), preferenceText);
  pass("Actual Note composer extraction uses the imported relative Markdown-link preference, preserves source BOM/CRLF and unknown module settings, and real reload/reconnection restores preferences plus the renamed alias target.");

  const recentSource = movedSource, automaticPath = join(directory, ".obsidian", "workspace.json");
  const automaticBytes = await readFile(automaticPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const recentNew = "Discovery/Recent new.md", recentRenamed = "Discovery/Recent renamed.md";
  await open(recentSource); await open(renamedAliasFile); await open(secondAliasFile); await open(recentSource);
  assert.deepEqual(await evaluate('app.workspace.getRecentFiles({maxCount:3})'), [secondAliasFile, renamedAliasFile, recentSource]);
  await pickerQuery("");
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${picker} [data-switcher-path]'),row=>row.dataset.switcherPath).slice(0,3)`), [secondAliasFile, renamedAliasFile, recentSource]);
  assert.equal(await evaluate(`document.querySelector('${picker} [data-switcher-alias],${picker} [data-switcher-bookmark],${picker} [data-switcher-unresolved]')`), null);
  await writeFile(join(directory, recentNew), "# Newly created recent\n");
  await wait(`document.querySelector('${picker} [data-switcher-path]')?.dataset.switcherPath===${JSON.stringify(recentNew)}`, "actual external creation refreshes recent order");
  await evaluate(`globalThis.staleRecentRow=document.querySelector('${picker} [data-switcher-path]');true`);
  await rename(join(directory, recentNew), join(directory, recentRenamed));
  await wait(`document.querySelector('${picker} [data-switcher-path]')?.dataset.switcherPath===${JSON.stringify(recentRenamed)}&&!document.querySelector('${picker} [data-switcher-path="${recentNew}"]')`, "actual rename retains recent identity");
  await rm(join(directory, recentRenamed));
  await wait(`!document.querySelector('${picker} [data-switcher-path="${recentRenamed}"]')`, "deleted recent is not offered");
  await writeFile(join(directory, recentNew), "# A replacement file\n");
  await wait(`document.querySelector('${picker} [data-switcher-path]')?.dataset.switcherPath===${JSON.stringify(recentNew)}`, "replacement file has its own new recent row");
  await evaluate("staleRecentRow.click();delete globalThis.staleRecentRow;true");
  assert.equal(await evaluate("app.current.file.path"), recentSource);
  assert.ok(await evaluate(`document.querySelectorAll('${picker} [data-switcher-path]').length<=10`));
  for (let index = 0; index < 10 && await evaluate(`document.querySelector('${picker} [aria-selected="true"]')?.dataset.switcherPath`) !== recentNew; index++) {
    await press("ArrowUp", "ArrowUp", 38);
  }
  assert.equal(await evaluate(`document.querySelector('${picker} [aria-selected="true"]')?.dataset.switcherPath`), recentNew);
  await capture("recents", "switcher-navigation");
  await press("Enter", "Enter", 13, 2);
  await wait(`app.current?.file.path===${JSON.stringify(recentNew)}`, "Ctrl+Enter opens the actual recent target");
  pass("An empty Quick switcher follows genuine departed-file order rather than the vault inventory, excludes aliases/bookmarks/unresolved links, refreshes actual external creation/rename/deletion, ignores a retained replaced-file row, and opens recent targets with Ctrl+Enter.");

  await open(recentSource);
  const recentLayout = await evaluate("app.workspace.getLayout()");
  await open(secondAliasFile);
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(recentLayout)})`);
  assert.equal(await evaluate("app.workspace.getRecentFiles()[0]"), secondAliasFile, "Applying a named-layout snapshot must retain history and record the departed note.");
  await open(recentNew); await open(recentSource);
  const recentBeforeReload = await evaluate("app.workspace.getLastOpenFiles()");
  assert.equal(await evaluate('Object.hasOwn(app.workspace.getLayout().views,"workspace-recent-files")'), false, "Named-layout snapshots must not capture global file history.");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  if (restart) { await restart(); }
  else { await command("Page.reload"); await afterReload(); }
  await wait('app.workspace.layoutReady&&app.core.isEnabled("switcher")', "recent-file workspace restored");
  assert.deepEqual(await evaluate("app.workspace.getLastOpenFiles()"), recentBeforeReload);
  await pickerQuery("");
  assert.equal(await evaluate(`document.querySelector('${picker} [data-switcher-path]')?.dataset.switcherPath`), recentNew);
  await evaluate(`globalThis.localRecentRow=document.querySelector('${picker} [data-switcher-path]');true`);
  await dismissPicker();
  assert.deepEqual(await readFile(automaticPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; }), automaticBytes);
  assert.equal(await readFile(appPath, "utf8"), preferenceText);
  pass("Recent-file order survives a real native process restart or real-folder WASM reload/reconnection in the independent workspace store, stays out of named-profile snapshots, and never rewrites Obsidian workspace.json or app.json.");

  const bookmarkPath = join(directory, ".obsidian", "bookmarks.json"), bookmarkFolder = "Discovery/Bookmark folder", bookmarkQuery = `path:"${target}"`;
  await toggle("bookmarks", false); await toggle("graph", true); await closeSettings();
  await mkdir(join(directory, bookmarkFolder), { recursive: true });
  const bookmarkText = await readFile(bookmarkPath, "utf8").catch(error => { if (error.code !== "ENOENT") { throw error; } return "{}"; });
  const bookmarkData = JSON.parse(bookmarkText.replace(/^\ufeff/, "")), groupIndex = (bookmarkData.items ?? []).length;
  const bookmarkGroup = { type: "group", title: "Switcher navigation", ctime: 7000, futureSwitcherGroup: "kept", items: [
    { type: "file", path: target, title: "<switcher bookmark>", ctime: 7001 },
    { type: "file", path: target, subpath: "#Destination", title: "Saved destination", ctime: 7002 },
    { type: "search", query: bookmarkQuery, title: "Saved target search", ctime: 7003 },
    { type: "folder", path: bookmarkFolder, title: "Saved empty folder", ctime: 7004 },
    { type: "graph", title: "Saved target graph", ctime: 7005, options: { search: bookmarkQuery, showOrphans: true, futureSwitcherGraph: { kept: true } } },
    { type: "url", url: "https://example.invalid/switcher", title: "Saved URL", ctime: 7006 },
  ] };
  bookmarkData.items = [...(bookmarkData.items ?? []), bookmarkGroup];
  bookmarkData.futureSwitcherBookmarkFixture = { keep: [true, null] };
  let bookmarkBytes = Buffer.from("\ufeff" + JSON.stringify(bookmarkData, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await writeFile(bookmarkPath, bookmarkBytes);
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await toggle("bookmarks", true); await closeSettings();
  const bookmarkRow = index => `${picker} [data-switcher-bookmark="${groupIndex}.${index}"]`;
  await pickerQuery("Switcher navigation");
  assert.equal(await evaluate(`document.querySelectorAll('${picker} [data-switcher-bookmark]').length`), 6);
  assert.equal(await evaluate(`document.querySelector('${bookmarkRow(0)} .suggestion-title').textContent`), "Switcher navigation/<switcher bookmark>");
  assert.equal(await evaluate(`document.querySelector('${bookmarkRow(0)} .suggestion-title').childElementCount`), 0);
  assert.equal(await evaluate(`document.querySelector('${bookmarkRow(5)} .suggestion-note').textContent`), "https://example.invalid/switcher");
  await capture("bookmarks", "switcher-navigation");
  await click(bookmarkRow(0));
  await wait(`app.current?.file.path===${JSON.stringify(target)}`, "bookmarked file opens through the real controller");
  await pickerQuery("Saved destination"); await press("Enter", "Enter", 13);
  const headingLine = (await readFile(join(directory, target), "utf8")).split("\n").findIndex(line => line === "## Destination");
  await wait(`app.current?.file.path===${JSON.stringify(target)}&&app.editor.getCursor().line===${headingLine}`, "the actual bookmark heading position is revealed");
  assert.equal(await evaluate("app.editor.getCursor().line"), headingLine);
  await pickerQuery("Saved target search"); await press("Enter", "Enter", 13);
  await results(bookmarkQuery, [target]);
  await pickerQuery("Saved empty folder"); await click(bookmarkRow(3));
  await wait(`app.workspace.activeLeaf.view.getViewType()==="file-explorer"&&document.activeElement?.dataset.explorerPath===${JSON.stringify(bookmarkFolder)}`, "bookmarked folder reveals the real Files pane");
  await pickerQuery("Saved target graph"); await press("Enter", "Enter", 13, 2);
  await wait(`app.workspace.activeLeaf.view.getViewType()==="graph"&&app.workspace.activeLeaf.view.getState().options.search===${JSON.stringify(bookmarkQuery)}`, "modified bookmark opens a genuine configured graph tab");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getState().options.search"), bookmarkQuery);
  const graphPane = `[data-graph-pane="${await evaluate("app.workspace.activeLeaf.id")}"]`;
  await wait(`document.querySelector('${graphPane} [data-graph-status]')?.dataset.graphComplete==="true"&&document.querySelector('${graphPane} [data-graph-status]').dataset.completedQuery===${JSON.stringify(bookmarkQuery)}`, "the actual graph bookmark query completes");
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${graphPane} [data-graph-node]'),node=>node.dataset.graphPath)`), [target]);
  assert.deepEqual(await evaluate("app.workspace.activeLeaf.view.getState().options.futureSwitcherGraph"), { kept: true });
  assert.deepEqual(await readFile(bookmarkPath), bookmarkBytes);
  assert.equal(await readFile(appPath, "utf8"), preferenceText);
  pass("Nonempty Quick switcher searches nested bookmark titles with native slash-delimited group context and literal labels, dispatches actual file/heading/search/folder/graph targets and modified new tabs through Bookmarks, and renders URL detail without launching an external browser or changing stored bookmark bytes.");

  await open(recentSource);
  await pickerQuery("<switcher bookmark>");
  await evaluate(`globalThis.staleBookmarkRow=document.querySelector('${bookmarkRow(0)}');true`);
  bookmarkGroup.items[0].title = "Changed switcher bookmark";
  bookmarkBytes = Buffer.from("\ufeff" + JSON.stringify(bookmarkData, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await writeFile(bookmarkPath, bookmarkBytes);
  await evaluate('app.core.getEnabledPluginById("bookmarks").reload()');
  await wait(`!document.querySelector('${bookmarkRow(0)}')`, "an actual configuration reload removes an obsolete bookmarked title");
  await evaluate("staleBookmarkRow.click();delete globalThis.staleBookmarkRow;true");
  assert.equal(await evaluate("app.current.file.path"), recentSource);
  await fill(`${picker} input`, "Changed switcher bookmark");
  await wait(`Boolean(document.querySelector('${bookmarkRow(0)}'))`, "updated bookmark appears in the still-open picker");
  await evaluate(`globalThis.disabledBookmarkRow=document.querySelector('${bookmarkRow(0)}');true`);
  await evaluate('app.core.setEnabled("bookmarks",false)');
  await wait(`!app.core.busy&&!document.querySelector('${picker} [data-switcher-bookmark]')`, "disabling Bookmarks removes actual suggestions");
  await evaluate("disabledBookmarkRow.click();delete globalThis.disabledBookmarkRow;true");
  assert.equal(await evaluate("app.current.file.path"), recentSource);
  await dismissPicker();
  await toggle("bookmarks", true); await closeSettings();
  await pickerQuery("Changed switcher bookmark");
  await evaluate(`globalThis.localBookmarkRow=document.querySelector('${bookmarkRow(0)}');true`);
  await dismissPicker();
  await pickerQuery("External switcher alias");
  await includes(`[data-switcher-path="${renamedAliasFile}"][data-switcher-alias]`, true);
  await evaluate(`globalThis.localAliasRow=document.querySelector('${picker} [data-switcher-alias]');true`);
  await dismissPicker();
  assert.deepEqual(await readFile(bookmarkPath), bookmarkBytes);
  const localRecentBeforeMount = await evaluate("app.workspace.getLastOpenFiles()");
  await evaluate("app.workspace.flushLayout()");
  pass("Actual bookmark configuration reloads refresh an open picker, disabled Bookmarks removes its suggestions, and retained old rows cannot open renamed or disabled targets; unknown JSON fields plus BOM/CRLF remain byte-exact.");

  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
  const originalRemoteWorkspace = {
    main: { id: "remote-main", type: "split", direction: "vertical", children: [
      { id: "remote-tabs", type: "tabs", children: [{ id: "remote-note", type: "leaf", state: { type: "markdown", state: { file: "Folder/Source.md", mode: "preview" } } }] },
    ] }, active: "remote-note", lastOpenFiles: ["Folder/Note.md"], futureRemoteWorkspace: { kept: true },
  };
  const remote = await mountCachedGitHub(evaluate, "switcher-navigation", [
    ["Folder/Source.md", "# Cached source\n"],
    ["Folder/Note.md", "---\naliases: [Remote switcher alias]\n---\n# Cached target\n\n## Remote\n"],
    [".obsidian/app.json", '{"newLinkFormat":"relative","useMarkdownLinks":true,"futureLinkPreference":{"keep":true}}'],
    [".obsidian/core-plugins.json", '["switcher","command-palette","file-explorer","bookmarks"]'],
    [".obsidian/community-plugins.json", "[]"],
    [".obsidian/workspace.json", "\ufeff" + JSON.stringify(originalRemoteWorkspace) + "\r\n"],
    [".obsidian/bookmarks.json", '\ufeff{"items":[{"type":"group","title":"Remote group","items":[{"type":"file","path":"Folder/Note.md","subpath":"#Remote","title":"Remote bookmark point"}]}],"futureSwitcherBookmark":{"kept":true}}\r\n'],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(remote.mount.id)}&&!app.changingVault&&app.core.isEnabled("switcher")`, "genuine cache-only alias vault");
  assert.deepEqual(await evaluate("app.workspace.getRecentFiles()"), ["Folder/Note.md"]);
  assert.equal(await evaluate("app.current.file.path"), "Folder/Source.md");
  await evaluate("localRecentRow.click();localBookmarkRow.click();delete globalThis.localRecentRow;delete globalThis.localBookmarkRow;true");
  assert.equal(await evaluate("app.current.file.path"), "Folder/Source.md");
  await pickerQuery("");
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${picker} [data-switcher-path]'),row=>row.dataset.switcherPath)`), ["Folder/Note.md"]);
  assert.equal(await evaluate(`document.querySelector('${picker} [data-switcher-bookmark],${picker} [data-switcher-alias]')`), null);
  await press("Enter", "Enter", 13);
  await evaluate('(async()=>{await app.openFile("Folder/Note.md");await app.metadataCache.refresh()})()');
  await evaluate("localAliasRow.click();delete globalThis.localAliasRow;true");
  assert.equal(await evaluate("app.current.file.path"), "Folder/Note.md");
  await pickerQuery("Remote switcher alias");
  await includes('[data-switcher-path="Folder/Note.md"][data-switcher-alias]', true);
  await press("Enter", "Enter", 13);
  assert.equal(await evaluate("app.vault.readOnly"), true);
  assert.equal(await evaluate("app.current.file.path"), "Folder/Note.md");
  assert.equal(await evaluate('app.fileManager.generateMarkdownLink(app.vault.getFileByPath("Folder/Note.md"),"Folder/Source.md","#Remote","Remote note")'), "[Remote note](Note.md#Remote)");
  assert.equal(await evaluate("app.editor.cm.contentDOM.contentEditable"), "false");
  await evaluate('app.workspace.activeLeaf.view.setMode("source")');
  await pickerQuery("Remote bookmark point"); await press("Enter", "Enter", 13);
  await wait('app.current?.file.path==="Folder/Note.md"&&app.editor.getCursor().line===5', "the genuine cached bookmark reveals its heading in Source");
  assert.equal(await evaluate("app.current.file.path"), "Folder/Note.md");
  assert.equal(await evaluate("app.editor.getCursor().line"), 5);
  assert.equal(await evaluate("app.editor.cm.contentDOM.contentEditable"), "false");
  await capture("readonly", "switcher-navigation");
  const remoteRecent = await evaluate("app.workspace.getLastOpenFiles()");
  await evaluate("(async()=>{await app.workspace.flushLayout();await app.workspace.restore()})()");
  assert.deepEqual(await evaluate("app.workspace.getLastOpenFiles()"), remoteRecent);
  await evaluate('app.workspace.activeLeaf.view.setMode("preview")');
  const remoteState = await evaluate("app.githubVaults.state()");
  assert.equal(remoteState.counters.api, 0); assert.equal(remoteState.counters.raw, 0);
  await assertCachedBlobsUnchanged(evaluate, remote.blobs);
  await capture("readonly");
  await command("Page.navigate", { url: pageUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  assert.deepEqual(await evaluate("app.workspace.getLastOpenFiles()"), localRecentBeforeMount);
  await assertCachedBlobsUnchanged(evaluate, remote.blobs);
  assert.equal(await readFile(appPath, "utf8"), preferenceText);
  assert.equal(await readFile(join(directory, renamedAliasFile), "utf8"), externalAliasText);
  assert.deepEqual(await readFile(bookmarkPath), bookmarkBytes);
  assert.deepEqual(await readFile(automaticPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; }), automaticBytes);
  pass("A genuine cache-only GitHub mount opens indexed aliases and generates configured links without writable APIs, keeps source non-editable and all remote blobs exact, rejects stale local controls, uses zero network and returns to the untouched local preferences.");
  pass("Original workspace lastOpenFiles seeds genuine cache-only recent suggestions; bookmarked headings navigate non-editable Source, local history survives real workspace restoration without touching remote configuration, and switching back restores the separate local recent history.");
  report.linkPreferences = { formats: ["shortest", "relative", "absolute"], importedConfigurationPreserved: true, actualReadingNavigation: true, actualComposerExtraction: true, safePathPrefixes: true, readOnlyGeneration: true };
  report.quickSwitcherAliases = { sharedOwners: true, literalLabels: true, actualNewTab: true, dirtyUndoRedo: true, externalRename: true, staleControlsInert: true, reloadRestoration: true, cacheOnlyMount: true, exactNativeRanking: false };
  report.quickSwitcherNavigation = { recentFiles: true, departedFileOrder: true, externalCreateRenameDelete: true, actualNewTab: true,
    nativeProcessRestart: Boolean(restart), wasmReloadReconnect: !restart, originalWorkspaceImport: true, namedProfilesExcludeHistory: true,
    nestedBookmarks: true, fileHeadingSearchFolderGraph: true, urlRenderingOnly: true, configurationReload: true, staleControlsInert: true,
    cacheOnlyReadOnly: true, vaultIsolation: true, configurationBytesPreserved: true, exactNativeRankingAndIgnoredFiles: false };
  report.discovery = { implementation: "independent-feature-subset", originalModulesLoaded: false, genericWorkspaceViews: "not-exercised-by-this-legacy-scope", fullReferenceRuntimeComparison: "not-performed" };
}
