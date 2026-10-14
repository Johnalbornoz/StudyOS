/**
 * B5-D -- the DEV cutover: one execution switch, entry points, answers in progress, exam availability.
 * The database is mocked here; hosted DEV is exercised by scripts/operations/b5d-dev-e2e-http.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sessions = new Map<string, any>();
const responses = new Map<string, { id: string; student_id: string; student_answer: string; graded: boolean }>();
const writes: string[] = [];
vi.mock('@/lib/db', () => ({
  db: {
    query: async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^(UPDATE|INSERT|DELETE)/.test(s)) writes.push(s);
      if (/^SELECT student_id, status, questions, activity_type, evidence_mode, \(expires_at <= now\(\)\) AS expired, \(assessment_snapshot IS NOT NULL\) AS canonical FROM quiz_sessions/.test(s)) {
        const row = sessions.get(params[0]);
        return { rows: row ? [{ ...row, canonical: !!row.assessment_snapshot, expired: row.expired === true }] : [] };
      }
      const key = `${params[0]}#${params[1]}`;
      if (/^INSERT INTO quiz_responses/.test(s)) {
        const existing = responses.get(key);
        if (!existing) {
          responses.set(key, { id: key, student_id: params[8], student_answer: params[10], graded: false });
          return { rows: [{ id: key }], rowCount: 1 };
        }
        if (existing.graded || existing.student_id !== params[8]) return { rows: [], rowCount: 0 };
        existing.student_answer = params[10];
        return { rows: [{ id: key }], rowCount: 1 };
      }
      if (/^DELETE FROM quiz_responses/.test(s)) {
        const existing = responses.get(key);
        if (!existing || existing.graded || existing.student_id !== params[2]) return { rows: [], rowCount: 0 };
        responses.delete(key);
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT question_index, student_answer FROM quiz_responses/.test(s)) {
        return { rows: [...responses.entries()].filter(([k, r]) => k.startsWith(`${params[0]}#`) && r.student_id === params[1]).map(([k, r]) => ({ question_index: Number(k.split('#')[1]), student_answer: r.student_answer })).sort((a, b) => a.question_index - b.question_index) };
      }
      throw new Error(`unexpected SQL: ${s}`);
    },
  },
}));
vi.mock('@/lib/assessment-blueprint/assessment-blueprint.service', () => ({ solveLearningForStudent: async () => ({ ok: false, issues: [] }), evaluateExamVersionReadiness: async () => { throw new Error('inject'); } }));
vi.mock('@/lib/curriculum/curriculum-scope.service', () => ({ loadCurriculumScope: async () => null }));

import { ASSESSMENT_SNAPSHOT_EXECUTION_FLAG, isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import * as startService from '@/lib/assessment-execution/assessment-start.service';
import { ASSESSMENT_INTENT_OF_QUIZ_MODE, assessmentSetupHref, entryTargetFor } from '@/lib/assessment-experience/entry';
import { launchRequestOfQuery } from '@/app/dashboard/assessment/launch-params';
import { loadDraftAnswers, saveDraftAnswers } from '@/lib/assessment-execution/assessment-draft.service';
import { decodeClientAnswer, encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';
import { examAvailabilityForVersion, learningSetupForStudent } from '@/lib/assessment-experience/assessment-experience.service';
import { coverageOfLearningCacheItem } from '@/lib/assessment-foundation/question-coverage';
import { projectEvidenceNeeds, solveLearningBlueprint } from '@/lib/assessment-blueprint';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => (statSync(join(ROOT, dir, f)).isDirectory() ? walk(`${dir}/${f}`) : /\.(ts|tsx)$/.test(f) ? [`${dir}/${f}`] : []));
const STUDENT = 'stu-1';
const LC = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  sessions.clear();
  responses.clear();
  writes.length = 0;
});
afterEach(() => {
  delete process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG];
});

describe('B5-D one cutover authority', () => {
  it('is one server flag, exactly "true" turns it on, and the start service re-exports the same function', () => {
    expect(isSnapshotExecutionEnabled()).toBe(false);
    for (const v of ['1', 'TRUE', 'yes', ' true']) {
      process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] = v;
      expect(isSnapshotExecutionEnabled(), v).toBe(false);
    }
    process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] = 'true';
    expect(isSnapshotExecutionEnabled()).toBe(true);
    expect(startService.isSnapshotExecutionEnabled).toBe(isSnapshotExecutionEnabled);
  });

  it('the retired B4 constant is gone and nothing else decides execution', () => {
    const all = walk('src');
    expect(all.filter((f) => /CANONICAL_EXECUTION_ENABLED|executionPathFor/.test(read(f)))).toEqual([]);
    // the environment variable is read in exactly one place
    expect(all.filter((f) => /process\.env\[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG\]|process\.env\.ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED/.test(read(f)))).toEqual(['src/lib/assessment-execution/execution-flag.ts']);
    // no client component reads the switch: authority is the server's
    const clients = all.filter((f) => /^'use client';/m.test(read(f)));
    expect(clients.filter((f) => /isSnapshotExecutionEnabled|ASSESSMENT_SNAPSHOT_EXECUTION/.test(read(f)))).toEqual([]);
    expect(code('src/lib/assessment-execution/execution-flag.ts')).not.toMatch(/import /);
  });
});

describe('B5-D entry points', () => {
  const quiz = { subjectId: 'sub', conceptId: LC, difficulty: '3', maxQuestions: '8', v1Launch: '1' };

  it('OFF: every launch keeps its existing target', () => {
    for (const mode of ['topic_practice', 'canonical_prove', 'canonical_retain', 'canonical_learn_check']) expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode }, false)).toBeNull();
  });

  it('ON: practice / prove / retain enter the canonical setup with the same intent and nothing else', () => {
    expect(ASSESSMENT_INTENT_OF_QUIZ_MODE).toEqual({ topic_practice: 'CONCEPT_PRACTICE', quick_check: 'MASTERY_CHECK', canonical_prove: 'MASTERY_CHECK', canonical_retain: 'RETENTION_CHECK' });
    const href = entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'topic_practice' }, true)!;
    expect(href).toBe(`/dashboard/assessment?intent=CONCEPT_PRACTICE&origin=TODAY&lc=${LC}`);
    // the engine's count and difficulty do not travel: the Blueprint Core decides them
    expect(href).not.toMatch(/maxQuestions|difficulty|v1Launch|subjectId/);
    expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'canonical_prove' }, true)).toBe(assessmentSetupHref({ learnerConceptId: LC }, 'MASTERY_CHECK'));
    expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'canonical_retain' }, true)).toBe(assessmentSetupHref({ learnerConceptId: LC }, 'RETENTION_CHECK'));
    // the setup page understands exactly that link
    const query = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(launchRequestOfQuery(query)).toMatchObject({ family: 'LEARNING', intent: 'CONCEPT_PRACTICE', origin: 'TODAY', scope: { canonicalConceptIds: [], learnerConceptIds: [LC] } });
  });

  it('ON: flows the assessment system does not own, and an existing quiz being resumed, are left alone', () => {
    expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'canonical_learn_check' }, true)).toBeNull();
    expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'canonical_transfer' }, true)).toBeNull();
    expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'diagnostic_check' }, true)).toBeNull();
    expect(entryTargetFor('/dashboard/quiz', { subjectId: 'sub', mode: 'topic_practice' }, true)).toBeNull();
    expect(entryTargetFor('/dashboard/quiz', { ...quiz, mode: 'topic_practice', quizId: 'q-1' }, true)).toBeNull();
    expect(entryTargetFor('/dashboard/cognitive/transfer', { ...quiz, mode: 'topic_practice' }, true)).toBeNull();
  });

  it('both server launch builders apply it; no page or component builds the canonical entry itself', () => {
    const canonical = read('src/lib/pedagogical-decision/canonical-session-launch.ts');
    const legacyEngine = read('src/services/learning-session-engine.service.ts');
    expect(canonical).toMatch(/const canonicalEntry = entryTargetFor\('\/dashboard\/quiz', params, isSnapshotExecutionEnabled\(\)\);\s+return \{ launchStatus: 'READY', launchTarget: canonicalEntry \?\? `\/dashboard\/quiz\?\$\{qs\}`, launchParams: params/);
    expect(legacyEngine).toMatch(/launchTarget: entryTargetFor\(path, params, isSnapshotExecutionEnabled\(\)\) \?\? buildUrl\(path, params\), launchParams: params/);
    // Today and My Path navigate to the server's launch target; they hold no route of their own
    for (const rel of ['src/app/dashboard/today/page.tsx', 'src/app/dashboard/path/page.tsx', 'src/app/dashboard/NextChallengeCard.tsx', 'src/app/dashboard/StartSessionButton.tsx']) expect(code(rel), rel).not.toMatch(/dashboard\/assessment|dashboard\/quiz\?/);
    const builders = walk('src').filter((f) => /entryTargetFor\(|assessmentSetupHref\(/.test(code(f)));
    expect(builders.sort()).toEqual(['src/lib/assessment-experience/entry.ts', 'src/lib/pedagogical-decision/canonical-session-launch.ts', 'src/services/learning-session-engine.service.ts']);
  });

  it('the resolved launch follows the flag (canonical engine builder, end to end)', async () => {
    const { resolveCanonicalLaunch } = await import('@/lib/pedagogical-decision/canonical-session-launch');
    const decision = { policyVersion: 'v1', canonicalRevision: 'r', stage: 'PRACTICE', actionState: 'EXECUTABLE', waitingReason: null, nextEligibleAt: null, intervention: null, activityContract: { activityType: 'PRACTICE', itemCount: { min: 5, max: 8 }, difficulty: { target: 3 } } } as never;
    const off = resolveCanonicalLaunch({ subjectId: 'sub', conceptId: LC, decision });
    expect(off.launchTarget).toMatch(/^\/dashboard\/quiz\?/);
    process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] = 'true';
    const on = resolveCanonicalLaunch({ subjectId: 'sub', conceptId: LC, decision });
    expect(on.launchTarget).toBe(`/dashboard/assessment?intent=CONCEPT_PRACTICE&origin=TODAY&lc=${LC}`);
    // what the decision authorised is unchanged
    expect(on.launchParams).toEqual(off.launchParams);
    expect(on.launchStatus).toBe('READY');
  });

  it('B5-E: Today shows no question count for a launch that enters the canonical setup (the count is the Blueprint Core\'s)', async () => {
    const { presentNextChallenge } = await import('@/lib/experience/next-challenge');
    const canonical = (launchTarget: string) => ({ policyVersion: 'v1', canonicalRevision: 'r', stage: 'PROVE', actionState: 'EXECUTABLE', activityType: 'PROVE', launchStatus: 'READY', launchTarget, launchParams: { maxQuestions: '10', mode: 'canonical_prove' }, waitingReason: null, nextEligibleAt: null, notReadyReason: null }) as never;
    const view = (launchTarget: string) => presentNextChallenge({ conceptId: LC, subjectId: 'sub', legacyDecision: { facts: [] } as never, canonicalAuthority: true, canonical: canonical(launchTarget) });
    expect(view(`/dashboard/quiz?mode=canonical_prove&conceptId=${LC}&maxQuestions=10`)).toMatchObject({ status: 'READY', itemCount: 10 });
    expect(view(`/dashboard/assessment?intent=MASTERY_CHECK&origin=TODAY&lc=${LC}`)).toMatchObject({ status: 'READY', itemCount: null });
  });

  it('a scope given as the Student\'s own concept is resolved by the Blueprint Core, and the start is asked for the canonical targets', async () => {
    const C1 = '11111111-1111-4111-8111-111111111111';
    const coverages = [coverageOfLearningCacheItem({ candidateId: 'q1', studentId: STUDENT, learnerConceptId: LC, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'CANONICAL', learnerConceptId: LC, canonicalConceptId: C1, basis: 'CREATED_FROM_CANONICAL' } })];
    const solve = (async (_s: string, r: any) => ({ ok: true as const, coverages, solution: solveLearningBlueprint({ policy: { studentId: STUDENT, intent: r.intent, depth: r.depth, canonicalConceptIds: [C1], needs: projectEvidenceNeeds([C1], [], { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 }, r.asOf) }, coverages, asOf: r.asOf }) })) as never;
    const request = launchRequestOfQuery({ intent: 'CONCEPT_PRACTICE', lc: LC })!;
    const setup = await learningSetupForStudent(STUDENT, request, '2026-10-10T12:00:00.000Z', { solve });
    expect(setup.ok && setup.canonicalConceptIds).toEqual([C1]);
    const page = read('src/app/dashboard/assessment/page.tsx');
    expect(page).toMatch(/const launch = setup\.canonicalConceptIds\.length > 0 \? \{ \.\.\.request, scope: \{ \.\.\.request\.scope, canonicalConceptIds: setup\.canonicalConceptIds, learnerConceptIds: \[\] \} \} : request;/);
    expect(page).toMatch(/request=\{launch\}/);
  });
});

describe('B5-D answers in progress', () => {
  const q = (key: string) => ({ id: key, conceptId: LC, type: 'multiple_choice', answerFormat: 'single_choice', question: key, correctAnswer: 'a', explanation: '', assessmentItemKey: key });
  const session = (over: object = {}) => ({ student_id: STUDENT, status: 'active', expired: false, activity_type: 'PRACTICE', evidence_mode: 'PRACTICE', assessment_snapshot: { snapshotId: 'x' }, questions: [q('K:1'), q('K:2'), q('K:3')], ...over });

  it('saves, overwrites, clears and restores drafts of the frozen questions only', async () => {
    sessions.set('s1', session());
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'K:1', answer: 'a' }, { itemKey: 'K:3', answer: 'b' }, { itemKey: 'K:not-frozen', answer: 'a' }] })).toEqual({ ok: true, saved: 2, cleared: 0 });
    expect(await loadDraftAnswers('s1', STUDENT, session().questions)).toEqual({ 'K:1': 'a', 'K:3': 'b' });
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'K:1', answer: 'b' }, { itemKey: 'K:3', answer: '  ' }] })).toEqual({ ok: true, saved: 1, cleared: 1 });
    expect(await loadDraftAnswers('s1', STUDENT, session().questions)).toEqual({ 'K:1': 'b' });
    // another Student reads nothing
    expect(await loadDraftAnswers('s1', 'someone-else', session().questions)).toEqual({});
  });

  it('a graded response is final: a draft never overwrites or clears it', async () => {
    sessions.set('s1', session());
    await saveDraftAnswers({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'K:2', answer: 'a' }] });
    responses.get('s1#1')!.graded = true;
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'K:2', answer: 'b' }] })).toEqual({ ok: true, saved: 0, cleared: 0 });
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 's1', answers: [{ itemKey: 'K:2', answer: '' }] })).toEqual({ ok: true, saved: 0, cleared: 0 });
    expect(responses.get('s1#1')!.student_answer).toBe('a');
  });

  it('refuses a legacy, finished, expired or foreign session and writes nothing', async () => {
    sessions.set('legacy', session({ assessment_snapshot: null }));
    sessions.set('done', session({ status: 'completed' }));
    sessions.set('late', session({ expired: true }));
    sessions.set('s1', session());
    const answers = [{ itemKey: 'K:1', answer: 'a' }];
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 'legacy', answers })).toEqual({ ok: false, reason: 'NOT_CANONICAL' });
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 'done', answers })).toEqual({ ok: false, reason: 'NOT_ACTIVE' });
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 'late', answers })).toEqual({ ok: false, reason: 'NOT_ACTIVE' });
    expect(await saveDraftAnswers({ studentId: 'someone-else', sessionId: 's1', answers })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await saveDraftAnswers({ studentId: STUDENT, sessionId: 'missing', answers })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(writes).toEqual([]);
  });

  it('a draft is not evidence: the draft service and its route touch only the response record', () => {
    for (const rel of ['src/lib/assessment-execution/assessment-draft.service.ts', 'src/app/api/assessments/learning/[sessionId]/answers/route.ts']) {
      expect(code(rel), rel).not.toMatch(/updateMastery|learning_evidence|mastery_records|mastery_events|concept_knowledge_state|quiz_response_grades \(|gradeQuizAnswer|completeAssessmentEvidence|buildOperationKey|UPDATE quiz_sessions/);
    }
    const service = code('src/lib/assessment-execution/assessment-draft.service.ts');
    expect((service.match(/\b(INSERT INTO|DELETE FROM|UPDATE(?! SET)) (\w+)/g) ?? []).sort()).toEqual(['DELETE FROM quiz_responses', 'INSERT INTO quiz_responses']);
    // no new response model and no migration for it: the only later migrations are QB-R1C's approval trigger
    // (Stage convergence) and the shared foundation's three (full product convergence)
    expect(readdirSync(join(ROOT, 'database/migrations')).filter((f) => f > '20261111_1000_qb_item_curriculum_nodes.sql').sort()).toEqual([
      '20261112_1000_qb_review_requires_primary_attribution.sql',
      '20261120_1000_sf7_parent_relationship_lifecycle.sql',
      '20261120_1100_cr_l9_02_enrollment_history.sql',
      '20261120_1200_sf10_single_persona_constraint.sql',
      // + the Student's own scheduled assessments (ad-hoc exam): two new tables, nothing of the response model
      '20261121_1000_student_scheduled_assessments.sql',
      // QF V5.1: construct cores and instance lineage -- no response model
      '20261121_1100_qf51_construct_core_lineage.sql',
      // curriculum convergence: Learn curriculum provenance (one new table; no response model)
      '20261122_1000_learner_concept_curriculum_provenance.sql',
      // reviewed concept aliases (one new table, one mapping method; no response model)
      '20261122_1100_canonical_concept_reviewed_aliases.sql',
      // QF V5.2: Exam Bank certification / coverage / supply authority -- no response model
      '20261122_1200_qf52_exam_bank_certification_coverage.sql',
      // Exam Bank publication: who authors a core-derived bank version (one function replaced; no response model)
      '20261123_1000_exam_bank_core_derived_authorship.sql',
      // PAA pilot: the automated certification path for generated Exam Bank content; it adds no response model
      '20261124_1000_exam_bank_pilot_generated_certification.sql',
      '20261124_1100_exam_bank_pilot_certified_activation.sql',
      '20261124_1200_exam_bank_pilot_certification_scope.sql',
    ]);
  });

  it('every answer format survives save and restore', () => {
    const base = { index: 0, orderingItemsShuffled: ['b', 'c', 'a'] };
    const cases: Array<[string, unknown]> = [['single_choice', 'opt-2'], ['multi_choice', ['a', 'c']], ['text', 'x = 2, because 2 + 2 = 4'], ['matching', { L1: 'R2', L2: 'R1' }], ['classification', { item: 'cat' }], ['ordering', { a: 1, b: 2, c: 3 }]];
    for (const [answerFormat, staged] of cases) {
      const question = { ...base, answerFormat } as never;
      const encoded = encodeClientAnswer(question, staged);
      expect(encodeClientAnswer(question, decodeClientAnswer(question, encoded)), answerFormat).toBe(encoded);
    }
    expect(decodeClientAnswer({ index: 0, answerFormat: 'matching' }, 'not json')).toBeUndefined();
    expect(decodeClientAnswer({ index: 0, answerFormat: 'ordering' }, '{"a":1}')).toBeUndefined();
    expect(decodeClientAnswer({ index: 0, answerFormat: 'text' }, '')).toBeUndefined();
  });

  it('the runner restores saved answers, saves while working and on leaving, and flushes before the one submission', () => {
    const runner = read('src/app/dashboard/assessment/[sessionId]/AssessmentRunner.tsx');
    expect(runner).toMatch(/decodeClientAnswer\(q, savedAnswers\[q\.itemKey\]\)/);
    expect(runner).toMatch(/useState<Record<string, unknown>>\(restored\)/);
    expect(runner).toMatch(/method: 'PUT'/);
    expect(runner).toMatch(/addEventListener\('pagehide', leave\)/);
    expect(runner.indexOf('await saveDrafts();')).toBeLessThan(runner.indexOf('/complete`'));
    expect(runner.indexOf('await saveDrafts();')).toBeGreaterThan(runner.indexOf('const submit = async'));
    expect(read('src/lib/assessment-experience/assessment-experience.service.ts')).toMatch(/const savedAnswers = status === 'ACTIVE' \? await loadDraftAnswers\(sessionId, studentId, stored\) : \{\};/);
  });
});

describe('B5-D exam preparation availability', () => {
  const report = (eligibleQuestions: number) => (async () => ({ eligibleQuestions })) as never;

  it('no student-eligible content: every attempt is unavailable with a reason, and none is startable', async () => {
    const a = await examAvailabilityForVersion('ev-1', report(0));
    expect(a).toMatchObject({ evaluated: true, eligibleQuestions: 0 });
    expect(a.options.map((o) => [o.type, o.available, o.reason])).toEqual([['EXAM_PRACTICE', false, 'CONTENT_NOT_READY'], ['REDUCED_MOCK', false, 'CONTENT_NOT_READY'], ['FULL_MOCK', false, 'CONTENT_NOT_READY'], ['EXAM_CHALLENGE', false, 'CONTENT_NOT_READY']]);
  });

  it('eligible content opens practice only; a mock is never offered on a content count', async () => {
    const a = await examAvailabilityForVersion('ev-1', report(40), async () => true);
    expect(a.options.filter((o) => o.available).map((o) => o.type)).toEqual(['EXAM_PRACTICE', 'EXAM_CHALLENGE']);
    // Track B: a challenge is harder than the real exam by a CALIBRATED difficulty. Content with none opens practice, not a challenge.
    const uncalibrated = await examAvailabilityForVersion('ev-1', report(40), async () => false);
    expect(uncalibrated.options.filter((o) => o.available).map((o) => o.type)).toEqual(['EXAM_PRACTICE']);
    expect(uncalibrated.options.find((o) => o.type === 'EXAM_CHALLENGE')).toEqual({ type: 'EXAM_CHALLENGE', available: false, reason: 'DIFFICULTY_NOT_CALIBRATED' });
    expect(a.options.filter((o) => /MOCK/.test(o.type)).every((o) => !o.available && o.reason === 'CONTENT_NOT_READY')).toBe(true);
  });

  it('no version, or a failed read, is unavailable -- never a crash, never optimistic', async () => {
    for (const a of [await examAvailabilityForVersion(null, report(40)), await examAvailabilityForVersion('ev-1', (async () => { throw new Error('db down'); }) as never)]) {
      expect(a.evaluated).toBe(false);
      expect(a.options.every((o) => !o.available)).toBe(true);
    }
  });

  it('is mounted on Exam Prep under the flag, starts nothing and generates nothing', () => {
    const component = read('src/app/dashboard/exam-prep/[examProfileId]/CanonicalExamAvailability.tsx');
    expect(component).toMatch(/if \(!isSnapshotExecutionEnabled\(\)\) return null;/);
    expect(code('src/app/dashboard/exam-prep/[examProfileId]/CanonicalExamAvailability.tsx')).not.toMatch(/startExamInstance|createExamInstance|generate|mayUseGeneratedFallback|fetch\(/);
    expect(read('src/app/dashboard/exam-prep/[examProfileId]/page.tsx').match(/<CanonicalExamAvailability examVersionId=\{profile\.examVersionId \?\? null\} t=\{t\}(?: catalogNode=\{view\.objective\.nodeKey\})? \/>/g)).toHaveLength(3);
    // an unavailable attempt has no link (the shared component)
    expect(read('src/components/assessment/AssessmentExperience.tsx')).toMatch(/const startable = o\.available && !!href;/);
  });
});
