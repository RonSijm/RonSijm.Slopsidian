import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, getBrowserHost, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { iconButton } from "./icons";
import { CanvasDocument, canvasColor, validateCanvas, type CanvasData, type CanvasNode, type CanvasSide } from "./canvas-model";
import { ReadingView } from "./reading";
import { TFile } from "./vault";
import { TextFileView } from "./views";
import { readViewport, type Viewport } from "./viewport";
import type { WorkspaceLeaf } from "./workspace";
import { ResponsiveViewPanel } from "./view-panel";
import { Menu } from "./menu";
import { CanvasPreview } from "./canvas-preview";
import { CanvasFileChooser } from "./canvas-chooser";
import { canvasConnectionPath, canvasDetailsVisible } from "./canvas-interaction-model";
import { captureCanvasExport } from "./canvas-export";
import { CanvasExportModal } from "./canvas-export-modal";
import { convertedCanvasTextCard } from "./canvas-convert";
import { CanvasConvertModal } from "./canvas-convert-modal";
import { captureCanvasJump, canvasJumpViewport } from "./canvas-jump";
import { CanvasJumpModal } from "./canvas-jump-modal";
import { applyCanvasArrangement, planCanvasArrangement, type CanvasArrangement } from "./canvas-arrange";
import { CanvasArrangeModal } from "./canvas-arrange-modal";
import { applyCanvasLayout, planCanvasLayout, type CanvasLayoutPlan } from "./canvas-layout";
import { CanvasLayoutModal } from "./canvas-layout-modal";
import { canvasClipSegment, canvasEdgeAtPoint, canvasEdgeSegment, canvasNodeAtPoint, planCanvasMounts, type CanvasMountPlan } from "./canvas-virtualization";

const svgNamespace = "http://www.w3.org/2000/svg";
const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
const creationActions = [
  { id: "card", title: "Add text card" },
  { id: "note", title: "Add note" },
  { id: "media", title: "Add media" },
  { id: "webpage", title: "Add website" },
  { id: "group", title: "Create group" },
] as const;
type CanvasRectangle = Pick<CanvasNode, "x" | "y" | "width" | "height">;

async function openWebsite(value: string): Promise<void> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) { throw new Error("Canvas website cards can open only HTTP or HTTPS addresses."); }
  if (!getBrowserHost() && typeof require === "function") { await require("electron").shell.openExternal(url.href); }
  else { window.open(url.href, "_blank", "noopener,noreferrer"); }
}

export class Canvases {
  readonly id = "canvas";
  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    const views = { canvas: (leaf: WorkspaceLeaf) => new CanvasView(leaf, this) };
    core.register(this.id, async () => {
      const closeViews = await core.installViews(this.id, views);
      let extension: () => void;
      let commands: () => void;
      try {
        extension = this.app.workspace.registerExtensions("core:canvas", ["canvas"], "canvas");
        commands = this.app.commands.install([
          { id: "canvas:new-file", name: "Create new canvas", callback: () => core.run(() => this.create()) },
          { id: "canvas:jump-to-card", name: "Jump to Canvas card", hotkeys: [{ modifiers: ["Mod"], key: "f" }], checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(CanvasView);
            if (!view || !view.canvas.canJump() || view.canvas.stage.ownerDocument.activeElement?.closest('input,textarea,select,iframe,[contenteditable]:not([contenteditable="false"])')) { return false; }
            if (!checking) { view.canvas.jump(); }
            return true;
          } },
        ]);
      } catch (error) { await closeViews(); throw error; }
      const ribbon = iconButton("layout-dashboard", "Create new canvas", () => this.app.commands.execute("canvas:new-file").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      document.getElementById("core-ribbon")!.append(ribbon);
      return async () => { await closeViews(); extension(); commands(); ribbon.remove(); };
    }, this, views);
  }

  async create(): Promise<void> {
    if (this.app.vault.readOnly || this.app.changingVault || this.app.workspace.isChangingFiles) { throw new Error("This vault is not available for Canvas creation."); }
    const options = this.options;
    const current = this.app.workspace.getActiveFile()?.parent?.path ?? "";
    const folder = options.newFileLocation === "current" ? current : options.newFileLocation === "folder" ? String(options.newFileFolderPath) : "";
    if (folder && !this.app.vault.getFolderByPath(folder)) { throw new Error("The configured Canvas folder does not exist: " + folder); }
    let path = "";
    for (let index = 0; index < 1000; index++) {
      const candidate = (folder && folder !== "/" ? folder + "/" : "") + "Untitled" + (index ? " " + index : "") + ".canvas";
      if (!this.app.vault.getAbstractFileByPath(candidate)) { path = candidate; break; }
    }
    if (!path) { throw new Error("No free Untitled canvas filename was found."); }
    const file = await this.app.vault.create(path, JSON.stringify({ nodes: [], edges: [] }, null, "\t"));
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
}

interface PointerDrag {
  pointer: number;
  kind: "pan" | "move" | "resize" | "connect" | "rectangle";
  startX: number;
  startY: number;
  moved: boolean;
  originals: Map<string, CanvasNode>;
  preview: Map<string, CanvasNode>;
  camera: Viewport;
  source?: string;
  side?: CanvasSide;
  previousSelection?: Set<string>;
  current(): boolean;
  target?: string;
  targetSide?: CanvasSide;
}

export class CanvasBoard {
  readonly selection = new Set<string>();
  readonly stage = document.createElement("div");
  camera: Viewport | null = null;
  private document: CanvasDocument | null = null;
  private readonly world = document.createElement("div");
  private readonly edges = document.createElementNS(svgNamespace, "svg");
  private readonly overview = document.createElementNS(svgNamespace, "svg");
  private readonly cards = document.createElement("div");
  private readonly inspector = document.createElement("form");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly views = new Map<string, HTMLElement>();
  private readonly readings = new Map<string, ReadingView>();
  private readonly filePreviews = new Map<string, CanvasPreview>();
  private readonly signatures = new Map<string, string>();
  private readonly edgeViews = new Map<string, SVGGElement>();
  private readonly edgeSignatures = new Map<string, string>();
  private mountPlan: CanvasMountPlan | null = null;
  private mountRevision = 0;
  private readonly fields = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly mutationButtons = new Set<HTMLButtonElement>();
  private inspectorKey = "";
  private readonly panel: ResponsiveViewPanel;
  private selectedEdge: string | null = null;
  private drag: PointerDrag | null = null;
  private readonly region = document.createElement("div");
  private holdingSpace = false;
  private creationMenu: Menu | null = null;
  private creation: { dialog: HTMLDialogElement; events: AbortController } | null = null;
  private chooser: CanvasFileChooser | null = null;
  private exportReview: CanvasExportModal | null = null;
  private conversionReview: CanvasConvertModal | null = null;
  private arrangeReview: CanvasArrangeModal | null = null;
  private layoutReview: CanvasLayoutModal | null = null;
  private jumpReview: CanvasJumpModal | null = null;
  private detailsVisible = true;
  private readonly connectionPreview = document.createElementNS(svgNamespace, "path");
  private inputError = "";
  private saveError = "";
  private disposed = false;
  private generation = 0;
  private revision = 0;
  private loadedPath: string | null = null;
  private loadedRoot: string | null = null;

