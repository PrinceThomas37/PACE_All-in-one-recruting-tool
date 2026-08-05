// ============================================================================
// BD MANAGER / RECRUITER WORKFLOW — BACKEND ROUTES
// ----------------------------------------------------------------------------
// Mounted from index.js with a single line:
//
//     require('./bd_recruiter_routes')(app, { supabase, db, auth, hasRole, today });
//
// This file used to BE all ~65 recruiting routes plus every helper they share:
// one 2,140-line closure. It is now just the mounter. The routes live in
// routes/recruiting/*, and the helpers they share are built once in
// services/recruiting-core.js and handed to each module.
//
// Nothing about the HTTP surface changed in that move — same paths, same
// handlers, same order.
//
// REGISTRATION ORDER IS LOAD-BEARING. These modules register directly on `app`
// (not as mounted Routers), so express matches in registration order and the
// order below must stay as it is. Two live examples:
//   • /job-orders/browse must be registered before /job-orders/:id, or "browse"
//     is parsed as an id.
//   • /candidates/check-duplicate must come before /candidates/:id.
// Both pairs sit inside a single module, so the module order below is what
// preserves the rest. Reordering these lines can silently shadow a route.
// ============================================================================

const createRecruitingCore = require('./services/recruiting-core');

module.exports = function (app, deps) {
  // One shared closure for every recruiting route module: org helpers, the
  // stage vocabulary, role gates, id/activity helpers and the relevance
  // plumbing. Built once so the modules below cannot drift from each other.
  const core = createRecruitingCore(deps);

  require('./routes/recruiting/job-orders')(app, core);
  require('./routes/recruiting/candidates')(app, core);
  require('./routes/recruiting/submissions')(app, core);
  require('./routes/recruiting/pipeline')(app, core);
  require('./routes/recruiting/lookups')(app, core);
  require('./routes/recruiting/sourcing')(app, core);
  require('./routes/recruiting/analytics')(app, core);

  console.log('[BD-Recruiter] Routes mounted (job-orders, candidates, pipeline, submissions, recruiter assignment, analytics)');
};
