/**
 * LX-9R8 -- ZERO-GAP ACTIVITY INTEGRITY + SEMANTIC QUALITY-GATE ROOT
 * CAUSE. Required tests 1-9 (PART A: zero-gap Practice must not be
 * executable), 12-17 (PART B1/B2: verifier contract validity), and
 * 21-23 (regression). Tests 10-11, 18-20 (rejection-log/histogram
 * observability and the mocked exact-count/retry regressions) live in
 * the sibling file lx9r8-r1-quality-gate-observability.test.ts, which
 * whole-module-mocks the deterministic contract and semantic verifier
 * -- this file never does, so every assertion here runs the REAL, pure
 * `isZeroGapPracticeMismatch` / `checkQuestionQualityDeterministic` /
 * `evaluateQuestionQualityVerdict` / `classifyQualityRejectionReasons`
 * logic, never a stand-in.
 *
 * Live evidence (LX-9R8 spec): a topic_practice request resolved
 * activityType=PRACTICE, targetDifficulty=2, masteryState=LEARNING,
 * with the canonical evidence gap already 0 -- Phase 3C selected
 * PRACTICE anyway. Generation then ran (Luna succeeded), but semantic
 * verification rejected the ONE candidate TWICE (Luna's and the Terra
 * recovery's), landing on QUESTION_COUNT_INSUFFICIENT /
 * publishedCount=0. Two independent defects: (A) nothing stopped a
 * zero-gap PRACTICE decision from being treated as executable, and (B)
 * the semantic verifier had zero difficulty context, so it judged a
 * deliberately simple difficulty-2 question against an undifferentiated
 * standard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

import { isZeroGapPracticeMismatch, deriveEvidenceRequirement, CURRENT_GENERATION_QUESTION_ENVELOPE } from '@/lib/lx/evidence-sufficiency-contract';
import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import { buildConceptMissionView, type ConceptMissionInputs, type ConceptMissionJourneyInput } from '@/lib/lx/concept-mission';
import { checkQuestionQualityDeterministic } from '@/lib/lx/question-quality-contract';
import {
  evaluateQuestionQualityVerdict,
  classifyQualityRejectionReasons,
  type QuestionQualityVerdict,
} from '@/services/question-quality-verifier.service';
import { describeDifficultyTier, type GeneratedQuestion } from '@/services/quiz-generation.service';
import type { MasteryPolicy, ConceptKnowledgeState } from '@/services/knowledge-state.service';
import type { LearningDecision, LearningFact } from '@/lib/adaptive-learning-policy';

function policy(over: Partial<MasteryPolicy> = {}): MasteryPolicy {
  return {
    version: 1,
    minimumUnderstanding: 70,
    minimumIndependence: 60,
    minimumApplication: 60,
    minimumRetention: 60,
    minimumTransfer: 60,
    requiresTransfer: false,
    maximumCriticalMisconceptions: 0,
    minimumEvidenceCount: 3,
    minimumIndependentEvidenceCount: 1,
    validationWindowDays: 14,
    ...over,
  };
}

function ks(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'LEARNING', understandingScore: 55, independenceScore: 40, applicationScore: 40,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    // LIVE EVIDENCE: evidence already AT the canonical minimum -- gap 0.
    evidenceCount: 3, independentEvidenceCount: 1, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'INSUFFICIENT_EVIDENCE', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function decision(learningState: LearningDecision['learningState'], activityType: LearningDecision['activityType']): LearningDecision {
  return { actionConceptId: 'c1', subjectId: 'subj1', learningState, activityType, facts: [] as LearningFact[], signals: [] } as unknown as LearningDecision;
}

/* ================================================================= *
 * PART A -- REQUIRED TESTS 1-9: zero-gap PRACTICE must not be        *
 * executable.                                                        *
 * ================================================================= */

