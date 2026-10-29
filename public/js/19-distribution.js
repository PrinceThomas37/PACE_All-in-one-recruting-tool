// ════════════════════════════════════════════════
// DISTRIBUTION ACTIONS — Drop N
// ════════════════════════════════════════════════

function refreshPoolStats(){
  return apiGet('/distribute/pool-stats').then(function(d){
    STATE.distributePoolStats=d;render();
  }).catch(function(){});
}
// The pool's numbers keep themselves current while Assign Leads is open (owner, 29 Oct: "after assignment the number does
// not change on a live basis — it changes when the refresh button is clicked"). Every 20 seconds, only on this page and
// only while the tab is on screen; it stops by itself when the person leaves.
function startAssignPoolPoll(){
  if(STATE._assignPoolTimer)return;
  STATE._assignPoolTimer=setInterval(function(){
    if(STATE.page!=='assign'||!STATE.token){ clearInterval(STATE._assignPoolTimer); STATE._assignPoolTimer=null; return; }
    if(document.hidden||STATE.modal)return;   // never repaint under an open window
    refreshPoolStats();
  },20000);
}

window.updateAssignCountPreview=function(){
  // If manual count is set, regenerate the ratio with that count
  var el=document.getElementById('assign-manual-count');
  if(el&&el.value){
    clearTimeout(window._assignCountDebounce);
    window._assignCountDebounce=setTimeout(function(){generateAutoRatio();},400);
  }
};

window.openAssignToManager=function(managerId){
  var m=STATE.users.find(function(u){return u.id===managerId;})||{name:'Manager'};
  // Use API pool stats if loaded, fallback to counting directly from STATE.jobs
  var _unassignedJobs=STATE.jobs.filter(function(j){return j.stage==='Unassigned'&&!j.assigned_to_bd;});
  var pool=STATE.distributePoolStats&&STATE.distributePoolStats.total>0
    ?STATE.distributePoolStats
    :{total:_unassignedJobs.length,by_industry:{},by_timezone:{},duplicates:_unassignedJobs.filter(function(j){return j.is_duplicate;}).length};
  var emailAccounts=(STATE.userEmailsCache[managerId]||[]).filter(function(a){return a.is_active;});
  var capacity=emailAccounts.reduce(function(s,a){return s+(a.daily_send_limit||300);},0);
  STATE._assignManagerId=managerId;
  STATE._assignRatio=null;
  STATE._assignGenerating=false;

  STATE.modal='<div class="modal modal-w860">'+
    '<div class="mh">'+
      '<div><div class="mt">Assign leads \u2014 '+htmlEsc(m.name)+'</div>'+
        '<div class="fs-12 c-text3" style="margin-top:3px">'+pool.total+' unassigned leads \u00b7 '+capacity+' email capacity today</div>'+
        (pool.without_people?'<div class="fs-12 c-amber" style="margin-top:6px;line-height:1.5">\u26a0 '+pool.without_people+' of these '+(pool.without_people===1?'has':'have')+' no contact person with an email, so no email can be written \u2014 they will NOT be assigned and stay in the pool. Add the people first.</div>':'')+
      '</div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button>'+
    '</div>'+
    '<div class="mb_">'+
      // Manual count override
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border-radius:var(--r2);margin-bottom:14px;border:1px solid var(--border)">'+
        '<div style="flex:1">'+
          '<div class="fs-12 c-text2" style="font-weight:600;margin-bottom:2px">Number of leads to assign</div>'+
          '<div class="fs-11 c-text3">Leave blank to let AI decide based on capacity ('+capacity+' max)</div>'+
        '</div>'+
        '<input type="number" id="assign-manual-count" min="1" max="'+pool.total+'" placeholder="Auto" class="fs-14" style="width:80px;padding:8px 10px;border:1px solid var(--border2);border-radius:8px;font-weight:600;text-align:center;font-family:inherit" oninput="updateAssignCountPreview()"/>'+
        '<span class="fs-12 c-text3">/ '+pool.total+'</span>'+
      '</div>'+
      // Which email IDs these leads go out from, and how busy each one already is today (owner, 29 Oct).
      '<div id="assign-boxes" class="mb3"><div class="fs-12 c-text3">Loading the email IDs…</div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
        '<div onclick="setAssignMode(\'auto\')" id="mode-auto" style="padding:14px;border:2px solid var(--accent);border-radius:var(--r2);cursor:pointer;background:var(--accent-l);text-align:center">'+
          '<div class="fs-18" style="margin-bottom:4px">\u26a1</div>'+
          '<div class="fs-13 c-accent" style="font-weight:600">Auto</div>'+
          '<div class="fs-11 c-text3" style="margin-top:3px">System picks balanced ratio</div>'+
        '</div>'+
        '<div onclick="setAssignMode(\'text\')" id="mode-text" style="padding:14px;border:2px solid var(--border);border-radius:var(--r2);cursor:pointer;text-align:center">'+
          '<div class="fs-18" style="margin-bottom:4px">\u270f\ufe0f</div>'+
          '<div class="fs-13" style="font-weight:600">Priority text</div>'+
          '<div class="fs-11 c-text3" style="margin-top:3px">Tell AI what to prioritise</div>'+
        '</div>'+
      '</div>'+
      '<div id="assign-text-panel" style="display:none;margin-bottom:12px">'+
        '<label class="fs-12 c-text2" style="font-weight:600;display:block;margin-bottom:6px">Describe your priorities</label>'+
        '<textarea id="assign-priority-text" class="fs-13" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;min-height:80px;resize:vertical;font-family:inherit" placeholder="e.g. Focus on old leads first, prioritise healthcare and legal, send mostly to EST timezone, exclude duplicates..."></textarea>'+
        '<button onclick="generateAssignRatio()" class="fs-12" style="margin-top:8px;background:var(--purple);color:#fff;border:0;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer" id="gen-ratio-btn">\u2728 Generate ratio with AI</button>'+
      '</div>'+
      '<div id="assign-ratio-preview" style="display:none"></div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" id="assign-confirm-btn" onclick="confirmAssignToManager()" disabled style="opacity:.5;cursor:not-allowed">Preview assignment</button>'+
    '</div>'+
  '</div>';
  render();
  STATE._assignEmailIds=null; STATE._assignBoxes=null;
  loadAssignBoxes(managerId);
  // Auto mode selected by default — trigger auto ratio generation
  setTimeout(function(){generateAutoRatio();},100);
};

