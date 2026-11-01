# ADR-0017: Duplicate matching links phone and email to one lead

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
ADR-0011 treats a matching phone or email as a duplicate. With phone and email unique in `lead_contacts` (ADR-0003), a payload can carry a phone that belongs to one lead and an email that belongs to another, or a known phone with a new email. The system needs one rule for these.

## Decision
- A payload is a duplicate if its `leadId`, normalized phone, or lowercased email matches a `lead_contacts` row or a `lead_queue` row.
- The existing lead is returned, with no new lead and no new assignment (ADR-0011).
- Any identifier in the payload that no lead holds yet (for example a new email for a known phone) is **attached to the existing lead**, so later enquiries with that identifier also match it.
- If the phone matches one lead and the email another, the **older lead** (earlier `created_at`) is the one returned and extended. The two existing leads are not merged; the conflict, with both lead IDs, is recorded in `webhook_events.error_message`.
- A payload that matches a queued lead only fills in missing phone or email on the queue row.

## Consequences
- One person ends up as one lead, even when they use different contact details across enquiries.
- Merging two existing leads (moving history, events, and notes) is out of scope; the conflict log shows when it would be needed.
- A shared phone number (for example a family sharing one) would link unrelated people; this is accepted for the assessment.

## Alternatives considered
Create a new lead when only one identifier matches (breaks the one-person-one-lead rule); reject conflicting payloads with 409 (loses the lead).
