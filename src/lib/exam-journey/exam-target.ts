/**
 * Student Exam Journey -- J3.1 EXAM TARGET contract and J3.2 session / date model (pure).
 *
 * Design: docs/journey/J3_INDEPENDENT_EXAM_ENTRY_DESIGN.md (J3-C, J3-D, J3-E).
 *
 *   - An Exam Target may be a Student's FIRST academic object: it needs no subject
 *     and creates none (O-05). Question Bank availability never decides whether a
 *     target can exist (CONTENT_UNAVAILABLE is reported by the journey, not here).
 *   - Official Session (a fact of the exam / institution) and Personal Target Date
 *     (the Student's planning date) are different fields and never convert into one
 *     another. A Student's estimated month is never turned into a day.
 *   - Results keep their O-06 provenance; only a verified result is verified, and
 *     no result feeds prediction / scoring yet (no approved contract).
 *   - A target result exists only when the Blueprint Outcome Specification DECLARES
 *     the final outcome kind; otherwise it is UNAVAILABLE -- never defaulted.
 * Pure: no DB, no clock.
 */
import type { ResultProvenance } from './types';
import { VERIFIED_RESULT_PROVENANCES } from './types';

// ------------------------------------------------------------------ schedule (J3-D)

export type OfficialSessionSource = 'INSTITUTION_ASSIGNED' | 'STUDENT_SELECTED';
/** Priority order (1 = strongest). STUDENT_REPORTED_EXAM_DATE is the legacy `exam_date` (typed by the Student, never official). */
export const TARGET_DATE_SOURCES = [
  'INSTITUTION_ASSIGNED_SESSION',
  'STUDENT_SELECTED_OFFICIAL_SESSION',
  'AUTHORITATIVE_EXAM_DATE',
  'STUDENT_REPORTED_EXAM_DATE',
  'PERSONAL_TARGET_DATE',
  'ESTIMATED_MONTH',
  'UNKNOWN',
] as const;
export type TargetDateSource = (typeof TARGET_DATE_SOURCES)[number];
export type AuthoritativeDateProvenance = 'OFFICIAL_PUBLIC' | 'OFFICIAL_LICENSED' | 'INSTITUTION_SUPPLIED';

export interface TargetScheduleFacts {
  /** A Blueprint ExamSessionV2 reference. Its dates may be UNKNOWN (no session data is loaded today). */
  officialSession: { sessionKey: string; label: string | null; source: OfficialSessionSource; startDate: string | null; authoritative: boolean } | null;
  /** A sitting date from an authoritative source (official calendar / institution). */
  authoritativeExamDate: { date: string; provenance: AuthoritativeDateProvenance } | null;
  /** Legacy `student_exam_profiles.exam_date`: the exam date as the Student typed it. */
  studentReportedExamDate: string | null;
  /** The Student's own planning deadline ("quiero estar listo el 15 de abril"). */
  personalTargetDate: string | null;
  /** The Student's estimate, month precision only (YYYY-MM). */
  estimatedMonth: string | null;
}

export interface ResolvedDate {
  /** YYYY-MM-DD for DAY precision, YYYY-MM for MONTH precision. */
  value: string;
  precision: 'DAY' | 'MONTH';
  source: TargetDateSource;
  /** True only for an authoritative official session date or an authoritative exam date. */
  official: boolean;
}

