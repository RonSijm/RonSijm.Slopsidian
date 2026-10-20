import type { App } from "./app";
import type { VaultDocument, VaultFileInfo } from "./contracts";
import { requestJson } from "./contracts";
import { Component } from "./plugin";
import type { TFile } from "./vault";
import { parseLinktext, resolveLink, createLinkResolver } from "./links";
import { BaseDocument, baseProperty, supportedBaseView, baseGroupRenderRows, baseListCellVisible, baseListRowVisible, type BaseResult, type BaseColumn, type BaseSummaryCell, type BaseRequest, type BaseResponse } from "./bases-model";
import { baseQueryFiles, renderBaseValue } from "./base-embed-render";
import { BaseGroupFolds } from "./bases-group-state";
import { BaseCardCoverLease, readBaseCardImage, type BaseCardBinaryImage } from "./bases-cards";
import { baseTableValueContainer, styleBaseTable } from "./bases-table";
import { MAX_EMBED_DEPTH, MAX_EMBEDS_PER_VIEW } from "./note-embed-section";
import type { EmbedScope } from "./note-embed";
import { embeddedPropertyReview, embeddedPropertySurfaceAvailable, type EmbeddedPropertyOwner } from "./bases-embed-authoring";
import { EmbeddedPropertyModal } from "./bases-embed-authoring-modal";

export const MAX_BASE_EMBEDS_PER_VIEW = 8;
const counts = new WeakMap<EmbedScope["budget"], number>();
let embedSequence = 0;

interface BaseEmbedOwnerOptions {
  app: App;
  host: HTMLElement;
  sourcePath: string;
  scope: EmbedScope;
  owned(): boolean;
  /** Interaction mode fence; unlike passive ownership it may be false during restoration. */
  active?(): boolean;
  relink(): void;
}

/** A snapshot owned by an actual containing note/session, never a synthetic .base file. */
export interface InlineBaseConfiguration {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly source: string;
  current(): boolean;
  reveal?(): void;
}
export type BaseEmbedOptions = BaseEmbedOwnerOptions & ({ file: TFile; linktext: string; uri?: boolean; inline?: never }
  | { inline: InlineBaseConfiguration; file?: never; linktext?: never; uri?: never });

/** A Bases presentation with optional reviewed target-note editing; never a synthetic Bases leaf. */
export class BaseEmbed {
  private readonly owner = new Component();
  private readonly root: string | null;
  private readonly path: string;
  private readonly source: TFile | null;
  private readonly sourcePath: string;
  private readonly prefix = "base-embed-" + ++embedSequence;
  private readonly controls: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly search: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly results: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly warnings: HTMLElement;
  private readonly folds: BaseGroupFolds;
  private model: BaseDocument | null = null;
  private text = "";
  private selected = "";
  private page = 0;
  private generation = 0;
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private settle: (() => void) | null = null;
  private covers: BaseCardCoverLease | null = null;
  private closed = false;
  private acquired = false;
  private reloadPending = true;
  private editingProperties = false;
  private readonly editProperties: HTMLButtonElement;
  private readonly caption: HTMLParagraphElement;
  private propertyModal: EmbeddedPropertyModal | null = null;
  private savedBase: VaultDocument | null = null;
  private completeQuery = false;
  ready: Promise<void> = Promise.resolve();

