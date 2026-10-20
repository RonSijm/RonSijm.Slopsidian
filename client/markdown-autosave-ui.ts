import type { App } from "./app";
import { element } from "./dom";
import { Modal } from "./ui";
import { markdownSaveError } from "./markdown-autosave";

/** Persistent save state in the shared status bar, with explicit failure recovery. */
export class MarkdownAutosaveUI {
  private readonly toggle = document.createElement("button");
  private readonly failures = document.createElement("button");
  private modal: Modal | null = null;

  constructor(private readonly app: App) {
    this.toggle.id = "markdown-autosave-toggle"; this.toggle.type = "button";
    this.failures.id = "markdown-autosave-errors"; this.failures.type = "button"; this.failures.hidden = true;
    element("markdown-autosave-status").append(this.toggle, this.failures);
    app.markdownAutosave.onChange = () => this.update();
    this.toggle.addEventListener("click", () => { this.app.markdownAutosave.setEnabled(!this.app.markdownAutosave.enabled).catch(() => this.openErrors()); });
    this.failures.addEventListener("click", () => this.openErrors());
    app.commands.install([{ id: "editor:review-save-failures", name: "Review unsaved Markdown notes", callback: () => this.openErrors() }]);
    app.registerLeaveGuard(() => this.modal?.close());
    this.update();
  }

  update(): void {
    const save = this.app.markdownAutosave, count = save.dirtyCount, errors = save.errors().length + (save.settingError ? 1 : 0);
    const label = save.toggling ? "Changing autosave…" : save.saving ? "Saving Markdown…" : !save.enabled ? "Autosave paused" + (count ? " · " + count + " unsaved" : "") : save.errors().length ? "Markdown save failed" : count ? "Autosave pending" : "Autosave on";
    if (this.toggle.textContent !== label) { this.toggle.textContent = label; }
    this.toggle.title = save.enabled ? "Pause automatic Markdown saves. Explicit Save remains available." : "Resume automatic Markdown saves.";
    this.toggle.disabled = this.app.vault.readOnly || !this.app.vault.rootPath || this.app.changingVault || save.toggling;
    this.toggle.setAttribute("aria-label", label + (count ? "; " + count + " unsaved note(s)" : ""));
    this.toggle.dataset.enabled = String(save.enabled);
    this.failures.hidden = errors === 0;
    const failureText = errors + " save issue(s)";
    if (this.failures.textContent !== failureText) { this.failures.textContent = failureText; }
    this.failures.title = "Review unsaved notes and retry failed saves";
  }

  openErrors(): void {
    this.modal?.close();
    const modal = this.modal = new Modal(this.app); modal.setTitle("Markdown save status"); modal.containerEl.dataset.markdownSaveStatus = "";
    const paragraph = (parent: HTMLElement, value: string): void => { const node = document.createElement("p"); node.textContent = value; parent.append(node); };
    paragraph(modal.contentEl, "Failed saves keep your unsaved text in the editor. Automatic retry stops for that note until you save successfully or explicitly reload it from disk.");
    paragraph(modal.contentEl, "If the file changed on disk, open the note and copy any edits you want to keep before using Reload from disk.");
    const status = document.createElement("p"); status.setAttribute("role", "status"); status.dataset.autosaveResult = ""; modal.contentEl.append(status);
    const root = this.app.vault.rootPath;
    const valid = (): boolean => modal.isOpen && root === this.app.vault.rootPath && !this.app.changingVault;
    if (this.app.markdownAutosave.settingError) {
      paragraph(modal.contentEl, this.app.markdownAutosave.settingError);
      const desired = this.app.markdownAutosave.pendingPreference;
      if (desired !== null) {
        const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry autosave preference"; retry.dataset.autosavePreferenceRetry = "";
        retry.addEventListener("click", () => {
          if (!valid()) { return; } retry.disabled = true;
          this.app.markdownAutosave.setEnabled(desired).then(() => { if (valid()) { status.textContent = "Autosave preference saved."; } })
            .catch(error => { if (valid()) { status.textContent = markdownSaveError(error); } }).finally(() => { if (valid()) { retry.disabled = false; } });
        }); modal.contentEl.append(retry);
      }
    }
    const failures = this.app.markdownAutosave.errors();
    if (!failures.length && !this.app.markdownAutosave.settingError) { paragraph(modal.contentEl, "No Markdown save failures are currently recorded."); }
    for (const failure of failures) {
      const section = document.createElement("section"); section.dataset.autosaveFailure = failure.session.document.file.path;
      const title = document.createElement("h3"); title.textContent = failure.session.document.file.path; section.append(title);
      paragraph(section, failure.message);
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry save"; retry.dataset.autosaveRetry = failure.session.document.file.path;
      retry.addEventListener("click", () => {
        if (!valid() || !this.app.markdownAutosave.owns(failure.session)) { return; }
        retry.disabled = true;
        failure.session.save().then(() => { if (valid()) { status.textContent = "Saved " + failure.session.document.file.path + "."; section.remove(); } })
          .catch(error => { if (valid()) { status.textContent = "Save failed; your text is still in the editor. " + markdownSaveError(error); } })
          .finally(() => { if (valid()) { retry.disabled = false; } });
      });
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Open note"; open.dataset.autosaveOpen = failure.session.document.file.path;
      open.addEventListener("click", () => {
        if (!valid() || !this.app.markdownAutosave.owns(failure.session) || this.app.workspace.isChangingFiles || this.app.workspace.isChangingLayout) { return; }
        const leaf = this.app.workspace.leaves().find(leaf => leaf.session === failure.session);
        modal.close();
        // Selecting a retained pane must not retry an unrelated failed save.
        if (leaf) { this.app.workspace.setActiveLeaf(leaf); leaf.view.focus(); }
      });
      section.append(retry, open); modal.contentEl.append(section);
    }
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    modal.open();
  }
}
