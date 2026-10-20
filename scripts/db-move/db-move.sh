#!/usr/bin/env bash
# Move PACE's database to a new Supabase project (R-292, D-0166). Runs on GitHub's free runner (.github/workflows/db-move.yml),
# never on the live server and never from a person's computer. It only READS the old database; everything it writes goes to the NEW one.
#
#   rehearsal   copy everything now (the app keeps running on the old one) and CHECK the copy. Safe to run as often as you like.
#   final       the same, for the real switch — refuses to run unless CONFIRM_STOPPED=YES (sending stopped, people told to pause).
#   verify      only compare old and new (row counts + a fingerprint of every table, and the files in storage). Writes nothing.
#
# Needs (GitHub repository secrets, set by the owner — see docs/DATABASE_MOVE_RUNBOOK.md):
#   SRC_DB_URL / DST_DB_URL            the "Session pooler" connection strings of the old and the new project
#   SRC_SERVICE_KEY / DST_SERVICE_KEY  their service_role keys (for the files in storage)
set -uo pipefail
MODE="${1:-}"
case "$MODE" in rehearsal|final|verify) ;; *) echo "Usage: db-move.sh rehearsal|final|verify"; exit 2;; esac
for v in SRC_DB_URL DST_DB_URL SRC_SERVICE_KEY DST_SERVICE_KEY; do [ -n "${!v:-}" ] || { echo "Missing secret $v"; exit 2; }; done

SRC_REF_EXPECTED="${EXPECT_SRC_REF:-teiqievahzhllojvgsku}"
refOf() { echo "$1" | sed -n 's#^postgres\(ql\)\?://postgres\.\([a-z0-9]*\):.*#\2#p'; }
hostOf() { echo "$1" | sed -n 's#^.*@\([^:/]*\).*#\1#p'; }
SRC_REF="$(refOf "$SRC_DB_URL")"; DST_REF="$(refOf "$DST_DB_URL")"
[ -n "$SRC_REF" ] && [ -n "$DST_REF" ] || { echo "Could not read the project name from a connection string — use the 'Session pooler' one (it starts postgresql://postgres.<project>:...)"; exit 2; }
[ "$SRC_REF" = "$SRC_REF_EXPECTED" ] || { echo "REFUSED: the old-database secret is project $SRC_REF, expected $SRC_REF_EXPECTED"; exit 2; }
[ "$DST_REF" != "$SRC_REF" ] || { echo "REFUSED: old and new are the same project"; exit 2; }
case "$(hostOf "$DST_DB_URL")" in *us-east-2*) ;; *) echo "REFUSED: the new database is not in US East (Ohio) — host is $(hostOf "$DST_DB_URL")"; exit 2;; esac
if [ "$MODE" = "final" ] && [ "${CONFIRM_STOPPED:-}" != "YES" ]; then echo "REFUSED: final copy needs CONFIRM_STOPPED=YES (sending stopped and the team told to pause)"; exit 2; fi

export PGOPTIONS='-c timezone=UTC -c statement_timeout=0'
SRC_URL="https://${SRC_REF}.supabase.co"; DST_URL="https://${DST_REF}.supabase.co"
SCHEMAS=(public outreach backups)     # pm_sim is a scratch schema and stays behind; auth/storage/realtime belong to Supabase itself
LOG_DIR="${LOG_DIR:-db-move-logs}"; mkdir -p "$LOG_DIR"
p() { psql "$1" -X -At -v ON_ERROR_STOP=1 -c "$2"; }
FAILS=0
say() { echo; echo "== $*"; }

say "Mode: $MODE — old $SRC_REF  →  new $DST_REF (Ohio)"
p "$SRC_DB_URL" "select 'old database reachable: '||current_database()" || { echo "cannot reach the old database"; exit 1; }
p "$DST_DB_URL" "select 'new database reachable: '||current_database()" || { echo "cannot reach the new database"; exit 1; }

if [ "$MODE" = "final" ]; then
  say "Is anything still being sent?"
  busy="$(p "$SRC_DB_URL" "select count(*) from public.emails where status in ('sending')")"
  echo "emails mid-send: $busy"
  [ "$busy" = "0" ] || { echo "REFUSED: $busy emails are mid-send — wait a minute, then run again"; exit 1; }
fi

