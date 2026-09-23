// ============================================================================
// RECORD HISTORY — one endpoint behind the rewind button.
//
// The owner asked for "the time of every stage change ... tagged as a small
// history thing like a rewind clock button in every lead, candidate, job".
//
// ONE endpoint, not five. The shapes differ per record kind only in WHICH
// store is read; the entry that comes back is identical, so the button and the
// panel are written once. `services/record-history.js` owns the normalising and
// is pure; this file owns the queries and the org scoping, and nothing else.
//
// READ-ONLY. A history that can be edited is not a history.
//
// ⚠ ORG SCOPING IS THE WHOLE RISK HERE. A history endpoint keyed on an id the
// caller supplies is a cross-tenant read waiting to happen, so the PARENT
// record is loaded and org-checked FIRST, and a record belonging to another
// org answers 404 — never 403, which would confirm the id exists.
// ============================================================================
const express = require('express');
const H = require('../services/record-history');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, withOrg } = ctx;

  // A history is a glance, not an archive dump. 200 entries is far past what a
  // person reads and still bounded — the ageing rule (D-0013) applies to a
  // panel exactly as it applies to a page.
  const LIMIT = 200;

  // Which table holds the record itself, so we can prove the caller may see it.
  const PARENT = {
    lead:       { table: 'jobs',        select: 'id,position,stage' },
    candidate:  { table: 'candidates',  select: 'id,first_name,last_name,candidate_code' },
    job_order:  { table: 'job_orders',  select: 'id,job_title,job_code,status' },
    submission: { table: 'submissions', select: 'id,stage,candidate_id,job_order_id' },
    company:    { table: 'companies',   select: 'id,name' },
  };

  // Loads the parent IN THE CALLER'S ORG. Returns null for "not yours or not
  // there" — the two are deliberately indistinguishable from outside.
  async function loadParent(req, entity, id) {
    const p = PARENT[entity];
    if (!p) return null;
    const { data, error } = await withOrg(
      supabase.from(p.table).select(p.select).eq('id', id).maybeSingle(), req
    );
    if (error || !data) return null;
    return data;
  }

  // ── per-kind readers ──────────────────────────────────────────────────────
  // Each returns an array of RAW rows; the pure mappers turn them into entries.

  async function leadRows(req, id) {
    const { data } = await withOrg(
      supabase.from('activity_log')
        .select('*, user:users(id,name)')
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(LIMIT), req);
    return data || [];
  }

  async function submissionRows(req, id) {
    const { data } = await supabase.from('submission_activity')
      .select('*, recruiter:users(id,name)')
      .eq('submission_id', id)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return data || [];
  }

  // The general store (migration 045). Best-effort on purpose: if that
  // migration has not been applied yet the rest of the timeline must still
  // draw, rather than the whole panel failing over a table that is not there.
  async function generalRows(req, entity, id) {
    try {
      const { data, error } = await withOrg(
        supabase.from('record_history')
          .select('*, actor:users(id,name)')
          .eq('entity_type', entity)
          .eq('entity_id', id)
          .order('created_at', { ascending: false })
          .limit(LIMIT), req);
      if (error) return [];
      return data || [];
    } catch (_) { return []; }
  }

  // A CANDIDATE's history is their own record changes PLUS every stage move on
  // every job they are on — which is what a recruiter actually means by "what
  // happened to this person". One person, several job orders, one timeline.
  async function candidateSubmissionRows(req, candidateId) {
    const { data: subs } = await withOrg(
      supabase.from('submissions').select('id,job_order_id').eq('candidate_id', candidateId), req);
    const ids = (subs || []).map(s => s.id);
    if (!ids.length) return [];
    const { data } = await supabase.from('submission_activity')
      .select('*, recruiter:users(id,name)')
      .in('submission_id', ids)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return data || [];
  }

  // GET /history/:entity/:id
  //   -> { entity, id, title, entries: [...], count }
  router.get('/history/:entity/:id', auth, async (req, res) => {
    try {
      const entity = String(req.params.entity || '');
      const id = String(req.params.id || '');

      if (!H.isEntity(entity)) {
        return res.status(400).json({ error: 'unknown_record_kind', kinds: H.ENTITIES });
      }
      // A malformed id never reaches the database — same rule as the apply page.
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'not_found' });

      const parent = await loadParent(req, entity, id);
      if (!parent) return res.status(404).json({ error: 'not_found' });

      const lists = [];
      if (entity === 'lead') {
        lists.push((await leadRows(req, id)).map(H.fromActivityLog));
      } else if (entity === 'submission') {
        lists.push((await submissionRows(req, id)).map(H.fromSubmissionActivity));
      } else if (entity === 'candidate') {
        lists.push((await candidateSubmissionRows(req, id)).map(H.fromSubmissionActivity));
      }
      lists.push((await generalRows(req, entity, id)).map(H.fromRecordHistory));

      const entries = H.timeline(lists).slice(0, LIMIT);
      res.json({
        entity,
        id,
        title: titleOf(entity, parent),
        entries,
        count: entries.length,
      });
    } catch (e) {
      res.status(500).json({ error: 'history_failed', detail: e.message });
    }
  });

  function titleOf(entity, p) {
    if (!p) return null;
    if (entity === 'lead') return p.position || null;
    if (entity === 'candidate') return [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
    if (entity === 'job_order') return p.job_title || null;
    if (entity === 'company') return p.name || null;
    if (entity === 'submission') return p.stage || null;
    return null;
  }

  return router;
};
