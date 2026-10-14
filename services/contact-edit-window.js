// WHO MAY EDIT THE PEOPLE ON A LEAD (owner, 14 Oct: "should an RA lead be able to edit a lead's contacts? — within 24 hours, which the
// admin set up in the admin panel").
//
// Until now only an admin, or the person who made / was given the lead, could add, change or remove its contacts
// (middleware/authorize.js canTouchJob). An RA lead — who answers for the researchers' work — could not correct a wrong name or email
// on a lead their team made. Now they can, for leads made by someone in their reporting chain, for as long as the SAME window the
// admin already sets for researchers ("RA self-edit window", Admin → System settings → Leads, `ra_edit_window_hours`) after the lead
// was created. The window is the admin's number — not typed here (D-0123).
//
// ONE rule, asked by two callers so they can never disagree: canTouchJob (the server's gate on every contact write) and
// GET /jobs/:id/edit-rights (what the Edit lead window offers). A button is only offered when the server would accept it.
//
// PURE: no database, no clock. The caller loads the lead, the viewer's reporting chain and the setting, and says what time it is.
//
// contactEditRights({ isAdmin, isRaLead, userId, job: { created_by, created_at, assigned_to, assigned_to_bd }, teamIds, windowHours, now })
//   → { allowed, via: 'admin' | 'own' | 'ra_lead_window' | null, until: ISO | null }
// `until` is given whenever the RA-lead window applies to this lead (open or closed) so the screen can say when it closed.

function contactEditRights({ isAdmin, isRaLead, userId, job, teamIds, windowHours, now }) {
  const j = job || {};
  if (isAdmin) return { allowed: true, via: 'admin', until: null };
  if (userId && (j.created_by === userId || j.assigned_to === userId || j.assigned_to_bd === userId)) return { allowed: true, via: 'own', until: null };
  if (isRaLead && j.created_by && Array.isArray(teamIds) && teamIds.indexOf(j.created_by) > -1) {
    const hours = Number(windowHours);
    const made = new Date(j.created_at).getTime();
    if (!(hours > 0) || !isFinite(made)) return { allowed: false, via: null, until: null };   // no window, or no creation time: no edit
    const until = made + hours * 3600000;
    const at = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
    return { allowed: at <= until, via: at <= until ? 'ra_lead_window' : null, until: new Date(until).toISOString() };
  }
  return { allowed: false, via: null, until: null };
}

module.exports = { contactEditRights };
