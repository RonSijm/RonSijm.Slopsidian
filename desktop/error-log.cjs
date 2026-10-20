const { appendFileSync, mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");

function createErrorLog(profile, name = new Date().toISOString().slice(0, 10)) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(name)) { throw new Error("Invalid error log name."); }
  const directory = join(profile, "logs"), path = join(directory, "errors-" + name + ".jsonl");
  mkdirSync(directory, { recursive: true });
  appendFileSync(path, "", "utf8");
  return {
    path,
    append(record) {
      if (record?.schemaVersion !== 1 || typeof record.id !== "string" || typeof record.error?.message !== "string" || typeof record.error?.stack !== "string") { throw new Error("Invalid error log record."); }
      const line = JSON.stringify(record);
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) { throw new Error("Error log record is too large."); }
      // Synchronous append completes before acknowledging the notification, including at shutdown.
      appendFileSync(path, line + "\n", "utf8");
      return path;
    },
    read() { return readFileSync(path, "utf8"); },
  };
}
// A dead renderer cannot report through its own diagnostic IPC channel.
function installRendererDiagnostics(contents, log, { session = "desktop", view = "main" } = {}) {
  let lastProcessId = 0, disposed = false;
  const remember = () => {
    try { const id = contents.getOSProcessId(); if (Number.isSafeInteger(id) && id > 0) { lastProcessId = id; } } catch {}
  };
  const gone = (_event, details) => {
    if (disposed) { return; }
    if (details?.reason === "clean-exit" && details.exitCode === 0) { lastProcessId = 0; return; }
    try {
      remember();
      const reason = String(details?.reason ?? "unknown").slice(0, 128), exitCode = Number.isSafeInteger(details?.exitCode) ? details.exitCode : null;
      const error = new Error(`Renderer exited unexpectedly: ${reason} (exit code ${exitCode ?? "unknown"}).`);
      let page = ""; try { const url = new URL(contents.getURL()); if (["http:", "https:"].includes(url.protocol)) { page = url.origin + url.pathname; } else if (url.protocol === "about:" && url.pathname === "blank") { page = "about:blank"; } } catch {}
      log.append({ schemaVersion: 1, id: randomUUID(), session, timestamp: new Date().toISOString(), source: "host", page,
        context: { view }, native: { reason, exitCode, lastKnownProcessId: lastProcessId },
        error: { name: "RendererProcessExit", message: error.message, stack: error.stack, stackOrigin: "reported", code: "RENDERER_PROCESS_GONE", operation: "render-process-gone" } });
    } catch (error) { console.error("Could not persist renderer exit diagnostic.", error); }
    finally { lastProcessId = 0; }
  };
  const dispose = () => {
    if (disposed) { return; } disposed = true;
    contents.removeListener("did-finish-load", remember); contents.removeListener("render-process-gone", gone); contents.removeListener("destroyed", dispose);
  };
  contents.on("did-finish-load", remember); contents.on("render-process-gone", gone); contents.once("destroyed", dispose); remember();
  return dispose;
}
module.exports = { createErrorLog, installRendererDiagnostics };
