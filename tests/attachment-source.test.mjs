import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import * as filesystem from "node:fs/promises";
import { link, mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { runInNewContext } from "node:vm";

const { readAttachmentFolder } = createRequire(import.meta.url)("../desktop/attachment-source.cjs");
const source = await readFile(new URL("../desktop/attachment-source.cjs", import.meta.url), "utf8");
const readerWithFilesystem = (adapter, paths = path) => {
  const module = { exports: {} };
  runInNewContext(source, { module, Buffer, Error, require: name => {
    if (name === "node:fs/promises") { return adapter; }
    if (name === "node:path") { return paths; }
    throw new Error("Unexpected attachment-source dependency: " + name);
  } });
  return module.exports.readAttachmentFolder;
};
const fixture = async body => {
  const base = await mkdtemp(join(tmpdir(), "slopsidian-folder-"));
  try { await body(base); } finally { await rm(base, { recursive: true, force: true }); }
};

// Model Windows paths independently of whether this machine creates DOS 8.3 names.
const windowsFixture = () => {
  const paths = path.win32, root = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\Chosen", base = root.replace("RUNNER~1", "runneradmin");
  const canonical = value => paths.normalize(value).replace(/\\RUNNER~1(?=\\|$)/i, "\\runneradmin");
  const nodes = new Map(), checked = [];
  let reads = 0, serial = 0;
  const add = (full, bytes) => {
    const directory = bytes === undefined;
    const info = { dev: 1, ino: ++serial, mtimeMs: 1, size: bytes?.length ?? 0, isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory };
    nodes.set(full.toLowerCase(), { full, bytes, info });
  };
  for (let directory = base;; directory = paths.dirname(directory)) {
    add(directory);
    if (paths.dirname(directory) === directory) { break; }
  }
  add(paths.join(base, "sub")); add(paths.join(base, "Top.bin"), Buffer.from([0, 255, 13, 10])); add(paths.join(base, "sub", "Deep.txt"), Buffer.from("deep"));
  const node = full => {
    const result = nodes.get(canonical(full).toLowerCase());
    assert.ok(result, "The reader must stay within the modeled filesystem: " + full);
    return result;
  };
  const adapter = {
    async lstat(full) { checked.push(full); return node(full).info; },
    async realpath(full) { return node(full).full; },
    async readdir(full) {
      return [...nodes.values()].filter(item => item.full !== base && paths.dirname(item.full).toLowerCase() === canonical(full).toLowerCase()).map(item => ({ name: paths.basename(item.full), isSymbolicLink: () => false }));
    },
    async open(full) {
      const opened = node(full);
      return {
        async stat() { return opened.info; },
        async read(buffer, offset, length, position) { reads++; return { bytesRead: opened.bytes.copy(buffer, offset, position, position + length) }; },
        async close() {}
      };
    }
  };
  return { root, base, adapter, checked, node, reads: () => reads };
};

test("A regular folder is read completely with hierarchy, exact bytes and its own root name", () => fixture(async base => {
  const root = join(base, "Chosen"), bytes = Buffer.from([0, 255, 13, 10]);
  await mkdir(join(root, "a", "b"), { recursive: true }); await writeFile(join(root, "Top.bin"), bytes); await writeFile(join(root, "a", "b", "Deep.txt"), "deep");
  const result = await readAttachmentFolder(root, [join(root, "Top.bin"), join(root, "a", "b", "Deep.txt")]);
  assert.equal(result.root, "Chosen"); assert.deepEqual(result.files.map(file => file.name), ["Chosen/Top.bin", "Chosen/a/b/Deep.txt"]);
  assert.deepEqual(Buffer.from(result.files[0].bytes), bytes);
}));

test("Windows DOS short-name parent components import the same canonical folder without hiding its hierarchy", async () => {
  const model = windowsFixture(), read = readerWithFilesystem(model.adapter, path.win32);
  const result = await read(model.root, [path.win32.join(model.root, "Top.bin")]);
  assert.equal(result.root, "Chosen");
  assert.deepEqual(Array.from(result.files, file => file.name), ["Chosen/Top.bin", "Chosen/sub/Deep.txt"]);
  assert.deepEqual(result.files[0].bytes, Buffer.from([0, 255, 13, 10]));
  assert.ok(model.checked.includes("C:\\Users\\RUNNER~1"), "The supplied short-name ancestor must be checked without following a link");
  assert.equal(model.reads(), 2);
  await assert.rejects(read(model.root, ["C:\\Users\\runneradmin\\Outside.bin"]), /beneath the selected folder/);
});

test("A native Windows short-name path imports the same bytes as its long path when available", { skip: process.platform !== "win32" }, context => fixture(async base => {
  const root = join(base, "Chosen Folder"), bytes = Buffer.from([0, 255, 13, 10]);
  await mkdir(root); await writeFile(join(root, "Top.bin"), bytes);
  const canonical = await realpath(root);
  const short = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$attachmentFs = New-Object -ComObject Scripting.FileSystemObject; $attachmentFs.GetFolder($env:SLOPSIDIAN_ATTACHMENT_ALIAS_FIXTURE).ShortPath"], {
    env: { ...process.env, SLOPSIDIAN_ATTACHMENT_ALIAS_FIXTURE: root }, encoding: "utf8", windowsHide: true
  }).trim();
  if (path.normalize(short).toLowerCase() === path.normalize(canonical).toLowerCase()) { context.skip("The temporary volume does not provide a DOS short-name alias"); return; }
  const result = await readAttachmentFolder(short, [join(short, "Top.bin")]);
  assert.equal(result.root, "Chosen Folder"); assert.deepEqual(result.files[0].bytes, bytes);
  assert.deepEqual(result, await readAttachmentFolder(canonical, [join(canonical, "Top.bin")]));
}));

