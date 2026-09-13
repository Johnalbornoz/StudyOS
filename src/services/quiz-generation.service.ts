/**
 * Quiz Generation Service - Generate questions from concepts using RAG
 *
 * Process:
 * 1. Get concept details
 * 2. Retrieve relevant chunks (RAG)
 * 3. Build augmented prompt with context
 * 4. Call Claude to generate questions
 * 5. Validate and store questions
 *
 * All questions are grounded in student's actual content
 */

import { retrieveContext } from './rag.service';
import { normalizeText } from './content-chunking.service';
import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { commandTermsForDifficulty, IB_SUBJECT_GROUPS, MYP_CRITERIA } from '@/lib/ib';
import { executeAI, validateJson, checks, clamp, getPrompt, type AIProvenance, type AIExecutionContext } from '@/lib/ai';
import { callModel, parseCallModelUsage, type CallModelResult } from '@/lib/ai/adapters/call-model';
import { resolveModels, TERRA } from '@/lib/ai/model-routing';
import { budgetFor, fitContextChunks } from '@/lib/ai/token-budgets';
import { GENERATED_QUESTION_BATCH_SCHEMA } from '@/lib/ai/schemas';
import type { ProviderUsage } from '@/lib/ai/usage';

// LX-4P-PERF-R1C C1/C16: the canonical learner runtime is OpenAI-only.
// Question generation -> Luna (primary); grading/evaluation -> Terra.
const QGEN_ROUTE = resolveModels('QUESTION_GENERATION');
const GRADE_ROUTE = resolveModels('GRADING');
import { buildTeachingConstraintsBlock, transferPreparationInstruction, type TeachingGenerationContext } from '@/lib/adaptive-teaching-generation';

export interface IBContext {
  programme: 'MYP' | 'DP';
  subjectGroup: string | null;
  level: 'SL' | 'HL' | null;
}

/**
 * The 18 question models the product supports. "Pregunta con imagen"
 * and "pregunta basada en gráfica" from the original brief aren't
 * separate types here -- they're the `visualAid` attachment below,
 * which any of these 18 types can carry. That's a better fit for how
 * they're actually used (a multiple-choice question ABOUT a diagram is
 * still fundamentally multiple-choice) and avoids needing image
 * storage infrastructure that doesn't exist: diagrams are Claude-
 * generated inline SVG, and graphs are a small Claude-generated
 * dataset rendered as a chart client-side.
 */
export type QuestionType =
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false'
  | 'yes_no'
  | 'short_answer'
  | 'open_ended'
  | 'fill_blank'
  | 'matching'
  | 'ordering'
  | 'classification'
  | 'numeric_problem'
  | 'step_by_step'
  | 'case_study'
  | 'scenario'
  | 'error_detection'
  | 'justification'
  | 'comparison'
  | 'prediction';

export type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

export const ANSWER_FORMAT_BY_TYPE: Record<QuestionType, AnswerFormat> = {
  multiple_choice: 'single_choice',
  true_false: 'single_choice',
  yes_no: 'single_choice',
  multi_select: 'multi_choice',
  matching: 'matching',
  ordering: 'ordering',
  classification: 'classification',
  short_answer: 'text',
  open_ended: 'text',
  fill_blank: 'text',
  numeric_problem: 'text',
  step_by_step: 'text',
  case_study: 'text',
  scenario: 'text',
  error_detection: 'text',
  justification: 'text',
  comparison: 'text',
  prediction: 'text',
};

export interface QuestionOption {
  id: string;
  text: string;
}

/**
 * Phase 3 Pre-flight: optional question-evidence semantics. Every field
 * is optional; a question that omits them behaves exactly as before.
 *
 * Phase 3D: cognitiveLevel and questionIntent are now genuinely produced
 * by generateQuestionsForConcept -- requested in the generation prompt
 * (buildQuestionGenerationPrompt) and read back from the AI's raw output
 * (only a known enum value is ever accepted, otherwise left undefined --
 * never fabricated), which is also what makes the two corresponding
 * evaluateVariantEquivalence dimensions non-vacuous checks rather than
 * automatic passes. evidenceDimensions, expectedReasoningType, and
 * learningObjectiveId remain deliberately unpopulated by generation --
 * no reliable signal for them exists yet (evidenceDimensions overlaps
 * EvidenceMode's own already-authoritative independence dimension;
 * expectedReasoningType and learningObjectiveId would require either a
 * second AI judgment call with no grounding to check it against, or a
 * curriculum-mapping input this codebase doesn't have) -- a conscious
 * scope decision, not an oversight, left as future-friendly fields that
 * existing consumers (equivalence checking, questionSemantics pass-
 * through) already handle correctly whenever they ARE present.
 */
export type QuestionIntent = 'CHECK_UNDERSTANDING' | 'CHECK_APPLICATION' | 'CHECK_TRANSFER' | 'DIAGNOSTIC_PROBE' | 'VERIFICATION';
export type EvidenceDimension = 'understanding' | 'independence' | 'application' | 'retention' | 'transfer';
export type CognitiveLevel = 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' | 'SYNTHESIS' | 'EVALUATION';

/**
 * Phase 3D: the AI is only ever asked to tag a question with one of the
 * four organic, content-derived intents below (see REQUIREMENTS item 8
 * in buildQuestionGenerationPrompt) -- "VERIFICATION" is deliberately
 * excluded from what generation can produce, because it isn't a
 * property of the question's content but of the calling context (a
 * question re-asked specifically to check independence after a
 * verification trigger fires); generateQuestionVariant inherits the
 * SOURCE question's questionIntent onto its variant rather than letting
 * generation invent "VERIFICATION" itself.
 */
const KNOWN_QUESTION_INTENTS = new Set<string>(['CHECK_UNDERSTANDING', 'CHECK_APPLICATION', 'CHECK_TRANSFER', 'DIAGNOSTIC_PROBE']);
/**
 * Exported (Phase 3-R) so any reader that needs to validate a
 * persisted/raw cognitiveLevel string (e.g. getAssessmentStateForConcept's
 * bounded cognitive-demand scan) reuses this single source of truth
 * rather than re-declaring a second, potentially-drifting enum set.
 */
export const KNOWN_COGNITIVE_LEVELS = new Set<string>(['RECALL', 'COMPREHENSION', 'APPLICATION', 'ANALYSIS', 'SYNTHESIS', 'EVALUATION']);
export type ExpectedReasoningType = 'FACTUAL' | 'PROCEDURAL' | 'CONCEPTUAL' | 'METACOGNITIVE';
/**
 * LX-4R R5: `expectedReasoningType` IS now requested at generation time
 * (the generator wrote the question, it knows what reasoning it
 * demands) and read back with the same known-enum-only guard as
 * `cognitiveLevel` -- never fabricated after the learner answers, never
 * left to the grader to decide. Feeds `deriveResponseEvidenceContract`
 * (which only TIGHTENS the obligation when the tag is present).
 */
export const KNOWN_EXPECTED_REASONING_TYPES = new Set<string>(['FACTUAL', 'PROCEDURAL', 'CONCEPTUAL', 'METACOGNITIVE']);

export interface VisualAid {
  kind: 'diagram' | 'chart';
  svg?: string; // inline SVG markup for a diagram, sanitized before storage
  chartData?: {
    chartType: 'line' | 'bar';
    labels: string[];
    values: number[];
    xLabel?: string;
    yLabel?: string;
  };
  caption?: string;
}

export interface GeneratedQuestion {
  id: string;
  conceptId: string;
  type: QuestionType;
  answerFormat: AnswerFormat;
  question: string;
  options?: QuestionOption[]; // single_choice / multi_choice
  matchingPairs?: { left: string; right: string }[]; // matching: left[i] <-> right[i] is correct
  orderingItems?: string[]; // ordering: this array IS the correct order
  classificationCategories?: string[]; // classification: available buckets
  classificationItems?: { item: string; category: string }[]; // classification: item -> correct category
  blankTemplate?: string; // fill_blank: display text with ___ markers (question holds the prose prompt)
  visualAid?: VisualAid;
  correctAnswer: string; // canonical answer, format depends on answerFormat (see grading)
  explanation: string;
  difficulty: number; // 1-5
  calculatorAllowed?: boolean; // only set when the question involves numerical calculation
  sourceReference?: string;
  askConfidence?: boolean; // set by the route after generation, per shouldAskConfidence() -- not decided here

  // Phase 3 Pre-flight question evidence semantics -- see the type docs above.
  questionIntent?: QuestionIntent;
  evidenceDimensions?: EvidenceDimension[];
  cognitiveLevel?: CognitiveLevel;
  expectedReasoningType?: ExpectedReasoningType;
  learningObjectiveId?: string;
}

export const ALL_QUESTION_TYPES: QuestionType[] = [
  'multiple_choice', 'multi_select', 'true_false', 'yes_no', 'short_answer',
  'open_ended', 'fill_blank', 'matching', 'ordering', 'classification',
  'numeric_problem', 'step_by_step', 'case_study', 'scenario',
  'error_detection', 'justification', 'comparison', 'prediction',
];

function typeInstruction(type: QuestionType): string {
  switch (type) {
    case 'multiple_choice':
      return 'multiple_choice: 4 options (one correct, three plausible distractors). "options" is an array of {"id":"A".."D","text":"..."}. "correctAnswer" is the correct option\'s id.';
    case 'multi_select':
      return 'multi_select: 4-6 options where 2 or more are correct. "options" is an array of {"id","text"}. "correctAnswer" is a comma-separated list of correct ids, e.g. "A,C".';
    case 'true_false':
      return 'true_false: "options" is exactly [{"id":"true","text":"Verdadero/True"},{"id":"false","text":"Falso/False"}] (translated to the target language). "correctAnswer" is "true" or "false".';
    case 'yes_no':
      return 'yes_no: "options" is exactly [{"id":"yes","text":"Sí/Yes"},{"id":"no","text":"No"}] (translated). "correctAnswer" is "yes" or "no".';
    case 'short_answer':
      return 'short_answer: expects a one-sentence or shorter factual answer. "correctAnswer" is the model answer.';
    case 'open_ended':
      return 'open_ended: expects a multi-sentence explanation showing understanding. "correctAnswer" is a model answer covering the key points.';
    case 'fill_blank':
      return 'fill_blank: "question" contains one or more ___ blanks embedded in a sentence. "correctAnswer" is the exact text that fills the blank(s), comma-separated if more than one blank, in order.';
    case 'matching':
      return 'matching: "matchingPairs" is an array of 4-6 {"left":"...","right":"..."} objects that correctly pair with each other (e.g. term -> definition). No "options" or "correctAnswer" needed (leave correctAnswer as a short human-readable summary of the pairing).';
    case 'ordering':
      return 'ordering: "orderingItems" is an array of 4-6 strings already in the CORRECT order (a process, sequence, or steps). Leave "correctAnswer" as that same sequence joined with " -> ".';
    case 'classification':
      return 'classification: "classificationCategories" is an array of 2-4 category names. "classificationItems" is an array of 5-8 {"item":"...","category":"..."} pairs, where category must be one of classificationCategories. Leave "correctAnswer" as a short human-readable summary.';
    case 'numeric_problem':
      return 'numeric_problem: a calculation problem with a numeric answer. "correctAnswer" is the final numeric result (with units if relevant).';
    case 'step_by_step':
      return 'step_by_step: a multi-step problem (e.g. find A, then use A to find B). "correctAnswer" should show the full worked solution with intermediate results.';
    case 'case_study':
      return 'case_study: present a short realistic situation and ask the student to analyze it using the concept. "correctAnswer" is a model analysis.';
    case 'scenario':
      return 'scenario: a hypothetical "what if" question testing conceptual understanding (e.g. "if we double X, what happens to Y?"). "correctAnswer" is the reasoned answer.';
    case 'error_detection':
      return 'error_detection: show a plausible but flawed worked solution or statement (write it directly inside "question"), and ask the student to identify what is wrong and why. "correctAnswer" names the specific error and the correction.';
    case 'justification':
      return 'justification: ask the student to state which of two or more claims is correct AND justify why. "correctAnswer" states the correct claim and the key justification.';
    case 'comparison':
      return 'comparison: ask the student to explain how two related concepts differ or relate. "correctAnswer" is a model comparison.';
    case 'prediction':
      return 'prediction: ask the student to predict an outcome from a described change in conditions. "correctAnswer" is the reasoned prediction.';
  }
}

function jsonShapeExample(type: QuestionType, withVisual: boolean): string {
  const base: Record<string, string> = {
    type: `"${type}"`,
    question: '"..."',
    difficulty: '3',
    explanation: '"..."',
    correctAnswer: '"..."',
    // Phase 3D: requested for every question -- see REQUIREMENTS item 8
    // in buildQuestionGenerationPrompt for the definitions the model is
    // given for each allowed value.
    cognitiveLevel: '"RECALL"|"COMPREHENSION"|"APPLICATION"|"ANALYSIS"|"SYNTHESIS"|"EVALUATION"',
    questionIntent: '"CHECK_UNDERSTANDING"|"CHECK_APPLICATION"|"CHECK_TRANSFER"|"DIAGNOSTIC_PROBE"',
    // LX-4R R5.
    expectedReasoningType: '"FACTUAL"|"PROCEDURAL"|"CONCEPTUAL"|"METACOGNITIVE"',
  };
  const format = ANSWER_FORMAT_BY_TYPE[type];
  if (format === 'single_choice' || format === 'multi_choice') {
    base.options = '[{"id":"A","text":"..."}, {"id":"B","text":"..."}]';
  }
  if (type === 'matching') {
    base.matchingPairs = '[{"left":"...","right":"..."}]';
  }
  if (type === 'ordering') {
    base.orderingItems = '["step 1", "step 2"]';
  }
  if (type === 'classification') {
    base.classificationCategories = '["category A", "category B"]';
    base.classificationItems = '[{"item":"...","category":"category A"}]';
  }
  if (type === 'numeric_problem' || type === 'step_by_step') {
    base.calculatorAllowed = 'true or false';
  }
  if (withVisual) {
    base.visualAid =
      '{"kind":"diagram"|"chart","svg":"<svg ...>...</svg>" (only if kind=diagram),"chartData":{"chartType":"line"|"bar","labels":["..."],"values":[0],"xLabel":"...","yLabel":"..."} (only if kind=chart),"caption":"..."}';
  }
  const fields = Object.entries(base)
    .map(([k, v]) => `    "${k}": ${v}`)
    .join(',\n');
  return `  {\n${fields}\n  }`;
}

/**
 * Maps the AI's raw per-question JSON objects into GeneratedQuestion
 * records. Shared by generateQuestionsForConcept (batch path) and
 * generateQuickCheckQuestions (quick_check fast path) so the two never
 * drift on how a raw field becomes a stored one.
 */
function mapRawQuestionsToGenerated(questions: any[], conceptId: string, language: string): GeneratedQuestion[] {
  const storedQuestions: GeneratedQuestion[] = [];

  for (const q of questions) {
    if (!q.question || !q.type) continue;
    const type = q.type as QuestionType;
    if (!ANSWER_FORMAT_BY_TYPE[type]) continue;

    const question: GeneratedQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conceptId,
      type,
      answerFormat: ANSWER_FORMAT_BY_TYPE[type],
      question: q.question,
      options: normalizeOptions(q.options),
      matchingPairs: Array.isArray(q.matchingPairs) ? q.matchingPairs : undefined,
      orderingItems: Array.isArray(q.orderingItems) ? q.orderingItems : undefined,
      classificationCategories: Array.isArray(q.classificationCategories) ? q.classificationCategories : undefined,
      classificationItems: Array.isArray(q.classificationItems) ? q.classificationItems : undefined,
      visualAid: sanitizeVisualAid(q.visualAid),
      correctAnswer: q.correctAnswer || '',
      explanation: q.explanation || '',
      difficulty: Math.max(1, Math.min(5, q.difficulty || 3)),
      calculatorAllowed: typeof q.calculatorAllowed === 'boolean' ? q.calculatorAllowed : undefined,
      sourceReference: `Based on student's ${language} materials`,
      // Phase 3D: only a known enum value is ever accepted -- anything
      // else the model emits (a typo, a value outside the requested
      // set, a missing field) becomes undefined, never a fabricated
      // guess. See the type doc above GeneratedQuestion for why
      // evidenceDimensions/expectedReasoningType/learningObjectiveId
      // are deliberately NOT read here.
      cognitiveLevel: KNOWN_COGNITIVE_LEVELS.has(q.cognitiveLevel) ? (q.cognitiveLevel as CognitiveLevel) : undefined,
      questionIntent: KNOWN_QUESTION_INTENTS.has(q.questionIntent) ? (q.questionIntent as QuestionIntent) : undefined,
      // LX-4R R5: known-enum-only, never fabricated (same guard as cognitiveLevel).
      expectedReasoningType: KNOWN_EXPECTED_REASONING_TYPES.has(q.expectedReasoningType)
        ? (q.expectedReasoningType as ExpectedReasoningType)
        : undefined,
    };

    storedQuestions.push(question);
  }

  return storedQuestions;
}

