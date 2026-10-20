const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { rescueName, LIMITS: RESCUE_LIMITS } = require("./draft-rescue.cjs");

const LIMITS = Object.freeze({ scan: 100, folders: 20, manifestBytes: 16 * 1024 * 1024 });
const identifier = /^rescue-\d{14}-[A-Za-z0-9]{6}$/;
const text = value => typeof value === "string" && value.length <= 32768;

function parseManifest(value) {
  if (!value || value.schemaVersion !== 1 || typeof value.capturedAt !== "string"
    || !Number.isFinite(Date.parse(value.capturedAt)) || new Date(value.capturedAt).toISOString() !== value.capturedAt
    || !Array.isArray(value.drafts) || value.drafts.length > RESCUE_LIMITS.drafts
    || !Array.isArray(value.errors) || value.errors.length > RESCUE_LIMITS.drafts || value.errors.some(error => !text(error))) {
    throw new Error("The rescue manifest is invalid or uses an unsupported format.");
  }
  const seen = new Set();
  let totalBytes = 0;
  const drafts = value.drafts.map((draft, index) => {
    if (!draft || !text(draft.sourceRoot) || !draft.sourceRoot || !text(draft.sourcePath) || !draft.sourcePath
      || /[\\:\u0000-\u001f]/.test(draft.sourcePath) || draft.sourcePath.split("/").some(part => !part || part === "." || part === "..")
      || !draft.sourcePath.toLowerCase().endsWith(".md") || !text(draft.sourceVersion)
      || typeof draft.hasBom !== "boolean" || typeof draft.copied !== "boolean"
      || draft.file !== rescueName(draft.sourcePath, index)
      || !Number.isSafeInteger(draft.bytes) || draft.bytes < 0 || draft.bytes > RESCUE_LIMITS.bytes
      || typeof draft.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(draft.sha256)) {
      throw new Error("The rescue manifest contains invalid copy metadata.");
    }
    const key = JSON.stringify([draft.sourceRoot, draft.sourcePath]);
    if (seen.has(key)) { throw new Error("The rescue manifest contains duplicate source notes."); }
    seen.add(key);
    totalBytes += draft.bytes;
    if (totalBytes > RESCUE_LIMITS.bytes) { throw new Error("The manifest exceeds the supported Markdown capture size."); }
    return { sourceRoot: draft.sourceRoot, sourcePath: draft.sourcePath, file: draft.file, copied: draft.copied, bytes: draft.bytes };
  });
  return { capturedAt: value.capturedAt, drafts, errors: [...value.errors] };
}

async function rescueBase(profile) {
  const base = path.join(profile, "draft-rescue");
  let stat;
  try { stat = await fs.lstat(base); }
  catch (error) { if (error.code === "ENOENT") { return null; } throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) { throw new Error("The profile's draft-rescue folder must be an ordinary directory."); }
  return base;
}

async function resolveRescueFolder(profile, id) {
  if (typeof id !== "string" || !identifier.test(id)) { throw new Error("Choose an existing rescue folder from the review panel."); }
  const base = await rescueBase(profile);
  if (!base) { throw new Error("The rescue folder is no longer available. Refresh the list."); }
  const directory = path.join(base, id), stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { throw new Error("The selected rescue folder is missing or is a link. Refresh the list."); }
  const [resolvedBase, resolvedDirectory] = await Promise.all([fs.realpath(base), fs.realpath(directory)]);
  if (path.dirname(resolvedDirectory).toLowerCase() !== resolvedBase.toLowerCase()) { throw new Error("The rescue folder is outside the profile's rescue directory."); }
  return resolvedDirectory;
}

async function readRescueManifest(profile, id) {
  const directory = await resolveRescueFolder(profile, id);
  const file = path.join(directory, "manifest.json"), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.manifestBytes) {
    throw new Error("The manifest must be an ordinary file no larger than 16 MiB.");
  }
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > LIMITS.manifestBytes || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error("The manifest changed while opening. Refresh the list.");
    }
    const bytes = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) { break; }
      length += bytesRead;
    }
    if (length !== opened.size) { throw new Error("The manifest changed while reading. Refresh the list."); }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    return { directory, raw, parsed: parseManifest(raw), version: createHash("sha256").update(bytes.subarray(0, length)).digest("hex") };
  } finally { await handle.close(); }
}

/** Read metadata only. Never create a folder, read note bodies, restore or delete. */
async function listDraftRescues(profile) {
  const base = await rescueBase(profile);
  const result = { folders: [], truncated: false };
  if (!base) { return result; }
  let scanned = 0;
  const candidates = [];
  for await (const entry of await fs.opendir(base)) {
    if (scanned++ === LIMITS.scan) { result.truncated = true; break; }
    if (!identifier.test(entry.name)) { continue; }
    const stat = await fs.lstat(path.join(base, entry.name));
    if (stat.isDirectory() && !stat.isSymbolicLink()) { candidates.push(entry.name); }
  }
  candidates.sort((a, b) => a === b ? 0 : a < b ? 1 : -1);
  if (candidates.length > LIMITS.folders) { result.truncated = true; }
  for (const id of candidates.slice(0, LIMITS.folders)) {
    const folder = { id, directory: path.join(base, id), capturedAt: null, drafts: [], errors: [], readable: false, version: null };
    try {
      const manifest = await readRescueManifest(profile, id);
      Object.assign(folder, manifest.parsed, { readable: true, version: manifest.version });
    } catch (error) {
      folder.errors = ["Cannot read rescue metadata: " + error.message];
    }
    result.folders.push(folder);
  }
  return result;
}

module.exports = { LIMITS, parseManifest, listDraftRescues, resolveRescueFolder, readRescueManifest };