  constructor(readonly view: CanvasView, readonly plugin: Canvases) {
    const content = view.contentEl;
    content.classList.add("canvas-view");
    this.stage.className = "canvas-wrapper";
    this.stage.tabIndex = 0;
    this.stage.setAttribute("role", "group");
    this.stage.setAttribute("aria-label", "Canvas board");
    this.stage.dataset.canvasSurface = view.leaf.id;
    this.world.className = "canvas";
    this.cards.className = "canvas-cards";
    this.edges.classList.add("canvas-edges");
    this.overview.classList.add("canvas-overview");
    this.overview.dataset.canvasOverview = "";
    this.overview.setAttribute("aria-hidden", "true");
    this.overview.setAttribute("pointer-events", "none");
    this.connectionPreview.classList.add("canvas-connection-preview");
    this.connectionPreview.dataset.canvasConnectionPreview = "";
    this.connectionPreview.setAttribute("aria-hidden", "true");
    this.connectionPreview.setAttribute("pointer-events", "none");
    this.world.append(this.edges, this.overview, this.cards);
    this.region.className = "canvas-selection-region";
    this.region.hidden = true;
    this.stage.append(this.world, this.region);
    this.inspector.className = "canvas-inspector";
    this.panel = new ResponsiveViewPanel(content, this.inspector, 650);
    view.register(() => this.panel.destroy());
    this.inspector.dataset.canvasInspector = "";
    this.inspector.setAttribute("aria-label", "Canvas selection");
    this.inspector.addEventListener("submit", event => event.preventDefault());
    this.status.className = "canvas-status";
    this.status.dataset.canvasStatus = "";
    this.status.setAttribute("role", "status");
    this.error.className = "canvas-error";
    this.error.dataset.canvasError = "";
    this.error.setAttribute("role", "alert");
    const toolbar = document.createElement("div");
    toolbar.className = "canvas-toolbar";
    const button = (label: string, action: () => unknown): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      element.dataset.canvasAction = label.toLowerCase().replaceAll(" ", "-");
      if (["Text card", "File card", "Add note", "Add media", "Website", "Group", "Connect", "Arrange selection", "Layout selection", "Delete", "Undo", "Redo", "Save", "Convert text card"].includes(label)) { this.mutationButtons.add(element); }
      element.addEventListener("click", () => Promise.resolve().then(action).catch(error => this.fail(error)));
      toolbar.append(element);
      return element;
    };
    button("Text card", () => this.addNode("text"));
    button("File card", () => this.addNode("file"));
    button("Add note", () => this.chooseFile("note"));
    button("Add media", () => this.chooseFile("media"));
    button("Website", () => this.addNode("link"));
    button("Group", () => this.addNode("group"));
    button("Connect", () => this.connectSelection());
    button("Arrange selection", () => this.arrangeSelection());
    button("Layout selection", () => this.layoutSelection());
    button("Delete", () => this.deleteSelection());
    this.undoButton = button("Undo", () => this.undo());
    this.redoButton = button("Redo", () => this.redo());
    button("Zoom in", () => this.zoom(1.25));
    button("Zoom out", () => this.zoom(0.8));
    button("Fit", () => this.zoomToFit());
    button("Jump to card", () => this.jump());
    button("Export image", () => this.exportImage());
    button("Convert text card", () => this.convertTextCard());
    this.panel.bindToggle(button("Inspector", () => this.panel.toggle()));
    button("Save", () => this.view.save());
    button("Reload", async () => {
      if (!this.view.isDirty || window.confirm("Discard unsaved Canvas changes and reload the file from disk?")) { await this.view.reload(true); }
    });
    const body = document.createElement("div");
    body.className = "canvas-body";
    body.append(this.stage, this.inspector);
    content.append(toolbar, this.status, this.error, body);
    const events = new AbortController();
    const owned = { signal: events.signal };
    this.stage.addEventListener("pointerdown", event => this.pointerDown(event), owned);
    this.stage.addEventListener("pointermove", event => this.pointerMove(event), owned);
    this.stage.addEventListener("pointerup", event => this.pointerUp(event), owned);
    this.stage.addEventListener("pointercancel", () => this.cancelDrag(), owned);
    this.stage.addEventListener("lostpointercapture", () => { if (this.drag) { this.cancelDrag(); } }, owned);
    this.stage.addEventListener("click", event => { this.guardOccludedAction(event); }, { ...owned, capture: true });
    this.stage.addEventListener("dblclick", event => {
      if (event.target instanceof Element && event.target.closest("button,a,input,textarea,select")) { return; }
      if (event.target instanceof Element && event.target.closest("[data-canvas-node]") || this.nodeAt(event.clientX, event.clientY)) { this.editSelection(); }
      else { this.addNode("text", this.point(event.clientX, event.clientY)); }
    }, owned);
    this.stage.addEventListener("keydown", event => this.keydown(event), owned);
    this.stage.addEventListener("keyup", event => { if (event.code === "Space") { this.holdingSpace = false; } }, owned);
    this.stage.addEventListener("blur", () => { this.holdingSpace = false; }, owned);
    this.stage.addEventListener("focusin", event => {
      if (!(event.target instanceof Element)) { return; }
      if (event.target.matches("[data-canvas-node]")) {
        const id = event.target.getAttribute("data-canvas-node");
        if (id) { this.selection.clear(); this.selection.add(id); this.selectedEdge = null; this.renderSelection(); }
      } else if (event.target.matches("[data-canvas-edge]")) {
        this.selection.clear(); this.selectedEdge = event.target.getAttribute("data-canvas-edge"); this.renderSelection();
      }
    }, owned);
    // Focus can pin a preview or an uncommitted inspector draft through a pan.
    // Reconcile after blur, when the next real focused owner is known.
    const refocus = (): void => { queueMicrotask(() => { if (!this.disposed) { this.geometry(); } }); };
    this.stage.addEventListener("focusout", refocus, owned);
    this.inspector.addEventListener("focusin", refocus, owned);
    this.inspector.addEventListener("focusout", refocus, owned);
    this.stage.addEventListener("wheel", event => {
      if (this.drag) { return; }
      event.preventDefault();
      const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 800 : 1;
      const x = event.deltaX * factor, y = event.deltaY * factor;
      const modifier = event.ctrlKey || event.metaKey || this.holdingSpace;
      const zoom = plugin.options.defaultWheelBehavior === "zoom" ? !modifier : modifier;
      if (zoom) { this.zoom(Math.exp(-y * 0.001), this.screenPoint(event.clientX, event.clientY)); }
      else if (this.camera) { this.camera.x -= event.shiftKey && !x ? y : x; this.camera.y -= event.shiftKey && !x ? 0 : y; this.transform(); this.layoutChanged(); }
    }, { ...owned, passive: false });
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(body);
    view.register(() => { this.disposed = true; this.generation++; events.abort(); observer.disconnect(); this.clear(); });
    view.registerEvent(view.app.metadataCache.on("changed", file => {
      if (file instanceof TFile) { this.refreshEmbeds(file.path); }
    }));
    view.registerEvent(view.app.vault.on("modify", file => {
      if (file instanceof TFile) { this.refreshEmbeds(file.path); }
    }));
    view.registerEvent(view.app.vault.on("delete", file => { if (file instanceof TFile) { this.refreshEmbeds(file.path); } }));
    view.registerEvent(view.app.vault.on("rename", (file, oldPath) => { if (file instanceof TFile) { this.refreshEmbeds(String(oldPath)); this.refreshEmbeds(file.path); } }));
    view.registerEvent(view.app.core.on("changed", () => this.applyOptions()));
  }

  getText(): string { return this.document?.text ?? ""; }
  getData(): CanvasData { return validateCanvas(this.document?.data ?? { nodes: [], edges: [] }); }
  setData(data: unknown): void {
    const next = validateCanvas(data);
    this.edit(data => { Object.keys(data).forEach(key => delete data[key]); Object.assign(data, next); });
  }
  load(source: string): void {
    const path = this.view.file?.path ?? null, root = this.view.app.vault.rootPath;
    if (source === this.document?.text && path === this.loadedPath && root === this.loadedRoot) { return; }
    const next = new CanvasDocument(source);
    this.closeReviews();
    this.cancelDrag();
    this.closeCreation();
    this.document = next;
    this.loadedPath = path; this.loadedRoot = root;
    this.generation++;
    this.revision++;
    this.saveError = this.inputError = "";
    this.updateError();
    this.selection.forEach(id => { if (!next.data.nodes.some(node => node.id === id)) { this.selection.delete(id); } });
    if (!next.data.edges.some(edge => edge.id === this.selectedEdge)) { this.selectedEdge = null; }
    this.inspectorKey = "";
    this.signatures.clear();
    this.render();
  }
  clear(): void {
    this.closeReviews();
    this.cancelDrag();
    this.closeCreation();
    this.holdingSpace = false;
    this.generation++;
    this.revision++;
    for (const id of this.views.keys()) { this.retireContent(id); }
    for (const reading of this.readings.values()) { reading.clear(); }
    this.readings.clear();
    for (const preview of this.filePreviews.values()) { void preview.dispose().catch(reportError); }
    this.filePreviews.clear();
    this.signatures.clear();
    this.views.clear();
    this.edgeViews?.clear(); this.edgeSignatures?.clear(); this.mountPlan = null;
    this.cards.replaceChildren();
    this.edges.replaceChildren();
    this.overview?.replaceChildren();
    this.inspector.replaceChildren();
    this.fields.clear();
    this.inspectorKey = "";
    this.document = null;
    this.loadedPath = this.loadedRoot = null;
    this.selection.clear();
    this.selectedEdge = null;
  }
  saved(): void { this.saveError = ""; this.updateError(); }
  saveFailed(error: unknown): void { this.saveError = "Canvas could not be saved: " + (error instanceof Error ? error.message : String(error)); this.updateError(); }
  private fail(error: unknown): void { this.inputError = error instanceof Error ? error.message : String(error); this.updateError(); }
  private updateError(): void { this.error.textContent = [this.saveError, this.inputError].filter(Boolean).join("\n"); }
  private writable(): boolean { return !this.disposed && !this.view.app.vault.readOnly && !this.view.isReadOnlyForMutation && !this.view.app.changingVault; }
  private requireWritable(): void { if (!this.writable()) { throw new Error("This Canvas is read-only or its vault files are being changed. No Canvas content was changed."); } }
  private edit(change: (data: CanvasData) => void, mergeKey?: string, committed?: () => void): void {
    if (!this.document) { throw new Error("Load a Canvas file before editing it."); }
    this.requireWritable();
    const changed = this.document.edit(change, mergeKey);
    this.inputError = ""; this.updateError();
    if (changed) {
      committed?.();
      this.revision++;
      this.exportReview?.invalidate(); this.conversionReview?.invalidate(); this.jumpReview?.invalidate(); this.arrangeReview?.invalidate(); this.layoutReview?.invalidate();
      this.render();
      this.view.requestSave();
    }
  }
  undo(): void { if (!this.writable()) { return; } if (this.document?.undo()) { this.revision++; this.jumpReview?.invalidate(); this.arrangeReview?.invalidate(); this.layoutReview?.invalidate(); this.render(); this.view.requestSave(); } }
  redo(): void { if (!this.writable()) { return; } if (this.document?.redo()) { this.revision++; this.jumpReview?.invalidate(); this.arrangeReview?.invalidate(); this.layoutReview?.invalidate(); this.render(); this.view.requestSave(); } }
  selectAll(): void { this.selectedEdge = null; this.document?.data.nodes.forEach(node => this.selection.add(node.id)); this.renderSelection(); }

  private closeReviews(): void {
    const layout = this.layoutReview; this.layoutReview = null; layout?.close();
    const arrange = this.arrangeReview; this.arrangeReview = null; arrange?.close();
    const image = this.exportReview, conversion = this.conversionReview, jump = this.jumpReview; this.exportReview = null; this.conversionReview = null; this.jumpReview = null; image?.close(); conversion?.close(); jump?.close();
  }
  layoutSelection(): void {
    this.requireWritable(); this.stage.focus({ preventScroll: true }); this.closeCreation(); this.closeReviews();
    const current = this.reviewAuthority(), model = this.document, selected = new Set(this.selection);
    if (!current() || !model || !selected.size) { throw new Error("Select cards or group frames on a current Canvas before reviewing their layout."); }
    const modal = new CanvasLayoutModal(this.view.app, selected.size, {
      current: () => this.writable() && current(),
      plan: settings => {
        if (!this.writable() || !current()) { throw new Error("This Canvas changed. Reopen Layout selection on its current cards."); }
        return planCanvasLayout(model.data, selected, settings);
      },
      apply: plan => this.applyLayout(plan, current),
      closed: () => { if (this.layoutReview === modal) { this.layoutReview = null; } },
    }); this.layoutReview = modal; modal.open();
  }
  private applyLayout(plan: CanvasLayoutPlan, current: () => boolean): () => void {
    if (!this.writable() || !current() || JSON.stringify([...this.selection].sort()) !== JSON.stringify(plan.selection)) { throw new Error("This Canvas or its selection changed. No layout was applied."); }
    this.edit(data => applyCanvasLayout(data, plan));
    const focused = this.reviewAuthority();
    return () => { if (focused() && this.writable()) { this.stage.focus({ preventScroll: true }); } };
  }
  arrangeSelection(): void {
    this.requireWritable(); this.stage.focus({ preventScroll: true }); this.closeCreation(); this.closeReviews();
    const current = this.reviewAuthority(), model = this.document, selected = new Set(this.selection);
    if (!current() || !model || !selected.size) { throw new Error("Select cards or group frames on a current Canvas before arranging them."); }
    const modal = new CanvasArrangeModal(this.view.app, selected.size, {
      current: () => this.writable() && current(),
      plan: action => {
        if (!this.writable() || !current()) { throw new Error("This Canvas changed. Reopen Arrange selection on its current cards."); }
        return planCanvasArrangement(model.data, selected, action, action === "group" ? crypto.randomUUID() : undefined);
      },
      apply: plan => this.applyArrangement(plan, current),
      closed: () => { if (this.arrangeReview === modal) { this.arrangeReview = null; } },
    }); this.arrangeReview = modal; modal.open();
  }
  private applyArrangement(plan: CanvasArrangement, current: () => boolean): () => void {
    if (!this.writable() || !current()) { throw new Error("This Canvas or its selection changed. No arrangement was applied."); }
    this.edit(data => applyCanvasArrangement(data, plan), undefined, () => {
      this.selection.clear(); plan.selection.forEach(id => this.selection.add(id)); this.selectedEdge = null;
    });
    const focused = this.reviewAuthority();
    return () => {
      if (!focused() || !this.writable()) { return; }
      if (plan.added) { this.panel.open(); this.renderSelection(); this.fields.get("label")?.focus(); }
      else { this.stage.focus({ preventScroll: true }); }
    };
  }
  private reviewAuthority(): (ownedMutation?: boolean) => boolean {
    const app = this.view.app, model = this.document, file = this.view.file, path = file?.path, root = app.vault.rootPath, revision = this.revision, generation = this.generation, source = model?.text, selection = JSON.stringify([...this.selection].sort());
    return (ownedMutation = false) => { const draft = this.view.captureDraft(); return Boolean(model && file && !this.disposed && !this.drag && this.view.isLoaded && this.view.contentEl.isConnected
      && this.view.leaf.view === this.view && app.workspace.getLeafById(this.view.leaf.id) === this.view.leaf && this.document === model && model.text === source
      && revision === this.revision && generation === this.generation && this.view.file === file && file.path === path && app.vault.getFileByPath(path ?? "") === file
      && this.loadedPath === path && this.loadedRoot === root && draft?.provider === "core:canvas" && draft.path === path && draft.root === root && (draft.state === "clean" || draft.state === "dirty")
      && root === app.vault.rootPath && !app.changingVault && (ownedMutation || !app.workspace.isChangingFiles) && app.core.isEnabled("canvas") && !app.core.busy
      && JSON.stringify([...this.selection].sort()) === selection); };
  }
  exportImage(): void {
    this.stage.focus({ preventScroll: true }); this.closeCreation(); this.closeReviews();
    const current = this.reviewAuthority(); if (!current() || !this.document || !this.view.file) { throw new Error("Load a current Canvas before exporting an image."); }
    const frame = captureCanvasExport(this.document.data, this.view.file.basename, this.selection);
    const saved = this.view.savedDocument;
    const modal = new CanvasExportModal(this.view.app, frame, { current, ...(saved && this.view.app.vault.rootPath ? { source: Object.freeze({ root: this.view.app.vault.rootPath, path: this.view.file.path, version: saved.version, content: saved.content, hasBom: saved.hasBom === true }) } : {}), closed: () => { if (this.exportReview === modal) { this.exportReview = null; } } });
    this.exportReview = modal; modal.open();
  }
  canJump(): boolean { return this.reviewAuthority()(); }
  jump(): void {
    this.stage.focus({ preventScroll: true }); this.closeCreation(); this.closeReviews();
    const current = this.reviewAuthority();
    if (!current() || !this.document) { throw new Error("Load a current Canvas before finding its cards."); }
    const choices = captureCanvasJump(this.document.data.nodes);
    const modal = new CanvasJumpModal(this.view.app, choices, {
      current,
      apply: id => {
        this.jumpToCard(id, current);
        const focused = this.reviewAuthority();
        return () => { if (focused()) { this.stage.focus({ preventScroll: true }); } };
      },
      closed: () => { if (this.jumpReview === modal) { this.jumpReview = null; } },
    });
    this.jumpReview = modal; modal.open();
  }
  private jumpToCard(id: string, current: () => boolean): void {
    if (!current()) { throw new Error("This Canvas changed. Close Jump and search its current cards again."); }
    const node = this.document?.data.nodes.find(node => node.id === id);
    if (!node) { throw new Error("The selected Canvas card no longer exists."); }
    const camera = canvasJumpViewport(node, this.stage.clientWidth, this.stage.clientHeight, this.camera);
    if (!current()) { throw new Error("This Canvas changed before navigation could finish."); }
    this.selection.clear(); this.selection.add(id); this.selectedEdge = null; this.camera = camera;
    this.transform(); this.renderSelection(); this.layoutChanged();
  }
  convertTextCard(): void {
    this.requireWritable(); this.stage.focus({ preventScroll: true }); this.closeCreation(); this.closeReviews();
    const current = this.reviewAuthority(), model = this.document, file = this.view.file;
    const node = this.selection.size === 1 ? model?.data.nodes.find(node => this.selection.has(node.id)) : null;
    if (!current() || !model || !file || !node || node.type !== "text") { throw new Error("Select one current text card to convert to Markdown."); }
    convertedCanvasTextCard(node, "Review.md");
    const modal = new CanvasConvertModal(this.view.app, file, node, {
      current: owned => !this.view.app.vault.readOnly && (owned || !this.view.isReadOnlyForMutation) && current(owned),
      savedSource: () => this.view.savedDocument,
      apply: (created, committed) => {
        if (!current() || !this.writable()) { throw new Error("The Canvas changed before its card could be replaced."); }
        this.edit(data => {
          const index = data.nodes.findIndex(item => item.id === node.id && item.type === "text"); if (index < 0) { throw new Error("The reviewed text card no longer exists."); }
          data.nodes[index] = convertedCanvasTextCard(data.nodes[index], created.path);
        }, undefined, committed);
      },
      closed: () => { if (this.conversionReview === modal) { this.conversionReview = null; } },
    }); this.conversionReview = modal; modal.open();
  }

  private addNode(type: string, position?: { x: number; y: number; width?: number; height?: number }, properties: { file?: string; subpath?: string; url?: string } = {}): void {
    this.requireWritable();
    const rect = this.stage.getBoundingClientRect(), camera = this.camera ?? { x: 0, y: 0, scale: 1 };
    const point = position ?? { x: (rect.width / 2 - camera.x) / camera.scale - 140, y: (rect.height / 2 - camera.y) / camera.scale - 100 };
    const id = crypto.randomUUID();
    const node: CanvasNode = {
      id, type, x: Math.round(point.x), y: Math.round(point.y), width: Math.max(40, Math.round(position?.width ?? (type === "group" ? 600 : 280))), height: Math.max(40, Math.round(position?.height ?? (type === "group" ? 400 : 200))),
      ...(type === "text" ? { text: "" } : type === "file" ? { file: "" } : type === "link" ? { url: "" } : { label: "New group" }),
      ...properties,
    };
    this.edit(data => { if (type === "group") { data.nodes.unshift(node); } else { data.nodes.push(node); } });
    this.selection.clear(); this.selection.add(id); this.selectedEdge = null;
    this.renderSelection();
    this.panel.open(); this.renderSelection();
    this.fields.get(type === "text" ? "text" : type === "file" ? "file" : type === "link" ? "url" : "label")?.focus();
  }
  private closeCreation(): void {
    const chooser = this.chooser; this.chooser = null; chooser?.close();
    this.creationMenu?.hide();
    this.creationMenu = null;
    const creation = this.creation;
    this.creation = null;
    if (creation) {
      creation.events.abort();
      creation.dialog.close();
      creation.dialog.remove();
    }
    this.region.hidden = true;
  }
  private chooseFile(action: "note" | "media" | "replace", rectangle?: CanvasRectangle, nodeId?: string): void {
    this.requireWritable();
    this.closeCreation();
    const model = this.document, revision = this.revision, generation = this.generation, file = this.view.file, root = this.view.app.vault.rootPath;
    if (!model || !file || !this.view.isLoaded) { throw new Error("Load an existing Canvas before choosing a file."); }
    const path = file.path, source = model.text;
    const current = (): boolean => this.writable() && this.view.isLoaded && this.view.leaf.view === this.view
      && this.view.app.workspace.getLeafById(this.view.leaf.id) === this.view.leaf && this.document === model
      && this.revision === revision && this.generation === generation && model.text === source && this.view.file === file
      && file.path === path && this.view.app.vault.getFileByPath(path) === file && root === this.view.app.vault.rootPath;
    const chooser = new CanvasFileChooser({
      app: this.view.app, action, kind: action === "replace" ? "all" : action,
      title: action === "replace" ? "Choose card file or section" : action === "note" ? "Add existing note" : "Add existing media",
      current,
      apply: value => {
        if (!current()) { throw new Error("The Canvas changed. Cancel and review its current source."); }
        if (action === "replace") {
          this.edit(data => {
            const node = data.nodes.find(node => node.id === nodeId && node.type === "file");
            if (!node) { throw new Error("The reviewed file card no longer exists."); }
            node.file = value.file.path;
            if (value.subpath) { node.subpath = value.subpath; } else { delete node.subpath; }
          });
        } else { this.addNode("file", rectangle, { file: value.file.path, ...(value.subpath ? { subpath: value.subpath } : {}) }); }
      },
      close: () => { if (this.chooser === chooser) { this.chooser = null; } },
    });
    this.chooser = chooser;
  }
  private createAtRectangle(action: string, rectangle: CanvasRectangle, position: { x: number; y: number }): void {
    this.requireWritable();
    if (this.disposed || !this.view.isLoaded || !this.document || !this.view.file || this.view.app.changingVault) {
      throw new Error("This Canvas is no longer available for card creation.");
    }
    this.closeCreation();
    if (action === "note" || action === "media") { this.chooseFile(action, rectangle); return; }
    const generation = this.generation, revision = this.revision, model = this.document, source = model.text, file = this.view.file, path = file.path, root = this.view.app.vault.rootPath;
    const guard = (): void => {
      if (!this.writable() || !this.view.isLoaded || revision !== this.revision || generation !== this.generation || this.document !== model || model.text !== source || this.view.file !== file || file.path !== path || root !== this.view.app.vault.rootPath || this.view.app.changingVault) {
        throw new Error("The Canvas changed while its creation action was open.");
      }
    };
    if (action === "menu") {
      const menu = new Menu();
      for (const choice of creationActions) {
        menu.addItem(item => item.setTitle(choice.title).onClick(() => { guard(); this.createAtRectangle(choice.id, rectangle, position); }));
      }
      menu.onHide(() => { if (this.creationMenu === menu) { this.creationMenu = null; } });
      this.creationMenu = menu;
      menu.showAtPosition(position);
      return;
    }
    if (action === "card" || action === "group") {
      this.addNode(action === "card" ? "text" : "group", rectangle);
      return;
    }
    const choice = creationActions.find(choice => choice.id === action);
    if (!choice) { throw new Error("Unsupported Canvas creation action: " + action); }
    const dialog = document.createElement("dialog");
    dialog.className = "canvas-create-dialog";
    dialog.dataset.canvasCreateDialog = action;
    const form = document.createElement("form"), heading = document.createElement("h3");
    heading.textContent = choice.title;
    const label = document.createElement("label");
    label.textContent = action === "webpage" ? "Website URL" : action === "note" ? "Note or Canvas file" : "Attachment";
    const input = action === "webpage" ? document.createElement("input") : document.createElement("select");
    input.dataset.canvasCreateInput = action;
    input.setAttribute("aria-label", label.textContent);
    input.required = true;
    if (input instanceof HTMLInputElement) {
      input.type = "url";
      input.placeholder = "https://example.com/";
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = ""; placeholder.textContent = "Choose a vault file";
      input.append(placeholder);
      const files = this.view.app.vault.getFiles().filter(file => /^(md|canvas)$/i.test(file.extension) === (action === "note"));
      for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
        const option = document.createElement("option");
        option.value = option.textContent = file.path;
        input.append(option);
      }
    }
    label.append(input);
    const problem = document.createElement("p");
    problem.className = "canvas-error"; problem.setAttribute("role", "alert");
    const submit = document.createElement("button"), cancel = document.createElement("button"), actions = document.createElement("div");
    submit.type = "submit"; submit.textContent = "Add to Canvas"; submit.dataset.canvasCreateSubmit = "";
    cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.canvasCreateCancel = "";
    actions.className = "dialog-actions"; actions.append(cancel, submit);
    form.append(heading, label, problem, actions);
    dialog.append(form);
    const events = new AbortController(), owned = { signal: events.signal };
    cancel.addEventListener("click", () => this.closeCreation(), owned);
    dialog.addEventListener("close", () => this.closeCreation(), owned);
    form.addEventListener("submit", event => {
      event.preventDefault();
      try {
        guard();
        const value = input.value;
        let properties: { file?: string; url?: string };
        if (action === "webpage") {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) { throw new Error("Canvas websites must use HTTP or HTTPS without embedded credentials."); }
          properties = { url: url.href };
        } else {
          const file = this.view.app.vault.getFileByPath(value);
          if (!file || /^(md|canvas)$/i.test(file.extension) !== (action === "note")) { throw new Error("Choose an existing vault file of the requested kind."); }
          properties = { file: file.path };
        }
        this.closeCreation();
        this.addNode(action === "webpage" ? "link" : "file", rectangle, properties);
      } catch (error) { problem.textContent = error instanceof Error ? error.message : String(error); this.fail(error); }
    }, owned);
    this.creation = { dialog, events };
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  }
  private connectSelection(from?: string, to?: string, fromSide: CanvasSide = "right", toSide: CanvasSide = "left"): void {
    const ids = [...this.selection];
    const source = from ?? ids[0], target = to ?? ids[1];
    if (!source || !target || source === target || !from && ids.length !== 2) { throw new Error("Select two different cards with Shift+click, or drag a connection handle to another card."); }
    this.edit(data => data.edges.push({ id: crypto.randomUUID(), fromNode: source, toNode: target, fromSide, toSide, toEnd: "arrow" }));
  }
  private deleteSelection(): void {
    const selection = new Set(this.selection), edge = this.selectedEdge;
    this.edit(data => {
      data.nodes = data.nodes.filter(node => !selection.has(node.id));
      data.edges = data.edges.filter(item => item.id !== edge && !selection.has(item.fromNode) && !selection.has(item.toNode));
    });
    this.selection.clear(); this.selectedEdge = null; this.renderSelection();
  }
  private render(): void {
    const nodes = this.document?.data.nodes ?? [];
    const present = new Set(nodes.map(node => node.id));
    this.selection.forEach(id => { if (!present.has(id)) { this.selection.delete(id); } });
    this.view.contentEl.dataset.canvasLabels = String(this.plugin.options.cardLabelVisibility ?? "always");
    // Fit before creating any rich owners on an initial/previously hidden view.
    if (!this.camera && this.stage.clientWidth && this.stage.clientHeight && this.document) { this.zoomToFit(false); }
    this.renderSelection();
    this.status.textContent = `${nodes.length} cards, ${this.document?.data.edges.length ?? 0} connections`;
    this.status.dataset.canvasComplete = "true";
    this.resize();
  }
  private reconcileCards(nodes: readonly CanvasNode[], mounted: ReadonlySet<string>): void {
    for (const [id, card] of this.views) {
      if (!mounted.has(id)) {
        this.retireContent(id); this.signatures.delete(id); this.views.delete(id); card.remove();
      }
    }
    nodes.filter(node => mounted.has(node.id)).forEach((node, index) => {
      const signature = JSON.stringify([node.type, node.text, node.file, node.subpath, node.url, node.label, node.background, node.backgroundStyle]);
      const previous = this.views.get(node.id);
      if (previous && this.signatures.get(node.id) === signature) {
        const before = this.cards.children.item(index);
        if (before !== previous) { this.cards.insertBefore(previous, before); }
        const tint = canvasColor(node.color);
        if (tint) { previous.style.setProperty("--canvas-color", tint); } else { previous.style.removeProperty("--canvas-color"); }
        return;
      }
      this.retireContent(node.id); previous?.remove();
      const card = document.createElement("div");
      card.className = "canvas-node" + (node.type === "group" ? " is-group" : "");
      card.dataset.canvasNode = node.id;
      card.dataset.canvasType = node.type;
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      const header = document.createElement("div");
      header.className = "canvas-node-label";
      header.textContent = node.type === "group" && typeof node.label === "string" ? node.label
        : node.type === "file" && typeof node.file === "string" ? node.file + (typeof node.subpath === "string" ? node.subpath : "") : node.type === "link" ? "Website" : node.type === "text" ? "Text card" : "Unsupported card: " + node.type;
      card.setAttribute("aria-label", header.textContent);
      const body = document.createElement("div");
      body.className = "canvas-node-content";
      card.append(header, body);
      const tint = canvasColor(node.color);
      if (tint) { card.style.setProperty("--canvas-color", tint); }
      const resize = document.createElement("button");
      resize.type = "button"; resize.className = "canvas-node-resizer"; resize.dataset.canvasResize = node.id; resize.setAttribute("aria-label", "Resize card");
      card.append(resize);
      if (node.type !== "group") {
        for (const side of sides) {
          const handle = document.createElement("button");
          handle.type = "button"; handle.className = "canvas-node-connection-point is-" + side;
          handle.dataset.canvasConnect = side; handle.setAttribute("aria-label", "Connect from " + side);
          card.append(handle);
        }
      }
      this.cards.insertBefore(card, this.cards.children.item(index)); this.views.set(node.id, card); this.signatures.set(node.id, signature);
      this.renderContent(node, body);
    });
  }
  private contentOwner(node: CanvasNode, body: HTMLElement): () => boolean {
    const generation = this.generation, root = this.view.app.vault.rootPath, file = this.view.file, path = file?.path, signature = this.signatures.get(node.id), mount = body.dataset.canvasMount;
    return () => !this.disposed && this.view.isLoaded && this.view.leaf.view === this.view && this.view.app.workspace.getLeafById(this.view.leaf.id) === this.view.leaf
      && this.detailsVisible && generation === this.generation && root === this.view.app.vault.rootPath && !this.view.app.changingVault
      && this.view.file === file && Boolean(file) && file?.path === path && this.view.app.vault.getFileByPath(path ?? "") === file
      && this.signatures.get(node.id) === signature && this.views.get(node.id)?.querySelector(".canvas-node-content") === body && body.isConnected && body.dataset.canvasContent === "mounted" && body.dataset.canvasMount === mount;
  }
  private renderContent(node: CanvasNode, body: HTMLElement): void {
    if (!this.detailsVisible) { body.dataset.canvasContent = "suspended"; return; }
    if (this.mountPlan && !this.mountPlan.contents.has(node.id)) { body.dataset.canvasContent = "deferred"; return; }
    body.dataset.canvasContent = "mounted";
    this.mountRevision = (this.mountRevision ?? 0) + 1; body.dataset.canvasMount = String(this.mountRevision);
    if (node.type === "text") {
      const reading = new ReadingView(this.view.leaf, body, true);
      this.readings.set(node.id, reading);
      reading.render(String(node.text), this.view.file?.path ?? "");
    } else if (node.type === "file") {
      const path = String(node.file);
      const file = this.view.app.vault.getFileByPath(path);
      if (!file) { body.textContent = "File not found: " + path; return; }
      const open = document.createElement("button");
      open.type = "button"; open.textContent = "Open file"; open.dataset.canvasOpenFile = node.id;
      const current = this.contentOwner(node, body);
      open.addEventListener("click", () => {
        if (current() && body.contains(open)) { this.openNode(node).catch(error => { if (current()) { this.fail(error); } }); }
      });
      body.append(open);
      const preview = document.createElement("div");
      body.append(preview);
      if (file.extension.toLowerCase() === "md") {
        const owner = new CanvasPreview({ app: this.view.app, file, subpath: typeof node.subpath === "string" ? node.subpath : "", host: preview,
          current: () => current() && body.contains(preview),
          createReading: host => new ReadingView(this.view.leaf, host, true),
        });
        this.filePreviews.set(node.id, owner);
      } else if (/^(?:png|jpg|jpeg|gif|webp|bmp|ico|avif)$/i.test(file.extension)) {
        const reading = new ReadingView(this.view.leaf, preview, true);
        this.readings.set(node.id, reading);
        reading.render(`![](<${file.path.split("/").map(encodeURIComponent).join("/")}>)`, this.view.file?.path ?? "");
      } else { preview.textContent = "A preview for this attachment type is not implemented."; }
    } else if (node.type === "link") {
      const current = this.contentOwner(node, body);
      const url = document.createElement("p"); url.textContent = String(node.url); body.append(url);
      const open = document.createElement("button");
      open.type = "button"; open.textContent = "Open website"; open.dataset.canvasOpenWebsite = node.id;
      open.addEventListener("click", () => { if (current() && body.contains(open)) { openWebsite(String(node.url)).catch(error => { if (current()) { this.fail(error); } }); } });
      const load = document.createElement("button");
      load.type = "button"; load.textContent = "Load preview"; load.dataset.canvasLoadWebsite = node.id;
      load.addEventListener("click", () => {
        if (!current() || !body.contains(load) || load.disabled || !getBrowserHost()) { return; }
        try {
          const address = new URL(String(node.url));
          if (!["http:", "https:"].includes(address.protocol)) { throw new Error("Only HTTP or HTTPS websites can be previewed."); }
          const frame = document.createElement("iframe");
          frame.title = address.href; frame.referrerPolicy = "no-referrer"; frame.setAttribute("sandbox", "allow-scripts allow-forms"); frame.src = address.href;
          body.append(frame); load.disabled = true;
        } catch (error) { this.fail(error); }
      });
      body.append(open, load);
      if (!getBrowserHost()) {
        load.disabled = true;
        const message = document.createElement("p");
        message.textContent = "Website previews are browser-only. Use Open website on desktop.";
        body.append(message);
      }
    } else if (node.type === "group") {
      if (typeof node.background === "string" && node.background) {
        const reading = new ReadingView(this.view.leaf, body, true);
        this.readings.set(node.id, reading);
        reading.render(`![](<${node.background.split("/").map(encodeURIComponent).join("/")}>)`, this.view.file?.path ?? "");
        body.dataset.backgroundStyle = typeof node.backgroundStyle === "string" ? node.backgroundStyle : "cover";
        if (body.dataset.backgroundStyle === "repeat") {
          const image = body.querySelector("img");
          const repeat = (): void => {
            if (image && this.readings.get(node.id) === reading) { body.style.backgroundImage = "url(" + JSON.stringify(image.currentSrc || image.src) + ")"; }
          };
          image?.addEventListener("load", repeat, { once: true });
          if (image?.complete && image.naturalWidth) { repeat(); }
        }
      }
    } else { body.textContent = "This card type is not implemented. Its original data is retained."; }
  }
  private refreshEmbeds(path: string): void {
    for (const node of this.document?.data.nodes ?? []) {
      if (node.type === "file" && node.file === path || node.type === "group" && node.background === path) {
        const body = this.views.get(node.id)?.querySelector<HTMLElement>(".canvas-node-content");
        if (body && body.dataset.canvasContent === "mounted") {
          this.retireContent(node.id);
          body.replaceChildren(); body.style.removeProperty("background-image"); this.renderContent(node, body);
        }
      }
    }
  }
  private applyOptions(): void {
    this.view.contentEl.dataset.canvasLabels = String(this.plugin.options.cardLabelVisibility ?? "always");
    this.geometry();
  }
  private updateDetail(): void {
    const visible = canvasDetailsVisible(this.camera?.scale, Number(this.plugin.options.zoomBreakpoint ?? 0));
    this.detailsVisible = visible;
    for (const node of this.document?.data.nodes ?? []) {
      const body = this.views.get(node.id)?.querySelector<HTMLElement>(".canvas-node-content");
      if (!body) { continue; }
      const state = !visible ? "suspended" : this.mountPlan && !this.mountPlan.contents.has(node.id) ? "deferred" : "mounted";
      if (state !== "mounted" && body.dataset.canvasContent !== state) {
        this.retireContent(node.id); body.replaceChildren(); body.style.removeProperty("background-image"); body.dataset.canvasContent = state; delete body.dataset.canvasMount;
      } else if (state === "mounted" && body.dataset.canvasContent !== "mounted") { this.renderContent(node, body); }
    }
    this.view.contentEl.classList.toggle("is-zoomed-out", !visible);
    this.stage.dataset.canvasDetails = visible ? "visible" : "hidden";
  }
  private retireContent(id: string): void {
    const body = this.views.get(id)?.querySelector<HTMLElement>(".canvas-node-content");
    if (body) {
      delete body.dataset.canvasMount;
      body.querySelectorAll?.("iframe").forEach(frame => { frame.removeAttribute("src"); frame.remove(); });
    }
    const preview = this.filePreviews.get(id); this.filePreviews.delete(id);
    if (preview) { void preview.dispose().catch(reportError); }
    const reading = this.readings.get(id); this.readings.delete(id);
    if (reading) { void reading.clear().catch(reportError); }
  }
  private geometry(): void {
    if (this.disposed || !this.document) { return; }
    if (this.camera) { this.world.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`; }
    const values = this.document.data.nodes.map(node => this.drag?.preview.get(node.id) ?? node), nodes = new Map(values.map(node => [node.id, node]));
    const focused = this.stage.ownerDocument.activeElement;
    const focusedNode = focused instanceof Element ? focused.closest<HTMLElement>("[data-canvas-node]")?.dataset.canvasNode : undefined;
    const focusedEdge = focused instanceof Element ? focused.closest<SVGGElement>("[data-canvas-edge]")?.dataset.canvasEdge : undefined;
    const inspectorNode = focused && this.inspector.contains(focused) && this.selection.size === 1 ? [...this.selection][0] : undefined;
    this.detailsVisible = canvasDetailsVisible(this.camera?.scale, Number(this.plugin.options.zoomBreakpoint ?? 0));
    const plan = planCanvasMounts(values, this.document.data.edges, this.camera, this.stage.clientWidth, this.stage.clientHeight, {
      selected: this.selection, focusedNode, focusedEdge, inspectorNode, dragSource: this.drag?.source, selectedEdge: this.selectedEdge, details: this.detailsVisible,
    });
    this.mountPlan = plan;
    this.reconcileCards(values, plan.cards);
    this.updateDetail();
    for (const [id, node] of nodes) {
      const card = this.views.get(id);
      if (card) { card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.width = node.width + "px"; card.style.height = node.height + "px"; }
    }
    const markerId = "canvas-arrow-" + this.view.leaf.id;
    if (!this.edges.querySelector("defs")) {
      const defs = document.createElementNS(svgNamespace, "defs"), marker = document.createElementNS(svgNamespace, "marker"); marker.id = markerId;
      for (const [key, value] of Object.entries({ viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" })) { marker.setAttribute(key, value); }
      const arrow = document.createElementNS(svgNamespace, "path"); arrow.setAttribute("d", "M0 0 10 5 0 10z"); arrow.setAttribute("fill", "context-stroke"); marker.append(arrow); defs.append(marker); this.edges.append(defs);
    }
    for (const [id, group] of this.edgeViews) { if (!plan.edges.has(id)) { group.remove(); this.edgeViews.delete(id); this.edgeSignatures.delete(id); } }
    for (const edge of this.document?.data.edges ?? []) {
      if (!plan.edges.has(edge.id)) { continue; }
      const segment = canvasEdgeSegment(edge, nodes); if (!segment) { continue; }
      const { a, b } = segment, signature = JSON.stringify([edge, a, b]), previous = this.edgeViews.get(edge.id);
      if (previous && this.edgeSignatures.get(edge.id) === signature) { previous.classList.toggle("is-selected", this.selectedEdge === edge.id); continue; }
      // Keep the SVG group itself stable so a keyboard-focused connection keeps
      // its owner while endpoints move or the viewport is reconciled.
      const group = previous ?? document.createElementNS(svgNamespace, "g"); group.replaceChildren(); group.dataset.canvasEdge = edge.id; group.classList.add("canvas-edge"); group.classList.toggle("is-selected", this.selectedEdge === edge.id);
      group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", "Connection " + (edge.label ?? edge.id));
      const tint = canvasColor(edge.color); group.style.color = tint ?? "";
      const line = document.createElementNS(svgNamespace, "path"); line.setAttribute("d", `M${a.x} ${a.y} L${b.x} ${b.y}`);
      if (edge.fromEnd === "arrow") { line.setAttribute("marker-start", `url(#${markerId})`); }
      if (edge.toEnd !== "none") { line.setAttribute("marker-end", `url(#${markerId})`); }
      const hit = line.cloneNode(true); if (!(hit instanceof SVGPathElement)) { throw new Error("Canvas connection hit shape is not an SVG path."); }
      hit.removeAttribute("marker-start"); hit.removeAttribute("marker-end"); hit.classList.add("canvas-edge-hit");
      group.append(line, hit);
      if (edge.label) {
        const label = document.createElementNS(svgNamespace, "text"); label.textContent = edge.label; label.setAttribute("x", String((a.x + b.x) / 2)); label.setAttribute("y", String((a.y + b.y) / 2 - 8)); label.setAttribute("text-anchor", "middle"); group.append(label);
      }
      if (!previous) { this.edges.append(group); }
      this.edgeViews.set(edge.id, group); this.edgeSignatures.set(edge.id, signature);
    }
    this.renderOverview(plan, nodes);
    if (this.drag?.kind === "connect" && this.connectionPreview.hasAttribute("d")) { this.edges.append(this.connectionPreview); }
    this.stage.dataset.canvasMountedCards = String(plan.cards.size);
    this.stage.dataset.canvasMountedContents = String(plan.contents.size);
    this.stage.dataset.canvasMountedEdges = String(plan.edges.size);
    this.stage.dataset.canvasOverviewCards = String(plan.overviewCards.length);
    this.stage.dataset.canvasOverviewEdges = String(plan.overviewEdges.length);
  }
  private renderOverview(plan: CanvasMountPlan, nodes: ReadonlyMap<string, CanvasNode>): void {
    const paths = new Map<string, string[]>();
    const add = (kind: string, value: string): void => { const values = paths.get(kind) ?? []; values.push(value); paths.set(kind, values); };
    if (plan.bounds) {
      for (const edge of plan.overviewEdges) {
        const full = canvasEdgeSegment(edge, nodes), segment = full && canvasClipSegment(full, plan.bounds);
        if (segment) { add("edges", `M${segment.a.x} ${segment.a.y}L${segment.b.x} ${segment.b.y}`); }
      }
      for (const node of plan.overviewCards) {
        // Clip enormous cards before generating paths; never allocate a board-
        // sized image or raster surface for a zoomed-out/coordinate-bound board.
        const x = Math.max(node.x, plan.bounds.left), y = Math.max(node.y, plan.bounds.top), right = Math.min(node.x + node.width, plan.bounds.right), bottom = Math.min(node.y + node.height, plan.bounds.bottom);
        add((node.type === "group" ? "groups" : "cards") + (this.selection.has(node.id) ? "-selected" : ""), `M${x} ${y}H${right}V${bottom}H${x}Z`);
      }
    }
    this.overview.replaceChildren(...[...paths].map(([kind, values]) => {
      const path = document.createElementNS(svgNamespace, "path"); path.dataset.canvasOverviewKind = kind; path.setAttribute("d", values.join("")); return path;
    }));
  }
  private renderSelection(): void {
    this.geometry();
    const writable = this.writable();
    this.view.contentEl.dataset.canvasReadonly = String(!writable);
    for (const button of this.mutationButtons) { button.disabled = !writable; }
    this.undoButton.disabled = !writable || !this.document?.canUndo;
    this.redoButton.disabled = !writable || !this.document?.canRedo;
    this.stage.querySelectorAll<HTMLButtonElement>("[data-canvas-connect],[data-canvas-resize]").forEach(button => { button.disabled = !writable; });
    for (const [id, card] of this.views) { card.classList.toggle("is-selected", this.selection.has(id)); }
    this.edges.querySelectorAll<SVGGElement>("[data-canvas-edge]").forEach(edge => edge.classList.toggle("is-selected", edge.dataset.canvasEdge === this.selectedEdge));
    const key = this.selectedEdge ? "edge:" + this.selectedEdge : [...this.selection].join("\0");
    if (key !== this.inspectorKey || !this.inspector.childElementCount) { this.inspectorKey = key; this.buildInspector(); }
    const target = this.selectedEdge ? this.document?.data.edges.find(edge => edge.id === this.selectedEdge)
      : this.selection.size === 1 ? this.document?.data.nodes.find(node => this.selection.has(node.id)) : null;
    if (target) {
      for (const [key, input] of this.fields) { input.disabled = !writable; if (document.activeElement !== input) { input.value = target[key] === undefined ? "" : String(target[key]); } }
    }
  }
  private buildInspector(): void {
    this.inspector.replaceChildren(); this.fields.clear();
    const node = this.selection.size === 1 ? this.document?.data.nodes.find(node => this.selection.has(node.id)) : null;
    const edge = this.document?.data.edges.find(edge => edge.id === this.selectedEdge);
    const model = this.document, generation = this.generation;
    if (!node && !edge) { this.inspector.textContent = this.selection.size ? `${this.selection.size} selected cards. Shift+click to change the selection; Connect joins two cards.` : "Select a card or connection. Double-click empty space to add text. Drag card handles to resize or connect."; return; }
    const title = document.createElement("h3"); title.textContent = edge ? "Connection" : node?.type === "group" ? "Group" : "Card"; this.inspector.append(title);
    const field = (key: string, title: string, kind = "text", values?: readonly string[]): void => {
      const label = document.createElement("label"); label.textContent = title;
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (values) { input = document.createElement("select"); for (const value of values) { const option = document.createElement("option"); option.value = option.textContent = value; input.append(option); } }
      else if (kind === "textarea") { input = document.createElement("textarea"); }
      else { input = document.createElement("input"); input.type = kind; if (kind === "number") { input.step = "1"; } }
      input.dataset.canvasField = key; input.setAttribute("aria-label", title);
      input.value = String((edge ?? node)?.[key] ?? "");
      input.addEventListener(kind === "textarea" || kind === "text" && !values ? "input" : "change", () => {
        try {
          if (!input.isConnected || this.fields.get(key) !== input || this.document !== model || this.generation !== generation) { throw new Error("This Canvas inspector is no longer current."); }
          const value = kind === "number" ? input.value.trim() ? Number(input.value) : NaN : input.value;
          this.edit(data => {
            const target = edge ? data.edges.find(item => item.id === edge.id) : data.nodes.find(item => item.id === node?.id);
            if (!target) { throw new Error("The selected Canvas element no longer exists."); }
            if (value === "" && ["color", "subpath", "background", "backgroundStyle", "fromSide", "toSide", "fromEnd", "toEnd"].includes(key)) { delete target[key]; }
            else { target[key] = value; }
          }, (edge?.id ?? node?.id) + ":" + key);
        } catch (error) { this.fail(error); }
      });
      label.append(input); this.inspector.append(label); this.fields.set(key, input);
    };
    if (edge) {
      field("label", "Connection label");
      field("fromSide", "From side", "select", ["", ...sides]); field("toSide", "To side", "select", ["", ...sides]);
      field("fromEnd", "From end", "select", ["", "none", "arrow"]); field("toEnd", "To end", "select", ["", "none", "arrow"]);
    } else if (node) {
      if (node.type === "text") { field("text", "Card Markdown", "textarea"); }
      if (node.type === "file") {
        field("file", "Vault file path"); field("subpath", "Heading or block");
        const choose = document.createElement("button"); choose.type = "button"; choose.textContent = "Choose file or section"; choose.dataset.canvasChooseFile = node.id; choose.disabled = !this.writable();
        choose.addEventListener("click", () => { try { if (choose.isConnected && this.document === model && this.generation === generation) { this.chooseFile("replace", undefined, node.id); } } catch (error) { this.fail(error); } });
        this.inspector.append(choose);
      }
      if (node.type === "link") { field("url", "Website URL"); }
      if (node.type === "group") { field("label", "Group label"); field("background", "Group background image"); field("backgroundStyle", "Background style", "select", ["", "cover", "ratio", "repeat"]); }
      for (const [key, title] of [["x", "X"], ["y", "Y"], ["width", "Width"], ["height", "Height"]]) { field(key, title, "number"); }
    }
    field("color", "Color (preset 1-6 or hex)");
  }
  private editSelection(): void {
    const node = this.document?.data.nodes.find(node => this.selection.has(node.id));
    if (!node) { return; }
    if (node.type === "file" || node.type === "link") { this.openNode(node).catch(error => this.fail(error)); return; }
    this.panel.open(); this.renderSelection();
    (this.fields.get(node.type === "text" ? "text" : "label") ?? this.inspector).focus();
  }
  private async openNode(node: CanvasNode): Promise<void> {
    if (node.type === "link") { await openWebsite(String(node.url)); return; }
    const file = typeof node.file === "string" ? this.view.app.vault.getFileByPath(node.file) : null;
    if (!file) { throw new Error("The Canvas card's vault file does not exist: " + String(node.file)); }
    await this.view.app.workspace.openLinkText(file.path + (typeof node.subpath === "string" ? node.subpath : ""), this.view.file?.path ?? "", "tab");
  }

  resize(): void {
    if (this.disposed) { return; }
    this.panel.resize();
    if (!this.camera && this.stage.clientWidth && this.stage.clientHeight && this.document) { this.zoomToFit(false); }
    else { this.geometry(); }
  }
  setViewport(camera: Viewport | null): void { this.camera = camera; this.transform(); this.resize(); }
  zoomToFit(save = true): void {
    const nodes = this.document?.data.nodes ?? [];
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (!width || !height) { return; }
    const minX = nodes.length ? Math.min(...nodes.map(node => node.x)) : -200;
    const minY = nodes.length ? Math.min(...nodes.map(node => node.y)) : -150;
    const maxX = nodes.length ? Math.max(...nodes.map(node => node.x + node.width)) : 200;
    const maxY = nodes.length ? Math.max(...nodes.map(node => node.y + node.height)) : 150;
    const scale = Math.max(0.02, Math.min(1, (width - 60) / Math.max(1, maxX - minX), (height - 60) / Math.max(1, maxY - minY)));
    this.camera = { x: width / 2 - (minX + maxX) / 2 * scale, y: height / 2 - (minY + maxY) / 2 * scale, scale };
    this.transform(); if (save) { this.layoutChanged(); }
  }
  private zoom(factor: number, anchor = { x: this.stage.clientWidth / 2, y: this.stage.clientHeight / 2 }): void {
    if (!this.camera) { this.zoomToFit(false); }
    if (!this.camera) { return; }
    const camera = this.camera, scale = Math.max(0.02, Math.min(20, camera.scale * factor)), ratio = scale / camera.scale;
    this.camera = { ...camera, scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
    this.transform(); this.layoutChanged();
  }
  private transform(): void { this.geometry(); }
  private layoutChanged(): void { this.view.app.workspace.requestSaveLayout().catch(error => this.fail(error)); }
  private screenPoint(x: number, y: number): { x: number; y: number } { const box = this.stage.getBoundingClientRect(); return { x: x - box.left, y: y - box.top }; }
  private point(x: number, y: number): { x: number; y: number } {
    const point = this.screenPoint(x, y), camera = this.camera ?? { x: 0, y: 0, scale: 1 };
    return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
  }
  private nodeAt(x: number, y: number): CanvasNode | undefined { return canvasNodeAtPoint(this.document?.data.nodes ?? [], this.point(x, y)); }
  private guardOccludedAction(event: MouseEvent): boolean {
    if (!(event.target instanceof Element)) { return false; }
    const card = event.target.closest<HTMLElement>("[data-canvas-node]");
    if (!card || !event.target.closest("button,a,input,textarea,select,iframe,[contenteditable]")) { return false; }
    const rect = event.target.getBoundingClientRect();
    const pointer = event.type === "pointerdown" || event.detail > 0;
    const top = this.nodeAt(pointer ? event.clientX : rect.left + rect.width / 2, pointer ? event.clientY : rect.top + rect.height / 2);
    if (!top || top.id === card.dataset.canvasNode) { return false; }
    // Overview rectangles have no individual DOM targets. They must still
    // occlude actions in a lower rich card, including keyboard click events.
    event.preventDefault(); event.stopImmediatePropagation();
    this.selection.clear(); this.selection.add(top.id); this.selectedEdge = null;
    this.renderSelection(); this.stage.focus({ preventScroll: true });
    return true;
  }
  private selectedNodes(): Set<string> {
    const nodes = this.document?.data.nodes ?? [];
    const groups = nodes.filter(node => node.type === "group" && this.selection.has(node.id));
    const selection = new Set(this.selection);
    for (const node of nodes) {
      if (groups.some(group => node.x >= group.x && node.y >= group.y && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height)) { selection.add(node.id); }
    }
    return selection;
  }
  private pointerDown(event: PointerEvent): void {
    if (![0, 1].includes(event.button) || !this.camera || !this.document || !(event.target instanceof Element)) { return; }
    const handle = event.target.closest<HTMLElement>("[data-canvas-connect]");
    const resizer = event.target.closest<HTMLElement>("[data-canvas-resize]");
    const pan = event.button === 1 || event.altKey || this.holdingSpace;
    if (!pan && this.guardOccludedAction(event)) { return; }
    if (!handle && !resizer && !pan && event.target.closest("button,a,input,textarea,select,iframe")) { return; }
    const element = event.target.closest<HTMLElement>("[data-canvas-node]");
    const edgeElement = event.target.closest<SVGGElement>("[data-canvas-edge]");
    const node = handle || resizer ? this.document.data.nodes.find(node => node.id === element?.dataset.canvasNode)
      : this.nodeAt(event.clientX, event.clientY) ?? (element ? this.document.data.nodes.find(node => node.id === element.dataset.canvasNode) : undefined);
    const edge = node ? undefined : canvasEdgeAtPoint(this.document.data.edges, new Map(this.document.data.nodes.map(node => [node.id, node])), this.point(event.clientX, event.clientY), 8 / this.camera.scale)
      ?? this.document.data.edges.find(edge => edge.id === edgeElement?.dataset.canvasEdge);
    const rectangle = !pan && !node && !edge && (event.ctrlKey || event.metaKey);
    const previousSelection = new Set(this.selection);
    if (!pan) {
      if (node) {
        this.selectedEdge = null;
        if (event.shiftKey) { if (this.selection.has(node.id)) { this.selection.delete(node.id); } else { this.selection.add(node.id); } }
        else if (!this.selection.has(node.id)) { this.selection.clear(); this.selection.add(node.id); }
      } else { this.selection.clear(); this.selectedEdge = edge?.id ?? null; }
      this.renderSelection();
    }
    const originals = new Map<string, CanvasNode>();
    if (node && !pan) {
      const selected = this.selectedNodes();
      for (const candidate of this.document.data.nodes) {
        if (selected.has(candidate.id)) { originals.set(candidate.id, { ...candidate }); }
      }
    }
    const point = this.screenPoint(event.clientX, event.clientY);
    const kind = rectangle ? "rectangle" : pan || !node ? "pan" : handle ? "connect" : resizer ? "resize" : "move";
    if (kind !== "pan" && !this.writable()) { return; }
    // Own Escape during a connection. Blur may legitimately commit an inspector
    // number/select draft, so capture the source revision only after focusing.
    if (kind === "connect") {
      this.stage.focus({ preventScroll: true });
      if (!this.writable() || !this.document || !this.view.isLoaded || this.view.leaf.view !== this.view) { return; }
    }
    const model = this.document, revision = this.revision, root = this.view.app.vault.rootPath, file = this.view.file, path = file?.path;
    const current = (): boolean => !this.disposed && this.view.isLoaded && this.view.leaf.view === this.view && this.document === model && this.revision === revision
      && this.view.app.vault.rootPath === root && this.view.file === file && file?.path === path && !this.view.app.changingVault && (kind === "pan" || this.writable());
    this.drag = { pointer: event.pointerId, kind, current, startX: point.x, startY: point.y, moved: false, originals, preview: new Map(originals), camera: { ...this.camera }, ...(rectangle ? { previousSelection } : {}), ...(node ? { source: node.id } : {}), ...(handle ? { side: sides.find(side => side === handle.dataset.canvasConnect) } : {}) };
    this.stage.setPointerCapture(event.pointerId);
    if (!handle && !resizer) { this.stage.focus({ preventScroll: true }); }
    event.preventDefault();
  }
  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) { return; }
    if (!drag.current()) { this.cancelDrag(); return; }
    const point = this.screenPoint(event.clientX, event.clientY), dx = point.x - drag.startX, dy = point.y - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 3;
    if (drag.kind === "rectangle") {
      this.region.hidden = false;
      Object.assign(this.region.style, { left: Math.min(drag.startX, point.x) + "px", top: Math.min(drag.startY, point.y) + "px", width: Math.abs(dx) + "px", height: Math.abs(dy) + "px" });
      return;
    }
    if (drag.kind === "pan") { this.camera = { ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy }; this.transform(); return; }
    if (drag.kind === "connect") { this.showConnection(event, drag); return; }
    let moveX = dx / drag.camera.scale, moveY = dy / drag.camera.scale;
    const source = drag.originals.get(drag.source ?? "");
    if (!source) { return; }
    if (this.plugin.options.snapToGrid === true && !event.ctrlKey && !event.metaKey) {
      const x = source.x + (drag.kind === "resize" ? source.width : 0), y = source.y + (drag.kind === "resize" ? source.height : 0);
      moveX = Math.round((x + moveX) / 20) * 20 - x;
      moveY = Math.round((y + moveY) / 20) * 20 - y;
    }
    if (this.plugin.options.snapToObjects === true && !event.ctrlKey && !event.metaKey && (drag.kind === "move" || drag.kind === "resize")) {
      const threshold = 8 / drag.camera.scale;
      let bestX = threshold, bestY = threshold;
      for (const other of this.document?.data.nodes ?? []) {
        if (drag.originals.has(other.id)) { continue; }
        for (const shift of drag.kind === "resize" ? [1] : [0, 0.5, 1]) {
          for (const target of [0, 0.5, 1]) {
            const x = other.x + other.width * target - (source.x + source.width * shift + moveX);
            const y = other.y + other.height * target - (source.y + source.height * shift + moveY);
            if (Math.abs(x) < Math.abs(bestX)) { bestX = x; }
            if (Math.abs(y) < Math.abs(bestY)) { bestY = y; }
          }
        }
      }
      if (Math.abs(bestX) < threshold) { moveX += bestX; }
      if (Math.abs(bestY) < threshold) { moveY += bestY; }
    }
    for (const [id, original] of drag.originals) {
      drag.preview.set(id, drag.kind === "resize" && id === drag.source
        ? { ...original, width: Math.max(40, Math.round(original.width + moveX)), height: Math.max(40, Math.round(original.height + moveY)) }
        : drag.kind === "move" ? { ...original, x: Math.round(original.x + moveX), y: Math.round(original.y + moveY) } : original);
    }
    this.geometry();
  }
  private showConnection(event: PointerEvent, drag: PointerDrag): void {
    const source = this.document?.data.nodes.find(node => node.id === drag.source);
    if (!source) { return; }
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-canvas-node]");
    const candidate = this.nodeAt(event.clientX, event.clientY) ?? (hit && this.cards.contains(hit) ? this.document?.data.nodes.find(node => node.id === hit.dataset.canvasNode) : undefined);
    const target = candidate?.id !== source.id ? candidate : undefined;
    const point = this.point(event.clientX, event.clientY), result = canvasConnectionPath(source, drag.side ?? "right", point, target);
    drag.target = target?.id; drag.targetSide = result.toSide;
    this.connectionPreview.setAttribute("d", result.path);
    this.connectionPreview.classList.toggle("is-valid", Boolean(target));
    this.connectionPreview.dataset.canvasConnectionTarget = target?.id ?? "";
    this.edges.append(this.connectionPreview);
  }
  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) { return; }
    if (!drag.current()) { this.cancelDrag(); return; }
    if (drag.kind === "connect") { this.showConnection(event, drag); }
    this.drag = null;
    this.connectionPreview.remove(); this.connectionPreview.removeAttribute("d");
    this.region.hidden = true;
    this.stage.releasePointerCapture(event.pointerId);
    try {
      if (drag.kind === "rectangle" && drag.moved) {
        const point = this.screenPoint(event.clientX, event.clientY);
        const rectangle = {
          x: Math.round((Math.min(drag.startX, point.x) - drag.camera.x) / drag.camera.scale),
          y: Math.round((Math.min(drag.startY, point.y) - drag.camera.y) / drag.camera.scale),
          width: Math.max(40, Math.round(Math.abs(point.x - drag.startX) / drag.camera.scale)),
          height: Math.max(40, Math.round(Math.abs(point.y - drag.startY) / drag.camera.scale)),
        };
        if (event.ctrlKey || event.metaKey) {
          this.createAtRectangle(String(this.plugin.options.defaultModDragBehavior ?? "menu"), rectangle, { x: event.clientX, y: event.clientY });
        } else {
          for (const node of this.document?.data.nodes ?? []) {
            const contained = node.x >= rectangle.x && node.y >= rectangle.y && node.x + node.width <= rectangle.x + rectangle.width && node.y + node.height <= rectangle.y + rectangle.height;
            const intersects = node.x < rectangle.x + rectangle.width && node.x + node.width > rectangle.x && node.y < rectangle.y + rectangle.height && node.y + node.height > rectangle.y;
            if (node.type === "group" ? contained : intersects) { this.selection.add(node.id); }
          }
          this.renderSelection();
        }
      } else if (drag.kind === "connect" && drag.moved && drag.source) {
        if (!drag.target) { throw new Error("Release the connection handle over another card."); }
        this.connectSelection(drag.source, drag.target, drag.side, drag.targetSide);
      } else if (drag.kind === "pan") { this.geometry(); this.layoutChanged(); }
      else if (drag.moved) { this.edit(data => { data.nodes = data.nodes.map(node => drag.preview.get(node.id) ?? node); }); }
      else { this.geometry(); }
    } catch (error) { this.geometry(); this.fail(error); }
  }
  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null; this.region.hidden = true;
    this.connectionPreview.remove(); this.connectionPreview.removeAttribute("d");
    if (drag) {
      if (this.stage.hasPointerCapture(drag.pointer)) { this.stage.releasePointerCapture(drag.pointer); }
      if (drag.previousSelection) { this.selection.clear(); drag.previousSelection.forEach(id => this.selection.add(id)); this.renderSelection(); }
    }
    this.geometry();
  }
  private keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.drag) { this.cancelDrag(); event.preventDefault(); event.stopPropagation(); return; }
    if (event.target instanceof Element && event.target.closest("input,textarea,select,button,a,iframe")) { return; }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    try {
      if (event.code === "Space") { this.holdingSpace = true; }
      else if (mod && key === "z") { event.shiftKey ? this.redo() : this.undo(); }
      else if (mod && key === "y") { this.redo(); }
      else if (mod && key === "a") { this.selectAll(); }
      else if (key === "delete" || key === "backspace") { this.deleteSelection(); }
      else if (key === "escape") { this.selection.clear(); this.selectedEdge = null; this.cancelDrag(); this.renderSelection(); }
      else if (key === "enter") { this.editSelection(); }
      else if (event.shiftKey && key === "!") { this.zoomToFit(); }
      else if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        const step = event.shiftKey ? 10 : 1;
        const selected = this.selectedNodes();
        this.edit(data => { for (const node of data.nodes) { if (selected.has(node.id)) { node.x += key === "arrowleft" ? -step : key === "arrowright" ? step : 0; node.y += key === "arrowup" ? -step : key === "arrowdown" ? step : 0; } } }, "nudge:" + [...this.selection].join("\0"));
      } else { return; }
      event.preventDefault(); event.stopPropagation();
    } catch (error) { event.preventDefault(); this.fail(error); }
  }
}

export class CanvasView extends TextFileView {
  readonly canvas: CanvasBoard;
  constructor(leaf: WorkspaceLeaf, readonly plugin: Canvases) { super(leaf); this.icon = "layout-dashboard"; this.slopsidianDraftProvider = "core:canvas"; this.canvas = new CanvasBoard(this, plugin); }
  getViewType(): string { return "canvas"; }
  override canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === "canvas"; }
  getViewData(): string { return this.canvas.getText(); }
  setViewData(data: string, _clear: boolean): void { this.canvas.load(data); }
  clear(): void { this.canvas.clear(); }
  override onResize(): void { this.canvas.resize(); }
  override focus(): void { this.canvas.stage.focus({ preventScroll: true }); }
  override async save(clear = false): Promise<void> {
    try { await super.save(clear); this.canvas.saved(); }
    catch (error) { this.canvas.saveFailed(error); throw error; }
  }
  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...(this.canvas.camera ? { slopsidianViewport: this.canvas.camera } : {}) };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), camera = readViewport(state.slopsidianViewport);
    await super.setState(state, result);
    this.canvas.setViewport(camera);
  }
}
