/**
 * STUDENT_JOURNEY_V2 -- the ONE switch of the Student Exam Journey V2.
 *
 * Same activation model as the other environment gates of StudyUs
 * (`CANONICAL_ENGINE_V1_ENABLED`, `QUESTION_BANK_READINESS_MODE`): an explicit,
 * human-set value, read server-side, with no implicit default anywhere.
 *
 *   STUDENT_JOURNEY_V2 = 'SHADOW'  -> the resolver computes and logs the journey;
 *                                     nothing the Student sees changes.
 *   anything else / unset          -> OFF: the resolver is never called.
 *
 * There is deliberately no value that lets the journey govern the UX yet: that
 * needs its own phase (J4) and its own approval.
 */
export type StudentJourneyV2Mode = 'OFF' | 'SHADOW';

export function studentJourneyV2Mode(env: Record<string, string | undefined> = process.env): StudentJourneyV2Mode {
  return env.STUDENT_JOURNEY_V2 === 'SHADOW' ? 'SHADOW' : 'OFF';
}

export function isStudentJourneyShadowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return studentJourneyV2Mode(env) === 'SHADOW';
}
