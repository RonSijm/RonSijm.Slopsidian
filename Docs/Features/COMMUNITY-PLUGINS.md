# Community plugins: browsing and package management

[Feature-parity index](../FEATURE-PARITY.md)

**Reviewed:** 2026-10-28. The bounded catalog/install/update/uninstall workflow
passes on Windows desktop and actual-folder WASM. Plugin execution still uses
the [experimental partial API 1.13.3](../Compatibility/PLUGIN-API.md); an
installable package is not proof that all its features work.

## Using the Community page

Open **Settings > Community plugins > Browse** in a writable local-folder vault.
Search the official Obsidian registry, select a plugin, and review its version,
author and GitHub release/repository links. Release selection checks the declared
minimum API version and, when necessary, chooses a compatible numeric release
from the repository's `versions.json`. These metadata checks cannot establish
full runtime compatibility.

| Action | Behavior |
|---|---|
| Install | Reviews `manifest.json`, `main.js` and optional `styles.css`, confirms trust, and installs exact package bytes without executing code or adding an enabled entry. |
| Enable / Disable | Separate installed-card/detail actions use this vault's canonical `.obsidian/community-plugins.json` and the existing Restricted mode preference. |
| Find updates | Opens the matching catalog entry for explicit review. Updating awaits a running plugin's unload-owned writes, preserves its data and enablement, replaces package assets and restarts it only if it was running. |
| Settings | Opens the plugin's actual registered settings. A package does not necessarily register a settings tab. |
| Uninstall | Requires confirmation that the entire plugin directory, including `data.json` and other plugin data, will be permanently deleted. Removes only that plugin's enabled ID and owned runtime contributions; notes elsewhere are not deleted. |

Installing an ID already present in the enabled file preserves that entry,
even if its package was previously missing. Installation itself does not start
it, but ordinary vault reopening can restore it. Fresh installations without an
existing enabled entry remain disabled until explicitly enabled.

Public GitHub mounts are **read-only**. Their catalog can be browsed, but package
installation, replacement and deletion are refused by the host, not merely
hidden in the UI. Copy or open a writable local vault to manage its packages.
Existing local preference/enablement overlays do not make repository packages
writable.

## WASM downloads and CORS

The browser tries a normal credential-free direct download first. GitHub raw
registry/manifest responses are normally readable, but release assets can
redirect to a host without the CORS headers required by a web application.
This is a **WASM CORS limitation**, not evidence that the release is missing.

If blocked, use **GitHub release and downloads** to download `manifest.json`,
`main.js` and, when supplied, `styles.css` from the same release. Choose
**Select downloaded files**, review the validated package and confirm
**Install selected files** or **Update from selected files**. Extra files,
duplicates, mismatched IDs/versions, invalid UTF-8 and oversized packages refuse
without installation. `data.json` is never imported. Selected files preserve
their original bytes; selection does not authenticate their author or source.

There is **no hosted relay**, vault upload, opaque `no-cors` fetch, native
companion or simulated Node runtime. An optional CORS browser extension may
permit direct downloads, but weakens browser protections. It is not required,
installed or tested by this implementation; limit any such extension to trusted
sites and disable it afterward.

Desktop instead uses a token-protected localhost download endpoint restricted
to bounded public GitHub package GETs. It does not expose an arbitrary URL proxy
or provide a backend for the standalone WASM site.

## Persistence and failure boundaries

Package reviews capture the vault root, selection generation and existing
package fingerprint. Serialized management refuses stale reviews, including
switching away and back to the same vault. Installation and updates reuse the
existing native/browser package persistence rather than writing through a
second storage implementation.

Updates preserve plugin data and unrelated package-directory files. Omitting
`styles.css` intentionally removes the previous stylesheet. Failed updates
restart old code only after checking that the reviewed old package remains
unchanged; a foreign replacement is not automatically executed. A successful
disk update followed by startup failure is reported as such, not rolled back
or described as a successful start.

