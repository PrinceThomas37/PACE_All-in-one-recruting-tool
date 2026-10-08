// ===== MY SETUP — a person sets up THEIR OWN outreach (owner, 8 Oct 2026, D-0103, D-0104) =====
// Until now only an admin could add an outreach mailbox to a person, and a person with nothing set up sent the organisation's stock
// wording and signature (Fute Global's). This page is where ANY person:
//   1. connects their own mailbox (Outlook or Gmail),
//   2. says who that mailbox WRITES FOR — company, title, postal address, optional phone and website ("sends as") — and shapes its
//      signature right there: font, size, colour, bold, italic, underline, links, alignment, and an optional LOGO,
//   3. has their own SEQUENCE (a starter with their company's name is one click) — outreach for their leads, and the Lead Finder's
//      "write the first email", only start once they have one; individual emails never need it,
//   4. may narrow their sending days and hours (never widen the organisation's; the daily number stays an admin's),
//   5. can open the AI writing-style note.
// Every rule is on the server (routes/auth.js, routes/my-setup.js). This file asks and shows. PACE also puts the first two steps on the
// person's own task list when they sign in (services/setup-tasks.js) and they close by themselves.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function meId(){ return STATE.user && STATE.user.id; }
  var M = STATE.mySetup = STATE.mySetup || { form:null, win:null, winForm:null };

  // ── what is done ─────────────────────────────────────────────────────────
  function myBoxes(){ return ((STATE.userEmailsCache||{})[meId()]||[]).filter(function(m){ return m.is_active!==false; }); }
  function isConnected(m){ return !!(m.connection&&m.connection.connected) || !!m.ms_connected || !!m.gmail_connected; }
  function hasSequenceRole(){ return userHasAnyRole(STATE.user,'bd','bd_lead','admin'); }
  function canSend(u){ return !!u && (!userHasRole(u,'ra') || userHasAnyRole(u,'bd','bd_lead','admin','ra_lead')); }
  function plural(n,one){ return n+' '+one+(n===1?'':'es'); }
  // The person has not written (or copied) a sequence of their own yet. False until the plan has loaded — the server is the judge.
  window.mySetupNeedsSequence = function(){ return !!STATE.user && hasSequenceRole() && !!STATE.myOutreachPlan && !STATE.myOutreachPlan.tmpl_o1_body; };
  function status(){
    var boxes=myBoxes(), connected=boxes.filter(isConnected), said=boxes.filter(function(m){ return !!m.sends_as; });
    var steps=[
      { id:'mailbox', done:connected.length>0, title:'Connect your mailbox',
        text: connected.length ? plural(connected.length,'mailbox')+' connected.' : (boxes.length ? 'Added, but not signed in yet — press Connect.' : 'Outlook or Gmail — the address your outreach goes out from.') },
      { id:'sendsas', done:boxes.length>0 && said.length===boxes.length, title:'Say who each mailbox writes for',
        text: !boxes.length ? 'After a mailbox is added.' : (said.length===boxes.length ? 'Company, title and address are set.' : (boxes.length-said.length)+' of '+boxes.length+' still without a company, title and address.') }
    ];
    if (hasSequenceRole()){
      var have=!!(STATE.myOutreachPlan&&STATE.myOutreachPlan.tmpl_o1_body);
      steps.push({ id:'sequence', done:have, title:'Write your first sequence',
        text: have ? 'Your own wording is saved.' : 'Not yet — PACE will not start outreach for your leads, or write the Lead Finder\'s first email, until you have one. Individual emails are not affected.' });
    }
    var done=steps.filter(function(s){ return s.done; }).length;
    return { steps:steps, done:done, total:steps.length, all:done===steps.length, boxes:boxes };
  }

  // (There is no card on Today any more: the first tasks sit on the person's Reminders list and in "Needs you today" — one prompt, not two.)

  // PACE's first tasks for a person (a mailbox, a sequence) are put on their own list by the server, once per sign-in, and it
  // closes the ones that are done. Called at sign-in and after every step on this page.
  window.mySetupSync = function(){
    return apiPost('/my-setup/sync',{}).then(function(r){
      if (r && ((r.created&&r.created.length)||r.closed)){
        STATE.nextActions=undefined;
        return apiGet('/reminders').then(function(d){ STATE.reminders=d||[]; scheduleRender(); }).catch(function(){});
      }
    }).catch(function(){ /* a task that could not be placed is never a reason for anything to fail */ });
  };

  // "These leads got no email — their owner has no sequence yet" (the answer of /emails/generate). One sentence, and the way to fix it.
  window.noteNeedsSequence = function(r){
    var list=(r&&r.needs_sequence)||[]; if(!list.length) return false;
    var mine=list.some(function(n){ return n.user_id===meId(); });
    var others=list.filter(function(n){ return n.user_id!==meId(); });
    var names=others.map(function(n){ return (n.name||'Someone')+' ('+n.leads+(n.leads===1?' lead':' leads')+')'; }).join(', ');
    var body=(mine?'<p>No email was written for your own leads: <strong>you have not written your sequence yet</strong>, and PACE does not start outreach without one. A starter with your company\'s name is one click.</p>':'')+
      (others.length?'<p>No email was written for '+esc(names)+' — they have not written their own sequence yet. They are asked to on their own My Setup page.</p>':'')+
      '<p class="fd-hint">Emails already waiting to go out are not affected, and individual emails never need a sequence.</p>';
    STATE.modal='<div class="modal modal-w480" onclick="event.stopPropagation()"><div class="mh"><div class="mt">Sequence first</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
      '<div class="mb_">'+body+'</div><div class="mf"><button class="btn btn-outline" onclick="closeModal()">Not now</button>'+
      (mine?'<button class="btn btn-primary" onclick="closeModal();goPage(\'mysetup\')">Open My Setup</button>':'')+'</div></div>';
    render(); return true;
  };

  // ── routing ──────────────────────────────────────────────────────────────
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='mysetup'){
      STATE.page='mysetup'; STATE.modal=null; render();
      if (meId()){
        loadUserEmails(meId());                                  // fresh connection state, sends-as and signatures
        apiGet('/my-setup/send-window').then(function(r){ M.win=r; M.winForm=null; scheduleRender(); }).catch(function(){});
        if (hasSequenceRole()) apiGet('/outreach-plan').then(function(p2){ loadPlan(p2); }).catch(function(){});
      }
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };
  UI.registerPage('mysetup', function(){ return renderPage(); });
  // The plan as the sign-in loader reads it (so the Email page's editor shows the starter too).
  function loadPlan(plan){
    plan=plan||{}; STATE.myOutreachPlan=plan;
    if(plan.tmpl_o1_subject)STATE.emailSubj=plan.tmpl_o1_subject; if(plan.tmpl_o1_body)STATE.emailBody=plan.tmpl_o1_body;
    if(plan.tmpl_fu1_subject)STATE.fu1Subj=plan.tmpl_fu1_subject; if(plan.tmpl_fu1_body)STATE.fu1Body=plan.tmpl_fu1_body;
    if(plan.tmpl_fu2_subject)STATE.fu2Subj=plan.tmpl_fu2_subject; if(plan.tmpl_fu2_body)STATE.fu2Body=plan.tmpl_fu2_body;
    scheduleRender();
  }

  // ── the page ─────────────────────────────────────────────────────────────
  function badge(m){
    var c=m.connection||{};
    if (isConnected(m) && c.status && c.status!=='ok' && c.status!=='connected') return '<span class="ms-tag is-warn">Sign-in expired — reconnect</span>';
    return isConnected(m) ? '<span class="ms-tag is-ok">Connected</span>' : '<span class="ms-tag is-warn">Not signed in yet</span>';
  }
  function platformOf(m){ return /gmail|google/i.test(m.platform||'') ? 'Gmail' : 'Outlook'; }
  // Just the details, no explanation: who it writes as and where the signature stands.
  function writesFor(m){
    var s=m.sends_as;
    if (!s) return '<div class="ms-for is-none"><strong>Sender &amp; signature:</strong> not set</div>';
    var bits=[s.title, s.company].filter(Boolean).map(esc).join(' · ');
    var more=[s.phone, s.website, s.address].filter(Boolean).map(esc).join(' · ');
    return '<div class="ms-for"><strong>'+bits+'</strong>'+(more?'<div class="fd-hint">'+more+'</div>':'')+'</div>';
  }
  function boxRow(m){
    var plat=platformOf(m);
    return '<div class="ms-box">'+
      '<div class="fd-row fd-between"><div class="fd-grow"><div class="fs-14 fd-strong">'+esc(m.email_address)+'</div>'+
        '<div class="fd-hint">'+plat+' · shown to recipients as “'+esc(m.display_name||m.email_address)+'” · up to '+esc(String(m.daily_send_limit||150))+' emails a day (set by an admin)</div></div>'+
        badge(m)+'</div>'+
      writesFor(m)+
      '<div class="fd-row">'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupEdit(\''+m.id+'\')">'+(m.sends_as?'Edit sender &amp; signature':'Set up sender &amp; signature')+'</button>'+
        '<button class="btn btn-sm '+(isConnected(m)?'btn-outline':'btn-primary')+'" onclick="mySetupConnect(\''+m.id+'\')">'+(isConnected(m)?'Reconnect':'Connect '+plat)+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupRemove(\''+m.id+'\')">Remove</button>'+
      '</div></div>';
  }
  function stepActions(x){
    if (x.id==='sequence') return x.done
      ? '<button class="btn btn-sm btn-outline" onclick="mySetupOpenSequence()">Open it</button>'
      : '<span class="fd-row"><button class="btn btn-sm btn-primary" onclick="mySetupStarter()" title="The standard wording with your company\'s name in it, saved as YOUR sequence — edit it afterwards">Use the starter</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupOpenSequence()">Write my own</button></span>';
    if (x.id==='mailbox' && !x.done) return '<button class="btn btn-sm btn-primary" onclick="mySetupAdd(\'Microsoft\')">Add a mailbox</button>';
    return '';
  }
  // ── sending days and hours ───────────────────────────────────────────────
  function hourLabel(h){ var n=h%12||12; return n+(h<12||h===24?' AM':' PM'); }
  function windowCard(){
    var w=M.win; if(!w) return '<div class="card fd-form"><div class="fs-14 fd-strong">Sending days and hours</div><div class="fd-hint">Loading…</div></div>';
    var f=M.winForm||(M.winForm={ days:(w.prefs.days||w.days).slice(), start:w.prefs.start==null?w.org.start:w.prefs.start, end:w.prefs.end==null?w.org.end:w.prefs.end });
    var names={ mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
    var days=['mon','tue','wed','thu','fri','sat','sun'].map(function(d){
      return '<label class="fd-use"><input type="checkbox" '+(f.days.indexOf(d)>=0?'checked':'')+' onclick="mySetupWinDay(\''+d+'\')"> '+names[d]+'</label>'; }).join('');
    function opts(from,to,sel){ var o=''; for(var h=from;h<=to;h++) o+='<option value="'+h+'"'+(h===sel?' selected':'')+'>'+hourLabel(h)+'</option>'; return o; }
    var eff=w.effective;
    var dayWords=eff.days?eff.days.map(function(d){ return names[d]; }).join(', '):'every day';
    return '<div class="card fd-form"><div class="fs-14 fd-strong">Sending days and hours</div>'+
      '<div class="fd-hint">Your outreach goes out '+esc(dayWords)+', '+hourLabel(eff.start)+' – '+hourLabel(eff.end)+' in the lead\'s own time. Your organisation allows '+hourLabel(w.org.start)+' – '+hourLabel(w.org.end)+'; you can narrow that, not widen it. The daily number of emails stays with your admin.</div>'+
      '<div class="fd-row">'+days+'</div>'+
      '<div class="fd-row"><label class="fd-use">From <select id="ms-win-start" class="sel" onchange="mySetupWinHour()">'+opts(w.org.start,w.org.end-1,f.start)+'</select></label>'+
        '<label class="fd-use">until <select id="ms-win-end" class="sel" onchange="mySetupWinHour()">'+opts(w.org.start+1,w.org.end,f.end)+'</select></label>'+
        '<button class="btn btn-sm btn-primary" onclick="mySetupWinSave()">Save</button>'+
        (eff.narrowed?'<button class="btn btn-sm btn-outline" onclick="mySetupWinReset()">Use my organisation\'s hours</button>':'')+'</div></div>';
  }
  window.mySetupWinDay = function(d){ var f=M.winForm; if(!f) return; var i=f.days.indexOf(d); if(i>=0) f.days.splice(i,1); else f.days.push(d); };
  window.mySetupWinHour = function(){ var f=M.winForm; if(!f) return; var s=document.getElementById('ms-win-start'), e=document.getElementById('ms-win-end'); if(s) f.start=Number(s.value); if(e) f.end=Number(e.value); };
  window.mySetupWinSave = function(){
    var f=M.winForm; if(!f) return; mySetupWinHour();
    apiPut('/my-setup/send-window',{ days:f.days, start:f.start, end:f.end }).then(function(r){ M.win=r; M.winForm=null; showToast('Saved — your outreach follows these days and hours','success'); scheduleRender(); })
      .catch(function(e){ showToast((e&&e.message)||String(e),'error'); });
  };
  window.mySetupWinReset = function(){
    apiPut('/my-setup/send-window',{ reset:true }).then(function(r){ M.win=r; M.winForm=null; showToast('Back to your organisation\'s hours','info'); scheduleRender(); })
      .catch(function(e){ showToast((e&&e.message)||String(e),'error'); });
  };

  function renderPage(){
    var s=status();
    var steps=s.steps.map(function(x,i){
      return '<div class="ms-step'+(x.done?' is-done':'')+'"><span class="ms-num">'+(x.done?'✓':(i+1))+'</span>'+
        '<div class="fd-grow"><div class="fd-strong">'+esc(x.title)+'</div><div class="fd-hint">'+esc(x.text)+'</div></div>'+stepActions(x)+'</div>';
    }).join('');
    var boxes=s.boxes.length ? s.boxes.map(boxRow).join('') : '<div class="fd-empty">No mailbox yet.<br>Add the address your outreach should go out from.</div>';
    var style='<div class="card fd-form"><div class="fd-row fd-between"><div><div class="fs-14 fd-strong">How the AI writes for you</div>'+
      '<div class="fd-hint">A short note on your voice — it shapes every email the AI drafts under your name. Optional.</div></div>'+
      '<button class="btn btn-sm btn-outline" onclick="mySetupOpenStyle()">Open my writing style</button></div></div>';
    return UI.page({ body:
      '<div class="card fd-form"><div class="fs-14 fd-strong">Your outreach setup · '+s.done+' of '+s.total+' done</div>'+
        '<div class="fd-hint">This is yours — nobody else\'s setup is changed by what you do here.</div>'+steps+'</div>'+
      '<div class="card fd-form"><div class="fd-row fd-between"><div class="fs-14 fd-strong">Your mailboxes</div>'+
        '<span class="fd-row"><button class="btn btn-sm btn-primary" onclick="mySetupAdd(\'Microsoft\')">+ Add Outlook mailbox</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mySetupAdd(\'Gmail\')">+ Add Gmail mailbox</button></span></div>'+boxes+'</div>'+
      windowCard()+style });
  }

  // ── the starter sequence ─────────────────────────────────────────────────
  window.mySetupStarter = function(){
    apiPost('/my-setup/sequence/starter',{}).then(function(r){
      loadPlan(Object.assign({}, STATE.myOutreachPlan||{}, r.plan||{}));
      showToast('Your sequence is saved — it uses '+r.company+'. Edit the wording any time on the Email page.','success'); mySetupSync();
    }).catch(function(e){ showToast((e&&e.message)||String(e),'warning'); });
  };
  window.mySetupOpenSequence = function(){ STATE.emailTab='sequence'; STATE.seqView='wording'; goPage('email'); };
  window.mySetupOpenStyle = function(){ STATE.emailTab='sequence'; STATE.seqView='style'; goPage('email'); };

  // ═════ THE WINDOW: add a mailbox, or change who one writes for and what its signature looks like ═════
  var FIELDS=[ ['company','Company it writes for','e.g. Acme Talent LLC',true], ['title','Your job title','e.g. Vice President',true],
               ['address','Company postal address','Street, city, state, ZIP — every outreach email must carry the sender\'s own',true],
               ['phone','Phone (optional)','+1 555 010 0100',false], ['website','Website (optional)','acmetalent.com',false] ];
  var DEFAULT_ACCENT='#1E7A3C';

  // The signature built from what is typed — the SAME words as the server builds (email-signature.js signatureFromSendsAs; a test
  // compares the two). {{sender}} and {{senderemail}} stay merge fields: they are filled from the mailbox that sends.
  function siteHref(w){ var t=String(w||'').trim(); if(!t) return ''; return /^https?:\/\//i.test(t)?t:'https://'+t; }
  window.mySetupBuildSig = function(s){
    s=s||{}; var accent=s.accent||DEFAULT_ACCENT;
    var line=function(h){ return '<p style="margin:0 0 3px;color:#333">'+h+'</p>'; };
    var contact=['<a href="mailto:{{senderemail}}" style="color:'+accent+';text-decoration:none">{{senderemail}}</a>']
      .concat(s.phone?[esc(s.phone)]:[])
      .concat(s.website?['<a href="'+esc(siteHref(s.website))+'" style="color:'+accent+';text-decoration:none">'+esc(String(s.website).replace(/^https?:\/\//i,''))+'</a>']:[]);
    var text='<p style="margin:0 0 3px"><strong style="color:'+accent+'">{{sender}}</strong></p>'
      +line(esc(s.title||'')+(s.title&&s.company?' | ':'')+'<strong>'+esc(s.company||'')+'</strong>')
      +line(contact.join(' | '))
      +'<p style="margin:0;color:#555;font-size:12px">'+esc(s.address||'')+'</p>';
    var body=s.logo
      ? '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse"><tr>'
        +'<td valign="top" style="padding:0 14px 0 0"><img src="'+esc(s.logo)+'" alt="'+esc(s.company||'Logo')+'" height="56" style="display:block;height:56px;width:auto;border:0"></td>'
        +'<td valign="top">'+text+'</td></tr></table>'
      : text;
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.45">'+body+'</div>';
  };
  function fieldsNow(f){
    var g=function(id){ var e=document.getElementById(id); return e?String(e.value||'').trim():null; };
    var o={}; FIELDS.forEach(function(x){ var v=g('ms-'+x[0]); o[x[0]]=v===null?(f[x[0]]||''):v; });
    return o;
  }
  function sigSource(f){                       // what the preview is built from: the typed fields, the logo being shown, the logo's colour
    var o=fieldsNow(f); o.logo=f.logoData||f.logoUrl||''; if(f.useLogoColours&&f.accent) o.accent=f.accent; return o;
  }
  function editorHtml(f){
    if (f.sigEdited && f.sigHtml) return f.sigHtml;
    var html=sigToEditor(mySetupBuildSig(sigSource(f)));
    return html.replace(/<img /g,'<img data-ms-logo="1" ');
  }

  function formHtml(f){
    var head = f.mode==='add'
      ? '<div class="fgrp"><label class="flbl">Email address *</label><input class="inp" id="ms-email" type="email" placeholder="you@yourcompany.com" value="'+esc(f.email)+'" oninput="mySetupPreview()"></div>'+
        '<div class="fgrp"><label class="flbl">Name recipients see</label><input class="inp" id="ms-name" placeholder="Your full name" value="'+esc(f.name)+'" oninput="mySetupPreview()"></div>'
      : '<div class="fd-hint">'+esc(f.email)+'</div>';
    var body=FIELDS.map(function(x){
      return '<div class="fgrp"><label class="flbl">'+x[1]+(x[3]?' *':'')+'</label><input class="inp" id="ms-'+x[0]+'" placeholder="'+esc(x[2])+'" value="'+esc(f[x[0]])+'" oninput="mySetupPreview()"></div>';
    }).join('');
    var fonts=['Arial','Georgia','Times New Roman','Verdana','Tahoma','Trebuchet MS','Courier New'].map(function(n){ return '<option value="'+esc(n)+'">'+esc(n)+'</option>'; }).join('');
    var sizes=[10,11,12,13,14,16,18,20,24].map(function(n){ return '<option value="'+n+'">'+n+'</option>'; }).join('');
    var tb=function(cmd,label,title,style){ return '<button type="button" class="ms-tb" title="'+title+'" onmousedown="event.preventDefault()" onclick="mySetupCmd(\''+cmd+'\')"'+(style?' style="'+style+'"':'')+'>'+label+'</button>'; };
    var toolbar='<div class="ms-toolbar" role="toolbar" aria-label="Format the signature">'+
      '<select class="sel ms-tb-sel" id="ms-font" title="Font" onchange="mySetupFont(this.value)"><option value="">Font</option>'+fonts+'</select>'+
      '<select class="sel ms-tb-sel" id="ms-size" title="Size (px)" onchange="mySetupSize(this.value)"><option value="">Size</option>'+sizes+'</select>'+
      '<label class="ms-tb ms-tb-col" title="Text colour">A<input type="color" id="ms-colour" value="#222222" onchange="mySetupColour(this.value)"></label>'+
      tb('bold','B','Bold','font-weight:700')+tb('italic','I','Italic','font-style:italic')+tb('underline','U','Underline','text-decoration:underline')+tb('strikeThrough','S','Strikethrough','text-decoration:line-through')+
      tb('justifyLeft','⯇','Align left')+tb('justifyCenter','≡','Centre')+tb('justifyRight','⯈','Align right')+
      '<button type="button" class="ms-tb" title="Turn the selected words into a link" onmousedown="event.preventDefault()" onclick="mySetupLink()">Link</button>'+
      tb('removeFormat','Clear','Clear formatting from the selected words')+'</div>';
    var haveLogo=!!(f.logoData||f.logoUrl);
    var logo='<div class="fd-row ms-logo"><span class="fd-strong fs-12">Logo (optional)</span>'+
      (haveLogo?'<img class="ms-logo-thumb" alt="Your logo" src="'+esc(f.logoData||f.logoUrl)+'">':'')+
      '<label class="btn btn-sm btn-outline">'+(haveLogo?'Change logo':'Add a logo')+'<input type="file" id="ms-logo-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onchange="mySetupLogoPick(this)"></label>'+
      (haveLogo?'<button type="button" class="btn btn-sm btn-outline" onclick="mySetupLogoRemove()">Remove</button>':'')+
      (haveLogo&&f.accent?'<label class="fd-use"><input type="checkbox" id="ms-logo-colours" '+(f.useLogoColours?'checked':'')+' onchange="mySetupLogoColours(this.checked)"> Use the logo\'s colour for the name and links <span class="ms-swatch" style="background:'+esc(f.accent)+'"></span></label>':'')+
      '</div>'+(f.logoNote?'<div class="fd-hint">'+esc(f.logoNote)+'</div>':'');
    var rebuild = f.mode==='edit'
      ? '<label class="fd-use fd-block"><input type="checkbox" id="ms-rebuild" '+(f.rebuild?'checked':'')+'> Replace this mailbox\'s signature with the one below'+(f.hasSig?' (the one it has now is replaced)':'')+'</label>' : '';
    return head+'<div class="fd-label">This mailbox writes for</div>'+body+logo+
      '<div class="fd-label">Its signature <span class="fd-hint">— click in it to change it; select words, then use the bar</span></div>'+toolbar+
      '<div id="sig-editor" class="ms-preview ms-sig" contenteditable="true" spellcheck="false" oninput="mySetupSigEdited()" onkeyup="mySetupRemember()" onmouseup="mySetupRemember()">'+editorHtml(f)+'</div>'+
      '<div class="fd-hint ms-sig-note">'+(f.sigEdited?'You have formatted this by hand, so changes above do not overwrite it. <button type="button" class="fd-pill" onclick="mySetupRebuildSig()">Rebuild it from the details above</button>':'It follows the details above until you change it here.')+'</div>'+
      rebuild+(f.err?'<div class="ld-box is-stop" role="alert">'+esc(f.err)+'</div>':'');
  }
  function captureSig(){ var f=M.form, el=document.getElementById('sig-editor'); if(f&&el&&f.sigEdited) f.sigHtml=el.innerHTML; }
  function paintModal(){
    var f=M.form; if(!f){ STATE.modal=null; STATE._sigIdentityOverride=null; render(); return; }
    captureSig();
    var plat=f.platform==='Gmail'?'Gmail':'Outlook';
    var me=STATE.user||{};
    STATE._sigIdentityOverride={ name:f.name||me.name||'Your name', email:f.email||'you@yourcompany.com' };
    STATE.modal='<div class="modal modal-w640" onclick="event.stopPropagation()"><div class="mh"><div class="mt">'+(f.mode==='add'?'Add '+plat+' mailbox':'Who this mailbox writes for')+'</div>'+
      '<button class="btn-icon" onclick="mySetupClose()">'+ico('x',14)+'</button></div>'+
      '<div class="mb_" style="max-height:68vh;overflow:auto">'+formHtml(f)+'</div>'+
      '<div class="mf"><button class="btn btn-outline" onclick="mySetupClose()">Cancel</button>'+
      '<button class="btn btn-primary" '+(f.busy?'disabled':'')+' onclick="mySetupSave()">'+(f.busy?'Saving…':(f.mode==='add'?'Save & connect '+plat:'Save'))+'</button></div></div>';
    render();
  }
  function readForm(){
    var f=M.form, g=function(id){ var e=document.getElementById(id); return e?String(e.value||'').trim():null; };
    if (f.mode==='add'){ var em=g('ms-email'), nm=g('ms-name'); if(em!==null) f.email=em; if(nm!==null) f.name=nm; }
    FIELDS.forEach(function(x){ var v=g('ms-'+x[0]); if(v!==null) f[x[0]]=v; });
    var rb=document.getElementById('ms-rebuild'); if(rb) f.rebuild=!!rb.checked;
    captureSig();
  }

  // The signature follows the typed details until the person formats it by hand; then it is theirs.
  window.mySetupPreview = function(){
    var f=M.form; if(!f) return;
    if (f.mode==='add'){ var em=document.getElementById('ms-email'), nm=document.getElementById('ms-name');
      STATE._sigIdentityOverride={ name:(nm&&nm.value.trim())||f.name||(STATE.user&&STATE.user.name)||'Your name', email:(em&&em.value.trim())||f.email||'you@yourcompany.com' }; }
    if (f.sigEdited) return;
    var el=document.getElementById('sig-editor'); if(!el) return;
    el.innerHTML=editorHtml(f);
  };
  window.mySetupSigEdited = function(){ var f=M.form; if(!f) return; if(!f.sigEdited){ f.sigEdited=true; var n=document.querySelector('.ms-sig-note'); if(n) n.innerHTML='You have formatted this by hand, so changes above do not overwrite it. <button type="button" class="fd-pill" onclick="mySetupRebuildSig()">Rebuild it from the details above</button>'; } };
  window.mySetupRebuildSig = function(){ var f=M.form; if(!f) return; readForm(); f.sigEdited=false; f.sigHtml=''; f.logoNote=''; paintModal(); };
  window.mySetupRemember = function(){ var sel=window.getSelection&&window.getSelection(), el=document.getElementById('sig-editor'); if(sel&&sel.rangeCount&&el&&el.contains(sel.anchorNode)) M.range=sel.getRangeAt(0).cloneRange(); };
  function restoreRange(){
    var el=document.getElementById('sig-editor'); if(!el) return null;
    el.focus(); var sel=window.getSelection();
    if (M.range && el.contains(M.range.commonAncestorContainer)){ sel.removeAllRanges(); sel.addRange(M.range); }
    if (!sel.rangeCount) return null;
    // The name and the email are small locked chips filled in by PACE. Formatting a few letters INSIDE one would be thrown away when the
    // chip is turned back into {{sender}} on save (and the browser will not format locked text) — so a selection that touches a chip
    // takes the whole chip, and the formatting goes around it.
    var r=sel.getRangeAt(0), chip=function(n){ while(n&&n.nodeType!==1) n=n.parentNode; return n&&n.closest?n.closest('.sig-ph'):null; };
    var a=chip(r.startContainer), b=chip(r.endContainer);
    if (a||b){ if(a) r.setStartBefore(a); if(b) r.setEndAfter(b); sel.removeAllRanges(); sel.addRange(r); }
    return r;
  }
  window.mySetupCmd = function(cmd){
    var r=restoreRange(); if(!r) return;
    var el=document.getElementById('sig-editor'), before=el.innerHTML;
    try{ document.execCommand(cmd,false,null); }catch(e){}
    // The browser will not format a locked chip (the name, the email). When it did nothing, do the same thing by hand around the selection.
    if (el.innerHTML===before){
      var P={ bold:['fontWeight','bold'], italic:['fontStyle','italic'], underline:['textDecoration','underline'], strikeThrough:['textDecoration','line-through'] }[cmd];
      if (P){
        var rr=restoreRange(), sp=rr&&rr.startContainer;
        while (sp && (sp.nodeType!==1 || sp.tagName!=='SPAN')) sp=sp.parentNode;
        if (sp && sp!==el && !sp.hasAttribute('data-ph') && sp.style[P[0]]===P[1] && el.contains(sp) && rr.toString()===sp.textContent){
          sp.style[P[0]]=''; if(!sp.getAttribute('style')){ while(sp.firstChild) sp.parentNode.insertBefore(sp.firstChild,sp); sp.remove(); }
        } else { var s={}; s[P[0]]=P[1]; wrapSelection(s); }
      }
    }
    mySetupRemember(); mySetupSigEdited();
  };
  window.mySetupLink = function(){ restoreRange(); sigLink(); mySetupRemember(); mySetupSigEdited(); };
  // Font, size and colour are written as plain inline styles on the selected words (not the browser's <font> tags), so they look the
  // same in every mail client.
  function wrapSelection(style){
    var r=restoreRange();
    if(!r||r.collapsed){ showToast('Select the words you want to change first','info'); return false; }
    var span=document.createElement('span'); Object.keys(style).forEach(function(k){ span.style[k]=style[k]; });
    span.appendChild(r.extractContents()); r.insertNode(span);
    var sel=window.getSelection(), nr=document.createRange(); nr.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(nr); M.range=nr.cloneRange();
    mySetupSigEdited(); return true;
  }
  window.mySetupFont = function(v){ if(v) wrapSelection({ fontFamily:v+', Arial, sans-serif' }); var e=document.getElementById('ms-font'); if(e) e.value=''; };
  window.mySetupSize = function(v){ if(v) wrapSelection({ fontSize:v+'px' }); var e=document.getElementById('ms-size'); if(e) e.value=''; };
  window.mySetupColour = function(v){ if(v) wrapSelection({ color:v }); };

  // ── the logo ─────────────────────────────────────────────────────────────
  // Resized in the browser to at most 120px tall (a signature logo is small), then kept as a picture to upload on Save.
  function dominantColour(ctx,w,h){
    var d=ctx.getImageData(0,0,w,h).data, r=0,g=0,b=0,n=0;
    for (var i=0;i<d.length;i+=4){
      if (d[i+3]<200) continue;
      var mx=Math.max(d[i],d[i+1],d[i+2]), mn=Math.min(d[i],d[i+1],d[i+2]);
      if (mx-mn<40||mx>235||mx<30) continue;            // skip white, black and grey: the brand colour is what is left
      r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++;
    }
    if (!n) return null;
    var hx=function(v){ var s=Math.round(v/n).toString(16); return s.length<2?'0'+s:s; };
    return '#'+hx(r)+hx(g)+hx(b);
  }
  window.mySetupLogoPick = function(input){
    var f=M.form, file=input&&input.files&&input.files[0]; if(!f||!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)){ f.logoNote='The logo must be a PNG, JPEG, GIF or WEBP picture.'; readForm(); paintModal(); return; }
    var rd=new FileReader();
    rd.onload=function(){
      var img=new Image();
      img.onload=function(){
        var maxH=120, maxW=420, k=Math.min(1, maxH/img.height, maxW/img.width);
        var w=Math.max(1,Math.round(img.width*k)), h=Math.max(1,Math.round(img.height*k));
        var c=document.createElement('canvas'); c.width=w; c.height=h; var cx=c.getContext('2d'); cx.drawImage(img,0,0,w,h);
        var data=c.toDataURL('image/png');
        if (data.length*0.75>190*1024) data=c.toDataURL('image/jpeg',0.85);
        if (data.length*0.75>190*1024){ f.logoNote='That logo is too big even after shrinking — use a simpler picture.'; readForm(); paintModal(); return; }
        readForm();
        f.logoData=data; f.logoUrl=''; f.logoNote=''; f.accent=dominantColour(cx,w,h); f.useLogoColours=!!f.accent; f.logoChanged=true;
        if (f.sigEdited) f.logoNote='Your signature is formatted by hand — press "Rebuild it from the details above" to put the logo into it.';
        paintModal();
      };
      img.onerror=function(){ f.logoNote='That file could not be read as a picture.'; paintModal(); };
      img.src=rd.result;
    };
    rd.readAsDataURL(file);
  };
  window.mySetupLogoRemove = function(){ var f=M.form; if(!f) return; readForm(); f.logoData=''; f.logoUrl=''; f.accent=null; f.useLogoColours=false; f.logoChanged=true; f.logoNote=f.sigEdited?'Your signature is formatted by hand — press "Rebuild it from the details above" to take the logo out of it.':''; paintModal(); };
  window.mySetupLogoColours = function(on){ var f=M.form; if(!f) return; f.useLogoColours=!!on; if(!f.sigEdited) mySetupPreview(); };

  // ── opening the window ───────────────────────────────────────────────────
  window.mySetupClose = function(){ M.form=null; M.range=null; STATE.modal=null; STATE._sigIdentityOverride=null; render(); };
  window.mySetupAdd = function(platform){
    var u=STATE.user||{}, last=(myBoxes().filter(function(m){ return m.sends_as; })[0]||{}).sends_as||{};
    M.form={ mode:'add', platform:platform, id:null, email:'', name:u.name||'', company:last.company||'', title:last.title||u.designation||'', address:last.address||'', phone:last.phone||'', website:last.website||'',
             logoData:'', logoUrl:last.logo||'', accent:last.accent||null, useLogoColours:!!last.accent, logoChanged:false, logoNote:'', sigEdited:false, sigHtml:'', busy:false, err:'' };
    M.range=null; paintModal();
  };
  window.mySetupEdit = function(id){
    var m=myBoxes().filter(function(x){ return x.id===id; })[0]; if(!m) return;
    var s=m.sends_as||{};
    M.form={ mode:'edit', platform:platformOf(m), id:id, email:m.email_address, name:m.display_name||'', company:s.company||'', title:s.title||(STATE.user&&STATE.user.designation)||'', address:s.address||'', phone:s.phone||'', website:s.website||'',
             logoData:'', logoUrl:s.logo||'', accent:s.accent||null, useLogoColours:!!s.accent, logoChanged:false, logoNote:'', rebuild:!m.has_own_signature, hasSig:!!m.has_own_signature, sigEdited:false, sigHtml:'', busy:false, err:'' };
    M.range=null; paintModal();
  };
  function sendsAsOf(f){
    var o={ company:f.company, title:f.title, address:f.address, phone:f.phone, website:f.website };
    if (f.logoUrl) o.logo=f.logoUrl;
    if (f.useLogoColours && f.accent && (f.logoUrl||f.logoData)) o.accent=f.accent;
    return o;
  }
  function missing(f){
    if (f.mode==='add' && !f.email) return 'Add the mailbox\'s email address.';
    if (!f.company) return 'Say which company this mailbox writes for.';
    if (!f.title) return 'Add the job title that goes under your name.';
    if (!f.address || f.address.length<8) return 'Add the company\'s postal address — every outreach email must carry the sender\'s own.';
    return '';
  }
  // The signature as the person left it: placeholders back to {{sender}}, anything that could run taken out, my own markers removed.
  function currentSignatureHtml(){
    var html=sigFromEditor(); if(html===null) return null;
    return html.replace(/\sdata-ms-logo="1"/g,'');
  }
  window.mySetupSave = function(){
    var f=M.form; if(!f||f.busy) return;
    readForm(); f.err=missing(f);
    if (f.err){ paintModal(); return; }
    var typedHtml=f.sigEdited?currentSignatureHtml():null;      // read BEFORE the window repaints
    f.busy=true; f.err=''; paintModal();
    var me=meId();
    // Step 2 (after the mailbox exists): the logo, if one was chosen, goes up to PACE's logo store; then the details and the
    // signature are saved with its address in place of the picture held here.
    var picture=f.logoData;                                       // kept here: a failed upload clears f.logoData, but the signature still holds the picture
    var done=function(mailboxId, isNew){
      var finish=function(logoUrl){
        var sa=sendsAsOf(f); if(logoUrl) sa.logo=logoUrl; else if(f.logoChanged && !f.logoData) delete sa.logo;
        var html=typedHtml;
        if (html && picture) html = logoUrl ? html.split(picture).join(logoUrl) : html.replace(/<img[^>]*data-ms-logo[^>]*>/g,'').replace(/<img[^>]*src="data:image[^"]*"[^>]*>/g,'');
        if (isNew && !html && !f.logoChanged) return Promise.resolve();            // nothing beyond what was saved with the mailbox
        var body=Object.assign({}, sa);
        if (html) body.signature_html=html;
        else if (f.logoChanged || (!isNew && f.rebuild)) body.rebuild_signature=true;
        return apiPut('/users/'+me+'/emails/'+mailboxId+'/sends-as', body).then(function(r){
          var m=myBoxes().filter(function(x){ return x.id===mailboxId; })[0];
          if (m){ m.sends_as=r.sends_as; if (r.signature_rebuilt) m.has_own_signature=true; }
        });
      };
      if (f.logoData){
        return apiPost('/users/'+me+'/emails/'+mailboxId+'/signature-logo',{ data_base64:String(f.logoData).split(',').pop() }).then(function(r){ return finish(r.url); },
          function(er){ f.logoNote=(er&&er.message)||'The logo could not be saved.'; f.logoData=''; f.logoChanged=false; f.useLogoColours=false; f.accent=null; return finish(''); });
      }
      return finish('');
    };
    if (f.mode==='add'){
      apiPost('/users/'+me+'/emails',{ email_address:f.email, display_name:f.name||f.email, platform:f.platform==='Gmail'?'Gmail':'Microsoft', sends_as:sendsAsOf(f) }).then(function(e){
        STATE.userEmailsCache=STATE.userEmailsCache||{}; STATE.userEmailsCache[me]=(STATE.userEmailsCache[me]||[]).concat([Object.assign({ connection:{ connected:false, status:'none' }, has_own_signature:true }, e)]);
        return done(e.id,true).then(function(){
          var plat=f.platform, note=f.logoNote; M.form=null; STATE.modal=null; STATE._sigIdentityOverride=null; render();
          showToast(note?('Mailbox added — '+note):'Mailbox added — now sign in to it in the window that opens',note?'warning':'success');
          if (plat==='Gmail') connectGmailUserEmail(me,e.id); else connectMicrosoftUserEmail(me,e.id);
          mySetupSync();
        });
      }).catch(function(er){ f.busy=false; f.err=(er&&er.message)||String(er); paintModal(); });
    } else {
      done(f.id,false).then(function(){
        var note=f.logoNote; M.form=null; STATE.modal=null; STATE._sigIdentityOverride=null; render(); showToast(note?('Saved — '+note):'Saved',note?'warning':'success');
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
      showToast('Mailbox removed','info'); render(); mySetupSync();
    }).catch(function(er){ showToast('Failed: '+((er&&er.message)||er),'error'); });
  };

})();
