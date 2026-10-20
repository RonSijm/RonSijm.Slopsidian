import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) { value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; }
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const data = Buffer.concat([Buffer.from(name), bytes]), result = Buffer.alloc(data.length + 8);
  result.writeUInt32BE(bytes.length, 0); data.copy(result, 4); result.writeUInt32BE(crc32(data), result.length - 4); return result;
}
export function faviconPng(color = [30, 120, 220, 255], width = 32, height = 32) {
  assert.ok(width > 0 && width <= 256 && height > 0 && height <= 256);
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { for (let channel = 0; channel < 4; channel++) { pixels[y * (width * 4 + 1) + x * 4 + channel + 1] = color[channel]; } } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
export function faviconIco(color = [210, 50, 30, 255]) {
  const width = 16, height = 16, dib = Buffer.alloc(40 + width * height * 4 + height * 4);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(width, 4); dib.writeInt32LE(height * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  for (let pixel = 0; pixel < width * height; pixel++) { dib[40 + pixel * 4] = color[2]; dib[41 + pixel * 4] = color[1]; dib[42 + pixel * 4] = color[0]; dib[43 + pixel * 4] = color[3]; }
  const directory = Buffer.alloc(22); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(1, 4); directory[6] = width; directory[7] = height;
  directory.writeUInt16LE(1, 10); directory.writeUInt16LE(32, 12); directory.writeUInt32LE(dib.length, 14); directory.writeUInt32LE(22, 18);
  return Buffer.concat([directory, dib]);
}
export async function createFaviconPages(vaultOrigin = () => "", jpeg = null) {
  const requests = [], held = new Map(), png = faviconPng(), ico = faviconIco(); let override = null;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture");
    requests.push({ url: request.url, token: request.headers["x-vault-token"] ?? null, cookie: request.headers.cookie ?? null, destination: request.headers["sec-fetch-dest"] ?? null });
    if (url.pathname.startsWith("/icon/") || url.pathname === "/favicon.ico") {
      const type = url.pathname.split("/").at(-1);
      const finish = () => {
        if (response.destroyed) { return; }
        if (type === "redirect") { response.writeHead(302, { Location: vaultOrigin() + "/api/vault" }); response.end(); return; }
        if (type === "large") { response.writeHead(200, { "Content-Type": "image/png" }); response.end(Buffer.alloc(131073)); return; }
        if (type === "svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end('<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"></svg>'); return; }
        if (type === "missing") { response.writeHead(404); response.end(); return; }
        const body = type === "ico" || type === "favicon.ico" ? ico : type === "jpeg" && jpeg ? jpeg : png;
        response.writeHead(200, { "Content-Type": type === "ico" || type === "favicon.ico" ? "image/x-icon" : type === "jpeg" && jpeg ? "image/jpeg" : "image/png", "Cache-Control": "no-store" }); response.end(body);
      };
      if (url.searchParams.has("hold")) {
        const key = url.searchParams.get("hold"); held.set(key, finish); response.once("close", () => held.delete(key));
      } else { finish(); }
      return;
    }
    const icon = override ?? url.searchParams.get("icon") ?? "png", key = url.searchParams.get("hold"), href = "/icon/" + icon + (key ? "?hold=" + encodeURIComponent(key) : "");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "favicon-private=fixture-only; Path=/" });
    response.end('<!doctype html><html><head><title>Icon ' + icon + '</title><link rel="shortcut icon" href="' + href + '"></head><body><h1>Icon page</h1><input id="keep-input" value="unchanged"><p>Native site-icon fixture.</p></body></html>');
  });
  let port;
  for (let attempt = 0; attempt < 20; attempt++) {
    port = randomInt(49152, 65536);
    try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); break; }
    catch (error) { if (!["EADDRINUSE", "EACCES"].includes(error.code) || attempt === 19) { throw error; } }
  }
  return { origin: "http://127.0.0.1:" + port, requests, held,
    setIcon(value) { override = value; },
    release(key) { const finish = held.get(key); held.delete(key); finish?.(); },
    async close() { for (const finish of held.values()) { finish(); } held.clear(); server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
