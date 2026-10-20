// Standalone offline-shell scenarios. Needs a published site (.runtime/web) and an interactive desktop session (Electron),
// so it is only run under an explicit UI lease. All state lives in disposable profiles; the published artifacts are never modified.
// Success evidence is written only when every scenario passes and the source/artifact bindings match before and after the run;
// a failure writes a separate failed report (with child/CDP diagnostics) before the fixture is removed.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startWebServer } from "./serve-web.mjs";
import { buildOfflineManifest, stampPublishedWorker } from "./offline-manifest.mjs";
import { coreVerificationInputs } from "./core-verification-inputs.mjs";
import { auditPage, exactUrl, isClean, withinBoundary, panelProbeExpression, settlePage, selectRuntimeWasm, sdkBootCacheName, clearSdkBootCache } from "./offline-smoke-audit.mjs";
const { request: quitRequest, ack: quitAck, acknowledgedQuit, fixtureDrainScript } = createRequire(import.meta.url)("./web-smoke-quit.cjs");

const root = fileURLToPath(new URL("../", import.meta.url));
const published = join(root, ".runtime", "web");
const evidence = join(root, ".runtime", "evidence");
const fixture = await mkdtemp(join(root, ".runtime", "offline-shell-smoke-"));
// A short, newly created, exclusively owned directory: deep CacheStorage paths under the long worktree path can cross the Windows path limit.
const shortHome = await mkdtemp(join(process.env.SMOKE_SHORT_ROOT ?? tmpdir(), "oss-"));
async function longestPath(directory) {
  let longest = "";
  for (const entry of await readdir(directory, { recursive: true })) { const full = join(directory, entry); if (full.length > longest.length) { longest = full; } }
  return { length: longest.length, path: longest };
}
const report = { schemaVersion: 1, status: "running", startedAt: new Date().toISOString(), scenarios: [], limits: [] };
const diagnostics = [];
const children = new Set();
let server = null, current = null;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function treeDigest(directory) {
  const entries = [];
  const walk = async folder => {
    for (const item of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, item.name);
      if (item.isDirectory()) await walk(path); else entries.push(relative(directory, path).replaceAll("\\", "/") + "\0" + sha256(await readFile(path)));
    }
  };
  await walk(directory);
  return { files: entries.length, sha256: sha256(entries.join("\n")) };
}
async function siteIdentity(directory) {
  const wwwroot = join(directory, "wwwroot");
  const manifestText = await readFile(join(wwwroot, "offline-manifest.json"), "utf8"), manifest = JSON.parse(manifestText);
  const worker = await readFile(join(wwwroot, "service-worker.js"));
  assert.ok(worker.includes(`const WORKER_BUILD = "${manifest.serviceWorker.build}";`), "The published worker must carry the manifest's worker build.");
  assert.equal(sha256(worker), manifest.serviceWorker.sha256, "The published worker bytes must match the manifest.");
  const core = JSON.parse(await readFile(join(wwwroot, "core-verification.json"), "utf8"));
  const compiled = Object.fromEntries(manifest.files.filter(file => /^(index\.html|offline-shell(-ui)?\.js|core-verification\.json|js\/.+)$/.test(file.path)).map(file => [file.path, file.sha256]));
  return { offlineVersion: manifest.version, manifestSha256: sha256(manifestText), workerBuild: manifest.serviceWorker.build, workerSha256: manifest.serviceWorker.sha256, files: manifest.files.length, embeddedSourceFingerprint: core.sourceFingerprint, compiledUi: compiled };
}

async function sites() {
  const { basePath } = JSON.parse(await readFile(join(published, "publish-info.json"), "utf8"));
  const second = join(fixture, "site-v2");
  await cp(published, join(fixture, "site-v1"), { recursive: true });
  await cp(published, second, { recursive: true });
  const css = join(second, "wwwroot", "browser.css");
  await writeFile(css, (await readFile(css, "utf8")) + "\n/* offline-shell-smoke update marker */\n");
  const manifest = await buildOfflineManifest(join(second, "wwwroot"), basePath);
  await writeFile(join(second, "wwwroot", "offline-manifest.json"), JSON.stringify(manifest, null, 2));
  const third = join(fixture, "site-v3");
  await cp(published, third, { recursive: true });
  const worker = join(third, "wwwroot", "service-worker.js");
  await writeFile(worker, (await readFile(worker, "utf8")) + "\n// offline-shell-smoke worker-only marker\n");
  await stampPublishedWorker(join(third, "wwwroot"));
  await writeFile(join(third, "wwwroot", "offline-manifest.json"), JSON.stringify(await buildOfflineManifest(join(third, "wwwroot"), basePath), null, 2));
  return { basePath, v1: join(fixture, "site-v1"), v2: second, v3: third };
}

