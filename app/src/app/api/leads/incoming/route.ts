import { bearerMatches, json } from "@/lib/http";
import { incomingLeadSchema, toIntakeArgs } from "@/lib/leads";
import { supabaseAdmin } from "@/lib/supabase-server";

type Outcome = "accepted" | "invalid" | "duplicate" | "unauthorized" | "error";

// RFC-0001 section 4.3. Every request is logged, including 400 and 401 (ADR-0011).
export async function POST(request: Request) {
  const db = supabaseAdmin();
  const text = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }

  const { data: logRow, error: logError } = await db
    .from("webhook_events")
    .insert({ raw_payload: body === undefined ? { _raw: text } : body })
    .select("id")
    .single();
  if (logError || !logRow) {
    console.error("could not write webhook_events", logError);
    return json({ error: "Unexpected error" }, 500);
  }

  const logId = logRow.id;

  async function finish(status: Outcome, response: Response, extra: { error?: string; leadId?: string } = {}) {
    const { error } = await db
      .from("webhook_events")
      .update({ status, error_message: extra.error ?? null, external_lead_id: extra.leadId ?? null })
      .eq("id", logId);
    if (error) console.error("could not update webhook_events", error);
    return response;
  }

  try {
    if (!bearerMatches(request, process.env.INCOMING_API_TOKEN)) {
      return finish("unauthorized", json({ error: "Missing or invalid token" }, 401));
    }

    const parsed = incomingLeadSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      const message = body === undefined ? "Body must be valid JSON" : JSON.stringify(errors);
      return finish(
        "invalid",
        json(body === undefined ? { error: message } : { error: "Invalid payload", details: errors }, 400),
        { error: message },
      );
    }
    const lead = parsed.data;

    const intake = await db.rpc("intake_lead", { p: toIntakeArgs(lead) });
    if (intake.error) throw intake.error;
    const result = intake.data as {
      outcome: "queued" | "duplicate";
      external_lead_id: string;
      queued?: boolean;
      conflict?: string | null;
    };

    if (result.outcome === "duplicate") {
      return finish(
        "duplicate",
        json({ duplicate: true, leadId: result.external_lead_id, queued: result.queued ?? false }, 200),
        { leadId: result.external_lead_id, error: result.conflict ?? undefined },
      );
    }

    // New lead is queued; run the assignment function. A failure here leaves the lead queued for
    // the retry/sweep path (ADR-0015), so the request is still accepted.
    const assign = await db.rpc("assign_pending");
    if (assign.error) console.error("assign_pending failed", assign.error);

    const { data: assigned } = await db
      .from("leads")
      .select("assigned_agent_id, status")
      .eq("external_lead_id", lead.leadId)
      .maybeSingle();

    if (assigned) {
      return finish(
        "accepted",
        json({ leadId: lead.leadId, assignedAgentId: assigned.assigned_agent_id, status: assigned.status }, 201),
        { leadId: lead.leadId },
      );
    }
    return finish("accepted", json({ leadId: lead.leadId, queued: true }, 202), { leadId: lead.leadId });
  } catch (error) {
    console.error("incoming lead failed", error);
    return finish("error", json({ error: "Unexpected error" }, 500), {
      error: (error as { message?: string })?.message ?? String(error),
    });
  }
}
