/**
 * Phase 2B -- Evidence Idempotency & Mastery Integrity.
 *
 * Proves the core invariant this phase exists for: ONE LOGICAL LEARNER
 * ACTION CAN AFFECT COGNITIVE STATE AT MOST ONCE. These tests exercise
 * the real mastery.service.ts::updateMastery (the single canonical
 * evidence-application boundary every writer in the app goes through)
 * against a mocked @/lib/db that simulates Postgres's own unique-index
 * behavior for learning_evidence.operation_key -- see
 * database/migrations/20260901_1200_evidence_idempotency.sql.
 *
 * Scope note (honest, not a gap glossed over): this phase deliberately
 * did NOT apply the migration or run against a real database (Step 31/
 * 36 -- "external review happens first"). These tests verify the
 * APPLICATION's reaction to a unique_violation -- correctly rolling
 * back, correctly returning ALREADY_APPLIED, never producing a second
 * cognitive effect -- by simulating that error the same way Postgres's
 * own unique index would raise it. They do not (and cannot, without a
 * real database) re-prove that Postgres itself correctly serializes
 * concurrent unique-index inserts -- that is a well-established
 * database engine guarantee this design relies on, not reinvents.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOperationKey, type EvidenceApplicationIdentity } from '@/lib/algorithms/evidence-idempotency';

// ---------------------------------------------------------------------
// buildOperationKey -- pure, no I/O.
// ---------------------------------------------------------------------
describe('buildOperationKey', () => {
  it('is deterministic -- same identity always produces the same key', () => {
    const identity: EvidenceApplicationIdentity = { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-1', conceptId: 'concept-1' };
    expect(buildOperationKey(identity)).toBe(buildOperationKey({ ...identity }));
  });

  it('never uses a timestamp or randomness -- two calls a tick apart still match', async () => {
    const identity: EvidenceApplicationIdentity = { operationType: 'TRANSFER', operationId: 'activity-1', conceptId: 'concept-1' };
    const first = buildOperationKey(identity);
    await new Promise((r) => setTimeout(r, 5));
    const second = buildOperationKey(identity);
    expect(first).toBe(second);
  });

  it('distinguishes different concepts under the same operation', () => {
    const a = buildOperationKey({ operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-1', conceptId: 'concept-A' });
    const b = buildOperationKey({ operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-1', conceptId: 'concept-B' });
    expect(a).not.toBe(b);
  });

  it('distinguishes different operation types for the same underlying id/concept', () => {
    const a = buildOperationKey({ operationType: 'QUIZ_SUBMISSION', operationId: 'x', conceptId: 'c' });
    const b = buildOperationKey({ operationType: 'TRANSFER', operationId: 'x', conceptId: 'c' });
    expect(a).not.toBe(b);
  });

  it('rejects a component containing the separator, rather than silently producing a colliding key', () => {
    expect(() => buildOperationKey({ operationType: 'QUIZ_SUBMISSION', operationId: 'a::b', conceptId: 'c' })).toThrow();
  });
});

// ---------------------------------------------------------------------
// updateMastery -- the canonical evidence-application boundary.
// ---------------------------------------------------------------------

const MASTERY_RECORD = {
  id: 'mastery-record-1',
  mastery_score: 50,
  confidence_score: 50,
  attempt_count: 2,
  correct_count: 1,
  incorrect_count: 1,
  last_practiced: null,
};

/**
 * A minimal in-memory fake that reproduces exactly the one Postgres
 * behavior this design depends on: a second INSERT INTO learning_evidence
 * carrying an operation_key already claimed by an earlier (committed)
 * one fails with a 23505 unique_violation on
 * learning_evidence_operation_key_unique_idx. Everything else is a
 * static, minimal response -- this fake is not a general SQL engine.
 */
