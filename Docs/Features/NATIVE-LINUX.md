# Native Linux client

Slopsidian Native is a separate .NET 10/Avalonia desktop entry point. The window,
editor (AvaloniaEdit), dialogs and Markdown reading view are native controls;
there is no Electron, Chromium, WebView, local HTTP server or JavaScript runtime.
It calls the existing `VaultService` directly in the same process. The project
reference shares that implementation without starting the ASP.NET entry point.

This is an initial native client, not feature parity with the Blazor/Electron
application. Both applications can open the same local Markdown vaults.

## Available workflows

- Open an existing local vault using the desktop folder picker or `--vault`.
- Browse Markdown notes by their relative paths; resize the file sidebar.
- Search paths and note contents, including the current unsaved draft. Content
  search skips notes larger than 4 MiB; path search still includes them.
- Create a note, including nested folders, without overwriting existing files.
- Edit with native selection, clipboard, Undo/Redo, line numbers and wrapping.
- Save using the existing version checks and atomic replacement. UTF-8 BOM and
  existing line endings are retained. A conflicting external edit is refused,
  with the editor draft retained; copy the draft before reopening to resolve it.
- Save, discard or cancel before switching notes/vaults or closing the window.
- Read headings, paragraphs, emphasis, lists, quotations, code and links as
  native controls. Follow existing Markdown and wiki note links. Explicitly
  clicked HTTP(S) links open in the system browser; other URI schemes are refused.
- Refresh the file list after filesystem changes. Clean open notes reload when
  changed; dirty open notes stay intact and are checked again when saved.

Keyboard: **Ctrl+O** open vault, **Ctrl+N** new note, **Ctrl+S** save,
**Ctrl+P** focus search, **F5** refresh. The editor provides standard native
copy/paste and Undo/Redo shortcuts. Buttons and tabs support keyboard navigation.

The first client retains Slopsidian's dark neutral palette and violet links,
with the Linux system UI font and a monospace source editor. It uses native
window decorations and a resizable layout down to 760 × 520.

## Build and run

Requires the .NET 10 SDK selected by the repository's `global.json`, a Linux
desktop with X11 (or XWayland), Fontconfig, FreeType and the standard .NET native
dependencies. Folder selection uses the desktop portal where available.
Node.js and npm are not required for this client.

```sh
./build-and-run-linux.sh
./build-and-run-linux.sh --vault=/absolute/path/to/vault
dotnet test tests/RonSijm.Slopsidian.Linux.Tests
```

The tests use xUnit v2/VSTest and Avalonia's headless platform. They exercise real
temporary vaults and the native editor without requiring a display. This suite
does not replace the existing JavaScript/desktop/browser acceptance suites.

## Packages

```sh
./tools/package-linux.sh                 # current x64/arm64 machine
./tools/package-linux.sh linux-x64       # or linux-arm64
```

Outputs are under `.runtime/native-linux/<runtime>/out/`: a self-contained
`Slopsidian-Native-0.1.0-<runtime>.tar.gz`, a Debian package when `dpkg-deb` is
available, and SHA-256 checksums. No system-wide .NET install is needed to run
the package. Linux desktop libraries are still required. Build on Ubuntu 22.04
or newer for the declared glibc baseline; Alpine/musl is not a supported target.

Extract the archive and run `./slopsidian-native`, optionally with
`--vault=/absolute/path`. On Debian/Ubuntu install the `.deb` with
`sudo apt install ./slopsidian-native_0.1.0_amd64.deb`; launch **Slopsidian Native**
from the application menu. Uninstall with `sudo apt remove slopsidian-native`.
Application removal does not remove vaults. Packaging stages only publish
outputs and explicit notices/launchers, never local vaults or profiles.

## Current boundaries

Community JavaScript plugins, CSS themes, Canvas/Bases, attachments, graph,
properties, source highlighting, autocomplete, tables, math, embeds, heading
scroll targets and workspace layouts remain in the existing client. Markdown
images are shown as references and raw HTML as text; neither fetches nor executes.
The reading view is bounded to 1,000,000 characters; Write retains the full note.
There is no native delete/rename, OS trash, sync, autosave or crash recovery yet.
Save explicitly; normal navigation and shutdown prompt for unsaved changes.

The existing vault service's conservative filename rules and symlink refusal
also apply. This client does not modify `.obsidian` settings or run plugins.
No installer or build command is run with administrator privileges by the
project's build scripts. Packages are unsigned and have no update channel.

See the workflow `native_linux.yml` for headless regression tests and Linux x64
and arm64 package artifacts. These are CI artifacts, not automatic releases.
