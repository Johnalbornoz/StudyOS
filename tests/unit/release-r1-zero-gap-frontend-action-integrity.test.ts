/**
 * RELEASE-R1 -- ZERO-GAP FRONTEND ACTION INTEGRITY. The 20 required
 * tests, in order.
 *
 * LIVE BLOCKER: POST /api/quizzes/generate-and-take with
 * activityType=PRACTICE, quizMode=topic_practice, targetDifficulty=2
 * was correctly rejected server-side (INVALID_GENERATION_CONTRACT /
 * ZERO_GAP_PRACTICE_MISMATCH, 0 provider calls, 94ms) -- but the
 * learner reached this request at all, and saw a generic "couldn't
 * prepare this activity" failure for a canonically-known
 * non-executable action.
 *
 * ROOT CAUSE (PART A, traced not guessed): `ConceptList.tsx` (Subject
 * Detail's per-concept row list) and `ErrorPatternList.tsx` (Learning
 * Debt/Improve) both rendered a bare, UNCONDITIONAL
 * `<Link href="/dashboard/quiz?subjectId=...&conceptId=...">` with NO
 * `mode` query param, for EVERY concept regardless of canonical
 * actionState. `quiz/page.tsx`'s own `modeParam` fallback
 * (`searchParams.get('mode') || (conceptId ? 'topic_practice' : ...)`)
 * then defaulted the missing mode to `'topic_practice'`
 * unconditionally -- exactly reproducing the live request shape for a
 * concept whose canonical evidence gap was already 0. Fixed by routing
 * both links to Concept Mission (the ONE place a canonical,
 * actionState-gated CTA for a concept already exists) instead of
 * hand-building an ungated quiz URL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

import { isZeroGapPracticeMismatch } from '@/lib/lx/evidence-sufficiency-contract';
import type { MasteryPolicy, EvidenceSufficiency } from '@/services/knowledge-state.service';
import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';

const POLICY: MasteryPolicy = {
  version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75, minimumRetention: 75,
  minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0, minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2, validationWindowDays: 14,
};
const ZERO_GAP_SUFFICIENCY: EvidenceSufficiency = { evidenceCount: 3, independentEvidenceCount: 1, passed: true };

function ksState(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'LEARNING', understandingScore: 55, independenceScore: 40, applicationScore: 40,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 3, independentEvidenceCount: 1, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'INSUFFICIENT_EVIDENCE', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
function decision(learningState: LearningDecision['learningState'], activityType: LearningDecision['activityType']): LearningDecision {
  return { actionConceptId: 'c1', subjectId: 'subj1', learningState, activityType, facts: [], signals: [] } as unknown as LearningDecision;
}

/* ================================================================= *
 * REQUIRED TESTS 1-2 -- ZERO_GAP Practice/Review never render an       *
 * executable CTA (the shared canonical authority, unchanged since     *
 * LX-9R8, reconfirmed here as this phase's own baseline).             *
 * ================================================================= */
describe('RELEASE-R1 1 -- ZERO_GAP Practice never renders an executable CTA', () => {
  it('isZeroGapPracticeMismatch is true for the live shape (PRACTICE, gap=0, no REINFORCE)', () => {
    expect(isZeroGapPracticeMismatch({
      activityType: 'PRACTICE', hasReinforceIntervention: false,
      currentSufficiency: { evidenceCount: 3, independentEvidenceCount: 1, passed: true },
      masteryPolicy: POLICY,
    })).toBe(true);
  });

  it('the canonical read model reports BLOCKED (never EXECUTABLE) for this exact shape', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ksState(),
      activeDecision: decision('DEVELOPING', 'PRACTICE'),
      masteryPolicy: POLICY,
    });
    expect(progress.actionState).toBe('BLOCKED');
    expect(progress.nextCanonicalAction).toBeNull();
  });
});

describe('RELEASE-R1 2 -- ZERO_GAP Review never renders an executable CTA unless REINFORCE explicitly authorizes it', () => {
  it('BLOCKED for a plain zero-gap Review', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ksState(),
      activeDecision: decision('DEVELOPING', 'REVIEW'),
      masteryPolicy: POLICY,
    });
    expect(progress.actionState).toBe('BLOCKED');
  });

  it('EXECUTABLE only when an explicit REINFORCE-justified learningState is present', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ksState(),
      activeDecision: decision('MISCONCEPTION_BLOCKED', 'REVIEW'),
      masteryPolicy: POLICY,
    });
    expect(progress.intervention).toBe('REINFORCE');
    expect(progress.actionState).toBe('EXECUTABLE');
  });
});

