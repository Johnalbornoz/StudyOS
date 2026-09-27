/**
 * QUIZ_RESPONSE_AUDIT_PERSISTENCE -- verbatim per-question answers and their
 * grades, normalized, idempotent, separate from learning evidence, and
 * sufficient to rebuild the final review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const clientQuery = vi.fn();
const release = vi.fn();
const poolQuery = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { connect: async () => ({ query: (...a: any[]) => clientQuery(...a), release }), query: (...a: any[]) => poolQuery(...a) },
  query: (...a: any[]) => poolQuery(...a),
}));

import { questionFingerprint, toGradeRow, recordQuizResponses, getQuizReviewFromAudit } from '@/services/quiz-response-audit.service';
import { composePedagogicalGrade, deterministicEvidence } from '@/lib/grading/pedagogical-grade';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const MIGRATION = read('database/migrations/20261015_1000_quiz_response_audit.sql');
const ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');

const Q1: any = { id: 'q1', conceptId: 'c1', type: 'error_detection', answerFormat: 'text', difficulty: 3, question: 'Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8? Escribe x=5·40/8=25. Identifica el error y corrige el resultado.', correctAnswer: 'Colocó mal las magnitudes. El resultado correcto es 64 €: x=40·8/5=64.' };
const MC: any = { id: 'q0', conceptId: 'c1', type: 'multiple_choice', answerFormat: 'single_choice', difficulty: 3, question: '¿?', options: [{ id: 'a', text: '1' }], correctAnswer: 'a' };
const pedagogical = composePedagogicalGrade(deterministicEvidence(Q1, 'x = 40·8/5 = 64 €', 'es'), { requirements: [{ id: 'identify_error', met: false }] });
const graded = (q: any, raw: string, gr: any) => ({ questionIndex: q === MC ? 0 : 1, question: q, rawAnswer: raw, gradeResult: gr });
const AI = { aiExecutionId: 'exec-1', aiProvider: 'openai', aiModel: 'gpt-5.6-terra', aiPromptId: 'quiz.free_text_grading', aiPromptVersion: 'v2' };

beforeEach(() => {
  clientQuery.mockReset();
  poolQuery.mockReset();
  release.mockReset();
});

describe('schema (additive, normalized, idempotent)', () => {
  it('two tables: responses (verbatim answer) and grades (verdict + grader identity), no client timestamps, no prompts', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE public\.quiz_responses/);
    expect(MIGRATION).toMatch(/CREATE TABLE public\.quiz_response_grades/);
    expect(MIGRATION).toMatch(/student_answer text NOT NULL/);
    expect(MIGRATION).not.toMatch(/presented_at|answered_at|system_prompt|prompt_text/);
    expect(MIGRATION).not.toMatch(/^\s*(ALTER TABLE|UPDATE|DELETE FROM|DROP|TRUNCATE)\b/m); // additive only
  });

  it('one response per (session, question); one grade per (response, model, prompt version) -- the key column is NOT NULL', () => {
    expect(MIGRATION).toMatch(/CONSTRAINT quiz_responses_session_question_key UNIQUE \(quiz_session_id, question_index\)/);
    expect(MIGRATION).toMatch(/CONSTRAINT quiz_response_grades_model_key UNIQUE \(response_id, grading_model, grader_prompt_version\)/);
    expect(MIGRATION).toMatch(/grader_prompt_version text NOT NULL/);
  });

  it('every field the audit requires is a real column', () => {
    for (const col of ['quiz_session_id', 'question_index', 'question_id', 'question_fingerprint', 'answer_format', 'canonical_activity_type', 'student_answer',
      'mathematical_correctness', 'task_completion', 'reasoning_quality', 'final_judgment', 'missing_requirements', 'misconception', 'learner_signal',
      'grader_model', 'grader_prompt_version', 'graded_at', 'created_at']) {
      expect(MIGRATION, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe('grade rows', () => {
  it('PEDAGOGICAL_V1: the full verdict and the grader identity', () => {
    const row = toGradeRow(graded(Q1, 'x = 40·8/5 = 64 €', { correct: false, score: pedagogical.score, errorType: 'INCOMPLETE', pedagogical, aiExecution: AI }), 'es');
    expect(row).toMatchObject({
      gradingModel: 'PEDAGOGICAL_V1', graderModel: 'gpt-5.6-terra', graderPromptVersion: 'v2', aiExecutionId: 'exec-1',
      finalJudgment: 'ALMOST', mathematicalCorrectness: 'CORRECT', taskCompletion: 'PARTIAL', missingRequirements: ['identify_error'],
      learnerSignal: 'TASK_INCOMPLETE', misconception: null, isCorrect: false,
    });
    expect(row.feedbackMissing).toEqual(['Te falta explicar cuál fue el error en el planteamiento original.']);
  });

  it('structured items are graded deterministically; legacy grades are kept as legacy', () => {
    expect(toGradeRow(graded(MC, 'a', { correct: true, score: 1 }), 'es')).toMatchObject({ gradingModel: 'STRUCTURED', graderPromptVersion: 'structured', finalJudgment: 'CORRECT' });
    expect(toGradeRow(graded(Q1, 'x', { correct: false, score: 0.4, aiExecution: { ...AI, aiPromptVersion: 'v1' } }), 'es')).toMatchObject({ gradingModel: 'LEGACY', finalJudgment: 'ALMOST' });
  });

  it('the question fingerprint is an immutable, key-order-independent reference', () => {
    expect(questionFingerprint({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(questionFingerprint({ a: [2, { c: 4, d: 3 }], b: 1 }));
    expect(questionFingerprint(Q1)).toMatch(/^[0-9a-f]{64}$/);
    expect(questionFingerprint({ ...Q1, correctAnswer: 'otra' })).not.toBe(questionFingerprint(Q1));
  });
});

describe('writing (one transaction, idempotent, verbatim)', () => {
  const input = {
    quizSessionId: 'quiz-1', studentId: 's1', canonicalActivityType: 'PROVE', evidenceMode: 'INDEPENDENT', language: 'es',
    responses: [graded(MC, 'a', { correct: true, score: 1 }), graded(Q1, '  x = 40·8/5 = 64 €\n', { correct: false, score: 0.5, pedagogical, aiExecution: AI })],
  };

  it('first submission writes every response + grade verbatim inside BEGIN/COMMIT', async () => {
    clientQuery.mockImplementation(async (sql: string) => (/RETURNING id/.test(sql) ? { rows: [{ id: `id-${clientQuery.mock.calls.length}` }] } : { rows: [] }));
    const r = await recordQuizResponses(input);
    expect(r).toEqual({ responsesWritten: 2, gradesWritten: 2 });
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    const answerParam = clientQuery.mock.calls.find((c) => /INSERT INTO quiz_responses/.test(String(c[0])) && c[1][1] === 1)![1][10];
    expect(answerParam).toBe('  x = 40·8/5 = 64 €\n'); // exactly what the learner wrote
    expect(release).toHaveBeenCalled();
  });

  it('a repeated submission writes nothing new (ON CONFLICT DO NOTHING on both tables)', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO/.test(sql)) return { rows: [] };
      if (/SELECT id FROM quiz_responses/.test(sql)) return { rows: [{ id: 'existing' }] };
      return { rows: [] };
    });
    expect(await recordQuizResponses(input)).toEqual({ responsesWritten: 0, gradesWritten: 0 });
    const inserts = clientQuery.mock.calls.map((c) => String(c[0])).filter((s) => /INSERT INTO/.test(s));
    expect(inserts.every((s) => /ON CONFLICT [\s\S]* DO NOTHING/.test(s))).toBe(true);
  });

  it('a failure rolls back the whole submission audit', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO quiz_response_grades/.test(sql)) throw new Error('boom');
      return /RETURNING id/.test(sql) ? { rows: [{ id: 'r' }] } : { rows: [] };
    });
    await expect(recordQuizResponses(input)).rejects.toThrow('boom');
    expect(clientQuery.mock.calls.map((c) => String(c[0]).trim())).toContain('ROLLBACK');
  });
});

describe('the final review is rebuilt from the audit rows', () => {
  it('question (administered, fingerprint-checked) + verbatim answer + latest grade', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ questions: [MC, Q1] }] })
      .mockResolvedValueOnce({ rows: [{
        question_index: 1, question_fingerprint: questionFingerprint(Q1), student_answer: 'x = 40·8/5 = 64 €',
        final_judgment: 'ALMOST', is_correct: false, score: '0.5000', missing_requirements: ['identify_error'], learner_signal: 'TASK_INCOMPLETE', misconception: null,
        feedback_did_well: 'Tu cálculo y el resultado son correctos.', feedback_missing: ['Te falta explicar cuál fue el error en el planteamiento original.'], feedback_to_fix: null,
        grading_model: 'PEDAGOGICAL_V1', grader_model: 'gpt-5.6-terra', grader_prompt_version: 'v2', graded_at: new Date('2026-09-27T21:00:00Z'),
      }] });
    const review = await getQuizReviewFromAudit('quiz-1', 's1');
    expect(review).toHaveLength(1);
    expect(review![0]).toMatchObject({
      questionIndex: 1, questionFingerprintMatches: true, studentAnswer: 'x = 40·8/5 = 64 €', finalJudgment: 'ALMOST', score: 0.5,
      feedback: { didWell: 'Tu cálculo y el resultado son correctos.', missing: ['Te falta explicar cuál fue el error en el planteamiento original.'], toFix: null },
      grader: { gradingModel: 'PEDAGOGICAL_V1', promptVersion: 'v2' },
    });
    expect(review![0].question.id).toBe('q1');
    // owner-scoped
    expect(poolQuery.mock.calls[0][1]).toEqual(['quiz-1', 's1']);
  });

  it('another student never gets the review', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getQuizReviewFromAudit('quiz-1', 'intruder')).toBeNull();
  });
});

describe('submission wiring', () => {
  it('audit is written after grading and BEFORE the evidence, never changes the graded result, and fails loudly (never silently)', () => {
    const auditIdx = ROUTE.indexOf('await recordQuizResponses(auditInput)');
    expect(auditIdx).toBeGreaterThan(ROUTE.indexOf('const gradeResult = await gradeQuizAnswer(question, answer.answer'));
    expect(auditIdx).toBeLessThan(ROUTE.indexOf('await updateMastery('));
    expect(ROUTE).toMatch(/console\.error\('\[quiz-response-audit\] PERSISTENCE_FAILED'/);
  });

  it('a completed session is never re-graded (historical scores never change, no automatic regrade)', () => {
    expect(ROUTE).toMatch(/if \(quizSession\.status === 'completed'\) \{\s*return NextResponse\.json\(\{\s*success: true,\s*alreadySubmitted: true/);
    expect(read('src/services/quiz-response-audit.service.ts')).not.toMatch(/UPDATE |DELETE /);
  });
});
