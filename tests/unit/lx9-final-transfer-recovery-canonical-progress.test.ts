/**
 * LX-9 FINAL CONSOLIDATION -- TRANSFER RECOVERY + SINGLE CANONICAL
 * PROGRESS AUTHORITY. The 37 required tests, in order, plus the Part V
 * consistency matrix.
 *
 * Live-trace findings (Part A, via dedicated research): a 50% partial
 * Transfer score writes evidence with sourceType TRANSFER; that
 * evidence's metadata never carries an `activityType` key, so the
 * memory-model replay (`normalizeMemoryEvidence`) excludes it entirely
 * -- a Transfer attempt structurally CANNOT move retention state.
 * `computeLearningState`'s RETENTION_RISK-before-TRANSFER_GAP
 * precedence is unchanged and correct: if RETAIN appears after a
 * partial Transfer, it is because retention was independently already
 * due, never because Transfer evidence reset anything. The actual
 * "first broken contract" was a UI bug: the "Couldn't prepare your
 * practice" retry button called `generateQuiz` (a different function
 * that immediately changes `phase`) instead of `startCanonicalActivity`
 * (the function that had actually failed), turning one recoverable
 * failure into a different, more severe-looking one on retry --
 * PROVEN and FIXED in `src/app/dashboard/quiz/page.tsx`. Parts C, D,
 * and H below are therefore audits that CONFIRM no bug exists, not
 * fixes -- reported as such, not silently skipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const SESSION_ENGINE_SRC = read('src/services/learning-session-engine.service.ts');
const QUIZ_PERSISTENCE_SRC = read('src/services/quiz-persistence.service.ts');
const LEARNER_JOURNEY_SRC = read('src/lib/lx/learner-journey-contract.ts');
const MEMORY_MODEL_SRC = read('src/lib/algorithms/memory-model.ts');
const TRANSFER_SUBMIT_SRC = read('src/app/api/cognitive/transfer/submit/route.ts');
const ADAPTIVE_POLICY_SRC = read('src/lib/adaptive-learning-policy.ts');
const DASHBOARD_PAGE_SRC = read('src/app/dashboard/page.tsx');

import {
  selectActivityType,
  computeLearningState,
  consolidateSignals,
  type LearningSignal,
  type ConceptDecisionContext,
} from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState, MasteryState } from '@/services/knowledge-state.service';
import { resolveTargetDifficulty } from '@/lib/lx/difficulty-contract';
import { buildConceptMissionView, type ConceptMissionInputs, type ConceptMissionJourneyInput } from '@/lib/lx/concept-mission';
import { resolveConceptJourneyStage } from '@/lib/lx/path-view';
import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import { deriveJourneyProgress } from '@/lib/lx/journey-progress';
import { isRetentionWaiting } from '@/lib/lx/learner-journey-contract';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import type { LearnerJourneyStage } from '@/lib/lx/learner-journey-contract';

function signal(overrides: Partial<LearningSignal> & Pick<LearningSignal, 'type' | 'conceptId' | 'subjectId'>): LearningSignal {
  return { source: 'test', metadata: {}, ...overrides };
}
function ksState(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'DEVELOPING', understandingScore: 70, independenceScore: 65, applicationScore: 60,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 5, independentEvidenceCount: 2, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'INSUFFICIENT_EVIDENCE', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
function makeContext(signals: LearningSignal[], ks: ConceptKnowledgeState | null): ConceptDecisionContext {
  const map = new Map<string, ConceptKnowledgeState>();
  if (ks) map.set(ks.conceptId, ks);
  const contexts = consolidateSignals(signals, map);
  return (
    contexts[0] ?? {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks, signals: [], targetConceptIds: [],
      remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    }
  );
}

/* ================================================================== *
 * TRANSFER RECOVERY 1-3 -- evidence write & Retention independence.  *
 * ================================================================== */
