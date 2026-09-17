// ── Shared company (client) autocomplete widget ──────────────────────────────
// Same shape and same discipline as 40-zip-autocomplete.js: it patches ONLY its
// own suggestions box on the DOM (never a full render()), so the input keeps
// focus and the caret mid-type.
//
// Why it exists: a job order belongs to a client, stored as a `companies` row.
// The New Job form asked for the client as free text and never turned it into
// one, so every direct "+ New Job" save was refused by the server. A text box
// cannot express "which client" — this can.
//
// Usage:
//   companyAcHTML(inputId, value, onPickFnName, onTypeFnName, placeholder)
//     onPickFnName — global function(company, inputId): the person chose an
//                    existing client. `company` is {id,name,industry,location,
//                    website,job_count}.
//     onTypeFnName — global function(text, inputId): the person is typing, so
//                    any previously picked client no longer applies. Called on
//                    EVERY keystroke — a stale company_id under freshly typed
//                    text is how a job lands on the wrong client.
var _coAc = {};

window.companyAcHTML = function (inputId, value, onPickFnName, onTypeFnName, placeholder) {
  return '<div style="position:relative">' +
    '<input class="sel" id="' + inputId + '" placeholder="' + htmlEsc(placeholder || 'Client company') + '" ' +
      'value="' + htmlEsc(value || '') + '" autocomplete="off" ' +
      'oninput="companyAcSearch(\'' + inputId + '\',this.value,\'' + onPickFnName + '\',\'' + onTypeFnName + '\')" ' +
      'onblur="companyAcBlur(\'' + inputId + '\')"/>' +
    '<div id="' + inputId + '-sugs"></div>' +
  '</div>';
};

window.companyAcSearch = function (inputId, val, onPickFnName, onTypeFnName) {
  // Tell the form first, synchronously. The fetch below may never come back.
  if (onTypeFnName && window[onTypeFnName]) window[onTypeFnName](val, inputId);
  if (!val || val.trim().length < 2) { _patchCoAcSugs(inputId, []); return; }
  var asked = val;
  apiGet('/companies/search?q=' + encodeURIComponent(val.trim())).then(function (results) {
    // A slow answer to an older keystroke must not paint over a newer one.
    var el = document.getElementById(inputId);
    if (el && el.value !== asked) return;
    _coAc[inputId] = results || [];
    _patchCoAcSugs(inputId, _coAc[inputId], onPickFnName);
  }).catch(function () { _patchCoAcSugs(inputId, []); });
};

window.companyAcBlur = function (inputId) {
  // Delay so a click on a suggestion (mousedown, below) fires before the box clears.
  setTimeout(function () { var el = document.getElementById(inputId + '-sugs'); if (el) el.innerHTML = ''; }, 200);
};

function _patchCoAcSugs(inputId, results, onPickFnName) {
  var el = document.getElementById(inputId + '-sugs'); if (!el) return;
  if (!results || !results.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="position:absolute;top:100%;left:0;right:0;background:var(--card-solid);border:1px solid var(--border2);border-radius:8px;box-shadow:var(--sh2);z-index:200;max-height:220px;overflow-y:auto;margin-top:2px">' +
    results.map(function (c, i) {
      var sub = [c.industry, c.location].filter(Boolean).join(' · ');
      var count = c.job_count ? c.job_count + ' lead' + (c.job_count === 1 ? '' : 's') : '';
      return '<div class="_co-ac-sug" data-idx="' + i + '" style="padding:8px 13px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">' +
        '<div style="font-weight:600">' + htmlEsc(c.name) + '</div>' +
        (sub || count ? '<div style="font-size:11px;color:var(--text3)">' + htmlEsc(sub) +
          (sub && count ? ' · ' : '') + htmlEsc(count) + '</div>' : '') +
      '</div>';
    }).join('') +
  '</div>';
  Array.prototype.forEach.call(el.querySelectorAll('._co-ac-sug'), function (node) {
    node.addEventListener('mouseenter', function () { this.style.background = 'var(--accent-l)'; });
    node.addEventListener('mouseleave', function () { this.style.background = ''; });
    node.addEventListener('mousedown', function (e) {
      e.preventDefault(); // fire before the input's onblur clears the box
      var c = results[parseInt(node.getAttribute('data-idx'), 10)]; if (!c) return;
      el.innerHTML = '';
      if (onPickFnName && window[onPickFnName]) window[onPickFnName](c, inputId);
    });
  });
}
