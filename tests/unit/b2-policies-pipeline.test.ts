/**
 * B2 -- the three policy families over the one solver, through the real B1 contracts (QuestionCoverage,
 * QuestionEligibility, BlueprintRequirement / BlueprintResult). Pure; no database.
 */
import { describe, it, expect } from 'vitest';
import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type LearningCacheItemRow, type QuestionCoverage, type ReviewedBankItemRow } from '@/lib/assessment-foundation/question-coverage';
import { BlueprintRequirementSchema, BlueprintResultSchema } from '@/lib/assessment-foundation/blueprint-contract';
import { examGapCandidateFrom, type ExamGapCandidate } from '@/lib/assessment-foundation/exam-gap-candidate';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import type { AssembledForm, FormPosition } from '@/lib/exam-core/form-assembly';
import { CANONICAL_POLICY } from '@/lib/pedagogical-engine/policy';
import {
  activitySemanticsOf,
  buildExamPreparationBlueprint,
  buildLearningBlueprint,
  buildOfficialBlueprint,
  compareWithAssembledForm,
  eligibleSolverCandidates,
  EXAM_PREPARATION_WEIGHTS,
  officialAttemptDecision,
  projectEvidenceNeed,
  projectEvidenceNeeds,
  resolveLearningTargets,
  solveExamPreparationBlueprint,
  solveLearningBlueprint,
  solveOfficialBlueprint,
  urgencyWeight,
  type EvidenceCountPolicy,
  type LearnerConceptState,
} from '@/lib/assessment-blueprint';

const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-10T12:00:00.000Z';
const STUDENT = 'stu-1';

const canonical = (canonicalConceptId: string, learnerConceptId = `lc-${canonicalConceptId}`): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId, canonicalConceptId, basis: 'CREATED_FROM_CANONICAL' });

/** A Student's validated cached learning question on one concept (PRIMARY), optionally also covering others. */
function cached(id: string, concept: string, over: Partial<LearningCacheItemRow> = {}, also: Array<[string, 'PRIMARY' | 'SUPPORTING']> = []): QuestionCoverage {
  const c = coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: canonical(concept), ...over });
  return { ...c, concepts: [...c.concepts, ...also.map(([canonicalConceptId, role]) => ({ canonicalConceptId, role, basis: 'ITEM_ATTRIBUTION' as const }))] };
}

/** A reviewed, student-deliverable bank item of exam version ev-1. */
function bank(id: string, objective: string, over: Partial<ReviewedBankItemRow> = {}): QuestionCoverage {
  return coverageOfReviewedBankItem({
    approvedItemId: id,
    learningObjectiveId: objective,
    questionType: 'multiple_choice',
    content: { difficulty: 3, marks: 1, language: 'es' },
    status: 'PUBLISHED',
    bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'],
    examAlignment: 'MOCK_READY',
    calibrationConfidence: 'INSUFFICIENT_DATA',
    contentOrigin: 'GENERATED',
    sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' },
    sourceLicenses: [],
    humanReviewDecisions: 1,
    scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' },
    objectiveConcepts: [{ canonicalConceptId: `c-of-${objective}`, relationType: 'FULL' }],
    ...over,
  });
}
const timed = (c: QuestionCoverage, seconds: number): QuestionCoverage => ({ ...c, estimatedSeconds: { state: 'KNOWN', value: seconds } });

const state = (canonicalConceptId: string, over: Partial<LearnerConceptState> = {}): LearnerConceptState => ({ canonicalConceptId, learnerConceptId: `lc-${canonicalConceptId}`, masteryState: null, validationReadiness: null, evidenceCount: null, independentEvidenceCount: null, nextReviewAt: null, ...over });
const STRONG = { masteryState: 'VALIDATED_MASTERY' as const, validationReadiness: 'READY' as const, evidenceCount: 6, independentEvidenceCount: 3 };

const ids = (s: { outcome: { selected: Array<{ question: { id: string } }> } }) => s.outcome.selected.map((x) => x.question.id).sort();
const reverse = <T>(l: readonly T[]) => [...l].reverse();

/* ------------------------------------------------------------------ */

