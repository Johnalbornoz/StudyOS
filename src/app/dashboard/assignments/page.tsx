import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getStudentPendingTeacherInterventions } from '@/lib/student/teacher-intervention-execution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { StartAssignmentButton } from './StartAssignmentButton';

const TYPE_LABEL_KEY = {
  CONCEPT_REINFORCEMENT: 'teacher.interventions.type.concept',
  SKILL_PRACTICE: 'teacher.interventions.type.skill',
  COMPETENCY_PRACTICE: 'teacher.interventions.type.competency',
  EXAM_PRACTICE: 'teacher.interventions.type.exam',
} as const;

/**
 * F14 Workstream B -- Student Assignment Experience (task section 5).
 * The FIRST Student-facing surface over `teacher_interventions` --
 * F11-C1..C4's execution orchestration (getStudentPendingTeacherInterventions/
 * startTeacherInterventionExecution) already existed, fully certified,
 * with a Student-facing API (`/api/student/teacher-interventions*`)
 * and zero UI. This page is presentation only: it never decides
 * eligibility/targets/status, only shows what the server already
 * decided (effectiveStatus, per getEffectiveStatus).
 */
export default async function AssignmentsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);

  const interventions = await getStudentPendingTeacherInterventions(studentId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader title={t['assignments.title']} subtitle={t['assignments.subtitle']} />

      {interventions.length === 0 ? (
        <EmptyState title={t['assignments.empty']} body={t['assignments.emptyBody']} />
      ) : (
        <ul className="list-card card">
          {interventions.map((i) => (
            <li key={i.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="row-main">
                  <div className="row-title">{t[TYPE_LABEL_KEY[i.interventionType as keyof typeof TYPE_LABEL_KEY]] ?? i.interventionType}</div>
                  {i.instructions && <div className="row-sub">{i.instructions}</div>}
                  {i.dueAt && (
                    <div className="row-sub">{t['assignments.due']}: {new Date(i.dueAt).toLocaleDateString(locale)}</div>
                  )}
                </div>
                <StatusBadge label={t[`assignments.status.${i.effectiveStatus}`] ?? i.effectiveStatus} tone={toneForInterventionStatus(i.effectiveStatus)} />
              </div>
              {(i.effectiveStatus === 'ASSIGNED' || i.effectiveStatus === 'IN_PROGRESS') && (
                <StartAssignmentButton
                  interventionId={i.id}
                  targetType={i.targetType}
                  labels={{
                    start: i.effectiveStatus === 'IN_PROGRESS' ? t['assignments.continue'] : t['assignments.start'],
                    starting: t['assignments.starting'],
                    error: t['assignments.error'],
                    notExecutableYet: t['assignments.notExecutableYet'],
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