class Page {
  constructor(profile, label) { this.profile = profile; this.label = label; this.nonce = randomUUID(); this.id = 0; this.pending = new Map(); this.log = ""; this.errors = []; this.network = new Map(); this.active = new Set(); this.failures = []; this.badResponses = []; this.closed = false; }
  async open(url, extra = []) {
    this.url = url;
    this.child = spawn(join(root, "node_modules", "electron", "dist", "electron.exe"), [
      join(root, "tools", "web-smoke-host.cjs"), "--site=" + url, "--profile=" + this.profile, "--fixture=" + fixture, "--quit-nonce=" + this.nonce,
      "--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", ...extra,
    ], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    children.add(this.child);
    this.exited = once(this.child, "exit");
    this.child.on("exit", code => { this.exitCode = code; });
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Electron did not expose DevTools.\n" + this.log)), 60000);
      for (const stream of [this.child.stdout, this.child.stderr]) stream.on("data", data => {
        this.log += data;
        const found = this.log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (found) { clearTimeout(timer); resolve("http://127.0.0.1:" + found[1]); }
      });
    });
    let target;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      target = (await (await fetch(endpoint + "/json/list")).json()).find(item => item.type === "page");
      if (!target) await delay(200);
    }
    assert.ok(target, "No browser page target appeared.");
    this.endpoint = endpoint;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    const fail = reason => { this.closed = true; for (const waiting of this.pending.values()) waiting.reject(new Error(reason)); this.pending.clear(); };
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = () => reject(new Error("The DevTools socket could not connect.")); });
    this.socket.onclose = () => fail("The DevTools socket closed.");
    this.socket.onerror = () => fail("The DevTools socket failed.");
    this.socket.onmessage = event => this.receive(JSON.parse(event.data));
    for (const domain of ["Runtime", "Log", "Network", "Page"]) await this.send(domain + ".enable");
  }
  receive(message) {
    const waiting = this.pending.get(message.id);
    if (waiting) { this.pending.delete(message.id); message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result); return; }
    const params = message.params ?? {};
    if (message.method === "Runtime.exceptionThrown") this.errors.push({ kind: "exception", text: params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text });
    else if (message.method === "Runtime.consoleAPICalled" && params.type === "error") this.errors.push({ kind: "console", text: (params.args ?? []).map(arg => arg.value ?? arg.description).join(" ") });
    else if (message.method === "Log.entryAdded" && params.entry.level === "error") this.errors.push({ kind: "log", text: params.entry.text, url: params.entry.url });
    else if (message.method === "Page.javascriptDialogOpening") { (this.dialogs ??= []).push({ type: params.type, message: params.message }); this.errors.push({ kind: "dialog", text: params.type + ": " + params.message }); }
    else if (message.method === "Network.requestWillBeSent") { this.network.set(params.requestId, params.request.url); this.active.add(params.requestId); }
    else if (message.method === "Network.loadingFinished") this.active.delete(params.requestId);
    else if (message.method === "Network.loadingFailed") { this.active.delete(params.requestId); this.failures.push({ url: this.network.get(params.requestId),     error: params.errorText, at: Date.now() }); }
    else if (message.method === "Network.responseReceived" && params.response.status >= 400) this.badResponses.push({ url: params.response.url, status: params.response.status });
  }
  send(method, params = {}, timeout = 30000) {
    if (method === "Page.reload" || method === "Page.navigate") { this.mark("reload"); }
    if (this.closed) return Promise.reject(new Error("The DevTools socket is closed (" + method + ")."));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`DevTools command ${method} timed out after ${timeout} ms.`)); }, timeout);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression, timeout = 60000) {
    const result = await this.send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true }, timeout);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async wait(expression, label = expression, timeout = 60000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.evaluate(expression, 15000)) return; } catch { /* the page may still be navigating */ } await delay(250); }
    throw new Error("Timed out waiting for " + label);
  }
  async pointer(selector, dismissOverlay = false) {
    await this.wait(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); return Boolean(element) && !element.disabled && !element.hidden; })()`, selector + " to be enabled", 30000);
    let point;
    for (let attempt = 0; attempt < 5; attempt++) {
      point = await this.evaluate(`(() => { document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close()); const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: "center", inline: "center" }); const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2; let hit = document.elementFromPoint(x, y); const covered = hit && hit !== element && !element.contains(hit) ? hit.outerHTML.slice(0, 120) : null; if (${dismissOverlay} && covered) { hit.style.pointerEvents = "none"; hit = document.elementFromPoint(x, y); } return { x, y, covered, visible: box.width > 0 && box.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight, unobscured: hit === element || element.contains(hit), hit: hit ? hit.tagName + "." + hit.className : null }; })()`);
      if (point.covered) (this.overlays ??= []).push(point.covered);
      if (point.visible && point.unobscured) break;
      await delay(200);
    }
    assert.ok(point.visible && point.unobscured, `${selector} is not an unobscured visible control (hit ${point.hit}).`);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  /** A real pointer click on a panel control; the collapsed details is opened with a real click on its summary first. */
  async click(name, dismissOverlay = false) {
    if (name === "cancel") { this.mark("cancel"); }
    const probe = async stage => { const state = await this.evaluate(panelProbeExpression, 10000).catch(error => ({ unavailable: String(error.message ?? error) })); (this.actions ??= []).push({ control: name, stage, at: Date.now(), ...state }); return state; };
    // The no-vault picker is a modal that makes the panel inert; dismissing it is test setup, the panel control itself is still a real pointer click.
    await this.evaluate(`document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close())`);
    if (!await this.evaluate(`document.getElementById("offline-shell").open`)) {
      await probe("before-summary-click");
      await this.pointer("#offline-shell > summary", dismissOverlay);
      await probe("after-summary-click");
      await this.wait(`document.getElementById("offline-shell").open`, "the offline panel to open", 10000).catch(async error => { await probe("summary-open-timeout"); throw error; });
    } else { await probe("panel-already-open"); }
    await probe("before-control-click");
    await this.pointer(`[data-offline-${name}]`, dismissOverlay);
    await probe("after-control-click");
  }
  panel(key) { return this.evaluate(`document.getElementById("offline-shell")?.dataset.${key} ?? ""`); }
  /** The app keeps lazily loading assets (icons, verification catalog) after it is ready; wait until no new request has started for a quiet period so damage is applied to a settled page, not racing its own loads. */
  settled(quietMs = 2000, timeout = 30000) {
    return settlePage({ started: () => this.network.size, active: () => this.active, urls: id => this.network.get(id), ready: () => this.evaluate(appReady), quietMs, timeout });
  }
  panelState(state, label = state, timeout = 180000) { return this.wait(`document.getElementById("offline-shell")?.dataset.offlineState === ${JSON.stringify(state)}`, label, timeout); }
  bootVersion(version) { return this.wait(`document.getElementById("offline-shell")?.dataset.offlineBootVersion === ${JSON.stringify(version)}`, "the page to run from offline copy " + version, 30000); }
  async snapshot() {
    return this.evaluate(`({ href: location.href, text: document.body?.innerText?.slice(0, 600), panel: document.getElementById("offline-shell") ? { ...document.getElementById("offline-shell").dataset, status: document.querySelector("[data-offline-status]")?.textContent } : null })`, 10000).catch(error => ({ unavailable: String(error.message ?? error) }));
  }
  /** Zero tolerance for unhandled errors, failed loads and failed HTTP responses unless the case deliberately provokes them. The policy is re-enforced after teardown. */
  assertClean(label, policy = {}) {
    this.policy = { label, ...policy };
    this.check();
  }
  /** Records the moment of a deliberate action (real Cancel, reload, quit); only aborts shortly after one may be allowed. */
  mark(name) { (this.marks ??= []).push({ name, at: Date.now() }); }
  aborts(...names) { return item => withinBoundary(this.marks ?? [], item.at, names); }
  check() {
    const policy = this.policy ?? { label: this.label };
    const unexpected = auditPage({ errors: this.errors, failures: this.failures, badResponses: this.badResponses, requests: [...this.network.values()], origin: new URL(this.url).origin }, policy);
    this.unexpected = unexpected; this.enforced = true;
    assert.deepEqual(unexpected.errors, [], `${policy.label}: unhandled page errors`);
    assert.deepEqual(unexpected.failures, [], `${policy.label}: failed network loads`);
    assert.deepEqual(unexpected.responses, [], `${policy.label}: failed HTTP responses`);
    assert.deepEqual(unexpected.external, [], `${policy.label}: no request may leave the origin (GitHub API/raw, native endpoints)`);
  }
  audit() { return { page: this.label, url: this.url, errors: this.errors, failedLoads: this.failures, badResponses: this.badResponses, requests: this.network.size, policy: this.policy?.label ?? null, actions: this.actions ?? [], enforced: Boolean(this.enforced), unexpected: this.unexpected ?? null }; }
  async close() {
    if (!this.child) return;
    // Drain owned work before committing the quit: the app's own workspace/configuration idle lifecycle when the app exists
    // (an expected bootstrap refusal has no app, recorded explicitly), then the shell's mutation lock.
    const drainScript = fixtureDrainScript();
    const result = await acknowledgedQuit({
      drain: () => this.evaluate(drainScript, 15000).catch(error => ({ drained: false, error: String(error?.message ?? error) })),
      sendRequest: () => {
        this.mark("quit");
        return this.send("Runtime.evaluate", { expression: `console.debug(${JSON.stringify(quitRequest(this.nonce))})` }, 10000);
      },
      acked: this.waitForLog(quitAck(this.nonce)),
      exited: this.exited,
      kill: async () => { process.kill(this.child.pid); await this.exited; },
    });
    const quitLog = { ...result, rejected: /WEB_QUIT_REJECTED \S+/.exec(this.log)?.[0] ?? null, dialogs: this.dialogs ?? [] };
    try { this.socket?.close(); } catch { /* already closed */ }
    const record = { ...this.audit(), exitCode: this.exitCode, forcedKill: result.forced, quitLog, childLog: this.log.slice(-4000) };
    diagnostics.push(record);
    children.delete(this.child);
    if (!result.committed) throw new Error(`${this.label}: owned work was not drained, so the quit was not committed and the browser was stopped (${JSON.stringify(result.drain)}).`);
    if (result.forced) throw new Error(`${this.label}: the browser did not complete the acknowledged quit within the deadline and was killed (acknowledged=${result.acknowledged}).`);
    if (!result.acknowledged) throw new Error(`${this.label}: the browser exited without acknowledging the quit request (exit ${this.exitCode}).`);
    if (this.exitCode !== 0) throw new Error(`${this.label}: the browser exited with code ${this.exitCode}, not 0.`);
  }
  /** Resolves only when the exact acknowledgement appears; never resolves on exit alone. */
  waitForLog(text) { return new Promise(resolve => { const poll = () => { if (this.log.includes(text)) resolve(true); else if (this.exitCode === undefined) setTimeout(poll, 25); }; poll(); }); }
}

const appReady = "!document.querySelector('.web-loading') && Boolean(document.getElementById('metadata-status'))";
const panelSettled = `${appReady} && document.getElementById("offline-shell").hidden === false && document.querySelectorAll("dialog[open]").length > 0`;
const SETTLED_LABEL = "panel revealed and the no-vault picker settled";
// SMOKE_FOCUS=tamper runs only prepare plus the manifest/adoption damage cases and writes a diagnostic, never the accepted report.
const focusName = ["tamper", "eviction", "tail", "cancel", "quota", "cacheprobe", "indexui", "workerupdate"].includes(process.env.SMOKE_FOCUS) ? process.env.SMOKE_FOCUS : "";
const focusWorkerUpdate = focusName === "workerupdate";
const focusProbe = focusName === "cacheprobe";
const focus = focusName === "tamper";
const focusEviction = focusName === "eviction";
const focusTail = focusName === "tail";
const focusCancel = focusName === "cancel";
const focusQuota = focusName === "quota";
const focusIndexUi = focusName === "indexui";
// Records every Cache.put (cache name, URL, same-URL overlap, outcome) so a duplicate-entry failure names its real cause.
const putTrace = `(() => {
  if (window.__putTrace) { return; }
  const trace = window.__putTrace = [], names = new WeakMap(), open = CacheStorage.prototype.open, put = Cache.prototype.put, inflight = new Map();
  CacheStorage.prototype.open = async function (name) { const cache = await open.call(this, name); names.set(cache, name); return cache; };
  Cache.prototype.put = async function (request, response) {
    const url = new Request(request).url, key = (names.get(this) ?? "?") + " " + url, entry = { cache: names.get(this) ?? "?", url, at: Math.round(performance.now()), overlapping: inflight.get(key) ?? 0 };
    inflight.set(key, entry.overlapping + 1); trace.push(entry);
    try { return await put.call(this, request, response); }
    catch (error) { entry.error = String(error?.message ?? error); throw error; }
    finally { inflight.set(key, inflight.get(key) - 1); }
  };
})()`;
async function dumpPutTrace(page, name) {
  const trace = await page.evaluate(`({ trace: window.__putTrace ?? null, caches: await caches.keys(), controller: navigator.serviceWorker.controller?.scriptURL ?? null, registrations: (await navigator.serviceWorker.getRegistrations()).length, href: location.href })`).catch(error => ({ unavailable: String(error) }));
  await writeFile(join(evidence, `offline-shell-web-smoke-put-trace-${name}.json`), JSON.stringify(trace, null, 2));
}
async function scenario(name, run) {
  if (focusProbe && !/^(cold online|cache put probe)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (focusCancel && !/^(cold online|cancel keeps)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (!focusProbe && /^cache put probe/.test(name)) { return; }
  if (focusIndexUi && !/^(cold online|user-directed prepare|cold restart|cached index dialog)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (focusWorkerUpdate && !/^(cold online|user-directed prepare|a worker-only update|a real worker update)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (focusQuota && !/^(cold online|storage quota)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (focus && !/^(cold online|user-directed prepare|tampered (manifest|adoption))/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (focusEviction && !/^(cold online|user-directed prepare|an evicted file)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  if (focusTail && !/^(cold online|user-directed prepare|a worker-only update|an update keeps|cancel keeps|storage quota)/.test(name)) { console.log("skipped (focus) - " + name); return; }
  const started = Date.now();
  current = { name, pages: [] };
  await run();
  report.scenarios.push({ name, ms: Date.now() - started, pages: current.pages });
  console.log("ok - " + name);
}
/** Runs `work` on one page; a failure snapshots the panel and the child output before the page is closed. */
async function session(profile, label, url, work, { audit = !label.startsWith("cacheprobe-") } = {}) {
  const page = new Page(profile, label);
  let result, failure = null;
  try { await page.open(url); result = await work(page); }
  catch (error) { error.snapshot = await page.snapshot().catch(() => null); (error.pages ??= []).push({ ...page.audit(), childLog: page.log.slice(-4000) }); failure = error; }
  // Teardown failures and events that arrive during teardown are part of the case: they are reported, never swallowed.
  try { await page.close(); } catch (closeError) { if (failure) { failure.closeError = String(closeError?.message ?? closeError); } else { failure = closeError; } }
  if (!failure && audit) { try { page.check(); } catch (policyError) { failure = policyError; } }
  current?.pages.push(page.audit());
  if (failure) { throw failure; }
  return result;
}
async function serve(output, port = 0) { server = await startWebServer({ port, output }); return server; }
async function stop() { if (server) { await server.close(); server = null; } }

const idb = (page, body) => page.evaluate(`(async()=>{const open=indexedDB.open("slopsidian-github-vault-v1",1),db=await new Promise((ok,no)=>{open.onsuccess=()=>ok(open.result);open.onerror=()=>no(open.error);});try{const store=()=>db.transaction("entries","readwrite").objectStore("entries");const run=request=>new Promise((ok,no)=>{request.onsuccess=()=>ok(request.result);request.onerror=()=>no(request.error);});${body}}finally{db.close();}})()`);
const cacheOf = (version, body) => `(async()=>{const name=(await caches.keys()).find(key=>key.includes(${JSON.stringify(version)}));if(!name)throw new Error("no shell cache");const cache=await caches.open(name);${body}})()`;
const ownedShellState = `(async()=>{const prefix="slopsidian-shell:"+new URL(document.baseURI).pathname+":",names=await caches.keys();const pointer=names.includes("slopsidian-shell-meta")&&Boolean(await (await caches.open("slopsidian-shell-meta")).match(new URL("__slopsidian-shell-active",document.baseURI).href));return{caches:names.filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{32}$/.test(name.slice(prefix.length))).length,pointer}})()`;

let before = null, publishedBefore = null, identities = null;
try {
  before = await coreVerificationInputs(root);
  if (process.env.SMOKE_SOURCE_FINGERPRINT) assert.equal(before.sourceFingerprint, process.env.SMOKE_SOURCE_FINGERPRINT, "The source changed since the final build was recorded.");
  publishedBefore = { tree: await treeDigest(published), site: await siteIdentity(published) };
  assert.equal(publishedBefore.site.embeddedSourceFingerprint, before.sourceFingerprint, "The published artifact was built from different source than the workspace (stale build); rebuild first.");
  assert.equal(JSON.parse(await readFile(join(published, "publish-info.json"), "utf8")).offlineVersion, publishedBefore.site.offlineVersion, "publish-info.json and the manifest disagree (stale or mixed artifact).");
  report.sourceFingerprint = before.sourceFingerprint;
  report.published = publishedBefore;

  const { v1, v2, v3, basePath } = await sites();
  identities = { v1: await siteIdentity(v1), v2: await siteIdentity(v2), v3: await siteIdentity(v3) };
  assert.equal(identities.v1.offlineVersion, publishedBefore.site.offlineVersion);
  assert.notEqual(identities.v2.offlineVersion, identities.v1.offlineVersion);
  assert.notEqual(identities.v3.offlineVersion, identities.v1.offlineVersion);
  assert.notEqual(identities.v3.workerBuild, identities.v1.workerBuild, "The worker-only site must change the worker identity.");
  assert.equal(identities.v3.embeddedSourceFingerprint, before.sourceFingerprint);
  const profile = join(shortHome, "p");
  assert.ok(profile.length < 80, "Browser profiles must stay on a short path: CacheStorage nests about 130 more characters and the Windows path limit is 260.");
  await mkdir(profile);
  const first = await serve(v1);
  const port = new URL(first.endpoint).port;
  const origin = "http://127.0.0.1:" + port, entry = first.endpoint;
  const version1 = identities.v1.offlineVersion;
  const embedded = page => page.evaluate(`fetch("core-verification.json").then(response => response.json()).then(value => value.sourceFingerprint)`);
  const notes = [["Index A.md", "# A\n[[Index B]] #idx\n"], ["Index B.md", "# B\n#idx\n"]];
  let seeded = null;
  const route = () => entry + "remote-vault/github.com/" + seeded.mount.repository + "/tree/main?cached=true&file=" + encodeURIComponent("Index A.md");

  await scenario("cold online page is unprepared and caches nothing until the user asks", () => session(profile, "online", entry, async page => {
    await page.wait(appReady, "the online app");
    await page.wait(`document.getElementById("offline-shell").dataset.offlineState === "not-prepared"`, "not-prepared status");
    assert.equal(await page.evaluate(`(await caches.keys()).filter(key => key.startsWith("slopsidian-shell")).length`), 0, "Loading the app must not populate any offline-shell cache.");
    assert.equal(await page.panel("offlineBootVersion"), "", "An online page is not offline-boot proof.");
    assert.equal(await embedded(page), before.sourceFingerprint, "The network-served page must embed the current source fingerprint.");
    page.assertClean("online cold page");
  }));

  await scenario("user-directed prepare (real pointer) adopts one complete version and the next load is controlled by it", () => session(profile, "prepare", entry, async page => {
    await page.wait(appReady, "the online app");
    await page.wait(panelSettled, SETTLED_LABEL, 60000);
    await page.click("prepare");
    await page.panelState("ready", "prepared state");
    assert.equal(await page.panel("offlineVersion"), version1);
    await page.send("Page.reload");
    await page.wait(appReady, "the reloaded app");
    await page.wait(`navigator.serviceWorker.controller !== null`, "service-worker control");
    await page.bootVersion(version1);
    assert.equal(await embedded(page), before.sourceFingerprint, "The offline copy embeds the same source fingerprint.");
    page.assertClean("prepared page");
  }));

  await stop();
  await scenario("cold restart with the network OFF boots the app, workers and renderer from the cached shell", () => session(profile, "cold-offline", entry, async page => {
    await page.wait(appReady, "the offline app", 120000);
    await page.bootVersion(version1);
    assert.equal(await page.evaluate(`typeof Blazor === "object" && Boolean(navigator.serviceWorker.controller)`), true);
    assert.equal(await page.evaluate(`(await fetch(location.href, { cache: "no-store" })).ok`), true, "Shell requests are answered locally.");
    assert.equal(await embedded(page), before.sourceFingerprint, "The cold offline page embeds the current source fingerprint.");
    const probe = await page.evaluate(`fetch("/not-in-the-manifest.txt").then(response => response.status, () => "network-error")`);
    assert.notEqual(probe, 200);
    const missing = /not-in-the-manifest\.txt/;
    page.assertClean("cold offline boot", { failures: [exactUrl(origin, "not-in-the-manifest.txt")], responses: [exactUrl(origin, "not-in-the-manifest.txt")], errors: [error => missing.test(error.url ?? "") || missing.test(error.text ?? "")] });
  }));

  await scenario("a genuine cached GitHub mount is seeded offline in local storage only", () => session(profile, "seed", entry, async page => {
    const { mountCachedGitHub } = await import("./cached-github-fixture.mjs");
    await page.wait(appReady, "the offline app", 120000);
    await page.wait(`typeof app !== "undefined" && Boolean(app.githubVaults)`, "the GitHub vault host", 60000);
    seeded = await mountCachedGitHub(expression => page.evaluate(expression), "offline-route", notes);
    await page.wait(`app.githubVaults.state()?.cached === true`, "the cached mount", 60000);
    assert.equal(await page.evaluate(`app.githubVaults.state().counters.raw + app.githubVaults.state().counters.api`), 0);
    const stored = await page.evaluate(`(async () => JSON.stringify([...(await caches.keys())]))()`);
    assert.ok(!/github|Index/i.test(stored.replace(/slopsidian-shell[^"]*/g, "")), "Repository data never enters the shell caches.");
    page.assertClean("seeding");
  }));

  await scenario("a cold canonical cached remote route boots offline into the read-only mount with the exact note and no API/raw fallback", () => session(profile, "remote-route", route(), async page => {
    await page.wait(appReady, "the offline cached remote route", 120000);
    await page.bootVersion(version1);
    await page.wait(`typeof app !== "undefined" && app.vault?.rootPath === ${JSON.stringify(seeded.mount.id)}`, "the cached mount to become the vault", 60000);
    assert.equal(await page.evaluate(`app.vault.readOnly`), true);
    assert.equal(await page.evaluate(`app.githubVaults.state().cached`), true, "The route opened the cache-only mount.");
    await page.wait(`app.workspace.getActiveFile()?.path === "Index A.md"`, "the linked note to be active", 60000);
    assert.equal(await page.evaluate(`app.vault.read(app.workspace.getActiveFile())`), notes[0][1], "The exact cached note bytes are shown.");
    assert.equal(await page.evaluate(`app.vault.lazy`), true, "Mounting stays lazy: only the opened note is indexed.");
    assert.match(await page.evaluate(`document.getElementById("metadata-status").textContent`), /partial index/i);
    const counters = await page.evaluate(`app.githubVaults.state().counters`);
    assert.equal(counters.raw, 0, "No raw download."); assert.equal(counters.api ?? 0, 0, "No API call.");
    assert.equal(await embedded(page), before.sourceFingerprint);
    page.assertClean("cold cached remote route");
  }));

  await scenario("explicit complete cached index offline: partial first, missing and corrupt bytes refused, complete after exact cached bytes, zero downloads", () => session(profile, "index", route(), async page => {
    await page.wait(appReady, "the offline cached remote route", 120000);
    await page.wait(`typeof app !== "undefined" && app.githubVaults?.state()?.cached === true`, "the cached mount", 60000);
    assert.equal(await page.evaluate(`app.githubVaults.index.status().then(status => status?.state)`), "none", "Mounting never indexes.");
    assert.equal(await page.evaluate(`app.vault.indexComplete`), false);
    const blobB = seeded.blobs[1].key, good = await idb(page, `return Array.from(new Uint8Array(await run(store().get(${JSON.stringify(blobB)})).then(entry => entry.value)))`);
    await idb(page, `await run(store().delete(${JSON.stringify(blobB)}))`);
    const missing = await page.evaluate(`app.githubVaults.index.prepare().then(status => status, error => ({ state: "refused", message: error.message }))`);
    assert.ok(["refused", "partial"].includes(missing.state), "A missing cached note must not complete the index: " + JSON.stringify(missing));
    assert.equal(await page.evaluate(`app.vault.indexComplete`), false);
    await idb(page, `await run(store().put({ key: ${JSON.stringify(blobB)}, value: new Uint8Array(${JSON.stringify(good)}.map(byte => byte ^ 1)).buffer }))`);
    const corrupt = await page.evaluate(`app.githubVaults.index.prepare().then(status => status, error => ({ state: "refused", message: error.message }))`);
    assert.ok(["refused", "partial"].includes(corrupt.state), "A corrupt cached note must not complete the index: " + JSON.stringify(corrupt));
    assert.equal(await page.evaluate(`app.vault.indexComplete`), false);
    assert.match(await page.evaluate(`document.getElementById("metadata-status").textContent`), /partial index/i, "Partial stays visibly partial.");
    await idb(page, `await run(store().put({ key: ${JSON.stringify(blobB)}, value: new Uint8Array(${JSON.stringify(good)}).buffer }))`);
    const result = await page.evaluate(`app.githubVaults.index.prepare()`);
    assert.equal(result.state, "complete", result.message);
    await page.wait(`/complete index/i.test(document.getElementById("metadata-status")?.textContent ?? "")`, "the complete index status", 30000);
    assert.equal(await page.evaluate(`app.vault.indexComplete`), true);
    const counters = await page.evaluate(`app.githubVaults.state().counters`);
    assert.equal(counters.raw, 0, "Cache-only indexing performs zero raw downloads."); assert.equal(counters.api ?? 0, 0);
    const { assertCachedBlobsUnchanged } = await import("./cached-github-fixture.mjs");
    await assertCachedBlobsUnchanged(expression => page.evaluate(expression), seeded.blobs);
    page.assertClean("cached complete index");
  }));

  await scenario("cached index dialog UI: real pointers drive Prepare, held Cancel, Resume, missing and corrupt refusal, then a verified complete index with offline search metadata", async () => {
    const dialogNotes = [["Index A.md", "# A\n[[Index B]] #idx\n"], ["Index B.md", "# B\n[[Index C]] #idx\n"], ["Index C.md", "# C\n#idx\n"]];
    const { mountCachedGitHub, assertCachedBlobsUnchanged } = await import("./cached-github-fixture.mjs");
    let dialogSeed = null;
    await session(profile, "index-ui-seed", entry, async page => {
      await page.wait(appReady, "the offline app", 120000);
      await page.wait(`typeof app !== "undefined" && Boolean(app.githubVaults)`, "the GitHub vault host", 60000);
      dialogSeed = await mountCachedGitHub(expression => page.evaluate(expression), "index-ui", dialogNotes);
      await page.wait(`app.githubVaults.state()?.cached === true`, "the cached mount", 60000);
      page.assertClean("index dialog seeding");
    });
    const dialogRoute = entry + "remote-vault/github.com/" + dialogSeed.mount.repository + "/tree/main?cached=true&file=" + encodeURIComponent("Index A.md");
    const blobC = dialogSeed.blobs[2].key;
    await session(profile, "index-ui", dialogRoute, async page => {
      await page.wait(appReady, "the offline cached remote route", 120000);
      await page.bootVersion(version1);
      await page.wait(`typeof app !== "undefined" && app.vault?.rootPath === ${JSON.stringify(dialogSeed.mount.id)} && app.workspace.getActiveFile()?.path === "Index A.md"`, "the cached mount note", 60000);
      const { checkGitHubIndexUi } = await import("./github-index-ui-scenarios.mjs");
      await checkGitHubIndexUi({ evaluate: expression => page.evaluate(expression), click: selector => page.pointer(selector), wait: (expression, label, timeout) => page.wait(expression, label, timeout), mark: name => page.mark(name), seeded: dialogSeed, report, notes: dialogNotes });
      page.assertClean("cached index dialog");
    });
  });
  if (focusIndexUi) { await stop(); throw Object.assign(new Error("focus run complete"), { focusDone: true }); }

  await scenario("an evicted file is reported honestly offline (503, never a network or mixed fallback)   and a real-pointer repair restores it", async () => { await serve(v1, Number(port)); return session(profile, "evicted", entry, async page => {
      await page.wait(appReady, "the online app");
    await page.evaluate(cacheOf(version1, `await cache.delete(new URL("browser.css", document.baseURI));`));
    await stop();
    await page.send("Page.reload");
    await page.wait(`document.getElementById("offline-shell")`, "panel after eviction", 120000);
    // The no-vault picker opens asynchronously after boot and the panel is revealed only after its first status; click once both settled so the picker cannot reopen over the summary mid-click.
    await page.wait(panelSettled, SETTLED_LABEL, 60000);
    assert.equal(await page.evaluate(`fetch("browser.css").then(response => response.status)`), 503);
    await page.click("verify");
    await page.wait(`["incomplete", "corrupt"].includes(document.getElementById("offline-shell").dataset.offlineState)`, "incomplete status");
    await serve(v1, Number(port));
    await page.click("prepare");
    await page.panelState("ready", "repair");
    assert.equal(await page.evaluate(`fetch("browser.css").then(response => response.status)`), 200);
    // Which boot script is still loading when the deliberate reload lands varies by run; only these exact observed scripts, only within the reload/quit boundary.
    const bootScripts = ["js/editor-host.js", "js/browser-host.js"].map(path => exactUrl(origin, path)), css = exactUrl(origin, "browser.css");
    page.assertClean("eviction", { errors: [error => /browser\.css/.test(error.url ?? "") || /browser\.css/.test(error.text ?? "")], failures: [css], responses: [css], aborted: [item => bootScripts.some(script => script.test(item.url ?? "")) && page.aborts("reload", "quit")(item)] });
  }); });

  const manifestPaths = JSON.parse(await readFile(join(v1, "wwwroot", "offline-manifest.json"), "utf8")).files.map(file => file.path);
  const wasm = selectRuntimeWasm(manifestPaths);
  const clearSdkCache = page => page.evaluate(`(${clearSdkBootCache.toString()})(caches, (${sdkBootCacheName.toString()})(document.baseURI, location.origin), ${JSON.stringify(wasm.split("/").pop())})`);
  const clearSiteData = page => page.send("Storage.clearDataForOrigin", { origin, storageTypes: "cache_storage,service_workers" });
  // Each case damages one stored byte or record while online, then cold-boots with the server stopped.
  const damage = [
    { name: "JavaScript", target: "_framework/blazor.webassembly.js", tamper: cacheOf(version1, `const url = new URL("_framework/blazor.webassembly.js", document.baseURI), bytes = new Uint8Array(await (await cache.match(url)).arrayBuffer()); bytes[0] ^= 1; await cache.put(url, new Response(bytes, { headers: { "Content-Type": "text/javascript" } }));`), path: "_framework/blazor.webassembly.js", panel: true },
    { name: "WebAssembly", target: wasm, tamper: cacheOf(version1, `const url = new URL(${JSON.stringify(wasm)}, document.baseURI), bytes = new Uint8Array(await (await cache.match(url)).arrayBuffer()); bytes[bytes.length >> 1] ^= 1; await cache.put(url, new Response(bytes, { headers: { "Content-Type": "application/wasm" } }));`), path: wasm, panel: true },
    { name: "HTML", target: "index.html", tamper: cacheOf(version1, `const url = new URL("index.html", document.baseURI), bytes = new Uint8Array(await (await cache.match(url)).arrayBuffer()); bytes[bytes.length - 2] ^= 1; await cache.put(url, new Response(bytes, { headers: { "Content-Type": "text/html" } }));`), path: "index.html", panel: false },
    { name: "manifest metadata", target: "offline-manifest.json", tamper: cacheOf(version1, `const url = new URL("offline-manifest.json", document.baseURI), manifest = JSON.parse(await (await cache.match(url)).text()), first = manifest.files[0].sha256; manifest.files[0].sha256 = (first[0] === "0" ? "1" : "0") + first.slice(1); await cache.put(url, new Response(JSON.stringify(manifest, null, 2), { headers: { "Content-Type": "application/json" } }));`), parsed: cacheOf(version1, `return JSON.parse(await (await cache.match(new URL("offline-manifest.json", document.baseURI))).text()).files[0].sha256;`), path: "index.html", panel: false },
    { name: "adoption record", target: "meta", tamper: `(async()=>{const meta=await caches.open("slopsidian-shell-meta");await meta.put(new URL("__slopsidian-shell-active", document.baseURI).href,new Response("{not json",{headers:{"Content-Type":"application/json"}}));})()`, path: "index.html", panel: false },
  ];
  for (const item of damage.filter(item => focusEviction || focusTail ? false : !focus || ["manifest metadata", "adoption record"].includes(item.name))) {
    await scenario(`tampered ${item.name} is refused on a cold offline boot, never run as a ready shell, and is repaired only by an explicit user action`,     async () => { await stop(); await serve(v1, Number(port)); return session(profile, "tamper-" + item.name, entry, async page => {
          await page.wait(appReady, "the online app");
      await page.settled();
      const digest = () => page.evaluate(item.target === "meta"
        ? `(async()=>{const meta=await caches.open("slopsidian-shell-meta"),r=await meta.match(new URL("__slopsidian-shell-active", document.baseURI).href),b=new Uint8Array(await r.arrayBuffer());return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b))).map(x=>x.toString(16).padStart(2,"0")).join("")})()`
        : cacheOf(version1, `const r=await cache.match(new URL(${JSON.stringify(item.target)}, document.baseURI)),b=new Uint8Array(await r.arrayBuffer());return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b))).map(x=>x.toString(16).padStart(2,"0")).join("");`));
      const untouched = await digest();
      const parsedBefore = item.parsed ? await page.evaluate(item.parsed) : undefined;
      await page.evaluate(item.tamper);
      if (item.parsed) {
        const parsedAfter = await page.evaluate(item.parsed);
        assert.match(parsedBefore, /^[0-9a-f]{64}$/); assert.match(parsedAfter, /^[0-9a-f]{64}$/);
        assert.notEqual(parsedAfter, parsedBefore, "The parsed stored files[0].sha256 must differ after the manifest tamper.");
      }
      assert.notEqual(await digest(), untouched, `The ${item.name} fixture must really change the stored bytes before the cold boot; an unchanged fixture proves nothing.`);
      // A cold boot starts a fresh worker with no memoized manifest; stop the running one so damaged records are really re-read.
      await page.send("ServiceWorker.enable"); await page.send("ServiceWorker.stopAllWorkers");
      if (item.path === wasm) {
        // The SDK keeps its own valid boot-resource copy; clear only this app base's cache so the damaged shell copy is the one the cold boot must use.
        const sdk = await clearSdkCache(page);
        (report.sdkBootCache ??= []).push({ target: wasm, shellSha256Before: untouched, ...sdk });
        assert.equal(sdk.existsAfter, false, "The SDK boot cache for this app base must be gone before the damaged reload.");
      }
      // The worker re-reads and re-validates the stored manifest on every request, so no idle wait is needed.
      await stop();
      await page.send("Page.reload");
      if (item.panel) {
        await page.wait(`document.getElementById("offline-shell")`, "panel after tampering", 120000);
        assert.equal(await page.evaluate(`fetch(${JSON.stringify(item.path)}).then(response => response.status)`), 503, "A tampered file must not be served.");
        await delay(item.path === wasm ? 8000 : 1000);
        if (item.path === wasm) assert.equal(await page.evaluate(appReady), false, "A tampered WebAssembly file never produces a ready app.");
        else assert.equal(await page.evaluate(`typeof Blazor === "undefined"`), true, "The tampered script never executed.");
        await page.click("verify", item.path === wasm);
        await page.wait(`["incomplete", "corrupt"].includes(document.getElementById("offline-shell").dataset.offlineState)`, "corrupt status");
        await serve(v1, Number(port));
        await page.click("prepare", item.path === wasm);
        await page.panelState("ready", "repair");
      } else {
        await page.wait(`document.body && /not executed|damaged|corrupt|unavailable/i.test(document.body.innerText)`, "the explicit refusal page", 60000);
        assert.equal(await page.evaluate(`Boolean(document.getElementById("offline-shell")) || typeof Blazor !== "undefined"`), false, "No app or panel ran from damaged shell state.");
        // A shell whose own entry page or records are damaged cannot repair itself; the user clears site data and prepares again.
        await clearSiteData(page);
        await serve(v1, Number(port));
        await page.send("Page.navigate", { url: entry });
        await page.wait(appReady, "the network-served app after clearing site data");
        await page.wait(panelSettled, SETTLED_LABEL, 60000);
        await page.click("prepare");
        await page.panelState("ready", "re-prepare");
      }
      assert.equal(await page.panel("offlineVersion"), version1);
      // Exactly the intentional refusals, each tied to the declared asset or navigation URL it concerns; anything else fails acceptance.
      const at = path => exactUrl(origin, path);
      const refusedOn = paths => error => /status of 503/.test(error.text ?? "") && paths.some(path => at(path).test(error.url ?? ""));
      const asset = [item.path], navigation = ["", "index.html"];
      const intentional = item.name === "JavaScript" ? { errors: [refusedOn(asset), /_framework\/blazor\.webassembly\.js|corrupt and was not executed/], failures: [at(item.path)], responses: [at(item.path)] }
        : item.name === "WebAssembly" ? { errors: [refusedOn(asset), /\.wasm|corrupt and was not executed|Failed to start platform|WebAssembly/i], failures: [at(item.path)], responses: [at(item.path)] }
        : { errors: [refusedOn(navigation), /offline manifest|adoption record|not served/i], failures: navigation.map(at), responses: navigation.map(at) };
      page.assertClean("tampered " + item.name, { ...intentional, aborted: [item => exactUrl(origin, "js/editor-host.js").test(item.url ?? "") && page.aborts("reload", "quit")(item)] });
    }); });
  }
  report.limits.push("A damaged index.html or adoption/manifest record leaves the offline shell unable to repair itself from the page; recovery is clearing site data (exercised with Storage.clearDataForOrigin) and preparing again.");
  report.limits.push("Worker update rollback is not atomic: a new worker is only admitted while the adoption record names it, but if it finished activating before a rollback write, it stays active against the restored record and fails closed (network online, explicit 503 offline) until the user prepares again. The harness exercises the rejected-install and successful A-to-B paths, not that race.");
  if (focus || focusEviction) { throw Object.assign(new Error("focus run complete"), { focusDone: true }); }

  await scenario("a worker-only update is never installed ahead of its adoption record: the unadopted new worker is rejected and the adopted shell keeps serving offline", async () => {
    await stop(); await serve(v3, Number(port));
    await session(profile, "worker-only", entry, async page => {
      await page.wait(`document.getElementById("offline-shell")`, "panel on the worker-only site", 120000);
      const outcome = await page.evaluate(`(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); const worker = registration.installing ?? registration.waiting; if (!worker) { return { state: "no-new-worker", active: Boolean(registration.active) }; } await new Promise(resolve => { const done = () => { if (worker.state === "redundant" || worker.state === "activated") { worker.removeEventListener("statechange", done); resolve(); } }; worker.addEventListener("statechange", done); done(); }); return { state: worker.state, active: Boolean(registration.active), waiting: Boolean(registration.waiting), installing: Boolean(registration.installing) }; })()`);
      report.workerOnly = outcome;
      assert.equal(outcome.state, "redundant", "A new worker the adoption record does not name must reject its own install.");
      assert.equal(outcome.active, true, "The previously adopted worker stays active."); assert.equal(outcome.waiting, false);
      await stop();
      assert.equal(await page.evaluate(`fetch("browser.css").then(response => response.status, () => "network-error")`), 200, "The adopted shell still serves offline after the rejected worker.");
      page.assertClean("worker-only update");
    });
    await serve(v1, Number(port));
    await session(profile, "worker-restored", entry, async page => {
      await page.wait(appReady, "the original site");
      await page.bootVersion(version1);
      page.assertClean("worker restored");
    });
  });
  {
    await scenario("a real worker update adopts B after its record is written and boots only B offline", async () => {
      const wprofile = join(shortHome, "w");
      await stop(); await serve(v1, Number(port));
      await session(wprofile, "worker-a", entry, async page => {
        await page.wait(appReady, "the online app");
        await page.wait(panelSettled, SETTLED_LABEL, 60000);
        await page.click("prepare");
        await page.wait(`document.getElementById("offline-shell").dataset.offlineState === "ready"`, "version 1 adoption", 180000);
        assert.equal(await page.panel("offlineVersion"), version1);
        page.assertClean("worker A adoption");
      });
      await stop(); await serve(v3, Number(port));
      await session(wprofile, "worker-b", entry, async page => {
        await page.wait(appReady, "the app served by worker A");
        await page.bootVersion(version1);
        await page.wait(panelSettled, SETTLED_LABEL, 60000);
        await page.click("check");
        await page.wait(`/update/i.test(document.querySelector("[data-offline-status]").textContent)`, "worker update available");
        await page.click("prepare");
        await page.wait(`document.getElementById("offline-shell").dataset.offlineState === "ready" && document.getElementById("offline-shell").dataset.offlineVersion === ${JSON.stringify(identities.v3.offlineVersion)}`, "worker B adoption", 180000);
        const registration = await page.evaluate(`navigator.serviceWorker.getRegistration().then(registration => ({ active: Boolean(registration.active), waiting: Boolean(registration.waiting), installing: Boolean(registration.installing) }))`);
        assert.deepEqual(registration, { active: true, waiting: false, installing: false });
        await stop();
        await page.send("Page.reload");
        await page.wait(appReady, "worker B booting offline", 120000);
        await page.bootVersion(identities.v3.offlineVersion);
        page.assertClean("worker B adoption");
      });
    });
    if (focusWorkerUpdate) { await stop(); throw Object.assign(new Error("focus run complete"), { focusDone: true }); }
  }

  await scenario("an update keeps the old shell until the new complete set is adopted,   then boots only the new version", async () => { await stop(); await serve(v2, Number(port)); return session(profile, "update", entry, async page => {
      await page.wait(appReady, "the app served by the old shell");
    await page.bootVersion(version1);
    await page.wait(panelSettled, SETTLED_LABEL, 60000);
    await page.click("check");
    await page.wait(`/update/i.test(document.querySelector("[data-offline-status]").textContent)`, "update available");
    await page.click("prepare");
    await page.wait(`document.getElementById("offline-shell").dataset.offlineState === "ready" && document.getElementById("offline-shell").dataset.offlineVersion !== ${JSON.stringify(version1)}`, "update adoption", 180000);
    const version2 = await page.panel("offlineVersion");
    assert.equal(version2, identities.v2.offlineVersion);
    assert.deepEqual(await page.evaluate(`(await caches.keys()).filter(key => key.includes(${JSON.stringify(version1)}))`), [], "The old version's cache is removed only after adoption.");
    await stop();
    await page.send("Page.reload");
    await page.wait(appReady, "the updated offline app", 120000);
    await page.bootVersion(version2);
    assert.equal(await embedded(page), before.sourceFingerprint);
    page.assertClean("update");
  }); });

  const probeResults = {};
  const runProbe = async (fresh, label) => {
    await mkdir(fresh, { recursive: true });
    await stop(); await serve(v1, Number(port));
    await session(fresh, "cacheprobe-" + label, entry, async page => {
      await page.wait(appReady, "the online app");
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      const probe = `(async (cases) => {
        const manifest = await (await fetch("offline-manifest.json", { cache: "no-store" })).json();
        const files = manifest.files.filter(file => file.path.endsWith(".wasm")).sort((a, b) => b.size - a.size).slice(0, 4);
        const fetched = () => Promise.all(files.map(async file => { const url = new URL(file.path, document.baseURI).href, response = await fetch(url, { cache: "no-store" }); return { url, response, body: null }; }));
        const results = [];
        for (const { wide, raw } of cases) {
          const name = "probe-" + (wide ? "wide" : "serial") + "-" + (raw ? "response" : "buffer") + "-" + Math.random().toString(36).slice(2, 6);
          let cache; const outcome = [];
          try { await caches.delete(name); cache = await caches.open(name); } catch (error) { results.push({ cache: name, wide, raw, openError: String(error.message) }); continue; }
          const items = await fetched();
          const one = async item => {
            const started = Math.round(performance.now());
            try { await cache.put(item.url, raw ? item.response : new Response(await item.response.arrayBuffer(), { status: 200, headers: { "Content-Type": "application/wasm" } })); outcome.push({ url: item.url, ok: true, started }); }
            catch (error) { outcome.push({ url: item.url, ok: false, started, error: String(error.message) }); }
          };
          if (wide) { await Promise.all(items.map(one)); } else { for (const item of items) { await one(item); } }
          results.push({ cache: name, wide, raw, outcome }); await caches.delete(name);
        }
        return { sizes: files.map(file => file.size), results };
      })`;
      const cases = [false, true].flatMap(wide => [false, true].map(raw => ({ wide, raw })));
      const result = probeResults[label] = { profile: fresh, profileLength: fresh.length };
      result.unthrottled = await page.evaluate(`${probe}(${JSON.stringify(cases)})`);
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 50, downloadThroughput: 400 * 1024, uploadThroughput: -1 });
      result.throttled = await page.evaluate(`${probe}(${JSON.stringify(cases)})`);
      try { result.longestProfilePath = await longestPath(fresh); }
      catch (error) { result.pathMeasurementError = String(error?.message ?? error); throw error; }
      finally { result.nativeLog = String(page.log).split(/\r?\n/).filter(line => /disk_cache|cache_storage|simple_index|ERROR/i.test(line)).slice(-40); }
    });
  };
  await scenario("cache put probe: identical asset and throttle/concurrency/body matrix in a long versus a short owned profile path", async () => {
    try { await runProbe(join(shortHome, "pp"), "short"); await runProbe(join(fixture, "profile-cacheprobe"), "long"); }
    finally { await writeFile(join(evidence, "offline-shell-web-smoke-cache-probe.json"), JSON.stringify(probeResults, null, 2)); }
    console.log(JSON.stringify(probeResults));
  });
  if (focusProbe) { await stop(); throw Object.assign(new Error("focus run complete"), { focusDone: true }); }

  await scenario("cancel keeps verified files without adopting, resume reuses them, and remove deletes the copy and worker (real pointer)", async () => {
    const fresh = join(shortHome, "pc");
    await mkdir(fresh);
    await stop(); await serve(v1, Number(port));
    await session(fresh, "cancel-resume", entry, async page => {
      await page.wait(appReady, "the online app");
      await page.evaluate(putTrace);
      try {
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 50, downloadThroughput: 400 * 1024, uploadThroughput: -1 });
      await page.wait(panelSettled, SETTLED_LABEL, 60000);
      await page.click("prepare");
      await page.wait(`/^[1-9]\\d* of/.test(document.querySelector("[data-offline-counts]").textContent) || document.getElementById("offline-shell").dataset.offlineState === "error"`, "some files saved", 120000);
      assert.notEqual(await page.panel("offlineState"), "error", "Preparation failed before cancel: " + await page.evaluate(`document.querySelector("[data-offline-status]").textContent`));
      } catch (error) { await dumpPutTrace(page, "cancel-resume"); throw error; }
      await page.click("cancel");
      await page.panelState("incomplete", "cancelled state", 60000);
      assert.equal(await page.evaluate(`caches.has("slopsidian-shell-meta").then(async has => has && Boolean(await (await caches.open("slopsidian-shell-meta")).match(new URL("__slopsidian-shell-active", document.baseURI).href)))`), false, "Cancel never adopts.");
      assert.equal(await page.evaluate(`(await caches.keys()).filter(key => key.startsWith("slopsidian-shell:")).length`), 1, "Verified files are kept for resume.");
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: 4 * 1024 * 1024, uploadThroughput: -1 });
      await page.click("prepare");
      await page.wait(`/reused/.test(document.querySelector("[data-offline-counts]").textContent)`, "reused files on resume", 120000);
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await page.panelState("ready", "resumed preparation");
      assert.equal(await page.panel("offlineVersion"), version1);
      await page.send("Page.reload");
      await page.wait(appReady, "the controlled app");
      await page.bootVersion(version1);
      await page.wait(panelSettled, SETTLED_LABEL, 60000);
      await page.click("remove");
      await page.panelState("not-prepared", "removed state", 60000);
      assert.deepEqual(await page.evaluate(ownedShellState), { caches: 0, pointer: false }, "Remove deletes only this base's versioned caches and adoption pointer; the shared container may stay.");
      assert.equal(await page.evaluate(`navigator.serviceWorker.getRegistrations().then(list => list.filter(registration=>registration.scope===new URL(document.baseURI).href).length)`), 0, "Remove unregisters this base's worker.");
      // Only declared same-origin URLs may abort inside a deliberate action's recorded window.
      const declared = [...manifestPaths, "offline-manifest.json", "service-worker.js"];
      page.assertClean("cancel resume remove", { aborted: [item => declared.some(path => exactUrl(origin, path).test(item.url ?? "")) && page.aborts("cancel", "reload", "quit")(item)] });
    });
  });

  if (focusCancel) { await stop(); throw Object.assign(new Error("focus run complete"), { focusDone: true }); }
  await scenario("storage quota exhaustion is a visible error that leaves no adopted set", async () => {
    const fresh = join(shortHome, "pq");
    await mkdir(fresh);
    await stop(); await serve(v1, Number(port));
    await session(fresh, "quota", entry, async page => {
      await page.wait(appReady, "the online app");
      // CDP success does not prove the cap reached CacheStorage: record what the browser actually reports before and after the override.
      const quotaReport = { requested: { origin, quotaSize: 64 * 1024 } };
      quotaReport.before = await page.send("Storage.getUsageAndQuota", { origin });
      quotaReport.override = await page.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: 64 * 1024 }).then(() => "accepted", error => "rejected: " + error.message);
      quotaReport.after = await page.send("Storage.getUsageAndQuota", { origin });
      quotaReport.estimate = await page.evaluate(`navigator.storage.estimate().then(({ usage, quota }) => ({ usage, quota }))`);
      const reportedCap = quotaReport.estimate.quota <= 1024 * 1024 && quotaReport.after.quota <= 1024 * 1024;
      quotaReport.reportedCap = reportedCap;
      // A reported small cap is not proof that CacheStorage enforces it: write one bounded disposable entry just above the cap (never a disk fill).
      let enforced = false;
      if (reportedCap) {
        quotaReport.probe = await page.evaluate(`(async () => { const name = "smoke-quota-probe"; let outcome; try { const cache = await caches.open(name); await cache.put("/quota-probe", new Response(new Uint8Array(128 * 1024))); outcome = { ok: true }; } catch (error) { outcome = { ok: false, name: error?.name, message: String(error?.message ?? error) }; } await caches.delete(name).catch(() => {}); return outcome; })()`);
        enforced = quotaReport.probe.ok === false && quotaReport.probe.name === "QuotaExceededError";
      }
      quotaReport.mode = enforced ? "physical-cap-enforced" : reportedCap ? "reported-cap-not-enforced; injected-QuotaExceededError" : "cap-not-reported; injected-QuotaExceededError";
      report.quota = quotaReport;
      if (!enforced) {
        // Explicit fault injection: proves the UI error and cleanup handling only; physical quota enforcement is NOT proven in this mode.
        await page.evaluate(`(() => { const put = Cache.prototype.put; let count = 0; Cache.prototype.put = async function (...args) { if (++count === 3) { throw new DOMException("Injected by the smoke harness (not a real browser quota).", "QuotaExceededError"); } return put.apply(this, args); }; })()`);
        report.limits.push("The storage-quota case used an explicitly injected Cache.put QuotaExceededError because physical CacheStorage enforcement was not established (" + quotaReport.mode + "; reported " + JSON.stringify(quotaReport.estimate) + "); it proves the visible error and cleanup handling, not physical quota enforcement.");
      }
      await page.wait(panelSettled, SETTLED_LABEL, 60000);
      await page.click("prepare");
      await page.panelState("error", "quota error");
      assert.equal(await page.panel("offlineError"), "quota");
      assert.deepEqual(await page.evaluate(ownedShellState), { caches: 0, pointer: false }, "A failed preparation must leave neither this base's versioned cache nor an adoption pointer.");
      assert.equal(await page.evaluate(`navigator.serviceWorker.controller === null`), true, "No worker controls a page that has no adopted set.");
      page.assertClean("quota");
    });
  });

  if (focusTail || focusQuota) { await stop(); throw Object.assign(new Error("focus run complete"), { focusDone: true }); }
  await stop();
  const after = await coreVerificationInputs(root), publishedAfter = { tree: await treeDigest(published), site: await siteIdentity(published) };
  assert.equal(after.sourceFingerprint, before.sourceFingerprint, "The source changed during the run; this run is not acceptable.");
  assert.deepEqual(publishedAfter, publishedBefore, "The published artifact changed during the run.");
  // Every page was enforced against its case policy through teardown; this is the final guard against an unenforced or unclean page.
  const pages = report.scenarios.flatMap(item => item.pages.map(page => ({ scenario: item.name, ...page })));
  const unenforced = pages.filter(page => !page.enforced).map(page => `${page.scenario} / ${page.page}`);
  assert.deepEqual(unenforced, [], "Every page must be audited against a case policy through teardown.");
  const unexpectedRecords = pages.filter(page => page.unexpected && !isClean(page.unexpected));
  assert.deepEqual(unexpectedRecords.map(page => ({ scenario: page.scenario, page: page.page, unexpected: page.unexpected })), [], "No page may carry an unexpected error, failed load or failed HTTP response.");
  assert.equal(diagnostics.filter(record => record.forcedKill).length, 0, "No browser may need a forced kill.");
  // Expected negative records stay visible; they are listed, not hidden.
  const unhandled = pages.flatMap(page => page.errors.map(error => ({ scenario: page.scenario, page: page.page, ...error })));
  report.limits.push(
    "The cached index dialog scenario opens the real modal and drives Prepare, Cancel (held through the real SHA-256 verification of one note, restored in finally), Resume and missing/corrupt refusal with real pointers on the WASM cache-only mount (actual-folder WASM mounts and the native Electron desktop dialog are not covered by this driver).",
    "The earlier index scenario still calls app.githubVaults.index directly; the dialog scenario is the pointer-driven path.",
    "The no-vault picker modal that makes the panel inert is dismissed programmatically before each real pointer click on a panel control; when the WebAssembly runtime fails to start, the framework's failure layer that covers the panel is set pointer-events:none so the real click can reach the control.",
    "Electron/Chromium only; the network-OFF phases stop the static server, they are not a captive-portal or flaky-network simulation.",
    "Private repositories, credentials and live publication are not part of this run.");
  Object.assign(report, {
    status: "passed", finishedAt: new Date().toISOString(), basePath, origin: "http://127.0.0.1:<ephemeral>",
    coreVerificationInputs: { before: before.sourceFingerprint, after: after.sourceFingerprint, unchangedDuringRun: true },
    collectedPageErrors: unhandled.length, expectedNegativeRecords: { errors: unhandled.length, failedLoads: pages.reduce((sum, page) => sum + page.failedLoads.length, 0), badResponses: pages.reduce((sum, page) => sum + page.badResponses.length, 0) }, unexpectedPageRecords: 0, pageErrorAudit: unhandled, quota: report.quota ?? null, publishedAfter, sites: identities, diagnostics: diagnostics.map(({ childLog, ...rest }) => rest),
  });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "offline-shell-web-smoke.json"), JSON.stringify(report, null, 2));
  console.log("Offline shell smoke passed.");
} catch (error) {
  if (error?.focusDone) {
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, `offline-shell-web-smoke-focus-${focusName}-diagnostic.json`), JSON.stringify({ status: "focus-diagnostic-only", focus: focusName, sourceFingerprint: before?.sourceFingerprint, scenarios: report.scenarios.map(item => ({ name: item.name, ms: item.ms, pages: item.pages })), pageDiagnostics: diagnostics, githubIndexUi: report.githubIndexUi ?? null, workerOnly: report.workerOnly ?? null, quota: report.quota ?? null, limits: report.limits, note: "Not acceptance evidence; the full run is still required." }, null, 2));
    console.log(`Focused ${focusName} diagnostic passed (not acceptance evidence).`);
  } else {
  report.status = "failed"; report.finishedAt = new Date().toISOString();
  report.error = { message: String(error?.message ?? error), stack: String(error?.stack ?? ""), snapshot: error?.snapshot ?? null, pages: error?.pages ?? [] };
  report.diagnostics = diagnostics;
  report.sourceFingerprintBefore = before?.sourceFingerprint ?? null;
  await mkdir(evidence, { recursive: true });
  const failed = join(evidence, "offline-shell-web-smoke-failed-" + report.startedAt.replace(/[:.]/g, "-") + ".json");
  await writeFile(failed, JSON.stringify(report, null, 2)).catch(() => {});
  console.error("Offline shell smoke FAILED; diagnostics preserved in " + failed + "\n" + (error?.stack ?? error));
  process.exitCode = 1;
  }
} finally {
  await stop().catch(() => {});
  for (const child of children) { try { process.kill(child.pid); } catch { /* already exited */ } }
  await rm(fixture, { recursive: true, force: true });
  await rm(shortHome, { recursive: true, force: true });
}
