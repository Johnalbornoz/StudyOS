/**
 * Per-mode generation configuration (guidance, default size, visual-aid
 * rate, evidence source) -- ONE source shared by the generate-and-take route
 * (emergency / legacy generation) and the background generation worker
 * (LEARNING_ACTIVITY_DELIVERY), so bank candidates are generated exactly as
 * the live path would generate them. Moved verbatim from the route.
 */
import type { EvidenceSourceType } from '@/lib/algorithms/mastery';
import type { QuizMode } from '@/services/quiz-persistence.service';
import { CANONICAL_PROVE_GENERATION_CONFIG } from '@/lib/quiz/canonical-prove-config';

/**
 * Every mode offers Claude the full 18-type catalog -- it isn't
 * restricted to a fixed subset. `guidance` steers the STYLE and rigor
 * (how fast, how demanding), but which specific types actually get
 * used within that is Claude's call per question, based on what each
 * piece of content calls for.
 */
export const QUIZ_MODE_CONFIG: Record<
  QuizMode,
  { guidance: string; defaultMax: number; visualAidRate: number; evidenceSource: EvidenceSourceType }
> = {
  quick_check: {
    guidance:
      'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.',
    defaultMax: 6,
    visualAidRate: 0,
    evidenceSource: 'PRACTICE_QUESTION',
  },
  topic_practice: {
    guidance: 'Everyday practice on this concept. Use a natural mix of types that fit the material -- don\'t default to only multiple_choice.',
    defaultMax: 20,
    visualAidRate: 0.1,
    evidenceSource: 'PRACTICE_QUIZ',
  },
  review: {
    // Reinforcement Review (Activity Type REVIEW, Evidence Mode
    // PRACTICE) -- same cognitive shape as topic_practice, AI may
    // assist. Distinct from retention_check below, which is the other,
    // unassisted, "prove you still remember" flavor of Review.
    guidance: 'Everyday practice on this concept. Use a natural mix of types that fit the material -- don\'t default to only multiple_choice.',
    defaultMax: 20,
    visualAidRate: 0.1,
    evidenceSource: 'PRACTICE_QUIZ',
  },
  retention_check: {
    // Retention Review (Activity Type RETENTION_CHECK, Evidence Mode
    // INDEPENDENT) -- StudyUS needs unassisted proof the student still
    // remembers, so this is short and low-friction like quick_check,
    // just tagged with a different Activity Type/Evidence Mode.
    guidance:
      'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.',
    defaultMax: 6,
    visualAidRate: 0,
    evidenceSource: 'PRACTICE_QUESTION',
  },
  cumulative_assessment: {
    guidance:
      'A broader check spanning several concepts. Favor types that test connections and application across ideas (comparison, classification, matching, case_study) alongside standard types, whatever each concept\'s content actually supports.',
    defaultMax: 20,
    visualAidRate: 0.15,
    evidenceSource: 'CUMULATIVE_ASSESSMENT',
  },
  exam_simulation: {
    guidance:
      'Simulate real exam rigor. Favor the most demanding types this material genuinely supports (step_by_step, case_study, error_detection, justification, numeric_problem, scenario) as well as standard types -- but never force a type onto content that doesn\'t suit it.',
    defaultMax: 20,
    visualAidRate: 0.2,
    evidenceSource: 'EXAM_SIMULATION',
  },
  diagnostic_check: {
    guidance:
      'This is a short DIAGNOSTIC check, not a teaching moment -- its only job is to reveal whether the student genuinely understands this concept independently. Prefer types that can\'t be answered by pattern-matching or formula-plugging alone (short_answer, error_detection, justification, prediction) and are hard to guess. Keep each question tightly focused on the core idea of this concept, not tangential details.',
    defaultMax: 3,
    visualAidRate: 0,
    evidenceSource: 'DIAGNOSTIC',
  },
  // CANON-R6 -- the exact-10, independent canonical v1 Prove check.
  // `defaultMax` is never actually consulted for a genuinely
  // v1-authorized request (the server-derived override below always
  // forces exactly `v1Marker.itemCount.authorized`, 10 today) -- it
  // exists only so this Record stays total and so an unauthorized
  // `canonical_prove` request (rejected before generation, see the
  // v1Marker guard) never needs to reach this value at all. Reuses the
  // SAME question-type catalog and generation prompt shape as
  // quick_check (no new prompt template) -- guidance text differs only
  // to reflect the higher item count and higher stakes; no AI provider,
  // routing, or Quality Gate code was touched.
  canonical_prove: {
    // CANON-R6R1 Part 9 -- the trailing sentence is a lightweight,
    // isolated generation-guidance nudge only (reduces churn/retries);
    // it is NEVER the enforcement mechanism -- exact-duplicate exclusion
    // is a deterministic post-generation server check
    // (`filterExactDuplicates`, run inside
    // `generateCanonicalProveQuestions` -- CANON-R6-PERF-R1/R2), which
    // runs regardless of whether Claude actually honored this text.
    guidance: CANONICAL_PROVE_GENERATION_CONFIG.guidance,
    defaultMax: 10,
    visualAidRate: CANONICAL_PROVE_GENERATION_CONFIG.visualAidRate,
    evidenceSource: 'SOLO_VERIFICATION',
  },
  // CANON-V2-ARCH-CLEANUP -- the exact-10, independent, NOVEL canonical
  // v1 Retain check. `defaultMax` is never actually consulted for a
  // genuinely v1-authorized request (same reasoning as canonical_prove
  // above).
  canonical_retain: {
    guidance:
      'This is an independent retention check -- verify the student still genuinely remembers this concept, unaided, using NEW questions they have never seen before (never a repeat of a prior practice/prove/retain question, even reworded). Prefer types that cannot be answered by pattern-matching or formula-plugging alone (short_answer, error_detection, justification, prediction) and are hard to guess. Keep each question tightly focused on the core idea of this concept.',
    defaultMax: 10,
    visualAidRate: 0,
    evidenceSource: 'SOLO_VERIFICATION',
  },
  // CANON-V2-ARCH-CLEANUP -- the ONE canonical Transfer mode: exactly 3
  // structured, independent challenges. `defaultMax` is never consulted
  // (canonical-transfer-generation.service.ts always requests exactly
  // 3) -- present only so this Record stays total.
  canonical_transfer: {
    guidance:
      'This is an independent Transfer check -- the student must apply this concept, unaided, in contexts progressively further from how it was originally taught. Every challenge requires the student to show their reasoning, not just a final answer.',
    defaultMax: 3,
    visualAidRate: 0,
    evidenceSource: 'SOLO_VERIFICATION',
  },
  // CANON-V2-ARCH-CLEANUP -- the ONE canonical LEARN comprehension
  // checkpoint: assisted, small, focused entirely on verifying genuine
  // understanding (never a generic practice quiz relabeled).
  canonical_learn_check: {
    guidance:
      'This is a comprehension checkpoint, not a practice drill -- verify the student genuinely understands the core idea of this concept (assistance/hints are allowed; the goal is confirming understanding, not testing independence). Prefer types that reveal genuine comprehension rather than pattern-matching (short_answer, error_detection, justification).',
    defaultMax: 5,
    visualAidRate: 0,
    evidenceSource: 'PRACTICE_QUESTION',
  },
};
