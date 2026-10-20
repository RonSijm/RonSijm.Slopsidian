# Build, deployment and performance

[Feature-parity index](../FEATURE-PARITY.md)

## Build and distribution

| Capability | Status | Detail |
|---|---|---|
| Independent desktop rebuild/run | Verified subset | `build-and-run.cmd`; .NET/Node/Electron dependencies, no original Obsidian install required. |
| Separate WASM rebuild/run | Verified subset | `build-and-run-web.cmd`; shared UI/editor without a production ASP.NET backend. |
| GitHub build/deploy workflows | Present | Windows build/publication and GitHub Pages branch deployment configuration. |
| Root custom-domain assets | Locally verified configuration | Explicit `--base=/`, published `CNAME` containing `slopsidian.md`, asset/base/compressed-index/fallback checks. |
| Live deployed result | Not established by local publication | A workflow redeploy is necessary for source changes to reach the live site. No push/deployment is implied by local edits. |
| Windows installer / updates | Missing | No accepted packaged installer, update channel or release workflow equivalent to the reference. |
| Obsidian-style automation/deep links | Missing | Launch scripts/arguments are not full command-line, protocol or automation API compatibility. |

The shared runtime now dispatches real in-app CLI callbacks, including the
unchanged Templater handler on both hosts. This does not add a Windows command
executable, protocol handler or OS CLI compatibility.

The custom-domain deployment must resolve assets from
`https://slopsidian.md/`, **not**
`https://slopsidian.md/RonSijm.Slopsidian/`.
Repository-subdirectory hosting is an explicit alternative build setting, not
the default for this domain.

## Startup and on-demand loading

RonSijm.Blazyload was researched; no dependency or integration is currently
implemented.

The current research direction is to prefer a fast static landing/loading
experience, controlled application startup and measured JavaScript
minification/splitting before adding more loading infrastructure.
Blazyload could be useful for future optional .NET assemblies, but is not a
drop-in loader for CommonJS Obsidian plugins or a substitute for missing APIs.

No measured startup/bundle-size target has yet been accepted. Large-vault
indexing, rendering, worker memory, responsiveness and plugin resource loading
need benchmarks rather than assumptions.

The bundled Mermaid 12.2.0 engine is a separate on-demand sandbox script, about
5.4 MB minified before compression. Its local HTML/script and generated
`mermaid-licenses.txt` dependency notices are included in both hosts and in
static asset verification. This is a packaging observation, not an accepted
startup/performance budget; [runtime scope](../Features/MERMAID.md).

Trusted plugins now also have a separately lazy/cached actual Mermaid API in
`js\mermaid-api.js`, with its generated `.LEGAL.txt` sidecar. This does not
replace or relax the core sandbox. Both hosts publish `icons-LICENSE.txt` for
the added Lucide glyphs. Current browser scopes bind 22 published assets,
rather than the historical combined epoch's 19.

Desktop's main-document CSP explicitly permits same-origin/Blob workers:
`worker-src 'self' blob:`. Actual Dataview workers were previously blocked by
the enforced policy. Remote font/image/network rules are not broadened, and
the separate Mermaid frame retains `worker-src 'none'`. The stable native App
store uses built-in SQLite in the tested Electron runtime, not a new database
package or browser backend.

Plugin loading also exposes real CodeMirror 5.65.21 alongside the CodeMirror 6
editor (the latter uses the `codemirror6` npm alias). The unchanged HyperMD
0.3.11 mode, CSS and MIT license are hash-checked vendored inputs; no obsolete
unrelated HyperMD dependency tree is installed. The UI build emits
`editor-host.css`, `codemirror-license.txt` and `hypermd-license.txt` for both
hosts. This is a genuine classic tokenizer bridge, not Obsidian's private fork;
[compatibility limits](../Compatibility/PLUGIN-API.md#renderer-ownership-and-tokenizer-limits)
and startup/performance acceptance remain separate.

Actual Templater checks additionally require the pinned unchanged release in
`.runtime\compatibility\templater-2.20.6`. These local inputs and generated
evidence are not guaranteed to exist in a fresh clone. Ordinary application
builds do not require this plugin or an Obsidian installation.

The six exact-version scope additionally requires all original assets under
`.runtime\compatibility\reported-plugins`; the scenario verifies their pinned
hashes rather than replacing them with current releases. Use
`npm run smoke:reported-plugins` and `npm run smoke:reported-plugins:web`
sequentially after the respective builds. Both currently exit nonzero for
Excalidraw 2.22.3's settings callback despite successful startup for all six.
The same scope separately checks ordinary note navigation through App, leaf
and actual File explorer actions with all six enabled; that positive result
does not turn the failed settings corpus into a pass.
Third-party compatibility fixtures are not needed for an ordinary application
build. Current local build/publication results do not mean these changes have
reached `slopsidian.md`.

The separate drawing scope requires unchanged Excalidraw 2.29.0 assets in
`.runtime\compatibility\excalidraw-2.29.0`. After building both hosts, run these
actual UI scopes sequentially:

```powershell
node tools\smoke.mjs --excalidraw
node tools\web-smoke.mjs --excalidraw
```

They exercise drawing, linked PNG insertion, compressed physical persistence,
reopen/restart, owned lifecycle and the original plugin's SVG Reading embed.
They do not replace the exact 2.22.3 corpus or establish full plugin parity.
The browser runner uses the real Windows folder picker and checks the returned
directory identity; it does not substitute an in-memory vault. Disposable UI
launches disable Windows occlusion/background throttling, record those flags
and bind the picker helper's bytes. Native UI launches use the same explicit
disposable-process policy on first launch and restart; an intermittent
remote-page input timeout remains retained without a claimed production root
cause. Trusted pointer clicks use painted client rectangles so wrapped links
are not targeted at whitespace inside their union bounding box; native focus
is requested before measuring that geometry. Real CodeMirror numeric-edit
scenarios select/type the price rather than injecting whole-document newline
sequences, while still asserting exact original BOM/CRLF, metadata and Undo/Redo.
The separate native community renewal retains file-lock and post-reload
Settings failures; [current evidence](EVIDENCE.md#lifecycle-and-leaf-app-renewal)
does not present these as an all-green combined run.
Production launch flags are unchanged.
