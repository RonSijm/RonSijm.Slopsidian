# What the project is trying to replace

[Feature-parity index](../FEATURE-PARITY.md)

## Desired outcome

Slopsidian should eventually be a practical replacement for Obsidian's Windows
desktop application, not just an application that can display a Markdown file.
Users should be able to open an existing vault, use familiar workflows, retain
their data and configuration, and run compatible existing plugins without
rewriting those plugins for .NET.

The intended scope includes the main application, all bundled core modules,
the host/API capabilities needed by plugins, and compatible appearance and
interaction. Slopsidian's name and `RonSijm.Slopsidian` namespace are intentional
branding differences.

| Scope | Required outcome | Current gap |
|---|---|---|
| Existing vaults | Use ordinary Markdown, attachments and relevant `.obsidian` configuration without a conversion/import step. | Many file types and settings are not yet supported; existing layouts are not imported. |
| Main application | Match everyday editing, navigation, workspace, settings and file-management behavior. | Many workflows are partial or missing; visual equivalence has not been measured. |
| Core plugins | Match all 31 modules in the pinned reference, including lifecycle, settings, persistence, feature behavior and dependency interfaces. | Independently implemented subsets include shared Bases tables and desktop Web viewer browsing; a fresh fixed-contract score and original-runtime/private-host parity remain outstanding. |
| Community plugins | Run existing JavaScript plugins against compatible public APIs, shared editor objects and necessary runtime services. | The facade is incomplete; broader editable/binary view contracts, core-view migration and several major services are absent. |
| Plugin dependencies | Supply the real behavior/interfaces a dependent plugin needs, not just an enabled flag or matching class name. | Core handles and metadata are subsets; no full private-host compatibility layer exists. |
| Themes and snippets | Support installed appearance customization and compatible DOM/CSS behavior. | No complete installed-theme or snippet workflow. |
| Browser distribution | Share the application with a static WASM build and use real local vault folders. | Browser-specific restrictions prevent unconditional desktop-plugin parity. |
| Reliability | Avoid silent corruption, expose unsupported operations, survive expected failures and prove behavior with real-file scenarios. | Saved-text recovery has a guarded subset; unsaved-draft/abrupt-failure recovery, continuous autosave, packaging and broader failure testing remain. |

## Version and platform scope

The frozen comparison target is **Windows Obsidian 1.12.7**, not an unspecified
"latest Obsidian." The inventory includes Footnotes, Bases and the desktop Web
viewer found in that artifact.

The public npm API declarations currently used by development fixtures are
**1.14.4**. Those declarations are not the application runtime, and their version
does not change the pinned reference or prove API implementation.

Windows desktop and the standalone browser host are the active targets.
Native Linux/macOS builds and mobile applications are not currently in scope.
Running a compatible browser on another OS is not evidence of a native host for
that OS.

Official Obsidian Sync and Publish are still included in the core benchmark.
Their authorized account, service and second-client/site requirements are
external dependencies. Rewriting a client does not supply those hosted services
or establish permission/access to use them.

## Build independence

Slopsidian builds and runs from this repository with the documented .NET,
Node.js and Electron dependencies. An Obsidian installation is not required.
