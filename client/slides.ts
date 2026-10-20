import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { reportError } from "./dom";
import { markdownSlides } from "./markdown";
import { Component } from "./plugin";
import { ReadingView } from "./reading";
import type { TFile } from "./vault";
import type { WorkspaceLeaf } from "./workspace";

class SlidePresentation extends Component {
  private readonly dialog = document.createElement("dialog");
  private readonly stage = document.createElement("div");
  private readonly progress = document.createElement("output");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly reading: ReadingView;
  private index = 0;
  private closing: Promise<void> | null = null;

  constructor(leaf: WorkspaceLeaf, readonly file: TFile, private readonly slides: readonly string[]) {
    super();
    this.dialog.className = "slides-container";
    this.dialog.tabIndex = -1;
    this.dialog.setAttribute("aria-label", "Presentation: " + file.basename);
    const toolbar = document.createElement("div");
    toolbar.className = "slides-toolbar";
    const title = document.createElement("span");
    title.className = "slides-title";
    title.textContent = file.basename;
    this.previous.textContent = "Previous";
    this.previous.dataset.slideAction = "previous";
    this.next.textContent = "Next";
    this.next.dataset.slideAction = "next";
    const close = document.createElement("button");
    close.textContent = "Exit presentation";
    close.dataset.slideAction = "close";
    this.progress.setAttribute("aria-live", "polite");
    toolbar.append(title, this.previous, this.progress, this.next, close);
    this.stage.className = "slides-stage";
    this.reading = new ReadingView(leaf, this.stage, true);
    this.dialog.append(toolbar, this.stage);
    this.register(() => {
      this.reading.clear();
      this.dialog.remove();
      if (leaf.workspace.activeLeaf === leaf && !leaf.workspace.app.changingVault && !document.querySelector("dialog[open]")) { leaf.view.focus(); }
    });
    this.registerDomEvent(this.previous, "click", () => this.select(this.index - 1));
    this.registerDomEvent(this.next, "click", () => this.select(this.index + 1));
    this.registerDomEvent(close, "click", () => this.unload().catch(reportError));
    this.registerDomEvent(this.dialog, "cancel", event => {
      event.preventDefault();
      this.unload().catch(reportError);
    });
    this.registerDomEvent(this.dialog, "keydown", event => {
      if (!(event instanceof KeyboardEvent) || event.ctrlKey || event.altKey || event.metaKey) { return; }
      const key = event.key;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "ArrowLeft", "ArrowUp", "PageUp", "Home", "End", "Escape"].includes(key)) {
        event.preventDefault();
        event.stopPropagation();
        if (key === "Escape") { this.unload().catch(reportError); }
        else if (key === "Home") { this.select(0); }
        else if (key === "End") { this.select(slides.length - 1); }
        else { this.select(this.index + (["ArrowLeft", "ArrowUp", "PageUp"].includes(key) || key === " " && event.shiftKey ? -1 : 1)); }
      }
    });
    this.registerEvent(leaf.workspace.on("active-leaf-change", active => {
      if (active !== leaf) { return this.unload(); }
    }));
    this.registerEvent(leaf.workspace.app.vault.on("delete", deleted => {
      if (deleted === file) { return this.unload(); }
    }));
  }

  open(): void {
    document.body.append(this.dialog);
    this.select(0);
    this.dialog.showModal();
    this.dialog.focus();
  }

  override unload(): Promise<void> {
    this.closing ??= super.unload();
    return this.closing;
  }

  private select(index: number): void {
    this.index = Math.max(0, Math.min(index, this.slides.length - 1));
    this.stage.dataset.slideIndex = String(this.index);
    this.stage.dataset.slideCount = String(this.slides.length);
    this.reading.render(this.slides[this.index], this.file.path);
    this.stage.scrollTop = 0;
    this.progress.value = `${this.index + 1} / ${this.slides.length}`;
    this.previous.disabled = this.index === 0;
    this.next.disabled = this.index === this.slides.length - 1;
  }
}

export class Slides {
  readonly id = "slides";
  private presentation: SlidePresentation | null = null;

  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, () => {
      const removeCommands = this.app.commands.install([{
        id: "slides:start",
        name: "Start presentation",
        checkCallback: checking => {
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension.toLowerCase() !== "md") { return false; }
          if (!checking) { core.run(() => this.start(file)).catch(reportError); }
          return true;
        },
      }]);
      return async () => { removeCommands(); await this.presentation?.unload(); };
    }, this);
  }

  private async start(file: TFile): Promise<void> {
    const root = this.app.vault.rootPath;
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf) { throw new Error("Open a Markdown note before presenting it."); }
    this.app.metadataCache.updateOpenDocuments();
    const content = this.app.metadataCache.getDocument(file.path)?.text ?? await this.app.vault.cachedRead(file);
    if (!this.app.core.isEnabled(this.id) || root !== this.app.vault.rootPath || this.app.changingVault
      || this.app.vault.getAbstractFileByPath(file.path) !== file) {
      throw new Error("The presentation's vault or file changed before it opened.");
    }
    await this.presentation?.unload();
    const presentation = new SlidePresentation(leaf, file, markdownSlides(content));
    this.presentation = presentation;
    presentation.register(() => { if (this.presentation === presentation) { this.presentation = null; } });
    try {
      await presentation.load();
      presentation.open();
    } catch (error) {
      await presentation.unload();
      throw error;
    }
  }
}