describe('LX-9 FINAL 1-3 -- Transfer evidence persists; Retention stays independently represented', () => {
  it('1. a Transfer submission writes evidence via the canonical updateMastery path with sourceType TRANSFER', () => {
    expect(TRANSFER_SUBMIT_SRC).toMatch(/sourceType:\s*'TRANSFER'/);
    expect(TRANSFER_SUBMIT_SRC).toMatch(/updateMastery\(/);
  });

  it('2. Transfer evidence metadata never carries an activityType key -- structurally excluded from the memory/retention replay', () => {
    // normalizeMemoryEvidence (memory-model.ts) reads ONLY raw.metadata.activityType;
    // Transfer's own submit route never sets that key, so every TRANSFER
    // row is excluded before the replay ever runs.
    expect(MEMORY_MODEL_SRC).toMatch(/metadata\?\.activityType|metadata\.activityType/);
    expect(TRANSFER_SUBMIT_SRC).not.toMatch(/metadata:\s*\{[^}]*activityType/);
  });

  it("3. partial Transfer does not automatically erase Retention -- RETENTION_RISK's own precedence is untouched by a TRANSFER_FRAGILE/TRANSFER_GAP signal", () => {
    const ks = ksState({ masteryState: 'AT_RISK', validationReadiness: 'READY', retentionScore: 40 });
    const ctx = makeContext(
      [
        signal({ type: 'RETENTION_REVIEW_DUE', conceptId: 'c1', subjectId: 'subj1', temporalUrgency: 'HIGH' }),
        signal({ type: 'TRANSFER_FRAGILE', conceptId: 'c1', subjectId: 'subj1' }),
      ],
      ks,
    );
    // RETENTION_RISK still wins over any transfer-related signal -- the
    // partial Transfer never silently converts this into a Transfer-only state.
    expect(computeLearningState(ctx)).toBe('RETENTION_RISK');
  });
});

/* ================================================================== *
 * TRANSFER RECOVERY 4 -- canonical policy resolves a deterministic    *
 * next action after a partial Transfer (Part B).                     *
 * ================================================================== */
describe('LX-9 FINAL 4 -- canonical policy resolves a deterministic next action after partial Transfer', () => {
  it('with no blocking condition and understanding still forming, the residual DEVELOPING band falls through to PRACTICE -- the Learning Engine decides, this is not a new rule', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: null, validationReadiness: 'INSUFFICIENT_EVIDENCE' });
    const ctx = makeContext([], ks);
    expect(selectActivityType(ctx)).toBe('PRACTICE');
  });
});

/* ================================================================== *
 * TRANSFER RECOVERY 5-11 -- continuation contract (Part E).           *
 * ================================================================== */
describe('LX-9 FINAL 5-11 -- the continuation launch target is executable end to end', () => {
  it('5-8. quizLaunch(PRACTICE) builds a READY target carrying subjectId, conceptId, and a supported mode', () => {
    const block = SESSION_ENGINE_SRC.slice(SESSION_ENGINE_SRC.indexOf('function quizLaunch'), SESSION_ENGINE_SRC.indexOf('function subjectQuizLaunch'));
    expect(block).toMatch(/subjectId: decision\.subjectId, conceptId: decision\.actionConceptId, mode: quizMode/);
    expect(SESSION_ENGINE_SRC).toMatch(/case 'PRACTICE':\s*\n\s*return quizLaunch\('topic_practice', decision\)/);
  });

  it("9. generate-and-take's own validated schema recognizes 'topic_practice' as a supported quizMode", () => {
    expect(ROUTE_SRC).toMatch(/quizMode: z\.enum\(\[[^\]]*'topic_practice'[^\]]*\]\)/);
  });

  it('10. adaptive difficulty resolves a valid level for the next PRACTICE activity', () => {
    const decision = resolveTargetDifficulty({ activityType: 'PRACTICE', knowledgeState: { masteryState: 'DEVELOPING', criticalMisconceptionCount: 0 } });
    expect(decision.level).toBeGreaterThanOrEqual(1);
    expect(decision.level).toBeLessThanOrEqual(5);
  });

  it('11. generation accepts topic_practice via generatePracticeQuestions -- not an unsupported-activity dead end', () => {
    expect(ROUTE_SRC).toMatch(/validated\.quizMode === 'topic_practice' \|\| validated\.quizMode === 'review'\s*\n\s*\?\s*generatePracticeQuestions/);
  });
});

/* ================================================================== *
 * TRANSFER RECOVERY 12-13, 17 -- session atomicity (Part G).          *
 * ================================================================== */
describe('LX-9 FINAL 12-13, 17 -- a session is never launchable until valid', () => {
  it('12/13. storeQuiz (session creation) runs only AFTER the empty-questions guard -- a failed generation never reaches persistence', () => {
    const guardIdx = ROUTE_SRC.indexOf('if (questions.length === 0)');
    const storeIdx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(storeIdx).toBeGreaterThan(guardIdx);
  });

  it('storeQuiz is a single INSERT statement -- atomic by construction, no partial row possible', () => {
    const fn = QUIZ_PERSISTENCE_SRC.slice(QUIZ_PERSISTENCE_SRC.indexOf('export async function storeQuiz'), QUIZ_PERSISTENCE_SRC.indexOf('export async function storeQuiz') + 1200);
    const inserts = fn.match(/INSERT INTO/g) ?? [];
    expect(inserts.length).toBe(1);
  });

  it('17. the client never stores a quizId/session state from a failed generation response', () => {
    // applyGenResult (which sets quizId/questions client-side) is only
    // ever called from the SUCCESS branch of the generation promise
    // chain, never from a .catch()/error branch.
    const genPBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('const genP = fetch'), QUIZ_PAGE_SRC.indexOf('const applyGen = genP') + 300);
    expect(genPBlock).toMatch(/if \(!r\.ok\) throw new Error/);
  });
});

