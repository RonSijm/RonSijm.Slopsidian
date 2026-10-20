# Maintaining the live documentation

[Feature-parity index](../FEATURE-PARITY.md)

The [feature-parity index](../FEATURE-PARITY.md) and its linked area pages are
one manually maintained status collection, not an automatically refreshed
dashboard. Keep implementation, tests and documentation in the same change
whenever practical.

1. Update the relevant application, core-module, API and host rows when behavior changes.
2. Keep **verified**, **partial**, **in progress**, **missing** and **blocked** distinct. An available toggle or passing build is not completion.
3. Update benchmark counts only from a freshly generated, artifact-bound report. Preserve the old accepted baseline explicitly when current work is not yet accepted.
4. Record which hosts and real plugin versions were exercised. A desktop result does not automatically apply to WASM.
5. Keep remaining work specific. Remove a gap only when the intended workflow and relevant edge cases have actually been demonstrated.
6. Retain external dependencies and unsupported operations instead of excluding them to improve the score.
7. Update the review date and add a concise status-change entry for meaningful milestones.
8. Keep the README's short summary consistent with this document and the fixed contract.

For any newly supported core feature, check both its own workflow and the API
surface a dependent plugin might use. For any change to storage or events,
include genuine external-file behavior and configuration preservation.

Future work should add evidence and remaining-gap detail to the appropriate
area page rather than scattering contradictory "complete" claims across chat
responses or creating another competing parity checklist.

## Choosing the page to update

| Change | Primary documentation |
|---|---|
| Product goals, supported platforms or architecture boundaries | [Scope](SCOPE.md) and [architecture](ARCHITECTURE.md) |
| Application, core-module or discovery behavior | The relevant page in [Features](../FEATURE-PARITY.md#documentation-map): [application](../Features/APPLICATION.md), [core plugins](../Features/CORE-PLUGINS.md) or [discovery](../Features/DISCOVERY.md) |
| Community-plugin APIs or host restrictions | [Plugin compatibility](../Compatibility/PLUGIN-API.md) or [desktop/WASM matrix](../Compatibility/DESKTOP-WASM.md) |
| Vault formats, concurrency or data preservation | [Data safety](../Engineering/DATA-SAFETY.md) |
| Build, publication, distribution or performance | [Build and deployment](../Engineering/BUILD-DEPLOYMENT.md) |
| Accepted scenarios, artifact freshness or benchmark totals | [Evidence](../Engineering/EVIDENCE.md), then the affected feature rows |
| Dependencies or remaining work | [Roadmap](ROADMAP.md) |
| Source locations or meaningful milestones | [Source index](../Reference/SOURCES.md) or [change record](../Reference/CHANGELOG.md) |

Keep the entry point's status summary and review date consistent when an area's
position changes. Detailed descriptions belong in their area pages rather than
being copied into the index or README. Adding or moving a page also requires
updating the index and its relative links; every area page links back to the
index.

## Working in parallel

Give each contributor or agent a bounded implementation and documentation
scope. Different area pages can be edited independently. Coordinate ownership
of shared files such as the core-plugin inventory, evidence table, roadmap,
change record and entry-point summary before changing them.

One integrator should reconcile shared summaries and links after the separate
changes are ready. Preserve another contributor's in-progress work and do not
promote its status merely because code or documentation was added. The fixed
31-module/140-case contract and artifact-freshness requirements remain unchanged.
