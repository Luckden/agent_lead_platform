# ADR-0016: Writes go through Next.js API routes; the browser only reads, via Realtime

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
The UI needs to show data live (ADR-0014) and make changes (presence toggle, status update, notes). The browser could talk to Supabase directly, which needs row-level security (RLS) on every table, or go through the server.

## Decision
- **All writes** (presence toggle, status change, notes, queue reset) go through Next.js API routes that use the Supabase service role key on the server, with Zod validation.
- **Reads for the live board** use the Supabase anon key in the browser, limited to Realtime subscriptions and selects on `agents`, `lead_queue`, `assignment_events`, `notifications`, and `leads`. RLS is enabled on every table with read-only (`SELECT`) policies for those tables and no insert, update, or delete policy.
- `webhook_events` and the raw payloads have no browser access.

## Consequences
- The service role key never reaches the browser, and a user with the anon key cannot change data.
- The RLS policies are small and uniform (select only), but they must exist or Realtime shows nothing.
- Anyone with the anon key can read lead names and contact details in this version. The README notes that production would add real authentication and per-user policies.
- Adds `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the env example (see ADR-0013).

## Alternatives considered
Browser writes directly to Supabase with RLS (fewer routes, but more policy surface to get right); server-sent events from Next.js (keeps the browser off Supabase entirely, but is more code than Realtime).
