import { createErrorLogAudit } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { checkWebViewer, connectWebViewerTarget, createWebViewerPages } from "./webviewer-scenarios.mjs";
import { checkWebHistory } from "./web-history-scenarios.mjs";
import { checkWebReader } from "./web-reader-scenarios.mjs";
import { checkWebClip } from "./web-clip-scenarios.mjs";
import { checkWebZoom } from "./web-zoom-scenarios.mjs";
import { checkWebAdblock } from "./web-adblock-scenarios.mjs";
import { checkWebReaderAppearance } from "./web-reader-appearance-scenarios.mjs";
import { checkWebReaderProgress } from "./web-reader-progress-scenarios.mjs";
import { checkWebHistoryMenu } from "./web-history-menu-scenarios.mjs";
import { checkClipLists } from "./web-clip-lists-scenarios.mjs";
import { checkClipTables } from "./web-clip-tables-scenarios.mjs";
import { checkClipSelection } from "./web-clip-selection-scenarios.mjs";
import { checkClipProperties } from "./web-clip-properties-scenarios.mjs";
import { checkClipDefaults } from "./web-clip-defaults-scenarios.mjs";
import { checkReaderTypography } from "./web-reader-typography-scenarios.mjs";
import { checkReaderSelection } from "./web-reader-selection-scenarios.mjs";
import { checkReaderParagraphSpacing } from "./web-reader-paragraph-spacing-scenarios.mjs";
import { checkReaderLetterSpacing } from "./web-reader-letter-spacing-scenarios.mjs";
import { checkReaderCustomWidth } from "./web-reader-custom-width-scenarios.mjs";
import { checkReaderCustomFont } from "./web-reader-custom-font-scenarios.mjs";
import { checkReaderProgressHistory } from "./web-reader-progress-history-scenarios.mjs";
import { checkHistoryFilter } from "./web-history-filter-scenarios.mjs";
import { checkHistoryDateRange } from "./web-history-date-range-scenarios.mjs";
import { checkHistorySelection } from "./web-history-selection-scenarios.mjs";
import { checkHistoryUndo } from "./web-history-undo-scenarios.mjs";
import { checkHistoryRedo } from "./web-history-redo-scenarios.mjs";
import { checkHistoryArchive } from "./web-history-archive-scenarios.mjs";
import { checkHistorySelectedArchive } from "./web-history-selected-archive-scenarios.mjs";
import { checkHistoryOrder } from "./web-history-order-scenarios.mjs";
import { checkHistoryRetention } from "./web-history-retention-scenarios.mjs";
import { checkHistoryLimit } from "./web-history-limit-scenarios.mjs";
import { checkWebFavicons } from "./web-favicon-scenarios.mjs";
import { checkSiteZoom } from "./web-site-zoom-scenarios.mjs";
import { checkPageClip } from "./web-page-clip-scenarios.mjs";
import { checkHistoryOpen } from "./web-history-open-scenarios.mjs";
import { checkHistoryFieldSort } from "./web-history-field-sort-scenarios.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = join(root, ".runtime", "evidence");
const adblockOnly = process.argv.includes("--adblock-only");
const appearanceOnly = process.argv.includes("--reader-appearance-only");
const progressOnly = process.argv.includes("--reader-progress-only");
const fieldSortOnly = process.argv.includes("--history-field-sort-only");
const fieldSortMode = process.argv.includes("--history-field-sort") || fieldSortOnly;
const historyOpenOnly = process.argv.includes("--history-open-only");
const historyOpenMode = process.argv.includes("--history-open") || historyOpenOnly || (fieldSortMode && !fieldSortOnly);
const pageClipOnly = process.argv.includes("--clip-page-only");
const pageClipMode = process.argv.includes("--clip-page") || pageClipOnly || (historyOpenMode && !historyOpenOnly);
const siteZoomOnly = process.argv.includes("--site-zoom-only");
const siteZoomMode = process.argv.includes("--site-zoom") || siteZoomOnly || (pageClipMode && !pageClipOnly);
const faviconOnly = process.argv.includes("--favicons-only");
const faviconMode = process.argv.includes("--favicons") || faviconOnly || (siteZoomMode && !siteZoomOnly);
const limitOnly = process.argv.includes("--history-limit-only");
const limitMode = process.argv.includes("--history-limit") || limitOnly || (faviconMode && !faviconOnly);
const retentionOnly = process.argv.includes("--history-retention-only");
const retentionMode = process.argv.includes("--history-retention") || retentionOnly || (limitMode && !limitOnly);
const orderOnly = process.argv.includes("--history-order-only");
const orderMode = process.argv.includes("--history-order") || orderOnly || (retentionMode && !retentionOnly);
const selectedArchiveOnly = process.argv.includes("--history-selected-archive-only");
const selectedArchiveMode = process.argv.includes("--history-selected-archive") || selectedArchiveOnly || (orderMode && !orderOnly);
const historyArchiveOnly = process.argv.includes("--history-archive-only");
const historyArchiveMode = process.argv.includes("--history-archive") || historyArchiveOnly || (selectedArchiveMode && !selectedArchiveOnly);
const historyRedoOnly = process.argv.includes("--history-redo-only");
const historyRedoMode = process.argv.includes("--history-redo") || historyRedoOnly || (historyArchiveMode && !historyArchiveOnly);
const historyUndoOnly = process.argv.includes("--history-undo-only");
const historyUndoMode = process.argv.includes("--history-undo") || historyUndoOnly || (historyRedoMode && !historyRedoOnly);
const selectionHistoryOnly = process.argv.includes("--history-selection-only");
const selectionHistoryMode = process.argv.includes("--history-selection") || selectionHistoryOnly || (historyUndoMode && !historyUndoOnly);
const dateRangeOnly = process.argv.includes("--history-date-range-only");
const dateRangeMode = process.argv.includes("--history-date-range") || dateRangeOnly || (selectionHistoryMode && !selectionHistoryOnly);
const filterOnly = process.argv.includes("--history-filter-only");
const filterMode = process.argv.includes("--history-filter") || filterOnly || (dateRangeMode && !dateRangeOnly);
const progressHistoryOnly = process.argv.includes("--reader-progress-history-only");
const progressHistoryMode = process.argv.includes("--reader-progress-history") || progressHistoryOnly || (filterMode && !filterOnly);
const customFontOnly = process.argv.includes("--reader-custom-font-only");
const customFontMode = process.argv.includes("--reader-custom-font") || customFontOnly || (progressHistoryMode && !progressHistoryOnly);
const customWidthOnly = process.argv.includes("--reader-custom-width-only");
const customWidthMode = process.argv.includes("--reader-custom-width") || customWidthOnly || (customFontMode && !customFontOnly);
const letterOnly = process.argv.includes("--reader-letter-spacing-only");
const letterMode = process.argv.includes("--reader-letter-spacing") || letterOnly || (customWidthMode && !customWidthOnly);
const paragraphOnly = process.argv.includes("--reader-paragraph-spacing-only");
const paragraphMode = process.argv.includes("--reader-paragraph-spacing") || paragraphOnly || (letterMode && !letterOnly);
const readerSelectionOnly = process.argv.includes("--reader-selection-only");
const readerSelectionMode = process.argv.includes("--reader-selection") || readerSelectionOnly || (paragraphMode && !paragraphOnly);
const typographyOnly = process.argv.includes("--reader-typography-only");
const typographyMode = process.argv.includes("--reader-typography") || typographyOnly || (readerSelectionMode && !readerSelectionOnly);
const defaultsOnly = process.argv.includes("--clip-defaults-only");
const defaultsMode = process.argv.includes("--clip-defaults") || defaultsOnly || (typographyMode && !typographyOnly);
const propertiesOnly = process.argv.includes("--clip-properties-only");
const propertiesMode = process.argv.includes("--clip-properties") || propertiesOnly || (defaultsMode && !defaultsOnly);
const selectionOnly = process.argv.includes("--clip-selection-only");
const selectionMode = process.argv.includes("--clip-selection") || selectionOnly || (propertiesMode && !propertiesOnly);
const tablesOnly = process.argv.includes("--clip-tables-only");
const tablesMode = process.argv.includes("--clip-tables") || tablesOnly || (selectionMode && !selectionOnly);
const listsOnly = process.argv.includes("--clip-lists-only");
const listsMode = process.argv.includes("--clip-lists") || listsOnly || (tablesMode && !tablesOnly);
const copyOnly = process.argv.includes("--history-copy-only");
const copyMode = process.argv.includes("--history-copy") || copyOnly || (listsMode && !listsOnly);
const menuOnly = process.argv.includes("--history-menu-only") || copyOnly;
const menuMode = process.argv.includes("--history-menu") || menuOnly || copyMode;
const progressMode = process.argv.includes("--reader-progress") || progressOnly || (menuMode && !menuOnly);
const appearanceMode = process.argv.includes("--reader-appearance") || appearanceOnly || (progressMode && !progressOnly);
const transitionMode = process.argv.includes("--transition");
const adblockMode = process.argv.includes("--adblock") || adblockOnly || (appearanceMode && !appearanceOnly);
const zoomMode = process.argv.includes("--zoom") || adblockMode;
const clipMode = process.argv.includes("--clip") || zoomMode;
const readerMode = process.argv.includes("--reader") || clipMode;
const historyMode = process.argv.includes("--history") || readerMode;
const reportName = fieldSortMode ? "web-history-field-sort" + (fieldSortOnly ? "-only" : "") : historyOpenMode ? "web-history-open" + (historyOpenOnly ? "-only" : "") : pageClipMode ? "web-clip-page" + (pageClipOnly ? "-only" : "") : siteZoomMode ? "web-site-zoom" + (siteZoomOnly ? "-only" : "") : faviconMode ? "web-favicons" + (faviconOnly ? "-only" : "") : limitMode ? "web-history-limit" + (limitOnly ? "-only" : "") : retentionMode ? "web-history-retention" + (retentionOnly ? "-only" : "") : orderMode ? "web-history-order" + (orderOnly ? "-only" : "") : selectedArchiveMode ? "web-history-selected-archive" + (selectedArchiveOnly ? "-only" : "") : historyArchiveMode ? "web-history-archive" + (historyArchiveOnly ? "-only" : "") : historyRedoMode ? "web-history-redo" + (historyRedoOnly ? "-only" : "") : historyUndoMode ? "web-history-undo" + (historyUndoOnly ? "-only" : "") : selectionHistoryMode ? "web-history-selection" + (selectionHistoryOnly ? "-only" : "") : dateRangeMode ? "web-history-date-range" + (dateRangeOnly ? "-only" : "") : filterMode ? "web-history-filter" + (filterOnly ? "-only" : "") : progressHistoryMode ? "web-reader-progress-history" + (progressHistoryOnly ? "-only" : "") : customFontMode ? "web-reader-custom-font" + (customFontOnly ? "-only" : "") : customWidthMode ? "web-reader-custom-width" + (customWidthOnly ? "-only" : "") : letterMode ? "web-reader-letter-spacing" + (letterOnly ? "-only" : "") : paragraphMode ? "web-reader-paragraph-spacing" + (paragraphOnly ? "-only" : "") : readerSelectionMode ? "web-reader-selection" + (readerSelectionOnly ? "-only" : "") : typographyMode ? "web-reader-typography" + (typographyOnly ? "-only" : "") : defaultsMode ? "web-clip-defaults" + (defaultsOnly ? "-only" : "") : propertiesMode ? "web-clip-properties" + (propertiesOnly ? "-only" : "") : selectionMode ? "web-clip-selection" + (selectionOnly ? "-only" : "") : tablesMode ? "web-clip-tables" + (tablesOnly ? "-only" : "") : listsMode ? "web-clip-lists" + (listsOnly ? "-only" : "") : copyMode ? "web-history-copy" + (copyOnly ? "-only" : "") : menuMode ? "web-history-menu" + (menuOnly ? "-only" : "") : progressMode ? "web-reader-progress" + (progressOnly ? "-only" : "") : appearanceMode ? "web-reader-appearance" + (appearanceOnly ? "-only" : "") : transitionMode ? "workspace-transition-webviewer" + (adblockOnly ? "-only" : "") : adblockOnly ? "web-adblock-only" : adblockMode ? "web-adblock" : zoomMode ? "web-zoom" : clipMode ? "web-clip" : readerMode ? "web-reader" : historyMode ? "web-history" : "webviewer";
const capturePrefix = appearanceMode || progressMode || menuMode || listsMode || tablesMode || selectionMode || propertiesMode || defaultsMode || typographyMode || readerSelectionMode || paragraphMode || letterMode || customWidthMode || customFontMode || progressHistoryMode || filterMode || dateRangeMode || selectionHistoryMode || historyUndoMode || historyRedoMode || historyArchiveMode || selectedArchiveMode || orderMode || retentionMode || limitMode || faviconMode || siteZoomMode || pageClipMode || historyOpenMode || fieldSortMode ? reportName + "-" : "";
const backgroundMode = zoomMode || appearanceMode || progressMode || menuMode || listsMode || tablesMode || selectionMode || propertiesMode || defaultsMode || typographyMode || readerSelectionMode || paragraphMode || letterMode || customWidthMode || customFontMode || progressHistoryMode || filterMode || dateRangeMode || selectionHistoryMode || historyUndoMode || historyRedoMode || historyArchiveMode || selectedArchiveMode || orderMode || retentionMode || limitMode || faviconMode || siteZoomMode || pageClipMode || historyOpenMode || fieldSortMode;
await mkdir(evidence, { recursive: true });
const errorAudit = createErrorLogAudit(evidence, reportName);
const errorRun = "--error-log-run=" + crypto.randomUUID();
const vault = await mkdtemp(join(root, ".runtime", "webviewer-vault-"));
await mkdir(join(vault, ".obsidian"));
const contract = JSON.parse(await readFile(join(root, "shared", "core-plugins.json"), "utf8"));
await writeFile(join(vault, ".obsidian", "core-plugins.json"), JSON.stringify({ ...Object.fromEntries(contract.plugins.map(plugin => [plugin.id, ["command-palette", "file-explorer"].includes(plugin.id)])), future: { keep: true } }));
const originalWorkspace = '{"main":{"type":"preserved-original"},"future":{"keep":true}}\n';
await writeFile(join(vault, ".obsidian", "workspace.json"), originalWorkspace);
await writeFile(join(vault, ".obsidian", "webviewer.json"), '{"openExternalURLs":true,"enableAdblocking":false,"future":{"keep":"settings"}}');
let localEndpoint = "";
const pages = await createWebViewerPages(() => localEndpoint);
const alternatePages = zoomMode || siteZoomMode ? await createWebViewerPages(() => localEndpoint) : null;
const { origin, requests } = pages;
await writeFile(join(vault, "Welcome.md"), `# Viewer link\n\n[Open fixture](${origin}/one)\n`);
const profile = reportName + "-" + Date.now();
let child;
let exited;
let host;
let endpoint;
let log = "";
const connections = [];
const report = { status: "failed", scope: adblockMode ? "desktop-web-ad-blocking" : zoomMode ? "desktop-web-zoom" : clipMode ? "desktop-web-clipping" : readerMode ? "desktop-web-reader" : historyMode ? "desktop-web-history" : "desktop-webviewer", startedAt: new Date().toISOString(), vault, checks: [], processes: [] };
if (transitionMode) { report.scope = "desktop-webviewer-vault-transition-renewal"; }
if (appearanceMode) { report.scope = "desktop-web-reader-appearance" + (appearanceOnly ? "-only" : ""); }
if (progressMode) { report.scope = "desktop-web-reader-progress" + (progressOnly ? "-only" : ""); }
if (menuMode) { report.scope = "desktop-web-history-visit-menu" + (menuOnly ? "-only" : ""); }
if (copyMode) {
  report.scope = "desktop-web-history-copy-address" + (copyOnly ? "-only" : "");
  report.clipboard = "Bounded write-only API fixture in real desktop menu workflows; system clipboard and native permission prompts are not accessed.";
}
if (listsMode) { report.scope = "desktop-web-clip-ordered-list-numbering" + (listsOnly ? "-only" : ""); }
if (tablesMode) { report.scope = "desktop-web-clip-merged-cell-tables" + (tablesOnly ? "-only" : ""); }
if (selectionMode) { report.scope = "desktop-web-clip-selected-text" + (selectionOnly ? "-only" : ""); }
if (propertiesMode) { report.scope = "desktop-web-clip-note-properties" + (propertiesOnly ? "-only" : ""); }
if (defaultsMode) { report.scope = "desktop-web-clip-property-defaults" + (defaultsOnly ? "-only" : ""); }
if (typographyMode) { report.scope = "desktop-web-reader-typography" + (typographyOnly ? "-only" : ""); }
if (readerSelectionMode) { report.scope = "desktop-web-reader-selected-text" + (readerSelectionOnly ? "-only" : ""); }
if (paragraphMode) { report.scope = "desktop-web-reader-paragraph-spacing" + (paragraphOnly ? "-only" : ""); }
if (letterMode) { report.scope = "desktop-web-reader-letter-spacing" + (letterOnly ? "-only" : ""); }
if (customWidthMode) { report.scope = "desktop-web-reader-custom-width" + (customWidthOnly ? "-only" : ""); }
if (customFontMode) { report.scope = "desktop-web-reader-custom-font" + (customFontOnly ? "-only" : ""); }
if (progressHistoryMode) { report.scope = "desktop-web-reader-progress-history" + (progressHistoryOnly ? "-only" : ""); }
if (filterMode) { report.scope = "desktop-web-history-matching-removal" + (filterOnly ? "-only" : ""); }
if (dateRangeMode) { report.scope = "desktop-web-history-date-range" + (dateRangeOnly ? "-only" : ""); report.dateControls = "Native date input values/input events exercise real filtering and saving; the operating-system calendar popover is not driven."; }
if (backgroundMode) { report.inputEnvironment = "Windows occlusion and renderer/timer background throttling disabled in disposable UI processes; production launch is unchanged."; }
if (selectionHistoryMode) { report.scope = "desktop-web-history-selected-removal" + (selectionHistoryOnly ? "-only" : ""); report.selectionControls = "Real pointer/Space checkbox controls and review buttons. Date values/input events exercise production filtering; the calendar popover is not driven."; }
if (historyUndoMode) { report.scope = "desktop-web-history-removal-undo" + (historyUndoOnly ? "-only" : ""); report.undoControls = "Real buttons/context menu/checkboxes and native committed visit; date values/input events use the bounded fixture and the calendar popover is not driven."; }
if (historyRedoMode) { report.scope = "desktop-web-history-removal-redo" + (historyRedoOnly ? "-only" : ""); report.redoControls = "Real reviewed buttons/context menu/checkboxes and native committed visit; date values/input events use the bounded fixture and the calendar popover is not driven."; }
if (historyArchiveMode) { report.scope = "desktop-web-history-markdown-archive" + (historyArchiveOnly ? "-only" : ""); report.archiveControls = "Actual preview/Save/Cancel/Escape, filename input, Reading and vault-dialog confirmation; date values/events and queued-owner/lifecycle entry use bounded fixtures. The calendar popover is not driven."; }
if (selectedArchiveMode) { report.scope = "desktop-web-history-selected-markdown-archive" + (selectedArchiveOnly ? "-only" : ""); report.selectedArchiveControls = "Actual pointer/Space checkboxes, selected/shown preview, path, Save/Cancel/Escape, Reading and vault-dialog confirmation; date values/events and queued-owner/lifecycle entry use bounded fixtures. The calendar popover is not driven."; }
if (orderMode) { report.scope = "desktop-web-history-chronological-order" + (orderOnly ? "-only" : ""); report.orderControls = "Actual pointer/keyboard sort select, row controls, checked/shown archives, Reading and vault-dialog confirmation; date values/events and queued-owner/lifecycle entry use bounded fixtures. The calendar popover is not driven."; }
if (retentionMode) { report.scope = "desktop-web-history-age-retention" + (retentionOnly ? "-only" : ""); report.retentionControls = "Actual pointer/keyboard retention select, committed native visits, pause/duplicate handling, inverse controls, archive saving/Reading, process restarts and vault-dialog confirmation. Mixed-age source data and queued-owner/lifecycle entry use bounded fixtures; exact rolling cutoff boundaries are covered by unit tests."; }
const pass = value => { report.checks.push(value); console.log("PASS " + value); };
if (limitMode) { report.scope = "desktop-web-history-visit-limit" + (limitOnly ? "-only" : ""); report.limitControls = "Actual Visit limit dialog, numeric input, Save/Cancel/Escape/Enter, committed native recording, inverse/archive controls, Reading, process restarts and vault-dialog confirmation. Mixed-age source data and queued-owner/lifecycle entry use bounded fixtures."; }

