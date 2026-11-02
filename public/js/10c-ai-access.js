// ===== AI ON / OFF PER PERSON (owner, 2 Nov 2026, D-0195) =====
// "Where can the admin switch the AI enabler for each user … per user based on the payment received or not."
// ON for everyone until the admin turns someone off. OFF: every AI button (marked data-ai="1") is hidden by one CSS rule
// (body.ai-off, ui.css) and a plain line says why. The SERVER is the rule (services/ai-access.js — no AI request is made for
// that person); hiding the buttons only spares them pressing something that would do nothing.
(function () {
  var S = STATE.aiAccess = STATE.aiAccess || { on: true, message: '', admin: null };
  function apply(){
    try { document.body.classList.toggle('ai-off', S.on === false); } catch (_) {}
  }
  function load(){
    if (!STATE.token) return;
    apiGet('/me/ai-access').then(function(r){ S.on = !(r && r.on === false); S.message = (r && r.message) || ''; apply(); if (S.on === false) render(); })
      .catch(function(){ /* unknown = on; the server decides anyway */ });
  }
  // After every sign-in and every reload of the app's data (both end in loadAppData).
  var prev = window.loadAppData;
  if (typeof prev === 'function') {
    window.loadAppData = function(){ var r = prev.apply(this, arguments); load(); return r; };
  }
  window.loadAiAccess = load;
  // The plain line, for screens that offer AI (My Setup, Compose).
  window.aiOffNote = function(){
    return S.on === false ? '<div class="card ai-off-note fs-13">' + htmlEsc(S.message || 'AI is not switched on for your account. Ask your admin.') + '</div>' : '';
  };

  // ── The admin's switch, on a person's page (Admin → people → a person) ──
  window.aiAccessCard = function(userId){
    if (!STATE.user || (STATE.user.roles || [STATE.user.role]).indexOf('admin') < 0) return '';
    if (!S.admin) { S.admin = { loading: true, map: {} }; apiGet('/users/ai-access').then(function(r){ S.admin = { map: (r && r.access) || {} }; render(); }).catch(function(e){ S.admin = { map: {}, error: (e && e.message) || 'Could not load' }; render(); }); }
    var on = S.admin.map[userId] !== false;
    var body = S.admin.loading ? '<div class="fs-12 c-text3">Loading…</div>'
      : S.admin.error ? '<div class="fs-12 c-red">' + htmlEsc(S.admin.error) + '</div>'
      : '<label class="ai-switch fs-13"><input type="checkbox" ' + (on ? 'checked ' : '') + 'onchange="setUserAiAccess(\'' + userId + '\', this.checked)"> AI is <b>' + (on ? 'on' : 'off') + '</b> for this person</label>' +
        '<div class="fs-12 c-text3" style="margin-top:6px">Off: every AI button disappears for them (writing versions, drafting, rewriting, summaries) and PACE makes no AI request for them. Their templates and versions keep sending.</div>';
    return '<div class="card" style="padding:18px;margin-bottom:16px"><div class="fs-12 c-text3" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">AI</div>' + body + '</div>';
  };
  window.setUserAiAccess = function(userId, on){
    apiPut('/users/' + userId + '/ai-access', { on: !!on }).then(function(){
      S.admin.map[userId] = !!on; showToast(on ? 'AI switched on for this person' : 'AI switched off for this person', 'success');
      if (STATE.user && STATE.user.id === userId) { S.on = !!on; apply(); }
      render();
    }).catch(function(e){ showToast('Could not change it: ' + ((e && e.message) || e), 'error'); render(); });
  };
  apply();
})();
