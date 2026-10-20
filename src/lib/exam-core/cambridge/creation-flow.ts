/**
 * CAMBRIDGE PILOT -- preparation creation flow (pure: no DB, no clock, no network).
 *
 * Decisions §16-18 (FINAL PRODUCT-DECISION DELTA):
 *   - Step order: programme / qualification -> subject -> tier -> exam year -> exam series -> create.
 *     A later step is never accepted before the earlier ones (STEP_OUT_OF_ORDER). The tier step applies only
 *     to subjects with tiers (0580, 0610); for the others it is NOT_APPLICABLE and skipped.
 *   - Only VALID series are offered: IGCSE series come from the governed session catalogue (programme-sessions.ts,
 *     REM-03: restricted March only where governed for the region AND the syllabus); Checkpoint series come from the
 *     Checkpoint contract (Global Perspectives: never March). Finished sittings are never offered.
 *   - StudyUs auto-resolves the syllabus code + version. More than one governed mapping left -> CHOICE_REQUIRED
 *     (the product asks; never guesses). No governed version for the year -> BLOCKED: VERSION_NOT_GOVERNED.
 *   - The preparation FREEZES qualification, subject, tier, examYear, examSeries, syllabusCode, syllabusVersion and
 *     preparationStartDate. Changing the series is an explicit, audited action that preserves progress and evidence,
 *     updates the target and recomputes the calendar (planSeriesChange) -- never a silent mutation.
 *   - IGCSE ESL is 0510 (Speaking Endorsement) and is never converted to 0511. Global Perspectives is project /
 *     report preparation, never an MCQ / written mock.
 */
import { availableSeries, PROGRAMME_SESSIONS_VERSION, type ExamSeries } from '../catalog/programme-sessions';
import { CHECKPOINT_SUBJECT_OPTIONS, resolveCheckpointVariant, type CheckpointSchoolRoute } from '../checkpoint/checkpoint-preparation';
import {
  CAMBRIDGE_PROGRAMMES, CAMBRIDGE_SCHOOL_DECISION_IDS, CAMBRIDGE_SCHOOL_MAP_VERSION, CAMBRIDGE_SCHOOL_SUBJECT_MAP, CHECKPOINT_LEVEL_OF, PROGRAMME_LABELS,
  allowedActivityKinds, schoolSubjectEntry,
  type CambridgeProgramme, type CambridgeRoute, type CambridgeTier, type GovernedSyllabusVersion, type MappingGap, type SchoolSubject, type SchoolSubjectEntry, type SupplyStatus, type SyllabusMapping,
} from './school-subject-map';

export const CAMBRIDGE_CREATION_STEPS = ['PROGRAMME', 'SUBJECT', 'TIER', 'EXAM_YEAR', 'EXAM_SERIES', 'CREATE'] as const;
export type CambridgeCreationStep = (typeof CAMBRIDGE_CREATION_STEPS)[number];

/** Cambridge series identifiers: IGCSE (MARCH / JUNE / NOVEMBER) and Checkpoint (MARCH / MAY / OCTOBER). */
export type CambridgeSeries = 'MARCH' | 'MAY' | 'JUNE' | 'OCTOBER' | 'NOVEMBER';
/** Month the series is named after (orders and windows the options only; never an exam date). */
export const SERIES_MONTH: Record<CambridgeSeries, number> = { MARCH: 3, MAY: 5, JUNE: 6, OCTOBER: 10, NOVEMBER: 11 };
const SERIES_LABEL: Record<CambridgeSeries, { es: string; en: string }> = {
  MARCH: { es: 'Marzo', en: 'March' }, MAY: { es: 'Mayo', en: 'May' }, JUNE: { es: 'Junio', en: 'June' }, OCTOBER: { es: 'Octubre', en: 'October' }, NOVEMBER: { es: 'Noviembre', en: 'November' },
};
export function seriesLabel(series: CambridgeSeries, year: number, locale: string): string {
  return `${SERIES_LABEL[series][locale === 'en' ? 'en' : 'es']} ${year}`;
}

/** How many exam years are offered from the current one. */
export const YEAR_HORIZON = 4;

