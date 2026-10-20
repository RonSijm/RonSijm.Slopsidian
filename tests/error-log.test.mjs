import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describeError } from "../client/error-record.ts";
import { createErrorLog } from "../desktop/error-log.cjs";
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
