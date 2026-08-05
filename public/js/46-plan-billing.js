// ── PLAN & BILLING (Admin) ──────────────────────────────────────────────────
// What this workspace is on, what it is using, and how to change it.
//
// Two things this screen is careful about:
//
//   1. IT NEVER PRETENDS A LIMIT IS A DELETION. Being over a limit — after a
//      downgrade, or because we changed a number — means you cannot ADD more.
//      Nothing is removed, hidden or locked. The over-limit row says exactly
//      that, because "3 / 2 team members" with a red bar and no explanation
//      reads like something is about to be taken away.
//   2. IT NEVER SHOWS A PRICE WE HAVE NOT SET. Pricing is the owner's decision.
//      Until it is filled in (services/plans.js), the tiers show their limits
//      and say pricing is not published yet, rather than displaying an invented
//      number that looks decided.
function loadPlan(force){
  if(STATE._planLoading)return;
  if(STATE.orgPlan&&!force)return;
  STATE._planLoading=true;
  apiGet('/org/plan').then(function(r){
    STATE.orgPlan=r||null;STATE._planLoading=false;scheduleRender();
  }).catch(function(){
    STATE.orgPlan={_error:true};STATE._planLoading=false;scheduleRender();
  });
}
window.refreshPlan=function(){STATE.orgPlan=null;STATE.allPlans=null;loadPlan(true);render();};

function loadAllPlans(){
  if(STATE._plansLoading||STATE.allPlans)return;
  STATE._plansLoading=true;
  apiGet('/plans').then(function(r){
    STATE.allPlans=r||null;STATE._plansLoading=false;scheduleRender();
  }).catch(function(){STATE.allPlans={plans:[]};STATE._plansLoading=false;});
}

window.togglePlanPicker=function(){
  STATE.showPlanPicker=!STATE.showPlanPicker;
  if(STATE.showPlanPicker)loadAllPlans();
  render();
};

window.startPlanCheckout=function(planId){
  apiPost('/org/billing/checkout',{plan:planId}).then(function(r){
    if(r&&r.url){window.location.href=r.url;return;}
    showToast('Could not start checkout.','error');
  }).catch(function(e){showToast(e.message||'Payments are not switched on yet.','warning');});
};

function planUsageRow(key,u){
  var unlimited=u.limit===null||u.limit===undefined;
  var pct=unlimited?0:Math.min(100,Math.round((u.used/Math.max(1,u.limit))*100));
  var bar=unlimited
    ? '<div style="font-size:12px;color:var(--text3)">Unlimited</div>'
    : '<div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden">'+
        '<div style="height:100%;width:'+pct+'%;background:'+(u.over?'var(--red)':pct>=80?'#f59e0b':'var(--accent)')+'"></div>'+
      '</div>';
  return '<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;border-top:1px solid var(--border)">'+
    '<div style="flex:1;min-width:150px">'+
      '<div style="font-size:13px;font-weight:600;text-transform:capitalize">'+htmlEsc(u.label||key)+'</div>'+
      (u.over
        ? '<div style="font-size:11.5px;color:var(--red);margin-top:2px">Over the plan limit — nothing has been removed, you just can’t add more until you upgrade.</div>'
        : '')+
    '</div>'+
    '<div style="width:180px">'+bar+'</div>'+
    '<div style="font-family:var(--mono);font-size:12.5px;color:var(--text2);min-width:80px;text-align:right">'+
      u.used+(unlimited?'':' / '+u.limit)+
    '</div>'+
  '</div>';
}

