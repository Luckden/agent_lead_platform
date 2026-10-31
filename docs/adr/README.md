# Architecture Decision Records

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-build-custom-instead-of-existing-crm.md) | Build custom instead of adopting an existing CRM | Accepted |
| [0002](0002-tech-stack.md) | Next.js, TypeScript, hosted Supabase, DaisyUI, Zod | Proposed |
| [0003](0003-contacts-and-lead-contacts.md) | `lead_contacts` as a child table of leads | Accepted |
| [0004](0004-assignment-events-and-current-owner.md) | Append-only assignment events plus current owner | Accepted |
| [0005](0005-round-robin-pointer-and-locking.md) | Round-robin pointer and locked SQL function | Accepted |
| [0006](0006-lead-queue-for-unassigned-leads.md) | Lead queue; `leads` holds only assigned leads | Accepted |
| [0007](0007-status-history-stores-status-entered.md) | Status history stores status entered | Accepted |
| [0008](0008-notes-as-single-column.md) | Notes as a single column | Accepted |
| [0009](0009-notifications-triggered-by-assignment-events.md) | Notifications triggered by assignment events | Accepted |
| [0010](0010-presence-tracking.md) | Presence via manual flag; act-as-agent dropdown; heartbeat as bonus | Accepted |
| [0011](0011-webhook-event-logging-and-duplicates.md) | Log every request; duplicate policy | Accepted |
| [0012](0012-no-cache-layer.md) | No cache layer | Accepted |
| [0013](0013-secrets-migrations-and-packaging.md) | Secrets, migrations, Docker, no Terraform | Proposed |
| [0014](0014-live-assignment-board.md) | Live assignment board; no manual assignment | Accepted |
| [0015](0015-queue-retries-parking-and-sweep.md) | Queue retries, parking, and sweep | Accepted |
| [0016](0016-ui-data-access.md) | Writes via API routes; browser reads via Realtime | Accepted |
| [0017](0017-duplicate-matching-links-identifiers.md) | Duplicate matching links identifiers to one lead | Proposed |
| [0018](0018-smaller-decisions.md) | Smaller decisions (status, eligibility, notifications, deletes, token) | Accepted |

Related: [RFC-0001](../rfc/0001-lead-intake-and-assignment.md), [ERD](../erd.mermaid).
