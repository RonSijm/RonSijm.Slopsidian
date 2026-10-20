const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes, randomInt } = require("node:crypto");
const { once } = require("node:events");
const { existsSync, mkdirSync } = require("node:fs");
const { createServer } = require("node:net");
const path = require("node:path");
const { installWebViewer } = require("./web-viewer.cjs");
const { installMicrophonePermission } = require("./audio-permissions.cjs");
const { createProfileStorage } = require("./local-storage.cjs");
const { createDraftRescuer, writeDraftRescue } = require("./draft-rescue.cjs");
const { resolveRescueFolder } = require("./draft-rescue-catalog.cjs");
const { inspectDraftRescue } = require("./draft-rescue-inspector.cjs");
const { createRescueReviewState } = require("./draft-rescue-review-state.cjs");
const { createErrorLog } = require("./error-log.cjs");

const root = path.resolve(__dirname, "..");
const smoke = process.argv.includes("--smoke");
const syntheticAudio = process.argv.includes("--smoke-audio");
if (syntheticAudio && !smoke) { throw new Error("Synthetic audio is only available to the smoke harness."); }
if (syntheticAudio) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
const smokeProfile = process.argv.find(argument => argument.startsWith("--smoke-profile="))?.slice("--smoke-profile=".length);
if (smokeProfile !== undefined && (!smoke || !/^[a-z0-9-]{1,80}$/.test(smokeProfile))) {
  throw new Error("A smoke profile must be a short alphanumeric test identifier used with --smoke.");
}
const profile = path.join(root, ".runtime", smoke ? "smoke-profile" + (smokeProfile ? "-" + smokeProfile : "") : "profile");
mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.setName("Slopsidian");
const errorRun = process.argv.find(argument => argument.startsWith("--error-log-run="))?.slice("--error-log-run=".length);
if (errorRun !== undefined && (!smoke || !/^[a-z0-9-]{1,80}$/.test(errorRun))) { throw new Error("Error log run identifiers are only valid for smoke runs."); }
const errorLog = createErrorLog(profile, errorRun ? "smoke-" + errorRun : undefined);
console.log("ERROR_LOG " + errorLog.path);

let backend;
let backendExited;
let endpoint;
let window;
let stopping = false;
let allowQuit = false;
let backendShutdownRequested = false;
let hostFailure = null;
let draftRescuer;
let rescueReviewState;
let rescueTask = Promise.resolve(null);
let initialFailureNotice = null;
let noticeQueue = Promise.resolve();
let signalBackendFailure;
const backendFailure = new Promise(resolve => { signalBackendFailure = resolve; });

