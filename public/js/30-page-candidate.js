// ===== CANDIDATE PROFILE MODULE (additive) =====
// The Ceipal candidate profile: header, the lifecycle progress bar (per job),
// the candidate's pipelines & submissions across every job, and the activity
// log. Read-only over the ATS tables (no new schema). Slice 4 of
// docs/ATS_RECRUITING_PLAN.md.

(function () {

  // submission stage ordering, for "milestone reached" comparisons
  var STAGE_ORDER = { 'Sourced':0,'Screening':1,'Submitted to BDM':2,'Submitted to Client':3,
    'Interview Scheduled':4,'Interview Completed':5,'Offer':6,'Joining':7,'Placement':8 };
  function nStage(x){ return (window.normalizeStage?normalizeStage(x):x); }

  // the profile lifecycle bar (matches Ceipal): each milestone maps to the
  // submission stage that marks it reached.
  var MILESTONES = [
    { key:'pipeline',   label:'Pipeline' },
    { key:'submission', label:'Submission' },
    { key:'client',     label:'Client Submission', stage:'Submitted to Client' },
    { key:'interview',  label:'Interview',          stage:'Interview Scheduled' },
    { key:'joining',    label:'Joining',            stage:'Joining' },
    { key:'placement',  label:'Placement',          stage:'Placement' },
    { key:'notaccepted',label:'Not Accepted',       stage:'Not Accepted' }
  ];

  if (STATE.bd) STATE.bd.profile = STATE.bd.profile || null;

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function code(t){ return '<span style="font-family:var(--mono);font-size:10.5px;color:var(--text3);font-weight:600">'+esc(t)+'</span>'; }
  function fmtDT(s){ if(!s)return ''; try{ var d=new Date(s); return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch(e){ return ''; } }
  function loc(c){ return [c.city,c.state,c.country].filter(Boolean).join(', ') || c.current_location || '—'; }

  // ── data ─────────────────────────────────────────────────────────────────────
  function emptyArr(){ return []; }
  window.bdOpenCandidate = function(id){
    if(!id) return;
    // Remember where the profile was opened FROM so Back returns to that job
    // view (with its state) instead of dumping onto a refreshed Candidates tab.
    var back = { page: STATE.page };
    var v = (STATE.bd && STATE.bd.view) || {};
    if (STATE.page==='bd_pipeline') back.joId = v.pipelineJoId;
    else if (STATE.page==='bd_kanban') back.joId = v.kanbanJoId;
    else if (STATE.page==='bd_jodetail') back.joId = v.joId;
    Promise.all([ apiGet('/candidates/'+id), apiGet('/candidates/'+id+'/history'),
      apiGet('/candidates/'+id+'/notes').catch(emptyArr), apiGet('/candidates/'+id+'/documents').catch(emptyArr),
      apiGet('/candidates/'+id+'/email-activity').catch(emptyArr) ]).then(function(r){
      var hist = r[1] || { pipeline:[], submissions:[], activity:[] };
      STATE.bd.profile = { id:id, candidate:r[0]||{}, history:hist, notes:r[2]||[], documents:r[3]||[], emailActivity:r[4]||[], selJob:null, noteTab:'applicant_reference', back:back };
      // make sure jobs referenced by the history are navigable
      STATE.bd = STATE.bd || {}; STATE.bd.jobOrders = STATE.bd.jobOrders || [];
      (hist.pipeline||[]).concat(hist.submissions||[]).forEach(function(x){
        if(x.job && !STATE.bd.jobOrders.some(function(j){return j.id===x.job.id;})) STATE.bd.jobOrders.push(x.job);
      });
      goPage('bd_candidate');
    }).catch(function(e){ showToast('Failed to load candidate: '+e.message,'error'); });
  };
  window.bdReloadCandidateProfile = function(){
    if(STATE.page!=='bd_candidate' || !STATE.bd.profile) return;
    var id = STATE.bd.profile.id;
    Promise.all([ apiGet('/candidates/'+id), apiGet('/candidates/'+id+'/history') ]).then(function(r){
      STATE.bd.profile.candidate = r[0]||STATE.bd.profile.candidate;
      STATE.bd.profile.history = r[1]||STATE.bd.profile.history;
      render();
    }).catch(function(){});
  };
  window.cpReloadNotes = function(){ var p=STATE.bd.profile; if(!p)return; apiGet('/candidates/'+p.id+'/notes').then(function(d){ p.notes=d||[]; render(); }).catch(function(){}); };
  window.cpReloadDocs  = function(){ var p=STATE.bd.profile; if(!p)return; apiGet('/candidates/'+p.id+'/documents').then(function(d){ p.documents=d||[]; render(); }).catch(function(){}); };

  // ── routing wrap ──────────────────────────────────────────────────────────
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page === 'bd_candidate'){ paintProfile(); var t=document.querySelector('.tb-title'); if(t) t.textContent='Candidate'; }
  };
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p === 'bd_candidate'){ STATE.page='bd_candidate'; STATE.modal=null; render(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function paintProfile(){ var c=document.getElementById('content'); if(!c) return; c.innerHTML = renderCandidateProfile(); }

  window.bdProfileSelectJob = function(jid){ if(STATE.bd.profile) STATE.bd.profile.selJob = jid; render(); };

  // ── back-navigation: return to wherever the profile was opened from ────────
  function backLabel(back){
    var labels = { bd_pipeline:'Candidates', bd_kanban:'Board', bd_jodetail:'Job', bd_myjobs:'My Jobs', applicants:'Candidates' };
    return labels[(back&&back.page)||''] || 'Candidates';
  }
  window.cpGoBack = function(){
    if (window.navBack && STATE.nav && STATE.nav.stack && STATE.nav.stack.length>1) return navBack();
    var back = (STATE.bd.profile && STATE.bd.profile.back) || {};
    if (back.joId){
      if (back.page==='bd_pipeline') return bdOpenPipeline(back.joId);
      if (back.page==='bd_kanban') return bdOpenKanban(back.joId);
      if (back.page==='bd_jodetail') return bdOpenJobOrder(back.joId);
    }
    if (back.page==='bd_myjobs') return goPage('bd_myjobs');
    goPage('applicants');
  };

  // ── lifecycle computation ──────────────────────────────────────────────────
  function computeMilestones(jobId){
    var h = STATE.bd.profile.history;
    var pipe = (h.pipeline||[]).find(function(p){ return p.job_order_id===jobId; });
    var sub = (h.submissions||[]).find(function(s){ return s.job_order_id===jobId; });
    var acts = sub ? (h.activity||[]).filter(function(a){ return a.submission_id===sub.id; }) : [];
    function actTime(stage){ var a=acts.find(function(x){ return x.new_stage===stage; }); return a?a.created_at:null; }
    var curStage = sub ? nStage(sub.stage) : '';
    var maxOrder = -1;
    if (sub){
      maxOrder = STAGE_ORDER[curStage]!=null ? STAGE_ORDER[curStage] : 0;
      acts.forEach(function(a){ var ns=nStage(a.new_stage); if(STAGE_ORDER[ns]!=null && STAGE_ORDER[ns]>maxOrder) maxOrder=STAGE_ORDER[ns]; });
    }
    var notAccepted = sub && curStage==='Not Accepted';
    var onHold = sub && curStage==='On Hold';
    return MILESTONES.map(function(m){
      var reached=false, at=null;
      if (m.key==='pipeline'){ reached = !!pipe || !!sub; at = pipe?pipe.tagged_at:(sub?sub.created_at:null); }
      else if (m.key==='submission'){ reached = !!sub; at = sub?(sub.submitted_at||sub.created_at):null; }
      else if (m.key==='client'){ reached = !!sub && (!!sub.bdm_approved_at || maxOrder>=STAGE_ORDER['Submitted to Client']); at = sub?(sub.bdm_approved_at||actTime('Submitted to Client')):null; }
      else if (m.key==='notaccepted'){ reached = notAccepted; at = actTime('Not Accepted')||actTime('Rejected')||actTime('Not Joined'); }
      else { reached = !!sub && maxOrder>=STAGE_ORDER[m.stage]; at = actTime(m.stage); }
      return { label:m.label, reached:reached, at:at, bad:(m.key==='notaccepted'&&reached) };
    }).concat(onHold?[{label:'On Hold',reached:true,at:null,warn:true}]:[]);
  }

  function lifecycleBar(jobId){
    var steps = computeMilestones(jobId);
    var nodes = steps.map(function(s,i){
      var color = s.bad?'var(--red)':(s.warn?'var(--amber)':(s.reached?'var(--green)':'var(--border2)'));
      var txtcol = s.reached?'var(--text)':'var(--text3)';
      return '<div style="flex:1;text-align:center;position:relative;min-width:70px">'+
        (i>0?'<div style="position:absolute;left:-50%;right:50%;top:9px;height:2px;background:'+(s.reached?'var(--green)':'var(--border2)')+'"></div>':'')+
        '<div style="width:18px;height:18px;border-radius:50%;background:'+color+';margin:0 auto 6px;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px">'+(s.reached?'✓':'')+'</div>'+
        '<div style="font-size:11px;font-weight:600;color:'+txtcol+'">'+esc(s.label)+'</div>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+(s.at?esc(fmtDT(s.at)):'')+'</div>'+
      '</div>';
    }).join('');
    return '<div style="display:flex;align-items:flex-start;overflow-x:auto;padding:6px 4px">'+nodes+'</div>';
  }

  // ── the page ──────────────────────────────────────────────────────────────
  // Named renderCandidateProfile (not renderProfile) — that name is the
  // My Profile account-settings page (10-page-modals.js); this file used to
  // clobber it via `window.renderProfile =`, which silently broke My Profile
  // for every user (it rendered "No candidate loaded." instead).
  window.renderCandidateProfile = function(){
    var pr = STATE.bd.profile; if(!pr) return '<div class="page"><div style="padding:40px;text-align:center;color:var(--text3)">No candidate loaded.</div></div>';
    var c = pr.candidate||{}, h = pr.history||{pipeline:[],submissions:[],activity:[]};

    // jobs this candidate touches (union of pipeline + submissions)
    var jobMap = {};
    (h.pipeline||[]).forEach(function(p){ jobMap[p.job_order_id] = jobMap[p.job_order_id]||{ job:p.job, pipe:null, sub:null }; jobMap[p.job_order_id].pipe=p; });
    (h.submissions||[]).forEach(function(s){ jobMap[s.job_order_id] = jobMap[s.job_order_id]||{ job:s.job, pipe:null, sub:null }; jobMap[s.job_order_id].sub=s; });
    var jobs = Object.keys(jobMap).map(function(k){ return jobMap[k]; });
    var selJob = pr.selJob || (jobs[0] && (jobs[0].job&&jobs[0].job.id || jobs[0].job_order_id));
    if (selJob && !jobMap[selJob]) selJob = jobs[0] && jobs[0].job && jobs[0].job.id;

    function field(lbl,val){ return '<div style="margin-bottom:8px"><div style="font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px">'+lbl+'</div><div style="font-size:13px;color:var(--text)">'+esc(val||'—')+'</div></div>'; }

    var header =
      '<div class="card" style="padding:18px 20px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
          '<div>'+
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">'+code(c.candidate_code||'')+
              '<span style="font-size:20px;font-weight:700">'+esc(c.full_name||'')+'</span>'+
              (c.applicant_status?'<span style="font-size:11px;font-weight:700;color:var(--accent);background:rgba(0,0,0,.04);padding:2px 8px;border-radius:10px">'+esc(c.applicant_status)+'</span>':'')+
            '</div>'+
            '<div style="font-size:13px;color:var(--text3)">'+esc(c.headline||c.current_title||'')+(c.current_employer?' · '+esc(c.current_employer):'')+'</div>'+
          '</div>'+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn btn-sm btn-outline" onclick="cpOpenEmail()">✉ Email</button>'+
            '<button class="btn btn-sm btn-outline" onclick="atsOpenEdit(\''+c.id+'\')">Edit</button>'+
          '</div>'+
        '</div>'+
        '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">'+
          field('Email',c.email)+field('Mobile',c.phone)+field('Work Authorization',c.work_authorization)+
          field('Location',loc(c))+field('Experience',c.experience_years!=null?c.experience_years+' yrs':'')+field('Source',c.source)+
          field('Availability',c.availability)+field('Notice Period',c.notice_period)+field('Current CTC',c.current_ctc)+
          field('Bill Rate',c.bill_rate)+field('Pay Rate',c.pay_rate)+field('Ownership',(c.owner&&c.owner.name)||'')+
        '</div>'+
        (c.skills?'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12.5px"><span style="color:var(--text3)">Skills: </span>'+esc(c.skills)+'</div>':'')+
      '</div>';

    // lifecycle bar with a job selector
    var jobSel = jobs.length>1 ?
      '<select class="sel" style="max-width:320px" onchange="bdProfileSelectJob(this.value)">'+
        jobs.map(function(x){ var j=x.job||{}; return '<option value="'+esc(j.id)+'"'+(selJob===j.id?' selected':'')+'>'+esc((j.job_code?j.job_code+' · ':'')+(j.job_title||'')+(j.client?' — '+j.client:''))+'</option>'; }).join('')+
      '</select>' : (jobs.length===1 ? '<div style="font-size:12.5px;color:var(--text3)">'+esc((jobs[0].job&&jobs[0].job.job_code?jobs[0].job.job_code+' · ':'')+((jobs[0].job&&jobs[0].job.job_title)||''))+'</div>' : '');
    var lifecycle = jobs.length ?
      '<div class="card" style="padding:16px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-weight:600;font-size:14px">Lifecycle</div>'+jobSel+'</div>'+
        lifecycleBar(selJob)+
      '</div>' :
      '<div class="card" style="padding:16px;margin-bottom:16px;color:var(--text3);font-size:13px">Not yet on any job. Tag this candidate to a job’s pipeline to begin.</div>';

    // pipelines & submissions table
    var rows = jobs.map(function(x){
      var j=x.job||{}, p=x.pipe, s=x.sub;
      return '<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:9px 10px;font-size:12.5px"><span style="cursor:pointer;color:var(--accent);font-weight:600" onclick="bdOpenSubmissions(\''+j.id+'\')">'+esc((j.job_code?j.job_code+' · ':'')+(j.job_title||''))+'</span><div style="font-size:11px;color:var(--text3)">'+esc(j.client||'')+'</div></td>'+
        '<td style="padding:9px 10px;font-size:12px">'+(p?code(p.pipeline_code||'')+' <span style="color:var(--text3)">'+esc(p.pipeline_status||'')+'</span>':'<span style="color:var(--text3)">—</span>')+'</td>'+
        '<td style="padding:9px 10px;font-size:12px">'+(s?code(s.submission_code||'')+' <span style="color:var(--text3)">'+esc(s.stage||'')+'</span>':'<span style="color:var(--text3)">—</span>')+'</td>'+
        '<td style="padding:9px 10px;white-space:nowrap">'+
          '<button class="btn btn-sm btn-outline" onclick="bdOpenPipeline(\''+j.id+'\')">Open</button>'+
        '</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text3)">No jobs yet.</td></tr>';
    var jobsCard =
      '<div class="card" style="padding:0;margin-bottom:16px;overflow-x:auto">'+
        '<div style="padding:14px 16px;font-weight:600;font-size:14px;border-bottom:1px solid var(--border)">Jobs ('+jobs.length+')</div>'+
        '<table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr style="background:var(--bg)">'+
          ['Job','Pipeline','Submission',''].map(function(hh){ return '<th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text3);font-weight:700">'+hh+'</th>'; }).join('')+
        '</tr></thead><tbody>'+rows+'</tbody></table>'+
      '</div>';

    // activity log
    var acts = (h.activity||[]).slice().sort(function(a,b){ return new Date(b.created_at)-new Date(a.created_at); });
    var actHtml = acts.map(function(a){
      var label = a.action==='promoted'?'Promoted to submission':a.action==='bdm_approved'?'BDM approved → client':a.action==='created'?'Submission created':(a.old_stage&&a.new_stage?'Moved '+a.old_stage+' → '+a.new_stage:(a.new_stage||a.action));
      return '<div style="display:flex;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)">'+
        '<div style="font-size:11px;color:var(--text3);white-space:nowrap;min-width:96px">'+esc(fmtDT(a.created_at))+'</div>'+
        '<div style="font-size:12.5px">'+esc(label)+(a.note?' — <span style="color:var(--text3)">'+esc(a.note)+'</span>':'')+'</div>'+
      '</div>';
    }).join('') || '<div style="padding:12px 4px;color:var(--text3);font-size:12.5px">No activity yet.</div>';
    var actCard = '<div class="card" style="padding:16px"><div style="font-weight:600;font-size:14px;margin-bottom:8px">Activity</div>'+actHtml+'</div>';

    // Notes (Job Posting / Applicant Reference tabs)
    var noteTab = pr.noteTab || 'applicant_reference';
    var allNotes = pr.notes || [];
    var notes = allNotes.filter(function(n){ return n.note_type===noteTab; });
    function tabBtn(key,label){ var on=noteTab===key; return '<div onclick="cpNoteTab(\''+key+'\')" style="padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;border-radius:8px;'+(on?'background:var(--accent);color:#fff':'color:var(--text3)')+'">'+label+' ('+allNotes.filter(function(n){return n.note_type===key;}).length+')</div>'; }
    var noteRows = notes.map(function(n){
      return '<div style="padding:9px 4px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-size:11px;color:var(--text3)">'+esc((n.author&&n.author.name)||'—')+' · '+esc(fmtDT(n.created_at))+'</div>'+
          '<span style="cursor:pointer;color:var(--text3);font-size:12px" onclick="cpDeleteNote(\''+n.id+'\')">✕</span>'+
        '</div>'+
        '<div style="font-size:13px;margin-top:3px;white-space:pre-wrap">'+esc(n.body)+'</div>'+
      '</div>';
    }).join('') || '<div style="padding:10px 4px;color:var(--text3);font-size:12.5px">No notes in this tab yet.</div>';
    var notesCard =
      '<div class="card" style="padding:16px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div style="font-weight:600;font-size:14px">Notes</div>'+
          '<div style="display:flex;gap:4px;background:var(--bg);padding:3px;border-radius:10px">'+tabBtn('job_posting','Job Posting')+tabBtn('applicant_reference','Applicant Reference')+'</div>'+
        '</div>'+
        '<textarea id="cp-note-body" class="sel" style="min-height:52px;resize:vertical;margin-bottom:8px" placeholder="Add a note…"></textarea>'+
        '<div style="text-align:right;margin-bottom:10px"><button class="btn btn-sm btn-primary" onclick="cpAddNote()">Add note</button></div>'+
        noteRows+
      '</div>';

    // Documents — selectable so they can be attached to the "Email" button
    // above (send a résumé, offer letter, etc. straight to the candidate).
    var docs = pr.documents || [];
    var docSel = pr.docSel || {};
    var docSelIds = Object.keys(docSel).filter(function(k){ return docSel[k]; });
    var docRows = docs.map(function(d){
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border)">'+
        '<input type="checkbox" '+(docSel[d.id]?'checked':'')+' onclick="cpDocToggle(\''+d.id+'\')"/>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:600">'+(d.url?'<a href="'+esc(d.url)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+esc(d.filename)+'</a>':esc(d.filename))+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+esc(d.doc_type||'')+' · '+esc((d.uploader&&d.uploader.name)||'—')+' · '+esc(fmtDT(d.uploaded_at))+'</div>'+
        '</div>'+
        '<span style="cursor:pointer;color:var(--text3);font-size:12px" onclick="cpDeleteDoc(\''+d.id+'\')">✕</span>'+
      '</div>';
    }).join('') || '<div style="padding:10px 4px;color:var(--text3);font-size:12.5px">No documents yet.</div>';
    var docsCard =
      '<div class="card" style="padding:16px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div style="font-weight:600;font-size:14px">Documents'+(docSelIds.length?' · '+docSelIds.length+' selected':'')+'</div>'+
          '<div style="display:flex;gap:8px">'+
            (docSelIds.length?'<button class="btn btn-sm btn-outline" onclick="cpOpenEmail(true)">Email selected</button>':'')+
            '<label class="btn btn-sm btn-primary" style="cursor:pointer;margin:0">+ Upload<input type="file" id="cp-doc-file" style="display:none" onchange="cpUploadDoc(this)"></label>'+
          '</div>'+
        '</div>'+
        docRows+
      '</div>';

    // Resume preview — candidates enter the system by resume, so the profile
    // shows it inline: PDFs render in an embedded viewer; Word/other formats
    // fall back to the extracted resume text (candidates.resume_text) or a
    // download link when no text was captured.
    var resumeDoc = docs.find(function(d){ return d.doc_type==='resume' && d.url; });
    var isPdf = resumeDoc && (/(\.pdf)$/i.test(resumeDoc.filename||'') || /pdf/i.test(resumeDoc.content_type||''));
    var resumeCard = '';
    if (resumeDoc || c.resume_text) {
      var body;
      if (resumeDoc && isPdf) {
        body = '<iframe src="'+esc(resumeDoc.url)+'" style="width:100%;height:520px;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>';
      } else if (c.resume_text) {
        body = '<div style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg);padding:14px;font-size:12.5px;line-height:1.55;white-space:pre-wrap">'+esc(c.resume_text)+'</div>';
      } else {
        body = '<div style="padding:14px;color:var(--text3);font-size:12.5px">Preview not available for this file type — <a href="'+esc(resumeDoc.url)+'" target="_blank" rel="noopener" style="color:var(--accent)">open “'+esc(resumeDoc.filename)+'”</a> instead.</div>';
      }
      resumeCard =
        '<div class="card" style="padding:16px;margin-bottom:16px">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
            '<div style="font-weight:600;font-size:14px">Resume</div>'+
            (resumeDoc?'<a class="btn btn-sm btn-outline" href="'+esc(resumeDoc.url)+'" target="_blank" rel="noopener" download>Download</a>':'')+
          '</div>'+
          body+
        '</div>';
    }

    // Email activity — tracked sends and whether the candidate opened them.
    var ea = pr.emailActivity || [];
    var eaRows = ea.map(function(e){
      var opened = !!e.opened_at, replied = !!e.replied_at;
      var badge = replied
        ? '<span style="font-size:11px;font-weight:700;color:#fff;background:var(--green);padding:2px 9px;border-radius:10px">↩ Replied</span>'
        : (opened
          ? '<span style="font-size:11px;font-weight:700;color:var(--green);background:rgba(0,0,0,.04);padding:2px 8px;border-radius:10px">✓ Opened'+((e.open_count>1)?' · '+e.open_count+'×':'')+'</span>'
          : '<span style="font-size:11px;font-weight:700;color:var(--text3);background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:10px">Sent · not opened yet</span>');
      var sub = 'to '+esc(e.to_email||'')+' · '+esc(fmtDT(e.sent_at))+
        (e.replied_at?' · replied '+esc(fmtDT(e.replied_at)):(e.opened_at?' · opened '+esc(fmtDT(e.opened_at)):''));
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border)">'+
        '<div style="min-width:0">'+
          '<div style="font-size:13px;font-weight:600">'+esc(e.subject||'(no subject)')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+sub+'</div>'+
        '</div>'+badge+
      '</div>';
    }).join('') || '<div style="padding:10px 4px;color:var(--text3);font-size:12.5px">No tracked emails yet. Use “Send tracked through futé” from a job’s Candidates tab.</div>';
    var emailCard = '<div class="card" style="padding:16px;margin-bottom:16px">'+
      '<div style="font-weight:600;font-size:14px;margin-bottom:8px">Email activity</div>'+eaRows+'</div>';

    return '<div class="page">'+
      (window.navBar?navBar():'<div style="margin-bottom:6px"><span onclick="cpGoBack()" style="cursor:pointer;font-size:12.5px;color:var(--accent)">← '+esc(backLabel(pr.back))+'</span></div>')+
      header + lifecycle + resumeCard + jobsCard + emailCard + notesCard + docsCard + actCard +
    '</div>';
  };

  // ── email the candidate, from their own profile ─────────────────────────────
  // Every candidate profile gets this, for both BD and recruiters — previously
  // the only way to email a candidate was the bulk "Email JD" flow on a job's
  // Candidates tab. Reuses that same compose/tracked-send modal (28-page-
  // pipeline.js), just pre-seeded with this one candidate.
  window.cpOpenEmail = function(withSelectedDocs){
    var pr = STATE.bd.profile; if(!pr) return;
    var c = pr.candidate || {};
    if (!c.email){ showToast('This candidate has no email on file','error'); return; }
    var first = String(c.full_name||'').trim().split(/\s+/)[0] || 'there';
    var docSel = pr.docSel || {};
    var documentIds = withSelectedDocs ? Object.keys(docSel).filter(function(k){ return docSel[k]; }) : [];
    STATE.bd._emailJD = {
      jid: pr.selJob || null,
      subject: 'Opportunity: ' + (c.headline || c.current_title || ''),
      body: 'Hi ' + first + ',\n\nI wanted to reach out about an opportunity that may be a good fit for you. Would you be open to a quick chat?\n\nBest regards,',
      recips: [{ name: c.full_name || 'Candidate', email: c.email, candidate_id: c.id }],
      documentIds: documentIds
    };
    if (window.plShowEmailJDModal) plShowEmailJDModal();
    else showToast('Email module not loaded','error');
  };
  window.cpDocToggle = function(id){
    var pr = STATE.bd.profile; if(!pr) return;
    pr.docSel = pr.docSel || {};
    pr.docSel[id] = !pr.docSel[id];
    render();
  };

  // ── notes & documents handlers ───────────────────────────────────────────
  window.cpNoteTab = function(t){ if(STATE.bd.profile) STATE.bd.profile.noteTab=t; render(); };
  window.cpAddNote = function(){
    var p=STATE.bd.profile; if(!p) return;
    var el=document.getElementById('cp-note-body'); var body=el?el.value:'';
    if(!body.trim()){ showToast('Note is empty','error'); return; }
    apiPost('/candidates/'+p.id+'/notes', { note_type:p.noteTab||'applicant_reference', body:body })
      .then(function(){ showToast('Note added','success'); cpReloadNotes(); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };
  window.cpDeleteNote = function(nid){
    var p=STATE.bd.profile; if(!p) return; if(!confirm('Delete this note?')) return;
    apiDelete('/candidates/'+p.id+'/notes/'+nid).then(function(){ cpReloadNotes(); }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };
  window.cpUploadDoc = function(input){
    var p=STATE.bd.profile; if(!p || !input.files || !input.files[0]) return;
    var file=input.files[0];
    if(file.size > 4.5*1024*1024){ showToast('File too large (max ~4.5 MB)','error'); input.value=''; return; }
    var reader=new FileReader();
    reader.onload=function(){
      apiPost('/candidates/'+p.id+'/documents', { filename:file.name, content_type:file.type||'application/octet-stream', doc_type:'resume', data_base64:String(reader.result) })
        .then(function(){ showToast('Uploaded','success'); cpReloadDocs(); })
        .catch(function(e){ showToast('Upload failed: '+e.message,'error'); });
    };
    reader.onerror=function(){ showToast('Could not read file','error'); };
    reader.readAsDataURL(file);
  };
  window.cpDeleteDoc = function(did){
    var p=STATE.bd.profile; if(!p) return; if(!confirm('Delete this document?')) return;
    apiDelete('/candidates/'+p.id+'/documents/'+did).then(function(){ cpReloadDocs(); }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

})();
