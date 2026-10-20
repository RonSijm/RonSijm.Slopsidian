import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth, isolateHistory } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";
import { mentionBulkFixture, installMentionBulkDom, original, targetText, deferred } from "./outgoing-mention-bulk-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)); let directory, api;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "outgoing-bulk-tests-")); const outfile = join(directory, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/outgoing-mention-bulk"; export * from "./client/outgoing-mention-bulk-review"; export * from "./client/outgoing-mention-authoring"; export {OutgoingPaneView} from "./client/outgoing-pane-view"; export {OutgoingLinks} from "./client/outgoing-links"; export {MarkdownView} from "./client/workspace"; export {Editor} from "./client/editor"; export {FileManager} from "./client/file-manager"; export {TFile} from "./client/vault"; export {parseMarkdown,outgoingMentions} from "./client/markdown"; export {resolveLink} from "./client/links";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] }); api = await import(pathToFileURL(outfile).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/outgoing-bulk-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const fixture = text => mentionBulkFixture(api, text);

test("review prepares all exact literal replacements without editing, saving or opening editors, and Cancel retires Apply", async () => {
  const f = fixture(), review = await f.prepare(); assert.equal(review.changes.length, 2); assert.deepEqual(review.changes.map(change => change.label), ["TARGET λ", "Target λ"]);
  assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0); assert.equal(f.transactions.length, 0); assert.deepEqual(f.reads, [f.source.path, f.target.path]);
  assert.equal(f.state.saves, 0); assert.equal(f.state.opens, 0); api.cancelOutgoingMentionBulk(review); f.reads.length = 0;
  await assert.rejects(f.apply(review), /review changed/); assert.deepEqual(f.reads, []); assert.equal(f.editor.getValue(), original);
});

test("Source and Live Preview link all reviewed occurrences in one atomic shared Undo/Redo step while retaining earlier dirty history", async () => {
  for (const mode of ["source", "live-preview"]) {
    const f = fixture(); f.view.editingMode = mode; f.dirtySuffix(); const dirty = f.editor.getValue(), review = await f.prepare(); f.transactions.length = 0; await f.apply(review);
    assert.equal(f.transactions.length, 1); assert.equal(f.transactions[0].annotation(Transaction.userEvent), "input.link-mentions"); assert.equal(f.editor.getValue(), review.text); assert.equal(undoDepth(f.cm.state), 2);
    assert.equal(undo(f.cm), true); assert.equal(f.editor.getValue(), dirty); assert.equal(redo(f.cm), true); assert.equal(f.editor.getValue(), review.text); undo(f.cm); undo(f.cm); assert.equal(f.editor.getValue(), original);
    assert.equal(f.disk.get(f.source.path).content, original); assert.equal(f.disk.get(f.source.path).hasBom, true); assert.equal(f.disk.get(f.target.path).content, targetText); assert.equal(f.state.saves, 0); assert.equal(f.state.opens, 0);
  }
});

test("all wiki/Markdown path preferences retain exact labels, CRLF and explicitly selected duplicate destinations", async () => {
  for (const markdown of [false, true]) for (const format of ["shortest", "relative", "absolute"]) {
    const f = fixture(); f.config.set("useMarkdownLinks", markdown); f.config.set("newLinkFormat", format); f.add("Other/Destination.md", targetText); const review = await f.prepare(); await f.apply(review);
    for (const change of review.changes) { const link = api.parseMarkdown(change.insert).links[0]; assert.equal(link.kind, markdown ? "markdown" : "wiki"); assert.equal(f.app.metadataCache.resolveReference(link, f.source.path).file, f.target); }
    assert.equal(f.editor.getValue().replaceAll("\r\n", "").includes("\n"), false); assert.match(f.editor.getValue(), /Keep 😀/); assert.equal(undo(f.cm), true); assert.equal(f.editor.getValue(), original);
  }
});

