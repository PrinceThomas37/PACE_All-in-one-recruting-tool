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

function renderOrgDomainsCard(){
  var s=STATE.orgDomains;
  if(s===undefined||s===null){loadOrgDomains();return '<div class="card cp mb4" style="font-size:13px;color:var(--text3)">Loading company domains…</div>';}
  if(s._error)return '';
  if(s.enabled===false){
    return '<div class="card cp mb4" style="font-size:13px;color:var(--text3)">'+
      'Company domains are not enabled on this deployment yet.</div>';
  }

  var list=s.domains||[];
  var rows=list.map(function(d){
    var verified=!!d.verified_at;
    var pill=verified
      ? '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;background:var(--green-l);color:var(--green)">✓ Verified</span>'
      : '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;background:#fef3c7;color:#92400e">Not verified</span>';
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--border);flex-wrap:wrap">'+
      '<div style="flex:1;min-width:180px">'+
        '<div style="font-size:13.5px;font-weight:600">'+htmlEsc(d.domain)+'</div>'+
        '<div style="font-size:11.5px;color:var(--text3)">'+
          (verified
            ? 'People with an address here are recognised as yours.'
            : htmlEsc(d.last_error||'Add the DNS record, then press Verify.'))+
        '</div>'+
      '</div>'+
      pill+
      (verified
        ? '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer" title="Anyone signing in with an address on this domain joins automatically, with no invitation">'+
            '<input type="checkbox" '+(d.auto_join?'checked':'')+' onchange="toggleOrgDomainAutoJoin(\''+d.id+'\',this.checked)" style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer"/> Auto-join'+
          '</label>'
        : '<button onclick="verifyOrgDomain(\''+d.id+'\')" style="padding:5px 12px;border:1px solid var(--border2);background:var(--card);border-radius:7px;font-size:12.5px;cursor:pointer">Verify</button>'+
          '<button onclick="showOrgDomainInstructions(\''+d.id+'\')" style="padding:5px 12px;border:0;background:none;color:var(--accent);font-size:12.5px;cursor:pointer;text-decoration:underline">Show record</button>')+
      '<button onclick="removeOrgDomain(\''+d.id+'\',\''+htmlEsc(d.domain)+'\')" style="padding:5px 10px;border:0;background:none;color:var(--red);font-size:12.5px;cursor:pointer">Remove</button>'+
    '</div>';
  }).join('');

  var inst=STATE.odInstructions;
  var instBlock=inst?
    '<div style="border-top:1px solid var(--border);padding:14px;background:var(--bg)">'+
      '<div style="font-size:13px;font-weight:700;margin-bottom:8px">Add this record at your DNS provider</div>'+
      '<div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:12.5px;align-items:center">'+
        '<div style="color:var(--text3)">Type</div><div><code>'+htmlEsc(inst.record_type)+'</code></div>'+
        '<div style="color:var(--text3)">Host</div><div><code>'+htmlEsc(inst.host)+'</code> <span style="color:var(--text3)">(often shown as “@”)</span></div>'+
        '<div style="color:var(--text3)">Value</div><div style="word-break:break-all"><code>'+htmlEsc(inst.value)+'</code></div>'+
      '</div>'+
      '<div style="font-size:11.5px;color:var(--text3);margin-top:10px;line-height:1.5">'+htmlEsc(inst.note)+'</div>'+
    '</div>':'';

  return '<div class="card cp mb4" style="padding:0;overflow:hidden">'+
    '<div style="padding:14px">'+
      '<div style="font-weight:700;font-size:14px">Company domains</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:3px;line-height:1.5">'+
        'Claim your company’s email domain so your people are recognised when they sign in with Microsoft or Google. '+
        'A claim does nothing until you prove you own the domain with a DNS record.'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'+
        '<input class="inp" id="od-input" placeholder="acme.com" style="flex:1;min-width:200px"/>'+
        '<button class="btn btn-primary" onclick="claimOrgDomain()">Claim domain</button>'+
        '<button onclick="refreshOrgDomains()" style="padding:8px 14px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:13px;color:var(--text2);cursor:pointer">Refresh</button>'+
      '</div>'+
    '</div>'+
    (rows||'<div style="border-top:1px solid var(--border);padding:14px;font-size:13px;color:var(--text3)">No domains claimed yet.</div>')+
    instBlock+
  '</div>';
}
