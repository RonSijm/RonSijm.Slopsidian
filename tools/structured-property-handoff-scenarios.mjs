import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, folder = "Properties Source handoff", path = folder + "/Source.md", other = folder + "/Other.md";
const main = "properties-handoff-main", side = "properties-handoff-side", peer = "properties-handoff-peer";
const pane = id => `[data-leaf-id=${q(id)}]`, row = id => pane(id) + ' [data-property-key="opaque"]';
const control = (id, name) => row(id) + ` [data-property-structured-${name}]`;
const sourceChoice = (id, kind, target) => row(id) + ' [data-property-structured-source=' + q(JSON.stringify({ kind, path: target })) + ']';
const ordinary = (id, kind, target) => row(id) + ` [data-property-structured-${kind}=` + q(JSON.stringify(target)) + ']';
const status = id => pane(id) + " [data-property-structured-handoff-status]", error = id => row(id) + " .metadata-property-error";
const source = `app.workspace.getLeavesOfType("markdown").map(leaf=>leaf.view).find(view=>view.file?.path===${q(path)})`;
const peerView = `app.workspace.getLeafById(${q(peer)}).view`, session = `app.workspace.sessions.get(${q(path)})`;
const bytes = (text, bom = true) => Buffer.from((bom ? "\ufeff" : "") + text), sha = raw => createHash("sha256").update(raw).digest("hex");
const original = ["---", "# Explicit closed-note review λ", "untouched: >- # keep folded text", "  Exact first", "  wrapped 😀", "opaque:", "  map:", "    count: 1.50 # preserve numeric spelling", "    enabled: true # retain boolean", "    empty: ~ # explicit null", "    text: '<img src=x> λ 😀' # inert text", "  implicit: # implicit null stays Source-only", "  list:", "    - one # retain first", "    - { child: value } # removable subtree", "    - false # retain last", "  flow: { a: 1, b: 2 } # retain flow", "  emptyMap: {}", "  emptyList: []", "  sourceOnly: { a: 1, # ambiguous separator ownership", "    b: 2 } # ambiguous comments stay Source-only", "single: Plain", "anchored: &shared { retained: exact }", "aliased: *shared", "---", "# Source handoff λ", "", "Untouched body 😀.", ""].join("\r\n");
const peerText = "# Earlier peer λ\r\n\r\nExact peer 😀.\r\n";
export const structuredPropertyHandoffReadOnlyFixture = Object.freeze({ source: original, files: [] });
const snapshot = 'app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,bom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const expectedOwnerRefusal = "The note or nested property owner changed. Cancel this draft and review the current source before applying it.";
/** Deliberate refusal probes may consume only their exact owned rejection. */
export function assertStructuredHandoffRefusal(outcomes) {
  assert.ok(Array.isArray(outcomes) && outcomes.length > 0, "captured real tracked queue is required");
  assert.equal(outcomes.filter(outcome => outcome.expected === true).length, 1, "exactly one owned frontmatter promise must be identified");
  for (const outcome of outcomes) {
    assert.equal(outcome.status, outcome.expected ? "rejected" : "fulfilled", "only the deliberate owned operation may reject: " + String(outcome.reason));
    if (outcome.expected) assert.equal(outcome.reason, expectedOwnerRefusal, "the deliberate rejection must be the exact Source owner guard");
  }
}

