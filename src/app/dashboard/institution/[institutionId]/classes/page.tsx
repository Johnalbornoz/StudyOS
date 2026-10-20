import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { listInstitutionClassesWithStaff, listApprovedTeachers } from '@/services/institution.service';
import { listGrades } from '@/lib/institution/institution-operations.service';
import { listInstitutionCurriculumSubjects, listAcademicDomains } from '@/lib/institution/curriculum-management.service';
import { curriculumContextLabel } from '@/lib/institution/curriculum-identity';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { ClassForm, RowMenu, type MenuItem } from '../OpsActions';

/**
 * Track A -- Classes: create (name, grade, academic area, EXPLICIT curriculum, period, teacher),
 * then per row: area, associated curriculum (full context), teacher(s), students, status and a
 * ⋯ menu (view / edit / assign teacher / enroll / archive or reactivate). Filters by grade and
 * archived. A class's curriculum is never inferred from its name.
 */
export default async function InstitutionClassesPage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<{ gradeId?: string; archived?: string }> }) {
  const { institutionId } = await params;
  const { gradeId, archived } = await searchParams;
  const { t, tr, locale, overview } = await institutionPageContext(institutionId);
  const [allClasses, grades, curricula, domains, teachers] = await Promise.all([
    listInstitutionClassesWithStaff(institutionId),
    listGrades(institutionId),
    listInstitutionCurriculumSubjects(institutionId, { includeArchived: true }),
    listAcademicDomains(locale),
    listApprovedTeachers(institutionId),
  ]);
  const showArchived = archived === '1';
  const classes = allClasses.filter((c) => (!gradeId || c.gradeId === gradeId) && (showArchived || c.status === 'ACTIVE'));
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const api = `/api/institutions/${institutionId}/classes`;
  const domainLabel = new Map(domains.map((d) => [d.code, d.label]));
  const curriculumLabel = new Map(curricula.map((c) => [c.curriculumId, curriculumContextLabel(c, tr['cur2.wizard.allGrades'])]));

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['institution.classes.title']} />
        <InstitutionSubNav institutionId={institutionId} active="classes" labels={institutionSubNavLabels(t)} />
      </div>

      <section className="card ta-card" id="class-form">
        <ClassForm
          institutionId={institutionId}
          grades={grades.map((g) => ({ id: g.id, name: g.name }))}
          domains={domains}
          curricula={curricula.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.curriculumId, label: curriculumContextLabel(c, tr['cur2.wizard.allGrades']), gradeId: c.gradeId, academicDomain: c.academicDomain }))}
          teachers={teachers.map((x) => ({ membershipId: x.membershipId, label: x.name ? `${x.name} (${x.email})` : x.email ?? x.membershipId }))}
          l={l}
        />
      </section>

      <nav className="ta-row" aria-label={t['institution.classes.title']} style={{ justifyContent: 'space-between' }}>
        <span className="ta-row">
          <Link href={`${base}/classes${showArchived ? '?archived=1' : ''}`} aria-current={!gradeId ? 'page' : undefined}>
            {tr['cur2.wizard.allGrades']}
          </Link>
          {grades.map((g) => (
            <Link key={g.id} href={`${base}/classes?gradeId=${g.id}${showArchived ? '&archived=1' : ''}`} aria-current={gradeId === g.id ? 'page' : undefined}>
              {g.name}
            </Link>
          ))}
        </span>
        <Link href={`${base}/classes?${new URLSearchParams({ ...(gradeId ? { gradeId } : {}), ...(showArchived ? {} : { archived: '1' }) })}`}>{showArchived ? l['iops.common.hideArchived'] : l['iops.common.showArchived']}</Link>
      </nav>

      {classes.length === 0 ? (
        <section className="card ta-card" data-empty="classes">
          <p>{l['iops.classes.empty']}</p>
          {grades.length === 0 ? (
            <Link className="btn btn-primary" href={`${base}/grades#grade-form`}>
              {l['iops.grades.emptyCta']}
            </Link>
          ) : (
            <a className="btn btn-primary" href="#class-form">
              {l['iops.classes.emptyCta']}
            </a>
          )}
        </section>
      ) : (
        <ul className="list-card card" aria-label={t['institution.classes.title']}>
          {classes.map((c) => {
            const active = c.status === 'ACTIVE';
            const items: MenuItem[] = [
              { label: l['iops.common.view'], href: `${base}/classes/${c.id}` },
              ...(active
                ? [
                    { label: l['iops.common.edit'], href: `${base}/classes/${c.id}#class-edit` },
                    { label: c.teachers.length ? l['iops.classes.changeTeacher'] : l['iops.classes.assignTeacher'], href: `${base}/classes/${c.id}#class-teacher` },
                    { label: l['iops.classes.enroll'], href: `${base}/classes/${c.id}#roster-title` },
                    { label: tr['cur2.classes.associated'], href: `${base}/classes/${c.id}#class-curriculum-title` },
                    { label: l['iops.common.archive'], action: { url: `${api}/${c.id}/archive`, confirm: l['iops.classes.archiveHint'] } },
                  ]
                : [{ label: l['iops.common.reactivate'], action: { url: `${api}/${c.id}/reactivate` } }]),
            ];
            return (
              <li key={c.id} className="list-row ta-entity-row" data-class={c.id}>
                <div className="ta-entity-main">
                  <Link href={`${base}/classes/${c.id}`} className="row-title" style={{ color: 'inherit' }}>
                    {c.name}
                  </Link>
                  <span className="row-sub">
                    {[c.gradeName, c.academicDomain ? domainLabel.get(c.academicDomain) : l['iops.classes.noDomain'], c.period].filter(Boolean).join(' · ')}
                  </span>
                  <span className="row-sub">
                    {tr['cur2.classes.associated']}: {c.institutionCurriculumId ? curriculumLabel.get(c.institutionCurriculumId) : tr['cur2.classes.none2']}
                  </span>
                  <span className="row-sub">
                    {l['iops.classes.teacher']}: {c.teachers.length ? c.teachers.map((x) => x.name ?? x.email).join(', ') : l['iops.classes.noTeacher']} ·{' '}
                    {fillMessage(l['iops.classes.students'], { n: c.activeEnrollmentCount, p: c.pendingEnrollmentCount })}
                  </span>
                </div>
                <div className="ta-entity-actions">
                  <span className={`chip${active ? ' chip-good' : ''}`}>{l[`iops.common.status.${c.status}`]}</span>
                  <RowMenu items={items} label={c.name} l={l} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
