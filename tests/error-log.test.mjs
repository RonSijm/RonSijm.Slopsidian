import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { describeError } from "../client/error-record.ts";
import { createErrorLog, installRendererDiagnostics } from "../desktop/error-log.cjs";
import { createErrorLogAudit } from "../tools/error-log-audit.mjs";

const fixture = () => mkdtemp(new URL("../.runtime/error-log-unit-", import.meta.url));
const record = (id = "one", source = "notification") => ({ schemaVersion: 1, id, session: "test", timestamp: new Date().toISOString(), source, error: describeError(new Error("Expected failure")), page: "http://localhost/" });
const event = error => ({ method: "Runtime.consoleAPICalled", params: { args: [{ value: "SLOPSIDIAN_DIAGNOSTIC" }, { value: JSON.stringify(error) }] } });

test("error serialization retains original stacks, causes, aggregates and foreign-realm shapes", () => {
  const cause = new TypeError("Root cause"), error = new AggregateError([cause], "Outer", { cause });
  const result = describeError(error);
  assert.equal(result.stack, error.stack); assert.equal(result.cause.stack, cause.stack); assert.equal(result.errors[0].name, "TypeError");
  assert.equal(result.stackOrigin, "original");
  assert.deepEqual(Object.fromEntries(Object.entries(describeError({ name: "ReadOnlyVaultError", message: "Denied", code: "VAULT_READ_ONLY", operation: "modify", path: "Plan.md" })).filter(([key]) => ["code", "operation", "path"].includes(key))), { code: "VAULT_READ_ONLY", operation: "modify", path: "Plan.md" });
  assert.equal(describeError({ message: "Foreign", name: "Custom", stack: "Foreign original stack" }).stack, "Foreign original stack");
  assert.match(describeError("string rejection").stack, /Reported here/);
  assert.equal(describeError("string rejection").stackOrigin, "reported");
});

test("circular causes and hostile thrown values cannot break logging", () => {
  const error = new Error("Circular"); error.cause = error;
  assert.doesNotThrow(() => JSON.stringify(describeError(error)));
  assert.doesNotThrow(() => JSON.stringify(describeError(new Proxy({}, { get() { throw new Error("Getter"); } }))));
});

