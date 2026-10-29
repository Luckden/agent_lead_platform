# ADR-0010: Presence via a manual online flag; heartbeat as a bonus

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
The brief allows simulated presence (seeded data, admin buttons, or a local script). "Logged in" (identity) and "online" (available for leads) are separate concepts.

## Decision
- `agents.is_online` and `last_seen_at`, changed by a UI toggle.
- Optional bonus: the browser sends a heartbeat every ~30 seconds; an agent with no heartbeat for ~90 seconds is treated as offline. Supabase Realtime presence is an alternative.
- **Leads stay with the agent who received them when that agent goes offline.** Offline only removes the agent from future assignments; their existing leads are not returned to the queue or reassigned.
- Identity: an "act as agent" dropdown selects which agent the UI is acting for (bell, presence toggle). There is no login and no Supabase Auth in this version.

## Consequences
- Simple and testable for the assessment.
- An agent who is offline for a long time keeps their leads until a person acts; reassignment is future work (ADR-0014).
- The README states the production gaps: auto-offline after inactivity and real authentication, replacing the dropdown with Supabase Auth linked to agent rows (an enterprise identity provider such as Entra could be plugged in through Supabase SSO).
