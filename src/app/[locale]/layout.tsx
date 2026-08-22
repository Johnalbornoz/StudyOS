import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { isSupportedLocale } from '@/lib/seo';
import { getMessages, LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/messages';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const t = getMessages(locale as Locale);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-5) var(--space-8)', borderBottom: '1px solid var(--border-default)',
        }}
      >
        <Link href={`/${locale}`} style={{ display: 'flex', alignItems: 'center' }}>
          <Image src="/logo.png" alt="StudyUS" width={112} height={37} priority style={{ height: 32, width: 'auto' }} />
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          <Link href={`/${locale}/how-it-works`} style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>
            {t['marketing.navHowItWorks']}
          </Link>
          <Link href="/sign-in" className="btn btn-secondary">{t['home.signIn']}</Link>
          <Link href="/sign-up" className="btn btn-primary">{t['home.signUp']}</Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer
        style={{
          borderTop: '1px solid var(--border-default)', padding: 'var(--space-6) var(--space-8)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          StudyUS — {t['marketing.footerTagline']}
        </span>
        <nav style={{ display: 'flex', gap: 'var(--space-4)' }}>
          {LOCALES.map((l) => (
            <Link
              key={l}
              href={`/${l}`}
              hrefLang={l}
              style={{ fontSize: 13, color: l === locale ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: l === locale ? 650 : 400 }}
            >
              {LOCALE_NAMES[l]}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
