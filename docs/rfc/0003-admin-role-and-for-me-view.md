# RFC-0003: Admin Role for Overrides and a "For me" View

- **Status:** Accepted
- **Date:** 2026-11-02
- **Related:** [RFC-0002](0002-assignment-overrides-and-duplicate-safety.md), [ADR-0021](../adr/0021-admin-role-gate-for-overrides.md), [ADR-0022](../adr/0022-for-me-view.md)

## 1. Summary

Two small UI-level changes. First, "Act as" gains an **Admin** entry, and only Admin can assign or reassign leads. Second, the Notifications tab becomes **For me** and shows the acting agent's notifications and their own leads.

## 2. Motivation

RFC-0002 let any acting agent override assignment. In practice assignment is an operator task, and agents should only work the leads they hold. Separately, the Notifications tab does not show what an agent actually owns.

## 3. Admin role

"Act as" lists Admin first, then the agents. Admin is not an agent: it receives no leads, takes no part in round-robin and has no presence toggle. Choosing Admin sets `actorRole = "admin"`; choosing an agent sets `"agent"`.

`POST /api/queue/:id/assign` and `POST /api/leads/:id/reassign` accept `actorRole` and answer 403 unless it is `"admin"`. The assign and reassign controls are hidden for agents. All other actions (status, notes, presence, retry, mark read) are open to any actor. There is no RBAC, no role storage and no authentication; the role is self-declared and the check only prevents accidental use. Events from admin overrides record `assigned_by = NULL` with a new `assigned_by_admin = true` flag. See ADR-0021.

## 4. "For me" view

The tab shows, for the selected agent, **My notifications** (existing list and mark-all-read) and **My leads** (leads currently owned, with status and the existing detail panel). With Admin selected it shows a prompt to pick an agent. The all-leads view stays on the Leads tab. No new endpoints. See ADR-0022.

## 5. Schema and API changes

- Migration (a new file, per the CI workflow): `alter table assignment_events add column assigned_by_admin boolean not null default false`; `manual_assign` and `reassign_lead` take an admin flag instead of an agent ID for `assigned_by`.
- Routes: add `actorRole` to the two override request bodies; return 403 otherwise.
- UI: dropdown entry, hidden controls, renamed tab with two sections.
- Docs: README endpoint table and Known gaps; ERD column; ADR index.

## 6. Verification scenarios

1. As an agent, the assign and reassign controls are not shown, and a direct `POST` without `actorRole: "admin"` returns 403 with no change to leads, events or pointer.
2. As Admin, assign a queued lead and reassign an assigned lead; each writes one event with `assigned_by_admin = true` and `assigned_by` null, and the pointer still moves to the recipient.
3. Admin does not appear in round-robin, in the agent ring or in presence toggles.
4. As Agent A, "For me" lists only A's notifications and leads; reassigning a lead from A to B moves it out of A's "My leads" and into B's, with a notification for B.
5. As Admin, "For me" shows the prompt and no badge.
6. Status changes and notes still work for any actor.

## 7. Scope and follow-up

Not authentication or authorization. Before real use, replace the self-declared role with authenticated identity and enforce the check from it (this supersedes the shallow gate in ADR-0021).

## 8. Open questions

- Should Admin also be allowed to toggle agent presence, or stay open to everyone as today? Proposed: unchanged.
