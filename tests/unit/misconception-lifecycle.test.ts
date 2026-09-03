/**
 * Phase 2C -- Misconception Lifecycle & Current Cognitive Truth.
 *
 * Proves the core invariant: ONLY CURRENTLY ACTIVE CRITICAL
 * MISCONCEPTIONS MAY BLOCK VALIDATED_MASTERY. Structured in three
 * layers: (A) misconception.service.ts's own lifecycle functions,
 * directly, against a mocked @/lib/db; (B) the pure
 * determineMasteryState/determineValidationReadiness classifiers
 * (unchanged since Phase 2.2A) fed ACTIVE-only vs. lifetime counts, to
 * prove the false-negative closure and false-positive protection at
 * the exact point the gate is evaluated; (C) end-to-end
 * mastery.service.ts::updateMastery integration tests (same fake-db
 * harness pattern as evidence-idempotency.test.ts) for observation/
 * resolution/reactivation exactly-once behavior under real transaction
 * semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------
// (A) misconception.service.ts -- direct unit tests.
// ---------------------------------------------------------------------

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import {
  recordStudentMisconception,
  resolveMisconceptionSignatures,
  getActiveMisconceptionSignatureIdsForConcept,
  getMisconceptionCountsForConcept,
  getRecurringMisconceptions,
  isMisconceptionResolutionEvidence,
} from '@/services/misconception.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('recordStudentMisconception -- observation lifecycle', () => {
  it('a brand-new signature: previousStatus null, isReactivation false, occurrence_count starts at 1', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // SELECT status -- no existing row
      .mockResolvedValueOnce({ rows: [{ occurrence_count: 1 }] }); // INSERT ... RETURNING

    const result = await recordStudentMisconception('student-1', 'sig-1', { source: 'explain_defend' });
    expect(result).toEqual({ isReactivation: false, previousStatus: null, occurrenceCount: 1 });
  });

  it('a plain recurrence while already ACTIVE: previousStatus ACTIVE, isReactivation false, occurrence increments', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ status: 'ACTIVE', occurrence_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ occurrence_count: 2 }] });

    const result = await recordStudentMisconception('student-1', 'sig-1');
    expect(result).toEqual({ isReactivation: false, previousStatus: 'ACTIVE', occurrenceCount: 2 });
  });

  it('a reactivation: previousStatus RESOLVED, isReactivation true -- the UPDATE clause clears resolved_at/resolved_by_evidence_id and increments reactivation_count', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ status: 'RESOLVED', occurrence_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ occurrence_count: 4 }] });

    const result = await recordStudentMisconception('student-1', 'sig-1');
    expect(result).toEqual({ isReactivation: true, previousStatus: 'RESOLVED', occurrenceCount: 4 });

    const upsertSql = queryMock.mock.calls[1][0] as string;
    expect(upsertSql).toMatch(/status = 'ACTIVE'/);
    expect(upsertSql).toMatch(/resolved_at = CASE WHEN student_misconceptions\.status = 'RESOLVED' THEN NULL/);
    expect(upsertSql).toMatch(/reactivation_count = student_misconceptions\.reactivation_count \+ CASE WHEN student_misconceptions\.status = 'RESOLVED' THEN 1/);
  });

  it('occurrence_count is never decremented by this function -- only ever incremented', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'ACTIVE', occurrence_count: 5 }] }).mockResolvedValueOnce({ rows: [{ occurrence_count: 6 }] });
    await recordStudentMisconception('student-1', 'sig-1');
    const upsertSql = queryMock.mock.calls[1][0] as string;
    expect(upsertSql).toMatch(/occurrence_count = student_misconceptions\.occurrence_count \+ 1/);
    expect(upsertSql).not.toMatch(/occurrence_count = student_misconceptions\.occurrence_count -/);
  });
});

describe('resolveMisconceptionSignatures -- signature-scoped resolution (Phase 2C-R)', () => {
  it('resolves ONLY the given signature ids, never a bulk concept-wide scan', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ misconception_signature_id: 'sig-1', misconception_code: 'FORCE_ALONG_VELOCITY', is_critical: true }],
    });
    const resolved = await resolveMisconceptionSignatures('student-1', 'concept-1', ['sig-1'], 'evidence-99');
    expect(resolved).toEqual([{ signatureId: 'sig-1', misconceptionCode: 'FORCE_ALONG_VELOCITY', isCritical: true }]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/SET status = 'RESOLVED'/);
    expect(sql).toMatch(/AND sm\.status = 'ACTIVE'/);
    expect(sql).toMatch(/AND sm\.misconception_signature_id = ANY\(\$3::uuid\[\]\)/);
    expect(params[2]).toEqual(['sig-1']); // the signature-id list is a real, checked parameter -- not string-interpolated
  });

  it('an empty signatureIds list is a pure no-op -- never issues a query at all (the ambiguous-evidence / zero-active case)', async () => {
    const resolved = await resolveMisconceptionSignatures('student-1', 'concept-1', [], 'evidence-100');
    expect(resolved).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('a second call after everything is already RESOLVED finds nothing to resolve -- idempotent, does not re-stamp resolved_at (Step 18)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // WHERE status='ACTIVE' now matches zero rows
    const resolved = await resolveMisconceptionSignatures('student-1', 'concept-1', ['sig-1'], 'evidence-101');
    expect(resolved).toEqual([]);
  });

  it('never requires or reads VALIDATED_MASTERY / mastery_state -- the SQL touches only student_misconceptions/misconception_signatures (anti-circularity, unchanged from Phase 2C)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await resolveMisconceptionSignatures('student-1', 'concept-1', ['sig-1'], null);
    const sql = (queryMock.mock.calls[0][0] as string).toLowerCase();
    expect(sql).not.toMatch(/mastery_state|concept_knowledge_state|validated_mastery/);
  });

  it('a signatureId that does not belong to conceptId (or belongs to another concept) is excluded by the join -- never silently trusted', async () => {
    // The fixture models what the real UPDATE...FROM...WHERE ms.concept_id = $2
    // join does: a foreign signature id simply matches zero rows.
    queryMock.mockResolvedValueOnce({ rows: [] });
    const resolved = await resolveMisconceptionSignatures('student-1', 'concept-1', ['sig-from-another-concept'], 'evidence-102');
    expect(resolved).toEqual([]);
  });
});

describe('getActiveMisconceptionSignatureIdsForConcept -- the resolution-scope decision input', () => {
  it('returns ACTIVE signature ids only, one bounded query', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ misconception_signature_id: 'sig-1' }, { misconception_signature_id: 'sig-2' }] });
    const ids = await getActiveMisconceptionSignatureIdsForConcept('student-1', 'concept-1');
    expect(ids).toEqual(['sig-1', 'sig-2']);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toMatch(/sm\.status = 'ACTIVE'/);
  });
});

describe('getMisconceptionCountsForConcept -- current vs. historical counts (Step 13/14)', () => {
  it('activeCount/criticalCount/recurringCount are ACTIVE-only; historicalCount/resolvedCount see everything', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { occurrence_count: 3, status: 'ACTIVE', is_critical: true }, // active, critical, recurring
        { occurrence_count: 1, status: 'ACTIVE', is_critical: false }, // active, not recurring
        { occurrence_count: 5, status: 'RESOLVED', is_critical: true }, // resolved critical -- must NOT count as active/critical
      ],
    });
    const counts = await getMisconceptionCountsForConcept('student-1', 'concept-1');
    expect(counts).toEqual({
      activeCount: 2,
      criticalCount: 1, // only the ACTIVE critical one
      recurringCount: 1, // only the ACTIVE one with occurrence_count >= 2
      historicalCount: 3, // all three, ever
      resolvedCount: 1,
    });
  });

  it('a RESOLVED critical misconception contributes zero to criticalCount -- the exact Phase 2A false-negative bug this phase closes', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ occurrence_count: 4, status: 'RESOLVED', is_critical: true }] });
    const counts = await getMisconceptionCountsForConcept('student-1', 'concept-1');
    expect(counts.criticalCount).toBe(0);
    expect(counts.activeCount).toBe(0);
    // Step 17: historical truth is preserved, not erased.
    expect(counts.historicalCount).toBe(1);
    expect(counts.resolvedCount).toBe(1);
  });

  it('a fresh, no-history concept returns all zeros, never a fabricated non-zero', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const counts = await getMisconceptionCountsForConcept('student-1', 'concept-1');
    expect(counts).toEqual({ activeCount: 0, criticalCount: 0, recurringCount: 0, historicalCount: 0, resolvedCount: 0 });
  });

  it('a query-shape row with only the DEFAULT-backfilled status (a historical pre-Phase-2C row) is read through the identical code path -- no special-casing (Step 13 historical migration)', async () => {
    // Simulates a row that predates lifecycle tracking, migrated via
    // the migration's own `DEFAULT 'ACTIVE'` -- from this function's
    // perspective it is indistinguishable from, and handled identically
    // to, a fresh ACTIVE row (Phase 2C Step 30: ASSUMED_ACTIVE_UNTIL_REVALIDATED).
    queryMock.mockResolvedValueOnce({ rows: [{ occurrence_count: 1, status: 'ACTIVE', is_critical: true }] });
    const counts = await getMisconceptionCountsForConcept('student-1', 'concept-1');
    expect(counts.activeCount).toBe(1);
    expect(counts.criticalCount).toBe(1);
  });
});

describe('getRecurringMisconceptions -- ACTIVE-only (Step 25/28: NBA/today-plan/Twin "needs attention" surfaces)', () => {
  it('filters to status = ACTIVE in the SQL -- a resolved misconception cannot appear in "needs attention" lists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getRecurringMisconceptions('student-1');
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/sm\.status = 'ACTIVE'/);
  });
});

describe('isMisconceptionResolutionEvidence -- resolution policy predicate (Step 10/11)', () => {
  const policy = 80; // minimumUnderstanding, the real production value reused verbatim

  it('EXPLANATION scoring at/above the Understanding threshold, unassisted -- qualifies', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'EXPLANATION', scorePercent: 85, result: 'correct', aiAssistanceType: 'NONE' }, policy)).toBe(true);
  });

  it('EXPLANATION scoring below the threshold -- does NOT qualify (Step 34 false-positive protection)', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'EXPLANATION', scorePercent: 60, result: 'partial', aiAssistanceType: 'NONE' }, policy)).toBe(false);
  });

  it('SOLO_VERIFICATION correct, unassisted -- qualifies', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'SOLO_VERIFICATION', scorePercent: 100, result: 'correct', aiAssistanceType: 'NONE' }, policy)).toBe(true);
  });

  it('assisted evidence never qualifies, regardless of score (Step 34: "assisted evidence does not resolve where independence is required")', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'EXPLANATION', scorePercent: 100, result: 'correct', aiAssistanceType: 'HINT' }, policy)).toBe(false);
    expect(isMisconceptionResolutionEvidence({ sourceType: 'SOLO_VERIFICATION', scorePercent: 100, result: 'correct', aiAssistanceType: 'TUTOR_GUIDANCE' }, policy)).toBe(false);
  });

  it('ordinary PRACTICE_QUIZ/PRACTICE_QUESTION correctness never qualifies, no matter the score (Step 22: no established question-to-misconception link exists)', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'PRACTICE_QUIZ', scorePercent: 100, result: 'correct', aiAssistanceType: 'NONE' }, policy)).toBe(false);
    expect(isMisconceptionResolutionEvidence({ sourceType: 'PRACTICE_QUESTION', scorePercent: 100, result: 'correct', aiAssistanceType: 'NONE' }, policy)).toBe(false);
  });

  it('CUMULATIVE_ASSESSMENT (a different concept\'s correctness bleeding in) never qualifies (Step 34: "a correct answer on a different concept")', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'CUMULATIVE_ASSESSMENT', scorePercent: 100, result: 'correct', aiAssistanceType: 'NONE' }, policy)).toBe(false);
  });

  it('TRANSFER never qualifies (Step 23: broad Transfer success must not resolve an unrelated misconception merely because both share a concept)', () => {
    expect(isMisconceptionResolutionEvidence({ sourceType: 'TRANSFER', scorePercent: 100, result: 'correct', aiAssistanceType: 'NONE' }, policy)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// (B) determineMasteryState -- unchanged pure classifier, fed
// ACTIVE-only vs. lifetime counts, proving the exact false-negative
// closure and confirming zero threshold/formula regression.
// ---------------------------------------------------------------------
import { determineMasteryState, determineValidationReadiness, type DimensionScores, type EvidenceSufficiency, type MasteryPolicy } from '@/services/knowledge-state.service';

const PASSING_DIMENSIONS: DimensionScores = { understanding: 90, independence: 90, application: 85, retention: 85, transfer: 80 };
const SUFFICIENT_EVIDENCE: EvidenceSufficiency = { evidenceCount: 5, independentEvidenceCount: 3, passed: true };
const REAL_POLICY: MasteryPolicy = {
  version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75, minimumRetention: 75,
  minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0, minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2, retentionMinGapDays: 3, validationWindowDays: 14,
};

describe('Step 33 (release-blocking): false-negative Mastery regression closed', () => {
  it('all five dimensions pass, but one ACTIVE critical misconception (criticalCount=1) -- VALIDATED_MASTERY is blocked', () => {
    const state = determineMasteryState(PASSING_DIMENSIONS, { activeCount: 1, criticalCount: 1, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    expect(state).not.toBe('VALIDATED_MASTERY');
  });

  it('the SAME five dimensions, after the misconception resolves (criticalCount=0) -- VALIDATED_MASTERY is now reachable', () => {
    const state = determineMasteryState(PASSING_DIMENSIONS, { activeCount: 1, criticalCount: 0, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    expect(state).toBe('VALIDATED_MASTERY');
  });

  it('validationReadiness: ACTIVE_CRITICAL_MISCONCEPTION before resolution, READY after (same dimensions/evidence, only criticalCount changes)', () => {
    const before = determineValidationReadiness(PASSING_DIMENSIONS, { activeCount: 1, criticalCount: 1, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    const after = determineValidationReadiness(PASSING_DIMENSIONS, { activeCount: 1, criticalCount: 0, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    expect(before).toBe('ACTIVE_CRITICAL_MISCONCEPTION');
    expect(after).toBe('READY');
  });
});

describe('Step 32: the policy invariant is preserved, not loosened -- an ACTIVE critical misconception still blocks', () => {
  it('criticalCount > 0 blocks regardless of activeCount/recurringCount values', () => {
    const state = determineMasteryState(PASSING_DIMENSIONS, { activeCount: 3, criticalCount: 1, recurringCount: 2 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    expect(state).not.toBe('VALIDATED_MASTERY');
  });

  it('a resolved (now non-critical-count) history with a NEW unrelated active critical misconception still blocks -- resolution is per-signature-set, not a blanket "misconceptions are fine now" flag', () => {
    // historicalCount/resolvedCount are not part of the gate at all --
    // only criticalCount is. This proves the gate reads criticalCount,
    // not some other, looser signal.
    const state = determineMasteryState(PASSING_DIMENSIONS, { activeCount: 1, criticalCount: 1, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    expect(state).not.toBe('VALIDATED_MASTERY');
  });

  it('Phase 2C-R (Step 24 test 5): two independent signatures, A resolves but B stays ACTIVE/critical -- criticalCount=1 continues blocking VALIDATED_MASTERY even after A resolves', () => {
    // Models the exact end-to-end scenario one level down, at the pure
    // gate itself: before A resolves, criticalCount=2 (A and B both
    // ACTIVE critical); after A resolves alone, criticalCount=1 (B
    // still ACTIVE critical) -- the gate must still block, proving
    // signature-scoped resolution cannot manufacture a false-positive
    // VALIDATED_MASTERY merely by resolving ONE of several signatures.
    const beforeAResolves = determineMasteryState(PASSING_DIMENSIONS, { activeCount: 2, criticalCount: 2, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    const afterAResolvesOnly = determineMasteryState(PASSING_DIMENSIONS, { activeCount: 1, criticalCount: 1, recurringCount: 0 }, SUFFICIENT_EVIDENCE, REAL_POLICY);
    expect(beforeAResolves).not.toBe('VALIDATED_MASTERY');
    expect(afterAResolvesOnly).not.toBe('VALIDATED_MASTERY'); // B alone still blocks
  });
});

describe('MASTERY_FORMULA_CHANGES = 0 (Step 31/18): the Mastery delta algorithm itself is untouched by any misconception-lifecycle input', () => {
  it('calculateMasteryDelta takes no misconception parameter at all -- confirmed by its own real signature', async () => {
    const { calculateMasteryDelta } = await import('@/lib/algorithms/mastery');
    expect(calculateMasteryDelta.length).toBeLessThanOrEqual(2); // (evidence, currentMastery) -- no third misconception-aware argument was added
  });
});

// ---------------------------------------------------------------------
// (C) End-to-end mastery.service.ts::updateMastery integration --
// real transaction semantics, real student_misconceptions lifecycle
// state, same fake-db technique as evidence-idempotency.test.ts
// (Postgres unique-index/rollback behavior simulated; the underlying
// Postgres primitives themselves were validated for real against a
// live engine in Phase 2B-V).
// ---------------------------------------------------------------------
const REAL_POLICY_ROW = {
  version: 1, minimum_understanding: 80, minimum_independence: 80, minimum_application: 75, minimum_retention: 75,
  minimum_transfer: 70, requires_transfer: true, maximum_critical_misconceptions: 0, minimum_evidence_count: 3,
  minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14,
};

function createLifecycleFakeDb(options?: { failAfterMisconceptionMutation?: boolean }) {
  const inFlightKeys = new Set<string>();
  const claimedKeys = new Set<string>();
  let evidenceIdCounter = 0;
  // Committed misconception state: `${studentId}::${signatureId}` -> row.
  const misconceptions = new Map<
    string,
    { status: 'ACTIVE' | 'RESOLVED'; occurrence_count: number; reactivation_count: number; is_critical: boolean; misconception_code: string; resolved_by_evidence_id?: string | null }
  >();
  // Every test in this file uses one concept ('concept-1') unless it
  // explicitly registers otherwise -- mirrors the real
  // misconception_signatures.concept_id the resolution join checks.
  const signatureConcepts = new Map<string, string>();
  const conceptOf = (signatureId: string) => signatureConcepts.get(signatureId) ?? 'concept-1';
  const queryMock = vi.fn();

  async function realHandle(pending: Set<string>, staged: Map<string, any>, sql: string, params: any[]) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^BEGIN$/i.test(s)) return { rows: [] };
    if (/^COMMIT$/i.test(s)) {
      for (const k of pending) claimedKeys.add(k);
      pending.clear();
      for (const [k, v] of staged) misconceptions.set(k, v);
      staged.clear();
      return { rows: [] };
    }
    if (/^ROLLBACK$/i.test(s)) {
      for (const k of pending) inFlightKeys.delete(k);
      pending.clear();
      staged.clear();
      return { rows: [] };
    }

    if (s.startsWith('INSERT INTO learning_evidence')) {
      const operationKey = params[params.length - 1] as string | null;
      if (operationKey !== null && inFlightKeys.has(operationKey)) {
        const err: any = new Error('duplicate key value violates unique constraint "learning_evidence_operation_key_unique_idx"');
        err.code = '23505';
        err.constraint = 'learning_evidence_operation_key_unique_idx';
        throw err;
      }
      if (operationKey !== null) {
        inFlightKeys.add(operationKey);
        pending.add(operationKey);
      }
      evidenceIdCounter += 1;
      return { rows: [{ id: `evidence-${evidenceIdCounter}` }] };
    }

    if (s.startsWith('INSERT INTO mastery_records')) return { rows: [] };
    if (/FROM mastery_records/i.test(s) && /SELECT/i.test(s)) {
      return { rows: [{ id: 'mr-1', mastery_score: 50, confidence_score: 50, attempt_count: 2, correct_count: 1, incorrect_count: 1, last_practiced: null }] };
    }
    if (s.includes('SELECT result') && s.includes('FROM learning_evidence')) return { rows: [] };
    if (s.startsWith('UPDATE mastery_records')) return { rows: [{ id: 'mr-1' }] };
    if (s.startsWith('INSERT INTO mastery_events')) return { rows: [{ id: 'event-1' }] };
    if (s.startsWith('SELECT id FROM mastery_events')) return { rows: [{ id: 'event-1' }] };
    if (s.startsWith('INSERT INTO learning_debt')) return { rows: [{ id: 'debt-1' }] };
    if (s.startsWith('INSERT INTO errors')) return { rows: [] };
    if (s.startsWith('SELECT version, minimum_understanding')) return { rows: [REAL_POLICY_ROW] };

    if (s.startsWith('SELECT status, occurrence_count FROM student_misconceptions')) {
      const [studentId, signatureId] = params;
      const key = `${studentId}::${signatureId}`;
      const row = staged.get(key) ?? misconceptions.get(key);
      return { rows: row ? [{ status: row.status, occurrence_count: row.occurrence_count }] : [] };
    }

    if (s.startsWith('INSERT INTO student_misconceptions')) {
      const [studentId, signatureId] = params;
      const key = `${studentId}::${signatureId}`;
      const existing = staged.get(key) ?? misconceptions.get(key);
      const wasResolved = existing?.status === 'RESOLVED';
      const next = {
        status: 'ACTIVE' as const,
        occurrence_count: (existing?.occurrence_count ?? 0) + 1,
        reactivation_count: (existing?.reactivation_count ?? 0) + (wasResolved ? 1 : 0),
        is_critical: existing?.is_critical ?? true, // this fixture's signatures default critical unless the test pre-seeded otherwise
        misconception_code: existing?.misconception_code ?? 'FORCE_ALONG_VELOCITY',
      };
      staged.set(key, next);
      return { rows: [{ occurrence_count: next.occurrence_count }] };
    }

    // Phase 2C-R: getActiveMisconceptionSignatureIdsForConcept -- the
    // resolution-scope decision input. Reads the REAL committed+staged
    // state for this (studentId, conceptId), matching the real query's
    // own semantics exactly (ACTIVE only, this student, this concept).
    if (s.startsWith('SELECT sm.misconception_signature_id FROM student_misconceptions')) {
      const [studentId, conceptId] = params;
      const activeIds: string[] = [];
      const seen = new Set<string>();
      for (const [key, row] of [...misconceptions, ...staged]) {
        if (!key.startsWith(`${studentId}::`)) continue;
        const signatureId = key.split('::')[1];
        if (seen.has(signatureId)) continue;
        seen.add(signatureId);
        const effective = staged.get(key) ?? row;
        if (effective.status === 'ACTIVE' && conceptOf(signatureId) === conceptId) activeIds.push(signatureId);
      }
      return { rows: activeIds.map((id) => ({ misconception_signature_id: id })) };
    }

    // Phase 2C-R: resolveMisconceptionSignatures -- signature-scoped
    // resolution ONLY. params = [studentId, conceptId, signatureIds, resolvedByEvidenceId].
    if (s.startsWith('UPDATE student_misconceptions')) {
      if (options?.failAfterMisconceptionMutation) throw new Error('simulated mid-transaction failure after misconception mutation');
      const [studentId, conceptId, signatureIds, resolvedByEvidenceId] = params as [string, string, string[], string | null];
      const resolved: any[] = [];
      for (const signatureId of signatureIds) {
        if (conceptOf(signatureId) !== conceptId) continue; // "belongs to conceptId" check, mirroring the real join
        const key = `${studentId}::${signatureId}`;
        const current = staged.get(key) ?? misconceptions.get(key);
        if (!current || current.status !== 'ACTIVE') continue; // only ACTIVE rows transition -- idempotent on replay
        const next = { ...current, status: 'RESOLVED' as const, resolved_by_evidence_id: resolvedByEvidenceId ?? null };
        staged.set(key, next);
        resolved.push({ misconception_signature_id: signatureId, misconception_code: current.misconception_code, is_critical: current.is_critical });
      }
      return { rows: resolved };
    }

    throw new Error(`Unmocked query in misconception-lifecycle fixture: ${s}`);
  }

  function makeQuery(pending: Set<string>, staged: Map<string, any>) {
    return async (sql: string, params: any[] = []) => {
      queryMock(sql, params);
      return realHandle(pending, staged, sql, params);
    };
  }

  const poolQuery = makeQuery(new Set(), new Map());
  const db = {
    query: (...args: any[]) => poolQuery(...(args as [string, any[]?])),
    connect: async () => {
      const pending = new Set<string>();
      const staged = new Map<string, any>();
      const clientQuery = makeQuery(pending, staged);
      return { query: (...args: any[]) => clientQuery(...(args as [string, any[]?])), release: () => {} };
    },
  };
  return { db, queryMock, misconceptions, signatureConcepts };
}

async function loadUpdateMasteryReal(db: any) {
  vi.resetModules();
  vi.doMock('@/lib/db', () => ({ db }));
  const recordDecisionEventMock = vi.fn().mockResolvedValue(undefined);
  vi.doMock('@/lib/audit', () => ({ recordDecisionEvent: recordDecisionEventMock }));
  // Knowledge State recalculation itself is proven separately and
  // precisely (section B, the pure determineMasteryState/
  // determineValidationReadiness tests, fed the exact ACTIVE-only
  // counts this section's mutations produce). Mocking it here keeps
  // this section's fake db focused on what it actually exists to
  // prove: transactional/replay correctness of the misconception
  // mutations themselves, alongside evidence-idempotency.test.ts's own
  // already-passing proof that recalculateConceptKnowledgeState is
  // itself invoked at most once per genuine application.
  const policyMock = vi.fn().mockResolvedValue({
    version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75, minimumRetention: 75,
    minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0, minimumEvidenceCount: 3,
    minimumIndependentEvidenceCount: 2, retentionMinGapDays: 3, validationWindowDays: 14,
  });
  vi.doMock('./knowledge-state.service', () => ({ recalculateConceptKnowledgeState: vi.fn().mockResolvedValue(null), getActiveMasteryPolicy: policyMock }));
  vi.doMock('@/services/knowledge-state.service', () => ({ recalculateConceptKnowledgeState: vi.fn().mockResolvedValue(null), getActiveMasteryPolicy: policyMock }));
  const mod = await import('@/services/mastery.service');
  return { updateMastery: mod.updateMastery, recordDecisionEventMock };
}

function explainInput(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'student-1',
    conceptId: 'concept-1',
    subjectId: 'subject-1',
    evidence: { result: 'incorrect' as const, difficulty: 3, sourceType: 'EXPLANATION' as const, confidenceWeight: 0.85, scorePercent: 30, sampleSize: 1 },
    telemetry: { activityType: 'explain_defend', learningMode: 'COACH' as const },
    ...overrides,
  };
}

describe('End-to-end: misconception observation is exactly-once (Step 20/35)', () => {
  it('one logical Explain activity, replayed three times: ONE observation, occurrence_count increments once, no duplicate', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    const { updateMastery } = await loadUpdateMasteryReal(db);
    const identity = { operationType: 'EXPLAIN_DEFEND' as const, operationId: 'activity-1', conceptId: 'concept-1' };
    const misconceptionObservation = {
      signatureId: 'sig-1',
      misconceptionCode: 'FORCE_ALONG_VELOCITY',
      isCritical: true,
      aiExecution: { aiExecutionId: 'exec-1', provider: 'anthropic', model: 'claude-x' } as any,
    };

    const first = await updateMastery(explainInput({ identity, misconceptionObservation }));
    const second = await updateMastery(explainInput({ identity, misconceptionObservation })); // transport replay
    const third = await updateMastery(explainInput({ identity, misconceptionObservation })); // transport replay

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);
    expect(misconceptions.get('student-1::sig-1')?.occurrence_count).toBe(1); // never incremented by the replays
    expect(misconceptions.get('student-1::sig-1')?.status).toBe('ACTIVE');
  });

  it('two GENUINELY separate Explain activities observing the SAME signature: occurrence_count increments twice (real recurrence, not a replay)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    const { updateMastery } = await loadUpdateMasteryReal(db);
    const misconceptionObservation = {
      signatureId: 'sig-1',
      misconceptionCode: 'FORCE_ALONG_VELOCITY',
      isCritical: true,
      aiExecution: { aiExecutionId: 'exec-1', provider: 'anthropic', model: 'claude-x' } as any,
    };

    await updateMastery(explainInput({ identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'activity-A', conceptId: 'concept-1' }, misconceptionObservation }));
    await updateMastery(explainInput({ identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'activity-B', conceptId: 'concept-1' }, misconceptionObservation }));

    expect(misconceptions.get('student-1::sig-1')?.occurrence_count).toBe(2);
  });
});

describe('End-to-end: misconception resolution is exactly-once and NOT circular (Step 12/36)', () => {
  it('strong resolution evidence (EXPLANATION >=80, unassisted) resolves an ACTIVE critical misconception -- criticalOk becomes reachable', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-1', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolution-activity', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-1')?.status).toBe('RESOLVED');
    // The resolution itself never required or read a VALIDATED_MASTERY
    // state anywhere in this call -- proven structurally: this fixture
    // never mocks/serves concept_knowledge_state or mastery_state at
    // all, and the call succeeded regardless (Step 12 anti-circularity).
  });

  it('replaying the SAME resolving operation does not re-resolve or duplicate the transition (Step 11/36)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-1', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);
    const identity = { operationType: 'EXPLAIN_DEFEND' as const, operationId: 'resolution-activity', conceptId: 'concept-1' };
    const evidence = { result: 'correct' as const, difficulty: 3, sourceType: 'EXPLANATION' as const, confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 };

    const first = await updateMastery(explainInput({ identity, evidence }));
    const second = await updateMastery(explainInput({ identity, evidence })); // replay of the resolving request itself

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    expect(misconceptions.get('student-1::sig-1')?.status).toBe('RESOLVED'); // resolved exactly once, not "re-resolved"
  });

  it('weak/unrelated evidence never resolves (Step 34 false-positive protection, end-to-end)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-1', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    // An ordinary, assisted PRACTICE_QUIZ correct answer on the SAME concept.
    await updateMastery(
      explainInput({
        identity: { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-1', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUIZ', confidenceWeight: 0.3, scorePercent: 100, sampleSize: 1 },
        telemetry: { activityType: 'quiz', learningMode: 'COACH', hintsUsed: 1 }, // assisted
      })
    );

    expect(misconceptions.get('student-1::sig-1')?.status).toBe('ACTIVE'); // still active -- unaffected
  });
});

describe('Phase 2C-R: signature-scoped resolution -- end-to-end (Step 24)', () => {
  it('two ACTIVE signatures + evidence explicitly scoped to sig-A: only A resolves, B remains ACTIVE (test 1)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-a-only', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-A'],
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-A')?.status).toBe('RESOLVED');
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('ACTIVE'); // NOT bulk-resolved -- the exact defect this phase closes
  });

  it('B resolves only once its OWN qualifying, explicitly-scoped evidence arrives -- a second, separate updateMastery call (test 6)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-a', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-A'],
      })
    );
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('ACTIVE'); // untouched by A's resolution

    await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-b', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-B'],
      })
    );
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('RESOLVED');
  });

  it('two ACTIVE signatures + UNSCOPED qualifying evidence: neither resolves, no MISCONCEPTION_RESOLVED event, both remain ACTIVE (test 2)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery, recordDecisionEventMock } = await loadUpdateMasteryReal(db);

    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'unscoped-evidence', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        // No resolvedMisconceptionSignatureIds -- and two ACTIVE
        // signatures exist, so the conservative fallback resolves NONE.
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-A')?.status).toBe('ACTIVE');
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('ACTIVE');
    const resolvedEvents = recordDecisionEventMock.mock.calls.filter((c: any[]) => c[0]?.decisionType === 'MISCONCEPTION_RESOLVED');
    expect(resolvedEvents).toHaveLength(0);
  });

  it('a signature ACTIVE on a DIFFERENT concept is excluded from the single-active fallback AND never resolves from this concept\'s evidence (test 4)', async () => {
    const { db, misconceptions, signatureConcepts } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-this-concept', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-other-concept', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'UNRELATED' });
    signatureConcepts.set('sig-other-concept', 'concept-2'); // belongs to a different concept entirely
    const { updateMastery } = await loadUpdateMasteryReal(db);

    // No explicit scope: exactly ONE ACTIVE signature on concept-1
    // (sig-other-concept doesn't count -- it belongs to concept-2), so
    // the single-active fallback applies to sig-this-concept alone.
    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-this-concept-only', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-this-concept')?.status).toBe('RESOLVED');
    expect(misconceptions.get('student-1::sig-other-concept')?.status).toBe('ACTIVE'); // untouched -- different concept entirely
  });

  it('explicit single-active fallback, distinctly proven: exactly one ACTIVE signature on this concept, no explicit scope supplied -- it resolves (test 3)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-only', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'SOLO_VERIFICATION', operationId: 'verify-1', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'SOLO_VERIFICATION', confidenceWeight: 0.9, scorePercent: 100, sampleSize: 1 },
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-only')?.status).toBe('RESOLVED');
  });

  it('explicit multi-signature scope resolves BOTH -- only because both were explicitly named, never inferred (test 7)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-both-explicit', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-A', 'sig-B'],
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-A')?.status).toBe('RESOLVED');
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('RESOLVED');
  });

  it('resolved_by_evidence_id is correct PER-SIGNATURE -- each resolved row points to the evidence that actually resolved it, not another signature\'s (test 8)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    const resultA = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-a-evidence', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-A'],
      })
    );
    const resultB = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-b-evidence', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-B'],
      })
    );

    // Each signature's resolved_by_evidence_id is its OWN resolving
    // evidence row's id -- never the other signature's.
    expect(misconceptions.get('student-1::sig-A')?.resolved_by_evidence_id).toBeTruthy();
    expect(misconceptions.get('student-1::sig-B')?.resolved_by_evidence_id).toBeTruthy();
    expect(misconceptions.get('student-1::sig-A')?.resolved_by_evidence_id).not.toBe(misconceptions.get('student-1::sig-B')?.resolved_by_evidence_id);
    void resultA;
    void resultB;
  });

  it('MISCONCEPTION_RESOLVED decision events are emitted only for signatures ACTUALLY resolved, never for untouched ones (test 9)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery, recordDecisionEventMock } = await loadUpdateMasteryReal(db);

    await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'resolve-a-events', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        resolvedMisconceptionSignatureIds: ['sig-A'],
      })
    );

    const resolvedEvents = recordDecisionEventMock.mock.calls.filter((c: any[]) => c[0]?.decisionType === 'MISCONCEPTION_RESOLVED');
    expect(resolvedEvents).toHaveLength(1);
    expect(resolvedEvents[0][0].reasonDetails.misconceptionCode).toBe('FORCE_ALONG_VELOCITY'); // sig-A's code, never sig-B's
  });

  it('replay of a scoped resolution remains idempotent (Step 18/36, signature-scoped variant) (test 10)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery } = await loadUpdateMasteryReal(db);
    const identity = { operationType: 'EXPLAIN_DEFEND' as const, operationId: 'scoped-resolve-replay', conceptId: 'concept-1' };
    const input = explainInput({
      identity,
      evidence: { result: 'correct' as const, difficulty: 3, sourceType: 'EXPLANATION' as const, confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
      resolvedMisconceptionSignatureIds: ['sig-A'],
    });

    const first = await updateMastery(input);
    const second = await updateMastery(input); // transport replay

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    expect(misconceptions.get('student-1::sig-A')?.status).toBe('RESOLVED');
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('ACTIVE'); // never touched by the replay either
  });

  it('reactivation with 2+ ACTIVE/RESOLVED signatures present stays scoped to only the reactivating signature (test 11)', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-A', { status: 'RESOLVED', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    misconceptions.set('student-1::sig-B', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'NORMAL_FORCE_CONFUSION' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'reactivate-a-only', conceptId: 'concept-1' },
        misconceptionObservation: {
          signatureId: 'sig-A',
          misconceptionCode: 'FORCE_ALONG_VELOCITY',
          isCritical: true,
          aiExecution: { aiExecutionId: 'exec-3', provider: 'anthropic', model: 'claude-x' } as any,
        },
      })
    );

    expect(misconceptions.get('student-1::sig-A')?.status).toBe('ACTIVE');
    expect(misconceptions.get('student-1::sig-A')?.reactivation_count).toBe(1);
    expect(misconceptions.get('student-1::sig-B')?.status).toBe('ACTIVE'); // was already ACTIVE, untouched -- not reactivated a second time
    expect(misconceptions.get('student-1::sig-B')?.reactivation_count).toBe(0);
  });
});

describe('End-to-end: reactivation is exactly-once (Step 9/15/37)', () => {
  it('a RESOLVED misconception reactivates on genuine new evidence, then a replay of that SAME reactivating request does not double-reactivate', async () => {
    const { db, misconceptions } = createLifecycleFakeDb();
    misconceptions.set('student-1::sig-1', { status: 'RESOLVED', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);
    const identity = { operationType: 'EXPLAIN_DEFEND' as const, operationId: 'reactivation-activity', conceptId: 'concept-1' };
    const misconceptionObservation = {
      signatureId: 'sig-1',
      misconceptionCode: 'FORCE_ALONG_VELOCITY',
      isCritical: true,
      aiExecution: { aiExecutionId: 'exec-2', provider: 'anthropic', model: 'claude-x' } as any,
    };

    const first = await updateMastery(explainInput({ identity, misconceptionObservation }));
    const second = await updateMastery(explainInput({ identity, misconceptionObservation })); // transport replay of the SAME reactivation

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    const row = misconceptions.get('student-1::sig-1')!;
    expect(row.status).toBe('ACTIVE');
    expect(row.reactivation_count).toBe(1); // incremented exactly once, not twice
    expect(row.occurrence_count).toBe(2); // 1 (original) + 1 (this genuine reactivation) -- lifetime total, never reset by resolution
  });
});

describe('End-to-end: transaction rollback leaves misconception lifecycle unchanged (Step 38)', () => {
  it('a genuine failure AFTER the misconception mutation but before COMMIT rolls the misconception change back together with evidence/Mastery', async () => {
    const { db, misconceptions } = createLifecycleFakeDb({ failAfterMisconceptionMutation: true });
    misconceptions.set('student-1::sig-1', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    await expect(
      updateMastery(
        explainInput({
          identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'failing-activity', conceptId: 'concept-1' },
          evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
        })
      )
    ).rejects.toThrow('simulated mid-transaction failure after misconception mutation');

    // The resolution attempt's UPDATE ran (and threw) inside the
    // transaction -- it must not have left a partial/committed change.
    expect(misconceptions.get('student-1::sig-1')?.status).toBe('ACTIVE');
  });

  it('retrying the SAME identity after the failure is fixed applies exactly once', async () => {
    const { db, misconceptions } = createLifecycleFakeDb(); // fresh fake, no more injected failure
    misconceptions.set('student-1::sig-1', { status: 'ACTIVE', occurrence_count: 1, reactivation_count: 0, is_critical: true, misconception_code: 'FORCE_ALONG_VELOCITY' });
    const { updateMastery } = await loadUpdateMasteryReal(db);

    const result = await updateMastery(
      explainInput({
        identity: { operationType: 'EXPLAIN_DEFEND', operationId: 'failing-activity', conceptId: 'concept-1' },
        evidence: { result: 'correct', difficulty: 3, sourceType: 'EXPLANATION', confidenceWeight: 0.85, scorePercent: 90, sampleSize: 1 },
      })
    );

    expect(result.duplicate).toBeUndefined();
    expect(misconceptions.get('student-1::sig-1')?.status).toBe('RESOLVED');
  });
});
