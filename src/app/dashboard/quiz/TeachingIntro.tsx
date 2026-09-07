'use client';

/**
 * LX-4R R1/R2/R3 -- the teach-first phase, BEFORE the practice questions.
 *
 * Renders only the stages the CANONICAL `TeachingExperienceView` (from
 * /api/learning/teaching-intent -> deriveTeachingExperience) says apply:
 *
 *   EXPLAIN  -> the concept explanation (summary + sections)
 *   MODEL    -> a worked example, revealed step by step (R2 -- sourced
 *              from ConceptExplanation.examples, never a quiz question)
 *   GUIDE    -> "solve one together" (R3 -- /api/learning/guided-practice;
 *              guided answers are scaffolding, never evidence)
 *
 * The component computes nothing pedagogical. `SupportLevel` was already
 * decided upstream; this only presents it.
 */

import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import MathText from '@/components/MathText';
import type { TeachingExperienceView, TeachingExperienceMode } from '@/lib/lx/teaching-experience';

interface Explanation {
  summary: string;
  sections: { heading: string; body: string }[];
  examples: string[];
}
interface GuidedStep {
  prompt: string;
  expectedAnswer: string;
  why: string;
}
interface Guided {
  problem: string;
  steps: GuidedStep[];
  closing: string;
}

type IntroStage = Extract<TeachingExperienceMode, 'EXPLAIN' | 'MODEL' | 'GUIDE'>;

