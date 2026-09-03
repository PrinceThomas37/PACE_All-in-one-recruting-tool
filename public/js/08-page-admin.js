// ── ADMIN ──────────────────────────────────────
// ── System Settings — admin-editable operational numbers (config/settings.js) ──
window.openSystemSettingsModal=function(){
  STATE._sysSettingsErrors={};
  if(STATE.sysSettings){renderSystemSettingsModal();return;}
  STATE.modal='<div class="modal modal-w480"><div class="mh"><div class="mt">System Settings</div></div><div class="mb_" style="padding:24px;text-align:center;color:var(--text3)">Loading…</div></div>';
  render();
  apiGet('/admin/settings/numbers').then(function(r){
    STATE.sysSettings=r||[];
    renderSystemSettingsModal();
  }).catch(function(e){
    closeModal();
    showToast('Failed to load settings: '+(e&&e.message||e),'error');
  });
};
function sysSettingsGrouped(){
  var list=STATE.sysSettings||[];
  var groups={};
  var order=[];
  list.forEach(function(s){
    if(!groups[s.group]){groups[s.group]=[];order.push(s.group);}
    groups[s.group].push(s);
  });
  return order.map(function(g){return {group:g,items:groups[g]};});
}
function renderSystemSettingsModal(){
  var errors=STATE._sysSettingsErrors||{};
  var groups=sysSettingsGrouped();
  var body=groups.map(function(g){
    var rows=g.items.map(function(s){
      var err=errors[s.key];
      return '<div style="margin-bottom:14px">'+
        '<label class="flbl" style="display:flex;justify-content:space-between;align-items:baseline">'+
          '<span>'+htmlEsc(s.label)+'</span>'+
          '<span style="font-size:11px;color:var(--text3);font-weight:400">'+s.min+'–'+s.max+' '+htmlEsc(s.unit||'')+'</span>'+
        '</label>'+
        '<input class="inp" type="number" id="sys-'+s.key+'" value="'+htmlEsc(String(s.value))+'" min="'+s.min+'" max="'+s.max+'" step="any" data-key="'+s.key+'" style="'+(err?'border-color:var(--red)':'')+'"/>'+
        '<div style="font-size:11.5px;color:'+(err?'var(--red)':'var(--text3)')+';margin-top:3px">'+htmlEsc(err||s.description)+'</div>'+
      '</div>';
    }).join('');
    return '<div style="margin-bottom:18px">'+
      '<div style="font-weight:700;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">'+htmlEsc(g.group)+'</div>'+
      rows+
    '</div>';
  }).join('');
  STATE.modal='<div class="modal modal-w480" style="max-height:88vh;overflow-y:auto">'+
    '<div class="mh"><div><div class="mt">System Settings</div><div style="font-size:12px;color:var(--text3);margin-top:2px">Operational numbers used across the platform. Changes apply the next time each check runs (within about a minute).</div></div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+body+'</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" id="sys-settings-save" onclick="saveSystemSettings()">Save changes</button></div>'+
  '</div>';
  render();
}
window.saveSystemSettings=function(){
  var list=STATE.sysSettings||[];
  var values={};
  var clientErrors={};
  list.forEach(function(s){
    var el=document.getElementById('sys-'+s.key);
    if(!el)return;
    var raw=el.value;
    var num=parseFloat(raw);
    if(raw===''||isNaN(num)){clientErrors[s.key]='"'+s.label+'" must be a number';return;}
    if(num<s.min||num>s.max){clientErrors[s.key]='"'+s.label+'" must be between '+s.min+' and '+s.max;return;}
    if(num!==s.value)values[s.key]=num;
  });
  if(Object.keys(clientErrors).length){
    STATE._sysSettingsErrors=clientErrors;
    renderSystemSettingsModal();
    showToast('Fix the highlighted field(s) before saving','warning');
    return;
  }
  if(!Object.keys(values).length){
    showToast('No changes to save','info');
    return;
  }
  var btn=document.getElementById('sys-settings-save'); if(btn){btn.disabled=true;btn.textContent='Saving…';}
  apiPost('/admin/settings/numbers',{values:values}).then(function(r){
    STATE.sysSettings=r.settings||STATE.sysSettings;
    STATE._sysSettingsErrors={};
    closeModal();
    showToast('Settings saved','success');
  }).catch(function(e){
    var btn2=document.getElementById('sys-settings-save'); if(btn2){btn2.disabled=false;btn2.textContent='Save changes';}
    showToast('Save failed: '+(e&&e.message||e),'error');
  });
};

