"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { installPopouts } = require("D:\\RonSijm\\RonSijm.Slopsidian\\desktop\\popout-windows.cjs");
const profile = process.argv.find(arg => arg.startsWith("--profile="))?.slice("--profile=".length);
const allowed = "D:\\RonSijm\\RonSijm.Slopsidian\\.runtime";
if (!profile || path.resolve(profile) !== profile || !path.relative(allowed, profile).startsWith("geometry-control-")) {
  throw new Error("Supply a new owned geometry-control profile.");
}
if (fs.existsSync(profile)) { throw new Error("The control profile must be new."); }
fs.mkdirSync(profile);
app.setName("Slopsidian Geometry Control");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setAppLogsPath(path.join(profile, "logs"));
const wanted = { x: 160, y: 120, width: 723, height: 603 };
const windows = [];
const result = { wanted, electron: process.versions.electron, pid: process.pid, measurements: [] };
const pause = () => new Promise(resolve => setTimeout(resolve, 300));
async function measure(label, win) {
  await pause();
  result.measurements.push({
    label,
    bounds: win.getBounds(),
    contentBounds: win.getContentBounds(),
    size: win.getSize(),
    scale: screen.getDisplayMatching(win.getBounds()).scaleFactor,
    dom: await win.webContents.executeJavaScript("({x:screenX,y:screenY,outerWidth,outerHeight,innerWidth,innerHeight,dpr:devicePixelRatio})"),
  });
}
app.whenReady().then(async () => {
  try {
    const options = { ...wanted, minWidth: 320, minHeight: 240, autoHideMenuBar: true, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } };
    const direct = new BrowserWindow(options);
    windows.push(direct);
    await direct.loadURL("data:text/html,<title>Owned geometry control</title>");
    await measure("direct-constructor", direct);
    direct.setBounds(wanted);
    await measure("direct-setBounds", direct);
    direct.setSize(wanted.width, wanted.height);
    await measure("direct-setSize", direct);
    for (const width of [720, 721, 722, 723, 724, 725]) {
      direct.setBounds({ x: wanted.x, y: wanted.y, width, height: width - 120 });
      await measure("pixel-grid-" + width, direct);
    }
    const owner = new BrowserWindow({ ...options, x: 800, width: 900, height: 700 });
    windows.push(owner);
    await owner.loadURL("data:text/html,<title>Owned popup geometry control</title>");
    const registry = installPopouts({ owner, ipcMain, localUrl: () => true, isClosing: () => false });
    let timer;
    const created = Promise.race([
      new Promise(resolve => owner.webContents.once("did-create-window", (child, details) => resolve({ child, details }))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned popup creation timed out.")), 10000); }),
    ]).finally(() => clearTimeout(timer));
    await owner.webContents.executeJavaScript(`window.geometryPopup=window.open("about:blank","slopsidian-popout-geometryOdd","popup=yes,left=160,top=120,width=723,height=603");true`);
    const { child, details } = await created;
    windows.push(child);
    result.childConstructorOptions = { width: details.options.width, height: details.options.height, useContentSize: details.options.useContentSize };
    await measure("window-open", child);
    await owner.webContents.executeJavaScript(`window.geometryPopup.resizeTo(723,603);true`);
    await measure("window-open-resizeTo", child);
    child.setBounds(wanted);
    await measure("window-open-setBounds", child);
    registry.destroyAll();
    result.ok = true;
  } catch (error) {
    result.error = String(error.stack ?? error);
    result.ok = false;
  } finally {
    for (const win of windows.reverse()) { if (!win.isDestroyed()) { win.destroy(); } }
    fs.writeFileSync(path.join(profile, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(result.ok ? 0 : 1);
  }
}).catch(error => { console.error(error); app.exit(1); });
