# Build, deployment and performance

[Feature-parity index](../FEATURE-PARITY.md)

The [2026-11-03 follow-up](CONTINUATION-2026-11-03.md) records renewed package
and timing results after changing native close ordering. Saved/checkpointed
renderers now close normally before draining the local host; save or native
vetoes retain it and restore editing. The prior package measurements keep their
historical source identities. Original-reference capture binaries and raw
outputs remain local and ignored; the application packages do not need them.

## Build and distribution

| Capability | Status | Detail |
|---|---|---|
| Independent desktop rebuild/run | Verified subset | `build-and-run.cmd`; .NET/Node/Electron dependencies, no original Obsidian install required. |
| Separate WASM rebuild/run | Verified subset | `build-and-run-web.cmd`; shared UI/editor without a production ASP.NET backend. |
| GitHub build/deploy workflows | Present | Windows build/publication and GitHub Pages branch deployment configuration. |
| Root custom-domain assets | Locally verified configuration | Explicit `--base=/`, published `CNAME` containing `slopsidian.md`, asset/base/compressed-index/fallback checks. |
| Live deployed result | Not established by local publication | A workflow redeploy is necessary for source changes to reach the live site. No push/deployment is implied by local edits. |
| Windows installer / updates | Unsigned local portable/installed workflows verified | `npm run package:desktop` stages an allowlisted self-contained Windows host and Electron runtime into a portable ZIP and an IExpress per-user installer. Installation validates/stages before replacement; removal preserves modified files, user data and vaults. Actual portable/installed editing, creation, restart and owned uninstall now pass. Signing, publishing and updates remain outstanding. |
| Obsidian-style automation/deep links | Missing | Launch scripts/arguments are not full command-line, protocol or automation API compatibility. |

The shared runtime now dispatches real in-app CLI callbacks, including the
unchanged Templater handler on both hosts. This does not add a Windows command
executable, protocol handler or OS CLI compatibility.

**Packaging safeguards, reviewed 2026-11-02.** Package scanning rejects local
reference/private directory families and original application archives. Text
assets are scanned as streams, including large bundles and matches spanning read
boundaries. After an upgrade commits the new installation and registration,
failure to remove the old backup reports its retained path without rolling the
new installation back to a partially deleted backup. These source/regression
changes pass the separate current-package installed/portable walkthroughs; see [current evidence](CONTINUATION-2026-11-03.md).

The custom-domain deployment must resolve assets from
`https://slopsidian.md/`, **not**
`https://slopsidian.md/RonSijm.Slopsidian/`.
Repository-subdirectory hosting is an explicit alternative build setting, not
the default for this domain.

## Offline application shell

**Current combined-source collection accepted, 2026-11-03:** 18 scenarios and
21 enforced browser pages pass with clean acknowledged exits. [Evidence](INTEGRATION-WAVE-2026-11-03.md).
The standalone publish writes an `offline-manifest.json` containing the
deployment base path, version, service-worker build and each published asset's
size/SHA-256. `verify:web` recomputes it from the published files. Authored
JavaScript, including the shell controller and worker, participates in the
source fingerprint; generated desktop bundles remain excluded.

The start page's explicit **Prepare offline app** action verifies a complete
manifest-defined set before writing its adoption pointer. The worker serves
only that adopted version inside its scope, revalidates the stored manifest and
served bytes, and refuses missing/corrupt assets with 503 instead of mixing them
with a newer network version. Preparation, adoption, cleanup and removal require
exclusive cross-page Web Locks ownership; unavailable locks or ownership refuse.
HTTPS/localhost, service workers, Cache Storage and Web Crypto are also required.

Cache ownership is base-specific, including an exact version suffix; a nested
base containing `:` is not an older version of its parent. Removal and
post-adoption cleanup preserve other bases and unrelated caches. Removal deletes
only its own adoption pointer and versioned files; the shared metadata container
is retained even if empty because another base can adopt into it under a
different lock. Failed worker lookup/unregistration reports partial removal
explicitly rather than silently claiming the worker is gone.

Shell preparation neither downloads a vault nor restores folder permission.
GitHub snapshot downloads and the explicit complete cached-note index remain
separate operations. No GitHub traffic, vault data or credentials are cached by
the service worker. Browser eviction/clearing and corrupt entry/adoption records
can require clearing site data and preparing again.

