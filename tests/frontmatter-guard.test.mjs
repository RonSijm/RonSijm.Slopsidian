import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, FileManager, Editor;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "frontmatter-guard-tests-"));
  const outfile = join(directory, "guard.mjs");
  await build({ stdin: { contents: 'export { FileManager } from "./client/file-manager"; export { Editor } from "./client/editor";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  ({ FileManager, Editor } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/frontmatter-guard-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

const original = '\ufeff---\r\nstatus: "Open" # retain comment\r\nopaque: [ kept ]\r\n---\r\n\r\nBody 😀 λ.\r\n';
function fixture(open = true) {
  let state = EditorState.create({ doc: original, extensions: [history(), EditorState.lineSeparator.of("\r\n")] });
  const editor = Object.create(Editor.prototype);
  editor.cm = { get state() { return state; }, dispatch(...specs) { state = specs.length === 1 && specs[0].startState ? specs[0].state : state.update(...specs).state; } };
  const file = { path: "Note.md", extension: "md" }, calls = [], document = { content: original, version: "original" };
  const session = { document, get text() { return editor.getValue(); }, leaves: new Set([{ editor }]), async save() { calls.push("save"); await session.onSave?.(); }, async reload() { calls.push("reload"); } };
  const sessions = new Map(open ? [[file.path, session]] : []), app = {
    changingVault: false,
    vault: { rootPath: "owned-vault", getAbstractFileByPath: () => file, async readDocument() { calls.push("read"); return document; }, async writeDocument() { calls.push("write"); } },
    workspace: { isChangingFiles: false, isChangingLayout: false, sessions, leaves: () => [], track: operation => operation },
    metadataCache: { getDocument: () => ({ text: original }), async refresh() { calls.push("metadata"); } },
  };
  const manager = Object.assign(Object.create(FileManager.prototype), { app, operations: new Map(), batch: null });
  return { app, manager, file, editor, session, document, calls };
}

test("a revoked Properties choice refuses before preliminary note saves or a callback", async () => {
  const f = fixture(); let changed = false;
  await assert.rejects(f.manager.processFrontMatter(f.file, () => { changed = true; }, undefined, () => { throw Error("revoked choice"); }), /revoked choice/);
  assert.equal(changed, false); assert.deepEqual(f.calls, []); assert.equal(f.editor.getValue(), original);
});

test("queued choices revalidate ownership when their earlier operation drains", async () => {
  const f = fixture(); let release, valid = true, changes = 0;
  f.manager.operations.set("owned-vault\0Note.md", new Promise(resolve => { release = resolve; }));
  const pending = f.manager.processFrontMatter(f.file, () => { changes++; }, undefined, () => { if (!valid) throw Error("closed row"); });
  valid = false; release();
  await assert.rejects(pending, /closed row/); assert.equal(changes, 0); assert.deepEqual(f.calls, []);
});

test("full-source guards run again after asynchronous save/reload and preserve a newer body", async () => {
  const f = fixture(); let checks = 0, changes = 0;
  f.session.onSave = async () => { f.editor.replaceRange("Newer ", { line: 5, ch: 0 }); };
  await assert.rejects(f.manager.processFrontMatter(f.file, () => { changes++; }, undefined, content => { checks++; if (content !== original) throw Error("source changed"); }), /source changed/);
  assert.equal(checks, 2); assert.equal(changes, 0); assert.deepEqual(f.calls, ["save", "reload"]);
  assert.equal(f.editor.getValue(), original.replace("Body", "Newer Body"));
});

test("closed-note writes check freshly read source before invoking the mutation callback", async () => {
  const f = fixture(false); let checks = 0, changes = 0;
  f.document.content = original.replace("Body", "External Body");
  await assert.rejects(f.manager.processFrontMatter(f.file, () => { changes++; }, undefined, content => { checks++; if (content !== original) throw Error("external source"); }), /external source/);
  assert.equal(checks, 2); assert.equal(changes, 0); assert.deepEqual(f.calls, ["read"]);
});

test("guard callbacks must be synchronous and cannot defer validation until after a write", async () => {
  const f = fixture(); let changes = 0;
  await assert.rejects(f.manager.processFrontMatter(f.file, () => { changes++; }, undefined, async () => {}), /guard must finish synchronously/);
  assert.equal(changes, 0); assert.deepEqual(f.calls, []);
});

test("Properties edits retain comments, BOM/CRLF and body with an Undo step separate from earlier typing", async () => {
  const f = fixture();
  f.editor.replaceRange("Typed ", { line: 5, ch: 0 });
  const before = f.editor.getValue(), seen = [];
  await f.manager.processFrontMatter(f.file, values => { values.status = "Complete"; }, undefined, content => { seen.push(content); assert.equal(content, before); });
  const changed = f.editor.getValue();
  assert.equal(seen.length, 2); assert.equal(changed, before.replace('"Open"', '"Complete"'));
  assert.ok(changed.endsWith("Typed Body 😀 λ.\r\n"));
  f.editor.undo(); assert.equal(f.editor.getValue(), before);
  f.editor.undo(); assert.equal(f.editor.getValue(), original);
  f.editor.redo(); assert.equal(f.editor.getValue(), before);
  f.editor.redo(); assert.equal(f.editor.getValue(), changed);
});

test("legacy three-argument frontmatter changes still use the guarded exact-source edit", async () => {
  const f = fixture(); await f.manager.processFrontMatter(f.file, values => { values.status = "Legacy"; });
  assert.ok(f.editor.getValue().includes('status: "Legacy" # retain comment'));
  f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.calls, ["save", "reload", "save", "metadata"]);
});
