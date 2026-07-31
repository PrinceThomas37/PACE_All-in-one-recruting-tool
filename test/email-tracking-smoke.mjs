// Unit checks for the email-tracking helpers (slice 1 infrastructure).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const et = require('../email-tracking.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const t1 = et.newToken(), t2 = et.newToken();
step('newToken is 32-char hex and unique', /^[0-9a-f]{32}$/.test(t1) && t1 !== t2, t1);
step('TRANSPARENT_GIF has a valid GIF header', et.TRANSPARENT_GIF.slice(0, 6).toString('ascii') === 'GIF89a' && et.TRANSPARENT_GIF.length > 20);
step('pixelUrl builds /o/<token>.gif', et.pixelUrl('abc', 'https://x.test') === 'https://x.test/o/abc.gif');
step('resolveBaseUrl strips trailing slash', et.resolveBaseUrl().slice(-1) !== '/');

const injected = et.injectPixel('<html><body>Hi</body></html>', 'tok', 'https://x.test');
step('injectPixel inserts just before </body>', /\/o\/tok\.gif[^>]*"[^>]*>\s*<\/body>/.test(injected) && injected.indexOf('Hi') < injected.indexOf('/o/tok.gif'));

const injected2 = et.injectPixel('Plain body text', 'tok', 'https://x.test');
step('injectPixel appends when there is no </body>', injected2.startsWith('Plain body text') && injected2.includes('/o/tok.gif'));

step('pixel markup is hidden', /display:none/.test(et.pixelHtml('tok', 'https://x.test')));

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
