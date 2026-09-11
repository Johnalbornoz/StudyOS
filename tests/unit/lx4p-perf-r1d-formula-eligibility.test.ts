/**
 * LX-4P-PERF-R1D R6 -- getInteractiveFormula eligibility + cache.
 *
 * The OPTIONAL widget must never cost an AI call for a concept that
 * can't benefit from one, and must generate at most once per
 * concept+language. Whole-module-mocks @/lib/db, so it is separate from
 * the source-audit suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn(), gen: vi.fn(), retrieve: vi.fn() }));

vi.mock('@/lib/db', () => ({ query: (...a: any[]) => h.query(...a) }));
vi.mock('@/services/interactive-formula.service', () => ({ generateInteractiveFormula: (...a: any[]) => h.gen(...a) }));
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => h.retrieve(...a) }));

import { getInteractiveFormula } from '@/services/concept-explanation.service';

const CONCEPT_ROW = { subject_id: 'subj1', student_id: 's1', subject_name: 'Physics', label: 'Centripetal force' };
const FORMULA = {
  latexTemplate: 'F=ma',
  latexSubstitutionTemplate: 'F={{m}}*{{a}}={{result}}',
  resultExpression: 'm*a',
  resultSymbol: 'F',
  resultUnit: 'N',
  variables: [{ symbol: 'm', label: 'm', unit: 'kg', min: 1, max: 10, step: 1, default: 2 }],
};

beforeEach(() => {
  h.query.mockReset();
  h.gen.mockReset().mockResolvedValue(FORMULA);
  h.retrieve.mockReset().mockResolvedValue({ chunks: [] });
});

it('no persisted explanation yet -> null, NO AI call', async () => {
  h.query
    .mockResolvedValueOnce({ rows: [CONCEPT_ROW], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 });
  expect(await getInteractiveFormula('s1', 'c1', 'en')).toBeNull();
  expect(h.gen).not.toHaveBeenCalled();
});

it('explanation exists but hasFormula !== true (plain conceptual content) -> null, NO AI call', async () => {
  h.query
    .mockResolvedValueOnce({ rows: [CONCEPT_ROW], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ content: JSON.stringify({ summary: 's', sections: [], examples: [] }) }], rowCount: 1 });
  expect(await getInteractiveFormula('s1', 'c1', 'en')).toBeNull();
  expect(h.gen).not.toHaveBeenCalled();
});

it('already cached in the explanation JSON -> returned directly, NO AI call', async () => {
  h.query
    .mockResolvedValueOnce({ rows: [CONCEPT_ROW], rowCount: 1 })
    .mockResolvedValueOnce({
      rows: [{ content: JSON.stringify({ summary: 's', sections: [], examples: [], hasFormula: true, interactiveFormula: FORMULA }) }],
      rowCount: 1,
    });
  expect(await getInteractiveFormula('s1', 'c1', 'en')).toEqual(FORMULA);
  expect(h.gen).not.toHaveBeenCalled();
});

it('eligible + not cached -> generates once, persists it back (merge)', async () => {
  h.query
    .mockResolvedValueOnce({ rows: [CONCEPT_ROW], rowCount: 1 })
    .mockResolvedValueOnce({
      rows: [{ content: JSON.stringify({ summary: 's', sections: [], examples: [], hasFormula: true, formulaHint: 'F=ma' }) }],
      rowCount: 1,
    })
    .mockResolvedValueOnce({ rowCount: 1 });
  const out = await getInteractiveFormula('s1', 'c1', 'en');
  expect(out).toEqual(FORMULA);
  expect(h.gen).toHaveBeenCalledTimes(1);
  const updateCall = h.query.mock.calls.find((c) => /UPDATE concept_explanations/.test(c[0]));
  expect(updateCall).toBeTruthy();
  expect(JSON.parse(updateCall![1][2]).interactiveFormula).toEqual(FORMULA);
});

it("a foreign student's concept -> FORBIDDEN, NO AI call", async () => {
  h.query.mockResolvedValueOnce({ rows: [{ ...CONCEPT_ROW, student_id: 'other' }], rowCount: 1 });
  await expect(getInteractiveFormula('s1', 'c1', 'en')).rejects.toThrow('FORBIDDEN');
  expect(h.gen).not.toHaveBeenCalled();
});

it('a missing concept -> CONCEPT_NOT_FOUND', async () => {
  h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  await expect(getInteractiveFormula('s1', 'c1', 'en')).rejects.toThrow('CONCEPT_NOT_FOUND');
});
