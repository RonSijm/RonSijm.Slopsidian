# Outline workspace panes

[Feature-parity index](../FEATURE-PARITY.md) · [Workspace import](WORKSPACES.md#first-open-active-workspace)

**Last reviewed:** 2026-11-02

With Outline enabled, supported original `outline` leaves restore as real main
tabs or sidebar panes. **Open Outline in a tab** creates another instance from
the command palette. The existing Outline sidebar remains available. A selected
imported Outline sidebar is shown initially; explicitly saved sidebar choices
take precedence later.

Each pane has its own note target, heading filter, folds and follow controls.
**Follow active note** follows Markdown note changes. Turn it off to keep that
note while working elsewhere. This is separate from pinning a workspace tab.
**Scroll to active heading** scrolls the outline to the heading under the Source
cursor or visible Reading section, without taking editor focus. Active-heading
highlighting also works with scrolling disabled; collapsed/filter state is
retained. Non-Markdown tabs do not replace the retained Markdown target.

Click a heading or press Enter to reveal its exact source line in an existing
note pane. Reading remains Reading; Source/Live Preview retain their mode.
Ctrl-click or Ctrl+Enter opens a new tab. Arrow keys and Home/End navigate the
tree; Left/Right fold, expand and move between parent/child headings. If the note
is not open, navigation uses the existing workspace file-opening rules.

ATX and Setext headings come from parsed metadata, with the supported
frontmatter, comment and fenced-code exclusions. The filter matches heading
text case-insensitively and keeps matching ancestors. Filter results expand
without overwriting ordinary folds; clearing the filter restores them. Duplicate
heading occurrences have separate fold identities. Inserting lines before an
unchanged heading retains its fold; changing targets clears that pane's folds.

Dirty text, undo/redo, external updates and renames refresh the actual outline.
Navigation checks note identity, rendered generation and current text before
moving the cursor, so stale results cannot select an obsolete source line.
Filtering, folding and following do not save note content. Opening a different
note uses the ordinary guarded workspace save/conflict rules. Missing fixed
targets stay explicit instead of silently switching to another file.

Read-only GitHub vaults support cached heading navigation and independent local
view preferences. An Outline can read a known Markdown file whose text is not
already indexed. Cache-only mode retains its normal requirement that those
bytes be available locally.

Disabling Outline unloads its views, commands and handlers while preserving
opaque unavailable state. Re-enabling and restart/reconnection create fresh
owners. An old asynchronous read can finish after its owner closes, but cannot
update or retarget the replacement view. Detached controls and stale public
calls are guarded.

## Reordering headings

**Bounded native/actual-folder WASM authoring collection renewed on current main
`212ef2f3`, reviewed 2026-11-02.** Wider native/private and Unicode variants remain separate.

Drag a heading row onto the top or bottom half of another row to move that
heading and everything in its section (child headings, body text, code blocks
and comments) before or after the target section. Without a pointer, press
**Alt+Up / Alt+Down** on a row, or use **Shift+F10 / the Menu key / right-click**
and choose **Move heading up/down**; these swap the section with its previous or
next sibling heading. The first/last sibling reports a boundary and edits nothing.

A move is one editor transaction on the open note text: only the moved range is
rewritten, so BOM, CRLF/LF, Setext/ATX forms, frontmatter, comments, code and
heading levels are retained, and a single Undo/Redo reverts or repeats it. The
move is unsaved until the ordinary save/autosave path runs, so peer editors,
metadata, folds and the Outline refresh from the edited text. Folds follow moved
headings, including duplicate-heading occurrences, and focus stays on the moved
row.

Before any edit the Outline checks the pane generation, note identity and
existence, that the editor text still equals the text the Outline was built from,
that the note is not saving or reloading, and that its current disk version still
matches the open session (an externally changed, renamed-away or deleted note
refuses without changing text). It refuses headings inside quotes/lists, moves
into the heading's own section, no-op moves, moves of identical duplicate
sections, and any move whose re-parsed heading sequence would differ (for
example merging Setext text into a preceding paragraph or exposing a heading to
an unclosed comment). Filtering, folding, following and navigation remain
non-writing. Read-only GitHub vaults keep navigation but disable dragging and
refuse reorder.

Source and model tests cover the planner; the real-host drag, keyboard, menu,
undo, peer, rename and conflict workflow is implemented in
`tools/outline-reorder-scenarios.mjs` (checking physical UTF-8 BOM and CRLF file
bytes across drag, Undo/Redo and explicit save; the editor text itself carries no
BOM) and the genuine cache-only GitHub refusal (non-draggable rows, refused
keyboard move, no enabled menu move, unchanged text, zero API/raw requests,
unchanged blobs) in `tools/outline-pane-scenarios.mjs`. The historical complete isolated
`--outline-panes` collection passed on native desktop (15 checks) and
actual-folder WASM (27 checks), source
`59a76a2fc3313e554022405611006926b6a64901ab78594449d0f0ce2af01141`.
Four raw before/after input records match; both reports retain stable artifact
bindings and complete teardown audits with no unexpected records. Native has
one expected conflict-refusal diagnostic; WASM has that diagnostic plus its
shared explicit-save conflict control. Native restart transport diagnostics
remain in the report, not a clean-console claim.
[Retained reports, inputs, logs and audits](../Engineering/RoadmapIntegration/2026-11-01/outline-authoring-59a76/receipt.json)
do not renew the later combined main source or establish native/private/visual,
physical IME, scale or exhaustive Unicode equivalence.

The matching current-main
[native](../Engineering/RoadmapIntegration/2026-11-02/outline-authoring-212e/native/outline-panes-smoke.json)
and [actual-folder WASM](../Engineering/RoadmapIntegration/2026-11-02/outline-authoring-212e/wasm/outline-panes-web-smoke.json)
reports now renew the full 15/27-label `--outline-panes` collection, not a conflict-only
diagnostic. Trusted pointer drag, keyboard/menu moves, one-step Undo/Redo,
peer/metadata updates, exact physical BOM/CRLF save, rename/dirty external-change
refusal, owner replacement and restart/reconnection all pass. Genuine cache-only
GitHub navigation/reorder refusal retains every content/configuration blob with
zero API/raw requests. Raw before/after source inputs, embedded catalogs and
actual artifact hashes remain identical on the 595-input `212ef2f3` source.
Native has one expected reorder-guard diagnostic, WASM that guard plus its
inherited explicit-save conflict, and neither has unexpected final records.
All four recorded native generations exit 0/null/no deadline; browser has
positive acknowledged/drained actual code-0/no-force helper exit. Recorded
owned PIDs are independently absent. [Current evidence and retention limits](../Engineering/EVIDENCE.md#outline-authoring-on-main-2026-11-02)
do not establish physical OS drag, IME, arbitrary scale or new native Unicode counts.

### Word count (Unicode)

`countWords` is covered by bounded tests: numeric groups, apostrophe/hyphen runs,
precomposed Latin/Greek/Hebrew/Arabic/Thai letters, individual CJK/kana/Tibetan
characters, grouped Korean/Tamil, no emoji words, and CR/CRLF/U+2028 separators.
Known implementation gaps, characterized (not endorsed) by tests: combining marks
split a word (decomposed "été" counts 2; Devanagari "हिन्दी" counts 3),
supplementary-plane ideographs (CJK Extension B) count 0, and a zero-width space
splits a word. Native Obsidian equivalence for these is unverified; fixing them
requires native count evidence first.

## Host API boundary and limits

The actual view exposes its ItemView/App ownership, live `file` and guarded
asynchronous `setFile(file)` method, which fixes that pane to a selected
Markdown note. The core handle advertises its real registered `outline` factory.
An enabled fixture plugin exercises these contracts through a palette command;
this does not establish the complete original private Outline ABI or every
supplied plugin's use of it.

Filters are bounded to 1,024 characters. Up to 4,096 fold keys of 8,192
characters can be saved; oversized Collapse all requests refuse explicitly.
Rendering shows up to 3,000 visible headings and provides a narrowing prompt.
These application bounds are separate from native equivalence.

Complete private tree/controllers, exhaustive Markdown
metadata/original-runtime behavior, cursor/navigation history and full native
presentation/accessibility remain separate. Word-count Unicode variants remain
the documented subset in [Core plugins](CORE-PLUGINS.md); no new native count
evidence was gathered. [Source-bound acceptance](../Engineering/OUTLINE-PANES-2026-10-28.md)
records the real host workflows, exact source and persisted error audits.
