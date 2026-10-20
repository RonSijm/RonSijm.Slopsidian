import type { IpcRenderer } from "electron";
import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";
import { webAddress } from "./web-address";
import { webViewerIpc } from "./webviewer-bridge";
import { WebHistory } from "./web-history";
import { WebHistoryView } from "./web-history-view";
import { WebReaderFrame } from "./web-reader-frame";
import { readerArticle } from "./web-reader-policy";
import { readerAppearance } from "./web-reader-appearance";
import { readerScrollState, readerScrollHistoryState, rememberReaderScroll, readerScrollFor, type ReaderScroll } from "./web-reader-progress";
import { WebClipModal } from "./web-clip-modal";
import { webClip } from "./web-clip-policy";
import { selectionMarkdown } from "./web-clip-markdown";
import { WEB_ZOOM_MIN, WEB_ZOOM_MAX, webZoomFactor, webZoomShortcut, type WebZoomAction } from "../shared/web-zoom.cjs";

interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string;
  navigationId: number;
  zoomFactor: number;
  zoomRevision: number;
  adBlocking: { enabled: boolean; status: "off" | "loading" | "on" | "unavailable"; blockedRequests: number; revision: number };
}
interface BrowserEvent {
  id: string;
  state?: BrowserState;
  find?: { requestId: number; activeMatchOrdinal: number; matches: number };
  shortcut?: string;
  visit?: { url: string; title: string };
}

export class WebViewers {
  readonly id = "webviewer";
  readonly history: WebHistory;
  constructor(readonly app: App) { this.history = new WebHistory(app); }
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      if (!webViewerIpc()) { throw new Error("Web viewer requires the desktop application."); }
      this.history.start();
      const removeCommands = this.app.commands.install([
        { id: "webviewer:open", name: "Open web viewer", callback: () => core.run(() => this.openUrl(String(this.options.homepage || "about:blank"), true)) },
        { id: "webviewer:open-history", name: "Show web history", callback: () => core.run(() => this.openHistory()) },
        { id: "webviewer:save-to-vault", name: "Save web article to vault", checkCallback: checking => {
          const view = this.app.workspace.getActiveViewOfType(WebViewerView);
          if (!view) { return false; }
          if (!checking) { view.saveAsMarkdown(); }
          return true;
        } },
        { id: "webviewer:save-selection-to-vault", name: "Save web selection to vault", checkCallback: checking => {
          const view = this.app.workspace.getActiveViewOfType(WebViewerView);
          if (!view?.canSaveSelection()) { return false; }
          if (!checking) { view.saveAsMarkdown(true); }
          return true;
        } },
        { id: "webviewer:toggle-reader-mode", name: "Toggle reader mode", checkCallback: checking => {
          const view = this.app.workspace.getActiveViewOfType(WebViewerView);
          if (!view) { return false; }
          if (!checking) { void view.toggleReader(); }
          return true;
        } },
        { id: "webviewer:focus-address-bar", name: "Focus web viewer address bar", checkCallback: checking => {
          const view = this.app.workspace.getActiveViewOfType(WebViewerView);
          if (!view) { return false; }
          if (!checking) { view.focusAddress(); }
          return true;
        } },
        { id: "webviewer:find", name: "Find in web page", checkCallback: checking => {
          const view = this.app.workspace.getActiveViewOfType(WebViewerView);
          if (!view) { return false; }
          if (!checking) { view.showFind(); }
          return true;
        } },
        ...(["in", "out", "reset"] as const).map(action => ({
          id: "webviewer:zoom-" + action,
          name: action === "reset" ? "Reset web page zoom" : "Zoom " + action + " web page",
          checkCallback: (checking: boolean): boolean => {
            const view = this.app.workspace.getActiveViewOfType(WebViewerView);
            if (!view) { return false; }
            if (!checking) { void view.changeZoom(action).catch(reportError); }
            return true;
          },
        })),
      ]);
      let closeViews: () => void | Promise<void>;
      try { closeViews = await core.installViews(this.id, { webviewer: leaf => new WebViewerView(leaf, this), "webviewer-history": leaf => new WebHistoryView(leaf, this) }); }
      catch (error) { removeCommands(); await this.history.stop(); throw error; }
      const ribbon = iconButton("globe", "Open web viewer", () => this.app.commands.execute("webviewer:open").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      element("core-ribbon").append(ribbon);
      const follow = (event: Event): void => {
        const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (event.defaultPrevented || !(event instanceof MouseEvent) || event.button !== 0 || !target
          || this.options.openExternalURLs !== true || !/^https?:$/i.test(target.protocol)) { return; }
        // Respect the editor/renderer's owned handlers; this captures only real external anchors.
        event.preventDefault();
        core.run(() => this.openUrl(target.href, true)).catch(reportError);
      };
      document.addEventListener("click", follow);
      const settingsChanged = core.on("changed", () => {
        if (core.busy || !core.isEnabled(this.id)) { return; }
        for (const leaf of this.app.workspace.getLeavesOfType("webviewer")) {
          if (leaf.view instanceof WebViewerView) {
            leaf.view.syncReaderAppearance();
            void leaf.view.syncAdBlocking().catch(reportError);
          }
        }
      });
      return async () => {
        core.offref(settingsChanged);
        await closeViews();
        await this.history.stop();
        document.removeEventListener("click", follow);
        removeCommands();
        ribbon.remove();
      };
    }, this);
  }

  async openHistory(): Promise<void> {
    if (!this.app.core.isEnabled(this.id) || this.app.changingVault) { throw new Error("Enable Web viewer before opening history."); }
    const leaf = this.app.workspace.getLeavesOfType("webviewer-history")[0];
    if (leaf) { await this.app.workspace.revealLeaf(leaf); }
    else { await this.app.workspace.getLeaf("tab").setViewState({ type: "webviewer-history", state: {}, active: true }); }
  }

  async openUrl(value: string, newTab = true): Promise<void> {
    if (!this.app.core.isEnabled(this.id) || this.app.changingVault) { throw new Error("Enable Web viewer before opening a page."); }
    const url = webAddress(value, this.options);
    await this.app.workspace.getLeaf(newTab ? "tab" : false).setViewState({ type: "webviewer", state: { url }, active: true });
  }
}

