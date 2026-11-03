-- 1 org, 200 users, 700,000 leads over a year, 1.2M contacts. Deterministic.
SELECT setseed(0.42);
INSERT INTO users SELECT ('00000000-0000-0000-0000-' || lpad(g::text,12,'0'))::uuid, '00000000-0000-0000-0000-0000000000aa', 'User '||g FROM generate_series(1,200) g;
INSERT INTO companies SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', 'Company '||g||' '||(ARRAY['Health','Media','Build','Tech','Foods'])[1+g%5], (ARRAY['Healthcare','Media & publishing','Construction','IT & software',''])[1+g%5] FROM generate_series(1,300000) g;
CREATE TEMP TABLE cid AS SELECT id, row_number() OVER () rn FROM companies;
INSERT INTO jobs (id, org_id, company_id, position, location, source, industry, stage, created_by, assigned_to, assigned_to_bd, created_at, is_duplicate)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', c.id,
  (ARRAY['Registered Nurse','Software Engineer','Site Supervisor','Editor','Welder','Data Analyst'])[1+g%6]||' '||g, (ARRAY['Austin, TX','Greer, SC','Remote','Dallas, TX'])[1+g%4],
  (ARRAY['Indeed','Linkedin','Simplyhired','Glassdoor'])[1+g%4], CASE WHEN g%4=0 THEN (ARRAY['Healthcare','Construction'])[1+g%2] ELSE '' END,
  (ARRAY['Unassigned','Assigned','Assigned','Assigned','Connected','In Discussion','Future','Rejected'])[1+g%8],
  ('00000000-0000-0000-0000-' || lpad((1+g%200)::text,12,'0'))::uuid, NULL,
  CASE WHEN g%8=0 THEN NULL ELSE ('00000000-0000-0000-0000-' || lpad((1+(g*7)%200)::text,12,'0'))::uuid END,
  now() - (random()*365||' days')::interval, false
FROM generate_series(1,700000) g JOIN cid c ON c.rn = 1 + (g % 300000);
INSERT INTO contacts SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', j.id, (ARRAY['Pat','Dana','Chris','Lee'])[1+(random()*3)::int], 'Smith'||(random()*9999)::int, 'p'||(random()*1e7)::int||'@acme'||(random()*500)::int||'.com', true FROM jobs j WHERE random() < 0.9;
ANALYZE;
