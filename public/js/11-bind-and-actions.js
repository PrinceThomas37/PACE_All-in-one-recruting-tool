// ════════════════════════════════════════════════
// BIND EVENTS
// ════════════════════════════════════════════════
function bindLogin(){
  var passEl=document.getElementById("login-pass");
  if(passEl)passEl.addEventListener("keydown",function(e){if(e.key==="Enter")doLogin();});
  // Init canvas only once per login page load
  if(!document.getElementById('login-canvas')||document.getElementById('login-canvas')._running)return;
  try{initLoginCanvas();}catch(e){}
}

function initLoginCanvas(){
  var c=document.getElementById("login-canvas");
  if(!c||c._running)return;
  c._running=true;
  var ctx=c.getContext("2d");
  var W,H,pts=[],streams=[];
  function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight;}
  window.addEventListener("resize",resize);resize();
  for(var i=0;i<80;i++)pts.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.35,vy:(Math.random()-.5)*.35,r:Math.random()*2+1,a:Math.random()*Math.PI*2,green:Math.random()<.7});
  for(var s=0;s<12;s++)streams.push({x:Math.random()*W,y:Math.random()*H,angle:Math.random()*Math.PI*2,speed:.7+Math.random()*.5,len:60+Math.random()*80,t:Math.random()*100});
  function draw(){
    if(!document.getElementById('login-canvas')){return;} // stop if logged in
    ctx.fillStyle="rgba(232,245,238,0.2)";ctx.fillRect(0,0,W,H);
    for(var i=0;i<pts.length;i++){for(var j=i+1;j<pts.length;j++){var dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<120){ctx.strokeStyle="rgba(30,122,60,"+((1-d/120)*.2)+")";ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke();}}}
    streams.forEach(function(s){s.t+=.018;var a=Math.sin(s.t)*.5+.5,ex=s.x+Math.cos(s.angle)*s.len,ey=s.y+Math.sin(s.angle)*s.len,g=ctx.createLinearGradient(s.x,s.y,ex,ey);g.addColorStop(0,"rgba(210,140,0,0)");g.addColorStop(.5,"rgba(210,140,0,"+(a*.6)+")");g.addColorStop(1,"rgba(210,140,0,0)");ctx.strokeStyle=g;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(ex,ey);ctx.stroke();s.x+=Math.cos(s.angle)*s.speed;s.y+=Math.sin(s.angle)*s.speed;if(s.x<-100||s.x>W+100||s.y<-100||s.y>H+100){s.x=Math.random()*W;s.y=Math.random()*H;s.angle=Math.random()*Math.PI*2;}});
    pts.forEach(function(p){p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;p.a+=.008;var pulse=.4+Math.sin(p.a)*.3;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=p.green?"rgba(22,101,52,"+pulse+")":"rgba(180,110,0,"+(pulse*.85)+")";ctx.fill();});
    requestAnimationFrame(draw);
  }
  ctx.fillStyle="#e8f5ee";ctx.fillRect(0,0,W,H);
  draw();
}
function bindApp(){}

