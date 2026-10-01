// ── MORNING BRIEFING — one sentence, above everything else ──────────────────
// GET /ai/morning-briefing always returns 200 with a non-empty `summary` — no
// "AI unavailable" state exists on the wire. The one thing this card must
// never do is disappear silently on a failed fetch (that is exactly what
// "Needs you today" used to do); a broken network still gets an honest
// sentence on screen, not a blank space where a sentence should be.
function loadMorningBriefing(force){
  if(STATE._briefLoading)return;
  if(STATE.briefing&&!force)return;
  STATE._briefLoading=true;
  apiGet('/ai/morning-briefing').then(function(r){
    STATE.briefing=r||{_error:true};
    STATE._briefLoading=false;
    scheduleRender();
  }).catch(function(){
    STATE.briefing={_error:true};
    STATE._briefLoading=false;
    scheduleRender();
  });
}
window.refreshMorningBriefing=function(){STATE.briefing=null;loadMorningBriefing(true);render();};

function renderMorningBriefingCard(){
  var b=STATE.briefing;
  if(b===undefined||b===null){
    return '<div class="briefing-card"><div class="briefing-ic">☀️</div>'+
      '<div class="briefing-body"><div class="briefing-text">Working out what came in today…</div></div></div>';
  }
  if(b._error){
    // Honest, not silent — this is the exact defect the owner watched happen
    // with "Needs you today". A broken fetch still says so, on screen.
    return '<div class="briefing-card is-error"><div class="briefing-ic">⚠️</div>'+
      '<div class="briefing-body">'+
        '<div class="briefing-text">Could not load this morning\'s summary.</div>'+
        '<div class="briefing-sub">The numbers below are still live — <a href="#" onclick="refreshMorningBriefing();return false;">try again</a>.</div>'+
      '</div></div>';
  }
  // degraded: the database itself could not be read — the one case the card
  // may hide, since there is nothing true left to say about "today".
  if(b.degraded)return '';
  return '<div class="briefing-card'+(b.quiet?' is-quiet':'')+'"><div class="briefing-ic">'+(b.quiet?'🌙':'☀️')+'</div>'+
    '<div class="briefing-body">'+
      '<div class="briefing-text">'+htmlEsc(b.summary||'')+'</div>'+
      (b.engine==='ai'?'<div class="briefing-sub">Written by AI from today\'s numbers</div>':'')+
    '</div></div>';
}

// ── NEXT ACTIONS — "what to do today", ranked, with the reason attached ──────
// Step 4. The app already knew a lead had replied six days ago and that a
// reminder had come due; none of it reached the user, so the work sat in tables
// while they guessed what to do next. This is the card that says it out loud.
//
// Every row carries WHY it is there. That is not decoration: a ranked list you
// cannot interrogate is just a different kind of guessing, and the user has to
// be able to disagree with it.
//
// Ranking and thread-reading live server-side (next-action.js /
// conversation-intel.js) so the browser only renders.
function loadNextActions(force){
  if(STATE._naLoading){
    // A forced read arrived while one is already in flight — a reminder was
    // just closed, say. That read may have been answered BEFORE the close, so
    // ignoring this request would put the closed row back on screen. Read again
    // once it lands (R-071); the flag is one bit, so a burst costs one re-read.
    if(force)STATE._naAgain=true;
    return;
  }
  if(STATE.nextActions&&!force)return;
  STATE._naLoading=true;
  apiGet('/next-actions').then(function(r){
    STATE._naLoading=false;
    if(STATE._naAgain){STATE._naAgain=false;loadNextActions(true);return;}
    STATE.nextActions=r||{items:[]};
    scheduleRender();
  }).catch(function(){
    STATE._naLoading=false;
    if(STATE._naAgain){STATE._naAgain=false;loadNextActions(true);return;}
    // Never let this blank a dashboard — it is an assistive card, not the page.
    STATE.nextActions={_error:true,items:[]};
    scheduleRender();
  });
}
// `quiet` re-reads WITHOUT blanking the card first. The Refresh button and
// "try again" want the "Working out…" state; a reminder that has just been
// closed does not — the row is already gone and the card should not flicker.
window.refreshNextActions=function(quiet){
  if(quiet!==true)STATE.nextActions=null;
  loadNextActions(true);
  render();
};

