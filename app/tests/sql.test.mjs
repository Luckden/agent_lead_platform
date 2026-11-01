// Exercises the SQL functions against an in-process Postgres (PGlite). Run: npm run test:sql
// Concurrency (parallel requests, advisory-lock contention) needs a real server; see scripts/smoke.mjs.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migrationFiles = ["20261101000000_initial_schema.sql", "20261102000000_admin_overrides.sql"];
const migrations = migrationFiles.map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"));
const seed = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");

const AGENTS = ["Agent A", "Agent B", "Agent C", "Agent D"];
let db;
let n = 0;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const fn = async (name, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  const row = await one(`select ${name}(${ph}) as r`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)));
  return row.r;
};
const agent = async (name) => (await one("select id from agents where name = $1", [name])).id;
const online = async (name, on) => fn("set_agent_online", await agent(name), on);
const allOffline = async () => { for (const a of AGENTS) await online(a, false); };
// Mirrors the API route: intake, then run the assignment function.
async function send(over = {}) {
  n += 1;
  const lead = { external_lead_id: `LD${1000 + n}`, name: `Person ${n}`, phone: `6012000${String(n).padStart(4, "0")}`, email: null, ...over };
  const intake = await fn("intake_lead", lead);
  await fn("assign_pending");
  const assigned = await one(
    "select a.name as agent from leads l join agents a on a.id = l.assigned_agent_id where l.external_lead_id = $1",
    [intake.external_lead_id],
  );
  return { ...intake, agent: assigned?.agent ?? null, sent: lead };
}
const owner = async (ext) => (await one("select a.name from leads l join agents a on a.id=l.assigned_agent_id where external_lead_id=$1", [ext])).name;

before(async () => {
  db = new PGlite();
  for (const m of migrations) await db.exec(m);
  await db.exec(seed);
});

test("round-robin across A,B,C, then D joins", async () => {
  const got = [];
  for (let i = 0; i < 3; i++) got.push((await send()).agent);
  assert.deepEqual(got, ["Agent A", "Agent B", "Agent C"]);
  await online("Agent D", true);
  assert.deepEqual([(await send()).agent, (await send()).agent], ["Agent D", "Agent A"]);
});

test("offline agent is skipped and rejoins in order; keeps existing leads", async () => {
  await online("Agent B", false);
  const got = [];
  for (let i = 0; i < 4; i++) got.push((await send()).agent);
  assert.deepEqual(got, ["Agent C", "Agent D", "Agent A", "Agent C"]);
  const bLeads = await one("select count(*)::int c from leads where assigned_agent_id = $1", [await agent("Agent B")]);
  assert.ok(bLeads.c >= 1, "B keeps leads while offline");
  await online("Agent B", true);
  const back = [];
  for (let i = 0; i < 3; i++) back.push((await send()).agent);
  assert.deepEqual(back, ["Agent D", "Agent A", "Agent B"]);
});

test("all offline: lead stays queued, then drains when an agent comes online", async () => {
  await allOffline();
  const r = await send();
  assert.equal(r.outcome, "queued");
  assert.equal(r.agent, null);
  const row = await one("select attempts from lead_queue where external_lead_id = $1", [r.external_lead_id]);
  assert.equal(row.attempts, 0, "no agent online is not a failure");
  await online("Agent C", true);
  assert.equal(await owner(r.external_lead_id), "Agent C");
  assert.equal((await one("select count(*)::int c from lead_queue where external_lead_id=$1", [r.external_lead_id])).c, 0);
});

