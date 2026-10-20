/**
 * Cambridge 9709 Paper 1 pilot: 8/8 OFFICIAL sections governed through explicit correspondences, a certified
 * classification of one position per section, StudyUs-original deterministic supply in every bucket, worded with the
 * syllabus's own command words, scored with the canonical contract. Pure.
 */
import { describe, expect, it } from 'vitest';
import { LIBRARY_BLUEPRINT_CIE_9709_P1, LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { CIE_9709_COMMAND_WORDS } from '@/lib/assessment-instance/active-configuration-binding';
import { PLANNING_BANDS } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { CIE_9709_P1_SECTIONS } from '@/lib/curriculum/cambridge/cie-9709-p1-correspondence';
import { resolveApplicability, EA1_APPLICABILITY_THRESHOLD } from '@/lib/assessment-adaptation/assessment-applicability';
import { bankProjectionFor, scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';
import { CAMBRIDGE_9709_AS_V2 } from '@/lib/exam-core/verticals/v2/cambridge-9709';
import { objectiveForConfig } from '@/lib/exam-core/objectives/objective-catalog';

const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
const A1 = LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === 'CIE-9709-P1-A1')!;
const certified = A1.entries.flatMap((e) => PLANNING_BANDS.flatMap((band) => certifyCell(e, e.targets[0], band, 10, g, A1.batchId).certified));
const sectionOf = (bucketId: string) => /\/(cie\.9709\.p1\.[a-z-]+)#0$/.exec(bucketId)![1];

describe('CAMBRIDGE 9709 P1 pilot', () => {
  it('8/8 official sections, each with an explicit PILOT correspondence; 1.3 / 1.4 reuse neutral identities with the locale mismatch recorded', () => {
    expect(CIE_9709_P1_SECTIONS.map((s) => `${s.section} ${s.title}`)).toEqual(['1.1 Quadratics', '1.2 Functions', '1.3 Coordinate geometry', '1.4 Circular measure', '1.5 Trigonometry', '1.6 Series', '1.7 Differentiation', '1.8 Integration']);
    for (const s of CIE_9709_P1_SECTIONS) {
      expect(s.sectionScope.length, s.section).toBeGreaterThan(0);
      for (const c of s.concepts) {
        const r = PUBLICATION_APPLICABILITY.find((x) => x.concept.stableId === c.stableId && x.scope.componentId === 'CAMBRIDGE.9709.P1')!;
        expect(resolveApplicability(PUBLICATION_APPLICABILITY, r.concept, r.scope, EA1_APPLICABILITY_THRESHOLD).status, `${s.section} ${c.stableId}`).toBe('ESTABLISHED');
      }
    }
    const cross = CIE_9709_P1_SECTIONS.flatMap((s) => s.concepts.filter((c) => c.correspondenceType === 'CROSS_CURRICULUM_CANONICAL_IDENTITY').map((c) => [s.section, c.stableId, c.labelLocaleMismatch, c.crossLanguageIdentityReview]));
    expect(cross).toEqual([['1.2', 'math.fun.functions', true, 'PENDING'], ['1.3', 'math.geo.coordinate-plane', true, 'PENDING'], ['1.3', 'math.fun.linear-functions-lines', true, 'PENDING'], ['1.4', 'math.geo.circles', true, 'PENDING']]);
  });
  it('the classification is automated-pilot certified: 8 buckets, one position each, adapter CAMBRIDGE.9709.P1', () => {
    const d = g.blueprints.find((x) => x.objectId === LIBRARY_BLUEPRINT_CIE_9709_P1.blueprintId && x.objectVersion === LIBRARY_BLUEPRINT_CIE_9709_P1.classificationVersion)!;
    expect({ state: d.state, failed: d.failed, human: d.humanApproval }).toEqual({ state: 'AUTOMATED_CERTIFIED_PILOT', failed: [], human: null });
    expect(LIBRARY_BLUEPRINT_CIE_9709_P1.buckets.map((b) => [b.bucket.objectiveCode, b.governedPositions])).toEqual(CIE_9709_P1_SECTIONS.map((s) => [s.objectiveCode, 1]));
    expect(CAMBRIDGE_9709_AS_V2.sections[0].objectives.map((o) => o.code)).toEqual(CIE_9709_P1_SECTIONS.map((s) => s.objectiveCode));
  });
  it('certified supply in every bucket; every prompt uses a 9709 command word, never "find"', () => {
    const by: Record<string, number> = {};
    for (const i of certified) {
      by[sectionOf(i.bucketId)] = (by[sectionOf(i.bucketId)] ?? 0) + 1;
      expect({ state: i.certificationState, format: i.format, adapter: i.adapterId }).toEqual({ state: 'AUTOMATED_CERTIFIED_PILOT', format: 'SHORT_RESPONSE', adapter: 'CAMBRIDGE.9709.P1' });
      expect(bankProjectionFor(i)).toEqual({ version: 'exam-bank-projection-3', refusal: null });
      const prompt = i.learner.prompt.toLowerCase();
      expect(CIE_9709_COMMAND_WORDS.some((w) => prompt.includes(`${w} `)), i.learner.prompt).toBe(true);
      expect(/\bfind\b/.test(prompt), i.learner.prompt).toBe(false);
    }
    expect(Object.keys(by).sort()).toEqual(CIE_9709_P1_SECTIONS.map((s) => s.objectiveCode).sort());
    expect(Math.min(...Object.values(by))).toBeGreaterThan(0);
    expect(certified).toHaveLength(237);
  });
  it('the Exam Core scores one item of every section: key full marks, a modelled misconception 0', async () => {
    for (const e of A1.entries) {
      const i = certified.find((x) => x.coreId === e.core.constructFamilyId)!;
      const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: scoringBankContentOf(i) })!;
      expect((await gradeExamItem(item, i.key.answers[0], 'en')).evaluation.score, i.coreId).toBe(i.marks);
      const params = (e.construct as any).enumerate(i.difficultyBand === 'LOW' ? 'FOUNDATIONAL' : i.difficultyBand === 'MEDIUM' ? 'STANDARD' : 'CHALLENGE').find((p: any) => i.recognitionId.endsWith(`|${e.construct.recognitionKey(p)}`));
      const wrong = e.construct.misconceptionAnswers(params).find((m) => m.value !== null)!.value!;
      expect((await gradeExamItem(item, wrong.d === 1 ? String(wrong.n) : `${wrong.n}/${wrong.d}`, 'en')).evaluation.score, `${i.coreId} misconception`).toBe(0);
    }
  });
  it('the Cambridge objective is its own, not the AICE one (no equivalence inferred)', () => {
    expect(objectiveForConfig('v2.cambridge.9709-as')?.key).toBe('cie.asal.cambridge.9709.as');
    expect(objectiveForConfig('v2.aice.9709-as')?.configKeys).toEqual(['v2.aice.9709-as']);
  });
});
