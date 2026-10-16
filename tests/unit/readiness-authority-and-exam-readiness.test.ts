/**
 * R-1 / R-2: the Exam Bank Readiness Engine has the last word (restricts, never extends).
 * E-1: Exam Prep reads THIS exam's Exam Readiness, not the Knowledge State.
 * F7: Exam Readiness evidence is attributed to the exam the Student sat.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { engineAllowsLaunch, type EngineReadinessView } from '@/lib/exam-bank/readiness/readiness-authority.service';
import { restrictByReadinessEngine, type ExamPreparationCapabilities } from '@/lib/exam-core/objectives/capabilities';
import { examAttemptOptionsUnderEngine, type ExamAttemptOption } from '@/lib/assessment-experience/views';
import { classifyRequirement, examReadinessEvidenceOf } from '@/lib/exam-core/objectives/preparation-plan';

const view = (o: Partial<EngineReadinessView> = {}): EngineReadinessView => ({ examVersionId: 'v', sections: ['p1', 'p2', 'p3'], practiceBySection: { p1: 'READY', p2: 'READY', p3: 'NOT_READY' }, diagnostic: 'PARTIAL', reducedMock: 'PARTIAL', fullMock: 'NOT_READY', challenge: 'NOT_READY', mockAttemptType: 'REDUCED_MOCK', reasons: {}, ...o });

describe('R-2: launch gate', () => {
  it('a complete-form mode starts only when the engine says READY (IB with P3 uncovered: no mock, no challenge)', () => {
    expect(engineAllowsLaunch(view(), 'MOCK', null)).toMatchObject({ allowed: false, reason: 'ENGINE_MOCK_PARTIAL' });
    expect(engineAllowsLaunch(view(), 'CHALLENGE', null)).toMatchObject({ allowed: false });
    expect(engineAllowsLaunch(view({ reducedMock: 'READY' }), 'MOCK', null).allowed).toBe(true);
    expect(engineAllowsLaunch(view({ reducedMock: 'READY' }), 'MOCK', null, 'FULL').allowed).toBe(false);
  });
  it('practice starts on the sections the engine does not call NOT_READY', () => {
    expect(engineAllowsLaunch(view(), 'PRACTICE', ['p1']).allowed).toBe(true);
    expect(engineAllowsLaunch(view(), 'PRACTICE', ['p3'])).toMatchObject({ allowed: false, reason: 'ENGINE_PRACTICE_NOT_READY:p3' });
  });
  it('the instance route consults the engine under ENFORCE, after its own checks', () => {
    const src = readFileSync('src/app/api/exams/instances/route.ts', 'utf8');
    expect(src).toMatch(/if \(readinessMode\(\) === 'ENFORCE'\) \{\s*const view = await engineReadinessForVersion\(level\.examVersionId\);/);
    expect(src).toMatch(/READINESS_ENGINE_NOT_READY/);
  });
});

describe('R-1: offered activities and cards say the same thing', () => {
  const caps = { objectiveKey: 'x', readiness: 'PRACTICE_READY', canSelect: true, canViewStructure: true, canPractice: true, practiceModes: [{ nodeKey: 'a', label: 'A', purpose: 'AREA_PRACTICE', lengthCoveragePercent: null }], canRunDiagnostic: true, canRunReducedMock: true, reducedMocks: [{ nodeKey: 'full', label: 'F', purpose: 'FULL_TEST', lengthCoveragePercent: 21 }], canRunFullMock: false, fullMocks: [], canUseLearningBridge: false, canPlanDiploma: false, unavailableReasons: [] } as unknown as ExamPreparationCapabilities;
  it('the engine only restricts: a mock it does not call READY is withdrawn, with the reason', () => {
    const r = restrictByReadinessEngine(caps, { anyPractice: true, reducedMock: 'PARTIAL', fullMock: 'NOT_READY' });
    expect({ reduced: r.reducedMocks.length, can: r.canRunReducedMock, practice: r.practiceModes.length }).toEqual({ reduced: 0, can: false, practice: 1 });
    expect(r.unavailableReasons).toContainEqual({ capability: 'REDUCED_MOCK', reason: 'READINESS_ENGINE_NOT_READY' });
    expect(restrictByReadinessEngine(caps, { anyPractice: true, reducedMock: 'READY', fullMock: 'READY' })).toEqual(caps);
    expect(restrictByReadinessEngine(caps, null)).toBe(caps);
  });
  it('the cards: practice per the engine; a mock only when READY and offered; a challenge only when READY', () => {
    const base: ExamAttemptOption[] = [{ type: 'EXAM_PRACTICE', available: true, reason: null }, { type: 'REDUCED_MOCK', available: false, reason: 'CONTENT_NOT_READY' }, { type: 'FULL_MOCK', available: false, reason: 'CONTENT_NOT_READY' }, { type: 'EXAM_CHALLENGE', available: true, reason: null }];
    const out = examAttemptOptionsUnderEngine(base, { anyPractice: true, reducedMock: 'READY', fullMock: 'PARTIAL', challenge: 'NOT_READY' }, { reducedMock: true, fullMock: false });
    expect(out.map((o) => [o.type, o.available, o.reason])).toEqual([['EXAM_PRACTICE', true, null], ['REDUCED_MOCK', true, null], ['FULL_MOCK', false, 'READINESS_ENGINE_NOT_READY'], ['EXAM_CHALLENGE', false, 'READINESS_ENGINE_NOT_READY']]);
  });
});

describe('E-1: this exam\'s Exam Readiness decides its own requirement status', () => {
  it('two or more independent responses: >= 0.8 STRENGTH, < 0.5 GAP, else DEVELOPING; fewer: no signal', () => {
    expect(examReadinessEvidenceOf([{ canonicalConceptId: 'c', independentAttempts: 1, meanFraction: 1, lastAt: null }], 'PAA')).toBeNull();
    expect(examReadinessEvidenceOf([{ canonicalConceptId: 'c', independentAttempts: 12, meanFraction: 1, lastAt: '2026-10-15T00:00:00Z' }], 'PAA')).toMatchObject({ classification: 'STRENGTH', sameExam: true });
    expect(examReadinessEvidenceOf([{ canonicalConceptId: 'c', independentAttempts: 4, meanFraction: 0.25, lastAt: null }], 'PAA')?.classification).toBe('GAP');
    expect(examReadinessEvidenceOf([{ canonicalConceptId: 'a', independentAttempts: 2, meanFraction: 1, lastAt: null }, { canonicalConceptId: 'b', independentAttempts: 2, meanFraction: 0.25, lastAt: null }], 'PAA')?.classification).toBe('DEVELOPING');
  });
  it('a 12/12 exam result with no learner concept is ALREADY_STRONG, no longer "Por confirmar" (F2)', () => {
    const own = examReadinessEvidenceOf([{ canonicalConceptId: 'c', independentAttempts: 12, meanFraction: 1, lastAt: null }], 'PAA');
    expect(classifyRequirement({ learningObjectiveId: 'lo', code: 'paa.topic.x', description: 'd', area: 'a', weight: 1, ownEvidence: own, concepts: [{ canonicalConceptId: 'c', name: 'n', learner: null, examEvidence: null, alsoRelevantFor: [] }] } as never).status).toBe('ALREADY_STRONG');
  });
  it('the preparation and the readiness coverage read exam_readiness_evidence of THIS exam target', () => {
    expect(readFileSync('src/lib/exam-core/objectives/preparation.service.ts', 'utf8')).toMatch(/FROM exam_readiness_evidence WHERE student_id = \$1 AND exam_target_id = \$2::uuid/);
    expect(readFileSync('src/lib/readiness/blueprint-coverage.service.ts', 'utf8')).toMatch(/reasonCodes: \['EXAM_READINESS_EVIDENCE'\]/);
  });
});

describe('F7: attribution of Exam Readiness evidence', () => {
  it('the system is the exam the Student sat (its definition family), then the instance, then the pilot certification; the target falls back to the attempt', () => {
    const src = readFileSync('src/lib/exam-readiness/exam-readiness-evidence.service.ts', 'utf8');
    expect(src).toMatch(/COALESCE\(\$5, i\.system_id, pic\.system_id\)/);
    expect(src).toMatch(/COALESCE\(i\.blueprint_bucket_id, pic\.blueprint_bucket\)/);
    expect(src).toMatch(/COALESCE\(ei\.exam_profile_id, sa\.exam_profile_id\) AS exam_target_id, d\.exam_family AS exam_system_id/);
  });
});
