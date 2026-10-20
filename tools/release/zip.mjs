import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// Fixed DOS timestamp (2020-01-01 00:00:00) so equal inputs produce equal archives.
const dosTime = 0;
const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
const maxEntry = 0xffffffff;
const storedExtensions = new Set([".zip", ".png", ".jpg", ".gz", ".br", ".woff2", ".pak", ".dat", ".bin"]);

export async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isSymbolicLink()) { throw new Error("Refusing to package a symbolic link or junction: " + relative); }
    if (entry.isDirectory()) { files.push(...await listFiles(join(directory, entry.name), relative)); }
    else if (entry.isFile()) { files.push(relative); }
  }
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) { hash.update(chunk); }
  return hash.digest("hex");
}

export async function writeZip(sourceDirectory, outputPath, { files } = {}) {
  const names = files ?? await listFiles(sourceDirectory);
  if (names.length > 0xfffe) { throw new Error("Too many archive entries for the supported ZIP format."); }
  await mkdir(dirname(outputPath), { recursive: true });
  const handle = await open(outputPath, "w");
  const central = [];
  let offset = 0;
  const write = async buffer => { await handle.write(buffer); offset += buffer.length; };
  try {
    for (const name of names) {
      const bytes = await readFile(join(sourceDirectory, ...name.split("/")));
      if (bytes.length >= maxEntry || offset >= maxEntry) { throw new Error("Archive exceeds the supported 4 GiB ZIP limit: " + name); }
      const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
      const deflated = storedExtensions.has(extension) ? null : deflateRawSync(bytes, { level: 9 });
      const method = deflated && deflated.length < bytes.length ? 8 : 0;
      const payload = method === 8 ? deflated : bytes;
      const nameBytes = Buffer.from(name, "utf8");
      const crc = crc32(bytes);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
      local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
      central.push({ nameBytes, crc, method, compressed: payload.length, size: bytes.length, offset });
      await write(local); await write(nameBytes); await write(payload);
    }
    const centralStart = offset;
    for (const entry of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10); header.writeUInt16LE(dosTime, 12); header.writeUInt16LE(dosDate, 14);
      header.writeUInt32LE(entry.crc, 16); header.writeUInt32LE(entry.compressed, 20); header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.nameBytes.length, 28); header.writeUInt32LE(entry.offset, 42);
      await write(header); await write(entry.nameBytes);
    }
    const centralSize = offset - centralStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralStart, 16);
    await write(end);
  } finally { await handle.close(); }
  return { entries: names.length, bytes: (await stat(outputPath)).size };
}

// Independent reader used by verification: validates every CRC and rejects unsafe names.
export async function readZipEntries(path) {
  const buffer = await readFile(path);
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) { throw new Error("Not a ZIP archive: " + path); }
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) { throw new Error("Corrupt central directory."); }
    const method = buffer.readUInt16LE(cursor + 10), crc = buffer.readUInt32LE(cursor + 16), compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24), nameLength = buffer.readUInt16LE(cursor + 28);
    const extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32), offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some(part => part === ".." || part === "")) { throw new Error("Unsafe archive entry: " + name); }
    const localName = buffer.readUInt16LE(offset + 26), localExtra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const raw = buffer.subarray(start, start + compressed);
    const bytes = method === 8 ? inflateRawSync(raw) : raw;
    if (bytes.length !== size || crc32(bytes) !== crc) { throw new Error("Archive entry failed CRC verification: " + name); }
    entries.push({ name, size, compressed, method, sha256: createHash("sha256").update(bytes).digest("hex") });
    cursor += 46 + nameLength + extra + comment;
  }
  return entries;
}
