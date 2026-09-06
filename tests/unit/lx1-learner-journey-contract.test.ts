/**
 * LX-1B -- canonical learner journey contract. Pure mapping; canonical
 * states in, journey vocabulary out. No score inspection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveLearnerJourneyStage,
  LEARNER_JOURNEY_CONTRACT_VERSION,
  type LearnerJourneyInputs,
} from '@/lib/lx/learner-journey-contract';

const base: LearnerJourneyInputs = {
  learningState: 'DEVELOPING',
  masteryState: 'DEVELOPING',
  validationReadiness: 'INSUFFICIENT_EVIDENCE',
};

describe('LX-1B deriveLearnerJourneyStage', () => {
  it('is a pure function: no db / no score / threshold constants in the source', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/lx/learner-journey-contract.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/from '@\/lib\/db'/);
    expect(src).not.toMatch(/\.query\(/);
    expect(src).not.toMatch(/masteryScore|understandingScore|>= ?\d|threshold|minimum/i);
  });

  it('NOT_STARTED when there is no Knowledge State', () => {
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'NOT_STARTED', masteryState: null, validationReadiness: null }).stage).toBe('NOT_STARTED');
    expect(deriveLearnerJourneyStage({ ...base, masteryState: 'UNKNOWN' }).stage).toBe('NOT_STARTED');
  });

  it('LEARN vs PRACTICE vs READY_TO_PROVE split by canonical MasteryState / ValidationReadiness', () => {
    expect(deriveLearnerJourneyStage({ ...base, masteryState: 'LEARNING' }).stage).toBe('LEARN');
    expect(deriveLearnerJourneyStage({ ...base, masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' }).stage).toBe('PRACTICE');
    expect(deriveLearnerJourneyStage({ ...base, masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'READY' }).stage).toBe('READY_TO_PROVE');
  });

  it('PROVE while the independent-demonstration moment is live', () => {
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'PENDING_VERIFICATION' }).stage).toBe('PROVE');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'INSUFFICIENT_INDEPENDENT_EVIDENCE' }).stage).toBe('PROVE');
  });

  it('RETAIN / TRANSFER / CONSOLIDATED from their canonical LearningState', () => {
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'RETENTION_RISK' }).stage).toBe('RETAIN');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'TRANSFER_GAP' }).stage).toBe('TRANSFER');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'VALIDATED', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' }).stage).toBe('CONSOLIDATED');
  });

  it('REINFORCE is an overlay, never a stage, for every blocking LearningState', () => {
    for (const ls of ['MISCONCEPTION_BLOCKED', 'PREREQUISITE_BLOCKED', 'NEEDS_REPAIR'] as const) {
      const r = deriveLearnerJourneyStage({ ...base, learningState: ls });
      expect(r.intervention).toBe('REINFORCE');
      expect(['NOT_STARTED', 'LEARN', 'PRACTICE', 'READY_TO_PROVE', 'PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED']).toContain(r.stage);
    }
  });

  it('precedence: blocking beats everything; retention beats transfer beats validated (mirrors computeLearningState)', () => {
    // computeLearningState already collapses precedence into one LearningState;
    // the mapper must honour whichever state it was handed, not re-decide.
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'MISCONCEPTION_BLOCKED', masteryState: 'VALIDATED_MASTERY' }).intervention).toBe('REINFORCE');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'RETENTION_RISK', masteryState: 'VALIDATED_MASTERY' }).stage).toBe('RETAIN');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'TRANSFER_GAP', masteryState: 'VALIDATED_MASTERY' }).stage).toBe('TRANSFER');
  });

  it('is deterministic and carries a contract version', () => {
    const a = deriveLearnerJourneyStage(base);
    const b = deriveLearnerJourneyStage(base);
    expect(a).toEqual(b);
    expect(a.contractVersion).toBe(LEARNER_JOURNEY_CONTRACT_VERSION);
    expect(typeof a.reason).toBe('string');
  });
});

describe('LX-1R -- journey contract boundary verification (no redesign)', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/lx/learner-journey-contract.ts'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('1. consumes only canonical states -- no db, no score/threshold numerics', () => {
    expect(src).not.toMatch(/from '@\/lib\/db'/);
    expect(src).not.toMatch(/\.query\(/);
    expect(src).not.toMatch(/masteryScore|understandingScore|>= ?\d|<= ?\d|threshold|minimum[A-Z]/);
  });

  it('2. introduces no score thresholds (only string state comparisons)', () => {
    // the only comparisons in the file are against string literals / Set membership
    expect(src).not.toMatch(/[<>]=?\s*0?\.\d/);
  });

  it('3. is not an input back into any learning engine (unchanged version 1, presentation only)', () => {
    expect(LEARNER_JOURNEY_CONTRACT_VERSION).toBe(1);
    expect(src).not.toMatch(/updateMastery|recalculateConcept|getLearningDecisions|computeTeachingIntent/);
  });

  it('4. mirrors computeLearningState precedence rather than redefining it', () => {
    // blocking beats validated; retention beats transfer beats validated -- exactly as computeLearningState orders them
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'MISCONCEPTION_BLOCKED', masteryState: 'VALIDATED_MASTERY' }).intervention).toBe('REINFORCE');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'RETENTION_RISK', masteryState: 'VALIDATED_MASTERY' }).stage).toBe('RETAIN');
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'TRANSFER_GAP', masteryState: 'VALIDATED_MASTERY' }).stage).toBe('TRANSFER');
    // it does not re-run its own precedence: PENDING_VERIFICATION always -> PROVE regardless of masteryState
    expect(deriveLearnerJourneyStage({ ...base, learningState: 'PENDING_VERIFICATION', masteryState: 'VALIDATED_MASTERY' }).stage).toBe('PROVE');
  });

  it('5. REINFORCE stays an overlay (never a stage value)', () => {
    const r = deriveLearnerJourneyStage({ ...base, learningState: 'NEEDS_REPAIR' });
    expect(r.intervention).toBe('REINFORCE');
    expect(r.stage).not.toBe('REINFORCE' as unknown as typeof r.stage);
  });

  it('6. the coarse REINFORCE return stage is explicitly deferred (documented, not resolved here)', () => {
    const raw = readFileSync(join(process.cwd(), 'src/lib/lx/learner-journey-contract.ts'), 'utf-8');
    expect(raw).toMatch(/LX-5/); // header comment defers the accurate return stage
    const r = deriveLearnerJourneyStage({ ...base, learningState: 'PREREQUISITE_BLOCKED' });
    expect(r.stage).toBe('PRACTICE'); // best-effort coarse position only
  });
});