if (faviconMode) { report.scope = "desktop-web-history-favicons" + (faviconOnly ? "-only" : ""); report.faviconControls = "Actual recorded native PNG/JPEG/Windows ICO visits and decoded history pixels, Clear icons, selection/review/menu/inverse/archive controls, process restarts and vault-dialog confirmation. Mixed cache data and queued/lifecycle metadata entry use bounded fixtures; history rendering uses cached PNG data without site requests."; }

if (siteZoomMode) { report.scope = "desktop-web-site-zoom" + (siteZoomOnly ? "-only" : ""); report.siteZoomControls = "Actual Site zoom pointer/keyboard menus, native page scaling/navigation, Reader compatibility, enabled/disabled restarts and vault-dialog confirmation. Mixed profile data and obsolete review/native entry use bounded fixtures; ordinary per-tab zoom remains independent until an explicit origin preference applies."; }

if (pageClipMode) { report.scope = "desktop-web-full-page-markdown" + (pageClipOnly ? "-only" : ""); report.pageClipControls = "Actual Save page toolbar/owned command, source/Reader distinction, short/unsupported pages, note properties, reviewed exact save/Reading, collision/navigation refusal, full enabled/disabled restarts and vault-dialog confirmation. Mixed source bounds and obsolete/lifecycle callbacks use bounded fixtures; no scrolling or resource fetching is performed by capture."; }

