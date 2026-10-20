import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(import.meta.url);
const { WebAdBlock, loadBundledAdBlocker, adBlockingFlag, verifiedAdBlockList } = require("../desktop/web-adblock.cjs");
const { parse } = require("../.runtime/web-adblock/engine.cjs");
const endpoint = "http://127.0.0.1:56789";
const request = (url = "https://cdn.example.test/ads/cbr.js", type = "script", source = "https://reader.example.test/story") => ({ url, resourceType: type, referrer: source, id: 1, webContentsId: 2 });

test("the pinned offline list blocks actual EasyList ad scripts while permitting the same URL as XHR and normal resources", async () => {
  const match = await loadBundledAdBlocker();
  assert.equal(match(request()), true);
  assert.equal(match(request(undefined, "xhr")), false);
  assert.equal(match(request("https://cdn.example.test/normal.js")), false);
  assert.equal(match(request("https://ads-static.conde.digital/file.js", "script", "https://wired.com/story")), false);
  assert.equal(match(request("https://152media.com/file.js", "script", "https://example.com/story")), true);
  assert.equal(match(request("https://152media.com/file.js", "script", "https://152media.com/story")), false);
  assert.equal(await loadBundledAdBlocker(), match, "one immutable engine is shared by native sessions");
});

test("the native adapter honors type, party and source-domain restrictions and explicit ABP exceptions", () => {
  const match = parse("||ads.example^$script,third-party\n@@||ads.example/allowed.js$script\n||cdn.example/site.js$script,domain=reader.example\nreader.example##.ad-slot");
  assert.equal(match(request("https://ads.example/ad.js")), true);
  assert.equal(match(request("https://ads.example/ad.js", "image")), false);
  assert.equal(match(request("https://ads.example/ad.js", "script", "https://ads.example/story")), false);
  assert.equal(match(request("https://ads.example/allowed.js")), false);
  assert.equal(match(request("https://cdn.example/site.js", "script", "https://reader.example/story")), true);
  assert.equal(match(request("https://cdn.example/site.js", "script", "https://unrelated.example/story")), false);
});

test("scheme and vault endpoint guards always precede enabled, disabled and allowlisted filtering; top-level sites remain navigable", async () => {
  const blocker = new WebAdBlock(endpoint, () => {}, async () => parse("@@||127.0.0.1^\n||ads.example^"));
  for (const enabled of [true, false]) {
    await blocker.configure(enabled);
    for (const url of [endpoint + "/api/vault", "http://localhost:56789/file", "file:///C:/vault/secret.md", "javascript:alert(1)", "https://user:password@example.com/"]) {
      assert.deepEqual(blocker.request(request(url)), { cancel: true });
    }
    assert.deepEqual(blocker.request(request("https://ads.example/", "mainFrame")), { cancel: false });
  }
  assert.equal(blocker.snapshot().blockedRequests, 0);
  blocker.dispose();
});

test("only matched resource cancellations count; updates coalesce and document reset and disposal cancel queued feedback", async () => {
  const notifications = [];
  const blocker = new WebAdBlock(endpoint, () => notifications.push(blocker.snapshot()), async () => parse("/ads/cbr.js$script"));
  await blocker.configure(true); notifications.length = 0;
  for (let index = 0; index < 30; index++) { assert.equal(blocker.request(request()).cancel, true); }
  assert.equal(blocker.request(request(undefined, "xhr")).cancel, false);
  assert.equal(blocker.snapshot().blockedRequests, 30); assert.equal(notifications.length, 0);
  await delay(150); assert.equal(notifications.length, 1); assert.equal(notifications[0].blockedRequests, 30);
  blocker.request(request()); blocker.reset(); await delay(150);
  assert.equal(blocker.snapshot().blockedRequests, 0); assert.equal(notifications.length, 1);
  blocker.request(request()); blocker.dispose(); await delay(150);
  assert.equal(notifications.length, 1); assert.equal(blocker.request(request("https://example.com/normal.js")).cancel, true);
});

test("invalid IPC values never change requested protection", async () => {
  const blocker = new WebAdBlock(endpoint, () => {});
  for (const value of [null, undefined, "true", 0, 1, {}, []]) {
    assert.throws(() => adBlockingFlag(value));
    await assert.rejects(blocker.configure(value));
    assert.deepEqual(blocker.snapshot(), { enabled: false, status: "off", blockedRequests: 0, revision: 0 });
  }
  blocker.dispose();
});

test("late filter preparation cannot re-enable a disabled or closed native session", async () => {
  let finish; let notifications = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const blocker = new WebAdBlock(endpoint, () => notifications++, () => pending);
  const enabling = blocker.configure(true);
  assert.equal(blocker.status, "loading"); assert.equal(blocker.request(request()).cancel, true);
  await blocker.configure(false); finish(() => true); await enabling;
  assert.equal(blocker.status, "off"); assert.equal(blocker.request(request()).cancel, false);
  const second = blocker.configure(true); blocker.dispose(); const before = notifications; await second;
  assert.equal(notifications, before); assert.equal(blocker.match, null);
  await assert.rejects(blocker.configure(true), /closed/);
});

test("filter load failures visibly pause resources until disabled and retry can restore protection", async t => {
  t.mock.method(console, "error", () => {});
  let fail = true;
  const blocker = new WebAdBlock(endpoint, () => {}, async () => { if (fail) { throw new Error("Unavailable list"); } return () => true; });
  await blocker.configure(true); assert.equal(blocker.status, "unavailable");
  assert.equal(blocker.request(request()).cancel, true); assert.equal(blocker.blockedRequests, 0);
  await blocker.configure(false); assert.equal(blocker.request(request()).cancel, false);
  fail = false; await blocker.configure(true); assert.equal(blocker.status, "on");
  assert.equal(blocker.request(request()).cancel, true); blocker.dispose();
});

test("list verification rejects modified, empty and oversized data before parsing", async () => {
  const bytes = await readFile(new URL("../vendor/easylist/easylist.txt", import.meta.url));
  assert.ok(verifiedAdBlockList(bytes).startsWith("[Adblock Plus"));
  for (const invalid of [Buffer.from(""), Buffer.concat([bytes, Buffer.from("\n||injected.example^")]), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    assert.throws(() => verifiedAdBlockList(invalid), /verification/);
  }
});
