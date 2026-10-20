/**
 * Reusable real-host scenario: drag one dirty, pinned, linked editor tab with the REAL Windows mouse main -> popout1 -> popout2 -> main,
 * then prove real Undo/Redo/Save and retained leaf/view/CodeMirror identity, pin, link group and source-group selected siblings.
 *
 * Isolated from the shared runners: the caller supplies { directory, evaluate, command, wait, targets, connect, until, pid, report }
 * exactly like checkWorkspaceGroupsPopouts. Only windows owned by the exact `pid` and carrying this run's unique titles are arranged
 * or driven; everything the fixture created (vault folder, layout, windows, titles, autosave state, CDP sessions) is restored in `finally`.
 * `osDragVerified` is true only when the real OS driver executed every hop.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { osMouseDrag } from "./native-os-drag.mjs";
import { runOsDragChain } from "./native-os-drag-scenario.mjs";
import { arrangeOwnedWindows, prepareOwnedZOrder, restoreOwnedZOrder } from "./native-window-layout.mjs";

const q = JSON.stringify;
const KEYS = { "Ctrl+Z": ["z", "KeyZ", 90], "Ctrl+Y": ["y", "KeyY", 89], "Ctrl+S": ["s", "KeyS", 83] };
const FATAL_LAYOUT = /cannot fit|not a measured|overlap|not inside|distinct non-empty|process id|Ambiguous window match|same window|measured window record|measured DPI|GetWindowRect failed/;

export async function checkWorkspaceOsTabDrag({ directory, evaluate, command, wait, targets, connect, until, pid, report, os = {} }) {
  assert.ok([evaluate, command, wait, targets, connect, until].every(fn => typeof fn === "function"), "the runner must supply evaluate/command/wait/targets/connect/until");
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "the exact owned Electron process id is required");
  assert.ok(report && Array.isArray(report.checks), "a report with a checks array is required");
  const drag = os.drag, arrange = os.arrange ?? arrangeOwnedWindows;
  // real z-order preparation unless the arrangement is injected without an explicit z-order hook
  const zorder = os.zorder ?? (os.arrange ? null : { prepare: prepareOwnedZOrder, restore: restoreOwnedZOrder });
  let zPrepared = null;
  const stamp = Date.now();
  const folder = `OS drag ${stamp}`, file = name => `${folder}/${name}.md`;
  const titles = { main: `slopsidian-osdrag-main-${stamp}`, win1: `slopsidian-osdrag-pop1-${stamp}`, win2: `slopsidian-osdrag-pop2-${stamp}` };
  const leafExpr = id => `app.workspace.getLeafById(${q(id)})`;
  const cm = `${leafExpr("osd-drag")}.view.editor.cm`;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };

  const prior = {
    layout: await evaluate("JSON.stringify(app.workspace.getLayout())"),
    autosave: await evaluate("Boolean(app.markdownAutosave.enabled)"),
    title: await evaluate("document.title"),
    windows: Number(await evaluate("app.workspace.windows.length")),
  };
  const popups = new Map();
  let ownedWindowIds = [];
  let failure;
  try {
    await evaluate("(async()=>{await app.markdownAutosave.setEnabled(false);return true})()");
    await mkdir(join(directory, folder), { recursive: true });
    for (const name of ["Drag", "Sib1", "Sib2", "Anchor1", "Anchor2"]) { await writeFile(join(directory, file(name)), `# ${name}\n\n${name} body\n`); }
    // No reload happens here, so wait for the watcher to put the fresh files into the live vault inventory.
    const inventory = ["Drag", "Sib1", "Sib2", "Anchor1", "Anchor2"].map(file);
    await wait(`${q(inventory)}.every(p=>Boolean(app.vault.getAbstractFileByPath(p)))`, "fixture files present in the live vault inventory");
    const leaf = (id, name, extra = {}) => ({ id, type: "leaf", state: { type: "markdown", state: { file: file(name), mode: "source", source: true }, ...extra } });
    const main = { id: "osd-main", type: "split", direction: "vertical", children: [
      { id: "osd-tabs", type: "tabs", currentTab: 0, children: [leaf("osd-sib1", "Sib1"), leaf("osd-drag", "Drag", { pinned: true }), leaf("osd-sib2", "Sib2")] },
      { id: "osd-anchors", type: "tabs", currentTab: 0, children: [leaf("osd-anchor1", "Anchor1"), leaf("osd-anchor2", "Anchor2")] },
    ] };
    await evaluate(`(async()=>{const v=app.workspace.getLayout();v.main=${q(main)};v.active="osd-sib1";await app.workspace.changeLayout(v)})()`);
    await evaluate("(async()=>{await app.workspace.whenIdle();return true})()");
    await wait("!app.workspace.isChangingLayout&&!app.workspace.isChangingFiles", "workspace settled");
    await wait(`${leafExpr("osd-drag")}.pinned===true&&Boolean(${cm})`, "drag fixture leaf is a live pinned editor");
    await evaluate(`(()=>{app.workspace.linkLeaves([${leafExpr("osd-drag")},${leafExpr("osd-sib2")}]);return true})()`);
    const linkGroup = await evaluate(`app.workspace.getGroup(${leafExpr("osd-drag")})`);
    assert.ok(linkGroup, "the dragged leaf belongs to a link group");

    // Two genuine popouts, each seeded with an anchor tab so its target group stays alive after the dragged tab leaves.
    const popout = async (anchor, key, title) => {
      const known = new Set((await targets()).map(item => item.id));
      await evaluate(`(()=>{app.workspace.popoutLeaf(${leafExpr(anchor)});return true})()`);
      await wait(`${leafExpr(anchor)}.getRoot()!==app.workspace.rootSplit&&Boolean(${leafExpr(anchor)}.getRoot().surface)&&!${leafExpr(anchor)}.getRoot().surface.isClosed()`, `${key} popout opened`);
      let target;
      await until(async () => { target = (await targets()).find(item => item.type === "page" && !known.has(item.id) && !/^http/.test(item.url)); return target; }, `${key} popout CDP target`);
      const session = await connect(target, until);
      const root = await evaluate(`${leafExpr(anchor)}.getRoot().id`);
      await session.evaluate(`document.title=${q(title)}`);
      popups.set(root, session);
      ownedWindowIds.push(root);
      return { root, groupId: await evaluate(`${leafExpr(anchor)}.parent.id`) };
    };
    const pop1 = await popout("osd-anchor1", "popout1", titles.win1);
    const pop2 = await popout("osd-anchor2", "popout2", titles.win2);
    await evaluate(`document.title=${q(titles.main)}`);
    const mainRoot = await evaluate(`${leafExpr("osd-drag")}.getRoot().id`);
    assert.equal(new Set([mainRoot, pop1.root, pop2.root]).size, 3, "three distinct window roots");
    const rootTitles = { [mainRoot]: titles.main, [pop1.root]: titles.win1, [pop2.root]: titles.win2 };
    pass("two genuine popouts with anchor tabs and unique native titles were created");

    // Arrange only these three exact PID/title windows into non-overlapping positions before any endpoint is measured.
    let arrangement, lastError;
    try {
      await until(async () => {
        try { arrangement = await arrange({ pid, titles: [titles.main, titles.win1, titles.win2] }); return true; }
        catch (error) { if (error.diagnostics) { (report.osDragLayoutAttempts ??= []).push({ error: error.message, ...error.diagnostics }); report.osDragLayoutDiagnostics = error.diagnostics; } if (FATAL_LAYOUT.test(error.message)) { throw error; } lastError = error; return false; }
      }, "owned windows arranged without overlap");
    } catch (error) { throw FATAL_LAYOUT.test(error.message) ? error : (lastError ?? error); }
    const innerExpr = `JSON.stringify([window,${leafExpr("osd-anchor1")}.getRoot().surface.window,${leafExpr("osd-anchor2")}.getRoot().surface.window].map(w=>[w.innerWidth,w.innerHeight,w.devicePixelRatio]))`;
    let previous = null;
    await until(async () => { const now = await evaluate(innerExpr); const stable = previous === now; previous = now; return stable; }, "arranged window viewports settled");
    report.osDragLayoutDiagnostics = arrangement;
    pass("the exact owned windows were arranged without overlap inside the monitor work area");

    // Once, before any OS input: raise only these exact owned windows so a foreign foreground window cannot cover them. Guards stay in the driver.
    if (zorder) {
      try { zPrepared = await zorder.prepare({ pid, titles: [titles.main, titles.win1, titles.win2] }); } catch (error) { report.osDragZOrder = { prepared: error.prepared ?? null, prepareFailed: true }; throw error; }
      report.osDragZOrder = { prepared: zPrepared };
      pass("the exact owned windows were raised above unrelated windows (prior topmost state recorded for restore)");
    }

    // Seed dirty text and two distinct history events through the product editor (no OS involvement yet).
    const original = await evaluate(`${cm}.state.doc.toString()`);
    const afterOne = await evaluate(`(()=>{const e=${cm};e.dispatch({changes:{from:e.state.doc.length,insert:" one"},userEvent:"input.type"});return e.state.doc.toString()})()`);
    const seeded = await evaluate(`(()=>{const e=${cm};e.dispatch({changes:{from:e.state.doc.length,insert:" two"},userEvent:"input.paste"});return e.state.doc.toString()})()`);
    assert.ok(seeded.endsWith(" one two") && afterOne === original + " one");
    await wait(`${leafExpr("osd-drag")}.view.isDirty===true`, "the dragged editor is dirty");

    const press = async (root, name) => {
      const session = root === mainRoot ? { command } : popups.get(root);
      assert.ok(session && KEYS[name], `no real key session for ${root}/${name}`);
      const [key, code, vk] = KEYS[name];
      await evaluate(`(()=>{${cm}.focus();return true})()`);
      await wait(`${cm}.contentDOM.ownerDocument.activeElement===${cm}.contentDOM`, "editor focused in its current window");
      await session.command("Page.bringToFront");
      await session.command("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: 2 });
      await session.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: 2 });
      if (name === "Ctrl+Z") { await wait(`${cm}.state.doc.toString()===${q(afterOne)}`, "one real Undo reverted exactly the last history event"); }
    };
    const saved = async () => {
      await wait(`${leafExpr("osd-drag")}.view.isDirty===false`, "real Save cleared dirty");
      return (await readFile(join(directory, file("Drag")), "utf8")) === seeded;
    };

    // Per-hop product state: link group, source selected sibling/order and the target's existing tabs.
    const check = targetGroupId => ({
      before: async () => JSON.parse(await evaluate(`(()=>{const w=app.workspace,l=${leafExpr("osd-drag")},g=l.parent,sel=g.children[g.currentTab];
        const target=w.groups().find(x=>x.id===${q(targetGroupId)});
        return JSON.stringify({sourceGroup:g.id,selected:sel===l?null:sel.id,siblings:g.children.filter(c=>c!==l).map(c=>c.id),link:w.getGroup(l)??null,targetTabs:target.children.map(c=>c.id)})})()`)),
      after: async pre => {
        assert.equal(pre.link, linkGroup, "the link group was intact before the hop");
        const raw = JSON.parse(await evaluate(`(()=>{const w=app.workspace,l=${leafExpr("osd-drag")},first=pre=>w.getLeafById(pre),s=first(${q(pre.siblings[0] ?? "")});
          const g=s?s.parent:null;
          return JSON.stringify({link:w.getGroup(l)??null,pinned:l.pinned,partner:w.getGroup(${leafExpr("osd-sib2")}),sourceGroup:g?g.id:null,
            selected:g?(g.children[g.currentTab]?.id??null):null,siblings:g?g.children.map(c=>c.id):[],targetTabs:l.parent.children.map(c=>c.id)})})()`));
        assert.equal(raw.link, linkGroup, "the link group was retained");
        assert.equal(raw.partner, linkGroup, "the linked partner stayed in the group");
        assert.equal(raw.pinned, true, "the pin was retained");
        assert.equal(raw.sourceGroup, pre.sourceGroup, "the source tab group survived");
        assert.deepEqual(raw.siblings, pre.siblings, "source siblings kept their order and identity");
        if (pre.selected) { assert.equal(raw.selected, pre.selected, "the selected sibling in the source group stayed selected"); }
        for (const id of pre.targetTabs) { assert.ok(raw.targetTabs.includes(id), `the target group kept ${id}`); }
        return raw;
      },
    });

    const result = await runOsDragChain({
      evaluate, waitFor: until, press, saved, drag, pid, titles: rootTitles, leafId: "osd-drag", redo: true,
      hops: [
        { groupId: pop1.groupId, expectRoot: pop1.root, label: "main -> popout1", check: check(pop1.groupId) },
        { groupId: pop2.groupId, expectRoot: pop2.root, label: "popout1 -> popout2", check: check(pop2.groupId) },
        { groupId: "osd-tabs", expectRoot: mainRoot, label: "popout2 -> main", check: check("osd-tabs") },
      ],
    });
    report.osDrag = { arrangement, titles, hops: result.hops, undoChanged: result.undoChanged, redoRestored: result.redoRestored, saved: result.saved, mockDriver: Boolean(result.mockDriver) };
    report.osDragVerified = result.osDragVerified;
    assert.equal(drag === undefined, result.osDragVerified, "osDragVerified must reflect that the real OS driver ran");
    pass(result.osDragVerified
      ? "real OS mouse drags moved one dirty live leaf main->popout1->popout2->main with identity, pin, link group and siblings retained, plus real Undo/Redo/Save"
      : "injected-driver run of the OS drag scenario (NOT OS-verified)");
    return result;
  } catch (error) {
    if (error.diagnostics) { report.osDragFailure = { message: error.message, ...error.diagnostics }; }
    failure = error;
    throw error;
  } finally {
    const cleanup = [];
    const attempt = async (what, fn) => { try { await fn(); } catch (error) { cleanup.push(`${what}: ${error.message}`); } };
    if (zorder && zPrepared) { await attempt("restore window z-order", async () => { report.osDragZOrder.restored = await zorder.restore(zPrepared); }); }
    for (const session of popups.values()) { await attempt("close popup session", async () => session.socket?.close()); }
    await attempt("return fixture windows", async () => {
      await evaluate(`(()=>{const ids=${q(ownedWindowIds)};for(const w of app.workspace.windows.slice()){if(ids.includes(w.id)){app.workspace.returnWindow(w)}}return true})()`);
      await wait(`app.workspace.windows.length===${prior.windows}`, "fixture windows returned");
    });
    await attempt("restore layout", async () => { await evaluate(`(async()=>{await app.workspace.changeLayout(${prior.layout});return true})()`); await wait("!app.workspace.isChangingLayout", "layout restored"); });
    await attempt("restore title", async () => evaluate(`document.title=${q(prior.title)}`));
    await attempt("restore autosave", async () => evaluate(`(async()=>{await app.markdownAutosave.setEnabled(${prior.autosave});return true})()`));
    await attempt("remove fixture folder", async () => rm(join(directory, folder), { recursive: true, force: true }));
    if (cleanup.length) {
      report.osDragCleanupErrors = cleanup;
      const cleanupError = new Error(`OS drag fixture cleanup failed: ${cleanup.join("; ")}`);
      if (failure) { throw new AggregateError([failure, cleanupError], `${failure.message}; ${cleanupError.message}`); }
      throw cleanupError;
    }
  }
}
