const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { readRescueManifest } = require("./draft-rescue-catalog.cjs");
const { LIMITS: RESCUE_LIMITS } = require("./draft-rescue.cjs");
const LIMITS = Object.freeze({ bytes: RESCUE_LIMITS.bytes, previewBytes: 64 * 1024, chunkBytes: 64 * 1024 });
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Explicit bounded inspection of a profile copy; source note paths are never opened. */
async function inspectDraftRescue(profile, id, file, version, io = fs) {
  if (typeof file !== "string" || typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version)) {
    throw new Error("Choose a copy from a freshly loaded rescue list.");
  }
  const manifest = await readRescueManifest(profile, id);
  if (manifest.version !== version) { throw new Error("Copy information changed. Refresh the rescue list before inspecting again."); }
  const copy = manifest.raw.drafts.find(draft => draft.file === file);
  if (!copy) { throw new Error("The selected file is not a recorded Markdown rescue copy."); }
  const result = {
    state: "unavailable", message: "This copy could not be inspected.", checkedAt: new Date().toISOString(),
    expectedBytes: copy.bytes, expectedSha256: copy.sha256, expectedBom: copy.hasBom,
    actualBytes: null, actualSha256: null, actualBom: null, preview: null, previewTruncated: false,
  };
  let handle;
  try {
    const fullPath = path.join(manifest.directory, file), stat = await io.lstat(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) { throw new Error("The selected copy is linked or is not an ordinary file."); }
    if (stat.size > LIMITS.bytes) { throw new Error("The selected copy exceeds the 32 MiB inspection limit."); }
    handle = await io.open(fullPath, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(stat, opened)) { throw new Error("The selected copy changed while opening. Inspect it again."); }
    const hash = createHash("sha256"), decoder = new TextDecoder("utf-8", { fatal: true });
    const buffer = Buffer.alloc(LIMITS.chunkBytes), preview = Buffer.alloc(LIMITS.previewBytes);
    let length = 0, previewLength = 0, validUtf8 = true;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, LIMITS.bytes + 1 - length), length);
      if (!bytesRead) { break; }
      length += bytesRead;
      if (length > LIMITS.bytes) { throw new Error("The selected copy grew beyond the 32 MiB inspection limit."); }
      const chunk = buffer.subarray(0, bytesRead); hash.update(chunk);
      if (validUtf8) { try { decoder.decode(chunk, { stream: true }); } catch { validUtf8 = false; } }
      const take = Math.min(bytesRead, preview.length - previewLength);
      chunk.copy(preview, previewLength, 0, take); previewLength += take;
    }
    if (validUtf8) { try { decoder.decode(); } catch { validUtf8 = false; } }
    const final = await handle.stat(), currentPath = await io.lstat(fullPath);
    if (length !== opened.size || !sameFile(opened, final) || !currentPath.isFile() || currentPath.isSymbolicLink() || !sameFile(final, currentPath)) {
      throw new Error("The selected copy changed while reading. Inspect it again.");
    }
    result.actualBytes = length; result.actualSha256 = hash.digest("hex");
    result.actualBom = previewLength >= 3 && preview[0] === 0xef && preview[1] === 0xbb && preview[2] === 0xbf;
    if (!validUtf8) { throw new Error("The selected copy is not valid UTF-8. No text preview is available."); }
    result.previewTruncated = length > previewLength;
    result.preview = new TextDecoder("utf-8", { fatal: true }).decode(preview.subarray(0, previewLength), { stream: result.previewTruncated });
    const matches = result.actualBytes === copy.bytes && result.actualSha256 === copy.sha256 && result.actualBom === copy.hasBom;
    result.state = !copy.copied ? "incomplete" : matches ? "verified" : "changed";
    result.message = !copy.copied ? "This capture recorded a failed copy. The text may be incomplete."
      : matches ? "Matches the recorded capture. This check describes the bytes just read."
        : "This copy differs from the recorded capture. Review its text before using it.";
  } catch (error) {
    result.state = error.code === "ENOENT" ? "missing" : "unavailable";
    result.message = error.code === "ENOENT" ? "This copy is missing. Refresh the rescue list or review the folder manually." : String(error.message ?? error);
    result.preview = null; result.previewTruncated = false;
  } finally { await handle?.close(); }
  // A result must still describe the same reviewed metadata after the file read.
  if ((await readRescueManifest(profile, id)).version !== version) { throw new Error("Copy information changed during inspection. Refresh the rescue list."); }
  return result;
}

module.exports = { inspectDraftRescue, LIMITS };
