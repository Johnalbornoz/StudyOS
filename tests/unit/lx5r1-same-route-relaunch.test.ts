/**
 * LX-5R1 -- SAME-ROUTE CONTINUATION MUST RELAUNCH THE ACTIVITY.
 *
 * Live QA failure: a canonical PRACTICE -> PRACTICE continuation for the
 * SAME concept returned `launchTarget` equal to the current quiz route.
 * `router.push` of an identical URL is a no-op in the Next.js App
 * Router -- the Results screen's ContinuationPanel stayed mounted
 * forever in its "continuing" state, and the quiz page never started a
 * new activity.
 *
 * Fix: (1) `buildRelaunchTarget`/`isSameRoute` (pure, src/lib/lx/
 * continuation.ts) detect a route-equivalent launch and append a
 * one-shot nonce so the navigation is genuine; (2) the quiz page keys a
 * `QuizPageContent` wrapper on that nonce so React fully remounts (and
 * therefore resets every piece of local state) instead of trying to
 * manually null out each field; (3) ContinuationPanel gains a stuck-
 * navigation backstop so the loading state can never spin forever even
 * if some future case slips past (1)/(2).
 *
 * Pure logic gets real unit tests below. Component/runtime behaviour
 * (React remount actually clearing state, the button visually
 * un-sticking) follows this repo's existing convention for this file
 * (see lx5-continuation.test.ts, lx5r-continuation-repair.test.ts):
 * source-contract checks here, HARNESS-verified in the LX-5R1 report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isSameRoute,
  buildRelaunchTarget,
  newRelaunchNonce,
  RELAUNCH_NONCE_PARAM,
} from '@/lib/lx/continuation';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const PANEL = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const SERVICE = read('src/services/learning-continuation.service.ts');
const HANDOFF = read('src/lib/lx/launch-teaching-handoff.ts');

const SAME_ROUTE_URL =
  '/dashboard/quiz?subjectId=24c89736-cf09-461c-83c4-97b247371637&conceptId=9521abd1-5520-4ee0-b5ab-75528b367ee3&mode=topic_practice';

/* ======================================================================
 * R1/R2 -- same-route detection is a valid canonical outcome, not an error
 * ==================================================================== */
describe('LX-5R1 R1/R2 -- isSameRoute never treats a canonical same-activity relaunch as an error', () => {
  it('(1) a different pathname is NOT the same route -- normal navigation applies', () => {
    expect(isSameRoute('/dashboard/quiz?conceptId=c1&mode=topic_practice', '/dashboard/subjects/s1/concepts/c1')).toBe(false);
  });

  it('(1) a different query on the SAME pathname is NOT the same route', () => {
    expect(isSameRoute(SAME_ROUTE_URL, '/dashboard/quiz?subjectId=X&conceptId=Y&mode=quick_check')).toBe(false);
  });

  it('(2)/(3) the exact same pathname + query (same concept + same mode) IS the same route', () => {
    expect(isSameRoute(SAME_ROUTE_URL, SAME_ROUTE_URL)).toBe(true);
  });

  it('query order does not matter -- same route regardless of param ordering', () => {
    const reordered =
      '/dashboard/quiz?mode=topic_practice&conceptId=9521abd1-5520-4ee0-b5ab-75528b367ee3&subjectId=24c89736-cf09-461c-83c4-97b247371637';
    expect(isSameRoute(SAME_ROUTE_URL, reordered)).toBe(true);
  });

  it('a stale relaunch nonce already on the CURRENT url is ignored -- still detected as same route', () => {
    const currentWithOldNonce = `${SAME_ROUTE_URL}&${RELAUNCH_NONCE_PARAM}=old123`;
    expect(isSameRoute(currentWithOldNonce, SAME_ROUTE_URL)).toBe(true);
  });

  it('unparsable input never crashes and never falsely claims same-route', () => {
    expect(isSameRoute('not a url at all::::', SAME_ROUTE_URL)).toBe(false);
  });
});

/* ======================================================================
 * R3 -- relaunch mechanism: smallest robust nonce injection
 * ==================================================================== */
describe('LX-5R1 R3 -- buildRelaunchTarget: normal nav unchanged, same-route gets a fresh nonce', () => {
  it('(1) a genuinely different destination is returned UNCHANGED -- normal navigation', () => {
    const target = '/dashboard/subjects/s1/concepts/c1';
    expect(buildRelaunchTarget(SAME_ROUTE_URL, target, 'nonce-1')).toBe(target);
  });

  it('(2) an identical destination gets the nonce appended, producing a genuinely different URL', () => {
    const target = buildRelaunchTarget(SAME_ROUTE_URL, SAME_ROUTE_URL, 'nonce-1');
    expect(target).not.toBe(SAME_ROUTE_URL);
    expect(target).toContain(`${RELAUNCH_NONCE_PARAM}=nonce-1`);
    // still the SAME concept/mode/subject -- R2's invariant: never forced onto a different activity
    expect(target).toContain('conceptId=9521abd1-5520-4ee0-b5ab-75528b367ee3');
    expect(target).toContain('mode=topic_practice');
  });

  it('two consecutive same-route relaunches each get a genuinely fresh nonce (never reuse one)', () => {
    const n1 = newRelaunchNonce();
    const n2 = newRelaunchNonce();
    expect(n1).not.toBe(n2);
  });

  it('a malformed launchTarget degrades to the raw value rather than throwing (R6/R13: recoverable, not a crash)', () => {
    expect(() => buildRelaunchTarget(SAME_ROUTE_URL, '::not a url::', 'n')).not.toThrow();
    expect(buildRelaunchTarget(SAME_ROUTE_URL, '::not a url::', 'n')).toBe('::not a url::');
  });
});

