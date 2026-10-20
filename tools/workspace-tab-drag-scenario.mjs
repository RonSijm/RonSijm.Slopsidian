/**
 * Reusable real-host helper for cross-window tab moves. It drives the product's own drag listeners with real DragEvent/DataTransfer
 * objects from each document's realm and then reads back the live identity. It is NOT an OS drag-and-drop proof: pointer-level
 * Windows DnD between BrowserWindows must be reported separately and is never implied by this helper.
 */

/** Page expression (main-realm Runtime.evaluate, returnByValue) that moves one leaf by dragging its header onto a group header. */
export function tabDragExpression({ leafId, groupId }) {
  return `(() => {
    const ws = app.workspace, leaf = ws.getLeafById(${JSON.stringify(leafId)}), group = ws.groups().find(item => item.id === ${JSON.stringify(groupId)});
    if (!leaf || !group) { return JSON.stringify({ error: "leaf or group not found" }); }
    const view = leaf.view, cm = view.editor?.cm ?? null, pinned = leaf.pinned, dirty = Boolean(view.hasUnsavedChanges), rootBefore = leaf.getRoot().id;
    const header = leaf.tabHeaderEl, from = header.ownerDocument.defaultView, to = group.headerEl.ownerDocument.defaultView;
    const transfer = new from.DataTransfer();
    const fire = (target, win, type) => { const event = new win.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 4, clientY: 4 }); target.dispatchEvent(event); return event.defaultPrevented; };
    const started = !fire(header, from, "dragstart");
    const accepted = started && fire(group.headerEl, to, "dragover");
    if (accepted) { fire(group.headerEl, to, "drop"); }
    fire(header, from, "dragend");
    const after = ws.getLeafById(${JSON.stringify(leafId)});
    return JSON.stringify({ started, accepted, rootBefore, rootAfter: after?.getRoot().id ?? null, parentIsTarget: after?.parent === group,
      sameLeaf: after === leaf, sameView: after?.view === view, sameEditorView: (after?.view.editor?.cm ?? null) === cm,
      pinned: after?.pinned === pinned, dirty: Boolean(after?.view.hasUnsavedChanges) === dirty, headerConnected: Boolean(header.isConnected),
      headerInTargetDocument: header.ownerDocument === group.headerEl.ownerDocument });
  })()`;
}

/** Throws unless the result proves one genuine, state-preserving move into the expected root. */
export function assertTabDragResult(raw, { expectRoot, label = "tab drag" }) {
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  const failures = [];
  if (result?.error) { failures.push(result.error); }
  else {
    for (const key of ["started", "accepted", "parentIsTarget", "sameLeaf", "sameView", "sameEditorView", "pinned", "dirty", "headerConnected", "headerInTargetDocument"]) { if (result?.[key] !== true) { failures.push(`${key}=${result?.[key]}`); } }
    if (result?.rootAfter !== expectRoot) { failures.push(`rootAfter=${result?.rootAfter} (expected ${expectRoot})`); }
    if (result?.rootBefore === result?.rootAfter) { failures.push("the tab did not change windows"); }
  }
  if (failures.length) { throw new Error(`${label} failed: ${failures.join(", ")}`); }
  return { label, ...result, osDragVerified: false };
}
