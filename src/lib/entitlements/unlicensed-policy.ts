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
 *  (c) CONTINUATION -- finishing something that is already open when the
 *      licence ends. NOT RULED YET: these routes keep the behaviour they had
 *      (ownership only) until the Orchestrator rules; nothing new can be
 *      started from them.
 *
 * Always free, in any subscription state: the learner's own history and
 * progress (`LEARNING_HISTORY_VIEW`, INV-F3-06), billing, profile, and every
 * read that only returns metadata or a launch target.
 *
 * `route` is the directory under `src/app/api`. A PAID route must enforce
 * through the shared point (`learning-gate.ts`, or `canUseCapability` /
 * `requireOwnerOf(..., { entitled: true })`, which resolve the same single
 * decision); tests/unit/l11-unlicensed-policy.test.ts fails if a PAID route
 * stops enforcing, if a FREE_IN_DEMO or CONTINUATION route starts to, or if a
 * route enforces without being listed here.
 */
export type UnlicensedRule = 'PAID' | 'FREE_IN_DEMO' | 'CONTINUATION' | 'REPORTS_ONLY';

export interface LearningRoutePolicy {
  route: string;
  rule: UnlicensedRule;
  note?: string;
}

export const LEARNING_ROUTE_POLICY: readonly LearningRoutePolicy[] = [
  // (a) PAID -- enforced before L11.
  { route: 'cognitive/explain/generate', rule: 'PAID' },
  { route: 'cognitive/explain/submit', rule: 'PAID' },
  { route: 'cognitive/remediation/start', rule: 'PAID' },
  { route: 'cognitive/transfer/generate', rule: 'PAID' },
  { route: 'exam-readiness/score', rule: 'PAID' },
  { route: 'exams/instances', rule: 'PAID', note: 'POST (create); listing is ownership only' },
  { route: 'exams/instances/[id]/retake', rule: 'PAID' },
  { route: 'exams/instances/[id]/start', rule: 'PAID' },
  { route: 'learning/session/start', rule: 'PAID' },
  { route: 'quizzes/generate', rule: 'PAID' },
  { route: 'quizzes/generate-and-take', rule: 'PAID' },
  { route: 'quizzes/hint', rule: 'PAID' },
  { route: 'quizzes/session/[quizId]/check', rule: 'PAID' },
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
  { route: 'cognitive/transfer/submit', rule: 'PAID', note: 'AI grading, mastery and evidence' },
  { route: 'student/teacher-interventions/[id]/start', rule: 'PAID' },

  // (b) FREE_IN_DEMO -- AI-assisted content setup.
  { route: 'concepts/suggest', rule: 'FREE_IN_DEMO' },
  { route: 'content/import/analyze', rule: 'FREE_IN_DEMO' },
  { route: 'content/extract-concepts', rule: 'FREE_IN_DEMO' },
  { route: 'content/process', rule: 'FREE_IN_DEMO' },
  { route: 'content/search', rule: 'FREE_IN_DEMO' },
  { route: 'content/upload', rule: 'FREE_IN_DEMO' },

  // (c) CONTINUATION -- not ruled; behaviour unchanged.
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