export interface TargetSchedule {
  officialSession: NonNullable<TargetScheduleFacts['officialSession']> | 'UNKNOWN';
  /** The headline date by the approved priority (1..6). */
  targetDate: ResolvedDate | null;
  targetDateSource: TargetDateSource;
  /** When the exam is sat (sitting-dependent states). DAY precision only. */
  sittingDate: ResolvedDate | null;
  /** What preparation is paced against: the earlier of the sitting and the personal date; else the month estimate. */
  planningDate: ResolvedDate | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function resolveTargetSchedule(f: TargetScheduleFacts): TargetSchedule {
  const s = f.officialSession;
  const sessionDate = (src: OfficialSessionSource): ResolvedDate | null =>
    s && s.source === src && s.startDate && DAY.test(s.startDate) ? { value: s.startDate, precision: 'DAY', source: src === 'INSTITUTION_ASSIGNED' ? 'INSTITUTION_ASSIGNED_SESSION' : 'STUDENT_SELECTED_OFFICIAL_SESSION', official: s.authoritative } : null;
  const candidates: Array<ResolvedDate | null> = [
    sessionDate('INSTITUTION_ASSIGNED'),
    sessionDate('STUDENT_SELECTED'),
    f.authoritativeExamDate && DAY.test(f.authoritativeExamDate.date) ? { value: f.authoritativeExamDate.date, precision: 'DAY', source: 'AUTHORITATIVE_EXAM_DATE', official: true } : null,
    f.studentReportedExamDate && DAY.test(f.studentReportedExamDate) ? { value: f.studentReportedExamDate, precision: 'DAY', source: 'STUDENT_REPORTED_EXAM_DATE', official: false } : null,
    f.personalTargetDate && DAY.test(f.personalTargetDate) ? { value: f.personalTargetDate, precision: 'DAY', source: 'PERSONAL_TARGET_DATE', official: false } : null,
    f.estimatedMonth && MONTH.test(f.estimatedMonth) ? { value: f.estimatedMonth, precision: 'MONTH', source: 'ESTIMATED_MONTH', official: false } : null,
  ];
  const targetDate = candidates.find((c) => c !== null) ?? null;
  // The sitting: first of the exam-date sources (session / authoritative / Student-reported), never the personal date.
  const sittingDate = candidates.slice(0, 4).find((c) => c !== null) ?? null;
  const personal = candidates[4];
  const dayDates = [sittingDate, personal].filter((d): d is ResolvedDate => d !== null).sort((a, b) => a.value.localeCompare(b.value));
  const planningDate = dayDates[0] ?? candidates[5] ?? null;
  return { officialSession: s ?? 'UNKNOWN', targetDate, targetDateSource: targetDate?.source ?? 'UNKNOWN', sittingDate, planningDate };
}

export interface ScheduleIssue {
  code: 'MALFORMED_DATE' | 'MALFORMED_MONTH' | 'PERSONAL_DATE_AFTER_SITTING' | 'ESTIMATE_WITH_EXACT_DATE';
  field: keyof TargetScheduleFacts;
}

/** Input checks for the (future) scheduling write path. Nothing here fixes a value -- it refuses. */
export function validateTargetSchedule(f: TargetScheduleFacts): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (f.personalTargetDate && !DAY.test(f.personalTargetDate)) issues.push({ code: 'MALFORMED_DATE', field: 'personalTargetDate' });
  if (f.studentReportedExamDate && !DAY.test(f.studentReportedExamDate)) issues.push({ code: 'MALFORMED_DATE', field: 'studentReportedExamDate' });
  if (f.estimatedMonth && !MONTH.test(f.estimatedMonth)) issues.push({ code: 'MALFORMED_MONTH', field: 'estimatedMonth' });
  const sitting = resolveTargetSchedule(f).sittingDate;
  if (f.personalTargetDate && sitting && f.personalTargetDate > sitting.value) issues.push({ code: 'PERSONAL_DATE_AFTER_SITTING', field: 'personalTargetDate' });
  if (f.estimatedMonth && (sitting || f.personalTargetDate)) issues.push({ code: 'ESTIMATE_WITH_EXACT_DATE', field: 'estimatedMonth' });
  return issues;
}

// ------------------------------------------------------------------ results (J3-E, O-06)

export interface ExamResultRecord {
  kind: 'PREVIOUS' | 'ACTUAL';
  /** A Blueprint OutcomeKind when the outcome is declared; UNSTRUCTURED otherwise (free text, never computed). */
  outcomeKind: string | 'UNSTRUCTURED';
  value: string;
  scaleKey: string | null;
  sessionLabel: string | null;
  provenance: ResultProvenance;
}

export interface DescribedResult extends ExamResultRecord {
  verified: boolean;
  /** Presentation key: never "official" unless verified. */
  label: 'STUDENT_REPORTED_RESULT' | 'INSTITUTION_REPORTED_RESULT' | 'VERIFIED_RESULT';
  /** No result enters prediction / scoring until a contract is approved. */
  usableForPrediction: false;
}