window.naDone=function(reminderId,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  apiPost('/next-actions/'+encodeURIComponent(reminderId)+'/done',{}).then(function(){
    showToast('Marked done','success');
    // Same step as every other close (dismissReminder, Compose → Send). This
    // used to re-read only THIS list, so the Reminders card on the same screen
    // kept "Due now · Send" for the row you had just finished (R-071).
    reminderClosed(reminderId);
  }).catch(function(e){showToast('Could not update: '+(e&&e.message||e),'error');});
};

// ── DOING THE TASK FROM THE ROW (R-073) ────────────────────────────────────
// Reads the row's item back the same way naSnooze does.
function naItemOf(btn){
  var row=btn&&btn.closest?btn.closest('[data-na-item]'):null;
  if(!row)return null;
  try{ return JSON.parse(decodeURIComponent(row.getAttribute('data-na-item'))); }catch(e){ return null; }
}
// What each row's button does, and why it is that path and not another:
//  * Reply (they wrote to us): their messages, in PACE's own mailbox, searched
//    down to that person — the reply is written where the conversation lives.
//  * Chase / Follow up on a lead's contact: the composer, already addressed
//    (outreachComposeTo — R-084), as a follow-up.
//  * Write on a reminder: the reminder's own composer when the page has the
//    reminder (its double-send guard and template stay in charge), else the same
//    addressed composer.
//  * A candidate's thread is answered in the mailbox too: the client composer is
//    the wrong writer for a candidate.
// Nothing is sent from here — every path opens something you read first.
window.naAct=function(btn,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  var it=naItemOf(btn); if(!it){showToast('Could not read that row','error');return;}
  if(!it.email){showToast('There is no email address on record for '+(it.title||'this person')+' yet','warning');return;}
  var isCand=it.entity_type==='candidate';
  if(it.kind==='reply_due'||isCand){
    STATE.mailbox=STATE.mailbox||{};STATE.mailbox.q=it.email;
    return goPage('mailbox');
  }
  if(it.kind==='reminder_due'&&it.reminder_id&&(STATE.reminders||[]).some(function(r){return r.id===it.reminder_id;})&&window.composeReminderEmail){
    return composeReminderEmail(it.reminder_id,it.entity_id);
  }
  if(!window.outreachComposeTo){showToast('The email screen is not loaded yet — try again in a moment','error');return;}
  outreachComposeTo({id:it.entity_type==='contact'?it.entity_id:null,name:it.title,email:it.email,
    company:it.subtitle||'',job_id:it.job_id||null,outreach_type:'followup'});
};
// "Replied — interested": moving them forward is the task. The stage is the
// person's choice (the queue only suggests, it never asserts which); the choice
// opens the ordinary stage window on that person's submission for that job.
function naMoveStageSelect(){
  var opts='<option value="">Move to…</option>'+(window.ATS_STAGE_LIST||[]).map(function(st){return '<option value="'+htmlEsc(st)+'">'+htmlEsc(st)+'</option>';}).join('');
  return '<select class="sel na-act na-act-do" aria-label="Move this candidate to a stage" onclick="event.stopPropagation()" onchange="naMoveStage(this,event)">'+opts+'</select>';
}
window.naMoveStage=function(sel,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  var it=naItemOf(sel),stage=sel.value; sel.value='';
  if(!it||!stage)return;
  if(!it.job_id||!window.stageSubmissionFor){showToast('Open the candidate to move them','warning');return;}
  window.stageSubmissionFor(it.entity_id,it.job_id).then(function(row){
    if(!row){showToast('They are not on that job with a stage yet — open the candidate to add them','warning');return;}
    var people={};people[row.id]={name:it.title,stage:row.stage,sub_stage:row.sub_stage||null,cid:it.entity_id};
    openStageModal(row.id,stage,function(){refreshNextActions(true);},{people:people,jobId:it.job_id,jobTitle:it.subtitle||''});
  }).catch(function(e){showToast('Could not look up their job: '+((e&&e.message)||e),'error');});
};