Uninstall uses version-checked enablement and package removal. Failure recovery
does not overwrite a newer external enabled list or re-enable a package after
a lost successful delete response. Cancellation before installation writes
nothing; accepted writes drain through normal vault transitions.

Safe IDs, byte/entry limits, conflict checks and staging/rollback do not provide
cross-application browser transactions or crash/power-loss durability. Trusted
plugins retain their host permissions and are not sandboxed.
[Detailed storage limits](../Engineering/DATA-SAFETY.md#community-package-management).

## Reference and verification evidence

The recovered **Obsidian 1.12.7** source supplied the behavioral reference for
the official registry, compatible-release fallback, release assets, separate
install/enable, running-update restart and uninstall. The implementation is
independently authored; static source inspection is not original-runtime
execution or visual-equivalence evidence.

REA parent:
`ev_dadf79c688bb868dd8339255c3dba770f89c7f2343ebce52dc6389922b8f502d`.
The original ASAR SHA-256 is
`2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712`.
Recovered `Obsidian-Recovered\src\application\app.js` ranges:
60120-60130, 60668-60715, 82085-82125, 154140-154405,
160416-160465 and 160595-160735.

| Evidence | Observed result and limit |
|---|---|
| Final desktop GUI | Eight checks including startup, with seven package-workflow groups: actual browse/layout, separate install/enable/settings, unload/data-preserving update, reload, canceled/accepted uninstall and canceled incomplete download. GitHub responses are explicitly deterministic fixtures. |
| Final actual-folder WASM GUI | Twenty-one checks including thirteen host-bootstrap groups and eight package groups. Real release-file selection, attributed CORS failure, exact files and directory-handle reconnect pass. No unexpected persisted errors or uncaught exceptions; the two expected diagnostics are retained. |
| Live public native download | The production catalog/downloader reads 9,578 official records and downloads registry-selected Natural Language Dates 0.6.4 from `obsidian-community/nldates`. Manifest: 349 bytes; main: 1,376,761 bytes; CSS: optional 404. No plugin execution or vault writes. |
| Normal-security browser CORS | Real Edge 156 reads registry/raw manifest, but direct release and API binary-download redirect reads fail CORS. An ordinary manifest download starts and is canceled by the capture provider; saved download bytes and a CORS extension were not verified. |
| Regressions | The combined-tree run passes 670 unit/API tests; focused Community/GitHub runs pass 34 + 32. The final stylesheet registration and rendered two-column/viewport assertions were subsequently verified in both final GUI reports. |

The native console additionally retains one Blazor WebSocket-1006 line without
causal attribution. It is not discarded or described as a clean console; the
zero-error statement above applies to unexpected persisted records and uncaught
exceptions.

Final local reports and their source/artifact/log/capture bindings are retained
in `.runtime\evidence\community-install-acceptance.json`,
`community-install-smoke.json`, `community-install-web-smoke.json` and
`community-public-downloads-1793182424961.json`. The fixture reports do not prove
public downloads; the separate live probe does not prove plugin execution.
Earlier fixture failures and pre-stylesheet captures remain retained.

Normal-browser CORS REA evidence:
`ev_ad86de1113dcd056eefd8ee4ab52135bdd6f4b0f1e1af6da72f2fa0715e1d036`.
No TLS verification, browser security or inherited Git safety setting was
disabled. These results do not renew older whole-core or ten-plugin runtime
epochs, and do not establish deployment to the public site.

## Expanded marketplace workflows

Integrated 2026-11-01. The final isolated native and actual-folder WASM pair
passed on
`588767e288acb3a44477fdd37e9c01e29138d27c01e137e0ee72eee785cdc2f2`,
with matching compiled and before/after source identities. Connected
[current main-source runtime renewal](../Engineering/INTEGRATION-WAVE-2026-11-03.md) now passes.

- **Statistics and sorting:** bounded public `community-plugin-stats.json`
  (8 MB cap, non-negative safe integers only). Sort by name/popularity/recently
  updated and filter by installed/updatable. Missing or failed statistics are
  reported explicitly, disable popularity/updated sorting and are never faked.
- **README:** fetched from `README.md`/`readme.md` on HEAD (512 KB cap) via the
  same credential-free allowlist, parsed by `client/community-readme.ts` into an
  inert Markdown subset: HTML/comments stripped, images shown as text (no
  tracking fetches), only credential-free http(s) links, no plugin code run.
- **Bulk updates:** "Check for updates" is read-only; nothing is preselected;
  one confirmation covers only the selected rows, which are applied
  sequentially through the existing reviewed `installPackage` fences (version,
  root, selection). Outcomes are per row, including partial failure and
  "not attempted" after a context change. New packages are never installed or
  executed by this flow.
- **Dotted IDs:** dot-separated alphanumeric-led segments (`a.b-c_d`), shared
  by `client/plugin-id.ts` and the native `VaultService` checks. `..`, leading
  or trailing dots and Windows device basenames (`CON`, `NUL`, `COM1`, `LPT9`,
  including `con.txt`) are refused. DOM lookups use dataset/quoted attribute
  selectors, so dots stay literal.

Evidence: `node --test` over vault, browser-vault, community-plugins,
community-marketplace, github-vault and plugin-readonly (162 passing) plus
`tsc --noEmit` and a backend build. A bounded live read through the production
native downloader (`node tools\community-live-check.mjs`, 2026-11-01) returned
the real registry statistics (9,752 plugins with counts), a real README, and a
404 for a missing README; it installs nothing and is not GUI evidence.

Scenario source for the native and actual-folder WASM UI exists in
`tools\community-marketplace-scenarios.mjs` (run after the install scenario via
`smoke:community-install` and `smoke:community-install:web`): stats/sort/filter,
inert hostile README, read-only update plan, a single reviewed bulk batch with
a missing-asset and a stale-on-disk failure, data/enablement/running
preservation, literal dotted IDs, WASM CORS outcomes and statistics outage. It
passed on both isolated hosts. It also (a) mounts a real cached GitHub vault via `cached-github-fixture.mjs`
and asserts read-only browsing, disabled install/update planning, refused
review/install/uninstall, zero GitHub API/raw requests and unchanged cached
blobs, and (b) drives the runner's actual vault-selection callback to a
disposable second root and back to check the plan fence. Both runners supply
that callback and a target root. The live production statistics/README read is
preserved as `.runtime\evidence\community-live-check.{json,log}` (script,
downloader and response SHA-256 recorded; json SHA-256
`3e11c771…875e`).

## Remaining work

Wider marketplace presentation and plugin compatibility remain. Automatic unattended updates are not supplied: updates
remain explicitly reviewed and user-directed. The separate live production
statistics/README read does not prove an actual downloaded plugin's behavior.

Broader SDK/plugin workflows, themes/snippets, additional host/version fixtures
and complete cross-process/crash durability remain separate roadmap work.

### Final accepted scenario run (2026-11-01)

Source fingerprint `588767e2…cdc2f2` matched before/after both runs and both embedded reports. Native `smoke:community-install` and actual-folder WASM `smoke:community-install:web` passed the install/update/uninstall workflow plus the marketplace scenario (stats/sort/README, literal dotted IDs, reviewed bulk update with missing-asset/stale rows, outage, root switch, cached read-only GitHub). Logs: `.runtime\evidence\native-community.log` (sha256 `35CB0ECC…A05FE`), `web-community.log` (`C428BB96…156A`); earlier failed attempts are retained as `web-community.FAIL1.log`/`attempt3-6`. Fixes found by the run: browser uninstall staging used paths long enough to hit Windows path limits in Chromium (staging directory shortened), and the scenario now disables file-chooser interception before the real folder picker. Bulk apply no longer claims success from version equality after a refused install, and README parsing reports truncation of over-long inline text. Limits: fixture catalog/network only (live public data is the separate `community-live-check`), no real vault was mutated.