test("duplicates by leadId, phone, email; identifiers attach to the existing lead", async () => {
  await online("Agent A", true);
  await online("Agent B", true);
  const first = await send({ email: "dup@x.com" });
  assert.equal(first.outcome, "queued");
  const sameId = await send({ external_lead_id: first.external_lead_id, phone: "6019999999" });
  assert.equal(sameId.outcome, "duplicate");
  const byPhone = await send({ phone: first.sent.phone, email: "new@x.com" });
  assert.equal(byPhone.outcome, "duplicate");
  assert.equal(byPhone.external_lead_id, first.external_lead_id);
  assert.equal(byPhone.queued, false);
  assert.equal((await one("select count(*)::int c from lead_contacts where email = 'new@x.com'")).c, 1);
  const byAttached = await send({ phone: "6018888888", email: "new@x.com" });
  assert.equal(byAttached.external_lead_id, first.external_lead_id);
  const byEmail = await send({ phone: null, email: "dup@x.com" });
  assert.equal(byEmail.outcome, "duplicate");
  assert.equal((await one("select count(*)::int c from leads where external_lead_id=$1", [first.external_lead_id])).c, 1);
});

test("duplicate of a still-queued lead fills a missing identifier on the queue row", async () => {
  await allOffline();
  const first = await send({ phone: "6017770000", email: null });
  assert.equal(first.agent, null);
  const dup = await send({ phone: "6017770000", email: "queued@x.com" });
  assert.equal(dup.outcome, "duplicate");
  assert.equal(dup.queued, true);
  assert.equal((await one("select email from lead_queue where external_lead_id=$1", [first.external_lead_id])).email, "queued@x.com");
  await online("Agent A", true);
  const contact = await one("select c.email from lead_contacts c join leads l on l.id=c.lead_id where l.external_lead_id=$1", [first.external_lead_id]);
  assert.equal(contact.email, "queued@x.com", "identifier survives promotion");
});

test("conflict: phone and email match different leads -> older kept, conflict reported", async () => {
  const a = await send({ phone: "6015550001", email: null });
  const b = await send({ phone: "6015550002", email: "b@x.com" });
  const c = await send({ phone: "6015550001", email: "b@x.com" });
  assert.equal(c.outcome, "duplicate");
  assert.equal(c.external_lead_id, a.external_lead_id, "older lead is kept");
  assert.match(c.conflict, /identity conflict/);
  assert.notEqual(a.external_lead_id, b.external_lead_id);
});

test("an email arriving after the queue row was promoted attaches to the assigned lead", async () => {
  await allOffline();
  const first = await send({ phone: "6014440000", email: null });
  await online("Agent B", true);
  const lead = await one("select id from leads where external_lead_id=$1", [first.external_lead_id]);
  const dup = await send({ phone: "6014440000", email: "late@x.com" });
  assert.equal(dup.outcome, "duplicate");
  assert.equal((await one("select lead_id from lead_contacts where email='late@x.com'")).lead_id, lead.id);
});