export class WebViewerView extends ItemView {
  override icon = "globe";
  private readonly id = crypto.randomUUID();
  private readonly ipc: IpcRenderer;
  private readonly address = document.createElement("input");
  private readonly surface = document.createElement("div");
  private readonly message = document.createElement("p");
  private readonly status = document.createElement("output");
  private readonly adBlockingStatus = document.createElement("output");
  private adBlockingWanted: boolean | null = null;
  private adBlockingRevision = -1;
  private readonly findForm = document.createElement("form");
  private readonly findInput = document.createElement("input");
  private readonly findResult = document.createElement("output");
  private readonly back: HTMLButtonElement;
  private readonly forward: HTMLButtonElement;
  private readonly reload: HTMLButtonElement;
  private readonly external: HTMLButtonElement;
  private readonly readerButton: HTMLButtonElement;
  private readonly clipButton: HTMLButtonElement;
  private readonly selectionButton: HTMLButtonElement;
  private readonly zoomInButton: HTMLButtonElement;
  private readonly zoomOutButton: HTMLButtonElement;
  private readonly zoomResetButton: HTMLButtonElement;
  private zoomFactor = 1;
  private zoomRevision = -1;
  private clip: WebClipModal | null = null;
  private readonly readerWarning = document.createElement("p");
  private reader: WebReaderFrame | null = null;
  private pendingReader: WebReaderFrame | null = null;
  private readerWanted = false;
  private readerScroll: ReaderScroll | null = null;
  private readerScrollHistory: ReaderScroll[] = [];
  private progressSave: ReturnType<typeof setTimeout> | null = null;
  private readerBusy = false;
  private readerGeneration = 0;
  private readerAttempt = -1;
  private readerFindRequest = 0;
  private navigationId = -1;
  private url = "about:blank";
  private title = "";
  private loading = false;
  private created = false;
  private disposed = false;
  private frame: number | null = null;
  private lastBounds = "";
  private findRequest = 0;
  private lastQuery = "";

