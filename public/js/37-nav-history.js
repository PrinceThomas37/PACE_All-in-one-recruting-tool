// ===== NAVIGATION HISTORY / BREADCRUMB MODULE (additive) =====
// A file-manager-style trail for the recruiting workflow so "Back" returns to
// the exact place you came from (and a breadcrumb shows the path), instead of
// resetting to a fixed default list.
//
// The trail has at most three levels:
//   root (a list page)  ›  job (Candidates / Board / Job details tab)  ›  candidate
// Switching between a job's tabs replaces the job level (they are siblings);
// opening a candidate pushes a deeper level. Back pops one level; a breadcrumb
// crumb jumps straight to that level. It works by wrapping the existing openers
// (bdOpenPipeline / bdOpenKanban / bdOpenJobOrder / bdOpenCandidate) — so every
// entry point (dashboard cards, job board, My Jobs, etc.) feeds the same trail.

(function () {
  if (!STATE.nav) STATE.nav = { stack: [] };
  var replaying = false;

  var ROOT_LABELS = { bd_joborders:'Jobs', bd_myjobs:'My Jobs', job_board:'All Jobs', applicants:'Candidates', dashboard:'Dashboard' };
  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function jobById(jid){ return ((STATE.bd&&STATE.bd.jobOrders)||[]).find(function(j){ return j.id===jid; }) || null; }
  function jobLabel(jid){ var j=jobById(jid); return j ? (j.job_title || j.job_code || 'Job') : 'Job'; }
  function candLabel(cid){
    var p = STATE.bd && STATE.bd.profile;
    if (p && p.id===cid && p.candidate) return p.candidate.full_name || 'Candidate';
    var row = ((STATE.bd&&STATE.bd.pipeline)||[]).find(function(x){ return (x.candidate||{}).id===cid; });
    if (row && row.candidate) return row.candidate.full_name || 'Candidate';
    return 'Candidate';
  }

  function level(d){ return d.k==='root' ? 0 : (d.k==='candidate' ? 2 : 1); }
  function sameDesc(a,b){ return a.k===b.k && a.jid===b.jid && a.cid===b.cid && a.page===b.page; }
  function labelOf(d){
    if (d.k==='root') return ROOT_LABELS[d.page] || 'Back';
    if (d.k==='kanban') return jobLabel(d.jid)+' · Board';
    if (d.k==='pipeline' || d.k==='jodetail') return jobLabel(d.jid);
    if (d.k==='candidate') return candLabel(d.cid);
    return '';
  }

  // Where we're navigating FROM becomes the trail's root anchor.
  function currentRootDesc(){
    var pg = STATE.page;
    if (ROOT_LABELS[pg]) return { k:'root', page:pg };
    var u = STATE.user;
    var bdm = window.userHasAnyRole && userHasAnyRole(u,'admin','bd','bd_lead');
    return { k:'root', page: bdm ? 'bd_joborders' : 'bd_myjobs' };
  }

  function record(desc){
    if (replaying) return;
    var stack = STATE.nav.stack;
    if (desc.k==='root'){ STATE.nav.stack = [desc]; return; }
    var L = level(desc);
    var kept = stack.filter(function(e){ return level(e) < L; });   // keep shallower levels
    // If we're drilling in FROM a known list page, anchor the trail there so the
    // breadcrumb root reflects where you actually came from (My Jobs vs All Jobs …).
    var curRoot = ROOT_LABELS[STATE.page] ? { k:'root', page:STATE.page } : null;
    if (curRoot) kept = [curRoot];
    else if (!kept.some(function(e){ return e.k==='root'; })) kept.unshift(currentRootDesc());
    if (kept.length && sameDesc(kept[kept.length-1], desc)){ STATE.nav.stack = kept; return; }
    kept.push(desc);
    STATE.nav.stack = kept;
  }

  function reopen(desc){
    replaying = true;
    try {
      if (desc.k==='root') _goPage(desc.page);
      else if (desc.k==='pipeline') window.bdOpenPipeline(desc.jid);
      else if (desc.k==='kanban') window.bdOpenKanban(desc.jid);
      else if (desc.k==='jodetail') window.bdOpenJobOrder(desc.jid);
      else if (desc.k==='candidate') window.bdOpenCandidate(desc.cid);
    } finally { replaying = false; }
  }

  // ── wrap the workflow openers so every entry point feeds the trail ──────────
  var _pipe = window.bdOpenPipeline;   window.bdOpenPipeline  = function(jid){ record({k:'pipeline', jid:jid}); return _pipe && _pipe.apply(this, arguments); };
  var _kan  = window.bdOpenKanban;     window.bdOpenKanban    = function(jid){ record({k:'kanban',   jid:jid}); return _kan  && _kan.apply(this, arguments); };
  var _jod  = window.bdOpenJobOrder;   window.bdOpenJobOrder  = function(jid){ record({k:'jodetail', jid:jid}); return _jod  && _jod.apply(this, arguments); };
  var _cand = window.bdOpenCandidate;  window.bdOpenCandidate = function(cid){ record({k:'candidate',cid:cid}); return _cand && _cand.apply(this, arguments); };
  var _goPage = window.goPage;         // fully-wrapped goPage (all page modules already loaded)

  // Put the person back where they were after their sign-in ran out (R-118, 23-auth.js): restore the saved trail,
  // then open each level in order — the list page, the job, the candidate — the way a click would have.
  // Each opener loads its own data, so the levels are replayed one after another, never all at once.
  window.navResume = function(saved){
    if (!Array.isArray(saved) || !saved.length) return false;
    var trail = saved.filter(function(d){ return d && d.k; });
    if (!trail.length) return false;
    STATE.nav.stack = trail;
    var i = 0;
    (function next(){
      if (i >= trail.length) return;
      var d = trail[i++];
      reopen(d);
      // a deeper level opens over what the previous one painted: give that a moment to load first
      if (i < trail.length) setTimeout(next, 450);
    })();
    return true;
  };

  // ── public API used by the page templates ──────────────────────────────────
  window.navBack = function(){
    var stack = STATE.nav.stack;
    if (stack.length > 1){ stack.pop(); reopen(stack[stack.length-1]); return; }
    if (stack.length === 1){ reopen(stack[0]); return; }
    var d = currentRootDesc(); STATE.nav.stack = [d]; reopen(d);
  };
  window.navGoTo = function(i){
    var stack = STATE.nav.stack;
    if (i < 0 || i >= stack.length) return;
    var target = stack[i];
    STATE.nav.stack = stack.slice(0, i+1);
    reopen(target);
  };
  window.navBar = function(){
    var stack = (STATE.nav && STATE.nav.stack) || [];
    if (!stack.length) return '<div style="margin-bottom:8px"><span onclick="navBack()" style="cursor:pointer;font-size:12.5px;color:var(--accent)">← Back</span></div>';
    var crumbs = stack.map(function(e,i){
      var last = i === stack.length-1;
      var lbl = esc(labelOf(e));
      if (last) return '<span style="font-size:12.5px;color:var(--text2);font-weight:600">'+lbl+'</span>';
      return '<span onclick="navGoTo('+i+')" style="cursor:pointer;font-size:12.5px;color:var(--accent)">'+lbl+'</span>'+
             '<span style="color:var(--text3);margin:0 7px">›</span>';
    }).join('');
    var back = stack.length>1 ? '<span onclick="navBack()" title="Back" style="cursor:pointer;color:var(--accent);font-weight:700;margin-right:10px">←</span>' : '';
    return '<div style="margin-bottom:10px;display:flex;align-items:center;flex-wrap:wrap;gap:2px">'+back+crumbs+'</div>';
  };
})();
