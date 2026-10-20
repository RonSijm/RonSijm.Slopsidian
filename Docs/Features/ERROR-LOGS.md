# Error logs

Errors shown in the notification at the top of the window are recorded before
the notification appears. Global JavaScript errors, unhandled promise
rejections and errors shown by the Blazor host banner use the same log.
Clearing a notification does not clear its log.

Each JSONL record contains a timestamp, session and record ID, error source,
message, original stack, chained causes and aggregate errors. Plugin restoration
errors retain the original plugin exception as their cause. Thrown strings get
a stack showing where they were reported. `stackOrigin` distinguishes original
stacks from reporting stacks when the browser provides only a message. Records
also include the active vault/file/view and any supplied browser filename, line
and column. Errors with string `code`, `operation` and `path` fields retain
those details too, including [read-only I/O refusals](READ-ONLY-PLUGIN-IO.md).
The logger does not capture editor buffers.

## Find or export the log

On desktop, logs are appended to
`.runtime/profile/logs/errors-YYYY-MM-DD.jsonl` inside the application directory.
The date is the UTC launch date. The launcher prints the absolute `ERROR_LOG` path. Smoke runs
use their test profile and a separate filename shared by that run's restarts.

In the standalone browser, files are stored in the origin's private filesystem
under `Slopsidian/logs/`. A synchronous local journal protects errors while a
file append is pending. Reloads retain both the files and any unfinished journal.
Browser site-data deletion removes these logs.

Use **Download log** in the error notification or host error banner to export
`slopsidian-errors.jsonl`. Desktop exports its current logfile; browser
exports retained files and pending journal records. The browser console also
provides `await slopsidianDiagnostics.read()`, `.flush()` and `.download()`.
Storage failures are reported to the console and fail smoke acceptance.

## Smoke acceptance

Every desktop, standalone-browser and Web viewer smoke run writes a separate
`<report-name>-errors.jsonl` in `.runtime/evidence/`. The report's `errorLogAudit`
contains its hash, number of records and any unexpected errors. Native audits
also read the app's actual logfile after the process exits, catching errors
emitted after the debugging connection closes. Browser audits flush and read
the persisted files before closing and retain the event channel through exit.
Uncaught exceptions remain a separate failing check, including final teardown.

An unexpected caught error notification fails the run even when there is no
uncaught exception and the bubble has already been cleared. Negative tests
must account for exact record IDs, sources and messages within their own action;
there is no global message-pattern exemption. Core workflow verification also
requires a passing audit and checks the retained logfile hash.

`npm run smoke:diagnostics` and `npm run smoke:diagnostics:web` exercise the
notification, global-handler records, actual log export and writable DOM
helper/window-migration behavior. Global handlers use controlled error events
in this self-test; these three deliberately injected records are accounted for.
