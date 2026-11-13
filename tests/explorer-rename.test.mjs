import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_EXPLORER_RENAME, planSelectedNoteRenames, renameSelectedNotes } from "../client/explorer-rename.ts";

const options = overrides => ({ find: "Old", replace: "New", prefix: "", suffix: "", ...overrides });
const notes = paths => paths.map(path => ({ path }));
const plan = (paths, fields = {}, occupied = []) => planSelectedNoteRenames("fixture", notes(paths), options(fields), occupied);

test("literal case-sensitive replace-all stays in each folder, preserves extension spelling and freezes its review", () => {
  const files = notes(["Old folder/Old.Old λ.MD", "Elsewhere/Old 😀.md"]), fields = options({ prefix: "Before ", suffix: " after" });
  const reviewed = planSelectedNoteRenames("fixture", files, fields, files.map(file => file.path));
  assert.deepEqual(reviewed.items.map(item => [item.from, item.to]), [["Old folder/Old.Old λ.MD", "Old folder/Before New.New λ after.MD"], ["Elsewhere/Old 😀.md", "Elsewhere/Before New 😀 after.md"]]);
  fields.replace = "Changed later";
  assert.equal(reviewed.options.replace, "New"); assert.ok(Object.isFrozen(reviewed) && Object.isFrozen(reviewed.items) && Object.isFrozen(reviewed.items[0]) && Object.isFrozen(reviewed.options));
  assert.deepEqual(files.map(file => file.path), ["Old folder/Old.Old λ.MD", "Elsewhere/Old 😀.md"]);
  assert.throws(() => plan(["old.md"]), /keep its current name/);
});

test("find text is literal rather than a regex, replacement dollars stay literal and prefix-only naming is explicit", () => {
  assert.equal(plan(["a.[x]a.[x].md"], { find: ".[x]", replace: "$&" }).items[0].to, "a$&a$&.md");
  assert.equal(plan(["Name.md"], { find: "", replace: "", prefix: "Reviewed ", suffix: " λ" }).items[0].to, "Reviewed Name λ.md");
  assert.throws(() => plan(["Name.md"], { find: "", replace: "new" }), /text to find/);
  assert.throws(() => plan(["Old.md", "Unchanged.md"]), /keep its current name/, "a partial find cannot silently skip a member");
});

test("empty, unsafe, traversal, hidden, reserved, oversized and non-Markdown names refuse the complete plan", () => {
  for (const replace of ["", "../Elsewhere", "folder/name", "folder\\name", ".hidden", "CON", "NUL.txt", "COM1", "COM¹", "LPT²", "Bad?", "Bad:", "Bad\nname", "Bad\0name", "\ud800", "a".repeat(253)]) {
    assert.throws(() => plan(["Old.md"], { replace }), /empty or unsafe|too long|keep its current/, replace);
  }
  for (const path of ["../Old.md", "/Old.md", "folder//Old.md", ".obsidian/Old.md", "Old.canvas", "Old.md\0", "Old\\Other.md"]) assert.throws(() => plan([path]), /unsupported/, path);
  assert.throws(() => plan(["Old.md"], { suffix: "a".repeat(257) }), /256/);
  assert.throws(() => planSelectedNoteRenames("fixture", notes(["Old.md"]), { ...options(), prefix: null }, []), /text/);
});

test("selection bounds and duplicate source identities are checked without truncating an intent", () => {
  assert.equal(MAX_EXPLORER_RENAME, 20);
  assert.throws(() => plan([]), /1–20/);
  assert.throws(() => plan(Array.from({ length: 21 }, (_, index) => "Old " + index + ".md")), /1–20/);
  assert.equal(plan(Array.from({ length: 20 }, (_, index) => "Old " + index + ".md")).items.length, 20);
  assert.throws(() => plan(["Old.md", "OLD.MD"]), /duplicate note/);
});

test("new paths refuse names that cannot round-trip through normal wiki and Markdown link rewrites", () => {
  for (const replace of ["New]name", "New`code`name", "New`name", " New", "New ", "\u00a0New", "New\u00a0", "New(name", "New)name", "New)(name"]) {
    assert.throws(() => plan(["Old.md"], { replace }), /unsupported link name/, replace);
  }
  for (const folder of ["Bad]", "Bad`", "Bad(", " Bad", "Bad "]) {
    assert.throws(() => plan([folder + "/Old.md"]), /unsupported link name|unsupported Markdown/, folder);
  }
  for (const replace of ["New[name", "New [[name", "New # ^ % $ λ 😀", "New(name)", "New((name))"]) {
    assert.equal(plan(["Old.md"], { replace }).items[0].to, replace + ".md");
  }
});

test("occupied files/folders, case-only destinations, converging replacements and rename chains are refused", () => {
  for (const occupied of ["New.md", "NEW.MD"]) assert.throws(() => plan(["Old.md"], {}, [occupied]), /occupied or duplicated/);
  assert.throws(() => plan(["Old.md"], { replace: "OLD" }), /occupied or duplicated/);
  assert.throws(() => plan(["AB.md", "BA.md"], { find: "A", replace: "" }), /occupied or duplicated/);
  assert.throws(() => plan(["Old.md", "OldOld.md"], { find: "Old", replace: "OldOld" }), /occupied or duplicated/, "a destination occupied by another selected source cannot form a chain");
  assert.throws(() => plan(["ab.md", "b.md"], { find: "a", replace: "", prefix: "a" }), /keep its current name|occupied or duplicated/);
  assert.throws(() => plan(["Old.md", "Old.md.md"], { find: ".md", replace: "" }), /keep its current name|occupied or duplicated/);
});

