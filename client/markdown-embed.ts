import type { Extension } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { App } from "./app";
import { reportError } from "./dom";
import { Editor } from "./editor";
import { Component } from "./plugin";
import { ReadingView } from "./reading";
import { TFile } from "./vault";

interface MarkdownEditorOwner {
  readonly app: App;
  readonly file: TFile | null;
  save?(): Promise<void>;
}

class MarkdownEditor extends Component {
  readonly editor: Editor;
  readonly cm: EditorView;

  constructor(readonly app: App, readonly containerEl: HTMLElement, readonly owner: MarkdownEditorOwner) {
    super();
    this.editor = new Editor(containerEl, update => this.onUpdate(update, true), async () => {
      if (!owner.save) { throw new Error("This embedded editor does not provide a file-saving operation."); }
      await owner.save();
    }, () => app.workspace.trigger("editor-selection-change", this.editor, owner));
    this.cm = this.editor.cm;
    try {
      this.editor.setEditable(true);
      this.editor.addExtension("embedded-markdown-mode", this.buildLocalExtensions());
    } catch (error) {
      this.editor.destroy();
      throw error;
    }
    this.register(() => {
      if (app.workspace.activeEditor?.editor === this.editor) { app.workspace.unsetActiveEditor(); }
      this.editor.destroy();
    });
  }

  buildLocalExtensions(): Extension[] { return []; }
  get(): string { return this.editor.getValue(); }
  set(content: string): void { this.editor.syncValue(content); }
  focus(): void { this.editor.focus(); }
  onUpdate(_update: ViewUpdate, changed: boolean): void {
    if (changed) { this.app.workspace.trigger("editor-change", this.editor, this.owner); }
  }
}

class MarkdownSourceMode extends MarkdownEditor {
  constructor(app: App, containerEl: HTMLElement, override readonly owner: MarkdownEmbed) { super(app, containerEl, owner); }
  override onUpdate(update: ViewUpdate, changed: boolean): void {
    super.onUpdate(update, changed);
    if (changed) { this.owner.sourceChanged(this.editor.getValue()); }
  }
}

interface EmbedContext {
  app: App;
  containerEl: HTMLElement;
  state?: Record<string, unknown>;
  displayMode?: boolean;
}

class MarkdownEmbed extends Component {
  readonly app: App;
  readonly containerEl: HTMLElement;
  readonly previewEl: HTMLElement;
  readonly reading: ReadingView;
  readonly root: string | null;
  editable = false;
  editMode: MarkdownSourceMode | null = null;
  private original = "";
  private content = "";
  private generation = 0;
  private closed = false;
  private saving: Promise<void> | null = null;

  constructor(readonly context: EmbedContext, public file: TFile | null, readonly subpath: string) {
    super();
    this.app = context.app;
    this.root = this.app.vault.rootPath;
    this.containerEl = context.containerEl;
    this.previewEl = this.containerEl.ownerDocument.createElement("div");
    this.previewEl.className = "markdown-embed-content";
    this.containerEl.appendChild(this.previewEl);
    this.reading = new ReadingView(this.app, this.previewEl, true);
  }

  get editor(): Editor | undefined { return this.editMode?.editor; }

  override async onload(): Promise<void> {
    this.register(this.app.registerLeaveGuard(() => this.save()));
    if (this.file) { await this.loadFile(this.file); }
  }

  async loadFile(file: TFile): Promise<void> {
    this.assertCurrent();
    if (!(file instanceof TFile) || file.vault !== this.app.vault || this.app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md") {
      throw new Error("Markdown embeds require an actual Markdown file from their owning vault.");
    }
    await this.save();
    const generation = ++this.generation;
    const content = await this.app.vault.cachedRead(file);
    this.assertCurrent();
    if (generation !== this.generation) { return; }
    this.file = file;
    this.original = this.content = content;
    this.editMode?.set(content);
    this.reading.render(content, file.path);
    await this.reading.whenReady();
    if (this.subpath.startsWith("#")) { this.reading.revealHeading(this.subpath); }
  }