/**
 * Generate quiz questions for a concept. `types` is the catalog Claude
 * is allowed to draw from (defaults to all 18 models) -- it does not
 * dictate which ones to actually use. Claude picks whichever types
 * genuinely fit this specific material and concept, steered by
 * `guidance` (a short instruction reflecting the quiz's purpose, e.g.
 * "keep it fast" for a quick check vs. "use the most demanding types
 * this material supports" for an exam simulation). `visualAidRate`
 * (0-1) controls how often a question gets a generated diagram/chart.
 *
 * STABILIZATION QUIZ PERFORMANCE Step 9: this is back to its original,
 * single-batch-call behavior for every mode (topic_practice, review,
 * retention_check, diagnostic_check, cumulative_assessment,
 * exam_simulation, and generateQuestionVariant's count=1 calls). Step
 * 7's parallel-per-question fan-out was fully reverted here after
 * Step 8's audit found it silently broke assessment integrity for
 * every ASSESSMENT/INDEPENDENT-evidence-mode activity except
 * quick_check (deterministic type-cycling from index 0 systematically
 * contradicted several modes' own guidance -- diagnostic_check could
 * never reach its own preferred types at all; cumulative_assessment/
 * exam_simulation were confirmed live-broken against real production
 * concept counts). quick_check alone got a dedicated, separately
 * audited fast path instead -- see generateQuickCheckQuestions below.
 * model/prompt wording/timeout here are pinned back to their pre-Step-5
 * values. promptVersion now reads the registry's own v3 (Step 18) --
 * see the doc comment above repairInvalidJsonEscapes/isLatexCorrupted
 * for what changed and why every QUESTION_GENERATION call site shares it.
 */
export async function generateQuestionsForConcept(
  conceptId: string,
  studentId: string,
  subjectId: string,
  options: {
    count?: number;
    difficulty?: number;
    types?: QuestionType[];
    guidance?: string;
    language?: string;
    visualAidRate?: number;
    ibContext?: IBContext | null;
    /** LX-4P-PERF-R1C C5: force the Terra fallback model for a quality-gate retry. Defaults to the QUESTION_GENERATION primary (Luna). */
    modelOverride?: string;
    /**
     * LX-4P-PERF-R1G: optional -- reports the REAL provider usage for
     * this generation call (whatever the outcome: accepted, rejected,
     * or a structural parse failure). Never fabricated; omitted fields
     * mean the provider didn't report them. Purely additive -- existing
     * callers that don't pass it see no change.
     */
    onUsage?: (usage: ProviderUsage) => void;
  } = {}
): Promise<GeneratedQuestion[]> {
  const genModel = options.modelOverride || QGEN_ROUTE.primary;
  const count = Math.max(1, Math.min(20, options.count || 20));
  const difficulty = Math.max(1, Math.min(5, options.difficulty || 3));
  const types: QuestionType[] = options.types && options.types.length > 0 ? options.types : ALL_QUESTION_TYPES;
  const guidance = options.guidance || 'Choose whichever question types genuinely fit this specific material best.';
  const language = options.language || 'en';
  const visualAidRate = options.visualAidRate ?? 0;
  const ibContext = options.ibContext ?? null;

  try {
    const context = await retrieveContext(studentId, subjectId, {
      conceptId,
      limit: 5,
    });

    let conceptContext: { label: string; subjectName: string } | null = null;
    if (context.chunks.length === 0) {
      // No uploaded material backs this concept -- e.g. one added via
      // "Escribir un concepto" rather than extracted from a document.
      // Generating grounded-only questions would return nothing at all
      // (a silently empty quiz), so fall back to general subject
      // knowledge instead, same as concept-explanation.service.ts and
      // interactive-formula.service.ts already do for this case.
      const conceptRow = await db.query(
        `
        SELECT COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
        FROM concepts c
        JOIN subjects s ON s.id = c.subject_id
        LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
        WHERE c.id = $1
        `,
        [conceptId, language]
      );
      const row = conceptRow.rows[0];
      if (!row) {
        console.warn(`Concept ${conceptId} not found`);
        return [];
      }
      conceptContext = { label: row.label, subjectName: row.subject_name };
    }

    // LX-4P-PERF-R1C C13: bounded RAG reuse -- fold in only as much
    // retrieved context as this capability's declared budget allows, so
    // a large document can never inflate the prompt unboundedly. Whole
    // chunks only, never below one chunk.
    const contextChunks = fitContextChunks(context.chunks, budgetFor('question_generation_practice').maxContextChars);
    const systemPrompt = buildQuestionGenerationPrompt(
      types,
      difficulty,
      language,
      contextChunks,
      visualAidRate,
      guidance,
      ibContext,
      conceptContext
    );

    const shapeExamples = types.map((t) => jsonShapeExample(t, visualAidRate > 0)).join(',\n');

    const maxTokens = Math.min(16000, 900 * count + 1500);
    const prompt = getPrompt('quiz.question_generation');
    const { result: questions, execution } = await executeAI({
      capability: prompt.capability,
      risk: 'HIGH_RISK', // correctAnswer feeds gradeStructuredAnswer's deterministic comparison directly
      provider: QGEN_ROUTE.provider,
      model: genModel,
      promptId: prompt.id,
      // STABILIZATION QUIZ PERFORMANCE Step 18: v3 unifies every live
      // QUESTION_GENERATION call site (this one, quick_check's fast
      // path, and the practice/review chunked path) on the same
      // JSON-escaping instruction added to REQUIREMENTS item 7 above --
      // retiring the v1/v2 split from Steps 9/14, which reflected a
      // genuine wording difference this fix does not have (the JSON-
      // escaping requirement applies identically everywhere). See the
      // Step 18 report for why a unified bump was correct here rather
      // than pinning this call site to a stale version.
      promptVersion: prompt.version,
      // STABILIZATION QUIZ PERFORMANCE Step 10: the Step 4 timeoutMs:
      // 60_000 override was a workaround for the ORIGINAL production
      // 500 -- a single N-question batch call genuinely took ~39s. That
      // condition no longer applies to this batch path the way it did:
      // Step 8's audit and Step 9's revert mean this call site's actual
      // production shape (model, prompt wording, count semantics) never
      // changed from what shipped as v1, so the override is removed
      // rather than carried forward as unexplained residue. No explicit
      // timeoutMs here -- falls through to the Gateway's own
      // DEFAULT_AI_TIMEOUT_MS (30_000), same as every other capability
      // that never needed an override.
      context: { studentId, subjectId, conceptId, sourceComponent: 'quiz-generation.service.ts:generateQuestionsForConcept' },
      call: (signal) =>
        callModel(
          {
            provider: QGEN_ROUTE.provider,
            model: genModel,
            maxTokens,
            jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA,
            system: systemPrompt,
            user: `Generate UP TO ${count} questions for this concept using only the provided material -- fewer is fine and expected if the material doesn't genuinely support that many distinct, non-redundant questions. Never pad with repetitive or trivial questions just to reach ${count}; prioritize quality and coverage of distinct ideas in the material over hitting the maximum. For each question, pick whichever type from the allowed list actually fits that piece of content best -- the mix should emerge from what the material calls for, not from forcing variety for its own sake.

Output a JSON object (no markdown fences) with this exact shape -- a "questions" array, one element per question, each element's shape depending on its "type":
{"questions": [
${shapeExamples}
]}`,
          },
          signal
        ),
      validate: (raw) => {
        // LX-4P-PERF-R1F: safe structural diagnostics + the ONE
        // object-root -> GeneratedQuestion[] boundary (parseGeneratedQuestionBatch).
        // STABILIZATION QUIZ PERFORMANCE Step 18's CLASS A/B LaTeX repair
        // and corruption filtering still runs on whatever questions result.
        const message = (raw.raw as any)?.choices?.[0]?.message;
        const finishReason = (raw.raw as any)?.choices?.[0]?.finish_reason ?? null;
        const parseStart = Date.now();
        const outcome = parseGeneratedQuestionBatch(raw.text, finishReason);
        logQuestionBatchDiagnostics({
          model: raw.model,
          finishReason,
          hasContent: !!raw.text,
          contentLength: raw.text?.length ?? 0,
          hasRefusal: !!message?.refusal,
          hasUsage: !!(raw.raw as any)?.usage,
          parsedRoot: outcome.parsedRoot,
          keys: outcome.keys,
          questionsCount: outcome.ok ? outcome.questions.length : null,
          failureStage: outcome.failureStage,
          parseMs: Date.now() - parseStart,
        });
        if (!outcome.ok) {
          return { valid: false, errors: [`${outcome.failureStage}: ${outcome.detail}`] };
        }
        // This path tolerates partial results already (the prompt's own
        // "fewer is fine" semantics), so corrupted items are filtered out
        // rather than failing the whole call.
        const clean = outcome.questions.filter((q: any) => !isLatexCorrupted(q));
        const rejected = outcome.questions.length - clean.length;
        if (rejected > 0) {
          console.warn(`generateQuestionsForConcept: rejected ${rejected} question(s) for suspected LaTeX/JSON corruption`);
        }
        return { valid: true, value: clean };
      },
      // LX-4P-PERF-R1G: extracted once `call` resolves, BEFORE `validate`
      // runs -- so this call's real usage survives regardless of whether
      // `validate` accepts, rejects, or the batch falls back to `[]`.
      parseUsage: (raw) => parseCallModelUsage(raw),
      fallback: () => [],
    });

    options.onUsage?.({
      inputTokens: execution.inputTokens ?? null,
      cachedInputTokens: execution.cachedInputTokens ?? null,
      outputTokens: execution.outputTokens ?? null,
    });

    return mapRawQuestionsToGenerated(questions, conceptId, language);
  } catch (error) {
    console.error('Error generating questions:', error);
    return [];
  }
}

/**
 * STABILIZATION QUIZ PERFORMANCE Step 9: the one sanctioned parallel
 * fast path in this file, exclusively for quick_check (ActivityType
 * SOLO_CHECK, EvidenceMode INDEPENDENT). Step 8's audit found the
 * generic count>1 fan-out unsafe for every other mode but only
 * CONDITIONED for quick_check -- and quick_check's own guidance already
 * names exactly the 4 types this locks itself to, so there's no drift
 * between what this fast path does and what quick_check was always
 * supposed to prefer.
 *
 * Contract (deliberately stricter than the batch path above):
 *   - Always exactly 6 questions -- not caller-configurable. Step 8
 *     only validated this one plan; an arbitrary N was never audited,
 *     so it isn't offered here. (This does mean a caller-supplied
 *     `maxQuestions` override for quick_check, previously honored, no
 *     longer is -- see the Step 9 report.)
 *   - Slot i is deterministically assigned
 *     QUICK_CHECK_TYPES[i % QUICK_CHECK_TYPES.length] in code -- never
 *     left to the model, never drawn from the 18-type catalog.
 *   - All-or-nothing: if any of the 6 slots fails generation,
 *     validation, or returns a type other than its assigned one, the
 *     WHOLE result is [] -- surfaced through the caller's existing
 *     `questions.length === 0` -> GENERATION_FAILED path, the same
 *     contract the batch path already has. No 5-question quick_check
 *     ever reaches storeQuiz().
 *   - the QUESTION_GENERATION route model (LX-4P-PERF-R1C: OpenAI Luna), 30_000ms (the Gateway global default,
 *     not overridden -- Step 10 also removed the batch path's own
 *     60_000 override above, so both paths now use the same default).
 *   - quiz.question_generation v3 (Step 18) -- unified with every other
 *     QUESTION_GENERATION call site; the v1/v2 split from Steps 9/14 is
 *     retired now that all three share the same JSON-escaping fix.
 */
export const QUICK_CHECK_TYPES: QuestionType[] = ['multiple_choice', 'true_false', 'yes_no', 'short_answer'];
const QUICK_CHECK_SLOT_COUNT = 6;
const QUICK_CHECK_MODEL = QGEN_ROUTE.primary;

