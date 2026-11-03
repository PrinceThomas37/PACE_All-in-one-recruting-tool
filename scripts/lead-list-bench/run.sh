#!/bin/bash
# R-349 A — re-measure the lead list on a REAL Postgres with 700,000 synthetic leads (about 40 s to load, ~1 GB).
# Usage: bash scripts/lead-list-bench/run.sh        (needs the PostgreSQL 16 server programs; starts and stops its own cluster)
# It applies migrations/073_lead_list_in_database.sql verbatim, so what is measured is what ships.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
D=$(mktemp -d); chown postgres:postgres "$D" 2>/dev/null || true
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
runuser -u postgres -- "$BIN/initdb" -D "$D/data" -A trust -U postgres >/dev/null
runuser -u postgres -- "$BIN/pg_ctl" -D "$D/data" -o "-p 54399 -k $D -c listen_addresses=" -l "$D/log" -w start >/dev/null
export PGHOST="$D" PGPORT=54399 PGUSER=postgres
trap 'runuser -u postgres -- "$BIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"' EXIT
psql -q -c "CREATE DATABASE leads"; export PGDATABASE=leads
psql -q -f "$HERE/schema.sql"; psql -q -f "$HERE/data.sql" >/dev/null; psql -q -f "$ROOT/migrations/073_lead_list_in_database.sql" 2>&1 | grep -v NOTICE || true
psql -q -c "ANALYZE"
python3 - "$HERE" <<'PY'
import subprocess,re,os
ORG="'00000000-0000-0000-0000-0000000000aa'::uuid"; V="'00000000-0000-0000-0000-000000000005'::uuid"
U=lambda i:f"'00000000-0000-0000-0000-{i:012d}'::uuid"
MGR="ARRAY["+",".join(U(i) for i in range(1,101))+"]"; E="ARRAY[]::uuid[]"; ONE=f"ARRAY[{V}]"
def page(all_,own,pool,team,search='NULL',ind='NULL::text[]',whose='NULL',assignee='NULL',dr='NULL',dfrom='NULL::date',dto='NULL::date',stages='NULL::text[]',after='NULL::timestamptz',aid='NULL::uuid'):
    return f"SELECT count(*) FROM leads_page({ORG},{V},{all_},{own},{pool},{team},{search},{ind},{whose},{assignee},{dr},current_date,now(),{dfrom},{dto},{stages},{after},{aid},21)"
def counts(all_,own,pool,team,search='NULL',whose='NULL'):
    return f"SELECT count(*) FROM leads_counts({ORG},{V},{all_},{own},{pool},{team},{search},NULL::text[],{whose},NULL,NULL,current_date,now(),NULL::date,NULL::date)"
cases=[("page: admin, no filter",page('true',E,'true','false')),("page: BD's own leads",page('false',ONE,'false','false')),("page: manager, 100 reports",page('false',MGR,'false','true',whose="'mine'")),
("page: BD search 'nurse'",page('false',ONE,'false','false',search="'nurse'")),("page: admin, rare search 'nurse 12345'",page('true',E,'true','false',search="'nurse 12345'")),
("page: admin, common search 'registered'",page('true',E,'true','false',search="'registered'")),("page: admin, stage Connected",page('true',E,'true','false',stages="ARRAY['Connected']")),
("page: admin, deep (180 days back)",page('true',E,'true','false',after="now() - interval '180 days'",aid="'00000000-0000-0000-0000-000000000000'::uuid")),
("page: admin, created this week",page('true',E,'true','false',dr="'week'")),("page: manager, team + email search",page('false',MGR,'false','true',search="'acme77.com'",whose="'team'")),
("counts: admin (700k leads)",counts('true',E,'true','false')),("counts: BD's own",counts('false',ONE,'false','false')),("counts: manager, 100 reports",counts('false',MGR,'false','true',whose="'mine'"))]
for name,sql in cases:
    t=[]
    for _ in range(3):
        o=subprocess.run(['psql','-q','-c','\\timing on','-c',sql],capture_output=True,text=True).stdout
        t.append(float(re.findall(r'Time: ([\d.]+) ms',o)[-1]))
    print(f"{name:44s} best {min(t):8.1f} ms   worst {max(t):8.1f} ms")
PY
