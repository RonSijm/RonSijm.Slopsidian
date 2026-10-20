const { createHash } = require("node:crypto");
const { webUrl } = require("./web-viewer-policy.cjs");
const { loadBundledAdBlocker, loadBundledAdBlockText } = require("./web-adblock.cjs");

const LIST_LIMIT = 4 * 1024 * 1024;
const TOTAL_LIMIT = 12 * 1024 * 1024;
const LIST_COUNT = 16;
const FETCH_TIMEOUT = 20_000;
const REDIRECTS = 3;
const id = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const bundledEngine = () => require("../.runtime/web-adblock/engine.cjs");

function subscriptionUrl(value, endpoint) {
  if (typeof value !== "string" || value.length > 2048) { throw new Error("Enter an HTTP or HTTPS filter list address of at most 2,048 characters."); }
  let url;
  try { url = webUrl(value.trim(), endpoint, { blank: false }); }
  catch (error) { throw new Error("Invalid filter list address. " + error.message); }
  return url;
}

function headerValue(text, name) {
  const match = new RegExp(`^!\\s*${name}\\s*:\\s*(.{1,200})$`, "im").exec(text.slice(0, 8192));
  return match ? match[1].trim() : "";
}

/** Validates downloaded bytes as a filter list; nothing is stored or applied here. */
function reviewList(bytes, url, { inspect = bundledEngine().inspect, now = () => new Date() } = {}) {
  if (!bytes.length) { throw new Error("The filter list is empty."); }
  if (bytes.length > LIST_LIMIT) { throw new Error("The filter list is larger than the 4 MiB limit."); }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("The filter list is not valid UTF-8 text."); }
  text = text.replace(/^\uFEFF/, "");
  if (/\u0000/.test(text)) { throw new Error("The filter list contains binary data."); }
  if (/^\s*<(?:!doctype|html|\?xml)/i.test(text)) { throw new Error("The address returned a web page, not a filter list."); }
  const stats = inspect(text);
  if (stats.network + stats.exceptions + stats.cosmetic === 0) { throw new Error("The filter list contains no supported network or hide rules."); }
  return {
    url, text, sha256: sha256(Buffer.from(text, "utf8")), bytes: Buffer.byteLength(text, "utf8"), stats,
    title: headerValue(text, "Title"), version: headerValue(text, "Version"), retrievedAt: now().toISOString(),
  };
}

/** One explicit user-initiated download: bounded, credential-free and with every redirect re-validated. */
async function fetchSubscription(value, endpoint, { fetchImpl = globalThis.fetch, timeout = FETCH_TIMEOUT, inspect, now } = {}) {
  let url = subscriptionUrl(value, endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    for (let hop = 0; ; hop++) {
      let response;
      try {
        response = await fetchImpl(url, { redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal, headers: { Accept: "text/plain, */*;q=0.1" } });
      } catch (error) {
        throw new Error(controller.signal.aborted ? "The filter list download timed out." : "Could not download the filter list: " + (error?.cause?.message || error?.message || error));
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (hop >= REDIRECTS) { throw new Error("The filter list address redirected too many times."); }
        try { url = subscriptionUrl(new URL(response.headers.get("location"), url).href, endpoint); }
        catch (error) { throw new Error("The filter list redirected to an unsafe address. " + error.message); }
        await response.body?.cancel?.();
        continue;
      }
      if (response.status !== 200) { await response.body?.cancel?.(); throw new Error(`The filter list server returned HTTP ${response.status}.`); }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > LIST_LIMIT) { await response.body?.cancel?.(); throw new Error("The filter list is larger than the 4 MiB limit."); }
      const chunks = []; let total = 0;
      try {
        for await (const chunk of response.body) {
          total += chunk.byteLength;
          if (total > LIST_LIMIT) { controller.abort(); throw new Error("The filter list is larger than the 4 MiB limit."); }
          chunks.push(chunk);
        }
      } catch (error) {
        if (/4 MiB/.test(error.message)) { throw error; }
        throw new Error(controller.signal.aborted ? "The filter list download timed out." : "The filter list download was interrupted.");
      }
      return reviewList(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))), url, { inspect, now });
    }
  } finally { clearTimeout(timer); }
}

function filterSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error("Invalid filter set."); }
  const { generation, root, cosmetic, bundled, lists } = value;
  if (!Number.isSafeInteger(generation) || generation < 1) { throw new Error("Invalid filter set generation."); }
  if (typeof root !== "string" || !root || root.length > 4096 || typeof cosmetic !== "boolean" || typeof bundled !== "boolean" || !Array.isArray(lists) || lists.length > LIST_COUNT) {
    throw new Error("Invalid filter set.");
  }
  const seen = new Set(); let total = 0;
  const accepted = lists.map(list => {
    if (!list || !id(list.id) || seen.has(list.id) || typeof list.text !== "string" || !/^[a-f0-9]{64}$/.test(list.sha256)) { throw new Error("Invalid filter list entry."); }
    seen.add(list.id);
    const bytes = Buffer.byteLength(list.text, "utf8"); total += bytes;
    if (bytes > LIST_LIMIT || total > TOTAL_LIMIT) { throw new Error("The accepted filter lists exceed the size limit."); }
    if (sha256(Buffer.from(list.text, "utf8")) !== list.sha256) { throw new Error(`Filter list "${list.id}" does not match its saved checksum.`); }
    return { id: list.id, sha256: list.sha256, text: list.text };
  });
  return { generation, root, cosmetic, bundled, lists: accepted };
}

/** Shared accepted engine for every Web viewer pane of this window. A failed apply never replaces it. */
class FilterStore {
  constructor({ compile = (texts, options) => bundledEngine().compile(texts, options), bundledText = loadBundledAdBlockText, defaultEngine = loadBundledAdBlocker, onChange = () => {} } = {}) {
    this.compile = compile; this.bundledText = bundledText; this.defaultEngine = defaultEngine; this.onChange = onChange;
    this.generation = 0; this.epoch = 0; this.root = null; this.match = null; this.fingerprint = ""; this.tail = Promise.resolve(); this.info = this.describe(null);
  }
  describe(spec) {
    return spec ? { generation: this.generation, root: this.root, cosmetic: spec.cosmetic, bundled: spec.bundled, lists: spec.lists.map(({ id, sha256 }) => ({ id, sha256 })) }
      : { generation: 0, root: null, cosmetic: false, bundled: true, lists: [] };
  }
  async current() {
    if (this.match) { return this.match; }
    const match = await this.defaultEngine();
    return this.match ?? match;
  }
  reset() { this.epoch++; this.generation = 0; this.root = null; this.match = null; this.fingerprint = ""; this.info = this.describe(null); }
  status() { return { ...this.info }; }
  apply(raw) {
    const spec = filterSpec(raw);
    const run = this.tail.then(() => this.run(spec));
    this.tail = run.catch(() => {});
    return run;
  }
  async run(spec) {
    const epoch = this.epoch;
    const stale = () => new Error(epoch === this.epoch ? "A newer filter update was already applied. Reopen the filter manager and try again." : "The filters were reset while this update was running.");
    if (spec.generation <= this.generation) { throw stale(); }
    const fingerprint = sha256(Buffer.from(JSON.stringify([spec.bundled, spec.cosmetic, spec.lists.map(list => [list.id, list.sha256])])));
    if (fingerprint === this.fingerprint && this.match) {
      this.generation = spec.generation; this.root = spec.root; this.info = this.describe(spec);
      return { ...this.info, changed: false };
    }
    const texts = spec.bundled ? [await this.bundledText()] : [];
    for (const list of spec.lists) { texts.push(list.text); }
    if (epoch !== this.epoch) { throw stale(); }
    const match = this.compile(texts, { cosmetic: spec.cosmetic });
    if (epoch !== this.epoch || spec.generation <= this.generation) { throw stale(); }
    this.match = match; this.generation = spec.generation; this.root = spec.root; this.fingerprint = fingerprint; this.info = this.describe(spec);
    this.onChange(match);
    return { ...this.info, changed: true };
  }
}

module.exports = { FilterStore, fetchSubscription, reviewList, subscriptionUrl, filterSpec, LIST_LIMIT };
