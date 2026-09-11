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

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import MathText from '@/components/MathText';
import type { TeachingExperienceView, TeachingExperienceMode } from '@/lib/lx/teaching-experience';
import InteractiveFormulaWidget from '@/app/dashboard/subjects/[id]/InteractiveFormulaWidget';
import { useInteractiveFormula } from '@/lib/hooks/useInteractiveFormula';

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
  quizMode,
  locale,
  exitHref,
  onDone,
}: {
  view: TeachingExperienceView;
  studentId: string;
  /**
   * LX-4P-PERF-R1 R6: null until the background question batch returns a
   * session. EXPLAIN/MODEL never needed it. LX-4P-PERF-R1E: GUIDE no
   * longer needs it either -- kept on the contract (received, optionally
   * forwarded) for a future/legacy caller that already has a session,
   * never required for GUIDE to start.
   */
  quizId: string | null;
  conceptId: string;
  conceptLabel: string;
  /**
   * LX-4P-PERF-R1E R2: the canonical QuizMode -- transport input only.
   * GUIDE's server route re-derives EvidenceMode from this through the
   * fixed QuizMode -> ActivityType -> EvidenceMode taxonomy; the client
   * never computes or sends an EvidenceMode/SupportLevel/permission
   * decision itself.
   */
  quizMode: string;
  /**
   * LX-4P-PERF-R1 R20: the activity/question language governs the ENTIRE
   * active learning surface -- both the content fetches (explanation,
   * guided practice) AND every chrome string here (titles, "Reveal the
   * next step", "Continue", "Skip to practice", "your step", "Check").
   * The global StudyUS shell stays on interface_language; this surface
   * does not. (Supersedes the LX-4P-R2 R13 uiLocale split.)
   */
  locale: Locale;
  /**
   * LX-4P-PERF-R1E-R1 R2/R5: destination for the "Exit the activity"
   * action when a canonically REQUIRED GUIDE stage fails to prepare.
   * StudyUS decides the learning path -- there is no "skip GUIDE"; the
   * only way out of a failed GUIDE besides retrying is leaving the
   * activity entirely (never a silent fall-through to Practice).
   */
  exitHref: string;
  onDone: () => void;
}) {
  const t = getMessages(locale);

  const stages: IntroStage[] = view.stages.filter(
    (s): s is IntroStage => s === 'EXPLAIN' || s === 'MODEL' || s === 'GUIDE',
  );
  // MODEL only when the canonical view asks for a worked example.
  const plan = stages.filter((s) => (s === 'MODEL' ? view.showWorkedExample : true));

  const needsExplanation = plan.includes('EXPLAIN') || plan.includes('MODEL');
  const needsGuided = plan.includes('GUIDE');

  const [idx, setIdx] = useState(0);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [guided, setGuided] = useState<Guided | null>(null);
  // LX-4P-PERF-R1 R6: MODEL/EXPLAIN and GUIDE prepare INDEPENDENTLY.
  // MODEL renders as soon as its explanation is ready -- it never waits
  // on GUIDE.
  const [expLoading, setExpLoading] = useState(needsExplanation);
  // LX-4P-PERF-R1E-R1 R1/R3: GUIDE's own lifecycle, explicit and
  // separate from Practice question-generation state (genState, on the
  // quiz page). 'error' is a distinct, TERMINAL-until-retried state --
  // it is never collapsed into "no GUIDE" (see effectivePlan below).
  const [guideState, setGuideState] = useState<'idle' | 'loading' | 'ready' | 'error'>(needsGuided ? 'loading' : 'idle');
  const [guideAttempt, setGuideAttempt] = useState(0);
  const [exampleStep, setExampleStep] = useState(1);

  // EXPLAIN / MODEL content -- needs only conceptId, fires immediately.
  // LX-4P-PERF-R1D R7: this fetch (concept.explanation only) is the MODEL
  // TTFI. The optional interactive-formula widget is a SEPARATE request
  // below and its timing is never folded in here.
  useEffect(() => {
    if (!needsExplanation) { setExpLoading(false); return; }
    let cancelled = false;
    setExpLoading(true);
    fetch(`/api/concepts/${conceptId}/explanation?studentId=${studentId}&language=${locale}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.data?.explanation ?? null)
      .catch(() => null)
      .then((exp) => {
        if (cancelled) return;
        try { console.log('[perf]', JSON.stringify({ label: 'EXPLANATION_READY', t: Math.round(performance.now()), conceptId })); } catch { /* noop */ }
        setExplanation(exp);
        setExpLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId, locale]);

  // LX-4P-PERF-R1D R4: OPTIONAL interactive-formula widget. Progressive
  // enhancement -- a real independent client request that fires only
  // AFTER the explanation is ready, never blocks MODEL, and degrades
  // silently. Inserted into the MODEL stage when it arrives.
  // Only when a MODEL worked-example stage will actually render the widget.
  const wantsFormula = plan.includes('MODEL') && view.showWorkedExample;
  const interactiveFormula = useInteractiveFormula(
    conceptId,
    studentId,
    locale,
    wantsFormula && !!explanation,
  );

  // GUIDE content -- teaching scaffolding, not evidence. LX-4P-PERF-R1E
  // R1/R3: GUIDE must NEVER depend on the background Practice question
  // batch (quizId) -- it fires as soon as the SAME canonical context
  // MODEL and TeachingIntent already have (studentId/conceptId/quizMode/
  // locale) is available, fully independent of and in parallel with
  // question generation. A failed or never-returning question batch
  // (quizId never arriving) must never leave GUIDE pending forever.
  //
  // LX-4P-PERF-R1E-R1 R3: `guideKeyRef` makes one attempt idempotent
  // (StrictMode double-invoke / unrelated re-renders never refire it)
  // while a genuinely new concept/mode/locale OR an explicit retry
  // (`guideAttempt` bump) always does fire a fresh request.
  const guideKeyRef = useRef<string | null>(null);
  const guideRetryInFlightRef = useRef(false);
  useEffect(() => {
    if (!needsGuided) { setGuideState('idle'); return; }
    const key = `${conceptId}@${quizMode}@${locale}@${guideAttempt}`;
    if (guideKeyRef.current === key) return;
    guideKeyRef.current = key;
    guideRetryInFlightRef.current = false;
    let cancelled = false;
    setGuideState('loading');
    try {
      console.log('[perf]', JSON.stringify({
        label: guideAttempt > 0 ? 'GUIDE_RETRY_STARTED' : 'GUIDE_REQUEST_STARTED',
        t: Math.round(performance.now()), conceptId,
      }));
    } catch { /* noop */ }
    fetch('/api/learning/guided-practice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, conceptId, mode: quizMode, language: locale }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.data?.guidedPractice ?? null)
      .catch(() => null)
      .then((gp) => {
        if (cancelled) return;
        guideRetryInFlightRef.current = false;
        // LX-4P-PERF-R1E-R1 R1: a canonically REQUIRED GUIDE that comes
        // back empty is a FAILURE, never silently treated as "not
        // required" -- see effectivePlan below, which never drops GUIDE
        // for this reason.
        const ok = !!gp && Array.isArray(gp.steps) && gp.steps.length > 0;
        try {
          console.log('[perf]', JSON.stringify({ label: ok ? 'GUIDE_READY' : 'GUIDE_FAILED', t: Math.round(performance.now()), conceptId }));
        } catch { /* noop */ }
        if (ok) {
          setGuided(gp);
          setGuideState('ready');
        } else {
          setGuided(null);
          setGuideState('error');
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId, quizMode, locale, guideAttempt]);

  // LX-4P-PERF-R1E-R1 R3: RETRY issues a fresh bounded request. The ref
  // guard blocks a second concurrent request from a rapid double-click;
  // the effect above additionally no-ops on a repeated identical key.
  function retryGuide() {
    if (guideRetryInFlightRef.current) return;
    guideRetryInFlightRef.current = true;
    setGuideAttempt((a) => a + 1);
  }

  // Drop stages whose content failed to load, so we never show an empty
  // stage -- EXCEPT GUIDE. LX-4P-PERF-R1E-R1 R1: a canonical GUIDE stage
  // is never removed from the effective plan because its content failed
  // or is still loading. It stays a reserved stage with its own
  // pending/ready/error presentation below; only GUIDE_NOT_REQUIRED
  // (never in `plan` to begin with, i.e. `!needsGuided`) omits it.
  const effectivePlan = plan.filter((s) => {
    if (s === 'EXPLAIN') return !!explanation?.summary;
    if (s === 'MODEL') return (explanation?.examples?.length ?? 0) > 0;
    return true; // GUIDE (and any other canonical stage) always kept
  });

  useEffect(() => {
    if (!expLoading && guideState !== 'loading' && effectivePlan.length === 0) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expLoading, guideState, effectivePlan.length]);

  // LX-4P-PERF-R1D R7: MODEL_RENDERED -- fires once, when the MODEL stage
  // first becomes visible with its content on screen. The delta from
  // EXPLANATION_READY is the MODEL render only; the formula widget is
  // never on this path.
  const modelVisible =
    !expLoading &&
    effectivePlan.length > 0 &&
    effectivePlan[Math.min(idx, effectivePlan.length - 1)] === 'MODEL';
  const modelRenderedRef = useRef(false);
  useEffect(() => {
    if (modelVisible && !modelRenderedRef.current) {
      modelRenderedRef.current = true;
      try { console.log('[perf]', JSON.stringify({ label: 'MODEL_RENDERED', t: Math.round(performance.now()), conceptId })); } catch { /* noop */ }
    }
  }, [modelVisible, conceptId]);

  // Block only on the FIRST needed content (explanation). GUIDE catches
  // up in the background, and -- LX-4P-PERF-R1E-R1 -- always keeps its
  // own reserved slot in effectivePlan (pending/ready/error rendered
  // inline below), so there is no longer a separate "hold here while
  // GUIDE loads" branch: the learner simply reaches the GUIDE stage in
  // sequence and sees its own state there.
  if (expLoading) {
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
            {/* LX-4P-PERF-R1D R4: optional enrichment -- inserted only when
                it has arrived. MODEL is fully usable without it; no
                spinner, no error state. */}
            {interactiveFormula && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <InteractiveFormulaWidget locale={locale} data={interactiveFormula} />
              </div>
            )}
          </div>
        )}

        {/* LX-4P-PERF-R1E-R1 R2/R5: GUIDE's three sub-states. A required
            GUIDE is NEVER silently replaced by Practice -- 'loading'
            shows a plain teaching-specific pending line, 'error' shows an
            explicit recoverable retry/exit state, and only 'ready' lets
            the learner actually work through (and thereby genuinely
            complete) the guided sequence. There is no skip action here. */}
        {stage === 'GUIDE' && guideState === 'loading' && (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>{t['guided.preparing']}</p>
        )}
        {stage === 'GUIDE' && guideState === 'ready' && guided && (
          <GuidedPractice guided={guided} locale={locale} onComplete={advance} />
        )}
        {stage === 'GUIDE' && guideState === 'error' && (
          <div>
            <h2 style={{ fontSize: 18, margin: '4px 0 var(--space-2)' }}>{t['guided.failedTitle']}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 var(--space-4)' }}>
              {t['guided.failedBody']}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={retryGuide}>
                {t['guided.retry']}
              </button>
              <a href={exitHref} className="btn btn-ghost">
                {t['guided.exit']}
              </a>
            </div>
          </div>
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
  /** LX-4P-PERF-R1 R20: the active learning surface -- chrome AND content -- follows the activity/question language. */
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
