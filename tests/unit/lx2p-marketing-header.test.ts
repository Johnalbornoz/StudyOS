/**
 * LX-2P -- the public marketing top navigation was cramped on narrow
 * screens. Root cause: the header used an undefined spacing token
 * (`--space-5`), which collapses padding/gap to nothing, and it never
 * allowed the nav to wrap. The repair moves the header onto its own
 * `.mkt-header` / `.mkt-nav` classes that wrap and shrink below 600px.
 * Verified in a browser: no horizontal overflow at 320 / 375 / 768 /
 * 1440, single row from 768px up, nav wraps to its own row below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const layout = readFileSync(join(process.cwd(), 'src/app/[locale]/layout.tsx'), 'utf-8');
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf-8');

describe('LX-2P marketing header responsiveness', () => {
  it('the header no longer depends on the undefined --space-5 token', () => {
    const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
    expect(header).not.toMatch(/--space-5/);
  });

  it('the header and nav use dedicated responsive classes', () => {
    expect(layout).toMatch(/<header className="mkt-header"/);
    expect(layout).toMatch(/<nav className="mkt-nav"/);
  });

  it('.mkt-header wraps and .mkt-nav is defined', () => {
    const rule = css.slice(css.indexOf('.mkt-header {'), css.indexOf('.mkt-header {') + 260);
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.mkt-nav\s*\{/);
  });

  it('there is a narrow-screen breakpoint that tightens the header', () => {
    const mq = css.slice(css.indexOf('/* ---------- LX-2P: responsive marketing header'));
    expect(mq).toMatch(/@media \(max-width:\s*600px\)/);
    // nav takes the full row and its buttons shrink at the small breakpoint
    expect(mq).toMatch(/\.mkt-nav\s*\{[^}]*width:\s*100%/);
  });

  it('the marketing nav still exposes How-it-works, sign-in and sign-up', () => {
    const nav = layout.slice(layout.indexOf('<nav className="mkt-nav"'), layout.indexOf('</nav>'));
    expect(nav).toMatch(/how-it-works/);
    expect(nav).toMatch(/\/sign-in/);
    expect(nav).toMatch(/\/sign-up/);
  });
});
