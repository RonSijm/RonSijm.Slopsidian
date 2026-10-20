import type { App } from "./app";
import { Modal } from "./ui";
import type { TFile } from "./vault";
import { planSelectedNoteRenames, renameSelectedNotes, type SelectedNoteRenameOptions, type SelectedNoteRenamePlan } from "./explorer-rename";

/** Review exact in-place names; typing and cancellation never dispatch a rename. */
export class ExplorerRenameModal extends Modal {
  private busy = false;
  constructor(app: App, files: readonly TFile[], current: () => boolean, finished: (message: string) => void) {
    super(app);
    const root = app.vault.rootPath!, identities = files.map(file => ({ file, path: file.path }));
    this.setTitle("Rename selected notes"); this.containerEl.dataset.explorerRename = "";
    const form = document.createElement("form"), fields = {} as Record<keyof SelectedNoteRenameOptions, HTMLInputElement>;
    const labels: readonly [keyof SelectedNoteRenameOptions, string][] = [["find", "Find in note names"], ["replace", "Replace with"], ["prefix", "Prefix"], ["suffix", "Suffix"]];
    const description = document.createElement("p"); description.textContent = "Rename up to 20 selected Markdown notes in their current folders. Find replaces every exact, case-sensitive match in each filename; prefix and suffix are optional. The Markdown extension stays unchanged. Completed renames are kept if a later note fails; file renames are not editor Undo actions.";
    form.append(description);
    for (const [key, title] of labels) {
      const label = document.createElement("label"), input = fields[key] = document.createElement("input");
      input.type = "text"; input.maxLength = 256; input.dataset["explorerRename" + key[0].toUpperCase() + key.slice(1)] = ""; input.setAttribute("aria-label", title);
      Object.assign(input.style, { display: "block", width: "100%", minWidth: "0", boxSizing: "border-box" });
      label.append(document.createTextNode(title), input); form.append(label);
    }
    const update = document.createElement("input"), linkLabel = document.createElement("label");
    update.type = "checkbox"; update.checked = true; update.dataset.explorerRenameLinks = ""; linkLabel.append(update, document.createTextNode(" Update Markdown and Canvas links"));
    const preview = document.createElement("ul"), status = document.createElement("p"); preview.dataset.explorerRenamePreview = ""; preview.style.overflowWrap = "anywhere";
    status.dataset.explorerRenameStatus = ""; status.setAttribute("role", "status");
    const review = document.createElement("button"), rename = document.createElement("button"), cancel = document.createElement("button");
    review.type = cancel.type = "button"; rename.type = "submit"; review.textContent = "Review names"; rename.textContent = "Rename notes"; cancel.textContent = "Cancel";
    review.dataset.explorerRenameReview = ""; rename.dataset.explorerRenameConfirm = ""; cancel.dataset.explorerRenameCancel = ""; rename.disabled = true;
    let plan: SelectedNoteRenamePlan | null = null, links = true;
    const values = (): SelectedNoteRenameOptions => ({ find: fields.find.value, replace: fields.replace.value, prefix: fields.prefix.value, suffix: fields.suffix.value });
    const matches = (options: SelectedNoteRenameOptions): boolean => labels.every(([key]) => fields[key].value === options[key]) && update.checked === links;
    const owned = (): boolean => this.isOpen && this.containerEl.isConnected && current() && root === app.vault.rootPath
      && !app.changingVault && !app.vault.readOnly && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("file-explorer");
    const clear = (): void => { plan = null; rename.disabled = true; preview.replaceChildren(); status.textContent = ""; };
    for (const input of Object.values(fields)) { input.addEventListener("input", clear); input.addEventListener("change", clear); }
    update.addEventListener("change", clear);
    review.addEventListener("click", () => {
      clear();
      try {
        if (!owned() || app.workspace.isChangingFiles || identities.some(item => item.file.path !== item.path || app.vault.getFileByPath(item.path) !== item.file)) { throw new Error("The selected notes or Files pane changed. Close this dialog and select them again."); }
        plan = planSelectedNoteRenames(root, files, values(), app.vault.getAllLoadedFiles().map(file => file.path)); links = update.checked;
        for (const item of plan.items) { const row = document.createElement("li"); row.textContent = item.from + " → " + item.to; preview.append(row); }
        rename.disabled = false;
      } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    });
    cancel.addEventListener("click", () => this.close());
    const controls = [...Object.values(fields), update, review, rename, cancel];
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!plan || this.busy || rename.disabled) { return; }
      const selected = plan;
      if (!owned() || !matches(selected.options)) { clear(); status.textContent = "Review the current rename fields and link option again."; return; }
      this.busy = true; controls.forEach(control => { control.disabled = true; });
      void renameSelectedNotes(app, selected, links, () => owned() && matches(selected.options)).then(result => {
        const message = `Renamed ${result.renamed.length} of ${selected.items.length} notes.` + (result.error ? " " + result.error : "");
        plan = null; status.textContent = message; finished(message);
        if (result.error === null) { this.dispose(); }
      }).catch(error => { plan = null; status.textContent = error instanceof Error ? error.message : String(error); finished(status.textContent); }).finally(() => {
        this.busy = false; cancel.disabled = false; cancel.textContent = "Close";
        // A partial result must be reopened from a fresh selection; its review cannot replay.
        if (!current()) { this.dispose(); }
      });
    });
    Object.assign(form.style, { display: "grid", gap: "12px", minWidth: "0" });
    form.append(linkLabel, preview, status, review, rename, cancel); this.contentEl.append(form);
  }
  override close(): void { if (!this.busy) { super.close(); } }
  dispose(): void { super.close(); }
}
