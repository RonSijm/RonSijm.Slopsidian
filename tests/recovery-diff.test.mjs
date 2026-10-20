import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";

const root = fileURLToPath(new URL("../", import.meta.url));
let temporary, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime/recovery-diff-tests-"));
  const outfile = join(temporary, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/recovery-diff";export * from "./client/file-recovery";export {HostError} from "./client/contracts";', resolveDir: root }, outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "recovery-shell", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/(ui|vault|views)$/ }, args => /file-recovery\.ts$/.test(args.importer) ? { path: args.path.slice(2), namespace: "recovery-shell" } : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "recovery-shell" }, args => ({ loader: "js", contents: args.path === "ui" ? `
      export class Modal { constructor(app){this.app=app;this.containerEl=document.createElement("div");this.modalEl=document.createElement("div");this.contentEl=document.createElement("div");this.modalEl.append(this.contentEl);this.containerEl.append(this.modalEl);}setTitle(value){this.title=value;return this;}open(){document.body.append(this.containerEl);this.onOpen?.();}close(){this.onClose?.();this.containerEl.remove();} }
      export class Notice { constructor(message){globalThis.recoveryNotices.push(message);} }
    ` : args.path === "vault" ? 'export class TFile {}' : 'export class TextFileView {}' }));
  } }] });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  delete globalThis.document; delete globalThis.recoveryNotices;
  if (temporary) { assert.match(relative(root, temporary).replaceAll("\\", "/"), /^\.runtime\/recovery-diff-tests-[^/]+$/); await rm(temporary, { recursive: true }); }
});
const text = (content, hasBom = false) => ({ content, hasBom });
const diff = (a, b, limits) => feature.compareRecoveryText(typeof a === "string" ? text(a) : a, typeof b === "string" ? text(b) : b, limits);
const endings = { LF: "\n", CRLF: "\r\n", CR: "\r", none: "" };
function reconstruct(result, side) { return result.lines.filter(line => line[side + "Line"] !== null).map(line => line.text + endings[line[side + "Ending"]]).join(""); }
function valid(result, a, b) {
  assert.equal(result.available, true, result.reason);
  assert.equal(reconstruct(result, "snapshot"), a);
  assert.equal(reconstruct(result, "current"), b);
  assert.equal(result.added + result.unchanged, result.current.lines);
  assert.equal(result.removed + result.unchanged, result.snapshot.lines);
}

test("diff direction reports snapshot removals, current additions and common line numbers", () => {
  const a = "# Kept\r\nOld λ\r\nTail\n", b = "# Kept\r\nNew 😀\r\nTail\n", result = diff(a, b);
  valid(result, a, b);
  assert.deepEqual(result.lines.map(line => [line.kind, line.snapshotLine, line.currentLine, line.text]), [["unchanged", 1, 1, "# Kept"], ["removed", 2, null, "Old λ"], ["added", null, 2, "New 😀"], ["unchanged", 3, 3, "Tail"]]);
  assert.deepEqual([result.added, result.removed, result.unchanged], [1, 1, 2]);
});
test("empty, blank, BOM-only and no-final-newline inputs have reconstructable physical lines", () => {
  for (const a of ["", "\n", "\r\n", "\r", "a", "a\n", "\n\n", "\ufeff"]) for (const b of ["", "\n", "b", "a\r\n", "\r\r"]) { valid(diff(a, b), a, b); }
  const empty = diff(text("", true), text("", false));
  assert.equal(empty.bomChanged, true); assert.equal(empty.snapshot.bytes, 3); assert.deepEqual(empty.lines, []);
  assert.equal(diff("a\n", "a").endingChanges, 1);
});
test("mixed CRLF/LF/CR and BOM metadata are exact without treating EOL-only changes as text edits", () => {
  const a = "First\r\nSecond\nThird\rFinal", b = "First\nSecond\r\nThird\r\nFinal\n", result = diff(text(a, true), text(b));
  valid(result, a, b);
  assert.deepEqual([result.added, result.removed, result.unchanged, result.endingChanges, result.bomChanged], [0, 0, 4, 4, true]);
  assert.deepEqual(result.snapshot.endings, { LF: 1, CRLF: 1, CR: 1, none: 1 });
  assert.deepEqual(result.current.endings, { LF: 2, CRLF: 2, CR: 0, none: 0 });
  assert.equal(result.snapshot.bytes, Buffer.byteLength(a) + 3);
});
test("Unicode, combining forms, literal HTML and interior BOM code points are never normalized", () => {
  const a = "λ 中文 😀\r\ne\u0301\n<svg onload=alert(1)>\n\ufeffinterior", b = "λ 中文 😀\r\né\n<svg onload=alert(1)>\n\ufeffinterior";
  const result = diff(a, b); valid(result, a, b);
  assert.equal(result.added, 1); assert.equal(result.removed, 1); assert.equal(result.bomChanged, false);
  assert.equal(result.snapshot.bytes, Buffer.byteLength(a));
});
test("repeated and shifted lines produce deterministic maximum common subsequences", () => {
  const cases = [["a\nb\na\nb\n", "b\na\nb\na\n"], ["same\nsame\nlast\n", "same\nnew\nsame\nlast\n"], ["a\nb\nc", "c\nb\na"], ["x\n".repeat(100), "x\n".repeat(99)]];
  for (const [a, b] of cases) { const first = diff(a, b); valid(first, a, b); assert.deepEqual(diff(a, b), first); }
  assert.equal(diff(...cases[0]).unchanged, 3);
});
test("all short repeated sequences agree with a separate dynamic-programming LCS oracle", () => {
  const samples = [[], ["a"], ["b"], ["a", "b"], ["b", "a"], ["a", "a"], ["b", "a", "b"], ["a", "b", "a"], ["a", "a", "b", "a"]];
  const oracle = (a, b) => { const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0)); for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) rows[i][j] = a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]); return rows.at(-1).at(-1); };
  for (const a of samples) for (const b of samples) { const left = a.map(line => line + "\n").join(""), right = b.map(line => line + "\n").join(""), result = diff(left, right); valid(result, left, right); assert.equal(result.unchanged, oracle(a, b)); }
});
test("byte and line budgets refuse before LCS without changing either source", () => {
  for (const [a, b, budget, message] of [[text("😀"), text("x"), { bytesPerSide: 3 }, /byte/], [text("", true), text(""), { bytesPerSide: 2 }, /byte/], [text("a\nb\n"), text("a"), { linesPerSide: 1 }, /line/], [text("a"), text("a\nb"), { linesPerSide: 1 }, /line/]]) { const before = JSON.stringify([a, b]), result = diff(a, b, budget); assert.equal(result.available, false); assert.match(result.reason, message); assert.equal(result.work, 0); assert.equal(JSON.stringify([a, b]), before); }
  assert.equal(diff("abc", "abc", { bytesPerSide: 3 }).available, true);
  assert.equal(diff("a\n", "a\n", { linesPerSide: 1 }).available, true);
});
test("adversarial unrelated lines stop at the work budget with bounded useful fallback", () => {
  const a = Array.from({ length: 1600 }, (_, i) => "old " + i).join("\n"), b = Array.from({ length: 1600 }, (_, i) => "new " + i).join("\n");
  const result = diff(a, b); assert.equal(result.available, false); assert.equal(result.work, feature.RECOVERY_DIFF_BUDGETS.work); assert.match(result.reason, /work limit.*preview.*restore/);
  for (const work of [0, 1, 2, 17, 100]) { const refused = diff(a, b, { work }); assert.equal(refused.available, false); assert.equal(refused.work, work); }
  const large = "x".repeat(1024 * 1024); valid(diff(large, large), large, large);
});
test("unsafe override budgets, malformed inputs and very long line counts refuse deterministically", () => {
  for (const work of [-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) { assert.equal(diff("x", "y", { work }).available, false); }
  for (const input of [null, {}, { content: "x", hasBom: "yes" }]) { assert.equal(feature.compareRecoveryText(input, text("x")).available, false); }
  assert.equal(diff("\n".repeat(4001), "x").available, false);
  const empty = diff("", "", { bytesPerSide: 0, linesPerSide: 0, work: 0 }); assert.equal(empty.identical, true);
});

class Element {
  children = []; parentElement = null; dataset = {}; attributes = new Map(); listeners = new Map(); disabled = false; hidden = false; value = ""; _text = ""; className = "";
  classList = { add: (...values) => { this.className += " " + values.join(" "); } };
  constructor(tag) { this.tagName = tag.toUpperCase(); }
  get isConnected() { return this === globalThis.document?.body || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { for (const node of nodes) { node.remove?.(); node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentElement = null; this.children = []; this._text = ""; this.append(...nodes); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ""); }
  get childElementCount() { return this.children.length; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  addEventListener(type, listener) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
  click() { if (!this.disabled) for (const action of this.listeners.get("click") ?? []) action({}); }
  fire(type) { for (const action of this.listeners.get(type) ?? []) action({}); }
  focus() {}
  remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } }
  querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector === "button" && child.tagName === "BUTTON") result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
  find(key, value) { if (Object.hasOwn(this.dataset, key) && (value === undefined || this.dataset[key] === value)) return this; for (const child of this.children) { const result = child.find(key, value); if (result) return result; } return null; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function settled(f) { for (let index = 0; index < 10; index++) await tick(); await f.recovery.whenIdle(); for (let index = 0; index < 5; index++) await tick(); }
async function fixture(t, options = {}) {
  globalThis.document = { body: new Element("body"), createElement: tag => new Element(tag) }; globalThis.recoveryNotices = [];
  const path = "Note.md", original = options.original ?? "Kept\r\nOld λ\r\n", current = options.current ?? "Kept\r\nNew 😀\r\n", sha = value => createHash("sha256").update(value).digest("hex");
  const snap = { id: "first", path, ts: Date.now(), content: original, hasBom: true, sourceVersion: sha("\ufeff" + original), reason: "manual" };
  const data = { version: 1, snapshots: options.empty ? [] : [snap], future: { preserve: true } }, calls = [], fileWrites = [], configWrites = [];
  let configuration = structuredClone(data), configVersion = 1, content = current, hasBom = options.hasBom ?? true, missing = false, active = true, activate, cleanup;
  let draft = current, editor = EditorState.create({ doc: current, extensions: [history(), EditorState.lineSeparator.of("\r\n")] });
  const emitter = { offref() {} }, event = () => ({ emitter }), commands = new Map();
  const app = { changingVault: false, vault: { rootPath: "test-vault", readOnly: false, on: event, getFileByPath: () => ({ stat: { size: Buffer.byteLength(content) } }), async readDocument(requested) { calls.push(["read", requested]); await f.beforeRead?.(); if (missing) throw new feature.HostError(404, "Missing"); return { file: { path }, content, hasBom, version: sha((hasBom ? "\ufeff" : "") + content) }; }, async writeDocument(requested, value, version, requireMissing) { calls.push(["write", requested]); const now = missing ? null : sha((hasBom ? "\ufeff" : "") + content); if (now !== version || requireMissing && !missing) throw Error("Target version changed"); content = value.replace(/^\ufeff/, ""); hasBom = !missing ? hasBom : value.startsWith("\ufeff"); missing = false; fileWrites.push(value); return this.readDocument(path); } },
    configuration: { async read() { calls.push(["history-read"]); await f.beforeHistory?.(); return { root: app.vault.rootPath, id: "vault-dotnet-recovery", version: configVersion, data: structuredClone(configuration) }; }, async write(document, next) { if (document.version !== configVersion) throw Error("History conflict"); configVersion++; configuration = structuredClone(next); configWrites.push(structuredClone(next)); } },
    workspace: { get hasUnsavedChanges() { return draft !== content; }, on: event, leaves: () => [], getLeavesOfType: () => [], getActiveFile: () => null, withFileMutation: action => action(), acceptExternalDocuments: documents => { draft = documents[0].content; editor = EditorState.create({ doc: draft, extensions: [history()] }); } },
    core: { busy: false, register(id, factory) { activate = factory; }, state: () => ({ settings: { intervalMinutes: 5, keepDays: 7 } }), on: event, offref() {}, isEnabled: () => active, run: action => action() },
    commands: { install(entries) { for (const entry of entries) commands.set(entry.id, entry); return () => commands.clear(); } },
    metadataCache: { refresh: async () => {} }, notifyEditor: async () => {}, saveAll: async () => { throw Error("Comparison must never save drafts"); }
  };
  const recovery = new feature.FileRecovery(app);
  const f = { app, recovery, snap, calls, fileWrites, configWrites, commands, gates: [], get history() { return configuration; }, get content() { return content; }, set content(value) { content = value; }, get missing() { return missing; }, set missing(value) { missing = value; }, get draft() { return draft; }, get editor() { return editor; }, edit(value) { draft = value; editor = editor.update({ changes: { from: 0, to: editor.doc.length, insert: value } }).state; }, async disable() { active = false; await cleanup(); }, async enable() { active = true; cleanup = await activate(); }, get: (key, value) => document.body.find("recovery" + key, value), action: name => document.body.find("recoveryAction", name), async open() { recovery.openModal(path); await settled(f); }, async click(name) { const button = this.action(name); assert.ok(button, name); button.click(); await settled(f); } };
  recovery.register(app.core); cleanup = await activate();
  t.after(async () => { for (const gate of f.gates) gate.resolve(); if (active) await f.disable(); });
  await settled(f); fileWrites.length = 0; configWrites.length = 0; calls.length = 0;
  return f;
}

test("actual history dialog compares saved text while preserving dirty CodeMirror document and undo history", async t => {
  const f = await fixture(t); f.edit(f.content + "Unsaved draft\r\n"); const state = f.editor, historyBytes = JSON.stringify(f.history), disk = f.content;
  await f.open(); await f.click("compare");
  assert.match(f.get("DiffSummary").textContent, /1 added, 1 removed, 1 unchanged/);
  assert.equal(f.editor, state); assert.equal(undoDepth(f.editor), 1); assert.equal(f.content, disk); assert.equal(JSON.stringify(f.history), historyBytes);
  assert.deepEqual(f.fileWrites, []); assert.deepEqual(f.configWrites, []); assert.equal(f.action("confirm-restore"), null);
  await f.click("review"); assert.match(f.get("Status").textContent, /unsaved views/); assert.equal(f.editor, state);
});
test("dialog renders literal HTML inertly and reports mixed-ending and BOM-only changes", async t => {
  const f = await fixture(t, { original: "<img onerror=alert(1)>\r\n\r\n", current: "<img onerror=alert(1)>\n\n", hasBom: false });
  await f.open(); await f.click("compare");
  assert.match(f.get("DiffSummary").textContent, /0 added, 0 removed, 2 unchanged.*2 line-ending changes; BOM changed/);
  assert.match(f.get("DiffMetadata").textContent, /BOM present.*CRLF 2.*BOM absent.*LF 2/);
  assert.match(f.get("Diff").textContent, /<img onerror=alert\(1\)>/);
  assert.equal(f.get("Diff").children.flatMap(node => node.children).some(node => node.tagName === "IMG"), false);
});
test("no selection and missing current file leave snapshot preview without manufacturing restore authority", async t => {
  const f = await fixture(t, { empty: true }); await f.open(); assert.equal(f.action("compare"), null); assert.equal(f.get("Preview").value, "");
  f.history.snapshots.push(f.snap); await f.click("reload"); f.missing = true; await f.click("compare");
  assert.match(f.get("DiffMissing").textContent, /missing.*no current text/); assert.equal(f.get("Preview").value, f.snap.content); assert.equal(f.action("confirm-restore"), null); assert.deepEqual(f.fileWrites, []);
});
test("comparison refusal keeps ordinary preview copying and guarded restore review available", async t => {
  const f = await fixture(t, { original: "old\n".repeat(4001) }); await f.open(); await f.click("compare");
  assert.match(f.get("DiffRefused").textContent, /line limit.*Copy snapshot.*Review restore/); assert.equal(f.get("Preview").value, f.snap.content);
  assert.ok(f.action("copy")); assert.equal(f.action("review").disabled, false); await f.click("review"); assert.ok(f.action("confirm-restore"), f.get("Status").textContent);
});
test("a held comparison immediately retires an existing restore review and cancellation ignores its late result", async t => {
  const f = await fixture(t); await f.open(); await f.click("review"); const restore = f.action("confirm-restore"), gate = deferred(); f.gates.push(gate); f.beforeRead = () => gate.promise;
  f.action("compare").click(); await tick(); await tick();
  assert.equal(f.action("confirm-restore"), null); assert.ok(f.action("cancel-compare")); assert.equal(f.action("cancel-compare").disabled, false);
  f.action("cancel-compare").click(); restore.disabled = false; restore.click(); gate.resolve(); await settled(f);
  assert.equal(f.get("Diff").hidden, true); assert.equal(f.action("confirm-restore"), null); assert.match(f.get("Status").textContent, /Comparison cancelled/); assert.deepEqual(f.fileWrites, []); assert.deepEqual(f.configWrites, []);
});
test("held results cannot populate a detached, disabled, switched-vault or read-only dialog", async t => {
  for (const kind of ["closed", "disabled", "root", "transition", "readonly"]) {
    const f = await fixture(t); await f.open(); const region = f.get("Diff"), gate = deferred(); f.gates.push(gate); f.beforeRead = () => gate.promise; f.action("compare").click(); await tick(); await tick();
    let disabling;
    if (kind === "closed") f.recovery.modal.close();
    if (kind === "disabled") disabling = f.disable();
    if (kind === "root") f.app.vault.rootPath = "other";
    if (kind === "transition") f.app.changingVault = true;
    if (kind === "readonly") f.app.vault.readOnly = true;
    gate.resolve(); await settled(f); await disabling;
    assert.equal(region.find("recoveryDiffSummary"), null, kind); assert.deepEqual(f.fileWrites, [], kind); assert.deepEqual(f.configWrites, [], kind);
    f.app.vault.rootPath = "test-vault"; f.app.changingVault = false; f.app.vault.readOnly = false;
  }
});
test("history identity replacement and cleared selections refuse comparing stale preview text", async t => {
  const f = await fixture(t); await f.open(); f.history.snapshots[0].content = "Replaced stored snapshot\n";
  await f.click("compare"); assert.match(f.get("Status").textContent, /snapshot changed.*Reload history/); assert.equal(f.get("DiffSummary"), null);
  f.history.snapshots.splice(0); await f.click("compare"); assert.match(f.get("Status").textContent, /no longer in recovery history/); assert.deepEqual(f.fileWrites, []);
});
test("saved comparison never refreshes stale restore version and later disk replacement still refuses restoration", async t => {
  const f = await fixture(t); await f.open(); await f.click("compare"); await f.click("review");
  f.content = "External replacement\r\n"; f.edit(f.content); const disk = f.content;
  await f.click("confirm-restore"); assert.match(f.get("Status").textContent, /changed after the restore review/); assert.equal(f.content, disk); assert.deepEqual(f.fileWrites, []);
});
test("successful restore retains exact original snapshot strings and existing BOM through the same restore path", async t => {
  const f = await fixture(t, { original: "First\r\nSecond\rThird\nFinal 😀" }); await f.open(); await f.click("compare"); await f.click("review"); await f.click("confirm-restore");
  assert.equal(f.content, f.snap.content); assert.equal(f.draft, f.snap.content); assert.equal(f.history.snapshots.find(item => item.id === "first").content, f.snap.content); assert.ok(f.history.snapshots.some(item => item.content === "Kept\r\nNew 😀\r\n")); assert.equal(f.fileWrites.length, 1);
});
test("readonly or inactive methods fail before configuration or file requests, including forced stale actions", async t => {
  const f = await fixture(t); await f.open(); const compare = f.action("compare"); f.app.vault.readOnly = true; f.calls.length = 0;
  for (const action of [() => f.recovery.compareSaved("first"), () => f.recovery.prepareRestore("first"), () => f.recovery.list(), () => f.recovery.capture("Note.md"), () => f.recovery.clearHistory(), () => f.recovery.restore({})]) await assert.rejects(action(), /read-only/);
  compare.disabled = false; compare.click(); await settled(f); assert.deepEqual(f.calls, []); assert.equal(f.get("DiffSummary"), null);
  f.app.vault.readOnly = false; await f.disable(); f.calls.length = 0; await assert.rejects(f.recovery.compareSaved("first"), /no longer active/); assert.deepEqual(f.calls, []);
});
