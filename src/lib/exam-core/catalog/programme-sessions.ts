/**
 * REM-T1-03 -- governed examination-session configuration per programme.
 *
 * The final Academic Profile step asks for the time context that MEANS
 * something for the Student's programme: the intended examination SERIES +
 * year for exam-session-driven programmes (IB Diploma, Cambridge), a
 * controlled school year for every other programme (see time-context.ts).
 *
 * Canonical series identifiers are the awarding body's OWN series names:
 *   IB        -- MAY, NOVEMBER                ("May 2027", "November 2027")
 *   Cambridge -- MARCH, JUNE, NOVEMBER        ("March 2027", "June 2027", "November 2027")
 * The calendar windows in which a series' papers are sat (Feb/Mar, May/Jun,
 * Oct/Nov) are NOT identifiers. Legacy identifiers written by the first REM-T1-03
 * cut (FEB_MARCH, MAY_JUNE, OCT_NOV) stay readable through LEGACY_SERIES_ALIASES
 * and are never rewritten.
 *
 * AVAILABILITY is resolved, never assumed (`availableSeries`):
 *   programme / qualification -> the series the body runs for it;
 *   region (country)          -> restricted series (Cambridge March) only where
 *                                the governed region list says it is administered;
 *   year                      -> region rules carry a validity window;
 *   syllabus (where known)    -> per-syllabus availability overrides. A syllabus
 *                                with a governed entry offers only its listed series.
 * SAFE FALLBACK: a RESTRICTED series (Cambridge March) needs BOTH positive facts:
 *   1. a governed region rule administers it in that country and year, and
 *   2. every selected syllabus is KNOWN (has a governed availability entry) and lists it.
 * No syllabus known, or any selected syllabus with unknown availability -> not offered
 * (India 2027 + unknown syllabus -> June / November). Unrestricted series (IB May/November,
 * Cambridge June/November) are offered unless a governed qualification exclusion or a
 * known syllabus' availability removes them.
 *
 * Programmes are matched by their EXACT catalogue name (academic_programmes.name),
 * the identity the catalogue seeds use. Every change here is a reviewed data change.
 *
 * Version 2026-10-09. Sources:
 *   IB  -- "Assessment and exams": DP examination sessions in May and November
 *          (ibo.org/programmes/diploma-programme/assessment-and-exams/).
 *   CIE -- "Exam series" / Cambridge Handbook 2026: June and November series worldwide;
 *          the March series is administered in India and Romania only; syllabus
 *          availability can differ by series and year (syllabus "Availability" sections).
 */
import type { Locale } from '@/lib/i18n/messages';

export const PROGRAMME_SESSIONS_VERSION = '2026-10-09.2';

export type ExamSeries = 'MAY' | 'NOVEMBER' | 'MARCH' | 'JUNE';
export type AwardingBody = 'IB' | 'CAMBRIDGE';

export interface ExamSeriesDefinition {
  series: ExamSeries;
  /** Month (1-12) in which the series' written examinations end -- orders and windows the options only. */
  month: number;
  /** Official English name of the series (stored as the canonical display string). */
  official: string;
  labels: Record<Locale, string>;
}

const SERIES: Record<ExamSeries, ExamSeriesDefinition> = {
  MAY: { series: 'MAY', month: 5, official: 'May', labels: { es: 'Mayo', en: 'May', de: 'Mai', fr: 'Mai', pt: 'Maio' } },
  NOVEMBER: { series: 'NOVEMBER', month: 11, official: 'November', labels: { es: 'Noviembre', en: 'November', de: 'November', fr: 'Novembre', pt: 'Novembro' } },
  MARCH: { series: 'MARCH', month: 3, official: 'March', labels: { es: 'Marzo', en: 'March', de: 'März', fr: 'Mars', pt: 'Março' } },
  JUNE: { series: 'JUNE', month: 6, official: 'June', labels: { es: 'Junio', en: 'June', de: 'Juni', fr: 'Juin', pt: 'Junho' } },
};

/** Identifiers written before the canonical rework (REM-T1-03 first cut) -> canonical series. Read-only. */
export const LEGACY_SERIES_ALIASES: Readonly<Record<string, ExamSeries>> = { FEB_MARCH: 'MARCH', MAY_JUNE: 'JUNE', OCT_NOV: 'NOVEMBER' };

/** Canonical series for a stored identifier (canonical or legacy alias), or null. */
export function canonicalSeries(series: string | null | undefined): ExamSeries | null {
  if (!series) return null;
  if (series in SERIES) return series as ExamSeries;
  return LEGACY_SERIES_ALIASES[series] ?? null;
}

export function seriesDefinition(series: string | null | undefined): ExamSeriesDefinition | null {
  const c = canonicalSeries(series);
  return c ? SERIES[c] : null;
}

// ------------------------------------------------------------------ governed catalog

