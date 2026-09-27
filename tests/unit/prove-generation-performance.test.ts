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
import { ensureCanonicalProvePrepared } from '@/services/canonical-prepared-activity.service';
import { decisionMayNeedProvePreparation } from '@/services/prove-preparation-trigger.service';
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
      "qs.quiz_mode = 'canonical_prove'", "qs.status = 'active'", 'qs.expires_at > NOW()', 'qs.language = $3', 'qs.pedagogical_policy_version = $4',
      "canonicalActivityType' = $5", "'itemCount'->>'authorized')::int = $6", "'difficulty'->>'min')::int = $7", "'difficulty'->>'max')::int = $8",
      "'difficulty'->>'target')::int = $9", "independence')::boolean = $10", 'jsonb_array_length(qs.questions) = $6', 'NOT EXISTS', 'le.timestamp >= qs.created_at',
    ]) expect(sql).toContain(clause);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(params).toEqual(['s', 'c', 'es', 'v1', 'PROVE', 10, 3, 4, 3, true]);
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

  it('the route resumes BEFORE any prepared lookup or generation, returns without storing a new session, and writes no evidence', () => {
    const resumeIdx = ROUTE.indexOf('await findResumableCanonicalProveSession({');
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(resumeIdx).toBeLessThan(ROUTE.indexOf('await findActivePreparedActivity('));
    expect(resumeIdx).toBeLessThan(ROUTE.indexOf('await generateCanonicalProveQuestions({'));
    const block = ROUTE.slice(resumeIdx, ROUTE.indexOf("const [questionArrays, askConfidenceFlags] = await Promise.all(["));
    expect(block).toMatch(/quizId: resumable\.quizId/);
    expect(block).toMatch(/resumable\.questions\.map\(\(q, i\) => toClientQuestion\(q, i\)\)/);
    expect(block).not.toMatch(/storeQuiz|recordEvidence|learning_evidence|INSERT/);
    const guardIdx = ROUTE.indexOf("if (validated.quizMode === 'canonical_prove' && v1Marker && v1Marker.itemCount) {");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(resumeIdx);
  });

  it('the resume only runs after the fresh canonical authorization (v1Marker) -- independence and contract come from the engine, never the client', () => {
    expect(ROUTE.indexOf("if (validated.quizMode === 'canonical_prove' && !v1Marker)")).toBeLessThan(ROUTE.indexOf('await findResumableCanonicalProveSession({'));
  });
});

describe('2. pre-generation is re-armed while PROVE is the next action', () => {
  const decision = (over: Record<string, unknown> = {}): any => ({
    stage: 'PROVE', actionState: 'EXECUTABLE', policyVersion: 'v1', canonicalRevision: 'r',
    activityContract: { activityType: 'PROVE', itemCount: { min: 10, max: 10 }, difficulty: { min: 3, max: 4, target: 3 }, independence: true, supportLevel: 'NONE', minimumScorePercent: 80 },
    ...over,
  });
  const base = { studentId: 's', conceptId: 'c', subjectId: 'sub', language: 'es', guidance: 'g', visualAidRate: 0, ibContext: null };

  it('not PROVE / not executable -> nothing happens', async () => {
    expect(await ensureCanonicalProvePrepared({ ...base, decision: decision({ stage: 'PRACTICE' }) })).toBe('NOT_APPLICABLE');
    expect(await ensureCanonicalProvePrepared({ ...base, decision: decision({ actionState: 'WAITING' }) })).toBe('NOT_APPLICABLE');
    expect(queryMock).not.toHaveBeenCalled();
    expect(decisionMayNeedProvePreparation(decision({ stage: 'PRACTICE' }))).toBe(false);
    expect(decisionMayNeedProvePreparation(decision())).toBe(true);
  });

  it('a READY unexpired or PREPARING batch -> no second preparation', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'p', status: 'READY', expires_at: new Date(Date.now() + 60_000), activity_contract: '{}', questions: '[]' }] });
    expect(await ensureCanonicalProvePrepared({ ...base, decision: decision() })).toBe('ALREADY_PREPARED');
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'p', status: 'PREPARING', expires_at: new Date(Date.now() + 60_000), activity_contract: '{}', questions: '[]' }] });
    expect(await ensureCanonicalProvePrepared({ ...base, decision: decision() })).toBe('ALREADY_PREPARED');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('EXPIRED (the E2E case) or nothing prepared -> a new preparation starts through the certified pipeline', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM canonical_prepared_activity/.test(sql)) return { rows: [{ id: 'p', status: 'READY', expires_at: new Date(Date.now() - 1000), activity_contract: '{}', questions: '[]' }] };
      if (/INSERT INTO canonical_prepared_activity/.test(sql)) return { rows: [] }; // dedup slot already taken -> skipped, never generated twice
      return { rows: [] };
    });
    expect(await ensureCanonicalProvePrepared({ ...base, decision: decision() })).toBe('PREPARATION_STARTED');
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO canonical_prepared_activity/.test(sql))).toBe(true);
  });

  it('never throws', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    expect(await ensureCanonicalProvePrepared({ ...base, decision: decision() })).toBe('FAILED');
  });

  it('Concept Mission schedules it after the response, only when PROVE may need it', () => {
    expect(PAGE).toMatch(/if \(decisionMayNeedProvePreparation\(canonicalDecision\)\) \{\s*after\(\(\) => keepCanonicalProvePrepared\(/);
  });
});

describe('3. same generation context as the live request', () => {
  it('guidance comes from ONE shared config used by the live route and every background trigger', () => {
    expect(ROUTE).toMatch(/guidance: CANONICAL_PROVE_GENERATION_CONFIG\.guidance/);
    expect(read('src/services/prove-preparation-trigger.service.ts')).toMatch(/guidance: CANONICAL_PROVE_GENERATION_CONFIG\.guidance/);
    expect(CANONICAL_PROVE_GENERATION_CONFIG.guidance).toMatch(/independent mastery check/);
  });

  it('language and IB/DP/HL context are resolved by the same shared service the route uses', () => {
    expect(ROUTE).toMatch(/import \{ resolveLanguageForSubject, getSubjectIBContext \} from '@\/services\/subject-generation-context\.service'/);
    const trig = read('src/services/prove-preparation-trigger.service.ts');
    expect(trig).toMatch(/resolveLanguageForSubject\(params\.subjectId, params\.studentId\)/);
    expect(trig).toMatch(/getSubjectIBContext\(params\.subjectId\)/);
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
