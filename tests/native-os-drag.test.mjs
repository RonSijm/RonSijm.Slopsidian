import test from "node:test";
import assert from "node:assert/strict";
import { buildDragPlan, cssToClient, osMouseDrag, planPath } from "../tools/native-os-drag.mjs";
import { osDragHop, runOsDragChain, stampExpression, geometryExpression } from "../tools/native-os-drag-scenario.mjs";

const waitFor = async fn => { for (let i = 0; i < 4; i += 1) { if (await fn()) { return; } } throw new Error("wait timed out"); };
const inner = { width: 800, height: 600, dpr: 1.5 };
const base = { pid: 4242, sourceTitle: "A-main", targetTitle: "B-pop", from: { x: 100, y: 20 }, to: { x: 300, y: 40 }, sourceInner: inner, targetInner: inner };

test("css points convert by dpr and out-of-viewport points are refused", () => {
  assert.deepEqual(cssToClient({ x: 100, y: 20 }, inner), { x: 150, y: 30 });
  assert.throws(() => cssToClient({ x: 800, y: 1 }, inner), /outside/);
  assert.throws(() => cssToClient({ x: NaN, y: 1 }, inner), /finite/);
  assert.throws(() => cssToClient({ x: 1, y: 1 }, { width: 10, height: 10 }), /devicePixelRatio/);
});

test("plan requires an exact pid, distinct titles and measured geometry", () => {
  assert.throws(() => buildDragPlan({ ...base, pid: 0 }), /process id/);
  assert.throws(() => buildDragPlan({ ...base, targetTitle: "A-main" }), /different/);
  assert.throws(() => buildDragPlan({ ...base, targetTitle: "" }), /titles/);
  const plan = buildDragPlan(base);
  assert.deepEqual(plan.from, { x: 150, y: 30 });
  assert.equal(plan.path.at(-1).local, "target");
  assert.deepEqual(planPath(plan.from, plan.to).at(-1), { local: "target", x: plan.to.x, y: plan.to.y });
});

