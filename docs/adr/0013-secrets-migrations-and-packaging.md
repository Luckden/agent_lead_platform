# ADR-0013: Secrets in env files, schema as SQL migrations, optional Docker, no Terraform

- **Status:** Proposed
- **Date:** 2026-10-30

## Context
Reviewers run the project themselves against their own Supabase project. Secrets must not be committed, and setup should take minutes.

## Decision
- Secrets (Supabase URL, service role key, incoming API token) in a git-ignored env file; commit an example file with placeholders.
- The service role key is used server-side only and never exposed to the browser. The browser gets only the public anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), limited by read-only RLS policies (ADR-0016).
- The schema ships as SQL migrations plus a seed script. Reviewers create an empty Supabase project, apply the migration (SQL editor or Supabase CLI), and fill in the env file.
- A Dockerfile packages only the Next.js app (secrets passed at run time, not baked in). The plain install-and-run path stays documented.
- No Terraform; the README mentions how provisioning would be automated in production.

## Consequences
- Low setup burden and no real keys shared.
- Docker is a convenience, not a requirement, since reviewers may not have it.
- Running the full Supabase stack locally in Docker is deliberately avoided as too heavy.
