import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";

const pluginId = "draft-text-probe", viewType = "draft-text-probe-view";
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const pluginSource = String.raw`
const { Plugin, TextFileView } = require("obsidian");
class Probe extends TextFileView {
  constructor(leaf) { super(leaf); this.enableDraftRecovery(); this.value = ""; }
  getViewType() { return "draft-text-probe-view"; }
  async onOpen() { this.input = this.contentEl.createEl("textarea", { attr: { "data-draft-probe": "" } }); this.registerDomEvent(this.input, "input", () => { this.value = this.input.value; this.requestSave(); }); }
  getViewData() { globalThis.draftProbeSerialised = (globalThis.draftProbeSerialised ?? 0) + 1; return this.value; }
  setViewData(data) { this.value = data; if (this.input) { this.input.value = data; } }
  clear() { this.value = ""; }
}
module.exports = class extends Plugin { onload() { this.registerView("draft-text-probe-view", leaf => new Probe(leaf)); this.registerExtensions(["draftprobe"], "draft-text-probe-view"); } };
`;

// Real-host recovery of durable Canvas, Bases and opted-in plugin text drafts. Same `kind`/harness contract as checkPersistentDrafts.
// Not executed without a UI lease; a run is accepted only with paired builds and unchanged coreVerificationInputs.
export async function checkNonMarkdownDrafts({ kind, directory, evaluate, click, wait, report, lose, reconnect, restart }) {
  const checks = report.nonMarkdownDrafts = { kind, checks: [] };
  const pass = message => { checks.checks.push(message); report.checks?.push(message); };
  const file = path => join(directory, ...path.split("/"));
  const canvasBytes = Buffer.concat([BOM, Buffer.from(JSON.stringify({ future: { keep: [1, null] }, nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "Original", opaque: { keep: true } }], edges: [] }, null, 2) + "\n")]);
  const baseBytes = Buffer.from("views:\n  - type: table\n    name: Table\n");
  const plugin = join(directory, ".obsidian", "plugins", pluginId);
  await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, "manifest.json"), JSON.stringify({ id: pluginId, name: "Draft text probe", version: "1.0.0", description: "Opt-in TextFileView draft fixture", isDesktopOnly: false }));
  await writeFile(join(plugin, "main.js"), pluginSource);
  const pluginBytes = Buffer.from("plugin original\n");
  const originals = new Map([["Draft Board.canvas", canvasBytes], ["Draft Table.base", baseBytes], ["Draft Probe.draftprobe", pluginBytes]]);
  for (const [path, bytes] of originals) { await writeFile(file(path), bytes); }
  assert.equal(typeof restart, "function", "the runner must supply a real restart hook so the probe plugin is discovered from disk");
  await restart();
  await wait(`app.plugins.installedPlugins.some(m=>m.id===${JSON.stringify(pluginId)})`, "the restarted app discovered the draft-text-probe package", 40000);
  assert.equal(await evaluate(`app.plugins.installedPlugins.some(m=>m.id===${JSON.stringify(pluginId)})`), true, "probe package was not discovered; refusing to inject or toggle it manually");
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true);
  await click(".settings-close");
  const unchanged = async () => { for (const [path, bytes] of originals) { assert.deepEqual(await readFile(file(path)), bytes, path + " source bytes changed"); } };

  await evaluate("app.markdownAutosave?.setEnabled?.(false)");
  for (const path of originals.keys()) { await evaluate(`app.openFile(${JSON.stringify(path)},"tab")`); }
  const view = path => `app.workspace.leaves().map(l=>l.view).find(v=>v.file?.path===${JSON.stringify(path)})`;
  await evaluate(`${view("Draft Board.canvas")}.canvas.edit(data=>{data.nodes[0].text="Unsaved canvas text"})`);
  await evaluate(`${view("Draft Table.base")}.commit("views:\\n  - type: table\\n    name: Renamed\\n")`);
  await evaluate(`(()=>{const v=${view("Draft Probe.draftprobe")};v.input.value="plugin unsaved";v.input.dispatchEvent(new Event("input"))})()`);
  await wait(`${view("Draft Board.canvas")}.captureDraft().state==="dirty"&&${view("Draft Table.base")}.captureDraft().state==="dirty"&&${view("Draft Probe.draftprobe")}.captureDraft().state==="dirty"`, "three dirty non-Markdown owners");
  const drained = await evaluate("slopsidianDraftCapture.flush().then(s=>({protecting:s.protecting,failures:s.failures}))");
  assert.deepEqual(drained.failures, []);
  assert.ok(drained.protecting >= 3, JSON.stringify(drained));
  await unchanged();
  pass(kind + ": dirty Canvas, Bases and plugin TextFileView text drained into durable storage with the sources untouched.");

  // The plugin serialiser must not run during teardown/host failure.
  await evaluate("globalThis.draftProbeSerialised=0");
  const lost = await lose();
  await unchanged();
  await reconnect();
  checks.lost = lost;
  await wait('Boolean(document.querySelector("[data-draft-startup-review]"))', "startup notice for non-Markdown drafts");
  await click("[data-draft-startup-review]");
  await wait('document.querySelectorAll("[data-persistent-draft-review] [data-draft-provider]").length>=3', "provider-labelled drafts listed", 40000);
  const labels = await evaluate('[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].map(x=>[x.querySelector("h3").textContent,x.querySelector("[data-draft-provider]")?.dataset.draftProvider])');
  const byPath = new Map(labels);
  assert.equal(byPath.get("Draft Board.canvas"), "core:canvas");
  assert.equal(byPath.get("Draft Table.base"), "core:bases");
  assert.equal(byPath.get("Draft Probe.draftprobe"), "view:" + viewType);
  pass(kind + ": after the host was lost the restarted app listed Canvas, Bases and plugin drafts with their providers.");

  // Create-only restore keeps the extension, unknown JSON and exact BOM bytes; the plugin draft is saved only as new.
  const recoverable = async (name, needsReplace = false) => {
    const locate = `[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].find(x=>x.querySelector("h3").textContent===${JSON.stringify(name)})`;
    try {
      await wait(`(()=>{const s=${locate};if(s?.querySelector("details")&&s.querySelector("[data-draft-source]")&&s.querySelector("[data-draft-destination]")&&s.querySelector("[data-draft-save-new]")&&(!${JSON.stringify(needsReplace)}||s.querySelector("[data-draft-replace]")))return true;document.querySelector("[data-persistent-draft-review] [data-draft-refresh]")?.click();return false})()`, name + " fully rendered and recoverable after the lost host's lease", 60000);
    } catch (error) {
      const state = await evaluate(`JSON.stringify({section:(${locate})?.outerHTML??null,owners:[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].map(x=>[x.querySelector("h3")?.textContent,x.querySelector("[data-draft-provider]")?.dataset.draftProvider,x.querySelector("[data-draft-source]")?.dataset.draftSource??null,/Another window currently holds|still editing/.test(x.textContent)?"held-by-another-or-this-window":"not-held",Boolean(x.querySelector("details"))])})`);
      throw new Error(error.message + " Review state: " + state, { cause: error });
    }
  };
  const restore = async (name, destination) => {
    await recoverable(name);
    await evaluate(`(()=>{const s=[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].find(x=>x.querySelector("h3").textContent===${JSON.stringify(name)});s.setAttribute("data-draft-under-test","");s.querySelector("details").open=true;s.querySelector("[data-draft-destination]").value=${JSON.stringify(destination)}})()`);
    await click("[data-draft-under-test] [data-draft-save-new]");
    await wait(`![...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent===${JSON.stringify(name)})`, "restored " + name);
  };
  await restore("Draft Board.canvas", "Recovered/Board.canvas");
  const restoredCanvas = await readFile(file("Recovered/Board.canvas"));
  assert.deepEqual(restoredCanvas.subarray(0, 3), BOM);
  const parsed = JSON.parse(restoredCanvas.subarray(3).toString("utf8"));
  assert.equal(parsed.nodes[0].text, "Unsaved canvas text");
  assert.deepEqual(parsed.future, { keep: [1, null] });
  assert.deepEqual(parsed.nodes[0].opaque, { keep: true });
  await restore("Draft Probe.draftprobe", "Recovered/Probe.draftprobe");
  assert.equal(await readFile(file("Recovered/Probe.draftprobe"), "utf8"), "plugin unsaved");
  await unchanged();
  pass(kind + ": create-only restore wrote .canvas/.draftprobe with exact bytes, kept BOM and unknown JSON, and left every source untouched.");

  // Held write: the real Replace click runs inside Workspace.withFileMutation while the host write is paused.
  await evaluate("app.openFile('Draft Table.base','tab')");
  await wait(`${view("Draft Table.base")}.captureDraft().state==="clean"`, "clean Bases view open on the replace target");
  await evaluate("app.openFile('Draft Board.canvas','tab')");
  await wait(`${view("Draft Board.canvas")}.captureDraft().state==="clean"`, "clean Canvas view after restart");
  await evaluate(`${view("Draft Board.canvas")}.canvas.edit(data=>{data.nodes[0].text="Canvas before hold"})`);
  await wait(`${view("Draft Board.canvas")}.captureDraft().state==="dirty"`, "dirty Canvas before the held write");
  const canvasBefore = await evaluate(`(()=>{const v=${view("Draft Board.canvas")};return JSON.stringify([v.getViewData(),v.captureDraft()])})()`);
  const baseBefore = await evaluate(`(()=>{const v=${view("Draft Table.base")};return JSON.stringify([v.getViewData(),v.captureDraft()])})()`);
  await evaluate(`(()=>{const v=app.vault,write=v.writeDocument.bind(v);globalThis.heldWrite={entered:false,release:null};v.writeDocument=async(...args)=>{if(args[0]==="Draft Table.base"&&!args[3]){heldWrite.entered=true;await new Promise(resolve=>{heldWrite.release=resolve})}return write(...args)};heldWrite.restore=()=>{v.writeDocument=write}})()`);
  await recoverable("Draft Table.base", true);
  await evaluate(`(()=>{const s=[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].find(x=>x.querySelector("h3").textContent==="Draft Table.base");s.setAttribute("data-draft-under-test","");s.querySelector("details").open=true})()`);
  await click("[data-draft-under-test] [data-draft-replace]");
  await wait("heldWrite.entered&&app.workspace.isChangingFiles", "replace is held inside the file-mutation barrier");
  const attempt = await evaluate(`(async()=>{try{${view("Draft Table.base")}.commit("views:\\n  - type: table\\n    name: Typed during hold\\n");return "accepted"}catch(error){return error.message}})()`);
  assert.match(attempt, /Vault files are being changed/);
  assert.equal(await evaluate(`${view("Draft Table.base")}.captureDraft().state`), "clean", "a control attempted during the held write must not make the view dirty");
  assert.deepEqual(await readFile(file("Draft Table.base")), baseBytes, "the source must stay untouched while the write is held");
  await evaluate(`(()=>{const c=${view("Draft Board.canvas")}.canvas;c.edit(data=>{data.nodes[0].text="Canvas typed during hold"});c.undo();c.redo();c.undo()})()`);
  const snapshot = view => evaluate(`(()=>{const v=${view};return JSON.stringify([v.getViewData(),v.captureDraft()])})()`);
  assert.equal(await snapshot(view("Draft Board.canvas")), canvasBefore, "Canvas edit/undo/redo during the held write must not change its buffer or captured revision");
  assert.equal(await snapshot(view("Draft Table.base")), baseBefore, "the Bases buffer and captured revision must be unchanged during the held write");
  assert.deepEqual(await readFile(file("Draft Board.canvas")), canvasBytes, "the Canvas source must stay untouched while the write is held");
  const draftsDuring = await evaluate('[...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent==="Draft Table.base")');
  assert.equal(draftsDuring, true, "the draft record must survive until the write succeeded");
  await evaluate("heldWrite.release();heldWrite.restore()");
  await wait('![...document.querySelectorAll("[data-persistent-draft-review] [data-draft-id]")].some(x=>x.querySelector("h3").textContent==="Draft Table.base")&&!app.workspace.isChangingFiles', "held replace completed and released the barrier", 40000);
  const replaced = await readFile(file("Draft Table.base"), "utf8");
  assert.match(replaced, /name: Renamed/);
  assert.doesNotMatch(replaced, /Typed during hold/);
  assert.equal(await evaluate(`${view("Draft Board.canvas")}.captureDraft().state`), "dirty", "the unrelated dirty Canvas owner must survive the release");
  assert.match(await evaluate(`${view("Draft Board.canvas")}.getViewData()`), /Canvas before hold/);
  assert.deepEqual(await readFile(file("Draft Board.canvas")), canvasBytes, "the Canvas source must stay untouched after the release");
  pass(kind + ": a held reviewed Replace kept the barrier engaged, refused Canvas edit/undo/redo and a Bases edit made meanwhile with buffers, captured revisions and source bytes intact, left the source and draft intact until the write finished, then wrote only the reviewed text. Arbitrary trusted plugin code is not sandboxed by this barrier.");
  report.nonMarkdownDraftsGuarantees = "Best-effort capture of Canvas, Bases and opted-in plugin text through the shared draft store; plugin serialisers are not called at teardown or host failure, plugin recovery is partial, and OS/power-loss durability and storage eviction are not claimed. The file-mutation barrier covers built-in Canvas/Bases controls and the inert shell, not arbitrary trusted plugin code.";
}
