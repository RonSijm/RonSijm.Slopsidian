// Narrow per-case audit of everything a smoke page recorded, including events that arrive during teardown.
const hit = (matcher, text, item) => typeof matcher === "function" ? matcher(item) : matcher.test(text ?? "");
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact same-origin asset URL (a query string is tolerated, a different path is not). */
export const exactUrl = (origin, path) => new RegExp("^" + escape(origin.replace(/\/$/, "")) + "/" + escape(path.replace(/^\//, "")) + "(\\?[^#]*)?$");

/** Returns every recorded item the case policy does not explicitly allow; an empty result is a clean page. */
export function auditPage({ errors, failures, badResponses, requests, origin }, { errors: allowedErrors = [], failures: allowedFailures = [], aborted = [], responses: allowedResponses = [] } = {}) {
  return {
    errors: errors.filter(error => !allowedErrors.some(matcher => hit(matcher, error.text, error))),
    failures: failures.filter(item => !allowedFailures.some(matcher => hit(matcher, item.url, item)) && !(item.error === "net::ERR_ABORTED" && aborted.some(matcher => hit(matcher, item.url, item)))),
    responses: badResponses.filter(item => !allowedResponses.some(matcher => hit(matcher, item.url, item))),
    external: requests.filter(url => /^https?:/.test(url) && new URL(url).origin !== origin),
  };
}

/** Resolves only when the app is ready, no tracked request is in flight and no new request started for quietMs; otherwise throws with the pending URLs. */
export async function settlePage({ started, active, urls, ready, quietMs = 2000, timeout = 30000, poll = 250 }) {
  const end = Date.now() + timeout; let count = started(), since = Date.now(), isReady = false;
  while (Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, poll));
    isReady = Boolean(await ready());
    if (started() !== count) { count = started(); since = Date.now(); }
    else if (isReady && active().size === 0 && Date.now() - since >= quietMs) { return; }
  }
  throw new Error(`Timed out waiting for the page to settle (ready ${isReady}, ${active().size} request(s) in flight: ${[...active()].map(id => urls(id)).slice(0, 5).join(", ")}; ${count} started).`);
}
/** The required native runtime WASM from the manifest paths; never falls back to an arbitrary assembly. */
export function selectRuntimeWasm(paths) {
  const found = paths.filter(path => /^_framework\/dotnet\.native(\.[0-9a-z]+)?\.wasm$/i.test(path));
  if (found.length !== 1) { throw new Error(`Expected exactly one dotnet.native WebAssembly file in the manifest, found ${found.length}.`); }
  return found[0];
}
/** The SDK boot-resource cache name the published dotnet.runtime.js opens for an app base. */
export const sdkBootCacheName = (baseURI, origin) => "dotnet-resources" + baseURI.substring(origin.length);
/** Self-contained (serialized into the page): clears only the named SDK boot cache, recording matching copies of the target before and verifying deletion; failures are explicit. */
export async function clearSdkBootCache(cacheStorage, name, targetFile) {
  const hex = async response => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await response.arrayBuffer()))).map(x => x.toString(16).padStart(2, "0")).join("");
  const before = (await cacheStorage.keys()).includes(name), record = { name, existedBefore: before, matchingBefore: [], deleted: false, existsAfter: false };
  if (!before) { return record; }
  const cache = await cacheStorage.open(name);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.split("/").pop() === targetFile || request.url.split(/[?#]/)[0].endsWith("/" + targetFile)) {
      const response = await cache.match(request);
      record.matchingBefore.push({ url: request.url, sha256: response ? await hex(response) : null });
    }
  }
  record.deleted = await cacheStorage.delete(name);
  record.existsAfter = (await cacheStorage.keys()).includes(name);
  if (!record.deleted || record.existsAfter) { throw new Error(`The SDK boot cache ${name} could not be deleted (deleted ${record.deleted}, still present ${record.existsAfter}).`); }
  return record;
}
export const isClean = unexpected => Object.values(unexpected).every(list => list.length === 0);
/** Page expression recording the offline panel's own open/inert/dialog/hit-target state, to discriminate an already-open panel from true pointer blocking. */
export const panelProbeExpression = `(() => { const root = document.getElementById("offline-shell"); if (!root) { return { present: false }; } const summary = root.querySelector("summary"), box = summary.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2, hit = document.elementFromPoint(x, y); return { present: true, open: root.open, hidden: root.hidden, inert: Boolean(root.closest("[inert]")), openDialogs: document.querySelectorAll("dialog[open]").length, summaryHit: hit === summary || summary.contains(hit) ? "summary" : hit ? hit.tagName + "." + hit.className : null, state: root.dataset.offlineState ?? "", error: root.dataset.offlineError ?? "", status: root.querySelector("[data-offline-status]")?.textContent ?? "" }; })()`;

/** True only when `at` falls inside the window that follows a recorded action (a real Cancel, a deliberate reload, the quit). */
export const withinBoundary = (marks, at, names, windowMs = 5000) => typeof at === "number" && marks.some(mark => names.includes(mark.name) && at >= mark.at && at <= mark.at + windowMs);
