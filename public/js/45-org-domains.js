// ── COMPANY DOMAINS (Admin) ─────────────────────────────────────────────────
// Claiming your company's email domain is what lets PACE recognise your people
// when they sign in with Microsoft or Google.
//
// The UI is deliberately blunt that a claim proves NOTHING until it is verified.
// An unverified claim that looked "done" would be worse than useless: the whole
// reason for DNS proof is that otherwise anyone could claim microsoft.com and
// collect every Microsoft employee who signs in.
function loadOrgDomains(force){
  if(STATE._odLoading)return;
  if(STATE.orgDomains&&!force)return;
  STATE._odLoading=true;
  apiGet('/org/domains').then(function(r){
    STATE.orgDomains=r||{domains:[]};
    STATE._odLoading=false;scheduleRender();
  }).catch(function(){
    STATE.orgDomains={_error:true,domains:[]};
    STATE._odLoading=false;scheduleRender();
  });
}
window.refreshOrgDomains=function(){STATE.orgDomains=null;loadOrgDomains(true);render();};

window.claimOrgDomain=function(){
  var el=document.getElementById('od-input');
  var v=el?el.value.trim():'';
  if(!v){showToast('Enter your company domain, e.g. acme.com','warning');return;}
  apiPost('/org/domains',{domain:v}).then(function(r){
    if(el)el.value='';
    STATE.odInstructions=r.instructions||null;
    STATE.orgDomains=null;loadOrgDomains(true);
    showToast('Domain claimed. Now add the DNS record to verify it.','success');
  }).catch(function(e){showToast(e.message||'Could not claim that domain','error');});
};

window.verifyOrgDomain=function(id){
  showToast('Checking DNS…','info');
  apiPost('/org/domains/'+encodeURIComponent(id)+'/verify',{}).then(function(r){
    if(r.verified){showToast('Verified — this domain is now yours.','success');STATE.odInstructions=null;}
    else{STATE.odInstructions=r.instructions||STATE.odInstructions;showToast(r.message||'Not verified yet','warning');}
    STATE.orgDomains=null;loadOrgDomains(true);
  }).catch(function(e){showToast(e.message||'Verification failed','error');});
};

window.showOrgDomainInstructions=function(id){
  apiGet('/org/domains/'+encodeURIComponent(id)+'/instructions').then(function(r){
    STATE.odInstructions=r;render();
  }).catch(function(e){showToast(e.message||'Could not load instructions','error');});
};

window.removeOrgDomain=function(id,domain){
  if(!confirm('Remove '+domain+'? People on this domain will no longer be recognised automatically.'))return;
  apiDelete('/org/domains/'+encodeURIComponent(id)).then(function(){
    STATE.orgDomains=null;loadOrgDomains(true);showToast('Domain removed','success');
  }).catch(function(e){showToast(e.message||'Could not remove','error');});
};

window.toggleOrgDomainAutoJoin=function(id,on){
  apiPatch('/org/domains/'+encodeURIComponent(id),{auto_join:!!on}).then(function(){
    STATE.orgDomains=null;loadOrgDomains(true);
  }).catch(function(e){showToast(e.message||'Could not update','error');});
};

