const ascii = (bytes: Uint8Array, offset: number, value: string): boolean => [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
/** Bound decoded allocation before asking the image decoder to inspect any raster. */
export function canvasRasterDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  const dimensions = (nextWidth: number, nextHeight: number): void => {
    if (!Number.isSafeInteger(nextWidth) || !Number.isSafeInteger(nextHeight) || nextWidth < 1 || nextHeight < 1 || nextWidth > 4096 || nextHeight > 4096 || nextWidth * nextHeight > 16_000_000) { throw new Error("Local export images require valid static PNG, JPEG or WebP dimensions up to 4,096 per side and 16,000,000 pixels."); }
    if (width && (width !== nextWidth || height !== nextHeight)) { throw new Error("The WebP canvas and bitstream dimensions disagree."); }
    width = nextWidth; height = nextHeight;
  };
  if (mime === "image/png" && bytes.length >= 33 && view.getUint32(8) === 13 && ascii(bytes, 12, "IHDR")) {
    width = view.getUint32(16); height = view.getUint32(20);
    for (let i = 8; i + 12 <= bytes.length;) { const size = view.getUint32(i); if (size > bytes.length - i - 12) { throw new Error("The PNG contains an invalid chunk."); } if (ascii(bytes, i + 4, "acTL")) { throw new Error("Animated PNG is not included. Use a static PNG."); } i += size + 12; }
  } else if (mime === "image/jpeg") {
    for (let i = 2; i + 4 <= bytes.length;) {
      if (bytes[i++] !== 0xff) { break; } while (bytes[i] === 0xff) { i++; }
      const marker = bytes[i++]; if (marker === 0xd9 || marker === 0xda) { break; } if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) { continue; }
      if (i + 2 > bytes.length) { break; } const length = view.getUint16(i); if (length < 2 || i + length > bytes.length) { break; }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) { height = view.getUint16(i + 3); width = view.getUint16(i + 5); break; } i += length;
    }
  } else if (mime === "image/webp" && bytes.length >= 20 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP") && view.getUint32(4, true) === bytes.length - 8) {
    for (let i = 12; i + 8 <= bytes.length;) {
      const length = view.getUint32(i + 4, true), start = i + 8; if (length > bytes.length - start) { throw new Error("The WebP contains an invalid chunk."); }
      if (ascii(bytes, i, "ANIM") || ascii(bytes, i, "ANMF") || ascii(bytes, i, "VP8X") && length >= 10 && (bytes[start] & 2)) { throw new Error("Animated WebP is not included. Use a static image."); }
      if (ascii(bytes, i, "VP8X") && length >= 10) { dimensions(1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16), 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16)); }
      if (ascii(bytes, i, "VP8 ") && length >= 10 && ascii(bytes, start + 3, "\x9d\x01\x2a")) { dimensions(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff); }
      if (ascii(bytes, i, "VP8L") && length >= 5 && bytes[start] === 0x2f) { const bits = view.getUint32(start + 1, true); dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); } i = start + length + (length & 1);
    }
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) { throw new Error("Local export images require valid static PNG, JPEG or WebP dimensions up to 4,096 per side and 16,000,000 pixels."); }
  return { width, height };
}

/** Exported WebP must contain one complete static bitstream, not just canvas metadata. */
export function canvasWebpExportDimensions(bytes: Uint8Array): { width: number; height: number } {
  const size = canvasRasterDimensions(bytes, "image/webp"), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12, bitstreams = 0;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at + 4, true), start = at + 8;
    if (length > bytes.length - start) { throw new Error("Prepared WebP contains a truncated chunk."); }
    if (ascii(bytes, at, "VP8 ")) { if (length < 10 || bytes[start] & 1 || !ascii(bytes, start + 3, "\x9d\x01\x2a")) { throw new Error("Prepared WebP has an invalid static VP8 bitstream."); } bitstreams++; }
    if (ascii(bytes, at, "VP8L")) { if (length < 5 || bytes[start] !== 0x2f) { throw new Error("Prepared WebP has an invalid lossless bitstream."); } bitstreams++; }
    at = start + length + (length & 1);
  }
  if (at !== bytes.length || bitstreams !== 1) { throw new Error("Prepared WebP needs exactly one complete static bitstream."); }
  return size;
}