export async function generateQuickCheckQuestions(
  conceptId: string,
  studentId: string,
  subjectId: string,
  options: {
    difficulty?: number;
    language?: string;
    ibContext?: IBContext | null;
  } = {}
): Promise<GeneratedQuestion[]> {
  const difficulty = Math.max(1, Math.min(5, options.difficulty || 3));
  const language = options.language || 'en';
  const ibContext = options.ibContext ?? null;
  const guidance =
    'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.';

  try {
    const context = await retrieveContext(studentId, subjectId, { conceptId, limit: 5 });

    let conceptContext: { label: string; subjectName: string } | null = null;
    if (context.chunks.length === 0) {
      const conceptRow = await db.query(
        `
        SELECT COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
        FROM concepts c
        JOIN subjects s ON s.id = c.subject_id
        LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
        WHERE c.id = $1
        `,
        [conceptId, language]
      );
      const row = conceptRow.rows[0];
      if (!row) {
        console.warn(`Concept ${conceptId} not found`);
        return [];
      }
      conceptContext = { label: row.label, subjectName: row.subject_name };
    }

    // Shared across all 6 slots -- describes only the 4 allowed shapes,
    // never the full 18-type catalog (a smaller prompt than the batch
    // path's, on top of the parallel-dispatch/Haiku wins).
    // LX-4P-PERF-R1C C13: bounded RAG reuse -- quick_check's slot budget.
    const contextChunks = fitContextChunks(context.chunks, budgetFor('question_generation_slot').maxContextChars);
    const systemPrompt = buildQuestionGenerationPrompt(
      QUICK_CHECK_TYPES,
      difficulty,
      language,
      contextChunks,
      0, // visualAidRate -- quick_check never uses visual aids, matching QUIZ_MODE_CONFIG.quick_check
      guidance,
      ibContext,
      conceptContext
    );
    const prompt = getPrompt('quiz.question_generation');

    const requestSlot = (slotIndex: number, model: string = QUICK_CHECK_MODEL): Promise<any | null> => {
      const assignedType = QUICK_CHECK_TYPES[slotIndex % QUICK_CHECK_TYPES.length];
      const shapeExample = jsonShapeExample(assignedType, false);
      const userMessage = `This is question ${slotIndex + 1} of ${QUICK_CHECK_SLOT_COUNT} in a quick confidence check. Generate EXACTLY 1 question of type "${assignedType}" -- never any other type -- covering a distinct aspect of the concept from the other questions in this set.

Output a JSON object (no markdown fences) with this exact shape -- a "questions" array containing exactly one element:
{"questions": [
${shapeExample}
]}`;
      return executeAI({
        capability: prompt.capability,
        risk: 'HIGH_RISK',
        provider: QGEN_ROUTE.provider,
        model,
        promptId: prompt.id,
        promptVersion: prompt.version, // STABILIZATION Step 18: now v3, unified with every other QUESTION_GENERATION call site (see the doc comment above generateQuestionsForConcept's own promptVersion line)
        timeoutMs: 30_000, // explicit -- the Gateway global default; kept explicit here for clarity even though the batch path above now relies on the same default implicitly (Step 10)
        context: { studentId, subjectId, conceptId, sourceComponent: 'quiz-generation.service.ts:generateQuickCheckQuestions' },
        call: (signal) =>
          callModel(
            {
              provider: QGEN_ROUTE.provider, model,
              maxTokens: budgetFor('question_generation_slot').maxOutputTokens,
              reasoningEffort: budgetFor('question_generation_slot').reasoningEffort,
              jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA,
              system: systemPrompt, user: userMessage,
            },
            signal
          ),
        validate: (raw) => {
          // LX-4P-PERF-R1F: same object-root boundary as every other
          // QUESTION_GENERATION call site. A CLASS B/newline-in-math
          // corruption hit makes this slot invalid, same as any other
          // validation failure -- routes through the existing
          // fallback -> null -> all-or-nothing contract below, never a
          // separate failure path.
          const message = (raw.raw as any)?.choices?.[0]?.message;
          const finishReason = (raw.raw as any)?.choices?.[0]?.finish_reason ?? null;
          const parseStart = Date.now();
          const outcome = parseGeneratedQuestionBatch(raw.text, finishReason);
          logQuestionBatchDiagnostics({
            model: raw.model, finishReason, hasContent: !!raw.text, contentLength: raw.text?.length ?? 0,
            hasRefusal: !!message?.refusal, hasUsage: !!(raw.raw as any)?.usage,
            parsedRoot: outcome.parsedRoot, keys: outcome.keys,
            questionsCount: outcome.ok ? outcome.questions.length : null,
            failureStage: outcome.failureStage, parseMs: Date.now() - parseStart,
          });
          if (!outcome.ok) {
            return { valid: false, errors: [`Slot ${slotIndex}: ${outcome.failureStage}: ${outcome.detail}`] };
          }
          const q = outcome.questions[0];
          if (!q || !q.question || q.type !== assignedType) {
            return { valid: false, errors: [`Slot ${slotIndex} did not return a valid "${assignedType}" question`] };
          }
          if (isLatexCorrupted(q)) {
            console.warn(`quick_check slot ${slotIndex}: rejected for suspected LaTeX/JSON corruption`);
            return { valid: false, errors: [`Slot ${slotIndex} question failed LaTeX/JSON corruption check`] };
          }
          return { valid: true, value: q };
        },
        // Strict sentinel, not [] -- distinguishes "this slot failed" from
        // "this slot legitimately returned nothing," so the all-or-nothing
        // check below can never mistake one for the other.
        fallback: () => null,
      }).then((r) => r.result);
    };

    const slots = await Promise.all(Array.from({ length: QUICK_CHECK_SLOT_COUNT }, (_, i) => requestSlot(i)));
    if (slots.some((q) => q === null)) {
      console.error('quick_check fast path: at least one of 6 slots failed -- returning no questions rather than a partial set');
      return [];
    }

    const storedQuestions = mapRawQuestionsToGenerated(slots as any[], conceptId, language);
    // Defensive double-check of the same all-or-nothing contract --
    // mapRawQuestionsToGenerated could in principle skip a malformed
    // entry even after `validate` accepted it (e.g. a future edit to
    // either function). Never let a partial set slip through silently.
    if (storedQuestions.length !== QUICK_CHECK_SLOT_COUNT) {
      console.error(`quick_check fast path: expected ${QUICK_CHECK_SLOT_COUNT} mapped questions, got ${storedQuestions.length} -- returning no questions rather than a partial set`);
      return [];
    }

    // LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate -- quick_check
    // is gated exactly like every other learner-facing path. All-or-
    // nothing is preserved: every one of the 6 slots must clear the gate,
    // and a slot that fails gets ONE Terra regeneration; if any slot
    // still fails, the whole set is [] (never a partial quick_check).
    const { applyQuestionQualityGate } = await import('@/services/gated-question-generation.service');
    const { recordRuntimeEvent, buildRuntimeEvent } = await import('@/lib/ai/runtime-event');
    const qcGateReq = { conceptId, language, context: { studentId, subjectId } };
    const emitQc = (model: string, fallbackUsed: boolean, acc: number, rej: number, reason?: string) =>
      recordRuntimeEvent(
        buildRuntimeEvent({
          capability: 'QUESTION_GENERATION', provider: 'openai', model,
          promptId: 'quiz.question_generation', promptVersion: 'v3',
          inputTokens: null, cachedInputTokens: null, outputTokens: null, latencyMs: 0,
          fallbackUsed, fallbackReason: reason,
          qualityGateResult: acc > 0 ? (rej > 0 ? 'DETERMINISTIC_FAIL' : 'PASS') : 'REJECTED',
          acceptedCount: acc, rejectedCount: rej,
        }),
      );

    const g1 = await applyQuestionQualityGate(storedQuestions, qcGateReq);
    emitQc(QUICK_CHECK_MODEL, false, g1.accepted.length, g1.deterministicRejected + g1.semanticRejected);
    if (g1.accepted.length === QUICK_CHECK_SLOT_COUNT) return g1.accepted;

    const acceptedSet = new Set(g1.accepted);
    const failedSlots = storedQuestions.map((_, i) => i).filter((i) => !acceptedSet.has(storedQuestions[i]));
    const replacements = await Promise.all(failedSlots.map((i) => requestSlot(i, TERRA)));
    if (replacements.some((r) => r === null)) {
      console.error('quick_check fast path: a Terra slot regeneration failed -- returning no questions rather than a partial set');
      emitQc(TERRA, true, 0, failedSlots.length, 'a slot regeneration failed');
      return [];
    }
    const replMapped = mapRawQuestionsToGenerated(replacements as any[], conceptId, language);
    if (replMapped.length !== failedSlots.length) {
      emitQc(TERRA, true, 0, failedSlots.length, 'replacement mapping short');
      return [];
    }
    const g2 = await applyQuestionQualityGate(replMapped, qcGateReq);
    emitQc(TERRA, true, g2.accepted.length, g2.deterministicRejected + g2.semanticRejected, 'luna slot(s) failed the gate');
    if (g2.accepted.length !== failedSlots.length) {
      console.error('quick_check fast path: a regenerated slot still failed the quality gate -- returning no questions rather than a partial set');
      return [];
    }
    const stitched = [...storedQuestions];
    failedSlots.forEach((slot, k) => {
      stitched[slot] = g2.accepted[k];
    });
    return stitched;
  } catch (error) {
    console.error('Error generating quick_check questions:', error);
    return [];
  }
}

/**
 * STABILIZATION QUIZ PERFORMANCE Step 14. Step 12 measured the legacy
 * single-call batch path timing out at count=20 (topic_practice/
 * review's default) regardless of model, and found 5 concurrent calls
 * x 4 questions the fastest AND most reliable chunk architecture (3/3
 * full-valid repeated runs, median ~18.7s). Step 13 audited what that
 * would need to be safe: PRACTICE evidence mode already tolerates
 * fewer-than-requested (unlike INDEPENDENT/ASSESSMENT modes, which
 * this deliberately does NOT touch -- see generatePracticeQuestions
 * below), and a deterministic normalizeText-based check (no AI, no
 * embeddings) is sufficient cross-chunk duplicate protection.
 */
export const MAX_QUESTIONS_PER_CHUNK = 4;
const PRACTICE_CHUNK_MODEL = QGEN_ROUTE.primary;

/**
 * Pure and deterministic -- no AI, no randomness. requestedCount <=
 * MAX_QUESTIONS_PER_CHUNK returns a single-element plan: callers must
 * treat that as "don't chunk, use the existing single-call legacy
 * path" (generatePracticeQuestions does exactly that below) rather
 * than routing a lone small-N request through the chunked machinery --
 * chunking can't change the legacy v1 prompt's "Generate UP TO N
 * questions" wording (Step 14's explicit constraint), and that wording
 * was previously found to behave poorly at N=1 specifically (see the
 * Step 9 development history: the batch wording let the model exceed
 * a 1-question token budget, only fixed there by rewording to "EXACTLY
 * 1" -- which this step is forbidden from doing to the shared v1
 * prompt). For larger counts, splits into ceil(count/maxPerChunk)
 * balanced chunks (sizes differ by at most 1, larger chunks first) --
 * never a singleton remainder unless requestedCount itself is 1.
 */
export function planChunks(requestedCount: number, maxPerChunk: number = MAX_QUESTIONS_PER_CHUNK): number[] {
  const count = Math.max(1, Math.min(20, requestedCount));
  if (count <= maxPerChunk) return [count];
  const chunkCount = Math.ceil(count / maxPerChunk);
  const base = Math.floor(count / chunkCount);
  const remainder = count % chunkCount;
  return Array.from({ length: chunkCount }, (_, i) => (i < remainder ? base + 1 : base));
}

/**
 * The chunked fast path for topic_practice and review ONLY -- the two
 * PRACTICE-evidence-mode, single-concept modes Step 13 cleared for
 * this. Every other caller (quick_check, retention_check,
 * diagnostic_check, cumulative_assessment, exam_simulation,
 * generateQuestionVariant) is untouched and keeps calling
 * generateQuestionsForConcept/generateQuickCheckQuestions exactly as
 * before -- this function is never referenced by them.
 *
 * Contract:
 *   - count <= MAX_QUESTIONS_PER_CHUNK: delegates outright to the
 *     unmodified generateQuestionsForConcept (no chunking machinery
 *     touches a request this small).
 *   - count > MAX_QUESTIONS_PER_CHUNK: planChunks(count) balanced
 *     chunks, each an independent the QUESTION_GENERATION route model (LX-4P-PERF-R1C: OpenAI Luna) call at
 *     30_000ms, promptVersion v3 (Step 18, unified with every other
 *     QUESTION_GENERATION call site) -- the prompt TEXT sent per call
 *     is byte-identical to the legacy path's "Generate UP TO N
 *     questions..." wording, just with N = that chunk's own size), run
 *     concurrently.
 *   - PRACTICE semantics (unlike quick_check's all-or-nothing):  a
 *     chunk that times out, errors, or comes back short still lets the
 *     other chunks' valid questions through -- only a fully empty
 *     merged result (every chunk failed, or every question was a
 *     cross-chunk duplicate of another) returns [], the same signal
 *     every other generation path already surfaces as GENERATION_FAILED.
 *   - Deterministic, AI-free duplicate protection after merging:
 *     normalizeText + case-fold on each question's text (never
 *     evaluateVariantEquivalence, which checks metadata equivalence,
 *     not text identity -- see the Step 13 report for why that's the
 *     wrong tool here; never a second AI/embedding call).
 *   - Final result is capped at `count` -- never exceeds requestedCount
 *     even if a chunk's own model call disobeyed its "up to" bound.
 */
export async function generatePracticeQuestions(
  conceptId: string,
  studentId: string,
  subjectId: string,
  options: {
    count?: number;
    difficulty?: number;
    guidance?: string;
    language?: string;
    visualAidRate?: number;
    ibContext?: IBContext | null;
  } = {}
): Promise<GeneratedQuestion[]> {
  const count = Math.max(1, Math.min(20, options.count || 20));
  const plan = planChunks(count);

  if (plan.length === 1) {
    // LX-4P-PERF-R1C C7: the canonical small-count Practice path no longer
    // falls through to a bare generator call -- it goes through the
    // Luna-first Quality Gate (deterministic contract + semantic verify +
    // one Terra fallback). Lazy import avoids a require cycle.
    const { generateGatedPracticeBatch } = await import('@/services/gated-question-generation.service');
    return generateGatedPracticeBatch(conceptId, studentId, subjectId, {
      count,
      difficulty: options.difficulty,
      guidance: options.guidance,
      language: options.language,
      visualAidRate: options.visualAidRate,
      ibContext: options.ibContext,
    });
  }

  const difficulty = Math.max(1, Math.min(5, options.difficulty || 3));
  const guidance = options.guidance || 'Choose whichever question types genuinely fit this specific material best.';
  const language = options.language || 'en';
  const visualAidRate = options.visualAidRate ?? 0;
  const ibContext = options.ibContext ?? null;

  try {
    const context = await retrieveContext(studentId, subjectId, { conceptId, limit: 5 });

    let conceptContext: { label: string; subjectName: string } | null = null;
    if (context.chunks.length === 0) {
      const conceptRow = await db.query(
        `
        SELECT COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
        FROM concepts c
        JOIN subjects s ON s.id = c.subject_id
        LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
        WHERE c.id = $1
        `,
        [conceptId, language]
      );
      const row = conceptRow.rows[0];
      if (!row) {
        console.warn(`Concept ${conceptId} not found`);
        return [];
      }
      conceptContext = { label: row.label, subjectName: row.subject_name };
    }

    const types = ALL_QUESTION_TYPES;
    // LX-4P-PERF-R1C C13: bounded RAG reuse -- per-chunk context budget
    // (the same envelope every parallel chunk shares).
    const contextChunks = fitContextChunks(context.chunks, budgetFor('question_generation_chunk').maxContextChars);
    const systemPrompt = buildQuestionGenerationPrompt(types, difficulty, language, contextChunks, visualAidRate, guidance, ibContext, conceptContext);
    const prompt = getPrompt('quiz.question_generation');
    const aiContext = { studentId, subjectId, conceptId, sourceComponent: 'quiz-generation.service.ts:generatePracticeQuestions' };

    const requestChunk = (chunkSize: number, model: string = PRACTICE_CHUNK_MODEL): Promise<any[]> => {
      const shapeExamples = types.map((t) => jsonShapeExample(t, visualAidRate > 0)).join(',\n');
      const maxTokens = Math.min(16000, 900 * chunkSize + 1500);
      const userMessage = `Generate UP TO ${chunkSize} questions for this concept using only the provided material -- fewer is fine and expected if the material doesn't genuinely support that many distinct, non-redundant questions. Never pad with repetitive or trivial questions just to reach ${chunkSize}; prioritize quality and coverage of distinct ideas in the material over hitting the maximum. For each question, pick whichever type from the allowed list actually fits that piece of content best -- the mix should emerge from what the material calls for, not from forcing variety for its own sake.

Output a JSON object (no markdown fences) with this exact shape -- a "questions" array, one element per question, each element's shape depending on its "type":
{"questions": [
${shapeExamples}
]}`;
      return executeAI({
        capability: prompt.capability,
        risk: 'HIGH_RISK',
        provider: QGEN_ROUTE.provider,
        model,
        promptId: prompt.id,
        promptVersion: prompt.version, // STABILIZATION Step 18: now v3, unified with every other QUESTION_GENERATION call site -- was pinned 'v1' when this was orchestration-only; the shared prompt text itself has now genuinely changed for everyone
        timeoutMs: 30_000,
        context: aiContext,
        call: (signal) =>
          callModel({ provider: QGEN_ROUTE.provider, model, maxTokens, reasoningEffort: budgetFor('question_generation_chunk').reasoningEffort, jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA, system: systemPrompt, user: userMessage }, signal),
        validate: (raw) => {
          // LX-4P-PERF-R1F: same object-root boundary as every other
          // QUESTION_GENERATION call site. This chunk path already
          // tolerates partial results (PRACTICE semantics), so corrupted
          // items are filtered out, never fail the whole chunk.
          const message = (raw.raw as any)?.choices?.[0]?.message;
          const finishReason = (raw.raw as any)?.choices?.[0]?.finish_reason ?? null;
          const parseStart = Date.now();
          const outcome = parseGeneratedQuestionBatch(raw.text, finishReason);
          logQuestionBatchDiagnostics({
            model: raw.model, finishReason, hasContent: !!raw.text, contentLength: raw.text?.length ?? 0,
            hasRefusal: !!message?.refusal, hasUsage: !!(raw.raw as any)?.usage,
            parsedRoot: outcome.parsedRoot, keys: outcome.keys,
            questionsCount: outcome.ok ? outcome.questions.length : null,
            failureStage: outcome.failureStage, parseMs: Date.now() - parseStart,
          });
          if (!outcome.ok) {
            return { valid: false, errors: [`${outcome.failureStage}: ${outcome.detail}`] };
          }
          const clean = outcome.questions.filter((q: any) => !isLatexCorrupted(q));
          const rejected = outcome.questions.length - clean.length;
          if (rejected > 0) {
            console.warn(`generatePracticeQuestions chunk: rejected ${rejected} question(s) for suspected LaTeX/JSON corruption`);
          }
          return { valid: true, value: clean };
        },
        // PRACTICE semantics: a failed/timed-out chunk contributes
        // nothing rather than failing the whole quiz -- the other
        // chunks' valid questions are still used (see the contract doc above).
        fallback: () => [],
      }).then((r) => r.result);
    };

    const chunkResults = await Promise.all(plan.map((chunkSize) => requestChunk(chunkSize)));

    // LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate. Every
    // parallel chunk is gated in parallel (deterministic contract +
    // semantic verify where required); a chunk whose gated Luna output
    // is EMPTY triggers ONE narrow Terra regeneration of THAT chunk only
    // -- never a whole-batch Terra rerun. PRACTICE stays partial-
    // tolerant: a chunk that still yields nothing contributes nothing,
    // it never fails the whole quiz.
    const { gateUnitWithTerraFallback } = await import('@/services/gated-question-generation.service');
    const gateReq = { conceptId, language, context: { studentId, subjectId } };
    const gatedChunks = await Promise.all(
      plan.map((chunkSize, i) => {
        const lunaMapped = mapRawQuestionsToGenerated(chunkResults[i], conceptId, language);
        return gateUnitWithTerraFallback(
          lunaMapped,
          { ...gateReq, targetCount: chunkSize, fallbackWhen: 'EMPTY' },
          async () => mapRawQuestionsToGenerated(await requestChunk(chunkSize, TERRA), conceptId, language),
        ).then((r) => r.accepted);
      }),
    );
    const mapped = gatedChunks.flat();

    // Deterministic, AI-free cross-chunk duplicate protection (Step 13
    // report: normalizeText-based exact/normalized-text check is
    // sufficient and doesn't require a second AI call; evaluateVariantEquivalence
    // is deliberately NOT used here -- it checks metadata equivalence,
    // never the question text itself, so it's the wrong tool for this).
    const seen = new Set<string>();
    const deduped: GeneratedQuestion[] = [];
    let duplicatesRemoved = 0;
    for (const q of mapped) {
      const key = normalizeText(q.question).toLowerCase();
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(key);
      deduped.push(q);
    }
    if (duplicatesRemoved > 0) {
      console.warn(`generatePracticeQuestions: removed ${duplicatesRemoved} duplicate question(s) across chunks for concept ${conceptId}`);
    }

    // PRACTICE semantics: never fail the whole quiz over a removed
    // duplicate or a short/failed chunk -- only a fully empty result
    // (every chunk failed, or every question collided as a duplicate)
    // surfaces as a failure, via the same [] contract every other
    // generation path already uses (route.ts's questions.length === 0
    // -> GENERATION_FAILED check, unchanged).
    return deduped.slice(0, count); // never exceed requestedCount
  } catch (error) {
    console.error('Error generating practice/review questions:', error);
    return [];
  }
}

