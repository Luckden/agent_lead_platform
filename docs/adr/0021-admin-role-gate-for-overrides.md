# ADR-0021: Shallow admin role gate for assignment overrides

- **Status:** Accepted
- **Date:** 2026-11-02
- **Related:** [RFC-0003](../rfc/0003-admin-role-and-for-me-view.md), [ADR-0010](0010-presence-tracking.md), [ADR-0019](0019-manual-assignment-overrides.md)

## Context
ADR-0019 lets whoever is selected in the "Act as" dropdown assign or reassign leads, and ADR-0010 makes that dropdown a list of agents. Any agent can therefore move any lead. The owner wants only an admin to do that. The assessment still has no authentication, so this has to stay a lightweight convention, not an access-control system.

## Decision
- Add one fixed entry, **Admin**, to the "Act as" dropdown. It is not a row in `agents`, does not receive leads, and has no presence toggle. The other entries remain the agents.
- The UI sends the selected actor as `actorRole`: `"admin"` or `"agent"`. The two override routes (`POST /api/queue/:id/assign`, `POST /api/leads/:id/reassign`) return **403** unless `actorRole === "admin"`. This is the whole check (`if (role !== "admin") reject`). No roles table, permissions or middleware.
- The UI hides the assign and reassign controls when the actor is not Admin. The server check exists so a direct API call is also refused, but because the role is self-declared it is a guard against mistakes, not a security boundary.
- Everything else is unchanged for every actor: status changes, notes, presence toggles, retry of parked leads, and reading notifications.
- Attribution: `assignment_events.assigned_by` stays a nullable agent reference. Add `assignment_events.assigned_by_admin boolean not null default false`, set to true for admin overrides. Admin actions therefore have `assigned_by = NULL` and `assigned_by_admin = true`, which separates them from automatic assignments (`assigned_by = NULL`, flag false). Recording the acting agent in `assigned_by` ends for new events because agents can no longer perform overrides.
- The selection is stored in localStorage as today; the default for a new browser is Admin so the board is usable on first load.

## Consequences
- Matches the requested rule with about one condition per route and one dropdown entry.
- Not real authorization: anyone can send `actorRole: "admin"`. This is acceptable for the assessment and must be replaced by authenticated identity before any real use. The README's Known gaps section should say so.
- Existing events remain valid; old rows with a non-null `assigned_by` are historical agent overrides.
- Manual assign and reassign tests need an admin flag argument and a 403 case.

## Alternatives considered
- Full RBAC with roles and permissions tables (explicitly out of scope).
- Make one of the agents an admin (mixes the assignee list with an operator concept and makes round-robin eligibility ambiguous).
- Only hide the buttons in the UI (simplest, but a direct API call would still succeed).
