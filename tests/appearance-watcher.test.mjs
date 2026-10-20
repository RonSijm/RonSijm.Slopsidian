import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root } from "./host.mjs";

let temporary, Appearance, HostError;
const realFetch = globalThis.fetch, realDocument = globalThis.document;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "appearance-watcher-tests-"));
  const entry = join(temporary, "watcher.mjs");
  await build({ stdin: { contents: 'export { Appearance } from "./client/appearance"; export { HostError } from "./client/contracts";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", external: ["electron"], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, logLevel: "silent" });
  ({ Appearance, HostError } = await import(pathToFileURL(entry).href));
});
after(async () => {
  globalThis.fetch = realFetch; globalThis.document = realDocument;
  if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); }
});

const css = color => `body{--text-accent:${color}}`, THEME = ".obsidian/themes/Watched/theme.css";

/** The real Appearance prototype over a controlled in-memory vault; gates let a test hold a CSS read or a signature stat. */
function fixture(initial = "#112233") {
  const files = new Map([[THEME, { content: css(initial), mtime: 1000, size: css(initial).length }]]);
  const gates = { read: null, stat: null, fail: null, onAsset: null }, fetches = [], failures = [], causes = [];
  const vault = { rootPath: "vault-a", adapter: {
    async stat(path) {
      if (gates.fail) { throw gates.fail; }
      if (gates.stat) { const gate = gates.stat; gates.stat = null; await gate; }
      const file = files.get(path);
      if (file) { return { type: "file", mtime: file.mtime, size: file.size }; }
      return [...files.keys()].some(name => name.startsWith(path + "/")) ? { type: "folder", mtime: 0, size: 0 } : null;
    },
    async list(path) {
      const names = [...files.keys()].filter(name => name.startsWith(path + "/")), folders = new Set(), found = [];
      for (const name of names) { const rest = name.slice(path.length + 1); if (rest.includes("/")) { folders.add(path + "/" + rest.split("/")[0]); } else { found.push(name); } }
      return { files: found, folders: [...folders] };
    },
  } };
  const document = { version: "v1", root: "vault-a", data: { cssTheme: "Watched" } };
  const app = { vault, changingVault: false, workspace: { getLeavesOfType: () => [], trigger() {} }, configuration: { read: async () => document, watch: () => () => {} } };
  const head = { children: [], append(...nodes) { this.children.push(...nodes); } };
  globalThis.document = { head, hidden: false, createElement: () => ({ dataset: {}, textContent: "", remove() { head.children = head.children.filter(node => node !== this); } }),
    documentElement: { classList: { toggle() {} } }, body: { classList: { toggle() {} } } };
  globalThis.fetch = async url => {
    const params = new URL(url, "http://host").searchParams, path = params.get("path");
    fetches.push(path);
    if (url.startsWith("/api/appearance/asset")) {
      const bytes = files.get(path).bytes; gates.onAsset?.();
      return new Response(JSON.stringify({ root: params.get("root"), path, contentType: "image/png", base64: bytes.toString("base64"), version: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }));
    }
    const file = files.get(path);
    if (gates.read) { const gate = gates.read; gates.read = null; await gate; }
    return new Response(JSON.stringify({ root: params.get("root"), path, content: file.content, size: new TextEncoder().encode(file.content).length }));
  };
  const appearance = Object.assign(Object.create(Appearance.prototype), {
    app, document: null, assets: { themes: [], snippets: [] }, styles: [], writes: Promise.resolve(), assetEpoch: 0, pageEpoch: 0, mode: "obsidian", failure: "", inventoryFailure: "",
    system: { matches: false }, watching: false, assetTimer: null, assetSignature: null, resourcePaths: [], lastWatchFailure: "", stopConfigurationWatch: null,
    update() {}, recordFailure(error) { failures.push(error.message); causes.push(error.cause); },
  });
  const edit = (color, mtime) => files.set(THEME, { content: color.startsWith("body") ? color : css(color), mtime, size: (color.startsWith("body") ? color : css(color)).length });
  const accent = () => /#[0-9a-f]{6}/i.exec(appearance.styles.at(-1)?.textContent ?? "")?.[0];
  const poll = () => { const epoch = appearance.assetEpoch; return appearance.enqueue(() => appearance.checkAssets("vault-a", epoch)); };
  return { appearance, files, gates, fetches, failures, causes, config: document, edit, accent, poll, vault };
}

