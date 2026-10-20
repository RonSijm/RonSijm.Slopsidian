import type { App } from "./app";
import { CommunityCatalog, comparePluginVersions, filterCatalog, sortCatalog, validPluginVersion, type CommunityCatalogEntry, type CommunityPackage, type CommunityRelease, type CommunitySort, type CommunityStatistics } from "./community-catalog";
import { applyBulkUpdates, planBulkUpdates, type BulkRow } from "./community-bulk";
import { parseReadme, renderReadme, type ParsedReadme } from "./community-readme";
import { getBrowserHost } from "./contracts";
import { clearError, reportError } from "./dom";
import type { CommunityPackageReview, PluginHost } from "./plugin-host";
import { Modal } from "./ui";
import "./community-browser.css";

type ReadmeState = { status: "loading" } | { status: "none" } | { status: "error"; message: string } | { status: "ready"; readme: ParsedReadme };

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
  private sort: CommunitySort = "name";
  private filter: "all" | "installed" | "available" = "all";
  private stats: CommunityStatistics | null = null;
  private statsFailure = "";
  private readme: ReadmeState | null = null;
  private bulk: BulkRow[] | null = null;
  private bulkProgress = "";
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
      await this.loadStatistics();
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

  private async loadStatistics(): Promise<void> {
    try {
      this.stats = await this.catalog.statistics(this.controller.signal);
      this.statsFailure = "";
    } catch (error) {
      if (this.controller.signal.aborted) { throw error; }
      this.stats = null;
      this.statsFailure = error instanceof Error ? error.message : String(error);
      if (this.sort === "popularity" || this.sort === "updated") { this.sort = "name"; }
    }
  }

  private async loadReadme(entry: CommunityCatalogEntry): Promise<void> {
    this.readme = { status: "loading" };
    this.render();
    let state: ReadmeState;
    try {
      const source = await this.catalog.readme(entry, this.controller.signal);
      state = source === null ? { status: "none" } : { status: "ready", readme: parseReadme(source) };
    } catch (error) {
      if (this.controller.signal.aborted) { throw error; }
      state = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (this.selected?.id === entry.id) { this.readme = state; }
  }

  private async select(entry: CommunityCatalogEntry): Promise<void> {
    this.checkContext();
    this.selected = entry;
    this.release = null;
    this.imported = null;
    this.review = null;
    this.readme = null;
    this.status = "";
    this.render();
    this.release = await this.catalog.release(entry, this.controller.signal);
    this.checkContext();
    if (!this.app.vault.readOnly) { this.review = await this.plugins.reviewInstalled(entry.id); }
    this.checkContext();
    await this.loadReadme(entry);
    this.checkContext();
  }

  private async checkUpdates(): Promise<void> {
    this.checkContext();
    this.bulk = null;
    this.status = "";
    this.bulk = await planBulkUpdates(this.plugins, this.catalog, this.entries, this.controller.signal, () => this.checkContext(), (done, total) => { this.bulkProgress = `Checked ${done} of ${total} installed plugins`; });
    this.bulkProgress = "";
    const available = this.bulk.filter(row => row.state === "update").length;
    this.status = this.bulk.length ? `${available} of ${this.bulk.length} installed plugins have a compatible update. Nothing has been downloaded or changed; select updates to review.` : "No community plugins are installed.";
  }

  private async applyUpdates(): Promise<void> {
    this.checkContext();
    const rows = this.bulk?.filter(row => row.selected && row.state === "update") ?? [];
    if (!rows.length) { throw new Error("Select at least one plugin update first."); }
    const lines = rows.map(row => `- ${row.name} (${row.id}): ${row.installed} -> ${row.target}`).join("\n");
    if (!window.confirm(`Update ${rows.length} reviewed plugin(s)?\n\n${lines}\n\nEach package is downloaded and installed one at a time; data and enabled state are preserved. A running plugin is stopped and restarted with the new code, so only update code you trust. Plugins that are not running stay stopped. Failures are reported per plugin and do not roll back earlier updates.\n\nCommunity plugins are third-party code, not sandboxed.`)) { return; }
    this.checkContext();
    await applyBulkUpdates(this.plugins, this.catalog, this.bulk!, this.controller.signal, () => this.checkContext());
    const updated = rows.filter(row => row.outcome?.startsWith("Updated")).length;
    this.status = `${updated} of ${rows.length} selected updates completed; see each result below.`;
    for (const row of rows) { row.selected = false; }
    if (this.selected && !this.app.vault.readOnly) { this.review = await this.plugins.reviewInstalled(this.selected.id); }
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
    this.bulk = null;
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
    this.bulk = null;
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
      await this.loadStatistics();
      this.checkContext();
      this.status = "Catalog refreshed.";
    }, "community-catalog-reload");
    this.button(toolbar, "Check for updates", () => this.checkUpdates(), "community-check-updates").disabled ||= this.app.vault.readOnly || !this.entries.length;
    this.contentEl.appendChild(toolbar);
    if (this.failure) { this.paragraph(this.contentEl, this.failure, "plugin-error").setAttribute("role", "alert"); }
    if (this.status || this.busy) {
      const status = this.paragraph(this.contentEl, this.busy ? this.bulkProgress || "Working..." : this.status);
      status.id = "community-browser-status";
      status.setAttribute("role", "status");
    }
    if (this.statsFailure) { this.paragraph(this.contentEl, "Download statistics are unavailable: " + this.statsFailure + " Popularity and recently-updated sorting are disabled.", "plugin-error").id = "community-statistics-failure"; }
    if (this.bulk) { this.renderBulk(this.contentEl); }
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
    const options = document.createElement("div");
    options.className = "community-browser-toolbar";
    const sort = document.createElement("select");
    sort.id = "community-catalog-sort";
    sort.setAttribute("aria-label", "Sort community plugins");
    for (const [value, label] of [["name", "Name"], ["popularity", "Most downloads"], ["updated", "Recently updated"], ["author", "Author"]] as const) {
      const option = new Option(label, value, false, this.sort === value);
      option.disabled = (value === "popularity" || value === "updated") && !this.stats;
      sort.appendChild(option);
    }
    sort.value = this.sort;
    sort.addEventListener("change", () => { this.sort = sort.value as CommunitySort; this.count = 60; this.renderList(); });
    const filter = document.createElement("select");
    filter.id = "community-catalog-filter";
    filter.setAttribute("aria-label", "Filter community plugins");
    for (const [value, label] of [["all", "All plugins"], ["installed", "Installed"], ["available", "Not installed"]] as const) { filter.appendChild(new Option(label, value)); }
    filter.value = this.filter;
    filter.addEventListener("change", () => { this.filter = filter.value as typeof this.filter; this.count = 60; this.renderList(); });
    options.append(sort, filter);
    catalog.append(search, options, this.list);
    const detail = document.createElement("section");
    detail.id = "community-plugin-detail";
    columns.append(catalog, detail);
    this.contentEl.appendChild(columns);
    this.renderList();
    this.renderDetail(detail);
  }

  private renderBulk(parent: HTMLElement): void {
    const rows = this.bulk!;
    const section = document.createElement("section");
    section.id = "community-bulk-updates";
    const heading = document.createElement("h3");
    heading.textContent = "Plugin updates";
    section.appendChild(heading);
    const table = document.createElement("div");
    table.className = "community-bulk-rows";
    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "community-bulk-row";
      item.dataset.bulkPlugin = row.id;
      item.dataset.bulkState = row.state;
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.selected;
      box.disabled = row.state !== "update" || this.busy || this.plugins.isManaging;
      box.setAttribute("aria-label", "Update " + row.name);
      box.addEventListener("change", () => { row.selected = box.checked; this.render(); });
      label.append(box, document.createTextNode(` ${row.name} (${row.id}) ${row.installed}${row.target && row.state === "update" ? " -> " + row.target : ""}`));
      item.appendChild(label);
      const note = row.outcome ?? row.message ?? (row.state === "current" ? "Up to date for this host's API." : "");
      if (note) { this.paragraph(item, note, row.outcome?.startsWith("Updated") || row.state === "current" ? "muted" : row.state === "update" ? "muted" : "plugin-error"); }
      table.appendChild(item);
    }
    section.appendChild(table);
    const actions = document.createElement("div");
    actions.className = "community-browser-toolbar";
    const selectable = rows.filter(row => row.state === "update");
    const chosen = selectable.filter(row => row.selected).length;
    const all = this.button(actions, "Select all updates", async () => { for (const row of selectable) { row.selected = true; } }, "community-bulk-select-all");
    all.disabled ||= !selectable.length;
    this.button(actions, `Review and update selected (${chosen})`, () => this.applyUpdates(), "community-bulk-apply").disabled ||= !chosen;
    this.button(actions, "Close update list", async () => { this.bulk = null; this.status = ""; }, "community-bulk-close");
    section.appendChild(actions);
    parent.appendChild(section);
  }

  private renderList(): void {
    if (!this.list) { return; }
    this.list.replaceChildren();
    const installedIds = new Set(this.plugins.installedPlugins.map(manifest => manifest.id));
    const matches = filterCatalog(this.entries, this.query).filter(entry => this.filter === "all" || (this.filter === "installed") === installedIds.has(entry.id));
    const entries = sortCatalog(matches, this.sort, this.stats);
    const query = this.query.trim();
    this.paragraph(this.list, `${entries.length} plugins${query || this.filter !== "all" ? " match" : " in the catalog"}`);
    const format = new Intl.NumberFormat();
    for (const entry of entries.slice(0, this.count)) {
      const row = document.createElement("div");
      row.className = "community-catalog-entry";
      const installed = installedIds.has(entry.id);
      const button = this.button(row, entry.name + (installed ? " (installed)" : ""), () => this.select(entry));
      button.dataset.catalogPlugin = entry.id;
      button.setAttribute("aria-pressed", String(this.selected?.id === entry.id));
      const downloads = this.stats?.get(entry.id)?.downloads;
      this.paragraph(row, [entry.author ? "by " + entry.author : "", this.stats ? downloads === null || downloads === undefined ? "downloads not reported" : format.format(downloads) + " downloads" : ""].filter(Boolean).join(" · ")).className = "muted community-catalog-meta";
      this.paragraph(row, entry.description);
      if (entry.unavailable) { this.paragraph(row, entry.unavailable, "plugin-error"); }
      this.list.appendChild(row);
    }
    if (entries.length > this.count) {
      this.button(this.list, "Show more", async () => { this.count += 60; }, "community-catalog-more");
    }
  }

  private renderReadme(parent: HTMLElement): void {
    const state = this.readme;
    if (!state) { return; }
    const section = document.createElement("section");
    section.id = "community-plugin-readme";
    const heading = document.createElement("h4");
    heading.textContent = "README";
    section.appendChild(heading);
    if (state.status === "loading") { this.paragraph(section, "Loading README..."); }
    else if (state.status === "none") { this.paragraph(section, "This repository has no README.md or readme.md on its default branch."); }
    else if (state.status === "error") { this.paragraph(section, "README unavailable: " + state.message, "plugin-error"); }
    else {
      this.paragraph(section, "Third-party content shown as inert text: images and HTML are not loaded and no code runs.");
      const body = document.createElement("div");
      body.className = "community-readme";
      renderReadme(body, state.readme);
      section.appendChild(body);
    }
    parent.appendChild(section);
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
    const downloads = this.stats?.get(manifest.id)?.downloads;
    if (this.stats) { this.paragraph(parent, downloads === null || downloads === undefined ? "Download count: not reported by the registry statistics." : "Downloads: " + new Intl.NumberFormat().format(downloads) + " (all releases, per the official registry statistics)."); }
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
    if (this.release && !this.imported) { this.renderReadme(parent); }
  }
}
