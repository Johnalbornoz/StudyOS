import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getExamPreparationPlan, ExamPlanError, refreshExamGapRecommendations } from '@/lib/learning-plan/exam-bridge.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import StartSessionButton from '../../../StartSessionButton';
import { AddToPlanButton, ExamRecommendationActions } from '../../PlanActions';

/**
 * Track A -- Exam Preparation Plan: the exam blueprint crossed with the
 * learner model. Each concept shows its status for the exam; gaps detected
 * in attempts surface as reinforcement recommendations, accepted into the
 * same Personal Plan (no duplicate learner state).
 */
export default async function ExamPreparationPlanPage({ params }: { params: Promise<{ examProfileId: string }> }) {
  const { examProfileId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);
  await refreshExamGapRecommendations(studentId).catch(() => 0);
  const plan = await getExamPreparationPlan(studentId, examProfileId, locale).catch((e) => {
    if (e instanceof ExamPlanError) return null;
    throw e;
  });
  if (!plan) notFound();
  const startLabels = { unavailableLabel: t['lp.plan.unavailable'], retryLabel: t['lp.plan.retry'], licenseTitle: t['learning.licenseRequiredTitle'], licenseBody: t['learning.licenseRequiredBody'], licenseCtaLabel: t['license.demoBannerCta'] };
  const stageLabel = (stage: string | null) => (stage ? t[`conceptMission.stage.${stage}` as MessageKey] : t['lp.phase.NOT_STARTED']);

  return (
    <div className="ta-stack">
      <PageHeader title={`${t['lp.exam.title']} · ${plan.examName}`} subtitle={plan.versionLabel ?? undefined} />
      <p>
        <Link href="/dashboard/plan?tab=exam" className="btn btn-ghost">
          ← {t['lp.exam.back']}
        </Link>
      </p>
      {plan.readiness && <p className="ta-msg">{fillMessage(t['lp.exam.readiness'], { status: plan.readiness })}</p>}
      {plan.unmappedObjectives > 0 && <p className="ta-msg">{fillMessage(t['lp.exam.unmapped'], { n: plan.unmappedObjectives })}</p>}
      {plan.mappingStatus === 'MAPPING_NOT_AVAILABLE' && <p className="ta-msg" role="status" data-mapping-status="MAPPING_NOT_AVAILABLE">{t['lp.exam.mappingNotAvailable']}</p>}
      {plan.areas.length === 0 ? (
        <EmptyState title={t['lp.explore.empty']} />
      ) : (
        plan.areas.map((area) => (
          <section key={area.label} className="ta-stack" style={{ gap: 'var(--space-2)' }} aria-label={area.label}>
            <h2 style={{ fontSize: 16 }}>{area.label}</h2>
            <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {area.concepts.map((c) => (
                <li key={c.canonicalConceptId} className="list-row" style={{ flexWrap: 'wrap' }}>
                  <div className="row-main" style={{ flexBasis: 220 }}>
                    <div className="row-title">{c.label}</div>
                    <div className="row-sub">
                      {t['lp.plan.phase']}: {stageLabel(c.stage)}
                      {c.skills.length > 0 ? ` · ${c.skills.join(', ')}` : ''}
                    </div>
                  </div>
                  <span className={c.status === 'CONSOLIDATED' ? 'chip chip-good' : c.status === 'NEEDS_REINFORCEMENT' ? 'chip chip-warn' : 'chip'}>{t[`lp.exam.status.${c.status}` as MessageKey]}</span>
                  {c.recommendationId ? (
                    <ExamRecommendationActions recommendationId={c.recommendationId} labels={{ reinforce: t['lp.rec.reinforce'], add: t['lp.rec.add'], dismiss: t['lp.rec.dismiss'], error: t['lp.error'] }} />
                  ) : c.inPlan && c.learnerConceptId ? (
                    <StartSessionButton studentId={studentId} actionConceptId={c.learnerConceptId} label={t['lp.plan.continue']} variant="secondary" {...startLabels} />
                  ) : !c.inPlan ? (
                    <AddToPlanButton canonicalConceptId={c.canonicalConceptId} source="CURRICULUM_RECOMMENDATION" labels={{ add: t['lp.explore.add'], adding: t['lp.explore.adding'], error: t['lp.error'] }} />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