test("overlapping alias unions remain literal and are counted alongside complete eligible occurrences", async () => {
  const f = fixture("Mary Jane Doe and Mary Jane.\r\n"), target = f.add("People.md", '---\naliases: ["Mary Jane", "Jane Doe"]\n---\n'); const review = await f.prepare(f.candidate(target));
  assert.equal(review.omitted, 1); assert.equal(review.changes.length, 1); assert.equal(review.changes[0].label, "Mary Jane"); await f.apply(review); assert.equal(f.editor.getValue(), "Mary Jane Doe and [[People|Mary Jane]].\r\n");
});

test("code, links, embeds, YAML, comments, references and unsupported inline grammar remain exact literal bytes", async () => {
  const text = '---\r\nname: Target λ\r\n---\r\nTarget λ and Target λ.\r\n`Target λ` %% Target λ %% <!-- Target λ -->\r\n[Target λ][ref] [[Target λ]] ![[Target λ]]\r\n[ref]: Existing.md\r\n\r\n| A | B |\r\n|---|---|\r\n| Target λ | X |\r\n';
  const f = fixture(text), review = await f.prepare(); assert.equal(review.changes.length, 2); await f.apply(review);
  let expected = text; for (const change of [...review.changes].reverse()) expected = expected.slice(0, change.from) + change.insert + expected.slice(change.to);
  assert.equal(f.editor.getValue(), expected); assert.equal(undo(f.cm), true); assert.equal(f.editor.getValue(), text);
});

test("the 32-occurrence bound is explicit and never silently truncates a larger group", async () => {
  const f = fixture(Array.from({ length: 33 }, () => "Target λ.").join("\r\n")), candidate = f.candidate(); assert.match(candidate.unavailable, /32/);
  await assert.rejects(f.prepare(candidate), /not be shortened/); assert.deepEqual(f.reads, []); assert.equal(f.transactions.length, 0);
  const allowed = fixture(Array.from({ length: 32 }, () => "Target λ.").join("\r\n")), review = await allowed.prepare(); assert.equal(review.changes.length, 32); await allowed.apply(review); assert.equal(undoDepth(allowed.cm.state), 1); assert.equal(allowed.transactions.length, 1);
});

test("render-time group witnesses generate no links and a partial/overlapping/stale match list cannot become a bulk action", async () => {
  const f = fixture(), generate = f.app.fileManager.generateMarkdownLink.bind(f.app.fileManager); let generated = 0; f.app.fileManager.generateMarkdownLink = (...args) => { generated++; return generate(...args); };
  const candidate = f.candidate(); assert.equal(generated, 0); assert.equal(candidate.ranges.length, 2); const partial = f.candidate(f.target, [candidate.ranges[0]]); await assert.rejects(f.prepare(partial), /changed/);
  assert.equal(f.candidate(f.target, [candidate.ranges[0], candidate.ranges[0]]), null); assert.equal(f.editor.getValue(), original);
});

test("held reviews reject changed source, destination, physical-document reference, editor, CM owner, mode and preferences before transport", async () => {
  for (const change of [f => f.dirtySuffix(), f => f.view.editor = Object.assign(Object.create(api.Editor.prototype), { cm: f.cm }), f => f.editor.cm = { ...f.cm },
    f => f.cm.state = EditorState.create({ doc: f.editor.getValue(), extensions: [history(), EditorState.lineSeparator.of("\r\n")] }), f => f.view.session = { ...f.session }, f => f.session.document = { ...f.session.document },
    f => f.documents.get(f.target.path).document = { ...f.documents.get(f.target.path).document }, f => f.documents.get(f.target.path).cache = { ...f.documents.get(f.target.path).cache },
    f => f.documents.get(f.target.path).cache.frontmatter.aliases = ["Other"], f => f.add(f.target.path, targetText), f => f.add(f.source.path, original), f => f.target.path = "Moved.md",
    f => f.app.vault.rootPath = "other", f => f.view.mode = "preview", f => f.view.editingMode = "live-preview", f => f.state.owned = false,
    f => f.config.set("newLinkFormat", "relative"), f => f.config.set("useMarkdownLinks", true), f => f.session.isSaving = true, f => f.session.isReloading = true, f => f.cm.composing = true,
    f => f.cm.dom.isConnected = false, f => f.view.leaf.view = {}, f => f.app.workspace.isChangingFiles = true, f => f.app.workspace.isChangingLayout = true]) {
    const f = fixture(), review = await f.prepare(); change(f); const before = f.view.editor.getValue(); f.reads.length = 0; await assert.rejects(f.apply(review), /changed/); assert.deepEqual(f.reads, []); assert.equal(f.view.editor.getValue(), before);
  }
});

