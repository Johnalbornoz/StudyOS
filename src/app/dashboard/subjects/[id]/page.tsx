import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getStudentMastery } from '@/services/mastery.service';
import { getContentSources } from '@/services/content.service';
import { getSubjectHierarchy } from '@/services/topic-hierarchy.service';
import { getSubjectView } from '@/lib/learner-twin';
import { getSubjectKnowledgeState, type MasteryState } from '@/services/knowledge-state.service';
import { getLearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import { resolveSubjectCurrentDecision } from '@/lib/lx/path-view';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import UploadPanel from './UploadPanel';
import AssessmentPanel from './AssessmentPanel';
import SubjectSettingsPanel from './SubjectSettingsPanel';
import HierarchicalConceptList from './HierarchicalConceptList';
import { getSubjectAccentColor } from '@/lib/subject-color';
import { masteryToPercent, tryMasteryScore } from '@/lib/mastery-format';
import { activityCta } from '../../activityCta';
import StartSessionButton from '../../StartSessionButton';

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const subjectResult = await query(
    `SELECT * FROM subjects WHERE id = $1 AND student_id = $2`,
    [id, studentId]
  );
  const subject = subjectResult.rows[0];
  if (!subject) notFound();

  // Six independent reads (none depends on another's result) -- run in
  // parallel instead of sequentially. Each keeps its own fallback, so a
  // failure in one never blocks or breaks the others.
  const [concepts, contentSources, hierarchy, subjectView, knowledgeStates, snapshot] = await Promise.all([
    getStudentMastery(studentId, id, locale, true).catch(() => []),
    getContentSources(studentId, id).catch(() => []),
    getSubjectHierarchy(id, studentId, locale).catch(() => ({ topics: [], unassigned: [] })),
    getSubjectView(studentId, id).catch(() => null),
    // Step 6L-C2-B1: ONE batch read for the whole subject (never one
    // query per concept) -- the already-persisted, canonical
    // MasteryState per concept, reused as-is via the existing
    // masteryStateLabel mapping to qualify the bare mastery percentage
    // below. Never recomputed, never a new threshold.
    getSubjectKnowledgeState(studentId, id).catch(() => []),
    // LX-7R1: the same Phase 3E snapshot Today/My Path already read --
    // never a subject-specific recommendation algorithm. See
    // resolveSubjectCurrentDecision below.
    getLearningOSSnapshot(studentId, { preferredLanguage: locale }).catch(() => null),
  ]);
  const masteryStates: Record<string, MasteryState> = {};
  for (const row of knowledgeStates) masteryStates[row.conceptId] = row.masteryState;
  // LX-7R1: replaces the old `[...concepts].sort((a,b) => a.mastery_score - b.mastery_score)[0]`
  // "Practice weakest" heuristic -- raw mastery is not an action-selection
  // authority. The subject's CTA now surfaces the same canonical decision
  // Today/My Path would for this subject (or nothing, if there isn't one),
  // never an independently-derived "weakest concept" pick.
  const subjectDecision = resolveSubjectCurrentDecision(snapshot, id);
  // Digital Learning Twin (Phase 1C) cognitive summary -- same shape/values
  // getSubjectLearnerModel always produced, now sourced from the canonical
  // getSubjectView projection. subjectView is only null if the subject
  // itself can't be found (already guarded by notFound() above) or on a
  // read failure, matching the previous .catch() fallback exactly.
  const learnerModel = subjectView?.cognitiveSummary ?? {
    avgMasteryPercent: null, avgRetentionScore: null, avgIndependentMastery: null, avgConfidenceCalibration: null,
    evidenceCoverage: null, activeLearningDebtCount: 0, atRiskCount: 0,
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 6 }}>
        <Link href="/dashboard" style={{ color: 'var(--text-muted)' }}>{t['nav.dashboard']}</Link> / {subject.name}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span
              aria-hidden
              style={{ width: 12, height: 12, borderRadius: '50%', background: getSubjectAccentColor(id), flexShrink: 0 }}
            />
            {subject.name}
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
            {concepts.length} {t['subjectDetail.conceptCount']}
            {learnerModel.avgMasteryPercent !== null ? ` · ${t['subjectDetail.avgMastery']} ${learnerModel.avgMasteryPercent}%` : ''}
          </p>
          {(learnerModel.avgRetentionScore !== null ||
            learnerModel.avgIndependentMastery !== null ||
            learnerModel.avgConfidenceCalibration !== null ||
            learnerModel.evidenceCoverage !== null ||
            learnerModel.activeLearningDebtCount > 0 ||
            learnerModel.atRiskCount > 0) && (
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 13 }}>
              {[
                learnerModel.avgRetentionScore !== null ? `${t['subjectDetail.freshness']} ${learnerModel.avgRetentionScore}%` : null,
                learnerModel.avgIndependentMastery !== null
                  ? `${t['subjectDetail.independentMastery']} ${learnerModel.avgIndependentMastery}%`
                  : null,
                learnerModel.avgConfidenceCalibration !== null
                  ? `${t['subjectDetail.confidenceCalibration']} ${learnerModel.avgConfidenceCalibration}%`
                  : null,
                learnerModel.evidenceCoverage !== null
                  ? `${t['subjectDetail.evidenceCoverage']} ${learnerModel.evidenceCoverage.evidencedConcepts}/${learnerModel.evidenceCoverage.totalConcepts} (${learnerModel.evidenceCoverage.percent}%)`
                  : null,
                learnerModel.activeLearningDebtCount > 0
                  ? `${learnerModel.activeLearningDebtCount} ${t['subjectDetail.activeLearningDebt']}`
                  : null,
                learnerModel.atRiskCount > 0 ? `${learnerModel.atRiskCount} ${t['subjectDetail.atRisk']}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
        {subjectDecision ? (
          // LX-7R1 B3/B6/B7: the canonical decision for this subject,
          // launched through the same authority Today/My Path use --
          // never a hand-built /dashboard/quiz?... URL.
          <StartSessionButton
            studentId={studentId}
            actionConceptId={subjectDecision.actionConceptId}
            label={activityCta(subjectDecision.activityType, t)}
            unavailableLabel={t['today3.unavailableBody']}
            retryLabel={t['today3.retry']}
            variant="primary"
          />
        ) : (
          // LX-7R1 B4: no canonical action for this subject right now --
          // a neutral link, never an invented "Practice" fallback.
          <Link href={`/dashboard/path/${id}`} className="btn btn-secondary">
            {t['subjectDetail.viewMyPath']}
          </Link>
        )}
      </div>

      {learnerModel.activeLearningDebtCount > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--bg-subtle)' }}>
          <strong style={{ fontSize: 14 }}>{t['subjectDetail.debtCriteriaTitle']}</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {t['subjectDetail.debtCriteriaBody']}
          </p>
        </div>
      )}

      {concepts.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <Link href={`/dashboard/quiz?subjectId=${id}&mode=cumulative_assessment`} className="btn btn-secondary">
            {t['quiz.modeCumulative']}
          </Link>
          <Link href={`/dashboard/quiz?subjectId=${id}&mode=exam_simulation`} className="btn btn-secondary">
            {t['quiz.modeExamSim']}
          </Link>
        </div>
      )}

      <AssessmentPanel
        subjectId={id}
        studentId={studentId}
        locale={locale}
        concepts={concepts.map((c: any) => ({
          conceptId: c.concept_id,
          label: c.label || c.canonical_id,
          masteryScore: masteryToPercent(tryMasteryScore(c.mastery_score, `subject page concept ${c.concept_id}`)) ?? 0,
        }))}
      />

      {concepts.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['subjectDetail.noConceptsTitle']}</strong>
          {t['subjectDetail.noConceptsBody']}
        </div>
      ) : (
        <HierarchicalConceptList subjectId={id} studentId={studentId} locale={locale} hierarchy={hierarchy} masteryStates={masteryStates} />
      )}

      <UploadPanel subjectId={id} subjectName={subject.name} studentId={studentId} locale={locale} />

      <SubjectSettingsPanel
        subjectId={id}
        studentId={studentId}
        locale={locale}
        initialName={subject.name}
        initialStatus={subject.status}
        initialTargetLanguage={subject.target_language}
        initialQuizLanguageMode={subject.quiz_language_mode}
        initialIbProgramme={subject.ib_programme}
        initialIbSubjectGroup={subject.ib_subject_group}
        initialIbLevel={subject.ib_level}
        conceptCount={concepts.length}
        contentSources={contentSources.map((s: any) => ({
          id: s.id,
          fileName: s.storage_path?.split('/').pop() || s.storage_path,
          sourceType: s.source_type,
          uploadedAt: s.uploaded_at,
        }))}
      />
    </div>
  );
}
