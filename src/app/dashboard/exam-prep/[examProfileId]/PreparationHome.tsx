/**
 * Preparation home (objective first): one Exam Preparation Profile.
 *
 *   Tu objetivo                 the exam / subject level, its context, the Student's goal details
 *   Próximo paso recomendado    ONE clear action
 *   Tu preparación              "Preparación estimada StudyUs" -- orientation, never official readiness
 *   Qué ya tienes cubierto      what the existing learner model / results already demonstrate
 *   Qué conviene reforzar       prioritized, explained recommendations (never "no sabes")
 *   Actividades disponibles     only what readiness allows; "En preparación" says why the rest is not
 *   Qué evalúa                  governed structure only -- nothing is invented
 *
 * Never a dead end: a catalogue-only objective still shows what was chosen,
 * what is known about it and what StudyUs is preparing.
 */
import Link from 'next/link';
import type { PreparationView } from '@/lib/exam-core/objectives/preparation.service';
import type { PlannedRequirement } from '@/lib/exam-core/objectives/preparation-plan';
import { AddConceptButton, DiagnosticButton, GoalDetailsForm } from './PrepActions';

type L = Record<string, string>;
const fill = (s: string | undefined, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s ?? '');

const STATUS_TONE: Record<string, string> = { ALREADY_STRONG: 'is-good', NEEDS_CONFIRMATION: 'is-partial', NEEDS_REINFORCEMENT: 'is-warn', NO_EVIDENCE: '', NOT_YET_MAPPED: '' };
const CONCEPT_TONE: Record<string, string> = { DEMONSTRATED: 'is-good', MAINTENANCE: 'is-good', IN_PROGRESS: 'is-partial', NEEDS_REINFORCEMENT: 'is-warn', NO_EVIDENCE: '' };