Removal now checks that this base's adoption record and versioned files are
actually absent and reports retained storage as a partial removal. A worker
lookup for a nested base may return an ancestor application's registration;
only an exact scope match may be unregistered. An unconfirmed own-worker
unregister remains an explicit partial failure. Focused storage/ownership tests
cover these safeguards; the combined real-browser collection is recorded
separately.

The [complete isolated collection](EVIDENCE.md#safeguards-and-diagnostic-follow-up-2026-11-02)
passes 16 scenarios across 17 browser processes on source `76215745`. It covers
real cold/relaunch boot, cached-route/index behavior, corruption/eviction,
worker-only/full updates, cancel/resume and scoped removal. Every page enforces
its final error/load/HTTP policy through positively acknowledged clean exit,
with zero unexpected records and no forced kill. The quota case explicitly
injects a `QuotaExceededError` after proving the requested CDP cap was not
enforced by Cache Storage; physical storage exhaustion is not accepted.

The pointer is written
before registering the next worker; pointer failure therefore leaves the
previous worker untouched, and registration failure attempts a guarded pointer
restore with failed compensation reported explicitly. Those steps are still not
one browser transaction: a new worker can install before readiness rejects,
leaving its version different from the restored old pointer and causing offline
503 responses until Prepare is run again. Retained old cache bytes alone do not
prove that the prior app remains runnable. No live deployment is implied.

The [source-bound profile diagnostic](EVIDENCE.md#safeguards-and-diagnostic-follow-up-2026-11-02)
isolates a Windows harness path-length confounder: all 32 writes succeed under
the short owned profile, while all eight long-profile cases fail at
`CacheStorage.open` before any write. The isolated harness now places ordinary,
cancel and quota profiles under its exclusively owned short temporary home;
production Cache API semantics are unchanged. Cancel/resume/scoped removal and
unchanged-source metadata tamper diagnostics now pass, but the older focus
reports are not complete teardown-audited acceptance. A 64 KiB CDP quota request
still allowed an 80.1 MiB prepared copy; the later harness records actual
enforcement separately from explicitly injected quota faults. Strict audit
hardening also exposed a cold-page shutdown timeout, which is not excused as a
successful teardown. The later fixture-only nonce/main-frame quit channel
retains audits through real exit and passes the complete collection; the older
stdin failure's cause is still not established. The short probe's native
temporary-index warning stays retained.

Accepted bounds: Electron/Chromium with stopped-server network-off phases, not
all browsers or physical quota enforcement. Damaged HTML/adoption/manifest
recovery still requires explicit site-data clearing and preparation again.
The historical isolated shell collection used the real host indexing method.
The current combined matrix separately includes native and actual-folder WASM
index-modal pointer workflows for Prepare/Cancel/Resume and missing/corrupt/
complete outcomes. Private credentials, live deployment and the worker-ready/
pointer rollback boundary remain outside this acceptance.

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

**Integration tooling, reviewed 2026-11-01.** `measure:bundles`,
`measure:startup`, `benchmark:large-vault`, `benchmark:metadata` and
`check:release-budgets` produce source/binary-bound local measurements.
The native metadata reader now overlaps at most sixteen file reads while
retaining deterministic results and strict byte/version/UTF-8 behavior.
Fresh source/package-bound local measurements are recorded in the [current
acceptance](CONTINUATION-2026-11-03.md). Older worktree reports remain
historical; no product performance budget is accepted. The earlier approximately fifteen-second package
close measurement was a CDP acknowledgement timeout in the measurement harness,
not established application close latency. The corrected harness observes
process exit and treats metrics, cleanup and command failures explicitly.
Unsigned builds do not establish distribution permission, code signing,
an update channel or reference-runtime equivalence.

The [2026-11-01 evidence collection](EVIDENCE.md#intermediate-roadmap-integration-2026-11-01)
includes a retained 5,000-note response from its recorded source epoch: first request 9,483.1 ms,
seven warm requests with an 843.4 ms median and no decoding errors. Development
was active during this run, so neither a controlled regression comparison nor
a release budget is accepted. The earlier 1,756.8 ms / 212.8 ms intermediate
measurements retain their different source/binary identity as historical
evidence, not current performance. An
allowlisted unsigned portable build from that intermediate checkout is also
retained as historical; the current installed/portable UI walkthroughs now pass separately.

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
