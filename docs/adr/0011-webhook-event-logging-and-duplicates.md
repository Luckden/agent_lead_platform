# ADR-0011: Log every incoming request; duplicates are not reassigned

- **Status:** Proposed
- **Date:** 2026-10-30

## Context
The brief requires raw payload logging for audit and graceful handling of invalid data and duplicates.

## Decision
- Every request writes a `webhook_events` row (`raw_payload`, `status` of accepted, invalid, duplicate, or unauthorized, `error_message`, optional `external_lead_id`, `received_at`), including invalid and unauthorized requests.
- Duplicates (same `leadId`, or matching normalized phone or email in `lead_contacts` or in `lead_queue`) create no new lead and trigger no new assignment. The response is 200 with `duplicate: true` and the existing lead ID (or the queued lead's external ID if it is still waiting).
- How a payload that matches one lead by phone and another by email is handled, and how new identifiers are attached, is in ADR-0017.
- Contact data is normalized before matching: non-digits stripped from phone, email lowercased.

## Consequences
- Retries are safe and idempotent.
- Troubleshooting is possible from the raw log even when a request was rejected.
- Open: whether to return 409 instead of 200, and whether a duplicate's new message should be appended to `leads.notes`.
