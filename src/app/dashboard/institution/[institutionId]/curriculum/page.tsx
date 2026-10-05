import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { canAccessInstitution } from '@/lib/authorization';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { institutionSubNavLabels, classBindingLabels } from '@/lib/institution/admin-labels';
import { listInstitutionGrades, listInstitutionClassesWithStaff } from '@/services/institution.service';
import { listInstitutionCurriculumSubjects, listCurriculumSourceOptions, listAcademicDomains, type CurriculumSubjectRow } from '@/lib/institution/curriculum-management.service';
import { curriculumContextLabel, rankCurriculumCandidates } from '@/lib/institution/curriculum-identity';
import { curriculumScope, countryLabel } from '@/lib/curriculum/catalog-scope';
import { listSupplementalSuggestions, listAdoptableSubjects, CURRICULUM_CLASSIFICATIONS } from '@/lib/learning-plan/institution-curriculum.service';
import { listConceptProposals } from '@/lib/learning-plan/concept-proposals.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProposeConceptForm } from '@/components/learning-plan/ProposeConceptForm';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { AdoptCurriculumForm, AddCurriculumConceptForm } from './CurriculumActions';
import { AddSubjectsWizard, EditSubjectPanel, ArchiveSubjectButton, ClassCurriculumSelect } from './CurriculumManager';

/**
 * Track A -- Institution Curriculum Management V2 (CONFIGURATION; coverage is
 * the separate "Cobertura curricular" tab). Programme → Grade groups, each with
 * its subjects (syllabus, level, version, status, classes, content); add one or
 * many governed subjects, edit level / version with impact, archive with impact
 * (history kept), class associations, the institution's own curricula,
 * teachers' supplemental concepts and concept proposals.
 */
