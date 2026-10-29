# ADR-0006: Incoming leads wait in a `lead_queue`; `leads` holds only assigned leads

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
The brief does not say what happens when no agent is online. Giving unassigned leads a `new` or null status would add a state that carries no extra information, since "waiting" already means "not yet assigned". It would also force `leads.status` and `leads.assigned_agent_id` to be nullable.

## Decision
- Every valid incoming lead is inserted into `lead_queue` first. The queue row holds the intake data: `external_lead_id`, contact name, normalized phone, lowercased email, `source`, `project`, `budget`, `message`, `source_created_at`, `attempts`, `last_attempt_at`, `created_at`.
- The assignment SQL function claims the oldest queue row (`FOR UPDATE SKIP LOCKED`), chooses an agent (ADR-0005), and in one transaction inserts the `leads` row (with `assigned_agent_id` and `status = 'assigned'`) and its `lead_contacts`, writes the `assignment_events`, `lead_status_history`, and `notifications` rows, and deletes the queue row. If anything fails, the transaction rolls back and the lead stays queued.
- If no agent is online, the function does nothing and the lead stays in the queue. The function is re-run when an agent goes online, and by a periodic sweep as a backstop, oldest lead first, until the queue is empty or nobody is online.
- A row exists in `leads` only if the function succeeded. `leads.assigned_agent_id` and `leads.status` are therefore NOT NULL, and the first status is `assigned`.

## Consequences
- No lead is dropped when everyone is offline, and "waiting" is expressed by queue membership rather than a status value.
- There is a single path for every lead, so there is one flow to test; the cost is one extra insert and delete per lead.
- Duplicate detection must check both `lead_contacts` and `lead_queue`, otherwise the same person arriving twice while everyone is offline creates two leads (see ADR-0011).
- The UI shows queued leads from `lead_queue` as "Unassigned"; they are not in the main lead list.
- The first `lead_status_history` row has no human actor, so `changed_by` is null on auto-assignment.
- `webhook_events` cannot point to a `leads` row while the lead is queued, so it stores the external lead ID instead.

## Alternatives considered
Storing unassigned leads in `leads` with null `assigned_agent_id` and `status` (simpler, but nullable columns and a state that means "none"); a `new` status (adds a state with no information beyond "no owner").