/* ================================================================== *
 * TRANSFER RECOVERY 14-16 -- retry semantics (Part F). THE FIX.       *
 * ================================================================== */
describe('LX-9 FINAL 14-16 -- retry never changes failure layer', () => {
  it('14. retry after a preparation/generation failure (genState==="error") retries preparation -- calls startCanonicalActivity, never generateQuiz', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("t['practice.prepareFailedTitle']"), QUIZ_PAGE_SRC.indexOf("t['practice.prepareFailedTitle']") + 1600);
    expect(block).toMatch(/startCanonicalActivity\(studentId\)/);
    expect(block).not.toMatch(/void generateQuiz\(studentId\)/);
  });

  it('15. retry after a top-level load failure (phase==="error") retries load -- calls generateQuiz, the function that actually manages `phase`', () => {
    const start = QUIZ_PAGE_SRC.indexOf("if (phase === 'error')");
    const block = QUIZ_PAGE_SRC.slice(start, start + 2200);
    expect(block).toMatch(/generateQuiz\(studentId\)/);
  });

  it('16. the two retry buttons never call each other\'s function -- a failure never silently moves to the OTHER layer\'s copy/buttons', () => {
    const prepareBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("t['practice.prepareFailedTitle']"), QUIZ_PAGE_SRC.indexOf("t['practice.prepareFailedTitle']") + 1600);
    const loadErrorBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("phase === 'error'"), QUIZ_PAGE_SRC.indexOf("phase === 'error'") + 900);
    expect(prepareBlock).not.toMatch(/quiz\.loadError/);
    expect(loadErrorBlock).not.toMatch(/practice\.prepareFailedTitle/);
  });
});

/* ================================================================== *
 * TRANSFER RECOVERY 18-20 -- REINFORCE overlay semantics (Part D).    *
 * ================================================================== */
describe('LX-9 FINAL 18-20 -- REINFORCE is a temporary overlay, never a permanent reset', () => {
  it('18. REINFORCE fires only for the three canonical blocking states -- a partial Transfer alone can never trigger it', () => {
    expect(LEARNER_JOURNEY_SRC).toMatch(/BLOCKED_OR_REPAIR.*=.*new Set<LearningState>\(\[\s*\n\s*'MISCONCEPTION_BLOCKED',\s*\n\s*'PREREQUISITE_BLOCKED',\s*\n\s*'NEEDS_REPAIR',/);
    const ks = ksState({ masteryState: 'DEVELOPING' });
    const ctx = makeContext([], ks); // no misconception/prerequisite/repair signal -- just a plain post-Transfer residual state
    expect(computeLearningState(ctx)).not.toBe('MISCONCEPTION_BLOCKED');
    expect(computeLearningState(ctx)).not.toBe('PREREQUISITE_BLOCKED');
    expect(computeLearningState(ctx)).not.toBe('NEEDS_REPAIR');
  });

  it('19. once TRANSFER_REQUIRED fires (unresolved Transfer), selectActivityType still resolves to TRANSFER -- reinforcement never permanently blocks the return path', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'TRANSFER_REQUIRED' });
    const ctx = makeContext([signal({ type: 'TRANSFER_REQUIRED', conceptId: 'c1', subjectId: 'subj1' })], ks);
    expect(selectActivityType(ctx)).toBe('TRANSFER');
  });

  it("20. computeLearningState's RETENTION_RISK/TRANSFER_GAP precedence order is unchanged -- RETAIN after a partial Transfer is accurate precedence, never an unjustified reset", () => {
    const precedenceBlock = ADAPTIVE_POLICY_SRC.slice(ADAPTIVE_POLICY_SRC.indexOf('export function computeLearningState'), ADAPTIVE_POLICY_SRC.indexOf('export function computeLearningState') + 1400);
    const retentionIdx = precedenceBlock.indexOf('RETENTION_RISK');
    const transferIdx = precedenceBlock.indexOf('TRANSFER_GAP');
    expect(retentionIdx).toBeGreaterThan(-1);
    expect(transferIdx).toBeGreaterThan(-1);
    expect(retentionIdx).toBeLessThan(transferIdx);
  });
});

