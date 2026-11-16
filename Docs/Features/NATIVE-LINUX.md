# Native Linux client

Slopsidian Native ports the existing workspace to .NET 10/Avalonia widgets.
The ribbon, file tree, editor, tabs, dialogs and reading view run in the desktop
process without Electron, Chromium, Blazor, a WebView or a local HTTP server.
The native and web hosts share the existing vault services through
`RonSijm.Slopsidian.Core`.

The full port is in progress. The PR remains a draft until the outstanding
workflows in `Docs/Project/NATIVE-PORT.md` have been implemented and accepted.

## Available workflows

- Open or create a local vault; switch between recent vaults.
- Navigate folders and files through the native tree and quick switcher.
- Keep independent document tabs, drafts, Undo/Redo and cursor positions.
- Save explicitly or autosave Markdown using version checks and atomic writes.
  Conflicts retain the editor draft and the external file. Existing UTF-8 BOM
  and line endings are retained.
- Retain sessions and unsaved drafts in a private atomic application profile.
  Recovery data for a removed note is retained; its recovery UI is still pending.
- Search paths and note contents, including open drafts. Content search skips
  notes over 4 MiB; richer search operators are still pending.
- Create nested notes and folders; use the configured default note location.
- Rename/move a note and update its Markdown, wiki and YAML references in one
  guarded transaction. Move notes to vault-local `.trash` without overwriting
  colliding trash entries. Reviewed trash restoration is tested in the shared
  service; its native screen is still pending.
- Read basic Markdown with native controls and follow links. HTTP(S) links open
  in the system browser; unsupported URI schemes are refused.
- Use Outline, Backlinks, Outgoing links, Tags, Footnotes and a native YAML
  property editor. Property edits preserve unrelated content and comments.
- Open the interactive native graph, insert templates, create daily notes,
  bookmark notes and save/load native named workspaces. These workflows still
  require complete parity acceptance against the original client.
- Change editor/appearance preferences and vault Files and links/core settings
  through native forms. These forms preserve unknown configuration fields and
  refuse stale configuration writes.

Keyboard: **Ctrl+O** quick switcher, **Ctrl+P** command palette,
**Ctrl+Shift+O** open/create vault, **Ctrl+N** new note, **Ctrl+S** save,
**Ctrl+,** settings, **Alt+Left/Right** navigation and **F5** refresh.

The interface preserves Slopsidian's dark/light neutral palette, violet accent,
source icon geometry and workspace arrangement. The Linux application icon is
an original generated Tux with an absurd violet notebook. Its generation prompt
is retained in the asset provenance file and PNG metadata.

## Build and verify

Use the .NET 10 SDK selected by `global.json` and a Linux desktop with X11 or
XWayland, Fontconfig, FreeType and the standard .NET native dependencies.
Node.js and npm are not required for the native project. Folder selection uses
the desktop portal where available.

```sh
./build-and-run-linux.sh
./build-and-run-linux.sh --vault=/absolute/path/to/vault
./tools/lint-native.sh
dotnet test tests/RonSijm.Slopsidian.Linux.Tests
```

`--profile=/absolute/path` isolates native application state. By default it is
stored under the user's application-data directory in `Slopsidian/native`.
Profile files use owner-only permissions on Linux. Vault configuration controls
write the corresponding `.obsidian` configuration files through the shared
version-guarded APIs; native sessions do not overwrite Obsidian workspace.json.

The headless xUnit suite exercises temporary vaults and real Avalonia controls,
including tab Undo/caret retention, stale-save refusal, exact text, metadata,
rename transactions and identity-checked trash recovery. It does not replace
full workflow acceptance or the existing browser/desktop tests.

The lint command checks formatting, recommended .NET analyzers and
SonarAnalyzer C#, then treats build warnings as errors. Analyzer scope is the
native project; existing host code is not blanket-reformatted.

## Packages

```sh
./tools/package-linux.sh                 # current x64/arm64 machine
./tools/package-linux.sh linux-x64       # or linux-arm64
```

Outputs under `.runtime/native-linux/<runtime>/out/` include a self-contained
`Slopsidian-Native-0.2.0-<runtime>.tar.gz`, a Debian package when `dpkg-deb` is
available, and SHA-256 checksums. The package includes its .NET runtime. Linux
desktop libraries are still required. Build on Ubuntu 22.04 or newer for the
declared glibc baseline; Alpine/musl is not a supported target.

Extract the archive and run `./slopsidian-native`, optionally with `--vault` and
`--profile`. On Debian/Ubuntu install the package with
`sudo apt install ./slopsidian-native_0.2.0_amd64.deb`, then launch Slopsidian Native
from the application menu. Removing the package retains vaults and profiles.
The packaging script stages publish outputs, notices and launchers only.

## Outstanding work

Canvas/Bases widgets, attachments, advanced Markdown/Live Preview, audio,
slides, preview/composition/conversion workflows, rich search, complete module
lifecycles, editable hotkeys, full bookmark/workspace compatibility, saved-file
snapshot screens and community-plugin compatibility remain under development.
The current split is a reading preview, not independent editor groups. Basic
reading shows image references and raw HTML text without fetching or executing
HTML. It is bounded to 1,000,000 characters; Source retains the entire note.

Community JavaScript plugins and browser CSS themes do not automatically run
or style native widgets. The existing Windows system-trash and permanent-delete
paths are not presented as Linux implementations. Publish/Sync hosted services
are unavailable in the upstream runtime as well.

Packages are unsigned and have no update channel. The native CI workflow
builds x64/arm64 artifacts; it does not publish releases. Maintainer approval may
be required before fork PR workflows execute.
