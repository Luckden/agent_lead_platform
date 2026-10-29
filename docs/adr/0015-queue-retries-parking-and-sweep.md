# ADR-0015: Queue retries with backoff, parking after repeated failures, and a periodic sweep

- **Status:** Proposed
- **Date:** 2026-10-30

## Context
ADR-0006 puts every incoming lead in `lead_queue` and assigns it through a SQL function. Two things can leave a lead sitting there: no agent is online (normal), or the function fails (an error). They need different handling, and something must re-run the function when no event triggers it.

## Decision
- **No agent online is not a failure.** The lead stays queued, `attempts` does not increase, and the function is re-run when an agent goes online.
- **Function errors are failures.** On an error, the row is released, `attempts` increases, `last_error` is stored, and `next_attempt_at` is set with exponential backoff (30 seconds, 1, 2, 4 minutes).
- After **5 failed attempts** the row is **parked** (`parked_at` set). Parked leads are skipped by retries, shown on the board as "Needs attention", and returned to the queue only by a manual reset.
- **Sweep.** A scheduled job (Supabase `pg_cron`, every minute) calls the assignment function for queued, non-parked rows whose `next_attempt_at` is due. It is a backstop for missed triggers, such as a crashed request or an agent flipped online directly in the database. With the other triggers (new lead, agent online) it is enough; there is no external queue service.

## Consequences
- A bad row cannot block the queue or retry forever, and nothing is silently dropped.
- Retry handling is covered, one of the brief's bonus items, without extra infrastructure.
- `lead_queue` gains `next_attempt_at`, `parked_at`, and `last_error`.
- If `pg_cron` is unavailable on the reviewer's Supabase plan, the README documents running the sweep from a script or a Next.js cron route instead.
- The sweep can be dropped if a reviewer prefers fewer moving parts; the other two triggers still assign leads.

## Alternatives considered
Retrying forever with no cap (hides bad data); an external queue such as Redis or SQS (more to run, no benefit at this scale); no sweep at all (simplest, but a missed trigger leaves leads stuck until the next agent event).
