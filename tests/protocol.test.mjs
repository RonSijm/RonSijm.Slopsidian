import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let directory, ObsidianProtocolRegistry, parseObsidianProtocolUrl;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "protocol-tests-"));
  const output = join(directory, "protocol.mjs");
  await build({ entryPoints: [join(root, "client", "protocol.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ ObsidianProtocolRegistry, parseObsidianProtocolUrl } = await import(pathToFileURL(output).href));
});
after(async () => {
  if (directory) {
    const path = relative(join(root, ".runtime"), directory);
    assert.ok(path && !isAbsolute(path) && !path.startsWith(".."));
    await rm(directory, { recursive: true });
  }
});

function fixture() {
  const app = { changingVault: false, vault: { rootPath: "vault-A", getName: () => "Protocol vault" } };
  const registry = new ObsidianProtocolRegistry(app);
  const plugin = { loaded: true };
  const owner = registry.createOwner("nldates-obsidian", () => plugin.loaded);
  return { app, registry, plugin, owner };
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("Natural Language Dates and Omnisearch URLs dispatch decoded parameters, including the authoritative action", async () => {
  const { registry, owner } = fixture(), received = [];
  owner.register("nldates", parameters => { received.push(parameters); return "daily note requested"; });
  const omni = registry.createOwner("omnisearch", () => true);
  omni.register("omnisearch", async parameters => { received.push(parameters); return { query: parameters.query }; });
  assert.equal(await registry.dispatch("obsidian://nldates?day=next%20Monday&newPane=no&vault=Protocol%20vault"), "daily note requested");
  assert.deepEqual(await registry.dispatch("obsidian://omnisearch?query=%E6%97%A5%E6%9C%AC%E8%AA%9E%20%23tag&action=nldates"), { query: "日本語 #tag" });
  assert.deepEqual(received, [
    { action: "nldates", day: "next Monday", newPane: "no", vault: "Protocol vault" },
    { action: "omnisearch", query: "日本語 #tag" },
  ]);
});

test("URI parsing retains native flags, literal plus signs and last values without prototype mutation or accidental truncation", () => {
  const parsed = parseObsidianProtocolUrl("obsidian://omnisearch/?query=first&query=a+b%2Bc%20d=e&empty=&flag&%64ay=today&__proto__=ordinary&constructor=also#raw%20hash");
  assert.deepEqual(parsed, {
    action: "omnisearch", query: "a+b+c d=e", empty: "", flag: "true", day: "today",
    ["__proto__"]: "ordinary", constructor: "also", hash: "raw%20hash",
  });
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, "__proto__"), true);
  assert.deepEqual(parseObsidianProtocolUrl("obsidian://nldates?"), { action: "nldates" });
  assert.deepEqual(parseObsidianProtocolUrl("OBSIDIAN://%6Eldates///?day=%2520"), { action: "nldates", day: "%20" });
});

test("invalid URLs and malformed encoding reject instead of invoking installed callbacks", async () => {
  const { registry, owner } = fixture(); let calls = 0;
  owner.register("nldates", () => { calls++; });
  for (const url of [null, {}, "", "https://nldates?day=today", "javascript:alert(1)", "obsidian:nldates", "obsidian://", "obsidian://user@nldates", "obsidian://nldates:123", "obsidian://nldates/path", "obsidian://nldates%2Fpath", "obsidian://nldates?day=%", "obsidian://nldates?%FF=x", "obsidian://nldates?day=x\n"]) {
    await assert.rejects(registry.dispatch(url), /obsidian|protocol|URI|action/i);
  }
  assert.equal(calls, 0);
});

test("registration validates ownership, lifecycle, action and callback before mutating the registry", async () => {
  const { registry, owner, plugin } = fixture();
  assert.throws(() => registry.createOwner("", () => true), /identifier/);
  assert.throws(() => registry.createOwner("plugin", null), /lifecycle/);
  for (const action of ["", " ", "obsidian://nldates", "nldates/path", "nldates?x=y", "has space", null]) {
    assert.throws(() => owner.register(action, () => {}), /action/);
  }
  for (const handler of [null, {}, "callback", 5]) { assert.throws(() => owner.register("nldates", handler), /function/); }
  plugin.loaded = false;
  assert.throws(() => owner.register("nldates", () => {}), /unloaded/);
  plugin.loaded = true;
  owner.register("nldates", () => "valid");
  assert.equal(await registry.dispatch("obsidian://nldates"), "valid");
  plugin.loaded = false;
  await assert.rejects(registry.dispatch("obsidian://nldates"), /unloaded/);
});

test("duplicates cannot steal actions and old cleanups cannot remove another registration, even for the same plugin ID", async () => {
  const { registry, owner } = fixture(), calls = [];
  const cleanup = owner.register("nldates", () => calls.push("first"));
  const replacement = registry.createOwner("nldates-obsidian", () => true);
  const other = registry.createOwner("omnisearch", () => true);
  other.register("omnisearch", () => calls.push("omni"));
  assert.throws(() => owner.register("nldates", () => {}), /already registered/);
  assert.throws(() => replacement.register("nldates", () => {}), /already registered/);
  await registry.dispatch("obsidian://nldates");
  cleanup(); cleanup();
  replacement.register("nldates", () => calls.push("replacement"));
  cleanup(); owner.dispose(); owner.dispose();
  await registry.dispatch("obsidian://nldates");
  await registry.dispatch("obsidian://omnisearch");
  assert.deepEqual(calls, ["first", "replacement", "omni"]);
  replacement.dispose();
  await assert.rejects(registry.dispatch("obsidian://nldates"), /unavailable/);
  assert.throws(() => owner.register("another", () => {}), /disposed/);
  await registry.dispatch("obsidian://omnisearch");
});

test("queued dispatch cannot invoke a handler replaced or unloaded before its callback begins", async () => {
  const { registry, owner, plugin } = fixture(), calls = [];
  const cleanup = owner.register("nldates", () => calls.push("old"));
  const pending = registry.dispatch("obsidian://nldates?day=today");
  cleanup();
  owner.register("nldates", () => calls.push("new"));
  await assert.rejects(pending, /no longer registered/);
  assert.deepEqual(calls, []);
  const unloaded = registry.dispatch("obsidian://nldates");
  plugin.loaded = false;
  await assert.rejects(unloaded, /unloaded/);
  assert.deepEqual(calls, []);
});

test("routing rejects unavailable actions, changing or absent vaults and URLs targeting another vault", async () => {
  const { app, registry, owner } = fixture(); let calls = 0;
  owner.register("nldates", () => { calls++; });
  await assert.rejects(registry.dispatch("obsidian://unknown"), /unavailable/);
  await assert.rejects(registry.dispatch("obsidian://nldates?vault=Other"), /different vault/);
  app.changingVault = true;
  await assert.rejects(registry.dispatch("obsidian://nldates"), /vault change/);
  app.changingVault = false;
  await registry.dispatch("obsidian://nldates?vault=pRoToCoL%20VaUlT");
  await registry.dispatch("obsidian://nldates?vault=vault-A");
  app.vault.rootPath = null;
  await assert.rejects(registry.dispatch("obsidian://nldates"), /Select a vault/);
  assert.equal(calls, 2);
});

test("owner and ingress handles stay bound to their captured vault, including same-root reopenings", async () => {
  const { app, registry, owner } = fixture(); let oldCalls = 0, newCalls = 0;
  const ingress = registry.createDispatcher();
  const delayedOwner = registry.createOwner("delayed", () => true);
  owner.register("nldates", () => { oldCalls++; });
  app.vault.rootPath = "vault-B";
  await assert.rejects(ingress("obsidian://nldates"), /previous vault/);
  assert.throws(() => delayedOwner.register("late", () => {}), /previous vault/);
  registry.reset();
  app.vault.rootPath = "vault-A";
  const current = registry.createOwner("nldates-obsidian", () => true);
  current.register("nldates", () => { newCalls++; });
  await assert.rejects(ingress("obsidian://nldates"), /previous vault/);
  assert.throws(() => owner.register("late", () => {}), /previous vault/);
  owner.dispose();
  await registry.createDispatcher()("obsidian://nldates");
  assert.equal(oldCalls, 0); assert.equal(newCalls, 1);
  registry.reset();
  await assert.rejects(registry.dispatch("obsidian://nldates"), /unavailable/);
  assert.throws(() => current.register("late", () => {}), /previous vault/);
});

test("vault changes drain already-started async handlers before resetting and block newly queued work", async () => {
  const { app, registry, owner } = fixture(), held = gate(), observed = [];
  owner.register("nldates", async () => {
    observed.push(app.vault.rootPath);
    await held.promise;
    observed.push(app.vault.rootPath);
    return "finished";
  });
  const running = registry.dispatch("obsidian://nldates"); await tick();
  app.changingVault = true;
  let drained = false;
  const draining = registry.whenIdle().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false);
  assert.throws(() => registry.reset(), /finish/);
  await assert.rejects(registry.dispatch("obsidian://nldates"), /vault change/);
  held.release();
  assert.equal(await running, "finished"); await draining;
  assert.deepEqual(observed, ["vault-A", "vault-A"]);
  registry.reset(); app.vault.rootPath = "vault-B"; app.changingVault = false;
  await assert.rejects(registry.dispatch("obsidian://nldates"), /unavailable/);
});

test("sync throws, async rejections and draining failures remain observable to the caller", async () => {
  const { registry, owner } = fixture(), sync = new Error("sync failure"), failure = new Error("async failure"), held = gate();
  const remove = owner.register("nldates", () => { throw sync; });
  await assert.rejects(registry.dispatch("obsidian://nldates"), error => error === sync);
  remove();
  owner.register("nldates", async () => { await held.promise; throw failure; });
  const running = registry.dispatch("obsidian://nldates");
  const rejected = assert.rejects(running, error => error === failure);
  const drained = assert.rejects(registry.whenIdle(), error => error instanceof AggregateError && error.errors[0] === failure);
  held.release(); await Promise.all([rejected, drained]);
  registry.reset(); await registry.whenIdle();
});

test("a root changed outside the required drain seam cannot silently report a successful dispatch", async () => {
  const { app, registry, owner } = fixture(), held = gate();
  owner.register("nldates", async () => { await held.promise; return "old vault result"; });
  const running = registry.dispatch("obsidian://nldates"); await tick();
  app.vault.rootPath = "vault-B"; held.release();
  await assert.rejects(running, /previous vault/);
});