export interface CambridgeSelection {
  programme?: string | null;
  subject?: string | null;
  /** null / undefined for subjects without tiers. */
  tier?: string | null;
  examYear?: number | null;
  examSeries?: string | null;
  /** `${syllabusCode}:${version}` -- only when resolution asked for a choice (CHOICE_REQUIRED). */
  syllabusChoice?: string | null;
}

export interface FlowContext {
  now: Date;
  /** ISO country of study (restricted series need a governed region rule). */
  country: string | null;
  /** The school's Checkpoint route (Primary / Lower Secondary preparation needs it CONFIRMED). */
  checkpointRoute: CheckpointSchoolRoute;
  /** Pilot exposure of a catalogue objective (default: every objective is exposed). */
  isObjectiveExposed?: (objectiveKey: string) => boolean;
  map?: readonly SchoolSubjectEntry[];
}

export type FlowBlocker =
  | { code: 'NO_GOVERNED_CODE' | 'VERSION_NOT_GOVERNED' | 'NOT_IN_CATALOGUE' | 'SCHOOL_CONFIRMATION_REQUIRED' | 'NOT_EXPOSED'; detail: string };

export type FlowErrorCode =
  | 'STEP_OUT_OF_ORDER' | 'UNKNOWN_PROGRAMME' | 'UNKNOWN_SUBJECT' | 'INVALID_TIER' | 'TIER_REQUIRED' | 'INVALID_EXAM_YEAR' | 'INVALID_EXAM_SERIES'
  | 'SYLLABUS_CHOICE_REQUIRED' | 'BLOCKED';

// ---------------------------------------------------------------- step options

const ctxMap = (ctx: FlowContext) => ctx.map ?? CAMBRIDGE_SCHOOL_SUBJECT_MAP;
const today = (now: Date) => now.toISOString().slice(0, 10);

export function isCambridgeProgramme(v: unknown): v is CambridgeProgramme {
  return typeof v === 'string' && (CAMBRIDGE_PROGRAMMES as readonly string[]).includes(v);
}

export function programmeOptions(locale = 'es'): Array<{ key: CambridgeProgramme; label: string }> {
  return CAMBRIDGE_PROGRAMMES.map((p) => ({ key: p, label: PROGRAMME_LABELS[p][locale === 'en' ? 'en' : 'es'] }));
}

/** Blockers that apply to a subject before any tier / year is chosen. */
export function subjectBlockers(entry: SchoolSubjectEntry, ctx: FlowContext): FlowBlocker[] {
  const out: FlowBlocker[] = [];
  if (!entry.mappings.length) {
    out.push({ code: 'NO_GOVERNED_CODE', detail: entry.gaps.find((g) => g.code === 'NO_GOVERNED_CODE')?.missing ?? 'no governed syllabus code' });
    return out;
  }
  const level = CHECKPOINT_LEVEL_OF[entry.programme];
  if (level) {
    const r = resolveCheckpointVariant(ctx.checkpointRoute);
    if (r.status !== 'CONFIRMED') out.push({ code: 'SCHOOL_CONFIRMATION_REQUIRED', detail: r.blockers.join(',') });
  }
  if (entry.mappings.every((m) => !m.objectiveKey)) out.push({ code: 'NOT_IN_CATALOGUE', detail: entry.mappings.map((m) => m.syllabusCode).join(',') });
  if (entry.mappings.every((m) => m.versions.length === 0)) out.push({ code: 'VERSION_NOT_GOVERNED', detail: `${[...new Set(entry.mappings.map((m) => m.syllabusCode))].join(',')}: no governed syllabus version` });
  const exposed = ctx.isObjectiveExposed ?? (() => true);
  if (!out.length && entry.mappings.every((m) => !m.objectiveKey || !exposed(m.objectiveKey))) out.push({ code: 'NOT_EXPOSED', detail: 'not offered to Students in the pilot' });
  return out;
}

export interface SubjectOption {
  key: SchoolSubject;
  label: string;
  available: boolean;
  blockers: FlowBlocker[];
  gaps: readonly MappingGap[];
  codes: string[];
  supply: SupplyStatus[];
}