function fixture(paths = ["In/Old A.md", "In/Old B.md"]) {
  const inventory = new Map(), calls = [], app = { changingVault: false, vault: { rootPath: "fixture", readOnly: false }, workspace: { isChangingLayout: false, isChangingFiles: false }, core: { busy: false, isEnabled: () => true } };
  const files = paths.map(path => { const file = { path, vault: app.vault }; inventory.set(path, file); return file; });
  Object.assign(app.vault, { getFileByPath: path => inventory.get(path) ?? null, getAbstractFileByPathInsensitive: path => [...inventory.values()].find(file => file.path.toLowerCase() === path.toLowerCase()) ?? null });
  const f = { app, files, inventory, calls, current: true };
  app.fileManager = { async renameFile(file, to, updateLinks, review) {
    calls.push({ from: file.path, to, updateLinks });
    await f.beforeWrite?.(file, to);
    if (!review.guard()) { throw new Error("Guard refused after SaveAll/prewrite"); }
    inventory.delete(file.path); file.path = to; inventory.set(to, file);
    await f.afterWrite?.(file, to);
  } };
  f.plan = () => planSelectedNoteRenames("fixture", files, options(), [...inventory.keys()]);
  f.run = (reviewed = f.plan(), links = true) => renameSelectedNotes(app, reviewed, links, () => f.current);
  return f;
}

test("execution delegates in reviewed order to ordinary renames with link preference and a fresh guard", async () => {
  for (const links of [true, false]) {
    const f = fixture(), reviewed = f.plan(), result = await f.run(reviewed, links);
    assert.equal(result.error, null); assert.deepEqual(result.renamed, reviewed.items); assert.deepEqual(result.remaining, []);
    assert.deepEqual(f.calls, [{ from: "In/Old A.md", to: "In/New A.md", updateLinks: links }, { from: "In/Old B.md", to: "In/New B.md", updateLinks: links }]);
    assert.deepEqual([...f.inventory.keys()], ["In/New A.md", "In/New B.md"]);
  }
});

test("root, read-only, pane, layout, core and selected identity changes refuse before the first rename", async () => {
  for (const revoke of [f => { f.app.vault.rootPath = "other"; }, f => { f.app.vault.readOnly = true; }, f => { f.app.changingVault = true; }, f => { f.app.workspace.isChangingLayout = true; }, f => { f.app.workspace.isChangingFiles = true; }, f => { f.app.core.busy = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.current = false; }, f => { f.inventory.set(f.files[1].path, { ...f.files[1] }); }, f => { f.files[0].path = "Elsewhere.md"; }, f => { f.inventory.set("In/New B.md", { path: "In/New B.md" }); }]) {
    const f = fixture(), reviewed = f.plan(); revoke(f); const result = await f.run(reviewed);
    assert.equal(result.renamed.length, 0); assert.equal(result.remaining.length, 2); assert.match(result.error, /changed/); assert.deepEqual(f.calls, []);
  }
});

test("the normal rename guard rechecks SaveAll/prewrite changes but admits its own temporary file lock", async () => {
  for (const revoke of [f => { f.current = false; }, f => { f.app.vault.rootPath = "other"; }, f => { f.inventory.set("In/New B.md", { path: "In/New B.md" }); }]) {
    const f = fixture(), reviewed = f.plan(); f.beforeWrite = () => revoke(f); const result = await f.run(reviewed);
    assert.equal(result.renamed.length, 0); assert.equal(f.calls.length, 1); assert.match(result.error, /Guard refused/); assert.equal(f.files[0].path, "In/Old A.md");
  }
  const f = fixture(); f.beforeWrite = () => { f.app.workspace.isChangingFiles = true; }; f.afterWrite = () => { f.app.workspace.isChangingFiles = false; };
  assert.equal((await f.run()).error, null);
});

test("a later failure retains acknowledged renames and the exact unattempted remainder without rollback", async () => {
  const f = fixture(), reviewed = f.plan(); f.beforeWrite = file => { if (file === f.files[1]) throw new Error("Second rename failed"); };
  const result = await f.run(reviewed);
  assert.deepEqual(result.renamed, [reviewed.items[0]]); assert.deepEqual(result.remaining, [reviewed.items[1]]); assert.match(result.error, /Second rename failed.*completed renames were kept/);
  assert.equal(f.files[0].path, "In/New A.md"); assert.equal(f.files[1].path, "In/Old B.md"); assert.equal(f.calls.length, 2);
});

test("post-acknowledgement cleanup failures count the observed destination once and stop the remainder", async () => {
  const f = fixture(), reviewed = f.plan(); f.afterWrite = () => { throw new Error("Rename hook cleanup failed"); };
  const result = await f.run(reviewed);
  assert.deepEqual(result.renamed, [reviewed.items[0]]); assert.deepEqual(result.remaining, [reviewed.items[1]]); assert.match(result.error, /cleanup failed/); assert.equal(f.calls.length, 1);
  const replay = await f.run(reviewed); assert.equal(replay.renamed.length, 0); assert.equal(f.calls.length, 1, "a stale original review cannot replay its acknowledged first rename");
});

test("changing a later source or occupying its destination after one rename stops before another dispatch", async () => {
  for (const change of [f => { f.current = false; }, f => { f.inventory.set("In/New B.md", { path: "In/New B.md" }); }, f => { f.inventory.set("In/Old B.md", { ...f.files[1] }); }]) {
    const f = fixture(), reviewed = f.plan(); f.afterWrite = () => change(f); const result = await f.run(reviewed);
    assert.equal(result.renamed.length, 1); assert.equal(result.remaining.length, 1); assert.equal(f.calls.length, 1); assert.equal(f.files[1].path, "In/Old B.md");
  }
});
