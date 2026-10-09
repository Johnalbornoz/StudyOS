import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { onboardingRouteRedirect } from '@/lib/lx/first-destination';
import { VALID_EXAM_TARGET_PREDICATE } from '@/lib/student/onboarding-gate';
import { resolveWorkspaceEntry } from '@/lib/identity/workspace-entry';
import { loadSubjectPickerData } from '@/lib/experience/subject-picker.server';
import { PageIntro } from '@/components/ui/PageIntro';
import SubjectPicker from '../../subjects/SubjectPicker';

/**
 * REM-T1-05 -- the "Learn a subject" journey's dedicated step: "Choose what
 * you want to learn", the Student's personalized subjects first (REM-T1-04),
 * the full catalog one action away. Back returns to the journey choice.
 * Same bounce as the journey choice: a Student who already has a subject or
 * an exam goal is never trapped here.
 */
export default async function OnboardingLearnPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const entry = await resolveWorkspaceEntry(clerkUserId);
  if (entry.kind === 'REDIRECT') redirect(entry.to);

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const tr = getMessages(locale) as Record<string, string>;

  const subjectRes = await query(`SELECT 1 FROM subjects WHERE student_id = $1 LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  const goalRes = await query(`SELECT 1 FROM student_exam_profiles WHERE student_id = $1 AND ${VALID_EXAM_TARGET_PREDICATE} LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  const bounce = onboardingRouteRedirect({ hasSubject: subjectRes.rows.length > 0, hasExamGoal: goalRes.rows.length > 0, hasInstitutionalPath: false });
  if (bounce) redirect(bounce);

  const picker = await loadSubjectPickerData(studentId, locale);
  return (
    <div className="xp-page">
      <Link href="/dashboard/onboarding" className="btn btn-ghost" data-back style={{ display: 'inline-flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}>
        <ArrowLeft size={16} strokeWidth={2} aria-hidden />
        <span>{tr['acp.onboarding.back']}</span>
      </Link>
      <PageIntro title={tr['acp.onboarding.learnTitle']} lead={tr['acp.onboarding.learnLead']} />
      <SubjectPicker
        locale={locale}
        suggestions={picker.suggestions}
        owned={picker.owned}
        requiresLevel={picker.context.requiresLevel}
        profileLabel={picker.profileLabel}
        knownLevels={picker.knownLevels}
      />
    </div>
  );
}