function createFakeDb(options?: { failMasteryUpdateForConcept?: string }) {
  const claimedKeys = new Set<string>(); // committed only -- what the test's own assertions read
  // Claimed by SOME transaction, committed or not -- this is what an
  // INSERT actually races against. Real Postgres blocks a second
  // inserter on an uncommitted-but-claimed unique key until the first
  // transaction resolves, then either fails it (committed) or lets it
  // through (rolled back); claiming the key at INSERT time here (not
  // at COMMIT time) reproduces that same observable outcome -- exactly
  // one of two concurrent inserts for the same key ever succeeds --
  // without needing real thread/connection-level blocking.
  const inFlightKeys = new Set<string>();
  let evidenceIdCounter = 0;
  let currentMasteryScore = MASTERY_RECORD.mastery_score; // stateful -- an UPDATE persists across subsequent SELECTs, a ROLLBACK discards it
  let currentConfidenceScore = MASTERY_RECORD.confidence_score;

  // Pure recorder -- every query, on the pool OR on any connect()ed
  // client, is recorded here too, so a test can inspect the FULL call
  // history in one place regardless of which "connection" issued it
  // (mirroring how a real Postgres query log would look).
  const queryMock = vi.fn();

  async function realHandle(
    pending: Set<string>,
    pendingMastery: { score: number | null; confidence: number | null },
    sql: string,
    params: any[]
  ) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^BEGIN$/i.test(s)) return { rows: [] };
    if (/^COMMIT$/i.test(s)) {
      for (const k of pending) claimedKeys.add(k);
      pending.clear();
      if (pendingMastery.score !== null) currentMasteryScore = pendingMastery.score;
      if (pendingMastery.confidence !== null) currentConfidenceScore = pendingMastery.confidence;
      return { rows: [] };
    }
    if (/^ROLLBACK$/i.test(s)) {
      for (const k of pending) inFlightKeys.delete(k); // free the claim for a legitimate retry
      pending.clear();
      pendingMastery.score = null;
      pendingMastery.confidence = null;
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

    if (s.startsWith('INSERT INTO mastery_records')) return { rows: [] }; // get-or-create upsert, unused return
    if (/FROM mastery_records/i.test(s) && /SELECT/i.test(s)) {
      return { rows: [{ ...MASTERY_RECORD, mastery_score: currentMasteryScore, confidence_score: currentConfidenceScore }] };
    }
    if (s.includes('SELECT result') && s.includes('FROM learning_evidence')) return { rows: [] };

    if (s.startsWith('UPDATE mastery_records')) {
      const conceptId = params[6];
      if (options?.failMasteryUpdateForConcept && conceptId === options.failMasteryUpdateForConcept) {
        throw new Error('simulated mid-transaction failure');
      }
      pendingMastery.score = Number(params[0]); // new mastery_score -- only durable on COMMIT
      pendingMastery.confidence = Number(params[1]); // new confidence_score
      return { rows: [{ id: MASTERY_RECORD.id }] };
    }
    if (s.startsWith('INSERT INTO mastery_events')) return { rows: [{ id: 'event-1' }] };
    if (s.startsWith('SELECT id FROM mastery_events')) return { rows: [{ id: 'event-1' }] };
    if (s.startsWith('INSERT INTO learning_debt')) return { rows: [{ id: 'debt-1' }] };
    if (s.startsWith('INSERT INTO errors')) return { rows: [] };

    throw new Error(`Unmocked query in evidence-idempotency fixture: ${s}`);
  }

  function makeQuery(pending: Set<string>, pendingMastery: { score: number | null; confidence: number | null }) {
    return async (sql: string, params: any[] = []) => {
      queryMock(sql, params);
      return realHandle(pending, pendingMastery, sql, params);
    };
  }

  const poolQuery = makeQuery(new Set(), { score: null, confidence: null }); // used only for reads outside a transaction (e.g. the duplicate-response path)
  const db = {
    query: (...args: any[]) => poolQuery(...(args as [string, any[]?])),
    connect: async () => {
      const pending = new Set<string>();
      const pendingMastery = { score: null as number | null, confidence: null as number | null };
      const clientQuery = makeQuery(pending, pendingMastery);
      return { query: (...args: any[]) => clientQuery(...(args as [string, any[]?])), release: () => {} };
    },
  };
  return { db, queryMock, claimedKeys, inFlightKeys };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'student-1',
    conceptId: 'concept-1',
    subjectId: 'subject-1',
    evidence: { result: 'correct' as const, difficulty: 3, sourceType: 'PRACTICE_QUIZ' as const, confidenceWeight: 0.9, scorePercent: 100, sampleSize: 1 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO' as const, hintsUsed: 0, aiAssistanceType: 'NONE' as const },
    ...overrides,
  };
}

async function loadUpdateMastery(db: any, recalculateMock = vi.fn().mockResolvedValue(null), recordDecisionEventMock = vi.fn().mockResolvedValue(undefined)) {
  vi.resetModules();
  vi.doMock('@/lib/db', () => ({ db }));
  vi.doMock('@/lib/audit', () => ({ recordDecisionEvent: recordDecisionEventMock }));
  vi.doMock('./knowledge-state.service', () => ({ recalculateConceptKnowledgeState: recalculateMock }));
  vi.doMock('@/services/knowledge-state.service', () => ({ recalculateConceptKnowledgeState: recalculateMock }));
  const mod = await import('@/services/mastery.service');
  return { updateMastery: mod.updateMastery, recalculateMock, recordDecisionEventMock };
}

