import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getAcademicProfile } from '@/services/academic-profile.service';
import AcademicProfileWizard from './AcademicProfileWizard';

export default async function AcademicProfilePage() {
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

  const profile = await getAcademicProfile(studentId);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['profile.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '62ch' }}>
          {t['profile.subtitle']}
        </p>
      </div>

      <AcademicProfileWizard
        t={t}
        initial={{
          countryOfStudy: profile?.countryOfStudy ?? null,
          schoolYear: profile?.schoolYear ?? null,
          curriculumType: profile?.curriculumType ?? null,
          ibProgramme: profile?.ibProgramme ?? null,
          ibYear: profile?.ibYear ?? null,
          academicYear: profile?.academicYear ?? null,
        }}
      />
    </div>
  );
}
