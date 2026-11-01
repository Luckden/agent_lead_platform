-- Seed agents A-D. A, B and C start online; D starts offline (RFC-0001 section 7).
insert into agents (name, phone, email, is_online, last_seen_at, sort_order) values
  ('Agent A', '60110000001', 'agent.a@example.com', true,  now(), 1),
  ('Agent B', '60110000002', 'agent.b@example.com', true,  now(), 2),
  ('Agent C', '60110000003', 'agent.c@example.com', true,  now(), 3),
  ('Agent D', '60110000004', 'agent.d@example.com', false, null,  4);
