// Native proof for explicit Web viewer filter subscriptions and static cosmetic hiding.
// Runs in a hidden Electron window against disposable local HTTP fixtures; never touches the network or a vault.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const { installWebViewer } = require(path.join(root, "desktop", "web-viewer.cjs"));
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
const report = { checks: [], listRequests: 0, pageRequests: {}, errors: [] };
const check = (name, ok, detail = "") => { report.checks.push({ name, ok: Boolean(ok), detail: String(detail) }); if (!ok) { report.failed = true; } };
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const listen = handler => new Promise(resolve => { const server = http.createServer(handler); server.listen(0, "127.0.0.1", () => resolve(server)); });

const LIST_A = "! Title: Fixture A\n! Version: 1\n/ads/banner.js$script\n##.adbox\n127.0.0.1###sponsor\n";
const LIST_B = "! Title: Fixture B\n! Version: 2\n/ads/other.js$script\n##.promo\n";
const PAGE = `<!doctype html><title>Fixture</title><body>
<div id="content" style="height:40px">Real content</div>
<div class="adbox" style="height:40px">Ad</div><div id="sponsor" style="height:40px">Sponsor</div><div class="promo" style="height:40px">Promo</div>
<script>window.bannerLoaded = false; window.otherLoaded = false;</script>
<script src="/ads/banner.js"></script><script src="/ads/other.js"></script>
<script>addEventListener("load", () => { document.title = "loaded:" + window.bannerLoaded + ":" + window.otherLoaded; });</script>`;

