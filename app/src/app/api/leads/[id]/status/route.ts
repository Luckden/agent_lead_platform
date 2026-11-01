import { json, readJson, sqlErrorResponse } from "@/lib/http";
import { statusBody, uuid } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return json({ error: "Invalid lead id" }, 400);
  const body = await readJson(request, statusBody);
  if (!body.ok) return body.response;

  const { data, error } = await supabaseAdmin().rpc("update_lead_status", {
    p_lead_id: id,
    p_status: body.data.status,
    p_changed_by: body.data.changedBy ?? null,
  });
  if (error) return sqlErrorResponse(error);
  return json(data);
}