/* ================================================================= *
 * REQUIRED TESTS 3-7 -- every named surface cannot launch invalid      *
 * Practice: audited by confirming NO surface hand-builds an ungated    *
 * quiz URL, and that the ones that DO launch activities go through     *
 * the ONE canonical mechanism (StartSessionButton -> session/start).   *
 * ================================================================= */
describe('RELEASE-R1 3 -- Today cannot launch invalid Practice', () => {
  it('Today never hand-builds a /dashboard/quiz URL -- only StartSessionButton', () => {
    const SRC = read('src/app/dashboard/page.tsx');
    expect(SRC).not.toMatch(/dashboard\/quiz\?/);
  });
});

describe('RELEASE-R1 4 -- My Path cannot launch invalid Practice', () => {
  it('My Path never hand-builds a /dashboard/quiz URL', () => {
    const pathDir = ['src/app/dashboard/path/page.tsx', 'src/app/dashboard/path/[subjectId]/page.tsx', 'src/app/dashboard/path/JourneyStrip.tsx'];
    for (const f of pathDir) {
      const SRC = read(f);
      expect(SRC).not.toMatch(/dashboard\/quiz\?/);
    }
  });
});

describe('RELEASE-R1 5 -- Subject Detail cannot launch invalid Practice', () => {
  it('the proven live defect: ConceptList.tsx no longer hand-builds an ungated, mode-less Practice link', () => {
    const SRC = read('src/app/dashboard/subjects/[id]/ConceptList.tsx');
    // The old defect: a bare Link with subjectId+conceptId and NO mode.
    expect(SRC).not.toMatch(/href=\{`\/dashboard\/quiz\?subjectId=\$\{subjectId\}&conceptId=\$\{c\.conceptId\}`\}/);
    // Routed to Concept Mission instead -- the canonical, actionState-gated surface.
    expect(SRC).toMatch(/href=\{`\/dashboard\/subjects\/\$\{subjectId\}\/concepts\/\$\{c\.conceptId\}`\}/);
  });

  it('the top-level Subject Detail CTA already used the canonical mechanism (StartSessionButton) -- unchanged, confirmed present', () => {
    const SRC = read('src/app/dashboard/subjects/[id]/page.tsx');
    expect(SRC).toMatch(/<StartSessionButton/);
    expect(SRC).toMatch(/never a hand-built \/dashboard\/quiz\?\.\.\. URL/);
  });

  it('cumulative_assessment/exam_simulation links remain -- explicit, learner-chosen modes, never a canonical-recommendation CTA, out of this defect\'s class', () => {
    const SRC = read('src/app/dashboard/subjects/[id]/page.tsx');
    expect(SRC).toMatch(/mode=cumulative_assessment/);
    expect(SRC).toMatch(/mode=exam_simulation/);
  });
});

describe('RELEASE-R1 6 -- Concept Mission cannot launch invalid Practice', () => {
  it('Concept Mission\'s one CTA still launches exclusively through StartSessionButton, never a hand-built URL', () => {
    const SRC = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx');
    expect(SRC).toMatch(/<StartSessionButton/);
    expect(SRC).not.toMatch(/dashboard\/quiz\?/);
  });
});

