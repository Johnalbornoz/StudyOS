/**
 * B5-R -- the launch INTENT a link carries to the assessment setup, and back out of its form.
 * Scope, intent and depth only: never a question, a count or a Student.
 */
import { parseLaunchRequest, type AssessmentLaunchRequest } from '@/lib/assessment-experience/launch';

/** `s`: the Subject a Student's own partial exam was created from. `m`: a time limit in minutes the Student stated. `sch`: a scheduled partial exam being started. */
export type LaunchQuery = { intent?: string; origin?: string; c?: string; lc?: string; depth?: string; confirm?: string; s?: string; m?: string; sch?: string };

const minutesOf = (raw: string | undefined): number | null => (raw && /^[0-9]{1,3}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 240 ? Number(raw) : null);

const list = (raw: string | undefined) => (raw ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function launchRequestOfQuery(query: LaunchQuery): Extract<AssessmentLaunchRequest, { family: 'LEARNING' }> | null {
  const parsed = parseLaunchRequest({
    family: 'LEARNING',
    origin: query.origin ?? 'TODAY',
    intent: query.intent ?? 'CUSTOM_CONCEPT_PRACTICE',
    depth: query.depth ?? 'BALANCED',
    scope: { canonicalConceptIds: list(query.c), learnerConceptIds: list(query.lc) },
    availableMinutes: minutesOf(query.m),
  });
  return parsed.ok && parsed.request.family === 'LEARNING' ? parsed.request : null;
}

/** The same intent as hidden form fields (the setup form adds the chosen depth). */
export const hiddenFieldsOf = (request: Extract<AssessmentLaunchRequest, { family: 'LEARNING' }>, extra: { subjectId?: string | null; scheduledAssessmentId?: string | null } = {}): Record<string, string> => ({
  intent: request.intent,
  origin: request.origin,
  ...(request.scope.canonicalConceptIds.length > 0 ? { c: request.scope.canonicalConceptIds.join(',') } : {}),
  ...(request.scope.learnerConceptIds.length > 0 ? { lc: request.scope.learnerConceptIds.join(',') } : {}),
  ...(request.availableMinutes ? { m: String(request.availableMinutes) } : {}),
  ...(extra.subjectId ? { s: extra.subjectId } : {}),
  ...(extra.scheduledAssessmentId ? { sch: extra.scheduledAssessmentId } : {}),
  confirm: '1',
});
