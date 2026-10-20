import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { root } from "./host.mjs";
import { assertFloatingState, assertRestoredFloatingState, checkOriginalFloatingImport, fenceDisposableVault, realizedOuterBounds, FLOATING_FIXTURE, FLOATING_NOTE } from "../tools/original-floating-import-scenario.mjs";

const { fixtureDrainScript } = createRequire(import.meta.url)("../tools/web-smoke-quit.cjs");
const good = {
  windows: 1, pending: 0, entries: 1, bounds: { x: 160, y: 120, width: 723, height: 603 },
  viewActive: "be5027423a6a2e59", mainActive: "9feac20460dcfbe4", leaf: true, connected: true,
  separateOwner: true, mainRooted: false, file: "Popout note.md", activeIsLeaf: true,
  viewMode: "source", sourceMode: false, hasEditor: true, ownerGeometry: { devicePixelRatio: 1 },
  openRequests: [{ url: "about:blank", name: "slopsidian-popout-c3acc59766f649ef", features: "popup=yes,left=160,top=120,width=723,height=603" }],
};

async function withVault(run) {
  await mkdir(join(root, ".runtime"), { recursive: true });
  const directory = await realpath(await mkdtemp(join(root, ".runtime", "floating-scenario-")));
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const fake = (directory, state, seen = []) => ({
  directory,
  evaluate: async source => {
    seen.push(source);
    if (source === "app.vault.rootPath") { return directory; }
    if (source === fixtureDrainScript()) { return { app: true, drained: true }; }
    if (source.startsWith("app.workspace.windows.length===0")) { return true; }
    if (source.startsWith("JSON.stringify(app.workspace.getLayout())")) { return "{\"version\":1}"; }
    if (source.includes("entries:")) { return JSON.stringify(state); }
    return true;
  },
  wait: async source => { seen.push("wait:" + source); },
});

test("the runtime scenario seeds the exact fixture and note, asserts the live popout, then cleans up", () => withVault(async directory => {
  const seen = [], reports = [];
  const state = await checkOriginalFloatingImport({ ...fake(directory, good, seen), report: value => reports.push(value) });
  assert.deepEqual(state, good);
  assert.match(reports[0].consent, /not real-pointer consent/);
  assert.ok(seen.some(source => source.includes("importObsidianWorkspace()")), "the real import API is called");
  assert.ok(seen.some(source => source.startsWith("wait:app.vault.getAbstractFileByPath")), "the seeded file is observed before import");
  assert.ok(seen.some(source => source.includes("window.confirm=window.__floatingConfirm")), "confirm is restored");
  assert.ok(seen.some(source => source.includes("changeLayout({\"version\":1})")), "the prior layout is restored so no popout leaks");
  await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" }, "seeded note removed");
  await assert.rejects(readFile(join(directory, ".obsidian", "workspace.json")), { code: "ENOENT" }, "seeded workspace removed");
}));

test("the runtime scenario fails for missing, main-owned, pending-only, stale-active and mismatched-note states", () => withVault(async directory => {
  const bad = {
    missing: { ...good, leaf: false, connected: false, separateOwner: false, activeIsLeaf: false },
    mainOwned: { ...good, separateOwner: false, mainRooted: true },
    pendingOnly: { ...good, windows: 0, pending: 1, leaf: false, connected: false, separateOwner: false },
    staleActive: { ...good, viewActive: "stale", activeIsLeaf: false },
    noteMismatch: { ...good, file: "Other.md" },
    wrongBounds: { ...good, bounds: { x: 0, y: 0, width: 720, height: 520 } },
    disconnected: { ...good, connected: false },
  };
  for (const [name, state] of Object.entries(bad)) {
    const seen = [];
    await assert.rejects(checkOriginalFloatingImport(fake(directory, state, seen)), name);
    assert.ok(seen.some(source => source.includes("changeLayout(")), name + " still restores the layout");
    await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" }, name + " still removes the note");
  }
}));

test("a blocked browser popup must be an explicit pending window; the same state fails when popups are allowed", () => {
  const pending = { ...good, windows: 0, pending: 1, leaf: false, connected: false, separateOwner: false };
  assertFloatingState(pending, { mode: "browser", popupPolicy: "blocked" });
  assert.throws(() => assertFloatingState(pending, { mode: "browser", popupPolicy: "allowed" }));
  assert.throws(() => assertFloatingState({ ...pending, pending: 0 }, { mode: "browser", popupPolicy: "blocked" }));
});

test("the runtime scenario refuses unsafe vaults, a mismatched open vault and different existing files before writing", () => withVault(async directory => {
  await assert.rejects(fenceDisposableVault("relative"), /absolute/);
  await assert.rejects(fenceDisposableVault(homedir()), /home/);
  await assert.rejects(fenceDisposableVault(join(directory, "missing")));
  await assert.rejects(fenceDisposableVault(directory + "\\..\\x"), /absolute normalized/);
  await assert.rejects(checkOriginalFloatingImport({ ...fake(directory, good), evaluate: async () => "C:\\elsewhere" }), /fenced scenario directory/);
  await mkdir(join(directory, ".obsidian"));
  await writeFile(join(directory, ".obsidian", "workspace.json"), "{\"mine\":true}");
  await assert.rejects(checkOriginalFloatingImport(fake(directory, good)), /refusing to replace/);
  assert.equal(await readFile(join(directory, ".obsidian", "workspace.json"), "utf8"), "{\"mine\":true}");
  await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" }, "nothing else was written");
}));

test("a tampered fixture is refused before any write and the note text is the seeded one", () => withVault(async directory => {
  await writeFile(join(directory, "tampered.json"), "{}");
  await assert.rejects(checkOriginalFloatingImport({ ...fake(directory, good), fixture: join(directory, "tampered.json") }), /retained original capture/);
  await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" });
  assert.equal(FLOATING_NOTE.text, "# Floating capture B\n\nPopout note.\n");
  assert.ok((await readFile(FLOATING_FIXTURE)).length === 5797);
}));

test("the browser scenario proves selected-handle ownership without assuming an OS root path", () => withVault(async directory => {
  const base = fake(directory, good);
  const evaluate = async source => {
    if (source === "app.vault.rootPath") { return "browser-vault:fixture"; }
    if (source.startsWith("app.vault.adapter.read(")) {
      const file = JSON.parse(source.slice("app.vault.adapter.read(".length, -1));
      return readFile(join(directory, file), "utf8");
    }
    return base.evaluate(source);
  };
  await checkOriginalFloatingImport({ ...base, evaluate, mode: "browser" });
  const wrong = async source => source.startsWith("app.vault.adapter.read(") ? "other-vault" : evaluate(source);
  await assert.rejects(checkOriginalFloatingImport({ ...base, evaluate: wrong, mode: "browser" }), /exact fenced physical fixture/);
}));

test("a geometry failure retains both model and native-host diagnostics before cleanup", () => withVault(async directory => {
  const reports = [];
  const state = { ...good, bounds: { x: 160, y: 120, width: 724, height: 604 } };
  const command = async method => method === "Target.getTargets"
    ? { targetInfos: [{ type: "page", url: "about:blank", targetId: "popup" }] }
    : { windowId: 1, bounds: { left: 160, top: 120, width: 723, height: 603 } };
  await assert.rejects(checkOriginalFloatingImport({ ...fake(directory, state), command, report: value => reports.push(value) }), /saved bounds/);
  assert.equal(reports[0].bounds.width, 724);
  assert.equal(reports[0].hostWindow.bounds.width, 723);
  await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" });
}));

test("native geometry uses an exact measured pixel conversion while keeping the original request strict", () => {
  assert.deepEqual(realizedOuterBounds(good.bounds, 2.25), { x: 160, y: 120, width: 724, height: 604 });
  assert.deepEqual(realizedOuterBounds({ x: 160, y: 120, width: 724, height: 604 }, 2.25), { x: 160, y: 120, width: 724, height: 604 });
  const realized = { ...good, bounds: realizedOuterBounds(good.bounds, 2.25), ownerGeometry: { devicePixelRatio: 2.25 } };
  assertFloatingState(realized);
  assert.throws(() => assertFloatingState({ ...realized, bounds: { ...realized.bounds, width: 725 } }), /exact native pixel-grid/);
  assert.throws(() => assertFloatingState({ ...realized, openRequests: [{ ...good.openRequests[0], features: "left=160,top=120,width=724,height=604" }] }), /reaches the host unchanged/);
  for (const scale of [undefined, 0, NaN, Infinity, "2.25"]) { assert.throws(() => realizedOuterBounds(good.bounds, scale)); }
});

test("restart verifies a new live view and exact source bytes without inventing a second open request", () => withVault(async directory => {
  const live = structuredClone(good), reports = [];
  let restarts = 0;
  const result = await checkOriginalFloatingImport({
    ...fake(directory, live),
    restart: async () => { restarts++; live.openRequests = []; },
    report: detail => reports.push(detail),
  });
  assert.equal(restarts, 1);
  assert.equal(result.persistence.verified, true);
  assert.deepEqual(result.persistence.restored.openRequests, []);
  assert.equal(result.persistence.restored.hasEditor, true);
  assert.equal(reports.at(-1).persistence.verified, true);
}));

test("a failed layout drain refuses restart and still removes only owned seed files", () => withVault(async directory => {
  const base = fake(directory, good);
  let restarts = 0;
  await assert.rejects(checkOriginalFloatingImport({
    ...base, restart: async () => { restarts++; },
    evaluate: source => source === fixtureDrainScript() ? { drained: false } : base.evaluate(source),
  }), /drain before restart/);
  assert.equal(restarts, 0);
  await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" });
}));

test("a restart geometry failure retains both live snapshots before asserting and still cleans up", () => withVault(async directory => {
  const live = structuredClone(good), reports = [];
  await assert.rejects(checkOriginalFloatingImport({
    ...fake(directory, live),
    restart: async () => { live.bounds = { ...live.bounds, width: 727, height: 607 }; live.openRequests = []; },
    report: detail => reports.push(structuredClone(detail)),
  }), /restart retains the saved window geometry/);
  assert.equal(reports.at(-1).persistence.verified, false);
  assert.deepEqual(reports.at(-1).persistence.beforeRestart.bounds, good.bounds);
  assert.deepEqual(reports.at(-1).persistence.restored.bounds, { ...good.bounds, width: 727, height: 607 });
  await assert.rejects(readFile(join(directory, "Popout note.md")), { code: "ENOENT" });
}));

test("restoration refuses a stale active leaf, missing editor or changed Live Preview mode", () => {
  assertRestoredFloatingState({ ...good, openRequests: [] }, good);
  for (const change of [{ activeIsLeaf: false }, { hasEditor: false }, { sourceMode: true }, { viewMode: "preview" }, { file: "Other.md" }]) {
    assert.throws(() => assertRestoredFloatingState({ ...good, ...change }, good));
  }
});
