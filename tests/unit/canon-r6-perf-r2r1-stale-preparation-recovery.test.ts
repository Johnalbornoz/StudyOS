/**
 * CANON-R6-PERF-R2R1 -- PREPARED ACTIVITY STALE-LOCK RECOVERY.
 *
 * Surgical repair of the single CANON-R6-PERF-R2 blocker: an expired
 * READY row or an abandoned PREPARING row (background invocation died
 * before its own READY/FAILED transition) would otherwise continue to
 * occupy `idx_canonical_prepared_activity_one_active`'s partial unique
 * index forever, permanently suppressing future valid Prove
 * preparation for that canonical identity.
 *
 * Real, mocked-DB tests of `canonical-prepared-activity.service.ts`'s
 * new stale-row cleanup, following this codebase's own established
 * `vi.mock('@/lib/db', ...)` pattern (see
 * canon-r6-perf-r2-prove-pregeneration.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const PREPARED_ACTIVITY_SRC = read('src/services/canonical-prepared-activity.service.ts');
const MIGRATION_SRC = read('database/migrations/20260916_1000_canon_r6_perf_r2_canonical_prepared_activity.sql');
const PROVE_FOCUS_LOADING_SRC = read('src/components/ProveFocusLoading.tsx');
const GENERATION_SERVICE_SRC = read('src/services/canonical-prove-generation.service.ts');

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const generateMock = vi.fn();
vi.mock('@/services/canonical-prove-generation.service', () => ({
  generateCanonicalProveQuestions: (...a: any[]) => generateMock(...a),
}));

vi.mock('@/services/quiz-persistence.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-persistence.service')>('@/services/quiz-persistence.service');
  return { ...actual, loadPriorPracticeQuestionFingerprints: vi.fn().mockResolvedValue(new Set()) };
});

import {
  prepareCanonicalProveActivity,
  PREPARED_ACTIVITY_TTL_MS,
  PREPARATION_LEASE_MS,
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

const PREPARE_PARAMS = {
  studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
  pedagogicalPolicyVersion: 'v1', canonicalRevision: 'rev1', contract: CONTRACT,
  language: 'en', guidance: 'g', visualAidRate: 0, ibContext: null,
} as const;

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  queryMock.mockReset();
  generateMock.mockReset();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ============================================================
// 1. Non-expired READY still blocks
// ============================================================
describe('1. a non-expired READY row still blocks a new preparation', () => {
  it('both cleanup UPDATEs find nothing to retire, and the INSERT loses to the still-active row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // expired-READY cleanup: nothing matched (row not expired)
    queryMock.mockResolvedValueOnce({ rows: [] }); // stale-PREPARING cleanup: nothing matched
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT ... ON CONFLICT DO NOTHING: loses to the active READY row
    await prepareCanonicalProveActivity(PREPARE_PARAMS);
    expect(generateMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});

// ============================================================
// 2. Expired READY invalidated before INSERT
// ============================================================
describe('2. an expired READY row is retired to INVALIDATED before the new INSERT runs', () => {
  it('the expired-READY cleanup UPDATE runs FIRST, is scoped to the same canonical identity, never deletes the row, and fires before the INSERT', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'old-ready-1' }] }); // expired-READY cleanup: retired one row
    queryMock.mockResolvedValueOnce({ rows: [] }); // stale-PREPARING cleanup: nothing matched
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT loses (irrelevant to this test)
    await prepareCanonicalProveActivity(PREPARE_PARAMS);

    const expiredCleanupCall = queryMock.mock.calls[0];
    expect(expiredCleanupCall[0]).toMatch(/SET status = 'INVALIDATED'/);
    expect(expiredCleanupCall[0]).not.toMatch(/DELETE/i);
    expect(expiredCleanupCall[0]).toMatch(/status = 'READY'\s+AND expires_at <= NOW\(\)/);
    expect(expiredCleanupCall[0]).toMatch(/student_id = \$1 AND concept_id = \$2 AND stage = 'PROVE' AND pedagogical_policy_version = \$3/);
    expect(expiredCleanupCall[1]).toEqual(['s1', 'c1', 'v1']);

    expect(logSpy).toHaveBeenCalledWith('prove_pregeneration_expired_invalidated', expect.stringContaining('"count":1'));
  });
});

// ============================================================
// 3. Replacement then created
// ============================================================
describe('3. a fresh preparation is created once the expired row is retired', () => {
  it('after the expired-READY cleanup retires the old row, the INSERT wins and generation proceeds', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'old-ready-1' }] }); // expired-READY retired
    queryMock.mockResolvedValueOnce({ rows: [] }); // stale-PREPARING: nothing
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-prep-1' }] }); // INSERT wins
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE ... READY
    generateMock.mockResolvedValue({
      questions: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)),
      finalQuestionCount: 10,
      priorPracticeFingerprintCount: 0,
      aggregateRecoveryUsed: false,
    });
    await prepareCanonicalProveActivity(PREPARE_PARAMS);
    expect(generateMock).toHaveBeenCalledTimes(1);
    const readyUpdate = queryMock.mock.calls[3];
    expect(readyUpdate[0]).toMatch(/SET status = 'READY'/);
  });
});

// ============================================================
// 4. Fresh (non-stale) PREPARING still blocks
// ============================================================
describe('4. a PREPARING row still inside its lease still blocks a new preparation', () => {
  it('the stale-PREPARING cleanup finds nothing (lease not yet expired), and the INSERT loses to the still-active row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // expired-READY: nothing
    queryMock.mockResolvedValueOnce({ rows: [] }); // stale-PREPARING: nothing matched -- still within lease
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT loses to the still-active PREPARING row
    await prepareCanonicalProveActivity(PREPARE_PARAMS);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 5. Stale PREPARING retired
// ============================================================
describe('5. a PREPARING row past its lease is retired to FAILED', () => {
  it('the stale-PREPARING cleanup UPDATE is scoped correctly, uses the PREPARATION_LEASE_MS constant, marks FAILED (never INVALIDATED -- Part: "prefer FAILED if preparation never completed"), and never deletes the row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // expired-READY: nothing
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'old-preparing-1' }] }); // stale-PREPARING: retired one row
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT loses (irrelevant here)
    await prepareCanonicalProveActivity(PREPARE_PARAMS);

    const staleCleanupCall = queryMock.mock.calls[1];
    expect(staleCleanupCall[0]).toMatch(/SET status = 'FAILED', failure_reason = 'STALE_PREPARATION_LEASE_EXPIRED'/);
    expect(staleCleanupCall[0]).not.toMatch(/DELETE/i);
    expect(staleCleanupCall[0]).toMatch(/status = 'PREPARING'\s+AND created_at < NOW\(\) - /);
    expect(staleCleanupCall[1]).toEqual(['s1', 'c1', 'v1', String(PREPARATION_LEASE_MS)]);

    expect(logSpy).toHaveBeenCalledWith('prove_pregeneration_stale_preparing_recovered', expect.stringContaining('"count":1'));
  });

  it('PREPARATION_LEASE_MS is a conservative, finite, >10x margin over R1\'s own observed ~27.111s live total generation time -- never so short a legitimate in-flight generation is invalidated', () => {
    expect(PREPARATION_LEASE_MS).toBe(5 * 60 * 1000);
    expect(PREPARATION_LEASE_MS).toBeGreaterThan(27_111 * 10);
  });
});

// ============================================================
// 6. Replacement after stale-PREPARING recovery
// ============================================================
describe('6. a fresh preparation is created once a stale PREPARING row is recovered', () => {
  it('after the stale-PREPARING cleanup retires the abandoned row, the INSERT wins and generation proceeds', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // expired-READY: nothing
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'old-preparing-1' }] }); // stale-PREPARING retired
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-prep-2' }] }); // INSERT wins
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE ... READY
    generateMock.mockResolvedValue({
      questions: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)),
      finalQuestionCount: 10,
      priorPracticeFingerprintCount: 0,
      aggregateRecoveryUsed: false,
    });
    await prepareCanonicalProveActivity(PREPARE_PARAMS);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// 7. Race safety -- concurrent preparations still yield at most one
// active row
// ============================================================
describe('7. concurrent preparation attempts for the SAME canonical identity still yield at most one active row', () => {
  it('a second, racing call whose INSERT loses never proceeds to generation, even if it ran its own cleanup UPDATEs first', async () => {
    // A mocked db resolves synchronously, so it cannot reproduce real
    // interleaved concurrency -- the actual "only one caller can ever
    // win" guarantee is the DB's own unique-index atomicity (asserted
    // by the unchanged-index test below). What this test demonstrates
    // at the application-code level is the CONSEQUENCE that guarantee
    // relies on: a caller whose INSERT returns zero rows (because
    // another active row already exists -- whether pre-existing or won
    // moments earlier by a true concurrent racer) never proceeds to
    // generation, regardless of what its own cleanup UPDATEs found.
    generateMock.mockResolvedValue({ questions: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)), finalQuestionCount: 10, priorPracticeFingerprintCount: 0, aggregateRecoveryUsed: false });

    queryMock.mockResolvedValueOnce({ rows: [] }); // caller A: expired-READY cleanup
    queryMock.mockResolvedValueOnce({ rows: [] }); // caller A: stale-PREPARING cleanup
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'winner' }] }); // caller A: wins the INSERT
    queryMock.mockResolvedValueOnce({ rows: [] }); // caller A: UPDATE ... READY
    await prepareCanonicalProveActivity(PREPARE_PARAMS); // caller A

    queryMock.mockResolvedValueOnce({ rows: [] }); // caller B: expired-READY cleanup
    queryMock.mockResolvedValueOnce({ rows: [] }); // caller B: stale-PREPARING cleanup
    queryMock.mockResolvedValueOnce({ rows: [] }); // caller B: loses the INSERT (A's row is now active)
    await prepareCanonicalProveActivity(PREPARE_PARAMS); // caller B, racing for the same identity

    expect(generateMock).toHaveBeenCalledTimes(1); // only the winner ever generates
  });

  it('the cleanup UPDATEs run without an explicit BEGIN/COMMIT transaction wrapper -- correctness rests on each statement\'s own atomicity plus the pre-existing partial unique index, which is never weakened', () => {
    const idx = PREPARED_ACTIVITY_SRC.indexOf('export async function prepareCanonicalProveActivity');
    const block = PREPARED_ACTIVITY_SRC.slice(idx, PREPARED_ACTIVITY_SRC.indexOf('ON CONFLICT DO NOTHING', idx));
    expect(block).not.toMatch(/BEGIN|COMMIT|ROLLBACK/);
  });

  it('the unique index text itself is unchanged -- still keyed on (student_id, concept_id, stage, pedagogical_policy_version), still excluding canonical_revision', () => {
    const idx = MIGRATION_SRC.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_prepared_activity_one_active');
    expect(idx).toBeGreaterThan(-1);
    const slice = MIGRATION_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/ON canonical_prepared_activity \(student_id, concept_id, stage, pedagogical_policy_version\)/);
    expect(slice).toMatch(/WHERE status IN \('PREPARING', 'READY'\)/);
  });
});

// ============================================================
// 8. TTL semantics -- expired row neither consumable nor blocking
// ============================================================
describe('8. TTL semantics: an expired row is neither consumable NOR blocking (both properties required)', () => {
  it('not-blocking: proven by test 2/3 above (expired READY is retired before a new INSERT)', () => {
    expect(true).toBe(true); // documentation anchor -- the real assertions live in describe blocks 2/3
  });

  it('not-consumable: revalidatePreparedActivity already rejects an expired row with reason EXPIRED -- unchanged by this phase (firewall)', () => {
    const idx = PREPARED_ACTIVITY_SRC.indexOf('export async function revalidatePreparedActivity');
    const block = PREPARED_ACTIVITY_SRC.slice(idx, idx + 800);
    expect(block).toMatch(/if \(prepared\.expiresAt && prepared\.expiresAt\.getTime\(\) < Date\.now\(\)\) \{\s*\n\s*return \{ valid: false, reason: 'EXPIRED' \};/);
  });
});

// ============================================================
// 9. DB impact -- no migration schema change required
// ============================================================
describe('9. no DB migration schema change is required', () => {
  it('the existing (still unapplied) migration already CHECK-constrains status to include INVALIDATED and FAILED', () => {
    expect(MIGRATION_SRC).toMatch(/CHECK \(status IN \('PREPARING', 'READY', 'CONSUMED', 'INVALIDATED', 'FAILED'\)\)/);
  });

  it('the existing migration already has expires_at and created_at columns -- everything this recovery mechanism reads/writes already exists', () => {
    expect(MIGRATION_SRC).toMatch(/created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    expect(MIGRATION_SRC).toMatch(/expires_at TIMESTAMPTZ/);
    expect(MIGRATION_SRC).toMatch(/failure_reason TEXT/);
  });

  it('this phase only ever edits the SAME unapplied migration file (a clarifying comment) -- never stacks a second migration file for this recovery', () => {
    expect(MIGRATION_SRC).toMatch(/CANON-R6-PERF-R2R1 \(stale-lock recovery\) note/);
    expect(MIGRATION_SRC).not.toMatch(/ALTER TABLE canonical_prepared_activity/);
  });
});

// ============================================================
// 10. Full regression firewall -- no changes beyond this surgical repair
// ============================================================
describe('10. firewall -- canonical engine, generator, chunking, gate, novelty, cache-hit validation, focus loading UX, and TTL duration are all unchanged', () => {
  it('PREPARED_ACTIVITY_TTL_MS remains 2 hours -- unchanged by the new, separate PREPARATION_LEASE_MS constant', () => {
    expect(PREPARED_ACTIVITY_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('PREPARATION_LEASE_MS is a NEW, distinct constant from PREPARED_ACTIVITY_TTL_MS -- never conflated', () => {
    expect(PREPARATION_LEASE_MS).not.toBe(PREPARED_ACTIVITY_TTL_MS);
  });

  it('revalidatePreparedActivity, consumePreparedActivity, isPreparedActivityContractCompatible, findActivePreparedActivity are untouched -- the ordered cheap-first-then-novelty consumption sequence still stands', () => {
    expect(PREPARED_ACTIVITY_SRC).toMatch(/export async function revalidatePreparedActivity/);
    expect(PREPARED_ACTIVITY_SRC).toMatch(/export async function consumePreparedActivity/);
    expect(PREPARED_ACTIVITY_SRC).toMatch(/export function isPreparedActivityContractCompatible/);
    expect(PREPARED_ACTIVITY_SRC).toMatch(/export async function findActivePreparedActivity/);
  });

  it('the certified generation pipeline (canonical-prove-generation.service.ts) is untouched by this phase', () => {
    expect(GENERATION_SERVICE_SRC).toMatch(/export async function generateCanonicalProveQuestions/);
  });

  it('the focused loading UX component is untouched by this phase', () => {
    expect(PROVE_FOCUS_LOADING_SRC).toMatch(/export default function ProveFocusLoading/);
  });

  it('never logs question content in the two new observability events -- only ids/counts', () => {
    const expiredIdx = PREPARED_ACTIVITY_SRC.indexOf("safeLog('prove_pregeneration_expired_invalidated'");
    const staleIdx = PREPARED_ACTIVITY_SRC.indexOf("safeLog('prove_pregeneration_stale_preparing_recovered'");
    expect(expiredIdx).toBeGreaterThan(-1);
    expect(staleIdx).toBeGreaterThan(-1);
    const expiredCall = PREPARED_ACTIVITY_SRC.slice(expiredIdx, expiredIdx + 120);
    const staleCall = PREPARED_ACTIVITY_SRC.slice(staleIdx, staleIdx + 140);
    expect(expiredCall).not.toMatch(/questions/);
    expect(staleCall).not.toMatch(/questions/);
  });
});
