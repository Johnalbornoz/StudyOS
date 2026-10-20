/**
 * Student Exam Journey -- presentation rules for the approved entry UX (pure).
 *
 * Everything the screens decide comes from the resolver output; nothing here
 * re-derives a journey fact:
 *   - which targets are in ACTIVE preparation (navigation prominence, design UX-A);
 *   - which blockers a Student sees, as copy keys (never raw enum names);
 *   - how each date source is labelled (official / Student-reported / personal / month);
 *   - which next action becomes the ONE primary CTA.
 * No readiness percentage is ever produced here (G6: the Learning OS evidence a
 * percentage would read can still be contaminated across exams).
 */
import type { JourneyPhase, NextActionKind, StudentExamJourneyResolution } from './types';
import type { TargetDateSource, TargetScheduleFacts } from './exam-target';

export const ACTIVE_PHASES: readonly JourneyPhase[] = ['ACTIVATION', 'PREPARATION', 'SIMULATION', 'PROJECTION', 'CLOSING'];

/** A target in active preparation: phase >= ACTIVATION (not a recorded result), or an attempt to resume. */
export function isActivePreparation(r: Pick<StudentExamJourneyResolution, 'examTargetId' | 'phase' | 'state' | 'recommendedNextAction'>): boolean {
  if (!r.examTargetId) return false;
  if (r.recommendedNextAction.kind === 'RESUME_ATTEMPT') return true;
  return ACTIVE_PHASES.includes(r.phase) && r.state !== 'RESULT_RECORDED';
}

/** "Exámenes" is prominent only while at least one target is in active preparation (never for a distant milestone). */
export function examPrepIsPrimary(resolutions: ReadonlyArray<Pick<StudentExamJourneyResolution, 'examTargetId' | 'phase' | 'state' | 'recommendedNextAction'>>): boolean {
  return resolutions.some(isActivePreparation);
}

/** Blockers a Student sees, as copy keys -- deduplicated, in a stable order. Technical ones stay silent. */
export type StudentBlockerKey =
  | 'jx.blocker.BLUEPRINT_INCOMPLETE'
  | 'jx.blocker.CONTENT_UNAVAILABLE'
  | 'jx.blocker.INSTITUTION_CONTEXT_INCOMPLETE'
  | 'jx.blocker.ACADEMIC_CONTEXT_CONFLICT'
  | 'jx.blocker.INSTITUTIONAL_RELEASE_REQUIRED';

const BLOCKER_COPY: Partial<Record<string, StudentBlockerKey>> = {
  BLUEPRINT_INCOMPLETE: 'jx.blocker.BLUEPRINT_INCOMPLETE',
  BLUEPRINT_VERSION_INVALID: 'jx.blocker.BLUEPRINT_INCOMPLETE',
  CONTENT_UNAVAILABLE: 'jx.blocker.CONTENT_UNAVAILABLE',
  INSTITUTION_CONTEXT_INCOMPLETE: 'jx.blocker.INSTITUTION_CONTEXT_INCOMPLETE',
  ACADEMIC_CONTEXT_CONFLICT: 'jx.blocker.ACADEMIC_CONTEXT_CONFLICT',
  INSTITUTIONAL_RELEASE_REQUIRED: 'jx.blocker.INSTITUTIONAL_RELEASE_REQUIRED',
  // EXAM_DATE_UNKNOWN -> the date step itself; ATTEMPT_IN_PROGRESS -> the resume CTA;
  // PREDICTION_* -> the prediction section is simply absent; NO_CONCEPT_MAPPINGS and
  // TARGET_EXAM_UNCONFIRMED have no Student action today: none of them is shown as a message.
};

