/**
 * Student Exam Journey V2 -- SHADOW runner (server).
 *
 * With STUDENT_JOURNEY_V2=SHADOW it loads the facts, resolves every exam target
 * of the Student and emits one `[journey-shadow]` record per target. It never
 * changes what the Student sees, never writes to the database, and never
 * throws: a failure is logged (without the Student id) and swallowed, so the
 * page that scheduled it is unaffected. With the flag OFF it does nothing.
 */
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { isStudentJourneyShadowEnabled } from './feature-flag';
import { loadStudentExamJourneyFacts } from './facts.server';
import { resolveStudentExamJourney } from './resolver';
import { buildInstitutionContextShadowRecord, buildJourneyShadowRecord, emitInstitutionContextShadowRecord, emitJourneyShadowRecord } from './shadow-record';
import type { StudentExamJourneyResolution } from './types';

export async function resolveStudentExamJourneys(studentId: string, asOf: string): Promise<StudentExamJourneyResolution[]> {
  return (await resolveWithContext(studentId, asOf)).resolutions;
}

async function resolveWithContext(studentId: string, asOf: string) {
  const bundles = await loadStudentExamJourneyFacts(studentId, asOf);
  return { resolutions: bundles.map((facts) => resolveStudentExamJourney(facts)), context: bundles[0]?.learner.institution.context ?? null };
}

export async function runStudentExamJourneyShadow(
  studentId: string,
  route: string,
  opts: { asOf?: string; env?: Record<string, string | undefined>; log?: (line: string) => void } = {}
): Promise<StudentExamJourneyResolution[] | null> {
  if (!isStudentJourneyShadowEnabled(opts.env)) return null;
  try {
    const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
    const { resolutions, context } = await resolveWithContext(studentId, asOf);
    for (const resolution of resolutions) emitJourneyShadowRecord(buildJourneyShadowRecord(resolution, route), opts.log);
    // J1.2: one institutional-context line per Student (only when the context was loaded).
    if (context) emitInstitutionContextShadowRecord(buildInstitutionContextShadowRecord(context, route, asOf), opts.log);
    return resolutions;
  } catch (error) {
    logOperationalWarning({ subsystem: 'student-exam-journey', operation: 'shadow-resolve', error, context: { route } });
    return null;
  }
}