// THE EMAIL IDS TO SEND FROM (owner, 29 Oct: "select the email IDs … see how many pending emails are there which will go out
// that day … then choose the email IDs with less in the queue"). Each row: what it can still send today, what is already
// queued on it (first outreach / FU1 / FU2), follow-ups that fall due today but are not queued yet, and what is left free.
// Ticked at the start: every connected one with room today. The choice goes to the server with the assignment.
function loadAssignBoxes(managerId){
  apiGet('/distribute/mailboxes?manager_id='+encodeURIComponent(managerId)).then(function(d){
    if(STATE._assignManagerId!==managerId)return;
    STATE._assignBoxes=(d&&d.mailboxes)||[];
    STATE._assignEmailIds=STATE._assignBoxes.filter(function(b){return b.connected&&b.room_today>0;}).map(function(b){return b.id;});
    paintAssignBoxes();
  }).catch(function(e){ var el=document.getElementById('assign-boxes'); if(el) el.innerHTML='<div class="fs-12 c-red">Could not load the email IDs: '+htmlEsc((e&&e.message)||'')+'</div>'; });
}
function paintAssignBoxes(){
  var el=document.getElementById('assign-boxes'); if(!el)return;
  var boxes=STATE._assignBoxes||[], on=STATE._assignEmailIds||[];
  if(!boxes.length){ el.innerHTML='<div class="fs-12 c-red">This manager has no active email IDs.</div>'; return; }
  var q=function(b){ var x=b.queued||{}; return (x.pending||0)?(x.initial||0)+' first · '+(x.fu1||0)+' FU1 · '+(x.fu2||0)+' FU2'+(x.later?' · '+x.later+' later':''):'—'; };
  var due=function(b){ var x=b.due_today_not_queued||{}; var n=(x.fu1||0)+(x.fu2||0)+(x.later||0); return n?(x.fu1||0)+' FU1 · '+(x.fu2||0)+' FU2'+(x.later?' · '+x.later+' later':''):'—'; };
  el.innerHTML='<div class="fs-12 c-text2 fw6" style="margin-bottom:6px">Send from these email IDs</div>'+
    '<div class="td-scroll"><table class="td-table fs-12"><thead><tr><th></th><th>Email ID</th><th>Room today</th><th>Queued</th><th>Due today, not queued</th><th>Free</th></tr></thead><tbody>'+
    boxes.map(function(b){
      var usable=b.connected&&b.room_today>0;
      return '<tr'+(usable?'':' class="c-text3"')+'><td><input type="checkbox" aria-label="Send from '+htmlEsc(b.email)+'" '+(on.indexOf(b.id)>=0?'checked ':'')+(usable?'':'disabled ')+'onchange="toggleAssignBox(\''+b.id+'\',this.checked)"></td>'+
        '<td class="fw6">'+htmlEsc(b.email)+(b.connected?'':' <span class="c-red">· not connected</span>')+'</td>'+
        '<td>'+b.room_today+' of '+b.limit+'</td><td>'+q(b)+'</td><td>'+due(b)+'</td><td class="fw6">'+b.free_today+'</td></tr>';
    }).join('')+'</tbody></table></div>'+
    '<div class="fs-11 c-text3" style="margin-top:4px">Free = room today minus what is queued and the follow-ups that fall due today. New leads are shared among the ticked ones by the room each has.</div>';
}
window.toggleAssignBox=function(id,on){
  var cur=(STATE._assignEmailIds||[]).filter(function(x){return x!==id;});
  if(on) cur.push(id);
  STATE._assignEmailIds=cur;
};

