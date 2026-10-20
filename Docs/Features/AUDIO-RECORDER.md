# Audio recorder

[Feature-parity index](../FEATURE-PARITY.md)

**Claim completed:** Codex (Audio recorder), 2026-10-21. Independent recording and local
playback subset for desktop and WASM. Runtime acceptance uses synthetic audio;
physical microphones and OS device permissions have not been exercised.

## Recording and saving

Enable **Settings > Core plugins > Audio recorder**, then open its microphone
ribbon button. Opening the dialog does not acquire a microphone. **Start
recording** explicitly requests access; **Stop recording** finalizes the clip,
releases the tracks and makes a local preview available. The command palette
also provides **Start audio recording** and **Stop audio recording**.

The host selects a supported M4A/MP4, WebM/Opus or Ogg/Opus encoder. The filename
extension follows the actual format. Recordings are bounded to **10 minutes /
16 MiB**. Unsupported codecs, missing/busy devices, denied permission, encoder
failures, empty output and finalization timeouts produce visible errors.

**Save recording** creates a vault attachment. **Save and insert into note**
also inserts an embed at the current selection of a Markdown source editor.
The insertion remains an undoable buffer edit until the note is saved with
**Ctrl+S**. Saving an attachment and saving its note are separate operations.

Default names use `Recording YYYYMMDDHHmmss`, with collision suffixes. The
dialog reads `app.json`'s `attachmentFolderPath`: the vault root, a vault-relative
folder, `./` beside the active file, or a note-relative folder such as `./Audio`.
The editable path stays relative to the vault. Invalid preferences/paths fail
visibly; they do not silently redirect a clip elsewhere. The module adds no
settings page and leaves existing unknown module/app options untouched.

Reading view renders supported local audio embeds with native playback
controls. The enabled recorder also owns an `audio` file-pane provider for
M4A, WebM, Ogg, MP3, WAV and audio MP4 files up to 16 MiB. Those panes preserve
their file and opaque JSON state through restart. Disabling retains unavailable
pane state; enabling restores the provider. Reading playback belongs to the
shared renderer and remains available independently of recorder enablement.
Remote audio and raw HTML audio elements are not automatically loaded.

Native playback controls keep a 240-pixel minimum inside the existing
scrollable Reading, file-pane and recorder containers. This prevents a deeply
split layout from shrinking a decoded clip to an unusable 56-pixel control.
The real playback assertion is retained; failures capture media events and
input geometry rather than replacing native clicks with programmatic `play()`.

## Persistence, permissions and concurrency

Desktop permission requests are bound to the local main application frame,
audio only, with an explicit Electron consent dialog. External frames and
camera requests are rejected. Browser capture uses the browser/OS permission
model over HTTPS or localhost. The desktop synthetic permission bypass exists
only when both smoke-test flags are supplied; ordinary application launches
retain the real consent flow.

Capture owns its tracks, encoder callbacks and timers. Stop, discard, accepted
disable and vault leave clean them up. A late permission response after cancel
is stopped immediately. Closing an unsaved recording, disabling or switching
vaults can be cancelled; browser reload/close uses the unsaved-audio guard.
A pending attachment save blocks leaving. Detached dialog buttons cannot
restart acquisition. Abrupt termination can still lose unsaved audio.

Attachment writes are create-only and preserve exact binary bytes. Existing
paths and late collisions are refused. A saved attachment is checked against
its SHA-256 version before insertion. The selected vault, module/dialog lifetime,
source view, text, selection and saved note version are checked again around
the asynchronous write. External note changes prevent insertion without
overwriting that note. The saved clip remains available when the dialog is
reopened for insertion into the intended current editor, without creating a
duplicate attachment. **New recording** clears the in-memory clip/context;
saved files remain in the vault.

`Vault.createBinary(path, ArrayBuffer)` and `Vault.readBinary(file)` work on
both hosts, bounded to 16 MiB, with strict base64 transport and root/path guards.
The native implementation uses create-only replacement and rejects reparse
paths. Browser handle writes detect the exercised external create/write races
and retain newer conflicting content, but cannot provide an atomic operation
against every other application or tab. Full binary adapters, overwrite/modify
APIs, save options and cross-file crash durability remain outside this subset.

## Reference scope and remaining work

The pinned comparison scope includes the microphone ribbon, start/stop commands,
audio-only capture, MP4/WebM selection, track cleanup, timestamped binary
attachments and Markdown embedding. It has no settings page. Original-module
execution and full behavioral equivalence have not been established.

Remaining work includes original-runtime comparison, physical-device/OS
permission acceptance, WebM duration/seek equivalence, full native/private/plugin
interfaces, broader codec/platform/large-file cases and visual/accessibility
parity. Pause/resume, waveforms, device selection and unsaved-audio crash
recovery are not supplied by this implementation.

## Evidence

Eight audio model/native tests cover exact bytes, state transitions, late
grants, errors/limits, paths, binary validation, desktop permission binding and
native persistence. Two browser binary tests cover byte-exact reconnects,
collisions and late external-file preservation. The full regression snapshot
passed **152 tests**, with no failures or skips.

Four actual shared audio workflow groups pass on each host:

```powershell
npm run smoke:audio
npm run build:web -- --base=/ --no-restore
npm run smoke:audio:web
```

They use actual Chromium MediaRecorder with its synthetic microphone, actual
playback controls and real filesystem effects. They cover recording/preview,
both playback surfaces, exact attachment and note bytes, codec/permission
fault injections, collisions, a concurrent external note edit and insertion
retry, reload/discard/disable guards, stale controls and full desktop restarts
or browser reload/reconnect. The browser additionally passes twelve storage
and bootstrap groups through the actual OS folder picker without renderer Node.

Reports are `.runtime/evidence/audio-smoke.json` and `audio-web-smoke.json`;
preview screenshots are `audio-desktop.png` and `audio-web.png`. Reports retain
artifact hashes and explicitly identify synthetic audio. These focused results alone do not update the fixed 31-module benchmark or
establish a live-site deployment. The latest completed full native integration
also runs the four shared audio groups, including playback in the narrow
multi-pane layout, and records all four fixed Audio candidate cases.