export function subjectOptions(programme: CambridgeProgramme, ctx: FlowContext, locale = 'es'): SubjectOption[] {
  return ctxMap(ctx)
    .filter((e) => e.programme === programme)
    .map((e) => {
      const blockers = subjectBlockers(e, ctx);
      return { key: e.subject, label: e.label[locale === 'en' ? 'en' : 'es'], available: blockers.length === 0, blockers, gaps: e.gaps, codes: [...new Set(e.mappings.map((m) => m.syllabusCode))], supply: e.mappings.map((m) => m.supply) };
    });
}

/** Tiers of a subject (empty: the tier step does not apply). */
export function tierOptions(entry: SchoolSubjectEntry): CambridgeTier[] {
  const tiers = entry.mappings.map((m) => m.tier).filter((t): t is CambridgeTier => t !== null);
  return (['CORE', 'EXTENDED'] as const).filter((t) => tiers.includes(t));
}

const mappingsFor = (entry: SchoolSubjectEntry, tier: CambridgeTier | null) => entry.mappings.filter((m) => m.tier === tier);
const versionsFor = (m: SyllabusMapping, year: number) => m.versions.filter((v) => year >= v.firstExamYear && year <= v.lastExamYear);

/** The series offered for a mapping in a year (governed availability, finished sittings removed), in calendar order. */
export function seriesFor(entry: SchoolSubjectEntry, m: SyllabusMapping, year: number, ctx: FlowContext): CambridgeSeries[] {
  const nowYear = ctx.now.getUTCFullYear();
  const nowMonth = ctx.now.getUTCMonth() + 1;
  if (year < nowYear) return [];
  let series: CambridgeSeries[];
  const level = CHECKPOINT_LEVEL_OF[entry.programme];
  if (level) {
    const option = CHECKPOINT_SUBJECT_OPTIONS.find((o) => o.level === level && o.frameworkCode === m.syllabusCode);
    series = option ? [...option.series] : [];
  } else {
    series = availableSeries({ programmeName: 'Cambridge IGCSE', syllabusCodes: [m.syllabusCode], country: ctx.country, year }) as ExamSeries[] as CambridgeSeries[];
  }
  return series.filter((s) => year > nowYear || SERIES_MONTH[s] >= nowMonth).sort((a, b) => SERIES_MONTH[a] - SERIES_MONTH[b]);
}

export interface YearOption { year: number; versionGoverned: boolean; series: CambridgeSeries[] }

/** Exam years from the current one; each says whether a syllabus version is governed for it. Years with no valid series are not offered. */
export function yearOptions(entry: SchoolSubjectEntry, tier: CambridgeTier | null, ctx: FlowContext): YearOption[] {
  const nowYear = ctx.now.getUTCFullYear();
  const ms = mappingsFor(entry, tier);
  const out: YearOption[] = [];
  for (let y = nowYear; y < nowYear + YEAR_HORIZON; y++) {
    const series = [...new Set(ms.flatMap((m) => seriesFor(entry, m, y, ctx)))].sort((a, b) => SERIES_MONTH[a] - SERIES_MONTH[b]);
    if (!series.length) continue;
    out.push({ year: y, versionGoverned: ms.some((m) => versionsFor(m, y).length > 0), series });
  }
  return out;
}

// ---------------------------------------------------------------- syllabus resolution

export interface SyllabusChoice { key: string; syllabusCode: string; version: string; route: CambridgeRoute | null }
export type SyllabusResolution =
  | { status: 'RESOLVED'; mapping: SyllabusMapping; version: GovernedSyllabusVersion }
  | { status: 'CHOICE_REQUIRED'; choices: SyllabusChoice[] }
  | { status: 'BLOCKED'; blockers: FlowBlocker[] };

