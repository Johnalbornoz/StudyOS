import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { canAccessInstitution } from '@/lib/authorization';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { listInstitutionCurriculumContent, CurriculumManagementError } from '@/lib/institution/curriculum-management.service';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { InstitutionSubNav } from '../../InstitutionSubNav';
import { ObjectivesManager, ConceptsManager, InstitutionPlanForm } from './ContentManager';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- curriculum content of one institution curriculum subject:
 * Topic (published structure node) → Objective → mapped catalog concepts,
 * plus the curriculum's concepts. Include / exclude / restore / classify in
 * bulk; the published structure is never modified. Where no structure was
 * imported, content is organised by catalog concepts (no invented topics).
 */
export default async function CurriculumContentPage({ params }: { params: Promise<{ institutionId: string; curriculumId: string }> }) {
  const { institutionId, curriculumId } = await params;
  if (!UUID_RE.test(curriculumId)) notFound();
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
  const content = await listInstitutionCurriculumContent(institutionId, curriculumId, locale).catch((e) => {
    if (e instanceof CurriculumManagementError) return null;
    throw e;
  });
  if (!content) notFound();
  const classes = (await listInstitutionClassesWithStaff(institutionId)).filter((c) => c.institutionCurriculumId === curriculumId);
  const c = content.curriculum;
  const readOnly = c.status !== 'ACTIVE';
  const tk = (k: string) => t[k as MessageKey] ?? k;
  const labels: Record<string, string> = {
    selected: t['cur2.content.selected'],
    selectAll: t['cur2.content.selectAll'],
    include: t['cur2.content.include'],
    exclude: t['cur2.content.exclude'],
    excluded: t['cur2.content.excluded'],
    noConcept: t['cur2.content.noConceptLinked'],
    addConcept: t['cur2.content.addConcept'],
    add: t['cur2.content.add'],
    classification: t['icur.classification'],
    targetDate: t['cur2.content.targetDate'],
    error: t['cur2.error'],
  };
  for (const k of ['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL']) labels[k] = tk(`lp.class.${k}`);
  for (const k of ['AUTHORITY', 'INSTITUTION', 'TEACHER_SUPPLEMENTAL']) labels[`source.${k}`] = tk(`cur2.content.source.${k}`);
  const included = content.concepts.filter((x) => x.status === 'INCLUDED');

  return (
    <div className="ta-stack">
      <div>
        <PageHeader
          title={overview.institutionName}
          subtitle={`${t['cur2.content.title']} · ${[c.subject, c.code, c.level].filter(Boolean).join(' ')}`}
          breadcrumb={<Link href={`/dashboard/institution/${institutionId}/curriculum`}>{t['cur2.config.title']}</Link>}
        />
        <InstitutionSubNav institutionId={institutionId} active="curriculum" labels={institutionSubNavLabels(t)} />
      </div>
      <p className="ta-msg">
        {[c.programme, c.authority, c.gradeName ?? t['cur2.wizard.allGrades'], c.versionLabel, c.academicYear].filter(Boolean).join(' · ')}{' '}
        <span className="chip">{tk(`cur2.source.${c.sourceType}`)}</span> {readOnly && <span className="chip">{t['cur2.status.ARCHIVED']}</span>}
      </p>
      <p className="ta-msg iix-help">{t['cur2.content.subtitle']}</p>

      <section className="card ta-card" aria-labelledby="cur2-objectives">
        <h2 id="cur2-objectives">{t['cur2.content.objectives']}</h2>
        {content.topics.length === 0 ? (
          <p className="ta-msg">{c.academicSubjectId && !c.structureImported ? t['cur2.structureNotImported'] : t['cur2.content.noObjectives']}</p>
        ) : (
          <ObjectivesManager institutionId={institutionId} curriculumId={curriculumId} topics={content.topics} labels={labels} readOnly={readOnly} />
        )}
      </section>

      <section className="card ta-card" aria-labelledby="cur2-concepts">
        <h2 id="cur2-concepts">{t['cur2.content.concepts']}</h2>
        <p className="ta-msg">{t['cur2.content.conceptsBody']}</p>
        <ConceptsManager institutionId={institutionId} curriculumId={curriculumId} concepts={content.concepts} addable={content.addable} labels={labels} readOnly={readOnly} />
      </section>

      {!readOnly && classes.length > 0 && included.length > 0 && (
        <section className="card ta-card" aria-labelledby="cur2-locked">
          <h2 id="cur2-locked">{t['cur2.lockedPlan.title']}</h2>
          <p className="ta-msg">{t['cur2.lockedPlan.body']}</p>
          <InstitutionPlanForm
            institutionId={institutionId}
            classes={classes.map((k) => ({ id: k.id, name: k.name }))}
            concepts={included.map((x) => ({ id: x.id, label: x.label }))}
            labels={{
              class: t['cur2.lockedPlan.class'],
              concept: t['cur2.lockedPlan.concept'],
              priority: t['cur2.lockedPlan.priority'],
              'priority.HIGH': t['tcp.plan.priority.HIGH'],
              'priority.NORMAL': t['tcp.plan.priority.NORMAL'],
              'priority.LOW': t['tcp.plan.priority.LOW'],
              targetDate: t['cur2.content.targetDate'],
              period: t['cur2.tasks.period'],
              submit: t['cur2.lockedPlan.submit'],
              saved: t['cur2.saved'],
              error: t['cur2.error'],
            }}
          />
          <p className="ta-msg">{fillMessage(t['cur2.contentSummary'], { objectives: c.objectivesIncluded, total: c.objectivesTotal, concepts: c.conceptsIncluded, required: c.required })}</p>
        </section>
      )}
    </div>
  );
}
