/**
 * LX-2P -- the authenticated shell drawer is aria-modal, so it must
 * contain keyboard focus while open and hand focus back to its trigger
 * on close. The test suite runs in a `node` environment with no DOM, so
 * these are source-level invariants: they lock the focus-trap contract
 * against regression. Runtime behaviour was verified in a browser at
 * 375px (initial focus enters the drawer; Tab / Shift+Tab wrap at the
 * boundaries; focus that escapes is pulled back; Escape closes and
 * restores focus to the menu button; the keydown listener and the body
 * scroll-lock are both cleaned up).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/app/dashboard/LearnerShell.tsx'), 'utf-8');
// the body of the effect that runs while the drawer is open
const openEffect = src.slice(src.indexOf('document.body.style.overflow'), src.indexOf('const logo ='));

describe('LX-2P LearnerShell drawer focus containment', () => {
  it('declares the drawer as a modal dialog wired to its trigger', () => {
    expect(src).toMatch(/id="lx-drawer"/);
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/aria-controls="lx-drawer"/);
    // the dialog itself must be focusable as the initial-focus fallback
    expect(src).toMatch(/id="lx-drawer"[^>]*tabIndex=\{-1\}/);
  });

  it('moves focus into the drawer when it opens', () => {
    expect(openEffect).toMatch(/focusables\(\)\[0\][\s\S]*\)\?\.focus\(\)/);
  });

  it('intercepts Tab to keep focus inside the drawer', () => {
    expect(openEffect).toMatch(/addEventListener\('keydown'/);
    expect(openEffect).toMatch(/e\.key !== 'Tab'/);
    // forward wrap: at the last element (or if focus escaped) go to first
    expect(openEffect).toMatch(/active === last \|\| !drawer\?\.contains\(active\)/);
    expect(openEffect).toMatch(/first\.focus\(\)/);
    // backward wrap: at the first element (or if focus escaped) go to last
    expect(openEffect).toMatch(/active === first \|\| !drawer\?\.contains\(active\)/);
    expect(openEffect).toMatch(/last\.focus\(\)/);
    // the browser default must be suppressed on every wrap
    expect(openEffect).toMatch(/e\.preventDefault\(\)/);
  });

  it('locks body scroll while open and restores it on close', () => {
    expect(openEffect).toMatch(/document\.body\.style\.overflow = 'hidden'/);
    expect(openEffect).toMatch(/document\.body\.style\.overflow = ''/);
  });

  it('cleans up the listener and returns focus to the menu button on close', () => {
    const cleanup = openEffect.slice(openEffect.indexOf('return () =>'));
    expect(cleanup).toMatch(/removeEventListener\('keydown'/);
    expect(cleanup).toMatch(/menuBtnRef\.current\?\.focus\(\)/);
  });

  it('closes on Escape', () => {
    expect(openEffect).toMatch(/e\.key === 'Escape'[\s\S]*setOpen\(false\)/);
  });
});
