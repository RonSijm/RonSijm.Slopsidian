/**
 * Test-only scenario for a REAL Windows mouse drag of one live dirty tab between owned BrowserWindows (main<->popout and
 * popout<->popout). Every expression runs on the main target (returnByValue, primitive JSON); element geometry is read through the live
 * element's own window. The caller injects `evaluate`, `press` (real CDP/OS keys sent to the window that owns the leaf) and `saved`;
 * `drag` defaults to the OS mouse driver. `osDragVerified` is true only in a result that came from a real drag, Undo and Save.
 */
import { osMouseDrag } from "./native-os-drag.mjs";

const q = JSON.stringify;

/** Stamp live identity on the main-realm app object and return the baseline. Test-only property; removed by `cleanupExpression`. */
export function stampExpression(leafId) {
  return `(() => {
    const leaf = app.workspace.getLeafById(${q(leafId)});
    if (!leaf) { return JSON.stringify({ error: "leaf not found" }); }
    const view = leaf.view, cm = view.editor?.cm ?? null;
    app.__osDragProbe = { leaf, view, cm, pinned: leaf.pinned, text: view.editor?.getValue?.() ?? null };
    return JSON.stringify({ root: leaf.getRoot().id, dirty: Boolean(view.hasUnsavedChanges), hasEditor: Boolean(cm), pinned: leaf.pinned });
  })()`;
}

export function cleanupExpression() { return "(() => { delete app.__osDragProbe; return \"ok\"; })()"; }

/** Viewport measurement of the source tab header and of the target group header in CSS pixels, plus each window's own title/inner size/dpr. */
export function geometryExpression({ leafId, groupId }) {
  return `(() => {
    const ws = app.workspace, leaf = ws.getLeafById(${q(leafId)}), group = ws.groups().find(item => item.id === ${q(groupId)});
    if (!leaf || !group) { return JSON.stringify({ error: "leaf or group not found" }); }
    const info = element => {
      const win = element.ownerDocument.defaultView, r = element.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height,
        inner: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio }, title: element.ownerDocument.title };
    };
    return JSON.stringify({ sourceRoot: leaf.getRoot().id, targetRoot: group.getRoot().id, source: info(leaf.tabHeaderEl), target: info(group.headerEl) });
  })()`;
}

/** Same-object identity plus root and the dirty/pin state, compared against the stamp. */
export function verifyExpression({ leafId, groupId }) {
  return `(() => {
    const probe = app.__osDragProbe, ws = app.workspace, leaf = ws.getLeafById(${q(leafId)}), group = ws.groups().find(item => item.id === ${q(groupId)});
    if (!probe || !leaf) { return JSON.stringify({ error: "probe or leaf missing" }); }
    return JSON.stringify({ root: leaf.getRoot().id, sameLeaf: leaf === probe.leaf, sameView: leaf.view === probe.view,
      sameEditorView: (leaf.view.editor?.cm ?? null) === probe.cm, pinned: leaf.pinned === probe.pinned, parentIsTarget: leaf.parent === group,
      dirty: Boolean(leaf.view.hasUnsavedChanges), text: leaf.view.editor?.getValue?.() ?? null, stamped: probe.text,
      connected: Boolean(leaf.tabHeaderEl.isConnected) });
  })()`;
}

export function assertMoved(raw, { expectRoot, baseline, label }) {
  const r = JSON.parse(raw);
  const bad = [];
  if (r.error) { bad.push(r.error); }
  else {
    for (const k of ["sameLeaf", "sameView", "sameEditorView", "pinned", "parentIsTarget", "connected"]) { if (r[k] !== true) { bad.push(`${k}=${r[k]}`); } }
    if (r.root !== expectRoot) { bad.push(`root=${r.root} expected ${expectRoot}`); }
    if (r.root === baseline.root) { bad.push("tab did not change windows"); }
    if (r.dirty !== baseline.dirty) { bad.push(`dirty=${r.dirty} expected ${baseline.dirty}`); }
    if (r.text !== r.stamped) { bad.push("document text changed across the move"); }
  }
  if (bad.length) { throw new Error(`${label} failed: ${bad.join(", ")}`); }
  return r;
}

/**
 * Run one OS drag hop. `titles` maps a root id to the unique native window title; `pid` is the exact owned Electron process.
 * Throws on any mismatch (the OS driver releases a held button in its own finally).
 */
