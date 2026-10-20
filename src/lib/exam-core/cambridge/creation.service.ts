/**
 * CAMBRIDGE PILOT -- creation flow and series change, server side (DB).
 *
 *   cambridgeCreationState    the flow state for a partial selection (options of every step reached).
 *   createCambridgePreparation validates the full selection (creation-flow.ts), creates the objective preparation
 *                             through the existing service, and FREEZES the target in the existing jsonb
 *                             (student_exam_profiles.objective_context.cambridgeFreeze) + target_exam_series / year.
 *                             Idempotent: an existing preparation is returned unchanged (its frozen target is never
 *                             overwritten; a different series goes through the series change).
 *   changeCambridgeSeries     explicit, confirmed, audited series change: same preparation id (progress, attempts and
 *                             evidence stay attached), target updated, calendar recomputed, audit record appended
 *                             (freeze.seriesChanges + analytics event). Optimistic: refuses a concurrent change.
 * No migration: everything is stored in existing columns.
 */
import { db } from '@/lib/db';
import { track } from '@/lib/analytics';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import type { StudentExamProfile } from '@/lib/assessment/types';
import { JOSE_MAX_LEON_CHECKPOINT_ROUTE } from '../checkpoint/checkpoint-preparation';
import { objectiveByKey } from '../objectives/objective-catalog';
import { isObjectiveExposed } from '../student-exposure';
import { createObjectivePreparation, studentCountryOfStudy } from '../objectives/preparation.service';
import type { ExamPreparationCapabilities } from '../objectives/capabilities';
import {
  describeFlow, parseFreeze, planSeriesChange, preparationCalendar, seriesChangeOptions, validateCreation,
  type CambridgePreparationFreeze, type CambridgeSelection, type FlowContext, type FlowState, type PreparationCalendar, type SeriesChangeErrorCode,
} from './creation-flow';

/** Series the target_exam_series column accepts (migration 20261107_1000 CHECK). Others live in the freeze only. */
const COLUMN_SERIES = new Set(['MAY', 'NOVEMBER', 'MARCH', 'JUNE']);

export class CambridgeFlowError extends Error {
  constructor(public readonly code: string, public readonly field: string | null = null, public readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CambridgeFlowError';
  }
}

/**
 * The pilot's flow context. The Checkpoint route is the pilot school's (the only Cambridge school in the pilot);
 * exposure is the Student exposure policy (STUDENT_CATALOG_EXPOSURE).
 */
export async function cambridgeFlowContext(studentId: string, now: Date = new Date()): Promise<FlowContext> {
  return {
    now,
    country: await studentCountryOfStudy(studentId),
    checkpointRoute: JOSE_MAX_LEON_CHECKPOINT_ROUTE,
    isObjectiveExposed: (key) => {
      const o = objectiveByKey(key);
      return !!o && isObjectiveExposed(o);
    },
  };
}

export async function cambridgeCreationState(studentId: string, selection: CambridgeSelection, locale = 'es', now: Date = new Date()): Promise<FlowState> {
  return describeFlow(selection, await cambridgeFlowContext(studentId, now), locale);
}

async function writeFreeze(profileId: string, studentId: string, freeze: CambridgePreparationFreeze, expect?: { examSeries: string; examYear: number }): Promise<boolean> {
  const series = COLUMN_SERIES.has(freeze.examSeries) ? freeze.examSeries : null;
  const r = await db.query(
    `UPDATE student_exam_profiles
        SET objective_context = jsonb_set(COALESCE(objective_context, '{}'::jsonb), '{cambridgeFreeze}', $3::jsonb, true),
            target_exam_series = $4, target_exam_year = $5, updated_at = now()
      WHERE id = $1 AND student_id = $2 AND status <> 'ARCHIVED'
        AND ${expect ? `objective_context->'cambridgeFreeze'->>'examSeries' = $6 AND (objective_context->'cambridgeFreeze'->>'examYear')::int = $7` : `NOT (COALESCE(objective_context, '{}'::jsonb) ? 'cambridgeFreeze')`}`,
    expect ? [profileId, studentId, JSON.stringify(freeze), series, series ? freeze.examYear : null, expect.examSeries, expect.examYear] : [profileId, studentId, JSON.stringify(freeze), series, series ? freeze.examYear : null]
  );
  return (r.rowCount ?? 0) > 0;
}

export interface CambridgeCreationResult {
  profile: StudentExamProfile;
  created: boolean;
  freeze: CambridgePreparationFreeze;
  calendar: PreparationCalendar;
  capabilities: ExamPreparationCapabilities;
  /** The preparation existed with ANOTHER frozen series: use the series change (nothing was changed). */
  seriesDiffers: boolean;
}

