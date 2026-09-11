/**
 * LX-4P-PERF-R1C C4 -- strict JSON Schemas for OpenAI Structured Outputs.
 *
 * Derived from the CURRENT runtime contracts:
 *   - GeneratedQuestion            (services/quiz-generation.service.ts)
 *   - GuidedPractice               (services/teaching-content.service.ts)
 *   - AiLocalized                  (services/question-localization.service.ts)
 *   - SemanticVerdict              (services/question-localization.service.ts)
 *   - QuestionQualityVerdict       (services/question-quality-verifier.service.ts)
 *
 * OpenAI strict mode requires: every property listed in `required`,
 * `additionalProperties: false`, and optionals expressed as
 * `type: ["T","null"]`. Domain parsers still run afterwards -- the schema
 * is a structural pre-filter, not a replacement for validation.
 */
import type { OpenAIJsonSchema } from './adapters/openai';

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const num = { type: 'number' } as const;
const nullableNum = { type: ['number', 'null'] } as const;
const bool = { type: 'boolean' } as const;

const QUESTION_TYPES = [
  'multiple_choice', 'multi_select', 'true_false', 'yes_no', 'short_answer',
  'open_ended', 'fill_blank', 'matching', 'ordering', 'classification',
  'numeric_problem', 'step_by_step', 'case_study', 'scenario',
  'error_detection', 'justification', 'comparison', 'prediction',
];

/** One generated question. Core fields required; every optional is nullable. */
const generatedQuestion = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: QUESTION_TYPES },
    question: str,
    correctAnswer: str,
    explanation: str,
    // LX-4P-PERF-R1F R7: no `minimum`/`maximum` -- numeric range keywords
    // are not part of OpenAI's confirmed-supported strict-mode subset
    // (type/properties/required/additionalProperties/items/enum/anyOf/
    // $ref only). The 1-5 range is still enforced downstream by the
    // deterministic Question Quality Contract.
    difficulty: { type: 'integer' },
    options: {
      type: ['array', 'null'],
      items: { type: 'object', additionalProperties: false, properties: { id: str, text: str }, required: ['id', 'text'] },
    },
    matchingPairs: {
      type: ['array', 'null'],
      items: { type: 'object', additionalProperties: false, properties: { left: str, right: str }, required: ['left', 'right'] },
    },
    orderingItems: { type: ['array', 'null'], items: str },
    classificationCategories: { type: ['array', 'null'], items: str },
    classificationItems: {
      type: ['array', 'null'],
      items: { type: 'object', additionalProperties: false, properties: { item: str, category: str }, required: ['item', 'category'] },
    },
    blankTemplate: nullableStr,
    cognitiveLevel: { type: ['string', 'null'], enum: ['RECALL', 'COMPREHENSION', 'APPLICATION', 'ANALYSIS', 'SYNTHESIS', 'EVALUATION', null] },
    questionIntent: { type: ['string', 'null'], enum: ['CHECK_UNDERSTANDING', 'CHECK_APPLICATION', 'CHECK_TRANSFER', 'DIAGNOSTIC_PROBE', null] },
    expectedReasoningType: { type: ['string', 'null'], enum: ['FACTUAL', 'PROCEDURAL', 'CONCEPTUAL', 'METACOGNITIVE', null] },
    calculatorAllowed: { type: ['boolean', 'null'] },
    sourceReference: nullableStr,
    visualAid: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['diagram', 'chart'] },
        svg: nullableStr,
        caption: nullableStr,
        chartData: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            chartType: { type: 'string', enum: ['line', 'bar'] },
            labels: { type: 'array', items: str },
            values: { type: 'array', items: num },
            xLabel: nullableStr,
            yLabel: nullableStr,
          },
          required: ['chartType', 'labels', 'values', 'xLabel', 'yLabel'],
        },
      },
      required: ['kind', 'svg', 'caption', 'chartData'],
    },
  },
  required: [
    'type', 'question', 'correctAnswer', 'explanation', 'difficulty',
    'options', 'matchingPairs', 'orderingItems', 'classificationCategories', 'classificationItems',
    'blankTemplate', 'cognitiveLevel', 'questionIntent', 'expectedReasoningType',
    'calculatorAllowed', 'sourceReference', 'visualAid',
  ],
} as const;

export const GENERATED_QUESTION_BATCH_SCHEMA: OpenAIJsonSchema = {
  name: 'generated_question_batch',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { questions: { type: 'array', items: generatedQuestion } },
    required: ['questions'],
  },
};

export const GUIDED_PRACTICE_SCHEMA: OpenAIJsonSchema = {
  name: 'guided_practice',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      problem: str,
      steps: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { prompt: str, expectedAnswer: str, why: str }, required: ['prompt', 'expectedAnswer', 'why'] },
      },
      closing: str,
    },
    required: ['problem', 'steps', 'closing'],
  },
};

export const LOCALIZATION_PAYLOAD_SCHEMA: OpenAIJsonSchema = {
  name: 'question_localization',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      question: str,
      options: {
        type: ['array', 'null'],
        items: { type: 'object', additionalProperties: false, properties: { id: str, text: str }, required: ['id', 'text'] },
      },
      explanation: nullableStr,
      caption: nullableStr,
    },
    required: ['question', 'options', 'explanation', 'caption'],
  },
};

export const SEMANTIC_VERDICT_SCHEMA: OpenAIJsonSchema = {
  name: 'semantic_equivalence_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      equivalent: bool,
      correctAnswerStillValid: bool,
      semanticDifferences: { type: 'array', items: str },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['equivalent', 'correctAnswerStillValid', 'semanticDifferences', 'confidence'],
  },
};

export const QUESTION_QUALITY_VERDICT_SCHEMA: OpenAIJsonSchema = {
  name: 'question_quality_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      conceptAligned: bool,
      answerCorrect: bool,
      unambiguous: bool,
      reasoningConsistent: bool,
      distractorsPlausible: bool,
      scenarioAppropriate: bool,
      visualConsistent: bool,
      issues: { type: 'array', items: str },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
      'conceptAligned', 'answerCorrect', 'unambiguous', 'reasoningConsistent',
      'distractorsPlausible', 'scenarioAppropriate', 'visualConsistent', 'issues', 'confidence',
    ],
  },
};
