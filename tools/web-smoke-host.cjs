const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");

const option = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const url = option("site");
const profile = option("profile");
const fixture = option("fixture");
const syntheticAudio = process.argv.includes("--synthetic-audio");
if (syntheticAudio) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
console.log("WEB_HOST_PID " + process.pid);
if (!url || !profile || !fixture) {
  throw new Error("Supply the static-site URL, disposable browser profile and test-fixture root.");
}
const origin = new URL(url).origin;
let window;
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
app.setPath("userData", profile);
app.setPath("documents", fixture);
function allowed(file) {
  if (!file) {
    return false;
  }
  const relative = path.relative(fixture, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
app.whenReady().then(async () => {
  // Only the disposable test fixture receives filesystem permission in this harness.
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => URL.canParse(requestingOrigin) && new URL(requestingOrigin).origin === origin && (permission === "fileSystem" && allowed(details.filePath) || permission === "media" && syntheticAudio && details.mediaType !== "video"));
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(permission === "fileSystem" && allowed(details.filePath) || permission === "media" && syntheticAudio && details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === "audio")));
  window = new BrowserWindow({ width: 1400, height: 950, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.on("will-prevent-unload", () => console.log("WEB_UNSAVED_BLOCKED"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(url);
  window.show();
  window.focus();
}).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => app.quit());
process.stdin.setEncoding("utf8");
process.stdin.on("data", text => {
  if (text.trim() === "quit") {
    app.exit(0);
  }
});
const timeout = setTimeout(() => { console.error("WASM smoke deadline expired."); app.exit(1); }, 900000);
timeout.unref();