test("genuine read-only, locked and unavailable Source owners refuse new or retained actions with zero API reads", async () => {
  for (const change of [f => f.app.vault.readOnly = true, f => f.state.core = false, f => f.app.core.busy = true, f => f.view.isLoaded = false,
    f => f.cm.state = f.cm.state.update({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }).state,
    f => f.cm.state = f.cm.state.update({ effects: StateEffect.appendConfig.of(EditorView.editable.of(false)) }).state]) {
    const f = fixture(), candidate = f.candidate(), review = await f.prepare(candidate); change(f); f.reads.length = 0; assert.equal(f.candidate(), null);
    await assert.rejects(f.prepare(candidate), /changed/); await assert.rejects(f.apply(review), /changed/); assert.deepEqual(f.reads, []); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
  }
});

test("source/target physical version, saved bytes and BOM are checked both before review and before Apply", async () => {
  for (const phase of ["prepare", "apply"]) for (const path of ["source", "target"]) for (const field of ["version", "content", "hasBom"]) {
    const f = fixture(); f.dirtySuffix(); const candidate = f.candidate(), review = phase === "apply" ? await f.prepare(candidate) : null, dirty = f.editor.getValue(), physical = f.disk.get(f[path].path);
    physical[field] = field === "hasBom" ? false : physical[field] + "external Ω";
    await assert.rejects(phase === "prepare" ? f.prepare(candidate) : f.apply(review), /changed/); assert.equal(f.editor.getValue(), dirty); assert.equal(undoDepth(f.cm.state), 1); assert.equal(f.state.saves, 0);
  }
});

test("held prepare and Apply reads cannot renew changed owner, destination, preferences or cancellation", async () => {
  for (const phase of ["prepare", "apply"]) for (const change of [f => f.state.owned = false, f => f.app.vault.readOnly = true, f => f.config.set("useMarkdownLinks", true), f => f.dirtySuffix(), f => f.documents.get(f.target.path).document = { ...f.documents.get(f.target.path).document }]) {
    const f = fixture(), candidate = f.candidate(), review = phase === "apply" ? await f.prepare(candidate) : null, gate = deferred(); f.onRead = path => path === f.target.path ? gate.promise : undefined;
    const pending = phase === "prepare" ? f.prepare(candidate) : f.apply(review); await Promise.resolve(); change(f); const before = f.editor.getValue(); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.editor.getValue(), before);
  }
  const f = fixture(), review = await f.prepare(), gate = deferred(); f.onRead = () => gate.promise; const pending = f.apply(review); await Promise.resolve(); api.cancelOutgoingMentionBulk(review); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.editor.getValue(), original);
});

test("a changed generated spelling or one newly unsupported range refuses the entire reviewed batch", async () => {
  for (const all of [false, true]) {
    const f = fixture(), review = await f.prepare(), generate = f.app.fileManager.generateMarkdownLink.bind(f.app.fileManager);
    f.app.fileManager.generateMarkdownLink = (...args) => all || args[3] === "Target λ" ? "[[Existing|" + args[3] + "]]" : generate(...args);
    await assert.rejects(f.apply(review), /changed|complete/); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
  }
});

