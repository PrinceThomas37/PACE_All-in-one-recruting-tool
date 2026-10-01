// An interview time that says WHICH clock it is on (R-095, owner 2026-09-30:
// "All time zones. Our product should be used worldwide.").
//
// The stage window sends the instant (the wall time the scheduler typed, read in the zone they
// picked) and, with the invite request, the zone's IANA name. The server states the time IN that
// zone, with the zone spelled out, so "10:00 AM" can never mean three different things to a
// recruiter in India, a client in Texas and a candidate in London. No zone → UTC, said plainly.

function validZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return null; }
}

function formatInterview(iso, tz) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return 'To be confirmed';
  const zone = validZone(tz) || 'UTC';
  const when = d.toLocaleString('en-US', {
    timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'long',
  });
  const off = (new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(d).find(p => p.type === 'timeZoneName') || {}).value || '';
  return when.replace(/[\u202f\u00a0]/g, ' ') + (off && !/^GMT$/.test(off) && !when.includes(off) ? ' (' + off.replace('GMT', 'UTC') + ')' : '');
}

module.exports = { validZone, formatInterview };
