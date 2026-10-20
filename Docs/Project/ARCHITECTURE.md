# Architecture and implementation boundaries

[Feature-parity index](../FEATURE-PARITY.md)

## Current architecture

| Layer | Responsibility |
|---|---|
| .NET 10 / C# services | Native vault inventory, text I/O, conflict detection, mutation endpoints, configuration and validated workspace storage. |
| Shared Razor/Blazor UI | Vault chooser, application shell, settings and shared desktop/browser UI. |
| TypeScript/JavaScript client | Workspace objects, CodeMirror integration, Markdown rendering, metadata, core features and plugin facade. |
| CodeMirror 6 | Real source editor objects and shared extension instances used by supported plugins. |
| Electron desktop host | Windows window, local .NET process and native Node/Electron capabilities. |
| Standalone WASM host | Browser .NET runtime, static assets, File System Access handles and local browser transport instead of HTTP application endpoints. |

The design is intentionally hybrid. "Written in .NET" does not mean removing
the JavaScript/DOM/editor environment that existing Obsidian plugins expect.
Implementing every editor primitive as an unrelated Blazor component would
not make those plugins compatible.

## Why core plugins cannot simply be loaded like community plugins

The reference's bundled core modules are not ordinary installed plugins that
export a public `Plugin` subclass and run `onload()`. They use a private
registration and lifecycle contract, including `init(app, registration)`,
`onEnable`, private views and internal helpers.

An isolated original Outgoing links controller probe reached its constructor,
initialization, enablement and open callback, then encountered a missing private
view. That is useful evidence of a host boundary, not a successful port of the
module, and not proof that a full port is impossible.

Consequently, core compatibility requires either a complete enough original
private host/dependency closure or an independent implementation with equivalent
behavior and required interfaces. Current deployable features use the latter
approach. A core module's visible UI and the methods other plugins call must
both be considered.

## Generic view foundation and remaining boundaries

There is now a shared `View` / `ItemView` / `FileView` registry,
with plugin-owned factories and file-extension mappings. Real custom panes
have isolated DOM, main/left/right/split tab groups, file load/unload hooks,
actions and component cleanup. Empty and unavailable panes do not contain
hidden Markdown editors.

Opaque JSON state, pins, sidedock trees, active selection and the most recent
main-pane/file context survive a full desktop restart and a real-folder browser
reload/reconnect. A missing or disabled provider leaves an explicitly
unavailable pane with its original type/state retained. Explicitly enabling the
plugin restores fresh views; community-plugin enablement itself is still
session-only.

The shared scenarios also exercise failed creators/state/file hooks, retained
Markdown editor/undo, close vetoes, interrupted-disable rollback and owned
interval/event/action/extension cleanup. These establish the described subset,
not complete lifecycle ordering for arbitrary plugins.

The discovery sidebars and Outgoing links remain independently owned panels,
**not registered compatible core workspace leaves**. The new host does not
automatically make `getLeavesOfType("search")`, private controllers or native
view methods work for them. Editable `TextFileView` now has actual buffers,
two-second debounced saves, version conflicts, reloads and unload-save handling.
Unlike Markdown, separate custom text panes do not share one CodeMirror
document: clean peers refresh, while dirty peers retain text and report conflicts.
Broader custom-view lifecycle/remapping cases, general binary/adapter APIs, drag
docking, popouts and full private view contracts remain unfinished. No original
bundled core module is loaded.
