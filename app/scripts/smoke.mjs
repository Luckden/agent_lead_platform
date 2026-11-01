// Smoke test against a running app and a seeded Supabase project (RFC-0001 section 7).
// Usage: BASE_URL=http://localhost:3000 INCOMING_API_TOKEN=... node scripts/smoke.mjs
// Expects the seeded agents A, B, C online and D offline, and an empty lead_queue.
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const token = process.env.INCOMING_API_TOKEN;
if (!token) throw new Error("Set INCOMING_API_TOKEN");

const run = Date.now().toString(36);
let n = 0;
const payload = (over = {}) => {
  n += 1;
  return { leadId: `SM-${run}-${n}`, name: `Smoke ${n}`, phone: `6013${String(Date.now() % 1e7).padStart(7, "0")}${n}`, ...over };
};
const post = async (body, auth = `Bearer ${token}`) => {
  const res = await fetch(`${base}/api/leads/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const bad = await post(payload(), "Bearer wrong");
assert.equal(bad.status, 401);
console.log("401 bad token: ok");

const invalid = await post({ leadId: "x" });
assert.equal(invalid.status, 400);
console.log("400 invalid payload: ok");

const first = await post(payload());
assert.ok([201, 202].includes(first.status));
console.log(`first lead: ${first.status}`, first.body);

const dup = await post(payload({ leadId: first.body.leadId }));
assert.equal(dup.status, 200);
assert.equal(dup.body.duplicate, true);
console.log("200 duplicate by leadId: ok");

// 10 parallel leads must all be accepted and none lost or double-assigned.
const results = await Promise.all(Array.from({ length: 10 }, () => post(payload())));
const assigned = results.filter((r) => r.status === 201);
const counts = new Map();
for (const r of assigned) counts.set(r.body.assignedAgentId, (counts.get(r.body.assignedAgentId) ?? 0) + 1);
console.log("parallel results:", results.map((r) => r.status).join(","), "per agent:", [...counts.values()].join(","));
assert.ok(results.every((r) => [201, 202].includes(r.status)));
assert.equal(new Set(results.map((r) => r.body.leadId)).size, 10);
console.log("done");