window.setAssignMode=function(mode){
  var autoEl=document.getElementById('mode-auto');
  var textEl=document.getElementById('mode-text');
  var textPanel=document.getElementById('assign-text-panel');
  if(!autoEl||!textEl)return;
  if(mode==='auto'){
    autoEl.style.border='2px solid var(--accent)';autoEl.style.background='var(--accent-l)';
    textEl.style.border='2px solid var(--border)';textEl.style.background='';
    if(textPanel)textPanel.style.display='none';
    generateAutoRatio();
  } else {
    textEl.style.border='2px solid var(--accent)';textEl.style.background='var(--accent-l)';
    autoEl.style.border='2px solid var(--border)';autoEl.style.background='';
    if(textPanel)textPanel.style.display='block';
    STATE._assignRatio=null;
    var btn=document.getElementById('assign-confirm-btn');
    if(btn){btn.disabled=true;btn.style.opacity='.5';btn.style.cursor='not-allowed';}
    var prev=document.getElementById('assign-ratio-preview');
    if(prev)prev.style.display='none';
  }
};

// A share is shown as a whole percent (the split is stored exact — 19 of 43 is 44.1860465116279 — and that is never what a
// person should read). Something real but under half a percent says "<1" rather than a misleading 0.
function ratioPct(v){ var n=Number(v); if(!isFinite(n)) return '0'; if(n>0&&n<0.5) return '&lt;1'; return String(Math.round(n)); }
window.ratioPct=ratioPct;

