import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { learningRunForStudent } from '@/lib/assessment-experience/assessment-experience.service';
import { TODAY_HREF } from '@/lib/assessment-experience/continuation';
import { AssessmentRunner } from './AssessmentRunner';

export const dynamic = 'force-dynamic';

/**
 * B5-R -- the active shell of a CANONICAL learning assessment: the frozen questions, in the frozen order.
 *
 * Only a session that carries a frozen assessment snapshot is served here; any other session belongs to the
 * existing runtime (404). There is no flag read: a canonical attempt that was started stays completable
 * through its own authority even if new starts are switched off.
 */
export default async function AssessmentRunPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(userId);
  const { sessionId } = await params;
  const loaded = await learningRunForStudent(studentId, sessionId);
  if (!loaded.ok) notFound();
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);

  if (loaded.status !== 'ACTIVE') {
    return (
      <div className="xp-page">
        <InlineAlert tone="info" title={t[loaded.status === 'EXPIRED' ? 'ax.run.expired' : 'ax.run.finished']} actions={<Link href={TODAY_HREF} className="btn btn-primary">{t['ax.cont.RETURN']}</Link>} />
      </div>
    );
  }
  const title = loaded.canonicalConceptIds.map((id) => loaded.conceptLabels[id]).filter(Boolean).join(' · ') || t['ax.setup.title'];
  return (
    <div className="xp-page">
      <AssessmentRunner sessionId={sessionId} locale={locale} title={title} run={loaded.run} questions={loaded.questions} conceptLabels={loaded.conceptLabels} savedAnswers={loaded.savedAnswers} />
    </div>
  );
}
