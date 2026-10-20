import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";

let directory, Workspace, configureBrowserHost, transportRequest;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "workspace-transition-tests-"));
  const output = join(directory, "workspace.cjs");
  await build({ stdin: { contents: 'export { Workspace } from "./client/workspace"; export { configureBrowserHost } from "./client/contracts";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "silent" });
  ({ Workspace, configureBrowserHost } = createRequire(import.meta.url)(output));
  configureBrowserHost({ request: (...args) => transportRequest(...args) });
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/workspace-transition-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
function fixture(respond = async () => ({ status: 204 })) {
  const calls = [], workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    app: { changingVault: false, vault: { rootPath: "vault-A" } }, restoring: false, changingViews: 0, changingFiles: false,
    restorationFailed: false, tasks: new Set(), layoutWrite: Promise.resolve(),
  });
  workspace.getLayout = () => ({ version: 1, future: { retained: [true, "A"] } });
  transportRequest = async (path, method, body) => { calls.push({ path, method, body }); return respond(calls.length); };
  return { workspace, calls };
}

test("vault transitions never enqueue obsolete automatic layout saves", async () => {
  const { workspace, calls } = fixture(); workspace.app.changingVault = true;
  await workspace.requestSaveLayout(); await workspace.flushLayout();
  assert.deepEqual(calls, [], "Closing old core views after host selection must not queue old-root writes.");
  workspace.app.changingVault = false; workspace.app.vault.rootPath = "vault-B";
  await workspace.requestSaveLayout();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, "/api/workspace?root=vault-B");
});

test("the transition checkpoint drains pending writes before taking and saving the final opaque layout", async () => {
  const first = gate(), final = gate();
  const { workspace, calls } = fixture(async index => { await (index === 1 ? first : final).promise; return { status: 204 }; });
  const previous = workspace.requestSaveLayout(); await tick();
  workspace.app.changingVault = true;
  let saved = false;
  const checkpoint = workspace.saveLayoutBeforeVaultChange().then(() => { saved = true; });
  await tick(); assert.equal(calls.length, 1); assert.equal(saved, false);
  const finalLayout = { version: 1, future: { retained: [true, "last state"] } };
  workspace.getLayout = () => structuredClone(finalLayout);
  first.release(); await previous; await tick();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].body, finalLayout); assert.equal(saved, false);
  const late = workspace.requestSaveLayout(); await tick(); assert.equal(calls.length, 2);
  final.release(); await checkpoint; await late; assert.equal(saved, true);
  await workspace.flushLayout(); assert.equal(calls.length, 2, "Later cleanup flushes remain paused.");
});

test("a failed pending write aborts the checkpoint and normal saves recover after editing resumes", async () => {
  const { workspace, calls } = fixture(async index => ({ status: index === 1 ? 500 : 204, error: "Expected storage failure" }));
  await assert.rejects(workspace.requestSaveLayout(), /Expected storage failure/);
  workspace.app.changingVault = true;
  await assert.rejects(workspace.saveLayoutBeforeVaultChange(), /Expected storage failure/);
  assert.equal(calls.length, 1, "The checkpoint must not silently replace a failed write.");
  workspace.app.changingVault = false; await workspace.requestSaveLayout(); assert.equal(calls.length, 2);
});

test("a failed final checkpoint is reported and cannot leave automatic saving permanently disabled", async () => {
  const { workspace, calls } = fixture(async index => ({ status: index === 1 ? 507 : 204, error: "Expected final checkpoint failure" }));
  workspace.app.changingVault = true;
  await assert.rejects(workspace.saveLayoutBeforeVaultChange(), /Expected final checkpoint failure/);
  assert.equal(calls.length, 1);
  workspace.app.changingVault = false; await workspace.flushLayout(); assert.equal(calls.length, 2);
});

test("checkpoint persistence retains invalid-restoration protection and requires the transition owner", async () => {
  const { workspace, calls } = fixture();
  await assert.rejects(workspace.saveLayoutBeforeVaultChange(), /vault change/i);
  workspace.app.changingVault = true; workspace.restorationFailed = true;
  await assert.rejects(workspace.saveLayoutBeforeVaultChange(), /unreadable layout has been retained/);
  assert.equal(calls.length, 0);
});

test("the checkpoint waits for tracked view work and safely handles the initial vault chooser without a root", async () => {
  const view = gate(), { workspace, calls } = fixture(); workspace.app.changingVault = true;
  workspace.tasks.add(view.promise); void view.promise.then(() => workspace.tasks.delete(view.promise));
  const checkpoint = workspace.saveLayoutBeforeVaultChange(); await tick(); assert.equal(calls.length, 0);
  view.release(); await checkpoint; assert.equal(calls.length, 1);
  workspace.app.vault.rootPath = null; await workspace.saveLayoutBeforeVaultChange(); assert.equal(calls.length, 1);
});
