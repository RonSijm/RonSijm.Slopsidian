import type { App } from "./app";
import { requestJson, type FileEntry, type MetadataDocuments, type MetadataIssue, type VaultDocument, type VaultSnapshot } from "./contracts";
import { Events } from "./events";
import { allTags, parseMarkdown, sameValue, type CachedMetadata, type LinkCache } from "./markdown";
import { createLinkResolver, fileLinktext, type LinkDestination } from "./links";
import { TFile } from "./vault";
import type { PropertyInfo } from "./property-types";

export interface ResolvedReference {
  sourcePath: string;
  link: LinkCache;
  destination: TFile | null;
  ambiguous: boolean;
}

export interface IndexedDocument {
  document: VaultDocument;
  text: string;
  cache: CachedMetadata;
  dirty: boolean;
  missing: boolean;
  outgoing: ResolvedReference[];
}

export class MetadataCache extends Events {
  resolvedLinks: Record<string, Record<string, number>> = Object.create(null);
  unresolvedLinks: Record<string, Record<string, number>> = Object.create(null);
  private readonly documents = new Map<string, IndexedDocument>();
  private observedFiles = new Map<string, { file: TFile; stat: FileEntry["stat"] }>();
  private resolve: (link: string, source: string, uri?: boolean) => LinkDestination<TFile> | null = () => null;
  private root: string | null = null;
  private revision = -1;
  private generation = 0;
  private suspended = true;
  private applying = false;
  private pending: Promise<void> | null = null;
  private forceRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private diskIssues: MetadataIssue[] = [];
  private resolutionIssues = new Map<string, MetadataIssue[]>();
  error: string | null = null;

  constructor(private readonly app: App) {
    super();
    const changed = (): void => {
      if (!this.applying && !this.suspended) {
        this.refresh().catch(error => this.report(error));
      }
    };
    for (const name of ["create", "modify", "delete", "rename"]) {
      this.app.vault.on(name, changed);
    }
  }

  async initialize(root: string | null): Promise<void> {
    await this.pause();
    this.root = root;
    this.revision = -1;
    this.error = null;
    this.diskIssues = [];
    this.documents.clear();
    this.observedFiles = new Map(this.app.vault.getFiles().map(file => [file.path, { file, stat: { ...file.stat } }]));
    this.resolutionIssues.clear();
    this.resolvedLinks = Object.create(null);
    this.unresolvedLinks = Object.create(null);
    this.resolve = createLinkResolver(this.app.vault.getFiles());
    if (root) {
      try {
        await this.refresh();
      } catch (error) {
        this.report(error);
      }
    }
    this.trigger("finished");
  }

