-- Lead intake and assignment schema.
-- See docs/rfc/0001, docs/rfc/0002 and docs/adr/*. Apply in the Supabase SQL editor
-- or with `supabase db push`. Safe to run on an empty database only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table agents (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  email        text,
  is_online    boolean not null default false,
  last_seen_at timestamptz,
  sort_order   int not null unique            -- fixed round-robin order (ADR-0005)
);

-- Single row: pointer to the most recent recipient, automatic or manual (ADR-0005, ADR-0019).
create table assignment_state (
  id                     int primary key default 1 check (id = 1),
  last_assigned_agent_id uuid references agents (id) on delete restrict,
  last_sequence_no       int not null default 0,
  updated_at             timestamptz not null default now()
);
insert into assignment_state (id) values (1);

-- Unassigned leads wait here; the only place an unassigned lead lives (ADR-0006, ADR-0015).
create table lead_queue (
  id                 uuid primary key default gen_random_uuid(),
  external_lead_id   text not null unique,
  name               text not null,
  phone              text,                    -- normalized: digits only
  email              text,                    -- lowercased
  source             text,
  project            text,
  budget             numeric,
  message            text,
  source_created_at  timestamptz,
  attempts           int not null default 0,  -- failed attempts only
  last_attempt_at    timestamptz,
  next_attempt_at    timestamptz not null default now(),
  parked_at          timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  check (phone is not null or email is not null)
);
-- Per-table safeguards; cross-table uniqueness is enforced by intake_lead's advisory locks (ADR-0020).
create unique index lead_queue_phone_key on lead_queue (phone) where phone is not null;
create unique index lead_queue_email_key on lead_queue (email) where email is not null;
create index lead_queue_eligible_idx on lead_queue (created_at) where parked_at is null;

-- Assigned leads only (ADR-0006): owner and status are never null.
create table leads (
  id                uuid primary key default gen_random_uuid(),
  external_lead_id  text not null unique,
  assigned_agent_id uuid not null references agents (id) on delete restrict,
  source            text,
  project           text,
  budget            numeric,
  message           text,
  notes             text,
  status            text not null default 'assigned'
                      check (status in ('assigned', 'contacted', 'qualified', 'closed')),
  source_created_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index leads_assigned_agent_idx on leads (assigned_agent_id);

create table lead_contacts (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads (id) on delete cascade,
  name       text,
  phone      text unique,
  email      text unique,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
create index lead_contacts_lead_idx on lead_contacts (lead_id);

create table assignment_events (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references leads (id) on delete restrict,
  agent_id          uuid not null references agents (id) on delete restrict,
  previous_agent_id uuid references agents (id) on delete restrict,
  sequence_no       int not null unique,
  reason            text not null check (reason in ('auto', 'manual', 'reassigned')),
  assigned_by       uuid references agents (id) on delete restrict,  -- null means system
  created_at        timestamptz not null default now()
);
create index assignment_events_lead_idx on assignment_events (lead_id);

create table lead_status_history (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads (id) on delete cascade,
  status     text not null check (status in ('assigned', 'contacted', 'qualified', 'closed')),
  changed_by uuid,                            -- null on auto-assignment
  created_at timestamptz not null default now()
);
create index lead_status_history_lead_idx on lead_status_history (lead_id, created_at);

create table webhook_events (
  id               uuid primary key default gen_random_uuid(),
  raw_payload      jsonb,
  status           text not null default 'received'
                     check (status in ('received', 'accepted', 'invalid', 'duplicate', 'unauthorized', 'error')),
  error_message    text,
  external_lead_id text,
  received_at      timestamptz not null default now()
);

create table notifications (
  id                  uuid primary key default gen_random_uuid(),
  agent_id            uuid not null references agents (id) on delete restrict,
  assignment_event_id uuid not null unique references assignment_events (id) on delete restrict,
  type                text not null default 'lead_assigned',
  message             text not null,
  is_read             boolean not null default false,
  created_at          timestamptz not null default now()
);
create index notifications_agent_idx on notifications (agent_id, is_read, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security (ADR-0016): browser may read, never write. The service role bypasses RLS.
-- webhook_events has RLS enabled and no policy, so the browser cannot see raw payloads.
-- ---------------------------------------------------------------------------

alter table agents              enable row level security;
alter table assignment_state    enable row level security;
alter table lead_queue          enable row level security;
alter table leads               enable row level security;
alter table lead_contacts       enable row level security;
alter table assignment_events   enable row level security;
alter table lead_status_history enable row level security;
alter table webhook_events      enable row level security;
alter table notifications       enable row level security;

create policy read_agents              on agents              for select using (true);
create policy read_assignment_state    on assignment_state    for select using (true);
create policy read_lead_queue          on lead_queue          for select using (true);
create policy read_leads               on leads               for select using (true);
create policy read_lead_contacts       on lead_contacts       for select using (true);
create policy read_assignment_events   on assignment_events   for select using (true);
create policy read_lead_status_history on lead_status_history for select using (true);
create policy read_notifications       on notifications       for select using (true);

-- Realtime publication (present on Supabase; skipped elsewhere).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agents', 'lead_queue', 'leads', 'assignment_events', 'notifications'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Lock order everywhere: (queue row | lead row) -> assignment_state -> agents.
-- Presence changes also take assignment_state first, so an agent cannot go offline between
-- being picked and receiving the lead.

-- Next online agent after the pointer in sort_order, wrapping around; null if nobody is online.
create function pick_next_agent() returns uuid
language plpgsql as $$
declare
  last_order int;
  picked uuid;
begin
  select a.sort_order into last_order
  from assignment_state s join agents a on a.id = s.last_assigned_agent_id
  where s.id = 1;

  select id into picked from agents
  where is_online and (last_order is null or sort_order > last_order)
  order by sort_order limit 1;

  if picked is null then
    select id into picked from agents where is_online order by sort_order limit 1;
  end if;
  return picked;
end $$;

-- Writes everything an assignment needs and removes the queue row. Caller holds the queue row
-- and assignment_state locks and has verified the agent is online.
create function assign_queue_row(q lead_queue, p_agent uuid, p_reason text, p_by uuid)
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

  -- Promotion transfers the queued identifiers; it never creates new ones.
  insert into lead_contacts (lead_id, name, phone, email)
  values (v_lead, q.name, q.phone, q.email);

  select last_sequence_no + 1 into v_seq from assignment_state where id = 1;

  insert into assignment_events (lead_id, agent_id, previous_agent_id, sequence_no, reason, assigned_by)
  values (v_lead, p_agent, null, v_seq, p_reason, p_by)
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

-- Automatic assignment (ADR-0005, ADR-0006, ADR-0015). Claims eligible queue rows oldest first
-- until the queue is empty, nobody is online, or p_max rows were handled. "No agent online" is
-- not a failure. A row that errors is rolled back to its own savepoint, gets backoff, and is
-- parked after 5 failed attempts; other rows keep going.
create function assign_pending(p_max int default 100) returns jsonb
language plpgsql as $$
declare
  q        lead_queue%rowtype;
  v_agent  uuid;
  v_lead   uuid;
  v_done   jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  n        int := 0;
begin
  while n < p_max loop
    n := n + 1;

    select * into q from lead_queue
    where parked_at is null and next_attempt_at <= now()
    order by created_at, id
    limit 1
    for update skip locked;
    exit when not found;

    perform 1 from assignment_state where id = 1 for update;
    v_agent := pick_next_agent();
    exit when v_agent is null;

    begin
      v_lead := assign_queue_row(q, v_agent, 'auto', null);
      v_done := v_done || jsonb_build_object(
        'external_lead_id', q.external_lead_id, 'lead_id', v_lead, 'agent_id', v_agent);
    exception when others then
      update lead_queue
      set attempts        = attempts + 1,
          last_attempt_at = clock_timestamp(),
          last_error      = sqlerrm,
          next_attempt_at = clock_timestamp() + (30 * power(2, attempts)) * interval '1 second',
          parked_at       = case when attempts + 1 >= 5 then clock_timestamp() end
      where id = q.id;
      v_failed := v_failed || jsonb_build_object(
        'external_lead_id', q.external_lead_id, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('assigned', v_done, 'failed', v_failed);
end $$;

-- Operator override for a queued lead, parked or not (ADR-0019).
create function manual_assign(p_queue_id uuid, p_agent_id uuid, p_assigned_by uuid default null)
returns jsonb
language plpgsql as $$
declare
  q        lead_queue%rowtype;
  v_online boolean;
  v_lead   uuid;
begin
  select * into q from lead_queue where id = p_queue_id for update;
  if not found then raise exception 'queue_row_not_found'; end if;

  perform 1 from assignment_state where id = 1 for update;

  select is_online into v_online from agents where id = p_agent_id;
  if not found then raise exception 'agent_not_found'; end if;
  if not v_online then raise exception 'agent_offline'; end if;

  v_lead := assign_queue_row(q, p_agent_id, 'manual', p_assigned_by);
  return jsonb_build_object('lead_id', v_lead, 'external_lead_id', q.external_lead_id,
                            'agent_id', p_agent_id);
end $$;

-- Operator override: change the owner of an assigned lead (ADR-0019). Status and notes stay.
create function reassign_lead(p_lead_id uuid, p_agent_id uuid, p_assigned_by uuid default null)
returns jsonb
language plpgsql as $$
declare
  l        leads%rowtype;
  v_online boolean;
  v_seq    int;
  v_event  uuid;
begin
  select * into l from leads where id = p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;

  perform 1 from assignment_state where id = 1 for update;

  select is_online into v_online from agents where id = p_agent_id;
  if not found then raise exception 'agent_not_found'; end if;
  if not v_online then raise exception 'agent_offline'; end if;
  if l.assigned_agent_id = p_agent_id then raise exception 'same_agent'; end if;

  select last_sequence_no + 1 into v_seq from assignment_state where id = 1;

  update leads set assigned_agent_id = p_agent_id, updated_at = now() where id = l.id;

  insert into assignment_events (lead_id, agent_id, previous_agent_id, sequence_no, reason, assigned_by)
  values (l.id, p_agent_id, l.assigned_agent_id, v_seq, 'reassigned', p_assigned_by)
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

-- Presence toggle (ADR-0010). Coming online drains the queue.
create function set_agent_online(p_agent_id uuid, p_online boolean) returns jsonb
language plpgsql as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  perform 1 from assignment_state where id = 1 for update;

  update agents set is_online = p_online, last_seen_at = now() where id = p_agent_id;
  if not found then raise exception 'agent_not_found'; end if;

  if p_online then v_result := assign_pending(); end if;
  return v_result;
end $$;

-- Status change plus its history row in one transaction (ADR-0007).
create function update_lead_status(p_lead_id uuid, p_status text, p_changed_by uuid default null)
returns jsonb
language plpgsql as $$
declare
  l leads%rowtype;
begin
  select * into l from leads where id = p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;
  if l.status = p_status then
    return jsonb_build_object('changed', false);
  end if;

  update leads set status = p_status, updated_at = now() where id = l.id;
  insert into lead_status_history (lead_id, status, changed_by) values (l.id, p_status, p_changed_by);
  return jsonb_build_object('changed', true);
end $$;

-- Returns a parked lead to the queue (ADR-0015).
create function reset_parked(p_queue_id uuid) returns jsonb
language plpgsql as $$
begin
  update lead_queue
  set attempts = 0, parked_at = null, next_attempt_at = now(), last_error = null
  where id = p_queue_id;
  if not found then raise exception 'queue_row_not_found'; end if;
  return assign_pending();
end $$;

-- Duplicate-safe intake (ADR-0011, ADR-0017, ADR-0020). Takes a transaction-scoped advisory lock
-- per supplied identity, in sorted order, before looking in lead_queue and lead_contacts.
-- Input keys: external_lead_id, name, phone (normalized), email (lowercased), source, project,
-- budget, message, source_created_at.
-- Output: { outcome: 'queued' | 'duplicate', external_lead_id, lead_id?, queued?, conflict? }
create function intake_lead(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_ext     text := p->>'external_lead_id';
  v_name    text := p->>'name';
  v_phone   text := nullif(p->>'phone', '');
  v_email   text := nullif(p->>'email', '');
  v_keys    text[];
  k         text;
  m         record;
  n         int := 0;
  v_kind    text;
  v_id      uuid;
  v_target  text;
  v_seen    text[] := '{}';
  v_conflict text;
  v_new_phone text;
  v_new_email text;
  v_lead    uuid;
  c         lead_contacts%rowtype;
  v_left_phone text;
  v_left_email text;
  v_queue_id uuid;
begin
  select array_agg(x order by x) into v_keys from unnest(array[
    'id:' || v_ext,
    case when v_phone is not null then 'phone:' || v_phone end,
    case when v_email is not null then 'email:' || v_email end
  ]) as x where x is not null;

  foreach k in array v_keys loop
    perform pg_advisory_xact_lock(hashtextextended(k, 0));
  end loop;

  -- Oldest match first; any further distinct match is an identity conflict.
  for m in
    select kind, id, ext, created_at from (
      select 'lead' as kind, l.id, l.external_lead_id as ext, l.created_at
      from leads l where l.external_lead_id = v_ext
      union all
      select 'lead', l.id, l.external_lead_id, l.created_at
      from lead_contacts lc join leads l on l.id = lc.lead_id
      where (v_phone is not null and lc.phone = v_phone) or (v_email is not null and lc.email = v_email)
      union all
      select 'queue', q.id, q.external_lead_id, q.created_at
      from lead_queue q
      where q.external_lead_id = v_ext
         or (v_phone is not null and q.phone = v_phone)
         or (v_email is not null and q.email = v_email)
    ) matches
    order by created_at, id
  loop
    if m.ext = any (v_seen) then continue; end if;
    n := n + 1;
    if n = 1 then v_kind := m.kind; v_id := m.id; v_target := m.ext; end if;
    v_seen := v_seen || m.ext;
  end loop;

  if n = 0 then
    insert into lead_queue (external_lead_id, name, phone, email, source, project, budget, message,
                            source_created_at)
    values (v_ext, v_name, v_phone, v_email, p->>'source', p->>'project',
            nullif(p->>'budget', '')::numeric, p->>'message',
            nullif(p->>'source_created_at', '')::timestamptz);
    return jsonb_build_object('outcome', 'queued', 'external_lead_id', v_ext);
  end if;

  if n > 1 then
    v_conflict := format('identity conflict: payload %s matched leads %s; kept oldest %s',
                         v_ext, array_to_string(v_seen, ', '), v_target);
  end if;

  -- Identifiers that no lead or queue row holds yet are attached to the kept record.
  if v_phone is not null
     and not exists (select 1 from lead_contacts where phone = v_phone)
     and not exists (select 1 from lead_queue where phone = v_phone) then
    v_new_phone := v_phone;
  end if;
  if v_email is not null
     and not exists (select 1 from lead_contacts where email = v_email)
     and not exists (select 1 from lead_queue where email = v_email) then
    v_new_email := v_email;
  end if;

  if v_kind = 'queue' then
    -- Blocks while a promotion holds the row; afterwards the row is gone.
    perform 1 from lead_queue where id = v_id for update;
    if found then
      update lead_queue
      set phone = coalesce(phone, v_new_phone), email = coalesce(email, v_new_email)
      where id = v_id;
      return jsonb_build_object('outcome', 'duplicate', 'external_lead_id', v_target,
                                'queued', true, 'conflict', v_conflict);
    end if;
    -- Promoted while we waited: recheck the assigned lead and attach there.
    select id into v_id from leads where external_lead_id = v_target;
    if not found then raise exception 'duplicate target vanished: %', v_target; end if;
    v_kind := 'lead';
  end if;

  v_lead := v_id;
  select * into c from lead_contacts where lead_id = v_lead order by created_at, id limit 1;
  v_left_phone := v_new_phone;
  v_left_email := v_new_email;
  if v_new_phone is not null and c.id is not null and c.phone is null then
    update lead_contacts set phone = v_new_phone where id = c.id;
    v_left_phone := null;
  end if;
  if v_new_email is not null and c.id is not null and c.email is null then
    update lead_contacts set email = v_new_email where id = c.id;
    v_left_email := null;
  end if;
  if v_left_phone is not null or v_left_email is not null then
    insert into lead_contacts (lead_id, name, phone, email)
    values (v_lead, v_name, v_left_phone, v_left_email);
  end if;

  return jsonb_build_object('outcome', 'duplicate', 'external_lead_id', v_target,
                            'lead_id', v_lead, 'queued', false, 'conflict', v_conflict);
end $$;

-- ---------------------------------------------------------------------------
-- Access: these functions are for the server only (service role).
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
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

-- ---------------------------------------------------------------------------
-- Sweep backstop (ADR-0015): every minute, if pg_cron is available. Otherwise call
-- POST /api/sweep from any scheduler.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('assign-pending-sweep', '* * * * *', 'select public.assign_pending()');
  end if;
exception when others then
  raise notice 'pg_cron sweep not scheduled: %', sqlerrm;
end $$;