test("an external CSS edit made right after apply but before the first poll is adopted, not baselined away", async () => {
  const f = fixture();
  await f.appearance.restore();
  assert.equal(f.accent(), "#112233");
  f.edit("#445566", 2000);
  await f.poll();
  assert.equal(f.accent(), "#445566");
  assert.deepEqual(f.failures, []);
  const reads = f.fetches.length; await f.poll(); assert.equal(f.fetches.length, reads, "an unchanged signature must not re-read");
  f.appearance.clear();
});

test("an edit landing while the accepted CSS read is held is seen by the next poll", async () => {
  const f = fixture();
  let release; f.gates.read = new Promise(resolve => { release = resolve; });
  const restoring = f.appearance.restore();
  while (f.fetches.length === 0) { await new Promise(resolve => setImmediate(resolve)); }
  f.edit("#445566", 2000);
  release(); await restoring;
  assert.equal(f.accent(), "#112233", "the held read returned the old bytes");
  await f.poll();
  assert.equal(f.accent(), "#445566");
  f.appearance.clear();
});

test("invalid external CSS retains the accepted styles and is not retried until the file changes again", async () => {
  const f = fixture();
  await f.appearance.restore();
  const accepted = f.appearance.styles;
  f.edit('@import url("https://example.invalid/x.css");', 2000);
  await f.poll();
  assert.equal(f.appearance.styles, accepted);
  assert.equal(f.accent(), "#112233");
  assert.equal(f.failures.length, 1);
  const reads = f.fetches.length; await f.poll(); assert.equal(f.fetches.length, reads);
  f.edit("#778899", 3000); await f.poll();
  assert.equal(f.accent(), "#778899");
  f.appearance.clear();
});

test("a vault switch while the baseline signature is held leaves no baseline or styles from the old root", async () => {
  const f = fixture();
  await f.appearance.restore();
  f.edit("#445566", 2000);
  let release; f.gates.stat = new Promise(resolve => { release = resolve; });
  const stale = f.poll();
  while (f.gates.stat) { await new Promise(resolve => setImmediate(resolve)); }
  f.vault.rootPath = "vault-b"; f.appearance.clear();
  release();
  await stale;
  assert.equal(f.appearance.assetSignature, null);
  assert.deepEqual(f.appearance.styles, []);
  assert.equal(f.accent(), undefined);
});

test("a held final signature after resources were read cannot overwrite the new vault's baseline after a root switch", async () => {
  const f = fixture();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  f.files.set(".obsidian/themes/Watched/img/b.png", { bytes: png, mtime: 1, size: png.length });
  f.files.set(THEME, { content: "a{background:url(img/b.png)}", mtime: 1000, size: 28 });
  f.config.data = { cssTheme: "Watched", allowLocalResources: true };
  let release, armed = false;
  f.gates.onAsset = () => { armed = true; f.gates.stat = new Promise(resolve => { release = resolve; }); };
  const restoring = f.appearance.restore();
  const outcome = restoring.then(() => "applied", error => error.message);
  while (!armed || f.gates.stat) { await new Promise(resolve => setImmediate(resolve)); }
  f.vault.rootPath = "vault-b"; f.appearance.clear();
  f.appearance.assetSignature = "new-vault-baseline"; f.appearance.resourcePaths = ["new-vault-resource"];
  release();
  assert.match(await outcome, /inactive vault/);
  assert.equal(f.appearance.assetSignature, "new-vault-baseline");
  assert.deepEqual(f.appearance.resourcePaths, ["new-vault-resource"]);
  assert.deepEqual(f.appearance.styles, []);
});

