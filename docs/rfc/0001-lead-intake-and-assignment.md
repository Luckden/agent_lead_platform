# RFC-0001: Incoming Lead API and Lead Management Mini System

- **Status:** Draft
- **Date:** 2026-10-30
- **Author:** (your name)
- **Related:** [ADR index](../adr/README.md), [ERD](../erd.mermaid)

## 1. Summary

Build a small system that receives leads from an external source over HTTP, stores them in Supabase (Postgres), queues each lead and assigns it to an online agent in round-robin order, notifies the agent, and gives internal users a simple UI to view and manage leads.

## 2. Background

A property agency receives enquiries (for example from Facebook Ads). Each enquiry only has value if an agent follows up quickly. Today the risk is that leads get lost, sit with agents who are away, or are distributed unevenly. This system captures every lead, assigns it fairly to whoever is available, and keeps an audit trail.

## 3. Goals and non-goals

**Goals**
- Accept lead payloads at `POST /api/leads/incoming`, with token auth, validation, and duplicate handling.
- Persist leads, agents, status history, assignments, raw payload logs, and notifications in Supabase.
- Assign in round-robin order across online agents, skipping offline agents, and keep the order stable as agents come and go.
- Provide a simple UI centred on a live assignment board (agent ring, lead queue, and assignment feed updating in real time), plus a lead list and detail view with status updates and notes.
- Document the design so it can be reviewed and discussed.