// ════════════════════════════════════════════════
// ACTIONS (global functions called from HTML)
// ════════════════════════════════════════════════
window.loginAs=function(id){STATE.user=STATE.users.find(function(u){return u.id===id});STATE.page="dashboard";render();}
window.doLogin=function(){
  var email=document.getElementById("login-email").value.trim();
  var u=STATE.users.find(function(x){return x.email.toLowerCase()===email.toLowerCase()});
  if(u){STATE.user=u;STATE.page="dashboard";render();}
  else{var e=document.getElementById("login-err");if(e){e.textContent="No account found. Use a @futeglobal.com email.";e.style.display="block";}}
}
window.signOut=function(){stopBackgroundPoll();stopProgressPoll();STATE.user=null;STATE.token=null;sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');STATE.page='login';STATE.modal=null;render();}
window.goPage=function(p){if(p==='email'){STATE.composeContext=null;STATE.composeReminderId=null;}if(p==='workflows'){STATE.wf=undefined;STATE.wfRuns={};}STATE.page=p;STATE.detailLead=null;STATE.modal=null;if(p!=="dashboard")STATE.viewingUser=null;if(p!=='bdleadinsights')STATE.bdLeadSelectedBD=null;if(p!=='bdinsights')STATE.bdInsightsData=null;if(p==='email')loadEmailsForCurrentUser();render();}
window.setPeriod=function(p){STATE.period=p;render();}
window.setSearch=function(v){STATE.leadsFilter.search=v;STATE.leadsPage=0;render();}
window.setFilt=function(k,v){STATE.leadsFilter[k]=v;STATE.leadsPage=0;render();}
window.toggleSel=function(id,v){STATE.leadsSelected[id]=v;render();}
window.toggleAll=function(v){
  var fl=filterLeads(getMyLeads(STATE.user));
  fl.forEach(function(l){STATE.leadsSelected[l.id]=v;});render();
}
window.clearSel=function(){STATE.leadsSelected={};render();}
window.applyBulk=function(){
  var sel=document.getElementById("bulk-stage");
  if(!sel||!sel.value)return;
  var stage=sel.value;
  Object.keys(STATE.leadsSelected).forEach(function(id){
    if(STATE.leadsSelected[id]){
      STATE.leads=STATE.leads.map(function(l){return l.id===id?Object.assign({},l,{stage:stage}):l;});
    }
  });
  STATE.leadsSelected={};
  showToast("Stage updated for selected leads","success");
}
window.changeStage=function(id,stage){
  STATE.leads=STATE.leads.map(function(l){return l.id===id?Object.assign({},l,{stage:stage}):l;});
  if(STATE.detailLead&&STATE.detailLead.id===id)STATE.detailLead=Object.assign({},STATE.detailLead,{stage:stage});
  STATE.activities.push({id:"a"+Date.now(),lid:id,uid:STATE.user.id,type:"stage",txt:'Stage → "'+stage+'"',dt:todayIST()});
  showToast('Stage → "'+stage+'"',"success");
}
window.changeStageDetail=function(stage){if(STATE.detailLead)changeStage(STATE.detailLead.id,stage);}
window.viewLead=function(id){
  STATE.detailLead=STATE.leads.find(function(l){return l.id===id});
  render();
}
window.closeDetail=function(){STATE.detailLead=null;render();}
window.deleteLead=function(id){
  STATE.leads=STATE.leads.map(function(l){return l.id===id?Object.assign({},l,{del:todayIST()}):l;});
  if(STATE.detailLead&&STATE.detailLead.id===id)STATE.detailLead=null;
  showToast("Lead moved to trash (deleted after 60 days)","info");
}
window.saveNotes=function(){
  var el=document.getElementById("dp-notes");
  if(el&&STATE.detailLead){
    var notes=el.value;
    STATE.leads=STATE.leads.map(function(l){return l.id===STATE.detailLead.id?Object.assign({},l,{notes:notes}):l;});
    STATE.detailLead=Object.assign({},STATE.detailLead,{notes:notes});
    showToast("Notes saved","success");
  }
}
window.addContactPrompt=function(){showToast("Add contact: coming in full version","info");}
window.openAddLead=function(){STATE.modal=renderAddLeadModal();render();}
window.closeModal=function(){STATE.modal=null;render();}
window.overlayClick=function(e){if(e.target.classList.contains("overlay"))closeModal();}

var coNewMode=true;
window.toggleCoMode=function(isNew){
  coNewMode=isNew;
  var nf=document.getElementById("co-new-fields");
  var ef=document.getElementById("co-exist-fields");
  var nb=document.getElementById("co-new-btn");
  var eb=document.getElementById("co-exist-btn");
  if(nf&&ef){nf.style.display=isNew?"":"none";ef.style.display=isNew?"none":"";}
  if(nb&&eb){nb.className="fc"+(isNew?" on":"");eb.className="fc"+(!isNew?" on":"");}
}

window.saveLead=function(){
  var fn=document.getElementById("f-fn");
  var email=document.getElementById("f-email");
  var pos=document.getElementById("f-pos");
  if(!fn||!fn.value||!email||!email.value||!pos||!pos.value){showToast("First name, email and position are required","warning");return;}
  var coid;
  if(coNewMode){
    var coname=document.getElementById("f-coname");
    if(!coname||!coname.value){showToast("Company name is required","warning");return;}
    var newco={id:"c"+Date.now(),name:coname.value,web:(document.getElementById("f-web")||{}).value||"",ind:(document.getElementById("f-ind")||{}).value||"Technology",loc:(document.getElementById("f-loc")||{}).value||""};
    STATE.companies.push(newco);
    coid=newco.id;
  } else {
    coid=(document.getElementById("f-coid")||{}).value||STATE.companies[0].id;
  }
  var aid=(document.getElementById("f-ra")||{}).value||STATE.user.id;
  var bid=(document.getElementById("f-bd")||{}).value||STATE.user.bdm;
  var newlead={id:"l"+Date.now(),coid:coid,pos:pos.value,fn:fn.value,ln:(document.getElementById("f-ln")||{}).value||"",desig:(document.getElementById("f-desig")||{}).value||"",email:email.value,phone:(document.getElementById("f-phone")||{}).value||"",li:(document.getElementById("f-li")||{}).value||"",src:(document.getElementById("f-src")||{}).value||"LinkedIn",aid:aid,bid:bid||"u1",stage:"Active",date:todayIST(),sent:null,plt:null,notes:"",del:null};
  STATE.leads.push(newlead);
  STATE.activities.push({id:"a"+Date.now(),lid:newlead.id,uid:STATE.user.id,type:"created",txt:"Lead created",dt:todayIST()});
  closeModal();
  showToast("Lead added successfully","success");
}

window.exportXL=function(){
  try{
    var filtered=filterLeads(getMyLeads(STATE.user));
    var rows=filtered.map(function(l){
      var co=STATE.companies.find(function(c){return c.id===l.coid})||{};
      return{Date:l.date,Company:co.name,Website:co.web,Position:l.pos,Location:co.loc,Industry:co.ind,FirstName:l.fn,LastName:l.ln,Designation:l.desig,Email:l.email,Phone:l.phone,LinkedIn:l.li,Source:l.src,Stage:l.stage,Analyst:uname(l.aid,STATE.users),BDManager:uname(l.bid,STATE.users)};
    });
    if(typeof XLSX!=="undefined"){
      var ws=XLSX.utils.json_to_sheet(rows);
      var wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,"Leads");
      XLSX.writeFile(wb,"FuteGlobal_Leads_"+todayIST()+".xlsx");
      showToast("Excel exported","success");
    } else {
      // CSV fallback
      var h=Object.keys(rows[0]);
      var csv=[h.join(",")].concat(rows.map(function(r){return h.map(function(k){return'"'+(r[k]||"")+'"'}).join(",")})).join("\n");
      var a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download="FuteGlobal_Leads.csv";a.click();
      showToast("CSV exported","success");
    }
  }catch(e){showToast("Export failed: "+e.message,"error");}
}

