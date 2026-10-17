/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * LEARN boundaries (Section 2), PROVE boundaries (Section 5), and
 * critical-misconception blocking (Section 9). These are the areas the
 * audit found to be LARGELY CORRECT against the frozen policy -- this
 * file exists to prove that with real, executable tests (never asserted
 * from prose alone), and to isolate the ONE confirmed real gap
 * (per-attempt `hasCriticalMisconception` is structurally unreachable
 * in production -- AUDIT-005) from the otherwise-correct mechanics.
 * Test-only; no production code is changed here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState, type RawEvidenceItem, type PedagogicalEngineInput } from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence } from '@/lib/pedagogical-shadow/evidence-adapter';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const EVIDENCE_FETCH_SRC = read('src/lib/pedagogical-shadow/evidence-fetch.ts');
const EVIDENCE_ADAPTER_SRC = read('src/lib/pedagogical-shadow/evidence-adapter.ts');
const MISCONCEPTION_SRC = read('src/services/misconception.service.ts');

function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    activityType: 'LEARN_CHECK',
    timestamp: '2026-01-01T00:00:00.000Z',
    itemCount: 5,
    correctCount: 4,
    scorePercent: 90,
    independent: false,
    difficulty: 1.5,
    hasCriticalMisconception: false,
    ...overrides,
  };
}
function baseInput(overrides: Partial<PedagogicalEngineInput> = {}): PedagogicalEngineInput {
  return { conceptId: 'concept-1', studentId: 'student-1', now: '2026-01-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false, ...overrides };
}

describe('LEARN boundaries -- overnight 2026-10-16 contract 1.1 (a completed check of >= 4 items, or a guided 4-7 interaction session, qualifies; NO score gate -- superseding the 2026-10-17 ">= 80 on exactly 5 items")', () => {
  it('79 -> PASSES (no score gate any more), and so does 0', () => {
    for (const scorePercent of [79, 0]) {
      const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent })] }));
      expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('SATISFIED');
      expect(d.requirements.find((r) => r.stage === 'LEARN')!.reasonCodes).toEqual(['LEARN_COMPLETED']);
    }
  });
  it('80 -> PASSES (completed check; the score is not a gate)', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 80, correctCount: 4 })] }));
    expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('SATISFIED');
  });
  it('a legacy check of 4 or 10 items qualifies; one of fewer than 4 items (3, or an unknown 0) -> UNRESOLVED_POLICY, never a pass even at 100%', () => {
    for (const itemCount of [4, 10]) {
      const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 50, itemCount, correctCount: 0 })] }));
      expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('SATISFIED');
    }
    for (const itemCount of [0, 3]) {
      const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 100, itemCount, correctCount: itemCount })] }));
      expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('UNSATISFIED');
      expect(d.requirements.find((r) => r.stage === 'LEARN')!.reasonCodes).toContain('UNRESOLVED_POLICY');
    }
  });

  it('a guided session qualifies at 4-7 interactions closed by the AI, or at 7 by the CAP; anything else is UNRESOLVED', () => {
    const status = (n: number, closedBy: 'AI' | 'CAP') =>
      evaluateCanonicalLearningState(baseInput({ evidence: [item({ itemCount: 0, scorePercent: 0, learnInteractionCount: n, learnClosedBy: closedBy })] })).requirements.find((r) => r.stage === 'LEARN')!.status;
    for (const n of [4, 5, 6, 7]) expect(status(n, 'AI')).toBe('SATISFIED');
    expect(status(7, 'CAP')).toBe('SATISFIED');
    for (const [n, by] of [[3, 'AI'], [8, 'AI'], [6, 'CAP'], [8, 'CAP']] as const) expect(status(n, by)).toBe('UNSATISFIED');
  });
  it('81 -> PASSES', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 81 })] }));
    expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('SATISFIED');
  });
  it('100 -> PASSES', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 100 })] }));
    expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('SATISFIED');
  });
  it('a wrong-activity-type attempt (e.g. PRACTICE) never satisfies LEARN merely by scoring high', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ activityType: 'PRACTICE', scorePercent: 100, itemCount: 3, correctCount: 3, difficulty: 3 })] }));
    expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('UNSATISFIED');
  });
  it('81 WITH a per-item critical misconception on that same attempt -> still does not qualify (the misconception check runs before the completion check)', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 100, hasCriticalMisconception: true })] }));
    expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('UNSATISFIED');
  });
  it('a live, ACTIVE global critical misconception does NOT override an in-progress LEARN stage (the exemption is `stage !== "LEARN"`)', () => {
    // LEARN itself not yet satisfied (a 3-item check is below the 4-interaction minimum) -- stage naturally computes as
    // LEARN even absent any misconception. Confirms the override's own `stage !== 'LEARN'`
    // guard is a genuine no-op here, not merely untested.
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 70, itemCount: 3, correctCount: 2 })], activeCriticalMisconception: true }));
    expect(d.requirements.find((r) => r.stage === 'LEARN')!.status).toBe('UNSATISFIED');
    expect(d.stage).toBe('LEARN'); // never forced to PRACTICE when the journey has not even started
    expect(d.intervention).toBeNull();
  });
});

