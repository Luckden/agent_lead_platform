# ADR-0012: No cache layer

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
Caching is listed as a bonus idea. The assignment pointer and agent presence must always be current and consistent.

## Decision
No cache. Assignment reads state directly from Postgres inside a locked transaction.

## Consequences
- A cache could serve stale presence and send a lead to an offline agent; avoiding it removes that risk.
- At this scale Postgres handles all reads easily.
- The README may note that caching read-heavy views (such as the lead list) could be considered at larger scale, while assignment state would stay in the database.
