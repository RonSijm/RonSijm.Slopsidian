# External folder observation, 2026-11-09

The next bounded slice of the roadmap's Correct file/metadata events package
fixes missing plugin notifications for externally created/deleted folders.
Previously the metadata observer retained only `TFile` baselines. Native and
browser inventories contained folders, but their changes never reached Vault
create/delete listeners.

`MetadataCache` now keeps an independent visible-folder baseline, seeds it at
vault initialization, acknowledges explicit FileManager subtree events while
paused, and publishes ordered external inventory differences after metadata
resolution. Deletes precede creates for file/folder replacements; descendants
precede removed parents, and created parents precede children. `Vault` coalesces
folder-create acknowledgements by object identity, including nested directory
creation racing a metadata refresh.

The bundled `obsidian` 1.14.4 public declarations define these Vault events on
`TAbstractFile`, including `TFolder`. `Docs/Private` and the optional extracted
`Reference` directory are absent. No original runtime comparison or complete
1.12.7 event-order equivalence is claimed.

## Validation

The new `tests/metadata-folders.test.mjs` exercises the real Vault, MetadataCache
and FileManager against both the .NET HTTP host and BrowserVault's directory
handle provider. Fourteen cases cover nested/empty creation after an ordinary
inventory refresh, callback-visible inventory/metadata, original deletion
objects and child/parent ordering, file/folder replacement, unchanged scans,
internal mutation coalescing, overlapping acknowledgements, held previous-vault
responses and revision-only polling. Browser unit fixtures use in-memory handles;
they do not establish real browser permissions or OS input behavior.

The existing folder-operations UI scenario now also creates/removes a physical
nested tree externally, checks the exact plugin event sequence after explicit
inventory refresh, verifies unchanged-refresh silence and observes the tree's
appearance/removal in the actual Files pane. The same scenario is used by the
native and actual-folder WASM runners.

The final native and actual-folder WASM reports share source fingerprint
`641685dc5730f85e7d5dc81e3e7adf2de8350aa5ce55d0b40c7e6ced67ed37ef`.
This working-tree change does not renew whole-core badges or the previous
combined release epoch.

| Check | Result |
|---|---|
| TypeScript `npm run typecheck` | Passed |
| Native Debug build, local .NET 10.0.403 | Passed, zero warnings/errors |
| `npm run build:web`, final UI build and `publish-web.mjs --no-restore` | Passed |
| `verify-web.mjs` | Passed, assets/compressed pages/static serving |
| New folder-event regression file | 14/14 passed, including in the full suite |
| Markdown regressions after updating the older file-only event assertion | 82/82 passed |
| GitHub-provider regressions | 44/44 passed |
| Final native `smoke.mjs --folder-operations` | 10 checks, five process sessions, all exit 0 |
| Final actual-folder `web-smoke.mjs --folder-operations` | 22 checks, acknowledged/drained normal exit, no force |

Both UI reports retain `verified-through-scenario` artifact stability and final
teardown error audits. Native has zero records. Browser has one declared
negative and zero unexpected records. Both reports include the physical external
folder creation/removal and visible Files-tree checks.

The first complete `npm test` run finished with **1,389/1,391 passed**, rather
than a clean full-suite result. One older Markdown assertion expected folder
events to be absent during file/folder replacement. It now expects both balanced
entity transitions; its complete 82-test file passes the rerun. The other failure
is the existing native `atomic-write.test.mjs` case **an external write during
the backoff survives even after the lock is released**: actual HTTP 409 versus
expected 500. Its separate six-case rerun passes five and repeats that status
mismatch. The fixture rewrites after a fixed 300 ms rather than synchronizing
with the actual backoff. No native save implementation or lock-test assertion
was changed for this folder-event work. The full suite was not reported as green.

Local, Git-ignored logs are `.runtime/metadata-folders-tests.log`,
`.runtime/metadata-folders-markdown-rerun.log`,
`.runtime/metadata-folders-atomic-rerun.log` and
`.runtime/metadata-folders-github-tests.log`. Final UI reports are
`.runtime/evidence/folder-operations-smoke.json` and
`.runtime/evidence/folder-operations-web-smoke.json`, including source/artifact
identities and final audits. These are local validation artifacts, not a new
portable release-evidence archive.

## Remaining scope

External rename identity/session handling, same-stat binary changes, mutations
entirely between scans, broader concurrency/adapter contracts and full native
private event semantics remain unfinished. Existing README and launch-script
changes were present before this work and are preserved.
