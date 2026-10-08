// ── "WHERE THIS COMES FROM" FOR TO-DOS (D-0077) ──────────────────────────────
// The owner, looking at "Needs you today" and "Your client conversations":
// "when clicked on it, it does not show the email from which this information
// is inferred — how do we design the traceback system?"
//
// The design: EVERY row that PACE worked out from something the person can
// open says so — one click opens a drawer with (1) the rule in plain words that
// put it on the list, (2) the actual emails it was worked out from, newest
// first, each marked as theirs or yours, and a link to read a reply in full,
// (3) the one button that does what the row used to do (open the lead / the
// candidate). Nothing is re-derived here: the emails come from the same
// owner-only timeline the lead page already shows (GET /leads/:id/intel), so
// the traceback can never show somebody else's mail and never disagrees with
// the lead's own Emails tab.
//
// 7 Oct (owner): the window must show ONLY what the suggestion was worked out from (the latest
// exchange; older mail is one click away) and must let you DO the thing — a "What to do" band with
// the row's own buttons (reply / chase / move stage / done) — instead of a read-only list.
//
// A row that came from a REMINDER says where the reminder came from instead
// (a sequence step, a person's note, a manager's prompt — its own words from
// services/reminder-source.js via GET /reminders) and its note.
(function(){
  'use strict';
  var SHOWN=8;      // newest emails fetched; the drawer first shows INITIAL of them, the lead page has the rest
  var INITIAL=2;    // the message the suggestion rests on + the one it answers

  function day(iso){ var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
  function clip(t,n){ t=String(t||'').replace(/\s+\n/g,'\n').trim(); return t.length>n?t.slice(0,n).replace(/\s+\S*$/,'')+'…':t; }

  // The emails of one lead, as drawer items. `who` narrows to one person when
  // the row is about one person and they have emails (otherwise the whole lead).
  function leadEmails(leadId, who, firstChip, meta){
    return apiGet('/leads/'+encodeURIComponent(leadId)+'/intel').then(function(r){
      if(!r||r.enabled===false) throw new Error('The email timeline is switched off, so the emails behind this cannot be shown.');
      if(r.owner===false) throw new Error('Only the owner of this lead ('+(r.owner_name||'someone else')+') can read its emails.');
      var tl=(r.timeline||[]).slice().sort(function(a,b){ return String(b.sent_at).localeCompare(String(a.sent_at)); });
      // The exact email the reply / follow-up buttons open, in the person's own mailbox (the server finds it).
      if(meta) meta.target=r.reply_target||null;
      // Who the reply button should answer: the newest thing THEY wrote (kept before narrowing by name).
      if(meta){
        var inb=tl.filter(function(m){ return m.direction==='inbound'&&m.from; })[0];
        if(inb) meta.lastInbound={ email:String(inb.from).replace(/^.*<|>.*$/g,'').trim(), name:inb.person||'' };
      }
      if(who){
        var w=String(who).toLowerCase(), mine=tl.filter(function(m){ return String(m.person||'').toLowerCase().indexOf(w)>=0||String(m.from&&m.from.name||'').toLowerCase().indexOf(w)>=0; });
        if(mine.length) tl=mine;
      }
      var items=tl.slice(0,SHOWN).map(function(m,i){
        var inbound=m.direction==='inbound';
        var it={
          tone:inbound?'in':'out',
          primary:(inbound?'They wrote':'You wrote')+(m.person?' — '+m.person:''),
          secondary:m.subject||'(no subject)',
          body:clip(m.text,700),
          chips:(i===0&&firstChip)?[firstChip]:[],
          when:day(m.sent_at)
        };
        if(inbound&&m.can_open_full){
          it.full={label:'Read the full email',load:function(){
            return apiGet('/leads/'+encodeURIComponent(leadId)+'/intel/messages/'+encodeURIComponent(m.id)+'/full').then(function(x){ return x&&x.text; });
          }};
        }
        return it;
      });
      return { items:items, total:tl.length, more:Math.max(0,tl.length-SHOWN) };
    });
  }

  // A candidate's emails (the send log; candidates keep no reply text, only when they replied).
  function candidateEmails(candId, firstChip){
    return apiGet('/email/history?candidate_id='+encodeURIComponent(candId)+'&days=0').then(function(r){
      // Strictly THIS candidate's mail. (An email with no candidate on it is not theirs — keeping those
      // is what filled the window with messages to other people.)
      var rows=((r&&r.items)||[]).filter(function(x){ return x.candidate_id===candId; });
      rows.sort(function(a,b){ return String(b.sent_at||'').localeCompare(String(a.sent_at||'')); });
      var items=rows.slice(0,SHOWN).map(function(x,i){
        var chips=[]; if(i===0&&firstChip) chips.push(firstChip);
        if(x.replied_at) chips.push('they replied '+day(x.replied_at));
        else if(x.opened_at) chips.push('opened');
        var inbound=x.direction==='in';
        return { tone:inbound?'in':'out',
          primary:inbound?('They wrote'+(x.from_email?' — '+x.from_email:'')):('You wrote'+(x.to_email?' — '+x.to_email:'')),
          secondary:x.subject||'(no subject)', body:clip(x.body,inbound?700:500), chips:chips, when:day(x.sent_at) };
      });
      return { items:items, total:rows.length, more:Math.max(0,rows.length-SHOWN) };
    });
  }

  // A reminder's own story: what created it, in its own words, and the note.
  function reminderItem(reminderId){
    var r=(STATE.reminders||[]).filter(function(x){ return x.id===reminderId; })[0];
    if(!r) return null;
    var src=r.source||{};
    return {
      tone:'out',
      primary:'Why this reminder exists'+(src.label?' — '+src.label:''),
      secondary:src.why||'A reminder set for this person.',
      body:clip(r.note,600),
      chips:[r.return_date?('due '+r.return_date):''].filter(Boolean),
      when:day(r.created_at)
    };
  }

  // THE EMAIL A "REPLY" / "WRITE THE EMAIL" BUTTON ANSWERS (8 Oct, owner). Asks the lead's emails for the newest message the person
  // can answer from their own mailbox, and opens THAT email with the reply window ready — inside the conversation, not a search.
  //   which: 'inbound' = the newest thing THEY wrote (a reply owed) · 'last' = the newest email either way (a follow-up goes as a
  //   reply to it, so it lands in the same thread).  Resolves true when it opened the email, false when it could not (the caller then
  //   falls back to something it can still do).
  window.replyInThread=function(leadId, which, email, known){
    if(!window.mbOpenMessage) return Promise.resolve(false);
    var pick=function(rt){
      var t=rt&&(which==='inbound'?rt.last_inbound:(rt.last||rt.last_inbound));
      if(!t||!t.message_id||!t.mailbox_id) return false;
      mbOpenMessage(t.mailbox_id,t.message_id,{reply:true,q:t.other_email});
      return true;
    };
    if(known&&pick(known)) return Promise.resolve(true);
    if(!leadId) return Promise.resolve(false);
    return apiGet('/leads/'+encodeURIComponent(leadId)+'/intel'+(email?'?email='+encodeURIComponent(email):'')).then(function(r){
      return pick(r&&r.reply_target);
    }).catch(function(){ return false; });
  };

  // opts: { title, hint, leadId, who, candidateId, reminderId, firstChip, open:{label,fn},
  //         task:{text,buttons,stages}, meta:{} (filled with lastInbound once the emails load) }
  window.traceOpen=function(opts){
    var actions=opts.open?[{label:opts.open.label,fn:opts.open.fn}]:[];
    evidenceOpen({
      title:opts.title, hint:opts.hint, actions:actions, task:opts.task||null, initial:INITIAL,
      load:function(){
        var head=[], rem=opts.reminderId?reminderItem(opts.reminderId):null;
        if(rem) head.push(rem);
        var tail=Promise.resolve({items:[],total:0,more:0});
        if(opts.leadId) tail=leadEmails(opts.leadId,opts.who,opts.firstChip,opts.meta);
        else if(opts.candidateId) tail=candidateEmails(opts.candidateId,opts.firstChip);
        return tail.then(function(t){
          return { items:head.concat(t.items), total:head.length+t.total, more:t.more };
        }).catch(function(e){
          // A reminder can still explain itself without the emails.
          if(head.length) return { items:head.concat([{ tone:'out', primary:'The emails could not be shown', secondary:(e&&e.message)||'', chips:[], when:'' }]), total:head.length, more:0 };
          throw e;
        });
      }
    });
  };
})();
