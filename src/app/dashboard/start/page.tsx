import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { resolveWorkspaceEntry } from '@/lib/identity/workspace-entry';
import { loadGateState } from '@/lib/student/onboarding-gate.server';
import { studentOnboardingStage } from '@/lib/student/onboarding-gate';
import { isStudentContextType } from '@/lib/student/student-context';
import StudentContextChoice from './StudentContextChoice';

/**
 * REM-T1-02 -- "What best describes your current situation?"
 *
 * The first Student decision, BEFORE any academic form: an Academic Student
 * continues to the academic profile (country, grade, programme, subjects,
 * time context); an Exam-prep Candidate goes straight to choosing their exam
 * (no school, grade or national curriculum is ever invented). The primary
 * role stays STUDENT either way.
 *
 * Reachable only while mandatory onboarding is incomplete; a Student who is
 * already set up is sent to Home (no later context-management capability is
 * exposed in this pass).
 */
export default async function StudentStartPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const entry = await resolveWorkspaceEntry(clerkUserId);
  if (entry.kind === 'REDIRECT') redirect(entry.to);

  const state = await loadGateState(clerkUserId).catch(() => null);
  if (state) {
    const stage = studentOnboardingStage(state.profile, state.subjectCount, state.examTargetCount ?? 0, 0, state.studentContextType ?? null);
    if (stage === 'READY') redirect('/dashboard/today');
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const tr = getMessages(locale) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith('acp.ctx.')));
  const current = state && isStudentContextType(state.studentContextType) ? state.studentContextType : null;

  return (
    <div className="acp-page">
      <div className="acp-intro">
        <h1>{tr['acp.ctx.title']}</h1>
        <p className="acp-lead">{tr['acp.ctx.lead']}</p>
      </div>
      <StudentContextChoice labels={labels} current={current} />
    </div>
  );
}
