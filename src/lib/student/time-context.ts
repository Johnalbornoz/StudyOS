/**
 * REM-T1-03 -- the context-aware final step of the Academic Profile (pure).
 *
 * Replaces the free-text "academic year" with a CONTROLLED, structured value
 * driven by the Student's programme:
 *   - exam-session-driven programmes (programme-sessions.ts): an examination
 *     series + year ("May 2027", "May/June 2027") -- never a generic year;
 *   - every other programme: a school year. Split years (Aug-Jul: MX, US, DE,
 *     other) are "2026-2027"; Colombia's calendar-year school system is "2026".
 *
 * Stored structurally (academic_year_start/end or exam_series/exam_year) and,
 * for every existing reader, as the canonical display string in the legacy
 * `academic_year` column. Previously saved free-text values stay readable and
 * are preloaded when they parse unambiguously.
 */
import type { Locale } from '@/lib/i18n/messages';
import { availableSeries, canonicalSeries, programmeSeries, programmeSessionEntry, seriesDefinition, type AwardingBody, type ExamSeries } from '@/lib/exam-core/catalog/programme-sessions';

export type TimeContext =
  | { kind: 'SCHOOL_YEAR'; startYear: number; endYear: number }
  | { kind: 'EXAM_SESSION'; series: ExamSeries; year: number };

/** What decides which exam series are available (programme-sessions.ts `availableSeries`). */
export interface SessionScope {
  programmeName: string;
  qualificationName: string | null;
  syllabusCodes: string[];
  country: string | null;
}

export type TimeContextModel =
  | { kind: 'SCHOOL_YEAR'; format: 'SPLIT' | 'CALENDAR' }
  | { kind: 'EXAM_SESSION'; body: AwardingBody; series: ExamSeries[]; scope: SessionScope };

/** Calendar-year school systems (the school year is one calendar year). */
const CALENDAR_YEAR_COUNTRIES = new Set(['CO']);

export function resolveTimeContextModel(input: { country: string | null; programmeName: string | null; qualificationName?: string | null; syllabusCodes?: readonly string[] }): TimeContextModel {
  const entry = programmeSessionEntry(input.programmeName);
  if (entry && input.programmeName) {
    return {
      kind: 'EXAM_SESSION',
      body: entry.body,
      series: programmeSeries(input.programmeName),
      scope: { programmeName: input.programmeName, qualificationName: input.qualificationName ?? null, syllabusCodes: [...(input.syllabusCodes ?? [])], country: input.country },
    };
  }
  return { kind: 'SCHOOL_YEAR', format: CALENDAR_YEAR_COUNTRIES.has((input.country ?? '').toUpperCase()) ? 'CALENDAR' : 'SPLIT' };
}

/** Stable option key ("SY:2026-2027", "ES:MAY:2027"). */
export function timeContextKey(v: TimeContext): string {
  return v.kind === 'SCHOOL_YEAR' ? `SY:${v.startYear}-${v.endYear}` : `ES:${v.series}:${v.year}`;
}

export function parseTimeContextKey(key: string | null | undefined): TimeContext | null {
  if (!key) return null;
  const sy = /^SY:(\d{4})-(\d{4})$/.exec(key);
  if (sy) return { kind: 'SCHOOL_YEAR', startYear: Number(sy[1]), endYear: Number(sy[2]) };
  const es = /^ES:([A-Z_]+):(\d{4})$/.exec(key);
  const series = es ? canonicalSeries(es[1]) : null;
  if (es && series) return { kind: 'EXAM_SESSION', series, year: Number(es[2]) };
  return null;
}

/** Canonical, locale-independent string written to the legacy `academic_year` column. */
export function canonicalTimeContextText(v: TimeContext): string {
  if (v.kind === 'SCHOOL_YEAR') return v.startYear === v.endYear ? String(v.startYear) : `${v.startYear}–${v.endYear}`;
  return `${seriesDefinition(v.series)!.official} ${v.year}`;
}

export function formatTimeContext(v: TimeContext, locale: Locale): string {
  if (v.kind === 'SCHOOL_YEAR') return canonicalTimeContextText(v);
  return `${seriesDefinition(v.series)!.labels[locale] ?? seriesDefinition(v.series)!.official} ${v.year}`;
}

/**
 * The controlled options for a model at a point in time:
 *   - school year: the current one and the next one;
 *   - exam session: the next 4 sittings that have not finished yet.
 */