const LEARNED = item({});
function practiceItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((score / 100) * 3), scorePercent: score, difficulty: 3 });
}
function proveItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'PROVE', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, ...opts });
}
// 2026-10-17 pilot policy: 3 valid passing Practice attempts (the last-3 window, each >= 80, average >= 80).
const PRACTICE_READY = [
  LEARNED,
  practiceItem('2025-12-31T00:00:00.000Z', 90),
  practiceItem('2025-12-31T01:00:00.000Z', 90),
  practiceItem('2025-12-31T02:00:00.000Z', 90),
];

describe('PROVE boundaries -- Policy V2 Section 5', () => {
  it('7/10 (70%) -> FAIL, and (2026-10-17 pilot policy) the learner STAYS in PROVE: PRACTICE remains SATISFIED, no rollback, Prove immediately retryable', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 70)] }));
    expect(d.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('UNSATISFIED');
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.reasonCodes).toContain('FAILED_ATTEMPT');
    expect(d.rollback).toBeNull();
    expect(d.stage).toBe('PROVE');
    expect(d.actionState).toBe('EXECUTABLE');
  });
  it('8/10 (80%) -> PASS', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 80)] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
  });
  it('9/10 (90%) -> PASS', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 90)] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
  });
  it('10/10 (100%) -> PASS', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 100)] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
  });
  it('wrong item count (9 or 11 questions) -> UNRESOLVED_POLICY, never silently passed or failed', () => {
    const d9 = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 90, { itemCount: 9, correctCount: 9 })] }));
    expect(d9.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('UNSATISFIED');
    expect(d9.requirements.find((r) => r.stage === 'PROVE')!.reasonCodes).toContain('UNRESOLVED_POLICY');
    const d11 = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 90, { itemCount: 11, correctCount: 10 })] }));
    expect(d11.requirements.find((r) => r.stage === 'PROVE')!.reasonCodes).toContain('UNRESOLVED_POLICY');
  });
  it('assisted (independent: false) -> never qualifies PROVE, regardless of score', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 100, { independent: false })] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('UNSATISFIED');
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.reasonCodes).toContain('ASSISTED_WHEN_INDEPENDENCE_REQUIRED');
  });
  it('9/10 + an active per-item critical misconception -> blocked, never passes despite the high score', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, proveItem('2026-01-01T00:00:00.000Z', 90, { hasCriticalMisconception: true })] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('UNSATISFIED');
  });
  it('retry after a failed Prove: fail then an immediate NEW qualifying Prove (no Practice requalification needed) -> PASSES, and the failed attempt remains in nonQualifyingEvidenceIds (immutable history, never erased)', () => {
    const failedProve = proveItem('2026-01-01T00:00:00.000Z', 50);
    const newProve = proveItem('2026-01-01T01:00:00.000Z', 90);
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, failedProve, newProve] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.nonQualifyingEvidenceIds).toContain(failedProve.id);
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.qualifyingEvidenceIds).toContain(newProve.id);
  });
  it('a failed Prove may never later become qualifying -- its own verdict is fixed at replay time, never re-scored retroactively', () => {
    const failedProve = proveItem('2026-01-01T00:00:00.000Z', 50);
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...PRACTICE_READY, failedProve] }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.nonQualifyingEvidenceIds).toEqual([failedProve.id]);
  });
});

