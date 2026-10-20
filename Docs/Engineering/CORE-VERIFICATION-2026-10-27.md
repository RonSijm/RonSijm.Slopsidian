# Core-plugin workflow verification, 2026-10-27

[Core modules](../Features/CORE-PLUGINS.md) · [Evidence](EVIDENCE.md)

The user reported the same unresolved compatibility warning on every implemented
core module. That sentence was hardcoded: it did not consult the module's
implementation or the available test evidence. This work renews the 27 requested
modules before additional roadmap features and gives their settings rows useful
feature descriptions and evidence-backed status.

## Verification scope

The requested modules have **123 cases**, using the unchanged
[31-module/140-case contract](../../shared/core-plugins.json). Each requested
module needs all of its lifecycle, settings and persistence observations plus
its named functional cases. Desktop persistence uses actual process restarts;
WASM persistence uses page reloads and reconnection to real directory handles.
These are recorded as distinct host scopes.

Nine other implemented-module cases belong to Bases and Web viewer. Their older
evidence is not silently promoted by this targeted renewal. Publish and Sync
remain unimplemented and have eight untested service cases in the fixed
benchmark. The previous **132/140** aggregation remains a historical candidate
baseline, rather than a new full-reference result.

Verification covers the documented workflows and their assertions. Broader
native rendering, private APIs, omitted feature variants, physical microphones,
remote services and complete Obsidian equivalence remain outside this result.
The per-module remaining-work column remains authoritative.

## Findings and changes

- Outline's Reading-mode active-heading calculation used the moving preview
  element as its coordinate origin after the shared note scroller was added.
  It now measures the outer content viewport, so navigating and scrolling to a
  deep heading selects that heading correctly.
- The older editor tests incorrectly required every Markdown scroll event to
  be Reading mode, and expected Live Preview bold weight 700. The supplied
  native reference allows Source and Reading scroll events and paints bold at
  weight 600. The assertions now require an actual Reading scroll event while
  accepting the native two-mode event contract and measured font weight.
- Core rows describe their actual purpose. Implemented modules without current
  matching evidence show **Available**. Completed modules show **Verified
  workflows**, with a tooltip giving the checked date and the host's restart or
  reload/reconnection scope. Disabled modules retain their verification status;
  enablement and verification are independent.
- A generated catalogue is published with both hosts. Its source identity is
  compiled into the UI and its case requirements come from the fixed contract.
  Missing, stale, malformed, incomplete, duplicate or wrong-host evidence cannot
  produce a verified badge. A new source build invalidates the previous badge.

## Reference observations

The supplied original Obsidian **1.12.7** archives ran under an owned hidden
Electron instance against a disposable copy of the Example vault. Supplied
community packages were excluded; an owned probe exposed the native API for
controlled queries. The reference resources and working Example were not
modified. Remote traffic was blocked by the owned launcher.

All 27 original modules passed the fresh registration, settings-page
availability/field inventory and module-owned command disable/re-enable audit.
Files also has app-global commands that remain when its module is disabled;
the audit distinguishes these from the commands owned by the module wrapper.
Settings input snapshots establish field structure; hidden native checkbox
`checked` values are not interpreted as semantic defaults.

A real native Live Preview node measured bold weight **600**. Controlled native
`MarkdownView.syncScroll()` calls emitted Source and Reading events with the
correct view/file. Attempted hidden-window DOM scrolling emitted no captured
events; those attempts are retained and are not represented as trusted wheel
input evidence. The candidate acceptance independently performs real input and
checks Reading navigation and highlighting.

REA inspected the original archive's package metadata and retained its source
identity. That package inventory is separate from the controlled native runtime
queries. Unselected JavaScript and complete runtime behavior are not covered by
the package inspection.

## Retained attempts

The first native full run exposed the Outline viewport bug. Focused follow-ups
also exposed the outdated scroll-mode and bold-weight assertions described
above. The broader browser renewal exposed three test-driver assumptions:
refocusing by clicking moved an established caret, the owned folder picker
could not select a nested isolation fixture from its root, and Recovery's
unscoped editor selector typed into a different split pane. The driver now
preserves selection, selects a real top-level disposable isolation directory,
and edits the active Recovery pane. Exact-content, snapshot, lifecycle and
restart assertions remain in place. Failed reports and captures are retained
separately from accepted evidence.

## Reproduction and acceptance

Use an isolated checkout/copy and build it before running these commands:

```powershell
npm test
npm run build
npm run verify:core
npm run build:web
npm run verify:web
npm run verify:core:web
```

The targeted runners record explicit fixed case IDs, original configuration
preservation, runtime errors, source identity and stable artifact hashes.
`tools/attest-core-verification.mjs` accepts only completed current-source
desktop and browser runs, checks their case coverage and artifact hashes, and
compares settings-page availability with the original audit. It writes the
tracked `shared/core-verification.json`; builds emit only its UI catalogue.

After attestation, rebuild both hosts without changing the tested sources and
run `npm run verify:core-status` and `npm run verify:core-status:web`. These
separate UI checks require all 27 real rows to show the matching badge, retain
it across a toggle and restart/reconnection, and keep unavailable services
unavailable. The original accepted workflow artifacts remain bound to their
original pre-attestation catalogue; the final UI reports bind the catalogue
that contains the accepted evidence.

All runs completed successfully against source identity
`e6376feb207a8eb872dc2a7a0132f9ff57e863f1b918349b407a2c0b6b0e9ca3`.
The reference settings availability matches every requested module.

| Accepted scope | Result |
|---|---|
| Regression suite | 615 passed, zero failures |
| Desktop workflows | 123/123 fixed cases, 95 groups, 31 process sessions, 66 stable artifact bindings |
| Actual-folder WASM workflows | 123/123 fixed cases, 107 groups, 25 assets and 32 scenario-input hashes |
| Original 1.12.7 registration/settings/owned commands | All 27 passed |
| Final desktop settings status | All 27 badges verified; toggle and actual restart passed, two process sessions |
| Final browser settings status | All 27 badges verified; toggle and real-folder reconnect passed |
| Uncaught errors | Zero in all four accepted candidate reports |
| Example preservation | 73 immutable plugin/preference inputs unchanged; existing fixtures validate |

The native workflow console contains 11 intentional validation diagnostics and
46 transport messages during controlled restarts, with no unclassified entry.
The browser contains 13 intentional validation/unsupported-fixture diagnostics.
These are retained rather than reported as an empty console.

[Durable receipt](Core/2026-10-27/receipt.json) binds the reports, build/static
logs, test output, original reference observations, attempts, source snapshot,
and the pre-attestation and published catalogues. The two final captures were
visually reviewed:
[desktop settings](Core/2026-10-27/Screenshots/core-status-desktop.png) and
[browser settings](Core/2026-10-27/Screenshots/core-status-web.png).

All current sources were tested in an isolated validation copy. The three
pre-existing shared generated editor artifacts remain unchanged; the normal
desktop launcher rebuilds the application and includes the accepted catalogue.
