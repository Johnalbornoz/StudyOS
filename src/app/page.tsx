import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { SITE_URL, buildLanguageAlternates, pickLocaleFromAcceptLanguage } from '@/lib/seo';
import { getOrCreateStudentId } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolveFirstDestination } from '@/lib/lx/first-destination';

export const metadata: Metadata = {
  alternates: {
    canonical: SITE_URL,
    languages: buildLanguageAlternates(),
  },
};

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    // LX-2C: deterministic first destination -- a learner with product
    // setup goes to "what should I do now" (Today), never straight onto
    // the KPI-heavy Progress page; a learner with no subject yet goes to
    // onboarding. This is a routing decision only -- no mastery logic.
    let hasSubject = false;
    try {
      const studentId = await getOrCreateStudentId(userId);
      const res = await query(`SELECT 1 FROM subjects WHERE student_id = $1 LIMIT 1`, [studentId]);
      hasSubject = res.rows.length > 0;
    } catch {
      // fall through to onboarding on any read failure -- safe default
    }
    redirect(resolveFirstDestination({ hasSubject }).path);
  }

  const headerList = await headers();
  const locale = pickLocaleFromAcceptLanguage(headerList.get('accept-language'));
  redirect(`/${locale}`);
}
