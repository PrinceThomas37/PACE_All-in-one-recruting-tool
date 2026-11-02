// ===== IMPORTS IN PROGRESS + "IMPORT FINISHED" ON THE LEADS TAB (R-343 step 4, owner 2 Nov 2026) =====
// Owner: "does it show a progress bar in the leads tab for RA lead or the user who imports … and then once complete show a
// notification that the import is completed?" — the importer and their own team's RA Lead (the server decides who sees
// which import: GET /imports/recent; admins see the company).
// The line is drawn FROM STATE.imports, so any repaint draws the same thing; the check only patches #imp-banner by id (never a
// render() on a timer). Checked every 4 s while an import is running, every 60 s otherwise, and only while Leads is open.
(function () {
  var S = STATE.imports = STATE.imports || { runs: [], timer: null, notified: {} };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function ago(iso){ var m = Math.round((Date.now() - Date.parse(iso)) / 60000); if (!isFinite(m) || m < 1) return 'just now'; if (m < 60) return m + ' min ago'; var h = Math.round(m / 60); return h + ' h ago'; }
  function who(r){ return STATE.user && r.user_id === STATE.user.id ? 'Your import' : (esc(r.user_name || 'A teammate') + '’s import'); }
  function line(r){
    if (r.status === 'running') {
      var pct = r.total ? Math.round(r.done / r.total * 100) : 0;
      return '<div class="card imp-row imp-running" role="status"><b>' + who(r) + '</b>: ' + r.done + ' of ' + r.total + ' leads saved' +
        '<div class="imp-bar" aria-hidden="true"><div class="imp-fill" style="width:' + pct + '%"></div></div></div>';
    }
    var s = r.summary || {};
    if (r.status === 'failed') return '<div class="card imp-row imp-failed" role="status"><b>' + who(r) + ' stopped</b> after ' + (s.imported || 0) + ' of ' + r.total + ' leads (' + ago(r.finished_at) + '). ' + esc(s.error || '') + ' The leads saved before it stopped are in the list.</div>';
    return '<div class="card imp-row imp-done" role="status"><b>' + who(r) + ' finished</b> ' + ago(r.finished_at) + ': ' + (s.imported != null ? s.imported : r.total) + ' leads, ' + (s.contacts || 0) + ' contacts' +
      (s.invalid_emails ? ', ' + s.invalid_emails + ' with no valid email' : '') + (s.skipped ? ', ' + s.skipped + ' skipped (company in cooldown)' : '') + '.' +
      ' <button type="button" class="btn btn-sm btn-outline" onclick="importDismiss(\'' + esc(r.id) + '\')">Hide</button></div>';
  }
  function hidden(){ try { return JSON.parse(localStorage.getItem('pace_imp_hidden') || '{}'); } catch (_) { return {}; } }
  function inner(){ var h = hidden(); return (S.runs || []).filter(function(r){ return r.status === 'running' || !h[r.id]; }).map(line).join(''); }
  window.importBannerSlot = function(){ ensure(); return '<div id="imp-banner" class="imp-banner">' + inner() + '</div>'; };
  window.importDismiss = function(id){ var h = hidden(); h[id] = 1; try { localStorage.setItem('pace_imp_hidden', JSON.stringify(h)); } catch (_) {} patch(); };
  function patch(){ var el = document.getElementById('imp-banner'); if (el) { var html = inner(); if (el.innerHTML !== html) el.innerHTML = html; } }

  function notify(prev, runs){
    var before = {}; (prev || []).forEach(function(r){ before[r.id] = r.status; });
    runs.forEach(function(r){
      if (r.status === 'running' || S.notified[r.id]) return;
      // Said once: when it finishes while you are looking, or the first time you see it if it finished while you were away.
      S.notified[r.id] = 1;
      if (hidden()[r.id]) return;
      var s = r.summary || {};
      var body = r.status === 'failed' ? (who(r).replace(/<[^>]+>/g, '') + ' stopped after ' + (s.imported || 0) + ' of ' + r.total + ' leads.')
        : (who(r).replace(/<[^>]+>/g, '').replace('&rsquo;', '’') + ' finished: ' + (s.imported != null ? s.imported : r.total) + ' leads, ' + (s.contacts || 0) + ' contacts.');
      if (typeof paceNotify === 'function') paceNotify('Import finished', body, r.status === 'failed' ? 'error' : 'success');
    });
  }
  function check(){
    if (!STATE.token || STATE.page !== 'leads') { stop(); return; }
    apiGet('/imports/recent').then(function(r){
      var prev = S.runs; S.runs = (r && r.runs) || []; notify(prev, S.runs); patch(); schedule();
    }).catch(function(){ schedule(); });
  }
  function schedule(){ clearTimeout(S.timer); var running = (S.runs || []).some(function(r){ return r.status === 'running'; }); S.timer = setTimeout(check, running ? 4000 : 60000); }
  function stop(){ clearTimeout(S.timer); S.timer = null; }
  function ensure(){ if (!S.timer) { S.timer = setTimeout(check, 50); } }
  window.importProgressCheck = check;    // the import window calls it the moment an import starts
})();
