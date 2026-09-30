import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LocalDateText from '@/components/ui/LocalDateText';

const root = path.join(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

/** WCAG 2.x relative luminance / contrast ratio. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('Preview certification -- dark-mode contrast of white text on brand fills (WCAG 1.4.3)', () => {
  const css = read('src/app/globals.css');
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const light = css.slice(0, darkStart);
  const dark = css.slice(darkStart, css.indexOf('\n}\n', darkStart));
  const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1] ?? '';

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('%s: --brand-fill and --brand-fill-hover give white text >= 4.5:1', (_, block) => {
    for (const name of ['--brand-fill', '--brand-fill-hover']) {
      const value = token(block(), name);
      expect(value, name).toMatch(/^#/);
      expect(contrast('#FFFFFF', value), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the primary button and the Student Tutor bubble use the fill tokens, never --brand / --brand-ink behind white text', () => {
    expect(css).toContain('.btn-primary { background: var(--brand-fill); color: #fff; }');
    expect(css).toContain('.btn-primary:hover:not(:disabled) { background: var(--brand-fill-hover); }');
    expect(css).toContain('.tt-msg--user { align-self: flex-end; background: var(--brand-fill); color: #fff; }');
    expect(css).not.toMatch(/background:\s*var\(--brand(-ink)?\);\s*color:\s*#fff/);
  });
});

describe('Preview certification -- retention dates use the Student time zone', () => {
  it('server-rendered surfaces no longer format the retention date on the server', () => {
    for (const p of [
      'src/app/dashboard/NextChallengeCard.tsx',
      'src/app/dashboard/path/[subjectId]/page.tsx',
      'src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx',
    ]) {
      const src = read(p);
      expect(src, p).toContain('<LocalDateText');
      expect(src, p).not.toMatch(/noActionRetentionWaitingBodyWithDate'\]\.replace\(/);
    }
  });

  it('fills the template with a <time> element; the hydration snapshot is the UTC date', () => {
    const html = renderToStaticMarkup(
      createElement(LocalDateText, { template: 'Disponible el {date}.', iso: '2026-10-03T04:42:19.857Z', locale: 'es' }),
    );
    expect(html).toBe('Disponible el <time dateTime="2026-10-03T04:42:19.857Z">3/10/2026</time>.');
  });

  it('the browser snapshot formats without a fixed zone (the viewer local date)', () => {
    const src = read('src/components/ui/LocalDateText.tsx');
    expect(src).toContain('() => new Date(iso).toLocaleDateString(locale),');
  });
});

describe('Preview certification -- no raw codes reach the Student', () => {
  const walk = (dir: string): string[] =>
    require('fs').readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );

  it('a concept without a label in the interface language falls back to another label, never straight to canonical_id', () => {
    const offenders = walk('src').filter((p) => read(p).includes('COALESCE(cl.label, c.canonical_id)'));
    expect(offenders).toEqual([]);
    expect(read('src/services/topic-hierarchy.service.ts')).toContain(
      'COALESCE(cl.label, (SELECT anyl.label FROM concept_localizations anyl WHERE anyl.concept_id = c.id ORDER BY anyl.language LIMIT 1), c.canonical_id)',
    );
  });

  it('exam prep never renders internal English audit strings (limitations / whatWouldImproveConfidence)', () => {
    const src = read('src/app/dashboard/exam-prep/[examProfileId]/page.tsx');
    expect(src).not.toContain('{d.whatWouldImproveConfidence}');
    expect(src).not.toContain("snapshot.limitations.join(");
    expect(src).toContain("{t['parent.fullMock']}: {t['parent.fullMock.platformNotReady']}");
  });
});
