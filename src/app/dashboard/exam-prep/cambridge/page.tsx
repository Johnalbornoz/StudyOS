import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { PageIntro } from '@/components/ui/PageIntro';
import { cambridgeFlowLabels } from '@/lib/exam-core/cambridge/flow-labels';
import { cambridgeCreationState } from '@/lib/exam-core/cambridge/creation.service';
import { CambridgeCreationFlow } from './CambridgeCreationFlow';

/**
 * FD Cambridge §16 -- the Cambridge preparation creation flow:
 * programme / qualification -> subject -> tier -> exam year -> exam series -> create.
 * The first step's state is computed on the server; every later step asks the server (GET
 * /api/exam-preparation/cambridge), which is also the only authority on creation (POST).
 */
export default async function CambridgePreparationPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const l = cambridgeFlowLabels(locale);
  const initial = await cambridgeCreationState(studentId, {}, locale);
  return (
    <div className="xp-page">
      <PageIntro title={l.title} lead={l.lead} />
      <CambridgeCreationFlow initial={initial} labels={l} locale={locale} />
    </div>
  );
}
