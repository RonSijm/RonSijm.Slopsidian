import { expectErrors, createErrorLogAudit } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { coreVerificationTargets } from "./core-verification-targets.mjs";
const coreVerificationOnly = process.argv.includes("--verify-core");
const coreStatusOnly = process.argv.includes("--core-status");
const diagnosticsOnly = process.argv.includes("--diagnostics");
const tabMovementOnly = process.argv.includes("--tabs");
const paneResizeOnly = process.argv.includes("--pane-resize");
const discoveryPanesOnly = process.argv.includes("--discovery-panes");
const discoveryPanesProfile = discoveryPanesOnly ? "discovery-panes-" + Date.now() : null;
const bookmarksOnly = process.argv.includes("--bookmarks");
const bookmarksProfile = bookmarksOnly ? "bookmarks-" + Date.now() : null;
const backlinkPanesOnly = process.argv.includes("--backlink-panes");
const outlinePanesOnly = process.argv.includes("--outline-panes");
const searchPanesOnly = process.argv.includes("--search-panes");
const fileExplorerOnly = process.argv.includes("--file-explorer");
const workspaceStartupOnly = process.argv.includes("--workspace-startup");
const root = fileURLToPath(new URL("../", import.meta.url));
const throughLauncher = process.argv.includes("--launcher");
const community = process.argv.includes("--community");
const communitySettingsOnly = process.argv.includes("--community-settings");
const communityInstallOnly = process.argv.includes("--community-install");
const propertiesOnly = process.argv.includes("--properties");
const filesOnly = process.argv.includes("--files");
const graphsOnly = process.argv.includes("--graphs");
const canvasesOnly = process.argv.includes("--canvases");
const previewsOnly = process.argv.includes("--previews");
const editingToolsOnly = process.argv.includes("--editing-tools");
const formatsOnly = process.argv.includes("--formats");
const composerOnly = process.argv.includes("--composer");
const menusOnly = process.argv.includes("--menus");
const suggestionsOnly = process.argv.includes("--suggestions");
const modalFocusOnly = process.argv.includes("--modal-focus");
const attachmentsOnly = process.argv.includes("--attachments");
const attachmentsProfile = "attachments-" + Date.now();
const autosaveOnly = process.argv.includes("--autosave");
const autosaveProfile = "autosave-" + Date.now();
const modalLayoutOnly = process.argv.includes("--modal-layout");
const draftRescueOnly = process.argv.includes("--draft-rescue");
const draftRescueProfile = draftRescueOnly ? "draft-rescue-" + Date.now() : null;
const rescueReviewOnly = process.argv.includes("--draft-rescue-review");
const rescueReviewProfile = rescueReviewOnly ? "rescue-review-" + Date.now() : null;
const rescueInspectionOnly = process.argv.includes("--draft-rescue-inspection");
const rescueInspectionProfile = rescueInspectionOnly ? "rescue-inspection-" + Date.now() : null;
const rescueReviewStateOnly = process.argv.includes("--draft-rescue-review-state");
const rescueReviewStateProfile = rescueReviewStateOnly ? "rescue-review-state-" + Date.now() : null;
const renderersOnly = process.argv.includes("--renderers");
const tagsOnly = process.argv.includes("--tags");
const templaterOnly = process.argv.includes("--templater");
const excalidrawOnly = process.argv.includes("--excalidraw");
const reportedPluginsOnly = process.argv.includes("--reported-plugins");
const additionalPluginsOnly = process.argv.includes("--additional-plugins");
const baseSummariesOnly = process.argv.includes("--bases-summaries");
const basesOnly = process.argv.includes("--bases") || baseSummariesOnly;
const recoveryOnly = process.argv.includes("--recovery");
const discoveryOnly = process.argv.includes("--discovery");
const audioOnly = process.argv.includes("--audio");
const editorChromeOnly = process.argv.includes("--editor-chrome");
const mermaidOnly = process.argv.includes("--mermaid");
const workspacesOnly = process.argv.includes("--workspaces");
const workspaceTransitionOnly = process.argv.includes("--workspace-transition");
const outgoingOnly = process.argv.includes("--outgoing");
const focused = [backlinkPanesOnly, discoveryPanesOnly, bookmarksOnly, outlinePanesOnly, searchPanesOnly, fileExplorerOnly, workspaceStartupOnly, communityInstallOnly, paneResizeOnly, diagnosticsOnly, coreVerificationOnly, coreStatusOnly, tabMovementOnly, attachmentsOnly, autosaveOnly, propertiesOnly, filesOnly, graphsOnly, canvasesOnly, previewsOnly, editingToolsOnly, formatsOnly, composerOnly, menusOnly, suggestionsOnly, modalFocusOnly, modalLayoutOnly, draftRescueOnly, rescueReviewOnly, rescueInspectionOnly, rescueReviewStateOnly, renderersOnly, tagsOnly, templaterOnly, excalidrawOnly, reportedPluginsOnly, additionalPluginsOnly, basesOnly, recoveryOnly, discoveryOnly, audioOnly, editorChromeOnly, mermaidOnly, workspacesOnly, outgoingOnly, workspaceTransitionOnly, communitySettingsOnly].filter(Boolean).length;
if (focused > 1 || community && focused) { throw new Error("Choose one focused desktop suite, separately from community acceptance."); }
const syntheticAudio = coreVerificationOnly || audioOnly || (!focused && !community);
const throughChooser = !focused && !process.argv.includes("--explicit-vault") && (!community || process.argv.includes("--chooser"));
const reportName = backlinkPanesOnly ? "backlink-panes-smoke" : discoveryPanesOnly ? "discovery-panes-smoke" : bookmarksOnly ? "bookmarks-workflows-smoke" : outlinePanesOnly ? "outline-panes-smoke" : searchPanesOnly ? "search-panes-smoke" : fileExplorerOnly ? "file-explorer-smoke" : workspaceStartupOnly ? "workspace-startup-smoke" : communityInstallOnly ? "community-install-smoke" : paneResizeOnly ? "pane-resize-smoke" : diagnosticsOnly ? "diagnostics-smoke" : tabMovementOnly ? "tabs-smoke" : coreVerificationOnly ? "core-verification-smoke" : coreStatusOnly ? "core-status-smoke" : attachmentsOnly ? "attachments-smoke" : autosaveOnly ? "autosave-smoke" : rescueReviewStateOnly ? "rescue-review-state-smoke" : rescueInspectionOnly ? "rescue-inspection-smoke" : rescueReviewOnly ? "rescue-review-smoke" : draftRescueOnly ? "draft-rescue-smoke" : modalLayoutOnly ? "modal-layout-smoke" : modalFocusOnly ? "modal-focus-smoke" : additionalPluginsOnly ? "additional-plugins-smoke" : communitySettingsOnly ? "community-settings-smoke" : tagsOnly ? "tags-smoke" : workspaceTransitionOnly ? "workspace-transition-smoke" : reportedPluginsOnly ? "reported-plugins-smoke" : excalidrawOnly ? "excalidraw-smoke" : renderersOnly ? "renderers-smoke" : templaterOnly ? "templater-smoke" : suggestionsOnly ? "suggestions-smoke" : baseSummariesOnly ? "bases-summaries-smoke" : outgoingOnly ? "outgoing-smoke" : workspacesOnly ? "workspaces-smoke" : mermaidOnly ? "mermaid-smoke" : audioOnly ? "audio-smoke" : community ? "desktop-smoke" : propertiesOnly ? "properties-smoke" : filesOnly ? "files-smoke" : graphsOnly ? "graphs-smoke" : canvasesOnly ? "canvases-smoke" : previewsOnly ? "previews-smoke" : editingToolsOnly ? "editing-tools-smoke" : formatsOnly ? "formats-smoke" : composerOnly ? "composer-smoke" : menusOnly ? "menus-smoke" : basesOnly ? "bases-smoke" : recoveryOnly ? "recovery-smoke" : discoveryOnly ? "discovery-smoke" : editorChromeOnly ? "editor-chrome-smoke" : throughChooser ? "core-smoke" : "explicit-vault-smoke";
if (throughLauncher) {
  await import("./build.mjs");
}
const evidence = join(root, ".runtime", "evidence");
await mkdir(evidence, { recursive: true });
const errorAudit = createErrorLogAudit(evidence, reportName);
const errorRun = "--error-log-run=" + crypto.randomUUID();
const vault = await mkdtemp(join(root, ".runtime", "smoke-vault-"));
await cp(join(root, ".runtime", "DemoVault"), vault, { recursive: true });
await rm(join(vault, ".obsidian", "vault-dotnet-workspace.json"), { force: true });
// Legacy manual-save scenarios explicitly pause autosave; its dedicated suite starts with the default.
const fixtureAppPath = join(vault, ".obsidian", "app.json");
const fixtureAppBytes = await readFile(fixtureAppPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return Buffer.from("{}"); });
const fixtureApp = JSON.parse(fixtureAppBytes.toString("utf8").replace(/^\ufeff/, ""));
if (autosaveOnly || attachmentsOnly) { delete fixtureApp.markdownAutosave; } else { fixtureApp.markdownAutosave = false; }
await writeFile(fixtureAppPath, (fixtureAppBytes[0] === 239 ? "\ufeff" : "") + JSON.stringify(fixtureApp));
const originalWorkspace = '{"main":{"id":"preserved-main","type":"split","direction":"vertical","children":[{"id":"preserved-tabs","type":"tabs","children":[{"id":"preserved-leaf","type":"leaf","state":{"type":"empty","state":{}}}]}]},"active":"preserved-leaf","unknown":"keep"}\n';
await writeFile(join(vault, ".obsidian", "workspace.json"), originalWorkspace);
const crlfContent = "# CRLF preservation\r\n\r\nTODO: Keep the existing encoding.\r\n";
await writeFile(join(vault, "CRLF note.md"), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(crlfContent)]));
const communityConfiguration = community ? '["sample-plugin"]\n' : "[]\n";
await writeFile(join(vault, ".obsidian", "community-plugins.json"), communityConfiguration);
const failureDirectory = join(vault, ".obsidian", "plugins", "failure-probe");
if (community) {
  await rm(join(vault, ".obsidian", "plugins", "sample-plugin", "data.json"), { force: true });
  await mkdir(failureDirectory);
  await writeFile(join(failureDirectory, "manifest.json"), JSON.stringify({ id: "failure-probe", name: "Load failure probe", version: "0.1.0", description: "Automated rollback fixture", isDesktopOnly: true }));
  await writeFile(join(failureDirectory, "main.js"), `const {Plugin}=require("obsidian"); module.exports=class extends Plugin { onload(){this.addCommand({id:"leaked-command",name:"Must be removed",callback(){}});this.addStatusBarItem().textContent="Must be removed";throw new Error("Expected fixture load failure");} };`);
} else {
  await rm(join(vault, ".obsidian", "plugins"), { recursive: true, force: true });
  await writeFile(join(vault, ".obsidian", "core-plugins.json"), JSON.stringify({ "zk-prefixer": false, "random-note": false, "future-core": { preserve: ["exact"] } }));
  for (const id of ["daily-notes", "templates", "zk-prefixer", "command-palette", "backlink", "webviewer"]) {
    await writeFile(join(vault, ".obsidian", id + ".json"), JSON.stringify({
      futureSetting: { preserve: id },
      ...(id === "command-palette" ? { pinned: ["workspace:save-file"] } : {}),
      ...(id === "backlink" ? { backlinkInDocument: true } : {}),
      ...(id === "webviewer" ? { openExternalURLs: true, enableAdblocking: false } : {}),
    }));
  }
}
const createLocation = join(vault, ".startup-vaults");
if (throughChooser) {
  await mkdir(join(createLocation, "Existing vault"), { recursive: true });
  await writeFile(join(createLocation, "Existing vault", "Keep.md"), "Keep the existing vault.\n");
}

