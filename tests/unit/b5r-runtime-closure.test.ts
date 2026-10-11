/**
 * B5-R -- runtime closure: the completion authority, the exam-side boundary, and the route guards.
 * The database is mocked; the same paths run on a real Postgres in scripts/operations/b5-real-postgres-evidence-loop.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sessions = new Map<string, any>();
const instances = new Map<string, any>();
const responses = new Map<string, any[]>();
const writes: string[] = [];
vi.mock('@/lib/db', () => ({
  db: {
    query: async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^(UPDATE|INSERT|DELETE)/.test(s)) writes.push(s);
      if (/FROM quiz_sessions WHERE id = \$1$/.test(s) && /\(assessment_snapshot IS NOT NULL\) AS canonical/.test(s)) {
        const row = sessions.get(params[0]);
        return { rows: row ? [{ ...row, canonical: !!row.assessment_snapshot, expired: row.expired === true }] : [] };
      }
      if (/^UPDATE quiz_sessions SET status = 'completed'/.test(s)) {
        const row = sessions.get(params[0]);
        if (row?.status === 'active') row.status = 'completed';
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT student_id, status, questions, assessment_snapshot, \(expires_at <= now\(\)\) AS expired FROM quiz_sessions/.test(s)) return { rows: sessions.has(params[0]) ? [sessions.get(params[0])] : [] };
      if (/^SELECT id, name FROM canonical_concepts/.test(s)) return { rows: (params[0] as string[]).filter((id) => id !== 'C-unnamed').map((id) => ({ id, name: `Concept ${id}` })) };
      if (/^SELECT ei\.student_id, ei\.exam_profile_id/.test(s)) return { rows: instances.has(params[0]) ? [instances.get(params[0])] : [] };
      if (/^SELECT form FROM exam_instances/.test(s)) return { rows: instances.has(params[0]) ? [{ form: instances.get(params[0]).form }] : [] };
      if (/^UPDATE exam_instances SET assessment_snapshot/.test(s)) {
        const row = instances.get(params[0]);
        if (row && row.student_id === params[2] && !row.assessment_snapshot) {
          row.assessment_snapshot = JSON.parse(params[1]);
          return { rows: [{ id: params[0] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/^SELECT assessment_snapshot, content_audience, form FROM exam_instances/.test(s)) return { rows: instances.has(params[0]) ? [instances.get(params[0])] : [] };
      if (/^SELECT student_id, assessment_snapshot FROM exam_instances/.test(s)) return { rows: instances.has(params[0]) ? [instances.get(params[0])] : [] };
      if (/^SELECT ei\.id AS instance_id, sa\.exam_attempt_id/.test(s)) {
        const hit = [...instances.entries()].find(([, i]) => i.simulation_attempt_id === params[0] && i.student_id === params[1] && i.assessment_snapshot);
        return { rows: hit ? [{ instance_id: hit[0], exam_attempt_id: hit[1].exam_attempt_id }] : [] };
      }
      if (/^SELECT id, approved_item_id, score, max_score, review_status FROM exam_attempt_item_responses/.test(s)) return { rows: responses.get(params[0]) ?? [] };
      throw new Error(`unexpected SQL: ${s}`);
    },
  },
}));
vi.mock('@/services/mastery.service', () => ({ updateMastery: async () => { throw new Error('inject'); } }));
vi.mock('@/services/knowledge-state.service', () => ({ getConceptKnowledgeState: async () => null }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: async () => [] }));
vi.mock('@/lib/catalog/concept-identity.service', () => ({ resolveStudentConceptIdentities: async () => [] }));
vi.mock('@/lib/assessment-blueprint/assessment-blueprint.service', () => ({ solveLearningForStudent: async () => ({ ok: false, issues: [] }) }));
vi.mock('@/lib/quiz/grade-question', () => ({ gradeQuizAnswer: async () => { throw new Error('inject the grader'); } }));
vi.mock('@/lib/assessment-foundation/question-coverage.service', () => ({ loadQuestionCoverage: async () => [] }));

import { coverageOfReviewedBankItem, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { freezeExamInstanceProvenance, formPositionsHash, readFrozenAssessment } from '@/lib/assessment-execution';
import { completeLearningAssessment } from '@/lib/assessment-execution/assessment-completion.service';
import { attachExamInstanceProvenance, completeExamAssessmentEvidence } from '@/lib/assessment-execution/assessment-exam.service';
import { coverageOfLearningCacheItem } from '@/lib/assessment-foundation/question-coverage';
import { projectEvidenceNeeds, solveLearningBlueprint } from '@/lib/assessment-blueprint';
import { freezeAssessment } from '@/lib/assessment-execution';
import { learningActivityFor } from '@/lib/assessment-execution/assessment-execution.service';
import { learningRunForStudent } from '@/lib/assessment-experience/assessment-experience.service';
import { hiddenFieldsOf, launchRequestOfQuery } from '@/app/dashboard/assessment/launch-params';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const STUDENT = 'stu-1';
const AS_OF = '2026-10-10T12:00:00.000Z';

const bank = (id: string, objective: string, concepts: string[], primary?: string): QuestionCoverage =>
  coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 2 }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE', usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'],
    examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null, bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' },
    sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' },
    objectiveConcepts: concepts.map((canonicalConceptId) => ({ canonicalConceptId, relationType: 'FULL' as const })), ...(primary ? { itemConcepts: [{ canonicalConceptId: primary, role: 'PRIMARY' as const }] } : {}),
  });

beforeEach(() => {
  sessions.clear();
  instances.clear();
  responses.clear();
  writes.length = 0;
});

describe('B5-R completion authority (learning)', () => {
  const question = (key: string, text: string) => ({ id: key, conceptId: 'lc-C1', type: 'multiple_choice', answerFormat: 'single_choice', question: text, correctAnswer: 'a', explanation: '', assessmentItemKey: key });
  const session = (over: object = {}) => ({ student_id: STUDENT, subject_id: 'subject-1', status: 'active', language: 'es', evidence_mode: 'PRACTICE', questions: [question('LEARNING_ITEM_CACHE:q1', 'one'), question('LEARNING_ITEM_CACHE:q2', 'two')], hints_used_questions: [1], assessment_snapshot: { snapshotId: 'x' }, ...over });
  const loopOk = (async (input: any) => ({ ok: true as const, state: { received: input } as never })) as never;

  it('grades each FROZEN question once with the existing grader and hands scored responses to the one loop', async () => {
    sessions.set('s1', session());
    const graded: string[] = [];
    let received: any = null;
    const r = await completeLearningAssessment(
      { studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'LEARNING_ITEM_CACHE:q2', answer: 'a' }, { itemKey: 'LEARNING_ITEM_CACHE:q1', answer: 'b' }, { itemKey: 'LEARNING_ITEM_CACHE:not-in-session', answer: 'a' }] },
      { grade: async (q, a) => { graded.push(`${q.id}=${a}`); return { score: a === 'a' ? 1 : 0.25 }; }, loop: (async (input: any) => { received = input; return { ok: true as const, state: {} as never }; }) as never }
    );
    expect(r.ok).toBe(true);
    // session order, one call per frozen question; the answer to a question outside the session is ignored
    expect(graded).toEqual(['LEARNING_ITEM_CACHE:q1=b', 'LEARNING_ITEM_CACHE:q2=a']);
    expect(received).toMatchObject({ record: { kind: 'QUIZ_SESSION', id: 's1' }, studentId: STUDENT, attemptRef: 's1' });
    expect(received.responses).toEqual([
      { itemKey: 'LEARNING_ITEM_CACHE:q1', responseRef: null, status: 'SCORED', fraction: 0.25, hintsUsed: 0 },
      // the hint the SESSION recorded for question index 1 is what counts; the request cannot erase it
      { itemKey: 'LEARNING_ITEM_CACHE:q2', responseRef: null, status: 'SCORED', fraction: 1, hintsUsed: 1 },
    ]);
    expect(sessions.get('s1').status).toBe('completed');
  });

  it('an unanswered frozen question is UNANSWERED, never graded and never a failure', async () => {
    sessions.set('s1', session());
    let received: any = null;
    let calls = 0;
    await completeLearningAssessment({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'LEARNING_ITEM_CACHE:q1', answer: '   ' }] }, { grade: async () => { calls += 1; return { score: 1 }; }, loop: (async (i: any) => { received = i; return { ok: true as const, state: {} as never }; }) as never });
    expect(calls).toBe(0);
    expect(received.responses.map((x: any) => x.status)).toEqual(['UNANSWERED', 'UNANSWERED']);
  });

  it('refuses a legacy session, another Student, an expired session and a failed grading -- writing nothing', async () => {
    sessions.set('legacy', session({ assessment_snapshot: null }));
    sessions.set('expired', session({ expired: true }));
    sessions.set('s1', session());
    const deps = { grade: async () => ({ score: 1 }), loop: loopOk };
    expect(await completeLearningAssessment({ studentId: STUDENT, sessionId: 'legacy', answers: [] }, deps)).toEqual({ ok: false, reason: 'NOT_CANONICAL' });
    expect(await completeLearningAssessment({ studentId: 'someone-else', sessionId: 's1', answers: [] }, deps)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await completeLearningAssessment({ studentId: STUDENT, sessionId: 'missing', answers: [] }, deps)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await completeLearningAssessment({ studentId: STUDENT, sessionId: 'expired', answers: [] }, deps)).toEqual({ ok: false, reason: 'EXPIRED' });
    let looped = false;
    const failed = await completeLearningAssessment({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'LEARNING_ITEM_CACHE:q1', answer: 'a' }] }, { grade: async () => { throw new Error('grader down'); }, loop: (async () => { looped = true; return { ok: true as const, state: {} as never }; }) as never });
    expect(failed).toMatchObject({ ok: false, reason: 'GRADING_FAILED' });
    expect(looped).toBe(false);
    expect(writes).toEqual([]);
    expect(sessions.get('s1').status).toBe('active');
  });

  it('the completion authority writes no evidence itself and builds no key', () => {
    const src = read('src/lib/assessment-execution/assessment-completion.service.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/updateMastery|learning_evidence|mastery_records|concept_knowledge_state|buildOperationKey|operationType|planEvidence\(/);
    expect(src.match(/deps\.loop\(/g)).toHaveLength(1);
    expect(src.match(/deps\.grade\(/g)).toHaveLength(1);
    expect(src.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(src).toMatch(/UPDATE quiz_sessions SET status = 'completed'/);
  });
});

describe('B5-R exam instance: provenance at start, canonical evidence at completion', () => {
  const form = { v: 1, fidelity: 'REDUCED', slots: [{ index: 0, approvedItemId: 'i1' }, { index: 1, approvedItemId: 'i2' }, { index: 2, approvedItemId: null }] };
  const instance = (over: object = {}) => ({ student_id: STUDENT, exam_profile_id: 'target-1', exam_version_id: 'ev-1', component_ids: ['comp-1'], mode: 'MOCK', form, content_audience: 'STUDENT', simulation_type: 'REDUCED_MOCK', simulation_attempt_id: 'sim-1', exam_attempt_id: 'att-1', assessment_snapshot: null, ...over });
  const coverage = async () => [bank('i1', 'lo-1', ['C1', 'C2']), bank('i2', 'lo-2', ['C3'], 'C3')];
  const on = { enabled: () => true, loadCoverage: coverage as never };

  it('does nothing while canonical execution is off', async () => {
    instances.set('inst-1', instance());
    expect(await attachExamInstanceProvenance('inst-1', AS_OF, { loadCoverage: coverage as never })).toEqual({ attached: false, reason: 'DISABLED' });
    expect(writes).toEqual([]);
  });

  it('attaches a FrozenAssessment that references the instance form and never touches it', async () => {
    instances.set('inst-1', instance());
    const out = await attachExamInstanceProvenance('inst-1', AS_OF, on);
    expect(out).toMatchObject({ attached: true, stored: 'NEW' });
    const stored = readFrozenAssessment(instances.get('inst-1').assessment_snapshot);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const f = stored.frozen;
    // the form's own positions (an unfilled / generated position is not a bank item and is not described)
    expect(f.form).toEqual({ positionsHash: formPositionsHash([{ index: 0, itemId: 'i1' }, { index: 1, itemId: 'i2' }]), positions: 2, frozenForm: null });
    expect(f.items.map((i) => [i.slotIndex, i.question.id, i.coverage.map((c) => `${c.role}:${c.basis}`).join()])).toEqual([[0, 'i1', 'UNSPECIFIED:OBJECTIVE_MAPPING,UNSPECIFIED:OBJECTIVE_MAPPING'], [1, 'i2', 'PRIMARY:ITEM_ATTRIBUTION']]);
    // the stored attempt type decided by B1 is only restated; the policy is the official blueprint of the version
    expect(f).toMatchObject({ family: 'OFFICIAL_EXAM', path: 'REDUCED_MOCK', policy: { id: 'official-blueprint', version: 'ev-1' }, exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: ['comp-1'] }, activity: null });
    expect(JSON.stringify(instances.get('inst-1').form)).toBe(JSON.stringify(form));
    expect(writes.every((w) => /^UPDATE exam_instances SET assessment_snapshot = /.test(w))).toBe(true);
    // idempotent
    expect(await attachExamInstanceProvenance('inst-1', AS_OF, on)).toMatchObject({ attached: true, stored: 'ALREADY_STORED' });
  });

  it('practice, challenge and mock keep their B1 paths; a technical demo is marked as one', async () => {
    const path = async (over: object) => { instances.set('x', instance(over)); await attachExamInstanceProvenance('x', AS_OF, on); const s = readFrozenAssessment(instances.get('x').assessment_snapshot); instances.delete('x'); return s.ok ? [s.frozen.family, s.frozen.path, s.frozen.contentAudience] : null; };
    expect(await path({ mode: 'PRACTICE', simulation_type: 'EXAM_PRACTICE' })).toEqual(['EXAM_PREPARATION', 'EXAM_PRACTICE', 'STUDENT']);
    expect(await path({ mode: 'CHALLENGE', simulation_type: 'EXAM_CHALLENGE' })).toEqual(['EXAM_PREPARATION', 'EXAM_CHALLENGE', 'STUDENT']);
    expect(await path({ mode: 'MOCK', simulation_type: 'FULL_MOCK', form: { ...form, fidelity: 'FULL' } })).toEqual(['OFFICIAL_EXAM', 'OFFICIAL_MOCK', 'STUDENT']);
    expect(await path({ content_audience: 'TECHNICAL_DEMO' })).toEqual(['OFFICIAL_EXAM', 'REDUCED_MOCK', 'TECHNICAL_DEMO']);
  });

  it('a start is never blocked: no form, no coverage or no instance leaves the attempt LEGACY', async () => {
    instances.set('no-form', instance({ form: null }));
    instances.set('inst-1', instance());
    expect(await attachExamInstanceProvenance('no-form', AS_OF, on)).toEqual({ attached: false, reason: 'FORM_NOT_FROZEN' });
    expect(await attachExamInstanceProvenance('missing', AS_OF, on)).toEqual({ attached: false, reason: 'INSTANCE_NOT_FOUND' });
    expect(await attachExamInstanceProvenance('inst-1', AS_OF, { enabled: () => true, loadCoverage: (async () => [bank('i1', 'lo-1', ['C1'])]) as never })).toMatchObject({ attached: false, reason: 'COVERAGE_UNAVAILABLE', detail: 'COVERAGE_MISSING_FOR_SELECTED' });
    expect(instances.get('inst-1').assessment_snapshot).toBeNull();
    const hook = read('src/lib/exam-core/exam-instance.service.ts');
    expect(hook).toMatch(/await attachExamInstanceProvenance\(instance\.id, new Date\(\)\.toISOString\(\)\)\s+\.then\(/);
    expect(hook.indexOf('attachExamInstanceProvenance(instance.id')).toBeGreaterThan(hook.indexOf("SET status = 'IN_PROGRESS', simulation_attempt_id = $2"));
  });

  it('completion: the attempt\'s own stored scores go to the loop; a legacy attempt is not processed', async () => {
    instances.set('inst-1', instance());
    await attachExamInstanceProvenance('inst-1', AS_OF, on);
    responses.set('att-1', [
      { id: 'r1', approved_item_id: 'i1', score: '1', max_score: '2', review_status: 'NONE' },
      { id: 'r2', approved_item_id: 'i2', score: '2', max_score: '2', review_status: 'REVIEW_REQUIRED' },
    ]);
    const applied: any[] = [];
    const r = await completeExamAssessmentEvidence('sim-1', STUDENT, {
      resolveExamAttempt: async () => ({ examTargetId: 'target-1' }),
      loadIdentities: async () => [{ status: 'CANONICAL', learnerConceptId: 'lc-C3', canonicalConceptId: 'C3', basis: 'CREATED_FROM_CANONICAL' }],
      loadSubjects: async (ids) => new Map(ids.map((id) => [id, 'subject-1'])),
      readMasteryState: async () => null,
      readExamGaps: async () => [],
      updateMastery: (async (i: any) => { applied.push(i); return { oldMastery: 0, newMastery: 1, delta: 1, confidenceScore: 0, eventId: 'e' }; }) as never,
      log: () => undefined,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // half marks on a derived-only item: scored, no evidence. The explicit item awaits review: not evidence yet.
    expect(r.state.score).toMatchObject({ items: 2, scored: 1, pendingReview: 1, marks: { obtained: 1, available: 4 } });
    expect(r.state.attributionOutcomes.map((o) => [o.itemKey, o.status])).toEqual([['REVIEWED_EXAM_BANK:i1', 'DERIVED_ONLY'], ['REVIEWED_EXAM_BANK:i1', 'DERIVED_ONLY'], ['REVIEWED_EXAM_BANK:i2', 'NOT_SCORED']]);
    expect(applied).toEqual([]);
    // once reviewed, the same call attributes the explicit item, with exam scope, never as independent evidence
    responses.get('att-1')![1].review_status = 'REVIEWED';
    const again = await completeExamAssessmentEvidence('sim-1', STUDENT, { resolveExamAttempt: async () => ({ examTargetId: 'target-1' }), loadIdentities: async () => [{ status: 'CANONICAL', learnerConceptId: 'lc-C3', canonicalConceptId: 'C3', basis: 'CREATED_FROM_CANONICAL' }], loadSubjects: async (ids) => new Map(ids.map((id) => [id, 'subject-1'])), readMasteryState: async () => null, readExamGaps: async () => [], updateMastery: (async (i: any) => { applied.push(i); return { oldMastery: 0, newMastery: 1, delta: 1, confidenceScore: 0, eventId: 'e' }; }) as never, log: () => undefined });
    expect(again.ok && again.state.evidence.map((e) => e.canonicalConceptId)).toEqual(['C3']);
    expect(applied[0]).toMatchObject({ conceptId: 'lc-C3', identity: { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: 'att-1.1' }, metadata: { independenceEligible: false, examScope: { examTargetId: 'target-1', examAttemptId: 'att-1' } } });
    // a legacy attempt (no snapshot)
    instances.set('legacy', instance({ simulation_attempt_id: 'sim-legacy', assessment_snapshot: null }));
    expect(await completeExamAssessmentEvidence('sim-legacy', STUDENT)).toEqual({ ok: false, reason: 'NOT_CANONICAL' });
    expect(await completeExamAssessmentEvidence('sim-1', 'someone-else')).toEqual({ ok: false, reason: 'NOT_CANONICAL' });
  });

  it('the Exam Core result is final before and regardless of attribution', () => {
    const post = read('src/lib/exam-core/post-completion.ts');
    expect(post.indexOf('scoreAndRecordAttemptResult(attemptId)')).toBeLessThan(post.indexOf('completeExamAssessmentEvidence(attemptId, studentId)'));
    expect(post).toMatch(/try \{\s+await completeExamAssessmentEvidence\(attemptId, studentId\);\s+\} catch \(e\) \{/);
    expect(post).toMatch(/return \{ result, gapRefresh \};/);
    // the exam-side module changes no form, score, attempt type or fallback
    const src = read('src/lib/assessment-execution/assessment-exam.service.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|deriveInstanceAttemptType|mayUseGeneratedFallback|updateMastery\(|form\s*=/);
  });

  it('provenance of an existing form selects nothing', () => {
    const f = freezeExamInstanceProvenance({ positions: [{ index: 1, itemId: 'i2' }, { index: 0, itemId: 'i1' }], coverages: [bank('i1', 'lo-1', ['C1']), bank('i2', 'lo-2', ['C3'], 'C3'), bank('extra', 'lo-9', ['C9'])], studentId: STUDENT, createdAt: AS_OF, path: 'EXAM_PRACTICE', exam: { examTargetId: 'target-1', examVersionId: 'ev-1', assessmentComponentIds: [] } });
    expect(f.items.map((i) => i.question.id)).toEqual(['i1', 'i2']);
    expect(f.items.every((i) => i.intended.length === 0 && i.reasons.join() === 'FILLS_OFFICIAL_SLOT')).toBe(true);
    expect(() => freezeExamInstanceProvenance({ positions: [{ index: 0, itemId: 'i1' }], coverages: [], studentId: STUDENT, createdAt: AS_OF, path: 'EXAM_PRACTICE', exam: { examTargetId: null, examVersionId: 'ev-1', assessmentComponentIds: [] } })).toThrow(/COVERAGE_MISSING_FOR_SELECTED/);
    expect(() => freezeExamInstanceProvenance({ positions: [{ index: 0, itemId: 'i1' }], coverages: [bank('i1', 'lo-1', ['C1'])], studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', exam: { examTargetId: null, examVersionId: 'ev-1', assessmentComponentIds: [] } })).toThrow(/PATH_FAMILY_MISMATCH/);
  });
});

describe('B5-R routes', () => {
  const start = read('src/app/api/assessments/learning/start/route.ts');
  const complete = read('src/app/api/assessments/learning/[sessionId]/complete/route.ts');

  it('the start route exists only under the cutover flag and passes intent to the one start authority', () => {
    expect(start.indexOf("if (!isSnapshotExecutionEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });")).toBeLessThan(start.indexOf('await verifyAuth()'));
    expect(start).toMatch(/parseLaunchRequest\(/);
    expect(start.match(/startLearningAssessment\(/g)).toHaveLength(1);
    // the Student is the signed-in one; nothing in the request names a Student, a question or a count
    expect(start).toMatch(/const studentId = await getOrCreateStudentId\(authContext\.userId\);/);
    expect(start).not.toMatch(/studentId: (v|body|parsed)\.|questionIds|maxQuestions|solveLearning|freezeAssessment|storeQuiz|generate-and-take/);
  });

  it('the completion route calls the one completion authority and returns its PostAssessmentState', () => {
    expect(complete.match(/completeLearningAssessment\(/g)).toHaveLength(1);
    expect(complete).toMatch(/data: \{ state: result\.state \}/);
    expect(complete).not.toMatch(/updateMastery|gradeQuizAnswer|buildOperationKey|learning_evidence|sourceType|evidenceMode|conceptId/);
    // the request carries answers only
    expect(complete).toMatch(/z\.strictObject\(\{ answers: z\.array\(z\.strictObject\(\{ itemKey: [^}]+, answer: [^}]+\}\)\)/);
  });

  it('with the flag off the delivered runtime is exactly the legacy one', () => {
    // no page or component calls the canonical routes yet
    expect(read('src/app/dashboard/quiz/page.tsx')).not.toMatch(/api\/assessments\/learning/);
    expect(read('src/app/dashboard/today/page.tsx')).not.toMatch(/api\/assessments\/learning/);
    // the legacy submission still refuses a canonical session, and the legacy exam shortcut still stands down for one
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/ASSESSMENT_EXECUTION_AUTHORITY_CANONICAL/);
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/legacyEvidenceOwner &&/);
  });
});

describe('B5-R mounted experience (Setup -> Preview -> Start -> Active -> Completion -> Result -> Continuation)', () => {
  const C1 = '11111111-1111-4111-8111-111111111111';
  const C2 = '22222222-2222-4222-8222-222222222222';
  const setupPage = read('src/app/dashboard/assessment/page.tsx');
  const runPage = read('src/app/dashboard/assessment/[sessionId]/page.tsx');
  const runner = read('src/app/dashboard/assessment/[sessionId]/AssessmentRunner.tsx');
  const startButton = read('src/app/dashboard/assessment/StartAssessment.tsx');
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const frozenLearning = () => {
    const cached = (id: string, canonical: string) => coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${canonical}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'CANONICAL', learnerConceptId: `lc-${canonical}`, canonicalConceptId: canonical, basis: 'CREATED_FROM_CANONICAL' } });
    const coverages = [cached('q1', C1), cached('q2', C2)];
    const solution = solveLearningBlueprint({ policy: { studentId: STUDENT, intent: 'CUSTOM_CONCEPT_PRACTICE', depth: 'QUICK', canonicalConceptIds: [C1, C2], needs: projectEvidenceNeeds([C1, C2], [], { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 }, AS_OF) }, coverages, asOf: AS_OF });
    return freezeAssessment({ solution, coverages, studentId: STUDENT, createdAt: AS_OF, path: 'LEARNING_ACTIVITY', intent: 'CUSTOM_CONCEPT_PRACTICE', activity: learningActivityFor(solution.requirement!.evidence!.activityType, 'CUSTOM_CONCEPT_PRACTICE') });
  };
  const stored = (key: string, text: string) => ({ id: key, conceptId: 'lc', type: 'multiple_choice', answerFormat: 'single_choice', question: text, options: [{ id: 'a', text: 'right' }, { id: 'b', text: 'wrong' }], correctAnswer: 'a', explanation: 'because', difficulty: 3, assessmentItemKey: key });

  it('a launch link carries intent only, and the setup form returns exactly that intent', () => {
    const request = launchRequestOfQuery({ intent: 'CUSTOM_CONCEPT_PRACTICE', origin: 'LEARNING_PATH', c: `${C1}, ${C2}`, depth: 'DEEP' });
    expect(request).toMatchObject({ family: 'LEARNING', intent: 'CUSTOM_CONCEPT_PRACTICE', origin: 'LEARNING_PATH', depth: 'DEEP', scope: { canonicalConceptIds: [C1, C2], learnerConceptIds: [], node: null } });
    expect(hiddenFieldsOf(request!)).toEqual({ intent: 'CUSTOM_CONCEPT_PRACTICE', origin: 'LEARNING_PATH', c: `${C1},${C2}`, confirm: '1' });
    // nothing to practise, an unknown intent or an unknown depth is not a request
    expect(launchRequestOfQuery({})).toBeNull();
    expect(launchRequestOfQuery({ c: C1, intent: 'ANYTHING' })).toBeNull();
    expect(launchRequestOfQuery({ c: C1, depth: '25' })).toBeNull();
    expect(launchRequestOfQuery({ c: C1 })).toMatchObject({ intent: 'CUSTOM_CONCEPT_PRACTICE', depth: 'BALANCED', origin: 'TODAY' });
  });

  it('the active shell serves the FROZEN questions in the frozen order, with every answer stripped', async () => {
    const frozen = frozenLearning();
    const keys = frozen.items.map((i) => i.key);
    sessions.set('s1', { student_id: STUDENT, status: 'active', expired: false, assessment_snapshot: frozen, questions: [...keys.map((k, i) => stored(k, `question ${i}`)), stored('LEARNING_ITEM_CACHE:not-frozen', 'extra')] });
    const loaded = await learningRunForStudent(STUDENT, 's1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.status).toBe('ACTIVE');
    expect(loaded.questions.map((q) => q.itemKey)).toEqual(keys);
    expect(loaded.questions[0].options).toEqual([{ id: 'a', text: 'right' }, { id: 'b', text: 'wrong' }]);
    expect(JSON.stringify(loaded.questions)).not.toMatch(/correctAnswer|explanation|because/);
    expect(loaded.run).toMatchObject({ snapshotId: frozen.snapshotId, family: 'LEARNING', progress: { answered: 0, total: keys.length } });
    expect(loaded.conceptLabels).toEqual({ [C1]: `Concept ${C1}`, [C2]: `Concept ${C2}` });
    // a reload is the same assessment
    expect(JSON.stringify(await learningRunForStudent(STUDENT, 's1'))).toBe(JSON.stringify(loaded));
    expect(writes).toEqual([]);
  });

  it('a legacy session, another Student and a finished or expired session are never an active run', async () => {
    const frozen = frozenLearning();
    sessions.set('legacy', { student_id: STUDENT, status: 'active', expired: false, assessment_snapshot: null, questions: [] });
    sessions.set('done', { student_id: STUDENT, status: 'completed', expired: false, assessment_snapshot: frozen, questions: [] });
    sessions.set('late', { student_id: STUDENT, status: 'active', expired: true, assessment_snapshot: frozen, questions: [] });
    expect(await learningRunForStudent(STUDENT, 'legacy')).toEqual({ ok: false, reason: 'NOT_CANONICAL' });
    expect(await learningRunForStudent('someone-else', 'done')).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await learningRunForStudent(STUDENT, 'missing')).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await learningRunForStudent(STUDENT, 'done')).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(await learningRunForStudent(STUDENT, 'late')).toMatchObject({ ok: true, status: 'EXPIRED' });
  });

  it('setup and preview exist only under the cutover flag and create nothing', () => {
    expect(setupPage.indexOf('if (!isSnapshotExecutionEnabled()) notFound();')).toBeLessThan(setupPage.indexOf('await auth()'));
    expect(setupPage).toMatch(/learningSetupForStudent\(studentId, request, /);
    expect(code(setupPage)).not.toMatch(/startLearningAssessment|freezeAssessment|db\.query|INSERT|UPDATE/);
    // Start is one POST of the intent to the canonical start route
    expect(startButton.match(/fetch\('\/api\/assessments\/learning\/start'/g)).toHaveLength(1);
    expect(startButton).toMatch(/body: JSON\.stringify\(request\)/);
    expect(code(startButton)).not.toMatch(/questionIds|maxQuestions|generate-and-take|studentId/);
  });

  it('the run page serves canonical sessions only; the runner submits once and renders PostAssessmentState', () => {
    expect(runPage).toMatch(/if \(!loaded\.ok\) notFound\(\);/);
    expect(runner.match(/\/api\/assessments\/learning\/\$\{encodeURIComponent\(sessionId\)\}\/complete/g)).toHaveLength(1);
    expect(runner).toMatch(/<AssessmentResult view=\{resultViewOf\(state\)\}/);
    expect(runner).toMatch(/<AssessmentContinuation view=\{continuationViewOf\(/);
    // no grading, score, mastery, attribution or next-step decision in the client
    expect(code(runner)).not.toMatch(/correctAnswer|gradeQuizAnswer|updateMastery|masteryScore|scorePercent|meanFraction|operationKey|generate-and-take|\/api\/quizzes/);
    expect(code(runPage)).not.toMatch(/generate-and-take|\/api\/quizzes|updateMastery/);
  });

  it('with the flag off no existing surface links to the mounted experience', () => {
    for (const rel of ['src/app/dashboard/quiz/page.tsx', 'src/app/dashboard/today/page.tsx', 'src/app/dashboard/NextChallengeCard.tsx', 'src/app/dashboard/SidebarNav.tsx']) expect(read(rel), rel).not.toMatch(/dashboard\/assessment/);
  });
});
