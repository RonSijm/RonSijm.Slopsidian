# Imported link preferences and Quick switcher aliases

[Feature-parity index](../FEATURE-PARITY.md)

## Accepted source and main boundary

This is a bounded independent implementation, informed by selected recovered
Obsidian 1.12.7 source. No original bundled controller is loaded.
[Feature guide](../Features/DISCOVERY.md#link-generation-preferences).

The accepted normalized source fingerprint is
`1cc7177d06d1a0f857dfb67ae581e5afe6d881181d008d74303d918430f1ed9a`:
417 inputs from the immutable accepted Tags/Footnotes baseline plus nine owned
overlays (five client files, Markdown tests and three existing runtime files).
The same nine separately bound declaration/domain/test inputs are carried
forward byte-for-byte; the normalized catalogue is not a full build closure.
Compiler configuration and separately owned Backlinks sources are unchanged.

Fresh current main has 419 inputs and fingerprint
`de4dd4895890feb1339401350e1ac99a2b19f8449390087d81b294bb9e411e2f`.
Within that normalized catalogue, its only differences are
`client/backlink-model.ts` and `backlink-view.ts`,
which remain absent only in the isolated accepted copy. Main type-check still
fails with TS6133, TS2416, TS2367 and TS2339 in `backlink-view.ts`. This receipt
does not accept combined main, older whole-core badges, supplied plugins or
deployment.

The supplemental SDK/compiler/solution configurations match after strict
CRLF-to-LF normalization. Their candidate and main raw hashes/bytes remain
separate; pre-existing line-ending differences are not hidden as raw equality.

## Exercised behavior

Imported `newLinkFormat` shortest/relative/absolute and Boolean
`useMarkdownLinks` drive the actual shared APIs without rewriting BOM/CRLF or
opaque configuration. New defaults remain shortest/wiki. Tests cover extension
control, URI/label escaping, subpaths/self links, invalid preferences and
foreign/replaced file identities. Pure generation works read-only; mutation
policy is unchanged.

Actual Source typing/save and Reading pointer navigation reach exact targets
despite root/source-folder shadows. Real Note composer extraction uses relative
Markdown syntax for its planned new target while preserving source BOM/CRLF and
unknown module settings. Existing default composer and synthetic recording-link
workflows renew separately on both hosts.

Ctrl+O lists distinct literal frontmatter-alias owners. Actual pointer and
Ctrl+Enter open their real files/tabs; shared aliases stay separate, exact
same-file duplicates are removed, and HTML-like text is not markup. Real
dirty edits, undo/redo/save, external changes and external rename update the
open picker. Detached rows and disabled/closed input controls cannot open or
create obsolete targets. The external-rename fixture closes the old target
tab first; this is not acceptance of external-rename remapping for all open
views. Legacy manual-save fixtures pause autosave explicitly.

Real renderer reload/browser reconnection restores preferences and renamed
alias ownership. A genuine cached GitHub mount opens aliases and generates
configured links with zero API/raw requests, exact unchanged remote blobs and
non-editable CodeMirror. Returning to the local vault preserves its settings
and note bytes. This covers currently indexed cached notes, not full remote
indexing.

## Results and retained diagnostics

All 751 default and 33 GitHub regressions pass without skips or cancellations.
The six added behavior cases are part of that final default suite. Native/UI
builds, standalone WASM publication and static/compressed asset checks pass.
Existing npm dependencies were reused; .NET restore followed the observed
NETSDK1004 missing-assets failure. Optional WASM-tools/AOT is not installed or
claimed.

| Runtime scope | Desktop checks / sessions | WASM checks | Expected persisted diagnostics, desktop / WASM | Native WebSocket-1006 lines |
|---|---|---|---|---|
| Discovery, aliases and links | 15 / 1 | 27 | 1 / 2 | 2 |
| Default Note composer and menus | 11 / 4 | 23 | 4 / 5 | 8 |
| Default synthetic Audio recording | 5 / 3 | 17 | 0 / 1 | 5 |

These are report counts including repeated host setup, not distinct feature
totals. Every report has the same source fingerprint and stable artifact
hashes. Full persisted-log audits include teardown, with zero unexpected
records and uncaught exceptions. Deliberate disabled-Search/clipboard/Node
diagnostics remain. All eight native sessions exit normally. The fifteen native
WebSocket-1006 console lines remain unattributed; this is not a clean-console
claim. Physical microphones and OS permission behavior are not tested.

Six directly reviewed captures show the literal alias/title/path/flair modal,
actual Reading links and cached read-only GitHub note/status on both hosts.
No original-runtime screenshots or pixel-equivalence comparison were performed.

## Original-source evidence and differences

Original `app.js` SHA-256:
`30dbf34c6c548bc8a4402d5b8bb854b62f474d356ce283b8a321143f682b66fe`.
Six inert excerpts retain exact byte ranges/raw and derived hashes plus parse
completions: link text, link generation, resolution, encoding, base picker and
Quick switcher. REA parent:
`ev_2fd47e51794014aa02fb3062e21276d1a559f4886ef6d37663764ba91258538c`;
summary:
`ev_c1fb72addd02cef08d0c907192d7aa1f4ba0a9453b86c0a406f1aaa7aa97c4ca`.
Six files parse to 2,801 AST nodes without parse failures, but retain 659
semantic unknowns and one application unknown. The complete eight-record export
also includes six historical records; a top-level zero does not erase embedded
unknowns. This is static source evidence, not original execution.

The inspected native code reads both preferences, keeps `.md` in Markdown
links, collapses same-file subpaths and opens alias suggestions' actual TFiles.
Candidate `/` and `./` prefixes deliberately preserve targets under its own
resolver. Its stricter URI/label escaping and existing wiki alias shape are not
byte-for-byte native output. Native recents, bookmark suggestions, ignored-file
downranking, exact fuzzy order and private/modal APIs remain separate.

## Collection

The [location-only pointer](LinkPreferences/2026-10-28/collection.json) resolves
the create-only C-drive receipt. The product mirror is
`.runtime\evidence\link-preferences-acceptance.json`. Verify its payload hashes;
the pointer itself is not acceptance.

The collection retains exact source epochs/owned inputs, supplementary bytes
and their original provenance, complete native/web outputs, six reports/log
audits and reviewed captures, final native fixtures, tests/build logs, current
main comparison/errors, documentation and complete reference evidence.
Earlier isolated development sources and missing-assets logs are separate;
the initial direct pre-fix unit-test source was not frozen, and no complete
reproduction of that early state is claimed. WASM's normal harness cleanup
removes its ephemeral physical-folder fixtures. Dependencies/toolchain outside
the captured inputs are not a hermetic build environment.

Historical receipts remain unchanged. Generic preference UI/setters/watchers,
other independent link writers, complete native resolution/encoding/ranking,
whole-core/plugin/native equivalence and public deployment remain unaccepted.
