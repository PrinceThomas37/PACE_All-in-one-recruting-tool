// ── Shared POC / contact block ───────────────────────────────────────────────
// The repeating "who do we talk to at this client" rows: name, designation,
// email, phone, LinkedIn, with a duplicate-email check and "+ add another".
//
// WHY IT IS SHARED. `15-ra-entry-form.js` has had exactly this block since the
// RA lead form was built. When the BD "+ New Job" form started collecting
// client details (Session 26) the obvious move was to write a second one — and
// two live paths to one outcome is the bug the owner caught themselves with the
// two candidate-email workflows (D-0012). So this is the one implementation,
// and the RA form's copy is the thing to retire into it.
//
// STATE LIVES WITH THE CALLER, not here. A form registers an accessor; this
// module only renders and mutates through it. That is what lets two forms with
// completely different state shapes share one block.
//
// Usage:
//   pocRegister('bd', { get: function(){ return STATE.bd.form.contacts; },
//                       changed: function(){ /* optional */ } });
//   ... pocBlockHTML('bd') ...
//
// Field names are the API's own (`first_name`, not `firstName`) so nothing has
// to be translated between the box and the request body — a translation layer
// is somewhere for a field to go missing.

var _pocReg = {};

window.pocRegister = function (name, accessor) { _pocReg[name] = accessor; };

window.pocNewContact = function () {
  return { first_name: '', last_name: '', designation: '', email: '', phone: '', linkedin: '',
           _emailState: '', _emailDup: null };
};

function _pocList(name) {
  var a = _pocReg[name];
  var list = a && a.get ? (a.get() || []) : [];
  if (!list.length) list.push(window.pocNewContact());
  return list;
}
function _pocChanged(name) { var a = _pocReg[name]; if (a && a.changed) a.changed(); }

// One row. `.g2` is the app's own grid class, so the pairs collapse to a single
// column on a phone instead of being squeezed — an inline grid could not.
function _pocRow(name, c, idx, total) {
  var note = _pocNoteHTML(c);
  var set = function (field) {
    return 'oninput="pocSet(\'' + name + '\',' + idx + ',\'' + field + '\',this.value)"';
  };
  return '<div class="poc-row" style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r2);padding:13px;margin-bottom:10px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px">' +
      '<div style="font-weight:600;font-size:11.5px;color:var(--text2)">Contact ' + (idx + 1) +
        (idx === 0 ? ' <span style="font-size:10px;color:var(--text3);border:1px solid var(--border2);padding:1px 6px;border-radius:5px;margin-left:5px">PRIMARY</span>' : '') +
      '</div>' +
      (total > 1 ? '<button type="button" onclick="pocRemove(\'' + name + '\',' + idx + ')" style="background:transparent;border:0;color:var(--text3);font-size:12px;cursor:pointer">Remove</button>' : '') +
    '</div>' +
    '<div class="g2" style="margin-bottom:8px">' +
      '<input class="sel" placeholder="First name *" value="' + htmlEsc(c.first_name || '') + '" ' + set('first_name') + '/>' +
      '<input class="sel" placeholder="Last name" value="' + htmlEsc(c.last_name || '') + '" ' + set('last_name') + '/>' +
    '</div>' +
    '<div class="g2" style="margin-bottom:8px">' +
      '<input class="sel" placeholder="Job title / designation" value="' + htmlEsc(c.designation || '') + '" ' + set('designation') + '/>' +
      '<div>' +
        '<input class="sel" placeholder="Email address *" value="' + htmlEsc(c.email || '') + '" ' + set('email') +
          ' onblur="pocCheckEmail(\'' + name + '\',' + idx + ',this.value)"/>' +
        '<div class="poc-email-note" data-idx="' + idx + '">' + note + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="g2">' +
      '<input class="sel" placeholder="Phone (optional)" value="' + htmlEsc(c.phone || '') + '" ' + set('phone') + '/>' +
      '<input class="sel" placeholder="LinkedIn profile (optional)" value="' + htmlEsc(c.linkedin || '') + '" ' + set('linkedin') + '/>' +
    '</div>' +
  '</div>';
}

window.pocBlockHTML = function (name) {
  var list = _pocList(name);
  return '<div id="poc-' + name + '">' +
    list.map(function (c, i) { return _pocRow(name, c, i, list.length); }).join('') +
    '<button type="button" onclick="pocAdd(\'' + name + '\')" style="background:transparent;border:1.5px dashed var(--border2);color:var(--text3);padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer;width:100%">+ Add another contact</button>' +
  '</div>';
};

// Redraw only this block. Re-rendering the whole screen on a keystroke is what
// takes the caret out of the box the person is typing in.
function _pocPatch(name) {
  var el = document.getElementById('poc-' + name);
  if (el) el.outerHTML = window.pocBlockHTML(name);
}

// Typing NEVER redraws — it only records. The row's html already shows what was
// typed, so rewriting it would be both pointless and destructive.
window.pocSet = function (name, idx, field, val) {
  var list = _pocList(name); if (!list[idx]) return;
  list[idx][field] = val;
  if (field === 'email') { list[idx]._emailState = ''; list[idx]._emailDup = null; }
  _pocChanged(name);
};

window.pocAdd = function (name) {
  _pocList(name).push(window.pocNewContact());
  _pocPatch(name); _pocChanged(name);
};

