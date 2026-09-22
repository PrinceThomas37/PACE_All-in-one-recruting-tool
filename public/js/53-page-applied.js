// APPLICANTS — people who applied to us through a published apply link.
// (Session 28. Lives inside the Candidates tab, beside All Candidates and
// Sourcing, and is also embedded on a job order's own page.)
//
// WHY THIS IS A VIEW OF SOURCING AND NOT A NEW POOL. An applicant is staged in
// `sourcing_candidates` exactly like a CSV row — inert until a recruiter
// imports them — so this screen reads the SAME endpoint and imports through the
// SAME endpoint as the Sourcing review queue. A second import path is how two
// screens come to disagree about what "imported" means, and the repo has paid
// for that mistake before (two live candidate-outreach workflows, Session 22).
//
// What is different here is the QUESTION being asked. Sourcing asks "who have
// we collected?"; this asks "who put their hand up, and for what?" — so the job
// they applied to is the column that matters, it defaults to newest first, and
// importing one pre-selects the job they applied for rather than making the
// recruiter pick it again.
(function () {
  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function st(){
    if (!STATE.applied) STATE.applied = { rows:[], loading:false, loaded:false, jobId:null, busy:{} };
    return STATE.applied;
  }

  // "3 minutes ago" / "Yesterday" / a date. An application is time-sensitive in
  // a way a CSV row is not — somebody is waiting to hear back — so the age is
  // the first thing the row says, not a raw timestamp nobody reads.
  function whenLabel(iso){
    if (!iso) return '—';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '—';
    var mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 30) return days + ' days ago';
    return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  // ── data ──────────────────────────────────────────────────────────────────
  // `status=all` so somebody already imported still appears, marked as such.
  // A list that silently drops the person you just actioned makes it look as
  // though the application was lost.
  function load(jobId){
    var s = st();
    s.jobId = jobId || null;
    s.loading = true; render();
    var q = '/sourcing/staged?provider=apply&status=all' + (jobId ? '&job_order_id=' + encodeURIComponent(jobId) : '');
    return apiGet(q).then(function(d){
      s.rows = d || []; s.loading = false; s.loaded = true; render();
    }).catch(function(e){
      s.loading = false; s.loaded = true; s.rows = [];
      showToast('Could not load applicants: ' + e.message, 'error'); render();
    });
  }
  window.appliedLoad = load;
  window.appliedNewCount = function(){ var s = st(); return (s.rows||[]).filter(function(r){ return r.status === 'new'; }).length; };

  // ── actions ───────────────────────────────────────────────────────────────
  // Every onclick this page emits is defined in this page (Session 21 rule).
  window.appliedOpenResume = function(id){
    apiGet('/sourcing/staged/' + id + '/resume').then(function(r){
      if (r && r.url) window.open(r.url, '_blank', 'noopener');
      else showToast('No resume on this application.', 'error');
    }).catch(function(e){ showToast('Could not open the CV: ' + e.message, 'error'); });
  };

  // Imports through the SAME endpoint the Sourcing queue uses, pre-tagged with
  // the job this person applied to — which is the whole point of the screen.
  window.appliedImport = function(id, jobId){
    var s = st();
    if (s.busy[id]) return;
    s.busy[id] = true; render();
    apiPost('/sourcing/staged/' + id + '/import', { job_order_id: jobId || undefined })
      .then(function(){ showToast('Added to candidates', 'success'); s.busy[id] = false; load(s.jobId); })
      .catch(function(e){
        s.busy[id] = false;
        // A duplicate is not a failure, it is a decision — say who it clashes
        // with rather than just refusing.
        showToast('Not imported: ' + e.message, 'error'); render();
      });
  };

  window.appliedOpenCandidate = function(cid){
    if (!cid) return;
    if (window.openCandidate) return openCandidate(cid);
    STATE.page = 'applicants'; STATE.ats.view = 'grid'; render();
  };

  window.appliedRefresh = function(){ load(st().jobId); };

  // ── rows ──────────────────────────────────────────────────────────────────
  function rowsFor(list, opts){
    opts = opts || {};
    return (list || []).map(function(r){
      var aj = r.applied_job || {};
      var imported = r.status === 'imported' || !!r.imported_candidate_id;
      var who = UI.idCell(r.full_name || '—', [r.email, r.phone].filter(Boolean).join(' · '), null);

      var jobCell = opts.hideJob ? null : (aj.title
        ? UI.idCell(aj.title, aj.code || '', null)
        : '<span style="color:var(--text3)">—</span>');

      var dupNote = r.dup_candidate_id && !imported
        ? '<div style="font-size:11px;color:var(--amber,#92400e);margin-top:3px">Already in candidates</div>' : '';

      var statusCell = imported
        ? UI.pill('Imported', 'ok')
        : (r.dup_candidate_id ? UI.pill('Duplicate', 'warn') : UI.pill('New', 'info'));

      var resumeBtn = r.resume_url
        ? '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();appliedOpenResume(\'' + esc(r.id) + '\')" style="font-size:11.5px">CV</button>'
        : '<span style="color:var(--text3);font-size:12px">No CV</span>';

      var actionBtn = imported
        ? (r.imported && r.imported.id
            ? '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();appliedOpenCandidate(\'' + esc(r.imported.id) + '\')" style="font-size:11.5px">Open</button>'
            : '<span style="color:var(--text3);font-size:12px">—</span>')
        : '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();appliedImport(\'' + esc(r.id) + '\',\'' + esc(aj.id || '') + '\')" style="font-size:11.5px"' +
          (st().busy[r.id] ? ' disabled' : '') + '>' + (st().busy[r.id] ? 'Adding…' : 'Add to candidates') + '</button>';

      var cells = [{ html: who + dupNote }];
      if (jobCell !== null) cells.push({ html: jobCell });
      cells.push({ cls:'tight', html:'<span style="font-size:12.5px">' + esc(whenLabel(aj.applied_at || r.created_at)) + '</span>' });
      cells.push({ cls:'tight', html:'<span style="font-size:12.5px">' + esc(r.location || '—') + '</span>' });
      cells.push({ cls:'tight', html: statusCell });
      cells.push({ cls:'tight', html: resumeBtn + ' ' + actionBtn });
      return { id: r.id, cells: cells };
    });
  }

  function cols(hideJob){
    var c = [{ label:'Applicant' }];
    if (!hideJob) c.push({ label:'Applied for' });
    c.push({ label:'When' }, { label:'Location' }, { label:'Status' }, { label:'' });
    return c;
  }

  // ── the Candidates-tab view ───────────────────────────────────────────────
  window.renderApplied = function(){
    var s = st();
    var list = s.rows || [];
    var nNew = list.filter(function(r){ return r.status === 'new'; }).length;

    var intro = '<div style="font-size:12.5px;color:var(--text3);margin-bottom:10px">' +
      'People who applied through a job\'s public apply link. They are not in the candidate database yet — ' +
      'open the CV, then add the ones worth keeping.' +
      '</div>';

    // UI.toolbar takes `search`, `icons` and `right` — there is no `left`, and
    // passing one drops it silently, so the count goes in `right` beside the
    // button rather than into a key the kit does not read.
    var toolbar = UI.toolbar({
      right: '<span style="font-weight:600;font-size:13px;margin-right:10px">' +
               (s.loading ? 'Loading…' : (nNew + (nNew === 1 ? ' new application' : ' new applications'))) + '</span>' +
             '<button class="btn btn-sm btn-outline" onclick="appliedRefresh()" style="font-size:11.5px">Refresh</button>'
    });

    var body = intro + UI.table({
      cols: cols(false),
      rows: rowsFor(list, {}),
      empty: s.loading ? 'Loading…'
        : 'No applications yet. Publish a job\'s apply link from its job page, then post that link anywhere you like.'
    });

    return UI.page({ tabs: (window.atsTabBar ? atsTabBar() : ''), toolbar: toolbar, body: body });
  };

  // ── the block embedded on a job order ─────────────────────────────────────
  // Returns html for the job page. It reads the SAME STATE, so whichever screen
  // loaded last is what both show — there is no second copy of the list.
  window.renderJobApplicants = function(jobId){
    var s = st();
    var list = (s.rows || []).filter(function(r){
      return r.applied_job && String(r.applied_job.id) === String(jobId);
    });
    var nNew = list.filter(function(r){ return r.status === 'new'; }).length;

    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">' +
      '<div style="font-weight:600;font-size:14px">Applicants' +
        (nNew ? ' <span style="font-size:11px;color:var(--green,#166534);font-weight:600">· ' + nNew + ' new</span>' : '') +
      '</div>' +
      '<button class="btn btn-sm btn-outline" onclick="appliedRefresh()" style="font-size:11.5px">Refresh</button>' +
    '</div>';

    var body = s.loading
      ? '<div style="font-size:12.5px;color:var(--text3)">Loading…</div>'
      : UI.table({
          cols: cols(true),
          rows: rowsFor(list, { hideJob:true }),
          empty: 'Nobody has applied through this job\'s link yet.'
        });

    return '<div class="card" style="padding:16px;margin-bottom:16px">' + head + body + '</div>';
  };
})();
