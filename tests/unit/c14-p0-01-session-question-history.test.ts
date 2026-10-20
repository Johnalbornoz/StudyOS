/**
 * C14-P0-01 -- an APPLY transfer ladder session (quiz_sessions.questions = TransferLadderSessionState OBJECT) made the
 * subject Test / Mock start throw "object is not iterable" (500). The history is now normalized in ONE place
 * (src/lib/quiz/session-question-history.ts) and every quiz_sessions.questions history reader uses it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransferLadderChallengeRecord, TransferLadderSessionState } from '@/services/transfer-ladder-session.store';
import { resetSessionQuestionHistoryLogForTests, sessionQuestionHistory } from '@/lib/quiz/session-question-history';
import { fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';

// ------------------------------------------------------------------ mocks ------------------------------------------------------------------
type Row = Record<string, unknown>;
const queries: Array<{ sql: string; params: unknown[] }> = [];
let historyRows: Row[] = [];
const SUBJECT = '00000000-0000-4000-8000-0000000000aa';
const C1 = '00000000-0000-4000-8000-000000000001';
const C2 = '00000000-0000-4000-8000-000000000002';
const STUDENT = '00000000-0000-4000-8000-0000000000f1';

const dbQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  if (/SELECT now\(\) AS now/.test(sql)) return { rows: [{ now: '2026-10-18T15:00:00.000Z' }] };
  if (/FROM subjects WHERE id = \$1 AND student_id/.test(sql)) return { rows: [{ '?column?': 1 }] };
  if (/FROM concepts WHERE subject_id/.test(sql)) return { rows: [{ id: C1 }, { id: C2 }] };
  if (/FROM student_availability/.test(sql)) return { rows: [{ timezone: 'America/Bogota' }] };
  if (/FROM class_enrollments/.test(sql)) return { rows: [] };
  if (/FROM quiz_sessions WHERE student_id = \$1 AND concept_ids &&/.test(sql)) return { rows: historyRows };
  return { rows: [], rowCount: 1 };
});
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: unknown[]) => dbQuery(sql, params) } }));

const storeQuizMock = vi.fn(async () => 'quiz-new-1');
vi.mock('@/services/quiz-persistence.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/quiz-persistence.service')>();
  return { ...actual, storeQuiz: (...a: unknown[]) => storeQuizMock(...(a as [])) };
});
vi.mock('@/services/knowledge-state.service', () => ({
  getActiveMasteryPolicy: vi.fn(async () => ({ minimumUnderstanding: 80, minimumEvidenceCount: 3 })),
  getConceptKnowledgeState: vi.fn(async () => null),
}));
const providerBatch = vi.fn(async () => []);
vi.mock('@/services/gated-question-generation.service', () => ({ generateGatedQuestionBatch: (...a: unknown[]) => providerBatch(...(a as [])) }));

// ---------------------------------------------------------------- fixtures -----------------------------------------------------------------
const challenge = (index: number, prompt: string, extra: Partial<TransferLadderChallengeRecord> = {}): TransferLadderChallengeRecord => ({
  index, level: 'NEAR', taskId: `task-${index}`, context: `Contexto ${index}`, contextDomain: 'cocina', prompt,
  modelAnswer: 'respuesta modelo (solo servidor)', certified: true, certificationReason: 'CERTIFIED', servedAt: '2026-10-10T10:00:00.000Z',
  graded: index === 1 ? { scorePercent: 90, passed: true, feedback: 'ok', errorType: null, answer: 'x', answeredAt: '2026-10-10T10:05:00.000Z', aiExecutionId: null } : null,
  ...extra,
});
/** The REAL persisted shape (TransferLadderSessionState from transfer-ladder-session.store.ts). */
const ladderState = (challenges: TransferLadderChallengeRecord[]): TransferLadderSessionState => ({
  kind: 'TRANSFER_LADDER', version: 'transfer-ladder-v1', revision: challenges.length, conceptLabel: 'Fracciones', learnedContext: 'clase',
  attribution: { pedagogicalPolicyVersion: 'v1', canonicalRevision: 'r1', canonicalStage: 'APPLY', canonicalActivityType: 'TRANSFER' },
  challenges, closedAt: null,
});
const gq = (conceptId: string, question: string) => ({ id: `q-${question}`, conceptId, type: 'multiple_choice', answerFormat: 'single_choice', question, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'a', explanation: '', difficulty: 3 });
const applyRow = (prompts: string[], at = '2026-10-10T10:00:00.000Z', conceptId = C1): Row => ({
  questions: ladderState(prompts.map((p, i) => challenge(i + 1, p))), created_at: at, concept_id: conceptId, quiz_mode: 'transfer_ladder',
});
const arrayRow = (items: Array<ReturnType<typeof gq>>, at = '2026-10-12T10:00:00.000Z'): Row => ({ questions: items, created_at: at, concept_id: null, quiz_mode: 'cumulative_assessment' });

