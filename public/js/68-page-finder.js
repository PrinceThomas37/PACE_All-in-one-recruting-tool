// ===== FIND LEADS — the Lead Finder (R-157, D-0087…D-0092) — and, since 8 Oct, the SOURCED LEADS tab (D-0102) =====
// Steps 2 and 3 of the plan the owner approved:
//   2. a person saves a search (job titles, places, size, how recent); PACE asks Apollo for companies hiring for
//      those jobs — each morning, or on "Run now" — and turns each good one into a CARD.
//   3. Accept on a card opens ONE window: pick the job, find the person (title search is free), reveal up to three
//      emails (a credit each), Save. Only Save writes a lead. Wait and Reject write nothing but a small mark.
// Every rule lives on the server (routes/finder.js); this file only asks and shows. Nothing is filtered here.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function lines(v){ return String(v||'').split(/[,\n;]+/).map(function(x){ return x.trim(); }).filter(Boolean); }
  function plural(n, one, many){ return n+' '+(n===1?one:(many||one+'s')); }
  function fmtDay(s){ if(!s)return ''; try{ var d=new Date(String(s).slice(0,10)+'T12:00:00'); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return ''; } }

  var F = STATE.finder = STATE.finder || {
    tab:'cards', access:null, accessFor:null, accessLoading:false,
    cards:null, waiting:0, daily:0, today:0, loading:false,
    searches:null, form:null, nowForm:null, nowNote:'', running:false, histOpen:{},
    hist:null, histStatus:'accepted', histSearch:'', histQ:'', histAll:false,
    admin:null, diag:null, diagBusy:false, moreOpen:null,
    acc:null
  };

  // ── who sees the menu item ────────────────────────────────────────────────
  // The sidebar asks this on every render; the answer is fetched once per person.
  window.finderEnabled = function(){ return !!(F.access && F.access.enabled); };
  // ONE menu item for finding leads (owner, 8 Oct): a person sees it if they may use the Lead Finder OR may review Sourced Leads
  // (the second group sees only the Sourced leads tab).
  window.finderNavVisible = function(){ return finderEnabled() || (typeof srcdCan==='function' && srcdCan(STATE.user)); };
  function sourcing(){ return typeof srcdCan==='function' && srcdCan(STATE.user); }
  window.finderEnsureAccess = function(){
    var uid = STATE.user && STATE.user.id; if(!uid) return;
    if (F.accessFor !== uid){ F.access=null; F.accessFor=uid; F.accessLoading=false; F.cards=null; F.searches=null; F.admin=null; }
    if (F.access || F.accessLoading) return;
    F.accessLoading = true;
    apiGet('/finder/access').then(function(r){
      F.access = r || { enabled:false }; F.accessLoading=false;
      if (F.access.enabled) render();
    }).catch(function(){ F.access = { enabled:false }; F.accessLoading=false; });
  };

  // ── routing ───────────────────────────────────────────────────────────────
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='finder' || p==='sourced'){
      if (p==='sourced') F.tab='sourced';                // the old "Sourced Leads" page is now a tab of this one
      STATE.page='finder'; STATE.modal=null; render();
      loadAccess(function(){
        if (F.access && F.access.enabled){ loadCards(); loadSearches(); loadHistory(); }
        if (F.tab==='sourced' && sourcing()) srcdOpen();
      });
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };
  // A repaint first keeps what the person has typed into the form — unless the caller has just changed the form itself
  // (skipCapture), in which case reading the old screen back would undo that change.
  function paint(skipCapture){ if(STATE.page!=='finder' && STATE.page!=='sourced')return; if(!skipCapture) captureForm(); paintPageContent(); }
  UI.registerPage('finder', function(){ return renderPage(); });
  UI.registerPage('sourced', function(){ return renderPage(); });   // an old link or saved place still lands on the page

  // ── data ──────────────────────────────────────────────────────────────────
  function loadAccess(then){
    apiGet('/finder/access').then(function(r){ F.access=r||{enabled:false}; F.accessFor=STATE.user&&STATE.user.id; paint(); if(then) then(); })
      .catch(function(e){ showToast('Could not load: '+e.message,'error'); });
  }
  function loadCards(){
    F.loading = true; paint();
    apiGet('/finder/cards').then(function(r){
      F.loading=false; F.cards=((r&&r.cards)||[]).map(function(c){ c._base=(c.chips||[]).slice(); return c; });
      F.waiting=(r&&r.waiting)||0; F.daily=(r&&r.daily)||0; F.today=(r&&r.today)||0; paint();
    }).catch(function(e){ F.loading=false; F.cards=F.cards||[]; showToast('Could not load cards: '+e.message,'error'); paint(); });
  }
  function loadSearches(){
    apiGet('/finder/searches').then(function(r){ F.searches=(r&&r.searches)||[]; paint(); })
      .catch(function(e){ F.searches=F.searches||[]; showToast('Could not load searches: '+e.message,'error'); paint(); });
  }
  function loadHistory(){
    apiGet('/finder/history'+(F.histAll?'?all=1':'')).then(function(r){ F.hist=r||{items:[],counts:{}}; paint(); })
      .catch(function(e){ F.hist=F.hist||{items:[],counts:{},hidden:0}; showToast('Could not load the history: '+e.message,'error'); paint(); });
  }
  function loadAdmin(){
    apiGet('/finder/admin/users').then(function(r){ F.admin=r||{users:[]}; paint(); })
      .catch(function(e){ F.admin={users:[]}; showToast('Could not load: '+e.message,'error'); paint(); });
  }

  window.fdTab = function(t){
    captureForm(); F.tab=t; F.moreOpen=null; paint();
    if (t==='admin' && !F.admin) loadAdmin();
    if (t==='history') loadHistory();
    if (t==='sourced' && sourcing()) srcdOpen();
  };

  // ── running searches ──────────────────────────────────────────────────────
  window.fdRun = function(id){
    if (F.running) return;
    F.running = id || 'all'; paint();
    apiPost(id ? '/finder/searches/'+id+'/run' : '/finder/run', {}).then(function(r){
      F.running=false;
      var res=(r&&r.results)||[];
      var note=res.map(function(x){ return (res.length>1?x.name+': ':'')+x.note; }).join('  ');
      showToast(note || 'Done', (r&&r.new_cards)?'success':'info');
      if (r && r.credits && F.access) F.access.credits = r.credits;
      if (r && r.jobsource && F.access) F.access.jobsource = Object.assign({}, F.access.jobsource, r.jobsource);
      F.tab = (r && r.new_cards) ? 'cards' : F.tab;
      loadCards(); loadSearches();
    }).catch(function(e){ F.running=false; showToast(e.message,'error'); paint(); });
  };

  // ── cards: wait / reject / postings ──────────────────────────────────────
  function dropCard(id){ F.cards=(F.cards||[]).filter(function(c){ return c.id!==id; }); }
  window.fdReject = function(id, btn){
    if (btn){ btn.disabled=true; }
    apiPost('/finder/cards/'+id+'/reject', {}).then(function(){ dropCard(id); showToast('Turned down — you will not be shown this company again','info'); paint(); loadHistory(); })
      .catch(function(e){ showToast(e.message,'error'); if(btn)btn.disabled=false; });
  };
  window.fdWait = function(id, btn){
    if (btn){ btn.disabled=true; }
    apiPost('/finder/cards/'+id+'/wait', {}).then(function(r){
      dropCard(id); F.waiting=(F.waiting||0)+1;
      showToast('Parked — it comes back on '+fmtDay(r&&r.wait_until),'info'); paint(); loadHistory();
    }).catch(function(e){ showToast(e.message,'error'); if(btn)btn.disabled=false; });
  };
  window.fdPostings = function(id, btn){
    if (btn){ btn.disabled=true; btn.textContent='Opening…'; }
    apiPost('/finder/cards/'+id+'/postings', {}).then(function(r){
      var c=(F.cards||[]).find(function(x){ return x.id===id; });
      if (c){ c.postings=r.postings||[]; c.chips=(c._base||[]).concat((r.signals&&r.signals.chips)||[]); }
      if (r.credits && F.access) F.access.credits=r.credits;
      if (F.acc && F.acc.card && F.acc.card.id===id){ F.acc.card.postings=c&&c.postings; paintAccept(); }
      paint();
    }).catch(function(e){ showToast(e.message,'error'); if(btn){btn.disabled=false;btn.textContent='See their open jobs · 1 credit';} });
  };

  // ── ACCEPT: the one window (step 3) ──────────────────────────────────────
  window.fdAccept = function(id){
    var c=(F.cards||[]).find(function(x){ return x.id===id; }); if(!c) return;
    if (c.decision && c.decision.blocked){ showToast(c.decision.sentence,'error'); return; }       // the server enforces it too
    F.acc = { card:c, jobs:[], main:'', mailboxes:null, mailboxId:'', mailErr:'', jobQ:'', writeEmail:((F.access&&F.access.goes_to)==='you'), titleQ:'', people:null, picked:{}, manual:[], busy:false, finding:false, revealing:null, err:'' };
    paintAccept();
    // A lead that comes straight to the person sends from one of THEIR mailboxes: fetch them (the server pre-selects the one
    // that has sent the fewest today). A lead that goes to the pool has none.
    if ((F.access&&F.access.goes_to)==='you'){
      var acc=F.acc;
      apiGet('/finder/mailboxes').then(function(r){
        if (F.acc!==acc) return;
        acc.mailboxes=(r&&r.mailboxes)||[]; acc.mailboxId=(r&&r.suggested_id)||''; acc.mailErr=(r&&r.error)||'';
        paintAccept();
      }).catch(function(e){ if(F.acc!==acc) return; acc.mailboxes=[]; acc.mailErr=e.message; paintAccept(); });
    }
  };
  window.fdCloseAccept = function(){ F.acc=null; STATE.modal=null; render(); };
  function captureAcc(){
    var a=F.acc; if(!a) return;
    var el;
    if ((el=document.getElementById('fd-position'))) a.jobQ=el.value;
    if ((el=document.getElementById('fd-titleq'))) a.titleQ=el.value;
    var m={}; ['first','last','email','title'].forEach(function(k){ var e=document.getElementById('fd-m-'+k); if(e) m[k]=e.value; });
    if (Object.keys(m).length) a.mdraft=m;
  }
  function paintAccept(skipCapture){ if(!skipCapture) captureAcc(); STATE.modal = F.acc ? renderAcceptModal() : null; render(); }

  function pickedCount(a){ return Object.keys(a.picked).filter(function(k){ return a.picked[k]; }).length + a.manual.length; }
  window.fdFindPeople = function(){
    var a=F.acc; if(!a||a.finding) return; captureAcc();
    a.finding=true; a.err=''; paintAccept();
    apiPost('/finder/cards/'+a.card.id+'/people', { title:a.titleQ }).then(function(r){
      a.finding=false;
      // A new search ADDS to the list: anybody already paid for or ticked stays, at the top (their credit and their tick are not lost).
      var fresh=(r&&r.people)||[], keep=(a.people||[]).filter(function(p){ return p.revealed || a.picked[p.id]; });
      var have={}; keep.forEach(function(p){ have[p.id]=true; });
      var added=fresh.filter(function(p){ return !have[p.id]; });
      a.people=keep.concat(added);
      if(!added.length) a.err = fresh.length ? 'Nobody new with those titles — the people already shown are the ones Apollo has.' : 'Nobody with those titles at this company. Try other titles — or add someone by hand below.';
      paintAccept();
    }).catch(function(e){ a.finding=false; a.err=e.message; paintAccept(); });
  };
  window.fdReveal = function(personId){
    var a=F.acc; if(!a||a.revealing) return; captureAcc();
    a.revealing=personId; a.err=''; paintAccept();
    apiPost('/finder/cards/'+a.card.id+'/reveal', { person_id:personId }).then(function(r){
      a.revealing=null;
      var p=(a.people||[]).find(function(x){ return x.id===personId; });
      var person=(r&&r.person)||{};
      if (p){ p.revealed=true; p.email=person.email||null; if(person.last_name) p.last_name=person.last_name; if(person.title) p.title=person.title; }
      if (person.email && pickedCount(a)<3) a.picked[personId]=true;
      if (r && r.credits && F.access) F.access.credits=r.credits;
      if (F.access && F.access.reveals) F.access.reveals.used=(F.access.reveals.used||0)+1;
      if (r && r.note) a.err=r.note;
      paintAccept();
    }).catch(function(e){ a.revealing=null; a.err=e.message; paintAccept(); });
  };
  window.fdPick = function(personId){
    var a=F.acc; if(!a) return; captureAcc();
    if (!a.picked[personId] && pickedCount(a)>=3){ a.err='Three contacts is the most one lead can carry.'; paintAccept(true); return; }
    a.picked[personId]=!a.picked[personId]; a.err=''; paintAccept(true);
  };
  window.fdAddManual = function(){
    var a=F.acc; if(!a) return; captureAcc();
    var m=a.mdraft||{};
    if (!m.first || !m.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email.trim())){ a.err='A contact added by hand needs a first name and a valid email.'; paintAccept(true); return; }
    if (pickedCount(a)>=3){ a.err='Three contacts is the most one lead can carry.'; paintAccept(true); return; }
    a.manual.push({ first_name:m.first.trim(), last_name:(m.last||'').trim(), designation:(m.title||'').trim(), email:m.email.trim() });
    a.mdraft=null; a.err=''; paintAccept();
  };
  window.fdDropManual = function(i){ var a=F.acc; if(!a) return; captureAcc(); a.manual.splice(i,1); paintAccept(true); };
  // Jobs: tick as many as the lead is for (up to 5). The first is the lead's main job; the rest are saved on it as "also hiring".
  window.fdToggleJob = function(t){
    var a=F.acc; if(!a) return; captureAcc();
    var i=a.jobs.indexOf(t);
    if (i>=0) a.jobs.splice(i,1);
    else if (a.jobs.length>=5){ a.err='Five jobs is the most one lead can carry.'; paintAccept(true); return; }
    else a.jobs.push(t);
    if (a.jobs.indexOf(a.main)<0) a.main=a.jobs[0]||'';           // the main job is always one of the ticked ones
    a.err=''; paintAccept(true);
  };
  // Which ticked job the lead (and its first email) is FOR — an explicit choice, not "whichever was ticked first".
  window.fdSetMain = function(t){ var a=F.acc; if(!a) return; captureAcc(); if(a.jobs.indexOf(t)>=0) a.main=t; paintAccept(true); };
  window.fdPickMailbox = function(id){ var a=F.acc; if(!a) return; captureAcc(); a.mailboxId=id; paintAccept(true); };
  window.fdAddJob = function(){
    var a=F.acc; if(!a) return; captureAcc();
    var t=String(a.jobQ||'').trim();
    if (!t) return;
    if (a.jobs.some(function(x){ return x.toLowerCase()===t.toLowerCase(); })){ a.jobQ=''; paintAccept(true); return; }
    if (a.jobs.length>=5){ a.err='Five jobs is the most one lead can carry.'; paintAccept(true); return; }
    a.jobs.push(t); if(!a.main) a.main=t; a.jobQ=''; a.err=''; paintAccept(true);
  };
  window.fdToggleWrite = function(){ var a=F.acc; if(!a) return; captureAcc(); a.writeEmail=!a.writeEmail; paintAccept(true); };
  function jobsToSave(a){
    var out=a.jobs.slice(), q=String(a.jobQ||'').trim();
    if (q && !out.some(function(x){ return x.toLowerCase()===q.toLowerCase(); }) && out.length<5){ out.push(q); if(!a.main) a.main=q; }
    // the server takes the FIRST as the lead's job: put the chosen main job there
    var mi=out.indexOf(a.main);
    if (mi>0){ out.splice(mi,1); out.unshift(a.main); }
    return out;
  }
  window.fdSave = function(){
    var a=F.acc; if(!a||a.busy) return; captureAcc();
    var contacts=[];
    Object.keys(a.picked).forEach(function(k){ if(a.picked[k]) contacts.push({ person_id:k }); });
    a.manual.forEach(function(m){ contacts.push(m); });
    var jobs=jobsToSave(a);
    if (!jobs.length){ a.err='Pick the job this lead is for.'; paintAccept(); return; }
    if (!contacts.length){ a.err='Pick at least one contact with an email, so the lead can be emailed.'; paintAccept(); return; }
    a.busy=true; a.err=''; paintAccept();
    apiPost('/finder/cards/'+a.card.id+'/accept', { positions:jobs, contacts:contacts, mailbox_id:a.mailboxId||undefined }).then(function(r){
      var id=a.card.id, wantEmail=!!a.writeEmail; F.acc=null; STATE.modal=null; dropCard(id);
      showToast(r&&r.goes_to==='you' ? 'Lead saved — it is yours, in Leads' : 'Lead saved — it is in the Unassigned pool','success');
      render(); loadAccess(); loadHistory();
      if (typeof refreshJobs==='function') refreshJobs();           // the new lead shows in Leads without a manual refresh
      // The explicit next step Take-leads and Import already use: the first email is WRITTEN into Pending for the person to read.
      // Nothing is sent here — a person presses Send.
      if (wantEmail && r && r.goes_to==='you' && r.lead_id){
        apiPost('/emails/generate',{ job_ids:[r.lead_id] }).then(function(g){
          var n=(g&&g.generated)||0;
          showToast(n?'First email written — read it in Email → Pending, then send':'The lead is saved, but no email could be written (check the contact\'s address)', n?'success':'warning');
        }).catch(function(e){ showToast('The lead is saved, but the email could not be written: '+((e&&e.message)||e),'warning'); });
      }
    }).catch(function(e){ a.busy=false; a.err=e.message; paintAccept(); });
  };

  function decisionBox(d){
    if(!d) return '';
    if(d.blocked) return '<div class="ld-box is-stop" role="alert"><strong>Cannot add this company right now</strong>'+esc(d.sentence)+'</div>';
    return '';
  }

  function sendFromPart(a){
    if (a.mailboxes===null) return '<div class="fd-hint">Loading your email IDs…</div>';
    if (!a.mailboxes.length) return '<div class="fd-hint c-red" role="alert">'+esc(a.mailErr||'You have no connected email ID — add one under Email IDs first.')+'</div>';
    return '<div class="fd-label">Send from</div><select id="fd-mailbox" class="sel fd-wide" onchange="fdPickMailbox(this.value)">'+
      a.mailboxes.map(function(m){ return '<option value="'+esc(m.id)+'"'+(m.id===a.mailboxId?' selected':'')+'>'+esc((m.display_name?m.display_name+' ':'')+'<'+m.email_address+'>')+' — '+m.sent_today+' sent today</option>'; }).join('')+'</select>'+
      '<div class="fd-hint">The email goes out from this address, signed with it. We pre-select the one that has sent the fewest today.</div>';
  }
  function renderAcceptModal(){
    var a=F.acc; if(!a) return '';
    var c=a.card, goes=(F.access&&F.access.goes_to)==='you';
    var posts=c.postings||[];
    var titles=[]; posts.forEach(function(p){ if(titles.indexOf(p.title)<0) titles.push(p.title); });

    var union=titles.slice(); a.jobs.forEach(function(j){ if(union.indexOf(j)<0) union.push(j); });
    var jobPart =
      '<div class="fd-label">1 · Which jobs is this lead for? <span class="fd-hint">tick one or more, then choose the main one</span></div>'+
      (union.length
        ? '<div class="fd-pills">'+union.slice(0,14).map(function(t){ var n=a.jobs.indexOf(t); return '<button class="fd-pill'+(n>=0?' on':'')+'" onclick="fdToggleJob(\''+esc(t.replace(/\\/g,'\\\\').replace(/'/g,"\\'"))+'\')">'+(n>=0?(t===a.main?'★ ':'✓ '):'')+esc(t)+'</button>'; }).join('')+'</div>'
        : '<div class="fd-hint">Open their jobs on the card to pick from a list, or type one below.</div>')+
      '<div class="fd-row"><input id="fd-position" class="inp fd-grow" placeholder="Or type a job, e.g. CNC Machinist" value="'+esc(a.jobQ)+'" onkeydown="if(event.key===\'Enter\'){fdAddJob()}">'+
        '<button class="btn btn-sm btn-outline" onclick="fdAddJob()">Add</button></div>'+
      (a.jobs.length>1
        ? '<div class="fd-label">Main job <span class="fd-hint">the lead — and its first email — is for this one</span></div>'+
          '<div class="fd-pills">'+a.jobs.map(function(t){ return '<label class="fd-use"><input type="radio" name="fd-main" '+(t===a.main?'checked':'')+' onclick="fdSetMain(\''+esc(t.replace(/\\/g,'\\\\').replace(/'/g,"\\'"))+'\')"> '+esc(t)+'</label>'; }).join('')+'</div>'+
          '<div class="fd-hint">The others are saved on the lead as “also hiring”. The email is written for the main job only. No extra credit — they are already on the card.</div>'
        : (a.jobs.length===1?'<div class="fd-hint">The lead, and its first email, are for this job.</div>':''));

    var rows = (a.people||[]).map(function(p){
      var name=esc(p.first_name+' '+(p.last_name||p.last_name_hint||''));
      var right;
      if (p.revealed && p.email) right='<label class="fd-use"><input type="checkbox" '+(a.picked[p.id]?'checked':'')+' onclick="fdPick(\''+esc(p.id)+'\')"> Use</label>';
      else if (p.revealed) right='<span class="fd-hint">No verified email</span>';
      else right='<button class="btn btn-sm btn-outline" '+(a.revealing?'disabled':'')+' onclick="fdReveal(\''+esc(p.id)+'\')">'+(a.revealing===p.id?'Getting…':'Get email · 1 credit')+'</button>';
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+name+'</strong>'+
        '<span class="fd-hint">'+esc(p.title||'')+(p.revealed&&p.email?' · '+esc(p.email):'')+'</span></div>'+right+'</div>';
    }).join('');

    var manualRows = a.manual.map(function(m,i){
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+esc(m.first_name+' '+m.last_name)+'</strong><span class="fd-hint">'+esc(m.designation||'')+' · '+esc(m.email)+' · added by hand</span></div>'+
        '<button class="btn btn-sm btn-outline" onclick="fdDropManual('+i+')">Remove</button></div>';
    }).join('');
    var md=a.mdraft||{};

    var apolloOn=!!(F.access&&F.access.apollo&&F.access.apollo.connected), canFind=apolloOn&&!!(a.card&&a.card.domain);
    var peoplePart =
      '<div class="fd-label">2 · Who should we write to? <span class="fd-hint">up to 3 · '+pickedCount(a)+' chosen</span></div>'+
      (canFind
        ? '<div class="fd-row"><input id="fd-titleq" class="inp fd-grow" placeholder="Job titles, e.g. HR Manager, Plant Manager (blank = the usual suspects)" value="'+esc(a.titleQ)+'" onkeydown="if(event.key===\'Enter\'){fdFindPeople()}">'+
          '<button class="btn btn-sm btn-primary" '+(a.finding?'disabled':'')+' onclick="fdFindPeople()">'+(a.finding?'Looking…':'Find people')+'</button></div>'+
          '<div class="fd-hint">Finding people is free. An email costs 1 credit, and only a verified address is kept.</div>'
        : '<div class="ld-box is-info" role="status">'+(!apolloOn?'Apollo is not connected here, so people cannot be looked up for you. ':'This company\'s website is not known, so people cannot be looked up for it. ')+'Add the contact by hand below — a name, a job title and an email.</div>')+
      rows+manualRows+
      '<details class="fd-manual"'+((a.mdraft||!canFind)?' open':'')+'><summary>Add someone by hand</summary>'+
        '<div class="fd-grid"><input id="fd-m-first" class="inp" placeholder="First name" value="'+esc(md.first||'')+'"><input id="fd-m-last" class="inp" placeholder="Last name" value="'+esc(md.last||'')+'">'+
        '<input id="fd-m-email" class="inp" placeholder="Email" value="'+esc(md.email||'')+'"><input id="fd-m-title" class="inp" placeholder="Job title" value="'+esc(md.title||'')+'"></div>'+
        '<button class="btn btn-sm btn-outline" onclick="fdAddManual()">Add this person</button></details>';

    var where = '<div class="ld-box is-info"><strong>Where it goes</strong>'+(goes
      ? 'Straight to you, in Leads.'+sendFromPart(a)+
        '<label class="fd-use fd-block"><input type="checkbox" '+(a.writeEmail?'checked':'')+' onclick="fdToggleWrite()"> Write the first email now — it waits in Email → Pending for you to read. Nothing is sent until you press Send.</label>'
      : 'Into the Unassigned pool, where your lead hands it out. Nothing is emailed now.')+'</div>';

    var can = !a.busy && jobsToSave(a).length>0 && pickedCount(a)>0 && (!goes || !!a.mailboxId) && !(c.decision&&c.decision.blocked);

    return '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
      '<div class="fs-16 fd-mhead">Add '+esc(c.company_name)+' as a lead</div>'+
      '<div class="fd-mbody">'+decisionBox(c.decision)+jobPart+peoplePart+
        (a.err?'<div class="ld-box is-stop" role="alert">'+esc(a.err)+'</div>':'')+where+
      '</div>'+
      '<div class="fd-mfoot"><button class="btn btn-outline" onclick="fdCloseAccept()">Cancel</button>'+
        '<button class="btn btn-primary" '+(can?'':'disabled')+' onclick="fdSave()">'+(a.busy?'Saving…':'Save lead')+'</button></div>'+
    '</div>';
  }

  // ── saved searches ───────────────────────────────────────────────────────
  // The form's state. Titles are a list (ticked from the picked industries' suggestions, or typed); companies are the
  // ones the person chose by name, each with where it is, so the chip can say "Acme Corp · Austin, TX".
  var MAX_TITLES = 40, MAX_COMPANIES = 30, MAX_SECTORS = 8;
  // Where a new search looks by default: Apollo, unless the organisation has no Apollo but does have a free job-source key.
  function defaultSource(){ var a=F.access||{}; var ap=a.apollo&&a.apollo.connected, js=a.jobsource&&a.jobsource.connected; return (!ap&&js)?'free':'apollo'; }
  function blankForm(){ return { id:null, name:'', source:defaultSource(), sectors:[], titles:[], locations:'', sizes:[], posted_days:14, keywords:'', companies:[] }; }
  function blankCo(){ return { q:'', busy:false, list:null, note:'' }; }
  if (!F.co) F.co = blankCo();
  if (F.newTitle==null) F.newTitle='';
  function formFrom(s){
    var sectors=(s.sectors&&s.sectors.length)?s.sectors.slice():(s.sector?[s.sector]:[]);
    var cos=(s.companies&&s.companies.length)?s.companies.map(function(c){ return { name:c.name||c.domain, domain:c.domain, city:c.city||'', state:c.state||'' }; })
      :(s.domains||[]).map(function(d){ return { name:d, domain:d, city:'', state:'' }; });
    return { id:s.id, name:s.name, source:s.source||'apollo', sectors:sectors, titles:(s.titles||[]).slice(), locations:(s.locations||[]).join(', '),
             sizes:(s.sizes||[]).slice(), posted_days:(s.posted_days==null?14:s.posted_days), keywords:(s.keywords||[]).join(', '), companies:cos };
  }
  // The slider's words. 0 is a real answer ("today only"), never "not set".
  function postedText(d){ d=(d==null?14:Number(d)); return d===0?'today':(d===1?'yesterday or today':'in the last '+d+' days'); }
  // The form on screen: the Daily run tab's, or the one-off Find leads now tab's (same fields, different buttons).
  function curForm(){ return F.tab==='now' ? (F.nowForm||(F.nowForm=blankForm())) : F.form; }
  function captureForm(){
    var f=curForm(); if(!f) return;
    var g=function(id){ var e=document.getElementById(id); return e?e.value:null; };
    var v;
    if ((v=g('fd-f-name'))!==null) f.name=v;
    if ((v=g('fd-f-locations'))!==null) f.locations=v;
    if ((v=g('fd-f-keywords'))!==null) f.keywords=v;
    if ((v=g('fd-f-posted'))!==null){ var n=Number(v); f.posted_days=(v!==''&&isFinite(n))?n:14; }
    if ((v=g('fd-f-newtitle'))!==null) F.newTitle=v;
    if ((v=g('fd-f-co'))!==null) F.co.q=v;
    var boxes=document.querySelectorAll('.fd-size-box');
    if (boxes.length){ f.sizes=[]; Array.prototype.forEach.call(boxes,function(b){ if(b.checked) f.sizes.push(b.value); }); }
  }
  window.fdNewSearch = function(){ F.form=blankForm(); F.co=blankCo(); F.newTitle=''; F.tab='searches'; F.moreOpen=null; paint(true); };
  window.fdEditSearch = function(id){ var s=(F.searches||[]).find(function(x){ return x.id===id; }); if(!s) return; F.form=formFrom(s); F.co=blankCo(); F.newTitle=''; F.tab='searches'; F.moreOpen=null; paint(true); };
  window.fdCancelForm = function(){ F.form=null; paint(true); };

  // Industries: pick as many as you like. An industry is a shortcut — it offers typical titles to tick; the search runs on the titles.
  function sectorList(){ return ((F.access&&F.access.sectors)||[]); }
  function sectorById(id){ return sectorList().find(function(x){ return x.id===id; }); }
  window.fdPickSource = function(v){ captureForm(); var f=curForm(); if(!f) return; f.source=v; paint(true); };
  window.fdAddSector = function(id){
    captureForm(); var f=curForm(); if(!f||!id) return;
    if (f.sectors.indexOf(id)<0){
      if (f.sectors.length>=MAX_SECTORS){ showToast('You can pick up to '+MAX_SECTORS+' industries.','info'); paint(true); return; }
      f.sectors.push(id);
    }
    var sec=sectorById(id);
    if (sec && !String(f.name).trim()) f.name=sec.label;
    paint(true);
  };
  // Dropping an industry hides its suggestions; titles already ticked stay (they move to "Your titles").
  window.fdDropSector = function(id){ captureForm(); var f=curForm(); if(!f) return; f.sectors=f.sectors.filter(function(x){ return x!==id; }); paint(true); };

  // Titles: tick any of an industry's suggestions, Select all / Clear for a whole industry, or type your own.
  function titleIdx(f,t){ var k=String(t).toLowerCase(); for(var i=0;i<f.titles.length;i++){ if(f.titles[i].toLowerCase()===k) return i; } return -1; }
  function addTitles(f, list){
    var full=false;
    list.forEach(function(t){ t=String(t).trim(); if(!t||titleIdx(f,t)>=0) return; if(f.titles.length>=MAX_TITLES){ full=true; return; } f.titles.push(t); });
    if (full) showToast('You can search up to '+MAX_TITLES+' job titles at once.','info');
  }
  window.fdTitleToggle = function(sid, i){
    captureForm(); var f=curForm(), sec=sectorById(sid); if(!f||!sec) return;
    var t=sec.titles[i], k=titleIdx(f,t);
    if (k>=0) f.titles.splice(k,1); else addTitles(f,[t]);
    paint(true);
  };
  window.fdTitlesAll = function(sid){ captureForm(); var f=curForm(), sec=sectorById(sid); if(!f||!sec) return; addTitles(f,sec.titles); paint(true); };
  window.fdTitlesNone = function(sid){
    captureForm(); var f=curForm(), sec=sectorById(sid); if(!f||!sec) return;
    var drop=sec.titles.map(function(t){ return t.toLowerCase(); });
    f.titles=f.titles.filter(function(t){ return drop.indexOf(t.toLowerCase())<0; });
    paint(true);
  };
  window.fdTitleDrop = function(i){ captureForm(); var f=curForm(); if(!f) return; f.titles.splice(i,1); paint(true); };
  window.fdTitleAdd = function(){
    captureForm(); var f=curForm(); if(!f) return;
    addTitles(f, lines(F.newTitle)); F.newTitle=''; paint(true);
    var e=document.getElementById('fd-f-newtitle'); if(e) e.focus();
  };
  // The slider moves without repainting the page (a repaint under the hand would drop the thumb).
  window.fdPostedInput = function(v){
    var f=curForm(); if(!f) return;
    var n=Number(v); f.posted_days=isFinite(n)?n:14;
    var o=document.getElementById('fd-posted-out'); if(o) o.textContent=postedText(f.posted_days);
    var sl=document.getElementById('fd-f-posted'); if(sl){ var lo=Number(sl.min)||0, hi=Number(sl.max)||30; sl.style.setProperty('--fd-pct', Math.round(100*(f.posted_days-lo)/Math.max(1,hi-lo))+'%'); }
  };

  // Preferred companies: type a name, Apollo's real matches come back with where they are; pick the right one. As many as you like.
  window.fdCoLookup = function(){
    captureForm(); var f=curForm(); if(!f||F.co.busy) return;
    var q=String(F.co.q||'').trim();
    if (q.length<2){ showToast('Type at least two letters of the company name.','info'); return; }
    F.co.busy=true; F.co.note=''; paint(true);
    apiPost('/finder/companies/suggest',{ q:q }).then(function(r){
      F.co.busy=false; F.co.list=(r&&r.suggestions)||[]; F.co.note=(r&&r.note)||'';
      if (r && r.credits && F.access) F.access.credits=r.credits;
      // A website typed in is exact — it is added straight away.
      if (F.co.list.length===1 && F.co.list[0].website_only){ addCompany(f,F.co.list[0]); F.co.list=null; F.co.q=''; }
      paint(true);
    }).catch(function(e){ F.co.busy=false; F.co.note=e.message; paint(true); });
  };
  function addCompany(f,c){
    var d=String(c.domain||'').toLowerCase();
    if (!d || f.companies.some(function(x){ return x.domain===d; })) return;
    if (f.companies.length>=MAX_COMPANIES){ showToast('You can pick up to '+MAX_COMPANIES+' companies.','info'); return; }
    f.companies.push({ name:c.name||d, domain:d, city:c.city||'', state:c.state||'' });
  }
  window.fdCoAdd = function(i){ captureForm(); var f=curForm(); if(!f||!F.co.list||!F.co.list[i]) return; addCompany(f,F.co.list[i]); paint(true); };
  window.fdCoDrop = function(i){ captureForm(); var f=curForm(); if(!f) return; f.companies.splice(i,1); paint(true); };

  function bodyOf(f){
    return { source:f.source||'apollo', sectors:f.sectors.slice(), sector:f.sectors[0]||null, titles:f.titles.slice(), locations:lines(f.locations), sizes:f.sizes, posted_days:f.posted_days,
             keywords:lines(f.keywords), companies:f.companies, domains:f.companies.map(function(c){ return c.domain; }) };
  }
  // Find leads now: a one-off search. Nothing is saved or scheduled; the cards land in Today's cards.
  window.fdFindNow = function(){
    if (F.running) return;
    captureForm(); var f=curForm();
    F.running='find'; F.nowNote=''; paint(true);
    apiPost('/finder/find', bodyOf(f)).then(function(r){
      F.running=false;
      var x=((r&&r.results)||[])[0]||{};
      F.nowNote=x.note||'Done.';
      if (r && r.credits && F.access) F.access.credits=r.credits;
      if (r && r.jobsource && F.access) F.access.jobsource = Object.assign({}, F.access.jobsource, r.jobsource);
      showToast(F.nowNote,(r&&r.new_cards)?'success':'info');
      if (r && r.new_cards){ F.tab='cards'; F.cardSearch=''; loadCards(); } else paint(true);
    }).catch(function(e){ F.running=false; F.nowNote=e.message; showToast(e.message,'error'); paint(true); });
  };
  // Keep a one-off search as a daily one.
  window.fdSaveNowAsDaily = function(){
    captureForm(); var f=curForm();
    var body=bodyOf(f);
    body.name=((body.titles[0]||'Search')+' in '+(body.locations[0]||'')).trim().slice(0,80);
    apiPost('/finder/searches', body).then(function(){ showToast('Saved as a daily search — it runs every morning ("'+body.name+'")','success'); loadSearches(); })
      .catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdSaveSearch = function(){
    captureForm(); var f=F.form; if(!f) return;
    var body=bodyOf(f); body.name=f.name.trim();
    var req = f.id ? apiPut('/finder/searches/'+f.id, body) : apiPost('/finder/searches', body);
    req.then(function(){ var edited=!!f.id; F.form=null; showToast(edited?'Search updated':'Search saved — it runs every morning, or press Run now','success'); loadSearches(); })
      .catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdToggleSearch = function(id){
    var s=(F.searches||[]).find(function(x){ return x.id===id; }); if(!s) return;
    var body=bodyOf(formFrom(s)); body.name=s.name; body.active = s.active===false;
    apiPut('/finder/searches/'+id, body).then(function(){ showToast(body.active?'Search resumed':'Search paused — it will not run each morning','info'); loadSearches(); })
      .catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdDeleteSearch = function(id){
    if (!confirm('Delete this saved search? Cards it already made stay.')) return;
    apiDelete('/finder/searches/'+id).then(function(){ showToast('Search deleted','info'); loadSearches(); }).catch(function(e){ showToast(e.message,'error'); });
  };

  var SOURCE_LABEL = { apollo:'Apollo', free:'Free job sources', both:'Apollo + free job sources' };
  function coLine(c){ return [[c.city,c.state].filter(Boolean).join(', '), c.domain, c.employees?('about '+c.employees+' people'):''].filter(Boolean).join(' · '); }
  function renderIndustries(f){
    var picked=f.sectors.map(function(id){ var s=sectorById(id); return s?'<span class="fd-chip">'+esc(s.label)+' <button type="button" class="fd-x" aria-label="Remove '+esc(s.label)+'" onclick="fdDropSector(\''+esc(id)+'\')">×</button></span>':''; }).join('');
    var left=sectorList().filter(function(s){ return f.sectors.indexOf(s.id)<0; }).sort(function(a,b){ return a.label.localeCompare(b.label); })
      .map(function(s){ return '<option value="'+esc(s.id)+'">'+esc(s.label)+'</option>'; }).join('');
    return '<div class="fd-label">Industries</div>'+
      (picked?'<div class="fd-pills">'+picked+'</div>':'')+
      (f.sectors.length<MAX_SECTORS?'<select id="fd-f-sector-add" class="sel fd-wide" onchange="fdAddSector(this.value)"><option value="">+ Add an industry…</option>'+left+'</select>':'<div class="fd-hint">That is the most industries at once ('+MAX_SECTORS+').</div>');
  }
  function renderTitles(f){
    var shown={};
    var blocks=f.sectors.map(function(id){
      var sec=sectorById(id); if(!sec) return '';
      var on=sec.titles.filter(function(t){ return titleIdx(f,t)>=0; }).length;
      sec.titles.forEach(function(t){ shown[t.toLowerCase()]=1; });
      var pills=sec.titles.map(function(t,i){ var is=titleIdx(f,t)>=0;
        return '<button type="button" class="fd-pill'+(is?' on':'')+'" aria-pressed="'+(is?'true':'false')+'" onclick="fdTitleToggle(\''+esc(id)+'\','+i+')">'+(is?'✓ ':'')+esc(t)+'</button>'; }).join('');
      return '<div class="fd-block-box"><div class="fd-row fd-between"><span class="fd-strong fs-12">'+esc(sec.label)+' <span class="fd-hint">('+on+' of '+sec.titles.length+' ticked)</span></span>'+
        '<span class="fd-row"><button type="button" class="fd-pill" onclick="fdTitlesAll(\''+esc(id)+'\')">Select all</button><button type="button" class="fd-pill" onclick="fdTitlesNone(\''+esc(id)+'\')">Clear</button></span></div>'+
        '<div class="fd-pills">'+pills+'</div></div>';
    }).join('');
    var own=f.titles.map(function(t,i){ return shown[t.toLowerCase()]?'':'<span class="fd-chip">'+esc(t)+' <button type="button" class="fd-x" aria-label="Remove '+esc(t)+'" onclick="fdTitleDrop('+i+')">×</button></span>'; }).join('');
    return '<div class="fd-label">Job titles <span class="fd-hint">('+f.titles.length+' of '+MAX_TITLES+')</span></div>'+
      (blocks||f.titles.length?'':'<div class="fd-hint">Pick an industry for titles to tick, or type your own.</div>')+blocks+
      (own?'<div class="fd-hint">Your titles</div><div class="fd-pills">'+own+'</div>':'')+
      '<div class="fd-row"><input id="fd-f-newtitle" class="inp fd-grow" placeholder="Type a job title, e.g. CNC Machinist, then Enter" value="'+esc(F.newTitle)+'" onkeydown="if(event.key===\'Enter\'){event.preventDefault();fdTitleAdd();}">'+
      '<button type="button" class="btn btn-outline btn-sm" onclick="fdTitleAdd()">Add title</button></div>';
  }
  function renderCompanies(f){
    var chips=f.companies.map(function(c,i){
      var where=[c.city,c.state].filter(Boolean).join(', ');
      return '<span class="fd-chip"><strong>'+esc(c.name)+'</strong>'+(where?' · '+esc(where):'')+(c.name!==c.domain?' · '+esc(c.domain):'')+' <button type="button" class="fd-x" aria-label="Remove '+esc(c.name)+'" onclick="fdCoDrop('+i+')">×</button></span>'; }).join('');
    var list=(F.co.list||[]).map(function(c,i){
      var has=f.companies.some(function(x){ return x.domain===c.domain; });
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+esc(c.name)+'</strong><span class="fd-hint">'+esc(coLine(c)||'No location on file')+'</span></div>'+
        (has?'<span class="fd-tag">Added ✓</span>':'<button type="button" class="btn btn-outline btn-sm" onclick="fdCoAdd('+i+')">Add</button>')+'</div>'; }).join('');
    return '<div class="fd-label">Preferred companies <span class="fd-hint">(only these are searched)</span></div>'+
      (chips?'<div class="fd-pills">'+chips+'</div>':'')+
      '<div class="fd-row"><input id="fd-f-co" class="inp fd-grow" placeholder="A company name, or paste its website" value="'+esc(F.co.q)+'" onkeydown="if(event.key===\'Enter\'){event.preventDefault();fdCoLookup();}">'+
      '<button type="button" class="btn btn-outline btn-sm" '+(F.co.busy?'disabled':'')+' onclick="fdCoLookup()" title="Asks Apollo for the real companies with that name and where they are (1 Apollo credit when it finds some). A website like acme.com is added directly, free.">'+(F.co.busy?'Looking…':'Look up')+'</button></div>'+
      (F.co.note?'<div class="ld-box is-info" role="status">'+esc(F.co.note)+'</div>':'')+list;
  }

  function renderSource(f){
    var acc=F.access||{}, ap=acc.apollo&&acc.apollo.connected, js=acc.jobsource||{}, src=f.source||'apollo';
    // The longer words are tooltips: the screen keeps the three plain names.
    function opt(v,label,tip){ return '<label class="fd-use" title="'+esc(tip)+'"><input type="radio" name="fd-src" class="fd-src-box" value="'+v+'" '+(src===v?'checked':'')+' onclick="fdPickSource(\''+v+'\')"> <strong>'+label+'</strong></label>'; }
    var warn='';
    if (src!=='free' && !ap) warn+='<div class="ld-box is-stop" role="status">Apollo is not connected, so Apollo cannot be searched. An admin adds its key in Admin → Integrations &amp; API Keys.</div>';
    if (src!=='apollo' && !js.connected) warn+='<div class="ld-box is-stop" role="status">Free job sources are not connected yet. An admin adds the job-search key in Admin → Integrations &amp; API Keys, under Apollo.</div>';
    var note = src==='apollo' ? '' : '<div class="fd-hint">Company size and industry words apply to Apollo only. Free job sources bring companies and jobs, not people.</div>';
    return '<div class="fd-label">Search with</div><div class="fd-row">'+
      opt('apollo','Apollo','The company database — uses your Apollo credits')+
      opt('free','Free job sources','Searches job sites by title — no Apollo credits')+
      opt('both','Both','Apollo plus the free sources, each company once')+'</div>'+warn+note;
  }
  // What pressing Find costs, said where the button is (it used to be a paragraph under the title).
  function costLine(f){
    var js=(F.access&&F.access.jobsource)||{}, src=f.source||'apollo', bits=[];
    if (src!=='free') bits.push('1 Apollo credit');
    if (src!=='apollo') bits.push('up to '+(js.per_run||3)+' job-source requests');
    return 'Uses '+bits.join(' + ')+'.';
  }
  // The filters most searches never touch fold away; the button says how many are in use.
  function moreCount(f){ return f.sizes.length+(String(f.keywords||'').trim()?1:0)+f.companies.length; }
  function moreIsOpen(f){ return F.moreOpen==null ? moreCount(f)>0 : !!F.moreOpen; }
  window.fdMore = function(){ captureForm(); var f=curForm(); if(!f) return; F.moreOpen=!moreIsOpen(f); paint(true); };
  function renderForm(mode){
    var once=(mode==='now');
    var f=once?curForm():F.form, acc=F.access||{};
    var sizes=(acc.sizes||[]).map(function(b){ return '<label class="fd-use"><input type="checkbox" class="fd-size-box" value="'+esc(b.id)+'" '+(f.sizes.indexOf(b.id)>=0?'checked':'')+'> '+esc(b.label)+'</label>'; }).join('');
    var pr=acc.posted||{ min:0, max:30 };
    var open=moreIsOpen(f), n=moreCount(f);
    var more='<div class="fd-row"><button type="button" class="fd-pill" aria-expanded="'+(open?'true':'false')+'" onclick="fdMore()">'+(open?'Fewer filters ▴':'More filters'+(n?' · '+n:'')+' ▾')+'</button>'+
      (open?'':'<span class="fd-hint">company size, industry words, preferred companies</span>')+'</div>'+
      (open?'<div class="fd-label">Company size <span class="fd-hint">(none ticked = any)</span></div><div class="fd-row">'+sizes+'</div>'+
        '<div class="fd-label">Industry words</div><input id="fd-f-keywords" class="inp fd-wide" placeholder="e.g. machining, fabrication" value="'+esc(f.keywords)+'">'+
        renderCompanies(f):'');
    return '<div class="card fd-form">'+
      '<div class="fs-14 fd-strong">'+(once?'Find leads now':(f.id?'Edit this daily search':'New daily search'))+'</div>'+
      '<div class="fd-hint">'+(once?'Nothing is saved. The companies it finds go to Today\'s cards.':'Runs by itself every morning until you pause or delete it.')+'</div>'+
      renderSource(f)+
      (once?'':'<div class="fd-label">Name of the run</div><input id="fd-f-name" class="inp fd-wide" placeholder="e.g. Texas machine shops" value="'+esc(f.name)+'">')+
      renderIndustries(f)+renderTitles(f)+
      '<div class="fd-grid">'+
        '<div><div class="fd-label">Where the job is</div><input id="fd-f-locations" class="inp fd-wide" placeholder="e.g. Texas, Austin TX, remote" value="'+esc(f.locations)+'"></div>'+
        '<div><div class="fd-label">Posted <span id="fd-posted-out" class="fd-strong">'+esc(postedText(f.posted_days))+'</span></div>'+
          '<input id="fd-f-posted" class="fd-slider fd-wide" type="range" min="'+pr.min+'" max="'+pr.max+'" step="1" value="'+esc(f.posted_days)+'" style="--fd-pct:'+Math.round(100*(f.posted_days-pr.min)/Math.max(1,pr.max-pr.min))+'%" aria-label="How many days back jobs may have been posted" oninput="fdPostedInput(this.value)">'+
          '<div class="fd-row fd-between fd-hint"><span>Today</span><span>'+pr.max+' days</span></div></div>'+
      '</div>'+
      more+
      (once
        ? '<div class="fd-row fd-between fd-pad"><span class="fd-hint">'+esc(costLine(f))+'</span><span class="fd-row"><button class="btn btn-outline" onclick="fdSaveNowAsDaily()" title="Keep these settings as a search that runs every morning">Also run this every day</button>'+
          '<button class="btn btn-primary" '+(F.running?'disabled':'')+' onclick="fdFindNow()">'+(F.running==='find'?'Finding…':'Find leads now')+'</button></span></div>'+
          (F.nowNote?'<div class="ld-box is-info" role="status">'+esc(F.nowNote)+'</div>':'')
        : '<div class="fd-row fd-end"><button class="btn btn-outline" onclick="fdCancelForm()">Cancel</button><button class="btn btn-primary" onclick="fdSaveSearch()">'+(f.id?'Save changes':'Save daily search')+'</button></div>')+
    '</div>';
  }

  function foundBefore(id){
    var c=countsFor(id); if(!(c.accepted||c.waiting||c.rejected)) return '';
    return '<div class="fs-12 c-text3">Found before: '+c.accepted+' saved as leads · '+c.waiting+' waiting · '+c.rejected+' turned down <button class="fd-pill" onclick="fdHistFor(\''+esc(id)+'\')">See them</button></div>';
  }
  function summaryOf(s){
    var n=(s.companies&&s.companies.length)||(s.domains||[]).length;
    var bits=[(s.titles||[]).slice(0,4).join(', ')+((s.titles||[]).length>4?'…':''), (s.locations||[]).join(', '), 'posted '+postedText(s.posted_days), n?('only '+plural(n,'chosen company','chosen companies')):'', 'looks in: '+(SOURCE_LABEL[s.source||'apollo']||'Apollo')];
    return bits.filter(Boolean).join(' · ');
  }
  function renderSearches(){
    if (F.form) return renderForm();
    var list=F.searches;
    if (!list) return '<div class="fd-empty">Loading…</div>';
    var head='<div class="fd-row fd-between"><div class="fd-hint">These run by themselves every morning and bring their best companies to Today\'s cards.</div>'+
      '<button class="btn btn-primary btn-sm" onclick="fdNewSearch()">+ New daily search</button></div>';
    if (!list.length) return head+'<div class="card fd-empty">No daily searches yet.<br>A daily search says what jobs to look for and where — PACE then finds companies hiring for them every morning.<br><button class="btn btn-primary" onclick="fdNewSearch()">Make your first daily search</button></div>';
    return head+list.map(function(s){
      return '<div class="card fd-card"><div class="fd-row fd-between"><div class="fd-grow">'+
        '<div class="fs-14 fd-strong">'+esc(s.name)+(s.active===false?' <span class="fd-tag">paused</span>':' <span class="fd-tag">every morning</span>')+'</div>'+
        '<div class="fs-12_5 c-text2">'+esc(summaryOf(s))+'</div>'+
        '<div class="fs-12 c-text3">'+(s.last_run_at?'Last ran '+esc(fmtDay(s.last_run_at))+' — '+esc(s.last_run_note||''):'Has not run yet.')+'</div>'+foundBefore(s.id)+'</div>'+
        '<div class="fd-row"><button class="btn btn-sm btn-primary" '+(F.running?'disabled':'')+' title="Runs it now, early. It still runs every morning." onclick="fdRun(\''+s.id+'\')">'+((F.running===s.id||F.running==='all')?'Running…':'Run now')+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="fdEditSearch(\''+s.id+'\')">Edit</button>'+
        '<button class="btn btn-sm btn-outline" onclick="fdToggleSearch(\''+s.id+'\')">'+(s.active===false?'Resume':'Pause')+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="fdDeleteSearch(\''+s.id+'\')">Delete</button></div></div></div>';
    }).join('');
  }

  // ── today's cards ────────────────────────────────────────────────────────
  function renderCard(c){
    var blocked=c.decision&&c.decision.blocked;
    var place=[c.city,c.state].filter(Boolean).join(', ');
    var facts=[place, c.employees?plural(c.employees,'employee'):'', c.revenue||''].filter(Boolean).join(' · ');
    var links=[c.website?'<a href="'+esc(/^https?:/i.test(c.website)?c.website:'https://'+c.website)+'" target="_blank" rel="noopener">'+esc(c.domain||c.website)+'</a>':'',
               c.linkedin_url?'<a href="'+esc(c.linkedin_url)+'" target="_blank" rel="noopener">LinkedIn</a>':'', c.phone?esc(c.phone):''].filter(Boolean).join(' · ');
    var chips=(c.chips||[]).map(function(x){ return '<span class="fd-chip">'+esc(x)+'</span>'; }).join('');
    var posts=c.postings;
    var postBlock = posts
      ? '<div class="fd-posts">'+(posts.length?posts.slice(0,8).map(function(p){
          return '<div>• '+(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.title)+'</a>':esc(p.title))+
            '<span class="fd-hint"> '+esc([[p.city,p.state].filter(Boolean).join(', '), p.age_days!=null?p.age_days+'d ago':'', p.source].filter(Boolean).join(' · '))+'</span></div>';
        }).join(''):'<span class="fd-hint">Apollo lists no open jobs for this company right now.</span>')+'</div>'
      : '<button class="btn btn-sm btn-outline" onclick="fdPostings(\''+c.id+'\',this)">See their open jobs · 1 credit</button>';
    return '<div class="card fd-card'+(blocked?' is-blocked':'')+'">'+
      '<div class="fd-row fd-between"><div class="fd-grow">'+
        '<div class="fs-15 fd-strong">'+esc(c.company_name)+'</div>'+
        (facts?'<div class="fs-12_5 c-text2">'+esc(facts)+'</div>':'')+
        (links?'<div class="fs-12_5">'+links+'</div>':'')+
      '</div></div>'+
      (chips?'<div class="fd-pills">'+chips+'</div>':'')+
      (c.search&&(c.search.titles||[]).length?'<div class="fs-12 c-text3">Found for: '+esc(c.search.titles.slice(0,3).join(', '))+(c.search.locations&&c.search.locations.length?' in '+esc(c.search.locations.slice(0,2).join(', ')):'')+'</div>':'')+
      decisionBox(c.decision)+
      '<div class="fd-row fd-between">'+postBlock+
        '<div class="fd-row"><button class="btn btn-sm btn-outline" onclick="fdReject(\''+c.id+'\',this)">Reject</button>'+
          '<button class="btn btn-sm btn-outline" onclick="fdWait(\''+c.id+'\',this)" title="Hide it for '+esc(String((F.access&&F.access.wait_days)||14))+' days, then show it again">Wait '+esc(String((F.access&&F.access.wait_days)||14))+' days</button>'+
          '<button class="btn btn-sm btn-primary" '+(blocked?'disabled title="This company cannot be added right now — see the reason above"':'')+' onclick="fdAccept(\''+c.id+'\')">Accept</button></div></div>'+
    '</div>';
  }
  function renderCards(){
    if (F.loading && !F.cards) return '<div class="fd-empty">Loading…</div>';
    var list=F.cards||[];
    if (!list.length){
      var noSearch = F.searches && !F.searches.length;
      return '<div class="card fd-empty">'+(noSearch
        ? 'Nothing to review yet — you have not saved a search.<br><button class="btn btn-primary" onclick="fdNewSearch()">Make a search</button>'
        : 'Nothing to review right now.<br>Your searches run each morning. To look now, press <strong>Run my searches</strong>.')+'</div>';
    }
    // Which search found each card: a row of choices appears when more than one search has cards (a view only —
    // the server already gave this person only their own cards).
    var names={ '':'One-off searches' }; (F.searches||[]).forEach(function(x){ names[x.id]=x.name; });
    var counts={}; list.forEach(function(c){ var k=c.search_id||''; counts[k]=(counts[k]||0)+1; });
    var keys=Object.keys(counts);
    var sel=(F.cardSearch && counts[F.cardSearch]) ? F.cardSearch : '';
    var bar = keys.length>1
      ? '<div class="fd-pills"><button class="fd-pill'+(sel===''?' on':'')+'" onclick="fdFilterCards(\'\')">All · '+list.length+'</button>'+
        keys.map(function(k){ return '<button class="fd-pill'+(sel===k?' on':'')+'" onclick="fdFilterCards(\''+esc(k)+'\')">'+esc(names[k]||'Earlier search')+' · '+counts[k]+'</button>'; }).join('')+'</div>'
      : '';
    var shown=list.filter(function(c){ return !sel || (c.search_id||'')===sel; });
    // NEW CARDS FIRST (owner, 8 Oct): the server already puts the newest run on top; when older cards exist too, a line says
    // where the new ones end. With only one run there is nothing to divide, so nothing is drawn.
    var fresh=shown.filter(function(c){ return c.is_new; }), older=shown.filter(function(c){ return !c.is_new; });
    if (!fresh.length || !older.length) return bar+shown.map(renderCard).join('');
    return bar+'<div class="fd-label fd-group">New · found '+esc(foundAgo(fresh[0].found_at))+' · '+fresh.length+'</div>'+fresh.map(renderCard).join('')+
      '<div class="fd-label fd-group">Earlier cards · '+older.length+'</div>'+older.map(renderCard).join('');
  }
  // "5 min ago", "3 h ago", "yesterday" — for the line above the newest cards.
  function foundAgo(iso){
    var t=iso?new Date(iso).getTime():NaN; if(!isFinite(t)) return 'recently';
    var m=Math.round((Date.now()-t)/60000);
    if (m<1) return 'just now';
    if (m<60) return m+' min ago';
    if (m<1440) return Math.round(m/60)+' h ago';
    var d=Math.round(m/1440); return d===1?'yesterday':d+' days ago';
  }
  window.fdFilterCards = function(id){ F.cardSearch=id||''; paint(); };

  // ── history: what my searches found before ─────────────────────────────
  window.fdHistStatus = function(st){ F.histStatus=st; paint(); };
  window.fdHistSearch = function(id){ F.histSearch=id||''; paint(); };
  window.fdHistToggle = function(id){ F.histOpen[id]=!F.histOpen[id]; paint(); };
  window.fdHistQ = function(v){ F.histQ=String(v||''); paint(); };
  window.fdHistAll = function(){ F.histAll=true; loadHistory(); };
  window.fdHistFor = function(id){
    F.histSearch=id; F.tab='history';
    var c=countsFor(id); F.histStatus = c.accepted?'accepted':(c.waiting?'waiting':'rejected');
    paint();
  };
  window.fdUnwait = function(id, btn){
    if (btn) btn.disabled=true;
    apiPost('/finder/cards/'+id+'/unwait', {}).then(function(){ showToast('Back in Today\'s cards','success'); loadCards(); loadHistory(); })
      .catch(function(e){ showToast(e.message,'error'); if(btn) btn.disabled=false; });
  };
  window.fdOpenLead = function(id){
    if (!(STATE.jobs||[]).some(function(j){ return j.id===id; })){ showToast('That lead is not on your list right now — press Refresh in Leads, or it may have been handed to someone else','warning'); return; }
    goPage('leads'); openJob(id);
  };
  function countsFor(searchId){
    var c={ accepted:0, waiting:0, rejected:0 };
    ((F.hist&&F.hist.items)||[]).forEach(function(x){ if((x.search_id||'')===searchId) c[x.status]=(c[x.status]||0)+1; });
    return c;
  }
  function searchName(id){ if(!id) return 'a one-off search'; var s=(F.searches||[]).find(function(x){ return x.id===id; }); return s?s.name:'an earlier search'; }
  // The people and the jobs behind a saved lead — what the card showed, kept with the lead.
  function histDetails(l){
    var people=(l.contacts||[]).map(function(c){
      return '<div>• <strong>'+esc(c.name||'')+'</strong>'+(c.primary?' <span class="fd-tag">main contact</span>':'')+'<span class="fd-hint"> '+esc([c.title,c.email].filter(Boolean).join(' · '))+'</span></div>';
    }).join('') || '<div class="fd-hint">No contacts on this lead.</div>';
    var jobs=(l.jobs||[]).map(function(j){
      return '<div>• '+(j.url?'<a href="'+esc(j.url)+'" target="_blank" rel="noopener">'+esc(j.title)+'</a>':esc(j.title))+
        (j.main?' <span class="fd-tag">main job</span>':(j.also?' <span class="fd-tag">also hiring</span>':''))+
        '<span class="fd-hint"> '+esc([j.source, j.posted_at?fmtDay(j.posted_at):''].filter(Boolean).join(' · '))+'</span></div>';
    }).join('') || '<div class="fd-hint">No jobs were kept.</div>';
    return '<div class="fd-grid fd-detail"><div><div class="fd-label">People to contact</div>'+people+'</div><div><div class="fd-label">Jobs</div>'+jobs+'</div></div>';
  }
  function renderHistory(){
    var h=F.hist;
    if (!h) return '<div class="fd-empty">Loading…</div>';
    var items=h.items||[], cnt=h.counts||{};
    var st=F.histStatus||'accepted';
    var labels=[['accepted','Saved as leads'],['waiting','Waiting'],['rejected','Turned down']];
    var statusBar='<div class="fd-pills">'+labels.map(function(l){ return '<button class="fd-pill'+(st===l[0]?' on':'')+'" onclick="fdHistStatus(\''+l[0]+'\')">'+l[1]+' · '+(cnt[l[0]]||0)+'</button>'; }).join('')+'</div>';
    var sIds={}; items.forEach(function(x){ sIds[x.search_id||'']=true; });
    var keys=Object.keys(sIds);
    var sel=(F.histSearch && sIds[F.histSearch]) ? F.histSearch : '';
    var searchBar = keys.length>1
      ? '<div class="fd-pills"><button class="fd-pill'+(sel===''?' on':'')+'" onclick="fdHistSearch(\'\')">All searches</button>'+
        keys.map(function(k){ return '<button class="fd-pill'+(sel===k?' on':'')+'" onclick="fdHistSearch(\''+esc(k)+'\')">'+esc(searchName(k).replace(/^./,function(c){ return c.toUpperCase(); }))+'</button>'; }).join('')+'</div>' : '';
    var q=String(F.histQ||'').toLowerCase().trim();
    var rows=items.filter(function(x){ return x.status===st && (!sel || (x.search_id||'')===sel) && (!q || String(x.company_name).toLowerCase().indexOf(q)>=0); });
    var list = rows.length ? rows.map(function(x){
      var right='';
      if (x.status==='accepted'){
        right = x.lead ? '<span class="fd-hint"><strong>'+esc(x.lead.position||'')+'</strong> · '+esc(x.lead.stage||'')+'</span>'+
          '<button class="btn btn-sm btn-outline" onclick="fdHistToggle(\''+esc(x.id)+'\')">'+(F.histOpen[x.id]?'Hide':'POCs &amp; jobs')+'</button>'+
          '<button class="btn btn-sm btn-primary" onclick="fdOpenLead(\''+esc(x.lead.id)+'\')">Open lead</button>'
             : '<span class="fd-hint">'+(x.lead_elsewhere?'This lead now belongs to someone else.':'The lead was deleted.')+'</span>';
      } else if (x.status==='waiting'){
        right='<span class="fd-hint">Comes back on '+esc(fmtDay(x.wait_until))+'</span><button class="btn btn-sm btn-outline" onclick="fdUnwait(\''+esc(x.id)+'\',this)">Show now</button>';
      } else right='<span class="fd-hint">Turned down — never shown to you again</span>';
      return '<div class="card fd-card"><div class="fd-row fd-between"><div class="fd-grow"><div class="fs-14 fd-strong">'+esc(x.company_name)+'</div>'+
        '<div class="fs-12 c-text3">'+esc([x.place, 'Found by '+searchName(x.search_id||''), x.decided_at?fmtDay(x.decided_at):''].filter(Boolean).join(' · '))+'</div></div>'+
        '<div class="fd-row">'+right+'</div></div>'+(x.lead&&F.histOpen[x.id]?histDetails(x.lead):'')+'</div>';
    }).join('') : '<div class="card fd-empty">'+({ accepted:'No company from your searches has been saved as a lead yet.', waiting:'Nothing is waiting.', rejected:'You have not turned anything down.' }[st])+(q?'<br>Nothing matches “'+esc(F.histQ)+'”.':'')+'</div>';
    var foot='<div class="fd-hint fd-pad">'+(h.hidden?esc(String(h.hidden))+' older than '+esc(String(h.days))+' days are hidden. <button class="fd-pill" onclick="fdHistAll()">Show everything</button><br>':'')+
      'A company you never decided on is removed after '+esc(String(h.card_days||5))+' days — Accept, Wait or Reject keeps a record of it here.</div>';
    return '<div class="fd-row fd-between"><div class="fd-grow">'+statusBar+'</div><input id="fd-hq" class="inp" placeholder="Search by company name" value="'+esc(F.histQ)+'" oninput="fdHistQ(this.value)"></div>'+searchBar+list+foot;
  }

  // ── admin: who may use it, and Apollo's reach ────────────────────────────
  window.fdAdminSave = function(id){
    var on=document.getElementById('fd-on-'+id), n=document.getElementById('fd-n-'+id);
    apiPut('/finder/admin/users/'+id, { enabled:!!(on&&on.checked), daily:(n&&String(n.value).trim()!=='')?Number(n.value):null }).then(function(){
      showToast('Saved','success'); loadAdmin();
    }).catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdDiagnose = function(){
    if (F.diagBusy) return;
    if (!confirm('This tests Apollo with three tiny searches and uses about 2 of your credits. Go ahead?')) return;
    F.diagBusy=true; F.diag=null; paint();
    apiGet('/finder/diagnose').then(function(r){ F.diagBusy=false; F.diag=r; if(r&&r.credits&&F.access) F.access.credits={ used:r.credits.used, limit:r.credits.limit }; paint(); })
      .catch(function(e){ F.diagBusy=false; F.diag={ checks:[{ ok:false, text:e.message }] }; paint(); });
  };
  function renderAdmin(){
    var a=F.admin, acc=F.access||{};
    var diag = F.diag ? '<div class="fd-diag">'+(F.diag.checks||[]).map(function(c){ return '<div class="'+(c.ok?'c-green':'c-red')+'">'+(c.ok?'✓ ':'✗ ')+esc(c.text)+'</div>'; }).join('')+'</div>' : '';
    var users = !a ? '<div class="fd-empty">Loading…</div>' : (a.users||[]).map(function(u){
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+esc(u.name||u.email)+'</strong><span class="fd-hint">'+esc(u.roles.join(', '))+'</span></div>'+
        '<div class="fd-row"><label class="fd-use"><input type="checkbox" id="fd-on-'+u.id+'" '+(u.enabled?'checked':'')+'> May use it</label>'+
        '<input id="fd-n-'+u.id+'" class="inp fd-num" type="number" min="0" max="500" placeholder="'+a.default_daily+'" value="'+(u.daily!=null?u.daily:'')+'" title="Cards a day (empty = '+a.default_daily+')"> <span class="fd-hint">cards/day</span>'+
        '<button class="btn btn-sm btn-primary" onclick="fdAdminSave(\''+u.id+'\')">Save</button></div></div>';
    }).join('');
    var js=acc.jobsource||{}, jsOn=!!js.connected;
    // The key itself lives under Admin → Integrations & API Keys, beside Apollo's (owner, 8 Oct) — here only whether it is there.
    var jsCard='<div class="card fd-form"><div class="fs-14 fd-strong">Free job sources (JSearch)</div>'+
      '<div class="fs-12_5">'+(jsOn?'<span class="c-green">✓ Connected.</span>':'<span class="c-red">Not connected.</span> People cannot search by job title without Apollo until a key is saved.')+
      ' Today: '+esc(String(js.used||0))+' of '+esc(String(js.limit||0))+' requests used by your organisation. The daily numbers are under Admin → Settings → Lead Finder.</div>'+
      '<div class="fd-row"><button class="btn btn-sm btn-outline" onclick="openIntegrationsModal()">'+(jsOn?'Manage the key':'Add the key')+' in Integrations &amp; API Keys</button></div></div>';
    return jsCard+'<div class="card fd-form"><div class="fs-14 fd-strong">Apollo</div>'+
      '<div class="fs-12_5 c-text2">'+(acc.apollo&&acc.apollo.connected?'An Apollo key is saved.':'<span class="c-red">Apollo is not connected.</span> Add its key in Admin → Integrations &amp; API Keys.')+
      ' Today: '+esc(String(acc.credits?acc.credits.used:0))+' of '+esc(String(acc.credits?acc.credits.limit:0))+' credits used by your organisation. The daily limits and the wait time are under Admin → Settings → Lead Finder.</div>'+
      '<div class="fd-row"><button class="btn btn-sm btn-outline" '+(F.diagBusy?'disabled':'')+' onclick="fdDiagnose()">'+(F.diagBusy?'Checking…':'Check what my Apollo key can do (about 2 credits)')+'</button></div>'+diag+'</div>'+
      '<div class="fs-14 fd-strong fd-pad">Who may use Find Leads</div>'+
      '<div class="fd-hint">Admins always can. Everyone else needs to be switched on here. Leave “cards/day” empty to use the organisation\'s number'+(a?' ('+a.default_daily+')':'')+'.</div>'+users;
  }

  // ── the page ─────────────────────────────────────────────────────────────
  // The day's meters, in one quiet line where the long sentence used to be (the stat strip is gone — owner, 8 Oct: too much on screen).
  function meters(acc){
    var bits=['Apollo '+(acc.credits?acc.credits.used:0)+'/'+(acc.credits?acc.credits.limit:0),'emails '+(acc.reveals?acc.reveals.used:0)+'/'+(acc.reveals?acc.reveals.limit:0)];
    if (acc.jobsource&&acc.jobsource.connected) bits.push('job sources '+(acc.jobsource.used||0)+'/'+(acc.jobsource.limit||0));
    return '<span class="fs-12 c-ink3" title="What your organisation has used today, out of its daily limits">Today: '+esc(bits.join(' · '))+'</span>';
  }
  function renderPage(){
    var acc=F.access;
    if (!acc) return UI.page({ body:'<div class="fd-empty">Loading…</div>' });
    var src=sourcing();
    if (!acc.enabled && !src) return UI.page({ body:'<div class="card fd-empty">Find Leads is not switched on for you yet.<br>Ask an admin to turn it on.</div>' });
    // Someone who may review Sourced Leads but has not been switched on for the Lead Finder sees only that tab.
    if (!acc.enabled) F.tab='sourced';
    if (F.tab==='sourced' && !src) F.tab='cards';
    var tabs=[];
    if (acc.enabled){
      tabs.push({ id:'cards', label:'Today\'s cards', n:(F.cards||[]).length, onclick:"fdTab('cards')" });
      tabs.push({ id:'now', label:'Find leads now', onclick:"fdTab('now')" });
      tabs.push({ id:'searches', label:'Daily run', onclick:"fdTab('searches')" });
    }
    if (src) tabs.push({ id:'sourced', label:'Sourced leads', n:srcdNewCount(), onclick:"fdTab('sourced')" });
    if (acc.enabled){
      tabs.push({ id:'history', label:'Saved & past', n:(F.hist&&F.hist.counts&&F.hist.counts.accepted)||0, onclick:"fdTab('history')" });
      if (acc.is_admin) tabs.push({ id:'admin', label:'Access & limits', onclick:"fdTab('admin')" });
    }
    var toolbar = (F.tab==='cards' && acc.enabled)
      ? '<div class="fd-row fd-between fd-toolbar"><span class="fd-hint">'+esc(String(F.today||0))+' of your '+esc(String(F.daily||acc.daily||0))+' cards for today'+(F.waiting?' · '+esc(String(F.waiting))+' waiting':'')+'</span>'+
        '<button class="btn btn-sm btn-primary" '+(F.running?'disabled':'')+' onclick="fdRun()">'+(F.running==='all'?'Searching…':'Run my searches')+'</button></div>'
      : '';
    var body = F.tab==='sourced' ? srcdBody()
      : (F.tab==='admin' && acc.is_admin ? renderAdmin() : (F.tab==='now' ? renderForm('now') : (F.tab==='searches' ? renderSearches() : (F.tab==='history' ? renderHistory() : renderCards()))));
    return UI.page({ tabs:UI.tabs(tabs, F.tab, acc.enabled?meters(acc):''), body:toolbar+body });
  }

})();
