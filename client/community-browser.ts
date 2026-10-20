import type { App } from "./app";
import { CommunityCatalog, comparePluginVersions, validPluginVersion, type CommunityCatalogEntry, type CommunityPackage, type CommunityRelease } from "./community-catalog";
import { getBrowserHost } from "./contracts";
import { clearError, reportError } from "./dom";
import type { CommunityPackageReview, PluginHost } from "./plugin-host";
import { Modal } from "./ui";
import "./community-browser.css";

export async function confirmCommunityUninstall(plugins: PluginHost, review: CommunityPackageReview): Promise<boolean> {
  const manifest = review.installed?.manifest;
  if (!manifest) { throw new Error("The reviewed plugin is not installed."); }
  if (!window.confirm(`Uninstall "${manifest.name}"?\n\nThis stops the plugin, removes it from the enabled list, and permanently deletes its entire plugin directory, including data.json and other plugin settings/data. Notes elsewhere in the vault are not removed.`)) { return false; }
  await plugins.uninstallPlugin(review);
  return true;
}

export class CommunityBrowser extends Modal {
  private readonly catalog: CommunityCatalog;
  private readonly controller = new AbortController();
  private readonly root: string | null;
  private readonly selection: number;
  private unsubscribe: (() => void) | null = null;
  private leaveGuard: (() => void) | null = null;
  private entries: CommunityCatalogEntry[] = [];
  private selected: CommunityCatalogEntry | null = null;
  private release: CommunityRelease | null = null;
  private imported: CommunityPackage | null = null;
  private review: CommunityPackageReview | null = null;
  private list: HTMLElement | null = null;
  private query = "";
  private count = 60;
  private busy = false;
  private failure = "";
  private status = "";

  constructor(app: App, private readonly plugins: PluginHost, private readonly targetId?: string) {
    super(app);
    this.catalog = new CommunityCatalog(plugins.apiVersion);
    this.root = app.vault.rootPath;
    this.selection = plugins.selectionVersion;
    this.modalEl.classList.add("community-browser");
    this.containerEl.id = "community-browser";
    this.setTitle("Community plugins");
  }

  override onOpen(): void {
    this.unsubscribe = this.plugins.observe(() => {
      if (this.root !== this.app.vault.rootPath || this.selection !== this.plugins.selectionVersion) { this.close(); }
      else if (this.isOpen) { this.render(); }
    });
    this.leaveGuard = this.app.registerLeaveGuard(() => this.close());
    this.run(async () => {
      this.entries = await this.catalog.list(this.controller.signal);
      this.checkContext();
      if (this.targetId) {
        const entry = this.entries.find(candidate => candidate.id === this.targetId);
        if (entry) { await this.select(entry); }
        else { this.status = "This installed plugin is not in the official catalog. You can select downloaded release files to update it."; }
      }
    });
  }

  override onClose(): void {
    this.controller.abort();
    this.unsubscribe?.();
    this.leaveGuard?.();
  }

  private checkContext(): void {
    this.controller.signal.throwIfAborted();
    if (!this.isOpen || this.app.changingVault || this.root !== this.app.vault.rootPath || this.selection !== this.plugins.selectionVersion) {
      throw new Error("The vault selection changed. Reopen Community plugins before choosing or installing files.");
    }
  }

  private run(action: () => Promise<void>): void {
    if (this.busy) { return; }
    this.busy = true;
    this.failure = "";
    clearError();
    this.render();
    action().catch(error => {
      if (error instanceof DOMException && error.name === "AbortError" && this.controller.signal.aborted) { return; }
      this.failure = error instanceof Error ? error.message : String(error);
      reportError(error);
    }).finally(() => {
      this.busy = false;
      if (this.isOpen) { this.render(); }
    });
  }

  private button(parent: HTMLElement, label: string, action: () => Promise<void>, id?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (id) { button.id = id; }
    button.disabled = this.busy || this.plugins.isManaging || this.app.changingVault;
    button.addEventListener("click", () => this.run(action));
    parent.appendChild(button);
    return button;
  }

  private paragraph(parent: HTMLElement, text: string, className = "muted"): HTMLElement {
    const paragraph = document.createElement("p");
    paragraph.className = className;
    paragraph.textContent = text;
    parent.appendChild(paragraph);
    return paragraph;
  }

  private link(parent: HTMLElement, label: string, url: string): void {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    parent.appendChild(link);
  }

  private async select(entry: CommunityCatalogEntry): Promise<void> {
    this.checkContext();
    this.selected = entry;
    this.release = null;
    this.imported = null;
    this.review = null;
    this.status = "";
    this.render();
    this.release = await this.catalog.release(entry, this.controller.signal);
    this.checkContext();
    if (!this.app.vault.readOnly) { this.review = await this.plugins.reviewInstalled(entry.id); }
    this.checkContext();
  }