describe('B2 evidence need -- a projection of the canonical policy, not a second one', () => {
  it('deficits are the canonical minimums minus the canonical counts', () => {
    expect(projectEvidenceNeed(state('C1'), POLICY, AS_OF)).toMatchObject({ level: 'NO_EVIDENCE', evidenceDeficit: 3, independentDeficit: 2, priority: 4 });
    expect(projectEvidenceNeed(state('C1', { masteryState: 'LEARNING', evidenceCount: 1, independentEvidenceCount: 0 }), POLICY, AS_OF)).toMatchObject({ level: 'WEAK', evidenceDeficit: 2, independentDeficit: 2 });
    expect(projectEvidenceNeed(state('C1', STRONG), POLICY, AS_OF)).toMatchObject({ level: 'STRONG', evidenceDeficit: 0, independentDeficit: 0, priority: 1 });
    expect(projectEvidenceNeed(state('C1', { ...STRONG, masteryState: 'PROVISIONAL_MASTERY', independentEvidenceCount: 1 }), POLICY, AS_OF)).toMatchObject({ level: 'DEVELOPING', independentDeficit: 1 });
  });

  it('the thresholds are read from the policy row: change the row and the need changes, with no constant here', () => {
    const stricter: EvidenceCountPolicy = { version: 2, minimumEvidenceCount: 5, minimumIndependentEvidenceCount: 4 };
    const n = projectEvidenceNeed(state('C1', { masteryState: 'DEVELOPING', evidenceCount: 3, independentEvidenceCount: 2 }), stricter, AS_OF);
    expect(n).toMatchObject({ evidenceDeficit: 2, independentDeficit: 2, basis: { policyVersion: 2 } });
  });

  it('retention is due only from the canonical readiness + review date, against an explicit asOf', () => {
    const waiting = { ...STRONG, validationReadiness: 'WAITING_FOR_RETENTION' as const };
    expect(projectEvidenceNeed(state('C1', { ...waiting, nextReviewAt: '2026-10-01T00:00:00.000Z' }), POLICY, AS_OF)).toMatchObject({ retentionDue: true, priority: 2 });
    expect(projectEvidenceNeed(state('C1', { ...waiting, nextReviewAt: '2026-11-01T00:00:00.000Z' }), POLICY, AS_OF)).toMatchObject({ retentionDue: false, priority: 1 });
  });

  it('a concept with no recorded state is NO_EVIDENCE; nothing is invented for it', () => {
    const needs = projectEvidenceNeeds(['C2', 'C1', 'C1'], [state('C1', STRONG)], POLICY, AS_OF);
    expect(needs.map((n) => [n.canonicalConceptId, n.level, n.learnerConceptId])).toEqual([['C1', 'STRONG', 'lc-C1'], ['C2', 'NO_EVIDENCE', null]]);
    expect(needs[1].basis).toEqual({ masteryState: null, validationReadiness: null, evidenceCount: null, independentEvidenceCount: null, policyVersion: 1 });
  });
});