/** Auto-resolution of code + version for (programme, subject, tier, year): single -> RESOLVED, several -> CHOICE_REQUIRED, none -> BLOCKED. */
export function resolveSyllabus(entry: SchoolSubjectEntry, tier: CambridgeTier | null, year: number, choice?: string | null): SyllabusResolution {
  const ms = mappingsFor(entry, tier);
  if (!ms.length) return { status: 'BLOCKED', blockers: [{ code: 'NO_GOVERNED_CODE', detail: `${entry.programme}/${entry.subject}/${tier ?? '-'}` }] };
  const pairs = ms.flatMap((m) => versionsFor(m, year).map((v) => ({ m, v, key: `${m.syllabusCode}:${v.version}` })));
  if (!pairs.length) return { status: 'BLOCKED', blockers: [{ code: 'VERSION_NOT_GOVERNED', detail: `${[...new Set(ms.map((m) => m.syllabusCode))].join(',')}: no governed syllabus version for ${year}` }] };
  for (const p of pairs) if (p.m.neverCodes?.includes(p.m.syllabusCode)) throw new Error(`governance: ${p.m.syllabusCode} is a forbidden conversion`);
  if (pairs.length === 1) return { status: 'RESOLVED', mapping: pairs[0].m, version: pairs[0].v };
  const chosen = choice ? pairs.find((p) => p.key === choice) : undefined;
  if (chosen) return { status: 'RESOLVED', mapping: chosen.m, version: chosen.v };
  return { status: 'CHOICE_REQUIRED', choices: pairs.map((p) => ({ key: p.key, syllabusCode: p.m.syllabusCode, version: p.v.version, route: p.m.route })) };
}

// ---------------------------------------------------------------- the flow state

export interface FlowState {
  step: CambridgeCreationStep;
  errors: Array<{ code: FlowErrorCode; field: keyof CambridgeSelection | null; detail?: string }>;
  programmes: Array<{ key: CambridgeProgramme; label: string }>;
  subjects: SubjectOption[] | null;
  tiers: CambridgeTier[] | null;
  years: YearOption[] | null;
  series: Array<{ key: CambridgeSeries; label: string }> | null;
  resolution: SyllabusResolution | null;
  /** Activities this mapping may ever offer (format fidelity: GP is project / report only). */
  activityKinds: ReturnType<typeof allowedActivityKinds> | null;
}

const ORDER: Array<keyof CambridgeSelection> = ['programme', 'subject', 'tier', 'examYear', 'examSeries'];
const present = (v: unknown) => v !== undefined && v !== null && v !== '';

/**
 * The flow for a (partial) selection: the options of every step reached, the current step, and the errors.
 * Strict ordering: a field set while an earlier one is missing is STEP_OUT_OF_ORDER.
 */
export function describeFlow(sel: CambridgeSelection, ctx: FlowContext, locale = 'es'): FlowState {
  const state: FlowState = { step: 'PROGRAMME', errors: [], programmes: programmeOptions(locale), subjects: null, tiers: null, years: null, series: null, resolution: null, activityKinds: null };
  const err = (code: FlowErrorCode, field: keyof CambridgeSelection | null, detail?: string) => { state.errors.push({ code, field, detail }); return state; };

  if (!present(sel.programme)) {
    for (const f of ORDER.slice(1)) if (present(sel[f])) return err('STEP_OUT_OF_ORDER', f);
    return state;
  }
  if (!isCambridgeProgramme(sel.programme)) return err('UNKNOWN_PROGRAMME', 'programme');
  const programme = sel.programme;
  state.step = 'SUBJECT';
  state.subjects = subjectOptions(programme, ctx, locale);
  if (!present(sel.subject)) {
    for (const f of ORDER.slice(2)) if (present(sel[f])) return err('STEP_OUT_OF_ORDER', f);
    return state;
  }
  const entry = schoolSubjectEntry(programme, sel.subject as SchoolSubject, ctxMap(ctx));
  if (!entry) return err('UNKNOWN_SUBJECT', 'subject');
  const blockers = subjectBlockers(entry, ctx);
  if (blockers.length) {
    state.resolution = { status: 'BLOCKED', blockers };
    return err('BLOCKED', 'subject', blockers.map((b) => b.code).join(','));
  }
  state.activityKinds = allowedActivityKinds(entry.mappings[0]);
  const tiers = tierOptions(entry);
  let tier: CambridgeTier | null = null;
  if (tiers.length) {
    state.step = 'TIER';
    state.tiers = tiers;
    if (!present(sel.tier)) {
      for (const f of ORDER.slice(3)) if (present(sel[f])) return err('STEP_OUT_OF_ORDER', f);
      return state;
    }
    if (!(tiers as string[]).includes(sel.tier as string)) return err('INVALID_TIER', 'tier');
    tier = sel.tier as CambridgeTier;
  } else if (present(sel.tier)) {
    return err('INVALID_TIER', 'tier', 'this subject has no tiers');
  }
  state.step = 'EXAM_YEAR';
  state.years = yearOptions(entry, tier, ctx);
  if (!present(sel.examYear)) {
    if (present(sel.examSeries)) return err('STEP_OUT_OF_ORDER', 'examSeries');
    return state;
  }
  const yearOpt = state.years.find((y) => y.year === sel.examYear);
  if (!yearOpt) return err('INVALID_EXAM_YEAR', 'examYear');
  state.resolution = resolveSyllabus(entry, tier, yearOpt.year, sel.syllabusChoice);
  if (state.resolution.status === 'BLOCKED') return err('BLOCKED', 'examYear', state.resolution.blockers.map((b) => b.code).join(','));
  // Series of the resolved mapping (or of every candidate while a choice is pending).
  const candidates = state.resolution.status === 'RESOLVED' ? [state.resolution.mapping] : mappingsFor(entry, tier);
  const series = [...new Set(candidates.flatMap((m) => seriesFor(entry, m, yearOpt.year, ctx)))].sort((a, b) => SERIES_MONTH[a] - SERIES_MONTH[b]);
  state.step = 'EXAM_SERIES';
  state.series = series.map((s) => ({ key: s, label: seriesLabel(s, yearOpt.year, locale) }));
  if (!present(sel.examSeries)) return state;
  if (!(series as string[]).includes(sel.examSeries as string)) return err('INVALID_EXAM_SERIES', 'examSeries');
  if (state.resolution.status === 'CHOICE_REQUIRED') return err('SYLLABUS_CHOICE_REQUIRED', 'syllabusChoice');
  state.step = 'CREATE';
  return state;
}

