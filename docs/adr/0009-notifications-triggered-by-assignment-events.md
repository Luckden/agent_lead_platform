# ADR-0009: Notifications are triggered by assignment events

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
The brief requires a notification record when a lead is assigned to an agent. The trigger is the assignment, not the lead's existence.

## Decision
`notifications` has `agent_id` and `assignment_event_id` (plus `type`, `message`, `is_read`, `created_at`). One assignment creates one notification for the receiving agent, in the same transaction.

## Consequences
- Notifications stay consistent with the audit trail.
- The lead is reached through the event, so the bell UI needs a join. A denormalized `lead_id` column may be added if that is awkward.
- Future non-assignment notification types would need the event link to be nullable.