// ── Integrations & API Keys (admin) ──
window.openIntegrationsModal=function(){
  STATE._intgTest={}; STATE._emailVerifyResult=null;
  STATE.modal='<div class="modal modal-w480"><div class="mh"><div class="mt">Integrations & API Keys</div></div><div class="mb_" style="padding:24px;text-align:center;color:var(--text3)">Loading…</div></div>';
  render();
  apiGet('/admin/integrations').then(function(r){ STATE.integrations=r; renderIntegrationsModal(); })
    .catch(function(e){ closeModal(); showToast('Failed to load integrations: '+(e&&e.message||e),'error'); });
};
function intgFind(id){ var out=null; ((STATE.integrations&&STATE.integrations.categories)||[]).forEach(function(c){c.items.forEach(function(x){if(x.id===id)out=x;});}); return out; }
function renderIntegrationsModal(){
  var d=STATE.integrations; if(!d)return;
  var tests=STATE._intgTest||{};
  var cats=(d.categories||[]).map(function(cat){
    var cards=cat.items.map(function(it){
      var badge=it.configured
        ?'<span style="font-size:10px;padding:2px 8px;border-radius:6px;font-weight:700;background:var(--green-l);color:var(--green)">Connected</span>'
        :'<span style="font-size:10px;padding:2px 8px;border-radius:6px;font-weight:700;background:var(--bg3);color:var(--text3)">Not configured</span>';
      var fields=it.fields.map(function(f){
        // A model name or a server address is not a credential: show it as
        // readable text with its current value, or the operator can never see
        // which model is actually in force.
        if(f.secret===false){
          return '<input class="inp" id="intg-'+it.id+'-'+f.key+'" type="text" value="'+htmlEsc(f.value||'')+'" placeholder="'+htmlEsc(f.placeholder||f.label)+'" title="'+htmlEsc(f.label)+'" style="margin-bottom:6px"/>';
        }
        return '<input class="inp" id="intg-'+it.id+'-'+f.key+'" type="password" autocomplete="new-password" placeholder="'+(f.configured?htmlEsc(f.hint||'configured'):htmlEsc(f.placeholder||f.label))+'" style="margin-bottom:6px"/>';
      }).join('');
      var t=tests[it.id]; var testHtml='';
      if(t){ testHtml=t.pending
        ?'<span style="font-size:11.5px;color:var(--text3);margin-left:6px">Testing…</span>'
        :'<span style="font-size:11.5px;margin-left:6px;color:'+(t.ok?'var(--green)':'var(--red)')+'">'+(t.ok?'✓ '+htmlEsc(t.detail||'OK'):'✗ '+htmlEsc(t.error||'failed'))+'</span>'; }
      var activeToggle=it.verifier
        ?'<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text2);cursor:pointer;margin-top:2px"><input type="checkbox" '+(it.active_verifier?'checked':'')+' onchange="setActiveVerifier(\''+it.id+'\',this.checked)"> Use this verifier for pre-send checks</label>'
        :(it.ai
        ?'<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text2);cursor:pointer;margin-top:2px"><input type="radio" name="intg-active-ai" '+(it.active_ai?'checked':'')+' onchange="setActiveAi(\''+it.id+'\')"> Use this provider first</label>'
        :'');
      return '<div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px"><div style="font-weight:600;font-size:13px">'+htmlEsc(it.label)+'</div>'+badge+'</div>'+
        '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">'+htmlEsc(it.description)+(it.docs?' · <a href="'+htmlEsc(it.docs)+'" target="_blank" rel="noopener" style="color:var(--accent)">Get key ↗</a>':'')+'</div>'+
        fields+activeToggle+
        '<div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap">'+
          '<button class="btn btn-sm btn-primary" onclick="saveIntegration(\''+it.id+'\')">Save</button>'+
          (it.has_test?'<button class="btn btn-sm btn-outline" onclick="testIntegration(\''+it.id+'\')">Test</button>':'')+
          (it.configured?'<button onclick="disconnectIntegration(\''+it.id+'\')" style="font-size:11px;color:var(--red);background:transparent;border:0;cursor:pointer">Disconnect</button>':'')+
          testHtml+
        '</div>'+
      '</div>';
    }).join('');
    return '<div style="margin-bottom:16px">'+
      '<div style="font-weight:700;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">'+htmlEsc(cat.category)+'</div>'+
      (cat.category==='AI'?aiProviderNote():'')+cards+(cat.category==='Email verification'?emailVerifyTester():'')+
    '</div>';
  }).join('');
  STATE.modal='<div class="modal modal-w480" style="max-height:88vh;overflow-y:auto">'+
    '<div class="mh"><div><div class="mt">Integrations & API Keys</div><div style="font-size:12px;color:var(--text3);margin-top:2px">Paste a provider key and Save. Stored keys are never shown again — only a masked hint. The matching backend hook uses them automatically.</div></div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+cats+'</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>'+
  '</div>';
  render();
}
function emailVerifyTester(){
  var r=STATE._emailVerifyResult;
  var c=r?(r.result==='valid'?'var(--green)':r.result==='invalid'?'var(--red)':r.result==='risky'?'var(--amber)':'var(--text3)'):'var(--text3)';
  var resHtml=r?'<div style="font-size:12px;margin-top:6px;color:'+c+'">Result: <b>'+htmlEsc(r.result)+'</b>'+(r.provider?' ('+htmlEsc(r.provider)+')':'')+(r.reason==='not_configured'?' — no verifier configured yet':'')+'</div>':'';
  return '<div style="background:var(--bg3);border:1px dashed var(--border2);border-radius:8px;padding:10px 12px;margin-top:2px">'+
    '<div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">Test the active verifier against an address:</div>'+
    '<div style="display:flex;gap:6px"><input class="inp" id="intg-verify-addr" placeholder="name@company.com" style="flex:1"/>'+
      '<button class="btn btn-sm btn-primary" onclick="runEmailVerifyTest()">Verify</button></div>'+resHtml+
  '</div>';
}
window.saveIntegration=function(id){
  var it=intgFind(id); if(!it)return;
  var values={};
  it.fields.forEach(function(f){
    var el=document.getElementById('intg-'+id+'-'+f.key); if(!el)return;
    // A blank secret means "leave the stored one alone"; a blank plain field
    // means "clear this override" — otherwise a model name could be set but
    // never unset.
    if(el.value!=='')values[f.key]=el.value;
    else if(f.secret===false&&f.value)values[f.key]='';
  });
  if(!Object.keys(values).length){ showToast('Enter a value first','warning'); return; }
  apiPost('/admin/integrations/'+id,{values:values}).then(function(r){ STATE.integrations=r; showToast('Saved','success'); renderIntegrationsModal(); })
    .catch(function(e){ showToast('Save failed: '+(e&&e.message||e),'error'); });
};
window.testIntegration=function(id){
  var el=document.getElementById('intg-'+id+'-api_key');
  var burl=document.getElementById('intg-'+id+'-base_url');
  var body={};
  if(el&&el.value)body.api_key=el.value;
  if(burl&&burl.value)body.base_url=burl.value;
  STATE._intgTest=STATE._intgTest||{}; STATE._intgTest[id]={pending:true}; renderIntegrationsModal();
  apiPost('/admin/integrations/'+id+'/test',body).then(function(r){ STATE._intgTest[id]=r; renderIntegrationsModal(); })
    .catch(function(e){ STATE._intgTest[id]={ok:false,error:(e&&e.message||e)}; renderIntegrationsModal(); });
};
function aiProviderNote(){
  return '<div style="background:var(--bg3);border:1px dashed var(--border2);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:11.5px;color:var(--text3);line-height:1.5">'+
    'AI is optional everywhere in PACE — email drafting, resume parsing, job-description cleanup and the daily briefing all have a built-in non-AI version that runs when no provider is set up. '+
    'Connect one below to improve them. <b>Groq</b> and <b>OpenRouter</b> are free and need no credit card; <b>Ollama</b> runs a model on a server you own. '+
    'The one marked "use first" is tried first, and if it is unavailable or out of free requests, the others are tried before falling back to the built-in version.'+
  '</div>';
}
window.setActiveAi=function(id){
  apiPost('/admin/integrations/'+id,{active:true}).then(function(r){ STATE.integrations=r; showToast('Provider preference saved','success'); renderIntegrationsModal(); })
    .catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
};
window.setActiveVerifier=function(id,on){
  apiPost('/admin/integrations/'+id,{active:!!on}).then(function(r){ STATE.integrations=r; renderIntegrationsModal(); })
    .catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
};
window.disconnectIntegration=function(id){
  if(!confirm('Remove the saved key for this integration?'))return;
  apiDelete('/admin/integrations/'+id).then(function(r){ STATE.integrations=r; showToast('Disconnected','success'); renderIntegrationsModal(); })
    .catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
};
window.runEmailVerifyTest=function(){
  var el=document.getElementById('intg-verify-addr'); var addr=el?el.value:'';
  if(!addr){ showToast('Enter an address','warning'); return; }
  apiPost('/admin/integrations/email-verify',{address:addr}).then(function(r){ STATE._emailVerifyResult=r; renderIntegrationsModal(); })
    .catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
};

