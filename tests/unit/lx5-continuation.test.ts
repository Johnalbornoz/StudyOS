/**
 * LX-5 -- LEARNING CONTINUATION.
 *
 * Pure checks on the continuation contract + source/query contract
 * checks on the resolver, route, and wiring (the repo's convention --
 * no live component/DB harness). Runtime behaviour is HARNESS-verified
 * in the LX-5 report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';
import {
  checkpointFor,
  conceptMissionPath,
  CONTINUATION_CONTRACT_VERSION,
  type LearningActivityKind,
} from '@/lib/lx/continuation';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SERVICE = read('src/services/learning-continuation.service.ts');
const ROUTE = read('src/app/api/learning/continue/route.ts');
const PANEL = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const LEARN = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure.tsx');
const REMED_PAGE = read('src/app/dashboard/remediation/[pathId]/page.tsx');
const REMED_VIEW = read('src/lib/remediation-session-view.ts');
const SHELL = read('src/app/dashboard/LearnerShell.tsx');

/* ---------- continuation context (pure) ---------- */
describe('LX-5B continuation context', () => {
  it('conceptMissionPath returns the concept mission route', () => {
    expect(conceptMissionPath({ subjectId: 's1', conceptId: 'c1' })).toBe('/dashboard/subjects/s1/concepts/c1');
  });
  it('every finished-activity kind maps to a distinct checkpoint copy set', () => {
    const kinds: LearningActivityKind[] = ['LEARN', 'PRACTICE', 'PROVE', 'TRANSFER', 'RETAIN', 'REINFORCE'];
    const seen = new Set<string>();
    for (const k of kinds) {
      const cp = checkpointFor(k);
      expect(cp.headlineKey).toMatch(/^continuation\./);
      expect(cp.continueKey).toMatch(/^continuation\./);
      seen.add(cp.headlineKey);
    }
    expect(seen.size).toBe(kinds.length);
  });
  it('contract carries a version', () => {
    expect(CONTINUATION_CONTRACT_VERSION).toBe(1);
  });
});

