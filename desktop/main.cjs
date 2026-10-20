const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes, randomInt } = require("node:crypto");
const { once } = require("node:events");
const { existsSync, mkdirSync } = require("node:fs");
const { createServer } = require("node:net");
const path = require("node:path");
const { installWebViewer } = require("./web-viewer.cjs");
const { installMicrophonePermission } = require("./audio-permissions.cjs");
const { createProfileStorage } = require("./local-storage.cjs");

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

let backend;
let backendExited;
let endpoint;
let window;
let stopping = false;
let allowQuit = false;

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
  if (!backend || backend.exitCode !== null) {
    return;
  }
  stopping = true;
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
  try {
    if (window && !window.isDestroyed()) {
      await window.webContents.executeJavaScript("globalThis.slopsidian ? globalThis.slopsidian.prepareClose() : undefined");
    }
  } catch (error) {
    stopping = false;
    console.error("Cannot close without saving:", error);
    if (smoke) {
      await stopBackend();
      app.exit(1);
    } else {
      await dialog.showMessageBox(window, { type: "error", title: "Save failed", message: "The window was kept open to preserve your unsaved text.", detail: error.message });
    }
    return;
  }
  try {
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
  app.once("will-quit", () => localStorage.close());
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
  backend.once("exit", code => {
    if (!stopping) {
      console.error("The .NET host exited unexpectedly with code " + code);
      app.exit(1);
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