export async function osDragHop({ evaluate, waitFor, drag = osMouseDrag, pid, titles, leafId, groupId, expectRoot, label, stamped, hopCheck }) {
  if (typeof waitFor !== "function") { throw new Error(`${label}: a bounded predicate wait (waitFor) is required.`); }
  const baseline = stamped ?? JSON.parse(await evaluate(stampExpression(leafId)));
  if (baseline.error || !baseline.hasEditor) { throw new Error(`${label}: ${baseline.error ?? "leaf has no live editor"}`); }
  if (baseline.dirty !== true) { throw new Error(`${label}: the dragged editor must actually be dirty for the dirty-preservation scope.`); }
  const geo = JSON.parse(await evaluate(geometryExpression({ leafId, groupId })));
  if (geo.error) { throw new Error(`${label}: ${geo.error}`); }
  if (geo.targetRoot !== expectRoot) { throw new Error(`${label}: target group is in ${geo.targetRoot}, expected ${expectRoot}`); }
  const sourceTitle = titles[geo.sourceRoot], targetTitle = titles[geo.targetRoot];
  if (!sourceTitle || !targetTitle || sourceTitle === targetTitle) { throw new Error(`${label}: windows are unmapped or ambiguous`); }
  if (geo.source.title !== sourceTitle || geo.target.title !== targetTitle) { throw new Error(`${label}: document titles do not match the native window titles`); }
  const pre = hopCheck ? await hopCheck.before() : undefined;
  let native;
  try { native = await drag({ pid, sourceTitle, targetTitle, from: geo.source, to: geo.target, sourceInner: geo.source.inner, targetInner: geo.target.inner }); }
  catch (error) {
    const wrapped = new Error(`${label}: ${error.message}`, { cause: error });
    wrapped.diagnostics = { label, sourceTitle, targetTitle, geometry: geo, native: error.diagnostics ?? null };
    throw wrapped;
  }
  // the DOM/model ownership settles asynchronously after the real drop: use the runner's bounded wait, keep the last failure for the report
  let after = null, lastError = null;
  try {
    await waitFor(async () => {
      try { after = assertMoved(await evaluate(verifyExpression({ leafId, groupId })), { expectRoot, baseline, label }); return true; }
      catch (error) { lastError = error; return false; }
    }, label);
  } catch (waitError) {
    throw new Error(`${lastError?.message ?? waitError.message} (wait: ${waitError.message})`, { cause: waitError });
  }
  if (!after) { throw lastError ?? new Error(`${label}: ownership never settled`); }
  // extra product-state assertions (pin/link group/selected siblings) run after ownership settled; they may also need the bounded wait
  const extra = hopCheck ? await hopCheck.after(pre) : undefined;
  return { label, baseline, geometry: geo, native, after, extra };
}

/** Each hop is a real OS drag; then real Undo and Save are sent to the window that now owns the leaf. */
export async function runOsDragChain({ evaluate, waitFor, press, saved, drag, pid, titles, leafId, hops, redo = false, redoKey = "Ctrl+Y" }) {
  const realDriver = drag === undefined;
  const evidence = [];
  const last = hops.at(-1);
  try {
    // one stamp for the whole chain, so identity is compared with the original leaf/view/CodeMirror, not the previous hop
    let stamped = JSON.parse(await evaluate(stampExpression(leafId)));
    if (stamped.error || !stamped.hasEditor) { throw new Error(stamped.error ?? "leaf has no live editor"); }
    if (stamped.dirty !== true) { throw new Error("The dragged editor must actually be dirty for the dirty-preservation scope."); }
    for (const hop of hops) {
      const hopEvidence = await osDragHop({ evaluate, waitFor, drag, pid, titles, leafId, groupId: hop.groupId, expectRoot: hop.expectRoot, label: hop.label, stamped, hopCheck: hop.check });
      evidence.push(hopEvidence);
      stamped = { ...stamped, root: hopEvidence.after.root };
    }
    const owner = JSON.parse(await evaluate(verifyExpression({ leafId, groupId: last.groupId }))).root;
    const textNow = async () => JSON.parse(await evaluate(verifyExpression({ leafId, groupId: last.groupId }))).text;
    const stampedText = JSON.parse(await evaluate(verifyExpression({ leafId, groupId: last.groupId }))).stamped;
    await press(owner, "Ctrl+Z");
    await waitFor(async () => (await textNow()) !== stampedText, "real Undo after the final move changed the document");
    if (redo) {
      await press(owner, redoKey);
      await waitFor(async () => (await textNow()) === stampedText, "real Redo restored the pre-undo document");
    }
    await press(owner, "Ctrl+S");
    if (!(await saved(leafId))) { throw new Error("Real Save after the final move did not persist."); }
    return { hops: evidence, undoChanged: true, redoRestored: Boolean(redo), saved: true, osDragVerified: realDriver, ...(realDriver ? {} : { mockDriver: true }) };
  } finally {
    await evaluate(cleanupExpression());
  }
}
