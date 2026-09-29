/**
 * UX-2 -- public landing geometry audit (browser console / devtools snippet).
 *
 * Paste into the console on /{locale} at any width (1440, 1024, 768, 430,
 * 390) and read the result: `{ w, pass, fails[] }`. It measures rendered
 * geometry -- not CSS source -- so a tilted card, a column that stopped
 * sharing an edge, an off-centre caption or a stage label drifting from its
 * bar shows up as a named failure. Tolerance is 1px (anti-aliasing noise is
 * not chased). Used for the UX-2 precision certification.
 */
(() => {
  const R = (el) => el.getBoundingClientRect();
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const textLeft = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left; };
  const out = { w: innerWidth, fails: [] };
  const fail = (m) => out.fails.push(m);

  // 1. no static transform anywhere (functional exceptions only)
  const transformed = qa('body *').filter((e) => getComputedStyle(e).transform !== 'none' && !e.matches('.lx-nav-chevron, .lp-final-note a'));
  if (transformed.length) fail('transforms: ' + transformed.map((e) => e.className).join(','));

  // 2. one content edge: logo, hero copy, headline lines, stories, FAQ, footer
  const L = R(q('.lp-hero-copy')).left;
  const lefts = { logo: R(q('.mkt-logo img')).left, footer: R(q('.lp-footer-brand')).left, faq: R(q('#lp-faq')).left, title: Math.min(...qa('.lp-title-line').map((e) => R(e).left)) };
  qa('.lp-story').forEach((e, i) => (lefts['story' + i] = R(e).left));
  for (const [k, v] of Object.entries(lefts)) if (!near(v, L)) fail(`left ${k}`);

  // 3. one right edge: nav, FAQ, footer and (desktop) every product sketch
  const c = q('.lp-hero .lp-container');
  const RT = R(c).right - parseFloat(getComputedStyle(c).paddingRight);
  const rights = { nav: R(q('.mkt-nav')).right, faq: R(q('.lp-faq')).right };
  if (innerWidth >= 600) rights.footer = R(q('.lp-footer-locales')).right;
  if (innerWidth >= 1024) { rights.card = R(q('.lp-preview-card')).right; qa('.lp-visual').forEach((v, i) => (rights['visual' + i] = R(v).right)); }
  for (const [k, v] of Object.entries(rights)) if (!near(v, RT)) fail(`right ${k}`);

  // 4. sketches start on the hero card's column edge (desktop)
  if (innerWidth >= 1024) qa('.lp-visual').forEach((v, i) => { if (!near(R(v).left, R(q('.lp-preview')).left)) fail(`visual${i} column`); });

  // 5. captions centred on their object
  qa('.lp-preview, .lp-visual').forEach((f, i) => { const o = R(f.firstElementChild); const cap = R(f.querySelector('figcaption')); if (!near((o.left + o.right) / 2, (cap.left + cap.right) / 2)) fail(`caption${i}`); });

  // 6. stage tracks: equal, level segments; each label starts on its bar
  qa('.xp-track').forEach((t, ti) => {
    const bars = [...t.querySelectorAll('.xp-track-bar')];
    if (Math.max(...bars.map((b) => R(b).width)) - Math.min(...bars.map((b) => R(b).width)) > 1) fail(`track${ti} widths`);
    if (Math.max(...bars.map((b) => R(b).top)) - Math.min(...bars.map((b) => R(b).top)) > 0.5) fail(`track${ti} level`);
    t.querySelectorAll('.xp-track-label').forEach((l, i) => { if (!near(R(l).left, R(bars[i]).left)) fail(`track${ti} label${i}`); });
  });

  // 7. hero card: every row starts on the card's content edge
  const card = q('.lp-preview-card');
  const CL = R(card).left + parseFloat(getComputedStyle(card).paddingLeft);
  ['.xp-hero-eyebrow', '.xp-hero-title', '.xp-hero-narrative', '.xp-track', '.xp-hero-cta .btn'].forEach((s) => { if (!near(R(card.querySelector(s)).left, CL)) fail(`card ${s}`); });
  card.querySelectorAll('.xp-hero-meta > span').forEach((s, i) => { const x = textLeft(s.lastChild ?? s); if (x < CL - 1) fail(`card meta${i} before edge`); });

  // 8. equivalent components share geometry
  if (new Set(qa('.xp-hero-verb, .lp-badge').map((p) => Math.round(R(p).height))).size > 1) fail('pill heights');
  if (new Set(qa('.btn-lg').map((b) => Math.round(R(b).height))).size > 1) fail('btn-lg heights');
  const cta = qa('.lp-hero .lp-cta-row .btn');
  if (innerWidth >= 600 && !near(R(cta[0]).top, R(cta[1]).top)) fail('hero CTAs row');
  if (!near(R(cta[0]).left, L)) fail('hero CTA edge');

  // 9. no page-level horizontal overflow
  if (document.documentElement.scrollWidth > innerWidth) fail('overflow');

  out.pass = out.fails.length === 0;
  return out;
})();
