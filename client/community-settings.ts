import type { App } from "./app";
import type { PluginManifest } from "./contracts";
import { CommunityBrowser, confirmCommunityUninstall } from "./community-browser";
import { clearError, element } from "./dom";
import type { PluginHost } from "./plugin-host";

export class CommunitySettings {
  private readonly host = element("community-settings-host");
  private failure = "";
  private query = "";
  private selection = -1;

  constructor(private readonly app: App, private readonly plugins: PluginHost) {
    plugins.observe(() => this.render());
    app.core.on("changed", () => this.render());
    this.render();
  }

  private run(action: () => Promise<void>): void {
    this.failure = "";
    clearError();
    action().catch(error => {
      console.error(error);
      this.failure = error instanceof Error ? error.message : String(error);
      this.render();
    });
  }

  private button(label: string, action: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = this.plugins.isManaging || this.app.changingVault || !this.app.vault.rootPath;
    button.addEventListener("click", () => this.run(action));
    return button;
  }

  private message(container: HTMLElement, text: string, error = false): void {
    const paragraph = document.createElement("p");
    paragraph.className = error ? "plugin-error" : "muted";
    if (error) { paragraph.setAttribute("role", "alert"); }
    paragraph.textContent = text;
    container.appendChild(paragraph);
  }

  private render(): void {
    if (this.selection !== this.plugins.selectionVersion) {
      this.selection = this.plugins.selectionVersion;
      this.failure = "";
      this.query = "";
    }
    this.host.replaceChildren();
    if (this.app.vault.readOnly) this.message(this.host, "GitHub vault settings and installed plugins come from .obsidian. Preference and enablement changes are saved locally. Plugin actions that modify vault files remain read-only.");
    const failure = this.failure || this.plugins.configurationError;
    if (failure) {
      const error = document.createElement("p");
      error.id = "community-settings-error";
      error.className = "plugin-error";
      error.setAttribute("role", "alert");
      error.textContent = failure;
      this.host.appendChild(error);
    }
    const mode = document.createElement("section");
    mode.className = "core-plugin-card";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = "Restricted mode";
    this.message(info, this.plugins.isRestricted
      ? "Community plugins are paused. Turning them on runs the plugins enabled in this vault."
      : "Community plugins are allowed. Restricted mode stops them without changing this vault's enabled-plugin list.");
    info.prepend(name);
    const toggle = this.button(this.plugins.isRestricted ? "Turn on community plugins" : "Turn on restricted mode", () => this.plugins.setRestricted(!this.plugins.isRestricted));
    toggle.id = "community-restricted-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", "Restricted mode");
    toggle.setAttribute("aria-checked", String(this.plugins.isRestricted));
    mode.append(info, toggle);
    this.host.appendChild(mode);