  showEditor(): void {
    this.assertCurrent();
    if (!this.editable || this.context.displayMode) { throw new Error("This Markdown embed is not editable."); }
    if (!this.editMode) {
      const container = this.containerEl.ownerDocument.createElement("div");
      container.className = "markdown-source-view mod-cm6 is-embedded";
      this.containerEl.appendChild(container);
      this.editMode = this.addChild(new MarkdownSourceMode(this.app, container, this));
      this.editMode.set(this.content);
    }
    this.previewEl.hidden = true;
    this.editMode.containerEl.hidden = false;
  }

  showPreview(): void {
    this.assertCurrent();
    if (this.editMode) { this.editMode.containerEl.hidden = true; }
    this.previewEl.hidden = false;
    if (this.file) { this.reading.render(this.content, this.file.path); }
  }

  sourceChanged(content: string): void {
    this.assertCurrent();
    this.content = content;
  }

  save(): Promise<void> {
    if (this.saving) { return this.saving.then(() => this.save()); }
    if (this.content === this.original) { return Promise.resolve(); }
    const operation = this.persist();
    this.saving = operation;
    operation.finally(() => { if (this.saving === operation) { this.saving = null; } }).catch(reportError);
    return operation;
  }

  private async persist(): Promise<void> {
    this.assertCurrent();
    const file = this.file, content = this.content, original = this.original;
    if (!file) { throw new Error("Open a Markdown file before saving this embed."); }
    await this.app.vault.process(file, current => {
      this.assertCurrent();
      if (current !== original) { throw new Error("This embedded Markdown file changed on disk. Its original contents were retained."); }
      return content;
    });
    this.original = content;
  }

  private assertCurrent(): void {
    if (this.closed || !this.root || this.app.vault.rootPath !== this.root || this.file && this.app.vault.getFileByPath(this.file.path) !== this.file) {
      throw new Error("This Markdown embed no longer belongs to the selected vault.");
    }
  }

  override async onunload(): Promise<void> {
    try { await this.save(); }
    finally {
      this.closed = true;
      this.generation++;
      await this.reading.clear();
      this.containerEl.replaceChildren();
    }
  }
}

type EmbedCreator = (context: EmbedContext, file: TFile | null, subpath: string) => Component;

export class EmbedRegistry {
  readonly embedByExtension: Record<string, EmbedCreator> = Object.create(null);

  constructor(readonly app: App) {
    this.registerExtension("md", (context, file, subpath) => {
      if (context.app !== this.app || !(context.containerEl instanceof HTMLElement)) { throw new Error("Embed contexts require their actual App and an owned HTML container."); }
      return new MarkdownEmbed(context, file, subpath);
    });
  }

  registerExtension(extension: string, creator: EmbedCreator): void { this.registerExtensions([extension], creator); }
  registerExtensions(extensions: string[], creator: EmbedCreator): void {
    if (typeof creator !== "function" || !extensions.length || new Set(extensions).size !== extensions.length || extensions.some(extension => !/^[a-z0-9]+$/.test(extension) || this.isExtensionRegistered(extension))) {
      throw new Error("Embed extensions require distinct unregistered lowercase names and an actual creator.");
    }
    for (const extension of extensions) { this.embedByExtension[extension] = creator; }
  }
  unregisterExtension(extension: string): void { delete this.embedByExtension[extension]; }
  unregisterExtensions(extensions: string[]): void { for (const extension of extensions) { this.unregisterExtension(extension); } }
  isExtensionRegistered(extension: string): boolean { return Object.hasOwn(this.embedByExtension, extension); }
  getEmbedCreator(file: TFile): EmbedCreator | null { return this.embedByExtension[file.extension.toLowerCase()] ?? null; }
}
