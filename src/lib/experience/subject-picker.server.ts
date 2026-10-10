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
import { loadResolvedStudentContext } from '@/lib/student/student-context.server';
import { gradeDisplayLabel } from '@/lib/i18n/catalog-labels';

export interface SubjectPickerData {
  suggestions: SubjectSuggestion[];
  owned: { id: string; name: string }[];
  context: SubjectAcademicContext;
  /** Display-only, from the profile (e.g. "IB Diploma Programme · DP2" or "Grade 10"). Null when the profile has no level. */
  profileLabel: string | null;
  /** REM-T1-04: catalog key -> HL/SL already stated by the Academic Profile (the picker never asks again). */
  knownLevels: Record<string, 'HL' | 'SL'>;
}

export async function loadSubjectPickerData(studentId: string, locale: Locale): Promise<SubjectPickerData> {
  // REM-T1-04: the ONE resolved personal context (source of truth: the Academic Profile).
  const [profile, exams, owned, resolved] = await Promise.all([
    getAcademicProfile(studentId).catch(() => null),
    listStudentExamProfiles(studentId).catch(() => []),
    query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status != 'archived' ORDER BY name`, [studentId])
      .then((r) => r.rows as { id: string; name: string }[])
      .catch(() => []),
    loadResolvedStudentContext(studentId).catch(() => null),
  ]);
  const suggestions = suggestSubjects({
    // Micro-delta M05: only a COMPLETED Academic Profile (or a chosen programme) justifies profile-based subjects.
    profile: profile && (profile.profileCompleted || resolved?.programme)
      ? { curriculumType: profile.curriculumType, ibProgramme: profile.ibProgramme, ibYear: profile.ibYear, schoolYear: profile.schoolYear }
      : null,
    locale,
    examSubjectFocus: exams.filter((e) => e.status !== 'ARCHIVED').map((e) => e.subjectFocus ?? null),
    ownedSubjectNames: owned.map((o) => o.name),
    profileSubjects: resolved?.profileSubjects.map((p) => ({ catalogKey: p.catalogKey, label: p.label, level: p.level })) ?? [],
  });
  const context = deriveSubjectAcademicContext(profile);
  const profileLabel = resolved?.programme
    ? [resolved.programme.name, context.year].filter(Boolean).join(' · ')
    : context.programme !== 'none'
      ? `IB ${context.programme}${context.year ? ` · ${context.year}` : ''}`
      : profile?.schoolYear
        ? gradeDisplayLabel(profile.schoolYear, locale)
        : null;
  return { suggestions, owned, context, profileLabel, knownLevels: resolved?.knownLevels ?? {} };
}