  constructor(leaf: WorkspaceLeaf, private readonly provider: WebViewers) {
    super(leaf);
    const ipc = webViewerIpc();
    if (!ipc) { throw new Error("Web viewer requires the desktop application."); }
    this.ipc = ipc;
    this.headerEl.hidden = true;
    this.contentEl.classList.add("webviewer");
    this.contentEl.dataset.webviewer = leaf.id;
    const toolbar = document.createElement("form");
    toolbar.className = "webviewer-toolbar";
    toolbar.setAttribute("aria-label", "Web navigation");
    this.back = this.button("Back", "back", () => this.action("back"));
    this.forward = this.button("Forward", "forward", () => this.action("forward"));
    this.reload = this.button("Reload", "reload", () => this.action(this.loading ? "stop" : "reload"));
    this.address.type = "text";
    this.address.placeholder = "Enter a web address or search";
    this.address.setAttribute("aria-label", "Web address or search");
    this.address.dataset.webviewerAddress = "";
    this.address.autocomplete = "off";
    this.address.spellcheck = false;
    const go = document.createElement("button");
    go.type = "submit"; go.textContent = "Go"; go.dataset.webviewerAction = "go";
    const find = this.button("Find", "find", () => this.showFind());
    const history = this.button("History", "history", () => this.provider.openHistory());
    this.readerButton = this.button("Reader", "reader", () => this.toggleReader());
    this.readerButton.setAttribute("aria-pressed", "false");
    this.clipButton = this.button("Save to vault", "clip", () => this.saveAsMarkdown());
    this.selectionButton = this.button("Save selection", "clip-selection", () => this.saveAsMarkdown(true));
    this.external = this.button("Open in browser", "external", () => this.action("external"));
    toolbar.append(this.back, this.forward, this.reload, this.address, go, find, this.readerButton, this.clipButton, this.selectionButton, history, this.external);
    const zoom = document.createElement("div"); zoom.className = "webviewer-zoom"; zoom.setAttribute("role", "group"); zoom.setAttribute("aria-label", "Web page zoom");
    this.zoomOutButton = this.button("Zoom out", "zoom-out", () => this.changeZoom("out")); this.zoomOutButton.textContent = "−"; this.zoomOutButton.setAttribute("aria-label", "Zoom out");
    this.zoomResetButton = this.button("Reset zoom", "zoom-reset", () => this.changeZoom("reset")); this.zoomResetButton.dataset.webviewerZoom = "";
    this.zoomInButton = this.button("Zoom in", "zoom-in", () => this.changeZoom("in")); this.zoomInButton.textContent = "+"; this.zoomInButton.setAttribute("aria-label", "Zoom in");
    zoom.append(this.zoomOutButton, this.zoomResetButton, this.zoomInButton); toolbar.append(zoom); this.updateZoomControls();
    this.findForm.className = "webviewer-find";
    this.findForm.hidden = true;
    this.findForm.setAttribute("aria-label", "Find in web page");
    this.findInput.setAttribute("aria-label", "Find text in web page");
    this.findInput.dataset.webviewerFind = "";
    this.findInput.maxLength = 1024;
    this.findResult.setAttribute("aria-live", "polite");
    this.findResult.dataset.webviewerMatches = "";
    this.findForm.append(this.findInput, this.findResult,
      this.button("Previous", "find-previous", () => this.find(false, true)),
      this.button("Next", "find-next", () => this.find(true, true)),
      this.button("Close find", "find-close", () => this.hideFind()));
    this.status.setAttribute("role", "status");
    this.status.dataset.webviewerStatus = "";
    this.adBlockingStatus.dataset.webviewerAdblocking = "";
    this.adBlockingStatus.setAttribute("role", "status");
    this.adBlockingStatus.title = "Bundled EasyList network rules. Reload after changing Block ads in Web viewer settings. Cosmetic hiding and automatic list updates are unavailable.";
    const footer = document.createElement("div"); footer.className = "webviewer-status-bar";
    footer.append(this.status, this.adBlockingStatus);
    this.message.className = "plugin-error webviewer-error";
    this.message.dataset.webviewerError = "";
    this.message.setAttribute("role", "alert");
    this.message.hidden = true;
    this.surface.className = "webviewer-surface";
    this.surface.setAttribute("aria-label", "Web page");
    this.surface.dataset.webviewerSurface = this.id;
    this.readerWarning.className = "webviewer-reader-warning"; this.readerWarning.dataset.webviewerReaderError = "";
    this.readerWarning.setAttribute("role", "alert"); this.readerWarning.hidden = true;
    this.contentEl.append(toolbar, this.findForm, this.message, this.readerWarning, this.surface, footer);
    this.registerDomEvent(toolbar, "submit", event => {
      event.preventDefault();
      this.navigate(this.address.value).catch(error => this.error(error));
    });
    this.registerDomEvent(this.findForm, "submit", event => { event.preventDefault(); this.find(true, true); });
    this.registerDomEvent(this.findInput, "input", () => this.find(true, false));
    this.registerDomEvent(this.findInput, "keydown", event => { if (event instanceof KeyboardEvent && event.key === "Escape") { event.preventDefault(); this.hideFind(); } });
    this.registerDomEvent(this.contentEl, "keydown", event => {
      if (!(event instanceof KeyboardEvent)) { return; }
      const zoomAction = (event.ctrlKey || event.metaKey) && !event.altKey ? webZoomShortcut(event.key) : null;
      if (zoomAction) { event.preventDefault(); event.stopPropagation(); void this.changeZoom(zoomAction).catch(error => this.error(error)); return; }
      if ((event.ctrlKey || event.metaKey) && ["f", "l", "h"].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation();
        if (event.key.toLowerCase() === "f") { this.showFind(); }
        else if (event.key.toLowerCase() === "h") { void this.provider.openHistory().catch(reportError); }
        else { this.focusAddress(); }
      }
    });
  }