**Non-goals**
- Production-grade authentication, scaling, or high availability.
- Real Facebook webhook integration (a small adapter would translate Facebook's format to ours).
- Caching, external queue infrastructure (the queue is a Postgres table), manual assignment, or a metrics dashboard.

## 4. Proposed design

### 4.1 Architecture

Single Next.js (TypeScript) app with three layers, backed by hosted Supabase.

| Layer | Responsibility |
|-------|----------------|
| API routes | Thin: check token, validate payload (Zod), call the service layer, shape the response |
| Service layer | Normalize contact data, detect duplicates, write the raw log, call the assignment function |
| Postgres (Supabase) | Tables plus one SQL function that performs assignment atomically |
| React UI (DaisyUI) | Live assignment board, lead list/detail, notification list. Writes go through the API routes; the board reads through Supabase Realtime with the anon key and read-only RLS (ADR-0016) |

### 4.2 Data model

Plural snake_case table names. Full diagram: [erd.mermaid](../erd.mermaid).

| Table | Purpose |
|-------|---------|
| `lead_queue` | Incoming leads waiting for assignment, with retry fields (`attempts`, `next_attempt_at`, `parked_at`, `last_error`); the only place an unassigned lead lives |
| `leads` | Assigned leads only; current status (not null), current owner (not null), and a single `notes` text field |
| `lead_contacts` | People on a lead (one lead has many; each belongs to one lead), with normalized phone and lowercased email |
| `agents` | Agent info, `is_online`, `last_seen_at`, fixed `sort_order` for round-robin |
| `assignment_events` | Append-only history of every assignment (`sequence_no`, `reason`, previous agent) |
| `assignment_state` | Single row: last assigned agent and last sequence number |
| `lead_status_history` | Append-only: the status a lead entered, who changed it, when |
| `webhook_events` | Raw payload of every incoming request, with outcome |
| `notifications` | One record per assignment, for the receiving agent |

### 4.3 Incoming API contract

`POST /api/leads/incoming`, header `Authorization: Bearer <INCOMING_API_TOKEN>`.

Request body (from the brief):

```json
{
  "leadId": "LD1001",
  "name": "John Tan",
  "phone": "0123456789",
  "email": "john@email.com",
  "source": "Facebook Ads",
  "project": "Residensi Mutiara",
  "budget": 650000,
  "message": "Interested in 3-bedroom unit",
  "createdAt": "2026-04-20T10:30:00Z"
}
```

Validation rules (assumptions):
- Required: `leadId`, `name`, and at least one of `phone` or `email`.
- Optional: `source`, `project`, `budget`, `message`, `createdAt` (ISO 8601).
- Unknown fields are kept in the raw log and otherwise ignored.
- Phone is normalized by stripping non-digits; email is lowercased.

Responses:

| Code | Meaning | Body |
|------|---------|------|
| 201 | Lead assigned immediately | `leadId`, `assignedAgentId`, `status` |
| 202 | Lead accepted and queued (no agent online) | `leadId`, `queued: true` |
| 200 | Duplicate; no new lead, no reassignment | `duplicate: true`, existing `leadId` |
| 400 | Invalid or incomplete payload | field-level errors |
| 401 | Missing or wrong token | error message |
| 500 | Unexpected error | generic message, logged |

Every request, including 400 and 401, writes a `webhook_events` row.

### 4.4 Duplicate handling

A lead is a duplicate if its `leadId` already exists, or its normalized phone or email matches a `lead_contacts` row or a `lead_queue` row. A duplicate does not create a new lead and does not trigger a new assignment. The raw payload is logged, and the existing lead ID is returned. Identifiers that no lead holds yet are attached to the existing lead; if phone and email match two different leads, the older one is used and the conflict is logged (ADR-0017).

### 4.5 Assignment

Round-robin by a stable order, with the pointer stored in the database. Every valid lead is inserted into `lead_queue`, then the assignment function runs.

1. Claim the oldest `lead_queue` row (`FOR UPDATE SKIP LOCKED`) and lock the `assignment_state` row (`SELECT ... FOR UPDATE`) so concurrent leads are serialized.
2. Select online agents ordered by `sort_order`. Choose the first whose `sort_order` is greater than the last assigned agent's, wrapping to the first online agent if none.
3. If no agent is online, leave the lead in the queue (see below) and return.
4. In one transaction: insert the `leads` row with `assigned_agent_id` and `status = 'assigned'` and its `lead_contacts`, insert the `assignment_events` row (`sequence_no` = last + 1, `reason = 'auto'`), insert the first `lead_status_history` row, insert the `notifications` row, update `assignment_state`, delete the `lead_queue` row.

Because the pointer is "who got the last lead", not a list index, agents can go offline and come back without breaking the order. A returning agent is picked up the next time the order reaches them.

**Lead queue.** A lead with no available agent stays in `lead_queue`, oldest `created_at` first. The assignment function is re-run when an agent goes online, and by a periodic sweep as a backstop, until the queue is empty or nobody is online. "No agent online" is not a failure. If the function errors, the transaction rolls back, the lead remains queued, and it is retried with backoff and parked after 5 failed attempts. A `pg_cron` sweep every minute is the backstop (ADR-0015). Because a `leads` row exists only after successful assignment, `leads.status` and `leads.assigned_agent_id` are never null.

### 4.6 Presence

`agents.is_online` is flipped by a UI toggle (simulated login/logout). `last_seen_at` is updated on toggle. Going offline only stops new assignments; the agent keeps the leads they already have (ADR-0010). A heartbeat that auto-marks agents offline after inactivity is a bonus, not required.

### 4.7 Status and notes

Statuses (assumption): `assigned`, `contacted`, `qualified`, `closed`. A lead's first status is `assigned`, written by the assignment function; there is no `new` or null status. Each change appends a `lead_status_history` row. Notes are a single text field on `leads`, a deliberate simplification.

### 4.8 Notifications

A notification row is created in the same transaction as each assignment and linked to the `assignment_events` row. Notifications are in-app only, pushed to the UI through Realtime; the UI lists unread notifications for the agent chosen in the "act as agent" dropdown (no login; ADR-0010).

### 4.9 UI scope

Using DaisyUI components (ADR-0014):

- **Live board (home):** top half has two side-by-side lists, the agent ring (order, online/offline toggle, last-assigned marker) on the left and the lead queue (including parked leads) on the right. The bottom half is the assignment record feed, newest first. All three update live.
- **Leads:** table of assigned leads with status and owner, and a detail panel for status updates and notes.
- **Notifications:** unread list for the selected agent.

There is no manual assign action; assignment is automatic only.

### 4.10 Security and secrets

Secrets (Supabase URL, service role key, incoming API token) live in an env file that is git-ignored; an example file with placeholders is committed. The service role key is used only in server code, never exposed to the browser. Schema ships as SQL migrations so a reviewer can apply it to their own Supabase project.

## 5. Alternatives considered

See the ADRs for detail: building on an existing CRM (ADR-0001), contacts as a child of leads rather than many-to-many (ADR-0003), a lead queue instead of null status (ADR-0006), a queue timestamp instead of a pointer (ADR-0005), separate notes table (ADR-0008), polling instead of Realtime and manual assignment (ADR-0014), browser writes with RLS (ADR-0016).

## 6. Edge cases

| Case | Behavior |
|------|----------|
| Same `leadId` sent twice (retry) | Treated as duplicate, returns existing lead |
| Same person, different message | Duplicate by phone/email (in `lead_contacts` or `lead_queue`); logged, not reassigned |
| Missing phone but valid email | Accepted |
| Messy phone format | Normalized before matching |
| Two leads arrive simultaneously | Serialized by the row lock; no double pick |
| No agents online | Lead stays in `lead_queue` (202); assigned when an agent comes online or the sweep runs |
| Agent goes offline mid-cycle | Skipped on next pick; existing leads stay with them |
| Pointer agent no longer exists or offline | Next online agent in order is chosen |
| Agent deleted | Blocked while any lead, event, notification, or pointer references them |
| Agent goes offline holding leads | Leads stay with them; no reassignment |
| Phone matches one lead, email another | Older lead returned and extended; conflict logged |
| Assignment function keeps failing for one lead | Retried with backoff, parked after 5 attempts, shown as "Needs attention" |

## 7. Testing plan

Use a script or curl against localhost, with seeded agents A, B, C, D.

1. A, B, C online: leads 1, 2, 3 go to A, B, C.
2. D comes online: lead 4 goes to D, then lead 5 to A.
3. B goes offline: next leads cycle A, C, D only.
4. B returns: B is included again in order.
5. All offline: lead stays in `lead_queue` (202); set one agent online and confirm the lead moves to `leads` and the queue row is gone.
6. Duplicate phone/email and duplicate `leadId`, including one still in the queue: no new lead, 200 response.
7. Invalid payload and bad token: 400 and 401, both logged in `webhook_events`.
8. Queue retry: force the function to fail on one lead; confirm backoff, parking after 5 attempts, and that other leads still assign.
9. Concurrency: fire 10 leads in parallel at 5 online agents; each agent gets exactly 2.

## 8. Bonus prioritization

Chosen: Supabase Realtime for the live board and notifications (core to ADR-0014), retry handling with parking (ADR-0015). If time permits: heartbeat presence (explains offline detection). Deliberately skipped: caching (assignment state must be consistent), external queue infrastructure, Terraform.

## 9. Open questions

- Pointer versus "oldest last-assigned" queue for round-robin (ADR-0005 is Proposed).
- Duplicate response code: 200 with `duplicate: true` versus 409 (ADR-0011).
- Should a duplicate's new message be appended to `leads.notes`?
- Is the periodic sweep wanted, or are the new-lead and agent-online triggers enough (ADR-0015)?
- Is "no manual assignment" acceptable for the brief's "assign a lead to an agent" requirement (ADR-0014)?

## 10. Deliverables checklist

- [ ] Source code
- [ ] README with setup and test steps
- [ ] SQL schema and seed script
- [ ] Flowchart
- [ ] ERD (`docs/erd.mermaid`)
- [ ] API endpoint list
- [ ] Assumptions and design decisions (this RFC and the ADRs)
- [ ] Test notes showing round-robin and online/offline behavior
