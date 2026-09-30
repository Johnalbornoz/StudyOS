/**
 * UX-5 closure -- the data the subject picker needs, read server-side
 * for the signed-in Student only: their academic profile, their exam
 * objectives' subject focus, and their own subjects. Every read degrades
 * to "not used" on failure; the full catalog is always available.
 */
import { query } from '@/lib/db';
import type { Locale } from '@/lib/i18n/messages';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { deriveSubjectAcademicContext, type SubjectAcademicContext } from '@/lib/student/subject-academic-context';
import { suggestSubjects, type SubjectSuggestion } from './subject-catalog';

export interface SubjectPickerData {
  suggestions: SubjectSuggestion[];
  owned: { id: string; name: string }[];
  context: SubjectAcademicContext;
  /** Display-only, from the profile (e.g. "IB DP · DP2" or "10°"). Null when the profile has no level. */
  profileLabel: string | null;
}

export async function loadSubjectPickerData(studentId: string, locale: Locale): Promise<SubjectPickerData> {
  const [profile, exams, owned] = await Promise.all([
    getAcademicProfile(studentId).catch(() => null),
    listStudentExamProfiles(studentId).catch(() => []),
    query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status != 'archived' ORDER BY name`, [studentId])
      .then((r) => r.rows as { id: string; name: string }[])
      .catch(() => []),
  ]);
  const suggestions = suggestSubjects({
    profile: profile
      ? { curriculumType: profile.curriculumType, ibProgramme: profile.ibProgramme, ibYear: profile.ibYear, schoolYear: profile.schoolYear }
      : null,
    locale,
    examSubjectFocus: exams.filter((e) => e.status !== 'ARCHIVED').map((e) => e.subjectFocus ?? null),
    ownedSubjectNames: owned.map((o) => o.name),
  });
  const context = deriveSubjectAcademicContext(profile);
  const profileLabel =
    context.programme !== 'none' ? `IB ${context.programme}${context.year ? ` · ${context.year}` : ''}` : profile?.schoolYear ?? null;
  return { suggestions, owned, context, profileLabel };
}
