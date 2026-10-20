import type { App } from "./app";
import type { TFile } from "./vault";
import { embeddedMarkdown } from "./note-embed-section";
import { parseMarkdown } from "./markdown";
import { MAX_CANVAS_PREVIEW_CHARACTERS } from "./canvas-interaction-model";

export interface CanvasPreviewReading {
  render(text: string, path: string): void;
  clear(): Promise<void>;
  whenReady(): Promise<void>;
}

/** One file card's read-only Markdown preview. Retired reads never remount content. */
export class CanvasPreview {
  private generation = 0;
  private closed = false;
  private readonly root: string | null;
  private readonly path: string;
  private readonly reading: CanvasPreviewReading;
  ready: Promise<void>;

  constructor(private readonly options: {
    app: App; file: TFile; subpath: string; host: HTMLElement;
    current(): boolean;
    createReading(host: HTMLElement): CanvasPreviewReading;
  }) {
    this.root = options.app.vault.rootPath;
    this.path = options.file.path;
    this.reading = options.createReading(options.host);
    this.ready = Promise.resolve().then(() => this.refresh());
  }

  private current(generation: number): boolean {
    const { app, file } = this.options;
    return !this.closed && generation === this.generation && this.root === app.vault.rootPath && !app.changingVault
      && file.path === this.path && app.vault.getFileByPath(this.path) === file && this.options.current();
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation, { app, file, host } = this.options;
    if (!this.current(generation)) { return; }
    host.dataset.canvasPreview = "pending";
    try {
      app.metadataCache.updateOpenDocuments();
      const indexed = app.metadataCache.getDocument(this.path);
      // A read-only remote mount must have genuine cached text; never fetch raw content for a card.
      if ((!indexed || indexed.missing) && app.vault.readOnly) { throw new Error("This note is not in the local cache. Open a complete cached index to preview it."); }
      const text = indexed && !indexed.missing ? indexed.text : await app.vault.cachedRead(file);
      if (!this.current(generation)) { return; }
      if (text.length > MAX_CANVAS_PREVIEW_CHARACTERS) { throw new Error("Canvas note previews are limited to 262,144 characters."); }
      const section = embeddedMarkdown(text, this.options.subpath, parseMarkdown(text));
      this.reading.render(section, this.path);
      await this.reading.whenReady();
      if (this.current(generation)) { host.dataset.canvasPreview = "ready"; }
    } catch (error) {
      if (!this.current(generation)) { return; }
      await this.reading.clear();
      if (!this.current(generation)) { return; }
      const message = host.ownerDocument.createElement("p");
      message.className = "canvas-preview-error"; message.setAttribute("role", "status");
      message.textContent = error instanceof Error ? error.message : String(error);
      host.replaceChildren(message); host.dataset.canvasPreview = "error";
    }
  }

  dispose(): Promise<void> {
    if (this.closed) { return Promise.resolve(); }
    this.closed = true; this.generation++;
    return this.reading.clear();
  }
}