// Snooze one item. Reads the item off the row (see the payload note above),
// so the request carries the exact fact being dismissed and the server can
// fingerprint it.
window.naSnooze=function(btn,scope,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  var row=btn&&btn.closest?btn.closest('[data-na-item]'):null;
  if(!row){showToast('Could not read that row','error');return;}
  var item;
  try{ item=JSON.parse(decodeURIComponent(row.getAttribute('data-na-item'))); }
  catch(e){ showToast('Could not read that row','error'); return; }
  // Hide it immediately — the row is going away and waiting on a round trip to
  // do it makes the button feel broken. A failure puts it back and says so.
  row.style.display='none';
  apiPost('/next-actions/dismiss',{item:item,scope:scope}).then(function(){
    showToast(scope==='drop'?'Dropped — comes back if they reply'
      :scope==='week'?'Hidden for a week':'Hidden until tomorrow','success');
    STATE.nextActions=null;loadNextActions(true);
  }).catch(function(e){
    row.style.display='';
    showToast('Could not hide that: '+(e&&e.message||e),'error');
  });
};

// The checkbox: "this is completed" (R-098, D-0066). A reminder is marked DONE (a real change on a real
// record). Anything else is the fingerprinted snooze that returns only if they write again — never a
// delete (services/next-action-dismissals.js). On failure the box un-ticks and says so.
window.naComplete=function(chk,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  var item=naItemOf(chk);
  if(!item){ chk.checked=false; return; }
  var row=chk.closest?chk.closest('[data-na-item]'):null;
  chk.disabled=true; if(row)row.style.opacity='.45';
  var undo=function(e){
    chk.checked=false; chk.disabled=false; if(row)row.style.opacity='';
    showToast('Could not mark that completed: '+((e&&e.message)||e),'error');
  };
  if(item.reminder_id){
    apiPost('/next-actions/'+encodeURIComponent(item.reminder_id)+'/done',{}).then(function(){
      showToast('Marked completed','success'); reminderClosed(item.reminder_id);
    }).catch(undo);
    return;
  }
  apiPost('/next-actions/dismiss',{item:item,scope:'drop'}).then(function(){
    showToast('Marked completed — it comes back only if they reply','success');
    STATE.nextActions=null; loadNextActions(true);
  }).catch(undo);
};

window.naOpen=function(kind,entityType,entityId,jobId){
  // Jump to the thing the action is about. Leads live behind the job, so a
  // contact action opens its job — that is where the reply is answered.
  if(entityType==='contact'&&jobId&&typeof openJob==='function')return openJob(jobId);
  if(entityType==='candidate'&&typeof bdOpenCandidate==='function')return bdOpenCandidate(entityId);
  if(jobId&&typeof openJob==='function')return openJob(jobId);
  goPage('leads');
};

// Every kind next-action.js can emit has a label HERE. `stage_suggested` (a
// candidate's reply that reads as interest — "worth moving them forward?") had
// none, so it fell through to `nudge` and drew "No reply yet" over a candidate
// who HAD replied, and the count chips left it out entirely (Session 34).
var NA_KIND={
  reply_due:       {lbl:'Reply due',           bg:'#fee2e2', fg:'#b91c1c'},
  commitment_due:  {lbl:'They promised',       bg:'#fef3c7', fg:'#92400e'},
  reminder_due:    {lbl:'Reminder',            bg:'#e0e7ff', fg:'#3730a3'},
  nudge:           {lbl:'No reply yet',        bg:'#f1f5f9', fg:'#475569'},
  stage_suggested: {lbl:'Replied — interested',bg:'#dcfce7', fg:'#166534'}
};
// A kind this file does not know says so neutrally. The old fallback was `nudge`,
// which asserts something specific and false about every kind added later.
var NA_KIND_UNKNOWN={lbl:'Needs a look',bg:'#f1f5f9',fg:'#475569'};

