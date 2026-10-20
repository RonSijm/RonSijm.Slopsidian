import type { App } from "./app";
import { HostError, requestJson, type AppearanceStylesheet, type VaultConfigurationDocument } from "./contracts";
import { reportError } from "./dom";
import { SettingTab, type SettingDefinitionItem } from "./settings";
import { MarkdownView } from "./workspace";
import { APPEARANCE_CSS_BYTES, AppearanceError, appearanceCssPath, appearanceFontCss, appearanceFontList, appearanceName, appearanceOptions, validateAppearanceCss, type AppearanceMode, type AppearanceOptions } from "./appearance-model";
import { appearanceAssetPath, APPEARANCE_ASSET_BYTES, APPEARANCE_ASSET_TOTAL_BYTES, inlineAppearanceResources, newAppearanceAssetBudget, type AppearanceAssetBudget, type AppearanceAssetPayload, type AppearanceAssetReader } from "./appearance-assets";

import { rethemeMermaid } from "./mermaid-renderer";
import { base64Bytes, fetchBounded, parseThemeCatalog, reviewThemeFiles, searchThemeCatalog, themeFileUrl, themeInstallState, themeResourceReferences, THEME_CATALOG_BYTES, THEME_CATALOG_URL, THEME_MANIFEST_BYTES, type ThemeCatalog, type ThemeCatalogEntry, type ThemeFileReview, type ThemeInstallState } from "./appearance-catalog";

interface AppearanceAsset { name: string; path: string }
interface ReviewedTheme { entry: ThemeCatalogEntry; files: ThemeFileReview; installedVersion: string | null; installedManifestVersion: string | null; installedResources: Map<string, string | null>; state: ThemeInstallState; source: "github" | "files" }
interface ThemeInstallResult { root: string; name: string; path: string; version: string; size: number; updated: boolean; resources?: number }

/** Seconds between external CSS/preferences checks while a vault is open and visible. */
const WATCH_MILLISECONDS = 3000;
export function isAppearanceFailure(error: unknown): boolean {
  return error instanceof AppearanceError || error instanceof HostError && [400, 403, 404, 409, 413, 415, 422].includes(error.status);
}

export class Appearance extends SettingTab {
  private document: VaultConfigurationDocument | null = null;
  private assets: { themes: AppearanceAsset[]; snippets: AppearanceAsset[] } = { themes: [], snippets: [] };
  private styles: HTMLStyleElement[] = [];
  private writes: Promise<void> = Promise.resolve();
  private assetEpoch = 0;
  private pageEpoch = 0;
  private mode: AppearanceMode = "obsidian";
  private failure = "";
  private inventoryFailure = "";
  private readonly system = window.matchMedia("(prefers-color-scheme: dark)");
  private catalog: ThemeCatalog | null = null;
  private catalogQuery = "";
  private catalogStatus = "";
  private catalogBusy = false;
  private reviewed: ReviewedTheme | null = null;
  private catalogEpoch = 0;
  private stopConfigurationWatch: (() => void) | null = null;
  private assetTimer: ReturnType<typeof setInterval> | null = null;
  private assetSignature: string | null = null;
  private resourcePaths: string[] = [];
  private watching = false;
  private lastWatchFailure = "";
  private lastAssetFailure = "";
  /** Replaceable for tests; real use is the page's CORS-only fetch. */
  fetcher: typeof fetch = (input, init) => window.fetch(input, init);

  constructor(app: App) {
    super(app);
    this.containerEl.dataset.appearanceSettings = "";
    this.system.addEventListener("change", () => { if (this.mode === "system") { this.applyMode(); } });
    app.registerLeaveGuard(() => this.closeSettings());
  }

  clear(): void {
    this.assetEpoch++;
    this.stopWatching();
    this.lastWatchFailure = "";
    this.lastAssetFailure = "";
    this.catalogEpoch++; this.catalog = null; this.catalogQuery = ""; this.catalogStatus = ""; this.catalogBusy = false; this.reviewed = null;
    this.document = null;
    this.assets = { themes: [], snippets: [] };
    this.styles.forEach(style => style.remove());
    this.styles = [];
    this.mode = "obsidian";
    this.failure = "";
    this.inventoryFailure = "";
    this.applyMode();
  }

  async restore(): Promise<void> {
    const root = this.app.vault.rootPath, epoch = this.assetEpoch;
    const configuration = await this.app.configuration.read("appearance");
    this.assertOwner(root, epoch);
    this.document = configuration;
    this.startWatching(root, epoch);
    const options = appearanceOptions(this.document.data);
    this.mode = options.theme;
    this.applyMode();
    if (options.cssTheme || options.enabledCssSnippets.length) {
      await this.readInventory(root, epoch);
    }
    const prepared = await this.prepareStyles(options, root, epoch);
    this.assertOwner(root, epoch);
    this.applyStyles(prepared);
  }

  private stopWatching(): void {
    this.watching = false;
    this.stopConfigurationWatch?.();
    this.stopConfigurationWatch = null;
    if (this.assetTimer !== null) { clearInterval(this.assetTimer); this.assetTimer = null; }
    this.assetSignature = null;
    this.resourcePaths = [];
  }