describe('LX-9R8 1 -- zero-gap PRACTICE is NOT executable', () => {
  it('isZeroGapPracticeMismatch is true for PRACTICE, gap=0, no REINFORCE intervention', () => {
    expect(
      isZeroGapPracticeMismatch({
        activityType: 'PRACTICE',
        hasReinforceIntervention: false,
        currentSufficiency: { evidenceCount: 3, independentEvidenceCount: 1, passed: true },
        masteryPolicy: policy(),
      }),
    ).toBe(true);
  });

  it('buildCanonicalLearningProgress reports BLOCKED, not EXECUTABLE, for the live-evidence PRACTICE decision', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('DEVELOPING', 'PRACTICE'),
      masteryPolicy: policy(),
    });
    expect(progress.actionState).toBe('BLOCKED');
    expect(progress.nextCanonicalAction).toBeNull();
  });
});

describe('LX-9R8 2 -- zero-gap REVIEW is NOT executable', () => {
  it('isZeroGapPracticeMismatch is true for REVIEW, gap=0, no REINFORCE intervention', () => {
    expect(
      isZeroGapPracticeMismatch({
        activityType: 'REVIEW',
        hasReinforceIntervention: false,
        currentSufficiency: { evidenceCount: 5, independentEvidenceCount: 2, passed: true },
        masteryPolicy: policy(),
      }),
    ).toBe(true);
  });

  it('buildCanonicalLearningProgress reports BLOCKED for a zero-gap REVIEW decision', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('DEVELOPING', 'REVIEW'),
      masteryPolicy: policy(),
    });
    expect(progress.actionState).toBe('BLOCKED');
  });
});

describe('LX-9R8 3 -- an EXPLICIT REINFORCE intervention is the only exception', () => {
  it('isZeroGapPracticeMismatch is false when hasReinforceIntervention=true, even at gap=0', () => {
    expect(
      isZeroGapPracticeMismatch({
        activityType: 'PRACTICE',
        hasReinforceIntervention: true,
        currentSufficiency: { evidenceCount: 3, independentEvidenceCount: 1, passed: true },
        masteryPolicy: policy(),
      }),
    ).toBe(false);
  });

  it('buildCanonicalLearningProgress stays EXECUTABLE for a MISCONCEPTION_BLOCKED (REINFORCE) PRACTICE decision at gap=0', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('MISCONCEPTION_BLOCKED', 'PRACTICE'),
      masteryPolicy: policy(),
    });
    expect(progress.intervention).toBe('REINFORCE');
    expect(progress.actionState).toBe('EXECUTABLE');
    expect(progress.nextCanonicalAction).toBe('PRACTICE');
  });

  it('low mastery/understanding ALONE (no explicit intervention) never substitutes for a REINFORCE signal', () => {
    // Same low understandingScore as any LEARNING-state learner, but the
    // journey/learningState carries no MISCONCEPTION_BLOCKED/
    // PREREQUISITE_BLOCKED/NEEDS_REPAIR -- isZeroGapPracticeMismatch must
    // still block, proving the exception is never inferred from mastery
    // level alone.
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks({ understandingScore: 5 }),
      activeDecision: decision('DEVELOPING', 'PRACTICE'),
      masteryPolicy: policy(),
    });
    expect(progress.actionState).toBe('BLOCKED');
  });
});

describe('LX-9R8 4 -- executionMinimum can never manufacture a pedagogical requirement', () => {
  it('the DETERMINED pedagogicalRequirement is 0 even though executionMinimum > 0', () => {
    const requirement = deriveEvidenceRequirement({
      activityType: 'PRACTICE',
      evidenceMode: 'PRACTICE',
      targetDimension: 'UNDERSTANDING',
      masteryPolicy: policy(),
      currentSufficiency: { evidenceCount: 3, independentEvidenceCount: 1, passed: true },
    });
    expect(requirement.questionCount.status).toBe('DETERMINED');
    if (requirement.questionCount.status === 'DETERMINED') {
      expect(requirement.questionCount.pedagogicalRequirement).toBe(0);
      expect(requirement.questionCount.executionMinimum).toBe(CURRENT_GENERATION_QUESTION_ENVELOPE.min);
      expect(requirement.questionCount.executionMinimum).toBeGreaterThan(0);
    }
  });

  it('isZeroGapPracticeMismatch reads ONLY pedagogicalRequirement, never executionMinimum, for its verdict', () => {
    const SRC = read('src/lib/lx/evidence-sufficiency-contract.ts');
    const fn = SRC.slice(SRC.indexOf('export function isZeroGapPracticeMismatch'));
    expect(fn).toMatch(/pedagogicalRequirement === 0/);
    expect(fn).not.toMatch(/executionMinimum/);
  });
});

