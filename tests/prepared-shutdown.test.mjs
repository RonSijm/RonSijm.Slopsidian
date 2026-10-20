import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { assertBackendExitedCleanly, closePreparedWindow, finishPreparedShutdown } = createRequire(import.meta.url)("../desktop/prepared-shutdown.cjs");

function owner(close) {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.finishClose = () => { window.destroyed = true; window.emit("closed"); };
  window.close = () => close(window);
  return window;
}
function pipeline(window, overrides = {}) {
  const calls = [];
  return { calls, run: () => finishPreparedShutdown({
    owner: window, timeoutMs: 1000,
    allowWindowClose: () => calls.push("allow"), cancelWindowClose: () => calls.push("cancel"),
    resumeAfterVeto: async () => calls.push("resume"),
    stopBackend: async () => { assert.ok(window.isDestroyed(), "the renderer connection must have gone before server drain"); calls.push("stop-backend"); },
    quit: () => calls.push("quit"), ...overrides,
  }) };
}
const closeEvent = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test("only a confirmed successful owned backend exit is accepted, including a host that exited before the drain request", () => {
  assertBackendExitedCleanly(0, null);
  for (const [code, signal] of [[1, null], [null, "SIGTERM"], [null, null]]) {
    assert.throws(() => assertBackendExitedCleanly(code, signal), /The \.NET host exited abnormally/);
  }
});

test("the server and final app quit wait for actual window closure, not merely the close request", async () => {
  let requested = false;
  const window = owner(win => { requested = true; win.emit("close", closeEvent()); });
  const { calls, run } = pipeline(window), closing = run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requested, true); assert.deepEqual(calls, ["allow"]);
  window.finishClose(); await closing;
  assert.deepEqual(calls, ["allow", "stop-backend", "quit"]);
  assert.equal(window.listenerCount("close"), 0); assert.equal(window.webContents.listenerCount("will-prevent-unload"), 0);
});

test("a normal synchronous close is accepted and already closed/missing owners do not require a second close", async () => {
  const window = owner(win => { win.emit("close", closeEvent()); win.finishClose(); });
  const { calls, run } = pipeline(window); await run();
  assert.deepEqual(calls, ["allow", "stop-backend", "quit"]);
  window.close = () => assert.fail("the closed owner must not be closed again");
  await closePreparedWindow(window); await closePreparedWindow(null);
});

test("a native close veto restores editing, resets the native close flag and keeps the window and backend alive", async () => {
  const event = closeEvent(), window = owner(win => win.emit("close", event));
  window.on("close", event => event.preventDefault());
  const { calls, run } = pipeline(window);
  await assert.rejects(run(), error => error.code === "WINDOW_CLOSE_VETOED" && error.closeNotCommitted === true);
  assert.equal(window.destroyed, false); assert.deepEqual(calls, ["allow", "cancel", "resume"]);
});

test("beforeunload vetoes are honored without overriding them and a corrected retry can close normally", async () => {
  let veto = true, overridden = false;
  const window = owner(win => { win.emit("close", closeEvent()); if (veto) { win.webContents.emit("will-prevent-unload", { preventDefault() { overridden = true; } }); } else { win.finishClose(); } });
  const { calls, run } = pipeline(window);
  await assert.rejects(run(), { code: "WINDOW_CLOSE_VETOED" });
  assert.equal(overridden, false); assert.equal(window.destroyed, false);
  veto = false; await run();
  assert.deepEqual(calls, ["allow", "cancel", "resume", "allow", "stop-backend", "quit"]);
});

test("an unconfirmed window close is bounded, never drains/kills the host and retains explicit uncertainty", async () => {
  const window = owner(win => win.emit("close", closeEvent()));
  const { calls, run } = pipeline(window, { timeoutMs: 20 });
  await assert.rejects(run(), error => error.code === "WINDOW_CLOSE_UNCONFIRMED" && error.closeNotCommitted === true);
  assert.deepEqual(calls, ["allow", "cancel"]); assert.equal(window.destroyed, false);
  assert.equal(window.listenerCount("closed"), 0);
});

test("close or recovery failures never proceed to server shutdown, and a backend exit failure never reports a final quit", async () => {
  const closeError = new Error("native close failed"), window = owner(() => { throw closeError; });
  let state = pipeline(window); await assert.rejects(state.run(), error => error === closeError && error.closeNotCommitted);
  assert.deepEqual(state.calls, ["allow", "cancel"]);
  const veto = owner(win => win.webContents.emit("will-prevent-unload", {}));
  const recoveryError = new Error("plugin restoration failed"); state = pipeline(veto, { resumeAfterVeto: async () => { throw recoveryError; } });
  await assert.rejects(state.run(), error => error instanceof AggregateError && error.errors[1] === recoveryError && error.closeNotCommitted);
  assert.deepEqual(state.calls, ["allow", "cancel"]);
  const closed = owner(win => win.finishClose()), backendError = new Error("host exited abnormally");
  state = pipeline(closed, { stopBackend: async () => { throw backendError; } });
  await assert.rejects(state.run(), error => error === backendError); assert.deepEqual(state.calls, ["allow"]);
});
