// ── "HOW THE AI WRITES FOR YOU" (D-0082, R-147) ──────────────────────────────────
// The owner: "I want AI to write the emails the way I want it. Even in the first
// sequence itself." A short note in plain words, kept per person (and an admin's
// team default), added to the instructions of every email the AI writes in their
// name — the lead engine's FIRST email, the Compose generator, "Write with AI" in
// a sequence step. What a note can and cannot do is in services/ai-style.js; this
// screen says it in words:
//   * it can change tone, length, wording and what to lead with;
//   * it can never switch off the checks that keep an email honest (nothing
//     invented, no fee figure, no call request, no leftover {placeholders});
//   * it only matters while AI is on — and the card says plainly when it is not.
// "Try it on a sample" writes one first email for an INVENTED lead with the note
// that is in the box (saved or not), so the person sees what it does first.
//
// Typing never repaints (the box is not re-rendered per key); only a button does.
(function(){
  'use strict';
  var S=function(){ return STATE.aiStyle||(STATE.aiStyle={ data:null, loading:false, draft:null, teamDraft:null, busy:'', sample:null, err:'' }); };
  var esc=function(t){ return htmlEsc(t==null?'':t); };

  // What each "why not" means, in the words a person uses.
  var WHY={
    not_configured:'AI is not switched on for this PACE yet, so a note cannot change anything until it is. Until then your emails use your own saved wording (My wording).',
    daily_limit:'Today’s AI allowance is used up. Emails are written from your saved wording until tomorrow; your note is kept.',
    ai_unavailable:'The AI did not answer just now. Nothing was written — try again in a minute.',
    ai_unparseable:'The AI’s answer could not be read. Try again, or soften the instruction.',
    draft_rejected:'The AI’s draft broke one of the rules that keep an email honest, so it was not used. In a real send your saved wording goes out instead. Try an instruction that does not ask for what is on the “never” list below.',
    missing_contact_or_company:'The sample lead was incomplete.'
  };
  var RULE={ fee_percentage:'it stated a fee percentage', meeting_ask:'it asked for a call or meeting', too_short:'it was too short', too_long:'it was too long',
    placeholder:'it left a {placeholder} in', double_signoff:'it signed off twice', names_their_job:'it named the reader’s own job back at them' };

  function load(force){
    var s=S(); if(s.loading||(s.data&&!force)) return;
    s.loading=true;
    apiGet('/ai/style').then(function(d){
      s.data=d; s.loading=false; s.err='';
      if(s.draft==null) s.draft=d.person||'';
      if(s.teamDraft==null) s.teamDraft=d.team||'';
      scheduleRender();
    }).catch(function(e){ s.loading=false; s.err=(e&&e.message)||'Could not load'; scheduleRender(); });
  }

  window.aiStyleInput=function(el){
    var s=S(); s.draft=el.value;
    var c=document.getElementById('ais-count'); if(c) c.textContent=el.value.length+' / '+((s.data&&s.data.max)||700);
  };
  window.aiStyleTeamInput=function(el){ S().teamDraft=el.value; };

  window.aiStyleSave=function(){
    var s=S(); if(s.busy) return; s.busy='save'; render();
    apiPut('/ai/style',{note:s.draft||''}).then(function(d){
      s.data=d; s.draft=d.person; s.busy='';
      showToast(d.person?'Saved — the AI will write the way you asked':'Cleared — the AI writes in the house style','success'); render();
    }).catch(function(e){ s.busy=''; showToast('Could not save: '+((e&&e.message)||e),'error'); render(); });
  };
  window.aiStyleSaveTeam=function(){
    var s=S(); if(s.busy) return; s.busy='team'; render();
    apiPut('/ai/style/team',{note:s.teamDraft||''}).then(function(d){
      s.data=d; s.teamDraft=d.team; s.busy='';
      showToast(d.team?'Team default saved':'Team default cleared','success'); render();
    }).catch(function(e){ s.busy=''; showToast('Could not save: '+((e&&e.message)||e),'error'); render(); });
  };
  window.aiStyleSample=function(){
    var s=S(); if(s.busy) return; s.busy='sample'; s.sample=null; render();
    apiPost('/ai/style/sample',{note:s.draft||''}).then(function(r){ s.sample=r; s.busy=''; render(); })
      .catch(function(e){ s.busy=''; s.sample={ error:(e&&e.message)||'Could not try it' }; render(); });
  };
  window.aiStyleExample=function(i){
    var ex=EXAMPLES[i]; if(!ex) return;
    var s=S(); s.draft=ex; render();
  };
  var EXAMPLES=[
    'Warm and plain, like a note to a colleague. Under 90 words. Never say "reaching out". Open with the role they are hiring for.',
    'Short and direct. Two paragraphs at most. Lead with the one hard-to-find skill, then ask if they want to see resumes.',
    'Friendly and a little informal. Short sentences. No jargon. One idea per paragraph.'
  ];

  function sampleHtml(s){
    var r=s.sample; if(s.busy==='sample') return '<div class="ais-sample"><span class="c-text3 fs-13">Writing a sample… (a few seconds)</span></div>';
    if(!r) return '';
    if(r.error) return '<div class="ais-sample is-bad">'+esc(r.error)+'</div>';
    if(r.ai===false) return '<div class="ais-sample is-bad">'+esc(WHY[r.reason]||WHY.not_configured)+'</div>';
    if(!r.written){
      var rules=(r.violations||[]).map(function(v){ return RULE[v]||v; });
      return '<div class="ais-sample is-bad">'+esc(WHY[r.reason]||'No sample was written.')+(rules.length?'<div class="fs-12" style="margin-top:6px">Why: '+esc(rules.join('; '))+'.</div>':'')+'</div>';
    }
    return '<div class="ais-sample"><div class="rep-flbl">A sample first email — invented lead, your note applied'+(r.repaired?' (the AI fixed one slip)':'')+'</div>'+
      '<div class="ais-subj">'+esc(r.subject)+'</div><div class="ais-body">'+esc(r.body)+'</div>'+
      '<div class="fs-12 c-text3" style="margin-top:8px">Your signature is added when it is sent. Each real email is written for its own lead.</div></div>';
  }

  window.renderAiStyleCard=function(){
    var s=S(), d=s.data;
    if(!d){ load(); return '<div class="card cp"><div class="c-text3 fs-13">'+(s.err?esc(s.err):'Loading…')+'</div></div>'; }
    var max=d.max||700, busy=!!s.busy;
    var aiLine=d.ai&&d.ai.available
      ? '<span class="ais-on">AI is on</span> — your note is used for your first emails, the Compose generator and “Write with AI”.'
      : '<span class="ais-off">AI is off right now</span> — '+esc(WHY[(d.ai&&d.ai.reason)||'not_configured']);
    var inForce=d.source==='team'?'<div class="fs-12 c-text3" style="margin-top:6px">You have no note of your own, so the <b>team default</b> is in force: “'+esc(d.team)+'”</div>':'';
    var team=d.can_set_team
      ? '<div class="ais-team"><div class="rep-ttl">Team default <span class="rep-sub">(admin) — used for anyone who has not written their own</span></div>'+
          '<textarea class="inp ais-box ais-box-sm" maxlength="'+max+'" oninput="aiStyleTeamInput(this)" placeholder="e.g. Plain and brief. No marketing words.">'+esc(s.teamDraft)+'</textarea>'+
          '<button class="btn btn-outline btn-sm" '+(busy?'disabled ':'')+'onclick="aiStyleSaveTeam()">'+(s.busy==='team'?'Saving…':'Save team default')+'</button></div>'
      : '';
    return '<div class="card rep-card ais">'+
      '<div class="rep-ttl">How the AI writes for you</div>'+
      '<div class="fs-13 c-text2" style="margin:2px 0 10px">Tell it in your own words — tone, length, how to open, what to avoid. It follows this for every email it writes in your name, <b>including the first email to a lead</b>.</div>'+
      '<div class="fs-12_5" style="margin-bottom:10px">'+aiLine+'</div>'+
      '<textarea id="ais-note" class="inp ais-box" maxlength="'+max+'" oninput="aiStyleInput(this)" placeholder="e.g. Warm and plain. Under 90 words. Never say “reaching out”. Open with the role they are hiring for.">'+esc(s.draft)+'</textarea>'+
      '<div class="ais-row"><span id="ais-count" class="fs-11 c-text3">'+(s.draft||'').length+' / '+max+'</span>'+
        '<span class="ais-ex fs-12 c-text3">Start from: '+EXAMPLES.map(function(_,i){ return '<button class="lx-link" onclick="aiStyleExample('+i+')">example '+(i+1)+'</button>'; }).join(' · ')+'</span></div>'+
      '<div class="ais-actions">'+
        '<button class="btn btn-primary btn-sm" '+(busy?'disabled ':'')+'onclick="aiStyleSave()">'+(s.busy==='save'?'Saving…':'Save')+'</button>'+
        '<button class="btn btn-outline btn-sm" '+(busy?'disabled ':'')+'onclick="aiStyleSample()">'+(s.busy==='sample'?'Writing…':'Try it on a sample')+'</button>'+
      '</div>'+
      inForce+sampleHtml(s)+
      '<div class="ais-never"><div class="rep-flbl">What a note can never change</div>'+
        '<div class="fs-12_5 c-text2">These stay in force whatever you write, and PACE checks every draft against them: nothing invented about the contact or the job · no fee percentage or rate · no request for a call or meeting · no leftover {placeholders} · one sign-off. If a draft breaks one, it is not used — your saved wording goes out instead.</div></div>'+
      team+
    '</div>';
  };
})();
