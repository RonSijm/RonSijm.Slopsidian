# Inline Bases, nested structure and saved audio

Top-level fenced `base` blocks now provide owned read-only Table/List/Cards previews in Reading and Live Preview. Supported nested Properties maps/lists offer reviewed source-preserving scalar insertion and entry removal. Explicit saved-audio waveforms accept the documented short Opus subset alongside strict PCM/float WAV. 30 fresh desktop/browser collections / 695 checks, 2771 complete default tests in 178 modules and 46 GitHub regressions pass; type checking, native/WASM builds and static serving pass.

Final source: `336dfe2f4d3e1f458f682af2da77ee7165e1f6a4986063124ea603b03fd03ece` (828 canonical inputs, 1168 native/WASM artifacts). Accepted local [receipt](../../.runtime/evidence/inline-structure-audio-accepted-2026-11-19/receipt.json) SHA-256: `231894d148c1a4131ac1d5faaa03710baa53002d33fcdcb79ad5f8cd366e089f`. 46 actual captures were inspected after serial GUI execution. No native modules are excluded. A preceding full run at this same final source had two Node test-worker access-violation exits (0xC0000005). Both unchanged modules passed a 30-test serial probe, then the entire default/GitHub suite passed without code, runtime or policy changes. The original worker-crash cause is unproven and the failed attempt remains recorded.

## Delivered behavior

- Closed top-level `base` fences use the containing note as `this`, without synthetic files, hidden editors or source writes. They reuse bounded queries, existing destinations, local search/pages/typed folds, summaries and local versioned covers. Reading and Live Preview own exact source/session/render lifetimes; editing the configuration stays ordinary Source. Existing link embeds keep their prior contract. Ordinary Reading content performs no inline-only source lookup. The built-in base language explicitly refuses colliding plugin registration before registry changes, alongside the existing Mermaid rule; other custom processors keep their ownership/lifecycle contract.
- Supported nested block and single-line flow maps/lists offer Add entry and Remove entry, explicit scalar type/key/index, literal review and Apply/Cancel. Exact CST splices preserve untouched source, comments, opaque values, BOM and line endings. Removal can include a bounded subtree and singleton removal keeps an explicit empty collection. Existing live Source/fixed-pane, Live Preview and Reading owners share the queue and isolated Undo with earlier dirty edits. Unsupported layouts explain the Source fallback.
- Saved audio supports explicit waveform analysis for mono/stereo Opus in the documented fragmented MP4/M4A and noncontinued, nonchained Ogg subset, with finite loaded metadata of at most 30 seconds and the existing 16 MiB limit. Container, packet-duration, sample-extent and timestamp bounds are checked before native decoding; returned PCM is checked afterward. The same verified playback bytes/URL/root/version own the visual. One global job lease, Cancel, deadline, stale-result refusal and explicit retry are shared with recordings. Native playback and strict PCM/float WAV remain available.

## Validation

30 fresh desktop/browser collections / 695 checks, 2771 complete default tests in 178 modules and 46 GitHub regressions. The complete default module list retains all 175 prior modules; native/API-server cases run serially. Native Debug, published WASM, UI build, type checking and static serving pass on the final source. GUI runs, final error audits and normal shutdown are bound to the same inputs/artifacts; source, package lock, HEAD/index, prior accepted outputs and the complete old stylesheet prefix are preserved. Independent reviews and actual input/byte/history/lifecycle checks are retained in the local receipt.

| Collection | Host | Checks |
|---|---|---:|
| inline-structure-audio | desktop | 20 |
| inline-structure-audio | web | 32 |
| embeds-typed-bulk | desktop | 24 |
| embeds-typed-bulk | web | 36 |
| cards-audio-bulk | desktop | 23 |
| cards-audio-bulk | web | 35 |
| views-inputs | desktop | 37 |
| authoring-controls | desktop | 32 |
| outgoing | desktop | 10 |
| outgoing-panes | desktop | 7 |
| bases | desktop | 5 |
| bases-summaries | desktop | 5 |
| views-inputs | web | 49 |
| authoring-controls | web | 44 |
| outgoing | web | 22 |
| outgoing-panes | web | 19 |
| bases | web | 17 |
| bases-summaries | web | 17 |
| authoring-organization | desktop | 24 |
| authoring-organization | web | 36 |
| rich-editing | desktop | 34 |
| rich-editing | web | 41 |
| properties | desktop | 13 |
| properties | web | 25 |
| renderers | desktop | 13 |
| renderers | web | 25 |
| math-embeds | desktop | 8 |
| math-embeds | web | 20 |
| audio | desktop | 5 |
| audio | web | 17 |

## Visual evidence boundaries

All 46 current-source captures were inspected after GUI execution closed. The Properties captures positively show full list-index/Text/value/pending review actions, destructive review, fixed Source panes, disabled read-only controls and scrollable narrow actions. Some Add frames are scrolled to the deliberate blur target; map-key input, non-Text selected states, conflict error text and the upper key/type/value fields in the 360px capture are outside the captured viewport. Their functional state and individual physical reachability are verified by the actual-host scripts, not inferred from screenshots. The combined captures show retained raw Source only. No complete visual-layout, physical-accessibility or original-product equivalence is claimed.

## Remaining work and evidence limits

- Bases: wider or editable inline/link embeds, additional view types, full formulas/types/plugin APIs and original-runtime/visual equivalence. Nested/indented/unclosed or other-language fences retain normal source presentation. The shared embed/depth limits remain in force.
- Properties: unsupported or ambiguous YAML layouts, alias/tag/merge cases, implicit-empty-null scalar editing/insertion, closed-note nested authoring, broader types/link widgets/ranking and full serialization/API parity. This is an independently designed structural extension.
- Audio: MP3/AAC/WebM and wider codec/container waveform support, longer compressed clips, broader media seeking, physical microphone/OS-device acceptance and original-runtime comparison. Actual host MediaRecorder fixtures use synthetic input. Native decoder internal allocation occurs before returned-PCM checks; this is a bounded application feature, not a decoder sandbox.
- The complete historical 58-scope GUI matrix, physical accessibility/IME, Release/distribution readiness, broad recovery/transaction guarantees and other roadmap packages retain their recorded status. No dependency installation, signing/Application Control policy change, Git commit or push was performed.

Pinned 1.12.7 static code confirms the `base` code-block registration and containing-note/configuration contract. Original inspected Properties/recorder bodies do not establish the new nested controls or waveform runtime parity. Detailed original observations remain in ignored private evidence, separate from application and build inputs. Narrow Live Preview acceptance explicitly places the caret outside the configuration and the first fence inside the real CodeMirror viewport. The earlier resize timeout did not capture its caret/viewport and has no proven original cause; the prepared rerun does not establish arbitrary-scroll/caret resize equivalence. Earlier dated milestones keep their original source identities and acceptance limits.
