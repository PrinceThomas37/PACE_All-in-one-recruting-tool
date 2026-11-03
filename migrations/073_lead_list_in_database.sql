-- R-349 A (owner, 3 Nov 2026: "the app must not slow down however many leads — 2,000 a day").
-- The database finds ONE PAGE of the lead list. Same rules as services/lead-query.js (a port of the Leads tab's old browser filtering) and
-- services/ownership.js canSeeLead; test/lead-list-sql-smoke.mjs runs this against a real Postgres and requires the SAME answer as the JavaScript.
-- MEASURED on a real Postgres 16 with 700,000 leads (docs/PLAN_R-349_scale_design.md): the page comes back in single-digit milliseconds
-- whatever the filter. Safe to run twice. On a big live table create the indexes one at a time with CREATE INDEX CONCURRENTLY first.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── search: ONE text per lead, kept up to date by the database itself (whatever code or person changes a lead, a contact or a company) ──
-- position, location, company name, and each contact's "first last" and email, lower-case, parts separated by control characters so a
-- search never matches across two parts. One trigram index on it: the planner then chooses by how common the word is (walk the newest-first
-- index for a common word, use the trigram index for a rare one) — measured: two hand-written strategies were each 100x slower on the other's case.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_text text;

CREATE OR REPLACE FUNCTION lead_search_text(p_job uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(j.position,'') || chr(31) || coalesce(j.location,'') || chr(31) || coalesce(c.name,'') || chr(31) ||
         coalesce((SELECT string_agg(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'') || chr(30) || coalesce(ct.email,''), chr(31))
                   FROM contacts ct WHERE ct.job_id = j.id), ''))
  FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = p_job
$$;

