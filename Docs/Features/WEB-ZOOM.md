# Desktop Web viewer zoom

[Feature-parity index](../FEATURE-PARITY.md) · [Web viewer](WEB-VIEWER.md) · [Reader](WEB-READER.md)

**Ownership:** Codex, claimed and completed 2026-10-22. The independent desktop
zoom subset is accepted; the wider reference module remains partial.

**Per-site zoom ownership:** Codex, claimed 2026-10-24; completed 2026-10-25.
[Remember/Forget/Clear site preferences](#site-preferences), bounded vault-local
profile persistence, native navigation/open-pane application, stale guards and
Reader/restart/vault preservation pass. Gestures, original private APIs and
broader runtime comparison remain separate.

## Using it

Open a desktop Web viewer tab. Its **−**, percentage and **+** controls zoom
out, reset to 100% and zoom in. Supported factors are **50–300%**, with **10
percentage-point steps**. Buttons disable at the bounds; rapid requests also
clamp in the native host.

The owned commands use the reference identifiers `webviewer:zoom-in`,
`webviewer:zoom-out` and `webviewer:zoom-reset`. Their palette names are
**Zoom in web page**, **Zoom out web page** and **Reset web page zoom**.
Ctrl/Cmd+Plus (or Equal), Minus and Zero request the same actions in the
toolbar and Reader. Native page key/wheel handlers are also wired. These
controls scale the active web page or Reader rather than the editor shell.

Each tab retains an independent numeric `zoomFactor` in its normal leaf state.
Older leaves without that field default to 100%. Unknown leaf fields are
retained. Explicit invalid factors are refused before navigating or replacing
the current Reader. Disabling the provider keeps unavailable leaf state for
later restoration. Zoom does not write a separate settings file or modify the
article's HTML/Markdown.

## Site preferences

On a loaded HTTP(S) page, set the desired **50–300%** zoom and open **Site
zoom** beside the percentage controls. Choose **Remember N% for this site**
to save that exact factor. The menu shows the origin and any saved factor;
keyboard Enter/Space selects an enabled action, arrows move through actions,
and **Escape** closes without saving and returns focus to Site zoom.

A saved preference applies to new tabs and successful main-frame document
navigation, including Reload, Back and Forward. Matching open native pages
and Readers receive a newly saved factor in place, including hidden panes.
No page reload or article extraction is needed. Existing frame identity,
fractional Reader progress, Find and literal clipping remain available.

A site is its exact **scheme, host and port**. Paths, queries and fragments
share one preference; another subdomain, scheme or port is independent.
Normal in-page navigation does not reapply a preset. Manual zoom changes
remain local to their tab until Remember is chosen again; a later document
navigation reapplies the saved factor. Without a matching preset, ordinary
per-tab zoom continues across navigation, and a new tab defaults to 100%.

**Forget zoom for this site** removes one preset. **Clear saved site zoom**
removes this vault's entire saved map. Both retain the current factor in open
tabs; use the existing percentage reset to return the current tab to 100%.
Reset alone does not forget a saved preference. Saving 100% explicitly is
supported. The cache keeps at most **100 most recently saved origins**;
reads and unchanged saves do not reorder it or write defaults.

Preferences use this computer's existing **vault-scoped local profile
storage**, under `webviewer-site-zoom-v1`. They do not sync or move with
vault files, and do not change notes, Web viewer settings, browsing history
or removal checkpoints. Normal leaf state still stores the current
`zoomFactor`; the origin map and menu reviews are not added to it.
Normal entries contain only origin and factor. Valid opaque profile fields
survive supported writes. Malformed/unsupported versions remain untouched
with Remember unavailable until explicit Clear saved site zoom; unrelated
profile keys remain intact.

A menu captures its source root/provider lifetime, profile generation,
navigation, zoom revision and view owner. Changed, closed, replaced, disabled
or foreign owners refuse before even an unchanged save. Native maps validate
atomically, reject older/equal revisions and apply current-origin changes
even if a newer update for another origin arrives first. Provisional pages
retain the map and select their preference only on final committed navigation.
Late renderer acknowledgements cannot revive an older profile generation or
provider lifetime. Failed native zoom leaves its acknowledged factor intact.
Remember/Forget/Clear do not fetch or reload a page; normal site activity can
continue. Existing native page isolation and Reader authentication remain.

### Site-preference evidence

Ten new regressions and the preceding zoom/favicon cases pass: **25 focused
tests**, **476 unit/API tests** in total. `npm run smoke:web-site-zoom`
passes **153 cumulative groups/67 sessions/139 snapshot-bound hashes**.
The four-group/three-session standalone report binds identical inputs.
Native/root-base WASM builds and static serving pass. Native Web viewer
remains unavailable in WASM; this does not add browser-host site zoom.

Actual menu pointer/keyboard/Escape controls, native pixel ratios, two origins,
Go/Back/Forward/Reload, independent manual tabs, Forget/Clear, hidden Reader
frame/progress/Find/exact clipping, full enabled/disabled restarts and repeated
same-origin vault switches pass. Applicable workflows retain exact notes,
settings, paused history, original workspace, profile canaries and BOM/CRLF/
Unicode bytes. Scheme/subdomain bounds, mixed profile data and obsolete/
native ordering/lifecycle entry use bounded fixtures. Four final captures
were visually reviewed, including the fully restored Reader's saved menu.

Create-only `site-zoom-acceptance.json` checks all 479 snapshot sources,
both reports, published assets, current feature-source equality and 17
captured contributor inputs. Recorded revisions retain and correct a
nine-test/eight-pass/one-fail native ordering regression and a separate
ten-test/nine-pass/one-fail provisional-page regression. Three UI attempts
retain incorrect wheel/Find position assumptions, including the inherited
narrow split; corrected scenarios measure actual positions before asserting
preservation. The earlier successful
but still-preparing final capture remains retained too. No missing-feature
baseline is claimed. Broader private/runtime/DPI/gesture equivalence and
incomplete integration remain separate.

## Native and Reader behavior

The same small shared policy validates finite numeric factors and computes
bounded steps in both hosts. The native surface uses Electron's
[`setZoomFactor`](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoomfactorfactor)
and reapplies the desired factor on document readiness across origins. Each
pane already has its own ephemeral website session, which is exercised for
same-origin tab independence rather than assuming Chromium's origin-based zoom
policy supplies it.

The main process computes each action from the latest factor and acknowledges
it only after setting the native surface. A monotonically increasing revision
lets the client discard old zoom replies. A native failure or destroyed surface
leaves the acknowledged model unchanged. Renderer actions also discard late
results after pane disposal or a vault change.

Reader applies CSS zoom inside its opaque sandbox. Initial values are validated
before constructing the document; subsequent messages require the exact parent
and random session token, with the same numeric bounds. A newly ready frame
receives the latest factor even if zoom changed during extraction/loading.
Find selections and the normal original-page/Reader toggle remain available.
Zoom does not reload or re-extract an already displayed article.

The main window's native zoom accelerators belong only to the visible active
Web viewer pane. Modal/popover and vault-transition bounds release that
ownership. Native page handlers keep their page focused; toolbar/Reader
handlers prevent duplicate default actions. The native hook is removed when
the application window closes, and closing/disabled views remove their owned
controls/commands/native contents.

WASM leaves this desktop provider explicitly unavailable and preserves opaque
desktop state; building its shared client does not establish browser Web viewer
or Reader support.

## Evidence

The latest [title/address history sorting](WEB-VIEWER.md#title-and-address-order) renewal passes
**165 cumulative Web viewer groups/73 sessions/150 hashes**, all **502 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual six-choice Order, matching rows/archives/Reading/selected tabs,
queued round-trip refusal, independent panes and full restart/repeated-vault
isolation. Results bind the recorded 490-source isolated snapshot with
17 contributor inputs and five reviewed captures. Locale/natural ranking,
other sort keys, original private/runtime parity and broader integration
remain separate.


The earlier [selected-history tab opening](WEB-VIEWER.md#open-selected-visits) renewal passes
**161 cumulative Web viewer groups/71 sessions/148 hashes**, all **494 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual review/selection/order/new tabs, limits/version/queued/partial
refusal, paused/inverse and ordinary recording behavior, full enabled/disabled
restart and repeated-vault isolation. Results bind the recorded isolated
snapshot; 17 contributor inputs and later shared differences are retained.
Tab-open acknowledgement does not establish remote-page loading; persistent/
background batches, original private/runtime parity and broader integration
remain separate.


The earlier [full-page Markdown clipping](WEB-CLIPPING.md#full-page-markdown) renewal passes
**157 cumulative Web viewer groups/69 sessions/144 hashes**, all **484 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual Save page/command, original-document capture from Reader,
short/unsupported pages, exact reviewed properties/save/Reading, collision
and navigation refusal, full enabled/disabled restart and repeated-vault
isolation. Results bind the recorded isolated source snapshot; 17 contributor
inputs and later shared differences remain retained. Unloaded/shadow/frame/
media/visual capture and broader incomplete integration remain separate.


The earlier [per-site zoom](WEB-ZOOM.md#site-preferences) renewal passes
**153 cumulative Web viewer groups/67 sessions/139 hashes**, all
**476 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover actual pointer/keyboard preference menus, native
pixel scaling and origin navigation, Forget/Clear, in-place hidden Reader
progress/Find/unchanged clipping and full enabled/disabled restart/repeated
same-origin vault isolation. Results bind the recorded isolated source
snapshot; 17 contributor inputs are captured and later shared changes are
retained. Native gestures, original private/runtime equivalence and broader
incomplete integration remain separate.


Six new unit/native regressions cover strict factor validation, bounded repeated
steps/reset, shortcut keys, destroyed/failed native surfaces, sequential
acknowledgements, navigation reapplication and Reader document policy. At the
original zoom milestone, the full regression passed **213 tests**, zero
failures/skips; `web-zoom-regression.log` and `.json` retain that result and its
source/artifact identities. The combined-tree 213-test renewal is retained in
`combined-runtime-regression.log`.

`npm run smoke:web-zoom` passes **31 focused desktop groups**: the preceding
six browsing, seven history, six Reader and six clipping groups, plus six zoom
groups. `.runtime/evidence/web-zoom-smoke.json` now binds **48 stable artifact
hashes** across **11 full Electron/.NET process sessions**. The report verifies
the hashes before restarts and at completion, including the extraction legal
sidecar added after the earlier 47-hash report. Native and root-base WASM builds
and static serving verification pass.

Actual native device-pixel ratio and viewport changes prove scaling; a second
same-origin tab and editor shell keep their original scale. Navigation includes
two distinct local origins, reload, back and forward. Reader geometry, authenticated
messages, Find, toolbar/Reader keyboard input, rapid bound/reset actions,
opaque state, enabled/disabled restarts, modal ownership, invalid leaf factors
and actual vault switches are exercised. Settings and original workspace bytes
remain unchanged. `web-zoom-native.png`, `web-zoom-reader.png` and
`web-zoom-restored.png` were visually reviewed. This renewed cumulative scope
now accompanies matching complete native/actual-folder WASM, community,
Templater and renderer acceptance in the
[combined-runtime milestone](../Engineering/EVIDENCE.md#current-retained-evidence).
Nine immutable report copies and the separate source manifest preserve it;
the fixed core contract remains 132/140, not full product parity.

The initial UI attempts stopped before Web viewer setup because the Settings
pointer click did not reach the document. Passive tracing showed no pointer
events; an isolated probe also timed out waiting for animation frames. With
Windows occlusion/background throttling disabled only in a disposable process,
the same trusted pointer sequence reached the button and opened Settings.
The focused zoom launcher records these test-only flags; production launch
behavior is unchanged. The failed reports and both probe results are retained
under `.runtime/evidence/web-zoom-*` and `zoom-input-probe-*.json`.

The pinned comparison scope includes the three zoom command IDs and factor
changes of 0.1, nominally bounded from 0.5 to 3, with reset to 1.
Independent Reader scaling and leaf persistence do not establish
original-runtime, private-method, storage or visual equivalence.

## Remaining scope

Original-runtime/visual/private-API equivalence, touch/pinch gestures, exhaustive OS/menu/native-key and wheel acceptance,
cross-monitor DPI/accessibility/scale testing, custom Reader typography and
semantic reading anchors remain. The later [font/width preferences](WEB-READER.md#font-and-article-width)
and [fractional reading progress](WEB-READER.md#reading-progress) cover their
bounded desktop subsets, with 49 cumulative Web viewer groups renewed together.