if (historyOpenMode) { report.scope = "desktop-web-history-open-selected" + (historyOpenOnly ? "-only" : ""); report.historyOpenControls = "Actual pointer/Space selection, keyboard order, reviewed new-tab confirmation, paused/recorded native navigation, pinned/independent panes, enabled/disabled restarts and actual vault-dialog confirmation. Queue round trips, obsolete/lifecycle callbacks and partial tab-creation failure use bounded fixtures; page loading is independent of tab-open acknowledgement."; }

if (fieldSortMode) { report.scope = "desktop-web-history-title-address-order" + (fieldSortOnly ? "-only" : ""); report.fieldSortControls = "Actual keyboard six-choice Order, pointer/Space selection, shown/selected note previews/saves/Reading, ordered native tabs, independent panes, enabled/disabled restarts and actual vault-dialog confirmation. Date values/events, queued order round trips and obsolete lifecycle callbacks use bounded fixtures; no OS calendar popover or locale/natural ranking is claimed."; }

const artifactPaths = ["desktop/main.cjs", "desktop/web-viewer.cjs", "desktop/web-viewer-policy.cjs", "client/web-viewer.ts", "client/web-address.ts", "client/webviewer-bridge.ts", "tools/webviewer-smoke.mjs", "tools/webviewer-scenarios.mjs", "src/RonSijm.Slopsidian/bin/Debug/net10.0/RonSijm.Slopsidian.dll", "src/RonSijm.Slopsidian/wwwroot/js/editor-host.js", "src/RonSijm.Slopsidian/wwwroot/js/editor-host.css", "src/RonSijm.Slopsidian/wwwroot/js/codemirror-license.txt", "src/RonSijm.Slopsidian/wwwroot/js/hypermd-license.txt", "src/RonSijm.Slopsidian/wwwroot/app.css", "src/RonSijm.Slopsidian/wwwroot/icons.svg", "shared/core-plugins.json"];
const artifacts = () => Promise.all(artifactPaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") })));
artifactPaths.push("client/web-history.ts", "client/web-history-model.ts", "client/web-history-view.ts", "tools/web-history-scenarios.mjs", "src/RonSijm.Slopsidian/Services/VaultService.Configuration.cs");
artifactPaths.push("client/web-reader-policy.ts", "client/web-reader-extract.ts", "client/web-reader-frame.ts", "desktop/web-reader.cjs", "tools/web-reader-fixtures.mjs", "tools/web-reader-scenarios.mjs", "tools/build.mjs", "package.json", "package-lock.json", "src/RonSijm.Slopsidian/wwwroot/js/web-reader-extract.js", "src/RonSijm.Slopsidian/wwwroot/js/web-reader-licenses.txt");
artifactPaths.push("src/RonSijm.Slopsidian/wwwroot/js/web-reader-extract.js.LEGAL.txt");
artifactPaths.push("client/web-clip-policy.ts", "client/web-clip-markdown.ts", "client/web-clip-modal.ts", "tools/web-clip-fixtures.mjs", "tools/web-clip-scenarios.mjs", "client/vault.ts", "client/workspace.ts", "src/RonSijm.Slopsidian/Services/CorePlugins.cs", "src/RonSijm.Slopsidian/Services/VaultService.Core.cs", "src/RonSijm.Slopsidian/Services/VaultService.cs");
artifactPaths.push("shared/web-zoom.cjs", "shared/web-zoom.d.cts", "desktop/web-zoom.cjs", "tools/web-zoom-scenarios.mjs", "tests/web-zoom.test.mjs");
artifactPaths.push("desktop/web-adblock.cjs", "desktop/web-adblock-engine.cjs", "tools/web-adblock-fixtures.mjs", "tools/web-adblock-scenarios.mjs", "tests/web-adblock.test.mjs", "tests/webviewer.test.mjs", "vendor/easylist/easylist.txt", "vendor/easylist/provenance.json", "vendor/easylist/LICENSE-CC-BY-SA-3.0.txt", "vendor/easylist/README.md", "vendor/easylist/.gitattributes", ".runtime/web-adblock/engine.cjs", ".runtime/web-adblock/engine.cjs.LEGAL.txt", ".runtime/web-adblock/licenses.txt");
if (transitionMode) { artifactPaths.push("client/editor-host.ts", "client/core-plugins.ts", "tests/workspace-transition.test.mjs"); }
artifactPaths.push("client/web-reader-appearance.ts", "tests/web-reader-appearance.test.mjs", "tools/web-reader-appearance-scenarios.mjs", "tests/web-reader.test.mjs");
artifactPaths.push("client/web-reader-progress.ts", "tests/web-reader-progress.test.mjs", "tools/web-reader-progress-scenarios.mjs");
artifactPaths.push("client/menu.ts", "tests/web-history-menu.test.mjs", "tools/web-history-menu-scenarios.mjs");
artifactPaths.push("tools/web-history-copy-scenarios.mjs");
artifactPaths.push("tools/web-clip-lists-scenarios.mjs", "tests/web-clip.test.mjs");
artifactPaths.push("tools/web-clip-tables-scenarios.mjs");
artifactPaths.push("tools/web-clip-selection-scenarios.mjs");
artifactPaths.push("tools/web-clip-properties-scenarios.mjs");
artifactPaths.push("client/core-settings.ts", "tools/web-clip-defaults-scenarios.mjs", "tests/web-clip-defaults.test.mjs");
artifactPaths.push("tools/web-reader-typography-scenarios.mjs", "tests/web-reader-typography.test.mjs");
artifactPaths.push("tools/web-reader-selection-scenarios.mjs", "tests/web-reader-selection.test.mjs");
artifactPaths.push("tools/web-reader-paragraph-spacing-scenarios.mjs", "tests/web-reader-paragraph-spacing.test.mjs");
artifactPaths.push("tools/web-reader-letter-spacing-scenarios.mjs", "tests/web-reader-letter-spacing.test.mjs");
artifactPaths.push("tools/web-reader-custom-width-scenarios.mjs", "tests/web-reader-custom-width.test.mjs");
artifactPaths.push("tools/web-reader-custom-font-scenarios.mjs", "tests/web-reader-custom-font.test.mjs");
artifactPaths.push("tools/web-reader-progress-history-scenarios.mjs", "tests/web-reader-progress-history.test.mjs");
artifactPaths.push("tools/web-history-filter-scenarios.mjs", "tests/web-history-filter.test.mjs");
artifactPaths.push("client/web-history-date-range.ts", "tools/web-history-date-range-scenarios.mjs", "tests/web-history-date-range.test.mjs");
artifactPaths.push("tools/web-history-selection-scenarios.mjs", "tests/web-history-selection.test.mjs");
artifactPaths.push("tools/web-history-undo-scenarios.mjs", "tests/web-history-undo.test.mjs");
artifactPaths.push("tools/web-history-redo-scenarios.mjs", "tests/web-history-redo.test.mjs");
artifactPaths.push("client/web-history-archive-modal.ts", "client/web-history-archive-style.ts", "tools/web-history-archive-scenarios.mjs", "tests/web-history-archive.test.mjs");
artifactPaths.push("tools/web-history-selected-archive-scenarios.mjs", "tests/web-history-selected-archive.test.mjs");
artifactPaths.push("client/web-history-order.ts", "tools/web-history-order-scenarios.mjs", "tests/web-history-order.test.mjs");
artifactPaths.push("client/web-history-retention.ts", "tools/web-history-retention-scenarios.mjs", "tests/web-history-retention.test.mjs");
artifactPaths.push("client/web-history-limit.ts", "client/web-history-limit-modal.ts", "tools/web-history-limit-scenarios.mjs", "tests/web-history-limit.test.mjs");
artifactPaths.push("shared/web-favicon.cjs", "shared/web-favicon.d.cts", "desktop/web-favicon.cjs", "client/web-favicons.ts", "tests/web-favicons.test.mjs", "tools/web-favicon-fixtures.mjs", "tools/web-favicon-scenarios.mjs", "tools/fixtures/web-favicon.jpg");
artifactPaths.push("shared/web-site-zoom.cjs", "shared/web-site-zoom.d.cts", "desktop/web-site-zoom.cjs", "client/web-site-zoom.ts", "tests/web-site-zoom.test.mjs", "tools/web-site-zoom-scenarios.mjs");
artifactPaths.push("client/web-reader-sanitize.ts", "client/web-page-clip.ts", "tests/web-page-clip.test.mjs", "tools/web-page-clip-fixtures.mjs", "tools/web-page-clip-scenarios.mjs");

artifactPaths.push("client/web-history-open.ts", "client/web-history-open-modal.ts", "tests/web-history-open.test.mjs", "tools/web-history-open-scenarios.mjs");

artifactPaths.push("tests/web-history-field-sort.test.mjs", "tools/web-history-field-sort-scenarios.mjs");

async function until(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) { return; }
    if (child && child.exitCode !== null) { throw new Error("Desktop exited while waiting for " + label + "\n" + log.slice(-3000)); }
    await delay(75);
  }
  throw new Error("Timed out waiting for " + label);
}
async function targets() { return (await fetch(endpoint + "/json/list")).json(); }
async function connect(target) {
  const connection = await connectWebViewerTarget(target, until);
  connections.push(connection);
  connection.socket.addEventListener("message", event => errorAudit.onEvent(JSON.parse(event.data)));
  if (target.url.startsWith(localEndpoint)) {
    connection.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") { (report.runtimeErrors ??= []).push(message.params.exceptionDetails); }
    });
  }
  await connection.command("Runtime.enable");
  return connection;
}

