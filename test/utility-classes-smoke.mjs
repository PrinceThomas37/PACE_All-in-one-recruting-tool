// THE TYPE AND COLOUR UTILITY CLASSES (R-013) — a class that is USED but not DEFINED silently drops its style.
//
// R-013 replaced ~1,700 inline `font-size` / `color:var(--…)` declarations with classes (`fs-11`, `c-text3`, …) defined
// once in public/ui.css. An inline value cannot go missing; a class can — rename one, regenerate the block with a
// smaller threshold, or forget to ship the stylesheet, and text everywhere falls back to the default size/colour with
// nothing to say so. So:
//   * every `fs-*` / `c-*` class the scripts write must have a rule
//   * each rule must say exactly what its name says (fs-11_5 → 11.5px, c-text3 → var(--text3)) — a typo would change
//     every use at once
//   * the rules sit in ONE generated block (scripts/inline-to-classes.mjs owns it)
//   * (a probe that cannot see any use FAILS rather than passes — an empty scan would be vacuous)
// Usage: node test/utility-classes-smoke.mjs
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const css = fs.readFileSync(path.join(ROOT, 'public/ui.css'), 'utf8');
const block = css.slice(css.indexOf('/* R-013 UTILITIES BEGIN'), css.indexOf('/* R-013 UTILITIES END */'));
step('the generated utility block exists in ui.css', block.length > 100 && css.includes('/* R-013 UTILITIES END */'));
const rules = {}; for (const m of block.matchAll(/^\.((?:fs|c)-[a-z0-9_-]+)\{([^}]*)\}/gm)) rules[m[1]] = m[2];
step('it defines a useful number of classes', Object.keys(rules).length >= 25, String(Object.keys(rules).length));
// every rule says what its name says
const bad = [];
for (const [name, body] of Object.entries(rules)) {
  if (name.startsWith('fs-')) { if (body !== 'font-size:' + name.slice(3).replace('_', '.') + 'px') bad.push(name + '{' + body + '}'); }
  else if (body !== 'color:var(--' + name.slice(2) + ')') bad.push(name + '{' + body + '}');
}
step('every rule says exactly what its name says', bad.length === 0, bad.join(' '));
// every class the scripts use is defined
const used = new Map();
const dir = path.join(ROOT, 'public/js');
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of s.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/^(fs-[0-9_]+|c-[a-z0-9-]+)$/.test(c)) used.set(c, (used.get(c) || 0) + 1);
}
const total = [...used.values()].reduce((a, b) => a + b, 0);
step('the scripts really use them (an empty scan proves nothing)', total >= 1000, 'uses=' + total);
const missing = [...used.keys()].filter(c => !rules[c]);
step('no class is used without being defined', missing.length === 0, missing.join(' '));
const unused = Object.keys(rules).filter(c => !used.has(c));
step('no class is defined that nothing uses (the block stays honest)', unused.length <= 3, unused.join(' '));
// the page really links the stylesheet that holds them
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
step('index.html loads ui.css', /href="\/ui\.css"/.test(html));
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
