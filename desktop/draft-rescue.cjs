const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_DRAFTS = 100, MAX_BYTES = 32 * 1024 * 1024, MAX_SNAPSHOTS = 20;
const LIMITS = Object.freeze({ drafts: MAX_DRAFTS, bytes: MAX_BYTES, snapshots: MAX_SNAPSHOTS });

function validateDraftSnapshot(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.drafts) || value.drafts.length > MAX_DRAFTS
    || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)) || new Date(value.capturedAt).toISOString() !== value.capturedAt) {
    throw new Error("The renderer did not provide a supported Markdown draft snapshot.");
  }
  let bytes = 0;
  const seen = new Set();
  const drafts = value.drafts.map(draft => {
    if (!draft || typeof draft.sourceRoot !== "string" || !draft.sourceRoot || draft.sourceRoot.length > 32768
      || typeof draft.sourcePath !== "string" || !draft.sourcePath || draft.sourcePath.length > 32768
      || /[\\:\u0000-\u001f]/.test(draft.sourcePath) || draft.sourcePath.split("/").some(part => !part || part === "." || part === "..")
      || !draft.sourcePath.toLowerCase().endsWith(".md") || typeof draft.sourceVersion !== "string" || draft.sourceVersion.length > 32768
      || typeof draft.hasBom !== "boolean" || typeof draft.content !== "string" || !draft.content.isWellFormed()) {
      throw new Error("A Markdown draft is invalid or contains text that cannot be copied losslessly.");
    }
    const key = JSON.stringify([draft.sourceRoot, draft.sourcePath]);
    if (seen.has(key)) { throw new Error("The snapshot contains duplicate Markdown drafts."); }
    seen.add(key);
    bytes += Buffer.byteLength(draft.content, "utf8") + (draft.hasBom ? 3 : 0);
    if (bytes > MAX_BYTES) { throw new Error("Markdown rescue exceeds 32 MiB. Keep the window open and copy the text manually."); }
    return { sourceRoot: draft.sourceRoot, sourcePath: draft.sourcePath, sourceVersion: draft.sourceVersion, hasBom: draft.hasBom, content: draft.content };
  });
  return { schemaVersion: 1, capturedAt: value.capturedAt, drafts };
}

function rescueName(sourcePath, index) {
  const stem = Array.from(path.posix.basename(sourcePath).slice(0, -3).toWellFormed().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")).slice(0, 40).join("").replace(/[. ]+$/, "") || "note";
  return String(index + 1).padStart(3, "0") + "-" + stem + ".md";
}

async function exclusiveWrite(file, bytes, io) {
  const handle = await io.open(file, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

/** New profile files only. Preserve readable partial copies if another write fails. */
async function writeDraftRescue(profile, value, io = fs) {
  const snapshot = validateDraftSnapshot(value);
  const result = { directory: null, capturedAt: snapshot.capturedAt, total: snapshot.drafts.length, copied: 0, errors: [], complete: true };
  if (!snapshot.drafts.length) { return result; }
  const base = path.join(profile, "draft-rescue");
  await io.mkdir(base, { recursive: true, mode: 0o700 });
  if ((await io.lstat(base)).isSymbolicLink()) { throw new Error("The profile's draft-rescue folder must not be a link."); }
  if ((await io.readdir(base)).length >= MAX_SNAPSHOTS) {
    throw new Error("The draft-rescue folder already has 20 entries. Move earlier copies elsewhere before trying again; no copies were deleted.");
  }
  const directory = await io.mkdtemp(path.join(base, "rescue-" + snapshot.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14) + "-"));
  result.directory = directory;
  const entries = [];
  for (const [index, draft] of snapshot.drafts.entries()) {
    const file = rescueName(draft.sourcePath, index);
    const bytes = Buffer.concat([draft.hasBom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(draft.content, "utf8")]);
    const entry = { sourceRoot: draft.sourceRoot, sourcePath: draft.sourcePath, sourceVersion: draft.sourceVersion, hasBom: draft.hasBom, file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    try { await exclusiveWrite(path.join(directory, file), bytes, io); result.copied++; entry.copied = true; }
    catch (error) { entry.copied = false; result.errors.push("Could not copy " + draft.sourcePath + ": " + error.message); }
    entries.push(entry);
  }
  try {
    await exclusiveWrite(path.join(directory, "manifest.json"), Buffer.from(JSON.stringify({
      schemaVersion: 1, capturedAt: snapshot.capturedAt, scope: "Unsaved built-in Markdown only; original note paths are metadata, not restore targets.",
      drafts: entries, errors: [...result.errors],
    }, null, 2) + "\n"), io);
  } catch (error) { result.errors.push("Could not write the rescue manifest: " + error.message); }
  result.complete = result.errors.length === 0;
  return result;
}

/** Serialize close/exit races; reuse only a fully successful identical capture. */
function createDraftRescuer(capture, save) {
  let tail = Promise.resolve(), lastKey = null, lastResult = null;
  return {
    capture() {
      const operation = tail.then(async () => {
        try {
          const snapshot = validateDraftSnapshot(await capture());
          const key = JSON.stringify(snapshot.drafts);
          if (key === lastKey && lastResult?.complete) { return lastResult; }
          const result = await save(snapshot);
          if (result.complete) { lastKey = key; lastResult = result; }
          return result;
        } catch (error) {
          return { directory: null, previousDirectory: lastResult?.directory ?? null, capturedAt: null, total: null, copied: 0, complete: false, errors: [String(error?.message ?? error)] };
        }
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}

module.exports = { validateDraftSnapshot, rescueName, writeDraftRescue, createDraftRescuer, LIMITS };
