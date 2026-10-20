import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root } from "./host.mjs";

let temporary, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "history-menu-tests-"));
  const entry = join(temporary, "menu.mjs");
  await build({ stdin: { contents: 'export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
function fixture() {
  const calls = [], view = Object.create(WebHistoryView.prototype);
  Object.defineProperty(view, "_loaded", { value: true, writable: true });
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, core: { busy: false, isEnabled: () => true } };
  Object.assign(view, { app, disposed: false, busy: false, revision: 0, copySequence: 0, error: { textContent: "" }, status: { textContent: "Saved visits" }, leaf: { pinned: false, view, async setViewState(state) { calls.push({ type: "here", state }); } }, provider: { id: "webviewer", async openUrl(url, newTab) { calls.push({ type: "tab", url, newTab }); }, history: { async edit(snapshot, id, current) { if (!current()) { throw new Error("Stale history review"); } calls.push({ type: "remove", snapshot, id }); } } } });
  view.perform = action => action();
  const snapshot = { document: { root: "vault-a", version: "one", data: { opaque: [1, true] } }, history: {} };
  const entry = { id: "selected", url: "https://example.com/story", title: "Story", visitedAt: 1 };
  return { view, app, calls, snapshot, entry };
}
test("Visit open-here replaces the owning history leaf and open-new-tab delegates without mutating the reviewed entry", async () => {
  const f = fixture(), original = structuredClone(f.entry);
  await f.view.invokeVisit(f.snapshot, f.entry, "here"); await f.view.invokeVisit(f.snapshot, f.entry, "tab");
  assert.deepEqual(f.calls, [{ type: "here", state: { type: "webviewer", state: { url: f.entry.url }, active: true } }, { type: "tab", url: f.entry.url, newTab: true }]);
  assert.deepEqual(f.entry, original);
});
test("Pinned history leaves reject replacement while a new browser tab remains available", async () => {
  const f = fixture(); f.view.leaf.pinned = true;
  await assert.rejects(f.view.invokeVisit(f.snapshot, f.entry, "here"), /Unpin/); assert.deepEqual(f.calls, []);
  await f.view.invokeVisit(f.snapshot, f.entry, "tab"); assert.equal(f.calls[0].type, "tab");
});
test("Every visit action refuses an unloaded, replaced, busy, disabled, transitioning or foreign-vault pane", async () => {
  for (const change of [f => { f.view._loaded = false; }, f => { f.view.disposed = true; }, f => { f.view.leaf.view = {}; }, f => { f.view.busy = true; }, f => { f.app.changingVault = true; }, f => { f.app.core.busy = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.app.vault.rootPath = "vault-b"; }]) {
    for (const action of ["tab", "here", "copy", "remove"]) {
      const f = fixture(); change(f); await assert.rejects(f.view.invokeVisit(f.snapshot, f.entry, action), /no longer active/); assert.deepEqual(f.calls, []);
    }
  }
});
test("Menu removal uses the exact reviewed document/id and rechecks pane ownership inside the serialized history edit", async () => {
  const f = fixture(); await f.view.invokeVisit(f.snapshot, f.entry, "remove");
  assert.equal(f.calls[0].snapshot, f.snapshot); assert.equal(f.calls[0].id, f.entry.id);
  f.view.provider.history.edit = async (_snapshot, _id, current) => { f.app.vault.rootPath = "vault-b"; assert.equal(current(), false); throw new Error("Stale history review"); };
  await assert.rejects(f.view.invokeVisit(f.snapshot, f.entry, "remove"), /Stale history review/);
});
test("Visit actions revalidate URLs and reject unknown operations before navigation or history changes", async () => {
  for (const url of ["javascript:alert(1)", "file:///secret", "https://user:pass@example.com", "https://example.com/\nwrong"]) {
    for (const action of ["here", "copy"]) {
      const f = fixture(); await assert.rejects(f.view.invokeVisit(f.snapshot, { ...f.entry, url }, action), /History requires|Invalid URL/); assert.deepEqual(f.calls, []);
    }
  }
  const f = fixture(); await assert.rejects(f.view.invokeVisit(f.snapshot, f.entry, "unknown"), /Unknown history visit action/); assert.deepEqual(f.calls, []);
});

async function clipboardFixture(clipboard, action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
  try { await action(); }
  finally { if (original) { Object.defineProperty(globalThis, "navigator", original); } else { delete globalThis.navigator; } }
}

test("Copy link address writes only the selected validated URL, remains available when pinned and changes no history or leaf state", async () => {
  const writes = [], f = fixture(); f.view.leaf.pinned = true; f.view.error.textContent = "Old clipboard failure";
  const entry = { ...f.entry, url: "https://example.com/中文?q=a%26b#section", title: "<b>Not clipboard content</b>" }, original = structuredClone({ entry, snapshot: f.snapshot });
  await clipboardFixture({ writeText: async value => { writes.push(value); }, readText: () => { throw Error("Clipboard must never be read"); } }, async () => {
    await f.view.invokeVisit(f.snapshot, entry, "copy");
  });
  assert.deepEqual(writes, [new URL(entry.url).href]); assert.deepEqual(f.calls, []);
  assert.deepEqual({ entry, snapshot: f.snapshot }, original); assert.equal(f.view.error.textContent, ""); assert.equal(f.view.status.textContent, "Link address copied.");
});

test("Unavailable and denied clipboard writes report failure without navigation, history edits or false success, then permit retry", async () => {
  for (const clipboard of [undefined, {}, { writeText: async () => { throw Error("Clipboard permission denied"); } }]) {
    const f = fixture();
    await clipboardFixture(clipboard, async () => { await assert.rejects(f.view.invokeVisit(f.snapshot, f.entry, "copy"), /Clipboard|clipboard/); });
    assert.equal(f.view.status.textContent, "Link address was not copied."); assert.deepEqual(f.calls, []);
    await clipboardFixture({ writeText: async () => {} }, async () => { await f.view.invokeVisit(f.snapshot, f.entry, "copy"); });
    assert.equal(f.view.status.textContent, "Link address copied.");
  }
});

test("Clipboard completion or rejection cannot overwrite newer feedback after another copy, refresh, unload, replacement, disable or a vault transition", async () => {
  for (const change of [f => { f.view.copySequence++; }, f => { f.view.revision++; }, f => { f.view.disposed = true; }, f => { f.view._loaded = false; }, f => { f.view.leaf.view = {}; }, f => { f.view.busy = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }]) {
    for (const rejected of [false, true]) {
      const f = fixture(); let finish, writes = 0;
      await clipboardFixture({ writeText: () => { writes++; return new Promise((resolve, reject) => { finish = () => rejected ? reject(Error("Late clipboard rejection")) : resolve(); }); } }, async () => {
        const pending = f.view.invokeVisit(f.snapshot, f.entry, "copy"); assert.equal(writes, 1); change(f);
        f.view.status.textContent = "Newer pane feedback"; f.view.error.textContent = "Newer pane error"; finish(); await pending;
      });
      assert.equal(f.view.status.textContent, "Newer pane feedback"); assert.equal(f.view.error.textContent, "Newer pane error"); assert.deepEqual(f.calls, []);
    }
  }
});
