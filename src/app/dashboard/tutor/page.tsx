import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import TutorChat from './TutorChat';
import { isTutorEntryMode } from '@/lib/tutor/context-pack';
import { PageIntro } from '@/components/ui/PageIntro';

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ conceptId?: string; subjectId?: string; from?: string }>;
}) {
  const { conceptId, subjectId, from } = await searchParams;
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

  const subjectsResult = await query(
    `SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY name ASC`,
    [studentId]
  );
  const subjects = subjectsResult.rows.map((s: any) => ({ id: s.id, name: s.name }));

  return (
    <div>
      <PageIntro title={t['tutor.title']} lead={t['tutor.subtitle']} />
      {/* UX-5: ids from the URL are only lookup keys -- /api/tutor/context verifies ownership before any label is shown. */}
      <TutorChat
        studentId={studentId}
        locale={locale}
        subjects={subjects}
        conceptId={conceptId}
        subjectId={subjectId}
        entryMode={isTutorEntryMode(from) ? from : undefined}
      />
    </div>
  );
}
