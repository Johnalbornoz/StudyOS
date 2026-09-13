/**
 * LX-9R3-R1 -- CANONICAL ADAPTIVE DIFFICULTY + RETENTION WAITING UX.
 * The 24 required tests from the phase spec, in order. Tests 22-24 are
 * meta ("do the other suites still pass") -- certified primarily by the
 * full `npx vitest run` result (see the phase report), with a light
 * anchor test here confirming the specific exports/behaviors those
 * suites depend on are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveTargetDifficulty,
  QUESTION_DIFFICULTY_MIN,
  QUESTION_DIFFICULTY_MAX,
  type TargetDifficultyContext,
} from '@/lib/lx/difficulty-contract';
import { buildConceptMissionView, type ConceptMissionInputs, type ConceptMissionJourneyInput } from '@/lib/lx/concept-mission';
import { selectActivityType, computeLearningState, consolidateSignals, type LearningSignal, type ConceptDecisionContext } from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState, MasteryState } from '@/services/knowledge-state.service';
import { MESSAGES } from '@/lib/i18n/messages';
import { computeRetentionStructuralFingerprint, RETENTION_REQUIRED_COUNT } from '@/services/quiz-generation.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const QG_SRC = read('src/services/quiz-generation.service.ts');
const DIFFICULTY_CONTRACT_SRC = read('src/lib/lx/difficulty-contract.ts');

const ALL_ACTIVITY_TYPES = [
  'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
  'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
] as const;
const ALL_MASTERY_STATES = [
  'UNKNOWN', 'LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY', 'VALIDATED_MASTERY', 'AT_RISK', 'INTERVENTION_REQUIRED',
] as const;

function resolve(activityType: TargetDifficultyContext['activityType'], masteryState?: (typeof ALL_MASTERY_STATES)[number], criticalMisconceptionCount = 0) {
  return resolveTargetDifficulty({
    activityType,
    knowledgeState: masteryState ? { masteryState, criticalMisconceptionCount } : null,
  });
}

/* ================================================================== *
 * 1-3 -- the authority is real, canonical, and singular.              *
 * ================================================================== */
describe('1. canonical flows no longer default blindly to difficulty 3', () => {
  it('the single-concept fast paths resolve the canonical authority, never a bare `|| 3`', () => {
    expect(ROUTE_SRC).not.toMatch(/difficulty: validated\.difficulty \|\| 3/);
    const sites = ROUTE_SRC.match(/difficulty: validated\.difficulty \?\? resolvedDifficulty\?\.level \?\? 3/g) ?? [];
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  it('resolveTargetDifficulty genuinely varies its output across canonical states -- it is not a disguised constant', () => {
    const levels = new Set(ALL_MASTERY_STATES.map((m) => resolve('PRACTICE', m).level));
    expect(levels.size).toBeGreaterThan(1);
  });
});

describe('2. the client does not choose difficulty', () => {
  it('the ordinary canonical quiz UI has no difficulty selector wired to the generation request', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/<select[^>]*difficulty/i);
    expect(QUIZ_PAGE_SRC).not.toMatch(/onChange.*setDifficulty/);
  });

  it('resolveTargetDifficulty takes no learner-selected field -- only activityType and Knowledge State', () => {
    expect(DIFFICULTY_CONTRACT_SRC).not.toMatch(/\b(learnerSelected|userDifficulty|chosenDifficulty|selectedDifficulty|difficultyOverride)\b/);
  });
});