export default function TeachingIntro({
  view,
  studentId,
  quizId,
  conceptId,
  conceptLabel,
  locale,
  onDone,
}: {
  view: TeachingExperienceView;
  studentId: string;
  quizId: string;
  conceptId: string;
  conceptLabel: string;
  locale: Locale;
  onDone: () => void;
}) {
  const t = getMessages(locale);

  const stages: IntroStage[] = view.stages.filter(
    (s): s is IntroStage => s === 'EXPLAIN' || s === 'MODEL' || s === 'GUIDE',
  );
  // MODEL only when the canonical view asks for a worked example.
  const plan = stages.filter((s) => (s === 'MODEL' ? view.showWorkedExample : true));

  const [idx, setIdx] = useState(0);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [guided, setGuided] = useState<Guided | null>(null);
  const [loading, setLoading] = useState(true);
  const [exampleStep, setExampleStep] = useState(1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const needsExplanation = plan.includes('EXPLAIN') || plan.includes('MODEL');
      const needsGuided = plan.includes('GUIDE');
      const [exp, gp] = await Promise.all([
        needsExplanation
          ? fetch(`/api/concepts/${conceptId}/explanation?studentId=${studentId}&language=${locale}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((b) => b?.data?.explanation ?? null)
              .catch(() => null)
          : Promise.resolve(null),
        needsGuided
          ? fetch('/api/learning/guided-practice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ studentId, quizId, language: locale }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((b) => b?.data?.guidedPractice ?? null)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setExplanation(exp);
      setGuided(gp);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId, quizId]);

  // Drop stages whose content failed to load, so we never show an empty stage.
  const effectivePlan = plan.filter((s) => {
    if (s === 'EXPLAIN') return !!explanation?.summary;
    if (s === 'MODEL') return (explanation?.examples?.length ?? 0) > 0;
    if (s === 'GUIDE') return (guided?.steps?.length ?? 0) > 0;
    return true;
  });

  useEffect(() => {
    if (!loading && effectivePlan.length === 0) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, effectivePlan.length]);

  if (loading) {
    return <div className="card empty-state">{t['teachingIntro.loading']}</div>;
  }
  if (effectivePlan.length === 0) return null;

  const stage = effectivePlan[Math.min(idx, effectivePlan.length - 1)];
  const isLast = idx >= effectivePlan.length - 1;

  function advance() {
    if (isLast) onDone();
    else setIdx((i) => i + 1);
  }

  return (
    <div className="al-teach">
      <div className="al-teach-progress" aria-hidden>
        {effectivePlan.map((s, i) => (
          <span key={s} className={`al-teach-dot${i === idx ? ' active' : ''}${i < idx ? ' done' : ''}`} />
        ))}
      </div>

      <section className="card al-teach-card" aria-live="polite">
        <p className="label" style={{ color: 'var(--brand-ink)' }}>
          {t[`teachingExperience.mode.${stage}` as keyof typeof t]}
        </p>

        {stage === 'EXPLAIN' && explanation && (
          <div>
            <h2 style={{ fontSize: 18, margin: '4px 0 var(--space-3)' }}>{t['teachingIntro.explainTitle']}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, fontWeight: 550 }}>
              <MathText text={explanation.summary} />
            </p>
            {explanation.sections.slice(0, 3).map((sec, i) => (
              <div key={i} style={{ marginTop: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--brand-ink)', margin: '0 0 4px' }}>{sec.heading}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)', margin: 0 }}>
                  <MathText text={sec.body} />
                </p>
              </div>
            ))}
          </div>
        )}

        {stage === 'MODEL' && explanation && (
          <div>
            <h2 style={{ fontSize: 18, margin: '4px 0 var(--space-3)' }}>{t['teachingIntro.modelTitle']}</h2>
            <ol className="al-worked">
              {explanation.examples.slice(0, exampleStep).map((ex, i) => (
                <li key={i}>
                  <span className="label" style={{ color: 'var(--text-muted)' }}>
                    {t['workedExample.step'].replace('{n}', String(i + 1))}
                  </span>
                  <div style={{ fontSize: 15, lineHeight: 1.6 }}>
                    <MathText text={ex} />
                  </div>
                </li>
              ))}
            </ol>
            {exampleStep < Math.min(4, explanation.examples.length) && (
              <button type="button" className="btn btn-secondary" onClick={() => setExampleStep((s) => s + 1)}>
                {t['workedExample.revealNext']}
              </button>
            )}
          </div>
        )}

        {stage === 'GUIDE' && guided && (
          <GuidedPractice guided={guided} locale={locale} onComplete={advance} />
        )}
      </section>

      {stage !== 'GUIDE' && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={advance}>
            {isLast ? t['teachingIntro.startPractice'] : t['teachingIntro.continue']}
          </button>
          {!isLast && (
            <button type="button" className="btn btn-ghost" onClick={onDone}>
              {t['teachingIntro.skip']}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** R3 -- one guided sequence: prompt -> your step -> reveal -> why -> next. */
function GuidedPractice({
  guided,
  locale,
  onComplete,
}: {
  guided: Guided;
  locale: Locale;
  onComplete: () => void;
}) {
  const t = getMessages(locale);
  const [stepIdx, setStepIdx] = useState(0);
  const [entry, setEntry] = useState('');
  const [revealed, setRevealed] = useState(false);
  const step = guided.steps[stepIdx];
  const isLastStep = stepIdx >= guided.steps.length - 1;

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '4px 0 var(--space-2)' }}>{t['guided.title']}</h2>
      <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 var(--space-2)' }}>
        <MathText text={guided.problem} />
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>{t['guided.notEvidence']}</p>

      <div className="al-guided-step" aria-live="polite">
        <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 var(--space-2)' }}>
          <MathText text={step.prompt} />
        </p>
        {!revealed ? (
          <>
            <label className="sr-only" htmlFor="al-guided-entry">
              {t['guided.yourStep']}
            </label>
            <input
              id="al-guided-entry"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder={t['guided.yourStep']}
              style={{
                width: '100%', height: 44, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                padding: '0 12px', fontSize: 15, fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 'var(--space-3)' }}
              onClick={() => setRevealed(true)}
            >
              {t['guided.check']}
            </button>
          </>
        ) : (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <p style={{ margin: '0 0 4px', fontSize: 14 }}>
              <span className="label" style={{ color: 'var(--text-muted)' }}>{t['guided.expected']}:</span>{' '}
              <MathText text={step.expectedAnswer} />
            </p>
            <p style={{ margin: '0 0 var(--space-3)', fontSize: 13.5, color: 'var(--text-secondary)' }}>
              <span className="label" style={{ color: 'var(--text-muted)' }}>{t['workedExample.why']}:</span>{' '}
              <MathText text={step.why} />
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (isLastStep) {
                  onComplete();
                } else {
                  setStepIdx((i) => i + 1);
                  setEntry('');
                  setRevealed(false);
                }
              }}
            >
              {isLastStep ? t['teachingIntro.startPractice'] : t['guided.nextStep']}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
