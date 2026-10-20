import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { footnoteEntries, footnotesPaneState, type FootnoteEntry } from "./footnotes-pane-model";
import { parseMarkdown, type Pos } from "./markdown";
import { Component } from "./plugin";
import { createMarkdownRenderer } from "./reading";
import { TFile } from "./vault";
import { FileView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

interface FootnotesSnapshot { id: number; file: TFile; path: string; text: string; entries: FootnoteEntry[]; targets: Map<string, Pos>; }

export class FootnotesPaneView extends FileView {
  override icon = "file";
  override navigation = false;
  override allowNoFile = true;
  private options = footnotesPaneState({});
  private readonly sourceRoot: string | null;
  private readonly follow = document.createElement("input");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly list = document.createElement("div");
  private readonly renderer: ReturnType<typeof createMarkdownRenderer>;
  private renderOwner: Component | null = null;
  private snapshot: FootnotesSnapshot | null = null;
  private noteView: MarkdownView | null = null;
  private request = 0;
  private revision = 0;
  private queued = false;
  private settingState = false;
  private grouped = false;
  private message = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath; this.renderer = createMarkdownRenderer(this.app);
    this.contentEl.classList.add("footnotes-workspace"); this.contentEl.dataset.footnotesPane = leaf.id;
    const controls = document.createElement("div"), label = document.createElement("label"); controls.className = "discovery-pane-controls";
    this.follow.type = "checkbox"; this.follow.dataset.footnotesFollow = "true"; label.append(this.follow, "Follow active note"); controls.append(label);
    this.caption.className = "discovery-pane-caption"; this.caption.dataset.footnotesFile = "true";
    this.status.className = "discovery-status"; this.status.setAttribute("role", "status"); this.status.dataset.footnotesStatus = "true";
    this.list.className = "footnotes-pane-list"; this.list.setAttribute("role", "list"); this.list.setAttribute("aria-label", "Note footnotes");
    this.contentEl.append(controls, this.caption, this.list, this.status);
    this.registerDomEvent(this.follow, "change", () => this.run(() => {
      if (this.leaf.pinned || this.grouped) { this.updateControls(); return; }
      this.options.followActiveFile = this.follow.checked; this.save(); this.schedule();
    }));
    this.registerDomEvent(this.list, "click", event => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const target = event.target.closest<HTMLElement>("[data-footnote-target]");
      if (target) { this.run(() => this.navigate(target.dataset.footnoteTarget!, Number(target.dataset.footnotesGeneration), event.ctrlKey || event.metaKey)); }
    });
    this.registerDomEvent(this.list, "keydown", event => {
      if (!(event instanceof KeyboardEvent) || !this.interactive() || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) { return; }
      const buttons = [...this.list.querySelectorAll<HTMLButtonElement>("[data-footnote-target]")], index = buttons.findIndex(button => button === event.target);
      if (index < 0) { return; }
      const target = event.key === "ArrowDown" ? buttons[Math.min(index + 1, buttons.length - 1)] : event.key === "ArrowUp" ? buttons[Math.max(index - 1, 0)] : event.key === "Home" ? buttons[0] : event.key === "End" ? buttons.at(-1) : null;
      if (target) { event.preventDefault(); event.stopPropagation(); target.focus(); }
    });
    this.registerEvent(this.app.metadataCache.on("finished", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (leaf && typeof leaf === "object" && "view" in leaf && leaf.view instanceof MarkdownView && leaf.view.file === this.file) { this.noteView = leaf.view; }
      this.schedule();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && oldPath === this.options.file && this.owned()) { this.options.file = file.path; this.save(); this.schedule(); }
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.schedule()));
    this.registerEvent(this.app.core.on("changed", () => { this.updateControls(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-ready", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("layout-change", () => { this.updateControls(); this.schedule(); }));
    this.register(() => { this.request++; this.snapshot = null; this.noteView = null; this.clearRender(); });
  }

  getViewType(): string { return "footnotes"; }
  override getDisplayText(): string { return "Footnotes"; }
  override canAcceptExtension(_extension: string): boolean { return true; }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = footnotesPaneState(state), file = this.app.vault.getFileByPath(options.file);
    if (!this.owned()) { throw new Error("Set state on a current Footnotes workspace view."); }
    const binding = { ...state }; if (!file) { delete binding.file; }
    this.settingState = true;
    try { await super.setState(binding, result); } finally { this.settingState = false; }
    this.options = options; this.grouped = typeof state.group === "string" && Boolean(state.group);
    this.request++; this.snapshot = null; this.noteView = null; this.clearRender(); this.updateControls(); this.schedule();
  }
  override async loadFile(file: TFile | null): Promise<boolean> {
    if (!this.settingState && file !== null && !this.interactive()) { throw new Error("Load a file on a live Footnotes pane after current operations finish."); }
    if (this.settingState) { return super.loadFile(file); }
    const changed = await super.loadFile(file);
    if (changed && this.owned()) {
      this.options.file = file?.path ?? ""; this.request++; this.snapshot = null; this.noteView = null; this.clearRender(); this.save(); this.schedule();
    }
    return changed;
  }
  async setFile(file: TFile): Promise<void> {
    if (!this.interactive() || !(file instanceof TFile) || this.app.vault.getFileByPath(file.path) !== file) { throw new Error("Set a live Footnotes pane to a current file in the selected vault."); }
    this.options.followActiveFile = false; const changed = await this.loadFile(file); this.updateControls();
    if (!changed) { this.save(); this.schedule(); }
  }
  protected override async onOpen(): Promise<void> { this.updateControls(); this.schedule(); }

  private owned(): boolean { return this.isLoaded && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean { return this.owned() && Boolean(this.sourceRoot) && !this.settingState && !this.app.changingVault && !this.app.core.busy && this.app.core.isEnabled("footnotes") && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout; }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    Promise.resolve().then(() => { if (this.interactive()) { this.message = ""; return action(); } }).catch(error => {
      if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error);
    });
  }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private clearRender(): void { if (this.renderOwner) { this.removeChild(this.renderOwner); this.renderOwner = null; } this.list.replaceChildren(); }
  private schedule(): void {
    this.request++;
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => { this.queued = false; if (this.owned()) { this.refresh().catch(error => { if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); reportError(error); } }); } });
  }
  private updateControls(): void {
    const enabled = this.interactive(); this.follow.disabled = !enabled || this.leaf.pinned || this.grouped; this.follow.checked = this.options.followActiveFile;
    this.follow.title = this.leaf.pinned ? "Unpin this tab to follow the active note." : this.grouped ? "Linked-group following is not implemented; this pane retains its saved note." : "Follow the active note";
    this.caption.textContent = this.options.file || "No note selected"; this.list.setAttribute("aria-disabled", String(!enabled));
    this.list.querySelectorAll<HTMLButtonElement>("[data-footnote-target]").forEach(button => { button.disabled = !enabled; });
  }
  private async refresh(): Promise<void> {
    this.updateControls(); if (!this.interactive()) { return; }
    const token = ++this.request, active = this.app.workspace.getActiveFile();
    const path = this.options.followActiveFile && !this.leaf.pinned && !this.grouped && active && this.app.vault.getFileByPath(active.path) === active ? active.path : this.options.file;
    const file = this.app.vault.getFileByPath(path);
    if (file !== this.file) { await super.loadFile(file); }
    if (!this.interactive() || token !== this.request) { return; }
    if (path !== this.options.file) { this.options.file = path; this.snapshot = null; this.noteView = null; this.clearRender(); this.save(); }
    this.updateControls();
    if (!file || file.extension.toLowerCase() !== "md") {
      this.snapshot = null; this.clearRender(); this.status.textContent = path ? file ? "Footnotes are available for Markdown notes." : "This note is missing or unavailable: " + path : "Open a Markdown note to see its footnotes."; return;
    }
    const indexed = this.app.metadataCache.getDocument(path), text = indexed && !indexed.missing ? indexed.text : await this.app.vault.read(file);
    if (!this.interactive() || token !== this.request || this.options.file !== path || this.file !== file || this.app.vault.getFileByPath(path) !== file) { return; }
    if (this.snapshot?.file === file && this.snapshot.path === path && this.snapshot.text === text) { return; }
    const current = this.app.metadataCache.getDocument(path), cache = current && !current.missing && current.text === text ? current.cache : parseMarkdown(text);
    this.snapshot = { id: ++this.revision, file, path, text, entries: footnoteEntries(cache, text), targets: new Map() }; this.render();
  }
  private render(): void {
    const snapshot = this.snapshot; if (!snapshot) { return; }
    const focus = this.list.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.footnoteTarget : undefined;
    this.clearRender(); const owner = this.renderOwner = this.addChild(new Component()), fragment = document.createDocumentFragment(), previews: { element: HTMLElement; text: string }[] = [];
    const target = (item: FootnoteEntry, kind: "definition" | "reference", index: number, position: Pos, text: string): HTMLButtonElement => {
      const button = document.createElement("button"), key = JSON.stringify([item.id, kind, index]); button.type = "button"; button.dataset.footnoteTarget = key; button.dataset.footnotesGeneration = String(snapshot.id); button.dataset[kind === "definition" ? "paneFootnoteDefinition" : "paneFootnoteReference"] = item.id; button.textContent = text; button.title = "Reveal the exact " + kind + " in Source"; snapshot.targets.set(key, position); return button;
    };
    for (const item of snapshot.entries) {
      const group = document.createElement("article"); group.className = "footnotes-pane-entry"; group.dataset.footnotesEntry = item.id; group.setAttribute("role", "listitem");
      const title = document.createElement("p"); title.className = "footnotes-pane-title"; title.textContent = (item.number === null ? "?" : String(item.number)) + ". [^" + item.id + "]";
      group.append(title);
      if (!item.definitions.length) { const missing = document.createElement("p"); missing.className = "footnotes-pane-warning"; missing.textContent = "Missing definition"; group.append(missing); }
      if (item.definitions.length > 1) { const duplicate = document.createElement("p"); duplicate.className = "footnotes-pane-warning"; duplicate.textContent = item.definitions.length + " definitions share this identifier."; group.append(duplicate); }
      for (const [index, definition] of item.definitions.entries()) {
        group.append(target(item, "definition", index, definition.labelPosition, "Definition" + (item.definitions.length > 1 ? " " + (index + 1) : "") + " - line " + (definition.labelPosition.start.line + 1)));
        const preview = document.createElement("div"); preview.className = "footnotes-pane-preview"; preview.dataset.paneFootnoteContent = item.id; group.append(preview); previews.push({ element: preview, text: definition.content });
      }
      for (const [index, reference] of item.references.entries()) { group.append(target(item, "reference", index, reference.position, `Reference ${index + 1} - line ${reference.position.start.line + 1}`)); }
      if (!item.references.length) { const unused = document.createElement("p"); unused.className = "footnotes-pane-unused"; unused.textContent = "No references"; group.append(unused); }
      fragment.append(group);
    }
    this.list.append(fragment); this.status.textContent = this.message || (snapshot.entries.length ? `${snapshot.entries.filter(item => item.definitions.length).length} footnotes.` + (snapshot.entries.some(item => !item.definitions.length) ? " Missing definitions are listed below." : "") : "No footnotes in this note.");
    this.updateControls();
    if (focus) { [...this.list.querySelectorAll<HTMLButtonElement>("[data-footnote-target]")].find(button => button.dataset.footnoteTarget === focus)?.focus(); }
    for (const preview of previews) {
      this.renderer.render(this.app, preview.text, preview.element, snapshot.path, owner).catch(error => {
        if (this.owned() && this.snapshot === snapshot) { preview.element.textContent = error instanceof Error ? error.message : String(error); reportError(error); }
      });
    }
  }
  private source(): MarkdownView | null {
    const views = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === this.file && view.isLoaded);
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    return active && views.includes(active) ? active : this.noteView && views.includes(this.noteView) ? this.noteView : views[0] ?? null;
  }
  private async navigate(key: string, generation: number, tab: boolean): Promise<void> {
    const snapshot = this.snapshot, position = snapshot?.targets.get(key);
    if (!snapshot || generation !== snapshot.id || !position || this.file !== snapshot.file || this.app.vault.getFileByPath(snapshot.path) !== snapshot.file) { this.schedule(); return; }
    let view = !tab ? this.source() : null;
    const stale = (): void => { this.message = "The note changed; its footnotes have been refreshed."; this.app.metadataCache.updateOpenDocuments(); this.schedule(); };
    if (view && view.editor.getValue() !== snapshot.text) { stale(); return; }
    if (!view) { const leaf = this.app.workspace.getLeaf("tab"); await leaf.openFile(snapshot.file); view = leaf.view instanceof MarkdownView ? leaf.view : null; }
    if (!this.interactive() || this.snapshot !== snapshot || !view || view.file !== snapshot.file) { return; }
    if (view.editor.getValue() !== snapshot.text) { stale(); return; }
    this.noteView = view; this.app.workspace.setActiveLeaf(view.leaf, { focus: false }); view.setMode("source"); view.editor.setSelection(position.start, position.end); view.editor.scrollIntoView({ from: position.start, to: position.end }, true); view.editor.focus();
  }
}
