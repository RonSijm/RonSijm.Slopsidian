import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

export const root = fileURLToPath(new URL("../", import.meta.url));

// Port zero can select a port prohibited by Fetch. Use the desktop launcher's
// high port range while still proving the real token-protected HTTP transport.
async function testPort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(49152, 65536);
    try {
      await new Promise((resolve, reject) => {
        const probe = createServer(); probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
      });
      return port;
    } catch (error) { if (error.code !== "EADDRINUSE" && error.code !== "EACCES") { throw error; } }
  }
  throw new Error("No available loopback test port was found.");
}

export async function startHost(vault, environment = {}) {
  const token = randomBytes(32).toString("hex");
  const port = await testPort();
  const child = spawn("dotnet", [join(root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll"), "--urls", `http://127.0.0.1:${port}`], {
    cwd: join(root, "src", "RonSijm.Slopsidian"),
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", SLOPSIDIAN_TOKEN: token, SLOPSIDIAN_PARENT: "1", SLOPSIDIAN_VAULT: vault ?? "", ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let log = "";
  let endpoint;
  let exit;
  let exited = false;
  let closed = false;
  let forcedCleanup;
  let stopPromise;
  const childErrors = [];
  const stdinErrors = [];
  const outputErrors = [];
  let readyResolve, terminalResolve, closeResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const terminal = new Promise(resolve => { terminalResolve = resolve; });
  const close = new Promise(resolve => { closeResolve = resolve; });
  const describeError = error => ({ name: error?.name, code: error?.code, message: error?.message ?? String(error) });
  const rememberStdinError = error => { if (!stdinErrors.includes(error)) { stdinErrors.push(error); } };

  // An already dying host can close stdin before exitCode changes. Keep this
  // listener through close, including errors delivered after end's callback.
  child.stdin.on("error", rememberStdinError);
  child.on("error", error => { childErrors.push(error); terminalResolve(); });
  child.once("exit", (code, signal) => { exited = true; exit = { code, signal }; terminalResolve(); });
  child.once("close", (code, signal) => {
    exit ??= { code, signal };
    closed = true;
    terminalResolve();
    closeResolve();
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("error", error => { outputErrors.push(error); terminalResolve(); });
    stream.on("data", text => {
      log += text;
      const match = log.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)\r?\n/m);
      if (!endpoint && match) {
        endpoint = match[1];
        readyResolve();
      }
    });
  }

  const diagnostics = () => ({
    pid: child.pid ?? null,
    exitCode: exit ? exit.code : child.exitCode,
    signal: exit ? exit.signal : child.signalCode,
    exited,
    closed,
    forcedCleanup: forcedCleanup ?? null,
    childErrors: childErrors.map(describeError),
    stdinErrors: stdinErrors.map(describeError),
    outputErrors: outputErrors.map(describeError),
    log,
  });
  function diagnosticText(snapshot = diagnostics()) {
    const { log: rawLog, ...state } = snapshot;
    return `Native host: ${JSON.stringify(state)}\nstdout/stderr:\n${rawLog}`;
  }
  function annotate(error, includeMessage = false) {
    if (error !== null && (typeof error === "object" || typeof error === "function")) {
      const snapshot = diagnostics();
      try { Object.defineProperty(error, "nativeHost", { value: snapshot, enumerable: true, configurable: true }); } catch { /* Preserve a non-extensible abort reason. */ }
      if (includeMessage && error.name !== "AbortError") {
        try { error.message += `\n${diagnosticText(snapshot)}`; } catch { /* Preserve read-only error properties. */ }
      }
    }
    return error;
  }
  async function within(promise, milliseconds) {
    let timer;
    try {
      return await Promise.race([
        promise.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  function stop() {
    return stopPromise ??= (async () => {
      if (!exit && !closed && child.pid && !child.stdin.destroyed && !child.stdin.writableEnded) {
        try { child.stdin.end("shutdown\n", error => { if (error) { rememberStdinError(error); } }); }
        catch (error) { rememberStdinError(error); }
      }
      // close follows exit only after stdout/stderr close. Keep draining both
      // pipes so the diagnostic includes output delivered after native exit.
      if (!await within(close, 5000)) {
        forcedCleanup = { reason: exit ? "stdio-close-timeout" : "shutdown-timeout", killRequested: false };
        if (!exit && !closed && child.pid) {
          forcedCleanup.killRequested = true;
          try { forcedCleanup.killAccepted = child.kill("SIGKILL"); }
          catch (error) { forcedCleanup.killError = describeError(error); }
        }
        if (!await within(close, 2000)) {
          forcedCleanup.closeTimedOut = true;
          // These are pipes owned by this fixture, never unrelated processes.
          for (const stream of [child.stdin, child.stdout, child.stderr]) { stream.destroy(); }
        }
      }
      try {
        assert.equal(forcedCleanup, undefined, `Host required forced cleanup.\n${diagnosticText()}`);
        assert.equal(childErrors.length, 0, diagnosticText());
        assert.equal(outputErrors.length, 0, diagnosticText());
        assert.equal(exit?.signal, null, diagnosticText());
        assert.equal(exit?.code, 0, diagnosticText());
        assert.equal(stdinErrors.filter(error => error?.code !== "EPIPE" && error?.code !== "ERR_STREAM_DESTROYED").length, 0, diagnosticText());
      } catch (error) { throw annotate(error); }
    })();
  }
  const started = await within(Promise.race([ready, terminal]), 20000);
  if (!started || !endpoint || exit || childErrors.length || outputErrors.length) {
    let cleanupError;
    try { await stop(); } catch (error) { cleanupError = error; }
    const error = new Error(`Host did not start.\n${diagnosticText()}`, { cause: childErrors[0] ?? cleanupError });
    if (cleanupError) { error.cleanupError = cleanupError; }
    throw annotate(error);
  }
  return {
    endpoint,
    pid: child.pid,
    stop,
    log: () => log,
    request: async (path, method = "GET", body, signal) => {
      try {
        return await fetch(endpoint + path, {
          method,
          signal,
          headers: { "X-Vault-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) { throw annotate(error, !(signal?.aborted && error === signal.reason)); }
    },
  };
}
