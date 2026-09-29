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
import { PageIntro } from '@/components/ui/PageIntro';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { StatusBadge, toneForReadinessStatus, toneForDimensionStatus } from '@/components/ui/StatusBadge';
import { calendarDaysUntil } from '@/lib/experience/goal';
import {
  READINESS_ORDER,
  SIMULATION_TYPES,
  TIMING_MODES,
  simulationTypeLabelKey,
  simulationTypeBodyKey,
  timingModeLabelKey,
  timingModeBodyKey,
} from '@/lib/experience/exam-prep';
import { StartSimulationPanel, type StartSimulationLabels } from './StartSimulationPanel';

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

  const todayIso = new Date().toISOString().slice(0, 10);
  const days = profile.examDate ? calendarDaysUntil(profile.examDate, todayIso) : null;
  const dateLine = profile.examDate
    ? `${new Date(`${profile.examDate}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}${
        days !== null && days >= 0 ? ` · ${days === 0 ? t['xp.goalToday'] : days === 1 ? t['xp.goalTomorrow'] : t['xp.goalDaysLeft'].replace('{days}', String(days))}` : ''
      }`
    : t['examPrep.noExamDateSet'];
  const currentIndex = snapshot ? READINESS_ORDER.indexOf(snapshot.overallStatus) : -1;
  // No snapshot yet, or the server itself reports INSUFFICIENT_EVIDENCE: an intentional
  // "still taking shape" state rather than a ladder stuck on its first rung.
  const forming = !snapshot || snapshot.overallStatus === 'INSUFFICIENT_EVIDENCE';

  return (
    <div className="xp-page xp-page--wide">
      <PageIntro
        crumb={<Link href="/dashboard/exam-prep">{t['examPrep.title']}</Link>}
        title={definition?.name ?? profile.examDefinitionId}
        lead={dateLine}
      />

      <div className="ex-layout">
        <div className="xp-page" style={{ gap: 'var(--space-6)' }}>
          <section className="card ex-status" aria-labelledby="ex-status-title">
            <div>
              <h2 id="ex-status-title" className="ex-status-title">{t['ex.readinessTitle']}</h2>
              <p className="ui-hint" style={{ margin: 'var(--space-1) 0 0' }}>{t['ex.readinessLead']}</p>
            </div>

            {!examVersion && <InlineAlert tone="info" title={t['examPrep.noExamVersion']} />}

            {examVersion && forming && (
              <div>
                <p className="ex-status-title" style={{ fontSize: 'var(--fs-lg)' }}>{t['ex.formingTitle']}</p>
                <p className="ex-status-body" style={{ marginTop: 'var(--space-2)' }}>{t['ex.formingBody']}</p>
              </div>
            )}

            {snapshot && (
              <>
                {!forming && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <span className="ui-label">{t['examPrep.overallStatus']}</span>
                      <StatusBadge label={t[`examPrep.status.${snapshot.overallStatus}`]} tone={toneForReadinessStatus(snapshot.overallStatus)} />
                    </div>
                    {/* where the server-reported status sits on F9's own status scale */}
                    <ol className="ex-ladder" aria-label={t['examPrep.overallStatus']}>
                      {READINESS_ORDER.map((status, i) => (
                        <li key={status} className={i < currentIndex ? 'done' : i === currentIndex ? 'current' : undefined} aria-current={i === currentIndex ? 'step' : undefined}>
                          <span className="ex-ladder-bar" aria-hidden />
                          <span className="ex-ladder-label">{t[`examPrep.status.${status}`]}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                <p className="ex-status-body">
                  <strong>{t['examPrep.scoreProjection']}:</strong>{' '}
                  {snapshot.scoreProjectionAvailability === 'AVAILABLE'
                    ? t['examPrep.scoreProjection.available']
                    : t[`examPrep.scoreProjection.${snapshot.scoreProjectionAvailability}`] ?? t['examPrep.scoreProjection.NOT_APPLICABLE']}
                </p>
                <details className="ui-disclosure">
                  <summary>{t['ex.moreDetail']}</summary>
                  <div className="ui-disclosure-body">
                    <ul className="ex-dims">
                      {snapshot.dimensions.map((d) => (
                        <li key={d.dimension} className="card ex-dim">
                          <div className="ex-dim-head">
                            <span className="ex-dim-name">{t[DIMENSION_LABEL_KEY[d.dimension]] ?? d.dimension}</span>
                            <StatusBadge label={t[`examPrep.dimensionStatus.${d.status}`]} tone={toneForDimensionStatus(d.status)} />
                          </div>
                          {d.unsupportedPlatformAreas.length > 0 && (
                            <span className="ex-dim-note ex-dim-note--warn">{t['examPrep.platformNotSupported']}</span>
                          )}
                          {d.whatWouldImproveConfidence && <span className="ex-dim-note">{d.whatWouldImproveConfidence}</span>}
                        </li>
                      ))}
                    </ul>
                    {snapshot.limitations.length > 0 && (
                      <p className="ex-dim-note" style={{ margin: 'var(--space-4) 0 0' }}>
                        {t['examPrep.limitations']}: {snapshot.limitations.join('; ')}
                      </p>
                    )}
                  </div>
                </details>
              </>
            )}
          </section>

          <section className="card ex-status" aria-labelledby="ex-next-title">
            <h2 id="ex-next-title" className="ex-status-title">{t['ex.nextTitle']}</h2>
            <p className="ex-status-body">{t['ex.nextBody']}</p>
            <div>
              <Link href="/dashboard/today" className="btn btn-secondary">{t['ex.continueToday']}</Link>
            </div>
          </section>
        </div>

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
              title: t['ex.practiceTitle'],
              lead: t['ex.practiceLead'],
              typeLegend: t['ex.typeLegend'],
              timingLegend: t['ex.timingLegend'],
              advanced: t['ex.advanced'],
              learningObjectiveIdLabel: t['examPrep.start.learningObjectiveIdLabel'],
              academicSubjectIdLabel: t['examPrep.start.academicSubjectIdLabel'],
              targetIdHint: t['ex.targetIdHint'],
              submit: t['ex.start'],
              submitting: t['ex.starting'],
              error: t['examPrep.start.error'],
              types: Object.fromEntries(SIMULATION_TYPES.map((type) => [type, { title: t[simulationTypeLabelKey(type)], body: t[simulationTypeBodyKey(type)] }])) as StartSimulationLabels['types'],
              timings: Object.fromEntries(TIMING_MODES.map((mode) => [mode, { title: t[timingModeLabelKey(mode)], body: t[timingModeBodyKey(mode)] }])) as StartSimulationLabels['timings'],
              reasons: {
                'ex.reason.unavailable': t['ex.reason.unavailable'],
                'ex.reason.domainIncomplete': t['ex.reason.domainIncomplete'],
                'ex.reason.needsTarget': t['ex.reason.needsTarget'],
                'ex.reason.notFound': t['ex.reason.notFound'],
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
