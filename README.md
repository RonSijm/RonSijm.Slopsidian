# Slopsidian

An independent .NET 10/Blazor application targeting the Obsidian 1.12.7
Windows desktop workflow, with an Electron/JavaScript bridge for existing plugins.
A separate standalone Blazor WebAssembly host shares the UI and editor.
The goal is a complete desktop replacement with matching workflows and broad
plugin/theme compatibility. **That goal has not been reached:** this is the
expanding workspace/core-plugin implementation, not an indistinguishable or
feature-complete replacement.

See **[Features, scope and live parity status](Docs/FEATURE-PARITY.md)** for the
maintained overview and documentation map. Detailed pages cover the
[application inventory](Docs/Features/APPLICATION.md),
[31 core modules](Docs/Features/CORE-PLUGINS.md),
[plugin/API compatibility](Docs/Compatibility/PLUGIN-API.md),
[desktop/WASM differences](Docs/Compatibility/DESKTOP-WASM.md),
[evidence](Docs/Engineering/EVIDENCE.md) and
[remaining-work roadmap](Docs/Project/ROADMAP.md).

The native desktop host targets Windows. The browser host supports local folders
in Chrome/Edge over HTTPS or localhost. Native Linux/macOS and mobile hosts remain
out of scope. Official Obsidian-hosted Sync/Publish services are not supplied by
rewriting the desktop client. Their client workflows remain required,
currently unimplemented core-benchmark entries with account/service dependencies.

## Run the desktop app

Requires Windows x64, the .NET 10 SDK, Node.js 24.11+ and PowerShell 7.
Run these commands from the repository root:

```powershell
.\build-and-run.cmd
```

`RonSijm.Slopsidian.sln` contains both the desktop and standalone WASM projects.
Both use the `RonSijm.Slopsidian` namespace root; the application display name
is **Slopsidian**.
The script installs missing npm tooling, prepares the pinned stock Electron
runtime, type-checks the TypeScript bridge, builds the C# application, and shows
the **Open a vault** startup dialog. A fresh Electron download is checked against the pinned npm
package's SHA-256 checksum. Application builds require only the dependencies
listed above.

To open an existing vault, use **Browse...** beside **Vault folder**, select
its folder, and click **Open**. You can also enter the full folder path.
To create a vault, enter its name, choose its parent **Location**, and click
**Create vault**. This creates a new subfolder; an existing file/folder with
that name is rejected rather than overwritten.

The folder icon near the bottom of the left ribbon and the vault-name button
at the bottom of the file explorer reopen this chooser. **Back to vault**
cancels without discarding unsaved notes; confirming another vault saves
open notes before switching. The generated demo vault remains available at
`.runtime\DemoVault`, but is no longer opened automatically.

To bypass the startup chooser, pass a test copy explicitly:

```powershell
.\build-and-run.cmd "--vault=D:\Notes\TestVault"
```

Create a note with **Ctrl+N** or the file explorer's new-note button. A relative
name such as `Projects\First note` creates the containing folder. Normal file
clicks reuse the current unpinned tab; **Ctrl+click** opens another tab.