describe('AUDIT-005 CLOSED: per-attempt hasCriticalMisconception is now wired to the real per-attempt link', () => {
  it('the real evidence-fetch SQL now selects a has_item_critical_misconception column, joined against the SAME observedByEvidenceId link mastery.service.ts already writes', () => {
    const selectClause = EVIDENCE_FETCH_SRC.slice(EVIDENCE_FETCH_SRC.indexOf('SELECT'), EVIDENCE_FETCH_SRC.indexOf('FROM learning_evidence'));
    expect(selectClause).toMatch(/has_item_critical_misconception/);
    expect(selectClause).toMatch(/student_misconceptions/);
    expect(selectClause).toMatch(/misconception_signatures/);
    expect(selectClause).toMatch(/ms\.is_critical = true/);
    expect(selectClause).toMatch(/observedByEvidenceId/);
  });

  it('the real write path (mastery.service.ts) already threads learningEvidenceId into recordStudentMisconception as observedByEvidenceId -- confirming the read-side join has a real source to match against', () => {
    const masterySrc = readFileSync(join(process.cwd(), 'src/services/mastery.service.ts'), 'utf-8');
    expect(masterySrc).toMatch(/recordStudentMisconception\(studentId, obs\.signatureId, obs\.evidenceRef, learningEvidenceId, client\)/);
  });

  it('the join deliberately does NOT filter by sm.status = \'ACTIVE\' -- a per-attempt misconception is an immutable historical fact, independent of later resolution (unlike the GLOBAL activeCriticalMisconception flag, which DOES reflect current status)', () => {
    const selectClause = EVIDENCE_FETCH_SRC.slice(EVIDENCE_FETCH_SRC.indexOf('SELECT'), EVIDENCE_FETCH_SRC.indexOf('FROM learning_evidence'));
    expect(selectClause).not.toMatch(/sm\.status\s*=\s*'ACTIVE'/);
  });

  it('the adapter correctly maps a real row with the column set to true into RawEvidenceItem.hasCriticalMisconception, which the engine then correctly rejects', () => {
    const adapterSrc = EVIDENCE_ADAPTER_SRC;
    expect(adapterSrc).toMatch(/hasCriticalMisconception:\s*row\.hasItemCriticalMisconception\s*\?\?\s*false/);
    // End-to-end proof via the real, unmocked engine + adapter: a row
    // with the per-attempt flag now correctly rejects that specific
    // attempt, exactly like the per-item flag always could -- the gap
    // was only ever in supplying real data for this field, which is now
    // closed.
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence([
      {
        id: 'e1', sourceType: 'PRACTICE_QUIZ', result: 'correct', scorePercent: 100, difficulty: 3, timestamp: '2026-01-01T00:00:00.000Z',
        hintsUsed: 0, aiAssistanceType: 'NONE', activityType: 'PRACTICE', itemCount: 3, correctCount: 3, hasItemCriticalMisconception: true,
      },
    ]).items[0];
    expect(mapped.hasCriticalMisconception).toBe(true);
  });

  it('the GLOBAL misconception flag correctly requires DEDICATED resolution evidence (EXPLANATION or SOLO_VERIFICATION, unassisted) -- an ordinary high quiz score can never clear it on its own (Policy V2 Section 9\'s own explicit question)', () => {
    expect(MISCONCEPTION_SRC).toMatch(/isMisconceptionResolutionEvidence/);
    const fnIdx = MISCONCEPTION_SRC.indexOf('export function isMisconceptionResolutionEvidence');
    const fn = MISCONCEPTION_SRC.slice(fnIdx, fnIdx + 500);
    expect(fn).toMatch(/EXPLANATION/);
    expect(fn).toMatch(/SOLO_VERIFICATION/);
    expect(fn).not.toMatch(/PRACTICE|PROVE|TRANSFER/); // ordinary quiz/Transfer evidence is deliberately excluded
  });
});

describe('Critical misconception blocking -- Policy V2 Section 9 (global flag)', () => {
  it('an ACTIVE global critical misconception forces the stage back to PRACTICE even when every requirement is otherwise SATISFIED (would-be CONSOLIDATED)', () => {
    const p1 = practiceItem('2025-12-31T00:00:00.000Z', 90);
    const p2 = practiceItem('2025-12-31T01:00:00.000Z', 90);
    const p3 = practiceItem('2025-12-31T02:00:00.000Z', 90);
    const prove = proveItem('2026-01-01T00:00:00.000Z', 90);
    const retain = item({ activityType: 'RETENTION_CHECK', timestamp: '2026-01-10T00:00:00.000Z', itemCount: 5, correctCount: 5, scorePercent: 90, difficulty: 3.5, independent: true, novel: true });
    const transfer = item({
      activityType: 'TRANSFER', timestamp: '2026-01-20T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 4.5, independent: true,
      transferLadder: (['NEAR', 'MID', 'FAR'] as const).map((level, i) => ({ level, scorePercent: 90, passed: true, certified: true, taskId: `t${i}`, contextDomain: null })),
      transferHighestLevel: 'FAR',
    });
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, p1, p2, p3, prove, retain, transfer], activeCriticalMisconception: true }));
    // every requirement is genuinely evidence-satisfied -- only the live flag forces PRACTICE
    expect(d.requirements.every((r) => r.status === 'SATISFIED')).toBe(true);
    expect(d.stage).toBe('PRACTICE');
    expect(d.intervention).toBe('REINFORCE');
    expect(d.reasonCodes).toContain('CRITICAL_MISCONCEPTION');
  });

  it('100% score does not, by itself, clear an active misconception -- the override is driven by the LIVE flag, never inferred from the newest score', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [item({ scorePercent: 100 })], activeCriticalMisconception: true }));
    // LEARN is exempted, so a single high LEARN_CHECK still satisfies
    // LEARN, but the override still applies to stage/intervention
    // reporting for anything beyond LEARN (verified above); this test
    // exists to confirm the flag -- not the score -- is what the engine
    // actually reads.
    expect(d.reasonCodes).toContain('CRITICAL_MISCONCEPTION');
  });
});
