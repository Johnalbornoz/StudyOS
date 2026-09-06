import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getConceptEvidenceSummary, getConceptEvidenceHistory } from '@/services/learner-model.service';
import { getConceptView } from '@/lib/learner-twin';
import { getLearningDebtCriteriaProgress } from '@/services/learning-debt.service';
import { getConceptTransferDepth } from '@/services/transfer-read.service';
import { transferDepthLabel } from '@/lib/transfer-progression-labels';
import { db } from '@/lib/db';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { sourceLabel, resultLabel, resultColor, criterionStatusLabel } from '@/lib/concept-evidence-labels';
import { masteryStateLabel, masteryStateColor, knowledgeKpis } from '@/lib/knowledge-state-labels';
import { formatMasteryPercent, tryMasteryScore } from '@/lib/mastery-format';
import { conceptSituation, conceptSituationLabel } from '@/lib/concept-situation-labels';
import { getConceptMissionView } from '@/services/concept-mission-view.service';
import ConceptMission from './ConceptMission';

function daysBetween(date: Date | string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function relativeDay(date: Date | string | null, t: ReturnType<typeof getMessages>): string {
  const days = daysBetween(date);
  if (days === null) return t['conceptDetail.notYet'];
  if (days <= 0) return t['conceptDetail.today'];
  return t['conceptDetail.daysAgo'].replace('{days}', String(days));
}

function futureDay(date: string | null, t: ReturnType<typeof getMessages>): string {
  if (!date) return t['conceptDetail.notYet'];
  return new Date(date).toLocaleDateString();
}

/**
 * Concept Mission (LX-3): the learner's primary learning context for one
 * concept -- identity + goal + journey + the ONE next action on top
 * (<ConceptMission>, fed by the pure `buildConceptMissionView` over
 * canonical outputs), with every measured number (mastery %, capability
 * dimensions, retention, transfer, evidence strength, learning-debt
 * criteria) demoted below a "More about my progress" disclosure.
 *
 * This page chooses no pedagogy. The next action is a verbatim
 * pass-through of Phase 4's LearningDecision via the Mission read
 * boundary; the earlier page-local next-action / CTA-ordering heuristic
 * and its manual quiz-link row were removed in LX-3. Numbers in the
 * disclosure still come only from canonical services -- no invented
 * metric, no LLM-generated explanation.
 */
export default async function ConceptDetailPage({
  params,
}: {
  params: Promise<{ id: string; conceptId: string }>;
}) {
  const { id: subjectId, conceptId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const [subjectResult, conceptResult] = await Promise.all([
    query(`SELECT name FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]),
    query(
      `SELECT COALESCE(cl.label, c.canonical_id) AS label
       FROM concepts c
       LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $3
       WHERE c.id = $1 AND c.subject_id = $2`,
      [conceptId, subjectId, locale]
    ),
  ]);
  const subject = subjectResult.rows[0];
  const concept = conceptResult.rows[0];
  if (!subject || !concept) notFound();

  const goalFallbackText = t['conceptMission.goalFallbackTemplate'].replace('{concept}', concept.label);

  const [missionResult, conceptView, evidence, activeDebt, history, transferDepth, knowledgeState] = await Promise.all([
    getConceptMissionView(studentId, subjectId, conceptId, locale, goalFallbackText),
    getConceptView(studentId, conceptId),
    getConceptEvidenceSummary(studentId, conceptId),
    query(
      `SELECT id FROM learning_debt WHERE student_id = $1 AND concept_id = $2 AND status IN ('active', 'monitoring')`,
      [studentId, conceptId]
    ),
    getConceptEvidenceHistory(studentId, conceptId, 20),
    getConceptTransferDepth(db, studentId, conceptId).catch(() => null),
    getConceptKnowledgeState(studentId, conceptId),
  ]);
  if (missionResult.status === 'NOT_FOUND') notFound();
  const missionView = missionResult.view;
  const debtCriteria = activeDebt.rows.length > 0 ? await getLearningDebtCriteriaProgress(studentId, conceptId) : null;

  // Phase 1C: the "More about my progress" numbers -- sourced from the
  // canonical getConceptView projection (mastery / independence /
  // memory / metacognition), same six fields and null-safety as before.
  // "retention" here is deliberately `100 - forgettingRisk` (a
  // forward-looking retrievability estimate), NOT the Knowledge State
  // retention DIMENSION (shown separately in that card).
  const state = conceptView
    ? {
        masteryScore: conceptView.mastery.score,
        independentMastery: conceptView.independence.independentMastery,
        retention: conceptView.memory.forgettingRisk !== null ? 100 - conceptView.memory.forgettingRisk : null,
        evidenceStrength: conceptView.independence.evidenceStrength,
        confidence: conceptView.metacognition.confidence,
        confidenceCalibration: conceptView.metacognition.confidenceCalibration,
      }
    : null;

  const lastPracticed = conceptView?.memory.lastSuccessfulRetentionAt ?? null;
  const nextReviewDate = conceptView?.memory.nextReviewAt ?? null;

  const whyFacts: string[] = [];
  if (evidence.totalAttempts > 0) {
    whyFacts.push(
      t['conceptDetail.recentPracticeQuestions']
        .replace('{correct}', String(evidence.correctAttempts))
        .replace('{total}', String(evidence.totalAttempts))
    );
  }
  if (evidence.soloAttempts > 0) {
    whyFacts.push(
      t['conceptDetail.soloAttemptsFact']
        .replace('{correct}', String(evidence.soloCorrect))
        .replace('{total}', String(evidence.soloAttempts))
    );
  }
  if (evidence.hintsUsedTotal > 0) {
    whyFacts.push(t['conceptDetail.hintsUsedFact'].replace('{count}', String(evidence.hintsUsedTotal)));
  }
  if (evidence.realExamCount > 0) {
    whyFacts.push(
      t['conceptDetail.schoolAssessmentFact']
        .replace('{count}', String(evidence.realExamCount))
        .replace('{score}', String(evidence.realExamAvgScore ?? '-'))
    );
  }
  if (evidence.lastIndependentEvidenceDate) {
    whyFacts.push(
      t['conceptDetail.lastIndependentEvidenceFact'].replace('{time}', relativeDay(evidence.lastIndependentEvidenceDate, t))
    );
  }

  // One plain-language situation label (canonical Knowledge State +
  // memory status -> one of seven fixed phrases). Demoted into the
  // disclosure in LX-3: the Journey now answers "where am I" up top.
  const situation = knowledgeState
    ? conceptSituation(knowledgeState.masteryState, knowledgeState.validationReadiness, conceptView?.memory.memoryStatus ?? null)
    : null;

  const evidenceStrengthLabel =
    state?.evidenceStrength === 'HIGH'
      ? t['conceptDetail.evidenceStrengthHigh']
      : state?.evidenceStrength === 'MEDIUM'
      ? t['conceptDetail.evidenceStrengthMedium']
      : state?.evidenceStrength === 'LOW'
      ? t['conceptDetail.evidenceStrengthLow']
      : t['dashboard.notEnoughEvidence'];

  return (
    <div style={{ maxWidth: 640 }}>
      <ConceptMission view={missionView} studentId={studentId} conceptId={conceptId} locale={locale} />

      {state && (
        <details className="cm-more" style={{ marginBottom: 'var(--space-6)' }}>
          <summary style={{ cursor: 'pointer', fontSize: 16, fontWeight: 650 }}>
            {t['conceptMission.moreTitle']}
          </summary>
          <p style={{ margin: '6px 0 var(--space-4)', fontSize: 13, color: 'var(--text-muted)' }}>
            {t['conceptMission.moreHint']}
          </p>

          {situation && (
            <p style={{ margin: '0 0 var(--space-4)', fontSize: 13.5, color: 'var(--text-secondary)' }}>
              <span className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.situationTitle']}:</span>{' '}
              {conceptSituationLabel(situation, t)}
            </p>
          )}

          <h3 style={{ fontSize: 14, marginBottom: 'var(--space-3)' }}>{t['conceptDetail.yourLearning']}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.mastery']}</div>
              <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>{formatMasteryPercent(tryMasteryScore(state.masteryScore, `concept detail ${conceptId}`))}</div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['dashboard.freshness']}</div>
              <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>
                {state.retention !== null ? `${Math.round(state.retention)}%` : t['dashboard.notEnoughEvidence']}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{t['conceptDetail.freshnessCaption']}</div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['dashboard.independentMastery']}</div>
              <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>
                {state.independentMastery !== null ? `${state.independentMastery}%` : t['dashboard.notEnoughEvidence']}
              </div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.confidence']}</div>
              <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>
                {state.confidence !== null ? `${state.confidence}%` : t['dashboard.notEnoughEvidence']}
              </div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['dashboard.confidenceCalibration']}</div>
              <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>
                {state.confidenceCalibration.score !== null ? `${state.confidenceCalibration.score}%` : t['dashboard.notEnoughEvidence']}
              </div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.evidenceStrength']}</div>
              <div style={{ fontSize: 20, fontWeight: 650, lineHeight: 1.4 }}>{evidenceStrengthLabel}</div>
            </div>
            <div
              className="card"
              role="group"
              aria-label={`${t['conceptDetail.transfer']}: ${transferDepthLabel(transferDepth, t)}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
            >
              <div className="label" style={{ color: 'var(--text-muted)' }} aria-hidden="true">{t['conceptDetail.transfer']}</div>
              <div style={{ fontSize: 16, fontWeight: 650, lineHeight: 1.35 }} aria-hidden="true">
                {transferDepthLabel(transferDepth, t)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-6)', fontSize: 14 }}>
            <div>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.lastDemonstrated']}</div>
              <div>{relativeDay(lastPracticed, t)}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.nextReview']}</div>
              <div>{futureDay(nextReviewDate, t)}</div>
            </div>
          </div>

          {knowledgeState && (
            <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>{t['knowledgeState.sectionTitle']}</h3>
                <span
                  style={{
                    fontSize: 12.5, fontWeight: 650, color: masteryStateColor(knowledgeState.masteryState),
                    border: `1px solid ${masteryStateColor(knowledgeState.masteryState)}`, borderRadius: 999, padding: '2px 10px',
                  }}
                >
                  {masteryStateLabel(knowledgeState.masteryState, t)}
                </span>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {knowledgeKpis(knowledgeState).map((kpi) => (
                  <li key={kpi.labelKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{t[kpi.labelKey]}</span>
                    <span className="tabular" style={{ fontWeight: 650, color: kpi.score === null ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {kpi.score !== null ? `${Math.round(kpi.score)}%` : t['knowledgeState.pendingValidation']}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {whyFacts.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>{t['conceptDetail.whyStudyusThinks']}</h3>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                {whyFacts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {debtCriteria && (
            <div className="card" style={{ marginBottom: 0, padding: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 14, marginBottom: 'var(--space-3)' }}>{t['conceptDetail.debtProgressTitle']}</h3>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span aria-hidden="true" style={{ color: debtCriteria.masteryAbove85.met ? 'var(--brand)' : 'var(--text-muted)' }}>
                    {debtCriteria.masteryAbove85.met ? '✓' : '○'}
                  </span>
                  <span className="sr-only">{criterionStatusLabel(debtCriteria.masteryAbove85.met, t)}: </span>
                  {t['conceptDetail.criterionMastery']} — <span className="tabular">{Math.round(debtCriteria.masteryAbove85.current)}%</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span aria-hidden="true" style={{ color: debtCriteria.recentScoresAbove80.met ? 'var(--brand)' : 'var(--text-muted)' }}>
                    {debtCriteria.recentScoresAbove80.met ? '✓' : '○'}
                  </span>
                  <span className="sr-only">{criterionStatusLabel(debtCriteria.recentScoresAbove80.met, t)}: </span>
                  {t['conceptDetail.criterionRecentScores']} —{' '}
                  {debtCriteria.recentScoresAbove80.current !== null ? (
                    <span className="tabular">{Math.round(debtCriteria.recentScoresAbove80.current)}%</span>
                  ) : (
                    <span>
                      {debtCriteria.recentScoresAbove80.sampleCount}/{debtCriteria.recentScoresAbove80.requiredSamples} —{' '}
                      {t['conceptDetail.criterionNotEnoughSamples']}
                    </span>
                  )}
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span aria-hidden="true" style={{ color: debtCriteria.retentionProof.met ? 'var(--brand)' : 'var(--text-muted)' }}>
                    {debtCriteria.retentionProof.met ? '✓' : '○'}
                  </span>
                  <span className="sr-only">{criterionStatusLabel(debtCriteria.retentionProof.met, t)}: </span>
                  {t['conceptDetail.criterionRetentionProof']} —{' '}
                  <span className="tabular">
                    {debtCriteria.retentionProof.daysSinceLastSuccess !== null ? debtCriteria.retentionProof.daysSinceLastSuccess : '—'}{' '}
                    {t['conceptDetail.criterionDaysUnit']}
                  </span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span aria-hidden="true" style={{ color: debtCriteria.lowForgettingRisk.met ? 'var(--brand)' : 'var(--text-muted)' }}>
                    {debtCriteria.lowForgettingRisk.met ? '✓' : '○'}
                  </span>
                  <span className="sr-only">{criterionStatusLabel(debtCriteria.lowForgettingRisk.met, t)}: </span>
                  {t['conceptDetail.criterionForgettingRisk']} —{' '}
                  <span className="tabular">
                    {debtCriteria.lowForgettingRisk.current !== null ? `${Math.round(debtCriteria.lowForgettingRisk.current)}%` : '—'}
                  </span>
                </li>
              </ul>
            </div>
          )}
        </details>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['subjectDetail.historyToggle']}</h2>
      {history.length === 0 ? (
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{t['subjectDetail.historyEmpty']}</p>
      ) : (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5, flexWrap: 'wrap' }}>
                <span className="tabular" style={{ color: 'var(--text-muted)', flexShrink: 0, width: 90 }}>
                  {new Date(h.timestamp).toLocaleDateString()}
                </span>
                <span style={{ flexShrink: 0, minWidth: 150 }}>{sourceLabel(h.sourceType, t)}</span>
                <span style={{ color: resultColor(h.result), fontWeight: 600, flexShrink: 0, minWidth: 90 }}>
                  {resultLabel(h.result, t)}
                  {h.scorePercent !== null ? ` (${Math.round(h.scorePercent)}%)` : ''}
                </span>
                {h.learningMode && (
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {h.learningMode === 'SOLO' ? t['subjectDetail.modeSolo'] : h.learningMode === 'COACH' ? t['subjectDetail.modeCoach'] : h.learningMode}
                  </span>
                )}
                {h.hintsUsed > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>{t['subjectDetail.hintsShort'].replace('{count}', String(h.hintsUsed))}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