async function debuggingPort() {
  // Port zero can choose a port that Fetch deliberately forbids. Keep the
  // disposable loopback debugger in the same safe range as API test hosts.
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(49152, 65536);
    try {
      await new Promise((resolve, reject) => {
        const probe = createServer(); probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
      });
      return port;
    } catch (error) { if (error.code !== "EADDRINUSE" && error.code !== "EACCES") { throw error; } }
  }
  throw new Error("No available loopback debugging port was found.");
}
async function start() {
  const currentArtifacts = await artifacts();
  if (report.artifacts) { assert.deepEqual(currentArtifacts, report.artifacts, "Artifacts changed during the desktop scenario; rebuild and rerun this focused suite."); }
  else { report.artifacts = currentArtifacts; }
  endpoint = undefined;
  const debugPort = await debuggingPort();
  let sessionLog = "";
  child = spawn(join(root, "node_modules", "electron", "dist", "electron.exe"), [root, "--smoke", errorRun, `--smoke-profile=${profile}`, `--vault=${vault}`, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=" + debugPort, ...(backgroundMode ? ["--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] : [])], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  exited = once(child, "exit");
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", value => {
      log += value; sessionLog += value;
      const match = sessionLog.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { endpoint = "http://127.0.0.1:" + match[1]; }
      const local = sessionLog.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)/m);
      if (local) { localEndpoint = local[1]; }
    });
  }
  await until(() => endpoint, "desktop debugging endpoint");
  let target;
  await until(async () => { target = (await targets()).find(item => item.url.startsWith(localEndpoint)); return target; }, "local application renderer");
  host = await connect(target);
  await host.wait(`document.readyState==="complete"&&document.querySelector("main[data-ready=true]")&&globalThis.app?.workspace.layoutReady&&app.vault.rootPath===${JSON.stringify(vault)}&&!app.changingVault&&app.core.states.length===31`, "interactive vault, workspace and core modules ready");
  if (zoomMode) { await host.evaluate('globalThis.zoomInputTrace=[];for(const type of ["pointerdown","pointerup","click"])document.addEventListener(type,event=>{zoomInputTrace.push({type,target:event.target.id||event.target.tagName,x:event.clientX,y:event.clientY,focused:document.hasFocus(),inert:document.querySelector("#desktop-shell")?.inert});if(zoomInputTrace.length>20)zoomInputTrace.shift()},{capture:true})'); }
  report.processes.push({ debugPort, launcherPid: child.pid, electronPid: Number(sessionLog.match(/ELECTRON_HOST_PID (\d+)/)?.[1]), dotnetPid: Number(sessionLog.match(/DOTNET_HOST_PID (\d+)/)?.[1]) });
}
async function stop() {
  if (!child || child.exitCode !== null) { return; }
  try { await errorAudit.flush(expression => host.evaluate(expression)); } catch (error) { (report.errorLogFlushFailures ??= []).push(error.stack); }
  host.socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
  const [code, signal] = await exited;
  await errorAudit.drain(host.socket);
  assert.equal(signal, null, log.slice(-3000));
  assert.equal(code, 0, log.slice(-3000));
}
try {
  await start();
  if (!adblockOnly && !appearanceOnly && !progressOnly && !menuOnly && !listsOnly && !tablesOnly && !selectionOnly && !propertiesOnly && !defaultsOnly && !typographyOnly && !readerSelectionOnly && !paragraphOnly && !letterOnly && !customWidthOnly && !customFontOnly && !progressHistoryOnly && !filterOnly && !dateRangeOnly && !selectionHistoryOnly && !historyUndoOnly && !historyRedoOnly && !historyArchiveOnly && !selectedArchiveOnly && !orderOnly && !retentionOnly && !limitOnly && !faviconOnly && !siteZoomOnly && !pageClipOnly && !historyOpenOnly && !fieldSortOnly) {
  await checkWebViewer({
    host: {
      evaluate: expression => host.evaluate(expression),
      click: selector => host.click(selector),
      fill: (selector, value) => host.fill(selector, value),
      wait: (expression, label) => host.wait(expression, label),
      press: (...args) => host.press(...args),
    },
    origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests,
    directory: vault, originalWorkspace: Buffer.from(originalWorkspace), pass,
    capture: async remote => {
      const screenshot = await remote.command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, capturePrefix + "webviewer-page.png"), Buffer.from(screenshot.data, "base64"));
    },
  });
  if (historyMode) {
    await checkWebHistory({
      host: {
        evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args),
      },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, capturePrefix + (phase === "empty" ? "web-history-empty.png" : "web-history-pane.png")), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (readerMode) {
    await checkWebReader({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, capturePrefix + "web-reader-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (clipMode) {
    await checkWebClip({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, capturePrefix + "web-clip-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (zoomMode) {
    await checkWebZoom({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, alternateOrigin: alternatePages.origin, targets, connect, restart: async () => { await stop(); await start(); }, until,
      requests, alternateRequests: alternatePages.requests, directory: vault, pass,
      capture: async (phase, remote) => {
        const screenshot = await (remote ?? host).command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, capturePrefix + "web-zoom-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  }
  if (adblockMode) {
    await checkWebAdblock({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, capturePrefix + (transitionMode ? "workspace-transition-webviewer-" : "web-adblock-") + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (appearanceMode) {
    await checkWebReaderAppearance({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, (progressMode ? capturePrefix + "appearance" : reportName) + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (progressMode) {
    await checkWebReaderProgress({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, (menuMode ? capturePrefix + "progress" : reportName) + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (menuMode) {
    await checkWebHistoryMenu({
      copyMode,
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (listsMode) {
    await checkClipLists({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (tablesMode) {
    await checkClipTables({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (selectionMode) {
    await checkClipSelection({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (propertiesMode) {
    await checkClipProperties({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (defaultsMode) {
    await checkClipDefaults({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (typographyMode) {
    await checkReaderTypography({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (readerSelectionMode) {
    await checkReaderSelection({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (...args) => host.command(...args) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (paragraphMode) {
    await checkReaderParagraphSpacing({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        command: (method, params) => host.command(method, params) },
      origin, targets: () => targets(), connect: target => connect(target), restart: async () => { await stop(); await start(); },
      until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (letterMode) {
    await checkReaderLetterSpacing({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        command: (method, params) => host.command(method, params) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (customWidthMode) {
    await checkReaderCustomWidth({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (customFontMode) {
    await checkReaderCustomFont({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (progressHistoryMode) {
    await checkReaderProgressHistory({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, targets, connect, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (filterMode) {
    await checkHistoryFilter({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (dateRangeMode) {
    await checkHistoryDateRange({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (selectionHistoryMode) {
    await checkHistorySelection({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (historyUndoMode) {
    await checkHistoryUndo({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (historyRedoMode) {
    await checkHistoryRedo({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (historyArchiveMode) {
    await checkHistoryArchive({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (selectedArchiveMode) {
    await checkHistorySelectedArchive({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (orderMode) {
    await checkHistoryOrder({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (retentionMode) {
    await checkHistoryRetention({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (limitMode) {
    await checkHistoryLimit({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, restart: async () => { await stop(); await start(); }, until, requests, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (faviconMode) {
    await checkWebFavicons({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      restart: async () => { await stop(); await start(); }, until, directory: vault, pass, targets, connect,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (siteZoomMode) {
    await checkSiteZoom({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, alternateOrigin: alternatePages.origin, requests, alternateRequests: alternatePages.requests,
      restart: async () => { await stop(); await start(); }, until, directory: vault, pass, targets, connect,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (pageClipMode) {
    await checkPageClip({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      restart: async () => { await stop(); await start(); }, until, directory: vault, pass, targets, connect,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (historyOpenMode) {
    await checkHistoryOpen({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, requests, restart: async () => { await stop(); await start(); }, until, directory: vault, pass, targets, connect,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  if (fieldSortMode) {
    await checkHistoryFieldSort({
      host: { evaluate: expression => host.evaluate(expression), click: selector => host.click(selector),
        fill: (selector, value) => host.fill(selector, value), wait: (expression, label) => host.wait(expression, label),
        press: (...args) => host.press(...args), command: (method, params) => host.command(method, params) },
      origin, requests, restart: async () => { await stop(); await start(); }, until, directory: vault, pass,
      capture: async phase => {
        const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
        await writeFile(join(evidence, reportName + "-" + phase + ".png"), Buffer.from(screenshot.data, "base64"));
      },
    });
  }
  await stop();
  assert.deepEqual(await artifacts(), report.artifacts, "Artifacts changed during the desktop scenario; rebuild and rerun this focused suite.");
  report.artifactBinding = "verified-current";
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  if (host?.socket.readyState === WebSocket.OPEN) {
    try {
      report.diagnostics = await host.evaluate('({error:document.querySelector("#client-errors")?.textContent,inputTrace:globalThis.zoomInputTrace,settings:{open:document.querySelector("#settings-dialog")?.open,button:document.querySelector("#open-settings")?.getBoundingClientRect().toJSON(),shellInert:document.querySelector("#desktop-shell")?.inert,focus:document.activeElement?.outerHTML,hasFocus:document.hasFocus()},workspace:app.workspace.getLayout(),views:app.workspace.getLeavesOfType("webviewer").map(leaf=>({id:leaf.view.id,query:leaf.view.lastQuery,request:leaf.view.findRequest})),panes:[...document.querySelectorAll(".webviewer")].map(pane=>({text:pane.innerText,inputs:[...pane.querySelectorAll("input")].map(input=>({value:input.value,focused:input===document.activeElement})),bounds:pane.getBoundingClientRect().toJSON()}))})');
      const screenshot = await host.command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, reportName + "-failure.png"), Buffer.from(screenshot.data, "base64"));
    } catch (diagnostic) { report.diagnosticError = diagnostic.message; }
  }
  console.error(error);
} finally {
  try { await stop(); } catch (error) { report.shutdownError = error.message; report.status = "failed"; }
  for (const connection of connections) { connection.socket.close(); }
  await pages.close();
  await alternatePages?.close();
  report.completedAt = new Date().toISOString();
  errorAudit.finish(report, log);
  if (report.runtimeErrors?.length) { report.status = "failed"; report.error ??= "The application emitted an uncaught renderer error; see runtimeErrors."; }
  await writeFile(join(evidence, reportName + "-smoke.log"), log);
  await writeFile(join(evidence, reportName + "-smoke.json"), JSON.stringify(report, null, 2) + "\n");
}
assert.equal(report.status, "passed", report.error || report.shutdownError);
console.log("Desktop Web viewer workflows passed in an isolated test profile.");
