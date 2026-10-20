import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkGraphs({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Graph workflows";
  const alpha = folder + "/Alpha.md";
  const beta = folder + "/Beta.md";
  const gamma = folder + "/Gamma.md";
  const orphan = folder + "/Orphan.md";
  const missing = folder + "/Missing.md";
  const renamed = folder + "/Beta renamed.md";
  const image = folder + "/Image.png";
  const configuration = join(directory, ".obsidian", "graph.json");
  const initial = {
    search: 'path:"Graph workflows"', showOrphans: true,
    colorGroups: [{ query: "file:Alpha OR file:Beta", color: { a: 1, rgb: 0x8899aa, futureColor: ["retained"] }, futureGroup: { keep: true } }],
    futureSetting: { retained: [null, "value", 42] },
  };
  const alphaText = "---\r\nrelated: '[[Beta#Heading]]'\r\ntags: [graph-fixture/root]\r\n---\r\n# Alpha\r\n[[Beta|Repeated]] [[Gamma]] [[Graph workflows/Missing]] ![[Image.png]]\r\n`[[Hidden]]` \\#escaped\r\n";
  const betaText = "# Heading\r\n[Gamma](./Gamma.md) [[Alpha]]\r\n";
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate Graph observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  const optionalRead = path => readFile(path).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const originalWorkspace = await optionalRead(join(directory, ".obsidian", "workspace.json"));
  const stored = async () => JSON.parse((await readFile(configuration, "utf8")).replace(/^\uFEFF/, ""));
  let globalId, localId;
  const pane = local => `[data-graph-view="${local ? "local" : "global"}"]`;
  const option = (local, key) => `${pane(local)} [data-graph-option="${key}"]`;
  const node = (local, path) => `${pane(local)} [data-graph-path="${path}"]`;
  async function controls(local) {
    if (!await evaluate(`document.querySelector('${pane(local)} .graph-controls').checkVisibility()`)) {
      await click(`${pane(local)} [data-graph-action="toggle-controls"]`);
    }
  }
  async function toggleOption(local, key) {
    await controls(local);
    await click(option(local, key));
  }
  async function hideCompactControls(local) {
    if (await evaluate(`document.querySelector('${pane(local)}').classList.contains("is-compact")&&document.querySelector('${pane(local)} .graph-controls').checkVisibility()`)) {
      await click(`${pane(local)} [data-graph-action="toggle-controls"]`);
      await wait(`!document.querySelector('${pane(local)} .graph-controls').checkVisibility()`, "Graph controls actually close before interacting with nodes");
    }
  }
  async function settings() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await wait('document.querySelector("#settings-dialog").open', "Graph settings opened");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function toggle(enabled) {
    await settings();
    assert.equal(await evaluate('app.core.state("graph").settingsSupport'), "none");
    assert.equal(await evaluate('document.querySelector("[data-core-settings=graph]")===null'), true);
    if (await evaluate('app.core.isEnabled("graph")') !== enabled) { await click('[data-core-toggle="graph"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("graph")===${enabled}`, "Graph provider toggled");
    await click(".settings-close");
    await wait('!document.querySelector("#settings-dialog").open', "Graph settings closed");
  }
  async function fill(selector, text) {
    await controls(selector.startsWith(pane(true)));
    await click(selector);
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, "Graph control must actually receive keyboard input");
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text });
  }
  async function complete(local, query) {
    const selector = `${pane(local)} [data-graph-status]`;
    await wait(`document.querySelector(${JSON.stringify(selector)})?.dataset.graphComplete==="true"${query === undefined ? "" : `&&document.querySelector(${JSON.stringify(selector)}).dataset.completedQuery===${JSON.stringify(query)}`}`, "completed " + (local ? "local" : "global") + " graph");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).classList.contains("is-error")`), false,
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`));
  }
  async function paths(local) {
    return evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${pane(local)} [data-graph-node]`)}),node=>node.dataset.graphPath).sort()`);
  }
  async function filter(local, text) {
    await fill(option(local, "search"), text);
    await press("Enter", "Enter", 13);
    await complete(local, text);
  }
  async function setNumber(local, key, value) {
    await fill(option(local, key), String(value));
    await press("Tab", "Tab", 9);
    await complete(local);
    await evaluate("app.workspace.flushLayout()");
  }
  async function reveal(local) {
    await click(`[data-tab-id="${local ? localId : globalId}"]`);
    await complete(local);
  }
  async function clickNode(local, path, modifiers = 2) {
    await hideCompactControls(local);
    const point = await evaluate(`(()=>{const circle=document.querySelector(${JSON.stringify(node(local, path) + " circle")});if(!circle)throw new Error("The graph node is absent");const b=circle.getBoundingClientRect();if(!b.width||!b.height)throw new Error("The graph node is hidden");const x=b.left+b.width/2,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);if(hit?.closest("[data-graph-node]")!==circle.parentElement)throw new Error("The graph node cannot be reached: "+JSON.stringify({hit:hit?.outerHTML.slice(0,200),bounds:b.toJSON(),surface:circle.closest("svg").getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],scroll:[circle.closest(".graph-view").scrollLeft,circle.closest(".graph-view").scrollTop]}));return{x,y}})()`);
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, modifiers, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", modifiers, clickCount: 1 });
  }
  async function drag(selector, dx, dy) {
    await hideCompactControls(selector.startsWith(pane(true)));
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const b=e.getBoundingClientRect();const x=b.left+Math.min(15,b.width/2),y=b.top+Math.min(15,b.height/2);const hit=document.elementFromPoint(x,y);if(!e.checkVisibility()||!b.width||!b.height||!(hit===e||e.contains(hit)||(e.matches("circle")&&hit?.closest("[data-graph-node]")===e.parentElement)))throw new Error("The Graph drag target cannot be reached: "+JSON.stringify({selector:${JSON.stringify(selector)},bounds:b.toJSON(),hit:hit?.outerHTML.slice(0,300)}));return{x,y}})()`);
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + dx, y: point.y + dy, button: "left", buttons: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + dx, y: point.y + dy, button: "left", clickCount: 1 });
  }

  await evaluate("app.workspace.saveAll()");
  await toggle(false);
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, alpha), alphaText);
  await writeFile(join(directory, beta), betaText);
  await writeFile(join(directory, gamma), "# Gamma\r\n[[Beta]]\r\n");
  await writeFile(join(directory, orphan), "# Orphan\r\n[[Orphan]]\r\n");
  await writeFile(join(directory, image), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqkAAAAASUVORK5CYII=", "base64"));
  await writeFile(configuration, "\ufeff" + JSON.stringify(initial, null, 2));
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await toggle(true);
  await press("g", "KeyG", 71, 2);
  await wait('app.workspace.activeLeaf.view.getViewType()==="graph"', "Ctrl+G opens the real global Graph view");
  globalId = await evaluate("app.workspace.activeLeaf.id");
  await complete(false, initial.search);
  assert.deepEqual(await paths(false), [alpha, beta, gamma, missing, orphan].sort());
  assert.equal(await evaluate('app.workspace.activeLeaf.session===null&&!app.workspace.activeLeaf.containerEl.querySelector(".cm-editor")'), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(node(false, missing))}).dataset.graphKind`), "unresolved");
  await clickNode(false, beta);
  await wait(`app.current?.file.path===${JSON.stringify(beta)}`, "a real graph node opens the linked note");
  assert.equal(await evaluate("app.editor.getValue()"), betaText);
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "\r\n[[Graph workflows/Dirty target]]" });
  await wait(`Boolean(document.querySelector(${JSON.stringify(node(false, folder + "/Dirty target.md"))}))`, "dirty editor metadata updates Graph");
  assert.equal(await readFile(join(directory, beta), "utf8"), betaText, "Graph indexes unsaved text rather than silently saving it");
  await press("z", "KeyZ", 90, 2);
  await wait(`!document.querySelector(${JSON.stringify(node(false, folder + "/Dirty target.md"))})`, "undo updates Graph");
  await press("s", "KeyS", 83, 2);
  await evaluate("app.workspace.whenIdle()");
  await writeFile(join(directory, beta), betaText + "[[Graph workflows/External target]]\r\n");
  await evaluate("app.metadataCache.refresh()");
  await wait(`Boolean(document.querySelector(${JSON.stringify(node(false, folder + "/External target.md"))}))`, "external metadata updates Graph");
  await writeFile(join(directory, beta), betaText);
  await evaluate("app.metadataCache.refresh()");
  await reveal(false);
  await clickNode(false, missing);
  await wait(`app.current?.file.path===${JSON.stringify(missing)}`, "a real unresolved graph node creates its note");
  assert.equal(await readFile(join(directory, missing), "utf8"), "");
  await wait(`document.querySelector(${JSON.stringify(node(false, missing))})?.dataset.graphKind==="file"`, "newly created node becomes a resolved file");
  pass("Global Graph uses actual Markdown/property links, missing and orphan notes; node clicks open/create real files and dirty edits, undo and external changes update the rendered graph.");

  await evaluate(`app.openFile(${JSON.stringify(beta)},"tab")`);
  await evaluate('app.commands.execute("graph:open-local")');
  await wait('app.workspace.activeLeaf.view.getViewType()==="localgraph"', "real local Graph view");
  localId = await evaluate("app.workspace.activeLeaf.id");
  await complete(true);
  assert.deepEqual(await paths(true), [alpha, beta, gamma].sort());
  const withoutNeighbors = await evaluate(`document.querySelectorAll('${pane(true)} .graph-link').length`);
  await toggleOption(true, "localInterlinks");
  await complete(true);
  assert.ok(await evaluate(`document.querySelectorAll('${pane(true)} .graph-link').length`) > withoutNeighbors);
  await setNumber(true, "localJumps", 2);
  assert.ok((await paths(true)).includes(missing));
  await toggleOption(true, "localBacklinks");
  await toggleOption(true, "localForelinks");
  await complete(true);
  assert.deepEqual(await paths(true), [beta]);
  await toggleOption(true, "localBacklinks");
  await toggleOption(true, "localForelinks");
  await setNumber(true, "localJumps", 1);
  await evaluate('app.commands.execute("workspace:toggle-pin")');
  await clickNode(true, gamma);
  await wait(`app.current?.file.path===${JSON.stringify(gamma)}`, "local graph node navigation");
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(localId)}).getViewState().state.file`), beta);
  await reveal(true);
  await evaluate('app.commands.execute("workspace:toggle-pin")');
  await clickNode(true, alpha);
  await wait(`app.workspace.getLeafById(${JSON.stringify(localId)}).getViewState().state.file===${JSON.stringify(alpha)}`, "unpinned local graph follows the active file");
  await complete(true);
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(beta)},"tab");await app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(beta)}),${JSON.stringify(renamed)})})()`);
  await wait(`document.querySelector(${JSON.stringify(node(false, renamed))})&&!document.querySelector(${JSON.stringify(node(false, beta))})`, "graph follows an actual guarded file rename");
  await complete(true);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(localId)}).getViewState().state.file`), renamed);
  assert.ok((await readFile(join(directory, alpha), "utf8")).includes("[[Graph workflows/Beta renamed#Heading]]"));
  pass("Local Graph has real directed depth and neighbor-edge controls, follows files unless pinned, and global/local nodes and file state follow an actual guarded rename.");
  accept("graph:global-local");

  await reveal(false);
  await filter(false, 'path:"Graph workflows" -file:Orphan');
  assert.ok(!(await paths(false)).includes(orphan));
  await toggleOption(false, "showAttachments");
  await complete(false);
  assert.ok((await paths(false)).includes(image));
  await toggleOption(false, "showAttachments");
  await toggleOption(false, "showTags");
  await filter(false, 'path:"Graph workflows" OR tag:graph-fixture/root');
  await wait(`Boolean(document.querySelector(${JSON.stringify(node(false, "#graph-fixture/root"))}))`, "real tag nodes");
  await clickNode(false, "#graph-fixture/root", 0);
  await wait('document.querySelector("[data-search-status]")?.dataset.searchComplete==="true"', "tag node opens real Search");
  assert.match(await evaluate('document.querySelector("[data-search-query]").value'), /graph-fixture\/root/);
  await reveal(false);
  await filter(false, initial.search);
  await click(`${pane(false)} details:nth-of-type(2) > summary`);
  await click(`${pane(false)} [data-graph-action="add-group"]`);
  await fill(`${pane(false)} [data-graph-group="1"] [data-graph-group-query]`, "file:Alpha");
  await press("Tab", "Tab", 9);
  await evaluate(`(()=>{const color=document.querySelector('${pane(false)} [data-graph-group="1"] [data-graph-group-color]');color.value="#ff0000";color.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  await complete(false);
  assert.notEqual(await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha) + " circle")}).style.fill`), "rgb(255, 0, 0)", "Earlier matching groups win");
  await click(`${pane(false)} [data-graph-group="1"] button:first-of-type`);
  await complete(false);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha) + " circle")}).style.fill`), "rgb(255, 0, 0)");
  await click(`${pane(false)} [data-graph-action="add-group"]`);
  await click(`${pane(false)} [data-graph-group="2"] button:last-of-type`);
  await click(`${pane(false)} details:nth-of-type(3) > summary`);
  const oldRadius = await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha) + " circle")}).getAttribute("r")`);
  await setNumber(false, "nodeSizeMultiplier", 1.5);
  assert.equal(Number(await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha) + " circle")}).getAttribute("r")`)), Number(oldRadius) * 1.5);
  await toggleOption(false, "showArrow");
  await complete(false);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('${pane(false)} .graph-link')).every(line=>line.hasAttribute("marker-end"))`), true);
  await click(`${pane(false)} details:nth-of-type(4) > summary`);
  const oldPosition = await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha))}).getAttribute("transform")`);
  await setNumber(false, "linkDistance", 150);
  assert.notEqual(await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha))}).getAttribute("transform")`), oldPosition, "Force controls change the actual layout without requiring a manual rebuild");
  await evaluate("app.workspace.flushLayout()");
  const saved = await stored();
  assert.equal(saved.nodeSizeMultiplier, 1.5);
  assert.equal(saved.linkDistance, 150);
  assert.equal(saved.showArrow, true);
  assert.equal(saved.colorGroups[0].query, "file:Alpha");
  assert.deepEqual(saved.colorGroups[1].futureGroup, initial.colorGroups[0].futureGroup);
  assert.deepEqual(saved.colorGroups[1].color.futureColor, initial.colorGroups[0].color.futureColor);
  assert.deepEqual(saved.futureSetting, initial.futureSetting);
  assert.ok((await readFile(configuration, "utf8")).startsWith("\ufeff"));
  pass("Actual Graph controls filter nodes, show attachments/tags, navigate to Search, reorder overlapping color groups and change visible sizes/arrows/physics while preserving BOM and unknown configuration fields.");

  const cameraBefore = await evaluate(`app.workspace.getLeafById(${JSON.stringify(globalId)}).view.getState().slopsidianViewport`);
  await click(`${pane(false)} [data-graph-action="zoom-in"]`);
  await drag(`${pane(false)} [data-graph-surface]`, 35, 25);
  const cameraAfter = await evaluate(`app.workspace.getLeafById(${JSON.stringify(globalId)}).view.getState().slopsidianViewport`);
  assert.ok(cameraAfter.scale > cameraBefore.scale);
  assert.notEqual(cameraAfter.x, cameraBefore.x);
  await click(`${pane(false)} [data-graph-action="fit-graph"]`);
  const beforeDrag = await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha))}).getAttribute("transform")`);
  await drag(node(false, alpha) + " circle", 25, -20);
  assert.notEqual(await evaluate(`document.querySelector(${JSON.stringify(node(false, alpha))}).getAttribute("transform")`), beforeDrag);
  await evaluate(`document.querySelector(${JSON.stringify(node(false, orphan))}).focus();true`);
  await press("Enter", "Enter", 13, 2);
  await wait(`app.current?.file.path===${JSON.stringify(orphan)}`, "graph keyboard node navigation");
  await reveal(false);
  if (capture) { await capture(); }
  pass("The real SVG graph supports camera zoom/pan, pointer node dragging and keyboard node activation without using a hidden editor.");

  await fill(option(false, "search"), "[broken");
  await press("Enter", "Enter", 13);
  await wait(`document.querySelector('${pane(false)} [data-graph-status]')?.classList.contains("is-error")`, "visible malformed Graph query");
  assert.match(await evaluate(`document.querySelector('${pane(false)} [data-graph-status]').textContent`), /Unclosed/);
  await filter(false, initial.search);
  const external = { ...await stored(), futureExternal: { keep: "external graph configuration" } };
  await writeFile(configuration, "\ufeff" + JSON.stringify(external, null, 2));
  await toggleOption(false, "showOrphans");
  await wait(`Boolean(document.querySelector('${pane(false)} [data-graph-error]').textContent)`, "visible stale Graph configuration rejection");
  assert.match(await evaluate(`document.querySelector('${pane(false)} [data-graph-error]').textContent`), /changed|conflict|409/i);
  assert.deepEqual(await stored(), external);
  await click(`${pane(false)} [data-graph-action="reload-controls"]`);
  await wait(`!document.querySelector('${pane(false)} [data-graph-action="reload-controls"]').disabled&&!document.querySelector('${pane(false)} [data-graph-error]').textContent`, "Graph configuration reload completes before subsequent edits");
  await complete(false);
  await toggleOption(false, "hideUnresolved");
  await complete(false);
  await evaluate("app.workspace.flushLayout()");
  assert.deepEqual((await stored()).futureExternal, external.futureExternal);
  assert.equal(await evaluate(`document.querySelector('${pane(false)} [data-graph-error]').textContent`), "");
  await evaluate("app.workspace.saveAll()");
  await writeFile(join(directory, renamed), betaText + "a".repeat(100000) + "!\r\n");
  await evaluate("app.metadataCache.refresh()");
  await fill(option(false, "search"), "/(a+)+$/");
  await press("Enter", "Enter", 13);
  await wait(`document.querySelector('${pane(false)} [data-graph-status]')?.textContent.includes("three-second limit")`, "bounded Graph worker query");
  assert.equal(await evaluate(`document.querySelector('${pane(false)} [data-graph-status]').classList.contains("is-error")`), true);
  await filter(false, initial.search);
  await writeFile(join(directory, renamed), betaText);
  await evaluate("app.metadataCache.refresh()");
  await complete(false);
  pass("Malformed and excessive Graph queries fail visibly off the UI thread; stale configuration writes retain external bytes and Reload controls permits guarded subsequent saves.");

  await reveal(true);
  await evaluate('app.commands.execute("workspace:toggle-pin")');
  await filter(true, 'path:"Graph workflows"');
  await setNumber(true, "localJumps", 2);
  await evaluate("app.workspace.flushLayout()");
  const localState = await evaluate(`app.workspace.getLeafById(${JSON.stringify(localId)}).getViewState()`);
  const globalState = await evaluate(`app.workspace.getLeafById(${JSON.stringify(globalId)}).getViewState()`);
  await toggle(false);
  assert.equal(await evaluate(`!app.commands.listCommands().some(command=>command.id==="graph:open")&&!document.querySelector("[data-core-ribbon=graph]")&&!document.querySelector("[data-graph-view]")`), true);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(localId)}).view.getViewType()`), "unavailable");
  await toggle(true);
  await complete(false);
  await complete(true);
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(localId)}).getViewState()`), localState);
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(globalId)}).getViewState()`), globalState);
  await evaluate("app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload", { ignoreCache: true }); }
  await afterReload();
  await complete(false);
  await complete(true);
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(localId)}).getViewState()`), localState);
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(globalId)}).getViewState()`), globalState);
  assert.deepEqual(await optionalRead(join(directory, ".obsidian", "workspace.json")), originalWorkspace);
  assert.deepEqual((await stored()).futureSetting, initial.futureSetting);
  assert.deepEqual((await stored()).futureExternal, external.futureExternal);
  pass("Graph disable/re-enable removes and restores owned commands/ribbon/views; global controls, local depth/pin/file and both cameras survive a full restart or folder-handle reconnect without rewriting the original Obsidian workspace.");
  accept("graph:filter-groups");
  accept("graph:settings");
}
