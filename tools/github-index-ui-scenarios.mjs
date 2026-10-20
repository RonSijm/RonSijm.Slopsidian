import assert from "node:assert/strict";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export const indexUiNotes = [["Index A.md", "# A\n[[Index B]] #idx\n"], ["Index B.md", "# B\n[[Index C]] #idx\n"], ["Index C.md", "# C\n#idx\n"]];

const idb = (evaluate, body) => evaluate(`(async()=>{const open=indexedDB.open("slopsidian-github-vault-v1",1),db=await new Promise((ok,no)=>{open.onsuccess=()=>ok(open.result);open.onerror=()=>no(open.error);});try{const store=()=>db.transaction("entries","readwrite").objectStore("entries");const run=request=>new Promise((ok,no)=>{request.onsuccess=()=>ok(request.result);request.onerror=()=>no(request.error);});${body}}finally{db.close();}})()`);
const indexState = `(document.querySelector("[data-github-index-state]")?.dataset.githubIndexState ?? null)`;
const indexStatus = `(document.querySelector("[data-github-index-status]")?.textContent ?? "")`;

// Every in-page wait the scenario issues, exported so tests can compile and evaluate them against fake DOM states.
export const indexUiWaits = {
  dialog: `Boolean(document.querySelector("[data-github-offline-dialog] [data-github-index-prepare]"))`,
  initial: `${indexState} === "none"`,
  held: `window.__indexHold.held === 1 && /Verifying 1 of 3/.test(${indexStatus})`,
  cancelRegistered: `document.querySelector("[data-github-index-cancel]").disabled === true`,
  cancelled: `${indexState} === "partial" && /cancelled/i.test(${indexStatus}) && document.querySelector("[data-github-index-prepare]").textContent === "Resume index"`,
  missing: `${indexState} === "refused" && /Not cached: Index C\\.md/.test(${indexStatus})`,
  corrupt: `${indexState} === "refused" && /Corrupt: Index C\\.md/.test(${indexStatus})`,
  complete: `${indexState} === "complete" && /3 of 3 notes/.test(${indexStatus})`,
  completeMetadata: `/complete index/i.test(document.getElementById("metadata-status").textContent)`,
  mount: id => `typeof app !== "undefined" && app.githubVaults?.state()?.cached === true && app.vault?.rootPath === ${JSON.stringify(id)}`,
  note: `app.workspace.getActiveFile()?.path === "Index A.md"`,
};

/**
 * Drives the real "Offline GitHub vault" modal on a cache-only mount with real pointers: Prepare, a Cancel held through the real SHA-256
 * verification of one note, Resume, missing and corrupt refusal, then a verified complete index. It never calls prepareIndex directly,
 * never stubs a successful index, and the digest hold is always released and removed in `finally`.
 * `seeded` is an already-mounted fixture from mountCachedGitHub; otherwise the notes are seeded and mounted in the running app first.
 * `click` must be a real pointer click; `mark` records the cancel boundary for hosts that audit aborted requests.
 */