const uniqueGenerator = () => {
  let n = 0;
  return vi.fn(async (a: { conceptId: string; count: number; difficulty: number }) => Array.from({ length: a.count }, () => gq(a.conceptId, `nueva ${++n}`)) as any);
};

beforeEach(() => {
  queries.length = 0;
  historyRows = [];
  storeQuizMock.mockClear();
  providerBatch.mockClear();
  resetSessionQuestionHistoryLogForTests();
});

// ---------------------------------------------------------------- normalizer ---------------------------------------------------------------
describe('sessionQuestionHistory (the one normalizer)', () => {
  it('1. no prior session data -> no history', () => {
    expect(sessionQuestionHistory(null)).toEqual([]);
    expect(sessionQuestionHistory(undefined)).toEqual([]);
    expect(sessionQuestionHistory([])).toEqual([]);
  });

  it('2. a GeneratedQuestion[] array keeps working exactly as before (elements without a string question skipped)', () => {
    const out = sessionQuestionHistory([gq(C1, 'P1'), { conceptId: C2, question: { nested: true } }, null, gq(C2, 'P2'), { question: 'sin concepto' }]);
    expect(out).toEqual([
      { question: 'P1', conceptId: C1, source: 'QUESTION_ARRAY' },
      { question: 'P2', conceptId: C2, source: 'QUESTION_ARRAY' },
      { question: 'sin concepto', conceptId: null, source: 'QUESTION_ARRAY' },
    ]);
    // a JSON string of the array (legacy driver behaviour) reads the same
    expect(sessionQuestionHistory(JSON.stringify([gq(C1, 'P1')]))).toEqual([{ question: 'P1', conceptId: C1, source: 'QUESTION_ARRAY' }]);
  });

  it('3. an APPLY TRANSFER_LADDER object never throws and yields every served challenge prompt for the session concept', () => {
    const state = ladderState([challenge(1, 'Tarea uno'), challenge(2, 'Tarea dos'), challenge(3, '   ')]);
    expect(() => { for (const _ of state as unknown as Iterable<unknown>) void _; }).toThrow(/not iterable/); // the original defect
    const out = sessionQuestionHistory(state, { sessionConceptId: C1, quizMode: 'transfer_ladder' });
    expect(out).toEqual([
      { question: 'Tarea uno', conceptId: C1, source: 'TRANSFER_LADDER_CHALLENGE' },
      { question: 'Tarea dos', conceptId: C1, source: 'TRANSFER_LADDER_CHALLENGE' },
    ]);
    expect(JSON.stringify(out)).not.toContain('respuesta modelo'); // server-only fields never carried
    expect(sessionQuestionHistory(JSON.stringify(state), { sessionConceptId: C1 })).toHaveLength(2);
    // a ladder with no served challenge yet -> nothing (still no throw)
    expect(sessionQuestionHistory(ladderState([]), { sessionConceptId: C1 })).toEqual([]);
  });

  it('unsupported / malformed shapes contribute nothing, never throw, and are logged once per shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sessionQuestionHistory({ kind: 'SOMETHING_ELSE', items: [1] }, { quizMode: 'm' })).toEqual([]);
    expect(sessionQuestionHistory({ kind: 'SOMETHING_ELSE' }, { quizMode: 'm' })).toEqual([]);
    expect(sessionQuestionHistory({ kind: 'TRANSFER_LADDER', challenges: 'x' })).toEqual([]);
    expect(sessionQuestionHistory('{not json')).toEqual([]);
    expect(sessionQuestionHistory(42)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(4); // the duplicate SOMETHING_ELSE shape is logged once
    warn.mockRestore();
  });

  it('4. mixed shapes across sessions normalize into one iterable history', () => {
    const rows = [arrayRow([gq(C1, 'A1'), gq(C2, 'A2')]), applyRow(['Tarea'], undefined, C2), { questions: { weird: true }, concept_id: C1, quiz_mode: 'x' }, { questions: null, concept_id: C1 }];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const all = rows.flatMap((r) => sessionQuestionHistory(r.questions, { sessionConceptId: (r.concept_id as string) ?? null }));
    expect(all.map((q) => [q.question, q.conceptId])).toEqual([['A1', C1], ['A2', C2], ['Tarea', C2]]);
  });
});

