import { Component } from "./plugin";
import { reportError } from "./dom";

export interface HoverLinkSource {
  display: string;
  defaultMod: boolean;
}

export interface HoverParent {
  hoverPopover: HoverPopover | null;
}

export interface HoverLinkEvent {
  event: MouseEvent;
  source: string;
  hoverParent: HoverParent;
  targetEl: Element | null;
  linktext: string;
  sourcePath?: string;
}

export class HoverPopover extends Component {
  readonly hoverEl = document.createElement("div");
  state = "showing";
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;
  private unloading: Promise<void> | null = null;

  constructor(readonly parent: HoverParent, readonly targetEl: Element | null, waitTime = 300, private readonly staticPos: { x: number; y: number } | null = null) {
    super();
    if (!Number.isFinite(waitTime) || waitTime < 0) { throw new Error("A hover delay must be a nonnegative finite number."); }
    parent.hoverPopover?.unload().catch(reportError);
    parent.hoverPopover = this;
    this.hoverEl.className = "popover hover-popover";
    this.hoverEl.popover = "manual";
    this.hoverEl.setAttribute("role", "dialog");
    this.hoverEl.setAttribute("aria-label", "Hover preview");
    document.body.append(this.hoverEl);
    this.register(() => {
      if (this.showTimer !== null) { clearTimeout(this.showTimer); }
      if (this.hideTimer !== null) { clearTimeout(this.hideTimer); }
      this.state = "hidden";
      this.hoverEl.remove();
      if (parent.hoverPopover === this) { parent.hoverPopover = null; }
    });
    const remain = (): void => {
      if (this.hideTimer !== null) { clearTimeout(this.hideTimer); this.hideTimer = null; }
      this.state = this.visible ? "shown" : "showing";
    };
    const leave = (event: Event): void => {
      const next = event instanceof MouseEvent ? event.relatedTarget : null;
      if (next instanceof Node && (this.hoverEl.contains(next) || targetEl?.contains(next))) { return; }
      if (!this.visible) { this.unload().catch(reportError); return; }
      if (this.hideTimer !== null) { clearTimeout(this.hideTimer); }
      this.state = "hiding";
      this.hideTimer = setTimeout(() => this.unload().catch(reportError), 250);
    };
    for (const element of [targetEl, this.hoverEl]) {
      if (element) {
        this.registerDomEvent(element, "pointerenter", remain);
        this.registerDomEvent(element, "pointerleave", leave);
      }
    }
    this.registerDomEvent(this.hoverEl, "focusin", remain);
    this.registerDomEvent(this.hoverEl, "focusout", leave);
    this.registerDomEvent(document, "keydown", event => {
      if (event instanceof KeyboardEvent && event.key === "Escape") { this.unload().catch(reportError); }
    }, true);
    this.registerDomEvent(document, "pointerdown", event => {
      if (event.target instanceof Node && !this.hoverEl.contains(event.target) && !targetEl?.contains(event.target)) { this.unload().catch(reportError); }
    }, true);
    this.registerDomEvent(window, "resize", () => this.position());
    const resize = new ResizeObserver(() => this.position());
    resize.observe(this.hoverEl);
    this.register(() => resize.disconnect());
    const removed = new MutationObserver(() => {
      if (targetEl && !targetEl.isConnected) { this.unload().catch(reportError); }
    });
    removed.observe(document.body, { childList: true, subtree: true });
    this.register(() => removed.disconnect());
    this.registerDomEvent(document, "scroll", event => {
      if (!(event.target instanceof Node) || !this.hoverEl.contains(event.target)) { this.unload().catch(reportError); }
    }, true);
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      if (this.state === "hidden" || this.state === "hiding") { return; }
      if (targetEl && !targetEl.isConnected) { this.unload().catch(reportError); return; }
      this.hoverEl.showPopover();
      this.visible = true;
      this.state = "shown";
      this.position();
      this.hoverEl.dispatchEvent(new Event("hover-shown"));
    }, waitTime);
    this.load().catch(reportError);
  }

  override unload(): Promise<void> {
    if (!this.unloading) {
      this.state = "hidden";
      this.unloading = super.unload();
    }
    return this.unloading;
  }

  position(): void {
    if (!this.visible || this.state === "hidden") { return; }
    const target = this.targetEl?.getBoundingClientRect();
    const bounds = this.hoverEl.getBoundingClientRect();
    const x = this.staticPos?.x ?? target?.left ?? 12;
    const y = this.staticPos?.y ?? (target ? target.bottom + 8 : 12);
    this.hoverEl.style.left = `${Math.max(12, Math.min(x, innerWidth - bounds.width - 12))}px`;
    this.hoverEl.style.top = `${Math.max(12, Math.min(y, innerHeight - bounds.height - 12))}px`;
  }
}