test("A junction beneath a Windows short-name parent is still refused before any bytes are read", async () => {
  const model = windowsFixture(), lstat = model.adapter.lstat;
  model.adapter.lstat = async full => {
    const info = await lstat(full);
    return full === "C:\\Users\\RUNNER~1\\AppData" ? { ...info, isSymbolicLink: () => true } : info;
  };
  await assert.rejects(readerWithFilesystem(model.adapter, path.win32)(model.root), /passes through a link/);
  assert.equal(model.reads(), 0);
});

test("A Windows reparse alias whose own identity differs from its canonical target is refused before reading", async () => {
  const model = windowsFixture(), lstat = model.adapter.lstat;
  model.adapter.lstat = async full => {
    const info = await lstat(full);
    return full === "C:\\Users\\RUNNER~1" ? { ...info, ino: info.ino + 100 } : info;
  };
  await assert.rejects(readerWithFilesystem(model.adapter, path.win32)(model.root), /passes through a link/);
  assert.equal(model.reads(), 0);
});

test("A Windows canonicalization that relocates a component outside its parent is refused before reading", async () => {
  const model = windowsFixture(), realpath = model.adapter.realpath;
  model.adapter.realpath = async full => full === "C:\\Users\\RUNNER~1" ? "C:\\Elsewhere\\runneradmin" : realpath(full);
  await assert.rejects(readerWithFilesystem(model.adapter, path.win32)(model.root), /passes through a link/);
  assert.equal(model.reads(), 0);
});

test("A junction or symlink inside the selected folder is refused before any bytes are returned", () => fixture(async base => {
  const root = join(base, "Chosen"), outside = join(base, "Outside");
  await mkdir(root); await mkdir(outside); await writeFile(join(outside, "Sentinel.bin"), "SECRET"); await writeFile(join(root, "Real.txt"), "ok");
  await symlink(outside, join(root, "Link"), "junction");
  await assert.rejects(readAttachmentFolder(root), /link, junction or reparse/);
}));

test("A file symlink is refused when the platform allows creating one", () => fixture(async base => {
  const root = join(base, "Chosen"); await mkdir(root); await writeFile(join(base, "Outside.bin"), "SECRET");
  try { await symlink(join(base, "Outside.bin"), join(root, "Linked.bin"), "file"); } catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { return; } throw error; }
  await assert.rejects(readAttachmentFolder(root), /link, junction or reparse/);
}));

test("A junction in a parent component of the selected root is refused", () => fixture(async base => {
  const real = join(base, "Real"), alias = join(base, "Alias");
  await mkdir(join(real, "Chosen"), { recursive: true }); await writeFile(join(real, "Chosen", "Sentinel.bin"), "SECRET");
  await symlink(real, alias, "junction");
  await assert.rejects(readAttachmentFolder(join(alias, "Chosen")), /passes through a link/);
}));