test("an unreadable signature is reported once with its cause, keeps the accepted styles, and recovers", async () => {
  const f = fixture();
  await f.appearance.restore();
  const accepted = f.appearance.styles, cause = new HostError(409, "disk unavailable");
  f.gates.fail = cause;
  await f.poll(); await f.poll();
  assert.equal(f.failures.length, 1);
  assert.match(f.failures[0], /could not check external CSS changes: Host 409: disk unavailable/);
  assert.equal(f.causes[0], cause);
  assert.equal(f.appearance.styles, accepted);
  f.gates.fail = null; f.edit("#445566", 2000);
  await f.poll();
  assert.equal(f.accent(), "#445566");
  f.gates.fail = cause; await f.poll(); assert.equal(f.failures.length, 2, "a recovered then repeated failure is reported again");
  f.appearance.clear();
});

test("an unexpected signature failure propagates and a failing baseline read keeps the accepted styles", async () => {
  const f = fixture();
  await f.appearance.restore();
  const accepted = f.appearance.styles;
  f.gates.fail = new TypeError("adapter bug");
  await assert.rejects(f.poll(), /adapter bug/);
  f.gates.fail = null; f.edit("#445566", 2000);
  let themeStats = 0; const stat = f.vault.adapter.stat;
  f.vault.adapter.stat = async path => { if (path === ".obsidian/themes" && ++themeStats === 3) { throw new HostError(409, "baseline unreadable"); } return stat(path); };
  await f.poll();
  assert.equal(f.failures.length, 1);
  assert.match(f.failures[0], /baseline unreadable/);
  assert.equal(f.appearance.styles, accepted);
  assert.equal(f.accent(), "#112233");
  f.vault.adapter.stat = stat; await f.poll();
  assert.equal(f.accent(), "#445566");
  f.appearance.clear();
});

async function heldPoll(f) {
  f.edit("#445566", 2000);
  let fail; f.gates.read = new Promise((_, reject) => { fail = reject; });
  const held = f.poll();
  while (f.gates.read) { await new Promise(resolve => setImmediate(resolve)); }
  return { held, fail };
}

test("a read held when a controlled shutdown starts and rejected afterwards is not reported, and styles are retained", async () => {
  const f = fixture();
  await f.appearance.restore();
  const accepted = f.appearance.styles, { held, fail } = await heldPoll(f);
  f.appearance.app.changingVault = true;
  fail(new TypeError("Failed to fetch"));
  await held;
  assert.deepEqual(f.failures, []);
  assert.equal(f.appearance.styles, accepted);
  f.appearance.clear();
});

test("a held read rejected after a cancelled close is dropped, then normal watching resumes and adopts the edit", async () => {
  const f = fixture();
  await f.appearance.restore();
  const { held, fail } = await heldPoll(f);
  f.appearance.app.changingVault = true;
  fail(new TypeError("Failed to fetch"));
  await held;
  f.appearance.app.changingVault = false;
  await f.poll();
  assert.equal(f.accent(), "#445566");
  assert.deepEqual(f.failures, []);
  f.edit("#778899", 3000); await f.poll();
  assert.equal(f.accent(), "#778899");
  f.appearance.clear();
});

test("a held read rejected after a root replacement is not reported against the new vault", async () => {
  const f = fixture();
  await f.appearance.restore();
  const { held, fail } = await heldPoll(f);
  f.vault.rootPath = "vault-b"; f.appearance.clear();
  fail(new TypeError("Failed to fetch"));
  await held;
  assert.deepEqual(f.failures, []);
  assert.deepEqual(f.appearance.styles, []);
});

test("an unexpected host loss with no controlled transition still surfaces, as does a failing started save", async () => {
  const f = fixture();
  await f.appearance.restore();
  const { held, fail } = await heldPoll(f);
  fail(new TypeError("Failed to fetch"));
  await assert.rejects(held, /Failed to fetch/);
  f.edit("#778899", 3000);
  f.appearance.containerEl = { isConnected: true };
  f.gates.read = Promise.reject(new TypeError("save read lost"));
  f.gates.read.catch(() => {});
  f.appearance.app.changingVault = false;
  await assert.rejects(f.appearance.change(data => { data.cssTheme = "Watched"; }), /save read lost/);
  await assert.rejects(f.appearance.whenIdle(), /save read lost/, "the controlled-close drain must not swallow a failed started save");
  f.appearance.clear();
});
