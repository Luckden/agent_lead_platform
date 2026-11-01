import { json, readJson, sqlErrorResponse } from "@/lib/http";
import { presenceBody, uuid } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

// Presence toggle (ADR-0010). Coming online drains the queue.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return json({ error: "Invalid agent id" }, 400);
  const body = await readJson(request, presenceBody);
  if (!body.ok) return body.response;

  const { data, error } = await supabaseAdmin().rpc("set_agent_online", {
    p_agent_id: id,
    p_online: body.data.isOnline,
  });
  if (error) return sqlErrorResponse(error);
  return json({ ok: true, assigned: data?.assigned?.length ?? 0 });
}
