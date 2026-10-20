# Markdown autosave

[Feature-parity index](../FEATURE-PARITY.md)

Markdown notes now save automatically on desktop and standalone WASM. This
closes an everyday editing gap: ordinary typing no longer needs Ctrl+S or a
note transition before it reaches the vault file.

## Using autosave

Autosave starts enabled. It saves after two seconds without an edit and
attempts a save after ten seconds of continuous editing. These intervals are
event-loop targets; a suspended browser tab, blocked file operation or slow
storage can delay them.

The status bar shows **Autosave on**, **Autosave pending**, **Saving Markdown**,
or a save failure. Click it to pause or resume automatic Markdown saves. The
**Toggle Markdown autosave** command offers the same control. Paused notes
retain their unsaved indicator/count, and **Save** / **Ctrl+S** still work.

The preference belongs to the selected vault and survives restart/reconnect.
The Boolean `markdownAutosave` in `.obsidian/app.json` is absent by default,
which means enabled. Explicit changes preserve unrelated fields and the
configuration's UTF-8 BOM. An invalid value pauses autosave without silently
rewriting the file. Resume explicitly replaces that value. If saving the
preference fails, autosave pauses locally and displays a retry action; the
previous on-disk preference still applies at the next startup.

## Save failures and external edits

A failed save retains the editor text and dirty indicator. A persistent
**save issue(s)** button opens **Markdown save status**. The panel identifies
the note and reason, with **Retry save** and **Open note** actions. The
**Review unsaved Markdown notes** command opens the same panel.

Automatic retries stop for the failed note, including after further typing.
A successful explicit save or returning to clean text clears its failure.
Other notes can continue saving. Open note selects an existing pane without
implicitly retrying another note’s failed save. Each Retry affects its own
note. There is no force-overwrite action.

Every save uses the existing file-version check. If an external program
changes the file, a stale automatic save and a stale Retry both fail while
preserving the external bytes and the editor draft. Copy any edits you want
to keep before using the existing **Reload from disk** action to accept the
external version. Reload asks before discarding dirty text. The panel does
not merge documents or create a backup automatically.

## Shared editing and lifecycle

Source and Live Preview panes share one scheduler per Markdown document.
Inactive notes also save. Acknowledging a write updates the saved version
without replacing the CodeMirror document or resetting its undo history.
UTF-8 BOM, existing CRLF/LF separators and Unicode follow the existing text
write path. Browser save responses now retain BOM metadata for later saves
and draft capture.

Writes serialize through the shared document session. An edit received during
a save is persisted before an explicit Save finishes. Automatic saves can
stop after the current write when paused or when a transition begins;
remaining text stays dirty. Timers defer while files/layouts are changing or
the document is reloading. Rename and tab close retain their explicit save
preflight. An orderly vault change or desktop shutdown stops timers, waits
for accepted automatic/preference writes and performs its existing save
preflight before releasing the source vault. Root and session ownership are
checked before each document write.

## Validation and limits

Validation is recorded in [the evidence log](../Engineering/EVIDENCE.md#safe-markdown-autosave).
The dedicated suites are `npm run smoke:autosave` and
`npm run smoke:autosave:web`, after building their respective hosts. Their
vaults start with default-on autosave. Older manual-save acceptance scenarios
explicitly pause it so that their deliberately dirty-buffer workflows retain
their original meaning.

The shared scenario checks real typing, exact files, undo/redo, Source/Live
Preview splits, an inactive pane, continuous input, in-flight edits and
explicit-save serialization, independent failed-note navigation/retry, real
external conflicts,
confirmed reload, preference failure/retry, persistent pause/resume, rename,
tab close and repeated vault selection. It verifies desktop orderly-close
flushing and browser clean reload/reconnect separately. One delayed write and
one rejected document/preference write are explicit fixtures; they do not
establish every storage-failure behavior.

This feature covers built-in Markdown document sessions. Canvas and custom
TextFileViews retain their separate save coordinators. It does not establish
complete plugin save-event semantics, original-editor timing equivalence,
cross-process exclusion, crash-durable transactions, or protection against
renderer/OS/power loss before a write completes. Browser unsaved-close
protection, [saved-text recovery](FILE-RECOVERY.md) and
[desktop draft rescue](DRAFT-RESCUE.md) retain their separate scopes.
