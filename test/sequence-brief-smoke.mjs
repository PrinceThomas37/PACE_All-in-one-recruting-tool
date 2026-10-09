// D-0117 — "Write with AI" follows the instruction.
//   * default is a full email (140–200 words, 3–4 paragraphs); a short one is
//     repaired once, then shipped with a note if it is still short
//   * if they ask for shorter, that is the length
//   * a draft that misses the topic, or turns into the generic candidate pitch
//     they did not ask for, is not shipped
//   * Rewrite with AI and Write a variant keep every {{variable}}; if they
//     cannot, the person's own text comes back — never the ready-made starter
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sd = require('../services/sequence-draft.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ai = (...texts) => { const calls = []; const f = async () => { const t = texts[Math.min(calls.length, texts.length - 1)]; calls.push(1); return t == null ? null : { text: t }; }; f.calls = calls; return f; };
const j = (subject, body) => JSON.stringify({ subject, body });
const ON = 'Hi {{fn}},\n\nI am writing about the two estimators {{company}} needs for the hospital expansion in {{loc}}. The {{pos}} work is takeoffs on one side and pricing reviews on the other, and I will stay on that and only that.\n\n' + 'Each estimator would walk the drawings for the expansion, price the trades already on the set, and say which weeks they can start. '.repeat(8) + '\n\nWould a note on those two estimators be useful?';
const PITCH = 'Hi {{fn}},\n\nI have a few pre-screened people who could fit. Would you like me to send their resumes over?\n\nLooking forward to your thoughts.';

step('the writer is told the instruction is the brief, and the default is 140 to 200 words', /instruction is the brief/.test(sd.buildSystemPrompt('first')) && /140 to 200 words/.test(sd.buildSystemPrompt('first')) && /generic/.test(sd.buildSystemPrompt('first')));
step('a full on-topic draft is a full email', sd.wordCount(ON) >= 140 && sd.paragraphCount(ON) >= 3, sd.wordCount(ON) + ' words');

let c = ai(j('Estimators', ON));
let r = await sd.draft({ complete: c, prompt: 'offer two estimators for a hospital expansion', purpose: 'first' });
step('a full draft on the topic is shipped, one call', r.source === 'ai' && /estimators/.test(r.body) && !/shorter than a full email/.test(r.note) && c.calls.length === 1);

const SHORT = 'Hi {{fn}},\n\nThe two estimators for the hospital expansion at {{company}} are ready to talk about takeoffs.\n\nShall I describe them?';
c = ai(j('Estimators', SHORT), j('Estimators', SHORT));
r = await sd.draft({ complete: c, prompt: 'offer two estimators for a hospital expansion', purpose: 'first' });
step('still short after one repair: shipped, and the note says it came out shorter', r.source === 'ai' && /estimators/.test(r.body) && /shorter than a full email/.test(r.note) && c.calls.length === 2, r.note);

c = ai(j('Estimators', SHORT));
r = await sd.draft({ complete: c, prompt: 'a short note offering two estimators', purpose: 'first' });
step('when they ask for shorter, a short on-topic draft is not sent back for length', r.source === 'ai' && c.calls.length === 1 && !/shorter than a full email/.test(r.note));

c = ai(j('Candidates', PITCH), j('Candidates', PITCH));
r = await sd.draft({ complete: c, prompt: 'offer two estimators for a hospital expansion', purpose: 'first' });
step('a generic candidate pitch is not shipped when they did not ask for one', r.source === 'refused' && !r.body && /missed the topic/.test(r.note) && r.subject !== sd.starterFor('first').subject);

c = ai(j('Hello', 'Hi {{fn}},\n\nJust checking in about the weather and the weekend plans at {{company}} for a few minutes today.\n\nLet me know either way.'), j('Hello', 'Hi {{fn}},\n\nJust checking in about the weather and the weekend plans at {{company}} for a few minutes today.\n\nLet me know either way.'));
r = await sd.draft({ complete: c, prompt: 'offer two estimators for a hospital expansion', purpose: 'first' });
step('a draft that never mentions the topic is not shipped', r.source === 'refused' && !r.body);

const OWN = { subject: 'Estimators for {{company}}', body: 'Hi {{fn}},\n\nTwo estimators for the {{pos}} work in {{loc}}. I will keep this to the expansion.\n\nShall I send the two names?' };
const REWRITTEN = { subject: 'Estimators for {{company}}', body: 'Hi {{fn}},\n\nI tightened this. Two estimators for the {{pos}} work in {{loc}}, still only the expansion.\n\nShall I send the two names?' };
c = ai(j(REWRITTEN.subject, REWRITTEN.body));
r = await sd.draft({ complete: c, mode: 'rewrite', prompt: '', purpose: 'first', subject: OWN.subject, body: OWN.body });
step('Rewrite with AI keeps every variable and uses the new sentences', r.source === 'ai' && sd.sameVars(OWN.body, r.body) && sd.sameVars(OWN.subject, r.subject) && /tightened/.test(r.body));

c = ai(j('Estimators for Acme', 'Hi Sam,\n\nTwo estimators, no fields left in this version at all.\n\nShall I send the names?'), j('No {{fn}}', 'Hi,\n\nStill no {{company}} field here, and nothing else either.\n\nThanks.'));
r = await sd.draft({ complete: c, mode: 'variant', prompt: '', purpose: 'first', subject: OWN.subject, body: OWN.body });
step('a variant that drops a {{variable}} returns the person\'s own text, never the starter', r.source === 'kept' && r.body === OWN.body && r.subject === OWN.subject && !/pre-screened/.test(r.body));

c = ai(null);
r = await sd.draft({ complete: c, mode: 'rewrite', prompt: 'make it warmer', purpose: 'first', subject: OWN.subject, body: OWN.body });
step('when the writer is down, Rewrite returns their text and says so', r.source === 'kept' && r.body === OWN.body && /unchanged/.test(r.note));

r = await sd.draft({ complete: ai(j('S', 'body')), mode: 'variant', prompt: '', purpose: 'first', subject: '', body: '' });
step('Write a variant with nothing written yet does not invent a starter', r.source === 'kept' && !r.body && /nothing to change/.test(r.note));

const failed = results.filter(v => !v).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