window.setEmailTab=function(t){if(t==='generator')t='compose';  // the two tabs merged
  STATE.emailTab=t;STATE.raLeadSelectedBD=null;STATE.genEmail=null;STATE.emailSearch=null;STATE.previewEmail=null;STATE.showEmailPreview=false;STATE.composeFromEmailId=null;STATE.pendingEmailPage=0;STATE.sentEmailPage=0;loadEmailsForCurrentUser();if(t==='pending'){loadPendingSummary();startPendingSummaryPoll();}else{stopPendingSummaryPoll();}render();}


function loadPendingSummary(){
  if(!STATE.user||!STATE.token)return;
  var q='';
  if(userHasRole(STATE.user,'ra_lead')&&STATE.raLeadSelectedBD)q='?manager_id='+encodeURIComponent(STATE.raLeadSelectedBD);
  apiGet('/emails/pending-summary'+q).then(function(d){STATE.pendingSummary=d;scheduleRender();}).catch(function(){});
}
function startPendingSummaryPoll(){
  if(STATE._pendingSummaryTimer){clearInterval(STATE._pendingSummaryTimer);STATE._pendingSummaryTimer=null;}
  if(!STATE.user||STATE.emailTab!=='pending')return;
  loadPendingSummary();
  STATE._pendingSummaryTimer=setInterval(function(){
    if(STATE.emailTab==='pending'&&STATE.user)loadPendingSummary();
    else if(STATE._pendingSummaryTimer){clearInterval(STATE._pendingSummaryTimer);STATE._pendingSummaryTimer=null;}
  },60000);
}
function stopPendingSummaryPoll(){
  if(STATE._pendingSummaryTimer){clearInterval(STATE._pendingSummaryTimer);STATE._pendingSummaryTimer=null;}
}
function renderPendingScheduleBanner(){
  var ps=STATE.pendingSummary;
  if(!ps||!ps.total_pending)return '';
  var ready=ps.ready_now||0;
  var wait=ps.waiting_window||0;
  var winLbl=ps.send_window_label||'8:00 – 16:00 lead local time';
  var tzRows=(ps.by_timezone||[]).filter(function(t){return t.waiting_window>0;}).map(function(t){
    return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">'+
      '<span><strong>'+htmlEsc(t.timezone)+'</strong> · '+t.waiting_window+' waiting</span>'+
      '<span style="color:var(--amber);font-weight:600">Resumes: '+htmlEsc(t.resumes_label)+'</span></div>';
  }).join('');
  var retryBtn='';
  if(wait>0&&!userHasRole(STATE.user,'ra_lead')){
    retryBtn='<button onclick="retryPendingWindowNow()" style="margin-top:10px;background:var(--accent);color:#fff;border:0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Send in-window emails now</button>';
  }
  return '<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:var(--r2);padding:14px 18px;margin-bottom:14px">'+
    '<div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:8px">Pending send schedule (US lead timezones)</div>'+
    '<div style="font-size:13px;color:#78350f;line-height:1.5;margin-bottom:10px">'+
      '<strong>'+ps.total_pending+'</strong> pending total · '+
      '<span style="color:var(--green);font-weight:600">'+ready+' ready to send now</span>'+
      (wait?' · <span style="color:#b45309;font-weight:600">'+wait+' waiting for send window</span>':'')+
      '<br><span style="font-size:12px">Send window: '+htmlEsc(winLbl)+'.</span>'+
    '</div>'+
    (tzRows?'<div style="font-size:12px;margin-top:8px">'+tzRows+'</div>':'')+
    retryBtn+
  '</div>';
}
window.retryPendingWindowNow=function(){
  var body={};
  if(userHasRole(STATE.user,'ra_lead')&&STATE.raLeadSelectedBD)body.manager_id=STATE.raLeadSelectedBD;
  apiPost('/emails/retry-pending-window',body).then(function(){
    showToast('Retrying in-window pending emails…','success');
    startProgressPoll();
    loadPendingSummary();
  }).catch(function(e){showToast('Retry failed: '+e.message,'error');});
};


