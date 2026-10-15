import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import { preparationChooserLabels } from '@/lib/i18n/preparation-chooser-labels';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';

const src = readFileSync('src/app/dashboard/exam-prep/ObjectivePicker.tsx', 'utf8');
const literalKeys = [...new Set([...src.matchAll(/l\['([a-zA-Z0-9_.]+)'\]/g)].map((m) => m[1]))];

describe('F6: every page that renders the preparation chooser gives it every label it reads', () => {
  it.each(['es', 'en'] as const)('%s: the literal keys and the Cambridge family card keys resolve', (lang) => {
    const l = preparationChooserLabels(getMessages(lang) as unknown as Record<string, string>);
    expect(literalKeys.filter((k) => !(k in l))).toEqual([]);
    for (const k of ['acp.prep.chooseProgramme', 'acp.prep.programmes', 'acp.prep.family.CAMBRIDGE', 'acp.prep.familyDesc.CAMBRIDGE']) expect(l[k], k).toBeTruthy();
  });
  it('both pages build the chooser labels through the one helper (no hand-written filter)', () => {
    for (const p of ['src/app/dashboard/exams/page.tsx', 'src/app/dashboard/exam-prep/page.tsx']) expect(readFileSync(p, 'utf8')).toMatch(/const prepLabels: Record<string, string> = preparationChooserLabels\(/);
    expect(EXAM_FAMILIES).toContain('CAMBRIDGE');
  });
});