/**
 * STABILIZATION QUIZ PERFORMANCE Step 22, evolved through Step 22D,
 * RET-R1 (deficit-preserving recovery repair), and RET-R2 (candidate-
 * surplus reliability repair). The dedicated fast path for
 * retention_check ONLY (EvidenceMode INDEPENDENT). Deliberately NOT a
 * reuse of generatePracticeQuestions -- PRACTICE tolerates fewer than
 * requested, retention_check must not: the PUBLISHED result is still
 * exact-6-or-nothing (never 1-5 questions reach the learner).
 *
 * RET-R2 -- CANONICAL COUNT vs. CANDIDATE COUNT (the point of this
 * revision): `RETENTION_REQUIRED_COUNT` (6, what the learner sees) and
 * how many candidates are ASKED FOR are now two separate numbers.
 * RET-R1 proved the preserve-every-accepted-question logic works, but
 * with observed Quality Gate rejection rates, requesting exactly 6
 * candidates up front and then only a minimum-legal 3-candidate
 * recovery batch could still land short after one bounded recovery
 * round even with providers behaving normally -- a candidate-VOLUME
 * problem, not a preservation-logic bug. The fix is to generate a
 * bounded SURPLUS of candidates at every step, so the gate has room to
 * reject low-quality ones without starving the final count:
 *   - Initial wave: 2 concurrent Luna calls, `RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK`
 *     (4, not 3) candidates each = `RETENTION_INITIAL_CANDIDATE_COUNT`
 *     (8) candidates total -- 2 more than the 6 ever published.
 *   - Recovery wave (only if deficit > 0 after gating the initial 8):
 *     exactly ONE Terra call, requesting `recoveryCandidateCount(deficit)`
 *     -- `deficit + 2`, clamped to `[3, 6]` -- never exactly the
 *     deficit, since some recovery candidates may themselves be
 *     rejected.
 *   - Selection: gate ALL candidates, dedupe, then take candidates in
 *     the SAME stable, deterministic order `applyQuestionQualityGate`
 *     already preserves (the caller's original array order) -- no new
 *     quality ranking is invented. If >= 6 survive, the extras are
 *     simply unused (never a second, informal quality signal); if
 *     exactly 6 or fewer survive, all of them count toward the deficit.
 *   - Call budget is UNCHANGED: still 2 concurrent initial + at most 1
 *     recovery = `RETENTION_MAX_AI_CALLS_PER_ATTEMPT` (3) generation
 *     calls total, no retry loop, no unbounded anything -- only the
 *     CANDIDATE COUNT per call grew, never the CALL COUNT.
 *
 * Architecture (otherwise unchanged from RET-R1):
 *   - Preventive Variant B runtime diversification (Step 22C, combined
 *     in Step 22D): Chunk A and Chunk B each receive the complete,
 *     unmodified retention_check guidance PLUS a distinct one-sentence
 *     runtime note nudging away from the most obvious textbook
 *     examples -- request-specific dynamic content, not a
 *     prompt-registry change.
 *   - No manual type assignment, no ALL_QUESTION_TYPES cycling -- each
 *     chunk picks its own types from the complete guidance, exactly
 *     like the legacy batch path.
 *   - Each chunk must itself return EXACTLY the candidate count it was
 *     asked for, schema-valid and LaTeX-uncorrupted -- fewer (or a
 *     failed/timed-out call) is a failed chunk, never a partial
 *     contribution.
 *   - Once a raw baseline (one or two chunks' worth) is selected, exact
 *     normalized-text duplicate and strict structural overlap (Step
 *     20C/22B/22D's validated deterministic fingerprint) between the
 *     two ORIGINAL chunks still collapses to a deterministic
 *     keep-Chunk-A/regenerate-Chunk-B rule, unchanged from before
 *     RET-R1/RET-R2 -- collision handling was never the live bug either
 *     phase targeted.
 *   - RET-R1: the baseline is then gated PER QUESTION (LX-4P-PERF-R1C-R1's
 *     universal Quality Gate, unchanged/unweakened). A rejection
 *     removes only that question; every accepted sibling survives.
 *     `deficit = 6 - acceptedUnique.length`.
 *   - If deficit > 0: exactly ONE bounded recovery round, model Terra,
 *     exclusion note listing every already-accepted question's own
 *     text (never correctAnswer/explanation/learner data). The
 *     replacement candidates are themselves gated, then deduped
 *     per-question against everything already accepted -- only enough
 *     unique, accepted replacements to close the deficit are kept; any
 *     surplus is simply unused, never fabricated into the set, never
 *     causing a valid one to be dropped.
 *   - If the canonical count still can't be reached after that one
 *     recovery round, this returns [] and logs a precise, safe reason
 *     (`RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS`, metadata only, no
 *     question content) -- no second retry, no partial set can ever
 *     reach the learner.
 */
const RETENTION_CHUNK_MODEL = QGEN_ROUTE.primary;
const RETENTION_CHUNK_COUNT = 2;
/** RET-R2 R2: the canonical FINAL published count -- independent of how many candidates are requested from the model below. Never conflate the two. */
export const RETENTION_REQUIRED_COUNT = 6;
/** RET-R2 R3: candidates requested per initial concurrent chunk -- 1 more than an even 6/2 split, so a single rejection in either chunk doesn't force recovery. */
const RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK = 4;
/** RET-R2: total initial candidate surplus -- 8, i.e. 2 more candidates than are ever published. */
export const RETENTION_INITIAL_CANDIDATE_COUNT = RETENTION_CHUNK_COUNT * RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK;
export const RETENTION_MAX_AI_CALLS_PER_ATTEMPT = 3; // 2 initial concurrent + at most 1 bounded recovery call -- unchanged by RET-R2

/**
 * RET-R2 R4: deterministic, bounded recovery candidate surplus. NEVER
 * exactly the deficit (a recovery candidate can itself be rejected) and
 * NEVER unbounded -- clamped to [3, 6], the same [minimum legal chunk,
 * maximum this fast path will ever ask a single bounded call for]
 * range. No learner-specific or mastery-specific input; a pure function
 * of the remaining deficit only. deficit 1 -> 3, deficit 2 -> 4,
 * deficit 3 -> 5, deficit 4+ -> 6 (the ceiling).
 */
function recoveryCandidateCount(deficit: number): number {
  return Math.min(6, Math.max(3, deficit + 2));
}

const RETENTION_VARIANT_B_NOTE_CHUNK_A =
  'Generate questions using examples and mathematical structures that vary from the most obvious textbook examples for this concept.';
const RETENTION_VARIANT_B_NOTE_CHUNK_B =
  'Generate questions using a different variety of examples and mathematical structures; avoid defaulting to the most obvious textbook examples.';

/**
 * Strict deterministic structural fingerprint (Step 20C, revalidated in
 * Step 21/22B/22C/22D) -- local to retention_check only, not shared,
 * not generalized to other modes. No AI, no embeddings, no invented
 * prose similarity. Two questions collide only when they share the
 * same concept, type, cognitiveLevel, questionIntent, AND the same
 * symbolic shape of every math span in the question field itself
 * (explanation/correctAnswer are deliberately excluded -- Step 20C
 * found including them made the fingerprint too brittle). A question
 * with no $...$/$$...$$ math span in its question field gets
 * fingerprint null and is never grouped with anything.
 */
function extractRetentionMathSpans(text: string): string[] {
  const spans: string[] = [];
  const displayRe = /\$\$([\s\S]*?)\$\$/g;
  const inlineRe = /\$([^$]*?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = displayRe.exec(text))) spans.push(m[1]);
  const withoutDisplay = text.replace(displayRe, '');
  while ((m = inlineRe.exec(withoutDisplay))) spans.push(m[1]);
  return spans;
}
function retentionSymbolicShape(raw: string): string {
  // Normalize whitespace/casing, unify arrow notation, then abstract
  // bare numeric literals to a placeholder while preserving
  // exponent/subscript digit counts (as an equal-length placeholder) so
  // "x^2" and "x^3" stay distinct but "2x" and "5x" collapse together --
  // exactly the validated Step 22D diagnostic behavior.
  let s = raw.toLowerCase().replace(/\s+/g, '');
  s = s.replace(/\\to|\\rightarrow|->/g, 'TO');
  s = s.replace(/(\^|_)(\d+)/g, (_m, marker, digits) => `${marker}${'E'.repeat(digits.length)}`);
  s = s.replace(/\d+(\.\d+)?/g, 'N');
  s = s.replace(/\^E+/g, (m) => '^' + 'D'.repeat(m.length - 1));
  s = s.replace(/_E+/g, (m) => '_' + 'D'.repeat(m.length - 1));
  return s;
}
export function computeRetentionStructuralFingerprint(
  question: { question?: unknown; type?: unknown; cognitiveLevel?: unknown; questionIntent?: unknown },
  conceptId: string
): string | null {
  const questionText = typeof question.question === 'string' ? question.question : '';
  const spans = extractRetentionMathSpans(questionText);
  if (spans.length === 0) return null;
  const shape = spans.map(retentionSymbolicShape).sort().join('||');
  return [conceptId, question.type ?? '?', shape, question.cognitiveLevel ?? '?', question.questionIntent ?? '?'].join('::');
}
// RET-R3 B4: the whole-chunk collision functions that used to live here
// (`retentionHasExactDuplicate`/`retentionStructuralOverlapGroupCount`,
// which decided "discard ALL of Chunk B" on a single collision) were
// REMOVED -- see `dedupeAgainstAccepted` below, now applied per-question
// to the MERGED initial candidate pool instead. Deleted, not merely
// unused: keeping a dead whole-chunk-discard code path around would
// invite it being wired back in by accident.
/** Only the retained chunk's own question text -- never correctAnswer, explanation, or any learner/evidence/mastery data. */
function buildRetentionExclusionNote(retainedQuestions: any[]): string {
  return `Generate a different set of questions, examples, and mathematical structures from the ones already selected below for this same retention check -- do not repeat the same problem, example, structure, or wording as any of these:\n${retainedQuestions
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join('\n')}`;
}

/** RET-R3 B2: safe aggregate counts of what `dedupeAgainstAccepted` dropped and why -- never question text. */
export interface RetentionDedupeResult {
  kept: GeneratedQuestion[];
  /** Candidates dropped for exactly matching (after normalization) the text of something already accepted/kept. */
  exactDuplicateCount: number;
  /** Candidates dropped for sharing a structural fingerprint with something already accepted/kept (same shape, different surface numbers). */
  structuralOverlapCount: number;
}

/**
 * RET-R1, extended RET-R3 B4/B5: per-question dedup of candidates
 * against the questions already accepted (and against each other) --
 * the SAME retention fingerprint/exact-text authority used everywhere
 * else in this fast path (`normalizeText` +
 * `computeRetentionStructuralFingerprint`). A candidate that duplicates
 * (exactly or structurally) anything already accepted is dropped; it
 * NEVER causes a sibling candidate that IS unique to be discarded too
 * (RET-R3 B4: this replaced the old whole-chunk-discard rule, which
 * could throw away 3-4 otherwise-valid candidates over a single
 * collision -- see `generateRetentionCheckQuestions`'s own comment on
 * its initial-wave merge for where this is now applied).
 *
 * Order matters for reproducibility (RET-R2 R3's "existing
 * deterministic order" requirement, unchanged): `candidates` are
 * scanned in their given order, and only the FIRST occurrence of a
 * given text/fingerprint is kept -- so which of two colliding
 * candidates survives is a pure function of input order, never a
 * content-based or random choice.
 */
function dedupeAgainstAccepted(candidates: GeneratedQuestion[], accepted: GeneratedQuestion[], conceptId: string): RetentionDedupeResult {
  const usedTextKeys = new Set(accepted.map((q) => normalizeText(q.question).toLowerCase()));
  const usedFingerprints = new Set(
    accepted.map((q) => computeRetentionStructuralFingerprint(q, conceptId)).filter((f): f is string => f !== null)
  );
  const kept: GeneratedQuestion[] = [];
  let exactDuplicateCount = 0;
  let structuralOverlapCount = 0;
  for (const q of candidates) {
    const textKey = normalizeText(q.question).toLowerCase();
    if (usedTextKeys.has(textKey)) {
      exactDuplicateCount += 1;
      continue;
    }
    const fingerprint = computeRetentionStructuralFingerprint(q, conceptId);
    if (fingerprint !== null && usedFingerprints.has(fingerprint)) {
      structuralOverlapCount += 1;
      continue;
    }
    usedTextKeys.add(textKey);
    if (fingerprint !== null) usedFingerprints.add(fingerprint);
    kept.push(q);
  }
  return { kept, exactDuplicateCount, structuralOverlapCount };
}

/** RET-R1 A9: safe, learner/question-content-free observability -- one line per retention generation event. */
function logRetention(label: string, meta: Record<string, unknown> = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[retention]', JSON.stringify({ label, ...meta }));
  } catch { /* logging must never break generation */ }
}

/** RET-R1 A8: metadata-only, no question content -- accompanies the `RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS` reason when bounded recovery cannot reach the canonical count. */
export interface RetentionInsufficientMeta {
  requestedCount: number;
  initialGeneratedCount: number;
  initialAcceptedCount: number;
  initialRejectedCount: number;
  replacementGeneratedCount: number;
  replacementAcceptedCount: number;
  remainingDeficit: number;
}

type RetentionChunkOutcome = { ok: true; questions: any[] } | { ok: false; reason: 'TIMEOUT' | 'CHUNK_FAILURE' | 'VALIDATION' };

