const { lstat, open, readdir, realpath } = require("node:fs/promises");
const path = require("node:path");

const LIMITS = Object.freeze({ depth: 12, entries: 1000, files: 20, fileBytes: 16 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 });
const refuse = (message, relative) => new Error(message + (relative ? ": " + relative : ""));
const same = (left, right) => path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();

/**
 * Enumerate and read one user-selected folder natively. Links, junctions and other non-regular entries are refused
 * (never skipped), every entry must resolve to its own path beneath the selected root, and bytes are read only after
 * the whole tree and its size limits have been checked. `expected` lists absolute paths the browser claims were
 * selected; any that fall outside the root or the native listing are refused as unselected.
 */
async function readAttachmentFolder(root, expected = [], hooks = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root) || !Array.isArray(expected)) { throw refuse("Choose a folder by its absolute local path"); }
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) { throw refuse("The selected folder is a link or not a directory", root); }
  const base = await realpath(root);
  if (!same(base, path.resolve(root))) { throw refuse("The selected folder path passes through a link, junction or alias", root); }
  const rootName = path.basename(base), files = [];
  let visited = 0, total = 0;
  const walk = async (directory, prefix, depth) => {
    if (depth > LIMITS.depth) { throw refuse("Folder imports support at most " + LIMITS.depth + " nested folder levels", prefix); }
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (++visited > LIMITS.entries) { throw refuse("The selected folder contains more than " + LIMITS.entries + " entries"); }
      const full = path.join(directory, entry.name), relative = prefix + entry.name, info = await lstat(full);
      if (info.isSymbolicLink() || entry.isSymbolicLink()) { throw refuse("The selected folder contains a link, junction or reparse point", relative); }
      if (!same(await realpath(full), full)) { throw refuse("The selected folder entry resolves outside its own path", relative); }
      if (info.isDirectory()) { await walk(full, relative + "/", depth + 1); }
      else if (info.isFile()) {
        if (files.length >= LIMITS.files) { throw refuse("Choose between 1 and 20 files to attach"); }
        if (info.size > LIMITS.fileBytes) { throw refuse("Each attachment must be no larger than 16 MiB", relative); }
        total += info.size;
        if (total > LIMITS.totalBytes) { throw refuse("An attachment import can contain at most 32 MiB in total"); }
        files.push({ name: rootName + "/" + relative, relative, full, info });
      } else { throw refuse("The selected folder contains an unsupported entry", relative); }
    }
  };
  await walk(base, "", 0);
  if (!files.length) { throw refuse("The folder contains no files to attach. Empty folders are not imported"); }
  const listed = new Set(files.map(file => file.relative.toLowerCase()));
  for (const item of expected) {
    const relative = typeof item === "string" && path.isAbsolute(item) ? path.relative(root, item) : "..";
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !listed.has(relative.split(path.sep).join("/").toLowerCase())) { throw refuse("A selected file is not a regular file beneath the selected folder", String(item)); }
  }
  const result = [];
  for (const file of files) {
    if (hooks.beforeRead) { await hooks.beforeRead(file.full); }
    const unchanged = stat => stat.isFile() && stat.size === file.info.size && stat.mtimeMs === file.info.mtimeMs && stat.ino === file.info.ino && stat.dev === file.info.dev;
    const handle = await open(file.full, "r");
    try {
      // Identity is proven on the open handle before any byte is read; a path swapped to a link opens the foreign target, whose identity differs.
      if (!unchanged(await handle.stat())) { throw refuse("A selected file changed before it was read", file.relative); }
      const current = await lstat(file.full);
      if (current.isSymbolicLink() || !same(await realpath(file.full), file.full) || !unchanged(current)) { throw refuse("A selected file path was replaced before it was read", file.relative); }
      const bytes = Buffer.alloc(file.info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) { break; }
        offset += bytesRead;
      }
      if (offset !== bytes.length || !unchanged(await handle.stat())) { throw refuse("A selected file changed while it was being read", file.relative); }
      result.push({ name: file.name, size: bytes.byteLength, bytes });
    } finally { await handle.close(); }
  }
  return { root: rootName, files: result };
}

module.exports = { ATTACHMENT_FOLDER_LIMITS: LIMITS, readAttachmentFolder };
