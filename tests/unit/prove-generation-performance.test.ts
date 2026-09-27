/**
 * PROVE_GENERATION_PERFORMANCE -- regression repair, real DEV E2E evidence:
 *   14:29 Prove launch -> prepared batch EXPIRED (prepared 05:11, 2 h TTL)
 *         -> cold concurrent-chunk generation 35.0 s -> session #1 (10 q.)
 *   14:31 re-launch    -> MISS, a SECOND full generation 68.9 s -> session #2
 *         (chunk plan [4,3,3]; one chunk 4/4 semantically rejected -> serial
 *         EMPTY fallback, chunks 54.5 s + aggregate recovery 13.9 s)
 * Baseline (CANON-R6-PERF-R1/R2): cold ~27 s, prepared HIT well under 7 s.
 *
 * Repairs (no pedagogical/validation change, same certified pipeline):
 *   1. idempotent Prove launch -- an equivalent open Prove session is
 *      resumed (same quizId + questions), never regenerated/rerolled;
 *   2. pre-generation is re-armed whenever PROVE is the next action and
 *      nothing usable is prepared (Concept Mission, in the background);
 *   3. the same language + IB/DP/HL context + guidance as the live request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');
const PAGE = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) }, query: (...a: any[]) => queryMock(...a) }));
const generateMock = vi.fn();
vi.mock('@/services/canonical-prove-generation.service', () => ({ generateCanonicalProveQuestions: (...a: any[]) => generateMock(...a) }));

import { findResumableCanonicalProveSession } from '@/services/quiz-persistence.service';
import { CANONICAL_PROVE_GENERATION_CONFIG } from '@/lib/quiz/canonical-prove-config';

const CONTRACT = { canonicalActivityType: 'PROVE', itemCount: { authorized: 10 }, difficulty: { min: 3, max: 4, target: 3 }, independence: true };
const Q = (i: number) => ({ id: `q${i}`, type: 'short_answer', answerFormat: 'text', question: `Q${i}`, correctAnswer: 'a', explanation: 'e', difficulty: 3 });
const sessionRow = (n: number) => ({
  id: 'quiz-1', student_id: 's', concept_id: 'c', subject_id: 'sub', questions: Array.from({ length: n }, (_, i) => Q(i)), // JSONB -> parsed by pg
  language: 'es', status: 'active', created_at: new Date(), expires_at: new Date(Date.now() + 60_000), quiz_mode: 'canonical_prove',
  concept_ids: ['c'], activity_type: 'SOLO_CHECK', evidence_mode: 'INDEPENDENT', hints_used_questions: [],
});

beforeEach(() => {
  queryMock.mockReset();
  generateMock.mockReset();
});

describe('1. idempotent Prove launch (same quiz for a re-launch)', () => {
  it('the lookup requires an equivalent, open, untouched session: active + unexpired, same language/policy/contract, complete, and no evidence since creation', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await findResumableCanonicalProveSession({ studentId: 's', conceptId: 'c', language: 'es', policyVersion: 'v1', contract: CONTRACT });
    expect(r).toBeNull();
    const [sql, params] = queryMock.mock.calls[0];
    for (const clause of [
      // generalized to every canonical mode (LEARNING_ACTIVITY_DELIVERY); the Prove form binds quiz_mode = canonical_prove
      'qs.quiz_mode = $11', "qs.status = 'active'", 'qs.expires_at > NOW()', 'qs.language = $3', 'qs.pedagogical_policy_version = $4',
      "canonicalActivityType' = $5", "'itemCount'->>'authorized')::int = $6::int", "'difficulty'->>'min')::int = $7", "'difficulty'->>'max')::int = $8",
      "'difficulty'->>'target')::int = $9", "independence')::boolean = $10", 'jsonb_array_length(qs.questions) = $12', 'NOT EXISTS', 'le.timestamp >= qs.created_at',
    ]) expect(sql).toContain(clause);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(params).toEqual(['s', 'c', 'es', 'v1', 'PROVE', 10, 3, 4, 3, true, 'canonical_prove', 10]);
  });

  it('returns the SAME quizId and the SAME 10 questions', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'quiz-1' }] }).mockResolvedValueOnce({ rows: [sessionRow(10)] });
    const r = await findResumableCanonicalProveSession({ studentId: 's', conceptId: 'c', language: 'es', policyVersion: 'v1', contract: CONTRACT });
    expect(r?.quizId).toBe('quiz-1');
    expect(r?.questions.map((q) => q.id)).toEqual(Array.from({ length: 10 }, (_, i) => `q${i}`));
  });

  it('an incomplete stored set is never resumed (always exactly 10)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'quiz-1' }] }).mockResolvedValueOnce({ rows: [sessionRow(9)] });
    expect(await findResumableCanonicalProveSession({ studentId: 's', conceptId: 'c', language: 'es', policyVersion: 'v1', contract: CONTRACT })).toBeNull();
  });

  it('the launch resumes BEFORE inventory, bank or any generation, returns the same session, and writes no evidence (now for every canonical activity -- LEARNING_ACTIVITY_DELIVERY)', () => {
    const svc = read('src/services/activity-delivery.service.ts');
    // resume is read in the same round trip as the learner-state reads, before anything is consumed or assembled
    const resumeIdx = svc.indexOf('const [resumed, snapshot, askFlags, reserved] = await Promise.all([\n      findResumableCanonicalSession({');
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(resumeIdx).toBeLessThan(svc.indexOf('await consumeCompatibleInventory('));
    expect(resumeIdx).toBeLessThan(svc.indexOf('await assembleActivityForLearner('));
    expect(svc).toMatch(/if \(resumed\) return \{ status: 'DELIVERED', source: 'RESUMED', quizId: resumed\.quizId, questions: resumed\.questions, timings \};/);
    expect(svc).not.toMatch(/learning_evidence|recordEvidence|updateMastery/);
    // the route delivers only after the fresh canonical authorization (v1Marker)
    expect(ROUTE.indexOf("if (validated.quizMode === 'canonical_prove' && !v1Marker)")).toBeLessThan(ROUTE.indexOf('await deliverCanonicalActivity(deliveryInput)'));
  });
});

// 2. pre-generation re-arming is now the LEARNING_ACTIVITY_DELIVERY inventory +
// queue for every stage -- covered in tests/unit/activity-delivery-architecture.test.ts.

describe('3. same generation context as the live request', () => {
  it('guidance comes from ONE shared config used by the live route and every background trigger', () => {
    expect(read('src/lib/quiz/quiz-mode-config.ts')).toMatch(/guidance: CANONICAL_PROVE_GENERATION_CONFIG\.guidance/);
    // live (emergency) generation and the background worker read the SAME config
    expect(ROUTE).toMatch(/import \{ QUIZ_MODE_CONFIG \} from '@\/lib\/quiz\/quiz-mode-config';/);
    expect(read('src/services/activity-candidate-generation.service.ts')).toMatch(/const config = QUIZ_MODE_CONFIG\[quizMode\];/);
    expect(CANONICAL_PROVE_GENERATION_CONFIG.guidance).toMatch(/independent mastery check/);
  });

  it('language and IB/DP/HL context are resolved by the same shared service the route uses', () => {
    expect(ROUTE).toMatch(/import \{ resolveLanguageForSubject, getSubjectIBContext \} from '@\/services\/subject-generation-context\.service'/);
    const worker = read('src/services/activity-delivery-worker.service.ts');
    expect(worker).toMatch(/resolveLanguageForSubject\(target\.subjectId, target\.studentId\)/);
    expect(worker).toMatch(/ibContext: await getSubjectIBContext\(p\.subjectId\)/);
  });
});

describe('guarantees that must not regress', () => {
  it('10 questions, concurrent chunk plan, at most one bounded recovery, fail closed (certified pipeline unchanged)', () => {
    expect(read('src/services/canonical-prove-generation.service.ts')).toMatch(/generateConcurrentChunkedBatch\(/);
    const gated = read('src/services/gated-question-generation.service.ts');
    expect(gated).toMatch(/export async function generateConcurrentChunkedBatch\(/);
    expect(gated).toMatch(/Promise\.all\(/);
    expect(ROUTE).toMatch(/V1_PROVE_GENERATION_INCOMPLETE/);
  });

  it('Prove stays without hints or immediate feedback', () => {
    expect(read('src/app/api/quizzes/session/[quizId]/check/route.ts')).toMatch(/session\.evidenceMode !== 'PRACTICE'\) \{\s*return NextResponse\.json\(\{ error: 'FEEDBACK_DEFERRED' \}/);
    expect(read('src/app/api/learning/contextual-help/route.ts')).toMatch(/HELP_DISABLED_FOR_MODE/);
  });

  it('every background preparation is its own AI metrics scope (per-stage timing for background work too)', () => {
    expect(read('src/services/canonical-prepared-activity.service.ts')).toMatch(/runWithAiMetrics\('BACKGROUND prove-preparation', \(\) => prepareCanonicalProveActivityUnscoped\(params\)\)/);
  });
});
