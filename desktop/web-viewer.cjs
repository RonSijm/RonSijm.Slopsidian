const { WebContentsView, BrowserWindow, ipcMain, shell, nativeImage, app, net, session } = require("electron");
const { captureFavicon } = require("./web-favicon.cjs");
const { webUrl, viewBounds } = require("./web-viewer-policy.cjs");
const { readWebArticle } = require("./web-reader.cjs");
const { webZoomFactor, webZoomShortcut } = require("../shared/web-zoom.cjs");
const { setWebZoom, requestWebZoom } = require("./web-zoom.cjs");
const { siteZoomPreferences, applySiteZoom, updateSiteZoom } = require("./web-site-zoom.cjs");
const { WebAdBlock, adBlockingFlag } = require("./web-adblock.cjs");
const { FilterStore, fetchSubscription } = require("./web-adblock-filters.cjs");
const { applyCosmetics, clearCosmetics } = require("./web-cosmetic.cjs");
const { popoutNamePattern } = require("./popout-windows.cjs");

function installWebViewer(window, endpoint, options = {}) {
  const viewers = new Map();
  const mainContents = window.webContents;
  const channel = "webviewer:request";
  const filterChannel = "webviewer:filters";
  let fetchSession = null;
  const fetchImpl = options.fetch ?? ((url, init) => {
    fetchSession ??= session.fromPartition("slopsidian-web-filter-downloads");
    return fetchSession.fetch(url, { ...init, bypassCustomProtocolHandlers: true });
  });
  let downloading = false;
  const cosmetics = (viewer, scan = true) => {
    const contents = viewer.view.webContents;
    if (!contents.isDestroyed() && viewer.adBlocking.enabled) { void applyCosmetics(viewer, contents, () => viewers.get(viewer.id) === viewer, { scan }); }
  };
  const filters = new FilterStore({ onChange: match => {
    for (const viewer of viewers.values()) { viewer.adBlocking.replace(match); cosmetics(viewer); }
  } });
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
  const hostOf = viewer => viewer.host ?? window;
  const keysFor = host => (event, input) => {
    const action = input.type === "keyDown" && (input.control || input.meta) && !input.alt ? webZoomShortcut(input.key) : null;
    const viewer = action && [...viewers.values()].find(item => item.keyboardActive && hostOf(item) === host);
    if (viewer) { event.preventDefault(); zoom(viewer, { change: action }); }
  };
  const mainKeys = keysFor(window);
  mainContents.on("before-input-event", mainKeys);
  const watched = new WeakSet();
  const resolveHost = host => {
    if (host === undefined) { return window; }
    const child = typeof host === "string" && popoutNamePattern.test(host) ? options.popouts?.get(host) : null;
    if (!child || child.isDestroyed()) { throw new Error("The popout window for this Web viewer is not open, so the page stayed in its current window."); }
    return child;
  };
  // A closing popout hands its hosted pages back to the main window before the native view is destroyed with it.
  // Returns false (and surfaces the failure on the page) when any guest could not return, so the close can be vetoed.
  const reclaim = child => {
    let complete = true;
    for (const viewer of viewers.values()) {
      if (viewer.host !== child) { continue; }
      try { place(viewer, window); viewer.view.setVisible(false); viewer.keyboardActive = false; }
      catch (error) {
        complete = false;
        console.error("Could not return a Web viewer from a closing popout:", error);
        viewer.error = "The popout was kept open because this page could not return to the main window: " + error.message;
        update(viewer);
      }
    }
    return complete;
  };
  const place = (viewer, target) => {
    const from = hostOf(viewer);
    if (from === target) { return; }
    if (target.isDestroyed()) { throw new Error("The window for this Web viewer closed, so the page stayed in its current window."); }
    if (!from.isDestroyed()) { from.contentView.removeChildView(viewer.view); }
    try { target.contentView.addChildView(viewer.view); }
    catch (error) {
      if (!from.isDestroyed()) { from.contentView.addChildView(viewer.view); }
      throw error;
    }
    viewer.host = target === window ? null : target;
    if (target !== window && !watched.has(target)) {
      watched.add(target);
      target.webContents.on("before-input-event", keysFor(target));
      target.on("close", event => { if (!event.defaultPrevented && !reclaim(target)) { event.preventDefault(); } });
    }
  };
  const destroy = id => {
    const viewer = viewers.get(id);
    if (!viewer) { return; }
    viewers.delete(id);
    viewer.faviconController?.abort();
    viewer.adBlocking.dispose();
    const home = hostOf(viewer);
    if (!home.isDestroyed()) { home.contentView.removeChildView(viewer.view); }
    const contents = viewer.view.webContents;
    if (!contents.isDestroyed()) {
      const session = contents.session;
      contents.close({ waitForBeforeUnload: false });
      session.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
      session.removeAllListeners("will-download");
      void Promise.all([session.clearStorageData(), session.clearCache(), session.closeAllConnections()]).catch(error => console.error("Could not clear a closed Web viewer session:", error));
    }
  };
  const destroyAll = () => { for (const id of [...viewers.keys()]) { destroy(id); } filters.reset(); };

  ipcMain.handle(filterChannel, async (event, request) => {
    if (!owner(event)) { throw new Error("Web viewer filters are only controlled by the local application window."); }
    if (!request || typeof request !== "object") { throw new Error("Invalid filter request."); }
    switch (request.action) {
      case "fetch": {
        if (downloading) { throw new Error("A filter list download is already running."); }
        downloading = true;
        try { return await fetchSubscription(request.url, endpoint, { fetchImpl }); } finally { downloading = false; }
      }
      case "apply": return filters.apply(request.filters);
      case "reset": filters.reset(); return filters.status();
      case "status": return filters.status();
      default: throw new Error("Unknown Web viewer filter action.");
    }
  });

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
      const siteZoom = siteZoomPreferences(request.siteZoom === undefined ? { revision: 0, entries: [] } : request.siteZoom);
      const enableAdblocking = adBlockingFlag(request.enableAdblocking === undefined ? true : request.enableAdblocking);
      const view = new WebContentsView({ webPreferences: {
        nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, navigateOnDragDrop: false, partition: "webviewer-" + id,
      } });
      viewer = { id, view, url, error: "", committed: false, navigationId: 0, readerPending: false, zoomFactor, zoomRevision: 0, siteZoom, keyboardActive: false };
      viewers.set(id, viewer);
      const current = viewer;
      current.adBlocking = new WebAdBlock(endpoint, () => update(current), () => filters.current());
      view.setVisible(false);
      view.setBackgroundColor("#ffffff");
      window.contentView.addChildView(view);
      const contents = view.webContents;
      contents.on("dom-ready", () => {
        if (viewers.get(id) === current && !contents.isDestroyed()) { setWebZoom(current, current.zoomFactor); update(current); cosmetics(current); }
      });
      contents.on("zoom-changed", (event, direction) => {
        event.preventDefault(); zoom(current, { change: direction });
      });
      const visit = () => {
        if (!current.committed || current.error || viewers.get(id) !== current || contents.isDestroyed()) { return; }
        try {
          const url = webUrl(contents.getURL(), endpoint, { blank: false });
          send(id, { visit: { url, title: contents.getTitle().slice(0, 1024) } });
          send(id, { favicon: { url, navigationId: current.navigationId } });
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
          current.faviconController?.abort();
          current.navigationId++;
          if (!inPlace) { current.committed = false; current.cosmeticKey = null; current.cosmeticGeneration = (current.cosmeticGeneration ?? 0) + 1; current.adBlocking.reset(); }
          try { current.url = webUrl(url, endpoint); } catch { /* The navigation guard reports the blocked URL. */ }
          update(current);
        }
      });
      contents.on("did-navigate", (_event, url, status) => {
        current.url = url;
        current.committed = status >= 200 && status < 400;
        if (current.committed) {
          try { applySiteZoom(current); } catch { /* A failed optional preference leaves the acknowledged tab zoom intact. */ }
        }
      });
      contents.on("did-finish-load", () => { visit(); cosmetics(current); });
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
          hostOf(current).webContents.focus();
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
      case "favicon":
        return captureFavicon(viewer, endpoint, request, () => viewers.get(id) === viewer, nativeImage, app.getPath("temp"));
      case "ad-blocking":
        await viewer.adBlocking.configure(request.enabled);
        if (viewers.get(id) !== viewer || contents.isDestroyed()) { throw new Error("This Web viewer has closed."); }
        if (viewer.adBlocking.enabled) { cosmetics(viewer); } else { await clearCosmetics(viewer, contents); }
        break;
      case "zoom": return zoom(viewer, request);
      case "site-zoom": {
        const result = updateSiteZoom(viewer, request);
        update(viewer); return result;
      }
      case "reader": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer);
      case "clip": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer, { format: "markdown" });
      case "clip-page": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer, { format: "page" });
      case "clip-selection": return readWebArticle(viewer, endpoint, () => viewers.get(id) === viewer, { format: "selection" });
      case "check-article":
        if (request.navigationId !== viewer.navigationId || request.url !== webUrl(contents.getURL(), endpoint, { blank: false }) || !viewer.committed || contents.isLoadingMainFrame()) { throw new Error("The source page changed. Reopen Save to vault to review its current article."); }
        return;
      case "inspect": {
        // Smoke-only read-only report of which BrowserWindow contentViews physically hold this guest (Electron's CDP has no window query).
        if (options.inspect !== true) { throw new Error("Web viewer inspection is only available to the desktop smoke harness."); }
        const owners = BrowserWindow.getAllWindows().filter(candidate => !candidate.isDestroyed() && candidate.contentView.children.some(child => child === viewer.view || child.webContents === contents))
          .map(candidate => ({ id: candidate.id, main: candidate === window, title: candidate.getTitle() }));
        return { guestWebContentsId: contents.id, guestUrl: contents.getURL(), mainWindowId: window.id, owners };
      }
      case "bounds": {
        const target = resolveHost(request.host);
        const bounds = viewBounds(request.bounds, target.getContentSize(), target.webContents.getZoomFactor());
        place(viewer, target);
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
  window.once("closed", () => { destroyAll(); disposed = true; mainContents.removeListener("before-input-event", mainKeys); ipcMain.removeHandler(channel); ipcMain.removeHandler(filterChannel); });
}

module.exports = { installWebViewer };
