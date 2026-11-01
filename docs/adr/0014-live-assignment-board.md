# ADR-0014: Live assignment board as the main screen

- **Status:** Accepted (automatic-only rule superseded by ADR-0019)
- **Date:** 2026-10-30

## Context
The brief asks for an interface where leads can be viewed and assignment is visible, and for a design that shows how round-robin and online/offline behaviour work. A reviewer needs to see the assignment logic happen, not read a table afterwards.

## Decision
- The main screen is a live assignment board. The top half holds two lists side by side: on the left the **agent ring** (agents in `sort_order`, with online/offline state and a marker on the last-assigned agent), on the right the **lead queue** (`lead_queue`, oldest first, including parked leads). The bottom half is the **assignment record feed**: `assignment_events` newest first, with lead, agent, sequence number, and time.
- The board updates without a page refresh, using Supabase Realtime change subscriptions on `agents`, `lead_queue`, and `assignment_events` (and `notifications` for the agent bell).
- Assignment is automatic only. There is no manual "assign to agent" action in this version, so `assignment_events.reason` is `auto` and nothing can override the round-robin order. Reassignment and manual assignment are listed as future work.
- A second screen lists assigned leads from `leads`, with a detail panel for status updates and notes.
- Presence is toggled from the agent list on the board.

## Consequences
- A reviewer can toggle agents and post leads with curl and watch the ring, the queue, and the feed react immediately.
- Removing manual assignment keeps the pointer logic simple (no question of whether a manual pick advances it).
- If the assignment brief is read as requiring a manual assign button, this ADR must be revisited.
- The browser needs read access to the subscribed tables (see ADR-0016).

## Alternatives considered
Polling every few seconds (simpler, but looks laggy and wastes requests); a plain lead table with an assign dropdown (does not show the round-robin working).
