import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export function createErrorLogAudit(directory, name) {
  const path = join(directory, name + "-errors.jsonl"), records = new Map();
  writeFileSync(path, "");
  let failure;
  const add = record => {
    assert.equal(record.schemaVersion, 1); assert.equal(typeof record.id, "string");
    assert.equal(typeof record.error?.message, "string"); assert.ok(record.error.stack, "Every reported failure needs a stack.");
    const prior = records.get(record.id);
    if (prior) { assert.deepEqual(record, prior, "An error record changed after being reported."); return; }
    records.set(record.id, record); appendFileSync(path, JSON.stringify(record) + "\n");
  };
  return {
    onEvent(message) {
      if (message.method !== "Runtime.consoleAPICalled" || message.params.args?.[0]?.value !== "SLOPSIDIAN_DIAGNOSTIC") { return; }
      try { add(JSON.parse(message.params.args[1].value)); } catch (error) { failure = error.stack; }
    },
    async flush(evaluate) {
      const result = await evaluate("slopsidianDiagnostics.flush()");
      assert.equal(result.storageFailure, null, "The application could not persist its error log: " + result.storageFailure);
      const text = await evaluate("slopsidianDiagnostics.read()");
      for (const line of text.split("\n").filter(Boolean)) add(JSON.parse(line));
      return result;
    },
    async drain(socket) {
      if (!socket || socket.readyState === WebSocket.CLOSED) return;
      // Let queued diagnostic/exception events arrive before publishing the
      // final verdict. A process-exit event alone does not drain its socket.
      await new Promise(resolve => {
        const closed = () => { clearTimeout(timer); socket.removeEventListener("close", closed); resolve(); };
        const timer = setTimeout(() => { failure = "The renderer diagnostic channel did not finish closing."; closed(); }, 1500);
        socket.addEventListener("close", closed, { once: true });
        if (socket.readyState === WebSocket.CLOSED) closed();
      });
    },
    finish(report, nativeOutput = "") {
      try {
        const paths = [...new Set([...nativeOutput.matchAll(/^ERROR_LOG (.+)\r?$/gm)].map(match => match[1].trim()))];
        for (const source of paths) for (const line of readFileSync(source, "utf8").split("\n").filter(Boolean)) add(JSON.parse(line));
        assert.equal(failure, undefined, failure);
        assert.deepEqual(report.errorLogFlushFailures ?? [], [], "Application log persistence/flush failed");
        const expected = report.expectedDiagnostics ?? [], ids = new Set();
        for (const item of expected) {
          assert.ok(item.reason, "Expected failures must explain their test purpose.");
          assert.ok(!ids.has(item.id), "Duplicate expected diagnostic: " + item.id); ids.add(item.id);
          const record = records.get(item.id); assert.ok(record, "Expected error is missing from the logfile: " + item.id);
          assert.equal(record.source, item.source); assert.equal(record.error.message, item.message);
          if (item.stackIncludes) { assert.ok(record.error.stack.includes(item.stackIncludes), "Expected diagnostic must originate in its declared plugin/callsite"); }
        }
        const unexpected = [...records.values()].filter(record => !ids.has(record.id));
        report.errorLogAudit = { status: unexpected.length ? "failed" : "passed", path, nativePaths: paths, records: records.size,
          expected: ids.size, unexpected, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), includesFinalTeardown: true };
        assert.deepEqual(unexpected, [], "Unexpected reported/unhandled errors occurred; inspect " + path);
      } catch (error) {
        report.status = "failed"; report.errorLogAudit ??= { status: "failed", path, error: error.stack };
        report.error ??= error.stack; return false;
      }
      return true;
    },
  };
}

// A test may intentionally provoke a validation failure. Account for its exact
// record inside the action's window, never a global message-pattern allowlist.
export async function expectErrors(tools, errors, action, reason) {
  const { evaluate, report } = tools;
  assert.ok(reason);
  const before = new Set((await evaluate("slopsidianDiagnostics.current()")).map(record => record.id));
  const result = await action();
  let added = [], deadline = Date.now() + 5000;
  do {
    await delay(50);
    added = (await evaluate("slopsidianDiagnostics.current()")).filter(record => !before.has(record.id));
  } while (added.length < errors.length && Date.now() < deadline);
  assert.equal(added.length, errors.length, "Unexpected diagnostic count while " + reason + ": " + JSON.stringify(added));
  for (let i = 0; i < errors.length; i++) {
    assert.equal(added[i].source, errors[i].source, reason); assert.equal(added[i].error.message, errors[i].message, reason);
    if (errors[i].stackIncludes) { assert.ok(added[i].error.stack.includes(errors[i].stackIncludes), reason); }
    (report.expectedDiagnostics ??= []).push({ id: added[i].id, ...errors[i], reason });
  }
  return result;
}

export async function saveConflictMessage({ evaluate }) {
  return await evaluate('document.body.classList.contains("is-browser")')
    ? "Host 409: This file changed on disk. Your unsaved text is retained; resolve the conflict before saving."
    : 'Host 409: {"error":"This file changed on disk. Your unsaved text is retained; reopen the file after resolving the conflict."}';
}
