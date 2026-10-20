import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startWebServer } from "./serve-web.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const canvasesOnly = process.argv.includes("--canvases");
const previewsOnly = process.argv.includes("--previews");
const editingToolsOnly = process.argv.includes("--editing-tools");
const formatsOnly = process.argv.includes("--formats");
const composerOnly = process.argv.includes("--composer");
const menusOnly = process.argv.includes("--menus");
const suggestionsOnly = process.argv.includes("--suggestions");
const renderersOnly = process.argv.includes("--renderers");
const tagsOnly = process.argv.includes("--tags");
const templaterOnly = process.argv.includes("--templater");
const excalidrawOnly = process.argv.includes("--excalidraw");
const reportedPluginsOnly = process.argv.includes("--reported-plugins");
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
const viewsOnly = process.argv.includes("--views");
const focused = canvasesOnly || previewsOnly || editingToolsOnly || formatsOnly || composerOnly || menusOnly || suggestionsOnly || renderersOnly || tagsOnly || templaterOnly || excalidrawOnly || reportedPluginsOnly || basesOnly || recoveryOnly || discoveryOnly || audioOnly || editorChromeOnly || mermaidOnly || workspacesOnly || outgoingOnly || viewsOnly || workspaceTransitionOnly;
const syntheticAudio = audioOnly || !focused;
if ([canvasesOnly, previewsOnly, editingToolsOnly, formatsOnly, composerOnly, menusOnly, suggestionsOnly, renderersOnly, tagsOnly, templaterOnly, excalidrawOnly, reportedPluginsOnly, basesOnly, recoveryOnly, discoveryOnly, audioOnly, editorChromeOnly, mermaidOnly, workspacesOnly, outgoingOnly, viewsOnly, workspaceTransitionOnly].filter(Boolean).length > 1) { throw new Error("Choose one focused WASM suite."); }
const reportName = tagsOnly ? "tags-web-smoke" : workspaceTransitionOnly ? "workspace-transition-web-smoke" : reportedPluginsOnly ? "reported-plugins-web-smoke" : excalidrawOnly ? "excalidraw-web-smoke" : templaterOnly ? "templater-web-smoke" : renderersOnly ? "renderers-web-smoke" : suggestionsOnly ? "suggestions-web-smoke" : viewsOnly ? "views-web-smoke" : baseSummariesOnly ? "bases-summaries-web-smoke" : outgoingOnly ? "outgoing-web-smoke" : workspacesOnly ? "workspaces-web-smoke" : mermaidOnly ? "mermaid-web-smoke" : audioOnly ? "audio-web-smoke" : canvasesOnly ? "canvases-web-smoke" : previewsOnly ? "previews-web-smoke" : editingToolsOnly ? "editing-tools-web-smoke" : formatsOnly ? "formats-web-smoke" : composerOnly ? "composer-web-smoke" : menusOnly ? "menus-web-smoke" : basesOnly ? "bases-web-smoke" : recoveryOnly ? "recovery-web-smoke" : discoveryOnly ? "discovery-web-smoke" : editorChromeOnly ? "editor-chrome-web-smoke" : "web-smoke";
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
const originalWorkspace = '{"original":"leave untouched"}\n';
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
let log = "";
let endpoint;
let nextId = 0;
const pending = new Map();
const requests = [];
const missingAssets = [];
const exceptions = [];
const consoleErrors = [];
const recentCommands = [];
const report = { status: "failed", scope: canvasesOnly ? "canvas-runtime" : previewsOnly ? "page-preview-runtime" : editingToolsOnly ? "editing-tools-runtime" : formatsOnly ? "format-conversion-runtime" : composerOnly ? "note-composition-runtime" : menusOnly ? "menu-api-runtime" : discoveryOnly ? "discovery-runtime" : editorChromeOnly ? "editor-chrome-runtime" : "full-shared-runtime", startedAt: new Date().toISOString(), checks: [], rendererNodeIntegration: false, realExternalDirectoryPicker: true, pickerStartsInDisposableDocuments: true };
if (audioOnly) { Object.assign(report, { scope: "audio-recorder-runtime", syntheticAudioOnly: true, physicalMicrophoneTested: false }); }
if (suggestionsOnly) { report.scope = "plugin-suggestions-runtime"; }
if (renderersOnly) { report.scope = "markdown-postprocessors-runtime"; }
if (tagsOnly) { report.scope = "native-shaped-tag-rendering"; }
if (templaterOnly) { report.scope = "actual-templater-runtime"; }
if (excalidrawOnly) { Object.assign(report, { scope: "actual-excalidraw-runtime", communityPluginsTested: true }); }
if (reportedPluginsOnly) { report.scope = "reported-community-plugin-startup"; }
if (mermaidOnly) { report.scope = "mermaid-runtime"; }
if (workspacesOnly) { report.scope = "workspace-import-runtime"; }
if (baseSummariesOnly) { report.scope = "bases-summaries-runtime"; }
if (outgoingOnly) { report.scope = "outgoing-runtime"; }
if (viewsOnly) { report.scope = "view-host-runtime"; }
if (syntheticAudio) { Object.assign(report, { syntheticAudioOnly: true, physicalMicrophoneTested: false }); }
function command(method, params = {}) {
  recentCommands.push({ method, type: params.type, key: params.key, expression: params.expression?.slice(0, 500) });
  if (recentCommands.length > 20) { recentCommands.shift(); }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timed out: " + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression: `(()=>{
    const result=(0,eval)(${JSON.stringify(expression)});
    if(result&&typeof result.then==="function"){
      const retained=globalThis.slopsidianSmokePromises??=new Set();
      retained.add(result);
      result.then(()=>retained.delete(result),()=>retained.delete(result));
    }
    return result;
  })()`, awaitPromise: true, returnByValue: true });
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
  await wait(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return el&&!el.disabled&&el.checkVisibility()&&el.getBoundingClientRect().height>0})()`, selector);
  await command("Page.bringToFront");
  const point = await evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({block:"center",inline:"nearest"});
    const b=Array.from(el.getClientRects()).find(rect=>rect.width>0&&rect.height>0);
    if(!b){throw new Error("The click target has no visible client rect.");}
    const x=b.left+b.width/2,y=b.top+b.height/2;
    const hit=document.elementFromPoint(x,y);
    return{x,y,reachable:hit===el||el.contains(hit),hit:hit?.outerHTML.slice(0,300)};
  })()`);
  assert.ok(point.reachable, `Cannot reach ${selector}: ${point.hit}`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
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
  for (const path of ["index.html", "app.css", "browser.css", "icons.svg", "icons-LICENSE.txt", "mermaid-frame.html", "js/mermaid-frame.js", "js/mermaid-api.js", "js/mermaid-api.js.LEGAL.txt", "js/mermaid-licenses.txt", "js/editor-host.js", "js/editor-host.css", "js/codemirror-license.txt", "js/hypermd-license.txt", "js/web-reader-extract.js", "js/web-reader-extract.js.LEGAL.txt", "js/web-reader-licenses.txt", "js/browser-host.js", "js/search-worker.js", "js/graph-worker.js", "js/bases-worker.js", "_framework/" + assembly]) {
    sha256[path] = createHash("sha256").update(await readFile(join(site, ...path.split("/")))).digest("hex");
  }
  const scenarioSha256 = {};
  for (const name of ["web-smoke", "web-smoke-host", "reading-scenarios", "outgoing-scenarios", "discovery-scenarios", "editor-chrome-scenarios", "suggestion-scenarios", "renderer-scenarios", "templater-scenarios", "organization-scenarios", "file-scenarios", "graph-scenarios", "canvas-scenarios", "preview-scenarios", "editing-tools-scenarios", "format-scenarios", "composer-scenarios", "menu-scenarios", "bases-scenarios", "bases-summary-scenarios", "recovery-scenarios", "view-scenarios", "audio-scenarios", "mermaid-scenarios", "workspace-import-scenarios"]) {
    const path = name + (name === "web-smoke-host" ? ".cjs" : ".mjs");
    scenarioSha256[path] = createHash("sha256").update(await readFile(join(root, "tools", path))).digest("hex");
  }
  if (reportedPluginsOnly) { scenarioSha256["reported-plugin-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools", "reported-plugin-scenarios.mjs"))).digest("hex"); }
  if (excalidrawOnly) { scenarioSha256["excalidraw-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools", "excalidraw-scenarios.mjs"))).digest("hex"); }
  if (tagsOnly) { scenarioSha256["tag-scenarios.mjs"] = createHash("sha256").update(await readFile(join(root, "tools", "tag-scenarios.mjs"))).digest("hex"); }
  scenarioSha256["select-test-folder.ps1"] = createHash("sha256").update(await readFile(join(root, "tools", "select-test-folder.ps1"))).digest("hex");
  const sourceSha256 = {};
  if (tagsOnly) {
    for (const name of ["reading", "live-preview", "editor", "markdown", "properties", "page-preview"]) {
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

try {
  host = await startWebServer({ port: 0 });
  report.endpoint = host.endpoint;
  const initialArtifacts = await readArtifacts();
  report.sha256 = initialArtifacts.sha256;
  report.scenarioSha256 = initialArtifacts.scenarioSha256;
  if (workspaceTransitionOnly || tagsOnly) { report.sourceSha256 = initialArtifacts.sourceSha256; }
  report.inputEnvironment = "Windows occlusion and renderer/timer background throttling disabled in disposable UI processes; production launch is unchanged.";
  child = spawn(join(root, "node_modules", "electron", "dist", "electron.exe"), [
    join(root, "tools", "web-smoke-host.cjs"), "--site=" + host.endpoint, "--profile=" + profile, "--fixture=" + fixture,
    ...(syntheticAudio ? ["--synthetic-audio"] : []),
    "--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  ], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  exited = once(child, "exit");
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", data => {
      log += data;
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
    } else if (message.method === "Network.requestWillBeSent") {
      requests.push(message.params.request.url);
    } else if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
      missingAssets.push(message.params.response.url);
    } else if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error" && (reportedPluginsOnly || excalidrawOnly)) {
      consoleErrors.push(message.params.args.map(argument => argument.description ?? argument.value ?? argument.type).join(" ").slice(0, 6000));
      report.consoleErrorDetails ??= [];
      report.consoleErrorDetails.push({ args: message.params.args, stackTrace: message.params.stackTrace });
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
  assert.equal(await evaluate('document.querySelector("svg use").href.baseVal.startsWith("icons.svg#")'), true);
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
  await click('[data-toggle-plugin="sample-plugin"]');
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
  await click("#save-note");
  await wait('document.querySelector(".error-banner")?.textContent.includes("changed on disk")');
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
  await click("#open-vault");
  await fill("#new-vault-name", "Created in browser");
  await selectFolder("#browser-create-vault", parent);
  await wait('app.vault.getName()==="Created in browser"&&!document.querySelector("#vault-dialog").open&&!app.changingVault');
  assert.ok((await readdir(parent)).includes("Created in browser"));
  pass("Vault switching isolates core settings, and Create vault creates a real subfolder in the selected parent.");

  const readingRoot = await evaluate("app.vault.rootPath");
  const afterFeatureReload = async () => {
    assert.deepEqual(await readArtifacts(), initialArtifacts, "Browser artifacts changed before reconnect; no mixed-build acceptance is valid.");
    await wait('document.querySelector("main[data-ready=true]")&&window.app?.core&&!app.changingVault&&document.querySelector("#vault-dialog")?.open', "fresh browser reconnect after feature reload");
    await click(`[data-recent-vault="${readingRoot}"]`);
    await wait(`app.vault.rootPath===${JSON.stringify(readingRoot)}&&app.workspace.layoutReady&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "feature IndexedDB handle reconnect");
  };
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
  if (suggestionsOnly || !focused) {
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
  if (renderersOnly || !focused) {
    const { checkMarkdownProcessors } = await import("./renderer-scenarios.mjs");
    await checkMarkdownProcessors({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (menusOnly) {
    const { checkMenuApi } = await import("./menu-scenarios.mjs");
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
  if (basesOnly && !baseSummariesOnly || !focused) {
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
  if (baseSummariesOnly || !focused) {
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
  if (!focused) {
    const { checkReadingView } = await import("./reading-scenarios.mjs");
    await checkReadingView({
      directory: join(parent, "Created in browser"), evaluate, command, click, press, wait, report,
      afterReload: afterFeatureReload,
    });
  }
  if (outgoingOnly || !focused) {
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
  if (viewsOnly || !focused) {
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
  if (mermaidOnly || !focused) {
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
  if (reportedPluginsOnly || excalidrawOnly) { report.consoleErrors = [...consoleErrors]; }
  socket?.close();
  if (child && child.exitCode === null) {
    child.stdin.end("quit\n");
    const deadline = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(deadline);
  }
  if (host) {
    await host.close();
  }
  report.completedAt = new Date().toISOString();
  await writeFile(join(root, ".runtime", "evidence", reportName + ".json"), JSON.stringify(report, null, 2));
  await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
