import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import TutorChat from './TutorChat';

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ conceptId?: string }>;
}) {
  const { conceptId } = await searchParams;
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
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t['tutor.title']}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{t['tutor.subtitle']}</p>
      </div>
      <TutorChat studentId={studentId} locale={locale} subjects={subjects} conceptId={conceptId} />
    </div>
  );
}