function showRatioPreview(ratio){
  STATE._assignRatio=ratio;
  var prev=document.getElementById('assign-ratio-preview');
  var btn=document.getElementById('assign-confirm-btn');
  if(!prev)return;
  var bf=ratio.by_freshness||{};
  var bi=ratio.by_industry||{};
  var btz=ratio.by_timezone||{};
  prev.style.display='block';
  // An instruction the rules engine cannot follow must be reported, not
  // swallowed: an even split shown under "AI" reads as the AI disagreeing with
  // you, when in fact nothing read your sentence.
  var ignoredPriorities=(ratio.engine!=='ai')&&!!(STATE._assignPriorityText||'').trim();
  // …and "it answered, but not with anything usable" is a THIRD thing, which
  // used to be reported as the first. Saying "no AI provider answered" while
  // the daily meter shows the tokens spent is a contradiction the user is left
  // to resolve on their own.
  var amber='font-size:12px;color:var(--amber);background:var(--amber-l,#fef3c7);border-radius:6px;padding:8px 10px;margin-bottom:8px;line-height:1.5';
  var engineNote;
  if(ratio.ai_unusable){
    engineNote='<div style="'+amber+'"><b>Your priorities were not applied.</b> The AI answered but its reply was cut short, so this is the built-in balanced split. Try a shorter instruction, or try again — nothing was lost.</div>';
  } else if(ignoredPriorities){
    engineNote='<div style="'+amber+'"><b>Your priorities were not applied.</b> No AI provider answered, so this is the built-in balanced split. Connect a provider in Admin → Integrations to have instructions like this followed.</div>';
  } else {
    engineNote='<div class="fs-11 c-text3" style="margin-bottom:6px">'+(ratio.engine==='ai'?'Written by the AI'+(ratio.engine_model?' ('+htmlEsc(ratio.engine_model)+')':''):'Built-in balanced split — no AI provider is connected.')+'</div>';
  }
  prev.innerHTML='<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r2);padding:12px 14px">'+
    '<div class="fs-12 c-text2" style="font-weight:600;margin-bottom:8px">Distribution preview \u2014 '+ratio.total_to_send+' leads</div>'+
    engineNote+
    '<div class="fs-12 c-text2" style="line-height:1.6;margin-bottom:8px">'+htmlEsc(ratio.summary||'')+'</div>'+
    '<div class="fs-11_5" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
      '<div><div class="c-text3" style="margin-bottom:3px">Freshness</div>'+Object.keys(bf).map(function(k){return '<div>'+k+': <strong>'+ratioPct(bf[k])+'%</strong></div>';}).join('')+'</div>'+
      '<div><div class="c-text3" style="margin-bottom:3px">Industry</div>'+Object.keys(bi).filter(function(k){return bi[k]>0;}).map(function(k){return '<div>'+k+': <strong>'+ratioPct(bi[k])+'%</strong></div>';}).join('')+'</div>'+
      '<div><div class="c-text3" style="margin-bottom:3px">Timezone</div>'+Object.keys(btz).map(function(k){return '<div>'+k+': <strong>'+ratioPct(btz[k])+'%</strong></div>';}).join('')+'</div>'+
    '</div>'+
  '</div>';
  if(btn){btn.disabled=false;btn.style.opacity='1';btn.style.cursor='pointer';}
}

function generateAutoRatio(){
  var _unassignedJobs=STATE.jobs.filter(function(j){return j.stage==='Unassigned'&&!j.assigned_to_bd;});
  var pool=STATE.distributePoolStats&&STATE.distributePoolStats.total>0
    ?STATE.distributePoolStats
    :{total:_unassignedJobs.length,by_industry:{},by_timezone:{},duplicates:0};
  var managerId=STATE._assignManagerId;
  var emailAccounts=(STATE.userEmailsCache[managerId]||[]).filter(function(a){return a.is_active;});
  var capacity=emailAccounts.reduce(function(s,a){return s+(a.daily_send_limit||300);},0);
  // Respect manual count if set
  var manualEl=document.getElementById('assign-manual-count');
  var manualCount=manualEl&&manualEl.value?parseInt(manualEl.value):0;
  if(manualCount>0)capacity=Math.min(manualCount,pool.total||99999);
  var ps=Object.assign({},pool,{capacity:capacity});
  var prev=document.getElementById('assign-ratio-preview');
  if(prev){prev.style.display='block';prev.innerHTML='<div class="fs-12 c-text3" style="padding:10px">Calculating balanced ratio\u2026</div>';}
  STATE._assignPriorityText='';
  apiPost('/distribute/generate-ratio',{priority_text:'balanced auto distribution',pool_stats:ps,manager_id:managerId}).then(function(ratio){
    showRatioPreview(ratio);
  }).catch(function(e){
    if(prev){prev.style.display='block';prev.innerHTML='<div class="fs-12 c-red" style="padding:10px">Could not generate ratio: '+htmlEsc(e.message)+'</div>';}
  });
}

