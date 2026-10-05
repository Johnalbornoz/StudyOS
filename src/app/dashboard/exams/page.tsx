import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { listExamInstances, toInstanceView } from '@/lib/exam-core/exam-instance.service';
import { db } from '@/lib/db';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { PageIntro } from '@/components/ui/PageIntro';
import { ExamCatalogBrowser } from './ExamCatalogBrowser';
import { InstanceCard } from './InstanceCard';
import { PreparationChooser } from '../exam-prep/PreparationChooser';
import { loadPickerData } from '@/lib/exam-core/objectives/picker';

/**
 * Objective first: without a deep link the page asks "¿Para qué examen quieres
 * prepararte?" (every catalogue objective selectable, readiness never blocks).
 * With `?node=` (from a preparation) it opens the activity launcher at that entry.
 *
 * Exam V2 -- "Exámenes": choose an exam by walking the framework's own
 * structure, pick papers and a mode (Practice / Mock / Challenge), and manage
 * one's exam instances (start, continue, results, repeat from zero, delete).
 */
export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const { node } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale) as Record<string, string>;
  const labels: Record<string, string> = Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith('exv2.')));
  for (const f of EXAM_FAMILIES) labels[`exv2.family.${f}`] = t[`exam.family.${f}`] ?? f;

  const instances = await Promise.all((await listExamInstances(studentId)).map(toInstanceView));
  // Deep link to one selectable exam level (validated: it must exist and be selectable).
  const initialNode = node && /^[a-z0-9._-]{1,120}$/.test(node)
    ? ((await db.query(`SELECT node_key AS key, family, COALESCE(labels->>$2, label) AS label FROM assessment_structure_nodes WHERE node_key = $1 AND status = 'ACTIVE' AND selectable = true`, [node, locale])).rows[0] ?? null)
    : null;
  const picker = initialNode ? null : await loadPickerData(studentId, locale);
  // The AICE Diploma planner is offered only where it applies: eligible for this Student, or a plan they already have.
  const showAicePlanner = initialNode
    ? true
    : picker!.suggested.includes('CIE_AICE') || (await db.query(`SELECT 1 FROM aice_diploma_plans WHERE student_id = $1 AND status = 'ACTIVE' LIMIT 1`, [studentId])).rows.length > 0;
  const prepLabels: Record<string, string> = Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith('prep.') || k.startsWith('elig.')));
  const active = instances.filter((i) => i.status === 'DRAFT' || i.status === 'READY' || i.status === 'IN_PROGRESS');
  const past = instances.filter((i) => i.status === 'COMPLETED' || i.status === 'ARCHIVED');

  return (
    <div className="exv2-page">
      <PageIntro
        title={initialNode ? t['exv2.page.title'] : t['prep.question']}
        lead={initialNode ? t['exv2.page.lead'] : t['prep.lead']}
        crumb={<Link href="/dashboard/exam-prep">{t['examPrep.title']}</Link>}
        actions={showAicePlanner ? <Link className="btn btn-secondary" href="/dashboard/exams/aice">{t['exv2.aice.diplomaPlan']}</Link> : undefined}
      />
      {active.length > 0 && (
        <section aria-labelledby="exv2-active" className="exv2-list">
          <h2 id="exv2-active" className="exv2-title">{t['exv2.list.active']}</h2>
          {active.map((i) => <InstanceCard key={i.id} instance={i} labels={labels} language={locale} />)}
        </section>
      )}
      {/* Objective first: the Explorer asks WHICH exam to prepare (every objective selectable);
          the activity launcher opens from a preparation (deep link to an entry). */}
      {initialNode ? (
        <ExamCatalogBrowser labels={labels} language={locale} initialNode={initialNode} />
      ) : (
        <PreparationChooser objectives={picker!.objectives} frameworks={picker!.frameworks} suggested={picker!.suggested} frameworkReasons={picker!.frameworkReasons} hasAcademicContext={picker!.hasAcademicContext} labels={prepLabels} />
      )}
      {past.length > 0 && (
        <section aria-labelledby="exv2-past" className="exv2-list">
          <h2 id="exv2-past" className="exv2-title">{t['exv2.list.past']}</h2>
          {past.map((i) => <InstanceCard key={i.id} instance={i} labels={labels} language={locale} />)}
        </section>
      )}
    </div>
  );
}
