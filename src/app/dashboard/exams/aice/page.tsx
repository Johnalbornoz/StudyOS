import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getPlanView } from '@/lib/exam-core/aice/plan.service';
import { PageIntro } from '@/components/ui/PageIntro';
import { AicePlanner } from './AicePlanner';

/**
 * Cambridge AICE Diploma -- "Preparar Cambridge AICE Diploma" / "Mi plan AICE
 * Diploma": the Student's own plan (Core + Groups 1-4), its progress against
 * the versioned Diploma policy, preparation per subject and recorded results.
 * Planning and readiness -- never an official Cambridge certification.
 */
export default async function AicePlanPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale) as Record<string, string>;
  const labels: Record<string, string> = Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith('aice.') || k === 'exv2.delete.no'));
  const view = await getPlanView(studentId);
  return (
    <div className="xp-page xp-page--wide">
      <PageIntro crumb={<Link href="/dashboard/exams">{t['exv2.page.title']}</Link>} title={t['aice.page.title']} lead={t['aice.page.lead']} />
      <AicePlanner view={view} labels={labels} />
    </div>
  );
}
