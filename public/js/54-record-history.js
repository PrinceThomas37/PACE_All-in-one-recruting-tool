// ============================================================================
// THE REWIND BUTTON — one history panel, every record kind.
//
// The owner: "build the time of every stage change. Date and time and tag that
// as a small history thing like a rewind clock button in every lead, candidate,
// job and all."
//
// ONE module, deliberately. The most expensive bug class in this repo is the
// same idea implemented per screen — three lead-release paths, one stage
// vocabulary in six files. So the button is built here, the panel is built
// here, and a page adds history by emitting `rewindBtn('lead', id)` and
// nothing else.
//
// Rules this obeys, each of which was learned the hard way:
//  - Registered with UI.registerOverlay (by NAME, idempotent) — module files
//    are evaluated once but wrap render() repeatedly.
//  - STATE.page is never touched, so closing returns you to the same list with
//    the same filters and scroll.
//  - The panel floats over content, so it paints on --card-solid, never
//    --card (which is glass, and was see-through on a phone in Session 25).
//  - Every onclick it emits is defined in this file.
//  - No inline font sizes or colours: an inline value cannot be re-themed or
//    re-scaled, which is what broke the last two rounds of phone faults.
// ============================================================================
(function () {
  // Each page module carries its own `esc` — there is no global one. Copying it
  // is the established idiom here, not an oversight.
  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  // ── the button ────────────────────────────────────────────────────────────
  // rewindBtn(entity, id, opts) — the small clock. `bare` drops the chrome for
  // a spot that already sits inside a toolbar of icons.
  window.rewindBtn = function (entity, id, opts) {
    if (!entity || !id) return '';
    var o = opts || {};
    var cls = 'rw-btn' + (o.bare ? ' rw-bare' : '');
    return '<button type="button" class="' + cls + '" title="History — every change, with the date and time"' +
      ' aria-label="Show this record\'s history"' +
      ' onclick="event.stopPropagation();openRewind(\'' + entity + '\',\'' + id + '\')">' +
      UI.ic('rewind') + (o.label ? '<span>' + o.label + '</span>' : '') +
      '</button>';
  };

  // ── open / close ──────────────────────────────────────────────────────────
  window.openRewind = function (entity, id) {
    STATE.rewind = { entity: entity, id: id, loading: true, entries: null, error: null, title: null };
    render();
    apiFetch('GET', '/history/' + encodeURIComponent(entity) + '/' + encodeURIComponent(id))
      .then(function (r) {
        if (!STATE.rewind || STATE.rewind.id !== id) return;   // they moved on
        STATE.rewind.loading = false;
        STATE.rewind.entries = (r && r.entries) || [];
        STATE.rewind.title = (r && r.title) || null;
        render();
      })
      .catch(function (e) {
        if (!STATE.rewind || STATE.rewind.id !== id) return;
        STATE.rewind.loading = false;
        // Say which failure it was. "Could not load" sends somebody hunting a
        // record that is fine; "you cannot see this one" does not.
        STATE.rewind.error = (e && /not_found|404/.test(String(e.message || e)))
          ? 'That record is not available to you.'
          : 'The history could not be loaded. Try again in a moment.';
        render();
      });
  };

  window.closeRewind = function () { STATE.rewind = null; render(); };

  // ── time ──────────────────────────────────────────────────────────────────
  // The owner asked for date AND time, so the exact stamp is always on screen;
  // the relative form sits beside it as the glance. Never one without the other.
  function exactStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function relative(iso) {
    var t = new Date(iso).getTime(), n = Date.now();
    if (isNaN(t)) return '';
    var d = n - t;
    if (d < 60000) return 'just now';
    if (d < 3600000) { var m = Math.floor(d / 60000); return m + (m === 1 ? ' min ago' : ' mins ago'); }
    if (d < 86400000) { var h = Math.floor(d / 3600000); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    var days = Math.floor(d / 86400000);
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    var mo = Math.floor(days / 30);
    if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
    var y = Math.floor(days / 365);
    return y + (y === 1 ? ' year ago' : ' years ago');
  }

  // How long the record sat at the value this entry moved it to. This is the
  // question a stage trail is really asked — "where does this rot?" — and it is
  // free here because the next entry up IS the end of this one.
  function heldFor(entries, i) {
    var e = entries[i];
    if (!e || e.kind !== 'stage' || !e.to) return '';
    var endedAt = i === 0 ? Date.now() : new Date(entries[i - 1].at).getTime();
    var ms = endedAt - new Date(e.at).getTime();
    if (!isFinite(ms) || ms < 60000) return '';
    var days = Math.floor(ms / 86400000);
    var hours = Math.floor(ms / 3600000);
    var label = days >= 1 ? (days + (days === 1 ? ' day' : ' days'))
              : hours >= 1 ? (hours + (hours === 1 ? ' hour' : ' hours'))
              : (Math.floor(ms / 60000) + ' mins');
    return i === 0 ? ('here ' + label) : ('held ' + label);
  }

  // ── the sentence ──────────────────────────────────────────────────────────
  // Mirrors services/record-history.js `describe()`. A stage change names BOTH
  // ends: "Screening" alone does not say whether that was progress.
  var ACTION_WORDS = {
    job_created: 'Lead created', job_updated: 'Lead updated', job_deleted: 'Lead deleted',
    created: 'Created', imported: 'Imported', assigned: 'Assigned',
    deleted: 'Deleted', note: 'Note added',
  };

  function fieldLabel(f) {
    if (!f) return 'Changed';
    return String(f).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function describe(e) {
    if (e.kind === 'stage' || e.field) {
      var label = (e.field === 'stage' || e.kind === 'stage') ? 'Stage'
                : (e.field === 'status' ? 'Status' : fieldLabel(e.field));
      if (e.from && e.to) {
        return '<b>' + label + '</b> ' + esc(e.from) +
               ' <span class="rw-ar">→</span> <b class="rw-to">' + esc(e.to) + '</b>';
      }
      if (e.to) return '<b>' + label + '</b> set to <b class="rw-to">' + esc(e.to) + '</b>';
      if (e.from) return '<b>' + label + '</b> cleared <span class="rw-was">(was ' + esc(e.from) + ')</span>';
      return '<b>' + label + '</b> changed';
    }
    if (ACTION_WORDS[e.kind]) return '<b>' + ACTION_WORDS[e.kind] + '</b>';
    if (e.note) return esc(e.note);
    return '<b>' + esc(fieldLabel(e.kind)) + '</b>';
  }

  // ── the panel ─────────────────────────────────────────────────────────────
  function renderRewind() {
    var s = STATE.rewind;
    if (!s) return '';

    var body;
    if (s.loading) {
      body = '<div class="rw-msg">Loading the history…</div>';
    } else if (s.error) {
      body = '<div class="rw-msg rw-err">' + esc(s.error) + '</div>';
    } else if (!s.entries || !s.entries.length) {
      // An empty history is a real answer, not a failure — say which.
      body = '<div class="rw-msg">Nothing has changed on this record yet. ' +
             'Every stage change from here on will be listed, with the date and time.</div>';
    } else {
      body = '<ol class="rw-list">' + s.entries.map(function (e, i) {
        var held = heldFor(s.entries, i);
        return '<li class="rw-row' + (e.kind === 'stage' ? ' rw-stage' : '') + '">' +
          '<div class="rw-dot"></div>' +
          '<div class="rw-main">' +
            '<div class="rw-what">' + describe(e) + '</div>' +
            '<div class="rw-meta">' +
              '<span class="rw-when" title="' + esc(e.at) + '">' + esc(exactStamp(e.at)) + '</span>' +
              '<span class="rw-rel">' + esc(relative(e.at)) + '</span>' +
              (e.actor ? '<span class="rw-who">' + esc(e.actor) + '</span>' : '') +
              (held ? '<span class="rw-held">' + esc(held) + '</span>' : '') +
            '</div>' +
            (e.note && e.kind !== 'note' && !/^Stage: /.test(e.note)
              ? '<div class="rw-note">' + esc(e.note) + '</div>' : '') +
          '</div>' +
        '</li>';
      }).join('') + '</ol>';
    }

    var count = (s.entries && s.entries.length) || 0;
    return '<div class="overlay rw-overlay" onclick="closeRewind()">' +
      '<div class="rw-panel" onclick="event.stopPropagation()" role="dialog" aria-label="Record history">' +
        '<div class="rw-head">' +
          '<div class="rw-title">' + UI.ic('rewind') +
            '<span>History</span>' +
            (s.title ? '<em>' + esc(s.title) + '</em>' : '') +
          '</div>' +
          '<button type="button" class="rw-x" onclick="closeRewind()" aria-label="Close">' + UI.ic('x') + '</button>' +
        '</div>' +
        (count ? '<div class="rw-sub">' + count + (count === 1 ? ' change' : ' changes') + ', newest first</div>' : '') +
        '<div class="rw-body">' + body + '</div>' +
      '</div>' +
    '</div>';
  }

  UI.registerOverlay('rewind', renderRewind);
})();
