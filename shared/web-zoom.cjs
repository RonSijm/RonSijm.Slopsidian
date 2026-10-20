const WEB_ZOOM_MIN = 0.5;
const WEB_ZOOM_MAX = 3;

function webZoomFactor(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < WEB_ZOOM_MIN || value > WEB_ZOOM_MAX) {
    throw new Error("Web page zoom must be a number between 50% and 300%.");
  }
  return value;
}

function nextWebZoom(value, action) {
  const factor = webZoomFactor(value);
  if (!["in", "out", "reset"].includes(action)) { throw new Error("Choose zoom in, zoom out or reset zoom."); }
  return action === "reset" ? 1 : Math.max(WEB_ZOOM_MIN, Math.min(WEB_ZOOM_MAX, Math.round((factor + (action === "in" ? 0.1 : -0.1)) * 100) / 100));
}

function webZoomShortcut(key) {
  return key === "+" || key === "=" ? "in" : key === "-" ? "out" : key === "0" ? "reset" : null;
}

module.exports = { WEB_ZOOM_MIN, WEB_ZOOM_MAX, webZoomFactor, nextWebZoom, webZoomShortcut };
