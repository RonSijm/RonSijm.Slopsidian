const fs = require("node:fs");
const path = require("node:path");

const KEY = "slopsidian:native-recent-vaults";
const MAX_PATH = 32767;

/** Same spelling rules as the vault host: normalized, separator-trimmed and case-insensitive on Windows. */
function identityOf(directory, realpath = fs.realpathSync.native) {
  let resolved = path.resolve(directory);
  try { resolved = realpath(resolved); }
  catch (error) { if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") { throw error; } }
  const trimmed = resolved.length > path.parse(resolved).root.length ? resolved.replace(/[\\/]+$/, "") : resolved;
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function checkPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH || value.includes("\0") || !path.isAbsolute(value)) {
    throw new Error("A recent vault must be an absolute directory path.");
  }
  return value;
}

function parse(text) {
  if (text === null) { return []; }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The recent vault list in the application profile is not valid JSON; it was left unchanged."); }
  if (!data || data.version !== 1 || !Array.isArray(data.vaults)) { throw new Error("The recent vault list in the application profile has an unsupported format; it was left unchanged."); }
  return data.vaults.map(entry => {
    if (!entry || typeof entry.path !== "string" || !Number.isFinite(entry.openedAt)) { throw new Error("The recent vault list in the application profile is damaged; it was left unchanged."); }
    return { path: checkPath(entry.path), openedAt: entry.openedAt };
  });
}

const order = entries => entries.toSorted((a, b) => b.openedAt - a.openedAt);

/**
 * Local-profile most-recently-opened list of native vaults. Like the browser handle recents it is ordered by
 * openedAt, moves a reopened vault to the front and has no extra cap. It never touches vault directories.
 */
function createNativeRecentVaults(storage, now = Date.now) {
  return {
    list() {
      return order(parse(storage.getItem(KEY))).map(entry => ({ path: entry.path, name: path.basename(entry.path) || entry.path }));
    },
    remember(directory) {
      checkPath(directory);
      if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) { throw new Error("Only an existing vault directory can be remembered."); }
      const identity = identityOf(directory);
      for (let attempt = 0; attempt < 8; attempt++) {
        const text = storage.getItem(KEY);
        const current = parse(text);
        const openedAt = current.reduce((latest, entry) => Math.max(latest, entry.openedAt + 1), now());
        const next = [{ path: path.resolve(directory), openedAt }, ...current.filter(entry => identityOf(entry.path) !== identity)];
        if (storage.compareAndApply([[KEY, text]], [[KEY, JSON.stringify({ version: 1, vaults: order(next) })]])) { return; }
      }
      throw new Error("The recent vault list kept changing; the vault was not remembered.");
    },
  };
}

function handleNativeRecentRequest(recents, operation, directory) {
  if (operation === "list" && directory === undefined) { return recents.list(); }
  if (operation === "remember") { recents.remember(directory); return null; }
  throw new Error("Unknown native recent vault operation.");
}

module.exports = { createNativeRecentVaults, handleNativeRecentRequest, identityOf, KEY };
