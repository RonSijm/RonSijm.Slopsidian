// Shared by the Electron host and its focused boundary tests.
function webUrl(value, endpoint, { blank = true, sockets = false, resources = false } = {}) {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Enter a valid HTTP or HTTPS address.");
  }
  if (blank && value === "about:blank") { return value; }
  const url = new URL(value);
  const protocols = sockets ? ["http:", "https:", "ws:", "wss:"] : ["http:", "https:"];
  if (resources && ["data:", "blob:"].includes(url.protocol)) { return url.href; }
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error("Web viewer only opens HTTP and HTTPS pages without embedded credentials.");
  }
  const local = new URL(endpoint);
  const loopback = /^(?:localhost\.?|127(?:\.\d{1,3}){3}|\[::1\])$/i;
  if (url.port === local.port && (url.hostname === local.hostname || loopback.test(url.hostname))) {
    throw new Error("Web viewer cannot access the local application or vault service.");
  }
  return url.href;
}

function viewBounds(value, size, zoom = 1) {
  if (!value || typeof value.visible !== "boolean") { throw new Error("Invalid Web viewer visibility."); }
  if (!value.visible) { return null; }
  const { x, y, width, height } = value;
  if (![x, y, width, height, zoom].every(Number.isFinite) || width < 0 || height < 0 || zoom <= 0) {
    throw new Error("Invalid Web viewer bounds.");
  }
  const left = Math.max(0, Math.min(size[0], Math.round(x * zoom)));
  const top = Math.max(0, Math.min(size[1], Math.round(y * zoom)));
  const right = Math.max(left, Math.min(size[0], Math.round((x + width) * zoom)));
  const bottom = Math.max(top, Math.min(size[1], Math.round((y + height) * zoom)));
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

module.exports = { webUrl, viewBounds };
