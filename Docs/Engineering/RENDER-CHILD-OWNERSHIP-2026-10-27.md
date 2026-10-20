# Markdown render-child ownership · 27 October 2026

[Feature-parity index](../FEATURE-PARITY.md) · [API contract](../Compatibility/PLUGIN-API.md#renderer-ownership-and-tokenizer-limits)

Admonition 12.0.11 previously failed to render fenced blocks because the host
required a render child's element to be inside the finished Markdown section
at registration. The unchanged plugin registers title and body children while
constructing a detached replacement, then inserts that replacement. The
[earlier failure](Examples/2026-10-26/admonition-fenced-limitation.json) remains
retained as the baseline.

The host now permits that construction order without retaining abandoned
children indefinitely. Same-document detached children are adopted on insertion;
never inserted children unload when processing completes or fails. Removal after
adoption, an inactive render and disposal release ownership. Connected foreign
elements, foreign documents and duplicate component owners are rejected.
Registration after processing permits insertion in the same synchronous turn.

Teardown waits for pending loads and joins observer-started unload operations.
For shared components it uses `unloadAndWait`, preserving asynchronous cleanup
when a native-style `unload()` override calls its superclass without returning
the promise. Disposal is idempotent and repeated callers await the same cleanup.

## Retained checks

All checks use the owned `.runtime/render-child-validation-20261026` source/build
copy. Shared checkout build artifacts were not regenerated. The
[receipt](RenderChildren/2026-10-27/receipt.json) binds the accepted reports,
screenshots, regression log and implementation/scenario inputs.

| Check | Result |
|---|---|
| TypeScript and desktop build | Passed; NuGet vulnerability-feed lookup warnings retained. |
| Full default regression suite | [611 passed](RenderChildren/2026-10-27/regressions.log), including ten new focused lifecycle tests; zero failed/skipped. |
| Desktop renderer suite | [12 checks passed](RenderChildren/2026-10-27/renderers-desktop.json), 60 stable artifact hashes, actual .NET/Electron host and full process restarts. |
| Standalone WASM renderer suite | [24 checks passed](RenderChildren/2026-10-27/renderers-web.json), 22 assets and 28 scenario inputs; actual external directory picker and reload/reconnect. |
| WASM publication/static serving | Passed, including compressed pages and standalone assets. No desktop vault server supplies the browser vault. |
| Package preservation | The supplied Admonition `main.js`, `manifest.json` and `styles.css` hashes remain identical in the source and disposable vault. Note BOM/CRLF and unrelated enabled IDs remain intact. |

Eleven shared scenario groups comprise eight existing renderer/tokenizer groups
and three additional groups. The new groups exercise real asynchronous detached
title/wrapper construction and mutation delivery, never inserted children,
observer-started asynchronous native-style unload, retained inert controls,
actual Admonition fenced title/body formatting, collapse controls, source-relative
links, Source/Reading transitions, disable/re-enable, static rendering and
restart/reconnect. Bootstrap checks account for the different per-host totals.

Both reports retain zero uncaught browser exceptions. Desktop console output
contains three intentional error-path probes and eleven WebSocket-1006 diagnostics;
the latter have no assigned cause and are not described as a clean console.
The full regression suite requires loopback access, and WASM publication requires
MSBuild task-host process access; restricted attempts failed before the accepted
runs. Two fixture assertions were corrected during validation: the probe needs a
manifest description, and static owner unload clears the fragment's contents
while retaining its empty wrapper. A later debugger-endpoint startup attempt
failed before any scenario; the accepted retry is retained separately from that
attempt.

## Visual boundary and remaining work

**Follow-up:** [Callout/icon rendering](CALLOUT-ICONS-2026-10-27.md) now closes the
specific color/icon gap described below. This section and its original captures
remain the historical before baseline, not the current color/icon status.

The [desktop screenshot](RenderChildren/2026-10-27/admonition-desktop.png) and
[WASM screenshot](RenderChildren/2026-10-27/admonition-web.png) were inspected.
The fenced blocks now display their titles, formatted bodies, links and collapse
controls. Custom color/icon presentation is still missing despite configured
color values and SVG nodes. Reports record computed background/title colors and
icon dimensions so DOM presence is not mistaken for visual equivalence.

The host's callout CSS expects comma-separated RGB components, while this
package supplies `rgb(...)` values. Color-format compatibility and visible icon
styling require a separate visual-parity follow-up. No package code or stylesheet
was patched to hide this boundary.

Full Admonition authoring commands, custom-code Live Preview widgets, original
runtime/visual equivalence, complete renderer/private API behavior, all embeds
and math remain unestablished. Unregistered plugin listeners and arbitrary
fire-and-forget work do not acquire a new cleanup guarantee. The older Obsidian
1.12.7 reference is below this package's minimum 1.13.0, so this acceptance does
not force the newer package into that reference.

The Example decision register now includes an executable fenced comparison;
native custom-callout examples remain alongside it.