export default async function InstitutionCurriculumPage({ params }: { params: Promise<{ institutionId: string }> }) {
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

  const [all, sources, grades, classes, supplemental, proposals, adoptable, domains] = await Promise.all([
    listInstitutionCurriculumSubjects(institutionId, { includeArchived: true }),
    listCurriculumSourceOptions(),
    listInstitutionGrades(institutionId),
    listInstitutionClassesWithStaff(institutionId),
    listSupplementalSuggestions(institutionId, locale),
    listConceptProposals({ institutionId }),
    listAdoptableSubjects(),
    listAcademicDomains(locale),
  ]);
  const domainLabels = new Map(domains.map((d) => [d.code, d.label]));
  const active = all.filter((s) => s.status === 'ACTIVE');
  const archived = all.filter((s) => s.status === 'ARCHIVED');
  const tk = (k: string) => t[k as MessageKey] ?? k;
  const wl = Object.fromEntries(
    [
      'step', 'country', 'international', 'authority', 'grade', 'allGrades', 'subjects', 'subjectsHelp', 'version', 'year', 'review', 'next', 'back', 'confirm', 'cancel', 'done', 'noOptions',
      'type.title', 'type.NATIONAL', 'type.NATIONAL.help', 'type.INTERNATIONAL', 'type.INTERNATIONAL.help', 'organization', 'programme', 'qualification', 'gradeOptional', 'continue',
    ].map((k) => [k, tk(`cur2.wizard.${k}`)])
  ) as Record<string, string>;
  Object.assign(wl, { addSubjects: t['cur2.addSubjects'], error: t['cur2.error'], structureNotImported: t['cur2.structureNotImported'] });
  for (const s of ['GOVERNMENT_AUTHORITY', 'INTERNATIONAL_PROGRAMME', 'INSTITUTION_DEFINED', 'STUDYUS_REFERENCE']) wl[`source.${s}`] = tk(`cur2.source.${s}`);
  const el = {
    levelVersion: t['cur2.edit.levelVersion'],
    impact: t['cur2.edit.impact'],
    updateVersion: t['cur2.edit.updateVersion'],
    grade: t['cur2.edit.grade'],
    allGrades: t['cur2.wizard.allGrades'],
    year: t['cur2.edit.year'],
    titleField: t['cur2.edit.titleField'],
    save: t['cur2.save'],
    saved: t['cur2.saved'],
    error: t['cur2.error'],
  };
  const al = { archive: t['cur2.archive'], archiveConfirm: t['cur2.archiveConfirm'], archiveConfirmUnused: t['cur2.archiveConfirmUnused'], error: t['cur2.error'] };
  const groups = new Map<string, { programme: string; programmeId: string | null; gradeId: string | null; gradeName: string | null; sourceType: string; authority: string | null; rows: CurriculumSubjectRow[] }>();
  for (const s of active) {
    const key = `${s.programmeId ?? s.programme ?? 'own'}|${s.gradeId ?? ''}`;
    const g = groups.get(key) ?? { programme: s.programme ?? t['cur2.own.title'], programmeId: s.programmeId, gradeId: s.gradeId, gradeName: s.gradeName, sourceType: s.sourceType, authority: s.authority, rows: [] };
    g.rows.push(s);
    groups.set(key, g);
  }
  // Configured curricula (one per programme, any number per institution; national and international side by side).
  const configured = new Map<string, { key: string; scope: 'NATIONAL' | 'INTERNATIONAL'; country: string | null; authority: string | null; programme: string; subjects: number; anchor: string }>();
  for (const g of groups.values()) {
    const key = g.programmeId ?? `own:${g.programme}`;
    const first = g.rows[0];
    const e = configured.get(key) ?? { key, scope: curriculumScope({ country: first.country, sourceType: first.sourceType }), country: first.country, authority: first.authority, programme: g.programme, subjects: 0, anchor: `cur2-group-${g.programmeId ?? 'own'}-${g.gradeId ?? 'all'}` };
    e.subjects += g.rows.length;
    configured.set(key, e);
  }
  const alternativesFor = (s: CurriculumSubjectRow) => sources.filter((o) => o.programmeId === s.programmeId && o.canonicalSubjectId === s.canonicalSubjectId && o.subject === s.subject);
  const classifications = Object.fromEntries(CURRICULUM_CLASSIFICATIONS.map((c) => [c, t[`lp.class.${c}` as MessageKey]])) as Record<(typeof CURRICULUM_CLASSIFICATIONS)[number], string>;
  const curriculumLabel = (s: CurriculumSubjectRow) => [s.subject, s.code, s.level, s.gradeName ?? t['cur2.wizard.allGrades'], s.versionLabel && !s.versionLabel.startsWith(s.code ?? '§') ? s.versionLabel : null].filter(Boolean).join(' · ');

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['cur2.config.title']} />
        <InstitutionSubNav institutionId={institutionId} active="curriculum" labels={institutionSubNavLabels(t)} />
      </div>
      <section aria-labelledby="cur2-v2-heading" className="ta-stack" style={{ gap: 'var(--space-1)' }}>
        <h2 id="cur2-v2-heading" style={{ fontSize: 19 }}>{tk('cur2.v2.heading')}</h2>
        <p className="ta-msg">{tk('cur2.v2.intro')}</p>
      </section>
      <p className="ta-msg iix-help">
        {t['cur2.config.subtitle']}{' '}
        <Link href={`/dashboard/institution/${institutionId}/coverage`}>{t['cur2.config.toCoverage']}</Link>
      </p>

      {active.length === 0 ? (
        <section className="card ta-card" aria-labelledby="cur2-empty">
          <h2 id="cur2-empty">{t['cur2.empty.title']}</h2>
          <p className="ta-msg">{t['cur2.empty.body']}</p>
          <details open>
            <summary className="btn btn-primary">{t['cur2.empty.cta']}</summary>
            <AddSubjectsWizard institutionId={institutionId} sources={sources} grades={grades} labels={wl} />
          </details>
        </section>
      ) : (
        <>
          <section className="card ta-card" aria-labelledby="cur2-configured" data-testid="configured-curricula">
            <h2 id="cur2-configured" style={{ fontSize: 17 }}>{tk('cur2.configured.title')}</h2>
            <ul className="cur2-configured-list">
              {[...configured.values()].map((c) => (
                <li key={c.key} className="cur2-configured" data-scope={c.scope}>
                  <span className="chip">{tk(`cur2.wizard.type.${c.scope}`)}</span>
                  <span className="cur2-configured-body">
                    <strong>{c.scope === 'NATIONAL' && c.country ? countryLabel(c.country) : c.authority ?? '—'}</strong>
                    <span className="ta-msg">
                      {[c.scope === 'NATIONAL' ? c.authority : null, c.programme].filter(Boolean).join(' · ')} · {fillMessage(tk('cur2.configured.subjects'), { n: c.subjects })}
                    </span>
                  </span>
                  <a className="btn btn-ghost" href={`#${c.anchor}`}>{tk('cur2.configured.view')}</a>
                </li>
              ))}
            </ul>
          </section>
          {[...groups.values()].map((g) => (
            <section key={`${g.programmeId}|${g.gradeId}`} id={`cur2-group-${g.programmeId ?? 'own'}-${g.gradeId ?? 'all'}`} className="card ta-card cur2-group" aria-label={`${g.programme} — ${g.gradeName ?? t['cur2.wizard.allGrades']}`}>
              <div className="ta-coordinator">
                <h2 style={{ fontSize: 17 }}>
                  {g.programme} — {g.gradeName ?? t['cur2.wizard.allGrades']}
                </h2>
                <span className="chip">{g.authority ?? tk(`cur2.source.${g.sourceType}`)}</span>
              </div>
              <table className="cpi-grid cur2-table">
                <thead>
                  <tr>
                    <th scope="col">{t['cur2.col.subject']}</th>
                    <th scope="col">{t['cur2.col.syllabus']}</th>
                    <th scope="col">{t['cur2.col.level']}</th>
                    <th scope="col">{t['cur2.col.version']}</th>
                    <th scope="col">{t['cur2.col.status']}</th>
                    <th scope="col">{t['cur2.col.classes']}</th>
                    <th scope="col">{t['cur2.col.content']}</th>
                    <th scope="col">{t['cur2.col.actions']}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((s) => (
                    <tr key={s.curriculumId} data-curriculum={s.curriculumId}>
                      <th scope="row">{s.subject}</th>
                      <td data-label={t['cur2.col.syllabus']}>{s.code ?? '—'}</td>
                      <td data-label={t['cur2.col.level']}>{s.level ?? '—'}</td>
                      <td data-label={t['cur2.col.version']}>
                        {s.versionLabel ?? '—'}
                        {s.academicYear ? ` · ${s.academicYear}` : ''}
                      </td>
                      <td data-label={t['cur2.col.status']}>
                        <span className="chip chip-good">{t['cur2.status.ACTIVE']}</span>
                      </td>
                      <td data-label={t['cur2.col.classes']}>{s.classes}</td>
                      <td data-label={t['cur2.col.content']}>
                        {fillMessage(t['cur2.contentSummary'], { objectives: s.objectivesIncluded, total: s.objectivesTotal, concepts: s.conceptsIncluded, required: s.required })}
                        {!s.structureImported && s.academicSubjectId ? <div className="ta-msg">{t['cur2.structureNotImported']}</div> : null}
                      </td>
                      <td data-label={t['cur2.col.actions']}>
                        <span className="ta-actions">
                          <Link className="btn btn-secondary" href={`/dashboard/institution/${institutionId}/curriculum/${s.curriculumId}`}>
                            {t['cur2.open']}
                          </Link>
                          <details className="cur2-inline">
                            <summary className="btn btn-ghost">{t['cur2.edit']}</summary>
                            <EditSubjectPanel institutionId={institutionId} row={{ curriculumId: s.curriculumId, academicSubjectId: s.academicSubjectId, versionId: s.versionId, gradeId: s.gradeId, academicYear: s.academicYear, title: s.title }} alternatives={alternativesFor(s)} grades={grades} labels={el} />
                          </details>
                          <ArchiveSubjectButton institutionId={institutionId} curriculumId={s.curriculumId} labels={al} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.programmeId && (
                <details>
                  <summary className="btn btn-secondary">+ {t['cur2.addSubject']}</summary>
                  <AddSubjectsWizard institutionId={institutionId} sources={sources} grades={grades} preset={{ programmeId: g.programmeId, gradeId: g.gradeId }} labels={wl} />
                </details>
              )}
            </section>
          ))}
          <details className="card ta-card" data-testid="add-curriculum">
            <summary className="btn btn-primary">{tk('cur2.addAnother')}</summary>
            <AddSubjectsWizard institutionId={institutionId} sources={sources} grades={grades} labels={wl} />
          </details>
        </>
      )}

      <section className="card ta-card" aria-labelledby="cur2-classes">
        <h2 id="cur2-classes">{t['cur2.classes.title']}</h2>
        <p className="ta-msg">{t['cur2.classes.body']}</p>
        {classes.length === 0 ? (
          <p className="ta-msg">{t['cur2.classes.empty']}</p>
        ) : (
          <ul className="role-list">
            {classes.map((c) => {
              // Every ACTIVE curriculum, compatible (same academic domain + grade) first -- a suggestion, never a binding.
              const options = rankCurriculumCandidates(active, { academicDomain: c.academicDomain, gradeId: c.gradeId }).map((r) => ({ id: r.curriculum.curriculumId, label: curriculumContextLabel(r.curriculum, t['cur2.wizard.allGrades']), compatible: r.compatible }));
              const currentRow = all.find((s) => s.curriculumId === c.institutionCurriculumId);
              return (
                <li key={c.id} className="ta-coordinator" data-class={c.id}>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <strong>{c.name}</strong>
                    <span className="ta-msg">
                      {t['cur2.classes.class']}: {c.name}{c.gradeName ? ` · ${c.gradeName}` : ''} · {t['cur2.classes.associated']}:{' '}
                      {currentRow ? curriculumContextLabel(currentRow, t['cur2.wizard.allGrades']) + (currentRow.status === 'ARCHIVED' ? ` (${t['cur2.status.ARCHIVED']})` : '') : t['cur2.classes.none2']}
                    </span>
                  </span>
                  <ClassCurriculumSelect
                    institutionId={institutionId}
                    classId={c.id}
                    current={c.institutionCurriculumId}
                    options={options}
                    domainLabel={c.academicDomain ? domainLabels.get(c.academicDomain) ?? c.academicDomain : null}
                    labels={classBindingLabels(t)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <details className="card ta-card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {t['cur2.archived']} ({archived.length})
          </summary>
          <ul className="role-list ta-compact">
            {archived.map((s) => (
              <li key={s.curriculumId} data-archived={s.curriculumId}>
                <strong>{curriculumLabel(s)}</strong> · {s.programme} · {s.archivedAt ? fillMessage(t['cur2.archivedOn'], { date: new Date(s.archivedAt).toLocaleDateString(locale) }) : t['cur2.status.ARCHIVED']}
                {s.replacedBy ? ` · ${t['cur2.replaced']}` : ''} ·{' '}
                <Link href={`/dashboard/institution/${institutionId}/curriculum/${s.curriculumId}`}>{t['cur2.open']}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="card ta-card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t['cur2.own.title']}</summary>
        <p className="ta-msg">{t['cur2.own.body']}</p>
        <AdoptCurriculumForm
          apiBase={`/api/institutions/${institutionId}`}
          subjects={adoptable.map((s) => ({ ...s, bases: [] }))}
          grades={grades.map((g) => ({ id: g.id, name: g.name }))}
          labels={{
            subject: t['icur.subject'],
            base: t['icur.base'],
            baseGeneral: t['icur.baseGeneral'],
            grade: t['icur.grade'],
            anyGrade: t['icur.anyGrade'],
            year: t['icur.year'],
            title: t['icur.titleField'],
            programme: t['icur.programme'],
            submit: t['icur.adopt'],
            done: t['icur.adopted'],
            errors: { ALREADY_EXISTS: t['icur.error.ALREADY_EXISTS'] },
            error: t['inst.common.error'],
          }}
        />
      </details>

      <section aria-labelledby="supplemental-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="supplemental-title" style={{ fontSize: 18 }}>{t['icur.supplemental']}</h2>
        {supplemental.length === 0 ? (
          <EmptyState title={t['icur.supplementalEmpty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {supplemental.map((s) => (
              <li key={`${s.classId}:${s.canonicalConceptId}`} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 220 }}>
                  <div className="row-title">{s.label}</div>
                  <div className="row-sub">
                    {s.className} · <span className="chip">{t['cur2.content.source.TEACHER_SUPPLEMENTAL']}</span>
                  </div>
                </div>
                {s.curriculumId && (
                  <AddCurriculumConceptForm
                    apiBase={`/api/institutions/${institutionId}`}
                    curriculumId={s.curriculumId}
                    fixedConceptId={s.canonicalConceptId}
                    defaultClassification="SUPPLEMENTAL"
                    labels={{ classification: t['icur.classification'], classifications, submit: t['icur.addToCurriculum'], error: t['inst.common.error'] }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="proposals-title">
        <h2 id="proposals-title">{t['icur.proposals']}</h2>
        {proposals.length === 0 ? (
          <p className="ta-msg">{t['icur.proposalsEmpty']}</p>
        ) : (
          <ul className="role-list">
            {proposals.map((p) => (
              <li key={p.id} className="ta-coordinator">
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <strong>{p.title}</strong>
                  <span className="ta-msg">{[p.subjectName, p.className, p.requestedBy ? fillMessage(t['cprop.requestedBy'], { who: p.requestedBy }) : null, p.resolvedConceptName ? `→ ${p.resolvedConceptName}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={p.status === 'PROPOSED' ? 'chip chip-warn' : p.status === 'REJECTED' ? 'chip' : 'chip chip-good'}>{t[`icur.status.${p.status}` as MessageKey]}</span>
              </li>
            ))}
          </ul>
        )}
        <h3 style={{ fontSize: 16 }}>{t['icur.propose']}</h3>
        <ProposeConceptForm
          endpoint={`/api/institutions/${institutionId}/concept-proposals`}
          subjects={adoptable.map((s) => ({ id: s.canonicalSubjectId, name: s.name }))}
          labels={{ subject: t['icur.subject'], title: t['tcp.plan.proposeTitle'], rationale: t['tcp.plan.proposeRationale'], submit: t['tcp.plan.proposeSubmit'], done: t['tcp.plan.proposeDone'], candidates: t['tcp.plan.proposeCandidates'], error: t['inst.common.error'] }}
        />
      </section>
    </div>
  );
}
