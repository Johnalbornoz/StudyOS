/**
 * B5-R -- two frozen decisions:
 *   1. the FrozenForm is the one authority for what an exam attempt serves; the FrozenAssessment references
 *      and verifies it, and never competes with it;
 *   2. independent evidence is stated explicitly by new canonical evidence; evidence without the statement
 *      keeps the historical reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const store = { quiz_sessions: new Map<string, any>(), exam_instances: new Map<string, any>() };
const statements: string[] = [];
vi.mock('@/lib/db', () => ({
  db: {
    query: async (sql: string, params: any[] = []) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      const update = /^UPDATE (quiz_sessions|exam_instances) SET assessment_snapshot/.exec(sql);
      if (update) {
        const row = store[update[1] as keyof typeof store].get(params[0]);
        if (row && row.student_id === params[2] && !row.assessment_snapshot) {
          row.assessment_snapshot = JSON.parse(params[1]);
          return { rows: [{ id: params[0] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      const select = /^SELECT [a-z_, ]+ FROM (quiz_sessions|exam_instances)/.exec(sql);
      if (select) {
        const row = store[select[1] as keyof typeof store].get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  },
}));
vi.mock('@/services/mastery.service', () => ({ updateMastery: async () => { throw new Error('inject the writer'); } }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: async () => [] }));
vi.mock('@/lib/catalog/concept-identity.service', () => ({ resolveStudentConceptIdentities: async () => [] }));

import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import type { ConceptIdentity } from '@/lib/catalog/concept-identity';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { projectEvidenceNeeds, solveLearningBlueprint, solveOfficialBlueprint, type EvidenceCountPolicy } from '@/lib/assessment-blueprint';
import { executionRefs, formPositionsHash, formPositionsOf, freezeAssessment, planEvidence, positionOf, readFrozenAssessment, snapshotMatchesForm, type FrozenAssessment, type ScoredResponse } from '@/lib/assessment-execution';
import { completeAssessmentEvidence, learningActivityFor, loadAssessmentSnapshot, persistAssessmentSnapshot } from '@/lib/assessment-execution/assessment-execution.service';
import { countsAsIndependent, evaluateEvidenceSufficiency, classifyIndependence, type EvidenceRow, type MasteryPolicy } from '@/services/knowledge-state.service';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-10T12:00:00.000Z';
const STUDENT = 'stu-1';
const canonical = (c: string): ConceptIdentity => ({ status: 'CANONICAL', learnerConceptId: `lc-${c}`, canonicalConceptId: c, basis: 'CREATED_FROM_CANONICAL' });
const cached = (id: string, concept: string, also: Array<[string, 'PRIMARY' | 'SUPPORTING']> = []): QuestionCoverage => {
  const c = coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: canonical(concept) });
  return { ...c, concepts: [...c.concepts, ...also.map(([canonicalConceptId, role]) => ({ canonicalConceptId, role, basis: 'ITEM_ATTRIBUTION' as const }))] };
};
const bank = (id: string, objective: string, concepts: string[], explicit = false): QuestionCoverage => {
  const c = coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 2, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' }, sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1,
    scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: concepts.map((canonicalConceptId) => ({ canonicalConceptId, relationType: 'FULL' as const })),
    ...(explicit ? { itemConcepts: [{ canonicalConceptId: concepts[0], role: 'PRIMARY' as const }] } : {}),
  });
  return c;
};
const position = (index: number, objective: string): FormPosition => ({ index, blueprintObjectiveTargetId: `bot-${index}`, assessmentComponentId: 'comp-1', learningObjectiveId: objective, questionType: null, difficultyRange: null });
const EXAM = { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1'] };
const BANK = [bank('i1', 'lo-1', ['C1', 'C2']), bank('i2', 'lo-1', ['C1', 'C2']), bank('i3', 'lo-2', ['C3'], true)];
const official = (coverages = BANK): FrozenAssessment =>
  freezeAssessment({ solution: solveOfficialBlueprint({ policy: { studentId: STUDENT, examTargetId: 'target-1', examVersionId: 'ev-1', blueprintId: 'bp', positions: [position(0, 'lo-1'), position(1, 'lo-1'), position(2, 'lo-2')] }, coverages }), coverages, studentId: STUDENT, createdAt: AS_OF, path: 'REDUCED_MOCK', exam: EXAM });
const learn = (coverages: QuestionCoverage[], concepts: string[], intent: 'CUSTOM_CONCEPT_PRACTICE' | 'MASTERY_CHECK' = 'CUSTOM_CONCEPT_PRACTICE'): FrozenAssessment => {
  const solution = solveLearningBlueprint({ policy: { studentId: STUDENT, intent, depth: 'QUICK', canonicalConceptIds: concepts, needs: projectEvidenceNeeds(concepts, [], POLICY, AS_OF) }, coverages, asOf: AS_OF });
  return freezeAssessment({ solution, coverages, studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', intent, activity: learningActivityFor(solution.requirement!.evidence!.activityType, intent) });
};
const formFor = (f: FrozenAssessment) => ({ v: 1, fidelity: 'REDUCED', slots: f.items.map((i) => ({ index: positionOf(i), approvedItemId: i.question.id, marks: i.marks })) });
const scored = (itemKey: string, fraction: number, hintsUsed = 0): ScoredResponse => ({ itemKey, responseRef: null, status: 'SCORED', fraction, hintsUsed });
const learner = (concepts: string[]) => ({ identities: concepts.map(canonical), subjectByLearnerConcept: new Map(concepts.map((c) => [`lc-${c}`, 'subject-1'])) });
const record = { kind: 'EXAM_INSTANCE' as const, id: 'inst-1' };

beforeEach(() => {
  store.quiz_sessions.clear();
  store.exam_instances.clear();
  statements.length = 0;
});

describe('B5-R form ownership -- the FrozenForm is what an exam attempt executes', () => {
  it('an exam snapshot references its form by hash; a learning snapshot has no form and freezes its own questions', () => {
    const exam = official();
    expect(exam.form).toEqual({ positionsHash: formPositionsHash([{ index: 0, itemId: 'i1' }, { index: 1, itemId: 'i2' }, { index: 2, itemId: 'i3' }]), positions: 3, frozenForm: null });
    expect(exam.form!.positionsHash).toMatch(/^[0-9a-f]{64}$/);
    const learning = learn([cached('q1', 'C1')], ['C1']);
    expect(learning.form).toBeNull();
    expect(executionRefs(learning)).toEqual([{ order: 0, slotIndex: null, question: { store: 'LEARNING_ITEM_CACHE', id: 'q1' } }]);
    // a published fixed form is referenced by its own identity as well
    const fixed = freezeAssessment({ solution: solveOfficialBlueprint({ policy: { studentId: STUDENT, examTargetId: 'target-1', examVersionId: 'ev-1', blueprintId: 'bp', positions: [position(0, 'lo-2')] }, coverages: BANK }), coverages: BANK, studentId: STUDENT, createdAt: AS_OF, path: 'REDUCED_MOCK', exam: EXAM, frozenForm: { id: 'ff-1', formHash: 'a'.repeat(64) } });
    expect(fixed.form!.frozenForm).toEqual({ id: 'ff-1', formHash: 'a'.repeat(64) });
  });

  it('exam form items = executed exam items: the snapshot describes exactly the positions of the stored form', () => {
    const exam = official();
    const form = formFor(exam);
    expect(snapshotMatchesForm(exam, formPositionsOf(form))).toBe(true);
    expect(executionRefs(exam).map((r) => [r.slotIndex, r.question.id])).toEqual(formPositionsOf(form).map((p) => [p.index, p.itemId]));
    // position order is identity: the same items in another order are another form
    expect(formPositionsHash([{ index: 0, itemId: 'i2' }, { index: 1, itemId: 'i1' }, { index: 2, itemId: 'i3' }])).not.toBe(exam.form!.positionsHash);
    // input order is not
    expect(formPositionsHash([{ index: 2, itemId: 'i3' }, { index: 0, itemId: 'i1' }, { index: 1, itemId: 'i2' }])).toBe(exam.form!.positionsHash);
  });

  it('a snapshot is stored only for the form it was frozen for, and never writes the form', async () => {
    const exam = official();
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: null, content_audience: 'STUDENT', form: null });
    expect(await persistAssessmentSnapshot(record, exam)).toEqual({ ok: false, reason: 'FORM_NOT_FROZEN' });
    store.exam_instances.get('inst-1').form = { v: 1, slots: [{ index: 0, approvedItemId: 'i1' }, { index: 1, approvedItemId: 'OTHER' }, { index: 2, approvedItemId: 'i3' }] };
    expect(await persistAssessmentSnapshot(record, exam)).toEqual({ ok: false, reason: 'FORM_MISMATCH' });
    const form = formFor(exam);
    store.exam_instances.get('inst-1').form = form;
    const before = JSON.stringify(form);
    expect(await persistAssessmentSnapshot(record, exam)).toEqual({ ok: true, stored: 'NEW' });
    expect(JSON.stringify(store.exam_instances.get('inst-1').form)).toBe(before);
    // every write statement touches the snapshot column only
    const writes = statements.filter((s) => /^(UPDATE|INSERT|DELETE)/.test(s));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^UPDATE exam_instances SET assessment_snapshot = \$2::jsonb WHERE/);
    expect(writes[0]).not.toMatch(/form\s*=/);
  });

  it('editing the assessment provenance cannot change the frozen form, and an edited or foreign snapshot does not execute', async () => {
    const exam = official();
    const form = formFor(exam);
    store.exam_instances.set('inst-1', { student_id: STUDENT, assessment_snapshot: exam, content_audience: 'STUDENT', form });
    expect((await loadAssessmentSnapshot(record)).ok).toBe(true);
    // someone edits the stored provenance to point at other items: refused, and the form is what it was
    const edited = JSON.parse(JSON.stringify(exam));
    edited.items[0].question.id = 'OTHER';
    store.exam_instances.get('inst-1').assessment_snapshot = edited;
    expect(await loadAssessmentSnapshot(record)).toEqual({ ok: false, reason: 'DIGEST_MISMATCH' });
    expect(store.exam_instances.get('inst-1').form).toEqual(form);
    // a snapshot that is intact but was frozen for ANOTHER form is refused too
    store.exam_instances.get('inst-1').assessment_snapshot = official([bank('x1', 'lo-1', ['C1']), bank('x2', 'lo-1', ['C1']), bank('x3', 'lo-2', ['C3'])]);
    expect(await loadAssessmentSnapshot(record)).toEqual({ ok: false, reason: 'FORM_MISMATCH' });
    // and the form changing under an intact snapshot is refused as well: the attempt would not be what was frozen
    store.exam_instances.get('inst-1').assessment_snapshot = exam;
    store.exam_instances.get('inst-1').form = { ...form, slots: form.slots.slice(0, 2) };
    expect(await loadAssessmentSnapshot(record)).toEqual({ ok: false, reason: 'FORM_MISMATCH' });
    const loop = await completeAssessmentEvidence({ record, studentId: STUDENT, attemptRef: 'att-1', responses: [] }, { resolveExamAttempt: async () => ({ examTargetId: 'target-1' }), log: () => undefined });
    expect(loop).toEqual({ ok: false, reason: 'FORM_MISMATCH' });
  });

  it('the snapshot keeps provenance per position; it adds no second list of what to serve', () => {
    const exam = official();
    // each item entry is keyed to a form position and carries what the blueprint expected of it
    expect(exam.items.map((i) => [positionOf(i), i.question.id, i.coverage.map((c) => c.role).join()])).toEqual([[0, 'i1', 'UNSPECIFIED,UNSPECIFIED'], [1, 'i2', 'UNSPECIFIED,UNSPECIFIED'], [2, 'i3', 'PRIMARY']]);
    expect(readFrozenAssessment(JSON.parse(JSON.stringify(exam)))).toEqual({ ok: true, frozen: exam });
    const src = read('src/lib/assessment-execution/assessment-execution.service.ts');
    expect(src).toMatch(/if \(!snapshotMatchesForm\(read\.frozen, positions\)\) return \{ ok: false, reason: 'FORM_MISMATCH' \}/);
    expect(src).toMatch(/if \(!snapshotMatchesForm\(frozen, positions\)\) return \{ ok: false, reason: 'FORM_MISMATCH' \}/);
    // no migration was needed: the DB shape rule is still snapshotId + items
    expect(read('database/migrations/20261110_1800_assessment_snapshot.sql')).toMatch(/assessment_snapshot \? 'snapshotId' AND assessment_snapshot \? 'items'/);
  });
});

describe('B5-R independence -- stated by new evidence, inferred only for historical evidence', () => {
  const meta = (plan: ReturnType<typeof planEvidence>) => plan.writes.map((w) => [w.canonicalConceptId, w.metadata.independenceEligible]);

  it('ordinary practice with no hints: evidence counts for learning, and is NOT independent', () => {
    const plan = planEvidence(learn([cached('q1', 'C1')], ['C1']), { assessmentRef: 'qs-1' }, [scored('LEARNING_ITEM_CACHE:q1', 1)], learner(['C1']));
    expect(plan.writes).toHaveLength(1);
    expect(meta(plan)).toEqual([['C1', false]]);
    expect(plan.writes[0].evidence.result).toBe('correct');
  });

  it('independent PROVE, no hints, single PRIMARY concept: independent', () => {
    const plan = planEvidence(learn([cached('p1', 'C1')], ['C1'], 'MASTERY_CHECK'), { assessmentRef: 'qs-1' }, [scored('LEARNING_ITEM_CACHE:p1', 1)], learner(['C1']));
    expect(meta(plan)).toEqual([['C1', true]]);
  });

  it('an independent activity answered with a hint is not independent evidence', () => {
    const plan = planEvidence(learn([cached('p1', 'C1')], ['C1'], 'MASTERY_CHECK'), { assessmentRef: 'qs-1' }, [scored('LEARNING_ITEM_CACHE:p1', 1, 1)], learner(['C1']));
    expect(meta(plan)).toEqual([['C1', false]]);
    // one hinted response among several makes the whole concept event non-independent
    const two = planEvidence(learn([cached('p1', 'C1'), cached('p2', 'C2')], ['C1', 'C2'], 'MASTERY_CHECK'), { assessmentRef: 'qs-1' }, [scored('LEARNING_ITEM_CACHE:p1', 1, 0), scored('LEARNING_ITEM_CACHE:p2', 1, 2)], learner(['C1', 'C2']));
    expect(meta(two)).toEqual([['C1', true], ['C2', false]]);
  });

  it('exam evidence is never independent learning evidence, even with explicit item attribution', () => {
    const exam = official();
    const plan = planEvidence(exam, { assessmentRef: 'att-1', examTargetId: 'target-1' }, exam.items.map((i) => scored(i.key, 1)), learner(['C1', 'C2', 'C3']));
    expect(meta(plan)).toEqual([['C3', false]]);
  });

  it('the projector reads the statement when it exists and the historical rule when it does not', () => {
    const row = (aiAssistanceType: string, independenceEligible?: boolean | null): EvidenceRow => ({ sourceType: 'PRACTICE_QUIZ', result: 'correct', scorePercent: 100, aiAssistanceType, timestamp: AS_OF, independenceEligible });
    // new canonical evidence
    expect(countsAsIndependent(row('NONE', false))).toBe(false);
    expect(countsAsIndependent(row('NONE', true))).toBe(true);
    // historical evidence (no statement): exactly as before
    expect(countsAsIndependent(row('NONE'))).toBe(true);
    expect(countsAsIndependent(row('NONE', null))).toBe(true);
    expect(countsAsIndependent(row('HINT'))).toBe(false);
    expect(countsAsIndependent(row('TUTOR_EXPLANATION', null))).toBe(false);
    const policy = { minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 } as MasteryPolicy;
    // three unassisted practices under the new rule: learning evidence 3, independent 0
    expect(evaluateEvidenceSufficiency([row('NONE', false), row('NONE', false), row('NONE', false)], policy)).toEqual({ evidenceCount: 3, independentEvidenceCount: 0, passed: false });
    // the same three rows written before the rule existed are read as they always were
    expect(evaluateEvidenceSufficiency([row('NONE'), row('NONE'), row('NONE')], policy)).toEqual({ evidenceCount: 3, independentEvidenceCount: 3, passed: true });
    // a mixed history: two historical unassisted rows, one new practice, one new proof
    expect(evaluateEvidenceSufficiency([row('NONE'), row('NONE'), row('NONE', false), row('NONE', true)], policy)).toEqual({ evidenceCount: 4, independentEvidenceCount: 3, passed: true });
    // the independence DIMENSION uses the same rows (no second formula)
    expect(classifyIndependence([row('NONE', true), row('NONE')].filter(countsAsIndependent))).toBe(100);
    expect(classifyIndependence([row('NONE', false), row('NONE', false)].filter(countsAsIndependent))).toBeNull();
  });

  it('one rule, applied in the two places the projector reads independence; nothing is backfilled', () => {
    const ks = read('src/services/knowledge-state.service.ts');
    expect(ks.match(/rows\.filter\(countsAsIndependent\)/g)).toHaveLength(2);
    expect(ks).not.toMatch(/rows\.filter\(\(r\) => r\.aiAssistanceType === 'NONE'\)/);
    expect(ks).toMatch(/metadata->>'independenceEligible' AS independence_eligible/);
    // no migration, no bulk update: the statement lives in the evidence metadata the writer already stores
    expect(ks).not.toMatch(/UPDATE learning_evidence/);
    const plan = read('src/lib/assessment-execution/evidence-plan.ts');
    expect(plan.match(/independenceEligible: /g)).toHaveLength(2);
    expect(plan).toMatch(/independenceEligible: bucket\.every\(\(c\) => c\.independent\)/);
    expect(plan).toMatch(/independenceEligible: false,/);
    // the legacy write sites are unchanged: they write no statement, so their evidence keeps the historical reading
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).not.toMatch(/independenceEligible/);
    expect(read('src/lib/simulation/scoring.service.ts')).not.toMatch(/independenceEligible/);
  });
});