export function studentBlockerKeys(r: Pick<StudentExamJourneyResolution, 'blockers'>): StudentBlockerKey[] {
  const out: StudentBlockerKey[] = [];
  for (const b of r.blockers) {
    const key = BLOCKER_COPY[b.code];
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Copy key of a date by its source. Official wording is used ONLY for authoritative sources. */
export function dateLabelKey(source: TargetDateSource): string {
  return `jx.date.label.${source}`;
}

export interface ScheduleLine {
  key: string;
  /** YYYY-MM-DD or YYYY-MM (month precision is rendered as a month, never a day). */
  value: string | null;
  precision: 'DAY' | 'MONTH' | null;
}

/** The lines the date card shows, each with its own source -- never merged into one "exam date". */
export function scheduleLines(input: {
  officialSession: { sessionKey: string; source: 'INSTITUTION_ASSIGNED' | 'STUDENT_SELECTED' } | null;
  authoritativeExamDate: string | null;
  studentReportedExamDate: string | null;
  personalTargetDate: string | null;
  estimatedMonth: string | null;
}): ScheduleLine[] {
  const lines: ScheduleLine[] = [];
  if (input.officialSession) lines.push({ key: input.officialSession.source === 'INSTITUTION_ASSIGNED' ? dateLabelKey('INSTITUTION_ASSIGNED_SESSION') : dateLabelKey('STUDENT_SELECTED_OFFICIAL_SESSION'), value: null, precision: null });
  if (input.authoritativeExamDate) lines.push({ key: dateLabelKey('AUTHORITATIVE_EXAM_DATE'), value: input.authoritativeExamDate, precision: 'DAY' });
  if (input.studentReportedExamDate) lines.push({ key: dateLabelKey('STUDENT_REPORTED_EXAM_DATE'), value: input.studentReportedExamDate, precision: 'DAY' });
  if (input.personalTargetDate) lines.push({ key: dateLabelKey('PERSONAL_TARGET_DATE'), value: input.personalTargetDate, precision: 'DAY' });
  if (input.estimatedMonth) lines.push({ key: dateLabelKey('ESTIMATED_MONTH'), value: input.estimatedMonth, precision: 'MONTH' });
  return lines;
}

/** The stored schedule facts of a target as card lines (each keeps its own source). */
export function targetScheduleLines(facts: TargetScheduleFacts): ScheduleLine[] {
  return scheduleLines({
    officialSession: facts.officialSession ? { sessionKey: facts.officialSession.sessionKey, source: facts.officialSession.source } : null,
    authoritativeExamDate: facts.authoritativeExamDate?.date ?? null,
    studentReportedExamDate: facts.studentReportedExamDate,
    personalTargetDate: facts.personalTargetDate,
    estimatedMonth: facts.estimatedMonth,
  });
}

/** Locale rendering of a schedule value: a month stays a month. */
export function formatScheduleValue(value: string, precision: 'DAY' | 'MONTH', locale: string): string {
  if (precision === 'MONTH') {
    const [y, m] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** How the ONE primary CTA behaves for a next action (the screen supplies hrefs it knows). */
export type ActionPresentation =
  | { kind: 'LINK'; labelKey: string; target: 'DIAGNOSTIC' | 'PRACTICE' | 'MOCK' | 'RESUME' | 'PREPARE_TAB' | 'RESULTS_TAB' | 'ASSESSES' | 'DATE' | 'LEARN' | 'PLANNER' }
  | { kind: 'TEXT'; labelKey: string };

export function presentNextAction(kind: NextActionKind): ActionPresentation {
  switch (kind) {
    case 'RESUME_ATTEMPT':
      return { kind: 'LINK', labelKey: 'jx.next.RESUME_ATTEMPT', target: 'RESUME' };
    case 'START_DIAGNOSTIC':
      return { kind: 'LINK', labelKey: 'jx.next.START_DIAGNOSTIC', target: 'DIAGNOSTIC' };
    case 'PRACTICE':
    case 'PAPER_TRAINING':
      return { kind: 'LINK', labelKey: `jx.next.${kind}`, target: 'PRACTICE' };
    case 'TAKE_MOCK':
      return { kind: 'LINK', labelKey: 'jx.next.TAKE_MOCK', target: 'MOCK' };
    case 'REINFORCE_CONCEPT':
    case 'REINFORCE_GAPS':
    case 'FINAL_REVIEW':
      return { kind: 'LINK', labelKey: `jx.next.${kind}`, target: 'PREPARE_TAB' };
    case 'REVIEW_MOCK_RESULT':
      return { kind: 'LINK', labelKey: 'jx.next.REVIEW_MOCK_RESULT', target: 'RESULTS_TAB' };
    case 'REVIEW_STRUCTURE':
      return { kind: 'LINK', labelKey: 'jx.next.REVIEW_STRUCTURE', target: 'ASSESSES' };
    case 'SET_EXAM_DATE':
      return { kind: 'LINK', labelKey: 'jx.next.SET_EXAM_DATE', target: 'DATE' };
    case 'CONTINUE_LEARNING':
      return { kind: 'LINK', labelKey: 'jx.next.CONTINUE_LEARNING', target: 'LEARN' };
    case 'PLAN_PROGRAMME':
      return { kind: 'LINK', labelKey: 'jx.next.PLAN_PROGRAMME', target: 'PLANNER' };
    default:
      // NOTIFY_WHEN_AVAILABLE, EXAM_DAY_LOGISTICS, CONFIRM_EXAM_SAT, RECORD_RESULT, REVIEW_RESULT,
      // CONFIRM_TARGET, REVIEW_PROJECTION, ENTER_COMPONENT_ESTIMATE: no flow exists yet -> plain text, no dead button.
      return { kind: 'TEXT', labelKey: `jx.next.${kind}` };
  }
}

/** Every next-action kind (for copy completeness tests). */
export const ALL_NEXT_ACTION_KINDS: readonly NextActionKind[] = [
  'CONTINUE_LEARNING', 'NOTIFY_WHEN_AVAILABLE', 'CONFIRM_TARGET', 'SET_EXAM_DATE', 'RESUME_ATTEMPT', 'PLAN_PROGRAMME', 'REVIEW_STRUCTURE', 'START_DIAGNOSTIC',
  'REINFORCE_CONCEPT', 'PRACTICE', 'PAPER_TRAINING', 'TAKE_MOCK', 'REVIEW_MOCK_RESULT', 'REVIEW_PROJECTION', 'REINFORCE_GAPS', 'ENTER_COMPONENT_ESTIMATE',
  'FINAL_REVIEW', 'EXAM_DAY_LOGISTICS', 'CONFIRM_EXAM_SAT', 'RECORD_RESULT', 'REVIEW_RESULT',
];

/** Mocks are offered only when the journey says one can run (never when content is unavailable). */
export function mocksVisible(r: Pick<StudentExamJourneyResolution, 'mockStatus'>): boolean {
  return r.mockStatus.status !== 'UNAVAILABLE' && r.mockStatus.status !== 'NOT_APPLICABLE';
}

/** Prediction is shown only when a classified model exists (none today). */
export function predictionVisible(r: Pick<StudentExamJourneyResolution, 'predictionStatus'>): boolean {
  return r.predictionStatus.modelClass !== 'NO_MODEL' && r.predictionStatus.status !== 'PREDICTION_MODEL_UNAVAILABLE';
}
