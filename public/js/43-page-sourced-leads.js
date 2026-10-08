// ===== SOURCED LEADS (additive) — now a TAB INSIDE FIND LEADS (owner, 8 Oct 2026) =====
// BD/RA-lead/admin: the review queue for leads the system found on its own, plus
// the screen for choosing which employer job boards to watch. It used to be its own menu item and page; the owner asked
// for ONE place for finding leads, so this file now only provides the tab's body (srcdBody), its loader (srcdOpen) and
// its count (srcdNewCount) — public/js/68-page-finder.js draws the page and the tab.
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

  // ── what the Find Leads page asks of this file ────────────────────────────
  // The tab repaints through the page it lives in; nothing here writes #content itself.
  function paint(){ var f=STATE.finder; if((STATE.page==='finder'||STATE.page==='sourced')&&f&&f.tab==='sourced') paintPageContent(); }
  window.srcdCan = function(u){ return canSource(u||STATE.user); };
  window.srcdOpen = function(){ loadQueue(); loadSources(); };
  window.srcdNewCount = function(){ return (STATE.sourced&&STATE.sourced.counts&&STATE.sourced.counts['new'])||0; };

  // ── data ──────────────────────────────────────────────────────────────────
  function loadQueue(){
    var s = STATE.sourced; s.loading = true; paint();
    apiGet('/sourced-leads?status='+encodeURIComponent(s.status)+'&limit=100').then(function(r){
      var before = (s.counts&&s.counts['new'])||0;
      s.loading=false; s.list=(r&&r.results)||[]; s.counts=(r&&r.counts)||{};
      s.notConfigured = !!(r&&r.not_configured);
      paint();
      // The menu badge is the number waiting in this queue; redraw the shell only when that number moved.
      if (before !== ((s.counts&&s.counts['new'])||0)) render();
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
    STATE.sourced.approving = { row:row, chosen:{}, domain:row.company_domain||'', busy:false, decision:null };
    paintApprove();
    srcdCheck();
  };
  // "Can this company be added?" (R-157, D-0090): asked as soon as the window opens, and again when the
  // website changes, so the answer is on screen BEFORE the button — the server still enforces it on Add.
  function srcdCheck(){
    var a = STATE.sourced.approving; if(!a) return;
    var rowId = a.row.id, site = (a.domain||a.row.company_domain||'');
    apiPost('/lead-check', { name:a.row.company_name||'', website:site }).then(function(d){
      var cur = STATE.sourced.approving; if(!cur || cur.row.id!==rowId) return;
      cur.decision = d; paintApprove();
    }).catch(function(){ var cur = STATE.sourced.approving; if(cur && cur.row.id===rowId){ cur.decision=null; } });
  }
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
      srcdCheck();   // a new website can turn out to be a company already on file
    }).catch(function(e){ a.busy=false; showToast('Failed: '+e.message,'error'); paintApprove(); });
  };

  window.srcdConfirmApprove = function(){
    var a = STATE.sourced.approving; if(!a || a.busy) return;
    var contacts = (a.row.contacts||[]).filter(function(c){ return a.chosen[c.email]; });
    a.busy=true; paintApprove();
    apiPost('/sourced-leads/'+a.row.id+'/approve', { contacts:contacts, domain:a.domain||undefined }).then(function(){
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
    return '<span class="fs-10_5" style="display:inline-block;font-weight:700;color:#fff;background:'+c+
      ';border-radius:9px;padding:2px 8px;white-space:nowrap">'+esc(LABEL[reason.category]||reason.category)+'</span>';
  }

  function renderQueue(){
    var s = STATE.sourced;
    if (s.loading) return '<div class="c-text3 fs-13" style="padding:40px;text-align:center">Loading…</div>';

    if (s.notConfigured || (!s.list||!s.list.length) && !(s.sources||[]).length){
      return '<div class="card" style="padding:30px;text-align:center">'+
        '<div class="fs-15" style="font-weight:700;margin-bottom:6px">No boards being watched yet</div>'+
        '<div class="fs-13 c-text2" style="max-width:560px;margin:0 auto 14px">'+
          'Add a company whose careers page runs on Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee, '+
          'and PACE will check it daily for new openings and bring them here for you to review.</div>'+
        '<button class="btn btn-primary" onclick="srcdSetView(\'sources\')">Add a board to watch</button>'+
      '</div>';
    }

    if (!s.list || !s.list.length){
      return '<div class="c-text3 fs-13" style="padding:40px;text-align:center">'+
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
              '<span class="fs-15" style="font-weight:700">'+esc(r.title||'—')+'</span>'+
              reasonChip(reason)+
              (isDup?'<span class="fs-10_5 c-amber" style="font-weight:700">already a lead</span>':'')+
            '</div>'+
            '<div class="fs-13 c-text2">'+
              '<strong>'+esc(r.company_name||'—')+'</strong>'+
              (r.location?' · '+esc(r.location):'')+
              (r.department?' · '+esc(r.department):'')+
            '</div>'+
            // The reason, in plain words. This is the whole point of the feature:
            // the recruiter should know why to call before they call.
            (reason.angle
              ? '<div class="fs-13 c-text" style="margin-top:8px">'+
                  '<span class="c-text3">Why call them:</span> '+esc(reason.angle)+'</div>'
              : '')+
            (skills.length
              ? '<div style="margin-top:7px;display:flex;gap:4px;flex-wrap:wrap">'+skills.map(function(k){
                  return '<span class="fs-10_5" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:2px 7px">'+esc(k)+'</span>';
                }).join('')+'</div>'
              : '')+
            '<div class="fs-11_5 c-text3" style="margin-top:8px">'+
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

  // The answer to "can this company be added?": the reason when it cannot (who has it, how many days are left),
  // a note when it is already on file but free (the lead joins THAT company instead of making a second one).
  function decisionBox(d){
    if(!d) return '';
    if(d.blocked) return '<div class="ld-box is-stop" role="alert"><strong>Cannot add this company yet</strong>'+esc(d.sentence)+'</div>';
    if(d.company_id) return '<div class="ld-box is-info"><strong>Already on file as '+esc(d.company_name||'this company')+'</strong>'+
      'Matched on its '+esc(d.matched_text||'record')+'. It is free to add, and the lead will join that company instead of creating a second one.</div>';
    return '';
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
              '<span class="fs-13" style="font-weight:600">'+esc(c.email)+'</span>'+
              (c.name?'<span class="fs-12 c-text2"> · '+esc(c.name)+'</span>':'')+
              '<div class="fs-11_5 c-text3">'+esc(label)+' · about '+pct+'% likely'+
                (c.deliverable==='domain_ok'?' · domain accepts mail':'')+'</div>'+
            '</span>'+
          '</label>';
        }).join('')
      : '<div class="fs-12_5 c-text3" style="padding:6px 0">'+
          'No contact worked out yet. Add the company’s website and PACE will work out the likely email format.'+
        '</div>';

    return '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
        '<div class="fs-16" style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700">Add this as a lead</div>'+
        '<div style="padding:16px 20px;max-height:62vh;overflow:auto">'+
          '<div class="fs-14" style="font-weight:700">'+esc(r.title||'')+'</div>'+
          '<div class="fs-13 c-text2" style="margin-bottom:10px">'+esc(r.company_name||'')+
            (r.location?' · '+esc(r.location):'')+'</div>'+
          decisionBox(a.decision)+

          (reason.angle
            ? '<div style="background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:14px">'+
                '<div class="fs-11 c-text3" style="font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Opening line for outreach</div>'+
                '<div class="fs-13">'+esc(reason.angle)+'</div>'+
                '<div class="fs-11_5 c-text3" style="margin-top:5px">This is saved with the lead and is what the first email will lead with.</div>'+
              '</div>'
            : '')+

          '<div class="fs-12" style="font-weight:700;margin-bottom:6px">Who to contact</div>'+
          '<div style="display:flex;gap:6px;margin-bottom:9px">'+
            '<input id="srcd-approve-domain" class="sel" style="flex:1;font-size:13px" placeholder="Company website, e.g. acme.com" '+
              'value="'+esc(a.domain||'')+'" oninput="srcdSetDomain(this.value)">'+
            '<button class="btn btn-sm btn-outline" '+(a.busy?'disabled':'')+' onclick="srcdFindContacts()">'+
              (a.busy?'Working…':'Work out email')+'</button>'+
          '</div>'+
          contactRows+
          '<div class="fs-11_5 c-text3" style="margin-top:8px">'+
            'Tick only the addresses you want attached. Nothing is emailed now — the lead goes into the Unassigned pool '+
            'and follows your normal distribution and sequence rules.</div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="srcdCloseApprove()">Cancel</button>'+
          '<button class="btn btn-primary" '+((a.busy||(a.decision&&a.decision.blocked))?'disabled':'')+(a.decision&&a.decision.blocked?' title="This company cannot be added right now — see the reason above"':'')+' onclick="srcdConfirmApprove()">'+
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
      ? '<div class="fs-12_5 c-text3" style="margin-top:8px">Checking that board…</div>'
      : (test.ok
        ? '<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px">'+
            '<div class="fs-13 c-green" style="font-weight:700">✓ Found '+test.found+' open '+(test.found===1?'role':'roles')+'</div>'+
            (test.company_kind==='staffing_firm'
              ? '<div class="fs-12_5 c-amber" style="margin-top:4px">⚠ This looks like a staffing firm rather than an end client'+
                (test.company_kind_why&&test.company_kind_why.length?' ('+esc(test.company_kind_why.join('; '))+')':'')+
                '. Postings from it will be skipped.</div>'
              : '')+
            (test.sample&&test.sample.length
              ? '<div class="fs-12 c-text2" style="margin-top:7px">'+test.sample.map(function(x){
                  return '• '+esc(x.title)+(x.location?' — '+esc(x.location):'');
                }).join('<br>')+'</div>'
              : '')+
          '</div>'
        : '<div class="fs-12_5 c-red" style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px">'+
            esc(test.error||'That board could not be read.')+'</div>'));

    var addBlock = !s.adding ? '' :
      '<div class="card" style="padding:14px 16px;margin-bottom:12px">'+
        '<div class="fs-13" style="font-weight:700;margin-bottom:9px">Watch a new board</div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
          '<select id="srcd-provider" class="sel" style="font-size:13px;min-width:150px">'+
            providers.map(function(p){ return '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>'; }).join('')+
          '</select>'+
          '<input id="srcd-token" class="inp" style="font-size:13px;min-width:180px" placeholder="Board name">'+
          '<input id="srcd-company" class="inp" style="font-size:13px;min-width:170px" placeholder="Company name (optional)">'+
          '<input id="srcd-domain" class="inp" style="font-size:13px;min-width:170px" placeholder="Website (for emails)">'+
        '</div>'+
        '<div class="fs-11_5 c-text3" style="margin-bottom:9px">'+
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
      ? '<div class="c-text3 fs-13" style="padding:30px;text-align:center">No boards yet.</div>'
      : list.map(function(x){
          var when = x.last_run_at ? fmtDate(x.last_run_at) : 'never';
          var bad = x.last_status==='error';
          return '<div class="card" style="padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
            '<div style="min-width:220px">'+
              '<div class="fs-13_5" style="font-weight:700">'+esc(x.company_name||x.board_token)+
                '<span class="c-text3 fs-12" style="font-weight:500"> · '+esc(x.provider)+'</span></div>'+
              '<div class="fs-11_5" style="color:'+(bad?'var(--red)':'var(--text3)')+'">'+
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
        '<div class="fs-12_5 c-text3">PACE checks each board once a day and brings anything new to the review queue.</div>'+
        (s.adding?'':'<button class="btn btn-primary btn-sm" onclick="srcdToggleAdd()">+ Watch a board</button>')+
      '</div>'+ addBlock + rows;
  }

  // The tab's body: two views (the queue, the boards) as small pills, the queue's status filter as pills, then the list.
  window.srcdBody = function(){
    var s = STATE.sourced;
    if (!canSource(STATE.user)) return '<div class="card fd-empty">Not available for your role.</div>';
    var counts = s.counts||{}, view = s.view||'queue';
    // Labels in the user's language, not the database's: `new` is work waiting,
    // `duplicate` means we already have it, `promoted` means it made it in.
    var statuses = [['new','To review'],['duplicate','Already have'],['promoted','Added'],['rejected','Dismissed']];
    var pill = function(on, label, click){ return '<button type="button" class="fd-pill'+(on?' on':'')+'" aria-pressed="'+(on?'true':'false')+'" onclick="'+click+'">'+label+'</button>'; };
    var head = '<div class="fd-row fd-between fd-toolbar"><div class="fd-row">'+
        pill(view==='queue','Review queue'+((counts['new']||0)?' · '+counts['new']:''),"srcdSetView('queue')")+
        pill(view==='sources','Boards watched',"srcdSetView('sources')")+
      '</div><span class="fd-hint">Openings PACE found on its own. Nothing is contacted until you add it here.</span></div>';
    var filter = view!=='queue' ? '' : '<div class="fd-row fd-toolbar">'+statuses.map(function(st){
      return pill(s.status===st[0], st[1]+' · '+(counts[st[0]]||0), "srcdSetStatus('"+st[0]+"')");
    }).join('')+'</div>';
    return head+filter+(view==='queue' ? renderQueue() : renderSources());
  };

})();