test("CM transaction filters cannot accept only part of the batch or alter the reviewed output", async () => {
  for (const partial of [false, true]) {
    const f = fixture(), review = await f.prepare(); f.cm.state = f.cm.state.update({ effects: StateEffect.appendConfig.of(EditorState.transactionFilter.of(transaction => {
      if (!transaction.docChanged) return transaction; return partial ? { changes: { from: 0, insert: "Partial " } } : [];
    })) }).state;
    await assert.rejects(f.apply(review), /No text was changed/); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0); assert.equal(f.transactions.length, 0);
  }
});

test("CM filters cannot silently remove the shared Undo entry or isolation while accepting identical bulk text", async () => {
  for (const annotations of [[isolateHistory.of("full"), Transaction.addToHistory.of(false)], [Transaction.userEvent.of("input.link-mentions")]]) {
    const f = fixture(); f.dirtySuffix(); const dirty = f.editor.getValue(), review = await f.prepare(); f.transactions.length = 0;
    f.cm.state = f.cm.state.update({ effects: StateEffect.appendConfig.of(EditorState.transactionFilter.of(transaction => transaction.docChanged ? { changes: transaction.changes, annotations } : transaction)) }).state;
    await assert.rejects(f.apply(review), /No text was changed/); assert.equal(f.editor.getValue(), dirty); assert.equal(undoDepth(f.cm.state), 1); assert.equal(f.transactions.length, 0);
  }
});

test("selection/effect-only changes retain review while two concurrent Apply calls permit exactly one atomic edit", async () => {
  const f = fixture(), review = await f.prepare(), document = f.cm.state.doc; f.cm.dispatch({ selection: { anchor: 4 }, effects: StateEffect.appendConfig.of([]) }); assert.equal(f.cm.state.doc, document);
  const results = await Promise.allSettled([f.apply(review), f.apply(review)]); assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(undoDepth(f.cm.state), 1); assert.equal(f.editor.getValue(), review.text);
});

test("the shared review renders literal labels and replacement strings, line/column identity, Apply, Cancel and Escape", async () => {
  const dom = installMentionBulkDom();
  try {
    const f = fixture(), review = await f.prepare(); let applied = 0, cancelled = 0; const panel = api.outgoingMentionBulkReviewPanel(review, () => applied++, () => cancelled++);
    assert.equal(panel.querySelectorAll("[data-outgoing-bulk-range]").length, 2); assert.equal(panel.querySelectorAll("[data-outgoing-bulk-before]")[0].textContent, "TARGET λ"); assert.match(panel.children[2].children[0].children[0].textContent, /Line 7, column 8/);
    await panel.querySelector("[data-outgoing-bulk-apply]").fire("click"); await panel.querySelector("[data-outgoing-bulk-cancel]").fire("click"); await panel.fire("keydown", { key: "Escape" }); assert.equal(applied, 1); assert.equal(cancelled, 2); assert.equal(f.editor.getValue(), original);
  } finally { dom.restore(); }
});

function paneFixture() {
  const dom = installMentionBulkDom(), f = fixture(), pane = Object.create(api.OutgoingPaneView.prototype), container = new dom.Element("div"); container.root = true;
  Object.assign(pane, { app: f.app, leaf: {}, sourceRoot: f.app.vault.rootPath, containerEl: container, contentEl: container, options: { file: f.source.path, followActiveFile: false, linksCollapsed: false, unlinkedCollapsed: false }, snapshot: null, signature: "", revision: 0, request: 0, navigationToken: 0, queued: false, opening: false, message: "", mentionActions: new Map(), bulkActions: new Map(), authoringAuthority: null, intentAuthority: null, mentionTargets: [], authoringWatch: null, follow: new dom.Element("input"), caption: new dom.Element("p"), status: new dom.Element("p"), results: new dom.Element("div") });
  container.append(pane.results, pane.status); pane.leaf.view = pane; Object.defineProperty(pane, "isLoaded", { value: true, writable: true });
  return { ...f, pane, dom, button: () => pane.results.querySelector('[data-outgoing-mention-bulk="' + f.target.path + '"]'), cleanup() { pane.closeBulkReview(); pane.cancelAuthoringWatch(); dom.restore(); } };
}

