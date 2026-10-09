/**
 * REM-T1-02 / REM-T1-04 -- the Student's PERSONAL context, resolved once and
 * consumed by every surface that claims "For you" / "Recommended for you" /
 * "Based on your profile" (onboarding, Learn subject picker, subject creation,
 * Exam Prep). Pure: the loader is student-context.server.ts.
 *
 * Context type (persisted on `students`, migration 20261106_1000):
 *   ACADEMIC  -- currently studying in a school / academic programme;
 *   EXAM_PREP -- preparing for a specific exam (the exam is the context).
 * Both are Students (the primary role never changes); both keep Learn and Exam Prep.
 *
 * The Academic Profile is the source of truth for the programme, its subjects
 * and each subject's exact variant/level ("Mathematics: analysis and
 * approaches · HL"). CLASS context is never merged in here: inside a class the
 * institution's curriculum governs that class; outside it, this personal
 * context is the default (see exam-core/eligibility/academic-context.ts).
 */
import { catalogSubjectByName } from '@/lib/experience/subject-catalog';

export type StudentContextType = 'ACADEMIC' | 'EXAM_PREP';
export const STUDENT_CONTEXT_TYPES: readonly StudentContextType[] = ['ACADEMIC', 'EXAM_PREP'];

export function isStudentContextType(v: unknown): v is StudentContextType {
  return v === 'ACADEMIC' || v === 'EXAM_PREP';
}

/**
 * The effective context type. A stored choice wins; an unset one defaults to ACADEMIC
 * for a Student with a COMPLETED academic profile (existing Students keep their behaviour)
 * and to EXAM_PREP for one whose only academic object is an exam target. null = not chosen.
 */
export function effectiveContextType(input: { stored: string | null | undefined; profileCompleted: boolean; examTargetCount: number }): StudentContextType | null {
  if (isStudentContextType(input.stored)) return input.stored;
  if (input.profileCompleted) return 'ACADEMIC';
  if (input.examTargetCount > 0) return 'EXAM_PREP';
  return null;
}

export type IbSubjectLevel = 'HL' | 'SL';

export interface ProfileSubjectInput {
  academicSubjectId: string;
  /** Catalogue (official) subject name, e.g. "Mathematics: analysis and approaches". */
  name: string;
  /** Catalogue level / variant, e.g. "HL", "SL", "Core", or null. */
  level: string | null;
  /** Name of the linked canonical subject, when the catalogue row has one. */
  canonicalName?: string | null;
}

export interface ResolvedProfileSubject {
  academicSubjectId: string;
  /** Official display label of the exact variant, e.g. "Mathematics: analysis and approaches · HL". */
  label: string;
  level: string | null;
  /** The learner-subject catalog key this profile subject corresponds to, or null when none does. */
  catalogKey: string | null;
}

/** The learner-subject catalog key for a catalogue subject: exact name, the name before ":", or its canonical subject. */
export function profileSubjectCatalogKey(s: Pick<ProfileSubjectInput, 'name' | 'canonicalName'>): string | null {
  const candidates = [s.name, s.name.split(':')[0], s.canonicalName ?? ''].map((x) => x.trim()).filter(Boolean);
  for (const c of candidates) {
    const hit = catalogSubjectByName(c);
    if (hit) return hit.key;
  }
  return null;
}

export function resolveProfileSubjects(subjects: readonly ProfileSubjectInput[]): ResolvedProfileSubject[] {
  return subjects.map((s) => ({
    academicSubjectId: s.academicSubjectId,
    label: s.level ? `${s.name} · ${s.level}` : s.name,
    level: s.level,
    catalogKey: profileSubjectCatalogKey(s),
  }));
}

/**
 * Catalog key -> the HL/SL level the profile ALREADY states. A key whose profile
 * subjects disagree (e.g. two Mathematics variants at different levels) is
 * ambiguous and therefore absent: the Student is asked, never guessed for.
 */
export function knownSubjectLevels(subjects: readonly ResolvedProfileSubject[]): Record<string, IbSubjectLevel> {
  const seen = new Map<string, Set<string>>();
  for (const s of subjects) {
    if (!s.catalogKey) continue;
    const set = seen.get(s.catalogKey) ?? new Set<string>();
    set.add((s.level ?? '').toUpperCase());
    seen.set(s.catalogKey, set);
  }
  const out: Record<string, IbSubjectLevel> = {};
  for (const [key, levels] of seen) {
    if (levels.size !== 1) continue;
    const [only] = [...levels];
    if (only === 'HL' || only === 'SL') out[key] = only;
  }
  return out;
}

export interface ResolvedStudentContext {
  contextType: StudentContextType | null;
  profileCompleted: boolean;
  programme: { id: string; name: string; authority: string | null } | null;
  qualification: string | null;
  profileSubjects: ResolvedProfileSubject[];
  knownLevels: Record<string, IbSubjectLevel>;
  /** Legacy profile fields kept for older readers (curriculum type, IB programme/year, grade). */
  legacy: { curriculumType: string | null; ibProgramme: string | null; ibYear: string | null; schoolYear: string | null; countryOfStudy: string | null };
}

/** Where each context continues right after the choice (its own profiling step). */
export function nextPathForContext(type: StudentContextType): string {
  return type === 'ACADEMIC' ? '/dashboard/profile' : '/dashboard/exam-prep?from=start';
}
