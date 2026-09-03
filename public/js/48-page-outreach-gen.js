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
             job_description:'', sender_title:'' };
  }

  function G(){
    if(!STATE.outreachGen) STATE.outreachGen={
      form:blankForm(), draft:null, loading:false, sending:false,
      error:null, sent:null, sender:null, senderLoading:false, adjustment:'', overCapAsked:false
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

  window.outreachGenField=function(k,v){ G().form[k]=v; };
  window.outreachGenToggle=function(k,v){ G().form[k]=!!v; render(); };
  window.outreachGenType=function(v){ G().form.outreach_type=v; render(); };
  window.outreachGenAdjust=function(v){ G().adjustment=v; };

  window.outreachGenReset=function(){
    var g=G(); g.form=blankForm(); g.draft=null; g.error=null; g.sent=null;
    g.adjustment=''; g.overCapAsked=false; render();
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
    if(g.draft){
      if(subj) g.draft.subject=subj.value;
      if(body) g.draft.email=body.value;
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

    g.loading=true; g.error=null; g.sent=null; render();
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
      bumpUsage();
      render();
    }).catch(function(e){
      g.loading=false; g.error=e.message||'Could not generate the email.'; render();
    });
  };

  window.outreachGenSend=function(){
    var g=collectDom();
    if(!g.draft) return;
    var to=String(g.form.to||'').trim();
    if(!to){ g.error='Enter the address this should go to.'; render(); return; }
    g.sending=true; g.error=null; render();
    apiPost('/outreach/send',{to:to,subject:g.draft.subject,body:g.draft.email}).then(function(r){
      g.sending=false; g.sent={to:to,mailbox:r.mailbox};
      pushHistory(g.form.company&&(g.draft.subject||''),g.form.company,true);
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
    var g=collectDom(); if(!g.draft) return;
    var text=which==='subject'?g.draft.subject:g.draft.email;
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
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<div class="fgrp"><label class="flbl">Contact first name</label>'+
          '<input class="inp" id="og-first" placeholder="Susan" value="'+esc(f.contact_first_name)+'" oninput="outreachGenField(\'contact_first_name\',this.value)"></div>'+
        '<div class="fgrp"><label class="flbl">Contact title (optional)</label>'+
          '<input class="inp" id="og-title" placeholder="Controller / HR Manager" value="'+esc(f.contact_title)+'" oninput="outreachGenField(\'contact_title\',this.value)"></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<div class="fgrp"><label class="flbl">Company</label>'+
          '<input class="inp" id="og-company" placeholder="Robert Caylor Construction Co" value="'+esc(f.company)+'" oninput="outreachGenField(\'company\',this.value)"></div>'+
        '<div class="fgrp"><label class="flbl">Location (optional)</label>'+
          '<input class="inp" id="og-loc" placeholder="Tucson, AZ" value="'+esc(f.location)+'" oninput="outreachGenField(\'location\',this.value)"></div>'+
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

  function outputCard(){
    var g=G(), d=g.draft;
    if(!d){
      return '<div class="card cp" style="text-align:center;color:var(--text3);font-size:13px;padding:36px 16px">'+
        'Fill in the posting and the contact, then generate. The angle and the email show up here.</div>';
    }
    var modeNote=d.mode==='rules'
      ? '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">Written by the built-in rules writer.'+
        (d.ai_error?' The AI writer was unavailable for this one.':'')+'</div>'
      : '';
    var sentBanner=g.sent
      ? '<div style="background:var(--green-l);border-radius:var(--r);padding:9px 12px;font-size:12.5px;margin-bottom:10px">'+
        'Sent to <strong>'+esc(g.sent.to)+'</strong> from '+esc(g.sent.mailbox)+'.</div>'
      : '';
    return '<div class="card cp">'+
      sentBanner+
      modeNote+
      (d.diagnosis?'<div style="background:var(--accent-l);border-radius:var(--r);padding:10px 12px;font-size:12.5px;margin-bottom:12px">'+
        '<strong>Why this angle:</strong> '+esc(d.diagnosis)+'</div>':'')+
      '<div class="fgrp"><label class="flbl">Subject</label>'+
        '<div style="display:flex;gap:8px">'+
          '<input class="inp" id="og-subject" style="flex:1" value="'+esc(d.subject)+'">'+
          '<button class="btn btn-outline btn-sm" onclick="outreachGenCopy(\'subject\')">Copy</button>'+
        '</div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Email body</label>'+
        '<textarea class="txta w100" id="og-body" style="min-height:320px">'+esc(d.email)+'</textarea>'+
      '</div>'+
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
        '<div>'+inputsCard()+'</div>'+
        '<div>'+outputCard()+historyCard()+'</div>'+
      '</div>';
  };
})();
