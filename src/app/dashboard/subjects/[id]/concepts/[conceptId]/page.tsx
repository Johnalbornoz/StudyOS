import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getLearnerConceptState, getConceptEvidenceSummary, getConceptEvidenceHistory } from '@/services/learner-model.service';
import { getLearningDebtCriteriaProgress } from '@/services/learning-debt.service';
import { getTransferScore } from '@/services/transfer.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { sourceLabel, resultLabel, resultColor, criterionStatusLabel } from '@/lib/concept-evidence-labels';

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
 * Concept Detail: the drill-down endpoint of Progress/Subjects (never
 * a nav item of its own). Every number here comes from
 * getLearnerConceptState/getConceptEvidenceSummary -- no invented
 * metric, no LLM-generated explanation. CTA choice is a small
 * deterministic rule over the same learner state already computed for
 * this page, not a separate recommendation engine.
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

  const [state, evidence, masteryRow, activeDebt, history, transferScore] = await Promise.all([
    getLearnerConceptState(studentId, conceptId),
    getConceptEvidenceSummary(studentId, conceptId),
    query(
      `SELECT last_practiced, next_review_date FROM mastery_records WHERE student_id = $1 AND concept_id = $2`,
      [studentId, conceptId]
    ),
    query(
      `SELECT id FROM learning_debt WHERE student_id = $1 AND concept_id = $2 AND status IN ('active', 'monitoring')`,
      [studentId, conceptId]
    ),
    getConceptEvidenceHistory(studentId, conceptId, 20),
    getTransferScore(studentId, conceptId),
  ]);
  const debtCriteria = activeDebt.rows.length > 0 ? await getLearningDebtCriteriaProgress(studentId, conceptId) : null;

  if (!state) {
    return (
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
          <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{subject.name}</Link> / {concept.label}
        </div>
        <h1>{concept.label}</h1>
        <div className="card empty-state" style={{ marginTop: 'var(--space-6)' }}>
          <strong>{t['dashboard.notEnoughEvidence']}</strong>
        </div>
        <Link href={`/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}`} className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }}>
          {t['conceptDetail.ctaPractice']}
        </Link>
      </div>
    );
  }

  const lastPracticed = masteryRow.rows[0]?.last_practiced ?? null;
  const nextReviewDate = masteryRow.rows[0]?.next_review_date ?? null;

  // Deterministic CTA choice -- same signals already on this page, no
  // separate ranking engine. Low mastery wins first (foundational gap);
  // then an independence gap (looks fine, hasn't proven it alone); then
  // declining retention (needs a refresh, not new material); otherwise
  // the concept is in good shape and the Tutor is for open questions.
  type CTA = 'practice' | 'soloCheck' | 'review' | 'tutor';
  const primaryCTA: CTA =
    state.masteryScore < 50
      ? 'practice'
      : state.independentMastery === null || state.independentMastery < state.masteryScore - 15
      ? 'soloCheck'
      : state.retention !== null && state.retention < 50
      ? 'review'
      : 'tutor';

  const ctaConfig: Record<CTA, { label: string; href: string }> = {
    practice: { label: t['conceptDetail.ctaPractice'], href: `/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}` },
    review: { label: t['conceptDetail.ctaReview'], href: `/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}` },
    soloCheck: {
      label: t['conceptDetail.ctaSoloCheck'],
      href: `/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}&mode=cumulative_assessment`,
    },
    tutor: { label: t['conceptDetail.ctaAskTutor'], href: `/dashboard/tutor?subjectId=${subjectId}&conceptId=${conceptId}` },
  };
  const secondaryCTAs = (Object.keys(ctaConfig) as CTA[]).filter((k) => k !== primaryCTA);

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

  const evidenceStrengthLabel =
    state.evidenceStrength === 'HIGH'
      ? t['conceptDetail.evidenceStrengthHigh']
      : state.evidenceStrength === 'MEDIUM'
      ? t['conceptDetail.evidenceStrengthMedium']
      : state.evidenceStrength === 'LOW'
      ? t['conceptDetail.evidenceStrengthLow']
      : t['dashboard.notEnoughEvidence'];

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 6 }}>
        <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{subject.name}</Link> / {concept.label}
      </div>
      <h1 style={{ marginBottom: 'var(--space-6)' }}>{concept.label}</h1>

      <h2 style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['conceptDetail.yourLearning']}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.mastery']}</div>
          <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>{Math.round(state.masteryScore)}%</div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>{t['dashboard.retention']}</div>
          <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>
            {state.retention !== null ? `${Math.round(state.retention)}%` : t['dashboard.notEnoughEvidence']}
          </div>
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
          aria-label={`${t['conceptDetail.transfer']}: ${transferScore !== null ? `${Math.round(transferScore)}%` : t['dashboard.notEnoughEvidence']}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          <div className="label" style={{ color: 'var(--text-muted)' }} aria-hidden="true">{t['conceptDetail.transfer']}</div>
          <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }} aria-hidden="true">
            {transferScore !== null ? `${Math.round(transferScore)}%` : t['dashboard.notEnoughEvidence']}
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

      {whyFacts.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>{t['conceptDetail.whyStudyusThinks']}</h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
            {whyFacts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {debtCriteria && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 14, marginBottom: 'var(--space-3)' }}>{t['conceptDetail.debtProgressTitle']}</h2>
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
                {Number.isFinite(debtCriteria.retentionProof.daysSinceLastSuccess) ? debtCriteria.retentionProof.daysSinceLastSuccess : '—'}{' '}
                {t['conceptDetail.criterionDaysUnit']}
              </span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
              <span aria-hidden="true" style={{ color: debtCriteria.lowForgettingRisk.met ? 'var(--brand)' : 'var(--text-muted)' }}>
                {debtCriteria.lowForgettingRisk.met ? '✓' : '○'}
              </span>
              <span className="sr-only">{criterionStatusLabel(debtCriteria.lowForgettingRisk.met, t)}: </span>
              {t['conceptDetail.criterionForgettingRisk']} — <span className="tabular">{Math.round(debtCriteria.lowForgettingRisk.current)}%</span>
            </li>
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        <Link href={ctaConfig[primaryCTA].href} className="btn btn-primary">
          {ctaConfig[primaryCTA].label}
        </Link>
        {secondaryCTAs.map((k) => (
          <Link key={k} href={ctaConfig[k].href} className="btn btn-secondary">
            {ctaConfig[k].label}
          </Link>
        ))}
      </div>

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
