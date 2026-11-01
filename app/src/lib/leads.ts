import { z } from "zod";

export const STATUSES = ["assigned", "contacted", "qualified", "closed"] as const;
export type LeadStatus = (typeof STATUSES)[number];

export function normalizePhone(phone: string | undefined | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits === "" ? null : digits;
}

export function normalizeEmail(email: string | undefined | null): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" ? null : e;
}

const optionalText = z.string().trim().optional().nullable();

// RFC-0001 section 4.3. Unknown fields are ignored here and kept in the raw log.
export const incomingLeadSchema = z
  .object({
    leadId: z.string().trim().min(1, "leadId is required"),
    name: z.string().trim().min(1, "name is required"),
    phone: optionalText,
    email: z.union([z.literal(""), z.string().trim().email("email is not valid")]).optional().nullable(),
    source: optionalText,
    project: optionalText,
    budget: z.number().finite().nonnegative().optional().nullable(),
    message: optionalText,
    createdAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (normalizePhone(v.phone) === null && normalizeEmail(v.email) === null) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "phone or email is required" });
    }
  });

export type IncomingLead = z.infer<typeof incomingLeadSchema>;

export function toIntakeArgs(lead: IncomingLead) {
  return {
    external_lead_id: lead.leadId,
    name: lead.name,
    phone: normalizePhone(lead.phone),
    email: normalizeEmail(lead.email),
    source: lead.source || null,
    project: lead.project || null,
    budget: lead.budget ?? null,
    message: lead.message || null,
    source_created_at: lead.createdAt ?? null,
  };
}

// Used by the write routes below.
export const uuid = z.string().uuid();
// ADR-0021: the acting role is self-declared; only "admin" may use the override routes.
export const assignBody = z.object({ agentId: uuid, actorRole: z.enum(["admin", "agent"]) });
export const statusBody = z.object({ status: z.enum(STATUSES), changedBy: uuid.nullable().optional() });
export const presenceBody = z.object({ isOnline: z.boolean() });
export const notesBody = z.object({ notes: z.string().max(10000) });
export const readBody = z.object({ agentId: uuid });
