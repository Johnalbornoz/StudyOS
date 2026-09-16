/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * Section 19 full scenario replays, exercised against the real,
 * unmodified engine. Scenario 2 (Practice inconsistency), 4/5 (Retain
 * second chance / hard failure), 6/7/8 (Transfer classification), 9
 * (critical misconception), and 10 (the real regression sequence) each
 * have their own dedicated audit file; this file covers Scenario 1
 * (happy path) and Scenario 3 (Prove failure -> requalification cycle),
 * which the audit found to be CORRECTLY implemented end-to-end and are
 * recorded here as golden-path regression coverage. Test-only.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCanonicalLearningState, type RawEvidenceItem, type PedagogicalEngineInput } from '@/lib/pedagogical-engine';

function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    activityType: 'PRACTICE',
    timestamp: '2026-01-01T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 100,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}
function baseInput(overrides: Partial<PedagogicalEngineInput> = {}): PedagogicalEngineInput {
  return { conceptId: 'concept-1', studentId: 'student-1', now: '2026-01-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false, ...overrides };
}

function learnCheck(ts: string, score: number) {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: Math.round((score / 100) * 5), scorePercent: score, difficulty: 1.5 });
}
function practice(ts: string, score: number) {
  return item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((score / 100) * 3), scorePercent: score, difficulty: 3 });
}
function prove(ts: string, score: number) {
  return item({ activityType: 'PROVE', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true });
}
function retain(ts: string, score: number) {
  return item({ activityType: 'RETENTION_CHECK', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, novel: true });
}
function transfer(ts: string, scores: number[]) {
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: scores.filter((s) => s >= 80).length, scorePercent: overall, difficulty: 4.5, independent: true, perChallengeScores: scores, reasoningProvided: true });
}

describe('SCENARIO 1 -- HAPPY PATH: LEARN -> PRACTICE(x2) -> PROVE -> wait 3 days -> RETAIN -> TRANSFER -> CONSOLIDATED', () => {
  const evidence = [
    learnCheck('2026-01-01T00:00:00.000Z', 90),
    practice('2026-01-02T00:00:00.000Z', 90),
    practice('2026-01-02T01:00:00.000Z', 90),
    prove('2026-01-03T00:00:00.000Z', 90),
    retain('2026-01-06T00:00:00.000Z', 90), // exactly 3 days after Prove
    transfer('2026-01-15T00:00:00.000Z', [90, 90, 90]),
  ];

  it('after LEARN only -> stage LEARN then PRACTICE unlocked', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [evidence[0]], now: '2026-01-01T12:00:00.000Z' }));
    expect(d.stage).toBe('PRACTICE');
  });

  it('after 2 Practice passes -> PROVE unlocked, EXECUTABLE', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: evidence.slice(0, 3), now: '2026-01-02T12:00:00.000Z' }));
    expect(d.stage).toBe('PROVE');
    expect(d.actionState).toBe('EXECUTABLE');
  });

  it('after a qualifying Prove -> RETAIN WAITING with a 3-day nextEligibleAt', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: evidence.slice(0, 4), now: '2026-01-04T00:00:00.000Z' }));
    expect(d.stage).toBe('RETAIN');
    expect(d.actionState).toBe('WAITING');
    expect(d.nextEligibleAt).toBe('2026-01-06T00:00:00.000Z');
  });

  it('at exactly 3 days + a qualifying Retain -> TRANSFER unlocked', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: evidence.slice(0, 5), now: '2026-01-06T00:00:00.000Z' }));
    expect(d.stage).toBe('TRANSFER');
    expect(d.actionState).toBe('EXECUTABLE');
  });

  it('after a qualifying Transfer -> CONSOLIDATED', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-16T00:00:00.000Z' }));
    expect(d.stage).toBe('CONSOLIDATED');
    expect(d.actionState).toBe('CONSOLIDATED');
    expect(d.journeyProgressPercent).toBe(100);
  });

  it('every requirement in the final decision carries satisfactionBasis V1_EVIDENCE (no fabrication anywhere in the happy path)', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-16T00:00:00.000Z' }));
    for (const r of d.requirements) {
      expect(r.status).toBe('SATISFIED');
      expect(r.satisfactionBasis).toBe('V1_EVIDENCE');
    }
  });
});

describe('SCENARIO 3 -- PROVE FAILURE: Practice qualifies, Prove fails, Practice requalifies, new Prove passes', () => {
  it('full replay reaches PROVE SATISFIED again after the requalification cycle, with the failed Prove preserved as immutable history', () => {
    const failedProve = prove('2026-01-03T00:00:00.000Z', 50);
    const evidence = [
      learnCheck('2026-01-01T00:00:00.000Z', 90),
      practice('2026-01-02T00:00:00.000Z', 90),
      practice('2026-01-02T01:00:00.000Z', 90),
      failedProve,
      practice('2026-01-04T00:00:00.000Z', 90),
      practice('2026-01-04T01:00:00.000Z', 90),
      prove('2026-01-05T00:00:00.000Z', 90),
    ];
    const d = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-06T00:00:00.000Z' }));
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.nonQualifyingEvidenceIds).toContain(failedProve.id);
    expect(d.stage).toBe('RETAIN');
  });
});