export async function generateRetentionCheckQuestions(
  conceptId: string,
  studentId: string,
  subjectId: string,
  options: {
    difficulty?: number;
    guidance?: string;
    language?: string;
    ibContext?: IBContext | null;
  } = {}
): Promise<GeneratedQuestion[]> {
  const difficulty = Math.max(1, Math.min(5, options.difficulty || 3));
  const guidance = options.guidance || 'Choose whichever question types genuinely fit this specific material best.';
  const language = options.language || 'en';
  const ibContext = options.ibContext ?? null;

  try {
    const context = await retrieveContext(studentId, subjectId, { conceptId, limit: 5 });

    let conceptContext: { label: string; subjectName: string } | null = null;
    if (context.chunks.length === 0) {
      const conceptRow = await db.query(
        `
        SELECT COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
        FROM concepts c
        JOIN subjects s ON s.id = c.subject_id
        LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
        WHERE c.id = $1
        `,
        [conceptId, language]
      );
      const row = conceptRow.rows[0];
      if (!row) {
        console.warn(`Concept ${conceptId} not found`);
        return [];
      }
      conceptContext = { label: row.label, subjectName: row.subject_name };
    }

    // visualAidRate is always 0 for retention_check (matches
    // QUIZ_MODE_CONFIG.retention_check in route.ts -- a fast,
    // low-friction confidence check never uses visual aids).
    const types = ALL_QUESTION_TYPES;
    // LX-4P-PERF-R1C C13: bounded RAG reuse -- per-chunk context budget.
    const contextChunks = fitContextChunks(context.chunks, budgetFor('question_generation_chunk').maxContextChars);
    const systemPrompt = buildQuestionGenerationPrompt(types, difficulty, language, contextChunks, 0, guidance, ibContext, conceptContext);
    const prompt = getPrompt('quiz.question_generation');
    const aiContext = { studentId, subjectId, conceptId, sourceComponent: 'quiz-generation.service.ts:generateRetentionCheckQuestions' };

    // RET-R2 R2/R3: `count` is the CANDIDATE count for this one call --
    // deliberately a parameter, never a fixed module constant, so the
    // initial wave (RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK) and the
    // recovery wave (recoveryCandidateCount(deficit)) can request
    // different, purpose-sized surpluses through the exact same
    // generation/validation path -- never a second implementation.
    const requestChunk = (
      chunkIndex: number,
      count: number,
      diversificationNote: string,
      exclusionNote?: string,
      model: string = RETENTION_CHUNK_MODEL,
    ): Promise<RetentionChunkOutcome> => {
      const shapeExamples = types.map((t) => jsonShapeExample(t, false)).join(',\n');
      const maxTokens = Math.min(16000, 900 * count + 1500);
      const userMessage = `This is chunk ${chunkIndex + 1} of ${RETENTION_CHUNK_COUNT} for this retention check. Generate EXACTLY ${count} CANDIDATE questions for this concept using only the provided material -- cover different aspects of the concept from what the other chunk will contribute. Candidates are quality-reviewed after generation; StudyUS will select the best ${RETENTION_REQUIRED_COUNT} across both chunks, so not every candidate you write will necessarily be used -- write every one to the same high standard regardless. For each question, pick whichever type from the allowed list actually fits that piece of content best -- the mix should emerge from what the material calls for, not from forcing variety for its own sake. ${diversificationNote}${exclusionNote ? `\n\n${exclusionNote}` : ''}

Output a JSON object (no markdown fences) with this exact shape -- a "questions" array containing exactly ${count} elements, each element's shape depending on its "type":
{"questions": [
${shapeExamples}
]}`;
      return executeAI<CallModelResult, RetentionChunkOutcome>({
        capability: prompt.capability,
        risk: 'HIGH_RISK',
        provider: QGEN_ROUTE.provider,
        model,
        promptId: prompt.id,
        promptVersion: prompt.version, // v3 -- same registry version every QUESTION_GENERATION call site reads (Step 18); Variant B notes and exclusion context are request-specific runtime content, not a static prompt change
        timeoutMs: 30_000,
        context: aiContext,
        call: (signal) =>
          callModel({ provider: QGEN_ROUTE.provider, model, maxTokens, reasoningEffort: budgetFor('question_generation_chunk').reasoningEffort, jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA, system: systemPrompt, user: userMessage }, signal),
        validate: (raw) => {
          // LX-4P-PERF-R1F: same object-root boundary as every other
          // QUESTION_GENERATION call site.
          const message = (raw.raw as any)?.choices?.[0]?.message;
          const finishReason = (raw.raw as any)?.choices?.[0]?.finish_reason ?? null;
          const parseStart = Date.now();
          const outcome = parseGeneratedQuestionBatch(raw.text, finishReason);
          logQuestionBatchDiagnostics({
            model: raw.model, finishReason, hasContent: !!raw.text, contentLength: raw.text?.length ?? 0,
            hasRefusal: !!message?.refusal, hasUsage: !!(raw.raw as any)?.usage,
            parsedRoot: outcome.parsedRoot, keys: outcome.keys,
            questionsCount: outcome.ok ? outcome.questions.length : null,
            failureStage: outcome.failureStage, parseMs: Date.now() - parseStart,
          });
          if (!outcome.ok) {
            return { valid: false, errors: [`Chunk ${chunkIndex}: ${outcome.failureStage}: ${outcome.detail}`] };
          }
          const parsed = outcome.questions;
          // LaTeX-corrupted items are filtered out here -- if that drops
          // the chunk below `count`, it surfaces as an ordinary
          // VALIDATION failure below (Step 22D: corruption has no
          // separately actionable recovery path from a bare-count
          // failure).
          const clean = parsed.filter((q) => q && q.question && q.type && ANSWER_FORMAT_BY_TYPE[q.type as QuestionType] && !isLatexCorrupted(q));
          // INDEPENDENT semantics: a chunk that doesn't deliver exactly
          // what it was asked for is itself invalid -- no partial
          // contribution, unlike generatePracticeQuestions.
          if (clean.length !== count) {
            return { valid: false, errors: [`Chunk ${chunkIndex} returned ${clean.length} valid question(s), expected exactly ${count}`] };
          }
          return { valid: true, value: { ok: true, questions: clean } };
        },
        // Never throws -- classifies the failure via the gateway's own
        // normalized error code so recovery (below) can pick the right
        // action without re-deriving TIMEOUT vs VALIDATION itself.
        fallback: (error) => ({
          ok: false,
          reason: error.code === 'TIMEOUT' ? 'TIMEOUT' : error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_RESPONSE' ? 'VALIDATION' : 'CHUNK_FAILURE',
        }),
      }).then((r) => r.result);
    };

    logRetention('RETENTION_GENERATION_STARTED', { conceptId, requestedCount: RETENTION_REQUIRED_COUNT, initialCandidateCount: RETENTION_INITIAL_CANDIDATE_COUNT });

    const reportInsufficient = (meta: RetentionInsufficientMeta): GeneratedQuestion[] => {
      logRetention('RETENTION_BATCH_INSUFFICIENT', { reason: 'RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS', ...meta });
      return [];
    };

    const [chunkA, chunkB] = await Promise.all([
      requestChunk(0, RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK, RETENTION_VARIANT_B_NOTE_CHUNK_A),
      requestChunk(1, RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK, RETENTION_VARIANT_B_NOTE_CHUNK_B),
    ]);

    if (!chunkA.ok && !chunkB.ok) {
      // Rule 6C: both chunks failed -- no recovery call can make more
      // than one AI call, so there is nothing left to attempt.
      console.error('retention_check fast path: both initial chunks failed -- returning no questions rather than a partial set');
      return reportInsufficient({
        requestedCount: RETENTION_REQUIRED_COUNT, initialGeneratedCount: 0, initialAcceptedCount: 0, initialRejectedCount: 0,
        replacementGeneratedCount: 0, replacementAcceptedCount: 0, remainingDeficit: RETENTION_REQUIRED_COUNT,
      });
    }

    // RET-R1, REPAIRED RET-R3 B4: which RAW chunk(s) to gate, and --
    // only if a recovery round later turns out to be needed -- which
    // note/slot that recovery call should use.
    //
    // RET-R3 B4 ROOT-CAUSE REPAIR (do not reintroduce): this used to
    // ALSO classify "both chunks valid" candidates for an exact
    // duplicate or structural overlap BETWEEN the two chunks and, on
    // any single collision, discard the ENTIRE losing chunk (3-4
    // otherwise-valid candidates) to keep the other one whole. Audited
    // as the most likely remaining cause of live "Couldn't load the
    // quiz" failures: with RET-R2's 4-candidates-per-chunk sizing, one
    // collision between the two chunks (plausible for a concept with a
    // small number of natural problem shapes, even with the
    // diversification notes) silently cut the effective candidate pool
    // from 8 to 4 -- destroying most of RET-R2's own surplus before the
    // Quality Gate even ran. Per RET-R1's own founding principle
    // ("preserve good questions; remove only bad/duplicate ones"),
    // extended here to duplicates: a duplicate/overlapping candidate
    // must never take an unrelated, unique sibling down with it. Both
    // chunks (when both succeed) are therefore always MERGED whole;
    // per-question dedup (`dedupeAgainstAccepted`, RET-R1's existing
    // recovery-wave authority, now reused here) runs AFTER the Quality
    // Gate below (RET-R3 B5: gate first, dedupe second -- the existing
    // canonical order, unchanged) and drops only the specific
    // colliding candidate(s), never a whole chunk.
    let rawBaseline: any[];
    let recoveryNote: string;
    let recoverySlotIndex: 0 | 1;

    if (!chunkA.ok || !chunkB.ok) {
      // Rule 6B: exactly one chunk failed -- keep the valid one,
      // regenerate the failed one once.
      if (!chunkA.ok) {
        rawBaseline = (chunkB as { ok: true; questions: any[] }).questions;
        recoveryNote = RETENTION_VARIANT_B_NOTE_CHUNK_B;
        recoverySlotIndex = 0;
      } else {
        rawBaseline = (chunkA as { ok: true; questions: any[] }).questions;
        recoveryNote = RETENTION_VARIANT_B_NOTE_CHUNK_A;
        recoverySlotIndex = 1;
      }
    } else {
      // Both chunks valid -- always merge whole; collisions (if any)
      // are resolved per-question, post-gate, below -- never by
      // discarding one entire chunk. The recovery note/slot for this
      // branch is a fixed, deterministic default (never content- or
      // collision-derived) since there is no longer a single "losing
      // chunk" to target a replacement at.
      rawBaseline = [...chunkA.questions, ...chunkB.questions];
      recoveryNote = RETENTION_VARIANT_B_NOTE_CHUNK_B;
      recoverySlotIndex = 1;
    }

    const mappedBaseline = mapRawQuestionsToGenerated(rawBaseline, conceptId, language);
    if (mappedBaseline.length !== rawBaseline.length) {
      // Each chunk already validated itself upstream (exactly however
      // many candidates it was asked for, schema-valid), so this is
      // defensive only -- treated as "nothing usable," same spirit as
      // the old bare-count guard.
      console.error(`retention_check fast path: expected ${rawBaseline.length} mapped questions, got ${mappedBaseline.length} -- returning no questions rather than a partial set`);
      return reportInsufficient({
        requestedCount: RETENTION_REQUIRED_COUNT, initialGeneratedCount: rawBaseline.length, initialAcceptedCount: 0,
        initialRejectedCount: rawBaseline.length, replacementGeneratedCount: 0, replacementAcceptedCount: 0, remainingDeficit: RETENTION_REQUIRED_COUNT,
      });
    }

    // A2/A3: gate EVERY baseline question individually. A rejection
    // removes only that one question -- an accepted sibling from the
    // same chunk is never discarded merely because another failed.
    const initialGate = await retentionApplyGate(mappedBaseline, conceptId, language, studentId, subjectId, RETENTION_CHUNK_MODEL, false);
    // RET-R3 B4/B5: gate FIRST (above, unchanged authority), THEN
    // per-question dedupe against an empty "already accepted" set --
    // i.e. dedupe the gate's own accepted candidates against EACH
    // OTHER (a duplicate/overlap can only ever exist between the two
    // initial chunks now that both are always merged whole). Preserves
    // every unique accepted candidate; only the specific colliding
    // one(s) are dropped, never a whole chunk (B4). `dedupeAgainstAccepted`
    // scans in the gate's own accepted order (Chunk A's accepted
    // candidates first, then Chunk B's), so which of two colliding
    // candidates survives is deterministic -- the SAME "existing
    // deterministic order" guarantee RET-R2 R3 already established.
    const initialDedupe = dedupeAgainstAccepted(initialGate.accepted, [], conceptId);
    const acceptedUnique: GeneratedQuestion[] = [...initialDedupe.kept];
    const initialAcceptedCount = acceptedUnique.length;
    const initialRejectedCount = mappedBaseline.length - initialAcceptedCount;
    // RET-R3 B2/B3: the gate's own rejectionReasons (accurate per-
    // candidate classification, carried forward from the real decision
    // authority -- never reconstructed) merged with the SEPARATE
    // duplicate/structural-overlap counts this dedupe pass just
    // computed, under their OWN distinct category names so a duplicate
    // is never misreported as a semantic or schema rejection (B3).
    const initialRejectionReasons: Record<string, number> = { ...initialGate.rejectionReasons };
    if (initialDedupe.exactDuplicateCount > 0) initialRejectionReasons.DUPLICATE_OF_ACCEPTED = initialDedupe.exactDuplicateCount;
    if (initialDedupe.structuralOverlapCount > 0) initialRejectionReasons.STRUCTURAL_OVERLAP_WITH_ACCEPTED = initialDedupe.structuralOverlapCount;
    logRetention('RETENTION_INITIAL_GATE_COMPLETE', { generatedCount: mappedBaseline.length, acceptedCount: initialAcceptedCount, rejectedCount: initialRejectedCount, rejectionReasons: initialRejectionReasons });

    let replacementGeneratedCount = 0;
    let replacementAcceptedCount = 0;
    let deficit = RETENTION_REQUIRED_COUNT - acceptedUnique.length;

    if (deficit > 0) {
      // RET-R2 R4: bounded candidate SURPLUS for the recovery call --
      // never exactly the deficit (a recovery candidate can itself be
      // rejected), never unbounded. See recoveryCandidateCount's own
      // doc comment for the exact, deterministic formula.
      const recoveryCount = recoveryCandidateCount(deficit);
      logRetention('RETENTION_DEFICIT_IDENTIFIED', { deficit });
      logRetention('RETENTION_RECOVERY_STARTED', { deficit, recoveryCandidateCount: recoveryCount });

      // A4: exactly ONE bounded recovery round -- no loop, no second
      // retry. R1C-R1: the recovery call is Terra. The exclusion note
      // now lists every question already accepted (not just one
      // retained chunk's worth), so the recovery call cannot duplicate
      // any of them.
      const exclusionNote = buildRetentionExclusionNote(acceptedUnique);
      const recoveryOutcome = await requestChunk(recoverySlotIndex, recoveryCount, recoveryNote, exclusionNote, TERRA);

      if (!recoveryOutcome.ok) {
        console.error(`retention_check fast path: bounded recovery call failed (${recoveryOutcome.reason}) -- no second retry`);
      } else {
        replacementGeneratedCount = recoveryOutcome.questions.length;
        // A6: replacements go through the SAME Structured Output ->
        // parseGeneratedQuestionBatch -> deterministic gate -> semantic
        // verification -> dedupe pipeline as everything else -- no
        // bypass. Dedup reuses retention's own existing fingerprint
        // authority (computeRetentionStructuralFingerprint), applied
        // per question so ONE colliding replacement never discards an
        // unrelated, unique one (A3).
        const mappedRecovery = mapRawQuestionsToGenerated(recoveryOutcome.questions, conceptId, language);
        const recoveryGate = await retentionApplyGate(mappedRecovery, conceptId, language, studentId, subjectId, TERRA, true);
        const recoveryDedupe = dedupeAgainstAccepted(recoveryGate.accepted, acceptedUnique, conceptId);
        for (const q of recoveryDedupe.kept) {
          if (acceptedUnique.length >= RETENTION_REQUIRED_COUNT) break; // A5: never exceed the canonical count
          acceptedUnique.push(q);
        }
        replacementAcceptedCount = acceptedUnique.length - initialAcceptedCount;
        // RET-R3 B2/B3: same merge as the initial-gate telemetry above --
        // the gate's own accurate per-candidate reasons plus this
        // dedupe pass's OWN duplicate/overlap counts, never conflated.
        const recoveryRejectionReasons: Record<string, number> = { ...recoveryGate.rejectionReasons };
        if (recoveryDedupe.exactDuplicateCount > 0) recoveryRejectionReasons.DUPLICATE_OF_ACCEPTED = recoveryDedupe.exactDuplicateCount;
        if (recoveryDedupe.structuralOverlapCount > 0) recoveryRejectionReasons.STRUCTURAL_OVERLAP_WITH_ACCEPTED = recoveryDedupe.structuralOverlapCount;
        logRetention('RETENTION_RECOVERY_GATE_COMPLETE', { generatedCount: mappedRecovery.length, acceptedCount: recoveryGate.accepted.length, rejectedCount: mappedRecovery.length - recoveryGate.accepted.length, rejectionReasons: recoveryRejectionReasons });
      }

      logRetention('RETENTION_RECOVERY_COMPLETE', { replacementGeneratedCount, replacementAcceptedCount, finalAcceptedCount: acceptedUnique.length });
    }

    deficit = RETENTION_REQUIRED_COUNT - acceptedUnique.length;
    if (deficit > 0) {
      console.error(`retention_check fast path: ${deficit} question(s) short of the canonical count after bounded recovery -- returning no questions, no second retry`);
      return reportInsufficient({
        requestedCount: RETENTION_REQUIRED_COUNT, initialGeneratedCount: mappedBaseline.length, initialAcceptedCount, initialRejectedCount,
        replacementGeneratedCount, replacementAcceptedCount, remainingDeficit: deficit,
      });
    }

    logRetention('RETENTION_BATCH_READY', { finalCount: acceptedUnique.length });
    return acceptedUnique.slice(0, RETENTION_REQUIRED_COUNT); // A5, defensive: never exceed the canonical count
  } catch (error) {
    console.error('Error generating retention_check questions:', error);
    return [];
  }
}

