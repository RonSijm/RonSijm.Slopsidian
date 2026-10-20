import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const hostUrl = new URL("./host.mjs", import.meta.url);
const source = await readFile(hostUrl, "utf8");
// Execute the actual helper bodies with controlled process/transport imports.
// No native process, HTTP probe, environment override or retry is involved.
const executable = source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "").replaceAll("import.meta.url", JSON.stringify(hostUrl.href));
assert.doesNotMatch(executable, /^\s*(?:import|export)\b/m);
const flush = () => new Promise(resolve => setImmediate(resolve));

class Clock {
  now = 0;
  serial = 0;
  timers = new Map();
  setTimeout = (callback, milliseconds) => {
    const id = ++this.serial;
    this.timers.set(id, { callback, at: this.now + milliseconds });
    return id;
  };
  clearTimeout = id => { this.timers.delete(id); };
  async advance(milliseconds) {
    const target = this.now + milliseconds;
    for (let count = 0; ; count++) {
      assert.ok(count < 100, "The helper must not schedule an unbounded retry loop");
      await flush();
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) { break; }
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
    await flush();
  }
}

class Child extends EventEmitter {
  pid = 45678;
  exitCode = null;
  signalCode = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  writes = [];
  kills = [];
  pipeErrors = [];
  didExit = false;
  didClose = false;
  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, encoding, callback) => {
        this.writes.push(chunk.toString());
        if (this.onInput) { this.onInput(chunk.toString(), callback); }
        else { callback(); queueMicrotask(() => this.finish()); }
      },
    });
    const emit = this.stdin.emit;
    this.stdin.emit = (name, ...args) => {
      if (name === "error") {
        this.pipeErrors.push({ error: args[0], exitCode: this.exitCode, listeners: this.stdin.listenerCount("error") });
      }
      return emit.call(this.stdin, name, ...args);
    };
  }
  ready() { this.stdout.write("VAULT_READY http://127.0.0.1:54321\r\n"); }
  exit(code = 0, signal = null) {
    assert.equal(this.didExit, false);
    this.didExit = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
  close(code = this.exitCode, signal = this.signalCode) {
    assert.equal(this.didClose, false);
    this.didClose = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
  finish(code = 0, signal = null) { this.exit(code, signal); this.close(); }
  kill(signal) {
    this.kills.push(signal);
    if (this.onKill) { return this.onKill(signal); }
    queueMicrotask(() => this.finish(null, signal));
    return true;
  }
}

function fixture({ child = new Child(), spawnError, fetch: fetchImpl, probeErrors = [] } = {}) {
  const clock = new Clock(), spawns = [], requests = [], probes = [], ranges = [];
  const processFixture = { env: { EXISTING_ENV: "kept", ASPNETCORE_ENVIRONMENT: "Old" } };
  const api = runInNewContext(executable + "\n({ root, startHost });", {
    assert, join, fileURLToPath, process: processFixture, Error, URL,
    randomBytes: size => Buffer.alloc(size, 7),
    randomInt: (minimum, maximum) => { ranges.push([minimum, maximum]); return 54321; },
    spawn: (...args) => { spawns.push(args); if (spawnError) { throw spawnError; } return child; },
    createServer: () => {
      const server = new EventEmitter();
      server.listen = (port, address, callback) => {
        probes.push({ port, address });
        const error = probeErrors.shift();
        queueMicrotask(() => error ? server.emit("error", error) : callback());
      };
      server.close = callback => { queueMicrotask(() => callback()); };
      return server;
    },
    fetch: (...args) => { requests.push(args); return fetchImpl ? fetchImpl(...args) : Promise.resolve({ status: 200 }); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  }, { filename: fileURLToPath(hostUrl) });
  return { ...api, child, clock, spawns, requests, probes, ranges, processFixture };
}

async function readyFixture(options) {
  const f = fixture(options);
  const starting = f.startHost("C:\\fixture");
  await flush();
  assert.equal(f.spawns.length, 1);
  f.child.ready();
  f.host = await starting;
  assert.equal(f.clock.timers.size, 0);
  return f;
}

test("native host keeps its launch API, token, environment and port probe and waits only for the ready log", async () => {
  const f = fixture();
  const starting = f.startHost("C:\\fixture", { EXTRA: "explicit", ASPNETCORE_ENVIRONMENT: "Custom" });
  await flush();
  assert.equal(f.spawns.length, 1);
  const [command, args, options] = f.spawns[0];
  assert.equal(command, "dotnet");
  assert.deepEqual([...args], [join(f.root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll"), "--urls", "http://127.0.0.1:54321"]);
  assert.equal(options.cwd, join(f.root, "src", "RonSijm.Slopsidian"));
  assert.deepEqual({ ...options.env }, { EXISTING_ENV: "kept", ASPNETCORE_ENVIRONMENT: "Custom", SLOPSIDIAN_TOKEN: "07".repeat(32), SLOPSIDIAN_PARENT: "1", SLOPSIDIAN_VAULT: "C:\\fixture", EXTRA: "explicit" });
  assert.deepEqual([...options.stdio], ["pipe", "pipe", "pipe"]);
  assert.deepEqual(f.ranges, [[49152, 65536]]);
  assert.deepEqual(f.probes, [{ port: 54321, address: "127.0.0.1" }]);
  assert.equal(f.requests.length, 0, "Readiness must not send HTTP requests");
  let settled = false;
  starting.then(() => { settled = true; });
  f.child.stdout.write("startup λ\nVAULT_RE");
  f.child.stdout.write("ADY http://127.0.0.1:54321\r");
  await flush();
  assert.equal(settled, false, "A partial ready line is insufficient");
  f.child.stdout.write("\n");
  const host = await starting;
  assert.equal(host.pid, f.child.pid);
  assert.equal(host.endpoint, "http://127.0.0.1:54321");
  assert.equal(typeof host.log, "function");
  assert.equal(f.clock.timers.size, 0);
  await host.stop();
  assert.deepEqual(f.child.writes, ["shutdown\n"]);
});

test("stop is idempotent and waits for close while draining stdout and stderr after exit", async () => {
  const f = await readyFixture();
  f.child.onInput = (text, callback) => { callback(); f.child.exit(); };
  const stopping = f.host.stop();
  assert.equal(f.host.stop(), stopping);
  let settled = false;
  stopping.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, "exit alone does not prove the pipes drained");
  f.child.stdout.write("last stdout λ\n");
  f.child.stderr.write("last stderr Ω\n");
  f.child.close();
  await stopping;
  assert.match(f.host.log(), /last stdout λ\nlast stderr Ω\n$/);
  assert.equal(f.host.stop(), stopping);
  assert.deepEqual(f.child.writes, ["shutdown\n"]);
  assert.deepEqual(f.child.kills, []);
  assert.equal(f.clock.timers.size, 0);
});

test("asynchronous stdin EPIPE before exitCode changes is handled and the native nonzero exit still fails with final logs", async () => {
  const f = await readyFixture();
  const pipeError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  f.child.onInput = (text, callback) => { queueMicrotask(() => callback(pipeError)); };
  const stopping = f.host.stop();
  const rejected = assert.rejects(stopping, error => {
    assert.equal(error.actual, 73);
    assert.equal(error.expected, 0);
    assert.equal(error.nativeHost.pid, f.child.pid);
    assert.equal(error.nativeHost.exitCode, 73);
    assert.equal(error.nativeHost.signal, null);
    assert.equal(error.nativeHost.closed, true);
    assert.equal(error.nativeHost.stdinErrors.length, 1);
    assert.equal(error.nativeHost.stdinErrors[0].code, "EPIPE");
    assert.match(error.message, /fatal native detail λ\ntrailing stderr Ω/);
    return true;
  });
  await flush();
  assert.equal(f.child.pipeErrors.length, 1);
  assert.equal(f.child.pipeErrors[0].exitCode, null);
  assert.ok(f.child.pipeErrors[0].listeners >= 1, "The helper owns the error listener before the failed write");
  f.child.stderr.write("fatal native detail λ\n");
  f.child.exit(73);
  f.child.stderr.write("trailing stderr Ω\n");
  f.child.close();
  await rejected;
  await flush();
  assert.equal(f.clock.timers.size, 0);
  assert.deepEqual(f.child.kills, []);
  assert.equal(f.host.stop(), stopping);
});

test("a delayed stdin error remains observed after a graceful close instead of becoming after-test activity", async () => {
  const f = await readyFixture();
  let finishWrite;
  f.child.onInput = (text, callback) => { finishWrite = callback; f.child.finish(); };
  await f.host.stop();
  const pipeError = Object.assign(new Error("late EPIPE"), { code: "EPIPE" });
  finishWrite(pipeError);
  await flush();
  assert.equal(f.child.pipeErrors.length, 1);
  assert.ok(f.child.pipeErrors[0].listeners >= 1);
  assert.equal(f.clock.timers.size, 0);
  assert.deepEqual(f.child.kills, []);
});

test("an unexpected stdin EIO fails after an otherwise clean native exit instead of being silently tolerated", async () => {
  const f = await readyFixture();
  const pipeError = Object.assign(new Error("shutdown input failed"), { code: "EIO" });
  f.child.onInput = (text, callback) => { queueMicrotask(() => callback(pipeError)); };
  const failure = assert.rejects(f.host.stop(), error => {
    assert.equal(error.nativeHost.exitCode, 0);
    assert.equal(error.nativeHost.stdinErrors[0].code, "EIO");
    assert.match(error.message, /shutdown input failed/);
    return true;
  });
  await flush();
  f.child.finish();
  await failure;
  assert.equal(f.clock.timers.size, 0);
  assert.deepEqual(f.child.kills, []);
});

test("an already exited host receives no stdin write and retains its nonzero exit plus post-exit stderr", async () => {
  const f = await readyFixture();
  f.child.exit(19);
  const rejected = assert.rejects(f.host.stop(), error => {
    assert.equal(error.actual, 19);
    assert.equal(error.nativeHost.exitCode, 19);
    assert.match(error.nativeHost.log, /diagnostic after exit/);
    return true;
  });
  f.child.stderr.write("diagnostic after exit\n");
  f.child.close();
  await rejected;
  assert.deepEqual(f.child.writes, []);
  assert.deepEqual(f.child.kills, []);
});

test("signal termination remains a failing native assertion with its signal and raw log", async () => {
  const f = await readyFixture();
  f.child.stderr.write("signal detail\n");
  f.child.finish(null, "SIGABRT");
  await assert.rejects(f.host.stop(), error => {
    assert.equal(error.actual, "SIGABRT");
    assert.equal(error.expected, null);
    assert.equal(error.nativeHost.signal, "SIGABRT");
    assert.equal(error.nativeHost.exitCode, null);
    assert.match(error.message, /signal detail/);
    return true;
  });
  assert.deepEqual(f.child.writes, []);
});

test("spawn error followed by close without exit settles startup and preserves the spawn error cause", async () => {
  const f = fixture();
  f.child.pid = undefined;
  const starting = f.startHost();
  const failure = assert.rejects(starting, error => {
    assert.equal(error.cause, spawnError);
    assert.equal(error.nativeHost.pid, null);
    assert.equal(error.nativeHost.exited, false, "Failed spawn closes without inventing a native exit event");
    assert.equal(error.nativeHost.closed, true);
    assert.equal(error.nativeHost.childErrors[0].code, "ENOENT");
    assert.match(error.message, /spawn detail/);
    return true;
  });
  await flush();
  const spawnError = Object.assign(new Error("spawn dotnet ENOENT"), { code: "ENOENT" });
  f.child.stderr.write("spawn detail\n");
  f.child.emit("error", spawnError);
  f.child.close(-4058, null);
  await failure;
  assert.deepEqual(f.child.writes, []);
  assert.deepEqual(f.child.kills, []);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test("synchronous spawn failure rejects once without a replacement process or readiness request", async () => {
  const error = Object.assign(new Error("invalid spawn arguments"), { code: "ERR_INVALID_ARG_TYPE" });
  const f = fixture({ spawnError: error });
  await assert.rejects(f.startHost(), actual => actual === error);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.clock.timers.size, 0);
});

test("early clean exit without VAULT_READY remains a startup failure", async () => {
  const f = fixture();
  const starting = f.startHost();
  const failure = assert.rejects(starting, error => {
    assert.match(error.message, /Host did not start/);
    assert.equal(error.nativeHost.exitCode, 0);
    assert.equal(error.nativeHost.closed, true);
    assert.equal(error.nativeHost.forcedCleanup, null);
    return true;
  });
  await flush();
  f.child.stdout.write("exited before ready\n");
  f.child.finish();
  await failure;
  assert.equal(f.spawns.length, 1);
  assert.deepEqual(f.child.writes, []);
  assert.equal(f.clock.timers.size, 0);
});

test("early fatal exit fails startup only after close and keeps the native failure as its cause", async () => {
  const f = fixture();
  const starting = f.startHost();
  const failure = assert.rejects(starting, error => {
    assert.equal(error.cause.actual, 41);
    assert.equal(error.cleanupError, error.cause);
    assert.equal(error.nativeHost.exitCode, 41);
    assert.match(error.message, /fatal startup\nlast startup detail/);
    return true;
  });
  await flush();
  f.child.stderr.write("fatal startup\n");
  f.child.exit(41);
  await flush();
  f.child.stderr.write("last startup detail\n");
  f.child.close();
  await failure;
  assert.equal(f.spawns.length, 1);
  assert.deepEqual(f.child.kills, []);
});

test("the 20 second startup deadline cleans up a responsive owned child and still fails startup", async () => {
  const f = fixture();
  const starting = f.startHost();
  const failure = assert.rejects(starting, error => {
    assert.match(error.message, /Host did not start/);
    assert.equal(error.nativeHost.exitCode, 0);
    assert.equal(error.nativeHost.forcedCleanup, null);
    return true;
  });
  await flush();
  await f.clock.advance(19999);
  assert.deepEqual(f.child.writes, []);
  await f.clock.advance(1);
  await failure;
  assert.deepEqual(f.child.writes, ["shutdown\n"]);
  assert.deepEqual(f.child.kills, []);
  assert.equal(f.requests.length, 0);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test("a hung stop sends one bounded owned-child kill and fails even if the eventual exit is zero", async () => {
  const f = await readyFixture();
  f.child.onInput = (text, callback) => { callback(); };
  f.child.onKill = () => { f.child.stderr.write("forced zero exit\n"); f.child.finish(); return true; };
  const stopping = f.host.stop();
  const failure = assert.rejects(stopping, error => {
    assert.match(error.message, /Host required forced cleanup/);
    assert.equal(error.nativeHost.exitCode, 0);
    assert.equal(error.nativeHost.closed, true);
    assert.equal(error.nativeHost.forcedCleanup.killRequested, true);
    assert.match(error.nativeHost.log, /forced zero exit/);
    return true;
  });
  await f.clock.advance(4999);
  assert.deepEqual(f.child.kills, []);
  await f.clock.advance(1);
  await failure;
  assert.equal(f.host.stop(), stopping);
  assert.deepEqual(f.child.kills, ["SIGKILL"]);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test("unconfirmed forced cleanup settles after the kill bound and fails with unknown exit and owned PID", async () => {
  const f = await readyFixture();
  f.child.onInput = (text, callback) => { callback(); };
  f.child.onKill = () => false;
  const stopping = f.host.stop();
  const failure = assert.rejects(stopping, error => {
    assert.equal(error.nativeHost.pid, f.child.pid);
    assert.equal(error.nativeHost.exitCode, null);
    assert.equal(error.nativeHost.signal, null);
    assert.equal(error.nativeHost.closed, false);
    assert.equal(error.nativeHost.forcedCleanup.killAccepted, false);
    assert.equal(error.nativeHost.forcedCleanup.closeTimedOut, true);
    return true;
  });
  await f.clock.advance(5000);
  await f.clock.advance(1999);
  assert.equal(f.child.stdout.destroyed, false);
  await f.clock.advance(1);
  await failure;
  assert.equal(f.child.stdin.destroyed, true);
  assert.equal(f.child.stdout.destroyed, true);
  assert.equal(f.child.stderr.destroyed, true);
  assert.deepEqual(f.child.kills, ["SIGKILL"]);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test("failed startup also bounds a hung child and preserves forced signal cleanup diagnostics", async () => {
  const f = fixture();
  f.child.onInput = (text, callback) => { callback(); };
  const starting = f.startHost();
  const failure = assert.rejects(starting, error => {
    assert.match(error.message, /Host did not start/);
    assert.match(error.cleanupError.message, /Host required forced cleanup/);
    assert.equal(error.nativeHost.signal, "SIGKILL");
    assert.equal(error.nativeHost.exitCode, null);
    assert.equal(error.nativeHost.forcedCleanup.reason, "shutdown-timeout");
    return true;
  });
  await flush();
  await f.clock.advance(20000);
  await f.clock.advance(5000);
  await failure;
  assert.deepEqual(f.child.writes, ["shutdown\n"]);
  assert.deepEqual(f.child.kills, ["SIGKILL"]);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.clock.timers.size, 0);
});

test("a dead child with stuck stdio is bounded without sending a kill to an already exited PID", async () => {
  const f = await readyFixture();
  f.child.exit();
  const failure = assert.rejects(f.host.stop(), error => {
    assert.match(error.message, /Host required forced cleanup/);
    assert.equal(error.nativeHost.exitCode, 0);
    assert.equal(error.nativeHost.exited, true);
    assert.equal(error.nativeHost.closed, false);
    assert.equal(error.nativeHost.forcedCleanup.reason, "stdio-close-timeout");
    assert.equal(error.nativeHost.forcedCleanup.killRequested, false);
    assert.equal(error.nativeHost.forcedCleanup.closeTimedOut, true);
    return true;
  });
  await f.clock.advance(5000);
  f.child.stderr.write("last available dead-child detail\n");
  await f.clock.advance(2000);
  await failure;
  assert.deepEqual(f.child.kills, []);
  assert.deepEqual(f.child.writes, []);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test("fetch rejection keeps the exact error and cause and attaches native PID, exit and final raw logs", async () => {
  const cause = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
  const original = new TypeError("fetch failed", { cause });
  const f = await readyFixture({ fetch: () => Promise.reject(original) });
  f.child.stderr.write("native request failure Ω\n");
  f.child.finish(53);
  await assert.rejects(f.host.request("/api/core"), error => {
    assert.equal(error, original);
    assert.equal(error.cause, cause);
    assert.equal(error.name, "TypeError");
    assert.equal(error.nativeHost.pid, f.child.pid);
    assert.equal(error.nativeHost.exitCode, 53);
    assert.equal(error.nativeHost.signal, null);
    assert.match(error.message, /native request failure Ω/);
    assert.match(error.nativeHost.log, /native request failure Ω/);
    return true;
  });
  assert.equal(f.requests.length, 1);
  assert.equal(f.spawns.length, 1);
  await assert.rejects(f.host.stop(), error => error.actual === 53);
});

test("request keeps method/body/token/signal and preserves AbortError identity, name, code and message", async () => {
  const original = new DOMException("explicit abort", "AbortError");
  const controller = new AbortController();
  controller.abort(original);
  const f = await readyFixture({ fetch: (url, options) => Promise.reject(options.signal.reason) });
  await assert.rejects(f.host.request("/api/core", "PUT", { enabled: true }, controller.signal), error => {
    assert.equal(error, original);
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, 20);
    assert.equal(error.message, "explicit abort");
    assert.equal(error.nativeHost.pid, f.child.pid);
    assert.equal(error.nativeHost.exitCode, null);
    assert.equal(error.nativeHost.exited, false);
    return true;
  });
  assert.equal(f.requests.length, 1);
  const [url, options] = f.requests[0];
  assert.equal(url, "http://127.0.0.1:54321/api/core");
  assert.equal(options.method, "PUT");
  assert.equal(options.signal, controller.signal);
  assert.deepEqual({ ...options.headers }, { "X-Vault-Token": "07".repeat(32), "Content-Type": "application/json" });
  assert.equal(options.body, '{"enabled":true}');
  assert.deepEqual(f.child.writes, [], "An aborted request must not invent a shutdown or retry");
  await f.host.stop();
});

for (const [label, reason] of [
  ["custom Error", () => new Error("caller cancellation", { cause: new Error("original reason cause") })],
  ["frozen Error", () => Object.freeze(new Error("immutable caller cancellation"))],
  ["TimeoutError", () => new DOMException("caller timeout", "TimeoutError")],
]) {
  test(`request preserves a ${label} signal.reason without changing its message, cause or identity`, async () => {
    const original = reason(), message = original.message, cause = original.cause;
    const controller = new AbortController();
    controller.abort(original);
    const f = await readyFixture({ fetch: (url, options) => Promise.reject(options.signal.reason) });
    await assert.rejects(f.host.request("/api/core", "GET", undefined, controller.signal), error => {
      assert.equal(error, original);
      assert.equal(error.message, message);
      assert.equal(error.cause, cause);
      assert.equal(error.name, original.name);
      if (Object.isExtensible(original)) { assert.equal(error.nativeHost.pid, f.child.pid); }
      else { assert.equal(Object.hasOwn(error, "nativeHost"), false); }
      return true;
    });
    assert.equal(f.requests.length, 1);
    assert.equal(f.spawns.length, 1);
    assert.deepEqual(f.child.writes, []);
    await f.host.stop();
    assert.equal(f.clock.timers.size, 0);
  });
}