**Ctrl+O** shows real recent files when empty, and finds frontmatter aliases
and grouped bookmark targets when searching. It opens actual notes, headings,
saved searches, folders and graphs through their existing controllers.
[Navigation and persistence limits](Docs/Features/DISCOVERY.md#quick-switcher-recent-files-and-bookmarks).
Imported `app.json.newLinkFormat` and `useMarkdownLinks` control the shared
link-generation APIs and Note composer replacements.
[Supported preferences](Docs/Features/DISCOVERY.md#link-generation-preferences).

Imported **Backlinks** tabs now work in the main workspace and sidebars, with
independent note targets, filters, context, sorts and folds. **Open Backlinks
in a tab** creates another. Source navigation also works in read-only vaults.
[Supported workflows and limits](Docs/Features/BACKLINKS.md).

[Markdown autosave](Docs/Features/MARKDOWN-AUTOSAVE.md) saves after two seconds
of inactivity and attempts a save during continuous typing too. It is on by
default on desktop and WASM. The status bar shows pending/failed saves and lets
you pause or resume per vault; failed notes retain their text and offer Retry.
**Ctrl+S** saves all open notes. Note replacement, tab close, vault change and
orderly desktop shutdown also save affected notes. Canvas and editable custom
TextFileViews have their own guarded, two-second debounced saves.

Use **Attach files** to add local images and files to a Source or Live Preview
note. File drops and **Ctrl+V** image paste also work. Copies follow the existing
attachment-folder preference, avoid existing filenames, and insert links as
one undo step. Partial or uncertain imports show the retained paths for review.
[Attachment import and limits](Docs/Features/ATTACHMENTS.md).

If the desktop local host stops unexpectedly while its editor window survives,
[Markdown draft rescue](Docs/Features/DRAFT-RESCUE.md) keeps the window open and
copies unsaved built-in Markdown into new local-profile folders. The warning
shows their location; closing captures current text again before confirmation.
Desktop startup can remind you about unreviewed folders. **Review Markdown
rescue copies** (**Ctrl+P**) opens the complete retained catalog. Expand
**Source notes and copy status** and select **Inspect copy** for a current byte/
BOM/hash check and bounded plain-text preview. **Mark reviewed** stops that
capture’s startup reminder; **Remind me again** restores it. Review restoration
manually. This does not cover renderer/OS crashes,
power loss, Canvas/plugin drafts or standalone-WASM recovery.

The **Editor mode** status button offers **Source mode**, **Live Preview** and
**Reading view**; **Ctrl+E** switches Reading on/off while remembering the
editing choice. Live Preview supports selection-aware formatting, editable
tasks and local image/table/Mermaid widgets with an **Edit** action that reveals
their original Markdown. Modes are independent per pane and do not save dirty
text or reset undo. Editor status can be disabled without disabling the modes.
New unspecified leaves honor `app.json.livePreview: true`; absent that
preference, this project retains its previous Source default.
[Supported editing scope and remaining gaps](Docs/Features/APPLICATION.md#editing-modes-and-ownership).

Saves detect changes made by another editor instead of silently overwriting
them. **Reload from disk** explicitly confirms discarding unsaved text.
Edits to the same file are shared live across its open tabs and split panes,
instead of creating independent buffers that conflict with each other's saves.

Drag the divider between split panes to resize them, or focus it and use the
arrow keys. Escape cancels a drag; double-click balances adjacent panes.
Saved layouts retain the proportions. [Pane resizing](Docs/Features/PANE-RESIZING.md).

When enabled under **Settings > Core plugins**, **Note composer** merges notes
or extracts a selection/heading into an existing or new note. Use the command
palette or right-click the file/editor. Shared context menus also expose plugin
actions and standard editor operations. Composition preserves the supported
metadata/links and rejects unsafe conflicts; see its
[scope and data-safety limits](Docs/Features/NOTE-COMPOSER.md).

The demo includes the official **Sample Plugin** and a separate **Editor
compatibility probe**. Open **Settings > Community plugins** using the gear
icon or **Ctrl+,**, then choose **Enable trusted plugin**. Plugin commands are
available in **Ctrl+P**; settings tabs appear in the settings navigation.
Explicit enable/disable choices are saved per vault in
`.obsidian\community-plugins.json`. GitHub vaults keep these choices in the
local preference overlay.

Use **Browse** to search the official Community catalog and review/install a
release into a writable local vault. Installation does not start code or add an
enabled ID; existing configured IDs are preserved and may restore on reopening.
**Find updates** preserves data/enablement and restarts a previously running
plugin. **Uninstall** confirms deletion of its entire plugin directory and data.

In WASM, direct GitHub release downloads can fail CORS. Download the same
release's `manifest.json`, `main.js` and optional `styles.css`, then use
**Select downloaded files**. No hosted relay or vault upload is used.
Read-only GitHub mounts can browse but cannot change packages.
[Community workflow, CORS guidance and limits](Docs/Features/COMMUNITY-PLUGINS.md).

The supplied Linter 1.34.2, Note Refactor 1.8.2 and QuickAdd 2.32.1 also run
[bounded real authoring workflows](Docs/Engineering/PLUGIN-AUTHORING-WORKFLOWS-2026-10-28.md)
on desktop and WASM: formatting/first Ctrl+S, selection extraction/cursor split,
and Template/Capture choices. Broader plugin functionality remains partial.

[Expanded original-plugin workflows](Docs/Engineering/PLUGIN-WORKFLOW-EXPANSION-2026-10-28.md)
also cover Omnisearch search/open, Linter preview/folder confirmation, heading/
custom-name refactoring, offline QuickAdd macros, Kanban editing/deletion and
existing-tab Iconize picker/icons on both hosts. Exact Templater 2.26.0 execution
is desktop-only; WASM Node/HTTP restrictions and broader compatibility remain.

## Run the WASM app

Public GitHub folders can be opened read-only from **Open a vault → Open a GitHub
vault**, in both desktop and WASM. The initial tree contains lazy file references;
notes and embedded attachments download only when opened. Exact file bytes and
the inventory persist in IndexedDB, with an explicit cached-snapshot option.
Personal settings stay local; repository files cannot be modified. Search and
backlinks cover loaded notes, as identified in the status bar.

Excalidraw 2.29.0 drawings open in view mode on GitHub vaults, with background
saves disabled. Copy the vault locally to edit drawings.
[Read-only plugin I/O](Docs/Features/READ-ONLY-PLUGIN-IO.md).

Vault defaults and installed community plugins are read from `.obsidian`.
Configured plugins start automatically for WASM GitHub mounts. Manage or pause
them through **Settings → Community plugins**; an explicit Restricted mode choice
and preference changes stay in this browser's local overlay. Local-folder and
desktop defaults are unchanged. Plugin packages must be committed in the vault,
including their `manifest.json` and `main.js`. Example now includes its 24
installed packages; older published snapshots that ignored these files show
their enabled IDs as missing until the updated Example is pushed.

Choose **Offline vault** in the status bar to download the mounted GitHub
snapshot with progress, cancellation, and resume from verified cached files.
Reopen with **Use cached snapshot only** to browse its contents without GitHub
requests. This caches vault content; the web application must still be available.

The WASM host also accepts direct links such as
`https://slopsidian.md/remote-vault/github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example`.
Append `?file=30%20Projects%2FGarden` to open `30 Projects/Garden.md` directly.
The path is relative to the vault; `.md` is optional. Opening a file or switching
file tabs updates the address, and browser Back/Forward reopens previous files.
An explicit file link takes precedence over locally restored panes. Missing
files show an error while leaving the vault available for browsing.

Try these public vaults in the read-only GitHub reader:

- [dive4dec/obsidian-vault](https://slopsidian.md/remote-vault/github.com/dive4dec/obsidian-vault)
- [community-archive/obsidian-hub](https://slopsidian.md/remote-vault/github.com/community-archive/obsidian-hub)
- [kepano/kepano-obsidian](https://slopsidian.md/remote-vault/github.com/kepano/kepano-obsidian)

These require deploying this version. The same reader ships as the
[GitHub Vault Obsidian plugin](plugins/github-vault/README.md); native Obsidian
uses a separate read-only browsing pane through public APIs.

The web host is separate: the default desktop build and launcher still use
Electron and the local .NET server. To build and open the standalone browser app:

```powershell
.\build-and-run-web.cmd
```

This publishes a static site, starts a loopback static-file server, and opens
your default browser. No Electron runtime or ASP.NET server is needed for the
web app. Use current Chrome or Edge if your default browser lacks folder access.
You can also run `npm run build:web` followed by `npm run start:web`.

Choose **Open a folder** and grant read/write access to a vault. Notes are read
and written directly in that selected directory, not imported into a browser
copy or uploaded to the static host. To create a vault, enter its name and use
**Choose location and create**. The app remembers directory handles in IndexedDB;
after a page reload, use **Reconnect** and grant permission again if requested.
Recent handles belong to this site's origin and base path. Clearing browser
storage removes them, but does not delete the vault.

Markdown autosave writes to the actual files; wait for the pending/save status
to clear before refreshing. Ctrl+S and Save remain available. Unsaved buffers
block ordinary page reload/close. Version checks reject stale saves and retain
the editor text, with a persistent failure status and explicit retry. Browser
background suspension can delay saves, and directory handles do not provide
cross-application filesystem transactions or crash recovery.

The browser host has deliberate limits:

- Folder access requires HTTPS or localhost, a supported browser, and explicit permission.
- External changes are polled rather than observed with a native filesystem watcher.
- Original creation times are unavailable and reported as `0` (unknown).
- Guarded file moves, vault trash, folder creation and reference batches work; copy/delete/rollback is not native atomic or crash-durable mutation.
- Node/Electron modules, OS shell commands and desktop-only plugins are unavailable.
- Unsafe/lossy JSON configuration numbers are rejected rather than silently rounded during a rewrite.

The experimental JavaScript compatibility runtime is shared. Unchanged
**Templater 2.20.6** now passes fifteen bounded workflow groups on desktop and
actual-folder WASM: real insertion/save/undo, cursor jumps/multiple selections,
Source folds and transactions, configured root/current/folder creation and
guarded rename, serialized file processing, automatic folder/regex/content
rules, startup scripts/hooks, settings, in-app CLI, dynamic Reading,
syntax/runtime failed-creation cleanup and lifecycle/reconnect.
Its original highlighter is deliberately desktop-gated; native-adapter path
helpers remain unavailable in WASM, even for relative paths. Shell/external
modules and complete Templater compatibility remain unfinished.
Unchanged **Excalidraw 2.29.0** passes ten bounded groups per host: actual
pointer drawing/undo/movement, its original linked-PNG picker, compressed
physical save, close/reopen, restart/reconnect, owned disable/re-enable and
an actual SVG/linked-PNG Reading embed. This is not full settings, media/PDF,
import/export or original-runtime drawing equivalence.
See the [plugin-specific scope](Docs/Compatibility/PLUGIN-API.md).
Only enable trusted plugins: their scripts can access the selected vault, the
page and browser network APIs. These results do not establish arbitrary-plugin
compatibility.

The six reported versions now all complete startup on desktop and WASM:
**Tasks 8.0.0, Metadata Menu 0.8.12, Mermaid Tools 1.3.0, Folder notes 1.8.19,
Excalidraw 2.22.3 and Dataview 0.5.68**. Five settings tabs pass; Excalidraw's
separate `this.markSettingsDirty is not a function` settings callback also
fails in the bounded reference SDK comparison. Both exact-release scopes retain
that failure rather than claiming six-plugin parity. Shared fixes include genuine
Moment/DOM/timer/control/icon/editor APIs, real inline metadata/Dataview updates
and stable native App JSON storage across restarts.
Every workspace leaf now exposes its real owning App, fixing the separate
`metadataCache` crash in Excalidraw 2.22.3's note-opening wrapper. Ordinary
App/leaf/File explorer navigation preserves both notes with all six enabled
on desktop and actual-folder WASM. This does not fix or hide the settings failure.
[Exact outcomes and remaining workflows](Docs/Compatibility/PLUGIN-API.md#six-reported-plugin-versions).
These local changes have not been deployed to the live site.

### GitHub Pages

The site is hosted at **https://slopsidian.md/**. Publish at the domain root:

```powershell
npm run build:web -- --base=/
npm run verify:web -- --base=/
```

Deploy **only `.runtime\web\wwwroot`**, not the parent `.runtime` folder or any
vault. Use `--base=/RonSijm.Slopsidian/` only when deliberately hosting beneath
that subdirectory, not for the custom domain.
The publisher also writes `.nojekyll`, a fallback `404.html`, and consistent
compressed entry pages. `npm run start:web` serves the published prefix locally.

The GitHub setup follows the separate build/deploy convention used by
`RonSijm.Blazyload.Components`:

| Workflow | Purpose |
|---|---|
| `.github\workflows\build_main.yml` | Builds the shared JavaScript assets and both .NET projects, then runs the focused regression suite |
| `.github\workflows\deploy_pages.yml` | Publishes and verifies the WASM site, uploads its artifact, and deploys main to the `gh-pages` branch |

Both workflows run on main pushes, pull requests targeting main and manual
dispatch. Pull requests build but never deploy. Native filesystem checks and
publishing use Windows runners; deployment uses Ubuntu. Only the deployment job
receives `contents: write`, using the automatic `GITHUB_TOKEN`; no personal token
or NuGet publishing secret is required.

After the first main-branch deployment creates `gh-pages`, set the repository's
**Settings > Pages > Source** to **Deploy from a branch**, with **gh-pages**
and **/ (root)**, with **slopsidian.md** as the custom domain. The workflow
publishes with `/` as its base path, and the published `CNAME` preserves the
custom domain across deployments. CSS, scripts and framework files therefore
resolve directly beneath `https://slopsidian.md/`, without a repository prefix.

## Core plugins

Open **Settings > Core plugins** to enable or disable this build's supported
modules per vault. Shared independently implemented subsets with lifecycle controls include:
Files, Command palette, Quick switcher, Outline, Word count, Editor status, Outgoing links,
Daily notes, Templates, Unique note creator, Random note, Search, Tags,
Backlinks, Footnotes, Bookmarks, named Workspaces, Properties, Graph, Canvas,
Page preview, Slash commands, Slides, Format converter, Bases, File recovery and Audio recorder. Disabling removes owned commands and relevant
UI/shortcuts; enablement survives application restarts. Other unavailable
catalog entries remain visibly unavailable, not enabled-looking placeholders.
See the [core-plugin inventory](Docs/Features/CORE-PLUGINS.md) for their verified
scope and remaining gaps.

**Quick switcher** (**Ctrl+O**) has existing-only, attachment and all-file-types
settings. The last checkbox follows `app.json.showUnsupportedFiles`.
Registered file views such as Canvas can open directly; unresolved links can
create guarded Markdown targets with source-relative URI handling.
Existing-only still permits explicit **Shift+Enter** creation. The original
full ranking/bookmark/alias behavior and native attachment-viewer set remain.

**Raster images** open in readonly panes through Files, Outgoing and Reading
links. **Fit**, **Actual size** and zoom controls support scrolling, live
external refresh and visible decode errors; zoom and opaque pane state survive
restart/reconnect. PNG/JPEG/GIF/WebP/AVIF extensions are registered, subject to
host decoding. Actual PNG and Canvas navigation is exercised on both hosts;
PDF/SVG/video viewers and image editing/export remain missing.
See the [raster-view scope](Docs/Features/APPLICATION.md#raster-image-leaves).

**Canvas** supports all eight observed settings, including folder placement,
pan/zoom preference, labels, grid/object snapping and the zoom-detail slider.
Ctrl/Cmd-drag empty space to use the configured creation menu, text card,
note, media, website or group action. Creations retain drawn geometry and
saved undo; referenced files are not rewritten. Note/media choices are simple
file selects, and low-zoom details are hidden rather than unmounted.
See [Canvas settings and remaining differences](Docs/Features/CORE-PLUGINS.md#canvas-settings-and-interaction).

On desktop, **Web viewer** additionally provides isolated browser tabs with an
address/search bar, Back/Forward, Reload/Stop, Find and Open in browser. Enable
it under Core plugins, then use its globe ribbon button or **Open web viewer**
command. Its settings support a homepage, search engine and handling of external
web links. Tabs restore their URL/title after a full restart; website sessions
are temporary and separate from the vault/editor. Click **History** or run
**Show web history** to search and reopen the latest 1,000 visits saved in this
vault. **Record visits** pauses/resumes recording; visits can be removed or
cleared after review. **From/Through** filter inclusive local dates and combine
with search; **Reset dates** retains search. **Remove matching visits…** reviews
the filters' exact count before removing only those visits; [scope](Docs/Features/WEB-VIEWER.md#remove-matching-visits).
Right-click a visit or press Shift+F10 for **Open in new
tab**, **Open in this tab**, **Copy link address** and **Remove visit**; pinned history tabs cannot be
replaced. The history pane and preference survive restarts. Row checkboxes and
**Remove selected visits…** review exact visits; **Select shown** respects the
current filters. [Selection](Docs/Features/WEB-VIEWER.md#select-and-remove-visits)
clears on filter/history changes and restart. **Undo removal (N)** offers one
[transient restore](Docs/Features/WEB-VIEWER.md#undo-a-history-removal) of the last
removal while its version remains current; later writes or disable/restart/vault
changes discard it. After Undo, **Redo removal (N)** reviews those restored
visits, removes them again on confirmation and offers a fresh Undo;
[one-step redo scope](Docs/Features/WEB-VIEWER.md#redo-a-history-removal).
**Save shown visits…** reviews current search/date results and creates a new
[Markdown history note](Docs/Features/WEB-VIEWER.md#save-shown-history-to-a-note)
without removing visits or consuming Undo/Redo. **Save selected visits…**
uses only the checked visit IDs, with a separate selected count/review;
[scope](Docs/Features/WEB-VIEWER.md#save-selected-history-to-a-note).
**Open selected visits…** reviews 1–20 checked visits before opening fresh tabs
in displayed order, retaining the history pane. Normal page requests and visit
recording apply; [scope](Docs/Features/WEB-VIEWER.md#open-selected-visits).
**Order** offers Newest first/Oldest first and Title/Address A–Z/Z–A per history
pane, including shown/selected archives and selected-tab reviews;
[comparison and persistence](Docs/Features/WEB-VIEWER.md#title-and-address-order).
**Age limit** saves a vault-wide no-age-limit/7/30/90-day policy. A new recorded
visit prunes expired entries; saving the policy leaves existing visits in place.
Age uses rolling days; [scope](Docs/Features/WEB-VIEWER.md#automatic-age-retention).
**Visit limit…** reviews a vault-wide whole count from 1 to 1,000, defaulting
to 1,000. Saving preserves current visits; accepted new recording applies the
count after age retention; [scope](Docs/Features/WEB-VIEWER.md#visit-limit).
History also shows [cached site icons](Docs/Features/WEB-VIEWER.md#site-icons)
from recorded native pages. **Clear icons** removes this computer's vault-scoped
icon cache without changing history or its removal checkpoints.
**Site zoom** can remember the current 50–300% factor for an origin, forget it
or clear this vault's local preferences; [scope](Docs/Features/WEB-ZOOM.md#site-preferences).
The WASM toggle explicitly
requires desktop. See [scope, restrictions and evidence](Docs/Features/WEB-VIEWER.md).

Click **Reader** on an article, or run **Toggle reader mode**, for an isolated
reading view with supported formatting, Find and safe article links.
**Original page** returns to the retained website; reader intent survives
restarts. Images appear as alt text, and unsuitable pages keep their original
view with an explanation. See [Reader scope and evidence](Docs/Features/WEB-READER.md).

Choose **Custom** under **Reader font** to enter a local family such as Arial.
The custom family is saved per vault, updates open Readers and falls back to
serif if unavailable; presets remain available. See
[custom font families](Docs/Features/WEB-READER.md#custom-font-family).

Set **Reader font** and **Reader article width** under Web viewer settings for
Serif/Sans-serif/Monospace and Narrow/Standard/Wide. Choose **Custom** to reveal
**Reader custom width (ch)**, a whole-number 40–120 control starting at 72;
existing presets and the saved custom value are retained. See
[custom article width](Docs/Features/WEB-READER.md#custom-article-width). Saved preferences update
open readers immediately and persist per vault across restarts. **Reader font
size (px)** offers 14–32 whole pixels and **Reader line spacing** offers
1.2–2.4 in 0.1 steps, keeping 19 px/1.7 defaults and the current reading
progress. **Reader paragraph spacing (em)** offers 0–3 in 0.1 steps, retaining
the existing 1 em margins and independent progress in hidden Readers too.
**Reader letter spacing (em)** offers 0–0.2 in 0.01 steps; zero retains normal
character spacing. See [letter spacing](Docs/Features/WEB-READER.md#letter-spacing),
[typography controls](Docs/Features/WEB-READER.md#font-size-and-line-spacing) and
[paragraph spacing](Docs/Features/WEB-READER.md#paragraph-spacing).
Reader also remembers each pane's last **20 exact article URLs**. Back/Forward
or revisiting a URL resumes its saved position, including through Original page,
restart and vault changes. See
[per-article positions](Docs/Features/WEB-READER.md#per-article-progress-history). See
[reading progress and limits](Docs/Features/WEB-READER.md#reading-progress).

Use **Save page** or **Save web page to vault** to review the loaded original
main document as Markdown, including navigation/sidebar/footer, even while
Reader is displayed. Short pages work too; [scope and omissions](Docs/Features/WEB-CLIPPING.md#full-page-markdown).

Click **Save to vault**, or run **Save web article to vault**, to review an
article's Markdown and choose a new note path. **Save note** creates and opens
it; Cancel writes nothing. Set a default **Clipped article folder** under Web
viewer settings. Forward decimal list starts, zero and nested/adjacent numbering survive preview
and saved Reading; unsupported numbering explains why Save is unavailable.
Merged table cells repeat their contents across an expanded Markdown grid,
retaining supported captions, formatting and column relationships. Nested,
overlapping or oversized tables show a clear error before saving.
Existing files are protected against overwriting, including
external creations after preview. See [clipping scope and evidence](Docs/Features/WEB-CLIPPING.md).

To keep selected words, select text on the original page or in a ready Reader
and click **Save selection**, or run **Save web selection to vault**. Review
the literal text, paragraph breaks and optional properties before saving.
Reader capture uses the displayed article's own title/source context and
rejects obsolete frames/previews. Rich formatting and embedded/control
selection remain separate. See [Reader selection](Docs/Features/WEB-CLIPPING.md#reader-selection).

Enable **Add note properties** in either clipping preview to include editable
title/tags and automatic source/UTC capture time. The complete YAML and original
body are reviewed together before saving. Invalid properties disable Save until
corrected or turned off. Properties start off unless enabled in Web viewer
settings, where you can also save default clipping tags for this vault.
Per-clip edits stay temporary. See [note properties and defaults](Docs/Features/WEB-CLIPPING.md#property-defaults).

Use **−**, the percentage reset button and **+** for **50–300% per-tab zoom**,
or the three web page zoom commands. Zoom applies to original pages and Reader,
survives navigation/restarts and leaves the editor shell at its own scale.
See [zoom controls and evidence](Docs/Features/WEB-ZOOM.md).

**Block ads** in Web viewer settings defaults on and uses bundled EasyList
network rules without background downloads. The footer shows the blocked count
for each tab. Save changes future requests in all tabs; reload pages afterward.
See [ad-blocking scope and evidence](Docs/Features/WEB-ADBLOCK.md).

**Bases** opens real `.base` files on desktop and WASM, with table views,
supported worker filters/formulas, sorting/grouping, search and note navigation.
Click note-property cells for guarded typed edits, or **Edit base source** for
validated YAML configuration. The table ribbon and **Create new base** command
create a real file. Click **Σ** beside a column heading for built-in or custom
summaries across all matching rows and full groups, including other pages.
Unknown YAML and file formatting are preserved in the exercised workflows.
Other view types, embeds and complete function/type/plugin APIs remain;
see [summary semantics, usage and evidence](Docs/Features/BASES.md).

**File recovery** records saved Markdown, Canvas and Bases text with configurable
snapshot intervals and retention. Use **Open file recovery** or its settings
button to search history, preview/copy versions, and review a guarded restore.
Deleted files and missing parent folders can be recreated. History persists in
`.obsidian/vault-dotnet-recovery.json` inside the vault. Unsaved drafts are not
captured; see [storage, limits and evidence](Docs/Features/FILE-RECOVERY.md).

**Audio recorder** provides explicit microphone Start/Stop, a local preview,
create-only attachment saving and guarded embedding into a Markdown source
note. The attachment path follows the supported `app.json` preference; save
the note with **Ctrl+S** after insertion. Local audio plays in Reading view and
audio file panes. Desktop and WASM workflows pass using synthetic audio;
physical-device acceptance remains. Recordings are limited to 10 minutes /
16 MiB; see [permissions, persistence and scope](Docs/Features/AUDIO-RECORDER.md).

**Search** opens with **Ctrl+Shift+F** and runs text, Boolean, regex,
path/file/tag/property and case-sensitive queries in a real worker. Results
navigate to matching source text and follow dirty edits, undo/redo, external
writes and renames. Invalid queries and two-second regex timeouts are visible.
**Tags** offers nested/flat display, four sorts, literal filtering and saved
folds. Imported main/sidebar Tags panes retain independent state; **Open Tags
in a tab** creates another. Click or Enter opens a real Search pane; Ctrl+click
or Ctrl+Enter adds/removes the first literal query fragment. Search must be
enabled. [Pane controls and limits](Docs/Features/DISCOVERY.md#tags-workspace-panes).

**Backlinks** shows linked references and optional unlinked aliases, pin/follow
state and exact source navigation. Its settings can enable backlinks inside
documents. Its workspace-pane migration remains separately owned.
**Footnotes** adds real imported FileViews and **Open Footnotes in a tab**,
independent follow/fixed targets, numbered Markdown previews and exact
definition/reference Source navigation. Both new providers retain state through
desktop restart and real-folder WASM reconnection. Legacy sidebars remain
available. Native editable footnote embeds, grouped following, generated inline
footnotes and complete private-view equivalence are not supplied.
[Scope and acceptance](Docs/Features/DISCOVERY.md#footnotes-workspace-panes)
separate the working isolated candidate from the main tree's four outstanding
Backlinks compilation errors.

**Templates** uses a configured template folder and date/time formats. Its
picker inserts at the editor selection and expands `{{title}}`, `{{date}}`,
`{{time}}`, and explicit Moment formats such as `{{date:YYYY-MM-DD}}`.
**Daily notes** creates or reopens today's note using the configured format,
folder and template; previous/next commands navigate existing dated notes.
**Unique note creator** uses a configurable prefix, folder and template,
advances date prefixes on collisions, and refuses a format that cannot produce
an unused name instead of overwriting an existing note. **Random note** opens
Markdown notes only and reports an empty vault.

The Command palette settings support adding, removing and reordering pinned
commands. Unavailable editor/conditional commands are excluded from the palette,
including pinned commands that are unavailable in the current context.

**Outline** uses parsed ATX and Setext headings, with nested sections,
individual/all folding and active-heading updates from Source selection or
Reading scroll. **Word count** excludes whole-note frontmatter, counts a
nonempty Source selection verbatim and reports UTF-16 characters. The exercised
script/numeric/punctuation rules, edits/undo/redo and lifecycle work on both
hosts. Richer Outline controls/core views and exhaustive legacy Unicode/native
equivalence remain; see the [feature inventory](Docs/Features/CORE-PLUGINS.md).

**Bookmarks** reads and organizes existing `bookmarks.json` data, including
groups, ordering and supported file/folder/heading/block/search/graph targets.
It captures the actual current Graph/Search view, supports native modified
search fragments and reveals folders in real Files panes. Independent group
folds/tree keys persist across restart/reconnection; graph presets keep their
options per leaf instead of overwriting global settings.
[Controls, preservation and limits](Docs/Features/BOOKMARKS.md).
**Workspaces** saves, loads, renames and deletes named layouts independently of
automatic layout persistence; profiles use guarded
`.obsidian\vault-dotnet-workspaces.json`. **Manage workspaces > Import Obsidian
workspace** reviews and copies existing named profiles; **Export to Obsidian**
explicitly writes a saved layout back while preserving other profiles and opaque
data. [Usage and limits](Docs/Features/WORKSPACES.md). When no independent layout
exists, supported panes import automatically from `workspace.json`. The command
palette's **Import Obsidian active workspace** supports confirmed retry or
replacement while retaining original bytes. **Properties** has actual typed field controls and a searchable vault
catalog, type assignments and guarded cross-note property renames. Supported
YAML edits preserve the note body, BOM/CRLF and untouched data; unsupported or
conflicting edits are rejected, not silently coerced. When Properties is
enabled, Live Preview and Reading also show inline property rows and
Add/edit/remove controls using the same guarded dialogs. Actual Dataview
observes saved changes; raw Source hides that panel.

**Graph** is an independent interactive global/local SVG and worker view with
filters, grouping, navigation, controls and live metadata updates. **Canvas**
edits actual `.canvas` documents with cards/groups/edges, pan/zoom,
selection/move/resize/connections, undo/redo and versioned saves while retaining
unknown JSON fields. These are real independent subsets, not the original
physics/renderer/private APIs. Graph is bounded to 10,000 nodes/100,000 links;
Canvas to 5,000 cards/20,000 edges, bounded integer geometry and 100 undo states.
Canvas settings/native gesture equivalence is incomplete. Desktop website cards
open externally; browser iframe previews are explicitly enabled and sandboxed,
with real external-page loading still unaccepted.

**Page preview** renders Markdown note/heading/block hover targets, local images
and dirty/external updates without hidden workspace leaves. Settings control
per-source Mod behavior; real CommonJS source registration and public
HoverPopover ownership have passed on both hosts. Custom/binary preview views
and exact native private/enum/visual behavior remain unsupported/unestablished.

**Slash commands** provides an actual CodeMirror command picker for slash queries
outside code/frontmatter, with keyboard/pointer execution and isolated query
undo. **Slides** presents Markdown sections with real navigation and local
images/links without replacing the source editor. Both have shared desktop and
real-folder browser acceptance; neither supplies native private APIs or the
complete Obsidian renderer.

**Format converter** previews seven opt-in legacy Roam/Bear/Zettelkasten and
frontmatter conversions before a separately confirmed rewrite. Apply and the
dialog's Undo use guarded batches of at most 256 changed notes, preserve
supported YAML precision/BOM/CRLF, and refuse unsaved or externally changed
notes and ambiguous numeric IDs. Matching code/comments are raw-text conversion
targets too; the dialog warns about this. Native sequential/bulk-undo behavior
and original `newLinkFormat` preferences are not implemented.

**Outgoing links** opens from its right-sidebar tab or **Show outgoing links** in
the command palette. It lists wiki/Markdown/property links and embeds, groups
duplicate destination/subpath pairs, navigates to headings and blocks, and
creates missing Markdown notes. Changes to unsaved buffers, undo/redo, external
files and renamed targets update the list. The pin button keeps the view on one
note; releasing it follows the active note. **Unlinked mentions** finds note
names and aliases outside code/comments/existing links and navigates to their
source text. Pin/collapse state is stored with this application's workspace.
Like the reference module, it has no separate settings page.

This is an independent feature subset, not an extracted original core module.
The complete attachment-viewer set, native grouped/main-pane outgoing views and one-click linking
of unlinked mentions are not supplied. Separate guarded FileManager operations
now rewrite supported Markdown/property/Canvas references on file rename/move;
external OS renames do not automatically repair the vault.
Bare missing links create notes at the vault root; explicit relative paths stay
relative to their source. Existing `app.json` new-note-location preferences are
not imported yet. Unsupported attachment/path actions are visibly disabled
rather than creating an unexpected Markdown file. Use an explicit `.md`
extension when creating a new note whose name contains dots.

These features use the existing `.obsidian\core-plugins.json`, `templates.json`,
`daily-notes.json`, `zk-prefixer.json` and `command-palette.json` formats.
Unknown fields are preserved. Legacy core enablement arrays are read without
rewriting them; an intentional toggle migrates their state. Supported note
settings are isolated between vaults. This is not yet complete core parity:
for example, Quick switcher settings/attachments, advanced Outline behavior
and exhaustive Unicode counting equivalence remain incomplete. General core settings
patches preserve unknown data, but do not yet use the root/version-token contract
of Bookmarks, Graph, property types and named-layout documents.

The file explorer's actual action prompts and public FileManager support
empty-folder creation, file rename/move and vault trash with supported reference
updates, open-view remapping and visible collision/conflict failures. Desktop
moves arbitrary file bytes; browser moves use guarded copy/delete/rollback.
Folder rename/trash, OS recycle bin, general binary adapters and cross-file
crash-durable transactions remain unfinished.

## Reading and editing

Open a Markdown note and click the **book button** in its pane header to enter
**Reading view**. The button changes to a pencil to return to editing.
**Ctrl+E**, **Pane options > Toggle reading view**, and the command palette's
**Toggle reading view** command do the same thing in both desktop and WASM.

Reading view renders headings, emphasis, strikethrough, lists, read-only task
checkboxes, blockquotes, tables, and inline/fenced code. Markdown links, heading
anchors, wiki links and aliases navigate vault notes. Markdown and wiki-image
syntax display local PNG, JPEG, GIF, WebP and AVIF attachments directly from the
selected vault. Frontmatter is hidden. Note HTML is sanitized, and remote
images are not fetched automatically.

The rendered text includes unsaved edits without saving or clearing undo/redo.
Split panes can show the same shared document in different modes; source edits
and clean external Markdown changes update its reading panes. Each pane's mode
survives a workspace reload. This Reading renderer is separate from the
in-place Live Preview editor described above. Ordered asynchronous plugin
Markdown postprocessors receive real source/frontmatter/section context and
owned `MarkdownRenderChild` lifecycle. General SVG, note/document embeds, math,
Reading code highlighting and full renderer/private compatibility remain
incomplete. Static `MarkdownRenderer.render`/`renderMarkdown` append owned
fragments, and real plugin/factory code-block processors run in Reading/static
output with asynchronous cleanup and preserved source. Custom-code Live Preview
widgets are not implemented. See the
[renderer API boundary](Docs/Compatibility/PLUGIN-API.md#static-markdown-and-code-block-ownership).
Detached replacement construction now supports unchanged Admonition 12.0.11
fenced Reading/static blocks and waits for pending child teardown on disposal.
Its custom colors/icons now paint in fenced and native callouts, using both
legacy RGB components and complete CSS colors. The pinned Lucide catalog and
license are local assets. [Verified scope and limits](Docs/Engineering/CALLOUT-ICONS-2026-10-27.md)
retain full theme/native equivalence as separate work.

Fenced **Mermaid** blocks render locally as scalable diagrams in Reading view,
Page preview and Slides on desktop and WASM. Syntax errors retain the original
code. Unsaved/shared edits refresh diagrams without rewriting note bytes, and
the engine is bundled for offline use. Supported title/theme/look/layout options
and limits are described in [Mermaid support](Docs/Features/MERMAID.md).

## Desktop workspace

The independently styled dark shell includes a hierarchical file tree, tab
groups, nested right/down splits, pinned tabs, back/forward navigation,
collapsible/resizable sidebars, a basic heading outline, a command palette,
a fuzzy quick switcher, and a native Windows caption-button overlay.

| Shortcut | Action |
|---|---|
| Ctrl+N | Create a Markdown note |
| Ctrl+O | Find a note with the quick switcher |
| Ctrl+Enter in the switcher | Open the selected note in a new tab |
| Shift+Enter in the switcher | Create/open the typed Markdown note |
| Ctrl+P | Search built-in and enabled-plugin commands |
| Ctrl+T / Ctrl+W | Create / close a tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab in the active group |
| Ctrl+Backslash | Split right |
| Alt+Left / Alt+Right | Back / forward in the current tab |
| Ctrl+E | Toggle source / Reading view |
| Ctrl+S | Save all open notes |
| Ctrl+Comma | Settings |

Use **Pane options** or the command palette for **Split down**, **Toggle pin**,
and other pane actions. The right sidebar's metadata-backed outline handles
ATX (`#`) and Setext headings, hierarchy/folding and active Source/Reading
navigation. Richer native controls, generic core views and complete metadata
equivalence remain unfinished.

Tab/split arrangements, source/reading modes, selected tabs, pins, sidebar visibility and widths,
plugin-owned main/sidedock trees and JSON view state persist per vault in
`.obsidian\vault-dotnet-workspace.json`. The most recent main pane and file context
also survive a restart with a sidebar pane active. Obsidian's own
`workspace.json` supplies supported first-open panes and is left untouched.
Native cursor/scroll/navigation-history equivalence remains unestablished. An
unreadable layout is reported rather than silently replaced; **Reset workspace
layout** in the command palette saves notes and explicitly replaces this
application's layout.

[Files workspace panes](Docs/Features/FILE-EXPLORER.md) restore imported main/sidebar Files leaves and offer **Open Files in a tab**, independent sort/filter/folds, guarded navigation and read-only GitHub browsing. Configured Iconize 2.14.7 file/folder emoji run on real retained item elements; complete private tree and other core-view migrations remain separate.

[Search workspace panes](Docs/Features/DISCOVERY.md#search-workspace-panes) restore imported Search leaves and offer **Open Search in a tab**, independent queries/display state and exact source navigation. Queries use owned workers and include live unsaved text; cached GitHub searches cover indexed notes.

[Outline workspace panes](Docs/Features/OUTLINE.md) restore imported Outline leaves and offer **Open Outline in a tab**, independent note following/fixing, heading filters/folds and exact Source/Reading navigation. Old reads and stale heading clicks cannot update a replacement pane or select obsolete text.

[Bookmarks](Docs/Features/BOOKMARKS.md) offers **Open Bookmarks in a tab**,
independent filters/folds, arrow/Home/End navigation, bookmark F2 editing and
reviewed Delete. Header actions remain available in narrow sidebars. Its
[desktop/WASM acceptance](Docs/Engineering/BOOKMARKS-WORKFLOWS-2026-10-28.md)
uses an isolated accepted baseline; the separately owned current-worktree
Backlinks compilation errors remain outside that result.

Plugins can register real shared `View`, `ItemView`, `FileView` and `TextFileView` implementations
and file extensions. Their panes have their own DOM and lifecycle, not hidden
Markdown editors. Disabling a provider retains its saved panes as explicitly
unavailable; enabling it again restores fresh views with their state. Because
community enablement is session-only, saved plugin panes require explicit
re-enablement after an application reload.

Custom TextFileViews have actual buffers, saves/reloads, BOM/CRLF preservation,
clean-peer refresh and visible dirty/version conflicts. Unlike Markdown peers,
they do not share one CodeMirror document session.

This is a foundation, not full view compatibility: broader editable/lifecycle
contracts, binary/adapter APIs, drag docking, popouts and private native contracts
remain unfinished. The existing core sidebars have not yet been migrated into these
generic workspace leaves.

[Rearrange workspace tabs](Docs/Features/TAB-MOVEMENT.md) by dragging along a tab
strip or into another existing main pane. Tab context menus, Pane options and
the command palette expose movement actions; Ctrl+Shift+PageUp/PageDown reorder
the active tab. Overflowing strips scroll by wheel and while dragging at an
edge. Existing dirty editors, undo, pins, navigation and plugin views remain
with the tab, and saved positions survive restart/reconnection. Focused checks
use `npm run smoke:tabs` and `npm run smoke:tabs:web` after building each host.

The legacy `vault-dotnet` workspace and browser-storage identifiers are retained
deliberately, so upgrading to the Slopsidian name does not discard existing
layouts or recent browser vault connections.

## Architecture

| Location | Responsibility |
|---|---|
| `src\RonSijm.Slopsidian\Services` | C# vault inventory, UTF-8 file I/O, atomic replacement, conflict detection, core/plugin configuration and validated workspace storage |
| `src\RonSijm.Slopsidian\Components` | Shared Razor UI, hosted with Interactive Server Blazor on desktop |
| `src\RonSijm.Slopsidian.Web` | Standalone Blazor WebAssembly host; no ASP.NET/Electron dependency |
| `client` | CodeMirror editor and JavaScript compatibility facade |
| `client\browser-host.ts`, `browser-vault.ts` | Permissioned browser directory handles, local storage transport, recent handles and metadata polling |
| `client\workspace.ts` | Real tab/split/leaf objects, shared document sessions, layout restoration and editor-extension lifecycle |
| `client\views.ts` | Shared View/ItemView/FileView/TextFileView lifecycle, real custom text buffers and isolated pane DOM |
| `client\reading.ts` | Sanitized Markdown rendering, vault links, local raster images and reading-mode navigation |
| `client\desktop-ui.ts` | Command palette, quick switcher, Windows shortcuts, sidebar resizing and outline |
| `client\core-plugins.ts`, `core-notes.ts`, `core-settings.ts` | Per-vault core lifecycle, note workflows and settings UI |
| `client\outgoing-links.ts` | Live outgoing targets, missing-note creation, unlinked mentions and per-note sidebar state |
| `client\discovery-views.ts` | Worker Search, Tags' actual Search dependency, Backlinks/in-document references and Footnotes |
| `client\tags-pane-view.ts`, `tags-pane-model.ts`, `footnotes-pane-view.ts`, `footnotes-pane-model.ts` | Real imported Tags/Footnotes workspace providers, independent state, guarded Search/Source navigation and owned metadata/preview lifecycles |
| `client\configuration.ts`, `bookmarks.ts`, `named-workspaces.ts`, `workspace-import.ts` | Versioned configuration, organized bookmarks, named profiles and guarded original-profile conversion/import/export |
| `client\file-manager.ts`, `properties.ts`, `property-types.ts` | Guarded shared file/reference/frontmatter operations and typed property controls |
| `client\graph.ts`, `graph-model.ts`, `graph-worker.ts`, `canvas.ts`, `canvas-model.ts` | Independent interactive graph and JSON Canvas implementations |
| `client\hover.ts`, `page-preview.ts`, `slash-commands.ts`, `slides.ts` | Owned hover sources/Markdown previews and editor/presentation tools |
| `shared\core-plugins.json` | Version-pinned 31-module catalog and unchanged 140-case acceptance contract, also embedded in the C# application |
| `desktop\main.cjs` | Electron window and owned local .NET process |
| `vendor\obsidian-sample-plugin` | Unmodified, pinned public sample source and its 0BSD license |
| `plugins\editor-probe` | Independent fixture exercising editor extensions, vault events, Node access and public WorkspaceLeaf tab creation |
| `.runtime\DemoVault` | Generated demo vault; its welcome note is not overwritten by subsequent builds |

The desktop C# host binds only to an ephemeral loopback port and requires a per-launch
token supplied by Electron. Blazor runs locally; no remote server or account is
required. The editor and plugin-owned DOM remain JavaScript so plugins can use
real shared CodeMirror objects and DOM elements.

Electron and the editor are separately supplied dependencies. The sample's
source hashes and upstream commit are checked on every build against
`vendor\sample-plugin.provenance.json`.

## Shared dialog keyboard access

[Shared Modal keyboard accessibility](Docs/Features/MODAL-ACCESSIBILITY.md) keeps
Tab/Shift+Tab in the top dialog, handles current control availability, restores
nested/opener focus and names dialogs from their visible titles. Scope/widget
keys, menus and suggestions retain their existing handling. Both desktop and
standalone WASM pass real keyboard workflows, all 511 regressions and existing
Menu/suggestion integration suites. Run npm run smoke:modal-focus or
npm run smoke:modal-focus:web after the corresponding build. Complete
screen-reader/OS/native-dialog and application-wide accessibility remain open.

Shared dialogs also [fit narrow or short renderer viewports](Docs/Features/MODAL-LAYOUT.md),
wrap long titles and scroll oversized content without losing drafts during
resizing. Real desktop/WASM checks cover ordinary, confirmation and nested
dialogs; existing keyboard, Note composer/Menu and suggestion suites pass.
Run npm run smoke:modal-layout or npm run smoke:modal-layout:web after the
corresponding build. Physical OS/display/browser zoom and whole-app reflow
remain separate.

## Compatibility boundary

| Implemented subset | Current scope |
|---|---|
| Plugin lifecycle | Registration/unload cleanup, load-failure rollback |
| Commands | Normal, conditional, and editor callbacks |
| Plugin UI | Ribbon/status elements, notices, modals, settings tabs, text/search/toggle/select/button controls and registered icons |
| Suggestions / keys | Real modal/fuzzy/input/editor suggestions, fuzzy match ranges and owned Scope key dispatch; not full native ranking/private Keymap parity |
| Plugin settings | `loadData` / `saveData` in the existing plugin folder |
| Vault | File/folder objects, enumeration, text reads, create/modify, create/modify events |
| Editor | Real atomic batches, post-edit/primary/multiple selections and Source fold snapshots, plus text/cursor operations, independent modes and shared CodeMirror 6 extensions; not full native position/history/private ABI |
| Plugin Markdown | Ordered async/static rendering and custom fenced-code handlers, real context/local resources and owned render children; genuine classic tokenizer bridge, not full renderer instance/private ABI or custom-code Live Preview widgets |
| In-app CLI | Actual registered command/flag handlers used by unchanged Templater; not an OS command-line transport |
| Workspace | Real Markdown/custom leaves, main/sidedock tab groups, activation/close/pin, JSON view state, layout/events and collapsible sidebars |
| Plugin-owned views | Shared View/ItemView/FileView/TextFileView, guarded editable text, owned registration, actual file hooks, rollback, unavailable-provider state and restoration |
| Core dependency lookup | `app.internalPlugins.plugins`, `getPluginById` / `getEnabledPluginById`: status/live options for supported modules and the Outgoing links controller; enabled lookup returns null for disabled/unimplemented modules |
| Desktop modules | Native Node built-ins and Electron renderer modules; explicitly unavailable in WASM |

This does not implement the full Obsidian API, undocumented internals, complete
native view/editor/renderer/metadata contracts, installed-theme loading, Sync,
Publish or broad community-plugin compatibility. Live Preview, Graph, Canvas
and the other implemented features retain the explicit subsets and remaining
gaps in the [feature inventory](Docs/FEATURE-PARITY.md).
Core features need both matching behavior and the interfaces used by dependent
plugins. The original bundled modules have a private `init`/`onEnable` host
contract, not the community `Plugin.onload` contract. The core lookup exposes
independent handles backed by the actual enabled features and their live
settings, not the original modules' complete private method surface.
Unimplemented catalog entries do not receive enabled-looking instances. The Outgoing
links per-note command pins the sidebar rather than creating the reference's grouped main-pane
view. No original core module is loaded by the independent application.

Inventory and metadata are refreshed using a native watcher on desktop and
polling in the browser. Only UTF-8 text editing is supported;
existing UTF-8 BOMs and a document's line-ending style are preserved. Hidden
files are excluded from normal note operations; plugin data has a dedicated
endpoint. The desktop filesystem service rejects symbolic links and junctions;
the browser host uses the browser's permissioned directory handles.

Desktop plugins are trusted code, **not sandboxed**. Enabling one grants native
Node/Electron privileges; C# path guards do not constrain direct Node file access.
Browser requests/navigation are limited to the local host, but trusted Node
code is not restricted by those browser controls. Unsupported plugin behavior
is reported rather than presented as complete compatibility.

## Remaining desktop parity

Appearance and behavioral equivalence must be demonstrated against the fixed
1.12.7 reference; they are not inferred from a familiar-looking shell or a
passing sample plugin. The public npm API declarations used by the development
fixtures are version 1.14.4 and do not supply the Obsidian application runtime.

| Area | Remaining work |
|---|---|
| Editing | Complete Live Preview/Markdown/embeds/math, rendering/suggestion APIs and native/private/IME/accessibility/scale behavior |
| Vault operations | Complete folder mutations, OS trash, binary adapters and broader refresh/event/concurrency behavior beyond the guarded shared file-management subset |
| Metadata and discovery | Finish discovery/search UI and reference-compatible YAML/properties, links/blocks/tags, backlinks and metadata events over the indexing/query foundation |
| Plugins and themes | Broader view/private APIs, additional controls/suggestions, hotkeys and installed themes/snippets; actual Templater then Excalidraw precede broad corpus testing |
| Workspace | Edge docking, sidebar rearrangement, popout windows, stacking, richer navigation state and missing core-view providers |
| Core features | Eight untested Publish/Sync cases with authorized-service dependencies in `shared\core-plugins.json`; broader original behavior and view/private APIs beyond the accepted module subsets |
| Windows delivery | Recent vaults, OS/deep-link integration, packaged installers/updates and release-level reliability |

## Core-plugin benchmark

**Bundled core plugins are the primary compatibility benchmark.** Community
plugins are not required for the default desktop run. The version-pinned
`shared\core-plugins.json` inventories all **31** modules registered by the
Windows 1.12.7 application, including Footnotes and the desktop-only Web viewer.
This fixed catalog is separate from the older migration list and the newer
public npm API declarations.

Every module requires enable/disable cleanup, compatible settings, full-process
restart persistence, and its listed feature workflows. A module without a
reference settings page must match that absence rather than gain an invented
page. Sync and Publish are not silently excluded: their authorized account and
hosted-service dependencies are recorded explicitly.

The historical combined-runtime snapshot reviewed **2026-10-22** passes **132 of 140 cases**, with
**29 of 31 modules** passing their fixed candidate contract. It includes
134 native workflow groups across 44 process sessions and 50 stable hashes,
144 complete actual-folder browser groups and a separate 23-group
community/workspace run with 51 stable hashes. That frozen tree passes
213 regression tests. Eight shared rendering/API
groups and fourteen actual unchanged Templater groups pass on each host in
their separate scopes, including real creation, processing, automatic/startup
rules and the preceding editor workflows. The preserved desktop Web history,
Reader, clipping and zoom implementation also passes 31 cumulative groups
across 11 process sessions and 48 hashes. Nine `combined-runtime-accepted-*`
reports plus a 211-input source manifest preserve matching acceptance for all
eight UI scopes. Later reported-plugin SDK changes make this combined epoch
historical too; the reported-plugin milestone has **227 passing tests**, with nine focused
Properties/view/editor/Templater/renderer scopes renewed. That is not a new
complete core/native/browser/Web viewer acceptance epoch.

The preceding [vault-transition fix](Docs/Features/VAULT-TRANSITIONS.md) passes
four shared transition groups on each host and renews **37 cumulative Web viewer
groups** across 13 sessions/**65 stable hashes**, with **251 passing unit/API
tests** and both builds/root static serving passing. The originally observed
obsolete-layout-save warning is gone. Earlier ad-blocking evidence retains that
warning; the Canvas teardown issue was separately open at that milestone and
is fixed by the later lifecycle work. Complete application/plugin/runtime
renewal remains separate.

The later [Reader font/width preferences](Docs/Features/WEB-READER.md#font-and-article-width)
add six desktop groups: **43 cumulative Web viewer groups**, **15 processes**
and **66 stable hashes** pass together. The full regression passes **257 tests**;
both builds and root static serving pass. Full application/browser UI/plugin
integration and original-runtime equivalence remain separate.

The later [Reader reading-progress scope](Docs/Features/WEB-READER.md#reading-progress)
passes **49 cumulative Web viewer groups/17 processes/69 hashes**, all **266
unit/API tests**, both builds and root static serving. Fractional progress
restores independently per pane and vault; semantic reading anchors, a history
of positions per URL and wider integration remain separate.

The later [history visit-menu scope](Docs/Features/WEB-VIEWER.md#visit-context-menu)
passes **55 cumulative Web viewer groups/19 processes/72 hashes**, all **271
unit/API tests**, both builds and root static serving. Actual menu controls,
pinned panes, native overlay/focus protection, external conflicts, restarts and
same-ID vault isolation pass. Wider history actions/private APIs and full
application/plugin/browser integration remain separate.

The preceding [lifecycle/leaf-App renewal](Docs/Engineering/EVIDENCE.md#lifecycle-and-leaf-app-renewal)
passes **134 native checks/44 processes/54 hashes**, **150 actual-folder WASM
checks**, and fresh strict aggregation at **132/140 cases, 29/31 modules**.
All **271 regressions** and root static serving pass. Twelve of thirteen
required runtime scopes pass; the separate native community run still hits a
file-lock read or post-reload Settings timeout, so the wider renewal is
explicitly incomplete. The 249-input source chain and integrity report retain
those failures, the two exact-release settings failures and earlier milestones
without promoting them into current acceptance. These changes are local,
not deployed.

The later [Copy link address scope](Docs/Features/WEB-VIEWER.md#copy-link-address)
passes **57 cumulative Web viewer groups/19 processes/76 hashes**, all **274
regressions**, both builds and root static serving. Mouse/keyboard copying,
pinned tabs, error/retry and lifecycle guards use a bounded clipboard fixture;
system clipboard/native permission behavior remains unaccepted. Earlier
integration reports and their incomplete scopes retain their identities.

The later [ordered-list clipping scope](Docs/Features/WEB-CLIPPING.md#ordered-list-numbering)
passes **61 cumulative Web viewer groups/21 processes/78 hashes**, all **280
regressions**, both builds and root static serving. Actual extraction/Reader,
preview, exact saving/Reading, unsupported-numbering refusal and restart/vault
preservation pass. Earlier milestones and incomplete integration scopes retain
their own identities.

The earlier [merged-table clipping scope](Docs/Features/WEB-CLIPPING.md#merged-cell-tables)
passes **65 cumulative Web viewer groups/23 processes/79 hashes**, all **287
regressions**, both builds and root static serving. Actual expanded table
previews, exact saved Markdown/Reading, bounded refusal and restart/vault
preservation pass. Original merged styling/header semantics and earlier
incomplete integration remain separate.

The earlier [selected-text clipping scope](Docs/Features/WEB-CLIPPING.md#selected-text)
passes **69 cumulative Web viewer groups/25 processes/80 hashes**, all **294
regressions**, both builds and root static serving. Actual pointer selection,
isolated literal previews, exact saving/Reading, bounded refusal and restart/
vault preservation pass. Richer selection and earlier incomplete integration
epochs retain their separate identities.

The latest [title/address history sorting](Docs/Features/WEB-VIEWER.md#title-and-address-order) renewal passes
**165 cumulative Web viewer groups/73 sessions/150 hashes**, all **502 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual six-choice Order, matching rows/archives/Reading/selected tabs,
queued round-trip refusal, independent panes and full restart/repeated-vault
isolation. Results bind the recorded 490-source isolated snapshot with
17 contributor inputs and five reviewed captures. Locale/natural ranking,
other sort keys, original private/runtime parity and broader integration
remain separate.

The earlier [selected-history tab opening](Docs/Features/WEB-VIEWER.md#open-selected-visits) renewal passes
**161 cumulative Web viewer groups/71 sessions/148 hashes**, all **494 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual review/selection/order/new tabs, limits/version/queued/partial
refusal, paused/inverse and ordinary recording behavior, full enabled/disabled
restart and repeated-vault isolation. Results bind the recorded isolated
snapshot; 17 contributor inputs and later shared differences are retained.
Tab-open acknowledgement does not establish remote-page loading; persistent/
background batches, original private/runtime parity and broader integration
remain separate.

The earlier [full-page Markdown clipping](Docs/Features/WEB-CLIPPING.md#full-page-markdown) renewal passes
**157 cumulative Web viewer groups/69 sessions/144 hashes**, all **484 unit/API
tests**, native/root-base WASM builds and static serving. Four new groups
cover actual Save page/command, original-document capture from Reader,
short/unsupported pages, exact reviewed properties/save/Reading, collision
and navigation refusal, full enabled/disabled restart and repeated-vault
isolation. Results bind the recorded isolated source snapshot; 17 contributor
inputs and later shared differences remain retained. Unloaded/shadow/frame/
media/visual capture and broader incomplete integration remain separate.

The earlier [per-site zoom](Docs/Features/WEB-ZOOM.md#site-preferences) renewal passes
**153 cumulative Web viewer groups/67 sessions/139 hashes**, all
**476 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover actual pointer/keyboard preference menus, native
pixel scaling and origin navigation, Forget/Clear, in-place hidden Reader
progress/Find/unchanged clipping and full enabled/disabled restart/repeated
same-origin vault isolation. Results bind the recorded isolated source
snapshot; 17 contributor inputs are captured and later shared changes are
retained. Native gestures, original private/runtime equivalence and broader
incomplete integration remain separate.

The earlier [history favicon](Docs/Features/WEB-VIEWER.md#site-icons) renewal passes
**149 cumulative Web viewer groups/65 sessions/133 hashes**, all
**466 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover actual recorded PNG/JPEG/Windows ICO visits and
decoded history images, Clear icons, unchanged selection/menu/review/
inverse/archive behavior, failed/stale captures and full enabled/disabled
restart/repeated-vault isolation. Results bind the recorded isolated source
snapshot; 17 contributor inputs are captured and later shared changes are
retained. Additional icon formats, original import/private APIs, persistent
recovery and broader incomplete integration remain separate.

The earlier [custom history visit-limit](Docs/Features/WEB-VIEWER.md#visit-limit)
renewal passes **145 cumulative Web viewer groups/63 sessions/125 hashes**,
all **457 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover the real numeric review/keyboard controls, native
count/age trimming, inverse/archive/Reading compatibility, version/queued
guards and full enabled/disabled restart/repeated-vault isolation. Results
bind the recorded isolated source snapshot; 17 contributor inputs are
captured and later shared edits are retained. Import, persistent recovery/
private APIs and broader incomplete integration remain separate.

The earlier [automatic history age retention](Docs/Features/WEB-VIEWER.md#automatic-age-retention)
renewal passes **141 cumulative Web viewer groups/61 sessions/121 hashes**,
all **448 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups cover real policy controls and native visits, paused/duplicate
behavior, version/queued guards, inverse actions, exact archives/Reading and
full enabled/disabled restart/repeated-vault isolation. Results bind the
recorded isolated source snapshot; 16 contributor inputs are preserved.
Import, persistent recovery/private APIs and wider integration remain separate.

The earlier [chronological history ordering](Docs/Features/WEB-VIEWER.md#history-order)
renewal passes **137 cumulative Web viewer groups/59 full sessions/118 hashes**,
all **440 unit/API tests**, native/root-base WASM builds and static serving.
The acceptance receipt identifies the isolated source snapshot used for these
checks; its generated outputs are independent of concurrent shared builds.
Four new groups exercise real sort controls/ties, independent saved pane
state, matching shown/selected archive order and Reading, inverse-checkpoint
preservation, queued sort-change refusal and full enabled/disabled restart/
repeated-vault isolation. Fifteen contributor inputs are bound at snapshot
capture; unrelated shared edits are retained.
Import, retention, persistent recovery/private APIs and earlier incomplete
integration remain separate.

The earlier [selected-history Markdown archive](Docs/Features/WEB-VIEWER.md#save-selected-history-to-a-note)
renewal passes **133 cumulative Web viewer groups/57 full sessions/115 hashes**,
all **399 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise exact checked-ID previews and note creation/Reading,
separate shown/selected scope, literal hostile titles, collision/source-version
refusal, queued selection changes, inverse-checkpoint preservation and full
enabled/disabled restart/repeated-vault isolation. Fifteen shared/contributor
inputs remain unchanged. Import, automatic retention, persistent recovery/
private APIs and earlier incomplete integration remain separate.

The earlier [history Markdown archive](Docs/Features/WEB-VIEWER.md#save-shown-history-to-a-note)
renewal passes **129 cumulative Web viewer groups/55 full sessions/113 hashes**,
all **392 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise filtered previews, exact new-note saving/Reading,
literal hostile titles, collisions, source-version/queued-owner refusal,
Undo/Redo preservation and full enabled/disabled restart/repeated-vault
isolation. Fifteen shared/contributor inputs remain unchanged. This readable
snapshot leaves history intact; import, automatic retention, persistent
recovery/private APIs and earlier incomplete integration remain separate.

The earlier [one-step history redo](Docs/Features/WEB-VIEWER.md#redo-a-history-removal)
renewal passes **125 cumulative Web viewer groups/53 full sessions/109 hashes**,
all **383 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise reviewed reapplication of every removal path, fresh
inverse Undo, Cancel/Escape, exact-version conflicts, real visit/preference
invalidation, shared panes, queued owners and full enabled/disabled restart/
repeated-vault expiry. Fifteen shared/contributor inputs remain unchanged.
Undo/Redo alternates one transient checkpoint; multi-step stacks, persistent
archive, original private APIs and earlier incomplete integration remain separate.

The earlier [one-step history undo](Docs/Features/WEB-VIEWER.md#undo-a-history-removal)
renewal passes **121 cumulative Web viewer groups/51 full sessions/107 hashes**,
all **376 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise every removal path, exact-version restoration, real
visit/preference invalidation, conflicts, shared panes, queued owners and full
enabled/disabled restart/repeated vault isolation. Fifteen shared/contributor
inputs remain unchanged. Undo is one transient checkpoint/accepted attempt;
archive/multi-step undo/redo/private APIs and earlier incomplete integration
remain separate.

The earlier [history checkbox selection](Docs/Features/WEB-VIEWER.md#select-and-remove-visits)
renewal passes **117 cumulative Web viewer groups/49 full sessions/105 hashes**,
all **369 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise native pointer/Space selection, exact-ID review/
removal, repeated URLs, stale-file refusal, split panes, queued edits and full
enabled/disabled restart/repeated vault isolation. Fifteen shared/contributor
inputs remain unchanged. Selection is transient; undo/archive/favicons, original
private APIs and earlier incomplete integration remain separate.

The earlier [history date-range filters](Docs/Features/WEB-VIEWER.md#history-date-range-filters)
renewal passes **113 cumulative Web viewer groups/47 full sessions/103 hashes**,
all **363 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise local-day boundaries, combined search/date filtering,
date-only review/removal, conflicts, invalid imports, independent panes and
full enabled/disabled restart/repeated vault isolation. Fifteen shared/
contributor inputs remain unchanged. Date input values/events are driven;
the OS calendar popover, wider history/private APIs and earlier incomplete
integration retain their separate scope.

The earlier [matching-visit removal](Docs/Features/WEB-VIEWER.md#remove-matching-visits)
renewal passes **109 cumulative Web viewer groups/45 full sessions/100 hashes**,
all **356 unit/API tests**, native/root-base WASM builds and static serving.
Four new groups exercise literal query/count confirmation, retained visits,
external conflicts, queued cancellation, independent panes and full enabled/
disabled restart/repeated vault isolation. Fifteen shared/contributor inputs
remain unchanged. Wider history actions/private APIs and earlier incomplete
integration retain their separate scope.

The earlier [Reader per-article progress scope](Docs/Features/WEB-READER.md#per-article-progress-history)
passes **105 cumulative Web viewer groups/43 full sessions/98 hashes**, all
**350 unit/API tests**, native/root-base WASM builds and static serving. Four
new groups cover actual Go/Back/Forward/Reload, query/fragment isolation,
21-article eviction, independent panes, guarded state import, zoom/unchanged
clipping and full restart/repeated same-URL vault isolation. Fifteen shared/
contributor inputs remain unchanged; semantic anchors, native navigation-stack
restoration, private APIs and earlier incomplete integration remain separate.

The earlier [Reader custom-font scope](Docs/Features/WEB-READER.md#custom-font-family)
passes **101 cumulative Web viewer groups/41 full sessions/96 hashes**, all
**344 unit/API tests**, native/root-base WASM builds and static serving. Four
new groups cover real conditional Settings and glyph geometry, visible/hidden/
pending Readers, independent progress, preset/unavailable-family round trips,
Find/zoom/unchanged clipping and full restart/same-URL vault isolation.
Fifteen shared/contributor inputs remain unchanged. Font files, remote fonts,
semantic anchors, private APIs and earlier incomplete integration remain separate.

The earlier [Reader custom-width scope](Docs/Features/WEB-READER.md#custom-article-width)
passes **97 cumulative Web viewer groups/39 sessions/94 hashes**, all **338
unit/API tests**, native/root-base WASM builds and static serving. Four new
groups cover actual conditional Settings and measured article geometry,
preset round trips, visible/hidden/pending Readers, independent progress,
Find/zoom/unchanged clipping and full restart/same-URL vault isolation.
Fifteen shared/contributor inputs remain unchanged; custom fonts, semantic
anchors, private APIs and earlier incomplete integration remain separate.

The earlier [Reader letter-spacing scope](Docs/Features/WEB-READER.md#letter-spacing)
passes **93 cumulative Web viewer groups/37 sessions/92 hashes**, all **332
unit/API tests**, both builds and root static serving. Four new groups cover
actual bounded Settings and character geometry, visible/hidden/pending Readers,
independent progress, Find/zoom/unchanged clipping and full restart/same-URL
vault isolation. Fifteen shared/contributor inputs remain unchanged; finer
width/custom fonts/private APIs and wider incomplete integration remain separate.

The earlier [Reader paragraph-spacing scope](Docs/Features/WEB-READER.md#paragraph-spacing)
passes **89 cumulative Web viewer groups/35 sessions/90 hashes**, all **326
regressions**, both builds and root static serving. Actual bounded Settings,
live margins, hidden/pending Readers, independent progress, Find/zoom/unchanged
clipping and full restart/same-URL vault isolation pass. A demonstrated hidden
article progress reset is fixed with retained failures. Fifteen shared/
contributor inputs remain unchanged; private APIs and wider incomplete
integration remain separate.

The earlier [Reader-selection scope](Docs/Features/WEB-CLIPPING.md#reader-selection)
passes **85 cumulative Web viewer groups/33 sessions/88 hashes**, all **320
regressions**, both builds and root static serving. Actual pointer/command
capture, exact literal saves/properties/Reading, bounded refusal, frame/collision
guards, Find/zoom and full restart/vault isolation pass. Fifteen shared/
contributor inputs remain unchanged; rich selected formatting/private APIs
and prior incomplete integration remain separate.

The earlier [Reader typography scope](Docs/Features/WEB-READER.md#font-size-and-line-spacing)
passes **81 cumulative Web viewer groups/31 sessions/86 hashes**, all **313
regressions**, both builds and root static serving. Vault-local size/spacing
controls update open/hidden/pending Readers, preserve progress and retain
Find/zoom/clipping through full restarts/vault changes. Fifteen shared/contributor
sources remain unchanged; custom fonts/private APIs and prior incomplete
integration remain separate.

The earlier [clipping-defaults scope](Docs/Features/WEB-CLIPPING.md#property-defaults)
passes **77 cumulative Web viewer groups/29 sessions/84 hashes**, all **307
regressions**, both builds and root static serving. Vault-local enable/tag
defaults, reviewed per-clip overrides, exact article/selection saves, corrected
Settings alerts and restart/vault isolation pass. Fifteen shared/contributor
sources remain unchanged; templates/arbitrary fields and prior incomplete
integration remain separate.

The earlier [clipping-properties scope](Docs/Features/WEB-CLIPPING.md#note-properties)
passes **73 cumulative Web viewer groups/27 processes/81 hashes**, all **301
regressions**, both builds and root static serving. Exact reviewed frontmatter/
body saving, actual metadata/Properties/Reading, correction/collision guards and
restart/vault preservation pass. Templates/arbitrary schemas/persistent defaults
and earlier incomplete integration epochs remain separate.

The
[core inventory](Docs/Features/CORE-PLUGINS.md) and
[evidence page](Docs/Engineering/EVIDENCE.md) record exact scope, retained
milestone reports and the freshness required after later source/build changes.
The earlier 130/140, 126/140 and 60/140 results remain historical baselines.

**Eight requirements remain `not-tested`**: four each for Publish and Sync,
so the benchmark intentionally exits nonzero. The fixed
31-module/140-case denominator has not been reduced. A passing candidate
scenario **does not** make its whole module
compatible. Candidate behavior has not yet been compared against the original
runtime; the reference inventory does not establish behavioral or pixel
parity. Actual Templater and separate Excalidraw 2.29.0 have bounded workflow
acceptance, not complete plugin compatibility; wider functionality and
original-runtime comparison remain.

## Development and evidence

Every smoke run now checks the [persistent error log](Docs/Features/ERROR-LOGS.md)
through final teardown. Unexpected red error notifications fail acceptance even
when their exceptions were caught or their bubbles have been cleared. Deliberate
negative tests account for their exact records within the tested action. Reports
retain an `errorLogAudit` and a separate `*-errors.jsonl` file.

Use **Download log** in an error banner, or find desktop logs under
`.runtime/profile/logs/`. The dedicated `smoke:diagnostics` and
`smoke:diagnostics:web` commands test logging, export and the writable DOM helper
that fixes plugins replacing `onWindowMigrated`.

```powershell
npm run build
npm test
npm run smoke
npm run smoke -- --launcher
npm run smoke -- --explicit-vault
npm run build:web -- --base=/
npm run verify:web -- --base=/
npm run smoke:web
npm run smoke:bases
npm run smoke:bases:web
npm run smoke:recovery
npm run smoke:recovery:web
npm run smoke:audio
npm run smoke:audio:web
npm run smoke:mermaid
npm run smoke:mermaid:web
npm run smoke:autosave
npm run smoke:autosave:web
npm run smoke:attachments
npm run smoke:attachments:web
npm run benchmark:core
node tools\core-benchmark.mjs --report-only
npm start
```

The focused API tests exercise real C# persistence, workspace validation,
host-restart restoration, core enablement/legacy migration, settings/pinned
command persistence and error paths. Test files run sequentially to bound the
memory used by their independent native hosts. Benchmark regression tests reject
unknown/duplicate observations and prevent a partial result or community-plugin
result from being presented as complete core coverage.

Browser-storage unit tests cover direct byte/version behavior, failed writes,
configuration, root/permission guards and handle reconnects. `npm run smoke:web`
requires the published web site plus the development Electron runtime and
PowerShell 7 on Windows. Its disposable Chromium renderer has Node disabled,
context isolation and sandboxing enabled. It uses the real native folder picker
and real external files, not fake handles or an in-memory vault. The picker is
started in a process-local disposable Documents directory; automation touches
only its owned dialog and fixture.

That scenario exercises BOM/CRLF/Unicode saves, external line-ending changes,
nested note creation, plugin restrictions/settings, IndexedDB reconnect after
reload, layout/configuration preservation, stale-save conflicts, unsaved-reload
protection, picker cancellation, vault isolation and fresh creation. It also
checks missing assets and accidental HTTP API requests. Its report and screenshot
are `.runtime\evidence\web-smoke.json` and `web-smoke.png`; the report binds the
result to the published artifact hashes. This is local Chromium evidence, not
evidence of a live GitHub Pages deployment.

The default smoke runner does not exercise third-party community plugins.
It installs independent CommonJS fixtures for the suggestion/rendering API
scenarios; actual unchanged Templater has a separate acceptance scope. It uses
actual keyboard/pointer/editor input and Blazor controls to exercise no-argument
startup, fresh-vault creation, invalid/existing-folder rejection, cancellation
by button/Escape, dirty-buffer preservation and saving before switching vaults.
It then checks the independently implemented core workflows, editor modes,
discovery, organization, file operations, Canvas/Graph, rendering/media,
desktop Web viewer and shared plugin APIs, including enable/disable cleanup,
per-vault isolation and multiple complete enabled/disabled Electron/.NET
process restarts. Assertions include exact saved bytes, unknown
configuration preservation and layout restoration. `--launcher` additionally
runs the actual build-and-run CMD; `--explicit-vault` checks bypassing the
startup chooser instead.

`npm run verify:core` and `npm run verify:core:web` exercise the 27 requested
core modules with 123 named cases per host. The browser suite uses real local
folders and reload/reconnection; the desktop suite uses full process restarts.
Core settings describe each feature and show **Verified workflows** only when
the build's source and host match a completed verification catalogue. Missing
or stale evidence shows **Available**. This status is independent of enablement
and is narrower than complete Obsidian equivalence. The
[verification report](Docs/Engineering/CORE-VERIFICATION-2026-10-27.md) explains
the reference comparison, evidence checks and catalogue renewal. The focused
`verify:core-status` / `verify:core-status:web` commands test the resulting UI.

`npm run benchmark:core` runs that focused desktop scenario, then reports every
required module/case. It intentionally exits **1** while coverage is incomplete.
`--report-only` reuses the latest default smoke report only when its recorded
artifact hashes still match the current files; it does not rerun the desktop.
Add `--explicit-vault` to select the separate explicit-vault scenario/report.
Neither a candidate pass nor a visible familiar shell proves runtime or visual
equivalence to Obsidian.

Evidence is retained under `.runtime\evidence`: `core-smoke.json` and its log,
`core-plugin-benchmark.json`, `vault-chooser.png`, `core-workspace.png` and
`core-plugins.png`.
Explicit-vault runs have separate reports/screenshots. Reports identify the
fixture vault and hashes of the DLL, editor bundle, desktop host, stylesheet,
icons, runner and core contract. `core-registry-verification.json` records the
separate static inventory check against the fixed artifact.

The separate community-plugin/workspace suite is opt-in through
`npm run smoke:community`. Its `desktop-smoke.json` report is separate and is not
overwritten by successful core-foundation runs; it is not the current acceptance
benchmark.

Focused named-profile import/export acceptance uses `npm run smoke:workspaces`
and `npm run smoke:workspaces:web` after building the respective hosts. Four
shared groups pass on each host for actual review/import/load/export controls,
opaque data and exact note/BOM preservation, conflicts, lifecycle and full
restart/reconnect. Reports are `workspaces-smoke.json` and
`workspaces-web-smoke.json` under `.runtime\evidence`. Workspaces integration
regression passed 164 tests; fixed core-benchmark totals are unchanged.

Ten shared custom-view scenario groups run in that desktop suite and the
real-folder WASM suite. The independently authored CommonJS fixture exercises
main/left/right/split panes, controls, editor coexistence, rejected transitions,
file-hook failures, interrupted-disable rollback, cleanup and state restoration
across full desktop restarts or browser reload/reconnect. Original workspace and
binary file bytes remain unchanged. Screenshots are
`custom-views-desktop.png` and `custom-views-web.png` in `.runtime\evidence`.
This probe does not exercise actual Templater, Excalidraw or an original bundled
core module. The [evidence page](Docs/Engineering/EVIDENCE.md) records the
separate full-host, fixed-contract and actual-plugin results.
