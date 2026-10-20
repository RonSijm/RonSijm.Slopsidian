import { ItemView, Plugin, type WorkspaceLeaf } from "obsidian";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { GitHubOfflineControls } from "./offline-controls";
import { EXAMPLE_VAULT, GitHubReader, IndexedDbGitHubCache, parseGitHubLocation, type GitHubMount } from "./provider";

const TYPE = "github-vault-browser";
const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
interface MountHost { githubVaults?: { open(request: { url: string; cached: boolean }): Promise<unknown> }; }

export default class GitHubVaultPlugin extends Plugin {
  readonly reader = new GitHubReader(new IndexedDbGitHubCache("github-vault-plugin-v1"));
  lastUrl = EXAMPLE_VAULT;
  async onload(): Promise<void> {
    const stored = await this.loadData() as { url?: unknown } | null;
    if (typeof stored?.url === "string") this.lastUrl = stored.url;
    this.registerView(TYPE, leaf => new GitHubVaultView(leaf, this));
    const open = async (): Promise<void> => { await this.app.workspace.getLeaf(true).setViewState({ type: TYPE, active: true }); };
    this.addCommand({ id: "open", name: "Open GitHub vault", callback: open });
    this.addRibbonIcon("folder", "Open GitHub vault", () => { void open(); });
  }
}

