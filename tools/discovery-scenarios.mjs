import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkDiscovery({ directory, evaluate, command, click, press, wait, afterReload, report }) {
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
    await press("End", "End", 35, 2);
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
  await click('[data-tag="#discovery/front"]');
  await wait('document.querySelector("#client-errors").textContent.includes("Enable Search")', "disabled Search dependency is explicit");
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
  await wait('app.editor.getSelection()==="[^alpha]"', "footnote reference navigation");
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
  await includes(`[data-switcher-path="${board}"]`, false);
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
  pass("Quick switcher settings control actual registered attachments and unresolved references: Canvas opens, hidden attachments/unknown extensions stay out, and existing-only removes unresolved suggestions without implicitly creating a note.");

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
  report.discovery = { implementation: "independent-feature-subset", originalModulesLoaded: false, genericWorkspaceViews: "not-implemented", fullReferenceRuntimeComparison: "not-performed" };
}
