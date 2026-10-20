import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { root, startHost } from "./host.mjs";

async function fixture(callback) {
  await mkdir(join(root, ".runtime"), { recursive: true });
  const directory = await mkdtemp(join(root, ".runtime", "metadata-api-"));
  let host;
  try {
    const first = join(directory, "First");
    const second = join(directory, "Second");
    await mkdir(join(first, ".obsidian"), { recursive: true });
    await mkdir(second);
    const content = "---\r\ntags: [metadata]\r\n---\r\n# Exact content\r\n";
    await writeFile(join(first, "Note.md"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]));
    await writeFile(join(first, "image.png"), Buffer.from([0, 255, 1, 128]));
    await writeFile(join(second, "Other.md"), "# Other vault\n");
    host = await startHost(first);
    await callback({ host, first, second, content });
  } finally {
    if (host) {
      await host.stop();
    }
    await rm(directory, { recursive: true });
  }
}

async function json(host, route, root) {
  const response = await host.request(route + "?root=" + encodeURIComponent(root));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function changed(host, root, revision) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await json(host, "/api/vault/revision", root);
    if (state.revision > revision) {
      return state;
    }
    await delay(25);
  }
  assert.fail("The actual filesystem mutation did not advance the selected vault revision.");
}

test("metadata reads exact Markdown documents without decoding binary attachments or hiding invalid UTF-8", async () => {
  await fixture(async ({ host, first, content }) => {
    const original = '{"unknown":{"keep":true}}\r\n';
    await writeFile(join(first, ".obsidian", "workspace.json"), original);
    await writeFile(join(first, "Invalid.md"), Buffer.from([0xff, 0xfe, 0x00]));
    const payload = await json(host, "/api/metadata/documents", first);
    assert.equal(payload.root, first);
    assert.deepEqual(payload.documents.map(document => document.file.path), ["Note.md"]);
    assert.equal(payload.documents[0].content, content);
    const note = await (await host.request("/api/file?path=Note.md")).json();
    assert.equal(payload.documents[0].version, note.version);
    assert.deepEqual(payload.errors, [{ path: "Invalid.md", message: "This Markdown file is not UTF-8 and could not be indexed." }]);
    assert.equal(await readFile(join(first, ".obsidian", "workspace.json"), "utf8"), original);
    assert.deepEqual(await readFile(join(first, "image.png")), Buffer.from([0, 255, 1, 128]));
  });
});

test("actual external edits, empty folders and renames advance filesystem revisions while private config does not", async () => {
  await fixture(async ({ host, first }) => {
    const initial = await json(host, "/api/vault/revision", first);
    await writeFile(join(first, ".obsidian", "private.json"), '{"private":true}');
    await delay(200);
    assert.equal((await json(host, "/api/vault/revision", first)).revision, initial.revision);
    await writeFile(join(first, "Note.md"), "# Changed externally\r\n[[New target]]\r\n");
    let state = await changed(host, first, initial.revision);
    assert.equal((await json(host, "/api/metadata/documents", first)).documents[0].content, "# Changed externally\r\n[[New target]]\r\n");
    await mkdir(join(first, "Empty"));
    state = await changed(host, first, state.revision);
    assert.ok((await (await host.request("/api/vault")).json()).folders.includes("Empty"));
    await rename(join(first, "Note.md"), join(first, "Moved.md"));
    await changed(host, first, state.revision);
    assert.deepEqual((await json(host, "/api/metadata/documents", first)).documents.map(document => document.file.path), ["Moved.md"]);
  });
});

test("metadata requests reject stale roots and stop observing the previous vault after selection changes", async () => {
  await fixture(async ({ host, first, second }) => {
    for (const route of ["/api/vault/revision", "/api/metadata/documents"]) {
      assert.equal((await host.request(route)).status, 409);
      assert.equal((await host.request(route + "?root=" + encodeURIComponent(second))).status, 409);
    }
    assert.equal((await host.request("/api/vault/open", "POST", { path: second })).status, 200);
    const state = await json(host, "/api/vault/revision", second);
    await writeFile(join(first, "Note.md"), "# Old vault is not watched\n");
    await delay(200);
    assert.equal((await json(host, "/api/vault/revision", second)).revision, state.revision);
    assert.deepEqual((await json(host, "/api/metadata/documents", second)).documents.map(document => document.file.path), ["Other.md"]);
    for (const route of ["/api/vault/revision", "/api/metadata/documents"]) {
      assert.equal((await host.request(route + "?root=" + encodeURIComponent(first))).status, 409);
    }
  });
});

test("parallel metadata reads retain exact source order, versions, content, BOM and UTF-8 errors", async () => {
  await fixture(async ({ host, first }) => {
    for (let index = 0; index < 160; index++) {
      const folder = index % 2 ? "b" : "A";
      await mkdir(join(first, folder), { recursive: true });
      const body = Buffer.from(`# Note ${index} \u00e9\n`);
      const bytes = index % 7 === 0 ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
      await writeFile(join(first, folder, `n${String(index).padStart(3, "0")}.md`), bytes);
    }
    await writeFile(join(first, "A", "bad1.md"), Buffer.from([0xff, 0xfe]));
    await writeFile(join(first, "b", "bad2.md"), Buffer.from([0xc3, 0x28]));
    const payload = await json(host, "/api/metadata/documents", first);
    const paths = payload.documents.map(document => document.file.path);
    assert.deepEqual(paths, [...paths].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    assert.equal(paths.length, 161);
    assert.deepEqual(payload.errors.map(error => error.path), ["A/bad1.md", "b/bad2.md"]);
    for (const document of payload.documents.filter((_, index) => index % 13 === 0)) {
      const single = await (await host.request("/api/file?path=" + encodeURIComponent(document.file.path))).json();
      assert.equal(document.version, single.version);
      assert.equal(document.content, single.content);
      assert.equal(document.hasBom, single.hasBom);
    }
    await rm(join(first, "A", "n000.md"));
    await changed(host, first, payload.revision);
    assert.equal((await json(host, "/api/metadata/documents", first)).documents.length, 160);
  });
});

test("same-size same-mtime edits remain visible and a cancelled metadata request leaves the host usable", async () => {
  await fixture(async ({ host, first }) => {
    const target = join(first, "Same.md");
    await writeFile(target, "AAAA\n");
    const before = await json(host, "/api/metadata/documents", first);
    const stamp = (await stat(target)).mtime;
    await writeFile(target, "BBBB\n");
    await utimes(target, stamp, stamp);
    const after = await json(host, "/api/metadata/documents", first);
    const document = payload => payload.documents.find(item => item.file.path === "Same.md");
    assert.equal(document(before).content, "AAAA\n");
    assert.equal(document(after).content, "BBBB\n");
    assert.notEqual(document(after).version, document(before).version);
    for (let index = 0; index < 400; index++) {
      await writeFile(join(first, `bulk${index}.md`), "x".repeat(2000));
    }
    const controller = new AbortController();
    const pending = host.request("/api/metadata/documents?root=" + encodeURIComponent(first), "GET", undefined, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal((await host.request("/api/metadata/documents?root=" + encodeURIComponent(first))).status, 200);
  });
});