window.pocRemove = function (name, idx) {
  var list = _pocList(name);
  if (list.length <= 1) return;           // the last row is the required one
  list.splice(idx, 1);
  _pocPatch(name); _pocChanged(name);
};

// The note under one email box. Rendered on its own because the answer arrives
// LATE and from the network.
function _pocNoteHTML(c) {
  if (c._emailDup && c._emailDup.duplicate) {
    var d = c._emailDup;
    return '<div style="margin-top:4px;padding:6px 10px;background:var(--red-l);border-radius:var(--r);font-size:11.5px;color:var(--red)">' +
      'Already in PACE — added ' + d.days_ago + ' day' + (d.days_ago !== 1 ? 's' : '') + ' ago' +
      (d.added_by ? ' by <strong>' + htmlEsc(d.added_by) + '</strong>' : '') +
      (d.company ? ' at <strong>' + htmlEsc(d.company) + '</strong>' : '') + '.</div>';
  }
  if (c._emailState === 'ok') return '<div style="margin-top:3px;font-size:11px;color:var(--text3)">Not seen before.</div>';
  return '';
}

// "Have we met this person already?" — the same check the RA form runs. It is
// INFORMATION, never a block: the same POC legitimately appears on a second req
// from the same client.
//
// ⚠ IT PATCHES ONE NOTE, NEVER THE BLOCK. The first version redrew the whole
// block when the answer came back, and the answer comes back roughly a third of
// a second AFTER the person has tabbed on to the phone box — so it replaced the
// field they were typing in, taking the caret and every character since the
// last input event with it. Caught in a screenshot, where the phone number
// simply was not there. Same family as the render engine's rule: write only
// what changed.
window.pocCheckEmail = function (name, idx, email) {
  var list = _pocList(name); if (!list[idx]) return;
  if (!email || email.indexOf('@') < 0) return;
  var asked = email;
  apiPost('/contacts/check-email', { email: email }).then(function (res) {
    var c = _pocList(name)[idx];
    if (!c || c.email !== asked) return;   // they kept typing; this answer is stale
    c._emailState = res && res.duplicate ? 'dup' : 'ok';
    c._emailDup = res || null;
    var note = document.querySelector('#poc-' + name + ' .poc-email-note[data-idx="' + idx + '"]');
    if (note) note.innerHTML = _pocNoteHTML(c);
  }).catch(function () {});
};

// Fill a row from a POC PACE already holds at this client, so nobody retypes a
// name the app can see. Appends into the first row that is still empty.
window.pocUse = function (name, person) {
  var list = _pocList(name);
  var row = null;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!c.first_name && !c.email) { row = c; break; }
  }
  if (!row) { row = window.pocNewContact(); list.push(row); }
  row.first_name = person.first_name || '';
  row.last_name = person.last_name || '';
  row.designation = person.designation || '';
  row.email = person.email || '';
  row.phone = person.phone || '';
  row.linkedin = person.linkedin || '';
  row._emailState = ''; row._emailDup = null;
  _pocPatch(name); _pocChanged(name);
};

// ── The same rule the server enforces, checked here ──────────────────────────
// A CHECKED COPY of `readContacts` in services/client-resolve.js, in the idiom
// `view-horizon.js` already uses for the horizon constants: the browser cannot
// require a Node module, so the rule is written twice and a test runs the same
// cases through both and fails if they ever disagree.
//
// The server remains the authority — this copy exists only so the answer lands
// on the tab that can fix it, instead of arriving as a toast after a round trip
// over a form the person then has to go hunting through. Never let this be the
// ONLY check; a rule enforced in a browser is not enforced.
window.POC_EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

window.pocFirstError = function (list) {
  var t = function (v) { return String(v == null ? '' : v).trim(); };
  var rows = (list || []).map(function (c) {
    return { first_name: t(c.first_name), last_name: t(c.last_name),
             designation: t(c.designation), email: t(c.email).toLowerCase(),
             phone: t(c.phone), linkedin: t(c.linkedin) };
  }).filter(function (c) {
    return c.first_name || c.last_name || c.email || c.phone || c.linkedin || c.designation;
  });
  if (!rows.length) return 'Add the client contact — a name and an email address. A lead with nobody on it cannot be emailed or followed up.';
  for (var i = 0; i < rows.length; i++) {
    var c = rows[i];
    var which = rows.length > 1 ? ' for contact ' + (i + 1) : '';
    if (!c.first_name) return 'Enter a first name' + which + '.';
    if (!c.email) return 'Enter an email address' + which + '.';
    if (!window.POC_EMAIL_SHAPE.test(c.email)) return '"' + c.email + '" does not look like an email address' + which + '.';
  }
  var seen = {};
  for (var j = 0; j < rows.length; j++) {
    if (seen[rows[j].email]) return rows[j].email + ' is entered twice — each contact needs their own address.';
    seen[rows[j].email] = true;
  }
  return null;
};

// What goes in the request body: the API's fields only, with the view's own
// bookkeeping (_emailState, _emailDup) left behind.
window.pocPayload = function (name) {
  return _pocList(name).map(function (c) {
    return { first_name: c.first_name || '', last_name: c.last_name || '',
             designation: c.designation || '', email: c.email || '',
             phone: c.phone || '', linkedin: c.linkedin || '' };
  });
};