  constructor(private readonly options: BaseEmbedOptions) {
    const { app, host, file, sourcePath, scope } = options, doc = host.ownerDocument;
    this.folds = new BaseGroupFolds(undefined, Boolean(options.inline));
    this.root = app.vault.rootPath; this.path = file?.path ?? sourcePath; this.sourcePath = sourcePath; this.source = app.vault.getFileByPath(sourcePath);
    host.classList.add("bases-embed", "interactive-child"); host.dataset.slopsidianEmbed = "base";
    host.dataset.basesEmbed = this.prefix;
    const heading = doc.createElement("div"), title = doc.createElement("strong"), open = doc.createElement("button"), hint = this.caption = doc.createElement("p");
    heading.className = "bases-embed-header"; title.textContent = file?.name ?? "Inline base"; open.type = "button";
    if (options.inline) {
      host.dataset.basesInline = ""; host.dataset.basesInlineFrom = String(options.inline.from); host.dataset.basesInlineTo = String(options.inline.to);
      open.textContent = "Edit source"; open.dataset.basesInlineSource = ""; open.hidden = !options.inline.reveal;
    } else { open.textContent = "Open base"; open.dataset.basesEmbedOpen = ""; }
    open.addEventListener("click", () => {
      if (!this.interactive(open)) { return; }
      if (options.inline) { options.inline.reveal?.(); }
      else { void this.openBase().catch(error => this.fail(error)); }
    });
    hint.className = "muted bases-embed-caption"; hint.textContent = options.inline
      ? "Read-only inline base. Edit the fenced base source to change its configuration."
      : "Read-only base preview. Open the base to edit properties or configuration.";
    this.editProperties = doc.createElement("button"); this.editProperties.type = "button"; this.editProperties.textContent = "Edit properties…"; this.editProperties.dataset.basesEmbedAuthoringToggle = "true";
    this.editProperties.disabled = app.vault.readOnly;
    this.editProperties.addEventListener("click", () => {
      if (this.editProperties.disabled || !this.interactive(this.editProperties) || !this.authoringAvailable()) { return; }
      this.editingProperties = !this.editingProperties; this.query();
    });
    heading.append(title, open, this.editProperties); this.controls = doc.createElement("div"); this.controls.className = "bases-toolbar";
    const viewLabel = doc.createElement("label"), searchLabel = doc.createElement("label");
    this.select = doc.createElement("select"); this.select.dataset.basesEmbedView = ""; this.select.setAttribute("aria-label", "Embedded base view"); viewLabel.append("View ", this.select);
    this.search = doc.createElement("input"); this.search.type = "search"; this.search.maxLength = 1024; this.search.dataset.basesEmbedSearch = ""; this.search.setAttribute("aria-label", "Search embedded base values"); searchLabel.append("Search ", this.search);
    this.controls.append(viewLabel, searchLabel); this.status = doc.createElement("output"); this.status.className = "bases-status"; this.status.setAttribute("role", "status");
    this.results = doc.createElement("div"); this.results.className = "bases-table-container"; this.results.dataset.basesEmbedResults = "";
    this.pages = doc.createElement("div"); this.pages.className = "bases-pagination"; this.warnings = doc.createElement("div"); this.warnings.className = "bases-issues";
    host.replaceChildren(heading, hint, this.controls, this.status, this.warnings, this.results, this.pages);
    this.select.addEventListener("change", () => { if (this.interactive(this.select) && this.model?.views.some(view => view.name === this.select.value)) { this.selected = this.select.value; this.page = 0; this.query(); } });
    this.search.addEventListener("input", () => { if (this.interactive(this.search)) { this.page = 0; this.schedule(false); } });
    if (!this.source || this.source.extension.toLowerCase() !== "md") { this.fail("A Bases embed needs a current containing Markdown note."); return; }
    if (scope.depth >= MAX_EMBED_DEPTH || scope.budget.used >= MAX_EMBEDS_PER_VIEW || (counts.get(scope.budget) ?? 0) >= MAX_BASE_EMBEDS_PER_VIEW) {
      this.fail(`Only ${MAX_BASE_EMBEDS_PER_VIEW} Bases embeds and ${MAX_EMBEDS_PER_VIEW} total embeds are rendered within the supported nesting limit.`); return;
    }
    this.acquired = true; scope.budget.used++; counts.set(scope.budget, (counts.get(scope.budget) ?? 0) + 1);
    this.owner.load();
    this.owner.registerEvent(app.vault.on("modify", target => {
      if (file && target === file) { this.schedule(true); }
      // The parent owns rereading/reconciling its note. Never reload inline YAML
      // from a second persisted snapshot over a dirty editor session.
      else if (options.inline && target === this.source) { this.stop(); options.relink(); }
    }));
    this.owner.registerEvent(app.vault.on("delete", target => { if (target === file || target === this.source) { options.relink(); } }));
    this.owner.registerEvent(app.vault.on("rename", target => { if (target === file || target === this.source) { options.relink(); } }));
    this.owner.registerEvent(app.metadataCache.on("changed", () => this.schedule(false)));
    this.owner.registerEvent(app.metadataCache.on("finished", () => this.schedule(false)));
    this.owner.registerEvent(app.metadataTypeManager.on("changed", () => this.schedule(false)));
    let available = this.available();
    this.owner.registerEvent(app.core.on("changed", () => {
      if (!this.owned()) { return; }
      const next = this.available();
      if (!next) { this.stop(); this.fail("Enable Bases and wait for the selected vault to finish loading."); }
      else if (!available) { this.ready = this.reload(); }
      available = next;
    }));
    this.ready = this.reload();
  }

