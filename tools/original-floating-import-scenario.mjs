import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FLOATING_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "original-obsidian-1.12.7", "workspace.floating-open.json");
export const FLOATING_FIXTURE_SHA256 = "f082d04a790f104f195e849a59ba81e13547eb8a75875c3a09e81d1c4c02fdf9";
export const FLOATING_NOTE = { path: "Popout note.md", text: "# Floating capture B\n\nPopout note.\n" };
const FLOATING_ACTIVE = "be5027423a6a2e59";
const FLOATING_WINDOW_NAME = "slopsidian-popout-c3acc59766f649ef";
const BOUNDS = { x: 160, y: 120, width: 723, height: 603 };
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const { fixtureDrainScript } = createRequire(import.meta.url)("./web-smoke-quit.cjs");

/** The target must be an ordinary, disposable vault directory: never a drive root, home, the repository, a link or another reparse point. */
export async function fenceDisposableVault(directory) {
  assert.ok(typeof directory === "string" && resolve(directory) === directory, "the scenario vault must be an absolute normalized path");
  assert.notEqual(parse(directory).root.toLowerCase(), directory.toLowerCase(), "a drive root is never a scenario vault");
  assert.ok(!same(directory, homedir()) && !same(directory, REPOSITORY), "neither the home directory nor the repository is a scenario vault");
  const inside = relative(join(REPOSITORY, ".runtime"), directory);
  assert.ok(inside && !inside.startsWith("..") && !isAbsolute(inside), "the scenario vault must be inside this repository's owned runtime fixtures");
  const info = await lstat(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), "the scenario vault must be a real directory, not a link");
  assert.ok(same(await realpath(directory), directory), "the scenario vault must not traverse a junction or link");
}

