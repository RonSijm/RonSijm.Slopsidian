# Desktop shutdown and original-reference capture, 2026-11-03

[Roadmap](../Project/ROADMAP.md) · [Previous integration acceptance](INTEGRATION-WAVE-2026-11-03.md)

This follow-up integrates the remaining original-reference controller and fixes
the slow native close observed in the preceding package measurements. Raw
outputs remain in ignored `.runtime/` directories. The previous `73bd3e73`
acceptance retains its historical source and artifact identities.

**Completed 2026-11-04.** Source `3af6437b` passes both builds/static checks,
**1,377 default and 44 GitHub regressions**, and **all 58 serial integration
scopes**, including both 123-case core collections. The fixed 31-module/140-case
contract is unchanged. Both unsigned package walkthroughs and fresh measurements
pass separately. The final audit is `.runtime/continuation-final-audit.json`.

## Native close ordering

The native owner now saves and checkpoints first, closes through Electron's
normal window path, waits for actual window closure, and then drains and
validates the owned .NET host before quitting. Closing the renderer disconnects
its live server circuits before server shutdown. The existing host timeout is
unchanged.

Save failure retains the window and host. A native close or `beforeunload` veto
also retains them and resumes editing/autosave and configured plugins. An
unconfirmed close retains the host and reports the uncertainty; failed resume
is explicit. Already-exited hosts must still have a zero exit code and no
signal. Seven focused regressions cover ordering, veto/retry, timeout, resume
failure and abnormal/already-completed host exits.

The final native diagnostic at `.runtime/shutdown-followup-mw1r7x9i/report.json`
passes actual save failure, native `beforeunload` veto, real typing after each,
plugin restoration and exact final saved bytes. Both owned processes exited
without forced cleanup, with zero unexpected errors through final teardown.
Its final close measured 216.6 ms. Earlier diagnostic-driver failures remain
failed records; they do not supply acceptance.

## Reproducible original capture

The [controller guide](../../tools/original-reference/README.md) describes
staging and isolated execution. `npm run reference:stage` only stages a fresh
reviewable Windows Sandbox configuration. The guest requires matching capture
provenance, the actual Sandbox account/VM, fresh application/profile/vault paths
and verified payloads. Only its fresh input and output directories are mapped;
the input is read-only and network/clipboard/device redirections are disabled.
Eighteen regressions cover guards, mappings, tampering and close accounting.

The fresh capture at
`.runtime/original-reference-captures/20261103203135-9152ce/` passed on original
**1.12.7**, with all 83 application files verified. A real separate floating
Markdown window had measured outer bounds `(160,120,723,603)` at DPR 2.25.
The 5,797 workspace bytes before and after close have SHA-256
`2b4dc1745256bde863a5ab8a77c1015bd13e9fd74d7d83ba2975f35ad868c0eb`.
The original app exited zero without a signal, forced cleanup or close errors.
All three owned host Sandbox processes then exited through normal close and
its verified discard confirmation. No personal profile was mapped and the
original app was never executed on the host.

The acceptance record is `.runtime/reference-capture-acceptance.json`; the
capture result has SHA-256
`870aa73eab4485c9c0db5727919458552e5afa0a7da1727126373ffb9e5f369d`.
This observation supplements the existing committed fixture, whose bytes remain
unchanged. It covers one unmaximized/default-zoom floating window; it does not
establish other window/display/import combinations or complete original parity.

## Local branch cleanup

Removed 22 finished local branch labels after preserving their commits in a
verified bundle and copying tracked patches plus changed/untracked files.
All 4,265 snapshotted worktree files remained unchanged. Their directories were
preserved and detached at the same commits. No remote branch was removed.
The capture branch remains while its now-integrated changes are uncommitted.

The ignored recovery directory is
`.runtime/branch-cleanup/2026-11-03T20-20-50-920Z/`; its `result.json` records
the removed names and exact restore command. The Git bundle SHA-256 is
`b95e5a282020eeeb94d23ddcff1be7b17cc4e4a8d0e1f36c8ebd987e1afa0473`.

## Validation and retained failures

Validation and package measurements pass on source
`3af6437b7a33f52bd1bc896982d1839668d3d25c08c68c38f90f644f25e50dfc`.
The complete receipt is
`.runtime/evidence/integration-wave-2026-11-03T22-03-29-614Z-5f397fd1/receipt.json`.
All 58 scopes were run afresh on this source, with their required final error
audits and owned-process exits. No passed scope from an older source was reused.

