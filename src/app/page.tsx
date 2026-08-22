import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { SITE_URL, buildLanguageAlternates, pickLocaleFromAcceptLanguage } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: {
    canonical: SITE_URL,
    languages: buildLanguageAlternates(),
  },
};

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  const headerList = await headers();
  const locale = pickLocaleFromAcceptLanguage(headerList.get('accept-language'));
  redirect(`/${locale}`);
}