describe('LX-9R8 5 -- Today cannot offer a zero-gap Practice CTA', () => {
  const SNAPSHOT_SRC = read('src/services/learning-os-snapshot.service.ts');
  const TODAY_SRC = read('src/app/dashboard/today/page.tsx');

  it('the snapshot exposes nextExecutableItemZeroGapBlocked, computed via the shared isZeroGapPracticeMismatch authority', () => {
    expect(SNAPSHOT_SRC).toMatch(/nextExecutableItemZeroGapBlocked: boolean/);
    expect(SNAPSHOT_SRC).toMatch(/nextExecutableItemZeroGapBlocked = isZeroGapPracticeMismatch\(/);
  });

  it("Today reads that flag and suppresses the hero CTA -- never re-derives the check itself", () => {
    // CANON-R5 Part 9: when the canonical engine gate is on and a fresh
    // per-item override exists, ITS launchStatus is authoritative
    // instead (see canonicalOverride's own doc comment) -- but with the
    // gate off (or no override), this is still byte-identical to the
    // original LX-9R8 computation: `!!snapshot?.nextExecutableItemZeroGapBlocked`.
    expect(TODAY_SRC).toMatch(/const bestZeroGapBlocked = !!best && \(/);
    expect(TODAY_SRC).toMatch(/!!snapshot\?\.nextExecutableItemZeroGapBlocked \|\| !!snapshot\?\.canonicalOverrideReadFailed/);
    expect(TODAY_SRC).toMatch(/hasPrimaryAction: !!best && !bestZeroGapBlocked/);
    expect(TODAY_SRC).toMatch(/\{best && \(bestZeroGapBlocked \? null : bestWaiting \?/);
    // Closeout B boundary: Today itself never imports isZeroGapPracticeMismatch -- the computation lives in the service.
    expect(TODAY_SRC).not.toMatch(/isZeroGapPracticeMismatch/);
  });
});

describe('LX-9R8 6 -- My Path cannot offer a zero-gap Practice CTA', () => {
  const PATH_VIEW_SRC = read('src/lib/lx/path-view.ts');

  it('the hero block computes zeroGapMismatch via the shared authority and folds it into actionState as BLOCKED', () => {
    expect(PATH_VIEW_SRC).toMatch(/isZeroGapPracticeMismatch\(\{/);
    expect(PATH_VIEW_SRC).toMatch(/zeroGapMismatch \? 'BLOCKED' : 'EXECUTABLE'/);
  });
});

describe('LX-9R8 7 -- Concept Mission cannot offer a zero-gap Practice CTA', () => {
  const FACTS: LearningFact[] = [{ kind: 'forgettingRisk', forgettingRisk: 62 } as unknown as LearningFact];
  function base(over: Partial<ConceptMissionInputs> = {}): ConceptMissionInputs {
    return {
      conceptName: 'Cell Division', subjectId: 'subj-1', subjectName: 'Biology',
      conceptDescription: null, goalFallbackText: 'Understand Cell Division.',
      knowledgeState: null,
      journeyInput: { kind: 'RESOLVED', learningState: 'DEVELOPING', source: 'LEARNING_DECISION' } as ConceptMissionJourneyInput,
      learningDecision: null, memory: null, transferDepth: null, hasCachedExplanation: false,
      masteryPolicy: null,
      ...over,
    };
  }

  it('a zero-gap PRACTICE decision resolves NO_CANONICAL_ACTION / ZERO_GAP_MISMATCH, never CANONICAL_ACTION', () => {
    const v = buildConceptMissionView(
      base({
        knowledgeState: { masteryState: 'LEARNING', validationReadiness: 'INSUFFICIENT_EVIDENCE', evidenceCount: 3, independentEvidenceCount: 1 } as any,
        learningDecision: { activityType: 'PRACTICE', actionConceptId: 'c1', learningState: 'DEVELOPING', facts: FACTS },
        masteryPolicy: policy(),
      }),
    );
    expect(v.now.kind).toBe('NO_CANONICAL_ACTION');
    if (v.now.kind === 'NO_CANONICAL_ACTION') expect(v.now.fallback).toBe('ZERO_GAP_MISMATCH');
  });

  it('the SAME decision with a genuine evidence gap (gap > 0) still resolves CANONICAL_ACTION', () => {
    const v = buildConceptMissionView(
      base({
        knowledgeState: { masteryState: 'LEARNING', validationReadiness: 'INSUFFICIENT_EVIDENCE', evidenceCount: 0, independentEvidenceCount: 0 } as any,
        learningDecision: { activityType: 'PRACTICE', actionConceptId: 'c1', learningState: 'DEVELOPING', facts: FACTS },
        masteryPolicy: policy(),
      }),
    );
    expect(v.now.kind).toBe('CANONICAL_ACTION');
  });
});

describe('LX-9R8 8 -- continuation cannot launch a zero-gap Practice/Review activity', () => {
  const SRC = read('src/services/learning-continuation.service.ts');

  it('the zero-gap check runs BEFORE startLearningSession is ever called, and returns RETURN_TO_MISSION/ZERO_GAP_MISMATCH', () => {
    const checkIdx = SRC.indexOf('isZeroGapPracticeMismatch({');
    const launchIdx = SRC.indexOf('await startLearningSession(');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(launchIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(launchIdx);
    expect(SRC).toMatch(/return \{ status: 'RETURN_TO_MISSION', reason: 'ZERO_GAP_MISMATCH' \}/);
  });

  it('a genuine REINFORCE learningState is excluded from the check before it even runs (never suppresses a real intervention)', () => {
    expect(SRC).toMatch(/!REINFORCE_LEARNING_STATES\.has\(phase4Decision\.learningState\)/);
  });
});

describe('LX-9R8 9 -- the generation route fails BEFORE any AI call for a zero-gap PRACTICE/REVIEW request', () => {
  const SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

  it('the INVALID_GENERATION_CONTRACT/ZERO_GAP_PRACTICE_MISMATCH return is positioned strictly before every generation call', () => {
    const checkIdx = SRC.indexOf("reason: 'ZERO_GAP_PRACTICE_MISMATCH'");
    expect(checkIdx).toBeGreaterThan(-1);
    for (const callSite of [
      'generateQuickCheckQuestions(conceptIds[0]',
      'generatePracticeQuestions(conceptIds[0]',
      'generateRetentionCheckQuestions(conceptIds[0]',
      'generateGatedQuestionBatch(cId,',
    ]) {
      const idx = SRC.indexOf(callSite);
      expect(idx).toBeGreaterThan(-1);
      expect(checkIdx).toBeLessThan(idx);
    }
  });

  it('a genuine REINFORCE signal (critical misconception / INTERVENTION_REQUIRED) still runs the activity -- never silently suppressed', () => {
    expect(SRC).toMatch(/hasReinforceSignal = !!ks && \(ks\.criticalMisconceptionCount > 0 \|\| ks\.masteryState === 'INTERVENTION_REQUIRED'\)/);
    // CANON-R5R1B: the 409 short-circuit is now ALSO conditioned on
    // `!v1Marker` (a trusted, freshly-verified v1 Practice authorization
    // bypasses this legacy guard entirely -- see
    // canon-r5r1b-zero-gap-authority-bypass.test.ts) -- the REINFORCE
    // condition itself, and its own suppression-prevention guarantee,
    // are unchanged.
    expect(SRC).toMatch(/if \(!hasReinforceSignal && !v1Marker\) \{/);
  });
});

/* ================================================================= *
 * PART B1/B2 -- REQUIRED TESTS 12-17: verifier contract validity.    *
 * ================================================================= */

function difficulty2Fixture(): GeneratedQuestion {
  return {
    id: 'q1',
    conceptId: 'c1',
    type: 'multiple_choice',
    answerFormat: 'single_choice',
    question:
      'A cell has 46 chromosomes before mitosis begins. How many chromosomes will each of the two daughter cells have once mitosis completes?',
    options: [
      { id: 'a', text: '23' },
      { id: 'b', text: '46' },
      { id: 'c', text: '92' },
      { id: 'd', text: '12' },
    ],
    correctAnswer: 'b',
    explanation: 'Mitosis produces two daughter cells genetically identical to the parent cell, each retaining the full chromosome count (46).',
    difficulty: 2,
    cognitiveLevel: 'COMPREHENSION',
    expectedReasoningType: 'CONCEPTUAL',
  } as GeneratedQuestion;
}

function validVerdict(): QuestionQualityVerdict {
  return {
    conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true,
    issues: [], confidence: 0.9,
  };
}

describe('LX-9R8 12 -- B2 fixture: a valid difficulty-2 Practice question clears the REAL deterministic contract', () => {
  it('checkQuestionQualityDeterministic never FAILs a well-formed difficulty-2 fixture', () => {
    const report = checkQuestionQualityDeterministic(difficulty2Fixture(), { conceptId: 'c1', difficulty: 2 });
    expect(report.status).not.toBe('FAIL');
    expect(report.failures).toEqual([]);
  });

  it('a choice question with options is correctly handed to semantic verification for distractor plausibility -- never invented as PASS', () => {
    const report = checkQuestionQualityDeterministic(difficulty2Fixture(), { conceptId: 'c1', difficulty: 2 });
    expect(report.status).toBe('NOT_DETERMINISTICALLY_VERIFIED');
    expect(report.needsSemantic).toContain('distractor plausibility');
  });
});

describe('LX-9R8 13 -- B2 fixture: a correctly-calibrated verdict for that SAME fixture passes', () => {
  it('evaluateQuestionQualityVerdict accepts a well-formed, high-confidence verdict for the valid difficulty-2 fixture', () => {
    expect(evaluateQuestionQualityVerdict(validVerdict())).toEqual({ pass: true, reason: '' });
  });
});

describe('LX-9R8 14 -- an ambiguous candidate is correctly rejected', () => {
  it('unambiguous=false fails with AMBIGUOUS', () => {
    const v = { ...validVerdict(), unambiguous: false };
    const result = evaluateQuestionQualityVerdict(v);
    expect(result.pass).toBe(false);
    expect(classifyQualityRejectionReasons(v)).toEqual(['AMBIGUOUS']);
  });
});

describe('LX-9R8 15 -- an out-of-scope candidate is correctly rejected', () => {
  it('conceptAligned=false fails with OUT_OF_SCOPE', () => {
    const v = { ...validVerdict(), conceptAligned: false };
    const result = evaluateQuestionQualityVerdict(v);
    expect(result.pass).toBe(false);
    expect(classifyQualityRejectionReasons(v)).toEqual(['OUT_OF_SCOPE']);
  });
});

describe('LX-9R8 16 -- B1: the verifier now carries the SAME difficulty calibration the generator used (the provable contract gap)', () => {
  const VERIFIER_SRC = read('src/services/question-quality-verifier.service.ts');

  it('the single-candidate prompt/payload include this candidate\'s own difficulty and tier description', () => {
    expect(VERIFIER_SRC).toMatch(/describeDifficultyTier\(q\.difficulty\)/);
    expect(VERIFIER_SRC).toMatch(/difficulty: q\.difficulty,/);
  });

  it('the batch prompt/payload calibrate EACH candidate against its OWN assigned tier, never a fixed undifferentiated standard', () => {
    expect(VERIFIER_SRC).toMatch(/TARGET DIFFICULTY: each candidate below carries its OWN "difficulty"/);
  });

  it('describeDifficultyTier(2) is the SAME text the generator itself uses to specify a difficulty-2 question', () => {
    expect(describeDifficultyTier(2)).toMatch(/one clear application step/);
  });
});

describe('LX-9R8 17 -- B1: generator and verifier share ONE tier-definition authority, never a duplicated copy', () => {
  it('question-quality-verifier.service.ts imports describeDifficultyTier from quiz-generation.service.ts -- it does not redefine tier prose', () => {
    const VERIFIER_SRC = read('src/services/question-quality-verifier.service.ts');
    expect(VERIFIER_SRC).toMatch(/import \{ describeDifficultyTier, type GeneratedQuestion \} from '@\/services\/quiz-generation\.service'/);
    expect(VERIFIER_SRC).not.toMatch(/function describeDifficultyTier/);
  });

  it('quiz-generation.service.ts is the ONE place describeDifficultyTier is defined and exported', () => {
    const GEN_SRC = read('src/services/quiz-generation.service.ts');
    expect(GEN_SRC).toMatch(/export function describeDifficultyTier\(difficulty: number\): string/);
    expect(GEN_SRC).toMatch(/const difficultyDesc = describeDifficultyTier\(difficulty\);/);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 21-23 -- regression: canonical stage/progress/       *
 * adaptive-difficulty/novelty unchanged.                              *
 * ================================================================= */

describe('LX-9R8 21 -- canonical journey stage/progress are unaffected by the zero-gap check', () => {
  it('omitting masteryPolicy preserves the pre-LX-9R8 EXECUTABLE behavior (backward compatible, zeroGapMismatch never computed without it)', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('DEVELOPING', 'PRACTICE'),
      // masteryPolicy intentionally omitted.
    });
    expect(progress.actionState).toBe('EXECUTABLE');
    expect(progress.nextCanonicalAction).toBe('PRACTICE');
  });

  it('journeyStage/journeyProgressPercent are computed exactly as before -- zero-gap only affects actionState', () => {
    const withPolicy = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('DEVELOPING', 'PRACTICE'), masteryPolicy: policy(),
    });
    const withoutPolicy = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('DEVELOPING', 'PRACTICE'),
    });
    expect(withPolicy.journeyStage).toBe(withoutPolicy.journeyStage);
    expect(withPolicy.journeyProgressPercent).toBe(withoutPolicy.journeyProgressPercent);
  });
});

describe('LX-9R8 22 -- adaptive-difficulty tier prose is unchanged by the describeDifficultyTier extraction', () => {
  it('every one of the 5 tiers still reads exactly as the original inline description did', () => {
    expect(describeDifficultyTier(1)).toMatch(/direct recall or the single most familiar, textbook-form application/);
    expect(describeDifficultyTier(2)).toMatch(/one clear application step in a familiar representation/);
    expect(describeDifficultyTier(3)).toMatch(/combines two related steps, or requires translating between two equivalent representations/);
    expect(describeDifficultyTier(4)).toMatch(/multi-step reasoning across several steps/);
    expect(describeDifficultyTier(5)).toMatch(/transfer to a genuinely unfamiliar context/);
  });
});

describe('LX-9R8 23 -- cross-chunk/novelty dedupe logic is untouched', () => {
  it('generatePracticeQuestions still runs its own normalizeText-based cross-chunk dedupe, unchanged by the operationId/activityType threading', () => {
    const GEN_SRC = read('src/services/quiz-generation.service.ts');
    expect(GEN_SRC).toMatch(/const key = normalizeText\(q\.question\)\.toLowerCase\(\);/);
    expect(GEN_SRC).toMatch(/duplicatesRemoved\+\+;/);
  });
});
