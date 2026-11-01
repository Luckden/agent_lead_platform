# RFC-0002: Assignment Overrides and Duplicate-Safe Intake

- **Status:** Draft
- **Date:** 2026-10-31
- **Related:** [RFC-0001](0001-lead-intake-and-assignment.md), [ADR-0019](../adr/0019-manual-assignment-overrides.md), [ADR-0020](../adr/0020-serialize-duplicate-matching-across-queue-and-leads.md)

## 1. Summary

This amendment proposes two changes to RFC-0001: provide manual assignment and reassignment controls alongside automatic round-robin assignment, and serialize duplicate matching across queued and assigned leads. It addresses the take-home brief's assignment workflow and closes a concurrency gap in the duplicate policy.

## 2. Assignment Overrides

Automatic round-robin remains the default. The live board can assign any queued lead, including a parked lead, to an online agent. The lead detail view can reassign an assigned lead to a different online agent. Offline agents are not valid manual targets.

Each operation is one transaction. It locks the target queue row or lead row, then locks the single `assignment_state` row before allocating a sequence number. Assignment of a queued lead creates the assigned lead, contacts, initial status history, assignment event, and recipient notification, then removes the queue row. Reassignment updates only the current owner and appends an event; it preserves status and notes and notifies the new owner.

Events use `reason = 'manual'` for a queue assignment and `reason = 'reassigned'` for an owner change. `previous_agent_id` is null for a first assignment and contains the old owner for a reassignment. `assigned_by` contains the selected act-as-agent ID; because the assessment has no authentication, this is attribution only and is not a trusted security principal.

Both manual paths increment `assignment_state.last_sequence_no` and set `last_assigned_agent_id` to the recipient. The next automatic assignment starts after that recipient in the stable agent order. Each assignment and its notification remain atomic.

## 3. Duplicate-Safe Intake

Phone and email can exist in `lead_queue` before assignment and in `lead_contacts` afterward. Per-table unique constraints do not prevent two concurrent requests from placing the same identifier in different tables.

Intake inserts, queued-identifier fills, and duplicate-driven identifier attachments therefore go through one transactional database function. Before searching for matches, it builds typed lock keys for the exact external lead ID, normalized phone, and lowercased email supplied in the request. It sorts those keys deterministically and takes a transaction-scoped advisory lock for each key. The locks remain held through the lookup and any insert or identifier attachment.

With the locks held, the function searches both queued and assigned records and applies RFC-0001 / ADR-0017 duplicate-selection behavior. A queue-to-lead promotion atomically transfers existing identifiers without creating new ones. If a duplicate request waits while that row is promoted, and its attempt to fill the queue row finds it gone, the intake function rechecks the assigned lead and attaches the identifier there. Existing per-table uniqueness constraints remain as secondary safeguards. The app must not bypass the function for intake or duplicate-driven identity changes.

## 4. Verification Scenarios

1. Assign a queued lead manually; confirm the queue row is removed, the assigned lead and initial status exist, one `manual` event and notification are written, and the pointer advances to the selected agent.
2. Reassign an existing lead; confirm the owner changes, one `reassigned` event records the old owner, the new owner receives a notification, and status and notes are unchanged.
3. Attempt manual assignment to an offline agent; confirm it is rejected without changing the queue, lead, event feed, or pointer.
4. Submit concurrent requests with the same external ID, normalized phone, or lowercased email; confirm they resolve to one queued or assigned lead and do not create a second assignment.
5. Submit phone and email values that match different existing leads; confirm the existing older-lead conflict rule is applied and logged.
6. Promote a queued lead while a duplicate request arrives; confirm the identifier remains discoverable as either the queued or assigned record and only one lead is created.
7. Attach a previously missing email while the matching queue row is promoted; confirm the email is attached to the resulting assigned lead, with no lost identifier or duplicate lead.

## 5. Scope and Follow-Up

These are proposed changes, pending acceptance of ADR-0019 and ADR-0020. The assignment actor remains simulated until real authentication is added. Advisory locks protect writes that follow the database function contract; if independent writers are introduced, revisit a shared identifier registry with declarative uniqueness.