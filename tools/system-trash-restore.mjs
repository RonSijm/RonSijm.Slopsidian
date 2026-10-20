import { spawn } from "node:child_process";
import { lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import { win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Restore/cleanup helpers for the connected system-trash scenario. They only ever touch the single Recycle Bin item whose
// exact $R path the host returned for a disposable vault item; they never enumerate the bin and never use a global undo.

// Only ENOENT means absent; permission and I/O errors surface so they can never bypass the occupied-destination refusal.
export const pathExists = path => stat(path).then(() => true, error => { if (error.code === "ENOENT") { return false; } throw error; });

const itemPattern = /^([A-Za-z]:\\)\$Recycle\.Bin\\(S-1-[0-9]+(?:-[0-9]+)+)\\(\$R[A-Za-z0-9]{1,16}(?:\.[^\\/:*?"<>|\0]{0,32})?)$/i;

// Accepts only a normalized absolute <volume root>\$Recycle.Bin\<account SID>\$R<item> path (no traversal, no lookalike elsewhere).
function infoPath(recycledPath) {
  if (typeof recycledPath !== "string" || !win32.isAbsolute(recycledPath) || win32.normalize(recycledPath) !== recycledPath) { throw new Error("Not an exact Recycle Bin item path: " + recycledPath); }
  const match = itemPattern.exec(recycledPath);
  if (!match) { throw new Error("Not an exact Recycle Bin item path: " + recycledPath); }
  return win32.join(win32.dirname(recycledPath), "$I" + match[3].slice(2));
}

// Rejects reparse aliases: the item and every parent below the volume root must be real, non-link entries.
async function assertOrdinary(recycledPath) {
  const resolved = await realpath(recycledPath);
  if (resolved.toLowerCase() !== recycledPath.toLowerCase()) { throw new Error("The Recycle Bin item path resolves elsewhere (reparse alias): " + resolved); }
  if ((await lstat(recycledPath)).isSymbolicLink()) { throw new Error("The Recycle Bin item is a link: " + recycledPath); }
}

// Parses the version 1/2 $I metadata sidecar that Explorer itself uses to restore the item, validating every field.
export function parseRecycleInfo(bytes) {
  if (bytes.length < 24) { throw new Error("Recycle Bin metadata is truncated"); }
  const version = Number(bytes.readBigInt64LE(0));
  if (version !== 1 && version !== 2) { throw new Error("Unsupported Recycle Bin metadata version " + version); }
  const size = bytes.readBigInt64LE(8);
  if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) { throw new Error("Recycle Bin metadata has an invalid size"); }
  let units, offset;
  if (version === 2) {
    if (bytes.length < 28) { throw new Error("Recycle Bin metadata is truncated"); }
    units = bytes.readInt32LE(24); offset = 28;
    if (units < 2 || units > 32768 || bytes.length !== offset + units * 2) { throw new Error("Recycle Bin metadata has an invalid path length"); }
  } else {
    offset = 24; units = 260;
    if (bytes.length !== offset + units * 2) { throw new Error("Recycle Bin metadata has an invalid length"); }
  }
  const text = bytes.subarray(offset, offset + units * 2).toString("utf16le"), end = text.indexOf("\0");
  if (end < 1 || /[^\0]/.test(text.slice(end))) { throw new Error("Recycle Bin metadata path is not a single NUL-terminated string"); }
  const originalPath = text.slice(0, end);
  if (!/^[A-Za-z]:\\/.test(originalPath)) { throw new Error("Recycle Bin metadata path is not an absolute drive path"); }
  return { version, size: Number(size), originalPath };
}

export async function readRecycleInfo(recycledPath) {
  const sidecar = infoPath(recycledPath);
  await assertOrdinary(recycledPath);
  return parseRecycleInfo(await readFile(sidecar));
}
const script = `
$ErrorActionPreference = 'Stop'
$item = (New-Object -ComObject Shell.Application).NameSpace(10).ParseName($env:SLOPSIDIAN_RECYCLED_ITEM)
if ($null -eq $item) { exit 3 }
$item.InvokeVerb('undelete')
`;

// Restores exactly one captured item with the Shell's own "undelete" verb. The metadata must name the expected original path
// and the destination must be free, so Explorer never shows a conflict dialog. Returns { method } or throws with the boundary.
export async function shellRestore(recycledPath, originalPath, { timeout = 20000 } = {}) {
  const info = await readRecycleInfo(recycledPath);
  if (info.originalPath.toLowerCase() !== originalPath.toLowerCase()) { throw new Error(`Recycle Bin metadata names ${info.originalPath}, not ${originalPath}`); }
  if (await pathExists(originalPath)) { throw new Error("The original path is occupied; the restore was refused: " + originalPath); }
  const code = await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, SLOPSIDIAN_RECYCLED_ITEM: recycledPath }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Shell restore timed out")); }, timeout);
    child.once("error", reject); child.once("exit", status => { clearTimeout(timer); resolve(status); });
  });
  if (code === 3) { throw new Error("The Shell namespace did not resolve the exact recycled item; use the documented file-level restore"); }
  if (code !== 0) { throw new Error("Shell restore failed with exit code " + code); }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await pathExists(originalPath) && !await pathExists(recycledPath)) { return { method: "shell-undelete" }; }
    await delay(200);
  }
  throw new Error("The Shell did not restore the item within the bound");
}

// Disposable-item cleanup by exact captured path ($R and its $I sidecar).
export async function removeOwnedItem(recycledPath) {
  const sidecar = infoPath(recycledPath);
  await rm(recycledPath, { force: true, recursive: true });
  await rm(sidecar, { force: true });
}
