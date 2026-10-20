# Plugin file I/O in read-only vaults

GitHub vault content is immutable. Copy a vault locally to edit its notes,
drawings or attachments. Personal settings, plugin enablement and plugin data
can still be saved to the existing local preference overlay.

Vault mutation APIs share a `ReadOnlyVaultError` refusal with
`code: "VAULT_READ_ONLY"`, the attempted `operation` and an optional vault-relative
`path`. Create, modify, binary creation, processing, folder creation, rename,
trash, delete and document batches refuse before repository I/O. A refused
`Vault.process` does not invoke its transformation callback. File-manager
operations also check before saving open files or refreshing metadata.
The GitHub transport independently rejects repository mutation routes.

Direct plugin API calls still reject their promises. A refusal must not be
treated as a successful write. Unexpected exceptions continue through the
[error logger and smoke audit](ERROR-LOGS.md); logged errors retain their policy
code, operation and path along with the original stack and causes.

## Excalidraw drawings

The supplied, unchanged Excalidraw **2.29.0** package has a host compatibility
adapter for remote vaults. It opens drawings in view mode, constrains its
session autosave flag and restores view mode if a toolbar or scene API asks to
enter editing mode. Pan, zoom and other viewing operations remain available.
It does not change repository plugin settings or vendor package files.

The adapter stops the plugin's save pipeline before scene serialization,
backups, exports or persistence handoffs. Background, forced and direct saves
return the plugin's existing **skipped** outcome. No saved revision advances,
and `saveWithOutcome()` has no acknowledged revision. Direct `Vault.modify`
still returns the typed refusal.

The host recognizes this as a read-only view: it does not show a pending-save
marker or require persistence of temporary viewing state during close, vault
change or shutdown. Raw plugin dirty state is retained. Ordinary writable
vaults keep their existing save path, including write failures.

This adapter is pinned to the inspected 2.29.0 contract. Other plugin versions
and packages receive the ordinary guarded APIs; they must handle write
refusals themselves. Desktop plugins retain their existing trusted Node access.
This is a vault I/O policy, not a security sandbox for plugin code.

## Validation

`node tools/smoke.mjs --excalidraw` and
`node tools/web-smoke.mjs --excalidraw` exercise the actual plugin package,
normal local drawing edits and a cached GitHub mount. The remote fixture uses
Git blob identities and the production cache-only reader. It checks repeated
save outcomes, unchanged revisions and cached bytes, direct write refusal,
local plugin-data preferences, view close, plugin disable and return to the
local vault. Both runners audit the error log through shutdown.

Focused policy tests cover denied operations, callback prevention, flag
ownership, incompatible adapter contracts and propagation of writable errors.
