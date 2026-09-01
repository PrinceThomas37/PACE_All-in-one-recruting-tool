// ===== COMPANY-WIDE JOB BOARD =====
// Recruiters can see every job in the company (not just their desk): who's on
// it, how busy it is, and ask the BD team to be assigned. Candidate contact
// details stay locked until assignment — the backend masks them. BD managers
// get an "Assignment requests" card on their dashboard to approve/decline.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function isBDM(u){ return userHasAnyRole(u,'admin','bd','bd_lead'); }
  function isRec(u){ return userHasRole(u,'recruiter'); }
  function agoTxt(s){
    try{
      var ms=Date.now()-new Date(s).getTime(), h=Math.floor(ms/3600000);
      if(h<1)return 'just now'; if(h<24)return h+'h ago';
      var d=Math.floor(h/24); return d+' day'+(d!==1?'s':'')+' ago';
    }catch(e){ return ''; }
  }

  STATE.jb = STATE.jb || { list:null, loading:false, q:'', modalJob:null };

  // ── render / nav / routing hooks ───────────────────────────────────────────
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page === 'job_board') paint();
    if (STATE.page === 'dashboard') injectRequestsCard();
  };

  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p === 'job_board') {
      STATE.page = 'job_board'; STATE.modal = null; STATE.jb.modalJob = null;
      render(); load();
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };

  // (The recruiter "All Jobs" nav item is now built by the sidebar in
  // 04-shell-login.js; the title is set by paint().)

  function load(){
    if (STATE.jb.loading) return;
    STATE.jb.loading = true;
    apiGet('/job-orders/browse').then(function(d){
      STATE.jb.list = d || []; STATE.jb.loading = false;
      if (STATE.page==='job_board') paint();
    }).catch(function(){
      STATE.jb.list = []; STATE.jb.loading = false;
      if (STATE.page==='job_board') paint();
    });
  }

  // ── the board ──────────────────────────────────────────────────────────────
  function statusBadge(st){
    var c = st==='Active' ? 'var(--green)' : st==='On Hold' ? 'var(--amber)' : st==='Closed' ? 'var(--red)' : 'var(--text3)';
    return '<span style="font-size:10.5px;font-weight:700;color:'+c+';border:1px solid currentColor;border-radius:9px;padding:1px 8px;opacity:.85">'+esc(st||'')+'</span>';
  }

  function actionBtn(j){
    if (j.assigned_to_me)
      return '<button class="btn btn-sm btn-outline" style="color:var(--green);border-color:var(--green)" onclick="event.stopPropagation();bdOpenSubmissions(\''+j.id+'\')">✓ On your desk — open</button>';
    if (j.my_request && j.my_request.status==='pending')
      return '<button class="btn btn-sm btn-outline" disabled style="opacity:.6;cursor:default">Requested — waiting on BD</button>';
    return '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();jbRequest(\''+j.id+'\')">Request assignment</button>';
  }

  function paint(){
    var content = document.getElementById('content'); if (!content) return;
    var t = document.querySelector('.tb-title'); if (t) t.textContent = 'All Jobs';

    if (STATE.jb.loading || STATE.jb.list === null){
      content.innerHTML = UI.page({ body:'<div class="dt-empty">Loading all jobs…</div>' });
      if (STATE.jb.list === null) load();
      return;
    }

    var q = (STATE.jb.q||'').toLowerCase();
    var jobs = STATE.jb.list.filter(function(j){
      if (!q) return true;
      return [j.job_title,j.client,j.job_code,j.city,j.state,j.primary_skills,(j.company&&j.company.name)]
        .some(function(v){ return v && String(v).toLowerCase().indexOf(q) > -1; });
    });

    var cards = jobs.map(function(j){
      var loc = [j.city,j.state].filter(Boolean).join(', ');
      var recs = (j.recruiters||[]);
      var pr = j.priority && j.priority!=='Normal'
        ? '<span style="font-size:10px;font-weight:700;color:var(--red);background:var(--red-l);padding:2px 7px;border-radius:8px;margin-left:6px">'+esc(j.priority)+'</span>' : '';
      return '<div class="card" style="padding:16px;cursor:pointer" onclick="jbOpenJob(\''+j.id+'\')">'+
        '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">'+
          '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">'+esc(j.job_code||'')+'</span>'+statusBadge(j.status)+
        '</div>'+
        '<div style="font-weight:600;font-size:15px;margin-bottom:3px">'+esc(j.job_title||'')+pr+'</div>'+
        '<div style="font-size:12.5px;color:var(--text3);margin-bottom:10px">'+esc(j.client||(j.company&&j.company.name)||'')+(loc?' · '+esc(loc):'')+'</div>'+
        (j.bd_manager&&j.bd_manager.name?'<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">BD Manager: <span style="color:var(--text2);font-weight:500">'+esc(j.bd_manager.name)+'</span></div>':'')+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;font-size:11.5px;color:var(--text3)">'+
          '<span>'+(recs.length?('👥 '+esc(recs.slice(0,3).join(', '))+(recs.length>3?' +'+(recs.length-3):'')):'No recruiters yet')+'</span>'+
          '<span style="white-space:nowrap">'+(j.submission_count||0)+' subs</span>'+
        '</div>'+
        actionBtn(j)+
      '</div>';
    }).join('');

    // Counts describe every job on the board, not the search result — the strip
    // is what you are searching within.
    var all = STATE.jb.list||[];
    var mine = all.filter(function(j){ return j.assigned_to_me; }).length;
    var asked = all.filter(function(j){ return j.my_request; }).length;
    var hot = all.filter(function(j){ return j.priority && j.priority!=='Normal'; }).length;

    content.innerHTML = UI.page({
      strip: UI.strip([
        { v:all.length, label:'Open jobs',    icon:'doc' },
        { sep:true },
        { v:mine,       label:'On your desk', icon:'user' },
        { v:asked,      label:'You asked for', icon:'send' },
        { v:hot,        label:'High priority', icon:'flame' }
      ]),
      toolbar: UI.toolbar({
        search:{ value:STATE.jb.q||'', placeholder:'Search title, client, skills, location…',
                 oninput:'jbSearch(this.value)' },
        right:'<span style="font-size:12.5px;color:var(--ink3)">'+jobs.length+' of '+all.length+' jobs · newest first</span>'
      }),
      body: (jobs.length
        ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">'+cards+'</div>'
        : '<div class="dt-empty">'+(all.length?'No jobs match your search.':'No jobs in the company yet — they appear here when the BD team opens them.')+'</div>')
    }) + modalHtml();
  }

  window.jbSearch = function(v){
    STATE.jb.q = v;
    paint();
    // paint() replaces #content wholesale, so the box that was being typed into
    // is gone. Put the caret back where it was, or every keystroke loses focus.
    var inp = document.querySelector('.tbar-search input');
    if (inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  };

  // ── job detail modal ─────────────────────────────────────────────────────────
  // Client/job information only — no candidate names or details, whether or not
  // the viewer is assigned. That lives on the job's own pipeline (reached via
  // "On your desk — open" once assigned); this popup is purely "should I ask to
  // work this req?" context.
  window.jbOpenJob = function(id){
    STATE.jb.modalJob = id;
    paint();
  };
  window.jbCloseModal = function(){ STATE.jb.modalJob = null; paint(); };

  function remoteLabel(r){ return r==='Yes'?'Remote':r==='Hybrid'?'Hybrid':r==='No'?'Onsite':(r||''); }
  function fmtDate(s){ if(!s)return ''; try{ var d=new Date(s); return (d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear(); }catch(e){ return ''; } }

  function modalHtml(){
    var id = STATE.jb.modalJob; if (!id) return '';
    var j = (STATE.jb.list||[]).find(function(x){ return x.id===id; }); if (!j) return '';
    var loc = [j.city,j.state,j.country].filter(Boolean).join(', ');
    var pay = (j.pay_min||j.pay_max) ? ((j.pay_cur||'USD')+' '+(j.pay_min||'?')+'–'+(j.pay_max||'?')) : '';

    function dr(lbl,val){ return val?'<div style="font-size:12.5px;margin-bottom:4px"><span style="color:var(--text3)">'+lbl+': </span>'+esc(val)+'</div>':''; }

    var descBody = j.job_description
      ? '<div style="font-size:13px;line-height:1.5;white-space:pre-wrap;max-height:180px;overflow:auto">'+esc(j.job_description)+'</div>'
      : '<div style="font-size:12.5px;color:var(--text3);font-style:italic">No job description provided yet.</div>';

    return '<div onclick="jbCloseModal()" style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:90;display:flex;align-items:center;justify-content:center;padding:20px">'+
      '<div onclick="event.stopPropagation()" style="background:var(--card);border-radius:var(--r3);max-width:640px;width:100%;max-height:86vh;overflow:auto;padding:22px 24px">'+
        '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">'+
          '<div>'+
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span style="font-family:var(--mono);font-size:11px;color:var(--text3)">'+esc(j.job_code||'')+'</span>'+statusBadge(j.status)+'</div>'+
            '<div style="font-size:18px;font-weight:700">'+esc(j.job_title||'')+'</div>'+
            '<div style="font-size:13px;color:var(--text3);margin-top:2px">'+esc(j.client||(j.company&&j.company.name)||'')+(loc?' · '+esc(loc):'')+'</div>'+
          '</div>'+
          '<button class="btn btn-sm btn-outline" onclick="jbCloseModal()">✕</button>'+
        '</div>'+
        '<div style="margin:12px 0;padding-top:12px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
          dr('Pay Rate',pay)+dr('Work Style',remoteLabel(j.remote))+
          dr('Job Type',j.job_type)+dr('Level',j.emp_level)+
          dr('Work Authorization',j.work_auth)+dr('Positions',j.positions)+
          dr('Needed By',fmtDate(j.start_date))+dr('Priority',j.priority)+
          dr('Primary Skills',j.primary_skills)+dr('Secondary Skills',j.secondary_skills)+
        '</div>'+
        '<div style="margin:10px 0 4px;font-weight:600;font-size:13.5px">Job Description</div>'+
        descBody+
        '<div style="margin-top:14px">'+actionBtn(j)+'</div>'+
      '</div>'+
    '</div>';
  }

  window.jbRequest = function(id){
    apiPost('/job-orders/'+id+'/request-assignment').then(function(r){
      var j = (STATE.jb.list||[]).find(function(x){ return x.id===id; });
      if (j) j.my_request = { id: r && r.id, status: 'pending' };
      showToast('Request sent — the BD team will review it', 'success');
      paint();
    }).catch(function(e){ showToast(e.message || 'Could not send request', 'error'); });
  };

  // ── BDM dashboard: assignment requests queue ───────────────────────────────
  function loadRequests(){
    if (STATE.jb._reqLoading) return;
    if (STATE.jb._reqs && Date.now() - STATE.jb._reqs._at < 60000) return;
    STATE.jb._reqLoading = true;
    apiGet('/assignment-requests?status=pending').then(function(d){
      STATE.jb._reqs = { _at: Date.now(), list: d || [] }; STATE.jb._reqLoading = false;
      if (STATE.page==='dashboard') render();
    }).catch(function(){ STATE.jb._reqs = { _at: Date.now(), list: [] }; STATE.jb._reqLoading = false; });
  }

  function injectRequestsCard(){
    var u = STATE.user; if (!u || !isBDM(u)) return;
    var content = document.getElementById('content'); if (!content) return;
    if (content.querySelector('[data-jbreq]')) return;
    loadRequests();
    var reqs = STATE.jb._reqs && STATE.jb._reqs.list || [];
    if (!reqs.length) return;

    var rows = reqs.map(function(r){
      var job = r.job||{}, rec = r.recruiter||{};
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--border)">'+
        '<div style="flex:1;min-width:0;font-size:13px">'+
          '<b>'+esc(rec.name||'Recruiter')+'</b> wants <b>'+esc(job.job_title||'')+'</b> '+
          '<span style="font-family:var(--mono);font-size:10.5px;color:var(--text3)">'+esc(job.job_code||'')+'</span>'+
          '<span style="font-size:11.5px;color:var(--text3)"> · '+agoTxt(r.created_at)+(r.note?' · “'+esc(r.note)+'”':'')+'</span>'+
        '</div>'+
        '<button class="btn btn-sm btn-primary" onclick="jbDecide(\''+r.id+'\',\'approve\')">Assign</button>'+
        '<button class="btn btn-sm btn-outline" onclick="jbDecide(\''+r.id+'\',\'decline\')">Decline</button>'+
      '</div>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.setAttribute('data-jbreq','1');
    wrap.innerHTML = '<div class="card cp" style="margin:0 0 16px 0">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">Assignment requests</div><div class="f12 text3">'+reqs.length+' recruiter'+(reqs.length!==1?'s':'')+' waiting for a job</div></div>'+
      '</div>'+rows+'</div>';
    var page = content.querySelector('.page') || content.firstElementChild;
    var after = content.querySelector('[data-recdash]');
    if (after && after.parentNode) after.parentNode.insertBefore(wrap, after.nextSibling);
    else if (page) page.insertBefore(wrap, page.firstChild);
    else content.insertBefore(wrap, content.firstChild);
  }

  window.jbDecide = function(id, action){
    apiPost('/assignment-requests/'+id+'/decide', { action: action }).then(function(){
      showToast(action==='approve' ? 'Recruiter assigned to the job' : 'Request declined', 'success');
      STATE.jb._reqs = null;
      render();
    }).catch(function(e){ showToast(e.message || 'Could not update request', 'error'); });
  };

})();
