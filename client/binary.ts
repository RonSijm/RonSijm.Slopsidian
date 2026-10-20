export const MAX_BINARY_BYTES = 16 * 1024 * 1024;

export function encodeBinary(value: ArrayBuffer): string {
  if (!(value instanceof ArrayBuffer) || value.byteLength > MAX_BINARY_BYTES) { throw new Error("Binary files must be ArrayBuffers up to 16 MiB."); }
  const bytes = new Uint8Array(value), chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) { chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768))); }
  return btoa(chunks.join(""));
}

export function decodeBinary(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_BINARY_BYTES / 3) * 4 || value.length % 4 !== 0) { throw new Error("Binary content must be valid Base64 within 16 MiB."); }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) { throw new Error("Binary content must be valid Base64."); }
  const raw = atob(value);
  if (raw.length > MAX_BINARY_BYTES || btoa(raw) !== value) { throw new Error("Invalid or oversized Base64 binary content."); }
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
