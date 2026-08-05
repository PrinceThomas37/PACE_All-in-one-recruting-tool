// ════════════════════════════════════════════════
// DISTRIBUTION ACTIONS — Drop N
// ════════════════════════════════════════════════

function refreshPoolStats(){
  apiGet('/distribute/pool-stats').then(function(d){
    STATE.distributePoolStats=d;render();
  }).catch(function(){});
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

  STATE.modal='<div class="modal modal-w540">'+
    '<div class="mh">'+
      '<div><div class="mt">Assign leads \u2014 '+htmlEsc(m.name)+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:3px">'+pool.total+' unassigned leads \u00b7 '+capacity+' email capacity today</div>'+
      '</div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button>'+
    '</div>'+
    '<div class="mb_">'+
      // Manual count override
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border-radius:var(--r2);margin-bottom:14px;border:1px solid var(--border)">'+
        '<div style="flex:1">'+
          '<div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:2px">Number of leads to assign</div>'+
          '<div style="font-size:11px;color:var(--text3)">Leave blank to let AI decide based on capacity ('+capacity+' max)</div>'+
        '</div>'+
        '<input type="number" id="assign-manual-count" min="1" max="'+pool.total+'" placeholder="Auto" style="width:80px;padding:8px 10px;border:1px solid var(--border2);border-radius:8px;font-size:14px;font-weight:600;text-align:center;font-family:inherit" oninput="updateAssignCountPreview()"/>'+
        '<span style="font-size:12px;color:var(--text3)">/ '+pool.total+'</span>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
        '<div onclick="setAssignMode(\'auto\')" id="mode-auto" style="padding:14px;border:2px solid var(--accent);border-radius:var(--r2);cursor:pointer;background:var(--accent-l);text-align:center">'+
          '<div style="font-size:18px;margin-bottom:4px">\u26a1</div>'+
          '<div style="font-weight:600;font-size:13px;color:var(--accent)">Auto</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px">System picks balanced ratio</div>'+
        '</div>'+
        '<div onclick="setAssignMode(\'text\')" id="mode-text" style="padding:14px;border:2px solid var(--border);border-radius:var(--r2);cursor:pointer;text-align:center">'+
          '<div style="font-size:18px;margin-bottom:4px">\u270f\ufe0f</div>'+
          '<div style="font-weight:600;font-size:13px">Priority text</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px">Tell AI what to prioritise</div>'+
        '</div>'+
      '</div>'+
      '<div id="assign-text-panel" style="display:none;margin-bottom:12px">'+
        '<label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px">Describe your priorities</label>'+
        '<textarea id="assign-priority-text" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;min-height:80px;resize:vertical;font-family:inherit" placeholder="e.g. Focus on old leads first, prioritise healthcare and legal, send mostly to EST timezone, exclude duplicates..."></textarea>'+
        '<button onclick="generateAssignRatio()" style="margin-top:8px;background:var(--purple);color:#fff;border:0;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer" id="gen-ratio-btn">\u2728 Generate ratio with AI</button>'+
      '</div>'+
      '<div id="assign-ratio-preview" style="display:none"></div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" id="assign-confirm-btn" onclick="confirmAssignToManager()" disabled style="opacity:.5;cursor:not-allowed">Preview assignment</button>'+
    '</div>'+
  '</div>';
  render();
  // Auto mode selected by default — trigger auto ratio generation
  setTimeout(function(){generateAutoRatio();},100);
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

function showRatioPreview(ratio){
  STATE._assignRatio=ratio;
  var prev=document.getElementById('assign-ratio-preview');
  var btn=document.getElementById('assign-confirm-btn');
  if(!prev)return;
  var bf=ratio.by_freshness||{};
  var bi=ratio.by_industry||{};
  var btz=ratio.by_timezone||{};
  prev.style.display='block';
  prev.innerHTML='<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r2);padding:12px 14px">'+
    '<div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">Distribution preview \u2014 '+ratio.total_to_send+' leads</div>'+
    '<div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:8px">'+htmlEsc(ratio.summary||'')+'</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11.5px">'+
      '<div><div style="color:var(--text3);margin-bottom:3px">Freshness</div>'+Object.keys(bf).map(function(k){return '<div>'+k+': <strong>'+bf[k]+'%</strong></div>';}).join('')+'</div>'+
      '<div><div style="color:var(--text3);margin-bottom:3px">Industry</div>'+Object.keys(bi).filter(function(k){return bi[k]>0;}).map(function(k){return '<div>'+k+': <strong>'+bi[k]+'%</strong></div>';}).join('')+'</div>'+
      '<div><div style="color:var(--text3);margin-bottom:3px">Timezone</div>'+Object.keys(btz).map(function(k){return '<div>'+k+': <strong>'+btz[k]+'%</strong></div>';}).join('')+'</div>'+
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
  if(prev){prev.style.display='block';prev.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px">Calculating balanced ratio\u2026</div>';}
  apiPost('/distribute/generate-ratio',{priority_text:'balanced auto distribution',pool_stats:ps,manager_id:managerId}).then(function(ratio){
    showRatioPreview(ratio);
  }).catch(function(e){
    if(prev){prev.style.display='block';prev.innerHTML='<div style="font-size:12px;color:var(--red);padding:10px">Could not generate ratio: '+htmlEsc(e.message)+'</div>';}
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
  var ps=Object.assign({},pool,{capacity:capacity});
  var btn=document.getElementById('gen-ratio-btn');
  if(btn){btn.textContent='Generating\u2026';btn.disabled=true;}
  var prev=document.getElementById('assign-ratio-preview');
  if(prev){prev.style.display='block';prev.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px">\u2728 AI is generating your ratio\u2026</div>';}
  apiPost('/distribute/generate-ratio',{priority_text:text,pool_stats:ps,manager_id:managerId}).then(function(ratio){
    showRatioPreview(ratio);
    if(btn){btn.textContent='\u2728 Regenerate';btn.disabled=false;}
  }).catch(function(e){
    if(prev){prev.style.display='block';prev.innerHTML='<div style="font-size:12px;color:var(--red);padding:10px">AI error: '+htmlEsc(e.message)+'</div>';}
    if(btn){btn.textContent='\u2728 Generate ratio with AI';btn.disabled=false;}
  });
};

window.confirmAssignToManager=function(){
  var ratio=STATE._assignRatio;
  var managerId=STATE._assignManagerId;
  if(!ratio||!managerId)return;
  var m=STATE.users.find(function(u){return u.id===managerId;})||{name:'Manager'};
  var emailAccounts=(STATE.userEmailsCache[managerId]||[]).filter(function(a){return a.is_active;});
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
        '<span style="font-size:10px;padding:2px 7px;border-radius:5px;font-weight:600;background:'+(a.platform==='Microsoft'?'#e0f2fe':'#f0fdf4')+';color:'+(a.platform==='Microsoft'?'#0369a1':'#166534')+'">'+htmlEsc(a.platform||'Email')+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(a.display_name||a.email_address)+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(a.email_address)+'</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          '<div style="font-size:14px;font-weight:700;color:var(--accent)">'+count+'</div>'+
          '<div style="font-size:10px;color:var(--text3)">emails</div>'+
        '</div>'+
      '</div>';
    }).join(''):
    '<div style="font-size:12px;color:var(--red);padding:8px">No active email IDs found for this manager.</div>';

  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Confirm assignment</div>'+
    '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="padding:14px 16px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:14px;display:flex;align-items:center;gap:14px">'+
        '<div style="flex:1">'+
          '<div style="font-size:22px;font-weight:700;color:var(--accent);line-height:1">'+ratio.total_to_send+' leads</div>'+
          '<div style="font-size:13px;color:var(--text2);margin-top:3px">→ <strong>'+htmlEsc(m.name)+'</strong></div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px">'+dateStr+' · '+timeStr+'</div>'+
        '</div>'+
        '<div style="text-align:center;padding:10px 14px;background:var(--card);border-radius:var(--r2);border:1px solid rgba(37,99,235,.15)">'+
          '<div style="font-size:18px;font-weight:700;color:var(--accent)">'+emailAccounts.length+'</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:2px">email ID'+(emailAccounts.length!==1?'s':'')+'</div>'+
          '<div style="font-size:10px;color:var(--text3)">'+totalCapacity+'/day cap</div>'+
        '</div>'+
      '</div>'+
      '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Sending via</div>'+
      emailIDRows+
      '<div style="font-size:12px;color:var(--text3);margin-top:10px;padding:8px 10px;background:var(--bg);border-radius:var(--r)">'+
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
  apiPost('/distribute/execute',{manager_id:managerId,ratio:ratio}).then(function(res){
    var msg=res.total_assigned+' leads assigned · emails sending automatically';
    showToast(msg,'success');
    STATE._assignRatio=null;STATE._assignManagerId=null;
    STATE.sendProgress=null;
    STATE.page='email'; // go to email page so progress bar is visible
    render();
    startProgressPoll();
    return Promise.all([refreshPoolStats(),refreshJobs()]);
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