export interface RegionRule {
  series: ExamSeries;
  /** ISO 3166-1 alpha-2 countries where the restricted series is administered. */
  countries: readonly string[];
  /** Inclusive validity window of the rule (null = open). */
  fromYear: number | null;
  toYear: number | null;
  source: string;
}

export interface ProgrammeSessionEntry {
  body: AwardingBody;
  /** Series offered everywhere (unless excluded below). */
  series: readonly ExamSeries[];
  /** Series offered only where a region rule says so. */
  restrictedSeries: readonly ExamSeries[];
  /** Qualification name -> series it is NOT offered in (governed exclusions). */
  qualificationExclusions?: Readonly<Record<string, readonly ExamSeries[]>>;
}

export interface SessionCatalog {
  version: string;
  programmes: Readonly<Record<string, ProgrammeSessionEntry>>;
  regionRules: readonly RegionRule[];
  /** Syllabus code -> the ONLY series that syllabus is offered in (governed, where known). */
  syllabusSeries: Readonly<Record<string, readonly ExamSeries[]>>;
}

const IB_DP: ProgrammeSessionEntry = { body: 'IB', series: ['MAY', 'NOVEMBER'], restrictedSeries: [] };
const CAMBRIDGE: ProgrammeSessionEntry = { body: 'CAMBRIDGE', series: ['JUNE', 'NOVEMBER'], restrictedSeries: ['MARCH'] };

export const SESSION_CATALOG: SessionCatalog = {
  version: PROGRAMME_SESSIONS_VERSION,
  programmes: {
    'IB Diploma Programme': IB_DP,
    'Cambridge IGCSE': CAMBRIDGE,
    'Cambridge Upper Secondary': CAMBRIDGE,
    'Cambridge Advanced': CAMBRIDGE,
    'Cambridge AICE Diploma': CAMBRIDGE,
  },
  regionRules: [
    { series: 'MARCH', countries: ['IN', 'RO'], fromYear: 2026, toYear: null, source: 'Cambridge Handbook 2026 -- March series administered in India and Romania' },
  ],
  // No syllabus-level overrides are governed yet: syllabi follow their programme's series.
  // Add an entry only from the syllabus' published "Availability" section.
  syllabusSeries: {},
};

export interface SeriesQuery {
  programmeName: string | null | undefined;
  qualificationName?: string | null;
  /** Syllabus codes of the Student's selected subjects, where known. */
  syllabusCodes?: readonly string[];
  country: string | null | undefined;
  year: number;
}

/** The programme's session entry (null = not exam-session-driven: it uses a school year). */
export function programmeSessionEntry(programmeName: string | null | undefined, catalog: SessionCatalog = SESSION_CATALOG): ProgrammeSessionEntry | null {
  return programmeName ? catalog.programmes[programmeName] ?? null : null;
}

/**
 * The series a Student may aim for in `year`, for their programme / qualification /
 * syllabi / country. Conservative: a series is offered only if it is available for the
 * programme and qualification and not removed by a known syllabus; a restricted series
 * additionally needs its region/year rule AND every selected syllabus known and offering it.
 */
export function availableSeries(q: SeriesQuery, catalog: SessionCatalog = SESSION_CATALOG): ExamSeries[] {
  const entry = programmeSessionEntry(q.programmeName, catalog);
  if (!entry) return [];
  const country = (q.country ?? '').toUpperCase();
  const excluded = new Set(q.qualificationName ? entry.qualificationExclusions?.[q.qualificationName] ?? [] : []);
  const regionAllows = (s: ExamSeries) =>
    catalog.regionRules.some(
      (r) => r.series === s && r.countries.includes(country) && (r.fromYear === null || q.year >= r.fromYear) && (r.toYear === null || q.year <= r.toYear)
    );
  const codes = q.syllabusCodes ?? [];
  // Unrestricted series: removed only by a KNOWN syllabus that does not offer it.
  const syllabusAllows = (s: ExamSeries) =>
    codes.every((code) => {
      const only = catalog.syllabusSeries[code];
      return !only || only.includes(s);
    });
  // Restricted series: every selected syllabus must be known AND offer it (at least one syllabus).
  const syllabusConfirms = (s: ExamSeries) => codes.length > 0 && codes.every((code) => catalog.syllabusSeries[code]?.includes(s) === true);
  const candidates = [...entry.series, ...entry.restrictedSeries.filter((s) => regionAllows(s) && syllabusConfirms(s))];
  return candidates.filter((s) => !excluded.has(s) && syllabusAllows(s)).sort((a, b) => SERIES[a].month - SERIES[b].month);
}

/** Every series the programme can ever offer (before region / year / syllabus resolution). */
export function programmeSeries(programmeName: string | null | undefined, catalog: SessionCatalog = SESSION_CATALOG): ExamSeries[] {
  const entry = programmeSessionEntry(programmeName, catalog);
  return entry ? [...entry.series, ...entry.restrictedSeries] : [];
}
