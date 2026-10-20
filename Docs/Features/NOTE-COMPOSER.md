# Note composition and shared context actions

[Feature-parity index](../FEATURE-PARITY.md)

## Scope

This is an independently authored desktop/WASM implementation of Note composer,
not a port of the bundled Obsidian controller. The implementation supports
merging Markdown notes and extracting a selection or a heading with its
children. Current accepted runs and artifact limitations are recorded in
[Evidence](../Engineering/EVIDENCE.md).

| Workflow | Implemented behavior |
|---|---|
| Selection extraction | Move the actual editor selection into an existing or new Markdown note; retain the source editor and its undo history. |
| Heading extraction | Include child headings through the next same-or-higher heading, excluding trailing blank lines before that next heading. Use actual raw UTF-16/CRLF boundaries. |
| Merge | Combine metadata/body, repair supported incoming references, move the source to vault trash and open the target after the file-mutation lock is released. |
| Placement and creation | Append by default; choose prepend or use Shift+Enter. Explicit new-target checkbox or Ctrl+Enter creates a nested note without replacing an occupied file/folder. |
| Replacement | Existing `replacementText` setting selects a wiki link, embed or no replacement. |
| Template | Existing `template` setting selects a note, with literal one-pass `fromTitle`, `newTitle` and `content` substitutions. A nonempty template without a content slot appends one. |
| Confirmation | Existing `askBeforeMerging` setting controls explicit merge confirmation. Extraction does not trash the source. |
| File contexts | Actual file-tree and current-file action menus expose merge, including a selected Markdown file that is not the active editor. |
| Editor contexts | Actual source-editor menus expose extraction when the corresponding selection/heading exists. Commands remain available through the palette. |
| Lifecycle | Disable removes commands/event subscribers and closes owned dialogs/menus; stale retained controls cannot apply the operation. |

The real command IDs are `note-composer:merge-file`,
`note-composer:split-file` and `note-composer:extract-heading`.

## Preservation and explicit refusal

Composition uses the existing guarded file batch, including create-if-absent
targets and combined source trash/reference edits. It saves legitimately
captured dirty source text, but rejects a source changed after the dialog was
opened. Retargeted/destroyed source views, occupied destinations, external
version conflicts and close-hook vetoes must fail visibly.

Source and template links are relocated independently before substitution.
Supported reference-link/image definitions and transitive footnotes accompany
an extracted fragment. Existing target content, BOM/newlines, unknown YAML and
unchanged exact numeric tokens are preserved by the supported AST merge.
Source frontmatter is merged separately rather than inserted as ordinary body
text inside a template; this preservation-oriented choice is not a claim of
identical native template behavior.

Whole-note merge repairs supported Markdown/property/Canvas references.
Extraction redirects only fully moved heading/block targets; whole-note cards,
remaining sections and unrelated data stay on the source. Unsafe YAML aliases/
anchors, incompatible property types, conflicting definitions and ambiguous
transferred anchors are refused. A batch is limited to 256 changed files.

An unresolved non-root link cannot safely identify its future location when
content moves between folders. Such a transfer is refused instead of silently
changing that location. Resolve the link or explicitly qualify its vault-root
path, for example `[[/Future note]]` or `[Future](/Folder/Future.md)`.
Malformed relative URL encoding is also refused when moving between folders.
These are deliberate conservative restrictions, not native equivalence claims.

If a plugin edits an open buffer during/after a committed write, its text is
retained and the dialog reports that the file operation committed but editor
changes remain unsaved. Apply is disabled so the operation cannot run twice.
Whether a later save needs conflict resolution depends on when that buffer
changed relative to accepting the committed version.

Source-editor undo does **not** undo the created/modified target, repaired
incoming files or source trash as a cross-file transaction. Browser writes
preflight and roll back supported failures; they are not atomic or crash-durable
transactions across applications.

## Shared menu/API boundary

The shared `Menu`, `MenuItem` and `MenuSeparator` classes back real file/editor
events. They support labels/fragments, icons from the current icon set,
checked/disabled/warning rows, sections, separators, viewport placement,
pointer/keyboard selection and owned dismissal.

Replacing an editor context menu must not remove Cut, Copy, Paste or Select all.
The shared actions retain actual CodeMirror selection and independent undo
transactions, normalize pasted newlines and reject asynchronous stale-editor/
selection changes, including a second selection added during permission access.
Clipboard actions currently require one selection; multiple selections are
refused explicitly before copying or deleting text. Permission failures are visible. Runtime clipboard cases use
a bounded API fixture: they never read or overwrite the user's system clipboard.
Actual clipboard permission prompts are not accepted by those cases.

Native Electron menus, menus in other windows, nested/private menu contracts,
complete hotkey scopes and full original icon/DOM/visual equivalence are not
implemented or established. Explicit requests for unsupported native/popout
menus fail rather than pretending to provide them. This API subset and its
independent CommonJS probe do not establish Templater/Excalidraw compatibility.
