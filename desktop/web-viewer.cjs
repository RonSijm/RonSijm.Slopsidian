const { WebContentsView, ipcMain, shell } = require("electron");
const { webUrl, viewBounds } = require("./web-viewer-policy.cjs");
const { readWebArticle } = require("./web-reader.cjs");
const { webZoomFactor, webZoomShortcut } = require("../shared/web-zoom.cjs");
const { setWebZoom, requestWebZoom } = require("./web-zoom.cjs");
const { WebAdBlock, adBlockingFlag } = require("./web-adblock.cjs");

function installWebViewer(window, endpoint) {
  const viewers = new Map();
  const mainContents = window.webContents;
  const channel = "webviewer:request";
  let disposed = false;
  const owner = event => !disposed && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === endpoint;
  const send = (id, value) => {
    if (!disposed && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("webviewer:event", { id, ...value });
    }
  };
  const snapshot = viewer => {
    const contents = viewer.view.webContents;
    return {
      url: viewer.url, title: contents.getTitle(), loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(),
      error: viewer.error,
      navigationId: viewer.navigationId,
      zoomFactor: viewer.zoomFactor, zoomRevision: viewer.zoomRevision,
      adBlocking: viewer.adBlocking.snapshot(),
    };
  };
  const update = viewer => {
    if (viewers.get(viewer.id) === viewer && !viewer.view.webContents.isDestroyed()) {
      send(viewer.id, { state: snapshot(viewer) });
    }
  };
  const navigate = (viewer, value) => {
    const url = webUrl(value, endpoint);
    viewer.error = "";
    viewer.url = url;
    void viewer.view.webContents.loadURL(url).catch(error => {
      if (viewers.get(viewer.id) === viewer && error.code !== "ERR_ABORTED") {
        viewer.error = "Could not load this page: " + error.message;
        update(viewer);
      }
    });
  };
  const zoom = (viewer, request) => {
    const result = requestWebZoom(viewer, request);
    update(viewer);
    return result;
  };
  const mainKeys = (event, input) => {
    const action = input.type === "keyDown" && (input.control || input.meta) && !input.alt ? webZoomShortcut(input.key) : null;
    const viewer = action && [...viewers.values()].find(item => item.keyboardActive);
    if (viewer) { event.preventDefault(); zoom(viewer, { change: action }); }
  };
  mainContents.on("before-input-event", mainKeys);
  const destroy = id => {
    const viewer = viewers.get(id);
    if (!viewer) { return; }
    viewers.delete(id);
    viewer.adBlocking.dispose();
    if (!window.isDestroyed()) { window.contentView.removeChildView(viewer.view); }
    const contents = viewer.view.webContents;
    if (!contents.isDestroyed()) {
      const session = contents.session;
      contents.close({ waitForBeforeUnload: false });
      session.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
      session.removeAllListeners("will-download");
      void Promise.all([session.clearStorageData(), session.clearCache(), session.closeAllConnections()]).catch(error => console.error("Could not clear a closed Web viewer session:", error));
    }
  };
  const destroyAll = () => { for (const id of [...viewers.keys()]) { destroy(id); } };

  ipcMain.handle(channel, async (event, request) => {
    if (!owner(event)) { throw new Error("Web viewer is only controlled by the local application window."); }
    if (!request || typeof request.id !== "string" || !/^[a-f0-9-]{36}$/.test(request.id)) {
      throw new Error("Invalid Web viewer identifier.");
    }
    const { id, action } = request;
    let viewer = viewers.get(id);
    if (action === "destroy") { destroy(id); return; }
    if (action === "create") {
      if (viewer || viewers.size >= 32) { throw new Error("Close an existing Web viewer before opening another."); }
      const url = webUrl(request.url, endpoint);
      const zoomFactor = webZoomFactor(request.zoomFactor === undefined ? 1 : request.zoomFactor);
      const enableAdblocking = adBlockingFlag(request.enableAdblocking === undefined ? true : request.enableAdblocking);
      const view = new WebContentsView({ webPreferences: {
        nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, navigateOnDragDrop: false, partition: "webviewer-" + id,
      } });
      viewer = { id, view, url, error: "", committed: false, navigationId: 0, readerPending: false, zoomFactor, zoomRevision: 0, keyboardActive: false };
      viewers.set(id, viewer);
      const current = viewer;
      current.adBlocking = new WebAdBlock(endpoint, () => update(current));
      view.setVisible(false);
      view.setBackgroundColor("#ffffff");
      window.contentView.addChildView(view);
      const contents = view.webContents;
      contents.on("dom-ready", () => {
        if (viewers.get(id) === current && !contents.isDestroyed()) { setWebZoom(current, current.zoomFactor); update(current); }
      });
      contents.on("zoom-changed", (event, direction) => {
        event.preventDefault(); zoom(current, { change: direction });
      });
      const visit = () => {
        if (!current.committed || current.error || viewers.get(id) !== current || contents.isDestroyed()) { return; }
        try {
          const url = webUrl(contents.getURL(), endpoint, { blank: false });
          send(id, { visit: { url, title: contents.getTitle().slice(0, 1024) } });
        } catch { /* Blank, failed and blocked pages never become history entries. */ }
      };
      // This ephemeral session never receives the default session's vault token.
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
      contents.session.setDevicePermissionHandler(() => false);
      contents.session.on("will-download", event => {
        event.preventDefault(); current.error = "Downloads are unavailable in Web viewer. Open the page in your browser to download."; update(current);
      });
      contents.session.webRequest.onBeforeRequest((details, callback) => {
        callback(current.adBlocking.request(details));
      });
      const guard = (event, url) => {
        try { webUrl(url, endpoint); }
        catch (error) { event.preventDefault(); current.error = error.message; update(current); }
      };
      contents.on("will-navigate", guard);
      contents.on("will-redirect", guard);
      contents.on("will-frame-navigate", event => guard(event, event.url));
      contents.on("will-attach-webview", event => event.preventDefault());
      contents.setWindowOpenHandler(({ url }) => {
        try { navigate(current, url); }
        catch (error) { current.error = error.message; update(current); }
        return { action: "deny" };
      });
      contents.on("did-start-loading", () => { current.error = ""; update(current); });
      contents.on("did-start-navigation", (_event, url, inPlace, mainFrame) => {
        if (mainFrame) {
          current.navigationId++;
          if (!inPlace) { current.committed = false; current.adBlocking.reset(); }
          try { current.url = webUrl(url, endpoint); } catch { /* The navigation guard reports the blocked URL. */ }
          update(current);
        }
      });
      contents.on("did-navigate", (_event, url, status) => {
        current.url = url;
        current.committed = status >= 200 && status < 400;
      });
      contents.on("did-finish-load", visit);
      contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
        if (mainFrame) { current.url = url; visit(); }
      });
      for (const name of ["did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) {
        contents.on(name, () => update(current));
      }
      contents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
        if (mainFrame && code !== -3) { current.committed = false; current.error = `Could not load this page: ${description}`; update(current); }
      });
      contents.on("render-process-gone", () => { current.error = "The page stopped. Reload to try again."; update(current); });
      contents.on("found-in-page", (_event, result) => send(id, { find: { requestId: result.requestId, activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches } }));
      contents.on("focus", () => send(id, { shortcut: "activate" }));
      contents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") { return; }
        const key = input.key.toLowerCase();
        const zoomAction = (input.control || input.meta) && !input.alt ? webZoomShortcut(input.key) : null;
        if (zoomAction) { event.preventDefault(); zoom(current, { change: zoomAction }); return; }
        if ((input.control || input.meta) && ["l", "f", "w", "h"].includes(key)) {
          event.preventDefault();
          window.webContents.focus();
          send(id, { shortcut: key === "l" ? "address" : key === "f" ? "find" : key === "h" ? "history" : "close" });
        }
      });
      await current.adBlocking.configure(enableAdblocking);
      if (viewers.get(id) !== current || contents.isDestroyed()) { throw new Error("This Web viewer has closed."); }
      navigate(current, url);
      return snapshot(current);
    }
    if (!viewer || viewer.view.webContents.isDestroyed()) { throw new Error("This Web viewer has closed."); }
    const contents = viewer.view.webContents;
    switch (action) {
      case "ad-blocking":
        await viewer.adBlocking.configure(request.enabled);
        if (viewers.get(id) !== viewer || contents.isDestroyed()) { throw new Error("This Web viewer has closed."); }
        break;
      case "zoom": return zoom(viewer, request);
      case "reader": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer);
      case "clip": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer, { format: "markdown" });
      case "clip-selection": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer, { format: "selection" });
      case "check-article":
        if (request.navigationId !== viewer.navigationId || request.url !== webUrl(contents.getURL(), endpoint, { blank: false }) || !viewer.committed || contents.isLoadingMainFrame()) { throw new Error("The source page changed. Reopen Save to vault to review its current article."); }
        return;
      case "bounds": {
        const bounds = viewBounds(request.bounds, window.getContentSize(), window.webContents.getZoomFactor());
        if (bounds) { viewer.view.setBounds(bounds); }
        viewer.view.setVisible(Boolean(bounds));
        viewer.keyboardActive = request.bounds?.active === true;
        if (viewer.keyboardActive) { for (const other of viewers.values()) { if (other !== viewer) { other.keyboardActive = false; } } }
        return;
      }
      case "navigate": {
        const url = webUrl(request.url, endpoint);
        if (request.zoomFactor !== undefined) { setWebZoom(viewer, request.zoomFactor); }
        navigate(viewer, url); break;
      }
      case "back": viewer.error = ""; if (contents.navigationHistory.canGoBack()) { contents.navigationHistory.goBack(); } break;
      case "forward": viewer.error = ""; if (contents.navigationHistory.canGoForward()) { contents.navigationHistory.goForward(); } break;
      case "reload": viewer.error = ""; contents.reload(); break;
      case "stop": contents.stop(); break;
      case "find":
        if (typeof request.text !== "string" || request.text.length > 1024) { throw new Error("Enter a shorter find query."); }
        // Electron's findNext=true starts a new session; false continues it.
        if (request.text) { return contents.findInPage(request.text, { forward: request.forward !== false, findNext: request.next !== true }); }
        contents.stopFindInPage("clearSelection");
        return;
      case "external": await shell.openExternal(webUrl(contents.getURL(), endpoint, { blank: false })); break;
      default: throw new Error("Unknown Web viewer action.");
    }
    return snapshot(viewer);
  });
  window.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { destroyAll(); }
  });
  window.webContents.on("render-process-gone", destroyAll);
  window.once("closed", () => { destroyAll(); disposed = true; mainContents.removeListener("before-input-event", mainKeys); ipcMain.removeHandler(channel); });
}

module.exports = { installWebViewer };
