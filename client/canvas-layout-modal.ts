import type { App } from "./app";
import { Modal } from "./ui";
import { canvasLayoutKinds, readCanvasLayoutSettings, type CanvasLayoutPlan, type CanvasLayoutSettings } from "./canvas-layout";

const svgNamespace = "http://www.w3.org/2000/svg";

/** An abstract model-only diagram: no card content, external URLs or rendering hooks. */
export function canvasLayoutPreview(plan: CanvasLayoutPlan, owner: Document): SVGSVGElement {
  const svg = owner.createElementNS(svgNamespace, "svg"), frames = new Map(plan.frames.map(frame => [frame.id, frame]));
  const left = Math.min(...plan.frames.map(frame => frame.x)), top = Math.min(...plan.frames.map(frame => frame.y));
  const width = Math.max(...plan.frames.map(frame => frame.x + frame.width)) - left, height = Math.max(...plan.frames.map(frame => frame.y + frame.height)) - top, padding = Math.max(16, Math.max(width, height) * 0.025);
  svg.classList.add("canvas-layout-preview"); svg.dataset.canvasLayoutPreview = "";
  svg.setAttribute("viewBox", `${left - padding} ${top - padding} ${width + padding * 2} ${height + padding * 2}`);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `Proposed layout: ${plan.units} independent item outlines and ${plan.connections.length} directed links. Group outlines contain all their existing cards.`);
  for (const connection of plan.connections) {
    const a = frames.get(connection.from)!, b = frames.get(connection.to)!, dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
    const distance = Math.hypot(dx, dy); if (!distance) { continue; }
    const start = Math.min(dx ? a.width / 2 / Math.abs(dx) : Infinity, dy ? a.height / 2 / Math.abs(dy) : Infinity), end = Math.min(dx ? b.width / 2 / Math.abs(dx) : Infinity, dy ? b.height / 2 / Math.abs(dy) : Infinity);
    const x1 = a.x + a.width / 2 + dx * start, y1 = a.y + a.height / 2 + dy * start, x2 = b.x + b.width / 2 - dx * end, y2 = b.y + b.height / 2 - dy * end;
    const arrow = Math.min(12, Math.hypot(x2 - x1, y2 - y1) / 4), ux = dx / distance, uy = dy / distance;
    const path = owner.createElementNS(svgNamespace, "path"); path.classList.add("canvas-layout-link"); path.setAttribute("vector-effect", "non-scaling-stroke");
    path.setAttribute("d", `M${x1} ${y1}L${x2} ${y2}M${x2 - ux * arrow - uy * arrow / 2} ${y2 - uy * arrow + ux * arrow / 2}L${x2} ${y2}L${x2 - ux * arrow + uy * arrow / 2} ${y2 - uy * arrow - ux * arrow / 2}`); svg.append(path);
  }
  plan.frames.forEach((frame, index) => {
    const rect = owner.createElementNS(svgNamespace, "rect"), title = owner.createElementNS(svgNamespace, "title");
    rect.classList.add(frame.group ? "canvas-layout-group" : "canvas-layout-card"); rect.dataset.canvasLayoutItem = frame.id;
    rect.setAttribute("x", String(frame.x)); rect.setAttribute("y", String(frame.y)); rect.setAttribute("width", String(frame.width)); rect.setAttribute("height", String(frame.height)); rect.setAttribute("vector-effect", "non-scaling-stroke");
    title.textContent = `${frame.group ? "Group" : "Card"} ${frame.id.slice(0, 120)}`; rect.append(title); svg.append(rect);
    if (index < 64) {
      const label = owner.createElementNS(svgNamespace, "text"); label.textContent = String(index + 1); label.classList.add("canvas-layout-number"); label.setAttribute("x", String(frame.x + frame.width / 2)); label.setAttribute("y", String(frame.y + frame.height / 2)); label.setAttribute("font-size", String(Math.max(1, Math.min(frame.width, frame.height) / 3))); label.setAttribute("text-anchor", "middle"); label.setAttribute("dominant-baseline", "central"); svg.append(label);
    }
  });
  return svg;
}

