import { sourcePositions } from "./markdown";
import type { OutgoingMentionBulkReview } from "./outgoing-mention-bulk";

/** Literal, local review shared by workspace panes and the legacy sidebar. */
export function outgoingMentionBulkReviewPanel(review: OutgoingMentionBulkReview, apply: () => void, cancel: () => void): HTMLElement {
  const section = document.createElement("section"), title = document.createElement("h4"), summary = document.createElement("p"), list = document.createElement("ol"), controls = document.createElement("div");
  section.className = "outgoing-bulk-review"; section.dataset.outgoingBulkReview = review.candidate.choice.targetPath; section.setAttribute("aria-label", "Review mention links");
  title.textContent = "Review links to " + review.candidate.choice.targetPath;
  summary.textContent = `Link ${review.changes.length} eligible mention${review.changes.length === 1 ? "" : "s"} in ${review.candidate.choice.path}. `
    + (review.omitted ? `${review.omitted} unsupported match${review.omitted === 1 ? " stays" : "es stay"} literal. ` : "")
    + "Code, existing links, comments and unsupported syntax stay literal. One Undo in the note restores every change shown here.";
  const position = sourcePositions(review.candidate.choice.text);
  for (const change of review.changes) {
    const item = document.createElement("li"), location = document.createElement("span"), before = document.createElement("code"), arrow = document.createElement("span"), after = document.createElement("code"), range = position(change.from, change.to);
    item.dataset.outgoingBulkRange = `${change.from}:${change.to}`; location.textContent = `Line ${range.start.line + 1}, column ${range.start.ch + 1}: `;
    before.textContent = change.label; before.dataset.outgoingBulkBefore = "true"; arrow.textContent = " → "; after.textContent = change.insert; after.dataset.outgoingBulkAfter = "true";
    item.append(location, before, arrow, after); list.append(item);
  }
  const applyButton = document.createElement("button"), cancelButton = document.createElement("button");
  applyButton.type = cancelButton.type = "button"; applyButton.className = "mod-cta"; applyButton.textContent = `Link ${review.changes.length} mentions`; applyButton.dataset.outgoingBulkApply = "true";
  cancelButton.textContent = "Cancel"; cancelButton.dataset.outgoingBulkCancel = "true";
  applyButton.addEventListener("click", apply); cancelButton.addEventListener("click", cancel);
  section.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } });
  controls.className = "outgoing-bulk-review-controls"; controls.append(applyButton, cancelButton); section.append(title, summary, list, controls); return section;
}