// ── COMPANY EMAIL SETUP (owner, 12 Oct, D-0120, R-200) ──────────────────────────────────────────────────────────────
// The checklist for one claimed domain: where its mail lives, the exact SPF / DMARC records to paste, whether DKIM is on —
// each CHECKED against DNS by the server (services/email-setup.js). The customer's admin presses "Copy for your IT person" and
// sends the note; once the records are in, "Check again" turns each item green. Nothing is filtered or decided here.
window.openEmailSetup=function(id){
  STATE.emailSetup={id:id,loading:true,data:null,err:'',selector:''};
  render();loadEmailSetup();
};
function loadEmailSetup(){
  var s=STATE.emailSetup;if(!s)return;
  s.loading=true;s.err='';
  apiGet('/org/domains/'+encodeURIComponent(s.id)+'/email-setup'+(s.selector?'?dkim_selector='+encodeURIComponent(s.selector):'')).then(function(r){
    if(STATE.emailSetup!==s)return;
    s.loading=false;s.data=r;scheduleRender();
  }).catch(function(e){
    if(STATE.emailSetup!==s)return;
    s.loading=false;s.err=(e&&e.message)||'Could not check this domain';scheduleRender();
  });
}
window.closeEmailSetup=function(){STATE.emailSetup=null;render();};
window.recheckEmailSetup=function(){
  var s=STATE.emailSetup;if(!s)return;
  var el=document.getElementById('es-selector');if(el)s.selector=String(el.value||'').trim();
  s.data=null;loadEmailSetup();render();
};
function copyText(text,okMsg){
  function fallback(){
    var t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();
    var done=false;try{done=document.execCommand('copy');}catch(e){}
    document.body.removeChild(t);showToast(done?okMsg:'Could not copy — select the text and copy it by hand','warning');
  }
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){showToast(okMsg,'success');},fallback);
  else fallback();
}
window.copyEmailSetupIT=function(){var d=STATE.emailSetup&&STATE.emailSetup.data;if(d)copyText(d.it_text,'Copied — paste it into an email to your IT person');};
window.copyEmailSetupRecord=function(i){
  var d=STATE.emailSetup&&STATE.emailSetup.data;var it=d&&d.items[i];
  if(it&&it.record)copyText(it.record.value,'Value copied');
};
function renderEmailSetupPanel(){
  var s=STATE.emailSetup;if(!s)return '';
  var head=function(sub,actions){
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
      '<div><div class="fs-14 fw6">Email setup'+(s.data?' for '+htmlEsc(s.data.domain):'')+'</div>'+(sub?'<div class="fs-12 c-text3">'+sub+'</div>':'')+'</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+actions+'</div></div>';
  };
  var closeBtn='<button class="btn btn-outline btn-sm" onclick="closeEmailSetup()">Close</button>';
  if(s.loading&&!s.data)return '<div style="border-top:1px solid var(--border);padding:14px;background:var(--bg)">'+head('Checking the domain’s DNS…',closeBtn)+'</div>';
  if(s.err)return '<div style="border-top:1px solid var(--border);padding:14px;background:var(--bg)">'+head('',closeBtn)+'<div class="fs-13 c-red" role="alert">'+htmlEsc(s.err)+'</div></div>';
  var d=s.data;if(!d)return '';
  var items=d.items.map(function(it,i){
    var mark=it.status==='done'?'<span class="c-green fw6">✓</span>':(it.status==='info'?'<span class="c-text3 fw6">i</span>':'<span class="c-amber fw6">○</span>');
    var rec=it.record?
      '<div class="card cp" style="margin-top:8px"><div class="fs-12_5" style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;align-items:center">'+
        '<div class="c-text3">Type</div><div><code>'+htmlEsc(it.record.type)+'</code></div>'+
        '<div class="c-text3">Host</div><div><code>'+htmlEsc(it.record.host)+'</code> <span class="c-text3">'+(it.record.host==='@'?'(the bare domain — some DNS screens call it “@”, others leave it blank)':'(some DNS screens want “'+htmlEsc(it.record.host)+'.'+htmlEsc(d.domain)+'” instead)')+'</span></div>'+
        '<div class="c-text3">Value</div><div style="word-break:break-all"><code>'+htmlEsc(it.record.value)+'</code></div></div>'+
        (it.record.replaces?'<div class="fs-12 c-amber" style="margin-top:6px">Change the record you already have — a domain may have only one.</div>':'')+
        '<div style="margin-top:8px"><button class="btn btn-outline btn-sm" onclick="copyEmailSetupRecord('+i+')">Copy value</button></div></div>':'';
    var steps=(it.steps||[]).map(function(t){return '<div class="fs-12_5 c-text2" style="margin-top:6px">• '+htmlEsc(t)+'</div>';}).join('');
    var sel=(it.id==='dkim'&&it.status==='todo')?
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input id="es-selector" class="inp" style="flex:1;min-width:180px" placeholder="DKIM selector, if your provider used its own name" value="'+htmlEsc(s.selector||'')+'"/></div>':'';
    return '<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border)"><div style="width:18px;text-align:center">'+mark+'</div>'+
      '<div style="flex:1;min-width:0"><div class="fs-13 fw6">'+htmlEsc(it.title)+'</div><div class="fs-12_5 c-text2">'+htmlEsc(it.summary)+'</div>'+rec+steps+sel+'</div></div>';
  }).join('');
  var sub=d.done+' of '+d.total+' done'+(s.loading?' · checking again…':'');
  return '<div style="border-top:1px solid var(--border);padding:14px;background:var(--bg)">'+
    head(sub,'<button class="btn btn-primary btn-sm" onclick="copyEmailSetupIT()" title="A plain note with only what is still to do, and the exact records">Copy for your IT person</button>'+
      '<button class="btn btn-outline btn-sm" '+(s.loading?'disabled ':'')+'onclick="recheckEmailSetup()">Check again</button>'+closeBtn)+items+
    '<div class="fs-11_5 c-text3" style="margin-top:8px">The records live where your domain is managed (often the company that sold you the domain). Changes can take up to an hour to show.</div></div>';
}