// ── TODAY MEANS THE USER'S OWN DAY (R-097, D-0065) ───────────────────────────
// "Needs you today" listed everything outstanding, which is the noise the owner
// described: "the Need you today should show the things for that day, not the
// full thing". An item belongs to today when its date — the day a reminder or
// promise falls due, else the day of the latest message — is today ON THE
// VIEWER'S OWN CLOCK (their device, not the server's UTC). Everything older is
// not deleted and not hidden silently: it is counted under the list with a
// button that shows it. An item with no readable date is kept in today's list —
// never hide what cannot be dated.
function naDayKey(v){
  if(!v)return null;
  var str=String(v);
  if(/^\d{4}-\d{2}-\d{2}$/.test(str))return str;            // a date, not a moment: take it as written
  var d=new Date(str);
  if(isNaN(d.getTime()))return null;
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
window.naSplitToday=function(items,now){
  var t=naLocalIso(now);
  var today=[],older=[];
  (items||[]).forEach(function(it){
    var k=naDayKey(it.due_at||it.last_activity_at);
    (k&&t&&k<t?older:today).push(it);
  });
  return {today:today,older:older};
};
function naLocalIso(now){
  var d=new Date(now||Date.now());
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function naOlderLine(n){
  if(!n)return '';
  return '<div class="na-hidden">'+
    '<span>'+(STATE.naShowOlder?n+' older item'+(n===1?'':'s')+' shown below, from before today':n+' older item'+(n===1?'':'s')+' still open, from before today')+'</span>'+
    '<button class="na-act na-act-quiet" onclick="STATE.naShowOlder='+(STATE.naShowOlder?'false':'true')+';render()" title="Nothing is deleted — older items just stay out of today\'s list">'+(STATE.naShowOlder?'Hide older':'Show older')+'</button>'+
  '</div>';
}

function renderNextActionsCard(){
  var s=STATE.nextActions;
  // Per-user queue: never fetched while previewing someone else's dashboard
  // ("view as"), so it can never resolve on its own here (C-0009). A loading
  // state with nothing that can end it is the same defect C-0008 fixed for
  // the briefing card — say plainly this queue is not shown, not "working
  // out…" forever.
  var isViewingOther=STATE.viewingUser&&STATE.viewingUser.id!==STATE.user.id;
  if(isViewingOther&&s===undefined){
    return '<div class="card cp mb4" style="color:var(--text3);font-size:13px">'+
      'This is a personal to-do queue — not shown while previewing someone else\'s dashboard.</div>';
  }
  if(s===undefined||s===null){
    return '<div class="card cp mb4" style="color:var(--text3);font-size:13px">Working out what needs you…</div>';
  }
  if(s._error){
    // Honest, not silent — same rule as the briefing card (C-0009): a failed
    // fetch must say so on screen, never vanish and leave a blank space.
    return '<div class="briefing-card is-error mb4"><div class="briefing-ic">⚠️</div>'+
      '<div class="briefing-body">'+
        '<div class="briefing-text">Could not load what needs you today.</div>'+
        '<div class="briefing-sub"><a href="#" onclick="refreshNextActions();return false;">try again</a></div>'+
      '</div></div>';
  }
  var split=naSplitToday(s.items||[]);
  var olderCount=split.older.length;
  var items=STATE.naShowOlder?(s.items||[]):split.today;
  if(!items.length){
    // An EMPTY list still draws the two lines beneath it (C-0031, R-071).
    // /next-actions is now each person's OWN work — admin included — and what
    // sits beneath them arrives only as the `team` count behind "Review". This
    // branch used to return before either line, so an admin who owns nothing on
    // the list (the owner) saw "Nothing waiting on you." with no count and no
    // way into the review: the BD Lead's open reminders vanished from their
    // Dashboard. The same hole hid a manager's team count whenever their own
    // list happened to be empty.
    return '<div class="card mb4" style="padding:0;overflow:hidden">'+
      '<div class="cp" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
        '<span style="width:9px;height:9px;border-radius:50%;background:var(--green);display:inline-block"></span>'+
        '<div style="font-size:13.5px;font-weight:600">'+(olderCount?'Nothing new for today.':'Nothing waiting on you.')+'</div>'+
        '<div style="font-size:12px;color:var(--text3)">'+(olderCount?'Nothing arrived or came due today.':'No unanswered replies or due reminders.')+'</div>'+
      '</div>'+
      naOlderLine(olderCount)+
      naTeamLine(s)+
      naHiddenLine(s)+
    '</div>';
  }

  var NA_TOP=3;   // the top three by priority, then "See all" (D-0066)
  var show=STATE.naExpanded?items:items.slice(0,NA_TOP);
  var rows=show.map(function(it){
    var k=NA_KIND[it.kind]||NA_KIND_UNKNOWN;
    // ── EVERY ROW HAS AN EXIT (Session 23) ──────────────────────────────────
    // Only reminders used to have a Done button, so reply_due, commitment_due,
    // nudge and stage_suggested could not be dismissed AT ALL — which is how a
    // lead last contacted 91 days ago sat here under a heading reading
    // "today", with no way to remove it. That is what the owner reported as
    // "the memory does not get cleared after an activity is finished".
    //
    // A reminder gets DONE — a real state change on a real record.
    // Everything else gets SNOOZE — see services/next-action-dismissals.js for
    // why it is a fingerprinted snooze and not a delete: a queue you can empty
    // with a click tells you nothing, so the snooze is void the moment a new
    // message lands on the thread.
    // R-073 (owner: "no option to do the task … just information is mentioned"):
    // the row itself does the work — see naAct below for what each does.
    var doLbl={reply_due:'Reply',commitment_due:'Chase',nudge:'Follow up',reminder_due:'Write'}[it.kind]||'';
    var doAct=doLbl?'<button class="na-act na-act-do" onclick="naAct(this,event)" title="'+({reply_due:'Open their messages so you can answer',commitment_due:'Write to them about what they promised',nudge:'Write a follow-up',reminder_due:'Write the email this reminder is for'}[it.kind])+'">'+doLbl+'</button>'
      :(it.kind==='stage_suggested'?naMoveStageSelect():'');
    var acts=doAct+(it.reminder_id
      ?'<button class="na-act" onclick="naDone(\''+it.reminder_id+'\',event)" title="Mark this reminder done">Done</button>'
      :'<button class="na-act" onclick="naSnooze(this,\'today\',event)" title="Hide until tomorrow. Comes back if they reply.">Not today</button>'+
       '<button class="na-act na-act-quiet" onclick="naSnooze(this,\'week\',event)" title="Hide for a week. Comes back if they reply.">1w</button>'+
       '<button class="na-act na-act-quiet" onclick="naSnooze(this,\'drop\',event)" title="Stop asking about this. Still comes back if they reply.">Drop</button>');
    // The whole item rides on the row as data. naSnooze() reads it back rather
    // than being handed a dozen positional arguments through an onclick string,
    // where a quote in a company name would break the attribute.
    var payload=encodeURIComponent(JSON.stringify({
      kind:it.kind, entity_type:it.entity_type, entity_id:it.entity_id,
      job_id:it.job_id||null, reminder_id:it.reminder_id||null,
      last_activity_at:it.last_activity_at||null,
      overdue_days:(it.overdue_days===undefined?null:it.overdue_days),
      state:it.state||null, title:it.title||'',
      email:it.email||null, subtitle:it.subtitle||null
    }));
    return '<div data-na-item="'+payload+'" '+
      'onclick="naOpen(\''+it.kind+'\',\''+it.entity_type+'\',\''+it.entity_id+'\','+(it.job_id?'\''+it.job_id+'\'':'null')+')" '+
      'style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--border);cursor:pointer">'+
      '<label class="cd-tick" onclick="event.stopPropagation()" title="Completed'+(it.reminder_id?'':' — hides this until they reply')+'"><input type="checkbox" onclick="naComplete(this,event)" aria-label="Mark completed"></label>'+
      '<span style="flex:none;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:7px;background:'+k.bg+';color:'+k.fg+'">'+k.lbl+'</span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:600">'+htmlEsc(it.title||'')+
          (it.subtitle?' <span style="font-weight:400;color:var(--text3)">· '+htmlEsc(it.subtitle)+'</span>':'')+'</div>'+
        '<div style="font-size:12px;color:var(--text3)">'+htmlEsc(it.reason||'')+'</div>'+
      '</div>'+
      '<div class="na-acts">'+acts+'</div>'+
      '<div style="color:var(--text3);font-size:18px">›</div>'+
    '</div>';
  }).join('');

  var bk={};
  items.forEach(function(i){bk[i.kind]=(bk[i.kind]||0)+1;});
  function chip(n,label,color){
    if(!n)return '';
    return '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;background:var(--bg);border:1px solid var(--border);color:'+color+'">'+n+' '+label+'</span>';
  }

  return '<div class="card cp mb4" style="padding:0;overflow:hidden">'+
    '<div style="padding:13px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:200px">'+
        '<div style="font-weight:700;font-size:14px">Needs you today</div>'+
        '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">'+
          chip(bk.reply_due,'to reply','#b91c1c')+
          chip(bk.commitment_due,'promised','#92400e')+
          chip(bk.reminder_due,bk.reminder_due===1?'reminder':'reminders','#3730a3')+
          chip(bk.nudge,'to chase','#475569')+
          chip(bk.stage_suggested,'interested','#166534')+
        '</div>'+
      '</div>'+
      '<button onclick="refreshNextActions()" style="padding:6px 12px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:12.5px;color:var(--text2);cursor:pointer">Refresh</button>'+
      (items.length>NA_TOP?'<button onclick="STATE.naExpanded='+(STATE.naExpanded?'false':'true')+';render()" style="padding:6px 12px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:12.5px;color:var(--text2);cursor:pointer">'+(STATE.naExpanded?'Show the top '+NA_TOP:'See all '+items.length)+'</button>':'')+
    '</div>'+
    rows+
    naOlderLine(olderCount)+
    naTeamLine(s)+
    naHiddenLine(s)+
  '</div>';
}

// ── WHAT IS OPEN BENEATH YOU (Session 24, D-0020) ───────────────────────────
// A manager's daily list is their OWN work. Their team's open items are a COUNT
// with a way in, never rows mixed into the same list — the owner's decision,
// and the reason the list above can be trusted as a to-do list again.
//
// The review screen behind this is where they can PROMPT the owner. They cannot
// close somebody else's task: that used to be offered as a Done button which
// reported success and changed nothing.
function naTeamLine(s){
  var t=s&&s.team;
  if(!t||!t.total)return '';
  return '<div class="na-hidden">'+
    '<span title="'+escAttr(t.sentence||'')+'">'+htmlEsc(t.label||'')+'</span>'+
    '<button class="na-act na-act-quiet" onclick="naOpenTeam()" title="See what your team has open, and ask someone to pick one up">Review</button>'+
  '</div>';
}

// The review list. A drawer over the dashboard, so closing it returns the
// manager to exactly where they were (the app's standing rule for record
// detail — STATE.page is never touched).
window.naOpenTeam=function(){
  STATE.naTeam={loading:true,items:[]};
  render();
  apiGet('/next-actions/team').then(function(d){
    STATE.naTeam={loading:false,items:(d&&d.items)||[],total:(d&&d.total)||0,people:(d&&d.people)||[]};
    render();
  }).catch(function(e){
    STATE.naTeam={loading:false,error:(e&&e.message)||'Could not load your team\'s open work',items:[]};
    render();
  });
};
window.naCloseTeam=function(){ STATE.naTeam=null;render(); };

// Ask the OWNER to pick one up. This writes a dated note onto THEIR list naming
// who asked — it does not touch the task, and it never closes it.
window.naPrompt=function(id,btn){
  if(btn){btn.disabled=true;btn.textContent='Asking…';}
  apiPost('/next-actions/'+encodeURIComponent(id)+'/prompt',{}).then(function(){
    showToast('Asked them to pick it up — it is on their list now','success');
    if(btn){btn.textContent='Asked';}
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='Ask them';}
    showToast('Could not ask: '+((e&&e.message)||e),'error');
  });
};

function renderTeamReview(){
  var t=STATE.naTeam;if(!t)return '';
  var body;
  if(t.loading)body='<div class="na-team-empty">Loading…</div>';
  else if(t.error)body='<div class="na-team-empty">'+htmlEsc(t.error)+'</div>';
  else if(!t.items.length)body='<div class="na-team-empty">Nothing open across your team right now.</div>';
  else body=t.items.map(function(i){
    return '<div class="na-team-row">'+
      '<div class="na-team-main">'+
        '<div class="na-team-t">'+htmlEsc(i.title||'')+
          (i.subtitle?' <span class="na-team-sub">· '+htmlEsc(i.subtitle)+'</span>':'')+'</div>'+
        // Whose it is, said plainly. The whole complaint was a list that did
        // not say this.
        '<div class="na-team-who">'+htmlEsc(i.owner_name||'Someone')+
          (i.due?' · due '+htmlEsc(String(i.due).slice(0,10)):'')+'</div>'+
        (i.note?'<div class="na-team-note">'+htmlEsc(i.note)+'</div>':'')+
      '</div>'+
      '<button class="na-act" onclick="naPrompt(\''+i.id+'\',this)" title="Put this on their list with your name on it">Ask them</button>'+
    '</div>';
  }).join('');

  return '<div class="overlay" onclick="naCloseTeam()">'+
    '<div class="modal na-team" onclick="event.stopPropagation()">'+
      '<div class="na-team-h">'+
        '<div><div class="na-team-title">Open across your team</div>'+
          '<div class="na-team-hint">You can ask the owner to pick something up. Closing it is theirs to do.</div></div>'+
        '<button class="btn btn-outline btn-sm" onclick="naCloseTeam()">Close</button>'+
      '</div>'+
      '<div class="na-team-body">'+body+'</div>'+
    '</div>'+
  '</div>';
}
UI.registerOverlay('naTeam',function(){ return STATE.naTeam?renderTeamReview():''; });

// WHAT IS NOT ON THIS LIST, AND WHY (Session 23).
// The queue now holds things back — snoozed items, silences older than the
// nudge age limit, anything past the display limit. A list that filters itself
// and does not admit it is a lie the user cannot see, and it is exactly how
// "Needs you today" came to be trusted less than it deserved. So the counts
// are stated, and the stale ones are offered as ONE decision (chase or drop)
// rather than ninety identical mornings.
function naHiddenLine(s){
  var bits=[];
  if(s.stale_nudges)bits.push(s.stale_nudges+' gone quiet over '+(s.nudge_max_age_days||45)+' days');
  if(s.snoozed)bits.push(s.snoozed+' hidden by you');
  if(s.overflow)bits.push(s.overflow+' more');
  if(!bits.length)return '';
  return '<div class="na-hidden">'+
    '<span>'+bits.join(' · ')+'</span>'+
    (s.stale_nudges?'<button class="na-act na-act-quiet" onclick="goPage(\'leads\')" title="Review the quiet leads on the Leads page">Review quiet leads</button>':'')+
  '</div>';
}
