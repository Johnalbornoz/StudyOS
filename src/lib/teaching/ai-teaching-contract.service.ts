/**
 * F8 -- AI teaching-generation contract (task §22-24). See
 * F8_AI_TEACHING_CONTRACT.md for the full design and the two
 * considered-and-declined-reuse notes (adaptive-teaching-generation.ts,
 * teaching-content.service.ts).
 *
 * Reuses the SAME executeAI/callModel/AIExecutionError machinery, the
 * SAME two-pass Quality-Gate shape (deterministic contract check, then
 * an independent stronger-model semantic verifier), and imports
 * QuestionType/ExpectedReasoningType from quiz-generation.service.ts
 * rather than redeclaring them. No fallback ever invents teaching
 * content -- a failure is always a visible, structured `blocked`
 * result, never guessed/malformed content silently served (task §23/24).
 */
import { db } from '@/lib/db';
import { executeAI, getPrompt, AIExecutionFailure, isAIExecutionError } from '@/lib/ai';
import type { AIErrorCode } from '@/lib/ai';
import { callModel, type CallModelResult } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { budgetFor } from '@/lib/ai/token-budgets';
import { parseAIJson } from '@/lib/ai-json';
import type { OpenAIJsonSchema } from '@/lib/ai/adapters/openai';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import { resolveFrameworkForObjective, resolveFrameworkForStudentExamProfile } from './framework-context.service';
import { resolveCommandTermInterpretation } from './command-term-teaching.service';
import type { DiagnosisResultType } from '@/lib/diagnostics/types';
import type { FrameworkIdentity, InterventionType } from './types';

export interface TeachingContentGenerationContext {
  studentId: string;
  conceptId: string;
  canonicalConceptIds: string[];
  skillIds: string[];
  diagnosis: { primaryGapType: DiagnosisResultType; reasonCodes: string[]; confidence: number };
  interventionType: InterventionType;
  framework: FrameworkIdentity | null;
  commandTerm: { id: string; term: string; expectedStructure: string | null; rubricNotes: string | null } | null;
  questionType: string | null;
  reasoningRequirement: string | null;
  difficulty: number;
  proceduresRequired: boolean;
  language: string;
  assistanceLevel: string;
}

export async function resolveTeachingContentGenerationContext(params: {
  studentId: string;
  conceptId: string;
  diagnosisId: string;
  interventionType: InterventionType;
  difficulty?: number;
  assistanceLevel: string;
}): Promise<TeachingContentGenerationContext> {
  const diagnosis = await getDiagnosisById(params.diagnosisId);
  if (!diagnosis) throw new Error(`diagnosis ${params.diagnosisId} not found`);
  const scope = diagnosis.scope;

  const bridge = scope.learningObjectiveId ? await resolveActivityMetadataForObjective(scope.learningObjectiveId) : null;
  const canonicalConceptIds = bridge?.canonicalConceptIds ?? [];
  const skillIds = bridge?.skillIds ?? [];

  const framework = scope.learningObjectiveId
    ? await resolveFrameworkForObjective(scope.learningObjectiveId)
    : await resolveFrameworkForStudentExamProfile(params.studentId);

  let commandTerm: TeachingContentGenerationContext['commandTerm'] = null;
  let reasoningRequirement: string | null = null;
  if (scope.commandTermId) {
    const termRow = await db.query(`SELECT id, term, expected_reasoning_type FROM command_terms WHERE id = $1`, [scope.commandTermId]);
    if (termRow.rows.length > 0) {
      const interpretation = await resolveCommandTermInterpretation(scope.commandTermId, framework?.academicProgrammeId ?? null);
      commandTerm = {
        id: termRow.rows[0].id,
        term: termRow.rows[0].term,
        expectedStructure: interpretation?.expectedStructure ?? null,
        rubricNotes: interpretation?.rubricNotes ?? null,
      };
      reasoningRequirement = termRow.rows[0].expected_reasoning_type ?? null;
    }
  }

  let proceduresRequired = false;
  if (scope.assessmentComponentId) {
    const componentRow = await db.query(`SELECT procedure_required FROM assessment_components WHERE id = $1`, [scope.assessmentComponentId]);
    proceduresRequired = componentRow.rows.length > 0 ? componentRow.rows[0].procedure_required === true : false;
  }

  const studentRow = await db.query(`SELECT language FROM students WHERE id = $1`, [params.studentId]);
  const language = studentRow.rows.length > 0 ? studentRow.rows[0].language ?? 'en' : 'en';

  return {
    studentId: params.studentId,
    conceptId: params.conceptId,
    canonicalConceptIds,
    skillIds,
    diagnosis: { primaryGapType: diagnosis.primaryGapType, reasonCodes: diagnosis.reasonCodes, confidence: diagnosis.confidence },
    interventionType: params.interventionType,
    framework,
    commandTerm,
    questionType: null,
    reasoningRequirement,
    difficulty: params.difficulty ?? 3,
    proceduresRequired,
    language,
    assistanceLevel: params.assistanceLevel,
  };
}

