import type { App } from "./app";
import { Modal } from "./ui";
import { canvasJumpChoices, type CanvasJumpChoice } from "./canvas-jump";

/** Owned navigation only. The board supplies authority and an immutable, bounded snapshot. */
export class CanvasJumpModal extends Modal {
  private readonly search = document.createElement("input");
  private readonly kind = document.createElement("select");
  private readonly results = document.createElement("select");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly events = new AbortController();
  private readonly refs: ReturnType<App["core"]["on"]>[] = [];
  private visible: CanvasJumpChoice[] = [];
  private retired = false;

  constructor(app: App, private readonly choices: readonly CanvasJumpChoice[], private readonly authority: {
    current(): boolean;
    apply(id: string): (() => void) | void;
    closed(): void;
  }) {
    super(app); this.setTitle("Jump to Canvas card"); this.modalEl.dataset.canvasJump = "";
    this.modalEl.classList.add("canvas-jump-modal");
    const help = document.createElement("p"), limits = document.createElement("p"), actions = document.createElement("div"), cancel = document.createElement("button");
    help.textContent = "Find an existing card or group, then center it on this Canvas. This changes only your selection and view.";
    limits.textContent = "Search checks the first 1,024 characters of each card’s text, path, address or group label. Up to 100 matches are shown. Very large cards stay centered at minimum zoom.";
    const label = (title: string, control: HTMLElement): HTMLLabelElement => { const element = document.createElement("label"); element.append(title, control); return element; };
    this.search.type = "search"; this.search.maxLength = 256; this.search.dataset.canvasJumpSearch = ""; this.search.setAttribute("aria-label", "Search Canvas cards and groups");
    this.kind.dataset.canvasJumpKind = ""; this.kind.setAttribute("aria-label", "Card type");
    for (const [value, title] of [["all", "All cards and groups"], ["Text card", "Text cards"], ["File card", "File cards"], ["Website", "Websites"], ["Group", "Groups"], ["Other card", "Other cards"]]) { const option = document.createElement("option"); option.value = value; option.textContent = title; this.kind.append(option); }
    this.results.size = 8; this.results.dataset.canvasJumpResults = ""; this.results.setAttribute("aria-label", "Matching Canvas cards");
    this.status.dataset.canvasJumpStatus = ""; this.status.setAttribute("role", "status");
    this.error.className = "plugin-error"; this.error.dataset.canvasJumpError = ""; this.error.setAttribute("role", "alert");
    this.action.type = cancel.type = "button"; this.action.textContent = "Jump to card"; this.action.dataset.canvasJumpApply = ""; cancel.textContent = "Cancel"; cancel.dataset.canvasJumpCancel = "";
    actions.className = "canvas-jump-actions"; actions.append(this.action, cancel);
    this.contentEl.append(help, label("Search cards", this.search), label("Card type", this.kind), label("Matches", this.results), this.status, this.error, limits, actions);
    const owned = { signal: this.events.signal };
    this.search.addEventListener("input", () => this.refresh(), owned);
    this.kind.addEventListener("change", () => this.refresh(), owned);
    this.results.addEventListener("change", () => this.updateAction(), owned);
    this.results.addEventListener("dblclick", () => this.accept(), owned);
    this.action.addEventListener("click", () => this.accept(), owned); cancel.addEventListener("click", () => this.close(), owned);
    this.contentEl.addEventListener("keydown", event => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) { return; }
      if (event.key === "Enter" && (event.target === this.search || event.target === this.results)) { event.preventDefault(); event.stopPropagation(); this.accept(); }
      else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === this.search && this.visible.length) {
        event.preventDefault(); event.stopPropagation(); this.results.focus();
        this.results.selectedIndex = event.key === "ArrowDown" ? 0 : this.visible.length - 1; this.updateAction();
      }
    }, owned);
  }
  override onOpen(): void {
    this.refs.push(this.app.core.on("changed", () => { if (!this.authority.current()) { this.invalidate(); } }));
    this.refresh(); this.search.focus();
  }
  private current(): boolean { return this.isOpen && this.containerEl.isConnected && !this.retired && this.authority.current(); }
  invalidate(): void {
    this.retired = true; this.action.disabled = true; this.search.disabled = this.kind.disabled = this.results.disabled = true;
    this.error.textContent = "This Canvas changed. Close Jump and search its current cards again.";
  }
  private refresh(): void {
    if (!this.current()) { this.invalidate(); return; }
    try {
      const selected = this.results.value, result = canvasJumpChoices(this.choices, this.search.value, this.kind.value);
      this.visible = result.values; this.results.replaceChildren();
      for (const choice of this.visible) { const option = document.createElement("option"); option.value = choice.id; option.textContent = choice.label; this.results.append(option); }
      this.results.value = this.visible.some(choice => choice.id === selected) ? selected : this.visible[0]?.id ?? "";
      this.results.disabled = !this.visible.length;
      this.status.textContent = !result.total ? "No matching cards or groups." : result.total > this.visible.length ? "Showing 100 of " + result.total + " matching cards and groups. Refine your search." : result.total + " matching cards and groups.";
      if (result.fuzzyExhausted) { this.status.textContent += " The fuzzy search limit was reached; refine the search for more matches."; }
      this.error.textContent = ""; this.updateAction();
    } catch (error) { this.visible = []; this.results.replaceChildren(); this.action.disabled = true; this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  private updateAction(): void { this.action.disabled = !this.current() || !this.visible.some(choice => choice.id === this.results.value); }
  private accept(): void {
    if (!this.current()) { this.invalidate(); return; }
    const selected = this.visible.find(choice => choice.id === this.results.value);
    if (!selected) { this.action.disabled = true; return; }
    try { const focus = this.authority.apply(selected.id); this.close(); focus?.(); }
    catch (error) { this.action.disabled = true; this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  override onClose(): void {
    this.retired = true; this.visible = []; this.events.abort(); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.authority.closed();
  }
}
