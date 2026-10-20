import { presentationStructureLayoutDependencies } from "./presentation-structure-layout-dependencies.mjs";
import { groupsCrossPropertiesArrangeDependencies } from "./groups-cross-properties-arrange-dependencies.mjs";
import { summariesTransfersBackgroundsDependencies } from "./summaries-transfers-backgrounds-dependencies.mjs";
import { formulasFlowTablesDependencies } from "./formulas-flow-tables-dependencies.mjs";
import { filtersPositionFormattingDependencies } from "./filters-position-formatting-dependencies.mjs";
import { configMultilineExportDependencies } from "./config-multiline-export-dependencies.mjs";
import { viewsScaleLinksDependencies } from "./views-scale-links-dependencies.mjs";
import { navigationCreationDependencies } from "./navigation-creation-dependencies.mjs";
import { editableDataDependencies } from "./editable-data-dependencies.mjs";
import { expectErrors } from "./error-log-audit.mjs";
import { createErrorLogAudit } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startWebServer } from "./serve-web.mjs";

import { coreVerificationTargets } from "./core-verification-targets.mjs";
import { appearanceVerificationPaths } from "./appearance-scenarios.mjs";
import { appearanceResourceVerificationPaths } from "./appearance-resource-scenarios.mjs";
import { appearanceThemeVerificationPaths } from "./appearance-theme-scenarios.mjs";
const { assertCleanExit, acknowledgedQuit, fixtureDrainScript, request: quitRequest, ack: quitAck } = createRequire(import.meta.url)("./web-smoke-quit.cjs");
const coreVerificationOnly = process.argv.includes("--verify-core");
const coreStatusOnly = process.argv.includes("--core-status");
const diagnosticsOnly = process.argv.includes("--diagnostics");
const dockingOnly = process.argv.includes("--docking");
const historyOnly = process.argv.includes("--history");
const groupsPopoutsOnly = process.argv.includes("--groups-popouts");
if (groupsPopoutsOnly && ["forced-close", "os-drag"].includes(process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY)) { throw new Error("Native close/OS-drag focuses require tools\\smoke.mjs, not the WASM runner."); }
if (groupsPopoutsOnly && ![undefined, "", "barrier"].includes(process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY)) { throw new Error("Unknown WASM groups/popouts focus."); }
const popupBlockedControlOnly = groupsPopoutsOnly && process.env.SLOPSIDIAN_WEB_POPUP === "blocked";
const tabMovementOnly = process.argv.includes("--tabs") || dockingOnly || historyOnly || groupsPopoutsOnly;
const paneResizeOnly = process.argv.includes("--pane-resize");
const discoveryPanesOnly = process.argv.includes("--discovery-panes");
const bookmarksOnly = process.argv.includes("--bookmarks");
const backlinkPanesOnly = process.argv.includes("--backlink-panes");
const githubIndexUiOnly = process.argv.includes("--github-index-ui");
const nativeRecentsOnly = process.argv.includes("--native-recents");
const originalFloatingOnly = process.argv.includes("--original-floating-import");
const outlinePanesOnly = process.argv.includes("--outline-panes");
const searchPanesOnly = process.argv.includes("--search-panes");
const fileExplorerOnly = process.argv.includes("--file-explorer");
const folderOperationsOnly = process.argv.includes("--folder-operations");
const systemTrashOnly = process.argv.includes("--system-trash");
const workspaceStartupOnly = process.argv.includes("--workspace-startup");
const root = fileURLToPath(new URL("../", import.meta.url));
const graphsOnly = process.argv.includes("--graphs");
const canvasesOnly = process.argv.includes("--canvases");
const previewsOnly = process.argv.includes("--previews");
const editingToolsOnly = process.argv.includes("--editing-tools");
const formatsOnly = process.argv.includes("--formats");
const composerOnly = process.argv.includes("--composer");
const menusOnly = process.argv.includes("--menus");
const hotkeysSecretsOnly = process.argv.includes("--hotkeys-secrets");
const viewersOnly = process.argv.includes("--viewers");
const configurationLifecycleOnly = process.argv.includes("--configuration-lifecycle");
const viewerProofsOnly = process.argv.includes("--viewer-proofs");
const suggestionsOnly = process.argv.includes("--suggestions");
const modalFocusOnly = process.argv.includes("--modal-focus");
const attachmentsOnly = process.argv.includes("--attachments");
const autosaveOnly = process.argv.includes("--autosave");
const persistentDraftsDiagnosticOnly = process.argv.includes("--persistent-drafts-text-diagnostic");
const persistentDraftsOnly = process.argv.includes("--persistent-drafts") || persistentDraftsDiagnosticOnly;
const modalLayoutOnly = process.argv.includes("--modal-layout");
const renderersOnly = process.argv.includes("--renderers");
const tagsOnly = process.argv.includes("--tags");
const communitySettingsOnly = process.argv.includes("--community-settings");
const communityInstallOnly = process.argv.includes("--community-install");
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
const editorImprovementsOnly = process.argv.includes("--editor-improvements");
const presentationStructureLayoutOnly = process.argv.includes("--presentation-structure-layout");
const groupsCrossPropertiesArrangeOnly = process.argv.includes("--groups-cross-properties-arrange");
const summariesTransfersBackgroundsOnly = process.argv.includes("--summaries-transfers-backgrounds");
const formulasFlowTablesOnly = process.argv.includes("--formulas-flow-tables");
const filtersPositionFormattingOnly = process.argv.includes("--filters-position-formatting");
const configMultilineExportOnly = process.argv.includes("--config-multiline-export");
const viewsScaleLinksOnly = process.argv.includes("--views-scale-links");
const navigationCreationOnly = process.argv.includes("--navigation-creation");
const editableDataOnly = process.argv.includes("--editable-data");
const visualAuthoringOnly = process.argv.includes("--visual-authoring");
const exportHandoffHistoryOnly = process.argv.includes("--export-handoff-history");
const inlineStructureAudioOnly = process.argv.includes("--inline-structure-audio");
const embedsTypedBulkOnly = process.argv.includes("--embeds-typed-bulk");
const cardsAudioBulkOnly = process.argv.includes("--cards-audio-bulk");
const viewsInputsOnly = process.argv.includes("--views-inputs");
const authoringControlsOnly = process.argv.includes("--authoring-controls");
const richEditingOnly = process.argv.includes("--rich-editing");
const structuredRecoveryOnly = process.argv.includes("--structured-recovery");
const workflowControlsOnly = process.argv.includes("--workflow-controls");
const propertiesReadingOnly = process.argv.includes("--properties-reading");
const authoringTransfersOnly = process.argv.includes("--authoring-transfers");
const noteManagementOnly = process.argv.includes("--note-management");
const authoringOrganizationOnly = process.argv.includes("--authoring-organization");
const linkAuthoringOnly = process.argv.includes("--link-authoring");
const noteContinuityOnly = process.argv.includes("--note-continuity");
const markdownPolishOnly = process.argv.includes("--markdown-polish");
const markdownInteractionOnly = process.argv.includes("--markdown-interaction");
const editorAssistanceOnly = process.argv.includes("--editor-assistance");
const noteNavigationOnly = process.argv.includes("--note-navigation");
const readingToolsOnly = process.argv.includes("--reading-tools");
const noteWorkflowsOnly = process.argv.includes("--note-workflows");
const editorWorkflowsOnly = process.argv.includes("--editor-workflows");
const readingDiscoveryOnly = process.argv.includes("--reading-discovery");
const editorProductivityOnly = process.argv.includes("--editor-productivity");
const noteAuthoringOnly = process.argv.includes("--note-authoring");
const mermaidOnly = process.argv.includes("--mermaid");
const mathEmbedsOnly = process.argv.includes("--math-embeds");
const workspacesOnly = process.argv.includes("--workspaces");
const workspaceTransitionOnly = process.argv.includes("--workspace-transition");
const outgoingPanesOnly = process.argv.includes("--outgoing-panes");
const outgoingOnly = process.argv.includes("--outgoing") || outgoingPanesOnly;
const propertiesOnly = process.argv.includes("--properties");
const appearanceResourcesOnly = process.argv.includes("--appearance-resources");
const appearanceWatchOnly = process.argv.includes("--appearance-watch-diagnostic");
const appearanceCatalogOnly = process.argv.includes("--appearance-catalog-diagnostic");
const appearanceThemesOnly = process.argv.includes("--appearance-themes") || appearanceWatchOnly || appearanceCatalogOnly;
const appearanceOnly = process.argv.includes("--appearance") || appearanceResourcesOnly || appearanceThemesOnly;
const viewsOnly = process.argv.includes("--views");
const focused = presentationStructureLayoutOnly || groupsCrossPropertiesArrangeOnly || summariesTransfersBackgroundsOnly || formulasFlowTablesOnly || filtersPositionFormattingOnly || configMultilineExportOnly || viewsScaleLinksOnly || navigationCreationOnly || originalFloatingOnly || nativeRecentsOnly || githubIndexUiOnly || appearanceOnly || propertiesOnly || backlinkPanesOnly || discoveryPanesOnly || bookmarksOnly || outlinePanesOnly || searchPanesOnly || fileExplorerOnly || folderOperationsOnly || workspaceStartupOnly || communityInstallOnly || paneResizeOnly || diagnosticsOnly || tabMovementOnly || coreStatusOnly || attachmentsOnly || autosaveOnly || graphsOnly || canvasesOnly || previewsOnly || editingToolsOnly || formatsOnly || composerOnly || menusOnly || suggestionsOnly || modalFocusOnly || modalLayoutOnly || renderersOnly || tagsOnly || communitySettingsOnly || templaterOnly || excalidrawOnly || reportedPluginsOnly || additionalPluginsOnly || basesOnly || recoveryOnly || discoveryOnly || audioOnly || editorChromeOnly || editorImprovementsOnly || editableDataOnly || visualAuthoringOnly || exportHandoffHistoryOnly || inlineStructureAudioOnly || embedsTypedBulkOnly || cardsAudioBulkOnly || viewsInputsOnly || authoringControlsOnly || richEditingOnly || structuredRecoveryOnly || workflowControlsOnly || propertiesReadingOnly || authoringTransfersOnly || noteManagementOnly || authoringOrganizationOnly || linkAuthoringOnly || noteContinuityOnly || markdownPolishOnly || markdownInteractionOnly || editorAssistanceOnly || noteNavigationOnly || readingToolsOnly || noteWorkflowsOnly || editorWorkflowsOnly || readingDiscoveryOnly || editorProductivityOnly || noteAuthoringOnly || mermaidOnly || workspacesOnly || outgoingOnly || viewsOnly || workspaceTransitionOnly || mathEmbedsOnly || hotkeysSecretsOnly || persistentDraftsOnly || viewersOnly || configurationLifecycleOnly || viewerProofsOnly || systemTrashOnly;
const syntheticAudio = inlineStructureAudioOnly || cardsAudioBulkOnly || viewsInputsOnly || authoringControlsOnly || audioOnly || !focused;
if ([presentationStructureLayoutOnly, groupsCrossPropertiesArrangeOnly, summariesTransfersBackgroundsOnly, formulasFlowTablesOnly, filtersPositionFormattingOnly, configMultilineExportOnly, viewsScaleLinksOnly, navigationCreationOnly, originalFloatingOnly, nativeRecentsOnly, appearanceOnly, propertiesOnly, backlinkPanesOnly, discoveryPanesOnly, bookmarksOnly, outlinePanesOnly, searchPanesOnly, fileExplorerOnly, folderOperationsOnly, workspaceStartupOnly, communityInstallOnly, paneResizeOnly, diagnosticsOnly, coreVerificationOnly, coreStatusOnly, tabMovementOnly, attachmentsOnly, autosaveOnly, graphsOnly, canvasesOnly, previewsOnly, editingToolsOnly, formatsOnly, composerOnly, menusOnly, suggestionsOnly, modalFocusOnly, modalLayoutOnly, renderersOnly, tagsOnly, communitySettingsOnly, templaterOnly, excalidrawOnly, reportedPluginsOnly, additionalPluginsOnly, basesOnly, recoveryOnly, discoveryOnly, audioOnly, editorChromeOnly, editorImprovementsOnly, editableDataOnly, visualAuthoringOnly, exportHandoffHistoryOnly, inlineStructureAudioOnly, embedsTypedBulkOnly, cardsAudioBulkOnly, viewsInputsOnly, authoringControlsOnly, richEditingOnly, structuredRecoveryOnly, workflowControlsOnly, propertiesReadingOnly, authoringTransfersOnly, noteManagementOnly, authoringOrganizationOnly, linkAuthoringOnly, noteContinuityOnly, markdownPolishOnly, markdownInteractionOnly, editorAssistanceOnly, noteNavigationOnly, readingToolsOnly, noteWorkflowsOnly, editorWorkflowsOnly, readingDiscoveryOnly, editorProductivityOnly, noteAuthoringOnly, mermaidOnly, workspacesOnly, outgoingOnly, viewsOnly, workspaceTransitionOnly, mathEmbedsOnly, hotkeysSecretsOnly, persistentDraftsOnly, viewersOnly, configurationLifecycleOnly, viewerProofsOnly, systemTrashOnly, githubIndexUiOnly].filter(Boolean).length > 1) { throw new Error("Choose one focused WASM suite."); }
const reportName = presentationStructureLayoutOnly ? "presentation-structure-layout-web-smoke" : groupsCrossPropertiesArrangeOnly ? "groups-cross-properties-arrange-web-smoke" : summariesTransfersBackgroundsOnly ? "summaries-transfers-backgrounds-web-smoke" : formulasFlowTablesOnly ? "formulas-flow-tables-web-smoke" : filtersPositionFormattingOnly ? "filters-position-formatting-web-smoke" : configMultilineExportOnly ? "config-multiline-export-web-smoke" : viewsScaleLinksOnly ? "views-scale-links-web-smoke" : navigationCreationOnly ? "navigation-creation-web-smoke" : editableDataOnly ? "editable-data-web-smoke" : graphsOnly ? "graphs-web-smoke" : visualAuthoringOnly ? "visual-authoring-web-smoke" : exportHandoffHistoryOnly ? "export-handoff-history-web-smoke" : inlineStructureAudioOnly ? "inline-structure-audio-web-smoke" : embedsTypedBulkOnly ? "embeds-typed-bulk-web-smoke" : cardsAudioBulkOnly ? "cards-audio-bulk-web-smoke" : viewsInputsOnly ? "views-inputs-web-smoke" : authoringControlsOnly ? "authoring-controls-web-smoke" : richEditingOnly ? "rich-editing-web-smoke" : structuredRecoveryOnly ? "structured-recovery-web-smoke" : workflowControlsOnly ? "workflow-controls-web-smoke" : propertiesReadingOnly ? "properties-reading-web-smoke" : authoringTransfersOnly ? "authoring-transfers-web-smoke" : noteManagementOnly ? "note-management-web-smoke" : authoringOrganizationOnly ? "authoring-organization-web-smoke" : linkAuthoringOnly ? "link-authoring-web-smoke" : noteContinuityOnly ? "note-continuity-web-smoke" : markdownPolishOnly ? "markdown-polish-web-smoke" : markdownInteractionOnly ? "markdown-interaction-web-smoke" : editorAssistanceOnly ? "editor-assistance-web-smoke" : noteNavigationOnly ? "note-navigation-web-smoke" : readingToolsOnly ? "reading-tools-web-smoke" : noteWorkflowsOnly ? "note-workflows-web-smoke" : editorWorkflowsOnly ? "editor-workflows-web-smoke" : readingDiscoveryOnly ? "reading-discovery-web-smoke" : editorProductivityOnly ? "editor-productivity-web-smoke" : noteAuthoringOnly ? "note-authoring-web-smoke" : editorImprovementsOnly ? "editor-improvements-web-smoke" : originalFloatingOnly ? "original-floating-import-web-smoke" : nativeRecentsOnly ? "native-recents-web-smoke" : appearanceCatalogOnly ? "appearance-catalog-diagnostic-web-smoke" : appearanceWatchOnly ? "appearance-watch-diagnostic-web-smoke" : githubIndexUiOnly ? "github-index-ui-web-smoke" : systemTrashOnly ? "system-trash-web-smoke" : appearanceThemesOnly ? "appearance-themes-web-smoke" : appearanceResourcesOnly ? "appearance-resources-web-smoke" : appearanceOnly ? "appearance-web-smoke" : propertiesOnly ? "properties-web-smoke" : outgoingPanesOnly ? "outgoing-panes-web-smoke" : backlinkPanesOnly ? "backlink-panes-web-smoke" : discoveryPanesOnly ? "discovery-panes-web-smoke" : bookmarksOnly ? "bookmarks-workflows-web-smoke" : outlinePanesOnly ? "outline-panes-web-smoke" : searchPanesOnly ? "search-panes-web-smoke" : fileExplorerOnly ? "file-explorer-web-smoke" : folderOperationsOnly ? "folder-operations-web-smoke" : workspaceStartupOnly ? "workspace-startup-web-smoke" : communityInstallOnly ? "community-install-web-smoke" : paneResizeOnly ? "pane-resize-web-smoke" : diagnosticsOnly ? "diagnostics-web-smoke" : groupsPopoutsOnly ? (process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY === "barrier" ? "groups-popouts-barrier-diagnostic-web-smoke" : popupBlockedControlOnly ? "groups-popouts-refusal-control-web-smoke" : "groups-popouts-web-smoke") : historyOnly ? "history-web-smoke" : dockingOnly ? "docking-web-smoke" : tabMovementOnly ? "tabs-web-smoke" : coreVerificationOnly ? "core-verification-web-smoke" : coreStatusOnly ? "core-status-web-smoke" : attachmentsOnly ? "attachments-web-smoke" : autosaveOnly ? "autosave-web-smoke" : modalLayoutOnly ? "modal-layout-web-smoke" : modalFocusOnly ? "modal-focus-web-smoke" : additionalPluginsOnly ? "additional-plugins-web-smoke" : communitySettingsOnly ? "community-settings-web-smoke" : tagsOnly ? "tags-web-smoke" : workspaceTransitionOnly ? "workspace-transition-web-smoke" : reportedPluginsOnly ? "reported-plugins-web-smoke" : excalidrawOnly ? "excalidraw-web-smoke" : templaterOnly ? "templater-web-smoke" : renderersOnly ? "renderers-web-smoke" : suggestionsOnly ? "suggestions-web-smoke" : viewsOnly ? "views-web-smoke" : baseSummariesOnly ? "bases-summaries-web-smoke" : outgoingOnly ? "outgoing-web-smoke" : workspacesOnly ? "workspaces-web-smoke" : mermaidOnly ? "mermaid-web-smoke" : audioOnly ? "audio-web-smoke" : canvasesOnly ? "canvases-web-smoke" : previewsOnly ? "previews-web-smoke" : editingToolsOnly ? "editing-tools-web-smoke" : formatsOnly ? "formats-web-smoke" : composerOnly ? "composer-web-smoke" : menusOnly ? "menus-web-smoke" : basesOnly ? "bases-web-smoke" : recoveryOnly ? "recovery-web-smoke" : discoveryOnly ? "discovery-web-smoke" : editorChromeOnly ? "editor-chrome-web-smoke" : mathEmbedsOnly ? "math-embeds-web-smoke" : hotkeysSecretsOnly ? "hotkeys-secrets-web-smoke" : persistentDraftsDiagnosticOnly ? "persistent-drafts-text-diagnostic-web-smoke" : persistentDraftsOnly ? "persistent-drafts-web-smoke" : viewersOnly ? "viewers-web-smoke" : configurationLifecycleOnly ? "configuration-lifecycle-web-smoke" : viewerProofsOnly ? "viewer-proofs-web-smoke" : "web-smoke";
await mkdir(join(root, ".runtime", "evidence"), { recursive: true });
const fixture = await mkdtemp(join(root, ".runtime", "web-smoke-"));
const vault = join(fixture, "Vault A");
const otherVault = join(fixture, "Vault B");
const parent = join(fixture, "New vaults");
const profile = join(fixture, "profile");
for (const directory of [vault, otherVault, parent, profile]) {
  await mkdir(directory);
}
await mkdir(join(vault, ".obsidian", "plugins"), { recursive: true });
if (!autosaveOnly && !attachmentsOnly) { await writeFile(join(vault, ".obsidian", "app.json"), '{"markdownAutosave":false}\n'); }
const originalWorkspace = "{\"main\":{\"id\":\"browser-original-main\",\"type\":\"split\",\"direction\":\"vertical\",\"children\":[{\"id\":\"browser-original-tabs\",\"type\":\"tabs\",\"children\":[{\"id\":\"browser-original-empty\",\"type\":\"leaf\",\"state\":{\"type\":\"empty\",\"state\":{}}}]}]},\"active\":\"browser-original-empty\",\"original\":\"leave untouched\"}\n";
await writeFile(join(vault, ".obsidian", "workspace.json"), originalWorkspace);
await writeFile(join(vault, ".obsidian", "community-plugins.json"), '["sample-plugin"]\n');
await writeFile(join(vault, "Welcome.md"), "# Welcome\n\nA vault on the real filesystem.\n");
const crlf = "# CRLF note\r\n\r\nKeep the original bytes.\r\n";
await writeFile(join(vault, "CRLF.md"), Buffer.from([239, 187, 191, ...Buffer.from(crlf)]));
await writeFile(join(vault, "Attachment.bin"), Buffer.from([255, 0, 128, 9]));
await writeFile(join(otherVault, "Other.md"), "# A separate vault\n");
await cp(join(root, ".runtime", "DemoVault", ".obsidian", "plugins", "sample-plugin"), join(vault, ".obsidian", "plugins", "sample-plugin"), { recursive: true });
for (const [id, desktop] of [["desktop-only", true], ["node-only", false]]) {
  const destination = join(vault, ".obsidian", "plugins", id);
  await mkdir(destination);
  await writeFile(join(destination, "manifest.json"), JSON.stringify({ id, name: id, version: "1.0.0", description: "WASM boundary fixture", isDesktopOnly: desktop }));
  await writeFile(join(destination, "main.js"), 'require("node:fs"); throw new Error("Must not execute past the unavailable module");');
}