function loadSendingStatus(){
  apiGet('/admin/sending/status').then(function(s){
    STATE.sendingPaused=!!(s&&s.paused);
    STATE.pausedManagers=(s&&s.pausedManagers)||[];
    scheduleRender();
  }).catch(function(){
    if(STATE.sendingPaused===undefined)STATE.sendingPaused=false;
    if(STATE.pausedManagers===undefined)STATE.pausedManagers=[];
  });
}
function loadManagerRaModes(){
  if(STATE._raModesLoading)return;
  STATE._raModesLoading=true;
  apiGet('/admin/manager-ra-modes').then(function(r){
    STATE.raModes=(r&&r.modes)||{};
    STATE._raModesLoading=false;
    scheduleRender();
  }).catch(function(){ STATE._raModesLoading=false; if(STATE.raModes===undefined)STATE.raModes={}; });
}
window.toggleManagerRaMode=function(ev,bdId){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  var cur=(STATE.raModes&&STATE.raModes[bdId])||'auto';
  var next=cur==='auto'?'manual':'auto';
  var m=(STATE.users||[]).find(function(x){return x.id===bdId;})||{name:'this manager'};
  if(next==='manual'&&!confirm('Switch '+m.name+' to MANUAL outreach?\n\nNew leads assigned to them will NOT auto-send. They generate and send outreach themselves. (Auto follow-ups are also skipped for new assignments.)'))return;
  STATE.raModes=STATE.raModes||{};
  STATE.raModes[bdId]=next; // optimistic
  render();
  apiPost('/admin/manager-ra-mode',{bd_id:bdId,mode:next}).then(function(){
    showToast(m.name+' set to '+(next==='auto'?'Automatic':'Manual')+' RA','success');
  }).catch(function(e){
    STATE.raModes[bdId]=cur; render();
    showToast('Failed: '+(e&&e.message||e),'error');
  });
};
window.toggleSending=function(pause){
  if(pause&&!confirm('EMERGENCY STOP\n\nPause ALL outbound email sending right now?\n\nAny run in progress stops before the next email (already-sent mail cannot be recalled). Queued emails stay pending until you resume.'))return;
  apiPost(pause?'/admin/sending/pause':'/admin/sending/resume',{}).then(function(r){
    STATE.sendingPaused=!!(r&&r.paused);
    showToast(STATE.sendingPaused?'Sending PAUSED — all outbound email stopped':'Sending resumed','success');
    render();
  }).catch(function(e){showToast('Failed: '+(e&&e.message||e),'error');});
};
window.toggleManagerSending=function(managerId,pause){
  var m=(STATE.users||[]).find(function(x){return x.id===managerId;})||{name:'this manager'};
  if(pause&&!confirm('Stop all outbound emailing for '+m.name+'?\n\nAny send in progress for them stops before the next email; their queued emails stay pending until you resume. Other managers are unaffected.'))return;
  apiPost(pause?'/admin/sending/pause':'/admin/sending/resume',{manager_id:managerId}).then(function(){
    STATE.pausedManagers=STATE.pausedManagers||[];
    var i=STATE.pausedManagers.indexOf(managerId);
    if(pause&&i<0)STATE.pausedManagers.push(managerId);
    if(!pause&&i>-1)STATE.pausedManagers.splice(i,1);
    showToast(pause?('Emailing paused for '+m.name):('Emailing resumed for '+m.name),'success');
    render();
  }).catch(function(e){showToast('Failed: '+(e&&e.message||e),'error');});
};

// ── DELIVERABILITY DASHBOARD ───────────────────────────────────
// Note: the suppression (opt-out) list still runs in the background — anyone
// who replies "unsubscribe" is auto-removed from future sends, protecting
// sender reputation. There's just no browsing UI for it here anymore; the
// suppressed count still shows as a stat.
function loadDeliverability(){
  STATE._delivLoading=true;
  var days=STATE.delivDays||30;
  Promise.all([
    apiGet('/admin/deliverability?days='+days+(STATE.delivView?'&view='+STATE.delivView:'')).catch(function(){return null;}),
    apiGet('/analytics/templates?days='+days).catch(function(){return [];})
  ]).then(function(r){
    STATE.deliv=r[0]; STATE.delivTemplates=r[1]||[];
    STATE._delivLoading=false; scheduleRender();
  });
}
window.openDeliverability=function(){ STATE.page='deliverability'; STATE.deliv=undefined; render(); loadDeliverability(); };
window.setDelivDays=function(days){ STATE.delivDays=days; STATE.deliv=undefined; render(); loadDeliverability(); };
window.setDelivView=function(v){ STATE.delivView=v; STATE.deliv=undefined; render(); loadDeliverability(); };
window.resumeMailbox=function(id){ apiPost('/admin/mailbox/'+id+'/resume',{}).then(function(){ showToast('Mailbox resumed','success'); loadDeliverability(); }).catch(function(e){showToast('Failed: '+(e&&e.message||e),'error');}); };

