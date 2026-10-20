import type { App } from "./app";
import { getBrowserHost } from "./contracts";
import { Modal, Notice } from "./ui";
import { openRescueCopyInspection } from "./draft-rescue-inspector";

interface RescueCopy {
  sourceRoot: string;
  sourcePath: string;
  file: string;
  copied: boolean;
  bytes: number;
}
interface RescueFolder {
  id: string;
  directory: string;
  capturedAt: string | null;
  drafts: RescueCopy[];
  errors: string[];
  readable: boolean;
  version: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
}
interface RescueCatalog { folders: RescueFolder[]; truncated: boolean; reviewError?: string; }

/** Desktop profile review only. No browser Node access and no vault restoration. */
export function installDraftRescueReview(app: App): { notifyStartup(): Promise<void> } | null {
  if (getBrowserHost() || typeof require !== "function") { return null; }
  const { ipcRenderer }: { ipcRenderer: import("electron").IpcRenderer } = require("electron");
  const list = (): Promise<RescueCatalog> => ipcRenderer.invoke("vault:draft-rescue", "list");
  let modal: Modal | null = null, notice: Notice | null = null, notified = false, epoch = 0;
  const paragraph = (parent: HTMLElement, text: string, className = ""): HTMLParagraphElement => {
    const node = document.createElement("p"); node.textContent = text; node.className = className; parent.append(node); return node;
  };
  const open = (): void => {
    notice?.hide(); notice = null;
    if (modal?.isOpen) { modal.modalEl.focus(); return; }
    const current = modal = new Modal(app);
    current.setTitle("Markdown rescue copies");
    current.containerEl.dataset.draftRescueReview = "";
    paragraph(current.contentEl, "These are local profile copies from interrupted desktop sessions. Inspect a copy to check its recorded status and preview its text before restoring it manually.");
    paragraph(current.contentEl, "After checking a folder, mark it reviewed to stop its future startup reminders.");
    const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = "Refresh"; refresh.dataset.rescueRefresh = "";
    const status = paragraph(current.contentEl, ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.dataset.rescueStatus = "";
    current.contentEl.append(refresh);
    const folders = document.createElement("div"); folders.dataset.rescueFolders = ""; current.contentEl.append(folders);
    let generation = 0;
    let inspection: Modal | null = null;
    const load = async (): Promise<void> => {
      inspection?.close(); inspection = null;
      const token = ++generation; refresh.disabled = true; status.textContent = "Loading rescue folders…";
      try {
        const catalog = await list();
        if (!current.isOpen || generation !== token) { return; }
        folders.replaceChildren();
        const pending = catalog.folders.filter(folder => !folder.reviewed).length;
        status.textContent = catalog.folders.length ? catalog.folders.length + (catalog.folders.length === 1 ? " rescue folder. " : " rescue folders. ") + pending + " awaiting review. Counts describe the original capture."
          : catalog.truncated ? "The folder scan reached its limit. Review remaining folders manually." : "No Markdown rescue folders were found in this profile.";
        if (catalog.reviewError) { paragraph(folders, catalog.reviewError, "plugin-error"); }
        if (catalog.truncated) { paragraph(folders, "Only a bounded part of the rescue folder could be listed. Review remaining folders manually.", "plugin-error"); }
        for (const folder of catalog.folders) {
          const section = document.createElement("section"); section.dataset.rescueFolder = folder.id;
          const title = document.createElement("h3"); title.textContent = folder.capturedAt ? new Date(folder.capturedAt).toLocaleString() : "Capture time unavailable"; section.append(title);
          paragraph(section, folder.directory, "muted");
          paragraph(section, folder.reviewed ? "Reviewed; startup reminder off for this capture." : "Awaiting review.", "muted");
          if (folder.version) {
            const review = document.createElement("button"); review.type = "button"; review.textContent = folder.reviewed ? "Remind me again" : "Mark reviewed";
            review.dataset.rescueReviewState = folder.id; review.disabled = Boolean(catalog.reviewError);
            review.addEventListener("click", () => {
              if (!current.isOpen || generation !== token) { return; }
              review.disabled = true; status.textContent = "Saving review status…";
              ipcRenderer.invoke("vault:draft-rescue-review-state", folder.id, folder.version, !folder.reviewed).then(async () => {
                if (current.isOpen && generation === token) {
                  await load();
                  if (current.isOpen && generation === token + 1) { folders.querySelector<HTMLButtonElement>('[data-rescue-review-state="' + folder.id + '"]')?.focus(); }
                }
              }).catch(error => {
                if (current.isOpen && generation === token) { status.textContent = "Cannot save review status: " + String(error.message ?? error) + " Refresh the list before retrying."; review.disabled = false; }
              });
            });
            section.append(review);
          }
          if (folder.readable) {
            paragraph(section, "Capture recorded " + folder.drafts.filter(copy => copy.copied).length + " of " + folder.drafts.length + " Markdown copies written.");
          }
          if (!folder.readable) { paragraph(section, "Copy information is missing or unreadable. Show this folder to inspect its files.", "plugin-error"); }
          else { for (const error of folder.errors) { paragraph(section, error, "plugin-error"); } }
          const show = document.createElement("button"); show.type = "button"; show.textContent = "Show folder"; show.dataset.rescueShow = folder.id;
          show.addEventListener("click", () => {
            show.disabled = true;
            ipcRenderer.invoke("vault:draft-rescue", "show", folder.id).then(() => {
              if (current.isOpen && generation === token) { status.textContent = "Requested the selected rescue folder. Review copies before restoring text manually."; }
            }).catch(error => {
              if (current.isOpen && generation === token) { status.textContent = "Cannot show the folder: " + String(error.message ?? error) + " Refresh the list and try again."; }
            }).finally(() => { if (current.isOpen && generation === token) { show.disabled = false; } });
          });
          section.append(show);
          if (folder.drafts.length) {
            const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Source notes and copy status"; details.append(summary);
            details.addEventListener("toggle", () => {
              if (!details.open || details.childElementCount > 1) { return; }
              const files = document.createElement("ul");
              for (const copy of folder.drafts) {
                const item = document.createElement("li"), name = document.createElement("strong"); name.textContent = copy.sourcePath; item.append(name);
                paragraph(item, "Original vault: " + copy.sourceRoot);
                paragraph(item, copy.file + " · " + copy.bytes + " bytes expected · " + (copy.copied ? "Reported copied" : "Copy failed"));
                const inspect = document.createElement("button"); inspect.type = "button"; inspect.textContent = "Inspect copy"; inspect.dataset.rescueInspect = copy.file;
                inspect.disabled = !folder.version;
                inspect.addEventListener("click", () => {
                  if (!current.isOpen || generation !== token || !folder.version) { return; }
                  inspection?.close();
                  inspection = openRescueCopyInspection(app, copy.sourceRoot, copy.sourcePath, () => ipcRenderer.invoke("vault:draft-rescue", "inspect", folder.id, copy.file, folder.version));
                });
                item.append(inspect);
                files.append(item);
              }
              details.append(files);
            });
            section.append(details);
          }
          folders.append(section);
        }
      } catch (error) {
        if (current.isOpen && generation === token) { status.textContent = "Cannot list rescue folders: " + String(error instanceof Error ? error.message : error); }
      } finally { if (current.isOpen && generation === token) { refresh.disabled = false; } }
    };
    refresh.addEventListener("click", () => { void load(); });
    current.onOpen = () => { void load(); };
    current.onClose = () => { generation++; inspection?.close(); inspection = null; if (modal === current) { modal = null; } };
    current.open();
  };
  app.commands.install([{ id: "app:review-markdown-rescue", name: "Review Markdown rescue copies", callback: open }]);
  app.registerLeaveGuard(() => { epoch++; modal?.close(); notice?.hide(); notice = null; });
  return {
    async notifyStartup(): Promise<void> {
      if (notified) { return; }
      notified = true;
      const token = epoch;
      try {
        const catalog = await list();
        const pending = catalog.folders.some(folder => !folder.reviewed);
        if (epoch !== token || !pending && !catalog.truncated) { return; }
        const fragment = document.createDocumentFragment(), button = document.createElement("button");
        fragment.append(pending ? "Markdown rescue copies still await review. " : "Some rescue folders could not be checked. ");
        button.type = "button"; button.textContent = "Review copies"; button.dataset.rescueStartupReview = ""; button.addEventListener("click", open);
        fragment.append(button); notice = new Notice(fragment, 15000);
      } catch {
        if (epoch === token) { notice = new Notice("Rescue folders could not be checked. Run “Review Markdown rescue copies” to retry.", 15000); }
      }
    },
  };
}