function renderPlanPicker(){
  var d=STATE.allPlans;
  if(!d)return '<div style="border-top:1px solid var(--border);padding:14px;font-size:13px;color:var(--text3)">Loading plans…</div>';
  var cards=(d.plans||[]).map(function(p){
    var current=STATE.orgPlan&&STATE.orgPlan.plan&&STATE.orgPlan.plan.id===p.id;
    var lim=p.limits||{};
    function n(v){return v===null||v===undefined?'Unlimited':v;}
    function plural(v,word){return n(v)+' '+word+(v===1?'':'s');}
    return '<div style="border:1.5px solid '+(current?'var(--accent)':'var(--border)')+';border-radius:10px;padding:14px;flex:1;min-width:190px">'+
      '<div style="font-weight:700;font-size:14px">'+htmlEsc(p.name)+(current?' <span style="font-size:10.5px;color:var(--accent)">· current</span>':'')+'</div>'+
      '<div style="font-size:11.5px;color:var(--text3);margin:4px 0 10px;line-height:1.45;min-height:32px">'+htmlEsc(p.blurb||'')+'</div>'+
      '<div style="font-size:12.5px;color:var(--text2);line-height:1.7">'+
        '<div>'+plural(lim.seats,'team member')+'</div>'+
        '<div>'+plural(lim.job_orders,'job order')+'</div>'+
        '<div>'+plural(lim.candidates,'candidate')+'</div>'+
        '<div>'+plural(lim.mailboxes,'mailbox').replace('mailboxs','mailboxes')+'</div>'+
      '</div>'+
      '<div style="margin-top:12px">'+
        (p.price!==null&&p.price!==undefined
          ? '<div style="font-size:15px;font-weight:700">'+htmlEsc(String(p.price))+'</div>'
          : '<div style="font-size:11.5px;color:var(--text3)">Pricing not published yet</div>')+
      '</div>'+
      (current||!p.purchasable
        ? ''
        : '<button class="btn btn-primary w100" style="justify-content:center;margin-top:10px" onclick="startPlanCheckout(\''+p.id+'\')">Choose '+htmlEsc(p.name)+'</button>')+
    '</div>';
  }).join('');

  return '<div style="border-top:1px solid var(--border);padding:14px;background:var(--bg)">'+
    '<div style="display:flex;gap:12px;flex-wrap:wrap">'+cards+'</div>'+
    (d.billing_enabled
      ? ''
      : '<div style="font-size:11.5px;color:var(--text3);margin-top:12px;line-height:1.5">'+
          'Online payment is not switched on for this deployment, so plans are changed by arrangement. '+
          'Everything above is already enforced.'+
        '</div>')+
  '</div>';
}

function renderPlanCard(){
  var s=STATE.orgPlan;
  if(s===undefined||s===null){loadPlan();return '<div class="card cp mb4" style="font-size:13px;color:var(--text3)">Loading plan…</div>';}
  if(s._error)return '';

  var plan=s.plan||{};
  var statusPill=s.status==='active'
    ? ''
    : '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;background:var(--red-l);color:var(--red);margin-left:8px">'+htmlEsc(s.status)+'</span>';

  var rows=Object.keys(s.usage||{}).map(function(k){return planUsageRow(k,s.usage[k]);}).join('');

  var features=Object.keys(s.features||{}).map(function(f){
    var on=s.features[f].enabled;
    return '<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:'+(on?'var(--text2)':'var(--text3)')+'">'+
      '<span style="color:'+(on?'var(--green)':'var(--text3)')+';font-weight:700">'+(on?'✓':'—')+'</span>'+
      htmlEsc(s.features[f].label)+
    '</div>';
  }).join('');

  return '<div class="card cp mb4" style="padding:0;overflow:hidden">'+
    '<div style="padding:14px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'+
        '<div>'+
          '<div style="font-weight:700;font-size:14px">Plan &amp; usage</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:3px">'+
            'You are on <strong style="color:var(--text2)">'+htmlEsc(plan.name||'—')+'</strong>'+statusPill+
            (plan.internal?' <span style="color:var(--text3)">· not a billed tier</span>':'')+
          '</div>'+
        '</div>'+
        '<div style="display:flex;gap:8px">'+
          (s.can_manage
            ? '<button class="btn btn-primary" onclick="togglePlanPicker()">'+(STATE.showPlanPicker?'Hide plans':'Change plan')+'</button>'
            : '')+
          '<button onclick="refreshPlan()" style="padding:8px 14px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:13px;color:var(--text2);cursor:pointer">Refresh</button>'+
        '</div>'+
      '</div>'+
      (features?'<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px">'+features+'</div>':'')+
    '</div>'+
    rows+
    (STATE.showPlanPicker?renderPlanPicker():'')+
  '</div>';
}