    const toolbar = document.createElement("div");
    toolbar.className = "community-plugin-toolbar";
    const search = document.createElement("input");
    search.id = "community-plugin-search";
    search.type = "search";
    search.placeholder = "Search installed plugins";
    search.setAttribute("aria-label", "Search installed plugins");
    search.value = this.query;
    const refresh = this.button("Reload plugins", () => this.plugins.refreshInstalled());
    refresh.id = "community-plugin-reload";
    const browse = this.button("Browse", async () => { new CommunityBrowser(this.app, this.plugins).open(); });
    browse.id = "community-plugin-browse";
    toolbar.append(search, browse, refresh);
    this.host.appendChild(toolbar);
    const title = document.createElement("h3");
    title.textContent = `Installed plugins (${this.plugins.installedPlugins.length})`;
    const list = document.createElement("div");
    list.id = "installed-community-plugins";
    search.addEventListener("input", () => { this.query = search.value; this.renderInstalled(list); });
    this.host.append(title, list);
    this.renderInstalled(list);
    for (const id of this.plugins.configuredPlugins) {
      if (this.plugins.installedPlugins.some(manifest => manifest.id === id)) { continue; }
      const missing = document.createElement("section");
      missing.className = "plugin-card";
      missing.dataset.missingPlugin = id;
      this.message(missing, this.app.vault.readOnly
        ? `Enabled in this vault, but .obsidian/plugins/${id}/ is missing from the GitHub snapshot. Include manifest.json and main.js in the repository to load it. The enabled entry has been preserved.`
        : `Enabled in this vault but not installed: ${id}. The enabled entry has been preserved.`);
      const forget = this.button("Remove from enabled list", async () => {
        if (window.confirm(this.app.vault.readOnly ? `Remove "${id}" from this browser's enabled-plugin list? Repository files will stay unchanged.` : `Remove "${id}" from .obsidian/community-plugins.json? No plugin files or settings will be deleted.`)) {
          await this.plugins.disablePluginAndSave(id);
        }
      });
      missing.appendChild(forget);
      this.host.appendChild(missing);
    }
  }

  private renderInstalled(container: HTMLElement): void {
    container.replaceChildren();
    const query = this.query.trim().toLocaleLowerCase();
    const installed = this.plugins.installedPlugins.filter(manifest =>
      [manifest.name, manifest.id, manifest.description, manifest.author ?? ""].some(value => value.toLocaleLowerCase().includes(query)));
    if (!installed.length) { this.message(container, query ? "No installed plugins match your search." : "No community plugins are installed in this vault."); }
    for (const manifest of installed) { this.renderPlugin(container, manifest); }
  }

  private renderPlugin(container: HTMLElement, manifest: PluginManifest): void {
    const loaded = Boolean(this.plugins.getPlugin(manifest.id));
    const configured = this.plugins.configuredPlugins.has(manifest.id);
    const unavailable = this.plugins.unavailable(manifest);
    const row = document.createElement("section");
    row.className = "plugin-card";
    row.dataset.pluginId = manifest.id;
    row.dataset.loaded = String(loaded);
    row.dataset.enabled = String(configured);
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = manifest.name;
    const version = document.createElement("span");
    version.className = "muted";
    version.textContent = " " + manifest.version + (manifest.author ? " by " + manifest.author : "");
    info.append(name, version);
    this.message(info, manifest.description);
    if (configured && !loaded) {
      this.message(info, this.plugins.isRestricted ? "Enabled in this vault; paused by restricted mode." : "Enabled in this vault, but not running in this host.");
    } else if (loaded && !configured) {
      this.message(info, "Running for this session only; not saved in the vault's enabled list.");
    }
    const actions = document.createElement("div");
    actions.className = "plugin-card-actions";
    const toggle = this.button(loaded ? "Disable" : "Enable", () => loaded ? this.plugins.disablePluginAndSave(manifest.id) : this.plugins.enablePluginAndSave(manifest.id));
    toggle.dataset.togglePlugin = manifest.id;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", manifest.name);
    toggle.setAttribute("aria-checked", String(loaded));
    toggle.disabled ||= !loaded && (this.plugins.isRestricted || unavailable !== null);
    const settings = this.button("Settings", async () => { await this.app.dotNet.invokeMethodAsync("OnCommunityPluginSettings", manifest.id); });
    settings.dataset.settingsPlugin = manifest.id;
    settings.disabled ||= !this.app.settingsTabs.has(manifest.id);
    const update = this.button("Find updates", async () => { new CommunityBrowser(this.app, this.plugins, manifest.id).open(); });
    update.dataset.updatePlugin = manifest.id;
    const uninstall = this.button("Uninstall", async () => {
      const review = await this.plugins.reviewInstalled(manifest.id);
      await confirmCommunityUninstall(this.plugins, review);
    });
    uninstall.dataset.uninstallPlugin = manifest.id;
    uninstall.disabled ||= this.app.vault.readOnly;
    actions.append(toggle, settings, update, uninstall);
    row.append(info, actions);
    const error = this.plugins.errorFor(manifest.id) ?? unavailable;
    if (error) { this.message(row, error, true); }
    container.appendChild(row);
  }
}