const inputEnvironmentArguments = ["--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
const applicationArguments = [
  ...(discoveryPanesOnly ? ["--smoke-profile=" + discoveryPanesProfile] : []),
  ...(bookmarksOnly ? ["--smoke-profile=" + bookmarksProfile] : []),
  ...(attachmentsOnly ? ["--smoke-profile=" + attachmentsProfile] : []),
  ...(autosaveOnly ? ["--smoke-profile=" + autosaveProfile] : []),
  ...inputEnvironmentArguments,
  ...(draftRescueOnly ? ["--smoke-profile=" + draftRescueProfile] : []),
  ...(rescueReviewOnly ? ["--smoke-profile=" + rescueReviewProfile] : []),
  ...(rescueInspectionOnly ? ["--smoke-profile=" + rescueInspectionProfile] : []),
  ...(rescueReviewStateOnly ? ["--smoke-profile=" + rescueReviewStateProfile] : []),
  ...(workspaceTransitionOnly ? ["--smoke-profile=workspace-transition-" + Date.now()] : []),
  "--smoke", errorRun, ...(outgoingOnly ? ["--smoke-profile=outgoing"] : workspacesOnly ? ["--smoke-profile=workspaces"] : mermaidOnly ? ["--smoke-profile=mermaid"] : audioOnly ? ["--smoke-profile=audio"] : recoveryOnly ? ["--smoke-profile=recovery"] : baseSummariesOnly ? ["--smoke-profile=bases-summaries"] : basesOnly ? ["--smoke-profile=bases"] : menusOnly ? ["--smoke-profile=menus"] : composerOnly ? ["--smoke-profile=composer"] : []), ...(syntheticAudio ? ["--smoke-audio"] : []), ...(throughChooser ? [] : [`--vault=${vault}`]),
  "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
];
const executable = throughLauncher ? process.env.ComSpec : join(root, "node_modules", "electron", "dist", "electron.exe");
const arguments_ = throughLauncher ? ["/d", "/c", join(root, "build-and-run.cmd"), ...applicationArguments] : [root, ...applicationArguments];
const artifactPaths = [
  join("src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "editor-host.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "editor-host.css"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "codemirror-license.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "hypermd-license.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "web-reader-extract.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "web-reader-extract.js.LEGAL.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "web-reader-licenses.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "search-worker.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "graph-worker.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "bases-worker.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "mermaid-frame.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "mermaid-api.js"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "mermaid-api.js.LEGAL.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "js", "mermaid-licenses.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "mermaid-frame.html"),
  join("desktop", "main.cjs"),
  join("desktop", "draft-rescue.cjs"),
  join("desktop", "draft-rescue-catalog.cjs"),
  join("desktop", "draft-rescue-inspector.cjs"),
  join("desktop", "draft-rescue-review-state.cjs"),
  join("desktop", "local-storage.cjs"),
  join("desktop", "web-viewer.cjs"),
  join("desktop", "web-viewer-policy.cjs"),
  join("desktop", "web-reader.cjs"),
  join("desktop", "web-zoom.cjs"),
  join("shared", "web-zoom.cjs"),
  join("desktop", "audio-permissions.cjs"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "app.css"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "icons.svg"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "icons-LICENSE.txt"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "lucide-icons.svg"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "lucide-icons-LICENSE.txt"),
  join("tools", "smoke.mjs"),
  join("tools", "reading-scenarios.mjs"),
  join("tools", "outgoing-scenarios.mjs"),
  join("tools", "discovery-scenarios.mjs"),
  join("tools", "editor-chrome-scenarios.mjs"),
  join("tools", "view-scenarios.mjs"),
  join("tools", "organization-scenarios.mjs"),
  join("tools", "file-scenarios.mjs"),
  join("tools", "graph-scenarios.mjs"),
  join("tools", "canvas-scenarios.mjs"),
  join("tools", "preview-scenarios.mjs"),
  join("tools", "editing-tools-scenarios.mjs"),
  join("tools", "format-scenarios.mjs"),
  join("tools", "composer-scenarios.mjs"),
  join("tools", "menu-scenarios.mjs"),
  ...(attachmentsOnly ? ["client/attachment-import.ts","client/attachments.ts","client/workspace.ts","client/app.ts","client/desktop-ui.ts","tests/attachment-import.test.mjs","tools/attachment-scenarios.mjs"] : []),
  ...(autosaveOnly ? ["tools/autosave-scenarios.mjs", "client/markdown-autosave.ts", "client/markdown-autosave-ui.ts", "client/workspace.ts", "client/editor-host.ts", "client/app.ts", "client/browser-vault.ts", "tests/markdown-autosave.test.mjs"] : []),
  ...(modalFocusOnly ? ["tools/modal-focus-scenarios.mjs", "client/modal-focus.ts", "client/ui.ts", "tests/modal-focus.test.mjs"] : []),
  ...(modalLayoutOnly ? ["tools/modal-layout-scenarios.mjs", "client/modal-focus.ts", "client/ui.ts"] : []),
  ...(draftRescueOnly ? ["tools/draft-rescue-scenarios.mjs", "client/draft-rescue.ts", "client/workspace.ts", "client/editor-host.ts", "tests/draft-rescue.test.mjs"] : []),
  ...(rescueReviewOnly ? ["tools/draft-rescue-review-scenarios.mjs", "client/draft-rescue-review.ts", "client/editor-host.ts", "tests/draft-rescue-catalog.test.mjs"] : []),
  ...(rescueInspectionOnly ? ["tools/draft-rescue-inspection-scenarios.mjs", "tools/draft-rescue-review-scenarios.mjs", "client/draft-rescue-review.ts", "client/draft-rescue-inspector.ts", "tests/draft-rescue-inspector.test.mjs"] : []),
  ...(rescueReviewStateOnly ? ["tools/draft-rescue-review-state-scenarios.mjs", "client/draft-rescue-review.ts", "tests/draft-rescue-review-state.test.mjs"] : []),
  join("tools", "community-plugin-test-helpers.mjs"),
  join("tools", "suggestion-scenarios.mjs"),
  join("tools", "renderer-scenarios.mjs"),
  join("tools", "core-foundation-scenarios.mjs"),
  join("tools", "core-verification-scenarios.mjs"),
  join("tools", "tab-movement-scenarios.mjs"),
  ...(bookmarksOnly ? ["tools/bookmark-scenarios.mjs", "tools/graph-scenarios.mjs", "tools/organization-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/bookmarks.ts", "client/graph.ts", "client/desktop-ui.ts", "tests/bookmarks.test.mjs"] : []),
  ...(discoveryOnly ? ["tools/cached-github-fixture.mjs", "client/links.ts", "client/metadata.ts", "client/vault.ts", "client/file-manager.ts", "client/desktop-ui.ts", "client/recent-files.ts", "client/workspace.ts", "client/workspace-startup.ts", "client/bookmarks.ts", "tests/markdown.test.mjs", "tests/workspace-tabs.test.mjs", "tests/workspace-startup.test.mjs", "tests/workspace-transition.test.mjs"] : []),
  ...(discoveryPanesOnly ? ["tools/discovery-pane-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/tags-pane-view.ts", "client/tags-pane-model.ts", "client/footnotes-pane-view.ts", "client/footnotes-pane-model.ts", "client/discovery-views.ts", "client/sidebars.ts", "client/search-pane-model.ts", "client/bookmarks.ts", "client/workspace.ts", "tests/discovery-panes.test.mjs", "tests/workspace-tabs.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"] : []),
  ...(backlinkPanesOnly ? ["tools/backlink-pane-scenarios.mjs","tools/cached-github-fixture.mjs","client/backlink-view.ts","client/backlink-model.ts","client/discovery-views.ts","client/sidebars.ts","tests/backlink-panes.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"] : []),
  ...(outlinePanesOnly ? ["tools/outline-pane-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/outline-view.ts", "client/outline-model.ts", "client/desktop-ui.ts", "client/sidebars.ts", "tests/outline-panes.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"] : []),
  ...(searchPanesOnly ? ["tools/search-pane-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/search-view.ts", "client/search-task.ts", "client/search-pane-model.ts", "client/discovery-views.ts", "client/sidebars.ts", "tests/search-panes.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"] : []),
  ...(fileExplorerOnly ? ["tools/file-explorer-scenarios.mjs", "client/file-explorer-model.ts", "client/file-explorer-view.ts", "client/desktop-ui.ts", "client/sidebars.ts", "tests/file-explorer.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"] : []),
  ...(workspaceStartupOnly ? ["tools/workspace-startup-scenarios.mjs", "client/workspace-startup.ts", "client/workspace-import.ts", "tests/workspace-startup.test.mjs", "src/RonSijm.Slopsidian/Services/VaultService.WorkspaceImport.cs"] : []),
  ...(paneResizeOnly ? ["tools/pane-resize-scenarios.mjs", "client/workspace-pane-resize.ts", "client/workspace-pane-size.ts", "tests/workspace-pane-size.test.mjs"] : []),
  ...(tabMovementOnly ? ["client/workspace.ts", "client/workspace-dom.ts", "client/workspace-tab-drag.ts", "client/desktop-ui.ts", "tests/workspace-tabs.test.mjs"] : []),
  join("tools", "core-verification-targets.mjs"),
  join("src", "RonSijm.Slopsidian", "wwwroot", "core-verification.json"),
  join("tools", "render-child-scenarios.mjs"),
  ...(tagsOnly ? [join("tools", "tag-scenarios.mjs"), join("tools", "rendering-parity-scenarios.mjs"), ...["reading", "live-preview", "editor", "markdown", "properties", "page-preview", "workspace"].map(name => join("client", name + ".ts"))] : []),
  ...(communitySettingsOnly ? [join("tools", "community-settings-scenarios.mjs"), join("client", "community-settings.ts"), join("client", "plugin-host.ts"), join("client", "editor-host.ts"), join("tests", "community-plugins.test.mjs")] : []),
  ...(communityInstallOnly ? ["tools\\community-install-scenarios.mjs", "client\\community-browser.ts", "client\\community-browser.css", "client\\community-catalog.ts", "client\\community-settings.ts", "client\\plugin-host.ts", "client\\contracts.ts", "client\\browser-vault.ts", "tests\\community-plugins.test.mjs", "src\\RonSijm.Slopsidian\\Program.cs", "src\\RonSijm.Slopsidian\\Services\\CommunityDownloads.cs", "src\\RonSijm.Slopsidian\\Components\\App.razor", "src\\RonSijm.Slopsidian\\wwwroot\\js\\editor-host.css"] : []),
  join("tools", "templater-scenarios.mjs"),
  ...(excalidrawOnly ? [join("tools", "excalidraw-scenarios.mjs")] : []),
  ...(reportedPluginsOnly ? [join("tools", "reported-plugin-scenarios.mjs")] : []),
  ...(additionalPluginsOnly ? ["tools\\additional-plugin-scenarios.mjs", "tools\\additional-plugin-assets.mjs", "tools\\additional-plugin-workflows.mjs", "tools\\additional-plugin-next-workflows.mjs", ...["plugin-host", "plugin", "legacy-constructors", "ui", "settings", "icons", "dom", "menu", "suggestions", "desktop-ui", "file-manager", "views", "workspace", "app", "editor", "editor-host", "protocol", "markdown-embed", "markdown", "timers", "vault", "browser-vault"].map(name => join("client", name + ".ts"))] : []),
  join("tools", "webviewer-scenarios.mjs"),
  join("tools", "bases-scenarios.mjs"),
  join("tools", "bases-summary-scenarios.mjs"),
  join("tools", "recovery-scenarios.mjs"),
  join("tools", "audio-scenarios.mjs"),
  join("tools", "mermaid-scenarios.mjs"),
  join("tools", "workspace-import-scenarios.mjs"),
  ...(workspaceTransitionOnly ? ["tools/workspace-transition-scenarios.mjs", "client/workspace.ts", "client/editor-host.ts", "tests/workspace-transition.test.mjs"] : []),
  ...(!community ? [join("shared", "core-plugins.json"), join("tools", "core-scenarios.mjs")] : []),
];
async function readArtifacts() {
  return Promise.all(artifactPaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") })));
}
let initialArtifacts = throughLauncher ? null : await readArtifacts();
let rescueReviewStateSeed;
if (rescueReviewStateOnly) {
  const { seedRescueReviewState } = await import("./draft-rescue-review-state-scenarios.mjs");
  rescueReviewStateSeed = await seedRescueReviewState(join(root, ".runtime", "smoke-profile-" + rescueReviewStateProfile), vault);
}
let rescueReviewSeed;
if (rescueReviewOnly) {
  const { seedDraftRescueReview } = await import("./draft-rescue-review-scenarios.mjs");
  rescueReviewSeed = await seedDraftRescueReview(join(root, ".runtime", "smoke-profile-" + rescueReviewProfile), vault);
}
let rescueInspectionSeed;
if (rescueInspectionOnly) {
  const { seedDraftRescueInspection } = await import("./draft-rescue-inspection-scenarios.mjs");
  rescueInspectionSeed = await seedDraftRescueInspection(join(root, ".runtime", "smoke-profile-" + rescueInspectionProfile), vault);
}
let child = spawn(executable, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let exited = once(child, "exit");
let log = "";
let sessionLog = "";
let endpoint;
let vaultEndpoint;
function collectOutput() {
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", text => {
      log += text;
      sessionLog += text;
      const match = sessionLog.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        endpoint = `http://127.0.0.1:${match[1]}`;
      }
      const vaultReady = sessionLog.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)/m);
      if (vaultReady) { vaultEndpoint = vaultReady[1]; }
    });
  }
}
collectOutput();
let socket;
let mainDocumentLoader = null;
let loadedDocumentLoader = null;
let reloadDocumentLoader = null;
let id = 0;
const pending = new Map();
const dialogs = [];
let dialogOpen = false;
const browserErrors = [];
const consoleErrors = [];
const shutdownConsoleCandidates = [];
const expectedShutdownErrors = new Set();
let closingLauncherPid = null;
const recentCommands = [];
let report = { status: "failed", scope: community ? "legacy-community-and-workspace" : propertiesOnly ? "properties-runtime" : filesOnly ? "file-operations-runtime" : graphsOnly ? "graphs-runtime" : canvasesOnly ? "canvas-runtime" : previewsOnly ? "page-preview-runtime" : editingToolsOnly ? "editing-tools-runtime" : formatsOnly ? "format-conversion-runtime" : composerOnly ? "note-composition-runtime" : menusOnly ? "menu-api-runtime" : discoveryOnly ? "discovery-runtime" : editorChromeOnly ? "editor-chrome-runtime" : "implemented-core-foundations", communityPluginsTested: community, startedAt: new Date().toISOString(), vault, launcherPid: child.pid, launchMode: throughLauncher ? "build-and-run.cmd" : "electron", startupMode: throughChooser ? "vault-chooser" : "explicit-vault", checks: [], coreChecks: [], processes: [] };
report.inputEnvironment = "Windows occlusion and renderer/timer background throttling disabled in disposable UI processes, including restarts; production launch is unchanged.";
if (suggestionsOnly) { report.scope = "plugin-suggestions-runtime"; }
if (modalFocusOnly) { report.scope = "shared-modal-keyboard-accessibility"; }
if (attachmentsOnly) { report.scope = "shared-note-attachment-import"; }
if (autosaveOnly) { report.scope = "safe-markdown-autosave"; }
if (modalLayoutOnly) { report.scope = "shared-modal-viewport-layout"; }
if (draftRescueOnly) { report.scope = "desktop-interrupted-host-markdown-rescue"; }
if (rescueReviewOnly) { report.scope = "desktop-previous-session-rescue-review"; }
if (rescueInspectionOnly) { report.scope = "desktop-markdown-rescue-copy-inspection"; }
if (rescueReviewStateOnly) { report.scope = "desktop-remembered-rescue-folder-reviews"; }
if (renderersOnly) { report.scope = "markdown-postprocessors-runtime"; }
if (coreVerificationOnly) { report.scope = "core-verification-targets"; report.verificationTargets = coreVerificationTargets; }
if (coreStatusOnly) { report.scope = "core-verification-status-ui"; }
if (diagnosticsOnly) { report.scope = "persistent-error-logging"; }
if (tabMovementOnly) { report.scope = "workspace-tab-movement"; }
if (bookmarksOnly) { report.scope = "bookmarks-workflows"; }
if (discoveryPanesOnly) { report.scope = "discovery-workspace-panes"; }
if (backlinkPanesOnly) { report.scope = "backlink-workspace-panes"; }
if (outlinePanesOnly) { report.scope = "outline-workspace-panes"; }
if (searchPanesOnly) { report.scope = "search-workspace-panes"; }
if (fileExplorerOnly) { report.scope = "file-explorer-workspace-panes"; }
if (workspaceStartupOnly) { report.scope = "workspace-startup-import"; }
if (paneResizeOnly) { report.scope = "workspace-pane-resizing"; }
if (communityInstallOnly) { report.scope = "community-catalog-install-update-uninstall"; }
if (tagsOnly) { report.scope = "native-shaped-tag-rendering"; }
if (templaterOnly) { Object.assign(report, { scope: "actual-templater-runtime", communityPluginsTested: true }); }
if (excalidrawOnly) { Object.assign(report, { scope: "actual-excalidraw-runtime", communityPluginsTested: true }); }
if (reportedPluginsOnly) { Object.assign(report, { scope: "reported-community-plugin-startup", communityPluginsTested: true }); }
if (additionalPluginsOnly) { Object.assign(report, { scope: "additional-example-plugin-startup", communityPluginsTested: true }); }
let stoppedSession;

