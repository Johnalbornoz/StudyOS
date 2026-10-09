/**
 * REM-T1-03 -- governed examination-session configuration per programme.
 *
 * The final Academic Profile step asks for the time context that MEANS
 * something for the Student's programme:
 *   - exam-session-driven programmes (IB Diploma, Cambridge qualifications):
 *     the intended examination SERIES + year ("May 2027", "May/June 2027");
 *   - every other programme: a controlled school year (see time-context.ts).
 *
 * Series are NOT shared across awarding bodies (Cambridge does not copy IB's
 * May/November model): each programme lists its own series, each with the
 * regions where it is offered. Programmes are matched by their EXACT catalogue
 * name (academic_programmes.name), the same identity the catalogue seeds use.
 * Adding a programme or a series is a reviewed data change here.
 *
 * Version 2026-10-09. Sources:
 *   IB  -- "Assessment and exams": DP examination sessions in May and November
 *          (ibo.org/programmes/diploma-programme/assessment-and-exams/).
 *   CIE -- "Exam series": February/March (India only), May/June and
 *          October/November (cambridgeinternational.org/exam-administration/
 *          what-happens-when/key-dates-and-timetables/).
 */
import type { Locale } from '@/lib/i18n/messages';

export const PROGRAMME_SESSIONS_VERSION = '2026-10-09';

export type ExamSeries = 'MAY' | 'NOVEMBER' | 'FEB_MARCH' | 'MAY_JUNE' | 'OCT_NOV';

export interface ExamSeriesDefinition {
  series: ExamSeries;
  /** Month (1-12) in which the series' written examinations end -- used only to order and window the options. */
  month: number;
  /** ISO 3166-1 alpha-2 countries where the series is offered; null = every region. */
  regions: readonly string[] | null;
  /** Official English name of the series (stored as the canonical display string). */
  official: string;
  labels: Record<Locale, string>;
}

const SERIES: Record<ExamSeries, ExamSeriesDefinition> = {
  MAY: { series: 'MAY', month: 5, regions: null, official: 'May', labels: { es: 'Mayo', en: 'May', de: 'Mai', fr: 'Mai', pt: 'Maio' } },
  NOVEMBER: { series: 'NOVEMBER', month: 11, regions: null, official: 'November', labels: { es: 'Noviembre', en: 'November', de: 'November', fr: 'Novembre', pt: 'Novembro' } },
  FEB_MARCH: { series: 'FEB_MARCH', month: 3, regions: ['IN'], official: 'February/March', labels: { es: 'Febrero/marzo', en: 'February/March', de: 'Februar/März', fr: 'Février/mars', pt: 'Fevereiro/março' } },
  MAY_JUNE: { series: 'MAY_JUNE', month: 6, regions: null, official: 'May/June', labels: { es: 'Mayo/junio', en: 'May/June', de: 'Mai/Juni', fr: 'Mai/juin', pt: 'Maio/junho' } },
  OCT_NOV: { series: 'OCT_NOV', month: 11, regions: null, official: 'October/November', labels: { es: 'Octubre/noviembre', en: 'October/November', de: 'Oktober/November', fr: 'Octobre/novembre', pt: 'Outubro/novembro' } },
};

const IB_DP: ExamSeries[] = ['MAY', 'NOVEMBER'];
const CAMBRIDGE: ExamSeries[] = ['FEB_MARCH', 'MAY_JUNE', 'OCT_NOV'];

/** Exact catalogue programme name -> the series its examinations are sat in. */
const PROGRAMME_SERIES: Record<string, { body: 'IB' | 'CAMBRIDGE'; series: ExamSeries[] }> = {
  'IB Diploma Programme': { body: 'IB', series: IB_DP },
  'Cambridge IGCSE': { body: 'CAMBRIDGE', series: CAMBRIDGE },
  'Cambridge Upper Secondary': { body: 'CAMBRIDGE', series: CAMBRIDGE },
  'Cambridge Advanced': { body: 'CAMBRIDGE', series: CAMBRIDGE },
  'Cambridge AICE Diploma': { body: 'CAMBRIDGE', series: CAMBRIDGE },
};

export function seriesDefinition(series: string | null | undefined): ExamSeriesDefinition | null {
  return series && series in SERIES ? SERIES[series as ExamSeries] : null;
}

/**
 * The series a programme's examinations are offered in, for the Student's country.
 * null = the programme is not exam-session-driven (it uses a school year).
 */
export function programmeExamSeries(programmeName: string | null | undefined, country: string | null | undefined): { body: 'IB' | 'CAMBRIDGE'; series: ExamSeriesDefinition[] } | null {
  const entry = programmeName ? PROGRAMME_SERIES[programmeName] : undefined;
  if (!entry) return null;
  const c = (country ?? '').toUpperCase();
  const series = entry.series.map((s) => SERIES[s]).filter((d) => d.regions === null || d.regions.includes(c));
  return series.length ? { body: entry.body, series } : null;
}
