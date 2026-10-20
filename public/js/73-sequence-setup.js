// ===== WRITE YOUR FIRST SEQUENCE — the new manager's sequence screen (owner, 15 Oct 2026, D-0147 … D-0154, R-258) =====
// Two short steps, opened from My Setup:
//   1. WRITE — the person chooses how the first email is written ("I write it" or "AI writes each one"), writes it with details
//      picked from a plain-words menu (shown as highlighted words, stored as {{merge fields}}), may ask AI for VERSIONS of it (the
//      engine picks one at random per lead), and adds follow-ups (N days after the first email, only if no reply).
//   2. START — the first email exactly as one of their own leads would get it (built on the server, R-256), then save and turn on.
// "AI writes each one" sets the person's AI first-email choice on and TEACHES the AI by picks and one-liners (owner, D-0151, R-259):
// what the email is for, what it may use from the job, how it ends, how long, optionally an email of theirs for its sound, and per
// follow-up what it does plus one line it must say. The emails they write become the BACKUP that goes out on a day the AI cannot
// write. Every rule is on the server (routes/my-setup.js, services/ai-teach.js); this file asks and shows.
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
  // A candidate sequence fills from the candidate and the job (routes/recruiting/outreach.js buildCandidateVars) — its own menu (R-270).
  var CAND_DETAILS=[
    {k:'first_name', label:'first name', menu:'Their first name'},
    {k:'title', label:'their title', menu:'Their current title'},
    {k:'location', label:'their location', menu:'Where they are'},
    {k:'position', label:'job title', menu:'The job title'},
    {k:'client', label:'client', menu:'The client'}
  ];
  function details(){ return Q&&Q.target&&Q.target.cand?CAND_DETAILS:DETAILS; }
  function labelOf(k){ var d=details(); for(var i=0;i<d.length;i++) if(d[i].k===k) return d[i].label; return MORE[k]||k; }
  function isOptional(k){ var d=details(); for(var i=0;i<d.length;i++) if(d[i].k===k) return !!d[i].optional; return false; }
  var DEFAULT_DAYS=[3,7,14,21,28];

  var Q = STATE.seqSetup = STATE.seqSetup || null;
  function fresh(){ return { loaded:false, err:'', step:1, mode:null, first:{subject:'',body:'',versions:[]}, fus:[], max:5, sample:null,
    menu:'', busy:'', msg:{}, stuck:false, offer:'', preview:null, aitest:null, saved:false, saving:false,
    teach:{purpose:'',use:['skills','hard','pay'],end:'resumes',len:'short',voice:'',fus:[]}, opts:null, open:{}, target:null,
    scope:'all', mbs:[], mbText:{}, mbTab:'person', personSave:null }; }
  function teachFu(i){ while(Q.teach.fus.length<=i) Q.teach.fus.push({angle:Q.teach.fus.length?'detail':'nudge',note:''}); return Q.teach.fus[i]; }

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
      // The sender is the EMAIL ID that sends, never the profile (CLAUDE.md: every preview resolves from the selected mailbox):
      // the email ID whose tab is open, else the person's primary one. Without one connected, the field is marked, not invented.
      if(k==='sender'){ var sb=previewSender(); return sb?(sb.name||String(sb.email).split('@')[0]):'[your name — from the email ID that sends]'; }
      if(k==='senderemail'){ var se=previewSender(); return se?se.email:'[the email ID that sends]'; }
      return v[k]!=null&&v[k]!=='' ? String(v[k]) : '';
    });
  }

  // The person's own connected email IDs, for the preview's sender (any role can read its own list).
  function loadSenders(){
    if(typeof apiGet!=='function') return;
    apiGet('/mailbox/accounts').then(function(list){
      if(!Q) return;
      Q.senders=(list||[]).filter(function(m){ return m&&m.is_active!==false; }).map(function(m){ return { id:m.id, email:m.email_address, name:m.display_name||'', primary:!!m.is_primary }; });
      if(STATE.page==='seqsetup') paint(true);
    }).catch(function(){});
  }
  function previewSender(){
    var list=(Q&&Q.senders)||[];
    if(Q&&Q.mbTab&&Q.mbTab!=='person'){ var t=list.filter(function(m){ return m.id===Q.mbTab; })[0]; if(t) return t; }
    return list.filter(function(m){ return m.primary; })[0]||list[0]||null;
  }
  // ── loading and saving ─────────────────────────────────────────────────────
  window.openSequenceSetup = function(){
    Q = STATE.seqSetup = fresh();
    goPage('seqsetup');
    loadSenders();
    apiGet('/my-setup/sequence').then(function(r){
      Q.loaded=true; Q.mode=r.mode||null; Q.max=r.followup_max==null?5:r.followup_max; Q.sample=r.sample||null;
      Q.first={ subject:tokensToHtml(r.first&&r.first.subject), body:tokensToHtml(r.first&&r.first.body),
        versions:((r.first&&r.first.versions)||[]).map(function(v){ return {subject:v.subject||'', body:v.body||''}; }) };
      Q.fus=(r.followups||[]).map(function(f){ return { day:f.day, subject:f.subject||'', body:tokensToHtml(f.body), thread:f.thread==='new'?'new':'same', versions:(f.versions||[]).map(function(v){ return {subject:v.subject||'',body:v.body||''}; }) }; });
      if(!Q.fus.length && Q.max>0 && !hasWords(r.first&&r.first.body)) Q.fus=[{ day:DEFAULT_DAYS[0], subject:'', body:'', versions:[] }];   // D-0147: the box starts at 1
      if(r.teach) Q.teach=r.teach; Q.opts=r.teach_options||null;
      Q.fus.forEach(function(_,i){ teachFu(i); });
      paint(true);
      loadPerId();
    }).catch(function(e){ Q.loaded=true; Q.err=(e&&e.message)||String(e); paint(true); });
  };
  // ── ONE EMAIL FOR ALL MY EMAIL IDS, OR ONE EACH (R-176 → moved here by D-0161, R-285) ─────────────────────────────────────────
  // Your outreach may say something different from each email ID (two company identities). An email ID with no text of its own
  // uses the main wording. Saved through the same endpoints the old "My wording" tab used (routes/settings.js), so nothing moves.
  var SLOTS=['o1','fu1','fu2','fu3','fu4','fu5'];
  function loadPerId(){
    Promise.all([apiGet('/outreach-plan').catch(function(){ return {}; }), apiGet('/outreach-plan/mailboxes').catch(function(){ return null; })]).then(function(r){
      var plan=r[0]||{}, mb=r[1];
      Q.scope=String(plan.tmpl_scope||'all')==='each'?'each':'all';
      Q.mbs=(mb&&mb.emails)||[];
      Q.mbText={};
      Q.mbs.forEach(function(m){ var own=(mb&&mb.mailboxes&&mb.mailboxes[m.id])||{}; var t={};
        SLOTS.forEach(function(sl){ t[sl]={ subject:own['tmpl_'+sl+'_subject']||'', body:own['tmpl_'+sl+'_body']||'' }; }); Q.mbText[m.id]=t; });
      Q.mbOrig=JSON.parse(JSON.stringify(Q.mbText));
      if(STATE.page==='seqsetup') paint(true);
    });
  }
  // Show another email ID's wording in the same editors: what is on screen goes back where it came from first.
  function stashTab(){
    saveEditors();
    if(Q.mbTab==='person'){ Q.personSave={ subject:Q.first.subject, body:Q.first.body, fus:Q.fus.map(function(f){ return {subject:f.subject, body:f.body}; }) }; return; }
    var t=Q.mbText[Q.mbTab]; if(!t) return;
    t.o1={ subject:htmlToTokens(Q.first.subject).replace(/\n/g,' ').trim(), body:htmlToTokens(Q.first.body).trim() };
    Q.fus.forEach(function(f,i){ t[SLOTS[i+1]]={ subject:String(f.subject||''), body:htmlToTokens(f.body).trim() }; });
  }
  function showTab(tab){
    stashTab(); Q.mbTab=tab;
    if(tab==='person'){ var p=Q.personSave||{}; Q.first.subject=p.subject||''; Q.first.body=p.body||''; (p.fus||[]).forEach(function(x,i){ if(Q.fus[i]){ Q.fus[i].subject=x.subject; Q.fus[i].body=x.body; } }); }
    else { var t=Q.mbText[tab]||{}; Q.first.subject=tokensToHtml((t.o1||{}).subject); Q.first.body=tokensToHtml((t.o1||{}).body);
      Q.fus.forEach(function(f,i){ var x=t[SLOTS[i+1]]||{}; f.subject=x.subject||''; f.body=tokensToHtml(x.body); }); }
    Q.preview=null; paint(true);
  }
  // The person's own wording, wherever the editors are showing an email ID's.
  function personTexts(){
    if(Q.mbTab==='person') return null;
    var p=Q.personSave||{subject:'',body:'',fus:[]};
    return { subject:p.subject, body:p.body, fus:p.fus };
  }
  function perIdHtml(){
    if(named()||!Q.mbs||Q.mbs.length<2) return '';
    var each=Q.scope==='each';
    var tabs=each?'<div class="sq-mbtabs" role="tablist">'+[{id:'person',email:'Main wording (any email ID without its own)'}].concat(Q.mbs).map(function(m){
      var on=Q.mbTab===m.id; return '<button type="button" role="tab" class="sq-mbtab'+(on?' on':'')+'" aria-selected="'+on+'" data-sq="mbtab" data-mb="'+esc(m.id)+'">'+esc(m.email)+'</button>'; }).join('')+'</div>'+
      (Q.mbTab!=='person'?'<p class="sq-hint">What '+esc((Q.mbs.filter(function(m){ return m.id===Q.mbTab; })[0]||{}).email||'')+' sends. Leave an email empty and it uses the main wording.</p>':''):'';
    return '<div class="card sq-card"><span class="sq-lbl">Your email IDs</span><div class="sq-choices" role="radiogroup" aria-label="One email for all email IDs or one each">'+
      '<button type="button" class="sq-choice" role="radio" aria-checked="'+!each+'" data-sq="scope" data-scope="all"><b>Same email from all my email IDs</b><span>One wording, whichever email ID sends it.</span></button>'+
      '<button type="button" class="sq-choice" role="radio" aria-checked="'+each+'" data-sq="scope" data-scope="each"><b>A different one for each</b><span>For example when your email IDs write for different companies.</span></button>'+
      '</div>'+tabs+'</div>';
  }
  // ── NAMED SEQUENCES (R-269/R-270, D-0158/D-0159) ──────────────────────────────────────────────────────────────────
  // The same screen makes and edits a person's named sequences — for leads or for candidates on a job — stored as workflow
  // definitions (services/sequence-v2.js), so the engine that already sends them keeps doing so. Every "+ New sequence",
  // "Add to sequence" and "Start sequence → build a new one" lands here (09-page-workflows.js wfOpenBuilder).
  // opts: { id, entity_type: 'contact'|'submission'|'candidate', enrollAfter: {entity_type, items}, back: page to return to }
  var CAND_EXAMPLE={ first_name:'Jordan', full_name:'Jordan Reyes', title:'Site Engineer', location:'Houston, TX', position:'Project Engineer', client:'Acme Construction', company:'Acme Construction', job_code:'' };
  window.openSequenceBuilder = function(opts){
    opts=opts||{};
    var et=opts.entity_type||'contact', cand=(et==='submission'||et==='candidate');
    Q = STATE.seqSetup = fresh();
    Q.target={ id:opts.id||null, entity:et, cand:cand, name:'', enrollAfter:opts.enrollAfter||null, back:opts.back||STATE.page||'email' };
    Q.mode='template';
    goPage('seqsetup');
    loadSenders();
    var def=opts.id?((STATE.wf&&STATE.wf.defs)||[]).find(function(d){ return d.id===opts.id; }):null;
    if(def){
      Q.target.name=def.name||'';
      var st=(def.steps||[]).slice().sort(function(a,b){ return a.step_order-b.step_order; });
      var c0=(st[0]&&st[0].config)||{};
      Q.mode=c0.ai?'ai':'template';
      Q.first={ subject:tokensToHtml(c0.subject), body:tokensToHtml(c0.body), versions:(c0.versions||[]).map(function(v){ return {subject:v.subject||'', body:v.body||''}; }) };
      var day=0;
      Q.fus=st.slice(1).map(function(x){ var c=x.config||{}; day+=Number(x.delay_days)||1; return { day:day, subject:c.subject||'', body:tokensToHtml(c.body), versions:(c.versions||[]).map(function(v){ return {subject:v.subject||'',body:v.body||''}; }) }; });
    } else Q.fus=[{ day:DEFAULT_DAYS[0], subject:'', body:'', versions:[] }];
    Q.fus.forEach(function(_,i){ teachFu(i); });
    if(cand){ Q.loaded=true; Q.sample={ vars:CAND_EXAMPLE, example:true, name:CAND_EXAMPLE.full_name, company:'' }; paint(true); return; }
    // A lead sequence fills from one of the person's own leads, when they have one (the same sample "Your outreach" uses).
    apiGet('/my-setup/sequence').then(function(r){ Q.sample=r.sample||null; Q.max=r.followup_max==null?5:r.followup_max; })
      .catch(function(){ Q.sample={ vars:{fn:'Dana',company:'Acme Health',pos:'Senior Java Developer',city:'Dallas',ind:'Healthcare'}, example:true, name:'Dana Lee', company:'Acme Health' }; })
      .then(function(){ Q.loaded=true; paint(true); });
  };
  function named(){ return !!(Q&&Q.target); }
  // "Draft it with AI" / versions: My Setup's writer for the people who write outreach (bd, bd_lead, admin); the sequence
  // designers' writer for an RA lead or recruiter making a named sequence. Same writer and checker behind both (sequence-draft.js).
  function draftUrl(){ return (typeof userHasAnyRole==='function'&&!userHasAnyRole(STATE.user,'bd','bd_lead','admin'))?'/wf/draft-email':'/my-setup/sequence/draft'; }

  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if(p==='seqsetup'){ STATE.page='seqsetup'; STATE.modal=null; if(!Q) Q=STATE.seqSetup=fresh(); render(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function saveEditors(){
    var g=function(id){ var e=document.getElementById(id); return e?e.innerHTML:null; };
    var s=g('sq-subj'), b=g('sq-body'); if(s!==null) Q.first.subject=s; if(b!==null) Q.first.body=b;
    Q.fus.forEach(function(f,i){ var e=g('sq-fu'+i); if(e!==null) f.body=e; var fs=g('sq-fusubj'+i); if(fs!==null) f.subject=htmlToTokens(fs).replace(/\n/g,' ').trim(); });
  }
  function payload(){
    saveEditors();
    var pt=(typeof personTexts==='function')?personTexts():null;   // showing an email ID's wording: the main wording is the saved copy
    var fs=pt?pt.subject:Q.first.subject, fb=pt?pt.body:Q.first.body;
    return { mode:Q.mode,
      first:{ subject:htmlToTokens(fs).replace(/\n/g,' ').trim(), body:htmlToTokens(fb).trim(), versions:Q.mode==='template'?Q.first.versions:[] },
      followups:Q.fus.map(function(f,i){ var p=pt&&pt.fus[i]; return { day:Number(f.day), subject:p?p.subject:f.subject, body:htmlToTokens(p?p.body:f.body).trim(), versions:Q.mode==='template'?f.versions:[] }; }),
      teach:teachPayload() };
  }
  function teachPayload(){
    var t=Q.teach; return { purpose:t.purpose, use:t.use.slice(), end:t.end, len:t.len, voice:t.voice,
      fus:Q.fus.map(function(_,i){ var f=teachFu(i); return {angle:f.angle, note:f.note}; }) };
  }

  // ── the page ───────────────────────────────────────────────────────────────
  function menuHtml(id){
    var v=(Q.sample&&Q.sample.vars)||{};
    return '<span class="sq-menuwrap"><button type="button" class="btn btn-sm btn-outline" data-sq="menu" data-menu="'+id+'" aria-haspopup="true" aria-expanded="'+(Q.menu===id)+'">Add a detail ▾</button>'+
      '<div class="sq-menu" role="menu"'+(Q.menu===id?'':' hidden')+'>'+details().map(function(d){
        var ex=v[d.k]; return '<button type="button" class="sq-it" role="menuitem" data-sq="ins" data-k="'+d.k+'"><span>'+esc(d.menu)+(d.optional?'<small>Its sentence is left out when a lead does not have it</small>':'')+'</span><span class="sq-ex">'+esc(ex||'not known for this lead')+'</span></button>';
      }).join('')+'</div></span>';
  }
  function msgHtml(key){ var m=Q.msg[key]; return m?'<p class="sq-hint" aria-live="polite">'+esc(m)+'</p>':''; }
  function dayOptions(cur, min){ var o=''; for(var n=Math.max(1,min);n<=90;n++){ if(n>30&&n%7) continue; o+='<option value="'+n+'"'+(n===Number(cur)?' selected':'')+'>'+n+(n===1?' day':' days')+'</option>'; } return o; }
  function versionsHtml(slot, list, skel){
    var first=slot==='first', room=2-list.length, busy=!!Q.busy;
    var h=list.map(function(v,i){
      return '<div class="sq-ver"><div class="sq-ver-h"><span>Version '+(i+2)+'</span><button type="button" class="btn btn-sm btn-outline" data-sq="rmv" data-slot="'+slot+'" data-i="'+i+'">Remove</button></div>'+
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
      (Q.target&&Q.target.cand
        ? c('template','I write it','Your email, filled in for each candidate.')+
          c('ai','AI writes each one','An email for every candidate from the job and their resume. Uses AI credits; the email you write goes when it cannot.')
        : c('template','I write it','Your email, filled in for each lead. AI can add versions so leads do not all get the same words.')+
          c('ai','AI writes each one','A new email for every lead from their job description. Uses AI credits.'))+'</div></div>';
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
  // A row of choices. multi: several may be on (aria-pressed); otherwise exactly one.
  function picksHtml(group, list, isOn, extra){
    return '<div class="sq-picks" role="group">'+(list||[]).map(function(o){
      return '<button type="button" class="sq-pick" data-sq="pick" data-g="'+group+'" data-k="'+o.k+'"'+(extra||'')+' aria-pressed="'+!!isOn(o.k)+'">'+esc(o.label)+'</button>'; }).join('')+'</div>';
  }
  function detailsHtml(id, summary, inner){ return '<details class="sq-dd" data-open="'+id+'"'+(Q.open[id]?' open':'')+'><summary>'+esc(summary)+'</summary><div>'+inner+'</div></details>'; }
  function teachCard(skel){
    var t=Q.teach, o=Q.opts||{use:[],ends:[],lens:[]};
    return '<div class="card sq-card"><h2 class="sq-h2">Teach the AI</h2><p class="sq-sub">A few answers. For every lead, the AI writes the email from its job description with them.</p>'+
      '<label class="sq-lbl" for="sq-purpose">What is this email for? One line.</label>'+
      '<input id="sq-purpose" class="sq-inp" maxlength="200" placeholder="e.g. I have pre-screened Java developers in the job\'s city" value="'+(skel?'':esc(t.purpose))+'">'+
      '<span class="sq-lbl">What can it use from the job?</span>'+picksHtml('use',o.use,function(k){ return t.use.indexOf(k)>=0; })+
      '<p class="sq-hint">It always uses their name, the job title and the city.</p>'+
      '<span class="sq-lbl">How should it end?</span>'+picksHtml('end',o.ends,function(k){ return t.end===k; })+
      '<p class="sq-hint">It never asks for a call or a meeting — PACE\'s checks stop that in every email.</p>'+
      '<span class="sq-lbl">How long?</span>'+picksHtml('len',o.lens,function(k){ return t.len===k; })+
      detailsHtml('voice','Optional: paste an email you have sent, so it sounds like you',
        '<textarea id="sq-voice" class="sq-ta" maxlength="1500" placeholder="Any email you wrote yourself. The AI copies how it sounds, never what it says.">'+(skel?'':esc(t.voice))+'</textarea>')+
      msgHtml('teach')+
      '<p class="sq-hint">Uses one AI credit for each email it writes, follow-ups included.</p></div>';
  }
  function nameCard(skel){
    var t=Q.target;
    return '<div class="card sq-card"><label class="sq-lbl" for="sq-name">Name this sequence</label>'+
      '<input id="sq-name" class="sq-inp" maxlength="120" placeholder="'+(t.cand?'e.g. Site engineers — Houston':'e.g. Java developers — healthcare clients')+'" value="'+(skel?'':esc(t.name))+'">'+
      '<p class="sq-hint">For: <b>'+(t.cand?'candidates on a job':'leads')+'</b>. Follow-ups stop by themselves when someone replies.</p>'+msgHtml('name')+'</div>';
  }
  function writeStep(skel){
    var ai=Q.mode==='ai', busy=!!Q.busy;
    if(!Q.mode) return modeCards();
    var cand=named()&&Q.target.cand;
    var h=named()?nameCard(skel)+(cand?modeCards():''):modeCards();
    if(ai&&!named()) h+=teachCard(skel);
    h+=perIdHtml();
    h+='<div class="card sq-card"><h2 class="sq-h2">'+(ai?'Your backup email':'Your first email')+'</h2>'+
      (ai?(named()?'<p class="sq-sub">Goes out instead whenever the AI\'s email for a candidate does not pass PACE\'s checks, or the AI cannot write that day.</p>'
        :'<p class="sq-sub">Goes out instead on a day the AI cannot write — for example when your company\'s AI credits run out. Write it, or let AI write it from your answers.</p>'):'')+
      '<label class="sq-lbl" for="sq-subj">Subject</label>'+editor('sq-subj',Q.first.subject,'A short subject line',true,skel)+
      '<label class="sq-lbl" for="sq-body">Message</label>'+editor('sq-body',Q.first.body,'Write it the way you would write to one person: why you are writing, what you can offer, and one question.',false,skel)+
      '<div class="sq-row">'+menuHtml('first')+(cand?'':(ai?'<button type="button" class="btn btn-sm btn-outline" data-sq="draft"'+(busy?' disabled':'')+'>'+(Q.busy==='draft'?'Writing…':'Write it from my answers')+'</button>'+
        (Q.undo?'<button type="button" class="btn btn-sm btn-outline" data-sq="undo">Undo</button>':''):'<button type="button" class="btn btn-sm btn-outline" data-sq="stuck">Stuck? Draft it with AI</button>'))+'</div>'+
      (ai||cand?'':'<div class="sq-stuck"'+(Q.stuck?'':' hidden')+'><label class="sq-lbl" for="sq-offer">What do you offer? One sentence.</label>'+
        '<input id="sq-offer" class="sq-inp" placeholder="e.g. pre-screened Java developers in the job\'s city" value="'+(skel?'':esc(Q.offer))+'">'+
        '<div class="sq-row"><button type="button" class="btn btn-sm btn-outline" data-sq="draft"'+(busy?' disabled':'')+'>'+(Q.busy==='draft'?'Writing…':'Draft it with AI')+'</button>'+
        (Q.undo?'<button type="button" class="btn btn-sm btn-outline" data-sq="undo">Undo</button>':'')+'</div></div>')+
      (cand?'':toolsHtml('first'))+
      msgHtml('first')+(ai||cand||Q.mbTab!=='person'?'':versionsHtml('first',Q.first.versions,skel))+'</div>';
    Q.fus.forEach(function(f,i){
      var min=i?Number(Q.fus[i-1].day)+1:1;
      h+='<div class="card sq-card"><div class="sq-row sq-between"><h2 class="sq-h2">Follow-up'+(Q.fus.length>1?' '+(i+1):'')+'</h2><button type="button" class="btn btn-sm btn-outline" data-sq="rmfu" data-i="'+i+'">Remove</button></div>'+
        '<p class="sq-sub">Sent <select class="sq-sel" data-sq-day="'+i+'" aria-label="Days after the first email">'+dayOptions(f.day,min)+'</select> after the first email, only if they have not replied.</p>'+
        fuThreadHtml(f,i,skel)+
        (ai&&!named()?fuTeachHtml(i,skel)+detailsHtml('fu'+i,'Backup follow-up, for a day the AI cannot write',fuEditorHtml(f,i,skel)):fuEditorHtml(f,i,skel))+
        msgHtml('fu'+i)+(ai||cand||Q.mbTab!=='person'?'':versionsHtml(String(i),f.versions,skel))+'</div>';
    });
    if(Q.fus.length<Q.max) h+='<div><button type="button" class="btn btn-outline" data-sq="addfu">+ '+(Q.fus.length?'Add another follow-up':'Add a follow-up')+'</button></div>';
    var who=cand?'candidate':'lead';
    // How the AI writes for you (the old "AI style" tab, D-0161): your note for every email the AI writes in your name.
    if(!named()&&typeof renderAiStyleCard==='function') h+=detailsHtml('aistyle','How the AI writes for you — your note for every email it writes in your name',renderAiStyleCard());
    h+='<div class="card sq-card"><h2 class="sq-h4">'+(ai?'Your backup, filled in for ':'Your email, filled in for ')+esc((Q.sample&&Q.sample.name)||'a '+who)+'</h2>'+
      (Q.sample&&Q.sample.example?'<p class="sq-hint">An example '+who+(cand?'.':' — you have no leads of your own yet.')+'</p>':'')+
      '<div id="sq-pv">'+previewMail(skel)+'</div></div>';
    return h;
  }
  function fuThreadHtml(f,i,skel){
    // Same thread or a new email — per follow-up (owner, 8 Oct; kept from the old My wording tab, R-286). A new email needs a
    // subject of its own; in the thread it answers under the first email's subject.
    var thr=named()?'':'<div class="sq-choices sq-thread" role="radiogroup" aria-label="How follow-up '+(i+1)+' is sent">'+
      '<button type="button" class="sq-choice" role="radio" aria-checked="'+(f.thread!=='new')+'" data-sq="futhread" data-i="'+i+'" data-thr="same"><b>In the same email thread</b><span>A reply under your first email, so it reads as one conversation.</span></button>'+
      '<button type="button" class="sq-choice" role="radio" aria-checked="'+(f.thread==='new')+'" data-sq="futhread" data-i="'+i+'" data-thr="new"><b>As a new email</b><span>Its own subject line, in a thread of its own.</span></button></div>'+
      (f.thread==='new'?'<label class="sq-lbl" for="sq-fusubj'+i+'">Subject</label>'+editor('sq-fusubj'+i,tokensToHtml(f.subject),'A subject that stands alone — not “Re: …”',true,skel):'');
    return thr;
  }
  function fuEditorHtml(f,i,skel){
    var busy=!!Q.busy, cand=named()&&Q.target.cand;
    return editor('sq-fu'+i,f.body,'A short nudge. Remind them what you asked.',false,skel)+
      '<div class="sq-row">'+menuHtml('fu'+i)+(cand?'':'<button type="button" class="btn btn-sm btn-outline" data-sq="fudraft" data-i="'+i+'"'+(busy?' disabled':'')+'>'+(Q.busy==='fudraft'+i?'Writing…':'Write one with AI from my first email')+'</button>')+'</div>'+
      (cand?'':toolsHtml(String(i)));
  }
  // "Rewrite with AI" and "Check for spam triggers" on an email already written (the old My wording tab's two buttons, R-286).
  // slot: 'first' or a follow-up's index.
  function toolsHtml(slot){
    var busy=!!Q.busy, sp=(Q.spam||{})[slot];
    var box='';
    if(sp){
      var lvl=sp.level==='risk'?'is-risk':sp.level==='warn'?'is-warn':'is-ok';
      box='<div class="seq-spam-box '+lvl+'" role="status"><div class="fs-13 fw6">Spam score '+esc(String(sp.score))+'/100 — '+esc(String(sp.level))+'</div>'+
        (sp.warnings&&sp.warnings.length?'<ul class="fs-12 c-text2">'+sp.warnings.map(function(w){ return '<li>'+esc(w)+'</li>'; }).join('')+'</ul>':'<div class="fs-12 c-text3">Looks clean.</div>')+
        '<div class="fs-11 c-text3">Checked as written just now — press the button again after you edit.</div></div>';
    }
    return '<div class="sq-row sq-tools">'+
      '<button type="button" class="btn btn-sm btn-outline" data-sq="rewrite" data-slot="'+slot+'"'+(busy?' disabled':'')+'>'+(Q.busy==='rewrite'+slot?'Rewriting…':'Rewrite with AI')+'</button>'+
      ((Q.rwUndo||{}).slot===slot?'<button type="button" class="btn btn-sm btn-outline" data-sq="rwundo" data-slot="'+slot+'">Undo the rewrite</button>':'')+
      '<button type="button" class="btn btn-sm btn-outline" data-sq="spam" data-slot="'+slot+'" title="Looks for spam-trigger words, too many links, ALL-CAPS and other things that send mail to junk. Nothing is saved or sent.">Check for spam triggers</button>'+
    '</div>'+box;
  }
  function fuTeachHtml(i,skel){
    var f=teachFu(i), o=Q.opts||{angles:[]};
    return '<span class="sq-lbl">What should it do?</span>'+picksHtml('angle',o.angles,function(k){ return f.angle===k; },' data-i="'+i+'"')+
      '<label class="sq-lbl" for="sq-fnote'+i+'">Anything it must say? One line, optional.</label>'+
      '<input id="sq-fnote'+i+'" class="sq-inp" data-fnote="'+i+'" maxlength="160" placeholder="e.g. mention I can share resumes today" value="'+(skel?'':esc(f.note))+'">';
  }
  function mailBox(m){
    return '<div class="sq-mail"><div class="sq-mrow"><b>TO</b><span>'+esc(m.to.name+(m.to.company?' · '+m.to.company:''))+'</span></div>'+
      '<div class="sq-msub">'+esc(m.subject)+'</div><div class="sq-mbody">'+esc(m.body)+'</div><div class="sq-msig">Your signature is added from your mailbox.</div></div>';
  }
  // Why the AI did not write the test, in the person's words — and what that lead would get instead (the backup, always).
  function aiWhy(r){
    if(r.ai===false) return r.reason==='daily_limit'?'Your company\'s AI allowance for today is used up. On a day like this, every lead gets your backup email.'
      :'No AI is set up for your company yet, so every lead would get your backup email. An admin connects one under Admin → AI.';
    if(r.reason==='missing_contact_or_company') return 'This lead has no first name or company, so the AI cannot write for it. It would get your backup email.';
    if(r.reason==='draft_rejected') return 'The AI\'s email did not pass PACE\'s checks, so this lead would get your backup email. Try again, or change your answers.';
    return 'The AI could not write just now, so this lead would get your backup email.';
  }
  function aiTestHtml(){
    var r=Q.aitest, p=Q.preview; if(!r) return '';
    if(r.error) return '<p class="sq-warn">'+esc(r.error)+'</p>';
    var h='';
    if(r.written){
      h+='<div class="sq-tagrow"><span class="sq-tag is-ai">Written by AI</span></div>'+mailBox({to:r.to,subject:r.subject,body:r.body})+
        '<p class="sq-hint">Written for this lead from its job description, with your answers'+(r.example?' (an example lead: you have no leads of your own yet)':'')+'. Each lead gets its own.</p>';
      if(r.followup&&r.followup.written&&Q.fus[0]) h+='<span class="sq-lbl">Follow-up 1, '+Q.fus[0].day+' days later if no reply</span>'+mailBox({to:r.to,subject:'Re: '+r.subject,body:r.followup.body});
      else if(r.followup&&Q.fus[0]) h+='<p class="sq-hint">The AI\'s follow-up did not pass PACE\'s checks this time; that lead would get your backup follow-up.</p>';
      if(p&&!p.error) h+=detailsHtml('backup','On a day the AI cannot write, '+(r.to.name||'this lead').split(' ')[0]+' gets this instead',mailBox(p));
    } else {
      h+='<p class="sq-warn">'+esc(aiWhy(r))+'</p>';
      if(p&&!p.error) h+='<div class="sq-tagrow"><span class="sq-tag">Your backup</span></div>'+mailBox(p);
    }
    if(r.read) h+=detailsHtml('read','See what the AI read','<div class="sq-ver-t">'+esc(r.read)+'</div>');
    return h;
  }
  // Step 2 for a named sequence: what one person gets, then save (and start it for the people ticked, if any).
  function namedStartStep(){
    var t=Q.target, ai=Q.mode==='ai', who=t.cand?'candidate':'lead', ea=t.enrollAfter, n=ea&&ea.items?ea.items.length:0;
    var noun=n===1?who:who+'s';
    if(Q.saved) return '<div class="card sq-card"><div class="sq-ok"><b>'+esc(t.name)+' is saved and on.</b> '+
      (Q.savedStarted?'It has started for '+Q.savedStarted+' '+(Q.savedStarted===1?who:who+'s')+'. ':'Start it for '+who+'s from their list: tick them, then "Add to sequence". ')+
      'Follow-ups stop by themselves when someone replies.</div>'+
      '<div class="sq-row"><button type="button" class="btn btn-primary" data-sq="cancel">Done</button></div></div>';
    var b=payload(), v=Q.first.versions.length;
    var mail='<div class="sq-tagrow"><span class="sq-tag">'+(ai?'Your backup':'Your email')+'</span></div>'+
      mailBox({to:{name:(Q.sample&&Q.sample.name)||'', company:(Q.sample&&Q.sample.company)||''}, subject:fill(b.first.subject), body:fill(b.first.body).trim()})+
      '<p class="sq-hint">'+(ai?'With AI on, each '+who+' gets an email written for them from the job and their resume; this one goes when that email does not pass PACE\'s checks. ':'')+
      (v?'Each '+who+' gets one of '+(v+1)+' versions, picked at random. ':'')+(Q.sample&&Q.sample.example?'Filled in for an example '+who+'.':'')+'</p>';
    var fus=Q.fus.length?'<p class="sq-hint">Then '+Q.fus.map(function(f){ return 'a follow-up on day '+f.day; }).join(', ')+' — each only if they have not replied.</p>':'';
    return '<div class="card sq-card"><h2 class="sq-h2">What a '+who+' gets</h2>'+mail+fus+'</div>'+
      '<div class="card sq-card"><div class="sq-row sq-between"><div><h2 class="sq-h4">'+(n?'Save and start':'Save')+'</h2><p class="sq-hint">'+
        (n?'Starts now for the '+n+' '+noun+' you ticked.':'Saved and switched on; you start it for '+who+'s from their list.')+'</p></div>'+
      '<button type="button" class="btn btn-primary" data-sq="save"'+(Q.saving?' disabled':'')+'>'+(Q.saving?'Saving…':(n?'Save and start for '+n+' '+noun:'Save sequence'))+'</button></div>'+msgHtml('save')+'</div>';
  }
  function startStep(){
    if(named()) return namedStartStep();
    var p=Q.preview, ai=Q.mode==='ai';
    if(Q.saved) return '<div class="card sq-card"><div class="sq-ok"><b>Your sequence is on.</b> Leads assigned to you now go out by themselves'+(ai?' — the AI writes each email for that lead, and your backup goes on a day it cannot':'')+'. Follow-ups stop when someone replies.</div>'+
      '<div class="sq-row"><button type="button" class="btn btn-primary" onclick="goPage(\'mysetup\')">Back to My Setup</button></div></div>';
    var mail='', shown=false;
    if(ai){ mail=aiTestHtml(); shown=!!(Q.aitest&&!Q.aitest.error); }
    else if(p&&p.error) mail='<p class="sq-hint">'+esc(p.error)+'</p>';
    else if(p){
      shown=true;
      mail='<div class="sq-tagrow"><span class="sq-tag">Your email</span></div>'+mailBox(p)+
        '<p class="sq-hint">'+(p.versions>1?'Version '+p.version+' of '+p.versions+', picked at random — the same way each lead gets one. ':'')+(p.example?'An example lead: you have no leads of your own yet.':'Built the way PACE builds it for this lead of yours.')+'</p>'+
        (p.missing&&p.missing.length?'<p class="sq-warn">These details could not be filled: '+esc(p.missing.join(', '))+'.</p>':'');
    }
    return '<div class="card sq-card"><h2 class="sq-h2">Try it, then turn it on</h2><p class="sq-sub">'+(ai?'The AI writes the email one of your leads would get, from that lead\'s job description. Uses AI credits.':'See exactly what one of your leads would get.')+' If it looks right, turn it on.</p>'+
      '<div class="sq-row"><button type="button" class="btn btn-outline" data-sq="test"'+(Q.busy?' disabled':'')+'>'+(Q.busy==='test'?(ai?'Writing…':'Building…'):(shown?(ai?'Write another':'Show another'):'Show me what a lead gets'))+'</button></div>'+mail+'</div>'+
      '<div class="card sq-card"><div class="sq-row sq-between"><div><h2 class="sq-h4">Turn it on</h2><p class="sq-hint">'+(shown?'Leads you are given will go out automatically.':'Available after you look at one.')+'</p></div>'+
      '<button type="button" class="btn btn-primary" data-sq="save"'+(shown&&!Q.saving?'':' disabled')+'>'+(Q.saving?'Saving…':'Save and turn it on')+'</button></div>'+msgHtml('save')+'</div>';
  }
  function renderPage(skel){
    if(!Q) Q=STATE.seqSetup=fresh();
    var body;
    if(!Q.loaded) body='<div class="card sq-card"><p class="sq-hint">Loading your sequence…</p></div>';
    else if(Q.err) body='<div class="card sq-card"><p class="sq-warn">'+esc(Q.err)+'</p><div class="sq-row"><button class="btn btn-outline" data-sq="cancel">Back</button></div></div>';
    else body=(Q.step===1?writeStep(skel):startStep());
    var nav=Q.loaded&&!Q.err&&!Q.saved?'<div class="sq-nav">'+
      (Q.step>1?'<button type="button" class="btn btn-outline" data-sq="back">Back</button>':'<button type="button" class="btn btn-outline" data-sq="cancel">Cancel</button>')+
      (Q.step===1?'<button type="button" class="btn btn-primary" data-sq="next"'+(Q.mode?'':' disabled')+'>Continue</button>':'<span></span>')+'</div>':'';
    var eyebrow=named()?'Sequences':'My Setup', title=named()?((Q.target.id?'Edit sequence':'New sequence')+' — '+(Q.target.cand?'candidates':'leads')):'Write your first sequence';
    return UI.page({ body:'<div id="sq-root" class="sq"><div class="sq-head"><div><div class="sq-eyebrow">'+eyebrow+'</div><h1 class="sq-h1">'+esc(title)+'</h1></div>'+stepsHtml()+'</div>'+body+nav+'</div>' });
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
    saveEditors(); Q.preview=null; Q.aitest=null; Q.undo=null;
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
  // The backup, from the answers (AI mode): what it is for, how it ends, how long — kept general, since it goes to any lead.
  function answersPrompt(){
    var t=Q.teach, o=Q.opts||{ends:[],lens:[]};
    var lab=function(list,k){ for(var i=0;i<list.length;i++) if(list[i].k===k) return list[i].label.toLowerCase(); return k; };
    return t.purpose.trim()+'. It is the backup email, sent when the AI cannot write one for the lead, so keep it general to any job. End: '+lab(o.ends,t.end)+'. Length: '+lab(o.lens,t.len)+'.';
  }
  function draftFirst(){
    saveEditors();
    if(Q.mode==='ai'){ if(Q.teach.purpose.trim().length<5){ say('first','Say in one line what the email is for first (under Teach the AI).'); return repaint(); } Q.offer=answersPrompt(); }
    if(!Q.offer.trim()){ say('first','Write a sentence first — PACE does not write from nothing.'); return repaint(); }
    Q.undo=(hasWords(htmlToTokens(Q.first.body))||hasWords(htmlToTokens(Q.first.subject)))?{subject:Q.first.subject,body:Q.first.body,versions:Q.first.versions}:null;
    Q.busy='draft'; say('first',''); repaint();
    apiPost(draftUrl(),{mode:'write', purpose:'first', prompt:Q.offer}).then(function(r){
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
    apiPost(draftUrl(),{mode:'write', purpose:(i===Q.fus.length-1&&i>0?'final':'followup'), prompt:prompt}).then(function(r){
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
      return apiPost(draftUrl(),{mode:'variant', purpose:first?'first':'followup', subject:subject||'(follow-up)', body:body}).then(function(r){
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
    var backup=apiPost('/my-setup/sequence/preview',{subject:b.first.subject, body:b.first.body, versions:b.first.versions}).then(function(r){ Q.preview=r; })
      .catch(function(e){ Q.preview={error:(e&&e.message)||String(e)}; });
    if(Q.mode!=='ai'){ backup.then(function(){ Q.busy=''; repaint(); }); return; }
    // AI mode: the AI writes for a real lead with the answers on screen; the backup is shown beside it, as that lead's fallback.
    Promise.all([backup, apiPost('/my-setup/sequence/ai-test',{teach:b.teach}).then(function(r){ Q.aitest=r; })
      .catch(function(e){ Q.aitest={error:(e&&e.message)||String(e)}; })]).then(function(){ Q.busy=''; repaint(); });
  }
  // A named sequence is saved as a workflow definition: day N of a follow-up becomes "N − previous day" after the step before.
  function namedSteps(b){
    var t=Q.target, cand=t.cand, ch=cand?'candidate_email':'email';
    var clean=function(o){ Object.keys(o).forEach(function(k){ if(o[k]===undefined) delete o[k]; }); return o; };
    var steps=[{ name:'First email', channel:ch, delay_days:0, config:clean({ builder:'v2', subject:b.first.subject, body:b.first.body,
      versions:cand?undefined:b.first.versions, template_key:cand?undefined:'initial', ai:(cand&&Q.mode==='ai')?true:undefined }) }];
    var prev=0;
    b.followups.forEach(function(f,i){
      steps.push({ name:'Follow-up '+(i+1), channel:ch, delay_days:Math.max(1,f.day-prev), config:clean({ builder:'v2',
        subject:String(f.subject||'').trim()||('Re: '+b.first.subject), body:f.body, versions:cand?undefined:f.versions,
        template_key:cand?undefined:'fu'+Math.min(5,i+1), thread:cand?undefined:true }) });
      prev=f.day;
    });
    return steps;
  }
  function saveNamed(){
    var t=Q.target, b=payload();
    if(!String(t.name||'').trim()){ Q.step=1; say('name','Give the sequence a name first.'); return paint(true); }
    Q.saving=true; say('save',''); repaint();
    var body={ name:String(t.name).trim(), steps:namedSteps(b) };
    var req=t.id?apiPut('/wf/definitions/'+t.id, body)
      :apiPost('/wf/definitions', Object.assign(body,{ description:'', domain:t.cand?'recruiting':'sales', entity_type:t.entity }));
    req.then(function(res){
      var id=t.id||(res&&res.id);
      return (t.id?Promise.resolve():apiPost('/wf/definitions/'+id+'/status',{status:'active'})).then(function(){
        t.id=id;
        var ea=t.enrollAfter;
        if(ea&&ea.items&&ea.items.length&&typeof wfEnrollSelectionInto==='function'){ wfEnrollSelectionInto(id, ea.entity_type||t.entity, ea.items); Q.savedStarted=ea.items.length; t.enrollAfter=null; }
        Q.saving=false; Q.saved=true; STATE.wf=undefined; repaint();
      });
    }).catch(function(e){ Q.saving=false; say('save',(e&&e.message)||String(e)); repaint(); });
  }
  function save(){
    if(named()) return saveNamed();
    Q.saving=true; say('save',''); repaint();
    apiPut('/my-setup/sequence', payload()).then(function(){ return savePerId(); }).then(function(){
      Q.saving=false; Q.saved=true;
      apiGet('/outreach-plan').then(function(p){ STATE.myOutreachPlan=p||{}; scheduleRender(); }).catch(function(){});
      if(typeof mySetupSync==='function') mySetupSync();
      repaint();
    }).catch(function(e){ Q.saving=false; say('save',(e&&e.message)||String(e)); repaint(); });
  }

  function savePerId(){
    if(named()||!Q.mbs||Q.mbs.length<2) return Promise.resolve();
    if(Q.mbTab!=='person') stashTab();
    var calls=[apiPost('/outreach-plan',{key:'tmpl_scope', value:Q.scope})];
    Object.keys(Q.mbText||{}).forEach(function(id){ var now=Q.mbText[id], was=(Q.mbOrig||{})[id]||{};
      SLOTS.forEach(function(sl){ ['subject','body'].forEach(function(part){ var v=String((now[sl]||{})[part]||''), o=String((was[sl]||{})[part]||'');
        if(v!==o) calls.push(apiPost('/outreach-plan/mailbox',{ mailbox_id:id, key:'tmpl_'+sl+'_'+part, value:v })); }); }); });
    return Promise.all(calls).then(function(){ Q.mbOrig=JSON.parse(JSON.stringify(Q.mbText)); });
  }

  // ── events (delegated once; everything is scoped to #sq-root) ─────────────
  document.addEventListener('mousedown',function(ev){ if(ev.target.closest&&ev.target.closest('.sq-menu')) ev.preventDefault(); });
  document.addEventListener('click',function(ev){
    var t=ev.target; if(!t.closest||!t.closest('#sq-root')){ closeMenu(); return; }
    if(Q.menu && !t.closest('.sq-menuwrap')) closeMenu();
    var el=t.closest('[data-sq]'); if(!el) return;
    var a=el.getAttribute('data-sq'), i=Number(el.getAttribute('data-i'));
    if(a==='menu'){ var id=el.getAttribute('data-menu'), open=Q.menu!==id; closeMenu(); if(open){ Q.menu=id; var m=el.parentNode.querySelector('.sq-menu'); if(m) m.hidden=false; el.setAttribute('aria-expanded','true'); } return; }
    if(a==='ins'){ var fid=Q.menu==='first'?(rangeField==='sq-subj'?'sq-subj':'sq-body'):(rangeField==='sq-fusubj'+String(Q.menu).slice(2)?rangeField:'sq-'+Q.menu); var k=el.getAttribute('data-k'); closeMenu(); insertChip(fid,k); return; }
    if(a==='mode'){ saveEditors(); Q.mode=el.getAttribute('data-mode'); Q.preview=null; Q.aitest=null; repaint(); return; }
    if(a==='pick'){ var g=el.getAttribute('data-g'), pk=el.getAttribute('data-k'), T=Q.teach;
      if(g==='use'){ var at=T.use.indexOf(pk); if(at>=0) T.use.splice(at,1); else T.use.push(pk); }
      else if(g==='end') T.end=pk; else if(g==='len') T.len=pk; else if(g==='angle') teachFu(i).angle=pk;
      Q.aitest=null; paint(true); return; }
    if(a==='stuck'){ Q.stuck=!Q.stuck; repaint(); return; }
    if(a==='draft'){ if(!Q.busy) draftFirst(); return; }
    if(a==='undo'){ if(Q.undo){ Q.first.subject=Q.undo.subject; Q.first.body=Q.undo.body; Q.first.versions=Q.undo.versions||[]; } Q.undo=null; say('first',''); paint(true); return; }
    if(a==='fudraft'){ if(!Q.busy) draftFollowup(i); return; }
    if(a==='vary'){ if(!Q.busy) vary(el.getAttribute('data-slot')); return; }
    if(a==='rmv'){ saveEditors(); var sl=el.getAttribute('data-slot'); (sl==='first'?Q.first.versions:Q.fus[Number(sl)].versions).splice(i,1); Q.preview=null; paint(true); return; }
    if(a==='futhread'){
      saveEditors(); var thr=el.getAttribute('data-thr')==='new'?'new':'same'; if(!Q.fus[i]||Q.fus[i].thread===thr) return;
      Q.fus[i].thread=thr; paint(true);
      apiPost('/outreach-plan',{key:'fu'+(i+1)+'_thread',value:thr}).then(function(){
        Q.msg['fu'+i]=thr==='new'?'This follow-up goes out as a new email with its own subject.':'This follow-up replies in the same thread.'; paint(true);
      }).catch(function(e){ Q.msg['fu'+i]='Could not save that: '+((e&&e.message)||e); paint(true); });
      return;
    }
    if(a==='rewrite'||a==='rwundo'||a==='spam'){
      saveEditors();
      var slot=el.getAttribute('data-slot'), first=slot==='first', fu=first?null:Q.fus[Number(slot)];
      var subjTok=first?htmlToTokens(Q.first.subject).replace(/\n/g,' ').trim():String(fu.subject||'');
      var bodyTok=htmlToTokens(first?Q.first.body:fu.body).trim();
      var mkey=first?'first':'fu'+slot;
      if(a==='rwundo'){ var u=Q.rwUndo; if(!u||u.slot!==slot) return; if(first){ Q.first.subject=u.subject; Q.first.body=u.body; } else { fu.subject=u.subject; fu.body=u.body; } Q.rwUndo=null; Q.msg[mkey]=''; paint(true); return; }
      if(!hasWords(bodyTok)&&!hasWords(subjTok)){ Q.msg[mkey]='Write the email first — there is nothing to '+(a==='spam'?'check':'rewrite')+'.'; paint(true); return; }
      if(a==='spam'){
        apiPost('/emails/spam-check',{subject:subjTok,body:bodyTok}).then(function(res){ Q.spam=Q.spam||{}; Q.spam[slot]=res; paint(true); })
          .catch(function(e){ Q.msg[mkey]='Could not check it: '+((e&&e.message)||e); paint(true); });
        return;
      }
      Q.busy='rewrite'+slot; paint(true);
      apiPost(draftUrl(),{prompt:'',purpose:first?'first':'followup',mode:'rewrite',subject:subjTok,body:bodyTok}).then(function(r){
        Q.busy='';
        if(!r||r.source==='refused'||(!r.subject&&!r.body&&r.source!=='kept')){ Q.msg[mkey]=(r&&r.note)||'Could not rewrite it just now.'; paint(true); return; }
        if(r.source!=='kept'){
          Q.rwUndo={ slot:slot, subject:first?Q.first.subject:fu.subject, body:first?Q.first.body:fu.body };
          if(first){ Q.first.subject=tokensToHtml(r.subject||''); Q.first.body=tokensToHtml(r.body||''); }
          else { if(fu.thread==='new'&&r.subject) fu.subject=r.subject; fu.body=tokensToHtml(r.body||''); }
          Q.preview=null;
        }
        Q.msg[mkey]=r.note||'Rewritten — read it through, then save.'; paint(true);
      }).catch(function(e){ Q.busy=''; Q.msg[mkey]='Could not reach the writer: '+((e&&e.message)||e); paint(true); });
      return;
    }
    if(a==='addfu'){ saveEditors(); var last=Q.fus.length?Number(Q.fus[Q.fus.length-1].day):0; var d=DEFAULT_DAYS[Q.fus.length]||last+7; if(d<=last) d=last+4; Q.fus.push({day:d,subject:'',body:'',thread:'same',versions:[]}); teachFu(Q.fus.length-1); paint(true); return; }
    if(a==='rmfu'){ saveEditors(); Q.fus.splice(i,1); Q.teach.fus.splice(i,1); for(var j=1;j<Q.fus.length;j++) if(Number(Q.fus[j].day)<=Number(Q.fus[j-1].day)) Q.fus[j].day=Number(Q.fus[j-1].day)+1; paint(true); return; }
    if(a==='next'){ saveEditors(); var p=payload();
      if(named()&&!String(Q.target.name||'').trim()){ say('name','Give the sequence a name.'); return repaint(); }
      if(Q.mode==='ai'&&!named()&&Q.teach.purpose.trim().length<5){ say('teach','Say in one line what the email is for, so the AI knows what to write.'); return repaint(); }
      if(!p.first.subject||p.first.body.length<20){ say('first',Q.mode==='ai'?'Write your backup email first: a subject and a few lines.':'Write your first email first: a subject and a few lines.'); return repaint(); }
      var empty=p.followups.findIndex(function(f){ return f.body.length<5; }); if(empty>=0){ say('fu'+empty,'This follow-up has no text yet. Write it, or remove it.'); return repaint(); }
      Q.step=2; Q.preview=null; paint(true); var pb=document.querySelector('.pg-body'); if(pb) pb.scrollTop=0; return; }
    if(a==='back'){ Q.step=1; Q.saved=false; paint(true); return; }
    if(a==='scope'){ var sc=el.getAttribute('data-scope'); if(sc==='all'&&Q.mbTab!=='person') showTab('person'); Q.scope=sc; paint(true); return; }
    if(a==='mbtab'){ var mbt=el.getAttribute('data-mb'); if(mbt!==Q.mbTab) showTab(mbt); return; }
    if(a==='cancel'){ var back=named()?Q.target.back:'mysetup'; if(back==='seqsetup') back='email'; goPage(back); return; }
    if(a==='test'){ if(!Q.busy) test(); return; }
    if(a==='save'){ if(!Q.saving) save(); return; }
  });
  document.addEventListener('input',function(ev){
    var t=ev.target; if(!t.closest||!t.closest('#sq-root')) return;
    if(t.id==='sq-offer'){ Q.offer=t.value; return; }
    if(t.id==='sq-name'&&Q.target){ Q.target.name=t.value; if(Q.msg.name){ Q.msg.name=''; } return; }
    if(t.id==='sq-purpose'){ Q.teach.purpose=t.value; Q.aitest=null; if(Q.msg.teach){ Q.msg.teach=''; var mt=t.parentNode.querySelector('.sq-hint[aria-live]'); if(mt) mt.remove(); } return; }
    if(t.id==='sq-voice'){ Q.teach.voice=t.value; Q.aitest=null; return; }
    var fn=t.getAttribute('data-fnote'); if(fn!=null){ teachFu(Number(fn)).note=t.value; Q.aitest=null; return; }
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
  // A <details> stays as the person left it across repaints.
  document.addEventListener('toggle',function(ev){ var d=ev.target; if(!Q||!d||!d.getAttribute||!d.closest||!d.closest('#sq-root')) return; var id=d.getAttribute('data-open'); if(id) Q.open[id]=d.open; },true);
  ['keyup','mouseup','focusin'].forEach(function(evn){ document.addEventListener(evn,function(ev){ var t=ev.target&&ev.target.closest?ev.target.closest('.sq-ed'):null; if(t) remember(t); }); });
})();