export async function checkGitHubIndexUi({ evaluate, click, wait, label = "index-ui", seeded = null, mark = () => {}, report = null, notes = indexUiNotes }) {
  const record = report ? (report.githubIndexUi = { label, steps: [] }) : { steps: [] };
  const step = (name, detail = {}) => record.steps.push({ name, ...detail });
  const until = async (expression, name, timeout) => {
    try { return await wait(expression, name, timeout); }
    catch (error) {
      const last = await evaluate(`({ state: ${indexState}, status: ${indexStatus}, prepare: document.querySelector("[data-github-index-prepare]")?.textContent ?? null, metadata: document.getElementById("metadata-status")?.textContent ?? null })`).catch(reason => String(reason));
      throw new Error(`${error.message} | last index UI: ${JSON.stringify(last)}`);
    }
  };
  const mount = seeded ?? await mountCachedGitHub(evaluate, label, notes);
  const blobC = mount.blobs[2].key, heldBytes = Buffer.from(notes[1][1]).toString("base64");
  await until(indexUiWaits.mount(mount.mount.id), "the cached mount", 60000);
  await evaluate(`(async () => { if (app.workspace.getActiveFile()?.path !== "Index A.md") { await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Index A.md")); } })()`);
  await until(indexUiWaits.note, "the cached mount note", 60000);
  const metadata = () => evaluate(`document.getElementById("metadata-status").textContent`);
  const coverage = () => evaluate(`({ documents: app.metadataCache.getDocuments().length, idx: app.metadataCache.getTags()["#idx"] ?? 0, backlinksToC: app.metadataCache.getBacklinksForFile(app.vault.getAbstractFileByPath("Index C.md")).count(), complete: app.vault.indexComplete })`);
  const counters = () => evaluate(`app.githubVaults.state().counters`);
  const partial = { documents: 1, idx: 1, backlinksToC: 0, complete: false };

  const mountKey = "mount:" + mount.mount.id, mountEntry = () => idb(evaluate, `return JSON.stringify(await run(store().get(${JSON.stringify(mountKey)})))`);
  const mountBefore = await mountEntry();
  assert.ok(mountBefore && mountBefore !== "undefined", "The cached mount record exists.");
  assert.equal(await evaluate(`app.vault.lazy`), true, "Mounting stays lazy.");
  assert.deepEqual(await coverage(), partial);
  assert.match(await metadata(), /partial index/i);
  step("lazy-mount", { coverage: await coverage() });

  await click("#github-vault-offline");
  await until(indexUiWaits.dialog, "the index dialog", 30000);
  await until(indexUiWaits.initial, "the initial index status to load", 30000);
  step("dialog-open");

  // Hold the real cached read of note B (its SHA-256 verification) so Cancel is deterministic.
  await evaluate(`(() => { const target = Uint8Array.from(atob(${JSON.stringify(heldBytes)}), char => char.charCodeAt(0)); let release; const gate = new Promise(resolve => { release = resolve; }); const original = crypto.subtle.digest; const digest = original.bind(crypto.subtle); window.__indexHold = { release, held: 0, original }; crypto.subtle.digest = async (algorithm, data) => { const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); if ((algorithm?.name ?? algorithm) === "SHA-256" && bytes.length === target.length && bytes.every((byte, index) => byte === target[index])) { window.__indexHold.held++; await gate; } return digest(algorithm, data); }; })()`);
  try {
    await click("[data-github-offline-dialog] [data-github-index-prepare]");
    await until(indexUiWaits.held, "note A verified and note B held", 30000);
    assert.equal(await evaluate(indexState), "running");
    assert.equal((await coverage()).complete, false);
    mark("cancel");
    await click("[data-github-offline-dialog] [data-github-index-cancel]");
    await until(indexUiWaits.cancelRegistered, "the cancel request to register", 10000);
  } finally {
    await evaluate(`(() => { const hold = window.__indexHold; if (!hold) { return; } hold.release(); delete crypto.subtle.digest; delete window.__indexHold; })()`);
  }
  await until(indexUiWaits.cancelled, "the cancelled partial state", 30000);
  assert.deepEqual(await coverage(), partial, "A cancelled index must not claim or expose complete coverage.");
  assert.match(await metadata(), /partial index/i);
  step("cancelled", { status: await evaluate(indexStatus) });

  const good = await idb(evaluate, `return Array.from(new Uint8Array(await run(store().get(${JSON.stringify(blobC)})).then(entry => entry.value)))`);
  try {
    await idb(evaluate, `await run(store().delete(${JSON.stringify(blobC)}))`);
    await click("[data-github-offline-dialog] [data-github-index-prepare]");
    await until(indexUiWaits.missing, "the missing-byte refusal", 30000);
    assert.equal((await coverage()).complete, false);
    assert.match(await metadata(), /partial index/i);
    step("missing-refused", { status: await evaluate(indexStatus) });

    await idb(evaluate, `await run(store().put({ key: ${JSON.stringify(blobC)}, value: new Uint8Array(${JSON.stringify(good)}.map(byte => byte ^ 1)).buffer }))`);
    await click("[data-github-offline-dialog] [data-github-index-prepare]");
    await until(indexUiWaits.corrupt, "the corrupt-byte refusal", 30000);
    assert.equal((await coverage()).complete, false);
    assert.match(await metadata(), /partial index/i);
    step("corrupt-refused", { status: await evaluate(indexStatus) });
  } finally {
    // Always restore the exact original bytes so a failed step cannot leave a damaged fixture cache.
    await idb(evaluate, `await run(store().put({ key: ${JSON.stringify(blobC)}, value: new Uint8Array(${JSON.stringify(good)}).buffer }))`);
  }
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await until(indexUiWaits.complete, "the complete index", 30000);
  await until(indexUiWaits.completeMetadata, "the complete metadata status", 30000);
  assert.deepEqual(await coverage(), { documents: 3, idx: 3, backlinksToC: 1, complete: true });
  assert.equal(await evaluate(`document.querySelector("[data-github-index-prepare]").disabled`), true);
  const final = await counters();
  assert.equal(final.raw, 0, "No raw download."); assert.equal(final.api ?? 0, 0, "No API call.");
  await assertCachedBlobsUnchanged(evaluate, mount.blobs);
  assert.equal(await mountEntry(), mountBefore, "The cached mount record (inventory and configuration) must not change.");
  step("complete", { coverage: await coverage(), counters: final });
  return record;
}
