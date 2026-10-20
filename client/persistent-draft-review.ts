import type { App } from "./app";
import { Modal, Notice } from "./ui";
import type { PersistentDrafts } from "./persistent-drafts";
import { recoveryOptions } from "./persistent-draft-providers";
import {
  applyRecovery, assessRecovery, providerLabel, readSource, recoveredNoticeText, suggestRecoveryPath, type DraftListing, type ListedDraft, type RecoveryAssessment, type RecoveryResult, type SourceReading,
} from "./persistent-draft-model";

const PREVIEW_CHARS = 4000;

const STATUS_LABEL: Record<RecoveryAssessment["status"], string> = {
  unchanged: "Original note unchanged since the draft began",
  changed: "Original note changed after the draft began",
  "already-saved": "Original note already contains this text",
  missing: "Original note is missing",
  unreadable: "Original note could not be read",
  "other-vault": "Draft belongs to another vault or the vault is not open",
};

/** Explicit reviewed recovery of durable drafts. Nothing here runs automatically; closing preserves every record. */
export function installPersistentDraftReview(app: App, drafts: PersistentDrafts): { open(): void; notifyStartup(): Promise<void> } {
  let modal: Modal | null = null, notice: Notice | null = null, notified = false, epoch = 0;
  const element = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "", className = ""): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); node.textContent = text; if (className) { node.className = className; } parent.append(node); return node;
  };
  const button = (parent: HTMLElement, label: string, dataKey: string, onClick: () => void): HTMLButtonElement => {
    const node = element(parent, "button", label); node.type = "button"; node.dataset[dataKey] = ""; node.addEventListener("click", onClick); return node;
  };

  const open = (): void => {
    notice?.hide(); notice = null;
    if (modal?.isOpen) { modal.modalEl.focus(); return; }
    const current = modal = new Modal(app);
    current.setTitle("Unsaved drafts");
    current.containerEl.dataset.persistentDraftReview = "";
    element(current.contentEl, "p", "These drafts were captured from unsaved edits and survive reload or restart. Review the text, then save it to a safe place. Nothing is applied automatically, and closing this window keeps every draft.");
    const status = element(current.contentEl, "p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.dataset.draftStatus = "";
    const health = element(current.contentEl, "div"); health.dataset.draftHealth = "";
    const refresh = button(current.contentEl, "Refresh", "draftRefresh", () => { void load(); });
    const list = element(current.contentEl, "div"); list.dataset.draftList = "";
    let generation = 0;
    const live = (token: number): boolean => current.isOpen && generation === token;

    const renderHealth = (): void => {
      health.replaceChildren();
      const state = drafts.capture.status();
      if (state.storageError) { element(health, "p", "Draft storage problem: " + state.storageError, "plugin-error"); }
      for (const failure of state.failures) { element(health, "p", failure.path + " (" + failure.kind + "): " + failure.message, "plugin-error"); }
      if (state.retained.length) { element(health, "p", state.retained.length + " draft(s) of notes no longer open were kept because the saved note could not be proven identical."); }
      element(health, "p", "Capture protects built-in Markdown notes, Canvas, Bases and plugin text views that explicitly opted in, in this browser profile. It is best-effort storage: it is not a guarantee against operating-system or power loss or browser storage eviction. Plugin views are captured only while the page is running normally; arbitrary plugin state is not serialised at crash time, so plugin recovery is partial.", "muted");
    };

    const renderDraft = async (item: ListedDraft, token: number, parent: HTMLElement): Promise<void> => {
      const record = item.record;
      const section = element(parent, "section"); section.dataset.draftId = record.id;
      element(section, "h3", record.path); element(section, "p", "Type: " + providerLabel(record.provider), "muted").dataset.draftProvider = record.provider ?? "markdown";
      element(section, "p", "Vault: " + record.vaultRoot, "muted");
      element(section, "p", new Date(record.updatedAt).toLocaleString() + " · " + record.bytes + " bytes · line endings " + record.eol + (record.hasBom ? " · UTF-8 BOM" : "") + " · started from version " + record.baseVersion.slice(0, 12), "muted");
      if (item.ownership === "active-elsewhere") {
        element(section, "p", "Another window currently holds this draft. It becomes recoverable here if that window closes; refresh after a few seconds.", "plugin-error");
        return;
      }
      if (item.ownership === "mine") { element(section, "p", "This window is still editing this note; its draft is kept up to date automatically.", "muted"); return; }
      let reading: SourceReading | null = null;
      if (drafts.vault.rootPath === record.vaultRoot) { reading = await readSource(drafts.vault, record.path); if (!live(token)) { return; } }
      const assessment = assessRecovery(record, drafts.vault.rootPath, reading);
      element(section, "p", STATUS_LABEL[assessment.status] + ". " + assessment.explanation, assessment.status === "changed" || assessment.status === "unreadable" ? "plugin-error" : "").dataset.draftSource = assessment.status;
      const details = element(section, "details"); element(details, "summary", "Review draft text");
      const pre = element(details, "pre", record.content.length > PREVIEW_CHARS ? record.content.slice(0, PREVIEW_CHARS) + "\n… (" + (record.content.length - PREVIEW_CHARS) + " more characters)" : record.content);
      pre.dataset.draftPreview = "";
      const actions = element(section, "div"); actions.dataset.draftActions = "";
      const result = element(section, "p"); result.setAttribute("role", "status"); result.dataset.draftResult = "";
      const destination = element(actions, "input"); destination.type = "text"; destination.dataset.draftDestination = ""; destination.setAttribute("aria-label", "New file path");
      destination.value = assessment.canCreateAtOriginalPath ? record.path : suggestRecoveryPath(record.path, candidate => Boolean(drafts.vault.getAbstractFileByPath(candidate)));
      const buttons: HTMLButtonElement[] = [];
      const run = (action: Parameters<typeof applyRecovery>[3], label: string): void => {
        if (!live(token)) { return; }
        for (const b of buttons) { b.disabled = true; }
        result.textContent = label + "…";
        const apply = (): Promise<RecoveryResult> => applyRecovery(drafts.store, drafts.vault, record, action, recoveryOptions(app));
        // Destructive file writes run inside the workspace mutation barrier so in-window editing cannot race them; discard touches no file.
        const guarded = action.kind === "discard" ? apply() : Promise.resolve().then(() => app.workspace.withFileMutation(apply));
        guarded.then((outcome: RecoveryResult) => {
          if (!live(token)) { return; }
          result.textContent = outcome.message;
          if (outcome.ok) { void load(); } else { for (const b of buttons) { b.disabled = !reviewed; } }
        }, (error: unknown) => {
          if (!live(token)) { return; }
          result.textContent = "Recovery was not applied and the draft was kept: " + String((error as Error)?.message ?? error);
          for (const b of buttons) { b.disabled = !reviewed; }
        });
      };
      let reviewed = false;
      const hint = element(section, "p", "Open “Review draft text” to enable actions.", "muted");
      if (assessment.canReplace && !drafts.vault.readOnly) { buttons.push(button(actions, "Replace original note", "draftReplace", () => run({ kind: "replace" }, "Replacing the original note"))); }
      buttons.push(button(actions, "Save as new note", "draftSaveNew", () => run({ kind: "create", path: destination.value.trim() }, "Saving as a new note")));
      buttons.push(button(actions, "Copy text", "draftCopy", () => { navigator.clipboard.writeText(record.content).then(() => { result.textContent = "Copied. The draft is still stored."; }, error => { result.textContent = "Could not copy: " + String(error?.message ?? error); }); }));
      let confirming = false;
      const discard = button(actions, "Discard draft", "draftDiscard", () => {
        if (!confirming) { confirming = true; discard.textContent = "Confirm discard"; result.textContent = "Discarding permanently removes this draft. It does not touch the saved note."; return; }
        run({ kind: "discard" }, "Discarding");
      });
      buttons.push(discard);
      for (const b of buttons) { b.disabled = true; }
      details.addEventListener("toggle", () => {
        if (details.open && !reviewed) { reviewed = true; hint.remove(); for (const b of buttons) { b.disabled = false; } }
      });
      if (assessment.alreadySaved) { element(section, "p", "Saved text matches exactly; discarding is safe.", "muted"); }
    };

    const load = async (): Promise<void> => {
      const token = ++generation; refresh.disabled = true; status.textContent = "Loading drafts…"; renderHealth();
      try {
        const listing: DraftListing = await drafts.store.list();
        if (!live(token)) { return; }
        list.replaceChildren();
        const recoverable = listing.drafts.filter(item => item.ownership === "orphaned").length;
        status.textContent = listing.drafts.length || listing.corrupt.length ? recoverable + " draft(s) awaiting review; " + listing.drafts.length + " stored; " + listing.corrupt.length + " unreadable record(s)." : "No stored drafts.";
        for (const item of listing.drafts) { await renderDraft(item, token, list); if (!live(token)) { return; } }
        for (const bad of listing.corrupt) {
          const section = element(list, "section"); section.dataset.draftCorrupt = bad.key;
          element(section, "h3", "Unreadable draft record");
          element(section, "p", bad.reason + " The raw record (" + bad.bytes + " bytes) is preserved and was not modified.", "plugin-error");
          const output = element(section, "p"); output.setAttribute("role", "status");
          button(section, "Copy raw record", "draftCopyRaw", () => { navigator.clipboard.writeText(bad.raw).then(() => { output.textContent = "Copied raw record."; }, error => { output.textContent = "Could not copy: " + String(error?.message ?? error); }); });
          let confirm = false;
          const remove = button(section, "Remove unreadable record", "draftRemoveCorrupt", () => {
            if (!confirm) { confirm = true; remove.textContent = "Confirm removal"; return; }
            drafts.store.removeCorrupt(bad.key, bad.raw).then(removed => { output.textContent = removed ? "Removed." : "The record changed and was kept."; if (live(token)) { void load(); } }, error => { output.textContent = String(error?.message ?? error); });
          });
        }
      } catch (error) {
        if (live(token)) { status.textContent = "Cannot list drafts: " + String((error as Error)?.message ?? error); }
      } finally { if (live(token)) { refresh.disabled = false; } }
    };
    current.onOpen = () => { void load(); };
    current.onClose = () => { generation++; if (modal === current) { modal = null; } };
    current.open();
  };

  app.commands.install([{ id: "app:review-persistent-drafts", name: "Review unsaved drafts", callback: open }]);
  app.registerLeaveGuard(() => { epoch++; notified = false; modal?.close(); notice?.hide(); notice = null; });

  const check = async (token: number): Promise<number> => {
    const listing = await drafts.store.list();
    if (epoch !== token) { return 0; }
    const orphaned = listing.drafts.filter(item => item.ownership === "orphaned");
    if (orphaned.length || listing.corrupt.length) {
      const fragment = document.createDocumentFragment(), review = document.createElement("button");
      fragment.append((orphaned.length ? recoveredNoticeText(orphaned.map(item => item.record.provider)) : "Some stored draft records are unreadable. "));
      review.type = "button"; review.textContent = "Review drafts"; review.dataset.draftStartupReview = ""; review.addEventListener("click", open);
      fragment.append(review); notice = new Notice(fragment, 20000);
    }
    return listing.drafts.filter(item => item.ownership === "active-elsewhere").length;
  };
  return {
    open,
    async notifyStartup(): Promise<void> {
      if (notified) { return; }
      notified = true;
      const token = epoch;
      try {
        if (await check(token)) {
          // Another owner's lease may simply not have expired after a reload; look once more afterwards.
          setTimeout(() => { if (epoch === token) { void check(token).catch(() => undefined); } }, 11000);
        }
      } catch (error) { notice = new Notice("Stored drafts could not be checked: " + String((error as Error)?.message ?? error), 15000); }
    },
  };
}