async function main() {
  const lists = { "/a.txt": LIST_A, "/b.txt": LIST_B };
  const listServer = await listen((req, res) => {
    if (lists[req.url]) { report.listRequests++; res.setHeader("Content-Type", "text/plain"); res.end(lists[req.url]); return; }
    if (req.url === "/page.html") { report.pageRequests.page = (report.pageRequests.page ?? 0) + 1; res.setHeader("Content-Type", "text/html"); res.end(PAGE); return; }
    if (req.url === "/ads/banner.js") { report.pageRequests.banner = (report.pageRequests.banner ?? 0) + 1; res.setHeader("Content-Type", "text/javascript"); res.end("window.bannerLoaded = true;"); return; }
    if (req.url === "/ads/other.js") { report.pageRequests.other = (report.pageRequests.other ?? 0) + 1; res.setHeader("Content-Type", "text/javascript"); res.end("window.otherLoaded = true;"); return; }
    res.statusCode = 404; res.end("missing");
  });
  const origin = "http://127.0.0.1:" + listServer.address().port;
  const endpointServer = await listen((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>app</title>"); });
  const endpoint = "http://127.0.0.1:" + endpointServer.address().port;
  const preload = path.join(__dirname, ".web-adblock-filters-preload.cjs");
  fs.writeFileSync(preload, 'const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("host", { invoke: (channel, request) => ipcRenderer.invoke(channel, request) });');

  await app.whenReady();
  const make = () => new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const window = make();
  await window.loadURL(endpoint + "/");
  installWebViewer(window, endpoint);
  const call = (channel, request, target = window) => target.webContents.executeJavaScript(`host.invoke(${JSON.stringify(channel)}, ${JSON.stringify(request)}).then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error && error.message || error) }))`);
  const filters = request => call("webviewer:filters", request);
  const viewerRequest = (id, request) => call("webviewer:request", { id, ...request });
  const views = () => window.contentView.children.map(view => view.webContents);
  const probe = (contents, code) => contents.executeJavaScript(code);
  const settle = async (contents, expectedTitle) => {
    for (let i = 0; i < 100; i++) { if (!contents.isLoading() && contents.getTitle() === expectedTitle) { await wait(250); return; } await wait(100); }
  };
  const hidden = (contents, selector) => probe(contents, `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display`);
  const open = async (id, enable = true) => {
    const before = new Set(views());
    const created = await viewerRequest(id, { action: "create", url: origin + "/page.html", enableAdblocking: enable });
    if (!created.ok) { throw new Error("create failed: " + created.error); }
    return views().find(view => !before.has(view));
  };
  const idA = crypto.randomUUID(), idB = crypto.randomUUID();

  // 1. No subscription traffic until explicitly asked; default state has no custom lists.
  const viewerA = await open(idA);
  await settle(viewerA, "loaded:true:true");
  check("default engine leaves custom ad-path scripts loaded", await probe(viewerA, "document.title") === "loaded:true:true");
  check("default engine hides nothing", await hidden(viewerA, ".adbox") !== "none");
  check("no list request happened without an explicit fetch", report.listRequests === 0, report.listRequests);

  // 2. Explicit download is a single reviewed fetch and applies nothing.
  const review = await filters({ action: "fetch", url: origin + "/a.txt" });
  check("fetch returns a reviewed list", review.ok && review.value.sha256 === sha(LIST_A) && review.value.stats.network === 1 && review.value.stats.cosmetic >= 1 && review.value.title === "Fixture A", JSON.stringify(review));
  check("exactly one list request after one explicit fetch", report.listRequests === 1, report.listRequests);
  check("fetch alone does not change the engine", (await filters({ action: "status" })).value.generation === 0);
  check("endpoint origin is refused as a list address", (await filters({ action: "fetch", url: endpoint + "/a.txt" })).ok === false);
  check("non-http list addresses are refused", (await filters({ action: "fetch", url: "file:///c:/windows/win.ini" })).ok === false);
  check("refused addresses make no request", report.listRequests === 1, report.listRequests);

  // 3. Apply: hot-swaps the open pane (cosmetics immediately) and affects a new pane's network requests.
  const set1 = { generation: 1, root: "vault-one", cosmetic: true, bundled: false, lists: [{ id: "fixture-a", text: LIST_A, sha256: sha(LIST_A) }] };
  const applied = await filters({ action: "apply", filters: set1 });
  check("apply reports changed", applied.ok && applied.value.changed === true && applied.value.generation === 1, JSON.stringify(applied));
  await wait(1200);
  check("open pane hides ads without reload", await hidden(viewerA, ".adbox") === "none" && await hidden(viewerA, "#sponsor") === "none");
  check("real content stays visible", await hidden(viewerA, "#content") !== "none" && await hidden(viewerA, ".promo") !== "none");
  const bannerBefore = report.pageRequests.banner;
  const viewerB = await open(idB);
  await settle(viewerB, "loaded:false:true");
  check("new pane blocks the listed script at the network layer", await probe(viewerB, "document.title") === "loaded:false:true" && report.pageRequests.banner === bannerBefore, await probe(viewerB, "document.title"));
  check("new pane hides cosmetic elements", await hidden(viewerB, ".adbox") === "none");
  await wait(500);
  await viewerRequest(idA, { action: "reload" });
  await settle(viewerA, "loaded:false:true");
  check("reloaded older pane now blocks the script too", await probe(viewerA, "document.title") === "loaded:false:true");
  check("reloaded older pane keeps hiding", await hidden(viewerA, ".adbox") === "none");

  // 4. Failures keep the accepted engine.
  const tampered = await filters({ action: "apply", filters: { ...set1, generation: 2, lists: [{ id: "fixture-a", text: LIST_A + "x\n", sha256: sha(LIST_A) }] } });
  check("checksum mismatch is refused", tampered.ok === false && /checksum/.test(tampered.error), tampered.error);
  const stale = await filters({ action: "apply", filters: { ...set1, generation: 1 } });
  check("stale generation is refused", stale.ok === false && /newer/.test(stale.error), stale.error);
  const oversize = await filters({ action: "apply", filters: { ...set1, generation: 5, lists: [{ id: "big", text: "a".repeat(4 * 1024 * 1024 + 1), sha256: sha("a".repeat(4 * 1024 * 1024 + 1)) }] } });
  check("oversized list is refused", oversize.ok === false && /limit/.test(oversize.error), oversize.error);
  check("failed applies keep generation and engine", (await filters({ action: "status" })).value.generation === 1);
  await viewerRequest(idB, { action: "reload" });
  await settle(viewerB, "loaded:false:true");
  check("blocking still uses the previously accepted engine", await probe(viewerB, "document.title") === "loaded:false:true" && await hidden(viewerB, ".adbox") === "none");

  // 5. Switch lists; old rules stop applying and the pane updates without reload.
  const set2 = { generation: 2, root: "vault-one", cosmetic: true, bundled: false, lists: [{ id: "fixture-b", text: LIST_B, sha256: sha(LIST_B) }] };
  check("second list applies", (await filters({ action: "apply", filters: set2 })).value.changed === true);
  await wait(1200);
  check("old cosmetic rules are removed and new ones applied", await hidden(viewerB, ".adbox") !== "none" && await hidden(viewerB, ".promo") === "none");
  await viewerRequest(idB, { action: "reload" });
  await settle(viewerB, "loaded:true:false");
  check("network rules follow the new list", await probe(viewerB, "document.title") === "loaded:true:false");

  // 6. Cosmetic off removes hiding; reset returns to defaults.
  check("cosmetic off applies", (await filters({ action: "apply", filters: { ...set2, generation: 3, cosmetic: false } })).value.changed === true);
  await wait(800);
  check("cosmetic off shows elements again", await hidden(viewerB, ".promo") !== "none");
  check("cosmetic off keeps network blocking", (await filters({ action: "status" })).value.cosmetic === false);

  // 7. Only the application window may control filters.
  const foreign = make();
  await foreign.loadURL(endpoint + "/");
  const foreignResult = await call("webviewer:filters", { action: "status" }, foreign);
  check("foreign window cannot use filter IPC", foreignResult.ok === false && /local application/.test(foreignResult.error), foreignResult.error);
  const foreignView = await call("webviewer:filters", { action: "fetch", url: origin + "/a.txt" }, foreign);
  check("foreign window cannot trigger downloads", foreignView.ok === false && report.listRequests === 1, report.listRequests);
  foreign.destroy();
  check("viewer pages have no filter IPC", await probe(viewerA, "typeof host") === "undefined");

  // 8. Reset (vault change/closing) returns to defaults and accepts generation 1 again.
  const reset = await filters({ action: "reset" });
  check("reset clears the shared engine", reset.ok && reset.value.generation === 0 && reset.value.lists.length === 0);
  check("generation restarts after reset", (await filters({ action: "apply", filters: { ...set1, generation: 1, root: "vault-two" } })).value.root === "vault-two");
  check("listRequests unchanged by applies", report.listRequests === 1, report.listRequests);

  fs.rmSync(preload, { force: true });
  window.destroy(); listServer.close(); endpointServer.close();
}

main().catch(error => { report.errors.push(String(error && error.stack || error)); report.failed = true; }).finally(() => {
  const out = process.argv.find(arg => arg.startsWith("--report="))?.slice(9);
  const text = JSON.stringify(report, null, 2);
  if (out) { fs.writeFileSync(out, text); }
  process.stdout.write(text + "\n");
  app.exit(report.failed ? 1 : 0);
});
