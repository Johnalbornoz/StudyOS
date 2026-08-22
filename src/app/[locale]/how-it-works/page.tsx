import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMessages, LOCALES, type Locale } from '@/lib/i18n/messages';
import { SITE_URL, SITE_NAME, buildLanguageAlternates, isSupportedLocale } from '@/lib/seo';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const t = getMessages(locale as Locale);

  return {
    title: { absolute: t['howItWorks.seoTitle'] },
    description: t['howItWorks.seoDescription'],
    alternates: {
      canonical: `${SITE_URL}/${locale}/how-it-works`,
      languages: buildLanguageAlternates('/how-it-works'),
    },
    openGraph: {
      title: t['howItWorks.seoTitle'],
      description: t['howItWorks.seoDescription'],
      url: `${SITE_URL}/${locale}/how-it-works`,
      siteName: SITE_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t['howItWorks.seoTitle'],
      description: t['howItWorks.seoDescription'],
    },
  };
}

function Step({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <article style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-6) 0', borderBottom: '1px solid var(--border-default)' }}>
      <div
        aria-hidden
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-subtle)',
          color: 'var(--brand-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 16,
        }}
      >
        {index}
      </div>
      <div>
        <h2 style={{ fontSize: 20, marginBottom: 6 }}>{title}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15.5, lineHeight: 1.6, margin: 0 }}>{body}</p>
      </div>
    </article>
  );
}

export default async function HowItWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const t = getMessages(locale as Locale);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: t['howItWorks.h1'],
    description: t['howItWorks.seoDescription'],
    url: `${SITE_URL}/${locale}/how-it-works`,
    provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-16) var(--space-6)' }}>
        <h1 style={{ fontSize: 34, lineHeight: 1.2, marginBottom: 'var(--space-4)', textWrap: 'balance' }}>
          {t['howItWorks.h1']}
        </h1>
        <p style={{ fontSize: 17, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-10)' }}>
          {t['howItWorks.intro']}
        </p>

        <div>
          <Step index={1} title={t['howItWorks.step1Title']} body={t['howItWorks.step1Body']} />
          <Step index={2} title={t['howItWorks.step2Title']} body={t['howItWorks.step2Body']} />
          <Step index={3} title={t['howItWorks.step3Title']} body={t['howItWorks.step3Body']} />
          <Step index={4} title={t['howItWorks.step4Title']} body={t['howItWorks.step4Body']} />
        </div>

        <div style={{ marginTop: 'var(--space-10)', textAlign: 'center' }}>
          <Link href="/sign-up" className="btn btn-primary">{t['howItWorks.ctaPrimary']}</Link>
        </div>
      </div>
    </>
  );
}
