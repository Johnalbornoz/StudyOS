import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { getProfileCurriculum } from '@/services/academic-profile-catalogue.service';
import { loadClassProgrammes } from '@/lib/exam-core/eligibility/academic-context';
import AcademicProfileWizard from './AcademicProfileWizard';
import { query } from '@/lib/db';
import { isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { getStudentInstitutionalContext } from '@/lib/exam-journey/ux.server';
import { EntryChoice, InstitutionalContextCard } from './InstitutionalContextCard';
import { VALID_EXAM_TARGET_PREDICATE } from '@/lib/student/onboarding-gate';

/**
 * Student Academic Profile. Once saved it is shown as a summary (never asked again
 * each session) with an explicit "Cambiar" action. Class curricula set by an
 * Institution are listed beside it: authoritative for that class, never merged
 * into the personal profile; a different programme is shown as such.
 */
export default async function AcademicProfilePage({ searchParams }: { searchParams?: Promise<{ entry?: string }> } = {}) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const [profile, curriculum, classRows] = await Promise.all([getAcademicProfile(studentId), getProfileCurriculum(studentId), loadClassProgrammes(studentId).catch(() => [])]);
  const classCurricula = classRows.filter((r) => r.programme_id);
  const completed = !!profile?.profileCompleted;

  // Student Exam Journey -- entry UX (STUDENT_JOURNEY_V2=UX only).
  if (isStudentJourneyUxEnabled()) {
    const context = await getStudentInstitutionalContext(studentId);
    const institutionDefinesPath = context.institutions.some((i) => i.classes.some((c) => c.subject.value !== null));
    if (institutionDefinesPath) {
      // J1.3: what the institution provided is shown, never asked again; the Student's own
      // declaration stays separate (and never overwrites the institution).
      return (
        <div className="acp-page">
          <div className="acp-intro">
            <h1>{t['profile.title']}</h1>
          </div>
          <InstitutionalContextCard context={context} labels={tr} />
          {completed || context.conflicts.length > 0 ? (
            <details className="card ui-disclosure jx-personal">
              <summary className="jx-summary">{tr['jx.inst.personal.title']}</summary>
              <div className="ui-disclosure-body">
                <p className="ui-hint">{tr['jx.inst.personal.lead']}</p>
                <AcademicProfileWizard
                  t={tr}
                  initial={{
                    countryOfStudy: profile?.countryOfStudy ?? null,
                    schoolYear: profile?.schoolYear ?? null,
                    curriculumType: profile?.curriculumType ?? null,
                    curriculumScope: curriculum?.scope ?? null,
                    academicProgrammeId: curriculum?.programmeId ?? null,
                    academicQualificationId: curriculum?.qualificationId ?? null,
                    academicSubjectIds: curriculum?.subjects.map((x) => x.id) ?? [],
                    academicYear: profile?.academicYear ?? null,
                    profileCompleted: completed,
                  }}
                />
              </div>
            </details>
          ) : null}
        </div>
      );
    }
    const entry = (await searchParams)?.entry;
    const hasTarget = (await query(`SELECT 1 FROM student_exam_profiles WHERE student_id = $1 AND ${VALID_EXAM_TARGET_PREDICATE} LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }))).rows.length > 0;
    if (!profile && !hasTarget && entry !== 'curriculum') {
      // J3.3: ONE first decision before any form -- an exam needs no school profile.
      return (
        <div className="acp-page">
          <EntryChoice labels={tr} />
        </div>
      );
    }
  }

  return (
    <div className="acp-page">
      <div className="acp-intro">
        <h1>{t['profile.title']}</h1>
        <p className="acp-lead">{t['profile.subtitle']}</p>
      </div>

      {completed && (
        <section className="card acp-summary" aria-labelledby="acp-summary-title">
          <h2 id="acp-summary-title">{tr['acp.summary.title']}</h2>
          <p className="acp-summary-line">
            <strong>{curriculum?.programme ?? tr['acp.summary.none']}</strong>
            {curriculum?.authority ? <span className="acp-hint"> · {curriculum.authority}</span> : null}
            {curriculum?.qualification ? <span className="acp-hint"> · {curriculum.qualification}</span> : null}
          </p>
          <p className="acp-hint">{[profile?.schoolYear, profile?.academicYear].filter(Boolean).join(' · ')}</p>
          {curriculum && curriculum.subjects.length > 0 ? (
            <p className="acp-hint">{fillMessage(tr['acp.summary.subjects'], { subjects: curriculum.subjects.map((s) => (s.level ? `${s.name} ${s.level}` : s.name)).join(', ') })}</p>
          ) : null}
          <p className="acp-hint">{tr['acp.summary.historyNote']}</p>
        </section>
      )}

      {classCurricula.length > 0 && (
        <section className="card acp-summary" aria-labelledby="acp-classes-title" data-class-curricula>
          <h2 id="acp-classes-title">{tr['acp.institution.title']}</h2>
          <ul className="acp-class-list">
            {classCurricula.map((r) => {
              const conflict = !!curriculum?.programmeId && r.programme_id !== curriculum.programmeId;
              return (
                <li key={r.class_id} className={conflict ? 'acp-conflict' : undefined}>
                  {fillMessage(tr[conflict ? 'acp.institution.conflict' : 'acp.institution.row'], { class: r.class_name, programme: r.programme_name ?? '' })}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AcademicProfileWizard
        t={tr}
        initial={{
          countryOfStudy: profile?.countryOfStudy ?? null,
          schoolYear: profile?.schoolYear ?? null,
          curriculumType: profile?.curriculumType ?? null,
          curriculumScope: curriculum?.scope ?? null,
          academicProgrammeId: curriculum?.programmeId ?? null,
          academicQualificationId: curriculum?.qualificationId ?? null,
          academicSubjectIds: curriculum?.subjects.map((s) => s.id) ?? [],
          academicYear: profile?.academicYear ?? null,
          profileCompleted: completed,
        }}
      />
    </div>
  );
}