export function describeExamResult(r: ExamResultRecord): DescribedResult {
  const verified = VERIFIED_RESULT_PROVENANCES.includes(r.provenance);
  return {
    ...r,
    verified,
    label: verified ? 'VERIFIED_RESULT' : r.provenance === 'INSTITUTION_REPORTED' ? 'INSTITUTION_REPORTED_RESULT' : 'STUDENT_REPORTED_RESULT',
    usableForPrediction: false,
  };
}

// ------------------------------------------------------------------ target result capability (J3-E)

/**
 * The part of a Blueprint OutcomeSpecificationV2 (BP-1) this contract consumes. Structural on purpose:
 * BP-1 lives on another branch and no outcome data is loaded anywhere yet.
 */
export interface OutcomeSpecificationLike {
  finalOutcome: { status: 'DECLARED'; layer: string; kind: string } | { status: 'UNKNOWN'; reason: string };
  reported: Array<{ kind: string; scaleKey: string | null; status: 'DECLARED' | 'UNKNOWN'; final: boolean }>;
}

export type TargetResultCapability =
  | { available: true; outcomeKind: string; scaleKey: string }
  | { available: false; reason: 'OUTCOME_SPECIFICATION_UNAVAILABLE' | 'FINAL_OUTCOME_UNKNOWN' | 'OUTCOME_SCALE_UNKNOWN' };

export function targetResultCapability(spec: OutcomeSpecificationLike | null): TargetResultCapability {
  if (!spec) return { available: false, reason: 'OUTCOME_SPECIFICATION_UNAVAILABLE' };
  if (spec.finalOutcome.status !== 'DECLARED') return { available: false, reason: 'FINAL_OUTCOME_UNKNOWN' };
  const kind = spec.finalOutcome.kind;
  const declared = spec.reported.find((o) => o.final && o.status === 'DECLARED' && o.kind === kind);
  if (!declared?.scaleKey) return { available: false, reason: 'OUTCOME_SCALE_UNKNOWN' };
  return { available: true, outcomeKind: kind, scaleKey: declared.scaleKey };
}

// ------------------------------------------------------------------ the Exam Target (J3-C)

export type FieldProvenance = 'INSTITUTION_ASSIGNED' | 'STUDENT_ENTERED' | 'STUDENT_CONFIRMED' | 'OFFICIAL_SESSION' | 'SYSTEM_DERIVED';

export interface ExamTarget {
  examTargetId: string;
  examDefinition: { objectiveKey: string | null; examDefinitionId: string | null; framework: string | null; kind: string | null };
  /** BP-1 specification key: UNKNOWN until the Blueprint resolves it. */
  specification: { key: string | null; status: 'RESOLVED' | 'UNKNOWN' };
  subjectOrDomain: { key: string; label: string } | null;
  level: string | null;
  schedule: TargetSchedule;
  previousResults: DescribedResult[];
  targetResult: { status: 'UNAVAILABLE'; reason: Extract<TargetResultCapability, { available: false }>['reason'] } | { status: 'NOT_SET'; outcomeKind: string; scaleKey: string } | { status: 'SET'; outcomeKind: string; scaleKey: string; value: string };
  institutionalRelationship: { kind: 'NONE' | 'CLASS_ASSIGNED' | 'TEACHER_ASSIGNED'; classId?: string };
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  provenance: Partial<Record<'exam' | 'officialSession' | 'examDate' | 'personalTargetDate' | 'estimatedMonth', FieldProvenance>>;
}

/** The persisted row this contract reads (student_exam_profiles, as JSON: columns absent on an older schema read as undefined). */
export interface ExamTargetRow {
  id: string;
  objective_key?: string | null;
  objective_framework?: string | null;
  exam_definition_id?: string | null;
  exam_date?: string | null;
  status?: string | null;
  source?: string | null;
  official_session_key?: string | null;
  official_session_source?: string | null;
  authoritative_exam_date?: string | null;
  authoritative_exam_date_provenance?: string | null;
  personal_target_date?: string | null;
  estimated_exam_month?: string | null;
  field_provenance?: Record<string, string> | null;
}

