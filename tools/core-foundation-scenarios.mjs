import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";

export async function checkCoreFoundations(ui) {
  const { createNote,focusEditor,command,waitExpression,click,evaluate,report,runCommand,press,waitFor,fileEquals,vault,restartDesktop,waitForDesktopReady,originalWorkspace,communityConfiguration,evidence,throughChooser }=ui;
  const note = "Folder/Core benchmark.md";
  let content = "# Core heading\n\nAlpha beta gamma.\n\n## Second heading\n\nDelta epsilon.\n";
  await createNote("Folder\\Core benchmark.md");
  await focusEditor();
  await command("Input.insertText", { text: content });
  await waitExpression("app.dirty", "core note input");
  await click("#save-note");
  await waitFor(() => fileEquals(join(vault, "Folder", "Core benchmark.md"), content), "core note exact disk bytes");
  await waitExpression(`document.querySelector('[data-note-path="${note}"]').classList.contains("is-active")`, "active core note in file tree");
  assert.equal(await evaluate('document.querySelector(\'[data-folder-path="Folder"]\').open'), true);
  await click('[data-note-path="Welcome.md"]');
  await waitExpression('app.current?.file.path==="Welcome.md"', "file-explorer navigation");
  await click(`[data-note-path="${note}"]`);
  await waitExpression(`app.current?.file.path===${JSON.stringify(note)}`, "file explorer reopened the nested note");
  assert.equal(await evaluate("app.editor.getValue()"), content);
  report.coreChecks.push({ id: "file-explorer:basic-navigation", status: "passed" });

  await runCommand("workspace:toggle-pin");
  await waitExpression("app.workspace.activeLeaf.pinned", "palette executed the filtered pin command");
  await runCommand("workspace:toggle-pin");
  await waitExpression("!app.workspace.activeLeaf.pinned", "palette unpinned the tab");
  report.coreChecks.push({ id: "command-palette:execute", status: "passed" });

  await click('[data-note-path="Welcome.md"]');
  await waitExpression('app.current?.file.path==="Welcome.md"', "note before quick switching");
  await press("o", "KeyO", 79, 2);
  await waitExpression('document.querySelector("#desktop-picker[data-picker=files]")?.open', "core quick switcher");
  await command("Input.insertText", { text: "cr bnch" });
  await waitExpression(`document.querySelectorAll("[data-switcher-path]").length===1&&document.querySelector("[data-switcher-path]").dataset.switcherPath===${JSON.stringify(note)}`, "fuzzy core note result");
  await press("Enter", "Enter", 13);
  await waitExpression(`app.current?.file.path===${JSON.stringify(note)}&&!document.querySelector("#desktop-picker").open`, "quick switcher opened its result");
  assert.equal(await evaluate("app.editor.getValue()"), content);
  report.coreChecks.push({ id: "switcher:find-note", status: "passed" });

  await runCommand("outline:open");
  await waitExpression('document.querySelectorAll(".outline-heading").length===2&&!document.querySelector("#desktop-shell").classList.contains("right-collapsed")', "core outline headings");
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".outline-heading"),heading=>heading.textContent)'), ["Core heading", "Second heading"]);
  await click('.outline-heading[data-outline-line="4"]');
  assert.equal(await evaluate("app.editor.getCursor().line"), 4);
  report.coreChecks.push({ id: "outline:navigate", status: "passed" });

  await waitExpression(`document.querySelector("#editor-statistics").textContent===${JSON.stringify(`9 words   ${content.length} characters`)}`, "ASCII document word and character counts");
  await focusEditor();
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "Zeta\n" });
  content += "Zeta\n";
  await waitExpression(`document.querySelector("#editor-statistics").textContent===${JSON.stringify(`10 words   ${content.length} characters`)}`, "live counts after editing");
  await click("#save-note");
  await waitFor(() => fileEquals(join(vault, "Folder", "Core benchmark.md"), content), "edited core note disk bytes");
  report.coreChecks.push({ id: "word-count:document", status: "passed" });

  await runCommand("workspace:split-vertical");
  await waitExpression('document.querySelectorAll(".workspace-tabs").length===2', "core split workspace");
  await runCommand("workspace:toggle-pin");
  await waitExpression("app.workspace.activeLeaf.pinned", "pinned core split");
  const expectedLayout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
  await command("Page.reload");
  await waitForDesktopReady("core layout after renderer reload");
  await waitExpression('document.querySelectorAll(".workspace-tabs").length===2', "core layout after renderer reload");
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), expectedLayout);
  assert.equal(await evaluate("app.workspace.activeLeaf.pinned"), true);
  assert.equal(await evaluate("app.editor.getValue()"), content);
  assert.equal(await evaluate("Object.keys(app.plugins.plugins).length"), 0);
  assert.equal(await evaluate('document.querySelector("#vault-dialog").open'), false);
  assert.equal(await readFile(join(vault, ".obsidian", "workspace.json"), "utf8"), originalWorkspace);
  assert.equal(await readFile(join(vault, ".obsidian", "community-plugins.json"), "utf8"), communityConfiguration);
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  assert.equal(await evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  report.coreChecks.push({ id: "workspaces:layout-roundtrip", status: "passed" });
  report.checks.push("Core foundations exercised real file-tree creation/navigation, filtered command execution, fuzzy switching, heading navigation, live counts, and split/pin/sidebar layout restoration with no community plugins installed or enabled.");
  report.note = note;
  report.exactSavedContent = content;
  report.restoredWorkspaceLayout = expectedLayout;
  report.existingObsidianPluginConfigurationUnchanged = true;
  report.existingObsidianWorkspaceUnchanged = true;
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(evidence, throughChooser ? "core-workspace.png" : "explicit-vault-workspace.png"), Buffer.from(screenshot.data, "base64"));
}

