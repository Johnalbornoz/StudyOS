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
import { listInstitutionGrades } from '@/services/institution.service';
import {
  listInstitutionCurricula,
  getInstitutionCurriculum,
  listSupplementalSuggestions,
  listAdoptableSubjects,
  CurriculumError,
  CURRICULUM_CLASSIFICATIONS,
} from '@/lib/learning-plan/institution-curriculum.service';
import { listConceptProposals } from '@/lib/learning-plan/concept-proposals.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProposeConceptForm } from '@/components/learning-plan/ProposeConceptForm';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { AdoptCurriculumForm, CurriculumConceptControls, AddCurriculumConceptForm } from './CurriculumActions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- Institution Curriculum (the institution's coordinators). Adopt a
 * base (published curriculum or the subject's general catalog), classify
 * concepts REQUIRED / RECOMMENDED / OPTIONAL / SUPPLEMENTAL by grade/period,
 * add existing concepts, retire/restore (no learner history is touched),
 * take teachers' supplemental concepts into the curriculum and follow
 * concept proposals. The StudyUS catalog is never modified here.
 */
export default async function InstitutionCurriculumPage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<{ curriculum?: string }> }) {
  const { institutionId } = await params;
  const sp = await searchParams;
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

  const apiBase = `/api/institutions/${institutionId}`;
  const [curricula, grades, subjects, supplemental, proposals] = await Promise.all([
    listInstitutionCurricula(institutionId),
    listInstitutionGrades(institutionId),
    listAdoptableSubjects(),
    listSupplementalSuggestions(institutionId, locale),
    listConceptProposals({ institutionId }),
  ]);
  const selectedId = sp.curriculum && UUID_RE.test(sp.curriculum) ? sp.curriculum : null;
  const selected = selectedId
    ? await getInstitutionCurriculum(institutionId, selectedId, locale).catch((e) => {
        if (e instanceof CurriculumError) return null;
        throw e;
      })
    : null;
  const classifications = Object.fromEntries(CURRICULUM_CLASSIFICATIONS.map((c) => [c, t[`lp.class.${c}` as MessageKey]])) as Record<(typeof CURRICULUM_CLASSIFICATIONS)[number], string>;

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['icur.title']} />
        <InstitutionSubNav institutionId={institutionId} active="curriculum" labels={institutionSubNavLabels(t)} />
      </div>
      <p className="ta-msg">{t['icur.subtitle']}</p>

      <section aria-labelledby="curricula-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="curricula-title" style={{ fontSize: 18 }}>{t['icur.title']}</h2>
        {curricula.length === 0 ? (
          <EmptyState title={t['icur.empty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {curricula.map((c) => (
              <li key={c.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 260 }}>
                  <div className="row-title">{c.title}</div>
                  <div className="row-sub">{[c.subjectName, c.gradeName ?? t['icur.anyGrade'], c.programmeLabel, c.academicYear].filter(Boolean).join(' · ')}</div>
                  {c.baseName && <div className="row-sub">{fillMessage(t['icur.version'], { base: c.baseName, version: c.baseVersion ?? '—' })}</div>}
                  <div className="row-sub">{fillMessage(t['icur.counts'], c.counts)}</div>
                </div>
                <Link href={`/dashboard/institution/${institutionId}/curriculum?curriculum=${c.id}`} className={c.id === selectedId ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={c.id === selectedId ? 'page' : undefined}>
                  {t['icur.open']}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="card ta-card" aria-labelledby="concepts-title">
          <h2 id="concepts-title">
            {t['icur.concepts']} · {selected.summary.title}
          </h2>
          <p className="ta-msg">{t['icur.removalNote']}</p>
          <ul className="role-list">
            {selected.concepts.map((c) => (
              <li key={c.canonicalConceptId} className="ta-stack" style={{ gap: 'var(--space-1)' }}>
                <span>
                  <strong>{c.label}</strong>
                  {c.status === 'REMOVED' && <span className="chip chip-warn"> {t['icur.removed']}</span>}
                </span>
                <CurriculumConceptControls
                  apiBase={apiBase}
                  curriculumId={selected.summary.id}
                  canonicalConceptId={c.canonicalConceptId}
                  classification={c.classification}
                  period={c.period}
                  removed={c.status === 'REMOVED'}
                  labels={{
                    classification: t['icur.classification'],
                    classifications,
                    period: t['icur.period'],
                    save: t['tcp.plan.save'],
                    remove: t['icur.remove'],
                    restore: t['icur.restore'],
                    removeConfirm: t['icur.removalNote'],
                    error: t['inst.common.error'],
                  }}
                />
              </li>
            ))}
          </ul>
          {selected.addable.length > 0 && (
            <>
              <h3 style={{ fontSize: 16 }}>{t['icur.addConcept']}</h3>
              <AddCurriculumConceptForm
                apiBase={apiBase}
                curriculumId={selected.summary.id}
                addable={selected.addable}
                labels={{ concept: t['icur.concepts'], classification: t['icur.classification'], classifications, submit: t['icur.add'], error: t['inst.common.error'] }}
              />
            </>
          )}
        </section>
      )}

      <section className="card ta-card" aria-labelledby="adopt-title">
        <h2 id="adopt-title">{t['icur.adopt']}</h2>
        <p className="ta-msg">{t['icur.adoptBody']}</p>
        <AdoptCurriculumForm
          apiBase={apiBase}
          subjects={subjects}
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
      </section>

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
                  <div className="row-sub">{s.className}</div>
                </div>
                {s.curriculumId && (
                  <AddCurriculumConceptForm
                    apiBase={apiBase}
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
          endpoint={`${apiBase}/concept-proposals`}
          subjects={subjects.map((s) => ({ id: s.canonicalSubjectId, name: s.name }))}
          labels={{ subject: t['icur.subject'], title: t['tcp.plan.proposeTitle'], rationale: t['tcp.plan.proposeRationale'], submit: t['tcp.plan.proposeSubmit'], done: t['tcp.plan.proposeDone'], candidates: t['tcp.plan.proposeCandidates'], error: t['inst.common.error'] }}
        />
      </section>
    </div>
  );
}