let host;
let child;
let exited;
let socket;
let currentDialog = null;
let mainFrameLoaderId = null;
let log = "";
let stdoutLog = "";
const quitNonce = crypto.randomUUID();
let acknowledgeQuit;
const quitAcknowledged = new Promise(resolve => { acknowledgeQuit = resolve; });
let endpoint;
let nextId = 0;
const pending = new Map();
const requests = [];
const missingAssets = [];
const exceptions = [];
const consoleErrors = [];
const recentCommands = [];
const report = { status: "failed", scope: graphsOnly ? "graphs-runtime" : canvasesOnly ? "canvas-runtime" : previewsOnly ? "page-preview-runtime" : editingToolsOnly ? "editing-tools-runtime" : formatsOnly ? "format-conversion-runtime" : composerOnly ? "note-composition-runtime" : menusOnly ? "menu-api-runtime" : discoveryOnly ? "discovery-runtime" : editorChromeOnly ? "editor-chrome-runtime" : "full-shared-runtime", startedAt: new Date().toISOString(), checks: [], rendererNodeIntegration: false, realExternalDirectoryPicker: true, pickerStartsInDisposableDocuments: true };
if (audioOnly) { Object.assign(report, { scope: "audio-recorder-runtime", syntheticAudioOnly: true, physicalMicrophoneTested: false }); }
if (suggestionsOnly) { report.scope = "plugin-suggestions-runtime"; }
if (editorImprovementsOnly) { report.scope = "editor-improvements-runtime"; }
if (presentationStructureLayoutOnly) { report.scope = "presentation-structure-layout-runtime"; }
if (groupsCrossPropertiesArrangeOnly) { report.scope = "groups-cross-properties-arrange-runtime"; }
if (summariesTransfersBackgroundsOnly) { report.scope = "summaries-transfers-backgrounds-runtime"; }
if (formulasFlowTablesOnly) { report.scope = "formulas-flow-tables-runtime"; }
if (filtersPositionFormattingOnly) { report.scope = "filters-position-formatting-runtime"; }
if (configMultilineExportOnly) { report.scope = "config-multiline-export-runtime"; }
if (viewsScaleLinksOnly) { report.scope = "views-scale-links-runtime"; }
if (navigationCreationOnly) { report.scope = "navigation-creation-runtime"; }
if (editableDataOnly) { report.scope = "editable-data-runtime"; }
if (visualAuthoringOnly) { report.scope = "visual-authoring-runtime"; }
if (exportHandoffHistoryOnly) { report.scope = "export-handoff-history-runtime"; }
if (inlineStructureAudioOnly) { report.scope = "inline-structure-audio-runtime"; }
if (embedsTypedBulkOnly) { report.scope = "embeds-typed-bulk-runtime"; }
if (cardsAudioBulkOnly) { report.scope = "cards-audio-bulk-runtime"; }
if (viewsInputsOnly) { report.scope = "views-and-inputs-runtime"; }
if (authoringControlsOnly) { report.scope = "authoring-controls-runtime"; }
if (richEditingOnly) { report.scope = "rich-editing-runtime"; }
if (structuredRecoveryOnly) { report.scope = "structured-recovery-runtime"; }
if (workflowControlsOnly) { report.scope = "workflow-controls-runtime"; }
if (propertiesReadingOnly) { report.scope = "properties-reading-runtime"; }
if (authoringTransfersOnly) { report.scope = "authoring-transfers-runtime"; }
if (noteManagementOnly) { report.scope = "note-management-runtime"; }
if (authoringOrganizationOnly) { report.scope = "authoring-organization-runtime"; }
if (linkAuthoringOnly) { report.scope = "link-authoring-runtime"; }
if (noteContinuityOnly) { report.scope = "note-continuity-runtime"; }
if (markdownPolishOnly) { report.scope = "markdown-polish-runtime"; }
if (markdownInteractionOnly) { report.scope = "markdown-interaction-runtime"; }
if (editorAssistanceOnly) { report.scope = "editor-assistance-runtime"; }
if (noteNavigationOnly) { report.scope = "note-navigation-runtime"; }
if (readingToolsOnly) { report.scope = "reading-tools-runtime"; }
if (noteWorkflowsOnly) { report.scope = "note-workflows-runtime"; }
if (editorWorkflowsOnly) { report.scope = "editor-workflows-runtime"; }
if (readingDiscoveryOnly) { report.scope = "reading-discovery-runtime"; }
if (editorProductivityOnly) { report.scope = "editor-productivity-runtime"; }
if (noteAuthoringOnly) { report.scope = "note-authoring-runtime"; }
if (modalFocusOnly) { report.scope = "shared-modal-keyboard-accessibility"; }
if (modalLayoutOnly) { report.scope = "shared-modal-viewport-layout"; }
if (renderersOnly) { report.scope = "markdown-postprocessors-runtime"; }
if (coreVerificationOnly) { report.scope = "core-verification-targets"; report.verificationTargets = coreVerificationTargets; }
if (coreStatusOnly) { report.scope = "core-verification-status-ui"; }
if (diagnosticsOnly) { report.scope = "persistent-error-logging"; }
if (tabMovementOnly) { report.scope = groupsPopoutsOnly ? (process.env.SLOPSIDIAN_GROUPS_POPOUTS_ONLY === "barrier" ? "workspace-groups-popouts-barrier-diagnostic" : popupBlockedControlOnly ? "workspace-groups-popouts-refusal-control" : "workspace-groups-popouts") : historyOnly ? "workspace-history" : dockingOnly ? "workspace-docking" : "workspace-tab-movement"; }
if (bookmarksOnly) { report.scope = "bookmarks-workflows"; }
if (discoveryPanesOnly) { report.scope = "discovery-workspace-panes"; }
if (backlinkPanesOnly) { report.scope = "backlink-workspace-panes"; }
if (githubIndexUiOnly) { report.scope = "github-cached-index-dialog"; }
if (nativeRecentsOnly) { report.scope = "native-recent-vaults-browser-boundary"; }
if (originalFloatingOnly) { report.scope = "original-floating-workspace-import"; }
if (propertiesOnly) { report.scope = "properties-workspace-and-file-preferences"; }
if (appearanceOnly) { report.scope = appearanceCatalogOnly ? "diagnostic-appearance-catalog" : appearanceWatchOnly ? "diagnostic-appearance-watcher" : appearanceThemesOnly ? "reviewed-theme-management" : appearanceResourcesOnly ? "local-appearance-resources" : "shared-appearance-workflows"; }
if (outlinePanesOnly) { report.scope = "outline-workspace-panes"; }
if (searchPanesOnly) { report.scope = "search-workspace-panes"; }
if (fileExplorerOnly) { report.scope = "file-explorer-workspace-panes"; }
if (folderOperationsOnly) { report.scope = "folder-operations-explorer-dialogs"; }
if (systemTrashOnly) { report.scope = "standalone-system-trash-refusal"; }
if (workspaceStartupOnly) { report.scope = "workspace-startup-import"; }
if (paneResizeOnly) { report.scope = "workspace-pane-resizing"; }
if (tagsOnly) { report.scope = "native-shaped-tag-rendering"; }
if (communitySettingsOnly) { report.scope = "community-settings-runtime"; }
if (communityInstallOnly) { report.scope = "community-catalog-install-update-uninstall"; }
if (templaterOnly) { report.scope = "actual-templater-runtime"; }
if (excalidrawOnly) { Object.assign(report, { scope: "actual-excalidraw-runtime", communityPluginsTested: true }); }
if (reportedPluginsOnly) { report.scope = "reported-community-plugin-startup"; }
if (additionalPluginsOnly) { report.scope = "additional-example-plugin-startup"; }
if (mermaidOnly) { report.scope = "mermaid-runtime"; }
if (viewersOnly) { report.scope = "attachment-viewers"; }
if (viewerProofsOnly) { report.scope = "attachment-viewer-proofs"; }
if (mathEmbedsOnly) { report.scope = "math-embeds-runtime"; }
if (configurationLifecycleOnly) { report.scope = "configuration-lifecycle-runtime"; }
if (workspacesOnly) { report.scope = "workspace-import-runtime"; }
if (baseSummariesOnly) { report.scope = "bases-summaries-runtime"; }
if (outgoingOnly) { report.scope = outgoingPanesOnly ? "outgoing-workspace-panes" : "outgoing-runtime"; }
if (viewsOnly) { report.scope = "view-host-runtime"; }
if (syntheticAudio) { Object.assign(report, { syntheticAudioOnly: true, physicalMicrophoneTested: false }); }
function command(method, params = {}) {
  if (method === "Page.reload" && propertiesOnly) { return reloadPropertiesDocument(params); }
  return sendCommand(method, params);
}
function sendCommand(method, params = {}) {
  recentCommands.push({ method, type: params.type, key: params.key, expression: params.expression?.slice(0, 500) });
  if (recentCommands.length > 20) { recentCommands.shift(); }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timed out: " + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function reloadPropertiesDocument(params) {
  await wait('!document.querySelector("[data-file-settings]")', "Properties settings finish closing before reload");
  if (!await evaluate("Boolean(globalThis.app?.vault.readOnly)")) { return sendCommand("Page.reload", params); }
  await evaluate("app.workspace.flushLayout()");
  const state = await evaluate("({root:app.vault.rootPath,unsaved:app.workspace.hasUnsavedChanges,attachmentsBusy:app.attachments.busy,changingVault:app.changingVault,layoutReady:app.workspace.layoutReady,url:location.href})");
  report.propertiesReadOnlyReloadState = state;
  assert.equal(state.unsaved, false, "Readonly Properties reload must retain a clean workspace");
  assert.equal(state.attachmentsBusy, false, "Readonly Properties reload must have no active attachment import");
  assert.equal(state.changingVault, false); assert.equal(state.layoutReady, true);
  const tree = await sendCommand("Page.getFrameTree"), previous = tree.frameTree.frame.loaderId;
  assert.ok(previous); mainFrameLoaderId = previous; state.previousLoaderId = previous;
  const result = await sendCommand("Page.reload", params);
  await waitFor(() => {
    assert.equal(currentDialog, null, "A clean readonly reload must not require accepting a browser dialog");
    return Boolean(mainFrameLoaderId) && mainFrameLoaderId !== previous;
  }, "a fresh Properties document loader before evaluating its new JavaScript realm");
  state.nextLoaderId = mainFrameLoaderId;
  return result;
}
async function evaluate(expression) {
  let result;
  try { result = await command("Runtime.evaluate", { expression: `(()=>{
    const result=(0,eval)(${JSON.stringify(expression)});
    if(result&&typeof result.then==="function"){
      const retained=globalThis.slopsidianSmokePromises??=new Set();
      retained.add(result);
      result.then(()=>retained.delete(result),()=>retained.delete(result));
    }
    return result;
  })()`, awaitPromise: true, returnByValue: true }); }
  catch (error) {
    if (error.message === "CDP timed out: Runtime.evaluate") {
      (report.evaluationTimeouts ??= []).push({ at: new Date().toISOString(), expression: expression.slice(0, 4096) });
    }
    throw error;
  }
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
  return result.result.value;
}
async function waitFor(predicate, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end && (!child || child.exitCode === null)) {
    if (await predicate()) {
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for " + label);
}
async function wait(expression, label = expression) {
  await waitFor(() => evaluate(`(async()=>Boolean(await (${expression})))()`), label);
}
async function handleDialog(accept, type = "confirm") {
  await waitFor(() => currentDialog !== null, "actual Canvas discard confirmation");
  assert.equal(currentDialog.type, type, "The action must present its expected native confirmation.");
  await command("Page.handleJavaScriptDialog", { accept });
}
async function click(selector, modifiers = 0) {
  report.lastInteraction = { type: "click", selector };
  const clickScrollBlock = (editableDataOnly || navigationCreationOnly || viewsScaleLinksOnly || configMultilineExportOnly || filtersPositionFormattingOnly || formulasFlowTablesOnly || summariesTransfersBackgroundsOnly || groupsCrossPropertiesArrangeOnly || presentationStructureLayoutOnly) ? "nearest" : "center";
  await command("Page.bringToFront");
  await wait(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return el&&!el.disabled&&el.checkVisibility()&&el.getBoundingClientRect().height>0})()`, selector);
  await wait(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.scrollIntoView({block:${JSON.stringify(clickScrollBlock)},inline:"nearest"});const r=Array.from(el.getClientRects()).find(rect=>rect.width>0&&rect.height>0);if(!r)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !hit?.closest(".notice")||el.contains(hit)})()`, "a transient notice stops covering " + selector);
  const point = await evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({block:${JSON.stringify(clickScrollBlock)},inline:"nearest"});
    const b=Array.from(el.getClientRects()).find(rect=>rect.width>0&&rect.height>0);
    if(!b){throw new Error("The click target has no visible client rect.");}
    const x=b.left+b.width/2,y=b.top+b.height/2;
    const hit=document.elementFromPoint(x,y);
    return{x,y,reachable:hit===el||el.contains(hit),hit:hit?.outerHTML.slice(0,300)};
  })()`);
  assert.ok(point.reachable, `Cannot reach ${selector}: ${point.hit}`);
  const gesture = (editableDataOnly || navigationCreationOnly || viewsScaleLinksOnly || configMultilineExportOnly || filtersPositionFormattingOnly || formulasFlowTablesOnly || summariesTransfersBackgroundsOnly || groupsCrossPropertiesArrangeOnly || presentationStructureLayoutOnly) ? { selector, modifiers, point, before: null, down: null, up: null } : null;
  const observe = `(()=>{const node=document.querySelector(${JSON.stringify(selector)}),hit=document.elementFromPoint(${JSON.stringify(point.x)},${JSON.stringify(point.y)}),active=document.activeElement;return{exists:Boolean(node),connected:node?.isConnected===true,rect:node?.getBoundingClientRect().toJSON(),pointHits:hit===node||Boolean(node&&hit&&node.contains(hit)),hit:hit?.outerHTML.slice(0,350),active:active?{tag:active.tagName,text:active.textContent?.slice(0,120)}:null,windowScroll:{x:scrollX,y:scrollY}}})()`;
  if (gesture) { (report[presentationStructureLayoutOnly ? "presentationStructureLayoutPointerInteractions" : groupsCrossPropertiesArrangeOnly ? "groupsCrossPropertiesArrangePointerInteractions" : summariesTransfersBackgroundsOnly ? "summariesTransfersBackgroundsPointerInteractions" : formulasFlowTablesOnly ? "formulasFlowTablesPointerInteractions" : filtersPositionFormattingOnly ? "filtersPositionFormattingPointerInteractions" : configMultilineExportOnly ? "configMultilineExportPointerInteractions" : viewsScaleLinksOnly ? "viewsScaleLinksPointerInteractions" : navigationCreationOnly ? "navigationCreationPointerInteractions" : "editableDataPointerInteractions"] ??= []).push(gesture); gesture.before = await evaluate(observe); }
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
  if (gesture) gesture.down = await evaluate(observe);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
  if (gesture) gesture.up = await evaluate(observe);
}
async function press(key, code, windowsVirtualKeyCode, modifiers = 0) {
  report.lastInteraction = { type: "key", key, modifiers };
  await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode, modifiers });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
}
async function fill(selector, text) {
  await click(selector);
  await press("a", "KeyA", 65, 2);
  await command("Input.insertText", { text });
}
async function selectFolder(selector, directory, cancel = false) {
  const arguments_ = ["-NoProfile", "-File", join(root, "tools", "select-test-folder.ps1"), "-BrowserProcessId", String(child.pid), ...(cancel ? ["-Cancel"] : ["-Folder", directory])];
  const picker = spawn("pwsh", arguments_, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [picker.stdout, picker.stderr]) {
    stream.on("data", data => { output += data; });
  }
  const done = once(picker, "exit");
  try {
    await click(selector);
    const [code] = await done;
    assert.equal(code, 0, output);
    if (!cancel) {
      await wait('pickerTrace.calls.at(-1)?.completed===true', "actual directory picker result");
      assert.equal(await evaluate('pickerTrace.calls.at(-1).name'), directory.split(/[\\/]/).at(-1), "The owned OS picker must return the requested directory, not its parent.");
    }
  } finally {
    if (picker.exitCode === null) {
      picker.kill();
      await done;
    }
  }
}
async function exact(path, text) {
  await waitFor(async () => {
    try {
      return (await readFile(path, "utf8")) === text;
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }, "exact disk bytes for " + path);
}
async function focusEditor() { await click(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]"); }
async function ready() { await wait('document.querySelector("main[data-ready=true]")&&window.app&&!app.changingVault'); }
const pass = text => { report.checks.push(text); console.log("PASS " + text); };

async function readArtifacts() {
  const site = join(root, ".runtime", "web", "wwwroot");
  const assembly = (await readdir(join(site, "_framework"))).find(name => name.startsWith("RonSijm.Slopsidian.Web.") && name.endsWith(".wasm"));
  assert.ok(assembly, "Published .NET application WebAssembly is present");
  const sha256 = {};
  for (const path of ["index.html", "app.css", "browser.css", "icons.svg", "icons-LICENSE.txt", "core-verification.json", "lucide-icons.svg", "lucide-icons-LICENSE.txt", "mermaid-frame.html", "js/mermaid-frame.js", "js/mermaid-api.js", "js/mermaid-api.js.LEGAL.txt", "js/mermaid-licenses.txt", "js/katex-license.txt", "js/pdf-api.js", "js/pdf-worker.js", "js/pdf-licenses.txt", "js/pdf/wasm/jbig2.wasm", "js/pdf/wasm/openjpeg.wasm", "js/pdf/wasm/qcms_bg.wasm", "js/pdf/cmaps/Adobe-Japan1-UCS2.bcmap.txt", "js/pdf/standard_fonts/LiberationSans-Regular.ttf.txt", "js/editor-host.js", "js/editor-host.css", "js/codemirror-license.txt", "js/hypermd-license.txt", "js/web-reader-extract.js", "js/web-reader-extract.js.LEGAL.txt", "js/web-reader-licenses.txt", "js/browser-host.js", "js/search-worker.js", "js/graph-worker.js", "js/bases-worker.js", "_framework/" + assembly]) {
    sha256[path] = createHash("sha256").update(await readFile(join(site, ...path.split("/")))).digest("hex");
  }
  const scenarioSha256 = {};
  if (presentationStructureLayoutOnly) { for (const path of presentationStructureLayoutDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (groupsCrossPropertiesArrangeOnly) { for (const path of groupsCrossPropertiesArrangeDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (summariesTransfersBackgroundsOnly) { for (const path of summariesTransfersBackgroundsDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (formulasFlowTablesOnly) { for (const path of formulasFlowTablesDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (filtersPositionFormattingOnly) { for (const path of filtersPositionFormattingDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (configMultilineExportOnly) { for (const path of configMultilineExportDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
if (viewsScaleLinksOnly) { for (const path of viewsScaleLinksDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (navigationCreationOnly) { for (const path of navigationCreationDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (editableDataOnly) { for (const path of editableDataDependencies) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (graphsOnly) { for (const path of ["tools/graph-scenarios.mjs","client/graph.ts","client/graph-model.ts","client/graph-worker.ts","client/graph-export.ts","client/graph-export-modal.ts","tests/graph.test.mjs","tests/graph-export.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (visualAuthoringOnly) { for (const path of ["tools/visual-authoring-scenarios.mjs","tools/canvas-workflow-scenarios.mjs","tools/canvas-scenarios.mjs","tools/graph-sharing-scenarios.mjs","tools/outgoing-new-destination-scenarios.mjs","tools/cached-github-fixture.mjs","client/canvas.ts","client/canvas-model.ts","client/canvas-preview.ts","client/canvas-chooser.ts","client/canvas-interaction-model.ts","client/note-embed-section.ts","client/note-embed.ts","client/reading.ts","client/graph.ts","client/graph-model.ts","client/graph-worker.ts","client/graph-export.ts","client/graph-export-modal.ts","client/outgoing-links.ts","client/outgoing-pane-view.ts","client/outgoing-mention-intent.ts","client/outgoing-mention-authoring.ts","client/outgoing-mention-bulk.ts","client/outgoing-mention-bulk-review.ts","client/outgoing-new-destination.ts","client/outgoing-new-destination-source.ts","client/outgoing-new-destination-review.ts","client/file-manager.ts","client/vault.ts","client/github-vault.ts","tests/canvas-workflows.test.mjs","tests/graph-export.test.mjs","tests/outgoing-new-destination.test.mjs","tests/smoke-scopes.test.mjs","tests/github-vault.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (exportHandoffHistoryOnly) { for (const path of ["tools/export-handoff-history-scenarios.mjs","client/bases-export-modal.ts","tools/bases-export-scenarios.mjs","tools/structured-property-handoff-scenarios.mjs","tools/recovery-lineage-scenarios.mjs","client/bases-export.ts","client/bases.ts","client/bases-model.ts","client/bases-worker.ts","client/base-embed-render.ts","client/bases-group-state.ts","client/structured-property-handoff.ts","client/structured-properties.ts","client/structured-property-operations.ts","client/properties.ts","client/file-recovery.ts","client/recovery-model.ts","client/recovery-diff.ts","client/editor.ts","client/file-manager.ts","client/vault.ts","tests/bases-export.test.mjs","tests/structured-property-handoff.test.mjs","tests/recovery-lineage.test.mjs","tests/smoke-scopes.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (inlineStructureAudioOnly) { for (const path of ["tools/inline-structure-audio-scenarios.mjs","client/markdown-postprocessors.ts","tests/markdown-postprocessors.test.mjs","client/saved-audio-waveform.ts","client/base-code-blocks.ts","client/structured-property-operations.ts","tools/bases-code-block-scenarios.mjs","tools/structured-property-operations-scenarios.mjs","tools/saved-audio-waveform-scenarios.mjs","client/base-embed.ts","client/base-embed-render.ts","client/reading.ts","client/live-preview.ts","client/bases.ts","client/bases-model.ts","client/bases-cards.ts","client/bases-group-state.ts","client/note-embed.ts","client/structured-properties.ts","client/properties.ts","client/multiline-properties.ts","client/audio-waveform.ts","client/audio-recorder.ts","client/audio-capture.ts","client/editor.ts","tests/bases-code-blocks.test.mjs","tests/structured-property-operations.test.mjs","tests/saved-audio-waveform.test.mjs","tests/structured-properties.test.mjs","tests/audio-waveform.test.mjs","tests/smoke-scopes.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (embedsTypedBulkOnly) { for (const path of ["tools/embeds-typed-bulk-scenarios.mjs","tools/bases-embed-scenarios.mjs","tools/nested-property-types-scenarios.mjs","tools/outgoing-bulk-source-scenarios.mjs","client/base-embed.ts","client/base-embed-render.ts","tests/bases-embeds.test.mjs","tests/outgoing-bulk-source.test.mjs","tests/outgoing-bulk-source-fixture.mjs","client/bases.ts","client/bases-model.ts","client/bases-cards.ts","client/bases-group-state.ts","client/reading.ts","client/live-preview.ts","client/note-embed.ts","client/structured-properties.ts","client/properties.ts","client/multiline-properties.ts","client/outgoing-mention-intent.ts","client/outgoing-mention-authoring.ts","client/outgoing-mention-bulk.ts","client/outgoing-mention-bulk-review.ts","client/outgoing-pane-view.ts","client/outgoing-links.ts","client/editor.ts","tests/structured-properties.test.mjs","tests/outgoing-mention-bulk.test.mjs","tests/smoke-scopes.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (cardsAudioBulkOnly) { for (const path of ["tools/cards-audio-bulk-scenarios.mjs","tools/bases-card-scenarios.mjs","tools/audio-waveform-scenarios.mjs","tools/outgoing-bulk-mention-scenarios.mjs","client/bases.ts","client/bases-model.ts","client/bases-cards.ts","client/bases-group-state.ts","client/audio-recorder.ts","client/audio-waveform.ts","client/audio-capture.ts","client/audio-inputs.ts","client/outgoing-pane-view.ts","client/outgoing-links.ts","client/outgoing-mention-authoring.ts","client/outgoing-mention-bulk.ts","client/outgoing-mention-bulk-review.ts","client/outgoing-mention-intent.ts","client/editor.ts","tests/bases-cards.test.mjs","tests/audio-waveform.test.mjs","tests/outgoing-mention-bulk.test.mjs","tests/outgoing-mention-bulk-fixture.mjs","tests/smoke-scopes.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (viewsInputsOnly) { for (const path of ["client/outgoing-mention-intent.ts","tools/views-inputs-scenarios.mjs","tools/bases-list-scenarios.mjs","tools/audio-input-scenarios.mjs","tools/outgoing-visible-authoring-scenarios.mjs","client/bases.ts","client/bases-model.ts","client/bases-group-state.ts","client/audio-capture.ts","client/audio-recorder.ts","client/audio-inputs.ts","client/outgoing-pane-view.ts","client/outgoing-links.ts","client/outgoing-mention-authoring.ts","src/RonSijm.Slopsidian/wwwroot/app.css","tests/bases-list.test.mjs","tests/audio-inputs.test.mjs","tests/outgoing-visible-authoring.test.mjs","tests/smoke-scopes.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (authoringControlsOnly) { for (const path of ["tools/authoring-controls-scenarios.mjs","tools/outgoing-mention-authoring-scenarios.mjs","tools/bases-group-scenarios.mjs","tools/audio-pause-scenarios.mjs","client/outgoing-pane-view.ts","client/outgoing-pane-model.ts","client/outgoing-links.ts","client/outgoing-mention-authoring.ts","client/bases.ts","client/bases-model.ts","client/bases-group-state.ts","client/audio-capture.ts","client/audio-recorder.ts","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (richEditingOnly) { for (const path of ["tools/rich-editing-scenarios.mjs","tools/structured-properties-scenarios.mjs","tools/multiline-inline-footnote-scenarios.mjs","tools/recovery-diff-scenarios.mjs","tools/bulk-system-trash-scenarios.mjs","tools/system-trash-restore.mjs","client/properties.ts","client/structured-properties.ts","client/multiline-properties.ts","client/markdown.ts","client/inline-footnotes.ts","client/footnote-render-model.ts","client/footnote-edit.ts","client/footnote-edit-modal.ts","client/footnotes-pane-model.ts","client/file-recovery.ts","client/recovery-model.ts","client/recovery-diff.ts","client/explorer-trash.ts","client/explorer-trash-modal.ts","client/file-explorer-view.ts","src/RonSijm.Slopsidian/wwwroot/app.css","tests/structured-properties.test.mjs","tests/multiline-inline-footnotes.test.mjs","tests/recovery-diff.test.mjs","tests/smoke-scopes.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (structuredRecoveryOnly) { for (const path of ["tools/structured-recovery-scenarios.mjs","tools/multiline-properties-scenarios.mjs","tools/markdown-crlf-scenarios.mjs","tools/trash-recovery-scenarios.mjs","client/properties.ts","client/markdown.ts","client/vault.ts","client/vault-io.ts","client/browser-vault.ts","client/file-manager.ts","client/file-explorer-view.ts","client/contracts.ts","src/RonSijm.Slopsidian/Services/FileOperations.cs","tests/multiline-properties.test.mjs","tests/markdown-crlf-structure.test.mjs","tests/trash-recovery.test.mjs","tests/trash-recovery-host.test.mjs","tests/smoke-scopes.test.mjs","client/multiline-properties.ts","client/explorer-trash-recovery.ts","client/explorer-trash-recovery-modal.ts","client/explorer-trash-recovery-browser.ts","client/heading-authoring.ts","client/block-authoring.ts","src/RonSijm.Slopsidian/Services/VaultService.TrashRecovery.cs","src/RonSijm.Slopsidian/Services/VaultService.Files.cs","src/RonSijm.Slopsidian/wwwroot/app.css","tests/markdown-crlf-authoring.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (workflowControlsOnly) { for (const path of ["tools/workflow-controls-scenarios.mjs","tools/property-link-authoring-scenarios.mjs","tools/reading-bulk-fold-scenarios.mjs","tools/explorer-removal-choices-scenarios.mjs","client/app.ts","client/editor-fold-commands.ts","client/properties.ts","client/property-value-suggestions.ts","client/file-manager.ts","client/explorer-trash.ts","client/explorer-trash-modal.ts","client/file-explorer-view.ts","client/reading.ts","client/reading-folding.ts","client/reading-list-folding.ts","client/reading-callout-folding.ts","client/fold-state-storage.ts","tests/property-link-authoring.test.mjs","tests/reading-bulk-folds.test.mjs","tests/explorer-removal-choices.test.mjs","tests/smoke-scopes.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (propertiesReadingOnly) { for (const path of ["tools/properties-reading-scenarios.mjs","tools/property-workflows-scenarios.mjs","tools/crosspane-drop-scenarios.mjs","tools/reading-callout-scenarios.mjs","client/properties.ts","client/property-value-suggestions.ts","client/file-manager.ts","client/file-explorer-view.ts","client/explorer-move-modal.ts","client/explorer-move.ts","client/reading.ts","client/reading-search.ts","client/fold-state-storage.ts","src/RonSijm.Slopsidian/wwwroot/app.css","client/explorer-note-drag.ts","client/reading-callout-folding.ts","client/heading-authoring.ts","client/markdown.ts","tests/property-workflows.test.mjs","tests/property-heading-creation.test.mjs","tests/property-note-creation.test.mjs","tests/property-value-suggestions.test.mjs","tests/properties-panes.test.mjs","tests/file-explorer.test.mjs","tests/fold-state-storage.test.mjs","tests/reading-callout-folding.test.mjs","tests/reading-search.test.mjs","tests/reading-folding.test.mjs","tests/reading-list-folding.test.mjs","tests/reading-tasks.test.mjs","tests/editor-history-selection.test.mjs","tests/smoke-scopes.test.mjs","tests/heading-authoring.test.mjs","tests/markdown.test.mjs","tests/builtin-suggestions.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (authoringTransfersOnly) { for (const path of ["tools/authoring-transfers-scenarios.mjs","tools/setext-authoring-scenarios.mjs","tools/callout-authoring-scenarios.mjs","tools/property-heading-creation-scenarios.mjs","tools/explorer-drop-scenarios.mjs","client/heading-authoring.ts","client/block-authoring.ts","client/markdown.ts","client/builtin-suggestions.ts","client/property-value-suggestions.ts","client/properties.ts","client/file-manager.ts","client/file-explorer-view.ts","client/explorer-move-modal.ts","client/explorer-move.ts","src/RonSijm.Slopsidian/wwwroot/app.css","tests/heading-authoring.test.mjs","tests/block-authoring.test.mjs","tests/markdown.test.mjs","tests/property-heading-creation.test.mjs","tests/property-value-suggestions.test.mjs","tests/property-note-creation.test.mjs","tests/file-explorer.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (noteManagementOnly) { for (const path of ["tools/note-management-scenarios.mjs","tools/heading-chain-scenarios.mjs","tools/block-extended-scenarios.mjs","tools/explorer-rename-scenarios.mjs","tools/explorer-trash-scenarios.mjs","client/heading-authoring.ts","client/block-authoring.ts","client/builtin-suggestions.ts","client/markdown.ts","client/explorer-rename.ts","client/explorer-rename-modal.ts","client/explorer-trash.ts","client/explorer-trash-modal.ts","client/file-explorer-view.ts","client/file-manager.ts","tests/heading-authoring.test.mjs","tests/block-authoring.test.mjs","tests/markdown.test.mjs","tests/builtin-suggestions.test.mjs","tests/explorer-rename.test.mjs","tests/client-folder-operations.test.mjs","tests/file-explorer.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (authoringOrganizationOnly) { for (const path of ["tools/authoring-organization-scenarios.mjs","tools/heading-authoring-scenarios.mjs","tools/block-kinds-scenarios.mjs","tools/explorer-move-scenarios.mjs","client/heading-authoring.ts","client/block-authoring.ts","client/builtin-suggestions.ts","client/markdown.ts","client/file-manager.ts","client/explorer-move.ts","client/explorer-move-modal.ts","client/file-explorer-view.ts","tests/heading-authoring.test.mjs","tests/block-authoring.test.mjs","tests/builtin-suggestions.test.mjs","tests/client-folder-operations.test.mjs","tests/file-explorer.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (linkAuthoringOnly) { for (const path of ["client/workspace.ts","tests/editor-api.test.mjs","tools/link-authoring-scenarios.mjs","tools/unresolved-heading-scenarios.mjs","tools/block-authoring-scenarios.mjs","tools/property-note-creation-scenarios.mjs","client/unresolved-heading-completion.ts","client/block-authoring.ts","client/builtin-suggestions.ts","client/editor.ts","client/file-manager.ts","client/property-value-suggestions.ts","client/properties.ts","tests/unresolved-heading-completion.test.mjs","tests/block-authoring.test.mjs","tests/property-note-creation.test.mjs","tests/builtin-suggestions.test.mjs","tests/property-value-suggestions.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (noteContinuityOnly) { for (const path of ["tools/note-continuity-scenarios.mjs","tools/editor-fold-state-scenarios.mjs","tools/reading-fold-state-scenarios.mjs","tools/note-creation-scenarios.mjs","client/fold-state-storage.ts","client/editor-fold-state.ts","client/reading-fold-state.ts","client/editor.ts","client/reading.ts","client/workspace.ts","client/builtin-suggestions.ts","client/builtin-suggestion-model.ts","client/file-manager.ts","tests/fold-state-storage.test.mjs","tests/editor-fold-state.test.mjs","tests/reading-fold-state.test.mjs","tests/builtin-suggestions.test.mjs","tests/file-settings.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (markdownPolishOnly) { for (const path of ["tools/markdown-polish-scenarios.mjs","tools/extra-highlighting-scenarios.mjs","tools/markdown-pairing-scenarios.mjs","tools/reading-task-scenarios.mjs","client/reading.ts","client/reading-tasks.ts","client/reading-list-folding.ts","client/code-highlighting.ts","client/editor-markdown-pairing.ts","client/editor-spellcheck.ts","tests/code-highlighting.test.mjs","tests/reading-tasks.test.mjs","tests/editor-markdown-pairing.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (markdownInteractionOnly) { for (const path of ["tools/markdown-interaction-scenarios.mjs","tools/reading-list-folding-scenarios.mjs","tools/markdown-pairing-scenarios.mjs","tools/reading-task-scenarios.mjs","client/reading.ts","client/reading-list-folding.ts","client/reading-tasks.ts","client/reading-folding.ts","client/reading-search.ts","client/editor-preferences.ts","client/editor-typing.ts","client/editor-markdown-pairing.ts","client/editor-spellcheck.ts","client/editor.ts","client/app.ts","tests/reading-list-folding.test.mjs","tests/reading-tasks.test.mjs","tests/editor-markdown-pairing.test.mjs","tests/editor-typing.test.mjs","tests/editor-preferences.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (editorAssistanceOnly) { for (const path of ["tools/editor-assistance-scenarios.mjs","tools/reading-folding-scenarios.mjs","tools/typing-control-scenarios.mjs","tools/fuzzy-completion-scenarios.mjs","client/reading.ts","client/reading-folding.ts","client/reading-search.ts","client/editor-preferences.ts","client/editor-typing.ts","client/editor.ts","client/editor-language.ts","client/editor-spellcheck.ts","client/builtin-suggestion-model.ts","client/app.ts","tests/reading-search.test.mjs","tests/editor-preferences.test.mjs","tests/builtin-suggestions.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (noteNavigationOnly) { for (const path of ["tools/note-navigation-scenarios.mjs","tools/folding-control-scenarios.mjs","tools/properties-subpath-scenarios.mjs","tools/file-selection-scenarios.mjs","client/editor-preferences.ts","client/editor.ts","client/editor-spellcheck.ts","client/file-explorer-view.ts","client/file-explorer-model.ts","client/property-value-suggestions.ts","client/properties.ts","tests/editor-preferences.test.mjs","tests/file-explorer.test.mjs","tests/property-value-suggestions.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (readingToolsOnly) { for (const path of ["tools/reading-tools-scenarios.mjs","tools/reading-regex-scenarios.mjs","tools/language-highlighting-scenarios.mjs","tools/properties-link-scenarios.mjs","client/reading-search.ts","client/search-pattern.ts","client/editor-search.ts","client/code-highlighting.ts","client/property-value-suggestions.ts","client/properties.ts","tests/reading-search.test.mjs","tests/editor-search.test.mjs","tests/code-highlighting.test.mjs","tests/property-value-suggestions.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (noteWorkflowsOnly) { for (const path of ["tools/note-workflows-scenarios.mjs","tools/hierarchical-heading-scenarios.mjs","tools/properties-completion-scenarios.mjs","tools/reading-selection-scenarios.mjs","client/links.ts","client/file-manager.ts","client/builtin-suggestion-model.ts","client/builtin-suggestions.ts","client/properties.ts","client/property-value-suggestions.ts","client/reading-search.ts","tests/heading-links.test.mjs","tests/frontmatter-guard.test.mjs","tests/builtin-suggestions.test.mjs","tests/property-value-suggestions.test.mjs","tests/reading-search.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (editorWorkflowsOnly) { for (const path of ["tools/editor-workflows-scenarios.mjs","tools/cursor-handoff-scenarios.mjs","tools/multi-range-search-scenarios.mjs","tools/spellcheck-management-scenarios.mjs","client/editor.ts","client/workspace.ts","client/editor-search.ts","client/editor-spellcheck.ts","client/spellcheck-settings.ts","desktop/spellcheck.cjs","desktop/main.cjs","tests/cursor-handoff.test.mjs","tests/editor-search.test.mjs","tests/editor-spellcheck.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (readingDiscoveryOnly) { for (const path of ["tools/reading-discovery-scenarios.mjs","tools/reading-search-scenarios.mjs","tools/global-heading-scenarios.mjs","tools/expanded-highlighting-scenarios.mjs","client/reading-search.ts","client/reading.ts","client/workspace.ts","client/editor-search-commands.ts","client/builtin-suggestion-model.ts","client/builtin-suggestions.ts","client/code-highlighting.ts","tests/reading-search.test.mjs","tests/builtin-suggestions.test.mjs","tests/code-highlighting.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (editorProductivityOnly) { for (const path of ["tools/editor-productivity-scenarios.mjs","tools/editor-preference-scenarios.mjs","tools/property-value-scenarios.mjs","tools/selection-search-scenarios.mjs","client/editor-preferences.ts","client/editor-spellcheck.ts","client/editor.ts","client/editor-search.ts","client/builtin-suggestion-model.ts","client/builtin-suggestions.ts","client/app.ts","tests/editor-preferences.test.mjs","tests/editor-search.test.mjs","tests/builtin-suggestions.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (noteAuthoringOnly) { for (const path of ["tools/note-authoring-scenarios.mjs","tools/spellcheck-scenarios.mjs","tools/subpath-suggestion-scenarios.mjs","tools/print-export-scenarios.mjs","tools/save-test-pdf.ps1","client/editor-spellcheck.ts","client/print-export.ts","client/print-export-model.ts","client/builtin-suggestion-model.ts","client/builtin-suggestions.ts","client/editor.ts","client/editor-host.ts","client/app.ts","desktop/spellcheck.cjs","desktop/print-export.cjs","desktop/main.cjs","tests/editor-spellcheck.test.mjs","tests/print-export.test.mjs","tests/builtin-suggestions.test.mjs","src/RonSijm.Slopsidian/Components/Pages/Home.razor","src/RonSijm.Slopsidian/Components/Pages/Home.razor.cs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (attachmentsOnly) { for (const path of ["client/attachment-import.ts","client/attachments.ts","client/editor-host.ts","client/workspace.ts","client/app.ts","client/desktop-ui.ts","tests/attachment-import.test.mjs","tools/attachment-scenarios.mjs","tools/set-test-clipboard.ps1"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root,path))).digest("hex"); } }
  if (persistentDraftsOnly) { for (const path of ["tools/persistent-drafts-scenarios.mjs", "tools/persistent-drafts-scenarios-text.mjs", "client/persistent-draft-owners.ts", "client/persistent-draft-providers.ts", "tests/persistent-drafts-text.test.mjs", "client/persistent-draft-model.ts", "client/persistent-drafts.ts", "client/persistent-draft-review.ts", "client/draft-rescue-review.ts", "client/browser-vault.ts", "tests/persistent-drafts.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (autosaveOnly) { for (const path of ["tools/autosave-scenarios.mjs", "client/markdown-autosave.ts", "client/markdown-autosave-ui.ts", "client/workspace.ts", "client/editor-host.ts", "client/app.ts", "client/browser-vault.ts", "tests/markdown-autosave.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (modalFocusOnly) {
    for (const path of ["tools/modal-focus-scenarios.mjs", "client/modal-focus.ts", "client/ui.ts", "tests/modal-focus.test.mjs", "client/draft-rescue-review.ts", "client/editor-host.ts", "client/draft-rescue-inspector.ts"]) {
      scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
    }
  }
  if (groupsPopoutsOnly) {
    for (const path of ["client/workspace-groups.ts", "client/workspace-window.ts", "client/realm.ts", "client/menu.ts", "client/ui.ts", "client/editor.ts", "client/views.ts", "tests/workspace-groups-popouts.test.mjs", "tests/web-smoke-popup-policy.test.mjs"]) {
      scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
    }
  }
  if (modalLayoutOnly) {
    for (const path of ["tools/modal-layout-scenarios.mjs", "client/modal-focus.ts", "client/ui.ts"]) {
      scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
    }
  }
  for (const name of ["editor-improvements-scenarios", "code-highlighting-scenarios", "editor-search-scenarios", "builtin-suggestion-scenarios", "web-smoke", "web-smoke-host", "web-smoke-popup-policy", "core-foundation-scenarios", "core-scenarios", "core-verification-targets", "core-verification-scenarios", "tab-movement-scenarios", "workspace-docking-scenarios", "workspace-history-scenarios", "workspace-popout-scenarios", "webviewer-scenarios", "pane-resize-scenarios", "reading-scenarios", "outgoing-scenarios", "discovery-scenarios", "editor-chrome-scenarios", "suggestion-scenarios", "renderer-scenarios", "render-child-scenarios", "templater-scenarios", "organization-scenarios", "file-scenarios", "graph-scenarios", "canvas-scenarios", "preview-scenarios", "editing-tools-scenarios", "format-scenarios", "composer-scenarios", "menu-scenarios", "bases-scenarios", "bases-summary-scenarios", "recovery-scenarios", "view-scenarios", "audio-scenarios", "mermaid-scenarios", "workspace-import-scenarios", "community-plugin-test-helpers", "math-embed-scenarios"]) {
    const path = name + (name === "web-smoke-host" || name === "web-smoke-popup-policy" ? ".cjs" : ".mjs");
    scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, "tools", path))).digest("hex");
  }
  if (reportedPluginsOnly) { scenarioSha256["reported-plugin-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools", "reported-plugin-scenarios.mjs"))).digest("hex"); }
  if (additionalPluginsOnly) {
    for (const path of ["tools\\additional-plugin-scenarios.mjs", "tools\\additional-plugin-assets.mjs", "tools\\additional-plugin-workflows.mjs", "tools\\additional-plugin-next-workflows.mjs", ...["plugin-host", "plugin", "legacy-constructors", "ui", "settings", "icons", "dom", "menu", "suggestions", "desktop-ui", "file-manager", "views", "workspace", "app", "editor", "editor-host", "protocol", "markdown-embed", "markdown", "timers", "vault", "browser-vault"].map(name => join("client", name + ".ts"))]) {
      scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
    }
  }
  if (communitySettingsOnly) {
    for (const name of ["tools\\community-settings-scenarios.mjs", "client\\community-settings.ts", "client\\plugin-host.ts", "client\\editor-host.ts", "tests\\community-plugins.test.mjs"]) {
      scenarioSha256[name] = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
    }
  }
  if (communityInstallOnly) {
    for (const name of ["tools\\community-install-scenarios.mjs", "tools\\community-marketplace-scenarios.mjs", "tools\\cached-github-fixture.mjs", "client\\community-bulk.ts", "client\\community-readme.ts", "client\\plugin-id.ts", "tests\\community-marketplace.test.mjs", "client\\community-browser.ts", "client\\community-browser.css", "client\\community-catalog.ts", "client\\community-settings.ts", "client\\plugin-host.ts", "client\\contracts.ts", "client\\browser-vault.ts", "tests\\community-plugins.test.mjs", "src\\RonSijm.Slopsidian.Web\\wwwroot\\index.html"]) {
      scenarioSha256[name] = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
    }
  }
  if (excalidrawOnly) { scenarioSha256["excalidraw-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools", "excalidraw-scenarios.mjs"))).digest("hex"); }
  if (tagsOnly) {
    for (const name of ["tag-scenarios.mjs", "rendering-parity-scenarios.mjs"]) { scenarioSha256[name] = createHash("sha256").update(await readFile(join(root, "tools", name))).digest("hex"); }
  }
  if (bookmarksOnly) { for (const path of ["tools/bookmark-scenarios.mjs", "tools/graph-scenarios.mjs", "tools/organization-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/bookmarks.ts", "client/graph.ts", "client/desktop-ui.ts", "tests/bookmarks.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (discoveryOnly) { for (const path of ["tools/cached-github-fixture.mjs", "client/links.ts", "client/metadata.ts", "client/vault.ts", "client/file-manager.ts", "client/desktop-ui.ts", "client/recent-files.ts", "client/workspace.ts", "client/workspace-startup.ts", "client/bookmarks.ts", "tests/markdown.test.mjs", "tests/workspace-tabs.test.mjs", "tests/workspace-startup.test.mjs", "tests/workspace-transition.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (discoveryPanesOnly) { for (const path of ["tools/discovery-pane-scenarios.mjs", "tools/inline-footnote-scenarios.mjs", "client/inline-footnotes.ts", "client/footnote-render-model.ts", "client/reading.ts", "client/footnote-edit.ts", "client/footnote-edit-modal.ts", "tests/inline-footnotes.test.mjs", "tools/cached-github-fixture.mjs", "client/tags-pane-view.ts", "client/tags-pane-model.ts", "client/footnotes-pane-view.ts", "client/footnotes-pane-model.ts", "client/discovery-views.ts", "client/sidebars.ts", "client/search-pane-model.ts", "client/bookmarks.ts", "client/workspace.ts", "tests/discovery-panes.test.mjs", "tests/workspace-tabs.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (nativeRecentsOnly) { for (const path of ["tools/native-recent-vault-scenarios.mjs", "client/native-recents.ts", "client/editor-host.ts", "src/RonSijm.Slopsidian/Components/Pages/Home.razor", "src/RonSijm.Slopsidian/Components/Pages/Home.razor.cs", "tests/native-recent-vaults.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (originalFloatingOnly) { for (const path of ["tools/web-smoke-quit.cjs", "client/workspace-window.ts"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (originalFloatingOnly) { for (const path of ["tools/original-floating-import-scenario.mjs", "client/workspace-import.ts", "client/workspace-startup.ts", "tests/original-floating-import.test.mjs", "tests/original-floating-import-scenario.test.mjs", "tests/fixtures/original-obsidian-1.12.7/workspace.floating-open.json", "tests/fixtures/original-obsidian-1.12.7/capture-result.json"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (githubIndexUiOnly) { for (const path of ["tools/github-index-ui-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/github-index.ts", "client/github-index-ui.ts", "client/github-offline-ui.ts", "client/github-vault.ts", "plugins/github-vault/provider.ts", "tests/github-vault.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (backlinkPanesOnly) { for (const path of ["tools/backlink-pane-scenarios.mjs","tools/cached-github-fixture.mjs","client/backlink-view.ts","client/backlink-model.ts","client/discovery-views.ts","client/sidebars.ts","tests/backlink-panes.test.mjs","src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (outgoingPanesOnly) { for (const path of ["tools/outgoing-pane-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/outgoing-pane-view.ts", "client/outgoing-pane-model.ts", "client/outgoing-links.ts", "client/sidebars.ts", "client/workspace.ts", "tests/outgoing-panes.test.mjs", "tests/workspace-tabs.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (propertiesOnly) { for (const path of ["tools/properties-pane-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/properties.ts", "client/properties-lexemes.ts", "client/properties-pane-model.ts", "client/property-types.ts", "client/file-settings.ts", "client/file-manager.ts", "client/settings.ts", "tests/properties-panes.test.mjs", "tests/file-settings.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (viewersOnly) { for (const path of ["tools/viewer-scenarios.mjs", "tests/viewers.test.mjs", "client/image-view.ts", "client/viewer-views.ts", "client/media-policy.ts", "client/svg-sanitizer.ts", "client/pdf-engine.ts", "client/pdf-api.ts", "client/reading.ts", "client/workspace.ts"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (configurationLifecycleOnly) { for (const path of ["tools/configuration-lifecycle-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/configuration.ts", "client/file-settings.ts", "client/core-plugins.ts", "client/core-settings.ts", "client/vault.ts", "client/contracts.ts", "client/github-vault.ts", "client/browser-vault.ts", "src/RonSijm.Slopsidian/Services/VaultService.Configuration.cs", "src/RonSijm.Slopsidian/Services/VaultService.Core.cs", "src/RonSijm.Slopsidian/Services/CorePlugins.cs", "tests/configuration-lifecycle.test.mjs", "tests/core-settings-version.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (viewerProofsOnly) { for (const path of ["tools/viewer-proof-scenarios.mjs", "tools/cached-github-fixture.mjs", "tools/generate-viewer-fixtures.py", "tests/fixtures/viewers/manifest.json", "tests/fixtures/viewers/Split.avif", "tests/fixtures/viewers/Seek.webm", "client/image-view.ts", "client/viewer-views.ts", "client/media-policy.ts"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (hotkeysSecretsOnly) { for (const path of ["tools/hotkeys-secrets-scenarios.mjs", "client/hotkeys.ts", "client/hotkey-settings.ts", "client/secret-storage.ts", "client/ui.ts", "client/settings.ts", "client/app.ts", "client/plugin-host.ts", "client/editor-host.ts", "client/browser-vault.ts", "tests/hotkeys-secrets.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css", "src/RonSijm.Slopsidian/Services/VaultService.Configuration.cs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (appearanceOnly) { for (const path of appearanceThemesOnly ? appearanceThemeVerificationPaths : appearanceResourcesOnly ? appearanceResourceVerificationPaths : appearanceVerificationPaths) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (outlinePanesOnly) { for (const path of ["tools/outline-pane-scenarios.mjs", "tools/outline-reorder-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/outline-view.ts", "client/outline-model.ts", "client/outline-reorder.ts", "client/editor.ts", "client/workspace.ts", "client/markdown.ts", "client/desktop-ui.ts", "client/sidebars.ts", "tests/outline-panes.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (searchPanesOnly) { for (const path of ["tools/search-pane-scenarios.mjs", "tools/cached-github-fixture.mjs", "client/search-view.ts", "client/search-task.ts", "client/search-pane-model.ts", "client/discovery-views.ts", "client/sidebars.ts", "tests/search-panes.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (systemTrashOnly) { for (const path of ["tools/system-trash-scenarios.mjs", "client/file-manager.ts", "client/vault.ts", "client/browser-vault.ts", "tests/client-folder-operations.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (folderOperationsOnly) { for (const path of ["tools/folder-operations-scenarios.mjs", "client/file-manager.ts", "client/vault.ts", "client/browser-vault.ts", "client/links.ts", "tests/browser-folder-operations.test.mjs", "tests/client-folder-operations.test.mjs"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (fileExplorerOnly) { for (const path of ["tools/file-explorer-scenarios.mjs", "client/file-explorer-model.ts", "client/file-explorer-view.ts", "client/desktop-ui.ts", "client/sidebars.ts", "tests/file-explorer.test.mjs", "src/RonSijm.Slopsidian/wwwroot/app.css"]) { scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); } }
  if (workspaceStartupOnly) { scenarioSha256["workspace-startup-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools/workspace-startup-scenarios.mjs"))).digest("hex"); }
  scenarioSha256["select-test-folder.ps1"] = createHash("sha256").update(await readFile(join(root, "tools", "select-test-folder.ps1"))).digest("hex");
  const sourceSha256 = {};
  if (tagsOnly) {
    for (const name of ["reading", "live-preview", "editor", "markdown", "properties", "page-preview", "workspace"]) {
      const path = join("client", name + ".ts");
      sourceSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
    }
  }
  if (workspaceTransitionOnly) {
    scenarioSha256["workspace-transition-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools", "workspace-transition-scenarios.mjs"))).digest("hex");
    for (const path of ["client/workspace.ts", "client/editor-host.ts", "tests/workspace-transition.test.mjs"]) { sourceSha256[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex"); }
  }
  return { sha256, scenarioSha256, ...(workspaceTransitionOnly || tagsOnly ? { sourceSha256 } : {}) };
}

const errorAudit = createErrorLogAudit(join(root, ".runtime", "evidence"), reportName);
try {
  host = await startWebServer({ port: 0 });
  report.endpoint = host.endpoint;
  const initialArtifacts = await readArtifacts();
  report.sha256 = initialArtifacts.sha256;
  report.scenarioSha256 = initialArtifacts.scenarioSha256;
  if (workspaceTransitionOnly || tagsOnly) { report.sourceSha256 = initialArtifacts.sourceSha256; }
  report.inputEnvironment = "Windows occlusion and renderer/timer background throttling disabled in disposable UI processes; production launch is unchanged.";
  child = spawn(join(root, "node_modules", "electron", "dist", "electron.exe"), [
    join(root, "tools", "web-smoke-host.cjs"), "--site=" + host.endpoint, "--profile=" + profile, "--fixture=" + fixture, "--quit-nonce=" + quitNonce,
    ...(syntheticAudio ? ["--synthetic-audio"] : []),
    ...(originalFloatingOnly || groupsPopoutsOnly && !popupBlockedControlOnly ? ["--allow-app-popouts"] : []),
    "--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  ], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  exited = once(child, "exit");
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", data => {
      log += data;
      if (stream === child.stdout) {
        stdoutLog += data;
        if (stdoutLog.split(/\r?\n/).includes(quitAck(quitNonce))) { acknowledgeQuit(true); }
      }
      const found = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (found) {
        endpoint = "http://127.0.0.1:" + found[1];
      }
    });
  }
  await waitFor(() => Boolean(endpoint), "browser debugging endpoint");
  let target;
  await waitFor(async () => {
    const targets = await (await fetch(endpoint + "/json/list")).json();
    target = targets.find(target => target.type === "page" && target.url.startsWith(host.endpoint));
    return Boolean(target);
  }, "static WASM page");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    errorAudit.onEvent(message);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) {
          request.reject(new Error(JSON.stringify(message.error)));
        } else {
          request.resolve(message.result);
        }
      }
    } else if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) {
      mainFrameLoaderId = message.params.frame.loaderId;
    } else if (message.method === "Network.requestWillBeSent") {
      requests.push(message.params.request.url);
    } else if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
      missingAssets.push(message.params.response.url);
    } else if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error" && (tabMovementOnly || coreVerificationOnly || coreStatusOnly || reportedPluginsOnly || excalidrawOnly || additionalPluginsOnly)) {
      consoleErrors.push(message.params.args.map(argument => argument.description ?? argument.value ?? argument.type).join(" ").slice(0, 6000));
      report.consoleErrorDetails ??= [];
      report.consoleErrorDetails.push({ args: message.params.args, stackTrace: message.params.stackTrace });
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "warning" && additionalPluginsOnly) {
      report.consoleWarningDetails ??= [];
      report.consoleWarningDetails.push({ args: message.params.args, stackTrace: message.params.stackTrace });
    } else if (message.method === "Page.javascriptDialogOpening") {
      currentDialog = message.params;
    } else if (message.method === "Page.javascriptDialogClosed") {
      currentDialog = null;
    }
  });
  await once(socket, "open");
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Network.enable");
  const pickerSetup = `(()=>{globalThis.pickerTrace={events:[],calls:[]};for(const type of ["pointerdown","mousedown","mouseup","click"])document.addEventListener(type,event=>{pickerTrace.events.push({type,target:event.target?.id,active:navigator.userActivation.isActive});if(pickerTrace.events.length>20)pickerTrace.events.shift()},true);const picker=window.showDirectoryPicker;if(picker){window.showDirectoryPicker=async options=>{const entry={active:navigator.userActivation.isActive};pickerTrace.calls.push(entry);try{const result=await picker.call(window,{...options,startIn:"documents",id:"smoke-"+crypto.randomUUID().slice(0,20)});entry.name=result.name;entry.completed=true;return result}catch(error){entry.error=String(error);throw error}};}})()`;
  await command("Page.addScriptToEvaluateOnNewDocument", { source: pickerSetup });
  await evaluate(pickerSetup);
  await ready();
  await wait('document.querySelector("#vault-dialog").open');
  assert.equal(await evaluate('typeof require==="undefined"&&typeof process==="undefined"&&window.isSecureContext'), true);
  assert.equal(await evaluate('document.querySelector("#browser-open-vault").disabled'), false);
  assert.equal(await evaluate('document.querySelector("#vault-open-path")'), null);
  pass("Standalone Blazor WASM starts from static hosting with no renderer Node runtime or desktop path UI.");

  await selectFolder("#browser-open-vault", vault);
  await wait('app.vault.getName()==="Vault A"&&!document.querySelector("#vault-dialog").open&&!app.changingVault');
  assert.ok(await evaluate('app.vault.rootPath.startsWith("browser-vault:")'));
  assert.equal(await evaluate('typeof app.vault.adapter.getBasePath'), "undefined");
  assert.equal(await evaluate('app.vault.getFiles().find(file=>file.path==="Attachment.bin").stat.size'), 4);
  assert.equal(await evaluate('document.querySelector(\'[data-note-path="Attachment.bin"]\').disabled'), true);
  assert.equal(await evaluate('document.querySelector("#open-settings svg use").href.baseVal==="lucide-icons.svg#settings"'), true);
  pass("The actual OS folder picker grants a live external vault, including binary attachment inventory.");

  await click('[data-note-path="CRLF.md"]');
  await wait('app.current?.file.path==="CRLF.md"');
  assert.equal(await evaluate("app.editor.getValue()"), crlf);
  await focusEditor();
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "WASM saved \u03bb" });
  await press("Enter", "Enter", 13);
  await command("Input.insertText", { text: "Second line." });
  const saved = crlf + "WASM saved \u03bb\r\nSecond line.";
  await press("s", "KeyS", 83, 2);
  await exact(join(vault, "CRLF.md"), "\ufeff" + saved);
  await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving");
  pass("Real CodeMirror typing and Ctrl+S preserve exact UTF-8 BOM, CRLF and Unicode in the original file.");

  for (const separator of ["\n", "\r\n"]) {
    const external = "# External line endings" + separator + "New source." + separator;
    await writeFile(join(vault, "CRLF.md"), "\ufeff" + external);
    await wait(`app.editor.getValue()===${JSON.stringify(external)}`, "external line-ending changes update the editor");
    await focusEditor();
    await press("End", "End", 35, 2);
    await command("Input.insertText", { text: "Typed after refresh." });
    await press("Enter", "Enter", 13);
    await command("Input.insertText", { text: "Still the same separator." });
    await click("#save-note");
    await exact(join(vault, "CRLF.md"), "\ufeff" + external + "Typed after refresh." + separator + "Still the same separator.");
    await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving");
  }
  pass("External LF/CRLF changes reconfigure CodeMirror without changing the next save's line-ending style.");

  await click("#new-note");
  await wait('document.querySelector("#new-note-dialog").open');
  await fill("#new-note-name", "Nested/Web note");
  await click("#create-note");
  await wait('app.current?.file.path==="Nested/Web note.md"&&!document.querySelector("#new-note-dialog").open');
  await focusEditor();
  await command("Input.insertText", { text: "Created directly from WASM." });
  await click("#save-note");
  await exact(join(vault, "Nested", "Web note.md"), "Created directly from WASM.");
  pass("The shared note-creation UI creates folders and writes a new Markdown note directly to disk.");

  await click("#open-settings");
  await wait('document.querySelector("#settings-dialog").open');
  await click("#core-plugins-tab");
  await click('[data-core-toggle="random-note"]');
  await wait('!app.core.busy&&app.core.isEnabled("random-note")');
  assert.equal(JSON.parse(await readFile(join(vault, ".obsidian", "core-plugins.json"), "utf8"))["random-note"], true);
  await click("#community-plugins-tab");
  assert.equal(await evaluate('document.querySelector(\'[data-toggle-plugin="desktop-only"]\').disabled'), true);
  await click('[data-toggle-plugin="node-only"]');
  await wait('document.querySelector(\'.plugin-card[data-plugin-id="node-only"] .plugin-error\')?.textContent.includes("Unsupported module without the desktop Node runtime: node:fs")');
  assert.equal(await evaluate('document.querySelector(\'.plugin-card[data-plugin-id="node-only"]\').dataset.loaded'), "false");
  pass("Desktop-only plugins are unavailable and Node-dependent plugins fail visibly without executing past require.");
  assert.equal(await evaluate('Boolean(app.plugins.getPlugin("sample-plugin"))'), true, "The existing enabled list must restore the sample plugin without a manual enable click.");
  assert.equal(await readFile(join(vault, ".obsidian", "community-plugins.json"), "utf8"), '["sample-plugin"]\n');
  await wait('document.querySelector(\'.plugin-card[data-plugin-id="sample-plugin"]\').dataset.loaded==="true"');
  await click('[data-open-plugin-settings="sample-plugin"]');
  await wait('document.querySelector("#plugin-settings-host input")');
  await fill("#plugin-settings-host input", "Saved through browser storage");
  await exact(join(vault, ".obsidian", "plugins", "sample-plugin", "data.json"), JSON.stringify({ mySetting: "Saved through browser storage" }, null, 2));
  await click(".settings-close");
  pass("Core enablement and the unchanged upstream sample plugin save settings into the selected vault.");

  const layout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
  await command("Page.reload");
  await ready();
  await wait('document.querySelector("[data-recent-vault]")');
  await click("[data-recent-vault]");
  await wait('app.vault.getName()==="Vault A"&&!document.querySelector("#vault-dialog").open&&!app.changingVault');
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), layout);
  assert.equal(await evaluate('app.core.isEnabled("random-note")'), true);
  assert.equal(await evaluate("app.editor.getValue()"), "Created directly from WASM.");
  assert.equal(await readFile(join(vault, ".obsidian", "workspace.json"), "utf8"), originalWorkspace);
  assert.equal(await readFile(join(vault, ".obsidian", "community-plugins.json"), "utf8"), '["sample-plugin"]\n');
  pass("Page reload reconnects an IndexedDB directory handle and restores layout, core state and exact disk content.");

  await writeFile(join(vault, "Nested", "Web note.md"), "Edited by an external program.\n");
  await wait('app.editor.getValue()==="Edited by an external program.\\n"', "external file update reaches the clean editor");
  await focusEditor();
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "Retained dirty buffer." });
  await writeFile(join(vault, "Nested", "Web note.md"), "Newer external bytes.\n");
  await expectErrors({ evaluate, report }, [{ source: "host", message: "This file changed on disk. Your unsaved text is retained; resolve the conflict before saving." }], async () => { await click("#save-note");
  await wait('document.querySelector(".error-banner")?.textContent.includes("changed on disk")'); }, "Check browser explicit-save conflict protection");
  assert.equal(await evaluate("app.dirty"), true);
  assert.match(await evaluate("app.editor.getValue()"), /Retained dirty buffer/);
  assert.equal(await readFile(join(vault, "Nested", "Web note.md"), "utf8"), "Newer external bytes.\n");
  pass("External edits refresh clean buffers; stale saves fail without overwriting disk or discarding unsaved text.");

  const blockedBefore = log.split("WEB_UNSAVED_BLOCKED").length;
  await command("Page.reload");
  await waitFor(() => log.split("WEB_UNSAVED_BLOCKED").length > blockedBefore, "unsaved changes prevent page reload");
  assert.equal(await evaluate("app.dirty"), true);
  assert.match(await evaluate("app.editor.getValue()"), /Retained dirty buffer/);
  pass("A real page reload is blocked while a buffer has unsaved changes.");

  await click("#open-vault");
  await wait('document.querySelector("#vault-dialog").open');
  await selectFolder("#browser-open-vault", undefined, true);
  assert.equal(await evaluate("app.vault.getName()"), "Vault A");
  assert.equal(await evaluate("app.dirty"), true);
  await click("#cancel-vault-selection");
  await evaluate('app.editor.setValue("Newer external bytes.\\n")');
  await evaluate("app.reloadFromDisk()");
  await wait("!app.dirty");
  pass("Cancelling the native folder picker retains the selected vault and dirty buffer.");

  await click("#open-vault");
  await selectFolder("#browser-open-vault", otherVault);
  await wait('app.vault.getName()==="Vault B"&&!document.querySelector("#vault-dialog").open&&!app.changingVault');
  assert.equal(await evaluate('app.core.isEnabled("random-note")'), false);
  assert.deepEqual(await evaluate("Object.keys(app.plugins.plugins)"), []);
  assert.deepEqual(await evaluate("[...app.plugins.configuredPlugins]"), []);
  await click("#open-vault");
  await fill("#new-vault-name", "Created in browser");
  await selectFolder("#browser-create-vault", parent);
  await wait('app.vault.getName()==="Created in browser"&&!document.querySelector("#vault-dialog").open&&!app.changingVault');
  assert.ok((await readdir(parent)).includes("Created in browser"));
  pass("Vault switching isolates core settings, and Create vault creates a real subfolder in the selected parent.");
  await click("#open-settings");
  await click("#community-plugins-tab");
  assert.equal(await evaluate("app.plugins.isRestricted"), true);
  await click("#community-restricted-toggle");
  await wait("!app.plugins.isManaging&&!app.plugins.isRestricted");
  await click(".settings-close");
  await assert.rejects(readFile(join(parent, "Created in browser", ".obsidian", "community-plugins.json")), { code: "ENOENT" });
  pass("A new vault required explicit community-plugin opt-in, stored separately without creating or resetting an enabled-ID file.");

  if (!autosaveOnly && !attachmentsOnly) { await evaluate("app.markdownAutosave.setEnabled(false)"); }
  const readingRoot = await evaluate("app.vault.rootPath");
  const afterFeatureReload = async ({ cachedRoot } = {}) => {
    assert.deepEqual(await readArtifacts(), initialArtifacts, "Browser artifacts changed before reconnect; no mixed-build acceptance is valid.");
    if (cachedRoot) {
      assert.ok(cachedRoot.startsWith("github-vault:"), "An explicit cached GitHub root is required for cache-only reload acceptance.");
      await wait(`document.querySelector("main[data-ready=true]")&&window.app?.core&&app.vault.rootPath===${JSON.stringify(cachedRoot)}&&app.vault.readOnly&&app.workspace.layoutReady&&!app.changingVault&&!document.querySelector("#vault-dialog")?.open`, "fresh browser document restores the exact cached read-only vault");
      return;
    }
    await wait('document.querySelector("main[data-ready=true]")&&window.app?.core&&!app.changingVault&&document.querySelector("#vault-dialog")?.open', "fresh browser reconnect after feature reload");
    await click(`[data-recent-vault="${readingRoot}"]`);
    await wait(`app.vault.rootPath===${JSON.stringify(readingRoot)}&&app.workspace.layoutReady&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "feature IndexedDB handle reconnect");
  };
  await wait('Boolean(document.querySelector("#core-settings-host")?.dataset.coreVerificationSource)', "core verification build identity");
  report.sourceFingerprint = await evaluate('document.querySelector("#core-settings-host").dataset.coreVerificationSource');
  report.coreSettingsAvailability = await evaluate("app.core.states.map(({id,implemented,settingsSupport})=>({id,implemented,settingsSupport}))");
  if (!focused) {
    const directory = join(parent, "Created in browser"), evidence = join(root, ".runtime/evidence");
    report.coreChecks = [];
    const coreOriginalWorkspace = "{\"main\":{\"id\":\"core-original-main\",\"type\":\"split\",\"direction\":\"vertical\",\"children\":[{\"id\":\"core-original-tabs\",\"type\":\"tabs\",\"children\":[{\"id\":\"core-original-leaf\",\"type\":\"leaf\",\"state\":{\"type\":\"markdown\",\"state\":{\"file\":\"Welcome.md\",\"mode\":\"source\",\"source\":true}}}]}]},\"active\":\"core-original-leaf\",\"original\":\"core-verification-preserve\"}\n";
    await mkdir(join(directory, ".obsidian"), { recursive: true });
    await writeFile(join(directory, "Welcome.md"), "# Welcome\n\nCore verification in a real browser directory.\n");
    await writeFile(join(directory, ".obsidian/workspace.json"), coreOriginalWorkspace);
    await writeFile(join(directory, ".obsidian/community-plugins.json"), "[]\n");
    await writeFile(join(directory, ".obsidian/core-plugins.json"), JSON.stringify({ "zk-prefixer": false, "random-note": false, "future-core": { preserve: ["exact"] } }));
    for (const id of ["templates", "daily-notes", "zk-prefixer", "command-palette", "backlink"]) {
      await writeFile(join(directory, ".obsidian", id + ".json"), JSON.stringify({ futureSetting: { preserve: id }, ...(id === "command-palette" ? { pinned: ["workspace:save-file"] } : {}), ...(id === "backlink" ? { backlinkInDocument: true } : {}) }));
    }
    await command("Page.reload"); await afterFeatureReload();
    const closeSettings = async () => { if (await evaluate('document.querySelector("#settings-dialog").open')) await click(".settings-close"); };
    const createNote = async name => {
      await click("#new-note"); await wait('document.querySelector("#new-note-dialog").open');
      await fill("#new-note-name", name); await click("#create-note");
      await wait(`app.current?.file.path===${JSON.stringify(name.replaceAll("\\", "/"))}&&!document.querySelector("#new-note-dialog").open`);
    };
    const runCommand = async id => {
      const name = await evaluate(`app.commands.listCommands().find(command=>command.id===${JSON.stringify(id)})?.name`);
      assert.equal(typeof name, "string", "Registered core command: " + id);
      await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open');
      await command("Input.insertText", { text: name });
      await click(`[data-command-id="${id}"]`);
      await wait('!document.querySelector("#desktop-picker").open');
    };
    const fileEquals = async (path, expected) => {
      try { const bytes = await readFile(path); return Buffer.isBuffer(expected) ? bytes.equals(expected) : bytes.toString("utf8") === expected; }
      catch (error) { if (error.code === "ENOENT") return false; throw error; }
    };
    // Refocusing must preserve the keyboard selection already established by
    // the shared core scenarios. A pointer click would place a new caret.
    const focusCoreEditor = async () => evaluate('document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]").focus()');
    const { checkCoreFoundations } = await import("./core-foundation-scenarios.mjs");
    await checkCoreFoundations({ createNote, focusEditor: focusCoreEditor, command, waitExpression: wait, click, evaluate, report, runCommand, press, waitFor, fileEquals, vault: directory,
      waitForDesktopReady: afterFeatureReload, originalWorkspace: coreOriginalWorkspace, communityConfiguration: "[]\n", evidence, throughChooser: false });
    const { checkCoreModules } = await import("./core-scenarios.mjs");
    await checkCoreModules({ browser: true, targets: coreVerificationOnly ? coreVerificationTargets : undefined, evaluate, command, click, waitExpression: wait, waitFor, press, runCommand, fillInput: fill, createNote, focusEditor: focusCoreEditor, fileEquals,
      closeSettings, restartDesktop: async () => { await command("Page.reload"); await afterFeatureReload(); }, report, vault: directory,
      isolationVault: join(fixture, "Core isolation"),
      coreScreenshotPath: join(evidence, "core-plugins-web.png"),
      selectVault: async path => {
        await closeSettings(); await click("#open-vault"); await wait('document.querySelector("#vault-dialog").open');
        if (path === directory) await click(`[data-recent-vault="${readingRoot}"]`);
        else await selectFolder("#browser-open-vault", path);
        await wait(`app.vault.getName()===${JSON.stringify(path.split(/[\\/]/).at(-1))}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`);
      },
    });
  }
  if (appearanceOnly) {
    const checkAppearance = appearanceCatalogOnly ? (await import("./appearance-theme-scenarios.mjs")).checkAppearanceCatalog : appearanceWatchOnly ? (await import("./appearance-theme-scenarios.mjs")).checkAppearanceWatcher : appearanceThemesOnly ? (await import("./appearance-theme-scenarios.mjs")).checkAppearanceThemes : appearanceResourcesOnly ? (await import("./appearance-resource-scenarios.mjs")).checkAppearanceResources : (await import("./appearance-scenarios.mjs")).checkAppearance;
    await checkAppearance({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      readRequests: () => [...requests],
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Appearance document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "appearance-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (propertiesOnly) {
    const { checkProperties } = await import("./organization-scenarios.mjs");
    const restart = async prepare => {
      const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
      await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Properties document");
      if (prepare) { await prepare(); }
      await command("Page.navigate", { url }); await afterFeatureReload();
    };
    const tools = { directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, restart };
    await checkProperties({ ...tools, restart: async () => { await errorAudit.flush(evaluate); await command("Page.reload"); } });
    const { checkPropertiesPanes } = await import("./properties-pane-scenarios.mjs");
    await checkPropertiesPanes({ ...tools,
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "properties-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (discoveryPanesOnly) {
    const { checkDiscoveryPanes } = await import("./discovery-pane-scenarios.mjs");
    await checkDiscoveryPanes({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed discovery document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "discovery-panes-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (bookmarksOnly) {
    const { checkBookmarkWorkflows } = await import("./bookmark-scenarios.mjs");
    await checkBookmarkWorkflows({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Bookmarks document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url });
      },
      capture: async (mode = "graph-regression") => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "bookmarks-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (originalFloatingOnly) {
    const { checkOriginalFloatingImport } = await import("./original-floating-import-scenario.mjs");
    await checkOriginalFloatingImport({ directory: join(parent, "Created in browser"), evaluate, command, wait, mode: "browser", popupPolicy: "allowed",
      restart: async () => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed original floating document");
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      report: detail => { report.originalFloatingImport = detail; } });
    report.checks.push("The captured original floating workspace imports into a real separate window with its active note and exact source bytes retained.");
  } else if (nativeRecentsOnly) {
    const { checkNoNativeRecentsInBrowser } = await import("./native-recent-vault-scenarios.mjs");
    await checkNoNativeRecentsInBrowser({ evaluate, click, wait, report });
  } else if (githubIndexUiOnly) {
    const { checkGitHubIndexUi } = await import("./github-index-ui-scenarios.mjs");
    await checkGitHubIndexUi({ evaluate, click, wait, report, label: "web-index-ui" });
    await command("Page.captureScreenshot", { format: "png" }).then(shot => writeFile(join(root, ".runtime/evidence/github-index-ui-complete-web.png"), Buffer.from(shot.data, "base64")));
  } else if (backlinkPanesOnly) {
    const { checkBacklinkPanes } = await import("./backlink-pane-scenarios.mjs");
    await checkBacklinkPanes({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Backlink document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/backlink-panes-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (outlinePanesOnly) {
    const { checkOutlinePanes } = await import("./outline-pane-scenarios.mjs");
    await checkOutlinePanes({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Outline document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/outline-panes-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (searchPanesOnly) {
    const { checkSearchPanes } = await import("./search-pane-scenarios.mjs");
    await checkSearchPanes({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Search document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/search-panes-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (systemTrashOnly) {
    const { checkSystemTrashRefusal } = await import("./system-trash-scenarios.mjs");
    await checkSystemTrashRefusal({ directory: join(parent, "Created in browser"), evaluate, wait, report,
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/system-trash-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (folderOperationsOnly) {
    const { checkFolderOperations } = await import("./folder-operations-scenarios.mjs");
    await checkFolderOperations({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Folder operations document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/folder-operations-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (fileExplorerOnly) {
    const { checkFileExplorer } = await import("./file-explorer-scenarios.mjs");
    await checkFileExplorer({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Files document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/file-explorer-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (workspaceStartupOnly) {
    const { checkWorkspaceStartup } = await import("./workspace-startup-scenarios.mjs");
    await checkWorkspaceStartup({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, handleDialog, report,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed prior browser document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/workspace-startup-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (paneResizeOnly) {
    const { checkPaneResize } = await import("./pane-resize-scenarios.mjs");
    await checkPaneResize({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/pane-resize-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (diagnosticsOnly) {
    const { checkErrorLogging } = await import("./error-log-scenarios.mjs");
    await checkErrorLogging({ evaluate, click, report, command, downloadDirectory: join(root, ".runtime/evidence/diagnostics-web-download") });
  }
  if (groupsPopoutsOnly) {
    const { checkWorkspaceGroupsPopouts } = await import("./workspace-popout-scenarios.mjs");
    const { connectWebViewerTarget } = await import("./webviewer-scenarios.mjs");
    await checkWorkspaceGroupsPopouts({ directory: join(parent, "Created in browser"), evaluate, command, wait, report, afterReload: afterFeatureReload, mode: "browser", popupPolicy: popupBlockedControlOnly ? "blocked" : "allowed",
      restart: async () => { await command("Page.reload"); },
      targets: async () => (await fetch(endpoint + "/json/list")).json(), connect: connectWebViewerTarget, until: waitFor,
    });
  } else if (historyOnly) {
    const { checkWorkspaceHistory } = await import("./workspace-history-scenarios.mjs");
    await checkWorkspaceHistory({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async name => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence", "history-" + name + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (dockingOnly) {
    const { checkWorkspaceDocking } = await import("./workspace-docking-scenarios.mjs");
    await checkWorkspaceDocking({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async name => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence", "docking-" + name + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (tabMovementOnly) {
    const { checkTabMovement } = await import("./tab-movement-scenarios.mjs");
    await checkTabMovement({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async name => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence", "tabs-" + name + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  }
  if (coreStatusOnly) {
    const { checkCoreVerificationStatus } = await import("./core-verification-scenarios.mjs");
    await checkCoreVerificationStatus({ evaluate, click, wait, report,
      restart: async () => { await command("Page.reload"); await afterFeatureReload(); },
      capture: async () => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime/evidence/core-status-web.png"), Buffer.from(shot.data, "base64")); },
    });
  }
  if (attachmentsOnly) {
    report.scope = "shared-note-attachment-import";
    const { checkAttachments } = await import("./attachment-scenarios.mjs");
    await checkAttachments({ directory: join(parent,"Created in browser"), sourceDirectory: join(fixture,"Import sources"), evaluate, command, click, press, wait, report, browser: true,
      afterReload: afterFeatureReload,
      expectReloadBlocked: async () => { const before=log.split("WEB_UNSAVED_BLOCKED").length;await command("Page.reload");await waitFor(()=>log.split("WEB_UNSAVED_BLOCKED").length>before,"pending attachment import blocks clean-note reload"); },
      setClipboard: async (kind, value) => { await new Promise((resolve,reject)=>execFile("powershell.exe",["-NoProfile","-STA","-File",join(root,"tools/set-test-clipboard.ps1"),"-FixtureRoot",fixture,...(kind==="image"?["-ImagePath",value]:["-TextBase64",Buffer.from(value,"utf8").toString("base64")])],{windowsHide:true,timeout:15000},error=>error?reject(error):resolve())); },
      capture: async mode => { const screenshot=await command("Page.captureScreenshot",{format:"png"});await writeFile(join(root,".runtime/evidence","attachments-"+mode+"-browser.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (persistentDraftsOnly) {
    report.scope = persistentDraftsDiagnosticOnly ? "browser-non-markdown-draft-diagnostic-only" : "browser-persistent-markdown-draft-recovery";
    const { checkPersistentDrafts } = await import("./persistent-drafts-scenarios.mjs");
    const directory = join(parent, "Created in browser");
    let pageUrl = "";
    if (!persistentDraftsDiagnosticOnly) await checkPersistentDrafts({
      kind: "browser", directory, evaluate, command, click, press, wait, report,
      // Models the user choosing "Leave" on the unsaved-changes prompt, then reopening the page and reconnecting the folder handle.
      lose: async () => {
        pageUrl = await evaluate("location.href");
        await writeFile(join(profile, "persistent-drafts-leave.flag"), "leave");
        await command("Page.navigate", { url: "about:blank" });
        await wait('location.href==="about:blank"&&document.readyState==="complete"', "left the page with unsaved edits");
        return { forcedTermination: false, leftWithUnsavedEdits: true };
      },
      reconnect: async () => { await command("Page.navigate", { url: pageUrl }); await afterFeatureReload(); },
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "persistent-drafts-" + mode + "-browser.png"), Buffer.from(screenshot.data, "base64")); },
    });
    const { checkNonMarkdownDrafts } = await import("./persistent-drafts-scenarios-text.mjs");
    await checkNonMarkdownDrafts({
      kind: "browser", directory, evaluate, click, wait, report,
      lose: async () => {
        pageUrl = await evaluate("location.href");
        await writeFile(join(profile, "persistent-drafts-leave.flag"), "leave");
        await command("Page.navigate", { url: "about:blank" });
        await wait('location.href==="about:blank"&&document.readyState==="complete"', "left the page with unsaved non-Markdown edits");
        return { forcedTermination: false, leftWithUnsavedEdits: true };
      },
      reconnect: async () => { await command("Page.navigate", { url: pageUrl }); await afterFeatureReload(); },
      restart: async () => { await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()"); await command("Page.reload"); await afterFeatureReload(); },
    });
  }
  if (autosaveOnly) {
    report.scope = "safe-markdown-autosave";
    const { checkMarkdownAutosave } = await import("./autosave-scenarios.mjs");
    await checkMarkdownAutosave({
      directory: join(parent, "Created in browser"), targetDirectory: join(fixture, "Autosave target"), evaluate, command, click, press, wait, handleDialog, report, browser: true,
      afterReload: afterFeatureReload,
      selectVault: async path => {
        await click("#open-vault"); await wait('document.querySelector("#vault-dialog").open', "autosave browser chooser");
        const label = "Reconnect " + path.split(/[\\/]/).at(-1);
        const recent = await evaluate('Array.from(document.querySelectorAll("[data-recent-vault]")).find(button=>button.textContent.trim()==='+JSON.stringify(label)+')?.dataset.recentVault??null');
        if (recent) { await click('[data-recent-vault="'+recent+'"]'); } else { await selectFolder("#browser-open-vault", path); }
        await wait('app.vault.getName()==='+JSON.stringify(path.split(/[\\/]/).at(-1))+'&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "autosave browser selected vault");
      },
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "autosave-" + mode + "-browser.png"), Buffer.from(screenshot.data, "base64")); },
    });
  }
  if (communityInstallOnly) {
    const { checkCommunityInstallation } = await import("./community-install-scenarios.mjs");
    await checkCommunityInstallation({ directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, handleDialog, report, browser: true,
      afterReload: afterFeatureReload,
      capture: async phase => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", `community-install-${phase ?? "complete"}-browser.png`), Buffer.from(screenshot.data, "base64")); },
    });
    const { checkCommunityMarketplace } = await import("./community-marketplace-scenarios.mjs");
    await checkCommunityMarketplace({ directory: join(parent, "Created in browser"), targetDirectory: join(fixture, "Marketplace root target"), evaluate, command, click, press, wait, handleDialog, report, browser: true,
      afterReload: afterFeatureReload,
      selectVault: async path => {
        if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
        await click("#open-vault");
        const label = "Reconnect " + path.split(/[\\/]/).at(-1);
        const recent = await evaluate(`Array.from(document.querySelectorAll("[data-recent-vault]")).find(button=>button.textContent.trim()===${JSON.stringify(label)})?.dataset.recentVault??null`);
        if (recent) { await click(`[data-recent-vault="${recent}"]`); }
        else { await selectFolder("#browser-open-vault", path); }
        await wait(`app.vault.getName()===${JSON.stringify(path.split(/[\\/]/).at(-1))}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`);
      },
      capture: async phase => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", `community-marketplace-${phase}-browser.png`), Buffer.from(screenshot.data, "base64")); },
    });
  }
  if (communitySettingsOnly) {
    const { checkCommunitySettings } = await import("./community-settings-scenarios.mjs");
    await checkCommunitySettings({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, browser: true,
      targetDirectory: join(fixture, "Community isolated"),
      afterReload: afterFeatureReload,
      selectVault: async path => {
        if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
        await click("#open-vault");
        const label = "Reconnect " + path.split(/[\\/]/).at(-1);
        const recent = await evaluate(`Array.from(document.querySelectorAll("[data-recent-vault]")).find(button=>button.textContent.trim()===${JSON.stringify(label)})?.dataset.recentVault??null`);
        if (recent) { await click(`[data-recent-vault="${recent}"]`); }
        else { await selectFolder("#browser-open-vault", path); }
        await wait(`app.vault.getName()===${JSON.stringify(path.split(/[\\/]/).at(-1))}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`);
      },
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "community-settings-browser.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (workspaceTransitionOnly) {
    const { checkWorkspaceTransition } = await import("./workspace-transition-scenarios.mjs");
    await checkWorkspaceTransition({
      directory: join(parent, "Created in browser"), targetDirectory: join(fixture, "Transition target"), evaluate, command, click, wait, report, browser: true,
      afterReload: afterFeatureReload,
      selectVault: async path => {
        await click("#open-vault"); await wait('document.querySelector("#vault-dialog").open', "browser vault chooser ready");
        const label = "Reconnect " + path.replaceAll("\\", "/").split("/").at(-1);
        const recent = await evaluate(`Array.from(document.querySelectorAll("[data-recent-vault]")).find(button=>button.textContent.trim()===${JSON.stringify(label)})?.dataset.recentVault??null`);
        if (recent) { await click(`[data-recent-vault="${recent}"]`); }
        else { await selectFolder("#browser-open-vault", path); }
      },
      capture: async () => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "workspace-transition-browser.png"), Buffer.from(screenshot.data, "base64")); },
    });
  }
  if (templaterOnly) {
    const { checkTemplater } = await import("./templater-scenarios.mjs");
    await checkTemplater({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (additionalPluginsOnly) {
    const { checkAdditionalPlugins } = await import("./additional-plugin-scenarios.mjs");
    await checkAdditionalPlugins({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload, readConsoleErrors: () => [...consoleErrors], readRuntimeErrors: () => [...exceptions],
      capture: async phase => {
        if (phase !== undefined && !["board", "restored", "linter", "refactor", "quickadd-template", "quickadd-capture", "omnisearch", "linter-preview", "linter-bulk", "refactor-headings", "quickadd-macro", "templater-226", "kanban-editing", "iconize", "iconize-emoji"].includes(phase)) { throw new Error("Unknown additional-plugin screenshot phase."); }
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", `additional-plugins-browser${phase ? "-" + phase : ""}.png`), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (reportedPluginsOnly) {
    const { checkReportedPlugins } = await import("./reported-plugin-scenarios.mjs");
    await checkReportedPlugins({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload, readConsoleErrors: () => [...consoleErrors],
    });
  }
  if (excalidrawOnly) {
    const { checkExcalidraw } = await import("./excalidraw-scenarios.mjs");
    try {
      await checkExcalidraw({
        directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
        afterReload: afterFeatureReload,
      });
    } finally {
      assert.deepEqual(await readArtifacts(), initialArtifacts, "Excalidraw artifacts changed during the browser scenario.");
      report.artifactStability = "verified-through-scenario";
    }
  }
  if (workspacesOnly) {
    const { checkWorkspaceImport } = await import("./workspace-import-scenarios.mjs");
    await checkWorkspaceImport({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "workspaces-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (presentationStructureLayoutOnly) {
    const { checkPresentationStructureLayout } = await import("./presentation-structure-layout-scenarios.mjs");
    await checkPresentationStructureLayout({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","presentation-structure-layout-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (groupsCrossPropertiesArrangeOnly) {
    const { checkGroupsCrossPropertiesArrange } = await import("./groups-cross-properties-arrange-scenarios.mjs");
    await checkGroupsCrossPropertiesArrange({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","groups-cross-properties-arrange-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (summariesTransfersBackgroundsOnly) {
    const { checkSummariesTransfersBackgrounds } = await import("./summaries-transfers-backgrounds-scenarios.mjs");
    await checkSummariesTransfersBackgrounds({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","summaries-transfers-backgrounds-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (formulasFlowTablesOnly) {
    const { checkFormulasFlowTables } = await import("./formulas-flow-tables-scenarios.mjs");
    await checkFormulasFlowTables({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","formulas-flow-tables-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (filtersPositionFormattingOnly) {
    const { checkFiltersPositionFormatting } = await import("./filters-position-formatting-scenarios.mjs");
    await checkFiltersPositionFormatting({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","filters-position-formatting-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (configMultilineExportOnly) {
    const { checkConfigMultilineExport } = await import("./config-multiline-export-scenarios.mjs");
    await checkConfigMultilineExport({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","config-multiline-export-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (viewsScaleLinksOnly) {
    const { checkViewsScaleLinks } = await import("./views-scale-links-scenarios.mjs");
    await checkViewsScaleLinks({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","views-scale-links-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (navigationCreationOnly) {
    const { checkNavigationCreation } = await import("./navigation-creation-scenarios.mjs");
    await checkNavigationCreation({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","navigation-creation-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (editableDataOnly) {
    const { checkEditableData } = await import("./editable-data-scenarios.mjs");
    await checkEditableData({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","editable-data-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (visualAuthoringOnly) {
    const { checkVisualAuthoring } = await import("./visual-authoring-scenarios.mjs");
    await checkVisualAuthoring({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","visual-authoring-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (exportHandoffHistoryOnly) {
    const { checkExportHandoffHistory } = await import("./export-handoff-history-scenarios.mjs");
    await checkExportHandoffHistory({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","export-handoff-history-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (inlineStructureAudioOnly) {
    const { checkInlineStructureAudio } = await import("./inline-structure-audio-scenarios.mjs");
    await checkInlineStructureAudio({ host: "web", directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", {format:"png"}); await writeFile(join(root,".runtime","evidence","inline-structure-audio-"+mode+"-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (embedsTypedBulkOnly) {
    const { checkEmbedsTypedBulk } = await import("./embeds-typed-bulk-scenarios.mjs");
    await checkEmbedsTypedBulk({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","embeds-typed-bulk-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (cardsAudioBulkOnly) {
    const { checkCardsAudioBulk } = await import("./cards-audio-bulk-scenarios.mjs");
    await checkCardsAudioBulk({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","cards-audio-bulk-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (viewsInputsOnly) {
    const { checkViewsInputs } = await import("./views-inputs-scenarios.mjs");
    await checkViewsInputs({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","views-inputs-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (authoringControlsOnly) {
    const { checkAuthoringControls } = await import("./authoring-controls-scenarios.mjs");
    await checkAuthoringControls({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, handleDialog, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","authoring-controls-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (richEditingOnly) {
    const { checkRichEditing } = await import("./rich-editing-scenarios.mjs");
    await checkRichEditing({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","rich-editing-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (structuredRecoveryOnly) {
    const { checkStructuredRecovery } = await import("./structured-recovery-scenarios.mjs");
    await checkStructuredRecovery({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","structured-recovery-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (workflowControlsOnly) {
    const { checkWorkflowControls } = await import("./workflow-controls-scenarios.mjs");
    await checkWorkflowControls({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","workflow-controls-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (propertiesReadingOnly) {
    const { checkPropertiesReading } = await import("./properties-reading-scenarios.mjs");
    await checkPropertiesReading({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","properties-reading-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (authoringTransfersOnly) {
    const { checkAuthoringTransfers } = await import("./authoring-transfers-scenarios.mjs");
    await checkAuthoringTransfers({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","authoring-transfers-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (noteManagementOnly) {
    const { checkNoteManagement } = await import("./note-management-scenarios.mjs");
    await checkNoteManagement({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","note-management-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (authoringOrganizationOnly) {
    const { checkAuthoringOrganization } = await import("./authoring-organization-scenarios.mjs");
    await checkAuthoringOrganization({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","authoring-organization-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (linkAuthoringOnly) {
    const { checkLinkAuthoring } = await import("./link-authoring-scenarios.mjs");
    await checkLinkAuthoring({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","link-authoring-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (noteContinuityOnly) {
    const { checkNoteContinuity } = await import("./note-continuity-scenarios.mjs");
    await checkNoteContinuity({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","note-continuity-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (markdownPolishOnly) {
    const { checkMarkdownPolish } = await import("./markdown-polish-scenarios.mjs");
    await checkMarkdownPolish({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","markdown-polish-" + mode + "-web.png"),Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (markdownInteractionOnly) {
    const { checkMarkdownInteraction } = await import("./markdown-interaction-scenarios.mjs");
    await checkMarkdownInteraction({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","markdown-interaction-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (editorAssistanceOnly) {
    const { checkEditorAssistance } = await import("./editor-assistance-scenarios.mjs");
    await checkEditorAssistance({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","editor-assistance-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (noteNavigationOnly) {
    const { checkNoteNavigation } = await import("./note-navigation-scenarios.mjs");
    await checkNoteNavigation({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","note-navigation-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (readingToolsOnly) {
    const { checkReadingTools } = await import("./reading-tools-scenarios.mjs");
    await checkReadingTools({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","reading-tools-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (noteWorkflowsOnly) {
    const { checkNoteWorkflows } = await import("./note-workflows-scenarios.mjs");
    await checkNoteWorkflows({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","note-workflows-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (editorWorkflowsOnly) {
    const { checkEditorWorkflows } = await import("./editor-workflows-scenarios.mjs");
    await checkEditorWorkflows({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","editor-workflows-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (readingDiscoveryOnly) {
    const { checkReadingDiscovery } = await import("./reading-discovery-scenarios.mjs");
    await checkReadingDiscovery({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","reading-discovery-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (editorProductivityOnly) {
    const { checkEditorProductivity } = await import("./editor-productivity-scenarios.mjs");
    await checkEditorProductivity({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","editor-productivity-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (noteAuthoringOnly) {
    const { checkNoteAuthoring } = await import("./note-authoring-scenarios.mjs");
    await checkNoteAuthoring({ directory: join(parent,"Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload, evidenceDirectory: join(root,".runtime","evidence"),
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root,".runtime","evidence","note-authoring-" + mode + "-web.png"), Buffer.from(screenshot.data,"base64")); },
    });
  }
  if (editorImprovementsOnly) {
    const { checkEditorImprovements } = await import("./editor-improvements-scenarios.mjs");
    await checkEditorImprovements({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      capture: async mode => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "editor-improvements-" + mode + "-web.png"), Buffer.from(screenshot.data, "base64")); },
    });
  }
  if (editorChromeOnly || !focused) {
    const { checkEditorChrome, checkEditorModes } = await import("./editor-chrome-scenarios.mjs");
    const tools = {
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "editor-chrome-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    };
    await checkEditorChrome(tools);
    await checkEditorModes(tools);
  }
  if (modalLayoutOnly) {
    const { checkModalLayout } = await import("./modal-layout-scenarios.mjs");
    await checkModalLayout({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "modal-layout-" + mode + "-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (modalFocusOnly) {
    const { checkModalFocus } = await import("./modal-focus-scenarios.mjs");
    await checkModalFocus({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "modal-focus-" + mode + "-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
    report.desktopDraftRescueReviewAvailable = await evaluate('Boolean(app.commands.commands["app:review-markdown-rescue"]||document.querySelector("[data-draft-rescue-review],[data-rescue-startup-review],[data-rescue-inspection],[data-rescue-review-state]"))');
    assert.equal(report.desktopDraftRescueReviewAvailable, false, "Desktop profile review must not register in standalone WASM.");
  }
  if (suggestionsOnly || !focused && !coreVerificationOnly) {
    const { checkPluginSuggestions } = await import("./suggestion-scenarios.mjs");
    await checkPluginSuggestions({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "suggestions-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (tagsOnly) {
    const { checkTagRendering } = await import("./tag-scenarios.mjs");
    await checkTagRendering({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async mode => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", `tags-${mode}-web.png`), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (renderersOnly || !focused && !coreVerificationOnly) {
    const { checkMarkdownProcessors } = await import("./renderer-scenarios.mjs");
    await checkMarkdownProcessors({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (hotkeysSecretsOnly) {
    report.scope = "hotkeys-secrets-runtime";
    const { checkHotkeysSecrets } = await import("./hotkeys-secrets-scenarios.mjs");
    await checkHotkeysSecrets({
      host: "browser", directory: join(parent, "Created in browser"), targetDirectory: join(fixture, "Hotkeys foreign vault"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      selectVault: async path => {
        if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
        await click("#open-vault");
        const label = "Reconnect " + path.split(/[\\/]/).at(-1);
        const recent = await evaluate(`Array.from(document.querySelectorAll("[data-recent-vault]")).find(button=>button.textContent.trim()===${JSON.stringify(label)})?.dataset.recentVault??null`);
        if (recent) { await click(`[data-recent-vault="${recent}"]`); }
        else { await selectFolder("#browser-open-vault", path); }
        await wait(`app.vault.getName()===${JSON.stringify(path.split(/[\\/]/).at(-1))}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`);
      },
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "hotkeys-secrets-browser.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (configurationLifecycleOnly) {
    const { checkConfigurationLifecycle } = await import("./configuration-lifecycle-scenarios.mjs");
    await checkConfigurationLifecycle({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async phase => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", `configuration-lifecycle-web-${phase}.png`), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (menusOnly) {    const { checkMenuApi } = await import("./menu-scenarios.mjs");
    await checkMenuApi({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (recoveryOnly || !focused) {
    const { checkRecovery } = await import("./recovery-scenarios.mjs");
    await checkRecovery({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "recovery-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (basesOnly && !baseSummariesOnly || !focused && !coreVerificationOnly) {
    const { checkBases } = await import("./bases-scenarios.mjs");
    await checkBases({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "bases-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (baseSummariesOnly || !focused && !coreVerificationOnly) {
    const { checkBaseSummaries } = await import("./bases-summary-scenarios.mjs");
    await checkBaseSummaries({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "bases-summaries-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (composerOnly || !focused) {
    const { checkNoteComposer } = await import("./composer-scenarios.mjs");
    await checkNoteComposer({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "composer-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (formatsOnly || !focused) {
    const { checkFormatConversion } = await import("./format-scenarios.mjs");
    await checkFormatConversion({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "formats-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (!focused && !coreVerificationOnly) {
    const { checkReadingView } = await import("./reading-scenarios.mjs");
    await checkReadingView({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (outgoingPanesOnly) {
    const { checkOutgoingPanes } = await import("./outgoing-pane-scenarios.mjs");
    await checkOutgoingPanes({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, afterReload: afterFeatureReload,
      restart: async prepare => {
        const url = await evaluate("location.href"); await errorAudit.flush(evaluate);
        await command("Page.navigate", { url: "about:blank" }); await wait('location.href==="about:blank"&&document.readyState==="complete"', "closed Outgoing document");
        if (prepare) { await prepare(); }
        await command("Page.navigate", { url }); await afterFeatureReload();
      },
      capture: async mode => { const shot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "outgoing-panes-" + mode + "-web.png"), Buffer.from(shot.data, "base64")); },
    });
  } else if (outgoingOnly || !focused) {
    const { checkOutgoingLinks } = await import("./outgoing-scenarios.mjs");
    await checkOutgoingLinks({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "outgoing-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (discoveryOnly || !focused) {
    const { checkDiscovery } = await import("./discovery-scenarios.mjs");
    await checkDiscovery({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (!focused) {
    const { checkOrganization, checkNamedWorkspaces, checkProperties } = await import("./organization-scenarios.mjs");
    await checkOrganization({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
    await checkNamedWorkspaces({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
    await checkProperties({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
    const { checkFileOperations } = await import("./file-scenarios.mjs");
    await checkFileOperations({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (graphsOnly || !focused) {
    const { checkGraphs } = await import("./graph-scenarios.mjs");
    await checkGraphs({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "graphs-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (canvasesOnly || !focused) {
    const { checkCanvases } = await import("./canvas-scenarios.mjs");
    await checkCanvases({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, handleDialog, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "canvases-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (previewsOnly || !focused) {
    const { checkPagePreviews } = await import("./preview-scenarios.mjs");
    await checkPagePreviews({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "previews-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (editingToolsOnly || !focused) {
    const { checkEditingTools } = await import("./editing-tools-scenarios.mjs");
    await checkEditingTools({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async kind => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", `${kind}-web.png`), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (viewsOnly || !focused && !coreVerificationOnly) {
    const { checkViewHost } = await import("./view-scenarios.mjs");
    await checkViewHost({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "custom-views-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (viewersOnly) {
    const { checkViewers } = await import("./viewer-scenarios.mjs");
    await checkViewers({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report, browser: true,
      afterReload: afterFeatureReload,
      capture: async name => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", "viewers-" + name + "-browser.png"), Buffer.from(screenshot.data, "base64")); },
    });
  }
  if (viewerProofsOnly) {
    const { checkViewerProofs } = await import("./viewer-proof-scenarios.mjs");
    await checkViewerProofs({
      directory: join(parent, "Created in browser"), evaluate, command, wait, report, afterReload: afterFeatureReload,
      capture: async name => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, ".runtime", "evidence", name + "-browser.png"), Buffer.from(screenshot.data, "base64")); },
    });
  }
  if (mermaidOnly || !focused && !coreVerificationOnly) {
    const { checkMermaid } = await import("./mermaid-scenarios.mjs");
    await checkMermaid({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "mermaid-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (mathEmbedsOnly || !focused && !coreVerificationOnly) {
    const { checkMathEmbeds } = await import("./math-embed-scenarios.mjs");
    await checkMathEmbeds({
      directory: join(parent, "Created in browser"), evaluate, command, wait, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "math-embeds-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (audioOnly || !focused) {
    const { checkAudio } = await import("./audio-scenarios.mjs");
    await checkAudio({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, handleDialog, report,
      afterReload: afterFeatureReload,
      capture: async () => {
        const screenshot = await command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(root, ".runtime", "evidence", "audio-web.png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }

  assert.equal(requests.some(url => new URL(url).pathname.startsWith("/api/")), false);
  assert.equal(requests.some(url => url.includes("example.invalid")), false);
  assert.deepEqual(missingAssets, []);
  assert.deepEqual(exceptions, []);
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(root, ".runtime", "evidence", reportName + ".png"), Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(await readArtifacts(), initialArtifacts, "Browser artifacts changed during the scenario; no mixed-build acceptance is valid.");
  report.artifactStability = "verified-through-scenario";
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  report.javascriptDialogAtFailure = currentDialog;
  report.recentCommands = [...recentCommands];
  report.exceptions = [...exceptions];
  report.browserExitCode = child?.exitCode;
  report.browserSignal = child?.signalCode;
  report.browserLog = log.slice(-12000);
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      if (currentDialog !== null) {
        report.pendingDialog = currentDialog;
        await command("Page.handleJavaScriptDialog", { accept: false });
      }
      report.search = await evaluate('(()=>{const status=document.querySelector("[data-search-status]");return{query:document.querySelector("[data-search-query]")?.value,status:status?.textContent,state:status?{...status.dataset}:null,files:[...document.querySelectorAll("[data-search-file]")].map(element=>element.dataset.searchFile)}})()');
      if (basesOnly) { report.bases = await evaluate('app.workspace.getLeavesOfType("bases").map(leaf=>({id:leaf.id,loaded:leaf.view.isLoaded,file:leaf.view.file?.path,search:leaf.view.search,page:leaf.view.page,serial:leaf.view.serial,worker:Boolean(leaf.view.worker),debounce:Boolean(leaf.view.debounce),dirty:leaf.view.isDirty,saving:leaf.view.isSaving,error:leaf.view.error?.textContent,status:leaf.view.status?.textContent,input:leaf.view.searchInput?.value}))'); }
      report.visibleError = await evaluate('(()=>{const error=document.querySelector(".error-banner")??document.querySelector("#blazor-error-ui");return error?.getBoundingClientRect().height?error.textContent:null})()');
      report.pageState = await evaluate('({busy:document.querySelector("main")?.getAttribute("aria-busy"),picker:document.querySelector("#vault-dialog")?.open,clientErrors:document.querySelector("#client-errors")?.textContent,coreBusy:window.app?.core?.busy,coreError:document.querySelector("#core-settings-error")?.textContent,vaultName:window.app?.vault?.getName(),root:window.app?.vault?.rootPath,hasFocus:document.hasFocus(),visibility:document.visibilityState,path:window.app?.current?.file.path,mode:window.app?.workspace?.activeLeaf?.view.getMode?.(),readingClicks:globalThis.readingClicks,pickerTrace:globalThis.pickerTrace,plugins:[...document.querySelectorAll(".plugin-card")].map(element=>({id:element.dataset.pluginId,loaded:element.dataset.loaded,error:element.querySelector(".plugin-error")?.textContent})),loadedPluginIds:Object.keys(window.app?.plugins?.plugins??{})})');
      if (templaterOnly) {
        report.templaterDiagnostics = await evaluate('({notices:globalThis.templaterNoticeHistory,activeNotices:[...document.querySelectorAll(".notice")].map(node=>node.textContent),buffers:app.workspace.leaves().filter(leaf=>leaf.view.editor).map(leaf=>({path:leaf.view.file?.path,text:leaf.view.editor.getValue(),dirty:leaf.view.isDirty}))})');
      }
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(root, ".runtime", "evidence", reportName + "-failure.png"), Buffer.from(screenshot.data, "base64"));
    } catch (capture) {
      report.captureError = capture.message;
    }
  }
  console.error(error, "\n", report.visibleError ?? "", "\n", log.slice(-12000));
  process.exitCode = 1;
} finally {
  if (tabMovementOnly || coreVerificationOnly || coreStatusOnly || reportedPluginsOnly || excalidrawOnly || additionalPluginsOnly) { report.consoleErrors = [...consoleErrors]; }
  report.exceptions = [...exceptions];
  if (socket?.readyState === WebSocket.OPEN) {
    try { await errorAudit.flush(evaluate); } catch (error) { report.status = "failed"; report.error ??= error.stack; }
  }
  let quitResult;
  if (child && child.exitCode === null) {
    quitResult = await acknowledgedQuit({
      drain: () => evaluate(fixtureDrainScript()).catch(error => ({ drained: false, error: error.message })),
      sendRequest: () => command("Runtime.evaluate", { expression: `console.debug(${JSON.stringify(quitRequest(quitNonce))})` }),
      acked: quitAcknowledged,
      exited,
      kill: async () => { if (child.exitCode === null) { child.kill(); await exited; } },
      deadlineMs: 5000,
    });
  }
  report.browserShutdown = { exitCode: child?.exitCode ?? null, signal: child?.signalCode ?? null, forced: quitResult?.forced ?? false,
    quit: quitResult ?? null, rejected: /WEB_QUIT_REJECTED \S+/.exec(stdoutLog)?.[0] ?? null, hostLog: log.slice(-4000) };
  try {
    assertCleanExit(report.browserShutdown, reportName);
    assert.ok(quitResult?.committed && quitResult.acknowledged && quitResult.exited && !report.browserShutdown.rejected, "The browser must drain and acknowledge its own nonce before exiting.");
  }
  catch (error) { report.status = "failed"; report.error ??= error.stack; }
  await errorAudit.drain(socket);
  socket?.close();
  report.exceptions = [...exceptions];
  if (exceptions.length) { report.status = "failed"; report.error ??= "The browser emitted an uncaught exception, including final teardown; see exceptions."; }
  errorAudit.finish(report);
  if (report.status !== "passed") { process.exitCode = 1; }
  if (host) {
    await host.close();
  }
  report.completedAt = new Date().toISOString();
  await writeFile(join(root, ".runtime", "evidence", reportName + ".json"), JSON.stringify(report, null, 2));
  await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
