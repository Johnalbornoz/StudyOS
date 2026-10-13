/**
 * AD_HOC with a time limit (Track B P0.5).
 *
 * A generated item had no duration, so a Student's time limit could never be fitted: every candidate was
 * "duration unknown" and the assessment refused to start. A generated item now carries its nominal response
 * time (assessment-foundation/nominal-response-time), so the Blueprint Core can fit the limit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type LearningCacheItemRow, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { nominalResponseSeconds } from '@/lib/assessment-foundation/nominal-response-time';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import { projectEvidenceNeeds, solveLearningBlueprint, type EvidenceCountPolicy } from '@/lib/assessment-blueprint';
import { freezeAssessment } from '@/lib/assessment-execution';
import { learningActivityFor } from '@/lib/assessment-execution/assessment-execution.service';
import { AD_HOC_EXAM_INTENT, AD_HOC_EXAM_MINUTES } from '@/lib/assessment-experience/ad-hoc-exam';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-13T12:00:00.000Z';
const canonical = (canonicalConceptId: string): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId: `lc-${canonicalConceptId}`, canonicalConceptId, basis: 'CREATED_FROM_CANONICAL' });
const generated = (id: string, concept: string, over: Partial<LearningCacheItemRow> = {}): QuestionCoverage =>
  coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PROVE', questionType: 'step_by_step', difficulty: 5, language: 'es', validationStatus: 'VALIDATED', identity: canonical(concept), ...over });
const solve = (concepts: string[], pool: QuestionCoverage[], availableMinutes: number | null, depth: 'QUICK' | 'BALANCED' | 'DEEP' = 'BALANCED') =>
  solveLearningBlueprint({ policy: { studentId: STUDENT, intent: AD_HOC_EXAM_INTENT, depth, canonicalConceptIds: concepts, needs: projectEvidenceNeeds(concepts, [], POLICY, AS_OF), availableMinutes }, coverages: pool, asOf: AS_OF });

const POOL = ['K1', 'K2'].flatMap((k) => [generated(`${k}-a`, k), generated(`${k}-b`, k, { questionType: 'error_detection' }), generated(`${k}-c`, k, { questionType: 'multiple_choice' }), generated(`${k}-d`, k, { questionType: 'numeric_problem' })]);

describe('nominal response time of a generated item', () => {
  it('is stated from the item\'s own type and difficulty, in steps of 15 seconds', () => {
    expect(nominalResponseSeconds('multiple_choice', 3)).toBe(60);
    expect(nominalResponseSeconds('multiple_choice', 1)).toBe(45);
    expect(nominalResponseSeconds('step_by_step', 5)).toBe(270);
    expect(nominalResponseSeconds('true_false', 1)).toBe(30);
    // a type the table does not name is planned as an open response
    expect(nominalResponseSeconds('some_new_type', 3)).toBe(120);
    for (const type of ['multiple_choice', 'short_answer', 'case_study']) {
      // never shorter as the difficulty rises, and the hardest is longer than the easiest
      for (let d = 1; d < 5; d += 1) expect(nominalResponseSeconds(type, d + 1)!).toBeGreaterThanOrEqual(nominalResponseSeconds(type, d)!);
      expect(nominalResponseSeconds(type, 5)!).toBeGreaterThan(nominalResponseSeconds(type, 1)!);
    }
  });

  it('assumes nothing when the type or the difficulty is not recorded', () => {
    expect(nominalResponseSeconds(null, 3)).toBeNull();
    expect(nominalResponseSeconds('multiple_choice', null)).toBeNull();
    expect(nominalResponseSeconds('multiple_choice', 9)).toBeNull();
  });

  it('belongs to generated items only: a Certified Exam Bank item never reads it', () => {
    const coverage = readFileSync(join(process.cwd(), 'src/lib/assessment-foundation/question-coverage.ts'), 'utf-8');
    expect(coverage.match(/nominalResponseSeconds\(/g)).toHaveLength(1);
    const reviewed = coverage.slice(coverage.indexOf('export function coverageOfReviewedBankItem'), coverage.indexOf('export function coverageOfLearningCacheItem'));
    expect(reviewed).not.toContain('nominalResponseSeconds');
    expect(reviewed).toContain('estimatedSeconds: UNKNOWN');
    const policy = readFileSync(join(process.cwd(), 'src/lib/assessment-foundation/nominal-response-time.ts'), 'utf-8');
    expect(policy).not.toMatch(/exam-core|question-bank|approved_items/);
    void coverageOfReviewedBankItem;
  });
});

describe('AD_HOC with a time limit', () => {
  it('every time limit the Student can choose fits a complete assessment of generated items', () => {
    for (const minutes of AD_HOC_EXAM_MINUTES) {
      const s = solve(['K1', 'K2'], POOL, minutes);
      expect(s.outcome.status).toBe('READY');
      expect(s.outcome.unmet).toEqual([]);
      expect(s.outcome.estimatedSeconds).not.toBeNull();
      expect(s.outcome.estimatedSeconds!).toBeLessThanOrEqual(minutes * 60);
      expect(s.result.estimate.minutes).not.toBeNull();
    }
  });

  it('the limit is a hard budget: the selection is never longer than it, and what does not fit is named as time, not as missing questions', () => {
    const free = solve(['K1', 'K2'], POOL, null, 'DEEP');
    const tight = solve(['K1', 'K2'], POOL, 2, 'DEEP');
    expect(tight.outcome.estimatedSeconds ?? 0).toBeLessThanOrEqual(120);
    expect(tight.outcome.selected.length).toBeLessThan(free.outcome.selected.length);
    expect(tight.outcome.unmet.length).toBeGreaterThan(0);
    expect(tight.outcome.unmet.every((u) => u.cause === 'TIME_BUDGET')).toBe(true);
    expect(tight.outcome.unmet.some((u) => u.cause === 'DURATION_UNKNOWN')).toBe(false);
  });

  it('the frozen assessment records each item\'s planned time, and it is the same assessment on a second solve', () => {
    const s = solve(['K1', 'K2'], POOL, 30);
    const freeze = () => freezeAssessment({ solution: solve(['K1', 'K2'], POOL, 30), coverages: POOL, studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', intent: AD_HOC_EXAM_INTENT, activity: learningActivityFor(s.requirement!.evidence!.activityType, AD_HOC_EXAM_INTENT) });
    const f = freeze();
    expect(f.items.length).toBeGreaterThan(0);
    expect(f.items.every((i) => typeof i.estimatedSeconds === 'number' && i.estimatedSeconds > 0)).toBe(true);
    expect(f.items.reduce((sum, i) => sum + (i.estimatedSeconds ?? 0), 0)).toBeLessThanOrEqual(30 * 60);
    expect(freeze().items.map((i) => i.key)).toEqual(f.items.map((i) => i.key));
  });

  it('an item that records no difficulty still cannot be fitted to a limit: nothing is assumed for it', () => {
    const s = solve(['K1'], [generated('x', 'K1', { difficulty: null })], 30);
    expect(s.outcome.selected).toEqual([]);
    expect(s.outcome.unmet.every((u) => u.cause === 'DURATION_UNKNOWN')).toBe(true);
  });
});