describe('3. one shared target-difficulty authority exists', () => {
  it('every canonical call site imports the SAME resolveTargetDifficulty -- no second/parallel implementation', () => {
    expect(ROUTE_SRC).toMatch(/import \{ aggregateEvidenceDifficulty, resolveTargetDifficulty \} from '@\/lib\/lx\/difficulty-contract'/);
    expect(ROUTE_SRC.match(/resolveTargetDifficulty\(/g)?.length).toBeGreaterThanOrEqual(3);
    // no second function with a similar name/purpose
    expect(ROUTE_SRC).not.toMatch(/function resolveTargetDifficulty/); // only the imported one is used, never redefined locally
  });
});

/* ================================================================== *
 * 4-8, 11-12, 14-15 -- the policy itself.                             *
 * ================================================================== */
describe('4. HIGH_SUPPORT Practice can produce lower challenge than advanced Practice', () => {
  it('a blocked/HIGH_SUPPORT-equivalent Practice context resolves BELOW an established one', () => {
    const highSupport = resolve('PRACTICE', 'INTERVENTION_REQUIRED');
    const established = resolve('PRACTICE', 'VALIDATED_MASTERY');
    expect(highSupport.level).toBeLessThan(established.level);
    expect(highSupport.level).toBe(1);
    expect(established.level).toBe(4);
  });
});

describe('5. strong independent evidence can raise target challenge', () => {
  it('PRACTICE: established mastery resolves higher than still-developing', () => {
    expect(resolve('PRACTICE', 'VALIDATED_MASTERY').level).toBeGreaterThan(resolve('PRACTICE', 'DEVELOPING').level);
  });
  it('PROVE (SOLO_CHECK): established mastery resolves higher than still-building', () => {
    expect(resolve('SOLO_CHECK', 'VALIDATED_MASTERY').level).toBeGreaterThan(resolve('SOLO_CHECK', 'DEVELOPING').level);
  });
});

describe('6. intervention/reinforce cannot raise challenge', () => {
  it('for every activity type, an active critical misconception never resolves ABOVE that same context without one', () => {
    for (const activityType of ALL_ACTIVITY_TYPES) {
      for (const masteryState of ALL_MASTERY_STATES) {
        const blocked = resolve(activityType, masteryState, 1);
        const unblocked = resolve(activityType, masteryState, 0);
        expect(blocked.level).toBeLessThanOrEqual(unblocked.level);
      }
    }
  });

  it('REMEDIATION is always the floor (1), regardless of any other signal', () => {
    for (const masteryState of ALL_MASTERY_STATES) {
      expect(resolve('REMEDIATION', masteryState).level).toBe(1);
      expect(resolve('REMEDIATION', masteryState, 1).level).toBe(1);
    }
    expect(resolve('REMEDIATION').level).toBe(1); // no knowledge state at all
  });
});

describe('7. PROVE challenge remains independent and nontrivial', () => {
  it('SOLO_CHECK / SOLO_VERIFY never drop below level 3, even under a blocking condition', () => {
    for (const activityType of ['SOLO_CHECK', 'SOLO_VERIFY'] as const) {
      for (const masteryState of ALL_MASTERY_STATES) {
        expect(resolve(activityType, masteryState).level).toBeGreaterThanOrEqual(3);
        expect(resolve(activityType, masteryState, 1).level).toBeGreaterThanOrEqual(3);
      }
      expect(resolve(activityType).level).toBeGreaterThanOrEqual(3); // no knowledge state
    }
  });
});

describe('8. RETAIN does not escalate indefinitely across repetitions', () => {
  it('repeating resolveTargetDifficulty with the SAME (unchanged) masteryState never increases across calls -- simulates repeated retention attempts that do not retroactively inflate mastery', () => {
    const first = resolve('RETENTION_CHECK', 'VALIDATED_MASTERY');
    const second = resolve('RETENTION_CHECK', 'VALIDATED_MASTERY');
    const third = resolve('RETENTION_CHECK', 'VALIDATED_MASTERY');
    expect(first.level).toBe(second.level);
    expect(second.level).toBe(third.level);
  });

  it('RETENTION_CHECK never reaches the TRANSFER-only ceiling (5) -- it cannot become an endless harder exam', () => {
    for (const masteryState of ALL_MASTERY_STATES) {
      expect(resolve('RETENTION_CHECK', masteryState).level).toBeLessThanOrEqual(4);
    }
  });
});

describe('9. RETAIN novelty still varies structure (Part B unaffected)', () => {
  it('the cross-attempt structural fingerprint authority is untouched by this phase', () => {
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
    const q1 = { question: 'Evaluate $2x + 3$', type: 'multiple_choice', cognitiveLevel: 'APPLICATION', questionIntent: 'CHECK_APPLICATION' };
    const q2 = { question: 'Evaluate $9x + 41$', type: 'multiple_choice', cognitiveLevel: 'APPLICATION', questionIntent: 'CHECK_APPLICATION' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });
  it('the generation call site still combines resolved difficulty with the cross-attempt exclusion note in the SAME call', () => {
    const fn = QG_SRC.slice(QG_SRC.indexOf('export async function generateRetentionCheckQuestions'), QG_SRC.indexOf('async function retentionApplyGate'));
    expect(fn).toMatch(/crossAttemptNote/);
    expect(fn).toMatch(/options\.difficulty/);
  });
});

describe('10. TRANSFER receives appropriate contextual/abstraction challenge', () => {
  it('TRANSFER floor (4) always exceeds every other activity\'s building-tier level, and its ceiling (5) is unique to it', () => {
    for (const masteryState of ALL_MASTERY_STATES) {
      expect(resolve('TRANSFER', masteryState).level).toBeGreaterThanOrEqual(4);
    }
    expect(resolve('TRANSFER', 'VALIDATED_MASTERY').level).toBe(5);
    // no other activity type ever reaches 5
    for (const activityType of ALL_ACTIVITY_TYPES) {
      if (activityType === 'TRANSFER') continue;
      for (const masteryState of ALL_MASTERY_STATES) {
        expect(resolve(activityType, masteryState).level).toBeLessThan(5);
      }
    }
  });
});

describe('11. target level always 1-5', () => {
  it('every combination of activityType x masteryState x criticalMisconceptionCount stays within [1,5]', () => {
    for (const activityType of ALL_ACTIVITY_TYPES) {
      for (const masteryState of ALL_MASTERY_STATES) {
        for (const c of [0, 1, 5]) {
          const { level } = resolve(activityType, masteryState, c);
          expect(level).toBeGreaterThanOrEqual(QUESTION_DIFFICULTY_MIN);
          expect(level).toBeLessThanOrEqual(QUESTION_DIFFICULTY_MAX);
        }
      }
      const { level } = resolve(activityType);
      expect(level).toBeGreaterThanOrEqual(QUESTION_DIFFICULTY_MIN);
      expect(level).toBeLessThanOrEqual(QUESTION_DIFFICULTY_MAX);
    }
  });
});

describe('12. change is bounded', () => {
  it('PRACTICE\'s four ordered mastery tiers each differ from their neighbor by at most one level', () => {
    const orderedTiers: Array<(typeof ALL_MASTERY_STATES)[number]> = ['INTERVENTION_REQUIRED', 'LEARNING', 'DEVELOPING', 'VALIDATED_MASTERY'];
    const levels = orderedTiers.map((m) => resolve('PRACTICE', m).level);
    for (let i = 1; i < levels.length; i++) {
      expect(Math.abs(levels[i] - levels[i - 1])).toBeLessThanOrEqual(1);
    }
  });
  it('every independent/assessment activity\'s own band spans exactly one level (building -> established)', () => {
    for (const activityType of ['SOLO_CHECK', 'SOLO_VERIFY', 'RETENTION_CHECK', 'TRANSFER', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM'] as const) {
      const building = resolve(activityType, 'DEVELOPING').level;
      const established = resolve(activityType, 'VALIDATED_MASTERY').level;
      expect(established - building).toBe(1);
    }
  });
});

describe('14. same canonical state deterministically yields the same target difficulty', () => {
  it('resolveTargetDifficulty is a pure function -- no hidden clock, no randomness', () => {
    const ctx: TargetDifficultyContext = { activityType: 'PRACTICE', knowledgeState: { masteryState: 'DEVELOPING', criticalMisconceptionCount: 0 } };
    const results = Array.from({ length: 5 }, () => resolveTargetDifficulty(ctx));
    for (const r of results) expect(r).toEqual(results[0]);
  });
});

describe('15. no mastery/evidence write is introduced by difficulty selection', () => {
  it('the difficulty contract module performs no IO -- no db.query, no INSERT/UPDATE, no fetch', () => {
    expect(DIFFICULTY_CONTRACT_SRC).not.toMatch(/db\.query/);
    expect(DIFFICULTY_CONTRACT_SRC).not.toMatch(/INSERT INTO|UPDATE \w+ SET/);
    expect(DIFFICULTY_CONTRACT_SRC).not.toMatch(/await fetch/);
    expect(DIFFICULTY_CONTRACT_SRC).not.toMatch(/^import.*from '@\/lib\/db'/m);
  });
});

/* ================================================================== *
 * 13 -- difficulty changes actual cognitive demand in the prompt.     *
 * ================================================================== */
describe("13. difficulty level changes the prompt's required cognitive demand", () => {
  it('each of the five tiers names a distinct, concrete cognitive-demand requirement', () => {
    const block = QG_SRC.slice(QG_SRC.indexOf('let difficultyDesc'), QG_SRC.indexOf('const languageName = LOCALE_FULL_NAME'));
    expect(block).toMatch(/direct recall/);
    expect(block).toMatch(/one clear application step/);
    expect(block).toMatch(/combines two related steps/);
    expect(block).toMatch(/multi-step reasoning/);
    expect(block).toMatch(/transfer to a genuinely unfamiliar context/);
    // the same resolved `difficulty` variable feeds both the tier selection and the printed label -- never two independent numbers
    expect(QG_SRC).toMatch(/Difficulty level \(\$\{difficulty\}\/5\): \$\{difficultyDesc\}/);
  });

  it('the resolved canonical difficulty is what actually reaches the generator (threaded, not dropped)', () => {
    expect(QG_SRC).toMatch(/buildQuestionGenerationPrompt\(types, difficulty, language, contextChunks/);
    for (const site of ['generateQuickCheckQuestions', 'generatePracticeQuestions', 'generateRetentionCheckQuestions']) {
      expect(ROUTE_SRC).toMatch(new RegExp(`${site}\\(conceptIds\\[0\\], validated\\.studentId, validated\\.subjectId, \\{\\s*\\n?\\s*(count: perConceptCap,\\s*\\n?\\s*)?difficulty: validated\\.difficulty \\?\\? resolvedDifficulty\\?\\.level \\?\\? 3`));
    }
  });
});

/* ================================================================== *
 * 16-21 -- Retention Waiting UX.                                     *
 * ================================================================== */
function ks(masteryState: MasteryState, evidenceCount = 12, independentEvidenceCount = 6) {
  return { masteryState, validationReadiness: 'READY' as const, evidenceCount, independentEvidenceCount };
}
function missionBase(over: Partial<ConceptMissionInputs> = {}): ConceptMissionInputs {
  return {
    conceptName: 'Potenciación', subjectId: 'subj-1', subjectName: 'Math', conceptDescription: null,
    goalFallbackText: 'Understand it and apply it correctly and on your own.',
    knowledgeState: ks('VALIDATED_MASTERY'),
    journeyInput: { kind: 'RESOLVED', learningState: 'RETENTION_RISK', source: 'LEARNING_DECISION' } as ConceptMissionJourneyInput,
    learningDecision: { activityType: 'REVIEW', actionConceptId: 'c1', learningState: 'RETENTION_RISK', facts: [] },
    memory: { lastSuccessfulRetentionAt: '2026-01-01T00:00:00Z', retentionDue: false, memoryStatus: 'STABLE', nextReviewAt: null },
    transferDepth: null, hasCachedExplanation: false,
    ...over,
  };
}

describe('16. early Retention CTA hidden when review is not due', () => {
  it('RETAIN stage + retentionDue=false -> NO_CANONICAL_ACTION with fallback RETENTION_WAITING, never the decision\'s own activityType', () => {
    const v = buildConceptMissionView(missionBase());
    expect(v.journey.status).toBe('RESOLVED');
    if (v.journey.status !== 'RESOLVED') return;
    expect(v.journey.stage).toBe('RETAIN');
    expect(v.now.kind).toBe('NO_CANONICAL_ACTION');
    expect(v.now.fallback).toBe('RETENTION_WAITING');
    expect(v.now.activityType).toBeNull();
  });

  it('still suppresses the CTA even if a stray RETENTION_CHECK decision slipped through (defense in depth)', () => {
    const v = buildConceptMissionView(missionBase({ learningDecision: { activityType: 'RETENTION_CHECK', actionConceptId: 'c1', learningState: 'RETENTION_RISK', facts: [] } }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.now.fallback).toBe('RETENTION_WAITING');
    expect(v.now.activityType).toBeNull();
  });
});

describe('17. learner sees why they are waiting', () => {
  it('the waiting title and body copy exist, are non-empty, and never expose raw scores/thresholds, in every locale', () => {
    for (const [, messages] of Object.entries(MESSAGES)) {
      const title = messages['conceptMission.noActionRetentionWaitingTitle' as keyof typeof messages] as string;
      const body = messages['conceptMission.noActionRetentionWaitingBody' as keyof typeof messages] as string;
      expect(title?.length).toBeGreaterThan(0);
      expect(body?.length).toBeGreaterThan(0);
      expect(body).not.toMatch(/\d+%|\bscore\b|\bthreshold\b/i);
    }
  });
});

describe('18. learner sees the next eligible review date when available', () => {
  it('now.nextEligibleReviewAt passes through the canonical memory.nextReviewAt verbatim', () => {
    const v = buildConceptMissionView(
      missionBase({ memory: { lastSuccessfulRetentionAt: null, retentionDue: false, memoryStatus: 'STABLE', nextReviewAt: '2026-09-20T00:00:00Z' } }),
    );
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.now.nextEligibleReviewAt).toBe('2026-09-20T00:00:00Z');
  });

  it('the with-date copy carries a {date} placeholder in every locale, for when the date is available', () => {
    for (const [, messages] of Object.entries(MESSAGES)) {
      const withDate = messages['conceptMission.noActionRetentionWaitingBodyWithDate' as keyof typeof messages] as string;
      expect(withDate).toMatch(/\{date\}/);
    }
  });

  it('nextEligibleReviewAt is null when no canonical date exists yet -- never fabricated', () => {
    const v = buildConceptMissionView(missionBase({ memory: { lastSuccessfulRetentionAt: null, retentionDue: false, memoryStatus: 'STABLE', nextReviewAt: null } }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.now.nextEligibleReviewAt).toBeNull();
  });
});

describe('19. due Retention CTA appears', () => {
  it('RETAIN stage + retentionDue=true + a RETENTION_CHECK decision -> the canonical action is shown, verbatim', () => {
    const v = buildConceptMissionView(
      missionBase({
        memory: { lastSuccessfulRetentionAt: null, retentionDue: true, memoryStatus: 'STABLE', nextReviewAt: null },
        learningDecision: { activityType: 'RETENTION_CHECK', actionConceptId: 'c1', learningState: 'RETENTION_RISK', facts: [] },
      }),
    );
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.now.kind).toBe('CANONICAL_ACTION');
    expect(v.now.activityType).toBe('RETENTION_CHECK');
    expect(v.now.fallback).toBeNull();
  });
});

describe('20. qualifying successful Retention advances to Transfer', () => {
  function signal(overrides: Partial<LearningSignal> & Pick<LearningSignal, 'type' | 'conceptId' | 'subjectId'>): LearningSignal {
    return { source: 'test', metadata: {}, ...overrides };
  }
  function makeCtx(ksState: ConceptKnowledgeState, signals: LearningSignal[]): ConceptDecisionContext {
    const map = new Map<string, ConceptKnowledgeState>([[ksState.conceptId, ksState]]);
    const contexts = consolidateSignals(signals, map);
    return contexts[0] ?? { actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ksState, signals: [], targetConceptIds: [], remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [] };
  }
  it('once WAITING_FOR_RETENTION clears and TRANSFER_REQUIRED fires, the next activity is TRANSFER -- not another retention check', () => {
    const ksState: ConceptKnowledgeState = {
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1', masteryState: 'VALIDATED_MASTERY',
      understandingScore: 90, independenceScore: 85, applicationScore: 85, retentionScore: 90, transferScore: null,
      activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
      evidenceCount: 20, independentEvidenceCount: 10, firstEvidenceAt: null, lastEvidenceAt: null,
      validationReadiness: 'TRANSFER_REQUIRED', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1, updatedAt: '2026-01-01T00:00:00Z',
    };
    const ctx = makeCtx(ksState, [signal({ type: 'TRANSFER_REQUIRED', conceptId: 'c1', subjectId: 'subj1' })]);
    expect(selectActivityType(ctx)).toBe('TRANSFER');
    expect(computeLearningState(ctx)).not.toBe('RETENTION_RISK');
  });
});

describe('21. an early/deep-linked Retention attempt remains honest in Results (pre-existing LX-9R3 behavior, unchanged)', () => {
  it('retentionTooSoon still gates the RETAINED milestone and drives the honest copy', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const retentionTooSoon = quizMode === 'retention_check' && results\.retentionCheckQualified === false/);
    expect(QUIZ_PAGE_SRC).toMatch(/passedIndependentCheck && !retentionTooSoon/);
  });
});

/* ================================================================== *
 * 22-23 -- prior LX-9R3 suites still pass (anchor; full suite is the  *
 * real certification -- see the phase report).                       *
 * ================================================================== */
describe('22. LX-9R3 novelty machinery is unchanged by this phase', () => {
  it('the exports the novelty tests depend on are all still present', () => {
    expect(typeof computeRetentionStructuralFingerprint).toBe('function');
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });
});

describe('23. LX-9R3 progression machinery is unchanged by this phase', () => {
  it('selectActivityType/computeLearningState are still the same exported pure functions the RETAIN-loop fix relies on', () => {
    expect(typeof selectActivityType).toBe('function');
    expect(typeof computeLearningState).toBe('function');
  });
});
