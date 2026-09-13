/**
 * LX-1C (repaired in LX-1R) -- RESPONSE / EVIDENCE CONTRACT.
 *
 * A canonical, per-question statement of EXACTLY WHAT the learner must
 * DEMONSTRATE, shared by the four surfaces LX-0 found inconsistent:
 *
 *   QUESTION GENERATION -> QUESTION UI -> ANSWER CAPTURE -> GRADER
 *
 * SCOPE (LX-1R): this contract describes WHAT must be demonstrated only.
 * HOW the learner may express it (typed / structured / math notation /
 * voice) is a SEPARATE concern:
 *   - The current input surface per question is already canonical:
 *     `ANSWER_FORMAT_BY_TYPE` (src/services/quiz-generation.service.ts)
 *     maps every QuestionType to one of six AnswerFormats; the `text`
 *     format is rendered by `MathAnswerEditor` (text + math toolbar).
 *     LX-1 does not re-derive it.
 *   - Voice / Speech-to-Text mapping is owned by LX-8 (Adaptive
 *     Interaction). LX-1 makes NO voice ruling -- in particular there
 *     is NO "SHOW_WORK => voice incompatible" rule; a learner may
 *     verbally explain reasoning, and whether formal derivation needs
 *     notation is an LX-8 decision.
 *
 * FUNDAMENTAL INVARIANT (preserved): the grader may only evaluate an
 * evidence axis this contract declares in `partialCreditDimensions`.
 * If `requiresWork === false`, a correct final answer may never be
 * marked down for missing work. If `requiresWork === true`, the UI
 * must tell the learner before they submit.
 *
 * This module does NOT grade, does NOT generate, adds NO persisted
 * field, and is a pure derivation from the EXISTING `GeneratedQuestion`
 * shape (`type` + already-defined semantic tags).
 */

import type {
  QuestionType,
  ExpectedReasoningType,
  QuestionIntent,
  EvidenceDimension,
} from '@/services/quiz-generation.service';
import type { EvidenceMode } from '@/lib/activity-taxonomy';

/** Bumped from 1 -> 2 in LX-1R (expression fields + speculative multiPart removed). */
export const RESPONSE_EVIDENCE_CONTRACT_VERSION = 2 as const;

/**
 * The learner-facing "what is being asked of me" bucket (preserved from
 * LX-1). Deliberately small: DERIVE folds into SHOW_WORK; COMPARE folds
 * into EXPLAIN/JUSTIFY (a content shape, not an evidence obligation);
 * MULTI_PART is not represented -- no current generator declares a
 * multi-part requirement (removed in LX-1R per the minimality rule).
 */
export type EvidenceRequirementKind =
  | 'ANSWER_ONLY' // a final answer is the whole ask
  | 'SHOW_WORK' // procedure/working is required *and* a final answer
  | 'EXPLAIN' // a reasoned explanation in the learner's own words
  | 'JUSTIFY'; // a claim/choice *and* the reasoning that defends it

/** Which credit axes the grader is allowed to score. Mirrors GradeAnswerResult's existing `score` + `reasoningValid`. */
export type PartialCreditDimension = 'FINAL_ANSWER' | 'METHOD' | 'REASONING';

export interface ResponseEvidenceContract {
  contractVersion: typeof RESPONSE_EVIDENCE_CONTRACT_VERSION;
  /** The headline ask -- drives the single learner-facing instruction line (copy is LX-4). */
  kind: EvidenceRequirementKind;

  // --- WHAT the grader is permitted to require ---
  /** A final answer is expected and graded. */
  requiresFinalAnswer: boolean;
  /** Procedure / working must be shown; absence of work may reduce the grade ONLY when this is true. */
  requiresWork: boolean;
  /** A natural-language explanation is expected and graded. */
  requiresExplanation: boolean;
  /** A defence of a claim/choice is expected and graded. */
  requiresJustification: boolean;

  // --- evidence weight ---
  /**
   * This response must be produced under INDEPENDENT/ASSESSMENT
   * Evidence Mode to count as independent proof. Sourced verbatim from
   * the canonical activity-taxonomy EvidenceMode -- never re-derived.
   */
  independentEvidenceRequired: boolean;

  /**
   * The credit axes the grader MAY score. This is the grader whitelist
   * -- `contractPermitsGradingOn` is the guard LX-4 places in front of
   * `gradeAnswer`.
   */
  partialCreditDimensions: PartialCreditDimension[];

  /** Which existing `GeneratedQuestion` inputs produced this contract -- provenance, no new data. */
  derivedFrom: {
    questionType: QuestionType;
    expectedReasoningType: ExpectedReasoningType | null;
    questionIntent: QuestionIntent | null;
    evidenceDimensions: EvidenceDimension[] | null;
  };
}

/** The subset of a `GeneratedQuestion` this derivation reads. Kept narrow so callers can pass a partial. */
export interface ResponseContractQuestionView {
  type: QuestionType;
  expectedReasoningType?: ExpectedReasoningType | null;
  questionIntent?: QuestionIntent | null;
  evidenceDimensions?: EvidenceDimension[] | null;
}

/**
 * Baseline evidence obligation per current question type -- a
 * formalisation of what the current `gradeAnswer` system prompt ALREADY
 * does per type (LX-0 deliverable B1). It adds no new expectation; it
 * makes the existing implicit ones explicit and inspectable.
 *
 * NOTE `numeric_problem` -> ANSWER_ONLY: this is the LX-0 "Expectation
 * Contract Failure" fix. Work is required for a numeric question ONLY
 * when a canonical `expectedReasoningType = PROCEDURAL` tag says so.
 */
