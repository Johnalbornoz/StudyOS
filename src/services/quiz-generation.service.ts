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
import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { commandTermsForDifficulty, IB_SUBJECT_GROUPS, MYP_CRITERIA } from '@/lib/ib';

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
 * Generate quiz questions for a concept. `types` is the catalog Claude
 * is allowed to draw from (defaults to all 18 models) -- it does not
 * dictate which ones to actually use. Claude picks whichever types
 * genuinely fit this specific material and concept, steered by
 * `guidance` (a short instruction reflecting the quiz's purpose, e.g.
 * "keep it fast" for a quick check vs. "use the most demanding types
 * this material supports" for an exam simulation). `visualAidRate`
 * (0-1) controls how often a question gets a generated diagram/chart.
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
  } = {}
): Promise<GeneratedQuestion[]> {
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

    const systemPrompt = buildQuestionGenerationPrompt(
      types,
      difficulty,
      language,
      context.chunks,
      visualAidRate,
      guidance,
      ibContext,
      conceptContext
    );

    const shapeExamples = types.map((t) => jsonShapeExample(t, visualAidRate > 0)).join(',\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Scales with how many questions were asked for -- some of the
        // 18 question models (case_study, step_by_step, scenario...)
        // produce long correctAnswer/explanation text, and a fixed
        // budget truncated the JSON mid-array for larger batches.
        max_tokens: Math.min(16000, 900 * count + 1500),
        messages: [
          {
            role: 'user',
            content: `Generate UP TO ${count} questions for this concept using only the provided material -- fewer is fine and expected if the material doesn't genuinely support that many distinct, non-redundant questions. Never pad with repetitive or trivial questions just to reach ${count}; prioritize quality and coverage of distinct ideas in the material over hitting the maximum. For each question, pick whichever type from the allowed list actually fits that piece of content best -- the mix should emerge from what the material calls for, not from forcing variety for its own sake.

Output a JSON array (no markdown fences). Each element's shape depends on its "type" -- here is the shape for each allowed type:
[
${shapeExamples}
]`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const responseText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

    let questions: any[] = [];
    try {
      questions = parseAIJson(responseText);
    } catch (e) {
      // A large batch (many verbose types like case_study/step_by_step)
      // can still hit the token budget and cut off mid-array. Salvage
      // whichever leading questions are already complete rather than
      // discarding a full, expensive generation call.
      questions = salvageJsonArray(responseText);
      if (questions.length === 0) {
        console.error('Failed to parse Claude response:', responseText);
        return [];
      }
      console.warn(`Salvaged ${questions.length} questions from a truncated response`);
    }

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
      };

      storedQuestions.push(question);
    }

    return storedQuestions;
  } catch (error) {
    console.error('Error generating questions:', error);
    return [];
  }
}

/** Recover the leading complete objects from a JSON array cut off mid-stream. */
function salvageJsonArray(text: string): any[] {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let lastBrace = stripped.lastIndexOf('}');
  while (lastBrace > 0) {
    const candidate = stripped.slice(0, lastBrace + 1) + ']';
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // keep shrinking
    }
    lastBrace = stripped.lastIndexOf('}', lastBrace - 1);
  }
  return [];
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
export type GradingErrorType = 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING';

export async function gradeAnswer(
  question: GeneratedQuestion,
  studentAnswer: string,
  language: string = 'en'
): Promise<{
  correct: boolean;
  score: number; // 0-1 (0 = wrong, 1 = perfect, 0.5 = partial)
  feedback: string;
  confidence: number; // 0-1 (how confident in grading)
  errorType: GradingErrorType | null; // null when correct
}> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1536,
        messages: [
          {
            role: 'user',
            content: `Grade this answer:

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
  "errorType": "CONCEPTUAL" | "PROCEDURAL" | "CARELESS" | "INCOMPLETE" | "MISREADING" | null
}`,
          },
        ],
        system: `You are an educational grader. Evaluate student answers on their merits, not on matching exact wording:
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
Set errorType to null when correct is true.

Write the "feedback" field entirely in ${LOCALE_FULL_NAME[language] || language}.`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

    try {
      const gradeResult = parseAIJson(responseText);
      return {
        correct: gradeResult.correct,
        score: Math.max(0, Math.min(1, gradeResult.score || 0)),
        feedback: gradeResult.feedback || '',
        confidence: Math.max(0, Math.min(1, gradeResult.confidence || 0.7)),
        errorType: gradeResult.correct ? null : gradeResult.errorType || null,
      };
    } catch (e) {
      console.error('Failed to parse grading response:', responseText);
      const matched = studentAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
      return {
        correct: matched,
        score: matched ? 1 : 0,
        feedback: 'Please review the explanation above.',
        confidence: 0.5,
        errorType: matched ? null : null,
      };
    }
  } catch (error) {
    console.error('Error grading answer:', error);
    return {
      correct: false,
      score: 0,
      feedback: 'Error grading answer. Please try again.',
      confidence: 0,
      errorType: null,
    };
  }
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

${closingNote}`;
}

/**
 * Generate a short list of non-revealing hints for one quiz question.
 * Deliberately excludes matchingPairs/orderingItems/classificationItems
 * from the prompt (those fields encode the correct structure directly)
 * -- only the question text and, for choice questions, the option
 * texts (which don't by themselves reveal which one is correct) are
 * passed in.
 */
export async function generateQuestionHint(
  question: GeneratedQuestion,
  language: string = 'en'
): Promise<string[]> {
  const languageName = LOCALE_FULL_NAME[language] || language;

  const optionsBlock =
    question.options && question.options.length > 0
      ? `\n\nAnswer options shown to the student:\n${question.options.map((o) => `- ${o.text}`).join('\n')}`
      : '';

  const systemPrompt = `You are a supportive tutor giving a HINT for a quiz question the student is actively trying to answer themselves.

CRITICAL RULES -- never break these:
- NEVER state or imply the correct answer, even partially.
- NEVER give a step-by-step procedure, formula application, or worked solution.
- NEVER do any part of the reasoning or calculation for them.
- NEVER say which option (if any) is correct or can be eliminated.

Instead, give 2-3 short hints that redirect their THINKING -- e.g. what concept, definition, or relationship is relevant here, what detail in the question to pay closer attention to, or a question they should ask themselves before answering. Each hint must be one short sentence.

Write the hints in ${languageName}.

Output ONLY a JSON array of strings, no markdown, no explanation. Example shape: ["hint one", "hint two"]`;

  const userPrompt = `Question: "${question.question}"${optionsBlock}

Give 2-3 hints following the rules above.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const text = data.content.find((b: any) => b.type === 'text')?.text ?? '[]';
    const parsed = parseAIJson(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => typeof s === 'string').slice(0, 3);
  } catch (error) {
    console.error('Error generating question hint:', error);
    throw error;
  }
}
