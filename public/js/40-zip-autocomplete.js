// ── Shared zip-code autocomplete widget ──────────────────────────────────
// Reusable version of the zip → city/state suggestion box the RA lead form
// already had (15-ra-entry-form.js), for use on any form's zip field
// (candidate, job order, …). Patches only its own suggestions box on the DOM
// directly (not a full render()), so the input never loses focus mid-type.
//
// Usage: build the input with zipAcHTML(inputId, value, onPickFnName), where
// onPickFnName is a global function `function(place, inputId){...}` that
// receives {zip,city,state,state_abbr,display} and is responsible for
// updating that form's own state + repainting it.
var _zipAc = {};

window.zipAcHTML = function (inputId, value, onPickFnName) {
  return '<div style="position:relative">' +
    '<input class="inp" id="' + inputId + '" placeholder="Zip code (e.g. 10001)" value="' + htmlEsc(value || '') + '" autocomplete="off" ' +
      'oninput="zipAcSearch(\'' + inputId + '\',this.value,\'' + onPickFnName + '\')" onblur="zipAcBlur(\'' + inputId + '\')"/>' +
    '<div id="' + inputId + '-sugs"></div>' +
  '</div>';
};

window.zipAcSearch = function (inputId, val, onPickFnName) {
  if (!val || val.length < 3) { _patchZipAcSugs(inputId, []); return; }
  apiGet('/lookup/zipcode?zip=' + encodeURIComponent(val)).then(function (results) {
    _zipAc[inputId] = results || [];
    _patchZipAcSugs(inputId, _zipAc[inputId], onPickFnName);
  }).catch(function () { _patchZipAcSugs(inputId, []); });
};

window.zipAcBlur = function (inputId) {
  // Delay so a click on a suggestion (mousedown, below) fires before the box clears.
  setTimeout(function () { var el = document.getElementById(inputId + '-sugs'); if (el) el.innerHTML = ''; }, 200);
};

function _patchZipAcSugs(inputId, results, onPickFnName) {
  var el = document.getElementById(inputId + '-sugs'); if (!el) return;
  if (!results || !results.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="position:absolute;top:100%;left:0;right:0;background:var(--card-solid);border:1px solid var(--border2);border-radius:8px;box-shadow:var(--sh2);z-index:200;max-height:200px;overflow-y:auto;margin-top:2px">' +
    results.map(function (z, i) {
      return '<div class="_zip-ac-sug" data-idx="' + i + '" style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">' + htmlEsc(z.display) + '</div>';
    }).join('') +
  '</div>';
  Array.prototype.forEach.call(el.querySelectorAll('._zip-ac-sug'), function (node) {
    node.addEventListener('mouseenter', function () { this.style.background = 'var(--accent-l)'; });
    node.addEventListener('mouseleave', function () { this.style.background = ''; });
    node.addEventListener('mousedown', function (e) {
      e.preventDefault(); // fire before the input's onblur clears the box
      var z = results[parseInt(node.getAttribute('data-idx'), 10)]; if (!z) return;
      el.innerHTML = '';
      if (onPickFnName && window[onPickFnName]) window[onPickFnName](z, inputId);
    });
  });
}
