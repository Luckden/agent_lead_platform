import { json, readJson, sqlErrorResponse } from "@/lib/http";
import { assignBody, uuid } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

// Reassign an assigned lead to a different online agent (ADR-0019).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return json({ error: "Invalid lead id" }, 400);
  const body = await readJson(request, assignBody);
  if (!body.ok) return body.response;

  const { data, error } = await supabaseAdmin().rpc("reassign_lead", {
    p_lead_id: id,
    p_agent_id: body.data.agentId,
    p_assigned_by: body.data.assignedBy ?? null,
  });
  if (error) return sqlErrorResponse(error);
  return json(data);
}
