const { webZoomFactor, nextWebZoom } = require("../shared/web-zoom.cjs");

function setWebZoom(viewer, value) {
  const factor = webZoomFactor(value);
  const contents = viewer.view.webContents;
  if (contents.isDestroyed()) { throw new Error("This Web viewer has closed."); }
  // Set the native surface before acknowledging the desired value. Navigation
  // reapplies it because Chromium otherwise keeps its own per-origin zoom.
  contents.setZoomFactor(factor);
  if (factor !== viewer.zoomFactor) { viewer.zoomRevision++; }
  viewer.zoomFactor = factor;
  return { zoomFactor: factor, zoomRevision: viewer.zoomRevision };
}

function requestWebZoom(viewer, request) {
  if (!request || typeof request !== "object" || Object.hasOwn(request, "factor") === Object.hasOwn(request, "change")) {
    throw new Error("Specify either a zoom factor or a zoom action.");
  }
  return setWebZoom(viewer, Object.hasOwn(request, "factor") ? request.factor : nextWebZoom(viewer.zoomFactor, request.change));
}

module.exports = { setWebZoom, requestWebZoom };
