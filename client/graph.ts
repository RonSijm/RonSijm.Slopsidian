import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type VaultConfigurationDocument, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { readGraphOptions, type GraphData, type GraphNode, type GraphOptions, type GraphRequest, type GraphResponse } from "./graph-model";
import { FileView, ItemView } from "./views";
import { TFile } from "./vault";
import type { WorkspaceLeaf } from "./workspace";
import { readViewport as viewport, type Viewport } from "./viewport";
import { ResponsiveViewPanel } from "./view-panel";

export class Graphs {
  readonly id = "graph";
  private document: VaultConfigurationDocument | null = null;
  private pending: Promise<void> | null = null;
  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.document?.data ?? this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      this.document = await this.app.configuration.read(this.id);
      const commands = this.app.commands.install([
        { id: "graph:open", name: "Open graph view", callback: () => core.run(() => this.open(false)) },
        { id: "graph:open-local", name: "Open local graph", checkCallback: checking => {
          if (!this.app.workspace.getActiveFile()) { return false; }
          if (!checking) { core.run(() => this.open(true)).catch(reportError); }
          return true;
        } },
      ]);
      let closeViews: () => void | Promise<void>;
      try {
        closeViews = await core.installViews(this.id, {
          graph: leaf => new GraphView(leaf, this),
          localgraph: leaf => new LocalGraphView(leaf, this),
        });
      } catch (error) { commands(); this.document = null; throw error; }
      const ribbon = iconButton("git-fork", "Open graph view", () => this.app.commands.execute("graph:open").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      element("core-ribbon").append(ribbon);
      return async () => {
        await this.pending;
        await closeViews();
        commands();
        ribbon.remove();
        this.document = null;
      };
    }, this);
  }

  async open(local: boolean): Promise<void> {
    if (!this.app.core.isEnabled(this.id)) { throw new Error("Enable Graph view before opening a graph."); }
    const file = local ? this.app.workspace.getActiveFile() : null;
    if (local && !file) { throw new Error("Open a vault file before opening its local graph."); }
    const leaf = this.app.workspace.getLeaf(local ? "split" : "tab");
    await leaf.setViewState({ type: local ? "localgraph" : "graph", state: file ? { file: file.path } : {}, active: true });
  }

  reload(): Promise<void> {
    const root = this.app.vault.rootPath;
    return this.enqueue(async () => {
      if (root !== this.app.vault.rootPath || this.app.changingVault || !this.app.core.isEnabled(this.id)) {
        throw new Error("The graph provider or selected vault changed before its controls could be reloaded.");
      }
      const document = await this.app.configuration.read(this.id);
      readGraphOptions(document.data);
      this.document = document;
      for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
        if (leaf.view instanceof GraphView) { leaf.view.reloadControls(); }
      }
    });
  }

  saveOptions(options: GraphOptions): Promise<void> {
    const root = this.app.vault.rootPath;
    const action = async (): Promise<void> => {
      if (!this.document || root !== this.app.vault.rootPath || !this.app.core.isEnabled(this.id) || this.app.changingVault) {
        throw new Error("The graph provider or selected vault changed before its controls could be saved.");
      }
      this.document = await this.app.configuration.write(this.document, { ...this.document.data, ...options });
    };
    return this.enqueue(action);
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = (this.pending ?? Promise.resolve()).then(action, action);
    this.pending = operation;
    const remove = (): void => { if (this.pending === operation) { this.pending = null; } };
    operation.then(remove, remove);
    return this.app.workspace.track(operation);
  }

  async openNode(node: GraphNode, newTab: boolean): Promise<void> {
    if (this.app.changingVault || this.app.workspace.isChangingFiles) { throw new Error("Wait for the current vault/file operation to finish."); }
    if (node.kind === "tag") {
      const search = this.app.core.getEnabledPluginById("global-search");
      if (!search || !("openGlobalSearch" in search) || typeof search.openGlobalSearch !== "function") { throw new Error("Enable Search before navigating from a tag node."); }
      search.openGlobalSearch("tag:" + JSON.stringify(node.path));
      return;
    }
    let file = this.app.vault.getFileByPath(node.path);
    if (!file && node.kind === "unresolved") { file = await this.app.vault.create(node.path, ""); }
    if (!file) { throw new Error("This graph target no longer exists: " + node.path); }
    await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
  }
}

