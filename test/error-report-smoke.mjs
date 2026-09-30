// "WHAT WENT WRONG" REPORTER (R-090): off without a key, scrubs everything personal, never throws.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const er = require('../services/error-report.js');
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

step('Off when SENTRY_DSN is not set (the app and every test run as before)', er.init({}, () => { throw new Error('must not even load'); }) === false);
step('attachErrorHandler is a harmless no-op while off', er.attachErrorHandler({}) === false && er.report(new Error('x')) === false);

const ev = er.scrub({
  message: 'send failed for sam@acme.test',
  exception: { values: [{ value: 'bad address dana@northwind.test' }] },
  user: { email: 'a@b.co', id: 7 },
  request: { url: 'https://x.test/i/SECRETTOKEN123?t=abc', query_string: 't=abc', cookies: { s: '1' }, data: { body: 'resume text' },
             headers: { Authorization: 'Bearer zzz', 'X-Api-Key': 'k', 'user-agent': 'ua', cookie: 'c' } } });
const all = JSON.stringify(ev);
step('No email address survives anywhere in the report', !/@/.test(all), all.match(/\S*@\S*/g) + '');
step('Request body, cookies and query string are gone', !ev.request.data && !ev.request.cookies && !ev.request.query_string);
step('Auth and key headers are gone, harmless ones stay', !('Authorization' in ev.request.headers) && !('X-Api-Key' in ev.request.headers) && !('cookie' in ev.request.headers) && ev.request.headers['user-agent'] === 'ua');
step('The secret in a public-page link never leaves', !/SECRETTOKEN123/.test(all) && /\/i\/:token/.test(ev.request.url));
step('The user is removed', !('user' in ev));
step('scrub tolerates junk', er.scrub(null) === null && er.scrub(undefined) === undefined);

// On: init passes our safe options, handler attaches, report never throws even if Sentry does.
let got = null, handlerOn = null;
const fake = { init: o => { got = o; }, setupExpressErrorHandler: a => { handlerOn = a; },
  withScope: f => f({ setTag() {} }), captureException: () => { throw new Error('sentry down'); } };
step('On with a key: starts Sentry with no tracing, no personal data, our scrubber',
  er.init({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/1' }, () => fake) === true && got.tracesSampleRate === 0 && got.sendDefaultPii === false && got.beforeSend === er.scrub);
const app = {}; step('The error handler is attached to the app', er.attachErrorHandler(app) === true && handlerOn === app);
step('report() never throws even when Sentry itself fails', er.report(new Error('boom'), 'send-loop') === false);
step('A Sentry that cannot start leaves the app running', er.init({ SENTRY_DSN: 'x' }, () => { throw new Error('no module'); }) === false);

const pass = results.filter(Boolean).length; console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
