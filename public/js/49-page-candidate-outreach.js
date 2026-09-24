// ============================================================================
// CANDIDATE OUTREACH — the Email page's Compose → Candidates side.
//
// The mirror of 48-page-outreach-gen.js, pointed the other way: that one starts
// from a pasted job posting and finds one hiring contact; this one starts from a
// job order we already own and finds many candidates.
//
// Three steps down one page, because that is the actual shape of the job:
//   1. which job          2. which people        3. what it says, then send
//
// This module does NOT write #content. The Email page calls
// renderCandidateOutreachBody() from its own body switch, exactly as it does
// for the Generator — writing #content here would leave the shell's record of
// the screen stale and bring the flicker back (Session 16).
// ============================================================================
(function(){
  'use strict';

  function S(){
    if(!STATE.candOutreach) STATE.candOutreach={
      step:1,
      jobQuery:'', jobs:null, jobsLoading:false, job:null,
      brief:null, briefLoading:false,
      pool:null, poolLoading:false, poolQuery:'', picked:{},
      angle:'direct', preview:null, previewFor:null, previewLoading:false, previewIdx:0,
      sender:null, senderLoading:false, mailboxId:null,
      addToPipeline:false, queuing:false, result:null,
      queue:null, queueLoading:false, openQueue:null
    };
    return STATE.candOutreach;
  }
  window.candOutreachState=S;

  function esc(s){ return htmlEsc(s); }
  function pickedIds(){ var p=S().picked; return Object.keys(p).filter(function(k){return p[k];}); }

  // ── loading ───────────────────────────────────────────────────────────────
  window.candOutreachLoadSender=function(){
    var s=S();
    if(s.sender||s.senderLoading) return;
    s.senderLoading=true;
    apiGet('/candidate-outreach/sender').then(function(r){
      s.sender=r; s.senderLoading=false; render();
    }).catch(function(){ s.senderLoading=false; s.sender={mailbox:null}; render(); });
  };

  var _jobTimer=null;
  window.candOutreachJobSearch=function(q){
    var s=S(); s.jobQuery=q;
    clearTimeout(_jobTimer);
    _jobTimer=setTimeout(function(){ candOutreachLoadJobs(true); },300);
  };

  window.candOutreachLoadJobs=function(force){
    var s=S();
    if(s.jobsLoading||(s.jobs&&!force)) return;
    s.jobsLoading=true;
    var q=String(s.jobQuery||'').trim();
    apiGet('/candidate-outreach/jobs'+(q?'?q='+encodeURIComponent(q):'')).then(function(rows){
      s.jobsLoading=false; s.jobs=rows||[]; render();
    }).catch(function(){ s.jobsLoading=false; s.jobs=[]; render(); });
  };

  window.candOutreachPickJob=function(id){
    var s=S();
    s.job=(s.jobs||[]).filter(function(j){return j.id===id;})[0]||null;
    s.step=2; s.pool=null; s.picked={}; s.preview=null; s.previewFor=null; s.previewIdx=0; s.brief=null;
    render();
    candOutreachLoadPool(true);
    candOutreachLoadBrief();
  };

  // Entry from a JOB (Session 31): the job's page and its Candidates list open
  // this screen with the job and the people already chosen, straight onto the
  // preview. One workflow, several doors (D-0012) — nothing here sends.
  window.candOutreachStartFor=function(job,candidateIds){
    var s=S();
    s.job=job; s.step=3; s.picked={}; s.result=null;
    (candidateIds||[]).forEach(function(id){ s.picked[id]=true; });
    s.pool=null; s.brief=null; s.preview=null; s.previewFor=null; s.previewIdx=0; s.queue=null;
    STATE.composeSide='candidates'; STATE.composeContext=null;
    if(window.setEmailTab){ STATE.page='email'; }
    goPage('email');
    setEmailTab('compose');
    candOutreachLoadBrief();
    candOutreachPreview();
  };

  window.candOutreachBackTo=function(step){
    var s=S(); s.step=step;
    if(step===1){ s.job=null; s.pool=null; s.picked={}; s.preview=null; s.previewIdx=0; s.result=null; }
    render();
    // Arriving from a job page lands on step 3 with no list loaded; stepping
    // back must fetch it, or "Back to the list" shows an empty list.
    if(step===2&&!s.pool) candOutreachLoadPool(true);
  };

  window.candOutreachLoadBrief=function(){
    var s=S();
    if(!s.job||s.briefLoading) return;
    s.briefLoading=true;
    apiGet('/candidate-outreach/jobs/'+encodeURIComponent(s.job.id)+'/brief').then(function(r){
      s.brief=r; s.briefLoading=false; render();
    }).catch(function(){ s.briefLoading=false; render(); });
  };

  // The one AI call this feature makes. Named on the button so it is obvious
  // that it costs something and how often it is paid — once per job, not once
  // per candidate.
  window.candOutreachWriteBrief=function(){
    var s=S();
    if(!s.job||s.briefLoading) return;
    s.briefLoading=true; render();
    apiPost('/candidate-outreach/jobs/'+encodeURIComponent(s.job.id)+'/brief',{}).then(function(r){
      s.brief=r; s.briefLoading=false; s.preview=null; s.previewFor=null; s.previewIdx=0;
      if(r&&r.ai_error) showToast(briefErrorText(r),'warning');
      render();
    }).catch(function(e){
      s.briefLoading=false; showToast(e.message||'Could not write the brief.','warning'); render();
    });
  };

  function briefErrorText(r){
    if(r.ai_error==='brief_rejected') return 'The AI brief broke the house rules, so the built-in one is being used instead.';
    if(r.ai_error==='ai_unparseable') return 'The AI answered in a shape we could not read — using the built-in brief.';
    return (r.ai_error_detail?('AI writer unavailable — '+r.ai_error_detail):'No AI writer answered, so the built-in brief is being used.');
  }

  var _poolTimer=null;
  window.candOutreachPoolSearch=function(q){
    var s=S(); s.poolQuery=q;
    clearTimeout(_poolTimer);
    _poolTimer=setTimeout(function(){ candOutreachLoadPool(true); },300);
  };

  window.candOutreachLoadPool=function(force){
    var s=S();
    if(!s.job) return;
    if(s.poolLoading||(s.pool&&!force)) return;
    s.poolLoading=true;
    var q=String(s.poolQuery||'').trim();
    apiGet('/candidate-outreach/jobs/'+encodeURIComponent(s.job.id)+'/candidates'+(q?'?q='+encodeURIComponent(q):'')).then(function(r){
      s.poolLoading=false; s.pool=r; render();
    }).catch(function(){ s.poolLoading=false; s.pool={results:[]}; render(); });
  };

  window.candOutreachToggle=function(id){
    var s=S(); s.picked[id]=!s.picked[id];
    if(!s.picked[id]) delete s.picked[id];
    render();
  };

  // "Everyone who can actually be written to" — not everyone on screen. A row
  // with no email address or a prior ask cannot be queued, and quietly ticking
  // it would only produce a skip list at the end.
  window.candOutreachPickAll=function(on){
    var s=S(); s.picked={};
    if(on) ((s.pool&&s.pool.results)||[]).forEach(function(r){
      if(r.emailable&&!r.prior) s.picked[r.candidate_id]=true;
    });
    render();
  };

  window.candOutreachSetAngle=function(a){
    var s=S(); s.angle=a; render();
  };

  window.candOutreachToPreview=function(){
    var s=S();
    if(!pickedIds().length){ showToast('Pick at least one candidate first.','warning'); return; }
    s.step=3; s.result=null; render();
    candOutreachPreview();
  };

  // Preview is built for ONE real candidate, with that person's own merge fields
  // filled in — a preview of a template with the variables still showing tells
  // you nothing about what anybody receives.
  //
  // IT USED TO BE HARDCODED TO THE FIRST PERSON PICKED. Queue thirty candidates
  // and you could read exactly one of the thirty emails; the other twenty-nine
  // went out unseen. `previewIdx` walks the picked list, so every one of them
  // can be read before anything sends.
  window.candOutreachPreview=function(){
    var s=S();
    var ids=pickedIds();
    if(!ids.length) return;
    if(s.previewIdx>=ids.length) s.previewIdx=0;      // picks changed under us
    var id=ids[s.previewIdx];
    if(s.previewFor===id&&s.preview) return;
    s.previewLoading=true; render();
    apiPost('/candidate-outreach/preview',{
      candidate_id:id, job_order_id:s.job?s.job.id:null, mailbox_id:s.mailboxId||undefined
    }).then(function(r){
      s.preview=r; s.previewFor=id; s.previewLoading=false; render();
    }).catch(function(e){
      s.previewLoading=false; showToast(e.message||'Could not build a preview.','warning'); render();
    });
  };

  // Step to another picked candidate's copy of the email.
  window.candOutreachPreviewStep=function(delta){
    var s=S(), ids=pickedIds();
    if(ids.length<2) return;
    var n=ids.length;
    s.previewIdx=((s.previewIdx+delta)%n+n)%n;        // wraps both ways
    s.preview=null; s.previewFor=null;
    candOutreachPreview();
  };

  // Change the From mailbox. The preview is rebuilt, because the sign-off and
  // signature are filled from the mailbox that sends — a preview still showing
  // the old name would be a preview of an email nobody receives.
  window.candOutreachSetMailbox=function(id){
    var s=S(); s.mailboxId=id||null; s.preview=null; s.previewFor=null;
    if(s.step===3) candOutreachPreview(); else render();
  };

  window.candOutreachSetPipeline=function(on){ S().addToPipeline=!!on; render(); };

  // Open one sent email to read it; clicking it again closes it.
  window.candOutreachToggleQueue=function(id){ var s=S(); s.openQueue=(s.openQueue===id?null:id); render(); };

  window.candOutreachQueue=function(){
    var s=S();
    var ids=pickedIds();
    if(!ids.length||s.queuing) return;
    s.queuing=true; render();
    apiPost('/candidate-outreach/queue',{
      candidate_ids:ids, job_order_id:s.job?s.job.id:null,
      angle:s.angle, add_to_pipeline:s.addToPipeline, mailbox_id:s.mailboxId||undefined
    }).then(function(r){
      s.queuing=false; s.result=r; s.picked={}; s.pool=null; s.queue=null;
      // BACK TO THE LIST, NOT STUCK ON THE COMPOSER. Clearing the picks while
      // staying on step 3 drew "0 candidates" as the heading above the email
      // that had just gone out — the screen contradicting itself. The list is
      // also where the result belongs: it reloads showing everyone just queued
      // as "already asked".
      s.step=2; s.preview=null; s.previewFor=null; s.previewIdx=0;
      showToast(r.queued+' email'+(r.queued===1?'':'s')+' queued','success');
      s.pendingAt=0; candOutreachLoadPool(true); candOutreachLoadQueue(true); render();
    }).catch(function(e){
      s.queuing=false;
      showToast(e.message==='no_connected_mailbox'
        ? 'No connected mailbox — set one up under Email IDs first.'
        : (e.message||'Could not queue those emails.'),'warning');
      render();
    });
  };

  window.candOutreachLoadQueue=function(force){
    var s=S();
    if(s.queueLoading||(s.queue&&!force)) return;
    s.queueLoading=true;
    var q=s.job?('?job_order_id='+encodeURIComponent(s.job.id)):'';
    apiGet('/candidate-outreach/queue'+q).then(function(rows){
      s.queueLoading=false; s.queue=rows||[]; render();
    }).catch(function(){ s.queueLoading=false; s.queue=[]; render(); });
  };

  window.candOutreachCancel=function(id){
    apiPost('/candidate-outreach/cancel/'+encodeURIComponent(id),{}).then(function(){
      showToast('Pulled back before it went out','success');
      S().queue=null; S().pendingAt=0; candOutreachLoadQueue(true);
    }).catch(function(e){ showToast(e.message||'Could not cancel that one.','warning'); });
  };

  // ── drawing ───────────────────────────────────────────────────────────────
  function senderCard(){
    var s=S().sender;
    if(!s) return '<div class="card cp mb3" style="font-size:12.5px;color:var(--text3)">Checking which mailbox will send…</div>';
    if(!s.mailbox){
      return '<div class="card cp mb3" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--amber-l)">'+
        '<span style="width:8px;height:8px;border-radius:50%;background:var(--amber);display:inline-block"></span>'+
        '<div style="font-size:12.5px;flex:1;min-width:200px">No connected mailbox — candidate emails need one before anything can be queued.</div>'+
        '<button class="btn btn-outline btn-sm" onclick="goPage(\'emailaccounts\')">Set up a mailbox</button>'+
      '</div>';
    }
    return '<div class="card cp mb3" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block"></span>'+
      '<div style="font-size:12.5px;flex:1;min-width:180px">'+fromLine(s)+
        (s.company_name?' · '+esc(s.company_name):'')+
        '<div style="font-size:11.5px;color:var(--text3)">'+
          (s.ai?'The role description is written once per job by the AI writer; each email is personalised from the match reasons.'
               :'No AI writer is configured, so the built-in writer does all of it — which costs nothing.')+
        '</div>'+
        // SAY IT BEFORE THEY QUEUE, NOT AFTER. Render the SERVER's sentence
        // verbatim (`window.sentence`) rather than assembling one around
        // `window.label` — the server states the whole claim (window on vs
        // off) so this screen and the queue can never disagree about it
        // (C-0011: the window shipped off by default, and the old copy here
        // kept promising a wait that no longer happens).
        (s.window?'<div style="font-size:11.5px;color:var(--text3);margin-top:3px">'+esc(s.window.sentence)+
          (s.window.enabled&&userHasRole(STATE.user,'admin')?' <button type="button" onclick="openSystemSettingsModal()" style="border:0;background:none;padding:0;font:inherit;color:var(--accent);text-decoration:underline;cursor:pointer">Change these hours</button>':'')+
        '</div>':'')+
      '</div>'+
    '</div>';
  }

  // One mailbox: say it. Several: let them pick. The list comes from the
  // server and holds only this person's own connected mailboxes.
  function fromLine(s){
    var list=s.mailboxes||[];
    var cur=S().mailboxId||(s.mailbox&&s.mailbox.id);
    if(list.length<2){
      return 'Sends as <strong>'+esc(s.mailbox.display_name||s.mailbox.email)+'</strong> &lt;'+esc(s.mailbox.email)+'&gt;';
    }
    return '<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;vertical-align:middle"><span>Sends from</span>'+
      '<select class="sel" style="width:auto;font-size:12.5px;padding:4px 28px 4px 8px;max-width:320px;margin:0" onchange="candOutreachSetMailbox(this.value)">'+
        list.map(function(m){
          return '<option value="'+esc(m.id)+'"'+(m.id===cur?' selected':'')+'>'+
            esc((m.display_name?m.display_name+' · ':'')+m.email)+'</option>';
        }).join('')+
      '</select></span>';
  }

  function stepBar(){
    var s=S();
    var one=function(n,label,on,click){
      return '<button type="button" '+(click?'onclick="'+click+'"':'disabled')+' style="'+
        'display:flex;align-items:center;gap:7px;border:0;background:transparent;padding:4px 2px;'+
        'font-family:inherit;font-size:12.5px;cursor:'+(click?'pointer':'default')+';'+
        'color:'+(on?'var(--accent)':'var(--text3)')+';font-weight:'+(on?'600':'500')+'">'+
        '<span style="width:20px;height:20px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;'+
          'font-size:11px;font-weight:700;background:'+(on?'var(--accent)':'var(--border)')+';color:'+(on?'#fff':'var(--text3)')+'">'+n+'</span>'+
        esc(label)+'</button>';
    };
    return '<div class="card cp mb3" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'+
      one(1,'Pick the job',s.step===1,s.step>1?'candOutreachBackTo(1)':null)+
      '<span style="color:var(--border)">→</span>'+
      one(2,'Pick the people',s.step===2,s.step>2?'candOutreachBackTo(2)':null)+
      '<span style="color:var(--border)">→</span>'+
      one(3,'Write and send',s.step===3,null)+
    '</div>';
  }

  function jobStep(){
    var s=S();
    if(s.jobs===null&&!s.jobsLoading) candOutreachLoadJobs();
    var rows=(s.jobs||[]).map(function(j){
      return '<div onclick="candOutreachPickJob(\''+j.id+'\')" style="padding:10px 12px;border-bottom:1px solid var(--border2);cursor:pointer" '+
        'onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'\'">'+
        '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">'+
          '<strong style="font-size:13px">'+esc(j.job_title)+'</strong>'+
          (j.client?'<span style="font-size:12px;color:var(--text2)">'+esc(j.client)+'</span>':'')+
          (j.status!=='Active'?'<span class="bdg" style="font-size:10px">'+esc(j.status)+'</span>':'')+
        '</div>'+
        '<div style="font-size:11.5px;color:var(--text3)">'+
          esc([j.place,j.job_code].filter(Boolean).join(' · ')||'no location on the order')+
          (j.has_brief?' · description written':'')+
        '</div>'+
      '</div>';
    }).join('');
    return '<div class="card cp">'+
      '<div class="fgrp"><label class="flbl">Which job are you recruiting for?</label>'+
        '<input class="inp" placeholder="Search by title, client or job code" value="'+esc(s.jobQuery)+'" oninput="candOutreachJobSearch(this.value)">'+
      '</div>'+
      (s.jobsLoading?'<div style="font-size:12px;color:var(--text3);padding:8px 2px">Loading…</div>':
        rows?'<div class="tbl-wrap" data-keep-scroll="co-jobs" style="border:1px solid var(--border2);border-radius:var(--r);max-height:340px;overflow:auto">'+rows+'</div>'
            :'<div style="font-size:12px;color:var(--text3);padding:8px 2px">No job orders match that.</div>')+
    '</div>';
  }

  function briefCard(){
    var s=S();
    if(!s.brief) return '';
    var text=[s.brief.hook,s.brief.detail].filter(Boolean).join(' ');
    var isAi=s.brief.engine==='ai';
    return '<div class="card cp mb3">'+
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">'+
        '<div style="font-size:12px;font-weight:600">How the role is described</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span class="bdg '+(isAi?'bdg-blue':'')+'" style="font-size:10px">'+(isAi?'written by AI':'built-in writer')+'</span>'+
          '<button class="btn btn-outline btn-sm" '+(s.briefLoading?'disabled':'')+' onclick="candOutreachWriteBrief()">'+
            (s.briefLoading?'Writing…':(isAi?'Rewrite':'Write it with AI'))+'</button>'+
        '</div>'+
      '</div>'+
      '<div style="font-size:12.5px;color:var(--text2);line-height:1.55">'+esc(text)+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:7px">'+
        'Written once for this job and reused in every email — so picking 30 people costs the same as picking one.'+
      '</div>'+
    '</div>';
  }

  function band(b){
    var c=b==='strong'?'var(--green)':b==='good'?'var(--accent)':b==='fair'?'var(--amber)':'var(--text3)';
    return '<span style="font-size:10.5px;font-weight:700;color:'+c+'">'+esc(b||'—')+'</span>';
  }

  // WHY SOMEBODY WAS SKIPPED, IN WORDS. The first live batch skipped three of
  // four people and said only "failed check" — the app knew exactly what was
  // wrong and would not say it. Each reason now gets a sentence, and a failed
  // check gets the checker's own instruction.
  var SKIP_TEXT={
    no_valid_email:'no email address on file',
    opted_out:'has opted out of our emails',
    already_asked:'already asked about this job',
    angle_not_applicable:'that wording does not apply to them'
  };
  function resultCard(){
    var s=S();
    if(!s.result) return '';
    var r=s.result, sk=(r.skipped||[]);
    var rows=sk.map(function(x){
      var why=x.reason==='failed_check'
        ? (x.detail||'the wording broke a house rule')
        : (SKIP_TEXT[x.reason]||String(x.reason||'').replace(/_/g,' '));
      return '<div style="padding:6px 0;border-top:1px solid var(--border2);font-size:11.5px;color:var(--text2)">'+
        '<strong>'+esc(x.name||x.candidate_id)+'</strong> — '+esc(why)+'</div>';
    }).join('');
    return '<div class="card cp mb3">'+
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap">'+
        '<div style="font-size:13px;font-weight:600">'+r.queued+' email'+(r.queued===1?'':'s')+' queued</div>'+
        '<button class="btn btn-outline btn-sm" onclick="candOutreachDismissResult()">Dismiss</button>'+
      '</div>'+
      (r.queued?'<div style="font-size:12px;color:var(--text2);margin-top:3px">Going out about one every 90 seconds from '+esc(r.mailbox)+
        ((s.sender&&s.sender.window&&s.sender.window.enabled)?', in each candidate\'s local free time ('+esc(s.sender.window.label)+')':', starting straight away')+
        ', under your daily cap.</div>':'')+
      (r.pipeline?'<div style="font-size:12px;color:var(--text2);margin-top:4px">Pipeline: '+r.pipeline.added+' added, '+r.pipeline.existing+' already there'+(r.pipeline.failed?', '+r.pipeline.failed+' failed':'')+'.</div>':'')+
      (sk.length?'<div style="margin-top:10px"><div style="font-size:12px;font-weight:600;color:var(--amber)">'+sk.length+' not sent</div>'+rows+'</div>':'')+
    '</div>';
  }
  window.candOutreachDismissResult=function(){ S().result=null; render(); };

  function poolStep(){
    var s=S();
    var p=s.pool;
    var picked=pickedIds().length;
    var rows=((p&&p.results)||[]).map(function(r){
      var on=!!s.picked[r.candidate_id];
      var blocked=!r.emailable||!!r.prior;
      var why=r.prior?('already asked'+(r.prior.response?' · '+r.prior.response.replace('_',' '):'')) :
              (!r.emailable?'no email address on file':'');
      return '<tr style="'+(blocked?'opacity:.55;':'')+'border-bottom:1px solid var(--border2)">'+
        '<td style="padding:8px 10px;width:34px">'+
          (blocked?'':'<input type="checkbox" '+(on?'checked':'')+' onchange="candOutreachToggle(\''+r.candidate_id+'\')">')+
        '</td>'+
        '<td style="padding:8px 10px">'+
          '<div style="font-size:12.5px;font-weight:600">'+esc(r.name||'(no name)')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+esc([r.title,r.location].filter(Boolean).join(' · '))+'</div>'+
          (why?'<div style="font-size:11px;color:var(--amber)">'+esc(why)+'</div>':'')+
        '</td>'+
        '<td style="padding:8px 10px;white-space:nowrap">'+
          '<div style="font-size:13px;font-weight:700">'+(r.score==null?'—':r.score)+'</div>'+band(r.band)+
        '</td>'+
        '<td style="padding:8px 10px;font-size:11.5px;color:var(--text3);line-height:1.5">'+
          esc((r.reasons||[]).slice(0,3).join(' · ')||'not enough on either side to score')+
        '</td>'+
      '</tr>';
    }).join('');

    return resultCard()+briefCard()+
    '<div class="card cp">'+
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
        '<input class="inp" style="flex:1;min-width:180px" placeholder="Narrow the pool by name, email or title" value="'+esc(s.poolQuery)+'" oninput="candOutreachPoolSearch(this.value)">'+
        '<button class="btn btn-outline btn-sm" onclick="candOutreachPickAll(true)">Select all available</button>'+
        (picked?'<button class="btn btn-outline btn-sm" onclick="candOutreachPickAll(false)">Clear</button>':'')+
      '</div>'+
      (p&&!p.scoreable
        ? '<div style="background:var(--amber-l);border-radius:var(--r);padding:8px 11px;font-size:11.5px;margin-bottom:10px">'+
          'This job order has no skills listed, so everyone is scored on title and location alone. Adding primary skills to the job will sharpen this list a lot.</div>'
        : '')+
      (s.poolLoading?'<div style="font-size:12px;color:var(--text3);padding:8px 2px">Ranking the pool…</div>':
        rows?'<div class="tbl-wrap" data-keep-scroll="co-pool" style="overflow:auto;max-height:420px;border:1px solid var(--border2);border-radius:var(--r)">'+
              '<table style="width:100%;border-collapse:collapse;min-width:560px">'+
              '<thead><tr style="background:var(--bg);position:sticky;top:0">'+
                '<th></th>'+
                '<th style="text-align:left;padding:7px 10px;font-size:11px;color:var(--text3);font-weight:600">Candidate</th>'+
                '<th style="text-align:left;padding:7px 10px;font-size:11px;color:var(--text3);font-weight:600">Fit</th>'+
                '<th style="text-align:left;padding:7px 10px;font-size:11px;color:var(--text3);font-weight:600">Why</th>'+
              '</tr></thead><tbody>'+rows+'</tbody></table></div>'
            :'<div style="font-size:12px;color:var(--text3);padding:8px 2px">Nobody in the database matches yet. Add candidates from Applicants, or use Sourcing.</div>')+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px">'+
        '<div style="font-size:12px;color:var(--text3)">'+
          (picked?('<strong style="color:var(--text)">'+picked+'</strong> picked'):'Nobody picked yet')+
          (p&&p.pool_size?(' · '+p.pool_size+' in the pool'):'')+
        '</div>'+
        '<button class="btn btn-primary btn-sm" '+(picked?'':'disabled')+' onclick="candOutreachToPreview()">Write the email →</button>'+
      '</div>'+
    '</div>';
  }

  function anglePicker(){
    var s=S();
    var vs=(s.preview&&s.preview.variants)||[];
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'+vs.map(function(v){
      var on=s.angle===v.id;
      return '<button type="button" onclick="candOutreachSetAngle(\''+v.id+'\')" title="'+esc(v.blurb)+'" style="'+
        'border:1px solid '+(on?'var(--accent)':'var(--border2)')+';'+
        'background:'+(on?'var(--accent-l)':'var(--card)')+';color:'+(on?'var(--accent)':'var(--text2)')+';'+
        'font-weight:'+(on?'600':'500')+';font-size:12.5px;border-radius:99px;padding:6px 13px;cursor:pointer;font-family:inherit">'+
        esc(v.label)+' <span style="opacity:.65">'+v.words+'w</span></button>';
    }).join('')+'</div>';
  }

  function sendStep(){
    var s=S();
    var ids=pickedIds();
    var v=((s.preview&&s.preview.variants)||[]).filter(function(x){return x.id===s.angle;})[0]
       || ((s.preview&&s.preview.variants)||[])[0];

    var body='';
    if(s.previewLoading){
      body='<div style="font-size:12px;color:var(--text3);padding:10px 2px">Building a preview…</div>';
    } else if(!v){
      body='<div style="font-size:12px;color:var(--text3);padding:10px 2px">No preview yet.</div>';
    } else {
      var warn=(v.quality&&!v.quality.ok)
        ? '<div style="background:var(--amber-l);border-radius:var(--r);padding:8px 11px;font-size:11.5px;margin-bottom:10px">'+
          '<strong>This wording breaks a house rule</strong> — '+esc((v.quality.violations||[]).map(function(x){return x.instruction;}).join(' '))+
          ' Anyone it would affect is skipped rather than sent.</div>'
        : '';
      // WALK THE PICKED LIST. Reading one email out of thirty and assuming the
      // rest are fine is how a bad merge field reaches twenty-nine people.
      var stepper='';
      if(ids.length>1){
        var nav=function(d,glyph,lbl){
          return '<button type="button" onclick="candOutreachPreviewStep('+d+')" title="'+lbl+'" '+
            'style="border:1px solid var(--border2);background:var(--card);color:var(--text2);'+
            'border-radius:7px;width:28px;height:28px;line-height:1;cursor:pointer;font-family:inherit;font-size:14px">'+glyph+'</button>';
        };
        stepper='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
          nav(-1,'‹','Previous candidate')+
          '<div style="font-size:12px;color:var(--text2)">'+
            '<strong>'+(s.previewIdx+1)+'</strong> of '+ids.length+
            '<span style="color:var(--text3)"> — each person’s own email</span>'+
          '</div>'+
          nav(1,'›','Next candidate')+
        '</div>';
      }
      body=stepper+anglePicker()+warn+
        '<div style="border:1px solid var(--border2);border-radius:var(--r);overflow:hidden">'+
          '<div style="padding:9px 12px;background:var(--bg);border-bottom:1px solid var(--border2);font-size:12.5px">'+
            '<span style="color:var(--text3)">Subject: </span><strong>'+esc(v.preview_subject||v.subject)+'</strong></div>'+
          '<div style="padding:12px;font-size:13px;line-height:1.6;white-space:pre-wrap">'+
            esc(v.preview_prose||v.preview_email||v.email)+'</div>'+
          // C-0019 / D-0012: the job description travels INSIDE the email as a
          // bordered panel, so the preview draws it as that panel and not as the
          // fenced text it is stored as. `block_html` is built by the server from
          // the same stored text the drain splits, with the same function — the
          // screen and the outbox cannot disagree about it, which is the whole
          // point (the preview-vs-queue defect of Session 21).
          //
          // Empty string when the job order has nothing to panel. A title-only
          // job order draws NO card, deliberately: an empty frame reads as a
          // broken system, and the subject line already said the title.
          //
          // It carries its own light palette because it is EMAIL markup — tables
          // and inline colours, the only thing Outlook renders reliably. So it
          // sits on an explicit white ground rather than the themed card, for
          // exactly the reason `.mb-body` stays `#fff`: this is a picture of
          // somebody else's document, not a surface of ours, and its ink cannot
          // be re-themed. Anything else puts #0F172A text on dark glass.
          (v.block_html
            ? '<div style="padding:0 12px 4px"><div style="background:#fff;border-radius:6px;padding:1px 10px">'+
              v.block_html+'</div></div>'
            : '')+
          // The buttons are part of the email, so they are part of the preview.
          // Approving an email you have not fully seen is the failure this
          // preview exists to prevent. The token in here is dead on purpose.
          (s.preview.buttons_html
            ? '<div style="padding:0 12px 4px">'+s.preview.buttons_html+
              '<div style="font-size:11px;color:var(--text3);margin-top:2px">One tap answers — it opens a confirmation page rather than recording straight from the link, so a mail scanner cannot answer on their behalf.</div></div>'
            : '')+
          (s.preview.signature_html
            ? '<div style="padding:0 12px 12px;border-top:1px dashed var(--border2);margin-top:4px;padding-top:10px">'+s.preview.signature_html+'</div>'
            : '')+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:7px">'+
          'Shown with <strong>'+esc((s.preview.candidate&&s.preview.candidate.name)||'this person')+'</strong>’s details filled in. '+
          'The name in the sign-off is resolved from the mailbox at the moment each one sends.'+
        '</div>';
    }

    return '<div class="card cp">'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">'+
        '<strong style="color:var(--text)">'+ids.length+'</strong> candidate'+(ids.length===1?'':'s')+
        (s.job?(' · '+esc(s.job.job_title)+(s.job.client?' · '+esc(s.job.client):'')):'')+
      '</div>'+
      body+
      '<label style="display:flex;align-items:flex-start;gap:8px;margin-top:14px;font-size:12.5px;cursor:pointer">'+
        '<input type="checkbox" '+(s.addToPipeline?'checked':'')+' onchange="candOutreachSetPipeline(this.checked)" style="margin-top:2px">'+
        '<span>Add these people to this job’s pipeline at <strong>Sourced</strong>'+
          '<div style="font-size:11px;color:var(--text3)">Off by default — emailing somebody is not the same as working them, and a board that fills with people who never answered stops being worth looking at.</div>'+
        '</span>'+
      '</label>'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px">'+
        '<button class="btn btn-outline btn-sm" onclick="candOutreachBackTo(2)">← Back to the list</button>'+
        '<button class="btn btn-primary btn-sm" '+((s.queuing||!ids.length)?'disabled':'')+' onclick="candOutreachQueue()">'+
          (s.queuing?'Queueing…':'Queue '+ids.length+' email'+(ids.length===1?'':'s'))+'</button>'+
      '</div>'+
    '</div>';
  }

  function queueCard(){
    var s=S();
    if(s.queue===null&&!s.queueLoading) candOutreachLoadQueue();
    var rows=(s.queue||[]).slice(0,25).map(function(r){
      var colour=r.status==='sent'?'var(--green)':r.status==='failed'?'#ef4444':r.status==='skipped'?'var(--text3)':'var(--amber)';
      // A DUE TIME THAT HAS PASSED LOOKS BROKEN. It usually is not — the drip
      // slot came round, the drain picked it up, and the CANDIDATE's local
      // working hours were shut, so it waits. The owner had to ask which of
      // those it was; the server now says, so show it instead of a stale
      // timestamp.
      var when=r.status==='pending'
        ? (r.wait&&r.wait.reason==='queued'
            ? 'due '+new Date(r.send_after).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'})
            : '')
        : (r.sent_at?new Date(r.sent_at).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}):'');
      var waitLine=(r.status==='pending'&&r.wait&&r.wait.reason!=='queued')
        ? '<div style="font-size:11px;color:'+(r.wait.reason==='paused'?'#ef4444':'var(--amber)')+'">'+esc(r.wait.text)+'</div>'
        : '';
      // READ WHAT THIS PERSON ACTUALLY GOT. The body has always been stored; it
      // simply had no way out of the database, so "what did we send them?" meant
      // opening the mailbox's Sent folder.
      var open=S().openQueue===r.id;
      var bodyPanel=open
        ? '<div style="padding:10px 12px;background:var(--bg);border-top:1px solid var(--border2)">'+
            '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">To '+esc(r.to_email||'')+
              (r.angle?' · '+esc(r.angle):'')+(r.engine?' · written by '+esc(r.engine):'')+'</div>'+
            '<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">'+esc(r.subject||'(no subject)')+'</div>'+
            (r.body
              ? '<div style="font-size:12.5px;line-height:1.6;white-space:pre-wrap">'+esc(r.body)+'</div>'
              : '<div style="font-size:12px;color:var(--text3)">The text of this one was not recorded.</div>')+
          '</div>'
        : '';
      return '<div style="border-bottom:1px solid var(--border2)">'+
        '<div style="display:flex;align-items:center;gap:10px;padding:8px 11px;cursor:pointer" '+
          'onclick="candOutreachToggleQueue(\''+r.id+'\')" title="Read the email this person got">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
            '<span style="color:var(--text3);font-weight:400">'+(open?'▾':'▸')+'</span> '+esc(r.name||r.to_email)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.subject||'')+'</div>'+
          (r.fail_reason?'<div style="font-size:11px;color:#ef4444">'+esc(r.fail_reason)+'</div>':'')+
          waitLine+
        '</div>'+
        '<div style="text-align:right;white-space:nowrap">'+
          '<div style="font-size:11px;font-weight:700;color:'+(r.response==='interested'?'var(--green)':r.response?'var(--text3)':colour)+'">'+
            (r.response==='interested'?'★ INTERESTED':r.response==='not_interested'?'not this one':r.response==='opted_out'?'opted out'
              :(r.status==='pending'&&r.wait&&r.wait.reason==='window')?'waiting'
              :(r.status==='pending'&&r.wait&&r.wait.reason==='due')?'sending soon'
              :esc(r.status))+
          '</div>'+
          '<div style="font-size:10.5px;color:var(--text3)">'+esc(when)+'</div>'+
        '</div>'+
        (r.status==='pending'?'<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();candOutreachCancel(\''+r.id+'\')">Cancel</button>':'')+
        '</div>'+
        bodyPanel+
      '</div>';
    }).join('');
    if(!rows) return '';
    return '<div class="card cp" style="margin-top:16px;padding:0;overflow:hidden">'+
      '<div style="padding:10px 12px;border-bottom:1px solid var(--border2);font-size:12px;font-weight:600">Your candidate outreach'+
        '<span style="font-weight:400;color:var(--text3)"> — click anyone to read the email they got</span></div>'+
      rows+
    '</div>';
  }

  // ── EMAIL → PENDING: candidate emails still waiting to go ──────────────────
  // The same rows and the same "why it has not gone yet" sentence the Compose
  // screen's list uses — one reader (GET /candidate-outreach/queue), two places
  // to see it. Read-only apart from Cancel, which already existed.
  window.candidatePendingCount=function(){
    var q=S().pendingQueue; return q?q.length:0;
  };
  function loadCandidatePending(){
    var s=S(); if(s.pendingLoading) return;
    s.pendingLoading=true;
    apiGet('/candidate-outreach/queue?status=pending').then(function(rows){
      s.pendingLoading=false; s.pendingQueue=rows||[]; s.pendingAt=Date.now(); render();
    }).catch(function(){ s.pendingLoading=false; s.pendingQueue=[]; s.pendingAt=Date.now(); render(); });
  }
  window.renderCandidatePendingPanel=function(isBD){
    var s=S();
    if(!s.pendingLoading&&(!s.pendingAt||Date.now()-s.pendingAt>60000)) loadCandidatePending();
    var rows=s.pendingQueue||[];
    if(!rows.length){
      if(isBD) return '';
      return '<div class="card cp" style="font-size:12.5px;color:var(--text3)">'+
        (s.pendingLoading&&!s.pendingQueue?'Checking your queue…':'Nothing waiting — every candidate email you queued has gone out.')+'</div>';
    }
    var fmt=function(d){ return new Date(d).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}); };
    var next=rows.slice().sort(function(a,b){return String(a.send_after).localeCompare(String(b.send_after));})[0];
    var list=rows.slice(0,50).map(function(r){
      var why=r.wait?r.wait.text:'';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--border2)">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.name||r.to_email)+
            ' <span style="font-weight:400;color:var(--text3)">'+esc(r.to_email||'')+'</span></div>'+
          '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.subject||'')+'</div>'+
          (why?'<div style="font-size:11px;color:var(--text2)">'+esc(why)+'</div>':'')+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3);white-space:nowrap">'+(r.send_after?'due '+esc(fmt(r.send_after)):'')+'</div>'+
        '<button class="btn btn-outline btn-sm" onclick="candOutreachCancel(\''+r.id+'\');S_pendingReload()">Cancel</button>'+
      '</div>';
    }).join('');
    return '<div class="card" style="padding:0;overflow:hidden;margin-bottom:14px">'+
      '<div style="padding:11px 12px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">'+
        '<div style="font-size:13px;font-weight:600">Candidate emails waiting to go ('+rows.length+')</div>'+
        '<div style="font-size:11.5px;color:var(--text3)">They go out one about every 90 seconds, so a batch does not look like a blast'+
          (next&&next.send_after?' · next '+esc(fmt(next.send_after)):'')+'</div>'+
      '</div>'+list+
    '</div>';
  };
  window.S_pendingReload=function(){ var s=S(); s.pendingAt=0; };
  // Fresh numbers every time the Pending tab is opened.
  var _setTab=window.setEmailTab;
  if(_setTab) window.setEmailTab=function(t){ if(t==='pending'){ var s=S(); s.pendingAt=0; } return _setTab.apply(this,arguments); };

  // The Email page calls this for the Candidates side of the Compose tab.
  window.renderCandidateOutreachBody=function(){
    var s=S();
    if(!s.sender&&!s.senderLoading) candOutreachLoadSender();
    return senderCard()+stepBar()+
      (s.step===1?jobStep():s.step===2?poolStep():sendStep())+
      queueCard();
  };
})();
