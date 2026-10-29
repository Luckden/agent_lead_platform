# ADR-0008: Notes as a single text column on `leads`

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
The brief asks for notes on a lead. A separate table gives per-note author and timestamp; a column is simpler. The goal is a clean, simple solution.

## Decision
Store internal notes in `leads.notes` (text). The customer's original text stays in `leads.message`; the two are never mixed. Status stays separate from notes, because a note can be added without a status change.

## Consequences
- Less schema and a simpler UI (one text box).
- Per-note author and timestamp are lost, and concurrent saves can overwrite each other.
- Documented in the README as a deliberate simplification; upgrading to a `lead_notes` table later is a small change.
