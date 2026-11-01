import { json, readJson, sqlErrorResponse } from "@/lib/http";
import { readBody } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

// Marks every unread notification for the selected agent as read.
export async function POST(request: Request) {
  const body = await readJson(request, readBody);
  if (!body.ok) return body.response;

  const { error } = await supabaseAdmin()
    .from("notifications")
    .update({ is_read: true })
    .eq("agent_id", body.data.agentId)
    .eq("is_read", false);
  if (error) return sqlErrorResponse(error);
  return json({ ok: true });
}
