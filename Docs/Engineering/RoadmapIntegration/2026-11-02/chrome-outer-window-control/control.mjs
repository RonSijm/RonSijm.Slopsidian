import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtime = "D:\\RonSijm\\RonSijm.Slopsidian\\.runtime";
assert.equal((await realpath(runtime)).toLowerCase(), resolve(runtime).toLowerCase(), "the owned runtime must not traverse a link");
const profile = await mkdtemp(join(runtime, "browser-window-control-"));
assert.equal(dirname(await realpath(profile)).toLowerCase(), runtime.toLowerCase());
const result = {
  profile, boundary: "Installed Chrome, fresh owned profile and loopback empty page only; no application/reference/personal profile. Reopen uses authoritative Browser bounds; background about:blank DOM outer metrics can be stale and are diagnostic only.",
  controlSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
  cases: [],
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'" });
  response.end("<!doctype html><title>Owned browser geometry control</title><p>Empty geometry control</p>");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}/`;
let child, exited, browser, page;
let log = "";
async function connect(address) {
  const parsed = new URL(address);
  assert.equal(parsed.protocol, "ws:");
  assert.equal(parsed.hostname, "127.0.0.1");
  const socket = new WebSocket(address), pending = new Map();
  let next = 0;
  const rejectAll = error => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  socket.addEventListener("message", event => {
    const response = JSON.parse(String(event.data)), request = pending.get(response.id);
    if (!request) { return; }
    pending.delete(response.id); clearTimeout(request.timer);
    if (response.error) { request.reject(new Error(JSON.stringify(response.error))); } else { request.resolve(response.result); }
  });
  socket.addEventListener("close", () => rejectAll(new Error("Owned Chrome CDP closed.")));
  socket.addEventListener("error", () => rejectAll(new Error("Owned Chrome CDP error.")));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Owned Chrome CDP open timed out.")); }, 5000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Owned Chrome CDP open failed.")); }, { once: true });
  });
  return {
    close: () => socket.close(),
    command(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Owned Chrome CDP deadline: " + method)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}
try {
  child = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--user-data-dir=" + profile, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--disable-extensions", "--disable-default-apps", "--disable-domain-reliability",
    "--disable-client-side-phishing-detection", "--safebrowsing-disable-auto-update", "--metrics-recording-only",
    "--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication", "--new-window", url,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  assert.ok(child.pid > 0);
  result.pid = child.pid;
  exited = once(child, "exit");
  child.stderr.on("data", bytes => { log = (log + bytes).slice(-20000); });
  let launchError;
  child.on("error", error => { launchError = error; });
  let portText;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError) { throw launchError; }
    if (child.exitCode !== null) { throw new Error("Owned Chrome exited before CDP: " + child.exitCode); }
    try { portText = await readFile(join(profile, "DevToolsActivePort"), "utf8"); break; }
    catch (error) { if (error.code !== "ENOENT") { throw error; } }
    await pause(50);
  }
  assert.ok(portText, "owned Chrome CDP startup has a deadline");
  const [port, browserPath] = portText.trim().split(/\r?\n/);
  assert.match(port, /^\d+$/); assert.match(browserPath, /^\/devtools\/browser\/[a-zA-Z0-9-]+$/);
  browser = await connect(`ws://127.0.0.1:${port}${browserPath}`);
  result.version = await browser.command("Browser.getVersion");
  let target;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    assert.ok(response.ok);
    target = (await response.json()).find(item => item.type === "page" && item.url === url);
    if (target) { break; }
    await pause(50);
  }
  assert.ok(target, "only the owned loopback page may be controlled");
  page = await connect(target.webSocketDebuggerUrl);
  const evaluate = async expression => {
    const response = await page.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) { throw new Error(JSON.stringify(response.exceptionDetails)); }
    return response.result.value;
  };
  const until = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await predicate()) { return; } await pause(50); }
    throw new Error("Owned Chrome readiness deadline: " + label);
  };
  await until(() => evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==="complete"`), "the loopback document has committed");
  result.initialPage = await evaluate("({url:location.href,ready:document.readyState})");
  for (const normalize of [false, true]) {
    let requested = { x: 160, y: 120, width: 723, height: 603 };
    for (let generation = 0; generation < 3; generation++) {
      const features = `popup=yes,left=${requested.x},top=${requested.y},width=${requested.width},height=${requested.height}`;
      const opened = await evaluate(`(()=>{const w=window.geometryPopup=window.open("about:blank","owned-geometry-${normalize}-${generation}",${JSON.stringify(features)});if(!w)return false;w.document.title="Owned popup geometry control";w.document.body.textContent="Empty popup control";${normalize ? `w.resizeTo(${requested.width},${requested.height});w.moveTo(${requested.x},${requested.y});` : ""}return true})()`);
      assert.equal(opened, true);
      const item = { normalize, generation, requested, samples: [] };
      result.cases.push(item);
      for (const delay of [100, 500]) {
        await pause(delay);
        const dom = await evaluate("(()=>{const w=window.geometryPopup;return{x:w.screenX,y:w.screenY,width:w.outerWidth,height:w.outerHeight,innerWidth:w.innerWidth,innerHeight:w.innerHeight,dpr:w.devicePixelRatio}})()");
        const targets = await browser.command("Target.getTargets");
        const popup = targets.targetInfos.filter(item => item.type === "page" && item.openerId === target.id && item.url === "about:blank");
        assert.equal(popup.length, 1);
        const native = await browser.command("Browser.getWindowForTarget", { targetId: popup[0].targetId });
        item.samples.push({ delay, dom, native });
      }
      const bounds = item.samples.at(-1).native.bounds;
      requested = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
      await evaluate("window.geometryPopup.close();true");
      await until(() => evaluate("window.geometryPopup.closed"), "the owned popup is closed before another generation");
    }
  }
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error.stack ?? error);
} finally {
  if (browser) {
    try { await browser.command("Browser.close"); }
    catch (error) { result.closeError = String(error.message ?? error); }
  }
  if (child && child.exitCode === null) {
    const outcome = await Promise.race([exited, pause(10000).then(() => null)]);
    if (outcome) { result.exit = { code: outcome[0], signal: outcome[1], forced: false }; }
    else {
      result.ok = false;
      result.forcedCleanup = true;
      child.kill();
      const forced = await Promise.race([exited, pause(5000).then(() => null)]);
      result.exit = forced ? { code: forced[0], signal: forced[1], forced: true } : { error: "Owned Chrome did not exit after bounded cleanup." };
    }
  } else if (child) { result.exit = { code: child.exitCode, signal: child.signalCode, forced: false }; }
  page?.close(); browser?.close();
  server.close();
  result.browserLog = log;
  await writeFile(join(profile, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ profile, ok: result.ok, exit: result.exit, error: result.error, version: result.version, cases: result.cases.map(item => ({ normalize: item.normalize, generation: item.generation, requested: item.requested, dom: item.samples.at(-1)?.dom, native: item.samples.at(-1)?.native })) }));
  process.exitCode = result.ok && result.exit?.code === 0 && !result.exit.forced ? 0 : 1;
}
