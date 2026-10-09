import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { loadSubjectPickerData } from '@/lib/experience/subject-picker.server';
import { PageIntro } from '@/components/ui/PageIntro';
import SubjectPicker from '../SubjectPicker';

/**
 * "Agregar materia" -- UX-5 closure: the Student SELECTS from the
 * controlled subject list (lib/experience/subject-catalog.ts); free text
 * never creates a subject. Same picker as first-run.
 */
export default async function NewSubjectPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);
  const picker = await loadSubjectPickerData(studentId, locale);

  return (
    <div className="xp-page">
      <PageIntro title={t['sp.addTitle']} lead={t['sp.lead']} />
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