// ---------------------------------------------------------------- the freeze

export interface SeriesChangeRecord {
  at: string;
  actor: 'STUDENT' | 'INSTITUTION' | 'OPERATOR';
  actorId: string | null;
  from: { examSeries: CambridgeSeries; examYear: number; syllabusVersion: string };
  to: { examSeries: CambridgeSeries; examYear: number; syllabusVersion: string };
  reason: string | null;
  /** Progress and evidence stay on the same preparation (same exam target id); nothing is reset or deleted. */
  evidencePreserved: true;
  calendarRecomputed: { before: PreparationCalendar; after: PreparationCalendar };
}

export interface CambridgePreparationFreeze {
  schema: 'cambridge-preparation-freeze/v1';
  /** Qualification / programme in Cambridge's words. */
  qualification: string;
  programme: CambridgeProgramme;
  subject: SchoolSubject;
  tier: CambridgeTier | null;
  route: CambridgeRoute | null;
  examYear: number;
  examSeries: CambridgeSeries;
  syllabusCode: string;
  syllabusVersion: string;
  syllabusVersionSourceKeys: string[];
  preparationStartDate: string;
  objectiveKey: string;
  governance: { mapVersion: string; sessionsVersion: string; decisionIds: string[] };
  seriesChanges: SeriesChangeRecord[];
}

export type CreationValidation =
  | { ok: true; freeze: CambridgePreparationFreeze; mapping: SyllabusMapping; state: FlowState }
  | { ok: false; state: FlowState; code: FlowErrorCode; field: keyof CambridgeSelection | null; detail?: string };

