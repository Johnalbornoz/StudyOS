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
 * Story: hero -> start from what you need -> find the way that works ->
 * prove it -> not yet? work on it -> you've got it -> one challenge a day
 * -> are you ready? -> your goal is right there.
 *
 * Presentation only: every claim describes behaviour the product already
 * has (evidence-based focus, contextual help, independent Prove, canonical
 * stage unlocking, retention, learning days, exam readiness). Sign-up /
 * sign-in links, locale routing, metadata and JSON-LD are unchanged in
 * shape. Illustrations are static, labelled, `aria-hidden` product
 * sketches built from the real Home styles -- never learner data and
 * never a working control.
 */
type T = ReturnType<typeof getMessages>;

function Illustration({ t, children, className = '' }: { t: T; children: React.ReactNode; className?: string }) {
  return (
    <figure className={`lp-visual ${className}`}>
      <div aria-hidden="true">{children}</div>
      <figcaption className="lp-visual-caption">{t['landing.previewNote']}</figcaption>
    </figure>
  );
}

function Story({ id, title, lead, children, visual, alt = false, dark = false }: { id: string; title: string; lead: string; children?: React.ReactNode; visual?: React.ReactNode; alt?: boolean; dark?: boolean }) {
  return (
    <section className={`lp-section${alt ? ' lp-section--alt' : ''}${dark ? ' lp-section--dark' : ''}`} aria-labelledby={id}>
      <div className={`lp-container${visual ? ' lp-split' : ''}`}>
        <div className="lp-story">
          <h2 id={id} className="lp-h2">{title}</h2>
          <p className="lp-h2-lead">{lead}</p>
          {children}
        </div>
        {visual}
      </div>
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

  // Illustrations only: the Home hero's own stage track, at "Demostrar" and "Recordar".
  const journey = (stage: 'PROVE' | 'RETAIN') =>
    conceptJourneyFromResult({ stage, intervention: null, reason: 'ILLUSTRATION', contractVersion: LEARNER_JOURNEY_CONTRACT_VERSION });
  const STAGES = ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'] as const;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* 1 -- HERO */}
      <section className="lp-hero" aria-labelledby="lp-title">
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">{t['landing.eyebrow']}</p>
            <h1 id="lp-title" className="lp-title">{t['marketing.h1']}</h1>
            <p className="lp-hero-lines">
              {([1, 2, 3, 4] as const).map((i) => <span key={i}>{t[`landing.heroLine${i}`]} </span>)}
            </p>
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
              <StageTrack journey={journey('PROVE')} t={t} />
              <div className="xp-hero-cta">
                <span className="btn btn-primary btn-lg lp-fake-btn">{t['activityCta.SOLO_CHECK']}</span>
              </div>
            </div>
            <figcaption className="lp-visual-caption">{t['landing.previewLabel']} · {t['landing.previewNote']}</figcaption>
          </figure>
        </div>
      </section>

      {/* 2 -- START FROM WHAT YOU NEED */}
      <Story
        id="lp-s2"
        title={t['landing.s2Title']}
        lead={t['landing.s2Lead']}
        visual={
          <Illustration t={t}>
            <ul className="lp-concepts">
              <li className="done"><span className="lp-dot" />{t['landing.sampleConceptA']}<em>{t['landing.s2Known']}</em></li>
              <li className="done"><span className="lp-dot" />{t['landing.sampleConceptB']}<em>{t['landing.s2Known']}</em></li>
              <li className="focus"><span className="lp-dot" />{t['landing.sampleConceptC']}<em>{t['landing.s2Focus']}</em></li>
            </ul>
          </Illustration>
        }
      >
        <ul className="lp-points">
          {([1, 2, 3] as const).map((i) => <li key={i}>{t[`landing.s2Point${i}`]}</li>)}
        </ul>
      </Story>

      {/* 3 -- FIND THE WAY THAT WORKS */}
      <Story id="lp-s3" title={t['landing.s3Title']} lead={t['landing.s3Lead']} alt>
        <ul className="lp-trio">
          {([1, 2, 3] as const).map((i) => (
            <li key={i}>
              <h3>{t[`landing.s3Item${i}Title`]}</h3>
              <p>{t[`landing.s3Item${i}Body`]}</p>
            </li>
          ))}
        </ul>
        <p className="lp-note">{t['landing.s3Note']}</p>
      </Story>

      {/* 4 -- PROVE IT */}
      <Story
        id="lp-s4"
        title={t['landing.s4Title']}
        lead={t['landing.s4Lead']}
        dark
        visual={
          <Illustration t={t} className="lp-visual--dark">
            <div className="lp-compare">
              <div>
                <strong>{t['landing.s4Recognise']}</strong>
                <span>{t['landing.s4RecogniseBody']}</span>
              </div>
              <div className="strong">
                <strong>{t['landing.s4Prove']}</strong>
                <span>{t['landing.s4ProveBody']}</span>
              </div>
            </div>
          </Illustration>
        }
      >
        <p className="lp-body">{t['landing.s4Body']}</p>
      </Story>

      {/* 5 -- NOT YET? WORK ON IT */}
      <Story id="lp-s5" title={t['landing.s5Title']} lead={t['landing.s5Lead']}>
        <p className="lp-body">{t['landing.s5Body']}</p>
        <ol className="lp-loop">
          {([1, 2, 3, 4, 5] as const).map((i) => <li key={i}>{t[`landing.s5Step${i}`]}</li>)}
        </ol>
      </Story>

      {/* 6 -- YOU'VE GOT IT: the five-stage model, human words first */}
      <Story
        id="lp-s6"
        title={t['landing.s6Title']}
        lead={t['landing.s6Lead']}
        alt
        visual={
          <Illustration t={t}>
            <div className="lp-panel">
              <p className="lp-panel-title">{t['landing.sampleConceptC']}</p>
              <StageTrack journey={journey('RETAIN')} t={t} />
              <p className="lp-panel-row"><span className="lp-badge">{t['landing.s6Unlocked']}</span>{t['conceptMission.stage.RETAIN']}</p>
              <p className="lp-panel-row"><span className="lp-badge lp-badge--next">{t['landing.s6Next']}</span>{t['landing.previewConcept']}</p>
            </div>
          </Illustration>
        }
      >
        <p className="lp-body">{t['landing.s6Body']}</p>
        <h3 className="lp-h3">{t['landing.s6ModelTitle']}</h3>
        <ol className="lp-model">
          {STAGES.map((stage, i) => (
            <li key={stage}>
              <span className="lp-model-index" aria-hidden>{i + 1}</span>
              <strong>{t[`landing.s6Human${(i + 1) as 1 | 2 | 3 | 4 | 5}`]}</strong>
              <span className="lp-model-formal">{t[`conceptMission.stage.${stage}`]}</span>
            </li>
          ))}
        </ol>
      </Story>

      {/* 7 -- ONE CHALLENGE A DAY */}
      <Story
        id="lp-s7"
        title={t['landing.s7Title']}
        lead={t['landing.s7Lead']}
        visual={
          <Illustration t={t}>
            <div className="lp-panel">
              <p className="lp-panel-kicker">{t['xp.weekTitle']}</p>
              <p className="lp-panel-figure">{t['xp.weekValue'].replace('{count}', '4')}</p>
              <span className="ui-meter">{Array.from({ length: 7 }, (_, i) => <span key={i} className={i < 4 ? 'on' : undefined} />)}</span>
              <p className="lp-panel-kicker" style={{ marginTop: 'var(--space-5)' }}>{t['xp.todayPlanTitle']}</p>
              <p className="lp-panel-figure">{t['xp.todayPlanValue'].replace('{minutes}', '25')}</p>
            </div>
          </Illustration>
        }
      >
        <p className="lp-body">{t['landing.s7Body']}</p>
      </Story>

      {/* 8 -- ARE YOU READY? */}
      <Story
        id="lp-s8"
        title={t['landing.s8Title']}
        lead={t['landing.s8Lead']}
        alt
        visual={
          <Illustration t={t}>
            <div className="lp-panel">
              <p className="lp-panel-kicker">{t['landing.s8Readiness']}</p>
              <ol className="lp-ladder">
                {(['EARLY_PREPARATION', 'DEVELOPING', 'SIMULATION_READY', 'FULL_MOCK_ELIGIBLE'] as const).map((status, i) => (
                  <li key={status} className={i < 2 ? 'done' : i === 2 ? 'current' : undefined}>{t[`examPrep.status.${status}`]}</li>
                ))}
              </ol>
            </div>
          </Illustration>
        }
      >
        <ul className="lp-points">
          {([1, 2, 3, 4] as const).map((i) => <li key={i}>{t[`landing.s8Point${i}`]}</li>)}
        </ul>
      </Story>

      <section className="lp-section" aria-labelledby="lp-faq">
        <div className="lp-container">
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

      {/* FINAL CTA */}
      <section className="lp-final" aria-labelledby="lp-final">
        <div className="lp-container lp-narrow">
          <h2 id="lp-final" className="lp-final-title">{t['landing.finalTitle2']}</h2>
          <ul className="lp-final-lines">
            {([1, 2, 3] as const).map((i) => <li key={i}>{t[`landing.finalLine${i}`]}</li>)}
          </ul>
          <p className="lp-final-tagline">{t['marketing.h1']}</p>
          <div className="lp-cta-row lp-cta-row--center">
            <Link href="/sign-up" className="btn btn-primary btn-lg">{t['landing.finalCta']}</Link>
          </div>
          <p className="lp-final-note">{t['landing.haveAccount']} <Link href="/sign-in">{t['home.signIn']}</Link></p>
        </div>
      </section>
    </>
  );
}
