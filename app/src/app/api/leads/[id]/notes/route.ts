import { json, readJson, sqlErrorResponse } from "@/lib/http";
import { notesBody, uuid } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

// Notes are a single text field on the lead (ADR-0008).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return json({ error: "Invalid lead id" }, 400);
  const body = await readJson(request, notesBody);
  if (!body.ok) return body.response;

  const { data, error } = await supabaseAdmin()
    .from("leads")
    .update({ notes: body.data.notes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return sqlErrorResponse(error);
  if (!data?.length) return json({ error: "Lead not found" }, 404);
  return json({ ok: true });
}
