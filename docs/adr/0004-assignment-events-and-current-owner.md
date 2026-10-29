# ADR-0004: Append-only `assignment_events` plus current owner on `leads`

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
The brief asks for assignment history and sequence for audit and troubleshooting, and the UI needs the current agent quickly.

## Decision
- `assignment_events` is append-only: `lead_id`, `agent_id`, `previous_agent_id`, `sequence_no`, `reason` (`auto` in this version; `manual` and `reassigned` reserved for future work, see ADR-0014), `assigned_by`, `created_at`. Rows are never updated or deleted.
- `leads.assigned_agent_id` (not null, because a lead only exists once it is assigned; see ADR-0006) stores the current owner for fast reads.
- Both are written in the same transaction, inside the assignment SQL function.

## Consequences
- Full audit trail and a visible assignment order.
- The two cannot disagree because they change together.
- Not full event sourcing; the event table is history, not the only source of truth.
- Raw payloads and status changes stay in their own tables.
