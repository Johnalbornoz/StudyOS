import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMessages, LOCALES, type Locale } from '@/lib/i18n/messages';
import { SITE_URL, SITE_NAME, buildLanguageAlternates, isSupportedLocale } from '@/lib/seo';
import { conceptJourneyFromResult } from '@/lib/lx/concept-journey';
import { LEARNER_JOURNEY_CONTRACT_VERSION } from '@/lib/lx/learner-journey-contract';
import StageTrack from '@/app/dashboard/StageTrack';

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

/**
 * UX-2 -- public landing ("No estudies más. Estudia mejor.").
 *
 * Presentation only: every claim below describes behaviour the product
 * already has (canonical stage gating, the next-action hero, contextual
 * help, independent Prove, retention and transfer). Sign-up / sign-in
 * links, locale routing, metadata and JSON-LD are unchanged in shape.
 * The product preview is a static, clearly labelled illustration built
 * from the real Home hero styles -- never learner data.
 */
const JOURNEY = [1, 2, 3, 4, 5, 6] as const;

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

  // Illustration only: the Home hero's own stage track, at "Demostrar".
  const previewJourney = conceptJourneyFromResult({ stage: 'PROVE', intervention: null, reason: 'ILLUSTRATION', contractVersion: LEARNER_JOURNEY_CONTRACT_VERSION });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="lp-hero" aria-labelledby="lp-title">
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">{t['landing.eyebrow']}</p>
            <h1 id="lp-title" className="lp-title">{t['marketing.h1']}</h1>
            <p className="lp-lede">{t['marketing.subhead']}</p>
            <div className="lp-cta-row">
              <Link href="/sign-up" className="btn btn-primary btn-lg">{t['marketing.ctaPrimary']}</Link>
              <Link href={`/${locale}/how-it-works`} className="btn btn-secondary btn-lg">{t['marketing.ctaSecondary']}</Link>
            </div>
          </div>

          <figure className="lp-preview">
            <div className="xp-hero lp-preview-card" aria-hidden="true">
              <div className="xp-hero-eyebrow">
                <span className="xp-hero-kicker">{t['xp.nextChallenge']}</span>
                <span className="xp-hero-verb">{t['xp.challenge.SOLO_CHECK']}</span>
              </div>
              <p className="xp-hero-title">{t['landing.previewConcept']}</p>
              <p className="xp-hero-meta">
                <span>{t['landing.previewSubject']}</span>
                <span>{t['activityLabel.SOLO_CHECK']}</span>
              </p>
              <p className="xp-hero-narrative">{t['todayNarrative.SOLO_CHECK']}</p>
              <StageTrack journey={previewJourney} t={t} />
              <div className="xp-hero-cta">
                <span className="btn btn-primary btn-lg lp-fake-btn">{t['activityCta.SOLO_CHECK']}</span>
              </div>
            </div>
            <figcaption className="lp-preview-caption">
              {t['landing.previewLabel']} · <span>{t['landing.previewNote']}</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-principles">
        <div className="lp-container">
          <h2 id="lp-principles" className="lp-h2">{t['landing.principlesTitle']}</h2>
          <ul className="lp-principles">
            {([1, 2, 3] as const).map((i) => (
              <li key={i} className="lp-principle">
                <h3>{t[`landing.principle${i}Title`]}</h3>
                <p>{t[`landing.principle${i}Body`]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-section--alt" aria-labelledby="lp-journey">
        <div className="lp-container">
          <h2 id="lp-journey" className="lp-h2">{t['landing.journeyTitle']}</h2>
          <p className="lp-section-intro">{t['landing.journeyIntro']}</p>
          <ol className="lp-journey">
            {JOURNEY.map((i) => (
              <li key={i} className="lp-step">
                <span className="lp-step-index" aria-hidden>{String(i).padStart(2, '0')}</span>
                <h3>{t[`landing.step${i}Name`]}</h3>
                <p>{t[`landing.step${i}Body`]}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section lp-coach" aria-labelledby="lp-coach">
        <div className="lp-container">
          <h2 id="lp-coach" className="lp-h2">{t['landing.coachTitle']}</h2>
          <ul className="lp-coach-grid">
            {([1, 2, 3] as const).map((i) => (
              <li key={i}>
                <h3>{t[`landing.coach${i}Title`]}</h3>
                <p>{t[`landing.coach${i}Body`]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-faq">
        <div className="lp-container lp-narrow">
          <h2 id="lp-faq" className="lp-h2">{t['marketing.faqTitle']}</h2>
          <div className="lp-faq">
            {([
              [t['marketing.faq1Q'], t['marketing.faq1A']],
              [t['marketing.faq2Q'], t['marketing.faq2A']],
              [t['marketing.faq3Q'], t['marketing.faq3A']],
            ] as const).map(([q, a]) => (
              <details key={q}>
                <summary><h3>{q}</h3></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final" aria-labelledby="lp-final">
        <div className="lp-container lp-narrow">
          <h2 id="lp-final" className="lp-final-title">{t['landing.finalTitle']}</h2>
          <p className="lp-lede">{t['landing.finalBody']}</p>
          <div className="lp-cta-row lp-cta-row--center">
            <Link href="/sign-up" className="btn btn-primary btn-lg">{t['marketing.ctaPrimary']}</Link>
          </div>
          <p className="lp-final-note">{t['landing.haveAccount']} <Link href="/sign-in">{t['home.signIn']}</Link></p>
        </div>
      </section>
    </>
  );
}
