const { mkdtemp, writeFile, unlink, rmdir } = require("node:fs/promises");
const { join } = require("node:path");
const { webUrl } = require("./web-viewer-policy.cjs");
const { pngSize, faviconData } = require("../shared/web-favicon.cjs");
const MAX_BYTES = 131072;
const MAX_DIMENSION = 256;
const iconLinks = () => {
  const result = [];
  if (document.head) {
    const walker = document.createTreeWalker(document.head, NodeFilter.SHOW_ELEMENT);
    let node;
    for (let index = 0; index < 256 && (node = walker.nextNode()); index++) {
      if (node.tagName === "LINK" && node.rel.toLowerCase().split(/\s+/).includes("icon")) {
        result.push(node.href); if (result.length === 3) { break; }
      }
    }
  }
  return result;
};

function faviconImage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) { throw new Error("Favicon data exceeds the limit."); }
  if (bytes[0] === 137) { return { format: "png", ...pngSize(bytes, MAX_DIMENSION) }; }
  if (bytes.length >= 6 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
    const count = bytes.readUInt16LE(4);
    if (!count || count > 16 || bytes.length < 6 + count * 16) { throw new Error("Invalid favicon ICO."); }
    for (let index = 0; index < count; index++) {
      const entry = 6 + index * 16, width = bytes[entry] || 256, height = bytes[entry + 1] || 256;
      const length = bytes.readUInt32LE(entry + 8), offset = bytes.readUInt32LE(entry + 12);
      if (offset < 6 + count * 16 || length < 33 || offset + length > bytes.length) { throw new Error("Invalid favicon ICO."); }
      const image = bytes.subarray(offset, offset + length);
      if (image[0] === 137) { const size = pngSize(image, MAX_DIMENSION); if (size.width !== width || size.height !== height) { throw new Error("Invalid favicon ICO size."); } }
      else {
        if (image.length < 40 || image.readUInt32LE(0) < 40 || image.readUInt32LE(0) > image.length
          || image.readInt32LE(4) !== width || image.readInt32LE(8) !== height * 2 || image.readUInt16LE(12) !== 1
          || ![1, 4, 8, 24, 32].includes(image.readUInt16LE(14)) || image.readUInt32LE(16) !== 0) { throw new Error("Unsupported favicon ICO bitmap."); }
      }
    }
    return { format: "ico" };
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) { break; }
      while (bytes[offset] === 255) { offset++; }
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) { break; }
      if (marker === 1 || marker >= 208 && marker <= 215) { continue; }
      if (offset + 2 > bytes.length) { break; }
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) { break; }
      if ([192, 193, 194].includes(marker) && length >= 8) {
        const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
        if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) { break; }
        return { format: "jpeg", width, height };
      }
      offset += length;
    }
  }
  throw new Error("Unsupported favicon image.");
}
async function decodeFavicon(bytes, image, nativeImage, temporaryRoot) {
  let decoded;
  if (image.format === "ico") {
    const directory = await mkdtemp(join(temporaryRoot, "slopsidian-favicon-")), path = join(directory, "favicon.ico");
    try { await writeFile(path, bytes, { flag: "wx" }); decoded = nativeImage.createFromPath(path); }
    finally { try { await unlink(path); } finally { await rmdir(directory); } }
  } else { decoded = nativeImage.createFromBuffer(bytes); }
  if (decoded.isEmpty()) { throw new Error("The favicon could not be decoded."); }
  const { width, height } = decoded.getSize();
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) { throw new Error("Favicon dimensions exceed the limit."); }
  const scale = Math.min(32 / width, 32 / height, 1);
  return faviconData(decoded.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" }).toDataURL());
}
async function fetchFavicon(url, fetcher, decode, signal, current) {
  const response = await fetcher(url, { signal, redirect: "error", credentials: "omit" });
  if (!current() || signal.aborted || !response.ok || !response.body) {
    await response.body?.cancel().catch(() => {}); throw new Error("Favicon unavailable.");
  }
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/x-icon", "image/vnd.microsoft.icon", "application/octet-stream"].includes(type)
    || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body.cancel().catch(() => {}); throw new Error("Unsupported favicon response.");
  }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) { break; }
      length += next.value.byteLength;
      if (length > MAX_BYTES || signal.aborted || !current()) { throw new Error("Favicon capture expired or exceeded its limit."); }
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks), image = faviconImage(bytes);
  if (!current() || signal.aborted) { throw new Error("Favicon capture expired."); }
  const data = await decode(bytes, image);
  if (!current() || signal.aborted) { throw new Error("Favicon capture expired."); }
  return faviconData(data);
}
async function captureFavicon(viewer, endpoint, request, isCurrent, nativeImage, temporaryRoot) {
  const contents = viewer.view.webContents, navigationId = viewer.navigationId;
  const url = webUrl(request.url, endpoint, { blank: false });
  const current = () => isCurrent() && !contents.isDestroyed() && viewer.navigationId === navigationId
    && contents.getURL() === url && viewer.committed && !contents.isLoadingMainFrame();
  if (request.navigationId !== navigationId || !current() || viewer.faviconRequested === navigationId) { return null; }
  viewer.faviconRequested = navigationId;
  const controller = new AbortController(); viewer.faviconController?.abort(); viewer.faviconController = controller;
  let timeout;
  const expired = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Favicon capture expired.")), { once: true });
    timeout = setTimeout(() => controller.abort(), 2000);
  });
  try {
    return await Promise.race([expired, (async () => {
      const candidates = await contents.executeJavaScriptInIsolatedWorld(1209, [{ code: "(" + iconLinks.toString() + ")()" }]);
      if (!current() || controller.signal.aborted) { return null; }
      const urls = Array.isArray(candidates) ? candidates.slice(0, 3) : [];
      for (const value of urls) {
        if (controller.signal.aborted || !current()) { return null; }
        try {
          const address = webUrl(value, endpoint, { blank: false });
          return await fetchFavicon(address, (...args) => contents.session.fetch(...args),
            (bytes, image) => decodeFavicon(bytes, image, nativeImage, temporaryRoot), controller.signal, current);
        } catch { /* A missing, blocked or unsupported icon uses the next candidate or the globe. */ }
      }
      return null;
    })()]);
  } catch { return null; }
  finally { clearTimeout(timeout); if (viewer.faviconController === controller) { viewer.faviconController = null; } }
}
module.exports = { MAX_BYTES, faviconImage, fetchFavicon, decodeFavicon, captureFavicon };
