const { webZoomFactor } = require("./web-zoom.cjs");
const SITE_ZOOM_LIMIT = 100;
function siteZoomOrigin(value) {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) { throw new Error("Invalid site zoom address."); }
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin.length > 2048) { throw new Error("Invalid site zoom address."); }
  return url.origin;
}
function siteZoomEntries(value) {
  if (!Array.isArray(value) || value.length > SITE_ZOOM_LIMIT) { throw new Error("Invalid saved site zoom preferences."); }
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || siteZoomOrigin(item.origin) !== item.origin || seen.has(item.origin)) {
      throw new Error("Invalid saved site zoom origin.");
    }
    seen.add(item.origin);
    return { origin: item.origin, factor: webZoomFactor(item.factor) };
  });
}
module.exports = { SITE_ZOOM_LIMIT, siteZoomOrigin, siteZoomEntries };
