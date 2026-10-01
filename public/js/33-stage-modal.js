// ===== STAGE-CHANGE MODAL (shared, additive) =====
// Every stage move (kanban, submissions grid, BD job detail, bulk) runs through
// this modal: pick a sub-stage (4–5 per stage), add a note, set the interview
// date/time + location for interview stages, and optionally drop a
// reminder-to-call into the existing reminders system.
//
// MANY PEOPLE AT ONCE (R-077, Session 34). The owner: "There is no option to
// change the stage of the candidate by multiple selection in the candidate or
// the job section." One person is still one PATCH; more than one is ONE
// `POST /submissions/bulk-stage`, and the screen then says who moved and, for
// everyone who did not, the server's own sentence — a partial move is never
// reported as a whole one and a refused person is never dropped. Three screens
// open this: a job's page, its Pipeline tab (both through `stageOpenGroup`) and
// the Candidates page (its own "which job?" step, 27-page-applicants.js).
//   * THE SERVER DECIDES. What this file knows about who may move whom is a
//     CHECKED COPY (RECRUITER_STAGES below) used only to say so BEFORE somebody
//     picks a stage that would be refused — it never removes a person from a
//     request. Everyone ticked is sent; the answer is the truth.
//   * A PERSON WITH NO STAGE ON THE JOB CANNOT BE MOVED. The 15 people tagged
//     before Session 31 have a pipeline row and no submission, so there is no
//     submission id to move. They are left out with a plain sentence and one
//     button that puts them on the job properly (the same POST /pipeline/bulk
//     the Candidates page's "Add to job" uses), after which the move continues.