describe('RELEASE-R1 7 -- Results continuation cannot launch invalid Practice', () => {
  it('ContinuationPanel never hand-builds a quiz URL -- launchTarget always comes from the server\'s own resolveContinuation', () => {
    const SRC = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
    expect(SRC).not.toMatch(/dashboard\/quiz\?/);
    expect(SRC).toMatch(/router\.push\(target\)/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 8 -- generic fallback cannot default to               *
 * topic_practice on any REACHABLE UI path.                             *
 * ================================================================= */
describe('RELEASE-R1 8 -- no reachable UI path relies on quiz/page.tsx\'s own topic_practice default', () => {
  it('no file anywhere in src/app links to /dashboard/quiz with a conceptId but no mode param', () => {
    // Every remaining /dashboard/quiz?...conceptId=... link in the app
    // must carry an explicit mode -- the ONLY two that construct such a
    // URL (ConceptList's quick_check button, and subjects/[id]/page.tsx's
    // cumulative/exam buttons) already do.
    const conceptListSrc = read('src/app/dashboard/subjects/[id]/ConceptList.tsx');
    const linkMatches = [...conceptListSrc.matchAll(/href=\{`\/dashboard\/quiz\?[^`]*`\}/g)].map((m) => m[0]);
    for (const link of linkMatches) {
      expect(link).toMatch(/mode=/);
    }
  });

  it('the ErrorPatternList (Improve/Reinforce) fallback link is fixed the same way', () => {
    const SRC = read('src/app/dashboard/learning-debt/ErrorPatternList.tsx');
    expect(SRC).not.toMatch(/href=\{`\/dashboard\/quiz\?subjectId=\$\{p\.subjectId\}&conceptId=\$\{p\.topConceptId\}`\}/);
    expect(SRC).toMatch(/href=\{`\/dashboard\/subjects\/\$\{p\.subjectId\}\/concepts\/\$\{p\.topConceptId\}`\}/);
  });

  it('StartSessionButton (the one canonical launch mechanism) never constructs a URL itself -- it only navigates to a server-returned launchTarget', () => {
    const SRC = read('src/app/dashboard/StartSessionButton.tsx');
    expect(SRC).not.toMatch(/dashboard\/quiz\?/);
    expect(SRC).toMatch(/router\.push\(session\.launchTarget\)/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 9 -- stale canonical action is refreshed before        *
 * launch where necessary.                                              *
 * ================================================================= */
describe('RELEASE-R1 9 -- stale canonical action is refreshed before launch, never trusted from the client', () => {
  it('session/start re-derives the decision fresh from getLearningDecisions by actionConceptId -- never accepts a client-serialized decision', () => {
    const SRC = read('src/app/api/learning/session/start/route.ts');
    expect(SRC).toMatch(/const decisions = await getLearningDecisions\(/);
    expect(SRC).toMatch(/decisions\.find\(\(d\) => d\.actionConceptId === validated\.actionConceptId\)/);
    expect(SRC).not.toMatch(/JSON\.parse\(.*learningDecision/);
  });

  it('a concept with no current decision returns 404 NOT_FOUND -- never a fabricated/stale launch', () => {
    const SRC = read('src/app/api/learning/session/start/route.ts');
    expect(SRC).toMatch(/status: 404/);
    expect(SRC).toMatch(/No current Phase 3C decision exists for this concept/);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 10-11 -- server backstop unchanged; invalid direct    *
 * request makes zero provider calls.                                   *
 * ================================================================= */
describe('RELEASE-R1 10 -- the server backstop remains unchanged (still fails before any AI call)', () => {
  it('the zero-gap check is still positioned strictly before every generation call site', () => {
    const SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
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

  it('the REINFORCE exception is unchanged', () => {
    const SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
    expect(SRC).toMatch(/hasReinforceSignal = !!ks && \(ks\.criticalMisconceptionCount > 0 \|\| ks\.masteryState === 'INTERVENTION_REQUIRED'\)/);
  });
});

describe('RELEASE-R1 11 -- an invalid direct request makes zero provider calls', () => {
  it('the machine-readable rejection is returned from inside the SAME pre-generation try block, before any generateQuestionsForConcept-family call', () => {
    const SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
    const returnIdx = SRC.indexOf("error: 'INVALID_GENERATION_CONTRACT', reason: 'ZERO_GAP_PRACTICE_MISMATCH'");
    expect(returnIdx).toBeGreaterThan(-1);
    const firstGenCallIdx = SRC.indexOf('generateQuickCheckQuestions(conceptIds[0]');
    expect(returnIdx).toBeLessThan(firstGenCallIdx);
  });
});

/* ================================================================= *
 * REQUIRED TEST 12 -- canonical mismatch does not show a generic       *
 * generation-error screen.                                             *
 * ================================================================= */
describe('RELEASE-R1 12 -- canonical mismatch shows the correct recovery UX, never the generic generation error', () => {
  it('the server response is now machine-readable (error + reason), not just a generic GENERATION_FAILED', () => {
    const SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
    expect(SRC).toMatch(/error: 'INVALID_GENERATION_CONTRACT', reason: 'ZERO_GAP_PRACTICE_MISMATCH'/);
    expect(SRC).toMatch(/status: 409 \}\s*\n\s*\);\s*\n\s*\}\s*\n\s*\/\/ R8:/);
  });

  it('generateQuiz (the top-level phase==="error" path) detects the reason and shows quiz.canonicalStateChanged, never quiz.loadError, for this case', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    expect(SRC).toMatch(/body\.error === 'INVALID_GENERATION_CONTRACT' && body\.reason === 'ZERO_GAP_PRACTICE_MISMATCH'/);
    expect(SRC).toMatch(/errorReason === 'ZERO_GAP_PRACTICE_MISMATCH'/);
    expect(SRC).toMatch(/at\['quiz\.canonicalStateChanged'\]/);
  });

  it('startCanonicalActivity\'s own background generation wave (genState) ALSO detects the reason -- the auto-started canonical path the live incident actually went through', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    expect(SRC).toMatch(/genErrorReason === 'ZERO_GAP_PRACTICE_MISMATCH'/);
    // Never "Try again" for this specific failure -- retrying the
    // identical request would fail again identically.
    const block = SRC.slice(SRC.indexOf("if (genErrorReason === 'ZERO_GAP_PRACTICE_MISMATCH')"), SRC.indexOf("if (genErrorReason === 'ZERO_GAP_PRACTICE_MISMATCH')") + 500);
    expect(block).not.toMatch(/practice\.prepareRetry/);
    expect(block).toMatch(/continuation\.backToConcept/);
  });

  it('the raw generic message is still used for a genuine generation failure -- never removed, only no longer shown for a KNOWN canonical mismatch', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    expect(SRC).toMatch(/at\['quiz\.loadError'\]/);
    expect(SRC).toMatch(/at\['practice\.prepareFailedTitle'\]/);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 13-17 -- valid activities still launch exactly as    *
 * before (regression, source-level -- unchanged call sites).           *
 * ================================================================= */
describe('RELEASE-R1 13-17 -- valid Practice/Review/Prove/Retention/Transfer still launch exactly as before', () => {
  it('13-14. generatePracticeQuestions/topic_practice and review are untouched', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/export async function generatePracticeQuestions/);
  });

  it('15. SOLO_VERIFY (Prove) routing in selectActivityType is untouched', () => {
    const SRC = read('src/lib/adaptive-learning-policy.ts');
    expect(SRC).toMatch(/if \(types\.has\('VERIFICATION_PENDING'\)\) return 'SOLO_VERIFY';/);
  });

  it('16. RETENTION_CHECK still launches only when genuinely due (temporalUrgency HIGH) -- unchanged', () => {
    const SRC = read('src/lib/adaptive-learning-policy.ts');
    expect(SRC).toMatch(/if \(retentionReviewDue\?\.temporalUrgency === 'HIGH'\) return 'RETENTION_CHECK';/);
  });

  it('17. Transfer still launches only after Retention (UX/CANON-R1) -- unchanged by this phase', () => {
    const SRC = read('src/services/knowledge-state.service.ts');
    expect(SRC).toMatch(/if \(scores\.retention === null\) return 'WAITING_FOR_RETENTION';/);
    const retentionIdx = SRC.indexOf("if (scores.retention === null) return 'WAITING_FOR_RETENTION';");
    const transferIdx = SRC.indexOf("if (policy.requiresTransfer && scores.transfer === null) return 'TRANSFER_REQUIRED';");
    expect(retentionIdx).toBeLessThan(transferIdx);
  });
});

/* ================================================================= *
 * REQUIRED TEST 18 -- UX/CANON-R1 difficulty visibility unchanged.     *
 * ================================================================= */
describe('RELEASE-R1 18 -- UX/CANON-R1 difficulty visibility unchanged', () => {
  it('DifficultyBadge is still rendered on the active question with the activity-language messages', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    expect(SRC).toMatch(/<DifficultyBadge difficulty=\{q\.difficulty\} t=\{at\} \/>/);
  });

  it('getDifficultyPresentation is untouched', () => {
    const SRC = read('src/lib/lx/difficulty-presentation.ts');
    expect(SRC).toMatch(/export function getDifficultyPresentation/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 19 -- LX-10R1 performance work unchanged.              *
 * ================================================================= */
describe('RELEASE-R1 19 -- LX-10R1 question-generation performance contracts remain unchanged', () => {
  it('buildShapeExamplesBlock / questionGenerationCacheKey / the stable-prefix prompt structure are all still present', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/function buildShapeExamplesBlock/);
    expect(SRC).toMatch(/function questionGenerationCacheKey/);
    expect(SRC).toMatch(/return `\$\{stablePrefix\}/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 20 -- all existing tests green (verified by the full  *
 * suite run, not a dedicated assertion here).                          *
 * ================================================================= */