export function PreparationHome({ view, labels: l, language, dateLine }: { view: PreparationView; labels: L; language: string; dateLine: string }) {
  const { profile, objective, capabilities: c, plan, next } = view;
  const practiceHref = (nodeKey: string) => `/dashboard/exams?node=${encodeURIComponent(nodeKey)}`;
  const conceptHref = (r: PlannedRequirement) => {
    const cc = r.concepts.find((x) => x.canonicalConceptId === r.recommendation.canonicalConceptId);
    return cc?.learner ? `/dashboard/subjects/${cc.learner.subjectId}/concepts/${cc.learner.studentConceptId}` : null;
  };
  const conceptName = (r: PlannedRequirement | null) => r?.concepts.find((x) => x.canonicalConceptId === r.recommendation.canonicalConceptId)?.name ?? r?.description ?? '';
  const hasActivities = c.canPractice || c.canRunReducedMock || c.canRunFullMock || c.canPlanDiploma;
  const aiceSubjects = objective.key === 'cie.aice.diploma';

  const actionFor = (r: PlannedRequirement, primary = false) => {
    const a = r.recommendation.action;
    if (a === 'CONTINUE_CONCEPT') {
      const href = conceptHref(r);
      return href ? <Link className={primary ? 'btn btn-primary prep-cta' : 'btn btn-secondary prep-cta'} href={href}>{l['prep.action.CONTINUE_CONCEPT']}</Link> : null;
    }
    if (a === 'ADD_TO_PLAN' && r.recommendation.canonicalConceptId) {
      return <AddConceptButton profileId={profile.id} learningObjectiveId={r.learningObjectiveId} canonicalConceptId={r.recommendation.canonicalConceptId} language={language} label={conceptName(r)} labels={l} />;
    }
    if (a === 'PRACTICE_AREA' && c.practiceModes[0]) {
      const area = c.practiceModes.find((p) => p.label === r.area) ?? c.practiceModes[0];
      return <Link className="btn btn-secondary prep-cta" href={practiceHref(area.nodeKey)}>{l['prep.action.PRACTICE_AREA']}</Link>;
    }
    if (a === 'DIAGNOSTIC') return <DiagnosticButton profileId={profile.id} language={language} labels={l} primary={primary} />;
    return null;
  };

  // ---- the ONE next step
  const nextAction = (() => {
    switch (next.kind) {
      case 'RESUME':
        return <Link className="btn btn-primary prep-cta" href={`/dashboard/exam-prep/attempt/${view.openAttemptId}`}>{l['prep.next.RESUME']}</Link>;
      case 'PLAN_DIPLOMA':
        return <Link className="btn btn-primary prep-cta" href="/dashboard/exams/aice">{l['prep.next.PLAN_DIPLOMA']}</Link>;
      case 'CONTINUE_CONCEPT':
      case 'ADD_TO_PLAN':
        return next.requirement ? actionFor(next.requirement, true) : null;
      case 'DIAGNOSTIC':
        return <DiagnosticButton profileId={profile.id} language={language} labels={l} />;
      case 'PRACTICE':
        return c.practiceModes[0] ? <Link className="btn btn-primary prep-cta" href={practiceHref(c.practiceModes[0].nodeKey)}>{l['prep.next.PRACTICE']}</Link> : null;
      case 'REVIEW_STRUCTURE':
        return <a className="btn btn-primary prep-cta" href="#prep-assesses">{l['prep.next.REVIEW_STRUCTURE']}</a>;
      case 'SET_GOAL_DETAILS':
        return <a className="btn btn-primary prep-cta" href="#prep-goal">{l['prep.next.SET_GOAL_DETAILS']}</a>;
      default:
        return <Link className="btn btn-primary prep-cta" href="/dashboard/subjects">{l['prep.next.EXPLORE_LEARNING']}</Link>;
    }
  })();

  const covered = plan?.requirements.filter((r) => r.status === 'ALREADY_STRONG') ?? [];
  const recs = (plan?.recommendations ?? []).filter((r) => r.status !== 'NO_EVIDENCE' || r.recommendation.action !== 'DIAGNOSTIC').slice(0, 8);
  const noEvidence = plan?.counts.NO_EVIDENCE ?? 0;
  const byArea = new Map<string, PlannedRequirement[]>();
  for (const r of plan?.requirements ?? []) {
    if (!byArea.has(r.area)) byArea.set(r.area, []);
    byArea.get(r.area)!.push(r);
  }

  return (
    <div className="prep-home">
      {/* Próximo paso recomendado */}
      <section className="card prep-next" aria-labelledby="prep-next-title">
        <h2 id="prep-next-title" className="ex-status-title">{l['prep.home.next']}</h2>
        <p className="ex-status-body">{fill(l[`prep.next.body.${next.kind}`], { concept: conceptName(next.requirement) })}</p>
        <div className="xr-next-actions">{nextAction}</div>
      </section>

      {!hasActivities && (
        <section className="card prep-empty" aria-labelledby="prep-empty-title">
          <h2 id="prep-empty-title" className="ex-status-title">{l['prep.home.empty.title']}</h2>
          <p className="ex-status-body">{c.canViewStructure ? l['prep.home.empty.body'] : l['prep.home.empty.noStructure']}</p>
        </section>
      )}

      <div className="prep-grid">
        {/* Tu objetivo */}
        <section className="card prep-section" id="prep-goal" aria-labelledby="prep-goal-title">
          <h2 id="prep-goal-title" className="ex-status-title">{l['prep.home.goal']}</h2>
          <dl className="prep-facts">
            <div><dt>{l['prep.goal.framework']}</dt><dd>{l[`prep.fw.${objective.framework}`]}</dd></div>
            {objective.context.programme ? <div><dt>{l['prep.goal.programme']}</dt><dd>{objective.context.programme}</dd></div> : null}
            {objective.context.groups.length ? <div><dt>{l['prep.goal.group']}</dt><dd>{objective.context.groups.join(' / ')}</dd></div> : null}
            {objective.context.subject ? <div><dt>{l['prep.goal.subject']}</dt><dd>{objective.context.subject}{objective.context.syllabusCode && !objective.context.subject.includes(objective.context.syllabusCode) ? ` (${objective.context.syllabusCode})` : ''}</dd></div> : null}
            {objective.context.level ? <div><dt>{l['prep.goal.level']}</dt><dd>{objective.context.level}</dd></div> : null}
            {objective.context.version ? <div><dt>{l['prep.goal.version']}</dt><dd>{objective.context.version}</dd></div> : null}
            <div><dt>{l['prep.goal.date']}</dt><dd>{dateLine}</dd></div>
          </dl>
          <details className="ui-disclosure">
            <summary>{l['prep.goal.edit']}</summary>
            <div className="ui-disclosure-body">
              <GoalDetailsForm profileId={profile.id} initial={{ examDate: profile.examDate ? String(profile.examDate).slice(0, 10) : null, targetInstitutionName: profile.targetInstitutionName ?? null, targetQualification: profile.targetQualification ?? null }} labels={l} />
            </div>
          </details>
          <div className="xr-next-actions">
            <Link className="btn btn-secondary prep-cta" href="/dashboard/exam-prep#prep-choose">{l['prep.home.changeGoal']}</Link>
          </div>
        </section>

        {/* Tu preparación -- Preparación estimada StudyUs */}
        <section className="card prep-section" aria-labelledby="prep-estimate-title">
          <h2 id="prep-estimate-title" className="ex-status-title">{l['prep.home.estimate']}</h2>
          <p className="ui-hint">{l['prep.home.reuseNote']}</p>
          <p className="ui-hint">{l['prep.home.examSpecificNote']}</p>
          {plan ? (
            <>
              <ul className="prep-counts">
                {(['ALREADY_STRONG', 'NEEDS_CONFIRMATION', 'NEEDS_REINFORCEMENT', 'NO_EVIDENCE', 'NOT_YET_MAPPED'] as const).map((s) => (
                  <li key={s}><span className={`xr-pill ${STATUS_TONE[s]}`}>{l[`prep.req.${s}`]}</span> <strong>{plan.counts[s]}</strong></li>
                ))}
              </ul>
              <p className="ex-status-body">
                {plan.coverage.mapped > 0 ? fill(l['prep.home.coverage'], { n: plan.coverage.mappedWithEvidence, m: plan.coverage.mapped }) : l['prep.home.coverageNone']}
              </p>
              {noEvidence > 0 ? <p className="ui-hint">{fill(l['prep.home.noEvidenceCount'], { n: noEvidence })}</p> : null}
            </>
          ) : (
            <p className="ex-status-body">{c.canPlanDiploma ? l['prep.home.planner'] : l['prep.home.noRequirements']}</p>
          )}
          <p className="ui-hint">{l['prep.home.estimateNote']}</p>
        </section>
      </div>

      {/* Qué conviene reforzar */}
      {plan && (
        <section className="card prep-section" aria-labelledby="prep-reinforce-title">
          <h2 id="prep-reinforce-title" className="ex-status-title">{l['prep.home.reinforce']}</h2>
          {recs.length === 0 ? (
            <p className="ex-status-body">{l['prep.home.reinforceEmpty']}</p>
          ) : (
            <ol className="prep-recs">
              {recs.map((r) => (
                <li key={r.learningObjectiveId} className="prep-rec">
                  <div className="prep-rec-head">
                    <span className="prep-rec-name">{r.description}</span>
                    <span className={`xr-pill ${STATUS_TONE[r.status]}`}>{l[`prep.req.${r.status}`]}</span>
                    <span className="xr-pill">{l[`prep.priority.${r.priority.band}`]}</span>
                  </div>
                  <p className="ui-hint">{r.area}</p>
                  {r.concepts.length > 0 && (
                    <ul className="prep-concepts">
                      {r.concepts.map((cc) => (
                        <li key={cc.canonicalConceptId}>
                          <span>{cc.name}</span> <span className={`xr-pill ${CONCEPT_TONE[cc.label]}`}>{l[`prep.concept.${cc.label}`]}</span>
                          {cc.alsoRelevantFor.length ? <span className="ui-hint prep-also">{fill(l['prep.home.alsoFor'], { exam: cc.alsoRelevantFor.join(', ') })}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <details className="prep-why">
                    <summary>{l['prep.home.why']}</summary>
                    <ul>
                      {r.recommendation.reasons.map((why) => <li key={why}>{fill(l[`prep.reason.${why}`], { exam: (why === 'EXAM_GAP' ? r.recommendation.gapExam : r.recommendation.otherExam) ?? '' })}</li>)}
                      {r.priority.factors.length ? <li>{fill(l['prep.factors'], { list: r.priority.factors.map((f) => l[`prep.factor.${f}`]).join(', ') })}</li> : null}
                    </ul>
                  </details>
                  <div className="xr-next-actions">{actionFor(r)}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* Qué ya tienes cubierto */}
      {plan && (
        <section className="card prep-section" aria-labelledby="prep-covered-title">
          <h2 id="prep-covered-title" className="ex-status-title">{l['prep.home.covered']}</h2>
          {covered.length === 0 ? (
            <p className="ex-status-body">{l['prep.home.coveredEmpty']}</p>
          ) : (
            <ul className="prep-covered">
              {covered.map((r) => (
                <li key={r.learningObjectiveId}>
                  <span>{r.description}</span>{' '}
                  {r.concepts.map((cc) => <span key={cc.canonicalConceptId} className={`xr-pill ${CONCEPT_TONE[cc.label]}`}>{cc.name}: {l[`prep.concept.${cc.label}`]}</span>)}
                  {!r.formatConfirmed ? <span className="ui-hint prep-also">{l['prep.reason.CONFIRM_IN_EXAM_FORMAT']}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Actividades disponibles / En preparación */}
      <section className="card prep-section" aria-labelledby="prep-activities-title">
        <h2 id="prep-activities-title" className="ex-status-title">{l['prep.home.activities']}</h2>
        <ul className="prep-activities">
          {c.canPlanDiploma && (
            <li>
              <strong>{l['prep.cap.planner']}</strong>
              <span className="ui-hint">{l['prep.home.planner']}</span>
              <Link className="btn btn-primary prep-cta" href="/dashboard/exams/aice">{l['prep.next.PLAN_DIPLOMA']}</Link>
            </li>
          )}
          {c.canRunDiagnostic && (
            <li>
              <strong>{l['prep.diag.title']}</strong>
              <span className="ui-hint">{view.diagnostic ? l['prep.diag.done'] : l['prep.diag.body']}</span>
              <DiagnosticButton profileId={profile.id} language={language} labels={l} primary={false} />
            </li>
          )}
          {c.practiceModes.length > 0 && (
            <li>
              <strong>{l['prep.cap.practice']}</strong>
              <span className="prep-links">
                {c.practiceModes.map((p) => <Link key={p.nodeKey} className="btn btn-secondary prep-cta" href={practiceHref(p.nodeKey)}>{p.label}</Link>)}
              </span>
            </li>
          )}
          {c.reducedMocks.map((m) => (
            <li key={m.nodeKey}>
              <strong>{l['prep.cap.reducedMock']}{m.purpose === 'FULL_TEST' ? '' : ` · ${m.label}`}</strong>
              <span className="ui-hint">{m.lengthCoveragePercent !== null ? fill(l['prep.cap.reducedMockCoverage'], { n: m.lengthCoveragePercent }) : l['prep.cap.reducedMockNote']}</span>
              <Link className="btn btn-secondary prep-cta" href={practiceHref(m.nodeKey)}>{l['prep.cap.start']}</Link>
            </li>
          ))}
          {c.fullMocks.map((m) => (
            <li key={m.nodeKey}>
              <strong>{l['prep.cap.fullMock']}{m.purpose === 'FULL_TEST' ? '' : ` · ${m.label}`}</strong>
              <span className="ui-hint">{l['prep.cap.fullMockNote']}</span>
              <Link className="btn btn-secondary prep-cta" href={practiceHref(m.nodeKey)}>{l['prep.cap.start']}</Link>
            </li>
          ))}
          {c.canUseLearningBridge && (
            <li>
              <strong>{l['prep.cap.bridge']}</strong>
              <span className="ui-hint">{l['prep.cap.bridgeOn']}</span>
            </li>
          )}
          {!hasActivities && <li><span className="ui-hint">{l['prep.home.noActivities']}</span></li>}
        </ul>
        {c.unavailableReasons.length > 0 && (
          <>
            <h3 className="prep-subtitle">{l['prep.home.inPrep']}</h3>
            <ul className="prep-unavailable">
              {c.unavailableReasons.map((u) => (
                <li key={u.capability}><strong>{l[`prep.capName.${u.capability}`]}</strong> — {l[`prep.unavailable.${u.reason}`]}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Qué evalúa */}
      <section className="card prep-section" id="prep-assesses" aria-labelledby="prep-assesses-title">
        <h2 id="prep-assesses-title" className="ex-status-title">{l['prep.home.assesses']}</h2>
        {objective.description ? <p className="ex-status-body">{objective.description}</p> : null}
        {plan && byArea.size > 0 ? (
          [...byArea.entries()].map(([area, reqs]) => (
            <div key={area} className="prep-area">
              <h3 className="prep-subtitle">{area}</h3>
              <ul className="prep-reqs">{reqs.map((r) => <li key={r.learningObjectiveId}>{r.description} <span className={`xr-pill ${STATUS_TONE[r.status]}`}>{l[`prep.req.${r.status}`]}</span></li>)}</ul>
            </div>
          ))
        ) : objective.catalogParts.length > 0 ? (
          <>
            <h3 className="prep-subtitle">{l['prep.home.catalogParts']}</h3>
            <ul className="prep-reqs">
              {objective.catalogParts.map((p) => (
                <li key={p.key}>
                  {p.label}
                  {p.facts ? <span className="ui-hint"> · {Object.entries(p.facts).filter(([k]) => ['minutes', 'marks', 'items', 'weightPercent', 'credits'].includes(k)).map(([k, v]) => fill(l[`prep.fact.${k}`], { n: v })).join(' · ')}</span> : null}
                </li>
              ))}
            </ul>
            {!c.canViewStructure ? <p className="ui-hint">{l['prep.home.structurePending']}</p> : null}
          </>
        ) : (
          <p className="ex-status-body">{l['prep.home.structurePending']}</p>
        )}
        {aiceSubjects ? <p className="ui-hint">{l['prep.home.aiceSubjects']}</p> : null}
      </section>
    </div>
  );
}
