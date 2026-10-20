import type { App } from "./app";
import { Modal } from "./ui";

export interface RescueCopyInspection {
  state: "verified" | "changed" | "incomplete" | "missing" | "unavailable";
  message: string;
  checkedAt: string;
  expectedBytes: number;
  expectedSha256: string;
  expectedBom: boolean;
  actualBytes: number | null;
  actualSha256: string | null;
  actualBom: boolean | null;
  preview: string | null;
  previewTruncated: boolean;
}

/** Transient, literal preview. Closing also makes any pending result obsolete. */
export function openRescueCopyInspection(app: App, sourceRoot: string, sourcePath: string, request: () => Promise<RescueCopyInspection>): Modal {
  const modal = new Modal(app); modal.setTitle("Inspect rescue copy");
  modal.containerEl.dataset.rescueInspection = "loading";
  const paragraph = (parent: HTMLElement, text: string): HTMLParagraphElement => {
    const node = document.createElement("p"); node.textContent = text; parent.append(node); return node;
  };
  paragraph(modal.contentEl, sourcePath);
  paragraph(modal.contentEl, "Original vault: " + sourceRoot);
  const status = paragraph(modal.contentEl, "Checking this copy…"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  paragraph(modal.contentEl, "Review text before restoring it manually. Inspection leaves notes and rescue files unchanged.");
  modal.onOpen = () => {
    request().then(result => {
      if (!modal.isOpen) { return; }
      modal.containerEl.dataset.rescueInspection = result.state; status.textContent = result.message;
      if (result.preview !== null) {
        if (result.previewTruncated) { paragraph(modal.contentEl, "Preview shows only the beginning of this file (64 KiB limit). The check covers the whole file."); }
        else if (!result.preview) { paragraph(modal.contentEl, "This copy contains no text."); }
        const preview = document.createElement("pre"); preview.className = "rescue-copy-preview";
        preview.tabIndex = 0; preview.setAttribute("role", "region"); preview.setAttribute("aria-label", "Rescued Markdown preview");
        preview.textContent = result.preview; modal.contentEl.append(preview);
      }
      const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Check details"; details.append(summary);
      paragraph(details, "Checked: " + new Date(result.checkedAt).toLocaleString());
      paragraph(details, "Expected bytes: " + result.expectedBytes + "; read: " + (result.actualBytes ?? "unavailable"));
      paragraph(details, "UTF-8 BOM expected: " + (result.expectedBom ? "present" : "absent") + "; read: " + (result.actualBom === null ? "unavailable" : result.actualBom ? "present" : "absent"));
      paragraph(details, "Recorded SHA-256: " + result.expectedSha256);
      paragraph(details, "Observed SHA-256: " + (result.actualSha256 ?? "unavailable"));
      modal.contentEl.append(details);
    }).catch(error => {
      if (modal.isOpen) { modal.containerEl.dataset.rescueInspection = "error"; status.textContent = "Cannot inspect this copy: " + String(error.message ?? error) + " Refresh the rescue list before retrying."; }
    });
  };
  modal.open(); return modal;
}
