import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

export async function checkWorkspaceStartup({ directory, evaluate, command, click, press, wait, handleDialog, report, restart, capture }) {
  const pass = message => report.checks.push(message), originalPath = join(directory, ".obsidian/workspace.json"), savedPath = join(directory, ".obsidian/vault-dotnet-workspace.json");
  const optional = path => readFile(path).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const install = async (path, bytes) => { if (bytes === null) { await unlink(path).catch(error => { if (error.code !== "ENOENT") { throw error; } }); } else { await writeFile(path, bytes); } };
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  const beforeOriginal = await optional(originalPath), beforeSaved = await optional(savedPath), coreEnabled = await evaluate('app.core.isEnabled("workspaces")');
  report.initialOriginalWorkspace = beforeOriginal?.toString("utf8").replace(/^\ufeff/, "") ?? null;
  if (coreEnabled) { await evaluate('app.core.setEnabled("workspaces",false)'); }
  const folder = "Startup import"; await mkdir(join(directory, folder));
  const alpha = Buffer.from("\ufeff# Alpha\r\n\r\nUnicode λ and 中文.\r\n"), beta = Buffer.from("# Beta\n\nReading pane.\n");
  await writeFile(join(directory, folder, "Alpha.md"), alpha); await writeFile(join(directory, folder, "Beta.md"), beta);
  const leaf = (id, file, mode = "source") => ({ id, type: "leaf", pinned: true, state: { type: "markdown", state: { file: folder + "/" + file + ".md", mode, source: false, future: { keep: id } } } });
  const original = { main: { id: "startup-main", type: "split", direction: "vertical", children: [
    { id: "startup-left", type: "tabs", dimension: 63, currentTab: 0, children: [leaf("startup-alpha", "Alpha")] },
    { id: "startup-right", type: "tabs", dimension: 37, currentTab: 0, children: [leaf("startup-beta", "Beta", "preview")] },
  ] }, active: "startup-alpha", left: { id: "startup-sidebar-left", type: "split", direction: "horizontal", width: 290, children: [] },
  right: { id: "startup-sidebar-right", type: "split", direction: "horizontal", width: 220, collapsed: true, children: [{ id: "startup-side-tabs", type: "tabs", children: [{ id: "startup-unknown", type: "leaf", pinned: true, state: { type: "startup-unavailable", state: { opaque: { keep: [42, true] } } } }] }] },
  floating: { retained: true }, future: { literal: "No code is executed from layout JSON" } };
  const bytes = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  let source = bytes(original);
  await restart(async () => { await writeFile(originalPath, source); await install(savedPath, null); });
  await wait('app.workspace.getLeafById("startup-alpha")?.view.getViewType()==="markdown"', "first-open original Markdown panes");
  assert.equal(await evaluate('app.core.isEnabled("workspaces")'), false);
  const observed = await evaluate('(()=>{const w=app.workspace,a=w.getLeafById("startup-alpha"),b=w.getLeafById("startup-beta");return{active:w.activeLeaf.id,alpha:a.view.editor.getValue(),mode:a.view.getMode(),source:a.view.source,betaMode:b.view.getMode(),pins:[a.pinned,b.pinned],dimensions:w.getLayout().main.children.map(p=>p.dimension),side:w.getLayout().left.width,unknown:w.getLeafById("startup-unknown").getViewState().state}})()');
  assert.equal(observed.active, "startup-alpha"); assert.equal(observed.alpha, alpha.toString("utf8").slice(1)); assert.equal(observed.mode, "source");
  assert.equal(await evaluate('app.workspace.getLeafById("startup-alpha").view.getState().source'), false);
  assert.equal(observed.betaMode, "preview"); assert.deepEqual(observed.pins, [true, true]); assert.deepEqual(observed.dimensions, [63, 37]); assert.equal(observed.side, 290);
  assert.deepEqual(observed.unknown.opaque, { keep: [42, true] });
  await wait('!app.changingVault', "first-open handoff finished");
  await wait('app.workspace.importedWorkspaceRoot===null', "initial independent layout checkpoint acknowledged");
  assert.ok(JSON.parse(await readFile(savedPath, "utf8")).views["workspace-startup"]);
  assert.deepEqual(await readFile(originalPath), source); assert.deepEqual(await readFile(join(directory, folder, "Alpha.md")), alpha);
  await capture("imported");
  pass("A fresh runtime imports original Source/Live Preview and Reading panes, pins, dimensions, sidebar widths and unavailable opaque state with Workspaces disabled, preserves exact BOM/CRLF/Unicode bytes, and checkpoints only the independent layout.");

  const changed = structuredClone(original); changed.main.children[0].dimension = 80; changed.main.children[1].dimension = 20;
  changed.main.children[0].children[0] = leaf("startup-alpha", "Beta"); changed.active = "startup-beta";
  source = bytes(changed);
  await restart(async () => { await writeFile(originalPath, source); });
  assert.equal(await evaluate('app.workspace.getLeafById("startup-alpha").view.file.path'), folder + "/Alpha.md");
  assert.deepEqual(await evaluate('app.workspace.getLayout().main.children.map(p=>p.dimension)'), [63, 37]);
  assert.deepEqual(await readFile(originalPath), source);
  pass("A later restart/reconnect prefers the independent saved layout over a changed original, retaining imported file selection and proportions without rewriting the original source.");

  async function runImport() {
    await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker")?.open', "actual command palette");
    await command("Input.insertText", { text: "Import Obsidian active workspace" });
    await click('[data-command-id="workspace:import-obsidian-layout"]');
  }
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("startup-alpha"));app.editor.setCursor({line:2,ch:0});app.editor.focus()');
  await command("Input.insertText", { text: "Unsaved " });
  const dirty = await evaluate("app.editor.getValue()");
  await Promise.all([handleDialog(false), runImport()]);
  assert.equal(await evaluate("app.editor.getValue()"), dirty); assert.deepEqual(await readFile(join(directory, folder, "Alpha.md")), alpha);
  assert.equal(await evaluate('app.workspace.getLeafById("startup-alpha").view.file.path'), folder + "/Alpha.md");
  pass("The actual command palette presents an import confirmation; Cancel retains a real unsaved editor and its exact original disk bytes.");
  await Promise.all([handleDialog(true), runImport()]);
  await wait('app.workspace.getLeafById("startup-alpha")?.view.file?.path==="Startup import/Beta.md"', "explicit import replaces the layout");
  assert.deepEqual(await evaluate('app.workspace.getLayout().main.children.map(p=>p.dimension)'), [80, 20]);
  assert.equal(await readFile(join(directory, folder, "Alpha.md"), "utf8"), "\ufeff" + dirty);
  assert.deepEqual(await readFile(originalPath), source); await capture("reimported");
  pass("Confirmed manual import uses the guarded layout transition, saves the dirty note's exact intended text, installs the reviewed original panes and leaves the source workspace untouched.");

  await restart(async () => { await install(originalPath, null); await install(savedPath, null); });
  assert.equal(await evaluate('Boolean(app.workspace.getLeafById("startup-alpha"))'), false);
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  assert.equal(await optional(originalPath), null);
  pass("With neither layout present, normal note access remains available and startup creates no original workspace file or compatibility error.");
  await expectErrors({ evaluate, report }, [{ source: "notification", message: "Could not import .obsidian/workspace.json. Its bytes were retained; notes remain available. Use 'Import Obsidian active workspace' to retry after fixing the source.", stackIncludes: "startupWorkspace" }], async () => {
    await restart(async () => { await writeFile(originalPath, "{"); await install(savedPath, null); });
  }, "A deliberately malformed original must report one causal import failure while keeping the vault usable");
  assert.equal(await readFile(originalPath, "utf8"), "{");
  assert.equal(await evaluate('Boolean(app.vault.rootPath)&&app.workspace.layoutReady&&!app.changingVault'), true);
  assert.match(await evaluate('document.querySelector(".notice-container").textContent'), /bytes were retained/);
  pass("A malformed original remains byte-for-byte intact, records its stack/cause in the persisted diagnostic log and shows recovery guidance while leaving normal notes accessible.");
  await restart(async () => { await install(originalPath, beforeOriginal); await install(savedPath, beforeSaved); });
  if (coreEnabled) { await evaluate('app.core.setEnabled("workspaces",true)'); }
  assert.deepEqual(await optional(originalPath), beforeOriginal);
  report.workspaceStartup = { automaticImport: true, independentPrecedence: true, manualCancelAndConfirm: true, absentFallback: true, malformedRetained: true, originalUnchanged: true, fullRestartOrReconnect: true };
}
