/**
 * CANON-R6-PERF-R2 -- SELECTIVE CANONICAL PROVE PRE-GENERATION.
 *
 * Real, mocked-DB tests of `canonical-prepared-activity.service.ts`'s
 * own logic (compatibility checking, atomic consumption semantics,
 * revalidation, deduplication via ON CONFLICT), plus source-audit
 * coverage of the route-level trigger/consumption wiring, following
 * this route's own established testing convention (see
 * canon-r5r1-generate-and-take-wiring.test.ts's doc comment) -- a full
 * HTTP-level invocation would require mocking the entire AI generation
 * pipeline and background-scheduling primitive this phase's firewall
 * explicitly protects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const PREPARED_ACTIVITY_SRC = read('src/services/canonical-prepared-activity.service.ts');
const MIGRATION_SRC = read('database/migrations/20260916_1000_canon_r6_perf_r2_canonical_prepared_activity.sql');

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const generateMock = vi.fn();
vi.mock('@/services/canonical-prove-generation.service', () => ({
  generateCanonicalProveQuestions: (...a: any[]) => generateMock(...a),
}));

const loadFingerprintsMock = vi.fn();
vi.mock('@/services/quiz-persistence.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-persistence.service')>('@/services/quiz-persistence.service');
  return { ...actual, loadPriorPracticeQuestionFingerprints: (...a: any[]) => loadFingerprintsMock(...a) };
});

import {
  isPreparedActivityContractCompatible,
  prepareCanonicalProveActivity,
  findActivePreparedActivity,
  revalidatePreparedActivity,
  consumePreparedActivity,
  invalidatePreparedActivity,
  PREPARED_ACTIVITY_TTL_MS,
  type CanonicalPreparedActivityRow,
  type PreparedActivityContractSnapshot,
} from '@/services/canonical-prepared-activity.service';

const CONTRACT: PreparedActivityContractSnapshot = {
  canonicalActivityType: 'PROVE',
  itemCount: { min: 10, max: 10, authorized: 10 },
  difficulty: { min: 3, max: 4, target: 3 },
  independence: true,
  supportLevel: 'NONE',
  minimumScorePercent: 80,
};

const Q = (id: string): any => ({
  id, conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: id,
  correctAnswer: 'a', explanation: 'e', difficulty: 3,
});

function row(overrides: Partial<any> = {}): any {
  return {
    id: 'prep-1',
    student_id: 's1',
    concept_id: 'c1',
    stage: 'PROVE',
    pedagogical_policy_version: 'studyus-canonical-v1',
    canonical_revision: 'rev-1',
    activity_contract: JSON.stringify(CONTRACT),
    status: 'READY',
    questions: JSON.stringify([Q('a'), Q('b')]),
    novelty_policy: 'EXACT_DUPLICATE_EXCLUSION_V1',
    prior_practice_fingerprint_basis: JSON.stringify({ count: 3, hash: 'x' }),
    created_at: new Date(),
    ready_at: new Date(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60),
    consumed_at: null,
    consumed_by_quiz_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  generateMock.mockReset();
  loadFingerprintsMock.mockReset().mockResolvedValue(new Set());
});

// ============================================================
// isPreparedActivityContractCompatible -- pure
// ============================================================
describe('isPreparedActivityContractCompatible -- Part 9 compatibility, never raw revision equality', () => {
  it('identical contracts are compatible', () => {
    expect(isPreparedActivityContractCompatible(CONTRACT, { ...CONTRACT })).toBe(true);
  });

  it('a different itemCount.authorized is incompatible', () => {
    expect(isPreparedActivityContractCompatible(CONTRACT, { ...CONTRACT, itemCount: { min: 10, max: 10, authorized: 9 } })).toBe(false);
  });

  it('a different difficulty target is incompatible', () => {
    expect(isPreparedActivityContractCompatible(CONTRACT, { ...CONTRACT, difficulty: { min: 3, max: 4, target: 4 } })).toBe(false);
  });

  it('a different independence flag is incompatible', () => {
    expect(isPreparedActivityContractCompatible(CONTRACT, { ...CONTRACT, independence: false })).toBe(false);
  });

  it('a different supportLevel is incompatible', () => {
    expect(isPreparedActivityContractCompatible(CONTRACT, { ...CONTRACT, supportLevel: 'ASSISTED' })).toBe(false);
  });

  it('a different minimumScorePercent is incompatible', () => {
    expect(isPreparedActivityContractCompatible(CONTRACT, { ...CONTRACT, minimumScorePercent: 70 })).toBe(false);
  });

  it('function signature never accepts/compares canonicalRevision -- compatibility is contract-shape-only (Part 9: a revision bump unrelated to Prove must never force re-preparation)', () => {
    const src = PREPARED_ACTIVITY_SRC.slice(
      PREPARED_ACTIVITY_SRC.indexOf('export function isPreparedActivityContractCompatible'),
      PREPARED_ACTIVITY_SRC.indexOf('export interface PreparedActivityRevalidation'),
    );
    expect(src).not.toMatch(/canonicalRevision/);
  });
});

// ============================================================
// prepareCanonicalProveActivity -- dedup, generation, failure safety
// ============================================================
// CANON-R6-PERF-R2R1: every prepareCanonicalProveActivity call now runs
// TWO stale-row cleanup UPDATEs (expired-READY, stale-PREPARING) before
// its own INSERT ... ON CONFLICT DO NOTHING. Tests that don't care about
// the cleanup's own behavior pre-seed both as "no stale rows found".
function mockNoStaleRows(): void {
  queryMock.mockResolvedValueOnce({ rows: [] }); // expired-READY cleanup: nothing matched
  queryMock.mockResolvedValueOnce({ rows: [] }); // stale-PREPARING cleanup: nothing matched
}

describe('prepareCanonicalProveActivity -- Part 1/2/3/6/14', () => {
  it('deduplicates via the atomic INSERT ... ON CONFLICT DO NOTHING -- a losing insert (0 rows returned) never proceeds to generation', async () => {
    mockNoStaleRows();
    queryMock.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING -- another active prep already exists
    await prepareCanonicalProveActivity({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      pedagogicalPolicyVersion: 'v1', canonicalRevision: 'rev1', contract: CONTRACT,
      language: 'en', guidance: 'g', visualAidRate: 0, ibContext: null,
    });
    expect(generateMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(3); // 2 cleanup UPDATEs + the insert attempt -- no further writes
  });

  it('on a winning insert, calls the SAME certified generateCanonicalProveQuestions pipeline -- never a cheaper one (Part 6)', async () => {
    mockNoStaleRows();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'prep-1' }] }); // won the insert race
    queryMock.mockResolvedValueOnce({ rows: [] }); // the UPDATE ... READY
    generateMock.mockResolvedValue({
      questions: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)),
      finalQuestionCount: 10,
      priorPracticeFingerprintCount: 2,
      aggregateRecoveryUsed: false,
      generationConcurrentMs: 123,
    });
    await prepareCanonicalProveActivity({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      pedagogicalPolicyVersion: 'v1', canonicalRevision: 'rev1', contract: CONTRACT,
      language: 'en', guidance: 'g', visualAidRate: 0, ibContext: null,
    });
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0]).toMatchObject({ conceptId: 'c1', studentId: 's1', targetCount: 10, difficulty: 3 });
    const updateCall = queryMock.mock.calls[3];
    expect(updateCall[0]).toMatch(/SET status = 'READY'/);
  });

  it('a short generation result (< authorized count) marks the row FAILED, never READY with fewer than the contract requires', async () => {
    mockNoStaleRows();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'prep-1' }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // the UPDATE ... FAILED
    generateMock.mockResolvedValue({ questions: [Q('a')], finalQuestionCount: 1, priorPracticeFingerprintCount: 0, aggregateRecoveryUsed: true });
    await prepareCanonicalProveActivity({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      pedagogicalPolicyVersion: 'v1', canonicalRevision: 'rev1', contract: CONTRACT,
      language: 'en', guidance: 'g', visualAidRate: 0, ibContext: null,
    });
    const updateCall = queryMock.mock.calls[3];
    expect(updateCall[0]).toMatch(/SET status = 'FAILED'/);
    expect(updateCall[1]).toContain('GENERATION_INCOMPLETE');
  });

  it('Part 14 -- an unexpected error during generation is caught internally and never rethrown to the caller (background failure safety)', async () => {
    mockNoStaleRows();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'prep-1' }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // best-effort FAILED update
    generateMock.mockRejectedValue(new Error('boom'));
    await expect(
      prepareCanonicalProveActivity({
        studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
        pedagogicalPolicyVersion: 'v1', canonicalRevision: 'rev1', contract: CONTRACT,
        language: 'en', guidance: 'g', visualAidRate: 0, ibContext: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('never writes learning_evidence, quiz_sessions, or anything but canonical_prepared_activity -- preparation is never a learner attempt (Part 4)', async () => {
    mockNoStaleRows();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'prep-1' }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    generateMock.mockResolvedValue({ questions: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)), finalQuestionCount: 10, priorPracticeFingerprintCount: 0, aggregateRecoveryUsed: false });
    await prepareCanonicalProveActivity({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      pedagogicalPolicyVersion: 'v1', canonicalRevision: 'rev1', contract: CONTRACT,
      language: 'en', guidance: 'g', visualAidRate: 0, ibContext: null,
    });
    for (const call of queryMock.mock.calls) {
      expect(call[0]).not.toMatch(/learning_evidence|INSERT INTO quiz_sessions/);
    }
  });
});

// ============================================================
// revalidatePreparedActivity -- Part 8 full consumption-time check
// ============================================================
function toRow(r: any): CanonicalPreparedActivityRow {
  return {
    id: r.id, studentId: r.student_id, conceptId: r.concept_id, stage: r.stage,
    pedagogicalPolicyVersion: r.pedagogical_policy_version, canonicalRevision: r.canonical_revision,
    activityContract: JSON.parse(r.activity_contract), status: r.status,
    questions: r.questions ? JSON.parse(r.questions) : null,
    noveltyPolicy: r.novelty_policy,
    priorPracticeFingerprintBasis: r.prior_practice_fingerprint_basis ? JSON.parse(r.prior_practice_fingerprint_basis) : null,
    createdAt: r.created_at, readyAt: r.ready_at, expiresAt: r.expires_at, consumedAt: r.consumed_at, consumedByQuizId: r.consumed_by_quiz_id,
  };
}

describe('revalidatePreparedActivity -- Part 8 (status/expiry/contract cheap-first, THEN a real novelty re-check)', () => {
  it('valid: READY, not expired, compatible contract, zero fresh-fingerprint collisions', async () => {
    loadFingerprintsMock.mockResolvedValue(new Set(['some other question']));
    const result = await revalidatePreparedActivity(toRow(row()), CONTRACT);
    expect(result.valid).toBe(true);
  });

  it('not READY -> invalid, reason NOT_READY, never reaches the novelty re-check (no DB read)', async () => {
    const result = await revalidatePreparedActivity(toRow(row({ status: 'PREPARING' })), CONTRACT);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('NOT_READY');
    expect(loadFingerprintsMock).not.toHaveBeenCalled();
  });

  it('expired -> invalid, reason EXPIRED, never reaches the novelty re-check', async () => {
    const result = await revalidatePreparedActivity(toRow(row({ expires_at: new Date(Date.now() - 1000) })), CONTRACT);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('EXPIRED');
    expect(loadFingerprintsMock).not.toHaveBeenCalled();
  });

  it('incompatible contract -> invalid, reason INCOMPATIBLE_CONTRACT, never reaches the novelty re-check', async () => {
    const result = await revalidatePreparedActivity(toRow(row()), { ...CONTRACT, minimumScorePercent: 70 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('INCOMPATIBLE_CONTRACT');
    expect(loadFingerprintsMock).not.toHaveBeenCalled();
  });

  it('Part 8 -- a fresh-fingerprint collision (new Practice happened since prep) invalidates the WHOLE batch, reason NOVELTY_STALE -- never partially patched', async () => {
    loadFingerprintsMock.mockResolvedValue(new Set(['a'])); // collides with prepared question id 'a''s own text
    const result = await revalidatePreparedActivity(toRow(row()), CONTRACT);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('NOVELTY_STALE');
  });

  it('always re-fetches FRESH fingerprints -- never trusts the stored priorPracticeFingerprintBasis hash alone to decide validity', () => {
    const idx = PREPARED_ACTIVITY_SRC.indexOf('export async function revalidatePreparedActivity');
    const block = PREPARED_ACTIVITY_SRC.slice(idx);
    expect(block).toMatch(/const freshFingerprints = await loadPriorPracticeQuestionFingerprints\(/);
  });
});

// ============================================================
// consumePreparedActivity -- Part 10 atomic single consumption
// ============================================================
describe('consumePreparedActivity -- Part 10 atomic, single-use', () => {
  it('the UPDATE is conditioned on status = READY -- a second concurrent call against the SAME row (already CONSUMED) affects zero rows', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // second caller loses the race
    const result = await consumePreparedActivity('prep-1', 'quiz-abc');
    expect(result).toBeNull();
    expect(queryMock.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND status = 'READY'/);
  });

  it('a winning consumption returns the questions and stamps consumed_by_quiz_id atomically in the SAME statement', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ questions: JSON.stringify([Q('a')]) }] });
    const result = await consumePreparedActivity('prep-1', 'quiz-abc');
    expect(result).toEqual([Q('a')]);
    expect(queryMock.mock.calls[0][0]).toMatch(/SET status = 'CONSUMED', consumed_at = NOW\(\), consumed_by_quiz_id = \$2/);
  });
});

describe('invalidatePreparedActivity -- Part 8/9', () => {
  it('only invalidates a row still in READY -- never reuses/overwrites an already-consumed or already-invalidated row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await invalidatePreparedActivity('prep-1', 'EXPIRED');
    expect(queryMock.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND status = 'READY'/);
  });
});

// ============================================================
// TTL
// ============================================================
describe('TTL -- Part 13', () => {
  it('is conservative and finite -- 2 hours, never indefinite', () => {
    expect(PREPARED_ACTIVITY_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('prepareCanonicalProveActivity always sets expires_at on insert', () => {
    expect(PREPARED_ACTIVITY_SRC).toMatch(/const expiresAt = new Date\(Date\.now\(\) \+ PREPARED_ACTIVITY_TTL_MS\);/);
    expect(PREPARED_ACTIVITY_SRC).toMatch(/expires_at\b[\s\S]{0,300}\$7/);
  });
});

// ============================================================
// DB migration -- source audit
// ============================================================
describe('DB migration -- Part 5', () => {
  it('additive only -- CREATE TABLE IF NOT EXISTS, no ALTER/DROP of any existing table', () => {
    expect(MIGRATION_SRC).toMatch(/CREATE TABLE IF NOT EXISTS canonical_prepared_activity/);
    expect(MIGRATION_SRC).not.toMatch(/ALTER TABLE (?!canonical_prepared_activity)|DROP TABLE|DROP COLUMN/);
  });

  it('the partial unique index prevents duplicate ACTIVE (PREPARING/READY) preparation for the same canonical identity, WITHOUT canonicalRevision in the key (Part 9)', () => {
    const idx = MIGRATION_SRC.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_prepared_activity_one_active');
    expect(idx).toBeGreaterThan(-1);
    const slice = MIGRATION_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/ON canonical_prepared_activity \(student_id, concept_id, stage, pedagogical_policy_version\)/);
    expect(slice).toMatch(/WHERE status IN \('PREPARING', 'READY'\)/);
    expect(slice).not.toMatch(/canonical_revision/);
  });

  it('generically named (not Prove-only) so a future phase can extend to RETAIN/TRANSFER without a second table (Part 32)', () => {
    expect(MIGRATION_SRC).toMatch(/stage TEXT NOT NULL CHECK \(stage IN \('PROVE', 'RETAIN', 'TRANSFER'\)\)/);
  });

  it('never named prove_cache_only or similar Prove-specific name (Part 32\'s own explicit instruction)', () => {
    expect(MIGRATION_SRC).not.toMatch(/prove_cache/i);
  });
});

// ============================================================
// Route wiring -- trigger (Part 2/3) and consumption (Part 8/10/11)
// ============================================================
describe('route wiring -- Part 2 trigger', () => {
  it('the trigger fires only inside the fresh-canonical-decision success branch (canonicalResultsStatus = OK), gated on stage === PROVE && actionState === EXECUTABLE', () => {
    const okIdx = ROUTE_SRC.indexOf("canonicalResultsStatus = 'OK';");
    expect(okIdx).toBeGreaterThan(-1);
    const triggerIdx = ROUTE_SRC.indexOf("if (fresh.decision.stage === 'PROVE' && fresh.decision.actionState === 'EXECUTABLE'", okIdx);
    expect(triggerIdx).toBeGreaterThan(okIdx);
    // still inside the SAME try block, before its own catch -- not an
    // exact-distance check (real-world comments between them vary).
    const catchIdx = ROUTE_SRC.indexOf('} catch (error) {', okIdx);
    expect(triggerIdx).toBeLessThan(catchIdx);
  });

  it('uses after() (Next.js\'s own supported post-response background mechanism, backed by Vercel waitUntil) -- never a bare detached Promise', () => {
    expect(ROUTE_SRC).toMatch(/import \{ NextRequest, NextResponse, after \} from 'next\/server';/);
    expect(ROUTE_SRC).toMatch(/after\(\(\) =>\s*\n\s*prepareCanonicalProveActivity\(/);
  });

  it('Part 2 -- the trigger is scheduled via after(), which runs AFTER the response is sent -- the return statement below is not gated on it, so Practice submission latency is structurally independent of Prove preparation', () => {
    const triggerIdx = ROUTE_SRC.indexOf('after(() =>\n              prepareCanonicalProveActivity(');
    const returnIdx = ROUTE_SRC.indexOf('return NextResponse.json({\n      success: true,\n      data: {\n        quizId: validated.quizId,');
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(triggerIdx);
    // no `await` directly on the after()-wrapped promise.
    const line = ROUTE_SRC.slice(triggerIdx - 10, triggerIdx + 20);
    expect(line).not.toMatch(/await after\(/);
  });

  it('a background preparation failure is caught inside the scheduled callback itself -- never lets an unhandled rejection surface', () => {
    const idx = ROUTE_SRC.indexOf('after(() =>\n              prepareCanonicalProveActivity(');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 1600);
    expect(slice).toMatch(/\.catch\(\(err\) => console\.error\('\[canon-r6-perf-r2\] background Prove preparation failed:', err\)\)/);
  });
});

describe('route wiring -- Part 8/10/11 consumption', () => {
  it('the fresh canonical authorization (v1Marker) is computed and verified BEFORE the prepared-activity lookup ever runs -- the canonical engine remains the sole authority regardless of cache outcome', () => {
    const v1MarkerIdx = ROUTE_SRC.indexOf('const v1Marker =');
    const lookupIdx = ROUTE_SRC.indexOf('const prepared = await findActivePreparedActivity(');
    expect(v1MarkerIdx).toBeGreaterThan(-1);
    expect(lookupIdx).toBeGreaterThan(v1MarkerIdx);
  });

  it('Part 10 -- consumption is attempted via the atomic consumePreparedActivity; a null result (lost the race) falls through to cold generation, never throws/blocks', () => {
    const idx = ROUTE_SRC.indexOf('const consumed = await consumePreparedActivity(');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/if \(consumed\) \{/);
    expect(ROUTE_SRC).toMatch(/\/\/ Lost the atomic race/);
  });

  it('Part 11 -- every non-HIT outcome (MISS/PREPARING/INVALID/EXPIRED, or a lost race) falls through to generateCanonicalProveQuestions -- the learner is never blocked indefinitely waiting on background generation', () => {
    const hitIdx = ROUTE_SRC.indexOf("preparedCacheStatus = 'HIT';");
    const coldGenIdx = ROUTE_SRC.indexOf('const proveGen = await generateCanonicalProveQuestions({');
    expect(hitIdx).toBeGreaterThan(-1);
    expect(coldGenIdx).toBeGreaterThan(hitIdx);
  });

  it('an incompatible/stale prepared activity is invalidated (never silently reused) before falling back to cold generation', () => {
    expect(ROUTE_SRC).toMatch(/await invalidatePreparedActivity\(prepared\.id, revalidation\.reason \?\? 'INCOMPATIBLE_CONTRACT'\)/);
  });

  it('legacy modes never reference findActivePreparedActivity/consumePreparedActivity -- pre-generation is canonical_prove only (Part 31)', () => {
    // CANON-V2-ARCH-CLEANUP -- anchored on the generation-dispatch site's
    // own unique comment, not the bare 'canonical_prove' string (which
    // now also appears earlier in requestedActivityType's widened
    // ternary chain).
    const canonicalProveIdx = ROUTE_SRC.indexOf('CANON-R6-PERF-R2 -- FIRST:');
    expect(canonicalProveIdx).toBeGreaterThan(-1);
    const genericMultiConceptStart = ROUTE_SRC.indexOf('Promise.all(', canonicalProveIdx);
    const genericMultiConceptEnd = ROUTE_SRC.indexOf('computeAskConfidenceFlags(', genericMultiConceptStart);
    const genericBlock = ROUTE_SRC.slice(genericMultiConceptStart, genericMultiConceptEnd);
    expect(genericBlock).not.toMatch(/findActivePreparedActivity|consumePreparedActivity|prepareCanonicalProveActivity/);
  });
});

// ============================================================
// Firewall
// ============================================================
describe('firewall -- no changes to the pedagogical engine, migration, AI routing, or unrelated stages', () => {
  it('no new import from @/lib/pedagogical-engine in any new file', () => {
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
    expect(PREPARED_ACTIVITY_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
  });

  it('no RETAIN/TRANSFER/LEARN preparation is ever triggered -- the trigger fires ONLY on stage === PROVE', () => {
    const triggerIdx = ROUTE_SRC.indexOf("if (fresh.decision.stage === 'PROVE'");
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(ROUTE_SRC.slice(triggerIdx, triggerIdx + 100)).not.toMatch(/RETAIN|TRANSFER|LEARN/);
  });
});