export interface TeachingContentPayload {
  canonicalConceptId: string;
  framework: { academicOrganizationId: string; academicProgrammeId: string } | null;
  interventionType: InterventionType;
  commandTermId: string | null;
  language: string;
  knowledge: { explanation: string; keyIdeas: string[] };
  strategy: { guidance: string; workedExample: { steps: string[]; finalAnswer: string } | null; commonFailurePatterns: string[] } | null;
  practiceItems: Array<{ prompt: string; expectedAnswer: string; difficulty: number }>;
}

const TEACHING_CONTENT_SCHEMA: OpenAIJsonSchema = {
  name: 'f8_teaching_content',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      canonicalConceptId: { type: 'string' },
      framework: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: { academicOrganizationId: { type: 'string' }, academicProgrammeId: { type: 'string' } },
        required: ['academicOrganizationId', 'academicProgrammeId'],
      },
      interventionType: { type: 'string', enum: ['EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE', 'CONTEXTUAL_HELP', 'INDEPENDENT_PRACTICE', 'PROVE'] },
      commandTermId: { type: ['string', 'null'] },
      language: { type: 'string' },
      knowledge: {
        type: 'object',
        additionalProperties: false,
        properties: { explanation: { type: 'string' }, keyIdeas: { type: 'array', items: { type: 'string' } } },
        required: ['explanation', 'keyIdeas'],
      },
      strategy: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          guidance: { type: 'string' },
          workedExample: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: { steps: { type: 'array', items: { type: 'string' } }, finalAnswer: { type: 'string' } },
            required: ['steps', 'finalAnswer'],
          },
          commonFailurePatterns: { type: 'array', items: { type: 'string' } },
        },
        required: ['guidance', 'workedExample', 'commonFailurePatterns'],
      },
      practiceItems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { prompt: { type: 'string' }, expectedAnswer: { type: 'string' }, difficulty: { type: 'number' } },
          required: ['prompt', 'expectedAnswer', 'difficulty'],
        },
      },
    },
    required: ['canonicalConceptId', 'framework', 'interventionType', 'commandTermId', 'language', 'knowledge', 'strategy', 'practiceItems'],
  },
};

export type TeachingContentFailureCode =
  | 'SCHEMA_INVALID'
  | 'CONCEPT_MISMATCH'
  | 'FRAMEWORK_MISMATCH'
  | 'INTERVENTION_TYPE_MISMATCH'
  | 'COMMAND_TERM_MISMATCH'
  | 'LANGUAGE_MISMATCH'
  | 'DIFFICULTY_OUT_OF_RANGE'
  | 'MISSING_REQUIRED_PROCEDURE'
  | 'EMPTY_CONTENT'
  | 'STRATEGY_SECTION_MISSING_FOR_FRAMEWORK'
  | 'STRATEGY_SECTION_PRESENT_WITHOUT_FRAMEWORK';