export function timeContextOptions(model: TimeContextModel, now: Date): TimeContext[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  if (model.kind === 'SCHOOL_YEAR') {
    if (model.format === 'CALENDAR') return [year, year + 1].map((y) => ({ kind: 'SCHOOL_YEAR' as const, startYear: y, endYear: y }));
    const start = month >= 8 ? year : year - 1; // a split school year starts in August
    return [start, start + 1].map((y) => ({ kind: 'SCHOOL_YEAR' as const, startYear: y, endYear: y + 1 }));
  }
  const out: TimeContext[] = [];
  for (let y = year; y <= year + 3 && out.length < 4; y++) {
    // Availability is resolved per year (region rules carry validity windows); never assumed.
    const sittings = sessionSeriesFor(model, y)
      .map((s) => seriesDefinition(s)!)
      .filter((d) => y > year || d.month >= month);
    for (const d of sittings) if (out.length < 4) out.push({ kind: 'EXAM_SESSION', series: d.series, year: y });
  }
  return out;
}

/** The series available in `year` for an exam-session model (programme / qualification / syllabi / region / year). */
export function sessionSeriesFor(model: TimeContextModel, year: number): ExamSeries[] {
  if (model.kind !== 'EXAM_SESSION') return [];
  return availableSeries({ ...model.scope, year });
}

export function timeContextFitsModel(v: TimeContext, model: TimeContextModel): boolean {
  if (v.kind === 'SCHOOL_YEAR') {
    if (model.kind !== 'SCHOOL_YEAR') return false;
    return model.format === 'CALENDAR' ? v.startYear === v.endYear : v.endYear === v.startYear + 1;
  }
  const series = canonicalSeries(v.series);
  return model.kind === 'EXAM_SESSION' && !!series && sessionSeriesFor(model, v.year).includes(series);
}

/** Structured columns stored for a value (the CHECK in migration 20261106_1000 enforces one shape). */
export function timeContextColumns(v: TimeContext | null): { academicYearStart: number | null; academicYearEnd: number | null; examSeries: ExamSeries | null; examYear: number | null } {
  if (!v) return { academicYearStart: null, academicYearEnd: null, examSeries: null, examYear: null };
  return v.kind === 'SCHOOL_YEAR'
    ? { academicYearStart: v.startYear, academicYearEnd: v.endYear, examSeries: null, examYear: null }
    : { academicYearStart: null, academicYearEnd: null, examSeries: v.series, examYear: v.year };
}

/**
 * The stored value as a TimeContext: the structured columns when present, otherwise
 * an unambiguous legacy string ("2026–2027", "2026-2027", "2026/2027", "2026"); null when
 * the legacy text cannot be read safely (it is still shown as-is, never rewritten).
 */
export function storedTimeContext(row: { academicYear: string | null; academicYearStart?: number | null; academicYearEnd?: number | null; examSeries?: string | null; examYear?: number | null }): TimeContext | null {
  // Legacy identifiers (FEB_MARCH / MAY_JUNE / OCT_NOV) are READ as their canonical series; the row is not rewritten.
  const series = canonicalSeries(row.examSeries);
  if (series && row.examYear) return { kind: 'EXAM_SESSION', series, year: row.examYear };
  if (row.academicYearStart && row.academicYearEnd) return { kind: 'SCHOOL_YEAR', startYear: row.academicYearStart, endYear: row.academicYearEnd };
  const text = (row.academicYear ?? '').trim();
  const split = /^(\d{4})\s*[–\-/]\s*(\d{2}|\d{4})$/.exec(text);
  if (split) {
    const start = Number(split[1]);
    const end = split[2].length === 2 ? Math.floor(start / 100) * 100 + Number(split[2]) : Number(split[2]);
    return end === start + 1 ? { kind: 'SCHOOL_YEAR', startYear: start, endYear: end } : null;
  }
  if (/^\d{4}$/.test(text)) return { kind: 'SCHOOL_YEAR', startYear: Number(text), endYear: Number(text) };
  return null;
}

/**
 * Server-side acceptance of a submitted time context: it must fit the programme's model
 * and be one of the controlled options -- or exactly the value already stored (an edit
 * that keeps an older choice is never rejected).
 */
export function isAcceptedTimeContext(v: TimeContext, model: TimeContextModel, now: Date, stored: TimeContext | null): boolean {
  if (!timeContextFitsModel(v, model)) return false;
  const key = timeContextKey(v);
  if (stored && timeContextKey(stored) === key) return true;
  return timeContextOptions(model, now).some((o) => timeContextKey(o) === key);
}
