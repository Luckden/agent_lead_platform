# ADR-0005: Round-robin using a stored pointer and a locked SQL function

- **Status:** Accepted (pointer statement amended by ADR-0019: manual assignments also move the pointer)
- **Date:** 2026-10-30

## Context
The agent list changes as agents go online and offline, so a fixed array index is unreliable. Two leads arriving together must not go to the same agent.

## Decision
- Agents have a fixed `sort_order`.
- `assignment_state` (single row) stores `last_assigned_agent_id` and `last_sequence_no`.
- A Postgres function locks that row (`SELECT ... FOR UPDATE`), picks the first online agent after the last assigned one by `sort_order` (wrapping around), and writes the assignment, status history, notification, and new pointer in one transaction.

## Consequences
- Offline agents are skipped; returning agents rejoin at their place in the order.
- Concurrent leads are serialized by the lock.
- The README must state how skipped agents are treated (they keep their place in the order, they do not go to the back).
- There is no manual assignment in this version (ADR-0014), so only automatic assignments move the pointer.

## Alternatives considered
- **`last_assigned_at` queue on `agents`:** pick the online agent with the oldest timestamp. Removes `assignment_state` and is easy to explain, but a long-offline agent returns and receives the next lead to "catch up". Rejected for the reason above.
- **Index-based rotation in application code:** breaks when the agent list changes and is not safe under concurrency.
