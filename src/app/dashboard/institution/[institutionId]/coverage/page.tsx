import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, getInstitutionCoverage, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { listInstitutionCurriculumSubjects, getInstitutionCurriculumCoverage, getCurriculumSubjectCoverage } from '@/lib/institution/curriculum-management.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { IntelligenceHeader, NoCurriculum, loadContext } from '../intelligence-chrome';

/**
 * Track A -- Cobertura curricular (ANALYTICS; configuration lives in "Currículo").
 *  Block 1 -- Institution coverage: for every subject of the selected
 *    programme + grade, curriculum content in class plans / students' plans /
 *    pending (aggregated counts; coverage is NOT mastery), with a subject
 *    drill-down (topics → objectives → concepts).
 *  Block 2 -- StudyUS content coverage (F12 `getInstitutionCoverage`, unchanged):
 *    how much of the published structure is mapped to StudyUS concepts and
 *    resources. Never mixed with block 1.
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
  const subjects = await listInstitutionCurriculumSubjects(institutionId);
  const selectedRow = subjects.find((s) => s.curriculumId === ctx.selected!.curriculumId)!;
  const [rows, drill, platform] = await Promise.all([
    getInstitutionCurriculumCoverage(institutionId, { programmeId: selectedRow.programmeId, gradeId: selectedRow.gradeId }),
    getCurriculumSubjectCoverage(institutionId, selectedRow.curriculumId, locale),
    ctx.structureVersionId ? getInstitutionCoverage(actor.id, institutionId, { structureVersionId: ctx.structureVersionId }).catch(() => null) : Promise.resolve(null),
  ]);
  const scoped = rows.filter((r) => (selectedRow.programmeId ? true : r.curriculumId === selectedRow.curriculumId));
  const qs = (curriculumId: string) => `?curriculum=${curriculumId}`;
  const tk = (k: string) => t[k as MessageKey] ?? k;
  const sel = scoped.find((r) => r.curriculumId === selectedRow.curriculumId);

  return (
    <div>
      {header}
      <section className="card ta-card" aria-labelledby="cov-inst" data-section="institution-coverage">
        <h2 id="cov-inst" style={{ fontSize: 17 }}>{t['cur2.cov.title']}</h2>
        <p className="ta-msg">{t['cur2.cov.subtitle']}</p>
        <p className="ta-msg">
          <strong>
            {selectedRow.programme ?? t['cur2.own.title']} — {selectedRow.gradeName ?? t['cur2.wizard.allGrades']}
          </strong>
        </p>
        {scoped.every((r) => r.total === 0 && r.objectivesIncluded === 0) ? (
          <p className="ta-msg">{t['iix.empty.coverage']}</p>
        ) : (
          <table className="cpi-grid cur2-table">
            <thead>
              <tr>
                <th scope="col">{t['cur2.col.subject']}</th>
                <th scope="col">{t['cur2.cov.col.content']}</th>
                <th scope="col">{t['cur2.cov.col.inClass']}</th>
                <th scope="col">{t['cur2.cov.col.inStudent']}</th>
                <th scope="col">{t['cur2.cov.col.pending']}</th>
                <th scope="col">{t['cur2.col.actions']}</th>
              </tr>
            </thead>
            <tbody>
              {scoped.map((r) => (
                <tr key={r.curriculumId} data-coverage={r.curriculumId} aria-current={r.curriculumId === selectedRow.curriculumId ? 'true' : undefined}>
                  <th scope="row">{[r.subject, r.code, r.level].filter(Boolean).join(' ')}</th>
                  <td data-label={t['cur2.cov.col.content']}>{r.total}</td>
                  <td data-label={t['cur2.cov.col.inClass']}>{r.inClassPlans}</td>
                  <td data-label={t['cur2.cov.col.inStudent']}>{r.inStudentPlans}</td>
                  <td data-label={t['cur2.cov.col.pending']}>{r.pending}</td>
                  <td data-label={t['cur2.col.actions']}>
                    <Link href={qs(r.curriculumId)}>{t['cur2.cov.drill']}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sel && (
          <>
            <p className="ta-msg">{fillMessage(t['cur2.cov.objectives'], { withConcept: sel.objectivesWithConcept, objectives: sel.objectivesIncluded })}</p>
            <p className="ta-msg">{fillMessage(t['cur2.cov.sources'], { authority: sel.bySource.AUTHORITY, institution: sel.bySource.INSTITUTION, teacher: sel.bySource.TEACHER_SUPPLEMENTAL, supplemental: sel.teacherSupplemental })}</p>
          </>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="cov-drill" data-section="subject-drilldown" style={{ marginTop: 'var(--space-4)' }}>
        <h2 id="cov-drill" style={{ fontSize: 16 }}>{[selectedRow.subject, selectedRow.code, selectedRow.level].filter(Boolean).join(' ')}</h2>
        {drill.concepts.length === 0 && drill.topics.length === 0 ? (
          <EmptyState title={t['iix.empty.coverage']} />
        ) : (
          <>
            {drill.topics.map((topic) => (
              <details key={topic.key}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{topic.label}</summary>
                <ul className="role-list ta-compact">
                  {topic.objectives.map((o) => (
                    <li key={o.id} data-status={o.status}>
                      {o.code ? `${o.code} · ` : ''}
                      {o.description} — {o.status === 'EXCLUDED' ? t['cur2.content.excluded'] : tk(`lp.class.${o.classification}`)} ·{' '}
                      {o.concepts.length === 0
                        ? t['cur2.content.noConceptLinked']
                        : o.concepts.map((c) => `${c.label} (${fillMessage(t['cur2.cov.drill.concept'], drill.coverage[c.id] ?? { classes: 0, students: 0 })})`).join(', ')}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <h3 style={{ fontSize: 15 }}>{t['cur2.content.concepts']}</h3>
            <ul className="role-list ta-compact">
              {drill.concepts
                .filter((c) => c.status === 'INCLUDED')
                .map((c) => (
                  <li key={c.id} data-concept={c.id}>
                    <strong>{c.label}</strong> · {tk(`lp.class.${c.classification}`)} · {tk(`cur2.content.source.${c.source}`)} · {fillMessage(t['cur2.cov.drill.concept'], drill.coverage[c.id] ?? { classes: 0, students: 0 })}
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="cov-studyus" data-section="studyus-coverage" style={{ marginTop: 'var(--space-4)' }}>
        <h2 id="cov-studyus" style={{ fontSize: 16 }}>{t['cur2.studyus.title']}</h2>
        <p className="ta-msg">{t['cur2.studyus.body']}</p>
        {!ctx.structureVersionId ? (
          <p className="ta-msg">{t['iix.coverage.platform.noBase']}</p>
        ) : !platform || platform.mappingCoverage.value.total === 0 ? (
          <p className="ta-msg">{t['cur2.structureNotImported']}</p>
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
