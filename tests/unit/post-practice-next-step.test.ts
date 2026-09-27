/**
 * PRACTICE_SESSION_RESTART + POST_PRACTICE_NEXT_STEP -- after an activity
 * there is ONE canonical decision (Results, "Seguir aprendiendo", Concept
 * Mission, Today/My Path all read getCanonicalPedagogicalDecision), and
 * continuing into the next session never needs a reload.
 *
 * Real DEV E2E (read-only): practices at difficulty 2 (78%, 100%); the
 * canonical contract then raised difficulty to 3
 * (PRACTICE_SUCCESS_DIFFICULTY_INCREASE). The continuation URL differed
 * from the current one only by `difficulty=2 -> 3`, so it was not
 * "same-route", got no relaunch nonce, the query-only push did not remount
 * the quiz page, the old Results stayed, and the 4 s backstop showed
 * "No se pudo determinar el siguiente paso" -- a reload then started the
 * difficulty-3 practice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState } from '@/lib/pedagogical-engine';
import type { RawEvidenceItem } from '@/lib/pedagogical-engine/types';
import { resolveCanonicalLaunch } from '@/lib/pedagogical-decision/canonical-session-launch';
import { buildRelaunchTarget, isSameRoute, isSamePage, quizInstanceKey, RELAUNCH_NONCE_PARAM } from '@/lib/lx/continuation';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SUBJECT = 'e85bdf1a-6318-42ed-a7a1-c8c2a3b269e8';
const CONCEPT = 'efdf6939-8db1-4b02-a98f-7f3eb0007c64';
let seq = 0;
const at = (m: number) => new Date(Date.UTC(2026, 8, 27, 10, m)).toISOString();
const item = (activityType: RawEvidenceItem['activityType'], scorePercent: number, difficulty = 2): RawEvidenceItem => {
  seq++;
  return { id: `e${seq}`, activityType, timestamp: at(seq), itemCount: activityType === 'LEARN_CHECK' ? 5 : 3, correctCount: 0, scorePercent, independent: false, difficulty, hasCriticalMisconception: false };
};
const E2E = () => [item('LEARN_CHECK', 78), item('LEARN_CHECK', 80), item('LEARN_CHECK', 100), item('PRACTICE', 78), item('PRACTICE', 100)];
const decide = (ev: RawEvidenceItem[]) => evaluateCanonicalLearningState({ conceptId: CONCEPT, studentId: 's', now: at(59), evidence: ev, activeCriticalMisconception: false });
const PREV_PRACTICE_URL = `/dashboard/quiz?subjectId=${SUBJECT}&conceptId=${CONCEPT}&mode=topic_practice&difficulty=2&v1Launch=1&maxQuestions=3`;

describe('POST_PRACTICE_NEXT_STEP -- the real E2E session', () => {
  const d = decide(E2E());
  const launch = resolveCanonicalLaunch({ subjectId: SUBJECT, conceptId: CONCEPT, decision: d });

  it('a 100% practice does NOT imply PROVE: 1 of 2 required passes -> still PRACTICE, executable', () => {
    expect(d.stage).toBe('PRACTICE');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.practiceProgress).toMatchObject({ passesInWindow: 1, requiredPasses: 2 });
  });

  it('the continuation LAUNCHes the same stage Results announces (PRACTICE), at the contract difficulty 3', () => {
    expect(launch.launchStatus).toBe('READY');
    expect(launch.activityType).toBe('PRACTICE');
    expect(launch.launchTarget).toContain('mode=topic_practice');
    expect(launch.launchTarget).toContain('difficulty=3');
    expect(d.activityContract?.difficulty.reasonCode).toBe('PRACTICE_SUCCESS_DIFFICULTY_INCREASE');
  });

  it('root cause reproduced: the target differs from the current URL only by difficulty -> not "same route"', () => {
    expect(isSameRoute(PREV_PRACTICE_URL, launch.launchTarget!)).toBe(false);
    expect(isSamePage(PREV_PRACTICE_URL, launch.launchTarget!)).toBe(true);
  });
});

describe('PRACTICE_SESSION_RESTART -- continuing always starts a fresh session without reload', () => {
  const d = decide(E2E());
  const launch = resolveCanonicalLaunch({ subjectId: SUBJECT, conceptId: CONCEPT, decision: d })!;

  it('a same-page continuation with different params gets a fresh relaunch nonce', () => {
    const pushed = buildRelaunchTarget(PREV_PRACTICE_URL, launch.launchTarget!, 'n1');
    expect(pushed).toContain(`${RELAUNCH_NONCE_PARAM}=n1`);
    expect(pushed).toContain('difficulty=3');
  });

  it('the pushed URL yields a different activity-instance key -> the quiz page remounts (fresh quizId/questions/results)', () => {
    const pushed = buildRelaunchTarget(PREV_PRACTICE_URL, launch.launchTarget!, 'n1');
    const key = (u: string) => quizInstanceKey(new URL(u, 'http://x').searchParams);
    expect(key(pushed)).not.toBe(key(PREV_PRACTICE_URL));
  });

  it('an identical PRACTICE -> PRACTICE continuation still relaunches (unchanged behavior)', () => {
    const pushed = buildRelaunchTarget(launch.launchTarget!, launch.launchTarget!, 'n2');
    expect(pushed).toContain(`${RELAUNCH_NONCE_PARAM}=n2`);
  });

  it('PRACTICE -> PROVE (2 passes) is also a fresh instance on the same page', () => {
    const d2 = decide([...E2E(), item('PRACTICE', 90, 3)]);
    expect(d2.stage).toBe('PROVE');
    const l2 = resolveCanonicalLaunch({ subjectId: SUBJECT, conceptId: CONCEPT, decision: d2 });
    expect(l2).toMatchObject({ launchStatus: 'READY', activityType: 'PROVE' });
    const pushed = buildRelaunchTarget(PREV_PRACTICE_URL, l2.launchTarget!, 'n3');
    expect(pushed).toContain('mode=canonical_prove');
    expect(quizInstanceKey(new URL(pushed, 'http://x').searchParams)).not.toBe(quizInstanceKey(new URL(PREV_PRACTICE_URL, 'http://x').searchParams));
  });

  it('a different page (e.g. back to the Concept Mission) is pushed unchanged', () => {
    expect(buildRelaunchTarget(PREV_PRACTICE_URL, `/dashboard/subjects/${SUBJECT}/concepts/${CONCEPT}`, 'n')).toBe(`/dashboard/subjects/${SUBJECT}/concepts/${CONCEPT}`);
  });

  it('a navigation that does not unmount completes as a document load to the SAME target -- never "No se pudo determinar el siguiente paso"', () => {
    const panel = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
    const backstop = panel.slice(panel.indexOf('function armStuckBackstop'), panel.indexOf('async function onContinue'));
    expect(backstop).toMatch(/window\.location\.assign\(target\)/);
    expect(backstop).not.toMatch(/setFailed/);
    // "resolveFailed" is reserved for a genuinely failed resolution request
    expect(panel).toMatch(/catch \{\s*mark\('CONTINUATION_FAILED'/);
  });
});

describe('one canonical decision after an activity, for every surface', () => {
  it('Results, Continue, Concept Mission, session start, Today and My Path all read the canonical engine', () => {
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/const fresh: CanonicalDecisionResult = await getCanonicalPedagogicalDecision\(/);
    const cont = read('src/services/learning-continuation.service.ts');
    expect(cont).toMatch(/decisionResult = await getCanonicalPedagogicalDecision\(\{ studentId, conceptId \}\)/);
    expect(cont).toMatch(/resolveCanonicalLaunch\(\{/);
    expect(read('src/services/concept-mission-view.service.ts')).toMatch(/await getCanonicalPedagogicalDecision\(\{ studentId, conceptId \}\)/);
    for (const f of ['src/app/api/learning/session/start/route.ts', 'src/services/learning-session-engine.service.ts', 'src/lib/lx/path-view.ts']) {
      expect(read(f), f).toMatch(/getCanonicalPedagogicalDecision|resolveCanonicalLaunch|resolveCanonicalContinuation/);
    }
  });

  it('for every executable stage, the launched activity is the stage Results announces', () => {
    const cases: Array<[string, RawEvidenceItem[]]> = [
      ['LEARN', []],
      ['PRACTICE', E2E()],
      ['PROVE', [...E2E(), item('PRACTICE', 90, 3)]],
    ];
    for (const [stage, ev] of cases) {
      const d = decide(ev);
      expect(d.stage).toBe(stage);
      const l = resolveCanonicalLaunch({ subjectId: SUBJECT, conceptId: CONCEPT, decision: d });
      expect(l.launchStatus).toBe('READY');
      expect(l.activityType).toBe(stage === 'LEARN' ? 'LEARN_CHECK' : stage);
    }
  });
});