// ── Warm-up pool ──
function loadWarmup(){
  if(STATE._warmupLoading)return;
  STATE._warmupLoading=true;
  apiGet('/warmup/mailboxes').then(function(r){ STATE.warmup=r||{mailboxes:[]}; STATE._warmupLoading=false; scheduleRender(); }).catch(function(){ STATE.warmup={mailboxes:[],_err:true}; STATE._warmupLoading=false; scheduleRender(); });
}
window.runWarmupTick=function(){
  STATE.warmupTick='running'; scheduleRender();
  apiPost('/warmup/tick',{}).then(function(r){ STATE.warmupTick=r;
    showToast(r.off?'Engine off — apply migration 009':'Warm-up ran · '+(r.sent||0)+' sent · '+(r.replied||0)+' replies · '+(r.rescued||0)+' rescued',(r.off?'warning':'success'));
    loadWarmup();
  }).catch(function(e){ STATE.warmupTick=null; showToast('Warm-up failed: '+(e&&e.message||e),'error'); scheduleRender(); });
};
window.warmupAction=function(id,action){
  apiPost('/warmup/'+id+'/'+action,{}).then(function(){ showToast('Warm-up '+action+'d','success'); loadWarmup(); }).catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
};
window.openWarmupStart=function(id){
  var mb=((STATE.warmup&&STATE.warmup.mailboxes)||[]).find(function(m){return m.id===id;})||{};
  var defDays=(STATE.warmup&&STATE.warmup.defaults&&STATE.warmup.defaults.days)||25;
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Start warm-up · '+htmlEsc(mb.email||'')+'</div></div>'+
    '<div class="mb_">'+
      '<div style="font-size:12.5px;color:var(--text3);margin-bottom:12px">This mailbox will send warm-up emails to your other pool mailboxes and hold short conversations with them each day, ramping up over the duration below, then graduate to outreach. Needs at least one other connected pool mailbox.</div>'+
      '<label style="font-size:12px;color:var(--text2)">Warm-up duration (days)</label>'+
      '<input id="wu-days" class="inp" type="number" min="1" max="120" value="'+defDays+'" style="margin:4px 0 12px">'+
      '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer"><input type="checkbox" id="wu-optin" checked style="width:15px;height:15px"> Also let this mailbox receive + reply to other warm-up mail (recommended)</label>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitWarmupStart(\''+id+'\')">Start warm-up</button></div>'+
  '</div>';
  render();
};
window.submitWarmupStart=function(id){
  var days=parseInt((document.getElementById('wu-days')||{}).value,10)||25;
  var optin=!(document.getElementById('wu-optin')&&document.getElementById('wu-optin').checked===false);
  apiPost('/warmup/'+id+'/start',{days:days,opt_in_receive:optin}).then(function(){ showToast('Warm-up started','success'); closeModal(); loadWarmup(); }).catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
};

// ── Domain authentication & blacklist health ──
function loadDomainHealth(refresh){
  if(STATE._dhLoading)return;
  STATE._dhLoading=true;
  if(refresh)STATE.domainHealth='loading';
  apiGet('/admin/domain-health'+(refresh?'?refresh=1':'')).then(function(r){ STATE.domainHealth=r||{domains:[]}; STATE._dhLoading=false; scheduleRender(); }).catch(function(){ STATE.domainHealth={domains:[],_err:true}; STATE._dhLoading=false; scheduleRender(); });
}
window.refreshDomainHealth=function(){ STATE._dhLoading=false; loadDomainHealth(true); showToast('Re-checking domains…','info'); };
window.toggleDomainFindings=function(d){ STATE._dhOpen=STATE._dhOpen||{}; STATE._dhOpen[d]=!STATE._dhOpen[d]; scheduleRender(); };
window.runSpamCheck=function(){ apiPost('/emails/spam-check',{subject:STATE.spamSubj||'',body:STATE.spamBody||''}).then(function(r){ STATE.spamResult=r; scheduleRender(); }).catch(function(e){showToast('Failed: '+(e&&e.message||e),'error');}); };
window.previewTemplateSample=function(variant){
  var t=(STATE.delivTemplates||[]).find(function(x){return x.variant===variant;});
  if(!t||!t.sample){showToast('No sample available for this template','warning');return;}
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">'+htmlEsc(t.label||t.variant)+' — sample sent</div></div>'+
    '<div class="mb_">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Subject</div>'+
      '<div style="font-size:13.5px;font-weight:600;margin-bottom:12px">'+htmlEsc(t.sample.subject||'')+'</div>'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Body</div>'+
      '<div style="font-size:13px;white-space:pre-wrap;line-height:1.5;max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px 12px">'+htmlEsc(t.sample.body||'')+'</div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>'+
  '</div>';
  render();
};

