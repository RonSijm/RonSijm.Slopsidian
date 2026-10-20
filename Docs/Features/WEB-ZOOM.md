# Desktop Web viewer zoom

[Feature-parity index](../FEATURE-PARITY.md) · [Web viewer](WEB-VIEWER.md) · [Reader](WEB-READER.md)

**Ownership:** Codex, claimed and completed 2026-10-22. The independent desktop
zoom subset is accepted; the wider reference module remains partial.

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

Original-runtime/visual/private-API equivalence, per-site zoom preferences,
touch/pinch gestures, exhaustive OS/menu/native-key and wheel acceptance,
cross-monitor DPI/accessibility/scale testing, custom Reader typography and
semantic reading anchors remain. The later [font/width preferences](WEB-READER.md#font-and-article-width)
and [fractional reading progress](WEB-READER.md#reading-progress) cover their
bounded desktop subsets, with 49 cumulative Web viewer groups renewed together.
