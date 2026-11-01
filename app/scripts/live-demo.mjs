// Sends 20 leads, one per second, so the live board can be watched.
// Usage: npm run demo   (reads .env.local; the app must be running)
const base = process.env.BASE_URL ?? "http://localhost:3000";
const token = process.env.INCOMING_API_TOKEN;
const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon } = process.env;
if (!token || !url || !anon) throw new Error("Run with: npm run demo (needs .env.local)");

const agents = await fetch(`${url}/rest/v1/agents?select=id,name`, {
  headers: { apikey: anon, authorization: `Bearer ${anon}` },
}).then((r) => r.json());
const names = new Map(agents.map((a) => [a.id, a.name]));

const run = Date.now().toString(36);
for (let i = 1; i <= 20; i++) {
  const res = await fetch(`${base}/api/leads/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      leadId: `DEMO-${run}-${i}`,
      name: `Demo Lead ${i}`,
      phone: `6019${String(Date.now()).slice(-7)}${i}`,
      project: "Residensi Mutiara",
    }),
  });
  const body = await res.json();
  const outcome = body.assignedAgentId ? `-> ${names.get(body.assignedAgentId)}` : body.queued ? "queued (no agent online)" : JSON.stringify(body);
  console.log(`${String(i).padStart(2)}/20  ${res.status}  ${body.leadId ?? ""}  ${outcome}`);
  if (i < 20) await new Promise((r) => setTimeout(r, 1000));
}