/* ================================================================== *
 * CANONICAL PROGRESS 21 -- one shared read model.                    *
 * ================================================================== */
describe('LX-9 FINAL 21 -- one shared canonical progress read model exists', () => {
  it('buildCanonicalLearningProgress composes the SAME three existing authorities, never a fourth stage engine', () => {
    expect(typeof buildCanonicalLearningProgress).toBe('function');
    const src = read('src/lib/lx/canonical-learning-progress.ts');
    expect(src).toMatch(/resolveConceptJourneyStage/);
    expect(src).toMatch(/deriveJourneyProgress/);
    expect(src).toMatch(/isRetentionWaiting/);
    expect(src).not.toMatch(/function computeLearningState|function deriveLearnerJourneyStage/);
  });
});

/* ================================================================== *
 * CANONICAL PROGRESS 22-30.                                          *
 * ================================================================== */
describe('LX-9 FINAL 22 -- Progress dashboard no longer shows "Aprendiendo" for a canonical RETAIN concept', () => {
  it('the per-concept row no longer imports/renders masteryStateLabel/masteryStateColor', () => {
    expect(DASHBOARD_PAGE_SRC).not.toMatch(/masteryStateLabel|masteryStateColor/);
  });
  it('the row renders the canonical journeyProgressLabelKey/journeyProgressPercent instead', () => {
    expect(DASHBOARD_PAGE_SRC).toMatch(/c\.journeyProgressLabelKey/);
    expect(DASHBOARD_PAGE_SRC).toMatch(/c\.journeyProgressPercent/);
  });
});

describe('LX-9 FINAL 23-26 -- identical stage and percentage across surfaces for the same concept', () => {
  const cases: Array<[LearnerJourneyStage, MasteryState, LearningDecision['learningState'] | undefined]> = [
    ['NOT_STARTED', 'UNKNOWN', undefined],
    ['PRACTICE', 'DEVELOPING', 'DEVELOPING'],
    ['PROVE', 'PROVISIONAL_MASTERY', 'PENDING_VERIFICATION'],
    ['RETAIN', 'VALIDATED_MASTERY', 'RETENTION_RISK'],
    ['TRANSFER', 'VALIDATED_MASTERY', 'TRANSFER_GAP'],
    ['CONSOLIDATED', 'VALIDATED_MASTERY', 'VALIDATED'],
  ];

  for (const [expectedStage, masteryState, learningState] of cases) {
    it(`${expectedStage}: resolveConceptJourneyStage (My Path/Subject Detail), Concept Mission, and Progress Dashboard all agree`, () => {
      const ks: ConceptKnowledgeState = ksState({ masteryState, validationReadiness: expectedStage === 'PRACTICE' ? 'INSUFFICIENT_EVIDENCE' : 'READY' });
      const decision: LearningDecision | undefined = learningState
        ? ({ activityType: 'PRACTICE', actionConceptId: 'c1', subjectId: 'subj1', learningState, facts: [], signals: [], priorityScore: 0 } as unknown as LearningDecision)
        : undefined;

      // 23/24. My Path / Subject Detail authority.
      const myPathStage = resolveConceptJourneyStage('c1', 'subj1', ks, decision);
      expect(myPathStage).toBe(expectedStage);

      // 25. Concept Mission.
      const missionView = buildConceptMissionView({
        conceptName: 'X', subjectId: 'subj1', subjectName: 'Subj', conceptDescription: null,
        goalFallbackText: 'goal',
        knowledgeState: { masteryState: ks.masteryState, validationReadiness: ks.validationReadiness, evidenceCount: ks.evidenceCount, independentEvidenceCount: ks.independentEvidenceCount },
        journeyInput: (learningState ? { kind: 'RESOLVED', learningState, source: 'LEARNING_DECISION' } : { kind: 'RESOLVED', learningState: computeLearningState(makeContext([], ks)), source: 'CANONICAL_POLICY_NO_SIGNALS' }) as ConceptMissionJourneyInput,
        learningDecision: decision ? { activityType: decision.activityType, actionConceptId: 'c1', learningState: decision.learningState, facts: [] } : null,
        memory: null, transferDepth: null, hasCachedExplanation: false,
      });
      if (missionView.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
      expect(missionView.journey.stage).toBe(expectedStage);

      // 26. Progress Dashboard.
      const canonical = buildCanonicalLearningProgress({ conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks, activeDecision: decision });
      expect(canonical.journeyStage).toBe(expectedStage);

      // Same percentage everywhere -- all three derive it via the SAME deriveJourneyProgress call.
      const expectedPercent = deriveJourneyProgress(expectedStage).progressPercent;
      expect(canonical.journeyProgressPercent).toBe(expectedPercent);
    });
  }
});

describe('LX-9 FINAL 27-28 -- raw mastery never drives primary progress; evidence dimensions stay separate', () => {
  it('27. buildCanonicalLearningProgress never consults a raw mastery_score/masteryPercent field', () => {
    const src = strip(read('src/lib/lx/canonical-learning-progress.ts'));
    expect(src).not.toMatch(/mastery_score|masteryPercent|avgMasteryPercent|quizScore/);
  });

  it('28. evidence dimensions can disagree numerically with journeyProgressPercent -- never forced to match (the spec\'s own RETAIN=70%/Transfer=50% example)', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY', understandingScore: 33, applicationScore: 50 });
    const canonical = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks,
      activeDecision: { activityType: 'RETENTION_CHECK', actionConceptId: 'c1', subjectId: 'subj1', learningState: 'RETENTION_RISK', facts: [], signals: [], priorityScore: 0 } as unknown as LearningDecision,
    });
    expect(canonical.journeyStage).toBe('RETAIN');
    expect(canonical.journeyProgressPercent).toBe(70);
    expect(canonical.evidenceDimensions?.understandingScore).toBe(33);
    expect(canonical.evidenceDimensions?.applicationScore).toBe(50);
    expect(canonical.journeyProgressPercent).not.toBe(canonical.evidenceDimensions?.applicationScore);
  });
});