  private async install(bundle: CommunityPackage): Promise<void> {
    this.checkContext();
    const review = this.review;
    if (!review || review.id !== bundle.manifest.id) { throw new Error("Select and review this plugin's package first."); }
    const installed = review.installed;
    const description = installed
      ? `Update "${bundle.manifest.name}" from ${installed.manifest.version} to ${bundle.manifest.version}? Its data and enabled state will be preserved. Package files are replaced; omitting styles.css removes the previous stylesheet. A running plugin will be stopped and restarted.`
      : `Install "${bundle.manifest.name}" ${bundle.manifest.version}? Installation does not start it or add an enabled entry. An existing enabled entry is preserved and can start the plugin on the next vault opening.`;
    if (!window.confirm(description + "\n\nCommunity plugins are third-party code, not sandboxed. Enable only code you trust; it can access your vault and the host's available APIs.")) { return; }
    this.checkContext();
    await this.plugins.installPackage(bundle, review);
    if (!this.isOpen || this.controller.signal.aborted) { return; }
    this.checkContext();
    this.imported = null;
    this.review = await this.plugins.reviewInstalled(bundle.manifest.id);
    this.status = installed
      ? "Plugin updated. Its data and previous enabled/running state were preserved."
      : this.plugins.configuredPlugins.has(bundle.manifest.id)
        ? "Plugin installed without starting it. Its existing enabled entry was preserved; normal vault opening can start it."
        : "Plugin installed but not enabled. Use Enable separately when you trust it.";
  }

  private async uninstall(): Promise<void> {
    this.checkContext();
    if (!this.review) { throw new Error("Review this plugin's installed package before uninstalling it."); }
    const id = this.review.id;
    if (!await confirmCommunityUninstall(this.plugins, this.review) || !this.isOpen || this.controller.signal.aborted) { return; }
    this.checkContext();
    this.review = await this.plugins.reviewInstalled(id);
    this.status = "Plugin uninstalled. Its package directory and plugin data were removed.";
  }

