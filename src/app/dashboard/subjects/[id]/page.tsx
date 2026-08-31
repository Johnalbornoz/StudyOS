import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getStudentMastery } from '@/services/mastery.service';
import { getContentSources } from '@/services/content.service';
import { getSubjectHierarchy } from '@/services/topic-hierarchy.service';
import { getSubjectLearnerModel } from '@/services/learner-model.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import UploadPanel from './UploadPanel';
import AssessmentPanel from './AssessmentPanel';
import SubjectSettingsPanel from './SubjectSettingsPanel';
import HierarchicalConceptList from './HierarchicalConceptList';
import { getSubjectAccentColor } from '@/lib/subject-color';
import { masteryToPercent, tryMasteryScore } from '@/lib/mastery-format';

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

  // Four independent reads (none depends on another's result) -- run in
  // parallel instead of sequentially. Each keeps its own fallback, so a
  // failure in one never blocks or breaks the others.
  const [concepts, contentSources, hierarchy, learnerModel] = await Promise.all([
    getStudentMastery(studentId, id, locale, true).catch(() => []),
    getContentSources(studentId, id).catch(() => []),
    getSubjectHierarchy(id, studentId, locale).catch(() => ({ topics: [], unassigned: [] })),
    getSubjectLearnerModel(studentId, id).catch(() => ({
      avgMastery: null, avgRetention: null, avgIndependentMastery: null, avgConfidenceCalibration: null,
      evidenceCoverage: null, activeLearningDebtCount: 0, atRiskCount: 0,
    })),
  ]);
  const weakest = [...concepts].sort((a: any, b: any) => a.mastery_score - b.mastery_score)[0];

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
            {learnerModel.avgMastery !== null ? ` · ${t['subjectDetail.avgMastery']} ${learnerModel.avgMastery}%` : ''}
          </p>
          {(learnerModel.avgRetention !== null ||
            learnerModel.avgIndependentMastery !== null ||
            learnerModel.avgConfidenceCalibration !== null ||
            learnerModel.evidenceCoverage !== null ||
            learnerModel.activeLearningDebtCount > 0 ||
            learnerModel.atRiskCount > 0) && (
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 13 }}>
              {[
                learnerModel.avgRetention !== null ? `${t['subjectDetail.retention']} ${learnerModel.avgRetention}%` : null,
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
        {weakest && (
          <Link href={`/dashboard/quiz?subjectId=${id}&conceptId=${weakest.concept_id}`} className="btn btn-primary">
            {t['subjectDetail.practiceWeak']}
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
        <HierarchicalConceptList subjectId={id} studentId={studentId} locale={locale} hierarchy={hierarchy} />
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
