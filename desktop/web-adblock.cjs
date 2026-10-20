const { readFile } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const { webUrl } = require("./web-viewer-policy.cjs");
const provenance = require("../vendor/easylist/provenance.json");

let engine;
function verifiedAdBlockList(bytes) {
  if (bytes.length > 8 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== provenance.sha256["easylist.txt"]) {
    throw new Error("The bundled ad-blocking list failed verification.");
  }
  return bytes.toString("utf8");
}
function loadBundledAdBlocker() {
  if (!engine) {
    engine = readFile(join(__dirname, "../vendor/easylist/easylist.txt")).then(bytes => {
      return require("../.runtime/web-adblock/engine.cjs").parse(verifiedAdBlockList(bytes));
    }).catch(error => { engine = null; throw error; });
  }
  return engine;
}

function adBlockingFlag(value) {
  if (typeof value !== "boolean") { throw new Error("Ad blocking must be a Boolean."); }
  return value;
}

class WebAdBlock {
  constructor(endpoint, notify, load = loadBundledAdBlocker) {
    this.endpoint = endpoint; this.notify = notify; this.load = load;
    this.enabled = false; this.status = "off"; this.blockedRequests = 0; this.revision = 0;
    this.match = null; this.disposed = false; this.timer = null;
  }
  snapshot() {
    return { enabled: this.enabled, status: this.status, blockedRequests: this.blockedRequests, revision: this.revision };
  }
  async configure(value) {
    adBlockingFlag(value);
    if (this.disposed) { throw new Error("This Web viewer has closed."); }
    if (value === this.enabled && ["on", "off"].includes(this.status)) { return this.snapshot(); }
    const revision = ++this.revision;
    this.enabled = value; this.match = null; this.status = value ? "loading" : "off"; this.notify();
    if (value) {
      try {
        const match = await this.load();
        if (!this.disposed && this.revision === revision) { this.match = match; this.status = "on"; this.notify(); }
      } catch (error) {
        if (!this.disposed && this.revision === revision) {
          this.status = "unavailable"; this.notify();
          console.error("Could not load bundled Web viewer ad filters:", error);
        }
      }
    }
    return this.snapshot();
  }
  request(details) {
    // One native listener owns both policies. Filter exceptions can never bypass the vault/scheme guard.
    if (this.disposed) { return { cancel: true }; }
    try { webUrl(details.url, this.endpoint, { sockets: true, resources: details.resourceType !== "mainFrame" }); }
    catch { return { cancel: true }; }
    if (details.resourceType === "mainFrame" || !this.enabled) { return { cancel: false }; }
    // Pause subresources while requested protection is preparing or unavailable.
    if (!this.match) { return { cancel: true }; }
    try {
      if (!this.match(details)) { return { cancel: false }; }
    } catch (error) {
      this.match = null; this.status = "unavailable"; this.notify();
      console.error("Web viewer ad filtering failed:", error); return { cancel: true };
    }
    this.blockedRequests = Math.min(Number.MAX_SAFE_INTEGER, this.blockedRequests + 1);
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; if (!this.disposed) { this.notify(); } }, 100); }
    return { cancel: true };
  }
  reset() { this.blockedRequests = 0; clearTimeout(this.timer); this.timer = null; }
  dispose() { this.disposed = true; this.revision++; this.match = null; clearTimeout(this.timer); this.timer = null; }
}

module.exports = { WebAdBlock, loadBundledAdBlocker, adBlockingFlag, verifiedAdBlockList };
