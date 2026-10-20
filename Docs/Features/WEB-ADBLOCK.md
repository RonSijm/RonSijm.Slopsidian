# Desktop Web viewer ad blocking

[Feature-parity index](../FEATURE-PARITY.md) · [Web viewer](WEB-VIEWER.md)

**Ownership:** Codex, claimed and completed 2026-10-22. The independent desktop network-filtering subset is accepted; the wider reference module remains partial.

## Using it

Open **Settings > Core plugins > Web viewer > Settings** and use **Block ads (reload pages after changing)**. It defaults on, using the original Boolean `enableAdblocking` setting in `.obsidian/webviewer.json`. Existing explicit false values are retained. Save updates future requests in all open Web viewer tabs; reload pages to apply the change to resources already loaded or blocked.

The page footer shows **Ad blocking on · N blocked**, **Ad blocking off**, or an explicit preparation/failure message. The count belongs to one tab's current document. Document navigation and reload reset it; a hash change retains it. Disabling protection retains the current count internally but stops blocking ad requests. The setting belongs to the selected vault and is independent of opaque workspace leaf fields.

The bundled filter snapshot works offline. It is updated only by a deliberate source/dependency change and rebuild; there is no subscription downloader or background refresh.

## Implemented scope

Ghostery's pinned `@ghostery/adblocker` 2.20.1 engine parses the original, unmodified EasyList subscription with network and exception rules enabled. It receives Electron's actual resource type and request referrer, allowing type, source-domain and first/third-party conditions. The native adapter cancels matched subresources. Top-level HTTP(S) addresses remain navigable, matching the official Electron adapter's document policy. Missing referrers limit source-domain/party decisions to the information Chromium supplies.

The complete [EasyList snapshot, attribution, license and provenance](../../vendor/easylist/README.md) are retained. Its version is `202610221912`, upstream commit `b9b71cbfbb9b3c2d5c68e45f74ab8a3476922c19`; SHA-256 verification occurs in the build and when the native process first loads it. The separate native engine bundle and dependency license notices live under `.runtime/web-adblock/`; neither is published as browser application code. No filter engine or code is injected into website pages.

Each native pane keeps its own setting state, document counter and short feedback timer, while sessions share the immutable parsed list. A single `onBeforeRequest` callback checks the existing vault/URL policy before ad filtering. Turning off ad blocking and filter exceptions cannot allow local vault endpoints, credential URLs or privileged schemes. These guard cancellations do not increase the ad count. The isolated, ephemeral browser sessions continue to deny downloads and device permissions and never receive the application token.

Protection is prepared before a new pane's first navigation. While enabled filtering is preparing or unavailable, subresources pause and the footer explains the failure. Turning off Block ads allows ordinary resources again. A revision prevents delayed initialization from re-enabling a disabled or disposed session. Closing, disabling and vault changes dispose per-pane counters/timers/native contents; normal settings merges preserve unknown data. Already loaded website scripts keep running when the setting changes.

WASM keeps the Web viewer explicitly unavailable and preserves desktop settings/history/state.

## Evidence

`npm run smoke:web-adblock` passes **37 focused groups**: six browsing, seven history, six Reader, six clipping, six zoom and six network-ad-blocking groups. The report binds **62 stable artifacts** across **13 full Electron/.NET process sessions**, checking hashes before each restart and after completion. `.runtime/evidence/web-adblock-smoke.json`, its logs and `web-adblock-acceptance.json` retain the exact scope. The full unit/API run passes **245 tests**, zero failed/cancelled/skipped. Native and root-base WASM builds and static serving verification pass. This renews the focused cumulative Web viewer scope; it does not advance the fixed 132/140 contract or renew complete application/community/renderer acceptance.

Actual server request logs and page execution distinguish blocked scripts from an allowed normal script and the same ad URL as XHR. Both visible and hidden panes adopt saved changes. Hash/document navigation, enabled/disabled restarts, invalid IPC, module cleanup, ephemeral storage, actual vault switches and opaque data preservation are exercised. Test-only Windows occlusion/background flags retain the preceding zoom launcher's input environment; production launch is unchanged. `--adblock-only` provides a separately named six-group development run, without implying the preceding 31 groups ran.

The original toolbar/footer screenshots `web-adblock-on.png`, `web-adblock-off.png` and `web-adblock-restored.png` were visually reviewed. Main-renderer CDP screenshots omit the separate native page; its real DOM/execution and network effects are asserted independently. The restored milestone screenshot retains a **Host 409 selected-vault warning**: native logs identify rejected prior-vault `/api/workspace` saves, whose root guard prevents writes. That older report remains preserved.

The later [layout-save checkpoint](VAULT-TRANSITIONS.md) fixes this warning in the exercised workflows. `workspace-transition-webviewer-smoke.json` renews **37 groups/13 processes/65 hashes**, with no obsolete workspace requests and a clean `workspace-transition-webviewer-restored.png`. The full regression passes **251 tests**; both builds/static serving pass. Four additional transition groups pass on native and actual-folder WASM. The pre-existing workspace edits are retained exactly; a separate live Canvas teardown issue remains open. This is still scoped acceptance, without complete workspace/original-runtime parity.

The first cumulative attempt stopped on the test helper's assumption that reopening Settings returns to the plugin list; the application retains its settings page. The helper now uses its actual Back control before selecting Web viewer. The first isolated attempt also assumed Save would omit previously absent known defaults, whereas the existing form intentionally saves its displayed values. Exact expected settings now include those defaults and retained opaque data. Both attempts remain under `web-adblock-settings-navigation-failure-*` and `web-adblock-initial-defaults-fixture-failure-*`; no production setting/persistence behavior or network assertions were relaxed.

Eight network-policy regressions exercise actual bundled rules, explicit exceptions, request types/party/source domains, URL-guard precedence, count/reset/coalescing, invalid IPC values, initialization races, load failure/retry and modified/oversized list refusal. The native settings API also checks the default without writing an absent settings file, Boolean validation, unknown data and persisted false across restart.

The pinned comparison scope includes the `enableAdblocking` default and broader native subscription settings. The independent offline snapshot does not reproduce subscription management, and original-runtime or visual/private-API equivalence has not been established.

## Remaining scope

Cosmetic hiding, empty-slot collapse, scriptlets, filter-supplied redirects, CSP/HTML rewriting, custom subscription URLs, automatic refresh/frequency settings, regional/privacy lists, per-site exceptions, rule-inspection controls, original native IPC/private APIs and original-runtime/visual equivalence remain unclaimed. Network blocking alone cannot remove every advertisement. Broader page/performance/OS and exhaustive filter-language acceptance remain separate.
