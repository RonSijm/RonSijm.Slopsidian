import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, getBrowserHost, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { iconButton } from "./icons";
import { CanvasDocument, canvasColor, canvasEndpoint, validateCanvas, type CanvasData, type CanvasNode, type CanvasSide } from "./canvas-model";
import { ReadingView } from "./reading";
import { TFile } from "./vault";
import { TextFileView } from "./views";
import { readViewport, type Viewport } from "./viewport";
import type { WorkspaceLeaf } from "./workspace";
import { ResponsiveViewPanel } from "./view-panel";
import { Menu } from "./menu";

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
        commands = this.app.commands.install([{ id: "canvas:new-file", name: "Create new canvas", callback: () => core.run(() => this.create()) }]);
      } catch (error) { await closeViews(); throw error; }
      const ribbon = iconButton("layout-dashboard", "Create new canvas", () => this.app.commands.execute("canvas:new-file").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      document.getElementById("core-ribbon")!.append(ribbon);
      return async () => { await closeViews(); extension(); commands(); ribbon.remove(); };
    }, this, views);
  }

  async create(): Promise<void> {
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
}

export class CanvasBoard {
  readonly selection = new Set<string>();
  readonly stage = document.createElement("div");
  camera: Viewport | null = null;
  private document: CanvasDocument | null = null;
  private readonly world = document.createElement("div");
  private readonly edges = document.createElementNS(svgNamespace, "svg");
  private readonly cards = document.createElement("div");
  private readonly inspector = document.createElement("form");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly views = new Map<string, HTMLElement>();
  private readonly readings = new Map<string, ReadingView>();
  private readonly signatures = new Map<string, string>();
  private readonly fields = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private inspectorKey = "";
  private readonly panel: ResponsiveViewPanel;
  private selectedEdge: string | null = null;
  private drag: PointerDrag | null = null;
  private readonly region = document.createElement("div");
  private holdingSpace = false;
  private creationMenu: Menu | null = null;
  private creation: { dialog: HTMLDialogElement; events: AbortController } | null = null;
  private inputError = "";
  private saveError = "";
  private disposed = false;
  private generation = 0;

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
    this.world.append(this.edges, this.cards);
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
      element.addEventListener("click", () => Promise.resolve().then(action).catch(error => this.fail(error)));
      toolbar.append(element);
      return element;
    };
    button("Text card", () => this.addNode("text"));
    button("File card", () => this.addNode("file"));
    button("Website", () => this.addNode("link"));
    button("Group", () => this.addNode("group"));
    button("Connect", () => this.connectSelection());
    button("Delete", () => this.deleteSelection());
    this.undoButton = button("Undo", () => this.undo());
    this.redoButton = button("Redo", () => this.redo());
    button("Zoom in", () => this.zoom(1.25));
    button("Zoom out", () => this.zoom(0.8));
    button("Fit", () => this.zoomToFit());
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
    this.stage.addEventListener("dblclick", event => {
      if (event.target instanceof Element && event.target.closest("button,a,input,textarea,select")) { return; }
      if (event.target instanceof Element && event.target.closest("[data-canvas-node]")) { this.editSelection(); }
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
    view.registerEvent(view.app.core.on("changed", () => this.applyOptions()));
  }

  getText(): string { return this.document?.text ?? ""; }
  getData(): CanvasData { return validateCanvas(this.document?.data ?? { nodes: [], edges: [] }); }
  setData(data: unknown): void {
    const next = validateCanvas(data);
    this.edit(data => { Object.keys(data).forEach(key => delete data[key]); Object.assign(data, next); });
  }
  load(source: string): void {
    if (source === this.document?.text) { return; }
    const next = new CanvasDocument(source);
    this.cancelDrag();
    this.document = next;
    this.generation++;
    this.saveError = this.inputError = "";
    this.updateError();
    this.selection.forEach(id => { if (!next.data.nodes.some(node => node.id === id)) { this.selection.delete(id); } });
    if (!next.data.edges.some(edge => edge.id === this.selectedEdge)) { this.selectedEdge = null; }
    this.inspectorKey = "";
    this.render();
  }
  clear(): void {
    this.cancelDrag();
    this.closeCreation();
    this.holdingSpace = false;
    this.generation++;
    for (const reading of this.readings.values()) { reading.clear(); }
    this.readings.clear();
    this.signatures.clear();
    this.views.clear();
    this.cards.replaceChildren();
    this.edges.replaceChildren();
    this.inspector.replaceChildren();
    this.fields.clear();
    this.inspectorKey = "";
    this.document = null;
    this.selection.clear();
    this.selectedEdge = null;
  }
  saved(): void { this.saveError = ""; this.updateError(); }
  saveFailed(error: unknown): void { this.saveError = "Canvas could not be saved: " + (error instanceof Error ? error.message : String(error)); this.updateError(); }
  private fail(error: unknown): void { this.inputError = error instanceof Error ? error.message : String(error); this.updateError(); }
  private updateError(): void { this.error.textContent = [this.saveError, this.inputError].filter(Boolean).join("\n"); }
  private edit(change: (data: CanvasData) => void, mergeKey?: string): void {
    if (!this.document) { throw new Error("Load a Canvas file before editing it."); }
    const changed = this.document.edit(change, mergeKey);
    this.inputError = ""; this.updateError();
    if (changed) {
      this.render();
      this.view.requestSave();
    }
  }
  undo(): void { if (this.document?.undo()) { this.render(); this.view.requestSave(); } }
  redo(): void { if (this.document?.redo()) { this.render(); this.view.requestSave(); } }
  selectAll(): void { this.selectedEdge = null; this.document?.data.nodes.forEach(node => this.selection.add(node.id)); this.renderSelection(); }

  private addNode(type: string, position?: { x: number; y: number; width?: number; height?: number }, properties: { file?: string; url?: string } = {}): void {
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
  private createAtRectangle(action: string, rectangle: CanvasRectangle, position: { x: number; y: number }): void {
    if (this.disposed || !this.view.isLoaded || !this.document || !this.view.file || this.view.app.changingVault) {
      throw new Error("This Canvas is no longer available for card creation.");
    }
    this.closeCreation();
    const generation = this.generation, file = this.view.file, path = file.path, root = this.view.app.vault.rootPath;
    const guard = (): void => {
      if (this.disposed || !this.view.isLoaded || generation !== this.generation || this.view.file !== file || file.path !== path || root !== this.view.app.vault.rootPath || this.view.app.changingVault) {
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
    for (const [id, card] of this.views) {
      if (!present.has(id)) {
        this.readings.get(id)?.clear(); this.readings.delete(id); this.signatures.delete(id); this.views.delete(id); card.remove();
      }
    }
    nodes.forEach((node, index) => {
      const signature = JSON.stringify([node.type, node.text, node.file, node.subpath, node.url, node.label, node.background, node.backgroundStyle]);
      const previous = this.views.get(node.id);
      if (previous && this.signatures.get(node.id) === signature) {
        const before = this.cards.children.item(index);
        if (before !== previous) { this.cards.insertBefore(previous, before); }
        const tint = canvasColor(node.color);
        if (tint) { previous.style.setProperty("--canvas-color", tint); } else { previous.style.removeProperty("--canvas-color"); }
        return;
      }
      this.readings.get(node.id)?.clear(); this.readings.delete(node.id); previous?.remove();
      const card = document.createElement("div");
      card.className = "canvas-node" + (node.type === "group" ? " is-group" : "");
      card.dataset.canvasNode = node.id;
      card.dataset.canvasType = node.type;
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      const header = document.createElement("div");
      header.className = "canvas-node-label";
      header.textContent = node.type === "group" && typeof node.label === "string" ? node.label
        : node.type === "file" && typeof node.file === "string" ? node.file : node.type === "link" ? "Website" : node.type === "text" ? "Text card" : "Unsupported card: " + node.type;
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
    this.selection.forEach(id => { if (!present.has(id)) { this.selection.delete(id); } });
    this.applyOptions();
    this.geometry();
    this.renderSelection();
    this.status.textContent = `${this.document?.data.nodes.length ?? 0} cards, ${this.document?.data.edges.length ?? 0} connections`;
    this.status.dataset.canvasComplete = "true";
    this.undoButton.disabled = !this.document?.canUndo;
    this.redoButton.disabled = !this.document?.canRedo;
    this.resize();
  }
  private renderContent(node: CanvasNode, body: HTMLElement): void {
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
      open.addEventListener("click", () => this.openNode(node).catch(error => this.fail(error)));
      body.append(open);
      const preview = document.createElement("div");
      body.append(preview);
      const reading = new ReadingView(this.view.leaf, preview, true);
      this.readings.set(node.id, reading);
      if (file.extension.toLowerCase() === "md") {
        const document = this.view.app.metadataCache.getDocuments().find(entry => entry.document.file.path === path);
        if (document) { reading.render(document.text, path); }
        else {
          const generation = this.generation;
          this.view.app.vault.cachedRead(file).then(text => {
            if (!this.disposed && generation === this.generation && this.readings.get(node.id) === reading) { reading.render(text, path); }
          }).catch(error => { if (generation === this.generation) { preview.textContent = "File preview failed: " + (error instanceof Error ? error.message : String(error)); } });
        }
      } else if (/^(?:png|jpg|jpeg|gif|webp|bmp|ico|avif)$/i.test(file.extension)) {
        reading.render(`![](<${file.path.split("/").map(encodeURIComponent).join("/")}>)`, this.view.file?.path ?? "");
      } else { preview.textContent = "A preview for this attachment type is not implemented."; }
    } else if (node.type === "link") {
      const url = document.createElement("p"); url.textContent = String(node.url); body.append(url);
      const open = document.createElement("button");
      open.type = "button"; open.textContent = "Open website"; open.dataset.canvasOpenWebsite = node.id;
      open.addEventListener("click", () => openWebsite(String(node.url)).catch(error => this.fail(error)));
      const load = document.createElement("button");
      load.type = "button"; load.textContent = "Load preview"; load.dataset.canvasLoadWebsite = node.id;
      load.addEventListener("click", () => {
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
        if (body) {
          this.readings.get(node.id)?.clear(); this.readings.delete(node.id);
          body.replaceChildren(); body.style.removeProperty("background-image"); this.renderContent(node, body);
        }
      }
    }
  }
  private applyOptions(): void {
    this.view.contentEl.dataset.canvasLabels = String(this.plugin.options.cardLabelVisibility ?? "always");
    this.updateDetail();
  }
  private updateDetail(): void {
    const visible = !this.camera || this.camera.scale > 2 ** (-1.7 - Number(this.plugin.options.zoomBreakpoint ?? 0));
    this.view.contentEl.classList.toggle("is-zoomed-out", !visible);
    this.stage.dataset.canvasDetails = visible ? "visible" : "hidden";
  }
  private geometry(): void {
    const nodes = new Map((this.document?.data.nodes ?? []).map(node => [node.id, this.drag?.preview.get(node.id) ?? node]));
    for (const [id, node] of nodes) {
      const card = this.views.get(id);
      if (card) { card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.width = node.width + "px"; card.style.height = node.height + "px"; }
    }
    this.edges.replaceChildren();
    const defs = document.createElementNS(svgNamespace, "defs");
    const marker = document.createElementNS(svgNamespace, "marker");
    marker.id = "canvas-arrow-" + this.view.leaf.id;
    for (const [key, value] of Object.entries({ viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" })) { marker.setAttribute(key, value); }
    const arrow = document.createElementNS(svgNamespace, "path"); arrow.setAttribute("d", "M0 0 10 5 0 10z"); arrow.setAttribute("fill", "context-stroke"); marker.append(arrow); defs.append(marker); this.edges.append(defs);
    for (const edge of this.document?.data.edges ?? []) {
      const from = nodes.get(edge.fromNode), to = nodes.get(edge.toNode);
      if (!from || !to) { continue; }
      const dx = to.x + to.width / 2 - from.x - from.width / 2, dy = to.y + to.height / 2 - from.y - from.height / 2;
      const fromSide = edge.fromSide ?? (Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "bottom" : "top");
      const toSide = edge.toSide ?? (fromSide === "right" ? "left" : fromSide === "left" ? "right" : fromSide === "top" ? "bottom" : "top");
      const a = canvasEndpoint(from, fromSide), b = canvasEndpoint(to, toSide);
      const group = document.createElementNS(svgNamespace, "g"); group.dataset.canvasEdge = edge.id; group.classList.add("canvas-edge"); group.classList.toggle("is-selected", this.selectedEdge === edge.id);
      group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", "Connection " + (edge.label ?? edge.id));
      const tint = canvasColor(edge.color); if (tint) { group.style.color = tint; }
      const line = document.createElementNS(svgNamespace, "path"); line.setAttribute("d", `M${a.x} ${a.y} L${b.x} ${b.y}`);
      if (edge.fromEnd === "arrow") { line.setAttribute("marker-start", `url(#${marker.id})`); }
      if (edge.toEnd !== "none") { line.setAttribute("marker-end", `url(#${marker.id})`); }
      const hit = line.cloneNode(true); if (!(hit instanceof SVGPathElement)) { throw new Error("Canvas connection hit shape is not an SVG path."); }
      hit.removeAttribute("marker-start"); hit.removeAttribute("marker-end"); hit.classList.add("canvas-edge-hit");
      group.append(line, hit);
      if (edge.label) {
        const label = document.createElementNS(svgNamespace, "text"); label.textContent = edge.label; label.setAttribute("x", String((a.x + b.x) / 2)); label.setAttribute("y", String((a.y + b.y) / 2 - 8)); label.setAttribute("text-anchor", "middle"); group.append(label);
      }
      this.edges.append(group);
    }
    this.transform();
  }
  private renderSelection(): void {
    for (const [id, card] of this.views) { card.classList.toggle("is-selected", this.selection.has(id)); }
    this.edges.querySelectorAll<SVGGElement>("[data-canvas-edge]").forEach(edge => edge.classList.toggle("is-selected", edge.dataset.canvasEdge === this.selectedEdge));
    const key = this.selectedEdge ? "edge:" + this.selectedEdge : [...this.selection].join("\0");
    if (key !== this.inspectorKey || !this.inspector.childElementCount) { this.inspectorKey = key; this.buildInspector(); }
    const target = this.selectedEdge ? this.document?.data.edges.find(edge => edge.id === this.selectedEdge)
      : this.selection.size === 1 ? this.document?.data.nodes.find(node => this.selection.has(node.id)) : null;
    if (target) {
      for (const [key, input] of this.fields) { if (document.activeElement !== input) { input.value = target[key] === undefined ? "" : String(target[key]); } }
    }
  }
  private buildInspector(): void {
    this.inspector.replaceChildren(); this.fields.clear();
    const node = this.selection.size === 1 ? this.document?.data.nodes.find(node => this.selection.has(node.id)) : null;
    const edge = this.document?.data.edges.find(edge => edge.id === this.selectedEdge);
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
      if (node.type === "file") { field("file", "Vault file path"); field("subpath", "Heading or block"); }
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
  private transform(): void { if (this.camera) { this.world.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`; } this.updateDetail(); }
  private layoutChanged(): void { this.view.app.workspace.requestSaveLayout().catch(error => this.fail(error)); }
  private screenPoint(x: number, y: number): { x: number; y: number } { const box = this.stage.getBoundingClientRect(); return { x: x - box.left, y: y - box.top }; }
  private point(x: number, y: number): { x: number; y: number } {
    const point = this.screenPoint(x, y), camera = this.camera ?? { x: 0, y: 0, scale: 1 };
    return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
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
    if (!handle && !resizer && !pan && event.target.closest("button,a,input,textarea,select,iframe")) { return; }
    const element = event.target.closest<HTMLElement>("[data-canvas-node]");
    const node = this.document.data.nodes.find(node => node.id === element?.dataset.canvasNode);
    const edge = event.target.closest<SVGGElement>("[data-canvas-edge]");
    const rectangle = !pan && !node && !edge && (event.ctrlKey || event.metaKey);
    const previousSelection = new Set(this.selection);
    if (!pan) {
      if (node) {
        this.selectedEdge = null;
        if (event.shiftKey) { if (this.selection.has(node.id)) { this.selection.delete(node.id); } else { this.selection.add(node.id); } }
        else if (!this.selection.has(node.id)) { this.selection.clear(); this.selection.add(node.id); }
      } else { this.selection.clear(); this.selectedEdge = edge?.dataset.canvasEdge ?? null; }
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
    this.drag = { pointer: event.pointerId, kind: rectangle ? "rectangle" : pan || !node ? "pan" : handle ? "connect" : resizer ? "resize" : "move", startX: point.x, startY: point.y, moved: false, originals, preview: new Map(originals), camera: { ...this.camera }, ...(rectangle ? { previousSelection } : {}), ...(node ? { source: node.id } : {}), ...(handle ? { side: sides.find(side => side === handle.dataset.canvasConnect) } : {}) };
    this.stage.setPointerCapture(event.pointerId);
    if (!handle && !resizer) { this.stage.focus({ preventScroll: true }); }
    event.preventDefault();
  }
  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) { return; }
    const point = this.screenPoint(event.clientX, event.clientY), dx = point.x - drag.startX, dy = point.y - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 3;
    if (drag.kind === "rectangle") {
      this.region.hidden = false;
      Object.assign(this.region.style, { left: Math.min(drag.startX, point.x) + "px", top: Math.min(drag.startY, point.y) + "px", width: Math.abs(dx) + "px", height: Math.abs(dy) + "px" });
      return;
    }
    if (drag.kind === "pan") { this.camera = { ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy }; this.transform(); return; }
    if (drag.kind === "connect") { return; }
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
  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) { return; }
    this.drag = null;
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
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-canvas-node]");
        if (!target?.dataset.canvasNode) { throw new Error("Release the connection handle over another card."); }
        this.connectSelection(drag.source, target.dataset.canvasNode, drag.side);
      } else if (drag.kind === "pan") { this.layoutChanged(); }
      else if (drag.moved) { this.edit(data => { data.nodes = data.nodes.map(node => drag.preview.get(node.id) ?? node); }); }
    } catch (error) { this.geometry(); this.fail(error); }
  }
  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null; this.region.hidden = true;
    if (drag) {
      if (this.stage.hasPointerCapture(drag.pointer)) { this.stage.releasePointerCapture(drag.pointer); }
      if (drag.previousSelection) { this.selection.clear(); drag.previousSelection.forEach(id => this.selection.add(id)); this.renderSelection(); }
    }
    this.geometry();
  }
  private keydown(event: KeyboardEvent): void {
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
  constructor(leaf: WorkspaceLeaf, readonly plugin: Canvases) { super(leaf); this.icon = "layout-dashboard"; this.canvas = new CanvasBoard(this, plugin); }
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
