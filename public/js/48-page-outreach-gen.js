// ════════════════════════════════════════════════════════════════════════════
// OUTREACH GENERATOR — the Email page's "Generator" tab.
//
// Paste a job posting and who you found, get one researched cold email back,
// edit it, send it. The send goes out through the outreach mailbox already
// assigned to you — there is no From picker here on purpose, because choosing
// a From address is choosing an identity.
//
// Two things about how this draws:
//
//   • Typing NEVER calls render(). Every field writes straight into
//     STATE.outreachGen.form on oninput and stops there. A full repaint in the
//     middle of a pasted job description would throw away the caret and, on a
//     long paste, the scroll position of the box you are typing in. render()
//     is called only when the SHAPE of the screen changes — a draft arrives,
//     an error appears, the send finishes.
//   • The meter and the recent list are localStorage, per browser. They are a
//     convenience for the person using the tool, not shared state, and nothing
//     downstream reads them — which is exactly why they do not belong in
//     Postgres.
// ════════════════════════════════════════════════════════════════════════════

(function(){
  "use strict";

  var LS_USAGE='pace_outreach_gen_usage';
  var LS_HIST='pace_outreach_gen_history';

  function blankForm(){
    return { outreach_type:'first', contact_first_name:'', contact_title:'', company:'',
             location:'', to:'', no_agencies:false, no_agencies_text:'', notes:'',
             job_description:'', sender_title:'',
             // Where the recipient came from: a record already in PACE, or typed
             // in from scratch. Kept on the form because it decides what the
             // send is attached to, not just how the picker looks.
             pickedContactId:null, pickedJobId:null };
  }

  function G(){
    if(!STATE.outreachGen) STATE.outreachGen={
      form:blankForm(), draft:null, loading:false, sending:false,
      error:null, sent:null, sender:null, senderLoading:false, adjustment:'', overCapAsked:false,
      // Which framing is on screen, and the edits made to each one. Switching
      // between them must not throw away a sentence you just rewrote — that is
      // the difference between a picker and a regenerate button.
      variantId:null, edits:{},
      // Recipient search — the "someone already in PACE" half of the composer.
      recipMode:'new', recipQuery:'', recipResults:null, recipSearching:false,
      // What you have already sent from here, and what came back.
      sent:null, sentLoading:false, converting:null
    };
    return STATE.outreachGen;
  }
  window.outreachGenState=G;

  // ── local, per-browser usage meter ────────────────────────────────────────
  function monthKey(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function readUsage(){
    try{
      var u=JSON.parse(localStorage.getItem(LS_USAGE)||'null');
      if(!u||u.month!==monthKey()) u={month:monthKey(),generations:0,cap:(u&&u.cap)||150};
      return u;
    }catch(e){ return {month:monthKey(),generations:0,cap:150}; }
  }
  function writeUsage(u){ try{ localStorage.setItem(LS_USAGE,JSON.stringify(u)); }catch(e){} }
  function bumpUsage(){ var u=readUsage(); u.generations+=1; writeUsage(u); return u; }
  window.outreachGenSetCap=function(v){
    var n=parseInt(v,10); if(!n||n<1)n=150;
    var u=readUsage(); u.cap=n; writeUsage(u); G().overCapAsked=false; render();
  };

  function readHistory(){
    try{ return JSON.parse(localStorage.getItem(LS_HIST)||'[]')||[]; }catch(e){ return []; }
  }
  function pushHistory(role,company,sent){
    var h=readHistory();
    h.unshift({d:new Date().toLocaleDateString(),role:role||'(role)',company:company||'(company)',sent:!!sent});
    try{ localStorage.setItem(LS_HIST,JSON.stringify(h.slice(0,15))); }catch(e){}
  }

  // ── data ──────────────────────────────────────────────────────────────────
  // Who will this send as? Asked once per visit. A null mailbox is a real
  // answer, not a failure — the page then says so instead of offering a Send
  // button that cannot work.
  window.loadOutreachSender=function(){
    var g=G();
    if(g.sender||g.senderLoading) return;
    g.senderLoading=true;
    apiGet('/outreach/sender').then(function(r){
      g.sender=r; g.senderLoading=false; render();
    }).catch(function(){ g.senderLoading=false; g.sender={mailbox:null,company_name:'',sender:{}}; render(); });
  };

  // ── the recipient half of the composer ────────────────────────────────────
  window.outreachRecipMode=function(m){
    var g=collectDom(); g.recipMode=m;
    if(m==='new'){ g.form.pickedContactId=null; g.form.pickedJobId=null; }
    render();
  };

  var _recipTimer=null;
  window.outreachRecipSearch=function(q){
    var g=G(); g.recipQuery=q;
    clearTimeout(_recipTimer);
    if(String(q||'').trim().length<2){ g.recipResults=null; return; }
    // Debounced: a request per keystroke would be a request per keystroke.
    _recipTimer=setTimeout(function(){
      g.recipSearching=true;
      apiGet('/outreach/recipients?q='+encodeURIComponent(q)).then(function(r){
        g.recipSearching=false; g.recipResults=r; render();
      }).catch(function(){ g.recipSearching=false; g.recipResults={contacts:[],companies:[]}; render(); });
    },300);
  };

  // Picking a person fills the same fields you would otherwise type, so the
  // rest of the composer does not care which way the recipient arrived.
  window.outreachPickContact=function(json){
    var c=JSON.parse(decodeURIComponent(json));
    var g=G(), f=g.form;
    f.to=c.email||''; f.contact_first_name=(c.name||'').split(/\s+/)[0]||'';
    f.contact_title=c.title||''; f.company=c.company||'';
    f.pickedContactId=c.id||null; f.pickedJobId=c.job_id||null;
    g.recipResults=null; g.recipQuery=c.name||c.email||'';
    render();
  };
  window.outreachPickCompany=function(json){
    var co=JSON.parse(decodeURIComponent(json));
    var g=G();
    g.form.company=co.name||''; if(co.location) g.form.location=co.location;
    g.recipResults=null; g.recipQuery=co.name||'';
    apiGet('/outreach/company-contacts/'+encodeURIComponent(co.id)).then(function(rows){
      g.recipResults={contacts:rows||[],companies:[]}; render();
    }).catch(function(){ render(); });
  };

  // ── what you have sent, and what came back ────────────────────────────────
  window.loadOutreachSent=function(force){
    var g=G();
    if(g.sentLoading||(g.sent&&!force)) return;
    g.sentLoading=true;
    apiGet('/outreach/sent').then(function(rows){
      g.sentLoading=false; g.sent=rows||[]; render();
    }).catch(function(){ g.sentLoading=false; g.sent=[]; render(); });
  };

  window.outreachConvertLead=function(token){
    var g=G();
    var row=(g.sent||[]).filter(function(r){return r.token===token;})[0];
    if(!row) return;
    g.converting=token; render();
    apiPost('/outreach/convert-lead',{
      token:token, email:row.to_email, subject:row.subject,
      name:g.form.contact_first_name||'', company:g.form.company||'',
      title:g.form.contact_title||'', location:g.form.location||''
    }).then(function(r){
      g.converting=null;
      showToast('Lead created — open it from the Leads page','success');
      g.sent=null; loadOutreachSent(true);
    }).catch(function(e){
      g.converting=null;
      var m=e.message==='contact_exists' ? 'That address is already on a lead in PACE.'
          : e.message==='already_converted' ? 'This reply has already been converted.'
          : (e.message||'Could not create the lead.');
      showToast(m,'warning'); g.sent=null; loadOutreachSent(true);
    });
  };

  window.outreachGenField=function(k,v){ G().form[k]=v; };
  window.outreachGenToggle=function(k,v){ G().form[k]=!!v; render(); };
  window.outreachGenType=function(v){ G().form.outreach_type=v; render(); };
  window.outreachGenAdjust=function(v){ G().adjustment=v; };

  window.outreachGenReset=function(){
    var g=G(); g.form=blankForm(); g.draft=null; g.error=null; g.sentOk=null;
    g.recipQuery=''; g.recipResults=null;
    g.adjustment=''; g.overCapAsked=false; g.variantId=null; g.edits={}; render();
  };

  // The variant currently on screen, with any edits applied over it.
  function currentVariant(){
    var g=G(), d=g.draft;
    if(!d) return null;
    var list=(d.variants&&d.variants.length)?d.variants:[d];
    var v=null;
    for(var i=0;i<list.length;i++){ if(list[i].id===g.variantId){ v=list[i]; break; } }
    if(!v) v=list[0];
    var e=g.edits[v.id];
    return e ? {id:v.id,label:v.label,blurb:v.blurb,diagnosis:v.diagnosis,words:v.words,
                subject:e.subject,email:e.email} : v;
  }

  window.outreachPickVariant=function(id){
    var g=collectDom();          // keep whatever is typed in the box we are leaving
    g.variantId=id;
    render();
  };

  function collectDom(){
    // The form lives in STATE, but a repaint can land between a keystroke and
    // a click, so the DOM is the last word right before we send it anywhere.
    var g=G(), ids={
      contact_first_name:'og-first', contact_title:'og-title', company:'og-company',
      location:'og-loc', to:'og-to', no_agencies_text:'og-natext',
      notes:'og-notes', job_description:'og-jd', sender_title:'og-sendertitle'
    };
    Object.keys(ids).forEach(function(k){
      var el=document.getElementById(ids[k]); if(el) g.form[k]=el.value;
    });
    var subj=document.getElementById('og-subject'), body=document.getElementById('og-body');
    var cur=currentVariant();
    if(cur&&(subj||body)){
      // Edits are stored PER VARIANT so switching away and back returns your
      // version, not the generated one.
      g.edits[cur.id]={subject:subj?subj.value:cur.subject, email:body?body.value:cur.email};
      if(g.draft){ g.draft.subject=g.edits[cur.id].subject; g.draft.email=g.edits[cur.id].email; }
    }
    var adj=document.getElementById('og-adjust'); if(adj) g.adjustment=adj.value;
    return g;
  }

  window.outreachGenerate=function(useAdjustment){
    var g=collectDom();
    var f=g.form;
    var missing=[];
    if(!String(f.contact_first_name||'').trim())missing.push('contact first name');
    if(!String(f.company||'').trim())missing.push('company');
    if(!String(f.job_description||'').trim())missing.push('job posting');
    if(missing.length){ g.error='Fill in: '+missing.join(', ')+'.'; render(); return; }

    // The cap is the user's own number and this is their own tool, so it asks
    // once and then gets out of the way — a limit you cannot override is a
    // limit that eventually costs someone a real email.
    var u=readUsage();
    if(u.generations>=u.cap && !g.overCapAsked){
      g.overCapAsked=true;
      g.error='You have hit the monthly cap you set ('+u.cap+'). Click Generate again to carry on.';
      render(); return;
    }

    g.loading=true; g.error=null; g.sentOk=null; render();
    apiPost('/outreach/generate',{
      outreach_type:f.outreach_type,
      contact_first_name:f.contact_first_name, contact_title:f.contact_title,
      company:f.company, location:f.location,
      no_agencies:!!f.no_agencies, no_agencies_text:f.no_agencies_text,
      notes:f.notes, job_description:f.job_description,
      sender:{title:f.sender_title},
      adjustment:useAdjustment?g.adjustment:''
    }).then(function(r){
      g.loading=false; g.draft=r; g.overCapAsked=false;
      g.edits={};
      g.variantId=(r.variants&&r.variants.length)?r.variants[0].id:null;
      bumpUsage();
      render();
    }).catch(function(e){
      g.loading=false; g.error=e.message||'Could not generate the email.'; render();
    });
  };

  window.outreachGenSend=function(){
    var g=collectDom();
    var cur=currentVariant();
    if(!cur) return;
    var to=String(g.form.to||'').trim();
    if(!to){ g.error='Enter the address this should go to.'; render(); return; }
    g.sending=true; g.error=null; render();
    apiPost('/outreach/send',{to:to,subject:cur.subject,body:cur.email}).then(function(r){
      g.sending=false; g.sentOk={to:to,mailbox:r.mailbox};
      g.sent=null; loadOutreachSent(true);   // the list has a new row in it now
      pushHistory(cur.subject||'',g.form.company,true);
      showToast('Sent to '+to,'success');
      render();
    }).catch(function(e){
      g.sending=false;
      g.error=e.message==='no_connected_mailbox'
        ? 'No connected mailbox — connect one under Email Accounts before sending.'
        : (e.message||'The send failed.');
      render();
    });
  };

  window.outreachGenCopy=function(which){
    collectDom();
    var cur=currentVariant(); if(!cur) return;
    var text=which==='subject'?cur.subject:cur.email;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ showToast('Copied','success'); })
        .catch(function(){ showToast('Copy failed — select the text and copy manually','error'); });
    }
  };

  // ── drawing ───────────────────────────────────────────────────────────────
  function esc(s){ return htmlEsc(s); }

  function meterCard(){
    var u=readUsage();
    var pct=u.cap>0?Math.min(100,Math.round(u.generations/u.cap*100)):0;
    var over=u.generations>=u.cap;
    return '<div class="card cp mb3">'+
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap">'+
        '<div style="font-size:12px;color:var(--text3)">This month</div>'+
        '<div style="font-size:13px;font-weight:600">'+u.generations+' of '+u.cap+' drafts</div>'+
      '</div>'+
      '<div style="height:7px;border-radius:5px;background:var(--border);overflow:hidden;margin:6px 0 8px">'+
        '<div style="height:100%;width:'+pct+'%;background:'+(over?'var(--amber)':'var(--accent)')+';transition:width .3s ease"></div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text3)">'+
        '<span>Monthly cap</span>'+
        '<input class="inp" style="width:70px;padding:4px 6px;font-size:12px" value="'+esc(u.cap)+'" '+
          'onchange="outreachGenSetCap(this.value)">'+
        '<span>· counted in this browser only, so it is a nudge rather than a limit</span>'+
      '</div>'+
    '</div>';
  }

  function senderCard(){
    var g=G(), s=g.sender;
    if(!s) return '<div class="card cp mb3" style="font-size:12.5px;color:var(--text3)">Checking which mailbox will send…</div>';
    if(!s.mailbox){
      // A missing mailbox is stated plainly and early. Writing a whole email
      // and only then finding out it cannot go anywhere is the worse version
      // of this screen.
      return '<div class="card cp mb3" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--amber-l)">'+
        '<span style="width:8px;height:8px;border-radius:50%;background:var(--amber);display:inline-block"></span>'+
        '<div style="font-size:12.5px;flex:1;min-width:200px">No connected mailbox — you can still write and copy a draft, but sending needs one connected first.</div>'+
        '<button class="btn btn-outline btn-sm" onclick="goPage(\'emailaccounts\')">Set up a mailbox</button>'+
      '</div>';
    }
    return '<div class="card cp mb3" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block"></span>'+
      '<div style="font-size:12.5px;flex:1;min-width:180px">Sends as <strong>'+
        esc((s.sender&&s.sender.name)||s.mailbox.email)+'</strong> &lt;'+esc(s.mailbox.email)+'&gt;'+
        (s.company_name?' · '+esc(s.company_name):'')+
        '<div style="font-size:11.5px;color:var(--text3)">'+
          (s.ai?'Drafted by the AI writer.':'Drafted by the built-in rules writer — no API key is configured, so this costs nothing.')+
        '</div>'+
      '</div>'+
    '</div>';
  }

  function recipientCard(){
    var g=G(), f=g.form;
    var tab=function(id,lbl){
      var on=g.recipMode===id;
      return '<button type="button" onclick="outreachRecipMode(\''+id+'\')" style="'+
        'border:1px solid '+(on?'var(--accent)':'var(--border2)')+';'+
        'background:'+(on?'var(--accent-l)':'var(--card)')+';color:'+(on?'var(--accent)':'var(--text2)')+';'+
        'font-weight:'+(on?'600':'500')+';font-size:12.5px;border-radius:99px;padding:6px 13px;'+
        'cursor:pointer;font-family:inherit">'+lbl+'</button>';
    };

    var results='';
    if(g.recipMode==='existing'){
      var r=g.recipResults;
      if(g.recipSearching){
        results='<div style="font-size:12px;color:var(--text3);padding:8px 2px">Searching…</div>';
      } else if(r){
        var rows=[];
        (r.contacts||[]).forEach(function(c){
          var j=encodeURIComponent(JSON.stringify(c));
          rows.push('<div onclick="outreachPickContact(\''+j+'\')" style="padding:8px 10px;border-bottom:1px solid var(--border2);cursor:pointer;font-size:12.5px" '+
            'onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'\'">'+
            '<strong>'+esc(c.name||c.email)+'</strong>'+(c.title?' · '+esc(c.title):'')+
            '<div style="font-size:11.5px;color:var(--text3)">'+esc(c.email)+(c.company?' · '+esc(c.company):'')+'</div></div>');
        });
        (r.companies||[]).forEach(function(co){
          var j=encodeURIComponent(JSON.stringify(co));
          rows.push('<div onclick="outreachPickCompany(\''+j+'\')" style="padding:8px 10px;border-bottom:1px solid var(--border2);cursor:pointer;font-size:12.5px" '+
            'onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'\'">'+
            '<strong>'+esc(co.name)+'</strong> <span style="color:var(--text3)">— company</span>'+
            '<div style="font-size:11.5px;color:var(--text3)">'+esc([co.industry,co.location].filter(Boolean).join(' · ')||'see its contacts')+'</div></div>');
        });
        results=rows.length
          ? '<div style="border:1px solid var(--border2);border-radius:var(--r);max-height:230px;overflow:auto;margin-top:8px">'+rows.join('')+'</div>'
          : '<div style="font-size:12px;color:var(--text3);padding:8px 2px">Nothing in PACE matches that. Use <strong>Someone new</strong> to add them.</div>';
      }
    }

    // Once a recipient is settled, show it as a fact rather than leaving the
    // writer to re-read four separate boxes to check who this is going to.
    var chosen=(f.to||f.contact_first_name)?
      '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--accent-l);border-radius:var(--r);margin-top:10px">'+
        '<div style="flex:1;min-width:0;font-size:13px"><strong>'+esc(f.contact_first_name||f.to)+'</strong>'+
          (f.contact_title?' · '+esc(f.contact_title):'')+
          '<div style="font-size:11.5px;color:var(--accent);font-weight:600">'+esc(f.to||'(no address yet)')+'</div>'+
          (f.company?'<div style="font-size:11px;color:var(--text3)">'+esc(f.company)+'</div>':'')+
        '</div>'+
        (f.pickedContactId?'<span class="bdg bdg-blue" style="font-size:10.5px">in PACE</span>':'')+
      '</div>':'';

    return '<div class="card cp mb3">'+
      '<div style="display:flex;gap:6px;margin-bottom:10px">'+
        tab('existing','Someone in PACE')+tab('new','Someone new')+
      '</div>'+
      (g.recipMode==='existing'
        ? '<input class="inp" placeholder="Search by name, email or company" value="'+esc(g.recipQuery)+'" oninput="outreachRecipSearch(this.value)">'+results
        : '<div style="font-size:11.5px;color:var(--text3)">Fill in the contact and company below — nothing is saved to PACE unless you convert a reply into a lead.</div>')+
      chosen+
    '</div>';
  }

  function inputsCard(){
    var f=G().form;
    var radio=function(v,lbl){
      return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">'+
        '<input type="radio" name="og-type" value="'+v+'" '+(f.outreach_type===v?'checked':'')+
        ' onchange="outreachGenType(\''+v+'\')"> '+lbl+'</label>';
    };
    return '<div class="card cp">'+
      '<div class="fgrp"><label class="flbl">Outreach type</label>'+
        '<div style="display:flex;gap:16px">'+radio('first','First outreach')+radio('followup','Follow-up (no reply yet)')+'</div>'+
      '</div>'+
      '<div class="fpair">'+
        '<div class="fgrp"><label class="flbl">Contact first name</label>'+
          '<input class="inp" id="og-first" placeholder="Susan" value="'+esc(f.contact_first_name)+'" oninput="outreachGenField(\'contact_first_name\',this.value)"></div>'+
        '<div class="fgrp"><label class="flbl">Contact title (optional)</label>'+
          '<input class="inp" id="og-title" placeholder="Controller / HR Manager" value="'+esc(f.contact_title)+'" oninput="outreachGenField(\'contact_title\',this.value)">'+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px">Shapes how the email is written. Never printed in it.</div></div>'+
      '</div>'+
      '<div class="fpair">'+
        '<div class="fgrp"><label class="flbl">Company (optional)</label>'+
          '<input class="inp" id="og-company" placeholder="read from the posting" value="'+esc(f.company)+'" oninput="outreachGenField(\'company\',this.value)"></div>'+
        '<div class="fgrp"><label class="flbl">Location (optional)</label>'+
          '<input class="inp" id="og-loc" placeholder="read from the posting" value="'+esc(f.location)+'" oninput="outreachGenField(\'location\',this.value)"></div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Send to</label>'+
        '<input class="inp" id="og-to" placeholder="susan@company.com" value="'+esc(f.to)+'" oninput="outreachGenField(\'to\',this.value)">'+
        '<div style="font-size:11.5px;color:var(--text3);margin-top:4px">Where the finished email goes. Leave it blank to write a draft and copy it out.</div>'+
      '</div>'+
      '<div class="fgrp"><label style="display:flex;align-items:flex-start;gap:8px;font-size:13px">'+
        '<input type="checkbox" '+(f.no_agencies?'checked':'')+' onchange="outreachGenToggle(\'no_agencies\',this.checked)" style="margin-top:3px">'+
        '<span>Posting says no agencies / no calls / inquiries through a form only</span></label>'+
      '</div>'+
      (f.no_agencies?'<div class="fgrp"><label class="flbl">Exact wording (optional)</label>'+
        '<input class="inp" id="og-natext" placeholder="EMPLOYMENT OUTSOURCING/JOB PLACEMENT INQUIRIES..." value="'+esc(f.no_agencies_text)+'" oninput="outreachGenField(\'no_agencies_text\',this.value)"></div>':'')+
      '<div class="fgrp"><label class="flbl">Context on the contact or situation (optional)</label>'+
        '<textarea class="txta w100" id="og-notes" rows="3" placeholder="e.g. mutual connection Christian, 14 years at the company, re-posted after 22 days..." oninput="outreachGenField(\'notes\',this.value)">'+esc(f.notes)+'</textarea>'+
        '<div style="font-size:11.5px;color:var(--text3);margin-top:4px">One real detail from here gets worked into the email — never more than one.</div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Job posting</label>'+
        '<textarea class="txta w100" id="og-jd" style="min-height:180px" placeholder="Paste the full job description. Site clutter (Quick Apply, Continue, nav links) is fine — it gets ignored." oninput="outreachGenField(\'job_description\',this.value)">'+esc(f.job_description)+'</textarea>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Your title in the sign-off</label>'+
        '<input class="inp" id="og-sendertitle" placeholder="Account Manager" value="'+esc(f.sender_title)+'" oninput="outreachGenField(\'sender_title\',this.value)"></div>'+
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">'+
        '<button class="btn btn-primary" onclick="outreachGenerate(false)" '+(G().loading?'disabled style="opacity:.6"':'')+'>'+
          (G().loading?'Writing…':'Generate email')+'</button>'+
        '<button class="btn btn-outline btn-sm" onclick="outreachGenReset()">Clear form</button>'+
      '</div>'+
    '</div>';
  }

  // The signature comes back with the draft; the sender lookup carries it too,
  // so a draft made before that call landed still previews correctly.
  function sigHtml(d){
    var g=G();
    return (d&&d.signature_html)||(g.sender&&g.sender.signature_html)||'';
  }

  function outputCard(){
    var g=G(), d=g.draft;
    if(!d){
      return '<div class="card cp" style="text-align:center;color:var(--text3);font-size:13px;padding:36px 16px">'+
        'Fill in the posting and the contact, then generate. The angle and the email show up here.</div>';
    }
    var cur=currentVariant();
    var list=(d.variants&&d.variants.length)?d.variants:[d];

    // ── THE PICKER, above the preview ──────────────────────────────────────
    // Four framings of the SAME researched facts, each an opener that earned
    // replies in the 30 threads this was built from. Picking beats regenerating:
    // regenerating gives you another guess, this gives you the actual choice.
    var picker='';
    if(list.length>1){
      picker='<div style="margin-bottom:12px">'+
        '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Pick an angle</div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
        list.map(function(v){
          var on=v.id===cur.id;
          var edited=!!g.edits[v.id];
          return '<button type="button" onclick="outreachPickVariant(\''+v.id+'\')" '+
            'title="'+esc(v.blurb||'')+'" style="'+
            'border:1px solid '+(on?'var(--accent)':'var(--border2)')+';'+
            'background:'+(on?'var(--accent-l)':'var(--card)')+';'+
            'color:'+(on?'var(--accent)':'var(--text2)')+';'+
            'font-weight:'+(on?'600':'500')+';font-size:12.5px;border-radius:99px;'+
            'padding:6px 13px;cursor:pointer;font-family:inherit">'+
            esc(v.label||v.id)+
            '<span style="opacity:.65;font-weight:400"> · '+(v.words||0)+'w</span>'+
            (edited?'<span title="you have edited this one" style="opacity:.8"> ·&nbsp;edited</span>':'')+
            '</button>';
        }).join('')+
        '</div>'+
        (cur.blurb?'<div style="font-size:11.5px;color:var(--text3);margin-top:6px">'+esc(cur.blurb)+'</div>':'')+
      '</div>';
    }

    // WHAT THE EMAIL DECIDED IT WAS WRITING ABOUT, stated on its own line.
    // A wrong company reads as one clause inside a paragraph and is easy to
    // send past — "Vice President's Construction Superintendent opening" went
    // out that way. Here it is a labelled value you can check at a glance.
    var u=d.used||{};
    var readRow=function(lbl,val,warn){
      return '<div style="display:flex;gap:8px;padding:3px 0;font-size:12px">'+
        '<span style="color:var(--text3);min-width:66px">'+lbl+'</span>'+
        '<span style="font-weight:600;color:'+(warn?'#b45309':'var(--text)')+'">'+esc(val||'—')+'</span></div>';
    };
    var readCard=(u.role||u.company||u.location)?
      '<div style="border:1px solid var(--border2);border-radius:var(--r);padding:10px 12px;margin-bottom:12px;background:var(--bg)">'+
        '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Read from the posting</div>'+
        readRow('Role',u.role)+readRow('Company',u.company)+readRow('Location',u.location)+
        (d.company_rejected?
          '<div style="margin-top:6px;font-size:11.5px;color:#b45309">"'+esc(d.company_rejected)+'" looks like a person\'s job title, so it was not used as the company. Put their title in <strong>Contact title</strong> — it shapes the email but is never printed in it.</div>':'')+
      '</div>':'';

    var modeNote=cur.mode==='rules'
      ? '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">Written by the built-in rules writer.'+
        (d.ai_error?' The AI writer was unavailable for this one.':'')+'</div>'
      : '';
    var sentBanner=g.sentOk
      ? '<div style="background:var(--green-l);border-radius:var(--r);padding:9px 12px;font-size:12.5px;margin-bottom:10px">'+
        'Sent to <strong>'+esc(g.sentOk.to)+'</strong> from '+esc(g.sentOk.mailbox)+'.</div>'
      : '';
    return '<div class="card cp">'+
      sentBanner+
      readCard+
      picker+
      modeNote+
      (cur.diagnosis?'<div style="background:var(--accent-l);border-radius:var(--r);padding:10px 12px;font-size:12.5px;margin-bottom:12px">'+
        '<strong>Why this angle:</strong> '+esc(cur.diagnosis)+'</div>':'')+
      '<div class="fgrp"><label class="flbl">Subject</label>'+
        '<div style="display:flex;gap:8px">'+
          '<input class="inp" id="og-subject" style="flex:1" value="'+esc(cur.subject)+'">'+
          '<button class="btn btn-outline btn-sm" onclick="outreachGenCopy(\'subject\')">Copy</button>'+
        '</div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Email body</label>'+
        '<textarea class="txta w100" id="og-body" style="min-height:320px">'+esc(cur.email)+'</textarea>'+
      '</div>'+
      // WHAT THE RECIPIENT GETS, NOT WHAT THE DRAFT SAYS. The signature is
      // appended by the send path and holds {{sender}}/{{senderemail}}
      // placeholders; showing it here, already filled from the sending mailbox,
      // is the only way an unfilled one is caught before a prospect sees it.
      // The first real send went out signed "{{sender}}".
      (sigHtml(d)?
        '<div class="fgrp"><label class="flbl">Signature (added automatically)</label>'+
          '<div style="border:1px solid var(--border2);border-radius:var(--r);padding:12px;background:var(--bg);max-height:190px;overflow:auto">'+sigHtml(d)+'</div>'+
          (/\{\{/.test(sigHtml(d))?'<div style="font-size:11.5px;color:#b91c1c;margin-top:5px">This signature still has an unfilled variable in it — tell me before you send.</div>':'')+
        '</div>':'')+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
        '<button class="btn btn-primary" onclick="outreachGenSend()" '+(g.sending?'disabled style="opacity:.6"':'')+'>'+
          (g.sending?'Sending…':'Send from my outreach mailbox')+'</button>'+
        '<button class="btn btn-outline btn-sm" onclick="outreachGenCopy(\'email\')">Copy email</button>'+
        '<button class="btn btn-outline btn-sm" onclick="outreachGenerate(false)">Regenerate</button>'+
      '</div>'+
      '<div style="border-top:1px dashed var(--border);padding-top:12px">'+
        '<label class="flbl">Want changes before you send it?</label>'+
        '<div style="display:flex;gap:8px">'+
          '<input class="inp" id="og-adjust" style="flex:1" placeholder="e.g. shorter, more formal, lead with the mutual connection" value="'+esc(g.adjustment)+'" oninput="outreachGenAdjust(this.value)">'+
          '<button class="btn btn-outline btn-sm" onclick="outreachGenerate(true)">Apply</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  function sentCard(){
    var g=G();
    if(g.sent===null){ if(!g.sentLoading) setTimeout(function(){loadOutreachSent();},0); return ''; }
    if(!g.sent.length) return '';
    var fmt=function(d){ try{ return new Date(d).toLocaleDateString(); }catch(e){ return ''; } };
    return '<div class="card cp mt3">'+
      '<div style="font-size:12px;color:var(--text3);font-weight:600;margin-bottom:8px">Sent from here</div>'+
      g.sent.slice(0,12).map(function(r){
        // A reply is the only status worth acting on, so it is the only one that
        // gets a button. Opens are information; a reply is a live conversation
        // that is invisible to the pipeline until somebody makes it a lead.
        var status = r.replied_at
          ? '<span style="color:var(--green);font-weight:600">Replied</span>'
          : r.opened_at
            ? '<span style="color:var(--accent)">Opened'+(r.open_count>1?' · '+r.open_count+'×':'')+'</span>'
            : '<span style="color:var(--text3)">Sent</span>';
        var action = r.lead_id
          ? '<span style="font-size:11.5px;color:var(--text3)">lead created</span>'
          : (r.replied_at
              ? '<button class="btn btn-outline btn-sm" '+(g.converting===r.token?'disabled style="opacity:.6"':'')+
                ' onclick="outreachConvertLead(\''+esc(r.token)+'\')">'+
                (g.converting===r.token?'Creating…':'Convert to lead')+'</button>'
              : '');
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border2)">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.to_email||'')+'</div>'+
            '<div style="font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.subject||'')+'</div>'+
          '</div>'+
          '<div style="font-size:11.5px;white-space:nowrap">'+status+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);white-space:nowrap">'+fmt(r.sent_at)+'</div>'+
          '<div style="min-width:112px;text-align:right">'+action+'</div>'+
        '</div>';
      }).join('')+
      '<div style="font-size:11.5px;color:var(--text3);margin-top:8px">Replies land in your Inbox and you can answer them there. Converting one makes it a lead, so the reply also reaches the pipeline, your reports and the follow-up engine.</div>'+
    '</div>';
  }

  function historyCard(){
    var h=readHistory();
    if(!h.length) return '';
    return '<div class="card cp mt3">'+
      '<div style="font-size:12px;color:var(--text3);font-weight:600;margin-bottom:8px">Recent</div>'+
      h.map(function(r){
        return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--text3);padding:5px 0;border-bottom:1px solid var(--border2)">'+
          '<span><strong style="color:var(--text)">'+esc(r.company)+'</strong>'+(r.sent?' · sent':'')+'</span><span>'+esc(r.d)+'</span></div>';
      }).join('')+
    '</div>';
  }

  // The Email page calls this for its Generator tab.
  window.renderOutreachGenBody=function(){
    var g=G();
    if(!g.sender&&!g.senderLoading) setTimeout(loadOutreachSender,0);
    var err=g.error?'<div style="background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;border-radius:var(--r);padding:10px 12px;font-size:12.5px;margin-bottom:12px">'+esc(g.error)+'</div>':'';
    return senderCard()+meterCard()+err+
      '<div class="og-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">'+
        '<div>'+recipientCard()+inputsCard()+'</div>'+
        '<div>'+outputCard()+sentCard()+'</div>'+
      '</div>';
  };
})();
