const FAVICON_LIMIT = 100;
const FAVICON_DATA_LIMIT = 16384;
function faviconOrigin(value) {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) { throw new Error("Invalid favicon address."); }
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin.length > 2048) { throw new Error("Invalid favicon address."); }
  return url.origin;
}
function pngSize(bytes, maximum = 32) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)
    || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
    || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) { throw new Error("Invalid favicon PNG."); }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
  if (width < 1 || height < 1 || width > maximum || height > maximum) { throw new Error("Favicon dimensions exceed the limit."); }
  return { width, height };
}
function faviconData(value) {
  if (typeof value !== "string" || value.length > FAVICON_DATA_LIMIT || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) { throw new Error("Invalid favicon image."); }
  const base64 = value.slice(22);
  if (base64.length % 4) { throw new Error("Invalid favicon image."); }
  pngSize(Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
  return value;
}
module.exports = { FAVICON_LIMIT, FAVICON_DATA_LIMIT, faviconOrigin, faviconData, pngSize };