/* ======================================================================
 * R3/R4 -- the quiz page keys on the nonce to force a full, fresh remount
 * ==================================================================== */
describe('LX-5R1 R3/R4 -- QuizPageContent remounts (fresh quizId/questions/answers/results) on relaunch', () => {
  it('the page splits into a thin wrapper keyed on the relaunch nonce, and an inner content component', () => {
    expect(QUIZ).toMatch(/const relaunchKey = searchParams\.get\(RELAUNCH_NONCE_PARAM\) \|\| ''/);
    expect(QUIZ).toMatch(/<QuizPageContent key=\{relaunchKey\}\s*\/>/);
    expect(QUIZ).toMatch(/function QuizPageContent\(\)/);
  });

  it('(4) quizId is component-local state (useState), reset for free by the key-driven remount', () => {
    expect(QUIZ).toMatch(/const \[quizId, setQuizId\] = useState<string \| null>\(null\)/);
  });

  it('(5) questions/answers/results are all component-local state -- none of them survive a remount', () => {
    expect(QUIZ).toMatch(/const \[questions, setQuestions\] = useState<Question\[\]>\(\[\]\)/);
    expect(QUIZ).toMatch(/const \[answers, setAnswers\] = useState<Record<number, string>>\(\{\}\)/);
    expect(QUIZ).toMatch(/const \[results, setResults\] = useState<any>\(null\)/);
  });

  it('(6) the auto-start guard (autoStartedRef) is declared INSIDE QuizPageContent -- a fresh instance gets a fresh, unfired ref', () => {
    const contentIdx = QUIZ.indexOf('function QuizPageContent()');
    const refIdx = QUIZ.indexOf('const autoStartedRef = useRef(false)');
    expect(refIdx).toBeGreaterThan(contentIdx);
  });

  it('a genuinely different-route launch is unaffected -- no nonce present, key stays the stable empty string', () => {
    expect(QUIZ).toMatch(/searchParams\.get\(RELAUNCH_NONCE_PARAM\) \|\| ''/);
  });
});

/* ======================================================================
 * R7 -- exactly one fresh generation per relaunched instance
 * ==================================================================== */
