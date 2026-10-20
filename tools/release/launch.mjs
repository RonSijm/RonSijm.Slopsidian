import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { repositoryRoot } from "./lib.mjs";

const run = promisify(execFile);

export class CdpDisconnectedError extends Error { constructor(message) { super(message); this.name = "CdpDisconnectedError"; } }
export class CdpTimeoutError extends Error { constructor(message) { super(message); this.name = "CdpTimeoutError"; } }
export class CdpCommandError extends Error { constructor(message) { super(message); this.name = "CdpCommandError"; } }

// Removes machine-specific roots from text that is written to evidence and bounds its length.
export function sanitize(text, limit = 2000) {
  let value = String(text ?? "");
  for (const [root, label] of [[repositoryRoot, "<repo>"], [homedir(), "<home>"]]) {
    for (const variant of [root, root.replaceAll("\\", "/"), root.replaceAll("\\", "\\\\")]) { value = value.split(variant).join(label); }
  }
  return value.length > limit ? "…" + value.slice(-limit) : value;
}

async function waitFor(check, description, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) { throw new Error("Aborted while waiting for " + description); }
    try {
      const value = await check();
      if (value) { return value; }
    } catch (error) { lastError = error; }
    await delay(25);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}` + (lastError ? ` (last error: ${sanitize(lastError.message, 300)})` : ""));
}

// A minimal DevTools-protocol client over a WebSocket-like object (message/close/error events, send, close).
// Every pending command is settled when the socket closes, so an expected disconnect never waits for a timeout.
export function createCdpClient(socket, { timeoutMs = 15000 } = {}) {
  let id = 0, closed = false;
  const pending = new Map();
  const settleAll = reason => {
    closed = true;
    for (const [messageId, entry] of pending) { clearTimeout(entry.timer); entry.reject(new CdpDisconnectedError(`${entry.method}: ${reason}`)); pending.delete(messageId); }
  };
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const entry = message.id !== undefined ? pending.get(message.id) : undefined;
    if (!entry) { return; }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) { entry.reject(new CdpCommandError(`${entry.method}: ${message.error.message}`)); } else { entry.resolve(message.result); }
  });
  socket.addEventListener("close", () => settleAll("the DevTools socket closed."));
  socket.addEventListener("error", () => settleAll("the DevTools socket failed."));
  return {
    get closed() { return closed; },
    send: (method, params = {}) => new Promise((resolve, reject) => {
      if (closed) { reject(new CdpDisconnectedError(`${method}: the DevTools socket is already closed.`)); return; }
      const messageId = ++id;
      const timer = setTimeout(() => { pending.delete(messageId); reject(new CdpTimeoutError(`${method}: no response within ${timeoutMs} ms.`)); }, timeoutMs);
      pending.set(messageId, { method, resolve, reject, timer });
      try { socket.send(JSON.stringify({ id: messageId, method, params })); } catch (error) { pending.delete(messageId); clearTimeout(timer); reject(new CdpDisconnectedError(`${method}: ${error.message}`)); }
    }),
    close: () => { settleAll("the DevTools client was closed."); try { socket.close(); } catch { /* already closed */ } },
  };
}

async function connect(webSocketUrl, options) {
  const socket = new WebSocket(webSocketUrl);
  await once(socket, "open");
  return createCdpClient(socket, options);
}

// Sends Browser.close and measures the time from that instant to the observed process exit. The command legitimately
// never answers when the browser quits, so a disconnect or an exit before the acknowledgement is the expected outcome;
// a CDP error response or a silent timeout is a failure. `exited` resolves with the process exit code.
export async function closeBrowserAndMeasure(client, exited, { exitTimeoutMs = 20000 } = {}) {
  const sent = performance.now();
  const exit = exited.then(code => ({ code, at: performance.now() }));
  const command = client.send("Browser.close").then(
    () => ({ status: "acknowledged" }),
    error => error instanceof CdpDisconnectedError ? { status: "disconnected" }
      : error instanceof CdpTimeoutError ? { status: "timeout", error: sanitize(error.message) }
        : { status: "failed", error: sanitize(error.message) });
  const first = await Promise.race([command, exit.then(() => ({ status: "process-exited-before-response" }))]);
  const outcome = await Promise.race([exit, delay(exitTimeoutMs).then(() => null)]);
  client.close();
  const expected = ["acknowledged", "disconnected", "process-exited-before-response"].includes(first.status);
  const graceful = outcome !== null;
  const result = { ms: (outcome?.at ?? performance.now()) - sent, graceful, exitCode: outcome?.code ?? null, closeCommand: first.status };
  if (!expected) { result.error = first.error ?? `Browser.close ${first.status}`; }
  else if (!graceful) { result.error = `The application did not exit within ${exitTimeoutMs} ms of Browser.close.`; }
  result.ok = expected && graceful;
  return result;
}

async function powershell(script, label) {
  try {
    return (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true })).stdout;
  } catch (error) {
    throw new Error(`${label} failed (${error.code ?? "error"}): ${sanitize(String(error.stderr || error.message).split(/\r?\n/).find(Boolean) ?? "", 300)}`);
  }
}

async function processTree(rootPid) {
  const pid = Number(rootPid);
  if (!Number.isInteger(pid) || pid <= 0) { throw new Error("Invalid root process id."); }
  const stdout = await powershell(`$all = Get-CimInstance Win32_Process; $ids = @(${pid}); $queue = @(${pid});
