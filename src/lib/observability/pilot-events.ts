/**
 * F15 -- minimal Pilot event/telemetry model (task's own explicit
 * event list). Mirrors `src/lib/ai/logging.ts`'s existing style exactly
 * (`console.log('[tag]', JSON.stringify({...}))`, one line per event,
 * safe-fields-only) rather than introducing a second logging
 * convention or a heavyweight analytics stack -- this codebase already
 * has a real, working pattern; this file extends it to non-AI pilot
 * flows.
 *
 * NEVER logs: passwords, tokens/secrets, full prompts, raw question/
 * answer content, student PII beyond an already-pseudonymous id the
 * rest of this codebase already treats as safe to log (studentId --
 * the same UUID every other structured log line in this codebase
 * already carries, e.g. learner-twin's own `[today]`/`[perf]` lines).
 */
export type PilotEventName =
  | 'exam_prep_opened'
  | 'exam_readiness_viewed'
  | 'exam_started'
  | 'exam_resumed'
  | 'question_answered'
  | 'exam_submitted'
  | 'exam_completed'
  | 'assignment_created'
  | 'assignment_opened'
  | 'assignment_completed'
  | 'workspace_switched'
  | 'authorization_denied'
  | 'ai_generation_failed'
  | 'rate_limited';

export interface PilotEventFields {
  correlationId?: string;
  actorUserId?: string;
  studentId?: string;
  route?: string;
  workspace?: string;
  status?: number;
  durationMs?: number;
  domainErrorCode?: string;
  [key: string]: string | number | boolean | undefined;
}

export function logPilotEvent(event: PilotEventName, fields: PilotEventFields = {}): void {
  const line = { at: 'pilot_event', event, ts: new Date().toISOString(), ...fields };
  console.log('[pilot]', JSON.stringify(line));
}

/** A short, request-scoped correlation id -- never a session token, never persisted beyond the log line itself. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}