if [ "$MODE" != "verify" ]; then
  say "Dumping the old database (read-only)"
  ARGS=(); for s in "${SCHEMAS[@]}"; do ARGS+=(-n "$s"); done
  pg_dump "$SRC_DB_URL" -Fc --no-owner --no-privileges "${ARGS[@]}" -f "$LOG_DIR/dump.bin" 2> "$LOG_DIR/dump.err" || { echo "DUMP FAILED"; grep -E '^pg_dump: (error|fatal)' "$LOG_DIR/dump.err" | cut -c1-200; exit 1; }
  ls -l "$LOG_DIR/dump.bin"

  say "Loading it into the new database (replaces anything an earlier rehearsal left there)"
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$DST_DB_URL" "$LOG_DIR/dump.bin" > "$LOG_DIR/restore.out" 2> "$LOG_DIR/restore.err"
  # Messages that only say "that did not exist yet" are normal on a first load; anything else is shown and fails the run.
  # This repository is public and so are its run logs: only the first 200 characters of each error line are ever printed, and never the
  # CONTEXT / "Command was" lines that can carry a row of someone's data.
  grep -E '^pg_restore: (error|fatal)' "$LOG_DIR/restore.err" | grep -v -E 'does not exist, skipping|Command was' | cut -c1-200 > "$LOG_DIR/restore.real-errors" || true
  if [ -s "$LOG_DIR/restore.real-errors" ]; then echo "RESTORE REPORTED PROBLEMS:"; cat "$LOG_DIR/restore.real-errors"; FAILS=$((FAILS+1)); else echo "restore finished with no problems"; fi

  say "Copying the files in storage"
  node "$(dirname "$0")/copy-storage.mjs" "$SRC_URL" "$SRC_SERVICE_KEY" "$DST_URL" "$DST_SERVICE_KEY" || FAILS=$((FAILS+1))
fi

say "Checking the copy: rows and a fingerprint of every table"
TABLES="$(p "$SRC_DB_URL" "select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ('public','outreach','backups') order by 1")"
BAD=0; N=0
while IFS= read -r t; do
  [ -n "$t" ] || continue
  N=$((N+1))
  q="select count(*)||' '||md5(coalesce(string_agg(x::text,'|' order by x::text),'')) from $t x"
  a="$(p "$SRC_DB_URL" "$q" 2>&1)"; b="$(p "$DST_DB_URL" "$q" 2>&1)"
  if [ "$a" != "$b" ]; then echo "DIFFERENT  $t   old: ${a%% *} rows   new: ${b%% *} rows"; BAD=$((BAD+1)); fi
done <<< "$TABLES"
echo "tables compared: $N   different: $BAD"
[ "$BAD" = "0" ] || FAILS=$((FAILS+1))
n_old="$(p "$SRC_DB_URL" "select count(*) from pg_tables where schemaname in ('public','outreach','backups')")"
n_new="$(p "$DST_DB_URL" "select count(*) from pg_tables where schemaname in ('public','outreach','backups')")"
echo "tables: old $n_old, new $n_new"; [ "$n_old" = "$n_new" ] || FAILS=$((FAILS+1))
for what in "policies|select count(*) from pg_policies where schemaname in ('public','outreach','backups')" "indexes|select count(*) from pg_indexes where schemaname in ('public','outreach','backups')" "functions|select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','outreach','backups')" "rls-on|select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"; do
  label="${what%%|*}"; sql="${what#*|}"
  a="$(p "$SRC_DB_URL" "$sql")"; b="$(p "$DST_DB_URL" "$sql")"; echo "$label: old $a, new $b"; [ "$a" = "$b" ] || FAILS=$((FAILS+1))
done
say "Can the app's kind of key read the new database? (the check the real app makes)"
code="$(curl -s -o /dev/null -w '%{http_code}' "$DST_URL/rest/v1/organizations?select=id&limit=1" -H "apikey: $DST_SERVICE_KEY" -H "Authorization: Bearer $DST_SERVICE_KEY")"
echo "new project answers the app's kind of request with HTTP $code (200 expected)"; [ "$code" = "200" ] || FAILS=$((FAILS+1))

echo
if [ "$FAILS" = "0" ]; then echo "RESULT: THE COPY MATCHES THE OLD DATABASE ($MODE)"; exit 0; fi
echo "RESULT: $FAILS CHECK(S) FAILED ($MODE) — do not switch the app over"; exit 1