test("manual assignment, offline rejection, reassignment", async () => {
  await allOffline();
  const r = await send();
  const queued = await one("select id from lead_queue where external_lead_id=$1", [r.external_lead_id]);
  const seqBefore = (await one("select last_sequence_no s from assignment_state")).s;
  await assert.rejects(fn("manual_assign", queued.id, await agent("Agent B"), true), /agent_offline/);
  await assert.rejects(fn("manual_assign", queued.id, await agent("Agent B"), false), /admin_required/);
  assert.equal((await one("select count(*)::int c from lead_queue where id=$1", [queued.id])).c, 1);
  assert.equal((await one("select last_sequence_no s from assignment_state")).s, seqBefore);

  // Parked rows are not auto-assigned, so the lead stays queued while agents come online.
  await db.query("update lead_queue set parked_at = now() where id=$1", [queued.id]);
  await online("Agent B", true);
  await online("Agent C", true);
  const res = await fn("manual_assign", queued.id, await agent("Agent B"), true);
  const ev = await one("select * from assignment_events where lead_id=$1", [res.lead_id]);
  assert.equal(ev.reason, "manual");
  assert.equal(ev.previous_agent_id, null);
  assert.equal(ev.assigned_by, null);
  assert.equal(ev.assigned_by_admin, true);
  assert.equal(ev.sequence_no, seqBefore + 1);
  assert.equal((await one("select count(*)::int c from notifications where assignment_event_id=$1", [ev.id])).c, 1);
  assert.equal((await one("select last_assigned_agent_id a from assignment_state")).a, await agent("Agent B"));
  assert.equal((await one("select count(*)::int c from lead_status_history where lead_id=$1", [res.lead_id])).c, 1);
  assert.equal((await one("select count(*)::int c from lead_queue where id=$1", [queued.id])).c, 0);
  assert.equal((await send()).agent, "Agent C", "next automatic pick continues after the manual recipient");

  await fn("update_lead_status", res.lead_id, "contacted", await agent("Agent B"));
  await db.query("update leads set notes='call back' where id=$1", [res.lead_id]);
  await assert.rejects(fn("reassign_lead", res.lead_id, await agent("Agent B"), true), /same_agent/);
  await assert.rejects(fn("reassign_lead", res.lead_id, await agent("Agent A"), true), /agent_offline/);
  await assert.rejects(fn("reassign_lead", res.lead_id, await agent("Agent C"), false), /admin_required/);
  await fn("reassign_lead", res.lead_id, await agent("Agent C"), true);
  const lead = await one("select * from leads where id=$1", [res.lead_id]);
  assert.equal(lead.assigned_agent_id, await agent("Agent C"));
  assert.equal(lead.status, "contacted");
  assert.equal(lead.notes, "call back");
  const rev = await one("select * from assignment_events where lead_id=$1 and reason='reassigned'", [res.lead_id]);
  assert.equal(rev.previous_agent_id, await agent("Agent B"));
  assert.equal(rev.assigned_by, null);
  assert.equal(rev.assigned_by_admin, true);
  assert.equal((await one("select count(*)::int c from notifications where assignment_event_id=$1 and agent_id=$2", [rev.id, await agent("Agent C")])).c, 1);
});

test("status changes append history; no-op changes do not; invalid status rejected", async () => {
  const lead = await one("select id from leads limit 1");
  const count = async () => (await one("select count(*)::int c from lead_status_history where lead_id=$1", [lead.id])).c;
  const before = await count();
  await fn("update_lead_status", lead.id, "qualified", null);
  await fn("update_lead_status", lead.id, "qualified", null);
  assert.equal(await count(), before + 1);
  await assert.rejects(fn("update_lead_status", lead.id, "bogus", null));
});

test("failing row backs off, parks after 5 attempts, others still assign; reset retries it", async () => {
  await allOffline();
  // A queue row whose external id collides with an existing lead can never be promoted.
  const existing = await one("select external_lead_id e from leads limit 1");
  await db.query("insert into lead_queue (external_lead_id, name, phone) values ($1, 'Bad', '6013330000')", [existing.e]);
  const bad = await one("select id from lead_queue where phone='6013330000'");
  const good = await send();
  await online("Agent A", true);
  assert.equal(await owner(good.external_lead_id), "Agent A");
  let row = await one("select attempts, parked_at, next_attempt_at > now() as future, last_error from lead_queue where id=$1", [bad.id]);
  assert.equal(row.attempts, 1);
  assert.equal(row.future, true);
  assert.ok(row.last_error);
  for (let i = 2; i <= 5; i++) {
    await db.query("update lead_queue set next_attempt_at = now() - interval '1 second' where id=$1", [bad.id]);
    await fn("assign_pending");
  }
  row = await one("select attempts, parked_at from lead_queue where id=$1", [bad.id]);
  assert.equal(row.attempts, 5);
  assert.ok(row.parked_at, "parked after 5 failures");
  await db.query("update lead_queue set next_attempt_at = now() - interval '1 second' where id=$1", [bad.id]);
  await fn("assign_pending");
  assert.equal((await one("select attempts from lead_queue where id=$1", [bad.id])).attempts, 5, "parked rows are skipped");
  await fn("reset_parked", bad.id);
  row = await one("select attempts, parked_at from lead_queue where id=$1", [bad.id]);
  assert.equal(row.attempts, 1, "reset, retried once, failed again");
  assert.equal(row.parked_at, null);
});

test("agents referenced by history cannot be deleted", async () => {
  await assert.rejects(db.query("delete from agents where id=$1", [await agent("Agent A")]));
});
