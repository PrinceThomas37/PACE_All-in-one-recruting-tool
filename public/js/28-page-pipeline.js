// ===== JOB PIPELINE (TAGGING) MODULE (additive) =====
// The Ceipal "Pipeline" tab for a job order: candidates TAGGED to the job (a
// lightweight sourcing bucket, PL- ids) before being promoted to a formal
// submission. Reached from the BD job detail and the recruiter board. Slice 2 of
// docs/ATS_RECRUITING_PLAN.md.

(function () {

  var PIPELINE_STATUSES = ['Tagged','Contacted','Interested','Screening','Shortlisted','Moved to Submission','Not Interested','Rejected'];
  var PSTATUS_COLORS = { 'Tagged':'var(--text3)','Contacted':'#6b7280','Interested':'#2563eb','Screening':'var(--amber)',
    'Shortlisted':'#7c3aed','Moved to Submission':'var(--green)','Not Interested':'#9ca3af','Rejected':'var(--red)' };

  if (STATE.bd) { STATE.bd.pipeline = STATE.bd.pipeline || []; STATE.bd.view = STATE.bd.view || {}; STATE.bd.plSel = STATE.bd.plSel || {}; }

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function code(t){ return '<span style="font-family:var(--mono);font-size:10.5px;color:var(--text3);font-weight:600">'+esc(t)+'</span>'; }
  var SUBSTAGE_COLORS={"Sourced":"var(--text3)","Screening":"#6b7280","Submitted to BDM":"var(--amber)","Submitted to Client":"var(--accent)","Interview Scheduled":"#2563eb","Interview Completed":"#1d4ed8","Offer":"#7c3aed","Joining":"#0891b2","Placement":"var(--green)","Not Accepted":"var(--red)","On Hold":"#9ca3af"};
  // Stage ranking used to decide when a candidate has actually been *submitted*.
  // A candidate is only "Submitted" once they reach "Submitted to BDM" (i.e. sent
  // to the BD team) — before that they are merely Added/Sourced/Screening.
  var STAGE_RANK={"Sourced":0,"Screening":1,"Submitted to BDM":2,"Submitted to Client":3,"Interview Scheduled":4,"Interview Completed":5,"Offer":6,"Joining":7,"Placement":8};
  var SUBMITTED_RANK=2;
  function isBDM(u){ return userHasAnyRole(u,'admin','bd','bd_lead'); }
  function isRec(u){ return userHasRole(u,'recruiter'); }
  function joById(id){ return (STATE.bd.jobOrders||[]).find(function(j){ return j.id===id; }); }
  function fmtDate(s){ if(!s)return '—'; try{ var d=new Date(s); return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2); }catch(e){ return '—'; } }
  function candLoc(c){ return [c.city,c.state].filter(Boolean).join(', ') || c.current_location || '—'; }

  // What a recruiter (or anyone) needs to actually work a req: description,
  // pay, location, work auth, skills, experience — shown to EVERYONE, not
  // gated behind the BD-only "Job details" tab which also carries BD-only
  // controls (assign recruiter, approvals, posting JD).
  function renderJobSummaryCard(j){
    var loc = [j.city,j.state,j.country,j.zip].filter(Boolean).join(', ');
    var pay = (j.pay_min||j.pay_max) ? ((j.pay_cur||'USD')+' '+(j.pay_min||'?')+'–'+(j.pay_max||'?')) : '';
    var exp = (j.exp_min||j.exp_max) ? ((j.exp_min||'0')+'–'+(j.exp_max||'?')+' yrs') : '';
    function dr(lbl,val){ return val?'<div style="font-size:12.5px;margin-bottom:4px"><span style="color:var(--text3)">'+esc(lbl)+': </span>'+esc(val)+'</div>':''; }
    var bdName = j.bd_manager && j.bd_manager.name;
    var creatorName = j.creator && j.creator.name;
    var grid = dr('BD Manager',bdName)+(creatorName&&creatorName!==bdName?dr('Created by',creatorName):'')+
      dr('Location',loc)+dr('Pay Rate',pay)+dr('Job Type',j.job_type)+
      dr('Employment Level',j.emp_level)+dr('Work Authorization',j.work_auth)+dr('Remote',j.remote)+
      dr('Priority',j.priority)+dr('Positions',j.positions)+dr('Experience',exp)+
      dr('Primary Skills',j.primary_skills)+dr('Secondary Skills',j.secondary_skills)+dr('Industry',j.industry);
    var descId = 'pl-jd-'+j.id;
    var longDesc = !!(j.job_description && j.job_description.length > 320);
    // Always show a Job Description block (placeholder if the BDM left it
    // empty) — recruiters kept landing on candidates with no req context, so
    // this section must never silently disappear.
    var descBody = j.job_description
      ? '<div id="'+descId+'" style="font-size:13px;line-height:1.5;white-space:pre-wrap;'+(longDesc?'max-height:110px;overflow:hidden':'')+'">'+esc(j.job_description)+'</div>'+
        (longDesc?'<button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="var el=document.getElementById(\''+descId+'\');var open=el.style.maxHeight===\'none\';el.style.maxHeight=open?\'110px\':\'none\';el.style.overflow=open?\'hidden\':\'visible\';this.textContent=open?\'Show more\':\'Show less\'">Show more</button>':'')
      : '<div style="font-size:12.5px;color:var(--text3);font-style:italic">No job description was provided by the BD team yet.</div>';
    var desc =
      '<div style="margin-top:'+(grid?'12px':'0')+';padding-top:'+(grid?'12px':'0')+(grid?';border-top:1px solid var(--border)':'')+'">'+
        '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Job Description</div>'+descBody+
      '</div>';
    return '<div class="card" style="padding:16px 18px;margin-bottom:14px">'+
      (grid?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px 18px">'+grid+'</div>':'')+
      desc+
    '</div>';
  }

  function loadPipeline(jid){
    return apiGet('/job-orders/'+jid+'/pipeline').then(function(d){
      STATE.bd.pipeline = d||[];
      // Seed STATE.bd.submissions from promoted rows so the shared stage modal
      // can resolve each candidate's current stage + name for its confirmation.
      STATE.bd.submissions = (d||[]).filter(function(p){ return p.submission; })
        .map(function(p){ return Object.assign({}, p.submission, { candidate: p.candidate }); });
    }).catch(function(e){ STATE.bd.pipeline = []; showToast('Failed to load pipeline: '+e.message,'error'); });
  }

  // joById() only searches STATE.bd.jobOrders, which is populated by the
  // My Jobs / Jobs list loader. Entry points that reach a job WITHOUT going
  // through that list first — the All Jobs board, the recruiter dashboard's
  // "My jobs" top-5 card — never populate it, so opening a job straight from
  // there showed "Job not found" even though the job is real and the caller
  // is assigned to it. Fetch the single job order directly whenever it's
  // missing, so Candidates always has what it needs regardless of entry point.
  function ensureJobOrder(jid){
    if (joById(jid)) return Promise.resolve();
    return apiGet('/job-orders/'+jid).then(function(j){
      if (j && j.id){
        STATE.bd.jobOrders = STATE.bd.jobOrders || [];
        if (!STATE.bd.jobOrders.some(function(x){ return x.id===j.id; })) STATE.bd.jobOrders.push(j);
      }
    }).catch(function(){ /* joById() will report "Job not found" if this fails */ });
  }

  // ── render + routing wrap (mirrors the applicants module) ────────────────────
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page === 'bd_pipeline'){
      paintPipelinePage();
      var t = document.querySelector('.tb-title'); if (t) t.textContent = 'Candidates';
    }
  };
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p === 'bd_pipeline'){ STATE.page='bd_pipeline'; STATE.modal=null; render(); return; }
    return _prevGoPage.apply(this, arguments);
  };

  window.bdOpenPipeline = function(jid){
    STATE.bd.view = STATE.bd.view || {}; STATE.bd.view.pipelineJoId = jid;
    Promise.all([ ensureJobOrder(jid), loadPipeline(jid) ]).then(function(){ goPage('bd_pipeline'); });
  };
  // The standalone "Submissions" tab (29-page-submissions.js) was merged into
  // this "Candidates" tab and removed. Kept as a thin alias so every existing
  // caller (dashboard top-jobs, job board, My Jobs cards, candidate profile,
  // board/job-detail buttons) keeps working unchanged.
  window.bdOpenSubmissions = function(jid){ bdOpenPipeline(jid); };
  window.bdReloadPipeline = function(){
    var jid = STATE.bd.view && STATE.bd.view.pipelineJoId; if(!jid) return;
    loadPipeline(jid).then(function(){ render(); });
  };

  function paintPipelinePage(){ var c=document.getElementById('content'); if(!c) return; c.innerHTML = renderPipelinePage(); }

  // ── the page ──────────────────────────────────────────────────────────────
  window.renderPipelinePage = function(){
    var u = STATE.user;
    var jid = STATE.bd.view && STATE.bd.view.pipelineJoId;
    var j = joById(jid);
    if (!j) return '<div class="page"><div style="padding:40px;text-align:center;color:var(--text3)">Job not found.</div></div>';
    var rows = (STATE.bd.pipeline||[]).filter(function(p){ return p.job_order_id===jid; });
    // Match scoring: best-fit candidates float to the top by default (the whole
    // point of the feature), with a toggle back to "recently added".
    var sortMode = STATE.bd.plSort || 'match';
    if (sortMode === 'match' && window.matchScoreValue){
      rows = rows.slice().sort(function(a,b){ return matchScoreValue(b.candidate||{}, j) - matchScoreValue(a.candidate||{}, j); });
    }

    // Job details FIRST — what a recruiter needs to actually work the req:
    // description, pay, location, work auth, skills, experience. Visible to
    // everyone (not just BD), unlike the separate "Job details" tab which
    // also carries BD-only controls (assign recruiter, approvals, posting JD).
    var jobCard = renderJobSummaryCard(j);

    var tabs =
      '<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px">'+
        '<div style="padding:8px 16px;font-size:13px;font-weight:700;color:var(--accent);border-bottom:2px solid var(--accent)">Candidates ('+rows.length+')</div>'+
        '<div style="padding:8px 16px;font-size:13px;font-weight:600;color:var(--text3);cursor:pointer" onclick="bdOpenKanban(\''+j.id+'\')">Board</div>'+
        (isBDM(u)?'<div style="padding:8px 16px;font-size:13px;font-weight:600;color:var(--text3);cursor:pointer" onclick="bdOpenJobOrder(\''+j.id+'\')">Job details</div>':'')+
      '</div>';

    // multi-select bulk bar (ported from the old Submissions tab): sequence
    // the promoted candidates, or email the JD to the selected ones. Wrapped in a
    // stable #pl-bulkbar container so toggling a checkbox can repaint JUST the bar
    // (via plRepaintSelection) instead of re-rendering the whole page — which was
    // resetting the scroll position to the top on every checkbox click.
    var sel = STATE.bd.plSel || {};
    var bulkBar = '<div id="pl-bulkbar">'+plBulkBarInner(rows.filter(function(p){ return sel[p.id]; }).length)+'</div>';

    var allOn = rows.length && rows.every(function(p){ return sel[p.id]; });
    var head = '<th style="padding:8px 9px"><input id="pl-chk-all" type="checkbox" '+(allOn?'checked':'')+' onclick="plToggleSelAll()"></th>'+
      ['Pipeline ID','Candidate Name','Title','Match','Stage','Work Auth','Mobile','Email','Location','Country','Exp','Source','Resume',
      'Bill Rate','Pay Rate','Employer','Availability','Notice','Current CTC','Tagged By','Tagged On','']
      .map(function(h){ return '<th style="text-align:left;padding:8px 9px;font-size:11px;color:var(--text3);font-weight:700;white-space:nowrap">'+h+'</th>'; }).join('');

    var body = rows.map(function(p){
      var c = p.candidate || {};
      // ONE stage control everywhere: the same submission-stage dropdown the
      // Submissions grid and Board use, routed through the shared stage modal.
      // Un-promoted rows show "Not submitted"; picking a stage promotes the
      // candidate (materializes the submission) and opens the notes modal.
      var promoted = !!p.submission_id;
      var curStage = p.submission ? (window.normalizeStage?normalizeStage(p.submission.stage||''):(p.submission.stage||'')) : '';
      // "Submitted" must mean actually sent to the BD team (stage ≥ Submitted to
      // BDM) — NOT merely tagged/promoted. A freshly added candidate reads
      // "Added"; an early-stage one shows nothing extra (the Stage cell says it).
      var isSubmitted = promoted && STAGE_RANK[curStage]!=null && STAGE_RANK[curStage] >= SUBMITTED_RANK;
      var statusMark = !promoted
        ? '<span style="font-size:11px;color:var(--text3);font-weight:700;background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:10px;margin-right:4px">Added</span>'
        : (isSubmitted ? '<span style="font-size:11px;color:var(--green);font-weight:700;margin-right:4px">✓ Submitted</span>' : '');
      var stageOpts = (window.ATS_STAGE_LIST||[]).map(function(x){
        return '<option value="'+esc(x)+'"'+(curStage===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('');
      var statusSel =
        '<select class="sel" style="font-size:11px;padding:3px 6px;min-width:150px;color:'+(SUBSTAGE_COLORS[curStage]||'var(--text2)')+';font-weight:600" onchange="plMove(\''+p.id+'\',\''+(p.submission_id||'')+'\',this.value)">'+
          (promoted?'':'<option value="">Not submitted</option>')+
          stageOpts+
        '</select>'+
        (p.submission&&p.submission.sub_stage?'<div style="font-size:10px;color:var(--text3);margin-top:2px">'+esc(p.submission.sub_stage)+'</div>':'');
      var resume = c.resume_url ? '<a href="'+esc(c.resume_url)+'" target="_blank" rel="noopener" style="color:var(--accent)">↗</a>' : '—';
      return '<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:8px 9px"><input id="pl-chk-'+p.id+'" type="checkbox" '+(sel[p.id]?'checked':'')+' onclick="plToggleSel(\''+p.id+'\')"></td>'+
        '<td style="padding:8px 9px;white-space:nowrap">'+code(p.pipeline_code||'—')+'</td>'+
        '<td style="padding:8px 9px;white-space:nowrap;font-size:12.5px"><span style="font-weight:600;cursor:pointer;color:var(--accent)" onclick="bdOpenCandidate(\''+c.id+'\')">'+esc(c.full_name||'—')+'</span> '+(c.candidate_code?'<span style="font-size:10px;color:var(--text3)">'+esc(c.candidate_code)+'</span>':'')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(c.current_title||c.headline||'—')+'</td>'+
        '<td style="padding:8px 9px">'+(window.matchBadge?matchBadge(matchScore(c,j)):'')+'</td>'+
        '<td style="padding:8px 9px">'+statusSel+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.work_auth_snap||c.work_authorization||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(c.phone||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+(c.email?'<a href="mailto:'+esc(c.email)+'" style="color:var(--accent)">'+esc(c.email)+'</a>':'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(candLoc(c))+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(c.country||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(c.experience_years!=null?c.experience_years:'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.source||c.source||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:14px;text-align:center">'+resume+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.bill_rate||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.pay_rate||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(p.employer_name||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.availability||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.notice_period||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(p.current_ctc||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc((p.tagger&&p.tagger.name)||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;color:var(--text3);white-space:nowrap">'+fmtDate(p.tagged_at)+'</td>'+
        '<td style="padding:8px 9px;white-space:nowrap">'+
          statusMark+
          '<button class="btn btn-sm btn-outline" onclick="plOpenEdit(\''+p.id+'\')">Edit</button>'+
          ' <button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="plRemove(\''+p.id+'\')">✕</button>'+
        '</td>'+
      '</tr>';
    }).join('');
    if (!rows.length) body = '<tr><td colspan="23" style="padding:40px;text-align:center;color:var(--text3)">No candidates on this job yet. '+
      '<span style="color:var(--accent);cursor:pointer" onclick="plOpenAdd(\''+j.id+'\')">Add a candidate →</span></td></tr>';

    return '<div class="page">'+
      (window.navBar?navBar():'')+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<div><div style="display:flex;gap:8px;align-items:center">'+code(j.job_code)+'<span style="font-weight:700;font-size:17px">'+esc(j.job_title||'')+'</span></div>'+
        '<div style="font-size:12.5px;color:var(--text3)">'+esc(j.client||'')+'</div></div>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="btn btn-outline" onclick="bdOpenEditJob(\''+j.id+'\')">Edit job</button>'+
          '<button class="btn btn-outline" onclick="plOpenSourcing(\''+j.id+'\')">Source candidates</button>'+
          '<button class="btn btn-primary" onclick="plOpenAdd(\''+j.id+'\')">+ Add Candidate</button>'+
        '</div>'+
      '</div>'+
      jobCard+
      tabs+bulkBar+
      (rows.length ? '<div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-bottom:8px;font-size:12px">'+
        '<span style="color:var(--text3)">Sort by</span>'+
        ['match','recent'].map(function(m){ var on=sortMode===m;
          return '<button class="btn btn-sm '+(on?'btn-primary':'btn-outline')+'" onclick="plSetSort(\''+m+'\')">'+(m==='match'?'Best match':'Recently added')+'</button>'; }).join('')+
      '</div>' : '')+
      '<div class="card" style="padding:0;overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:1560px">'+
        '<thead><tr style="background:var(--bg)">'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
    '</div>';
  };

  // ── unified stage move (the ONE way to change a candidate's stage) ──────────
  // Promoted rows go straight through the shared stage modal. Un-promoted rows
  // are materialized as a submission first (silent promote to the entry stage),
  // then the SAME modal captures the note and moves to the chosen stage — so
  // there's no separate "Promote" step and no divergent pipeline vocabulary.
  window.plMove = function(pipelineId, submissionId, stage){
    if (!stage) return;
    if (submissionId){
      openStageModal(submissionId, stage, function(){ bdReloadPipeline(); });
      return;
    }
    var u = STATE.user, recruiterScoped = isRec(u) && !isBDM(u);
    if (recruiterScoped && ['Sourced','Screening','Submitted to BDM'].indexOf(stage) < 0){
      showToast('You can take a candidate up to "Submitted to BDM" — the BD team owns the later stages','error'); render(); return;
    }
    apiPost('/pipeline/'+pipelineId+'/promote', { stage:'Sourced' }).then(function(r){
      var sub = r && r.submission; if(!sub){ showToast('Could not promote candidate','error'); return; }
      STATE.bd.submissions = STATE.bd.submissions || [];
      if(!STATE.bd.submissions.some(function(x){ return x.id===sub.id; })) STATE.bd.submissions.push(sub);
      if (stage === sub.stage){ showToast('Promoted to submission','success'); bdReloadPipeline(); return; }
      openStageModal(sub.id, stage, function(){ bdReloadPipeline(); });
    }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };
  // ── multi-select + bulk actions (ported from the old Submissions tab) ───────
  function plCurrentRows(){
    var jid = STATE.bd.view && STATE.bd.view.pipelineJoId;
    return (STATE.bd.pipeline||[]).filter(function(p){ return p.job_order_id===jid; });
  }
  function plSelectedRows(){ var sel=STATE.bd.plSel||{}; return plCurrentRows().filter(function(p){ return sel[p.id]; }); }
  // The selection bulk-bar html (empty when nothing is selected).
  function plBulkBarInner(count){
    if(!count) return '';
    return '<div class="card" style="padding:9px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span style="font-size:12.5px;color:var(--text2)"><b>'+count+'</b> selected</span>'+
      '<button class="btn btn-sm btn-primary" onclick="plSequenceSelected()">▶ Start sequence</button>'+
      '<button class="btn btn-sm btn-outline" onclick="plEmailJD()">✉ Email JD to candidates</button>'+
      '<button class="btn btn-sm btn-outline" onclick="plClearSel()">Clear</button>'+
    '</div>';
  }
  // Repaint ONLY the checkboxes + the bulk bar in place — never a full render() —
  // so ticking a candidate keeps the current scroll position instead of jumping
  // back to the top of the list.
  function plRepaintSelection(){
    var rows=plCurrentRows(), sel=STATE.bd.plSel||{};
    rows.forEach(function(p){ var el=document.getElementById('pl-chk-'+p.id); if(el) el.checked=!!sel[p.id]; });
    var allEl=document.getElementById('pl-chk-all'); if(allEl) allEl.checked=!!(rows.length && rows.every(function(p){ return sel[p.id]; }));
    var bar=document.getElementById('pl-bulkbar'); if(bar) bar.innerHTML=plBulkBarInner(rows.filter(function(p){ return sel[p.id]; }).length);
  }
  window.plToggleSel = function(id){ STATE.bd.plSel=STATE.bd.plSel||{}; STATE.bd.plSel[id]=!STATE.bd.plSel[id]; plRepaintSelection(); };
  window.plToggleSelAll = function(){
    var rows=plCurrentRows(); var sel=STATE.bd.plSel||{};
    var allOn=rows.length && rows.every(function(p){ return sel[p.id]; });
    rows.forEach(function(p){ sel[p.id]=!allOn; }); STATE.bd.plSel=sel; plRepaintSelection();
  };
  window.plClearSel = function(){ STATE.bd.plSel={}; plRepaintSelection(); };
  window.plSetSort = function(m){ STATE.bd.plSort=m; render(); };
  window.plSequenceSelected = function(){
    // Sequencing enrolls a submitted candidate — only promoted rows qualify.
    var promoted = plSelectedRows().filter(function(p){ return p.submission_id; });
    var skipped = plSelectedRows().length - promoted.length;
    if(!promoted.length){ showToast('Sequencing needs submitted candidates — move a tagged candidate to a stage first','error'); return; }
    if(skipped) showToast(skipped+' tagged (un-submitted) candidate'+(skipped>1?'s':'')+' skipped','info');
    if(typeof wfStartSequence!=='function'){ showToast('Sequencing module not loaded','error'); return; }
    var items = promoted.map(function(p){ var c=p.candidate||{}; return { entity_id:p.submission_id, label:c.full_name||'Candidate' }; });
    wfStartSequence('submission', items, { anyStage:true });
  };
  // Email the job description to the SELECTED candidates as a one-shot invitation
  // (separate from the automated sequence). Opens a compose modal so the BD can
  // review/edit the subject + message before sending.
  window.plEmailJD = function(){
    var jid = STATE.bd.view && STATE.bd.view.pipelineJoId;
    var j = joById(jid) || {};
    var recips = plSelectedRows().map(function(p){ var c=p.candidate||{}; return { name:c.full_name||'Candidate', email:(c.email||'').trim(), candidate_id:c.id }; });
    if(!recips.length){ showToast('Select at least one candidate first','error'); return; }
    if(!recips.some(function(r){ return r.email; })){ showToast('None of the selected candidates have an email address on file','error'); return; }
    var subject = 'Job opportunity: '+(j.job_title||'')+(j.client?' — '+j.client:'');
    var body = 'Hi,\n\nI wanted to share an opportunity that may be a good fit for you:\n\n'+
      (j.job_title||'')+(j.client?' — '+j.client:'')+'\n'+
      ([j.city,j.state].filter(Boolean).join(', '))+'\n\n'+
      String(j.job_description||'').slice(0,1600)+
      '\n\nIf this looks interesting, reply and we can set up a quick call to discuss the details.\n\nBest regards,';
    STATE.bd._emailJD = { jid:jid, subject:subject, body:body, recips:recips };
    plShowEmailJDModal();
  };
  // Exposed so any page can open the same compose/tracked-send modal by
  // pre-seeding STATE.bd._emailJD (e.g. the candidate profile's "Email" button).
  window.plShowEmailJDModal = function plShowEmailJDModal(){
    var d = STATE.bd._emailJD; if(!d) return;
    var withEmail = d.recips.filter(function(r){ return r.email; });
    var noEmail = d.recips.filter(function(r){ return !r.email; });
    var chips = withEmail.map(function(r){ return '<span style="background:var(--accent-l,rgba(30,122,60,.1));border:1px solid var(--border);border-radius:12px;padding:2px 9px;font-size:11.5px">'+esc(r.name)+' · '+esc(r.email)+'</span>'; }).join(' ');
    var warn = noEmail.length ? '<div style="font-size:11.5px;color:var(--amber);margin-top:8px">⚠ '+noEmail.length+' selected candidate'+(noEmail.length>1?'s have':' has')+' no email on file and will be skipped: '+esc(noEmail.map(function(r){return r.name;}).join(', '))+'</div>' : '';
    var docCount = (d.documentIds||[]).length;
    STATE.modal =
      '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div style="font-weight:700;font-size:16px">Email the job to '+withEmail.length+' candidate'+(withEmail.length>1?'s':'')+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">Review the invitation, then open it in your mail app. Candidates are BCC\'d so they can\'t see each other.'+(docCount?' '+docCount+' document'+(docCount>1?'s':'')+' will be attached (tracked send only).':'')+'</div>'+
        '</div>'+
        '<div style="padding:16px 20px">'+
          '<div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">RECIPIENTS</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:5px">'+(chips||'<span style="color:var(--text3);font-size:12px">None</span>')+'</div>'+warn+
          '<div style="margin-top:14px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Subject</label>'+
            '<input id="pl-jd-subject" class="sel" value="'+esc(d.subject)+'"></div>'+
          '<div style="margin-top:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Message</label>'+
            '<textarea id="pl-jd-body" class="sel" style="min-height:220px;resize:vertical;font-size:12.5px;line-height:1.5">'+esc(d.body)+'</textarea></div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
          '<div style="font-size:11px;color:var(--text3)">Tracked send emails from your connected mailbox and reports opens.</div>'+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
            '<button class="btn btn-outline" onclick="plCopyEmailJD()">Copy</button>'+
            '<button class="btn btn-outline" onclick="plSendEmailJD()">Open in mail app</button>'+
            '<button class="btn btn-primary" onclick="plSendTracked()">✉ Send tracked through futé</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    render();
  }
  window.plSendTracked = function(){
    var d = STATE.bd._emailJD; if(!d) return;
    var subject=(document.getElementById('pl-jd-subject')||{}).value||d.subject;
    var body=(document.getElementById('pl-jd-body')||{}).value||d.body;
    var recipients = d.recips.filter(function(r){ return r.email; }).map(function(r){ return { candidate_id:r.candidate_id||null, email:r.email, name:r.name }; });
    if(!recipients.length){ showToast('No valid recipient emails','error'); return; }
    showToast('Sending…','info');
    apiPost('/candidates/email', { recipients:recipients, subject:subject, body:body, job_order_id:d.jid, document_ids:d.documentIds||[] })
      .then(function(r){
        var sent=r.sent||0;
        showToast(sent+' email'+(sent!==1?'s':'')+' sent & tracked'+(r.mailbox?' from '+r.mailbox:''),'success');
        closeModal();
      })
      .catch(function(e){
        if(/no_connected_mailbox/.test(e.message)) showToast('No connected mailbox — connect one under Email, or use "Open in mail app".','error');
        else showToast('Send failed: '+e.message,'error');
      });
  };
  window.plCopyEmailJD = function(){
    var b=document.getElementById('pl-jd-body'); if(!b)return;
    (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(b.value):Promise.reject())
      .then(function(){ showToast('Message copied','success'); })
      .catch(function(){ b.select(); document.execCommand('copy'); showToast('Copied','success'); });
  };
  window.plSendEmailJD = function(){
    var d=STATE.bd._emailJD; if(!d) return;
    var subject=(document.getElementById('pl-jd-subject')||{}).value||d.subject;
    var body=(document.getElementById('pl-jd-body')||{}).value||d.body;
    var emails=d.recips.map(function(r){return r.email;}).filter(Boolean);
    if(!emails.length){ showToast('No valid recipient emails','error'); return; }
    window.open('mailto:?bcc='+encodeURIComponent(emails.join(','))+'&subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body), '_self');
    closeModal();
  };

  window.plRemove = function(id){
    if (!confirm('Remove this candidate from the pipeline?')) return;
    apiDelete('/pipeline/'+id).then(function(){ showToast('Removed from pipeline','info'); bdReloadPipeline(); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

  // ── edit snapshot fields ────────────────────────────────────────────────────
  window.plOpenEdit = function(id){
    var p = (STATE.bd.pipeline||[]).find(function(x){ return x.id===id; }); if(!p) return;
    STATE.bd._plEdit = Object.assign({}, p);
    var f = STATE.bd._plEdit;
    function row(label,key){ return '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">'+label+'</label>'+
      '<input class="sel" value="'+esc(f[key]||'')+'" oninput="plEditSet(\''+key+'\',this.value)"></div>'; }
    STATE.modal =
      '<div class="modal modal-w560" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">Edit Pipeline Entry '+code(p.pipeline_code||'')+'</div>'+
        '<div style="padding:18px 20px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
          row('Work Authorization','work_auth_snap')+row('Employer','employer_name')+
          row('Bill Rate','bill_rate')+row('Pay Rate','pay_rate')+
          row('Availability','availability')+row('Notice Period','notice_period')+
          row('Current CTC','current_ctc')+row('Source','source')+
        '</div>'+
        '<div style="margin-top:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Notes</label>'+
          '<textarea class="sel" style="min-height:56px;resize:vertical" oninput="plEditSet(\'notes\',this.value)">'+esc(f.notes||'')+'</textarea></div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
          '<button class="btn btn-primary" onclick="plSaveEdit(\''+id+'\')">Save</button>'+
        '</div>'+
      '</div>';
    render();
  };
  window.plEditSet = function(k,v){ STATE.bd._plEdit = STATE.bd._plEdit||{}; STATE.bd._plEdit[k]=v; };
  window.plSaveEdit = function(id){
    var f = STATE.bd._plEdit||{};
    apiPatch('/pipeline/'+id, {
      work_auth_snap:f.work_auth_snap, employer_name:f.employer_name, bill_rate:f.bill_rate, pay_rate:f.pay_rate,
      availability:f.availability, notice_period:f.notice_period, current_ctc:f.current_ctc, source:f.source, notes:f.notes
    }).then(function(p){
      STATE.bd.pipeline = (STATE.bd.pipeline||[]).map(function(x){ return x.id===id?p:x; });
      showToast('Updated','success'); closeModal();
    }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

  // ── add a candidate ─────────────────────────────────────────────────────────
  // ONE unified add-candidate window (the same full form used by the Candidates
  // database), pre-scoped to this job so the created/selected candidate is tagged
  // to its pipeline. Defined in 27-page-applicants.js.
  window.plOpenAdd = function(jid){
    var j = joById(jid) || {};
    if (window.atsOpenNew) return atsOpenNew({ jobId:jid, jobTitle:j.job_title||'', jobCode:j.job_code||'' });
    showToast('Candidate form not loaded','error');
  };

  // ── source candidates for this job ──────────────────────────────────────────
  // Jumps to the Candidates tab's Sourcing sub-tab, pre-tagged to this job so
  // anything imported (CSV or a job-board connector) lands straight on its
  // pipeline instead of needing a separate "Tag to a job" step.
  window.plOpenSourcing = function(jid){
    var j = joById(jid) || {};
    STATE.sourcing = STATE.sourcing || { providers:[], staged:[], sel:{}, loading:false, tagJob:'', force:false, jobs:null };
    STATE.sourcing.tagJob = jid;
    STATE.sourcing.jobs = [{ id:jid, job_code:j.job_code||'', job_title:j.job_title||'' }];
    STATE.ats = STATE.ats || {};
    STATE.ats.view = 'sourcing';
    STATE.page = 'applicants';
    render();
    if (window.srcLoadForCandidatesTab) srcLoadForCandidatesTab();
  };

})();