  /** Vault-lifetime observation of appearance.json and the selected/installed CSS files; ends with clear() or a vault change. */
  private startWatching(root: string | null, epoch: number): void {
    this.stopWatching();
    if (!root) { return; }
    this.watching = true;
    const configuration = this.app.configuration as Partial<typeof this.app.configuration>;
    if (typeof configuration.watch === "function") {
      this.stopConfigurationWatch = configuration.watch.call(this.app.configuration, "appearance",
        document => { this.enqueue(() => this.adopt(document, root, epoch)).catch(error => this.watchFailure(error, root, epoch)); },
        error => {
          if (this.retired(root, epoch)) { return; }
          const message = error instanceof Error ? error.message : String(error);
          if (message === this.lastWatchFailure) { return; }
          this.lastWatchFailure = message;
          this.recordFailure(error instanceof AppearanceError || error instanceof HostError ? error : new AppearanceError(message));
          this.updateIfOpen();
        });
    }
    let running = false;
    this.assetTimer = setInterval(() => {
      if (running || !this.watching || epoch !== this.assetEpoch || this.app.changingVault || this.app.vault.rootPath !== root || globalThis.document?.hidden) { return; }
      running = true;
      this.enqueue(() => this.checkAssets(root, epoch)).catch(error => this.watchFailure(error, root, epoch)).finally(() => { running = false; });
    }, WATCH_MILLISECONDS);
    (this.assetTimer as { unref?: () => void }).unref?.();
  }

  /** Adopts an externally changed appearance.json only when it is valid and its styles prepare; otherwise the accepted styles stay. */
  private async adopt(next: VaultConfigurationDocument, root: string | null, epoch: number): Promise<void> {
    if (!this.watching || epoch !== this.assetEpoch || next.root !== root || root !== this.app.vault.rootPath || this.app.changingVault) { return; }
    if (!this.document || next.version === this.document.version) { return; }
    this.lastWatchFailure = "";
    try {
      const options = appearanceOptions(next.data);
      await this.readInventory(root, epoch).catch(error => { if (!isAppearanceFailure(error)) { throw error; } });
      const prepared = await this.prepareStyles(options, root, epoch);
      this.assertOwner(root, epoch);
      this.document = next;
      this.mode = options.theme;
      this.applyStyles(prepared, false);
      this.failure = this.inventoryFailure;
      this.applyMode();
      this.refreshDomState();
      this.updateIfOpen();
    } catch (error) {
      if (this.retired(root, epoch)) { return; }
      this.recordFailure(error instanceof AppearanceError || error instanceof HostError ? error : new AppearanceError(String(error)));
      this.updateIfOpen();
    }
  }

  /** True once this watcher's vault/epoch was replaced or a controlled close/vault change started; a read rejected then belongs to the transition, not to a lost host. */
  private retired(root: string | null, epoch: number): boolean {
    return !this.watching || !this.owns(root, epoch) || this.app.changingVault;
  }

  private watchFailure(error: unknown, root: string | null, epoch: number): void {
    if (!this.retired(root, epoch)) { this.recordFailure(error); }
  }

  /** Drains started watcher/save work before host teardown; an unhandled operation failure must still refuse leaving. */
  async whenIdle(): Promise<void> { await this.writes; }

  private async assetSignatureOf(): Promise<string> {
    const adapter = this.app.vault.adapter, parts: string[] = [];
    const folder = async (path: string): Promise<{ files: string[]; folders: string[] }> => (await adapter.stat(path))?.type === "folder" ? adapter.list(path) : { files: [], folders: [] };
    const [themes, snippets] = await Promise.all([folder(".obsidian/themes"), folder(".obsidian/snippets")]);
    const files = [...themes.folders.slice(0, 256).map(path => path + "/theme.css"), ...snippets.files.slice(0, 256).filter(path => /\.css$/i.test(path)), ...this.resourcePaths];
    const stats = await Promise.all(files.map(path => adapter.stat(path)));
    files.forEach((path, index) => parts.push(path + "|" + (stats[index] ? `${stats[index]!.type}:${stats[index]!.mtime}:${stats[index]!.size}` : "-")));
    return parts.sort().join("\n");
  }

  /** Re-reads installed CSS only when the theme/snippet listing, a file's mtime/size, or a resource the accepted styles referenced changed. Unreferenced files inside a theme folder are not observed. */
  private async checkAssets(root: string | null, epoch: number): Promise<void> {
    if (!this.watching || epoch !== this.assetEpoch || !this.document) { return; }
    let signature: string;
    try { signature = await this.assetSignatureOf(); }
    catch (error) {
      if (this.retired(root, epoch)) { return; }
      if (!isAppearanceFailure(error)) { throw error; }
      this.reportAssetFailure(error);
      return;
    }
    if (this.retired(root, epoch)) { return; }
    if (this.assetSignature === null) { this.assetSignature = signature; return; }
    if (signature === this.assetSignature) { return; }
    try {
      const options = appearanceOptions(this.document.data);
      await this.readInventory(root, epoch);
      const prepared = await this.prepareStyles(options, root, epoch);
      this.assertOwner(root, epoch);
      this.applyStyles(prepared);
      this.failure = "";
      this.lastAssetFailure = "";
    } catch (error) {
      if (this.retired(root, epoch)) { return; }
      if (!isAppearanceFailure(error)) { throw error; }
      // prepareStyles advances the baseline once it has read the files, so a failure before that point is retried by the next poll.
      this.reportAssetFailure(error);
    }
    this.updateIfOpen();
  }

