import { bearerMatches, json, sqlErrorResponse } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-server";

// Sweep backstop for environments without pg_cron (ADR-0015). Call it from any scheduler.
export async function POST(request: Request) {
  const token = process.env.SWEEP_API_TOKEN || process.env.INCOMING_API_TOKEN;
  if (!bearerMatches(request, token)) return json({ error: "Missing or invalid token" }, 401);

  const { data, error } = await supabaseAdmin().rpc("assign_pending");
  if (error) return sqlErrorResponse(error);
  return json({ assigned: data?.assigned?.length ?? 0, failed: data?.failed?.length ?? 0 });
}
