// CAN YOU READ IT? — one measuring function, used by every contrast guard.
//
// It runs INSIDE the page (hand it to page.evaluate) and answers: for every
// piece of text under `scope`, what is the contrast between its colour and
// whatever is really painted behind it?
//
// Session 40 (R-140) found that the first version of this probe was blind in
// exactly the place the owner kept finding unreadable text. The page ground
// (`body`) carries a faint 16px grid as a background-IMAGE, and the probe's rule
// was "an image behind the text → we cannot judge, skip it". So every line of
// text standing straight on the dark ground — a page's title, its sub-line, its
// tab bar — was never measured in any theme, and "5 direct reports · 12 in your
// reporting line" went out dark-grey-on-dark-purple with a green suite.
//
// The rule now: an element that has BOTH a solid colour and an image (the grid,
// a hatch, a noise texture) is judged against its colour — the image is a
// texture over it, not a different ground. An element that has an image and NO
// colour (a gradient slab, a photo) is still declined, and is COUNTED so a
// suite can say how much it could not judge instead of silently passing.
//
// Returns { bad: [...worst first], judged, declined }.
export const CONTRAST_PROBE = ({ minRatio, scope, limit }) => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  // What is REALLY behind this element: every translucent ancestor composited
  // down onto the page ground. One getComputedStyle cannot tell you this.
  const effectiveBg = (el) => {
    const stack = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      const hasColour = c && c.a > 0;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !hasColour) return null;
      if (hasColour) { stack.push(c); if (c.a === 1) break; }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (base.a === 0) base = { r: 255, g: 255, b: 255, a: 1 };
    let acc = base;
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };
  // A short "where is it" for a report: tag.class chain of the nearest 3 ancestors.
  const where = (el) => {
    const out = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 3; n = n.parentElement, i++) {
      const c = String(n.className && n.className.baseVal != null ? n.className.baseVal : n.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      out.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (c ? '.' + c : ''));
    }
    return out.join(' < ');
  };

  // The nearest ancestor that actually PAINTS a colour — the surface the text is
  // standing on. This is what a fixer needs to see: "div < div" says nothing, but
  // "div.card" or "div[style=background:var(--card)]" says which rule to extend.
  const surface = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) {
        const cl = String(n.className && n.className.baseVal != null ? n.className.baseVal : n.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
        const st = (n.getAttribute('style') || '').match(/background[^;]*/);
        return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cl ? '.' + cl : '') + (st ? '[' + st[0].slice(0, 40) + ']' : '');
      }
    }
    return 'page';
  };

  const bad = [];
  let judged = 0, declined = 0;
  for (const el of document.querySelectorAll(scope)) {
    // The element's OWN text nodes only — each child is judged on its own turn,
    // in its own colour, so nothing is counted twice and a name sharing its
    // element with a title span is still measured.
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.35) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const fg = parse(cs.color); if (!fg || fg.a < 0.35) continue;
    const bg = effectiveBg(el);
    if (!bg) { declined++; continue; }
    judged++;
    const l1 = lum(over(fg, bg)), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < minRatio) {
      bad.push({
        txt: txt.slice(0, 40), cls: String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '').slice(0, 40),
        where: where(el), surface: surface(el), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  }
  bad.sort((a, b) => a.ratio - b.ratio);
  return { bad: limit ? bad.slice(0, limit) : bad, judged, declined };
};