window.generateAssignRatio=function(){
  var text=(document.getElementById('assign-priority-text')||{}).value||'';
  if(!text.trim()){showToast('Enter priority instructions first','warning');return;}
  var _unassignedJobs=STATE.jobs.filter(function(j){return j.stage==='Unassigned'&&!j.assigned_to_bd;});
  var pool=STATE.distributePoolStats&&STATE.distributePoolStats.total>0
    ?STATE.distributePoolStats
    :{total:_unassignedJobs.length,by_industry:{},by_timezone:{},duplicates:0};
  var managerId=STATE._assignManagerId;
  var emailAccounts=(STATE.userEmailsCache[managerId]||[]).filter(function(a){return a.is_active;});
  var capacity=emailAccounts.reduce(function(s,a){return s+(a.daily_send_limit||300);},0);
  // The typed count is read HERE TOO. Only the Auto path used to, so typing 10
  // and then describing priorities produced a preview for the whole pool — and
  // that preview number is what /distribute/execute assigns and starts sending.
  var manualEl=document.getElementById('assign-manual-count');
  var manualCount=manualEl&&manualEl.value?parseInt(manualEl.value):0;
  if(manualCount>0)capacity=Math.min(manualCount,pool.total||99999);
  var ps=Object.assign({},pool,{capacity:capacity});
  var btn=document.getElementById('gen-ratio-btn');
  if(btn){btn.textContent='Generating\u2026';btn.disabled=true;}
  var prev=document.getElementById('assign-ratio-preview');
  if(prev){prev.style.display='block';prev.innerHTML='<div class="fs-12 c-text3" style="padding:10px">\u2728 AI is generating your ratio\u2026</div>';}
  STATE._assignPriorityText=text;
  apiPost('/distribute/generate-ratio',{priority_text:text,pool_stats:ps,manager_id:managerId}).then(function(ratio){
    showRatioPreview(ratio);
    if(btn){btn.textContent='\u2728 Regenerate';btn.disabled=false;}
  }).catch(function(e){
    if(prev){prev.style.display='block';prev.innerHTML='<div class="fs-12 c-red" style="padding:10px">AI error: '+htmlEsc(e.message)+'</div>';}
    if(btn){btn.textContent='\u2728 Generate ratio with AI';btn.disabled=false;}
  });
};