/* ---------- resolver: canonical only, no local pedagogy ---------- */
describe('LX-5E continuation resolver consumes canonical authority only', () => {
  it('sources the next action from Phase 4 / Phase 8 first-touch / session engine -- never a local table', () => {
    expect(SERVICE).toMatch(/getBestLearningDecisionForConcept|getLearningDecisions/);
    expect(SERVICE).toMatch(/bootstrapNotStartedLearningDecision/);
    expect(SERVICE).toMatch(/startLearningSession/);
    // no local ActivityType selection, no mastery threshold, no ranking
    expect(SERVICE).not.toMatch(/activityType\s*=\s*['"]/);
    expect(SERVICE).not.toMatch(/rankLearningDecisions|selectActivityType/);
    expect(SERVICE).not.toMatch(/masteryScore\s*[<>]=?\s*\d|score\s*[<>]=?\s*\d/);
    expect(SERVICE).not.toMatch(/if\s*\(\s*learnCompleted/);
  });
  it('the Phase 8 first-touch is used ONLY when Phase 4 has no live decision, and only for NOT_STARTED + curriculum-eligible', () => {
    expect(SERVICE).toMatch(/hasLiveDecisionForConcept\(phase4Decisions, conceptId\)/);
    expect(SERVICE).toMatch(/masteryState === 'UNKNOWN'/);
    expect(SERVICE).toMatch(/getCurriculumEligibleConcepts/);
    expect(SERVICE).toMatch(/eligible\.some\(\(e\) => e\.conceptId === conceptId\)/);
  });
  it('writes NO evidence / mastery / KS', () => {
    for (const src of [SERVICE, ROUTE, PANEL]) {
      expect(src).not.toMatch(/updateMastery|learning_evidence|recalculateConceptKnowledgeState|recordEvidence/);
    }
  });
  it('a missing / unavailable / failed decision degrades to RETURN_TO_MISSION -- never fabricates an activity', () => {
    expect(SERVICE).toMatch(/status: 'RETURN_TO_MISSION', reason: 'NO_CANONICAL_ACTION'/);
    expect(SERVICE).toMatch(/status: 'RETURN_TO_MISSION', reason: 'DECISION_UNAVAILABLE'/);
    expect(SERVICE).toMatch(/status: 'RETURN_TO_MISSION', reason: 'RESOLVE_FAILED'/);
    // the route also fails safe
    expect(ROUTE).toMatch(/RETURN_TO_MISSION[\s\S]*RESOLVE_FAILED/);
  });
});

/* ---------- LX-5C: Learn completion ---------- */
describe('LX-5C Learn no longer dead-ends; reading is experience progress, not evidence', () => {
  it('the Learn disclosure renders a continuation checkpoint once the explanation has loaded', () => {
    expect(LEARN).toMatch(/import ContinuationPanel/);
    expect(LEARN).toMatch(/open && !loading && !error && data/);
    expect(LEARN).toMatch(/from="LEARN"/);
  });
  it('the Learn disclosure writes nothing (no evidence / mastery)', () => {
    expect(LEARN).not.toMatch(/updateMastery|learning_evidence|record.*[Ee]vidence/);
  });
});

/* ---------- LX-5D: activity completion ---------- */
describe('LX-5D activity completion checkpoint replaces the back-to-subject dead end', () => {
  it('the quiz results view renders one canonical continuation, keyed to the finished-activity kind', () => {
    expect(QUIZ).toMatch(/import ContinuationPanel/);
    expect(QUIZ).toMatch(/<ContinuationPanel/);
    expect(QUIZ).toMatch(/from=\{continuationKind\}/);
    // continuationKind is presentation only (mode -> kind), not a decision
    expect(QUIZ).toMatch(/const continuationKind: LearningActivityKind =/);
  });
  it('the bare "back to subject" primary link is gone from the results actions', () => {
    // the score/review remain, but the dominant action is Continue
    const resultsBlock = QUIZ.slice(QUIZ.indexOf('LX-4R R8: surfaced authority mismatch'), QUIZ.indexOf('LX-4R R1/R2/R3'));
    expect(resultsBlock).toMatch(/<ContinuationPanel/);
    expect(resultsBlock).not.toMatch(/Link href=\{`\/dashboard\/subjects\/\$\{subjectId\}`\} className="btn btn-primary"/);
  });
  it('Prove insufficiency is shown as a note, not a local "complete" decision', () => {
    expect(QUIZ).toMatch(/results\.proveSufficiency && !results\.proveSufficiency\.sufficient/);
    // the finished-activity kind is derived only from the request mode --
    // never from the sufficiency result (that stays canonical authority's call)
    const kindLine = QUIZ.slice(QUIZ.indexOf('const continuationKind: LearningActivityKind ='));
    expect(kindLine.slice(0, 300)).not.toMatch(/proveSufficiency|sufficient/);
  });
});

/* ---------- LX-5F: REINFORCE / remediation return ---------- */
describe('LX-5F remediation completion returns to the journey, not Today', () => {
  it('the TERMINAL view carries the repaired concept for the continuation', () => {
    expect(REMED_VIEW).toMatch(/status: 'TERMINAL';\s*readonly pathState/);
    expect(REMED_VIEW).toMatch(/readonly conceptId: string \| null/);
    expect(REMED_VIEW).toMatch(/readonly subjectId: string \| null/);
  });
  it('the terminal remediation page renders a REINFORCE continuation when the concept is known', () => {
    expect(REMED_PAGE).toMatch(/import ContinuationPanel/);
    expect(REMED_PAGE).toMatch(/from="REINFORCE"/);
    expect(REMED_PAGE).toMatch(/view\.conceptId && view\.subjectId/);
    // a Today link remains only as the fallback when the concept is unknown
    expect(REMED_PAGE).toMatch(/remediation\.backToToday/);
  });
  it('after remediation the resolver re-reads canonical authority (does not assume the same ActivityType)', () => {
    // the REINFORCE path goes through the SAME resolveContinuation -> Phase 4 re-read
    expect(PANEL).toMatch(/\/api\/learning\/continue/);
    expect(SERVICE).toMatch(/getBestLearningDecisionForConcept|getLearningDecisions/);
  });
});

/* ---------- LX-5J: Focus Mode exit ---------- */
describe('LX-5J Focus Mode exit is context-aware', () => {
  it('the shell prefers a recorded activity origin (Concept Mission) over the default Today', () => {
    expect(SHELL).toMatch(/sessionStorage\.getItem\('lx\.activityOrigin'\)/);
    expect(SHELL).toMatch(/originExitHref \?\? exitHref/);
    expect(SHELL).toMatch(/\/dashboard\/subjects\/\$\{o\.subjectId\}\/concepts\/\$\{o\.conceptId\}/);
  });
  it('the quiz activity records its concept origin (navigation context only)', () => {
    expect(QUIZ).toMatch(/sessionStorage\.setItem\('lx\.activityOrigin', JSON\.stringify\(\{ subjectId, conceptId \}\)\)/);
  });
  it('it degrades safely when sessionStorage is unavailable', () => {
    expect(SHELL).toMatch(/catch \{[\s\S]*?fall through to the default/);
  });
});

/* ---------- LX-5M: resilience ---------- */
describe('LX-5M continuation degrades safely, never strands the learner', () => {
  it('ContinuationPanel always offers a back-to-concept path and a failure fallback', () => {
    expect(PANEL).toMatch(/continuation\.backToConcept/);
    expect(PANEL).toMatch(/continuation\.resolveFailed/);
    expect(PANEL).toMatch(/setFailed\(true\)/);
    expect(PANEL).toMatch(/router\.push\(conceptMissionPath/);
  });
});

/* ---------- i18n ---------- */
describe('LX-5 i18n', () => {
  const KEYS = [
    'continuation.learn.headline', 'continuation.learn.body', 'continuation.learn.continue',
    'continuation.practice.headline', 'continuation.practice.body',
    'continuation.prove.headline', 'continuation.prove.body',
    'continuation.transfer.headline', 'continuation.transfer.body',
    'continuation.retain.headline', 'continuation.retain.body',
    'continuation.reinforce.headline', 'continuation.reinforce.body', 'continuation.reinforce.continue',
    'continuation.continue', 'continuation.backToConcept', 'continuation.resolveFailed',
  ];
  it('every key resolves non-empty in every locale, and every checkpointFor key exists', () => {
    const cpKeys = new Set<string>();
    for (const k of ['LEARN', 'PRACTICE', 'PROVE', 'TRANSFER', 'RETAIN', 'REINFORCE'] as LearningActivityKind[]) {
      const cp = checkpointFor(k);
      cpKeys.add(cp.headlineKey); cpKeys.add(cp.bodyKey); cpKeys.add(cp.continueKey);
    }
    for (const loc of LOCALES) {
      for (const k of [...KEYS, ...cpKeys]) {
        const v = MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]];
        expect(typeof v === 'string' && v.length > 0, `${loc}:${k}`).toBe(true);
      }
    }
  });
});