export function checkTeachingContentDeterministic(
  payload: unknown,
  context: TeachingContentGenerationContext
): { status: 'PASS' | 'FAIL'; failures: TeachingContentFailureCode[] } {
  const failures: TeachingContentFailureCode[] = [];
  const p = payload as Partial<TeachingContentPayload> | null | undefined;

  if (
    !p ||
    typeof p !== 'object' ||
    typeof p.canonicalConceptId !== 'string' ||
    typeof p.interventionType !== 'string' ||
    typeof p.language !== 'string' ||
    !p.knowledge ||
    typeof p.knowledge.explanation !== 'string' ||
    !Array.isArray(p.knowledge.keyIdeas) ||
    !Array.isArray(p.practiceItems)
  ) {
    return { status: 'FAIL', failures: ['SCHEMA_INVALID'] };
  }

  if (context.canonicalConceptIds.length > 0 && !context.canonicalConceptIds.includes(p.canonicalConceptId)) {
    failures.push('CONCEPT_MISMATCH');
  }

  const payloadFramework = p.framework ?? null;
  const contextFramework = context.framework;
  const frameworksMatch =
    (payloadFramework === null && contextFramework === null) ||
    (payloadFramework !== null &&
      contextFramework !== null &&
      payloadFramework.academicOrganizationId === contextFramework.academicOrganizationId &&
      payloadFramework.academicProgrammeId === contextFramework.academicProgrammeId);
  if (!frameworksMatch) failures.push('FRAMEWORK_MISMATCH');

  if (p.interventionType !== context.interventionType) failures.push('INTERVENTION_TYPE_MISMATCH');

  const expectedCommandTermId = context.commandTerm?.id ?? null;
  if ((p.commandTermId ?? null) !== expectedCommandTermId) failures.push('COMMAND_TERM_MISMATCH');

  if (p.language !== context.language) failures.push('LANGUAGE_MISMATCH');

  const difficultyTolerance = 1;
  for (const item of p.practiceItems) {
    if (Math.abs(item.difficulty - context.difficulty) > difficultyTolerance) {
      failures.push('DIFFICULTY_OUT_OF_RANGE');
      break;
    }
  }

  if (context.proceduresRequired) {
    const hasSteps = !!p.strategy?.workedExample?.steps && p.strategy.workedExample.steps.length > 0;
    if (!hasSteps) failures.push('MISSING_REQUIRED_PROCEDURE');
  }

  const strategyPresent = p.strategy !== null && p.strategy !== undefined;
  if (contextFramework === null && strategyPresent) failures.push('STRATEGY_SECTION_PRESENT_WITHOUT_FRAMEWORK');
  if (contextFramework !== null && !strategyPresent) failures.push('STRATEGY_SECTION_MISSING_FOR_FRAMEWORK');

  if (!p.knowledge.explanation.trim() || p.knowledge.keyIdeas.length === 0) failures.push('EMPTY_CONTENT');

  return failures.length === 0 ? { status: 'PASS', failures: [] } : { status: 'FAIL', failures };
}

interface SemanticVerdict {
  knowledgeIsFrameworkNeutral: boolean;
  strategyAddsFramingOnly: boolean;
  factuallyConsistent: boolean;
  issues: string[];
  confidence: number;
}

const SEMANTIC_VERDICT_SCHEMA: OpenAIJsonSchema = {
  name: 'f8_teaching_content_semantic_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      knowledgeIsFrameworkNeutral: { type: 'boolean' },
      strategyAddsFramingOnly: { type: 'boolean' },
      factuallyConsistent: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['knowledgeIsFrameworkNeutral', 'strategyAddsFramingOnly', 'factuallyConsistent', 'issues', 'confidence'],
  },
};

const SEMANTIC_MIN_CONFIDENCE = 0.7;

export type TeachingGenerationBlockedReason = AIErrorCode | TeachingContentFailureCode | 'SEMANTIC_VERIFY_FAILED' | 'SEMANTIC_VERIFY_ERROR';

export interface TeachingGenerationOutcome {
  blocked: boolean;
  payload?: TeachingContentPayload;
  reason?: TeachingGenerationBlockedReason;
  failures?: TeachingContentFailureCode[];
}