/**
 * RET-R2 R8: safe, aggregate-only rejection-reason telemetry for one
 * gated batch -- which existing `QualityFailureCode`(s) (or
 * `SEMANTIC_REJECTED`, when a candidate cleared the deterministic
 * contract but the independent semantic verifier still declined it)
 * account for the questions NOT in `accepted`. Re-runs the SAME pure,
 * side-effect-free `checkQuestionQualityDeterministic` the real gate
 * already used (never a second decision -- `accepted` from
 * `applyQuestionQualityGate` remains the sole authority on what
 * actually passed) purely to bucket counts for observability. Counts
 * only -- never the question text/answer that triggered a code.
 */
async function classifyRetentionRejections(
  mapped: GeneratedQuestion[],
  accepted: GeneratedQuestion[],
  conceptId: string,
): Promise<Record<string, number>> {
  const { checkQuestionQualityDeterministic } = await import('@/lib/lx/question-quality-contract');
  const acceptedSet = new Set(accepted);
  const reasons: Record<string, number> = {};
  for (const q of mapped) {
    if (acceptedSet.has(q)) continue;
    const det = checkQuestionQualityDeterministic(q, { conceptId });
    if (det.status === 'FAIL') {
      for (const f of det.failures) reasons[f.code] = (reasons[f.code] ?? 0) + 1;
    } else {
      reasons.SEMANTIC_REJECTED = (reasons.SEMANTIC_REJECTED ?? 0) + 1;
    }
  }
  return reasons;
}

/**
 * R1C-R1 helper: run the universal Question Quality Gate over a
 * retention_check set and emit the runtime event. Kept local so the
 * exact-6-or-nothing recovery flow above reads linearly.
 */
async function retentionApplyGate(
  mapped: GeneratedQuestion[],
  conceptId: string,
  language: string,
  studentId: string,
  subjectId: string,
  model: string,
  fallbackUsed: boolean,
): Promise<{ accepted: GeneratedQuestion[]; rejectionReasons: Record<string, number> }> {
  const { applyQuestionQualityGate } = await import('@/services/gated-question-generation.service');
  const { recordRuntimeEvent, buildRuntimeEvent } = await import('@/lib/ai/runtime-event');
  const g = await applyQuestionQualityGate(mapped, { conceptId, language, context: { studentId, subjectId } });
  const rejected = g.deterministicRejected + g.semanticRejected;
  recordRuntimeEvent(
    buildRuntimeEvent({
      capability: 'QUESTION_GENERATION', provider: 'openai', model,
      promptId: 'quiz.question_generation', promptVersion: 'v3',
      inputTokens: null, cachedInputTokens: null, outputTokens: null, latencyMs: 0,
      fallbackUsed,
      qualityGateResult: g.accepted.length === mapped.length ? 'PASS' : rejected > 0 ? 'DETERMINISTIC_FAIL' : 'REJECTED',
      acceptedCount: g.accepted.length,
      rejectedCount: rejected,
    }),
  );
  const rejectionReasons = await classifyRetentionRejections(mapped, g.accepted, conceptId);
  return { accepted: g.accepted, rejectionReasons };
}

/**
 * Phase 3B: a variant question preserves everything that makes it a fair
 * substitute for the source question -- same concept, same learning
 * objective/cognitive level/reasoning type where known, same required
 * knowledge, same scoring/evidence intent -- with different surface
 * details (numbers, wording, context). This is a structured record of
 * that equivalence, evaluated dimension by dimension, not just "asked AI
 * to change the numbers and hoped for the best."
 */
export interface EquivalenceCheckResult {
  passed: boolean;
  reason: string;
}

export interface VariantEquivalenceChecks {
  concept: EquivalenceCheckResult;
  learningObjective: EquivalenceCheckResult;
  cognitiveLevel: EquivalenceCheckResult;
  reasoningType: EquivalenceCheckResult;
  /** Proxied by question type + difficulty band -- no standalone "required knowledge" field exists on GeneratedQuestion yet. */
  requiredKnowledge: EquivalenceCheckResult;
  /** Answer format (how it's scored) plus questionIntent/evidenceDimensions (what it's evidence for), when set. */
  scoringIntent: EquivalenceCheckResult;
}

export interface VariantEquivalenceEvaluation {
  equivalent: boolean;
  confidence: number; // 0-1, fraction of checks that passed
  checks: VariantEquivalenceChecks;
}

export interface VariantEquivalenceContract {
  sourceQuestionId: string;
  variantQuestionId: string;
  conceptId: string;
  learningObjectiveId?: string;
  cognitiveLevel?: CognitiveLevel;
  difficultyBand: 'easy' | 'medium' | 'hard';
  reasoningPattern?: ExpectedReasoningType;
  expectedSteps?: number;
  equivalenceConfidence: number; // 0-1, same value as evaluation.confidence
  equivalent: boolean;
  checks: VariantEquivalenceChecks;
}

function difficultyBand(difficulty: number): 'easy' | 'medium' | 'hard' {
  return difficulty <= 2 ? 'easy' : difficulty <= 3 ? 'medium' : 'hard';
}

/**
 * A dimension that's unset on the source question has nothing to
 * violate -- passes automatically (this is what keeps the check
 * backward-compatible with the many questions that don't carry these
 * optional Pre-flight semantic tags yet). A dimension that IS set on
 * the source but can't be confirmed equal on the candidate fails
 * closed -- "we don't know" is never treated as "close enough."
 */
function checkOptionalMatch<T>(sourceValue: T | undefined, candidateValue: T | undefined, label: string): EquivalenceCheckResult {
  if (sourceValue === undefined) {
    return { passed: true, reason: `No ${label} set on the source question -- nothing to violate.` };
  }
  if (candidateValue === sourceValue) {
    return { passed: true, reason: `${label} matches (${String(sourceValue)}).` };
  }
  return {
    passed: false,
    reason: `${label} could not be confirmed to match the source (source: ${String(sourceValue)}, candidate: ${candidateValue === undefined ? 'unset' : String(candidateValue)}) -- failing closed rather than assuming equivalence.`,
  };
}

function evidenceDimensionsMatch(source?: string[], candidate?: string[]): boolean {
  if (!source) return true; // nothing to violate
  if (!candidate) return false;
  if (source.length !== candidate.length) return false;
  const sortedSource = [...source].sort();
  const sortedCandidate = [...candidate].sort();
  return sortedSource.every((v, i) => v === sortedCandidate[i]);
}

/**
 * Evaluates a candidate question against a source question's
 * equivalence contract, dimension by dimension. Pure and independently
 * testable -- doesn't care how the candidate was produced, so this is
 * the single source of truth generateQuestionVariant validates against,
 * and it's exactly what a caller who already has two questions in hand
 * (e.g. picking between two already-generated questions) could use
 * directly without going through generation at all.
 */
export function evaluateVariantEquivalence(source: GeneratedQuestion, candidate: GeneratedQuestion): VariantEquivalenceEvaluation {
  const concept: EquivalenceCheckResult =
    candidate.conceptId === source.conceptId
      ? { passed: true, reason: 'Same concept.' }
      : { passed: false, reason: `Concept mismatch: source targets ${source.conceptId}, candidate targets ${candidate.conceptId}.` };

  const learningObjective = checkOptionalMatch(source.learningObjectiveId, candidate.learningObjectiveId, 'learning objective');
  const cognitiveLevel = checkOptionalMatch(source.cognitiveLevel, candidate.cognitiveLevel, 'cognitive level');
  const reasoningType = checkOptionalMatch(source.expectedReasoningType, candidate.expectedReasoningType, 'expected reasoning type');

  const requiredKnowledge: EquivalenceCheckResult = (() => {
    if (candidate.type !== source.type) {
      return { passed: false, reason: `Question type changed (${source.type} -> ${candidate.type}), so required knowledge can't be assumed equivalent.` };
    }
    const diff = Math.abs(candidate.difficulty - source.difficulty);
    if (diff > 1) {
      return { passed: false, reason: `Difficulty drifted by ${diff} points (source ${source.difficulty}, candidate ${candidate.difficulty}).` };
    }
    return { passed: true, reason: diff === 0 ? 'Same type and difficulty.' : 'Same type, difficulty within 1 point.' };
  })();

  const scoringIntent: EquivalenceCheckResult = (() => {
    if (candidate.answerFormat !== source.answerFormat) {
      return { passed: false, reason: `Answer format changed (${source.answerFormat} -> ${candidate.answerFormat}), so how this would be scored is no longer equivalent.` };
    }
    const intentCheck = checkOptionalMatch(source.questionIntent, candidate.questionIntent, 'question intent');
    if (!intentCheck.passed) return intentCheck;
    if (!evidenceDimensionsMatch(source.evidenceDimensions, candidate.evidenceDimensions)) {
      return { passed: false, reason: 'Evidence dimensions could not be confirmed to match the source.' };
    }
    return { passed: true, reason: 'Same answer format and evidence intent.' };
  })();

  const checks: VariantEquivalenceChecks = { concept, learningObjective, cognitiveLevel, reasoningType, requiredKnowledge, scoringIntent };
  const values = Object.values(checks);
  const equivalent = values.every((c) => c.passed);
  const confidence = values.filter((c) => c.passed).length / values.length;

  return { equivalent, confidence, checks };
}

/**
 * Generates one equivalent variant of `source`, reusing
 * generateQuestionsForConcept (RAG-grounded, same infra as every other
 * question) rather than a parallel generator -- internal use only
 * (VARIANT_GENERATION is an internal/system AI feature per the Phase 3A
 * permission policy, never student-facing).
 *
 * Validates every dimension via evaluateVariantEquivalence before
 * accepting -- concept, learning objective, cognitive level, reasoning
 * type, required knowledge (type+difficulty), and scoring/evidence
 * intent. Returns null -- never a silently non-equivalent question --
 * when generation fails, returns nothing, or ANY required dimension
 * fails closed; callers must fall back to reusing the original source
 * question in that case, so an assessment is never blocked because
 * variant generation didn't work.
 *
 * Once accepted, the variant inherits the source's own optional
 * semantic tags (learningObjectiveId/cognitiveLevel/expectedReasoningType/
 * questionIntent/evidenceDimensions) -- these describe the QUESTION
 * DESIGN being varied, not something the AI re-derives fresh per
 * variant, so a validated variant of a CHECK_APPLICATION question is
 * still a CHECK_APPLICATION question. The equivalence gate runs BEFORE
 * this inheritance, against the AI's raw, unmodified output, so it's a
 * real check against actual drift, not a check against data we just
 * copied in ourselves.
 */
export async function generateQuestionVariant(
  source: GeneratedQuestion,
  studentId: string,
  subjectId: string,
  language: string = 'en'
): Promise<{ variant: GeneratedQuestion; contract: VariantEquivalenceContract } | null> {
  let candidates: GeneratedQuestion[];
  try {
    candidates = await generateQuestionsForConcept(source.conceptId, studentId, subjectId, {
      count: 1,
      difficulty: source.difficulty,
      types: [source.type],
      guidance: `Produce ONE equivalent variant of this exact question, testing the same concept with the same reasoning and the same difficulty, but with different surface details (different numbers/context/wording) so it is not simply a repeat: "${source.question}"`,
      language,
      visualAidRate: 0,
    });
  } catch (error) {
    console.error('Error generating question variant:', error);
    return null;
  }

  const rawVariant = candidates[0];
  if (!rawVariant) return null;

  const evaluation = evaluateVariantEquivalence(source, rawVariant);
  if (!evaluation.equivalent) return null; // fails the equivalence contract -- fall back, never accept silently

  // LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate. A variant is
  // learner-facing (it replaces the original in a verification attempt --
  // an evidence-consequence moment), so it must clear the same
  // deterministic contract + semantic verdict every other generated
  // question does, on the AI's raw output, BEFORE the source's semantic
  // tags are copied in. Any failure -> null -> the caller falls back to
  // reusing the source question (assessment is never blocked).
  const { applyQuestionQualityGate } = await import('@/services/gated-question-generation.service');
  const vGate = await applyQuestionQualityGate([rawVariant], {
    conceptId: source.conceptId,
    language,
    context: { studentId, subjectId },
  });
  if (vGate.accepted.length === 0) return null;

  const variant: GeneratedQuestion = {
    ...rawVariant,
    learningObjectiveId: source.learningObjectiveId,
    cognitiveLevel: source.cognitiveLevel,
    expectedReasoningType: source.expectedReasoningType,
    questionIntent: source.questionIntent,
    evidenceDimensions: source.evidenceDimensions,
  };

  return {
    variant,
    contract: {
      sourceQuestionId: source.id,
      variantQuestionId: variant.id,
      conceptId: source.conceptId,
      learningObjectiveId: source.learningObjectiveId,
      cognitiveLevel: source.cognitiveLevel,
      difficultyBand: difficultyBand(source.difficulty),
      reasoningPattern: source.expectedReasoningType,
      equivalenceConfidence: evaluation.confidence,
      equivalent: evaluation.equivalent,
      checks: evaluation.checks,
    },
  };
}

/**
 * LX-4P-PERF-R1F -- safe structural diagnostics only. NEVER includes
 * question text, options, explanations, prompts, or RAG content --
 * shape/counts/booleans only, safe for QA to read from logs.
 */
type QuestionBatchFailureStage =
  | 'NONE'
  | 'EMPTY_RESPONSE'
  | 'OUTPUT_TRUNCATED'
  | 'INVALID_JSON'
  | 'BATCH_WRAPPER_INVALID';

interface QuestionBatchDiagnostics {
  model: string;
  finishReason: string | null;
  hasContent: boolean;
  contentLength: number;
  hasRefusal: boolean;
  hasUsage: boolean;
  parsedRoot: 'OBJECT' | 'ARRAY' | 'NULL' | 'INVALID_JSON';
  keys: string[];
  questionsCount: number | null;
  failureStage: QuestionBatchFailureStage;
  /** R12: proves domain parsing is negligible next to the model call itself (which is logged separately by the gateway's own [ai] execution record). */
  parseMs: number;
}

function logQuestionBatchDiagnostics(d: QuestionBatchDiagnostics): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[ai-structure]', JSON.stringify(d));
  } catch {
    /* logging must never throw */
  }
}

interface QuestionBatchParseOutcome {
  ok: boolean;
  questions: any[];
  failureStage: QuestionBatchFailureStage;
  detail?: string;
  parsedRoot: QuestionBatchDiagnostics['parsedRoot'];
  keys: string[];
}

/**
 * LX-4P-PERF-R1F R5 -- the ONE explicit boundary between OpenAI's
 * strict, OBJECT-rooted Structured Output (`{"questions": [...]}` --
 * required because strict Structured Outputs cannot root a schema in a
 * bare array) and this module's array-shaped `GeneratedQuestion[]`
 * domain contract. No other function in this file unwraps `.questions`
 * itself -- every QUESTION_GENERATION call site's `validate` closure
 * goes through here.
 *
 * Root cause this replaces: every call site used to do
 * `parsed = parseAIJson<any[]>(repaired)` -- a compile-time-only cast
 * with NO runtime check -- and then call `.filter()`/index into
 * `parsed` as if it were always an array. Once the model (correctly)
 * returned an object (`{"questions": [...]}"`), `.filter` on a plain
 * object threw, and that uncaught throw inside `validate` was what
 * `executeAI` classified as `INVALID_RESPONSE` -- a StudyUS contract
 * mismatch, not a provider or quality defect. This function makes that
 * shape check explicit and never throws; a mismatch becomes an ordinary
 * `{valid:false}` (-> `VALIDATION_ERROR`, correctly classified) instead
 * of an uncaught exception.
 *
 * R6: this is the LIVE OpenAI runtime boundary -- it never silently
 * accepts a bare array here (that would hide a real regression).
 * Historical/offline `GeneratedQuestion[]` content (the Sonnet quality
 * baseline corpus, cached `quiz_sessions.questions` rows) is read
 * directly from storage as already-typed `GeneratedQuestion[]` and
 * never passes through this parser at all -- that compatibility stays
 * explicit at the storage boundary, not smuggled in here.
 */