  getViewType(): string { return "webviewer"; }
  getDisplayText(): string { return this.title || (this.url === "about:blank" ? "Web viewer" : this.url); }
  override getState(): Record<string, unknown> {
    const state = super.getState(); delete state.readerScroll; delete state.readerScrollHistory;
    return { ...state, url: this.url, title: this.title, readerMode: this.readerWanted, zoomFactor: this.zoomFactor, ...(this.readerScroll ? { readerScroll: copyViewData(this.readerScroll) } : {}), ...(this.readerScrollHistory.length ? { readerScrollHistory: this.readerScrollHistory.map(item => copyViewData(item)) } : {}) };
  }

  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    if (state.url !== undefined && typeof state.url !== "string") { throw new Error("Web viewer state needs a URL string."); }
    if (state.readerMode !== undefined && typeof state.readerMode !== "boolean") { throw new Error("Reader mode state must be a Boolean."); }
    const zoomFactor = webZoomFactor(state.zoomFactor === undefined ? 1 : state.zoomFactor);
    const scroll = readerScrollState(state.readerScroll);
    const history = readerScrollHistoryState(state.readerScrollHistory, scroll);
    const url = webAddress(String(state.url || "about:blank"), this.provider.options);
    this.resetReader(); this.readerScroll = scroll; this.readerScrollHistory = history; this.readerWanted = state.readerMode === true;
    const restored = await this.request("navigate", { url, zoomFactor }) as BrowserState;
    this.acceptZoom(restored.zoomFactor, restored.zoomRevision);
    this.url = url;
    this.title = typeof state.title === "string" ? state.title.slice(0, 1024) : "";
    this.address.value = url === "about:blank" ? "" : url;
    await super.setState(state, result);
    this.leaf.updateHeader();
    this.scheduleBounds();
    this.maybeReader();
  }

  protected override async onOpen(): Promise<void> {
    const receive = (_event: unknown, event: BrowserEvent): void => {
      if (event.id !== this.id || this.disposed) { return; }
      if (event.state) { this.update(event.state); }
      if (event.visit) { this.provider.history.record(event.visit.url, event.visit.title); }
      if (event.find && !this.reader && event.find.requestId >= this.findRequest) {
        this.findResult.textContent = `${event.find.activeMatchOrdinal} of ${event.find.matches}`;
      }
      if (event.shortcut === "address") { this.focusAddress(); }
      if (event.shortcut === "find") { this.showFind(); }
      if (event.shortcut === "history") { void this.provider.openHistory().catch(reportError); }
      if (event.shortcut === "close") { this.leaf.detach(); }
      // Native focus can arrive after a tab switch or during workspace restore.
      // Hidden pages and pages under a DOM overlay cannot take its active pane.
      if (event.shortcut === "activate" && !this.reader && this.nativeInteractive()) {
        this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
      }
    };
    this.ipc.on("webviewer:event", receive);
    this.register(() => this.ipc.removeListener("webviewer:event", receive));
    this.adBlockingWanted = this.provider.options.enableAdblocking === true;
    const initial = await this.request("create", { url: this.url, zoomFactor: this.zoomFactor, enableAdblocking: this.adBlockingWanted }) as BrowserState;
    this.acceptZoom(initial.zoomFactor, initial.zoomRevision);
    this.acceptAdBlocking(initial.adBlocking);
    this.created = true;
    this.updateReaderButton();
    this.updateZoomControls();
    const resize = new ResizeObserver(() => this.scheduleBounds());
    resize.observe(this.surface);
    const mutations = new MutationObserver(() => this.scheduleBounds());
    mutations.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["hidden", "open", "class", "style"] });
    this.register(() => { resize.disconnect(); mutations.disconnect(); });
    this.registerDomEvent(document, "scroll", () => this.scheduleBounds(), true);
    this.registerDomEvent(document, "toggle", () => this.scheduleBounds(), true);
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleBounds()));
    this.register(this.app.registerLeaveGuard(async () => {
      if (this.clip?.busy) { throw new Error("Wait for the article note to finish saving before leaving."); }
      this.clip?.close();
      await this.reader?.flushProgress();
      this.cancelProgressSave();
    }));
    this.scheduleBounds();
  }

  protected override async unloadViewContent(): Promise<void> {
    this.disposed = true;
    this.cancelProgressSave();
    this.clip?.forceClose();
    this.resetReader();
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
    await this.request("destroy");
    this.created = false;
  }
  protected override async onBeforeClose(): Promise<void> {
    await super.onBeforeClose();
    await this.reader?.flushProgress(); this.cancelProgressSave();
  }

  override onResize(): void { this.scheduleBounds(); }
  override focus(): void { this.focusAddress(); }
  focusAddress(): void { this.address.focus(); this.address.select(); }
  showFind(): void { this.findForm.hidden = false; this.findInput.focus(); this.findInput.select(); this.scheduleBounds(); }
  private hideFind(): void {
    this.findForm.hidden = true; this.findInput.value = ""; this.findResult.textContent = ""; this.lastQuery = "";
    this.find(true, false);
    this.focusAddress(); this.scheduleBounds();
  }

  private button(label: string, action: string, callback: () => unknown): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.title = label; button.dataset.webviewerAction = action;
    this.registerDomEvent(button, "click", () => { Promise.resolve().then(callback).catch(error => this.error(error)); });
    return button;
  }
  private request(action: string, values: Record<string, unknown> = {}): Promise<unknown> {
    return this.ipc.invoke("webviewer:request", { id: this.id, action, ...values });
  }
  private async navigate(value: string): Promise<void> {
    const url = webAddress(value, this.provider.options);
    if (!await this.flushReaderNavigation()) { return; }
    await this.request("navigate", { url });
    this.url = url;
    this.title = "";
    this.address.value = url;
    this.app.workspace.layoutChanged();
  }
  private async action(action: string): Promise<void> {
    if (["back", "forward", "reload"].includes(action) && !await this.flushReaderNavigation()) { return; }
    await this.request(action);
  }
  private async flushReaderNavigation(): Promise<boolean> {
    const frame = this.reader;
    if (!frame) { return !this.disposed && !this.app.changingVault; }
    const root = this.app.vault.rootPath, generation = this.readerGeneration;
    await frame.flushProgress();
    return !this.disposed && !this.app.changingVault && root === this.app.vault.rootPath && generation === this.readerGeneration && frame === this.reader;
  }
  private find(forward: boolean, next: boolean): void {
    const text = this.findInput.value;
    const continuation = next && this.lastQuery === text;
    this.lastQuery = text;
    if (!text) { this.findResult.textContent = ""; }
    if (this.reader) { this.reader.find(text, forward, continuation, ++this.readerFindRequest); return; }
    void this.request("find", { text, forward, next: continuation }).then(id => {
      if (typeof id === "number") { this.findRequest = id; }
    }).catch(error => this.error(error));
  }
  private error(error: unknown): void {
    if (this.disposed) { return; }
    this.message.textContent = error instanceof Error ? error.message : String(error);
    this.message.hidden = false;
    this.scheduleBounds();
  }
  async syncAdBlocking(): Promise<void> {
    if (this.disposed || !this.created || this.app.changingVault) { return; }
    const enabled = this.provider.options.enableAdblocking === true;
    if (enabled === this.adBlockingWanted) { return; }
    this.adBlockingWanted = enabled;
    try { await this.request("ad-blocking", { enabled }); }
    catch (error) {
      if (!this.disposed && !this.app.changingVault) { this.adBlockingWanted = null; throw error; }
    }
  }
  syncReaderAppearance(): void {
    if (this.disposed || this.app.changingVault) { return; }
    const appearance = readerAppearance(this.provider.options);
    this.reader?.setAppearance(appearance); this.pendingReader?.setAppearance(appearance);
  }
  private acceptAdBlocking(state: BrowserState["adBlocking"]): void {
    if (!state || typeof state.enabled !== "boolean" || !["off", "loading", "on", "unavailable"].includes(state.status)
      || !Number.isSafeInteger(state.blockedRequests) || state.blockedRequests < 0 || !Number.isSafeInteger(state.revision) || state.revision < this.adBlockingRevision) { return; }
    this.adBlockingRevision = state.revision;
    this.adBlockingStatus.dataset.webviewerAdblocking = state.status;
    this.adBlockingStatus.dataset.blockedRequests = String(state.blockedRequests);
    this.adBlockingStatus.textContent = state.status === "on" ? `Ad blocking on · ${state.blockedRequests} blocked`
      : state.status === "loading" ? "Preparing ad blocking…" : state.status === "off" ? "Ad blocking off"
      : "Ad blocking unavailable · Page resources paused; turn off Block ads or restart";
  }
  async changeZoom(change: WebZoomAction): Promise<void> {
    if (this.disposed || !this.created || this.app.changingVault || !this.app.core.isEnabled(this.provider.id)) { return; }
    const root = this.app.vault.rootPath;
    const result = await this.request("zoom", { change }) as { zoomFactor: number; zoomRevision: number };
    if (!this.disposed && root === this.app.vault.rootPath && !this.app.changingVault) { this.acceptZoom(result.zoomFactor, result.zoomRevision); }
  }
  private acceptZoom(value: number, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision < this.zoomRevision) { return; }
    const factor = webZoomFactor(value), changed = factor !== this.zoomFactor;
    this.zoomRevision = revision; this.zoomFactor = factor;
    this.reader?.setZoom(factor); this.pendingReader?.setZoom(factor); this.updateZoomControls();
    if (changed) { this.app.workspace.layoutChanged(); }
  }
  private updateZoomControls(): void {
    const percent = Math.round(this.zoomFactor * 100) + "%";
    this.zoomResetButton.textContent = percent; this.zoomResetButton.title = "Reset zoom (" + percent + ")"; this.zoomResetButton.setAttribute("aria-label", this.zoomResetButton.title);
    this.zoomInButton.disabled = this.zoomFactor >= WEB_ZOOM_MAX;
    this.zoomOutButton.disabled = this.zoomFactor <= WEB_ZOOM_MIN;
    this.zoomResetButton.disabled = this.zoomFactor === 1;
  }
  private update(state: BrowserState): void {
    this.acceptZoom(state.zoomFactor, state.zoomRevision);
    this.acceptAdBlocking(state.adBlocking);
    if (state.navigationId !== this.navigationId) {
      this.clip?.invalidate();
      this.navigationId = state.navigationId;
      this.resetReader();
    }
    const urlChanged = this.url !== state.url, changed = urlChanged || this.title !== state.title;
    this.url = state.url;
    this.title = state.title.slice(0, 1024);
    this.loading = state.loading;
    // Status/title updates can arrive after Go takes focus but before form submission.
    if (urlChanged && document.activeElement !== this.address) { this.address.value = this.url === "about:blank" ? "" : this.url; }
    this.back.disabled = !state.canGoBack;
    this.forward.disabled = !state.canGoForward;
    this.reload.textContent = state.loading ? "Stop" : "Reload";
    this.external.disabled = !/^https?:\/\//i.test(state.url);
    this.status.textContent = this.reader ? "Reader mode" : this.readerBusy ? "Preparing reader…" : state.loading ? "Loading page…" : state.error ? "Page unavailable" : this.url === "about:blank" ? "Enter a web address or search" : "Page loaded";
    this.contentEl.dataset.webviewerLoading = String(state.loading);
    this.message.textContent = state.error;
    this.message.hidden = !state.error;
    if (changed) { this.leaf.updateHeader(); this.app.workspace.layoutChanged(); }
    this.updateReaderButton();
    this.maybeReader();
    this.scheduleBounds();
  }

  async toggleReader(): Promise<void> {
    if (this.disposed || this.app.changingVault) { return; }
    if (this.clip?.isSelection) { this.clip.invalidate(); }
    this.readerWarning.hidden = true; this.readerWarning.textContent = "";
    if (this.readerWanted) {
      const generation = this.readerGeneration;
      this.readerWanted = false;
      await this.reader?.flushProgress();
      if (this.disposed || generation !== this.readerGeneration || this.readerWanted) { return; }
      this.resetReader();
      if (!this.findForm.hidden) { this.find(true, false); }
    } else {
      if (this.loading || !/^https?:\/\//i.test(this.url) || this.message.textContent) { this.readerFailure(new Error("Load a web page before using Reader.")); return; }
      this.readerWanted = true; this.readerAttempt = -1; this.maybeReader();
    }
    this.updateReaderButton(); this.app.workspace.layoutChanged(); this.scheduleBounds();
  }
  private updateReaderButton(): void {
    this.readerButton.textContent = this.readerBusy ? "Cancel reader" : this.reader ? "Original page" : "Reader";
    this.readerButton.setAttribute("aria-pressed", String(Boolean(this.reader)));
    this.readerButton.disabled = !this.readerWanted && (this.loading || !/^https?:\/\//i.test(this.url) || Boolean(this.message.textContent));
    this.clipButton.disabled = this.loading || this.readerBusy || !/^https?:\/\//i.test(this.url) || Boolean(this.message.textContent);
    this.selectionButton.disabled = !this.canSaveSelection();
    this.contentEl.dataset.webviewerReaderMode = this.reader ? "reader" : this.readerBusy ? "preparing" : "page";
  }
  canSaveSelection(): boolean {
    return this.created && !this.disposed && !this.app.changingVault && this.app.core.isEnabled(this.provider.id)
      && !this.loading && !this.readerBusy && (!this.readerWanted || Boolean(this.reader)) && /^https?:\/\//i.test(this.url) && !this.message.textContent;
  }
  saveAsMarkdown(selection = false): void {
    if (this.disposed || this.app.changingVault || !this.app.core.isEnabled(this.provider.id)) { return; }
    if (selection && !this.canSaveSelection()) { return; }
    if (this.clip?.isOpen) { this.clip.modalEl.focus(); return; }
    const url = this.url, navigationId = this.navigationId, root = this.app.vault.rootPath;
    const selectedReader = selection ? this.reader : null, revision = selectedReader?.documentRevision;
    const guard = (): void => {
      if (!root || root !== this.app.vault.rootPath || this.app.changingVault || this.disposed || !this.app.core.isEnabled(this.provider.id)
        || this.url !== url || this.navigationId !== navigationId || this.loading
        || selection && (this.reader !== selectedReader || this.readerBusy || selectedReader?.documentRevision !== revision)) {
        throw new Error("The vault, viewer or source page changed. Reopen Save to vault after it has loaded.");
      }
    };
    const modal = new WebClipModal(this.app, {
      selection,
      readerSelection: Boolean(selectedReader),
      defaults: () => this.provider.options,
      extract: async () => {
        guard();
        if (selectedReader) {
          await this.request("check-article", { url, navigationId }); guard();
          const picked = await selectedReader.captureSelection(); guard();
          return webClip({ url: picked.url, title: picked.title, markdown: selectionMarkdown(picked.title, picked.url, picked.text), navigationId }, url, navigationId);
        }
        const result = await this.request(selection ? "clip-selection" : "clip"); guard(); return webClip(result, url, navigationId);
      },
      folder: () => this.provider.options.markdownPath,
      guard,
      verify: async () => { await this.request("check-article", { url, navigationId }); },
      closed: () => { if (this.clip === modal) { this.clip = null; } this.scheduleBounds(); },
    });
    this.clip = modal; modal.open(); this.scheduleBounds();
  }
  private resetReader(): void {
    if (this.clip?.isSelection) { this.clip.invalidate(); }
    this.readerGeneration++; this.readerAttempt = -1; this.readerBusy = false;
    this.reader?.dispose(); this.pendingReader?.dispose(); this.reader = null; this.pendingReader = null;
    this.readerFindRequest = 0; this.findRequest = 0; this.lastQuery = "";
    this.readerWarning.textContent = ""; this.readerWarning.hidden = true;
    this.findResult.textContent = "";
    this.status.textContent = this.loading ? "Loading page…" : "Page loaded";
    this.updateReaderButton(); this.scheduleBounds();
  }
  private cancelProgressSave(): void {
    if (this.progressSave !== null) { clearTimeout(this.progressSave); this.progressSave = null; }
  }
  private acceptReaderProgress(value: number, url: string): void {
    if (this.readerScroll?.url === url && this.readerScroll.progress === value && this.readerScrollHistory.some(item => item.url === url)) { return; }
    this.readerScroll = { ...this.readerScrollHistory.find(item => item.url === url), ...(this.readerScroll?.url === url ? this.readerScroll : {}), url, progress: value };
    this.readerScrollHistory = rememberReaderScroll(this.readerScrollHistory, this.readerScroll);
    this.cancelProgressSave();
    this.progressSave = setTimeout(() => {
      this.progressSave = null;
      if (!this.disposed && !this.app.changingVault) { this.app.workspace.layoutChanged(); }
    }, 250);
  }
  private readerFailure(error: unknown): void {
    if (this.disposed) { return; }
    const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
    this.readerWarning.textContent = message.startsWith("Script failed to execute") ? "Reader could not extract this page. The original page is still available." : message;
    this.readerWarning.hidden = false; this.status.textContent = "Reader unavailable · Original page";
    this.updateReaderButton(); this.scheduleBounds();
  }
  private maybeReader(): void {
    if (!this.readerWanted || this.reader || this.readerBusy || this.loading || this.message.textContent || this.navigationId < 0 || this.readerAttempt === this.navigationId || !/^https?:\/\//i.test(this.url)) { return; }
    void this.prepareReader();
  }
  private async prepareReader(): Promise<void> {
    const generation = this.readerGeneration, root = this.app.vault.rootPath, url = this.url;
    const current = (): boolean => !this.disposed && generation === this.readerGeneration && root === this.app.vault.rootPath && this.readerWanted;
    this.readerAttempt = this.navigationId; this.readerBusy = true; this.updateReaderButton(); this.status.textContent = "Preparing reader…";
    try {
      const result = await this.request("reader") as Record<string, unknown>;
      if (!current() || result.navigationId !== this.navigationId) { return; }
      const article = readerArticle(result, url);
      const frame = new WebReaderFrame(article, {
        documentChanged: () => { if (this.reader === frame && this.clip?.isSelection) { this.clip.invalidate(); } },
        navigate: (target, newTab) => {
          if (!current() || this.app.changingVault) { return; }
          void (newTab ? this.provider.openUrl(target, true) : this.navigate(target)).catch(error => this.readerFailure(error));
        },
        shortcut: action => {
          if (!current()) { return; }
          if (action === "find") { this.showFind(); }
          if (action === "address") { this.focusAddress(); }
          if (action === "history") { void this.provider.openHistory().catch(error => this.readerFailure(error)); }
          if (action === "close") { this.leaf.detach(); }
          if (action === "zoom-in" || action === "zoom-out" || action === "zoom-reset") { void this.changeZoom(action.slice(5) as WebZoomAction).catch(error => this.readerFailure(error)); }
        },
        find: (requestId, active, matches, error) => {
          if (current() && requestId === this.readerFindRequest) { this.findResult.textContent = error || `${active} of ${matches}`; }
        },
        progress: value => {
          if (!this.disposed && generation === this.readerGeneration && root === this.app.vault.rootPath && this.url === url && this.reader === frame && !this.app.changingVault) { this.acceptReaderProgress(value, url); }
        },
      }, this.zoomFactor, readerAppearance(this.provider.options), readerScrollFor(this.readerScrollHistory, url));
      this.pendingReader = frame; frame.frame.hidden = true; this.surface.append(frame.frame);
      await frame.ready;
      if (!current()) { frame.dispose(); return; }
      frame.setZoom(this.zoomFactor);
      frame.setAppearance(readerAppearance(this.provider.options));
      this.pendingReader = null; this.reader = frame; frame.frame.hidden = false;
      frame.restoreProgress(readerScrollFor(this.readerScrollHistory, url));
      this.status.textContent = "Reader mode";
      if (!this.findForm.hidden) { this.find(true, false); }
    } catch (error) {
      if (!current()) { return; }
      this.pendingReader?.dispose(); this.pendingReader = null; this.readerWanted = false;
      this.readerFailure(error); this.app.workspace.layoutChanged();
    } finally {
      if (generation === this.readerGeneration) { this.readerBusy = false; this.updateReaderButton(); this.scheduleBounds(); }
    }
  }
  private nativeInteractive(): boolean {
    return !this.disposed && !this.app.changingVault && this.surface.checkVisibility()
      && !document.querySelector("dialog[open], [popover]:popover-open, .modal-container, .menu[role=menu]") && !this.message.textContent;
  }
  private scheduleBounds(): void {
    if (!this.created || this.disposed || this.frame !== null) { return; }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const box = this.surface.getBoundingClientRect();
      const interactive = this.nativeInteractive();
      const bounds = { visible: interactive && !this.reader, active: interactive && this.leaf === this.app.workspace.activeLeaf, x: box.x, y: box.y, width: box.width, height: box.height };
      const key = JSON.stringify(bounds);
      if (key !== this.lastBounds) {
        this.lastBounds = key;
        void this.request("bounds", { bounds }).catch(error => this.error(error));
      }
    });
  }
}
