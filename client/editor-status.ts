import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import type { MarkdownEditingMode } from "./contracts";
import { element } from "./dom";
import { icon } from "./icons";
import { Menu } from "./menu";
import { MarkdownView } from "./workspace";

const modes: readonly { mode: MarkdownEditingMode; label: string; icon: string }[] = [
  { mode: "preview", label: "Reading view", icon: "book" },
  { mode: "source", label: "Source mode", icon: "command" },
  { mode: "live-preview", label: "Live Preview", icon: "edit" },
];

export class EditorStatus {
  readonly id = "editor-status";
  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return {}; }

  register(core: CorePlugins): void { core.register(this.id, () => this.enable(), this); }
  getActiveView(): MarkdownView | null { return this.app.workspace.getActiveViewOfType(MarkdownView); }
  getStatus(): MarkdownEditingMode | "" {
    const view = this.getActiveView();
    return view?.file ? view.getEditingMode() : "";
  }
  setStatus(mode: MarkdownEditingMode): void {
    const view = this.getActiveView();
    if (!view?.file || !view.isLoaded || !this.app.core.isEnabled(this.id) || this.app.changingVault || this.app.workspace.isChangingFiles) {
      throw new Error("Activate an available Markdown note before changing its editing mode.");
    }
    view.setEditingMode(mode);
  }

  private enable(): () => void {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "status-bar-item editor-status-control";
    control.setAttribute("aria-haspopup", "menu");
    const events = new AbortController();
    let alive = true;
    let menu: Menu | null = null;
    const update = (): void => {
      const mode = this.getStatus();
      control.hidden = !mode;
      control.dataset.editorStatus = mode;
      const selected = modes.find(value => value.mode === mode);
      control.replaceChildren(...selected ? [icon(selected.icon), document.createTextNode(selected.label)] : []);
      control.title = selected?.label ?? "Editor mode";
      control.setAttribute("aria-label", selected ? "Editor mode: " + selected.label : "Editor mode");
      menu?.hide();
    };
    const show = (event: MouseEvent): void => {
      const view = this.getActiveView(), file = view?.file, root = this.app.vault.rootPath;
      if (!alive || !view || !file || !root || this.app.changingVault) { return; }
      event.preventDefault();
      menu?.hide();
      const created = new Menu();
      menu = created;
      created.dom.dataset.editorModeMenu = view.leaf.id;
      created.onHide(() => { if (menu === created) { menu = null; } });
      for (const item of modes) {
        created.addItem(entry => entry.setTitle(item.label).setIcon(item.icon).setChecked(view.getEditingMode() === item.mode).onClick(() => {
          if (!alive || this.getActiveView() !== view || view.file !== file || this.app.vault.rootPath !== root) { return; }
          this.setStatus(item.mode);
        }));
      }
      created.showAtMouseEvent(event);
    };
    control.addEventListener("click", show, { signal: events.signal });
    control.addEventListener("contextmenu", show, { signal: events.signal });
    const refs = ["layout-change", "active-leaf-change", "file-open"].map(name => this.app.workspace.on(name, update));
    element("plugin-status-bar").append(control);
    update();
    return () => {
      alive = false;
      events.abort();
      for (const ref of refs) { ref.emitter.offref(ref); }
      menu?.hide(); menu = null;
      control.remove();
    };
  }
}
