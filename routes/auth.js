// ============================================================================
// AUTHENTICATION · USERS · USER EMAILS · TEAM ASSIGNMENTS
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/auth')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { mailboxSignatureKey, resolveSignatureHtml } = require('../email-signature');
const { mailboxConnections } = require('../mailbox-health');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, loadMailboxSignatures } = ctx;
  // Multi-tenant scoping — same helpers threaded through routeCtx from index.js.
  const orgIdFor = ctx.orgIdFor || function (req) { return (req && req.orgId) || null; };
  const withOrg = ctx.withOrg || function (query, req) { const o = orgIdFor(req); return o ? query.eq('org_id', o) : query; };
  // Shared reporting-hierarchy primitive (users.manager_id chain) — used to trim
  // cross-team fields out of GET /users for non-admins.
  const { reportingChainIds } = require('../hierarchy')(supabase);

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data: user, error } = await supabase.from('users').select('*')
      .eq('email', email.toLowerCase().trim()).eq('is_active', true).is('deleted_at', null).single();
    if (error || !user) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const roles = user.roles || (user.role ? [user.role] : []);
    const token = jwt.sign(
      { id: user.id, email: user.email, roles, role: roles[0] || 'ra', name: user.name, org_id: user.org_id || null },
      process.env.JWT_SECRET, { expiresIn: '8h' }
    );
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: { ...safeUser, roles } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auth/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const { data: user } = await supabase.from('users').select('password_hash').eq('id', req.user.id).single();
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await supabase.from('users').update({ password_hash: hash, updated_at: new Date() }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════
const USER_COLS = 'id,name,email,role,roles,employee_id,designation,platform,is_active,created_at,manager_id';

router.get('/users', auth, async (req, res) => {
  try {
    const { data, error } = await withOrg(supabase.from('users')
      .select(USER_COLS + ',manager:users!manager_id(id,name)').is('deleted_at', null), req).order('name');
    if (error) throw error;
    let rows = data.map(u => ({ ...u, roles: u.roles || (u.role ? [u.role] : []) }));
    // The full org roster is fetched by every logged-in user (name/avatar/picker
    // lookups), but the hierarchy fields — manager_id / manager — are only ever
    // consumed by admins. For a non-admin, null those out on rows outside their
    // own reporting chain so one user can't read the whole org's reporting graph
    // from their browser. Their own row and everyone under them stay intact.
    if (!hasRole(req, 'admin')) {
      const chain = new Set(await reportingChainIds(req.user.id, orgIdFor(req)));
      rows = rows.map(u => (u.id === req.user.id || chain.has(u.id))
        ? u : { ...u, manager_id: null, manager: null });
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Who a user reports to — any user may report to any other user (flexible
// hierarchy, not a fixed role ladder); admin-only to change. Rejects a cycle
// (setting someone's manager to one of their own reports, direct or
// transitive) and self-management.
router.put('/users/:id/manager', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const { id } = req.params;
    const managerId = req.body.manager_id || null;
    if (managerId === id) return res.status(400).json({ error: "A user can't report to themselves." });
    if (managerId) {
      const { data: allUsers } = await supabase.from('users').select('id,manager_id').is('deleted_at', null);
      const byId = new Map((allUsers || []).map(u => [u.id, u.manager_id]));
      let walk = managerId, hops = 0;
      while (walk && hops < 100) {
        if (walk === id) return res.status(400).json({ error: 'That would create a reporting loop.' });
        walk = byId.get(walk) || null;
        hops++;
      }
    }
    const { data, error } = await supabase.from('users')
      .update({ manager_id: managerId, updated_at: new Date() }).eq('id', id)
      .select(USER_COLS + ',manager:users!manager_id(id,name)').single();
    if (error) throw error;
    res.json({ ...data, roles: data.roles || (data.role ? [data.role] : []) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users/me', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select(USER_COLS).eq('id', req.user.id).single();
    if (error) throw error;
    res.json({ ...data, roles: data.roles || (data.role ? [data.role] : []) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const { name, email, password, roles, role, employee_id, designation, platform } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const userRoles = roles || (role ? [role] : ['ra']);
    // Every new user used to get the SAME password, 'Fute@2024' — hard-coded in
    // this file, shown in the admin UI, and never forced to change. Anyone who
    // had ever seen it could sign in as any newly-created colleague.
    //
    // Now: an admin may still set an explicit password, but the default is a
    // random one nobody knows. That is deliberately NOT a lockout — the intended
    // way in is "Continue with Microsoft / Google", which needs no password at
    // all. An admin who wants a password account sets one on purpose.
    const initialPassword = password || require('crypto').randomBytes(24).toString('base64url');
    const hash = await bcrypt.hash(initialPassword, 10);
    // New staff belong to the creating admin's organization (multi-tenant).
    const orgId = ctx.orgIdFor ? ctx.orgIdFor(req) : (req.orgId || null);
    const { data, error } = await supabase.from('users').insert({
      name, email: email.toLowerCase().trim(), password_hash: hash,
      role: userRoles[0] || 'ra', roles: userRoles,
      employee_id, designation, platform: platform || 'Gmail',
      ...(orgId ? { org_id: orgId } : {})
    }).select(USER_COLS).single();
    if (error) throw error;
    res.status(201).json({ ...data, roles: data.roles || userRoles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!hasRole(req, 'admin') && req.user.id !== id) return res.status(403).json({ error: 'Forbidden' });
    const { name, email, roles, role, employee_id, designation, platform } = req.body;
    const updates = { updated_at: new Date() };
    if (name) updates.name = name;
    if (email) updates.email = email.toLowerCase().trim();
    if (roles && hasRole(req, 'admin')) { updates.roles = roles; updates.role = roles[0] || 'ra'; }
    else if (role && hasRole(req, 'admin')) { updates.role = role; updates.roles = [role]; }
    if (employee_id) updates.employee_id = employee_id;
    if (designation !== undefined) updates.designation = designation;
    if (platform) updates.platform = platform;
    const { data, error } = await supabase.from('users').update(updates).eq('id', id).select(USER_COLS).single();
    if (error) throw error;
    res.json({ ...data, roles: data.roles || (data.role ? [data.role] : []) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update roles only
router.put('/users/:id/roles', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const { roles } = req.body;
    if (!Array.isArray(roles) || !roles.length) return res.status(400).json({ error: 'roles array required' });
    const { data, error } = await supabase.from('users')
      .update({ roles, role: roles[0], updated_at: new Date() })
      .eq('id', req.params.id).select(USER_COLS).single();
    if (error) throw error;
    res.json({ ...data, roles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await supabase.from('users').update({ deleted_at: new Date(), is_active: false }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// USER EMAILS — email IDs per user
// ══════════════════════════════════════════════════════════════
router.get('/users/:id/emails', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('user_emails')
      .select('*').eq('user_id', req.params.id).order('created_at');
    if (error) throw error;
    // Attach ms_connected / gmail_connected flags
    const ids = (data || []).map(e => e.id);
    const { data: tokens } = ids.length
      ? await supabase.from('microsoft_tokens').select('user_email_id').in('user_email_id', ids)
      : { data: [] };
    const connectedSet = new Set((tokens || []).map(t => t.user_email_id));
    let gmailSet = new Set();
    if (ids.length) {
      try {
        const { data: gtok } = await supabase.from('gmail_tokens').select('user_email_id').in('user_email_id', ids);
        gmailSet = new Set((gtok || []).map(t => t.user_email_id));
      } catch (_) { /* gmail_tokens absent (migration 010 not applied) */ }
    }
    // Per-mailbox sign-in health (ok / expired / never-connected) so the UI can
    // show a live "Connected" vs "Sign-in expired — reconnect" badge.
    const conns = await mailboxConnections(supabase, ids);
    res.json((data || []).map(e => ({ ...e, ms_connected: connectedSet.has(e.id), gmail_connected: gmailSet.has(e.id), connection: conns[e.id] || { connected: false, status: 'none' } })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users/:id/emails', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead') && req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    const { email_address, display_name, platform, daily_send_limit, is_primary } = req.body;
    if (!email_address) return res.status(400).json({ error: 'email_address required' });
    // If setting as primary, unset others first
    if (is_primary) {
      await supabase.from('user_emails').update({ is_primary: false }).eq('user_id', req.params.id);
    }
    const { data, error } = await supabase.from('user_emails').insert({
      user_id: req.params.id,
      email_address: email_address.toLowerCase().trim(),
      display_name: display_name || email_address,
      platform: platform || 'Microsoft',
      is_primary: is_primary || false,
      is_active: true,
      daily_send_limit: daily_send_limit || 150
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/users/:id/emails/:eid', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead') && req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    const { is_active, is_primary, display_name, daily_send_limit, platform } = req.body;
    const updates = { updated_at: new Date() };

    // Enforce max 4 active per user
    if (is_active === true) {
      const { count } = await supabase.from('user_emails')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.params.id).eq('is_active', true).neq('id', req.params.eid);
      if (count >= 4) return res.status(400).json({ error: 'Maximum 4 active email IDs allowed per user' });
    }

    if (is_active !== undefined) updates.is_active = is_active;
    if (display_name !== undefined) updates.display_name = display_name;
    if (daily_send_limit !== undefined) updates.daily_send_limit = daily_send_limit;
    if (platform !== undefined) updates.platform = platform;

    // If setting as primary, unset others first
    if (is_primary === true) {
      await supabase.from('user_emails').update({ is_primary: false }).eq('user_id', req.params.id);
      updates.is_primary = true;
    }

    const { data, error } = await supabase.from('user_emails').update(updates)
      .eq('id', req.params.eid).eq('user_id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id/emails/:eid', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead') && req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    await supabase.from('user_emails').delete().eq('id', req.params.eid).eq('user_id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users/:id/emails/:eid/signature', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead') && req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    const { data: mailbox, error } = await supabase.from('user_emails').select('id,user_id,email_address,display_name').eq('id', req.params.eid).eq('user_id', req.params.id).single();
    if (error || !mailbox) return res.status(404).json({ error: 'Email ID not found' });
    const map = await loadMailboxSignatures([mailbox.id], mailbox.user_id);
    const raw = map[mailbox.id] || '';
    const signature_html = resolveSignatureHtml(raw);
    if (raw && signature_html !== raw) {
      const key = mailboxSignatureKey(mailbox.id);
      await supabase.from('app_settings').upsert(
        { key, value: signature_html, updated_at: new Date() },
        { onConflict: 'key' }
      );
    }
    res.json({ signature_html, display_name: mailbox.display_name, email_address: mailbox.email_address });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/emails/:eid/signature', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'bd') && req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    const { signature_html } = req.body;
    if (signature_html === undefined) return res.status(400).json({ error: 'signature_html required' });
    const { data: mailbox, error } = await supabase.from('user_emails').select('id,user_id').eq('id', req.params.eid).eq('user_id', req.params.id).single();
    if (error || !mailbox) return res.status(404).json({ error: 'Email ID not found' });
    const key = mailboxSignatureKey(mailbox.id);
    const { error: upsertErr } = await supabase.from('app_settings').upsert(
      { key, value: String(signature_html), updated_at: new Date() },
      { onConflict: 'key' }
    );
    if (upsertErr) throw upsertErr;
    res.json({ success: true, signature_html: String(signature_html) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// TEAM ASSIGNMENTS
// ══════════════════════════════════════════════════════════════
router.get('/team-assignments', auth, async (req, res) => {
  try {
    const { data, error } = await withOrg(supabase.from('team_assignments')
      .select('*, member:users!member_id(id,name,email,roles,role), manager:users!manager_id(id,name,email,roles,role)'), req)
      .order('created_at');
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/team-assignments', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const { member_id, manager_id, assignment_type } = req.body;
    if (!member_id || !manager_id || !assignment_type) return res.status(400).json({ error: 'member_id, manager_id, assignment_type required' });
    const orgId = orgIdFor(req);
    const { data, error } = await supabase.from('team_assignments')
      .insert({ member_id, manager_id, assignment_type, ...(orgId ? { org_id: orgId } : {}) }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/team-assignments/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    await supabase.from('team_assignments').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