async function key(tools, value, code = value, number = value === "Enter" ? 13 : value === "Escape" ? 27 : value === "Tab" ? 9 : 65, modifiers = 0) {
  const event = { key: value, code, windowsVirtualKeyCode: number, nativeVirtualKeyCode: number, modifiers };
  await tools.command("Input.dispatchKeyEvent", { type: value === "Enter" && !modifiers ? "keyDown" : "rawKeyDown", ...event, ...(value === "Enter" && !modifiers ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}
async function fill(tools, selector, value) { await tools.click(selector); await key(tools, "a", "KeyA", 65, 2); if (value) await tools.command("Input.insertText", { text: value }); else await key(tools, "Backspace", "Backspace", 8); }
async function choose(tools, selector, value) {
  const index = await tools.evaluate(`(()=>{const n=document.querySelector(${q(selector)});n.scrollIntoView({block:'center',inline:'nearest'});n.focus();return [...n.options].findIndex(option=>option.value===${q(value)})})()`);
  assert.ok(index >= 0); await key(tools, "Home", "Home", 36);
  for (let i = 0; i < index; i++) { await tools.evaluate(`document.querySelector(${q(selector)}).focus()`); await key(tools, "ArrowDown", "ArrowDown", 40); }
  await key(tools, "Tab", "Tab", 9); await tools.wait(`document.querySelector(${q(selector)})?.value===${q(value)}`, "trusted Properties scalar type selection");
}
async function reveal(tools, selector) {
  await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "current Source handoff choice exists");
  while (await tools.evaluate(`(()=>{for(const n of document.querySelectorAll('[data-properties-handoff-disclosure]'))delete n.dataset.propertiesHandoffDisclosure;const a=[];for(let n=document.querySelector(${q(selector)});n;n=n.parentElement)if(n.tagName==='DETAILS'&&!n.open)a.unshift(n);if(!a.length)return false;a[0].dataset.propertiesHandoffDisclosure='open';return true})()`)) await tools.click('details[data-properties-handoff-disclosure="open"] > summary');
}
async function frame(tools, selectors) {
  const framed = [];
  for (const selector of selectors) {
    const result = await tools.evaluate(`(()=>{const n=document.querySelector(${q(selector)});if(!n)return null;n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{selector:${q(selector)},left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:n.checkVisibility(),reachable:hit===n||n.contains(hit),inViewport:x>=0&&x<=innerWidth&&y>=0&&y<=innerHeight}})()`);
    assert.ok(result?.visible && result.width > 0 && result.height > 0 && result.inViewport && result.reachable, "framed real handoff control: " + selector); framed.push(result);
  }
  return framed;
}
function handoffNoticeGeometry(selector) {
  const target = document.querySelector(selector);
  if (!target) return null;
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const area = { ...rect(target), visible: target.checkVisibility() }, notices = [...document.querySelectorAll(".notice")].map(node => ({ text: node.textContent, ...rect(node) }));
  return { target: area, notices, overlapping: notices.filter(notice => notice.width > 0 && notice.height > 0 && notice.left < area.right && notice.right > area.left && notice.top < area.bottom && notice.bottom > area.top) };
}
async function uncovered(tools, selector, mode, record = true) {
  const expression = `(${handoffNoticeGeometry.toString()})(${q(selector)})`;
  await tools.wait(`(async()=>{const clear=()=>{const p=${expression};return p!==null&&p.target.visible&&p.target.width>0&&p.target.height>0&&p.notices.length===0&&p.overlapping.length===0};if(!clear())return false;await new Promise(resolve=>requestAnimationFrame(resolve));return clear()})()`, "temporary notice nodes are gone across a real frame before the actual Properties capture");
  const proof = await tools.evaluate(expression);
  assert.ok(proof && proof.target.visible && proof.target.width > 0 && proof.target.height > 0); assert.equal(proof.notices.length, 0); assert.equal(proof.overlapping.length, 0);
  if (record) (tools.report.propertiesHandoffNoticeFrames ??= []).push({ mode, selector, ...proof });
}
/** Runs in the real host DOM; measured word fragments detect the former
 * one-letter wrapping even when a control has a reachable nonzero rectangle. */
function handoffReadabilityGeometry(options) {
  const required = selector => { const node = document.querySelector(selector); if (!node) throw Error("Missing handoff geometry target: " + selector); return node; };
  const box = node => {
    const r = node.getBoundingClientRect(), css = getComputedStyle(node), padding = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, innerWidth: node.clientWidth - padding, visible: node.checkVisibility() };
  };
  const words = node => {
    const result = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.parentElement.closest("select,option,textarea")) continue;
      for (const match of text.data.matchAll(/\S+/gu)) {
        const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
        const fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }));
        const area = node.getBoundingClientRect(), tops = fragments.map(rect => rect.top);
        result.push({ text: match[0], fragments, whole: fragments.length > 0 && Math.max(...tops) - Math.min(...tops) < 1, contained: fragments.length > 0 && fragments.every(rect => rect.left >= area.left - 1 && rect.right <= area.right + 1) });
      }
    }
    return result;
  };
  const target = required(options.pane), metadata = required(options.pane + " .metadata-container"), property = required(options.row), editor = required(options.apply).closest(".metadata-structured-editor"), value = required(options.value), apply = required(options.apply), cancel = required(options.cancel), list = required(options.pane + " .properties-pane-list");
  const sourceView = required(options.source + " .markdown-view-content"), sourceTitle = required(options.source + " .inline-title"), sourceBody = required(options.source + " .cm-content"), sourceEditor = required(options.source + " .markdown-source-view");
  let type = null;
  if (options.type) {
    const node = required(options.type), css = getComputedStyle(node), canvas = document.createElement("canvas"), context = canvas.getContext("2d"); context.font = css.font;
    const selectedText = node.selectedOptions[0].textContent;
    type = { ...box(node), selectedText, selectedTextWidth: context.measureText(selectedText).width, arrowAllowance: 20, words: words(node.closest("label")) };
  }
  const sourceTitleWords = words(sourceTitle), titleTops = sourceTitleWords.flatMap(word => word.fragments.map(rect => rect.top));
  return {
    pane: box(target), metadata: box(metadata), row: box(property), editor: box(editor), value: { ...box(value), tag: value.tagName, textLength: value.value.length },
    apply: { ...box(apply), text: apply.textContent, words: words(apply) }, cancel: { ...box(cancel), text: cancel.textContent, words: words(cancel) }, type,
    noHorizontalOverflow: list.scrollWidth <= list.clientWidth + 1,
    source: { pane: box(sourceView), title: { ...box(sourceTitle), text: sourceTitle.textContent, words: sourceTitleWords, singleLine: titleTops.length > 0 && Math.max(...titleTops) - Math.min(...titleTops) < 1 }, body: box(sourceBody), normal: sourceEditor.checkVisibility() && sourceBody.isContentEditable },
  };
}
async function readableSplit(tools, id, mode, sourceId) {
  const scalar = mode === "properties-handoff-main-scalar", options = { pane: pane(id), row: row(id), value: control(id, scalar ? "input" : "removal-review"), apply: control(id, "apply"), cancel: control(id, "cancel"), source: pane(sourceId), ...(scalar ? { type: control(id, "type") } : {}) };
  const geometry = await tools.evaluate(`(${handoffReadabilityGeometry.toString()})(${q(options)})`);
  (tools.report.propertiesHandoffGeometry ??= []).push({ mode, ...geometry });
  const whole = field => field.words.length > 0 && field.words.every(word => word.whole && word.contained);
  assert.equal(geometry.apply.text, scalar ? "Apply value" : "Apply removal"); assert.equal(geometry.cancel.text, "Cancel");
  for (const name of ["pane", "metadata", "row", "editor", "value", "apply", "cancel"]) assert.equal(geometry[name].visible, true, mode + " visible " + name);
  assert.ok(whole(geometry.apply) && whole(geometry.cancel), mode + " action words stay whole and within their buttons");
  assert.ok(geometry.value.innerWidth >= Math.min(100, geometry.metadata.width * .75), mode + " field retains a usable inner width within the padded Properties pane");
  assert.equal(geometry.value.tag, scalar ? "INPUT" : "TEXTAREA"); assert.equal(geometry.noHorizontalOverflow, true, mode + " Properties list has no horizontal overflow");
  if (scalar) { assert.equal(geometry.type.selectedText, "Number"); assert.ok(whole(geometry.type)); assert.ok(geometry.type.innerWidth - geometry.type.arrowAllowance >= geometry.type.selectedTextWidth, "selected scalar type fits beside its native arrow"); }
  assert.equal(geometry.source.title.text, "Source"); assert.equal(geometry.source.normal, true); assert.equal(geometry.source.pane.visible, true); assert.equal(geometry.source.title.visible, true); assert.equal(geometry.source.body.visible, true);
  assert.ok(geometry.source.title.singleLine && whole(geometry.source.title), mode + " Source title stays on one line");
  assert.ok(geometry.source.body.innerWidth >= Math.min(160, geometry.source.pane.width * .6), mode + " Source body retains a usable width");
  const proof = tools.report.propertiesHandoffReadability ??= {};
  proof[scalar ? "scalarSplitControlsReadable" : "removalSplitControlsReadable"] = true;
  proof[scalar ? "scalarSplitSourceReadable" : "removalSplitSourceReadable"] = true;
}
async function disabledPointer(tools, selector) { await reveal(tools, selector); const [point] = await frame(tools, [selector]); for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: (point.left + point.right) / 2, y: (point.top + point.bottom) / 2, button: "left", clickCount: 1 }); }
const layout = (id = main) => ({ version: 1, main: { id: "properties-handoff-root", type: "split", direction: "vertical", children: [
  { id: "properties-handoff-peer-tabs", type: "tabs", dimension: 40, currentTab: 0, children: [{ id: peer, type: "leaf", state: { type: "markdown", pinned: true, state: { file: other, mode: "source", source: true } } }] },
  { id: "properties-handoff-main-tabs", type: "tabs", dimension: 60, currentTab: 0, children: [{ id: main, type: "leaf", state: { type: "file-properties", pinned: true, state: { file: path, followActiveFile: false, query: "", sort: "name" } } }] },
] }, right: { width: 390, collapsed: false, root: { id: "properties-handoff-right", type: "split", direction: "horizontal", children: [{ id: "properties-handoff-side-tabs", type: "tabs", currentTab: 0, children: [{ id: side, type: "leaf", state: { type: "file-properties", pinned: true, state: { file: path, followActiveFile: false, query: "", sort: "name" } } }] }] } }, active: id });

/** The parent owns host startup/builds. Positive edits use trusted native input;
 * evaluate observes owners or explicitly sets up/holds independent fault cases. */