(function () {

  var SUB_STAGES = {
    'Sourced':              ['New','Attempted Contact','Contacted','Left Message','Not Reachable'],
    'Screening':            ['Scheduled','In Progress','Passed','Failed','No Show'],
    'Submitted to BDM':     ['Under Review','Needs Revision','Approved','Sent Back'],
    'Submitted to Client':  ['Awaiting Feedback','Shortlisted','Feedback Received','Rejected by Client'],
    'Interview Scheduled':  ['Round 1','Round 2','Round 3','Final Round','Rescheduled'],
    'Interview Completed':  ['Awaiting Feedback','Positive','Negative','Next Round Planned'],
    'Offer':                ['Preparing','Extended','Negotiating','Accepted','Declined'],
    'Joining':              ['Docs Pending','BGV In Progress','Cleared','Start Date Confirmed'],
    'Placement':            ['Started','Active','Completed','Extended'],
    // "Not Accepted" merges the old Rejected + Not Joined stages — the outcome is
    // one stage, the reason is the sub-stage (colour-coded on the card).
    'Not Accepted':         ['Rejected by Client','Rejected by BDM','Candidate Withdrew','Position Closed','Offer Declined','No Show','Accepted Elsewhere','Personal Reasons','Counter-Offered'],
    'On Hold':              ['Client Hold','Candidate Hold','Position Hold']
  };
  window.ATS_SUB_STAGES = SUB_STAGES;

  // Old → new stage aliases. Existing rows may still carry the pre-migration
  // names until the data migration runs; normalizeStage() maps them so nothing
  // renders wrong (or a card vanishes) in the meantime.
  var STAGE_ALIASES = { 'Confirmation':'Joining', 'Rejected':'Not Accepted', 'Not Joined':'Not Accepted' };
  function normalizeStage(s){ return STAGE_ALIASES[s] || s; }
  window.normalizeStage = normalizeStage;

  // Full ordered stage list + colors — the single vocabulary every surface
  // (pipeline, submissions grid, board, job detail) now shares.
  var STAGE_LIST = ['Sourced','Screening','Submitted to BDM','Submitted to Client','Interview Scheduled','Interview Completed','Offer','Joining','Placement','Not Accepted','On Hold'];
  window.ATS_STAGE_LIST = STAGE_LIST;
  var STAGE_COLORS = {'Sourced':'var(--text3)','Screening':'#6b7280','Submitted to BDM':'var(--amber)','Submitted to Client':'var(--accent)','Interview Scheduled':'#2563eb','Interview Completed':'#1d4ed8','Offer':'#7c3aed','Joining':'#0891b2','Placement':'var(--green)','Not Accepted':'var(--red)','On Hold':'#9ca3af'};
  window.ATS_STAGE_COLORS = STAGE_COLORS;

  // A colour for a sub-stage, semantically: green = good outcome, red = bad,
  // amber = in-progress. Used to colour the sub-stage chip on the White-board.
  function subStageColor(sub){
    var s=String(sub||'').toLowerCase();
    if(/passed|approved|accepted|cleared|placed|active|completed|shortlisted|positive|confirmed|extended|started/.test(s))return 'var(--green)';
    if(/failed|declined|rejected|no show|withdrew|closed|negative|not reachable|counter/.test(s))return 'var(--red)';
    if(/review|pending|progress|negotiat|preparing|awaiting|scheduled|attempted|left message|revision|sent back|hold|rescheduled|feedback|round/.test(s))return 'var(--amber)';
    return 'var(--text3)';
  }
  window.subStageColor = subStageColor;

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function isInterviewStage(st){ return /^Interview/.test(st); }
  // ISO timestamp → value for a <input type="datetime-local"> (local time).
  // ── interview time zones (R-095, owner: "All time zones. Our product should be used worldwide.") ──
  // The scheduler types a wall time and picks the zone it is in; the instant sent to the server is
  // that wall time read in THAT zone, and the invite email states the time in the same zone.
  var IV_ZONES = null;
  function ivMyZone(){ try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  // Minutes east of UTC that `zone` is at the instant `ms` (a whole number of seconds).
  function ivOffsetMin(zone, ms){
    var f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var p = {}; f.formatToParts(new Date(ms)).forEach(function(x){ p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - ms) / 60000);
  }
  function ivOffsetLabel(min){ var a = Math.abs(min); return 'UTC' + (min < 0 ? '-' : '+') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); }
  // 'YYYY-MM-DDTHH:mm' read in `zone` -> an ISO instant (null if it cannot be read).
  window.ivZonedToInstant = function(wall, zone){
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall || ''); if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    try {
      var o1 = ivOffsetMin(zone, guess), t = guess - o1 * 60000, o2 = ivOffsetMin(zone, t);
      if (o2 !== o1) t = guess - o2 * 60000;          // the wall time straddles a clock change
      return new Date(t).toISOString();
    } catch (e) { return null; }
  };
  function ivZoneList(){
    if (IV_ZONES) return IV_ZONES;
    var z = [];
    try { z = Intl.supportedValuesOf('timeZone').slice(); } catch (e) { /* older browser: the short list below */ }
    if (!z.length) z = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Toronto','Europe/London','Europe/Berlin','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];
    if (z.indexOf('UTC') < 0) z.unshift('UTC');
    var mine = ivMyZone(); if (z.indexOf(mine) < 0) z.unshift(mine);
    var now = Date.now() - (Date.now() % 1000);
    IV_ZONES = z.map(function(id){ var o = 0; try { o = ivOffsetMin(id, now); } catch (e) {} return { id: id, off: o }; })
      .sort(function(a, b){ return a.off - b.off || (a.id < b.id ? -1 : 1); });
    return IV_ZONES;
  }
  function ivZoneSelect(){
    var mine = ivMyZone();
    return '<select id="stg-iv-tz" class="sel">' + ivZoneList().map(function(z){
      return '<option value="' + esc(z.id) + '"' + (z.id === mine ? ' selected' : '') + '>(' + ivOffsetLabel(z.off) + ') ' + esc(z.id.replace(/_/g, ' ')) + '</option>';
    }).join('') + '</select>';
  }

  function toLocalInput(iso){ if(!iso) return ''; var d=new Date(iso); if(isNaN(d.getTime())) return ''; var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes()); }

  // ── Who may move whom — said BEFORE it is refused ───────────────────────────
  // Recruiters own the stages up to "Submitted to BDM". Everything after —
  // client submission, interview scheduling, offer, placement, rejection — is
  // BD's; recruiters see those stages but can't change them. A CHECKED COPY of
  // RECRUITER_STAGES in services/submission-stages.js: the server is what
  // enforces it, this is only so a screen can say so up front.
  var RECRUITER_STAGES = ['Sourced','Screening','Submitted to BDM'];
  var TO_BDM = 'Submitted to BDM';
  // The reasons for rejecting somebody on a job (owner, 2026-09-30). The chosen one is stored at
  // the front of `rejection_reason`, so it can be counted.
  var REJECT_REASONS = ['Out of budget','Travel issue','Did not like the company','Skills do not match','Over qualified','Not interested','Other'];
  window.ATS_REJECT_REASONS = REJECT_REASONS;
  function recruiterScoped(){
    var u = STATE.user;
    return userHasRole(u,'recruiter') && !userHasAnyRole(u,'admin','bd','bd_lead');
  }
  // Why a stage is not on offer for a group of `count` people, or '' when it is.
  // Two request-level rules, the same two the server refuses a whole group for.
  window.stageGroupWhy = function(stage, count){
    if (!recruiterScoped()) return '';
    if (RECRUITER_STAGES.indexOf(stage) < 0) return 'BD team only';
    if (stage === TO_BDM && count > 1) return 'one at a time';
    return '';
  };
  window.stageGroupHint = function(){
    if (!recruiterScoped()) return '';
    return 'You can move people up to “Submitted to BDM”. Submitting to the BD Manager is one person at a time — each needs its own submission details.';
  };
  // The ONE "change stage for the ticked people" control, drawn by the job page,
  // its Pipeline tab and the Candidates page's picker. A stage the caller cannot
  // use is shown greyed with its reason rather than left out — a missing option
  // looks like a bug, a greyed one explains itself.
  window.stageGroupSelect = function(count, onchange, disabled){
    var opts = '<option value="">Change stage…</option>' + STAGE_LIST.map(function(st){
      var why = window.stageGroupWhy(st, count);
      return '<option value="'+esc(st)+'"'+(why?' disabled':'')+'>'+esc(st)+(why?' — '+esc(why):'')+'</option>';
    }).join('');
    return '<select class="sel stg-pick" aria-label="Change stage of the ticked people"'+(disabled?' disabled':'')+
      ' onchange="'+onchange+'">'+opts+'</select>';
  };

  // ── Putting people on a job properly ─────────────────────────────────────────
  // Somebody can be on a job's roster with no stage of their own: the 15 people
  // tagged before Session 31 have a pipeline row and no submission, so there is
  // nothing for a stage move to act on. Adding them to the job again writes the
  // missing half — the SAME `POST /pipeline/bulk` the Candidates page's "Add to
  // job" uses, so there is no second way to do it. It is what replaced the old
  // `POST /pipeline/:id/promote`, which no screen calls any more.
  window.stageFinishAdding = function(jobId, cids){
    return apiPost('/pipeline/bulk', { candidate_ids: cids, job_order_id: jobId }).then(function(r){
      var bad = ((r && r.failed) || 0) + ((r && r.not_found) || 0);
      if (bad) {
        var first = r && r.errors && r.errors[0] && r.errors[0].error;
        var e = new Error(bad + (bad === 1 ? ' person' : ' people') + ' could not be added' + (first ? ': ' + first : '.'));
        e.result = r; throw e;
      }
      return r;
    });
  };
  // One person's submission on one job — what GET /submissions?candidate_ids= is for.
  window.stageSubmissionFor = function(cid, jobId){
    return apiGet('/submissions?candidate_ids=' + encodeURIComponent(cid)).then(function(d){
      var rows = (d && d.submissions) || [];
      return rows.filter(function(s){ return s.job_order_id === jobId; })[0] || null;
    });
  };

  // A group move started from a job's OWN list — the job page's roster and its
  // Pipeline tab both come through here, so what happens to a ticked person with
  // no stage yet is decided once. `o`:
  //   jobId, jobTitle, stage
  //   rowsNow()  the ticked people, read fresh: [{ cid, name, sub:{id,stage,sub_stage}|null }]
  //   reload()   a Promise that refreshes the page's own data
  //   onDone(updated, info)
  window.stageOpenGroup = function(o){
    var rows = (o.rowsNow && o.rowsNow()) || [];
    if (!rows.length) { showToast('Tick the people you want to move first','error'); return; }
    var linked = rows.filter(function(r){ return r.sub && r.sub.id; });
    // Ticked, on the job, but nothing to move: never dropped without a word.
    var missing = rows.filter(function(r){ return !(r.sub && r.sub.id); })
      .map(function(r){ return { cid: r.cid, name: r.name || '' }; });
    var people = {};
    linked.forEach(function(r){
      people[r.sub.id] = { name: r.name || '', stage: r.sub.stage, sub_stage: r.sub.sub_stage || null, cid: r.cid };
    });
    openStageModal(linked.map(function(r){ return r.sub.id; }), o.stage, o.onDone, {
      people: people, jobId: o.jobId, jobTitle: o.jobTitle, ticked: rows.length,
      missing: missing, missingKind: 'legacy',
      // After they have been added: reload the page's data and open the move again,
      // now with everybody in it.
      afterFix: function(){
        return Promise.resolve(o.reload ? o.reload() : null).catch(function(){}).then(function(){ window.stageOpenGroup(o); });
      }
    });
  };
  // ONE person with no stage yet, moved from their row's own stage control: put
  // them on the job properly first (the same add as above), then open the
  // ordinary move on their new submission. `o`: cid, name, jobId, jobTitle,
  // stage, reload(), onDone.
  window.stageMoveUnlinked = function(o){
    window.stageFinishAdding(o.jobId, [o.cid]).then(function(){
      return window.stageSubmissionFor(o.cid, o.jobId);
    }).then(function(row){
      if (!row) { showToast('Could not finish adding '+(o.name||'this person')+' to the job — try Add to job on the Candidates page.','error'); return; }
      var people = {}; people[row.id] = { name: o.name || '', stage: row.stage, sub_stage: row.sub_stage || null, cid: o.cid };
      openStageModal(row.id, o.stage, o.onDone, { people: people, jobId: o.jobId, jobTitle: o.jobTitle });
      if (o.reload) { try { o.reload(); } catch (_) {} }
    }).catch(function(e){ showToast('Failed: '+((e && e.message) || 'could not add them to the job'),'error'); });
  };

  // "Anna Lee, Bo Chen and 2 more" — escaped, never longer than `max` names.
  function nameList(names, max){
    var list = (names || []).filter(Boolean).map(esc), m = max || 3;
    if (!list.length) return '';
    if (list.length <= m) return list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    return list.slice(0, m).join(', ') + ' and ' + (list.length - m) + ' more';
  }
  // One person's name / stage / cid: the caller's own record first (the
  // Candidates page has no submissions in STATE.bd), then what the page holds.
  function personFor(id, people){
    var subs = (STATE.bd && STATE.bd.submissions) || [];
    var p = (people && people[id]) || {};
    var s = subs.find(function(x){ return x.id === id; }) || {};
    return {
      name: p.name || (s.candidate && s.candidate.full_name) || '',
      stage: normalizeStage(p.stage || s.stage || ''),
      sub_stage: (p.sub_stage != null ? p.sub_stage : s.sub_stage) || null,
      cid: p.cid || s.candidate_id || (s.candidate && s.candidate.id) || ''
    };
  }

  // openStageModal(idOrIds, newStage, onDone, opts)
  //   idOrIds — one submission id or an array (a group move)
  //   onDone  — called with (updatedSubmissions, info) after save; info is
  //             { moved:[ids], refused:[{id,reason}], stage, movedCids:[…] }
  //   opts    — optional, all for a group move started from a list of people:
  //     people   { submissionId: {name, stage, sub_stage, cid} }
  //     jobId / jobTitle   the job they are all on
  //     ticked   how many people were ticked in all (>= ids.length)
  //     missing  [{cid,name}] ticked people with no stage on this job — left
  //              out, said plainly, with a button to add them properly
  //     missingKind  'legacy' (added before stages were recorded) | 'absent'
  //     afterFix function returning a Promise — reload and re-open after the add
  window.openStageModal = function (idOrIds, newStage, onDone, opts) {
    var ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    opts = opts || {};
    var missing = opts.missing || [];
    if (!newStage || (!ids.length && !missing.length)) return;
    var subs = (STATE.bd && STATE.bd.submissions) || [];
    var people = opts.people || {};
    var ticked = Math.max(opts.ticked || 0, ids.length + missing.length);
    // A group is more than one person ticked, even if only one can be moved.
    var group = ids.length > 1 || ticked > 1;

    var lockedIds = [];
    if (recruiterScoped()) {
      if (RECRUITER_STAGES.indexOf(newStage) < 0) {
        showToast('You can move candidates up to "Submitted to BDM" — the BD team owns the stages after that','error'); render(); return;
      }
      // Somebody already with the BD team: for one person that ends the move; in
      // a group the server refuses just those rows and moves the rest, so it is
      // said here and the person is still sent (the server's sentence is the
      // one that lands in the result).
      lockedIds = ids.filter(function(id){
        var st = personFor(id, people).stage;
        return st && RECRUITER_STAGES.indexOf(st) < 0;
      });
      if (ids.length && lockedIds.length === ids.length) {
        showToast('That candidate is with the BD team now — only a BD Manager can change this stage','error'); render(); return;
      }
      if (newStage === TO_BDM) {
        if (group) { showToast('Submit candidates to the BD Manager one at a time — each needs its own submission details','error'); render(); return; }
        var who1 = personFor(ids[0], people);
        openSubmitToBDMModal(ids[0], onDone, { candidateId: who1.cid, name: who1.name }); return;
      }
    }
    var mv = STATE._stageMove = { ids: ids, stage: newStage, onDone: onDone || null, group: group, people: people,
      ticked: ticked, missing: missing, missingKind: opts.missingKind || 'legacy',
      jobId: opts.jobId || '', jobTitle: opts.jobTitle || '', afterFix: opts.afterFix || null,
      locked: lockedIds, busy: false, result: null };
    // Nobody ticked can be moved yet — the only thing to offer is the add.
    if (!ids.length) { STATE.modal = fixFirstHtml(mv); render(); return; }

    var names = ids.map(function(id){ return personFor(id, people).name; }).filter(Boolean);
    var subStages = SUB_STAGES[newStage] || [];
    var showInterview = isInterviewStage(newStage);
    // Prefill the interview form from the current submission (single move only).
    var ivSub = (ids.length===1 && !group) ? (subs.find(function(x){return x.id===ids[0];})||{}) : {};
    var ivType0 = ivSub.interview_type || 'virtual';
    var ivAt0 = toLocalInput(ivSub.interview_at);
    var ivPlatform0 = ivSub.interview_platform || 'Microsoft Teams';
    var ivLink0 = ivSub.interview_link || ivSub.interview_location || '';
    var ivAddr0 = ivSub.interview_address || (ivSub.interview_type==='in_person'?ivSub.interview_location:'') || '';
    var ivPeople0 = Array.isArray(ivSub.interviewers) ? ivSub.interviewers.join(', ') : '';

    // Confirmation line: show exactly what's changing — [current] → [target] —
    // so a stage move never happens without the user seeing where it goes.
    // For a group it is the one stage they share, or "Various stages".
    var curStages = ids.map(function(id){ return personFor(id, people).stage; })
      .filter(function(x, i, a){ return x && a.indexOf(x) === i; });
    var curStage = curStages.length === 1 ? curStages[0] : (curStages.length > 1 ? 'Various stages' : '');
    var arrow = '<span style="color:var(--text3)">'+(curStage?esc(curStage):'—')+'</span>'+
      ' <span style="color:var(--text3)">→</span> '+
      '<span style="font-weight:700;color:'+(STAGE_COLORS[newStage]||'var(--text)')+'">'+esc(newStage)+'</span>';

    STATE.modal =
      '<div class="modal modal-w480" onclick="event.stopPropagation()">'+
        '<div class="stg-hd">'+
          '<div style="font-weight:700;font-size:15px">'+
            (group ? 'Move '+ids.length+' candidate'+(ids.length===1?'':'s') : esc(names[0]||'Candidate'))+
          '</div>'+
          (group && names.length ? '<div class="stg-who">'+nameList(names, 4)+'</div>' : '')+
          (mv.jobTitle ? '<div class="stg-job">on '+esc(mv.jobTitle)+'</div>' : '')+
          '<div style="font-size:13px;margin-top:3px">'+arrow+'</div>'+
        '</div>'+
        '<div class="stg-bd">'+
          leftOutHtml(mv)+
          (subStages.length?
            '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Sub-stage</label>'+
            '<select id="stg-sub" class="sel"><option value="">— none —</option>'+
              subStages.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('')+
            '</select></div>':'')+
          (showInterview?
            '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">'+
              '<div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:8px">INTERVIEW DETAILS</div>'+
              '<div class="gc2" style="gap:10px">'+
                '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Date &amp; time</label>'+
                  '<input id="stg-iv-at" type="datetime-local" class="sel" value="'+esc(ivAt0)+'"></div>'+
                '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Time zone</label>'+ivZoneSelect()+'</div>'+
                '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Format</label>'+
                  '<select id="stg-iv-type" class="sel" onchange="stgIvTypeToggle()">'+
                    ['in_person|In person','virtual|Virtual','phone|Phone'].map(function(o){ var kv=o.split('|'); return '<option value="'+kv[0]+'"'+(ivType0===kv[0]?' selected':'')+'>'+kv[1]+'</option>'; }).join('')+
                  '</select></div>'+
              '</div>'+
              '<div id="stg-iv-virtual" class="gc2" style="display:'+(ivType0==='virtual'?'grid':'none')+';gap:10px;margin-top:10px">'+
                '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Platform</label>'+
                  '<select id="stg-iv-platform" class="sel">'+
                    ['Microsoft Teams','Google Meet','Zoom','Other'].map(function(p){ return '<option'+(ivPlatform0===p?' selected':'')+'>'+esc(p)+'</option>'; }).join('')+
                  '</select></div>'+
                '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Join link / meeting ID</label>'+
                  '<input id="stg-iv-link" class="sel" placeholder="https://… or meeting ID" value="'+esc(ivType0==='virtual'?ivLink0:'')+'"></div>'+
                (ids.length===1 && !group?'<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
                  '<button type="button" class="btn btn-sm btn-outline" onclick="stgGenTeams(\''+ids[0]+'\')">📅 Generate Teams meeting link</button>'+
                  '<span style="font-size:11px;color:var(--text3)">Creates a Microsoft Teams meeting &amp; fills the link above.</span>'+
                '</div>':'')+
              '</div>'+
              '<div id="stg-iv-inperson" style="display:'+(ivType0==='in_person'?'block':'none')+';margin-top:10px">'+
                '<label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Office address</label>'+
                '<input id="stg-iv-address" class="sel" placeholder="Street, suite, city…" value="'+esc(ivType0==='in_person'?ivAddr0:'')+'"></div>'+
              '<div id="stg-iv-phone" style="display:'+(ivType0==='phone'?'block':'none')+';margin-top:10px">'+
                '<label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Phone number</label>'+
                '<input id="stg-iv-phone-num" class="sel" placeholder="+1 …" value="'+esc(ivType0==='phone'?ivLink0:'')+'"></div>'+
              '<div style="margin-top:10px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Interviewer name(s) — up to 3</label>'+
                '<input id="stg-iv-people" class="sel" placeholder="e.g. Jane Smith, Raj Patel" value="'+esc(ivPeople0)+'"></div>'+
              '<div style="margin-top:11px;font-size:11.5px;color:var(--text2);font-weight:600">Email these details to:</div>'+
              '<div style="display:flex;gap:16px;margin-top:5px">'+
                '<label style="font-size:12.5px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="stg-iv-notify-cand" checked> Candidate</label>'+
                '<label style="font-size:12.5px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="stg-iv-notify-bd"> BD Manager</label>'+
              '</div>'+
              (window.FromPick?'<div style="margin-top:9px">'+FromPick.slot('stg-iv-from')+'</div>':'')+
              '<div style="font-size:11px;color:var(--text3);margin-top:5px">Job title, company, date/time, format, interviewers &amp; the job details are added automatically. The candidate is ticked by default — a phone interview is confirmed by email too; untick to skip. Sent (and open-tracked) from your connected mailbox.'+
                (group?' <b>These details go on every person you move, and each one gets their own email.</b>':'')+'</div>'+
            '</div>':'')+
          (newStage === 'Submitted to Client' && !group && !recruiterScoped() ? subEmailHtml('client') : '')+
          // Rejecting is a choice from a fixed list, not free typing (owner, 2026-09-30) —
          // so the reasons can be counted later. "Other" asks for the words.
          (newStage==='Not Accepted'?
            '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--red);display:block;margin-bottom:3px;font-weight:700">Why is '+(group?'this group':'this candidate')+' being rejected? (required)</label>'+
            '<select id="stg-reject-type" class="sel" onchange="var t=document.getElementById(\'stg-reject\');if(t)t.placeholder=(this.value===\'Other\'?\'Type the reason (required)\':\'Anything to add? (optional)\')">'+
              '<option value="">— pick a reason —</option>'+REJECT_REASONS.map(function(r){ return '<option value="'+esc(r)+'">'+esc(r)+'</option>'; }).join('')+
            '</select>'+
            '<textarea id="stg-reject" class="sel" style="min-height:48px;resize:vertical;margin-top:6px" placeholder="Anything to add? (optional)"></textarea></div>':'')+
          '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Note <span style="color:var(--red)">*</span></label>'+
            '<textarea id="stg-note" class="sel" style="min-height:56px;resize:vertical" placeholder="'+(group?'Why are these candidates moving? One note is saved on each person’s history.':'Why is this candidate moving? (call summary, feedback, next step…)')+'"></textarea></div>'+
          '<label style="font-size:12.5px;color:var(--text2);display:flex;align-items:center;gap:7px;cursor:pointer;margin-bottom:8px">'+
            '<input type="checkbox" id="stg-rem" onchange="document.getElementById(\'stg-rem-fields\').style.display=this.checked?\'grid\':\'none\'"> Set a reminder to call / follow up'+(group?' (one for each person)':'')+
          '</label>'+
          '<div id="stg-rem-fields" style="display:none;grid-template-columns:1fr 1fr;gap:10px">'+
            '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Remind on</label>'+
              '<input id="stg-rem-date" type="date" class="sel"></div>'+
            '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Reminder note</label>'+
              '<input id="stg-rem-note" class="sel" placeholder="Call about…"></div>'+
          '</div>'+
          '<div class="stg-err" id="stg-err" role="alert"></div>'+
        '</div>'+
        '<div class="stg-ft">'+
          '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
          '<button class="btn btn-primary" id="stg-go" onclick="stgApply()">Move'+(group?' ('+ids.length+')':'')+'</button>'+
        '</div>'+
      '</div>';
    render();
    if (newStage === 'Submitted to Client' && !group && !recruiterScoped()) subEmailLoad('client', ids[0]);
  };

  // ── The pieces of a group move that are not the form ────────────────────────
  // People ticked who have no stage on the job: said plainly, never skipped
  // silently, with the one button that fixes it.
  //
  // Two readings of "no stage on this job", one screen each:
  //   'legacy' — on the job's own list, so they WERE added, before PACE recorded
  //              a stage for each person (the 15 tagged before Session 31);
  //   'absent' — on the Candidates page, which cannot tell "not on this job" from
  //              "on it with no stage", so it says only what it knows.
  function missingBlock(mv){
    var n = mv.missing.length; if (!n) return '';
    var list = nameList(mv.missing.map(function(m){ return m.name; }), 3);
    var legacy = mv.missingKind !== 'absent';
    var title = n + ' of the ' + mv.ticked + ' you ticked ' + (legacy ? 'can’t be moved yet' : 'have no stage on this job');
    var body = legacy
      ? list + (n === 1 ? ' was' : ' were') + ' added to this job before PACE recorded a stage for each person, so there is nothing to move yet. ' +
        'Adding them to the job again fixes that — they stay at Sourced.'
      : list + (n === 1 ? ' is' : ' are') + ' not on this job with a stage, so they will not be moved. ' +
        'Add them to the job and they start at Sourced.';
    var btn = 'Add ' + (n === 1 ? 'them' : 'these ' + n) + (legacy ? ' to the job again' : ' to this job');
    return '<div class="stg-left">'+
      '<div class="stg-left-t">'+esc(title)+'</div>'+
      '<div class="stg-left-b">'+body+'</div>'+
      '<div class="stg-left-act"><button type="button" class="btn btn-sm btn-outline" id="stg-fix-btn" onclick="stgFixUnlinked()">'+btn+'</button></div>'+
    '</div>';
  }
  // A recruiter's group that includes somebody already with the BD team.
  function lockedBlock(mv){
    var n = (mv.locked || []).length; if (!n) return '';
    var list = nameList(mv.locked.map(function(id){ return personFor(id, mv.people).name; }), 3);
    return '<div class="stg-left">'+
      '<div class="stg-left-t">'+n+' of these '+(n===1?'is':'are')+' with the BD team now</div>'+
      '<div class="stg-left-b">'+(list?list+': ':'')+'only a BD Manager can change their stage, so they will not be moved.</div>'+
    '</div>';
  }
  function leftOutHtml(mv){ return missingBlock(mv) + lockedBlock(mv); }

  // Nobody ticked has a stage yet: the panel is only the explanation and the add.
  function fixFirstHtml(mv){
    var n = mv.missing.length, all = mv.ticked;
    var legacy = mv.missingKind !== 'absent';
    var list = nameList(mv.missing.map(function(m){ return m.name; }), 4);
    var who = n === all ? (all === 1 ? 'The person you ticked' : 'All ' + all + ' you ticked') : n + ' of the ' + all + ' you ticked';
    var what = legacy
      ? (n === 1 ? 'was' : 'were') + ' added to this job before PACE recorded a stage for each person'
      : (n === 1 ? 'has' : 'have') + ' no stage on this job yet';
    return '<div class="modal modal-w480" onclick="event.stopPropagation()">'+
      '<div class="stg-hd">'+
        '<div style="font-weight:700;font-size:15px">These people need one more step</div>'+
        (mv.jobTitle ? '<div class="stg-job">on '+esc(mv.jobTitle)+'</div>' : '')+
      '</div>'+
      '<div class="stg-bd">'+
        '<p class="stg-p">'+who+' '+what+(list ? ': '+list : '')+'. Until that is fixed there is nothing to move.</p>'+
        '<p class="stg-p">Adding them to the job again fixes it. '+(legacy ? 'Nothing else about them changes — they stay at Sourced — and then' : 'They start at Sourced, and then')+
          ' you can move them to '+esc(mv.stage)+'.</p>'+
        '<div class="stg-err" id="stg-err" role="alert"></div>'+
      '</div>'+
      '<div class="stg-ft">'+
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-primary" id="stg-fix-btn" onclick="stgFixUnlinked()">Add them and continue</button>'+
      '</div>'+
    '</div>';
  }
  function stgSetError(msg){
    var el = document.getElementById('stg-err'); if (el) el.textContent = msg || '';
  }
  // Add the left-out people to the job properly, reload, and open the move again
  // with everyone in it.
  window.stgFixUnlinked = function(){
    var mv = STATE._stageMove;
    if (!mv || mv.busy || !mv.missing.length || !mv.jobId) return;
    mv.busy = true; stgSetError('');
    var btn = document.getElementById('stg-fix-btn');
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    window.stageFinishAdding(mv.jobId, mv.missing.map(function(m){ return m.cid; })).then(function(){
      mv.busy = false;
      if (mv.afterFix) return mv.afterFix();
      closeModal();
    }).catch(function(e){
      mv.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      stgSetError((e && e.message) || 'Could not add them to the job. Please try again.');
    });
  };

  window.stgIvTypeToggle = function(){
    var t = (document.getElementById('stg-iv-type')||{}).value;
    var set = function(id,on,disp){ var el=document.getElementById(id); if(el) el.style.display = on ? disp : 'none'; };
    set('stg-iv-virtual', t==='virtual', 'grid');
    set('stg-iv-inperson', t==='in_person', 'block');
    set('stg-iv-phone', t==='phone', 'block');
  };

  // Auto-create a Microsoft Teams meeting and drop the join link into the form.
  window.stgGenTeams = function(subId){
    var at = (document.getElementById('stg-iv-at')||{}).value;
    if(!at){ showToast('Set the interview date & time first','error'); return; }
    showToast('Creating Teams meeting…','info');
    apiPost('/submissions/'+subId+'/create-meeting', { start: at }).then(function(r){
      var el=document.getElementById('stg-iv-link'); if(el && r && r.joinUrl) el.value=r.joinUrl;
      var pf=document.getElementById('stg-iv-platform'); if(pf) pf.value='Microsoft Teams';
      showToast('Teams meeting created — link added','success');
    }).catch(function(e){
      if(/no_connected_mailbox/.test(e.message)) showToast('Connect your Microsoft mailbox first (Email settings)','error');
      else if(/meetings_permission_missing/.test(e.message)) showToast('One-time: reconnect your mailbox to allow Teams meeting creation','error');
      else showToast('Could not create meeting: '+e.message,'error');
    });
  };

  window.stgApply = function () {
    var mv = STATE._stageMove; if (!mv || mv.busy) return;
    var val = function(id){ var el=document.getElementById(id); return el?el.value:''; };
    var remOn = (document.getElementById('stg-rem')||{}).checked;
    var notifyCand = false, notifyBd = false;
    // Notes are required on every stage change (product rule) — capture the
    // "why" behind each move so the candidate's history reads as a story.
    var note = val('stg-note').trim();
    if (!note) { showToast('Please add a note describing this stage change','error'); var nEl=document.getElementById('stg-note'); if(nEl)nEl.focus(); return; }
    var payload = { stage: mv.stage, sub_stage: val('stg-sub') || undefined, note: note };
    if (mv.stage === 'Not Accepted') {
      var rt = val('stg-reject-type'), rr = val('stg-reject').trim();
      if (!rt) { showToast('Please pick why they are being rejected','error'); return; }
      if (rt === 'Other' && !rr) { showToast('Please type the reason','error'); var rEl=document.getElementById('stg-reject'); if(rEl)rEl.focus(); return; }
      payload.rejection_reason = rt + (rr ? ': ' + rr : '');
    }
    if (document.getElementById('stg-iv-at')) {
      // The wall time is in the zone picked, not the browser's: send the real instant, and keep the
      // zone for the invite email so it can say which clock the time is on (R-095).
      mv.ivTz = val('stg-iv-tz') || ivMyZone();
      payload.interview_at = window.ivZonedToInstant(val('stg-iv-at'), mv.ivTz) || undefined;
      var ivType = val('stg-iv-type') || undefined;
      payload.interview_type = ivType;
      var loc = '';
      if (ivType === 'virtual') {
        payload.interview_platform = val('stg-iv-platform') || undefined;
        payload.interview_link = val('stg-iv-link') || undefined;
        loc = val('stg-iv-link');
      } else if (ivType === 'in_person') {
        payload.interview_address = val('stg-iv-address') || undefined;
        loc = val('stg-iv-address');
      } else if (ivType === 'phone') {
        payload.interview_link = val('stg-iv-phone-num') || undefined;
        loc = val('stg-iv-phone-num');
      }
      payload.interview_location = loc || undefined;   // keep the legacy field for the board chip
      var people = (val('stg-iv-people')||'').split(',').map(function(x){ return x.trim(); }).filter(Boolean).slice(0,3);
      payload.interviewers = people.length ? people : undefined;
      notifyCand = !!(document.getElementById('stg-iv-notify-cand')||{}).checked;
      notifyBd = !!(document.getElementById('stg-iv-notify-bd')||{}).checked;
      mv.fromId = (window.FromPick && FromPick.value('stg-iv-from')) || '';   // read now: the window is replaced before the invites go
    }
    if (remOn && val('stg-rem-date')) { payload.reminder_date = val('stg-rem-date'); payload.reminder_note = val('stg-rem-note') || undefined; }

    // More than one person: ONE request, and a per-person answer (below).
    if (mv.group) { stgApplyGroup(mv, payload, notifyCand, notifyBd); return; }

    // The submission email (R-092) is read now, while the window is still on screen, and sent
    // only once the move has been saved.
    if (mv.stage === 'Submitted to Client') {
      mv.subEmail = window.subEmailRead('client');
      if (mv.subEmail && mv.subEmail.error) { showToast(mv.subEmail.error,'error'); mv.subEmail = null; return; }
    }

    var updated = [], failed = 0;
    var finish = function(){
      closeModal();
      if (failed) showToast('Moved '+updated.length+', failed '+failed,'error');
      else showToast('Moved to "'+mv.stage+'"'+(updated.length>1?' ('+updated.length+')':''),'success');
      // patch local state for whichever grid is open
      if (STATE.bd && STATE.bd.submissions) {
        STATE.bd.submissions = STATE.bd.submissions.map(function(s){
          var u = updated.find(function(x){ return x.id===s.id; }); return u || s;
        });
      }
      // If the scheduler opted to email the interview details, send them now
      // (the stage PATCH has already stored the details on the submission).
      var recips = [];
      if (notifyCand) recips.push('candidate');
      if (notifyBd) recips.push('bd_manager');
      if (recips.length) {
        updated.forEach(function(s){
          apiPost('/submissions/'+s.id+'/interview-invite', { recipients: recips, mailbox_id: mv.fromId || undefined, interview_tz: mv.ivTz || undefined })
            .then(function(r){ if (r && r.sent) showToast(r.sent+' interview invite'+(r.sent>1?'s':'')+' sent','success'); })
            .catch(function(e){
              if (/no_connected_mailbox/.test(e.message)) showToast('Interview saved — connect a mailbox to email the invite','error');
              else showToast('Interview saved; invite email failed: '+e.message,'error');
            });
        });
      }
      if (mv.subEmail && updated[0] && !failed) subEmailSend(updated[0].id, mv.subEmail);
      if (mv.onDone) mv.onDone(updated, movedInfo(mv, updated.map(function(s){ return s.id; }), []));
      STATE._stageMove = null;
      render();
    };
    Promise.all(mv.ids.map(function(id){
      return apiPatch('/submissions/'+id+'/stage', payload)
        .then(function(s){ updated.push(s); })
        .catch(function(){ failed++; });
    })).then(finish);
  };

  // What a page's onDone receives as its second argument, for one move or many.
  function movedInfo(mv, moved, refused){
    return { moved: moved, refused: refused, stage: mv.stage,
      movedCids: moved.map(function(id){ return personFor(id, mv.people).cid; }).filter(Boolean) };
  }

  // ── A GROUP MOVE: one request, one answer per person ─────────────────────────
  // POST /submissions/bulk-stage → { moved:[ids], refused:[{id, reason}], stage }.
  // A refused person never spoils the rest and is never dropped: the panel that
  // replaces the form names everyone, and gives every refusal the server's own
  // sentence. A whole-request refusal (a 4xx {error}) stays on the form, so the
  // person can change what they asked for.
  function stgApplyGroup(mv, payload, notifyCand, notifyBd){
    mv.busy = true; stgSetError('');
    var go = document.getElementById('stg-go');
    if (go) { go.disabled = true; go.textContent = 'Moving…'; }
    var body = Object.assign({ ids: mv.ids.slice() }, payload);
    apiPost('/submissions/bulk-stage', body).then(function(r){
      mv.busy = false;
      var moved = (r && r.moved) || [], refused = (r && r.refused) || [];
      var stage = (r && r.stage) || mv.stage;
      // The local copy of each moved person, so the list behind the panel is
      // already right while it is open.
      var patch = { stage: stage, sub_stage: payload.sub_stage || null };
      ['interview_at','interview_type','interview_platform','interview_link','interview_address','interview_location','interviewers']
        .forEach(function(k){ if (payload[k] !== undefined) patch[k] = payload[k]; });
      var updated = moved.map(function(id){ return Object.assign({ id: id }, patch); });
      if (STATE.bd && STATE.bd.submissions) {
        STATE.bd.submissions = STATE.bd.submissions.map(function(s){
          var u = updated.find(function(x){ return x.id === s.id; });
          return u ? Object.assign({}, s, u) : s;
        });
      }
      mv.result = { moved: moved, refused: refused, stage: stage };
      STATE.modal = resultHtml(mv); render();
      if (mv.onDone) mv.onDone(updated, movedInfo(mv, moved, refused));
      var recips = [];
      if (notifyCand) recips.push('candidate');
      if (notifyBd) recips.push('bd_manager');
      if (recips.length && moved.length) sendInvites(mv, moved, recips);
    }).catch(function(e){
      mv.busy = false;
      if (go) { go.disabled = false; go.textContent = 'Move ('+mv.ids.length+')'; }
      stgSetError((e && e.message) || 'Could not move them. Nothing was changed — please try again.');
    });
  }

  // Interview details, emailed one person at a time (an email per person, so one
  // at a time — never a burst through one mailbox). The panel shows how far it
  // has got; a finished run is also said in a toast, because the panel may have
  // been closed by then.
  function sendInvites(mv, ids, recips){
    mv.invites = { total: ids.length, done: 0, sent: 0, failed: 0, err: '', finished: false };
    stgRefreshResult(mv);
    var i = 0;
    (function next(){
      if (i >= ids.length) {
        mv.invites.finished = true; stgRefreshResult(mv);
        var iv = mv.invites;
        showToast(iv.failed ? (iv.sent+' interview invite'+(iv.sent===1?'':'s')+' sent, '+iv.failed+' could not be sent')
                            : (iv.sent+' interview invite'+(iv.sent===1?'':'s')+' sent'), iv.failed ? 'error' : 'success');
        return;
      }
      var id = ids[i++];
      apiPost('/submissions/'+id+'/interview-invite', { recipients: recips, mailbox_id: mv.fromId || undefined, interview_tz: mv.ivTz || undefined })
        .then(function(r){ mv.invites.sent += (r && r.sent) ? r.sent : 0; })
        .catch(function(e){
          mv.invites.failed++;
          if (!mv.invites.err) mv.invites.err = /no_connected_mailbox/.test((e && e.message) || '') ? 'Connect a mailbox to email the invites.' : ((e && e.message) || '');
        })
        .then(function(){ mv.invites.done++; stgRefreshResult(mv); next(); });
    })();
  }
  // Redraw the result panel only if it is still the thing on screen.
  function stgRefreshResult(mv){
    if (!mv.result || !STATE.modal || String(STATE.modal).indexOf('data-stg-result') < 0) return;
    STATE.modal = resultHtml(mv); render();
  }

  function namesOf(mv, ids){ return ids.map(function(id){ return personFor(id, mv.people).name || 'Candidate'; }); }
  // The panel after a group move. Everyone ticked is accounted for: moved,
  // refused (with the server's reason), or never sent (no stage on the job yet).
  function resultHtml(mv){
    var r = mv.result, moved = r.moved, refused = r.refused;
    var missing = mv.missing || [];
    var total = Math.max(mv.ticked || 0, moved.length + refused.length + missing.length);
    var all = moved.length === total;
    var title = all ? 'Moved all '+total+' to '+mv.stage
      : (moved.length ? 'Moved '+moved.length+' of '+total+' to '+mv.stage : 'Nobody was moved');
    var chip = all ? UI.pill('Done', 'ok') : UI.pill(moved.length ? 'Partly moved' : 'Not moved', 'warn');
    var movedNames = namesOf(mv, moved);
    var shown = movedNames.slice(0, 12).map(esc).join(', ') + (movedNames.length > 12 ? ' and '+(movedNames.length-12)+' more' : '');
    var iv = mv.invites, ivLine = '';
    if (iv) {
      ivLine = '<div class="stg-res-inv">'+
        (!iv.finished ? 'Emailing interview details… '+iv.done+' of '+iv.total
          : (iv.failed ? esc(iv.sent+' emailed, '+iv.failed+' could not be sent'+(iv.err?': '+iv.err:'.'))
                       : 'Interview details emailed to '+iv.sent+'.'))+
      '</div>';
    }
    return '<div class="modal modal-w480" data-stg-result="1" onclick="event.stopPropagation()">'+
      '<div class="stg-hd">'+
        '<div class="stg-res-t">'+esc(title)+' '+chip+'</div>'+
        (all ? '' : '<div class="stg-job">The rest are listed below with the reason.</div>')+
      '</div>'+
      '<div class="stg-bd stg-res">'+
        (moved.length ? '<div class="stg-res-h">Moved ('+moved.length+')</div><div class="stg-res-names">'+shown+'</div>' : '')+
        (refused.length
          ? '<div class="stg-res-h">Not moved ('+refused.length+')</div><div class="stg-res-list">'+
              refused.map(function(x){
                return '<div class="stg-res-row"><div class="stg-res-nm">'+esc(personFor(x.id, mv.people).name || 'Candidate')+'</div>'+
                  '<div class="stg-res-why">'+esc(x.reason || 'Not moved.')+'</div></div>';
              }).join('')+'</div>'
          : '')+
        (missing.length
          ? '<div class="stg-res-h">Not included ('+missing.length+')</div><div class="stg-res-list">'+
              missing.map(function(m){
                return '<div class="stg-res-row"><div class="stg-res-nm">'+esc(m.name || 'Candidate')+'</div>'+
                  '<div class="stg-res-why">No stage on this job yet — add them to the job first.</div></div>';
              }).join('')+'</div>'
          : '')+
        ivLine+
      '</div>'+
      '<div class="stg-ft"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>'+
    '</div>';
  }

  // ═══ SUBMIT TO BD MANAGER — the hand-off form ═══════════════════════════
  // Mirrors the client-facing submission template: applicant details,
  // relocation, availability, the (important) submission comment, and the
  // resume. On submit the stage moves to "Submitted to BDM" with the details
  // stored on the submission for the BDM to forward.
  // `hint` ({candidateId, name}) is for a move started from a list that does not
  // hold the submissions (the Candidates page): the person is named by the caller.
  window.openSubmitToBDMModal = function (subId, onDone, hint) {
    var subs = (STATE.bd && STATE.bd.submissions) || [];
    var sub = subs.find(function(x){ return x.id===subId; }) || {};
    var candId = (sub.candidate && sub.candidate.id) || sub.candidate_id || (hint && hint.candidateId);
    if (!candId) { showToast('Candidate not found on this submission','error'); return; }

    apiGet('/candidates/'+candId).then(function(c){
      c = c || {};
      var names = String(c.full_name||'').trim().split(/\s+/);
      var first = c.first_name || names[0] || '';
      var last  = c.last_name || names.slice(1).join(' ') || '';
      var locFallback = [c.city,c.state].filter(Boolean).join(', ');

      function fld(id,label,valv,ph,req){
        return '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">'+label+(req?' <span style="color:var(--red)">*</span>':'')+'</label>'+
          '<input id="'+id+'" class="sel" value="'+esc(valv||'')+'" placeholder="'+esc(ph||'')+'"></div>';
      }

      STATE._sbdm = { subId: subId, candId: candId, onDone: onDone||null, file: null };
      STATE.modal =
        '<div class="modal" style="width:600px;max-width:94vw" onclick="event.stopPropagation()">'+
          '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
            '<div style="font-weight:700;font-size:15px">Submit to BD Manager</div>'+
            '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+esc(c.full_name||'Candidate')+' — these details go to the BDM with the profile</div>'+
          '</div>'+
          '<div style="padding:16px 20px;max-height:62vh;overflow:auto">'+
            '<div class="gc2" style="gap:10px;margin-bottom:10px">'+
              fld('sbdm-first','Applicant First Name',first,'',true)+
              fld('sbdm-last','Applicant Last Name',last,'',true)+
              fld('sbdm-email','Applicant Email Address',c.email,'',true)+
              fld('sbdm-mobile','Mobile Number',c.phone,'')+
              fld('sbdm-home','Home Phone',c.alt_phone,'N/A')+
              fld('sbdm-auth','Work Authorization',c.work_authorization,'N/A')+
              fld('sbdm-loc','Current Location',c.current_location||locFallback,'City, State')+
              fld('sbdm-reloc','Relocation','','Willing to relocate to…')+
              fld('sbdm-avail','Availability',c.availability,'asap / 2 weeks…')+
            '</div>'+
            '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--red);display:block;margin-bottom:3px;font-weight:700">Submission Comment (important) <span>*</span></label>'+
              '<textarea id="sbdm-comment" class="sel" style="min-height:64px;resize:vertical" placeholder="Why this candidate fits — rate, highlights, anything the BDM should know"></textarea></div>'+
            '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px">'+
              '<div style="font-size:12px;font-weight:600;margin-bottom:6px">Resume</div>'+
              (c.resume_filename?'<div style="font-size:12px;color:var(--green);margin-bottom:6px">✓ On file: '+esc(c.resume_filename)+'</div>'
                :'<div style="font-size:12px;color:var(--amber);margin-bottom:6px">No resume on file — attach one below.</div>')+
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
                '<label class="btn btn-sm btn-outline" style="cursor:pointer;margin:0">Attach file<input type="file" accept=".pdf,.doc,.docx,.txt,.rtf" style="display:none" onchange="sbdmPickFile(this)"></label>'+
                '<span id="sbdm-file-name" style="font-size:12px;color:var(--text3)"></span>'+
                '<button class="btn btn-sm btn-outline" onclick="sbdmFormat()" title="Convert the attached resume to the company letterhead format">✨ Format resume</button>'+
              '</div>'+
              '<div id="sbdm-fmt-status" style="font-size:11.5px;color:var(--green);margin-top:7px"></div>'+
            '</div>'+
          '</div>'+
          '<div style="padding:0 20px">'+subEmailHtml('bdm')+'</div>'+
          '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
            '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
            '<button class="btn btn-primary" onclick="sbdmSubmit()">Submit to BD Manager</button>'+
          '</div>'+
        '</div>';
      render();
      subEmailLoad('bdm', subId);
    }).catch(function(e){ showToast('Could not load candidate: '+e.message,'error'); });
  };

  window.sbdmPickFile = function(input){
    var st = STATE._sbdm; if (!st || !input.files || !input.files[0]) return;
    st.file = input.files[0];
    var el = document.getElementById('sbdm-file-name');
    if (el) el.textContent = st.file.name;
  };

  window.sbdmFormat = function(){
    var st = STATE._sbdm;
    if (!st || !st.file) { showToast('Attach a resume file first, then click Format','error'); return; }
    if (!window.atsFormatResumeFile) { showToast('Formatter not loaded','error'); return; }
    // Format → open the preview (with Word/PDF download) AND stash the formatted
    // doc so it's attached to the packet when the recruiter submits.
    window.atsFormatResumeFile(st.file, { onFormatted: function(html, name){
      st.formattedHtml = html; st.formattedName = name;
      var el = document.getElementById('sbdm-fmt-status');
      if (el) el.textContent = '✓ Formatted on the futé letterhead — it will be attached to this submission.';
    }});
  };

  window.sbdmSubmit = function(){
    var st = STATE._sbdm; if (!st) return;
    var val = function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
    var details = {
      first_name: val('sbdm-first'), last_name: val('sbdm-last'),
      email: val('sbdm-email'), mobile: val('sbdm-mobile'),
      home_phone: val('sbdm-home') || 'N/A', work_auth: val('sbdm-auth') || 'N/A',
      current_location: val('sbdm-loc'), relocation: val('sbdm-reloc'),
      availability: val('sbdm-avail'), comment: val('sbdm-comment')
    };
    if (!details.first_name || !details.email) { showToast('First name and email are required','error'); return; }
    if (!details.comment) { showToast('The submission comment is important — please add it','error'); return; }
    var email = window.subEmailRead('bdm');
    if (email && email.error) { showToast(email.error,'error'); return; }

    // Record which resume files ride along with the packet so the BDM's
    // submission view can point straight at them.
    if (st.formattedName) details.formatted_resume = st.formattedName + '_Submission.doc';
    if (st.file) details.original_resume = st.file.name;

    var patchStage = function(uploaded){
      var upIds = (Array.isArray(uploaded) ? uploaded : []).map(function(r){ return r && r.id; }).filter(Boolean);
      if (email && email.attach_doc_ids === undefined && upIds.length) email.attach_doc_ids = upIds;
      apiPatch('/submissions/'+st.subId+'/stage', { stage:'Submitted to BDM', submission_details: details, note: details.comment })
        .then(function(s){
          closeModal();
          showToast('Submitted to the BD Manager','success');
          if (email) subEmailSend(s.id || st.subId, email);
          if (STATE.bd && STATE.bd.submissions) {
            STATE.bd.submissions = STATE.bd.submissions.map(function(x){ return x.id===s.id ? s : x; });
          }
          if (st.onDone) st.onDone([s], { moved: [s.id], refused: [], stage: 'Submitted to BDM', movedCids: st.candId ? [st.candId] : [] });
          STATE._sbdm = null;
          render();
        })
        .catch(function(e){ showToast(e.message||'Could not submit','error'); });
    };

    var uploadDoc = function(filename, contentType, dataUri){
      return apiPost('/candidates/'+st.candId+'/documents',
        { filename:filename, content_type:contentType, doc_type:'resume', data_base64:dataUri });
    };
    var readFile = function(f){ return new Promise(function(res,rej){
      var r=new FileReader(); r.onload=function(){res(String(r.result));}; r.onerror=function(){rej(new Error('Could not read the resume file'));}; r.readAsDataURL(f);
    }); };

    // Attach the resume(s) to the packet BEFORE moving the stage: the original
    // file (raw source) and the formatted futé-letterhead copy when present.
    var uploads = [];
    if (st.file) uploads.push(readFile(st.file).then(function(d){ return uploadDoc(st.file.name, st.file.type||'application/octet-stream', d); }));
    if (st.formattedHtml && window.atsFormattedDocDataUri) {
      var fName = (st.formattedName || details.first_name || 'candidate').replace(/[^A-Za-z0-9 _-]/g,'').trim().replace(/\s+/g,'_') || 'candidate';
      uploads.push(uploadDoc(fName + '_Submission.doc', 'application/msword', window.atsFormattedDocDataUri(st.formattedHtml)));
    }
    if (!uploads.length) { patchStage([]); return; }
    Promise.all(uploads).then(patchStage).catch(function(e){ showToast('Resume upload failed: '+(e.message||e),'error'); });
  };


  // ── EMAIL THE SUBMISSION DETAILS (R-092, D-0066) ───────────────────────────
  // Offered when a candidate is handed to the BD Manager (recruiter window) and when the BD
  // Manager sends them to the client (stage window). The form is read BEFORE the window closes,
  // and the email is sent only AFTER the move has been saved, so a failed move never emails
  // anybody. The words and the attachment rules live on the server (services/submission-email.js).
  window.subEmailNoop = function(){};
  function seIdFor(kind){ return kind === 'client' ? 'the client' : 'the BD Manager'; }
  window.subEmailHtml = function(kind){
    var lbl = 'font-size:11px;color:var(--text2);display:block;margin:9px 0 3px';
    return '<div id="se-box" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin:12px 0">'+
      '<label style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px;cursor:pointer">'+
        '<input type="checkbox" id="se-on" checked onchange="subEmailToggle()"> Email these submission details to '+seIdFor(kind)+'</label>'+
      '<div id="se-body">'+
        '<label style="'+lbl+'">To</label>'+
        '<input id="se-to" class="sel" list="se-sugg" autocomplete="off" placeholder="name@company.com"><datalist id="se-sugg"></datalist>'+
        '<label style="'+lbl+'">Cc <span style="color:var(--text3)">(optional — Enter or comma after each)</span></label>'+
        (window.mbChipField ? mbChipField('se-cc','cc','','subEmailNoop','') : '<input id="se-cc" class="sel">')+
        '<label style="'+lbl+'">A note above the details <span style="color:var(--text3)">(optional)</span></label>'+
        '<textarea id="se-note" class="sel" style="min-height:54px;resize:vertical" placeholder="e.g. Strong fit — available from 1 Nov."></textarea>'+
        '<div id="se-docs" style="margin-top:9px;font-size:12.5px;color:var(--text3)">'+
          (kind === 'client' ? 'Looking for the résumé…' :
            '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;color:var(--text)"><input type="checkbox" id="se-attach" checked> Attach the résumé file(s) from this submission</label>')+
        '</div>'+
        (window.FromPick ? '<div style="margin-top:9px">'+FromPick.slot('se-from')+'</div>' : '')+
        '<div style="font-size:11px;color:var(--text3);margin-top:6px">Sent from your connected mailbox after the move is saved. The candidate’s details and the submission comment are added for you.</div>'+
      '</div></div>';
  };
  window.subEmailToggle = function(){
    var on = (document.getElementById('se-on')||{}).checked, b = document.getElementById('se-body');
    if (b) b.style.display = on ? '' : 'none';
  };
  // Fills the suggestions (and, for the client copy, the résumé list) once the window is on screen.
  window.subEmailLoad = function(kind, subId){
    var tries = 0;
    (function go(){
      if (!document.getElementById('se-to')) { if (tries++ < 40) setTimeout(go, 50); return; }
      apiGet('/submissions/'+encodeURIComponent(subId)+'/submission-email/options?kind='+kind).then(function(r){
        var dl = document.getElementById('se-sugg'), to = document.getElementById('se-to');
        if (dl) dl.innerHTML = (r.suggestions||[]).map(function(s){ return '<option value="'+esc(s.email)+'">'+esc((s.name?s.name+' · ':'')+s.role)+'</option>'; }).join('');
        if (to && !to.value && r.suggestions && r.suggestions[0] && kind === 'bdm') to.value = r.suggestions[0].email;
        var docs = document.getElementById('se-docs');
        if (docs && kind === 'client') {
          var list = r.documents || [];
          docs.innerHTML = list.length
            ? '<div style="color:var(--text);margin-bottom:4px">Attach the résumé:</div>'+list.map(function(d,i){
                return '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;color:var(--text)"><input type="checkbox" class="se-doc" value="'+esc(d.id)+'"'+(i===0?' checked':'')+'> '+esc(d.filename||'résumé')+'</label>'; }).join('')
            : 'No résumé on file for this candidate, so none will be attached.';
        }
      }).catch(function(){
        var docs = document.getElementById('se-docs'); if (docs && kind === 'client') docs.textContent = 'Could not look up the résumé just now.';
      });
    })();
  };
  // The form's values as the request body, or null when "email" is unticked, or {error} to refuse.
  window.subEmailRead = function(kind, uploadedIds){
    if (!document.getElementById('se-on') || !document.getElementById('se-on').checked) return null;
    if (window.mbChipFlush) mbChipFlush();
    var to = ((document.getElementById('se-to')||{}).value||'').trim();
    if (!to) return { error: 'Who should the email go to? Add an address, or untick the email option.' };
    var body = { kind: kind, to: to, cc: ((document.getElementById('se-cc')||{}).value||'').trim(),
      note: ((document.getElementById('se-note')||{}).value||'').trim(),
      mailbox_id: (window.FromPick && FromPick.value('se-from')) || undefined };
    if (kind === 'client') {
      body.attach_doc_ids = Array.prototype.map.call(document.querySelectorAll('.se-doc:checked'), function(x){ return x.value; });
    } else if (!((document.getElementById('se-attach')||{}).checked)) {
      body.attach_doc_ids = [];
    } else if (uploadedIds && uploadedIds.length) {
      body.attach_doc_ids = uploadedIds;       // the files uploaded in this submission; else the server uses the latest résumé
    }
    return body;
  };
  window.subEmailSend = function(subId, body){
    if (!body || body.error) return Promise.resolve(null);
    return apiPost('/submissions/'+encodeURIComponent(subId)+'/submission-email', body).then(function(r){
      showToast('Submission emailed to '+r.to+(r.attached && r.attached.length ? ' with the résumé attached' : ''),'success'); return r;
    }).catch(function(e){
      var m = (e && e.message) || '';
      showToast(/no_connected_mailbox/.test(m) ? 'Moved — connect a mailbox to email the submission' : ('Moved, but the email was not sent: '+m),'error'); return null;
    });
  };

})();
