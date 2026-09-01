// ===== SOURCED LEADS (additive) =====
// BD/RA-lead/admin: the review queue for leads the system found on its own, plus
// the screen for choosing which employer job boards to watch.
//
// The review gate is the point of this page. Sourced postings are inert until
// someone approves one here — nothing automated can email a company. Approving
// creates the same company/lead/contact rows a manually entered lead would, so
// everything downstream is untouched.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function canSource(u){ return userHasAnyRole(u,'admin','bd','bd_lead','ra_lead','director','associate_director'); }
  function fmtDate(s){ if(!s)return '—'; try{ var d=new Date(s); return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2); }catch(e){ return '—'; } }
  function daysAgo(s){ if(!s)return null; try{ return Math.round((Date.now()-new Date(s))/86400000); }catch(e){ return null; } }

  STATE.sourced = STATE.sourced || {
    view:'queue', list:null, counts:{}, loading:false, status:'new',
    sources:null, providers:null, notConfigured:false, adding:false, testResult:null, approving:null
  };

  // ── routing (same wrap-render pattern the other pages use) ────────────────
  // Drawn by the shell (UI.registerPage below) — no second repaint per render.
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='sourced'){
      STATE.page='sourced'; STATE.modal=null; render();
      loadQueue(); loadSources();
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='sourced')return; paintPageContent(); }
  UI.registerPage('sourced', function(){ return renderPage(); });

  // ── data ──────────────────────────────────────────────────────────────────
  function loadQueue(){
    var s = STATE.sourced; s.loading = true; paint();
    apiGet('/sourced-leads?status='+encodeURIComponent(s.status)+'&limit=100').then(function(r){
      s.loading=false; s.list=(r&&r.results)||[]; s.counts=(r&&r.counts)||{};
      s.notConfigured = !!(r&&r.not_configured);
      paint();
    }).catch(function(e){ s.loading=false; s.list=[]; showToast('Could not load: '+e.message,'error'); paint(); });
  }
  function loadSources(){
    apiGet('/lead-sources').then(function(r){ STATE.sourced.sources=r||[]; paint(); }).catch(function(){ STATE.sourced.sources=[]; });
    if (!STATE.sourced.providers){
      apiGet('/lead-sources/providers').then(function(r){ STATE.sourced.providers=(r&&r.providers)||[]; paint(); }).catch(function(){});
    }
  }

  window.srcdSetStatus = function(st){ STATE.sourced.status=st; loadQueue(); };
  window.srcdSetView   = function(v){ STATE.sourced.view=v; paint(); };

  // ── review actions ────────────────────────────────────────────────────────
  window.srcdReject = function(id, btn){
    if (btn){ btn.disabled=true; btn.textContent='…'; }
    apiPost('/sourced-leads/'+id+'/reject', {}).then(function(){
      STATE.sourced.list = (STATE.sourced.list||[]).filter(function(x){ return x.id!==id; });
      showToast('Dismissed','info'); paint();
    }).catch(function(e){ showToast('Failed: '+e.message,'error'); if(btn){btn.disabled=false;btn.textContent='Dismiss';} });
  };

  // Approving is a two-step: show what we know (including which contact we would
  // attach and how sure we are about it), then create the lead. An inferred
  // email is a guess, so a person picks it — we never attach one silently.
  window.srcdOpenApprove = function(id){
    var row = (STATE.sourced.list||[]).find(function(x){ return x.id===id; });
    if (!row) return;
    STATE.sourced.approving = { row:row, chosen:{}, domain:row.company_domain||'', busy:false };
    paintApprove();
  };
  window.srcdCloseApprove = function(){ STATE.sourced.approving=null; closeModal(); };
  window.srcdToggleContact = function(email){
    var a = STATE.sourced.approving; if(!a) return;
    a.chosen[email] = !a.chosen[email]; paintApprove();
  };
  // The app renders modals from STATE.modal via the shared shell, so this
  // rebuilds that string and re-renders rather than owning its own overlay.
  function paintApprove(){
    var a = STATE.sourced.approving;
    STATE.modal = a ? renderApproveModal() : null;
    render();
  }
  window.srcdSetDomain = function(v){ if(STATE.sourced.approving) STATE.sourced.approving.domain=v; };

  window.srcdFindContacts = function(){
    var a = STATE.sourced.approving; if(!a) return;
    // Read the live input first — re-rendering the modal would otherwise discard
    // what was just typed.
    var typed = (document.getElementById('srcd-approve-domain')||{}).value;
    if (typed != null) a.domain = String(typed).trim();
    if (!a.domain){ showToast('Add the company website first','error'); return; }
    a.busy=true; paintApprove();
    apiPost('/sourced-leads/'+a.row.id+'/find-contacts', { domain:a.domain }).then(function(r){
      a.busy=false; a.row.contacts=(r&&r.contacts)||[]; a.row.company_domain=a.domain;
      if (!a.row.contacts.length) showToast((r&&r.note)||'No contact could be worked out','info');
      paintApprove();
    }).catch(function(e){ a.busy=false; showToast('Failed: '+e.message,'error'); paintApprove(); });
  };

  window.srcdConfirmApprove = function(){
    var a = STATE.sourced.approving; if(!a || a.busy) return;
    var contacts = (a.row.contacts||[]).filter(function(c){ return a.chosen[c.email]; });
    a.busy=true; paintApprove();
    apiPost('/sourced-leads/'+a.row.id+'/approve', { contacts:contacts }).then(function(){
      STATE.sourced.list = (STATE.sourced.list||[]).filter(function(x){ return x.id!==a.row.id; });
      STATE.sourced.approving=null;
      STATE.modal=null;
      showToast('Lead created — it is now in the Unassigned pool','success');
      render();
    }).catch(function(e){ a.busy=false; showToast('Failed: '+e.message,'error'); paintApprove(); });
  };

  // ── sources config ────────────────────────────────────────────────────────
  window.srcdToggleAdd = function(){ STATE.sourced.adding=!STATE.sourced.adding; STATE.sourced.testResult=null; paint(); };

  function addForm(){
    return {
      provider: (document.getElementById('srcd-provider')||{}).value,
      board_token: ((document.getElementById('srcd-token')||{}).value||'').trim(),
      company_name: ((document.getElementById('srcd-company')||{}).value||'').trim(),
      company_domain: ((document.getElementById('srcd-domain')||{}).value||'').trim()
    };
  }

  window.srcdTest = function(){
    var f = addForm();
    if (!f.board_token){ showToast('Enter the board name first','error'); return; }
    STATE.sourced.testResult = { loading:true }; paint();
    apiPost('/lead-sources/test', f).then(function(r){
      STATE.sourced.testResult = r; paint();
    }).catch(function(e){ STATE.sourced.testResult={ ok:false, error:e.message }; paint(); });
  };

  window.srcdAddSource = function(){
    var f = addForm();
    if (!f.board_token){ showToast('Enter the board name','error'); return; }
    apiPost('/lead-sources', f).then(function(){
      STATE.sourced.adding=false; STATE.sourced.testResult=null;
      showToast('Board added — it will be checked daily','success');
      loadSources();
    }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

  window.srcdRunSource = function(id, btn){
    if (btn){ btn.disabled=true; btn.textContent='Checking…'; }
    apiPost('/lead-sources/'+id+'/run', {}).then(function(r){
      var staged=(r&&r.staged)||0;
      showToast(staged? ('Found '+staged+' new '+(staged===1?'posting':'postings')) : 'Nothing new on that board','success');
      loadSources(); loadQueue();
    }).catch(function(e){ showToast('Failed: '+e.message,'error'); })
      .then(function(){ if(btn){btn.disabled=false;btn.textContent='Check now';} });
  };

  window.srcdDeleteSource = function(id){
    apiDelete('/lead-sources/'+id).then(function(){ showToast('Removed','info'); loadSources(); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

  // ── rendering ─────────────────────────────────────────────────────────────

  function reasonChip(reason){
    if (!reason || !reason.category || reason.category==='unknown') return '';
    var COLORS = {
      hard_to_fill:'var(--red)', team_build:'var(--accent)', growth:'var(--green)',
      backfill:'var(--amber)', new_role:'#7c3aed', new_team:'#7c3aed',
      expansion:'#0891b2', funded:'#0891b2', project_win:'var(--green)', urgent:'var(--red)'
    };
    var LABEL = {
      hard_to_fill:'Hard to fill', team_build:'Team build', growth:'Growth', backfill:'Backfill',
      new_role:'New role', new_team:'New team', expansion:'Expansion', funded:'Funded',
      project_win:'Project win', urgent:'Urgent'
    };
    var c = COLORS[reason.category]||'var(--text3)';
    return '<span style="display:inline-block;font-size:10.5px;font-weight:700;color:#fff;background:'+c+
      ';border-radius:9px;padding:2px 8px;white-space:nowrap">'+esc(LABEL[reason.category]||reason.category)+'</span>';
  }

  function renderQueue(){
    var s = STATE.sourced;
    if (s.loading) return '<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">Loading…</div>';

    if (s.notConfigured || (!s.list||!s.list.length) && !(s.sources||[]).length){
      return '<div class="card" style="padding:30px;text-align:center">'+
        '<div style="font-size:15px;font-weight:700;margin-bottom:6px">No boards being watched yet</div>'+
        '<div style="font-size:13px;color:var(--text2);max-width:560px;margin:0 auto 14px">'+
          'Add a company whose careers page runs on Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee, '+
          'and PACE will check it daily for new openings and bring them here for you to review.</div>'+
        '<button class="btn btn-primary" onclick="srcdSetView(\'sources\')">Add a board to watch</button>'+
      '</div>';
    }

    if (!s.list || !s.list.length){
      return '<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">'+
        (s.status==='new' ? 'Nothing waiting for review. New openings appear here as they are found.'
                          : 'Nothing with that status.')+'</div>';
    }

    return s.list.map(function(r){
      var reason = r.hiring_reason||{};
      var age = daysAgo(r.first_posted_at || r.posted_at);
      var skills = ((r.parsed&&r.parsed.skills)||[]).slice(0,6);
      var contactCount = (r.contacts||[]).length;
      var isDup = r.status==='duplicate';

      return '<div class="card" style="padding:14px 16px;margin-bottom:10px'+(isDup?';opacity:.7':'')+'">'+
        '<div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">'+
          '<div style="min-width:260px;flex:1">'+
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px">'+
              '<span style="font-size:15px;font-weight:700">'+esc(r.title||'—')+'</span>'+
              reasonChip(reason)+
              (isDup?'<span style="font-size:10.5px;font-weight:700;color:var(--amber)">already a lead</span>':'')+
            '</div>'+
            '<div style="font-size:13px;color:var(--text2)">'+
              '<strong>'+esc(r.company_name||'—')+'</strong>'+
              (r.location?' · '+esc(r.location):'')+
              (r.department?' · '+esc(r.department):'')+
            '</div>'+
            // The reason, in plain words. This is the whole point of the feature:
            // the recruiter should know why to call before they call.
            (reason.angle
              ? '<div style="margin-top:8px;font-size:13px;color:var(--text)">'+
                  '<span style="color:var(--text3)">Why call them:</span> '+esc(reason.angle)+'</div>'
              : '')+
            (skills.length
              ? '<div style="margin-top:7px;display:flex;gap:4px;flex-wrap:wrap">'+skills.map(function(k){
                  return '<span style="font-size:10.5px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:2px 7px">'+esc(k)+'</span>';
                }).join('')+'</div>'
              : '')+
            '<div style="margin-top:8px;font-size:11.5px;color:var(--text3)">'+
              (age!=null? 'Posted '+age+' day'+(age===1?'':'s')+' ago' : 'Posted date unknown')+
              (r.repost_count>0? ' · reposted '+r.repost_count+'×' : '')+
              ' · seen '+(r.seen_count||1)+'×'+
              (contactCount? ' · '+contactCount+' possible contact'+(contactCount===1?'':'s') : ' · no contact yet')+
              (r.url? ' · <a href="'+esc(r.url)+'" target="_blank" rel="noopener">view posting</a>' : '')+
            '</div>'+
          '</div>'+
          '<div style="display:flex;gap:6px;align-items:center">'+
            '<button class="btn btn-sm btn-outline" onclick="srcdReject(\''+r.id+'\',this)">Dismiss</button>'+
            '<button class="btn btn-sm btn-primary" onclick="srcdOpenApprove(\''+r.id+'\')">Review &amp; add</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  function renderApproveModal(){
    var a = STATE.sourced.approving; if(!a) return '';
    var r = a.row, reason = r.hiring_reason||{};
    var contacts = r.contacts||[];

    var contactRows = contacts.length
      ? contacts.map(function(c){
          var pct = Math.round((c.confidence||0)*100);
          // Say plainly what this is. An inferred address is a guess, and the
          // person clicking send deserves to know that before they do.
          var label = c.method==='role_mailbox' ? 'company mailbox'
                    : c.method==='known_pattern' ? 'matches this company’s known pattern'
                    : 'guessed from the usual pattern';
          return '<label style="display:flex;gap:9px;align-items:flex-start;padding:8px 9px;border:1px solid var(--border);border-radius:7px;margin-bottom:6px;cursor:pointer">'+
            '<input type="checkbox" '+(a.chosen[c.email]?'checked':'')+' onclick="srcdToggleContact(\''+esc(c.email)+'\')" style="margin-top:2px">'+
            '<span style="flex:1">'+
              '<span style="font-size:13px;font-weight:600">'+esc(c.email)+'</span>'+
              (c.name?'<span style="font-size:12px;color:var(--text2)"> · '+esc(c.name)+'</span>':'')+
              '<div style="font-size:11.5px;color:var(--text3)">'+esc(label)+' · about '+pct+'% likely'+
                (c.deliverable==='domain_ok'?' · domain accepts mail':'')+'</div>'+
            '</span>'+
          '</label>';
        }).join('')
      : '<div style="font-size:12.5px;color:var(--text3);padding:6px 0">'+
          'No contact worked out yet. Add the company’s website and PACE will work out the likely email format.'+
        '</div>';

    return '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:16px">Add this as a lead</div>'+
        '<div style="padding:16px 20px;max-height:62vh;overflow:auto">'+
          '<div style="font-size:14px;font-weight:700">'+esc(r.title||'')+'</div>'+
          '<div style="font-size:13px;color:var(--text2);margin-bottom:10px">'+esc(r.company_name||'')+
            (r.location?' · '+esc(r.location):'')+'</div>'+

          (reason.angle
            ? '<div style="background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:14px">'+
                '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Opening line for outreach</div>'+
                '<div style="font-size:13px">'+esc(reason.angle)+'</div>'+
                '<div style="font-size:11.5px;color:var(--text3);margin-top:5px">This is saved with the lead and is what the first email will lead with.</div>'+
              '</div>'
            : '')+

          '<div style="font-size:12px;font-weight:700;margin-bottom:6px">Who to contact</div>'+
          '<div style="display:flex;gap:6px;margin-bottom:9px">'+
            '<input id="srcd-approve-domain" class="sel" style="flex:1;font-size:12.5px" placeholder="Company website, e.g. acme.com" '+
              'value="'+esc(a.domain||'')+'" oninput="srcdSetDomain(this.value)">'+
            '<button class="btn btn-sm btn-outline" '+(a.busy?'disabled':'')+' onclick="srcdFindContacts()">'+
              (a.busy?'Working…':'Work out email')+'</button>'+
          '</div>'+
          contactRows+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:8px">'+
            'Tick only the addresses you want attached. Nothing is emailed now — the lead goes into the Unassigned pool '+
            'and follows your normal distribution and sequence rules.</div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="srcdCloseApprove()">Cancel</button>'+
          '<button class="btn btn-primary" '+(a.busy?'disabled':'')+' onclick="srcdConfirmApprove()">'+
            (a.busy?'Adding…':'Add lead')+'</button>'+
        '</div>'+
      '</div>';
  }

  function renderSources(){
    var s = STATE.sourced;
    var providers = s.providers||[];
    var list = s.sources||[];

    var test = s.testResult;
    var testBlock = !test ? '' : (test.loading
      ? '<div style="font-size:12.5px;color:var(--text3);margin-top:8px">Checking that board…</div>'
      : (test.ok
        ? '<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px">'+
            '<div style="font-size:13px;font-weight:700;color:var(--green)">✓ Found '+test.found+' open '+(test.found===1?'role':'roles')+'</div>'+
            (test.company_kind==='staffing_firm'
              ? '<div style="font-size:12.5px;color:var(--amber);margin-top:4px">⚠ This looks like a staffing firm rather than an end client'+
                (test.company_kind_why&&test.company_kind_why.length?' ('+esc(test.company_kind_why.join('; '))+')':'')+
                '. Postings from it will be skipped.</div>'
              : '')+
            (test.sample&&test.sample.length
              ? '<div style="margin-top:7px;font-size:12px;color:var(--text2)">'+test.sample.map(function(x){
                  return '• '+esc(x.title)+(x.location?' — '+esc(x.location):'');
                }).join('<br>')+'</div>'
              : '')+
          '</div>'
        : '<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px;font-size:12.5px;color:var(--red)">'+
            esc(test.error||'That board could not be read.')+'</div>'));

    var addBlock = !s.adding ? '' :
      '<div class="card" style="padding:14px 16px;margin-bottom:12px">'+
        '<div style="font-size:13px;font-weight:700;margin-bottom:9px">Watch a new board</div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
          '<select id="srcd-provider" class="sel" style="font-size:12.5px;min-width:150px">'+
            providers.map(function(p){ return '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>'; }).join('')+
          '</select>'+
          '<input id="srcd-token" class="inp" style="font-size:12.5px;min-width:180px" placeholder="Board name">'+
          '<input id="srcd-company" class="inp" style="font-size:12.5px;min-width:170px" placeholder="Company name (optional)">'+
          '<input id="srcd-domain" class="inp" style="font-size:12.5px;min-width:170px" placeholder="Website (for emails)">'+
        '</div>'+
        '<div style="font-size:11.5px;color:var(--text3);margin-bottom:9px">'+
          'The board name is the last part of their careers URL. '+
          (providers.length? esc(providers[0].example||'') : '')+'</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="btn btn-sm btn-outline" onclick="srcdTest()">Test it</button>'+
          '<button class="btn btn-sm btn-primary" onclick="srcdAddSource()">Add board</button>'+
          '<button class="btn btn-sm btn-outline" onclick="srcdToggleAdd()">Cancel</button>'+
        '</div>'+
        testBlock+
      '</div>';

    var rows = !list.length
      ? '<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">No boards yet.</div>'
      : list.map(function(x){
          var when = x.last_run_at ? fmtDate(x.last_run_at) : 'never';
          var bad = x.last_status==='error';
          return '<div class="card" style="padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
            '<div style="min-width:220px">'+
              '<div style="font-size:13.5px;font-weight:700">'+esc(x.company_name||x.board_token)+
                '<span style="font-weight:500;color:var(--text3);font-size:12px"> · '+esc(x.provider)+'</span></div>'+
              '<div style="font-size:11.5px;color:'+(bad?'var(--red)':'var(--text3)')+'">'+
                'Last checked '+esc(when)+
                (x.last_found!=null? ' · '+x.last_found+' roles seen':'')+
                (bad? ' · '+esc(x.last_error||'failed') : '')+
              '</div>'+
            '</div>'+
            '<div style="display:flex;gap:6px">'+
              '<button class="btn btn-sm btn-outline" onclick="srcdRunSource(\''+x.id+'\',this)">Check now</button>'+
              '<button class="btn btn-sm btn-outline" onclick="srcdDeleteSource(\''+x.id+'\')">Remove</button>'+
            '</div>'+
          '</div>';
        }).join('');

    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<div style="font-size:12.5px;color:var(--text3)">PACE checks each board once a day and brings anything new to the review queue.</div>'+
        (s.adding?'':'<button class="btn btn-primary btn-sm" onclick="srcdToggleAdd()">+ Watch a board</button>')+
      '</div>'+ addBlock + rows;
  }

  function renderPage(){
    var s = STATE.sourced;
    if (!canSource(STATE.user))
      return UI.page({ body:'<div class="dt-empty">Not available for your role.</div>' });

    var counts = s.counts||{};
    // Labels in the user's language, not the database's: `new` is work waiting,
    // `duplicate` means we already have it, `promoted` means it made it in.
    var statuses = [['new','To review'],['duplicate','Already have'],
                    ['promoted','Added'],['rejected','Dismissed']];

    var tabs = UI.tabs([
      { id:'queue',   label:'Review queue',  n:(counts['new']||0), onclick:"srcdSetView('queue')" },
      { id:'sources', label:'Boards watched',                      onclick:"srcdSetView('sources')" }
    ], s.view||'queue',
      '<span style="font-size:12px;color:var(--ink3)">Openings PACE found on its own. Nothing is contacted until you add it here.</span>');

    // The status filter IS the strip on this page — every cell is a queue you
    // can stand in, and the number is how much is in it.
    var strip = s.view!=='queue' ? '' : UI.strip(statuses.map(function(st){
      return { v:(counts[st[0]]||0), label:st[1], on:s.status===st[0],
               onclick:"srcdSetStatus('"+st[0]+"')" };
    }));

    return UI.page({
      tabs: tabs,
      strip: strip,
      body: (s.view==='queue' ? renderQueue() : renderSources())
    });
  }

})();