  /** Reports an unreadable external-CSS check once per distinct cause; the accepted styles stay and the next successful check recovers. */
  private reportAssetFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message === this.lastAssetFailure) { return; }
    this.lastAssetFailure = message;
    this.recordFailure(error instanceof AppearanceError ? error : new AppearanceError("Appearance could not check external CSS changes: " + message, { cause: error }));
    this.updateIfOpen();
  }

  private updateIfOpen(): void { this.update(); }

  recordFailure(error: unknown): void {
    if (!isAppearanceFailure(error)) { throw error; }
    this.failure = error instanceof Error ? error.message : String(error);
    reportError(error);
  }

  async open(container: HTMLElement): Promise<void> {
    await this.closeSettings();
    const pageEpoch = this.pageEpoch;
    try { await this.reload(); }
    catch (error) { this.recordFailure(error); }
    if (pageEpoch !== this.pageEpoch || this.app.changingVault) { throw new AppearanceError("The Appearance settings page was closed while loading."); }
    container.replaceChildren(this.containerEl);
    await this.showSettings();
  }

  override async closeSettings(): Promise<void> { await super.closeSettings(); this.pageEpoch++; }

  override getControlValue(key: string): unknown {
    const options = appearanceOptions(this.document?.data ?? {});
    if (key === "theme" || key === "cssTheme" || key === "interfaceFontFamily" || key === "textFontFamily" || key === "monospaceFontFamily" || key === "baseFontSize" || key === "allowLocalResources") { return options[key]; }
    if (key === "catalogQuery") { return this.catalogQuery; }
    if (key.startsWith("snippet:")) { return options.enabledCssSnippets.includes(appearanceName(key.slice(8))); }
    throw new AppearanceError("This Appearance setting is not supported: " + key);
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "catalogQuery") { this.catalogQuery = typeof value === "string" ? value.slice(0, 100) : ""; return; }
    await this.change(data => {
      if (key === "theme" || key === "cssTheme" || key === "interfaceFontFamily" || key === "textFontFamily" || key === "monospaceFontFamily" || key === "baseFontSize" || key === "allowLocalResources") { data[key] = value; }
      else if (key.startsWith("snippet:") && typeof value === "boolean") {
        const name = appearanceName(key.slice(8)), before = appearanceOptions(data).enabledCssSnippets;
        data.enabledCssSnippets = value ? [...new Set([...before, name])] : before.filter(item => item !== name);
      } else { throw new AppearanceError("This Appearance setting is not supported: " + key); }
    });
  }

  private owns(root: string | null, epoch: number): boolean {
    return !!root && root === this.app.vault.rootPath && epoch === this.assetEpoch;
  }

  private assertOwner(root: string | null, epoch: number): void {
    if (!root || root !== this.app.vault.rootPath || epoch !== this.assetEpoch) { throw new AppearanceError("These appearance assets belong to an inactive vault."); }
  }

  private change(update: (data: Record<string, unknown>) => void): Promise<void> {
    const root = this.app.vault.rootPath, epoch = this.assetEpoch, pageEpoch = this.pageEpoch;
    const save = async (): Promise<void> => {
      this.assertOwner(root, epoch);
      const previous = this.document;
      if (!previous || previous.root !== root || pageEpoch !== this.pageEpoch || this.app.changingVault || !this.containerEl.isConnected) {
        throw new AppearanceError("These Appearance settings belong to an inactive page.");
      }
      const data = { ...previous.data };
      update(data);
      const options = appearanceOptions(data);
      const prepared = await this.prepareStyles(options, root, epoch);
      this.assertOwner(root, epoch);
      if (pageEpoch !== this.pageEpoch || this.app.changingVault || !this.containerEl.isConnected) { throw new AppearanceError("The Appearance settings page changed before saving."); }
      const saved = await this.app.configuration.write(previous, data);
      this.assertOwner(root, epoch);
      this.document = saved;
      this.mode = options.theme;
      this.applyStyles(prepared, false);
      this.failure = this.inventoryFailure;
      this.applyMode();
      this.refreshDomState();
    };
    return this.enqueue(save);
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.writes.then(action, action);
    this.writes = operation;
    return operation;
  }

  private async inventory(): Promise<{ themes: AppearanceAsset[]; snippets: AppearanceAsset[] }> {
    const list = async (path: string): Promise<{ files: string[]; folders: string[] }> => {
      const stat = await this.app.vault.adapter.stat(path);
      if (!stat) { return { files: [], folders: [] }; }
      if (stat.type !== "folder") { throw new AppearanceError("The appearance asset path is not a folder: " + path); }
      return this.app.vault.adapter.list(path);
    };
    const [themes, snippets] = await Promise.all([list(".obsidian/themes"), list(".obsidian/snippets")]);
    if (themes.folders.length + snippets.files.length > 256) { throw new AppearanceError("Appearance supports at most 256 installed themes and snippet files."); }
    const found = await Promise.all(themes.folders.filter(folder => !folder.slice(".obsidian/themes/".length).startsWith(".")).map(async folder => {
      const name = appearanceName(folder.slice(".obsidian/themes/".length)), path = appearanceCssPath(folder + "/theme.css");
      return (await this.app.vault.adapter.stat(path))?.type === "file" ? { name, path } : null;
    }));
    const result = {
      themes: found.filter((asset): asset is AppearanceAsset => asset !== null).sort((a, b) => a.name.localeCompare(b.name)),
      snippets: snippets.files.filter(path => /\.css$/i.test(path) && !path.slice(".obsidian/snippets/".length).startsWith(".")).map(path => ({ name: appearanceName(path.slice(".obsidian/snippets/".length, -4)), path: appearanceCssPath(path) })).sort((a, b) => a.name.localeCompare(b.name)),
    };
    if (new Set(result.snippets.map(asset => asset.name)).size !== result.snippets.length) { throw new AppearanceError("Multiple CSS snippets have the same saved name. Give them distinct names before loading."); }
    return result;
  }

  private async readInventory(root: string | null, epoch: number, pageEpoch?: number): Promise<void> {
    const assertOwner = (): void => {
      this.assertOwner(root, epoch);
      if (pageEpoch !== undefined && pageEpoch !== this.pageEpoch) { throw new AppearanceError("The Appearance settings page was closed while discovering CSS."); }
    };
    const assets = await this.inventory().catch((error: unknown) => {
      if (!isAppearanceFailure(error)) { throw error; }
      assertOwner();
      this.inventoryFailure = error instanceof Error ? error.message : String(error);
      throw error;
    });
    assertOwner();
    this.assets = assets;
    this.inventoryFailure = "";
  }

  private async prepareStyles(options: AppearanceOptions, root: string | null, epoch: number): Promise<HTMLStyleElement[]> {
    if (!root) { throw new AppearanceError("Open a vault before loading appearance styles."); }
    this.assertOwner(root, epoch);
    const paths = [
      ...(options.cssTheme ? [this.assets.themes.find(asset => asset.name === options.cssTheme)?.path ?? `.obsidian/themes/${options.cssTheme}/theme.css`] : []),
      ...options.enabledCssSnippets.map(name => this.assets.snippets.find(asset => asset.name === name)?.path ?? `.obsidian/snippets/${name}.css`),
    ];
    const prepared: HTMLStyleElement[] = [];
    // The baseline is taken before any file is read so an edit racing the read is still seen by the next poll.
    const pathsBefore = this.resourcePaths.join("\n");
    const baseline = await this.assetSignatureOf();
    this.assertOwner(root, epoch);
    const budget: AppearanceAssetBudget = newAppearanceAssetBudget();
    const attempted = new Set<string>();
    let bytes = 0, failed = false, failure: unknown;
    try {
    for (const path of paths) {
      const stylesheet: AppearanceStylesheet = await requestJson<AppearanceStylesheet>("/api/appearance/css?" + new URLSearchParams({ root, path: appearanceCssPath(path) }));
      this.assertOwner(root, epoch);
      if (stylesheet.root !== root || stylesheet.path !== path || typeof stylesheet.content !== "string"
        || !Number.isSafeInteger(stylesheet.size) || stylesheet.size < 0 || stylesheet.size > APPEARANCE_CSS_BYTES
        || new TextEncoder().encode(stylesheet.content).length > stylesheet.size) { throw new AppearanceError("The host returned an invalid appearance stylesheet."); }
      if (options.allowLocalResources) {
        const read: AppearanceAssetReader = async assetPath => {
          attempted.add(assetPath);
          const asset = await requestJson<AppearanceAssetPayload>("/api/appearance/asset?" + new URLSearchParams({ root, path: appearanceAssetPath(assetPath) }));
          this.assertOwner(root, epoch);
          if (asset.root !== root) { throw new AppearanceError("The host returned a resource for another vault."); }
          return asset;
        };
        stylesheet.content = await inlineAppearanceResources(stylesheet.content, path, read, budget);
        this.assertOwner(root, epoch);
      } else { validateAppearanceCss(stylesheet.content); }
      bytes += stylesheet.size;
      if (bytes > 4 * 1024 * 1024) { throw new AppearanceError("The selected appearance styles exceed the 4 MiB total limit."); }
      const style = document.createElement("style");
      style.dataset.appearanceStyle = path;
      style.textContent = stylesheet.content;
      prepared.push(style);
    }
    } catch (error) { failed = true; failure = error; }
    // A transition-time or unexpected read failure says nothing about the file, so it must not mark the edit as seen.
    const unseen = failed && (this.app.changingVault || !isAppearanceFailure(failure));
    if (this.owns(root, epoch) && !unseen) {
      this.resourcePaths = [...attempted].sort().slice(0, 64);
      let signature: string | null = baseline;
      if (this.resourcePaths.join("\n") !== pathsBefore) {
        // The first-read signature lacks the newly referenced resources. If this fails after a style failure, that original failure is reported and the next poll re-baselines.
        try { signature = await this.assetSignatureOf(); }
        catch (error) { if (!failed) { throw error; } signature = null; }
      }
      if (this.owns(root, epoch)) { this.assetSignature = signature; }
    }
    if (failed) { throw failure; }
    const typography = document.createElement("style");
    typography.dataset.appearancePreferences = "";
    const declarations = [`--font-text-size:${options.baseFontSize}px`];
    for (const [family, property, fallback] of [
      [options.interfaceFontFamily, "--font-interface", '"Segoe UI",sans-serif'],
      [options.textFontFamily, "--font-text", '"Segoe UI",sans-serif'],
      [options.monospaceFontFamily, "--font-monospace", "Consolas,monospace"],
    ]) {
      if (family) { declarations.push(property + ":" + appearanceFontCss(family) + "," + fallback); }
    }
    typography.textContent = ":root{" + declarations.join(";") + "}";
    return [typography, ...prepared];
  }

  private applyStyles(prepared: HTMLStyleElement[], notify = true): void {
    this.styles.forEach(style => style.remove());
    document.head.append(...prepared);
    this.styles = prepared;
    this.measureEditors();
    if (notify) { this.app.workspace.trigger("css-change"); }
  }

  private measureEditors(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) { leaf.view.editor.cm.requestMeasure(); }
    }
  }

  private applyMode(): void {
    const dark = this.mode === "obsidian" || this.mode === "system" && this.system.matches;
    for (const element of [document.documentElement, document.body]) {
      element.classList.toggle("theme-dark", dark);
      element.classList.toggle("theme-light", !dark);
    }
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) { leaf.view.editor.setDarkMode(dark); }
    }
    this.measureEditors();
    this.app.workspace.trigger("css-change");
    this.rethemeFrames();
  }

  /** Re-themes already mounted Mermaid diagrams and Reader frames in place; documents, jobs and frame isolation are untouched. */
  private rethemeFrames(): void {
    try { rethemeMermaid(); } catch (error) { console.error(error); }
    for (const leaf of this.app.workspace.getLeavesOfType("webviewer")) {
      try { (leaf.view as { syncReaderTheme?: () => void }).syncReaderTheme?.(); } catch (error) { console.error(error); }
    }
  }

  private catalogGuard(): { root: string; epoch: number; catalogEpoch: number } {
    const root = this.app.vault.rootPath;
    if (!root || this.app.changingVault) { throw new AppearanceError("Open a vault before using community themes."); }
    return { root, epoch: this.assetEpoch, catalogEpoch: this.catalogEpoch };
  }

  private assertCatalog(guard: { root: string; epoch: number; catalogEpoch: number }): void {
    this.assertOwner(guard.root, guard.epoch);
    if (guard.catalogEpoch !== this.catalogEpoch) { throw new AppearanceError("The community theme page changed while it was loading."); }
  }

  private async runCatalog(action: (guard: { root: string; epoch: number; catalogEpoch: number }) => Promise<string>): Promise<void> {
    if (this.catalogBusy) { return; }
    const guard = this.catalogGuard();
    this.catalogBusy = true; this.catalogStatus = "Working…";
    this.updateIfOpen();
    try { this.assertCatalog(guard); const message = await action(guard); this.assertCatalog(guard); this.catalogStatus = message; }
    catch (error) {
      if (guard.catalogEpoch !== this.catalogEpoch) { return; }
      if (!isAppearanceFailure(error)) { this.catalogBusy = false; throw error; }
      this.catalogStatus = error instanceof Error ? error.message : String(error);
    }
    this.catalogBusy = false;
    this.updateIfOpen();
  }

  /** Explicit, user-directed download of the official list. Never called at startup. */
  private browseCatalog(): Promise<void> {
    return this.runCatalog(async guard => {
      const bytes = await fetchBounded(this.fetcher, THEME_CATALOG_URL, THEME_CATALOG_BYTES);
      this.assertCatalog(guard);
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AppearanceError("The theme catalog is not valid UTF-8."); }
      this.catalog = parseThemeCatalog(text);
      this.reviewed = null;
      return `Loaded ${this.catalog.entries.length} official community themes` + (this.catalog.skipped ? ` (${this.catalog.skipped} unusable entries ignored)` : "") + ". Nothing has been installed.";
    });
  }

  /** Downloads one theme's files and exact referenced relative font/image bundle for inspection only; nothing is written until Install is chosen. */
  private reviewTheme(entry: ThemeCatalogEntry): Promise<void> {
    return this.runCatalog(async guard => {
      const [css, manifest] = await Promise.all([
        fetchBounded(this.fetcher, themeFileUrl(entry, "theme.css"), APPEARANCE_CSS_BYTES),
        fetchBounded(this.fetcher, themeFileUrl(entry, "manifest.json"), THEME_MANIFEST_BYTES),
      ]);
      this.assertCatalog(guard);
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(css); } catch { throw new AppearanceError("Theme files must be valid UTF-8 text."); }
      const resources = new Map<string, Uint8Array<ArrayBuffer>>();
      let remaining = APPEARANCE_ASSET_TOTAL_BYTES;
      for (const path of themeResourceReferences(text)) {
        const bytes = await fetchBounded(this.fetcher, themeFileUrl(entry, path), Math.min(APPEARANCE_ASSET_BYTES, remaining));
        this.assertCatalog(guard);
        remaining -= bytes.byteLength;
        resources.set(path, bytes);
      }
      return this.finishReview(guard, entry, css, manifest, resources, "github");
    });
  }

  /** Selected-file fallback for when GitHub is unreachable or CORS-blocked: the user picks a theme folder and the same review/install policy applies. */
  reviewFiles(files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, name: string): Promise<void> {
    return this.runCatalog(async guard => {
      const css = files.get("theme.css"), manifest = files.get("manifest.json");
      if (!css || !manifest) { throw new AppearanceError("Select a theme folder that contains theme.css and manifest.json."); }
      const entry: ThemeCatalogEntry = { name: appearanceName(name), author: "", repo: "", modes: [], screenshot: "" };
      const resources = new Map<string, Uint8Array<ArrayBuffer>>();
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(css); } catch { throw new AppearanceError("Theme files must be valid UTF-8 text."); }
      for (const path of themeResourceReferences(text)) {
        const bytes = files.get(path);
        if (!bytes) { throw new AppearanceError("The selected folder is missing a file the theme references: " + path); }
        resources.set(path, bytes);
      }
      return this.finishReview(guard, entry, css, manifest, resources, "files");
    });
  }

  private chooseThemeFolder(): Promise<void> {
    return new Promise<void>(resolve => {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true; input.hidden = true;
      input.setAttribute("webkitdirectory", "");
      let settled = false;
      const finish = (): void => { if (!settled) { settled = true; input.remove(); resolve(); } };
      input.addEventListener("cancel", finish);
      input.addEventListener("change", () => {
        const picked = [...input.files ?? []];
        const folder = picked[0]?.webkitRelativePath.split("/")[0] ?? "";
        const map = new Map<string, Uint8Array<ArrayBuffer>>();
        void (async () => {
          try {
            let total = 0;
            for (const file of picked) {
              const relative = file.webkitRelativePath.split("/").slice(1).join("/");
              if (!relative || file.size > APPEARANCE_ASSET_BYTES || (total += file.size) > APPEARANCE_ASSET_TOTAL_BYTES + APPEARANCE_CSS_BYTES + THEME_MANIFEST_BYTES) { continue; }
              if (relative === "theme.css" || relative === "manifest.json" || /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|avif)$/i.test(relative)) { map.set(relative, new Uint8Array(await file.arrayBuffer())); }
            }
            await this.reviewFiles(map, folder);
          } finally { finish(); }
        })();
      });
      document.body.append(input);
      input.click();
    });
  }

  private async finishReview(guard: { root: string; epoch: number; catalogEpoch: number }, entry: ThemeCatalogEntry, css: Uint8Array<ArrayBuffer>, manifest: Uint8Array<ArrayBuffer>, resources: Map<string, Uint8Array<ArrayBuffer>>, source: "github" | "files"): Promise<string> {
    const files = await reviewThemeFiles(css, manifest, resources);
    const folder = `.obsidian/themes/${appearanceName(entry.name)}/`;
    let installedVersion: string | null = null;
    try {
      installedVersion = (await requestJson<AppearanceStylesheet>("/api/appearance/css?" + new URLSearchParams({ root: guard.root, path: folder + "theme.css" }))).version;
    } catch (error) { if (!(error instanceof HostError && error.status === 404)) { throw error; } }
    let installedManifestVersion: string | null = null;
    try {
      installedManifestVersion = (await requestJson<AppearanceStylesheet>("/api/appearance/css?" + new URLSearchParams({ root: guard.root, path: folder + "manifest.json" }))).version;
    } catch (error) { if (!(error instanceof HostError && error.status === 404)) { throw error; } }
    const installedResources = new Map<string, string | null>();
    for (const resource of files.resources) {
      try {
        installedResources.set(resource.path, (await requestJson<AppearanceAssetPayload>("/api/appearance/asset?" + new URLSearchParams({ root: guard.root, path: folder + resource.path }))).version);
      } catch (error) { if (!(error instanceof HostError && error.status === 404)) { throw error; } installedResources.set(resource.path, null); }
    }
    this.assertCatalog(guard);
    const state = themeInstallState(files, installedVersion, installedResources);
    this.reviewed = { entry, files, installedVersion, installedManifestVersion, installedResources, state, source };
    return `Reviewed ${entry.name}. Check the details below, then choose Install or Update to write exactly these files.`;
  }

  private installReviewed(): Promise<void> {
    const reviewed = this.reviewed;
    return this.runCatalog(async guard => {
      if (!reviewed || reviewed !== this.reviewed) { throw new AppearanceError("Review a theme before installing it."); }
      if (this.app.vault.readOnly) { throw new AppearanceError("This vault is read-only; themes cannot be installed."); }
      if (reviewed.state === "unchanged") { throw new AppearanceError("This exact theme is already installed."); }
      const name = appearanceName(reviewed.entry.name);
      let message = "";
      await this.enqueue(async () => {
        this.assertCatalog(guard);
        const result = await requestJson<ThemeInstallResult>("/api/appearance/theme", "PUT", {
          root: guard.root, name, cssBase64: base64Bytes(reviewed.files.css), manifestBase64: base64Bytes(reviewed.files.manifest), expectedVersion: reviewed.installedVersion, expectedManifestVersion: reviewed.installedManifestVersion,
          resources: reviewed.files.resources.map(resource => ({ path: resource.path, base64: base64Bytes(resource.bytes), expectedVersion: reviewed.installedResources.get(resource.path) ?? null })),
        });
        if (result.root !== guard.root || result.version !== reviewed.files.cssVersion) { throw new AppearanceError("The host reported a different installed theme than the reviewed bytes. Review it again."); }
        this.reviewed = { ...reviewed, installedVersion: result.version, installedResources: new Map(reviewed.files.resources.map(resource => [resource.path, resource.version])), state: "unchanged" };
        message = `${result.updated ? "Updated" : "Installed"} ${name}` + (reviewed.files.resources.length ? ` with ${reviewed.files.resources.length} font/image file(s)` : "") + ". It is not selected automatically."
          + (reviewed.files.resources.length ? " Its fonts/images load only while \"Allow trusted local theme resources\" is on." : "");
        try {
          await this.readInventory(guard.root, guard.epoch);
          const options = appearanceOptions(this.document?.data ?? {});
          if (options.cssTheme === name) {
            const prepared = await this.prepareStyles(options, guard.root, guard.epoch);
            this.assertOwner(guard.root, guard.epoch);
            this.applyStyles(prepared);
            message += " The active theme was refreshed.";
          }
        } catch (error) {
          if (!isAppearanceFailure(error)) { throw error; }
          message += " It could not be applied now (" + (error instanceof Error ? error.message : String(error)) + "); the previous styles were kept.";
        }
      });
      return message;
    });
  }

  private async reload(): Promise<void> {
    const root = this.app.vault.rootPath, epoch = this.assetEpoch, pageEpoch = this.pageEpoch;
    const configuration = await this.app.configuration.read("appearance");
    this.assertOwner(root, epoch);
    if (pageEpoch !== this.pageEpoch) { throw new AppearanceError("The Appearance settings page was closed while loading."); }
    this.document = configuration;
    const options = appearanceOptions(configuration.data);
    this.mode = options.theme;
    this.applyMode();
    try {
      await this.readInventory(root, epoch, pageEpoch);
      const prepared = await this.prepareStyles(options, root, epoch);
      this.assertOwner(root, epoch);
      if (pageEpoch !== this.pageEpoch) { throw new AppearanceError("The Appearance settings page was closed while loading CSS."); }
      this.applyStyles(prepared);
      this.failure = "";
    } catch (error) { this.recordFailure(error); }
  }

  private catalogItems(): SettingDefinitionItem[] {
    const busy = this.catalogBusy, readOnly = this.app.vault.readOnly === true;
    const items: SettingDefinitionItem[] = [{
      name: "Browse official community themes",
      desc: "Downloads the public community theme list from raw.githubusercontent.com only when you choose this, using a plain CORS request with no credentials. Nothing is installed or selected." + (readOnly ? " This vault is read-only, so you can browse and review but not install." : ""),
      disabled: busy, action: () => this.browseCatalog(),
    }, {
      name: "Review a theme folder from disk",
      desc: "Fallback when GitHub is unreachable or blocked: choose a folder with theme.css, manifest.json and the relative font/image files it references. Nothing is uploaded or installed until you review and choose Install. Remote URLs, imports and SVG are refused.",
      disabled: busy, action: () => this.chooseThemeFolder(),
    }];
    if (this.catalogStatus) {
      items.push({ name: "Community theme status", desc: this.catalogStatus, render: setting => { setting.settingEl.dataset.appearanceCatalogStatus = ""; setting.settingEl.setAttribute("role", "status"); } });
    }
    if (this.catalog) {
      const matches = searchThemeCatalog(this.catalog, this.catalogQuery, 12);
      items.push(
        { name: "Filter themes", desc: "Match theme or author name, then choose Show matching themes.", control: { type: "text", key: "catalogQuery", placeholder: "Theme or author" } },
        { name: "Show matching themes", desc: `Showing up to 12 of ${this.catalog.entries.length} themes.`, action: () => { this.update(); } },
        ...matches.map((entry): SettingDefinitionItem => ({
          name: entry.name, desc: `${entry.author || "Unknown author"} · ${entry.repo}${entry.modes.length ? " · " + entry.modes.join("/") : ""}. Review downloads this theme's CSS and manifest for inspection only.`,
          disabled: busy, action: () => this.reviewTheme(entry),
        })),
      );
    }
    const reviewed = this.reviewed;
    if (reviewed) {
      const { files, entry, state } = reviewed;
      const warnings = [
        files.resources.length ? ` Includes ${files.resources.length} relative font/image file(s) (${files.resources.map(resource => resource.path).slice(0, 6).join(", ")}${files.resources.length > 6 ? ", …" : ""}); they are installed beside theme.css and load only when trusted local theme resources are enabled. Older unreferenced files in the theme folder are never deleted.` : "",
        state === "update" ? " An installed theme with this name has different bytes (possibly your own edits); updating replaces its theme.css, manifest.json and the listed resources." : "",
        state === "unchanged" ? " The identical theme.css and resources are already installed." : "",
      ].join("");
      items.push(
        { name: `Reviewed: ${entry.name}`, desc: `${entry.author || "Selected folder"} · ${entry.repo || "local files"} · version ${files.themeVersion || "not stated"} · theme.css ${files.css.byteLength} bytes · SHA-256 ${files.cssVersion.slice(0, 16)}… · ${state === "new" ? "not installed" : state === "update" ? "differs from installed" : "already installed"}.${warnings} Themes can restyle the entire interface; only install CSS you trust.`, render: setting => { setting.settingEl.dataset.appearanceReviewed = entry.name; } },
        { name: state === "update" ? `Update ${entry.name} with the reviewed files` : `Install ${entry.name} from the reviewed files`, desc: "Writes exactly the reviewed bytes to .obsidian/themes/" + entry.name + "/. It does not select the theme. Existing styles stay active if anything fails.", disabled: busy || readOnly || state === "unchanged", action: () => this.installReviewed() },
      );
    }
    return items;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const validateFont = (value: string): string | void => {
      try { appearanceFontList(value); }
      catch (error) { if (error instanceof AppearanceError) { return error.message; } throw error; }
    };
    const resetFonts = (data: Record<string, unknown>): void => {
      delete data.interfaceFontFamily; delete data.textFontFamily; delete data.monospaceFontFamily; delete data.baseFontSize;
    };
    let options: AppearanceOptions | null = null;
    if (this.document) {
      try { options = appearanceOptions(this.document.data); }
      catch (error) { if (!(error instanceof AppearanceError)) { throw error; } this.failure = error.message; }
    }
    const refreshAction = (): Promise<void> => this.enqueue(async () => {
      try { await this.reload(); }
      catch (error) { this.recordFailure(error); }
      this.update();
    });
    const refresh: SettingDefinitionItem = {
      name: "Reload appearance and CSS files", desc: "Read external appearance.json changes and discover/reread local CSS without rewriting its bytes.", action: refreshAction,
    };
    const failure: SettingDefinitionItem = {
      name: "Appearance loading failed", desc: this.failure || "This vault's appearance preferences have not been read.", visible: () => Boolean(this.failure) || !this.document, render: setting => {
        setting.settingEl.dataset.appearanceFailure = "";
        setting.settingEl.setAttribute("role", "alert");
      },
    };
    if (!options) {
      return [failure, refresh, {
        name: "Reset supported appearance preferences", desc: "Explicitly restore dark mode, the default theme, no snippets and default fonts/text size. Unrelated keys and CSS files are retained; malformed JSON must be corrected on disk first.",
        disabled: !this.document, action: async () => {
          await this.change(data => { data.theme = "obsidian"; data.cssTheme = ""; data.enabledCssSnippets = []; delete data.allowLocalResources; resetFonts(data); });
          await refreshAction();
        },
      }];
    }
    const themeOptions = Object.fromEntries([["", "Default"], ...this.assets.themes.map(asset => [asset.name, asset.name])]);
    if (options.cssTheme && !Object.hasOwn(themeOptions, options.cssTheme)) { Object.defineProperty(themeOptions, options.cssTheme, { value: options.cssTheme + " (missing)", enumerable: true }); }
    const snippets = [...new Set([...this.assets.snippets.map(asset => asset.name), ...options.enabledCssSnippets])];
    return [
      { type: "group", heading: "Appearance", items: [
        { name: "Base color scheme", desc: "Use a dark or light interface, or follow the operating system. Existing note text, selection and undo are retained.", control: { type: "dropdown", key: "theme", options: { obsidian: "Dark", moonstone: "Light", system: "Adapt to system" } } },
        { name: "Installed theme", desc: "Loads .obsidian/themes/<name>/theme.css. By default only self-contained CSS is supported. Only enable CSS you trust: it can restyle the entire interface. Complete native theme/DOM compatibility is not supplied.", control: { type: "dropdown", key: "cssTheme", options: themeOptions } },
        { name: "Allow trusted local theme resources", desc: "Off by default. When on, the selected theme and enabled snippets may reference local fonts (woff2, woff, ttf, otf) and images (png, jpg, gif, webp, avif) relative to the theme folder or snippets folder with url(). Remote URLs, imports, SVG, hidden or escaping paths and oversized files refuse and the previous styles are kept.", control: { type: "toggle", key: "allowLocalResources" } },
      ] },
      failure,
      { type: "group", heading: "Fonts", items: [
        { name: "Interface font", desc: "Local family names in priority order, separated by commas. Leave empty for the default interface font. Fonts are not downloaded.", control: { type: "text", key: "interfaceFontFamily", placeholder: "Default interface font", validate: validateFont } },
        { name: "Text font", desc: "Local families for note text in Source, Live Preview and Reading. Up to eight names; unavailable fonts use the host fallback.", control: { type: "text", key: "textFontFamily", placeholder: "Default text font", validate: validateFont } },
        { name: "Monospace font", desc: "Local families for code and preformatted text. Use literal names without CSS quotes or resource URLs.", control: { type: "text", key: "monospaceFontFamily", placeholder: "Default monospace font", validate: validateFont } },
        { name: "Note text size", desc: "12 to 32 whole CSS pixels. Existing editors, note contents, selection and undo are retained; themes may override these ordinary CSS variables.", control: { type: "number", key: "baseFontSize", min: 12, max: 32, step: 1, validate: value => Number.isInteger(value) ? undefined : "Choose a note text size from 12 to 32 whole pixels." } },
        { name: "Restore default fonts", desc: "Remove only the three custom font choices and note text size. The current color scheme, selected theme/snippets and unrelated preferences are retained.", action: async () => {
          await this.change(resetFonts);
          this.update();
        } },
      ] },
      { type: "group", heading: "Community themes", items: this.catalogItems() },
      { type: "group", heading: "CSS snippets", items: snippets.map(name => ({
        name, desc: this.assets.snippets.find(asset => asset.name === name)?.path ?? "Missing snippet; its saved name is retained.",
        control: { type: "toggle", key: "snippet:" + name },
      })), emptyState: "No top-level .css files were found in .obsidian/snippets. Add a trusted local file, then reload." },
      refresh,
      { name: "Disable custom styles", desc: "Return to the default theme and disable every snippet. CSS files and unrelated appearance preferences are retained.", action: async () => {
        await this.change(data => { data.cssTheme = ""; data.enabledCssSnippets = []; });
        this.update();
      } },
    ];
  }
}
