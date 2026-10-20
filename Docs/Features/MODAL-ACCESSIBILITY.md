# Shared modal keyboard accessibility

[Feature-parity index](../FEATURE-PARITY.md) · [Application](APPLICATION.md)

**Ownership:** Codex, claimed and completed 2026-10-25.
Implementation, both-host keyboard acceptance and adjacent integration pass.

The shared plugin/core Modal keeps ordinary Tab and Shift+Tab navigation inside
the top open dialog. The current light-DOM tab order is recalculated for each
key: positive indexes precede ordinary controls, same-index controls retain DOM
order, named radio groups contribute their checked choice (or a directional
entry point when unchecked), and readonly fields and editable roots participate.
Hidden, inert, disabled, detached, negative-index and unavailable controls are
excluded from sequential navigation. A dialog without available controls keeps
focus on its own programmatically focusable root. Focused controls scroll into
view inside their scroll container.

The window's bubble-phase Tab handler runs after widget handlers. A widget that
prevents the key retains it, including textarea editing and suggestion selection.
Existing plugin Scope capture dispatch and app shortcuts remain available.
Open shared menus and suggestion popovers handle their own keys before the
containing dialog handles Escape. Escaped background focus is returned to the
current dialog; only the top Modal owns containment.

Closing a child restores its available invoking control. Closing a lower parent
does not steal focus from its child, and a remaining dialog receives focus when
its previous return control has disappeared. Return controls that are detached,
disabled, hidden or inert are skipped. Close cleanup removes keyboard/focus
listeners in a finally block, including when onClose throws. An onOpen failure
forces base cleanup even when a subclass's normal close method declines.
Repeated ordinary open/close does not leave an active focus guard.

Each title has a unique ID and names the dialog through aria-labelledby.
setTitle updates that association, and a title written directly during onOpen
is associated after the hook returns. An empty title retains the existing
aria-label fallback, including a plugin's custom label. This does not monitor
arbitrary later asynchronous DOM title edits; plugins can use setTitle.

## Evidence and limits

Seven focused tests cover availability, stable order, radio/form grouping,
editable/summary controls, current navigation, dynamic changes and empty/focus
fallbacks. All 511 regression tests pass against the isolated candidate.
The real CommonJS fixture plugin uses the actual shared API and real key input
on desktop and standalone WASM. Each host passes fifteen feature groups:
computed accessibility-tree names, forward/reverse order and wrap, widget key
ownership, menus, suggestions, nested/lower close, dynamic controls, scrolling,
errors, repeated open/close, disabled return controls and cleanup/preservation.
The desktop report has sixteen checks across three native sessions; the WASM
report has twenty-eight checks including its thirteen browser bootstrap checks.
The latter uses the real folder picker and reconnects its directory handle.

The feature preserves exact BOM/CRLF/Unicode note bytes and unrelated plugin
enablement, and does not restore transient dialogs after restart/reconnect.
The first real keyboard attempt identified and fixed the positive-index browser
transition through background controls. Earlier test serialization and shortcut
assertion attempts are retained alongside the corrected inputs and reports.

The existing Menu suite (three feature groups) and suggestion suite (five groups)
also pass on both hosts, including genuine input/editor/modal ownership and
plugin unload/re-enable. Six dialog captures have been visually reviewed.
Twenty-three captured contributor inputs are unchanged and all seven feature
source inputs match the tested candidate. Native/WASM builds and standalone
static serving pass. Native console diagnostics retain six exact Blazor
WebSocket-1006 disconnect messages across the three modal sessions; no uncaught
renderer exception occurred. The initial regression attempt started before the
first DLL existed; both completed-build and final navigation runs pass all 511.

The source snapshot, build/test/UI reports, reviewed captures, source hashes and
final receipt are indexed in [Evidence](../Engineering/EVIDENCE.md#shared-modal-keyboard-accessibility).
This is a bounded release-readiness subset. Complete screen-reader/OS/native
dialog behavior, shadow/iframe/media interior focus, complex radio/index
combinations, arbitrary asynchronous title mutations, reentrant lifecycle hooks,
physical IME, application-wide shortcut/accessibility parity and original
runtime equivalence remain separate. Synthetic composing and modified-key
checks do not establish physical IME or OS shortcut behavior.

## Viewport layout renewal

The later [viewport containment subset](MODAL-LAYOUT.md) changes the shared
modal CSS and renews this keyboard suite on both hosts (16/28 checks), together
with Note composer/Menu and suggestion workflows. The preceding keyboard
snapshot/receipt remains historical; its captured unchanged-CSS observation
applies to that earlier acceptance. The layout receipt records the new CSS,
proves the rest of the stylesheet unchanged, and retains the prior keyboard
implementation and fixture sources.
