# ADR-0022: "For me" view replaces the Notifications tab

- **Status:** Accepted
- **Date:** 2026-11-02
- **Related:** [RFC-0003](../rfc/0003-admin-role-and-for-me-view.md), [ADR-0009](0009-notifications-triggered-by-assignment-events.md), [ADR-0016](0016-ui-data-access.md), [ADR-0021](0021-admin-role-gate-for-overrides.md)

## Context
The Notifications tab shows the acting agent's notifications only, and the full lead list is on a separate tab. An agent who wants to see what is theirs has to combine the two. The owner wants one place that is about "me".

## Decision
- Rename the **Notifications** tab to **For me**. It has two sections for the agent selected in "Act as":
  1. **My notifications**: the existing list and mark-all-read action, unchanged.
  2. **My leads**: the leads whose `assigned_agent_id` is the acting agent, newest assignment first, with status and a link to the same detail panel used on the Leads tab (status change and notes remain available).
- The tab badge keeps showing the unread notification count.
- When the actor is Admin there is no personal data: the tab shows a short prompt to pick an agent in "Act as" and the badge is hidden.
- No new tables, endpoints or Realtime subscriptions. "My leads" filters the lead list the dashboard already loads and stays current through the existing debounced refetch (ADR-0016). The Leads tab stays as the all-leads view.

## Consequences
- An agent sees new assignments and the leads they own together.
- A lead reassigned away disappears from "My leads" on the next refetch; its notification stays in history.
- The filter runs in the browser over the already-loaded list. If the list grows beyond what the UI loads, push the filter into the query.

## Alternatives considered
- Keep Notifications and add a separate "My leads" tab (two tabs for one concept).
- Add a filter chip on the Leads tab only (leaves notifications separate).
- A dedicated per-agent query and Realtime channel (more moving parts than the data size needs).