window.confirmAssignToManager=function(){
  var ratio=STATE._assignRatio;
  var managerId=STATE._assignManagerId;
  if(!ratio||!managerId)return;
  var m=STATE.users.find(function(u){return u.id===managerId;})||{name:'Manager'};
  var emailAccounts=(STATE.userEmailsCache[managerId]||[]).filter(function(a){return a.is_active;});
  if(STATE._assignEmailIds){
    if(!STATE._assignEmailIds.length){ showToast('Tick at least one email ID to send from','warning'); return; }
    emailAccounts=emailAccounts.filter(function(a){return STATE._assignEmailIds.indexOf(a.id)>=0;});
  }
  var totalCapacity=emailAccounts.reduce(function(s,a){return s+(a.daily_send_limit||300);},0);
  var now=new Date();
  var dateStr=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  var timeStr=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});

  // Build email IDs breakdown
  var perEmail=emailAccounts.length>0?Math.ceil(ratio.total_to_send/emailAccounts.length):0;
  var emailIDRows=emailAccounts.length?
    emailAccounts.map(function(a,idx){
      var count=idx===emailAccounts.length-1
        ?ratio.total_to_send-perEmail*(emailAccounts.length-1)
        :perEmail;
      count=Math.max(0,Math.min(count,a.daily_send_limit||300));
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--card);border-radius:var(--r);margin-bottom:6px;border:1px solid var(--border)">'+
        '<span class="fs-10" style="padding:2px 7px;border-radius:5px;font-weight:600;background:'+(a.platform==='Microsoft'?'#e0f2fe':'#f0fdf4')+';color:'+(a.platform==='Microsoft'?'#0369a1':'#166534')+'">'+htmlEsc(a.platform||'Email')+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div class="fs-12_5" style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(a.display_name||a.email_address)+'</div>'+
          '<div class="fs-11 c-text3">'+htmlEsc(a.email_address)+'</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          '<div class="fs-14 c-accent" style="font-weight:700">'+count+'</div>'+
          '<div class="fs-10 c-text3">emails</div>'+
        '</div>'+
      '</div>';
    }).join(''):
    '<div class="fs-12 c-red" style="padding:8px">No active email IDs found for this manager.</div>';

  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Confirm assignment</div>'+
    '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="padding:14px 16px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:14px;display:flex;align-items:center;gap:14px">'+
        '<div style="flex:1">'+
          '<div class="fs-22 c-accent" style="font-weight:700;line-height:1">'+ratio.total_to_send+' leads</div>'+
          '<div class="fs-13 c-text2" style="margin-top:3px">→ <strong>'+htmlEsc(m.name)+'</strong></div>'+
          '<div class="fs-11 c-text3" style="margin-top:3px">'+dateStr+' · '+timeStr+'</div>'+
        '</div>'+
        '<div style="text-align:center;padding:10px 14px;background:var(--card);border-radius:var(--r2);border:1px solid rgba(37,99,235,.15)">'+
          '<div class="fs-18 c-accent" style="font-weight:700">'+emailAccounts.length+'</div>'+
          '<div class="fs-10 c-text3" style="margin-top:2px">email ID'+(emailAccounts.length!==1?'s':'')+'</div>'+
          '<div class="fs-10 c-text3">'+totalCapacity+'/day cap</div>'+
        '</div>'+
      '</div>'+
      '<div class="fs-12 c-text3" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Sending via</div>'+
      emailIDRows+
      '<div class="fs-12 c-text3" style="margin-top:10px;padding:8px 10px;background:var(--bg);border-radius:var(--r)">'+
        htmlEsc(ratio.summary||'AI-generated emails will be sent for each contact.')+
      '</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" '+(emailAccounts.length?'':'disabled style="opacity:.5;cursor:not-allowed"')+' onclick="submitAssignToManager()">Confirm &amp; Assign</button>'+
    '</div>'+
  '</div>';
  render();
};

window.submitAssignToManager=function(){
  var ratio=STATE._assignRatio;
  var managerId=STATE._assignManagerId;
  if(!ratio||!managerId)return;
  closeModal();
  // The RA Lead stays on Assign Leads and can start the next one straight away (owner, 29 Oct): the pool count drops at
  // once, a line says what is being assigned, and the real numbers replace both when the server answers. The server takes
  // a lead only while it is still unassigned, so two assignments back to back never share a lead.
  var m=(STATE.users||[]).find(function(u){return u.id===managerId;})||{name:'the manager'};
  var n=ratio.total_to_send||0;
  if(STATE.distributePoolStats&&typeof STATE.distributePoolStats.total==='number') STATE.distributePoolStats.total=Math.max(0,STATE.distributePoolStats.total-n);
  STATE._assigningNow={name:m.name,n:n};
  STATE._assignRatio=null;STATE._assignManagerId=null;
  render();
  var body={manager_id:managerId,ratio:ratio};
  if(STATE._assignEmailIds&&STATE._assignEmailIds.length) body.email_ids=STATE._assignEmailIds.slice();
  apiPost('/distribute/execute',body).then(function(res){
    var msg=res.total_assigned+' leads assigned to '+m.name+' · emails sending automatically'+(res.skipped_no_people?' · '+res.skipped_no_people+' left in the pool (no contact person to write to)':'');
    showToast(msg,'success');
    STATE._assigningNow=null;
    startProgressPoll();
    return Promise.all([refreshPoolStats(),refreshJobs()]);
  }).catch(function(e){ STATE._assigningNow=null; refreshPoolStats(); showToast('Failed: '+e.message,'error'); });
};

