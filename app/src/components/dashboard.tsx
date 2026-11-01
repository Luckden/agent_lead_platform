"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { STATUSES, type LeadStatus } from "@/lib/leads";

type Agent = { id: string; name: string; is_online: boolean; last_seen_at: string | null; sort_order: number };
type QueueRow = {
  id: string; external_lead_id: string; name: string; phone: string | null; email: string | null;
  project: string | null; attempts: number; parked_at: string | null; last_error: string | null; created_at: string;
};
type EventRow = {
  id: string; sequence_no: number; reason: string; agent_id: string; previous_agent_id: string | null;
  assigned_by: string | null; created_at: string; lead: { external_lead_id: string } | null;
};
type Lead = {
  id: string; external_lead_id: string; assigned_agent_id: string; status: LeadStatus; notes: string | null;
  project: string | null; source: string | null; budget: number | null; message: string | null; created_at: string;
  contacts: { name: string | null; phone: string | null; email: string | null }[];
};
type Notification = { id: string; message: string; is_read: boolean; created_at: string };
type HistoryRow = { id: string; status: string; changed_by: string | null; created_at: string };

type Tab = "board" | "leads" | "notifications";

async function call(path: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? `Request failed (${res.status})`;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString();

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("board");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lastAgentId, setLastAgentId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [actingChoice, setActingChoice] = useState<string>("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const agentName = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  const refresh = useCallback(async () => {
    const db = supabaseBrowser();
    const [a, qr, ev, ld, st] = await Promise.all([
      db.from("agents").select("*").order("sort_order"),
      db.from("lead_queue").select("*").order("created_at"),
      db.from("assignment_events").select("*, lead:leads(external_lead_id)").order("sequence_no", { ascending: false }).limit(50),
      db.from("leads").select("*, contacts:lead_contacts(name, phone, email)").order("created_at", { ascending: false }),
      db.from("assignment_state").select("last_assigned_agent_id").eq("id", 1).maybeSingle(),
    ]);
    if (a.data) setAgents(a.data as Agent[]);
    if (qr.data) setQueue(qr.data as QueueRow[]);
    if (ev.data) setEvents(ev.data as unknown as EventRow[]);
    if (ld.data) setLeads(ld.data as unknown as Lead[]);
    setLastAgentId(st.data?.last_assigned_agent_id ?? null);
    setLoaded(true);
  }, []);

  // Realtime: any change on the board tables triggers a refetch (ADR-0014). Debounced to batch bursts.
  useEffect(() => {
    const db = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    const channel = db.channel("board");
    for (const table of ["agents", "lead_queue", "leads", "assignment_events", "notifications"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }
    channel.subscribe();
    const first = setTimeout(refresh, 0);
    return () => {
      clearTimeout(timer);
      clearTimeout(first);
      db.removeChannel(channel);
    };
  }, [refresh]);

  useEffect(() => {
    const t = setTimeout(() => setActingChoice(window.localStorage.getItem("actingAs") ?? ""), 0);
    return () => clearTimeout(t);
  }, []);
  const actingAs = agents.some((a) => a.id === actingChoice) ? actingChoice : (agents[0]?.id ?? "");

  const loadNotifications = useCallback(async () => {
    if (!actingAs) return;
    const { data } = await supabaseBrowser()
      .from("notifications").select("id, message, is_read, created_at")
      .eq("agent_id", actingAs).order("created_at", { ascending: false }).limit(50);
    setNotifications((data ?? []) as Notification[]);
  }, [actingAs]);

  useEffect(() => {
    const t = setTimeout(loadNotifications, 0);
    return () => clearTimeout(t);
  }, [loadNotifications, events]);

  const unread = notifications.filter((n) => !n.is_read).length;

  async function act(path: string, method: string, body?: unknown, success?: string) {
    const error = await call(path, method, body);
    setToast(error ? { kind: "error", text: error } : success ? { kind: "success", text: success } : null);
    if (!error) refresh();
  }

  const onlineAgents = agents.filter((a) => a.is_online);
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="navbar mb-4 rounded-box bg-base-200">
        <div className="flex-1 px-2 text-lg font-semibold">Lead assignment</div>
        <div role="tablist" className="tabs tabs-box mr-4">
          {(["board", "leads", "notifications"] as const).map((t) => (
            <button key={t} role="tab" className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
              {t === "notifications" ? (
                <>Notifications {unread > 0 && <span className="badge badge-primary badge-sm ml-1">{unread}</span>}</>
              ) : t === "board" ? "Live board" : "Leads"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Act as
          <select
            className="select select-sm"
            value={actingAs}
            onChange={(e) => {
              setActingChoice(e.target.value);
              window.localStorage.setItem("actingAs", e.target.value);
            }}
          >
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>

      {toast && (
        <div role="alert" className={`alert mb-4 ${toast.kind === "error" ? "alert-error" : "alert-success"}`}>
          <span>{toast.text}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
      {!loaded && <p className="opacity-60">Loading…</p>}

      {tab === "board" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <section className="card bg-base-100 shadow">
              <div className="card-body p-4">
                <h2 className="card-title text-base">Agent ring</h2>
                <ul className="divide-y divide-base-200">
                  {agents.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2">
                      <span className="w-6 text-sm opacity-60">{a.sort_order}</span>
                      <span className="flex-1">
                        {a.name}
                        {a.id === lastAgentId && <span className="badge badge-info badge-sm ml-2">last assigned</span>}
                      </span>
                      <span className={`badge ${a.is_online ? "badge-success" : "badge-ghost"}`}>{a.is_online ? "online" : "offline"}</span>
                      <input
                        type="checkbox" className="toggle toggle-success toggle-sm" checked={a.is_online}
                        aria-label={`Toggle ${a.name} online`}
                        onChange={(e) => act(`/api/agents/${a.id}/presence`, "PATCH", { isOnline: e.target.checked })}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="card bg-base-100 shadow">
              <div className="card-body p-4">
                <h2 className="card-title text-base">Lead queue <span className="badge">{queue.length}</span></h2>
                {queue.length === 0 && <p className="text-sm opacity-60">Nothing waiting.</p>}
                <ul className="divide-y divide-base-200">
                  {queue.map((row) => (
                    <li key={row.id} className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{row.external_lead_id}</span>
                        <span className="flex-1 truncate">{row.name}</span>
                        {row.parked_at && <span className="badge badge-warning">Needs attention</span>}
                        {!row.parked_at && row.attempts > 0 && <span className="badge badge-ghost">retry {row.attempts}</span>}
                      </div>
                      {row.last_error && <p className="mt-1 truncate text-xs text-error" title={row.last_error}>{row.last_error}</p>}
                      <div className="mt-1 flex items-center gap-2">
                        <select
                          className="select select-xs" defaultValue="" aria-label={`Assign ${row.external_lead_id}`}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            act(`/api/queue/${row.id}/assign`, "POST", { agentId: e.target.value, assignedBy: actingAs || null }, `Assigned ${row.external_lead_id}`);
                            e.target.value = "";
                          }}
                        >
                          <option value="">Assign to…</option>
                          {onlineAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        {row.parked_at && (
                          <button className="btn btn-xs" onClick={() => act(`/api/queue/${row.id}/reset`, "POST", undefined, "Returned to queue")}>
                            Retry
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <section className="card bg-base-100 shadow">
            <div className="card-body p-4">
              <h2 className="card-title text-base">Assignment record</h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead><tr><th>#</th><th>Lead</th><th>Agent</th><th>Reason</th><th>From</th><th>By</th><th>Time</th></tr></thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td>{e.sequence_no}</td>
                        <td className="font-mono">{e.lead?.external_lead_id}</td>
                        <td>{agentName.get(e.agent_id)}</td>
                        <td><span className={`badge badge-sm ${e.reason === "auto" ? "badge-ghost" : "badge-accent"}`}>{e.reason}</span></td>
                        <td>{e.previous_agent_id ? agentName.get(e.previous_agent_id) : "—"}</td>
                        <td>{e.assigned_by ? agentName.get(e.assigned_by) : "system"}</td>
                        <td>{time(e.created_at)}</td>
                      </tr>
                    ))}
                    {events.length === 0 && <tr><td colSpan={7} className="opacity-60">No assignments yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === "leads" && (
        <div className="grid gap-4 md:grid-cols-[1fr_22rem]">
          <div className="card bg-base-100 shadow">
            <div className="card-body overflow-x-auto p-4">
              <table className="table table-sm">
                <thead><tr><th>Lead</th><th>Name</th><th>Project</th><th>Owner</th><th>Status</th></tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className={`hover cursor-pointer ${l.id === selectedLeadId ? "bg-base-200" : ""}`} onClick={() => setSelectedLeadId(l.id)}>
                      <td className="font-mono">{l.external_lead_id}</td>
                      <td>{l.contacts[0]?.name}</td>
                      <td>{l.project}</td>
                      <td>{agentName.get(l.assigned_agent_id)}</td>
                      <td><span className="badge badge-sm">{l.status}</span></td>
                    </tr>
                  ))}
                  {leads.length === 0 && <tr><td colSpan={5} className="opacity-60">No assigned leads yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {selectedLead ? (
            <LeadDetail
              key={selectedLead.id} lead={selectedLead} agents={agents} agentName={agentName} actingAs={actingAs} act={act}
            />
          ) : (
            <div className="card bg-base-100 shadow"><div className="card-body p-4 text-sm opacity-60">Select a lead.</div></div>
          )}
        </div>
      )}

      {tab === "notifications" && (
        <section className="card bg-base-100 shadow">
          <div className="card-body p-4">
            <div className="flex items-center">
              <h2 className="card-title flex-1 text-base">Notifications for {agentName.get(actingAs)}</h2>
              <button
                className="btn btn-sm" disabled={unread === 0}
                onClick={async () => { await act("/api/notifications/read", "POST", { agentId: actingAs }); loadNotifications(); }}
              >
                Mark all read
              </button>
            </div>
            <ul className="divide-y divide-base-200">
              {notifications.map((n) => (
                <li key={n.id} className="flex items-center gap-2 py-2">
                  {!n.is_read && <span className="badge badge-primary badge-xs" />}
                  <span className={`flex-1 ${n.is_read ? "opacity-60" : ""}`}>{n.message}</span>
                  <span className="text-xs opacity-60">{time(n.created_at)}</span>
                </li>
              ))}
              {notifications.length === 0 && <li className="py-2 opacity-60">No notifications.</li>}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function LeadDetail({
  lead, agents, agentName, actingAs, act,
}: {
  lead: Lead; agents: Agent[]; agentName: Map<string, string>; actingAs: string;
  act: (path: string, method: string, body?: unknown, success?: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabaseBrowser().from("lead_status_history").select("*").eq("lead_id", lead.id).order("created_at")
      .then(({ data }) => { if (!cancelled) setHistory((data ?? []) as HistoryRow[]); });
    return () => { cancelled = true; };
  }, [lead.id, lead.status]);

  const targets = agents.filter((a) => a.is_online && a.id !== lead.assigned_agent_id);

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-3 p-4">
        <h2 className="card-title text-base">{lead.external_lead_id}</h2>
        <div className="text-sm">
          {lead.contacts.map((c, i) => (
            <p key={i}>{[c.name, c.phone, c.email].filter(Boolean).join(" · ")}</p>
          ))}
          <p className="opacity-70">{[lead.source, lead.project, lead.budget != null && `RM${lead.budget.toLocaleString()}`].filter(Boolean).join(" · ")}</p>
          {lead.message && <p className="mt-1 italic">“{lead.message}”</p>}
        </div>

        <label className="form-control">
          <span className="label-text mb-1">Status</span>
          <select
            className="select select-sm" value={lead.status}
            onChange={(e) => act(`/api/leads/${lead.id}/status`, "PATCH", { status: e.target.value, changedBy: actingAs || null })}
          >
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Owner: {agentName.get(lead.assigned_agent_id)}</span>
          <select
            className="select select-sm" defaultValue="" disabled={targets.length === 0}
            onChange={(e) => {
              if (!e.target.value) return;
              act(`/api/leads/${lead.id}/reassign`, "POST", { agentId: e.target.value, assignedBy: actingAs || null }, "Lead reassigned");
              e.target.value = "";
            }}
          >
            <option value="">{targets.length ? "Reassign to…" : "No other agent online"}</option>
            {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>

        <label className="form-control">
          <span className="label-text mb-1">Notes</span>
          <textarea className="textarea textarea-sm h-24" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button
            className="btn btn-sm btn-primary mt-2 self-start" disabled={notes === (lead.notes ?? "")}
            onClick={() => act(`/api/leads/${lead.id}/notes`, "PATCH", { notes }, "Notes saved")}
          >
            Save notes
          </button>
        </label>

        <div>
          <h3 className="mb-1 text-sm font-semibold">Status history</h3>
          <ul className="text-sm">
            {history.map((h) => (
              <li key={h.id}>{h.status} <span className="opacity-60">· {time(h.created_at)}{h.changed_by ? ` · ${agentName.get(h.changed_by) ?? ""}` : ""}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
