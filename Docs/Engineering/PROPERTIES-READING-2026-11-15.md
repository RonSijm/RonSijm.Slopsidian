# Properties, cross-pane moves and Reading callouts, 2026-11-15

**Implemented and browser verified; desktop validation pending.** This iteration extends three workstreams with five user workflows. 9 current-source browser collections / 292 checks pass. Type checking, native Debug, published WASM and static serving pass; 1,887 selected default tests in 127 non-native modules and 44 GitHub regressions pass. The 26 native-dependent default modules and native GUI acceptance remain pending Windows Application Control.

## Delivered behavior

- Properties text and ordinary list-add fields can explicitly create headings/chains in their own note using an empty wiki path or the note's supported literal name/path. The preview shows every new ATX level; existing ATX/Setext ancestry and source stay intact. YAML changes and headings are recomputed together before one normal source transaction. With an open Markdown session, one Undo/Redo removes/restores both; a closed note uses one ordinary versioned combined write and has no editor Undo claim. Cross-note creation keeps its prior target-first acknowledgement and source guards.
- Ordinary string-array members expose visible **Edit**, **Apply value** and **Cancel** controls. Existing known-value/wiki completion works inside the member editor; replacement preserves order and uses the existing guarded YAML queue. Tab toward Cancel cannot save first; Enter/Apply commits, Escape/Cancel discards, exact duplicates refuse, and unchanged surrounding whitespace stays exact. Creation remains a separate text/list-add action; tags, aliases, structured arrays and nested YAML retain their prior scope.
- Stored whole-value wiki links in text/list fields navigate unique existing Markdown notes, headings and blocks, including cached read-only notes. Modified/middle clicks open a tab. Current source/widget/list-index/target/subpath proof refuses obsolete controls without creating a missing note. Benign target-body changes remain navigable. Index completion, removed destinations and replacement identities refresh link affordances, while focused drafts and accepted creation/commit owners are retained until their guarded action settles.
- Selected groups of 1–20 visible Markdown notes can be dragged onto an existing folder in another Files pane in the same app/vault. The source selection owns the normal prefilled move review; the receiving selection stays independent. **Review destinations** and **Move notes** remain separate. A valid 750 ms folder hover unfolds it without detaching the actual drag source. Ordinary unfiltered folder state persists; filtered folds remain transient. Drop/review/cancel make no file changes. Confirmation uses ordinary sequential FileManager moves and optional Markdown/Canvas reference updates. Collision, stale owner/inventory/root, disposal, foreign/replayed token and read-only guards remain; confirmed partial results are kept.
- Original-main Reading collapsible callouts remember explicit open/closed choices in a bounded local profile under exact source-text identity. Trusted pointer, Enter and Space summary activation preserve source, hidden editor/history and existing rendered owners. Heading/block navigation and Find temporarily reveal captured callout bodies and their ancestors without overwriting explicit intent; a whole-callout block target opens that container too. Find includes captured closed bodies while ordinary closed HTML details and embeds remain excluded. Changed source, malformed profiles, denied storage, replaced owners, nesting and cleanup are guarded. Cached read-only notes permit these local preferences with no blob/configuration or API/raw mutation.

## Validation and native limitation

| Current-source collection | Actual-folder WASM checks | Windows desktop |
|---|---:|---|
| properties-reading | 36 | Pending — Application Control |
| authoring-transfers | 43 | Pending — Application Control |
| note-management | 42 | Pending — Application Control |
| authoring-organization | 36 | Pending — Application Control |
| link-authoring | 34 | Pending — Application Control |
| file-explorer | 21 | Pending — Application Control |
| properties | 25 | Pending — Application Control |
| math-embeds | 20 | Pending — Application Control |
| note-continuity | 35 | Pending — Application Control |

The browser reports bind source `caaa0d6abd8d2b220fa8014ba27d0332ce4ba2cd4438ed355af32e84bb9e9d43`, 747 canonical inputs and 1165 unchanged build outputs. Real keyboard/pointer/drag input, exact BOM/CRLF/Unicode bytes, metadata/history, current-owner refusal, restart/reconnection and genuine prepared cache-only behavior pass, including final error audits and acknowledged/drained/clean owned shutdowns. 19 captures were visually reviewed. Counts include overlapping startup/regression workflows and are not unique roadmap-item counts.

The selected default run has **1,887 passes, zero failures/cancellations/skips/todos** across 127 modules. All 44 GitHub tests pass separately. This is not the full default suite: 26 native-dependent modules remain pending, unchanged as tests rather than bypassed with alternate fixtures. The receipt retains the exact module selection and source proof.

A fresh native launch fails with **Application Control has blocked this file (0x800711C7)**. Code Integrity events 3077/3033 identify policy `0283ac0f-fff1-49ae-ada1-8a933130cad6`. The rebuilt native DLL retains SHA-256 `da74faa2db2ee555626a14f34583cd82868784a54dd8f3ff33618a7c0e83b763`, matching that checked refusal. No approved development signing/allow-list process was provided in this session; no security policy was changed or bypassed. Native GUI and a full passing default run remain unaccepted.

The [browser verification receipt](../../.runtime/evidence/properties-reading-browser-verified-2026-11-15/receipt.json) deliberately records **browser-verified-native-blocked**. It binds reports, artifacts, selected tests, native evidence, reviewed images and retained attempts. The checkout began with 31 local changes; exact backups and the prior browser-only receipt remain intact. HEAD/index, dependencies and remote CI are unchanged. No commit or push was made.

## Review findings and scope limits

Independent review and real-host testing corrected keyboard Cancel's blur commit, unchanged-value whitespace, stale stored-link checks after benign target edits, late-index link affordances and pending-creator row replacement. Visual QA replaced a blank edit glyph with visible **Edit** text and added active-draft/collision captures. Real block navigation exposed the nested-container reveal case; a dedicated regression and renewed browser navigation cover it. Document-capture Escape now retires an app-owned drag even when focus is outside its tree, with composition and app isolation guards.

The browser drag helper uses the repository's native `dragCancel` plus `cancelDragging` path for intercepted gestures, retaining measured source DOM and replay assertions. Physical Escape delivery during an OS drag remains unaccepted; the Escape handler has model coverage. Earlier failed attempts remain retained with their status. Older code-highlighting DOM fixtures acquired the newly used TreeWalker/callout context, and the old source-only heading Enter helper parks its pointer before deliberate keyboard selection; its no-target-write assertions remain.

Matching inert shipped 1.15.0 Properties, callout and Files methods were inspected before implementation. Exact artifact/range hashes and observations stay in ignored local provenance; no original process was executed. The compatibility target remains 1.12.7. Reviewed moves, same-note Properties creation and local callout preferences are bounded adaptations, not complete original/private/native or theme equivalence.

Remaining implementation includes alias-only/other Properties authoring, wider typed/structured widgets and ranking, wider heading grammar/output and nested/HTML/math/footnote block authoring; cross-window/OS/external/root/folder/binary drops and wider bulk trash/recovery/atomic-file behavior; Live Preview/static/embed/plugin/raw-HTML callout persistence and callout fold-all commands. Broader renderer/regex/IME/accessibility/scale, native macOS/Linux and OS dictionary writes, other-view/popout export, localization/associations, services and release signing/publication/updates remain. The [roadmap](../Project/ROADMAP.md) retains their dependency packages.