function command(method, params = {}) {
  if (method === "Page.reload") {
    assert.ok(mainDocumentLoader, "The current desktop document must be known before reloading.");
    reloadDocumentLoader = mainDocumentLoader;
  }
  recentCommands.push({ method, expression: params.expression?.slice(0, 300), key: params.key });
  if (recentCommands.length > 20) {
    recentCommands.shift();
  }
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timed out: ${method}`));
    }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression: `(()=>{
    const result=(0,eval)(${JSON.stringify(expression)});
    if(result&&typeof result.then==="function"){
      // CDP can collect a pending promise unless the page retains it until settlement.
      const retained=globalThis.slopsidianSmokePromises??=new Set();
      retained.add(result);
      result.then(()=>retained.delete(result),()=>retained.delete(result));
    }
    return result;
  })()`, awaitPromise: true, returnByValue: true });
  assert.ok(!response.exceptionDetails, response.exceptionDetails?.exception?.description ?? response.exceptionDetails?.text);
  return response.result.value;
}
async function waitFor(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await predicate()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
if (audioOnly) { Object.assign(report, { scope: "audio-recorder-runtime", syntheticAudioOnly: true, physicalMicrophoneTested: false }); }
if (mermaidOnly) { report.scope = "mermaid-runtime"; }
if (outgoingOnly) { report.scope = "outgoing-runtime"; }
if (workspacesOnly) { report.scope = "workspace-import-runtime"; }
if (baseSummariesOnly) { report.scope = "bases-summaries-runtime"; }
if (syntheticAudio) { Object.assign(report, { syntheticAudioOnly: true, physicalMicrophoneTested: false }); }
async function handleDialog(accept, type = "confirm") {
  await waitFor(() => dialogOpen, "actual Canvas discard confirmation");
  assert.equal(dialogs.at(-1).type, type, "The action must present its expected native confirmation.");
  await command("Page.handleJavaScriptDialog", { accept });
}
async function checkAudioWorkflows() {
  const { checkAudio } = await import("./audio-scenarios.mjs");
  await checkAudio({
    directory: vault, evaluate, command, click, press, wait: waitExpression, handleDialog, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("Audio desktop restart"),
    capture: async () => {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "audio-desktop.png"), Buffer.from(screenshot.data, "base64"));
    },
  });
}
async function checkMermaidWorkflows() {
  const { checkMermaid } = await import("./mermaid-scenarios.mjs");
  await checkMermaid({
    directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("Mermaid desktop restart"),
    capture: async () => {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "mermaid-desktop.png"), Buffer.from(screenshot.data, "base64"));
    },
  });
}
async function checkOutgoingWorkflows() {
  const { checkOutgoingLinks } = await import("./outgoing-scenarios.mjs");
  await checkOutgoingLinks({
    directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("Outgoing/image desktop restart"),
    capture: async () => {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "outgoing-desktop.png"), Buffer.from(screenshot.data, "base64"));
    },
  });
}
async function checkEditorChromeWorkflows() {
  const { checkEditorChrome, checkEditorModes } = await import("./editor-chrome-scenarios.mjs");
  const tools = {
    directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("editor-chrome desktop restart"),
    capture: async () => {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "editor-chrome-desktop.png"), Buffer.from(screenshot.data, "base64"));
    },
  };
  await checkEditorChrome(tools);
  await checkEditorModes(tools);
}

async function checkPluginSuggestionWorkflows() {
  const { checkPluginSuggestions } = await import("./suggestion-scenarios.mjs");
  await checkPluginSuggestions({
    directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("plugin-suggestions desktop restart"),
    capture: async () => {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "suggestions-desktop.png"), Buffer.from(screenshot.data, "base64"));
    },
  });
}

async function checkMarkdownProcessorWorkflows() {
  const { checkMarkdownProcessors } = await import("./renderer-scenarios.mjs");
  await checkMarkdownProcessors({
    directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("Markdown processor desktop restart"),
  });
}

async function checkBaseSummaryWorkflows() {
  const { checkBaseSummaries } = await import("./bases-summary-scenarios.mjs");
  await checkBaseSummaries({
    directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
    afterReload: () => waitForDesktopReady("Bases summaries desktop restart"),
    capture: async () => {
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "bases-summaries-desktop.png"), Buffer.from(screenshot.data, "base64"));
    },
  });
}
async function waitExpression(expression, label) {
  await waitFor(() => evaluate(`(async()=>Boolean(await (${expression})))()`), label);
}
async function waitForDesktopReady(label) {
  if (reloadDocumentLoader !== null) {
    const previous = reloadDocumentLoader;
    await waitFor(() => mainDocumentLoader !== previous && loadedDocumentLoader === mainDocumentLoader, label + " fresh document");
    report.rendererReloads ??= [];
    report.rendererReloads.push({ previousLoader: previous, loader: mainDocumentLoader });
    reloadDocumentLoader = null;
  }
  await waitExpression('document.readyState==="complete"&&document.querySelector("main[data-ready=true]")&&globalThis.app?.workspace.layoutReady&&!app.changingVault', label);
}
async function click(selector, modifiers = 0) {
  const encoded = JSON.stringify(selector);
  await waitExpression(`(()=>{const element=document.querySelector(${encoded});const modal=document.querySelector("dialog[open]");return element&&!element.disabled&&element.checkVisibility()&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&(!modal||element.closest("dialog")===modal)})()`, selector);
  await command("Page.bringToFront");
  const point = await evaluate(`(()=>{
    const element=document.querySelector(${encoded});
    element.scrollIntoView({block:"nearest",inline:"nearest"});
    const bounds=Array.from(element.getClientRects()).find(rect=>rect.width>0&&rect.height>0);
    if(!bounds){throw new Error("The click target has no visible client rect.");}
    const x=bounds.left+bounds.width/2,y=bounds.top+bounds.height/2;
    const hit=document.elementFromPoint(x,y);
    return {x,y,reachable:hit===element||element.contains(hit),hit:hit?.outerHTML.slice(0,300)};
  })()`);
  assert.ok(point.reachable, `Cannot reach ${selector}: ${point.hit}`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
}
async function press(key, code, windowsVirtualKeyCode, modifiers = 0) {
  await command("Page.bringToFront");
  await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode, modifiers });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
}
async function runCommand(id) {
  const name = await evaluate(`app.commands.listCommands().find(command=>command.id===${JSON.stringify(id)})?.name`);
  assert.equal(typeof name, "string", `Command ${id} is registered`);
  await press("p", "KeyP", 80, 2);
  await waitExpression('document.querySelector("#desktop-picker")?.open', "command palette opened using Ctrl+P");
  await command("Input.insertText", { text: name });
  await click(`[data-command-id="${id}"]`);
  await waitExpression('!document.querySelector("#desktop-picker").open', "command selected");
}
async function communitySettings() {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) {
    await click("#open-settings");
  }
  await waitExpression('document.querySelector("#settings-dialog").open', "community settings dialog");
  await click("#community-plugins-tab");
}
async function togglePlugin(id, loaded) {
  await communitySettings();
  if (await evaluate(`Boolean(app.plugins.getPlugin(${JSON.stringify(id)}))`) !== loaded) { await click(`[data-toggle-plugin="${id}"]`); }
  await waitExpression(`!app.plugins.isManaging&&document.querySelector('.plugin-card[data-plugin-id="${id}"]').dataset.loaded===${JSON.stringify(String(loaded))}`, `${id} ${loaded ? "enabled" : "disabled"}`);
  await closeSettings();
}
async function closeSettings() {
  await click(".settings-close");
  await waitExpression('!document.querySelector("#settings-dialog").open', "settings closed");
}
async function createNote(name) {
  await click("#new-note");
  await waitExpression('document.querySelector("#new-note-dialog").open', "new-note dialog");
  await evaluate('document.querySelector("#new-note-name").focus();document.querySelector("#new-note-name").select()');
  await command("Input.insertText", { text: name });
  await click("#create-note");
  await waitExpression(`app.current?.file.path===${JSON.stringify(name.replaceAll("\\", "/"))}&&!document.querySelector("#new-note-dialog").open`, `created ${name}`);
}
async function focusEditor() {
  await evaluate('document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]").focus()');
}
async function fillInput(selector, text) {
  const encoded = JSON.stringify(selector);
  await evaluate(`document.querySelector(${encoded}).focus();document.querySelector(${encoded}).select()`);
  await command("Input.insertText", { text });
}
async function fileEquals(path, expected) {
  try {
    const actual = await readFile(path);
    return Buffer.isBuffer(expected) ? actual.equals(expected) : actual.toString("utf8") === expected;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return false;
  }
}

async function checkCoreWorkflows() {
  const {checkCoreFoundations}=await import("./core-foundation-scenarios.mjs");
  await checkCoreFoundations({createNote,focusEditor,command,waitExpression,click,evaluate,report,runCommand,press,waitFor,fileEquals,vault,restartDesktop,waitForDesktopReady,originalWorkspace,communityConfiguration,evidence,throughChooser});
}

async function connectDesktop() {
  await waitFor(async () => Boolean(endpoint && vaultEndpoint), "desktop debugging and vault endpoints");
  let target;
  await waitFor(async () => {
    const targets = await (await fetch(endpoint + "/json/list")).json();
    target = targets.find(item => item.type === "page" && item.url.startsWith(vaultEndpoint + "/"));
    return Boolean(target);
  }, "Blazor page");
  mainDocumentLoader = null;
  loadedDocumentLoader = null;
  reloadDocumentLoader = null;
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  socket.addEventListener("message", event => {
    if (event.currentTarget !== socket) { return; }
    const message = JSON.parse(event.data);
    errorAudit.onEvent(message);
    if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) {
      mainDocumentLoader = message.params.frame.loaderId;
    }
    if (message.method === "Page.loadEventFired") { loadedDocumentLoader = mainDocumentLoader; }
    if (message.method === "Page.javascriptDialogOpening") {
      dialogOpen = true;
      dialogs.push(message.params);
    }
    if (message.method === "Page.javascriptDialogClosed") { dialogOpen = false; }
    if (message.method === "Runtime.exceptionThrown") {
      browserErrors.push(message.params.exceptionDetails);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      const text = message.params.args.map(argument => argument.description ?? argument.value ?? argument.type).join(" ").slice(0, 6000);
      consoleErrors.push(text);
      const blazorFrame = message.params.stackTrace?.callFrames.find(frame => frame.url.startsWith(vaultEndpoint + "/_framework/") && /\/blazor\.web(?:\.[a-z0-9]+)?\.js$/i.test(frame.url));
      const frameworkMessage = /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] Error: (.*)$/.exec(text)?.[1];
      const knownTransportStop = frameworkMessage === "Connection disconnected with error 'Error: WebSocket closed with status code: 1006 (no reason given).'."
        || frameworkMessage === "Failed to start the transport 'WebSockets': Error: WebSocket failed to connect. The connection could not be found on the server, either the endpoint may not be a SignalR endpoint, the connection ID is not present on the server, or there is a proxy blocking WebSockets. If you have multiple servers check that sticky sessions are enabled.";
      if (additionalPluginsOnly && closingLauncherPid === child.pid && blazorFrame && knownTransportStop) {
        shutdownConsoleCandidates.push({ text, launcherPid: closingLauncherPid, source: blazorFrame });
      }
      if (excalidrawOnly || reportedPluginsOnly || additionalPluginsOnly) {
        report.consoleErrorDetails ??= [];
        report.consoleErrorDetails.push({ args: message.params.args, stackTrace: message.params.stackTrace });
      }
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "warning" && additionalPluginsOnly) {
      report.consoleWarningDetails ??= [];
      report.consoleWarningDetails.push({ args: message.params.args, stackTrace: message.params.stackTrace });
    }
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(JSON.stringify(message.error)));
    } else {
      entry.resolve(message.result);
    }
  });
  await command("Page.enable");
  const { frameTree } = await command("Page.getFrameTree");
  mainDocumentLoader ??= frameTree.frame.loaderId;
  await command("Runtime.enable");
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  const traceKeys = 'globalThis.smokeKeys=[];window.addEventListener("keydown",event=>globalThis.smokeKeys.push({key:event.key,ctrl:event.ctrlKey,prevented:event.defaultPrevented,changing:globalThis.app?.changingVault,dirty:globalThis.app?.dirty,length:globalThis.app?.workspace.activeLeaf.view.editor?.cm.state.doc.length,modal:document.querySelector("dialog[open]")?.id,focus:document.activeElement?.className}),{capture:true})';
  await command("Page.addScriptToEvaluateOnNewDocument", { source: traceKeys });
  await waitForDesktopReady("interactive Blazor editor");
  initialArtifacts ??= await readArtifacts();
  await evaluate(traceKeys);
}

async function interruptBackend() {
  assert.equal(draftRescueOnly, true);
  assert.equal(process.platform, "win32", "Owned-host interruption is a Windows acceptance scenario.");
  const hostPid = Number(sessionLog.match(/^DOTNET_HOST_PID (\d+)\r?$/m)?.[1]);
  assert.ok(Number.isSafeInteger(hostPid) && hostPid > 0 && hostPid !== process.pid && hostPid !== child.pid);
  assert.equal(Number(sessionLog.match(/^ELECTRON_HOST_PID (\d+)\r?$/m)?.[1]), child.pid);
  assert.equal(child.exitCode, null);
  const dll = join(root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll");
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ownedHost = Get-CimInstance Win32_Process -Filter 'ProcessId = " + hostPid + "'",
    "if (!$ownedHost -or $ownedHost.ParentProcessId -ne " + child.pid + ") { throw 'The host is not owned by this Electron run.' }",
    "if ($ownedHost.Name -ne 'dotnet.exe' -or !$ownedHost.CommandLine -or $ownedHost.CommandLine.IndexOf(" + quote(dll) + ", [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'The host does not run the isolated candidate DLL.' }",
    "Stop-Process -Id " + hostPid + " -Force -ErrorAction Stop",
    "[pscustomobject]@{pid=" + hostPid + ";parentPid=" + child.pid + ";verified=$true} | ConvertTo-Json -Compress",
  ].join("\n");
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10000 });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.pid, hostPid);
  assert.equal(result.parentPid, child.pid);
  assert.equal(result.verified, true);
  return result;
}

async function stopDesktop() {
  if (stoppedSession) {
    return stoppedSession;
  }
  if (socket?.readyState === WebSocket.OPEN) {
    if (dialogOpen) {
      await command("Page.handleJavaScriptDialog", { accept: false });
    }
    dialogs.length = 0;
    try { if (await evaluate("typeof slopsidianDiagnostics!==\"undefined\"")) { await errorAudit.flush(evaluate); } } catch (error) { (report.errorLogFlushFailures ??= []).push(error.stack); }
    closingLauncherPid = child.pid;
    socket.send(JSON.stringify({ id: ++id, method: "Browser.close" }));
  }
  const [code, signal] = await exited;
  await errorAudit.drain(socket);
  socket?.close();
  stoppedSession = {
    launcherPid: child.pid,
    electronPid: Number(sessionLog.match(/ELECTRON_HOST_PID (\d+)/)?.[1]),
    dotnetPid: Number(sessionLog.match(/DOTNET_HOST_PID (\d+)/)?.[1]),
    exitCode: code,
    exitSignal: signal,
    deadlineExpired: sessionLog.includes("smoke deadline expired"),
  };
  if (code === 0 && signal === null && !stoppedSession.deadlineExpired && sessionLog.includes("Application is shutting down...")) {
    const accepted = shutdownConsoleCandidates.filter(entry => entry.launcherPid === child.pid);
    accepted.forEach(entry => expectedShutdownErrors.add(entry.text));
    report.controlledShutdownConsoleErrors ??= [];
    report.controlledShutdownConsoleErrors.push(...accepted.map(entry => ({ ...entry, exitCode: code, exitSignal: signal, reason: "Exact local Blazor transport log after requested Browser.close and before a verified graceful owned-backend exit." })));
  }
  closingLauncherPid = null;
  report.processes.push(stoppedSession);
  return stoppedSession;
}

async function restartDesktop(afterStop) {
  assert.deepEqual(await readArtifacts(), initialArtifacts, "Candidate artifacts changed during the desktop scenario; rerun against a stable build.");
  const stopped = await stopDesktop();
  assert.equal(stopped.exitCode, 0, log);
  assert.equal(stopped.exitSignal, null);
  assert.equal(stopped.deadlineExpired, false);
  if (afterStop) { await afterStop(); }
  endpoint = undefined;
  vaultEndpoint = undefined;
  sessionLog = "";
  stoppedSession = undefined;
  child = spawn(join(root, "node_modules", "electron", "dist", "electron.exe"), [root, ...inputEnvironmentArguments, ...(discoveryPanesOnly ? ["--smoke-profile=" + discoveryPanesProfile] : []), ...(bookmarksOnly ? ["--smoke-profile=" + bookmarksProfile] : []), ...(attachmentsOnly ? ["--smoke-profile=" + attachmentsProfile] : []), ...(autosaveOnly ? ["--smoke-profile=" + autosaveProfile] : []), ...(draftRescueOnly ? ["--smoke-profile=" + draftRescueProfile] : []), ...(rescueReviewOnly ? ["--smoke-profile=" + rescueReviewProfile] : []), ...(rescueInspectionOnly ? ["--smoke-profile=" + rescueInspectionProfile] : []), ...(rescueReviewStateOnly ? ["--smoke-profile=" + rescueReviewStateProfile] : []), "--smoke", errorRun, ...(outgoingOnly ? ["--smoke-profile=outgoing"] : workspacesOnly ? ["--smoke-profile=workspaces"] : mermaidOnly ? ["--smoke-profile=mermaid"] : audioOnly ? ["--smoke-profile=audio"] : recoveryOnly ? ["--smoke-profile=recovery"] : baseSummariesOnly ? ["--smoke-profile=bases-summaries"] : basesOnly ? ["--smoke-profile=bases"] : []), ...(syntheticAudio ? ["--smoke-audio"] : []), `--vault=${vault}`, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  exited = once(child, "exit");
  collectOutput();
  await connectDesktop();
}

try {
  await connectDesktop();
  if (throughChooser) {
    await waitExpression('document.querySelector("#vault-dialog").open&&!document.querySelector("main").getAttribute("aria-busy").includes("true")', "startup vault chooser without --vault");
    assert.equal(await evaluate("app.vault.rootPath"), null);
    assert.equal(await evaluate('document.querySelector("#cancel-vault-selection").hidden'), true);
    await press("Escape", "Escape", 27);
    await press("o", "KeyO", 79, 2);
    assert.equal(await evaluate('document.querySelector("#vault-dialog").open'), true);
    assert.equal(await evaluate('document.querySelector("#desktop-picker").open'), false);
    const startupScreenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidence, "vault-chooser.png"), Buffer.from(startupScreenshot.data, "base64"));
    await fillInput("#vault-open-path", join(vault, "Missing folder"));
    await click("#confirm-open-vault");
    await waitExpression('document.querySelector("#vault-dialog-error")?.textContent.includes("does not exist")', "missing-vault error retained the chooser");
    assert.equal(await evaluate("app.vault.rootPath"), null);
    await fillInput("#new-vault-name", "Existing vault");
    await fillInput("#new-vault-location", createLocation);
    await click("#confirm-create-vault");
    await waitExpression('document.querySelector("#vault-dialog-error")?.textContent.includes("already exists")', "creation refused an existing vault");
    assert.equal(await readFile(join(createLocation, "Existing vault", "Keep.md"), "utf8"), "Keep the existing vault.\n");
    await fillInput("#new-vault-name", "Created vault");
    await click("#confirm-create-vault");
    const createdVault = join(createLocation, "Created vault");
    await waitExpression(`app.vault.rootPath===${JSON.stringify(createdVault)}&&!document.querySelector("#vault-dialog").open&&!app.changingVault`, "new vault opened");
    assert.equal(await evaluate("app.vault.getFiles().length"), 0);
    assert.equal(await evaluate("Object.keys(app.plugins.plugins).length"), 0);
    report.checks.push("A no-argument launch showed the vault chooser rather than the demo; Escape/shortcuts could not bypass it, and missing/existing-folder errors preserved the chooser and existing notes.");
    await createNote("First note.md");
    await focusEditor();
    const firstContent = "# First note\nSaved before changing vaults.\n";
    await command("Input.insertText", { text: firstContent });
    await waitExpression("app.dirty", "new-vault unsaved note");
    await click("#open-vault");
    await waitExpression('document.querySelector("#vault-dialog").open', "vault manager from ribbon");
    await click("#cancel-vault-selection");
    await waitExpression('!document.querySelector("#vault-dialog").open', "cancelled vault switch");
    assert.equal(await evaluate("app.dirty"), true);
    assert.equal(await evaluate("app.editor.getValue()"), firstContent);
    await click("#vault-switcher");
    await waitExpression('document.querySelector("#vault-dialog").open&&document.querySelector("#vault-dialog").dataset.busy==="false"', "vault manager from vault name");
    await press("Escape", "Escape", 27);
    await waitExpression('!document.querySelector("#vault-dialog").open', "Escape cancelled a switch with an existing vault");
    assert.equal(await evaluate("app.dirty"), true);
    assert.equal(await evaluate("app.editor.getValue()"), firstContent);
    await click("#vault-switcher");
    await waitExpression('document.querySelector("#vault-dialog").open', "vault manager reopened after Escape");
    await fillInput("#vault-open-path", vault);
    await click("#confirm-open-vault");
    await waitExpression(`app.vault.rootPath===${JSON.stringify(vault)}&&!document.querySelector("#vault-dialog").open&&!app.changingVault`, "existing vault opened through the chooser");
    assert.equal(await readFile(join(createdVault, "First note.md"), "utf8"), firstContent);
    assert.equal(await evaluate('app.workspace.leaves().some(leaf=>leaf.session?.document.file.path==="First note.md")'), false);
    report.createdVault = createdVault;
    report.checks.push("Create vault made a fresh folder; cancelling kept its dirty buffer, and opening an existing vault saved those notes before replacing the workspace without retaining foreign buffers.");
  } else {
    assert.equal(await evaluate('document.querySelector("#vault-dialog").open'), false);
  }
  const health = await evaluate('(async()=>await(await fetch("/api/health")).json())()');
  assert.match(health.runtime, /^\.NET 10\./);
  assert.equal(await evaluate("app.vault.adapter.getBasePath()"), vault);
  assert.deepEqual(await evaluate("Object.keys(app.plugins.plugins).sort()"), community ? ["sample-plugin"] : []);
  report.runtime = health.runtime;
  await waitExpression('Boolean(document.querySelector("#core-settings-host")?.dataset.coreVerificationSource)', "core verification build identity");
  report.sourceFingerprint = await evaluate('document.querySelector("#core-settings-host").dataset.coreVerificationSource');
  report.coreSettingsAvailability = await evaluate("app.core.states.map(({id,implemented,settingsSupport})=>({id,implemented,settingsSupport}))");
  assert.equal(await readFile(join(vault, ".obsidian", "community-plugins.json"), "utf8"), communityConfiguration);
  report.checks.push("Real .NET host and interactive Blazor page opened an existing vault and imported its enabled-plugin list without rewriting it.");

  if (discoveryPanesOnly) {
    const { checkDiscoveryPanes } = await import("./discovery-pane-scenarios.mjs");
    await checkDiscoveryPanes({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("Discovery pane restart"); },
      afterReload: () => waitForDesktopReady("Discovery local return"),
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "discovery-panes-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (bookmarksOnly) {
    const { checkBookmarkWorkflows } = await import("./bookmark-scenarios.mjs");
    await checkBookmarkWorkflows({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("Bookmarks restart"); },
      afterReload: () => waitForDesktopReady("Bookmarks local return"),
      capture: async (mode = "graph-regression") => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "bookmarks-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (backlinkPanesOnly) {
    const { checkBacklinkPanes } = await import("./backlink-pane-scenarios.mjs");
    await checkBacklinkPanes({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("Backlink pane restart"); },
      afterReload: () => waitForDesktopReady("Backlink local return"),
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "backlink-panes-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (outlinePanesOnly) {
    const { checkOutlinePanes } = await import("./outline-pane-scenarios.mjs");
    await checkOutlinePanes({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("Outline pane restart"); },
      afterReload: () => waitForDesktopReady("Outline local return"),
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "outline-panes-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (searchPanesOnly) {
    const { checkSearchPanes } = await import("./search-pane-scenarios.mjs");
    await checkSearchPanes({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("Search pane restart"); },
      afterReload: () => waitForDesktopReady("Search local return"),
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "search-panes-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (fileExplorerOnly) {
    const { checkFileExplorer } = await import("./file-explorer-scenarios.mjs");
    await checkFileExplorer({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("Files pane restart"); },
      afterReload: () => waitForDesktopReady("Files local return"),
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "file-explorer-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (workspaceStartupOnly) {
    const { checkWorkspaceStartup } = await import("./workspace-startup-scenarios.mjs");
    await checkWorkspaceStartup({ directory: vault, evaluate, command, click, press, wait: waitExpression, handleDialog, report,
      restart: async prepare => { await restartDesktop(prepare); await waitForDesktopReady("original workspace startup"); },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "workspace-startup-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (paneResizeOnly) {
    const { checkPaneResize } = await import("./pane-resize-scenarios.mjs");
    await checkPaneResize({ directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("pane resize restart"),
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "pane-resize-" + mode + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (diagnosticsOnly) {
    const { checkErrorLogging } = await import("./error-log-scenarios.mjs");
    await checkErrorLogging({ evaluate, click, report, command, downloadDirectory: join(evidence, "diagnostics-desktop-download") });
  } else if (tabMovementOnly) {
    const { checkTabMovement } = await import("./tab-movement-scenarios.mjs");
    await checkTabMovement({ directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("workspace tab movement restart"),
      capture: async name => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "tabs-" + name + "-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (coreStatusOnly) {
    const { checkCoreVerificationStatus } = await import("./core-verification-scenarios.mjs");
    await checkCoreVerificationStatus({ evaluate, click, wait: waitExpression, restart: restartDesktop, report,
      capture: async () => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "core-status-desktop.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (communityInstallOnly) {
    const { checkCommunityInstallation } = await import("./community-install-scenarios.mjs");
    await checkCommunityInstallation({ directory: vault, evaluate, command, click, press, wait: waitExpression, handleDialog, report,
      afterReload: () => waitForDesktopReady("community installation reload"),
      capture: async phase => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, `community-install-${phase ?? "complete"}-desktop.png`), Buffer.from(screenshot.data, "base64")); },
    });
  } else if (communitySettingsOnly) {
    report.scope = "community-settings-runtime";
    const { checkCommunitySettings } = await import("./community-settings-scenarios.mjs");
    await checkCommunitySettings({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      afterReload: () => waitForDesktopReady("community settings reload"),
      selectVault: async path => {
        if (await evaluate('document.querySelector("#settings-dialog").open')) { await closeSettings(); }
        await click("#vault-switcher");
        await waitExpression('document.querySelector("#vault-dialog").open', "community vault chooser");
        await fillInput("#vault-open-path", path);
        await click("#confirm-open-vault");
        await waitExpression(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "community vault selected");
      },
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "community-settings-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (community) {
    await togglePlugin("sample-plugin", true);
    await waitExpression('document.querySelector(\'[data-plugin-id="sample-plugin"][data-loaded=true]\')', "unchanged sample plugin");
    assert.equal(await evaluate('document.querySelector("#plugin-status-bar [data-plugin-id=sample-plugin]").textContent'), "Status bar text");
    await runCommand("sample-plugin:open-modal-simple");
    await waitExpression('document.querySelector(".modal-content")?.textContent==="Woah!"', "sample modal");
    await click(".modal-close-button");
    await communitySettings();
    await click('[data-settings-plugin="sample-plugin"]');
    const settingSelector = "#plugin-settings-host input";
    await waitExpression(`document.querySelector(${JSON.stringify(settingSelector)})?.value==="default"`, "sample setting default");
    const setting = "Saved through Blazor and C#";
    await evaluate(`document.querySelector(${JSON.stringify(settingSelector)}).focus();document.querySelector(${JSON.stringify(settingSelector)}).select()`);
    await command("Input.insertText", { text: setting });
    const settingsPath = join(vault, ".obsidian", "plugins", "sample-plugin", "data.json");
    await waitFor(async () => {
      try {
        return JSON.parse(await readFile(settingsPath, "utf8")).mySetting === setting;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        return false;
      }
    }, "settings persisted by .NET");
    await closeSettings();
    report.checks.push("Unmodified upstream sample plugin registered its ribbon/status bar, opened its modal, and persisted settings.");

    await togglePlugin("editor-probe", true);
    await waitExpression('document.querySelector(\'[data-plugin-id="editor-probe"][data-loaded=true]\')', "editor probe");
    const note = `Plugin smoke ${Date.now()}.md`;
    await createNote(note);
    await waitExpression(`app.current?.file.path===${JSON.stringify(note)}`, "note created through Blazor");
    const initialContent = "# Plugin compatibility\n\nTODO: Save through the .NET host. \u03bb \u4e2d\u6587\n";
    await focusEditor();
    await command("Input.insertText", { text: initialContent });
    await waitExpression("app.dirty", "visible editor input");
    await waitExpression('document.querySelector(".prototype-todo")?.textContent==="TODO"', "shared CodeMirror decoration");
    await click("#save-note");
    const notePath = join(vault, note);
    await waitFor(() => fileEquals(notePath, initialContent), "exact note bytes on disk");
    await waitExpression('document.querySelector("#plugin-status-bar [data-plugin-id=editor-probe]").textContent.includes("Modify events: 1")', "vault modify event");

    await runCommand("sample-plugin:replace-selected");
    let expectedContent = initialContent + "Sample editor command";
    await waitExpression(`app.editor.getValue()===${JSON.stringify(expectedContent)}`, "sample plugin editor command");
    await focusEditor();
    await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
    await waitFor(() => fileEquals(notePath, expectedContent), "Ctrl+S persisted plugin-edited bytes");
    await runCommand("sample-plugin:open-modal-complex");
    await waitExpression('document.querySelector(".modal-content")?.textContent==="Woah!"', "conditional command and MarkdownView identity");
    await click(".modal-close-button");
    await runCommand("editor-probe:read-through-node");
    await waitExpression(`Array.from(document.querySelectorAll(".notice")).some(item=>item.textContent===${JSON.stringify(`Node read succeeded: ${Buffer.byteLength(expectedContent, "utf8")} bytes`)})`, "actual renderer Node filesystem access");
    report.checks.push("Visible CodeMirror input and the unchanged plugin editor command saved exact disk bytes through C#; Ctrl+S worked.");
    report.checks.push("Shared CodeMirror extensions, vault modify events, conditional MarkdownView commands, and renderer Node filesystem access worked.");

    await click('[data-note-path="CRLF note.md"]');
    await waitExpression('app.current?.file.path==="CRLF note.md"', "existing CRLF/BOM note");
    assert.equal(await evaluate("app.editor.getValue()"), crlfContent);
    await focusEditor();
    await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "End", code: "End", windowsVirtualKeyCode: 35, modifiers: 2 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35, modifiers: 2 });
    await command("Input.insertText", { text: "CRLF edit" });
    await click("#save-note");
    const expectedCrlf = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(crlfContent + "CRLF edit")]);
    await waitFor(() => fileEquals(join(vault, "CRLF note.md"), expectedCrlf), "UTF-8 BOM and CRLF preserved through the visible editor");
    report.checks.push("The visible editor preserved existing UTF-8 BOM/CRLF bytes, and the main note round-tripped Unicode text.");

    const crlfLeft = await evaluate("app.workspace.activeLeaf.id");
    await runCommand("workspace:split-vertical");
    const crlfRight = await evaluate("app.workspace.activeLeaf.id");
    await click(`[data-tab-id="${crlfLeft}"]`);
    await waitExpression(`app.workspace.activeLeaf.id===${JSON.stringify(crlfLeft)}`, "left CRLF pane");
    await focusEditor();
    await press("End", "End", 35, 2);
    await click(`[data-tab-id="${crlfRight}"]`);
    await waitExpression(`app.workspace.activeLeaf.id===${JSON.stringify(crlfRight)}`, "right CRLF pane");
    await focusEditor();
    await press("a", "KeyA", 65, 2);
    await press("Enter", "Enter", 13);
    await waitExpression(`app.workspace.getLeafById(${JSON.stringify(crlfLeft)}).view.editor.getValue()==="\\r\\n"`, "a single newline replacement clamped the other pane's selection to one normalized character");
    await press("Home", "Home", 36, 2);
    const shortenedCrlf = "# Short\r\n";
    await command("Input.insertText", { text: "# Short" });
    await waitExpression(`app.workspace.getLeafById(${JSON.stringify(crlfLeft)}).view.editor.getValue()===${JSON.stringify(shortenedCrlf)}`, "shortened CRLF buffer synchronized without an invalid selection");
    await press("s", "KeyS", 83, 2);
    await waitFor(() => fileEquals(join(vault, "CRLF note.md"), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(shortenedCrlf)])), "shared CRLF save preserved the BOM");
    await press("w", "KeyW", 87, 2);
    await waitExpression('document.querySelectorAll(".workspace-tabs").length===1', "closed split returned to its original pane");
    report.checks.push("Shortening a shared CRLF document kept the other pane's selection in normalized document bounds and preserved the physical BOM/CRLF bytes.");

    const conflictNote = "Conflict recovery.md";
    await createNote(conflictNote);
    await waitExpression(`app.current?.file.path===${JSON.stringify(conflictNote)}`, "conflict-recovery note");
    const unsaved = "Unsaved local text.\n";
    await focusEditor();
    await command("Input.insertText", { text: unsaved });
    await waitExpression("app.dirty", "unsaved conflict text");
    const external = "Content from another editor.\n";
    await writeFile(join(vault, conflictNote), external);
    await expectErrors({ evaluate, report }, [{ source: "host", message: JSON.stringify({ error: "This file changed on disk. Your unsaved text is retained; reopen the file after resolving the conflict." }) }], async () => { await click("#save-note");
    await waitExpression('document.querySelector(".error-banner")?.textContent.includes("changed on disk")', "explicit save conflict"); }, "Check desktop explicit-save conflict protection");
    assert.equal(await evaluate("app.editor.getValue()"), unsaved);
    assert.equal(await readFile(join(vault, conflictNote), "utf8"), external);
    await click("#reload-note");
    await waitFor(async () => dialogs.length > 0, "discard confirmation");
    assert.match(dialogs.shift().message, /Discard unsaved text/);
    await command("Page.handleJavaScriptDialog", { accept: false });
    await waitExpression('!document.querySelector("#reload-note").disabled', "cancelled reload");
    assert.equal(await evaluate("app.editor.getValue()"), unsaved);
    assert.equal(await evaluate("app.dirty"), true);
    await click("#reload-note");
    await waitFor(async () => dialogs.length > 0, "second discard confirmation");
    await command("Page.handleJavaScriptDialog", { accept: true });
    dialogs.shift();
    await waitExpression(`app.editor.getValue()===${JSON.stringify(external)} && !app.dirty`, "conflict recovery");
    assert.equal(await readFile(join(vault, conflictNote), "utf8"), external);
    await click(`[data-note-path="${note}"]`);
    await waitExpression(`app.current?.file.path===${JSON.stringify(note)}`, "main note after recovery");
    report.checks.push("Conflicting saves retained local and external text; cancelling reload kept the edits, and confirmed reload recovered the disk version.");

    await evaluate('window.detachedProbeStatus=document.querySelector("#plugin-status-bar [data-plugin-id=editor-probe]")');
    await togglePlugin("editor-probe", false);
    await waitExpression('!document.querySelector(".prototype-todo") && !document.querySelector("#plugin-status-bar [data-plugin-id=editor-probe]")', "extension and status-bar cleanup");
    await evaluate("window.detachedProbeText=window.detachedProbeStatus.textContent");
    await evaluate('app.vault.trigger("modify",app.workspace.getActiveFile())');
    assert.equal(await evaluate("window.detachedProbeStatus.textContent===window.detachedProbeText"), true);
    await evaluate("delete window.detachedProbeStatus;delete window.detachedProbeText");
    assert.equal(await evaluate('app.commands.listCommands().some(command=>command.id.startsWith("editor-probe:"))'), false);
    report.checks.push("Disabling the editor probe removed its CodeMirror extension, command, status item, and event registration.");

    await communitySettings();
    await click('[data-toggle-plugin="failure-probe"]');
    await waitExpression('document.querySelector(\'[data-plugin-id="failure-probe"] .plugin-error\')?.textContent.includes("Expected fixture load failure")', "explicit plugin-load error");
    assert.equal(await evaluate('app.commands.listCommands().some(command=>command.id.startsWith("failure-probe:"))'), false);
    assert.equal(await evaluate('Boolean(document.querySelector("#plugin-status-bar [data-plugin-id=failure-probe]"))'), false);
    report.checks.push("A plugin that failed after partial registration was visibly rejected and its partial UI/commands were rolled back.");

    await rm(failureDirectory, { recursive: true });
    await command("Page.reload");
    await waitForDesktopReady("Blazor page after renderer reload");
    await click(`[data-note-path="${note}"]`);
    await waitExpression(`app.current?.file.path===${JSON.stringify(note)}`, "reopened note");
    assert.equal(await evaluate("app.editor.getValue()"), expectedContent);
    await togglePlugin("sample-plugin", true);
    await waitExpression('document.querySelector(\'[data-plugin-id="sample-plugin"][data-loaded=true]\')', "sample plugin after reload");
    await communitySettings();
    await click('[data-settings-plugin="sample-plugin"]');
    await waitExpression(`document.querySelector("#plugin-settings-host input")?.value===${JSON.stringify(setting)}`, "settings after reload");
    await click("#community-plugins-tab");
    await click('[data-toggle-plugin="sample-plugin"]');
    await waitExpression('!app.plugins.isManaging&&!document.querySelector(\'[data-plugin-id="sample-plugin"][data-loaded=true]\')', "sample plugin disabled and saved");
    await closeSettings();
    await evaluate('document.querySelectorAll(".notice").forEach(item=>item.remove());document.body.dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    await delay(150);
    assert.equal(await evaluate('document.querySelectorAll(".notice").length'), 0);
    assert.equal(await evaluate('app.commands.listCommands().some(command=>command.id.startsWith("sample-plugin:"))'), false);
    report.checks.push("Reloading reopened the saved note and plugin settings; disabling the sample removed its commands and document event listener.");

    await togglePlugin("sample-plugin", true);
    await waitExpression('document.querySelector(\'[data-plugin-id="sample-plugin"][data-loaded=true]\')', "sample plugin for final screenshot");
    await togglePlugin("editor-probe", true);
    await waitExpression('document.querySelector(".prototype-todo")', "editor decoration after reload");
    const nested = "Folder/Workspace child.md";
    await createNote("Folder\\Workspace child.md");
    const nestedContent = "# Workspace child\n\nTODO: nested note.\n";
    await focusEditor();
    await command("Input.insertText", { text: nestedContent });
    await press("s", "KeyS", 83, 2);
    await waitFor(() => fileEquals(join(vault, "Folder", "Workspace child.md"), nestedContent), "nested note disk persistence");
    assert.equal(await evaluate('document.querySelector(\'[data-folder-path="Folder"]\').open'), true);
    await waitExpression(`document.querySelector('[data-note-path="${nested}"]').classList.contains("is-active")`, "active nested note highlighted in the file tree");
    const resize = await evaluate('(()=>{const bounds=document.querySelector("#left-sidebar-resizer").getBoundingClientRect();return {x:bounds.x+.5,y:bounds.y+150,width:app.workspace.leftSplit.width}})()');
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: resize.x, y: resize.y });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: resize.x, y: resize.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: resize.x + 36, y: resize.y, button: "left", buttons: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: resize.x + 36, y: resize.y, button: "left", clickCount: 1 });
    await waitExpression(`app.workspace.leftSplit.width===${resize.width + 36}`, "real sidebar drag resized the file explorer");
    await press("ArrowLeft", "ArrowLeft", 37, 1);
    await waitExpression(`app.current?.file.path===${JSON.stringify(note)}`, "Alt+Left navigation history");
    await press("ArrowRight", "ArrowRight", 39, 1);
    await waitExpression(`app.current?.file.path===${JSON.stringify(nested)}`, "Alt+Right navigation history");
    await press("o", "KeyO", 79, 2);
    await waitExpression('document.querySelector("#desktop-picker[data-picker=files]")?.open', "Ctrl+O quick switcher");
    await command("Input.insertText", { text: "plg smk" });
    await waitExpression(`document.querySelectorAll("[data-switcher-path]").length===1&&document.querySelector("[data-switcher-path]").dataset.switcherPath===${JSON.stringify(note)}`, "quick-switcher filtering");
    await press("Enter", "Enter", 13, 2);
    await waitExpression(`app.current?.file.path===${JSON.stringify(note)}&&document.querySelectorAll(".workspace-tab-header").length===2`, "Ctrl+Enter opened a new tab");
    report.checks.push("Hierarchical file navigation and active-file highlighting, nested note creation, real sidebar drag, Alt+Left/Right history, Ctrl+O fuzzy filtering and Ctrl+Enter new-tab opening worked through desktop controls.");

    await runCommand("editor-probe:open-in-tab");
    await waitExpression('document.querySelectorAll(".workspace-tab-header").length===3', "plugin-created WorkspaceLeaf tab");
    await waitExpression('Array.from(document.querySelectorAll(".notice")).some(item=>item.textContent==="WorkspaceLeaf opened the note in a new tab.")', "public WorkspaceLeaf identity");
    const leftLeaf = await evaluate("app.workspace.activeLeaf.id");
    await runCommand("workspace:split-vertical");
    await waitExpression('document.querySelectorAll(".workspace-tabs").length===2', "vertical split");
    assert.equal(await evaluate("app.workspace.getLayout().main.direction"), "vertical");
    await focusEditor();
    await press("End", "End", 35, 2);
    const splitEdit = "\nSplit buffer edit.\n";
    await command("Input.insertText", { text: splitEdit });
    expectedContent += splitEdit;
    await waitExpression(`app.workspace.getLeafById(${JSON.stringify(leftLeaf)}).view.editor.getValue()===${JSON.stringify(expectedContent)}`, "live shared buffers across panes");
    await press("s", "KeyS", 83, 2);
    await waitFor(() => fileEquals(notePath, expectedContent), "split edit saved without self-conflict");
    await runCommand("workspace:split-horizontal");
    await waitExpression('document.querySelectorAll(".workspace-tabs").length===3', "nested horizontal split");
    const directions = await evaluate("app.workspace.getLayout().main.children.map(child=>child.type==='split'?child.direction:child.type)");
    assert.ok(directions.includes("horizontal"));
    assert.equal(await evaluate('document.querySelectorAll(".workspace-leaf:not([hidden]) .prototype-todo").length'), 3);
    report.checks.push("A plugin created a real shared WorkspaceLeaf; right/down splits shared live document buffers, saved without self-conflicts and inherited registered CodeMirror extensions.");

    await click(`[data-tab-path="${nested}"]`);
    await waitExpression(`app.current?.file.path===${JSON.stringify(nested)}`, "select nested note tab");
    await focusEditor();
    await press("End", "End", 35, 2);
    const closingEdit = "Saved when closing its tab.\n";
    await command("Input.insertText", { text: closingEdit });
    await waitExpression("app.dirty", "dirty tab before close");
    await press("w", "KeyW", 87, 2);
    await waitExpression('!app.workspace.leaves().some(leaf=>leaf.session?.document.file.path==="Folder/Workspace child.md")', "dirty tab closed");
    await waitFor(() => fileEquals(join(vault, "Folder", "Workspace child.md"), nestedContent + closingEdit), "closing saved the tab");
    await runCommand("workspace:toggle-pin");
    const pinned = await evaluate("app.workspace.activeLeaf.id");
    await runCommand("workspace:toggle-right-sidebar");
    await waitExpression('!document.querySelector("#desktop-shell").classList.contains("right-collapsed")&&document.querySelector(".outline-heading")', "outline dock");
    await click(".outline-heading");
    assert.equal(await evaluate("app.editor.getCursor().line"), 0);
    const expectedLayout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
    const savedLayout = JSON.parse(await readFile(join(vault, ".obsidian", "vault-dotnet-workspace.json"), "utf8"));
    assert.equal(savedLayout.active, expectedLayout.active);
    assert.equal(savedLayout.main.children.length, expectedLayout.main.children.length);
    assert.equal(await readFile(join(vault, ".obsidian", "workspace.json"), "utf8"), originalWorkspace);
    await command("Page.reload");
    await waitForDesktopReady("saved tab/split layout after reload");
    await waitExpression('document.querySelectorAll(".workspace-tabs").length===3', "saved tab/split layout after reload");
    assert.deepEqual(await evaluate("app.workspace.getLayout()"), expectedLayout);
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(pinned)}).pinned`), true);
    assert.equal(await evaluate("app.editor.getValue()"), expectedContent);
    assert.deepEqual(await evaluate("Object.keys(app.plugins.plugins).sort()"), ["editor-probe", "sample-plugin"]);
    report.checks.push("Closing a dirty tab saved its bytes; pin state, selected tabs, nested splits and sidebar visibility restored from the per-vault layout without changing Obsidian workspace.json.");
    report.restoredWorkspaceLayout = expectedLayout;

    await togglePlugin("sample-plugin", true);
    await togglePlugin("editor-probe", true);
    assert.equal(await evaluate('document.querySelectorAll(".workspace-leaf:not([hidden]) .prototype-todo").length'), 3);
    await runCommand("sample-plugin:open-modal-complex");
    await waitExpression('document.querySelector(".modal-content")?.textContent==="Woah!"', "unchanged sample plugin in restored multi-pane workspace");
    await click(".modal-close-button");
    await togglePlugin("editor-probe", false);
    assert.equal(await evaluate('document.querySelectorAll(".prototype-todo").length'), 0);
    await togglePlugin("editor-probe", true);
    await runCommand("workspace:toggle-right-sidebar");
    report.finalWorkspaceLayout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
    await evaluate('document.querySelectorAll(".notice").forEach(item=>item.remove())');
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
    assert.equal(await evaluate('Boolean(document.querySelector(".error-banner"))'), false);
    assert.deepEqual(JSON.parse(await readFile(join(vault, ".obsidian", "community-plugins.json"), "utf8")), ["sample-plugin", "editor-probe"]);
    assert.equal(await readFile(join(vault, ".obsidian", "workspace.json"), "utf8"), originalWorkspace);
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidence, "prototype.png"), Buffer.from(screenshot.data, "base64"));
    await writeFile(join(evidence, "workspace.png"), Buffer.from(screenshot.data, "base64"));
    await communitySettings();
    await click('[data-settings-plugin="sample-plugin"]');
    const settingsScreenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidence, "plugin-settings.png"), Buffer.from(settingsScreenshot.data, "base64"));
    await closeSettings();
    report.note = note;
    report.exactSavedContent = expectedContent;
    report.settings = { mySetting: setting };
    report.existingObsidianPluginConfigurationImportedWithoutRewrite = true;
    report.intentionalPluginTogglesPersisted = ["sample-plugin", "editor-probe"];
    report.existingObsidianWorkspaceUnchanged = true;
    report.samplePluginProvenance = JSON.parse(await readFile(join(root, "vendor", "sample-plugin.provenance.json"), "utf8"));
    for (const plugin of ["sample-plugin", "editor-probe"]) {
      assert.deepEqual(
        await readFile(join(vault, ".obsidian", "plugins", plugin, "main.js")),
        await readFile(join(root, ".runtime", "DemoVault", ".obsidian", "plugins", plugin, "main.js")),
        `The exercised ${plugin} bundle must match the current build`,
      );
    }
    const { checkViewHost } = await import("./view-scenarios.mjs");
    await checkViewHost({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("custom-view desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "custom-views-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (outgoingOnly) {
    await checkOutgoingWorkflows();
  } else if (workspaceTransitionOnly) {
    const { checkWorkspaceTransition } = await import("./workspace-transition-scenarios.mjs");
    await checkWorkspaceTransition({
      directory: vault, evaluate, command, click, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("workspace-transition desktop restart"),
      selectVault: async path => {
        await click("#vault-switcher"); await waitExpression('document.querySelector("#vault-dialog").open', "vault path dialog ready");
        await click("#vault-open-path"); await fillInput("#vault-open-path", path);
        assert.equal(await evaluate('document.querySelector("#vault-open-path").value'), path);
        await click("#confirm-open-vault");
      },
      capture: async () => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "workspace-transition-desktop.png"), Buffer.from(screenshot.data, "base64")); },
    });
  } else if (workspacesOnly) {
    const { checkWorkspaceImport } = await import("./workspace-import-scenarios.mjs");
    await checkWorkspaceImport({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Workspaces desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "workspaces-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (mermaidOnly) {
    await checkMermaidWorkflows();
  } else if (audioOnly) {
    await checkAudioWorkflows();
  } else if (recoveryOnly) {
    const { checkRecovery } = await import("./recovery-scenarios.mjs");
    await checkRecovery({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Recovery desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "recovery-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (baseSummariesOnly) {
    await checkBaseSummaryWorkflows();
  } else if (basesOnly) {
    const { checkBases } = await import("./bases-scenarios.mjs");
    if (!coreVerificationOnly) await checkBases({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Bases desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "bases-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (additionalPluginsOnly) {
    const { checkAdditionalPlugins } = await import("./additional-plugin-scenarios.mjs");
    try {
      await checkAdditionalPlugins({
        directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
        afterReload: () => waitForDesktopReady("additional Example-plugin desktop restart"), readConsoleErrors: () => [...consoleErrors], readRuntimeErrors: () => [...browserErrors], readExpectedShutdownErrors: () => [...expectedShutdownErrors],
        capture: async phase => {
          if (phase !== undefined && !["board", "restored", "linter", "refactor", "quickadd-template", "quickadd-capture", "omnisearch", "linter-preview", "linter-bulk", "refactor-headings", "quickadd-macro", "templater-226", "kanban-editing", "iconize", "iconize-emoji"].includes(phase)) { throw new Error("Unknown additional-plugin screenshot phase."); }
          const screenshot = await command("Page.captureScreenshot", { format: "png" });
          await writeFile(join(evidence, `additional-plugins-desktop${phase ? "-" + phase : ""}.png`), Buffer.from(screenshot.data, "base64"));
        },
      });
    } finally {
      report.artifacts = await readArtifacts();
      assert.deepEqual(report.artifacts, initialArtifacts, "Additional-plugin source or artifacts changed during the desktop scenario.");
      report.artifactStability = "verified-through-scenario";
    }
  } else if (reportedPluginsOnly) {
    const { checkReportedPlugins } = await import("./reported-plugin-scenarios.mjs");
    try {
      await checkReportedPlugins({
        directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
        afterReload: () => waitForDesktopReady("reported community-plugin desktop restart"), readConsoleErrors: () => [...consoleErrors],
      });
    } finally {
      report.artifacts = await readArtifacts();
      assert.deepEqual(report.artifacts, initialArtifacts, "Reported-plugin artifacts changed during the desktop scenario.");
      report.artifactStability = "verified-through-scenario";
    }
  } else if (excalidrawOnly) {
    const { checkExcalidraw } = await import("./excalidraw-scenarios.mjs");
    try {
      await checkExcalidraw({
        directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
        afterReload: () => waitForDesktopReady("actual Excalidraw desktop restart"),
      });
    } finally {
      report.artifacts = await readArtifacts();
      assert.deepEqual(report.artifacts, initialArtifacts, "Excalidraw artifacts changed during the desktop scenario.");
      report.artifactStability = "verified-through-scenario";
    }
  } else if (templaterOnly) {
    const { checkTemplater } = await import("./templater-scenarios.mjs");
    await checkTemplater({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("actual Templater desktop restart"),
    });
  } else if (tagsOnly) {
    const { checkTagRendering } = await import("./tag-scenarios.mjs");
    await checkTagRendering({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      afterReload: () => waitForDesktopReady("tag renderer reload"),
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, `tags-${mode}-desktop.png`), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (renderersOnly) {
    await checkMarkdownProcessorWorkflows();
  } else if (suggestionsOnly) {
    await checkPluginSuggestionWorkflows();
  } else if (attachmentsOnly) {
    const { checkAttachments } = await import("./attachment-scenarios.mjs");
    await checkAttachments({ directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      restart: restartDesktop, afterReload: () => waitForDesktopReady("attachment desktop restart"),
      setClipboard: async (kind, value) => { await evaluate('(()=>{const {clipboard,nativeImage}=require("electron");'+(kind==="image"?'clipboard.writeImage(nativeImage.createFromPath('+JSON.stringify(value)+'))':'clipboard.writeText('+JSON.stringify(value)+')')+'})()'); },
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence,"attachments-"+mode+"-desktop.png"),Buffer.from(screenshot.data,"base64")); },
    });
  } else if (autosaveOnly) {
    const { checkMarkdownAutosave } = await import("./autosave-scenarios.mjs");
    await checkMarkdownAutosave({
      directory: vault, targetDirectory: join(vault, "Autosave target"), evaluate, command, click, press, wait: waitExpression, handleDialog, report,
      restart: restartDesktop, afterReload: () => waitForDesktopReady("autosave desktop restart"),
      selectVault: async path => {
        await click("#vault-switcher"); await waitExpression('document.querySelector("#vault-dialog").open', "autosave vault chooser");
        await fillInput("#vault-open-path", path); await click("#confirm-open-vault");
        await waitExpression('app.vault.rootPath==='+JSON.stringify(path)+'&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "autosave selected vault");
      },
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidence, "autosave-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64")); },
    });
  } else if (rescueReviewStateOnly) {
    const { checkRescueReviewState } = await import("./draft-rescue-review-state-scenarios.mjs");
    await checkRescueReviewState({
      directory: vault, seed: rescueReviewStateSeed, evaluate, command, click, press, wait: waitExpression, report,
      restart: restartDesktop, afterReload: () => waitForDesktopReady("remembered rescue review restart"),
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "rescue-review-state-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (rescueInspectionOnly) {
    const { checkDraftRescueInspection } = await import("./draft-rescue-inspection-scenarios.mjs");
    await checkDraftRescueInspection({
      directory: vault, seed: rescueInspectionSeed, evaluate, command, click, press, wait: waitExpression, report,
      restart: restartDesktop, afterReload: () => waitForDesktopReady("rescue inspection desktop restart"),
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "rescue-inspection-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (rescueReviewOnly) {
    const { checkDraftRescueReview } = await import("./draft-rescue-review-scenarios.mjs");
    await checkDraftRescueReview({
      directory: vault, seed: rescueReviewSeed, evaluate, command, click, press, wait: waitExpression, report,
      restart: restartDesktop, afterReload: () => waitForDesktopReady("rescue review desktop restart"),
      readReveals: () => sessionLog.split(/\r?\n/).filter(line => line.startsWith("DRAFT_RESCUE_REVEAL ")).map(line => line.slice("DRAFT_RESCUE_REVEAL ".length)),
      selectVault: async path => {
        await click("#vault-switcher"); await waitExpression('document.querySelector("#vault-dialog").open', "review vault chooser");
        await fillInput("#vault-open-path", path); await click("#confirm-open-vault");
        await waitExpression(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "review selected vault");
      },
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "rescue-review-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (draftRescueOnly) {
    const { checkDraftRescue } = await import("./draft-rescue-scenarios.mjs");
    await checkDraftRescue({
      directory: vault, profile: join(root, ".runtime", "smoke-profile-" + draftRescueProfile),
      evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop, stop: stopDesktop,
      interruptBackend, readRescueResults: () => sessionLog.split(/\r?\n/).filter(line => line.startsWith("DESKTOP_DRAFT_RESCUE ")).map(line => JSON.parse(line.slice("DESKTOP_DRAFT_RESCUE ".length))),
      afterReload: () => waitForDesktopReady("draft rescue desktop restart"),
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "draft-rescue-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (modalFocusOnly) {
    const { checkModalFocus } = await import("./modal-focus-scenarios.mjs");
    await checkModalFocus({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("modal keyboard desktop restart"),
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "modal-focus-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (modalLayoutOnly) {
    const { checkModalLayout } = await import("./modal-layout-scenarios.mjs");
    await checkModalLayout({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("modal viewport desktop restart"),
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "modal-layout-" + mode + "-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (menusOnly) {
    const { checkMenuApi } = await import("./menu-scenarios.mjs");
    await checkMenuApi({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("menu API desktop restart"),
    });
  } else if (composerOnly) {
    const { checkNoteComposer } = await import("./composer-scenarios.mjs");
    await checkNoteComposer({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Note composer desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "composer-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (formatsOnly) {
    const { checkFormatConversion } = await import("./format-scenarios.mjs");
    await checkFormatConversion({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("format conversion desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "formats-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (previewsOnly) {
    const { checkPagePreviews } = await import("./preview-scenarios.mjs");
    await checkPagePreviews({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Page preview desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "previews-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (editingToolsOnly) {
    const { checkEditingTools } = await import("./editing-tools-scenarios.mjs");
    await checkEditingTools({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("editor-tools desktop restart"),
      capture: async kind => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, `${kind}-desktop.png`), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (canvasesOnly) {
    const { checkCanvases } = await import("./canvas-scenarios.mjs");
    await checkCanvases({
      directory: vault, evaluate, command, click, press, wait: waitExpression, handleDialog, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Canvas desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "canvases-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (graphsOnly) {
    const { checkGraphs } = await import("./graph-scenarios.mjs");
    await checkGraphs({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Graph desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "graphs-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  } else if (editorChromeOnly) {
    await checkEditorChromeWorkflows();
  } else if (discoveryOnly) {
    const { checkDiscovery } = await import("./discovery-scenarios.mjs");
    await checkDiscovery({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("discovery renderer reload"),
    });
  } else if (filesOnly) {
    const { checkFileOperations } = await import("./file-scenarios.mjs");
    await checkFileOperations({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("file operations desktop restart"),
    });
  } else if (propertiesOnly) {
    const { checkProperties } = await import("./organization-scenarios.mjs");
    await checkProperties({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("properties desktop restart"),
    });
  } else {
    await checkCoreWorkflows();
    const { checkCoreModules } = await import("./core-scenarios.mjs");
    await checkCoreModules({
      evaluate, command, click, waitExpression, waitFor, press, runCommand, fillInput, createNote, focusEditor,
      fileEquals, closeSettings, restartDesktop, report, vault, targets: coreVerificationOnly ? coreVerificationTargets : undefined,
      desktopTargets: async () => (await fetch(endpoint + "/json/list")).json(),
    });
    await checkEditorChromeWorkflows();
    if (!coreVerificationOnly) { await checkPluginSuggestionWorkflows(); await checkMarkdownProcessorWorkflows(); }
    const { checkNoteComposer } = await import("./composer-scenarios.mjs");
    await checkNoteComposer({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Note composer desktop restart"),
    });
    const { checkFormatConversion } = await import("./format-scenarios.mjs");
    await checkFormatConversion({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("format conversion desktop restart"),
    });
    const { checkReadingView } = await import("./reading-scenarios.mjs");
    if (!coreVerificationOnly) await checkReadingView({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report,
      afterReload: () => waitForDesktopReady("reading-mode renderer reload"),
    });
    const readingScreenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidence, "reading-desktop.png"), Buffer.from(readingScreenshot.data, "base64"));
    await checkOutgoingWorkflows();
    const { checkDiscovery } = await import("./discovery-scenarios.mjs");
    await checkDiscovery({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("discovery renderer reload"),
    });
    const discoveryScreenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidence, "discovery-desktop.png"), Buffer.from(discoveryScreenshot.data, "base64"));
    const { checkOrganization, checkNamedWorkspaces, checkProperties } = await import("./organization-scenarios.mjs");
    await restartDesktop();
    await checkOrganization({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("organization desktop restart"),
    });
    await checkNamedWorkspaces({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("named-workspace desktop restart"),
    });
    await restartDesktop();
    await checkProperties({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("properties desktop restart"),
    });
    const { checkFileOperations } = await import("./file-scenarios.mjs");
    await checkFileOperations({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("file operations desktop restart"),
    });
    await restartDesktop();
    const { checkGraphs } = await import("./graph-scenarios.mjs");
    await checkGraphs({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Graph desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "graphs-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
    const { checkCanvases } = await import("./canvas-scenarios.mjs");
    await checkCanvases({
      directory: vault, evaluate, command, click, press, wait: waitExpression, handleDialog, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Canvas desktop restart"),
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, "canvases-desktop.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
    const { checkPagePreviews } = await import("./preview-scenarios.mjs");
    await checkPagePreviews({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("Page preview desktop restart"),
    });
    const { checkEditingTools } = await import("./editing-tools-scenarios.mjs");
    await checkEditingTools({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("editor-tools desktop restart"),
    });
    const { checkRecovery } = await import("./recovery-scenarios.mjs");
    await checkRecovery({
      directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
      afterReload: () => waitForDesktopReady("File recovery desktop restart"),
    });
    const { checkBases } = await import("./bases-scenarios.mjs");
    if (!coreVerificationOnly) {
      await checkBases({ directory: vault, evaluate, command, click, press, wait: waitExpression, report, restart: restartDesktop,
        afterReload: () => waitForDesktopReady("Bases desktop restart"), });
      await checkBaseSummaryWorkflows();
      await restartDesktop();
      await checkMermaidWorkflows();
    }
    await restartDesktop();
    await checkAudioWorkflows();
  }
  assert.deepEqual(browserErrors, [], "The desktop emitted an uncaught browser exception");
  report.browserErrors = browserErrors;
  report.consoleErrors = consoleErrors;
  report.artifacts = await readArtifacts();
  assert.deepEqual(report.artifacts, initialArtifacts, "Candidate artifacts changed during the desktop scenario; no mixed-build acceptance is valid.");
  report.artifactStability = "verified-through-scenario";
  if (community) {
    for (const path of [
      relative(root, join(vault, ".obsidian", "plugins", "sample-plugin", "main.js")),
      relative(root, join(vault, ".obsidian", "plugins", "editor-probe", "main.js")),
      relative(root, join(vault, ".obsidian", "plugins", "view-host-probe", "main.js")),
    ]) {
      report.artifacts.push({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") });
    }
  }
  report.status = "passed";
} catch (error) {
  report.error = error.stack ?? String(error);
  report.pendingDialogs = [...dialogs];
  report.recentCommands = [...recentCommands];
  if (syntheticAudio && socket?.readyState === WebSocket.OPEN) {
    // Failure cleanup is limited to this disposable synthetic-audio session.
    if (dialogOpen) { await command("Page.handleJavaScriptDialog", { accept: false }); }
    report.audio = await evaluate('(()=>{const r=app.core.getEnabledPluginById("audio-recorder");const state={capture:r?.capture.state,tracks:r?.capture.liveTracks,saved:r?.saved,status:document.querySelector("[data-audio-status]")?.textContent};r?.capture.cancel();return state})()').catch(error => ({ diagnosticError: error.message }));
  }
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      report.diagnostics = await evaluate(`({
        focused:{hasFocus:document.hasFocus(),tag:document.activeElement?.tagName,id:document.activeElement?.id},
        keys:globalThis.smokeKeys?.slice(-12),
        changingVault:globalThis.app?.changingVault,
        coreBusy:globalThis.app?.core.busy,
        coreStates:globalThis.app?.core.states.map(state=>({id:state.id,implemented:state.implemented,enabled:app.core.isEnabled(state.id)})),
        coreControls:Array.from(document.querySelectorAll("[data-core-toggle]")).map(button=>({id:button.dataset.coreToggle,disabled:button.disabled})),
        enabledPlugins:globalThis.app?Object.keys(app.plugins.plugins):[],
        cards:Array.from(document.querySelectorAll(".plugin-card")).map(card=>({id:card.dataset.pluginId,loaded:card.dataset.loaded,error:card.querySelector(".plugin-error")?.textContent})),
        clientError:document.querySelector("#client-errors")?.textContent,
        hostError:document.querySelector(".error-banner")?.textContent,
        dialogs:Array.from(document.querySelectorAll("dialog[open]")).map(dialog=>dialog.id),
        pluginModals:Array.from(document.querySelectorAll(".modal-container")).map(modal=>({classes:modal.className,text:modal.textContent.slice(0,1500),inputs:Array.from(modal.querySelectorAll("input")).map(input=>({placeholder:input.placeholder,value:input.value}))})),
        notices:Array.from(document.querySelectorAll(".notice")).map(notice=>notice.textContent),
        buffers:globalThis.app?app.workspace.leaves().map(leaf=>({id:leaf.id,type:leaf.view.getViewType(),path:leaf.session?.document.file.path,text:leaf.view.editor?.getValue().slice(0,300),sessionText:leaf.session?.text.slice(0,300),dirty:leaf.session?.dirty,selection:leaf.view.editor?.cm.state.selection.main.head,length:leaf.view.editor?.cm.state.doc.length})):[],
        workspace:globalThis.app?app.workspace.getLayout():null
      })`);
      report.browserErrors = browserErrors;
      const failure = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, `${reportName}-failure.png`), Buffer.from(failure.data, "base64"));
    } catch (diagnosticError) {
      report.diagnosticError = diagnosticError.stack ?? String(diagnosticError);
      console.error("Could not capture the desktop failure:", diagnosticError);
    }
  }
  console.error(log.slice(-12000));
  throw error;
} finally {
  const stopped = await stopDesktop();
  report.browserErrors = [...browserErrors];
  report.consoleErrors = [...consoleErrors];
  if (browserErrors.length) {
    report.status = "failed";
    report.error ??= "The desktop emitted an uncaught renderer exception, including its final teardown; see browserErrors.";
  }
  if (additionalPluginsOnly && report.additionalPlugins) {
    const result = report.additionalPlugins;
    result.consoleErrors = [...consoleErrors];
    result.expectedShutdownErrors = [...expectedShutdownErrors];
    result.unexpectedConsoleErrors = consoleErrors.filter(error => !result.knownLimitations?.includes(error) && !expectedShutdownErrors.has(error));
    result.uncaughtRuntimeErrors = [...browserErrors];
    if (result.unexpectedConsoleErrors.length) {
      report.status = "failed";
      report.error ??= "Unexpected asynchronous plugin errors occurred, including final teardown; see additionalPlugins.unexpectedConsoleErrors.";
    }
  }
  const code = stopped.exitCode;
  const signal = stopped.exitSignal;
  report.exitCode = code;
  report.exitSignal = signal;
  report.dotnetPid = stopped.dotnetPid;
  report.electronPid = stopped.electronPid;
  report.completedAt = new Date().toISOString();
  errorAudit.finish(report, log);
  if (code !== 0 || signal || log.includes("smoke deadline expired")) {
    report.status = "failed";
  }
  await writeFile(join(evidence, `${reportName}.log`), log);
  await writeFile(join(evidence, `${reportName}.json`), JSON.stringify(report, null, 2) + "\n");
  assert.equal(signal, null);
  assert.equal(code, 0, log);
  assert.equal(report.status, "passed", report.error ?? `See ${join(evidence, reportName + ".json")} for desktop diagnostics.`);
}
console.log(communityInstallOnly ? "The real desktop Community UI passed deterministic catalog/install/update/uninstall workflows; public downloads and full plugin parity remain separate evidence scopes." : additionalPluginsOnly ? "The ten exact supplied releases passed desktop startup/settings and selected workflows; the recorded Git backend limitation is not full plugin parity." : communitySettingsOnly ? "Community settings restored and persisted actual vault enablement across reload and vault changes; this is not remote-installation or full plugin parity." : reportedPluginsOnly ? "The six unchanged reported releases passed startup/settings/cleanup; this is not full plugin parity." : excalidrawOnly ? "Unchanged pinned Excalidraw scoped workflows passed; inspect the report for bounded execution coverage." : templaterOnly ? "Unchanged pinned Templater workflows passed; this bounded result is separate from core acceptance and full plugin compatibility." : community
  ? "Legacy community-plugin/workspace scenarios passed."
  : `${throughChooser ? "Vault chooser" : "Explicit-vault startup"} and ${report.coreChecks.length} core acceptance cases passed, including full desktop restarts. Independent host probes are not third-party community-plugin acceptance.`);