while ($queue.Count) { $next = @(); foreach ($p in $queue) { $next += $all | Where-Object ParentProcessId -eq $p | ForEach-Object ProcessId }; $queue = $next; $ids += $next }
$rows = $all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; workingSetBytes = [int64]$_.WorkingSetSize } }
ConvertTo-Json -InputObject @($rows) -Compress`, "Process tree query");
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows) || !rows.some(row => row.pid === pid)) { throw new Error("The launched process was not present in the process tree query."); }
  return rows;
}

// Returns { running, name } for exactly one PID; a failed probe throws rather than reporting "not running".
async function probeProcess(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) { throw new Error("Invalid process id."); }
  const stdout = await powershell(`$p = Get-Process -Id ${value} -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName } else { '' }`, "Process probe");
  const name = stdout.trim();
  return { running: name.length > 0, name };
}

async function terminateOwned(pid, label) {
  try { await run("taskkill.exe", ["/PID", String(Number(pid)), "/T", "/F"], { windowsHide: true }); return null; }
  catch (error) { return `Could not terminate ${label} (PID ${Number(pid)}): ${sanitize(String(error.stderr || error.stdout || error.message).trim().split(/\r?\n/)[0], 300)}`; }
}

// Launches the application with a CDP port and records when each startup stage becomes observable.
// Only the process this function started and the .NET host PID that process printed are ever terminated.
export async function launchAndMeasure(executable, { args = [], env = {}, cwd, timeoutMs = 60000, readyExpression = "Boolean(globalThis.app?.workspace) && document.readyState === 'complete'" } = {}) {
  const started = performance.now();
  const child = spawn(executable, ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
  const exited = once(child, "exit").then(([code]) => code);
  const spawnFailure = once(child, "error").then(([error]) => { throw error; });
  spawnFailure.catch(() => {});
  const marks = {}, state = { log: "", devtools: null, vault: null, hostPid: null };
  const mark = name => { marks[name] ??= performance.now() - started; };
  mark("spawned");
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", text => {
      state.log += text;
      state.devtools ??= state.log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1] ?? null;
      if (state.devtools) { mark("devtoolsListening"); }
      state.vault ??= state.log.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)/m)?.[1] ?? null;
      if (state.vault) { mark("dotnetHostReady"); }
      state.hostPid ??= Number(state.log.match(/^DOTNET_HOST_PID (\d+)/m)?.[1]) || null;
    });
  }
  const result = { marks, ok: false, errors: [] };
  const fail = message => { result.errors.push(sanitize(message)); };
  let session;
  try {
    const abort = AbortSignal.timeout(timeoutMs);
    const devtools = await Promise.race([waitFor(() => state.devtools, "DevTools port", timeoutMs, abort), spawnFailure]);
    const vault = await waitFor(() => state.vault, "the .NET host", timeoutMs, abort);
    const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json()).find(item => item.type === "page" && item.url.startsWith(vault + "/")), "the application page", timeoutMs, abort);
    mark("pageNavigated");
    session = await connect(page.webSocketDebuggerUrl);
    await waitFor(async () => (await session.send("Runtime.evaluate", { expression: readyExpression, returnByValue: true })).result.value === true, "an interactive application", timeoutMs, abort);
    mark("interactive");
    result.hostPid = state.hostPid;
    try {
      result.processTree = await processTree(child.pid);
      result.workingSetBytes = result.processTree.reduce((sum, item) => sum + item.workingSetBytes, 0);
    } catch (error) { result.processTree = null; result.workingSetBytes = null; fail(error.message); }
    session.close();
    const version = await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json();
    const browser = await connect(version.webSocketDebuggerUrl);
    result.shutdown = await closeBrowserAndMeasure(browser, exited);
    if (!result.shutdown.ok) { fail(result.shutdown.error); }
  } catch (error) {
    fail(error.message);
    result.logTail = sanitize(state.log.slice(-4000));
  } finally {
    if (session && !session.closed) { session.close(); }
    if (child.exitCode === null && child.signalCode === null) {
      const problem = await terminateOwned(child.pid, "the launched application");
      if (problem) { fail(problem); }
      await Promise.race([exited, delay(10000)]);
    }
  }
  if (state.hostPid) {
    try {
      const probe = await probeProcess(state.hostPid);
      result.hostSurvived = probe.running && /^RonSijm\.Slopsidian$/i.test(probe.name);
      if (result.hostSurvived) {
        fail(`The .NET host (PID ${state.hostPid}) survived application exit.`);
        const problem = await terminateOwned(state.hostPid, "the surviving .NET host");
        if (problem) { fail(problem); }
      }
    } catch (error) { result.hostSurvived = null; fail(error.message); }
  } else if (marks.dotnetHostReady !== undefined) {
    result.hostSurvived = null;
    fail("The .NET host PID was not reported, so host exit could not be verified.");
  }
  result.ok = result.errors.length === 0 && marks.interactive !== undefined && result.shutdown?.ok === true && result.hostSurvived === false;
  result.error = result.errors.join("; ") || undefined;
  result.hostLog = state.log.split(/\r?\n/).filter(line => /^(PACKAGED_HOST|ERROR_LOG|DOTNET_HOST_PID|ELECTRON_HOST_PID|VAULT_READY)/.test(line)).map(line => sanitize(line, 600));
  return result;
}
