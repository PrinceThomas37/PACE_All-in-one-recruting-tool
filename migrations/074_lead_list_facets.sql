-- 074 — the Leads tab's two drop-downs ("Assigned to", "Industry") without loading the leads (R-349 Stage D).
-- Until now the browser counted them from the whole list it held. With the list on the server it asks for them: how many of YOUR visible leads
-- each person owns (and how many nobody owns), and how many carry each industry. Same who-may-see rule as the page and the counts (lead_where_sql, 'team' form:
-- only who-may-see), nothing else filtered — the lists were always counted over every lead the person can see (R-312).
-- An industry is the one the lead carries: its own, else its company's. The label is one original spelling of it (the lower-cased key is what filters).
-- Nothing is removed or changed; one new function, callable only by the server (service_role), like the others.
CREATE OR REPLACE FUNCTION leads_facets(
  p_org uuid, p_viewer uuid, p_all boolean, p_owner_ids uuid[], p_sees_pool boolean
) RETURNS TABLE (kind text, k text, label text, n bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_where text := lead_where_sql('team', p_all, p_sees_pool, false, false, false, NULL, NULL, NULL, false, false, false, false);
BEGIN
  RETURN QUERY EXECUTE 'SELECT ''owner''::text, coalesce(j.assigned_to_bd::text, ''''), NULL::text, count(*) FROM jobs j' || v_where || ' GROUP BY 2'
    USING p_org, p_owner_ids, NULL::text, NULL::text[], p_viewer, NULL::text, NULL::date, NULL::date, NULL::date, NULL::text[], NULL::timestamptz, NULL::uuid, 0;
  RETURN QUERY EXECUTE 'SELECT ''industry''::text, lower(btrim(x.ind)), min(btrim(x.ind)), count(*) FROM (SELECT coalesce(nullif(j.industry,''''), (SELECT c.industry FROM companies c WHERE c.id = j.company_id), '''') AS ind FROM jobs j'
      || v_where || ') x WHERE btrim(x.ind) <> '''' GROUP BY 2'
    USING p_org, p_owner_ids, NULL::text, NULL::text[], p_viewer, NULL::text, NULL::date, NULL::date, NULL::date, NULL::text[], NULL::timestamptz, NULL::uuid, 0;
END $$;

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'leads_facets'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END IF;
  END LOOP;
END $$;