async function captureWithDeadline() {
  if (!window || window.isDestroyed()) { throw new Error("The original editor window is not available. Existing recovery copies are retained."); }
  let timer;
  try {
    return await Promise.race([
      window.webContents.executeJavaScript('(()=>{if(typeof globalThis.slopsidian?.captureMarkdownDrafts!=="function"){throw new Error("The Markdown editor has not initialized.");}return slopsidian.captureMarkdownDrafts()})()'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The editor did not provide its draft snapshot within five seconds. Keep the window open.")), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function rescueMarkdown(reason) {
  const result = draftRescuer ? await draftRescuer.capture()
    : { complete: false, directory: null, copied: 0, total: null, errors: ["The Markdown draft collector is not available."] };
  console.log("DESKTOP_DRAFT_RESCUE " + JSON.stringify({ reason, ...result }));
  return result;
}

function failureNotice(result, closing = false) {
  const operation = noticeQueue.then(async () => {
    if (smoke) { return closing; }
    const folder = result.directory ?? result.previousDirectory;
    const summary = result.total === null ? "The current Markdown draft capture failed."
      : result.total === 0 ? "No unsaved Markdown draft sessions were found."
      : "Copied " + result.copied + " of " + result.total + " unsaved Markdown drafts.";
    const buttons = ["Keep open"];
    if (folder) { buttons.push("Show recovery copies"); }
    if (closing) { buttons.push("Discard remaining edits and close"); }
    const options = {
      type: "warning", title: "Local host stopped",
      message: closing ? "Close after the local host stopped?" : "The local host stopped. Your editor window has been kept open.",
      detail: summary + "\n\nOriginal notes were not overwritten. Recovery copies contain plaintext Markdown in this app's local profile. Canvas, Bases and plugin-only drafts are not captured."
        + (folder ? "\n\nRecovery folder: " + folder : "")
        + (result.previousDirectory && !result.directory ? "\nThis is an earlier copy; current edits could not be captured." : "")
        + (result.errors.length ? "\n\n" + result.errors.join("\n") : "")
        + (closing ? "\n\nClosing discards any remaining uncopied edits." : "\n\nLater edits will be captured again if you close this window."),
      buttons,
      defaultId: 0, cancelId: 0, noLink: true,
    };
    const choice = await (window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
    if (choice.response === 1 && folder) {
      const error = await shell.openPath(folder);
      if (error) { dialog.showErrorBox("Cannot open recovery folder", error); }
    }
    return closing && choice.response === buttons.length - 1;
  });
  noticeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function notifyHostFailure(result) {
  return initialFailureNotice ??= failureNotice(result);
}

async function browserPort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(49152, 65536);
    try {
      await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
      });
      return port;
    } catch (error) {
      if (error.code !== "EADDRINUSE" && error.code !== "EACCES") {
        throw error;
      }
    }
  }
  throw new Error("No available browser-compatible loopback port was found.");
}

function localUrl(value) {
  if (!endpoint || !URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  const expected = new URL(endpoint);
  return ["http:", "ws:"].includes(url.protocol) && url.host === expected.host;
}

async function stopBackend() {
  if (!backend || backend.exitCode !== null || backend.signalCode !== null) {
    return;
  }
  stopping = true;
  backendShutdownRequested = true;
  backend.stdin.end("shutdown\n");
  const timeout = setTimeout(() => {
    console.error("The owned .NET host did not stop gracefully; terminating its PID " + backend.pid);
    backend.kill();
    process.exitCode = 1;
  }, 10000);
  const [code, signal] = await backendExited;
  clearTimeout(timeout);
  if (code !== 0 || signal) {
    throw new Error(`The .NET host exited abnormally: code=${code}, signal=${signal}`);
  }
}

async function quit() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (hostFailure) {
    try {
      await rescueTask;
      const result = await rescueMarkdown("close-after-host-exit");
      if (!await failureNotice(result, true)) { stopping = false; return; }
      await rescueReviewState?.whenIdle();
      allowQuit = true;
      app.quit();
    } catch (error) {
      stopping = false;
      console.error("Cannot close the retained recovery window:", error);
    }
    return;
  }
  try {
    if (window && !window.isDestroyed()) {
      await Promise.race([
        window.webContents.executeJavaScript("globalThis.slopsidian ? globalThis.slopsidian.prepareClose() : undefined"),
        backendFailure.then(() => { throw new Error("The local host stopped during close. Markdown draft rescue is available."); }),
      ]);
    }
  } catch (error) {
    stopping = false;
    console.error("Cannot close without saving:", error);
    if (hostFailure) { await notifyHostFailure(await rescueTask); return; }
    if (smoke) {
      await stopBackend();
      app.exit(1);
    } else {
      await dialog.showMessageBox(window, { type: "error", title: "Save failed", message: "The window was kept open to preserve your unsaved text.", detail: error.message });
    }
    return;
  }
  try {
    await rescueReviewState?.whenIdle();
    if (hostFailure) { stopping = false; await notifyHostFailure(await rescueTask); return; }
    await stopBackend();
    allowQuit = true;
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

async function main() {
  await app.whenReady();
  console.log("ELECTRON_HOST_PID " + process.pid);
  const dll = path.join(root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll");
  if (!existsSync(dll)) {
    throw new Error("Build the prototype first: npm run build");
  }
  const vaultArgument = process.argv.find(argument => argument.startsWith("--vault="));
  if (vaultArgument === "--vault=") {
    throw new Error("Supply a directory after --vault=, or omit it to choose a vault on startup.");
  }
  const vault = vaultArgument ? path.resolve(vaultArgument.slice("--vault=".length)) : "";
  const token = randomBytes(32).toString("hex");
  const port = await browserPort();
  backend = spawn("dotnet", [dll, "--urls", "http://127.0.0.1:" + port], {
    cwd: path.join(root, "src", "RonSijm.Slopsidian"),
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Development",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      SLOPSIDIAN_TOKEN: token,
      SLOPSIDIAN_PARENT: "1",
      SLOPSIDIAN_VAULT: vault,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  console.log("DOTNET_HOST_PID " + backend.pid);
  backendExited = once(backend, "exit");
  endpoint = await new Promise((resolve, reject) => {
    let output = "";
    let ready = false;
    const timeout = setTimeout(() => reject(new Error("The .NET host did not become ready within 30 seconds.")), 30000);
    backend.stdout.setEncoding("utf8");
    backend.stdout.on("data", text => {
      process.stdout.write(text);
      if (ready) {
        return;
      }
      output += text;
      const match = output.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)\r?\n/m);
      if (match) {
        clearTimeout(timeout);
        ready = true;
        output = "";
        resolve(match[1]);
      }
    });
    backend.stderr.on("data", text => process.stderr.write(text));
    backend.once("error", error => { clearTimeout(timeout); reject(error); });
    backend.once("exit", code => {
      clearTimeout(timeout);
      reject(new Error(`The .NET host stopped during startup with exit ${code}.`));
    });
  });

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !localUrl(details.url) && !details.url.startsWith("devtools:") });
  });
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (localUrl(details.url)) {
      details.requestHeaders["X-Vault-Token"] = token;
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  window = new BrowserWindow({
    title: "Slopsidian",
    width: 1400,
    height: 950,
    minWidth: 940,
    minHeight: 650,
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#303030", symbolColor: "#bcbcbc", height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      // Existing desktop plugins require Node access in the renderer.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  draftRescuer = createDraftRescuer(captureWithDeadline, snapshot => writeDraftRescue(profile, snapshot));
  installMicrophonePermission(session.defaultSession, window, endpoint, dialog, syntheticAudio);
  window.webContents.on("will-navigate", (event, url) => {
    if (!localUrl(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  installWebViewer(window, endpoint);
  window.on("close", event => {
    if (!allowQuit) {
      event.preventDefault();
      quit().catch(error => { console.error(error); app.exit(1); });
    }
  });
  const localStorage = createProfileStorage(path.join(profile, "vault-local-storage.sqlite"));
  ipcMain.on("vault:error-log", (event, operation, record) => {
    try {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !localUrl(event.senderFrame.url)) { throw new Error("Error logs are only available to the local application window."); }
      if (operation === "append") { event.returnValue = { ok: true, path: errorLog.append(record) }; }
      else if (operation === "read") { event.returnValue = { ok: true, text: errorLog.read(), path: errorLog.path }; }
      else { throw new Error("Unknown error log operation."); }
    } catch (error) { console.error("Error log failed:", error); event.returnValue = { ok: false, error: error.message }; }
  });
  rescueReviewState = createRescueReviewState(localStorage);
  app.once("will-quit", () => localStorage.close());
  ipcMain.handle("vault:draft-rescue-review-state", async (event, id, version, reviewed) => {
    if (event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || !localUrl(event.senderFrame.url)) {
      throw new Error("Recovery review preferences are only available to the local application window.");
    }
    if (stopping || allowQuit) { throw new Error("This window is closing. Review status was not changed."); }
    await rescueReviewState.setReviewed(profile, id, version, reviewed);
  });
  ipcMain.handle("vault:draft-rescue", async (event, operation, id, file, version) => {
    if (event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || !localUrl(event.senderFrame.url)) {
      throw new Error("Recovery copies are only available to the local application window.");
    }
    if (operation === "list" && id === undefined && file === undefined && version === undefined) { return rescueReviewState.catalog(profile); }
    if (operation === "inspect") { return inspectDraftRescue(profile, id, file, version); }
    if (operation !== "show" || file !== undefined || version !== undefined) { throw new Error("Unsupported recovery review operation."); }
    const directory = await resolveRescueFolder(profile, id);
    if (smoke) { console.log("DRAFT_RESCUE_REVEAL " + directory); return; }
    const error = await shell.openPath(directory);
    if (error) { throw new Error(error); }
  });
  ipcMain.on("vault:local-storage", (event, operation, key, value) => {
    try {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !localUrl(event.senderFrame.url)) {
        throw new Error("Vault-local storage is only available to the local application window.");
      }
      let result = null;
      if (operation === "get") { result = localStorage.getItem(key); }
      else if (operation === "set") { localStorage.setItem(key, value); }
      else if (operation === "remove") { localStorage.removeItem(key); }
      else { throw new Error("Unknown vault-local storage operation."); }
      event.returnValue = { ok: true, value: result };
    } catch (error) {
      console.error("Vault-local storage failed:", error);
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("vault:select-directory", async (event, purpose = "open") => {
    if (event.sender !== window.webContents || !event.senderFrame || !localUrl(event.senderFrame.url)) {
      throw new Error("Vault selection is only available to the local application window.");
    }
    if (purpose !== "open" && purpose !== "create") {
      throw new Error("Unknown vault directory selection purpose.");
    }
    const title = purpose === "create" ? "Choose a location for the new vault" : "Open a vault";
    const selected = await dialog.showOpenDialog(window, { title, properties: ["openDirectory"] });
    return selected.canceled ? null : selected.filePaths[0];
  });
  backend.once("exit", (code, signal) => {
    if (!backendShutdownRequested) {
      hostFailure = { code, signal };
      console.error("The .NET host exited unexpectedly: code=" + code + ", signal=" + signal);
      rescueTask = rescueMarkdown("unexpected-host-exit");
      signalBackendFailure();
      rescueTask.then(notifyHostFailure).catch(error => console.error("Could not show draft rescue information:", error));
    }
  });
  await window.loadURL(endpoint);
  if (smoke) {
    setTimeout(() => {
      console.error("The desktop smoke deadline expired.");
      quit().catch(error => { console.error(error); app.exit(1); });
    }, 90000).unref();
  }
}

app.on("before-quit", event => {
  if (!allowQuit) {
    event.preventDefault();
    quit().catch(error => { console.error(error); app.exit(1); });
  }
});

main().catch(async error => {
  console.error(error);
  if (hostFailure && window && !window.isDestroyed()) { await notifyHostFailure(await rescueTask); return; }
  if (!smoke) {
    dialog.showErrorBox("Cannot start Slopsidian", error.message);
  }
  try {
    await stopBackend();
  } catch (shutdownError) {
    console.error(shutdownError);
  }
  app.exit(1);
});
