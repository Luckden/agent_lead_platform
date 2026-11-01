-- Admin gate for assignment overrides (ADR-0021, RFC-0003).
-- Overrides are performed by "Admin", which is not an agent: events record assigned_by_admin = true
-- and assigned_by = null. Status history keeps changed_by null for admin actions.

alter table assignment_events
  add column assigned_by_admin boolean not null default false;

drop function manual_assign(uuid, uuid, uuid);
drop function reassign_lead(uuid, uuid, uuid);
drop function assign_queue_row(lead_queue, uuid, text, uuid);

create function assign_queue_row(q lead_queue, p_agent uuid, p_reason text, p_by uuid,
                                 p_admin boolean default false)
returns uuid
language plpgsql as $$
declare
  v_lead  uuid;
  v_seq   int;
  v_event uuid;
begin
  insert into leads (external_lead_id, assigned_agent_id, source, project, budget, message,
                     status, source_created_at, created_at)
  values (q.external_lead_id, p_agent, q.source, q.project, q.budget, q.message,
          'assigned', q.source_created_at, q.created_at)
  returning id into v_lead;

  insert into lead_contacts (lead_id, name, phone, email)
  values (v_lead, q.name, q.phone, q.email);

  select last_sequence_no + 1 into v_seq from assignment_state where id = 1;

  insert into assignment_events (lead_id, agent_id, previous_agent_id, sequence_no, reason,
                                 assigned_by, assigned_by_admin)
  values (v_lead, p_agent, null, v_seq, p_reason, p_by, p_admin)
  returning id into v_event;

  insert into lead_status_history (lead_id, status, changed_by) values (v_lead, 'assigned', p_by);

  insert into notifications (agent_id, assignment_event_id, type, message)
  values (p_agent, v_event, 'lead_assigned',
          format('New lead %s (%s) assigned to you', q.external_lead_id, q.name));

  update assignment_state
  set last_assigned_agent_id = p_agent, last_sequence_no = v_seq, updated_at = now()
  where id = 1;

  delete from lead_queue where id = q.id;
  return v_lead;
end $$;

create function manual_assign(p_queue_id uuid, p_agent_id uuid, p_admin boolean default false)
returns jsonb
language plpgsql as $$
declare
  q        lead_queue%rowtype;
  v_online boolean;
  v_lead   uuid;
begin
  if not p_admin then raise exception 'admin_required'; end if;

  select * into q from lead_queue where id = p_queue_id for update;
  if not found then raise exception 'queue_row_not_found'; end if;

  perform 1 from assignment_state where id = 1 for update;

  select is_online into v_online from agents where id = p_agent_id;
  if not found then raise exception 'agent_not_found'; end if;
  if not v_online then raise exception 'agent_offline'; end if;

  v_lead := assign_queue_row(q, p_agent_id, 'manual', null, true);
  return jsonb_build_object('lead_id', v_lead, 'external_lead_id', q.external_lead_id,
                            'agent_id', p_agent_id);
end $$;

create function reassign_lead(p_lead_id uuid, p_agent_id uuid, p_admin boolean default false)
returns jsonb
language plpgsql as $$
declare
  l        leads%rowtype;
  v_online boolean;
  v_seq    int;
  v_event  uuid;
begin
  if not p_admin then raise exception 'admin_required'; end if;

  select * into l from leads where id = p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;

  perform 1 from assignment_state where id = 1 for update;

  select is_online into v_online from agents where id = p_agent_id;
  if not found then raise exception 'agent_not_found'; end if;
  if not v_online then raise exception 'agent_offline'; end if;
  if l.assigned_agent_id = p_agent_id then raise exception 'same_agent'; end if;

  select last_sequence_no + 1 into v_seq from assignment_state where id = 1;

  update leads set assigned_agent_id = p_agent_id, updated_at = now() where id = l.id;

  insert into assignment_events (lead_id, agent_id, previous_agent_id, sequence_no, reason,
                                 assigned_by, assigned_by_admin)
  values (l.id, p_agent_id, l.assigned_agent_id, v_seq, 'reassigned', null, true)
  returning id into v_event;

  insert into notifications (agent_id, assignment_event_id, type, message)
  values (p_agent_id, v_event, 'lead_assigned',
          format('Lead %s was reassigned to you', l.external_lead_id));

  update assignment_state
  set last_assigned_agent_id = p_agent_id, last_sequence_no = v_seq, updated_at = now()
  where id = 1;

  return jsonb_build_object('lead_id', l.id, 'agent_id', p_agent_id,
                            'previous_agent_id', l.assigned_agent_id);
end $$;

-- Same access rule as the initial schema: server (service role) only.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('assign_queue_row', 'manual_assign', 'reassign_lead')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
