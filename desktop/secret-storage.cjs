const { DatabaseSync } = require("node:sqlite");
const { existsSync, mkdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID = 128;
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_SECRETS = 1000;
const BUSY_TIMEOUT_MS = 5000;
const MAX_CIPHER_CHARS = 2 * MAX_SECRET_BYTES + 4096;
const CIPHER = /^[A-Za-z0-9+/]*={0,2}$/;

class SecretStorageError extends Error {
  constructor(message, options) { super(message, options); this.name = "SecretStorageError"; }
}

const codeOf = failure => typeof failure?.code === "string" ? failure.code : "unknown";
const isBusy = failure => failure?.errcode === 5 || failure?.errcode === 6 || (failure?.errcode & 0xff) === 5 || (failure?.errcode & 0xff) === 6 || /database (table )?is locked|busy/i.test(String(failure?.message));

/**
 * Profile-wide secret store. Values are encrypted with the operating system's
 * credential protection (Electron safeStorage: DPAPI, Keychain or a keyring) and
 * only ciphertext reaches disk, in a SQLite database whose per-entry mutations run in
 * IMMEDIATE transactions, so application instances sharing the profile are serialized by
 * SQLite itself (no stale-lock protocol). A contended write that cannot finish within the
 * busy timeout fails visibly and changes nothing. When no real OS protection exists every
 * operation fails instead of falling back to plaintext or obfuscation.
 * `legacyFile` (optional) is an earlier JSON ciphertext store whose entries are imported once; it is never modified.
 */
function createSecretStorage(file, safeStorage, { busyTimeoutMs = BUSY_TIMEOUT_MS, maxSecrets = MAX_SECRETS, legacyFile, open = location => new DatabaseSync(location) } = {}) {
  function protection() {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== "function" || !safeStorage.isEncryptionAvailable()) { return null; }
    const backend = typeof safeStorage.getSelectedStorageBackend === "function" ? safeStorage.getSelectedStorageBackend() : "os";
    return backend === "basic_text" || backend === "unknown" ? null : backend;
  }
  function requireProtection() {
    const backend = protection();
    if (!backend) { throw new SecretStorageError("Operating-system secret protection is not available, so secrets cannot be stored or read. Nothing was written."); }
    return backend;
  }
  function checkId(id) {
    if (typeof id !== "string" || id.length > MAX_ID || !ID.test(id)) { throw new SecretStorageError("A secret ID must be lowercase alphanumeric text with optional single dashes."); }
  }
  function readLegacy() {
    let size;
    try { size = statSync(legacyFile).size; }
    catch (error) { if (error.code === "ENOENT") { return []; } throw error; }
    if (size > maxSecrets * (MAX_ID + MAX_CIPHER_CHARS + 64) + 1024) { throw new SecretStorageError("The earlier secret store is too large to import; it was not modified."); }
    const parsed = JSON.parse(readFileSync(legacyFile, "utf8"));
    if (!parsed || parsed.version !== 1 || !parsed.secrets || typeof parsed.secrets !== "object" || Array.isArray(parsed.secrets)) { throw new SecretStorageError("The earlier secret store has an unsupported format; it was not modified."); }
    const entries = Object.entries(parsed.secrets);
    if (entries.length > maxSecrets) { throw new SecretStorageError("The earlier secret store has more entries than this store allows; it was not imported or modified."); }
    return entries.map(([id, value]) => {
      if (id.length > MAX_ID || !ID.test(id) || typeof value !== "string" || value.length > MAX_CIPHER_CHARS || !CIPHER.test(value)) { throw new SecretStorageError("The earlier secret store contains an invalid entry; it was not imported or modified."); }
      return [id, value];
    });
  }
  function withTransaction(action) {
    let database;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      database = open(file);
      database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
      database.exec("BEGIN IMMEDIATE");
    } catch (error) {
      throw withClose(wrap(error), database, error);
    }
    let result;
    try {
      if (legacyFile && existsSync(legacyFile)) {
        database.exec("CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, cipher TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT");
        if (!database.prepare("SELECT 1 FROM meta WHERE key = 'legacy-imported'").get()) {
          const insert = database.prepare("INSERT OR IGNORE INTO secrets (id, cipher) VALUES (?, ?)");
          for (const [id, value] of readLegacy()) { insert.run(id, value); }
          if (database.prepare("SELECT COUNT(*) AS count FROM secrets").get().count > maxSecrets) { throw new SecretStorageError("Importing the earlier secret store would exceed this store's capacity; it was not imported or modified."); }
          database.prepare("INSERT INTO meta (key, value) VALUES ('legacy-imported', '1')").run();
        }
      }
      database.exec("CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, cipher TEXT NOT NULL) STRICT");
      result = action(database);
      database.exec("COMMIT");
    } catch (error) {
      let wrapped = wrap(error);
      try { database.exec("ROLLBACK"); }
      catch (rollback) {
        wrapped = wrap(error, false);
        wrapped = new SecretStorageError(`${wrapped.message} The transaction could not be rolled back (${codeOf(rollback)}), so whether the change was applied is uncertain; check the stored secrets before relying on them. It was not retried.`, { cause: error });
      }
      throw withClose(wrapped, database, error);
    }
    try { database.close(); }
    catch (error) { throw new SecretStorageError(`The change was committed but the secret store connection could not be closed cleanly (${codeOf(error)}).`, { cause: error }); }
    return result;
  }
  /** Closes the connection and, when that fails too, adds its sanitized code to the original failure. */
  function withClose(wrapped, database, cause) {
    if (!database) { return wrapped; }
    try { database.close(); return wrapped; }
    catch (error) { return new SecretStorageError(`${wrapped.message} The store connection also could not be closed (${codeOf(error)}).`, { cause: cause }); }
  }
  function wrap(error, unchanged = true) {
    if (error instanceof SecretStorageError) { return error; }
    if (isBusy(error)) { return new SecretStorageError(`Another application instance is using the secret store;${unchanged ? " nothing was changed." : ""} Try again.`, { cause: error }); }
    if (/not a database|malformed|corrupt/i.test(String(error?.message))) { return new SecretStorageError("The secret store is unreadable; it was not modified.", { cause: error }); }
    return new SecretStorageError(`The secret store could not be accessed (${codeOf(error)}).${unchanged ? " Nothing was changed." : ""}`, { cause: error });
  }
  return {
    status() { const backend = protection(); return { available: Boolean(backend), protection: backend ? "os-encrypted" : "unavailable", backend }; },
    set(id, secret) {
      requireProtection();
      checkId(id);
      if (typeof secret !== "string") { throw new SecretStorageError("A secret must be a string."); }
      if (Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) { throw new SecretStorageError("A secret may be at most 64 KiB."); }
      const cipher = safeStorage.encryptString(secret).toString("base64");
      withTransaction(database => {
        if (!database.prepare("SELECT 1 FROM secrets WHERE id = ?").get(id) && database.prepare("SELECT COUNT(*) AS count FROM secrets").get().count >= maxSecrets) {
          throw new SecretStorageError("The secret store is full.");
        }
        database.prepare("INSERT OR REPLACE INTO secrets (id, cipher) VALUES (?, ?)").run(id, cipher);
      });
    },
    get(id) {
      requireProtection();
      checkId(id);
      const row = withTransaction(database => database.prepare("SELECT cipher FROM secrets WHERE id = ?").get(id));
      return row ? safeStorage.decryptString(Buffer.from(row.cipher, "base64")) : null;
    },
    list() { requireProtection(); return withTransaction(database => database.prepare("SELECT id FROM secrets ORDER BY id").all().map(row => row.id)); },
    remove(id) {
      requireProtection();
      checkId(id);
      withTransaction(database => { database.prepare("DELETE FROM secrets WHERE id = ?").run(id); });
    },
  };
}
/** Validates the caller before dispatching a synchronous IPC request from the renderer. */
function handleSecretRequest(storage, operation, id, secret) {
  if (operation === "status") { return { ok: true, value: storage.status() }; }
  if (operation === "get") { return { ok: true, value: storage.get(id) }; }
  if (operation === "set") { storage.set(id, secret); return { ok: true, value: null }; }
  if (operation === "list") { return { ok: true, value: storage.list() }; }
  if (operation === "remove") { storage.remove(id); return { ok: true, value: null }; }
  throw new SecretStorageError("Unknown secret storage operation.");
}

/** Builds the IPC listener: only the main frame of the local application window may call it, and never while closing. */
function createSecretIpcHandler({ window, storage, isLocalUrl, isClosing, log = () => {} }) {
  return (event, operation, id, secret) => {
    try {
      const frame = event?.senderFrame;
      if (!frame || event.sender !== window.webContents || frame !== window.webContents.mainFrame || !isLocalUrl(frame.url)) {
        throw new SecretStorageError("Secret storage is only available to the local application window.");
      }
      if (isClosing()) { throw new SecretStorageError("This window is closing. Secret storage was not changed."); }
      if (typeof operation !== "string" || (id !== undefined && typeof id !== "string") || (secret !== undefined && typeof secret !== "string")) {
        throw new SecretStorageError("Secret storage requests need text arguments.");
      }
      event.returnValue = handleSecretRequest(storage, operation, id, secret);
    } catch (error) {
      const message = error instanceof SecretStorageError ? error.message : "Secret storage failed.";
      log("Secret storage failed: " + message);
      if (event) { event.returnValue = { ok: false, error: message }; }
    }
  };
}

module.exports = { createSecretStorage, createSecretIpcHandler, handleSecretRequest, SecretStorageError };
