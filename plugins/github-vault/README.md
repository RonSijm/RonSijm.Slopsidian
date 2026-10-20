# GitHub Vault

Read-only public GitHub notes with lazy file downloads and persistent IndexedDB
caching. The same `provider.ts` is used by this Obsidian plugin and by Slopsidian's
native GitHub vault integration. No Git executable, clone, token, or proxy is used.

## Build and install

From the Slopsidian repository root, run `npm run build:github-plugin`. Copy the
contents of `.runtime/github-vault-plugin/` into
`<local-vault>/.obsidian/plugins/github-vault/`, reload Obsidian or Slopsidian, and
enable **GitHub Vault** in Community plugins. Run **GitHub Vault: Open GitHub vault**
from the command palette. Nothing is fetched just by enabling the plugin.

Paste a public repository or `/tree/branch/folder` URL and press the mount button.
The Example is prefilled:

`https://github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example`

The inventory loads first. Notes and embedded attachments load when selected,
then their exact bytes are cached. **Use cached snapshot only** reopens an existing
inventory and refuses network access for uncached files. Browser storage may be
evicted; it is not a durable backup.

## Download a snapshot for offline use

In Slopsidian, open a GitHub vault, then choose **Offline vault** in the status
bar or **GitHub vault: Download for offline use** in the command palette. In
Obsidian's GitHub browsing pane, expand **Download vault for offline use**.
Opening these controls checks cached files without contacting GitHub. Choose
**Download all files** or **Resume download** to save the complete mounted
snapshot, with file/byte progress and up to four simultaneous reads.

**Cancel download**, closing the Slopsidian dialog or Obsidian view, switching vaults, or refreshing
the mounted snapshot stops the owned download. Verified cached files remain;
reopening the controls and resuming reuses them. A cancelled background read
does not interrupt another pane reading the same file. Network/quota failures
retain completed files and expose a retry through **Resume download**. Files
larger than 16 MiB prevent a complete offline download; mount a smaller folder.

Completion is checked against actual cached bytes and hashes, including after
a restart; an old success flag cannot hide missing or corrupt cache entries.
Download uses the mounted commit and does not rediscover a newer branch, open
notes, or populate the partial search index. Vault configuration and plugin
assets are included in the offline file count without executing scripts. Other
hidden directories stay excluded. To browse without GitHub requests, reopen through **Use cached
snapshot only** or the chooser's **Open cached** button. Ordinary browsing
continues to load files lazily until a download is explicitly started.

Offline availability covers GitHub file content. Slopsidian itself must already
be loaded or available from a local server; this feature does not install an
offline web-app shell. Browser storage can still be evicted or cleared.

## Host differences

- **Slopsidian desktop and WASM:** the plugin delegates to Slopsidian's explicit
  `app.githubVaults.open` extension. This mounts the source in the native file
  explorer and workspace. The vault chooser also exposes this feature without
  requiring a local vault or installing a plugin first.
- **Obsidian:** its public API cannot register an alternative vault backend.
  The plugin therefore opens a separate read-only GitHub browsing pane using
  public `ItemView`, command, ribbon, and data APIs. Remote notes are not inserted
  into Obsidian's native vault or its search/graph index. The plugin does not patch
  private vault internals or copy remote notes into the local vault.

The Obsidian pane renders sanitized Markdown independently of other plugins,
supports remote wiki/Markdown links and image/audio embeds, and never executes
remote code blocks or runs repository `.obsidian` plugins.

## Shared reader

- Two API requests discover an ordinary repository: resolve the ref to a commit,
  then read its recursive tree. Truncated trees use a bounded subtree fallback.
- Content comes from commit-pinned `raw.githubusercontent.com` URLs.
- Discovery and stat/list operations never read file bodies.
- Cache entries use Git blob hashes; exact bytes are verified before caching and
  when reusing a cached file. Simultaneous reads share one download.
- Public regular files and the root `.obsidian` directory are exposed separately;
  other hidden directories, symlinks and
  submodules are omitted. Individual reads are limited to 16 MiB.
- All GitHub requests are anonymous `GET`s with `credentials: omit` and normal
  CORS enforcement. Anonymous GitHub rate limits still apply.

## Slopsidian links and indexing

The WASM app accepts links such as:

`https://slopsidian.md/remote-vault/github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example`

The static publish already supplies a Pages `404.html` boot page for direct
navigation. The local preview server supplies the same app entry point for these
routes. The deployed site needs the new build before these links work there.

To open a specific file, append its encoded vault-relative path:

`https://slopsidian.md/remote-vault/github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example?file=30%20Projects%2FGarden`

