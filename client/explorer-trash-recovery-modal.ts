import type { App } from "./app";
import type { VaultTrashEntry, VaultTrashPreview } from "./contracts";
import { TFolder } from "./vault";
import { Modal } from "./ui";
import { reviewTrashRecovery, restoreTrashRecovery, type TrashRecoveryPlan } from "./explorer-trash-recovery";

/** Browsing and previews are inert; only a separate reviewed confirmation restores. */
export class ExplorerTrashRecoveryModal extends Modal {
  private busy = false;
  private generation = 0;
  constructor(app: App, current: () => boolean, finished: (message: string) => void) {
    super(app); this.setTitle("Recover notes from vault trash"); this.containerEl.dataset.trashRecovery = "";
    const root = app.vault.rootPath, form = document.createElement("form"), description = document.createElement("p"), list = document.createElement("div"), preview = document.createElement("pre"), reviewList = document.createElement("ul"), status = document.createElement("p");
    description.textContent = "Browse up to 500 UTF-8 Markdown notes of at most 1 MiB in this vault’s flat .trash folder. Stored filenames are retained; original folders are not recorded. Preview one note, then download an exact copy. Browser downloads leave vault trash untouched; Windows desktop also supports reviewed restores into an existing folder.";
    const capability = document.createElement("p"); capability.dataset.trashRecoveryCapability = "";
    const search = document.createElement("input"), folder = document.createElement("select"), refresh = document.createElement("button"), review = document.createElement("button"), confirm = document.createElement("button"), cancel = document.createElement("button"), download = document.createElement("button");
    search.type = "search"; search.placeholder = "Filter trash notes…"; search.setAttribute("aria-label", "Filter trash notes"); search.dataset.trashRecoverySearch = "";
    folder.setAttribute("aria-label", "Restore into existing folder"); folder.dataset.trashRecoveryFolder = "";
    refresh.type = review.type = cancel.type = "button"; confirm.type = "submit";
    download.type = "button";
    for (const [button, name, text] of [[refresh, "refresh", "Refresh trash"], [review, "review", "Review restore destinations"], [confirm, "confirm", "Restore notes"], [cancel, "cancel", "Cancel"], [download, "download", "Download copy"]] as const) { button.textContent = text; button.setAttribute("data-trash-recovery-" + name, ""); }
    list.dataset.trashRecoveryEntries = ""; preview.dataset.trashRecoveryPreview = ""; preview.tabIndex = 0; preview.style.whiteSpace = "pre-wrap"; preview.style.overflowWrap = "anywhere"; preview.style.maxHeight = "220px"; preview.style.overflow = "auto";
    list.style.maxHeight = "220px"; list.style.overflow = "auto"; reviewList.dataset.trashRecoveryDestinations = ""; reviewList.style.overflowWrap = "anywhere";
    status.dataset.trashRecoveryStatus = ""; status.setAttribute("role", "status");
    Object.assign(form.style, { display: "grid", gap: "10px", minWidth: "0" }); form.append(description, capability, search, refresh, list, folder, preview, download, reviewList, status, review, confirm, cancel); this.contentEl.append(form);
    let entries: VaultTrashEntry[] = [], selected = new Set<string>(), plan: TrashRecoveryPlan | null = null, previewed: VaultTrashPreview | null = null, previewRevision = 0, canRestore = false;
    const owned = (): boolean => this.isOpen && this.containerEl.isConnected && current() && root === app.vault.rootPath && !app.vault.readOnly;
    const selectedEntries = (): VaultTrashEntry[] => entries.filter(entry => selected.has(entry.path));
    const state = (): string => JSON.stringify([folder.value, selectedEntries().map(entry => [entry.path, entry.token])]);
    const invalidate = (): void => { ++this.generation; plan = null; confirm.disabled = true; reviewList.replaceChildren(); };
    const controls = (): void => { review.disabled = this.busy || !owned() || !canRestore || selected.size < 1 || selected.size > 20; confirm.disabled = this.busy || !plan || !owned() || !canRestore; download.disabled = this.busy || !owned() || !previewed; };
    const draw = (): void => {
      list.replaceChildren(); const term = search.value.toLocaleLowerCase();
      for (const entry of entries.filter(entry => entry.name.toLocaleLowerCase().includes(term))) {
        const row = document.createElement("div"), label = document.createElement("label"), check = document.createElement("input"), inspect = document.createElement("button");
        check.type = "checkbox"; check.checked = selected.has(entry.path); check.disabled = !canRestore; check.dataset.trashRecoveryEntry = entry.path; check.setAttribute("aria-label", "Select " + entry.name);
        label.append(check, document.createTextNode(" " + entry.name + " (" + entry.size + " bytes)"));
        inspect.type = "button"; inspect.textContent = "Preview"; inspect.dataset.trashRecoveryInspect = entry.path;
        check.addEventListener("change", () => { if (this.busy || !owned() || !canRestore) return; invalidate(); check.checked ? selected.add(entry.path) : selected.delete(entry.path); status.textContent = selected.size + " trash notes selected."; controls(); });
        inspect.addEventListener("click", () => { if (this.busy || !owned()) return; previewed = null; controls(); const generation = this.generation, revision = ++previewRevision; void app.vault.previewTrash(entry).then(value => { if (generation === this.generation && revision === previewRevision && owned()) { previewed = value; preview.textContent = value.content; status.textContent = entry.name + ": exact saved UTF-8 preview" + (value.hasBom ? " with BOM." : "."); controls(); } }).catch(error => { if (generation === this.generation && revision ===previewRevision && owned()) { status.textContent = error instanceof Error ? error.message : String(error); controls(); } }); });
        row.append(label, inspect); list.append(row);
      }
      controls();
    };
    const load = async (): Promise<void> => {
      if (!owned()) return; invalidate(); const generation = this.generation; selected.clear(); previewed = null; preview.textContent = ""; controls(); refresh.disabled = true; search.disabled = true; folder.disabled = true; list.replaceChildren(); status.textContent = "Reading local vault trash…";
      try {
        const result = await app.vault.listTrash(); if (!owned() || generation !== this.generation) return;
        entries = result.entries; canRestore = result.canRestore && app.vault.supportsTrashRestore; folder.replaceChildren();
        capability.textContent = canRestore ? "Windows desktop: restore 1–20 selected notes after reviewing exact destinations. Existing destinations are refused without overwrite or automatic renaming." : "Browser recovery downloads copies. Restoring into a vault folder requires the Windows desktop host. Downloading keeps every trash entry in place.";
        const folders = [app.vault.getRoot(), ...app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())].sort((a, b) => a.path.localeCompare(b.path));
        for (const target of folders) { const option = document.createElement("option"); option.value = target.path; option.textContent = target.isRoot() ? "Vault root" : target.path; folder.append(option); } folder.value = "/";
        status.textContent = entries.length + " recoverable Markdown notes. " + result.ignored + " folders, unsupported, unsafe or oversized entries omitted without changes."; draw();
      } catch (error) { if (owned() && generation === this.generation) status.textContent = error instanceof Error ? error.message : String(error); }
      finally { if (owned() && generation === this.generation) { refresh.disabled = search.disabled = false; folder.disabled = !canRestore; controls(); } }
    };
    this.onOpen = () => { void load(); };
    search.addEventListener("input", () => { if (this.busy || !owned()) return; invalidate(); selected.clear(); previewed = null; preview.textContent = ""; draw(); status.textContent = canRestore ? "Filter changed. Select notes and review again." : "Filter changed. Preview a note to download an exact copy."; });
    folder.addEventListener("change", () => { if (this.busy || !owned()) return; invalidate(); controls(); status.textContent = "Destination changed. Review restore destinations again."; });
    refresh.addEventListener("click", () => { if (!this.busy) void load(); });
    review.addEventListener("click", () => {
      if (this.busy || review.disabled || !owned() || !canRestore) return;
      invalidate(); const generation = this.generation, selection = state(), target = app.vault.getFolderByPath(folder.value); review.disabled = true;
      if (!target) { status.textContent = "Choose an existing vault folder."; return; }
      void reviewTrashRecovery(app, selectedEntries(), target, () => owned() && selection === state()).then(value => {
        if (!owned() || generation !== this.generation || selection !== state()) return; plan = value;
        for (const item of value.review.items) { const row = document.createElement("li"); row.textContent = item.trashPath + " → " + item.newPath; reviewList.append(row); }
        status.textContent = value.review.items.length + " saved trash notes reviewed. No files have changed. Restore notes confirms these exact destinations."; controls();
      }).catch(error => { if (owned() && generation === this.generation) status.textContent = error instanceof Error ? error.message : String(error); }).finally(() => { if (owned() && generation === this.generation) controls(); });
    });
    form.addEventListener("submit", event => {
      event.preventDefault(); if (this.busy || confirm.disabled || !plan || !owned() || !canRestore) return;
      const accepted = plan, selection = state(); this.busy = true; ++this.generation;
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) control.disabled = true;
      void restoreTrashRecovery(app, accepted, () => owned() && selection === state()).then(result => {
        plan = null; const message = `Confirmed ${result.restored.length} of ${accepted.review.items.length} notes restored.` + (result.error ? " " + result.error : ""); status.textContent = message; finished(message);
        if (!result.error) this.dispose();
      }).catch(error => { plan = null; status.textContent = error instanceof Error ? error.message : String(error); finished(status.textContent); }).finally(() => { this.busy = false; cancel.disabled = false; cancel.textContent = "Close"; if (!current()) this.dispose(); });
    });
    download.addEventListener("click", () => {
      if (this.busy || download.disabled || !previewed || !owned()) return;
      const accepted = previewed; invalidate(); const generation = this.generation; this.busy = true;
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) control.disabled = true;
      void app.vault.readTrashCopy(accepted.entry, accepted.version).then(bytes => {
        if (!owned() || generation !== this.generation) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: "text/markdown;charset=utf-8" }));
        try { const link = document.createElement("a"); link.href = url; link.download = accepted.entry.name; link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        status.textContent = "Download requested for " + accepted.entry.name + ". Exact UTF-8/BOM bytes were checked again; vault trash remains untouched.";
      }).catch(error => { if (owned() && generation === this.generation) { previewed = null; status.textContent = error instanceof Error ? error.message : String(error); } }).finally(() => {
        this.busy = false; if (!owned()) return;
        for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) control.disabled = false;
        folder.disabled = !canRestore; for (const control of list.querySelectorAll<HTMLInputElement>("input")) control.disabled = !canRestore; controls();
      });
    });
    cancel.addEventListener("click", () => this.close()); confirm.disabled = review.disabled = download.disabled = true;
  }
  override close(): void { if (!this.busy) { ++this.generation; super.close(); } }
  dispose(): void { ++this.generation; super.close(); }
}