The initial restricted build could not start MSBuild's required WASM task host;
its failed receipt is retained. The unrestricted local retry passed both builds
and static publication checks, 1,373 default/44 GitHub tests and both core
collections, but found a genuine video state race during file switching.
A snapshot between metadata becoming available and its queued handler running
could adopt the element's default rate/volume. The viewer now keeps requested
playback authoritative until its metadata handler applies it, then records real
user controls normally. A deterministic regression reproduces that interval;
all ten focused viewer tests pass. The exact original runtime assertion remains.

That failed `f8f394a9` epoch stopped after source changed, with no active scope
left running; its 23 passed scopes are historical. Fresh validation passes both
builds/static checks, 1,374 default/44 GitHub tests and both real viewer scopes.
The resumed `a5419746` matrix passed 57 scopes, including both core collections,
but its browser attachment boundary fixture failed. An unchanged retry failed
in the same sequence. A diagnostic then proved that its global one-shot
`File.arrayBuffer` hook held a background preview PNG (134 bytes), rather than
the selected `Stale.bin` (3 bytes). Awaiting rename before releasing that
unrelated I/O could hang, or allow the intended import to finish too early.

The fixture now holds only the selected name/size/relative path; native folder
enumeration retains its separate IPC boundary. Live checks assert which source
was held. Three regressions cover unrelated browser reads, same-named files in
other folders and native IPC/restoration. All 24 focused attachment tests pass,
and the corrected browser diagnostic completes exact-byte, stale-edit/rename,
folder and reconnection checks. Product import policy and every original
assertion remain unchanged. Fresh validation and the complete 58-scope matrix
then passed on the corrected fixture source; no failing output was promoted to
acceptance.

## Workflow catalog renewal

The existing attestation tool renewed all 27 requested workflow badges from the
two matching core collections and retained original 1.12.7 lifecycle/settings
observations. Both real Settings collections pass badge descriptions, toggles
and full restart/reconnection with final error audits and clean exits.
`.runtime/continuation-core-attestation/` retains the reports and exact artifact
delta: seven catalog/compression/publication-metadata files changed. Application
assemblies and JavaScript stayed byte-identical. The matrix binds its original
artifact set; the badge checks and packages bind the renewed catalog build.

## Packages and bounded measurements

Both portable and disposable installed workflows pass actual typing/Enter,
Save, nested New note, exact Unicode/BOM/CRLF bytes and full process restart.
Owned uninstall preserves the external fixture vault and profile. Installed
checks use dedicated test registry/shortcut locations. Reports are retained at
`.runtime/package/workflows/portable-2026-11-04T06-52-26-801Z/report.json` and
`.runtime/package/workflows/installed-2026-11-04T06-52-53-482Z/report.json`.

The release manifest in `.runtime/package/out/` reports 1,123 staged files,
512,971,556 uncompressed bytes, zero content-scan violations and unchanged build
inputs. The unsigned artifacts are:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Portable ZIP | 271,755,732 | `ed36a04b131413b51eab6fdd45d51b6918d05155e1581758d193f0062a00af16` |
| Setup EXE | 224,862,208 | `11a8aa0372f7b0b00347349b868edbbed5d4ba665319daf18c0e6e15e58b367d` |

One fresh-profile and three subsequent launches per package, with 25 fixture
notes, all exited cleanly without surviving hosts or unexpected install-tree
writes. Timing runs were serial after Sandbox/build/UI checks:

| Harness-observed timing | Portable | Installed |
|---|---:|---:|
| First-profile interactive | 2,668.7 ms | 2,006.2 ms |
| Three warm launches, median interactive | 1,785.9 ms | 1,490.3 ms |
| Four closes, median / maximum | 261.7 / 335.5 ms | 230.2 / 263.4 ms |
| Previous source close median | 5,168.1 ms | 5,172.2 ms |

Close timing measures CDP `Browser.close` to actual process exit, rather than
human interaction latency. The close-order fix preserves the existing host
timeout and every veto/save safeguard. Startup figures remain observations,
with filesystem/scanner/cache variation; they are not an accepted product
budget or a controlled startup comparison. Raw reports are
`.runtime/package/evidence/startup.json` and `startup-installed.json`.

The fresh 5,000-note metadata run reads 11,568,527 Markdown bytes and returns
13,139,636 response bytes: first request 1,917.8 ms, seven subsequent requests
median 283.4 ms / p95 322.6 ms, peak working set 230,797,312 bytes. Its complete
response and source/binary identity checks pass. Retained record:
`.runtime/evidence/metadata-continuation-final.json`. Bundle measurement records
87,094,343 published WASM bytes, including source maps and compressed variants;
framework Brotli is 3,646,155 bytes and JavaScript Brotli is 3,864,718 bytes.

This completes the bounded shutdown/capture follow-up. Wider original/private/
visual/plugin equivalence, physical device/IME/quota variants, broader platforms,
authorized Sync/Publish, signing, publication and updates remain roadmap work.
