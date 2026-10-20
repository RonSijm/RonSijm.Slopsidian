"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { installPopouts } = require("D:\\RonSijm\\RonSijm.Slopsidian\\desktop\\popout-windows.cjs");
const profile = process.argv.find(arg => arg.startsWith("--profile="))?.slice(10);
const runtime = "D:\\RonSijm\\RonSijm.Slopsidian\\.runtime";
if (!profile || path.resolve(profile) !== profile || path.dirname(profile) !== runtime || !path.basename(profile).startsWith("geometry-control-reopen-") || fs.existsSync(profile)) {
  throw new Error("A new directly-owned geometry-control-reopen profile is required.");
}
fs.mkdirSync(profile);
app.setName("Slopsidian Reopen Geometry Control");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setAppLogsPath(path.join(profile, "logs"));
const normalize = process.argv.includes("--normalize");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { pid: process.pid, electron: process.versions.electron, normalize, controlSourceSha256: hash(__filename), nativePopoutSourceSha256: hash("D:\\RonSijm\\RonSijm.Slopsidian\\desktop\\popout-windows.cjs"), boundary: "Empty native windows only; diagnostic, not application acceptance. Reopen uses authoritative native bounds; unpainted about:blank DOM metrics may be stale.", cases: [] };
const owned = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    for (const productionOwner of [false, true]) {
      const owner = new BrowserWindow({
        x: 800, y: 120, width: 1400, height: 950, minWidth: 940, minHeight: 650,
        autoHideMenuBar: true,
        ...(productionOwner ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#303030", symbolColor: "#bcbcbc", height: 40 } } : {}),
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
      });
      owned.push(owner);
      await owner.loadURL("data:text/html,<title>Owned reopen geometry control</title>");
      const registry = installPopouts({ owner, ipcMain, localUrl: () => true, isClosing: () => false });
      if (normalize) {
        owner.webContents.on("did-create-window", (child, details) => {
          const { x, y, width, height } = details.options;
          child.setBounds({ x, y, width, height });
        });
      }
      let requested = { x: 160, y: 120, width: 723, height: 603 };
      for (let generation = 0; generation < 4; generation++) {
        let timer;
        const created = Promise.race([
          new Promise(resolve => owner.webContents.once("did-create-window", (child, details) => resolve({ child, details }))),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned popup creation timed out.")), 10000); }),
        ]).finally(() => clearTimeout(timer));
        const name = "slopsidian-popout-reopen" + productionOwner + generation;
        const features = `popup=yes,left=${requested.x},top=${requested.y},width=${requested.width},height=${requested.height}`;
        await owner.webContents.executeJavaScript(`window.geometryPopup=window.open("about:blank",${JSON.stringify(name)},${JSON.stringify(features)});window.geometryPopup.document.body.textContent="Owned popup geometry control";true`);
        const { child, details } = await created;
        owned.push(child);
        const item = { productionOwner, generation, requested, constructor: { width: details.options.width, height: details.options.height, useContentSize: details.options.useContentSize }, samples: [] };
        result.cases.push(item);
        for (const delay of [100, 600]) {
          await pause(delay);
          const dom = await owner.webContents.executeJavaScript("(()=>{const w=window.geometryPopup;return{x:w.screenX,y:w.screenY,width:w.outerWidth,height:w.outerHeight,innerWidth:w.innerWidth,innerHeight:w.innerHeight,dpr:w.devicePixelRatio}})()");
          item.samples.push({ delay, native: child.getBounds(), content: child.getContentBounds(), zoom: child.webContents.getZoomFactor(), scale: screen.getDisplayMatching(child.getBounds()).scaleFactor, dom });
        }
        requested = { ...item.samples.at(-1).native };
        registry.destroyAll();
      }
    }
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = String(error.stack ?? error);
  } finally {
    for (const win of owned.reverse()) { if (!win.isDestroyed()) { win.destroy(); } }
    fs.writeFileSync(path.join(profile, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(result.ok ? 0 : 1);
  }
}).catch(error => { console.error(error); app.exit(1); });
