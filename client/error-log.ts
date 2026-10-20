import { describeError, type ErrorRecord } from "./error-record";
import type { App } from "./app";

const session = crypto.randomUUID();
const records: ErrorRecord[] = [];
const journalKey = "slopsidian:error-log:" + session;
const fileName = "errors-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + session + ".jsonl";
let queue = Promise.resolve();
let storageFailure: string | null = null;
let logPath = "OPFS/Slopsidian/logs/" + fileName;
let persisted = 0;
let ipc: import("electron").IpcRenderer | null = null;
try { if (typeof require === "function") { ipc = require("electron").ipcRenderer ?? null; } } catch { /* Standalone browser. */ }

function emergencyJournal(): void {
  // Also survives a page being closed before its OPFS append finishes.
  try { localStorage.setItem(journalKey, records.map(record => JSON.stringify(record)).join("\n") + "\n"); }
  catch (error) { storageFailure = "Error journal: " + describeError(error).message; console.error(storageFailure); }
}

async function logDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return (await (await root.getDirectoryHandle("Slopsidian", { create: true })).getDirectoryHandle("logs", { create: true }));
}

export function recordError(error: unknown, source: ErrorRecord["source"] = "notification", location?: ErrorRecord["context"]): ErrorRecord {
  let context: ErrorRecord["context"] = {};
  try {
    const app = Reflect.get(globalThis, "app") as App | undefined, leaf = app?.workspace.activeLeaf;
    context = { vault: app?.vault.rootPath ?? null, file: app?.workspace.getActiveFile()?.path ?? null, view: leaf?.view.getViewType() ?? null, leafId: leaf?.id };
  } catch { /* A partially disposed view must not break error reporting. */ }
  const record: ErrorRecord = { schemaVersion: 1, id: session + ":" + records.length, session, timestamp: new Date().toISOString(), source,
    error: describeError(error), page: globalThis.location.origin + globalThis.location.pathname, context: { ...context, ...location } };
  records.push(record);
  if (ipc) {
    try {
      const result = ipc.sendSync("vault:error-log", "append", record);
      if (!result?.ok) { throw new Error(result?.error ?? "The desktop error log did not acknowledge this error."); }
      logPath = result.path;
    } catch (failure) { storageFailure = describeError(failure).message; emergencyJournal(); console.error("Error log write failed:", failure); }
  } else {
    emergencyJournal();
    queue = queue.then(async () => {
      const file = await (await logDirectory()).getFileHandle(fileName, { create: true });
      const size = (await file.getFile()).size;
      const stream = await file.createWritable({ keepExistingData: true });
      try {
        await stream.seek(size); await stream.write(JSON.stringify(record) + "\n"); await stream.close();
        persisted++;
        if (persisted === records.length) { localStorage.removeItem(journalKey); }
      }
      catch (error) { await stream.abort().catch(() => {}); throw error; }
    }).catch(failure => { storageFailure = describeError(failure).message; console.error("Error log write failed; local journal retained:", failure); });
  }
  // The smoke harness captures this structured channel across reloads and final teardown.
  console.info("SLOPSIDIAN_DIAGNOSTIC", JSON.stringify(record));
  return record;
}

export async function flushErrorLog(): Promise<{ path: string; storageFailure: string | null }> {
  await queue;
  return { path: logPath, storageFailure };
}

export async function readErrorLog(): Promise<string> {
  await queue;
  if (ipc) {
    const result = ipc.sendSync("vault:error-log", "read");
    if (!result?.ok) { throw new Error(result?.error ?? "Cannot read the desktop error log."); }
    return result.text;
  }
  const entries = new Map<string, ErrorRecord>();
  const add = (text: string): void => { for (const line of text.split("\n").filter(Boolean)) { const record = JSON.parse(line) as ErrorRecord; entries.set(record.id, record); } };
  try {
    const directory = await logDirectory();
    for await (const [name, handle] of directory.entries()) {
      if (name.startsWith("errors-") && name.endsWith(".jsonl") && handle.kind === "file") { add(await (await (handle as FileSystemFileHandle).getFile()).text()); }
    }
  } catch (error) { console.error("Cannot read the OPFS error log; reading the journal:", error); }
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith("slopsidian:error-log:")) { add(localStorage.getItem(key) ?? ""); } }
  return [...entries.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(record => JSON.stringify(record)).join("\n");
}

export async function downloadErrorLog(): Promise<void> {
  const url = URL.createObjectURL(new Blob([await readErrorLog()], { type: "application/x-ndjson" }));
  const link = document.createElement("a"); link.href = url; link.download = "slopsidian-errors.jsonl"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function recordHostError(message: string, stack: string): void {
  const error = new Error(message); error.name = "HostError"; error.stack = stack;
  recordError(error, "host");
}

Object.assign(globalThis, { slopsidianDiagnostics: { current: () => [...records], flush: flushErrorLog, read: readErrorLog, download: downloadErrorLog, reportHostError: recordHostError } });
