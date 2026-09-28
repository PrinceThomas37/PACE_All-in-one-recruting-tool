// ============================================================================
// THE POC FINDER ON A LEAD'S ROW (R-053, D-0049; docs/CONTACT_FINDER_DESIGN.md).
//
// Four slots — two HR people and two hiring managers — filled from the people
// already on the lead, a one-click company-size pick (size decides which titles
// to look for), and "Add by hand" for an empty slot. When PACE has learned the
// company's OWN email format from real addresses there, a new name's email is
// built from it; when it has not, nothing is built — D-0049: a guessed address
// is never emailed, so PACE never offers one.
//
// The rules and the format live on the server (services/poc-targets.js via GET
// /jobs/:id/poc); this file only draws their answer. The one exception is the
// live preview of an address while a name is typed — `pocEmailFor` below is a
// CHECKED COPY of poc-targets.emailFor (test/poc-finder-ui-smoke.mjs runs the
// same names through both), and the server stores exactly what is shown.
//
// The lead row opens WITHOUT render() (06-page-leads.js rule 2), so this never
// calls render() either: it paints only its own element, #lx-poc-<id>. Until
// the server answers — or if it never does — the plain contact list shows, as
// before, inside that same element.
//
// SLICE 2 — "Search contacts" (every empty slot, top right) or "Search
// contact" (one slot, in the slot — owner, 2026-09-28: the Looking-for rows
// are filled from Apollo "only when a button is click 'search contact'") asks
// Apollo for people in the EMPTY slots, looking the company's size up first
// when nobody has set it. What it
// finds is a SUGGESTION, drawn in the slot it was found for, with its email's
// confidence (Confirmed: Apollo verified it · Likely: built from the company's
// own format · none: PACE will not guess one) and two answers: Accept (it
// becomes an ordinary contact through the server's one add-contact path) or
// Not this person (never suggested for this lead again). The button is drawn
// only when the server would do it: Apollo connected, a slot open with nobody
// waiting in it, and the caller works the lead.
// ============================================================================
(function(){
  'use strict';
  var C = STATE.leadPoc || (STATE.leadPoc = {});   // lead id → { data, busy, finding, acting, msg }
  var adding = {};                                  // lead id → slot key whose form is open
  function esc(s){ return htmlEsc(s); }
  function el(id){ return document.getElementById('lx-poc-'+id); }
  function contactsOf(id){ return ((typeof jobContacts==='function'?jobContacts(id):[])||[]); }

  window.leadPocSlot = function(j, plainHtml){
    var id = j.id, st = C[id];
    setTimeout(function(){ load(id); }, 0);
    return '<div id="lx-poc-'+esc(id)+'" class="lx-poc" onclick="event.stopPropagation()">'+
      (st && st.data ? inner(id) : plainHtml)+'</div>';
  };

  function load(id){
    var st = C[id] || (C[id] = {});
    if (st.busy) return;
    st.busy = true;
    apiGet('/jobs/'+encodeURIComponent(id)+'/poc').then(function(d){
      st.busy = false; if (d && d.slots) { st.data = d; paint(id); }
    }).catch(function(){ st.busy = false; /* the plain list stays — never a blank block */ });
  }
  function paint(id){ var node = el(id); if (node && C[id] && C[id].data) node.innerHTML = inner(id); }

  // ── the checked copy of poc-targets.emailFor ──────────────────────────────
  var FORMATS = {
    'flast':      function(f,l){ return f.charAt(0)+l; },
    'first.last': function(f,l){ return f+'.'+l; },
    'first':      function(f){ return f; },
    'firstlast':  function(f,l){ return f+l; },
    'firstl':     function(f,l){ return f+l.charAt(0); },
    'first_last': function(f,l){ return f+'_'+l; },
    'f.last':     function(f,l){ return f.charAt(0)+'.'+l; },
    'last':       function(f,l){ return l; }
  };
  function nameKey(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,''); }
  window.pocEmailFor = function(first, last, format){
    if(!format||!format.pattern||!format.domain) return null;
    var build = FORMATS[format.pattern], f = nameKey(first), l = nameKey(last);
    if(!build||!f||(!l&&format.pattern!=='first')) return null;
    var local = build(f, l||'');
    return local ? local+'@'+format.domain : null;
  };
  function splitName(full){
    var parts = String(full||'').trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return { first:'', last:'' };
    if(parts.length===1) return { first:parts[0], last:'' };
    return { first:parts[0], last:parts[parts.length-1] };
  }
  var FORMAT_WORDS = {
    'flast':'first initial + surname', 'first.last':'first.last', 'first':'first name only',
    'firstlast':'firstlast', 'firstl':'first name + surname initial', 'first_last':'first_last',
    'f.last':'initial.surname', 'last':'surname only'
  };

  // ── drawing ───────────────────────────────────────────────────────────────
  function inner(id){
    var d = C[id].data, cs = contactsOf(id), byId = {};
    cs.forEach(function(c){ byId[c.id] = c; });
    var shown = {};
    function person(cid){ var c = byId[cid]; if(!c) return ''; shown[cid] = 1; return leadContactRowHtml(c); }
    var sugs = d.suggestions || [];
    var st = C[id], fin = d.finder || {};
    function slot(s){
      var mine = sugs.filter(function(x){ return x.slot_key===s.key; });
      var filled = s.contact_id && byId[s.contact_id];
      if (filled || mine.length){
        // Somebody found for a slot that was filled by hand meanwhile still
        // shows under it — a suggestion never vanishes without an answer.
        return (filled ? '<div class="lxc-slot is-filled">'+person(s.contact_id)+'</div>' : '')+
          mine.map(function(x){ return found(id, x, d); }).join('');
      }
      // "Search contact" for THIS slot, drawn only when the server would do it.
      var busyHere = st.finding && st.findingSlot === s.key;
      var searchOne = (d.can_edit && fin.apollo && adding[id]!==s.key)
        ? '<button type="button" class="btn btn-primary btn-sm lxc-search-one"'+(st.finding?' disabled':'')+' onclick="event.stopPropagation();leadPocFind(\''+id+'\',\''+s.key+'\')">'+(busyHere?'Searching…':'Search contact')+'</button>'
        : '';
      return '<div class="lxc-slot is-empty">'+
        '<div class="lxc-want"><span class="lxc-mark" aria-hidden="true">○</span>'+
          '<div><div class="lxc-want-t">Looking for: '+esc(s.label)+'</div>'+
          '<div class="lxc-want-s">Nobody in this role on the lead yet.</div></div>'+
          '<div class="lxc-want-acts">'+searchOne+
          (d.can_edit && adding[id]!==s.key ? '<button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation();leadPocAdd(\''+id+'\',\''+s.key+'\')">Add by hand</button>' : '')+
          '</div>'+
        '</div>'+
        (adding[id]===s.key ? form(id, s, d) : '')+
      '</div>';
    }
    var hr = d.slots.filter(function(s){ return s.kind==='hr'; });
    var mg = d.slots.filter(function(s){ return s.kind==='manager'; });
    var hrHtml = hr.map(slot).join(''), mgHtml = mg.map(slot).join('');
    // Everybody on the lead is shown somewhere — including someone added a
    // moment ago whom the last answer from the server has not placed yet.
    var rest = cs.filter(function(c){ return !shown[c.id]; });
    var nFound = d.slots.filter(function(s){ return s.contact_id && byId[s.contact_id]; }).length;
    var waitingKeys = {}; sugs.forEach(function(x){ waitingKeys[x.slot_key] = 1; });
    var openSlots = d.slots.filter(function(s){ return !s.contact_id && !waitingKeys[s.key]; }).length;
    // Drawn only when the server would do it (never a button it would refuse).
    var findBtn = (d.can_edit && fin.apollo && openSlots)
      ? '<button type="button" class="btn btn-outline btn-sm lxc-find"'+(st.finding?' disabled':'')+' onclick="event.stopPropagation();leadPocFind(\''+id+'\')">'+(st.finding&&!st.findingSlot?'Searching…':'Search contacts')+'</button>'
      : '';
    // Apollo can size the company (1 credit when found, 0 when not) — offered
    // only while nobody has set a size.
    var lookupBtn = (d.can_edit && fin.apollo && !d.size_known)
      ? '<button type="button" class="lx-link lxc-lookup"'+(st.sizing?' disabled':'')+' onclick="event.stopPropagation();leadPocLookupSize(\''+id+'\')">'+(st.sizing?'Looking up…':'Look up with Apollo')+'</button>'
      : '';
    var sizeCtl = d.can_edit
      ? '<select class="lx-sel lxc-size" aria-label="Company size" onclick="event.stopPropagation()" onchange="event.stopPropagation();leadPocSize(\''+id+'\',this.value)">'+
          '<option value=""'+(d.size_known?'':' selected')+'>Not set</option>'+
          (d.sizes||[]).map(function(b){ return '<option value="'+esc(b.id)+'"'+(d.size_known&&d.size===b.id?' selected':'')+'>'+esc(b.label)+' people</option>'; }).join('')+
        '</select>'
      : '<b>'+esc(d.size_known ? (sizeLabel(d)+' people') : 'not set')+'</b>';
    return '<div class="lxc">'+
      '<div class="lxc-top">'+
        '<div class="lx-head lxc-title">People to reach <span class="lxc-count">'+nFound+' of 4 found'+
          (sugs.length ? ' · '+sugs.length+' to review' : '')+'</span></div>'+
        findBtn+
      '</div>'+
      (st.msg ? '<div class="lxc-msg'+(st.msgErr?' is-err':'')+'" role="status">'+esc(st.msg)+'</div>' : '')+
      '<div class="lxc-group">HR</div>'+hrHtml+
      '<div class="lxc-group">Hiring managers</div>'+mgHtml+
      (rest.length ? '<div class="lxc-group">Also on this lead</div>'+rest.map(function(c){ return '<div class="lxc-slot is-filled">'+leadContactRowHtml(c)+'</div>'; }).join('') : '')+
      '<div class="lxc-foot">'+
        '<span>Company size:</span> '+sizeCtl+lookupBtn+
        '<span class="lxc-foot-note">'+sizeNote(d)+'</span>'+
      '</div>'+
      finderFoot(d)+
    '</div>';
  }
  // What the size line says: where the size came from, and what it means.
  function sizeNote(d){
    var from = d.size_source==='apollo' && d.employee_count
      ? 'From Apollo: about '+Number(d.employee_count).toLocaleString('en-US')+' people. ' : '';
    if (!d.size_known){
      return (d.size_checked_at ? 'Apollo had no size for this company. ' : '')+
        'Assuming 20–50 people until it is set — it decides which titles to look for.';
    }
    return from + (d.size==='1-20'
      ? 'At a company this small the owner usually does the hiring.'
      : 'Looking for the '+esc(d.function.label)+' side at a company this size.');
  }
  function finderFoot(d){
    var fin = d.finder || {};
    if (fin.apollo){
      var c = fin.credits || {};
      return '<div class="lxc-credits">Apollo: '+(c.used||0)+' of '+(c.limit||0)+' credit'+(c.limit===1?'':'s')+' used today · an email built from the company’s own format costs nothing</div>';
    }
    // Only an admin can connect it, so only an admin is told how.
    return fin.is_admin ? '<div class="lxc-credits">Connect Apollo in Admin → Integrations and PACE can find the people still missing here.</div>' : '';
  }

  // A person found and waiting for a yes or no.
  var FORMAT_SHORT = { 'flast':'first initial + surname', 'first.last':'first.last', 'first':'first name', 'firstlast':'firstlast',
    'firstl':'first name + initial', 'first_last':'first_last', 'f.last':'initial.surname', 'last':'surname' };
  function safeLinkedIn(u){ return /^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(String(u||'')) ? String(u) : null; }
  function found(id, x, d){
    var st = C[id], busy = st.acting === x.id;
    var name = [x.first_name, x.last_name].filter(Boolean).join(' ');
    var chip = x.email_confidence==='confirmed' ? '<span class="lxc-conf is-confirmed" title="Apollo verified this address">Confirmed</span>'
      : x.email_confidence==='likely' ? '<span class="lxc-conf is-likely" title="Built from the company’s own email format, learned from real addresses there">Likely</span>'
      : '';
    var fmt = d.format && d.format.pattern ? (FORMAT_SHORT[d.format.pattern]||d.format.pattern) : null;
    var why = x.email_confidence==='confirmed' ? 'email verified by Apollo'
      : x.email_confidence==='likely' ? 'email built from their format'+(fmt?' ('+esc(fmt)+')':'')+' — likely, not checked'
      : 'no email PACE can stand behind — it will not guess one';
    var li = safeLinkedIn(x.linkedin_url);
    return '<div class="lxc-slot is-found">'+
      '<div class="lxc-found">'+
        '<div class="lxc-found-main">'+
          '<div class="lxc-found-name">'+esc(name)+(x.title?'<span class="lxc-found-title"> · '+esc(x.title)+'</span>':'')+'</div>'+
          '<div class="lxc-found-mail">'+(x.email ? '<span class="lxc-mail">'+esc(x.email)+'</span>' : '<span class="lx-muted">No email</span>')+chip+'</div>'+
          '<div class="lxc-found-src">Found on Apollo · '+why+
            (li ? ' · <a href="'+esc(li)+'" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">LinkedIn</a>' : '')+'</div>'+
        '</div>'+
        (d.can_edit ? '<div class="lxc-found-acts">'+
          '<button type="button" class="btn btn-primary btn-sm"'+(st.acting?' disabled':'')+' onclick="event.stopPropagation();leadPocAccept(\''+id+'\',\''+esc(x.id)+'\')">'+(busy&&st.actingWhat==='accept'?'Adding…':'Accept')+'</button>'+
          '<button type="button" class="btn btn-outline btn-sm"'+(st.acting?' disabled':'')+' onclick="event.stopPropagation();leadPocReject(\''+id+'\',\''+esc(x.id)+'\')">Not this person</button>'+
        '</div>' : '')+
      '</div>'+
    '</div>';
  }
  function sizeLabel(d){ var b=(d.sizes||[]).find(function(x){ return x.id===d.size; }); return b?b.label:d.size; }

  function form(id, s, d){
    var f = d.format || {};
    var note = f.pattern
      ? 'Built from their format ('+esc(FORMAT_WORDS[f.pattern]||f.pattern)+', learned from '+f.learned_from+' real address'+(f.learned_from===1?'':'es')+' at '+esc(f.domain)+') — change it if you know better.'
      : 'Their email format is not known yet, so PACE will not guess one — type the address if you have it.';
    return '<div class="lxc-form" onclick="event.stopPropagation()">'+
      '<div class="lxc-row">'+
        '<input id="lxc-name-'+esc(id)+'" class="inp" placeholder="Full name *" oninput="leadPocType(\''+id+'\')" autocomplete="off">'+
        '<input id="lxc-title-'+esc(id)+'" class="inp" placeholder="Title" value="'+esc(s.titles[0]||'')+'">'+
      '</div>'+
      '<input id="lxc-email-'+esc(id)+'" class="inp lxc-email" type="email" placeholder="'+(f.pattern?'Email — filled in from the name':'Email')+'" oninput="leadPocEmailEdited(\''+id+'\')" autocomplete="off">'+
      '<div class="lxc-note">'+note+'</div>'+
      '<div class="lxc-actions">'+
        '<button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation();leadPocSave(\''+id+'\')">Add to this lead</button>'+
        '<button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation();leadPocAdd(\''+id+'\',null)">Cancel</button>'+
      '</div>'+
    '</div>';
  }

  // ── actions ───────────────────────────────────────────────────────────────
  var emailTouched = {};
  window.leadPocAdd = function(id, key){
    adding[id] = key || null; emailTouched[id] = false; paint(id);
    if (key){ var n = document.getElementById('lxc-name-'+id); if (n) n.focus(); }
  };
  // Typing a name fills the email from the company's learned format — until
  // the person edits the email themselves; then it is theirs.
  window.leadPocType = function(id){
    if (emailTouched[id]) return;
    var d = C[id] && C[id].data; if (!d) return;
    var n = document.getElementById('lxc-name-'+id), e = document.getElementById('lxc-email-'+id);
    if (!n || !e) return;
    var nm = splitName(n.value);
    e.value = pocEmailFor(nm.first, nm.last, d.format) || '';
  };
  window.leadPocEmailEdited = function(id){ emailTouched[id] = true; };

  window.leadPocSave = function(id){
    var n = document.getElementById('lxc-name-'+id), t = document.getElementById('lxc-title-'+id), e = document.getElementById('lxc-email-'+id);
    var nm = splitName(n && n.value);
    if (!nm.first){ showToast('A name is needed','error'); if(n) n.focus(); return; }
    var email = String(e && e.value || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('That email does not look right','error'); if(e) e.focus(); return; }
    var existing = contactsOf(id);
    apiPost('/contacts', {
      job_id: id, first_name: nm.first, last_name: nm.last,
      designation: String(t && t.value || '').trim() || null,
      email: email || null,
      is_primary: existing.length === 0
    }).then(function(){
      adding[id] = null;
      showToast('Added to the lead','success');
      // The lead list reloads (the row's contact count changes, so the list
      // redraws and the open row is put back); then the slots are re-asked.
      return (typeof refreshJobs==='function' ? refreshJobs() : Promise.resolve());
    }).then(function(){ C[id] && (C[id].busy = false); load(id); })
      .catch(function(err){ showToast('Could not add: '+(err && err.message || err),'error'); });
  };

  // ── slice 2: find, accept, turn down ─────────────────────────────────────
  function answer(id, d, msg, isErr){
    var st = C[id] || (C[id] = {});
    if (d && d.slots) st.data = d;
    st.msg = msg || null; st.msgErr = !!isErr;
    paint(id);
  }
  // slotKey: one slot ("Search contact" in it); none: every empty slot.
  window.leadPocFind = function(id, slotKey){
    var st = C[id]; if (!st || !st.data || st.finding) return;
    st.finding = true; st.findingSlot = slotKey || null; st.msg = null; paint(id);
    apiPost('/jobs/'+encodeURIComponent(id)+'/poc/find', slotKey ? { slot_key: slotKey } : {}).then(function(d){
      st.finding = false; st.findingSlot = null;
      answer(id, d, d && d.result && d.result.message);
    }).catch(function(err){
      st.finding = false; st.findingSlot = null;
      answer(id, null, (err && err.message) || String(err), true);
    });
  };
  window.leadPocLookupSize = function(id){
    var st = C[id]; if (!st || !st.data || st.sizing) return;
    st.sizing = true; st.msg = null; paint(id);
    apiPost('/jobs/'+encodeURIComponent(id)+'/company-size/lookup', {}).then(function(d){
      st.sizing = false;
      answer(id, d, d && d.result && d.result.message);
    }).catch(function(err){
      st.sizing = false;
      answer(id, null, (err && err.message) || String(err), true);
    });
  };
  window.leadPocAccept = function(id, sid){
    var st = C[id]; if (!st || st.acting) return;
    st.acting = sid; st.actingWhat = 'accept'; paint(id);
    apiPost('/jobs/'+encodeURIComponent(id)+'/poc/suggestions/'+encodeURIComponent(sid)+'/accept', {}).then(function(d){
      st.acting = null;
      if (d && d.slots) st.data = d;
      st.msg = null;
      showToast(d && d.already_on_lead ? 'Already on this lead — linked' : 'Added to the lead','success');
      // The lead list reloads (a new contact), which puts the open row back;
      // then this block is painted from the answer already in hand.
      return (typeof refreshJobs==='function' ? refreshJobs() : Promise.resolve()).then(function(){ paint(id); });
    }).catch(function(err){
      st.acting = null;
      // A 409 means the server decided (already decided, or on another lead
      // at this company) — re-ask it so the block shows the truth.
      answer(id, null, (err && err.message) || String(err), true);
      st.busy = false; load(id);
    });
  };
  window.leadPocReject = function(id, sid){
    var st = C[id]; if (!st || st.acting) return;
    st.acting = sid; st.actingWhat = 'reject'; paint(id);
    apiPost('/jobs/'+encodeURIComponent(id)+'/poc/suggestions/'+encodeURIComponent(sid)+'/reject', {}).then(function(d){
      st.acting = null;
      answer(id, d, null);
      showToast('Taken off — PACE will not suggest them for this lead again','success');
    }).catch(function(err){
      st.acting = null;
      answer(id, null, (err && err.message) || String(err), true);
      st.busy = false; load(id);
    });
  };

  window.leadPocSize = function(id, value){
    apiPut('/jobs/'+encodeURIComponent(id)+'/company-size', { size: value || null }).then(function(d){
      if (d && d.slots){ C[id] = C[id] || {}; C[id].data = d; paint(id); }
      showToast(value ? 'Company size saved — looking for the right titles' : 'Company size cleared','success');
    }).catch(function(err){ showToast('Could not save: '+(err && err.message || err),'error'); paint(id); });
  };
})();
