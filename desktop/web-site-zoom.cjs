const { siteZoomOrigin, siteZoomEntries } = require("../shared/web-site-zoom.cjs");
const { setWebZoom } = require("./web-zoom.cjs");
function siteZoomPreferences(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) { throw new Error("Invalid site zoom revision."); }
  return { revision: value.revision, entries: siteZoomEntries(value.entries) };
}
function applySiteZoom(viewer) {
  let origin;
  try { origin = siteZoomOrigin(viewer.url); } catch { return; }
  const entry = viewer.siteZoom.entries.find(item => item.origin === origin);
  if (entry) { return setWebZoom(viewer, entry.factor); }
}
function updateSiteZoom(viewer, request) {
  const next = siteZoomPreferences(request);
  const applyOrigin = request.applyOrigin === undefined ? null : siteZoomOrigin(request.applyOrigin);
  if (applyOrigin !== null && applyOrigin !== request.applyOrigin) { throw new Error("Invalid site zoom application origin."); }
  if (next.revision <= viewer.siteZoom.revision) { return { zoomFactor: viewer.zoomFactor, zoomRevision: viewer.zoomRevision }; }
  let origin;
  try { origin = siteZoomOrigin(viewer.url); } catch { /* A blank page still receives the saved map. */ }
  const previous = viewer.siteZoom.entries.find(item => item.origin === origin)?.factor;
  viewer.siteZoom = next;
  const saved = next.entries.find(item => item.origin === origin)?.factor;
  if (viewer.committed && saved !== undefined && (saved !== previous || applyOrigin === origin)) { applySiteZoom(viewer); }
  return { zoomFactor: viewer.zoomFactor, zoomRevision: viewer.zoomRevision };
}
module.exports = { siteZoomPreferences, applySiteZoom, updateSiteZoom };
