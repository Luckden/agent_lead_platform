import { timingSafeEqual } from "node:crypto";
import type { z } from "zod";

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

// Constant-time bearer token check (ADR-0018).
export function bearerMatches(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false as const, response: json({ error: "Body must be valid JSON" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400),
    };
  }
  return { ok: true as const, data: parsed.data as z.infer<T> };
}

// Business errors raised by the SQL functions, mapped to HTTP codes.
const SQL_ERRORS: Record<string, [number, string]> = {
  agent_offline: [409, "The selected agent is offline"],
  agent_not_found: [404, "Agent not found"],
  queue_row_not_found: [404, "Queued lead not found (it may already be assigned)"],
  lead_not_found: [404, "Lead not found"],
  same_agent: [409, "The lead already belongs to that agent"],
};

export function sqlErrorResponse(error: { message: string; code?: string }) {
  const known = SQL_ERRORS[error.message];
  if (known) return json({ error: known[1], code: error.message }, known[0]);
  if (error.code === "23503") return json({ error: "Referenced record does not exist" }, 400);
  console.error("database error", error);
  return json({ error: "Unexpected error" }, 500);
}
