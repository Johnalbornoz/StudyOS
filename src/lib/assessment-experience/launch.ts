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
import { REQUESTED_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/requested-difficulty';

export const LAUNCH_ORIGINS = ['TODAY', 'LEARNING_PATH', 'PROGRESS', 'EXAM_PREPARATION', 'RESULT_CONTINUATION', 'SUBJECT'] as const;
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
      /** The Student's own Subject a partial exam (AD_HOC_CONCEPT_EXAM) was created from. The start re-checks every concept against it. */
      subjectId: ID.nullable().default(null),
      /** A scheduled partial exam being started. Its Subject, concepts, size and time are read from the schedule, never from the request. */
      scheduledAssessmentId: ID.nullable().default(null),
    }),
    /** A limit the Student states. Honoured only where durations are recorded. */
    availableMinutes: z.number().int().min(1).max(240).nullable().default(null),
    /** A difficulty the Student states for their own partial exam (AD_HOC_CONCEPT_EXAM). Honoured there only; null = not stated. */
    difficultyBand: z.enum(REQUESTED_DIFFICULTY_BANDS).nullable().default(null),
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
  // a scheduled exam names its scope by its record: the start reads the concepts from there
  if (r.family === 'LEARNING' && r.scope.canonicalConceptIds.length === 0 && r.scope.learnerConceptIds.length === 0 && !r.scope.node && !r.scope.scheduledAssessmentId) return { ok: false, issue: 'NO_SCOPE' };
  return { ok: true, request: r };
}