class GraphPane {
  options: GraphOptions;
  camera: Viewport | null = null;
  private readonly panel: ResponsiveViewPanel;
  private readonly controls = document.createElement("form");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly surface = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private readonly world = document.createElementNS("http://www.w3.org/2000/svg", "g");
  private data: GraphData = { nodes: [], edges: [], warnings: [] };
  private worker: Worker | null = null;
  private serial = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private persistenceRevision = 0;
  private drag: { id: number; node: GraphNode | null; startX: number; startY: number; x: number; y: number; moved: boolean; newTab: boolean } | null = null;
  private readonly positions = new Map<string, SVGGElement>();
  private readonly lines: { source: GraphNode; target: GraphNode; element: SVGLineElement }[] = [];

  constructor(readonly view: ItemView, readonly graphs: Graphs, readonly local?: LocalGraphView) {
    this.options = readGraphOptions(local ? {} : graphs.options);
    const content = view.contentEl;
    content.classList.add("graph-view");
    content.dataset.graphView = local ? "local" : "global";
    this.controls.className = "graph-controls";
    this.panel = new ResponsiveViewPanel(content, this.controls, 450);
    view.register(() => this.panel.destroy());
    this.controls.setAttribute("aria-label", "Graph controls");
    this.controls.addEventListener("submit", event => { event.preventDefault(); this.applyControls(); });
    this.status.className = "graph-status";
    this.status.dataset.graphStatus = "";
    this.status.setAttribute("role", "status");
    this.error.className = "plugin-error";
    this.error.dataset.graphError = "";
    this.error.setAttribute("role", "alert");
    this.surface.setAttribute("viewBox", "0 0 1000 700");
    this.surface.setAttribute("role", "group");
    this.surface.setAttribute("aria-label", local ? "Local note graph" : "Vault graph");
    this.surface.classList.add("graph-surface");
    this.surface.dataset.graphSurface = view.leaf.id;
    const defs = document.createElementNS(this.surface.namespaceURI, "defs");
    const marker = document.createElementNS(this.surface.namespaceURI, "marker");
    marker.id = "graph-arrow-" + view.leaf.id;
    for (const [name, value] of Object.entries({ viewBox: "0 0 10 10", refX: "18", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" })) { marker.setAttribute(name, value); }
    const arrow = document.createElementNS(this.surface.namespaceURI, "path");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.setAttribute("fill", "context-stroke");
    marker.append(arrow);
    defs.append(marker);
    this.surface.append(defs, this.world);
    const main = document.createElement("div");
    main.className = "graph-main";
    const toolbar = document.createElement("div");
    toolbar.className = "graph-toolbar";
    const toggle = iconButton("settings", "Graph controls", () => {
      this.panel.toggle();
      this.resize();
    });
    toggle.dataset.graphAction = "toggle-controls";
    this.panel.bindToggle(toggle);
    toolbar.append(toggle);
    for (const [label, action] of [
      ["Zoom in", () => this.zoom(1.25)], ["Zoom out", () => this.zoom(0.8)],
      ["Fit graph", () => { this.fit(); this.persist(true); }],
      ["Rebuild layout", () => { this.data = { nodes: [], edges: [], warnings: [] }; this.refresh(); }],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.graphAction = label.toLowerCase().replaceAll(" ", "-");
      button.addEventListener("click", action);
      toolbar.append(button);
    }
    if (!local) {
      const reload = document.createElement("button");
      reload.type = "button";
      reload.textContent = "Reload controls";
      reload.dataset.graphAction = "reload-controls";
      reload.addEventListener("click", () => {
        reload.disabled = true;
        this.controls.inert = true;
        this.graphs.reload().catch(error => {
          this.error.textContent = "Graph controls could not be reloaded: " + (error instanceof Error ? error.message : String(error));
        }).finally(() => { this.controls.inert = false; reload.disabled = false; });
      });
      toolbar.append(reload);
    }
    main.append(toolbar, this.status, this.error, this.surface);
    content.append(main, this.controls);
    this.buildControls();
    for (const name of ["resolved", "changed", "deleted"]) { view.registerEvent(view.app.metadataCache.on(name, () => this.refresh())); }
    view.registerEvent(view.app.vault.on("rename", () => this.refresh()));
    view.registerEvent(view.app.metadataCache.on("error", message => this.fail("Metadata update failed: " + String(message))));
    view.register(() => { this.disposed = true; this.cancel(); });
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(content);
    view.register(() => observer.disconnect());
    view.registerDomEvent(this.surface, "pointerdown", event => { if (event instanceof PointerEvent) { this.pointerDown(event); } });
    view.registerDomEvent(this.surface, "pointermove", event => { if (event instanceof PointerEvent) { this.pointerMove(event); } });
    view.registerDomEvent(this.surface, "pointerup", event => { if (event instanceof PointerEvent) { this.pointerUp(event); } });
    view.registerDomEvent(this.surface, "pointercancel", () => { this.drag = null; });
    view.registerDomEvent(this.surface, "wheel", event => {
      if (event instanceof WheelEvent) {
        event.preventDefault();
        this.zoom(Math.exp(-event.deltaY * 0.001), this.point(event.clientX, event.clientY));
      }
    }, { passive: false });
    this.refresh();
  }

  setState(state: Record<string, unknown>): void {
    const options = readGraphOptions(this.local ? state.options === undefined ? {} : state.options : this.graphs.options);
    const camera = viewport(state.slopsidianViewport);
    this.options = options;
    this.camera = camera;
    this.persistenceRevision++;
    this.error.textContent = "";
    this.buildControls();
    this.resize();
    this.refresh();
  }

  resize(): void {
    if (this.disposed) { return; }
    this.panel.resize();
    this.view.contentEl.querySelector('[data-graph-action="toggle-controls"]')?.setAttribute("aria-pressed", String(this.controls.checkVisibility()));
  }

  private section(title: string, key: string): HTMLElement {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = title;
    const collapse = "collapse-" + key;
    details.dataset.graphSection = collapse;
    details.open = this.options[collapse] !== true;
    details.addEventListener("toggle", () => {
      if (this.options[collapse] !== !details.open && details.isConnected) {
        this.options[collapse] = !details.open;
        this.persist();
      }
    });
    details.append(summary);
    this.controls.append(details);
    return details;
  }

  private field(parent: HTMLElement, key: keyof GraphOptions, title: string, type = "checkbox", min?: number, max?: number, step = "any"): HTMLInputElement {
    const label = document.createElement("label");
    label.textContent = title;
    const input = document.createElement("input");
    input.type = type;
    input.dataset.graphOption = String(key);
    input.setAttribute("aria-label", title);
    if (type === "checkbox") { input.checked = this.options[key] === true; }
    else { input.value = String(this.options[key]); }
    if (min !== undefined) { input.min = String(min); }
    if (max !== undefined) { input.max = String(max); }
    input.step = step;
    input.addEventListener("change", () => this.applyControls());
    if (type === "search") {
      input.placeholder = "Filter nodes using a search query";
      input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); this.applyControls(); } });
    }
    label.append(input);
    parent.append(label);
    return input;
  }

