import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
await mkdir(runtime, { recursive: true });
const directory = await mkdtemp(join(runtime, "hotkey-secret-tests-"));
let BUILTIN_HOTKEYS, HotkeyManager, hotkeySignature, hotkeyFromEvent, printHotkey, SecretStorage, SecretStorageUnavailableError;
try {
  await build({
    entryPoints: [fileURLToPath(new URL("../client/hotkeys.ts", import.meta.url)), fileURLToPath(new URL("../client/secret-storage.ts", import.meta.url)), fileURLToPath(new URL("../client/builtin-hotkeys.ts", import.meta.url))],
    bundle: true, platform: "node", format: "esm", outdir: directory, outExtension: { ".js": ".mjs" }, logLevel: "silent",
    external: ["electron"], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  ({ HotkeyManager, hotkeySignature, hotkeyFromEvent, printHotkey } = await import(pathToFileURL(join(directory, "hotkeys.mjs")).href));
  ({ BUILTIN_HOTKEYS } = await import(pathToFileURL(join(directory, "builtin-hotkeys.mjs")).href));
  ({ SecretStorage, SecretStorageUnavailableError } = await import(pathToFileURL(join(directory, "secret-storage.mjs")).href));
} finally { await rm(directory, { recursive: true, force: true }); }
const { createSecretStorage, createSecretIpcHandler, handleSecretRequest } = require("../desktop/secret-storage.cjs");

function press(key, { ctrl = false, shift = false, alt = false, meta = false, repeat = false, code = "" } = {}) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, code, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta, repeat, isComposing: false });
  return event;
}

function manager(options = {}) {
  const ran = [], runnable = new Set(options.runnable ?? []);
  const instance = new HotkeyManager({
    dispatch: id => { if (!runnable.has(id)) { return false; } ran.push(id); return true; },
    isRepeatable: id => (options.repeatable ?? []).includes(id),
    isRunnable: id => runnable.has(id),
    onError: error => options.errors?.push(error),
    store: options.store,
  });
  return { instance, ran, runnable };
}

function memoryStore(initial = {}) {
  const store = { data: structuredClone(initial), writes: 0, fail: false, root: true,
    ready: () => store.root,
    read: async () => structuredClone(store.data),
    update: async change => { if (store.fail) { throw new Error("disk full"); } const next = structuredClone(store.data); change(next); store.data = next; store.writes++; } };
  return store;
}