/** Server-side validation of a complete selection; returns the freeze to persist. */
export function validateCreation(sel: CambridgeSelection, ctx: FlowContext): CreationValidation {
  const state = describeFlow(sel, ctx, 'en');
  if (state.errors.length) return { ok: false, state, ...state.errors[0] };
  if (state.step !== 'CREATE' || state.resolution?.status !== 'RESOLVED') return { ok: false, state, code: 'STEP_OUT_OF_ORDER', field: ORDER.find((f) => !present(sel[f]) && !(f === 'tier' && !state.tiers)) ?? null };
  const { mapping, version } = state.resolution;
  if (!mapping.objectiveKey) return { ok: false, state, code: 'BLOCKED', field: 'subject', detail: 'NOT_IN_CATALOGUE' };
  if ((ctx.isObjectiveExposed ?? (() => true))(mapping.objectiveKey) === false) return { ok: false, state, code: 'BLOCKED', field: 'subject', detail: 'NOT_EXPOSED' };
  const freeze: CambridgePreparationFreeze = {
    schema: 'cambridge-preparation-freeze/v1',
    qualification: PROGRAMME_LABELS[sel.programme as CambridgeProgramme].en,
    programme: sel.programme as CambridgeProgramme,
    subject: sel.subject as SchoolSubject,
    tier: (state.tiers ? sel.tier : null) as CambridgeTier | null,
    route: mapping.route,
    examYear: sel.examYear as number,
    examSeries: sel.examSeries as CambridgeSeries,
    syllabusCode: mapping.syllabusCode,
    syllabusVersion: version.version,
    syllabusVersionSourceKeys: [...version.sourceKeys],
    preparationStartDate: today(ctx.now),
    objectiveKey: mapping.objectiveKey,
    governance: { mapVersion: CAMBRIDGE_SCHOOL_MAP_VERSION, sessionsVersion: PROGRAMME_SESSIONS_VERSION, decisionIds: [...CAMBRIDGE_SCHOOL_DECISION_IDS] },
    seriesChanges: [],
  };
  assertFreezeInvariants(freeze);
  return { ok: true, freeze, mapping, state };
}

/** Governance invariants of a frozen preparation (throws: a violation is a defect, never a user error). */
export function assertFreezeInvariants(f: CambridgePreparationFreeze): void {
  if (f.programme === 'IGCSE' && f.subject === 'ESL' && (f.syllabusCode !== '0510' || f.route !== 'SPEAKING_ENDORSEMENT')) throw new Error('governance: IGCSE ESL is 0510 Speaking Endorsement (never 0511)');
  if (f.syllabusCode === '0511') throw new Error('governance: 0511 is never used');
  for (const k of ['qualification', 'subject', 'examYear', 'examSeries', 'syllabusCode', 'syllabusVersion', 'preparationStartDate'] as const) if (!present(f[k])) throw new Error(`governance: frozen field ${k} missing`);
}

export function parseFreeze(v: unknown): CambridgePreparationFreeze | null {
  const f = v as CambridgePreparationFreeze | null;
  return f && typeof f === 'object' && f.schema === 'cambridge-preparation-freeze/v1' ? { ...f, seriesChanges: Array.isArray(f.seriesChanges) ? f.seriesChanges : [] } : null;
}

// ---------------------------------------------------------------- calendar

export interface PreparationCalendar {
  startDate: string;
  targetSeries: CambridgeSeries;
  targetYear: number;
  /** YYYY-MM of the series name: month precision, never an official sitting date. */
  targetMonth: string;
  precision: 'MONTH';
  official: false;
  /** Whole weeks from the start date to the first day of the series month (0 when already there). */
  weeksAvailable: number;
}

export function preparationCalendar(f: Pick<CambridgePreparationFreeze, 'preparationStartDate' | 'examSeries' | 'examYear'>): PreparationCalendar {
  const month = SERIES_MONTH[f.examSeries];
  const target = Date.UTC(f.examYear, month - 1, 1);
  const start = Date.parse(`${f.preparationStartDate}T00:00:00Z`);
  const weeks = Math.max(0, Math.floor((target - start) / (7 * 86_400_000)));
  return { startDate: f.preparationStartDate, targetSeries: f.examSeries, targetYear: f.examYear, targetMonth: `${f.examYear}-${String(month).padStart(2, '0')}`, precision: 'MONTH', official: false, weeksAvailable: weeks };
}

// ---------------------------------------------------------------- series change

export interface SeriesChangeRequest {
  examSeries: string;
  examYear: number;
  /** Explicit user confirmation -- a change is never applied without it. */
  confirmed: boolean;
  actor: SeriesChangeRecord['actor'];
  actorId?: string | null;
  reason?: string | null;
  syllabusChoice?: string | null;
}

