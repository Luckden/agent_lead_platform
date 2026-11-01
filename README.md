# Incoming Lead API + Lead Management Mini System

A Next.js (TypeScript) app on Supabase (Postgres). It receives leads at `POST /api/leads/incoming`, queues them,
assigns them round-robin to online agents, notifies the agent, and shows everything on a live board.

- Code: [`app/`](app/) (app-level notes in [`app/README.md`](app/README.md))
- Design: [RFC-0001](docs/rfc/0001-lead-intake-and-assignment.md), [RFC-0002](docs/rfc/0002-assignment-overrides-and-duplicate-safety.md), [ADRs](docs/adr/README.md)
- Diagrams: [flowchart](docs/flowchart.mermaid), [ERD](docs/erd.mermaid)

## Setup

1. Create a Supabase project.
2. In the SQL editor run each file in `app/supabase/migrations/` in order, then `app/supabase/seed.sql`
   (agents A–D; A, B, C online, D offline).
3. In `app/`: copy `.env.example` to `.env.local` and fill in the project URL, anon key, service role key and a
   value for `INCOMING_API_TOKEN` (any secret string you choose).
4. `cd app && npm install && npm run dev`, then open http://localhost:3000.

## API endpoints

| Method and path | Purpose |
|---|---|
| `POST /api/leads/incoming` | Receive a lead. Header `Authorization: Bearer <INCOMING_API_TOKEN>`. 201 assigned, 202 queued (no agent online), 200 duplicate, 400 invalid, 401 bad token, 500 error. Every request is logged in `webhook_events`. |
| `PATCH /api/agents/:id/presence` | `{ "isOnline": true }`. Going online assigns any waiting leads. |
| `POST /api/queue/:id/assign` | `{ agentId, actorRole }`, admin only (403 otherwise). Manually assign a queued or parked lead (409 if the agent is offline). |
| `POST /api/queue/:id/reset` | Return a parked lead to the queue. |
| `POST /api/leads/:id/reassign` | `{ agentId, actorRole }`, admin only (403 otherwise). Move a lead to another online agent; status and notes stay. |
| `PATCH /api/leads/:id/status` | `{ status }`: `assigned`, `contacted`, `qualified`, `closed`. |
| `PATCH /api/leads/:id/notes` | `{ notes }`. |
| `POST /api/notifications/read` | `{ agentId }`. Mark that agent's notifications read. |
| `POST /api/sweep` | Runs the assignment sweep (for projects without `pg_cron`). |

Example (the brief's sample payload; the token header is required):

```bash
curl -X POST http://localhost:3000/api/leads/incoming \
  -H "Authorization: Bearer $INCOMING_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"leadId":"LD1001","name":"John Tan","phone":"0123456789","email":"john@email.com","source":"Facebook Ads","project":"Residensi Mutiara","budget":650000,"message":"Interested in 3-bedroom unit","createdAt":"2026-04-20T10:30:00Z"}'
```

## How round-robin and presence work

- Agents have a fixed `sort_order`. A single-row `assignment_state` table stores the agent who received the most
  recent lead. The next lead goes to the first **online** agent after that one in `sort_order`, wrapping around.
- Because the pointer is "who got the last lead" rather than a list position, an agent who goes offline is skipped
  and keeps their place; when they come back, they are picked up when the order next reaches them.
- Assignment is one Postgres function holding a row lock, so two simultaneous leads cannot pick the same agent.
  Lead, contacts, status history, assignment event, notification and pointer are written in one transaction.
- Presence is the `agents.is_online` flag, flipped by the toggle on the board (simulated login/logout). Going offline
  only stops new assignments; the agent keeps the leads they hold.
- If nobody is online, the lead waits in `lead_queue` (202) and is assigned as soon as an agent comes online.
  A row that keeps failing is retried with backoff and parked after 5 attempts ("Needs attention" on the board).
- Manual assignment and reassignment are operator overrides. They also move the pointer to the recipient.

## Assumptions

Required fields are `leadId`, `name` and a phone or email. Phone is stored as digits only and email lowercased.
A duplicate (same `leadId`, phone or email, in the queue or on an assigned lead) returns 200 and creates no new
lead or assignment; identifiers the existing lead lacks are attached to it. All online agents are eligible.
"Act as agent" replaces login; there is no authentication. See the [ADRs](docs/adr/README.md) for the rest.

## Testing steps

Start the app, make sure A, B, C are online and D is offline (use the toggles on the live board), then post leads
with the curl command above, changing `leadId` and `phone` each time.

1. Post leads 1–3: they go to A, B, C in that order (watch the assignment record on the board).
2. Switch D online and post lead 4: it goes to D. Lead 5 goes to A.
3. Switch B offline and post three leads: they go only to C, D, A (B is skipped).
4. Switch B online: B is included again when the order reaches it.
5. Switch everyone offline and post a lead: response is 202 and it shows in the queue. Switch one agent online:
   the lead is assigned and leaves the queue.
6. Post the same `leadId`, phone or email again: 200 with `"duplicate": true`, no new assignment.
7. Post `{}` or use a wrong token: 400 / 401. Both appear in `webhook_events`.
8. On the Leads tab, open a lead, change its status, add a note and reassign it to another online agent.

Automated:

```bash
cd app
npm run test:sql   # the scenarios above, plus manual assign/reassign, conflicts and retry/parking
npm run smoke      # against a running app: 401, 400, duplicate, 10 parallel leads
npm run demo       # sends 20 leads, one per second, to watch the board live
```

## Test notes (what was actually run)

- `npm run test:sql`: 11 tests pass on an in-process Postgres (PGlite). They cover round-robin A, B, C then D;
  skipping and rejoining B; queueing with nobody online and draining on an agent coming online; duplicates by
  `leadId`, phone and email; the older-lead conflict rule; identifier attach after promotion; manual assign,
  offline rejection and reassignment (status and notes preserved); backoff, parking after 5 failures and reset.
- Against the real Supabase project: four test leads went to three online agents in rotation (201). A 20-lead
  run (`npm run demo`) accepted all 20 while agents were switched on and off: leads sent while nobody was online
  returned 202 and were assigned as agents came online.
- In the browser: toggling presence, live updates of the feed and notification badge, status change, saving notes
  and reassigning a lead were all checked on the running UI.
- `npm run smoke` against the real project: 401, 400 and duplicate checks passed, and 10 parallel leads with two
  agents online all returned 201 and split 5 and 5 (no lost or double assignment).
- Not tested: the `pg_cron` sweep (it may not exist on every plan; `POST /api/sweep` is the alternative).

## Known gaps

No real authentication (the act-as dropdown and its Admin role are self-declared; the admin check on assign/reassign only prevents mistakes), one static bearer token with no rate limiting,
anyone holding the anon key can read lead contact details, and no heartbeat-based auto-offline.