class GitHubVaultView extends ItemView {
  private mount: GitHubMount | null = null;
  private offline = false;
  private closed = false;
  private generation = 0;
  private urls: string[] = [];
  private status!: HTMLElement;
  private files!: HTMLElement;
  private preview!: HTMLElement;
  private pending = false;
  private offlineControls: GitHubOfflineControls | null = null;
  constructor(leaf: WorkspaceLeaf, private readonly plugin: GitHubVaultPlugin) { super(leaf); }
  getViewType(): string { return TYPE; }
  getDisplayText(): string { return "GitHub vault"; }
  getIcon(): string { return "folder"; }
  async onOpen(): Promise<void> {
    this.closed = false;
    const content = this.contentEl; content.replaceChildren(); content.classList.add("github-vault-browser");
    const heading = document.createElement("h2"); heading.textContent = "GitHub vault · read-only"; content.append(heading);
    const form = document.createElement("form"), label = document.createElement("label"), input = document.createElement("input");
    label.textContent = "Public GitHub repository or folder URL"; input.value = this.plugin.lastUrl; input.type = "url"; input.required = true; input.setAttribute("aria-label", label.textContent); label.append(input);
    const cachedLabel = document.createElement("label"), cached = document.createElement("input"); cached.type = "checkbox"; cachedLabel.append(cached, " Use cached snapshot only");
    const button = document.createElement("button"); button.type = "submit";
    const host = this.app as typeof this.app & MountHost;
    button.textContent = host.githubVaults ? "Mount in Slopsidian" : "Browse GitHub vault";
    form.append(label, cachedLabel, button); content.append(form);
    this.status = document.createElement("p"); this.status.setAttribute("role", "status"); this.status.textContent = "File references load first. Notes and attachments download when opened."; content.append(this.status);
    const offlineSection = document.createElement("details"), offlineTitle = document.createElement("summary");
    offlineTitle.textContent = "Download vault for offline use"; offlineSection.append(offlineTitle); offlineSection.hidden = true; content.append(offlineSection);
    const layout = document.createElement("div"); layout.className = "github-vault-layout";
    this.files = document.createElement("nav"); this.files.setAttribute("aria-label", "GitHub files"); this.preview = document.createElement("section"); this.preview.className = "markdown-rendered"; layout.append(this.files, this.preview); content.append(layout);
    this.registerDomEvent(form, "submit", event => {
      event.preventDefault();
      void this.run(async () => {
        this.plugin.lastUrl = input.value;
        parseGitHubLocation(input.value);
        await this.plugin.saveData({ url: input.value });
        if (host.githubVaults) { await host.githubVaults.open({ url: input.value, cached: cached.checked }); return; }
        const location = parseGitHubLocation(input.value);
        const mount = cached.checked ? await this.plugin.reader.cached(location) : await this.plugin.reader.discover(location);
        if (this.closed) return;
        this.offlineControls?.dispose(); this.offlineControls = null;
        this.mount = mount; this.offline = cached.checked; this.generation++; this.clearPreview(); this.files.replaceChildren();
        offlineSection.hidden = false; offlineSection.open = false;
        for (const file of mount.files) {
          const item = document.createElement("button"); item.type = "button"; item.textContent = file.path;
          this.registerDomEvent(item, "click", () => { void this.run(() => this.openFile(file.path)); }); this.files.append(item);
        }
        this.status.textContent = `${mount.files.length} references · ${this.offline ? "cached snapshot" : mount.commit.slice(0, 8)} · choose a file to download its content.`;
      });
    });
    this.registerDomEvent(offlineSection, "toggle", () => {
      if (offlineSection.open && this.mount && !this.offlineControls) this.offlineControls = new GitHubOfflineControls(offlineSection, this.plugin.reader, this.mount, this.offline);
    });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.pending || this.closed) return;
    this.pending = true; this.contentEl.setAttribute("aria-busy", "true");
    try { await action(); }
    catch (error) { if (!this.closed) this.status.textContent = error instanceof Error ? error.message : String(error); }
    finally { this.pending = false; this.contentEl.setAttribute("aria-busy", "false"); }
  }
  private resolve(target: string, source: string): string | null {
    target = decodeURIComponent(target.split(/[|#]/)[0]);
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
    const segments = (source.includes("/") ? source.slice(0, source.lastIndexOf("/") + 1) : "").split("/").filter(Boolean);
    for (const part of target.split("/")) { if (part === "..") segments.pop(); else if (part !== "." && part) segments.push(part); }
    const relative = segments.join("/"), candidates = [target, target + ".md", relative, relative + ".md"];
    const exact = this.mount?.files.find(file => candidates.includes(file.path));
    if (exact) return exact.path;
    const matches = this.mount?.files.filter(file => file.path.endsWith("/" + target) || file.path.endsWith("/" + target + ".md")) ?? [];
    return matches.length === 1 ? matches[0].path : null;
  }
  private clearPreview(): void { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; this.preview?.replaceChildren(); }
  private async openFile(path: string): Promise<void> {
    const mount = this.mount, generation = ++this.generation;
    if (!mount) return;
    this.status.textContent = "Loading " + path + "…";
    const bytes = await this.plugin.reader.read(mount, path, this.offline);
    if (this.closed || this.mount !== mount || generation !== this.generation) return;
    this.clearPreview();
    const title = document.createElement("h3"); title.textContent = path; this.preview.append(title);
    if (/\.(?:svg|png|jpe?g|gif|webp|wav|mp3|ogg)$/i.test(path)) await this.media(this.preview, path, bytes);
    else {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!/\.md$/i.test(path)) { const pre = document.createElement("pre"); pre.textContent = source; this.preview.append(pre); }
      else {
        const renderer = new marked.Renderer();
        renderer.image = ({ href, text }) => `<span data-github-media="${escape(href)}">${escape(text || href)}</span>`;
        const markdown = source.replace(/(!?)\[\[([^\]\n]+)\]\]/g, (_match, image: string, link: string) => image
          ? `<span data-github-media="${escape(link)}">${escape(link)}</span>`
          : `<a href="#" data-github-note="${escape(link)}">${escape(link.split("|").at(-1)!)}</a>`);
        const html = await marked.parse(markdown, { renderer });
        // Independent rendering avoids running local plugins against remote code blocks.
        const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true }, FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "audio", "video", "img", "base", "link", "meta"], FORBID_ATTR: ["style"] });
        this.preview.append(fragment);
        for (const anchor of this.preview.querySelectorAll("a")) {
          const target = anchor.dataset.githubNote ?? anchor.getAttribute("href") ?? "";
          if (/^https?:\/\//i.test(target)) { anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; continue; }
          this.registerDomEvent(anchor, "click", event => { event.preventDefault(); const destination = this.resolve(target, path); if (destination) void this.run(() => this.openFile(destination)); else this.status.textContent = "No matching GitHub file: " + target; });
        }
        for (const placeholder of this.preview.querySelectorAll<HTMLElement>("[data-github-media]")) {
          const destination = this.resolve(placeholder.dataset.githubMedia!, path);
          if (destination) {
            try {
              const content = await this.plugin.reader.read(mount, destination, this.offline);
              if (this.closed || generation !== this.generation) return;
              await this.media(placeholder, destination, content);
            } catch (error) { placeholder.textContent = error instanceof Error ? error.message : String(error); }
          }
        }
      }
    }
    this.status.textContent = `${path} · read-only · ${this.plugin.reader.counters.raw} downloads · ${this.plugin.reader.counters.cacheHits} cache hits`;
  }
  private async media(parent: HTMLElement, path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const types: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" };
    const type = types[path.split(".").at(-1)!.toLowerCase()];
    if (!type) { parent.textContent = "Unsupported attachment: " + path; return; }
    const url = URL.createObjectURL(new Blob([bytes], { type })); this.urls.push(url);
    const media = type.startsWith("image/") ? document.createElement("img") : document.createElement("audio");
    if (media instanceof HTMLAudioElement) media.controls = true; else media.alt = path;
    media.src = url; parent.append(media);
  }
  async onClose(): Promise<void> { this.closed = true; this.generation++; this.offlineControls?.dispose(); this.offlineControls = null; this.clearPreview(); }
}
