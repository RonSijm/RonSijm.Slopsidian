# Audio recorder

[Feature-parity index](../FEATURE-PARITY.md)

**Claim completed:** Codex (Audio recorder), 2026-10-21. Independent recording and local
playback subset for desktop and WASM. Runtime acceptance uses synthetic audio;
physical microphones and OS device permissions have not been exercised.

## Choosing a microphone

The dialog starts with **System default** and performs no automatic enumeration. **Refresh inputs** lists only browser-exposed audio inputs, using hidden-name placeholders when needed. Choosing an input requires that exact device and verified live track identity; failure never retries System default. Device changes invalidate the next choice without replacing an active stream. Selection is transient across dialogs and is unavailable during permission requests, capture, pause/finalization or pending saves. A stale list or grant cannot populate a replacement dialog/vault; explicit retry is available after enumeration timeout. [Both-host synthetic validation and physical-device limits](../Engineering/VIEWS-AND-INPUTS-2026-11-19.md).

## Recording and saving

Enable **Settings > Core plugins > Audio recorder**, then open its microphone
ribbon button. Opening the dialog does not acquire a microphone. **Start
recording** explicitly requests access; **Stop recording** finalizes the clip,
releases the tracks and makes a local preview available. The command palette also provides Start/Stop and the later Pause/Resume recording controls.

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
controls. The enabled recorder owns an `audio` file-pane provider for
M4A, Ogg, MP3 and WAV files up to 16 MiB. The always-available video provider
owns the audiovisual MP4 and WebM container extensions, so enabling the recorder
cannot collide with or disable that provider. Existing saved `audio` pane state
for these containers still restores through the recorder. Audio-only fallback
recordings in a WebM container open with the video provider's playback controls;
codec support remains host-specific. Audio panes preserve
their file and opaque JSON state through restart. Disabling retains unavailable
pane state; enabling restores the provider. Reading playback belongs to the
shared renderer and remains available independently of recorder enablement.
Remote audio and raw HTML audio elements are not automatically loaded.

Native playback controls keep a 240-pixel minimum inside the existing
scrollable Reading, file-pane and recorder containers. This prevents a deeply
split layout from shrinking a decoded clip to an unusable 56-pixel control.
The real playback assertion is retained; failures capture media events and
input geometry rather than replacing native clicks with programmatic `play()`.

## Explicit waveform visualization

**Show waveform** is an intentional independent extension beside native audio controls. For the current authentic recording, it accepts at most 30 seconds of active recording / 16 MiB and decodes at 8 kHz. Only one waveform job runs globally; cancelling or replacing a clip retires its result while an uncancellable native decode retains its lease until settlement. **Cancel waveform**, timeout, dialog closure and changed owners prevent late results from repopulating a new clip.

For saved files, the visual reads uncompressed PCM (8/16/24/32-bit) or 32-bit float WAV directly, bounded to 10 minutes / 16 MiB and 256 peak bins. The actual binary response's version, root, path, stat and exact byte count are checked before its owned playback/waveform Blob is installed. The later [saved compressed waveform subset](../Engineering/INLINE-STRUCTURE-AUDIO-2026-11-19.md) also accepts short mono/stereo Opus in inspected fragmented MP4/M4A and noncontinued, nonchained Ogg. It requires finite loaded metadata of at most 30 seconds and verifies packet durations, sample extents, timestamps and container ownership before explicit native decode, followed by returned-PCM checks. It reuses the same verified playback Blob/URL and global job lease. Native internal allocation precedes the PCM checks. MP3/AAC/WebM and other unsupported compressed files retain native playback without waveform decoding. Unsupported/failed analysis leaves playback, seeking and saving available; Show never starts capture or playback. [Synthetic/cached both-host validation and confirmed limits](../Engineering/CARDS-AUDIO-BULK-2026-11-19.md). Original inspected recorder bodies do not establish waveform runtime parity.

## Pausing and resuming

**Pause recording** and **Resume recording** keep the same encoder, microphone stream and accumulated clip. Acknowledged pauses freeze active elapsed time while the microphone remains connected. The fixed ten-minute wall-clock lease includes pauses and is never renewed; the 16 MiB cap includes already owed chunks. Transition and finalization acknowledgements have eight-second timeouts. Stop remains available while recording, pausing, paused or resuming and finalizes one preview before releasing tracks. Discard, accepted disable and vault leave release resources and invalidate late callbacks.

Paused/transitional audio remains unsaved for Close/Discard/disable/vault leave and actual reload protection. Save/Insert remain disabled until ready. Read-only open/start/pause/resume refuse before acquisition, including forced handlers and delayed-grant rechecks, while existing audio playback remains available. One isolated shared-source embed insertion preserves earlier dirty prose and exact BOM/CRLF/Unicode bytes; ordinary note saving remains separate. [Both-host synthetic validation and limits](../Engineering/AUTHORING-CONTROLS-2026-11-19.md) does not establish physical microphone or OS permission behavior.

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
parity. The transient input chooser and waveform subset have bounded synthetic/cached acceptance only. Wider compressed formats, longer saved clips/recordings and unsaved-audio crash recovery remain open.

## Evidence

The [Cards/waveforms/reviewed-mention milestone](../Engineering/CARDS-AUDIO-BULK-2026-11-19.md) records explicit waveform controls, actual current-capture/native PCM, strict cached WAV, unchanged playback, exact saves/history and stale-result cleanup on both hosts. Physical microphones and universal codec/platform behavior remain separate; earlier snapshots below retain their original identities.

The later [authoring-controls slice](../Engineering/AUTHORING-CONTROLS-2026-11-19.md) renews actual audio capture/playback and adds real same-clip pause/resume, paused-only reload refusal, lifecycle cleanup, exact saved bytes/shared Undo, fresh-runtime and genuine cache-only capture refusal. It uses isolated synthetic audio, with observed final-source test/build/GUI/QA counts in its receipt. The older snapshots below retain their original scope.

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