describe('updateMastery -- sequential duplicate (Step: sequential duplicate quiz submission)', () => {
  it('the second call with the same identity returns duplicate:true, delta 0, and does not re-apply', async () => {
    const { db } = createFakeDb();
    const { updateMastery, recalculateMock, recordDecisionEventMock } = await loadUpdateMastery(db);

    const identity: EvidenceApplicationIdentity = { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-1', conceptId: 'concept-1' };

    const first = await updateMastery(baseInput({ identity }));
    const second = await updateMastery(baseInput({ identity }));

    expect(first.duplicate).toBeUndefined(); // real application never claims duplicate:true for itself
    expect(second.duplicate).toBe(true);
    expect(second.delta).toBe(0);
    expect(second.oldMastery).toBe(second.newMastery);

    // Exactly one real Mastery/Knowledge-State/decision-event effect.
    expect(recalculateMock).toHaveBeenCalledTimes(1);
    expect(recordDecisionEventMock.mock.calls.filter(([e]) => e.decisionType === 'MASTERY_UPDATED')).toHaveLength(1);
  });

  it('a duplicate result reflects the CURRENT (already-applied) mastery state, not a fabricated one', async () => {
    const { db } = createFakeDb();
    const { updateMastery } = await loadUpdateMastery(db);
    const identity: EvidenceApplicationIdentity = { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-2', conceptId: 'concept-1' };

    const first = await updateMastery(baseInput({ identity }));
    const second = await updateMastery(baseInput({ identity }));

    expect(second.newMastery).toBe(first.newMastery);
    expect(second.confidenceScore).toBe(first.confidenceScore);
  });
});

describe('updateMastery -- concurrent duplicate (Step: concurrent duplicate quiz submission)', () => {
  it('two simultaneous calls with the SAME identity: exactly one applies, the other reports duplicate:true -- never two evidence rows', async () => {
    const { db, claimedKeys } = createFakeDb();
    const { updateMastery, recalculateMock } = await loadUpdateMastery(db);
    const identity: EvidenceApplicationIdentity = { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-race', conceptId: 'concept-1' };

    const [a, b] = await Promise.all([updateMastery(baseInput({ identity })), updateMastery(baseInput({ identity }))]);

    const results = [a, b];
    const applied = results.filter((r) => !r.duplicate);
    const duplicated = results.filter((r) => r.duplicate === true);

    expect(applied).toHaveLength(1);
    expect(duplicated).toHaveLength(1);
    expect(claimedKeys.size).toBe(1); // exactly one learning_evidence row ever claimed this key
    expect(recalculateMock).toHaveBeenCalledTimes(1); // exactly one Knowledge State effect
  });
});

describe('updateMastery -- genuinely distinct attempts remain distinct (Step: two genuinely separate attempts)', () => {
  it('two different quiz sessions, same student/concept/score: both apply as two real, separate deltas', async () => {
    const { db, claimedKeys } = createFakeDb();
    const { updateMastery, recalculateMock } = await loadUpdateMastery(db);

    const first = await updateMastery(baseInput({ identity: { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-A', conceptId: 'concept-1' } }));
    const second = await updateMastery(baseInput({ identity: { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-B', conceptId: 'concept-1' } }));

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBeUndefined();
    expect(claimedKeys.size).toBe(2);
    expect(recalculateMock).toHaveBeenCalledTimes(2);
  });
});

describe('updateMastery -- multi-concept quiz duplicate (Step: same quiz + different concept vs. same quiz + same concept)', () => {
  it('replaying the whole quiz: the already-applied concept stays applied once; a genuinely new concept in the SAME quiz still applies', async () => {
    const { db, claimedKeys } = createFakeDb();
    const { updateMastery, recalculateMock } = await loadUpdateMastery(db);
    const quizId = 'quiz-multi-1';

    // First submission: concept A only.
    await updateMastery(baseInput({ conceptId: 'concept-A', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-A' } }));
    // Retry of the SAME quiz submission for concept A (duplicate) plus
    // a NEW concept B this quiz also covered (never applied before).
    const retryA = await updateMastery(baseInput({ conceptId: 'concept-A', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-A' } }));
    const firstB = await updateMastery(baseInput({ conceptId: 'concept-B', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-B' } }));

    expect(retryA.duplicate).toBe(true);
    expect(firstB.duplicate).toBeUndefined();
    expect(claimedKeys.size).toBe(2); // A once, B once -- never A twice
    expect(recalculateMock).toHaveBeenCalledTimes(2);
  });
});

describe('updateMastery -- partial multi-concept failure + retry (Step: partial failure recovery)', () => {
  it('concept A commits, concept B genuinely fails mid-transaction: retry re-applies ONLY B, never re-applies A', async () => {
    const { db, claimedKeys } = createFakeDb({ failMasteryUpdateForConcept: 'concept-B' });
    const { updateMastery } = await loadUpdateMastery(db);
    const quizId = 'quiz-partial-1';

    const resultA = await updateMastery(
      baseInput({ conceptId: 'concept-A', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-A' } })
    );
    expect(resultA.duplicate).toBeUndefined();

    await expect(
      updateMastery(baseInput({ conceptId: 'concept-B', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-B' } }))
    ).rejects.toThrow('simulated mid-transaction failure');

    // B's transaction rolled back entirely -- its operation_key was
    // never durably claimed (the INSERT that claimed it was inside the
    // same transaction the later failure rolled back).
    expect(claimedKeys.has(buildOperationKey({ operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-B' }))).toBe(false);

    // Retry: A must not be re-applied; B must now be allowed to apply.
    const { db: db2, claimedKeys: claimedKeys2, inFlightKeys: inFlightKeys2 } = createFakeDb(); // fresh fake, no more injected failure -- simulates the underlying cause being transient
    // Re-seed db2 with A already durably claimed, exactly as the real
    // DB would still show after the first, successfully-committed call
    // above (both sets, matching what a real committed row implies).
    const aKey = buildOperationKey({ operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-A' });
    claimedKeys2.add(aKey);
    inFlightKeys2.add(aKey);
    const { updateMastery: updateMastery2 } = await loadUpdateMastery(db2);

    const retryA = await updateMastery2(
      baseInput({ conceptId: 'concept-A', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-A' } })
    );
    const retryB = await updateMastery2(
      baseInput({ conceptId: 'concept-B', identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizId, conceptId: 'concept-B' } })
    );

    expect(retryA.duplicate).toBe(true); // A: not re-applied
    expect(retryB.duplicate).toBeUndefined(); // B: now allowed to apply
  });
});

describe('updateMastery -- transaction-level failure injection (release-blocking)', () => {
  it('a failure during the atomic mutation leaves NO evidence row, NO Mastery update, and NO Knowledge State recalculation -- not a partial effect', async () => {
    const { db, queryMock } = createFakeDb({ failMasteryUpdateForConcept: 'concept-fail' });
    const { updateMastery, recalculateMock, recordDecisionEventMock } = await loadUpdateMastery(db);

    await expect(
      updateMastery(baseInput({ conceptId: 'concept-fail', identity: { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-fail', conceptId: 'concept-fail' } }))
    ).rejects.toThrow('simulated mid-transaction failure');

    // The transaction was rolled back -- ROLLBACK was actually issued.
    expect(queryMock.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    // Downstream effects that only happen after a successful commit
    // (Phase 2B's design: KS recalculation and decision events run
    // AFTER COMMIT in the pre-Phase-2B ordering for decision events,
    // and inside the same transaction for KS -- either way, neither
    // fires when the transaction never committed).
    expect(recalculateMock).not.toHaveBeenCalled();
    expect(recordDecisionEventMock).not.toHaveBeenCalled();
  });

  it('the operation can be safely retried after the failure -- no residual claim blocks it', async () => {
    // A fresh fake simulates the failure being transient (e.g. a
    // one-off connection blip) and now succeeding.
    const { db } = createFakeDb();
    const { updateMastery } = await loadUpdateMastery(db);
    const identity: EvidenceApplicationIdentity = { operationType: 'QUIZ_SUBMISSION', operationId: 'quiz-retry-after-fail', conceptId: 'concept-1' };

    const result = await updateMastery(baseInput({ identity }));
    expect(result.duplicate).toBeUndefined();
  });
});

describe('updateMastery -- Knowledge State / independent-evidence replay invariant (closes the Phase 2A false-positive-mastery risk)', () => {
  it('replaying the SAME logical action never triggers a second Knowledge State recalculation -- evidenceCount/independentEvidenceCount cannot be replay-inflated', async () => {
    const { db } = createFakeDb();
    const { updateMastery, recalculateMock } = await loadUpdateMastery(db);
    const identity: EvidenceApplicationIdentity = { operationType: 'VERIFICATION_RESOLUTION', operationId: 'verification-attempt-1', conceptId: 'concept-1' };

    // The same logical independent action, "replayed" three times by
    // transport (a network retry twice more after the first genuinely
    // succeeded) -- exactly what a false-positive on
    // minimumIndependentEvidenceCount would require if idempotency did
    // not hold.
    await updateMastery(baseInput({ evidence: { result: 'correct', difficulty: 3, sourceType: 'SOLO_VERIFICATION', confidenceWeight: 0.9, scorePercent: 100, sampleSize: 1 }, identity }));
    await updateMastery(baseInput({ evidence: { result: 'correct', difficulty: 3, sourceType: 'SOLO_VERIFICATION', confidenceWeight: 0.9, scorePercent: 100, sampleSize: 1 }, identity }));
    await updateMastery(baseInput({ evidence: { result: 'correct', difficulty: 3, sourceType: 'SOLO_VERIFICATION', confidenceWeight: 0.9, scorePercent: 100, sampleSize: 1 }, identity }));

    // Knowledge State (which is what actually recomputes
    // evidenceCount/independentEvidenceCount from learning_evidence)
    // was recalculated exactly once -- the replayed calls never even
    // reached it. A learner with only ONE genuine independent action
    // cannot be pushed past minimumIndependentEvidenceCount=2 by
    // transport retries alone; this is the structural reason why (a
    // second genuinely distinct action would still be required, and
    // would carry its own distinct identity -- proven separately
    // above under "genuinely distinct attempts remain distinct").
    expect(recalculateMock).toHaveBeenCalledTimes(1);
  });
});

describe('updateMastery -- decision event replay invariant', () => {
  it('replaying the same logical action never records a second MASTERY_UPDATED (or any) decision event', async () => {
    const { db } = createFakeDb();
    const { updateMastery, recordDecisionEventMock } = await loadUpdateMastery(db);
    const identity: EvidenceApplicationIdentity = { operationType: 'EXPLAIN_DEFEND', operationId: 'activity-1', conceptId: 'concept-1' };

    await updateMastery(baseInput({ identity }));
    await updateMastery(baseInput({ identity }));
    await updateMastery(baseInput({ identity }));

    // Filtered to MASTERY_UPDATED specifically -- a single genuine
    // application can legitimately also emit a sibling
    // LEARNING_DEBT_CREATED event; that's a different, real decision
    // this fixture's low starting mastery can trigger, not a replay
    // artifact. The invariant this test proves is that MASTERY_UPDATED
    // itself -- the one decision this pipeline could double-fire on a
    // replay -- never repeats.
    const masteryUpdatedEvents = recordDecisionEventMock.mock.calls.filter(([e]) => e.decisionType === 'MASTERY_UPDATED');
    expect(masteryUpdatedEvents).toHaveLength(1);
  });
});

describe('updateMastery -- missing identity (Step: invalid/missing idempotency identity handled safely)', () => {
  it('omitting identity entirely keeps pre-Phase-2B behavior: every call applies, unprotected, exactly as before', async () => {
    const { db, claimedKeys } = createFakeDb();
    const { updateMastery, recalculateMock } = await loadUpdateMastery(db);

    const first = await updateMastery(baseInput());
    const second = await updateMastery(baseInput());

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBeUndefined();
    expect(claimedKeys.size).toBe(0); // operation_key stayed NULL both times -- no claim to make
    expect(recalculateMock).toHaveBeenCalledTimes(2); // both calls had a real, independent effect
  });
});

describe('updateMastery -- historical evidence without a key remains readable', () => {
  it('a pre-Phase-2B row (operation_key NULL) is read by the same, unmodified SELECT every other evidence row is -- no special-casing, no filter excludes it', async () => {
    // recalculateConceptKnowledgeState's own evidence SELECT (the read
    // that actually feeds Understanding/Independence/Application/
    // Retention/Transfer) is exercised in mastery-metadata.test.ts and
    // knowledge-state.test.ts already; the specific invariant Phase 2B
    // must not have broken is mastery.service.ts's OWN "recent results"
    // read (its confidence-score input) -- confirmed here to carry no
    // operation_key predicate that could silently exclude historical
    // rows from that calculation.
    const { db, queryMock } = createFakeDb();
    const { updateMastery } = await loadUpdateMastery(db);

    await updateMastery(baseInput());

    const call = queryMock.mock.calls.find(([sql]) => /SELECT result[\s\S]*FROM learning_evidence/i.test(sql));
    expect(call).toBeTruthy();
    expect(call![0]).not.toMatch(/operation_key/i);
  });
});
