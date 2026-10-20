# Error logging and read-only plugin I/O acceptance

Reviewed 2026-10-28. Persistent [error logs](../Features/ERROR-LOGS.md) cover
notifications, global JavaScript failures, unhandled rejections and host error
banners. The [read-only I/O policy](../Features/READ-ONLY-PLUGIN-IO.md) keeps
GitHub content immutable and prevents the supplied Excalidraw package from
repeatedly entering its save pipeline.

## Final inputs and checks

The final source fingerprint is `9c471c87838261c164d7524d8593bb806b06ed572821580438173f5f19b8632d`, covering
380 normalized code inputs. All **636 regression tests**
and the separate **32 GitHub storage/API tests** pass. Both native and standalone
WASM builds and static-site verification pass in an isolated source copy.
The shared workspace's three generated build artifacts remain byte-identical.

All 27 requested core modules pass their fixed 123 named cases on both hosts.
Final settings screens show all 27 source/host-matched Verified workflows badges
through toggling and restart/reconnection. The fixed benchmark remains
31 modules/140 cases; these checks do not establish full original-runtime,
private API, visual, service or physical microphone equivalence.

| Final run | Workflow groups | Core cases | Logged/explicitly expected |
|---|---:|---:|---:|
| excalidraw-smoke | 12 | 0 | 0/0 |
| excalidraw-web-smoke | 24 | 0 | 1/1 |
| core-verification-smoke | 96 | 123 | 11/11 |
| core-verification-web-smoke | 108 | 123 | 12/12 |
| diagnostics-smoke | 4 | 0 | 3/3 |
| diagnostics-web-smoke | 16 | 0 | 4/4 |
| workspace-transition-smoke | 6 | 0 | 1/1 |
| workspace-transition-web-smoke | 18 | 0 | 2/2 |
| core-status-smoke | 2 | 0 | 0/0 |
| core-status-web-smoke | 14 | 0 | 1/1 |

Every run has zero unexpected logged errors and zero uncaught exceptions,
including final teardown. Deliberate negative fixtures account for exact IDs,
sources, messages and relevant original stack locations within their own action.
No global message-pattern exemption is used.

## Corrected failures

Function-valued DOM helpers are writable, so unchanged plugins can replace an
element's `onWindowMigrated` callback. Diagnostics exercise replacement and
actual same-origin frame adoption. Logs retain original stacks, nested causes,
aggregate errors and vault/file/view context. Message-only browser errors retain
filename/line/column and a reporting-stack distinction. Actual Download log
exports and retained desktop/browser storage are checked.

The new audit also exposed an ImageView Fit ResizeObserver feedback loop. Fit
now leaves one CSS pixel of rounding headroom and coalesces observer work in an
owned animation frame, cancelled on unload. Three fractional viewport sizes
pass without scroll overflow or repeated resize errors. The original failure
and focused correction remain retained under EarlierLogging.

Sixteen vault mutation entry paths refuse with `VAULT_READ_ONLY` before
content downloads or transformation callbacks. File management checks policy
before save/metadata work. Policy code, operation and path survive error
serialization. Unexpected writable failures continue to reject.

The unchanged pinned Excalidraw **2.29.0** package is exercised through real local
pointer/keyboard drawing, a linked PNG with decoded pixel checks, physical
compressed save, reopen, restart/reconnect and Markdown SVG embeds. A genuine
cached GitHub mount opens its actual drawing canvas in enforced view mode.
Repeated background, direct and force saves return skipped outcomes with no
acknowledged revision. Raw dirty state remains, remote cache blobs and local
note/asset bytes remain exact, direct modification refuses, local plugin-data
preferences work, and view close/plugin disable/return to a local vault pass.
The adapter is version-specific; other packages retain the typed refusal APIs.

## Error-gate control and publication

A separate owned run injects one actual unhandled renderer exception through
CDP with unchanged application/runner source. It must exit nonzero and fail the
persisted-log audit. The final control records exactly one uncaught exception
and its unexpected window-error record. Positive diagnostics evidence is
restored afterward; the failed run, application JSONL and receipt are retained.

Core catalogue publication compares exact normalized artifact path sets and
SHA-256 hashes before and after rebuilding. Only the catalogue JSON and its
compressed browser variants may differ. The final publication passes this
check.

## Retained evidence

[Receipt and hash index](ErrorLogs/2026-10-28/receipt.json) identifies every
retained file. Final contains the ten current reports, audited application and
runner logs, diagnostics exports, settings captures, source snapshot,
publication delta and the negative control. EarlierLogging contains thirteen
passing logging-stage reports on source
`aff3e78378308687d34e443e0cbc10d10ee951afc4327e654cf9a3b02014c1a9`,
their exact logs, expected fixtures, failed attempts, resize correction and
earlier negative control. Earlier reports do not substitute for final-source
core or Excalidraw execution.

Reference retains the original Obsidian 1.12.7 registration/settings/owned-command
audit for the 27 requested modules. The supplied Example's 73 protected plugin
and preference inputs pass preservation checks; mutable visit history is
excluded from that byte comparison. No vendor plugin package was patched.