describe('B2 LEARNING -- the selection adapts to the learner, through the shared solver', () => {
  const pool = [cached('a1', 'C1'), cached('a2', 'C1', { questionType: 'short_answer', difficulty: 4 }), cached('b1', 'C2'), cached('b2', 'C2', { questionType: 'short_answer', difficulty: 4 })];
  const solve = (states: LearnerConceptState[], over: Partial<Parameters<typeof buildLearningBlueprint>[0]> = {}, coverages: QuestionCoverage[] = pool) =>
    solveLearningBlueprint({ policy: { studentId: STUDENT, intent: 'CUSTOM_CONCEPT_PRACTICE', depth: 'BALANCED', canonicalConceptIds: ['C1', 'C2'], needs: projectEvidenceNeeds(['C1', 'C2'], states, POLICY, AS_OF), ...over }, coverages, asOf: AS_OF });

  it('Student A and Student B, same targets and bank, get different selections', () => {
    const a = solve([state('C1', STRONG)]);
    const b = solve([state('C2', STRONG)]);
    expect(a.outcome.status).toBe('READY');
    expect(b.outcome.status).toBe('READY');
    const per = (s: typeof a) => [ids(s).filter((id) => id.startsWith('a')).length, ids(s).filter((id) => id.startsWith('b')).length];
    // A is strong on C1: one look at C1, two opportunities on C2. B is the mirror image.
    expect(per(a)).toEqual([1, 2]);
    expect(per(b)).toEqual([2, 1]);
    expect(ids(a)).not.toEqual(ids(b));
    expect(a.snapshot.learnerEvidence!.digest).not.toBe(b.snapshot.learnerEvidence!.digest);
  });

  it('a mastered concept the Student chose stays in scope: state changes how much, never whether', () => {
    const s = solve([state('C1', STRONG), state('C2', STRONG)]);
    expect(s.outcome.status).toBe('READY');
    expect(s.result.coverage.canonicalConceptIds).toEqual(['C1', 'C2']);
    expect(s.outcome.selected).toHaveLength(2);
  });

  it('the requirement is the B1 contract, states no count, and the count is the result', () => {
    const s = solve([]);
    expect(() => BlueprintRequirementSchema.parse(s.requirement)).not.toThrow();
    expect(() => BlueprintResultSchema.parse(s.result)).not.toThrow();
    expect(s.requirement).toMatchObject({ family: 'LEARNING', evidence: { itemCount: null, activityType: 'PRACTICE' } });
    expect(s.result.estimate.items).toBe(s.outcome.selected.length);
    expect(s.result.estimate.minutes).toBeNull();
    expect(s.snapshot).toMatchObject({ family: 'LEARNING', depth: 'BALANCED', targets: ['CONCEPT:C1', 'CONCEPT:C2'], status: 'READY', learnerEvidence: { asOf: AS_OF } });
  });

  it('activity semantics come from the canonical pedagogical policy', () => {
    expect(activitySemanticsOf('CONCEPT_PRACTICE')).toMatchObject({ activityType: 'PRACTICE', independence: CANONICAL_POLICY.practice.independenceRequired, difficulty: CANONICAL_POLICY.practice.difficulty });
    expect(activitySemanticsOf('MASTERY_CHECK')).toMatchObject({ activityType: 'PROVE', independence: CANONICAL_POLICY.prove.independenceRequired, minimumScorePercent: CANONICAL_POLICY.prove.minimumScorePercent });
    expect(activitySemanticsOf('RETENTION_CHECK')).toMatchObject({ activityType: 'RETENTION_CHECK', noveltyRequired: CANONICAL_POLICY.retention.noveltyRequired });
  });

  it('a mastery check asks each concept for its own independent demonstration; a shared question cannot serve two', () => {
    const shared = [cached('ab', 'C1', {}, [['C2', 'PRIMARY']])];
    const s = solve([], { intent: 'MASTERY_CHECK', depth: 'QUICK' }, shared);
    expect(s.plan.mode === 'TARGETS' && s.plan.targets.every((t) => t.independentDemonstrations >= 1)).toBe(true);
    expect(s.outcome.status).toBe('PARTIAL');
    expect(s.outcome.unmet.some((u) => u.requirement === 'INDEPENDENT')).toBe(true);
    expect(solve([], { intent: 'MASTERY_CHECK', depth: 'QUICK' }, [...shared, cached('b', 'C2')]).outcome.status).toBe('READY');
  });

  it('a retention check excludes recently seen questions outright (canonical novelty) and reports the trade-off', () => {
    const exposure = new Map([['LEARNING_ITEM_CACHE:a1', { seen: true, recent: true }]]);
    const s = solveLearningBlueprint({ policy: { studentId: STUDENT, intent: 'RETENTION_CHECK', depth: 'QUICK', canonicalConceptIds: ['C1'], needs: projectEvidenceNeeds(['C1'], [], POLICY, AS_OF) }, coverages: [cached('a1', 'C1')], exposure });
    expect(s.outcome.selected).toEqual([]);
    expect(s.outcome.unmet[0]).toMatchObject({ cause: 'ONLY_RECENT_CANDIDATES' });
    // practice reuses it, and says so
    const p = solveLearningBlueprint({ policy: { studentId: STUDENT, intent: 'CONCEPT_PRACTICE', depth: 'QUICK', canonicalConceptIds: ['C1'], needs: projectEvidenceNeeds(['C1'], [], POLICY, AS_OF) }, coverages: [cached('a1', 'C1')], exposure });
    expect(p.outcome.selected[0].reasons).toContain('RECENT_REUSE_REQUIRED');
  });

  it('a diagnostic is one direct look per concept whatever the depth', () => {
    for (const depth of ['QUICK', 'BALANCED', 'DEEP'] as const) {
      const s = solve([], { intent: 'DIAGNOSTIC', depth });
      expect(s.outcome.selected, depth).toHaveLength(2);
      expect(s.plan.mode === 'TARGETS' && s.plan.accept.supporting).toBe(false);
    }
  });

  it('nothing ineligible reaches the solver: another Student\'s, unvalidated and unresolved questions are rejected with reasons', () => {
    const transitional: ConceptIdentity = { status: 'TRANSITIONAL', learnerConceptId: 'lc-x', canonicalConceptId: 'C1', basis: 'LABEL_MATCH' } as ConceptIdentity;
    const coverages = [cached('mine', 'C1'), cached('theirs', 'C1', { studentId: 'stu-2' }), cached('draft', 'C1', { validationStatus: 'PENDING' }), cached('label', 'C1', { identity: transitional }), cached('gone', 'C1', { identity: null }), cached('other', 'C9')];
    const s = solve([], { canonicalConceptIds: ['C1'], needs: projectEvidenceNeeds(['C1'], [], POLICY, AS_OF), depth: 'DEEP' }, coverages);
    expect(ids(s)).toEqual(['mine']);
    expect(s.eligibility).toMatchObject({ total: 6, eligible: 1 });
    expect(s.eligibility.rejected).toMatchObject({ NOT_OWNED_BY_STUDENT: 1, CACHE_ITEM_NOT_VALIDATED: 1, CONCEPT_UNRESOLVED: 2, CONCEPT_MISMATCH: 1 });
    expect(s.outcome.status).toBe('PARTIAL');
  });

  it('a TRANSITIONAL or unlinked learner concept is reported as an unresolved target, never guessed', () => {
    const context = { learnerState: { concepts: [canonical('C1', 'lc-1'), { status: 'TRANSITIONAL', learnerConceptId: 'lc-2', canonicalConceptId: 'C2', basis: 'LABEL_MATCH' }] } } as unknown as Parameters<typeof resolveLearningTargets>[0];
    const r = resolveLearningTargets(context, { learnerConceptIds: ['lc-1', 'lc-2', 'lc-3'] });
    expect(r.canonicalConceptIds).toEqual(['C1']);
    expect(r.unresolved).toEqual([{ ref: 'LEARNER_CONCEPT:lc-2', reason: 'TRANSITIONAL_LINK' }, { ref: 'LEARNER_CONCEPT:lc-3', reason: 'UNRESOLVED_LINK' }]);
    const s = solve([], { canonicalConceptIds: r.canonicalConceptIds, needs: projectEvidenceNeeds(r.canonicalConceptIds, [], POLICY, AS_OF), unresolved: r.unresolved, depth: 'QUICK' });
    expect(s.outcome.status).toBe('PARTIAL');
    expect(s.outcome.unmet).toEqual([
      { subject: 'LEARNER_CONCEPT:lc-2', requirement: 'IDENTITY', missing: 1, cause: 'UNRESOLVED_TARGET' },
      { subject: 'LEARNER_CONCEPT:lc-3', requirement: 'IDENTITY', missing: 1, cause: 'UNRESOLVED_TARGET' },
    ]);
  });

  it('no resolvable target: no requirement, nothing selected, an honest non-ready result', () => {
    const s = solve([], { canonicalConceptIds: [], needs: [], unresolved: [{ ref: 'LEARNER_CONCEPT:lc-2', reason: 'TRANSITIONAL_LINK' }] });
    expect(s.requirement).toBeNull();
    expect(s.outcome).toMatchObject({ status: 'INSUFFICIENT_COVERAGE', selected: [] });
    expect(() => BlueprintResultSchema.parse(s.result)).not.toThrow();
  });

  it('a stated time limit with no recorded durations is not faked: nothing is selected and the cause is named', () => {
    const s = solve([], { availableMinutes: 10 });
    expect(s.outcome.selected).toEqual([]);
    expect(s.outcome.unmet.every((u) => u.cause === 'DURATION_UNKNOWN')).toBe(true);
    const known = solve([], { availableMinutes: 10 }, pool.map((c) => timed(c, 90)));
    expect(known.outcome.status).toBe('READY');
    expect(known.result.estimate.minutes).toBe(6);
  });

  it('is deterministic over input order, and the snapshot identifies the exact candidate set', () => {
    const a = solve([state('C1', STRONG)]);
    const b = solve([state('C1', STRONG)], {}, reverse(pool));
    expect(b.outcome.selected.map((s) => s.key)).toEqual(a.outcome.selected.map((s) => s.key));
    expect(b.snapshot).toEqual(a.snapshot);
    expect(solve([state('C1', STRONG)], {}, pool.slice(0, 3)).snapshot.candidates.digest).not.toBe(a.snapshot.candidates.digest);
  });
});