function renderOrgDomainsCard(){
  var s=STATE.orgDomains;
  if(s===undefined||s===null){loadOrgDomains();return '<div class="card cp mb4 fs-13 c-text3">Loading company domains…</div>';}
  if(s._error)return '';
  if(s.enabled===false){
    return '<div class="card cp mb4 fs-13 c-text3">'+
      'Company domains are not enabled on this deployment yet.</div>';
  }

  var list=s.domains||[];
  var rows=list.map(function(d){
    var verified=!!d.verified_at;
    var pill=verified
      ? '<span class="fs-11 c-green" style="font-weight:700;padding:3px 9px;border-radius:8px;background:var(--green-l)">✓ Verified</span>'
      : '<span class="fs-11" style="font-weight:700;padding:3px 9px;border-radius:8px;background:#fef3c7;color:#92400e">Not verified</span>';
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--border);flex-wrap:wrap">'+
      '<div style="flex:1;min-width:180px">'+
        '<div class="fs-13_5" style="font-weight:600">'+htmlEsc(d.domain)+'</div>'+
        '<div class="fs-11_5 c-text3">'+
          (verified
            ? 'People with an address here are recognised as yours.'
            : htmlEsc(d.last_error||'Add the DNS record, then press Verify.'))+
        '</div>'+
      '</div>'+
      pill+
      '<button onclick="openEmailSetup(\''+d.id+'\')" class="btn btn-outline btn-sm" title="Where your mail lives, and the records that keep it out of spam">Email setup</button>'+
      (verified
        ? '<label class="fs-12 c-text2" style="display:flex;align-items:center;gap:6px;cursor:pointer" title="Anyone signing in with an address on this domain joins automatically, with no invitation">'+
            '<input type="checkbox" '+(d.auto_join?'checked':'')+' onchange="toggleOrgDomainAutoJoin(\''+d.id+'\',this.checked)" style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer"/> Auto-join'+
          '</label>'
        : '<button onclick="verifyOrgDomain(\''+d.id+'\')" style="padding:5px 12px;border:1px solid var(--border2);background:var(--card);border-radius:7px;font-size:13px;cursor:pointer">Verify</button>'+
          '<button onclick="showOrgDomainInstructions(\''+d.id+'\')" style="padding:5px 12px;border:0;background:none;color:var(--accent);font-size:13px;cursor:pointer;text-decoration:underline">Show record</button>')+
      '<button onclick="removeOrgDomain(\''+d.id+'\',\''+htmlEsc(d.domain)+'\')" style="padding:5px 10px;border:0;background:none;color:var(--red);font-size:13px;cursor:pointer">Remove</button>'+
    '</div>';
  }).join('');

  var inst=STATE.odInstructions;
  var instBlock=inst?
    '<div style="border-top:1px solid var(--border);padding:14px;background:var(--bg)">'+
      '<div class="fs-13" style="font-weight:700;margin-bottom:8px">Add this record at your DNS provider</div>'+
      '<div class="fs-12_5" style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;align-items:center">'+
        '<div class="c-text3">Type</div><div><code>'+htmlEsc(inst.record_type)+'</code></div>'+
        '<div class="c-text3">Host</div><div><code>'+htmlEsc(inst.host)+'</code> <span class="c-text3">(often shown as “@”)</span></div>'+
        '<div class="c-text3">Value</div><div style="word-break:break-all"><code>'+htmlEsc(inst.value)+'</code></div>'+
      '</div>'+
      '<div class="fs-11_5 c-text3" style="margin-top:10px;line-height:1.5">'+htmlEsc(inst.note)+'</div>'+
    '</div>':'';

  return '<div class="card cp mb4" style="padding:0;overflow:hidden">'+
    '<div style="padding:14px">'+
      '<div class="fs-14" style="font-weight:700">Company domains</div>'+
      '<div class="fs-12 c-text3" style="margin-top:3px;line-height:1.5">'+
        'Claim your company’s email domain so your people are recognised when they sign in with Microsoft or Google. '+
        'A claim does nothing until you prove you own the domain with a DNS record.'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'+
        '<input class="inp" id="od-input" placeholder="acme.com" style="flex:1;min-width:200px"/>'+
        '<button class="btn btn-primary" onclick="claimOrgDomain()">Claim domain</button>'+
        '<button onclick="refreshOrgDomains()" class="fs-13 c-text2" style="padding:8px 14px;background:var(--card);border:1px solid var(--border2);border-radius:8px;cursor:pointer">Refresh</button>'+
      '</div>'+
    '</div>'+
    (rows||'<div class="fs-13 c-text3" style="border-top:1px solid var(--border);padding:14px">No domains claimed yet.</div>')+
    instBlock+
    renderEmailSetupPanel()+
  '</div>';
}
