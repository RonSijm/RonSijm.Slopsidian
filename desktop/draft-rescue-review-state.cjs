const { readRescueManifest, listDraftRescues } = require("./draft-rescue-catalog.cjs");

const KEY = "desktop:draft-rescue-reviewed:v1";
const LIMITS = Object.freeze({ folders: 100, bytes: 128 * 1024 });
const identifier = /^rescue-\d{14}-[A-Za-z0-9]{6}$/;
const versionPattern = /^[a-f0-9]{64}$/;

function parseReviewState(raw) {
  if (raw === null) { return { schemaVersion: 1, folders: [] }; }
  if (typeof raw !== "string" || Buffer.byteLength(raw) > LIMITS.bytes) { throw new Error("Saved rescue review preferences exceed the supported size."); }
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error("Saved rescue review preferences are not valid JSON."); }
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.folders) || value.folders.length > LIMITS.folders) {
    throw new Error("Saved rescue review preferences use an unsupported format or exceed 100 entries.");
  }
  const seen = new Set();
  for (const folder of value.folders) {
    if (!folder || typeof folder.id !== "string" || !identifier.test(folder.id) || seen.has(folder.id)
      || typeof folder.version !== "string" || !versionPattern.test(folder.version)
      || typeof folder.reviewedAt !== "string" || !Number.isFinite(Date.parse(folder.reviewedAt))
      || new Date(folder.reviewedAt).toISOString() !== folder.reviewedAt) {
      throw new Error("Saved rescue review preferences contain an invalid or duplicate entry.");
    }
    seen.add(folder.id);
  }
  return value;
}

/** Own profile preference only. Never modify a rescue folder or source note. */
function createRescueReviewState(storage, readManifest = readRescueManifest) {
  let tail = Promise.resolve();
  return {
    async catalog(profile) {
      const catalog = await listDraftRescues(profile);
      let saved, reviewError;
      try { saved = parseReviewState(storage.getItem(KEY)); }
      catch (error) { saved = { folders: [] }; reviewError = "Saved review status could not be read. " + error.message; }
      const reviewed = new Map(saved.folders.map(folder => [folder.id, folder]));
      const result = { ...catalog, folders: catalog.folders.map(folder => {
        const entry = reviewed.get(folder.id), matches = Boolean(folder.readable && folder.version && entry?.version === folder.version);
        return { ...folder, reviewed: matches, reviewedAt: matches ? entry.reviewedAt : null };
      }) };
      if (reviewError) { result.reviewError = reviewError; }
      return result;
    },
    setReviewed(profile, id, version, reviewed) {
      const operation = tail.then(async () => {
        if (typeof id !== "string" || !identifier.test(id) || typeof reviewed !== "boolean" || typeof version !== "string" || !versionPattern.test(version)) {
          throw new Error("Choose a readable capture from the current rescue list.");
        }
        if ((await readManifest(profile, id)).version !== version) { throw new Error("Copy information changed. Refresh the list before changing its review status."); }
        const before = storage.getItem(KEY), state = parseReviewState(before);
        const index = state.folders.findIndex(folder => folder.id === id), prior = state.folders[index];
        let changed = false;
        if (reviewed && prior?.version !== version) {
          if (index < 0 && state.folders.length >= LIMITS.folders) { throw new Error("The profile already remembers 100 reviewed folders. Existing review preferences were kept."); }
          const entry = { ...prior, id, version, reviewedAt: new Date().toISOString() };
          if (index < 0) { state.folders.push(entry); } else { state.folders[index] = entry; }
          changed = true;
        } else if (!reviewed && index >= 0) {
          state.folders.splice(index, 1); changed = true;
        }
        const after = JSON.stringify(state);
        if (Buffer.byteLength(after) > LIMITS.bytes) { throw new Error("The review preference would exceed 128 KiB. Existing preferences were kept."); }
        if ((await readManifest(profile, id)).version !== version) { throw new Error("Copy information changed while saving review status. Refresh the list."); }
        if (changed) {
          if (!storage.compareAndSetItem(KEY, before, after)) { throw new Error("Review preferences changed elsewhere. Refresh the list before trying again."); }
        } else if (storage.getItem(KEY) !== before) { throw new Error("Review preferences changed elsewhere. Refresh the list before trying again."); }
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async whenIdle() { let pending; do { pending = tail; await pending; } while (pending !== tail); },
  };
}

module.exports = { KEY, LIMITS, parseReviewState, createRescueReviewState };
