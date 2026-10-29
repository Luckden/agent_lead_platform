# ADR-0018: Smaller decisions: status values, eligibility, notifications, deletes, token

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
Several small choices affect the schema and the README but do not need separate records.

## Decision
- **Status values** are enforced by a database `CHECK` constraint (`assigned`, `contacted`, `qualified`, `closed`), not a lookup table. Any change between values is allowed in this version; there is no transition table.
- **Eligibility.** Any online agent is eligible. There is no capacity, project, or skill routing.
- **Notifications** are in-app records only (the `notifications` table), shown through Realtime. No email, SMS, or WhatsApp is sent.
- **Agent deletion** is blocked while anything references the agent: the foreign keys from `leads`, `assignment_events`, `notifications`, and `assignment_state` use `ON DELETE RESTRICT`. Agents are taken out of rotation by going offline, not by deleting them.
- **Incoming token.** One static bearer token, compared in constant time. No rate limiting; the README notes it as a production gap.

## Consequences
- Constraints keep the data valid without extra tables.
- The audit trail cannot lose its agent references.
- Anything beyond these is documented as future work, not silently assumed.