// ── Send progress polling ──────────────────────
// Auto-starts on login for BD/BD_Lead. No button click required.
// Polls every 2s when sending is active, every 10s when idle.
function startProgressPoll(){
  if(STATE._progressPollTimer)return;
  var _emailRefreshCount=0;
  function pollOnce(){
    if(!STATE.user||!STATE.token){STATE._progressPollTimer=null;return;}
    // Hidden tab with no send in flight: skip the request, check again later.
    if(document.hidden&&!(STATE.sendProgress&&STATE.sendProgress.active)){
      STATE._progressPollTimer=setTimeout(pollOnce,30000);return;
    }
    apiGet('/emails/send-progress').then(function(d){
      var newProgress=(d&&(d.active||d.done))?d:null;
      // A new active run clears any prior dismissal so fresh results show.
      if(d&&d.active)STATE._progressDismissed=false;
      // Honor a manual dismissal of a completed run until a new run starts.
      if(STATE._progressDismissed&&newProgress&&newProgress.done&&!newProgress.active)newProgress=null;
      var hadProgress=!!STATE.sendProgress;
      STATE.sendProgress=newProgress;
      // WHILE A SEND IS RUNNING THIS POLLS EVERY 2 SECONDS, so it must repaint
      // only when the banner would actually say something different. It used to
      // call scheduleRender() on every poll, which meant the whole app rebuilt
      // twice a minute — or every 2s mid-send — under whatever the user was
      // doing. On the Inbox that is a style invalidation on an ancestor of the
      // message-body iframe every 2s, which is enough to make the browser
      // re-raster it: the white flash the owner filmed.
      var sig=newProgress?JSON.stringify(newProgress):'';
      var moved=sig!==(STATE._progressSig||'');
      STATE._progressSig=sig;
      if(d&&d.active){
        if(moved)scheduleRender();
        _emailRefreshCount++;
        // The email list is only on screen on the Email page; refreshing it
        // from here while the user is elsewhere is a repaint nobody asked for.
        // goPage('email') reloads it on entry, so nothing goes stale.
        if(_emailRefreshCount%3===0&&STATE.page==='email')loadEmailsForCurrentUser();
      }
      else if(!!newProgress!==hadProgress||moved){scheduleRender();}
      if(d&&d.done&&!d.active){
        _emailRefreshCount=0;
        if(STATE.page==='email')loadEmailsForCurrentUser();
        // Auto-dismiss only clean runs; keep failures up until the user reviews/dismisses them.
        if(!d.failed){setTimeout(function(){STATE.sendProgress=null;scheduleRender();},30000);}
      }
      var delay=(d&&d.active)?2000:30000; // idle polling slowed — sends surface within 2s once active anyway
      STATE._progressPollTimer=setTimeout(pollOnce,delay);
    }).catch(function(){
      STATE._progressPollTimer=setTimeout(pollOnce,30000);
    });
  }
  STATE._progressPollTimer=setTimeout(pollOnce,2000);
}
function stopProgressPoll(){
  if(STATE._progressPollTimer){clearTimeout(STATE._progressPollTimer);STATE._progressPollTimer=null;}
}
function loadEmailsForCurrentUser(){
  var u=STATE.user;
  if(!u)return;
  var isBD=userHasAnyRole(u,'bd','bd_lead','admin','ra_lead');
  if(isBD){
    if(userHasRole(u,'ra_lead')){
      // RA Lead needs all emails across all BD users (no status filter)
      apiGet('/emails').then(function(d){
        var all=d||[];
        STATE.pendingEmails=all.filter(function(e){return e.status==='pending';});
        STATE.allBDEmails=all;
        loadPendingSummary();
        scheduleRender();
      }).catch(function(){});
    } else {
      apiGet('/emails?status=pending').then(function(d){STATE.pendingEmails=d||[];loadPendingSummary();scheduleRender();}).catch(function(){});
      apiGet('/emails?status=sent').then(function(d){STATE.sentEmails=d||[];scheduleRender();}).catch(function(){});
    }
  }
}

