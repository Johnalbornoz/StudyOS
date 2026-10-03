import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext } from '@/lib/institution/page-context';
import { getSetupProgress } from '@/lib/institution/institution-operations.service';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { InstitutionSubNav } from './InstitutionSubNav';

/**
 * Institution summary: quick actions (every core administration task one click away), the
 * first-time setup wizard while the institution is not configured (grades -> curriculum ->
 * classes -> teachers -> students, with progress), and the overview metrics.
 *
 * F13 -- every card renders F12's own real `MetricEnvelope` fields; `getInstitutionOverview`
 * re-verifies the actor's APPROVED INSTITUTION_ADMIN membership to THIS institution
 * (INV-F13-01/15) -- anyone else gets 404.
 */
export default async function InstitutionOverviewPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  const setup = await getSetupProgress(institutionId);
  const base = `/dashboard/institution/${institutionId}`;
  const stepHref: Record<string, string> = {
    grades: `${base}/grades#grade-form`,
    curriculum: `${base}/curriculum`,
    classes: `${base}/classes#class-form`,
    teachers: `${base}/teachers#invite-teacher-title`,
    students: `${base}/students#add-student-title`,
  };
  const quick = [
    { href: `${base}/grades#grade-form`, label: tr['iops.quick.grade'] },
    { href: `${base}/classes#class-form`, label: tr['iops.quick.class'] },
    { href: `${base}/curriculum`, label: tr['iops.quick.curriculum'] },
    { href: `${base}/teachers#invite-teacher-title`, label: tr['iops.quick.teacher'] },
    { href: `${base}/students#add-student-title`, label: tr['iops.quick.student'] },
    { href: `${base}/coordinators`, label: tr['iops.quick.coordinator'] },
    { href: `${base}/tasks`, label: tr['iops.quick.assignment'] },
  ];
  const done = setup.steps.filter((s) => s.done).length;

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['institution.overview.title']} />
        <InstitutionSubNav institutionId={institutionId} active="overview" labels={institutionSubNavLabels(t)} />
      </div>

      <section className="card ta-card" aria-labelledby="quick-actions-title" data-quick-actions>
        <h2 id="quick-actions-title">{tr['iops.quick.title']}</h2>
        <div className="ta-quick">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="btn btn-secondary">
              {q.label}
            </Link>
          ))}
        </div>
      </section>

      {!setup.complete && (
        <section className="card ta-card" aria-labelledby="setup-title" data-setup-wizard>
          <h2 id="setup-title">{tr['iops.setup.title']}</h2>
          <p className="ta-msg">{tr['iops.setup.lead']}</p>
          <p className="ta-msg" role="status">
            {fillMessage(tr['iops.setup.progress'], { done, total: setup.steps.length })}
          </p>
          <progress max={setup.steps.length} value={done} aria-label={tr['iops.setup.title']} style={{ width: '100%' }} />
          <ol className="ta-setup-steps">
            {setup.steps.map((s, i) => (
              <li key={s.key} className={`ta-setup-step${s.done ? ' is-done' : ''}`} data-step={s.key}>
                <span>
                  {i + 1}. {tr[`iops.setup.${s.key}`]}
                </span>
                {s.done ? (
                  <span className="chip chip-good">{tr['iops.setup.done']}</span>
                ) : (
                  <Link className="btn btn-primary" href={stepHref[s.key]}>
                    {tr['iops.setup.go']}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
        <MetricCard label={t['institution.overview.activeTeachers']} value={overview.activeTeacherCount.value} populationDescription={t['inst.overview.teachersDesc']} />
        <MetricCard label={t['institution.overview.classes']} value={overview.activeClassCount.value} populationDescription={t['inst.overview.classesDesc']} />
        <MetricCard label={t['institution.overview.uniqueLearners']} value={overview.uniqueActiveLearnerCount.value} populationDescription={t['inst.overview.learnersDesc']} />
        <MetricCard label={t['institution.overview.activeEnrollments']} value={overview.activeEnrollmentCount.value} populationDescription={t['inst.overview.enrollmentsDesc']} />
      </div>
    </div>
  );
}