test("structured diagnostics are retained when the driver refuses or the exec rejects", async () => {
  const refused = { failed: true, error: "Screen point 1,2 (source) is not over the expected owned window", overChecks: [{ label: "source", expectedHwnd: 10, hitHwnd: 20, rootHwnd: 20, rootPid: 9, foregroundHwnd: 30, foregroundPid: 8, focusReturn: false }], measurements: { sourcePoint: [1, 2] } };
  const e1 = await osMouseDrag(base, async () => refused).then(() => null, e => e);
  assert.match(e1.message, /not over the expected owned window/);
  assert.equal(e1.diagnostics.overChecks[0].rootHwnd, 20);
  assert.equal(e1.diagnostics.overChecks[0].focusReturn, false);
  const e2 = await osMouseDrag(base, async () => { throw Object.assign(new Error("exit 1"), { stdout: JSON.stringify(refused), stderr: "boom" }); }).then(() => null, e => e);
  assert.match(e2.message, /native drag failed: exit 1/);
  assert.equal(e2.diagnostics.overChecks[0].hitHwnd, 20);
  assert.equal(e2.diagnostics.stderr, "boom");
  const e3 = await osMouseDrag(base, async () => { throw new Error("spawn failed"); }).then(() => null, e => e);
  assert.ok(e3.diagnostics);
  const src = await (await import("node:fs/promises")).readFile(new URL("../tools/native-os-drag.mjs", import.meta.url), "utf8");
  for (const needle of ["GetForegroundWindow", "focusReturn", "hitHwnd", "rootPid", "foregroundPid"]) { assert.ok(src.includes(needle), needle); }
  assert.match(src, /\} catch \{\s*\$result\.failed = \$true/);
  assert.doesNotMatch(src, /GetWindowText\(\$hit|GetWindowText\(\$top|GetWindowText\(\$fg/);
});

test("the driver surfaces an incomplete drag and passes only the plan", async () => {
  await assert.rejects(osMouseDrag(base, async () => ({ dropped: false })), /did not reach the drop/);
  let seen;
  const out = await osMouseDrag(base, async plan => { seen = plan; return { dropped: true }; });
  assert.equal(out.dropped, true);
  assert.equal(seen.pid, 4242);
  assert.equal("dispatchEvent" in seen, false);
});

test("native script source uses real mouse input and releases the button in finally", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../tools/native-os-drag.mjs", import.meta.url), "utf8");
  assert.match(src, /mouse_event\(0x0002/);
  assert.match(src, /finally \{\s*\$result\.overChecks = \$script:overChecks\s*if \(\$down\)/);
  assert.match(src, /found\.Count -ne 1/);
  assert.match(src, /Assert-Over/);
  assert.doesNotMatch(src, /dispatchEvent|DataTransfer/);
});

function fakePage({ root = "main", targetRoot = "win1", mutate = {} } = {}) {
  const state = { root, text: "dirty", stamped: null };
  const calls = [];
  const evaluate = async expr => {
    calls.push(expr);
    if (expr.includes("__osDragProbe = ")) { state.stamped = state.text; return JSON.stringify({ root: state.root, dirty: true, hasEditor: true, pinned: false }); }
    if (expr.includes("getBoundingClientRect")) {
      return JSON.stringify({ sourceRoot: state.root, targetRoot, source: { x: 100, y: 20, inner, title: state.root === "main" ? "A-main" : "B-pop" }, target: { x: 300, y: 40, inner, title: targetRoot === "main" ? "A-main" : "B-pop" } });
    }
    if (expr.includes("sameLeaf")) {
      return JSON.stringify({ root: state.root, sameLeaf: true, sameView: true, sameEditorView: true, pinned: true, parentIsTarget: true, dirty: true, text: state.text, stamped: state.stamped, connected: true, ...mutate });
    }
    return "ok";
  };
  return { state, calls, evaluate };
}

test("a hop verifies identity after the real drag and rejects a drag that did not move or swapped the editor", async () => {
  const page = fakePage();
  const titles = { main: "A-main", win1: "B-pop" };
  const drag = async () => { page.state.root = "win1"; return { dropped: true }; };
  const ok = await osDragHop({ waitFor, evaluate: page.evaluate, drag, pid: 4242, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "hop" });
  assert.equal(ok.after.root, "win1");

  const still = fakePage();
  await assert.rejects(osDragHop({ waitFor, evaluate: still.evaluate, drag: async () => ({ dropped: true }), pid: 4242, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "hop" }), /expected win1|did not change/);

  const swapped = fakePage({ mutate: { sameEditorView: false } });
  await assert.rejects(osDragHop({ waitFor, evaluate: swapped.evaluate, drag: async () => { swapped.state.root = "win1"; return { dropped: true }; }, pid: 4242, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "hop" }), /sameEditorView=false/);
});

test("ambiguous or mismatched native titles are refused before any drag", async () => {
  let dragged = false;
  const drag = async () => { dragged = true; return { dropped: true }; };
  const page = fakePage();
  await assert.rejects(osDragHop({ waitFor, evaluate: page.evaluate, drag, pid: 1, titles: { main: "same", win1: "same" }, leafId: "l", groupId: "g", expectRoot: "win1", label: "hop" }), /ambiguous/);
  await assert.rejects(osDragHop({ waitFor, evaluate: page.evaluate, drag, pid: 1, titles: { main: "A-main", win1: "other" }, leafId: "l", groupId: "g", expectRoot: "win1", label: "hop" }), /do not match/);
  assert.equal(dragged, false);
});

test("the chain proves main->popout->popout hops, real Undo and Save, and never reports osDragVerified for an injected executor", async () => {
  const page = fakePage({ targetRoot: "win1" });
  const titles = { main: "A-main", win1: "B-pop", win2: "C-pop" };
  const keys = [];
  const evaluate = async expr => {
    if (expr.includes("getBoundingClientRect") && expr.includes('"g2"')) {
      return JSON.stringify({ sourceRoot: page.state.root, targetRoot: "win2", source: { x: 1, y: 1, inner, title: titles[page.state.root] }, target: { x: 2, y: 2, inner, title: "C-pop" } });
    }
    return page.evaluate(expr);
  };
  const drag = async ({ targetTitle }) => { page.state.root = Object.keys(titles).find(k => titles[k] === targetTitle); return { dropped: true }; };
  const press = async (root, key) => { keys.push([root, key]); if (key === "Ctrl+Z") { page.state.text = "clean"; } };
  const result = await runOsDragChain({ waitFor, evaluate, press, saved: async () => true, drag, pid: 9, titles, leafId: "l",
    hops: [{ groupId: "g1", expectRoot: "win1", label: "main->win1" }, { groupId: "g2", expectRoot: "win2", label: "win1->win2" }] });
  assert.equal(result.osDragVerified, false);
  assert.equal(result.mockDriver, true);
  assert.deepEqual(keys, [["win2", "Ctrl+Z"], ["win2", "Ctrl+S"]]);
  assert.equal(page.calls.at(-1).includes("delete app.__osDragProbe"), true);

  const failing = fakePage();
  await assert.rejects(runOsDragChain({ waitFor, evaluate: failing.evaluate, press: async () => {}, saved: async () => true, drag: async () => ({ dropped: true }), pid: 9, titles, leafId: "l",
    hops: [{ groupId: "g1", expectRoot: "win1", label: "x" }] }));
  assert.equal(failing.calls.at(-1).includes("delete app.__osDragProbe"), true);
});

test("expressions are primitive-returning and test-only", () => {
  for (const e of [stampExpression("l"), geometryExpression({ leafId: "l", groupId: "g" })]) {
    assert.match(e, /JSON\.stringify/);
    assert.doesNotMatch(e, /dispatchEvent|DragEvent/);
  }
});

test("plan rejects non-finite and out-of-range inputs before any OS action", () => {
  for (const bad of [{ ...inner, width: Infinity }, { ...inner, dpr: 0 }, { ...inner, dpr: 99 }, { ...inner, height: 1e9 }]) {
    assert.throws(() => buildDragPlan({ ...base, sourceInner: bad }), /measured|outside/);
  }
  for (const stepMs of [0, 5, 501, 1.5, Infinity, "40"]) { assert.throws(() => buildDragPlan({ ...base, stepMs }), /stepMs/); }
});

test("native script preflights both endpoints before pressing and cancels with Escape before any failure release", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../tools/native-os-drag.mjs", import.meta.url), "utf8");
  const preflightDst = src.indexOf("Assert-Over $dst $tx $ty");
  assert.ok(preflightDst > 0 && preflightDst < src.indexOf("mouse_event(0x0002"));
  const finallyBlock = src.slice(src.indexOf("} finally {"));
  assert.ok(finallyBlock.indexOf("keybd_event(0x1B") < finallyBlock.indexOf("mouse_event(0x0004"));
  assert.ok(finallyBlock.indexOf("SetCursorPos($cancelPt") < finallyBlock.indexOf("mouse_event(0x0004"));
  assert.match(finallyBlock, /if \(-not \$ok\)/);
});

test("the hop waits for delayed ownership, reports the last failure on timeout and needs a dirty editor and a waiter", async () => {
  const titles = { main: "A-main", win1: "B-pop" };
  const page = fakePage();
  let reads = 0;
  const evaluate = async expr => {
    if (expr.includes("sameLeaf")) {
      reads += 1;
      if (reads < 3) { return JSON.stringify({ root: "main", sameLeaf: true, sameView: true, sameEditorView: true, pinned: true, parentIsTarget: false, dirty: true, text: "dirty", stamped: "dirty", connected: true }); }
    }
    return page.evaluate(expr);
  };
  const drag = async () => { page.state.root = "win1"; return { dropped: true }; };
  const ok = await osDragHop({ waitFor, evaluate, drag, pid: 1, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "late" });
  assert.equal(ok.after.root, "win1");
  assert.ok(reads >= 3);

  const never = fakePage({ mutate: { parentIsTarget: false } });
  await assert.rejects(osDragHop({ waitFor, evaluate: never.evaluate, drag: async () => { never.state.root = "win1"; return { dropped: true }; }, pid: 1, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "never" }), /parentIsTarget=false/);

  await assert.rejects(osDragHop({ evaluate: page.evaluate, drag, pid: 1, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "nowait" }), /waitFor/);

  const clean = fakePage();
  const cleanEval = async expr => expr.includes("__osDragProbe = ") ? JSON.stringify({ root: "main", dirty: false, hasEditor: true, pinned: false }) : clean.evaluate(expr);
  let dragged = false;
  await assert.rejects(osDragHop({ waitFor, evaluate: cleanEval, drag: async () => { dragged = true; return { dropped: true }; }, pid: 1, titles, leafId: "l", groupId: "g", expectRoot: "win1", label: "clean" }), /actually be dirty/);
  assert.equal(dragged, false);
});