export function scheduleFactsFromRow(row: ExamTargetRow): TargetScheduleFacts {
  const sessionSource = row.official_session_source === 'INSTITUTION_ASSIGNED' || row.official_session_source === 'STUDENT_SELECTED' ? row.official_session_source : null;
  const authProv = row.authoritative_exam_date_provenance;
  return {
    // No session catalogue is loaded: a stored session key carries no dates and no authority yet.
    officialSession: row.official_session_key && sessionSource ? { sessionKey: row.official_session_key, label: null, source: sessionSource, startDate: null, authoritative: false } : null,
    authoritativeExamDate:
      row.authoritative_exam_date && (authProv === 'OFFICIAL_PUBLIC' || authProv === 'OFFICIAL_LICENSED' || authProv === 'INSTITUTION_SUPPLIED') ? { date: String(row.authoritative_exam_date).slice(0, 10), provenance: authProv } : null,
    studentReportedExamDate: row.exam_date ? String(row.exam_date).slice(0, 10) : null,
    personalTargetDate: row.personal_target_date ? String(row.personal_target_date).slice(0, 10) : null,
    estimatedMonth: row.estimated_exam_month ?? null,
  };
}

export function toExamTarget(
  row: ExamTargetRow,
  ctx: {
    objective: { key: string; framework: string; kind: string; subjectKey: string | null; subjectLabel: string | null; level: string | null } | null;
    assignedClassId: string | null;
    previousResults: ExamResultRecord[];
    outcome: OutcomeSpecificationLike | null;
    storedTargetResult: { value: string } | null;
  }
): ExamTarget {
  const schedule = resolveTargetSchedule(scheduleFactsFromRow(row));
  const cap = targetResultCapability(ctx.outcome);
  const fp = row.field_provenance ?? {};
  const asFp = (v: string | undefined, fallback: FieldProvenance): FieldProvenance =>
    v === 'INSTITUTION_ASSIGNED' || v === 'STUDENT_ENTERED' || v === 'STUDENT_CONFIRMED' || v === 'OFFICIAL_SESSION' || v === 'SYSTEM_DERIVED' ? v : fallback;
  const provenance: ExamTarget['provenance'] = { exam: row.source === 'INSTITUTION' ? 'INSTITUTION_ASSIGNED' : asFp(fp.exam, 'STUDENT_ENTERED') };
  // Legacy exam_date was only ever written by the Student's own API (create / PATCH): STUDENT_ENTERED.
  if (row.exam_date) provenance.examDate = asFp(fp.examDate, 'STUDENT_ENTERED');
  if (row.official_session_key) provenance.officialSession = row.official_session_source === 'INSTITUTION_ASSIGNED' ? 'INSTITUTION_ASSIGNED' : 'STUDENT_ENTERED';
  if (row.personal_target_date) provenance.personalTargetDate = 'STUDENT_ENTERED';
  if (row.estimated_exam_month) provenance.estimatedMonth = 'STUDENT_ENTERED';
  const status = row.status === 'PAUSED' || row.status === 'COMPLETED' || row.status === 'ARCHIVED' ? row.status : 'ACTIVE';
  return {
    examTargetId: row.id,
    examDefinition: { objectiveKey: row.objective_key ?? ctx.objective?.key ?? null, examDefinitionId: row.exam_definition_id ?? null, framework: ctx.objective?.framework ?? row.objective_framework ?? null, kind: ctx.objective?.kind ?? null },
    specification: { key: null, status: 'UNKNOWN' },
    subjectOrDomain: ctx.objective?.subjectKey ? { key: ctx.objective.subjectKey, label: ctx.objective.subjectLabel ?? ctx.objective.subjectKey } : null,
    level: ctx.objective?.level ?? null,
    schedule,
    previousResults: ctx.previousResults.filter((r) => r.kind === 'PREVIOUS').map(describeExamResult),
    targetResult: !cap.available ? { status: 'UNAVAILABLE', reason: cap.reason } : ctx.storedTargetResult ? { status: 'SET', outcomeKind: cap.outcomeKind, scaleKey: cap.scaleKey, value: ctx.storedTargetResult.value } : { status: 'NOT_SET', outcomeKind: cap.outcomeKind, scaleKey: cap.scaleKey },
    institutionalRelationship: ctx.assignedClassId ? { kind: 'CLASS_ASSIGNED', classId: ctx.assignedClassId } : { kind: 'NONE' },
    status,
    provenance,
  };
}