test("actual workspace pane Review/Cancel leaves all text unchanged and Apply uses one original editor Undo", async () => {
  const f = paneFixture();
  try {
    await f.pane.refresh(); const button = f.button(); assert.ok(button && !button.disabled); await f.pane.reviewBulkMentions(button); assert.ok(f.pane.bulkReview); assert.equal(f.editor.getValue(), original);
    await f.pane.bulkReviewEl.querySelector("[data-outgoing-bulk-cancel]").fire("click"); assert.equal(f.pane.bulkReview, null); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
    await f.pane.reviewBulkMentions(button); const review = f.pane.bulkReview; await f.pane.applyBulkMentions(review); assert.equal(f.editor.getValue(), review.text); assert.equal(undoDepth(f.cm.state), 1); assert.equal(f.pane.bulkReview, null); undo(f.cm); assert.equal(f.editor.getValue(), original);
  } finally { f.cleanup(); }
});

test("actual pane retires same-text target-document replacement and blocks stale retained Apply before reads", async () => {
  const f = paneFixture();
  try {
    await f.pane.refresh(); await f.pane.reviewBulkMentions(f.button()); const review = f.pane.bulkReview; f.documents.get(f.target.path).document = { ...f.documents.get(f.target.path).document }; f.reads.length = 0;
    await f.pane.refresh(); assert.equal(f.pane.bulkReview, null); await f.pane.applyBulkMentions(review); assert.deepEqual(f.reads, []); assert.equal(f.editor.getValue(), original);
    const candidate = f.pane.bulkActions.get(f.button().dataset.outgoingKey); assert.equal(candidate.targetDocument, f.documents.get(f.target.path).document); await f.pane.reviewBulkMentions(f.button()); assert.ok(f.pane.bulkReview, "fresh current control reacquires its own reviewed candidate");
  } finally { f.cleanup(); }
});

test("actual legacy sidebar shares literal Review/Cancel and one-step Apply, and refuses disconnected old review controls", async () => {
  const dom = installMentionBulkDom(), f = fixture(), legacy = new api.OutgoingLinks(f.app), panel = new dom.Element("section"); panel.root = true; legacy.panel = panel; legacy.pinnedFile = f.source.path; legacy.unlinkedCollapsed = false;
  try {
    legacy.render(); let button = panel.querySelector('[data-outgoing-mention-bulk="' + f.target.path + '"]'); assert.ok(button && !button.disabled);
    await legacy.reviewBulkMentions(f.candidate(), button, panel, legacy.revision, legacy.generation, f.app.vault.rootPath, f.source.path); const first = legacy.bulkReview, old = legacy.bulkReviewEl;
    assert.ok(first); assert.equal(f.editor.getValue(), original); await old.querySelector("[data-outgoing-bulk-cancel]").fire("click"); assert.equal(legacy.bulkReview, null); assert.equal(undoDepth(f.cm.state), 0);
    await old.querySelector("[data-outgoing-bulk-apply]").fire("click"); assert.equal(f.editor.getValue(), original);
    button = panel.querySelector('[data-outgoing-mention-bulk="' + f.target.path + '"]'); await legacy.reviewBulkMentions(f.candidate(), button, panel, legacy.revision, legacy.generation, f.app.vault.rootPath, f.source.path); const review = legacy.bulkReview;
    await legacy.bulkReviewEl.querySelector("[data-outgoing-bulk-apply]").fire("click"); for (let index = 0; index < 8; index++) await Promise.resolve();
    assert.equal(f.editor.getValue(), review.text); assert.equal(undoDepth(f.cm.state), 1); undo(f.cm); assert.equal(f.editor.getValue(), original);
  } finally { legacy.closeBulkReview(); legacy.cancelAuthoringWatch(); dom.restore(); }
});
