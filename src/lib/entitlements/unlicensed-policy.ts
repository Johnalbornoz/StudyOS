/**
 * L11 / EN-2 -- the written definition of unlicensed ("demo") mode.
 *
 * Orchestrator ruling D-8 (2026-10-11):
 *  (a) PAID -- the actual learning activity. Instructional execution, AI
 *      teaching content, AI grading, mastery and evidence need a licence
 *      (`LEARNING_FULL_ACCESS`): starting or generating a session, quiz,
 *      simulation, exam instance, study plan or teacher-assigned task; the
 *      tutor; hints; guided practice; concept explanations and interactive
 *      formulas; error-pattern guidance; explain and transfer challenges.
 *  (b) FREE_IN_DEMO -- AI-assisted content setup. Concept suggestions,
 *      document analysis / import, concept extraction and content upload /
 *      process / search stay available to an unlicensed student under the
 *      existing rate limits, to build the learning setup. They unlock none of
 *      (a).
 *  (c) CONTINUATION (ruled 2026-10-11) -- an attempt that was legitimately
 *      STARTED while the licence was valid may be reopened, answered,
 *      completed, graded as far as finishing it requires, and its result
 *      read, after the licence ends. It never allows starting a new attempt,
 *      restarting a completed one, creating another instructional session, or
 *      using the old attempt to reach new paid activity. The attempt's own
 *      validity rules (status, expiry, due date) and every ownership check
 *      still apply. Two shapes:
 *        - CONTINUATION: the route only ever acts on an existing attempt, so
 *          it carries no licence check;
 *        - PAID_UNLESS_OPEN_ATTEMPT: the route serves a new start as well, so
 *          it requires the licence unless it holds a server-side record of
 *          that same attempt, owned by the Student and still open.
 *
 * Always free, in any subscription state: the learner's own history and
 * progress (`LEARNING_HISTORY_VIEW`, INV-F3-06), billing, profile, and every
 * read that only returns metadata or a launch target.
 *
 * `route` is the directory under `src/app/api`. A PAID route must enforce
 * through the shared point (`learning-gate.ts`, or `canUseCapability` /
 * `requireOwnerOf(..., { entitled: true })`, which resolve the same single
 * decision); a PAID_UNLESS_OPEN_ATTEMPT route must enforce through the
 * `...UnlessOpenAttempt` forms of the shared point.
 * tests/unit/l11-unlicensed-policy.test.ts fails if either stops enforcing,
 * if a FREE_IN_DEMO or CONTINUATION route starts to, or if a route enforces
 * without being listed here.
 */
export type UnlicensedRule = 'PAID' | 'PAID_UNLESS_OPEN_ATTEMPT' | 'FREE_IN_DEMO' | 'CONTINUATION' | 'REPORTS_ONLY';

export interface LearningRoutePolicy {
  route: string;
  rule: UnlicensedRule;
  note?: string;
}

