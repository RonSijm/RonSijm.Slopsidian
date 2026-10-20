# Workspace tab movement acceptance, 2026-10-27

[Using tab movement](../Features/TAB-MOVEMENT.md) · [Evidence](EVIDENCE.md)

This completes the claimed main-workspace tab reordering/movement item. The
implementation reuses the existing leaf, view, document session and DOM rather
than closing/recreating a tab. Pointer drops select insertion gaps; menu,
command-palette and Ctrl+Shift+PageUp/PageDown actions share the guarded model.
Moving the last tab prunes empty nested panes. Header overflow supports wheel
scrolling and drag-edge autoscroll.

Workspace tree rendering now adopts existing connected descendants before
pruning obsolete wrappers. On the tested Chromium hosts it uses `moveBefore`
to preserve focus and frame documents. A fallback uses ordinary insertion for
older browsers; frame/media internals are not guaranteed to survive that path.
Source/Reading editors retain their model objects and text. Native docking,
sidebars, popouts, stacking, touch input and full private/original workspace
equivalence are outside this scope.

## Meaningful checks

Seven model tests cover both insertion directions, no-op gaps, source selection,
view/history/pin identity, nested-empty cleanup, read-only vaults, boundary
availability, foreign/detached/sidebar destinations and vault/layout/file/view
transition guards. The complete regression suite passes **622 tests**.

Five real feature groups pass on desktop and standalone actual-folder WASM:

1. Trusted pointer drag and both Ctrl+Shift+Page keys reorder actual tabs while
   preserving two dirty BOM/CRLF/Unicode notes, a shared Reading peer, selection,
   undo/redo, pin, scroll and history without an implicit save.
2. The actual tab context menu and cross-pane drags move notes and a loaded
   independent CommonJS plugin view. Empty nested panes prune correctly; the
   plugin's iframe document, input/opaque state and single owned event listener
   survive both reparenting and split creation.
3. Escape, removed sources, a controlled in-progress vault-transition flag and
   stale/foreign drag data leave the current tab order and dirty text intact.
4. A real drag auto-scrolls a strip with 18 additional tabs to an initially
   offscreen insertion point and clears all insertion/drag markers on drop.
5. After an explicit save, actual desktop process restart or real-folder browser
   reload/reconnection restores the rearranged layout, active leaf, modes, pins
   and opaque plugin state. Original `workspace.json`, plugin source and exact
   saved note bytes remain preserved.

The fixture uses an owned plugin, not a third-party compatibility release.
Pointer dragstart/drop trust is asserted; CDP intercepts the genuine source drag
and dispatches its captured custom payload to the measured destination. The
vault-transition refusal is a controlled guard test; the separate renewed core
suite exercises actual vault selection and isolation. Physical drag devices,
external applications, cross-origin frame behavior and all legacy browsers are
not inferred from these checks.

## Retained attempts

The initial fixture used incomplete plugin metadata and an unsupported inventory
method; it now uses a valid manifest and the supported reload/opt-in workflow.
The first real drag attempt exposed restored headers being marked against the
previous root during staged layout creation. Drag capability now refreshes when
the active tree renders. The next attempt exposed an iframe reload when a new
split wrapper removed the old group before adopting it. Descendants now move
while connected, and obsolete wrappers prune afterwards. The iframe identity
assertion remains in acceptance.

Core renewal also exposed a combined-run Page preview fixture timeout: changing
only the modifier flag on an unchanged mouse position can generate no pointer
event. The unchanged focused scenario passed independently. The Reading check
now presses and releases the actual Control key while hovering, matching the
existing Source-mode test and retaining the visible-preview assertion.

The combined browser run then exposed an image-cleanup fixture assumption:
closing its newly opened tab can select another existing sibling. The original
image remained open, so its URL correctly remained live. The fixture now selects
that exact original image before replacing it with Canvas; URL revocation and
inactive retained controls are still required.

## Reproduction

In an isolated checkout/copy:

```powershell
npm test
npm run build
npm run smoke:tabs
npm run build:web
npm run verify:web
npm run smoke:tabs:web
npm run verify:core
npm run verify:core:web
```

The 27-module core catalogue is renewed against the same source after both
123-case runs pass, followed by the two real status-UI checks. The fixed
31-module/140-case contract remains unchanged. The previous core-only accepted
snapshot stays immutable under `Core/2026-10-27`.

All six accepted runs match source identity
`323b7e5eb9cc437d25fd453741f0d791930104b659ac974e2b2b8e07ce8f6e35`.

| Scope | Accepted result |
|---|---|
| Regression suite | 622 passed, including seven new movement invariants |
| Desktop tab movement | Five feature groups plus startup; two sessions, 72 artifact bindings |
| Actual-folder WASM tab movement | Five feature groups plus 13 browser foundations; 25 assets, 33 scenario inputs |
| Desktop core renewal | 123/123 cases, 95 groups, 31 sessions, 67 artifact bindings |
| Actual-folder WASM core renewal | 123/123 cases, 107 groups |
| Final verification status UI | All 27 badges, toggle and restart/reconnection checks pass on both hosts |
| Uncaught errors | Zero in all six accepted reports |
| Example preservation | 73 immutable plugin/preference inputs unchanged |

[Durable receipt](TabMovement/2026-10-27/receipt.json) binds 370 runtime/build/test
inputs, the wider validation snapshot, the six reports, build/static/test logs,
console classification, original reference observations, failed attempts,
reviewed captures, before/after catalogues and publication delta. The current
catalogue is in `shared/core-verification.json`; the prior core-only accepted
copy remains under `Core/2026-10-27`.

The final catalogue rebuild changes verification metadata only; the functional
reports retain their original artifact bindings and final status reports bind
the published catalogue. The three pre-existing shared generated editor files
remain unchanged. The normal launcher rebuilds the application to include the
new feature and accepted catalogue.
