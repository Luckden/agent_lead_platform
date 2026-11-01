# Architecture Decision Records

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-build-custom-instead-of-existing-crm.md) | Build custom instead of adopting an existing CRM | Accepted |
| [0002](0002-tech-stack.md) | Next.js, TypeScript, hosted Supabase, DaisyUI, Zod | Accepted |
| [0003](0003-contacts-and-lead-contacts.md) | `lead_contacts` as a child table of leads | Accepted |
| [0004](0004-assignment-events-and-current-owner.md) | Append-only assignment events plus current owner | Accepted |
| [0005](0005-round-robin-pointer-and-locking.md) | Round-robin pointer and locked SQL function | Accepted (pointer rule amended by 0019) |
| [0006](0006-lead-queue-for-unassigned-leads.md) | Lead queue; `leads` holds only assigned leads | Accepted |
| [0007](0007-status-history-stores-status-entered.md) | Status history stores status entered | Accepted |
| [0008](0008-notes-as-single-column.md) | Notes as a single column | Accepted |
| [0009](0009-notifications-triggered-by-assignment-events.md) | Notifications triggered by assignment events | Accepted |
| [0010](0010-presence-tracking.md) | Presence via manual flag; act-as-agent dropdown; heartbeat as bonus | Accepted |
| [0011](0011-webhook-event-logging-and-duplicates.md) | Log every request; duplicate policy | Accepted |
| [0012](0012-no-cache-layer.md) | No cache layer | Accepted |
| [0013](0013-secrets-migrations-and-packaging.md) | Secrets, migrations, Docker, no Terraform | Accepted |
| [0014](0014-live-assignment-board.md) | Live assignment board (automatic-only rule superseded by 0019) | Accepted |
| [0015](0015-queue-retries-parking-and-sweep.md) | Queue retries, parking, and sweep | Accepted |
| [0016](0016-ui-data-access.md) | Writes via API routes; browser reads via Realtime | Accepted |
| [0017](0017-duplicate-matching-links-identifiers.md) | Duplicate matching links identifiers to one lead | Accepted |
| [0018](0018-smaller-decisions.md) | Smaller decisions (status, eligibility, notifications, deletes, token) | Accepted |
| [0019](0019-manual-assignment-overrides.md) | Manual assignment and reassignment as operator overrides | Accepted (actor rule amended by 0021) |
| [0020](0020-serialize-duplicate-matching-across-queue-and-leads.md) | Serialize duplicate matching across queue and assigned leads | Accepted |
| [0021](0021-admin-role-gate-for-overrides.md) | Shallow admin role gate for assignment overrides | Accepted |
| [0022](0022-for-me-view.md) | "For me" view replaces the Notifications tab | Accepted |

Related: [RFC-0003](../rfc/0003-admin-role-and-for-me-view.md), [RFC-0001](../rfc/0001-lead-intake-and-assignment.md), [RFC-0002](../rfc/0002-assignment-overrides-and-duplicate-safety.md), [ERD](../erd.mermaid).
