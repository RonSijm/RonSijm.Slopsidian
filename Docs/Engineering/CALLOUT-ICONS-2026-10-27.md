# Callout colors and icons · 27 October 2026

[Feature-parity index](../FEATURE-PARITY.md) · [Rendering](../Features/RENDERING.md#custom-callout-colors-and-icons) · [Plugin API](../Compatibility/PLUGIN-API.md#callout-colors-and-local-icon-coverage)

This closes the specific color/icon presentation gap retained by the earlier
[render-child acceptance](RENDER-CHILD-OWNERSHIP-2026-10-27.md). That change made
Admonition's fenced blocks render and interact, but screenshots still showed
transparent backgrounds and missing icons. Its original reports and captures
remain the before baseline.

## Host changes

The callout CSS expected comma-separated RGB components, while the supplied
Admonition 12.0.11 publishes complete `rgb(...)` colors. An owned Reading/static
style adapter now distinguishes those formats and selects compatible CSS
without rewriting the plugin's property. Style/class/content changes inside
the rendered subtree update the marker. Nested legacy callouts retain their
own title colors. Closing/rerendering disconnects the observer.

Host-created callout glyphs also follow `--callout-icon` when it names a known
local icon. Plugin-created title/icon nodes keep their own ownership and DOM
identity. Unknown identifiers and serialized SVG CSS values do not become
invented successful icon registrations.

The former builtin catalog had only 43 shell icons. Missing names such as
`check-circle` and `alert-triangle` produced empty external references. The host
now loads the verbatim [Lucide](https://lucide.dev/packages) `lucide-static`
0.468.0 sprite locally, retaining the existing shell templates. The importer
verifies the archive's pinned SHA-512 integrity, allows only SVG geometry tags,
copies the ISC license, and derives alias mappings without executing package
code. Builds verify committed asset hashes against
[provenance](../../vendor/lucide-static/provenance.json).

The sprite has 1,544 symbols and 210 generated alias mappings. The combined
catalog advertises 1,558 builtin IDs; the existing 43 shell templates retain
priority when names overlap. In particular legacy `edit` retains its existing
drawing. The other 209 alias mappings are exercised against canonical SVGs.
Explicit `lucide-` canonical names resolve the catalog glyph; custom registered
names still take precedence. Returned SVGs remain independent clones and
unknown `getIcon` requests remain null. No runtime CDN or registry is needed.

## Accepted evidence

The owned `.runtime/callout-icon-validation-20261027` source/build copy contains
the tested candidate. Shared checkout generated build artifacts were preserved.
The [receipt](Callouts/2026-10-27/receipt.json) binds implementation/scenario
inputs, vendored assets, reports, regression log and four screenshots.

| Check | Result |
|---|---|
| TypeScript / desktop build | Passed, zero desktop build warnings/errors. |
| Default regressions | [611 passed](Callouts/2026-10-27/regressions.log), zero failed/skipped. |
| Desktop renderer suite | [13 checks passed](Callouts/2026-10-27/renderers-desktop.json), 62 stable artifacts and six full desktop sessions. |
| Actual-folder standalone WASM | [25 checks passed](Callouts/2026-10-27/renderers-web.json), 24 assets and 28 scenario inputs; real external directory picker and reconnect. |
| WASM publication / static serving | Passed, including the new local sprite and license. The browser vault uses no desktop companion server. |

Twelve shared renderer/tokenizer groups include the preceding contracts plus
the new color/catalog group. Every advertised builtin ID supplies actual SVG
geometry primitives; the three configured custom icons additionally have
nonempty rendered bounds and the expected computed stroke colors. Returned
SVG mutation does not alter the stored icon template.

Actual custom callouts have green/red/purple titles and 10% backgrounds. The
orange warning and blue default retain their legacy values. Tests switch a
callout from a complete color to RGB components and back, verify a nested legacy
title, preserve a plugin-owned SVG through a style change, dispose the old style
observer and restore the original source presentation on rerender. Existing
collapse controls, links, disable/re-enable and restart/reconnect still pass.

The unchanged supplied Admonition `main.js`, `manifest.json` and `styles.css`
remain hash-identical in source and disposable vault. Both note fixtures retain
their BOM/CRLF bytes and unrelated enabled IDs remain intact. The earlier
failed validation attempts counted inactive tabs; the final checks scope the
active Reading leaf and preserve those attempts separately.

Both reports retain zero uncaught browser exceptions. Desktop console output
contains three intentional error-path probes and eleven WebSocket-1006
diagnostics with no assigned cause; this is not described as a clean console.

The [desktop fenced capture](Callouts/2026-10-27/admonition-desktop.png),
[desktop native-callout capture](Callouts/2026-10-27/native-callouts-desktop.png),
[WASM fenced capture](Callouts/2026-10-27/admonition-web.png) and
[WASM native-callout capture](Callouts/2026-10-27/native-callouts-web.png) were
visually inspected. They show the previously missing backgrounds and glyphs.

## Remaining boundaries

This verifies the stated Reading/static workflows on Slopsidian's two hosts,
not an original-runtime visual comparison. Admonition's minimum version is
1.13.0, above the supplied Obsidian 1.12.7 reference, so it was not forced into
that older reference.

The icon catalog is pinned to 0.468.0, not claimed to match the exact reference
application's inventory or later Lucide versions. Downloaded icon packs,
serialized SVG CSS icons, all builtin callout defaults, full authoring commands,
custom-code Live Preview widgets and complete native visual/CSS behavior remain
separate. Style-only changes outside the owned subtree that switch between
legacy-component and complete-color syntax can require rerendering; full
theme/snippet and scale acceptance are not established here.
