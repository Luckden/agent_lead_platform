# Lead assignment app

Incoming lead API, round-robin assignment, and a live board. Design lives in `../docs`
(RFC-0001, RFC-0002, ADR-0001 to ADR-0020, ERD, flowchart).

## Setup

1. Create an empty Supabase project.
2. Apply the files in `supabase/migrations/` in order (SQL editor, or `supabase db push`),
   then `supabase/seed.sql` (agents A-D; A, B, C online).
3. `cp .env.example .env.local` and fill in the URL, anon key, service role key and `INCOMING_API_TOKEN`.
4. `npm install && npm run dev`, then open http://localhost:3000.

The service role key is used only in server code. The browser uses the anon key for selects and Realtime;
RLS has no write policies (ADR-0016).

Docker is optional: `docker build -t leads --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .`
then run with `SUPABASE_SERVICE_ROLE_KEY` and `INCOMING_API_TOKEN` as environment variables.

## API

| Method and path | Purpose |
|---|---|
| `POST /api/leads/incoming` | Bearer `INCOMING_API_TOKEN`. 201 assigned, 202 queued, 200 duplicate, 400 invalid, 401 unauthorized, 500 error. Every request is logged in `webhook_events`. |
| `PATCH /api/agents/:id/presence` | `{ isOnline }`. Going online drains the queue. |
| `POST /api/queue/:id/assign` | `{ agentId, actorRole }`, admin only (403 otherwise). Manual assignment of a queued or parked lead (409 if the agent is offline). |
| `POST /api/queue/:id/reset` | Return a parked lead to the queue. |
| `POST /api/leads/:id/reassign` | `{ agentId, actorRole }`, admin only (403 otherwise). Reassign to a different online agent; status and notes are kept. |
| `PATCH /api/leads/:id/status` | `{ status, changedBy? }`: `assigned`, `contacted`, `qualified`, `closed`. |
| `PATCH /api/leads/:id/notes` | `{ notes }`. |
| `POST /api/notifications/read` | `{ agentId }`. Mark all read. |
| `POST /api/sweep` | Bearer token. Runs the assignment sweep; for projects without `pg_cron`. |

```bash
curl -X POST http://localhost:3000/api/leads/incoming \
  -H "Authorization: Bearer $INCOMING_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"leadId":"LD1001","name":"John Tan","phone":"012-345 6789","email":"john@email.com","source":"Facebook Ads","project":"Residensi Mutiara","budget":650000,"message":"Interested in 3-bedroom unit","createdAt":"2026-04-20T10:30:00Z"}'
```

## How it works

All state changes are Postgres functions (`supabase/migrations`), called by the API routes with the service role:

- `intake_lead`: takes advisory locks on the lead ID, phone and email in sorted order, then matches against
  `lead_queue` and `lead_contacts` (ADR-0017, ADR-0020) and either queues the lead or returns the existing one.
- `assign_pending`: claims the oldest eligible queue row (`FOR UPDATE SKIP LOCKED`), locks `assignment_state`,
  picks the next online agent after the pointer by `sort_order`, and writes lead, contacts, status history,
  event, notification and pointer in one transaction. A failing row gets exponential backoff (30s, 1, 2, 4 min)
  and is parked after 5 failures (ADR-0015). No agent online is not a failure.
- `manual_assign`, `reassign_lead`: operator overrides (ADR-0019). They require an online target, advance the
  pointer to the recipient, and record `assigned_by` from the "Act as" dropdown. That field is attribution only,
  not authenticated identity.
- `set_agent_online`, `update_lead_status`, `reset_parked`: presence, status history, and un-parking.

An offline agent keeps their place in the order and their existing leads (ADR-0005, ADR-0010).
`pg_cron` runs `assign_pending()` every minute when the extension is available; otherwise call `POST /api/sweep`.

Deviations from the docs: `webhook_events.status` also allows `received` (interim) and `error`; the browser
also has read-only access to `lead_contacts`, `lead_status_history` and `assignment_state`, which the lead
list, detail panel and agent ring need.

## Tests

```bash
npm run test:sql   # SQL functions on an in-process Postgres (PGlite): round-robin, offline skipping,
                   # queue and drain, duplicates, conflicts, manual assign/reassign, retries and parking
npm run smoke      # against a running app and seeded Supabase: 401, 400, 200 duplicate, 10 parallel leads
```

`test:sql` is single-connection, so it cannot exercise concurrency; the parallel step in `smoke` does.

## Known gaps

No authentication (act-as dropdown with a self-declared Admin role), a single static bearer token without rate limiting, anyone with the anon
key can read lead contact details, and no heartbeat-based auto-offline.
