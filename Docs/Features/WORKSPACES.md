# Named Workspaces and Obsidian profile exchange

[Feature-parity index](../FEATURE-PARITY.md)

**Last reviewed:** 2026-11-02

Imported `file-explorer` leaves now restore as real [Files workspace panes](FILE-EXPLORER.md) when enabled, including selected sidedock leaves and independent sort/filter/folder state. Imported `search` leaves also restore real [Search workspace panes](DISCOVERY.md#search-workspace-panes), with independent queries and owned workers. Imported `outline` leaves also restore real [Outline workspace panes](OUTLINE.md) with independent note/filter/fold state and Source/Reading navigation. Imported `backlink` leaves restore real [Backlinks workspace panes](BACKLINKS.md) with independent targets, filters, context, sorts and folds. [Tags and Footnotes](DISCOVERY.md#tags-workspace-panes) retain their separate pane scopes. Other missing providers retain their migration gaps.

**Claim completed:** Codex, 2026-10-21. Compatible named-profile import/export
passes four focused groups on desktop and standalone WASM. The existing independent profile manager is
retained. [First-open import acceptance](../Engineering/WORKSPACE-STARTUP-2026-10-28.md)
adds supported `workspace.json` startup import, independent-layout precedence
and an explicit retry/replacement command on desktop and actual-folder WASM.

The later [vault-change layout checkpoint](VAULT-TRANSITIONS.md) fixes obsolete
automatic saves during host selection and retains the current source layout
before switching. This separate four-group shared scope preserves named-profile
behavior and does not establish complete workspace or live Canvas lifecycle parity.

The separate [tab-movement feature](TAB-MOVEMENT.md) now reorders existing tabs
and moves them between main panes through pointer, keyboard and tab-menu actions.
It keeps live editor/plugin objects; the layout persistence and profile manager
below retain their positions. Edge docking and sidebars remain separate; linked groups and popouts are
covered in [their section](#linked-groups-and-popout-windows).

**Bounded docking expansion accepted on current main, reviewed 2026-11-02.** Pointer edge drops,
tab menus and commands now move existing live tabs into new main splits or
between main/left/right areas. Existing views, dirty shared text, pins and
opaque state are retained; failed structural changes restore the prior tree.
The matching `212ef2f3` [native](../Engineering/RoadmapIntegration/2026-11-02/docking-212e/native/docking-smoke.json)
and [actual-folder WASM](../Engineering/RoadmapIntegration/2026-11-02/docking-212e/wasm/docking-web-smoke.json)
collections now pass all seven docking features (8/20 total labels including
inherited controls), with unchanged raw inputs/artifacts and strict final audits.
Trusted pointer previews/edge/nested drops, sidebar bands/menu/commands, sidebar
reorder/return, one-step editor history and retained plugin frames all pass.
Escape/stale/foreign/vetoed moves retain the exact tree/live views; empty
sidebars unregister while one live empty main pane remains. Native restart or
browser handle reconnect preserves exact layout/width/pins/plugin state and
note/original-workspace bytes. Earlier isolated stale-compiled runs remain
behavioral-only, not restamped. Native stacking, sidebar/popout edge splits,
tear-out-to-new-window, physical OS/touch equivalence and broader private/native
docking remain separate. [Evidence](../Engineering/EVIDENCE.md#live-mainsidebar-docking-on-main-2026-11-02).

## First-open active workspace

When a vault has no `.obsidian/vault-dotnet-workspace.json`, Slopsidian reads
`.obsidian/workspace.json` and imports its supported tabs, Source/Live Preview
and Reading modes, pins, pane proportions and sidebar state. This application
startup behavior also works when the Workspaces core plugin is disabled.
Unavailable views retain their type and opaque state in placeholders; importing
does not enable plugins or open unsupported floating windows.

The imported layout checkpoints into Slopsidian's independent workspace after
the vault handoff and provider restoration. Repository-backed GitHub vaults use
their existing local preference overlay. The original file remains untouched.
Normal startup actions such as daily-note autorun or plugin commands can
subsequently open other panes.

An existing independent workspace takes precedence, including an intentionally
empty one. A malformed independent workspace retains the existing reset/recovery
guard rather than being replaced by an original. If the original is absent,
normal empty-workspace/first-note startup continues. If it is malformed,
unsupported or unreadable, notes remain accessible and a notice explains the
fallback; the persisted diagnostic log retains the error and its cause.

When the original layout is selected for startup, validated `lastOpenFiles`
also seeds the independent recent-file history. Existing independent state
still takes precedence. Unsafe or malformed history follows the same explicit
causal import fallback; the original bytes are not repaired or rewritten.

Use **Import Obsidian active workspace** in the command palette to retry or
explicitly replace the independent layout. Review its confirmation and
compatibility notes. Cancel leaves dirty notes and the current panes intact.
Confirm rechecks the source version and selected vault, then uses the ordinary
guarded layout transition to save open documents and replace the layout.
Changed sources, changed vaults and save conflicts refuse replacement. This
command remains available independently of named-profile management.

Original active layouts are limited to 1 MiB and the existing tree/state bounds.
The original-layout transport exposes a read-only endpoint; normal configuration
writes cannot target it. Unsupported stacking/group variants, ribbon and unobserved floating details
and other original-only fields stay in the original file. Imported view-state
objects remain in the independent layout. This does not supply missing core
view providers or full original/private workspace semantics.

## Recent file history

The independent automatic layout stores vault-owned paths under
`views["workspace-recent-files"]`, retaining opaque fields. Actual navigation
records the departed live file; external file creation and rename update
history. Restart/reconnection restores it without writing Obsidian's automatic
workspace. Cached read-only vaults keep this state in their local overlay.

`getLayout()` deliberately omits this record, so saving/applying named profiles
does not snapshot or rewind global recent files. Successful layout replacement
still records the departed active note; failed transitions do not. Explicit
original-layout replacement is not a command for restoring native recent
history. Existing vault/loading/transition guards isolate this state.

[Quick switcher and API behavior](DISCOVERY.md#quick-switcher-recent-files-and-bookmarks)
and [source-bound acceptance](../Engineering/SWITCHER-NAVIGATION-2026-10-28.md)
describe filtering, retention and actual restart/read-only workflows. This is
not native private storage parity; per-leaf navigation history is the next section.

## Per-leaf navigation history

Each `WorkspaceLeaf` keeps its own `history`/`historyIndex` (cap 50). Entries
are the leaf view state plus an optional ephemeral state (source/Reading
cursor and selection ranges, scroll offset, mode). Histories are independent per
tab and pane and follow the leaf through docking. The outgoing location is
captured before any navigation, then the target is applied with its stored
location. Media positions (PDF page/zoom, video time/rate/volume) are
restored through view state; scroll inside PDF pages is not.

Controls: header Back/Forward buttons, `workspace:go-back`/`go-forward`
(Alt+Left/Right), `app:go-back`/`app:go-forward` aliases, mouse buttons 4/5,
and `leaf.goBack()/goForward()/canGoBack/canGoForward`.
`leaf.setViewState(state, eState)` and `openFile(file, { eState })` apply
ephemeral state. Per-file CodeMirror state, including undo history, is kept
(max 10) and reused only when its document still equals the live text.
Rename/trash remap or prune entries; a missing target is skipped and pruned
rather than navigated into. Navigation is refused during a vault change or
after a root switch.

Persistence uses `views["workspace-history"]` in the independent automatic
layout, written only by the guarded layout save (not named workspaces; unknown
keys retained). On restart a leaf's record is accepted only if its current entry
matches the live leaf; entries for missing files are dropped. A rename made
while the app was closed cannot be remapped. Original-Obsidian imports do not
carry history.

Boundaries: this is the app's leaf-owned mechanism, not equivalence with
Obsidian's private history controller. Linked groups and popouts are
documented in the next section; stacking is out. Verified by model tests (`tests/workspace-history.test.mjs`) and by the
native/WASM scenario `tools/workspace-history-scenarios.mjs` (`npm run
smoke:history`, `smoke:history:web`), both passed on source fingerprint
`43c465a3c3047fa6f285f95e141c92e2badf8ed9e586cd05cc1e58ac007ccd82`: header Back/Forward
clicks, `app:go-forward`, manager-owned hotkey overrides and tooltips, trusted
CDP mouse buttons 4/5 (no URL change), source selection/scroll and Reading
scroll/mode restore, undo/redo across a file swap, docked identity,
rename/delete/vault-change handling and restart. Notes: leaving a dirty note
saves it as for any file swap (undo history stays in the live editor); scroll
restore reapplies for up to 800 ms against CodeMirror re-measure unless the user
scrolls first. Failed attempts are preserved under
`.runtime\evidence\failed-attempts`. That pair is historical evidence for its
recorded subset only.

Follow-up preservation fixes passed a fresh isolated native/WASM pair on
`6698fb61d59be06e113e7695df2fa33381aa9b0ff31e4b52aa11b772d3dace93`:
up to 64 selections are retained
(location limit 8192 chars; larger ones shrink to the main selection plus what
fits and are reported instead of dropping the whole location); refreshing an
entry keeps unknown entry, state and location keys (`refreshEntry`); malformed
saved records are still recovered per record but reported through `reportError`.
The Markdown view state already keeps opaque keys (base view state with known
fields overlaid); the scenario asserts them in restored entries after restart.
Both source identities and prior failed attempts remain separate evidence.
[Connected main-source renewal](../Engineering/INTEGRATION-WAVE-2026-11-03.md) now passes both history collections.
The same matrix separately renews the groups/popouts, native close recovery and
actual OS tab-drag scopes; those are separate from history acceptance.

## Linked groups and popout windows

**Reviewed 2026-11-02: bounded native/WASM collections accepted on their retained
source epochs; complete window equivalence remains partial.** The `212ef2f3`
native/allowed-popup WASM collections renew all 13/22 labels, real input/history,
return and strict final audits after the bounds corrections. The separate
blocked-popup control passes 15 labels, not the full collection.
Earlier ResizeObserver, held-mutation Undo and cross-document
listener failures remain historical failed attempts, not the current outcome.
The separate `212ef2f3` original-import scope below now also proves native restart
and browser document/reconnection persistence. Neither collection establishes
all window, input, display or original/private variants.

*Linked groups.* `app.workspace.linkLeaves([...])`, `leaf.setGroup(id|null)` and the
commands **Link tabs in this pane** / **Unlink current tab** join live leaves into a
group. When a grouped leaf's file changes by a user or API navigation, each other
member is planned first and then follows independently: pinned, busy, unavailable
(deferred) and non-following views are skipped with a reason, and a failing follower
is reported without affecting the others. Views may implement `onLinkedNavigation`.
Results are in `workspace.lastLinkedNavigation` and a `linked-navigation` event.
Membership never moves or reloads a leaf, pins and per-leaf history stay
independent, and back/forward, layout restore and applying a named layout do not
propagate. Groups persist in `views["workspace-groups"]` (unknown keys retained,
lone and missing leaves dropped on save). Original-Obsidian leaf `group` ids import
into it and export back by leaf id.

*Popouts.* **Move tab to new window**, **Return window to main area** and
**Close window** (or `workspace.popoutLeaf/returnWindow/closeWindow`) move the live
leaf into a `WorkspaceWindow` root. The same App, plugin, session, undo and view
objects render into a genuine second window; there is no second renderer. Desktop:
the main process allows only `about:blank` children named `slopsidian-popout-<id>`
from a local owner, blocks their navigation, and destroys them if the owner
navigates, crashes or closes. A user's close of a popout is intercepted and the
owner runs the dirty-view preflight (save + `prepareClose` for every tab); any
failure refuses the whole close and keeps the window, tabs and edits. Only the owner
may approve the final close. A desktop close that was not approved (quit/crash) keeps
the saved layout and restores the window next start. Browser: a real same-origin
`window.open` needs a user gesture; blocked or unsupported popups raise explicit
`PopoutError` codes and Notices, never an iframe or CSS panel. A user-closed browser
popup returns its tabs to main; `pagehide` closes popups so none outlive the owner.
Windows persist in `views["workspace-windows"]` (bounds, active popout leaf, unknown
and rejected entries kept verbatim). Saved `active` stays a main-area leaf for older
readers. If a saved window cannot reopen (blocked/unsupported/broken desktop bridge),
its tabs are shown in main with a Notice, but the saved arrangement is **not** erased:
the entry (root tree, bounds and unknown entry keys) stays *pending* and every
automatic save re-emits it with the live state of its tabs, removes those leaf ids from
the saved main tree (no duplicate ids; an empty main gets a placeholder empty leaf) and
drops tabs that were closed. `Retry saved popout windows` reopens them (needs a user
gesture in a browser; a refusal is explicit and leaves them pending; the saved
nested splits, sizes and selected tabs are rebuilt around the existing leaves) and
`Keep saved popout tabs in the main window` is the explicit user-directed fold/reset.
A broken Electron bridge raises its error and disables popouts instead of silently
using the browser path; a failed close approval is surfaced and never downgraded to
`surface.close()`. Window entries keep unknown fields on a round trip.
Applying a layout opens candidate windows first and rolls back on
failure; colliding window ids get fresh ids. Named layouts carry windows and groups.

*Acknowledged close.* On desktop, returning, closing or emptying a native popout
is deferred: its nested tree and tabs stay owned and saved until the host
confirms close. A veto or bounded timeout clears the pending state, reports and
leaves the untouched window retryable without rewinding newer main changes. A
late native close after timeout still commits. `returnWindowAcknowledged`
awaits that outcome; layout replacement awaits all old windows first. Browsers
keep immediate behavior. The isolated `c207ecf5` collection now verifies real
native close veto and normal return with a clean final audit; timeout/late-close
variants retain production-method model coverage rather than a real timeout run.

*Unexpected close, focused native proof accepted.* A genuine unapproved native
close now returns the same live tabs/DOM to main under the changing-view fence
and preserves their original nested tree, bounds and extras as pending saved
window intent. It emits an explicit recovery warning and saves only after that
intent exists. Failed adoption retains the old saved window and reports failure.
Retry reconstructs the saved arrangement; only explicit Fold resets it.
The separate `forced-close` diagnostic uses CDP `Page.close`, not `WM_CLOSE`.
Its complete `a1313670` focus now passes live identity/selection/pending-intent
preservation, real Undo/Redo/explicit Save-all, retry and acknowledged normal
return, with only the deliberate recovery notice in the final audit.
Its retained listener controls identify Chromium clearing listeners even on
detached nodes owned by the discarded popup document, despite intact CM history.
The source now parks the live subtree in the opener document on terminal
`pagehide`, disconnected from visible main UI, without changing the model or
declaring the window closed. Persisted pages and vetoes that never unload do not
park it. Actual close still gates relocation, and document-move callbacks wait
for a connected destination. This bounded native destruction control is not
general crash durability or whole window-module acceptance.

*Web viewer in a popout.* `View.windowMoveRefusal()` is checked before a window opens
(`canPopoutLeaf`/`openWindow`): a Web viewer finishing a clip or closing is refused
with a `PopoutError` and nothing moves. On a move, `WebViewerView.onWindowMoved`
re-roots its observers to the popout document, rebinds the live and pending
`WebReaderFrame` message listener to the popout `window`. The opaque Reader
hands one private `MessageChannel` port to its authenticated actual parent, so
controller commands do not acquire the wrong sender realm after adoption.
Ready handover requires the opaque origin, exact frame source/token and one
valid port before replacing the old port; replacement/disposal closes it.
The trusted app origin comes from main, not an inherited-origin `about:blank`
popout's `"null"` location origin. CSP, window-message guards and progress remain;
selections invalidate only on a real iframe reload. The view sends the
host window name with the bounds. `desktop/web-viewer.cjs` then moves the native
`WebContentsView` to that popout `BrowserWindow` (`resolveHost`/`place`; an unknown,
destroyed or malformed host is refused and the guest stays put; a failed add restores
the old window). An approved popout close reclaims its guests into main first. If the
renderer's relocation request fails after the DOM moved, the error is shown and
`restoreLeafToMain` returns the tab to main. The real popout Reader/native-surface
scenario in `tools/workspace-popout-scenarios.mjs` now passes on isolated
`c207ecf5`: smoke-only physical `BrowserWindow.contentView` inspection verifies
the same guest WebContents, the moved Reader acknowledges its production
channel, and real wheel progress/return/refused movement pass. The later main
`600ab1b2` native scope separately turns Reader off/on with real pointers inside
the popout, confirms disposal and a different fresh controller, authenticates
its private port/production request, then verifies another reply after return.
This explicit constructor proof is not inferred from the earlier iframe reload.
Browser mode skips the native guest explicitly. Unit tests:
`web-reader-popout`, `web-viewer-popout-host`, `workspace-groups-popouts`.
Remaining gaps: broader current-main renewal, remaining native variants and the
unobserved Obsidian `floating` variants described below.

Popout documents are a separate JavaScript realm, so `client/realm.ts` bridges
`instanceof` for events and nodes of registered popout realms, tracks the active window
and opens menus, modals, notices, suggestions and hover cards in the window the user
is working in. Popout key events run through the same handler as the main document
(one hotkey manager/keymap owner). Moving a view between documents re-roots CodeMirror
(`EditorView.setRoot`), popout stylesheets (CSSOM and adopted sheets) are mirrored and
window moves/resizes are polled into saved bounds.

Automatic layout saves are held while a view closes and its leaf is removed:
`FileView.closeView` can clear the file before an awaited close finishes.
Concurrent sibling closes recompute the removal index after that await, so they
cannot remove an unrelated surviving tab or serialize a half-closed Markdown
leaf without a path. Dirty saves still happen first, close failures remain
explicit, and the backend still rejects malformed Markdown layouts. Both sibling
orders have production-method regression coverage; the accepted isolated theme
pair also exercises its formerly failing concurrent Markdown cleanup.

The shared file-mutation barrier makes the main shell and every live popout root
inert and disables their Markdown editors, restoring each root's previous inert
state after success or failure. DOM/editability alone was not a Markdown
history guard: real popout Ctrl+Z changed the document while held on source
`d11c757b972c200211728206ccf73a6f01da2cfc61def82962341af47c2c0a54`.
A state-level `MutationLock` is now integrated and regression-tested against
real CodeMirror history: a high-priority read-only facet blocks Undo/Redo,
contributes nothing while unlocked, preserves existing read-only policies and
retains the redo stack. History dispatch bypasses transaction filters, so a
filter alone cannot enforce this boundary. The complete isolated `c207ecf5`
native/allowed-popup WASM pair now passes held typing/Undo refusal, post-release
input/history resumption and return with clean final audits. DOM synchronization uses state-preserving
`moveBefore` only when parent and child share an `ownerDocument`; cross-document
returns use ordinary node adoption, retaining the existing view/CM and its
window-move lifecycle rather than recreating the editor.
Automatic linked-follow suppression belongs to
its individual view-state request, so an independent navigation on an in-flight
follower still reserves a newer group intent. These guards have production-method
regression coverage. Broader popout compatibility and combined main-source
renewal remain separate from that isolated collection.

Observed Obsidian `floating` conversion has a **verified one-window import and
persistence subset on both hosts**, reviewed 2026-11-02. An
[authentic 1.12.7 fixture](../Engineering/RoadmapIntegration/2026-11-02/original-floating-reference-1.12.7/workspace.floating-open.json)
is now captured from the unmodified official app inside a protected,
network-disabled Windows Sandbox. It contains `floating` -> `window` -> `tabs`
-> Markdown leaf, an active floating leaf, persisted outer bounds, `maximize`
and `zoom`. One unmaximized/default-zoom window is observed; wider variants
are not inferred. The converter uses the existing independent window model,
retains the active floating leaf and opaque state, and overlays export by the
original converted entry positions so refused duplicate IDs are not merged or
dropped. Unsupported/invalid windows stay retained with explicit warnings;
maximized/non-default-zoom behavior is retained but not applied. The original
workspace file is never rewritten. Startup now preserves imported window/group
views beside its source metadata.

The matching `212ef2f3` [native](../Engineering/RoadmapIntegration/2026-11-02/original-floating-212e/native/original-floating-import-smoke.json)
and [actual-folder WASM](../Engineering/RoadmapIntegration/2026-11-02/original-floating-212e/wasm/original-floating-import-web-smoke.json)
scopes exercise the real explicit import command and retain the original active
leaf, note and Source/Live Preview mode in a connected, separately owned editor.
Native performs a complete owned Electron/.NET restart; WASM navigates to a
fresh document and reconnects the same physical directory handle, not a complete
browser-process restart. Original workspace and note bytes remain exact, the
previous layout is restored, and only owned seed files are removed. Confirmation
is a labeled programmatic stub, not proof of real-pointer consent.

These runs exposed and correct two outer-geometry round-trip defects. Native
reapplies the requested rectangle through the standard DIP bounds API rather
than retaining the constructor's extra high-DPI expansion. Browser restoration
uses `resizeTo`/`moveTo`: `window.open` feature sizes describe content, not the
persisted outer rectangle. The original host request remains exactly
`160,120,723,603`; both measured 225%-scale windows normalize to `724 x 604` and
retain that outer size after restart/reconnection. Independent native and genuine
Chrome controls, failed prior attempts, exact pixel conversion and host limits
are retained in [the evidence](../Engineering/EVIDENCE.md#original-floating-import-and-stable-outer-bounds-2026-11-02).
This is not arbitrary pixel subtraction or an assertion tolerance.

First-open and named-profile floating combinations, real-pointer consent,
actual blocked-import/reload controls, multiple windows, maximization,
non-default zoom and wider browser/native/display variants remain separate.
Popouts persist only in `views["workspace-windows"]`, preserving entry extras.
Pending-window retry reconstructs nested splits, sizes, selected tabs, bounds
and extras around the same live leaves; only explicit Fold flattens them.
Placeholder ids never reuse an existing layout/window id.

Linked navigation captures the vault, link table, source membership and
per-group intent before the request, rechecking around awaited followers/hooks.
Held-source tests cover newer navigation, unlink/regroup, vault switch and
mid-follower changes. Cross-window tab-move source now allows main/popout and
popout/popout targets through the existing guarded live-leaf relocation path.
Closing/unavailable windows and views that cannot enter a window refuse.
Realm-safe event/node checks, target-document previews and target-window scroll
frames have regressions. Native `238eb82c` now passes actual OS main-to-popout,
popout-to-popout and return drags with the same dirty editor/history. Popout edge splits,
tear-out-to-new-window and wider original floating variants remain unfinished.

`npm run smoke:groups-popouts` and `smoke:groups-popouts:web` produce
`groups-popouts[-web]-smoke`, scope `workspace-groups-popouts`, with source
hashes. The scenario attaches to the real popup CDP target for typing,
Ctrl+Z/Ctrl+S, menu/modal Escape and close requests. A blocked browser popup must
be an explicit lossless refusal, never a fake window.

Native attempts have exercised linked leaves, live popout ownership, real
typing/Undo/Save and menu/modal cancellation. The corrected held-mutation
barrier and return now complete in the
[retained diagnostic](../Engineering/EVIDENCE.md#safeguards-and-diagnostic-follow-up-2026-11-02),
but early audits contained 19/24 unexpected ResizeObserver window errors. The
first observer hook was lost at the scenario's own reload; later persistent
per-realm traces identified the live `pop-b` CodeMirror scroller in the already
destroyed popout document before main adoption. The confirmed-close chain was
synchronous, but its closed-state detector could wait for a 500 ms poll after
`pagehide`. The isolated short-recheck fix now passes the normal-return barrier
diagnostic with zero records through final teardown.

That is not a complete window acceptance: the full native run's intended veto
step used CDP `Page.close`, reached the unapproved-close path and accumulated
315 ResizeObserver errors plus its notification through teardown. A replacement
fixture posts real `WM_CLOSE` only to an exact-title window of the owned Electron
PID; that user-close route now passes with its single expected veto notification
and zero unexpected records in a bounded native attempt. Later complete isolated
native and allowed-popup actual-folder WASM collections pass on `c207ecf5`:
12/22 checks, each with one expected veto record, no unexpected records and final
teardown included. The separate blocked-popup control is not full acceptance.
The native collection includes physical guest ownership and Reader handover.
The later `a1313670` forced-close focus separately verifies dirty-editor
recovery/input/retry with a clean final audit. Main `600ab1b2` now passes its
13-check native collection including fresh-controller construction. Its WASM
22-check and separate 15-check control reports pass feature/final-error audits
but did not record/reject forced process cleanup. `be27616d` correctly fails the
subsequent explicit-exit check despite feature success. The corrected shared
nonce/drain protocol has a real positive zero-exit/no-force proof in the
`e9185aa8` native-recents browser boundary. The later full allowed-popup
`238eb82c` collection now also passes all 22 labels, strict final audit and
positive acknowledged/drained code-0 exit with no force. The separate current
`238eb82c` native OS scope passes below; broader variants remain separate.
Earlier failed reports remain retained.

The later measured `e9185aa8` OS attempt passes native layout on a
3840-by-2292 work area at 216 DPI, including scaled production minima and
three non-overlapping owned windows. It then refuses the source endpoint at
screen point `1263,62` before pressing the mouse button: the hit window does
not match the expected owner. Actual/root/foreground ownership was not yet
retained, so the cause is unestablished. Its final audit has zero records and
both owned native processes were independently found exited; this is neither
a layout-capacity failure nor proof of OS dragging.
The later `e0f003ae` structured diagnostic identifies the immediate obstruction:
focus acquisition returns false and the hit/root and foreground window belong
to a different PID. Its strict ownership guard stops before mouse-down, with
zero final error records and both owned native processes exited. Temporary
owned-window z-order preparation/restoration was still unaccepted in that
diagnostic epoch. The later actual OS scope below establishes its bounded result.

The later [actual OS scope](../Engineering/RoadmapIntegration/2026-11-02/groups-os-drag-238e/groups-popouts-os-drag-smoke.json)
passes on `238eb82c` with `osDragVerified:true` and `mockDriver:false`.
Real Windows mouse input moves the same dirty live leaf/view/CodeMirror
main -> popout 1 -> popout 2 -> main. All nine fresh physical HWND/PID endpoint
checks pass; pin/link group, source selection/siblings and exact dirty text
remain intact, followed by real Undo/Redo/Save. The 216-DPI layout preserves
production minima. A one-time exact-owned topmost preparation makes only these
fixtures unobscured; all three original topmost states and HWNDs are verified
restored before cleanup. The final audit has zero records, and both owned
native processes were independently found exited. Earlier refusals remain
distinct; no scripted DOM drag is counted as OS input.

Remaining limits: broader OS/input/display variants are not established by this
single Windows scope. Dock-edge splitting and pane-resize handles remain
main-window-only; broader editor/observer/focus behaviour, arbitrary browser
popup policies, stylesheet/theme variants and native bounds semantics are not
established by the bounded pair. Model tests:
`tests/workspace-groups-popouts.test.mjs`; native scenario source:
`tools/workspace-popout-scenarios.mjs` retains failed attempts separately;
the accepted isolated typing/history/barrier/close/return collection does not
establish every timeout/retry/forced-close variant.

## Using saved layouts

Enable **Workspaces** under **Settings > Core plugins**, then use **Manage
workspaces** from the ribbon or command palette. Save, load, rename and remove
named layouts in `.obsidian/vault-dotnet-workspaces.json`. Saving a layout first
saves open documents; loading uses the existing staged transition and refuses
dirty-save conflicts or view close/load failures without abandoning the previous
workspace.

Choose **Import Obsidian workspace**, select a profile from the vault's
`.obsidian/workspaces.json`, review its pane count and compatibility notes, and
choose the destination name. **Import layout** saves a separate local profile.
Use its **Load** button to apply it. Existing names require the explicit
**Replace existing workspace** checkbox. Closing the review performs no import.
The command palette also exposes **Import Obsidian workspace**.

Each saved row has **Export to Obsidian**. This exports that saved layout; save
the current layout first to include recent layout changes. Review the destination
name and use **Export saved layout**. Replacing an existing original profile
requires the explicit checkbox. Export preserves other profiles, top-level
unknown configuration and the original active-profile selection. It can also
create `workspaces.json` when it is absent. No normal save, load or import writes
the original named-profile file. Obsidian's automatic `workspace.json` remains
untouched throughout.

## Supported conversion and preservation

The supported tree contains a main split, nested horizontal/vertical splits,
tab groups, selected tabs, leaves, active leaf, Source/Reading/Live Preview modes, pins and
sidebar widths/collapse state. Omitted original defaults such as tab zero and
an expanded sidebar are understood. Empty original sidebars are supported.
Unavailable view types keep their original type and opaque state in visible
unavailable panes. A missing Markdown file or a failing registered view causes
the existing guarded load to fail, rather than silently discarding the pane.

Every imported profile retains its complete original JSON under
`obsidianImport` in the separate local profile. Saving or renaming that profile
retains this provenance. Export merges supported state by stable pane IDs into
the existing destination profile or the retained original template, preserving
opaque layout/node/view fields. UTF-8 BOMs survive writes. JSON whitespace and
key order may change during an intentional export; notes are never rewritten
by profile exchange. Special JSON object names use own properties; original
profile names with surrounding whitespace are matched exactly.

Supported positive main-pane `dimension` values now restore active
[pane proportions](PANE-RESIZING.md), and resized values export with the profile.
Stacked tabs, ribbon preferences and other
unknown data remain retained for export without active behavior. The observed
`floating` window shape converts through the existing independent window model;
unobserved/refused entries stay verbatim (see [Linked groups and popout windows](#linked-groups-and-popout-windows)). Obsidian `group`
ids on leaves now import as linked groups and export back by leaf id. Standard `mode` and Boolean `source` flags
now restore actual Live Preview rather than a Source fallback. Legacy
`livePreview: true` maps to `source: false` only if no explicit source flag is
present; the original opaque data remains retained. Invalid non-Boolean flags
reject before import. Sidebar widths fit the supported 160–600 pixel range; an out-of-range original width
is retained for export until the supported width changes. Unsupported original
tree shapes and an active leaf outside the imported trees produce explicit
errors. Original-import history and full original/native/private interfaces remain
unestablished.

## Guards and limits

Each transfer requires a live review for the same vault and local profile
document. Both files are re-read before applying; external changes, obsolete
reviews, disabled modules and changed local profiles reject the action.
Destination writes use the existing root/version configuration contract. An
overwrite checkbox never bypasses version conflicts. A transfer changes one
configuration file; no cross-file atomicity or browser cross-application
transaction is claimed.

Trees are limited to 4,096 items and 64 levels with unique 1–64 character
alphanumeric/hyphen/underscore IDs. View state uses the existing finite-JSON
object/depth limits. Names are 1–128 characters without control characters.
Malformed/lossy configuration JSON, unsafe Markdown paths, invalid selection or
pin fields and invalid sidebar state are rejected before a destination write.
Original files are parsed as data; importing does not enable community plugins.

## Evidence and reference boundary

The pinned Obsidian 1.12.7 comparison format uses `workspaces` and `active`,
with named layout values and `mtime`, top-level leaf pins, optional
zero-tab/collapse defaults and serialized split sidebars. Actual
original-runtime import/export equivalence is not claimed.

Five model tests cover exact opaque-data round-trip, edited state, fresh export,
malformed/path/cycle refusal and resource limits. The original integration
regression passed **164 tests**. The editing-mode integration passes **174
tests**, with zero failed/skipped, and renews both hosts' four focused groups,
including actual imported `source: false` Live Preview. Four focused shared
runtime groups exercise:

1. Actual import review/selection/cancel, malformed profiles, name replacement,
   special names, original bytes and unchanged active panes.
2. Real imported Source/Reading/Live Preview/pin/sidebar/unavailable panes, stale-source
   rejection and retention of dirty editors and external note bytes.
3. Actual new/replacement exports, original-shaped JSON/BOM and opaque data,
   unrelated/active profile preservation and source/destination conflicts.
4. Owned disable/re-enable cleanup, retained-action refusal and fresh process
   restart or actual-folder browser reload/reconnect.

Reproduce after building the respective hosts:

```powershell
npm run smoke:workspaces
npm run smoke:workspaces:web
```

Reports: `.runtime/evidence/workspaces-smoke.json` and
`workspaces-web-smoke.json`; the latter includes 12 storage/picker bootstrap
groups. Screenshots: `workspaces-desktop.png` and `workspaces-web.png`.
The reports bind their results to actual build/scenario hashes. Focused results
do not update the frozen 31-module/140-case totals or establish deployment.
