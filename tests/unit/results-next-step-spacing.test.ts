/**
 * RESULTS_NEXT_STEP_SPACING -- the "Tu siguiente paso" card had no inner
 * padding: `padding: var(--space-5)` referenced an undefined token, which
 * is invalid at computed-value time and dropped the .card padding to 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const css = read('src/app/globals.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(f)) out.push(p);
  }
  return out;
}

describe('spacing tokens', () => {
  it('every var(--space-N) used anywhere in src is defined', () => {
    const used = new Set<string>();
    for (const f of walk(join(process.cwd(), 'src'))) {
      for (const m of readFileSync(f, 'utf-8').matchAll(/var\(--(space-\d+)\)/g)) used.add(m[1]);
    }
    const missing = [...used].filter((t) => !new RegExp(`--${t}:\\s*\\d+px;`).test(css));
    expect(missing).toEqual([]);
  });

  it('the scale stays monotonic (5 between 4 and 6)', () => {
    const px = (t: string) => Number(new RegExp(`--${t}:\\s*(\\d+)px;`).exec(css)![1]);
    expect(px('space-4')).toBeLessThan(px('space-5'));
    expect(px('space-5')).toBeLessThan(px('space-6'));
  });
});

describe('"Tu siguiente paso" card', () => {
  const quiz = read('src/app/dashboard/quiz/page.tsx');

  it('uses the same inner padding as the standard card ("Ya tienes la idea" = .card, var(--space-6)) and separates label and message', () => {
    expect(css).toMatch(/\.card \{[^}]*padding: var\(--space-6\);/);
    // UX-3: a .card (inner padding var(--space-6)) laid out by .ls-panel,
    // whose gap separates the label from the message.
    expect(quiz).toMatch(/<section className="card ls-panel ls-next" data-testid="results-next-step" aria-labelledby="ls-next-title">\s*<p id="ls-next-title" className="ls-panel-label">\{at\['quiz\.canonicalNextStepTitle'\]\}<\/p>/);
    expect(css).toMatch(/\.ls-panel \{ display: flex; flex-direction: column; gap: var\(--space-3\); \}/);
    // desktop: the panel never overrides .card padding (phones share one learning-card rule)
    expect(css).not.toMatch(/^\.ls-panel[^{]*\{[^}]*padding/m);
  });

  it('the equivalent Results card (transfer result) gets the same spacing', () => {
    expect(quiz).toMatch(/<section className="card ls-panel" aria-labelledby="ls-transfer-breakdown">\s*<p id="ls-transfer-breakdown" className="ls-panel-label">\{at\['quiz\.transferResultTitle'\]\}/);
  });
});