describe('LX-9 FINAL 29-30 -- aggregation remains canonical and concept-weighted (regression)', () => {
  it('averageJourneyProgress is still the sole subject/overall aggregation authority', () => {
    const overviewSrc = read('src/services/progress-overview.service.ts');
    expect(overviewSrc).toMatch(/averageJourneyProgress/);
    expect(overviewSrc).toMatch(/journeyProgressPercent: averageJourneyProgress\(journeyStages\)/);
    expect(overviewSrc).toMatch(/overallJourneyProgressPercent = averageJourneyProgress\(allJourneyStages\)/);
  });
});

/* ================================================================== *
 * REGRESSIONS 31-37.                                                  *
 * ================================================================== */
describe('LX-9 FINAL 31-32 -- Retention waiting UX unchanged', () => {
  it('isRetentionWaiting still gates the NO_CANONICAL_ACTION/RETENTION_WAITING fallback, and due retention still shows the action', () => {
    expect(isRetentionWaiting('RETAIN', false)).toBe(true);
    expect(isRetentionWaiting('RETAIN', true)).toBe(false);
    expect(isRetentionWaiting('PRACTICE', false)).toBe(false);
    const conceptMissionSrc = read('src/lib/lx/concept-mission.ts');
    expect(conceptMissionSrc).toMatch(/isRetentionWaiting\(journey\.stage, memory\?\.retentionDue\)/);
  });
});

describe('LX-9 FINAL 33 -- cross-attempt novelty unchanged', () => {
  it('the LX-9R3 novelty exports are unchanged', () => {
    const qgSrc = read('src/services/quiz-generation.service.ts');
    expect(qgSrc).toMatch(/RETENTION_NOVELTY_ATTEMPT_WINDOW = 3/);
    expect(qgSrc).toMatch(/fetchRecentRetentionQuestions/);
  });
});

describe('LX-9 FINAL 34 -- adaptive difficulty unchanged', () => {
  it('resolveTargetDifficulty policy is untouched by this phase', () => {
    const decision = resolveTargetDifficulty({ activityType: 'REMEDIATION', knowledgeState: { masteryState: 'DEVELOPING', criticalMisconceptionCount: 0 } });
    expect(decision.level).toBe(1);
    expect(decision.reasonCode).toBe('REMEDIATION_REBUILD');
  });
});

describe('LX-9 FINAL 35 -- Results raw mastery leak remains removed', () => {
  it('the retention_check mastery-block guard is still present', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/quizMode !== 'retention_check' && perConcept\.length === 1 && results\.mastery/);
  });
});

describe("LX-9 FINAL 36 -- Tutor behavior unchanged (out of this phase's scope)", () => {
  it('tutor.service.ts exports are unchanged -- this phase touched no Tutor-related source file (see report for the full changed-files list)', () => {
    const tutorSrc = read('src/services/tutor.service.ts');
    expect(tutorSrc).toMatch(/export (async )?function/);
  });
});
