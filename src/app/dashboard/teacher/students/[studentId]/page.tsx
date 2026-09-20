import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getTeacherStudentOverview, TeacherAccessDeniedError } from '@/lib/teacher/read-model.service';
import { listTeacherInterventionsForStudent, TeacherInterventionAccessDeniedError } from '@/lib/teacher/intervention.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForInterventionStatus, toneForReadinessStatus } from '@/components/ui/StatusBadge';
import { AssignInterventionForm } from '../AssignInterventionForm';

const TYPE_LABEL_KEY = {
  CONCEPT_REINFORCEMENT: 'teacher.interventions.type.concept',
  SKILL_PRACTICE: 'teacher.interventions.type.skill',
  COMPETENCY_PRACTICE: 'teacher.interventions.type.competency',
  EXAM_PRACTICE: 'teacher.interventions.type.exam',
} as const;

/**
 * F13 -- Teacher Student Detail (task section 17/18/30). `studentId` is
 * a client-supplied route param; `classId` (query string) is routing
 * context ONLY -- both `getTeacherStudentOverview` and
 * `listTeacherInterventionsForStudent` independently re-verify the
 * actor's REAL, current Teacher relationship to this exact student
 * server-side (never inferred from the URL). A denied actor sees the
 * same "not found" a real 404 would (task section 40).
 */
export default async function TeacherStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ classId?: string }>;
}) {
  const { studentId } = await params;
  const { classId } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let interventions;
  try {
    [overview, interventions] = await Promise.all([
      getTeacherStudentOverview(actor.id, studentId),
      listTeacherInterventionsForStudent(actor.id, studentId),
    ]);
  } catch (error) {
    if (error instanceof TeacherAccessDeniedError || error instanceof TeacherInterventionAccessDeniedError) notFound();
    throw error;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title={overview.name}
        subtitle={t['teacher.student.overviewTitle']}
        breadcrumb={
          classId ? (
            <Link href={`/dashboard/teacher/classes/${classId}`}>{t['teacher.roster.title']}</Link>
          ) : (
            <Link href="/dashboard/teacher">{t['nav.teacherClasses']}</Link>
          )
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{t['teacher.student.conceptsWithEvidence']}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{overview.conceptsWithEvidence}</div>
        </div>
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{t['teacher.student.attentionAreas']}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{overview.areasNeedingAttentionCount}</div>
        </div>
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{t['teacher.student.readiness']}</div>
          <div style={{ marginTop: 'var(--space-2)' }}>
            {overview.latestReadinessStatus === 'NO_ACTIVE_EXAM_PROFILE' ? (
              <StatusBadge label={t['teacher.student.noActiveExamProfile']} tone="neutral" />
            ) : (
              <StatusBadge label={overview.latestReadinessStatus} tone={toneForReadinessStatus(overview.latestReadinessStatus)} />
            )}
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{t['teacher.student.lastActivity']}</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 'var(--space-2)' }}>
            {overview.lastActivityAt ? new Date(overview.lastActivityAt).toLocaleDateString(locale) : t['teacher.student.never']}
          </div>
        </div>
      </div>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t['teacher.interventions.title']}</h2>
        {interventions.length === 0 ? (
          <EmptyState title={t['teacher.interventions.empty']} />
        ) : (
          <ul className="list-card card">
            {interventions.map((i) => (
              <li key={i.id} className="list-row">
                <div className="row-main">
                  <div className="row-title">{t[TYPE_LABEL_KEY[i.interventionType]] ?? i.interventionType}</div>
                  <div className="row-sub">{new Date(i.assignedAt).toLocaleDateString(locale)}</div>
                </div>
                <StatusBadge label={i.status} tone={toneForInterventionStatus(i.status)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {classId && (
        <AssignInterventionForm
          classId={classId}
          studentId={studentId}
          labels={{
            title: t['teacher.interventions.assignCta'],
            targetTypeLabel: t['teacher.assign.targetTypeLabel'],
            conceptIdLabel: t['teacher.assign.conceptIdLabel'],
            skillIdLabel: t['teacher.assign.skillIdLabel'],
            competencyIdLabel: t['teacher.assign.competencyIdLabel'],
            examProfileIdLabel: t['teacher.assign.examProfileIdLabel'],
            simulationTypeLabel: t['teacher.assign.simulationTypeLabel'],
            submit: t['teacher.assign.submit'],
            submitting: t['teacher.assign.submitting'],
            success: t['teacher.assign.success'],
            error: t['teacher.assign.error'],
            errorForbidden: t['teacher.assign.error.forbidden'],
            errorInvalidTarget: t['teacher.assign.error.invalidTarget'],
            errorExamProfileMismatch: t['teacher.assign.error.examProfileMismatch'],
            errorInvalidInput: t['teacher.assign.error.invalidInput'],
            typeConcept: t['teacher.interventions.type.concept'],
            typeSkill: t['teacher.interventions.type.skill'],
            typeCompetency: t['teacher.interventions.type.competency'],
            typeExam: t['teacher.interventions.type.exam'],
          }}
        />
      )}
    </div>
  );
}
