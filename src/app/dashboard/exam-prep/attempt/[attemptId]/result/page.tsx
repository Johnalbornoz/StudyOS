import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { scoreAndRecordAttemptResult } from '@/lib/exam-core/results.service';
import { masteryStateLabel } from '@/lib/knowledge-state-labels';
import { PageIntro } from '@/components/ui/PageIntro';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { StatusBadge, toneForReadinessStatus } from '@/components/ui/StatusBadge';
import { buildLearningBridge } from '@/lib/exam-core/learning-bridge.service';
import { findInstanceByAttempt } from '@/lib/exam-core/exam-instance.service';
import { ConceptRequestButton, RetakeButton, ReinforceButton } from './BridgeActions';
import MathText from '@/components/MathText';

/**
 * Track B / B10 -- the result of one submitted attempt.
 *
 * Keeps two truths visibly apart:
 *   - EXAM truth: this attempt's score / band, sections, objectives (from
 *     exam_attempt_results, scored by the frozen policy);
 *   - LEARNING truth: the canonical state of the mapped concepts (read from
 *     the Learning Engine, never derived from the score) and the next step,
 *     which the Learning Engine owns (concept page / Today).
 * Owner only (the Student's own attempt); a foreign id is a 404.
 */
export default async function AttemptResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const attempt = await getSimulationAttempt(attemptId);
  if (!attempt || attempt.studentId !== studentId) notFound();
  if (attempt.status !== 'COMPLETED') redirect(`/dashboard/exam-prep/attempt/${attempt.id}`);

  // A submission whose scoring did not finish (e.g. interrupted request) is scored now -- idempotently.
  await scoreAndRecordAttemptResult(attempt.id).catch(() => null);
  const view = await getAttemptResultView(attempt.id);
  if (!view) notFound();
  const result = view.result;

  const pct = (f: number | null) => (f === null ? '—' : `${Math.round(f * 100)}%`);
  const strengths = view.objectives.filter((o) => o.classification === 'STRENGTH');
  const gaps = view.objectives.filter((o) => o.classification === 'GAP' || o.classification === 'DEVELOPING');
  const linkedConcepts = view.objectives.flatMap((o) => o.concepts.filter((c) => c.studentConceptId && c.subjectId).map((c) => ({ ...c, classification: o.classification })));
  const firstGapConcept = linkedConcepts.find((c) => c.classification === 'GAP') ?? linkedConcepts.find((c) => c.classification === 'DEVELOPING') ?? null;
  const sitting = [view.exam.examYear, view.exam.examSession].filter(Boolean).join(' · ');
  // Exam V2: the instance (mode), the Exam -> Learning bridge and the retest loop.
  const instance = await findInstanceByAttempt(attempt.id).catch(() => null);
  // Soft-deleted by the Student: hidden from every visible surface (the result itself is preserved).
  if (instance?.status === 'DELETED') notFound();
  const bridge = result && result.status === 'SCORED' ? await buildLearningBridge({ simulationAttemptId: attempt.id, studentId, objectives: view.objectives }).catch(() => []) : [];
  const v2: Record<string, string> = Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith('exv2.')));
  const fmt = (key: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), tr[key] ?? key);

  return (
    <div className="xp-page xp-page--wide">
      <PageIntro
        crumb={<Link href={`/dashboard/exam-prep/${view.examProfileId}`}>{view.exam.definitionName || t['examPrep.title']}</Link>}
        title={t['examPrep.result.title']}
        lead={[tr[`ex.type.${view.simulationType}`] ?? view.simulationType, tr[`ex.timing.${view.timingMode}`] ?? view.timingMode, sitting].filter(Boolean).join(' · ')}
      />

      {view.exam.contentStatus && <p className="ui-hint" style={{ margin: 0 }}>{tr[`exam.contentStatus.${view.exam.contentStatus}`] ?? ''}</p>}
      {result?.status === 'INVALIDATED' && <InlineAlert tone="warning" title={t['examPrep.result.invalidated']} />}
      {instance && <p className="ui-hint" style={{ margin: 0 }}>{tr[`exv2.mode.${instance.mode}`]}{instance.mode === 'CHALLENGE' ? ` · ${tr['exv2.challenge.label']}` : ''}</p>}
      {result && result.reviewRequiredCount > 0 && <InlineAlert tone="info" title={fmt('exv2.result.reviewRequired', { n: result.reviewRequiredCount })} />}

      {!result ? (
        <div className="card xr-card">{t['examPrep.result.pending']}</div>
      ) : (
        <>
          <section className="card xr-result" aria-labelledby="xr-score-title">
            <h2 id="xr-score-title" className="xr-kicker">{view.reporting?.scaleNote === 'NO_OFFICIAL_SCALE' ? tr['exv2.result.estimatedReadiness'] : t['examPrep.result.examScore']}</h2>
            {/* Nothing gradable (e.g. every item unavailable) is "no score", never 0%. */}
            {result.maxScore === 0 ? (
              <p className="ui-hint">{t['examPrep.attempt.noGradedItems']}</p>
            ) : result.scoringStatus === 'SCORED' ? (
              <p className="xr-score">
                {result.finalLabel ?? (result.finalScore === null ? '—' : `${result.finalScore}${result.provenance?.final?.unit === '%' ? '%' : ''}`)}
                {result.finalLabel === null && result.provenance?.final?.unit && result.provenance.final.unit !== '%' && <span className="xr-score-unit"> {result.provenance.final.unit}</span>}
              </p>
            ) : (
              <p className="ui-hint">{t['examPrep.result.noPolicy']}</p>
            )}
            <p className="xr-raw">{t['examPrep.result.raw'].replace('{earned}', String(result.rawScore)).replace('{available}', String(result.maxScore))}</p>
            <p className="ui-hint">{view.reporting?.scaleNote === 'NO_OFFICIAL_SCALE' ? tr['exv2.result.noOfficialScale'] : t['examPrep.result.examScoreNote']}</p>
            {(view.completion || view.minutesUsed) && (
              <p className="ui-hint">
                {[view.completion ? fmt('exv2.result.completion', { answered: view.completion.answered, total: view.completion.total }) : null, view.minutesUsed ? fmt('exv2.result.minutesUsed', { n: view.minutesUsed }) : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {result.scoringStatus === 'SCORED' && result.provenance?.final?.official === false && (
              <p className="ui-hint">
                {t['examPrep.result.policy']}: {result.provenance?.scoringModel?.name ?? '—'} · {t['examPrep.result.unofficial']}
              </p>
            )}
          </section>

          {result.strictReadiness && result.maxScore > 0 && (
            <section className="card exv2-strict" aria-labelledby="exv2-strict-title">
              <h2 id="exv2-strict-title" className="xr-kicker">{tr['exv2.strict.title']}</h2>
              <p className="xr-score">{result.strictReadiness.percent === null ? '—' : `${result.strictReadiness.percent}%`}</p>
              <p className="xr-raw">{t['examPrep.result.raw'].replace('{earned}', String(result.strictReadiness.earned)).replace('{available}', String(result.strictReadiness.available))}</p>
              <p className="ui-hint">{tr['exv2.strict.note']}</p>
            </section>
          )}

          {result.sectionResults.length > 1 && (
            <section className="card xr-result" aria-labelledby="exv2-areas-title">
              <h2 id="exv2-areas-title" className="xr-section-name">{tr['exv2.result.byArea']}</h2>
              {(view.reporting?.groups ?? result.sectionResults.map((sr) => ({ key: sr.key, label: sr.name, sectionKeys: [sr.key], institutionDefined: false }))).map((g) => {
                const secs = result.sectionResults.filter((sr) => g.sectionKeys.includes(sr.key));
                if (secs.length === 0) return null;
                const earned = secs.reduce((n, sr) => n + sr.earned, 0);
                const available = secs.reduce((n, sr) => n + sr.available, 0);
                return (
                  <div key={g.key} className="exv2-area">
                    <div className="xr-bar-head">
                      <span className="xr-bar-name">{g.label}</span>
                      <span className="xr-bar-value">{available > 0 ? pct(earned / available) : '—'} · {t['examPrep.result.raw'].replace('{earned}', String(earned)).replace('{available}', String(available))}</span>
                    </div>
                    {secs.map((sr) => {
                      const skills = view.objectives.filter((o) => o.componentId === sr.componentId);
                      return (
                        <div key={sr.componentId}>
                          {secs.length > 1 && <p className="ui-hint" style={{ margin: 0 }}><strong>{sr.name}</strong> · {pct(sr.fraction)}</p>}
                          <ul className="xr-objectives">
                            {skills.map((o) => (
                              <li key={o.learningObjectiveId}>
                                <span>{o.description}</span>{' '}
                                <span className={`xr-pill ${o.classification === 'STRENGTH' ? 'is-good' : o.classification === 'GAP' ? 'is-warn' : ''}`}>{tr[`examPrep.result.class.${o.classification}`]} · {pct(o.fraction)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    {g.institutionDefined && (
                      <p className="ui-hint">
                        {view.institutionPolicies.length > 0 ? tr['exv2.result.institutionPolicy'] : tr['exv2.result.institutionDefined']}
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <section className="card xr-result" aria-labelledby="xr-sections-title">
            <h2 id="xr-sections-title" className="xr-section-name">{t['examPrep.result.bySection']}</h2>
            <ul className="xr-bars">
              {result.sectionResults.map((s) => (
                <li key={s.componentId} className="xr-bar-row">
                  <div className="xr-bar-head">
                    <span className="xr-bar-name">{s.name}</span>
                    <span className="xr-bar-value">{pct(s.fraction)} · {t['examPrep.result.raw'].replace('{earned}', String(s.earned)).replace('{available}', String(s.available))}</span>
                  </div>
                  <div className="xr-bar" role="img" aria-label={`${s.name}: ${pct(s.fraction)}`}>
                    <span className="xr-bar-fill" style={{ width: `${Math.round((s.fraction ?? 0) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <div className="xr-two">
            <section className="card xr-result" aria-labelledby="xr-strengths-title">
              <h2 id="xr-strengths-title" className="xr-section-name">{t['examPrep.result.strengths']}</h2>
              {strengths.length === 0 ? <p className="ui-hint">{t['examPrep.result.none']}</p> : (
                <ul className="xr-objectives">
                  {strengths.map((o) => <li key={o.learningObjectiveId}><span>{o.description}</span> <span className="xr-pill is-good">{pct(o.fraction)}</span></li>)}
                </ul>
              )}
            </section>
            <section className="card xr-result" aria-labelledby="xr-gaps-title">
              <h2 id="xr-gaps-title" className="xr-section-name">{t['examPrep.result.gaps']}</h2>
              {gaps.length === 0 ? <p className="ui-hint">{t['examPrep.result.none']}</p> : (
                <ul className="xr-objectives">
                  {gaps.map((o) => (
                    <li key={o.learningObjectiveId}>
                      <span>{o.description}</span> <span className={`xr-pill ${o.classification === 'GAP' ? 'is-warn' : ''}`}>{tr[`examPrep.result.class.${o.classification}`]} · {pct(o.fraction)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card xr-result" aria-labelledby="xr-learning-title">
            <h2 id="xr-learning-title" className="xr-section-name">{t['examPrep.result.learningState']}</h2>
            <p className="ui-hint">{t['examPrep.result.learningStateNote']}</p>
            {linkedConcepts.length === 0 ? (
              <p className="ui-hint">{t['examPrep.result.notLinked']}</p>
            ) : (
              <ul className="xr-objectives">
                {linkedConcepts.map((c) => (
                  <li key={`${c.canonicalConceptId}-${c.studentConceptId}`}>
                    <span>{c.name}</span>{' '}
                    <span className="xr-pill">{c.masteryState ? masteryStateLabel(c.masteryState, t) : '—'}</span>{' '}
                    <Link href={`/dashboard/subjects/${c.subjectId}/concepts/${c.studentConceptId}`}>{t['examPrep.result.studyConcept']}</Link>
                  </li>
                ))}
              </ul>
            )}
            {view.readinessStatus && view.readinessStatus !== 'INSUFFICIENT_EVIDENCE' && (
              <p style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', margin: 0 }}>
                <span className="ui-label">{t['examPrep.overallStatus']}</span>
                <StatusBadge label={tr[`examPrep.status.${view.readinessStatus}`] ?? ''} tone={toneForReadinessStatus(view.readinessStatus as never)} />
              </p>
            )}
          </section>

          {bridge.length > 0 && (
            <section className="card xr-result" aria-labelledby="exv2-bridge-title">
              <h2 id="exv2-bridge-title" className="xr-section-name">{tr['exv2.bridge.title']}</h2>
              <ul className="exv2-bridge">
                {bridge.map((b) => (
                  <li key={b.learningObjectiveId} className="exv2-bridge-item">
                    <p className="exv2-bridge-text">
                      {fmt('exv2.bridge.need', { topic: b.action.kind === 'PROPOSE' ? b.description : b.action.conceptName })}{' '}
                      {b.questions > 0 && <span className="ui-hint">{fmt('exv2.bridge.missed', { missed: b.questionsMissed, total: b.questions })}</span>}
                    </p>
                    {b.action.kind === 'REINFORCE' ? (
                      <a className="btn btn-primary" href={b.action.href}>{tr['exv2.bridge.reinforce']}</a>
                    ) : b.action.kind === 'ADD_AND_REINFORCE' ? (
                      <ReinforceButton simulationAttemptId={attempt.id} learningObjectiveId={b.learningObjectiveId} canonicalConceptId={b.action.canonicalConceptId} language={locale} labels={v2} />
                    ) : b.action.proposalStatus === 'REJECTED' ? (
                      <span className="ui-hint">{tr['exv2.bridge.notAvailable']}</span>
                    ) : (
                      <ConceptRequestButton simulationAttemptId={attempt.id} learningObjectiveId={b.learningObjectiveId} requested={b.action.requested} labels={v2} />
                    )}
                  </li>
                ))}
              </ul>
              <p className="ui-hint">{tr['exv2.bridge.note']}</p>
            </section>
          )}

          <section className="card xr-result" aria-labelledby="xr-next-title">
            <h2 id="xr-next-title" className="xr-section-name">{t['examPrep.result.nextStep']}</h2>
            <p className="ui-hint">{t['examPrep.result.nextStepBody']}</p>
            <div className="xr-next-actions">
              {firstGapConcept ? (
                <Link className="btn btn-primary" href={`/dashboard/subjects/${firstGapConcept.subjectId}/concepts/${firstGapConcept.studentConceptId}`}>
                  {t['examPrep.result.studyConcept']}: {firstGapConcept.name}
                </Link>
              ) : (
                <Link className="btn btn-primary" href="/dashboard/today">{t['ex.continueToday']}</Link>
              )}
              {instance && <RetakeButton instanceId={instance.id} labels={v2} />}
              <Link className="btn" href={`/dashboard/exam-prep/${view.examProfileId}`}>{t['examPrep.result.backToPrep']}</Link>
            </div>
          </section>

          <section className="card xr-result" aria-labelledby="xr-review-title">
            <h2 id="xr-review-title" className="xr-section-name">{t['examPrep.result.review']}</h2>
            {view.review === null ? (
              <p className="ui-hint">{t['examPrep.result.reviewHidden']}</p>
            ) : (
              <ol className="xr-review">
                {view.review.map((r) => (
                  <li key={r.targetIndex} className="xr-review-item">
                    <details>
                      <summary>
                        <span className="xr-review-num">{t['examPrep.run.question'].replace('{n}', String(r.targetIndex + 1))}</span>
                        <span className="xr-review-section">{r.sectionName}</span>
                        <span className={`xr-pill is-${r.status.toLowerCase()}`}>{tr[`examPrep.result.status.${r.status}`]}</span>
                        <span className="xr-review-marks">{r.available > 0 ? `${r.earned}/${r.available}` : ''}</span>
                      </summary>
                      <div className="xr-review-body">
                        {r.stimulusTitle && <p className="ui-hint">{r.stimulusTitle}</p>}
                        {r.question && <p>{r.question}</p>}
                        {r.reviewRequired && <p className="xr-notice">{tr['exv2.result.itemReview']}</p>}
                        <p><strong>{t['examPrep.result.yourAnswer']}:</strong> {r.answerKind === 'PORTFOLIO' ? tr['exv2.result.portfolioAnswer'] : r.answerKind === 'MATH' && r.yourAnswer ? <MathText text={r.yourAnswer} /> : r.yourAnswer ?? '—'}</p>
                        {r.rubric && (
                          <div>
                            <p><strong>{tr['exv2.result.criteria']}:</strong> {r.rubric.criteria.map((c) => `${c.id} ${c.name}: ${c.awarded}/${c.max}`).join(' · ')}</p>
                            {r.rubric.evidence.length > 0 && (
                              <>
                                <p><strong>{tr['exv2.result.evidence']}:</strong></p>
                                <ul className="xr-objectives">
                                  {r.rubric.evidence.map((e, k) => <li key={k}>{e.criterionId} — {e.quote}</li>)}
                                </ul>
                              </>
                            )}
                            {r.rubric.rationale && <p className="ui-hint"><strong>{tr['exv2.result.assessorNote']}:</strong> {r.rubric.rationale}</p>}
                          </div>
                        )}
                        {r.correctAnswer && r.answerKind !== 'PORTFOLIO' && !r.rubric && <p><strong>{t['examPrep.result.correctAnswer']}:</strong> {r.answerKind === 'MATH' ? <MathText text={r.correctAnswer} /> : r.correctAnswer}</p>}
                        {r.explanation && <p className="ui-hint">{r.explanation}</p>}
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
