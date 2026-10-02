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
import { db } from '@/lib/db';
import { fillMessage } from '@/lib/i18n/roles-messages';

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
  // Track A: show WHAT to practise (the learner's own topic, in their
  // language) rather than only the assignment type. Read-only lookup.
  const topicRows = interventions.length
    ? await db.query(
        `SELECT ti.id, (SELECT label FROM concept_localizations cl WHERE cl.concept_id = ti.concept_id ORDER BY (cl.language = $2) DESC, cl.language LIMIT 1) AS label,
                (SELECT k.name FROM classes k WHERE k.id = ti.class_id) AS class_name, ti.owner_scope
         FROM teacher_interventions ti WHERE ti.id = ANY($1::uuid[]) AND ti.student_id = $3`,
        [interventions.map((i) => i.id), locale, studentId]
      ).catch(() => ({ rows: [] as any[] }))
    : { rows: [] as any[] };
  const topicById = new Map<string, string | null>(topicRows.rows.map((r: any) => [r.id, r.label]));
  const classById = new Map<string, string | null>(topicRows.rows.map((r: any) => [r.id, r.class_name]));
  const institutionalById = new Set<string>(topicRows.rows.filter((r: any) => r.owner_scope === 'INSTITUTION').map((r: any) => r.id));
  const now = Date.now();

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
                  <div className="row-title">{i.title || topicById.get(i.id) || (t[TYPE_LABEL_KEY[i.interventionType as keyof typeof TYPE_LABEL_KEY]] ?? i.interventionType)}</div>
                  {i.title && topicById.get(i.id) && <div className="row-sub">{fillMessage(t['studentAssign.topic'], { topic: topicById.get(i.id) })}</div>}
                  {classById.get(i.id) && <div className="row-sub">{fillMessage(institutionalById.has(i.id) ? t['cur2.student.institutionTask'] : t['studentAssign.assignedBy'], { className: classById.get(i.id) })}</div>}
                  {i.instructions && <div className="row-sub">{i.instructions}</div>}
                  {i.startsAt && new Date(i.startsAt).getTime() > now && (
                    <div className="row-sub">{fillMessage(t['studentAssign.availableFrom'], { date: new Date(i.startsAt).toLocaleDateString(locale) })}</div>
                  )}
                  {i.dueAt && (
                    <div className="row-sub">{t['assignments.due']}: {new Date(i.dueAt).toLocaleDateString(locale)}</div>
                  )}
                </div>
                <StatusBadge label={t[`assignments.status.${i.effectiveStatus}`] ?? i.effectiveStatus} tone={toneForInterventionStatus(i.effectiveStatus)} />
              </div>
              {(i.effectiveStatus === 'ASSIGNED' || i.effectiveStatus === 'IN_PROGRESS') && !(i.startsAt && new Date(i.startsAt).getTime() > now) && (
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