  private owned(generation = this.generation): boolean {
    const { app, file, host } = this.options;
    return !this.closed && this.acquired && generation === this.generation && this.root === app.vault.rootPath && this.source?.path === this.sourcePath
      && (this.options.inline ? this.options.inline.current() : Boolean(file && file.path === this.path && app.vault.getFileByPath(this.path) === file))
      && app.vault.getFileByPath(this.sourcePath) === this.source && host.isConnected && this.options.owned();
  }
  private available(): boolean { const app = this.options.app; return app.core.isEnabled("bases") && !app.core.busy && !app.changingVault; }
  private presentationCurrent(node: HTMLElement, generation = this.generation): boolean { return this.owned(generation) && this.available() && node.isConnected && this.options.host.contains(node); }
  private interactive(node: HTMLElement, generation = this.generation): boolean { return this.presentationCurrent(node, generation) && this.options.active?.() !== false && node.checkVisibility(); }
  private fail(error: unknown): void {
    if (this.closed || this.acquired && !this.owned()) { return; }
    this.stop();
    this.options.host.dataset.slopsidianEmbedState = "error"; this.status.textContent = error instanceof Error ? error.message : String(error);
    this.results.replaceChildren(); this.pages.replaceChildren(); this.controls.hidden = true;
  }
  private stop(): void {
    this.propertyModal?.close(); this.propertyModal = null; this.completeQuery = false;
    this.generation++; this.worker?.terminate(); this.worker = null;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.debounce !== null) { clearTimeout(this.debounce); this.debounce = null; }
    this.covers?.dispose(); this.covers = null; this.settle?.(); this.settle = null;
  }
  private schedule(reload: boolean): void {
    if (!this.owned()) { return; }
    this.reloadPending ||= reload || !this.model;
    this.stop();
    this.status.textContent = "Updating embedded base…"; this.options.host.dataset.slopsidianEmbedState = "loading";
    this.debounce = setTimeout(() => { this.debounce = null; if (this.reloadPending) { this.ready = this.reload(); } else { this.query(); } }, 100);
  }
  private async reload(): Promise<void> {
    this.reloadPending = true;
    this.stop(); const generation = this.generation, { app, file } = this.options;
    if (!this.owned(generation)) { return; }
    if (!this.available()) { this.fail("Enable Bases and wait for the selected vault to finish loading."); return; }
    this.status.textContent = this.options.inline ? "Loading inline base…" : "Loading " + this.path + "…"; this.options.host.dataset.slopsidianEmbedState = "loading";
    try {
      let text: string, requested = "";
      if (this.options.inline) { text = this.options.inline.text; }
      else {
        const before = await app.vault.getFileInfo(file!);
        if (!this.owned(generation)) { return; }
        const document = await app.vault.readDocument(this.path);
        if (!this.owned(generation)) { return; }
        const after = await app.vault.getFileInfo(file!);
        if (!this.owned(generation)) { return; }
        const same = (info: VaultFileInfo): boolean => info.root === this.root && info.file.path === this.path && Boolean(info.version) && info.version === before.version;
        if (!same(before) || !same(after) || document.file.path !== this.path || document.version !== before.version) { throw new Error("The embedded base changed while loading. Refresh the note to read its current version."); }
        text = document.content; this.savedBase = document; requested = parseLinktext(this.options.linktext, this.options.uri === true).subpath.replace(/^#/, "");
      }
      const model = new BaseDocument(text);
      if (requested && !model.views.some(view => view.name === requested)) { throw new Error("The embedded base has no named view: " + requested); }
      this.text = text; this.model = model; this.reloadPending = false;
      this.selected = model.views.some(view => view.name === this.selected) ? this.selected : requested || model.views[0].name;
      this.select.replaceChildren();
      for (const view of model.views) { const option = this.options.host.ownerDocument.createElement("option"); option.value = view.name; option.textContent = view.name; this.select.append(option); }
      this.select.value = this.selected; this.controls.hidden = false; this.query(); await this.ready;
    } catch (error) { if (this.owned(generation)) { this.fail(error); } }
  }

  private query(): void {
    if (this.reloadPending || !this.model) { this.ready = this.reload(); return; }
    this.stop(); const generation = this.generation, { app } = this.options, model = this.model;
    this.ready = Promise.resolve();
    if (!this.owned(generation) || !model) { return; }
    if (!this.available()) { this.fail("Enable Bases and wait for the selected vault to finish loading."); return; }
    const view = model.view(this.selected);
    if (!supportedBaseView(view.type)) { this.fail("This embedded view type is unavailable: " + view.type); return; }
    this.status.textContent = "Updating embedded base…"; this.options.host.dataset.slopsidianEmbedState = "loading";
    this.ready = new Promise<void>(resolve => { this.settle = resolve; });
    try {
      const files = baseQueryFiles(app), context = files.find(entry => entry.path === this.sourcePath);
      if (!context) { throw new Error("The containing note is no longer present in the selected vault."); }
      const worker = this.worker = new Worker(new URL("js/bases-worker.js", this.options.host.ownerDocument.baseURI), { type: "module" });
      this.timer = setTimeout(() => { if (this.worker === worker) { const current = this.owned(generation); this.stop(); if (current) { this.fail("The embedded query exceeded its three-second worker deadline."); } } }, 3000);
      worker.addEventListener("message", (event: MessageEvent<BaseResponse>) => {
        if (event.data.serial !== generation || this.worker !== worker) { return; }
        if (!this.owned(generation)) { this.stop(); return; }
        if (!this.available()) { this.fail("Enable Bases and wait for the selected vault to finish loading."); return; }
        worker.terminate(); this.worker = null; if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        try {
          if ("error" in event.data) { this.fail(event.data.error); }
          else { this.render(event.data.result, generation); this.options.host.dataset.slopsidianEmbedState = "ready"; }
        } catch (error) { this.covers?.dispose(); this.covers = null; this.fail(error); }
        finally { this.settle?.(); this.settle = null; }
      });
      worker.addEventListener("error", () => { if (this.worker === worker) { this.stop(); this.fail("The embedded base query worker failed."); } });
      worker.postMessage({ text: this.text, files, context, view: this.selected, search: this.search.value, page: this.page, serial: generation } satisfies BaseRequest);
    } catch (error) { this.stop(); this.fail(error); }
  }

  private render(result: BaseResult, generation: number): void {
    const doc = this.options.host.ownerDocument, view = this.model!.view(this.selected);
    this.completeQuery = result.errors.length === 0 && result.warnings.length === 0;
    this.editProperties.disabled = !this.authoringAvailable(); this.editProperties.textContent = this.editingProperties ? "Done editing properties" : "Edit properties…";
    this.editProperties.setAttribute("aria-pressed", String(this.editingProperties));
    this.caption.textContent = this.editingProperties
      ? "Choose a supported note property to review its typed value in normal Source. The base configuration is unchanged."
      : this.options.inline ? "Read-only inline base. Edit the fenced base source to change its configuration."
        : "Read-only base preview. Open the base for configuration, or choose Edit properties for a separate target-note review.";
    this.page = result.page; this.results.replaceChildren(); this.pages.replaceChildren(); this.warnings.replaceChildren();
    this.results.dataset.basesEmbedLayout = view.type;
    this.status.textContent = `${result.total} rows · Page ${result.page + 1} of ${result.pages}` + (result.summaries.some(Boolean) ? ` · Summaries cover all ${result.total} rows` : "");
    for (const message of [...result.warnings, ...result.errors]) { const text = doc.createElement("p"); text.textContent = message; this.warnings.append(text); }
    const active = (node: HTMLElement): boolean => this.interactive(node, generation);
    let group: string | null = null, target: HTMLElement | null = null;
    const table = view.type === "table" ? doc.createElement("table") : null;
    if (table) { table.className = "bases-table"; styleBaseTable(table, view.table!, result.columns.map(column => column.key), true); const head = doc.createElement("thead"), row = doc.createElement("tr"); for (const label of [...result.columns.map(column => column.label), "Open"]) { const th = doc.createElement("th"); th.scope = "col"; th.textContent = label; row.append(th); } head.append(row); table.append(head); this.results.append(table); }
    if (view.type === "cards") { this.installCovers(generation); }
    for (const row of baseGroupRenderRows(result)) {
      if (!target || group !== row.groupKey) {
        group = row.groupKey;
        const info = result.groups.find(value => value.key === row.groupKey), section = table ? doc.createElement("tbody") : doc.createElement("section");
        target = view.type === "cards" ? doc.createElement("div") : view.type === "list" ? doc.createElement(view.list!.markers === "number" ? "ol" : "ul") : section;
        if (view.type === "cards") { target.className = "bases-cards-grid"; target.style.setProperty("--bases-card-size", view.cards!.cardSize + "px"); target.setAttribute("role", "list"); }
        if (view.type === "list") { target.className = "bases-list"; target.dataset.basesMarkers = view.list!.markers; }
        if (info && result.groupProperty) {
          const scope = { file: this.path, view: this.selected, property: result.groupProperty }, identity = info.identity;
          const heading = doc.createElement(table ? "tr" : "h4"), button = doc.createElement("button"), cell = table ? doc.createElement("td") : heading;
          if (table) { (cell as HTMLTableCellElement).colSpan = result.columns.length + 1; heading.append(cell); }
          button.type = "button"; button.dataset.basesEmbedFold = info.label; button.disabled = !identity;
          if (!identity) { button.title = "This group value is too large to retain a fold preference."; }
          const update = (): void => { const folded = Boolean(identity && this.folds.has(scope, identity)); button.textContent = (folded ? "▸" : "▾") + info.label + " · " + info.count; button.setAttribute("aria-expanded", String(!folded)); for (const child of section.querySelectorAll<HTMLElement>("[data-bases-embed-row]")) { child.hidden = folded; } };
          button.addEventListener("click", () => { if (!button.disabled && identity && active(button)) { try { this.folds.toggle(scope, identity); update(); } catch (error) { this.fail(error); } } }); cell.append(button); section.append(heading);
          if (info.summaries?.some(Boolean)) { section.append(this.summary(result.columns, info.summaries, info.label, Boolean(table))); }
          section.dataset.basesEmbedGroup = identity ?? info.key;
          queueMicrotask(() => { if (this.owned(generation)) { update(); } });
        }
        if (target !== section) { section.append(target); }
        (table ?? this.results).append(section);
      }
      if (row.emptyGroup) { continue; }
      if (view.type === "list" && !baseListRowVisible(row.cells, view.list!)) { continue; }
      const node = doc.createElement(view.type === "table" ? "tr" : view.type === "list" ? "li" : "article"); node.dataset.basesEmbedRow = row.path;
      if (view.type === "cards") { node.className = "bases-card"; node.setAttribute("role", "listitem"); this.cover(node, row.cover, row.path, generation); }
      if (view.type === "list" && view.list!.markers === "number" && row.listNumber != null) { (node as HTMLLIElement).value = row.listNumber; }
      const nested = view.type === "list" && view.list!.indentProperties ? doc.createElement("ul") : null;
      if (nested) { nested.className = "bases-list-nested"; }
      let primary = true;
      row.cells.forEach((value, index) => {
        if (view.type === "list" && !baseListCellVisible(value)) { return; }
        if (view.type === "list" && !primary && !nested) { const separator = doc.createElement("span"); separator.className = "bases-list-separator"; separator.textContent = view.list!.separator; separator.setAttribute("aria-hidden", "true"); node.append(separator); }
        const column = result.columns[index], cell = doc.createElement(view.type === "table" ? "td" : view.type === "list" ? nested && !primary ? "li" : "span" : "div"); cell.dataset.basesCell = column.key;
        const content = view.type === "table" ? baseTableValueContainer(cell as HTMLTableCellElement) : cell;
        if (view.type === "cards") { cell.className = "bases-card-property" + (index === 0 ? " bases-card-title" : ""); const label = doc.createElement("span"); label.className = "bases-card-label"; label.textContent = column.label; cell.append(label); }
        if (view.type === "list") { cell.className = "bases-list-value" + (primary ? " bases-list-primary" : ""); cell.setAttribute("aria-label", column.label); }
        const valueNode = doc.createElement("span"); renderBaseValue(valueNode, column, row.path, value, { current: active, open: link => { void this.open(link).catch(error => this.fail(error)); } }); content.append(valueNode);
        if (this.editingProperties && baseProperty(column.key).kind === "note" && /\.md$/i.test(row.path)) {
          const edit = doc.createElement("button"); edit.type = "button"; edit.textContent = "Edit " + column.label; edit.className = "bases-embed-property-edit";
          edit.dataset.basesEmbedPropertyEdit = column.key; edit.dataset.basesEmbedPropertyPath = row.path; edit.setAttribute("aria-label", "Review " + column.label + " in " + row.path);
          edit.disabled = !this.authoringAvailable() || Boolean(value.error) || row.path === this.sourcePath;
          if (row.path === this.sourcePath) { edit.title = "Edit the containing note's own properties in its normal Source or Properties pane."; }
          edit.addEventListener("click", () => { if (!edit.disabled && active(edit)) { this.editProperty(row.path, baseProperty(column.key).name, generation); } }); content.append(edit);
        }
        if (nested && !primary) { nested.append(cell); } else { node.append(cell); } primary = false;
      });
      if (nested?.childElementCount) { node.append(nested); }
      const open = doc.createElement("button"); open.type = "button"; open.textContent = "Open file"; open.dataset.basesEmbedFile = row.path;
      open.addEventListener("click", () => { if (active(open)) { void this.open(row.path).catch(error => this.fail(error)); } });
      if (view.type === "table") { const cell = doc.createElement("td"); baseTableValueContainer(cell).append(open); node.append(cell); } else { node.append(open); }
      target!.append(node);
    }
    if (!result.rows.length) { const empty = doc.createElement("p"); empty.textContent = "No files match this view."; this.results.append(empty); }
    if (result.summaries.some(Boolean)) { this.results.append(this.summary(result.columns, result.summaries, "All rows", false)); }
    for (const [name, page, disabled] of [["Previous page", this.page - 1, this.page === 0], ["Next page", this.page + 1, this.page >= result.pages - 1]] as const) {
      const button = doc.createElement("button"); button.type = "button"; button.textContent = name; button.disabled = disabled; button.dataset.basesEmbedPage = name.startsWith("Next") ? "next" : "previous";
      button.addEventListener("click", () => { if (!button.disabled && active(button)) { this.page = page; this.query(); } }); this.pages.append(button);
    }
  }
  private summary(columns: BaseColumn[], values: (BaseSummaryCell | null)[], label: string, table: boolean): HTMLElement {
    const doc = this.options.host.ownerDocument, row = doc.createElement(table ? "tr" : "div"); row.className = "bases-embed-summaries"; row.setAttribute("aria-label", label + " summaries");
    if (table) { const cell = doc.createElement("td"); cell.colSpan = columns.length + 1; row.append(cell); }
    const content = table ? row.firstElementChild! : row;
    values.forEach((value, index) => { if (!value) { return; } const text = doc.createElement("span"); text.dataset.basesEmbedSummary = columns[index].key; text.textContent = `${label} · ${columns[index].label}: ${value.name}: ${value.text}`; if (value.error) { text.title = value.error; text.classList.add("bases-cell-error"); } content.append(text); }); return row;
  }
  private installCovers(generation: number): void {
    const { app } = this.options;
    this.covers = new BaseCardCoverLease(async entry => {
      const file = app.vault.getFileByPath(entry.path);
      if (!file) { throw new Error("The cover image no longer exists."); }
      return readBaseCardImage(entry, this.root ?? "", () => app.vault.getFileInfo(file), () => requestJson<BaseCardBinaryImage>(`/api/binary?path=${encodeURIComponent(entry.path)}&root=${encodeURIComponent(this.root ?? "")}`),
        () => this.owned(generation) && this.available() && file.path === entry.path && app.vault.getFileByPath(entry.path) === file && file.stat.size === entry.stat.size && file.stat.mtime === entry.stat.mtime);
    }, () => this.owned(generation) && this.available());
  }
  private cover(card: HTMLElement, value: import("./bases-model").BaseRow["cover"], rowPath: string, generation: number): void {
    const options = this.model!.view(this.selected).cards!; if (!options.image) { return; }
    const doc = card.ownerDocument, cover = doc.createElement("div"); cover.className = "bases-card-cover"; cover.style.aspectRatio = String(1 / options.imageAspectRatio); cover.dataset.basesEmbedCover = ""; card.append(cover);
    if (!value) { cover.dataset.basesEmbedCover = "empty"; cover.textContent = "No cover"; return; }
    if (value.kind === "color") { cover.dataset.basesEmbedCover = "color"; cover.style.backgroundColor = value.color; return; }
    if (value.kind === "error") { cover.dataset.basesEmbedCover = "error"; cover.textContent = "Cover unavailable"; cover.title = value.message; return; }
    const file = createLinkResolver(this.options.app.vault.getFiles())(value.path, rowPath)?.file;
    if (!file) { cover.dataset.basesEmbedCover = "error"; cover.textContent = "Cover unavailable"; return; }
    cover.dataset.basesEmbedCover = "loading";
    this.covers!.load({ path: file.path, extension: file.extension, stat: { ...file.stat } }).then(url => {
      if (!url || !this.presentationCurrent(cover, generation)) { return; }
      const image = doc.createElement("img"); image.alt = ""; image.style.objectFit = options.imageFit === "contain" ? "contain" : "cover";
      image.addEventListener("load", () => { if (this.presentationCurrent(cover, generation)) { cover.dataset.basesEmbedCover = "ready"; } });
      image.addEventListener("error", () => { if (this.presentationCurrent(cover, generation)) { cover.dataset.basesEmbedCover = "error"; cover.textContent = "Cover unavailable"; } });
      image.src = url; cover.replaceChildren(image);
    }).catch(error => { if (this.presentationCurrent(cover, generation)) { cover.dataset.basesEmbedCover = "error"; cover.textContent = "Cover unavailable"; cover.title = String(error); } });
  }
  private async open(link: string): Promise<void> {
    if (!this.owned() || !this.available()) { return; }
    const destination = resolveLink(this.options.app.vault.getFiles(), link, this.path)?.file;
    if (!destination || this.options.app.vault.getFileByPath(destination.path) !== destination) { throw new Error("The linked file is unavailable. Embedded bases do not create missing notes."); }
    const subpath = parseLinktext(link).subpath;
    await this.options.app.workspace.openLinkText(destination.path + subpath, this.path, true);
  }
  private async openBase(): Promise<void> { await this.open(this.path); }
  private authoringAvailable(): boolean {
    const { app } = this.options;
    return !app.vault.readOnly && this.completeQuery && this.available() && this.options.scope.depth === 0 && embeddedPropertySurfaceAvailable(app, this.options.host, this.sourcePath);
  }
  private editProperty(path: string, key: string, generation: number): void {
    const { app, host } = this.options;
    if (!this.authoringAvailable() || !this.interactive(host, generation)) { return; }
    const model = this.model, selected = this.selected, search = this.search.value, page = this.page, text = this.text, saved = this.savedBase;
    const savedVersion = saved?.version, savedText = saved?.content, savedBom = saved?.hasBom === true;
    const owner: EmbeddedPropertyOwner = { app, host, sourcePath: this.sourcePath,
      current: () => this.editingProperties && this.authoringAvailable() && this.interactive(host, generation) && this.model === model && this.selected === selected
        && this.search.value === search && this.page === page && this.text === text && this.savedBase === saved
        && (!saved || saved.version === savedVersion && saved.content === savedText && (saved.hasBom === true) === savedBom),
      physical: async () => {
        if (!owner.current()) { return false; }
        if (this.options.inline) { return this.options.inline.current(); }
        if (!saved) { return false; } const current = await app.vault.readDocument(this.path);
        return owner.current() && current.file.path === this.path && current.content === savedText && current.version === savedVersion && (current.hasBom === true) === savedBom;
      } };
    const review = embeddedPropertyReview(owner, path, key);
    if (!review) { this.status.textContent = "This target needs current normal Markdown Source and supported, lossless property values. Refresh the note or edit its Source directly."; return; }
    this.propertyModal?.close();
    const modal = new EmbeddedPropertyModal(app, review, () => { if (this.propertyModal === modal) { this.propertyModal = null; } }); this.propertyModal = modal; modal.open();
  }
  async dispose(): Promise<void> {
    if (this.closed) { return Promise.resolve(); }
    const pending = this.propertyModal?.settled; this.closed = true; this.stop(); const unloaded = this.owner.unload();
    if (this.acquired) { this.acquired = false; this.options.scope.budget.used--; counts.set(this.options.scope.budget, (counts.get(this.options.scope.budget) ?? 1) - 1); }
    await Promise.all([unloaded, pending]);
  }
}