test("desktop logfile appends synchronously and survives a new host writer", async () => {
  const directory = await fixture(), log = createErrorLog(directory, "test");
  const first = record(); log.append(first);
  const next = createErrorLog(directory, "test"); next.append(record("two", "unhandled-rejection"));
  const lines = (await readFile(log.path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines[0], first); assert.equal(lines.length, 2);
  assert.throws(() => createErrorLog(directory, "../escape")); assert.throws(() => next.append({ error: "invalid" }));
});

test("caught notifications fail smoke acceptance even without an uncaught exception", async () => {
  const audit = createErrorLogAudit(await fixture(), "caught"), report = { status: "passed" };
  audit.onEvent(event(record()));
  assert.equal(audit.finish(report), false); assert.equal(report.status, "failed");
  assert.equal(report.errorLogAudit.unexpected[0].source, "notification");
});

test("expected errors require an exact record id, source and message", async () => {
  const directory = await fixture(), error = record(), expected = { id: error.id, source: error.source, message: error.error.message, reason: "Exercise validation" };
  const good = createErrorLogAudit(directory, "expected"); good.onEvent(event(error));
  assert.equal(good.finish({ status: "passed", expectedDiagnostics: [expected] }), true);
  for (const change of [item => item.id = "other", item => item.source = "host", item => item.message = "other", item => item.reason = "", item => item.stackIncludes = "a different plugin"]) {
    const audit = createErrorLogAudit(directory, crypto.randomUUID()); audit.onEvent(event(error));
    const item = { ...expected }; change(item); assert.equal(audit.finish({ status: "passed", expectedDiagnostics: [item] }), false);
  }
});

test("shutdown audit reads the native file and catches errors after CDP disconnects", async () => {
  const directory = await fixture(), log = createErrorLog(directory, "late"), audit = createErrorLogAudit(directory, "shutdown");
  log.append(record("late", "window-error"));
  const report = { status: "passed" };
  assert.equal(audit.finish(report, "ERROR_LOG " + log.path + "\n"), false);
  assert.equal(report.errorLogAudit.unexpected[0].id, "late");
});

test("shutdown drains the renderer channel before judging late notifications", async () => {
  const audit = createErrorLogAudit(await fixture(), "drain"), socket = new EventTarget();
  socket.readyState = WebSocket.OPEN;
  let drained = false;
  const closing = audit.drain(socket).then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(drained, false);
  audit.onEvent(event(record("last-message")));
  socket.readyState = WebSocket.CLOSED; socket.dispatchEvent(new Event("close"));
  await closing;
  const report = { status: "passed" }; assert.equal(audit.finish(report), false);
  assert.equal(report.errorLogAudit.unexpected[0].id, "last-message");
});

test("incomplete or modified log records fail closed", async () => {
  const directory = await fixture(), audit = createErrorLogAudit(directory, "invalid");
  audit.onEvent(event(record())); audit.onEvent(event({ ...record(), error: describeError(new Error("Changed")) }));
  assert.equal(audit.finish({ status: "passed" }), false);
  const path = join(directory, "truncated.jsonl"); await writeFile(path, '{"schemaVersion":');
  assert.equal(createErrorLogAudit(directory, "partial").finish({ status: "passed" }, "ERROR_LOG " + path + "\n"), false);
});

test("native renderer loss persists its reason and last live PID without the renderer channel", async () => {
  const log = createErrorLog(await fixture(), "renderer"), contents = new EventEmitter(); let pid = 42;
  contents.getOSProcessId = () => pid; contents.getURL = () => "http://user:secret@127.0.0.1:5000/?token=private#secret";
  installRendererDiagnostics(contents, log, { session: "owned", view: "web-main" });
  contents.emit("did-finish-load"); pid = 0; contents.emit("render-process-gone", {}, { reason: "oom", exitCode: -1 });
  const saved = JSON.parse((await readFile(log.path, "utf8")).trim());
  assert.equal(saved.source, "host"); assert.equal(saved.session, "owned"); assert.equal(saved.context.view, "web-main");
  assert.deepEqual(saved.native, { reason: "oom", exitCode: -1, lastKnownProcessId: 42 });
  assert.equal(saved.page, "http://127.0.0.1:5000/"); assert.equal(saved.error.code, "RENDERER_PROCESS_GONE"); assert.ok(saved.error.stack);
  const audit = createErrorLogAudit(await fixture(), "renderer-loss"); const report = { status: "passed" };
  assert.equal(audit.finish(report, "ERROR_LOG " + log.path + "\n"), false); assert.equal(report.errorLogAudit.unexpected[0].id, saved.id);
});

test("clean renderer shutdown is quiet while crash and launch failures retain distinct native outcomes", () => {
  const records = [], contents = new EventEmitter(); let pid = 19; contents.getOSProcessId = () => pid; contents.getURL = () => "data:text/plain,private-payload";
  installRendererDiagnostics(contents, { append: record => records.push(record) });
  contents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 }); pid = 0; assert.equal(records.length, 0);
  for (const reason of ["crashed", "killed", "integrity-failure", "launch-failed", "memory-eviction"]) contents.emit("render-process-gone", {}, { reason, exitCode: 3221225477 });
  assert.equal(new Set(records.map(record => record.id)).size, 5); assert.deepEqual(records.map(record => record.native.reason), ["crashed", "killed", "integrity-failure", "launch-failed", "memory-eviction"]);
  assert.ok(records.every(record => record.native.lastKnownProcessId === 0 && record.native.exitCode === 3221225477 && record.page === ""));
});

test("renderer diagnostic listeners retire with their exact web contents and explicit disposal is idempotent", () => {
  const contents = new EventEmitter(), records = []; contents.getOSProcessId = () => 9; contents.getURL = () => "";
  const dispose = installRendererDiagnostics(contents, { append: record => records.push(record) });
  contents.emit("destroyed"); dispose(); dispose();
  for (const name of ["did-finish-load", "render-process-gone", "destroyed"]) assert.equal(contents.listenerCount(name), 0);
  contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 }); assert.equal(records.length, 0);
});

test("a renderer-log storage error remains explicit without throwing from the Electron event callback", t => {
  const errors = []; t.mock.method(console, "error", (...args) => errors.push(args));
  const contents = new EventEmitter(); contents.getOSProcessId = () => { throw Error("Already gone"); }; contents.getURL = () => "";
  installRendererDiagnostics(contents, { append() { throw Error("Disk full"); } });
  assert.doesNotThrow(() => contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 }));
  assert.equal(errors.length, 1); assert.match(errors[0][0], /persist renderer exit/); assert.match(errors[0][1].message, /Disk full/);
});
