import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { root, startHost } from "./host.mjs";

const bom = Buffer.from([0xef, 0xbb, 0xbf]);
const withBom = content => Buffer.concat([bom, Buffer.from(content)]);
const version = bytes => createHash("sha256").update(bytes).digest("hex");
const diskPath = (app, path) => join(app.directory, ...path.split("/"));

async function fixture(t) {
  await mkdir(join(root, ".runtime"), { recursive: true });
  const directory = await mkdtemp(join(root, ".runtime", "files-api-"));
  const configuration = {
    "workspace.json": Buffer.from('{"main":{"type":"original"},"unknown":[1,2]}\r\n'),
    "core-plugins.json": Buffer.from('{"file-explorer":true,"future-core":{"preserve":true}}\r\n'),
    "community-plugins.json": Buffer.from('["original-community-plugin"]\r\n'),
  };
  let host;
  t.after(async () => {
    try {
      if (host) {
        await host.stop();
      }
      for (const [name, bytes] of Object.entries(configuration)) {
        assert.deepEqual(await readFile(join(directory, ".obsidian", name)), bytes, `${name} must not be rewritten`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  await mkdir(join(directory, ".obsidian"));
  for (const [name, bytes] of Object.entries(configuration)) {
    await writeFile(join(directory, ".obsidian", name), bytes);
  }
  host = await startHost(directory);
  return { directory, request: (...args) => host.request(...args) };
}

async function put(app, path, content) {
  const destination = diskPath(app, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function ok(response) {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function info(app, path) {
  return ok(await app.request("/api/files/info?" + new URLSearchParams({ root: app.directory, path })));
}

async function unchanged(app, files) {
  for (const [path, bytes] of Object.entries(files)) {
    assert.deepEqual(await readFile(diskPath(app, path)), bytes, path);
  }
}

async function noTransactions(app) {
  const path = diskPath(app, ".obsidian/vault-dotnet-transactions");
  const entries = await readdir(path).catch(error => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  assert.deepEqual(entries, [], "Confirmed operations must not leave private recovery copies behind");
}

test("visible nested empty folders persist in snapshots and collisions do not overwrite files or folders", async t => {
  const app = await fixture(t);
  const snapshot = await ok(await app.request("/api/files/folders", "POST", { root: app.directory, path: "Empty/Nested/Deep" }));
  assert.equal(snapshot.root, app.directory);
  assert.deepEqual(snapshot.folders, ["Empty", "Empty/Nested", "Empty/Nested/Deep"]);
  assert.deepEqual(snapshot.files, []);
  assert.deepEqual(await readdir(diskPath(app, "Empty/Nested/Deep")), []);
  const refreshed = await ok(await app.request("/api/vault"));
  assert.deepEqual(refreshed.folders, snapshot.folders);

  await put(app, "Occupied.md", "Keep this file.\r\n");
  for (const path of ["Empty/Nested", "Occupied.md", "Occupied.md/Child"]) {
    const response = await app.request("/api/files/folders", "POST", { root: app.directory, path });
    assert.equal(response.status, 409, path);
  }
  assert.equal(await readFile(diskPath(app, "Occupied.md"), "utf8"), "Keep this file.\r\n");
});

test("adapter folders create and enumerate hidden plugin assets without widening visible operations or losing path/root guards", async t => {
  const app = await fixture(t);
  const path = ".obsidian/icons/custom/nested";
  const snapshot = await ok(await app.request("/api/adapter/folder", "POST", { root: app.directory, path }));
  assert.deepEqual(snapshot.folders, []);
  assert.deepEqual(await readdir(diskPath(app, path)), []);
  await put(app, ".obsidian/icons/custom/keep.svg", "<svg></svg>");
  const listing = await ok(await app.request("/api/adapter/list?" + new URLSearchParams({ root: app.directory, path: ".obsidian/icons/custom" })));
  assert.deepEqual(listing, { files: [".obsidian/icons/custom/keep.svg"], folders: [path] });
  assert.equal((await app.request("/api/adapter/folder", "POST", { root: app.directory, path })).status, 409);
  assert.equal((await app.request("/api/files/folders", "POST", { root: app.directory, path: ".obsidian/no-visible-folder" })).status, 400);
  for (const invalid of ["../Outside", ".obsidian/../Outside", "C:\\Outside", "CON", "Trailing."]) {
    assert.equal((await app.request("/api/adapter/folder", "POST", { root: app.directory, path: invalid })).status, 400);
    assert.equal((await app.request("/api/adapter/list?" + new URLSearchParams({ root: app.directory, path: invalid }))).status, 400);
  }
  assert.equal((await app.request("/api/adapter/folder", "POST", { root: "stale-root", path: ".obsidian/stale" })).status, 409);
  assert.equal((await app.request("/api/adapter/list?" + new URLSearchParams({ root: "stale-root", path: "/" }))).status, 409);
  assert.equal(await readFile(diskPath(app, ".obsidian/icons/custom/keep.svg"), "utf8"), "<svg></svg>");
});

test("nested moves apply Markdown and Canvas reference edits while preserving BOM, CRLF and creation times", async t => {
  const app = await fixture(t);
  const canvas = '{"nodes":[{"id":"file","type":"file","x":0,"y":0,"width":100,"height":100,"file":"Plan.md"}],"future":{"keep":42}}\r\n';
  const originals = {
    "Plan.md": withBom("# Plan\r\nSelf [[Plan]]\r\n"),
    "References/One.md": withBom("See [[Plan]].\r\n"),
    "References/Two.md": Buffer.from("[Plan](../Plan.md)\r\n"),
    "Board.canvas": withBom(canvas),
  };
  for (const [path, bytes] of Object.entries(originals)) {
    await put(app, path, bytes);
  }
  const before = Object.fromEntries(await Promise.all(Object.keys(originals).map(async path => [path, await info(app, path)])));
  const newPath = "Archive/2026/Project.md";
  const contents = {
    [newPath]: "# Project\r\nSelf [[Archive/2026/Project]]\r\n",
    "References/One.md": "See [[Archive/2026/Project]].\r\n",
    "References/Two.md": "[Project](../Archive/2026/Project.md)\r\n",
    "Board.canvas": canvas.replace("Plan.md", "Archive/2026/Project.md"),
  };
  const result = await ok(await app.request("/api/files/rename", "POST", {
    root: app.directory, path: "Plan.md", newPath, version: before["Plan.md"].version,
    edits: [
      { path: "References/One.md", version: before["References/One.md"].version, content: contents["References/One.md"] },
      { path: "Plan.md", version: before["Plan.md"].version, content: contents[newPath] },
      { path: "References/Two.md", version: before["References/Two.md"].version, content: contents["References/Two.md"] },
      { path: "Board.canvas", version: before["Board.canvas"].version, content: contents["Board.canvas"] },
    ],
  }));
  assert.equal(result.oldPath, "Plan.md");
  assert.equal(result.newPath, newPath);
  assert.equal(result.snapshot.files.some(file => file.path === "Plan.md"), false);
  assert.ok(result.snapshot.files.some(file => file.path === newPath));
  assert.ok(result.snapshot.folders.includes("Archive/2026"));
  assert.deepEqual(result.documents.map(document => document.file.path).sort(), Object.keys(contents).sort());
  await assert.rejects(stat(diskPath(app, "Plan.md")), { code: "ENOENT" });
  for (const document of result.documents) {
    const path = document.file.path;
    const originalPath = path === newPath ? "Plan.md" : path;
    const expected = originals[originalPath].subarray(0, 3).equals(bom) ? withBom(contents[path]) : Buffer.from(contents[path]);
    assert.deepEqual(await readFile(diskPath(app, path)), expected, path);
    assert.equal(document.content, contents[path]);
    assert.equal(document.version, version(expected));
    assert.equal(document.file.stat.ctime, before[originalPath].file.stat.ctime);
    assert.deepEqual(await ok(await app.request("/api/file?" + new URLSearchParams({ path }))), document);
  }
  await noTransactions(app);
});

test("binary moves and collision-safe vault trash preserve exact bytes, while case-only note renames return a fresh document", async t => {
  const app = await fixture(t);
  const bytes = Buffer.from([0, 0xff, 0xfe, 0x80, 0x0d, 0x0a, 0xef, 0xbb, 0xbf, 0, 0x42]);
  await put(app, "Assets/Original.bin", bytes);
  const original = await info(app, "Assets/Original.bin");
  assert.equal(original.version, version(bytes), "Binary info must hash bytes without decoding UTF-8");
  assert.equal(original.root, app.directory);
  const moved = await ok(await app.request("/api/files/rename", "POST", {
    root: app.directory, path: "Assets/Original.bin", newPath: "Attachments/Nested/Renamed.bin", version: original.version, edits: [],
  }));
  assert.deepEqual(moved.documents, []);
  assert.deepEqual(await readFile(diskPath(app, moved.newPath)), bytes);
  const movedInfo = await info(app, moved.newPath);
  assert.equal(movedInfo.version, original.version);
  assert.equal(movedInfo.file.stat.ctime, original.file.stat.ctime);

  const occupied = Buffer.from("An earlier trash entry must survive.\r\n");
  await put(app, ".trash/Renamed.bin", occupied);
  const trashed = await ok(await app.request("/api/files/trash", "POST", { root: app.directory, path: moved.newPath, version: movedInfo.version }));
  assert.equal(trashed.path, moved.newPath);
  assert.match(trashed.trashPath, /^\.trash\/Renamed\..+\.bin$/);
  assert.deepEqual(await readFile(diskPath(app, trashed.trashPath)), bytes);
  assert.deepEqual(await readFile(diskPath(app, ".trash/Renamed.bin")), occupied);
  assert.equal(Math.trunc((await stat(diskPath(app, trashed.trashPath))).birthtimeMs), original.file.stat.ctime);
  assert.equal(trashed.snapshot.files.some(file => file.path === moved.newPath), false);
  await assert.rejects(stat(diskPath(app, moved.newPath)), { code: "ENOENT" });

  const note = withBom("# Case only\r\nUnchanged text.\r\n");
  await put(app, "Case.md", note);
  const before = await info(app, "Case.md");
  const renamed = await ok(await app.request("/api/files/rename", "POST", { root: app.directory, path: "Case.md", newPath: "case.md", version: before.version }));
  assert.deepEqual(renamed.documents.map(document => document.file.path), ["case.md"]);
  assert.equal(renamed.documents[0].version, before.version);
  assert.equal(renamed.documents[0].file.stat.ctime, before.file.stat.ctime);
  assert.equal(renamed.documents[0].content, "# Case only\r\nUnchanged text.\r\n");
  assert.deepEqual(await readFile(diskPath(app, "case.md")), note);
  const names = await readdir(app.directory);
  assert.ok(names.includes("case.md"));
  assert.equal(names.includes("Case.md"), false);

  await put(app, "Binary.md", bytes);
  const binaryMarkdown = await info(app, "Binary.md");
  const movedBinaryMarkdown = await ok(await app.request("/api/files/rename", "POST", { root: app.directory, path: "Binary.md", newPath: "Renamed binary.md", version: binaryMarkdown.version }));
  assert.deepEqual(movedBinaryMarkdown.documents, [], "Invalid UTF-8 must not enter Markdown document DTOs");
  assert.deepEqual(await readFile(diskPath(app, "Renamed binary.md")), bytes);
  await noTransactions(app);
});

test("permanent deletion removes only the versioned file, retains empty folders and leaves no trash or recovery copy", async t => {
  const app = await fixture(t);
  const keep = withBom("Keep these unrelated bytes.\r\n");
  await put(app, "Keep.md", keep);
  for (const [path, bytes] of [
    ["Delete/Nested/Empty.md", Buffer.alloc(0)],
    ["Delete/Nested/Binary.bin", Buffer.from([0, 255, 254, 128, 13, 10])],
  ]) {
    await put(app, path, bytes);
    const before = await info(app, path);
    const result = await ok(await app.request("/api/files/delete", "POST", { root: app.directory, path, version: before.version }));
    assert.equal(result.path, path);
    assert.equal(result.snapshot.root, app.directory);
    assert.equal(result.snapshot.files.some(file => file.path === path), false);
    assert.ok(result.snapshot.folders.includes("Delete/Nested"));
    await assert.rejects(stat(diskPath(app, path)), { code: "ENOENT" });
    assert.equal((await app.request("/api/files/delete", "POST", { root: app.directory, path, version: before.version })).status, 404);
  }
  assert.deepEqual(await readFile(diskPath(app, "Keep.md")), keep);
  assert.deepEqual(await readdir(diskPath(app, "Delete/Nested")), []);
  await assert.rejects(stat(diskPath(app, ".trash")), { code: "ENOENT" });
  await noTransactions(app);
  assert.deepEqual((await ok(await app.request("/api/vault"))).files.map(file => file.path), ["Keep.md"]);
});

test("permanent deletion rejects changed or in-use files without deleting newer bytes or retaining rejected locks", async t => {
  const app = await fixture(t);
  const path = "Keep.md";
  await put(app, path, "Original\r\n");
  const before = await info(app, path);
  const body = { root: app.directory, path, version: before.version };
  assert.equal((await app.request("/api/files/delete", "POST", { ...body, version: null })).status, 428);
  await put(app, path, "Newer external bytes\r\n");
  assert.equal((await app.request("/api/files/delete", "POST", body)).status, 409);
  assert.equal(await readFile(diskPath(app, path), "utf8"), "Newer external bytes\r\n");
  const current = await info(app, path);
  const writable = await open(diskPath(app, path), "r+");
  try {
    assert.equal((await app.request("/api/files/delete", "POST", { ...body, version: current.version })).status, 409);
    assert.equal(await readFile(diskPath(app, path), "utf8"), "Newer external bytes\r\n");
  } finally {
    await writable.close();
  }
  await put(app, path, "The rejected deletion released its handle.\r\n");
  assert.equal((await info(app, path)).version, version(Buffer.from("The rejected deletion released its handle.\r\n")));
  await noTransactions(app);
});

test("source, edit and destination conflicts validate the whole operation before rewriting any input", async t => {
  const app = await fixture(t);
  const files = {
    "Source.md": withBom("# Source\r\n"),
    "First.md": Buffer.from("First [[Source]]\r\n"),
    "Last.md": Buffer.from("Last [[Source]]\r\n"),
    "Occupied.md": Buffer.from("Do not overwrite.\r\n"),
    "Binary.md": Buffer.from([0xff, 0xfe, 0]),
  };
  for (const [path, bytes] of Object.entries(files)) {
    await put(app, path, bytes);
  }
  await mkdir(diskPath(app, "Existing folder"));
  const source = await info(app, "Source.md");
  const first = await info(app, "First.md");
  const last = await info(app, "Last.md");
  const binary = await info(app, "Binary.md");
  const validEdit = { path: "First.md", version: first.version, content: "Changed first note.\r\n" };
  const base = { root: app.directory, path: "Source.md", newPath: "New target/Nested/Renamed.md", version: source.version, edits: [validEdit] };

  const external = Buffer.from("An external source edit.\r\n");
  await put(app, "Source.md", external);
  assert.equal((await app.request("/api/files/rename", "POST", base)).status, 409);
  await unchanged(app, { ...files, "Source.md": external });
  await put(app, "Source.md", files["Source.md"]);

  const attempts = [
    [{ ...base, edits: [validEdit, { path: "Last.md", version: "stale", content: "Must not be saved." }] }, 409],
    [{ ...base, edits: [validEdit, { ...validEdit, path: "first.md" }] }, 409],
    [{ ...base, edits: [validEdit, { path: base.newPath, version: last.version, content: "Overlaps destination." }] }, 409],
    [{ ...base, edits: [validEdit, { path: "Binary.md", version: binary.version, content: "Do not decode this." }] }, 422],
    [{ ...base, edits: [validEdit, { path: "Last.md", content: "Missing version." }] }, 428],
    [{ ...base, edits: [validEdit, { path: "Last.md", version: last.version, content: null }] }, 400],
    [{ ...base, newPath: "Occupied.md" }, 409],
    [{ ...base, newPath: "Existing folder" }, 409],
    [{ ...base, newPath: "Occupied.md/Nested/Renamed.md" }, 409],
    [{ ...base, version: null }, 428],
    [{ ...base, path: "Missing.md" }, 404],
    [{ ...base, path: "Existing folder" }, 400],
  ];
  for (const [body, expectedStatus] of attempts) {
    const response = await app.request("/api/files/rename", "POST", body);
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    assert.ok((await response.json()).error);
    await unchanged(app, files);
    await assert.rejects(stat(diskPath(app, "New target")), { code: "ENOENT" });
    await noTransactions(app);
  }
  for (const [body, expectedStatus] of [[{ root: app.directory, path: "Source.md" }, 428], [{ root: app.directory, path: "Source.md", version: "stale" }, 409]]) {
    assert.equal((await app.request("/api/files/trash", "POST", body)).status, expectedStatus);
    await unchanged(app, files);
    await assert.rejects(stat(diskPath(app, ".trash")), { code: "ENOENT" });
  }
});

test("read-only preflight supports cancelling without a mutation request and every route rejects stale roots and unsafe paths", async t => {
  const app = await fixture(t);
  const files = { "Keep.md": withBom("# Keep\r\n"), "Attachment.bin": Buffer.from([0xff, 0, 0xfe]) };
  for (const [path, bytes] of Object.entries(files)) {
    await put(app, path, bytes);
  }
  const configurationNames = await readdir(diskPath(app, ".obsidian"));
  const preflight = await info(app, "Keep.md");
  await info(app, "Attachment.bin");
  // Cancelling the confirmation means no rename/trash POST is sent.
  await unchanged(app, files);
  assert.deepEqual(await readdir(diskPath(app, ".obsidian")), configurationNames);

  const another = diskPath(app, ".another-vault");
  await mkdir(another);
  await ok(await app.request("/api/vault/open", "POST", { path: another }));
  for (const [route, method, body] of [
    ["/api/files/info?" + new URLSearchParams({ root: app.directory, path: "Keep.md" }), "GET"],
    ["/api/files/folders", "POST", { root: app.directory, path: "No folder" }],
    ["/api/files/edit", "POST", { root: app.directory, edits: [{ path: "Keep.md", version: preflight.version, content: "Must not change the old vault." }] }],
    ["/api/files/rename", "POST", { root: app.directory, path: "Keep.md", newPath: "No.md", version: preflight.version }],
    ["/api/files/trash", "POST", { root: app.directory, path: "Keep.md", version: preflight.version }],
    ["/api/files/delete", "POST", { root: app.directory, path: "Keep.md", version: preflight.version }],
  ]) {
    assert.equal((await app.request(route, method, body)).status, 409, route);
  }
  assert.deepEqual(await readdir(another), []);
  await ok(await app.request("/api/vault/open", "POST", { path: app.directory }));
  assert.equal((await app.request("/api/files/info?path=Keep.md")).status, 409);
  for (const route of ["/api/files/folders", "/api/files/edit", "/api/files/rename", "/api/files/trash", "/api/files/delete"]) {
    assert.equal((await app.request(route, "POST", { path: "Keep.md", newPath: "No.md", version: preflight.version })).status, 409);
  }

  for (const path of ["../Escape.md", "C:\\Escape.md", ".obsidian/workspace.json", ".trash/Keep.md", "Nested//Keep.md", "CON.md", "Trailing./Keep.md"]) {
    const responses = [
      await app.request("/api/files/info?" + new URLSearchParams({ root: app.directory, path })),
      await app.request("/api/files/folders", "POST", { root: app.directory, path }),
      await app.request("/api/files/edit", "POST", { root: app.directory, edits: [{ path, version: preflight.version, content: "Not allowed." }] }),
      await app.request("/api/files/rename", "POST", { root: app.directory, path: "Keep.md", newPath: path, version: preflight.version }),
      await app.request("/api/files/trash", "POST", { root: app.directory, path, version: preflight.version }),
      await app.request("/api/files/delete", "POST", { root: app.directory, path, version: preflight.version }),
    ];
    for (const response of responses) {
      assert.equal(response.status, 400, path);
    }
    await unchanged(app, files);
  }
  const unsafeEdit = await app.request("/api/files/rename", "POST", {
    root: app.directory, path: "Keep.md", newPath: "No.md", version: preflight.version,
    edits: [{ path: ".obsidian/workspace.json", version: preflight.version, content: "Do not touch configuration." }],
  });
  assert.equal(unsafeEdit.status, 400);
  await unchanged(app, files);
  assert.deepEqual(await readdir(diskPath(app, ".obsidian")), configurationNames);
  await assert.rejects(stat(diskPath(app, "No.md")), { code: "ENOENT" });
});

test("reparse paths are rejected and a failure after applying edits rolls back notes, the move and newly created parents", async t => {
  const app = await fixture(t);
  const files = { "Source.md": withBom("# Source\r\n"), "Reference.md": withBom("See [[Source]].\r\n") };
  for (const [path, bytes] of Object.entries(files)) {
    await put(app, path, bytes);
  }
  const source = await info(app, "Source.md");
  const reference = await info(app, "Reference.md");
  const outside = diskPath(app, ".junction-target");
  await mkdir(outside);
  await writeFile(join(outside, "Keep.md"), "Junction target must survive.\r\n");
  const linked = diskPath(app, "Linked");
  await symlink(outside, linked, "junction");
  try {
    for (const response of [
      await app.request("/api/files/info?" + new URLSearchParams({ root: app.directory, path: "Linked/Keep.md" })),
      await app.request("/api/files/folders", "POST", { root: app.directory, path: "Linked/New" }),
      await app.request("/api/files/edit", "POST", {
        root: app.directory,
        edits: [
          { path: "Reference.md", version: reference.version, content: "Must not be applied." },
          { path: "Linked/Keep.md", version: source.version, content: "Do not follow junctions." },
        ],
      }),
      await app.request("/api/files/rename", "POST", { root: app.directory, path: "Source.md", newPath: "Linked/Moved.md", version: source.version }),
      await app.request("/api/files/trash", "POST", { root: app.directory, path: "Linked/Keep.md", version: source.version }),
      await app.request("/api/files/delete", "POST", { root: app.directory, path: "Linked/Keep.md", version: source.version }),
    ]) {
      assert.equal(response.status, 400);
    }
  } finally {
    await rm(linked);
  }
  const trash = diskPath(app, ".trash");
  await symlink(outside, trash, "junction");
  try {
    assert.equal((await app.request("/api/files/trash", "POST", { root: app.directory, path: "Source.md", version: source.version })).status, 400);
  } finally {
    await rm(trash);
  }

  const before = { source: (await stat(diskPath(app, "Source.md"))).mtimeMs, reference: (await stat(diskPath(app, "Reference.md"))).mtimeMs };
  const plugins = diskPath(app, ".obsidian/plugins");
  await symlink(outside, plugins, "junction");
  try {
    const deletion = await app.request("/api/files/delete", "POST", { root: app.directory, path: "Source.md", version: source.version });
    assert.equal(deletion.status, 400, "Inventory validation must fail before permanent deletion is committed");
    await unchanged(app, files);
    const response = await app.request("/api/files/rename", "POST", {
      root: app.directory, path: "Source.md", newPath: "Rollback/Nested/Renamed.md", version: source.version,
      edits: [
        { path: "Source.md", version: source.version, content: "# Renamed\r\n" },
        { path: "Reference.md", version: reference.version, content: "See [[Rollback/Nested/Renamed]].\r\n" },
      ],
    });
    assert.equal(response.status, 400, "The final snapshot must reject linked plugin configuration after triggering transaction rollback");
    await unchanged(app, files);
    assert.equal((await stat(diskPath(app, "Source.md"))).mtimeMs, before.source);
    assert.equal((await stat(diskPath(app, "Reference.md"))).mtimeMs, before.reference);
    await assert.rejects(stat(diskPath(app, "Rollback")), { code: "ENOENT" });
    await noTransactions(app);
    assert.equal(await readFile(join(outside, "Keep.md"), "utf8"), "Junction target must survive.\r\n");
  } finally {
    await rm(plugins);
  }
});

test("Markdown batch edits preserve each note's BOM, CRLF and creation time and return fresh documents without moving files", async t => {
  const app = await fixture(t);
  const originals = {
    "Notes/First.md": withBom("# First\r\nOriginal text.\r\n"),
    "Notes/Second.md": Buffer.from("# Second\r\nSee [[First]].\r\n"),
    "Untouched.md": Buffer.from("# Leave this note alone.\r\n"),
    "Attachment.bin": Buffer.from([0xff, 0xfe, 0, 0x80]),
  };
  for (const [path, bytes] of Object.entries(originals)) {
    await put(app, path, bytes);
  }
  const contents = {
    "Notes/First.md": "# First\r\nCombined content: café λ.\r\n",
    "Notes/Second.md": "# Second\r\nUpdated [[First]] reference.\r\n",
  };
  const before = Object.fromEntries(await Promise.all(Object.keys(contents).map(async path => [path, await info(app, path)])));
  const edits = Object.entries(contents).map(([path, content]) => ({ path, content, version: before[path].version }));
  const result = await ok(await app.request("/api/files/edit", "POST", { root: app.directory, edits }));
  assert.equal(result.snapshot.root, app.directory);
  assert.deepEqual(result.snapshot.files.map(file => file.path).sort(), Object.keys(originals).sort());
  assert.deepEqual(result.documents.map(document => document.file.path).sort(), Object.keys(contents).sort());
  for (const document of result.documents) {
    const path = document.file.path;
    const expected = originals[path].subarray(0, 3).equals(bom) ? withBom(contents[path]) : Buffer.from(contents[path]);
    assert.deepEqual(await readFile(diskPath(app, path)), expected, path);
    assert.equal(document.content, contents[path]);
    assert.equal(document.version, version(expected));
    assert.notEqual(document.version, before[path].version);
    assert.equal(document.file.stat.ctime, before[path].file.stat.ctime);
    assert.deepEqual(await ok(await app.request("/api/file?" + new URLSearchParams({ path }))), document);
    assert.deepEqual(result.snapshot.files.find(file => file.path === path), document.file);
  }
  await unchanged(app, { "Untouched.md": originals["Untouched.md"], "Attachment.bin": originals["Attachment.bin"] });
  await noTransactions(app);
});

test("a guarded extraction batch creates nested targets together with existing source edits", async t => {
  const app = await fixture(t);
  await put(app, "Source.md", withBom("Before\r\nSelected text\r\nAfter\r\n"));
  const source = await info(app, "Source.md");
  const edits = [
    { path: "Extracted/Nested/Selection.md", version: null, create: true, content: "Selected text\r\n" },
    { path: "Extracted/Empty.md", version: null, create: true, content: "" },
    { path: "Source.md", version: source.version, content: "Before\r\n[[Extracted/Nested/Selection]]\r\nAfter\r\n" },
  ];
  const result = await ok(await app.request("/api/files/edit", "POST", { root: app.directory, edits }));
  assert.deepEqual(result.documents.map(document => document.file.path).sort(), edits.map(edit => edit.path).sort());
  for (const edit of edits) {
    const expected = edit.create ? Buffer.from(edit.content) : withBom(edit.content);
    assert.deepEqual(await readFile(diskPath(app, edit.path)), expected);
    assert.equal(result.documents.find(document => document.file.path === edit.path).version, version(expected));
  }
  assert.equal(result.snapshot.files.find(file => file.path === "Source.md").stat.ctime, source.file.stat.ctime);
  await noTransactions(app);
});

test("extraction creation preflight rejects collisions and stale sources, and late failures remove only created targets", async t => {
  const app = await fixture(t);
  const original = withBom("Original source\r\n");
  await put(app, "Source.md", original);
  await put(app, "Occupied.md", "Retain this target.");
  const source = await info(app, "Source.md");
  const creation = { path: "Extracted/Nested/Selection.md", version: null, create: true, content: "Selection\r\n" };
  const update = { path: "Source.md", version: source.version, content: "Link to selection\r\n" };
  for (const [edits, expected] of [
    [[{ ...creation, path: "Occupied.md" }, update], 409],
    [[creation, { ...update, version: "stale" }], 409],
    [[{ ...creation, version: source.version }, update], 400],
  ]) {
    assert.equal((await app.request("/api/files/edit", "POST", { root: app.directory, edits })).status, expected);
    assert.deepEqual(await readFile(diskPath(app, "Source.md")), original);
    assert.equal(await readFile(diskPath(app, "Occupied.md"), "utf8"), "Retain this target.");
    await assert.rejects(stat(diskPath(app, "Extracted")), { code: "ENOENT" });
  }
  const before = await stat(diskPath(app, "Source.md"));
  const outside = diskPath(app, ".creation-snapshot-target");
  const plugins = diskPath(app, ".obsidian/plugins");
  await mkdir(outside);
  await writeFile(join(outside, "Keep.md"), "Retain external data.");
  await symlink(outside, plugins, "junction");
  try {
    assert.equal((await app.request("/api/files/edit", "POST", { root: app.directory, edits: [creation, update] })).status, 400);
    assert.deepEqual(await readFile(diskPath(app, "Source.md")), original);
    assert.equal((await stat(diskPath(app, "Source.md"))).mtimeMs, before.mtimeMs);
    await assert.rejects(stat(diskPath(app, "Extracted")), { code: "ENOENT" });
    assert.equal(await readFile(join(outside, "Keep.md"), "utf8"), "Retain external data.");
    await noTransactions(app);
  } finally {
    await rm(plugins);
  }
});

test("note merge trash and edits commit together and retain source and target on version conflicts", async t => {
  const app = await fixture(t);
  await put(app, "Source.md", withBom("Source text\r\n"));
  await put(app, "Target.md", withBom("Target text\r\n"));
  await put(app, "Incoming.md", "See [[Source]].\r\n");
  const source = await info(app, "Source.md");
  const target = await info(app, "Target.md");
  const incoming = await info(app, "Incoming.md");
  const edits = [
    { path: "Target.md", version: target.version, content: "Target text\r\n\r\nSource text\r\n" },
    { path: "Incoming.md", version: incoming.version, content: "See [[Target]].\r\n" },
  ];
  const body = { root: app.directory, path: "Source.md", version: source.version, edits };
  assert.equal((await app.request("/api/files/trash", "POST", { ...body, edits: [edits[0], { ...edits[1], version: "stale" }] })).status, 409);
  assert.deepEqual(await readFile(diskPath(app, "Source.md")), withBom("Source text\r\n"));
  assert.deepEqual(await readFile(diskPath(app, "Target.md")), withBom("Target text\r\n"));
  const result = await ok(await app.request("/api/files/trash", "POST", body));
  await assert.rejects(stat(diskPath(app, "Source.md")), { code: "ENOENT" });
  assert.deepEqual(await readFile(diskPath(app, result.trashPath)), withBom("Source text\r\n"));
  assert.deepEqual(await readFile(diskPath(app, "Target.md")), withBom(edits[0].content));
  assert.equal(await readFile(diskPath(app, "Incoming.md"), "utf8"), edits[1].content);
  assert.deepEqual(result.documents.map(document => document.file.path).sort(), ["Incoming.md", "Target.md"]);
  await noTransactions(app);
});

test("batch edits reject stale, duplicate, unsafe and unbounded inputs before changing any note", async t => {
  const app = await fixture(t);
  const files = {
    "Notes/First.md": withBom("# First\r\n"),
    "Last.md": Buffer.from("# Last\r\n"),
    "Invalid.md": Buffer.from([0xff, 0xfe, 0]),
    "Attachment.bin": Buffer.from([0, 0xff]),
  };
  for (const [path, bytes] of Object.entries(files)) {
    await put(app, path, bytes);
  }
  await mkdir(diskPath(app, "Directory.md"));
  const before = Object.fromEntries(await Promise.all(Object.keys(files).map(async path => [path, await info(app, path)])));
  const validEdit = { path: "Notes/First.md", version: before["Notes/First.md"].version, content: "This first edit must not be saved.\r\n" };
  const lastEdit = { path: "Last.md", version: before["Last.md"].version, content: "This later edit must not be saved.\r\n" };
  const base = { root: app.directory, edits: [validEdit, lastEdit] };
  const external = Buffer.from("A newer external edit must survive.\r\n");
  await put(app, "Last.md", external);
  assert.equal((await app.request("/api/files/edit", "POST", base)).status, 409);
  await unchanged(app, { ...files, "Last.md": external });
  await put(app, "Last.md", files["Last.md"]);
  const firstStat = await stat(diskPath(app, "Notes/First.md"));
  const attempts = [
    [{ edits: [validEdit] }, 409],
    [{ ...base, root: join(app.directory, "Different vault") }, 409],
    [{ root: app.directory }, 400],
    [{ root: app.directory, edits: null }, 400],
    [{ root: app.directory, edits: [] }, 400],
    [{ root: app.directory, edits: Array(257).fill(validEdit) }, 400],
    [{ ...base, edits: [validEdit, { ...validEdit, path: "notes\\FIRST.md" }] }, 409],
    [{ ...base, edits: [validEdit, { ...lastEdit, version: "stale" }] }, 409],
    [{ ...base, edits: [validEdit, { ...lastEdit, version: null }] }, 428],
    [{ ...base, edits: [validEdit, { ...lastEdit, content: null }] }, 400],
    [{ ...base, edits: [validEdit, null] }, 400],
    [{ ...base, edits: [validEdit, { path: "Invalid.md", version: before["Invalid.md"].version, content: "Not valid UTF-8." }] }, 422],
    [{ ...base, edits: [validEdit, { path: "Attachment.bin", version: before["Attachment.bin"].version, content: "Not Markdown." }] }, 400],
    [{ ...base, edits: [validEdit, { ...lastEdit, path: "Missing.md" }] }, 404],
    [{ ...base, edits: [validEdit, { ...lastEdit, path: "Directory.md" }] }, 400],
    [{ ...base, edits: [validEdit, { ...lastEdit, path: "Notes/First.md/Child.md" }] }, 409],
    [{ ...base, edits: [validEdit, { ...lastEdit, path: ".obsidian/workspace.json" }] }, 400],
  ];
  for (const [body, expectedStatus] of attempts) {
    const response = await app.request("/api/files/edit", "POST", body);
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    assert.ok((await response.json()).error);
    await unchanged(app, files);
    assert.equal((await stat(diskPath(app, "Notes/First.md"))).mtimeMs, firstStat.mtimeMs, "Preflight must not rewrite earlier valid edits");
    await noTransactions(app);
  }
});

test("a later snapshot failure rolls back every batch edit and restores original timestamps", async t => {
  const app = await fixture(t);
  const files = { "First.md": withBom("# First\r\n"), "Last.md": Buffer.from("# Last\r\n") };
  for (const [path, bytes] of Object.entries(files)) {
    await put(app, path, bytes);
  }
  const before = Object.fromEntries(await Promise.all(Object.keys(files).map(async path => [path, { info: await info(app, path), stat: await stat(diskPath(app, path)) }])));
  const outside = diskPath(app, ".batch-failure-target");
  await mkdir(outside);
  await writeFile(join(outside, "Keep.md"), "Do not change the junction target.\r\n");
  const plugins = diskPath(app, ".obsidian/plugins");
  await symlink(outside, plugins, "junction");
  try {
    const response = await app.request("/api/files/edit", "POST", {
      root: app.directory,
      edits: Object.keys(files).map(path => ({ path, version: before[path].info.version, content: "# Updated\r\nThis must be rolled back.\r\n" })),
    });
    assert.equal(response.status, 400, "Reuse the existing post-write linked-plugin snapshot failure fixture");
    await unchanged(app, files);
    for (const path of Object.keys(files)) {
      const after = await stat(diskPath(app, path));
      assert.equal(after.mtimeMs, before[path].stat.mtimeMs, path);
      assert.equal(after.birthtimeMs, before[path].stat.birthtimeMs, path);
      assert.equal((await info(app, path)).version, before[path].info.version, path);
    }
    await noTransactions(app);
    assert.equal(await readFile(join(outside, "Keep.md"), "utf8"), "Do not change the junction target.\r\n");
  } finally {
    await rm(plugins);
  }
  assert.deepEqual((await ok(await app.request("/api/vault"))).files.map(file => file.path).sort(), Object.keys(files).sort());
});
