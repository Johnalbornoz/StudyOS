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
    title: { absolute: t['marketing.seoTitle'] },
    description: t['marketing.seoDescription'],
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages: buildLanguageAlternates(),
    },
    openGraph: {
      title: t['marketing.seoTitle'],
      description: t['marketing.seoDescription'],
      url: `${SITE_URL}/${locale}`,
      siteName: SITE_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t['marketing.seoTitle'],
      description: t['marketing.seoDescription'],
    },
  };
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section style={{ padding: 'var(--space-6)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
      <h2 style={{ fontSize: 19, marginBottom: 8 }}>{title}</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.55, margin: 0 }}>{body}</p>
    </section>
  );
}

export default async function MarketingHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const t = getMessages(locale as Locale);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      applicationCategory: 'EducationalApplication',
      url: `${SITE_URL}/${locale}`,
      description: t['marketing.seoDescription'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: t['marketing.faq1Q'], acceptedAnswer: { '@type': 'Answer', text: t['marketing.faq1A'] } },
        { '@type': 'Question', name: t['marketing.faq2Q'], acceptedAnswer: { '@type': 'Answer', text: t['marketing.faq2A'] } },
        { '@type': 'Question', name: t['marketing.faq3Q'], acceptedAnswer: { '@type': 'Answer', text: t['marketing.faq3A'] } },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ maxWidth: 880, margin: '0 auto', padding: 'var(--space-16) var(--space-6)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-12)' }}>
          <h1 style={{ fontSize: 40, lineHeight: 1.15, marginBottom: 'var(--space-4)', textWrap: 'balance' }}>
            {t['marketing.h1']}
          </h1>
          <p style={{ fontSize: 18, color: 'var(--text-secondary)', maxWidth: 620, margin: '0 auto', lineHeight: 1.5 }}>
            {t['marketing.subhead']}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
            <Link href="/sign-up" className="btn btn-primary">{t['marketing.ctaPrimary']}</Link>
            <Link href={`/${locale}/how-it-works`} className="btn btn-secondary">{t['marketing.ctaSecondary']}</Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-12)' }}>
          <Section title={t['marketing.section1Title']} body={t['marketing.section1Body']} />
          <Section title={t['marketing.section2Title']} body={t['marketing.section2Body']} />
          <Section title={t['marketing.section3Title']} body={t['marketing.section3Body']} />
          <Section title={t['marketing.section4Title']} body={t['marketing.section4Body']} />
          <Section title={t['marketing.section5Title']} body={t['marketing.section5Body']} />
        </div>

        <section>
          <h2 style={{ fontSize: 24, marginBottom: 'var(--space-4)' }}>{t['marketing.faqTitle']}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {([
              [t['marketing.faq1Q'], t['marketing.faq1A']],
              [t['marketing.faq2Q'], t['marketing.faq2A']],
              [t['marketing.faq3Q'], t['marketing.faq3A']],
            ] as const).map(([q, a]) => (
              <div key={q}>
                <h3 style={{ fontSize: 16, marginBottom: 4 }}>{q}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.55, margin: 0 }}>{a}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
