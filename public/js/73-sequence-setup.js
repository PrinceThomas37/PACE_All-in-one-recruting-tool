// ===== WRITE YOUR FIRST SEQUENCE — the new manager's sequence screen (owner, 15 Oct 2026, D-0147 … D-0154, R-258) =====
// Two short steps, opened from My Setup:
//   1. WRITE — the person chooses how the first email is written ("I write it" or "AI writes each one"), writes it with details
//      picked from a plain-words menu (shown as highlighted words, stored as {{merge fields}}), may ask AI for VERSIONS of it (the
//      engine picks one at random per lead), and adds follow-ups (N days after the first email, only if no reply).
//   2. START — the first email exactly as one of their own leads would get it (built on the server, R-256), then save and turn on.
// "AI writes each one" sets the person's AI first-email choice on; the email they write becomes the BACKUP that goes out on a
// day the AI cannot write (owner, D-0151). Every rule is on the server (routes/my-setup.js); this file asks and shows.
//
// THE EDITORS SURVIVE REPAINTS. The page registers its own painter: the page is rewritten only when its SHAPE changes (a button,
// a step, a follow-up added) — never because a letter was typed — and the live preview is updated in place. A repaint on a
// timer elsewhere in the app therefore never moves the caret.

(function () {
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // The details the menu offers — the ones nearly every lead has (owner, D-0148/D-0151). Pay is "if known": its sentence is left out.
  var DETAILS=[
    {k:'fn', label:'first name', menu:'Their first name'},
    {k:'company', label:'company', menu:'Their company'},
    {k:'pos', label:'job title', menu:'The job title'},
    {k:'city', label:'city', menu:'The city the job is in'},
    {k:'ind', label:'industry', menu:'Their industry'},
    {k:'job_resp', label:'top skills', menu:'Top skills from the job'},
    {k:'pay', label:'pay', menu:'Pay, if known', optional:true}
  ];
  // Words for details an older sequence may already use, so they show as words too.
  var MORE={ ln:'last name', desig:'their title', loc:'location', jobs:'all the jobs', skills_line:'skills phrase', salary_line:'salary',
    salary_range:'salary range', company_service:'project area', local_line:'local rule', skill_1:'skill 1', skill_2:'skill 2', skill_3:'skill 3',
    sender:'your name', senderemail:'your email', sendercompany:'your company' };
  function labelOf(k){ for(var i=0;i<DETAILS.length;i++) if(DETAILS[i].k===k) return DETAILS[i].label; return MORE[k]||k; }
  function isOptional(k){ for(var i=0;i<DETAILS.length;i++) if(DETAILS[i].k===k) return !!DETAILS[i].optional; return false; }
  var DEFAULT_DAYS=[3,7,14,21,28];

  var Q = STATE.seqSetup = STATE.seqSetup || null;
  function fresh(){ return { loaded:false, err:'', step:1, mode:null, first:{subject:'',body:'',versions:[]}, fus:[], max:5, sample:null,
    menu:'', busy:'', msg:{}, stuck:false, offer:'', preview:null, saved:false, saving:false }; }

  // ── text with details ↔ the editor's html ──────────────────────────────────
  function chipHtml(k){ return '<span class="sq-chip'+(isOptional(k)?' is-opt':'')+'" contenteditable="false" data-k="'+esc(k)+'">'+esc(labelOf(k))+'</span>'; }
  function tokensToHtml(t){
    return String(t||'').split(/({{\s*\w+\s*}})/).map(function(p){
      var m=/^{{\s*(\w+)\s*}}$/.exec(p);
      return m ? chipHtml(m[1]) : esc(p).replace(/\n/g,'<br>');
    }).join('');
  }
  // The editor's html → [{t:'text',v}|{t:'chip',k}]
  function segsOf(root){
    var out=[];
    function pushText(t){ if(!t) return; var l=out[out.length-1]; if(l&&l.t==='text') l.v+=t; else out.push({t:'text',v:t}); }
    (function walk(n){
      Array.prototype.forEach.call(n.childNodes,function(c){
        if(c.nodeType===3){ pushText(c.nodeValue.replace(/ /g,' ').replace(/​/g,'')); }
        else if(c.nodeType===1){
          if(c.classList&&c.classList.contains('sq-chip')) out.push({t:'chip',k:c.getAttribute('data-k')});
          else if(c.tagName==='BR'){ if(!c.hasAttribute('data-dummy')) pushText('\n'); }
          else if(/^(DIV|P)$/.test(c.tagName)){ if(out.length) pushText('\n'); walk(c); }
          else walk(c);
        }
      });
    })(root);
    return out;
  }
  function htmlToTokens(h){ var d=document.createElement('div'); d.innerHTML=h||''; return segsOf(d).map(function(x){ return x.t==='text'?x.v:'{{'+x.k+'}}'; }).join('').replace(/[ \t]+\n/g,'\n'); }
  function hasWords(t){ return String(t||'').replace(/{{\s*\w+\s*}}/g,'x').trim().length>0; }

  // The same fill the server does (email-vars fillTemplate), for the live preview only — the test on step 2 is the server's.
  function fill(t){
    var v=(Q.sample&&Q.sample.vars)||{};
    var s=String(t||'');
    if(!String(v.pay||'').trim()){
      s=s.split('\n').map(function(line){
        if(!/{{\s*pay\s*}}/.test(line)) return line;
        var parts=line.match(/[^.!?]*[.!?]+[ \t]*|[^.!?]+$/g)||[line];
        var kept=parts.filter(function(x){ return !/{{\s*pay\s*}}/.test(x); }).join('').replace(/^[ \t]+|[ \t]+$/g,'');
        return kept||null;
      }).filter(function(x){ return x!==null; }).join('\n');
    }
    return s.replace(/{{\s*(\w+)\s*}}/g,function(m,k){
      if(k==='sender') return (STATE.user&&STATE.user.name)||'You';
      if(k==='senderemail') return (STATE.user&&STATE.user.email)||'';
      return v[k]!=null&&v[k]!=='' ? String(v[k]) : '';
    });
  }

  // ── loading and saving ─────────────────────────────────────────────────────
  window.openSequenceSetup = function(){
    Q = STATE.seqSetup = fresh();
    goPage('seqsetup');
    apiGet('/my-setup/sequence').then(function(r){
      Q.loaded=true; Q.mode=r.mode||null; Q.max=r.followup_max==null?5:r.followup_max; Q.sample=r.sample||null;
      Q.first={ subject:tokensToHtml(r.first&&r.first.subject), body:tokensToHtml(r.first&&r.first.body),
        versions:((r.first&&r.first.versions)||[]).map(function(v){ return {subject:v.subject||'', body:v.body||''}; }) };
      Q.fus=(r.followups||[]).map(function(f){ return { day:f.day, subject:f.subject||'', body:tokensToHtml(f.body), versions:(f.versions||[]).map(function(v){ return {subject:v.subject||'',body:v.body||''}; }) }; });
      if(!Q.fus.length && Q.max>0 && !hasWords(r.first&&r.first.body)) Q.fus=[{ day:DEFAULT_DAYS[0], subject:'', body:'', versions:[] }];   // D-0147: the box starts at 1
      paint(true);
    }).catch(function(e){ Q.loaded=true; Q.err=(e&&e.message)||String(e); paint(true); });
  };
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if(p==='seqsetup'){ STATE.page='seqsetup'; STATE.modal=null; if(!Q) Q=STATE.seqSetup=fresh(); render(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function saveEditors(){
    var g=function(id){ var e=document.getElementById(id); return e?e.innerHTML:null; };
    var s=g('sq-subj'), b=g('sq-body'); if(s!==null) Q.first.subject=s; if(b!==null) Q.first.body=b;
    Q.fus.forEach(function(f,i){ var e=g('sq-fu'+i); if(e!==null) f.body=e; });
  }
  function payload(){
    saveEditors();
    return { mode:Q.mode,
      first:{ subject:htmlToTokens(Q.first.subject).replace(/\n/g,' ').trim(), body:htmlToTokens(Q.first.body).trim(), versions:Q.mode==='template'?Q.first.versions:[] },
      followups:Q.fus.map(function(f){ return { day:Number(f.day), subject:f.subject, body:htmlToTokens(f.body).trim(), versions:Q.mode==='template'?f.versions:[] }; }) };
  }

  // ── the page ───────────────────────────────────────────────────────────────
  function menuHtml(id){
    var v=(Q.sample&&Q.sample.vars)||{};
    return '<span class="sq-menuwrap"><button type="button" class="btn btn-sm btn-outline" data-sq="menu" data-menu="'+id+'" aria-haspopup="true" aria-expanded="'+(Q.menu===id)+'">Add a detail ▾</button>'+
      '<div class="sq-menu" role="menu"'+(Q.menu===id?'':' hidden')+'>'+DETAILS.map(function(d){
        var ex=v[d.k]; return '<button type="button" class="sq-it" role="menuitem" data-sq="ins" data-k="'+d.k+'"><span>'+esc(d.menu)+(d.optional?'<small>Its sentence is left out when a lead does not have it</small>':'')+'</span><span class="sq-ex">'+esc(ex||'not known for this lead')+'</span></button>';
      }).join('')+'</div></span>';
  }
  function msgHtml(key){ var m=Q.msg[key]; return m?'<p class="sq-hint" aria-live="polite">'+esc(m)+'</p>':''; }
  function dayOptions(cur, min){ var o=''; for(var n=Math.max(1,min);n<=90;n++){ if(n>30&&n%7) continue; o+='<option value="'+n+'"'+(n===Number(cur)?' selected':'')+'>'+n+(n===1?' day':' days')+'</option>'; } return o; }
  function versionsHtml(slot, list, skel){
    var first=slot==='first', room=2-list.length, busy=!!Q.busy;
    var h=list.map(function(v,i){
      return '<div class="sq-ver"><div class="sq-ver-h"><span>Version '+(i+2)+'</span><button type="button" class="sq-link" data-sq="rmv" data-slot="'+slot+'" data-i="'+i+'">Remove</button></div>'+
        '<div class="sq-ver-t">'+(skel?'':esc((first?'Subject: '+fill(v.subject||htmlToTokens(Q.first.subject))+'\n\n':'')+fill(v.body)))+'</div></div>';
    }).join('');
    if(room>0) h+='<div class="sq-row"><button type="button" class="btn btn-sm btn-outline" data-sq="vary" data-slot="'+slot+'"'+(busy?' disabled':'')+'>'+
      (Q.busy==='vary'+slot?'Writing…':'+ Add '+(first&&room>1?'2 versions':'a version')+' with AI')+'</button></div>';
    h+='<p class="sq-hint">'+(list.length?'PACE picks one version at random for each lead.':'Optional. A version says the same thing in other words, so leads do not all get the same email.')+'</p>'+msgHtml('vary'+slot);
    return h;
  }
  function editor(id, html, ph, one, skel){
    return '<div id="'+id+'" class="sq-ed'+(one?' is-one':'')+'" contenteditable="true" role="textbox"'+(one?'':' aria-multiline="true"')+' data-ph="'+esc(ph)+'">'+(skel?'':html)+'</div>';
  }
  function modeCards(){
    function c(m,t,l){ return '<button type="button" class="sq-choice" role="radio" aria-checked="'+(Q.mode===m)+'" data-sq="mode" data-mode="'+m+'"><b>'+t+'</b><span>'+l+'</span></button>'; }
    return '<div class="card sq-card"><h2 class="sq-h2">How should your first email be written?</h2>'+
      '<div class="sq-choices" role="radiogroup" aria-label="How your first email is written">'+
      c('template','I write it','Your email, filled in for each lead. AI can add versions so leads do not all get the same words.')+
      c('ai','AI writes each one','A new email for every lead from their job description. Uses AI credits.')+'</div></div>';
  }
  function stepsHtml(){
    var names=['Write','Start'];
    return '<ol class="sq-steps" aria-label="Steps">'+names.map(function(n,i){ var k=i+1; return '<li class="'+(k<Q.step?'is-done':k===Q.step?'is-on':'')+'"'+(k===Q.step?' aria-current="step"':'')+'>'+(k<Q.step?'✓ ':k+' ')+n+'</li>'; }).join('')+'</ol>';
  }
  function previewMail(skel){
    if(skel) return '';
    var subj=fill(htmlToTokens(Q.first.subject)).replace(/\n/g,' '), body=fill(htmlToTokens(Q.first.body)).trim();
    return mailHtml({subject:subj, body:body}, 'Write your email and it appears here, filled in for a real lead.');
  }
  function mailHtml(m, emptyNote){
    var s=Q.sample||{};
    return '<div class="sq-mail"><div class="sq-mrow"><b>TO</b><span>'+esc((s.name||'')+(s.company?' · '+s.company:''))+'</span></div>'+
      '<div class="sq-msub'+(m.subject?'':' is-empty')+'">'+esc(m.subject||'Your subject appears here')+'</div>'+
      '<div class="sq-mbody'+(m.body?'':' is-empty')+'">'+esc(m.body||emptyNote||'')+'</div>'+
      '<div class="sq-msig">Your signature is added from your mailbox.</div></div>';
  }
  function writeStep(skel){
    var ai=Q.mode==='ai', busy=!!Q.busy;
    if(!Q.mode) return modeCards();
    var h=modeCards();
    if(ai) h+='<div class="card sq-card"><h2 class="sq-h2">The AI writes each first email</h2>'+
      '<p class="sq-sub">For every lead, from its job description, in the voice of your writing-style note (My Setup → How the AI writes for you). Each one uses AI credits.</p></div>';
    h+='<div class="card sq-card"><h2 class="sq-h2">'+(ai?'Your backup email':'Your first email')+'</h2>'+
      (ai?'<p class="sq-sub">Goes out instead on a day the AI cannot write (for example when your company\'s AI credits run out).</p>':'')+
      '<label class="sq-lbl" for="sq-subj">Subject</label>'+editor('sq-subj',Q.first.subject,'A short subject line',true,skel)+
      '<label class="sq-lbl" for="sq-body">Message</label>'+editor('sq-body',Q.first.body,'Write it the way you would write to one person: why you are writing, what you can offer, and one question.',false,skel)+
      '<div class="sq-row">'+menuHtml('first')+'<button type="button" class="sq-link" data-sq="stuck">Stuck? Draft it with AI</button></div>'+
      '<div class="sq-stuck"'+(Q.stuck?'':' hidden')+'><label class="sq-lbl" for="sq-offer">What do you offer? One sentence.</label>'+
        '<input id="sq-offer" class="sq-inp" placeholder="e.g. pre-screened Java developers in the job\'s city" value="'+esc(Q.offer)+'">'+
        '<div class="sq-row"><button type="button" class="btn btn-sm btn-outline" data-sq="draft"'+(busy?' disabled':'')+'>'+(Q.busy==='draft'?'Writing…':'Draft it with AI')+'</button>'+
        (Q.undo?'<button type="button" class="sq-link" data-sq="undo">Undo</button>':'')+'</div></div>'+
      msgHtml('first')+(ai?'':versionsHtml('first',Q.first.versions,skel))+'</div>';
    Q.fus.forEach(function(f,i){
      var min=i?Number(Q.fus[i-1].day)+1:1;
      h+='<div class="card sq-card"><div class="sq-row sq-between"><h2 class="sq-h2">Follow-up'+(Q.fus.length>1?' '+(i+1):'')+'</h2><button type="button" class="sq-link" data-sq="rmfu" data-i="'+i+'">Remove</button></div>'+
        '<p class="sq-sub">Sent <select class="sq-sel" data-sq-day="'+i+'" aria-label="Days after the first email">'+dayOptions(f.day,min)+'</select> after the first email, only if they have not replied.</p>'+
        editor('sq-fu'+i,f.body,'A short nudge. Remind them what you asked.',false,skel)+
        '<div class="sq-row">'+menuHtml('fu'+i)+'<button type="button" class="sq-link" data-sq="fudraft" data-i="'+i+'"'+(busy?' disabled':'')+'>'+(Q.busy==='fudraft'+i?'Writing…':'Write one with AI from my first email')+'</button></div>'+
        msgHtml('fu'+i)+(ai?'':versionsHtml(String(i),f.versions,skel))+'</div>';
    });
    if(Q.fus.length<Q.max) h+='<div><button type="button" class="btn btn-outline" data-sq="addfu">+ '+(Q.fus.length?'Add another follow-up':'Add a follow-up')+'</button></div>';
    h+='<div class="card sq-card"><h2 class="sq-h4">'+(ai?'Your backup, filled in for ':'Your email, filled in for ')+esc((Q.sample&&Q.sample.name)||'a lead')+'</h2>'+
      (Q.sample&&Q.sample.example?'<p class="sq-hint">An example lead — you have no leads of your own yet.</p>':'')+
      '<div id="sq-pv">'+previewMail(skel)+'</div></div>';
    return h;
  }
  function startStep(){
    var p=Q.preview, ai=Q.mode==='ai';
    if(Q.saved) return '<div class="card sq-card"><div class="sq-ok"><b>Your sequence is on.</b> Leads assigned to you now go out by themselves'+(ai?' — the AI writes each first email, and your backup goes on a day it cannot':'')+'. Follow-ups stop when someone replies.</div>'+
      '<div class="sq-row"><button type="button" class="btn btn-primary" onclick="goPage(\'mysetup\')">Back to My Setup</button></div></div>';
    var mail='';
    if(p&&p.error) mail='<p class="sq-hint">'+esc(p.error)+'</p>';
    else if(p){
      mail='<div class="sq-tagrow"><span class="sq-tag">'+(ai?'Your backup':'Your email')+'</span></div>'+
        '<div class="sq-mail"><div class="sq-mrow"><b>TO</b><span>'+esc(p.to.name+(p.to.company?' · '+p.to.company:''))+'</span></div>'+
        '<div class="sq-msub">'+esc(p.subject)+'</div><div class="sq-mbody">'+esc(p.body)+'</div><div class="sq-msig">Your signature is added from your mailbox.</div></div>'+
        '<p class="sq-hint">'+(p.versions>1?'Version '+p.version+' of '+p.versions+', picked at random — the same way each lead gets one. ':'')+(p.example?'An example lead: you have no leads of your own yet.':'Built the way PACE builds it for this lead of yours.')+'</p>'+
        (ai?'<p class="sq-hint">With "AI writes each one", this lead gets an AI-written email; this backup goes only on a day the AI cannot write.</p>':'')+
        (p.missing&&p.missing.length?'<p class="sq-warn">These details could not be filled: '+esc(p.missing.join(', '))+'.</p>':'');
    }
    return '<div class="card sq-card"><h2 class="sq-h2">Try it, then turn it on</h2><p class="sq-sub">See exactly what one of your leads would get. If it looks right, turn it on.</p>'+
      '<div class="sq-row"><button type="button" class="btn btn-outline" data-sq="test"'+(Q.busy?' disabled':'')+'>'+(Q.busy==='test'?'Building…':(p?'Show another':'Show me what a lead gets'))+'</button></div>'+mail+'</div>'+
      '<div class="card sq-card"><div class="sq-row sq-between"><div><h2 class="sq-h4">Turn it on</h2><p class="sq-hint">'+(p&&!p.error?'Leads you are given will go out automatically.':'Available after you look at one.')+'</p></div>'+
      '<button type="button" class="btn btn-primary" data-sq="save"'+(p&&!p.error&&!Q.saving?'':' disabled')+'>'+(Q.saving?'Saving…':'Save and turn it on')+'</button></div>'+msgHtml('save')+'</div>';
  }
  function renderPage(skel){
    if(!Q) Q=STATE.seqSetup=fresh();
    var body;
    if(!Q.loaded) body='<div class="card sq-card"><p class="sq-hint">Loading your sequence…</p></div>';
    else if(Q.err) body='<div class="card sq-card"><p class="sq-warn">'+esc(Q.err)+'</p><div class="sq-row"><button class="btn btn-outline" onclick="goPage(\'mysetup\')">Back to My Setup</button></div></div>';
    else body=(Q.step===1?writeStep(skel):startStep());
    var nav=Q.loaded&&!Q.err&&!Q.saved?'<div class="sq-nav">'+
      (Q.step>1?'<button type="button" class="btn btn-outline" data-sq="back">Back</button>':'<button type="button" class="btn btn-outline" onclick="goPage(\'mysetup\')">Cancel</button>')+
      (Q.step===1?'<button type="button" class="btn btn-primary" data-sq="next"'+(Q.mode?'':' disabled')+'>Continue</button>':'<span></span>')+'</div>':'';
    return UI.page({ body:'<div id="sq-root" class="sq"><div class="sq-head"><div><div class="sq-eyebrow">My Setup</div><h1 class="sq-h1">Write your first sequence</h1></div>'+stepsHtml()+'</div>'+body+nav+'</div>' });
  }
  var _lastSkel=null;
  function paint(force){
    if(STATE.page!=='seqsetup') return;
    var c=document.getElementById('content'); if(!c) return;
    var sk=renderPage(true);
    if(!force && document.getElementById('sq-root') && sk===_lastSkel){ return; }
    _lastSkel=sk;
    var pb=c.querySelector('.pg-body'), top=pb?pb.scrollTop:0;
    c.innerHTML=renderPage(false);
    var npb=c.querySelector('.pg-body'); if(npb&&top) npb.scrollTop=top;
  }
  UI.registerPage('seqsetup', function(){ _lastSkel=renderPage(true); return renderPage(false); }, function(){ paint(false); });
  // Every keystroke, pasted text and inserted detail is already in state (onEdit), so a repaint never reads the editors back:
  // after an AI answer arrives the editors on screen are OLDER than the state, and reading them would undo the answer.
  function repaint(){ paint(true); }
  function refreshPreview(){ var pv=document.getElementById('sq-pv'); if(pv) pv.innerHTML=previewMail(false); }
  function say(key, text){ Q.msg[key]=text||''; }

  // ── editing ────────────────────────────────────────────────────────────────
  var range=null, rangeField='';
  function remember(ed){ var sel=window.getSelection(); if(sel&&sel.rangeCount&&ed.contains(sel.anchorNode)){ range=sel.getRangeAt(0).cloneRange(); rangeField=ed.id; } }
  function placeCaret(r){ var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  function onEdit(ed){
    if(!ed.querySelector('.sq-chip') && ed.textContent.replace(/​/g,'').trim()==='' && !/<br/.test(ed.innerHTML.replace(/<br data-dummy[^>]*>/g,'').replace(/<br>$/,''))) ed.innerHTML='';
    saveEditors(); Q.preview=null; Q.undo=null;
    refreshPreview();
  }
  function insertNewline(ed){
    var sel=window.getSelection(); if(!sel.rangeCount) return; var r=sel.getRangeAt(0); r.deleteContents();
    var br=document.createElement('br'); r.insertNode(br);
    var nx=br.nextSibling;
    if(!nx||(nx.nodeType===3&&!nx.nodeValue)){ var d=document.createElement('br'); d.setAttribute('data-dummy','1'); br.parentNode.insertBefore(d,br.nextSibling); }
    r.setStartAfter(br); r.collapse(true); placeCaret(r); remember(ed);
  }
  function insertPlain(ed,text){
    var sel=window.getSelection(); var r=(sel.rangeCount&&ed.contains(sel.anchorNode))?sel.getRangeAt(0):null;
    if(!r){ r=document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
    r.deleteContents();
    String(text).replace(/\r/g,'').split('\n').forEach(function(ln,i){
      if(i>0){ var b=document.createElement('br'); r.insertNode(b); r.setStartAfter(b); }
      if(ln){ var t=document.createTextNode(ln); r.insertNode(t); r.setStartAfter(t); }
    });
    r.collapse(true); placeCaret(r); remember(ed);
  }
  function insertChip(fid,k){
    var ed=document.getElementById(fid); if(!ed) return;
    ed.focus();
    var r;
    if(range&&rangeField===fid&&ed.contains(range.startContainer)) r=range; else { r=document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
    placeCaret(r); r.deleteContents();
    var tmp=document.createElement('span'); tmp.innerHTML=chipHtml(k); var chip=tmp.firstChild;
    r.insertNode(chip);
    var nx=chip.nextSibling;
    if(nx&&nx.nodeType===3) r.setStart(nx,0);
    else { var z=document.createTextNode('​'); chip.parentNode.insertBefore(z,chip.nextSibling); r.setStart(z,1); }
    r.collapse(true); placeCaret(r); remember(ed); onEdit(ed);
  }
  function closeMenu(){ if(!Q||!Q.menu) return; Q.menu=''; document.querySelectorAll('.sq-menu').forEach(function(m){ m.hidden=true; }); document.querySelectorAll('[data-sq="menu"]').forEach(function(b){ b.setAttribute('aria-expanded','false'); }); }

  // ── AI help (the server holds every draft to its checker) ─────────────────
  function draftFirst(){
    saveEditors();
    if(!Q.offer.trim()){ say('first','Write a sentence first — PACE does not write from nothing.'); return repaint(); }
    Q.undo=(hasWords(htmlToTokens(Q.first.body))||hasWords(htmlToTokens(Q.first.subject)))?{subject:Q.first.subject,body:Q.first.body,versions:Q.first.versions}:null;
    Q.busy='draft'; say('first',''); repaint();
    apiPost('/my-setup/sequence/draft',{mode:'write', purpose:'first', prompt:Q.offer}).then(function(r){
      Q.busy='';
      if(r&&r.body){ Q.first.body=tokensToHtml(r.body); if(r.subject) Q.first.subject=tokensToHtml(r.subject); Q.first.versions=[]; Q.preview=null; }
      else Q.undo=null;
      say('first',(r&&r.note)||'');
      repaint();
    }).catch(function(e){ Q.busy=''; Q.undo=null; say('first',(e&&e.message)||String(e)); repaint(); });
  }
  function draftFollowup(i){
    saveEditors();
    var first=htmlToTokens(Q.first.body);
    if(!hasWords(first)){ say('fu'+i,'Write your first email first.'); return repaint(); }
    if(hasWords(htmlToTokens(Q.fus[i].body))){ say('fu'+i,'This follow-up already has words. Clear it first if you want a new one.'); return repaint(); }
    Q.busy='fudraft'+i; say('fu'+i,''); repaint();
    var prompt='A short follow-up, '+Q.fus[i].day+' days after my first email, to someone who has not replied. Remind them of my question. My first email said: '+first.replace(/\s+/g,' ').slice(0,420);
    apiPost('/my-setup/sequence/draft',{mode:'write', purpose:(i===Q.fus.length-1&&i>0?'final':'followup'), prompt:prompt}).then(function(r){
      Q.busy='';
      if(r&&r.body&&r.source==='ai'){ Q.fus[i].body=tokensToHtml(r.body); Q.fus[i].versions=[]; }
      say('fu'+i, r&&r.source==='ai'?'':((r&&r.note)||'The AI could not write it just now.')+' Nothing was changed.');
      repaint();
    }).catch(function(e){ Q.busy=''; say('fu'+i,(e&&e.message)||String(e)); repaint(); });
  }
  function vary(slot){
    saveEditors();
    var first=slot==='first', f=first?null:Q.fus[Number(slot)];
    var subject=first?htmlToTokens(Q.first.subject):'', body=htmlToTokens(first?Q.first.body:f.body);
    var list=first?Q.first.versions:f.versions, want=first?Math.min(2,2-list.length):1;
    if(!hasWords(body)){ say('vary'+slot, first?'Write your first email first.':'Write this follow-up first.'); return repaint(); }
    if(want<=0) return;
    Q.busy='vary'+slot; say('vary'+slot,''); repaint();
    var got=0, note='';
    function one(){
      return apiPost('/my-setup/sequence/draft',{mode:'variant', purpose:first?'first':'followup', subject:subject||'(follow-up)', body:body}).then(function(r){
        if(r&&r.source==='ai'&&r.body){ list.push({subject:first?(r.subject||subject):'', body:r.body}); got++; }
        else note=(r&&r.note)||'The AI could not write a version just now.';
      });
    }
    var chain=one(); if(want>1) chain=chain.then(function(){ if(!note) return one(); });
    chain.then(function(){ Q.busy=''; Q.preview=null; say('vary'+slot, note&&!got?note:(note?'One version was written; '+note.charAt(0).toLowerCase()+note.slice(1):'')); repaint(); })
      .catch(function(e){ Q.busy=''; say('vary'+slot,(e&&e.message)||String(e)); repaint(); });
  }
  function test(){
    var b=payload();
    if(!b.first.subject || b.first.body.length<20){ Q.preview={error:Q.mode==='ai'?'Write your backup email first — go back one step.':'Write your first email first — go back one step.'}; return repaint(); }
    Q.busy='test'; repaint();
    apiPost('/my-setup/sequence/preview',{subject:b.first.subject, body:b.first.body, versions:b.first.versions}).then(function(r){ Q.busy=''; Q.preview=r; repaint(); })
      .catch(function(e){ Q.busy=''; Q.preview={error:(e&&e.message)||String(e)}; repaint(); });
  }
  function save(){
    Q.saving=true; say('save',''); repaint();
    apiPut('/my-setup/sequence', payload()).then(function(){
      Q.saving=false; Q.saved=true;
      apiGet('/outreach-plan').then(function(p){ STATE.myOutreachPlan=p||{}; scheduleRender(); }).catch(function(){});
      if(typeof mySetupSync==='function') mySetupSync();
      repaint();
    }).catch(function(e){ Q.saving=false; say('save',(e&&e.message)||String(e)); repaint(); });
  }

  // ── events (delegated once; everything is scoped to #sq-root) ─────────────
  document.addEventListener('mousedown',function(ev){ if(ev.target.closest&&ev.target.closest('.sq-menu')) ev.preventDefault(); });
  document.addEventListener('click',function(ev){
    var t=ev.target; if(!t.closest||!t.closest('#sq-root')){ closeMenu(); return; }
    if(Q.menu && !t.closest('.sq-menuwrap')) closeMenu();
    var el=t.closest('[data-sq]'); if(!el) return;
    var a=el.getAttribute('data-sq'), i=Number(el.getAttribute('data-i'));
    if(a==='menu'){ var id=el.getAttribute('data-menu'), open=Q.menu!==id; closeMenu(); if(open){ Q.menu=id; var m=el.parentNode.querySelector('.sq-menu'); if(m) m.hidden=false; el.setAttribute('aria-expanded','true'); } return; }
    if(a==='ins'){ var fid=Q.menu==='first'?(rangeField==='sq-subj'?'sq-subj':'sq-body'):'sq-'+Q.menu; var k=el.getAttribute('data-k'); closeMenu(); insertChip(fid,k); return; }
    if(a==='mode'){ saveEditors(); Q.mode=el.getAttribute('data-mode'); Q.preview=null; repaint(); return; }
    if(a==='stuck'){ Q.stuck=!Q.stuck; repaint(); return; }
    if(a==='draft'){ if(!Q.busy) draftFirst(); return; }
    if(a==='undo'){ if(Q.undo){ Q.first.subject=Q.undo.subject; Q.first.body=Q.undo.body; Q.first.versions=Q.undo.versions||[]; } Q.undo=null; say('first',''); paint(true); return; }
    if(a==='fudraft'){ if(!Q.busy) draftFollowup(i); return; }
    if(a==='vary'){ if(!Q.busy) vary(el.getAttribute('data-slot')); return; }
    if(a==='rmv'){ saveEditors(); var sl=el.getAttribute('data-slot'); (sl==='first'?Q.first.versions:Q.fus[Number(sl)].versions).splice(i,1); Q.preview=null; paint(true); return; }
    if(a==='addfu'){ saveEditors(); var last=Q.fus.length?Number(Q.fus[Q.fus.length-1].day):0; var d=DEFAULT_DAYS[Q.fus.length]||last+7; if(d<=last) d=last+4; Q.fus.push({day:d,subject:'',body:'',versions:[]}); paint(true); return; }
    if(a==='rmfu'){ saveEditors(); Q.fus.splice(i,1); for(var j=1;j<Q.fus.length;j++) if(Number(Q.fus[j].day)<=Number(Q.fus[j-1].day)) Q.fus[j].day=Number(Q.fus[j-1].day)+1; paint(true); return; }
    if(a==='next'){ saveEditors(); var p=payload(); if(!p.first.subject||p.first.body.length<20){ say('first',Q.mode==='ai'?'Write your backup email first: a subject and a few lines.':'Write your first email first: a subject and a few lines.'); return repaint(); }
      var empty=p.followups.findIndex(function(f){ return f.body.length<5; }); if(empty>=0){ say('fu'+empty,'This follow-up has no text yet. Write it, or remove it.'); return repaint(); }
      Q.step=2; Q.preview=null; paint(true); var pb=document.querySelector('.pg-body'); if(pb) pb.scrollTop=0; return; }
    if(a==='back'){ Q.step=1; Q.saved=false; paint(true); return; }
    if(a==='test'){ if(!Q.busy) test(); return; }
    if(a==='save'){ if(!Q.saving) save(); return; }
  });
  document.addEventListener('input',function(ev){
    var t=ev.target; if(!t.closest||!t.closest('#sq-root')) return;
    if(t.id==='sq-offer'){ Q.offer=t.value; return; }
    if(t.classList.contains('sq-ed')) onEdit(t);
  });
  document.addEventListener('change',function(ev){
    var t=ev.target; if(!t.closest||!t.closest('#sq-root')) return;
    var di=t.getAttribute('data-sq-day'); if(di!=null){ saveEditors(); var n=Number(di); Q.fus[n].day=Number(t.value);
      for(var j=n+1;j<Q.fus.length;j++) if(Number(Q.fus[j].day)<=Number(Q.fus[j-1].day)) Q.fus[j].day=Number(Q.fus[j-1].day)+1;
      paint(true); }
  });
  document.addEventListener('keydown',function(ev){
    var t=ev.target;
    if(ev.key==='Escape'&&Q&&Q.menu){ closeMenu(); return; }
    if(!t.classList||!t.classList.contains('sq-ed')) return;
    if(ev.key==='Enter'){ ev.preventDefault(); if(!t.classList.contains('is-one')){ insertNewline(t); onEdit(t); } }
  });
  document.addEventListener('paste',function(ev){
    var t=ev.target&&ev.target.closest?ev.target.closest('.sq-ed'):null; if(!t) return;
    ev.preventDefault(); var txt=(ev.clipboardData||window.clipboardData).getData('text');
    if(t.classList.contains('is-one')) txt=txt.replace(/\s*\n+\s*/g,' ');
    insertPlain(t,txt); onEdit(t);
  });
  ['keyup','mouseup','focusin'].forEach(function(evn){ document.addEventListener(evn,function(ev){ var t=ev.target&&ev.target.closest?ev.target.closest('.sq-ed'):null; if(t) remember(t); }); });
})();
