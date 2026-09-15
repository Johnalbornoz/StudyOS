/**
 * CANON-R3 -- PEDAGOGICAL ENGINE SHADOW INTEGRATION: the required test
 * matrix (Parts 38-42 of the spec, 44 tests). Every test exercises the
 * REAL, unmocked adapter/comparator/snapshot code
 * (`src/lib/pedagogical-shadow/`) with synthetic fixtures -- no live DB
 * (none is available in this environment; see the CANON-R3 report's
 * STATUS section), no AI, no React, no Next.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  mapStudyUSEvidenceToPedagogicalEvidence,
  normalizeScorePercent,
  buildOldCanonicalSnapshot,
  buildNewCanonicalSnapshot,
  compareCanonicalDecisions,
  buildShadowComparisonRecord,
  type StudyUSEvidenceRow,
} from '@/lib/pedagogical-shadow';
// The shadow barrel deliberately does not re-export pure-engine
// internals (see MODULE DEPENDENCY RULES) -- the ENGINE FROZEN tests
// below import the policy/engine directly instead.
import { CANONICAL_POLICY as ENGINE_POLICY, POLICY_VERSION as ENGINE_POLICY_VERSION, evaluateCanonicalLearningState as engineEvaluate } from '@/lib/pedagogical-engine';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SHADOW_DIR = 'src/lib/pedagogical-shadow';
const SHADOW_FILES = readdirSync(join(process.cwd(), SHADOW_DIR)).filter((f) => f.endsWith('.ts'));
const CLI_SCRIPT = 'scripts/canon-r3-shadow-compare.ts';

function row(overrides: Partial<StudyUSEvidenceRow>): StudyUSEvidenceRow {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    sourceType: 'PRACTICE_QUIZ',
    result: 'correct',
    scorePercent: 90,
    difficulty: 3,
    timestamp: '2026-01-01T00:00:00.000Z',
    hintsUsed: 0,
    aiAssistanceType: 'NONE',
    activityType: 'PRACTICE',
    ...overrides,
  };
}

describe('CANON-R3 Part 38 -- Evidence Adapter tests (1-17)', () => {
  it('1. score normalization: PERCENT_0_100 passes through unchanged', () => {
    expect(normalizeScorePercent(67, 'PERCENT_0_100')).toBe(67);
  });

  it('1b. score normalization: FRACTION_0_1 converts to a 0-100 percentage', () => {
    expect(normalizeScorePercent(0.8, 'FRACTION_0_1')).toBe(80);
  });

  it('1c. score normalization: RATIO computes correct/total as a percentage', () => {
    expect(normalizeScorePercent(0, 'RATIO', { correct: 8, total: 10 })).toBe(80);
  });

  it('2. assistance mapping: ai_assistance_type other than NONE marks the attempt not independent', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'SOLO_CHECK', aiAssistanceType: 'HINT' })]);
    expect(result.items[0].independent).toBe(false);
  });

  it('3. independent mapping: ai_assistance_type NONE and zero hints marks the attempt independent', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'SOLO_CHECK', aiAssistanceType: 'NONE', hintsUsed: 0 })]);
    expect(result.items[0].independent).toBe(true);
  });

  it('4. difficulty mapping: the administered difficulty is passed through verbatim, never recomputed', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ difficulty: 2 })]);
    expect(result.items[0].difficulty).toBe(2);
  });

  it('5. timestamp mapping: passed through verbatim', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ timestamp: '2026-03-05T10:00:00.000Z' })]);
    expect(result.items[0].timestamp).toBe('2026-03-05T10:00:00.000Z');
  });

  it('6. Practice mapping: activityType PRACTICE maps to PedagogicalActivityType PRACTICE', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'PRACTICE' })]);
    expect(result.items[0].activityType).toBe('PRACTICE');
  });

  it('7. Prove mapping: activityType SOLO_CHECK maps to PedagogicalActivityType PROVE', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'SOLO_CHECK', itemCount: 10, correctCount: 9 })]);
    expect(result.items[0].activityType).toBe('PROVE');
  });

  it('8. Retention mapping: activityType RETENTION_CHECK maps to PedagogicalActivityType RETENTION_CHECK', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'RETENTION_CHECK', itemCount: 10 })]);
    expect(result.items[0].activityType).toBe('RETENTION_CHECK');
  });

  it('9. Transfer mapping: activityType TRANSFER maps to PedagogicalActivityType TRANSFER', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'TRANSFER', scorePercent: 70 })]);
    expect(result.items[0].activityType).toBe('TRANSFER');
  });

  it('10. LEARN_CHECK direct mapping: an explicit LEARN_CHECK row maps directly, when one exists', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'LEARN_CHECK', scorePercent: 90 })]);
    expect(result.items[0].activityType).toBe('LEARN_CHECK');
    expect(result.unresolved.some((u) => u.reason === 'LEARN_CHECK_SOURCE_UNAVAILABLE')).toBe(false);
  });

  it('11. unavailable LEARN_CHECK is not fabricated: with no LEARN_CHECK-equivalent row, the gap is recorded, never inferred from Practice', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'PRACTICE' })]);
    expect(result.items.some((i) => i.activityType === 'LEARN_CHECK')).toBe(false);
    expect(result.unresolved.some((u) => u.reason === 'LEARN_CHECK_SOURCE_UNAVAILABLE')).toBe(true);
  });

  it('12. an old 6-question Prove remains itemCount=6 -- history is never rewritten to fit the new policy', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'SOLO_CHECK', itemCount: 6, correctCount: 6, scorePercent: 100 })]);
    expect(result.items[0].itemCount).toBe(6);
  });

  it('13. an old 6-question Retention remains itemCount=6', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'RETENTION_CHECK', itemCount: 6, correctCount: 6, scorePercent: 100 })]);
    expect(result.items[0].itemCount).toBe(6);
  });

  it('14. Transfer aggregate-only evidence does not fabricate a 3-challenge breakdown', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'TRANSFER', scorePercent: 70 })]);
    expect(result.items[0].perChallengeScores).toBeUndefined();
    expect(result.unresolved.some((u) => u.reason === 'TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE')).toBe(true);
  });

  it('15. unknown independence does not default to true', () => {
    // aiAssistanceType absent entirely from the source data (older row shape) -- must never default to independent.
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'SOLO_CHECK', aiAssistanceType: undefined as unknown as string })]);
    expect(result.items[0].independent).toBe(false);
  });

  it('16. historical misconception on an attempt does not automatically become the CURRENT activeCriticalMisconception fact', () => {
    // hasItemCriticalMisconception describes ONE past attempt; the adapter never derives a "live" flag from it -- that is a separate, caller-supplied fact (Part 11), never computed by this module at all.
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ hasItemCriticalMisconception: true })]);
    expect(result.items[0].hasCriticalMisconception).toBe(true);
    expect('activeCriticalMisconception' in result).toBe(false);
  });

  it('17. an unsupported activity type becomes an explicit unresolved mapping, never a guess', () => {
    const result = mapStudyUSEvidenceToPedagogicalEvidence([row({ activityType: 'CUMULATIVE_ASSESSMENT' })]);
    expect(result.items).toHaveLength(0);
    expect(result.unresolved.some((u) => u.reason === 'UNSUPPORTED_ACTIVITY_TYPE')).toBe(true);
  });
});

describe('CANON-R3 Part 39 -- Old Snapshot tests (18-20)', () => {
  it('18. the old model adapter calls existing authorities rather than reimplementing them', () => {
    const src = read('src/lib/pedagogical-shadow/old-canonical-snapshot.ts');
    expect(src).toMatch(/from '@\/services\/knowledge-state\.service'/);
    expect(src).toMatch(/from '@\/lib\/lx\/path-view'/);
    expect(src).toMatch(/from '@\/lib\/lx\/canonical-learning-progress'/);
    expect(src).toMatch(/resolveConceptJourneyResult/);
    expect(src).toMatch(/buildCanonicalLearningProgress/);
  });

  it('19. an unavailable old field remains null, never guessed (no knowledge state -> NOT_STARTED, no next action)', () => {
    const snapshot = buildOldCanonicalSnapshot({
      conceptId: 'concept-1',
      subjectId: 'subject-1',
      knowledgeState: null,
      masteryPolicy: {
        version: 1,
        minimumUnderstanding: 70,
        minimumIndependence: 70,
        minimumApplication: 70,
        minimumRetention: 70,
        minimumTransfer: 70,
        requiresTransfer: true,
        maximumCriticalMisconceptions: 0,
        minimumEvidenceCount: 3,
        minimumIndependentEvidenceCount: 1,
        validationWindowDays: 30,
      },
    });
    expect(snapshot.stage).toBe('NOT_STARTED');
    expect(snapshot.nextAction).toBeNull();
    expect(snapshot.validationReadiness).toBeNull();
  });

  it('20. the old snapshot adapter is read-only -- no write keyword appears in its source', () => {
    const src = read('src/lib/pedagogical-shadow/old-canonical-snapshot.ts');
    expect(src).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
  });
});

describe('CANON-R3 Part 40 -- Comparator tests (21-27)', () => {
  const highConfidence = { unresolved: [], confidence: 'HIGH' as const };

  it('21. exact stage/action agreement -> MATCH', () => {
    const old = { stage: 'PRACTICE', actionState: 'EXECUTABLE', nextAction: 'PRACTICE', progressPercent: 35, validationReadiness: null, sourceAuthorities: [] };
    const decision = engineEvaluate({ conceptId: 'c', studentId: 's', now: '2026-01-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false });
    // Force a matching PRACTICE new snapshot directly (bypassing full evidence construction -- the comparator's own contract only needs the normalized shapes).
    const newSnapshot = { stage: 'PRACTICE' as const, actionState: 'EXECUTABLE' as const, nextCanonicalAction: 'PRACTICE' as const, progressPercent: 35, policyVersion: decision.policyVersion, canonicalRevision: decision.canonicalRevision };
    const outcome = compareCanonicalDecisions(old, newSnapshot, highConfidence);
    expect(outcome.result).toBe('MATCH');
  });

  it('22. a missing LEARN_CHECK source classifies as ADAPTER_DATA_GAP, not a defect', () => {
    const old = { stage: 'PRACTICE', actionState: 'EXECUTABLE', nextAction: 'PRACTICE', progressPercent: 35, validationReadiness: null, sourceAuthorities: [] };
    const newSnapshot = { stage: 'LEARN' as const, actionState: 'EXECUTABLE' as const, nextCanonicalAction: 'LEARN' as const, progressPercent: 15, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'x' };
    const outcome = compareCanonicalDecisions(old, newSnapshot, { unresolved: [{ reason: 'LEARN_CHECK_SOURCE_UNAVAILABLE', evidenceId: null, detail: '' }], confidence: 'LOW' });
    expect(outcome.result).toBe('ADAPTER_DATA_GAP');
    expect(outcome.reasonCodes).toContain('NEW_LEARN_BLOCKED_BECAUSE_LEARN_CHECK_NOT_AVAILABLE');
  });

  it('23. old RETAIN / new PRACTICE with no qualifying Prove gets an explanatory OLD_MODEL_INCONSISTENCY reason', () => {
    const old = { stage: 'RETAIN', actionState: 'EXECUTABLE', nextAction: 'RETENTION_CHECK', progressPercent: 70, validationReadiness: 'READY', sourceAuthorities: [] };
    const newSnapshot = { stage: 'PRACTICE' as const, actionState: 'EXECUTABLE' as const, nextCanonicalAction: 'PRACTICE' as const, progressPercent: 35, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'x' };
    const outcome = compareCanonicalDecisions(old, newSnapshot, highConfidence);
    expect(outcome.result).toBe('OLD_MODEL_INCONSISTENCY');
    expect(outcome.reasonCodes).toContain('OLD_RETAIN_NEW_PRACTICE_BECAUSE_NO_QUALIFIED_PROVE');
  });

  it('24. old TRANSFER / new RETAIN (premature Transfer) gets an explanatory OLD_MODEL_INCONSISTENCY reason', () => {
    const old = { stage: 'TRANSFER', actionState: 'EXECUTABLE', nextAction: 'TRANSFER', progressPercent: 85, validationReadiness: 'TRANSFER_REQUIRED', sourceAuthorities: [] };
    const newSnapshot = { stage: 'RETAIN' as const, actionState: 'WAITING' as const, nextCanonicalAction: 'NONE' as const, progressPercent: 70, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'x' };
    const outcome = compareCanonicalDecisions(old, newSnapshot, highConfidence);
    expect(outcome.result).toBe('OLD_MODEL_INCONSISTENCY');
    expect(outcome.reasonCodes).toContain('OLD_TRANSFER_NEW_RETAIN_BECAUSE_RETENTION_UNSATISFIED');
  });

  it('25. a historical item-count policy difference is classified explicitly as EXPECTED_POLICY_DIFFERENCE, never a bare mismatch', () => {
    const old = { stage: 'RETAIN', actionState: 'EXECUTABLE', nextAction: 'RETENTION_CHECK', progressPercent: 70, validationReadiness: 'READY', sourceAuthorities: [] };
    const newSnapshot = { stage: 'PROVE' as const, actionState: 'EXECUTABLE' as const, nextCanonicalAction: 'PROVE' as const, progressPercent: 55, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'x' };
    const outcome = compareCanonicalDecisions(old, newSnapshot, { unresolved: [{ reason: 'ITEM_COUNT_NOT_AVAILABLE', evidenceId: 'e1', detail: '' }], confidence: 'MEDIUM' });
    expect(outcome.result).toBe('EXPECTED_POLICY_DIFFERENCE');
    expect(outcome.reasonCodes).toContain('HISTORICAL_ITEM_COUNT_DOES_NOT_MEET_NEW_POLICY');
  });

  it('26. a LOW-confidence adapter never classifies the new engine as defective automatically', () => {
    const old = { stage: 'TRANSFER', actionState: 'EXECUTABLE', nextAction: 'TRANSFER', progressPercent: 85, validationReadiness: null, sourceAuthorities: [] };
    const newSnapshot = { stage: 'PRACTICE' as const, actionState: 'EXECUTABLE' as const, nextCanonicalAction: 'PRACTICE' as const, progressPercent: 35, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'x' };
    const outcome = compareCanonicalDecisions(old, newSnapshot, { unresolved: [{ reason: 'UNKNOWN_SOURCE', evidenceId: 'e1', detail: '' }], confidence: 'LOW' });
    expect(outcome.result).not.toBe('NEW_MODEL_POSSIBLE_DEFECT');
    expect(outcome.result).toBe('UNRESOLVED');
  });

  it('27. the comparator is deterministic -- identical inputs produce an identical outcome', () => {
    const old = { stage: 'PRACTICE', actionState: 'EXECUTABLE', nextAction: 'PRACTICE', progressPercent: 35, validationReadiness: null, sourceAuthorities: [] };
    const newSnapshot = { stage: 'PRACTICE' as const, actionState: 'EXECUTABLE' as const, nextCanonicalAction: 'PRACTICE' as const, progressPercent: 35, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'x' };
    const a = compareCanonicalDecisions(old, newSnapshot, highConfidence);
    const b = compareCanonicalDecisions(old, newSnapshot, highConfidence);
    expect(a).toEqual(b);
  });
});

describe('CANON-R3 Part 41 -- Safety tests (28-36)', () => {
  const allFiles = [...SHADOW_FILES.map((f) => join(SHADOW_DIR, f)), CLI_SCRIPT];

  it('28. no DB write (INSERT/UPDATE/DELETE) statement appears anywhere in the shadow layer or its CLI', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    }
  });

  it('29. no AI provider import/call anywhere in the shadow layer or its CLI', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/openai|anthropic|@ai-sdk/i);
    }
  });

  it('30. no generation service import (quiz-generation, gated-question-generation)', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/quiz-generation|gated-question-generation/);
    }
  });

  it('31. no Quality Gate import', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/quality-gate|question-quality-verifier/);
    }
  });

  it('32. no React import anywhere in the shadow layer', () => {
    for (const f of SHADOW_FILES.map((f) => join(SHADOW_DIR, f))) {
      expect(read(f)).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('33. no Next.js route file is imported or modified by this phase', () => {
    for (const f of allFiles) {
      expect(read(f)).not.toMatch(/from ['"]@\/app\//);
    }
  });

  it('34. a safe shadow record contains no learner answer text field anywhere in its shape', () => {
    const record = buildShadowComparisonRecord({
      conceptId: 'concept-1',
      adapterResult: { items: [], unresolved: [], warnings: [], confidence: 'HIGH', rowsConsidered: 0, evidenceSnapshotFingerprint: 'abc' },
      oldSnapshot: { stage: 'LEARN', actionState: 'EXECUTABLE', nextAction: 'LEARN', progressPercent: 15, validationReadiness: null, sourceAuthorities: [] },
      newSnapshot: { stage: 'LEARN', actionState: 'EXECUTABLE', nextCanonicalAction: 'LEARN', progressPercent: 15, policyVersion: 'studyus-canonical-v1', canonicalRevision: 'abc' },
      comparison: { result: 'MATCH', reasonCodes: ['NO_DISAGREEMENT'], explanation: 'x' },
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toMatch(/answer|response|freeText/i);
  });

  it("35. a safe shadow record's own TYPE never declares a question-text field", () => {
    const src = read('src/lib/pedagogical-shadow/types.ts');
    const shadowRecordBlock = src.slice(src.indexOf('interface ShadowComparisonRecord'));
    expect(shadowRecordBlock.slice(0, shadowRecordBlock.indexOf('}'))).not.toMatch(/questionText|prompt|content/i);
  });

  it('36. no PII field (name, email) appears anywhere in the shadow layer\'s own output types', () => {
    const src = read('src/lib/pedagogical-shadow/types.ts');
    expect(src).not.toMatch(/\bname\s*:|\bemail\s*:/i);
  });
});

describe('CANON-R3 Part 42 -- Engine Frozen verification (37-44)', () => {
  it('37. CANON-R2R1 policy version string is unchanged', () => {
    expect(ENGINE_POLICY_VERSION).toBe('studyus-canonical-v1');
    expect(ENGINE_POLICY.version).toBe('studyus-canonical-v1');
  });

  it('38. LEARN >80 (exclusive) is unchanged', () => {
    expect(ENGINE_POLICY.learn.minimumScorePercentExclusive).toBe(80);
  });

  it('39. Practice >=80, difficulty [2,4] is unchanged', () => {
    expect(ENGINE_POLICY.practice.minimumScorePercent).toBe(80);
    expect(ENGINE_POLICY.practice.difficulty).toEqual({ min: 2, max: 4 });
  });

  it('40. Prove exactly 10 items, >=80%, difficulty [3,4] is unchanged', () => {
    expect(ENGINE_POLICY.prove.itemCount).toBe(10);
    expect(ENGINE_POLICY.prove.minimumScorePercent).toBe(80);
    expect(ENGINE_POLICY.prove.difficulty).toEqual({ min: 3, max: 4 });
  });

  it('41. Retention exactly 10 items, >=80%, 3-day minimum wait, difficulty [3,4] is unchanged', () => {
    expect(ENGINE_POLICY.retention.itemCount).toBe(10);
    expect(ENGINE_POLICY.retention.minimumScorePercent).toBe(80);
    expect(ENGINE_POLICY.retention.minimumWaitDays).toBe(3);
    expect(ENGINE_POLICY.retention.difficulty).toEqual({ min: 3, max: 4 });
  });

  it('42. Transfer exactly 3 challenges, overall >=80%, per-challenge >=70%, difficulty [4,5] is unchanged', () => {
    expect(ENGINE_POLICY.transfer.challengeCount).toBe(3);
    expect(ENGINE_POLICY.transfer.minimumOverallScorePercent).toBe(80);
    expect(ENGINE_POLICY.transfer.perChallengeMinimumScorePercent).toBe(70);
    expect(ENGINE_POLICY.transfer.difficulty).toEqual({ min: 4, max: 5 });
  });

  it('43. the difficulty policy module is unchanged -- its closed reason-code vocabulary is intact', () => {
    const decision = engineEvaluate({ conceptId: 'c', studentId: 's', now: '2026-01-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false });
    expect(decision.activityContract?.difficulty.reasonCode).toBe('LEARN_UNDERSTANDING_ONLY');
  });

  it('44. the output contract is unchanged -- every CANON-R2R1 field is still present', () => {
    const decision = engineEvaluate({ conceptId: 'c', studentId: 's', now: '2026-01-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false });
    for (const field of ['policyVersion', 'canonicalRevision', 'stage', 'currentStage', 'actionState', 'nextCanonicalAction', 'requirements', 'qualifiedEvidence', 'activityContract', 'waitingReason', 'nextEligibleAt', 'intervention', 'rollback', 'reasonCodes', 'journeyProgressPercent', 'computedAt']) {
      expect(field in decision).toBe(true);
    }
  });
});

describe('CANON-R3 end-to-end shadow pipeline (supplementary)', () => {
  it('adapter -> new engine -> comparator -> safe record runs end-to-end for a simple concept with no real Learn source', () => {
    const rows: StudyUSEvidenceRow[] = [row({ activityType: 'PRACTICE', scorePercent: 90, difficulty: 3 })];
    const adapterResult = mapStudyUSEvidenceToPedagogicalEvidence(rows);
    const newSnapshot = buildNewCanonicalSnapshot({
      conceptId: 'concept-1',
      studentId: 'student-1',
      evidence: adapterResult.items,
      activeCriticalMisconception: false,
      now: '2026-01-05T00:00:00.000Z',
    });
    // No LEARN_CHECK source -> the frozen engine correctly stays at LEARN, regardless of the qualifying Practice evidence present.
    expect(newSnapshot.stage).toBe('LEARN');

    const oldSnapshot = buildOldCanonicalSnapshot({
      conceptId: 'concept-1',
      subjectId: 'subject-1',
      knowledgeState: null,
      masteryPolicy: {
        version: 1,
        minimumUnderstanding: 70,
        minimumIndependence: 70,
        minimumApplication: 70,
        minimumRetention: 70,
        minimumTransfer: 70,
        requiresTransfer: true,
        maximumCriticalMisconceptions: 0,
        minimumEvidenceCount: 3,
        minimumIndependentEvidenceCount: 1,
        validationWindowDays: 30,
      },
    });

    const comparison = compareCanonicalDecisions(oldSnapshot, newSnapshot, { unresolved: adapterResult.unresolved, confidence: adapterResult.confidence });
    const record = buildShadowComparisonRecord({ conceptId: 'concept-1', adapterResult, oldSnapshot, newSnapshot, comparison });

    expect(record.new.stage).toBe('LEARN');
    expect(record.adapter.unresolvedMappings).toContain('LEARN_CHECK_SOURCE_UNAVAILABLE');
    expect(record.comparison.result).toBeDefined();
  });
});
