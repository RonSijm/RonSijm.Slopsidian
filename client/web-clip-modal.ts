import type { App } from "./app";
import { Modal } from "./ui";
import { clipDefaults, clipName, clipPath, withClipProperties, type WebClip } from "./web-clip-policy";

export class WebClipModal extends Modal {
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly path = document.createElement("input");
  private readonly preview = document.createElement("textarea");
  private readonly properties = document.createElement("input");
  private readonly propertyFields = document.createElement("fieldset");
  private readonly propertyTitle = document.createElement("input");
  private readonly propertyTags = document.createElement("input");
  private readonly save = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private clip: WebClip | null = null;
  private reviewedMarkdown: string | null = null;
  private clippedAt = "";
  private propertiesInvalid = false;
  private valid = true;
  busy = false;
  get isSelection(): boolean { return this.actions.selection === true; }
  constructor(app: App, private readonly actions: {
    selection?: boolean;
    readerSelection?: boolean;
    defaults: () => { clipIncludeProperties?: unknown; clipDefaultTags?: unknown };
    extract: () => Promise<WebClip>;
    folder: () => unknown;
    guard: () => void;
    verify: () => Promise<void>;
    closed: () => void;
  }) {
    super(app); const title = actions.selection ? "Save selection to vault" : "Save article to vault"; this.setTitle(title);
    this.modalEl.classList.add("web-clip-modal"); this.modalEl.setAttribute("aria-label", title);
    this.contentEl.dataset.webClip = "preparing";
    this.contentEl.dataset.webClipKind = actions.selection ? "selection" : "article";
    this.contentEl.dataset.webClipSource = actions.readerSelection ? "reader" : "page";
    const hint = document.createElement("p");
    hint.textContent = actions.selection
      ? (actions.readerSelection ? "Review the words selected in Reader" : "Review the selected words") + " and choose a new note path. The selection is saved as plain text with paragraph breaks and a source link. Formatting and images are omitted. Saving also creates any missing parent folders."
      : "Review the article Markdown and choose a new note path. Images are retained as descriptions. Merged table cells repeat across their rows and columns. Saving also creates any missing parent folders.";
    this.status.dataset.webClipStatus = ""; this.status.setAttribute("role", "status");
    this.error.className = "plugin-error"; this.error.dataset.webClipError = ""; this.error.setAttribute("role", "alert"); this.error.hidden = true;
    const pathLabel = document.createElement("label"); pathLabel.textContent = "New note path";
    this.path.dataset.webClipPath = ""; this.path.setAttribute("aria-label", "New note path"); this.path.maxLength = 4096; this.path.disabled = true;
    this.path.addEventListener("input", () => this.update()); pathLabel.append(this.path);
    const propertiesLabel = document.createElement("label"); propertiesLabel.className = "web-clip-properties-toggle";
    this.properties.type = "checkbox"; this.properties.dataset.webClipProperties = ""; this.properties.disabled = true;
    propertiesLabel.append(this.properties, document.createTextNode("Add note properties"));
    this.properties.addEventListener("change", () => this.updatePreview());
    this.propertyFields.dataset.webClipPropertyFields = ""; this.propertyFields.hidden = true;
    const legend = document.createElement("legend"); legend.textContent = "Note properties";
    const titleLabel = document.createElement("label"); titleLabel.textContent = "Title property";
    this.propertyTitle.dataset.webClipPropertyTitle = ""; this.propertyTitle.maxLength = 1024; titleLabel.append(this.propertyTitle);
    const tagsLabel = document.createElement("label"); tagsLabel.textContent = "Tags (comma-separated)";
    this.propertyTags.dataset.webClipPropertyTags = ""; this.propertyTags.maxLength = 2048; this.propertyTags.placeholder = "research, project/nested"; tagsLabel.append(this.propertyTags);
    const automatic = document.createElement("small"); automatic.textContent = "Source and clipping time are included automatically. All properties appear in the Markdown preview.";
    this.propertyFields.append(legend, titleLabel, tagsLabel, automatic);
    for (const input of [this.propertyTitle, this.propertyTags]) { input.disabled = true; input.addEventListener("input", () => this.updatePreview()); }
    const previewLabel = document.createElement("label"); previewLabel.textContent = "Markdown preview";
    this.preview.dataset.webClipPreview = ""; this.preview.setAttribute("aria-label", "Markdown preview"); this.preview.readOnly = true; this.preview.spellcheck = false;
    previewLabel.append(this.preview);
    const buttons = document.createElement("div"); buttons.className = "modal-button-container";
    this.cancel.type = this.save.type = "button";
    this.cancel.textContent = "Cancel"; this.cancel.dataset.webClipAction = "cancel"; this.cancel.addEventListener("click", () => this.close());
    this.save.textContent = "Save note"; this.save.className = "mod-cta"; this.save.dataset.webClipAction = "save"; this.save.disabled = true;
    this.save.addEventListener("click", () => { void this.saveNote(); }); buttons.append(this.cancel, this.save);
    const scroll = document.createElement("div"); scroll.className = "web-clip-scroll";
    scroll.append(hint, this.status, this.error, pathLabel, propertiesLabel, this.propertyFields, previewLabel);
    this.contentEl.append(scroll, buttons);
  }
  override onOpen(): void {
    this.status.textContent = this.actions.selection ? "Preparing selection…" : "Preparing article…";
    void this.prepare();
  }
  private guard(): void {
    if (!this.isOpen || !this.valid) { throw new Error("This article preview is no longer active. Reopen Save to vault."); }
    this.actions.guard();
  }
  private showError(issue: unknown): void {
    this.error.textContent = (issue instanceof Error ? issue.message : String(issue)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
    this.error.hidden = false;
  }
  private update(): void {
    this.save.disabled = this.busy || !this.valid || !this.clip || !this.reviewedMarkdown || !this.path.value;
    this.path.disabled = this.busy || !this.valid || !this.clip;
    this.properties.disabled = this.busy || !this.valid || !this.clip;
    this.propertyTitle.disabled = this.propertyTags.disabled = this.properties.disabled || !this.properties.checked;
    this.cancel.disabled = this.busy;
  }
  private updatePreview(): void {
    if (!this.isOpen || !this.valid || !this.clip || this.busy) { return; }
    this.propertyFields.hidden = !this.properties.checked;
    try {
      const markdown = this.properties.checked ? withClipProperties(this.clip, { title: this.propertyTitle.value, tags: this.propertyTags.value, clippedAt: this.clippedAt }) : this.clip.markdown;
      this.reviewedMarkdown = markdown; this.preview.value = markdown;
      if (this.propertiesInvalid) { this.error.hidden = true; }
      this.propertiesInvalid = false; this.status.textContent = "Ready to save · " + this.clip.url;
    } catch (issue) {
      this.reviewedMarkdown = null; this.preview.value = ""; this.propertiesInvalid = true;
      this.showError(issue); this.status.textContent = "Correct note properties before saving · " + this.clip.url;
    }
    this.update();
  }
  private async prepare(): Promise<void> {
    try {
      const defaults = clipDefaults(this.actions.defaults());
      const clip = await this.actions.extract(); this.guard(); this.clip = clip;
      this.clippedAt = new Date().toISOString(); this.propertyTitle.value = clip.title;
      this.properties.checked = defaults.clipIncludeProperties; this.propertyTags.value = defaults.clipDefaultTags;
      const occupied = new Set(this.app.vault.getAllLoadedFiles().map(file => file.path.toLowerCase()));
      try { this.path.value = clipName(clip.title + (this.actions.selection ? " selection" : ""), this.actions.folder(), path => occupied.has(path.toLowerCase())); }
      catch (issue) { this.showError(issue); }
      this.contentEl.dataset.webClip = "preview"; this.updatePreview(); this.path.focus(); this.path.select();
    } catch (issue) {
      if (!this.isOpen) { return; }
      this.valid = false; this.showError(issue); this.status.textContent = (this.actions.selection ? "Selection" : "Article") + " unavailable · Close to return to the page";
      this.contentEl.dataset.webClip = "unavailable"; this.update();
    }
  }
  private async saveNote(): Promise<void> {
    if (this.busy || !this.clip || !this.reviewedMarkdown || !this.valid || !this.isOpen) { return; }
    this.busy = true; this.error.hidden = true; this.update();
    let savedPath: string | null = null;
    try {
      const markdown = this.reviewedMarkdown, path = clipPath(this.path.value);
      await this.app.core.run(() => this.app.workspace.withFileMutation(async () => {
        this.guard(); await this.actions.verify(); this.guard();
        const file = await this.app.vault.create(path, markdown);
        savedPath = file.path;
      }));
    } catch (issue) {
      if (this.isOpen) { this.showError(issue); }
    } finally { this.busy = false; this.update(); }
    if (savedPath) {
      // Creation is final before changing panes. An editor-opening failure must
      // never offer a second write or overwrite the newly created note.
      const file = this.app.vault.getFileByPath(savedPath);
      this.forceClose();
      if (file) { await this.app.workspace.getLeaf("tab").openFile(file).catch(issue => { console.error("The article was saved but could not be opened:", issue); }); }
    }
  }
  invalidate(): void {
    if (!this.isOpen) { return; }
    this.valid = false; this.showError(new Error("The source page changed. Close this preview and reopen Save to vault to review its current article."));
    this.update();
  }
  override close(): void { if (!this.busy) { this.forceClose(); } }
  forceClose(): void { super.close(); }
  override onClose(): void {
    this.valid = false; this.clip = null; this.reviewedMarkdown = null; this.preview.value = "";
    this.clippedAt = ""; this.propertyTitle.value = this.propertyTags.value = ""; this.properties.checked = false;
    this.actions.closed();
  }
}
