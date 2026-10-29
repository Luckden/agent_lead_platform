# ADR-0001: Build a custom lead system instead of adopting an existing CRM

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
Open-source CRMs (Odoo, SuiteCRM, EspoCRM, Twenty, Frappe CRM) already handle leads, statuses, notes, and assignment. The brief requires Supabase as the database, a self-designed schema and ERD, and custom round-robin with presence logic.

## Decision
Build a small custom system. Use existing CRMs only as reference for how they model leads and assignments.

## Consequences
- The schema, assignment logic, and presence tracking are our own design and can be explained end to end.
- No fighting a CRM's own data model or database (Odoo runs on its own PostgreSQL).
- More code to write than configuring an existing product.

## Alternatives considered
- **Adopt Odoo and add a layer on top:** conflicts with the Supabase requirement and hides the design work being assessed.
- **Port an existing app from another project:** acceptable for generic scaffolding only, not for the core logic.
