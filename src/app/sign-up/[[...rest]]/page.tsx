import { SignUp } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { headers } from 'next/headers';
import { pickLocaleFromAcceptLanguage } from '@/lib/seo';
import { getMessages } from '@/lib/i18n/messages';

/**
 * LX-2C -- registration framing. Clerk remains the sole authentication
 * authority: the `<SignUp />` component below is unmodified (no fields
 * added, no config invented). This page only wraps it with enough
 * StudyUS context that a visitor coming from the marketing site knows
 * what they are signing up for and what happens next.
 */
export default async function SignUpPage() {
  const headerList = await headers();
  const locale = pickLocaleFromAcceptLanguage(headerList.get('accept-language'));
  const t = getMessages(locale);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-6)',
        padding: 'var(--space-12) var(--space-4)',
      }}
    >
      <Link href={`/${locale}`} aria-label="StudyUS" style={{ display: 'inline-flex' }}>
        <Image src="/logo.png" alt="StudyUS" width={109} height={36} priority style={{ height: 36, width: 'auto' }} />
      </Link>

      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>{t['signup.framingTitle']}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
          {t['signup.framingBody']}
        </p>
      </div>

      <SignUp />

      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center' }}>
        {t['signup.next']}
      </p>
    </div>
  );
}
