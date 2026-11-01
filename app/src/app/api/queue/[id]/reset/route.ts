import { json, sqlErrorResponse } from "@/lib/http";
import { uuid } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

// Returns a parked lead to the queue (ADR-0015).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return json({ error: "Invalid queue id" }, 400);
  const { error } = await supabaseAdmin().rpc("reset_parked", { p_queue_id: id });
  if (error) return sqlErrorResponse(error);
  return json({ ok: true });
}
