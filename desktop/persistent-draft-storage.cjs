const KEY_PREFIX = "slopsidian:persistent-draft";
const MAX_VALUE_BYTES = 9 * 1024 * 1024;

function checkKey(key) {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX) || key.length > 512) { throw new Error("Not a persistent draft storage key."); }
}

/** Narrow profile-SQLite surface for persistent Markdown drafts: reads, prefix listing and compare-and-set only. */
function handlePersistentDraftRequest(storage, operation, key, expected, value) {
  checkKey(key);
  if (operation === "get") { return { value: storage.getItem(key) }; }
  if (operation === "list") { return { rows: storage.listItems(key) }; }
  if (operation === "cas") {
    if (expected !== null && typeof expected !== "string") { throw new TypeError("The expected draft value must be text or null."); }
    if (value !== null && typeof value !== "string") { throw new TypeError("The draft value must be text or null."); }
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) { throw new Error("The draft record is too large for profile storage."); }
    if (value === null) {
      if (expected === null) { return { applied: true }; }
      return { applied: storage.compareAndRemoveItem(key, expected) };
    }
    return { applied: storage.compareAndSetItem(key, expected, value) };
  }
  if (operation === "txn") {
    const pairs = (list, name) => {
      if (!Array.isArray(list) || list.length > 8) { throw new TypeError("Invalid draft transaction " + name + "."); }
      return list.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2) { throw new TypeError("Invalid draft transaction " + name + "."); }
        checkKey(entry[0]);
        if (entry[1] !== null && typeof entry[1] !== "string") { throw new TypeError("Draft transaction values must be text or null."); }
        if (typeof entry[1] === "string" && Buffer.byteLength(entry[1], "utf8") > MAX_VALUE_BYTES) { throw new Error("The draft record is too large for profile storage."); }
        return [entry[0], entry[1]];
      });
    };
    if (!value || typeof value !== "object") { throw new TypeError("A draft transaction needs expectations and writes."); }
    return { applied: storage.compareAndApply(pairs(value.expect, "expectations"), pairs(value.writes, "writes")) };
  }
  throw new Error("Unknown persistent draft storage operation.");
}

module.exports = { handlePersistentDraftRequest, KEY_PREFIX };