export async function checkStructuredPropertyHandoff(tools) {
  const { directory, evaluate, wait, click, command, capture, report, restart, afterReload } = tools;
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const oldLayout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("properties")');
  const configPath = join(directory, ".obsidian/app.json"), configBytes = await readFile(configPath), corePath = join(directory, ".obsidian/core-plugins.json"), coreBytes = await readFile(corePath).catch(issue => { if (issue.code === "ENOENT") return null; throw issue; });
  const config = JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, "")), working = Buffer.from(JSON.stringify({ ...config, markdownAutosave: false }, null, 2));
  const proofs = report.propertiesHandoffProofs = [], physical = report.propertiesHandoffPhysicalVersions = [], captures = report.propertiesHandoffFrames = [];
  let stage = "fixture", failure, traced = false, narrow = false, madeFolder = false, peerDraft = peerText, peerSaved = peerText;
  const refresh = () => evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.whenIdle();await app.core.whenIdle()})()");
  const indexReady = `(()=>{if(app.workspace.notification!==null||app.metadataCache.pending||app.core.busy)return false;return [...app.workspace.sessions].every(([path,s])=>{const e=app.metadataCache.getDocument(path);return e&&!e.missing&&e.text===s.text&&e.document.version===s.document.version&&e.document.content===s.document.content&&(e.document.hasBom===true)===(s.document.hasBom===true)&&e.dirty===s.dirty})})()`;
  const indexingState = `(()=>({notificationPending:app.workspace.notification!==null,metadataPending:Boolean(app.metadataCache.pending),sessions:[...app.workspace.sessions].map(([path,s])=>{const e=app.metadataCache.getDocument(path);return{path,liveText:s.text,indexedText:e?.text,liveVersion:s.document.version,indexedVersion:e?.document.version,liveBom:s.document.hasBom===true,indexedBom:e?.document.hasBom===true,liveDirty:s.dirty,indexedDirty:e?.dirty}})}))()`;
  const settle = async () => {
    const before = await evaluate(indexingState);
    await evaluate("(async()=>{await app.workspace.whenIdle();await app.notifyEditor();if(app.metadataCache.pending)await app.metadataCache.pending;await app.core.whenIdle();await new Promise(resolve=>queueMicrotask(resolve))})()");
    await wait(indexReady, "actual dirty-session metadata and delayed editor notification settle before Source choice");
    (report.propertiesHandoffIndexing ??= []).push({ stage, before, after: await evaluate(indexingState) });
  };
  // Keep the Source owner available until existing queue/index publication is coherent.
  const savedIndexCoherent = `(()=>{const s=${session},e=app.metadataCache.getDocument(${q(path)});return Boolean(e&&!e.missing&&!e.dirty&&!e.cache.errors.length&&e.document.file.path===${q(path)}&&e.document.version&&e.text===e.document.content&&(!s||!s.dirty&&!s.isSaving&&!s.isReloading&&s.originRoot===app.vault.rootPath&&s.text===e.text&&s.document.version===e.document.version&&s.document.content===e.document.content&&(s.document.hasBom===true)===(e.document.hasBom===true)))})()`;
  const savedIndex = async () => {
    await wait(`(async()=>{if(globalThis.propertiesHandoffTrace?.calls.some(call=>!call.settled))return false;await app.workspace.whenIdle();if(app.metadataCache.pending)await app.metadataCache.pending;await app.core.whenIdle();return !globalThis.propertiesHandoffTrace?.calls.some(call=>!call.settled)&&app.workspace.notification===null&&!app.metadataCache.pending&&!app.metadataCache.forceRequested&&!app.core.busy&&${savedIndexCoherent}})()`, "prior Source operation and exact saved index settle before history or closure");
    return evaluate(`(()=>{if(!${savedIndexCoherent})throw Error("The saved Source index changed before fixture closure");const s=${session},e=app.metadataCache.getDocument(${q(path)});return{open:Boolean(s),text:e.text,version:e.document.version,hasBom:e.document.hasBom===true}})()`);
  };
  const diskExact = async (expected = original, bom = true) => { assert.deepEqual(await readFile(join(directory, path)), bytes(expected, bom)); assert.deepEqual(await readFile(join(directory, other)), bytes(peerSaved)); assert.deepEqual(await readFile(configPath), working); };
  const saved = async expected => { await wait(`${session}?.text===${q(expected)}&&!${session}.dirty&&!${session}.isSaving`, "exact handoff Source saved"); await diskExact(expected); };
  const show = async id => {
    if (id === side && !await evaluate(`Boolean(document.querySelector(${q(pane(side))})?.checkVisibility())`)) await click('[data-sidebar-view="workspace-right"]');
    if (!await evaluate(`Boolean(document.querySelector(${q(pane(id))})?.checkVisibility())`)) await click(`[data-tab-id=${q(id)}]`);
    await wait(`Boolean(document.querySelector(${q(pane(id))})?.checkVisibility())`, "current fixed Properties pane visible");
  };
  const inspect = async (id, kind, target) => {
    await show(id); await settle(); const inspector = row(id) + ' [data-property-structured="opaque"]';
    await wait(`Boolean(document.querySelector(${q(inspector)})?.checkVisibility())`, "current exact nested inspector is rendered");
    if (!await evaluate(`document.querySelector(${q(inspector)}).open`)) await click(inspector + " > summary");
    report.propertiesHandoffSetup = await evaluate(`(()=>{const p=app.workspace.getLeafById(${q(id)}).view,e=app.metadataCache.getDocument(${q(path)}),r=document.querySelector(${q(row(id))}),i=document.querySelector(${q(inspector)});return{pane:${q(id)},kind:${q(kind)},path:${q(target)},selector:${q(sourceChoice(id, kind, target))},ordinarySelector:${q(ordinary(id, kind, target))},ordinaryPresent:Boolean(document.querySelector(${q(ordinary(id, kind, target))})),file:p.file?.path,pinned:p.getState().followActiveFile===false,indexedText:e?.text,indexedVersion:e?.document.version,indexedErrors:e?.cache.errors,closed:!app.workspace.sessions.has(${q(path)}),rows:p.metadataEditor.rendered.map(r=>({key:r.entry.key,draft:r.hasDraft?.()})),open:i?.open,html:r?.innerHTML}})()`);
    const selector = sourceChoice(id, kind, target); await wait(`Boolean(document.querySelector(${q(selector)}))`, "settled exact Review in Source target is present"); await reveal(tools, selector); await settle();
  };
  const focusSource = async () => { const id = await evaluate(`(${source}).leaf.id`); await click(pane(id) + " .cm-content[contenteditable=true]"); await wait(`app.workspace.activeLeaf===(${source}).leaf`, "trusted actual Source focus"); };
  const history = async (expected, redo = false) => { await savedIndex(); await focusSource(); await key(tools, redo ? "y" : "z", redo ? "KeyY" : "KeyZ", redo ? 89 : 90, 2); await wait(`${session}.text===${q(expected)}`, "trusted shared Source " + (redo ? "Windows Redo" : "Undo")); await evaluate(`${session}.save()`); await saved(expected); await savedIndex(); };
  const cancel = async id => { await click(control(id, "cancel")); await wait(`!document.querySelector(${q(control(id, "apply"))})`, "explicit handoff Cancel retires draft"); };
  const captureReview = async (id, mode, names) => {
    const selectors = [...names.filter(name => name !== "error"), ...names.filter(name => name === "error")].map(name => name === "error" ? error(id) : control(id, name));
    await uncovered(tools, pane(id), mode, false); const controls = await frame(tools, selectors); await uncovered(tools, pane(id), mode);
    if (["properties-handoff-main-scalar", "properties-handoff-remove-review"].includes(mode)) await readableSplit(tools, id, mode, await evaluate(`(${source}).leaf.id`));
    captures.push({ stage, mode, controls }); await capture?.(mode);
  };
  const review = async (id, kind, target, expected = original) => {
    await inspect(id, kind, target); const selector = sourceChoice(id, kind, target);
    await evaluate(`(()=>{const s=(${source})??null,p=${peerView};globalThis.propertiesHandoffBefore={view:s,editor:s?.editor,cm:s?.editor.cm,doc:s?.editor.cm.state.doc,session:s?.session,saved:s?.session.document,peer:p,peerEditor:p.editor,peerCM:p.editor.cm,peerDoc:p.editor.cm.state.doc,peerSession:p.session,peerSaved:p.session.document,peerText:p.editor.getValue(),mutations:propertiesHandoffTrace.calls.length,leaves:app.workspace.getLeavesOfType('markdown').length};return true})()`);
    assert.equal(await evaluate(`document.querySelector(${q(selector)}).disabled`), false); await click(selector);
    await wait(`(()=>{const p=app.workspace.getLeafById(${q(id)}).view;return !p.metadataEditor.sourceOpening&&Boolean(document.querySelector(${q(control(id, "apply"))})?.checkVisibility())})()`, "explicit Source handoff presents current reviewed editor in fixed pane");
    const proof = await evaluate(`(()=>{const s=(${source}),p=${peerView},b=propertiesHandoffBefore;return{kind:${q(kind)},path:${q(target)},sourceVisible:s.sourceEl.checkVisibility(),normalSource:s.getEditingMode()==='source'&&s.editor.cm.contentDOM.isContentEditable,reviewVisible:document.querySelector(${q(control(id, "apply"))}).checkVisibility(),fixedPaneActive:app.workspace.activeLeaf.id===${q(id)},sourceText:s.editor.getValue(),sameOldOwner:!b.view||s===b.view&&s.editor===b.editor&&s.editor.cm===b.cm&&s.editor.cm.state.doc===b.doc&&s.session===b.session&&s.session.document===b.saved,peerExact:p===b.peer&&p.editor===b.peerEditor&&p.editor.cm===b.peerCM&&p.editor.cm.state.doc===b.peerDoc&&p.session===b.peerSession&&p.session.document===b.peerSaved&&p.editor.getValue()===b.peerText,noMutationBeforeApply:propertiesHandoffTrace.calls.length===b.mutations,sourceAdded:app.workspace.getLeavesOfType('markdown').length-b.leaves}})()`);
    assert.equal(proof.sourceText, expected); for (const field of ["sourceVisible", "normalSource", "reviewVisible", "fixedPaneActive", "sameOldOwner", "peerExact", "noMutationBeforeApply"]) assert.equal(proof[field], true, field);
    assert.equal(proof.sourceAdded, await evaluate("propertiesHandoffBefore.view===null") ? 1 : 0); await diskExact(); proofs.push({ stage, id, review: proof }); return proof;
  };
  const closeSource = async () => { const before = await savedIndex(); await evaluate(`(async()=>{const s=(${source});if(s){if(s.session.dirty)throw Error('Only clean Source may close in fixture setup');await app.workspace.closeLeaf(s.leaf)}await app.workspace.whenIdle();app.metadataCache.updateOpenDocuments()})()`); await wait(`!${session}`, "Source note genuinely closed"); await settle(); const after = await savedIndex(); assert.equal(after.open, false); assert.equal(before.version, sha(bytes(before.text, before.hasBom))); assert.deepEqual({ text: after.text, version: after.version, hasBom: after.hasBom }, { text: before.text, version: before.version, hasBom: before.hasBom }, "closed Source retains the pinned saved index"); (report.propertiesHandoffClosedIndex ??= []).push({ stage, sourceOpenBefore: before.open, sourceClosedAfter: !after.open, version: before.version, hasBom: before.hasBom, textUtf16Length: before.text.length, rawSha256: sha(bytes(before.text, before.hasBom)), sameSavedText: after.text === before.text, sameSavedVersion: after.version === before.version, sameBom: after.hasBom === before.hasBom }); };
  const installTrace = () => evaluate(`(()=>{const t=globalThis.propertiesHandoffTrace={events:[],witnesses:[],transitions:[],calls:[],operations:[],reads:[],negativeProbes:[],abort:new AbortController(),refs:[],frontmatter:app.fileManager.processFrontMatter,read:app.vault.readDocument};app.fileManager.processFrontMatter=async function(...args){const call={path:args[0].path,settled:false};t.calls.push(call);const operation=t.frontmatter.apply(this,args);t.operations.push(operation);try{const result=await operation;call.outcome='fulfilled';return result}catch(issue){call.outcome='rejected';call.reason=issue instanceof Error?issue.message:String(issue);throw issue}finally{call.settled=true}};app.vault.readDocument=async function(...args){const d=await t.read.apply(this,args);if(args[0]===${q(path)})t.reads.push({version:d.version,bom:d.hasBom===true,text:d.content});return d};for(const name of ['active-leaf-change','file-open'])t.refs.push(app.workspace.on(name,()=>{const s=(${source});t.transitions.push({event:name,active:app.workspace.activeLeaf?.id,sourceActive:Boolean(s&&app.workspace.activeLeaf===s.leaf),sourceVisible:Boolean(s?.sourceEl.checkVisibility()),mode:s?.getEditingMode(),text:s?.editor.getValue()})}));for(const type of ['pointerdown','click','keydown'])document.addEventListener(type,event=>{if(!event.target.closest?.('.metadata-container,.cm-content,.workspace-tab-header,[data-workspace-action],[data-properties-filter],[data-sidebar-view]'))return;const a=event.target.closest('[data-property-structured-source],[data-property-structured-apply],[data-property-structured-cancel]');t.events.push({type,key:event.key??null,trusted:event.isTrusted,action:a?.textContent??null});if(type==='click'&&a){const s=(${source});t.witnesses.push({trusted:event.isTrusted,action:a.textContent,sourceVisible:Boolean(s?.sourceEl.checkVisibility()),mode:s?.getEditingMode(),text:s?.editor.getValue(),active:app.workspace.activeLeaf?.id})}},{capture:true,signal:t.abort.signal});return true})()`);
  const stopTrace = async () => { const trace = await evaluate('(()=>{const t=propertiesHandoffTrace;app.vault.readDocument=t.read;app.fileManager.processFrontMatter=t.frontmatter;t.abort.abort();t.refs.forEach(ref=>ref.emitter.offref(ref));return{events:t.events,witnesses:t.witnesses,transitions:t.transitions,calls:t.calls,reads:t.reads,negativeProbes:t.negativeProbes}})()'); report.propertiesHandoffInputs = trace.events; report.propertiesHandoffWitnesses = trace.witnesses; report.propertiesHandoffTransitions = trace.transitions; report.propertiesHandoffQueue = trace.calls; report.propertiesHandoffReads = trace.reads; report.propertiesHandoffNegativeProbes = trace.negativeProbes; return trace; };
  const release = () => evaluate('(()=>{const h=globalThis.propertiesHandoffHeld;if(!h)return true;h.closed=true;for(const resolve of h.releases.splice(0))resolve();if(h.session)h.session.reload=h.original;else if(app.vault.readDocument===h.wrapper)app.vault.readDocument=h.original;delete globalThis.propertiesHandoffHeld;return true})()');
  try {
    if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
    await mkdir(join(directory, folder)); madeFolder = true; await writeFile(join(directory, path), bytes(original), { flag: "wx" }); await writeFile(join(directory, other), bytes(peerText), { flag: "wx" });
    await writeFile(configPath, working); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()'); await refresh(); await evaluate(`app.workspace.changeLayout(${q(layout())})`); await click('[data-sidebar-view="workspace-right"]'); await settle(); await installTrace(); traced = true;
    await click(pane(peer) + " .cm-content"); await key(tools, "End", "End", 35, 2); await command("Input.insertText", { text: "Earlier dirty peer Ω.\n" }); peerDraft = peerText + "Earlier dirty peer Ω.\r\n"; await wait(`${peerView}.session.dirty&&${peerView}.editor.getValue()===${q(peerDraft)}`, "earlier trusted peer edit remains dirty");

    stage = "closed main scalar handoff and Cancel";
    assert.equal(await evaluate(`Boolean(${session})`), false); for (const [kind, target] of [["edit", ["map", "count"]], ["add", ["map"]], ["remove", ["list", 1]]]) { await inspect(main, kind, target); const selector = ordinary(main, kind, target); await wait(`Boolean(document.querySelector(${q(selector)}))`, "settled existing closed mutation control is present"); assert.equal(await evaluate(`document.querySelector(${q(selector)}).disabled`), true); } assert.equal(await evaluate(`Boolean(${session})`), false); await review(main, "edit", ["map", "count"]); assert.equal(await evaluate(`document.querySelector(${q(control(main, "input"))}).value`), "1.5"); await captureReview(main, "properties-handoff-main-scalar", ["type", "input", "apply", "cancel"]); await cancel(main); await diskExact();
    assert.equal(await evaluate(`(${source}).getEditingMode()==='source'&&${peerView}.session.dirty&&${peerView}.editor.getValue()===${q(peerDraft)}`), true);
    pass(report, "Closed fixed main Properties explicitly opens the intended normal Source beside the exact nested scalar review. Source activation is observable, the fixed pane is reactivated, Cancel keeps Source, and neither the note nor the earlier dirty peer is saved before Apply.");

    stage = "existing dirty Reading owner and prior history";
    await focusSource(); await key(tools, "End", "End", 35, 2); await command("Input.insertText", { text: "Earlier dirty body Ω.\n" }); const dirty = original + "Earlier dirty body Ω.\r\n"; await wait(`${session}.text===${q(dirty)}&&${session}.dirty`, "trusted earlier Source edit stays dirty");
    const sourceId = await evaluate(`(${source}).leaf.id`); await click(pane(sourceId) + ' [data-workspace-action="toggle-reading-view"]'); await wait(`(${source}).getMode()==='preview'`, "trusted earlier Source owner enters Reading");
    await review(side, "add", ["emptyMap"], dirty); await fill(tools, control(side, "position"), "reviewed λ"); await choose(tools, control(side, "type"), "boolean"); await choose(tools, control(side, "input"), "true"); await captureReview(side, "properties-handoff-side-add", ["position", "type", "input", "preview", "apply"]); await diskExact(); await click(control(side, "apply"));
    const dirtyAdded = dirty.replace("emptyMap: {}", 'emptyMap: {"reviewed λ": true}'); await saved(dirtyAdded); assert.equal(await evaluate(`${peerView}.session.dirty&&${peerView}.editor.getValue()===${q(peerDraft)}`), true); await history(dirty); await history(dirtyAdded, true); await history(dirty); await history(original); await history(dirty, true); await history(original);
    pass(report, "A trusted sidebar handoff reuses the existing dirty Reading view/editor/CodeMirror/document/session without resetting history. Explicit addition retains dirty body and peer edits; one shared Undo restores the nested value, Windows Redo restores it, and the earlier Source edit remains independently undoable.");

    stage = "typed scalar null and precision refusal";
    await review(side, "edit", ["map", "count"]); await fill(tools, control(side, "input"), "0.10000000000000001"); const beforeInvalid = await evaluate("propertiesHandoffTrace.calls.length"); await click(control(side, "apply")); await wait(`Boolean(document.querySelector(${q(error(side))}).textContent)`, "rounded numeric input visibly refuses"); assert.equal(await evaluate("propertiesHandoffTrace.calls.length"), beforeInvalid); await captureReview(side, "properties-handoff-precision-refusal", ["input", "error"]); await cancel(side);
    await review(side, "edit", ["map", "empty"]); await choose(tools, control(side, "type"), "number"); await fill(tools, control(side, "input"), "-0"); await click(control(side, "apply")); const negativeZero = original.replace("empty: ~", "empty: -0"); await saved(negativeZero); assert.equal(await evaluate(`Object.is(app.metadataCache.getDocument(${q(path)}).cache.frontmatter.opaque.map.empty,-0)`), true); await history(original);
    await review(side, "edit", ["map", "count"]); await choose(tools, control(side, "type"), "null"); await click(control(side, "apply")); await saved(original.replace("count: 1.50", "count: null")); await history(original);
    await review(side, "edit", ["implicit"]); await choose(tools, control(side, "type"), "string"); await fill(tools, control(side, "input"), "Discard implicit draft λ");
    const implicitCalls = await evaluate("propertiesHandoffTrace.calls.length"); await diskExact(); await cancel(side); await diskExact(); assert.equal(await evaluate("propertiesHandoffTrace.calls.length"), implicitCalls);

    stage = "closed explicit structural reviews";
    await closeSource(); await review(main, "remove", ["list", 1]); assert.match(await evaluate(`document.querySelector(${q(control(main, "removal-review"))}).value`), /removable subtree/); await captureReview(main, "properties-handoff-remove-review", ["removal-review", "apply", "cancel"]); await click(control(main, "apply")); await saved(original.replace("    - { child: value } # removable subtree\r\n", "")); await history(original);
    await closeSource(); await review(side, "add", ["map"]); await fill(tools, control(side, "position"), "new λ"); await fill(tools, control(side, "input"), "001\n😀"); await click(control(side, "apply")); await saved(original.replace("  implicit:", '    "new λ": "001\\n😀"\r\n  implicit:')); await history(original);
    await closeSource(); await review(side, "add", ["list"]); await fill(tools, control(side, "position"), "1"); await choose(tools, control(side, "type"), "null"); await click(control(side, "apply")); await saved(original.replace("    - { child:", "    - null\r\n    - { child:")); await history(original);
    pass(report, "Closed-note scalar and structural handoffs retain the existing guarded queue: typed null/negative zero, precision refusal, explicit map keys/list indexes and complete subtree review all require Apply. BOM/CRLF/comments/unrelated opaque YAML and peer bytes stay exact; proven implicit empty null offers a real Source review and Cancel writes nothing.");

    stage = "physical version before Source allocation";
    for (const external of [{ name: "BOM-only", text: original, bom: false }, { name: "same-value null spelling", text: original.replace("empty: ~", "empty: NULL"), bom: true }, { name: "changed descendant", text: original.replace("child: value", "child: newer"), bom: true }]) {
      await closeSource(); await show(main); await reveal(tools, sourceChoice(main, "remove", ["list", 1])); await evaluate("app.metadataCache.pause()"); const raw = bytes(external.text, external.bom); await writeFile(join(directory, path), raw);
      const before = await evaluate("propertiesHandoffTrace.calls.length"); await click(sourceChoice(main, "remove", ["list", 1])); await wait(`!app.workspace.getLeafById(${q(main)}).view.metadataEditor.sourceOpening&&/changed/.test(document.querySelector(${q(status(main))}).textContent)`, "physical source identity refuses before allocation");
      assert.equal(await evaluate(`Boolean(${session})`), false); assert.equal(await evaluate("propertiesHandoffTrace.calls.length"), before); await diskExact(external.text, external.bom); const read = await evaluate("propertiesHandoffTrace.reads.at(-1)"); assert.equal(read.version, sha(raw)); assert.equal(read.bom, external.bom); physical.push({ name: external.name, expectedVersion: sha(raw), actualVersion: read.version, actualRawShaVerified: true, noSourceAllocated: true });
      const mode = "properties-handoff-physical-refusal-" + physical.length; await uncovered(tools, pane(main), mode, false); await frame(tools, [status(main)]); await uncovered(tools, pane(main), mode); await capture?.(mode); await writeFile(join(directory, path), bytes(original)); await evaluate("app.metadataCache.resume()"); await refresh();
    }

    stage = "held source handoff rejects changed pane epoch";
    await closeSource(); await show(main); await reveal(tools, sourceChoice(main, "add", ["emptyMap"]));
    await evaluate(`(()=>{const h=globalThis.propertiesHandoffHeld={original:app.vault.readDocument,releases:[],closed:false,waiting:false};h.wrapper=async function(...args){const d=await h.original.apply(this,args);if(args[0]===${q(path)}&&!h.closed){h.waiting=true;await new Promise(resolve=>h.releases.push(resolve))}return d};app.vault.readDocument=h.wrapper;return true})()`);
    await click(sourceChoice(main, "add", ["emptyMap"])); await wait("propertiesHandoffHeld.waiting", "real physical source delivery held"); await fill(tools, pane(main) + " [data-properties-filter]", "opaque"); await release(); await wait(`!app.workspace.getLeafById(${q(main)}).view.metadataEditor.sourceOpening&&/changed/.test(document.querySelector(${q(status(main))}).textContent)`, "changed filter epoch refuses held handoff"); assert.equal(await evaluate(`Boolean(${session})`), false); await fill(tools, pane(main) + " [data-properties-filter]", ""); await diskExact();

    stage = "held Apply keeps stale draft and Source owner";
    await review(side, "add", ["emptyMap"]); await fill(tools, control(side, "position"), "retain draft λ"); await fill(tools, control(side, "input"), "Never applied 😀");
    await evaluate(`(()=>{const s=${session},h=globalThis.propertiesHandoffHeld={original:s.reload,session:s,releases:[],closed:false,waiting:false};s.reload=async function(...args){if(!h.closed){h.waiting=true;await new Promise(resolve=>h.releases.push(resolve))}return h.original.apply(this,args)};return true})()`);
    await click(control(side, "apply")); await wait("propertiesHandoffHeld.waiting", "normal shared queue reload held"); for (const name of ["position", "type", "input", "apply", "cancel"]) assert.equal(await evaluate(`document.querySelector(${q(control(side, name))}).disabled`), true); await captureReview(side, "properties-handoff-pending", ["position", "input", "apply"]);
    await evaluate(`(()=>{const expected=propertiesHandoffTrace.operations.at(-1),tasks=[...app.workspace.tasks];if(!expected||!tasks.includes(expected)||propertiesHandoffTrace.calls.at(-1).path!==${q(path)})throw Error('The actual held Source operation must be tracked before deliberate refusal');globalThis.propertiesHandoffExpectedQueue=Promise.allSettled(tasks).then(results=>results.map((result,index)=>({expected:tasks[index]===expected,status:result.status,reason:result.status==='rejected'?(result.reason instanceof Error?result.reason.message:String(result.reason)):null})));return true})()`);
    const heldSourceId = await evaluate(`(${source}).leaf.id`); await click(pane(heldSourceId) + ' [data-workspace-action="toggle-reading-view"]'); await release(); report.propertiesHandoffExpectedQueueRefusal = await evaluate("propertiesHandoffExpectedQueue"); assertStructuredHandoffRefusal(report.propertiesHandoffExpectedQueueRefusal); await evaluate("delete globalThis.propertiesHandoffExpectedQueue"); await wait("propertiesHandoffTrace.calls.at(-1).settled&&app.workspace.tasks.size===0&&app.core.pending.size===0", "real refused Source queue and UI action completely drain"); await settle(); await wait(`document.querySelector(${q(error(side))}).textContent===${q(expectedOwnerRefusal)}`, "changed acknowledged Source gives the exact expected Apply refusal"); assert.equal(await evaluate("propertiesHandoffTrace.calls.at(-1).reason"), expectedOwnerRefusal); await diskExact(); assert.equal(await evaluate(`document.querySelector(${q(control(side, "input"))}).value`), "Never applied 😀"); await captureReview(side, "properties-handoff-stale-draft", ["input", "error", "cancel"]); await cancel(side); assert.equal(await evaluate(`(${source}).leaf.id`), heldSourceId);
    pass(report, "Actual SHA256 byte versions reject BOM-only, same-value respelling and descendant replacement before Source allocation. Held physical reads cannot revive a changed Properties pane; held Apply locks all controls and refuses a changed Source mode while retaining the draft for Cancel and the acknowledged Source owner.");

    stage = "retired handoff control after genuine provider disable";
    await evaluate(`(()=>{propertiesHandoffTrace.retired=document.querySelector(${q(sourceChoice(side, "add", ["emptyMap"]))});propertiesHandoffTrace.negativeProbes.push('synthetic retained Review in Source after genuine Properties disable');return true})()`); const retiredReads = await evaluate("propertiesHandoffTrace.reads.length"); await evaluate('app.core.setEnabled("properties",false)'); await evaluate("(()=>{const n=propertiesHandoffTrace.retired;n.disabled=false;n.click();return true})()"); assert.equal(await evaluate("propertiesHandoffTrace.reads.length"), retiredReads); await diskExact(); await evaluate('app.core.setEnabled("properties",true)');
    await evaluate(`app.workspace.changeLayout(${q(layout(side))})`); await settle(); // The explicit layout lifecycle may now save the earlier peer.
    peerSaved = (await readFile(join(directory, other))).toString("utf8").replace(/^\ufeff/, ""); peerDraft = peerSaved;

    stage = "narrow explicit review controls";
    const narrowLayout = { version: 1, main: { id: "properties-handoff-narrow-root", type: "split", direction: "vertical", children: [{ id: "properties-handoff-narrow-source-tabs", type: "tabs", currentTab: 0, children: [{ id: peer, type: "leaf", state: { type: "markdown", state: { file: other, mode: "source", source: true } } }] }] }, left: { width: 260, collapsed: true }, right: { ...layout().right, width: 300 }, active: side };
    await evaluate(`app.workspace.changeLayout(${q(narrowLayout)})`); await click('[data-sidebar-view="workspace-right"]'); await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }); narrow = true;
    await review(side, "add", ["emptyMap"]); await fill(tools, control(side, "position"), "narrow λ"); await fill(tools, control(side, "input"), "Narrow 😀"); const measured = await frame(tools, ["position", "type", "input", "apply", "cancel"].map(name => control(side, name))); assert.ok(measured.every(item => item.left >= 0 && item.right <= 361)); report.propertiesHandoffNarrow = { width: await evaluate("innerWidth"), height: await evaluate("innerHeight"), controls: measured }; await captureReview(side, "properties-handoff-narrow-key-type", ["position", "type"]); await captureReview(side, "properties-handoff-narrow-review-actions", ["input", "preview", "apply", "cancel"]); await cancel(side); await command("Emulation.clearDeviceMetricsOverride"); narrow = false; await evaluate(`app.workspace.changeLayout(${q(layout(side))})`); await settle();

    stage = "restart fresh closed-note controls";
    await review(side, "add", ["emptyMap"]); await fill(tools, control(side, "position"), "persisted"); await choose(tools, control(side, "type"), "boolean"); await choose(tools, control(side, "input"), "true"); await click(control(side, "apply")); const persisted = original.replace("emptyMap: {}", 'emptyMap: {"persisted": true}'); await saved(persisted);
    const trace = await stopTrace(); traced = false; assert.ok(trace.events.length > 40 && trace.events.every(event => event.trusted)); assert.ok(trace.transitions.some(event => event.sourceActive && event.sourceVisible && event.mode === "source")); assert.ok(trace.witnesses.some(event => event.trusted && /^Apply/.test(event.action) && event.sourceVisible && event.mode === "source"));
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); peerSaved = (await readFile(join(directory, other))).toString("utf8").replace(/^\ufeff/, ""); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await settle(); await saved(persisted); await closeSource(); await show(side); await reveal(tools, sourceChoice(side, "remove", ["emptyMap", "persisted"])); await click(sourceChoice(side, "remove", ["emptyMap", "persisted"])); await wait(`Boolean(document.querySelector(${q(control(side, "removal-review"))})?.checkVisibility())`, "fresh saved nested review after restart"); assert.match(await evaluate(`document.querySelector(${q(control(side, "removal-review"))}).value`), /Current value: true/); await captureReview(side, "properties-handoff-restored-review", ["removal-review", "apply", "cancel"]); await cancel(side); await diskExact(persisted);
    report.propertiesHandoff = { closedFixedPaneExplicitSource: true, mainSplitAndPinnedSidebar: true, normalSourceVisibleBeforeReview: true, fixedReviewReactivatedBeforeApply: true, noSaveOrMutationBeforeLiteralApply: true, acknowledgedSourceKeptAfterCancel: true, existingReadingSourceOwnerReused: true, oldEditorCMDocSessionHistoryRetained: true, unrelatedDirtyPeerRetained: true, fourScalarTypesAndNegativeZero: true, precisionRefusedBeforeQueue: true, implicitNullReviewedCancel: true, explicitMapListAndSubtreeReview: true, exactBOMCRLFCommentsOpaqueYAML: true, isolatedUndoWindowsRedoAndEarlierDirtyUndo: true, physicalBOMSpellingDescendantVersionRefused: true, heldPaneEpochRefused: true, pendingControlsLocked: true, changedSourceRefusedDraftKeptForCancel: true, providerRetiredControlRefused: true, narrowPhysicalReachability: true, restartFreshClosedReview: true, trustedPositiveInputs: true, supplementalSyntheticFaultsSeparate: true };
    pass(report, "Retired Source-handoff controls cannot revive after provider disable. At 360px the real map key, type/value, review and Apply/Cancel stay physically reachable. Saved edits survive restart or folder reconnection and yield fresh closed-note Source review controls. Positive user actions are trusted; synthetic fault probes are recorded separately.");
  } catch (issue) {
    failure = issue; report.propertiesHandoffFailure = { stage, error: String(issue?.stack ?? issue) };
    try { report.propertiesHandoffFailure.state = await evaluate(`(()=>({active:app.workspace.activeLeaf?.id,source:(${source})?.editor.getValue(),sourceMode:(${source})?.getEditingMode(),sessions:[...app.workspace.sessions.keys()],handoffs:app.workspace.getLeavesOfType('file-properties').map(leaf=>({id:leaf.id,state:leaf.view.metadataEditor.sourceHandoffState,opening:Boolean(leaf.view.metadataEditor.sourceOpening)})),status:[...document.querySelectorAll('[data-property-structured-handoff-status]')].map(n=>n.textContent),errors:[...document.querySelectorAll('.metadata-property-error')].filter(n=>n.textContent).map(n=>n.textContent),trace:globalThis.propertiesHandoffTrace?{reads:propertiesHandoffTrace.reads,calls:propertiesHandoffTrace.calls}:null}))()`); await capture?.("properties-handoff-precleanup-failure"); } catch { /* Preserve the first failure. */ } throw issue;
  } finally {
    try {
      await release(); await evaluate("app.metadataCache.resume()"); if (narrow) await command("Emulation.clearDeviceMetricsOverride"); if (traced) await stopTrace(); if (!await evaluate('app.core.isEnabled("properties")')) await evaluate('app.core.setEnabled("properties",true)');
      await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(oldLayout)});await app.workspace.flushLayout();delete globalThis.propertiesHandoffBefore;delete globalThis.propertiesHandoffTrace;delete globalThis.propertiesHandoffExpectedQueue})()`); await writeFile(configPath, configBytes); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()'); if (!enabled) await evaluate('app.core.setEnabled("properties",false)'); if (coreBytes === null) await unlink(corePath).catch(issue => { if (issue.code !== "ENOENT") throw issue; }); else await writeFile(corePath, coreBytes); if (madeFolder) { for (const name of [path, other]) await unlink(join(directory, name)).catch(issue => { if (issue.code !== "ENOENT") throw issue; }); await rmdir(join(directory, folder)); await refresh(); }
    } catch (issue) { if (!failure) throw issue; report.propertiesHandoffFailure.cleanupError = String(issue?.stack ?? issue); }
  }
}

/** Genuine cached anchor stays the same live leaf/view/editor/CM/doc/session.
 * A temporary fixed Properties tab is fixture setup, then trusted disabled
 * controls and explicitly labeled forced-handler probes must perform no IO. */
export async function checkStructuredPropertyHandoffReadOnly(tools) {
  const { evaluate, wait, click, capture, report } = tools, anchor = "readonly-export-handoff-history";
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate("app.workspace.activeLeaf.id"), anchor);
  const before = await evaluate(snapshot), configuration = await evaluate('(async()=>(await app.configuration.read("app")).data)()'); let temporary = null, installed = false, failure;
  await evaluate(`(()=>{const leaf=app.workspace.getLeafById(${q(anchor)}),view=leaf.view,editor=view.editor,cm=editor.cm,s=view.session;globalThis.propertiesHandoffCachedOwner={leaf,view,editor,cm,doc:cm.state.doc,session:s,saved:s.document,text:s.text,dirty:s.dirty,mode:view.getEditingMode(),source:view.isSourceMode,layout:JSON.stringify(app.workspace.getLayout()),restore:app.workspace.snapshotTree()};return true})()`);
  try {
    temporary = await evaluate('(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.setViewState({type:"file-properties",state:{file:"Read only.md",followActiveFile:false,query:"",sort:"name"},active:true});return leaf.id})()'); await wait(`app.workspace.getLeafById(${q(temporary)}).view.metadataEditor?.rendered.length>0`, "genuine cached fixed Properties fixture");
    await uncovered(tools, pane(temporary), "properties-handoff-readonly-disabled", false);
    await evaluate(`(()=>{const t=globalThis.propertiesHandoffCachedTrace={read:app.vault.readDocument,frontmatter:app.fileManager.processFrontMatter,getLeaf:app.workspace.getLeaf,split:app.workspace.createLeafBySplit,reads:0,mutations:0,allocations:0,events:[],negativeProbes:[],abort:new AbortController(),sessions:[...app.workspace.sessions.keys()].sort()};app.vault.readDocument=async function(){t.reads++;throw Error('Readonly handoff attempted source IO')};app.fileManager.processFrontMatter=async function(){t.mutations++;throw Error('Readonly handoff attempted mutation')};app.workspace.getLeaf=function(){t.allocations++;throw Error('Readonly handoff attempted owner allocation')};app.workspace.createLeafBySplit=function(){t.allocations++;throw Error('Readonly handoff attempted split allocation')};for(const type of ['pointerdown','click','keydown'])document.addEventListener(type,event=>{if(event.isTrusted&&event.target.closest?.(${q(pane(temporary))}))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`); installed = true;
    for (const [kind, target] of [["edit", ["map", "count"]], ["edit", ["map", "empty"]], ["add", ["map"]], ["add", ["list"]], ["remove", ["list", 1]]]) {
      const selector = sourceChoice(temporary, kind, target); await reveal(tools, selector); assert.equal(await evaluate(`document.querySelector(${q(selector)}).disabled`), true); await disabledPointer(tools, selector);
      await evaluate(`(()=>{const t=propertiesHandoffCachedTrace;t.negativeProbes.push(${q("synthetic enabled readonly " + kind + " " + JSON.stringify(target))});const node=document.querySelector(${q(selector)});node.disabled=false;node.click();node.disabled=true;return true})()`); assert.equal(await evaluate(`document.querySelectorAll(${q(pane(temporary) + " [data-property-structured-apply]")}).length`), 0);
    }
    await evaluate(`(async()=>{const p=app.workspace.getLeafById(${q(temporary)}).view;propertiesHandoffCachedTrace.negativeProbes.push('direct readonly MetadataEditor source handler');await p.metadataEditor.reviewInSource(p.file,'opaque',app.metadataCache.getDocument('Read only.md').cache.frontmatter.opaque,{kind:'add',path:['emptyMap']})})()`);
    const selected = sourceChoice(temporary, "add", ["map"]); await reveal(tools, selected); await uncovered(tools, pane(temporary), "properties-handoff-readonly-disabled", false); report.propertiesHandoffReadOnlyFrame = await frame(tools, [selected]); await uncovered(tools, pane(temporary), "properties-handoff-readonly-disabled"); await capture?.("properties-handoff-readonly-disabled");
    const probe = await evaluate('({reads:propertiesHandoffCachedTrace.reads,mutations:propertiesHandoffCachedTrace.mutations,allocations:propertiesHandoffCachedTrace.allocations,beforeSessions:propertiesHandoffCachedTrace.sessions,afterSessions:[...app.workspace.sessions.keys()].sort(),drafts:document.querySelectorAll("[data-property-structured-apply]").length,modals:document.querySelectorAll(".modal-container").length})'); assert.equal(probe.reads, 0); assert.equal(probe.mutations, 0); assert.equal(probe.allocations, 0); assert.equal(probe.drafts, 0); assert.equal(probe.modals, 0); assert.deepEqual(probe.beforeSessions, probe.afterSessions); report.propertiesHandoffReadOnlyProbe = probe;
    report.propertiesHandoffReadOnlyInputs = await evaluate("propertiesHandoffCachedTrace.events"); report.propertiesHandoffReadOnlyNegativeProbes = await evaluate("propertiesHandoffCachedTrace.negativeProbes"); assert.ok(report.propertiesHandoffReadOnlyInputs.some(event => event.trusted)); assert.ok(report.propertiesHandoffReadOnlyInputs.filter(event => event.type === "pointerdown").every(event => event.trusted)); assert.deepEqual(await evaluate(snapshot), before); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), configuration); assert.deepEqual(await evaluate('(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), { api: 0, raw: 0 });
    report.propertiesHandoffReadOnly = { genuineCachedMount: true, fixedPropertiesNestedInspection: true, sourceHandoffChoicesDisabled: true, trustedDisabledPointer: true, supplementalForcedHandlersSeparate: true, refuseBeforeSourceReadOrAllocation: true, noDraftModalMutationOrHiddenOwner: true, exactDocumentsVersionsBOMAndConfiguration: true, zeroApiRaw: true };
    pass(report, "A genuine indexed cached read-only File properties pane exposes disabled nested Review in Source choices. Trusted disabled pointer input and separate forced handlers cannot read source, allocate an owner, create a draft/modal or mutate cached bytes, versions, BOM or configuration; API/raw remain zero.");
  } catch (issue) { failure = issue; report.propertiesHandoffReadOnlyFailure = { error: String(issue?.stack ?? issue) }; throw issue; }
  finally {
    try {
      if (installed) await evaluate('(()=>{const t=propertiesHandoffCachedTrace;app.vault.readDocument=t.read;app.fileManager.processFrontMatter=t.frontmatter;app.workspace.getLeaf=t.getLeaf;app.workspace.createLeafBySplit=t.split;t.abort.abort();delete globalThis.propertiesHandoffCachedTrace})()');
      if (temporary && await evaluate(`Boolean(app.workspace.getLeafById(${q(temporary)}))`)) await click(`[data-tab-id=${q(temporary)}] .workspace-tab-header-inner-close-button`);
      report.propertiesHandoffReadOnlyOwnerRestored = await evaluate('(async()=>{const o=propertiesHandoffCachedOwner;o.restore();o.view.setEditingMode(o.mode,false);await app.workspace.flushLayout();const r={sameLeaf:app.workspace.getLeafById(o.leaf.id)===o.leaf,sameView:o.leaf.view===o.view,sameEditor:o.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:o.view.session===o.session,sameSavedDocument:o.session.document===o.saved,sourceExact:o.session.text===o.text,dirtyExact:o.session.dirty===o.dirty,sameLayout:JSON.stringify(app.workspace.getLayout())===o.layout,sameMode:o.view.getEditingMode()===o.mode};delete globalThis.propertiesHandoffCachedOwner;return r})()'); for (const value of Object.values(report.propertiesHandoffReadOnlyOwnerRestored)) assert.equal(value, true); assert.deepEqual(await evaluate(snapshot), before); if (report.propertiesHandoffReadOnly) report.propertiesHandoffReadOnly.originalSourceOwnerHistoryAndLayoutRetained = true;
    } catch (issue) { if (!failure) throw issue; report.propertiesHandoffReadOnlyFailure.cleanupError = String(issue?.stack ?? issue); }
  }
}
