# ADR-0019: Manual assignment and reassignment as operator overrides

- **Status:** Accepted
- **Date:** 2026-10-31
- **Related:** [RFC-0002](../rfc/0002-assignment-overrides-and-duplicate-safety.md)

## Context
The take-home brief asks for the interface to assign a lead to an agent. ADR-0014 currently specifies automatic assignment only, which may not satisfy that requirement. The assignment history already has `reason`, `assigned_by`, and `previous_agent_id` fields that can represent an operator override without replacing the automatic round-robin path.

## Decision
- Keep automatic round-robin assignment as the default path, and add manual assignment controls to the live board and lead detail view.
- If accepted, this ADR supersedes ADR-0014's automatic-only restriction and ADR-0005's statement that only automatic assignments move the pointer; their other decisions remain unchanged.
- An operator can assign any queued lead, including a parked lead, to an online agent. An operator can also reassign an assigned lead to a different online agent.
- Perform each operation in one database transaction. Lock the target queue row or lead row, then lock `assignment_state` before allocating the next `sequence_no`.
- For a queued lead, create the assigned `leads` row and its contacts, first status history row, assignment event, and recipient notification, then delete the queue row. Use `reason = 'manual'`, `previous_agent_id = NULL`, and the operator's agent ID in `assigned_by`.
- For a reassignment, update `leads.assigned_agent_id`, append an event with `reason = 'reassigned'`, the prior owner in `previous_agent_id`, and the operator in `assigned_by`, and create a notification for the new owner. Preserve the lead's status and notes.
- Manual assignments increment `assignment_state.last_sequence_no` and set `last_assigned_agent_id` to the recipient. The next automatic assignment therefore continues after the most recently assigned agent, whether the previous assignment was automatic or manual.
- The act-as-agent selection supplies `assigned_by` for this assessment. It is an attribution convenience, not authenticated identity; production authorization is out of scope.
- Reject a manual assignment when the selected target is offline. Eligibility remains consistent with ADR-0018.

## Consequences
- The UI meets the brief's explicit assignment requirement while retaining the live round-robin demonstration.
- Manual actions are visible in the same ordered assignment feed and notification workflow as automatic assignments.
- An operator override intentionally affects the next round-robin pick because the pointer records the most recent recipient.
- The simulated actor field must not be treated as trustworthy authorization or audit identity in production.

## Alternatives considered
- Keep assignment automatic only (simpler, but risks missing the brief's requested UI behavior).
- Allow manual assignment only for queued leads (does not support correcting an existing owner).
- Leave the round-robin pointer unchanged after manual assignment (makes the next automatic pick less intuitive relative to the most recent assignment).