export class CanvasLayoutModal extends Modal {
  private readonly kind = document.createElement("select");
  private readonly columns = document.createElement("input");
  private readonly gap = document.createElement("input");
  private readonly columnsLabel = document.createElement("label");
  private readonly preview = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly review = document.createElement("button");
  private readonly apply = document.createElement("button");
  private readonly events = new AbortController();
  private readonly refs: ReturnType<App["core"]["on"]>[] = [];
  private reviewed: CanvasLayoutPlan | null = null;
  private retired = false;

  constructor(app: App, selected: number, private readonly authority: {
    current(): boolean;
    plan(settings: CanvasLayoutSettings): CanvasLayoutPlan;
    apply(plan: CanvasLayoutPlan): (() => void) | void;
    closed(): void;
  }) {
    super(app); this.setTitle("Layout selection"); this.modalEl.dataset.canvasLayout = ""; this.modalEl.classList.add("canvas-layout-modal");
    const help = document.createElement("p"), choices = document.createElement("div"), kindLabel = document.createElement("label"), gapLabel = document.createElement("label"), details = document.createElement("p"), actions = document.createElement("div"), cancel = document.createElement("button");
    help.textContent = `${selected} explicitly selected ${selected === 1 ? "card or frame" : "cards or frames"}. A selected outer group and every card fully inside it move together once. Review the proposed positions, then Apply layout for one Undo step.`;
    choices.className = "canvas-layout-choices";
    this.kind.dataset.canvasLayoutKind = ""; this.kind.setAttribute("aria-label", "Layout pattern"); this.kind.size = canvasLayoutKinds.length;
    for (const choice of canvasLayoutKinds) { const option = document.createElement("option"); option.value = choice.id; option.textContent = choice.title; this.kind.append(option); }
    this.kind.value = "grid"; kindLabel.append("Layout pattern", this.kind);
    for (const [control, title, key, value, minimum, maximum] of [[this.columns, "Grid columns", "canvasLayoutColumns", "2", "1", "1000"], [this.gap, "Spacing (pixels)", "canvasLayoutGap", "32", "0", "1000"]] as const) {
      control.type = "number"; control.value = value; control.min = minimum; control.max = maximum; control.step = "1"; control.dataset[key] = ""; control.setAttribute("aria-label", title);
    }
    this.columnsLabel.append("Grid columns", this.columns); gapLabel.append("Spacing (pixels)", this.gap); choices.append(kindLabel, this.columnsLabel, gapLabel);
    this.preview.className = "canvas-layout-diagram"; this.preview.dataset.canvasLayoutDiagram = ""; this.preview.hidden = true;
    this.status.dataset.canvasLayoutStatus = ""; this.status.setAttribute("role", "status");
    this.error.className = "plugin-error"; this.error.dataset.canvasLayoutError = ""; this.error.setAttribute("role", "alert");
    details.className = "canvas-layout-details";
    details.textContent = "Grid, row and column use current top-to-bottom, left-to-right order, with card IDs breaking ties. Grid cells fit the widest column and tallest row. Connection layouts follow arrowheads; two-headed and arrowless links connect both ways. Cycles share a level, and disconnected sets are packed separately. Same-level ties use card IDs. Layout keeps the selection’s original top-left corner, card sizes, stored connections and every existing group membership. Overlapping or ambiguous group families refuse. Up to 1,000 independent items; the diagram shows their outlines and at most 1,500 directed links. Referenced files, websites and card content are not loaded by this review.";
    this.review.type = this.apply.type = cancel.type = "button";
    this.review.textContent = "Review layout"; this.review.dataset.canvasLayoutReview = "";
    this.apply.textContent = "Apply layout"; this.apply.dataset.canvasLayoutApply = ""; this.apply.disabled = true;
    cancel.textContent = "Cancel"; cancel.dataset.canvasLayoutCancel = "";
    for (const control of [this.kind, this.columns, this.gap]) {
      control.addEventListener("input", () => this.choicesChanged(), { signal: this.events.signal });
      control.addEventListener("change", () => this.choicesChanged(), { signal: this.events.signal });
    }
    this.review.addEventListener("click", () => this.prepare(), { signal: this.events.signal });
    this.apply.addEventListener("click", () => this.accept(), { signal: this.events.signal });
    cancel.addEventListener("click", () => this.close(), { signal: this.events.signal });
    actions.className = "canvas-layout-actions"; actions.append(this.review, this.apply, cancel);
    this.contentEl.append(help, choices, this.status, this.preview, this.error, details, actions);
  }
  override onOpen(): void {
    this.refs.push(this.app.core.on("changed", () => { if (!this.authority.current()) { this.invalidate(); } }));
    this.prepare(); if (this.current()) { this.kind.focus(); }
  }
  private current(): boolean { return this.isOpen && this.containerEl.isConnected && !this.retired && this.authority.current(); }
  private settings(): Readonly<CanvasLayoutSettings> {
    return readCanvasLayoutSettings({ kind: this.kind.value as CanvasLayoutSettings["kind"], columns: this.columns.value.trim() ? Number(this.columns.value) : NaN, gap: this.gap.value.trim() ? Number(this.gap.value) : NaN });
  }
  invalidate(): void {
    this.retired = true; this.reviewed = null; this.apply.disabled = this.review.disabled = true;
    this.kind.disabled = this.columns.disabled = this.gap.disabled = true;
    this.status.textContent = "This layout review is no longer current.";
    this.error.textContent = "This Canvas or its selection changed. Close Layout selection and reopen it on the current cards. No layout was applied.";
  }
  private choicesChanged(): void {
    if (!this.current()) { this.invalidate(); return; }
    this.reviewed = null; this.apply.disabled = true; this.preview.replaceChildren(); this.preview.hidden = true; this.error.textContent = "";
    this.columnsLabel.hidden = this.kind.value !== "grid"; this.columns.disabled = this.columnsLabel.hidden;
    this.status.textContent = "Choices changed. Review layout before applying.";
  }
  private prepare(): void {
    if (!this.current()) { this.invalidate(); return; }
    this.reviewed = null; this.apply.disabled = true; this.preview.replaceChildren(); this.preview.hidden = true; this.error.textContent = "";
    this.columnsLabel.hidden = this.kind.value !== "grid"; this.columns.disabled = this.columnsLabel.hidden;
    try {
      const plan = this.authority.plan(this.settings());
      if (!this.current()) { this.invalidate(); return; }
      const diagram = canvasLayoutPreview(plan, this.modalEl.ownerDocument);
      this.preview.append(diagram); this.preview.hidden = false; this.reviewed = plan; this.apply.disabled = false;
      this.status.textContent = `${plan.units} independent items · ${plan.members} cards and frames · ${plan.positions.length} moved · ${plan.connectedSets} connected sets · ${plan.cycleClusters} cycle clusters. ${plan.usedConnections} stored connections join these items; ${plan.omittedConnections} internal or outside-selection connections stay unchanged. Diagram: ${plan.frames.length} outlines / ${plan.connections.length} directed links. Apply layout changes positions only.`;
    } catch (error) { this.status.textContent = "Layout not prepared. Adjust the choices or select another area."; this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  private accept(): void {
    if (!this.current()) { this.invalidate(); return; }
    const plan = this.reviewed; if (!plan) { return; }
    try {
      if (JSON.stringify(this.settings()) !== JSON.stringify(plan.settings)) { this.choicesChanged(); return; }
      const focus = this.authority.apply(plan); this.close(); focus?.();
    } catch (error) { this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  override onClose(): void { this.retired = true; this.reviewed = null; this.events.abort(); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.authority.closed(); }
}
