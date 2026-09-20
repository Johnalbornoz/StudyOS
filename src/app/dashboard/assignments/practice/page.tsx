import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { PageHeader } from '@/components/ui/PageHeader';
import { PracticeRunner } from './PracticeRunner';

/**
 * F14 Workstream B -- Assignment Practice runner (task section 5).
 * Deliberately a NEW, small, purpose-built page rather than an edit to
 * the existing, much larger, already-certified self-service
 * `/dashboard/quiz` page: that page's own generate-a-NEW-quiz flow
 * cannot be reused here without breaking `reconcileCompletionsForStudent`,
 * which watches the SPECIFIC `execution_reference` quizId the execution
 * service already created (see `/api/quizzes/session/[quizId]`, F14's
 * new thin read adapter). Grading/scoring is 100% delegated to the
 * real, unmodified `/api/quizzes/generate-and-take` submit branch --
 * this page never grades an answer itself.
 */
export default async function AssignmentPracticePage({ searchParams }: { searchParams: Promise<{ quizId?: string }> }) {
  const { quizId } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!quizId) redirect('/dashboard/assignments');

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title={t['assignments.practice.title']}
        breadcrumb={<Link href="/dashboard/assignments">{t['assignments.title']}</Link>}
      />
      <PracticeRunner
        quizId={quizId}
        studentId={studentId}
        labels={{
          loading: t['assignments.practice.loading'],
          loadError: t['assignments.practice.loadError'],
          submit: t['assignments.practice.submit'],
          submitting: t['assignments.practice.submitting'],
          submitError: t['assignments.practice.submitError'],
          resultsTitle: t['assignments.practice.resultsTitle'],
          score: t['assignments.practice.score'],
          alreadyCompleted: t['assignments.practice.alreadyCompleted'],
          backToAssignments: t['assignments.title'],
        }}
      />
    </div>
  );
}
