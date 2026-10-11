/**
 * B4 -- the shared components of the assessment experience. One set for every family; each renders a view
 * contract from src/lib/assessment-experience and nothing else.
 *
 * They decide layout, hierarchy and wording. They decide nothing about pedagogy: no component here counts
 * questions, picks a concept, reads a score to infer progress or chooses the next step. Family differences
 * arrive as data (capabilities, availability, which facts are present), not as family switches.
 *
 * No client state: the setup is a plain form (a radio group and a submit button), so it works without
 * script, with the keyboard and with a screen reader as the browser provides.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { InlineAlert } from '@/components/ui/InlineAlert';
import type { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import type { PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import type { AssessmentContinuationView } from '@/lib/assessment-experience/continuation';
import type { AssessmentPreview, AssessmentResultView, AssessmentRunView, AssessmentSetupView, EffortEstimate, ExamAttemptOption } from '@/lib/assessment-experience/views';

type T = ReturnType<typeof getMessages>;

/* ------------------------------------------------------------------ */
/* Effort                                                               */
/* ------------------------------------------------------------------ */

/** "11 preguntas · ~22 min", "11 preguntas", or nothing. A fact the authority did not state is not shown. */
export function effortText(effort: EffortEstimate, t: T): string | null {
  const parts: string[] = [];
  if (effort.questions !== null) parts.push(fillMessage(t['ax.effort.questions'], { count: effort.questions }));
  if (effort.minutes !== null) parts.push(fillMessage(t['ax.effort.minutes'], { minutes: Math.round(effort.minutes) }));
  return parts.length > 0 ? parts.join(' · ') : null;
}

function PreviewFacts({ preview, t }: { preview: AssessmentPreview; t: T }) {
  const effort = effortText(preview.effort, t);
  const partial = preview.targets.covered < preview.targets.requested;
  return (
    <span className="ax-facts">
      {preview.targets.requested > 0 && (
        <span>{partial ? fillMessage(t['ax.effort.partialConcepts'], preview.targets) : fillMessage(t['ax.effort.concepts'], { count: preview.targets.requested })}</span>
      )}
      {effort && <span className="tabular">{effort}</span>}
    </span>
  );
}

