import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition, getExamVersion, getPublishedExamVersion } from '@/lib/assessment/exam-definition.service';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge, toneForReadinessStatus, toneForDimensionStatus } from '@/components/ui/StatusBadge';
import { StartSimulationPanel } from './StartSimulationPanel';

const DIMENSION_LABEL_KEY = {
  KNOWLEDGE_READINESS: 'examPrep.dimension.knowledge',
  SKILL_READINESS: 'examPrep.dimension.skill',
  EXAM_TECHNIQUE_READINESS: 'examPrep.dimension.examTechnique',
  SPEED_FLUENCY_READINESS: 'examPrep.dimension.speedFluency',
  BLUEPRINT_EVIDENCE_COVERAGE: 'examPrep.dimension.blueprintCoverage',
  SIMULATION_PERFORMANCE: 'examPrep.dimension.simulationPerformance',
  EVIDENCE_SUFFICIENCY: 'examPrep.dimension.evidenceSufficiency',
} as const;

/**
 * F14 Workstream A -- Exam Prep detail (task section 4). Renders F9's
 * OWN dimensions/reasonCodes/unsupportedPlatformAreas verbatim -- this
 * is the concrete mechanism that keeps "learner not ready" (a
 * DEVELOPING/WEAK dimension backed by real evidence) visibly distinct
 * from "platform cannot determine this" (a dimension whose
 * `unsupportedPlatformAreas` is non-empty), per task's own explicit
 * requirement. No literal `PLATFORM_NOT_READY` status exists in F9
 * (verified against src/lib/readiness/types.ts) -- that distinction is
 * carried by `unsupportedPlatformAreas`/reasonCodes, not a separate
 * top-level enum value this page would otherwise have to invent.
 */
export default async function ExamPrepDetailPage({ params }: { params: Promise<{ examProfileId: string }> }) {
  const { examProfileId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);

  const profile = await getStudentExamProfile(examProfileId);
  if (!profile || profile.studentId !== studentId) notFound();

  const definition = await getExamDefinition(profile.examDefinitionId);
  const examVersion = profile.examVersionId
    ? await getExamVersion(profile.examVersionId)
    : await getPublishedExamVersion(profile.examDefinitionId);

  const snapshot = examVersion ? await getLatestReadinessSnapshot(profile.id) : null;

  const eligibility = examVersion
    ? await Promise.all([
        getSimulationEligibility({ studentId, examVersionId: examVersion.id, simulationType: 'MINI_MOCK' }),
        getSimulationEligibility({ studentId, examVersionId: examVersion.id, simulationType: 'FULL_MOCK' }),
      ])
    : [null, null];
  const [miniMockEligibility, fullMockEligibility] = eligibility;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title={definition?.name ?? profile.examDefinitionId}
        subtitle={t['examPrep.detailSubtitle']}
        breadcrumb={<Link href="/dashboard/exam-prep">{t['examPrep.title']}</Link>}
      />

      {!examVersion && <div className="card" style={{ padding: 'var(--space-4)' }}>{t['examPrep.noExamVersion']}</div>}

      {examVersion && !snapshot && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>{t['examPrep.noSnapshotYet']}</div>
      )}

      {snapshot && (
        <section className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t['examPrep.overallStatus']}</h2>
            <StatusBadge label={t[`examPrep.status.${snapshot.overallStatus}`] ?? snapshot.overallStatus} tone={toneForReadinessStatus(snapshot.overallStatus)} />
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{t['examPrep.scoreProjection']}</div>
            <div style={{ fontSize: 14 }}>
              {snapshot.scoreProjectionAvailability === 'AVAILABLE'
                ? t['examPrep.scoreProjection.available']
                : t[`examPrep.scoreProjection.${snapshot.scoreProjectionAvailability}`] ?? snapshot.scoreProjectionAvailability}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{t['examPrep.dimensions']}</div>
            <ul className="list-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {snapshot.dimensions.map((d) => (
                <li key={d.dimension} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{t[DIMENSION_LABEL_KEY[d.dimension]] ?? d.dimension}</span>
                    <StatusBadge label={t[`examPrep.dimensionStatus.${d.status}`] ?? d.status} tone={toneForDimensionStatus(d.status)} />
                  </div>
                  {d.unsupportedPlatformAreas.length > 0 && (
                    <div style={{ fontSize: 12.5, color: 'var(--warning)' }}>
                      {t['examPrep.platformNotSupported']}: {d.unsupportedPlatformAreas.join(', ')}
                    </div>
                  )}
                  {d.whatWouldImproveConfidence && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{d.whatWouldImproveConfidence}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {snapshot.limitations.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t['examPrep.limitations']}: {snapshot.limitations.join('; ')}
            </div>
          )}
        </section>
      )}

      {examVersion && (
        <StartSimulationPanel
          studentId={studentId}
          examProfileId={profile.id}
          examVersionId={examVersion.id}
          miniMockEligible={miniMockEligibility?.eligible ?? false}
          miniMockReasons={miniMockEligibility?.reasons ?? []}
          fullMockEligible={fullMockEligibility?.eligible ?? false}
          fullMockReasons={fullMockEligibility?.reasons ?? []}
          labels={{
            title: t['examPrep.start.title'],
            simulationTypeLabel: t['examPrep.start.simulationTypeLabel'],
            timingModeLabel: t['examPrep.start.timingModeLabel'],
            learningObjectiveIdLabel: t['examPrep.start.learningObjectiveIdLabel'],
            academicSubjectIdLabel: t['examPrep.start.academicSubjectIdLabel'],
            submit: t['examPrep.start.submit'],
            submitting: t['examPrep.start.submitting'],
            notEligible: t['examPrep.start.notEligible'],
            error: t['examPrep.start.error'],
          }}
        />
      )}
    </div>
  );
}
