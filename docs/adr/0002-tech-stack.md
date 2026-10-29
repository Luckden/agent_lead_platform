# ADR-0002: Next.js, TypeScript, hosted Supabase, DaisyUI, Zod

- **Status:** Proposed
- **Date:** 2026-10-30

## Context
The brief's example uses `localhost:3000`, needs an API plus a simple UI, and requires Supabase. Reviewers must be able to run it locally from a README.

## Decision
- Next.js with API routes and TypeScript, one project for API and UI.
- Hosted Supabase (free tier) for Postgres; assignment logic in a SQL function.
- DaisyUI (Tailwind) components for the UI.
- Zod for payload validation.
- Layered structure: thin API routes, a service layer, then the database.

## Consequences
- One repo and one run command for reviewers.
- Supabase's JavaScript client is best supported in TypeScript.
- A .NET backend with a separate React app was possible but adds a second project to run.
- Azure Static Web Apps or Easy Auth would tie the submission to Azure and are not used.

## Alternatives considered
.NET Core Web API plus React; a purely static site (cannot hold the API token safely).