This opens `30 Projects/Garden.md`; an explicit `.md` extension also works.
The requested file overrides the restored active note. File clicks, internal
note links and active file-tab changes update the URL without reloading the app.
Browser Back/Forward opens the corresponding notes in the existing mount.
Missing or invalid targets show an error without creating a file or fetching
outside the selected vault. URL navigation applies to Slopsidian's WASM host;
the native Obsidian browsing pane keeps its existing navigation.

Slopsidian starts with file references, without auto-opening the first note.
Previously opened panes may restore from local preferences. Search, tags, and
backlinks index only loaded Markdown; the status bar identifies this partial
index. Refresh is explicit and checks the latest branch tree, preserving cached
unchanged blobs. Cache-only mounts do not refresh online.

## Vault configuration and plugins in Slopsidian

Slopsidian reads the vault's `.obsidian` directory separately from its note
inventory. `app.json`, `core-plugins.json`, and supported core/configuration JSON
provide repository defaults. Plugin manifests are discovered when mounting;
`main.js`, optional `styles.css`, `data.json`, and other package files are loaded
when needed through the same commit-pinned, verified cache. `.obsidian` remains
outside the note tree and metadata index, and is readable through the adapter.

Installed packages must exist in the repository at
`.obsidian/plugins/<id>/manifest.json` and `main.js`. Enabled IDs come from
`.obsidian/community-plugins.json`. In WASM, configured plugins start
automatically with **Restricted mode off** by default. Desktop GitHub mounts
still start in Restricted mode. An explicit choice in **Settings → Community
plugins** overrides the default and persists locally for this vault, along with
individual enable/disable changes. Existing host compatibility restrictions still apply; browser-only
hosts cannot supply Node/Electron. Enabled plugins can request additional note
content for their own indexing.

Preference changes, including `Plugin.saveData`, go to a local IndexedDB overlay
seeded by the repository settings. They never update GitHub. Note mutations and
package installation into the remote repository stay blocked. Original
`workspace.json` layouts, themes and CSS snippet activation are not imported by
this feature. Native Obsidian's independent browsing pane does not execute a
remote vault's plugins inside the currently open local vault.

**Example repository:** this change includes the 24 installed packages (80
manifest/code/style/sample-data files), keeping the generated Git authentication
helper ignored. The previously published snapshot ignored all plugin packages;
push the updated Example before testing those packages through its public GitHub
link. Missing packages are reported rather than silently substituted. There is no automatic community
registry fallback. Browser checks can fetch GitHub release metadata, but direct
release assets and their API download redirects fail CORS in the tested browser.

Remote files are read-only at the transport and `Vault` API boundaries. Editor
transactions, note/folder creation, rename, deletion, binary writes, and plugin
installation into the remote source are refused. Personal layouts, bookmarks,
and settings are stored separately in local IndexedDB. Repository `.obsidian`
settings seed these local preferences; community plugin execution honors the
saved Restricted mode choice and the host-specific default.

Editing, recording, recovery, Canvas, and Bases modules are disabled for these
mounts. Markdown reading and existing supported attachment views/embeds remain
available. GitHub directories retain case-sensitive names in the file explorer.

## Validation

`npm run test:github` runs the shared-reader and storage-boundary regression tests.
`npm run build` and `npm run build:web` build the desktop and WASM applications;
the normal builds also produce the installable plugin directory.

The earlier 0.2.0 WASM Example test discovers 112 files, checks cache availability
without requests, cancels a partial download at 74 files, restores that count
after a full reload, and downloads only the remaining 38 files. All 112 files
are then verified cached; a previously unopened project note renders after
cache-only reopening with no additional GitHub requests. Downloading leaves
the partial metadata index unchanged. That run passed 22 focused cases and
583 existing regressions. Current configuration/plugin validation passes 31
GitHub cases and 587 default regressions, plus desktop/WASM builds. The actual
public Example imports 24 enabled IDs and reports their ignored packages missing.
`node tools/github-plugin-fixture.mjs` starts a separate loopback fixture using
the installed Example assets: 24 packages are discovered, only Calendar and
Dataview execute, and a 250→333 Calendar preference plus enablement survive reload
with zero raw downloads and 205 original file hashes preserved. Native
Obsidian UI and desktop offline controls were not exercised; SDK/package/API
checks and the shared reader's regressions cover those builds.

`node tools/github-plugin-fixture.mjs --port=5188 --all-enabled` uses the complete
unchanged enabled list. It starts 22/24 packages, including Iconize after its
directory marker is included. Git and Templater require Node; Omnisearch starts
with an HTTP-feature limitation. These are startup checks, not full workflow
parity for every plugin.
