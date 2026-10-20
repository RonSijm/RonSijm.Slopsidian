import type { App } from "./app";
import type { TFile } from "./vault";
import { Modal } from "./ui";
import { reviewSelectedNoteTrash, trashSelectedNotes, type SelectedNoteRemovalMode, type SelectedNoteTrashPlan } from "./explorer-trash";

/** Explicit removal review; every opening defaults to recoverable vault-local trash. */
export class ExplorerTrashModal extends Modal {
  private busy = false;
  private generation = 0;
  constructor(app: App, files: readonly TFile[], current: () => boolean, finished: (message: string) => void) {
    super(app); this.setTitle("Remove selected notes"); this.containerEl.dataset.explorerTrash = "";
    const root = app.vault.rootPath, identities = files.map(file => ({ file, path: file.path }));
    const form = document.createElement("form"), description = document.createElement("p"), preview = document.createElement("ul"), status = document.createElement("p");
    const mode = document.createElement("select"), modeLabel = document.createElement("label");
    mode.dataset.explorerTrashMode = ""; mode.setAttribute("aria-label", "Removal method");
    const modes: [SelectedNoteRemovalMode, string][] = [["vault", "Vault trash (.trash)"]];
    if (app.vault.supportsSystemTrash) { modes.push(["system", "System trash (Recycle Bin)"]); }
    modes.push(["permanent", "Delete permanently"]);
    for (const [value, title] of modes) { const option = document.createElement("option"); option.value = value; option.textContent = title; mode.append(option); }
    mode.value = "vault"; modeLabel.append(document.createTextNode("Removal method "), mode);
    const acknowledge = document.createElement("input"), acknowledgement = document.createElement("label");
    acknowledge.type = "checkbox"; acknowledge.dataset.explorerTrashAcknowledge = "";
    acknowledgement.append(acknowledge, document.createTextNode(" I understand that permanent deletion cannot be undone.")); acknowledgement.hidden = true;
    preview.dataset.explorerTrashPreview = ""; preview.style.overflowWrap = "anywhere"; status.dataset.explorerTrashStatus = ""; status.setAttribute("role", "status");
    const review = document.createElement("button"), confirm = document.createElement("button"), cancel = document.createElement("button");
    review.type = cancel.type = "button"; confirm.type = "submit";
    review.textContent = "Review selected notes"; confirm.textContent = "Move notes to vault trash"; cancel.textContent = "Cancel";
    review.dataset.explorerTrashReview = ""; confirm.dataset.explorerTrashConfirm = ""; cancel.dataset.explorerTrashCancel = ""; confirm.disabled = true;
    let plan: SelectedNoteTrashPlan | null = null;
    const owned = (): boolean => this.isOpen && this.containerEl.isConnected && current() && root === app.vault.rootPath && !app.vault.readOnly;
    const fresh = (): boolean => owned() && identities.every(item => item.file.path === item.path && app.vault.getFileByPath(item.path) === item.file);
    const matches = (selected: SelectedNoteTrashPlan): boolean => mode.value === selected.mode
      && (selected.mode !== "system" || app.vault.supportsSystemTrash) && (selected.mode !== "permanent" || acknowledge.checked);
    const updateConfirm = (): void => {
      confirm.disabled = this.busy || !plan || !fresh() || !matches(plan);
      if (plan && !this.busy && fresh() && mode.value === plan.mode) {
        status.textContent = `${plan.items.length} saved notes reviewed. The current versions will be checked again before removal.`
          + (plan.mode === "permanent" && !acknowledge.checked ? " Acknowledge permanent deletion to enable Delete notes permanently." : "");
      }
    };
    const describe = (): void => {
      acknowledgement.hidden = mode.value !== "permanent";
      const destination = mode.value === "permanent"
        ? "permanently deleting them. They bypass vault and system trash and cannot be recovered from .trash."
        : mode.value === "system" ? "moving them to the Windows Recycle Bin. Restore them from the Recycle Bin."
        : "moving them to the vault’s .trash folder. Notes can be recovered manually from .trash.";
      description.textContent = "Review 1–20 saved Markdown notes before " + destination
        + " Open views of removed notes close. Incoming links may become unresolved; attachments stay in place. File removals are not editor Undo actions. If a later removal fails, completed removals are kept.";
      confirm.textContent = mode.value === "permanent" ? "Delete notes permanently" : mode.value === "system" ? "Move notes to system trash" : "Move notes to vault trash";
    };
    mode.addEventListener("change", () => {
      if (this.busy) { return; }
      ++this.generation; plan = null; acknowledge.checked = false; confirm.disabled = true; review.disabled = false; preview.replaceChildren();
      status.textContent = "Review the selected notes again for this removal method."; describe();
    });
    acknowledge.addEventListener("change", updateConfirm);
    describe();
    review.addEventListener("click", () => {
      if (this.busy || review.disabled) { return; }
      const selectedMode = mode.value as SelectedNoteRemovalMode;
      const generation = ++this.generation; plan = null; confirm.disabled = true; review.disabled = true; preview.replaceChildren(); status.textContent = "Checking selected notes…";
      void reviewSelectedNoteTrash(app, files, fresh, selectedMode).then(value => {
        if (generation !== this.generation || !fresh() || mode.value !== selectedMode) { return; }
        plan = value;
        const destination = value.mode === "permanent" ? "permanent deletion" : value.mode === "system" ? "system trash" : ".trash";
        for (const item of value.items) { const row = document.createElement("li"); row.textContent = item.path + " → " + destination; preview.append(row); }
        updateConfirm();
      }).catch(error => { if (generation === this.generation && owned()) { status.textContent = error instanceof Error ? error.message : String(error); } })
        .finally(() => { if (generation === this.generation && owned()) { review.disabled = false; } });
    });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", event => {
      event.preventDefault(); if (this.busy || !plan || confirm.disabled) { return; }
      const selected = plan;
      if (!fresh() || !matches(selected)) { plan = null; confirm.disabled = true; status.textContent = "The selection, removal method or Files pane changed. Review the selected notes again."; return; }
      this.busy = true; ++this.generation; for (const control of [mode, acknowledge, review, confirm, cancel]) { control.disabled = true; }
      void trashSelectedNotes(app, selected, () => owned() && matches(selected), acknowledge.checked).then(result => {
        const destination = selected.mode === "permanent" ? "permanently deleted" : selected.mode === "system" ? "moved to system trash" : "moved to vault trash";
        const message = `Confirmed ${result.trashed.length} of ${selected.items.length} notes ${destination}.` + (result.error ? " " + result.error : "");
        plan = null; status.textContent = message; finished(message);
        if (!result.error) { this.dispose(); }
      }).catch(error => { plan = null; status.textContent = error instanceof Error ? error.message : String(error); finished(status.textContent); })
        .finally(() => { this.busy = false; cancel.disabled = false; cancel.textContent = "Close"; if (!current()) { this.dispose(); } });
    });
    Object.assign(form.style, { display: "grid", gap: "12px", minWidth: "0" }); form.append(modeLabel, description, acknowledgement, preview, status, review, confirm, cancel); this.contentEl.append(form);
  }
  override close(): void { if (!this.busy) { ++this.generation; super.close(); } }
  dispose(): void { ++this.generation; super.close(); }
}