export async function createCambridgePreparation(studentId: string, selection: CambridgeSelection & { timezone?: string }, now: Date = new Date()): Promise<CambridgeCreationResult> {
  const ctx = await cambridgeFlowContext(studentId, now);
  const v = validateCreation(selection, ctx);
  if (!v.ok) throw new CambridgeFlowError(v.code, v.field, v.detail);
  const { profile, created, capabilities } = await createObjectivePreparation(studentId, { objectiveKey: v.freeze.objectiveKey, timezone: selection.timezone, viaCambridgeFlow: true });
  const existing = parseFreeze(profile.objectiveContext?.cambridgeFreeze);
  let freeze = existing ?? v.freeze;
  if (!existing) {
    const wrote = await writeFreeze(profile.id, studentId, v.freeze);
    if (!wrote) {
      // A concurrent request froze it first: read back what is stored.
      freeze = parseFreeze((await getStudentExamProfile(profile.id))?.objectiveContext?.cambridgeFreeze) ?? v.freeze;
    } else {
      await track(studentId, 'cambridge_preparation_frozen', { profileId: profile.id, objectiveKey: freeze.objectiveKey, programme: freeze.programme, subject: freeze.subject, tier: freeze.tier, examSeries: freeze.examSeries, examYear: freeze.examYear, syllabusCode: freeze.syllabusCode, syllabusVersion: freeze.syllabusVersion });
    }
  }
  const seriesDiffers = freeze.examSeries !== v.freeze.examSeries || freeze.examYear !== v.freeze.examYear;
  return { profile: (await getStudentExamProfile(profile.id))!, created, freeze, calendar: preparationCalendar(freeze), capabilities, seriesDiffers };
}

export async function cambridgeSeriesChangeView(studentId: string, profileId: string, now: Date = new Date()) {
  const p = await getStudentExamProfile(profileId);
  if (!p || p.studentId !== studentId) throw new CambridgeFlowError('NOT_FOUND');
  const freeze = parseFreeze(p.objectiveContext?.cambridgeFreeze);
  if (!freeze) throw new CambridgeFlowError('NOT_FROZEN');
  return { freeze, calendar: preparationCalendar(freeze), options: seriesChangeOptions(freeze, await cambridgeFlowContext(studentId, now)) };
}

export async function changeCambridgeSeries(
  studentId: string,
  profileId: string,
  req: { examSeries: string; examYear: number; confirm: boolean; reason?: string | null; syllabusChoice?: string | null },
  now: Date = new Date()
): Promise<{ profile: StudentExamProfile; freeze: CambridgePreparationFreeze; calendar: PreparationCalendar }> {
  const p = await getStudentExamProfile(profileId);
  if (!p || p.studentId !== studentId) throw new CambridgeFlowError('NOT_FOUND');
  if (p.status === 'ARCHIVED') throw new CambridgeFlowError('NOT_ACTIVE');
  const freeze = parseFreeze(p.objectiveContext?.cambridgeFreeze);
  if (!freeze) throw new CambridgeFlowError('NOT_FROZEN');
  const plan = planSeriesChange(freeze, { examSeries: req.examSeries, examYear: req.examYear, confirmed: req.confirm === true, actor: 'STUDENT', actorId: studentId, reason: req.reason ?? null, syllabusChoice: req.syllabusChoice }, await cambridgeFlowContext(studentId, now));
  if (!plan.ok) throw new CambridgeFlowError(plan.code satisfies SeriesChangeErrorCode, 'examSeries', plan.detail);
  // Only the target moves: the preparation row (and every attempt / evidence keyed on it) is kept as is.
  const wrote = await writeFreeze(profileId, studentId, plan.freeze, { examSeries: freeze.examSeries, examYear: freeze.examYear });
  if (!wrote) throw new CambridgeFlowError('CONCURRENT_CHANGE');
  await track(studentId, 'cambridge_preparation_series_changed', { profileId, from: plan.record.from, to: plan.record.to, weeksBefore: plan.record.calendarRecomputed.before.weeksAvailable, weeksAfter: plan.record.calendarRecomputed.after.weeksAvailable });
  return { profile: (await getStudentExamProfile(profileId))!, freeze: plan.freeze, calendar: preparationCalendar(plan.freeze) };
}

/** HTTP status of a flow error. */
export function cambridgeFlowErrorStatus(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (['BLOCKED', 'CONCURRENT_CHANGE', 'NOT_ACTIVE', 'NOT_FROZEN', 'VERSION_NOT_GOVERNED', 'SYLLABUS_CHOICE_REQUIRED', 'CONFIRMATION_REQUIRED', 'NO_CHANGE'].includes(code)) return 409;
  return 400;
}
