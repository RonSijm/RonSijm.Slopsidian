import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import http from "node:http";

const require = createRequire(import.meta.url);
const { FilterStore, fetchSubscription, reviewList, filterSpec, LIST_LIMIT } = require("../desktop/web-adblock-filters.cjs");
const engine = require("../.runtime/web-adblock/engine.cjs");

const sha = text => createHash("sha256").update(text).digest("hex");
const LIST = "! Title: Local test\n! Version: 7\n||ads.example^$script\n@@||ads.example/ok.js\nexample.org##.banner\n";
const spec = (generation, lists = [{ id: "one", text: LIST, sha256: sha(LIST) }], extra = {}) => ({ generation, root: "C:/vault", cosmetic: true, bundled: false, lists, ...extra });
const request = (url, type = "script", source = "https://page.example/") => ({ url, resourceType: type, referrer: source });
const store = (options = {}) => new FilterStore({ bundledText: async () => "||bundled.example^\n", defaultEngine: async () => null, ...options });

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { base: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
let hits = 0;

test("engine inspection counts network, exception and hide rules and ignores scripting", () => {
  const stats = engine.inspect(LIST + "example.org#%#//scriptlet('abort-on-property-read','x')\nexample.org#?#div:has(> .x)\n");
  assert.equal(stats.network, 1); assert.equal(stats.exceptions, 1); assert.equal(stats.cosmetic, 1);
});

test("compiled lists match network rules and return only static hide CSS", () => {
  const match = engine.compile([LIST], { cosmetic: true });
  assert.ok(match);
  const css = match.cosmetics("https://example.org/page", { classes: ["banner"], ids: [], hrefs: [] });
  assert.match(css.styles, /\.banner/); assert.match(css.styles, /display: none !important/);
  assert.equal(match.cosmetics("https://other.example/", { classes: [], ids: [], hrefs: [] }).styles.includes(".banner"), false);
  assert.equal(engine.compile([LIST], { cosmetic: false }).cosmetics, null);
});

test("reviewList rejects empty, binary, HTML, invalid UTF-8, oversized and rule-less data", () => {
  assert.throws(() => reviewList(Buffer.alloc(0), "http://x/"), /empty/);
  assert.throws(() => reviewList(Buffer.from("||a.example^\0"), "http://x/"), /binary/);
  assert.throws(() => reviewList(Buffer.from("<!DOCTYPE html><html></html>"), "http://x/"), /web page/);
  assert.throws(() => reviewList(Buffer.from([0xff, 0xfe, 0x41]), "http://x/"), /UTF-8/);
  assert.throws(() => reviewList(Buffer.alloc(LIST_LIMIT + 1, 97), "http://x/"), /4 MiB/);
  assert.throws(() => reviewList(Buffer.from("! only comments\n"), "http://x/"), /no supported/);
  const review = reviewList(Buffer.from(LIST), "http://x/");
  assert.equal(review.title, "Local test"); assert.equal(review.version, "7"); assert.equal(review.sha256, sha(LIST));
});

test("fetchSubscription downloads once on request, follows validated redirects and refuses bad answers", async () => {
  hits = 0;
  const server = await serve((req, res) => {
    hits++;
    if (req.url === "/list.txt") { res.end(LIST); }
    else if (req.url === "/redirect") { res.writeHead(302, { Location: "/list.txt" }).end(); }
    else if (req.url === "/loop") { res.writeHead(302, { Location: "/loop" }).end(); }
    else if (req.url === "/file") { res.writeHead(302, { Location: "file:///etc/passwd" }).end(); }
    else if (req.url === "/huge") { res.writeHead(200, { "Content-Length": String(LIST_LIMIT + 10) }).end("x"); }
    else if (req.url === "/stream") { res.write("a".repeat(LIST_LIMIT)); res.end("b"); }
    else if (req.url === "/page") { res.end("<html></html>"); }
    else if (req.url === "/slow") { res.write("||a.example^\n"); }
    else { res.writeHead(404).end(); }
  });
  try {
    const endpoint = "http://app.invalid:9";
    assert.equal(hits, 0);
    const direct = await fetchSubscription(server.base + "/list.txt", endpoint);
    assert.equal(direct.stats.network, 1); assert.equal(hits, 1);
    const redirected = await fetchSubscription(server.base + "/redirect", endpoint);
    assert.equal(redirected.url, server.base + "/list.txt"); assert.equal(hits, 3);
    await assert.rejects(fetchSubscription(server.base + "/loop", endpoint), /redirected too many/);
    await assert.rejects(fetchSubscription(server.base + "/file", endpoint), /unsafe address/);
    await assert.rejects(fetchSubscription(server.base + "/huge", endpoint), /4 MiB/);
    await assert.rejects(fetchSubscription(server.base + "/stream", endpoint), /4 MiB/);
    await assert.rejects(fetchSubscription(server.base + "/page", endpoint), /web page/);
    await assert.rejects(fetchSubscription(server.base + "/missing", endpoint), /HTTP 404/);
    await assert.rejects(fetchSubscription(server.base + "/slow", endpoint, { timeout: 150 }), /timed out/);
    await assert.rejects(fetchSubscription("ftp://x.example/list", endpoint), /Invalid filter list address/);
    await assert.rejects(fetchSubscription("javascript:alert(1)", endpoint), /Invalid filter list address/);
    await assert.rejects(fetchSubscription("http://user:pw@x.example/list", endpoint), /Invalid filter list address/);
    await assert.rejects(fetchSubscription(endpoint + "/list", endpoint), /Invalid filter list address/);
    await assert.rejects(fetchSubscription("https://x.example/" + "a".repeat(2100), endpoint), /2,048/);
  } finally { await server.close(); }
});

test("a dead server surfaces a download failure", async () => {
  const server = await serve((req, res) => res.end("x")); const base = server.base; await server.close();
  await assert.rejects(fetchSubscription(base + "/list", "http://app.invalid:9"), /Could not download/);
});

test("filterSpec validates generations, identifiers, sizes and checksums", () => {
  assert.equal(filterSpec(spec(1)).lists.length, 1);
  assert.throws(() => filterSpec(null), /Invalid filter set/);
  assert.throws(() => filterSpec(spec(0)), /generation/);
  assert.throws(() => filterSpec(spec(1.5)), /generation/);
  assert.throws(() => filterSpec(spec(1, [{ id: "Bad Id", text: LIST, sha256: sha(LIST) }])), /entry/);
  assert.throws(() => filterSpec(spec(1, [{ id: "a", text: LIST, sha256: sha(LIST) }, { id: "a", text: LIST, sha256: sha(LIST) }])), /entry/);
  assert.throws(() => filterSpec(spec(1, [{ id: "a", text: LIST + "x", sha256: sha(LIST) }])), /checksum/);
  assert.throws(() => filterSpec(spec(1, [{ id: "a", text: "x".repeat(LIST_LIMIT + 1), sha256: sha("x".repeat(LIST_LIMIT + 1)) }])), /size limit/);
  assert.throws(() => filterSpec(spec(1, Array.from({ length: 17 }, (_, i) => ({ id: "l" + i, text: LIST, sha256: sha(LIST) })))), /Invalid filter set/);
  assert.throws(() => filterSpec({ ...spec(1), cosmetic: "yes" }), /Invalid filter set/);
});

test("FilterStore applies accepted lists, hot-swaps, rejects stale generations and keeps the prior engine on failure", async () => {
  const changes = [];
  const filters = store({ compile: engine.compile, onChange: match => changes.push(match) });
  const first = await filters.apply(spec(1));
  assert.equal(first.changed, true); assert.equal(changes.length, 1);
  const match = await filters.current();
  assert.equal(!!match(request("https://ads.example/a.js")), true);
  assert.equal(!!match(request("https://ads.example/ok.js")), false);
  assert.equal(!!match(request("https://bundled.example/a.js")), false);

  const same = await filters.apply(spec(2));
  assert.equal(same.changed, false); assert.equal(changes.length, 1);
  await assert.rejects(filters.apply(spec(2)), /newer filter update/);
  await assert.rejects(filters.apply(spec(1)), /newer filter update/);

  const next = "||other.example^\n";
  await filters.apply(spec(3, [{ id: "one", text: next, sha256: sha(next) }], { bundled: true }));
  const swapped = await filters.current();
  assert.equal(!!swapped(request("https://other.example/a.js")), true);
  assert.equal(!!swapped(request("https://bundled.example/a.js")), true);
  assert.equal(!!swapped(request("https://ads.example/a.js")), false);

  const broken = store({ compile: (texts, options) => { if (texts.some(text => text.includes("BAD"))) { throw new Error("compile failed"); } return engine.compile(texts, options); } });
  await broken.apply(spec(1));
  const accepted = await broken.current();
  const bad = "BAD\n||x.example^\n";
  await assert.rejects(broken.apply(spec(2, [{ id: "one", text: bad, sha256: sha(bad) }])), /compile failed/);
  assert.equal(await broken.current(), accepted); assert.equal(broken.status().generation, 1);
  await broken.apply(spec(3));
  assert.equal(broken.status().generation, 3);
});

test("FilterStore serializes concurrent applies and reset returns to the bundled default", async () => {
  const order = [];
  const filters = store({ compile: (texts, options) => { order.push(texts.length); return engine.compile(texts, options); } });
  const results = await Promise.allSettled([filters.apply(spec(1)), filters.apply(spec(3, [], { bundled: true })), filters.apply(spec(2))]);
  assert.deepEqual(results.map(item => item.status), ["fulfilled", "fulfilled", "rejected"]);
  assert.equal(filters.status().generation, 3);
  filters.reset();
  assert.deepEqual(filters.status(), { generation: 0, root: null, cosmetic: false, bundled: true, lists: [] });
  const sentinel = () => ({});
  const withDefault = store({ defaultEngine: async () => sentinel });
  assert.equal(await withDefault.current(), sentinel);
});
