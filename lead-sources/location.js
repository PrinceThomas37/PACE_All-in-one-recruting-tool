// lead-sources/location.js
// Break a job board's free-text location into city / state / country.
//
// Job feeds give location as whatever the employer typed: "Dallas, TX",
// "Remote - US", "San Francisco, California, United States", "London, UK".
// The lead pipeline needs the state at minimum, because `jobs.timezone` is
// derived from location and the send window runs in the LEAD's timezone — a
// wrong state means outreach going out at the wrong hour.
//
// Rule-based and deliberately conservative: if a string can't be read with
// confidence, return nulls rather than a guess. A blank state is handled
// everywhere; a wrong one silently mis-times emails.

const US_STATES = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
  connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID',
  illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA',
  maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN',
  mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV',
  'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY',
  'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
  pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD',
  tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA',
  'west virginia':'WV', wisconsin:'WI', wyoming:'WY', 'district of columbia':'DC',
  'washington dc':'DC', 'washington, d.c.':'DC'
};
const US_ABBR = new Set(Object.values(US_STATES));

// Indian states/UTs, because the owner's market is US *and* India.
const IN_STATES = {
  'andhra pradesh':'AP', assam:'AS', bihar:'BR', chhattisgarh:'CG', goa:'GA',
  gujarat:'GJ', haryana:'HR', 'himachal pradesh':'HP', jharkhand:'JH', karnataka:'KA',
  kerala:'KL', 'madhya pradesh':'MP', maharashtra:'MH', odisha:'OR', punjab:'PB',
  rajasthan:'RJ', 'tamil nadu':'TN', telangana:'TS', 'uttar pradesh':'UP',
  uttarakhand:'UK', 'west bengal':'WB', delhi:'DL', 'new delhi':'DL'
};
// Major Indian cities map to their state, since feeds usually give only the city.
const IN_CITIES = {
  bangalore:'KA', bengaluru:'KA', hyderabad:'TS', chennai:'TN', mumbai:'MH',
  pune:'MH', kolkata:'WB', gurgaon:'HR', gurugram:'HR', noida:'UP',
  ahmedabad:'GJ', kochi:'KL', cochin:'KL', trivandrum:'KL', coimbatore:'TN',
  indore:'MP', jaipur:'RJ', chandigarh:'CH', bhubaneswar:'OR', nagpur:'MH'
};

const COUNTRY_ALIASES = {
  'united states':'USA', 'united states of america':'USA', 'usa':'USA', 'us':'USA',
  'u.s.':'USA', 'u.s.a.':'USA', 'america':'USA',
  'india':'India', 'in':'India',
  'united kingdom':'UK', 'uk':'UK', 'great britain':'UK', 'england':'UK',
  'canada':'Canada', 'germany':'Germany', 'australia':'Australia',
  'ireland':'Ireland', 'netherlands':'Netherlands', 'singapore':'Singapore'
};

// Noise that appears alongside a real location and must not be read as a city.
const NOISE = /^(remote|hybrid|on-?site|in[- ]office|flexible|anywhere|multiple locations|various|worldwide|global|distributed|work from home|wfh|full[- ]time|part[- ]time|contract)$/i;

function titleCase(s) {
  return String(s).toLowerCase().split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseLocation(text) {
  const empty = { city: null, state: null, country: null };
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return empty;

  // Strip a leading "Remote -" / "Hybrid:" qualifier but keep what follows,
  // so "Remote - Austin, TX" still yields Austin/TX.
  let s = raw.replace(/^\s*(remote|hybrid|on-?site|in[- ]office)\s*[-–—:,|]\s*/i, '').trim();
  // Parentheses carry real content in these feeds ("Remote (US)", "Austin (HQ)"),
  // so unwrap them rather than dropping them — otherwise "(us)" reads as a city.
  s = s.replace(/[()]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!s || NOISE.test(s)) {
    // Nothing but a work-arrangement word; still try to catch "Remote, USA".
    const c = COUNTRY_ALIASES[raw.toLowerCase().replace(/^(remote|hybrid)\s*[-–—:,|]?\s*/i, '').trim()];
    return { city: null, state: null, country: c || null };
  }

  // Strip work-arrangement words that sit INSIDE a part rather than in front of
  // it ("US Remote", "Austin Hybrid"), or they get read as part of a city name.
  const parts = s.split(/[,|]/)
    .map(p => p.replace(/\b(remote|hybrid|on-?site|onsite|in[- ]office|wfh|work from home)\b/gi, '')
                .replace(/\s{2,}/g, ' ').trim())
    .filter(p => p && !NOISE.test(p));
  if (!parts.length) {
    // Everything was an arrangement word — but the original may still name a
    // country, e.g. "Remote (US)".
    const bare = raw.replace(/[()]/g, ' ').split(/[\s,|-]+/)
      .map(w => COUNTRY_ALIASES[w.toLowerCase()]).find(Boolean);
    return { city: null, state: null, country: bare || null };
  }

  let city = null, state = null, country = null;

  // Work right-to-left: the last part is usually the broadest (country/state).
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const low = p.toLowerCase();

    if (!country && COUNTRY_ALIASES[low]) { country = COUNTRY_ALIASES[low]; continue; }
    if (!state && US_ABBR.has(p.toUpperCase()) && p.length === 2) { state = p.toUpperCase(); continue; }
    if (!state && US_STATES[low]) { state = US_STATES[low]; if (!country) country = 'USA'; continue; }
    if (!state && IN_STATES[low]) { state = IN_STATES[low]; if (!country) country = 'India'; continue; }
    if (!city) city = p;
  }

  // A bare major Indian city implies its state and country.
  if (city && !state) {
    const key = city.toLowerCase();
    if (IN_CITIES[key]) { state = IN_CITIES[key]; country = country || 'India'; }
  }
  // A US state without an explicit country is a US location.
  if (state && !country && US_ABBR.has(state)) country = 'USA';

  return {
    city: city ? titleCase(city) : null,
    state: state || null,
    country: country || null
  };
}

module.exports = { parseLocation, US_STATES, IN_CITIES, COUNTRY_ALIASES };
