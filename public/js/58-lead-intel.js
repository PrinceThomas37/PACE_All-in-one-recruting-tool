// ============================================================================
// LEAD EMAILS — the email timeline and "Generate AI summary" inside a lead's
// row on the Leads list (Session 31; the owner: "Just this lead list … let me
// see what it works with current data"). The same engine as the client page
// (routes/client-intel.js, kind 'lead'); OFF until the owner switches it on,
// and then only the lead's OWNER sees anything (D-0040).
//
// The lead row opens WITHOUT render() (06-page-leads.js, rule 2), so this
// never calls render() either: it fills and refills its own element by id.
// ============================================================================
(function(){
  'use strict';
  var C = STATE.leadIntel || (STATE.leadIntel = {});   // id -> { data, open:{}, full:{}, all, busy }
  function esc(s){ return htmlEsc(s); }
  function when(s){ try{ return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return ''; } }
  function el(id){ return document.getElementById('lx-intel-'+id); }

  window.leadIntelSlot = function(j){
    var id = j.id;
    setTimeout(function(){ load(id); }, 0);
    return '<div id="lx-intel-'+esc(id)+'" class="lx-intel" onclick="event.stopPropagation()"></div>';
  };

  function load(id){
    var st = C[id] || (C[id] = { open:{}, full:{} });
    // Show what we already have at once, then refresh — a reply that arrived
    // since the row was last opened must appear without reloading the page.
    if (st.data) paint(id);
    apiGet('/leads/'+encodeURIComponent(id)+'/intel').then(function(d){ st.data = d || { enabled:false }; paint(id); })
      .catch(function(){ if (!st.data) st.data = { enabled:false }; paint(id); });
  }

  function steps(list){
    if(!list||!list.length) return '';
    return '<div class="lxi-steps">'+list.map(function(s){
      return '<div><b>'+esc(s.label||s.id)+'</b>'+(s.why?' <span>— '+esc(s.why)+'</span>':'')+'</div>';
    }).join('')+'</div>';
  }

  function paint(id){
    var node = el(id); if(!node) return;
    var st = C[id], d = st.data;
    // Switched off: draw nothing at all — the row looks exactly as before.
    if(!d || !d.enabled){ node.innerHTML=''; node.hidden=true; return; }
    node.hidden=false;
    if(!d.owner){
      node.innerHTML='<div class="lx-head">Emails</div><div class="lxi-note">Only '+esc(d.owner_name||'this lead’s owner')+' can read this lead’s emails.</div>';
      return;
    }
    var ai=d.ai||{}, s=d.status||{}, sum=d.summary;
    var btn='';
    if(ai.enabled){
      var label, dis=false;
      if(st.busy){ label='Writing the summary…'; dis=true; }
      else if(s.state==='no_emails'){ label='No emails to summarise yet'; dis=true; }
      else if(s.state==='up_to_date'){ label='✓ Up to date'; dis=true; }
      else if(s.state==='new'&&sum){ label='✨ Update summary ('+s.new_count+' new)'; }
      else { label='✨ Generate AI summary'; }
      btn='<div class="lxi-btnrow"><button class="btn btn-sm '+(dis?'btn-outline':'btn-primary')+'"'+(dis?' disabled':'')+' onclick="event.stopPropagation();leadIntelSummarise(\''+id+'\',false)">'+label+'</button>'+
        (s.state==='up_to_date'&&!st.busy?'<button type="button" class="lxi-link" onclick="event.stopPropagation();leadIntelSummarise(\''+id+'\',true)">Rewrite anyway</button>':'')+
        '<span>'+(s.state==='up_to_date'?'Nothing new — costs nothing.':'Uses 1 of your '+(ai.per_user_limit||0)+' today · '+(ai.left_today||0)+' left')+'</span></div>';
    }
    var card = (sum&&sum.summary)
      ? '<div class="lxi-card lxi-ai"><div class="lxi-t">AI summary to '+esc(when(sum.covers_until||sum.updated_at))+'</div><div>'+esc(sum.summary)+'</div>'+steps(sum.next_steps)+btn+'</div>'
      : '<div class="lxi-card"><div class="lxi-t">Where things stand <span>· from the emails, no AI</span></div><div>'+esc((d.facts&&d.facts.summary)||'No emails with this lead yet.')+'</div>'+steps(d.facts&&d.facts.next_steps)+btn+'</div>';
    var tl=d.timeline||[];
    var shown=st.all?tl:tl.slice(0,5);
    var rows=shown.map(function(m){
      var inbound=m.direction==='inbound', open=!!st.open[m.id];
      var full=st.full[m.id];
      var text=full&&full.text?full.text:(m.text||'');
      var foot='';
      if(inbound){
        if(full&&full.loading) foot='Opening the full email from your mailbox…';
        else if(full&&full.error) foot=esc(full.error);
        else if(full&&full.text) foot='The full email, straight from your mailbox — not stored in PACE.';
        else foot='The new part of their email.'+(m.can_open_full?' <button type="button" class="lxi-link" onclick="event.stopPropagation();leadIntelFull(\''+id+'\',\''+m.id+'\')">Open the full email</button>':'');
      }
      return '<div class="lxi-row">'+
        '<div class="lxi-rowhead" onclick="event.stopPropagation();leadIntelToggle(\''+id+'\',\''+m.id+'\')">'+
          '<span class="lxi-dir '+(inbound?'in':'out')+'">'+(inbound?'↙':'↗')+'</span>'+
          '<div class="lxi-rowtxt"><b>'+esc(m.subject||'(no subject)')+'</b><span>'+esc(inbound?(m.person||m.from||'Them'):'You → '+(m.to||''))+' · '+esc(when(m.sent_at))+'</span></div>'+
        '</div>'+
        (open?'<div class="lxi-body">'+esc(text)+(foot?'<div class="lxi-foot">'+foot+'</div>':'')+'</div>':'')+
      '</div>';
    }).join('')||'<div class="lxi-note">No emails with this lead yet.</div>';
    node.innerHTML='<div class="lx-head">Emails <span class="lxi-count">'+(d.total_messages||0)+'</span></div>'+card+rows+
      (tl.length>5&&!st.all?'<button type="button" class="lxi-link" onclick="event.stopPropagation();leadIntelAll(\''+id+'\')">Show all '+tl.length+' emails</button>':'');
  }

  window.leadIntelToggle=function(id,mid){ var st=C[id]; if(!st) return; st.open[mid]=!st.open[mid]; paint(id); };
  window.leadIntelAll=function(id){ var st=C[id]; if(!st) return; st.all=true; paint(id); };
  window.leadIntelFull=function(id,mid){
    var st=C[id]; if(!st) return;
    st.full[mid]={loading:true}; paint(id);
    apiGet('/leads/'+encodeURIComponent(id)+'/intel/messages/'+encodeURIComponent(mid)+'/full').then(function(r){
      st.full[mid]={text:r.text||''}; paint(id);
    }).catch(function(e){ st.full[mid]={error:e.message||'Could not open it.'}; paint(id); });
  };
  window.leadIntelSummarise=function(id,force){
    var st=C[id]; if(!st||st.busy) return;
    st.busy=true; paint(id);
    apiPost('/leads/'+encodeURIComponent(id)+'/summary',{force:!!force}).then(function(r){
      st.busy=false;
      var d=st.data||{};
      if(r.rejected) showToast('The AI summary said something that is not in the emails, so it was thrown away. The free summary is shown.','warning');
      else if(r.summary){
        d.summary=r.summary; d.status=r.status||{state:'up_to_date',new_count:0};
        if(!r.reused&&d.ai){ d.ai.used_today=(d.ai.used_today||0)+1; d.ai.left_today=Math.max(0,(d.ai.left_today||0)-1); }
        showToast(r.reused?'Already up to date — nothing new to read':'Summary written','success');
      }
      paint(id);
    }).catch(function(e){
      st.busy=false; paint(id);
      var code=String(e.message||'');
      if(code==='ai_not_configured'||code==='ai_daily_limit'){ if(window.aiSubscribePopup) aiSubscribePopup(code.slice(3)); }
      else if(code==='no_answer'){ if(window.aiSubscribePopup) aiSubscribePopup('no_answer'); }
      else if(code==='daily_limit') showToast('You have used all your AI summaries for today. They reset tomorrow.','warning');
      else if(code==='rewrite_used_today') showToast('"Rewrite anyway" is once a day per lead.','info');
      else if(code==='switched_off') showToast('AI summaries are switched off.','info');
      else showToast('Could not write the summary: '+code,'error');
    });
  };
})();
