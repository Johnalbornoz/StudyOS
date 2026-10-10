/**
 * T1 final delta (C) -- the temporal mode of an Exam Preparation objective (pure).
 *
 * An objective whose awarding body runs GOVERNED examination series (IB Diploma: May / November;
 * Cambridge: March / June / November) is configured with a SERIES + YEAR from the same canonical
 * session catalogue the Academic Profile uses (programme-sessions.ts `availableSeries`, through
 * time-context.ts). Nothing about availability lives here or in the UI: this module only says WHICH
 * governed programme entry an objective framework belongs to.
 *
 * Every other objective (PAA, Saber 11, PISA, ...) has no governed series: it keeps the date mode
 * (the Student's own exam date).
 *
 * Stored on student_exam_profiles.target_exam_series / target_exam_year with CANONICAL identifiers
 * only. Legacy identifiers stay readable (canonicalSeries) and are never rewritten.
 */
import { resolveTimeContextModel, isAcceptedTimeContext, parseTimeContextKey, timeContextKey, timeContextOptions, formatTimeContext, type TimeContext, type TimeContextModel } from '@/lib/student/time-context';
import { canonicalSeries } from '@/lib/exam-core/catalog/programme-sessions';
import type { Locale } from '@/lib/i18n/messages';
import type { ExamObjective, ObjectiveFramework } from './objective-catalog';

/** Objective framework -> its entry in the governed session catalogue (SESSION_CATALOG.programmes). */
export const FRAMEWORK_SESSION_PROGRAMME: Partial<Record<ObjectiveFramework, string>> = {
  IB_DP: 'IB Diploma Programme',
  CIE_IGCSE: 'Cambridge IGCSE',
  CIE_AS_A: 'Cambridge Advanced',
  CIE_AICE: 'Cambridge AICE Diploma',
};

export type ExamSessionModel = Extract<TimeContextModel, { kind: 'EXAM_SESSION' }>;
export type ExamSessionValue = Extract<TimeContext, { kind: 'EXAM_SESSION' }>;

/**
 * The session model of an objective, or null when it has no governed series (date mode).
 * `country` is the Student's country of study when known; unknown -> restricted series are not offered.
 */
export function objectiveSessionModel(objective: Pick<ExamObjective, 'framework' | 'context'>, country: string | null): ExamSessionModel | null {
  const programmeName = FRAMEWORK_SESSION_PROGRAMME[objective.framework];
  if (!programmeName) return null;
  const model = resolveTimeContextModel({ country, programmeName, syllabusCodes: objective.context.syllabusCode ? [objective.context.syllabusCode] : [] });
  return model.kind === 'EXAM_SESSION' ? model : null;
}

/** The stored session of a preparation (legacy identifiers read as canonical), or null. */
export function storedExamSession(row: { targetExamSeries?: string | null; targetExamYear?: number | null }): ExamSessionValue | null {
  const series = canonicalSeries(row.targetExamSeries);
  return series && row.targetExamYear ? { kind: 'EXAM_SESSION', series, year: Number(row.targetExamYear) } : null;
}

/** Controlled options for the picker: [{ key: 'ES:MAY:2027', label: 'May 2027' }], the stored one always included. */
export function examSessionOptions(model: ExamSessionModel, now: Date, stored: ExamSessionValue | null, locale: Locale): Array<{ key: string; label: string }> {
  const options = timeContextOptions(model, now);
  const all = stored && !options.some((o) => timeContextKey(o) === timeContextKey(stored)) ? [stored, ...options] : options;
  return all.map((o) => ({ key: timeContextKey(o), label: formatTimeContext(o, locale) }));
}

/**
 * Server-side acceptance of a submitted session key: a canonical "ES:<SERIES>:<YEAR>" that the
 * governed catalogue offers for this objective now -- or exactly the stored value.
 */
export function acceptExamSession(key: string, model: ExamSessionModel, now: Date, stored: ExamSessionValue | null): ExamSessionValue | null {
  const v = parseTimeContextKey(key);
  if (!v || v.kind !== 'EXAM_SESSION') return null;
  return isAcceptedTimeContext(v, model, now, stored) ? v : null;
}

/** "May 2027" in the interface locale. */
export function examSessionLabel(v: ExamSessionValue, locale: Locale): string {
  return formatTimeContext(v, locale);
}
