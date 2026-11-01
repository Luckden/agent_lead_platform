# ADR-0020: Serialize duplicate matching across queue and assigned leads

- **Status:** Proposed
- **Date:** 2026-10-31
- **Related:** [RFC-0002](../rfc/0002-assignment-overrides-and-duplicate-safety.md)

## Context
Duplicate matching checks both `lead_queue` and assigned-lead contacts. PostgreSQL unique constraints on either table cannot prevent the same identifier from being inserted into both tables by concurrent intake requests. A race could therefore create two records for one external lead ID, phone, or email, contrary to ADR-0017.

## Decision
- Route intake inserts, queued-identifier fills, and duplicate-driven identifier attachments through a single transactional database function; application code must not write those identity fields directly.
- Before checking for matches, build one lock key for each supplied identity: the exact external lead ID, the normalized phone, and the lowercased email, each with a distinct type prefix.
- Sort the canonical lock keys and acquire a transaction-scoped PostgreSQL advisory lock for each key (for example, `pg_advisory_xact_lock(hashtextextended(key, 0))`). Hold the locks through the duplicate lookup and any resulting insert or identifier attachment.
- After acquiring the locks, search both `lead_queue` and assigned-lead contacts. Apply ADR-0017's duplicate selection and conflict rules, then write the result in the same transaction.
- Keep unique constraints within each table as a secondary safeguard. Queue-to-lead promotion atomically moves existing identifiers without creating new ones. If an identifier attachment waits for that promotion and the queue row is no longer present, the intake function rechecks the assigned lead and attaches the identifier there.
- Use deterministic key ordering to avoid deadlocks when a request includes multiple identifiers. A hash collision may serialize unrelated requests but does not weaken correctness.

## Consequences
- Concurrent requests sharing an external ID, phone, or email serialize before checking for duplicates, preventing a cross-table duplicate created by the intake path.
- Cross-table uniqueness is a database-function invariant rather than a declarative unique constraint. Intake and duplicate-attachment writers must follow the lock protocol; queue promotion must remain an atomic transfer and retry the attachment against the assigned lead if needed.
- The approach avoids adding an identity-registry table for this assessment. If independent writers are introduced later, reconsider a shared registry with a single unique constraint.

## Alternatives considered
- Add a shared identifier registry with one unique key space (stronger declarative enforcement, but adds schema and migration complexity).
- Rely only on application-level pre-checks or per-table unique constraints (does not close the cross-table concurrency race).