/**
 * B3 -- Assessment Execution & Evidence Loop. Snapshot, attribution, exactly-once evidence, PostAssessmentState.
 *
 * The canonical writer is injected: these tests drive the real B2 pipelines, the real freeze, the real
 * attribution planner and the real loop, against a writer that honours the same contract the database
 * enforces (one application per operation key). The real writer's own guarantees are asserted in
 * b3-architecture.test.ts; no database is used here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = { quiz_sessions: new Map<string, any>(), exam_instances: new Map<string, any>() };
const query = vi.fn(async (sql: string, params: any[] = []) => {
  const update = /^UPDATE (quiz_sessions|exam_instances) SET assessment_snapshot/.exec(sql);
  if (update) {
    const row = store[update[1] as keyof typeof store].get(params[0]);
    if (row && row.student_id === params[2] && !row.assessment_snapshot) {
      row.assessment_snapshot = JSON.parse(params[1]);
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  const select = /^SELECT (student_id, assessment_snapshot|assessment_snapshot(?:, content_audience, form)?|form) FROM (quiz_sessions|exam_instances)/.exec(sql);
  if (select) {
    const row = store[select[2] as keyof typeof store].get(params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  throw new Error(`unexpected SQL in test: ${sql}`);
});
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => query(sql, params) } }));
vi.mock('@/services/mastery.service', () => ({ updateMastery: async () => { throw new Error('the real writer must be injected in these tests'); } }));
vi.mock('@/services/knowledge-state.service', () => ({ getConceptKnowledgeState: async () => null }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: async () => [] }));
vi.mock('@/lib/catalog/concept-identity.service', () => ({ resolveStudentConceptIdentities: async () => [] }));

import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type LearningCacheItemRow, type QuestionCoverage, type ReviewedBankItemRow } from '@/lib/assessment-foundation/question-coverage';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import type { ExamGapFacts } from '@/lib/assessment-foundation/exam-gap-candidate';
import { buildOperationKey } from '@/lib/algorithms/evidence-idempotency';
import type { MasteryUpdateInput, MasteryUpdateResult } from '@/services/mastery.service';
import { projectEvidenceNeeds, solveExamPreparationBlueprint, solveLearningBlueprint, solveOfficialBlueprint, type EvidenceCountPolicy, type LearnerConceptState } from '@/lib/assessment-blueprint';
import { executionRefs, freezeAssessment, FreezeError, FrozenAssessmentSchema, readFrozenAssessment, planEvidence, learningEvidenceResult, examEvidenceResult, type FrozenAssessment, type ScoredResponse } from '@/lib/assessment-execution';
import { completeAssessmentEvidence, learningActivityFor, loadAssessmentSnapshot, persistAssessmentSnapshot, type EvidenceLoopDeps } from '@/lib/assessment-execution/assessment-execution.service';

const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-10T12:00:00.000Z';
const STUDENT = 'stu-1';

const canonical = (canonicalConceptId: string, learnerConceptId = `lc-${canonicalConceptId}`): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId, canonicalConceptId, basis: 'CREATED_FROM_CANONICAL' });

function cached(id: string, concept: string, over: Partial<LearningCacheItemRow> = {}, also: Array<[string, 'PRIMARY' | 'SUPPORTING']> = []): QuestionCoverage {
  const c = coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: canonical(concept), ...over });
  return { ...c, concepts: [...c.concepts, ...also.map(([canonicalConceptId, role]) => ({ canonicalConceptId, role, basis: 'ITEM_ATTRIBUTION' as const }))] };
}
function bank(id: string, objective: string, concepts: string[] = [`c-of-${objective}`], over: Partial<ReviewedBankItemRow> = {}): QuestionCoverage {
  return coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 2, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' }, sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1,
    scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: concepts.map((canonicalConceptId) => ({ canonicalConceptId, relationType: 'FULL' as const })), ...over,
  });
}
const state = (canonicalConceptId: string, over: Partial<LearnerConceptState> = {}): LearnerConceptState => ({ canonicalConceptId, learnerConceptId: `lc-${canonicalConceptId}`, masteryState: null, validationReadiness: null, evidenceCount: null, independentEvidenceCount: null, nextReviewAt: null, ...over });

type Intent = 'CONCEPT_PRACTICE' | 'CUSTOM_CONCEPT_PRACTICE' | 'MASTERY_CHECK' | 'RETENTION_CHECK' | 'DIAGNOSTIC';

/** A LEARNING assessment through the real B2 pipeline, frozen. */
function learning(coverages: QuestionCoverage[], concepts: string[], opts: { intent?: Intent; depth?: 'QUICK' | 'BALANCED' | 'DEEP'; states?: LearnerConceptState[]; activity?: string; curriculum?: Array<{ structureVersionId: string; academicSubjectId: string }>; createdAt?: string } = {}): FrozenAssessment {
  const intent = opts.intent ?? 'CUSTOM_CONCEPT_PRACTICE';
  const solution = solveLearningBlueprint({ policy: { studentId: STUDENT, intent, depth: opts.depth ?? 'QUICK', canonicalConceptIds: concepts, needs: projectEvidenceNeeds(concepts, opts.states ?? [], POLICY, AS_OF), curriculum: opts.curriculum }, coverages, asOf: AS_OF });
  return freezeAssessment({ solution, coverages, studentId: STUDENT, createdAt: opts.createdAt ?? AS_OF, path: 'LEARNING_ACTIVITY', intent, activity: learningActivityFor(opts.activity ?? solution.requirement!.evidence!.activityType, intent) });
}

/** The form an exam instance holds for a snapshot: the same positions and items (`exam_instances.form`). */
const formOf = (f: FrozenAssessment) => ({ v: 1, slots: f.items.map((i) => ({ index: i.slotIndex ?? i.order, approvedItemId: i.question.id })) });
const scored = (itemKey: string, fraction: number, over: Partial<ScoredResponse> = {}): ScoredResponse => ({ itemKey, responseRef: `resp-${itemKey}`, status: 'SCORED', fraction, ...over });
const L = (id: string) => `LEARNING_ITEM_CACHE:${id}`;
const B = (id: string) => `REVIEWED_EXAM_BANK:${id}`;
const learner = (concepts: string[], subject = 'subject-1') => ({ identities: concepts.map((c) => canonical(c)), subjectByLearnerConcept: new Map(concepts.map((c) => [`lc-${c}`, subject])) });

/** A writer that honours the canonical contract: one application per operation key, state moved by the same call. */
function writer() {
  const applied = new Map<string, MasteryUpdateInput>();
  const calls: MasteryUpdateInput[] = [];
  const mastery = new Map<string, number>();
  const states = new Map<string, string>();
  const failFor = new Set<string>();
  const updateMastery = async (input: MasteryUpdateInput): Promise<MasteryUpdateResult> => {
    calls.push(input);
    if (failFor.has(input.conceptId)) throw new Error('writer unavailable');
    const key = buildOperationKey(input.identity!);
    const current = mastery.get(input.conceptId) ?? 0;
    if (applied.has(key)) return { oldMastery: current, newMastery: current, delta: 0, confidenceScore: 0.5, duplicate: true, eventId: `evt-${key}` };
    applied.set(key, input);
    const next = current + (input.evidence.result === 'correct' ? 15 : input.evidence.result === 'partial' ? 5 : -5);
    mastery.set(input.conceptId, next);
    states.set(input.conceptId, input.evidence.result === 'correct' ? 'DEVELOPING' : 'LEARNING');
    return { oldMastery: current, newMastery: next, delta: next - current, confidenceScore: 0.5, duplicate: false, eventId: `evt-${key}`, ...(input.metadata?.activityType === 'RETENTION_CHECK' ? { retentionCheckQualified: true } : {}) };
  };
  return { updateMastery, applied, calls, states, failFor };
}