/** Seeds one file only if absent or already identical; an existing different file is somebody's data and is never replaced. */
async function seed(path, bytes) {
  let existing = null;
  try { existing = await readFile(path); } catch (error) { if (error?.code !== "ENOENT") { throw error; } }
  if (existing) { assert.ok(Buffer.from(bytes).equals(existing), "refusing to replace a different existing " + path); return false; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
  return true;
}

const probe = `(()=>{const w=app.workspace,id=${JSON.stringify(FLOATING_ACTIVE)},l=w.getLayout(),entry=l.views?.["workspace-windows"],leaf=w.getLeafById(id),el=leaf?.view?.containerEl,owner=el?.ownerDocument?.defaultView;
return JSON.stringify({windows:w.windows.length,pending:w.pendingPopoutCount,entries:entry?.windows?.length??0,bounds:entry?.windows?.[0]?.bounds??null,viewActive:entry?.active??null,mainActive:l.active,
leaf:!!leaf,connected:!!el&&el.isConnected,separateOwner:!!owner&&owner!==window&&owner.closed===false,mainRooted:!!leaf&&leaf.getRoot()===w.rootSplit,
file:leaf?.getViewState?.().state?.file??null,activeIsLeaf:w.activeLeaf===leaf,viewMode:leaf?.getViewState?.().state?.mode??null,sourceMode:leaf?.getViewState?.().state?.source??null,hasEditor:!!leaf?.view?.editor?.cm,
modelBounds:w.windows[0]?.bounds??null,openRequests:window.__floatingOpenRequests??[],ownerGeometry:owner?{screenX:owner.screenX,screenY:owner.screenY,outerWidth:owner.outerWidth,outerHeight:owner.outerHeight,innerWidth:owner.innerWidth,innerHeight:owner.innerHeight,devicePixelRatio:owner.devicePixelRatio}:null})})()`;

/** Electron rounds requested sizes out to device pixels and native bounds back out to DIPs; measured by the independent native control. */
export function realizedOuterBounds(bounds, scale) {
  assert.ok(Number.isFinite(scale) && scale >= 0.25 && scale <= 8, "a measured default-zoom device scale is required");
  const size = value => Math.ceil(Math.ceil(value * scale) / scale);
  return { ...bounds, width: size(bounds.width), height: size(bounds.height) };
}

function assertLiveFloatingView(state) {
  assert.equal(state.pending, 0, "the window is live, not merely pending");
  assert.equal(state.windows, 1, "one live popout window");
  assert.equal(state.viewActive, FLOATING_ACTIVE, "the original active leaf is the popout's active leaf");
  assert.equal(state.leaf, true, "the floating leaf exists");
  assert.equal(state.connected, true, "the floating view is connected");
  assert.equal(state.mainRooted, false, "the floating leaf is not rooted in the main area");
  assert.equal(state.separateOwner, true, "the floating view is owned by a separate, open window");
  assert.equal(state.file, FLOATING_NOTE.path, "the floating leaf shows the seeded note");
  assert.equal(state.activeIsLeaf, true, "the floating leaf is the workspace's active leaf");
  assert.equal(state.viewMode, "source", "the original editor mode is retained");
  assert.equal(state.sourceMode, false, "the original Live Preview flag is retained");
  assert.equal(state.hasEditor, true, "the restored view has a real editor");
}

/** Asserts the observed state of the imported original floating window; exported so it can be exercised against synthetic failures. */
export function assertFloatingState(state, { mode = "desktop", popupPolicy = "allowed" } = {}) {
  const requests = (state.openRequests ?? []).filter(request => request.name === FLOATING_WINDOW_NAME);
  assert.equal(requests.length, 1, "the original window is requested exactly once");
  assert.equal(requests[0].url, "about:blank");
  const features = new Map(requests[0].features.split(",").map(feature => feature.split("=")));
  const requested = { x: Number(features.get("left")), y: Number(features.get("top")), width: Number(features.get("width")), height: Number(features.get("height")) };
  assert.deepEqual(requested, BOUNDS, "the original persisted geometry reaches the host unchanged");
  assert.equal(state.entries, 1, "exactly the one original window was converted");
  if (mode === "browser" && popupPolicy === "blocked") {
    assert.deepEqual(state.bounds, BOUNDS, "a pending window retains the original geometry");
    assert.equal(state.windows, 0, "a blocked popup opens no window");
    assert.equal(state.pending, 1, "a blocked popup is an explicit pending window, not data loss");
    return;
  }
  const expected = realizedOuterBounds(BOUNDS, state.ownerGeometry?.devicePixelRatio);
  assert.deepEqual(state.bounds, expected, "saved bounds match the exact native pixel-grid realization, not a tolerance");
  assertLiveFloatingView(state);
}

export function assertRestoredFloatingState(state, previous, { mode = "desktop", popupPolicy = "allowed" } = {}) {
  assert.equal(state.entries, 1, "the saved original window remains present after restart");
  if (mode === "browser" && popupPolicy === "blocked") {
    assert.equal(state.windows, 0);
    assert.equal(state.pending, 1, "the refused saved window remains retryable after reload");
    assert.deepEqual(state.bounds, previous.bounds);
    return;
  }
  assert.deepEqual(state.bounds, realizedOuterBounds(previous.bounds, state.ownerGeometry?.devicePixelRatio), "restart retains the saved window geometry");
  assertLiveFloatingView(state);
}

/** Imports the exact captured original workspace into a DISPOSABLE vault through the real command and checks the live popout. Programmatic confirm only: this is not real-pointer consent. Returns with the popout closed and the seeded files removed. */
export async function checkOriginalFloatingImport({ evaluate, wait, command, restart, directory, report = () => {}, fixture = FLOATING_FIXTURE, mode = "desktop", popupPolicy = "allowed" }) {
  assert.ok(restart === undefined || typeof restart === "function", "restart must be the owned runner callback");
  await fenceDisposableVault(directory);
  const bytes = await readFile(fixture);
  assert.equal(sha(bytes), FLOATING_FIXTURE_SHA256, "fixture bytes are the retained original capture");
  const rootPath = await evaluate("app.vault.rootPath");
  if (mode === "browser") {
    assert.ok(typeof rootPath === "string" && rootPath.startsWith("browser-vault:"), "the open vault is a selected local-folder handle, not a remote mount");
  } else {
    assert.ok(typeof rootPath === "string" && same(rootPath, directory), "the open vault is exactly the fenced scenario directory");
  }
  assert.equal(await evaluate("app.workspace.windows.length===0&&app.workspace.pendingPopoutCount===0"), true, "the scenario starts without popouts");
  const target = join(directory, ".obsidian", "workspace.json"), note = join(directory, FLOATING_NOTE.path);
  const created = [];
  let prior = null;
  let marker = null;
  let token = null;
  try {
    if (mode === "browser") {
      marker = "Floating import owner " + randomUUID() + ".md";
      token = randomUUID();
      const markerPath = join(directory, marker);
      await writeFile(markerPath, token, { flag: "wx" });
      created.push(markerPath);
      assert.equal(await evaluate(`app.vault.adapter.read(${JSON.stringify(marker)})`), token, "the selected folder handle reads the exact fenced physical fixture");
    }
    if (await seed(target, bytes)) { created.push(target); }
    if (await seed(note, FLOATING_NOTE.text)) { created.push(note); }
    await wait(`app.vault.getAbstractFileByPath(${JSON.stringify(FLOATING_NOTE.path)})!==null`, "the original floating note is in the live vault inventory");
    prior = await evaluate("JSON.stringify(app.workspace.getLayout())");
    await evaluate(`(()=>{window.__floatingConfirm=window.confirm;window.confirm=()=>true;return true})()`);
    await evaluate(`(()=>{window.__floatingOpen=window.open;window.__floatingOpenRequests=[];window.open=function(...args){window.__floatingOpenRequests.push({url:args[0],name:args[1],features:args[2]});return Reflect.apply(window.__floatingOpen,this,args)};return true})()`);
    await evaluate(`(async()=>{await app.workspace.importObsidianWorkspace();return true})()`);
    await wait(`!app.workspace.isChangingLayout&&app.workspace.getLeafById(${JSON.stringify(FLOATING_ACTIVE)})!==null`, "the imported original layout is applied");
    if (!(mode === "browser" && popupPolicy === "blocked")) {
      await wait(`(()=>{const w=app.workspace,leaf=w.getLeafById(${JSON.stringify(FLOATING_ACTIVE)}),el=leaf?.view?.containerEl,owner=el?.ownerDocument?.defaultView;return w.windows.length===1&&w.pendingPopoutCount===0&&!!el?.isConnected&&!!owner&&owner!==window&&owner.closed===false&&w.activeLeaf===leaf})()`, "the converted floating window and active view are live");
    }
    const state = JSON.parse(await evaluate(probe));
    if (command && !(mode === "browser" && popupPolicy === "blocked")) {
      try {
        const { targetInfos } = await command("Target.getTargets");
        const popups = targetInfos.filter(target => target.type === "page" && target.url === "about:blank");
        assert.equal(popups.length, 1, "one owned popup debugger target");
        state.hostWindow = await command("Browser.getWindowForTarget", { targetId: popups[0].targetId });
      } catch (error) {
        state.hostGeometryDiagnosticError = String(error?.message ?? error);
      }
    }
    report({ ...state, originalSha256: FLOATING_FIXTURE_SHA256, geometryPolicy: "original host request exact; saved native sizes use measured outward device-pixel/DIP roundtrip", consent: "programmatic window.confirm stub; not real-pointer consent" });
    assertFloatingState(state, { mode, popupPolicy });
    assert.equal(sha(await readFile(target)), FLOATING_FIXTURE_SHA256, "the original workspace.json is never rewritten by import");
    if (restart) {
      const drain = await evaluate(fixtureDrainScript());
      assert.equal(drain.drained, true, "the imported layout and configuration drain before restart");
      state.persistence = {
        verified: false,
        method: mode === "browser" ? "owned page navigation and handle reconnection" : "full owned Electron and .NET restart",
        drain,
        beforeRestart: JSON.parse(await evaluate(probe)),
      };
      report({ ...state, originalSha256: FLOATING_FIXTURE_SHA256, geometryPolicy: "original host request exact; saved native sizes use measured outward device-pixel/DIP roundtrip", consent: "programmatic window.confirm stub; not real-pointer consent" });
      await restart();
      await wait(`!app.workspace.isChangingLayout&&app.workspace.getLeafById(${JSON.stringify(FLOATING_ACTIVE)})!==null`, "the saved floating leaf is restored after restart");
      if (!(mode === "browser" && popupPolicy === "blocked")) {
        await wait(`(()=>{const w=app.workspace,leaf=w.getLeafById(${JSON.stringify(FLOATING_ACTIVE)}),el=leaf?.view?.containerEl,owner=el?.ownerDocument?.defaultView;return w.windows.length===1&&w.pendingPopoutCount===0&&!!el?.isConnected&&!!owner&&owner!==window&&owner.closed===false&&w.activeLeaf===leaf})()`, "the saved floating window and active view are restored");
      }
      if (mode === "browser") {
        assert.equal(await evaluate(`app.vault.adapter.read(${JSON.stringify(marker)})`), token, "reload reconnects the same selected physical fixture");
      } else {
        assert.ok(same(await evaluate("app.vault.rootPath"), directory), "restart opens the same fenced native fixture");
      }
      const restored = JSON.parse(await evaluate(probe));
      state.persistence.restored = restored;
      report({ ...state, originalSha256: FLOATING_FIXTURE_SHA256, geometryPolicy: "original host request exact; saved native sizes use measured outward device-pixel/DIP roundtrip", consent: "programmatic window.confirm stub; not real-pointer consent" });
      assertRestoredFloatingState(restored, state, { mode, popupPolicy });
      assert.equal(sha(await readFile(target)), FLOATING_FIXTURE_SHA256, "restart does not rewrite the original workspace");
      assert.equal(await readFile(note, "utf8"), FLOATING_NOTE.text, "restart keeps the exact note bytes");
      state.persistence.verified = true;
      report({ ...state, originalSha256: FLOATING_FIXTURE_SHA256, geometryPolicy: "original host request exact; saved native sizes use measured outward device-pixel/DIP roundtrip", consent: "programmatic window.confirm stub; not real-pointer consent" });
    }
    return state;
  } finally {
    await evaluate(`(()=>{if(window.__floatingConfirm){window.confirm=window.__floatingConfirm;delete window.__floatingConfirm}return true})()`);
    await evaluate(`(()=>{if(window.__floatingOpen){window.open=window.__floatingOpen;delete window.__floatingOpen}delete window.__floatingOpenRequests;return true})()`);
    if (prior) {
      await evaluate(`(async()=>{await app.workspace.changeLayout(${prior});return true})()`);
      await wait("!app.workspace.isChangingLayout&&app.workspace.windows.length===0&&app.workspace.pendingPopoutCount===0", "the popout is closed and the prior layout restored");
    }
    for (const path of created) { await rm(path, { force: true }); }
  }
}
