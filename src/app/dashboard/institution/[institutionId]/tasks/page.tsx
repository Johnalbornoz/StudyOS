import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { canAccessInstitution } from '@/lib/authorization';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { listInstitutionCurriculumSubjects, listInstitutionCurriculumContent } from '@/lib/institution/curriculum-management.service';
import { listInstitutionAssignments } from '@/lib/institution/institution-governance.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { CreateInstitutionTask, EditTaskDue } from './InstitutionTasks';

/**
 * Track A -- institution tasks. The institution defines concept, text, dates,
 * period, priority and required status (locked for teachers) and the
 * delivery: teachers choose recipients, or every student of the target
 * classes gets it directly.
 */
export default async function InstitutionTasksPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }
  if (!(await canAccessInstitution(actor.id, institutionId, 'TEACHER_ASSIGNMENT_MANAGE'))) notFound();
  const [classes, subjects, tasks] = await Promise.all([listInstitutionClassesWithStaff(institutionId), listInstitutionCurriculumSubjects(institutionId), listInstitutionAssignments(institutionId, locale)]);
  const contents = await Promise.all(subjects.map((s) => listInstitutionCurriculumContent(institutionId, s.curriculumId, locale)));
  const concepts = [...new Map(contents.flatMap((c) => c.concepts.filter((x) => x.status === 'INCLUDED').map((x) => [x.id, { id: x.id, label: x.label, subjectId: c.curriculum.canonicalSubjectId }] as const))).values()];
  const tk = (k: string) => t[k as MessageKey] ?? k;
  const labels: Record<string, string> = {};
  for (const k of ['concept', 'titleField', 'instructions', 'startsAt', 'dueAt', 'period', 'priority', 'required', 'mode', 'classes', 'submit', 'created', 'editDue']) labels[k] = tk(`cur2.tasks.${k}`);
  for (const m of ['TEACHER_SELECTS_RECIPIENTS', 'DIRECT_ALL_STUDENTS']) labels[`mode.${m}`] = tk(`cur2.tasks.mode.${m}`);
  for (const p of ['HIGH', 'NORMAL', 'LOW']) labels[`priority.${p}`] = tk(`tcp.plan.priority.${p}`);
  Object.assign(labels, { error: t['cur2.error'], save: t['cur2.save'], saved: t['cur2.saved'] });
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['cur2.tasks.title']} />
        <InstitutionSubNav institutionId={institutionId} active="tasks" labels={institutionSubNavLabels(t)} />
      </div>
      <p className="ta-msg iix-help">{t['cur2.tasks.subtitle']}</p>
      {concepts.length > 0 && (
        <details className="card ta-card" open={tasks.length === 0}>
          <summary className="btn btn-primary">{t['cur2.tasks.create']}</summary>
          <CreateInstitutionTask institutionId={institutionId} classes={classes.map((k) => ({ id: k.id, name: k.name, subjectId: k.subjectId }))} concepts={concepts} labels={labels} />
        </details>
      )}
      {tasks.length === 0 ? (
        <EmptyState title={t['cur2.tasks.empty']} />
      ) : (
        <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tasks.map((a) => (
            <li key={a.id} className="list-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }} data-task={a.id}>
              <div className="row-main" style={{ flexBasis: 280 }}>
                <div className="row-title">{a.title}</div>
                <div className="row-sub">
                  {a.conceptLabel} · {t['cur2.tasks.dueAt']}: {fmt(a.dueAt)} · {tk(`tcp.plan.priority.${a.priority}`)}
                  {a.required ? ` · ${t['cur2.tasks.required']}` : ''}
                </div>
                <div className="row-sub">{tk(`cur2.tasks.mode.${a.deliveryMode}`)}</div>
                {a.targets.map((tg) => (
                  <div key={tg.classId} className="row-sub">
                    {fillMessage(t['cur2.tasks.recipients'], { class: tg.className, recipients: tg.recipients, learners: tg.activeLearners, completed: tg.completed })}
                  </div>
                ))}
              </div>
              <EditTaskDue institutionId={institutionId} assignmentId={a.id} current={a.dueAt} labels={labels} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
