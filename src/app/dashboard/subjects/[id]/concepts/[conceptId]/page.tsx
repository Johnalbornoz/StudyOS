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
import { getBestLearningDecisionForConcept } from '@/services/adaptive-teaching.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { sourceLabel, resultLabel, resultColor, criterionStatusLabel } from '@/lib/concept-evidence-labels';
import { masteryStateLabel, masteryStateColor, knowledgeKpis } from '@/lib/knowledge-state-labels';
import { formatMasteryPercent, tryMasteryScore } from '@/lib/mastery-format';
import { conceptSituation, conceptSituationLabel } from '@/lib/concept-situation-labels';
import { activityLabel } from '@/app/dashboard/activityLabel';
import { activityCta } from '@/app/dashboard/activityCta';
import WhyThisV3 from '@/app/dashboard/WhyThisV3';
import StartSessionButton from '@/app/dashboard/StartSessionButton';

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
 * metric, no LLM-generated explanation.
 *
 * Step 6L-C1-R1: Phase 4's LearningDecision (`nextDecision`) is the
 * ONE perceptible "what should I do next?" authority on this page --
 * see the "What next / Why" card. The page-local `primaryCTA`
 * heuristic below is NOT a second recommendation: it only orders the
 * pre-existing manual/optional concept tools (practice/soloCheck/
 * review/tutor), which render with secondary styling and copy that
 * never implies StudyUS selected them, whether or not a canonical
 * decision exists.
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

  const [conceptView, evidence, activeDebt, history, transferDepth, knowledgeState, nextDecision] = await Promise.all([
    getConceptView(studentId, conceptId),
    getConceptEvidenceSummary(studentId, conceptId),
    query(
      `SELECT id FROM learning_debt WHERE student_id = $1 AND concept_id = $2 AND status IN ('active', 'monitoring')`,
      [studentId, conceptId]
    ),
    getConceptEvidenceHistory(studentId, conceptId, 20),
    // Phase 7 (7F1): canonical concept_transfer_state depth -> a
    // learner-safe progression phrase. Never surfaces NEAR/MID/FAR,
    // novelty dimensions, task families, fingerprints, weights, or the
    // policy version. Fails soft to null (renders as "not yet").
    getConceptTransferDepth(db, studentId, conceptId).catch(() => null),
    getConceptKnowledgeState(studentId, conceptId),
    // Step 6L-C1: the ONLY next-action authority for this section is
    // Phase 4's own current decision for this concept -- never derived
    // from mastery/retention/verification/knowledge-state locally on
    // this page. Same background-write caveat already accepted for
    // this exact call chain in 6L-B1 (getLearningDecisions ->
    // getActiveDebts -> ensureConceptLocalizations): wrapped in
    // .catch(() => null) so a failure here degrades to "omit the
    // section" rather than breaking Concept Detail or fabricating a
    // recommendation.
    getBestLearningDecisionForConcept(studentId, conceptId).catch(() => null),
  ]);
  const debtCriteria = activeDebt.rows.length > 0 ? await getLearningDebtCriteriaProgress(studentId, conceptId) : null;

  // Phase 1C: sourced from the canonical getConceptView projection now
  // (was getLearnerConceptState) -- same six fields, same values, same
  // null-safety semantics, just reshaped from ConceptView's nested
  // signal groups. Kept as a local `state` object so every downstream
  // reference on this page (state.masteryScore, state.retention, ...)
  // is unchanged.
  //
  // IMPORTANT: "retention" here is deliberately `100 - forgettingRisk`,
  // NOT `conceptView.retention.retentionScore`. This page's "retention"
  // display has always been a predictive retrievability-style estimate
  // (a forward-looking "how likely to still remember it right now"),
  // never the Knowledge State "retention" DIMENSION (a backward-looking
  // "have they proven they still know it after a real gap" evidence
  // classification) -- see the Phase 1C report's "Retention Twin
  // Contract" section. Step 6I changes only the SOURCE of that
  // predictive number: conceptView.memory.forgettingRisk (Phase 6's
  // canonical computeLiveMemorySignals value) rather than the legacy
  // spaced-repetition.ts formula ConceptView.retention.forgettingRisk
  // used before -- both fields carry the identical value now (Twin
  // computes exactly one forgettingRisk), but memory is the canonical
  // field going forward.
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

  // Step 6I: sourced from Phase 6's canonical concept_memory_state via
  // ConceptView.memory (never mastery_records.last_practiced/
  // next_review_date directly -- no raw memory-table query on this page
  // anymore). lastSuccessfulRetentionAt is a more accurate match for the
  // "last demonstrated" label than the old last_practiced (any attempt,
  // not necessarily a genuine retention proof) ever was.
  const lastPracticed = conceptView!.memory.lastSuccessfulRetentionAt;
  const nextReviewDate = conceptView!.memory.nextReviewAt;

  // Step 6L-C1-R1: this heuristic no longer functions as a pedagogical
  // recommendation -- Phase 4's LearningDecision (`nextDecision`,
  // fetched above) is the one next-action authority on this page now.
  // `primaryCTA` is kept ONLY to order the manual/optional concept-
  // tools row below (most-likely-relevant first, from the same
  // signals as before) -- it is never rendered as "what to do now,"
  // never styled as primary/recommended, and never shown inside the
  // situation banner.
  type CTA = 'practice' | 'soloCheck' | 'review' | 'tutor';
  const primaryCTA: CTA =
    state.masteryScore < 50
      ? 'practice'
      : state.independentMastery === null || state.independentMastery < state.masteryScore - 15
      ? 'soloCheck'
      : state.retention !== null && state.retention < 50
      ? 'review'
      : 'tutor';

  // Phase 3A: Solo Check is its own Activity Type (SOLO_CHECK, Evidence
  // Mode INDEPENDENT -- no AI hints) -- it must never be represented as
  // Cumulative Assessment just because an earlier version of this page
  // reused that mode for a single-concept "prove it alone" moment.
  // Review links to its own mode too, rather than silently reusing
  // topic_practice with just a different button label.
  const ctaConfig: Record<CTA, { label: string; href: string }> = {
    practice: { label: t['conceptDetail.ctaPractice'], href: `/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}` },
    review: { label: t['conceptDetail.ctaReview'], href: `/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}&mode=review` },
    soloCheck: {
      label: t['conceptDetail.ctaSoloCheck'],
      href: `/dashboard/quiz?subjectId=${subjectId}&conceptId=${conceptId}&mode=quick_check`,
    },
    tutor: { label: t['conceptDetail.ctaAskTutor'], href: `/dashboard/tutor?subjectId=${subjectId}&conceptId=${conceptId}` },
  };
  // Step 6L-C1-R1: renamed from `secondaryCTAs` -- there is no more
  // "primary" heuristic CTA to be secondary relative to. This is
  // simply a display order (most-likely-relevant first) for a flat
  // list of equal-weight, equally-styled manual tools.
  const orderedManualToolKeys: CTA[] = [primaryCTA, ...(Object.keys(ctaConfig) as CTA[]).filter((k) => k !== primaryCTA)];

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

  // Step 6L-A: one plain-language situation label, derived only from
  // canonical, already-computed backend state -- never a new academic-
  // truth model (see concept-situation-labels.ts). Absent entirely when
  // Phase 2 has no Knowledge State row yet for this concept (distinct
  // from `!state` above, which is Phase 6/Twin-level absence).
  const situation = knowledgeState
    ? conceptSituation(knowledgeState.masteryState, knowledgeState.validationReadiness, conceptView!.memory.memoryStatus)
    : null;

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
      <h1 style={{ marginBottom: 'var(--space-4)' }}>{concept.label}</h1>

      {/*
       * Step 6L-C1: "What next / Why" -- the ONLY next-action authority
       * here is Phase 4's own current LearningDecision for this concept
       * (nextDecision, fetched above via getBestLearningDecisionForConcept
       * and never re-derived from mastery/retention/knowledge-state on
       * this page). Presentation goes exclusively through the same
       * certified mappers Today already uses (activityLabel/activityCta/
       * WhyThisV3), and the CTA launches through the exact same
       * canonical mechanism (StartSessionButton -> POST /api/learning/
       * session/start -> startLearningSession) Today uses -- so a
       * REMEDIATION decision lands on the certified 6L-B1 shell exactly
       * as it does from Today, with no second routing table here. When
       * Phase 4 has no current decision for this concept (null), the
       * section is omitted entirely -- never a fabricated "Practice
       * more" default.
       */}
      {nextDecision && (
        <div
          className="card"
          style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--brand)', borderWidth: 2, display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {/* Step 6L-C1-R1: a real heading (h2, same visual style via
              .label) -- see the situation banner's own comment for why. */}
          <h2 className="label" style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t['conceptDetail.nextSectionTitle']}</h2>
          <div style={{ fontSize: 18, fontWeight: 650 }}>{activityLabel(nextDecision.activityType, t)}</div>
          <WhyThisV3 facts={nextDecision.facts} t={t} />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <StartSessionButton
              studentId={studentId}
              actionConceptId={nextDecision.actionConceptId}
              label={activityCta(nextDecision.activityType, t)}
              accessibleLabel={`${activityCta(nextDecision.activityType, t)}: ${activityLabel(nextDecision.activityType, t)}`}
              unavailableLabel={t['today3.unavailableBody']}
              retryLabel={t['today3.retry']}
              variant="primary"
            />
          </div>
        </div>
      )}

      {/*
       * Step 6L-C1-R1: this banner answers "what is my current
       * situation?" only -- it no longer embeds its own "what to do
       * now" action line. That question now has exactly one answer on
       * this page (the canonical card above, when nextDecision
       * exists); duplicating it here from a different, page-local
       * heuristic was the exact conflict the 6L-C1 visual review
       * flagged. The situation LABEL itself (conceptSituation) is
       * unaffected -- still the same canonical, already-computed
       * mapping from Knowledge State + memory status, unchanged.
       */}
      {situation && (
        <div
          className="card"
          style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <h2 className="label" style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t['conceptDetail.situationTitle']}</h2>
          <div style={{ fontSize: 18, fontWeight: 650 }}>{conceptSituationLabel(situation, t)}</div>
        </div>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['conceptDetail.yourLearning']}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>{t['conceptDetail.mastery']}</div>
          <div className="tabular" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1 }}>{formatMasteryPercent(tryMasteryScore(state.masteryScore, `concept detail ${conceptId}`))}</div>
        </div>
        {/*
         * Step 6L-C2-B1: this card shows the Phase 6 PREDICTED value
         * (100 - forgettingRisk, a live, purely time-derived estimate --
         * see memory-policy.ts::computeRetrievability). It must never be
         * labeled "Retention" -- that word implies proof, and this
         * number requires none; it can fall on its own with elapsed
         * time and no learner activity at all. The OBSERVED, evidence-
         * gated counterpart (demonstratedRetentionScore) is shown
         * separately below, in the Knowledge State card's own "Lo
         * recuerdo"/"I remember it" row -- never merged with this one.
         */}
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
          {/* Phase 7 (7F1): learner-safe progression phrase from
              canonical concept_transfer_state -- never a raw
              NEAR/MID/FAR label, score, or engine internal. */}
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
            <h2 style={{ fontSize: 14, margin: 0 }}>{t['knowledgeState.sectionTitle']}</h2>
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
                {/* Step 6J-B1: daysSinceLastSuccess is null (never the old Infinity sentinel) when no genuine Phase 6 retention proof exists yet. */}
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
                {/* Step 6J-B1: null (never a fabricated 100%) when Phase 6 has no prediction yet. */}
                {debtCriteria.lowForgettingRisk.current !== null ? `${Math.round(debtCriteria.lowForgettingRisk.current)}%` : '—'}
              </span>
            </li>
          </ul>
        </div>
      )}

      {/*
       * Step 6L-C1-R1: demoted from a primary+secondary CTA row (which
       * duplicated/competed with the canonical "what next" card above)
       * to a flat row of equal-weight, secondary-styled manual tools.
       * Title and styling deliberately never say "recommended" or
       * "what to do now" -- these are optional ways to work with the
       * concept, not a second next-action authority. Order is still
       * `primaryCTA`-first (most-likely-relevant), but nothing here is
       * visually or semantically privileged over the others.
       */}
      <h2 style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['conceptDetail.otherWaysTitle']}</h2>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        {orderedManualToolKeys.map((k) => (
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
