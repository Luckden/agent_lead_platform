# ADR-0003: Store people in `lead_contacts`, a child table of `leads`

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
A lead can involve more than one person (for example a couple buying together), so contact details cannot be a single set of columns on `leads`. Duplicates are detected by normalized phone or email, and a duplicate returns the existing lead instead of creating a new one. That means a given person always belongs to exactly one lead.

## Decision
One lead has many `lead_contacts`; each `lead_contacts` row belongs to exactly one lead (`lead_id` foreign key, not null). Each row holds `name`, normalized `phone`, and lowercased `email`. Phone and email are unique across the table, which is what duplicate detection relies on. `leads` holds the enquiry itself.

## Consequences
- Duplicate matching works on `lead_contacts.phone` and `lead_contacts.email`.
- One lead can have several contacts; one contact belongs to only one lead.
- No junction table and no separate `contacts` table, so one fewer table and join than a many-to-many design.
- A person who enquires again is a duplicate of their existing lead, not a new lead (see ADR-0011). If the business later wants one person to own several leads, this would need to change to a many-to-many design.
- Contacts are created only when the lead is created, which happens at assignment (see ADR-0006).

## Alternatives considered
A `contacts` table with a `lead_contacts` junction (many-to-many; more flexible, but it allows one person on several leads, which duplicate handling forbids); storing name, phone, and email directly on `leads` (only one contact per lead).