function parseGeneratedQuestionBatch(rawText: string, finishReason: string | null): QuestionBatchParseOutcome {
  if (!rawText) {
    return { ok: false, questions: [], failureStage: 'EMPTY_RESPONSE', detail: 'empty content', parsedRoot: 'NULL', keys: [] };
  }

  const repaired = repairInvalidJsonEscapes(rawText);
  let parsed: unknown;
  try {
    parsed = parseAIJson<unknown>(repaired);
  } catch {
    const salvaged = salvageQuestionBatch(repaired);
    if (salvaged.length > 0) {
      return { ok: true, questions: salvaged, failureStage: 'NONE', detail: `salvaged ${salvaged.length} from a truncated response`, parsedRoot: 'INVALID_JSON', keys: [] };
    }
    return {
      ok: false,
      questions: [],
      failureStage: finishReason === 'length' ? 'OUTPUT_TRUNCATED' : 'INVALID_JSON',
      detail: 'not valid JSON and nothing could be salvaged',
      parsedRoot: 'INVALID_JSON',
      keys: [],
    };
  }

  const parsedRoot: QuestionBatchDiagnostics['parsedRoot'] =
    parsed === null ? 'NULL' : Array.isArray(parsed) ? 'ARRAY' : typeof parsed === 'object' ? 'OBJECT' : 'INVALID_JSON';
  const keys = parsedRoot === 'OBJECT' ? Object.keys(parsed as object) : [];

  if (parsedRoot !== 'OBJECT' || !Array.isArray((parsed as any).questions)) {
    return {
      ok: false,
      questions: [],
      failureStage: 'BATCH_WRAPPER_INVALID',
      detail: `expected an object with a "questions" array; got ${parsedRoot.toLowerCase()}`,
      parsedRoot,
      keys,
    };
  }

  return { ok: true, questions: (parsed as any).questions, failureStage: 'NONE', parsedRoot, keys };
}

/**
 * Recover the leading complete question objects from a
 * `{"questions": [ ...` payload cut off mid-stream -- the object-wrapper
 * analogue of the old bare-array salvage. Tries progressively shorter
 * prefixes, closing both the array and the wrapping object.
 */
function salvageQuestionBatch(text: string): any[] {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const qIdx = stripped.indexOf('"questions"');
  if (qIdx === -1) return [];
  let lastBrace = stripped.lastIndexOf('}');
  while (lastBrace > qIdx) {
    const candidate = stripped.slice(0, lastBrace + 1) + ']}';
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
    } catch {
      // keep shrinking
    }
    lastBrace = stripped.lastIndexOf('}', lastBrace - 1);
  }
  return [];
}

/**
 * STABILIZATION QUIZ PERFORMANCE Step 18. QUESTION_GENERATION asks the
 * model to embed LaTeX (REQUIREMENTS item 7 above) inside JSON string
 * values -- prompt v3 now tells it every LaTeX backslash must be
 * doubled for JSON, but real model output can still occasionally slip.
 * This is defense-in-depth on top of that prompt fix, local to
 * QUESTION_GENERATION only -- src/lib/ai-json.ts's parseAIJson and the
 * shared validateJson are never touched (Step 15's blast-radius
 * finding: those are also used by GRADING/HINTS/CLASSIFICATION/
 * CONTENT_GENERATION, none of which share this LaTeX-heavy risk).
 *
 * Two independent problems, two independent fixes (Steps 15-17):
 *
 * CLASS A -- invalid JSON escape (`\cdot`, `\sum`, `\sqrt`, `\alpha`):
 * `\c`, `\s`, `\a` etc. aren't valid JSON escapes, so JSON.parse throws.
 * repairInvalidJsonEscapes fixes this by doubling any backslash NOT
 * already followed by a valid JSON escape character -- applied to raw
 * model output BEFORE parseAIJson/salvageQuestionBatch. This alone is NOT
 * sufficient for CLASS B (Step 16's own finding) -- doubling a
 * backslash that's already a valid escape would break genuinely
 * intended `\n`/`\t`/etc., so it deliberately leaves those alone.
 *
 * CLASS B -- valid JSON escape, silent corruption (`\times`, `\theta`,
 * `\frac`, `\rightarrow`, `\begin`, `\neq`, `\nabla` -- any LaTeX
 * command starting with b/f/n/r/t/u): JSON.parse SUCCEEDS but silently
 * consumes the backslash+letter as a real control character, losing
 * the first letter of the command. Nothing about the JSON is invalid,
 * so this can only be caught AFTER a successful parse, by inspecting
 * the resulting text. isLatexCorrupted (used by every QUESTION_
 * GENERATION call site's `validate`) rejects a raw question if any
 * LATEX_CAPABLE_FIELD contains:
 *   - TAB / FORM_FEED / BACKSPACE / CARRIAGE_RETURN anywhere -- these
 *     have no legitimate use anywhere in learner-facing quiz text,
 *     confirmed against real stored production content (Step 17: 0
 *     occurrences across 700 real math spans and 472 real text fields).
 *   - NEWLINE, but ONLY inside an identified $...$/$$...$$ math span --
 *     real multi-line explanations ("Paso 1... \n\n Paso 2...") are a
 *     confirmed, legitimate, observed pattern outside math (Step 17:
 *     2 real occurrences, both outside any math span, 0 real math
 *     spans ever contained one), so newline is never rejected there.
 *
 * Known, accepted false positive (Step 17): a bare currency "$" pair
 * (e.g. "$5... $10") can be misidentified as a math span by this same
 * "$" delimiter heuristic. If a genuine newline happens to land between
 * two such amounts, this rejects legitimate content. Accepted
 * deliberately -- the failure direction is safe. A false reject costs
 * one fewer question (topic_practice/review's existing partial
 * tolerance) or one failed slot (quick_check's existing all-or-nothing);
 * it never lets corrupted math reach a student, which is the priority
 * this whole mechanism protects. No LaTeX-command dictionary, no custom
 * JSON parser -- deliberately avoided per the Step 17 design (an
 * incomplete dictionary gives false confidence; a hand-rolled parser is
 * disproportionate engineering for what's fundamentally a small,
 * bounded set of always-suspicious control characters).
 */
function repairInvalidJsonEscapes(text: string): string {
  // Matches EITHER a complete, already-valid 2-character JSON escape
  // sequence (backslash + one of ["\\/bfnrtu]) -- consumed atomically
  // and left untouched -- OR a lone backslash on its own, which gets
  // doubled. The atomic first alternative is what makes this safe on
  // text that's ALREADY correctly double-escaped (increasingly the
  // common case once the v3 prompt fix is working): a naive per-
  // character "double any backslash not followed by a valid escape
  // char" scan (an earlier version of this function) would examine the
  // SECOND backslash of an already-correct "\\\\cdot" pair on its own,
  // see it's followed by 'c' (not a valid escape char), and double it
  // AGAIN -- corrupting already-valid JSON into 3 backslashes, which
  // JSON.parse rejects. Matching the pair as one unit prevents that.
  return text.replace(/\\["\\/bfnrtu]|\\/g, (match) => (match.length === 2 ? match : '\\\\'));
}

const LATEX_UNCONDITIONAL_SUSPICIOUS_CHARS = /[\t\f\b\r]/; // TAB, FORM_FEED, BACKSPACE, CARRIAGE_RETURN
const LATEX_DISPLAY_MATH_RE = /\$\$([\s\S]*?)\$\$/g;
const LATEX_INLINE_MATH_RE = /\$([^$]*?)\$/g;

function textHasLatexCorruption(text: string): boolean {
  if (LATEX_UNCONDITIONAL_SUSPICIOUS_CHARS.test(text)) return true;
  LATEX_DISPLAY_MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LATEX_DISPLAY_MATH_RE.exec(text))) {
    if (m[1].includes('\n')) return true;
  }
  const withoutDisplayMath = text.replace(LATEX_DISPLAY_MATH_RE, '');
  LATEX_INLINE_MATH_RE.lastIndex = 0;
  while ((m = LATEX_INLINE_MATH_RE.exec(withoutDisplayMath))) {
    if (m[1].includes('\n')) return true;
  }
  return false;
}

/** Every LaTeX-capable free-text field a raw generated question can carry (Step 16's authoritative list). */
function collectLatexCapableStrings(q: any): string[] {
  if (!q || typeof q !== 'object') return [];
  const strings: string[] = [];
  const pushIf = (v: any) => {
    if (typeof v === 'string') strings.push(v);
  };
  pushIf(q.question);
  pushIf(q.explanation);
  pushIf(q.correctAnswer);
  if (Array.isArray(q.options)) for (const o of q.options) pushIf(o?.text);
  if (Array.isArray(q.matchingPairs)) for (const p of q.matchingPairs) {
    pushIf(p?.left);
    pushIf(p?.right);
  }
  if (Array.isArray(q.orderingItems)) for (const item of q.orderingItems) pushIf(item);
  if (Array.isArray(q.classificationCategories)) for (const c of q.classificationCategories) pushIf(c);
  if (Array.isArray(q.classificationItems)) for (const c of q.classificationItems) pushIf(c?.item);
  if (q.visualAid && typeof q.visualAid === 'object') {
    pushIf(q.visualAid.caption);
    if (q.visualAid.chartData && typeof q.visualAid.chartData === 'object') {
      pushIf(q.visualAid.chartData.xLabel);
      pushIf(q.visualAid.chartData.yLabel);
      if (Array.isArray(q.visualAid.chartData.labels)) for (const l of q.visualAid.chartData.labels) pushIf(l);
    }
  }
  return strings;
}

function isLatexCorrupted(rawQuestion: any): boolean {
  return collectLatexCapableStrings(rawQuestion).some(textHasLatexCorruption);
}

function normalizeOptions(raw: any): QuestionOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((o) => {
      if (typeof o === 'string') return { id: o, text: o };
      if (o && typeof o.text === 'string') return { id: String(o.id ?? o.text), text: o.text };
      return null;
    })
    .filter((o): o is QuestionOption => o !== null);
}

const SVG_SCRIPT_PATTERN = /<script[\s\S]*?<\/script>/gi;
const SVG_EVENT_ATTR_PATTERN = /\son\w+\s*=\s*("[^"]*"|'[^']*')/gi;

function sanitizeVisualAid(raw: any): VisualAid | undefined {
  if (!raw || (raw.kind !== 'diagram' && raw.kind !== 'chart')) return undefined;
  const aid: VisualAid = { kind: raw.kind, caption: typeof raw.caption === 'string' ? raw.caption : undefined };
  if (raw.kind === 'diagram' && typeof raw.svg === 'string' && raw.svg.trim().startsWith('<svg')) {
    aid.svg = raw.svg.replace(SVG_SCRIPT_PATTERN, '').replace(SVG_EVENT_ATTR_PATTERN, '');
  }
  if (raw.kind === 'chart' && raw.chartData && Array.isArray(raw.chartData.labels) && Array.isArray(raw.chartData.values)) {
    aid.chartData = {
      chartType: raw.chartData.chartType === 'bar' ? 'bar' : 'line',
      labels: raw.chartData.labels.map(String),
      values: raw.chartData.values.map(Number),
      xLabel: typeof raw.chartData.xLabel === 'string' ? raw.chartData.xLabel : undefined,
      yLabel: typeof raw.chartData.yLabel === 'string' ? raw.chartData.yLabel : undefined,
    };
  }
  if (!aid.svg && !aid.chartData) return undefined;
  return aid;
}

/**
 * Grade a structured (objectively checkable) answer deterministically
 * -- no AI call needed for single/multi choice, matching, ordering, or
 * classification, since correctness is a direct comparison. Partial
 * credit applies to multi_choice, matching, ordering, and
 * classification (all-or-nothing would be too harsh for a 5-pair
 * matching question with 4 right).
 */
export function gradeStructuredAnswer(
  question: GeneratedQuestion,
  studentAnswer: string
): { correct: boolean; score: number; feedback: string } {
  const format = question.answerFormat;

  if (format === 'single_choice') {
    const correct = studentAnswer === question.correctAnswer;
    return { correct, score: correct ? 1 : 0, feedback: '' };
  }

  if (format === 'multi_choice') {
    const correctSet = new Set(question.correctAnswer.split(',').map((s) => s.trim()).filter(Boolean));
    const studentSet = new Set(studentAnswer.split(',').map((s) => s.trim()).filter(Boolean));
    const totalOptions = question.options?.length ?? correctSet.size;
    let hits = 0;
    let misses = 0;
    for (const id of studentSet) (correctSet.has(id) ? hits++ : misses++);
    const missed = [...correctSet].filter((id) => !studentSet.has(id)).length;
    const score = Math.max(0, (hits - misses) / Math.max(1, correctSet.size));
    const correct = score === 1 && missed === 0 && misses === 0;
    return { correct, score: Math.min(1, score), feedback: '' };
  }

  if (format === 'matching') {
    let studentPairs: Record<string, string> = {};
    try {
      studentPairs = JSON.parse(studentAnswer);
    } catch {
      return { correct: false, score: 0, feedback: '' };
    }
    const pairs = question.matchingPairs || [];
    const correctCount = pairs.filter((p) => studentPairs[p.left] === p.right).length;
    const score = pairs.length ? correctCount / pairs.length : 0;
    return { correct: score === 1, score, feedback: '' };
  }

  if (format === 'ordering') {
    let studentOrder: string[] = [];
    try {
      studentOrder = JSON.parse(studentAnswer);
    } catch {
      return { correct: false, score: 0, feedback: '' };
    }
    const correctOrder = question.orderingItems || [];
    const correctPositions = correctOrder.filter((item, i) => studentOrder[i] === item).length;
    const score = correctOrder.length ? correctPositions / correctOrder.length : 0;
    return { correct: score === 1, score, feedback: '' };
  }

  if (format === 'classification') {
    let studentMap: Record<string, string> = {};
    try {
      studentMap = JSON.parse(studentAnswer);
    } catch {
      return { correct: false, score: 0, feedback: '' };
    }
    const items = question.classificationItems || [];
    const correctCount = items.filter((it) => studentMap[it.item] === it.category).length;
    const score = items.length ? correctCount / items.length : 0;
    return { correct: score === 1, score, feedback: '' };
  }

  return { correct: false, score: 0, feedback: '' };
}

/**
 * Grade a free-text answer (short_answer, open_ended, fill_blank,
 * numeric_problem, step_by_step, case_study, scenario, error_detection,
 * justification, comparison, prediction) using Claude for semantic
 * understanding -- these can't be compared as strings.
 */
// Phase 3B: ARITHMETIC/UNIT are additive to the original five -- a wrong
// final answer from an otherwise correct method (a sign slip, or forgetting
// to convert units) is a materially different signal than a genuine
// CONCEPTUAL misunderstanding, and structured math/science reasoning
// analysis (see reasoningValid below) needs a way to say so.
export type GradingErrorType = 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING' | 'ARITHMETIC' | 'UNIT';

export interface GradeAnswerResult {
  correct: boolean;
  score: number; // 0-1 (0 = wrong, 1 = perfect, 0.5 = partial)
  feedback: string;
  confidence: number; // 0-1 (how confident in grading)
  errorType: GradingErrorType | null; // null when correct
  // Phase 3B: distinct from `correct` -- a correct final answer reached
  // through invalid/lucky reasoning is weaker evidence than one reached
  // through valid reasoning, and a wrong final answer with valid method
  // (ARITHMETIC/UNIT/CARELESS) is stronger evidence of understanding than
  // one reached through invalid reasoning (CONCEPTUAL/MISREADING). Only
  // meaningful where the question actually has visible reasoning/work to
  // evaluate (numeric_problem, step_by_step, and similar); defaults to
  // true (matching `correct`) when there's no separate reasoning to judge.
  reasoningValid: boolean;
  /**
   * Phase 0E1 AI provenance -- which execution produced this grade
   * (executionId/provider/model/promptId/promptVersion), including on
   * a fallback path, so a fallback grade can still be traced back to
   * the attempt that triggered it. Purely additive: no pre-existing
   * caller reads this field, so its presence changes nothing.
   */
  aiExecution: AIProvenance;
}

/**
 * Grade a free-text answer using Claude for semantic understanding.
 * HIGH_RISK (Phase 0E1): this result feeds directly into
 * mastery.service.ts's updateMastery via the caller, so the AI output
 * must be structurally validated before any deterministic logic sees
 * it (Step 11) -- see the `validate` step below. Grading semantics,
 * thresholds, and both existing fallback tiers (parse-failure ->
 * string match, total-failure -> score 0) are preserved exactly.
 */