test("defaults are normalized, validated atomically and owned by their command", () => {
  const { instance, ran, runnable } = manager({ runnable: ["a", "b"] });
  instance.addDefaultHotkeys("a", [{ modifiers: ["Shift", "Mod", "Mod"], key: "K" }]);
  assert.deepEqual(instance.getDefaultHotkeys("a"), [{ modifiers: ["Mod", "Shift"], key: "K" }]);
  assert.throws(() => instance.addDefaultHotkeys("a", [{ modifiers: ["Super"], key: "k" }]), /supported modifiers/);
  assert.throws(() => instance.addDefaultHotkeys("a", [{ modifiers: [], key: "" }]), /key/);
  assert.deepEqual(instance.getDefaultHotkeys("a"), [{ modifiers: ["Mod", "Shift"], key: "K" }], "A rejected replacement keeps the previous binding.");
  instance.addDefaultHotkeys("b", [{ modifiers: ["Ctrl", "Shift"], key: "k" }]);
  const event = press("K", { ctrl: true, shift: true, code: "KeyK" });
  assert.equal(instance.handle(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(ran, ["b"], "The later registration wins while both are available.");
  runnable.delete("b");
  assert.equal(instance.handle(press("K", { ctrl: true, shift: true })), true);
  assert.deepEqual(ran, ["b", "a"], "An unavailable command does not consume the key.");
  instance.removeDefaultHotkeys("a");
  assert.equal(instance.handle(press("K", { ctrl: true, shift: true })), false);
  assert.deepEqual(instance.getConflicts({ modifiers: ["Ctrl", "Shift"], key: "k" }), ["b"]);
  assert.equal(hotkeySignature({ modifiers: ["Mod"], key: "S" }), hotkeySignature({ modifiers: ["Ctrl"], key: "s" }) , "Mod resolves to Ctrl off macOS.");
});

test("user overrides replace, disable and restore defaults, and survive plugin reloads", () => {
  const { instance, ran } = manager({ runnable: ["note:one", "note:two"] });
  instance.addDefaultHotkeys("note:one", [{ modifiers: ["Ctrl"], key: "1" }]);
  instance.addDefaultHotkeys("note:two", [{ modifiers: ["Ctrl"], key: "2" }]);
  instance.setHotkeys("note:one", [{ modifiers: ["Alt", "Ctrl"], key: "o" }]);
  assert.equal(instance.handle(press("1", { ctrl: true, code: "Digit1" })), false, "The overridden default no longer fires.");
  assert.equal(instance.handle(press("o", { ctrl: true, alt: true })), true);
  instance.setHotkeys("note:two", []);
  assert.equal(instance.handle(press("2", { ctrl: true })), false, "An empty override disables the command's shortcuts.");
  assert.deepEqual(instance.getHotkeys("note:two"), []);
  assert.equal(instance.printHotkeyForCommand("note:two"), "");
  assert.equal(instance.printHotkeyForCommand("note:one"), "Ctrl+Alt+O");
  instance.removeDefaultHotkeys("note:one");
  instance.addDefaultHotkeys("note:one", [{ modifiers: ["Ctrl"], key: "1" }]);
  assert.deepEqual(instance.getActiveHotkeys("note:one"), [{ modifiers: ["Ctrl", "Alt"], key: "o" }], "A reloaded plugin keeps the user's override.");
  instance.removeHotkeys("note:one");
  instance.removeHotkeys("note:two");
  assert.equal(instance.getHotkeys("note:two"), undefined);
  assert.equal(instance.handle(press("2", { ctrl: true })), true);
  assert.deepEqual(ran, ["note:one", "note:two"]);
  assert.throws(() => instance.setHotkeys("note:one", [{ modifiers: ["Bad"], key: "x" }]), /supported modifiers/);
  assert.deepEqual(instance.getHotkeys("note:one"), undefined, "A rejected override is not stored.");
});

test("collisions report every command sharing an active binding and priority favors overrides", () => {
  const { instance, ran } = manager({ runnable: ["first", "second"] });
  instance.addDefaultHotkeys("first", [{ modifiers: ["Mod"], key: "j" }]);
  instance.addDefaultHotkeys("second", [{ modifiers: ["Ctrl"], key: "J" }]);
  assert.deepEqual(instance.getConflicts({ modifiers: ["Mod"], key: "j" }).sort(), ["first", "second"]);
  assert.deepEqual(instance.getConflicts({ modifiers: ["Mod"], key: "j" }, "first"), ["second"]);
  instance.setHotkeys("first", [{ modifiers: ["Ctrl"], key: "j" }]);
  instance.handle(press("j", { ctrl: true }));
  assert.deepEqual(ran, ["first"], "The user's override outranks a plugin default.");
  assert.equal(instance.handle(press("j", { ctrl: true, shift: true })), false, "Extra modifiers do not match.");
  assert.equal(instance.handle(press("j", { ctrl: true, meta: true })), false);
});

test("held keys repeat only repeatable available commands and composition is ignored", () => {
  const { instance, ran, runnable } = manager({ runnable: ["once", "again"], repeatable: ["again"] });
  instance.addDefaultHotkeys("once", [{ modifiers: ["Alt"], key: "x" }]);
  instance.addDefaultHotkeys("again", [{ modifiers: ["Alt"], key: "y" }]);
  let event = press("x", { alt: true, repeat: true });
  assert.equal(instance.handle(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(ran, [], "A held non-repeatable command is swallowed, not rerun.");
  assert.equal(instance.handle(press("y", { alt: true, repeat: true })), true);
  assert.deepEqual(ran, ["again"]);
  runnable.delete("once");
  assert.equal(instance.handle(press("x", { alt: true, repeat: true })), false);
  event = press("y", { alt: true });
  event.isComposing = true;
  assert.equal(instance.handle(event), false);
});

test("overrides persist to the vault store, retain unreadable entries and block overwriting an unreadable file", async () => {
  const store = memoryStore({ keep: [{ modifiers: ["Ctrl"], key: "k" }], broken: "not hotkeys" });
  const { instance } = manager({ store });
  await instance.load();
  assert.deepEqual(instance.getHotkeys("keep"), [{ modifiers: ["Ctrl"], key: "k" }]);
  instance.setHotkeys("added", [{ modifiers: ["Mod", "Shift"], key: "a" }]);
  instance.disableHotkeys("keep");
  await instance.save();
  assert.deepEqual(store.data, { keep: [], broken: "not hotkeys", added: [{ modifiers: ["Mod", "Shift"], key: "a" }] });
  instance.removeHotkeys("added");
  await instance.save();
  assert.equal("added" in store.data, false);
  assert.equal(store.data.broken, "not hotkeys");

  const failing = memoryStore();
  const errors = [], second = manager({ store: failing, errors }).instance;
  await second.load();
  failing.fail = true;
  second.setHotkeys("x", [{ modifiers: [], key: "F5" }]);
  await assert.rejects(() => second.save(), /disk full/);
  failing.fail = false;
  await second.save();
  assert.deepEqual(failing.data, { x: [{ modifiers: [], key: "F5" }] }, "A failed write is retried rather than dropped.");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(errors.length >= 1, "A failed automatic save is reported.");

  const unreadable = memoryStore();
  unreadable.read = async () => { throw new Error("corrupt hotkeys.json"); };
  const third = manager({ store: unreadable, errors }).instance;
  await assert.rejects(() => third.load(), /corrupt/);
  third.setHotkeys("y", [{ modifiers: [], key: "F6" }]);
  await assert.rejects(() => third.save(), /was not overwritten/);
  assert.equal(unreadable.writes, 0);
});

test("a vault switch discards stale overrides and in-flight loads", async () => {
  const store = memoryStore({ one: [{ modifiers: ["Alt"], key: "1" }] });
  const { instance } = manager({ store });
  let release;
  const original = store.read;
  store.read = () => new Promise(resolve => { release = () => resolve(original()); });
  const loading = instance.load();
  instance.reset();
  release();
  await loading;
  assert.equal(instance.getHotkeys("one"), undefined, "A load from the previous vault must not apply.");
  store.read = original;
  await instance.load();
  assert.ok(instance.getHotkeys("one"));
  instance.reset();
  assert.equal(instance.getHotkeys("one"), undefined);
});

// Synthetic reversible stand-in for OS protection; never a real credential.
function fakeSafeStorage({ available = true, backend } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: backend ? () => backend : undefined,
    encryptString: value => Buffer.from("PROTECTED:" + Buffer.from(value, "utf8").reverse().toString("base64")),
    decryptString: buffer => Buffer.from(buffer.toString().replace("PROTECTED:", ""), "base64").reverse().toString("utf8"),
  };
}

test("desktop secrets are stored only as OS-protected ciphertext and validated", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-"));
  try {
    const file = join(root, "secrets.json"), secret = "synthetic-test-secret-value-1";
    const storage = createSecretStorage(file, fakeSafeStorage({ backend: "dpapi" }));
    assert.deepEqual(storage.status(), { available: true, protection: "os-encrypted", backend: "dpapi" });
    assert.equal(storage.get("api-key"), null);
    storage.set("api-key", secret);
    storage.set("empty", "");
    assert.equal(storage.get("api-key"), secret);
    assert.equal(storage.get("empty"), "");
    assert.deepEqual(storage.list(), ["api-key", "empty"]);
    const raw = await readFile(file, "utf8");
    assert.ok(!raw.includes(secret) && !raw.includes(Buffer.from(secret).toString("base64")), "No plaintext may reach disk.");
    for (const bad of ["Upper", "has space", "-lead", "trail-", "a--b", "", "x".repeat(129), "../escape"]) { assert.throws(() => storage.set(bad, "v"), /secret ID/, bad); }
    assert.throws(() => storage.set("big", "x".repeat(70 * 1024)), /64 KiB/);
    assert.throws(() => storage.set("ok", 5), /string/);
    storage.remove("api-key");
    assert.equal(storage.get("api-key"), null);
    assert.deepEqual(handleSecretRequest(storage, "list"), { ok: true, value: ["empty"] });
    assert.throws(() => handleSecretRequest(storage, "wipe"), /Unknown/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("without real OS protection every operation fails and nothing is written", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-"));
  try {
    for (const safe of [fakeSafeStorage({ available: false }), fakeSafeStorage({ backend: "basic_text" }), null]) {
      const file = join(root, "none.json"), storage = createSecretStorage(file, safe);
      assert.deepEqual(storage.status(), { available: false, protection: "unavailable", backend: null });
      assert.throws(() => storage.set("token", "synthetic-secret"), /not available/);
      assert.throws(() => storage.get("token"), /not available/);
      assert.throws(() => storage.list(), /not available/);
      assert.throws(() => storage.remove("token"), /not available/);
      assert.equal(existsSync(file), false);
    }
    const file = join(root, "corrupt.json");
    await writeFile(file, "{not a sqlite database, long enough to be a bad header........................................................");
    const storage = createSecretStorage(file, fakeSafeStorage());
    assert.throws(() => storage.set("token", "synthetic-secret"));
    assert.equal(await readFile(file, "utf8"), "{not a sqlite database, long enough to be a bad header........................................................", "An unreadable store is retained rather than replaced.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("renderer SecretStorage follows the native shape on desktop and fails visibly in standalone browsers", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-"));
  try {
    const desktop = createSecretStorage(join(root, "s.json"), fakeSafeStorage({ backend: "keychain" }));
    const transport = { request: (operation, id, secret) => { try { return handleSecretRequest(desktop, operation, id, secret); } catch (error) { return { ok: false, error: error.message }; } } };
    const storage = new SecretStorage(() => transport);
    const changes = [];
    storage.on("change", id => changes.push(id));
    storage.setSecret("service-token", "synthetic-secret-2");
    assert.equal(storage.getSecret("service-token"), "synthetic-secret-2");
    assert.equal(storage.getSecret("absent"), null);
    assert.deepEqual(storage.listSecrets(), ["service-token"]);
    assert.throws(() => storage.setSecret("Bad ID", "x"), /secret ID/);
    assert.throws(() => storage.getSecret("Bad ID"), /secret ID/);
    assert.equal(storage.available, true);
    storage.removeSecret("service-token");
    assert.deepEqual(storage.listSecrets(), []);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(changes, ["service-token", "service-token"]);

    const unavailableDesktop = new SecretStorage(() => ({ request: (operation, id, secret) => handleSecretRequest(createSecretStorage(join(root, "u.json"), fakeSafeStorage({ available: false })), operation, id, secret) }));
    assert.equal(unavailableDesktop.available, false);

    const browser = new SecretStorage(() => null);
    assert.deepEqual(browser.getStatus(), { available: false, protection: "unavailable", backend: null });
    for (const call of [() => browser.setSecret("token", "synthetic"), () => browser.getSecret("token"), () => browser.listSecrets(), () => browser.removeSecret("token")]) {
      assert.throws(call, error => error instanceof SecretStorageUnavailableError && /standalone|desktop application/.test(error.message));
    }
    assert.throws(() => new SecretStorage(() => ({ request: () => "bogus" })).getSecret("token"), /invalid secret storage response/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("renderer rejects malformed status and list responses and never reports a broken transport as unavailable", async () => {
  const respond = value => new SecretStorage(() => ({ request: () => ({ ok: true, value }) }));
  for (const bad of [null, "yes", { available: true, protection: "os-encrypted", backend: null }, { available: true, protection: "os-encrypted", backend: 5 }, { available: false, protection: "os-encrypted", backend: "dpapi" }, { available: true, protection: "unavailable", backend: null }, { available: false, protection: "unavailable", backend: "dpapi" }, { available: false, protection: "unavailable" }]) {
    assert.throws(() => respond(bad).getStatus(), /invalid secret storage status/, JSON.stringify(bad));
    assert.throws(() => respond(bad).available, /invalid secret storage status/);
  }
  assert.equal(respond({ available: false, protection: "unavailable", backend: null }).available, false);
  for (const bad of [null, "a", ["ok", 5], ["Bad Id"], ["dup", "dup"]]) { assert.throws(() => respond(bad).listSecrets(), /invalid secret list/, JSON.stringify(bad)); }
  const failing = new SecretStorage(() => ({ request: () => ({ ok: false, error: "Secret storage failed." }) }));
  assert.throws(() => failing.available, /Secret storage failed/);
  assert.throws(() => new SecretStorage(() => ({ request: () => { throw new Error("ipc down"); } })).available, /ipc down/);
});

test("a failed store access keeps the original error as the cause and never leaks secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-"));
  try {
    const secret = "synthetic-cleanup-secret";
    const directoryAsStore = join(root, "store.sqlite");
    await mkdir(directoryAsStore);
    assert.throws(() => createSecretStorage(directoryAsStore, fakeSafeStorage({ backend: "dpapi" })).set("token", secret), error => {
      assert.equal(error.name, "SecretStorageError");
      assert.match(error.message, /could not be accessed \(\w+\)\. Nothing was changed|unreadable/);
      assert.ok(error.cause instanceof Error, "The original error is retained as the cause.");
      assert.ok(!error.message.includes(secret) && !String(error.cause.message).includes(secret));
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an earlier JSON ciphertext store is imported once and never modified", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-"));
  try {
    const legacy = join(root, "secret-storage.json"), safe = fakeSafeStorage({ backend: "dpapi" });
    const original = JSON.stringify({ version: 1, secrets: { "old-key": safe.encryptString("synthetic-old").toString("base64") } });
    await writeFile(legacy, original);
    const storage = createSecretStorage(join(root, "secret-storage.sqlite"), safe, { legacyFile: legacy });
    assert.equal(storage.get("old-key"), "synthetic-old");
    storage.remove("old-key");
    assert.equal(storage.get("old-key"), null, "A deleted legacy entry is not resurrected by a later open.");
    assert.equal(createSecretStorage(join(root, "secret-storage.sqlite"), safe, { legacyFile: legacy }).get("old-key"), null);
    assert.equal(await readFile(legacy, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("recorded key combinations become persistable, platform-normalized hotkeys", () => {
  assert.equal(hotkeyFromEvent(press("Control", { ctrl: true })), null, "Held modifiers alone record nothing.");
  assert.equal(hotkeyFromEvent(press("Dead")), null);
  assert.deepEqual(hotkeyFromEvent(press("k", { ctrl: true, shift: true, code: "KeyK" })), { modifiers: ["Mod", "Shift"], key: "k" });
  assert.deepEqual(hotkeyFromEvent(press("¡", { alt: true, code: "Digit1" })), { modifiers: ["Alt"], key: "1" }, "Alt-produced characters record the physical key.");
  assert.deepEqual(hotkeyFromEvent(press(" ", { ctrl: true, code: "Space" })), { modifiers: ["Mod"], key: "Space" });
  assert.deepEqual(hotkeyFromEvent(press("F5")), { modifiers: [], key: "F5" });
  assert.equal(printHotkey({ modifiers: ["Mod", "Shift"], key: "k" }), "Ctrl+Shift+K");
  const { instance, ran, runnable } = manager({ runnable: ["a"] });
  instance.setHotkeys("a", [hotkeyFromEvent(press("k", { ctrl: true, shift: true, code: "KeyK" }))]);
  runnable.add("a");
  assert.equal(instance.handle(press("K", { ctrl: true, shift: true, code: "KeyK" })), true);
  assert.deepEqual(ran, ["a"], "A recorded combination dispatches from a real key event.");
});

function ipcFixture(overrides = {}) {
  const webContents = { mainFrame: { url: "http://127.0.0.1:5000/" } };
  const logs = [], calls = [];
  const storage = { status: () => ({ available: true }), get: id => { calls.push(["get", id]); return null; }, set: (id, secret) => { calls.push(["set", id, secret]); }, list: () => [], remove: id => { calls.push(["remove", id]); } };
  const handler = createSecretIpcHandler({ window: { webContents }, storage, isLocalUrl: url => url.startsWith("http://127.0.0.1:"), isClosing: () => Boolean(overrides.closing), log: message => logs.push(message) });
  const send = (operation, id, secret, event = {}) => {
    const message = { sender: webContents, senderFrame: webContents.mainFrame, ...event };
    handler(message, operation, id, secret);
    return message.returnValue;
  };
  return { send, webContents, calls, logs };
}

test("the secret IPC channel rejects foreign senders, frames, origins, closing windows and malformed requests", () => {
  const synthetic = "synthetic-disposable-secret-value";
  const { send, webContents, calls, logs } = ipcFixture();
  assert.deepEqual(send("set", "probe-token", synthetic), { ok: true, value: null });
  assert.deepEqual(calls.splice(0), [["set", "probe-token", synthetic]]);
  for (const [label, event] of [
    ["another window", { sender: {} }],
    ["a child frame", { senderFrame: { url: "http://127.0.0.1:5000/" } }],
    ["a missing frame", { senderFrame: null }],
    ["a remote origin", { remote: true }],
  ]) {
    if (event.remote) { webContents.mainFrame.url = "https://example.invalid/"; delete event.remote; }
    const result = send("get", "probe-token", undefined, event);
    assert.equal(result.ok, false, label);
    assert.match(result.error, /local application window/, label);
    webContents.mainFrame.url = "http://127.0.0.1:5000/";
  }
  assert.equal(send("get", 42).ok, false, "Non-text identifiers are refused.");
  assert.equal(send("set", "probe-token", { value: synthetic }).ok, false, "Non-text secrets are refused.");
  assert.equal(send("explode", "probe-token").ok, false, "Unknown operations are refused.");
  assert.equal(send(undefined).ok, false);
  assert.deepEqual(calls, [], "Rejected requests never reach the store.");
  const closing = ipcFixture({ closing: true });
  assert.match(closing.send("set", "probe-token", synthetic).error, /closing/);
  assert.deepEqual(closing.calls, []);
  assert.ok(![...logs, ...closing.logs].some(line => line.includes(synthetic)), "Secrets are never logged.");
});
const secretModule = fileURLToPath(new URL("../desktop/secret-storage.cjs", import.meta.url));
const childPrelude = `
const { createSecretStorage } = require(process.argv[1]);
const safe = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "os",
  encryptString: v => Buffer.from("PROTECTED:" + Buffer.from(v, "utf8").reverse().toString("base64")),
  decryptString: b => Buffer.from(b.toString().replace("PROTECTED:", ""), "base64").reverse().toString("utf8") };
const options = JSON.parse(process.argv[4] ?? "{}");
const storage = createSecretStorage(process.argv[2], safe, options);
const index = Number(process.argv[3]);
`;

function runChild(body, file, index, options = {}, onHeld) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", childPrelude + body, secretModule, file, String(index), JSON.stringify(options)], { stdio: [onHeld ? "pipe" : "ignore", "pipe", "pipe"] });
    let output = "", held = false;
    child.stdout.on("data", chunk => {
      output += chunk;
      if (onHeld && !held && /(?:^|\n)held\r?\n/.test(output)) {
        held = true;
        onHeld(() => child.stdin.end("release\n"));
      }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`child ${index} exited ${code}: ${output}`)));
  });
}

const churn = `
for (let round = 0; round < 25; round++) {
  storage.set("child" + index + "-" + round, "synthetic-" + index + "-" + round);
  storage.set("shared", "synthetic-shared-" + index + "-" + round);
  if (round % 3 === 2) { storage.remove("child" + index + "-" + (round - 1)); }
  if (round % 5 === 4) { storage.remove("shared"); }
}
`;

test("concurrent processes sharing a profile never lose or resurrect entries or tear values", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-race-"));
  try {
    const file = join(root, "secret-storage.sqlite");
    await Promise.all([0, 1, 2, 3, 4, 5].map(index => runChild(churn, file, index, { busyTimeoutMs: 30000 })));
    const storage = createSecretStorage(file, fakeSafeStorage({ backend: "os" }));
    const expected = ["shared"].filter(() => storage.get("shared") !== null);
    for (let index = 0; index < 6; index++) {
      for (let round = 0; round < 25; round++) { if (round % 3 !== 1) { expected.push(`child${index}-${round}`); } }
    }
    assert.deepEqual(storage.list(), expected.sort(), "Every surviving entry is present and every removed one stays removed.");
    assert.equal(storage.get("child2-5"), "synthetic-2-5");
    for (const id of storage.list().filter(id => id.startsWith("child"))) {
      const [, who, round] = /^child(\d+)-(\d+)$/.exec(id);
      assert.equal(storage.get(id), `synthetic-${who}-${round}`, "A value is never crossed with another writer's.");
    }
    const shared = storage.get("shared");
    assert.ok(shared === null || /^synthetic-shared-\d-\d+$/.test(shared), "A contended entry holds exactly one writer's complete value.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the capacity bound holds across processes: exactly the limit is stored and the rest fail visibly", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-cap-"));
  try {
    const file = join(root, "secret-storage.sqlite");
    const body = `
let full = 0;
for (let round = 0; round < 10; round++) {
  try { storage.set("c" + index + "-" + round, "synthetic-" + round); }
  catch (error) { if (!/store is full/.test(error.message)) { throw error; } full++; }
}
console.log(full);`;
    const outputs = await Promise.all([0, 1, 2, 3].map(index => runChild(body, file, index, { busyTimeoutMs: 30000, maxSecrets: 20 })));
    assert.equal(createSecretStorage(file, fakeSafeStorage({ backend: "os" }), { maxSecrets: 20 }).list().length, 20);
    assert.equal(outputs.reduce((sum, text) => sum + Number(text.split(/\r?\n/).find(line => /^\d+$/.test(line))), 0), 20, "Every rejected write was reported, none silently dropped.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a writer holding the database yields a visible sanitized conflict and nothing changes; waiting writers then succeed", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-lock-"));
  try {
    const file = join(root, "secret-storage.sqlite"), safe = fakeSafeStorage({ backend: "os" });
    const storage = createSecretStorage(file, safe, { busyTimeoutMs: 100 });
    storage.set("keep", "synthetic-keep");
    let releaseHolder, markHeld;
    const ready = new Promise(resolve => { markHeld = resolve; });
    const holder = runChild(`
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(process.argv[2]);
database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
const timeout = setTimeout(() => { throw new Error("The test did not release its database lock."); }, 10000);
process.stdin.once("data", () => {
  clearTimeout(timeout);
  database.exec("ROLLBACK");
  database.close();
});
console.log("held");
`, file, 9, {}, release => { releaseHolder = release; markHeld(); });
    await Promise.race([ready, holder.then(() => { throw new Error("The lock holder exited before acquiring its transaction."); })]);
    try {
      for (const action of [() => storage.set("other", "synthetic-secret-value"), () => storage.remove("keep"), () => storage.get("keep")]) {
        assert.throws(action, error => /Another application instance/.test(error.message) && !error.message.includes("synthetic") && error.cause instanceof Error);
      }
    } finally {
      releaseHolder();
      await holder;
    }
    assert.equal(storage.get("keep"), "synthetic-keep", "Nothing was changed while the other writer held the store.");
    assert.equal(storage.get("other"), null);
    const waiting = createSecretStorage(file, safe, { busyTimeoutMs: 10000 });
    waiting.set("later", "synthetic-later");
    assert.deepEqual(waiting.list(), ["keep", "later"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a process killed mid-transaction leaves no partial state or stuck lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-kill-"));
  try {
    const file = join(root, "secret-storage.sqlite"), safe = fakeSafeStorage({ backend: "os" });
    createSecretStorage(file, safe).set("keep", "synthetic-keep");
    const child = spawn(process.execPath, ["-e", `
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(process.argv[1]);
database.exec("BEGIN IMMEDIATE; INSERT INTO secrets (id, cipher) VALUES ('torn', 'x')");
console.log("held"); setInterval(() => {}, 1000);`, file], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise(resolve => child.stdout.once("data", resolve));
    child.kill("SIGKILL");
    await new Promise(resolve => child.once("close", resolve));
    const storage = createSecretStorage(file, safe, { busyTimeoutMs: 5000 });
    storage.set("after", "synthetic-after");
    assert.deepEqual(storage.list(), ["after", "keep"], "The uncommitted write vanished and the next writer is not blocked.");
  } finally { await rm(root, { recursive: true, force: true }); }
});
function builtinManager() {
  const ran = [], unavailable = new Set();
  const instance = new HotkeyManager({
    dispatch: id => { if (unavailable.has(id)) { return false; } ran.push(id); return true; },
    isRunnable: id => !unavailable.has(id),
    isApplication: id => id in BUILTIN_HOTKEYS,
    allowInModal: id => BUILTIN_HOTKEYS[id]?.inModal === true,
  });
  for (const [id, entry] of Object.entries(BUILTIN_HOTKEYS)) { instance.addDefaultHotkeys(id, entry.hotkeys); }
  return { instance, ran, unavailable };
}

test("built-in commands use the same manager: disable, rebind, collisions and restore take effect", () => {
  const { instance, ran, unavailable } = builtinManager();
  let event = press("s", { ctrl: true });
  assert.equal(instance.handle(event), true);
  assert.deepEqual(ran, ["editor:save-file"]);
  instance.setHotkeys("editor:save-file", []);
  event = press("s", { ctrl: true });
  assert.equal(instance.handle(event), false, "A disabled built-in no longer consumes its key.");
  assert.equal(event.defaultPrevented, false);
  instance.setHotkeys("editor:save-file", [{ modifiers: ["Mod"], key: "y" }]);
  assert.equal(instance.handle(press("s", { ctrl: true })), false);
  assert.equal(instance.handle(press("y", { ctrl: true })), true);
  assert.equal(ran.at(-1), "editor:save-file");
  instance.setHotkeys("editor:save-file", [{ modifiers: ["Mod"], key: "p" }]);
  const collisions = JSON.stringify(instance.getConflicts({ modifiers: ["Mod"], key: "p" }, "editor:save-file"));
  assert.match(collisions, /command-palette:open/, "Collisions include built-in defaults.");
  instance.removeHotkeys("editor:save-file");
  assert.equal(instance.handle(press("s", { ctrl: true })), true, "Restoring the default brings Ctrl+S back.");
  unavailable.add("editor:save-file");
  event = press("s", { ctrl: true });
  assert.equal(instance.handle(event), true, "An unavailable application command still suppresses the browser default.");
  assert.equal(event.defaultPrevented, true);
});

test("while a modal is open only modal-safe built-ins run", () => {
  const { instance, ran } = builtinManager();
  assert.equal(instance.handle(press("p", { ctrl: true }), { modal: true }), true);
  assert.equal(instance.handle(press("PageUp", { ctrl: true, shift: true }), { modal: true }), false);
  assert.deepEqual(ran, ["command-palette:open"]);
  assert.equal(instance.handle(press("PageUp", { ctrl: true, shift: true })), true);
  assert.equal(ran.at(-1), "workspace:move-tab-left");
});
function faultyOpen({ closeFails = false, rollbackFails = false, commitFails = false } = {}) {
  const { DatabaseSync } = require("node:sqlite");
  return location => {
    const real = new DatabaseSync(location);
    return {
      exec(sql) {
        if (rollbackFails && sql === "ROLLBACK") { real.exec(sql); throw Object.assign(new Error("rollback broke synthetic-secret"), { code: "EROLL" }); }
        if (commitFails && sql === "COMMIT") { throw Object.assign(new Error("commit broke"), { code: "ECOMMIT" }); }
        return real.exec(sql);
      },
      prepare: sql => real.prepare(sql),
      close() { real.close(); if (closeFails) { throw Object.assign(new Error("close broke synthetic-secret"), { code: "ECLOSE" }); } },
    };
  };
}

test("close and rollback failures surface sanitized context without claiming an unchanged store", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-fault-"));
  try {
    const file = join(root, "secret-storage.sqlite"), safe = fakeSafeStorage({ backend: "os" });
    const secret = "synthetic-secret";
    assert.throws(() => createSecretStorage(file, safe, { open: faultyOpen({ closeFails: true }) }).set("token", secret), error => {
      assert.match(error.message, /committed but .* could not be closed cleanly \(ECLOSE\)/);
      assert.ok(error.cause instanceof Error && !error.message.includes(secret) && !error.message.includes("broke"));
      return true;
    });
    assert.equal(createSecretStorage(file, safe).get("token"), secret, "The committed value is real, as the message says.");
    assert.throws(() => createSecretStorage(file, safe, { open: faultyOpen({ commitFails: true, rollbackFails: true }) }).set("other", "synthetic-other"), error => {
      assert.match(error.message, /could not be rolled back \(EROLL\).*uncertain.*not retried/);
      assert.doesNotMatch(error.message, /unchanged|remain|nothing was changed|broke/);
      assert.equal(error.cause?.code, "ECOMMIT", "The original failure is the cause.");
      return true;
    });
    assert.throws(() => createSecretStorage(file, safe, { open: faultyOpen({ commitFails: true, closeFails: true }) }).set("other", "synthetic-other"), error => /ECLOSE/.test(error.message) && error.cause?.code === "ECOMMIT" && !error.message.includes("broke"));
    assert.equal(createSecretStorage(file, safe).get("other"), null, "A failed commit with a successful rollback changed nothing.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy import is bounded and validated, and the original ciphertext file is preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "slopsidian-secrets-import-"));
  try {
    const safe = fakeSafeStorage({ backend: "os" }), cipher = safe.encryptString("synthetic-x").toString("base64");
    const cases = {
      "too many": { secrets: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, cipher])), options: { maxSecrets: 5 }, error: /more entries/ },
      "long id": { secrets: { [`a${"b".repeat(200)}`]: cipher }, options: {}, error: /invalid entry/ },
      "bad cipher": { secrets: { fine: "not base64 !!" }, options: {}, error: /invalid entry/ },
      "huge cipher": { secrets: { fine: "A".repeat(300 * 1024) }, options: {}, error: /invalid entry|too large/ },
    };
    for (const [name, { secrets, options, error }] of Object.entries(cases)) {
      const legacy = join(root, `${name.replace(" ", "-")}.json`), original = JSON.stringify({ version: 1, secrets });
      await writeFile(legacy, original);
      const storage = createSecretStorage(join(root, `${name.replace(" ", "-")}.sqlite`), safe, { legacyFile: legacy, ...options });
      assert.throws(() => storage.list(), error, name);
      assert.throws(() => storage.set("fresh", "synthetic-fresh"), error, name);
      assert.equal(await readFile(legacy, "utf8"), original, `${name}: the original file is preserved`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});