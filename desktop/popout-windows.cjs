"use strict";

const NAME = /^slopsidian-popout-[A-Za-z0-9_-]{1,64}$/;
const MAX_POPOUTS = 16;
const REQUEST = "slopsidian:popout-close-request";
const APPROVED = "slopsidian:popout-close-approved";
const CLOSED = "slopsidian:popout-closed";
const FAILED = "slopsidian:popout-close-failed";

/**
 * Same-process native popout windows for one owning application window.
 * A popout is an about:blank child created by the owner's window.open call, so the
 * owner's single App/plugin graph renders into it. The owner is the only page that may
 * approve a close, and every popout is destroyed when that owner navigates, reloads,
 * crashes or closes, so a stale popout can never attach to a replacement owner.
 */
function installPopouts({ owner, ipcMain, localUrl, isClosing, log = () => {}, max = MAX_POPOUTS }) {
  const windows = new Map();
  const approved = new Set();
  const ownerContents = owner.webContents;
  const ownerAllowed = event => event.sender === ownerContents && event.senderFrame === ownerContents.mainFrame && localUrl(event.senderFrame.url);

  const destroyAll = () => {
    for (const child of [...windows.values()]) {
      if (!child.isDestroyed()) { child.destroy(); }
    }
    windows.clear();
    approved.clear();
  };

  ownerContents.setWindowOpenHandler(details => {
    const name = details.frameName;
    if (isClosing() || details.url !== "about:blank" || typeof name !== "string" || !NAME.test(name) || windows.has(name) || windows.size >= max
      || owner.isDestroyed() || !localUrl(ownerContents.getURL())) {
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        title: "Slopsidian",
        minWidth: 320,
        minHeight: 240,
        backgroundColor: "#1e1e1e",
        autoHideMenuBar: true,
        show: true,
      },
    };
  });

  ownerContents.on("did-create-window", (child, details) => {
    const name = details.frameName;
    if (!NAME.test(name)) { child.destroy(); return; }
    const bounds = {};
    for (const key of ["x", "y", "width", "height"]) {
      const value = details.options?.[key];
      if (value === undefined) { continue; }
      if (!Number.isInteger(value) || ((key === "width" || key === "height") && value <= 0)) {
        log("The popout window's native bounds were invalid, so the window was not opened.");
        child.destroy();
        return;
      }
      bounds[key] = value;
    }
    // Use the native DIP setter instead of the constructor's extra Windows high-DPI size adjustment during restore.
    try { if (Object.keys(bounds).length) { child.setBounds(bounds); } }
    catch (error) {
      log(`The popout window's native bounds could not be restored: ${error instanceof Error ? error.message : String(error)}`);
      child.destroy();
      return;
    }
    windows.set(name, child);
    const contents = child.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", event => event.preventDefault());
    contents.on("will-attach-webview", event => event.preventDefault());
    child.on("close", event => {
      if (isClosing() || approved.delete(name) || owner.isDestroyed()) { return; }
      event.preventDefault();
      ownerContents.send(REQUEST, name);
    });
    child.on("closed", () => {
      if (windows.get(name) === child) { windows.delete(name); }
      approved.delete(name);
      if (!owner.isDestroyed() && !ownerContents.isDestroyed()) { ownerContents.send(CLOSED, name); }
    });
  });

  ipcMain.on(APPROVED, (event, name) => {
    if (!ownerAllowed(event) || typeof name !== "string" || !NAME.test(name)) { log("Ignored a popout close approval from an unexpected sender."); return; }
    const child = windows.get(name);
    if (!child || child.isDestroyed()) { return; }
    approved.add(name);
    // Registered after any other close listener, so it sees a veto (for example a guest that could not return to main).
    child.once("close", closing => {
      if (!closing.defaultPrevented) { return; }
      approved.delete(name);
      if (!owner.isDestroyed() && !ownerContents.isDestroyed()) { ownerContents.send(FAILED, name, "A page hosted in this window could not return to the main window."); }
    });
    child.close();
  });

  // A navigated, reloaded or crashed owner no longer holds these windows' leaves.
  ownerContents.on("did-start-navigation", details => { if (details.isMainFrame && !details.isSameDocument) { destroyAll(); } });
  ownerContents.on("render-process-gone", destroyAll);
  owner.on("closed", destroyAll);

  return { count: () => windows.size, destroyAll, names: () => [...windows.keys()], get: name => windows.get(name) };
}

module.exports = { installPopouts, popoutNamePattern: NAME, channels: { REQUEST, APPROVED, CLOSED, FAILED } };
