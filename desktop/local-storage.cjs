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
      close() { database.close(); },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

module.exports = { createProfileStorage };
