import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { listGrades, listProgrammeOptions } from '@/lib/institution/institution-operations.service';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { GradeForm, RowMenu, type MenuItem } from '../OpsActions';

/**
 * Track A -- Grades: create (name, academic level, programme, academic year), edit, archive,
 * reactivate, delete (only when nothing depends on it). Each row has a ⋯ menu with the actions
 * valid for its state; the detail page lists its classes, curriculum and students.
 */
export default async function InstitutionGradesPage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<{ archived?: string }> }) {
  const { institutionId } = await params;
  const { archived } = await searchParams;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  const showArchived = archived === '1';
  const [grades, programmes] = await Promise.all([listGrades(institutionId, { includeArchived: showArchived }), listProgrammeOptions()]);
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const api = `/api/institutions/${institutionId}/grades`;

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['institution.grades.title']} />
        <InstitutionSubNav institutionId={institutionId} active="grades" labels={institutionSubNavLabels(t)} />
      </div>

      <section className="card ta-card" id="grade-form">
        <GradeForm institutionId={institutionId} programmes={programmes} l={l} />
      </section>

      <div className="ta-row" style={{ justifyContent: 'flex-end' }}>
        <Link href={showArchived ? `${base}/grades` : `${base}/grades?archived=1`}>{showArchived ? l['iops.common.hideArchived'] : l['iops.common.showArchived']}</Link>
      </div>

      {grades.length === 0 ? (
        <section className="card ta-card" data-empty="grades">
          <p>{l['iops.grades.empty']}</p>
          <a className="btn btn-primary" href="#grade-form">
            {l['iops.grades.emptyCta']}
          </a>
        </section>
      ) : (
        <ul className="list-card card" aria-label={t['institution.grades.title']}>
          {grades.map((g) => {
            const items: MenuItem[] = [
              { label: l['iops.common.view'], href: `${base}/grades/${g.id}` },
              { label: l['iops.common.edit'], href: `${base}/grades/${g.id}#grade-edit` },
              g.status === 'ACTIVE'
                ? { label: l['iops.common.archive'], action: { url: `${api}/${g.id}/archive`, confirm: l['iops.grades.archiveHint'] } }
                : { label: l['iops.common.reactivate'], action: { url: `${api}/${g.id}/reactivate` } },
              ...(g.activeClasses + g.archivedClasses + g.curricula === 0 ? [{ label: l['iops.common.delete'], danger: true, action: { url: `${api}/${g.id}`, method: 'DELETE', confirm: l['iops.common.confirm'] } }] : []),
            ];
            return (
              <li key={g.id} className="list-row ta-entity-row" data-grade={g.id}>
                <div className="ta-entity-main">
                  <Link href={`${base}/grades/${g.id}`} className="row-title" style={{ color: 'inherit' }}>
                    {g.name}
                  </Link>
                  <span className="row-sub">{[g.academicLevel, g.programmeLabel, g.academicYear].filter(Boolean).join(' · ')}</span>
                  <span className="row-sub">{fillMessage(l['iops.grades.counts'], { classes: g.activeClasses, students: g.students, curricula: g.curricula })}</span>
                </div>
                <div className="ta-entity-actions">
                  <span className={`chip${g.status === 'ACTIVE' ? ' chip-good' : ''}`}>{l[`iops.common.status.${g.status}`]}</span>
                  <RowMenu items={items} label={g.name} l={l} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