/* ------------------------------------------------------------------ */

const gap = (objective: string | null, fraction: number, concept = `c-of-${objective}`): ExamGapCandidate => examGapCandidateFrom({ studentId: STUDENT, canonicalConceptId: concept, examProfileId: 'target-1', examAttemptId: 'att-1', learningObjectiveId: objective as string, fraction, at: AS_OF });

describe('B2 EXAM_PREPARATION -- adapts emphasis, stays inside the exam, never becomes official', () => {
  const OBJECTIVES = [
    { learningObjectiveId: 'lo-1', assessmentComponentId: 'comp-1', blueprintPositions: 10 },
    { learningObjectiveId: 'lo-2', assessmentComponentId: 'comp-1', blueprintPositions: 10 },
    { learningObjectiveId: 'lo-3', assessmentComponentId: 'comp-2', blueprintPositions: 2 },
  ];
  const items = (objective: string, n: number, over: Partial<ReviewedBankItemRow> = {}) => Array.from({ length: n }, (_, i) => bank(`${objective}-${i + 1}`, objective, { questionType: i % 2 ? 'short_answer' : 'multiple_choice', ...over }));
  const BANK = [...items('lo-1', 4), ...items('lo-2', 4), ...items('lo-3', 4, { bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-2', currentVersionId: 'x', retired: false, language: 'es' } }).map((c, i) => bank(`lo-3-${i + 1}`, 'lo-3', { bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-2', currentVersionId: `lo-3-${i + 1}`, retired: false, language: 'es' } }))];
  const prep = (over: Partial<Parameters<typeof buildExamPreparationBlueprint>[0]> = {}, coverages: QuestionCoverage[] = BANK, extra: { allowUnreviewedInPreparation?: boolean } = {}) =>
    solveExamPreparationBlueprint({ policy: { studentId: STUDENT, examTargetId: 'target-1', examVersionId: 'ev-1', objective: 'COVERAGE', examObjectives: OBJECTIVES, gaps: [], ...over }, coverages, ...extra });
  const perObjective = (s: ReturnType<typeof prep>) => Object.fromEntries(['lo-1', 'lo-2', 'lo-3'].map((o) => [o, s.outcome.selected.filter((x) => x.question.id.startsWith(o)).length]));

  it('a weak exam-relevant objective receives more emphasis than the official distribution gives it', () => {
    const neutral = prep();
    const weak = prep({ gaps: [gap('lo-3', 0.1)] });
    expect(perObjective(neutral)).toEqual({ 'lo-1': 1, 'lo-2': 1, 'lo-3': 1 });
    expect(perObjective(weak)).toEqual({ 'lo-1': 1, 'lo-2': 1, 'lo-3': 3 });
    // official share of lo-3 is 2 of 22 positions; here it is 3 of 5 -- a declared deviation, not a mock
    expect(weak.requirement).toMatchObject({ family: 'EXAM_PREPARATION', emphasis: { objective: 'COVERAGE', gapObjectiveIds: ['lo-3'], mayDeviateFromOfficialDistribution: true } });
    expect(weak.requirement!.official ?? null).toBeNull();
    expect(weak.result.family).toBe('EXAM_PREPARATION');
    expect(weak.outcome.selected.every((s) => s.slotIndex === null)).toBe(true);
  });

  it('two Students with different gaps get different preparation from the same bank', () => {
    expect(ids(prep({ objective: 'CLOSE_GAPS', gaps: [gap('lo-1', 0.1)] }))).toEqual(['lo-1-1', 'lo-1-2', 'lo-1-3']);
    expect(ids(prep({ objective: 'CLOSE_GAPS', gaps: [gap('lo-2', 0.4)] }))).toEqual(['lo-2-1', 'lo-2-2']);
  });

  it('a gap the exam does not assess is reported and never practised here, however severe', () => {
    const outside = [...BANK, bank('lo-x-1', 'lo-x'), bank('other-exam', 'lo-1', { bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-2', assessmentComponentId: 'comp-1', currentVersionId: 'other-exam', retired: false, language: 'es' } })];
    const s = prep({ objective: 'CLOSE_GAPS', gaps: [gap('lo-x', 0.0), gap(null, 0.0, 'c-free'), gap('lo-1', 0.4)] }, outside);
    expect(s.plan.mode === 'TARGETS' && s.plan.targets.map((t) => t.id)).toEqual(['lo-1']);
    expect(s.plan.mode === 'TARGETS' && s.plan.unresolvedTargets).toEqual([{ ref: 'CONCEPT:c-free', reason: 'NOT_EXAM_RELEVANT' }, { ref: 'OBJECTIVE:lo-x', reason: 'NOT_EXAM_RELEVANT' }]);
    expect(ids(s).every((id) => id.startsWith('lo-1-'))).toBe(true);
    expect(s.eligibility.rejected.EXAM_VERSION_MISMATCH).toBe(1);
    expect(s.outcome.unmet.filter((u) => u.requirement === 'IDENTITY')).toHaveLength(2);
  });

  it('priority = exam importance x gap x urgency, each from a recorded fact or neutral', () => {
    const s = prep({ gaps: [gap('lo-1', 0.1), gap('lo-3', 0.4)], daysToExam: 10 });
    expect(s.weighting).toEqual([
      { learningObjectiveId: 'lo-1', importance: 3, importanceKnown: true, gap: 3, urgency: 3, priority: 27, opportunities: 3 },
      { learningObjectiveId: 'lo-2', importance: 3, importanceKnown: true, gap: 1, urgency: 3, priority: 9, opportunities: 1 },
      { learningObjectiveId: 'lo-3', importance: 1, importanceKnown: true, gap: 2, urgency: 3, priority: 6, opportunities: 2 },
    ]);
    expect([urgencyWeight(null), urgencyWeight(-3), urgencyWeight(100), urgencyWeight(30), urgencyWeight(14)]).toEqual([1, 1, 1, 2, 3]);
    // a blueprint that does not state the distribution gives NEUTRAL importance, flagged -- never the bank's own counts
    const unknown = buildExamPreparationBlueprint({ studentId: STUDENT, examTargetId: null, examVersionId: 'ev-1', objective: 'COVERAGE', examObjectives: OBJECTIVES.map((o) => ({ ...o, blueprintPositions: null })), gaps: [] });
    expect(unknown.weighting.every((w) => w.importanceKnown === false && w.importance === EXAM_PREPARATION_WEIGHTS.importance.unknown)).toBe(true);
  });

  it('available time shapes the selection: the highest-priority need is served first, the rest is reported', () => {
    const timedBank = BANK.map((c) => timed(c, 120));
    const s = prep({ gaps: [gap('lo-1', 0.1)], availableMinutes: 4 }, timedBank);
    expect(s.outcome.selected).toHaveLength(2);
    expect(s.outcome.selected[0].question.id.startsWith('lo-1')).toBe(true);
    expect(s.outcome.estimatedSeconds).toBe(240);
    expect(s.outcome.status).toBe('PARTIAL');
    expect(s.outcome.unmet.every((u) => u.cause === 'TIME_BUDGET')).toBe(true);
    // without recorded durations the limit cannot be honoured and nothing is pretended
    expect(prep({ availableMinutes: 4 }).outcome.unmet.every((u) => u.cause === 'DURATION_UNKNOWN')).toBe(true);
  });

  it('section practice stays inside the section', () => {
    const s = prep({ objective: 'SECTION_PRACTICE', assessmentComponentIds: ['comp-2'] });
    expect(ids(s)).toEqual(['lo-3-1']);
    expect(s.eligibility.rejected.COMPONENT_MISMATCH).toBe(8);
  });

  it('a gap never bypasses licensing, review or content class', () => {
    const blocked = [
      bank('unlicensed', 'lo-1', { bankItem: { provenance: 'OFFICIAL', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'unlicensed', retired: false, language: 'es' } }),
      bank('restricted', 'lo-1', { sourceIds: ['src-1'], sourceLicenses: ['RESTRICTED'], bankItem: { provenance: 'LICENSED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'restricted', retired: false, language: 'es' } }),
      bank('fixture', 'lo-1', { contentOrigin: 'FIXTURE' }),
      bank('draft', 'lo-1', { status: 'DRAFT' }),
      bank('retired', 'lo-1', { bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'retired', retired: true, language: 'es' } }),
      cached('own-generated', 'c-of-lo-1'),
    ];
    const s = prep({ objective: 'CLOSE_GAPS', gaps: [gap('lo-1', 0.0)] }, blocked);
    expect(s.outcome).toMatchObject({ status: 'INSUFFICIENT_COVERAGE', selected: [] });
    expect(s.eligibility).toMatchObject({ eligible: 0, rejected: { LICENCE_UNKNOWN: 1, LICENCE_NOT_PERMITTED: 1, BANK_DELIVERY_RULE: 3, UNREVIEWED_CONTENT_NOT_ALLOWED: 1 } });
    expect(s.outcome.unmet).toContainEqual({ subject: 'OBJECTIVE:lo-1', requirement: 'OPPORTUNITY', missing: 3, cause: 'NO_ELIGIBLE_CANDIDATE' });
  });

  it('determinism over input order', () => {
    const a = prep({ gaps: [gap('lo-3', 0.1), gap('lo-1', 0.4)], daysToExam: 20 });
    const b = prep({ gaps: [gap('lo-1', 0.4), gap('lo-3', 0.1)], daysToExam: 20, examObjectives: reverse(OBJECTIVES) }, reverse(BANK));
    expect(b.outcome.selected.map((s) => s.key)).toEqual(a.outcome.selected.map((s) => s.key));
    expect(b.snapshot).toEqual(a.snapshot);
  });
});

/* ------------------------------------------------------------------ */

describe('B2 OFFICIAL_EXAM -- fixed blueprint, invariant to the learner', () => {
  const position = (index: number, objective: string, over: Partial<FormPosition> = {}): FormPosition => ({ index, blueprintObjectiveTargetId: `bot-${index}`, assessmentComponentId: 'comp-1', learningObjectiveId: objective, questionType: null, difficultyRange: null, ...over });
  const POSITIONS = [position(0, 'lo-1'), position(1, 'lo-1'), position(2, 'lo-2')];
  const BANK = [bank('i1', 'lo-1'), bank('i2', 'lo-1'), bank('i3', 'lo-2'), bank('i4', 'lo-2')];
  const official = (studentId: string, coverages: QuestionCoverage[] = BANK, positions: FormPosition[] = POSITIONS) => solveOfficialBlueprint({ policy: { studentId, examTargetId: 'target-1', examVersionId: 'ev-1', blueprintId: 'bp-1', positions }, coverages });

  it('two Students get the same requirements and the same form, whatever they know', () => {
    const a = official('student-weak');
    const b = official('student-strong');
    expect(a.outcome.status).toBe('READY');
    expect(a.plan).toEqual(b.plan);
    expect({ ...a.requirement, studentId: null }).toEqual({ ...b.requirement, studentId: null });
    expect(a.outcome.selected).toEqual(b.outcome.selected);
    expect(a.outcome.selected.map((s) => [s.slotIndex, s.question.id])).toEqual([[0, 'i1'], [1, 'i2'], [2, 'i3']]);
    expect(a.snapshot.learnerEvidence).toBeNull();
  });

  it('the policy has no learner input at all, and the requirement forbids emphasis / evidence', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', '..', 'src/lib/assessment-blueprint/policy/official-exam.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/evidence-requirement|exam-gap-candidate|practice-depth|EvidenceNeed|gaps|mastery|exposure|needs/i);
    const { requirement } = buildOfficialBlueprint({ studentId: 's', examTargetId: null, examVersionId: 'ev-1', blueprintId: null, positions: POSITIONS });
    expect(requirement.family).toBe('OFFICIAL_EXAM');
    expect(requirement.emphasis ?? null).toBeNull();
    expect(requirement.evidence ?? null).toBeNull();
    expect(() => BlueprintRequirementSchema.parse({ ...requirement, emphasis: { objective: 'CLOSE_GAPS', gapConceptIds: [], gapObjectiveIds: [], mayDeviateFromOfficialDistribution: true } })).toThrow();
  });

  it('generated learning questions never compete for an official position, even when the bank is short', () => {
    const s = official(STUDENT, [bank('i1', 'lo-1'), cached('g1', 'c-of-lo-1'), cached('g2', 'c-of-lo-2')]);
    expect(s.eligibility).toMatchObject({ eligible: 1, rejected: { STORE_NOT_ALLOWED_FOR_FAMILY: 2, UNREVIEWED_CONTENT_NOT_ALLOWED: 2 } });
    expect(s.outcome).toMatchObject({ status: 'INSUFFICIENT_COVERAGE', selected: [] });
    expect(s.outcome.unmet.map((u) => u.subject)).toEqual(['SLOT:1', 'SLOT:2']);
    expect(s.result.status).toBe('INSUFFICIENT_COVERAGE');
    expect(s.result.selected).toEqual([]);
  });

  it('only reviewed, mock-eligible content of this exam version: practice-only, fixture and other-version items are out', () => {
    const s = official(STUDENT, [
      bank('practice-only', 'lo-1', { usageEligibility: ['PRACTICE'], examAlignment: 'PRACTICE_ONLY' }),
      bank('fixture', 'lo-1', { contentOrigin: 'FIXTURE' }),
      bank('other', 'lo-1', { bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-9', assessmentComponentId: 'comp-1', currentVersionId: 'other', retired: false, language: 'es' } }),
    ]);
    expect(s.eligibility.eligible).toBe(0);
    expect(s.outcome.selected).toEqual([]);
  });

  it('technical-demo / fixture content cannot be let in by a caller: the audience is fixed to STUDENT', () => {
    const fixture = bank('fixture', 'lo-1', { contentOrigin: 'FIXTURE' });
    const r = eligibleSolverCandidates([fixture], { family: 'OFFICIAL_EXAM', studentId: STUDENT, examVersionId: 'ev-1', audience: 'TECHNICAL_DEMO' });
    expect(r.candidates).toEqual([]);
    expect(r.summary.rejected).toEqual({ BANK_DELIVERY_RULE: 1 });
  });

  it('FULL / REDUCED mock semantics stay B1\'s: B2 only says whether the form is complete', () => {
    const ready = { status: 'READY' as const };
    expect(officialAttemptDecision(ready, { fidelity: 'FULL', reasons: [] }, true)).toEqual({ startable: true, type: 'FULL_MOCK' });
    expect(officialAttemptDecision(ready, { fidelity: 'FULL', reasons: [] }, false)).toMatchObject({ startable: false, reason: 'OFFICIAL_DIFFICULTY_NOT_MET' });
    expect(officialAttemptDecision(ready, { fidelity: 'REDUCED', reasons: [] }, null)).toEqual({ startable: true, type: 'REDUCED_MOCK' });
    expect(officialAttemptDecision(ready, null, true)).toMatchObject({ startable: false, reason: 'FIDELITY_UNKNOWN' });
    expect(officialAttemptDecision({ status: 'INSUFFICIENT_COVERAGE' }, { fidelity: 'FULL', reasons: [] }, true)).toEqual({ startable: false, reason: 'INSUFFICIENT_COVERAGE', fidelityReasons: [] });
  });

  it('shadow comparison with the existing selector reports and replaces nothing', () => {
    const form = { v: 1, mode: 'MOCK', targetDifficulty: 3, difficultyIndex: 3, fidelity: 'FULL', components: [], slots: [
      { index: 0, blueprintObjectiveTargetId: 'bot-0', assessmentComponentId: 'comp-1', approvedItemId: 'i1', marks: 1, difficultyIndex: 3, contentOrigin: 'GENERATED' },
      { index: 1, blueprintObjectiveTargetId: 'bot-1', assessmentComponentId: 'comp-1', approvedItemId: 'i2', marks: 1, difficultyIndex: 3, contentOrigin: 'GENERATED' },
      { index: 2, blueprintObjectiveTargetId: 'bot-2', assessmentComponentId: 'comp-1', approvedItemId: 'i4', marks: 1, difficultyIndex: 3, contentOrigin: 'GENERATED' },
    ] } as unknown as AssembledForm;
    const before = JSON.stringify(form);
    const cmp = compareWithAssembledForm(form, official(STUDENT));
    expect(cmp).toEqual({ sameCompleteness: true, current: { filled: 3, positions: 3 }, b2: { filled: 3, positions: 3 }, samePositions: 2, onlyCurrent: ['i4'], onlyB2: ['i3'] });
    expect(JSON.stringify(form)).toBe(before);
  });
});