  async pause(): Promise<void> {
    this.suspended = true;
    this.generation++;
    this.forceRequested = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      await Promise.allSettled([this.pending]);
    }
  }

  resume(): void {
    this.suspended = false;
    this.schedule();
  }

  private schedule(): void {
    if (this.suspended || !this.root || this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.app.changingVault) {
        this.schedule();
        return;
      }
      this.refresh(false).catch(error => this.report(error)).finally(() => this.schedule());
    }, 750);
  }

  private report(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    this.trigger("error", this.error);
    this.trigger("finished");
  }

  getIssues(): MetadataIssue[] {
    const result = [...this.diskIssues, ...this.resolutionIssues.values()].flat();
    for (const entry of this.documents.values()) {
      result.push(...entry.cache.errors.map(message => ({ path: entry.document.file.path, message })));
    }
    if (this.error) {
      result.unshift({ path: "", message: this.error });
    }
    return result;
  }

  getFileCache(file: TFile): CachedMetadata | null {
    if (file.vault !== this.app.vault) {
      return null;
    }
    return this.getCache(file.path);
  }

  getCache(path: string): CachedMetadata | null { return this.documents.get(path)?.cache ?? null; }
  getDocument(path: string): IndexedDocument | null { return this.documents.get(path) ?? null; }
  getDocuments(): IndexedDocument[] { return [...this.documents.values()].filter(entry => !entry.missing); }
  getCachedFiles(): string[] { return this.getDocuments().map(entry => entry.document.file.path); }
  getAllPropertyInfos(): Record<string, PropertyInfo> { return this.app.metadataTypeManager.getAllProperties(); }

  acceptFileMutation(file: TFile, oldPath: string, entry: FileEntry | null): void {
    const prior = this.documents.get(oldPath);
    this.documents.delete(oldPath);
    this.observedFiles.delete(oldPath);
    if (entry) { this.observedFiles.set(file.path, { file, stat: { ...entry.stat } }); }
    if (entry && prior) { this.documents.set(file.path, { ...prior, document: { ...prior.document, file: entry } }); }
    this.resolve = createLinkResolver(this.app.vault.getFiles());
    this.resolvedLinks = Object.create(null);
    this.unresolvedLinks = Object.create(null);
    this.resolutionIssues.clear();
    for (const document of this.documents.values()) { this.resolveSource(document); }
    if (!entry) { this.trigger("deleted", file, prior?.cache ?? null); }
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    return this.resolve(linkpath, sourcePath)?.file ?? null;
  }

  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension = true): string {
    if (file.vault !== this.app.vault || this.app.vault.getFileByPath(file.path) !== file) {
      throw new Error("The link's file is not in the selected vault.");
    }
    return fileLinktext(this.app.vault.getFiles(), file.path, sourcePath, omitMdExtension);
  }

  resolveReference(link: LinkCache, sourcePath: string): LinkDestination<TFile> | null {
    return this.resolve(link.link, sourcePath, link.kind === "markdown" || link.kind === "reference");
  }

  getBacklinksForFile(file: TFile): { data: Record<string, LinkCache[]>; count: () => number } {
    const data: Record<string, LinkCache[]> = Object.create(null);
    for (const entry of this.documents.values()) {
      const links = entry.outgoing.filter(reference => reference.destination?.path === file.path).map(reference => reference.link);
      if (links.length) {
        data[entry.document.file.path] = links;
      }
    }
    return { data, count: () => Object.values(data).reduce((count, links) => count + links.length, 0) };
  }

  getTags(): Record<string, number> {
    const result: Record<string, number> = Object.create(null);
    for (const entry of this.getDocuments()) {
      for (const tag of allTags(entry.cache)) {
        const parts = tag.split("/");
        for (let length = 1; length <= parts.length; length++) {
          const key = parts.slice(0, length).join("/");
          result[key] = (result[key] ?? 0) + 1;
        }
      }
    }
    return result;
  }

  updateOpenDocuments(): void {
    if (this.root !== this.app.vault.rootPath) {
      return;
    }
    let changed = false;
    for (const [path, session] of this.app.workspace.sessions) {
      const prior = this.documents.get(path);
      if (prior?.text === session.text && prior.document.version === session.document.version && prior.dirty === session.dirty) {
        continue;
      }
      const entry: IndexedDocument = {
        document: session.document, text: session.text, dirty: session.dirty,
        cache: prior?.text === session.text ? prior.cache : parseMarkdown(session.text),
        missing: !(this.app.vault.getAbstractFileByPath(path) instanceof TFile), outgoing: [],
      };
      this.documents.set(path, entry);
      this.resolveSource(entry);
      const file = this.app.vault.getAbstractFileByPath(path);
      this.trigger("changed", file, entry.text, entry.cache);
      if (file instanceof TFile) { this.trigger("resolve", file); }
      changed = true;
    }
    if (changed) {
      this.trigger("resolved");
      this.trigger("finished");
    }
  }

  private resolveSource(entry: IndexedDocument): void {
    const path = entry.document.file.path;
    const resolved: Record<string, number> = Object.create(null);
    const unresolved: Record<string, number> = Object.create(null);
    const issues: MetadataIssue[] = [];
    entry.outgoing = [...entry.cache.links, ...entry.cache.embeds, ...entry.cache.frontmatterLinks].map(link => {
      let target: LinkDestination<TFile> | null = null;
      try {
        target = this.resolveReference(link, path);
      } catch (error) {
        if (!(error instanceof URIError)) {
          throw error;
        }
        issues.push({ path, message: `Invalid URL encoding in link "${link.link}": ${error.message}` });
      }
      const key = target?.file.path ?? link.link;
      const counter = target ? resolved : unresolved;
      counter[key] = (counter[key] ?? 0) + 1;
      return { sourcePath: path, link, destination: target?.file ?? null, ambiguous: target?.ambiguous ?? false };
    });
    this.resolvedLinks[path] = resolved;
    this.unresolvedLinks[path] = unresolved;
    this.resolutionIssues.set(path, issues);
  }

  refresh(force = true): Promise<void> {
    this.forceRequested ||= force;
    if (this.pending) {
      return this.pending;
    }
    const root: string | null = this.root;
    const generation: number = this.generation;
    if (!root || root !== this.app.vault.rootPath) {
      return Promise.resolve();
    }
    const current = (): boolean => generation === this.generation && root === this.root && root === this.app.vault.rootPath;
    const run = async (): Promise<void> => {
      do {
        const force = this.forceRequested;
        this.forceRequested = false;
        if (!force) {
          const state: { root: string; revision: number } = await requestJson(`/api/vault/revision?root=${encodeURIComponent(root)}`);
          if (!current()) {
            return;
          }
          if (state.root === root && state.revision === this.revision && !this.error) {
            continue;
          }
        }
        const [payload, snapshot]: [MetadataDocuments, VaultSnapshot] = await Promise.all([
          requestJson<MetadataDocuments>(`/api/metadata/documents?root=${encodeURIComponent(root)}`),
          requestJson<VaultSnapshot>("/api/vault"),
        ]);
        if (!current()) {
          return;
        }
        if (payload.root !== root || snapshot.root !== root) {
          throw new Error("The vault changed while its metadata was loading. Refresh the selected vault.");
        }
        // Other inventory refreshes must not consume changes before metadata observes them.
        const priorFiles = this.observedFiles;
        const priorDocuments = new Map(this.documents);
        const priorResolved = this.resolvedLinks, priorUnresolved = this.unresolvedLinks;
        this.app.vault.setSnapshot(snapshot);
        this.resolve = createLinkResolver(this.app.vault.getFiles());
        this.documents.clear();
        this.resolutionIssues.clear();
        this.resolvedLinks = Object.create(null);
        this.unresolvedLinks = Object.create(null);
        for (const document of payload.documents) {
          const session = this.app.workspace.sessions.get(document.file.path);
          const text: string = session?.dirty || session?.isSaving ? session.text : document.content;
          const prior = priorDocuments.get(document.file.path);
          this.documents.set(document.file.path, {
            document, text, cache: prior?.text === text ? prior.cache : parseMarkdown(text),
            dirty: session?.dirty ?? false, missing: false, outgoing: [],
          });
        }
        for (const entry of this.documents.values()) {
          this.resolveSource(entry);
        }
        this.diskIssues = payload.errors;
        this.revision = payload.revision;
        this.error = null;
        this.app.workspace.acceptExternalDocuments(payload.documents);
        this.observedFiles = new Map(this.app.vault.getFiles().map(file => [file.path, { file, stat: { ...file.stat } }]));
        this.applying = true;
        try {
          for (const file of this.app.vault.getFiles()) {
            const old = priorFiles.get(file.path);
            if (!old) {
              this.app.vault.notifyFileChanged("create", file, this.documents.get(file.path)?.document.version);
            } else if (old.stat.mtime !== file.stat.mtime || old.stat.size !== file.stat.size || priorDocuments.get(file.path)?.document.version !== this.documents.get(file.path)?.document.version) {
              this.app.vault.notifyFileChanged("modify", file, this.documents.get(file.path)?.document.version);
            }
            const entry = this.documents.get(file.path);
            const prior = priorDocuments.get(file.path);
            if (entry && prior?.text !== entry.text) {
              this.trigger("changed", file, entry.text, entry.cache);
            }
            if (entry && (prior?.text !== entry.text || prior.document.version !== entry.document.version
              || !sameValue(priorResolved[file.path], this.resolvedLinks[file.path]) || !sameValue(priorUnresolved[file.path], this.unresolvedLinks[file.path]))) {
              this.trigger("resolve", file);
            }
          }
          for (const [path, prior] of priorFiles) {
            if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
              this.app.vault.trigger("delete", prior.file);
              this.trigger("deleted", prior.file, priorDocuments.get(path)?.cache ?? null);
            }
          }
        } finally {
          this.applying = false;
        }
        this.trigger("resolved");
        this.trigger("finished");
        await this.app.dotNet.invokeMethodAsync("OnVaultFilesChanged");
        await this.app.notifyEditor();
      } while (this.forceRequested && current());
    };
    const pending = run().finally(() => {
      if (this.pending === pending) {
        this.pending = null;
      }
    });
    this.pending = pending;
    return pending;
  }
}
