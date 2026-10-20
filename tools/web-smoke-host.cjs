const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const { ack, acceptQuit, REJECTED } = require("./web-smoke-quit.cjs");

const option = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const url = option("site");
const profile = option("profile");
const fixture = option("fixture");
const quitNonce = option("quit-nonce");
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
const popupPolicy = require("./web-smoke-popup-policy.cjs").createPopupPolicy(origin, process.argv.includes("--allow-app-popouts"));
let window;
// Only the persistent-draft fixture creates this flag in its disposable profile.
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
  window.webContents.on("will-prevent-unload", event => { console.log("WEB_UNSAVED_BLOCKED"); if (require("node:fs").existsSync(path.join(profile, "persistent-drafts-leave.flag"))) { event.preventDefault(); } });
  window.webContents.on("console-message", event => {
    const verdict = acceptQuit({ nonce: quitNonce, message: event.message, frame: event.frame, mainFrame: window.webContents.mainFrame, frameUrl: event.frame?.url, origin });
    if (verdict.ignore) return;
    if (!verdict.ok) { console.log(REJECTED + verdict.reason); return; }
    // The acknowledgement is flushed to stdout before the process exits.
    process.stdout.write(ack(quitNonce) + "\n", () => app.exit(0));
  });
  window.webContents.setWindowOpenHandler(popupPolicy.windowOpenHandler);
  app.on("web-contents-created", (_event, contents) => { if (contents !== window.webContents) { popupPolicy.guardPopup(contents); } });
  await window.loadURL(url);
  window.show();
  window.focus();
}).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => app.quit());
process.stdin.setEncoding("utf8");
process.stdin.on("data", text => {
  if (text.trim() === "quit") {
    console.log("WEB_QUIT_RECEIVED windows=" + BrowserWindow.getAllWindows().length + " debugger=" + Boolean(window && !window.isDestroyed() && window.webContents.debugger.isAttached()));
    app.once("quit", (_event, code) => console.log("WEB_QUIT_EXIT " + code));
    app.exit(0);
  }
});
const timeout = setTimeout(() => { console.error("WASM smoke deadline expired."); app.exit(1); }, 900000);
timeout.unref();
