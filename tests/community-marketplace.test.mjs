import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { errorLogStub } from "./error-log-stub.mjs";
import { root } from "./host.mjs";

let directory, m;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "community-marketplace-tests-"));
  const output = join(directory, "model.cjs");
  await build({
    stdin: {
      contents: 'export { CommunityCatalog, sortCatalog, filterCatalog } from "./client/community-catalog"; export { parseReadme, renderReadme, safeReadmeHref } from "./client/community-readme"; export { planBulkUpdates, applyBulkUpdates } from "./client/community-bulk"; export { isPluginId, pluginAttributeSelector } from "./client/plugin-id"; export { configureBrowserHost } from "./client/contracts";',
      resolveDir: root, loader: "ts",
    },
    outfile: output, bundle: true, platform: "node", format: "cjs", external: ["electron"], loader: { ".css": "empty" }, logLevel: "silent", plugins: [errorLogStub],
  });
  m = createRequire(import.meta.url)(output);
  m.configureBrowserHost({ request: async () => { throw new Error("unused"); } });
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

const entry = (id, extra = {}) => ({ id, name: id, author: "Author", description: "Fixture " + id, repo: "fixture/" + id, ...extra });

test("plugin identifiers accept safe dotted ids and refuse traversal, trailing dots and Windows device aliases with extensions", () => {
  for (const id of ["a", "obsidian.sample-plugin", "a_b.c-d.e1", "x".repeat(128), "console", "com10", "xcon.txt", "a.con"]) { assert.equal(m.isPluginId(id), true, id); }
  for (const id of ["", ".a", "a.", "a..b", "a.-b", "../a", "a/b", "a\\b", "a\n", "a b", "x".repeat(129), "CON", "con.txt", "NUL.a.b", "Aux.", "COM1.x", "lpt9.tar.gz", "COM\u00b2.txt", "COM0", "a:b", 7, null]) { assert.equal(m.isPluginId(id), false, String(id)); }
});

test("attribute selectors treat a literal dotted id as data rather than CSS punctuation", () => {
  globalThis.CSS = { escape: value => value.replace(/[^a-zA-Z0-9_-]/g, character => "\\" + character) };
  try { assert.equal(m.pluginAttributeSelector("data-plugin-id", "a.b-c"), '[data-plugin-id="a\\.b-c"]'); }
  finally { delete globalThis.CSS; }
});

test("catalog sorting and search use real statistics and never fabricate unreported values", () => {
  const entries = [entry("b", { name: "Beta", author: "Zed" }), entry("a", { name: "Alpha", author: "Amy" }), entry("c", { name: "Gamma", author: "Amy" }), entry("d", { name: "Delta" })];
  const stats = new Map([["a", { downloads: 10, updated: 5 }], ["b", { downloads: 99, updated: null }], ["c", { downloads: null, updated: 50 }]]);
  const ids = list => list.map(item => item.id).join("");
  assert.equal(ids(m.sortCatalog(entries, "name", null)), "abdc");
  assert.equal(ids(m.sortCatalog(entries, "popularity", stats)), "badc", "unreported counts sort after reported ones");
  assert.equal(ids(m.sortCatalog(entries, "updated", stats)), "cabd");
  assert.equal(ids(m.sortCatalog(entries, "author", null)), "acdb");
  assert.equal(ids(m.filterCatalog(entries, "amy gamma")), "c");
  assert.equal(ids(m.filterCatalog(entries, "  ")), "bacd");
});

test("statistics are bounded public data and unavailable or malformed statistics fail explicitly", async () => {
  const fetcher = body => async url => { assert.match(url, /obsidian-releases\/HEAD\/community-plugin-stats\.json$/); return body instanceof Error ? Promise.reject(body) : body; };
  const good = new m.CommunityCatalog("1.13.3", fetcher(new Response(JSON.stringify({ alpha: { downloads: 12, updated: 3, "1.0.0": 4 }, bad: { downloads: -1, updated: "x" }, "__proto__": { downloads: 1 }, junk: 4 }))));
  const stats = await good.statistics();
  assert.deepEqual(stats.get("alpha"), { downloads: 12, updated: 3 });
  assert.deepEqual(stats.get("bad"), { downloads: null, updated: null });
  assert.equal(stats.has("junk"), false);
  assert.equal(({}).downloads, undefined);
  await assert.rejects(new m.CommunityCatalog("1.13.3", fetcher(new Response("{", { status: 200 }))).statistics(), /Cannot read community statistics/);
  await assert.rejects(new m.CommunityCatalog("1.13.3", fetcher(new Response("no", { status: 500 }))).statistics(), /returned 500/);
  await assert.rejects(new m.CommunityCatalog("1.13.3", fetcher(new TypeError("offline"))).statistics(), /could not read the GitHub download|could not be reached/);
});