CREATE OR REPLACE FUNCTION jobs_search_text_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := lower(coalesce(NEW.position,'') || chr(31) || coalesce(NEW.location,'') || chr(31) ||
     coalesce((SELECT name FROM companies WHERE id = NEW.company_id), '') || chr(31) ||
     coalesce((SELECT string_agg(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'') || chr(30) || coalesce(ct.email,''), chr(31))
               FROM contacts ct WHERE ct.job_id = NEW.id), ''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_search_text ON jobs;
CREATE TRIGGER jobs_search_text BEFORE INSERT OR UPDATE OF position, location, company_id ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_search_text_trg();

CREATE OR REPLACE FUNCTION contacts_search_text_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN UPDATE jobs SET search_text = lead_search_text(id) WHERE id = OLD.job_id; END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND (TG_OP = 'INSERT' OR NEW.job_id IS DISTINCT FROM OLD.job_id) THEN UPDATE jobs SET search_text = lead_search_text(id) WHERE id = NEW.job_id; END IF;
  IF TG_OP = 'UPDATE' AND NEW.job_id IS NOT DISTINCT FROM OLD.job_id THEN UPDATE jobs SET search_text = lead_search_text(id) WHERE id = NEW.job_id; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS contacts_search_text ON contacts;
CREATE TRIGGER contacts_search_text AFTER INSERT OR DELETE OR UPDATE OF first_name, last_name, email, job_id ON contacts FOR EACH ROW EXECUTE FUNCTION contacts_search_text_trg();

CREATE OR REPLACE FUNCTION companies_search_text_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE jobs SET search_text = lead_search_text(id) WHERE company_id = NEW.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS companies_search_text ON companies;
CREATE TRIGGER companies_search_text AFTER UPDATE OF name ON companies FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION companies_search_text_trg();

-- backfill (today ~3,000 leads: instant). On a table with millions of rows run it in batches of ~10,000 ids instead.
UPDATE jobs SET search_text = lead_search_text(id) WHERE search_text IS NULL;

-- ── indexes: one per way of seeing a lead, all in the list's own order (newest first, id breaks ties) ──
CREATE INDEX IF NOT EXISTS idx_jobs_lp_order        ON jobs (org_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_lp_owner        ON jobs (org_id, assigned_to_bd, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_lp_creator      ON jobs (org_id, created_by,     created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_lp_assigned_to  ON jobs (org_id, assigned_to,    created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_lp_stage        ON jobs (org_id, stage, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_trgm_search     ON jobs USING gin (search_text gin_trgm_ops);

-- ── the lead list's rules, written ONCE ──
-- Builds the WHERE for the lead list from ONLY the conditions that apply, with every value a bound parameter (never pasted into the text): the planner
-- sees the simplest possible query, and nothing a person types can change the statement. Parameters, in order:
--   $1 org  $2 owner ids  $3 search pattern  $4 industries  $5 viewer  $6 assignee  $7 day (today/yesterday/week cut)  $8 from  $9 to  $10 stages
--   $11 bookmark created_at  $12 bookmark id  $13 limit
-- WHO MAY SEE a lead is decided FIRST, exactly as services/ownership.js canSeeLead:
--   all (admin) | assigned_to_bd in my scope | created_by in my scope | assigned_to in my scope | nobody owns it and I may see the pool
-- p_for = 'page'  -> every filter and the bookmark;  'strip' -> every filter except the stage buttons (what the number strip counts, R-279);
--         'team'  -> only who-may-see, search and industry (what the "my leads / team" chips count, as the Leads tab always did).
CREATE OR REPLACE FUNCTION lead_where_sql(
  p_for text, p_all boolean, p_sees_pool boolean, p_has_search boolean, p_has_industries boolean, p_team_manager boolean, p_whose text, p_assignee text,
  p_date_range text, p_has_from boolean, p_has_to boolean, p_has_stages boolean, p_has_after boolean
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text := ' WHERE j.org_id = $1 AND j.deleted_at IS NULL';
BEGIN
  IF NOT p_all THEN
    v := v || ' AND (j.assigned_to_bd = ANY($2) OR j.created_by = ANY($2) OR j.assigned_to = ANY($2)' || CASE WHEN p_sees_pool THEN ' OR j.assigned_to_bd IS NULL' ELSE '' END || ')';
  END IF;
  IF p_has_search THEN v := v || ' AND j.search_text LIKE $3'; END IF;
  IF p_has_industries THEN
    -- the industry the lead carries: its own, else its company's (R-312)
    v := v || ' AND lower(btrim(coalesce(nullif(j.industry,''''), (SELECT c.industry FROM companies c WHERE c.id = j.company_id), ''''))) = ANY($4)';
  END IF;
  IF p_for IN ('page','strip') THEN
    -- a team manager's "my leads" / "the team's" (the tab opens on "mine"); a lead nobody owns stays with "mine"
    IF p_team_manager AND coalesce(p_whose,'mine') = 'mine' THEN v := v || ' AND NOT (j.assigned_to_bd IS NOT NULL AND j.assigned_to_bd <> $5)';
    ELSIF p_team_manager AND p_whose = 'team' THEN v := v || ' AND (j.assigned_to_bd IS NOT NULL AND j.assigned_to_bd <> $5)'; END IF;
    IF p_assignee = 'none' THEN v := v || ' AND j.assigned_to_bd IS NULL';
    ELSIF coalesce(p_assignee,'') <> '' THEN v := v || ' AND j.assigned_to_bd::text = $6'; END IF;
    -- dates, as the Leads tab always did them: the calendar day (UTC) of created_at, written as a RANGE on created_at so the index can be used
    -- (the same days; "(created_at at time zone 'UTC')::date = d" cannot use an index: measured 40x slower)
    IF p_date_range IN ('today','yesterday','week') THEN
      v := v || ' AND j.created_at >= ($7::timestamp AT TIME ZONE ''UTC'')';
      IF p_date_range <> 'week' THEN v := v || ' AND j.created_at < (($7 + 1)::timestamp AT TIME ZONE ''UTC'')'; END IF;
    ELSIF p_date_range = 'custom' THEN
      IF p_has_from THEN v := v || ' AND j.created_at >= ($8::timestamp AT TIME ZONE ''UTC'')'; END IF;
      IF p_has_to   THEN v := v || ' AND j.created_at < (($9 + 1)::timestamp AT TIME ZONE ''UTC'')'; END IF;
    END IF;
  END IF;
  IF p_for = 'page' THEN
    IF p_has_stages THEN v := v || ' AND coalesce(nullif(j.stage,''''),''Unassigned'') = ANY($10)'; END IF;
    -- the bookmark: everything AFTER (created_at, id) in the order created_at DESC, id DESC: one row comparison the index range-scans
    IF p_has_after THEN v := v || ' AND (j.created_at, j.id) < ($11, $12)'; END IF;
  END IF;
  RETURN v;
END $$;

-- ── ONE PAGE: the ids and sort keys, newest first. The caller asks for one MORE than a page so it knows whether another page exists
-- without counting everything.
CREATE OR REPLACE FUNCTION leads_page(
  p_org uuid, p_viewer uuid, p_all boolean, p_owner_ids uuid[], p_sees_pool boolean, p_team_manager boolean,
  p_search text, p_industries text[], p_whose text, p_assignee text,
  p_date_range text, p_today date, p_now timestamptz, p_date_from date, p_date_to date,
  p_stages text[], p_after_created timestamptz, p_after_id uuid, p_limit int
) RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_like text; v_cut date;
BEGIN
  IF coalesce(p_search,'') <> '' THEN v_like := '%' || regexp_replace(lower(p_search), '([\\%_])', '\\\1', 'g') || '%'; END IF;
  v_cut := CASE p_date_range WHEN 'today' THEN p_today WHEN 'yesterday' THEN (p_now AT TIME ZONE 'UTC')::date - 1 WHEN 'week' THEN (p_now AT TIME ZONE 'UTC')::date - 7 END;
  RETURN QUERY EXECUTE 'SELECT j.id, j.created_at FROM jobs j' || lead_where_sql('page', p_all, p_sees_pool, v_like IS NOT NULL,
      p_industries IS NOT NULL AND cardinality(p_industries) > 0, p_team_manager, p_whose, p_assignee, p_date_range, p_date_from IS NOT NULL, p_date_to IS NOT NULL,
      p_stages IS NOT NULL AND cardinality(p_stages) > 0, p_after_created IS NOT NULL) || ' ORDER BY j.created_at DESC, j.id DESC LIMIT $13'
    USING p_org, p_owner_ids, v_like, p_industries, p_viewer, p_assignee, v_cut, p_date_from, p_date_to, p_stages, p_after_created, p_after_id, p_limit;
END $$;

-- ── THE NUMBERS, without loading the leads ──
-- kind 'strip': how many leads in each stage under every filter except the stage buttons; kind 'team': how many are mine / the team's
-- (only for a team manager). One grouped count over the indexed columns.
CREATE OR REPLACE FUNCTION leads_counts(
  p_org uuid, p_viewer uuid, p_all boolean, p_owner_ids uuid[], p_sees_pool boolean, p_team_manager boolean,
  p_search text, p_industries text[], p_whose text, p_assignee text,
  p_date_range text, p_today date, p_now timestamptz, p_date_from date, p_date_to date
) RETURNS TABLE (kind text, k text, n bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_like text; v_cut date; v_ind boolean := (p_industries IS NOT NULL AND cardinality(p_industries) > 0);
BEGIN
  IF coalesce(p_search,'') <> '' THEN v_like := '%' || regexp_replace(lower(p_search), '([\\%_])', '\\\1', 'g') || '%'; END IF;
  v_cut := CASE p_date_range WHEN 'today' THEN p_today WHEN 'yesterday' THEN (p_now AT TIME ZONE 'UTC')::date - 1 WHEN 'week' THEN (p_now AT TIME ZONE 'UTC')::date - 7 END;
  RETURN QUERY EXECUTE 'SELECT ''strip''::text, coalesce(nullif(j.stage,''''),''Unassigned'')::text, count(*) FROM jobs j'
      || lead_where_sql('strip', p_all, p_sees_pool, v_like IS NOT NULL, v_ind, p_team_manager, p_whose, p_assignee, p_date_range, p_date_from IS NOT NULL, p_date_to IS NOT NULL, false, false)
      || ' GROUP BY 2'
    USING p_org, p_owner_ids, v_like, p_industries, p_viewer, p_assignee, v_cut, p_date_from, p_date_to, NULL::text[], NULL::timestamptz, NULL::uuid, 0;
  IF p_team_manager THEN
    RETURN QUERY EXECUTE 'SELECT ''team''::text, CASE WHEN j.assigned_to_bd IS NOT NULL AND j.assigned_to_bd <> $5 THEN ''team'' ELSE ''mine'' END, count(*) FROM jobs j'
        || lead_where_sql('team', p_all, p_sees_pool, v_like IS NOT NULL, v_ind, p_team_manager, p_whose, p_assignee, p_date_range, false, false, false, false)
        || ' GROUP BY 2'
      USING p_org, p_owner_ids, v_like, p_industries, p_viewer, p_assignee, v_cut, p_date_from, p_date_to, NULL::text[], NULL::timestamptz, NULL::uuid, 0;
  END IF;
END $$;

-- ── who may call them ──
-- Only the server (service_role) asks the database for a company's lead list; the browser never talks to the database, and nobody else should be able to.
-- (Skipped for a role that does not exist, e.g. on a plain Postgres.)
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('leads_page', 'leads_counts', 'lead_where_sql', 'lead_search_text')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END IF;
  END LOOP;
END $$;
