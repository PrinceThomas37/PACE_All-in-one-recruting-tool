// ===== MY SETUP — a person sets up THEIR OWN outreach (owner, 8 Oct 2026, D-0103, R-168) =====
// Until now only an admin could add an outreach mailbox to a person, and a mailbox with nothing said about it sent the
// organisation's stock wording and signature (Fute Global's) — so a VP who connected another company's mailbox sent emails
// naming Fute Global, with the wrong title and signature. This page is where ANY person:
//   1. connects their own mailbox (Outlook or Gmail),
//   2. says who that mailbox WRITES FOR — company, title, postal address, optional phone and website ("sends as"),
//      which becomes its signature and what the AI writes under,
//   3. sees where their own sequence stands (the wording lives on the Email page; this page points to it).
// Every rule is on the server (routes/auth.js: your own mailbox only; the daily limit stays with admins). This file asks and shows.
// The Today page carries a calm card until the steps are done (renderMySetupCard) and draws nothing after.

(function () {

  function esc(s){ return htmlEsc(s); }
  function meId(){ return STATE.user && STATE.user.id; }
  var M = STATE.mySetup = STATE.mySetup || { form:null };

  // ── what is done ─────────────────────────────────────────────────────────
  function myBoxes(){ return ((STATE.userEmailsCache||{})[meId()]||[]).filter(function(m){ return m.is_active!==false; }); }
  function isConnected(m){ return !!(m.connection&&m.connection.connected) || !!m.ms_connected || !!m.gmail_connected; }
  function needsSequence(){ return userHasAnyRole(STATE.user,'bd','bd_lead','admin'); }
  function canSend(u){ return !!u && (!userHasRole(u,'ra') || userHasAnyRole(u,'bd','bd_lead','admin','ra_lead')); }
  // The three steps, each with whether it is done and what to say. The sequence step exists only for people who have one.
  function status(){
    var boxes=myBoxes(), connected=boxes.filter(isConnected), said=boxes.filter(function(m){ return !!m.sends_as; });
    var steps=[
      { id:'mailbox', done:connected.length>0, title:'Connect your mailbox',
        text: connected.length ? plural(connected.length,'mailbox')+' connected.' : (boxes.length ? 'Added, but not signed in yet — press Connect.' : 'Outlook or Gmail — the address your outreach goes out from.') },
      { id:'sendsas', done:boxes.length>0 && said.length===boxes.length, title:'Say who each mailbox writes for',
        text: !boxes.length ? 'After a mailbox is added.' : (said.length===boxes.length ? 'Company, title and address are set.' : (boxes.length-said.length)+' of '+boxes.length+' still without a company, title and address.') }
    ];
    if (needsSequence()){
      var plan=STATE.myOutreachPlan, have=!!(plan&&plan.tmpl_o1_body);
      steps.push({ id:'sequence', done:have, title:'Write your first sequence',
        text: have ? 'Your own wording is saved.' : 'Not written yet — until you do, PACE sends its standard wording, which names Fute Global LLC.' });
    }
    var done=steps.filter(function(s){ return s.done; }).length;
    return { steps:steps, done:done, total:steps.length, all:done===steps.length, boxes:boxes };
  }
  function plural(n,one){ return n+' '+one+(n===1?'':'es'); }

  // ── the calm card on Today ───────────────────────────────────────────────
  window.renderMySetupCard = function(){
    var u=STATE.user; if(!u || (STATE.viewingUser&&STATE.viewingUser.id!==u.id)) return '';
    if(!canSend(u) || !((STATE.userEmailsCache||{})[u.id])) return '';       // not for people who do not send; not before it has loaded
    var s=status(); if(s.all) return '';
    var next=s.steps.filter(function(x){ return !x.done; })[0];
    return '<div class="mba-card mb4"><div class="mba-head">Finish setting up your outreach · '+s.done+' of '+s.total+' done</div>'+
      '<div class="mba-row"><div class="mba-main"><div class="mba-mail">'+esc(next.title)+'</div><div class="mba-text">'+esc(next.text)+'</div></div>'+
      '<div class="mba-act"><button class="btn btn-sm btn-primary" onclick="goPage(\'mysetup\')">Open My Setup</button></div></div></div>';
  };

  // ── routing ──────────────────────────────────────────────────────────────
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='mysetup'){
      STATE.page='mysetup'; STATE.modal=null; render();
      if (meId()) loadUserEmails(meId());                       // fresh connection state, sends-as and signatures
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };
  UI.registerPage('mysetup', function(){ return renderPage(); });

  // ── the page ─────────────────────────────────────────────────────────────
  function badge(m){
    var c=m.connection||{};
    if (isConnected(m) && c.status && c.status!=='ok' && c.status!=='connected') return '<span class="ms-tag is-warn">Sign-in expired — reconnect</span>';
    return isConnected(m) ? '<span class="ms-tag is-ok">Connected</span>' : '<span class="ms-tag is-warn">Not signed in yet</span>';
  }
  function platformOf(m){ return /gmail|google/i.test(m.platform||'') ? 'Gmail' : 'Outlook'; }
  function writesFor(m){
    var s=m.sends_as;
    if (!s) return '<div class="ms-for is-none"><strong>Writes for: not said yet.</strong> Emails from this mailbox use the organisation\'s standard name, title and signature. <button type="button" class="fd-pill" onclick="mySetupEdit(\''+m.id+'\')">Say who it writes for</button></div>';
    var bits=[s.title, s.company].filter(Boolean).map(esc).join(' · ');
    var more=[s.phone, s.website, s.address].filter(Boolean).map(esc).join(' · ');
    return '<div class="ms-for"><strong>Writes for:</strong> '+bits+'<div class="fd-hint">'+more+'</div>'+
      '<div class="fd-hint">'+(m.has_own_signature?'Has its own signature.':'No signature of its own yet.')+'</div></div>';
  }
  function boxRow(m){
    var plat=platformOf(m);
    return '<div class="ms-box">'+
      '<div class="fd-row fd-between"><div class="fd-grow"><div class="fs-14 fd-strong">'+esc(m.email_address)+'</div>'+
        '<div class="fd-hint">'+plat+' · shown to recipients as “'+esc(m.display_name||m.email_address)+'” · up to '+esc(String(m.daily_send_limit||150))+' emails a day (set by an admin)</div></div>'+
        badge(m)+'</div>'+
      writesFor(m)+
      '<div class="fd-row">'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupEdit(\''+m.id+'\')">Edit who it writes for</button>'+
        '<button class="btn btn-sm '+(isConnected(m)?'btn-outline':'btn-primary')+'" onclick="mySetupConnect(\''+m.id+'\')">'+(isConnected(m)?'Reconnect':'Connect '+plat)+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupRemove(\''+m.id+'\')">Remove</button>'+
      '</div></div>';
  }
  function renderPage(){
    var s=status();
    var steps=s.steps.map(function(x,i){
      var action = x.id==='sequence' ? '<button class="btn btn-sm btn-outline" onclick="mySetupOpenSequence()">'+(x.done?'Open it':'Write it')+'</button>'
                 : (x.id==='mailbox' && !x.done ? '<button class="btn btn-sm btn-primary" onclick="mySetupAdd(\'Microsoft\')">Add a mailbox</button>' : '');
      return '<div class="ms-step'+(x.done?' is-done':'')+'"><span class="ms-num">'+(x.done?'✓':(i+1))+'</span>'+
        '<div class="fd-grow"><div class="fd-strong">'+esc(x.title)+'</div><div class="fd-hint">'+esc(x.text)+'</div></div>'+action+'</div>';
    }).join('');
    var boxes=s.boxes.length ? s.boxes.map(boxRow).join('') : '<div class="fd-empty">No mailbox yet.<br>Add the address your outreach should go out from.</div>';
    return UI.page({ body:
      '<div class="card fd-form"><div class="fs-14 fd-strong">Your outreach setup · '+s.done+' of '+s.total+' done</div>'+
        '<div class="fd-hint">This is yours — nobody else\'s setup is changed by what you do here.</div>'+steps+'</div>'+
      '<div class="card fd-form"><div class="fd-row fd-between"><div class="fs-14 fd-strong">Your mailboxes</div>'+
        '<span class="fd-row"><button class="btn btn-sm btn-primary" onclick="mySetupAdd(\'Microsoft\')">+ Add Outlook mailbox</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupAdd(\'Gmail\')">+ Add Gmail mailbox</button></span></div>'+boxes+'</div>' });
  }

  // ── the window: add a mailbox, or change who one writes for ──────────────
  var FIELDS=[ ['company','Company it writes for','e.g. Acme Talent LLC',true], ['title','Your job title','e.g. Vice President',true],
               ['address','Company postal address','Street, city, state, ZIP — every outreach email must carry the sender\'s own',true],
               ['phone','Phone (optional)','+1 555 010 0100',false], ['website','Website (optional)','acmetalent.com',false] ];
  function formHtml(f){
    var head = f.mode==='add'
      ? '<div class="fgrp"><label class="flbl">Email address *</label><input class="inp" id="ms-email" type="email" placeholder="you@yourcompany.com" value="'+esc(f.email)+'"></div>'+
        '<div class="fgrp"><label class="flbl">Name recipients see</label><input class="inp" id="ms-name" placeholder="Your full name" value="'+esc(f.name)+'"></div>'
      : '<div class="fd-hint">'+esc(f.email)+'</div>';
    var body=FIELDS.map(function(x){
      return '<div class="fgrp"><label class="flbl">'+x[1]+(x[3]?' *':'')+'</label><input class="inp" id="ms-'+x[0]+'" placeholder="'+esc(x[2])+'" value="'+esc(f[x[0]])+'" oninput="mySetupPreview()"></div>';
    }).join('');
    var rebuild = f.mode==='edit'
      ? '<label class="fd-use fd-block"><input type="checkbox" id="ms-rebuild" '+(f.rebuild?'checked':'')+'> Also rewrite this mailbox\'s signature from these details'+(f.hasSig?' (replaces the one it has now)':'')+'</label>' : '';
    return head+'<div class="fd-label">This mailbox writes for</div>'+body+rebuild+
      '<div class="fd-label">Its signature will read</div><div id="ms-preview" class="ms-preview"></div>'+
      (f.err?'<div class="ld-box is-stop" role="alert">'+esc(f.err)+'</div>':'');
  }
  function paintModal(){
    var f=M.form; if(!f){ STATE.modal=null; render(); return; }
    var plat=f.platform==='Gmail'?'Gmail':'Outlook';
    STATE.modal='<div class="modal modal-w480" onclick="event.stopPropagation()"><div class="mh"><div class="mt">'+(f.mode==='add'?'Add '+plat+' mailbox':'Who this mailbox writes for')+'</div>'+
      '<button class="btn-icon" onclick="mySetupClose()">'+ico('x',14)+'</button></div>'+
      '<div class="mb_" style="max-height:66vh;overflow:auto">'+formHtml(f)+'</div>'+
      '<div class="mf"><button class="btn btn-outline" onclick="mySetupClose()">Cancel</button>'+
      '<button class="btn btn-primary" '+(f.busy?'disabled':'')+' onclick="mySetupSave()">'+(f.busy?'Saving…':(f.mode==='add'?'Save & connect '+plat:'Save'))+'</button></div></div>';
    render(); mySetupPreview();
  }
  function readForm(){
    var f=M.form, g=function(id){ var e=document.getElementById(id); return e?String(e.value||'').trim():''; };
    if (f.mode==='add'){ f.email=g('ms-email'); f.name=g('ms-name'); }
    FIELDS.forEach(function(x){ f[x[0]]=g('ms-'+x[0]); });
    var rb=document.getElementById('ms-rebuild'); if(rb) f.rebuild=!!rb.checked;
  }
  // The preview is drawn from the same fields as they are typed; it never repaints the window (a repaint under the typing hand).
  window.mySetupPreview = function(){
    var el=document.getElementById('ms-preview'), f=M.form; if(!el||!f) return;
    var g=function(id){ var e=document.getElementById(id); return e?String(e.value||'').trim():''; };
    var name=g('ms-name')||f.name||(STATE.user&&STATE.user.name)||'Your name', email=g('ms-email')||f.email||'you@yourcompany.com';
    var line=[g('ms-title'),g('ms-company')].filter(Boolean).join(' | ');
    var contact=[email,g('ms-phone'),g('ms-website')].filter(Boolean).join(' | ');
    el.innerHTML='<strong>'+esc(name)+'</strong><br>'+esc(line||'Title | Company')+'<br>'+esc(contact)+'<br><span class="fd-hint">'+esc(g('ms-address')||'Company postal address')+'</span>';
  };
  window.mySetupClose = function(){ M.form=null; STATE.modal=null; render(); };
  window.mySetupAdd = function(platform){
    var u=STATE.user||{}, last=(myBoxes().filter(function(m){ return m.sends_as; })[0]||{}).sends_as||{};
    M.form={ mode:'add', platform:platform, id:null, email:'', name:u.name||'', company:'', title:u.designation||'', address:'', phone:'', website:'', busy:false, err:'' };
    // A second mailbox for the same company starts from the first one's words; a different company just overwrites them.
    M.form.company=last.company||''; M.form.address=last.address||''; M.form.phone=last.phone||''; M.form.website=last.website||''; M.form.title=last.title||M.form.title;
    paintModal();
  };
  window.mySetupEdit = function(id){
    var m=myBoxes().filter(function(x){ return x.id===id; })[0]; if(!m) return;
    var s=m.sends_as||{};
    M.form={ mode:'edit', platform:platformOf(m), id:id, email:m.email_address, name:m.display_name||'', company:s.company||'', title:s.title||(STATE.user&&STATE.user.designation)||'', address:s.address||'', phone:s.phone||'', website:s.website||'',
             rebuild:!m.has_own_signature, hasSig:!!m.has_own_signature, busy:false, err:'' };
    paintModal();
  };
  function sendsAsOf(f){ return { company:f.company, title:f.title, address:f.address, phone:f.phone, website:f.website }; }
  function missing(f){
    if (f.mode==='add' && !f.email) return 'Add the mailbox\'s email address.';
    if (!f.company) return 'Say which company this mailbox writes for.';
    if (!f.title) return 'Add the job title that goes under your name.';
    if (!f.address || f.address.length<8) return 'Add the company\'s postal address — every outreach email must carry the sender\'s own.';
    return '';
  }
  window.mySetupSave = function(){
    var f=M.form; if(!f||f.busy) return;
    readForm(); f.err=missing(f);
    if (f.err){ paintModal(); return; }
    f.busy=true; f.err=''; paintModal();
    var me=meId();
    if (f.mode==='add'){
      apiPost('/users/'+me+'/emails',{ email_address:f.email, display_name:f.name||f.email, platform:f.platform==='Gmail'?'Gmail':'Microsoft', sends_as:sendsAsOf(f) }).then(function(e){
        STATE.userEmailsCache=STATE.userEmailsCache||{}; STATE.userEmailsCache[me]=(STATE.userEmailsCache[me]||[]).concat([Object.assign({ connection:{ connected:false, status:'none' }, has_own_signature:true }, e)]);
        var plat=f.platform; M.form=null; STATE.modal=null; render();
        showToast('Mailbox added — now sign in to it in the window that opens','success');
        if (plat==='Gmail') connectGmailUserEmail(me,e.id); else connectMicrosoftUserEmail(me,e.id);
      }).catch(function(er){ f.busy=false; f.err=(er&&er.message)||String(er); paintModal(); });
    } else {
      apiPut('/users/'+me+'/emails/'+f.id+'/sends-as', Object.assign(sendsAsOf(f), { rebuild_signature:!!f.rebuild })).then(function(r){
        var m=myBoxes().filter(function(x){ return x.id===f.id; })[0];
        if (m){ m.sends_as=r.sends_as; if (r.signature_rebuilt) m.has_own_signature=true; }
        M.form=null; STATE.modal=null; render(); showToast(r.signature_rebuilt?'Saved — the signature was rewritten from it':'Saved','success');
      }).catch(function(er){ f.busy=false; f.err=(er&&er.message)||String(er); paintModal(); });
    }
  };
  window.mySetupConnect = function(id){
    var m=myBoxes().filter(function(x){ return x.id===id; })[0]; if(!m) return;
    if (platformOf(m)==='Gmail') connectGmailUserEmail(meId(),id); else connectMicrosoftUserEmail(meId(),id);
  };
  window.mySetupRemove = function(id){
    var m=myBoxes().filter(function(x){ return x.id===id; })[0]; if(!m) return;
    if (!confirm('Remove '+m.email_address+'? Leads waiting on it are moved to another of your mailboxes when there is one. Nothing already sent is touched.')) return;
    apiDelete('/users/'+meId()+'/emails/'+id).then(function(){
      STATE.userEmailsCache[meId()]=(STATE.userEmailsCache[meId()]||[]).filter(function(x){ return x.id!==id; });
      showToast('Mailbox removed','info'); render();
    }).catch(function(er){ showToast('Failed: '+((er&&er.message)||er),'error'); });
  };
  window.mySetupOpenSequence = function(){ STATE.emailTab='sequence'; STATE.seqView='wording'; goPage('email'); };

})();
