/** Owned by each open dialog so no host-specific stylesheet link is required. */
export const historyArchiveStyle = [
  ".web-history-archive-modal { width: min(780px, 94vw); max-height: 92vh; display: flex; flex-direction: column; box-sizing: border-box; }",
  ".web-history-archive-modal h2 { flex-shrink: 0; }",
  ".web-history-archive-modal .modal-content { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }",
  ".web-history-archive-scroll { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; }",
  ".web-history-archive-scroll > *, .web-history-archive-modal .modal-button-container { flex-shrink: 0; }",
  ".web-history-archive-modal label { display: flex; flex-direction: column; gap: 6px; }",
  ".web-history-archive-modal [data-web-history-archive-preview] { width: 100%; height: min(42vh, 360px); resize: vertical; font-family: var(--font-monospace); white-space: pre; }",
  ".web-history-archive-modal [data-web-history-archive-status], .web-history-archive-modal [data-web-history-archive-error] { overflow-wrap: anywhere; }",
].join("\n");