export async function gradeAnswer(
  question: GeneratedQuestion,
  studentAnswer: string,
  language: string = 'en',
  /** Phase 0E2 Step 11: optional, purely additive -- enriches the persisted ai_execution_events row when the caller has it. */
  context?: { studentId?: string; subjectId?: string }
): Promise<GradeAnswerResult> {
  const prompt = getPrompt('quiz.free_text_grading');
  const systemPrompt = `You are an educational grader. Evaluate student answers on their merits, not on matching exact wording:
- short_answer/fill_blank: accept equivalent phrasing/values, partial credit if partially right
- numeric_problem/step_by_step: check the work and the final result, partial credit for correct method with an arithmetic slip
- open_ended/case_study/comparison: evaluate the understanding shown against the key points in the model answer
- scenario/prediction/justification: evaluate the reasoning, not just the final claim
- error_detection: correct only if the student identifies the actual error (not just "something is wrong")

Be fair but rigorous. Confidence = how sure you are in the grade.

When the answer is not fully correct, classify why into exactly one errorType:
- CONCEPTUAL: misunderstood the underlying idea, not just the execution
- PROCEDURAL: understood the concept but made a mistake applying the method/steps
- CARELESS: a minor slip (sign error, typo, misread a number) on otherwise correct work
- INCOMPLETE: correct as far as it goes, but didn't finish the reasoning/answer
- MISREADING: answered a different question than the one asked
- ARITHMETIC: the method/formula/setup was correct but a calculation step was wrong (only for numeric_problem/step_by_step-style work)
- UNIT: the method and calculation were correct but units were wrong, missing, or mis-converted (only for numeric_problem/step_by_step-style work)
Set errorType to null when correct is true.

For numeric_problem/step_by_step and any answer that shows work: also set "reasoningValid" -- true if the underlying method/reasoning was sound (even if the final number is wrong, e.g. ARITHMETIC/UNIT/CARELESS errors), false if the reasoning itself was flawed (e.g. CONCEPTUAL/PROCEDURAL/MISREADING errors, or a correct final answer reached by a method that doesn't actually follow). For question types with no visible reasoning/work to judge, set reasoningValid equal to "correct".

Write the "feedback" field entirely in ${LOCALE_FULL_NAME[language] || language}.`;

  const parseFailureFallback = (): Omit<GradeAnswerResult, 'aiExecution'> => {
    console.error('Failed to parse grading response');
    const matched = studentAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
    return {
      correct: matched,
      score: matched ? 1 : 0,
      feedback: 'Please review the explanation above.',
      confidence: 0.5,
      errorType: matched ? null : null,
      reasoningValid: matched,
    };
  };
  const totalFailureFallback = (): Omit<GradeAnswerResult, 'aiExecution'> => ({
    correct: false,
    score: 0,
    feedback: 'Error grading answer. Please try again.',
    confidence: 0,
    errorType: null,
    reasoningValid: false,
  });

  const { result, provenance } = await executeAI({
    capability: prompt.capability,
    risk: 'HIGH_RISK',
    provider: GRADE_ROUTE.provider,
    model: GRADE_ROUTE.primary,
    promptId: prompt.id,
    promptVersion: prompt.version,
    context: { studentId: context?.studentId, subjectId: context?.subjectId, conceptId: question.conceptId, sourceComponent: 'quiz-generation.service.ts:gradeAnswer' },
    call: (signal) =>
      callModel(
        {
          provider: GRADE_ROUTE.provider,
          model: GRADE_ROUTE.primary,
          maxTokens: 1536,
          system: systemPrompt,
          user: `Grade this answer:

Question type: ${question.type}
Question: ${question.question}
Model/expected answer: ${question.correctAnswer}
Student Answer: ${studentAnswer}

Respond with JSON (no markdown):
{
  "correct": true/false,
  "score": 0.0-1.0,
  "feedback": "...",
  "confidence": 0.0-1.0,
  "errorType": "CONCEPTUAL" | "PROCEDURAL" | "CARELESS" | "INCOMPLETE" | "MISREADING" | "ARITHMETIC" | "UNIT" | null,
  "reasoningValid": true/false
}`,
        },
        signal
      ),
    validate: (raw) =>
      validateJson(raw, (gradeResult) => {
        if (!gradeResult || typeof gradeResult !== 'object' || Array.isArray(gradeResult)) {
          return { value: null as any, errors: ['Grading response was not a JSON object'] };
        }
        const value: Omit<GradeAnswerResult, 'aiExecution'> = {
          correct: gradeResult.correct,
          score: clamp(Number(gradeResult.score) || 0, 0, 1),
          feedback: gradeResult.feedback || '',
          confidence: clamp(Number(gradeResult.confidence) || 0.7, 0, 1),
          errorType: gradeResult.correct ? null : gradeResult.errorType || null,
          reasoningValid: typeof gradeResult.reasoningValid === 'boolean' ? gradeResult.reasoningValid : !!gradeResult.correct,
        };
        return { value, errors: [] };
      }),
    // Covers BOTH pre-existing fallback tiers: a parse/validation failure
    // (INVALID_RESPONSE/VALIDATION_ERROR) uses the string-match fallback
    // exactly as before; a transport/provider/timeout failure uses the
    // total-failure fallback exactly as before.
    fallback: (error) =>
      error.code === 'INVALID_RESPONSE' || error.code === 'VALIDATION_ERROR' ? parseFailureFallback() : totalFailureFallback(),
  });

  return { ...result, aiExecution: provenance };
}

/**
 * Build augmented prompt with context
 */
function buildQuestionGenerationPrompt(
  types: QuestionType[],
  difficulty: number,
  language: string,
  chunks: Array<{ text: string }>,
  visualAidRate: number,
  guidance: string,
  ibContext?: IBContext | null,
  conceptContext?: { label: string; subjectName: string } | null
): string {
  const typeInstructions = types.map((t) => `- ${typeInstruction(t)}`).join('\n');

  let difficultyDesc = '';
  if (difficulty <= 2) difficultyDesc = 'basic, foundational understanding';
  else if (difficulty <= 3) difficultyDesc = 'intermediate, requires some analysis';
  else if (difficulty <= 4) difficultyDesc = 'advanced, requires application and synthesis';
  else difficultyDesc = 'expert, requires deep understanding and integration';

  const languageName = LOCALE_FULL_NAME[language] || language;

  const visualInstruction =
    visualAidRate > 0
      ? `\nVISUAL AIDS: for roughly ${Math.round(visualAidRate * 100)}% of questions where it genuinely helps (data trends, diagrams of a process/apparatus, spatial relationships), attach a "visualAid":
- kind "chart": include "chartData" with a small plausible dataset (labels + numeric values) the question asks the student to read/interpret.
- kind "diagram": include "svg", a small self-contained <svg> (viewBox around "0 0 300 200", using only <rect>/<circle>/<line>/<path>/<text>/<polygon>, no <script>, no external references) illustrating the concept.
Only add a visualAid when it makes the question clearer, not on every question.`
      : '';

  const ibInstruction = ibContext
    ? (() => {
        const terms = commandTermsForDifficulty(difficulty);
        const groupLabel = IB_SUBJECT_GROUPS.find((g) => g.value === ibContext.subjectGroup)?.label;
        const criteria = ibContext.programme === 'MYP' && ibContext.subjectGroup ? MYP_CRITERIA[ibContext.subjectGroup] : null;
        return `

IB ALIGNMENT: This subject is tagged as IB ${ibContext.programme}${ibContext.level ? ` ${ibContext.level}` : ''}${groupLabel ? ` (${groupLabel})` : ''}. Phrase each question stem using authentic IB command-term style for this difficulty level -- lead with one of: ${terms.join(', ')}. Use these terms the way the IB does: "${terms[0]}" expects a brief, direct response; a term like "Discuss"/"Evaluate"/"To what extent" (when in the list) expects a reasoned, balanced response, not a one-word answer.${
          criteria
            ? ` Where natural, favor question angles that map to these MYP criteria for this subject group: ${criteria.map((c) => `${c.code} (${c.label})`).join('; ')} -- vary which criterion a question leans toward across the set rather than testing only one.`
            : ''
        } This is a practice aid aligned to IB's general conventions, not a reproduction of any official subject guide's exact wording.`;
      })()
    : '';

  const usingGeneralKnowledge = chunks.length === 0 && !!conceptContext;

  const contextBlock = usingGeneralKnowledge
    ? `CONCEPT (no uploaded material found for it -- use accurate general knowledge instead):
"${conceptContext!.label}", in the subject "${conceptContext!.subjectName}".`
    : `CONTEXT (student's actual materials):
${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;

  const groundingRequirement = usingGeneralKnowledge
    ? `2. No student material was found for this concept -- use accurate, well-established general knowledge of it instead. Do not fabricate facts that aren't genuinely true of this concept.`
    : `2. Use ONLY the provided context above -- do not invent facts outside it`;

  const closingNote = usingGeneralKnowledge
    ? `IMPORTANT: Every question must be genuinely answerable from correct general knowledge of "${conceptContext!.label}" -- do not invent details, statistics, or claims that aren't actually true of it.`
    : `IMPORTANT: Do not invent content. Every question must be answerable from the provided material.`;

  return `You are an expert educator creating assessment questions.

LANGUAGE: Write EVERYTHING in ${languageName} -- the question text, every
option/pair/item, and the explanation. Do not mix in any other language,
even if the source material below is in a different language.

${contextBlock}

QUESTION TYPES AVAILABLE -- for EACH question, choose whichever type genuinely fits that specific piece of content best. Don't force every question into the same type, and don't use a type just because it's on the list if it doesn't suit what you're testing here:
${typeInstructions}

QUIZ PURPOSE: ${guidance}
${visualInstruction}${ibInstruction}

REQUIREMENTS:
1. Difficulty level (${difficulty}/5): ${difficultyDesc}
${groundingRequirement}
3. Every field in your JSON output must be written in ${languageName}
4. Questions should test understanding, not just recall
5. Every question must include a clear, complete "explanation" of the correct answer/solution -- this is shown to the student during review, so it should stand on its own even without seeing the source material
6. For ANY question (regardless of type) that requires numerical calculation to answer, include "calculatorAllowed": true or false, matching real exam convention for this kind of problem (e.g. a quick estimation or simple arithmetic step is typically no-calculator; multi-step or decimal-heavy computation typically allows one). Omit "calculatorAllowed" entirely for questions that involve no calculation at all.
7. MATH NOTATION: whenever a question, option, correctAnswer, or explanation contains a mathematical expression (fractions, exponents, limits, integrals, roots, Greek letters, subscripts, etc.), write it as LaTeX wrapped in dollar delimiters -- "$$...$$" for a standalone/display equation on its own (e.g. a limit being evaluated), "$...$" for a short expression inline within a sentence (e.g. "the radius $r$"). Never write a standalone equation as plain ASCII (e.g. "lim x->2 (x^2-4)/(x-2)") or describe it only in words -- the app renders "$$...$$"/"$...$" with real math typesetting, so use it for every formula, in the question text AND the explanation's worked steps. Your entire response is a JSON document. Every backslash inside your LaTeX must itself be escaped for JSON: write it as two backslashes in the raw JSON for every one backslash LaTeX needs. For example: to display \\frac{a}{b}, write \\\\frac{a}{b} in your JSON output (not \\frac{a}{b}); to display \\times, write \\\\times; to display \\sqrt{x}, write \\\\sqrt{x}. A single backslash immediately before a letter is invalid JSON, or worse, silently corrupts your output into an unreadable control character -- never emit one. Do not use any math delimiter other than "$...$" or "$$...$$".
8. Tag EVERY question with "cognitiveLevel", "questionIntent" and "expectedReasoningType", judged honestly against what the question actually demands -- never default to the same value for every question just because it's convenient:
   - "cognitiveLevel" (the cognitive demand genuinely required to answer, Bloom's taxonomy): "RECALL" (state a fact/definition from memory), "COMPREHENSION" (explain or restate an idea in one's own words), "APPLICATION" (use the concept to solve a new, concrete problem), "ANALYSIS" (break a situation down into its parts or identify relationships/causes), "SYNTHESIS" (combine ideas into something new -- a plan, a design, an original argument), "EVALUATION" (make and justify a judgment against criteria).
   - "questionIntent" (what this question is primarily evidence of): "CHECK_UNDERSTANDING" (does the student grasp the concept itself), "CHECK_APPLICATION" (can the student use it in a concrete case), "CHECK_TRANSFER" (can the student use it in an unfamiliar context or combined with other concepts), "DIAGNOSTIC_PROBE" (designed to reveal a specific likely misconception rather than just pass/fail).
   - "expectedReasoningType" (what a COMPLETE correct response must actually demonstrate -- this sets what the student is told to provide and what the grader is allowed to score): "FACTUAL" (recall/state the answer; no working or explanation is expected -- typical for a definition or a single-value lookup), "PROCEDURAL" (a method/derivation must be shown, not only the final value -- e.g. a multi-step calculation where the working is the point), "CONCEPTUAL" (the response must explain WHY, in the student's own words, not just give a result), "METACOGNITIVE" (the student must reflect on or justify their own choice/confidence/approach). Choose FACTUAL for a plain numeric or short-answer question that only needs the answer; choose PROCEDURAL only when the working genuinely must be assessed.

${closingNote}`;
}

/**
 * Generate a short list of non-revealing hints for one quiz question.
 * Deliberately excludes matchingPairs/orderingItems/classificationItems
 * from the prompt (those fields encode the correct structure directly)
 * -- only the question text and, for choice questions, the option
 * texts (which don't by themselves reveal which one is correct) are
 * passed in.
 *
 * Phase 5-R S2/S9: `generationContext`, when supplied by the caller
 * (`/api/quizzes/hint`, only ever for a PRACTICE-evidence-mode session
 * -- `canUseAI` already denies this call entirely otherwise, see that
 * route), shapes HOW explicit/targeted the hint is (support level,
 * misconception/prerequisite targeting, strategy, anti-repetition).
 * The CRITICAL RULES below are NEVER weakened by it -- no support
 * level or strategy instruction may ever cause a full answer reveal;
 * `supportLevelInstruction`'s own text for every level stops short of
 * "give the answer," and this function's own hard rules are stated
 * again, after the adaptive block, as the final word.
 */
export async function generateQuestionHint(
  question: GeneratedQuestion,
  language: string = 'en',
  generationContext?: TeachingGenerationContext,
  aiContext?: AIExecutionContext
): Promise<string[]> {
  const languageName = LOCALE_FULL_NAME[language] || language;

  const optionsBlock =
    question.options && question.options.length > 0
      ? `\n\nAnswer options shown to the student:\n${question.options.map((o) => `- ${o.text}`).join('\n')}`
      : '';

  const adaptiveBlock = generationContext ? `\n\n${buildTeachingConstraintsBlock(generationContext)}` : '';
  // Phase 7 Step 7E3: the ONE supported surface that consumes the
  // teach-for-transfer advisory. Empty (and omitted) unless the Phase 4
  // decision behind this hint carries a transfer signal/state. The
  // CRITICAL no-answer-reveal rules below always follow it and are
  // never weakened by it.
  const transferPrepText = transferPreparationInstruction(generationContext?.transferPreparation);
  const transferPrepBlock = transferPrepText ? `\n\n${transferPrepText}` : '';

  const systemPrompt = `You are a supportive tutor giving a HINT for a quiz question the student is actively trying to answer themselves.
${adaptiveBlock}${transferPrepBlock}

CRITICAL RULES -- never break these, regardless of any guidance above:
- NEVER state or imply the correct answer, even partially.
- NEVER give a step-by-step procedure, formula application, or worked solution.
- NEVER do any part of the reasoning or calculation for them.
- NEVER say which option (if any) is correct or can be eliminated.

Instead, give 2-3 short hints that redirect their THINKING -- e.g. what concept, definition, or relationship is relevant here, what detail in the question to pay closer attention to, or a question they should ask themselves before answering. Each hint must be one short sentence.

Write the hints in ${languageName}.

Output ONLY a JSON array of strings, no markdown, no explanation. Example shape: ["hint one", "hint two"]`;

  const userPrompt = `Question: "${question.question}"${optionsBlock}

Give 2-3 hints following the rules above.`;

  const prompt = getPrompt('quiz.question_hint');
  // LX-4P-PERF-R1C C9: contextual help -> Luna primary; concise (budget).
  const HINT_ROUTE = resolveModels(prompt.capability);
  const HINT_BUDGET = budgetFor('contextual_help');
  try {
    const { result } = await executeAI({
      capability: prompt.capability,
      risk: 'LOW_RISK',
      provider: HINT_ROUTE.provider,
      model: HINT_ROUTE.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: aiContext ? { ...aiContext, sourceComponent: 'quiz-generation.service.ts:generateQuestionHint' } : undefined,
      call: (signal) =>
        callModel({ provider: HINT_ROUTE.provider, model: HINT_ROUTE.primary, maxTokens: HINT_BUDGET.maxOutputTokens, reasoningEffort: HINT_BUDGET.reasoningEffort, system: systemPrompt, user: userPrompt }, signal),
      validate: (raw) =>
        validateJson(raw, (parsed) => {
          if (!Array.isArray(parsed)) return { value: [] as string[], errors: [] };
          return { value: parsed.filter((s): s is string => typeof s === 'string').slice(0, 3), errors: [] };
        }),
    });
    return result;
  } catch (error) {
    console.error('Error generating question hint:', error);
    throw error;
  }
}
