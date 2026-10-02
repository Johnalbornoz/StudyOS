import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, getInstitutionCoverage, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { getCurriculumWorkCoverage } from '@/lib/institution/intelligence-context.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { IntelligenceHeader, NoCurriculum, loadContext } from '../intelligence-chrome';

/**
 * F14 / Track A -- Institution Coverage. The context (Programa → Versión
 * curricular → Grado → Asignatura) is chosen among the institution's own
 * curricula; the structure version is resolved server-side (never typed).
 *  1. Curriculum WORK coverage: which curriculum concepts the institution's
 *     classes and students are working on (class plans / personal plans,
 *     aggregated counts) and which are still pending.
 *  2. StudyUS CONTENT coverage of the curriculum's published structure
 *     (F12 `getInstitutionCoverage`, unchanged) when the curriculum has a
 *     published base.
 */
export default async function InstitutionCoveragePage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institutionId } = await params;
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let ctx;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    ctx = await loadContext(actor.id, institutionId, sp, t);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }

  const header = <IntelligenceHeader t={t} institutionId={institutionId} institutionName={overview.institutionName} tab="coverage" ctx={ctx} show={{ curriculum: true, period: false, class: false, exam: false }} />;
  if (!ctx.selected) {
    return (
      <div>
        {header}
        <NoCurriculum t={t} institutionId={institutionId} />
      </div>
    );
  }

  const [work, platform] = await Promise.all([
    getCurriculumWorkCoverage(institutionId, ctx.selected.curriculumId, locale),
    ctx.structureVersionId ? getInstitutionCoverage(actor.id, institutionId, { structureVersionId: ctx.structureVersionId }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div>
      {header}
      <section className="card ta-card" aria-labelledby="work-title" data-section="work">
        <h2 id="work-title" style={{ fontSize: 16 }}>{t['iix.coverage.work.title']}</h2>
        {work.total === 0 || work.learnerTotal === 0 ? (
          <p className="ta-msg">{t['iix.empty.coverage']}</p>
        ) : (
          <>
            <div className="ta-grid">
              <div className="card ta-metric">
                <span className="ta-metric-value">
                  {work.inClassPlans} / {work.total}
                </span>
                <span className="ta-metric-text">{fillMessage(t['iix.coverage.work.classes'], { n: work.inClassPlans, total: work.total })}</span>
              </div>
              <div className="card ta-metric">
                <span className="ta-metric-value">
                  {work.inStudentPlans} / {work.total}
                </span>
                <span className="ta-metric-text">{fillMessage(t['iix.coverage.work.students'], { n: work.inStudentPlans, total: work.total, learners: work.learnerTotal })}</span>
              </div>
            </div>
            <h3 style={{ fontSize: 15 }}>{t['iix.coverage.pending']}</h3>
            {work.pending.length === 0 ? <p className="ta-msg">{t['iix.coverage.allWorked']}</p> : <p className="ta-msg">{work.pending.map((c) => c.label).join(' · ')}</p>}
            <details>
              <summary>{t['iix.coverage.detail']}</summary>
              <ul className="role-list ta-compact">
                {work.concepts.map((c) => (
                  <li key={c.conceptId}>
                    <strong>{c.label}</strong> · {fillMessage(t['iix.coverage.concept'], { classes: c.classes, students: c.students })}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="platform-title" data-section="platform" style={{ marginTop: 'var(--space-4)' }}>
        <h2 id="platform-title" style={{ fontSize: 16 }}>{t['iix.coverage.platform.title']}</h2>
        {!ctx.structureVersionId ? (
          <p className="ta-msg">{t['iix.coverage.platform.noBase']}</p>
        ) : !platform || platform.mappingCoverage.value.total === 0 ? (
          <EmptyState title={t['iix.empty.coverage']} />
        ) : (
          <div className="ta-grid">
            <div className="card ta-metric">
              <span className="ta-metric-label">{t['iix.coverage.platform.mapping']}</span>
              <span className="ta-metric-value">
                {platform.mappingCoverage.numerator} / {platform.mappingCoverage.denominator}
              </span>
            </div>
            <div className="card ta-metric">
              <span className="ta-metric-label">{t['iix.coverage.platform.content']}</span>
              <span className="ta-metric-value">
                {platform.contentCoverage.numerator} / {platform.contentCoverage.denominator}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
