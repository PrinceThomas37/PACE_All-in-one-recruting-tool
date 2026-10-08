// ── A MANAGER HANDS UNASSIGNED LEADS OUT (D-0110, R-175) ─────────────────────────────────────────────
// The owner (8 Oct): imports now land Unassigned. "Assign" (Leads page) gives the selected leads — or every Unassigned lead the
// person can see, when nothing is ticked — to THEMSELVES or to anyone who reports to them, and the person decides HOW MANY go from
// each of the assignee's email IDs ("can a user choose how many of the lot should go from each ID?"). The boxes start on the
// automatic split, so doing nothing works as it always did. Owning is not sending: nothing is sent here.
// Typing in a number box never repaints the window (it updates the line under it); only a button does.
(function(){
  'use strict';
  var A=function(){ return STATE.assignWin||(STATE.assignWin={ ids:[], n:0, people:null, to:'', mbs:null, mbErr:'', counts:{}, busy:false, result:null, err:'', selected:false }); };
  var esc=function(t){ return htmlEsc(t==null?'':t); };

  // Which leads are on offer: the ticked ones that are still Unassigned, else every Unassigned lead in the list.
  function offered(){
    var sel=STATE.leadSeqSel||{}, vis=STATE._leadSelVisibleIds||null, ticked=Object.keys(sel).filter(function(k){return sel[k]&&(!vis||vis.indexOf(k)>-1);});
    var open=function(j){ return j && j.stage==='Unassigned' && !j.assigned_to_bd; };
    var fromTicks=ticked.map(jobById).filter(open).map(function(j){return j.id;});
    if(ticked.length) return { ids:fromTicks, selected:true, ticked:ticked.length };
    return { ids:getMyJobs(STATE.user).filter(open).map(function(j){return j.id;}), selected:false, ticked:0 };
  }

  // The automatic split: each email ID in proportion to the room it has left today (every one equal when none has any).
  function suggest(mbs,n){
    var out={}, total=mbs.reduce(function(s,m){return s+Math.max(0,m.room);},0), given=0;
    mbs.forEach(function(m){ out[m.id]=total>0?Math.round(Math.max(0,m.room)/total*n):Math.floor(n/mbs.length); given+=out[m.id]; });
    var i=0; while(given<n){ out[mbs[i%mbs.length].id]++; given++; i++; }
    i=0; while(given>n){ var m=mbs[i%mbs.length]; if(out[m.id]>0){ out[m.id]--; given--; } i++; }
    return out;
  }
  function allocated(a){ return (a.mbs||[]).reduce(function(s,m){ return s+(Number(a.counts[m.id])||0); },0); }
  function personName(a){ var p=(a.people||[]).filter(function(x){return x.id===a.to;})[0]; return p?(p.is_me?'yourself':p.name):''; }
  function sentence(a){
    var parts=(a.mbs||[]).filter(function(m){return (Number(a.counts[m.id])||0)>0;}).map(function(m){ return a.counts[m.id]+' from '+m.email; });
    return 'Give '+a.n+' lead'+(a.n===1?'':'s')+' to '+personName(a)+(parts.length?' — '+parts.join(', '):'')+'.';
  }

  window.openAssignLeads=function(){
    var o=offered();
    if(!o.ids.length){ showToast(o.selected?'None of the ticked leads is Unassigned':'There are no Unassigned leads to hand out','warning'); return; }
    STATE.assignWin=undefined; var a=A(); a.ids=o.ids; a.n=o.ids.length; a.selected=o.selected;
    STATE.modal=draw(); render();
    apiGet('/leads/assign/people').then(function(r){
      a.people=(r&&r.people)||[]; var me=a.people.filter(function(p){return p.is_me;})[0];
      a.to=(me&&me.mailboxes?me.id:((a.people.filter(function(p){return p.mailboxes;})[0]||{}).id||''));
      STATE.modal=draw(); render(); if(a.to) loadMbs(a);
    }).catch(function(e){ a.people=[]; a.err=(e&&e.message)||'Could not load your team'; STATE.modal=draw(); render(); });
  };
  function loadMbs(a){
    a.mbs=null; a.mbErr='';
    apiGet('/leads/assign/mailboxes?user_id='+encodeURIComponent(a.to)).then(function(r){
      if(STATE.assignWin!==a) return;
      a.mbs=(r&&r.mailboxes)||[]; a.mbErr=(r&&r.error)||''; a.counts=a.mbs.length?suggest(a.mbs,a.n):{};
      STATE.modal=draw(); render();
    }).catch(function(e){ if(STATE.assignWin!==a) return; a.mbs=[]; a.mbErr=(e&&e.message)||'Could not load their email IDs'; STATE.modal=draw(); render(); });
  }
  window.assignPickPerson=function(id){ var a=A(); a.to=id; a.err=''; STATE.modal=draw(); render(); loadMbs(a); };
  // Typing never repaints: it updates the totals line and the button in place.
  function liveRefresh(){
    var a=A(), sum=document.getElementById('as-sum'), btn=document.getElementById('as-go'), say=document.getElementById('as-say');
    var ok=allocated(a)===a.n&&a.n>=1;
    if(sum){ sum.textContent='Given out: '+allocated(a)+' of '+a.n; sum.className='fs-12_5 '+(ok?'c-text2':'c-red'); }
    if(btn) btn.disabled=!ok||a.busy;
    if(say) say.textContent=ok?sentence(a):'';
  }
  window.assignCount=function(id,el){ var v=Math.floor(Number(el.value)); A().counts[id]=(v>=0)?v:0; liveRefresh(); };
  window.assignHowMany=function(el){
    var a=A(), v=Math.floor(Number(el.value)); if(!(v>=1)) return; a.n=Math.min(v,a.ids.length);
    if(a.mbs&&a.mbs.length){ a.counts=suggest(a.mbs,a.n); (a.mbs||[]).forEach(function(m){ var i=document.getElementById('as-n-'+m.id); if(i) i.value=a.counts[m.id]; }); }
    liveRefresh();
  };
  window.assignAuto=function(){ var a=A(); if(!a.mbs||!a.mbs.length) return; a.counts=suggest(a.mbs,a.n); STATE.modal=draw(); render(); };
  window.assignClose=function(){ STATE.assignWin=undefined; closeModal(); };
  window.assignGo=function(){
    var a=A(); if(a.busy||allocated(a)!==a.n) return;
    var alloc=(a.mbs||[]).map(function(m){ return { mailbox_id:m.id, count:Number(a.counts[m.id])||0 }; }).filter(function(x){return x.count>0;});
    a.busy=true; a.err=''; STATE.modal=draw(); render();
    apiPost('/leads/assign',{ job_ids:a.ids.slice(0,a.n), to_user_id:a.to, allocation:alloc }).then(function(r){
      a.busy=false; a.result=r; STATE.leadSeqSel={}; STATE.modal=draw(); render();
      if(typeof refreshJobs==='function') refreshJobs();
    }).catch(function(e){ a.busy=false; a.err=(e&&e.message)||'Could not hand them out'; STATE.modal=draw(); render(); });
  };

  function draw(){
    var a=A(), body, foot;
    if(a.result){
      var r=a.result, me=(a.people||[]).some(function(p){return p.is_me&&p.id===a.to;});
      body='<div class="fs-14" style="font-weight:700;margin-bottom:6px">'+(r.assigned?('Handed out '+r.assigned+' lead'+(r.assigned===1?'':'s')+' to '+esc(r.to&&r.to.name||'them')+'.'):'Nothing was handed out.')+'</div>'+
        (r.by_mailbox||[]).map(function(m){ return '<div class="fs-12_5 c-text2">✉ '+esc(m.email)+' — '+m.count+'</div>'; }).join('')+
        (r.message?'<div class="fs-12_5 c-text2" style="margin-top:8px">'+esc(r.message)+'</div>':'')+
        '<div class="fs-12 c-text3" style="margin-top:8px">They are Assigned now. Nothing has been sent — the first emails are written next.</div>';
      foot='<button class="btn btn-outline" onclick="assignClose()">Done</button>'+
        (me&&r.assigned?'<button class="btn btn-primary" onclick="assignClose();writeFirstEmails('+esc(JSON.stringify(r.job_ids)).replace(/"/g,'&quot;')+')">Write the first emails</button>':'');
    } else if(a.people===null){ body='<div class="c-text3 fs-13">Loading your team…</div>'; foot='';
    } else if(!a.people.length){ body='<div class="c-red fs-13">'+esc(a.err||'There is nobody to hand leads to.')+'</div>'; foot='<button class="btn btn-outline" onclick="assignClose()">Close</button>';
    } else {
      var peopleSel='<select class="sel fd-wide" onchange="assignPickPerson(this.value)">'+a.people.map(function(p){
        return '<option value="'+escAttr(p.id)+'"'+(p.id===a.to?' selected':'')+(p.mailboxes?'':' disabled')+'>'+esc(p.is_me?'Me ('+p.name+')':p.name)+(p.mailboxes?'':' — no email ID connected')+'</option>';
      }).join('')+'</select>';
      var mbPart;
      if(a.mbs===null) mbPart='<div class="fs-12_5 c-text3">Loading their email IDs…</div>';
      else if(!a.mbs.length) mbPart='<div class="fs-12_5 c-red" role="alert">'+esc(a.mbErr||'They have no connected email ID.')+'</div>';
      else mbPart=a.mbs.map(function(m){
        var c=Number(a.counts[m.id])||0, over=c>m.room;
        return '<div class="as-row"><div class="as-who"><div class="fs-13">'+esc(m.email)+'</div><div class="fs-12 c-text3">can send '+m.room+' more today</div></div>'+
          '<input id="as-n-'+escAttr(m.id)+'" class="inp as-n" type="number" min="0" max="'+a.n+'" value="'+c+'" oninput="assignCount(\''+escAttr(m.id)+'\',this)" aria-label="Leads from '+escAttr(m.email)+'">'+
          (over?'<div class="fs-12 c-text3 as-note">the rest wait for a later day</div>':'')+'</div>';
      }).join('')+'<div class="fs-12 c-text3">Giving more than a mailbox can send today is allowed — the extra emails simply go out on a later day.</div>';
      var many=a.ids.length>1?('<label class="fs-12_5 c-text2" for="as-many">How many of the '+a.ids.length+'?</label> <input id="as-many" class="inp as-n" type="number" min="1" max="'+a.ids.length+'" value="'+a.n+'" oninput="assignHowMany(this)">'):'';
      var ok=a.mbs&&a.mbs.length&&allocated(a)===a.n&&a.n>=1;
      body='<div class="fs-13 c-text2" style="margin-bottom:10px">'+(a.selected?'The leads you ticked that are still Unassigned':'Every Unassigned lead you can see')+': <b>'+a.ids.length+'</b>.</div>'+
        '<div class="fd-label">Give them to</div>'+peopleSel+
        (many?'<div style="margin:10px 0">'+many+'</div>':'')+
        '<div class="fd-label" style="margin-top:12px">Send from — how many go from each email ID</div>'+mbPart+
        (a.mbs&&a.mbs.length?'<div class="as-sumline"><span id="as-sum" class="fs-12_5 '+(ok?'c-text2':'c-red')+'">Given out: '+allocated(a)+' of '+a.n+'</span> <button class="btn btn-xs btn-outline" onclick="assignAuto()">Spread automatically</button></div>':'')+
        '<div id="as-say" class="fs-13 as-say">'+(ok?esc(sentence(a)):'')+'</div>'+
        (a.err?'<div class="c-red fs-13" role="alert" style="margin-top:8px">'+esc(a.err)+'</div>':'')+
        '<div class="fs-12 c-text3" style="margin-top:8px">Handing leads out only makes them theirs. Nothing is sent. A lead that already has an owner is never moved from here.</div>';
      foot='<button class="btn btn-outline" onclick="assignClose()">Cancel</button>'+
        '<button id="as-go" class="btn btn-primary" '+((ok&&!a.busy)?'':'disabled ')+'onclick="assignGo()">'+(a.busy?'Handing out…':'Assign')+'</button>';
    }
    return '<div class="modal modal-w480"><div class="mh"><div class="mt">Assign leads</div></div><div class="mb_">'+body+'</div><div class="mf">'+foot+'</div></div>';
  }
})();