  private buildControls(): void {
    this.controls.replaceChildren();
    const filters = this.section("Filters", "filter");
    this.field(filters, "search", "Filter nodes", "search");
    if (this.local) {
      this.field(filters, "localJumps", "Depth", "number", 1, 5, "1");
      this.field(filters, "localBacklinks", "Incoming links");
      this.field(filters, "localForelinks", "Outgoing links");
      this.field(filters, "localInterlinks", "Neighbor links");
    }
    this.field(filters, "showTags", "Tags");
    this.field(filters, "showAttachments", "Attachments");
    this.field(filters, "hideUnresolved", "Existing files only");
    this.field(filters, "showOrphans", "Orphans");
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.textContent = "Apply filters";
    apply.dataset.graphAction = "apply";
    filters.append(apply);
    const groups = this.section("Groups", "color-groups");
    this.options.colorGroups.forEach((group, index) => {
      const row = document.createElement("div");
      row.className = "graph-color-group";
      row.dataset.graphGroup = String(index);
      const query = document.createElement("input");
      query.value = group.query;
      query.setAttribute("aria-label", "Group query");
      query.dataset.graphGroupQuery = "";
      const color = document.createElement("input");
      color.type = "color";
      color.value = "#" + group.color.rgb.toString(16).padStart(6, "0");
      color.setAttribute("aria-label", "Group color");
      color.dataset.graphGroupColor = "";
      query.addEventListener("change", () => this.applyControls());
      color.addEventListener("change", () => this.applyControls());
      row.append(query, color);
      for (const [title, offset] of [["Up", -1], ["Down", 1], ["Remove", 0]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = title;
        button.disabled = offset !== 0 && (index + offset < 0 || index + offset >= this.options.colorGroups.length);
        button.addEventListener("click", () => {
          if (!this.applyControls(false)) { return; }
          const value = this.options.colorGroups.splice(index, 1)[0];
          if (offset) { this.options.colorGroups.splice(index + offset, 0, value); }
          this.buildControls(); this.refresh(); this.persist();
        });
        row.append(button);
      }
      groups.append(row);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "New group";
    add.disabled = this.options.colorGroups.length >= 100;
    add.dataset.graphAction = "add-group";
    add.addEventListener("click", () => {
      if (!this.applyControls(false)) { return; }
      this.options.colorGroups.push({ query: "", color: { a: 1, rgb: 0x8b7cf8 } });
      this.buildControls();
      this.persist();
    });
    groups.append(add);
    const display = this.section("Display", "display");
    this.field(display, "showArrow", "Arrows");
    this.field(display, "nodeSizeMultiplier", "Node size", "number", 0.1, 5);
    this.field(display, "lineSizeMultiplier", "Link thickness", "number", 0.1, 5);
    this.field(display, "textFadeMultiplier", "Text fade", "number", -3, 3, "0.1");
    const forces = this.section("Forces", "forces");
    this.field(forces, "centerStrength", "Center force", "number", 0, 1);
    this.field(forces, "repelStrength", "Repel force", "number", 0, 20);
    this.field(forces, "linkStrength", "Link force", "number", 0, 1);
    this.field(forces, "linkDistance", "Link distance", "number", 30, 500);
  }

  private applyControls(save = true): boolean {
    try {
      const data = copyViewData(this.options, 256);
      for (const section of this.controls.querySelectorAll<HTMLDetailsElement>("[data-graph-section]")) {
        data[section.dataset.graphSection!] = !section.open;
      }
      for (const input of this.controls.querySelectorAll<HTMLInputElement>("[data-graph-option]")) {
        if (input.type === "number" && !input.value.trim()) { throw new Error(input.getAttribute("aria-label") + " needs a number."); }
        data[input.dataset.graphOption!] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
      }
      data.colorGroups = [...this.controls.querySelectorAll<HTMLElement>("[data-graph-group]")].map((row, index) => {
        const group = this.options.colorGroups[index];
        return {
          ...group, query: row.querySelector<HTMLInputElement>("[data-graph-group-query]")!.value,
          color: { ...group.color, rgb: Number.parseInt(row.querySelector<HTMLInputElement>("[data-graph-group-color]")!.value.slice(1), 16) },
        };
      });
      const options = readGraphOptions(data);
      if (["centerStrength", "repelStrength", "linkStrength", "linkDistance"].some(key => options[key] !== this.options[key])) {
        this.data = { nodes: [], edges: [], warnings: [] };
        this.camera = null;
      }
      this.options = options;
      this.refresh();
      if (save) { this.persist(); }
      return true;
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); return false; }
  }

  private persist(cameraOnly = false): void {
    const revision = cameraOnly ? this.persistenceRevision : ++this.persistenceRevision;
    const options = readGraphOptions(this.options);
    const save = this.local || cameraOnly ? Promise.resolve() : this.graphs.saveOptions(options);
    save.then(() => this.view.app.workspace.requestSaveLayout()).then(
      () => { if (!this.disposed && revision === this.persistenceRevision && (this.local || !cameraOnly)) { this.error.textContent = ""; } },
      error => { if (!this.disposed && revision === this.persistenceRevision) { this.error.textContent = "Graph state could not be saved: " + (error instanceof Error ? error.message : String(error)); } else if (this.disposed) { reportError(error); } },
    );
  }

  refresh(): void {
    if (this.disposed) { return; }
    this.cancel();
    this.status.dataset.graphComplete = "false";
    this.debounce = setTimeout(() => { this.debounce = null; this.update(); }, 25);
  }

  private cancel(): void {
    this.serial++;
    this.worker?.terminate();
    this.worker = null;
    if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; }
    if (this.debounce !== null) { clearTimeout(this.debounce); this.debounce = null; }
  }

  private fail(message: string): void {
    this.cancel();
    this.status.classList.add("is-error");
    this.status.textContent = message;
    this.status.dataset.graphComplete = "true";
    this.status.dataset.completedQuery = this.options.search;
    this.world.replaceChildren();
    this.positions.clear();
    this.lines.length = 0;
    this.data = { nodes: [], edges: [], warnings: [] };
  }

  private update(): void {
    const id = this.serial;
    const root = this.view.app.vault.rootPath;
    this.status.textContent = "Building graph...";
    this.status.classList.remove("is-error");
    try {
      const worker = this.worker = new Worker(new URL("js/graph-worker.js", document.baseURI), { type: "module" });
      this.timeout = setTimeout(() => this.fail("Graph exceeded the three-second limit. Simplify the query or use a narrower filter."), 3000);
      worker.onerror = event => { event.preventDefault(); this.fail("Graph engine failed: " + event.message); };
      worker.onmessage = (event: MessageEvent<GraphResponse>) => {
        if (this.disposed || event.data.id !== id || id !== this.serial || root !== this.view.app.vault.rootPath) { return; }
        if (event.data.error !== undefined || !event.data.data) { this.fail(event.data.error ?? "The graph engine returned no graph data."); return; }
        const data = event.data.data;
        this.cancel();
        const previous = new Map(this.data.nodes.map(node => [node.id, node]));
        for (const node of data.nodes) {
          const old = previous.get(node.id);
          if (old) { node.x = old.x; node.y = old.y; }
        }
        this.data = data;
        this.render();
        const issues = this.view.app.metadataCache.getIssues();
        this.status.textContent = `${data.nodes.length} nodes, ${data.edges.length} links.${data.warnings.length ? " " + data.warnings.join(" ") : ""}${issues.length ? ` ${issues.length} metadata issues may leave the graph incomplete.` : ""}`;
        this.status.dataset.graphComplete = "true";
        this.status.dataset.completedQuery = this.options.search;
        this.status.dataset.graphCenter = this.local?.file?.path ?? "";
      };
      const request: GraphRequest = {
        id, files: this.view.app.vault.getFiles().map(file => ({ path: file.path, extension: file.extension })),
        documents: this.view.app.metadataCache.getDocuments().map(entry => ({ path: entry.document.file.path, text: entry.text, cache: entry.cache })),
        options: this.options, ...(this.local ? { center: this.local.file?.path ?? null } : {}),
      };
      worker.postMessage(request);
    } catch (error) { this.fail("Graph engine could not start: " + (error instanceof Error ? error.message : String(error))); }
  }

  private render(): void {
    this.world.replaceChildren();
    this.positions.clear();
    this.lines.length = 0;
    const nodes = new Map(this.data.nodes.map(node => [node.id, node]));
    for (const edge of this.data.edges) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("graph-link");
      line.dataset.graphSource = edge.source;
      line.dataset.graphTarget = edge.target;
      line.style.strokeWidth = String(this.options.lineSizeMultiplier * 1.5);
      if (this.options.showArrow) { line.setAttribute("marker-end", `url(#graph-arrow-${this.view.leaf.id})`); }
      this.lines.push({ source: nodes.get(edge.source)!, target: nodes.get(edge.target)!, element: line });
      this.world.append(line);
    }
    for (const node of this.data.nodes) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("graph-node", "is-" + node.kind);
      group.classList.toggle("is-center", node.path === this.local?.file?.path);
      group.dataset.graphNode = node.id;
      group.dataset.graphPath = node.path;
      group.dataset.graphKind = node.kind;
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", node.kind === "unresolved" ? "Create " + node.path : node.path);
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = node.path + (node.kind === "unresolved" ? " (missing note)" : "");
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", String((6 + Math.sqrt(node.degree) * 2) * this.options.nodeSizeMultiplier));
      if (node.color) { circle.style.fill = node.color; }
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.textContent = node.label;
      label.setAttribute("y", String(22 * this.options.nodeSizeMultiplier));
      label.setAttribute("text-anchor", "middle");
      label.style.opacity = String(Math.max(0.1, Math.min(1, 1 - this.options.textFadeMultiplier * 0.2)));
      group.append(title, circle, label);
      group.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.graphs.app.core.run(() => this.graphs.openNode(node, event.ctrlKey || event.metaKey)).catch(reportError);
        }
      });
      this.positions.set(node.id, group);
      this.world.append(group);
    }
    if (!this.camera) { this.fit(); }
    this.updatePositions();
  }

  private updatePositions(): void {
    for (const node of this.data.nodes) { this.positions.get(node.id)?.setAttribute("transform", `translate(${node.x} ${node.y})`); }
    for (const { source, target, element } of this.lines) {
      element.setAttribute("x1", String(source.x)); element.setAttribute("y1", String(source.y));
      element.setAttribute("x2", String(target.x)); element.setAttribute("y2", String(target.y));
    }
    const camera = this.camera;
    if (camera) { this.world.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.scale})`); }
  }

  private fit(): void {
    const xs = this.data.nodes.map(node => node.x), ys = this.data.nodes.map(node => node.y);
    const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 0;
    const scale = Math.max(0.02, Math.min(2, 900 / (maxX - minX + 120), 580 / (maxY - minY + 120)));
    this.camera = { x: 500 - (minX + maxX) / 2 * scale, y: 350 - (minY + maxY) / 2 * scale, scale };
    this.updatePositions();
  }

  private zoom(factor: number, anchor = { x: 500, y: 350 }): void {
    if (!this.camera) { this.fit(); }
    const camera = this.camera!;
    const scale = Math.max(0.02, Math.min(20, camera.scale * factor));
    const ratio = scale / camera.scale;
    this.camera = { ...camera, scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
    this.updatePositions();
    this.persist(true);
  }

  private point(x: number, y: number): DOMPoint {
    const matrix = this.surface.getScreenCTM();
    if (!matrix) { throw new Error("The graph is not currently visible."); }
    return new DOMPoint(x, y).matrixTransform(matrix.inverse());
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.camera) { return; }
    const target = event.target instanceof Element ? event.target.closest<SVGGElement>("[data-graph-node]") : null;
    const node = target ? this.data.nodes.find(node => node.id === target.dataset.graphNode) ?? null : null;
    const point = this.point(event.clientX, event.clientY);
    this.drag = { id: event.pointerId, node, startX: point.x, startY: point.y, x: node?.x ?? this.camera.x, y: node?.y ?? this.camera.y, moved: false, newTab: event.ctrlKey || event.metaKey };
    this.surface.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId || !this.camera) { return; }
    const point = this.point(event.clientX, event.clientY);
    const dx = point.x - drag.startX, dy = point.y - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 4;
    if (drag.node) { drag.node.x = drag.x + dx / this.camera.scale; drag.node.y = drag.y + dy / this.camera.scale; }
    else { this.camera.x = drag.x + dx; this.camera.y = drag.y + dy; }
    this.updatePositions();
  }

  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) { return; }
    this.drag = null;
    this.surface.releasePointerCapture(event.pointerId);
    if (drag.node && !drag.moved) { this.graphs.app.core.run(() => this.graphs.openNode(drag.node!, drag.newTab)).catch(reportError); }
    else { this.persist(true); }
  }
}

export class GraphView extends ItemView {
  override navigation = true;
  private pane: GraphPane | null = null;
  constructor(leaf: WorkspaceLeaf, readonly graphs: Graphs) { super(leaf); this.icon = "git-fork"; }
  getViewType(): string { return "graph"; }
  getDisplayText(): string { return "Graph view"; }
  override onResize(): void { this.pane?.resize(); }
  reloadControls(): void { this.pane?.setState(this.getState()); }
  protected override async onOpen(): Promise<void> { this.pane = new GraphPane(this, this.graphs); }
  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...(this.pane?.camera ? { slopsidianViewport: this.pane.camera } : {}) };
  }
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const data = copyViewData(state);
    this.pane?.setState(data);
    await super.setState(data, result);
  }
}

export class LocalGraphView extends FileView {
  override navigation = false;
  override allowNoFile = true;
  private pane: GraphPane | null = null;
  constructor(leaf: WorkspaceLeaf, readonly graphs: Graphs) { super(leaf); this.icon = "git-fork"; }
  getViewType(): string { return "localgraph"; }
  override getDisplayText(): string { return this.file ? "Local graph: " + this.file.basename : "Local graph"; }
  override canAcceptExtension(_extension: string): boolean { return true; }
  override onResize(): void { this.pane?.resize(); }
  protected override async onOpen(): Promise<void> {
    this.pane = new GraphPane(this, this.graphs, this);
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (file !== null && !(file instanceof TFile)) { throw new Error("A local graph file-open event needs a vault file or null."); }
      if (this.leaf.pinned || file === this.file || this.app.workspace.isChangingFiles || this.app.workspace.isChangingLayout || this.app.changingVault) { return; }
      this.leaf.setViewState({ type: this.getViewType(), state: { ...this.getState(), file: file?.path ?? null }, active: false }).catch(reportError);
    }));
  }
  override async onLoadFile(): Promise<void> { this.pane?.refresh(); }
  override async onUnloadFile(): Promise<void> { this.pane?.refresh(); }
  override async onRename(): Promise<void> { this.pane?.refresh(); }
  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...(this.pane ? { options: this.pane.options, ...(this.pane.camera ? { slopsidianViewport: this.pane.camera } : {}) } : {}) };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    this.pane?.setState(state);
    await super.setState(state, result);
    this.pane?.refresh();
  }
}
