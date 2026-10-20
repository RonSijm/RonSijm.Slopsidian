export class ResponsiveViewPanel {
  private expanded: boolean | null = null;
  private disposed = false;
  private readonly changed = (event: Event): void => {
    if (event instanceof ToggleEvent && event.newState === "closed" && this.root.classList.contains("is-compact") && !this.panel.hidden && this.root.checkVisibility()) {
      this.expanded = false;
    }
  };

  constructor(private readonly root: HTMLElement, private readonly panel: HTMLElement, private readonly breakpoint: number) {
    panel.classList.add("responsive-view-panel");
    panel.addEventListener("toggle", this.changed);
  }
  bindToggle(button: HTMLButtonElement): void {
    this.panel.id ||= "view-panel-" + crypto.randomUUID();
    button.setAttribute("popovertarget", this.panel.id);
    button.addEventListener("click", event => event.preventDefault());
  }
  toggle(): void { this.expanded = !this.panel.checkVisibility(); this.resize(); }
  open(): void { this.expanded = true; this.resize(); }
  resize(): void {
    if (this.disposed) { return; }
    const compact = this.root.clientWidth < this.breakpoint;
    this.root.classList.toggle("is-compact", compact);
    const visible = this.root.checkVisibility() && (this.expanded ?? !compact);
    this.panel.hidden = !visible;
    if (compact) {
      this.panel.setAttribute("popover", "auto");
      if (visible) {
        const box = this.root.getBoundingClientRect();
        const top = Math.max(8, Math.min(box.top + 42, window.innerHeight - 320));
        this.panel.style.left = Math.max(8, Math.min(box.right - 280, window.innerWidth - 288)) + "px";
        this.panel.style.top = top + "px";
        this.panel.style.maxHeight = Math.max(150, window.innerHeight - top - 12) + "px";
        if (!this.panel.matches(":popover-open")) { this.panel.showPopover(); }
      } else if (this.panel.matches(":popover-open")) { this.panel.hidePopover(); }
    } else {
      if (this.panel.matches(":popover-open")) { this.panel.hidePopover(); }
      this.panel.removeAttribute("popover");
      for (const name of ["left", "top", "max-height"]) { this.panel.style.removeProperty(name); }
    }
  }
  destroy(): void {
    this.disposed = true;
    this.panel.removeEventListener("toggle", this.changed);
    if (this.panel.matches(":popover-open")) { this.panel.hidePopover(); }
  }
}