export const LEARNING_ROUTE_POLICY: readonly LearningRoutePolicy[] = [
  // (a) PAID -- enforced before L11.
  { route: 'cognitive/explain/generate', rule: 'PAID' },
  { route: 'cognitive/remediation/start', rule: 'PAID' },
  { route: 'cognitive/transfer/generate', rule: 'PAID' },
  { route: 'exam-readiness/score', rule: 'PAID' },
  { route: 'exams/instances', rule: 'PAID', note: 'POST (create); listing is ownership only' },
  { route: 'exams/instances/[id]/retake', rule: 'PAID' },
  { route: 'exams/instances/[id]/start', rule: 'PAID' },
  { route: 'learning/session/start', rule: 'PAID' },
  { route: 'quizzes/generate', rule: 'PAID' },
  { route: 'quizzes/generate-and-take', rule: 'PAID', note: 'generation; the submit branch of the same route is continuation (ownership only)' },
  { route: 'quizzes/hint', rule: 'PAID' },
  { route: 'simulation/attempts', rule: 'PAID', note: 'POST (start)' },
  { route: 'study-plan/generate', rule: 'PAID' },
  { route: 'teaching/interventions', rule: 'PAID' },
  { route: 'tutor/conversations', rule: 'PAID', note: 'POST (new conversation)' },
  { route: 'tutor/message', rule: 'PAID' },
  { route: 'tutor/video', rule: 'PAID' },
  // (a) PAID -- enforced by L11 (audit L4-10).
  { route: 'learning/guided-practice', rule: 'PAID' },
  { route: 'concepts/[id]/explanation', rule: 'PAID' },
  { route: 'concepts/[id]/interactive-formula', rule: 'PAID' },
  { route: 'learning-debt/error-guidance', rule: 'PAID' },

  // (a) + (c) PAID_UNLESS_OPEN_ATTEMPT -- a new start needs the licence; the same attempt may be finished.
  { route: 'cognitive/explain/submit', rule: 'PAID_UNLESS_OPEN_ATTEMPT', note: "open = the Student's own task, not expired, not yet answered" },
  { route: 'cognitive/transfer/submit', rule: 'PAID_UNLESS_OPEN_ATTEMPT', note: "open = the Student's own server-minted task and its exact prompt" },
  { route: 'student/teacher-interventions/[id]/start', rule: 'PAID_UNLESS_OPEN_ATTEMPT', note: 'open = an execution already exists for this task and key (RECOVERED, nothing generated)' },

  // (b) FREE_IN_DEMO -- AI-assisted content setup.
  { route: 'concepts/suggest', rule: 'FREE_IN_DEMO' },
  { route: 'content/import/analyze', rule: 'FREE_IN_DEMO' },
  { route: 'content/extract-concepts', rule: 'FREE_IN_DEMO' },
  { route: 'content/process', rule: 'FREE_IN_DEMO' },
  { route: 'content/search', rule: 'FREE_IN_DEMO' },
  { route: 'content/upload', rule: 'FREE_IN_DEMO' },

  // (c) CONTINUATION -- only ever act on an existing attempt.
  { route: 'quizzes/session/[quizId]', rule: 'CONTINUATION', note: 'reopen an existing quiz' },
  { route: 'quizzes/session/[quizId]/check', rule: 'CONTINUATION', note: 'answer inside an active, unexpired quiz session' },
  { route: 'simulation/attempts/[id]', rule: 'CONTINUATION', note: 'reopen an existing attempt' },
  { route: 'simulation/attempts/[id]/result', rule: 'CONTINUATION', note: 'result of the same attempt' },
  { route: 'exams/attempts/[id]', rule: 'CONTINUATION' },
  { route: 'exams/instances/[id]', rule: 'CONTINUATION', note: 'view of an existing instance and its attempt' },
  { route: 'exams/instances/[id]/submissions/[index]', rule: 'CONTINUATION' },
  { route: 'simulation/attempts/[id]/next-item', rule: 'CONTINUATION' },
  { route: 'simulation/attempts/[id]/pause', rule: 'CONTINUATION' },
  { route: 'simulation/attempts/[id]/resume', rule: 'CONTINUATION' },
  { route: 'simulation/attempts/[id]/complete', rule: 'CONTINUATION' },
  { route: 'simulation/attempts/[id]/abandon', rule: 'CONTINUATION' },
  { route: 'quizzes/verify', rule: 'CONTINUATION', note: 'answer submission for an open quiz' },
  { route: 'quizzes/localize-question', rule: 'CONTINUATION' },

  // Report the licence state to the client; they gate nothing themselves.
  { route: 'billing/subscription', rule: 'REPORTS_ONLY' },
  { route: 'learning/session-eligibility', rule: 'REPORTS_ONLY' },
  { route: 'internal/delivery-bench', rule: 'REPORTS_ONLY', note: 'CRON_SECRET bench; reports the entitlement it observed' },
];

export function rulesFor(rule: UnlicensedRule): readonly LearningRoutePolicy[] {
  return LEARNING_ROUTE_POLICY.filter((p) => p.rule === rule);
}
