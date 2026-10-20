# Import attachments into notes

[Feature-parity index](../FEATURE-PARITY.md)

Built-in Markdown notes support local attachment import on desktop and
standalone WASM. Source mode and Live Preview share the same workflow.

## Add files

Open a note and place the caret or select the text to replace. Click
**Attach files** in the status bar, or run **Attach files to current note**
from the command palette. Select one or more files. You can also drop files
into the text editor or paste an image with **Ctrl+V**. Ordinary text paste
continues to use the editor's normal behavior.

PNG, JPEG, GIF, WebP and AVIF files are inserted as image embeds. Other files
are inserted as links. Opening a file still depends on the existing viewers;
this feature does not add a PDF, SVG or general document viewer. Remote URLs,
HTML and folder drops are not imported by this workflow.

A selection can contain up to **20 files**, **16 MiB per file** and **32 MiB
in total**. Invalid or unreadable selections produce an import review. Original
files are read without modification. File copies retain their exact bytes;
the app does not resize or re-encode selected images. Clipboard images retain
the bytes supplied by the browser's paste event.

## Placement and filenames

The workflow uses the existing `attachmentFolderPath` preference in
`.obsidian/app.json`, also used by Audio recorder:

| Preference | Destination |
|---|---|
| Absent, empty, `.`, or `/` | Vault root |
| `Attachments` | That vault-relative folder |
| `./Assets` | An Assets subfolder beside the owning note |
| `./` | The owning note's folder |

Missing destination folders are created by the existing binary-write path.
This feature does not add a separate attachment settings page. Hidden,
traversal, invalid and reserved paths are refused.

Existing files and folders are retained. Names such as `Photo.png`,
`Photo 1.png` and `Photo 2.png` are chosen against the current inventory and
other files in the selection, including case collisions. A late collision
still goes through the create-only endpoint and can stop the import.

Inserted links use explicit relative Markdown URLs, with encoded spaces,
punctuation and Unicode. An identically named root folder cannot capture a
note-relative attachment link.

## Note editing and failed imports

The app captures the owning note and its insertion range before reading files.
It reads the whole selection before creating destination files. If the note,
selection, mode, file or vault changes during preparation, insertion is
refused. File creation uses the existing file-mutation barrier and save
preflight; edits to open notes are saved before the copies begin.

Once all copies are confirmed, their links replace the captured range as a
single undo step. Split panes receive the same document edit. Undo removes
the links and retains the attachment files. [Markdown autosave](MARKDOWN-AUTOSAVE.md)
persists the resulting note when enabled; explicit Save remains available.
Its existing external-version checks also protect the note.

A stopped batch is not an atomic rollback. Confirmed copies remain in the
vault, and no batch links are inserted if creation or insertion cannot finish.
**Attachment import** lists confirmed paths and provides their links in a
read-only text field for copying. An unconfirmed write is listed separately:
its path might already exist or its write might have completed. The app does
not delete those paths or retry automatically.

An **Attachment import issue** status button reopens a failed report.
**Review last attachment import** opens the current transient report from the
command palette. Reports are not restored after an application restart.

Accepted imports block orderly desktop close and vault leaving until they
settle. Browser page reload/close is also guarded while an import is pending,
even when the note is clean. Reading mode disables Attach files. Unhandled
local file drops are prevented from navigating away from the application;
editor and plugin handlers retain their own handled drops.

## Validation and limits

The dedicated suites are `npm run smoke:attachments` and
`npm run smoke:attachments:web`, after the corresponding host build. They
start with default-on autosave. The shared scenario uses real browser File
input data, trusted drag events with filesystem-backed files, OS image/text
paste, decoded image previews and exact note/source/attachment bytes. It also
checks placement, collisions, shared undo, limits, partial copies, uncertain
acknowledgements, stale edits/renames and restart/reconnect. Source-read/write
holds and a lost acknowledgement are explicit test fixtures. Clipboard setup
uses the existing test host; the standalone product uses browser paste events
and requires no native companion.

Current acceptance is recorded in [the evidence log](../Engineering/EVIDENCE.md#import-attachments-into-notes).
Full drag/clipboard/private API equivalence, folder imports, extra viewers,
new attachment preference controls, multi-caret insertion and cross-process
or crash-durable batch transactions remain outside this feature. Browser
permission and filesystem concurrency limits continue to apply.
