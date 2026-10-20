const WORLD = 1049;
// Reads only class names, ids and link targets; the page cannot supply code to the isolated world.
const SCAN = `(() => {
  const take = (nodes, read, limit) => { const out = new Set(); let visited = 0; for (const node of nodes) { if (++visited > 5000) { break; } const value = read(node); if (value && value.length <= 256) { out.add(value); if (out.size >= limit) { break; } } } return [...out]; };
  const classes = new Set(), ids = new Set();
  let visited = 0;
  for (const node of document.querySelectorAll("[class],[id]")) {
    if (++visited > 20000) { break; }
    if (typeof node.id === "string" && node.id && node.id.length <= 256 && ids.size < 1000) { ids.add(node.id); }
    if (node.classList) { for (const name of node.classList) { if (name.length <= 256 && classes.size < 2000) { classes.add(name); } } }
    if (classes.size >= 2000 && ids.size >= 1000) { break; }
  }
  return { classes: [...classes], ids: [...ids], hrefs: take(document.querySelectorAll("a[href]"), node => node.getAttribute("href"), 500) };
})()`;
/**
 * Hides ad elements in the top-level document with static author-independent CSS from the accepted engine.
 * Scriptlets, extended selectors and page script injection are never used.
 */
async function applyCosmetics(viewer, contents, isCurrent, { scan = true } = {}) {
  const generation = viewer.cosmeticGeneration = (viewer.cosmeticGeneration ?? 0) + 1;
  const stale = () => !isCurrent() || contents.isDestroyed() || viewer.cosmeticGeneration !== generation;
  try {
    const url = contents.getURL();
    const first = viewer.adBlocking.cosmetics(url);
    if (!first) { await clearCosmetics(viewer, contents); return; }
    let result = first;
    if (scan) {
      let dom = null;
      try { dom = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCAN }]); } catch { /* Hostname and generic rules still apply. */ }
      if (stale()) { return; }
      if (dom && typeof dom === "object") { result = viewer.adBlocking.cosmetics(contents.getURL(), dom) ?? first; }
    }
    if (stale() || contents.getURL() !== url) { return; }
    const previous = viewer.cosmeticKey;
    const key = result.styles ? await contents.insertCSS(result.styles) : null;
    if (stale()) { if (key) { await removal(contents, key, viewer, "discarded"); } return; }
    viewer.cosmeticKey = key;
    let issue = "";
    if (previous && previous !== key) { issue = await removal(contents, previous, viewer, "previous"); }
    viewer.adBlocking.cosmeticApplied(result.rules, issue);
  } catch (error) {
    // The last accepted stylesheet stays owned (cosmeticKey unchanged) when a replacement could not be inserted.
    if (!stale()) { viewer.adBlocking.cosmeticApplied(0, "Cosmetic filtering failed: " + (error?.message || error)); }
  }
}

/** Removes a stylesheet and returns a visible message instead of hiding failures. */
async function removal(contents, key, viewer, label) {
  if (contents.isDestroyed()) { return ""; }
  try { await contents.removeInsertedCSS(key); return ""; }
  catch (error) { return `Could not remove ${label} cosmetic styles: ${error?.message || error}`; }
}

async function clearCosmetics(viewer, contents) {
  const generation = viewer.cosmeticGeneration = (viewer.cosmeticGeneration ?? 0) + 1;
  const key = viewer.cosmeticKey;
  const issue = key ? await removal(contents, key, viewer, "active") : "";
  if (viewer.cosmeticGeneration !== generation) { return; }
  if (!issue) { viewer.cosmeticKey = null; }
  viewer.adBlocking.cosmeticApplied(0, issue);
}

module.exports = { applyCosmetics, clearCosmetics };
