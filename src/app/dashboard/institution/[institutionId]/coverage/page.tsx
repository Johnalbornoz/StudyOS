import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionCoverage, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F14 Workstream D -- Institution Coverage (task section 7/19-21).
 * Consumes F12's `getInstitutionCoverage`, which wraps F6's own
 * `computeMappingCoverage`/`computeContentCoverage` -- curriculum
 * content/mapping completeness, deliberately never mixed with learner
 * Mastery (F5) or per-student blueprint evidence coverage (F9), per the
 * service's own documented invariant. No structure-picker list exists
 * yet at the backend (a real, disclosed gap -- see
 * F14_INSTITUTION_EXPERIENCE.md) -- a `structureVersionId` is entered
 * directly via a plain GET form, the same raw-id convention F13's own
 * Teacher Exam assignment form already established.
 */
export default async function InstitutionCoveragePage({
  params,
  searchParams,
}: {
  params: Promise<{ institutionId: string }>;
  searchParams: Promise<{ structureVersionId?: string }>;
}) {
  const { institutionId } = await params;
  const { structureVersionId } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }

  let coverage: Awaited<ReturnType<typeof getInstitutionCoverage>> | null = null;
  let coverageError: string | null = null;
  if (structureVersionId) {
    try {
      coverage = await getInstitutionCoverage(actor.id, institutionId, { structureVersionId });
    } catch (error) {
      coverageError = error instanceof Error ? error.message : t['error.generic'];
    }
  }

  const subNavLabels = {
    overview: t['institution.overview.title'],
    grades: t['institution.grades.title'],
    classes: t['institution.classes.title'],
    teachers: t['institution.teachers.title'],
    learners: t['institution.learners.title'],
    coverage: t['institution.coverage.title'],
    readiness: t['institution.readiness.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.coverage.title']} />
      <InstitutionSubNav institutionId={institutionId} active="coverage" labels={subNavLabels} />

      <form method="GET" className="card" style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          Structure Version ID
          <input name="structureVersionId" defaultValue={structureVersionId} required />
        </label>
        <button type="submit" className="btn btn-primary">{t['common.save']}</button>
      </form>

      {coverageError && <p role="alert" style={{ color: 'var(--error)' }}>{coverageError}</p>}

      {coverage && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
          <MetricCard
            label={coverage.mappingCoverage.name}
            value={`${coverage.mappingCoverage.numerator} / ${coverage.mappingCoverage.denominator}`}
            populationDescription={coverage.mappingCoverage.population.description}
            limitations={coverage.mappingCoverage.limitations}
          />
          <MetricCard
            label={coverage.contentCoverage.name}
            value={`${coverage.contentCoverage.numerator} / ${coverage.contentCoverage.denominator}`}
            populationDescription={coverage.contentCoverage.population.description}
            limitations={coverage.contentCoverage.limitations}
          />
        </div>
      )}
    </div>
  );
}
