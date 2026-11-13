import type { App } from "./app";
import { Modal } from "./ui";
import { TFolder, type TFile } from "./vault";
import { moveSelectedNotes, planSelectedNoteMoves, type SelectedNoteMovePlan } from "./explorer-move";

/** An explicit destination review; opening, typing and cancellation never move a note. */
export class ExplorerMoveModal extends Modal {
  private busy = false;
  constructor(app: App, files: readonly TFile[], current: () => boolean, finished: (message: string) => void, initialFolder?: TFolder) {
    super(app);
    const root = app.vault.rootPath!, identities = files.map(file => ({ file, path: file.path }));
    this.setTitle("Move selected notes"); this.containerEl.dataset.explorerMove = "";
    const form = document.createElement("form"), destination = document.createElement("select"), update = document.createElement("input");
    destination.dataset.explorerMoveFolder = ""; destination.setAttribute("aria-label", "Destination folder");
    const folders = app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder);
    if (!folders.includes(app.vault.getRoot())) { folders.unshift(app.vault.getRoot()); }
    const choices = folders.slice(0, 5000);
    if (initialFolder && !choices.includes(initialFolder)) { choices[choices.length - 1] = initialFolder; }
    for (const folder of choices.sort((a, b) => a.path.localeCompare(b.path))) {
      const option = document.createElement("option"); option.value = folder.isRoot() ? "" : folder.path; option.textContent = folder.isRoot() ? "/ (vault root)" : folder.path; destination.append(option);
    }
    if (initialFolder) {
      const path = initialFolder.isRoot() ? "" : initialFolder.path;
      if (initialFolder.vault !== app.vault || (path ? app.vault.getFolderByPath(path) : app.vault.getRoot()) !== initialFolder
        || !Array.from(destination.options).some(option => option.value === path)) { throw new Error("The dropped folder is no longer available in the destination chooser."); }
      destination.value = path;
    }
    update.type = "checkbox"; update.checked = true; update.dataset.explorerMoveLinks = "";
    const label = document.createElement("label"); label.append(update, document.createTextNode(" Update Markdown and Canvas links"));
    const description = document.createElement("p"); description.textContent = "Review exact destinations for up to 20 selected Markdown notes. Moves run in order; if one fails, earlier completed moves stay in their new locations. File moves are not editor Undo actions.";
    const preview = document.createElement("ul"), error = document.createElement("p"); preview.dataset.explorerMovePreview = "";
    preview.style.overflowWrap = "anywhere"; error.setAttribute("role", "status"); error.dataset.explorerMoveStatus = "";
    const review = document.createElement("button"), move = document.createElement("button"), cancel = document.createElement("button");
    review.type = cancel.type = "button"; move.type = "submit"; review.textContent = "Review destinations"; move.textContent = "Move notes"; cancel.textContent = "Cancel";
    review.dataset.explorerMoveReview = ""; move.dataset.explorerMoveConfirm = ""; cancel.dataset.explorerMoveCancel = ""; move.disabled = true;
    let plan: SelectedNoteMovePlan | null = null, links = true, completed = false;
    const owned = (): boolean => this.isOpen && this.containerEl.isConnected && current() && root === app.vault.rootPath
      && !app.changingVault && !app.vault.readOnly && !app.workspace.isChangingLayout && app.core.isEnabled("file-explorer");
    const clear = (): void => { plan = null; move.disabled = true; preview.replaceChildren(); error.textContent = ""; };
    destination.addEventListener("change", clear); update.addEventListener("change", clear);
    review.addEventListener("click", () => {
      clear();
      try {
        if (!owned() || app.workspace.isChangingFiles || app.core.busy || identities.some(item => item.file.path !== item.path || app.vault.getFileByPath(item.path) !== item.file)) { throw new Error("The selected notes or Files pane changed. Close this dialog and select them again."); }
        const folder = destination.value ? app.vault.getFolderByPath(destination.value) : app.vault.getRoot();
        if (!folder) { throw new Error("The destination folder is no longer available."); }
        plan = planSelectedNoteMoves(root, files, folder, app.vault.getAllLoadedFiles().map(file => file.path)); links = update.checked;
        for (const item of plan.items) { const row = document.createElement("li"); row.textContent = item.from + " → " + item.to; preview.append(row); }
        move.disabled = false;
      } catch (issue) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
    });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!plan || this.busy || move.disabled) { return; }
      const selected = plan;
      if (!owned() || destination.value !== selected.folderPath || update.checked !== links) { clear(); error.textContent = "Review the current destination and link option again."; return; }
      this.busy = true;
      for (const control of [destination, update, review, move, cancel]) { control.disabled = true; }
      void moveSelectedNotes(app, selected, links, () => owned() && destination.value === selected.folderPath && update.checked === links).then(result => {
        const message = `Moved ${result.moved.length} of ${selected.items.length} notes.` + (result.error ? " " + result.error : "");
        completed = result.error === null; error.textContent = message; finished(message);
        // A partial result cannot replay an already reviewed plan.
        plan = null;
        if (completed) { this.dispose(); }
      }).catch(issue => { plan = null; error.textContent = issue instanceof Error ? issue.message : String(issue); finished(error.textContent); }).finally(() => {
        this.busy = false;
        for (const control of [destination, update, cancel]) { control.disabled = false; }
        // A failed/partial review must be reopened from a fresh selection.
        review.disabled = true; move.disabled = true; cancel.textContent = "Close";
        if (!current()) { this.dispose(); }
      });
    });
    Object.assign(form.style, { display: "grid", gap: "12px" });
    form.append(description, destination, label, preview, error, review, move, cancel); this.contentEl.append(form);
  }
  override close(): void { if (!this.busy) { super.close(); } }
  dispose(): void { super.close(); }
}
