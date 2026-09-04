import type { AICapability } from './types';
import { AIExecutionError } from './errors';

/**
 * Version-controlled-in-code prompt registry (Step 9). Not a remote
 * prompt-management platform -- just an explicit id/version for every
 * AI capability StudyUs actually has, so every execution can answer
 * "which prompt, which version" (Step 3-4, Step 23).
 *
 * Phase 0E1 does NOT rewrite these prompts for quality -- each one is
 * v1, registered here to describe the exact prompt already live in the
 * corresponding service file. Prompt improvements are a later,
 * separately-tested domain phase.
 */
export interface PromptDefinition {
  id: string;
  version: string;
  capability: AICapability;
  /** Where the actual prompt text lives -- the registry tracks identity/version, not the text itself. */
  service: string;
  description: string;
}

function definePrompt(def: PromptDefinition): PromptDefinition {
  return def;
}

export const PROMPT_REGISTRY = {
  'quiz.question_generation': definePrompt({
    id: 'quiz.question_generation',
    // STABILIZATION QUIZ PERFORMANCE Step 18: v3 unifies all three live
    // QUESTION_GENERATION call sites (generateQuestionsForConcept,
    // generateQuickCheckQuestions, generatePracticeQuestions), retiring
    // the v1 (legacy batch, pinned)/v2 (quick_check fast path) split
    // from Steps 9/14. That split existed because quick_check's
    // instructions were genuinely different text from the batch path's.
    // v3's change -- an explicit JSON-escaping rule for LaTeX
    // backslashes, added to REQUIREMENTS item 7 (Steps 15-17's root-
    // cause finding: unescaped LaTeX backslashes inside JSON string
    // values either fail to parse or silently corrupt into control
    // characters) -- applies identically to every call site's own
    // wording, so there is no reason for them to diverge here. All
    // three now read `prompt.version` directly rather than pinning a
    // literal string.
    version: 'v3',
    capability: 'QUESTION_GENERATION',
    service: 'quiz-generation.service.ts:generateQuestionsForConcept / generateQuickCheckQuestions / generatePracticeQuestions',
    description:
      'Generates assessment questions for a concept, grounded in retrieved study material or general knowledge, across three call sites sharing this one prompt version: generateQuestionsForConcept (single batch call, all modes except quick_check/topic_practice/review), generateQuickCheckQuestions (quick_check only -- deterministic 6-slot fast path, 6 parallel single-question calls each locked to one of 4 allowed types, all-or-nothing), generatePracticeQuestions (topic_practice/review only -- balanced parallel chunks of up to 4 questions each, partial-tolerant). v3 (Step 18) adds an explicit instruction that LaTeX backslashes inside the JSON output must be escaped for JSON validity, plus local (non-shared) pre-parse repair and post-parse corruption rejection at every call site -- see quiz-generation.service.ts:repairInvalidJsonEscapes/isLatexCorrupted.',
  }),
  'quiz.free_text_grading': definePrompt({
    id: 'quiz.free_text_grading',
    version: 'v1',
    capability: 'GRADING',
    service: 'quiz-generation.service.ts:gradeAnswer',
    description: 'Grades a free-text quiz answer for correctness, partial credit, error type, and reasoning validity.',
  }),
  'quiz.question_hint': definePrompt({
    id: 'quiz.question_hint',
    version: 'v2',
    capability: 'OTHER',
    service: 'quiz-generation.service.ts:generateQuestionHint',
    description:
      'Generates 2-3 non-revealing hints for a quiz question the student is actively answering. v2 (Phase 5-R): optionally accepts an adaptive teaching-constraints block (support level/barrier/strategy) that shapes hint explicitness -- the CRITICAL no-answer-reveal rules are restated after it and are never weakened by it. Behavior is identical to v1 when no adaptive context is supplied.',
  }),
  'misconception.classification': definePrompt({
    id: 'misconception.classification',
    version: 'v1',
    capability: 'CLASSIFICATION',
    service: 'misconception.service.ts:classifyMisconception',
    description: "Classifies a student's incorrect answer into a reusable misconception signature, preferring an existing one.",
  }),
  'transfer.activity_generation': definePrompt({
    id: 'transfer.activity_generation',
    version: 'v1',
    capability: 'CONTENT_GENERATION',
    service: 'transfer.service.ts:generateTransferActivity',
    description: 'Writes one application question testing transfer of a concept to a new context at a given distance.',
  }),
  'transfer.response_evaluation': definePrompt({
    id: 'transfer.response_evaluation',
    version: 'v1',
    capability: 'TRANSFER_EVALUATION',
    service: 'transfer.service.ts:evaluateTransferResponse',
    description: "Grades a student's transfer response as correct/partial/incorrect with brief feedback.",
  }),
  'explain.prompt_generation': definePrompt({
    id: 'explain.prompt_generation',
    version: 'v2',
    capability: 'CONTENT_GENERATION',
    service: 'explain-defend.service.ts:generateExplainPrompt',
    description:
      'Writes one open-ended reasoning question for a concept, plus the checkable rubric elements a strong answer must include. v2 (Phase 5-R): optionally accepts an adaptive teaching-constraints block for a REMEDIATION EXPLAIN step (misconception/prerequisite targeting, support level, strategy) -- identical to v1 output shape when no adaptive context is supplied. Also now threads AIExecutionContext (student/subject/concept) for provenance traceability.',
  }),
  'explain.rubric_evaluation': definePrompt({
    id: 'explain.rubric_evaluation',
    version: 'v1',
    capability: 'EXPLANATION_EVALUATION',
    service: 'explain-defend.service.ts:evaluateExplanation',
    description: "Scores a student's open-ended answer against a fixed 0-4 rubric (concept accuracy, reasoning, completeness).",
  }),
  'concept.extraction': definePrompt({
    id: 'concept.extraction',
    version: 'v1',
    capability: 'CLASSIFICATION',
    service: 'concept-extraction.service.ts:extractConceptsFromChunk',
    description: 'Extracts canonical learning concepts (id, label, type, difficulty, prerequisites) from a chunk of study material.',
  }),
  'concept.name_suggestions': definePrompt({
    id: 'concept.name_suggestions',
    version: 'v1',
    capability: 'OTHER',
    service: 'concept-extraction.service.ts:suggestConceptNames',
    description: 'Autocomplete suggestions for a concept/topic name as the student types.',
  }),
  'concept.explanation': definePrompt({
    id: 'concept.explanation',
    version: 'v1',
    capability: 'CONTENT_GENERATION',
    service: 'concept-explanation.service.ts:getConceptExplanation',
    description: 'Generates a cached, student-facing explanation of one concept (summary, sections, examples, optional formula flag).',
  }),
  'concept.graph.prerequisite_inference': definePrompt({
    id: 'concept.graph.prerequisite_inference',
    version: 'v1',
    capability: 'COGNITIVE_ANALYSIS',
    service: 'concept-graph.service.ts:inferPrerequisitesForConcept',
    description: 'Infers cognitive relationships (prerequisite/depends-on/related/commonly-confused) between concepts in a subject.',
  }),
  'topic_hierarchy.classification': definePrompt({
    id: 'topic_hierarchy.classification',
    version: 'v1',
    capability: 'CLASSIFICATION',
    service: 'topic-hierarchy.service.ts:callClaudeForHierarchy',
    description: "Organizes a subject's concepts into a two-level Topic -> Subtopic navigation outline.",
  }),
  'localization.batch_translate': definePrompt({
    id: 'localization.batch_translate',
    version: 'v1',
    capability: 'CONTENT_GENERATION',
    service: 'localization.service.ts:translateBatch',
    description: 'Batch-translates short educational labels (topic/subtopic/concept names) into the target display language.',
  }),
  'error_intelligence.pattern_guidance': definePrompt({
    id: 'error_intelligence.pattern_guidance',
    version: 'v1',
    capability: 'CONTENT_GENERATION',
    service: 'error-intelligence.service.ts:getErrorPatternGuidance',
    description: "Formative feedback on a student's recurring error pattern (not a full re-teach of the concept).",
  }),
  'tutor.chat_reply': definePrompt({
    id: 'tutor.chat_reply',
    version: 'v2',
    capability: 'TUTOR',
    service: 'tutor.service.ts:sendMessage',
    description:
      'Conversational tutor reply grounded in retrieved study material and a compact learner-aware strategy hint. v2 (Phase 5-R): when Phase 4 has an active decision for the message\'s concept, the pedagogical-approach section is now the canonical adaptive teaching-constraints block (barrier/support level/strategy/avoid-strategies) instead of the Phase 2 buildCompactTutorContext summary; buildCompactTutorContext remains the fallback when Phase 4 has no active decision for the concept. Also now threads AIExecutionContext for provenance traceability.',
  }),
  'formula.interactive_widget': definePrompt({
    id: 'formula.interactive_widget',
    version: 'v1',
    capability: 'CONTENT_GENERATION',
    service: 'interactive-formula.service.ts:generateInteractiveFormula',
    description: 'Designs an interactive slider-driven formula widget (variables, ranges, expression, optional diagram) for a concept, when one applies.',
  }),
  'embedding.text_embedding': definePrompt({
    id: 'embedding.text_embedding',
    version: 'v1',
    capability: 'EMBEDDING',
    service: 'embedding.service.ts:generateEmbedding',
    description: 'text-embedding-3-small vector embedding of a content chunk, for pgvector semantic search.',
  }),
  'legacy.concept_extraction': definePrompt({
    id: 'legacy.concept_extraction',
    version: 'v1',
    capability: 'CLASSIFICATION',
    service: 'ai.service.ts:extractConceptsFromText',
    description: "Older, simpler concept-extraction path used by /api/concepts/extract -- parallel to concept-extraction.service.ts's, not yet consolidated.",
  }),
  'legacy.image_transcription': definePrompt({
    id: 'legacy.image_transcription',
    version: 'v1',
    capability: 'CONTENT_GENERATION',
    service: 'ai.service.ts:extractTextFromImage',
    description: 'Vision transcription of an uploaded image (notes/textbook page/diagram) into study-ready text.',
  }),
  'legacy.question_generation': definePrompt({
    id: 'legacy.question_generation',
    version: 'v1',
    capability: 'QUESTION_GENERATION',
    service: 'ai.service.ts:generateQuestion',
    description: 'Older, single-question-at-a-time generator used by /api/quizzes/generate -- parallel to quiz-generation.service.ts, not yet consolidated.',
  }),
} as const satisfies Record<string, PromptDefinition>;

export type PromptId = keyof typeof PROMPT_REGISTRY;

/** Looks up a prompt's registered definition. Throws CONFIGURATION_ERROR on an unregistered id -- a typo here must fail loudly, not silently ship unversioned. */
export function getPrompt(id: PromptId): PromptDefinition {
  const def = PROMPT_REGISTRY[id];
  if (!def) {
    throw new AIExecutionError('CONFIGURATION_ERROR', `No prompt registered for id "${id}"`);
  }
  return def;
}
