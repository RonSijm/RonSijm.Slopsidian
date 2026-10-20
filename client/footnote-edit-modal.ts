import type { App } from "./app";
import { Editor } from "./editor";
import { Modal } from "./ui";

/** A local draft, committed through the owning pane's guarded Apply operation. */
export class FootnoteEditModal extends Modal {
  private editor: Editor | null = null;
  private readonly applyButton = document.createElement("button");
  private readonly error = document.createElement("p");
  private readonly source = document.createElement("div");
  private readonly listeners = new AbortController();
  private busy = false;

  constructor(app: App, readonly path: string, readonly id: string, private readonly initial: string,
    private readonly apply: (content: string, current: () => boolean) => Promise<void>, private readonly closed: () => void, inline = false) {
    super(app);
    this.setTitle(inline ? "Edit inline footnote" : "Edit footnote [^" + id + "]");
    this.modalEl.classList.add("footnote-edit-modal"); this.modalEl.dataset.footnoteEditDialog = "true";
    const summary = document.createElement("p"); summary.textContent = "Edit the definition in " + path + ". " + (inline ? "Soft line breaks are allowed within one paragraph. " : "") + "Apply updates the note in one undo step; Cancel discards this draft.";
    this.source.className = "footnote-edit-source";
    this.error.className = "plugin-error"; this.error.setAttribute("role", "alert"); this.error.dataset.footnoteEditError = "true";
    const actions = document.createElement("div"); actions.className = "modal-button-container";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.footnoteEditAction = "cancel";
    this.applyButton.type = "button"; this.applyButton.textContent = "Apply to note"; this.applyButton.dataset.footnoteEditAction = "apply";
    actions.append(cancel, this.applyButton); this.contentEl.append(summary, this.source, this.error, actions);
    cancel.addEventListener("click", () => this.close(), { signal: this.listeners.signal });
    this.applyButton.addEventListener("click", () => { void this.submit(); }, { signal: this.listeners.signal });
    this.scope.register(["Mod"], "Enter", () => { void this.submit(); return false; });
  }

  override onOpen(): void {
    this.editor = new Editor(this.source, () => {}, async () => { await this.submit(); }, () => {});
    this.editor.setDocument(this.initial); this.editor.cm.contentDOM.setAttribute("aria-label", "Footnote definition");
    this.editor.focus();
  }

  private async submit(): Promise<void> {
    if (!this.isOpen || this.busy || !this.editor) { return; }
    const content = this.editor.getValue();
    this.busy = true; this.applyButton.disabled = true; this.editor.setMutationLock(true); this.editor.setEditable(false); this.error.textContent = "";
    try {
      await this.apply(content, () => this.isOpen);
      this.close();
    } catch (error) {
      if (this.isOpen) { this.error.textContent = error instanceof Error ? error.message : String(error); }
    } finally {
      this.busy = false;
      if (this.isOpen) { this.applyButton.disabled = false; this.editor?.setMutationLock(false); this.editor?.setEditable(true); }
    }
  }

  override onClose(): void {
    this.listeners.abort(); this.editor?.destroy(); this.editor = null; this.closed();
  }
}
