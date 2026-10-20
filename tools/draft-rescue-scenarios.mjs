import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkDraftRescue({ directory, profile, evaluate, command, click, press, wait, report, capture, interruptBackend, readRescueResults, stop, restart, afterReload }) {
  const pass = text => report.checks.push(text);
  const originals = new Map([
    ["Rescue CRLF 中文.md", Buffer.from("\ufeff# Original CRLF\r\n\r\nSaved 中文.\r\n")],
    ["Rescue LF λ.md", Buffer.from("# Original LF\n\nSaved e\u0301 and λ.\n")],
    ["rescue-sentinel.bin", Buffer.from([0, 255, 13, 10, 1, 2, 3])],
  ]);
  const poll = async (callback, description) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const value = await callback();
      if (value) { return value; }
      await delay(50);
    }
    throw new Error("Timed out: " + description);
  };
  const unchanged = async () => {
    for (const [path, bytes] of originals) { assert.deepEqual(await readFile(join(directory, path)), bytes, path); }
  };
  const verifyCopies = async (result, snapshot) => {
    assert.equal(result.complete, true, JSON.stringify(result));
    assert.equal(result.copied, snapshot.drafts.length);
    assert.equal(result.total, snapshot.drafts.length);
    assert.deepEqual(result.errors, []);
    const rel = relative(join(profile, "draft-rescue"), result.directory);
    assert.ok(rel && !rel.startsWith("..") && !rel.includes(":"));
    const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(manifest.errors, []);
    assert.equal(manifest.drafts.length, snapshot.drafts.length);
    for (const draft of snapshot.drafts) {
      const entry = manifest.drafts.find(item => item.sourcePath === draft.sourcePath);
      assert.ok(entry);
      assert.equal(entry.sourceRoot, directory);
      assert.equal(entry.sourceVersion, draft.sourceVersion);
      assert.equal(entry.hasBom, draft.hasBom);
      assert.equal(entry.copied, true);
      const bytes = Buffer.from((draft.hasBom ? "\ufeff" : "") + draft.content);
      assert.deepEqual(await readFile(join(result.directory, entry.file)), bytes);
      assert.equal(entry.bytes, bytes.length);
      assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
    }
    return manifest;
  };
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  for (const [path, bytes] of originals) { await writeFile(join(directory, path), bytes); }
  await evaluate("app.vault.refresh()");
  const paths = [...originals.keys()].filter(path => path.endsWith(".md"));
  const type = async (path, mode, suffix) => {
    await evaluate(`(async()=>{await app.openFile(${JSON.stringify(path)},"tab");app.workspace.activeLeaf.view.setEditingMode(${JSON.stringify(mode)})})()`);
    await evaluate('document.querySelectorAll("[data-draft-rescue-editor]").forEach(el=>el.removeAttribute("data-draft-rescue-editor"));app.editor.cm.contentDOM.dataset.draftRescueEditor="active"');
    await click('[data-draft-rescue-editor="active"]');
    await press("End", "End", 35, 2);
    await command("Input.insertText", { text: suffix });
    await wait(`app.workspace.sessions.get(${JSON.stringify(path)})?.dirty`, "typed unsaved Markdown");
  };
  await type(paths[0], "source", "Unsaved CRLF draft 😀.\n");
  await evaluate(`app.openFile(${JSON.stringify(paths[0])},"split")`);
  assert.equal(await evaluate(`app.workspace.leaves().filter(leaf=>leaf.session?.document.file.path===${JSON.stringify(paths[0])}).length`), 2);
  await type(paths[1], "live-preview", "Unsaved LF draft 中文.\n");
  const snapshot = await evaluate("slopsidian.captureMarkdownDrafts()");
  assert.equal(snapshot.drafts.length, 2, "Shared panes must produce one draft per note");
  assert.equal(snapshot.drafts[0].hasBom, true);
  assert.ok(snapshot.drafts[0].content.includes("\r\nUnsaved CRLF draft 😀.\r\n"));
  assert.ok(snapshot.drafts[1].content.includes("\nUnsaved LF draft 中文.\n"));
  assert.ok(snapshot.drafts.every(item => item.sourceRoot === directory));
  await unchanged();
  pass("Real source/live-preview typing creates two canonical unsaved drafts across three panes; BOM/CRLF/LF/Unicode and original vault ownership are retained without saving source notes.");
  const interrupted = [await interruptBackend()];
  const rescued = await poll(() => readRescueResults().find(item => item.reason === "unexpected-host-exit"), "host-exit rescue");
  const manifest = await verifyCopies(rescued, snapshot);
  assert.deepEqual((await evaluate("slopsidian.captureMarkdownDrafts()")).drafts, snapshot.drafts);
  await unchanged();
  await capture("retained-window");
  pass("Terminating only the verified owned .NET child keeps Electron and its original document sessions alive and writes exact new profile Markdown copies with identifying metadata and hashes.");
  // A public Editor callback can still update the live model under Blazor's reconnect overlay.
  await evaluate('app.editor.replaceRange("Late callback edit λ.\\n",app.editor.getCursor("to"))');
  const latest = await evaluate("slopsidian.captureMarkdownDrafts()");
  assert.notDeepEqual(latest.drafts, snapshot.drafts);
  const stopped = await stop();
  assert.equal(stopped.exitCode, 0);
  assert.equal(stopped.exitSignal, null);
  assert.equal(stopped.deadlineExpired, false);
  const closing = await poll(() => readRescueResults().find(item => item.reason === "close-after-host-exit"), "close-time rescue");
  await verifyCopies(closing, latest);
  assert.notEqual(closing.directory, rescued.directory);
  await verifyCopies(rescued, snapshot);
  await unchanged();
  pass("An explicit close captures a late public Editor callback into a fresh folder, retains earlier copies byte-exact, and exits normally without the smoke deadline or source-note overwrite.");
  const beforeRestart = await readdir(join(profile, "draft-rescue"));
  await restart();
  await afterReload();
  assert.equal((await evaluate("slopsidian.captureMarkdownDrafts()")).drafts.length, 0);
  await unchanged();
  interrupted.push(await interruptBackend());
  const clean = await poll(() => readRescueResults().find(item => item.reason === "unexpected-host-exit"), "clean host-exit capture");
  assert.deepEqual({ directory: clean.directory, total: clean.total, copied: clean.copied, complete: clean.complete, errors: clean.errors }, { directory: null, total: 0, copied: 0, complete: true, errors: [] });
  await stop();
  assert.deepEqual(await readdir(join(profile, "draft-rescue")), beforeRestart);
  await unchanged();
  pass("A new desktop session loads saved notes without replaying rescue files; a clean interrupted host and unchanged close create no additional rescue folder.");
  report.draftRescue = { interrupted, profile, firstCapture: rescued, closeCapture: closing, cleanCapture: clean, manifest, notePaths: paths,
    scope: "Real Windows owned-host fault injection and real editor typing; the late edit uses the public Editor API. Smoke mode suppresses native recovery dialogs and accepts its explicit close; OS dialog buttons/Explorer, renderer/OS/power-loss and WASM recovery are outside this scenario." };
}