const KIND_BY_TYPE: Record<QuestionType, EvidenceRequirementKind> = {
  multiple_choice: 'ANSWER_ONLY',
  multi_select: 'ANSWER_ONLY',
  true_false: 'ANSWER_ONLY',
  yes_no: 'ANSWER_ONLY',
  matching: 'ANSWER_ONLY',
  ordering: 'ANSWER_ONLY',
  classification: 'ANSWER_ONLY',
  fill_blank: 'ANSWER_ONLY',
  short_answer: 'ANSWER_ONLY',
  numeric_problem: 'ANSWER_ONLY',
  step_by_step: 'SHOW_WORK',
  case_study: 'EXPLAIN',
  open_ended: 'EXPLAIN',
  comparison: 'EXPLAIN',
  scenario: 'JUSTIFY',
  prediction: 'JUSTIFY',
  error_detection: 'JUSTIFY',
  justification: 'JUSTIFY',
};

const FREE_TEXT_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'short_answer',
  'open_ended',
  'fill_blank',
  'numeric_problem',
  'step_by_step',
  'case_study',
  'scenario',
  'error_detection',
  'justification',
  'comparison',
  'prediction',
]);

/**
 * Derive the canonical Response/Evidence Contract for one question.
 *
 * `evidenceMode` is the ALREADY-FIXED attempt EvidenceMode
 * (activity-taxonomy.evidenceModeForActivity) -- passed in, never
 * recomputed. Its only effect here is `independentEvidenceRequired`.
 */
export function deriveResponseEvidenceContract(
  q: ResponseContractQuestionView,
  evidenceMode: EvidenceMode,
): ResponseEvidenceContract {
  const reasoning = q.expectedReasoningType ?? null;

  let kind = KIND_BY_TYPE[q.type];

  // A PRESENT, canonical semantic tag may only TIGHTEN the obligation
  // (never loosen a reasoning-first type into ANSWER_ONLY).
  if (reasoning === 'PROCEDURAL' && (q.type === 'numeric_problem' || q.type === 'step_by_step')) {
    kind = 'SHOW_WORK';
  } else if (reasoning === 'METACOGNITIVE' && kind === 'ANSWER_ONLY') {
    kind = 'EXPLAIN';
  } else if (reasoning === 'CONCEPTUAL' && kind === 'ANSWER_ONLY' && FREE_TEXT_TYPES.has(q.type)) {
    kind = 'EXPLAIN';
  }

  const requiresWork = kind === 'SHOW_WORK';
  const requiresExplanation = kind === 'EXPLAIN' || kind === 'JUSTIFY';
  const requiresJustification = kind === 'JUSTIFY';
  const requiresFinalAnswer = kind !== 'EXPLAIN'; // an explanation-only ask has no separate "final answer"

  const partialCreditDimensions: PartialCreditDimension[] = [];
  if (requiresFinalAnswer) partialCreditDimensions.push('FINAL_ANSWER');
  if (requiresWork) partialCreditDimensions.push('METHOD');
  if (requiresExplanation || requiresJustification) partialCreditDimensions.push('REASONING');

  return {
    contractVersion: RESPONSE_EVIDENCE_CONTRACT_VERSION,
    kind,
    requiresFinalAnswer,
    requiresWork,
    requiresExplanation,
    requiresJustification,
    independentEvidenceRequired: evidenceMode === 'INDEPENDENT' || evidenceMode === 'ASSESSMENT',
    partialCreditDimensions,
    derivedFrom: {
      questionType: q.type,
      expectedReasoningType: reasoning,
      questionIntent: q.questionIntent ?? null,
      evidenceDimensions: q.evidenceDimensions ?? null,
    },
  };
}

/**
 * THE GRADER GUARD (preserved). Given a contract and an evidence axis
 * the grader is about to score, returns whether the contract permits
 * it. LX-4 wires this in front of `gradeAnswer` so a `requiresWork:false`
 * question can never be reduced solely for absent work.
 */
export function contractPermitsGradingOn(
  contract: ResponseEvidenceContract,
  axis: PartialCreditDimension,
): boolean {
  return contract.partialCreditDimensions.includes(axis);
}

/**
 * LX-8R3 R7 -- maps the canonical `kind` to the ONE instruction line
 * shown above the single `UnifiedResponseComposer`, replacing the
 * separate "type your answer" / "explain your reasoning" copy that
 * used to label two different boxes. Returns an i18n KEY, never a
 * resolved string -- this module stays free of any i18n/React
 * dependency, exactly like the rest of this file; the caller resolves
 * it via `getMessages`. This mapping decides PRESENTATION COPY only --
 * it has no effect on `partialCreditDimensions`/grading, which remain
 * entirely governed by the `kind`-derived fields above.
 */
export function responseInstructionKey(
  kind: EvidenceRequirementKind,
): 'response.instructionAnswerOnly' | 'response.instructionShowWork' | 'response.instructionJustify' | 'response.instructionExplain' {
  switch (kind) {
    case 'ANSWER_ONLY':
      return 'response.instructionAnswerOnly';
    case 'SHOW_WORK':
      return 'response.instructionShowWork';
    case 'JUSTIFY':
      return 'response.instructionJustify';
    case 'EXPLAIN':
      return 'response.instructionExplain';
  }
}