// ------------------------------------------------------- every history reader uses it ------------------------------------------------------
describe('quiz_sessions.questions history readers use the normalizer (no direct iteration left)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it.each([
    'src/services/subject-assessment.service.ts',
    'src/lib/teacher/subject-assessment-release.service.ts',
    'src/services/quiz-persistence.service.ts',
  ])('%s', (p) => {
    const s = read(p);
    expect(s).toContain("from '@/lib/quiz/session-question-history'");
    expect(s).not.toMatch(/row\.questions \|\| \[\]/);
    expect(s).not.toMatch(/row\.questions \?\? \[\]\) as any\[\]/);
  });
});

// ------------------------------------------------------------ service level ----------------------------------------------------------------
describe('subject Test / Mock start with an APPLY session in the history', () => {
  it('8. seen fingerprints include the APPLY prompts (session concept) next to the array items', async () => {
    historyRows = [applyRow(['Tarea de transferencia']), arrayRow([gq(C1, 'Vista 1'), gq(C2, 'Vista 2')])];
    const { loadSeenFingerprints } = await import('@/services/subject-assessment.service');
    const seen = await loadSeenFingerprints(STUDENT, [C1, C2]);
    expect([...seen.get(C1)!]).toEqual([fingerprintQuestion({ question: 'Tarea de transferencia' }), fingerprintQuestion({ question: 'Vista 1' })]);
    expect([...seen.get(C2)!]).toEqual([fingerprintQuestion({ question: 'Vista 2' })]);
    const historySql = queries.find((q) => /concept_ids &&/.test(q.sql))!.sql;
    expect(historySql).toMatch(/concept_id, quiz_mode/);
  });

  it('5. STUDENT subject Test starts (no 500) with an APPLY object in the history', async () => {
    historyRows = [applyRow(['Tarea uno', 'Tarea dos']), arrayRow([gq(C1, 'Vista 1')])];
    const { createSubjectAssessmentSession } = await import('@/services/subject-assessment.service');
    const generate = uniqueGenerator();
    const r = await createSubjectAssessmentSession({ studentId: STUDENT, subjectId: SUBJECT, kind: 'TEST', origin: 'STUDENT', conceptIds: [C1, C2], schedule: { mode: 'NOW' }, language: 'es' } as any, { generate });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.kind).toBe('SUBJECT_CUMULATIVE_TEST');
    expect(r.setup.priorFingerprintCount).toBe(3); // 2 APPLY prompts + 1 array item, all for C1
    expect(r.view.state).toBe('ACTIVE');
    expect(storeQuizMock).toHaveBeenCalledTimes(1);
    expect(providerBatch).not.toHaveBeenCalled();
  });

  it('6. TEACHER subject Mock (the defect path) and STUDENT Mock start with an APPLY object in the history', async () => {
    historyRows = [applyRow(['Tarea uno']), arrayRow([gq(C2, 'Vista 2')])];
    const { createSubjectAssessmentSession } = await import('@/services/subject-assessment.service');
    const { planGroupAssessment } = await import('@/lib/subject-assessment/sizing');
    const plan = planGroupAssessment('MOCK', [C1, C2], true);
    const teacher = await createSubjectAssessmentSession({
      studentId: STUDENT, subjectId: SUBJECT, kind: 'MOCK', origin: 'TEACHER', conceptIds: [C1, C2], plan, difficultyBand: 'MIXED', schedule: { mode: 'NOW' },
      timing: { timed: true, durationMinutes: 30 }, assignmentId: 'assign-1', attemptNumber: 1, maxAttempts: 2, avoidFingerprints: [], previousAttemptFingerprints: [], language: 'es',
      assignmentWindow: { closesAt: '2026-10-19T02:00:00.000Z', resumeAfterInactivity: false },
    } as any, { generate: uniqueGenerator() });
    expect(teacher.ok).toBe(true);
    if (teacher.ok) expect(teacher.setup).toMatchObject({ kind: 'SUBJECT_MOCK_EXAM', origin: 'TEACHER', assignmentId: 'assign-1', priorFingerprintCount: 2 });
    const student = await createSubjectAssessmentSession({ studentId: STUDENT, subjectId: SUBJECT, kind: 'MOCK', origin: 'STUDENT', conceptIds: [C1], schedule: { mode: 'NOW' }, language: 'es' } as any, { generate: uniqueGenerator() });
    expect(student.ok).toBe(true);
    expect(providerBatch).not.toHaveBeenCalled();
  });

  it('8b. reuse ranking still works: an APPLY prompt is a seen item, avoided while novel supply exists and ranked least-recently-used when reuse is forced', async () => {
    // APPLY served 2026-10-10 (older), the array item 2026-10-12 (newer); C1 needs 1 item in this plan
    historyRows = [applyRow(['Tarea vieja'], '2026-10-10T10:00:00.000Z'), arrayRow([gq(C1, 'Vista nueva')], '2026-10-12T10:00:00.000Z')];
    const { createSubjectAssessmentSession } = await import('@/services/subject-assessment.service');
    const plan = { questionCount: 2, distribution: { [C1]: 1, [C2]: 1 }, rule: 'test' };
    const base = { studentId: STUDENT, subjectId: SUBJECT, kind: 'TEST', origin: 'TEACHER', conceptIds: [C1, C2], plan, difficultyBand: 'INTERMEDIATE', schedule: { mode: 'NOW' }, timing: { timed: false, durationMinutes: null }, assignmentId: 'assign-2', attemptNumber: 1, maxAttempts: 2, avoidFingerprints: [], previousAttemptFingerprints: [], language: 'es' } as any;

    // novel supply exists -> the APPLY prompt is not served again
    const withNovel = vi.fn(async (a: { conceptId: string }) => (a.conceptId === C1 ? [gq(C1, 'Tarea vieja'), gq(C1, 'Nueva C1')] : [gq(C2, 'Nueva C2')]) as any);
    const r1 = await createSubjectAssessmentSession(base, { generate: withNovel });
    expect(r1.ok && r1.questions.map((q) => q.question).sort()).toEqual(['Nueva C1', 'Nueva C2']);
    expect(r1.ok && r1.setup.reusedItems).toEqual([]);

    // only seen supply for C1 -> least recently used first: the older APPLY prompt beats the newer array item
    const onlySeen = vi.fn(async (a: { conceptId: string }) => (a.conceptId === C1 ? [gq(C1, 'Vista nueva'), gq(C1, 'Tarea vieja')] : [gq(C2, 'Nueva C2')]) as any);
    const r2 = await createSubjectAssessmentSession(base, { generate: onlySeen });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.questions.find((q) => q.conceptId === C1)!.question).toBe('Tarea vieja');
    expect(r2.setup.reusedItems).toEqual([{ conceptId: C1, fingerprint: fingerprintQuestion({ question: 'Tarea vieja' }), source: 'OWN_LEAST_RECENTLY_USED', lastServedAt: '2026-10-10T10:00:00.000Z' }]);
  });

  it('7. a genuinely failing generator: GENERATION_INSUFFICIENT, no session stored, no write, no provider call', async () => {
    historyRows = [applyRow(['Tarea uno'])];
    const { createSubjectAssessmentSession } = await import('@/services/subject-assessment.service');
    const failing = vi.fn(async () => { throw new Error('provider down'); });
    const r = await createSubjectAssessmentSession({ studentId: STUDENT, subjectId: SUBJECT, kind: 'TEST', origin: 'STUDENT', conceptIds: [C1, C2], schedule: { mode: 'NOW' }, language: 'es' } as any, { generate: failing });
    expect(r).toMatchObject({ ok: false, status: 500, error: 'GENERATION_INSUFFICIENT' });
    expect(failing).toHaveBeenCalled();
    expect(storeQuizMock).not.toHaveBeenCalled();
    expect(providerBatch).not.toHaveBeenCalled();
    expect(queries.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql))).toEqual([]);
    expect(queries.some((q) => /ai_executions|teacher_intervention_executions/.test(q.sql))).toBe(false);
  });
});