test("A file swapped for a link after the walk is refused without reading the outside bytes", () => fixture(async base => {
  const root = join(base, "Chosen"), outsideFile = join(base, "Outside.bin"), sentinel = Buffer.from("SECRET-SENTINEL");
  await mkdir(root); await writeFile(join(root, "Real.bin"), Buffer.from("SECRET-SENTINEL".replace(/./g, "x"))); await writeFile(outsideFile, sentinel);
  let outcome, reads = 0;
  const read = readerWithFilesystem({ ...filesystem, async open(...args) {
    const handle = await filesystem.open(...args);
    return { stat: () => handle.stat(), close: () => handle.close(), read: (...args) => { reads++; return handle.read(...args); } };
  } });
  try {
    outcome = await read(root, [], { beforeRead: async full => {
      await unlink(full);
      try { await symlink(outsideFile, full, "file"); } catch (error) { if (!["EPERM", "EACCES"].includes(error.code)) { throw error; } await link(outsideFile, full); }
    } });
  } catch (error) { outcome = error; }
  assert.ok(outcome instanceof Error, "swap must be refused");
  assert.match(outcome.message, /changed before|replaced before/);
  assert.ok(!JSON.stringify(outcome.message).includes("SECRET"));
  assert.equal(reads, 0);
}));

test("A file replaced during the walk is refused on the opened handle before any bytes are read", () => fixture(async base => {
  const root = join(base, "Chosen"), target = join(root, "Real.bin"), outside = join(base, "Outside.bin");
  await mkdir(root); await writeFile(target, "xxxxxx"); await writeFile(outside, "SECRET");
  const canonicalTarget = await realpath(target);
  let swapped = false, reads = 0;
  const read = readerWithFilesystem({ ...filesystem,
    async realpath(full) {
      if (full === canonicalTarget && !swapped) { swapped = true; await unlink(full); await link(outside, full); }
      return realpath(full);
    },
    async open(...args) {
      const handle = await filesystem.open(...args);
      return { stat: () => handle.stat(), close: () => handle.close(), read: (...args) => { reads++; return handle.read(...args); } };
    }
  });
  await assert.rejects(read(root), /changed before/);
  assert.equal(swapped, true); assert.equal(reads, 0);
}));

test("A selected root that is itself a link is refused", () => fixture(async base => {
  const outside = join(base, "Outside"), link = join(base, "RootLink"); await mkdir(outside); await writeFile(join(outside, "Sentinel.bin"), "SECRET");
  await symlink(outside, link, "junction");
  await assert.rejects(readAttachmentFolder(link), /link or not a directory/);
}));

test("Claimed selections outside the root or missing from the native listing are refused as unselected", () => fixture(async base => {
  const root = join(base, "Chosen"); await mkdir(root); await writeFile(join(root, "In.txt"), "in"); await writeFile(join(base, "Out.txt"), "out");
  await assert.rejects(readAttachmentFolder(root, [join(base, "Out.txt")]), /beneath the selected folder/);
  await assert.rejects(readAttachmentFolder(root, [join(root, "Missing.txt")]), /beneath the selected folder/);
  await assert.rejects(readAttachmentFolder(root, ["relative.txt"]), /beneath the selected folder/);
  await assert.rejects(readAttachmentFolder("relative"), /absolute/);
}));

test("Count, size, depth and empty-tree limits refuse the whole folder", () => fixture(async base => {
  const many = join(base, "Many"); await mkdir(many); for (let i = 0; i < 21; i++) { await writeFile(join(many, i + ".txt"), ""); }
  await assert.rejects(readAttachmentFolder(many), /1 and 20/);
  const big = join(base, "Big"); await mkdir(big); await writeFile(join(big, "Big.bin"), Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(readAttachmentFolder(big), /16 MiB/);
  const total = join(base, "Total"); await mkdir(total); for (const name of ["a", "b", "c"]) { await writeFile(join(total, name), Buffer.alloc(11 * 1024 * 1024)); }
  await assert.rejects(readAttachmentFolder(total), /32 MiB/);
  const deep = join(base, "Deep", ...Array(13).fill("d")); await mkdir(deep, { recursive: true }); await writeFile(join(deep, "f.txt"), "x");
  await assert.rejects(readAttachmentFolder(join(base, "Deep")), /nested/);
  const empty = join(base, "Empty"); await mkdir(join(empty, "sub"), { recursive: true });
  await assert.rejects(readAttachmentFolder(empty), /no files/);
}));