/** Why a setup is limited or unavailable, in the Student's terms. Renders nothing when it is fully available. */
export function AssessmentAvailability({ preview, t }: { preview: AssessmentPreview; t: T }) {
  if (preview.availability === 'AVAILABLE') return null;
  const tr = t as Record<string, string>;
  return (
    <InlineAlert
      tone={preview.availability === 'UNAVAILABLE' ? 'warning' : 'info'}
      title={t[preview.availability === 'UNAVAILABLE' ? 'ax.avail.UNAVAILABLE' : 'ax.avail.PARTIAL']}
      body={preview.limitations.length > 0 ? <ul className="ax-list">{preview.limitations.map((l) => <li key={l}>{tr[`ax.limit.${l}`]}</li>)}</ul> : undefined}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Setup                                                                */
/* ------------------------------------------------------------------ */

export function AssessmentSetup({
  view,
  t,
  title,
  scopeLabel,
  action,
  hidden = {},
  selectedDepth,
  backHref,
}: {
  view: AssessmentSetupView;
  t: T;
  title?: string;
  /** What is being practised, in the curriculum's own words (a topic, a unit, a list of concepts). */
  scopeLabel?: string;
  /** Where the form goes. The request carries intent only: scope, depth -- never a question or a count. */
  action: string;
  hidden?: Record<string, string>;
  selectedDepth?: PracticeDepth;
  backHref: string;
}) {
  const tr = t as Record<string, string>;
  const startable = view.depthOptions.filter((o) => o.preview.canStart);
  const chosen = startable.find((o) => o.depth === selectedDepth) ?? startable.find((o) => o.depth === 'BALANCED') ?? startable[0] ?? null;
  const single = view.preview;
  const canStart = view.state !== 'UNAVAILABLE';
  return (
    <section className="card ax-setup" aria-labelledby="ax-setup-title" data-state={view.state}>
      <header>
        <h1 id="ax-setup-title" className="xr-section-name">{title ?? t['ax.setup.title']}</h1>
        {scopeLabel && <p className="ax-scope">{scopeLabel}</p>}
        {view.depthOptions.length > 0 && <p className="ui-hint">{t['ax.setup.intro']}</p>}
      </header>
      <form action={action} method="get" className="ui-form">
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {view.depthOptions.length > 0 && (
          <fieldset className="ui-choices">
            <legend className="ui-label">{t['ax.setup.depthLegend']}</legend>
            {view.depthOptions.map(({ depth, preview }) => (
              <label key={depth} className="ui-choice" data-availability={preview.availability}>
                <input type="radio" name="depth" value={depth} defaultChecked={chosen?.depth === depth} disabled={!preview.canStart} required />
                <span className="ui-choice-title">{tr[`ax.depth.${depth}`]}</span>
                <span className="ui-choice-body">{tr[`ax.depth.${depth}.desc`]}</span>
                {preview.canStart ? <PreviewFacts preview={preview} t={t} /> : <span className="ax-facts">{t['ax.avail.UNAVAILABLE']}</span>}
              </label>
            ))}
          </fieldset>
        )}
        {single && single.canStart && <p className="ax-single"><PreviewFacts preview={single} t={t} /></p>}
        {single && <AssessmentAvailability preview={single} t={t} />}
        {!single && view.state !== 'READY' && (
          <AssessmentAvailability preview={(startable[0] ?? view.depthOptions[0])?.preview ?? { availability: 'UNAVAILABLE', effort: { questions: null, minutes: null }, targets: { requested: 0, covered: 0 }, limitations: [], canStart: false }} t={t} />
        )}
        <div className="xr-next-actions">
          {canStart && <button type="submit" className="btn btn-primary btn-lg">{t['ax.setup.start']}</button>}
          <Link href={backHref} className={canStart ? 'btn btn-ghost' : 'btn btn-primary'}>{t['ax.setup.back']}</Link>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Exam attempt options                                                 */
/* ------------------------------------------------------------------ */

export function ExamAttemptOptions({ options, t, hrefs }: { options: readonly ExamAttemptOption[]; t: T; hrefs: Partial<Record<ExamAttemptOption['type'], string>> }) {
  const tr = t as Record<string, string>;
  return (
    <section className="card ax-setup" aria-labelledby="ax-exam-title">
      <h2 id="ax-exam-title" className="xr-section-name">{t['ax.exam.optionsTitle']}</h2>
      <ul className="ax-options">
        {options.map((o) => {
          const href = hrefs[o.type];
          const startable = o.available && !!href;
          return (
            <li key={o.type} className="ax-option" data-available={startable}>
              <div>
                <strong>{tr[`ex.type.${o.type}`]}</strong>
                <p className="ui-hint">{tr[`ax.exam.desc.${o.type}`]}</p>
                {!startable && (
                  <p className="ax-unavailable">
                    <span className="chip chip-warn">{t['ax.exam.unavailable']}</span> {o.reason ? tr[`ax.exam.reason.${o.reason}`] : null}
                  </p>
                )}
              </div>
              {/* An unavailable attempt is never a link that fails later. */}
              {startable && <Link href={href as string} className="btn btn-secondary">{t['ax.setup.start']}</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Active shell header                                                  */
/* ------------------------------------------------------------------ */

/** `helpLine={false}` on a surface that offers no help control: the header must not announce one. */
export function AssessmentRunHeader({ view, t, title, timer, helpLine = true }: { view: AssessmentRunView; t: T; title: string; timer?: ReactNode; helpLine?: boolean }) {
  const { answered, total } = view.progress;
  const c = view.capabilities;
  return (
    <header className="card ax-run" data-family={view.family}>
      <div className="ax-run-top">
        <h1 className="ax-run-title">{title}</h1>
        {timer}
      </div>
      <div className="ui-bar" role="progressbar" aria-label={t['ax.run.progressLabel']} aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <span style={{ width: `${total > 0 ? Math.round((answered / total) * 100) : 0}%`, background: 'var(--brand)' }} />
      </div>
      <p className="ui-hint tabular">{fillMessage(t['ax.run.answered'], { answered, total })}</p>
      {(helpLine || c.requiresIntegrity) && <p className="ui-hint">{c.requiresIntegrity ? t['ax.run.integrity'] : c.canUseAIHelp ? t['ax.run.helpOn'] : t['ax.run.helpOff']}</p>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Result                                                               */
/* ------------------------------------------------------------------ */

const STATUS_CHIP: Record<AssessmentResultView['concepts'][number]['status'], string> = { EVIDENCE_OBTAINED: 'chip chip-good', NOT_ANSWERED: 'chip', NOT_EVALUATED: 'chip chip-warn', NOT_ATTRIBUTABLE: 'chip' };

export function AssessmentResult({ view, t, conceptLabels, children }: { view: AssessmentResultView; t: T; conceptLabels: Readonly<Record<string, string>>; children?: ReactNode }) {
  const tr = t as Record<string, string>;
  const h = view.happened;
  const named = view.concepts.filter((c) => conceptLabels[c.canonicalConceptId]);
  return (
    <div className="ax-result" data-family={view.family} data-attribution={view.learningAttribution}>
      <section className="card xr-result" aria-labelledby="ax-result-title">
        <h1 id="ax-result-title" className="xr-section-name" tabIndex={-1}>{t['ax.result.title']}</h1>
        <p>{fillMessage(t['ax.result.answered'], { answered: h.answered, questions: h.questions })}</p>
        {h.marks ? <p className="ax-score tabular">{fillMessage(t['ax.result.marks'], h.marks)}</p> : h.scorePercent !== null ? <p className="ax-score tabular">{fillMessage(t['ax.result.score'], { percent: h.scorePercent })}</p> : null}
        {h.pendingReview > 0 && <p className="ui-hint">{fillMessage(t['ax.result.pending'], { count: h.pendingReview })}</p>}
      </section>

      {/* A score can exist with no learning attribution. That is a state, not an error. */}
      {view.learningAttribution === 'UNAVAILABLE' && <InlineAlert tone="info" title={t['ax.result.attribution.UNAVAILABLE']} />}
      {view.learningAttribution === 'NONE' && h.scored > 0 && <InlineAlert tone="info" title={t['ax.result.attribution.NONE']} />}

      {view.learningAttribution === 'AVAILABLE' && named.length > 0 && (
        <section className="card xr-result" aria-labelledby="ax-concepts-title">
          <h2 id="ax-concepts-title" className="xr-section-name">{t['ax.result.conceptsTitle']}</h2>
          {view.coverage.intended > 0 && <p className="ui-hint">{fillMessage(t['ax.result.coverage'], view.coverage)}</p>}
          <ul className="ax-rows">
            {named.map((c) => (
              <li key={c.canonicalConceptId} className="ax-row">
                <span>{conceptLabels[c.canonicalConceptId]}</span>
                <span className="ax-row-status">
                  {c.direction && <span className="ui-hint">{tr[`ax.result.direction.${c.direction}`]}</span>}
                  <span className={STATUS_CHIP[c.status]}>{tr[`ax.result.status.${c.status}`]}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.examGaps.some((g) => conceptLabels[g.canonicalConceptId]) && (
        <section className="card xr-result" aria-labelledby="ax-gaps-title">
          <h2 id="ax-gaps-title" className="xr-section-name">{t['ax.result.gapsTitle']}</h2>
          {/* Shown in the order the authority published them. Naming a gap here places it nowhere. */}
          <ul className="ax-list">{view.examGaps.filter((g) => conceptLabels[g.canonicalConceptId]).map((g) => <li key={`${g.canonicalConceptId}:${g.learningObjectiveId ?? ''}`}>{conceptLabels[g.canonicalConceptId]}</li>)}</ul>
        </section>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Continuation                                                         */
/* ------------------------------------------------------------------ */

export function AssessmentContinuation({ view, t, conceptLabel, children }: { view: AssessmentContinuationView; t: T; conceptLabel?: string | null; children?: ReactNode }) {
  const tr = t as Record<string, string>;
  const p = view.primary;
  return (
    <section className="card xr-result" aria-labelledby="ax-cont-title" data-testid="assessment-continuation" data-authority={view.authority} data-primary={p.kind}>
      <h2 id="ax-cont-title" className="xr-section-name">{t['ax.cont.title']}</h2>
      {p.kind === 'WAITING' && <p className="ui-hint">{t['ax.cont.WAITING']}</p>}
      <div className="xr-next-actions">
        <Link href={p.href} className="btn btn-primary btn-lg">
          {p.kind === 'WAITING' ? t['ax.cont.RETURN'] : tr[`ax.cont.${p.kind}`]}
          {p.kind === 'NEXT_CHALLENGE' && conceptLabel ? `: ${conceptLabel}` : ''}
        </Link>
        {view.secondary.map((s) => <Link key={s.kind} href={s.href} className="btn btn-ghost">{tr[`ax.cont.secondary.${s.kind}`]}</Link>)}
        {children}
      </div>
    </section>
  );
}
