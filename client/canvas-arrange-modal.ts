import type { App } from "./app";
import { Modal } from "./ui";
import { canvasArrangeActions, type CanvasArrangeAction, type CanvasArrangement } from "./canvas-arrange";

export class CanvasArrangeModal extends Modal {
  private readonly error = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly confirmation = document.createElement("button");
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly events = new AbortController();
  private readonly refs: ReturnType<App["core"]["on"]>[] = [];
  private reviewed: CanvasArrangement | null = null;
  private retired = false;

  constructor(app: App, selected: number, private readonly authority: {
    current(): boolean;
    plan(action: CanvasArrangeAction): CanvasArrangement;
    apply(plan: CanvasArrangement): (() => void) | void;
    closed(): void;
  }) {
    super(app); this.setTitle("Arrange selection"); this.modalEl.dataset.canvasArrange = ""; this.modalEl.classList.add("canvas-arrange-modal");
    const help = document.createElement("p"), grid = document.createElement("div"), details = document.createElement("p"), cancel = document.createElement("button"), actions = document.createElement("div");
    help.textContent = `${selected} explicitly selected ${selected === 1 ? "card or frame" : "cards or frames"}. A selected group moves with every card fully inside it; nested selections count once. Each completed action has one Undo step.`;
    grid.className = "canvas-arrange-grid";
    for (const choice of canvasArrangeActions) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = choice.title; button.dataset.canvasArrangeAction = choice.id;
      button.addEventListener("click", () => this.accept(choice.id), { signal: this.events.signal }); this.buttons.push(button); grid.append(button);
    }
    details.textContent = "Align uses the outer selection bounds. Centers round to the nearest pixel, with half pixels toward the positive direction. Distribution keeps the outer cards fixed and shares whole-pixel gaps in visual order. Overlapping group families and changes to existing group membership are refused. New groups have 32 pixels of padding and an editable New group label. Ungroup retains the cards inside each selected frame.";
    details.className = "canvas-arrange-details";
    this.status.dataset.canvasArrangeStatus = ""; this.status.setAttribute("role", "status");
    this.error.className = "plugin-error"; this.error.dataset.canvasArrangeError = ""; this.error.setAttribute("role", "alert");
    this.confirmation.type = cancel.type = "button"; this.confirmation.hidden = true; this.confirmation.dataset.canvasArrangeConfirm = "";
    this.confirmation.addEventListener("click", () => this.confirm(), { signal: this.events.signal });
    cancel.textContent = "Cancel"; cancel.dataset.canvasArrangeCancel = ""; cancel.addEventListener("click", () => this.close(), { signal: this.events.signal });
    actions.className = "canvas-arrange-actions"; actions.append(this.confirmation, cancel);
    this.contentEl.append(help, grid, this.status, this.error, details, actions);
  }
  override onOpen(): void {
    this.refs.push(this.app.core.on("changed", () => { if (!this.authority.current()) { this.invalidate(); } }));
    if (!this.current()) { this.invalidate(); } else { this.buttons[0]?.focus(); }
  }
  private current(): boolean { return this.isOpen && this.containerEl.isConnected && !this.retired && this.authority.current(); }
  invalidate(): void {
    this.retired = true; this.reviewed = null; this.buttons.forEach(button => { button.disabled = true; }); this.confirmation.disabled = true;
    this.error.textContent = "This Canvas or its selection changed. Close Arrange selection and reopen it on the current cards. No arrangement was applied.";
  }
  private accept(action: CanvasArrangeAction): void {
    if (!this.current()) { this.invalidate(); return; }
    if (this.reviewed) { return; }
    try {
      const plan = this.authority.plan(action);
      if (!this.current()) { this.invalidate(); return; }
      if (plan.removedEdges.length) {
        this.reviewed = plan; this.error.textContent = "";
        this.status.textContent = `Ungroup will remove ${plan.removed.length} ${plan.removed.length === 1 ? "frame" : "frames"} and ${plan.removedEdges.length} ${plan.removedEdges.length === 1 ? "connection attached to those frames" : "connections attached to those frames"}. Cards inside the frames and their other connections will be retained. Undo restores the frames and their connections together.`;
        this.buttons.forEach(button => { button.disabled = true; }); this.confirmation.hidden = false;
        this.confirmation.textContent = "Ungroup and remove " + plan.removedEdges.length + (plan.removedEdges.length === 1 ? " connection" : " connections"); this.confirmation.focus();
      } else { this.apply(plan); }
    } catch (error) { this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  private confirm(): void {
    if (!this.current()) { this.invalidate(); return; }
    if (!this.reviewed) { return; }
    try { this.apply(this.reviewed); } catch (error) { this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  private apply(plan: CanvasArrangement): void {
    if (!this.current()) { this.invalidate(); return; }
    const focus = this.authority.apply(plan); this.close(); focus?.();
  }
  override onClose(): void {
    this.retired = true; this.reviewed = null; this.events.abort(); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.authority.closed();
  }
}
