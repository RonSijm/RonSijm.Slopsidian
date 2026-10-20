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
the separately registered viewers below support PDF/SVG/video and raster formats. Remote URLs
and HTML are not imported by this workflow.

### Folder import

Integrated 2026-11-01. Isolated native and actual-folder WASM attachment
scenarios passed on source
`dffe028767d46d9dd60af52136fd2ef1e8ac1b868de5ce60ec5ff21de5c5ea11`.
[Current combined desktop/WASM renewal](../Engineering/INTEGRATION-WAVE-2026-11-03.md) now passes.

Run **Attach folder to current note** from the command palette or the **Attach folder** status-bar button and choose one
folder, or drop exactly one folder (without other files) into the editor.
The same workflow, limits (20 files, 16 MiB per file, 32 MiB in total),
read-everything-first preflight, destination preference, file-mutation barrier,
stale note/selection/mode/vault checks, single undo step and partial-copy
review apply. The selected folder becomes one newly reserved folder under
the configured destination (`Photos`, then `Photos 1` if a file or folder,
including by case, already exists) and its relative hierarchy and bytes are
kept. One explicit relative Markdown link per file replaces the insertion
range, in selection order.

Intentional limits: empty folders and folder metadata are not recreated; a
selection with a hidden, reserved, over-long or case-aliased name, more than 12
levels, more than 1000 visited entries or more than one root is refused whole
rather than skipped. In the **desktop** shell the host owns the source
boundary: the renderer takes the real path of the chosen or dropped folder
(`webUtils.getPathForFile`) and the main process (`desktop\attachment-source.cjs`,
IPC `vault:attachment-folder`) enumerates it itself. It refuses the whole
import for a link/junction/reparse root, any entry that is a symlink, junction
or non-regular file or that does not resolve to its own path beneath the
root, any browser-claimed file outside the root or not in that listing,
limit violations and files that change while read, and only then returns the
bytes. A junction/symlink in a parent component of the chosen root is refused
(the real path must equal the selected path, ignoring case). Each file is opened
as a handle whose identity (device, inode, size, mtime, regular-file type) must
match the checked entry, and the path is re-verified, before any byte is read;
bytes are read through that same handle, so a path swapped for a link after the
walk is refused without reading the foreign target. Residual limit: a swap
between the final path recheck and reading is bounded by the handle identity
check, not by OS-level no-follow opens (unavailable on Windows from Node). This
applies to folders only; individually chosen files follow the user's explicit
selection. In the **standalone WASM/browser** build the engine enumerates the
granted folder and the page has no path or reparse information, so it cannot
prove or refuse link ancestry; that limit is intentional and the browser
scenario only records the observed engine behavior. Late destination
collisions still stop at the create-only endpoint; copied files stay and are
listed for review, never rolled back or deleted.

Unit coverage is `tests\attachment-directory.test.mjs` and
`tests\attachment-source.test.mjs` (real disposable junction/symlink fixtures
and outside sentinels). The folder cases in
`tools\attachment-scenarios.mjs` (**Attach folder** button, directory drop,
hierarchy and byte comparison, link placement, root collisions including case,
mixed folder/file refusal, undo/redo, late-collision partial import,
stale-edit-during-read refusal, junction fixture and restart) passed on both
hosts. The directory chooser expanded three fixture files with their
`webkitRelativePath`, and the desktop bridge resolved their paths. The
desktop junction case refused the whole import with outside bytes intact;
the browser recorded only its observed engine behavior, not a general
reparse-ancestry guarantee. Picker contents are supplied by the CDP file-input
fixture; ordinary product selection remains user-granted.

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

## Attachment viewers

The isolated base viewer pair passed on source
`22521869de41a1c1177e9764d8c365d8168486db048d26d186e74b0d14db4dd7`.
The additional AVIF, seekable-video and genuine cache-only read-only proof
passed on source
`c8ab01f167e03492bb7e0fd9eaf1655075fd11c4376a4fcfa2ace19424d944d9`.
Both identities matched the paired builds and before/after run inputs.
[Current combined acceptance](../Engineering/INTEGRATION-WAVE-2026-11-03.md) renews both viewer and additional-proof
collections. It does not promote unrelated inherited code.

| Format | Viewer | Status |
| --- | --- | --- |
| PNG, JPEG, GIF, WebP, AVIF | `ImageView` (`client\image-view.ts`) | Registered; bytes read through guarded `readBinary`, with real format sniffing. PNG/JPEG/GIF/WebP decode and the deterministic 32x16 AVIF pixel fixture pass on both hosts with exact bytes. This does not establish every possible encoding variant. |
| SVG | `ImageView` + `client\svg-sanitizer.ts` | Parsed and sanitized before display (scripts, event handlers, `foreignObject`, external references/style resources, DOCTYPE/ENTITY rejected or removed), then shown from a blob `<img>`. Malformed or dimensionless files are explicit errors, never a 300 x 150 decode. Removals are reported in `data-image-blocked`. |
| PDF | `PdfView` (`client\viewer-views.ts`, `client\pdf-engine.ts`) | Real bounded canvas renderer on pdfjs-dist 6.4.299 (Apache-2.0), lazy-loaded from local `js\pdf-api.js` with an owned module worker (`js\pdf-worker.js`) and local cmaps/fonts/wasm; engine page count, password prompt, error/unsupported states, cancellation and worker/document teardown, finite page/zoom/pixel limits, `#page=N&zoom=P` link targets. No text layer, annotations, links or forms; active content is not executed and is reported in `data-pdf-blocked`. |
| MP4/M4V, WebM, OGV, MOV | `VideoView` | Native `<video>` on a blob URL with download/remote-playback/PiP disabled; time, rate, volume and mute persist in view state. Playback depends on the host's own codecs; no codec universality is claimed. |

All viewers register through the workspace extension registry (plugins cannot
take a built-in extension), release object URLs on unload/close, reload on
external modification and rename, and ignore stale loads after a vault switch.
They are read-only. Files over the 16 MiB binary transport limit fail with that
explicit error; there is no streaming, editing, export or native-app handoff.
Pure policy is covered by `tests\viewers.test.mjs`. The actual-host scenarios are
`npm run smoke:viewers` and `npm run smoke:viewers:web`
(`tools\viewer-scenarios.mjs`) and the additional
`smoke:viewer-proofs` / `smoke:viewer-proofs:web`
(`tools\viewer-proof-scenarios.mjs`). The base pair covers real SVG sanitizing,
PDF canvas pixels/page counts/zoom/password/errors, bare and encoded links,
invalid locked-page refusal, video state replacement, external modify/rename/
delete and restart. It used a simulated read-only flag and non-seekable
MediaRecorder WebM; those limitations remain attached to that earlier pair.

The later proof uses independently generated synthetic fixtures with hash
provenance in `tests\fixtures\viewers`: AV1 still-image pixels and a four-second
VP9 WebM with Cues, observed seekable range and exact red/blue frames at
`#t=1`/`#t=3`, including a fresh load. The same viewers run from a genuine
cache-only GitHub mount with binary writes refused, zero API/raw requests and
unchanged cached blobs. Host decoder support is established for these fixtures,
not codec/device universality. The AVIF is a fixed fixture, not an in-browser
encoder demonstration.

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
Full drag/clipboard/private API equivalence, extra viewers,
new attachment preference controls, multi-caret insertion and cross-process
or crash-durable batch transactions remain outside this feature. Browser
permission and filesystem concurrency limits continue to apply.
