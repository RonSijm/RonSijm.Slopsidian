# Native Linux UI captures

Real Avalonia windows captured on an isolated Linux Xvfb display using a synthetic
Slopsidian demo vault. The native port is still in progress.

| Image | Workflow |
| --- | --- |
| workspace.png | File tree, independent document tabs, source editor and outline |
| reading.png | Markdown rendered with native controls |
| search-properties.png | Typed-property search and YAML property panel |
| graph.png | Linked and orphan notes in the native graph |
| settings.png | Native Files and links controls |
| canvas-dark.png | Native Canvas cards, group and connection on Avalonia 12, dark theme |
| canvas-light.png | The same native Canvas after changing the theme through Settings |
| canvas-inspector-dark.png | Native connection selection and editable fields in the dark theme |
| canvas-inspector-light.png | The native connection inspector in the light theme |

UI source: aaf4058. The demo contains no personal notes. The application logo is
maintained in `src/RonSijm.Slopsidian.Linux/Assets/tux-notebook.png` and its exact
generation prompt is retained with that asset.

Saved-file recovery captures show native version selection and an explicit restore review. The demo history was created by the real native recovery commands on the same isolated display. Restore behavior is covered by the 114-test regression suite; strict lint/Release build passed with zero warnings/errors.

The retained-draft screenshot follows real native editor input with autosave disabled, an application restart after removing the synthetic original, and opening Recover drafts. The recovered copy was then saved through the native window and its persisted profile state verified. No user files or desktop input were involved.

Vault-trash screenshots show real native previews, multiple selection and review of the selected destination folder. Both synthetic notes were then restored through the reviewed native action and their saved contents/location checked. External-change refusal and partial success are exercised by headless widget tests.

Canvas UI source: `97582ed`. The Canvas captures use Avalonia 12.1.6 with the editor/DataGrid `net10.0`
assemblies selected by restore. The same private-display run verified native
editor input, save bytes, Undo/Redo and copying a historical snapshot to the
isolated X11 clipboard. A 760×520 window was inspected, including wrapped Canvas
actions and Fit. These captures demonstrate the current Canvas implementation;
embedded file previews, edge editing and full Canvas acceptance were still open
in that revision.
The upgraded xUnit v3 suite passes all 152 tests.

Upgrade validation completed locally:

- Restore selected `net10.0` compile/runtime assets for Avalonia, desktop,
  AvaloniaEdit, DataGrid and SkiaSharp.
- `dotnet format src/RonSijm.Slopsidian.Linux --no-restore --verify-no-changes --severity warn` passed.
- A non-incremental Release build of the native test project and its dependencies
  passed with recommended .NET/Sonar analyzers and warnings treated as errors.
- `dotnet build RonSijm.Slopsidian.sln --no-restore --configuration Release --warnaserror` passed with zero warnings/errors, including both existing hosts.
- All 152 Release tests passed with xUnit v3.
- The x64 archive and Debian package were rebuilt; CLI version, runtime metadata,
  dependency versions, notices, package contents and SHA-256 checksums passed.
  The package includes Microsoft.NETCore.App 10.0.15.

Some transitive libraries still select compatible older target assemblies. The
application and selected Avalonia stack use .NET 10; an older .NET runtime does
not need to be installed. ARM64 runtime execution and remote CI were not
asserted by this local x64 check.

The selection-inspector captures use UI source `8921964`. A connection was
selected with the native keyboard-accessible picker, its label was edited with
real keyboard input, and Ctrl+S persisted that exact label in the synthetic
Canvas JSON. The native inspector was also opened as a popup at 760×520, closed
with Escape and restored as an inline panel after resizing. Both themes were
inspected through the real Settings flow. The global Outline sidebar was hidden
with its existing command to give this Canvas workspace more room.

All 155 Release tests pass after this addition, including selection without
source changes, connection properties, unknown-data preservation, invalid input,
Undo/Redo, saving/deleting an edge, automatic vertical endpoints inside a group,
zoom-independent hit targets, focused card typing and stale-vault refusal. The
Release analyzer build and full format verification pass without warnings or
errors. Embedded previews and the remaining full Canvas acceptance stay open.
