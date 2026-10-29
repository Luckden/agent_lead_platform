# ADR-0007: Status history stores the status entered, not from/to

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
An audit trail of status changes is required. Storing both `from_status` and `to_status` repeats information already present in the preceding row.

## Decision
`lead_status_history` has `lead_id`, `status`, `changed_by`, `created_at`. Each row means "the lead entered this status at this time". The previous status is the preceding row.

## Consequences
- Smaller table, and no way for from/to to disagree.
- The timeline starts with the `assigned` row written at assignment (see ADR-0006).
- Showing "contacted to qualified" in the UI requires looking at the previous row.
- `changed_by` is kept; "who did it" is the core of an audit trail.
