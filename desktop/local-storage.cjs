const { DatabaseSync } = require("node:sqlite");

function createProfileStorage(file) {
  const database = new DatabaseSync(file);
  try {
    database.exec("PRAGMA busy_timeout = 2500; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS vault_local_storage (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;");
    const read = database.prepare("SELECT value FROM vault_local_storage WHERE key = ?");
    const write = database.prepare("INSERT INTO vault_local_storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const remove = database.prepare("DELETE FROM vault_local_storage WHERE key = ?");
    const insertAbsent = database.prepare("INSERT INTO vault_local_storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING");
    const replaceExpected = database.prepare("UPDATE vault_local_storage SET value = ? WHERE key = ? AND value = ?");
    const removeExpected = database.prepare("DELETE FROM vault_local_storage WHERE key = ? AND value = ?");
    const listPrefix = database.prepare("SELECT key, value FROM vault_local_storage WHERE substr(key, 1, ?) = ? ORDER BY key");
    const checkKey = key => {
      if (typeof key !== "string") { throw new TypeError("A profile storage key must be a string."); }
    };
    return {
      getItem(key) {
        checkKey(key);
        return read.get(key)?.value ?? null;
      },
      setItem(key, value) {
        checkKey(key);
        if (typeof value !== "string") { throw new TypeError("A profile storage value must be a string."); }
        write.run(key, value);
      },
      removeItem(key) {
        checkKey(key);
        remove.run(key);
      },
      compareAndSetItem(key, expected, value) {
        checkKey(key);
        if (expected !== null && typeof expected !== "string" || typeof value !== "string") { throw new TypeError("Conditional profile writes need a string/null expectation and a string value."); }
        return Number((expected === null ? insertAbsent.run(key, value) : replaceExpected.run(value, key, expected)).changes) === 1;
      },
      compareAndRemoveItem(key, expected) {
        checkKey(key);
        if (typeof expected !== "string") { throw new TypeError("A conditional profile delete needs a string expectation."); }
        return Number(removeExpected.run(key, expected).changes) === 1;
      },
      listItems(prefix) {
        checkKey(prefix);
        return listPrefix.all(prefix.length, prefix).map(row => ({ key: row.key, value: row.value }));
      },
      /** All-or-nothing: applies every write only if every expected value (null = absent) is still current. */
      compareAndApply(expectations, writes) {
        for (const [key, expected] of expectations) { checkKey(key); if (expected !== null && typeof expected !== "string") { throw new TypeError("Expectations must be text or null."); } }
        for (const [key, value] of writes) { checkKey(key); if (value !== null && typeof value !== "string") { throw new TypeError("Writes must be text or null."); } }
        database.exec("BEGIN IMMEDIATE");
        try {
          for (const [key, expected] of expectations) {
            if ((read.get(key)?.value ?? null) !== expected) { database.exec("ROLLBACK"); return false; }
          }
          for (const [key, value] of writes) { if (value === null) { remove.run(key); } else { write.run(key, value); } }
          database.exec("COMMIT");
          return true;
        } catch (error) {
          try { database.exec("ROLLBACK"); } catch { /* already rolled back */ }
          throw error;
        }
      },
      close() { database.close(); },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

module.exports = { createProfileStorage };
