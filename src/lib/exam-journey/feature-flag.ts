/**
 * STUDENT_JOURNEY_V2 -- the ONE switch of the Student Exam Journey V2.
 *
 * Same activation model as the other environment gates of StudyUs
 * (`CANONICAL_ENGINE_V1_ENABLED`, `QUESTION_BANK_READINESS_MODE`): an explicit,
 * human-set value, read server-side, with no implicit default anywhere.
 *
 *   STUDENT_JOURNEY_V2 = 'SHADOW'  -> the resolver computes and logs the journey;
 *                                     nothing the Student sees changes.
 *   STUDENT_JOURNEY_V2 = 'UX'      -> the approved entry UX (J1.3, J1.4, J3.3-J3.5)
 *                                     reads the journey; shadow logging continues.
 *   anything else / unset          -> OFF: the resolver is never called and every
 *                                     Student surface renders exactly as before.
 *
 * Today's Home (Today) is never governed by the journey in any mode.
 */
export type StudentJourneyV2Mode = 'OFF' | 'SHADOW' | 'UX';

export function studentJourneyV2Mode(env: Record<string, string | undefined> = process.env): StudentJourneyV2Mode {
  const v = env.STUDENT_JOURNEY_V2;
  return v === 'SHADOW' ? 'SHADOW' : v === 'UX' ? 'UX' : 'OFF';
}

/** The resolver runs and logs (SHADOW, and UX which keeps the shadow record). */
export function isStudentJourneyShadowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const mode = studentJourneyV2Mode(env);
  return mode === 'SHADOW' || mode === 'UX';
}

/** The approved entry UX consumes the journey (institutional context, exam entry, dates, exam overview, nav prominence). */
export function isStudentJourneyUxEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return studentJourneyV2Mode(env) === 'UX';
}
