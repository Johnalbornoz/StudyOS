/**
 * IB_EXISTING_30_COMPATIBLE: the Content Factory re-projection of the 30 certified IB quadratic instances, assessed
 * semantic by semantic against the immutable certified source. Pure.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { CertifiedInstance } from '@/lib/assessment-instance/v52';
import { assessReprojection, ruleTypeOfCriterion } from '@/lib/exam-bank/ib-reprojection-compatibility';

const read = (rel: string) => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'));
const SUPPLY = read('docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json') as { rows: any[] };
const SPEC = read('docs/exams/content-factory/CF-IB-AAHL-01/IB_30_REPROJECTION_SPEC.json') as { specs: any[] };
const source = (row: any): CertifiedInstance => ({
  instanceId: row.itemInstanceId, systemId: 'IB', marks: row.content.marks, rubric: row.content.rubric, responsePolicy: row.content.response.policy,
  key: { answers: row.content.response.key, correctOption: null, distractorRationales: {}, distractorLineage: {} },
  learner: { language: 'en', itemType: row.content.itemType, stimulus: null, prompt: row.content.question, parts: [], options: [], marks: row.content.marks, conditions: { calculator: 'NONE', workingShown: true } },
} as unknown as CertifiedInstance);
const IB = SUPPLY.rows.filter((r) => r.content.lineage.systemId === 'IB');
const results = SPEC.specs.map((s) => assessReprojection(source(IB.find((r) => r.itemInstanceId === s.instanceId)), s));

describe('the 30 certified IB instances vs the proposed re-projection', () => {
  it('every spec names a certified source instance; the sources are the 30', () => {
    expect(SPEC.specs).toHaveLength(30);
    expect(new Set(SPEC.specs.map((s) => s.instanceId))).toEqual(new Set(IB.map((r) => r.itemInstanceId)));
  });
  it('preserved: rubric, marks, answer values; every method point is expressed by a form-aware rule that refuses a restatement', () => {
    for (const r of results) for (const sem of ['RUBRIC_IDENTICAL', 'MARKS_PRESERVED', 'ANSWER_VALUES_PRESERVED', 'METHOD_POINTS_EXPRESSIBLE'] as const) {
      expect(r.checks.find((c) => c.semantic === sem), `${r.instanceId} ${sem}`).toMatchObject({ preserved: true });
    }
    expect(results.reduce((n, r) => n + r.rules.length, 0)).toBe(50); // 30 solution-method points + 20 rearrangement points
  });
  it('NOT preserved: the response structure (ordered parts vs any order) and the learner content (new parts) -> 0/30 compatible', () => {
    for (const r of results) {
      expect(r.checks.find((c) => c.semantic === 'RESPONSE_STRUCTURE_PRESERVED')?.preserved).toBe(false);
      expect(r.checks.find((c) => c.semantic === 'LEARNER_CONTENT_PRESERVED')?.preserved).toBe(false);
      expect(r.compatible).toBe(false);
    }
    expect(results.filter((r) => r.compatible)).toHaveLength(0);
  });
  it('the criterion -> rule mapping is governed text, not a guess', () => {
    expect(ruleTypeOfCriterion('Rearranges to x² − 5x − 6 = 0.')).toBe('REARRANGE_TO_STANDARD_FORM');
    expect(ruleTypeOfCriterion('Applies a valid method to the equation in standard form (for example factorising)')).toBe('QUADRATIC_SOLUTION_METHOD');
    expect(ruleTypeOfCriterion('Shows that the result is positive.')).toBeNull();
  });
});
