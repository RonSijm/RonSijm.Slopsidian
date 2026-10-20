import { githubMountId, parseGitHubLocation, type GitHubLocation } from "../plugins/github-vault/provider";

interface LinkedVault extends GitHubLocation { files: readonly { path: string }[]; }
interface NavigationHost {
  baseUrl: string;
  url(): URL;
  write(url: URL, replace: boolean): void;
  activeFile(): string | null;
  openFile(path: string): Promise<void>;
  changingVault(): boolean;
}

function routeUrl(baseUrl: string, vault: GitHubLocation): URL {
  return new URL("remote-vault/github.com/" + vault.repository + "/tree/" + encodeURIComponent(vault.ref)
    + (vault.folder ? "/" + vault.folder.split("/").map(encodeURIComponent).join("/") : ""), baseUrl);
}
export function linkedGitHubUrl(url: URL, baseUrl: string): string {
  const prefix = new URL("remote-vault/", baseUrl);
  if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) throw new Error("This is not a remote vault link.");
  const repositoryUrl = "https://" + url.pathname.slice(prefix.pathname.length);
  parseGitHubLocation(repositoryUrl);
  return repositoryUrl;
}
function matchesVault(url: URL, baseUrl: string, vault: GitHubLocation): boolean {
  try { return githubMountId(parseGitHubLocation(linkedGitHubUrl(url, baseUrl))) === githubMountId(vault); }
  catch { return false; }
}
export function resolveBrowserFile(url: URL, files: readonly { path: string }[]): string | null {
  const values = url.searchParams.getAll("file");
  if (!values.length) return null;
  if (values.length !== 1) throw new Error("Use one file parameter in the vault link.");
  const path = values[0].normalize("NFC");
  if (!path || path.length > 4096 || /[\\\x00-\x1f\x7f]/.test(path)
    || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("The linked file must be a relative path inside this vault.");
  }
  const file = findFile(path, files);
  if (!file) throw new Error(`The linked file does not exist in this vault: ${path}`);
  return file.path;
}
function findFile(path: string, files: readonly { path: string }[]): { path: string } | undefined {
  return files.find(file => file.path === path) ?? files.find(file => file.path === path + ".md")
    ?? files.find(file => /\.md$/i.test(file.path) && file.path.slice(0, -3) === path);
}
function setFile(url: URL, path: string | null, vault: LinkedVault): void {
  // Keep Markdown links short without confusing a real extensionless file with a note.
  const short = path?.replace(/\.md$/i, "");
  if (path) url.searchParams.set("file", short && findFile(short, vault.files)?.path === path ? short : path);
  else url.searchParams.delete("file");
  url.search = [...url.searchParams].map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
}

/** One browser-history entry per active remote file; restoration never creates another entry. */
export class BrowserVaultNavigation {
  private vault: LinkedVault | null = null;
  private paused = true;
  private opening = false;
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly host: NavigationHost) {}
  matchesCurrentVault(): boolean { return Boolean(this.vault && matchesVault(this.host.url(), this.host.baseUrl, this.vault)); }
  suspend(): void { this.paused = true; this.generation++; }
  async whenIdle(): Promise<void> { await this.pending; }
  async ready(vault: LinkedVault | null): Promise<void> {
    const previous = this.vault;
    this.suspend(); this.vault = vault;
    if (!vault) {
      if (previous) {
        const url = new URL(this.host.baseUrl);
        this.host.write(url, true);
      }
      return;
    }
    this.paused = false;
    if (matchesVault(this.host.url(), this.host.baseUrl, vault)) await this.navigate();
    else this.update(true);
  }
  fileChanged(): void {
    if (this.paused || this.opening || this.host.changingVault() || !this.matchesCurrentVault()) return;
    this.update(false);
  }
  navigate(): Promise<void> {
    const vault = this.vault, url = this.host.url();
    if (!vault || this.paused || this.host.changingVault() || !matchesVault(url, this.host.baseUrl, vault)) return Promise.resolve();
    const generation = ++this.generation;
    const task = this.pending.then(async () => {
      if (this.paused || generation !== this.generation || vault !== this.vault) return;
      const path = resolveBrowserFile(url, vault.files);
      this.opening = true;
      try {
        if (path && this.host.activeFile() !== path) await this.host.openFile(path);
        if (generation === this.generation && !this.paused && this.host.url().href === url.href) this.update(true);
      } finally { this.opening = false; }
    });
    this.pending = task.catch(() => {});
    return task;
  }
  private update(replace: boolean): void {
    if (!this.vault) return;
    const current = this.host.url();
    const url = matchesVault(current, this.host.baseUrl, this.vault) ? new URL(current) : routeUrl(this.host.baseUrl, this.vault);
    const path = this.host.activeFile();
    if (path && !this.vault.files.some(file => file.path === path)) return;
    setFile(url, path, this.vault);
    if (url.href !== current.href) this.host.write(url, replace);
  }
}
