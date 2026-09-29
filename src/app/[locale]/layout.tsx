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
    <div className="lp-shell">
      <header className="mkt-header">
        <Link href={`/${locale}`} style={{ display: 'flex', alignItems: 'center' }}>
          <Image src="/logo.png" alt="StudyUS" width={112} height={37} priority style={{ height: 32, width: 'auto' }} />
        </Link>
        <nav className="mkt-nav">
          <Link href={`/${locale}/how-it-works`} className="mkt-navlink">
            {t['marketing.navHowItWorks']}
          </Link>
          <Link href="/sign-in" className="btn btn-secondary">{t['home.signIn']}</Link>
          <Link href="/sign-up" className="btn btn-primary">{t['home.signUp']}</Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <Image src="/logo.png" alt="StudyUS" width={91} height={30} style={{ height: 26, width: 'auto' }} />
          <span>{t['marketing.footerTagline']}</span>
        </div>
        <nav className="lp-footer-locales" aria-label={t['landing.languagesLabel']}>
          {LOCALES.map((l) => (
            <Link
              key={l}
              href={`/${l}`}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? 'page' : undefined}
              className={l === locale ? 'active' : undefined}
            >
              {LOCALE_NAMES[l]}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