function renderDeliverability(){
  var u=STATE.user;
  if(!userHasAnyRole(u,'admin','bd_lead','ra_lead'))return '<div class="page">Forbidden</div>';
  if(STATE.deliv===undefined&&!STATE._delivLoading){loadDeliverability();}
  var days=STATE.delivDays||30;
  var d=STATE.deliv, tpls=STATE.delivTemplates||[], sr=STATE.spamResult;
  function stat(label,val,color){ return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 16px;min-width:118px"><div style="font-size:22px;font-weight:700;color:'+(color||'var(--text)')+'">'+(val==null?'—':val)+'</div><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">'+label+'</div></div>'; }
  var statsRow=d?'<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">'+stat('Sent ('+days+'d)',d.sent,'var(--accent)')+stat('Failed ('+days+'d)',d.failed,'var(--amber)')+stat('Bounced',d.bounced_contacts,'var(--red)')+stat('Replied',d.replied_contacts,'var(--green)')+stat('Opted out',d.suppression_count,'var(--text2)')+'</div>':'<div style="color:var(--text3);margin-bottom:20px">Loading…</div>';
  var dayFilter='<div style="display:flex;gap:4px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:3px">'+[7,30,90].map(function(n){
    var on=days===n;
    return '<button onclick="setDelivDays('+n+')" style="padding:5px 12px;border:0;border-radius:6px;background:'+(on?'var(--accent)':'transparent')+';color:'+(on?'#fff':'var(--text2)')+';font-size:12px;font-weight:600;cursor:pointer">'+n+'d</button>';
  }).join('')+'</div>';
  var mbRows=(d&&d.mailboxes||[]).map(function(m){
    var conn=m.connection||{};
    // Sign-in health first — a "healthy" send-rate badge is misleading if the
    // mailbox can't actually sign in to send.
    var connBadge=conn.status==='expired'?'<span title="'+htmlEsc(conn.error||'The mailbox sign-in refresh is failing — reconnect it under Manager Users → Email IDs.')+'" style="font-size:11px;padding:2px 8px;background:var(--red-l);color:var(--red);border-radius:6px;font-weight:700">&#9888; Sign-in expired — reconnect</span>':(conn.status==='ok'?'<span style="font-size:11px;padding:2px 8px;background:var(--green-l);color:var(--green);border-radius:6px;font-weight:600">&#10003; Signed in</span>':(conn.status==='none'?'<span style="font-size:11px;padding:2px 8px;background:var(--bg3);color:var(--text3);border-radius:6px;font-weight:600">Not connected</span>':''));
    // Send-rate / warm-up status is moot while a mailbox can't sign in — show only
    // the actionable reconnect badge in that case.
    var status=conn.status==='expired'?'':(m.auto_paused?'<span style="font-size:11px;padding:2px 8px;background:#fee2e2;color:#b91c1c;border-radius:6px;font-weight:700">Auto-paused</span> <button onclick="resumeMailbox(\''+m.id+'\')" style="font-size:11px;color:var(--green);background:transparent;border:0;cursor:pointer">Resume</button>':(m.warmup?'<span style="font-size:11px;padding:2px 8px;background:var(--amber-l);color:var(--amber);border-radius:6px;font-weight:600">Warm-up · cap '+m.warmup.today_cap+'/day</span>':'<span style="font-size:11px;padding:2px 8px;background:var(--green-l);color:var(--green);border-radius:6px;font-weight:600">Healthy</span>'));
    return '<div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap"><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">'+htmlEsc(m.name||m.email)+'</div><div style="font-size:11px;color:var(--text3)">'+htmlEsc(m.email)+' · '+m.daily_limit+'/day cap</div></div>'+connBadge+status+'</div>';
  }).join('');
  // Personal / My team / Org-wide scope toggle — you see the sending mailboxes of
  // your own people, not everyone's, unless you're an admin viewing org-wide.
  var mbViewToggle='';
  if(d){
    var vv=d.view||'team';
    var vopts=[['own','Personal'],['team','My team']];
    if(d.can_org)vopts.push(['org','Org-wide']);
    mbViewToggle='<div style="display:flex;gap:4px;padding:9px 14px;border-bottom:1px solid var(--border)">'+vopts.map(function(o){var on=vv===o[0];return '<button onclick="setDelivView(\''+o[0]+'\')" style="padding:4px 11px;border:1px solid '+(on?'var(--accent)':'var(--border)')+';border-radius:7px;background:'+(on?'var(--accent-l)':'transparent')+';color:'+(on?'var(--accent)':'var(--text2)')+';font-size:11.5px;font-weight:600;cursor:pointer">'+o[1]+'</button>';}).join('')+'</div>';
  }
  // ── Warm-up pool ──
  var isAdmin=userHasRole(u,'admin');
  if(STATE.warmup===undefined&&!STATE._warmupLoading)loadWarmup();
  var w=STATE.warmup;
  var wtick=STATE.warmupTick;
  var warmMuted='font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600';
  var warmRows=(w&&w.mailboxes||[]).map(function(m){
    var badge, actions='';
    var btn=function(action,label,color){ return '<button onclick="warmupAction(\''+m.id+'\',\''+action+'\')" style="font-size:11px;color:'+color+';background:transparent;border:1px solid var(--border2);padding:3px 9px;border-radius:6px;cursor:pointer;margin-left:5px">'+label+'</button>'; };
    if(m.warmup_status==='warming'){
      badge='<span style="'+warmMuted+';background:var(--amber-l);color:var(--amber)">Warming · day '+(m.day_label||'')+'</span>';
      if(isAdmin)actions=btn('pause','Pause','var(--amber)')+btn('stop','Graduate','var(--green)');
    } else if(m.warmup_status==='paused'){
      badge='<span style="'+warmMuted+';background:var(--bg3);color:var(--text2)">Paused</span>';
      if(isAdmin)actions=btn('resume','Resume','var(--green)')+btn('stop','Graduate','var(--text2)');
    } else if(m.warmup_status==='warmed'){
      badge='<span style="'+warmMuted+';background:var(--green-l);color:var(--green)">✓ Warmed — ready for outreach</span>';
      if(isAdmin)actions='<button onclick="openWarmupStart(\''+m.id+'\')" style="font-size:11px;color:var(--accent);background:transparent;border:1px solid var(--border2);padding:3px 9px;border-radius:6px;cursor:pointer;margin-left:5px">Warm again</button>';
    } else {
      badge=m.opt_in?'<span style="'+warmMuted+';background:var(--accent-l);color:var(--accent)">Pool receiver</span>':'<span style="'+warmMuted+';background:var(--bg3);color:var(--text3)">Not warming</span>';
      if(isAdmin)actions=m.connected
        ?'<button onclick="openWarmupStart(\''+m.id+'\')" style="font-size:11px;color:#fff;background:var(--accent);border:0;padding:4px 11px;border-radius:6px;cursor:pointer;margin-left:5px">Start warm-up</button>'
        :'<span style="font-size:10.5px;color:var(--amber)" title="Connect this mailbox under the user\'s Email IDs first">⚠ not connected</span>';
    }
    var meta=[];
    if(m.warmup_status==='warming')meta.push(m.sent_today+'/'+(m.target_today||0)+' today');
    if(m.health&&m.health.inbox_placement_pct!=null)meta.push('inbox '+m.health.inbox_placement_pct+'%');
    if(m.health&&m.health.rescued)meta.push(m.health.rescued+' rescued');
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap">'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">'+htmlEsc(m.display_name||m.email)+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(m.email)+(m.owner?' · '+htmlEsc(m.owner):'')+(meta.length?' · '+meta.join(' · '):'')+'</div></div>'+
      badge+actions+
    '</div>';
  }).join('')||'<div style="padding:14px;color:var(--text3);font-size:13px">No active mailboxes.</div>';
  var warmExtra=(isAdmin?'<button onclick="runWarmupTick()" style="font-size:11px;color:var(--text2);background:transparent;border:1px solid var(--border2);padding:4px 11px;border-radius:6px;cursor:pointer">'+(wtick==='running'?'Running…':'▶ Run warm-up now')+'</button>':'')+
    (wtick&&wtick!=='running'?'<span style="font-size:11px;color:var(--text3);margin-left:8px">'+(wtick.off?'engine off — apply migration 009':'sent '+(wtick.sent||0)+' · replies '+(wtick.replied||0)+' · rescued '+(wtick.rescued||0)+' · pool '+(wtick.pool||0))+'</span>':'');
  var readyColors={none:'var(--red)',minimal:'var(--amber)',ok:'var(--accent)',good:'var(--green)'};
  var rd=w&&w.readiness;
  var readyBanner=rd?'<div style="padding:9px 14px;font-size:11.5px;border-bottom:1px solid var(--border);background:'+readyColors[rd.level]+'14;color:'+(readyColors[rd.level]||'var(--text2)')+';font-weight:600">'+
    (w.pool_count||0)+' mailbox'+((w.pool_count||0)===1?'':'es')+' · '+(w.pool_domains||0)+' domain'+((w.pool_domains||0)===1?'':'s')+' in pool — '+htmlEsc(rd.note)+'</div>':'';
  var warmSub='<div style="padding:10px 14px;font-size:11.5px;color:var(--text3);border-bottom:1px solid var(--border)">Warm-up sends real email between your connected mailboxes and holds short conversations to build reputation, then graduates them to outreach. Every mailbox that participates — the ones you warm <b>and</b> their partners — must be added and connected here.</div>'+readyBanner;

  // ── Domain authentication & blacklists ──
  if(STATE.domainHealth===undefined&&!STATE._dhLoading)loadDomainHealth(false);
  var dh=STATE.domainHealth;
  var dhColors={good:'var(--green)',ok:'var(--accent)',warn:'var(--amber)',bad:'var(--red)',unknown:'var(--text3)'};
  function dhChip(label,state){ var c=state==='pass'?'var(--green)':state==='fail'?'var(--red)':state==='warn'?'var(--amber)':'var(--text3)'; var sym=state==='pass'?'✓':state==='fail'?'✗':state==='warn'?'!':'?'; return '<span style="font-size:10.5px;padding:2px 7px;border-radius:6px;font-weight:700;background:'+c+'1a;color:'+c+'">'+label+' '+sym+'</span>'; }
  var dhRows;
  if(dh===undefined||dh==='loading')dhRows='<div style="padding:14px;color:var(--text3);font-size:13px">Checking domains (DNS lookups)…</div>';
  else if(!dh.domains||!dh.domains.length)dhRows='<div style="padding:14px;color:var(--text3);font-size:13px">No sending domains found — add mailboxes first.</div>';
  else dhRows=dh.domains.map(function(D){
    var spfState=D.spf.found===true?(D.spf.ok?'pass':'warn'):(D.spf.found===false?'fail':'unknown');
    var dkimState=D.dkim.found===true?'pass':(D.dkim.found===false?'fail':'unknown');
    var dmarcState=D.dmarc.found===true?(D.dmarc.ok?'pass':'warn'):(D.dmarc.found===false?'fail':'unknown');
    var listed=D.blacklist&&D.blacklist.listed&&D.blacklist.listed.length;
    var blState=listed?'fail':'pass';
    var open=STATE._dhOpen&&STATE._dhOpen[D.domain];
    var findings=D.findings||[];
    var findingsHtml=open?'<div style="padding:8px 14px 10px;background:var(--bg3)">'+(findings.length?findings.map(function(f){
      var fc=f.severity==='high'?'var(--red)':f.severity==='warn'?'var(--amber)':'var(--text3)';
      return '<div style="margin-bottom:9px"><div style="font-size:12px;font-weight:600;color:'+fc+'">'+htmlEsc(f.area)+' — '+htmlEsc(f.detail)+'</div>'+(f.cure?'<div style="font-size:11px;color:var(--text2);margin-top:3px;font-family:ui-monospace,monospace;white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px">'+htmlEsc(f.cure)+'</div>':'')+'</div>';
    }).join(''):'<div style="font-size:12px;color:var(--green)">All checks passed — nothing to fix.</div>')+'</div>':'';
    return '<div style="border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;align-items:center;gap:8px;padding:9px 14px;flex-wrap:wrap">'+
        '<div style="flex:1;min-width:120px"><span style="font-size:13px;font-weight:600">'+htmlEsc(D.domain)+'</span> <span style="font-size:11px;color:'+(dhColors[D.level]||'var(--text3)')+';font-weight:700;margin-left:4px">'+(D.score==null?'unknown':D.score+'/100')+'</span></div>'+
        dhChip('SPF',spfState)+dhChip('DKIM',dkimState)+dhChip('DMARC',dmarcState)+dhChip(listed?'Blacklisted':'Blacklist',blState)+
        '<a onclick="toggleDomainFindings(\''+D.domain+'\')" style="cursor:pointer;font-size:11px;color:var(--accent);white-space:nowrap">'+(open?'Hide':'Fixes'+(findings.length?' ('+findings.length+')':''))+'</a>'+
      '</div>'+findingsHtml+
    '</div>';
  }).join('');
  var dhExtra='<button onclick="refreshDomainHealth()" style="font-size:11px;color:var(--text2);background:transparent;border:1px solid var(--border2);padding:4px 11px;border-radius:6px;cursor:pointer">↻ Re-check</button>';
  var dhSub='<div style="padding:10px 14px;font-size:11.5px;color:var(--text3);border-bottom:1px solid var(--border)">SPF, DKIM, DMARC and blacklist status for every sending domain. Fix these <b>before</b> warming — broken authentication or a blacklisting lands you in spam no matter how well a mailbox is warmed. Cached ~15 min.</div>';

  var tplRows=tpls.length?tpls.map(function(t){
    var hasSample=t.sample&&t.sample.subject;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border)">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:600">'+htmlEsc(t.label||t.variant)+'</div>'+
        (hasSample?'<div style="font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">'+htmlEsc(t.sample.subject)+'</div>':'')+
      '</div>'+
      (hasSample?'<button onclick="previewTemplateSample(\''+t.variant+'\')" style="font-size:11px;color:var(--accent);background:transparent;border:1px solid var(--border2);padding:4px 10px;border-radius:6px;cursor:pointer;white-space:nowrap">Preview</button>':'')+
      '<div style="font-size:12px;color:var(--text3);white-space:nowrap">'+t.sent+' sent · '+t.replied+' replied</div>'+
      '<div style="font-size:14px;font-weight:700;color:'+(t.reply_rate>=5?'var(--green)':t.reply_rate>0?'var(--accent)':'var(--text3)')+';min-width:54px;text-align:right">'+t.reply_rate+'%</div>'+
    '</div>';
  }).join(''):'<div style="padding:14px;color:var(--text3);font-size:13px">No sent emails with variants yet in this window.</div>';
  var spamHtml='';
  if(sr){ var col=sr.level==='risk'?'var(--red)':sr.level==='warn'?'var(--amber)':'var(--green)'; spamHtml='<div style="margin-top:10px;padding:10px 12px;border:1px solid '+col+';border-radius:8px">'+'<div style="font-weight:700;color:'+col+';font-size:13px">Spam score: '+sr.score+'/100 ('+sr.level+')</div>'+(sr.warnings&&sr.warnings.length?'<ul style="margin:6px 0 0 16px;font-size:12px;color:var(--text2)">'+sr.warnings.map(function(w){return '<li>'+htmlEsc(w)+'</li>';}).join('')+'</ul>':'<div style="font-size:12px;color:var(--text3);margin-top:4px">Looks clean.</div>')+'</div>'; }
  function card(title,inner,extra){ return '<div style="margin-bottom:20px"><div style="font-weight:600;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'+title+(extra||'')+'</div><div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+inner+'</div></div>'; }
  return '<div class="page">'+
    '<div class="ph"><div class="flex jb aic">'+
      '<div><div class="ptitle">Deliverability & Replies</div><div class="psub">Reputation, reply rate & content health</div></div>'+
      dayFilter+
    '</div></div>'+
    statsRow+
    card('Mailbox health (outreach cap & auto-pause)', mbViewToggle+(mbRows||'<div style="padding:14px;color:var(--text3);font-size:13px">No active mailboxes for this scope.</div>'))+
    card('Warm-up pool'+(w&&w.pool_count?' · '+w.pool_count+' active':''), warmSub+warmRows, warmExtra)+
    card('Domain authentication & blacklists', dhSub+dhRows, dhExtra)+
    card('Reply rate by template', tplRows)+
    card('Spam-content checker',
      '<div style="padding:14px">'+
        '<div style="font-size:12.5px;color:var(--text3);margin-bottom:10px">Paste a subject + body to check it for things that hurt deliverability before you send: spam-trigger words, too many links/images, ALL-CAPS, excess exclamation marks, subject/body length, and a missing opt-out line.</div>'+
        '<input id="spamSubj" class="inp" placeholder="Subject" value="'+htmlEsc(STATE.spamSubj||'')+'" oninput="STATE.spamSubj=this.value" style="margin-bottom:8px">'+
        '<textarea id="spamBody" class="inp" placeholder="Paste an email body to score it" oninput="STATE.spamBody=this.value" style="width:100%;min-height:90px;font-family:inherit">'+htmlEsc(STATE.spamBody||'')+'</textarea>'+
        '<button onclick="runSpamCheck()" style="margin-top:8px;background:var(--accent);color:#fff;border:0;padding:7px 16px;border-radius:8px;font-size:13px;cursor:pointer">Check</button>'+spamHtml+
      '</div>')+
  '</div>';
}


// ── Background engine card (Admin page) ─────────────────────────────────────
// futé's recurring work (follow-ups, reply/bounce sweeps, workflow ticks,
// warm-up, lead sourcing) runs on a schedule. Until this card existed there was
// NO way to see any of it from inside the app — if the engine stopped, the only
// symptom was follow-ups quietly not going out, and you'd have to go to GitHub
// to find out why. That is a bad answer for something meant to run unattended.
//
// The important distinction this card draws: CRON_KEY being set is not the same
// as the heartbeat working. The key has to match on both sides (Render and the
// GitHub Actions secret); a mismatch makes /cron/tick 404 and nothing runs. So
// the status is driven by whether a ping has ACTUALLY ARRIVED recently, not by
// whether a variable exists.
//
// `last_cron_ping_at` is the arrival of the ping itself, not the last job it
// happened to run. Those are different facts, and reading the second as the
// first is what made this card cry wolf: a ping that finds nothing due runs
// nothing and leaves no job record, which is the NORMAL case while the app is
// awake and its in-process timers are doing the work first. The card went amber
// exactly when the system was healthiest.
function loadEngineStatus(force){
  if(STATE._engineLoading)return;
  if(STATE.engineStatus&&!force)return;
  STATE._engineLoading=true;
  apiGet('/admin/engine/status').then(function(r){
    STATE.engineStatus=r||{};
    STATE._engineLoading=false;
    scheduleRender();
  }).catch(function(){
    // A failure here must never blank the Admin page — the card degrades to
    // "couldn't read status" and everything else on the page still works.
    STATE.engineStatus={_error:true};
    STATE._engineLoading=false;
    scheduleRender();
  });
}
window.refreshEngineStatus=function(){STATE.engineStatus=null;loadEngineStatus(true);render();};

function engineAgo(iso){
  if(!iso)return 'never';
  var secs=Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(secs<0)secs=0;
  if(secs<60)return secs+'s ago';
  if(secs<3600)return Math.floor(secs/60)+'m ago';
  if(secs<86400)return Math.floor(secs/3600)+'h ago';
  return Math.floor(secs/86400)+'d ago';
}
function engineEvery(ms){
  if(!ms)return '—';
  var m=Math.round(ms/60000);
  if(m<60)return 'every '+m+'m';
  var h=Math.round(m/60);
  return 'every '+h+'h';
}
window.runEngineJob=function(job){
  showToast('Running '+job+'…','info');
  apiPost('/admin/engine/run/'+encodeURIComponent(job),{}).then(function(r){
    if(r&&r.ok===false&&r.error){showToast(job+' failed: '+r.error,'error');}
    else{showToast(job+' finished','success');}
    STATE.engineStatus=null;loadEngineStatus(true);
  }).catch(function(e){
    showToast('Could not run '+job+': '+(e&&e.message||e),'error');
  });
};

function renderEngineCard(isAdmin){
  var s=STATE.engineStatus;
  if(s===undefined||s===null){
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 16px;margin-bottom:16px;font-size:13px;color:var(--text3)">Checking background engine…</div>';
  }
  if(s._error){
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 16px;margin-bottom:16px;font-size:13px;color:var(--text3)">'+
      'Background engine status unavailable. <button onclick="refreshEngineStatus()" style="border:0;background:none;color:var(--accent);cursor:pointer;font-size:13px">Retry</button></div>';
  }

  var jobs=s.jobs||[];
  // Three distinct states, because they need three different actions:
  //   healthy  — pings arriving, nothing to do
  //   no key   — CRON_KEY unset, setup never done
  //   silent   — key is set but no ping has arrived: the two values disagree
  var state = s.heartbeat_healthy ? 'healthy' : (s.cron_configured ? 'silent' : 'unset');
  var tone = state==='healthy'
    ? {bg:'var(--card)',bd:'var(--border)',dot:'var(--green)',fg:'var(--text)'}
    : state==='silent'
      ? {bg:'#fffbeb',bd:'#fcd34d',dot:'#d97706',fg:'#92400e'}
      : {bg:'#fef2f2',bd:'#fca5a5',dot:'#dc2626',fg:'#b91c1c'};
  var headline = state==='healthy'
    ? 'Background engine: running'
    : state==='silent'
      ? 'Background engine: not receiving its heartbeat'
      : 'Background engine: not set up';
  var explain = state==='healthy'
    ? 'Last heartbeat '+engineAgo(s.last_cron_ping_at)+'. Jobs run on their own schedule whether or not anyone is using the app.'
    : state==='silent'
      ? 'CRON_KEY is set on the server, but no heartbeat has arrived in over an hour. The usual cause is the value in Render and the GitHub Actions secret not matching exactly.'
      : 'CRON_KEY is not set, so the heartbeat cannot sign in. Scheduled work only runs while somebody has the app open.';

  var overdue=jobs.filter(function(j){return j.overdue;}).length;

  var rows=jobs.map(function(j){
    var lateTone=j.running?'var(--accent)':(j.overdue?'#b45309':'var(--text3)');
    var lateLbl=j.running?'running now':(j.last_run_at?engineAgo(j.last_run_at):'never run');
    return '<div style="display:flex;align-items:center;gap:12px;padding:9px 14px;border-top:1px solid var(--border)">'+
      '<span style="width:8px;height:8px;border-radius:50%;flex:none;background:'+(j.running?'var(--accent)':(j.overdue?'#f59e0b':'var(--green)'))+'"></span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:600">'+htmlEsc(j.description||j.job)+'</div>'+
        '<div style="font-size:11.5px;color:var(--text3)">'+htmlEsc(j.job)+' · '+engineEvery(j.every_ms)+'</div>'+
      '</div>'+
      '<div style="font-size:12px;color:'+lateTone+';font-weight:'+(j.overdue?'600':'400')+';white-space:nowrap">'+lateLbl+'</div>'+
      (isAdmin?'<button onclick="runEngineJob(\''+htmlEsc(j.job)+'\')" style="padding:4px 10px;border:1px solid var(--border2);background:var(--card);border-radius:7px;font-size:12px;cursor:pointer;color:var(--text2)">Run now</button>':'')+
    '</div>';
  }).join('');

  var open=!!STATE.engineExpanded;
  return '<div style="background:'+tone.bg+';border:1px solid '+tone.bd+';border-radius:var(--r2);margin-bottom:16px;overflow:hidden">'+
    '<div style="padding:14px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:220px">'+
        '<div style="font-weight:700;font-size:14px;color:'+tone.fg+';display:flex;align-items:center;gap:8px">'+
          '<span style="width:9px;height:9px;border-radius:50%;background:'+tone.dot+';display:inline-block"></span>'+
          htmlEsc(headline)+
          (overdue?'<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;background:#fef3c7;color:#92400e">'+overdue+' overdue</span>':'')+
        '</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:3px">'+htmlEsc(explain)+'</div>'+
      '</div>'+
      '<button onclick="refreshEngineStatus()" style="padding:7px 14px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:13px;color:var(--text2);cursor:pointer">Refresh</button>'+
      '<button onclick="STATE.engineExpanded='+(open?'false':'true')+';render()" style="padding:7px 14px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:13px;color:var(--text2);cursor:pointer">'+(open?'Hide jobs':'Show '+jobs.length+' jobs')+'</button>'+
    '</div>'+
    (open?'<div style="background:var(--card)">'+(rows||'<div style="padding:14px;font-size:13px;color:var(--text3)">No jobs registered.</div>')+'</div>':'')+
  '</div>';
}