test("README retrieval is limited to the repository default-branch README and distinguishes absence from failure", async () => {
  const seen = [];
  const catalog = new m.CommunityCatalog("1.13.3", async (url, options) => {
    seen.push(url);
    assert.equal(options.credentials, "omit");
    return url.endsWith("/README.md") ? new Response("", { status: 404 }) : new Response("# Hi\n");
  });
  assert.equal(await catalog.readme(entry("x")), "# Hi\n");
  assert.deepEqual(seen, ["https://raw.githubusercontent.com/fixture/x/HEAD/README.md", "https://raw.githubusercontent.com/fixture/x/HEAD/readme.md"]);
  assert.equal(await new m.CommunityCatalog("1.13.3", async () => new Response("", { status: 404 })).readme(entry("x")), null);
  await assert.rejects(new m.CommunityCatalog("1.13.3", async () => new Response("", { status: 500 })).readme(entry("x")), /returned 500/);
  await assert.rejects(new m.CommunityCatalog("1.13.3", async () => new Response("x", { headers: { "Content-Length": String(512 * 1024 + 1) } })).readme(entry("x")), /size/);
});

function fakeDocument() {
  const make = tag => ({ tag, children: [], dataset: {}, attrs: {}, set textContent(value) { this.text = value; }, get textContent() { return this.text; }, appendChild(child) { this.children.push(child); return child; }, append(...nodes) { this.children.push(...nodes); } });
  return { createElement: make, createTextNode: text => ({ tag: "#text", text }) };
}
function walk(node, visit) { visit(node); for (const child of node.children ?? []) { walk(child, visit); } }

test("README rendering is inert: HTML, scripts, images and unsafe links never become live elements or fetches", () => {
  const source = [
    "# Title <img src=https://tracker.invalid/p.png>", "", "Text with <script>alert(1)</script> and ![logo](https://tracker.invalid/pixel.png) plus [safe](https://example.com/a) and [bad](javascript:alert(1)) and [data](data:text/html,x) and [cred](https://u:p@example.com/).",
    "<!-- hidden <iframe src=x> -->", "```js", "<script>danger()</script>", "```", "- one", "- two", "1. first", "> quoted", "---",
  ].join("\n");
  const parsed = m.parseReadme(source);
  globalThis.document = fakeDocument();
  try {
    const parent = document.createElement("div");
    m.renderReadme(parent, parsed);
    const tags = new Set(), anchors = [];
    walk(parent, node => { tags.add(node.tag); if (node.tag === "a") { anchors.push(node); } });
    for (const forbidden of ["img", "script", "iframe", "video", "link", "style", "object", "embed"]) { assert.equal(tags.has(forbidden), false, forbidden); }
    assert.deepEqual(anchors.map(anchor => anchor.href), ["https://example.com/a"]);
    assert.equal(anchors[0].rel, "noopener noreferrer nofollow ugc");
    assert.equal(anchors[0].referrerPolicy, "no-referrer");
    const text = []; walk(parent, node => { if (node.text) { text.push(node.text); } });
    assert.match(text.join("\n"), /\[image: logo\]/);
    assert.match(text.join("\n"), /<script>danger\(\)<\/script>/, "fenced code remains literal text");
    assert.doesNotMatch(text.join("\n"), /alert\(1\)<\/script>|tracker\.invalid\/p\.png/);
  } finally { delete globalThis.document; }
  assert.equal(m.safeReadmeHref("ftp://x/"), null);
  assert.equal(m.parseReadme("x\n".repeat(5000).replaceAll("x\n", "- item\n\n")).truncated, true);
});

function bulkFixture(installed, releases, options = {}) {
  const log = [];
  const host = {
    installedPlugins: installed,
    async reviewInstalled(id) { const plugin = installed.find(item => item.id === id); return { root: "root", selection: 1, id, installed: plugin ? { root: "root", version: "v-" + plugin.version, manifest: { id, version: plugin.version } } : null }; },
    async installPackage(bundle, review) {
      log.push(["install", bundle.manifest.id, review.installed.version]);
      if (options.failInstall === bundle.manifest.id) { throw new Error("disk refused"); }
    },
  };
  const catalog = {
    async release(candidate) { log.push(["release", candidate.id]); const value = releases[candidate.id]; if (value instanceof Error) { throw value; } return { entry: candidate, manifest: { id: candidate.id, version: value }, version: value, url: "u" }; },
    async download(release) { log.push(["download", release.entry.id]); return { manifest: { id: release.entry.id, version: release.version } }; },
  };
  return { host, catalog, log };
}
const signal = new AbortController().signal;