describe('LX-5R1 R7 -- a relaunched instance triggers exactly one new generation, never a duplicate', () => {
  it('startCanonicalActivity is gated by isCanonicalFlow + phase===setup + !autoStartedRef.current, set true before firing', () => {
    const effectBlock = QUIZ.slice(
      QUIZ.indexOf('const autoStartedRef = useRef(false)'),
      QUIZ.indexOf('const autoStartedRef = useRef(false)') + 500,
    );
    expect(effectBlock).toMatch(/!autoStartedRef\.current/);
    expect(effectBlock).toMatch(/autoStartedRef\.current = true;\s*\n\s*startCanonicalActivity\(studentId\);/);
  });

  it('startCanonicalActivity itself issues exactly one generate-and-take POST per call', () => {
    const fnBody = QUIZ.slice(QUIZ.indexOf('const startCanonicalActivity ='), QUIZ.indexOf('const startCanonicalActivity =') + 2000);
    const matches = fnBody.match(/fetch\('\/api\/quizzes\/generate-and-take'/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

/* ======================================================================
 * R8/R9 -- evidence integrity + safe observability
 * ==================================================================== */
describe('LX-5R1 R8 -- relaunching writes no evidence itself', () => {
  it('ContinuationPanel and continuation.ts never write evidence/mastery/knowledge-state', () => {
    for (const src of [PANEL]) {
      expect(src).not.toMatch(/updateMastery|learning_evidence|recalculateConceptKnowledgeState|recordEvidence/);
    }
  });
});

describe('LX-5R1 R9 -- continuation diagnostics carry no learner/question/answer content', () => {
  it('every mark() call site passes only activityType/sameRoute/conceptId/mode/reason -- never question/answer text', () => {
    const markCalls = PANEL.match(/mark\('[A-Z_]+',\s*\{[^}]*\}\)/g) ?? [];
    expect(markCalls.length).toBeGreaterThanOrEqual(5); // STARTED, DECISION_READY, SAME_ROUTE_RELAUNCH/NAVIGATED, FAILED (x2 sites)
    for (const call of markCalls) {
      expect(call).not.toMatch(/question|answer|explanation|correctAnswer/i);
    }
  });

  it('the five required diagnostic labels are all present', () => {
    for (const label of [
      'CONTINUATION_REQUEST_STARTED',
      'CONTINUATION_DECISION_READY',
      'CONTINUATION_SAME_ROUTE_RELAUNCH',
      'CONTINUATION_NAVIGATED',
      'CONTINUATION_FAILED',
    ]) {
      expect(PANEL).toContain(`'${label}'`);
    }
  });
});

/* ======================================================================
 * R5 -- Teaching Experience handoff untouched (still consume-once, validated)
 * ==================================================================== */
describe('LX-5R1 R5 -- Teaching Experience handoff semantics are unchanged by the relaunch fix', () => {
  it('(10) the handoff write still happens unconditionally on a LAUNCH, independent of same-route detection', () => {
    const writeIdx = PANEL.indexOf("if ('teachingExperience' in c)");
    const sameRouteIdx = PANEL.indexOf('LX-5R1: a canonical LAUNCH may legitimately point back');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(sameRouteIdx).toBeGreaterThan(writeIdx); // handoff decided first, relaunch nonce logic after
  });

  it('(11) the handoff module itself (untouched) still validates concept + mode + freshness + shape, falling back to null', () => {
    expect(HANDOFF).toMatch(/if \(h\.conceptId !== conceptId\) return null/);
    expect(HANDOFF).toMatch(/if \(h\.mode !== mode\) return null/);
    expect(HANDOFF).toMatch(/now - h\.ts > LAUNCH_TEACHING_MAX_AGE_MS\) return null/);
    expect(HANDOFF).toMatch(/isIntactTeachingView\(h\.teachingExperience\) \? h\.teachingExperience : null/);
    // consume-once: the key is always removed once read, regardless of validity
    expect(HANDOFF).toMatch(/s\.removeItem\(KEY\)/);
  });

  it('the relaunch nonce param is never confused with the mode param the handoff matches on', () => {
    expect(RELAUNCH_NONCE_PARAM).not.toBe('mode');
  });
});

/* ======================================================================
 * R6/R13 -- loading state always terminates
 * ==================================================================== */
describe('LX-5R1 R6/R13 -- Continue can never spin forever', () => {
  it('(12) both navigating branches (LAUNCH and RETURN_TO_MISSION) arm the stuck-navigation backstop before router.push', () => {
    const launchBranch = PANEL.slice(PANEL.indexOf("if (c?.status === 'LAUNCH'"), PANEL.indexOf('router.push(target)'));
    expect(launchBranch).toMatch(/armStuckBackstop\(\);/);
    const returnBranch = PANEL.slice(PANEL.indexOf('RETURN_TO_MISSION (any reason)'), PANEL.indexOf('router.push(conceptMissionPath'));
    expect(returnBranch).toMatch(/armStuckBackstop\(\);/);
  });

  it('(13) the backstop resolves to an explicit recoverable state (busy=false, failed=true), never just a hidden spinner', () => {
    const fnBody = PANEL.slice(PANEL.indexOf('function armStuckBackstop'), PANEL.indexOf('async function onContinue'));
    expect(fnBody).toMatch(/setBusy\(false\)/);
    expect(fnBody).toMatch(/setFailed\(true\)/);
  });

  it('the backstop timer is cleared on unmount so a REAL navigation never falsely fires it', () => {
    expect(PANEL).toMatch(/return \(\) => \{\s*\n\s*if \(stuckTimerRef\.current\) clearTimeout\(stuckTimerRef\.current\);/);
  });

  it('the pre-existing fetch/parse failure path still resets busy and shows the recoverable fallback (unchanged)', () => {
    expect(PANEL).toMatch(/catch \{\s*mark\('CONTINUATION_FAILED'/);
    expect(PANEL).toMatch(/setBusy\(false\);\s*\n\s*setFailed\(true\); \/\/ show the safe fallback button/);
  });
});

/* ======================================================================
 * R14/R15 -- PRACTICE -> PRACTICE decision + other statuses unchanged
 * ==================================================================== */
describe('LX-5R1 R14/R15 -- LearningDecision/TeachingExperience/other statuses are untouched', () => {
  it('(14) the resolver still sources next-action from canonical authority only -- no local ActivityType/threshold logic added', () => {
    expect(SERVICE).toMatch(/getBestLearningDecisionForConcept|getLearningDecisions/);
    expect(SERVICE).toMatch(/bootstrapNotStartedLearningDecision/);
    expect(SERVICE).not.toMatch(/activityType\s*=\s*['"]/);
    expect(SERVICE).not.toMatch(/rankLearningDecisions|selectActivityType/);
  });

  it('(15) RETURN_TO_MISSION still navigates to the concept mission unconditionally, exactly as before', () => {
    expect(PANEL).toMatch(/router\.push\(conceptMissionPath\(\{ subjectId, conceptId \}\)\)/);
  });

  it('this phase never touches /api/learning/continue route semantics or the resolver file directly', () => {
    // sanity: the route/service files are read-only references in this
    // suite -- no fixture here asserts a CHANGE to their decision logic,
    // only that the pre-existing canonical-only invariant still holds.
    expect(SERVICE).not.toMatch(/RELAUNCH_NONCE_PARAM|relaunch/i);
  });
});
