/**
 * B4 -- AssessmentLaunchRequest: what a Student asks for when they start an assessment (pure contract).
 *
 * It states INTENT. It can carry no question, no count, no threshold and no priority: which questions,
 * how many, and whether it may start at all are decided by the Blueprint Core and its eligibility rules.
 * The schema is strict, so a surface cannot smuggle any of those in.
 *
 * One request shape for every surface (Today, the learning path, Progress, Exam Preparation): the surface
 * of origin is recorded so the experience can return there, never to change what is assessed.
 */
import { z } from 'zod';
import { LEARNING_INTENTS } from '@/lib/assessment-blueprint/policy/learning';
import { PRACTICE_DEPTHS } from '@/lib/assessment-blueprint/policy/practice-depth';

export const LAUNCH_ORIGINS = ['TODAY', 'LEARNING_PATH', 'PROGRESS', 'EXAM_PREPARATION', 'RESULT_CONTINUATION'] as const;
export type LaunchOrigin = (typeof LAUNCH_ORIGINS)[number];

export const PREPARATION_OBJECTIVES = ['CLOSE_GAPS', 'SECTION_PRACTICE', 'TIMED_PREPARATION', 'COVERAGE'] as const;

/** The mock a Student may ask for. The stored attempt type is still decided by B1 from the form's verified fidelity. */
export const OFFICIAL_REQUESTS = ['FULL_MOCK', 'REDUCED_MOCK'] as const;

const ID = z.string().min(1).max(200);

const Base = { origin: z.enum(LAUNCH_ORIGINS), returnTo: z.string().max(300).startsWith('/').optional() };

export const AssessmentLaunchRequestSchema = z.discriminatedUnion('family', [
  z.strictObject({
    ...Base,
    family: z.literal('LEARNING'),
    intent: z.enum(LEARNING_INTENTS),
    depth: z.enum(PRACTICE_DEPTHS),
    /** What to practise: canonical concepts, and / or one curriculum node (a topic, a unit ... of any framework). */
    scope: z.strictObject({
      canonicalConceptIds: z.array(ID).max(60).default([]),
      learnerConceptIds: z.array(ID).max(60).default([]),
      node: z.strictObject({ structureVersionId: ID, nodeId: ID }).nullable().default(null),
    }),
    /** A limit the Student states. Honoured only where durations are recorded. */
    availableMinutes: z.number().int().min(1).max(240).nullable().default(null),
  }),
  z.strictObject({
    ...Base,
    family: z.literal('EXAM_PREPARATION'),
    examTargetId: ID,
    objective: z.enum(PREPARATION_OBJECTIVES),
    assessmentComponentIds: z.array(ID).max(20).default([]),
    availableMinutes: z.number().int().min(1).max(240).nullable().default(null),
  }),
  z.strictObject({
    ...Base,
    family: z.literal('OFFICIAL_EXAM'),
    examTargetId: ID,
    request: z.enum(OFFICIAL_REQUESTS),
  }),
]);

export type AssessmentLaunchRequest = z.infer<typeof AssessmentLaunchRequestSchema>;

export type LaunchRequestIssue = 'MALFORMED' | 'NO_SCOPE';

/** Parses a request from a surface. A request with nothing to practise is refused here, before any engine is asked. */
export function parseLaunchRequest(raw: unknown): { ok: true; request: AssessmentLaunchRequest } | { ok: false; issue: LaunchRequestIssue } {
  const parsed = AssessmentLaunchRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issue: 'MALFORMED' };
  const r = parsed.data;
  if (r.family === 'LEARNING' && r.scope.canonicalConceptIds.length === 0 && r.scope.learnerConceptIds.length === 0 && !r.scope.node) return { ok: false, issue: 'NO_SCOPE' };
  return { ok: true, request: r };
}

/**
 * Which execution path a launch takes. Today there is one: the existing runtime. The frozen-snapshot path
 * (Blueprint Core -> B3) is prepared and stays OFF until it is adopted as a separate, certified step;
 * there is deliberately no flag read here, so nothing can switch it on by configuration alone.
 */
export const CANONICAL_EXECUTION_ENABLED = false as const;
export type ExecutionPath = 'EXISTING_RUNTIME' | 'FROZEN_SNAPSHOT';
export const executionPathFor = (_request: AssessmentLaunchRequest): ExecutionPath => (CANONICAL_EXECUTION_ENABLED ? 'FROZEN_SNAPSHOT' : 'EXISTING_RUNTIME');