function deps(w: ReturnType<typeof writer>, concepts: string[], over: Partial<EvidenceLoopDeps> = {}): Partial<EvidenceLoopDeps> {
  return {
    updateMastery: w.updateMastery,
    loadIdentities: async () => concepts.map((c) => canonical(c)),
    loadSubjects: async (ids) => new Map(ids.map((id) => [id, 'subject-1'])),
    readMasteryState: async (_s, learnerConceptId) => w.states.get(learnerConceptId) ?? null,
    resolveExamAttempt: async (instanceId, attemptId) => (instanceId === 'inst-1' && attemptId === 'att-1' ? { examTargetId: 'target-1' } : null),
    readExamGaps: async () => [],
    log: () => undefined,
    ...over,
  };
}

beforeEach(() => {
  store.quiz_sessions.clear();
  store.exam_instances.clear();
  query.mockClear();
});

/* ================================================================== */

describe('B3 snapshot -- the assessment is frozen before it executes', () => {
  const POOL = [cached('q1', 'C1'), cached('q2', 'C1', {}, [['C2', 'SUPPORTING']]), cached('q3', 'C2', {}, [['C4', 'PRIMARY']]), cached('q4', 'C4')];

  it('freezes the exact B2 selection, in order, with the coverage it had at selection time', () => {
    const f = learning(POOL, ['C1', 'C2', 'C4'], { curriculum: [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }] });
    expect(() => FrozenAssessmentSchema.parse(f)).not.toThrow();
    expect(executionRefs(f)).toEqual([{ order: 0, slotIndex: null, question: { store: 'LEARNING_ITEM_CACHE', id: 'q2' } }, { order: 1, slotIndex: null, question: { store: 'LEARNING_ITEM_CACHE', id: 'q3' } }]);
    expect(f).toMatchObject({ family: 'LEARNING', path: 'LEARNING_ACTIVITY', intent: 'CUSTOM_CONCEPT_PRACTICE', depth: 'QUICK', studentId: STUDENT, contentAudience: 'STUDENT', policy: { id: 'b2-learning' }, curriculum: [{ structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }], exam: null });
    expect(f.targets).toEqual({ canonicalConceptIds: ['C1', 'C2', 'C4'], learningObjectiveIds: [] });
    expect(f.items[0]).toMatchObject({ key: L('q2'), provenance: 'GENERATED_UNREVIEWED', difficulty: 3, estimatedSeconds: null, marks: null, coverage: [{ canonicalConceptId: 'C1', role: 'PRIMARY', basis: 'LEARNER_CONCEPT_LINK' }, { canonicalConceptId: 'C2', role: 'SUPPORTING', basis: 'ITEM_ATTRIBUTION' }] });
    expect(f.items[0].intended).toEqual([{ targetKey: 'CONCEPT:C1', strength: 'DIRECT', counted: ['OPPORTUNITY', 'DIRECT'] }, { targetKey: 'CONCEPT:C2', strength: 'SUPPORTING', counted: ['OPPORTUNITY'] }]);
    expect(f.blueprint).toMatchObject({ status: 'READY', unmet: [], learnerEvidence: { asOf: AS_OF } });
    expect(f.activity).toEqual({ quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE', evidenceSource: 'PRACTICE_QUIZ' });
  });

  it('is deterministic and self-verifying: an edited snapshot is refused', () => {
    const a = learning(POOL, ['C1', 'C2', 'C4']);
    const b = learning([...POOL].reverse(), ['C4', 'C2', 'C1']);
    expect(b).toEqual(a);
    expect(readFrozenAssessment(JSON.parse(JSON.stringify(a)))).toEqual({ ok: true, frozen: a });
    const edited = JSON.parse(JSON.stringify(a));
    edited.items[0].coverage[0].role = 'SUPPORTING';
    expect(readFrozenAssessment(edited)).toEqual({ ok: false, issue: 'DIGEST_MISMATCH' });
    expect(readFrozenAssessment({ ...a, extra: 1 })).toEqual({ ok: false, issue: 'MALFORMED' });
  });

  it('a later change to the bank, its metadata or the Student state does not change an existing assessment', () => {
    const frozen = learning(POOL, ['C1', 'C2', 'C4']);
    const before = JSON.stringify(frozen);
    // the bank changes: a better question appears, an existing one is re-tagged and re-ordered
    const mutated = [cached('q0', 'C1', {}, [['C2', 'PRIMARY'], ['C4', 'PRIMARY']]), ...POOL.map((c) => (c.ref.id === 'q2' ? { ...c, concepts: [{ canonicalConceptId: 'C9', role: 'PRIMARY' as const, basis: 'ITEM_ATTRIBUTION' as const }] } : c))].reverse();
    // the Student's knowledge changes
    const strong = [state('C1', { masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY', evidenceCount: 6, independentEvidenceCount: 3 })];
    const later = learning(mutated, ['C1', 'C2', 'C4'], { states: strong, depth: 'BALANCED', createdAt: '2026-11-01T00:00:00.000Z' });
    // a NEW assessment may differ ...
    expect(later.snapshotId).not.toBe(frozen.snapshotId);
    expect(executionRefs(later)).not.toEqual(executionRefs(frozen));
    // ... the existing one is the same record, and attribution reads only what it froze
    expect(JSON.stringify(frozen)).toBe(before);
    const plan = planEvidence(frozen, { assessmentRef: 'qs-1' }, [scored(L('q2'), 1)], learner(['C1', 'C2', 'C9']));
    expect(plan.writes.map((w) => w.canonicalConceptId)).toEqual(['C1']);
    expect(plan.outcomes.some((o) => o.canonicalConceptId === 'C9')).toBe(false);
  });

  it('refuses what cannot be an executable assessment', () => {
    const solution = solveLearningBlueprint({ policy: { studentId: STUDENT, intent: 'CONCEPT_PRACTICE', depth: 'QUICK', canonicalConceptIds: ['C1'], needs: projectEvidenceNeeds(['C1'], [], POLICY, AS_OF) }, coverages: [cached('q1', 'C1')] });
    const activity = learningActivityFor('PRACTICE');
    const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as FreezeError).code; } };
    expect(code(() => freezeAssessment({ solution, coverages: [cached('q1', 'C1')], studentId: STUDENT, createdAt: AS_OF, path: 'OFFICIAL_MOCK', activity }))).toBe('PATH_FAMILY_MISMATCH');
    expect(code(() => freezeAssessment({ solution, coverages: [cached('q1', 'C1')], studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY' }))).toBe('ACTIVITY_REQUIRED');
    expect(code(() => freezeAssessment({ solution, coverages: [], studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', activity }))).toBe('COVERAGE_MISSING_FOR_SELECTED');
    const empty = solveLearningBlueprint({ policy: { studentId: STUDENT, intent: 'CONCEPT_PRACTICE', depth: 'QUICK', canonicalConceptIds: ['C1'], needs: projectEvidenceNeeds(['C1'], [], POLICY, AS_OF) }, coverages: [] });
    expect(code(() => freezeAssessment({ solution: empty, coverages: [], studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', activity }))).toBe('NOTHING_SELECTED');
  });

  it('the activity is bound from the existing registries, never from a caller-supplied source', () => {
    expect(learningActivityFor('PROVE')).toEqual({ quizMode: 'canonical_prove', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT', evidenceSource: 'SOLO_VERIFICATION' });
    expect(learningActivityFor('RETENTION_CHECK')).toEqual({ quizMode: 'canonical_retain', activityType: 'RETENTION_CHECK', evidenceMode: 'INDEPENDENT', evidenceSource: 'SOLO_VERIFICATION' });
    expect(learningActivityFor('TRANSFER')).toMatchObject({ quizMode: 'canonical_transfer', activityType: 'TRANSFER', evidenceMode: 'INDEPENDENT' });
    expect(learningActivityFor('DIAGNOSTIC_CHECK')).toEqual({ quizMode: 'diagnostic_check', activityType: 'DIAGNOSTIC_CHECK', evidenceMode: 'ASSESSMENT', evidenceSource: 'DIAGNOSTIC' });
    expect(learningActivityFor('PRACTICE', 'MIXED_CUMULATIVE')).toMatchObject({ quizMode: 'cumulative_assessment', evidenceSource: 'CUMULATIVE_ASSESSMENT' });
    expect(() => learningActivityFor('SOMETHING_ELSE')).toThrow(/CANONICAL_IMPLEMENTATION_MISSING/);
  });

  it('is stored once on the existing record; a different snapshot for the same record is refused', async () => {
    const frozen = learning(POOL, ['C1', 'C2', 'C4']);
    store.quiz_sessions.set('qs-1', { student_id: STUDENT, assessment_snapshot: null });
    store.quiz_sessions.set('qs-other', { student_id: 'stu-2', assessment_snapshot: null });
    const record = { kind: 'QUIZ_SESSION' as const, id: 'qs-1' };
    expect(await persistAssessmentSnapshot(record, frozen)).toEqual({ ok: true, stored: 'NEW' });
    expect(await persistAssessmentSnapshot(record, frozen)).toEqual({ ok: true, stored: 'ALREADY_STORED' });
    expect(await persistAssessmentSnapshot(record, learning(POOL, ['C1']))).toEqual({ ok: false, reason: 'ALREADY_FROZEN_DIFFERENTLY' });
    expect(await persistAssessmentSnapshot({ kind: 'EXAM_INSTANCE', id: 'qs-1' }, frozen)).toEqual({ ok: false, reason: 'RECORD_KIND_MISMATCH' });
    expect(await persistAssessmentSnapshot({ kind: 'QUIZ_SESSION', id: 'qs-other' }, frozen)).toEqual({ ok: false, reason: 'STUDENT_MISMATCH' });
    expect(await persistAssessmentSnapshot({ kind: 'QUIZ_SESSION', id: 'nope' }, frozen)).toEqual({ ok: false, reason: 'RECORD_NOT_FOUND' });
    expect(await loadAssessmentSnapshot(record)).toEqual({ ok: true, frozen, technicalDemo: false });
    // an attempt reads what was stored: a row edited behind the service does not execute
    store.quiz_sessions.get('qs-1').assessment_snapshot = { ...frozen, intent: 'DIAGNOSTIC' };
    expect(await loadAssessmentSnapshot(record)).toEqual({ ok: false, reason: 'DIGEST_MISMATCH' });
    // every statement touched the snapshot column only
    for (const [sql] of query.mock.calls) expect(String(sql)).toMatch(/assessment_snapshot/);
  });
});

/* ================================================================== */

describe('B3 evidence attribution -- coverage is not credit', () => {
  it('the attribution matrix', () => {
    const transitional = { status: 'TRANSITIONAL', learnerConceptId: 'lc-T', canonicalConceptId: 'C5', basis: 'LABEL_MATCH' } as unknown as ConceptIdentity;
    const pool = [cached('p', 'C1'), cached('ps', 'C2', {}, [['C3', 'SUPPORTING']]), cached('pp', 'C4', {}, [['C6', 'PRIMARY']]), cached('t', 'C5'), cached('u', 'C7')];
    const f = learning(pool, ['C1', 'C2', 'C4', 'C5', 'C7'], { depth: 'BALANCED' });
    const plan = planEvidence(f, { assessmentRef: 'qs-1' }, f.items.map((i) => scored(i.key, 1)), { identities: [canonical('C1'), canonical('C2'), canonical('C3'), canonical('C4'), canonical('C6'), transitional], subjectByLearnerConcept: new Map(['lc-C1', 'lc-C2', 'lc-C3', 'lc-C4', 'lc-C6', 'lc-T'].map((id) => [id, 'subject-1'])) });
    const row = (item: string, concept: string) => { const o = plan.outcomes.find((x) => x.itemKey === L(item) && x.canonicalConceptId === concept)!; return [o.role, o.credit, o.status, o.reason, o.independent]; };
    expect(row('p', 'C1')).toEqual(['PRIMARY', 'DIRECT', 'ATTRIBUTED', null, false]);
    expect(row('ps', 'C2')).toEqual(['PRIMARY', 'DIRECT', 'ATTRIBUTED', null, false]);
    expect(row('ps', 'C3')).toEqual(['SUPPORTING', 'CONTRIBUTORY', 'NON_CONSEQUENTIAL', 'SUPPORTING_COVERAGE', false]);
    expect(row('pp', 'C4')).toEqual(['PRIMARY', 'CONTRIBUTORY', 'NON_CONSEQUENTIAL', 'SEVERAL_PRIMARY_CONCEPTS', false]);
    expect(row('pp', 'C6')).toEqual(['PRIMARY', 'CONTRIBUTORY', 'NON_CONSEQUENTIAL', 'SEVERAL_PRIMARY_CONCEPTS', false]);
    // a TRANSITIONAL (label-matched) link and a missing instance are both unresolved: no evidence
    expect(row('t', 'C5')).toEqual(['PRIMARY', 'DIRECT', 'UNRESOLVED_CONCEPT', 'NO_CANONICALLY_LINKED_LEARNER_CONCEPT', false]);
    expect(row('u', 'C7')).toEqual(['PRIMARY', 'DIRECT', 'UNRESOLVED_CONCEPT', 'NO_CANONICALLY_LINKED_LEARNER_CONCEPT', false]);
    expect(plan.writes.map((w) => w.canonicalConceptId)).toEqual(['C1', 'C2']);
    // C3 has a canonical learner instance and still receives nothing: supporting coverage is not credit
    expect(plan.writes.some((w) => w.learnerConceptId === 'lc-C3' || w.learnerConceptId === 'lc-T')).toBe(false);
  });

  it('REQUIRED multi-concept case: Q1 -> C1 PRIMARY + C2 SUPPORTING', async () => {
    const f = learning([cached('Q1', 'C1', {}, [['C2', 'SUPPORTING']])], ['C1', 'C2']);
    const plan = planEvidence(f, { assessmentRef: 'qs-1' }, [scored(L('Q1'), 1)], learner(['C1', 'C2']));
    // scored once, one source response, two controlled attributions
    expect(plan.score).toMatchObject({ items: 1, scored: 1, meanFraction: 1 });
    expect(plan.outcomes.map((o) => [o.canonicalConceptId, o.status, o.responseRef])).toEqual([['C1', 'ATTRIBUTED', `resp-${L('Q1')}`], ['C2', 'NON_CONSEQUENTIAL', `resp-${L('Q1')}`]]);
    expect(plan.writes).toHaveLength(1);
    const w = plan.writes[0];
    expect(w).toMatchObject({ learnerConceptId: 'lc-C1', canonicalConceptId: 'C1', sourceItemKeys: [L('Q1')], identity: { operationType: 'QUIZ_SUBMISSION', operationId: 'qs-1', conceptId: 'lc-C1' } });
    // the supporting concept is traceable to the same response, on the evidence itself, with no mastery effect
    expect((w.metadata.assessment as any).nonConsequential).toEqual([{ itemKey: L('Q1'), canonicalConceptId: 'C2', role: 'SUPPORTING', status: 'NON_CONSEQUENTIAL' }]);
    expect((w.metadata.assessment as any).responses).toEqual([{ itemKey: L('Q1'), question: { store: 'LEARNING_ITEM_CACHE', id: 'Q1' }, order: 0, responseRef: `resp-${L('Q1')}`, store: 'LEARNING_ITEM_CACHE', provenance: 'GENERATED_UNREVIEWED', independent: false }]);

    // through the loop, twice: evidence once
    store.quiz_sessions.set('qs-1', { student_id: STUDENT, assessment_snapshot: f });
    const w1 = writer();
    const input = { record: { kind: 'QUIZ_SESSION' as const, id: 'qs-1' }, studentId: STUDENT, attemptRef: 'qs-1', responses: [scored(L('Q1'), 1)] };
    const first = await completeAssessmentEvidence(input, deps(w1, ['C1', 'C2']));
    const retry = await completeAssessmentEvidence(input, deps(w1, ['C1', 'C2']));
    expect(first.ok && first.state.evidence.map((e) => [e.canonicalConceptId, e.status])).toEqual([['C1', 'APPLIED']]);
    expect(retry.ok && retry.state.evidence.map((e) => [e.canonicalConceptId, e.status])).toEqual([['C1', 'DUPLICATE_IDEMPOTENT']]);
    expect(w1.applied.size).toBe(1);
    expect([...w1.applied.keys()]).toEqual(['QUIZ_SUBMISSION::qs-1::lc-C1']);
    expect(w1.states.has('lc-C2')).toBe(false);
  });

  it('a learning concept is one evidence event per session: the bucket, thresholds and source of the existing submission', () => {
    const f = learning([cached('a', 'C1'), cached('b', 'C1', { difficulty: 4, questionType: 'short_answer' }), cached('c', 'C2')], ['C1', 'C2'], { depth: 'BALANCED' });
    const plan = planEvidence(f, { assessmentRef: 'qs-9', learningMode: 'SOLO' }, [scored(L('a'), 1, { hintsUsed: 1 }), scored(L('b'), 0.5), scored(L('c'), 0.2)], learner(['C1', 'C2']));
    expect(plan.writes.map((w) => [w.canonicalConceptId, w.evidence, w.telemetry])).toEqual([
      ['C1', { result: 'correct', difficulty: 4, sourceType: 'PRACTICE_QUIZ', confidenceWeight: 0.9, scorePercent: 75, sampleSize: 2 }, { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 1 }],
      ['C2', { result: 'incorrect', difficulty: 3, sourceType: 'PRACTICE_QUIZ', confidenceWeight: 0.9, scorePercent: 20, sampleSize: 1 }, { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 }],
    ]);
    expect(plan.writes[0].metadata).toMatchObject({ activityType: 'PRACTICE', evidenceMode: 'PRACTICE', assessment: { snapshotId: f.snapshotId, family: 'LEARNING', assessmentRef: 'qs-9', policy: f.policy, attributionRole: 'PRIMARY' } });
    expect([learningEvidenceResult(70), learningEvidenceResult(69), learningEvidenceResult(50), learningEvidenceResult(49)]).toEqual(['correct', 'partial', 'partial', 'incorrect']);
    expect([examEvidenceResult(1), examEvidenceResult(0.4), examEvidenceResult(0)]).toEqual(['correct', 'partial', 'incorrect']);
  });

  it('unanswered and pending responses are not evidence; a response outside the snapshot is refused', () => {
    const f = learning([cached('a', 'C1'), cached('b', 'C2')], ['C1', 'C2']);
    const plan = planEvidence(f, { assessmentRef: 'qs-1' }, [{ itemKey: L('a'), responseRef: null, status: 'UNANSWERED', fraction: null }, { itemKey: L('b'), responseRef: 'r', status: 'PENDING_REVIEW', fraction: null }, scored(L('zzz'), 1)], learner(['C1', 'C2']));
    expect(plan.outcomes.map((o) => [o.itemKey, o.status, o.reason])).toEqual([[L('zzz'), 'NOT_IN_SNAPSHOT', 'RESPONSE_NOT_PART_OF_ASSESSMENT'], [L('a'), 'NOT_SCORED', 'UNANSWERED'], [L('b'), 'NOT_SCORED', 'PENDING_REVIEW']]);
    expect(plan.writes).toEqual([]);
    // intended vs observed: the blueprint targeted both, nothing was observed -- and no failure is inferred
    expect(plan.coverage).toEqual({ intended: { canonicalConceptIds: ['C1', 'C2'], learningObjectiveIds: [] }, selected: ['C1', 'C2'], answered: ['C2'], scored: [], consequential: [] });
    expect(plan.score).toMatchObject({ items: 2, answered: 1, scored: 0, pendingReview: 1, meanFraction: null, marks: null });
  });

  it('an unknown difficulty is not invented: the response scores, no evidence is written', () => {
    const f = learning([cached('a', 'C1', { difficulty: null })], ['C1']);
    const plan = planEvidence(f, { assessmentRef: 'qs-1' }, [scored(L('a'), 1)], learner(['C1']));
    expect(plan.outcomes.map((o) => [o.status, o.reason])).toEqual([['UNSUPPORTED_DIMENSION', 'DIFFICULTY_UNKNOWN']]);
    expect(plan.writes).toEqual([]);
    expect(plan.score.meanFraction).toBe(1);
  });
});

/* ================================================================== */

describe('B3 independent evidence, retention and transfer -- existing authorities, no second formula', () => {
  it('INDEPENDENT PROVE: direct concept, no assistance -> independent evidence through the writer; state follows', async () => {
    const f = learning([cached('p1', 'C1', { difficulty: 4 })], ['C1'], { intent: 'MASTERY_CHECK' });
    expect(f.activity).toMatchObject({ activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT', evidenceSource: 'SOLO_VERIFICATION' });
    store.quiz_sessions.set('qs-p', { student_id: STUDENT, assessment_snapshot: f });
    const w = writer();
    const r = await completeAssessmentEvidence({ record: { kind: 'QUIZ_SESSION', id: 'qs-p' }, studentId: STUDENT, attemptRef: 'qs-p', responses: [scored(L('p1'), 1)] }, deps(w, ['C1']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.attributionOutcomes).toMatchObject([{ status: 'ATTRIBUTED', independent: true, credit: 'DIRECT' }]);
    expect(w.calls[0]).toMatchObject({ studentId: STUDENT, conceptId: 'lc-C1', subjectId: 'subject-1', evidence: { sourceType: 'SOLO_VERIFICATION', result: 'correct', scorePercent: 100 }, metadata: { activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' } });
    expect((w.calls[0].metadata!.assessment as any).responses[0].independent).toBe(true);
    expect(r.state.conceptStateChanges).toEqual([{ canonicalConceptId: 'C1', learnerConceptId: 'lc-C1', before: null, after: 'DEVELOPING', changed: true }]);
    expect(r.state.diagnostics).toMatchObject({ attributedCount: 1, knowledgeStateUpdates: 1, duplicateCount: 0 });
  });

  it('assistance removes independence; a multi-concept response is independent proof of at most one concept', () => {
    const one = learning([cached('p1', 'C1')], ['C1'], { intent: 'MASTERY_CHECK' });
    expect(planEvidence(one, { assessmentRef: 'x' }, [scored(L('p1'), 1, { hintsUsed: 1 })], learner(['C1'])).outcomes[0]).toMatchObject({ status: 'ATTRIBUTED', independent: false });
    const multi = learning([cached('m', 'C1', {}, [['C2', 'SUPPORTING']]), cached('b', 'C2')], ['C1', 'C2'], { intent: 'MASTERY_CHECK' });
    const plan = planEvidence(multi, { assessmentRef: 'x' }, multi.items.map((i) => scored(i.key, 1)), learner(['C1', 'C2']));
    for (const key of multi.items.map((i) => i.key)) expect(plan.outcomes.filter((o) => o.itemKey === key && o.independent).length).toBeLessThanOrEqual(1);
    expect(plan.outcomes.filter((o) => o.itemKey === L('m') && o.independent).map((o) => o.canonicalConceptId)).toEqual(['C1']);
    // and two PRIMARY concepts on one question: neither is independently demonstrated
    const twoPrimary = learning([cached('pp', 'C1', {}, [['C2', 'PRIMARY']])], ['C1', 'C2'], { intent: 'MASTERY_CHECK' });
    expect(planEvidence(twoPrimary, { assessmentRef: 'x' }, [scored(L('pp'), 1)], learner(['C1', 'C2'])).outcomes.some((o) => o.independent || o.status === 'ATTRIBUTED')).toBe(false);
    // a practice session never yields independent evidence
    const practice = learning([cached('p1', 'C1')], ['C1']);
    expect(planEvidence(practice, { assessmentRef: 'x' }, [scored(L('p1'), 1)], learner(['C1'])).outcomes[0].independent).toBe(false);
  });

  it('RETENTION: the response reaches the writer as a retention check; the memory domain decides what it means', async () => {
    const f = learning([cached('r1', 'C1')], ['C1'], { intent: 'RETENTION_CHECK' });
    store.quiz_sessions.set('qs-r', { student_id: STUDENT, assessment_snapshot: f });
    const w = writer();
    const r = await completeAssessmentEvidence({ record: { kind: 'QUIZ_SESSION', id: 'qs-r' }, studentId: STUDENT, attemptRef: 'qs-r', responses: [scored(L('r1'), 1)] }, deps(w, ['C1']));
    expect(w.calls[0].metadata).toMatchObject({ activityType: 'RETENTION_CHECK', evidenceMode: 'INDEPENDENT' });
    // whether it qualified is the memory projector's own answer, passed through
    expect(r.ok && r.state.evidence[0]).toMatchObject({ status: 'APPLIED', retentionCheckQualified: true });
    expect(JSON.stringify(w.calls[0])).not.toMatch(/nextReviewAt|forgetting|memory_stability/i);
  });

  it('TRANSFER: the existing transfer grader\'s verdict is the evidence; without it nothing is written', () => {
    const f = learning([cached('t1', 'C1')], ['C1'], { activity: 'TRANSFER' });
    const without = planEvidence(f, { assessmentRef: 'qs-t' }, [scored(L('t1'), 1)], learner(['C1']));
    expect(without.writes).toEqual([]);
    expect(without.outcomes[0]).toMatchObject({ status: 'UNSUPPORTED_DIMENSION', reason: 'TRANSFER_GRADING_MISSING' });
    const withGrade = planEvidence(f, { assessmentRef: 'qs-t', transferGrading: { overallScore: 64, passed: false } }, [scored(L('t1'), 1)], learner(['C1']));
    expect(withGrade.writes[0]).toMatchObject({ evidence: { result: 'incorrect', scorePercent: 64, sourceType: 'SOLO_VERIFICATION' }, metadata: { activityType: 'TRANSFER', evidenceMode: 'INDEPENDENT' } });
    expect(JSON.stringify(withGrade.writes[0])).not.toMatch(/transferDepth|transfer_depth|NEAR|FAR/);
  });
});

/* ================================================================== */

const gapFacts = (objective: string, concept: string, fraction: number): ExamGapFacts => ({ studentId: STUDENT, canonicalConceptId: concept, examProfileId: 'target-1', examAttemptId: 'att-1', learningObjectiveId: objective, fraction, at: AS_OF });

describe('B3 EXAM_PREPARATION -- frozen, scored, attributed only where the item says what it measures', () => {
  const OBJECTIVES = [{ learningObjectiveId: 'lo-1', assessmentComponentId: 'comp-1', blueprintPositions: 5 }, { learningObjectiveId: 'lo-2', assessmentComponentId: 'comp-1', blueprintPositions: 5 }];
  // lo-1 items are objective-derived (the bank as it is today); the lo-2 item carries explicit item-level attribution
  const explicit = (c: QuestionCoverage, concept: string): QuestionCoverage => ({ ...c, concepts: [{ canonicalConceptId: concept, role: 'PRIMARY', basis: 'ITEM_ATTRIBUTION' }] });
  const BANK = [bank('d1', 'lo-1', ['C1', 'C2']), explicit(bank('e1', 'lo-2', ['C3']), 'C3')];
  const frozen = () => {
    const solution = solveExamPreparationBlueprint({ policy: { studentId: STUDENT, examTargetId: 'target-1', examVersionId: 'ev-1', objective: 'COVERAGE', examObjectives: OBJECTIVES, gaps: [] }, coverages: BANK });
    return freezeAssessment({ solution, coverages: BANK, studentId: STUDENT, createdAt: AS_OF, path: 'EXAM_PRACTICE', intent: 'COVERAGE', exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1'] } });
  };

  it('executes the frozen selection; explicit coverage produces evidence, derived coverage does not; exam scope is kept', async () => {
    const f = frozen();
    expect(f).toMatchObject({ family: 'EXAM_PREPARATION', path: 'EXAM_PRACTICE', activity: null, exam: { examVersionId: 'ev-1', examTargetId: 'target-1' }, targets: { canonicalConceptIds: [], learningObjectiveIds: ['lo-1', 'lo-2'] } });
    expect(executionRefs(f).map((r) => r.question.id)).toEqual(['d1', 'e1']);
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: f, content_audience: 'STUDENT', form: formOf(f) });
    const w = writer();
    const published: string[] = [];
    const r = await completeAssessmentEvidence(
      { record: { kind: 'EXAM_INSTANCE', id: 'inst-1' }, studentId: STUDENT, attemptRef: 'att-1', responses: [scored(B('d1'), 0), scored(B('e1'), 0.5)] },
      deps(w, ['C1', 'C2', 'C3'], { readExamGaps: async (s, target) => { published.push(`${s}:${target}`); return [gapFacts('lo-1', 'C1', 0)]; }, nextDecision: async () => ({ item: { conceptId: 'lc-C3' } }) })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.state;
    expect(s.attributionOutcomes.map((o) => [o.itemKey, o.canonicalConceptId, o.status, o.reason])).toEqual([
      [B('d1'), 'C1', 'DERIVED_ONLY', 'OBJECTIVE_MAPPING_ONLY'],
      [B('d1'), 'C2', 'DERIVED_ONLY', 'OBJECTIVE_MAPPING_ONLY'],
      [B('e1'), 'C3', 'ATTRIBUTED', null],
    ]);
    // one evidence event per scored item response, on the existing exam boundary
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).toMatchObject({
      conceptId: 'lc-C3',
      evidence: { sourceType: 'EXAM_SIMULATION', result: 'partial', difficulty: 3, scorePercent: 50 },
      telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
      identity: { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: 'att-1.1', conceptId: 'lc-C3' },
      metadata: {
        context: { examAttemptId: 'att-1', simulationSource: true },
        framework: { examVersionId: 'ev-1' },
        examScope: { examTargetId: 'target-1', examVersionId: 'ev-1', examAttemptId: 'att-1', source: 'EXAM_ATTEMPT' },
        assessment: { snapshotId: f.snapshotId, family: 'EXAM_PREPARATION', path: 'EXAM_PRACTICE', exam: { examVersionId: 'ev-1', examTargetId: 'target-1', assessmentComponentIds: ['comp-1'], learningObjectiveIds: ['lo-2'] } },
      },
    });
    // the score is whole and valid whatever attribution could do
    expect(s.score).toEqual({ items: 2, answered: 2, scored: 2, pendingReview: 0, meanFraction: 0.25, marks: { obtained: 1, available: 4 } });
    expect(s.coverage).toMatchObject({ intended: { learningObjectiveIds: ['lo-1', 'lo-2'] }, selected: ['C1', 'C2', 'C3'], scored: ['C1', 'C2', 'C3'], consequential: ['C3'] });
    // the gap is published through the B1 boundary, read for THIS exam target; nothing is placed or ranked
    expect(published).toEqual([`${STUDENT}:target-1`]);
    expect(s.examGaps).toMatchObject([{ canonicalConceptId: 'C1', learningObjectiveId: 'lo-1', examTargetId: 'target-1', severity: 'HIGH' }]);
    expect(s.nextDecision).toEqual({ status: 'AVAILABLE', decision: { item: { conceptId: 'lc-C3' } } });
    expect(JSON.stringify(s)).not.toMatch(/today|rank|card/i);
  });

  it('the attempt must be the instance\'s own; the exam target comes from it, never from the caller', async () => {
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: frozen(), content_audience: 'STUDENT', form: formOf(frozen()) });
    const w = writer();
    const input = { record: { kind: 'EXAM_INSTANCE' as const, id: 'inst-1' }, studentId: STUDENT, responses: [scored(B('e1'), 1)] };
    expect(await completeAssessmentEvidence({ ...input, attemptRef: 'att-of-someone-else' }, deps(w, ['C3']))).toEqual({ ok: false, reason: 'ATTEMPT_NOT_BOUND_TO_SNAPSHOT' });
    expect(await completeAssessmentEvidence({ ...input, attemptRef: 'att-1', studentId: 'stu-2' }, deps(w, ['C3']))).toEqual({ ok: false, reason: 'STUDENT_MISMATCH' });
    expect(w.calls).toEqual([]);
    expect(() => planEvidence(frozen(), { assessmentRef: 'att-1' }, [], learner(['C3']))).toThrow('EXAM_SCOPE_REQUIRED');
  });
});

/* ================================================================== */

describe('B3 OFFICIAL_EXAM -- the score is authoritative and independent of learning attribution', () => {
  const position = (index: number, objective: string): FormPosition => ({ index, blueprintObjectiveTargetId: `bot-${index}`, assessmentComponentId: 'comp-1', learningObjectiveId: objective, questionType: null, difficultyRange: null });
  const POSITIONS = [position(0, 'lo-1'), position(1, 'lo-1'), position(2, 'lo-2')];
  const BANK = [bank('i1', 'lo-1', ['C1', 'C2']), bank('i2', 'lo-1', ['C1', 'C2']), bank('i3', 'lo-2', ['C3'])];
  const official = (coverages: QuestionCoverage[] = BANK) => solveOfficialBlueprint({ policy: { studentId: STUDENT, examTargetId: 'target-1', examVersionId: 'ev-1', blueprintId: 'bp-1', positions: POSITIONS }, coverages });
  const freeze = () => freezeAssessment({ solution: official(), coverages: BANK, studentId: STUDENT, createdAt: AS_OF, path: 'OFFICIAL_MOCK', exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1'] } });

  it('REQUIRED derived-exam-item case: objective O1 -> C1, C2 with no item-level attribution', async () => {
    const f = freeze();
    expect(executionRefs(f)).toEqual([{ order: 0, slotIndex: 0, question: { store: 'REVIEWED_EXAM_BANK', id: 'i1' } }, { order: 1, slotIndex: 1, question: { store: 'REVIEWED_EXAM_BANK', id: 'i2' } }, { order: 2, slotIndex: 2, question: { store: 'REVIEWED_EXAM_BANK', id: 'i3' } }]);
    expect(f.items.every((i) => i.question.store === 'REVIEWED_EXAM_BANK' && i.coverage.every((c) => c.role === 'UNSPECIFIED' && c.basis === 'OBJECTIVE_MAPPING'))).toBe(true);
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: f, content_audience: 'STUDENT', form: formOf(f) });
    const w = writer();
    const r = await completeAssessmentEvidence({ record: { kind: 'EXAM_INSTANCE', id: 'inst-1' }, studentId: STUDENT, attemptRef: 'att-1', responses: [scored(B('i1'), 1), scored(B('i2'), 1), scored(B('i3'), 0)] }, deps(w, ['C1', 'C2', 'C3']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // exam score valid ...
    expect(r.state.score).toEqual({ items: 3, answered: 3, scored: 3, pendingReview: 0, meanFraction: 2 / 3, marks: { obtained: 4, available: 6 } });
    // ... consequential evidence for C1 and C2: NO, reason DERIVED_ONLY -- although the Student has both instances
    expect(r.state.attributionOutcomes.map((o) => [o.canonicalConceptId, o.status])).toEqual([['C1', 'DERIVED_ONLY'], ['C2', 'DERIVED_ONLY'], ['C1', 'DERIVED_ONLY'], ['C2', 'DERIVED_ONLY'], ['C3', 'DERIVED_ONLY']]);
    expect(w.calls).toEqual([]);
    expect(r.state).toMatchObject({ evidence: [], conceptStateChanges: [], learnerEvidence: 'NONE', coverage: { selected: ['C1', 'C2', 'C3'], scored: ['C1', 'C2', 'C3'], consequential: [] } });
    expect(r.state.unresolvedAttributions).toHaveLength(5);
  });

  it('an incomplete official form is never frozen, and a generated question can never be in one', () => {
    const short = official([bank('i1', 'lo-1'), cached('g1', 'c-of-lo-1'), cached('g2', 'c-of-lo-2')]);
    expect(short.outcome).toMatchObject({ status: 'INSUFFICIENT_COVERAGE', selected: [] });
    expect(() => freezeAssessment({ solution: short, coverages: [], studentId: STUDENT, createdAt: AS_OF, path: 'OFFICIAL_MOCK', exam: { examTargetId: null, examVersionId: 'ev-1', assessmentComponentIds: [] } })).toThrow(/NOTHING_SELECTED/);
    expect(() => freezeAssessment({ solution: official(), coverages: BANK, studentId: STUDENT, createdAt: AS_OF, path: 'OFFICIAL_MOCK' })).toThrow(/EXAM_CONTEXT_REQUIRED/);
  });

  it('TECHNICAL_DEMO: scored, and NO consequential learner evidence, whatever the snapshot or the coverage says', async () => {
    // even with explicit item-level attribution and a snapshot that claims STUDENT, the instance's own audience wins
    const explicitBank = BANK.map((c) => ({ ...c, concepts: [{ canonicalConceptId: c.concepts[0].canonicalConceptId, role: 'PRIMARY' as const, basis: 'ITEM_ATTRIBUTION' as const }] }));
    const f = freezeAssessment({ solution: official(explicitBank), coverages: explicitBank, studentId: STUDENT, createdAt: AS_OF, path: 'OFFICIAL_MOCK', exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1'] } });
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: f, content_audience: 'TECHNICAL_DEMO', form: formOf(f) });
    const w = writer();
    const gaps = vi.fn(async () => [gapFacts('lo-1', 'C1', 0)]);
    const decide = vi.fn(async () => ({ any: 'thing' }));
    const r = await completeAssessmentEvidence({ record: { kind: 'EXAM_INSTANCE', id: 'inst-1' }, studentId: STUDENT, attemptRef: 'att-1', responses: f.items.map((i) => scored(i.key, 1)) }, deps(w, ['C1', 'C3'], { readExamGaps: gaps, nextDecision: decide }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.learnerEvidence).toBe('NO_CONSEQUENTIAL_LEARNER_EVIDENCE');
    expect(r.state.attributionOutcomes.every((o) => o.status === 'TECHNICAL_DEMO')).toBe(true);
    expect(r.state.score.meanFraction).toBe(1);
    expect(w.calls).toEqual([]);
    expect(r.state.examGaps).toBeNull();
    expect(r.state.nextDecision).toEqual({ status: 'NOT_REQUESTED' });
    expect(gaps).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    // the same snapshot on a STUDENT instance does produce evidence: the guard is the audience, not the content
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: f, content_audience: 'STUDENT', form: formOf(f) });
    const again = await completeAssessmentEvidence({ record: { kind: 'EXAM_INSTANCE', id: 'inst-1' }, studentId: STUDENT, attemptRef: 'att-1', responses: f.items.map((i) => scored(i.key, 1)) }, deps(w, ['C1', 'C3']));
    expect(again.ok && again.state.learnerEvidence).toBe('CONSEQUENTIAL');
  });
});

/* ================================================================== */

describe('B3 exactly-once, failure isolation and the post-assessment result', () => {
  const POOL = [cached('a', 'C1'), cached('b', 'C2'), cached('c', 'C3')];
  const setup = () => {
    const f = learning(POOL, ['C1', 'C2', 'C3']);
    store.quiz_sessions.set('qs-1', { student_id: STUDENT, assessment_snapshot: f });
    return { f, input: { record: { kind: 'QUIZ_SESSION' as const, id: 'qs-1' }, studentId: STUDENT, attemptRef: 'qs-1', responses: f.items.map((i) => scored(i.key, 1)) } };
  };

  it('REQUIRED idempotent retry, single and multi-concept: evidence once, deterministic result', async () => {
    const { input } = setup();
    const w = writer();
    const first = await completeAssessmentEvidence(input, deps(w, ['C1', 'C2', 'C3']));
    const second = await completeAssessmentEvidence(input, deps(w, ['C1', 'C2', 'C3']));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.state.evidence.map((e) => e.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
    expect(second.state.evidence.map((e) => e.status)).toEqual(['DUPLICATE_IDEMPOTENT', 'DUPLICATE_IDEMPOTENT', 'DUPLICATE_IDEMPOTENT']);
    expect(second.state.evidence.map((e) => e.operationKey)).toEqual(first.state.evidence.map((e) => e.operationKey));
    expect(second.state.attributionOutcomes).toEqual(first.state.attributionOutcomes);
    expect(second.state.coverage).toEqual(first.state.coverage);
    expect(second.state.diagnostics).toMatchObject({ duplicateCount: 3, knowledgeStateUpdates: 0 });
    expect(w.applied.size).toBe(3);
    expect(second.state.conceptStateChanges.every((c) => !c.changed)).toBe(true);
  });

  it('two concurrent completions of the same attempt commit one effect per (attempt, concept)', async () => {
    const { input } = setup();
    const w = writer();
    const results = await Promise.all([completeAssessmentEvidence(input, deps(w, ['C1', 'C2', 'C3'])), completeAssessmentEvidence(input, deps(w, ['C1', 'C2', 'C3']))]);
    expect(w.calls).toHaveLength(6);
    expect(w.applied.size).toBe(3);
    const statuses = results.flatMap((r) => (r.ok ? r.state.evidence.map((e) => e.status) : []));
    expect(statuses.filter((s) => s === 'APPLIED')).toHaveLength(3);
    expect(statuses.filter((s) => s === 'DUPLICATE_IDEMPOTENT')).toHaveLength(3);
    // the key is built from server-side identifiers only
    expect([...w.applied.keys()].sort()).toEqual(['QUIZ_SUBMISSION::qs-1::lc-C1', 'QUIZ_SUBMISSION::qs-1::lc-C2', 'QUIZ_SUBMISSION::qs-1::lc-C3']);
  });

  it('a different attempt on the same concept is a new logical action', async () => {
    const { f, input } = setup();
    store.quiz_sessions.set('qs-2', { student_id: STUDENT, assessment_snapshot: f });
    const w = writer();
    await completeAssessmentEvidence(input, deps(w, ['C1', 'C2', 'C3']));
    await completeAssessmentEvidence({ ...input, record: { kind: 'QUIZ_SESSION', id: 'qs-2' }, attemptRef: 'qs-2' }, deps(w, ['C1', 'C2', 'C3']));
    expect(w.applied.size).toBe(6);
    expect(await completeAssessmentEvidence({ ...input, attemptRef: 'qs-2' }, deps(w, ['C1']))).toEqual({ ok: false, reason: 'ATTEMPT_NOT_BOUND_TO_SNAPSHOT' });
  });

  it('partial failure: one concept cannot be written, the others are, and the score is untouched', async () => {
    const { input } = setup();
    const w = writer();
    w.failFor.add('lc-C2');
    const r = await completeAssessmentEvidence(input, deps(w, ['C1', 'C3'], { loadIdentities: async () => [canonical('C1'), canonical('C2')] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.evidence.map((e) => [e.canonicalConceptId, e.status, e.error])).toEqual([['C1', 'APPLIED', null], ['C2', 'WRITE_FAILED', 'writer unavailable']]);
    expect(r.state.attributionOutcomes.find((o) => o.canonicalConceptId === 'C3')).toMatchObject({ status: 'UNRESOLVED_CONCEPT' });
    expect(r.state.score).toMatchObject({ scored: 3, meanFraction: 1 });
    expect(r.state.coverage).toMatchObject({ intended: { canonicalConceptIds: ['C1', 'C2', 'C3'] }, scored: ['C1', 'C2', 'C3'], consequential: ['C1'] });
    expect(r.state.diagnostics).toMatchObject({ responseCount: 3, scoredCount: 3, attributedCount: 2, unresolvedCount: 1, failedWriteCount: 1, knowledgeStateUpdates: 1 });
    // a retry after the writer recovers completes the missing concept only
    w.failFor.clear();
    const retry = await completeAssessmentEvidence(input, deps(w, ['C1', 'C3'], { loadIdentities: async () => [canonical('C1'), canonical('C2')] }));
    expect(retry.ok && retry.state.evidence.map((e) => [e.canonicalConceptId, e.status])).toEqual([['C1', 'DUPLICATE_IDEMPOTENT'], ['C2', 'APPLIED']]);
  });

  it('PostAssessmentState is one self-contained result; a missing or foreign snapshot executes nothing', async () => {
    const { f, input } = setup();
    const w = writer();
    const logged: Record<string, unknown>[] = [];
    const r = await completeAssessmentEvidence({ ...input, responses: [scored(L('a'), 1), { itemKey: L('b'), responseRef: null, status: 'UNANSWERED', fraction: null }] }, deps(w, ['C1', 'C2', 'C3'], { log: (e) => logged.push(e), nextDecision: async () => null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.state).sort()).toEqual(['assessment', 'attemptRef', 'attributionOutcomes', 'conceptStateChanges', 'coverage', 'diagnostics', 'evidence', 'examGaps', 'learnerEvidence', 'nextDecision', 'score', 'studentId', 'unresolvedAttributions', 'v', 'verificationState']);
    expect(r.state.assessment).toEqual({ snapshotId: f.snapshotId, family: 'LEARNING', path: 'LEARNING_ACTIVITY', intent: 'CUSTOM_CONCEPT_PRACTICE', record: { kind: 'QUIZ_SESSION', id: 'qs-1' }, policy: f.policy });
    // it does not claim everything in the blueprint was evaluated
    expect(r.state.coverage).toEqual({ intended: { canonicalConceptIds: ['C1', 'C2', 'C3'], learningObjectiveIds: [] }, selected: ['C1', 'C2', 'C3'], answered: ['C1'], scored: ['C1'], consequential: ['C1'] });
    expect(r.state).toMatchObject({ examGaps: null, nextDecision: { status: 'NONE' }, verificationState: null, learnerEvidence: 'CONSEQUENTIAL' });
    // diagnostics carry counts and identifiers, never an answer
    expect(logged).toEqual([r.state.diagnostics]);
    expect(JSON.stringify(logged)).not.toMatch(/answer|content|prompt/i);
    store.quiz_sessions.set('legacy', { student_id: STUDENT, assessment_snapshot: null });
    expect(await completeAssessmentEvidence({ ...input, record: { kind: 'QUIZ_SESSION', id: 'legacy' }, attemptRef: 'legacy' }, deps(w, ['C1']))).toEqual({ ok: false, reason: 'NO_SNAPSHOT' });
    expect(await completeAssessmentEvidence({ ...input, record: { kind: 'QUIZ_SESSION', id: 'gone' }, attemptRef: 'gone' }, deps(w, ['C1']))).toEqual({ ok: false, reason: 'RECORD_NOT_FOUND' });
  });

  it('a decision authority that fails does not fail the assessment', async () => {
    const { input } = setup();
    const r = await completeAssessmentEvidence(input, deps(writer(), ['C1', 'C2', 'C3'], { nextDecision: async () => { throw new Error('snapshot unavailable'); } }));
    expect(r.ok && r.state.nextDecision).toEqual({ status: 'UNAVAILABLE', error: 'snapshot unavailable' });
    expect(r.ok && r.state.evidence.every((e) => e.status === 'APPLIED')).toBe(true);
  });
});

/* ================================================================== */

describe('B3 cross-curriculum continuity -- state is longitudinal, provenance is contextual', () => {
  it('the same concept assessed under two curricula writes to ONE learner state, each event keeping its own context', async () => {
    const a = learning([cached('qa', 'C1')], ['C1'], { curriculum: [{ structureVersionId: 'sv-sep', academicSubjectId: 'subj-sep' }] });
    const b = learning([cached('qb', 'C1')], ['C1'], { curriculum: [{ structureVersionId: 'sv-ib', academicSubjectId: 'subj-ib' }], createdAt: '2027-02-01T00:00:00.000Z' });
    store.quiz_sessions.set('qs-a', { student_id: STUDENT, assessment_snapshot: a });
    store.quiz_sessions.set('qs-b', { student_id: STUDENT, assessment_snapshot: b });
    const w = writer();
    const first = await completeAssessmentEvidence({ record: { kind: 'QUIZ_SESSION', id: 'qs-a' }, studentId: STUDENT, attemptRef: 'qs-a', responses: [scored(L('qa'), 0.3)] }, deps(w, ['C1']));
    const second = await completeAssessmentEvidence({ record: { kind: 'QUIZ_SESSION', id: 'qs-b' }, studentId: STUDENT, attemptRef: 'qs-b', responses: [scored(L('qb'), 1)] }, deps(w, ['C1']));
    // one learner concept, one state row, carried from A into B
    expect(w.calls.map((c) => c.conceptId)).toEqual(['lc-C1', 'lc-C1']);
    expect(first.ok && first.state.conceptStateChanges).toEqual([{ canonicalConceptId: 'C1', learnerConceptId: 'lc-C1', before: null, after: 'LEARNING', changed: true }]);
    expect(second.ok && second.state.conceptStateChanges).toEqual([{ canonicalConceptId: 'C1', learnerConceptId: 'lc-C1', before: 'LEARNING', after: 'DEVELOPING', changed: true }]);
    expect([...w.states.keys()]).toEqual(['lc-C1']);
    // each evidence event remembers where it was produced
    expect(w.calls.map((c) => (c.metadata!.assessment as any).curriculum)).toEqual([[{ structureVersionId: 'sv-sep', academicSubjectId: 'subj-sep' }], [{ structureVersionId: 'sv-ib', academicSubjectId: 'subj-ib' }]]);
    // the state key has no curriculum in it
    expect([...w.applied.keys()]).toEqual(['QUIZ_SUBMISSION::qs-a::lc-C1', 'QUIZ_SUBMISSION::qs-b::lc-C1']);
  });
});