  private selectFiles(parent: HTMLElement): void {
    const input = document.createElement("input");
    input.id = "community-release-files";
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.js,.css";
    input.hidden = true;
    input.disabled = this.busy || this.plugins.isManaging || this.app.vault.readOnly;
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) { return; }
      this.run(async () => {
        this.checkContext();
        const bundle = await this.catalog.files(files, this.selected?.id ?? this.targetId, this.release?.version);
        this.checkContext();
        this.review = await this.plugins.reviewInstalled(bundle.manifest.id);
        this.checkContext();
        this.imported = bundle;
        this.status = "Files validated without running their code. Review the package below before installing.";
      });
    });
    parent.appendChild(input);
    const button = document.createElement("button");
    button.type = "button";
    button.id = "community-select-release-files";
    button.textContent = "Select downloaded files";
    button.disabled = input.disabled;
    button.addEventListener("click", () => { input.value = ""; input.click(); });
    parent.appendChild(button);
  }

  private render(): void {
    this.contentEl.replaceChildren();
    this.contentEl.setAttribute("aria-busy", String(this.busy));
    this.paragraph(this.contentEl, "Browse the official Obsidian community registry. Compatibility uses an experimental, partial API " + this.plugins.apiVersion + "; a compatible minimum version does not guarantee every plugin feature.");
    if (this.app.vault.readOnly) { this.paragraph(this.contentEl, "This GitHub vault is read-only. Browsing is available; install, update and uninstall require a writable local-folder vault."); }
    if (getBrowserHost()) {
      const guidance = this.paragraph(this.contentEl, "WASM CORS limitation: GitHub's release downloads normally cannot be read by a web app, even though ordinary browser downloads work. We try directly first; if blocked, download manifest.json, main.js and optional styles.css from the same GitHub release, then select those files here. No relay or vault upload is used.");
      guidance.id = "community-cors-guidance";
      this.paragraph(this.contentEl, "Optional workaround: a CORS browser extension may permit direct downloads. It weakens browser protections; use only if you understand the risk, limit access to trusted sites, and turn it off afterward. No extension is installed or required.");
    }
    this.paragraph(this.contentEl, "Only package assets are installed. Selecting local files does not authenticate their author or source, and never imports data.json.");
    const toolbar = document.createElement("div");
    toolbar.className = "community-browser-toolbar";
    this.selectFiles(toolbar);
    this.button(toolbar, "Reload catalog", async () => {
      this.entries = await this.catalog.list(this.controller.signal);
      this.checkContext();
      this.status = "Catalog refreshed.";
    }, "community-catalog-reload");
    this.contentEl.appendChild(toolbar);
    if (this.failure) { this.paragraph(this.contentEl, this.failure, "plugin-error").setAttribute("role", "alert"); }
    if (this.status || this.busy) {
      const status = this.paragraph(this.contentEl, this.busy ? "Working..." : this.status);
      status.id = "community-browser-status";
      status.setAttribute("role", "status");
    }
    const columns = document.createElement("div");
    columns.className = "community-browser-columns";
    const catalog = document.createElement("section");
    const search = document.createElement("input");
    search.type = "search";
    search.id = "community-catalog-search";
    search.placeholder = "Search community plugins";
    search.setAttribute("aria-label", "Search community plugins");
    search.value = this.query;
    this.list = document.createElement("div");
    this.list.id = "community-catalog-list";
    search.addEventListener("input", () => { this.query = search.value; this.count = 60; this.renderList(); });
    catalog.append(search, this.list);
    const detail = document.createElement("section");
    detail.id = "community-plugin-detail";
    columns.append(catalog, detail);
    this.contentEl.appendChild(columns);
    this.renderList();
    this.renderDetail(detail);
  }

  private renderList(): void {
    if (!this.list) { return; }
    this.list.replaceChildren();
    const query = this.query.trim().toLocaleLowerCase();
    const entries = this.entries.filter(entry => [entry.name, entry.id, entry.description, entry.author, entry.repo].some(value => value.toLocaleLowerCase().includes(query)));
    this.paragraph(this.list, `${entries.length} plugins${query ? " match" : " in the catalog"}`);
    for (const entry of entries.slice(0, this.count)) {
      const row = document.createElement("div");
      row.className = "community-catalog-entry";
      const installed = this.plugins.installedPlugins.some(manifest => manifest.id === entry.id);
      const button = this.button(row, entry.name + (installed ? " (installed)" : ""), () => this.select(entry));
      button.dataset.catalogPlugin = entry.id;
      button.setAttribute("aria-pressed", String(this.selected?.id === entry.id));
      this.paragraph(row, entry.description);
      if (entry.unavailable) { this.paragraph(row, entry.unavailable, "plugin-error"); }
      this.list.appendChild(row);
    }
    if (entries.length > this.count) {
      this.button(this.list, "Show more", async () => { this.count += 60; }, "community-catalog-more");
    }
  }

  private renderDetail(parent: HTMLElement): void {
    const manifest = this.imported?.manifest ?? this.release?.manifest;
    if (!manifest) {
      this.paragraph(parent, this.selected ? this.failure ? "Release details unavailable. See the error above." : "Loading " + this.selected.name + "..." : "Select a plugin to review its release, or choose downloaded release files.");
      if (this.selected) { this.link(parent, "GitHub repository", "https://github.com/" + this.selected.repo); }
      return;
    }
    const heading = document.createElement("h3");
    heading.textContent = manifest.name;
    parent.appendChild(heading);
    this.paragraph(parent, manifest.description);
    const installed = this.plugins.installedPlugins.find(candidate => candidate.id === manifest.id);
    this.paragraph(parent, `Version ${manifest.version}${manifest.author ? " by " + manifest.author : ""}${installed ? ". Installed: " + installed.version : ""}`);
    const unavailable = this.plugins.unavailable(manifest);
    if (unavailable) { this.paragraph(parent, unavailable, "plugin-error"); }
    if (this.release) {
      const links = document.createElement("div");
      links.className = "community-browser-toolbar";
      this.link(links, "GitHub release and downloads", this.release.url);
      this.link(links, "Repository and README", "https://github.com/" + this.release.entry.repo);
      parent.appendChild(links);
    }
    const actions = document.createElement("div");
    actions.className = "community-browser-toolbar";
    if (this.imported) {
      this.paragraph(parent, "Selected local release files: manifest.json, main.js" + (this.imported.cssBase64 !== null ? ", styles.css." : ". No stylesheet; an update removes the previous styles.css."));
      const bundle = this.imported;
      this.button(actions, installed ? "Update from selected files" : "Install selected files", () => this.install(bundle), "community-install-selected").disabled ||= this.app.vault.readOnly || !this.review;
    } else if (this.release) {
      const release = this.release;
      const current = installed && validPluginVersion(installed.version) && comparePluginVersions(installed.version, release.version) >= 0;
      if (installed && !validPluginVersion(installed.version)) { this.paragraph(parent, "The installed version is not a comparable numeric version. Review the replacement version explicitly before updating.", "plugin-error"); }
      const download = this.button(actions, installed ? current ? "Installed version is current" : "Update" : "Install", async () => {
        const bundle = await this.catalog.download(release, this.controller.signal);
        this.checkContext();
        await this.install(bundle);
      }, "community-install-download");
      download.disabled ||= this.app.vault.readOnly || !this.review || Boolean(current);
    }
    if (installed) {
      const loaded = Boolean(this.plugins.getPlugin(manifest.id));
      this.button(actions, loaded ? "Disable" : "Enable", () => loaded ? this.plugins.disablePluginAndSave(manifest.id) : this.plugins.enablePluginAndSave(manifest.id), "community-browser-enable").disabled ||= !loaded && (this.plugins.isRestricted || unavailable !== null);
      this.button(actions, "Settings", async () => { this.close(); await this.app.dotNet.invokeMethodAsync("OnCommunityPluginSettings", manifest.id); }, "community-browser-settings").disabled ||= !this.app.settingsTabs.has(manifest.id);
      this.button(actions, "Uninstall", () => this.uninstall(), "community-browser-uninstall").disabled ||= this.app.vault.readOnly || !this.review;
    }
    parent.appendChild(actions);
    if (this.plugins.isRestricted) { this.paragraph(parent, "Restricted mode is on. Installed plugins remain paused until you explicitly turn on community plugins."); }
  }
}
