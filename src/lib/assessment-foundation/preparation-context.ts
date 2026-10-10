/**
 * B1 -- PreparationContext: the canonical READ contract of "what is this Student preparing for", projected
 * from the existing exam target record (`student_exam_profiles`). It is a projection, not an entity: there
 * is no PreparationProfile.
 *
 * Every field says whether the record actually states it. Nothing is inferred from a display name:
 *   - the intended session comes from `target_exam_series` + `target_exam_year` only (T1 final delta). The
 *     Journey's `official_session_key` is an official-session reference and is never read as the intention.
 *   - level / subject / programme come from the governed objective's context (framework words), when the
 *     target is objective-first.
 *   - paper / component is not recorded on a target today: UNKNOWN, never guessed.
 *
 * Owner: Student Preparation Context. It does not define exam structure and holds no learner state.
 */
import type { StudentExamProfile, PreparationGoal } from '@/lib/assessment/types';
import type { CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import { known, knownOrUnknown, UNKNOWN, type Known } from './known';

export const PREPARATION_CONTEXT_VERSION = 1 as const;

/** What `resolveExamProfiles` (learning-plan/exam-profile-resolution) already resolves for a target. */
export interface ExamTargetResolution {
  definitionIds: string[];
  versionIds: string[];
  academicSubjectIds: string[];
  source: 'DEFINITION' | 'OBJECTIVE' | 'NONE';
  mappingStatus: 'MAPPED' | 'MAPPING_NOT_AVAILABLE';
}

export interface PreparationContext {
  v: typeof PREPARATION_CONTEXT_VERSION;
  /** `student_exam_profiles.id` -- the exam target. */
  examTargetId: string;
  studentId: string;
  status: string;
  /** The governed catalogue objective (identity: its key), when the target is objective-first. */
  objective: { key: string; framework: string | null } | null;
  exam: {
    /** Definitions / versions the target resolves to (an objective may bind several). */
    definitionIds: string[];
    versionIds: string[];
    /** The version pinned on the record, when one is. */
    pinnedVersionId: string | null;
    mappingStatus: 'MAPPED' | 'MAPPING_NOT_AVAILABLE';
  };
  programme: Known<string>;
  /** Free text the Student entered; not an identity. */
  qualification: Known<{ label: string; source: 'STUDENT_FREE_TEXT' }>;
  subject: Known<{ label: string }>;
  /** Catalogue subjects the target resolves to (the explicit link to the curriculum). */
  academicSubjectIds: string[];
  level: Known<string>;
  syllabusCode: Known<string>;
  /** Not recorded on an exam target today. */
  component: Known<{ assessmentComponentId: string }>;
  /** The series the Student intends to sit (canonical identifiers), never an official session record. */
  intendedSession: Known<{ series: string; year: number }>;
  targetDate: Known<{ date: string; source: 'STUDENT_ENTERED' }>;
  targetResult: Known<{ goalType: string; value: string }>;
  /** Published structure versions of those catalogue subjects (by reference). */
  curriculumScopes: CurriculumScopeRef[];
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const RESULT_GOALS = new Set(['TARGET_GRADE', 'TARGET_SCORE']);

export function projectPreparationContext(
  profile: StudentExamProfile,
  resolution: ExamTargetResolution | null,
  goals: readonly PreparationGoal[] = [],
  curriculumScopes: readonly CurriculumScopeRef[] = []
): PreparationContext {
  const ctx = (profile.objectiveContext ?? {}) as Record<string, unknown>;
  const goal = goals.find((g) => RESULT_GOALS.has(String(g.goalType)) && text(g.targetValue));
  const series = text(profile.targetExamSeries);
  const year = typeof profile.targetExamYear === 'number' ? profile.targetExamYear : null;
  // The driver may hand a DATE column back as a Date; the contract carries a calendar day.
  const rawDate: unknown = profile.examDate;
  const date = text(rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : rawDate);
  return {
    v: PREPARATION_CONTEXT_VERSION,
    examTargetId: profile.id,
    studentId: profile.studentId,
    status: profile.status,
    objective: profile.objectiveKey ? { key: profile.objectiveKey, framework: profile.objectiveFramework ?? null } : null,
    exam: {
      definitionIds: resolution?.definitionIds ?? (profile.examDefinitionId ? [profile.examDefinitionId] : []),
      versionIds: resolution?.versionIds ?? (profile.examVersionId ? [profile.examVersionId] : []),
      pinnedVersionId: profile.examVersionId ?? null,
      mappingStatus: resolution?.mappingStatus ?? (profile.examDefinitionId ? 'MAPPED' : 'MAPPING_NOT_AVAILABLE'),
    },
    programme: knownOrUnknown(text(ctx.programme) ?? text(profile.programmeContext)),
    qualification: text(profile.targetQualification) ? known({ label: text(profile.targetQualification)!, source: 'STUDENT_FREE_TEXT' as const }) : UNKNOWN,
    subject: text(ctx.subject) ?? text(profile.subjectFocus) ? known({ label: (text(ctx.subject) ?? text(profile.subjectFocus))! }) : UNKNOWN,
    academicSubjectIds: [...new Set(resolution?.academicSubjectIds ?? [])],
    level: knownOrUnknown(text(ctx.level)),
    syllabusCode: knownOrUnknown(text(ctx.syllabusCode)),
    component: UNKNOWN,
    intendedSession: series && year !== null ? known({ series, year }) : UNKNOWN,
    targetDate: date ? known({ date, source: 'STUDENT_ENTERED' as const }) : UNKNOWN,
    targetResult: goal ? known({ goalType: String(goal.goalType), value: text(goal.targetValue)! }) : UNKNOWN,
    curriculumScopes: [...curriculumScopes],
  };
}

/** A target an assessment may be planned against: active, and bound to at least one exam version. */
export function isPlannablePreparation(p: PreparationContext): boolean {
  return p.status === 'ACTIVE' && p.exam.mappingStatus === 'MAPPED' && p.exam.versionIds.length > 0;
}