export type SeriesChangeErrorCode = 'CONFIRMATION_REQUIRED' | 'NO_CHANGE' | 'INVALID_EXAM_YEAR' | 'INVALID_EXAM_SERIES' | 'VERSION_NOT_GOVERNED' | 'SYLLABUS_CHOICE_REQUIRED' | 'UNKNOWN_MAPPING';
export type SeriesChangePlan =
  | { ok: true; freeze: CambridgePreparationFreeze; record: SeriesChangeRecord }
  | { ok: false; code: SeriesChangeErrorCode; detail?: string };

/** The series / year a frozen preparation may move to (same subject, tier and code; version re-resolved per year). */
export function seriesChangeOptions(f: CambridgePreparationFreeze, ctx: FlowContext): Array<{ examSeries: CambridgeSeries; examYear: number; versionGoverned: boolean }> {
  const entry = schoolSubjectEntry(f.programme, f.subject, ctxMap(ctx));
  if (!entry) return [];
  const ms = mappingsFor(entry, f.tier).filter((m) => m.syllabusCode === f.syllabusCode);
  const out: Array<{ examSeries: CambridgeSeries; examYear: number; versionGoverned: boolean }> = [];
  const nowYear = ctx.now.getUTCFullYear();
  for (let y = nowYear; y < nowYear + YEAR_HORIZON; y++) {
    const governed = ms.some((m) => versionsFor(m, y).length > 0);
    for (const s of [...new Set(ms.flatMap((m) => seriesFor(entry, m, y, ctx)))]) out.push({ examSeries: s, examYear: y, versionGoverned: governed });
  }
  return out.sort((a, b) => a.examYear - b.examYear || SERIES_MONTH[a.examSeries] - SERIES_MONTH[b.examSeries]);
}

/**
 * Plans an explicit series change (pure). Keeps qualification, subject, tier, syllabus code and start date;
 * updates the target (series / year / version for that year), appends the audit record and recomputes the calendar.
 */
export function planSeriesChange(f: CambridgePreparationFreeze, req: SeriesChangeRequest, ctx: FlowContext): SeriesChangePlan {
  if (!req.confirmed) return { ok: false, code: 'CONFIRMATION_REQUIRED' };
  if (req.examSeries === f.examSeries && req.examYear === f.examYear) return { ok: false, code: 'NO_CHANGE' };
  const entry = schoolSubjectEntry(f.programme, f.subject, ctxMap(ctx));
  if (!entry) return { ok: false, code: 'UNKNOWN_MAPPING' };
  const options = seriesChangeOptions(f, ctx);
  if (!options.some((o) => o.examYear === req.examYear)) return { ok: false, code: 'INVALID_EXAM_YEAR' };
  if (!options.some((o) => o.examYear === req.examYear && o.examSeries === req.examSeries)) return { ok: false, code: 'INVALID_EXAM_SERIES' };
  const sameCode: SchoolSubjectEntry = { ...entry, mappings: entry.mappings.filter((m) => m.syllabusCode === f.syllabusCode) };
  const r = resolveSyllabus(sameCode, f.tier, req.examYear, req.syllabusChoice);
  if (r.status === 'BLOCKED') return { ok: false, code: 'VERSION_NOT_GOVERNED', detail: r.blockers[0]?.detail };
  if (r.status === 'CHOICE_REQUIRED') return { ok: false, code: 'SYLLABUS_CHOICE_REQUIRED', detail: r.choices.map((c) => c.key).join(',') };
  const next: CambridgePreparationFreeze = { ...f, examSeries: req.examSeries as CambridgeSeries, examYear: req.examYear, syllabusVersion: r.version.version, syllabusVersionSourceKeys: [...r.version.sourceKeys] };
  const record: SeriesChangeRecord = {
    at: ctx.now.toISOString(),
    actor: req.actor,
    actorId: req.actorId ?? null,
    from: { examSeries: f.examSeries, examYear: f.examYear, syllabusVersion: f.syllabusVersion },
    to: { examSeries: next.examSeries, examYear: next.examYear, syllabusVersion: next.syllabusVersion },
    reason: req.reason ?? null,
    evidencePreserved: true,
    calendarRecomputed: { before: preparationCalendar(f), after: preparationCalendar(next) },
  };
  next.seriesChanges = [...f.seriesChanges, record];
  assertFreezeInvariants(next);
  return { ok: true, freeze: next, record };
}