test("bulk planning is read-only, lists truthful unknowns and never preselects updates", async () => {
  const { host, catalog, log } = bulkFixture(
    [{ id: "up", name: "Up", version: "1.0.0" }, { id: "cur", name: "Cur", version: "2.0.0" }, { id: "gone", name: "Gone", version: "1.0.0" }, { id: "weird", name: "Weird", version: "dev" }, { id: "broken", name: "Broken", version: "1.0.0" }, { id: "bad.id", name: "Bad", version: "1.0.0" }],
    { up: "1.1.0", cur: "2.0.0", weird: "1.0.0", broken: new Error("network down") });
  const entries = ["up", "cur", "weird", "broken"].map(id => entry(id)).concat(entry("bad.id", { unavailable: "unsafe" }));
  const rows = await m.planBulkUpdates(host, catalog, entries, signal, () => {});
  const state = Object.fromEntries(rows.map(row => [row.id, row.state]));
  assert.deepEqual(state, { "bad.id": "unavailable", broken: "failed", cur: "current", gone: "unlisted", up: "update", weird: "failed" });
  assert.equal(rows.some(row => row.selected), false);
  assert.match(rows.find(row => row.id === "broken").message, /network down/);
  assert.match(rows.find(row => row.id === "weird").message, /not a comparable/);
  assert.equal(rows.find(row => row.id === "up").review.installed.version, "v-1.0.0");
  assert.equal(log.some(item => item[0] === "install" || item[0] === "download"), false);
});

test("bulk apply updates only selected reviewed rows, reports partial failures and stops when the vault context changes", async () => {
  const installed = ["one", "two", "three", "skip"].map(id => ({ id, name: id, version: "1.0.0" }));
  const { host, catalog, log } = bulkFixture(installed, Object.fromEntries(installed.map(item => [item.id, "1.1.0"])), { failInstall: "two" });
  const rows = await m.planBulkUpdates(host, catalog, installed.map(item => entry(item.id)), signal, () => {});
  for (const row of rows) { row.selected = row.id !== "skip"; }
  log.length = 0;
  await m.applyBulkUpdates(host, catalog, rows, signal, () => {});
  assert.deepEqual(log.filter(item => item[0] === "install").map(item => item[1]), ["one", "three", "two"], "rows apply sequentially in planned order");
  const by = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.match(by.one.outcome, /^Updated to 1\.1\.0/);
  assert.match(by.two.outcome, /^Not updated: disk refused/);
  assert.equal(by.skip.outcome, undefined);
  assert.equal(log.some(item => item[1] === "skip" && item[0] !== "release"), false, "unselected plugins are never downloaded or installed");

  const fresh = bulkFixture(installed.slice(0, 3), { one: "1.1.0", two: "1.1.0", three: "1.1.0" });
  const second = await m.planBulkUpdates(fresh.host, fresh.catalog, installed.slice(0, 3).map(item => entry(item.id)), signal, () => {});
  second.forEach(row => { row.selected = true; });
  let calls = 0;
  await m.applyBulkUpdates(fresh.host, fresh.catalog, second, signal, () => { if (++calls > 2) { throw new Error("The vault selection changed."); } });
  assert.match(second[0].outcome, /^Updated/);
  assert.match(second[1].outcome, /vault selection changed/);
  assert.match(second[2].outcome, /Not attempted/);
});

test("bulk apply rejects a downloaded package that differs from the reviewed release", async () => {
  const { host, catalog, log } = bulkFixture([{ id: "up", name: "Up", version: "1.0.0" }], { up: "1.1.0" });
  const rows = await m.planBulkUpdates(host, catalog, [entry("up")], signal, () => {});
  rows[0].selected = true;
  catalog.download = async () => ({ manifest: { id: "up", version: "9.9.9" } });
  await m.applyBulkUpdates(host, catalog, rows, signal, () => {});
  assert.match(rows[0].outcome, /does not match the reviewed release/);
  assert.equal(log.some(item => item[0] === "install"), false);
});

test("a refused install never claims success when a foreign package already has the target version", async () => {
  const installed = [{ id: "up", name: "Up", version: "1.0.0" }];
  const { host, catalog } = bulkFixture(installed, { up: "1.1.0" });
  const rows = await m.planBulkUpdates(host, catalog, [entry("up")], signal, () => {});
  rows[0].selected = true;
  host.installPackage = async () => { installed[0] = { id: "up", name: "Up", version: "1.1.0" }; throw new Error("The plugin package changed on disk. Nothing was installed."); };
  await m.applyBulkUpdates(host, catalog, rows, signal, () => {});
  assert.match(rows[0].outcome, /^Not updated: The plugin package changed on disk/);
  assert.match(rows[0].outcome, /cannot confirm it is the reviewed package/);
  assert.doesNotMatch(rows[0].outcome, /Updated/);
  assert.equal(rows[0].state, "update", "the row must not become current without attribution");
});

test("README truncation is signalled for over-long inline text", () => {
  assert.equal(m.parseReadme("word ".repeat(2000)).truncated, true);
  assert.equal(m.parseReadme("# " + "h".repeat(4001)).truncated, true);
  assert.equal(m.parseReadme("short paragraph").truncated, false);
});