function buildGenerationPrompt(context: TeachingContentGenerationContext): { system: string; user: string } {
  const system = [
    'You produce framework-aware teaching content for one diagnosed learning gap.',
    'Return ONLY the requested JSON shape. Never invent a canonicalConceptId, framework, commandTermId, or language other than the ones given to you.',
    'The "knowledge" section must be framework-neutral -- it must never mention exam-specific mechanics, command terms, or rubric structure.',
    context.framework
      ? 'The "strategy" section is REQUIRED and must be framework-specific: how to demonstrate this knowledge under the given framework/command term, never a restatement of the knowledge section.'
      : 'No framework is active for this learner -- the "strategy" field MUST be null.',
    context.proceduresRequired ? 'A worked example with explicit intermediate steps is REQUIRED (procedure_required is true for this component).' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const user = JSON.stringify({
    canonicalConceptIds: context.canonicalConceptIds,
    diagnosis: context.diagnosis,
    interventionType: context.interventionType,
    framework: context.framework
      ? { academicOrganizationId: context.framework.academicOrganizationId, academicProgrammeId: context.framework.academicProgrammeId }
      : null,
    commandTerm: context.commandTerm,
    reasoningRequirement: context.reasoningRequirement,
    difficulty: context.difficulty,
    proceduresRequired: context.proceduresRequired,
    language: context.language,
  });

  return { system, user };
}

export async function generateTeachingContent(context: TeachingContentGenerationContext): Promise<TeachingGenerationOutcome> {
  const prompt = getPrompt('f8.teaching_content_generation');
  const route = resolveModels(prompt.capability);
  const budget = budgetFor('concept_explanation');
  const { system, user } = buildGenerationPrompt(context);

  let payload: TeachingContentPayload;
  try {
    const { result } = await executeAI<CallModelResult, TeachingContentPayload>({
      capability: prompt.capability,
      risk: 'MEDIUM_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { studentId: context.studentId, conceptId: context.conceptId, sourceComponent: 'ai-teaching-contract.service.ts:generateTeachingContent' },
      call: (signal) =>
        callModel(
          { provider: route.provider, model: route.primary, system, user, maxTokens: budget.maxOutputTokens, jsonSchema: TEACHING_CONTENT_SCHEMA, reasoningEffort: budget.reasoningEffort },
          signal
        ),
      validate: (raw) => {
        try {
          const parsed = parseAIJson<TeachingContentPayload>(raw.text || '{}');
          const check = checkTeachingContentDeterministic(parsed, context);
          if (check.status === 'FAIL') return { valid: false, errors: check.failures };
          return { valid: true, value: parsed };
        } catch {
          return { valid: false, errors: ['parse error'] };
        }
      },
      // No fallback: an invalid/malformed generation is a visible failure, never invented content (task §24).
    });
    payload = result;
  } catch (err) {
    if (err instanceof AIExecutionFailure || isAIExecutionError(err)) {
      const check = checkTeachingContentDeterministic(null, context);
      // A validation failure surfaces via AIExecutionFailure with code VALIDATION_ERROR; recover the specific failures for the caller.
      return { blocked: true, reason: (err.code as AIErrorCode) ?? 'INVALID_RESPONSE', failures: check.status === 'FAIL' ? check.failures : undefined };
    }
    throw err;
  }

  const semantic = await verifyTeachingContentSemantic(payload, context);
  if (!semantic.pass) {
    return { blocked: true, reason: semantic.reason };
  }

  return { blocked: false, payload };
}

async function verifyTeachingContentSemantic(
  payload: TeachingContentPayload,
  context: TeachingContentGenerationContext
): Promise<{ pass: boolean; reason?: TeachingGenerationBlockedReason }> {
  const prompt = getPrompt('f8.teaching_content_semantic_verify');
  const route = resolveModels(prompt.capability);
  const budget = budgetFor('semantic_verification');

  const system =
    'Independently verify teaching content. Judge only: does the "knowledge" section avoid framework-specific mechanics; does the "strategy" section (if present) add framing rather than restate the knowledge section; is the content factually consistent with the stated canonical concept. Never rewrite the content.';
  const user = JSON.stringify({ payload, canonicalConceptIds: context.canonicalConceptIds });

  try {
    const { result } = await executeAI<CallModelResult, SemanticVerdict>({
      capability: prompt.capability,
      risk: 'MEDIUM_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { studentId: context.studentId, conceptId: context.conceptId, sourceComponent: 'ai-teaching-contract.service.ts:verifyTeachingContentSemantic' },
      call: (signal) =>
        callModel(
          { provider: route.provider, model: route.primary, system, user, maxTokens: budget.maxOutputTokens, jsonSchema: SEMANTIC_VERDICT_SCHEMA, reasoningEffort: budget.reasoningEffort },
          signal
        ),
      validate: (raw) => {
        try {
          const parsed = parseAIJson<SemanticVerdict>(raw.text || '{}');
          if (
            typeof parsed?.knowledgeIsFrameworkNeutral !== 'boolean' ||
            typeof parsed?.strategyAddsFramingOnly !== 'boolean' ||
            typeof parsed?.factuallyConsistent !== 'boolean' ||
            typeof parsed?.confidence !== 'number'
          ) {
            return { valid: false, errors: ['bad verdict shape'] };
          }
          return { valid: true, value: parsed };
        } catch {
          return { valid: false, errors: ['parse error'] };
        }
      },
    });

    const failed = !result.knowledgeIsFrameworkNeutral || !result.strategyAddsFramingOnly || !result.factuallyConsistent;
    if (failed) return { pass: false, reason: 'SEMANTIC_VERIFY_FAILED' };
    if (result.confidence < SEMANTIC_MIN_CONFIDENCE) return { pass: false, reason: 'SEMANTIC_VERIFY_FAILED' };
    return { pass: true };
  } catch {
    // Fail closed: a malformed or failed verdict is never treated as approved (mirrors the Quality Gate's VERIFY_ERROR discipline).
    return { pass: false, reason: 'SEMANTIC_VERIFY_ERROR' };
  }
}
