// ===== "FROM" — choose which of MY mailboxes an email leaves from (R-087) =====
// Owner, 29 Sep: "Selection of email ID is not there for client like its
// candidate. For any email that goes out there should be an option to choose
// from email ID."
//
// One small widget for every window that sends. It only ever offers the
// caller's OWN connected mailboxes (GET /me/sending-mailboxes) and the page only
// NAMES an id — the server checks it is really theirs (sendingMailboxFor) and
// refuses anything else as if it did not exist, so choosing here can never send
// as somebody else.
//
//   FromPick.slot(slotId)  html for the row; it fills itself once the list is in
//                          (by DOM id — never a render(), so nothing typed elsewhere
//                          in the window is touched)
//   FromPick.value(slotId) the chosen mailbox id, or '' meaning "the default"
//
// One mailbox is not a choice: it is shown as a plain "From x", and value() is ''.
(function () {
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var S = STATE.sendingMailboxes = STATE.sendingMailboxes || { loaded:false, loading:false, list:[], default_id:null, error:false };
  var waiting = {};   // slotId -> true, filled when the list arrives

  function inner(slotId){
    if (!S.loaded) return '<span class="from-note">Checking which mailboxes you can send from…</span>';
    if (S.error) return '<span class="from-note">Could not load your mailboxes — the email will go from your default one.</span>';
    if (!S.list.length) return '<span class="from-note from-none">No mailbox connected — connect one under Email before sending.</span>';
    if (S.list.length === 1) return '<span class="from-one">From <b>'+esc(S.list[0].email)+'</b></span>';
    var opts = S.list.map(function(m){
      var label = (m.display_name ? m.display_name + ' <' + m.email + '>' : m.email) + (m.platform ? ' · ' + m.platform : '');
      return '<option value="'+esc(m.id)+'"'+(m.id === S.default_id ? ' selected' : '')+'>'+esc(label)+'</option>';
    }).join('');
    return '<label class="from-lbl" for="'+esc(slotId)+'-sel">From</label>'+
      '<select id="'+esc(slotId)+'-sel" class="sel from-sel" aria-label="Send from which mailbox">'+opts+'</select>';
  }
  function fill(slotId){ var el = document.getElementById(slotId); if (el) el.innerHTML = inner(slotId); }

  function load(){
    if (S.loaded || S.loading) return;
    S.loading = true;
    apiGet('/me/sending-mailboxes').then(function(r){
      S.list = (r && r.mailboxes) || []; S.default_id = (r && r.default_id) || null; S.error = false;
    }).catch(function(){ S.error = true; S.list = []; })
      .then(function(){ S.loaded = true; S.loading = false; Object.keys(waiting).forEach(function(id){ fill(id); }); waiting = {}; });
  }

  window.FromPick = {
    slot: function(slotId){
      load();
      if (!S.loaded) waiting[slotId] = true;
      return '<div id="'+esc(slotId)+'" class="from-slot">'+inner(slotId)+'</div>';
    },
    value: function(slotId){
      var sel = document.getElementById(slotId + '-sel');
      // The default is sent as "" so the server keeps applying its own default.
      return sel && sel.value && sel.value !== S.default_id ? sel.value : '';
    },
    // A mailbox connected or removed elsewhere while the app was open.
    refresh: function(){ S.loaded = false; S.loading = false; }
  };
})();
