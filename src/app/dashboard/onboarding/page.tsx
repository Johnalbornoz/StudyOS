import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { onboardingRouteRedirect } from '@/lib/lx/first-destination';
import { VALID_EXAM_TARGET_PREDICATE } from '@/lib/student/onboarding-gate';
import { INSTITUTIONAL_PATH_COUNT_SQL } from '@/lib/student/onboarding-gate.server';
import { isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { resolveWorkspaceEntry } from '@/lib/identity/workspace-entry';
import { ONBOARDING_EXAM_PATH, ONBOARDING_LEARN_PATH } from '@/lib/lx/onboarding-paths';

/**
 * REM-T1-05 -- ONE decision: "How do you want to start?". Both choices use the
 * SAME interaction: the card navigates to that journey's own next step
 * (Learn a subject -> /dashboard/onboarding/learn; Prepare for an exam ->
 * /dashboard/exam-prep), and Back from either returns here. Nothing is
 * created by this page; refreshing it is deterministic.
 *
 * LX-2D / UX-5 closure -- first-time onboarding: no product tour, no
 * StudyUs vocabulary. The page asks "¿Qué quieres aprender?" and offers
 * the subjects the Student's profile implies (SubjectPicker); choosing one
 * continues straight into concept choice in Aprender.
 *
 * Migration-safe: a learner who already has a subject is bounced to
 * Today, so this route never traps an existing user and never resets
 * anyone. It also cannot loop (Today does not redirect back here).
 */
export default async function OnboardingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  // A01-LOGIC-03: a non-Student workspace (e.g. an admin-only account) is
  // sent to its own home before any Student data is provisioned.
  const entry = await resolveWorkspaceEntry(clerkUserId);
  if (entry.kind === 'REDIRECT') redirect(entry.to);

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const subjectRes = await query(`SELECT 1 FROM subjects WHERE student_id = $1 LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  const goalRes = await query(`SELECT 1 FROM student_exam_profiles WHERE student_id = $1 AND ${VALID_EXAM_TARGET_PREDICATE} LIMIT 1`, [studentId]).catch(() => ({ rows: [] as unknown[] }));
  // Entry UX: an institution-defined path never lands on the subject picker.
  const institutionalRes = isStudentJourneyUxEnabled()
    ? await query(`SELECT ${INSTITUTIONAL_PATH_COUNT_SQL} AS n FROM students s WHERE s.id = $1`, [studentId]).catch(() => ({ rows: [] as any[] }))
    : { rows: [] as any[] };
  const bounce = onboardingRouteRedirect({ hasSubject: subjectRes.rows.length > 0, hasExamGoal: goalRes.rows.length > 0, hasInstitutionalPath: ((institutionalRes.rows[0] as any)?.n ?? 0) > 0 });
  if (bounce) redirect(bounce);

  return (
    <div className="xp-page">
      {/* REM-T1-05: two equal journeys, the same interaction (navigate to a dedicated next step). */}
      <section className="prep-start" aria-labelledby="prep-start-title">
        <h1 id="prep-start-title" className="exv2-title">{tr['prep.onboarding.title']}</h1>
        <div className="prep-start-options">
          <Link className="card prep-start-option" href={ONBOARDING_LEARN_PATH} data-journey="learn">
            <strong>{tr['prep.onboarding.learn']}</strong>
            <span className="ui-hint">{tr['prep.onboarding.learnBody']}</span>
          </Link>
          <Link className="card prep-start-option" href={ONBOARDING_EXAM_PATH} data-journey="exam">
            <strong>{tr['prep.onboarding.exam']}</strong>
            <span className="ui-hint">{tr['prep.onboarding.examBody']}</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
