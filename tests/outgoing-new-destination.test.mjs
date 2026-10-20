import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { undo, redo, undoDepth } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";
import { mentionBulkFixture, installMentionBulkDom, original, deferred } from "./outgoing-mention-bulk-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)); let directory, api;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "outgoing-new-destination-tests-"));
  const output = join(directory, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/outgoing-new-destination";export * from "./client/outgoing-new-destination-source";export * from "./client/outgoing-new-destination-review";export * from "./client/outgoing-mention-authoring";export * from "./client/outgoing-mention-bulk";export {MarkdownView} from "./client/workspace";export {Editor} from "./client/editor";export {FileManager} from "./client/file-manager";export {TFile,TFolder,Vault} from "./client/vault";export {parseMarkdown,outgoingMentions} from "./client/markdown";export {resolveLink} from "./client/links";', resolveDir: root }, outfile: output, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  api = await import(pathToFileURL(output).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/outgoing-new-destination-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

function fixture(text = original, mode = "source") {
  const f = mentionBulkFixture(api, text), { app, view, session } = f, watchers = new Set(), events = new Map(), folders = new Map(["", "Notes", "Targets", "Created"].map(path => [path, new api.TFolder(app.vault, path || "/")]));
  f.config.set("newFileLocation", "root"); f.config.set("newFileFolderPath", "/");
  f.state.creates = 0; f.state.attempts = 0; f.existsReads = []; f.live = mode !== "closed";
  view.sourceEl = { checkVisibility: () => f.visible !== false }; view.mode = mode === "reading" ? "preview" : "source"; view.editingMode = mode === "reading" ? "preview" : mode;
  view.setEditingMode = editing => { view.editingMode = editing; view.mode = editing === "preview" ? "preview" : "source"; };
  app.configuration = { watch(_id, callback) { watchers.add(callback); return () => watchers.delete(callback); } };
  f.changePreference = (key, value) => { f.config.set(key, value); for (const callback of [...watchers]) callback(); };
  f.watchers = watchers;
  app.saveAll = async () => { f.state.saves++; };
  const entry = path => ({ path, basename: path.split("/").at(-1).replace(/\.md$/i, ""), extension: "md", stat: { mtime: 1, ctime: 1, size: 0 } });
  Object.assign(app.vault, {
    getRoot: () => folders.get(""), getFolderByPath: path => folders.get(path.replace(/^\/$/, "")) ?? null,
    getAllLoadedFiles: () => [...f.files.values(), ...folders.values()], assertWritable() { if (this.readOnly) throw Error("read-only"); },
    adapter: { async exists(path) { f.existsReads.push(path); await f.onExists?.(path); return f.disk.has(path) || folders.has(path); } },
    async create(path, content, acknowledged) {
      if (f.disk.has(path)) throw Error("destination exists");
      f.state.creates++; const document = { file: entry(path), content, version: "created-" + f.state.creates, hasBom: false };
      f.disk.set(path, { content, version: document.version, hasBom: false });
      await f.beforeAcknowledgement?.(document);
      acknowledged?.(structuredClone(document)); await f.afterAcknowledgement?.(document);
      const file = new api.TFile(app.vault, document.file); f.files.set(path, file); f.index(file); return file;
    },
  });
  app.metadataCache.refresh = async () => { for (const file of f.files.values()) f.index(file, app.workspace.sessions.get(file.path)?.text ?? f.disk.get(file.path).content); };
  app.metadataCache.pause = async () => {}; app.metadataCache.resume = () => {};
  Object.assign(app.workspace, {
    getLeavesOfType: () => f.live ? [{ view }] : [], getActiveViewOfType: () => f.live ? view : null,
    setActiveLeaf: leaf => { app.workspace.activeLeaf = leaf; },
    on(name, callback) { const set = events.get(name) ?? new Set(); set.add(callback); events.set(name, set); return { emitter: { offref(ref) { set.delete(ref.callback); } }, callback }; },
    getLeaf() { f.state.opens++; const leaf = { view: {}, async setViewState() { await f.beforeOpening?.(); f.live = true; app.workspace.sessions.set(f.source.path, session); view.leaf = leaf; leaf.view = view; view.setEditingMode("source"); app.workspace.activeLeaf = leaf; for (const callback of events.get("file-open") ?? []) callback(); await f.afterOpening?.(); } }; return leaf; },
    async withFileMutation(action) { if (app.workspace.isChangingFiles) throw Error("busy"); app.workspace.isChangingFiles = true; try { await f.beforeMutation?.(); return await action(); } finally { app.workspace.isChangingFiles = false; } },
    hasUnsavedChanges: true,
  });
  app.workspace.activeLeaf = view.leaf;
  if (!f.live) app.workspace.sessions.delete(f.source.path);
  f.candidate = (name = "Target λ") => api.outgoingNewDestinationCandidate(app, f.source, view.editor.getValue(), name);
  f.prepare = async (candidate = f.candidate()) => { assert.ok(candidate); return api.prepareOutgoingNewDestination(candidate, () => f.state.owned); };
  return f;
}

test("named cached proposal is immutable, bounded and transport-free; invalid paths/existing destinations/unsupported syntax refuse", () => {
  const f = fixture(), candidate = f.candidate(); assert.equal(candidate.path, "Target λ.md"); assert.equal(candidate.ranges.length, 2); assert.deepEqual(f.reads, []); assert.deepEqual(f.existsReads, []); assert.equal(f.state.creates, 0);
  assert.throws(() => { candidate.source.text = "rebased"; }, TypeError); assert.throws(() => { candidate.ranges[0].from = 0; }, TypeError); assert.throws(() => { candidate.preferences[0][1] = "current"; }, TypeError);
  for (const name of ["", "../Outside", "CON", "bad?.md", "Missing/Target λ"]) assert.throws(() => f.candidate(name));
  f.add("target Λ.md"); assert.throws(() => f.candidate(), /already exists/);
  assert.throws(() => fixture("# Empty\r\n`Target λ` [[Target λ]] %% Target λ %%\r\n").candidate(), /no supported literal/);
  assert.throws(() => fixture(("Target λ.\r\n").repeat(33)).candidate(), /32/);
  assert.throws(() => fixture("x".repeat(api.NEW_DESTINATION_SOURCE_LIMIT + 1)).candidate(), /262,144/);
});

test("all placement preferences and explicit existing folders are reviewed without inventing templates or headings", () => {
  for (const [location, folder, name, expected] of [["root", "/", "Target λ", "Target λ.md"], ["current", "/", "Target λ", "Notes/Target λ.md"], ["folder", "Created", "Target λ", "Created/Target λ.md"], ["root", "/", "Created/Target λ", "Created/Target λ.md"], ["folder", "Missing", "Target λ", "Target λ.md"]]) {
    const f = fixture(); f.config.set("newFileLocation", location); f.config.set("newFileFolderPath", folder); assert.equal(f.candidate(name).path, expected); assert.equal(f.state.creates, 0);
  }
  for (const [key, value] of [["newFileLocation", { location: "root" }], ["newFileFolderPath", { path: "/" }], ["newLinkFormat", ["shortest"]], ["useMarkdownLinks", "false"]]) { const f = fixture(); f.config.set(key, value); let candidate = null; try { candidate = f.candidate("Created/Target λ"); } catch (error) { assert.match(error.message, /supported new-note/); } assert.equal(candidate, null); assert.deepEqual(f.reads, []); assert.deepEqual(f.existsReads, []); }
});

test("Source and Live Preview reviews show normal Source before creation, keep dirty history, then require a separate real-target link review", async () => {
  for (const mode of ["source", "live-preview", "reading", "closed"]) {
    const f = fixture(original, mode); if (mode !== "closed") f.dirtySuffix(); const before = f.editor.getValue(), editor = f.editor, cm = f.cm, doc = cm.state.doc, saved = f.session.document, depth = undoDepth(cm.state);
    const review = await f.prepare(); assert.throws(() => { review.source.text = "rebased"; }, TypeError); assert.throws(() => { review.source.preferences[0][1] = "relative"; }, TypeError); assert.equal(f.view.getEditingMode(), "source"); assert.equal(f.editor.getValue(), before); assert.equal(f.state.creates, 0); assert.equal(f.state.saves, 0); assert.equal(f.editor, editor); assert.equal(f.cm, cm); assert.equal(cm.state.doc, doc); assert.equal(f.session.document, saved);
    const links = await api.createOutgoingNewDestination(review); assert.equal(f.state.creates, 1); assert.equal(f.disk.get("Target λ.md").content, ""); assert.equal(f.editor.getValue(), before); assert.equal(f.state.saves, 0); assert.equal(undoDepth(cm.state), depth); assert.equal(links.bulk.changes.length, 2);
    await api.applyOutgoingNewDestination(links); assert.equal(undoDepth(cm.state), depth + 1); assert.equal(f.editor.getValue(), links.bulk.text); assert.equal(f.disk.get(f.source.path).content, original);
    undo(cm); assert.equal(f.editor.getValue(), before); assert.ok(f.disk.has("Target λ.md")); redo(cm); assert.equal(f.editor.getValue(), links.bulk.text); assert.equal(f.state.saves, 0); assert.equal(f.watchers.size, 0);
  }
});

test("the actual existing bulk planner owns every wiki/Markdown and shortest/relative/absolute replacement", async () => {
  for (const markdown of [false, true]) for (const format of ["shortest", "relative", "absolute"]) {
    const f = fixture(); f.config.set("useMarkdownLinks", markdown); f.config.set("newLinkFormat", format); const review = await f.prepare(), links = await api.createOutgoingNewDestination(review);
    for (const change of links.bulk.changes) assert.equal(change.insert, f.app.fileManager.generateMarkdownLink(links.created, f.source.path, "", change.label));
    api.cancelOutgoingNewDestination(review); assert.equal(f.editor.getValue(), original); assert.ok(f.disk.has(review.candidate.path)); await assert.rejects(api.applyOutgoingNewDestination(links));
  }
});

test("Cancel before creation performs no write; Cancel after creation keeps the receipt and note without source edits", async () => {
  const f = fixture(), review = await f.prepare(); api.cancelOutgoingNewDestination(review); f.reads.length = 0; f.existsReads.length = 0; await assert.rejects(api.createOutgoingNewDestination(review)); assert.deepEqual(f.reads, []); assert.deepEqual(f.existsReads, []); assert.equal(f.state.creates, 0); assert.equal(f.watchers.size, 0);
  const g = fixture(), next = await g.prepare(); await api.createOutgoingNewDestination(next); api.cancelOutgoingNewDestination(next); assert.equal(g.editor.getValue(), original); assert.equal(api.outgoingNewDestinationReceipt(next).document.file.path, "Target λ.md"); assert.ok(g.disk.has("Target λ.md"));
});

test("readonly, foreign, retired and changed owners refuse before reads, existence checks or allocation", async () => {
  const f = fixture(); f.app.vault.readOnly = true; assert.equal(f.candidate(), null); assert.deepEqual(f.reads, []); assert.deepEqual(f.existsReads, []); assert.equal(f.state.opens, 0);
  for (const change of [f => { f.state.owned = false; }, f => { f.app.vault.readOnly = true; }, f => { f.app.vault.rootPath = "another"; }, f => { f.view.leaf.view = {}; }, f => { f.dirtySuffix(); }, f => { f.session.document = { ...f.session.document }; }, f => { f.view.setEditingMode("preview"); }]) {
    const g = fixture(), review = await g.prepare(); change(g); g.reads.length = 0; g.existsReads.length = 0; await assert.rejects(api.createOutgoingNewDestination(review)); assert.deepEqual(g.reads, []); assert.deepEqual(g.existsReads, []); assert.equal(g.state.creates, 0); api.cancelOutgoingNewDestination(review);
  }
  const g = fixture(), candidate = g.candidate(); await assert.rejects(g.prepare({ ...candidate })); assert.deepEqual(g.reads, []); const review = await g.prepare(candidate); g.reads.length = 0; await assert.rejects(api.createOutgoingNewDestination({ ...review })); assert.deepEqual(g.reads, []); api.cancelOutgoingNewDestination(review);
});

test("accepted preference changes including change/revert retire the original review and remove watchers on cancellation", async () => {
  for (const [key, value] of [["newFileLocation", "current"], ["newFileFolderPath", "Created"], ["newLinkFormat", "relative"], ["useMarkdownLinks", true]]) {
    const f = fixture(), review = await f.prepare(), old = f.config.get(key); f.changePreference(key, value); f.changePreference(key, old); f.reads.length = 0; f.existsReads.length = 0;
    await assert.rejects(api.createOutgoingNewDestination(review)); assert.deepEqual(f.reads, []); assert.deepEqual(f.existsReads, []); assert.equal(f.state.creates, 0); api.cancelOutgoingNewDestination(review); assert.equal(f.watchers.size, 0);
  }
});

test("physical replacements, case collisions and a held creation preflight refuse without overwriting or rebasing", async () => {
  for (const change of [f => f.replacePhysical(f.source.path, "Newer source"), f => f.add("Target λ.md", "Keep existing")]) {
    const f = fixture(), review = await f.prepare(); change(f); await assert.rejects(api.createOutgoingNewDestination(review)); assert.equal(f.state.creates, 0); assert.equal(f.editor.getValue(), original);
  }
  const f = fixture(), review = await f.prepare(), gate = deferred(), entered = deferred(); f.beforeMutation = () => { entered.resolve(); return gate.promise; }; const operation = api.createOutgoingNewDestination(review); await entered.promise; f.state.owned = false; gate.resolve(); await assert.rejects(operation); assert.equal(f.state.creates, 0); assert.equal(f.editor.getValue(), original);
});

test("a real acknowledgement precedes failing cleanup and survives as a detached receipt with dirty Source retained", async () => {
  const f = fixture(); f.dirtySuffix(); const before = f.editor.getValue(), depth = undoDepth(f.cm.state), review = await f.prepare(); f.afterAcknowledgement = () => { throw Error("inventory cleanup failed"); };
  await assert.rejects(api.createOutgoingNewDestination(review), /cleanup failed/); const receipt = api.outgoingNewDestinationReceipt(review); assert.equal(receipt.attempted, true); assert.equal(receipt.document.file.path, review.candidate.path); assert.equal(receipt.document.content, ""); receipt.document.content = "forged";
  assert.equal(api.outgoingNewDestinationReceipt(review).document.content, ""); assert.ok(f.disk.has(review.candidate.path)); assert.equal(f.editor.getValue(), before); assert.equal(undoDepth(f.cm.state), depth); assert.equal(f.state.saves, 0); assert.equal(f.watchers.size, 0);
});

test("uncertain write response never claims acknowledgement or inserts source links, and an acknowledged late cancellation keeps the note", async () => {
  const f = fixture(), review = await f.prepare(); f.beforeAcknowledgement = () => { throw Error("response lost after create"); }; await assert.rejects(api.createOutgoingNewDestination(review), /response lost/); assert.equal(api.outgoingNewDestinationReceipt(review).attempted, true); assert.equal(api.outgoingNewDestinationReceipt(review).document, null); assert.ok(f.disk.has(review.candidate.path)); assert.equal(f.editor.getValue(), original);
  const g = fixture(), next = await g.prepare(), gate = deferred(), entered = deferred(); g.afterAcknowledgement = () => { entered.resolve(); return gate.promise; }; const operation = api.createOutgoingNewDestination(next); await entered.promise; api.cancelOutgoingNewDestination(next); gate.resolve(); await assert.rejects(operation); assert.ok(g.disk.has(next.candidate.path)); assert.equal(g.editor.getValue(), original); assert.ok(api.outgoingNewDestinationReceipt(next).document);
});

test("held final link read and changed destination retain the created note and original Source/Undo", async () => {
  for (const change of [f => f.dirtySuffix(), (f, review) => f.replacePhysical(review.candidate.path, "New target contents"), (f, review) => api.cancelOutgoingNewDestination(review)]) {
    const f = fixture(), review = await f.prepare(), links = await api.createOutgoingNewDestination(review), gate = deferred(), entered = deferred(); f.onRead = path => { if (path === review.candidate.path) { entered.resolve(); return gate.promise; } };
    const operation = api.applyOutgoingNewDestination(links); await entered.promise; change(f, review); const before = f.editor.getValue(), depth = undoDepth(f.cm.state); gate.resolve(); await assert.rejects(operation); assert.equal(f.editor.getValue(), before); assert.equal(undoDepth(f.cm.state), depth); assert.ok(f.disk.has(review.candidate.path));
  }
});

test("unsupported residual matches are counted without silently changing the reviewed eligible range set", async () => {
  const f = fixture(original + "%% Target λ %%\r\n"), candidate = f.candidate(); assert.equal(candidate.ranges.length, 2); assert.equal(candidate.omitted, 1); const review = await f.prepare(candidate), links = await api.createOutgoingNewDestination(review); assert.equal(links.bulk.omitted, 1); await api.applyOutgoingNewDestination(links); assert.match(f.editor.getValue(), /%% Target λ %%/);
});

test("the old FileManager create default still saves and its existing planned-batch branch still rejects dirty views", async () => {
  const f = fixture(); await f.app.fileManager.createLinkedNote("Other new", f.source.path); assert.equal(f.state.saves, 1);
  await assert.rejects(f.app.fileManager.applyMarkdownEdits(f.app.vault.rootPath, []), /Save or reload unsaved views/); assert.equal(f.state.saves, 1);
});

test("actual Vault write receipt fires after POST and before a failed inventory request, without requiring a TFile", async () => {
  const previousFetch = globalThis.fetch, order = []; let receipt;
  const vault = new api.Vault(async () => {}); vault.setSnapshot({ root: "receipt-vault", name: "Receipt", files: [], folders: [], readOnly: false, indexComplete: true });
  globalThis.fetch = async (url, options) => { if (url === "/api/file") { order.push("post"); assert.equal(options.method, "POST"); return new Response(JSON.stringify({ file: { path: "Created.md", basename: "Created", extension: "md", stat: { size: 0, mtime: 1, ctime: 1 } }, content: "", version: "real-write-ack", hasBom: false })); } order.push("inventory"); throw Error("inventory unavailable"); };
  try { await assert.rejects(vault.create("Created.md", "", document => { order.push("acknowledged"); receipt = document; }), /inventory unavailable/); assert.deepEqual(order, ["post", "acknowledged", "inventory"]); assert.equal(receipt.file.path, "Created.md"); assert.equal(receipt.version, "real-write-ack"); assert.equal(vault.getFileByPath("Created.md"), null); }
  finally { globalThis.fetch = previousFetch; }
});

test("stale and readonly controller locks retain Cancel and refuse forced actions before transport or allocation", async () => {
  const f = fixture(), cancel = { dataset: { outgoingNewCancel: "true" }, disabled: true }, create = { dataset: { outgoingNewCreate: "true" }, disabled: false };
  const controller = Object.assign(Object.create(api.OutgoingNewDestinationModal.prototype), { app: f.app, opened: true, host: { current: () => false }, name: {}, contentEl: { querySelectorAll: () => [create, cancel] }, busy: false, terminal: false });
  controller.lock(); assert.equal(create.disabled, true); assert.equal(cancel.disabled, false); let invoked = false;
  await controller.run(async () => { invoked = true; }); assert.equal(invoked, false); assert.deepEqual(f.reads, []); assert.deepEqual(f.existsReads, []); assert.equal(f.state.opens, 0);
  controller.host.current = () => true; f.app.vault.readOnly = true; controller.lock(); assert.equal(cancel.disabled, false); await controller.run(async () => { invoked = true; }); assert.equal(invoked, false); assert.deepEqual(f.reads, []);
  assert.equal(api.openOutgoingNewDestination(f.app, f.source, original, { current: () => true, closed() {} }), null);
});

test("the acknowledged receipt observer receives a detached document without changing the original Vault write result", async () => {
  const previousFetch = globalThis.fetch, vault = new api.Vault(async () => {}), file = { path: "Created.md", basename: "Created", extension: "md", stat: { size: 0, mtime: 1, ctime: 1 } };
  vault.setSnapshot({ root: "receipt-vault", name: "Receipt", files: [], folders: [], readOnly: false, indexComplete: true });
  globalThis.fetch = async url => new Response(JSON.stringify(url === "/api/file" ? { file, content: "", version: "actual-version", hasBom: false } : { root: "receipt-vault", name: "Receipt", files: [file], folders: [], readOnly: false, indexComplete: true }));
  try { const result = await vault.writeDocument("Created.md", "", null, true, receipt => { receipt.file.path = "observer-mutation.md"; receipt.version = "observer-mutation"; }); assert.equal(result.file.path, "Created.md"); assert.equal(result.version, "actual-version"); assert.equal(vault.getFileByPath("Created.md").path, "Created.md"); }
  finally { globalThis.fetch = previousFetch; }
});


function controllerFixture(f) {
  f.app.core.on = () => ({ emitter: { offref() {} } });
  const controller = new api.OutgoingNewDestinationModal(f.app, f.source, f.editor.getValue(), { current: () => f.state.owned, closed() {} });
  // Use the real constructor/fields and onOpen; only the browser focus-trap shell is absent in this pure DOM fixture.
  controller.opened = true; controller.onOpen(); controller.name.value = "Target λ";
  return controller;
}

test("the real controller reports confirmed, uncertain and preflight creation failures without contradicting retained notes", async () => {
  const dom = installMentionBulkDom();
  try {
    for (const outcome of ["confirmed", "uncertain", "preflight"]) {
      const f = fixture(); f.dirtySuffix(); const source = f.editor.getValue(), cm = f.cm, doc = cm.state.doc, session = f.session, saved = session.document, depth = undoDepth(cm.state), controller = controllerFixture(f);
      try {
        await controller.run(() => controller.prepare());
        const intro = controller.contentEl.querySelector('[data-outgoing-new-stage-intro]'), create = controller.contentEl.querySelector('[data-outgoing-new-create]');
        assert.ok(intro && create); assert.match(intro.textContent, /Opening this review does not create the note or change Source/);
        if (outcome === "confirmed") f.afterAcknowledgement = () => { throw Error("Actual post-receipt inventory failure"); };
        else if (outcome === "uncertain") f.beforeAcknowledgement = () => { throw Error("Actual response lost before acknowledgement"); };
        else f.replacePhysical(f.source.path, "Newer physical source");
        await controller.run(() => controller.create());
        assert.equal(controller.contentEl.querySelector('[data-outgoing-new-stage-intro]'), intro, "The currently visible stage paragraph is updated rather than leaving contradictory initial help");
        assert.equal(controller.terminal, true); assert.equal(create.disabled, true); assert.equal(controller.contentEl.querySelector('[data-outgoing-new-cancel]').disabled, false);
        assert.doesNotMatch(intro.textContent, /has not created|No note or link exists yet|has not been.*linked/);
        const receipt = api.outgoingNewDestinationReceipt(controller.review);
        if (outcome === "confirmed") {
          assert.ok(receipt.document); assert.equal(receipt.document.file.path, "Target λ.md"); assert.equal(f.disk.get("Target λ.md").content, "");
          assert.match(intro.textContent, /host confirmed creation of "Target λ\.md".*note was kept/); assert.equal(create.textContent, "Note created"); assert.match(controller.status.textContent, /Actual post-receipt inventory failure/);
        } else if (outcome === "uncertain") {
          assert.equal(receipt.document, null); assert.equal(receipt.attempted, true); assert.ok(f.disk.has("Target λ.md"));
          assert.match(intro.textContent, /could not be confirmed.*may exist; inspect the destination/); assert.equal(create.textContent, "Creation unconfirmed"); assert.doesNotMatch(intro.textContent, /confirmed creation|note was kept/);
        } else {
          assert.equal(receipt.attempted, false); assert.equal(f.disk.has("Target λ.md"), false); assert.equal(f.state.creates, 0); assert.match(intro.textContent, /Creation was not attempted by this review/);
        }
        assert.equal(f.cm, cm); assert.equal(cm.state.doc, doc); assert.equal(f.session, session); assert.equal(session.document, saved); assert.equal(f.editor.getValue(), source); assert.equal(undoDepth(cm.state), depth); assert.equal(f.state.saves, 0);
        const before = { reads: f.reads.length, exists: f.existsReads.length, creates: f.state.creates };
        await controller.run(() => controller.create()); assert.deepEqual({ reads: f.reads.length, exists: f.existsReads.length, creates: f.state.creates }, before, "Forcing a terminal old Create action cannot retry transport");
      } finally { controller.onClose(); }
      assert.equal(f.watchers.size, 0);
      if (outcome !== "preflight") assert.ok(f.disk.has("Target λ.md"), "Closing the failed review retains the real created file");
    }
  } finally { dom.restore(); }
});

test("a late controller error after actual linking reports only the retained creation facts and preserves the real shared Undo", async () => {
  const dom = installMentionBulkDom();
  try {
    const f = fixture(); f.dirtySuffix(); const source = f.editor.getValue(), depth = undoDepth(f.cm.state), controller = controllerFixture(f);
    try {
      await controller.run(() => controller.prepare()); await controller.run(() => controller.create());
      const linked = controller.links.bulk.text; assert.notEqual(linked, source);
      await controller.run(async () => { await controller.apply(); throw Error("Late UI error after the link transaction"); });
      const intro = controller.contentEl.querySelector('[data-outgoing-new-stage-intro]');
      assert.match(intro.textContent, /host confirmed creation of "Target λ\.md".*note was kept/); assert.doesNotMatch(intro.textContent, /not.*linked|not.*applied|has not created|No note or link exists yet/);
      assert.match(controller.status.textContent, /Late UI error/); assert.equal(f.editor.getValue(), linked); assert.equal(undoDepth(f.cm.state), depth + 1); assert.equal(f.state.saves, 0); assert.ok(f.disk.has("Target λ.md"));
      assert.equal(controller.contentEl.querySelector('[data-outgoing-bulk-apply]').disabled, true); assert.equal(controller.contentEl.querySelector('[data-outgoing-new-cancel]').disabled, false);
      undo(f.cm); assert.equal(f.editor.getValue(), source); assert.ok(f.disk.has("Target λ.md"));
    } finally { controller.onClose(); }
    assert.equal(f.watchers.size, 0);
  } finally { dom.restore(); }
});
